let EB = {};
EB.borderStyle = "2px solid rgb(120, 46, 34)";
EB.highlightStyle = "";

Handlebars.registerHelper("capitalizeAll", function (str) {
    return str.toUpperCase();
});

class EncounterTTVApplication extends Application {
    constructor(Actors, options = {}) {
        super(options);

        if (!game.user.isGM) return;

        this.object = Actors
        this.allies = [];
        this.opponents = [];
        this.calced = {
            allies: {
                hp: 0,
                avg_ac: 0,
                weighted_ac: 0,
                dpr: 0,
                ttv: 0,
                /* how many of each attack an actor makes (squad-specific)
                 * { actorName: {
                 *      attackID: Map(
                 *          attack: Item5e
                 *          count: Number,
                 *      )
                 * }}
                 */
                attackCounts: new Map(),
                actors: this.allies
            },
            opponents: {
                hp: 0,
                avg_ac: 0,
                weighted_ac: 0,
                dpr: 0,
                ttv: 0,
                attackCounts: new Map(),
                actors: this.opponents
            }
        };
        this.calced.allies.opp = this.calced.opponents;
        this.calced.opponents.opp = this.calced.allies;
        this.selection = null;
        game.users.apps.push(this)

        // value of `this` inside helper functions doesn't seem to agree with
        // what the documentation says it should be, so we avoid using it
        let ttv = this;
        Handlebars.registerHelper("ifActorSelected", (actor, squadName, options) => {
            if (ttv.selection !== null) {
                let squad = squadName === "allies" ? ttv.allies : ttv.opponents;
                if (ttv.selection.squad === squad && ttv.selection.name === actor.name) {
                    /* Handlebars isn't working as advertised:
                     * `this` is supposed to be set to the context in the template (I think)
                     * but that doesn't appear to be happening, so we just hand it `actor` instead,
                     * since that's the variable that the template passed as `this` when invoking the handler.
                     */
                    return options.fn(actor);
                }
            }
            return options.inverse(actor);
        });
        Handlebars.registerHelper("attackCount", attack => {
            // we need the squad in `calced` rather than the one that _onClickPortrait gives us
            // TODO: refactor things to render this disgusting code unnecessary
            let squad = ttv.selection.squad === ttv.allies ? ttv.calced.allies : ttv.calced.opponents;
            let actorName = ttv.selection.name
            console.log('attackCount helper (attack)', attack);
            console.log('  squad, actorName', squad, actorName);
            return squad.attackCounts.get(actorName).get(attack._attack._id).count;
        });
        Handlebars.registerHelper("ifSelectionHasMultiattack", (options) => {
            let ma;
            if (ma = ttv.selectedActorMultiattack) {
                return options.fn(ma);
            }
        });
    }

    static get defaultOptions() {
        const options = super.defaultOptions;
        options.title = game.i18n.localize("EB.Title");
        options.id = game.i18n.localize("EB.id");
        options.template = "modules/encounter-ttv/templates/ttv-app.html";
        options.closeOnSubmit = true;
        options.popOut = true;
        options.width = 510;
        options.height = "auto";
        options.classes = ["encounter-ttv", "ttv-form"];
        return options;
    }

    async getData() {
        return {
            allies: this.allies,
            opponents: this.opponents,
            test: this.test,
            calced: this.calced,
            selection: this.selection
        };
    }

    activateListeners(html) {
        console.log('activateListeners(html)', html);
        super.activateListeners(html);
        html.find("#EBContainers .actor-container").each((i, li) => {
            li.setAttribute("draggable", true);
            li.addEventListener("dragstart", this._onDragStart, false);
            li.addEventListener("click", this._onClickPortrait.bind(this));
        });
        html.find("#EBContainers .group-container").each((i, li) => {
            li.addEventListener("dragover", this._onDragOverHighlight);
            li.addEventListener("dragleave", this._onDragLeaveHighlight);
        })
        html.find("#EBContainers .ally-container")[0].addEventListener("drop", this._onDropAlly.bind(this));
        html.find("#EBContainers .opponent-container")[0].addEventListener("drop", this._onDropOpponent.bind(this));
        html.find("#EBXP .clear")[0].addEventListener("click", this._onClickButton);
        let attackCountInputs = html.find("#EBXP .attack-count");
        for (let el of attackCountInputs) {
            el.addEventListener("change", this._onChangeAttackCount.bind(this));
        }
        html[0].render = this.render;
        html[0].ondragover = this._onDragOver;
        html[0].ondrop = this._onDrop;
    }

