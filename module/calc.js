import log from './log.js';

/**
 * Math functions
 */
let sum = (values) => values.reduce((a, b) => a+b, 0);
let average = values => values.length > 0 ? sum(values)/values.length : 0;
let hitProb = (toHit, AC) => 1 - ( (AC - sys.toHitAsNumber(toHit) - 1) / 20 );

// Calculate average result of a damage roll formula
function avgDamage(damageRoll) {
    // e.g. average value of "2d6+6" is (2*6 + 2)/2 + 6
    let avgDamage = damageRoll.replace(/\b([0-9]+)d([0-9]+)\b/, '($1*$2 + $1)/2');
    let r = new Roll(avgDamage);  // use Roll.evaluate() as a safe eval
    return r.evaluate({async: false}).total;
}

/**
 * System data access and manipulation functions.
 * An init hook copies system-specific properties from the corresponding class
 * to `sys`.
 */
let sys = null;
Hooks.once('init', () => {
    log('init hook: system detection.  this:', this);
    if (['dnd5e', 'sw5e'].includes(game.system.id)) {
        sys = SystemAccess5e;
    } else {
        ui.notifications.error('Encounter RTV only supports D&D 5e and sw5e at this time.');
    }
});
class SystemAccess5e {
    static getActorAC = actor => actor.system.attributes.ac.value;
    static getActorHP = actor => actor.system.attributes.hp.value;
    static getActorAttacks = actor => actor.items.filter(i => i.hasAttack && i.hasDamage);
    static toHitAsNumber = toHit => Number(toHit.replace(' ', '')); // e.g. "+ 5" becomes 5

    static isCantrip(attack) {
        let mode = attack.system?.scaling?.mode
        // 5e uses "cantrip" here; sw5e uses "atwill"
        return mode === 'atwill' || mode === 'cantrip';
    }

    static attackCasterLevel(attack) {
        let ret = attack.curAdvancementCharLevel; // sw5e
        if (ret === undefined) {
            ret = attack.parent.system.details.level; // 5e
        }
        return ret;
    }

    /**
     * If the attack is a cantrip, adjust the damage based on the caster level.
     */
    static cantripDamageFormula(attack) {
        let casterLevel = sys.attackCasterLevel(attack);
        let damageFormula = attack.labels.damage;
        const cantripTiers = [
            {pred: l => l >= 17, dice: 4},
            {pred: l => l >= 11, dice: 3},
            {pred: l => l >=  5, dice: 2},
            {pred: l =>    true, dice: 1}
        ];
        for (let tier of cantripTiers) {
            if (tier.pred(casterLevel)) {
                let ret = damageFormula.replace( /\b1d([0-9]+)\b/, `${tier.dice}d$1`);
                log('getDamageFormula(attack): damageFormula, casterLevel, ret',
                    attack, damageFormula, casterLevel, ret
                );
                return ret;
            }
        }
    }

    /**
     * Pulls the damage formula out of the attack
     * and adjusts it for cantrip scaling when appropriate.
     */
    static getDamageFormula(attack) {
        if (sys.isCantrip(attack)) {
            return sys.cantripDamageFormula(attack);
        }
        return attack.labels.damage;
    }

    /**
     * Average DPR of attacks against the weighted AC of the opposing force
     */
    static attackDPR(attack, targetAC) {
        let hp = hitProb(attack.labels.toHit, targetAC);
        let damageFormula = sys.getDamageFormula(attack);
        let ad = avgDamage(damageFormula);
        let result = hp * ad;
        return result;
    };

    /**
     * Returns the best multiattack item in the inventory of the given actor.
     * For NPCs, this is their Multiattack feature.
     * For PCs, this is Master of Combat, Greater Extra Attack, or Extra Attack,
     * in descending order of preference.
     */
    static getActorMultiattack(actor) {
        let npcMA = actor.items.find(i => i.name === 'Multiattack');
        if (npcMA) {
            log('<<selectedActorMultiattack: npcMA', npcMA);
            return npcMA;
        }
        for (let s of ['Master of Combat', 'Greater Extra Attack', 'Extra Attack']) {
            let pcMA = actor.items.find(i => i.name === s);
            if (pcMA) {
                log('<<selectedActorMultiattack: pcMA', pcMA);
                return pcMA;
            }
        }
    }
}
sys = SystemAccess5e;

