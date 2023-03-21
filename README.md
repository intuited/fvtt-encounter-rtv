## 5E Encounter RTV

**Version**: 0.1.0

**Author**: [Ted Tibbetts][tt]

**Source Repository**: [github][gh]

### Description
Encounter RTV is a simulation-based encounter balancing module.  Drag-drop in actors,
and it will calculate average Damage Per Round and Rounds To Victory for both squads.
The idea is not to entirely predict which side will win,
but to give the GM a baseline estimate of what will happen if no limited resources are used.

### Compatibility
* Foundry: Tested on v. 10.291
* D&D 5e:  Tested with system version 2.1.5
* sw5e:    Tested with system version 2.0.3.2.3.8

### Screenshots

<img width="383" alt="D&D party about to be taken down by some bandits" src="https://user-images.githubusercontent.com/117202/226735688-901c98bc-de6c-4f37-ac79-fba62ab63df6.png">

The first screenshot is of an encounter being set up in a D&D game.  The Allies' Rounds To Victory is much higher than that of the opponents, indicating that they are fated to lose unless they do something extremely clever.

<img width="383" alt="sw5e encounter where the party stands a chance of victory" src="https://user-images.githubusercontent.com/117202/226736678-dc7ab94e-b2f5-491f-af95-57069cb92770.png">

In the second screenshot, the encounter is more balanced.  Here we see that Ima-Gun Liv has only a slightly higher Rounds to Victory than his opponents, and will likely be able to win if he makes judicious use of limited resources like leveled spells (technically "powers" in sw5e).  Typically this sort of balance is what GMs will aim for in their encounters, forcing their players to use special features in order to succeed.  Of course, this depends on factors like party composition and encounters per long rest.  The goal of Encounter RTV is to give an idea of the baseline damage capacity of each squad, not to simulate an entire encounter.

### Functionality
- Actors can be dragged in to either squad from the Actors tab, from compendiums, or from other sources like [Quick Insert][qi].
- It's also possible to drag in a folder of actors.
- For each squad, the weighted AC is calculated.  This is sum of the ACs of each squad member multiplied by the member's proportion of the total squad HP.
- Encounter RTV will use each actor's attack or cantrip with the highest DPR against enemy weighted AC.
- Attack counts are common to all instances of a given actor for that squad. E.G. if you add 3 Scouts to the Opponents squad and give them 2 Longbow attacks, all 3 will use that attack count.
- Currently, weapon attacks and attack cantrips ("at-will powers" in sw5e) are considered for autoselection.  Leveled attack spells are listed but are always given an attack count of 0.
- Multiattack features are displayed, but do not currently affect attack counts.
- The **Remove** button will remove one instance of the selected actor from that squad.  E.G. if you have 3 Scouts and 1 Bandit in a squad, selecting a Scout and clicking Remove will remove 1 Scout.
- Actors can also be dragged from the RTV window to the canvas.

### Credit
The UI code was largely lifted from [Encounter Builder for 5e][eb5e].
If you're interested in a CR-based approach to encounter balancing, check out that module!

### Installation

Use the green Code dropdown in [github][gh] to choose your preferred download method.
Place the code in your `foundrydata` directory at `Data/modules/encounter-rtv`.

### Upcoming features
These features will be added in an upcoming release.
- Inclusion of save-based cantrips in DPR calculations
- Multiattack heuristics to set attack counts properly for PC and some NPCs
- Ability to modify to-hit and damage formulae for individual attacks

[tt]: https://github.com/intuited
[qi]: https://foundryvtt.com/packages/quick-insert
[eb5e]: https://foundryvtt.com/packages/encounter-builder-5e/
[gh]: https://github.com/intuited/fvtt-encounter-rtv