    /**
     * Performs calculations determine TTV for both sides of the encounter.
     *
     * @memberof EncounterBuilderApplication
     */
    calc() {
        // might be necessary if these arrays get reinstantiated at some point
        this.calced.allies.actors = this.allies;
        this.calced.opponents.actors = this.opponents;

        let sum = (values) => values.reduce((a, b) => a+b, 0);
        let average = values => values.length > 0 ? sum(values)/values.length : 0;

        let findActorAC = actor => actor.system.attributes.ac.value;
        let findActorHP = actor => actor.system.attributes.hp.value;

        // Total HP and average AC for each side
        this.calced.allies.hp = sum(this.allies.map(findActorHP));
        this.calced.opponents.hp = sum(this.opponents.map(findActorHP));
        let allyACs = this.allies.map(findActorAC);
        let oppACs = this.opponents.map(findActorAC);
        this.calced.allies.avg_ac = average(allyACs).toNearest(0.01);
        this.calced.opponents.avg_ac = average(oppACs).toNearest(0.01);

        // Average AC weighted by the HP of each actor
        let weightedAC = totalHP => (actor => findActorAC(actor) * findActorHP(actor) / totalHP);
        this.calced.allies.weighted_ac = sum(this.allies.map(weightedAC(this.calced.allies.hp))).toNearest(0.01);
        this.calced.opponents.weighted_ac = sum(this.opponents.map(weightedAC(this.calced.opponents.hp))).toNearest(0.01);

        // Average DPR of attacks against the weighted AC of the opposing force
        let findActorAttacks = actor => actor.items.filter(i => i.hasAttack && i.hasDamage);
        let toHitAsNumber = toHit => Number(toHit.replace(' ', '')); // e.g. "+ 5" becomes 5
        let hitProb = (toHit, AC) => 1 - ( (AC - toHitAsNumber(toHit) - 1) / 20 );
        // Calculate average result of a damage roll formula
        function avgDamage(damageRoll) {
            // e.g. average value of "2d6+6" is (2*6 + 2)/2
            let avgDamage = damageRoll.replace(/\b([0-9]+)d([0-9]+)\b/, '($1*$2 + $1)/2');
            let r = new Roll(avgDamage);  // use Roll.evaluate() as a safe eval
            return r.evaluate({async: false}).total;
        }

        /**
         * TODO: make this a set of methods in different classes (5e, sw5e, ...)
         */
        function attackUsesResources(attack) {
            let mode = attack.system?.scaling?.mode
            // 5e uses "cantrip" here; sw5e uses "atwill"
            return mode === 'atwill' || mode === 'cantrip';
        }
        /**
         * TODO: make this a set of methods in different classes (5e, sw5e, ...)
         */
        function attackCasterLevel(attack) {
            let ret = attack.curAdvancementCharLevel; // sw5e
            if (ret === undefined) {
                ret = attack.parent.system.details.level; // 5e
            }
            return ret;
        }

        /**
         * Pulls the damage formula out of the attack
         * and adjusts it for cantrip scaling when appropriate.
         */
        function getDamageFormula(attack) {
            let damageFormula = attack.labels.damage;
            if (attackUsesResources(attack)) {
                let casterLevel = attackCasterLevel(attack);
                const cantripTiers = [
                    {pred: l => l >= 17, dice: 4},
                    {pred: l => l >= 11, dice: 3},
                    {pred: l => l >=  5, dice: 2},
                    {pred: l =>    true, dice: 1}
                ];
                for (let tier of cantripTiers) {
                    if (tier.pred(casterLevel)) {
                        let ret = damageFormula.replace( /\b1d([0-9]+)\b/, `${tier.dice}d$1`);
                        console.log('getDamageFormula(attack): damageFormula, casterLevel, ret',
                            attack, damageFormula, casterLevel, ret
                        );
                        return ret;
                    }
                }
            }
            return damageFormula;
        }
        let attackDPR = (attack, targetAC) => {
            let hp = hitProb(attack.labels.toHit, targetAC);
            let damageFormula = getDamageFormula(attack);
            let ad = avgDamage(damageFormula);
            let result = hp * ad;
            return result;
        };
        /**/

        // set initial attack counts for new actors
        function setAttackCounts(squad) {
            let oppAC = squad.opp.weighted_ac;
            squad.actors.forEach(actor => {
                if (squad.attackCounts.has(actor.name)) {
                    // if we've already done this, leave things as they are
                    return;
                }

                let actorAttackCounts = new Map();
                squad.attackCounts.set(actor.name, actorAttackCounts);

                let attacks = findActorAttacks(actor);
                if (attacks.length === 0) {
                    // if the actor has no attacks, their entry in squad.attackCounts remains an empty map
                    return;
                }

                // Check if the actor has a multiattack which matches a heuristic regex
                // TODO: add heuristic regex matching for multiattacks

                // otherwise we set the count to 1 for the highest DPR attack and to 0 for others
                let highestDPRAttack = attacks.reduce(
                    (a1, a2) => attackDPR(a1, oppAC) > attackDPR(a2, oppAC) ? a1 : a2
                );
                attacks.forEach(attack => actorAttackCounts.set(attack._id, {
                    attack: attack,
                    count: attack === highestDPRAttack? 1 : 0
                }));
            });
        }
        setAttackCounts(this.calced.allies);
        setAttackCounts(this.calced.opponents);

        function calcSquadDPR(squad) {
            squad.dpr = sum(squad.actors.map(actor => {
                // calculate total DPR of all each actor's attacks
                let attackCounts = squad.attackCounts.get(actor.name);
                if (attackCounts === undefined) {
                    return 0;
                }
                return sum(Array.from(attackCounts.values(), attack =>
                    attack.count * attackDPR(attack.attack, squad.opp.weighted_ac)
                ));
            })).toNearest(0.01);
        }
        calcSquadDPR(this.calced.allies);
        calcSquadDPR(this.calced.opponents);

        let calcTTV = squad => squad.ttv = (squad.opp.hp / squad.dpr).toNearest(0.01);
        calcTTV(this.calced.allies);
        calcTTV(this.calced.opponents);

        if (this.selection) {
            this.selection.hp = findActorHP(this.selection.actor);
            this.selection.ac = findActorAC(this.selection.actor);
            this.selection.attacks = findActorAttacks(this.selection.actor);
            let squad = this.selection.squad === this.allies ? this.calced.allies : this.calced.opponents;
            this.selection.attacks = this.selection.attacks.map(a => ({
                _attack: a,
                name: a.name,
                dpr: attackDPR(a, squad.opp.weighted_ac).toNearest(0.01)
            }));
        }
    }