/** how many of each attack an actor makes, keyed by actor name
 * TODO: Change key to actor ID
 * { actorName: {
 *      attackID: Map(
 *          attack: Item5e
 *          count: Number,
 *      )
 * }
 */
class AttackCounts extends Map {
}

/**
 * Base class for squads; derived into classes for specific systems.
 */
class Squad {
    constructor(actors) {
        this.actors = actors;
        // Reference to opposing squad.  Set after construction of both squads.
        this.opp = undefined;
        this.attackCounts = new AttackCounts();
    }

    get hp() {
        log('squad.hp; this:', this);
        return sum(this.actors.map(sys.getActorHP));
    }
    get avgAC() {
        return this.actors ? average(this.actors.map(sys.getActorAC)) : 0;
    }
    get weightedAC() {
        let actorWeightedAC = actor => sys.getActorAC(actor) * sys.getActorHP(actor) / this.hp;
        return this.actors ? sum(this.actors.map(actorWeightedAC)) : 0;
    }
    get dpr() {
        this.initializeAttackCounts();
        return sum(this.actors.map(actor => {
            // calculate total DPR of all each actor's attacks
            let attackCounts = this.attackCounts.get(actor.name);
            if (attackCounts === undefined) {
                return 0;
            }
            return sum(Array.from(attackCounts.values(), attack =>
                attack.count * sys.attackDPR(attack.attack, this.opp.weightedAC)
            ));
        }));
    }
    get rtv() {
        return this.opp.hp / this.dpr;
    }

    getActorAttackCounts(actor) {
        return this.attackCounts.get(actor.name);
    }

    // set initial attack counts for new actors
    initializeAttackCounts() {
        let oppAC = this.opp.weightedAC;
        this.actors.forEach(actor => {
            if (this.attackCounts.has(actor.name)) {
                // if we've already done this, leave things as they are
                return;
            }

            let actorAttackCounts = new Map();
            this.attackCounts.set(actor.name, actorAttackCounts);

            let attacks = sys.getActorAttacks(actor);
            if (attacks.length === 0) {
                // if the actor has no attacks, their entry in this.attackCounts remains an empty map
                return;
            }

            // Check if the actor has a multiattack which matches a heuristic regex
            // TODO: add heuristic regex matching for multiattacks

            // otherwise we set the count to 1 for the highest DPR attack and to 0 for others
            let highestDPRAttack = attacks.reduce(
                (a1, a2) => sys.attackDPR(a1, oppAC) > sys.attackDPR(a2, oppAC) ? a1 : a2
            );
            attacks.forEach(attack => actorAttackCounts.set(attack._id, {
                attack: attack,
                count: attack === highestDPRAttack? 1 : 0
            }));
        });
    }
}

/**
 * Base class for calculations culminating in RTV.
 * Inherited by classes which handle specific systems.
 */
export default class CalcRTV {
    /**
     * Parameters: `allies` and `opponents` arrays from the application
     */
    constructor(allies, opponents) {
        this.allies = new Squad(allies);
        this.opponents = new Squad(opponents);
        this.allies.opp = this.opponents;
        this.opponents.opp = this.allies;
    }

    /**
     * Returns the Squad object corresponding to the passed array of actors
     */
    getSquad(actors) {
        return [this.allies, this.opponents].find(s => s.actors === actors);
    }
}

export class CalcRTV5e extends CalcRTV {
    constructor(allies, opponents) {
        this.allies = new Squad5e(allies);
        this.opponents = new Squad5e(opponents);
        this.allies.opp = this.opponents;
        this.opponents.opp = this.allies;
    }
}

export class RTVSelection {
    constructor(actorName, squad) {
        log('RTVSelection constructor; this, actorName, squad:', this, actorName, squad);
        this.name = actorName;
        this.actor = squad.actors.find(e => e.name === actorName);
        this.squad = squad;
    }

    get hp() {
        return sys.getActorHP(this.actor);
    }
    get ac() {
        return sys.getActorAC(this.actor);
    }
    get attacks() {
        return sys.getActorAttacks(this.actor).map(a => ({
            _attack: a,
            name: a.name,
            dpr: sys.attackDPR(a, this.squad.opp.weightedAC),
        }));
    }
    get multiattack() {
        return sys.getActorMultiattack(this.actor);
    }
}
