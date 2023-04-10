import log from './log.js';
import { default as CalcRTV, RTVSelection } from "./calc.js";

let EB = {};
EB.borderStyle = "2px solid rgb(120, 46, 34)";
EB.highlightStyle = "";

Handlebars.registerHelper("capitalizeAll", function (str) {
    return str.toUpperCase();
});
Handlebars.registerHelper('roundTo100ths', function(val) {
    return val.toNearest(0.01);
});

export default class EncounterRTVApplication extends Application {
    constructor(Actors, options = {}) {
        super(options);

        if (!game.user.isGM) return;

        this.object = Actors
        this.allies = [];
        this.opponents = [];
        this.calced = new CalcRTV(this.allies, this.opponents);
        /**
         * Tracks which actor is selected (all instances of the selected actor are selected)
         * { actor:   [references the corresponding actor object in this.allies or this.opponents]
         *   name:    String
         *   squad:   [references either this.allies or this.opponents]
         *   ac:      Number
         *   hp:      Number
         *   attacks: Array of Item5e objects
         * }
         * TODO: name, ac, hp, and attacks should probably move into a `calced` object under selection
         *       They're used when rendering the selection div but aren't directly controlled
         *       Or maybe they should be located in like this.calced.selection
         */
        this.selection = null;
        game.users.apps.push(this)

        // value of `this` inside helper functions doesn't seem to agree with
        // what the documentation says it should be, so we avoid using it
        let rtv = this;
        Handlebars.registerHelper("ifActorSelected", (actor, squadName, options) => {
            if (rtv.selection !== null) {
                let squad = squadName === "allies" ? rtv.allies : rtv.opponents;
                if (rtv.selection.squad === squad && rtv.selection.name === actor.name) {
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
            //let squad = rtv.selection.squad === rtv.allies ? rtv.calced.allies : rtv.calced.opponents;
            let squad = rtv.selection.squad;
            let actorName = rtv.selection.name
            log('attackCount helper; rtv, attack', rtv, attack);
            log('  squad, actorName', squad, actorName);
            return squad.attackCounts.get(actorName).get(attack._attack._id).count;
        });
        Handlebars.registerHelper("ifSelectionHasMultiattack", (options) => {
            let ma;
            if (ma = rtv.selection?.multiattack) {
                return options.fn(ma);
            }
        });
    }

    static get defaultOptions() {
        const options = super.defaultOptions;
        options.title = game.i18n.localize("EB.Title");
        options.id = game.i18n.localize("EB.id");
        options.template = "modules/encounter-rtv/templates/rtv-app.html";
        options.closeOnSubmit = true;
        options.popOut = true;
        options.width = 510;
        options.height = "auto";
        options.classes = ["encounter-rtv", "rtv-form"];
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
        log('activateListeners(html)', html);
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
        html.find("#EBXP .remove-actor")[0].addEventListener("click", this._onClickRemove.bind(this));
        let attackCountInputs = html.find("#EBXP .attack-count");
        for (let el of attackCountInputs) {
            el.addEventListener("change", this._onChangeAttackCount.bind(this));
        }
        html[0].render = this.render;
        html[0].ondragover = this._onDragOver;
        html[0].ondrop = this._onDrop;
    }

    /**
     * Performs calculations determine RTV for both sides of the encounter.
     *
     * @memberof EncounterBuilderApplication
     */
    calc() {
        // might be necessary if these arrays get reinstantiated at some point
        this.calced.allies.actors = this.allies;
        this.calced.opponents.actors = this.opponents;
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
            log('_onClickPortrait; this, event:', this, event);

            const parentClass = event.srcElement.parentElement.parentElement.classList.value;
            const parentParentClass = event.srcElement.parentElement.parentElement.parentElement.classList.value;
            log('    parentClass, parentParentClass:', parentClass, parentParentClass);
            if ((parentClass === "group-field ally-field") || (parentParentClass === "group-field ally-field")) {
                this.selection = new RTVSelection(name, this.calced.allies);
            }
            else if ((parentClass === "group-field opponent-field") || (parentParentClass === "group-field opponent-field")) {
                this.selection = new RTVSelection(name, this.calced.opponents);
            }
            app.calc();
            app.render();
        }
    }

    /**
     * Removes one instance of the selected actor.
     *
     * @param {*} event
     * @memberof EncounterBuilderApplication
     */
    _onClickRemove(event) {
        event.stopPropagation();
        let actorID = this.selection.actor.id
        let actorIndex = this.selection.squad.findIndex(a => a.id === actorID);
        this.selection.squad.splice(actorIndex, 1);

        this.calc();
        this.render();
    }

    /**
     * Reacts to changes to an attack count input box.
     * Sets the attack count for the appropriate attack under this.calced and redraws.
     * @param {*} event
     * @memberof EncounterBuilderApplication
     */
    _onChangeAttackCount(event) {
        event.stopPropagation();
        log('_onChangeAttackCount(event)', event);
        let actorAttackCounts = this.selection.getActorAttackCounts(this.selection.actor);
        let attack = actorAttackCounts.get(event.srcElement.id);
        attack.count = event.srcElement.value;

        this.calc();
        this.render();
    }
}