    /**
     * Returns the best multiattack item in the inventory of the selected actor.
     * For NPCs, this is their Multiattack feature.
     * For PCs, this is Master of Combat, Greater Extra Attack, or Extra Attack,
     * in descending order of preference.
     */
    get selectedActorMultiattack() {
        if (this.selection) {
            let npcMA = this.selection.actor.items.find(i => i.name === 'Multiattack');
            if (npcMA) {
                console.log('<<selectedActorMultiattack: npcMA', npcMA);
                return npcMA;
            }
            for (let s of ['Master of Combat', 'Greater Extra Attack', 'Extra Attack']) {
                let pcMA = this.selection.actor.items.find(i => i.name === s);
                if (pcMA) {
                    console.log('<<selectedActorMultiattack: pcMA', pcMA);
                    return pcMA;
                }
            }
        }
    }

    /**
     * Ondrop template for ally and opponent fields. Attempts to return builder Application and Actor of interest.
     *
     * @param {*} event
     * @returns {Array}
     * @memberof EncounterBuilderApplication
     */
    async _onDropGeneral(event) {
        const data = JSON.parse(event.dataTransfer.getData("text/plain"));
        const actors = []

        function recur_folder(folder) {
            const actors = folder.contents
            const subfolders = folder.getSubfolders()
            for (let i = 0; i < subfolders.length; i++) {
                actors.push(...recur_folder(subfolders[i]))
            }

            return actors
        }
        if (data.type === game.folders.documentName && data.documentName === game.actors.documentName) {
            const folder = await Folder.fromDropData(data)
            actors.push(...recur_folder(folder))
        }
        else if (data.type === game.actors.documentName) {
            const actor = await Actor.fromDropData(data);
            actors.push(actor)
        }

        else {
                throw new Error(game.i18n.localize("EB.EntityError"));
        }

        const app = game.users.apps.find(e => e.id === game.i18n.localize("EB.id"));
        return [app, actors]
    }

    /**
     * Ondrop for allies. Cannot have a playable character multiple times. Can have monsters/npcs multiple times.
     *
     * @param {*} event
     * @memberof EncounterBuilderApplication
     */
    async _onDropAlly(event) {
        event.preventDefault();
        let [app, actors] = await this._onDropGeneral(event);
        await this.processDrop(event, app.allies, app.opponents, app, actors)
    }


    /**
     * Ondrop for opponents. Cannot have a playable character multiple times. Can have monsters/npcs multiple times.
     *
     * @param {*} event
     * @memberof EncounterBuilderApplication
     */
    async _onDropOpponent(event) {
        event.preventDefault();
        let [app, actors] = await this._onDropGeneral(event);
        await this.processDrop(event, app.opponents, app.allies, app, actors)
    }

    async processDrop(event, currentDropZone, opposingDropZone, app, actors) {

        let actorExists;
        let actorExistsOpposing;
        actors.forEach(function (actor) {
            if (actor.type === "character") {
                actorExists = currentDropZone.find(e => e.id === actor.id)
                actorExistsOpposing = opposingDropZone.find(e => e.id === actor.id);

                if (actorExistsOpposing) {
                    let ix = opposingDropZone.findIndex(e => e.id === actor.id);
                    opposingDropZone.splice(ix, 1);
                }
                if (!actorExists) {
                    currentDropZone.push(actor)
                }
            }
            else if (actor.type === "npc") {
                currentDropZone.push(actor);
            }
        })

        app.calc();
        app.render();
    }

    _onDragOverHighlight(event) {
        const li = this;
        li.style["border"] = EB.borderStyle;
        li.style["background"] = EB.highlightStyle;
    }

    _onDragLeaveHighlight(event) {
        const li = this;
        li.style["border"] = "";
        li.style["background"] = "";
    }

    /**
     * Ondragstart for character portraits, sets data necessary to drag to canvas.
     *
     * @param {*} event
     * @memberof EncounterBuilderApplication
     */
    _onDragStart(event) {
        event.stopPropagation();
        const id = this.firstElementChild.id
        const actor = game.actors.get(id)

        event.dataTransfer.setData("text/plain", JSON.stringify({
            type: game.actors.documentName,
            uuid: actor.uuid
        }));
    }

    /**
     * Remove actor from calculation on clicking the portrait.
     *
     * @param {*} event
     * @memberof EncounterBuilderApplication
     */
    _onClickPortrait(event) {
        event.stopPropagation();

        const srcClass = event.srcElement.classList.value;
        const isPortrait = srcClass === "actor-portrait";
        const isHoverIcon = (srcClass === "actor-subtract") || (srcClass === "fas fa-minus");
        if ((isPortrait) || (isHoverIcon)) {
            const app = game.users.apps.find(e => e.id === game.i18n.localize("EB.id"));
            let name = event.srcElement.title;

            const parentClass = event.srcElement.parentElement.parentElement.classList.value;
            const parentParentClass = event.srcElement.parentElement.parentElement.parentElement.classList.value;
            if ((parentClass === "group-field ally-field") || (parentParentClass === "group-field ally-field")) {
                this.selection = {
                    name: name,
                    actor: this.allies.find(e => e.name === name),
                    squad: this.allies
                };
            }
            else if ((parentClass === "group-field opponent-field") || (parentParentClass === "group-field opponent-field")) {
                this.selection = {
                    name: name,
                    actor: this.opponents.find(e => e.name === name),
                    squad: this.opponents
                };
            }
            app.calc();
            app.render();
        }
    }

    /**
     * Clears list of allies and opponents.
     *
     * @param {*} event
     * @memberof EncounterBuilderApplication
     */
    _onClickButton(event) {
        event.stopPropagation();
        const app = game.users.apps.find(e => e.id === game.i18n.localize("EB.id"));
        app.allies = [];
        app.opponents = [];

        app.calc();
        app.render();
    }

    /**
     * Reacts to changes to an attack count input box.
     * Sets the attack count for the appropriate attack under this.calced and redraws.
     * @param {*} event
     * @memberof EncounterBuilderApplication
     */
    _onChangeAttackCount(event) {
        event.stopPropagation();
        console.log('_onChangeAttackCount(event)', event);
        let calcedSquad = this.selection.squad === this.allies ? this.calced.allies : this.calced.opponents;
        let actorAttackCounts = calcedSquad.attackCounts.get(this.selection.name);
        let attack = actorAttackCounts.get(event.srcElement.id);
        attack.count = event.srcElement.value;

        this.calc();
        this.render();
    }
}
