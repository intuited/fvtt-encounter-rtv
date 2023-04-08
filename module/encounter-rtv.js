const MODULE_ID = 'encounter-rtv';
import EncounterRTVApplication from './rtv-form.js';
import log from './log.js';

function getSceneControlButtons(buttons) {
    log('getSceneControlButtons; buttons:', buttons);
    let tokenButton = buttons.find(b => b.name === "token");

    if (tokenButton && game.user.isGM) {
        tokenButton.tools.push({
            name: "encounter-rtv",
            title: game.i18n.localize('EB.Title'),
            icon: "fas fa-crown",
            visible: game.user.isGM,
            onClick: () => onClickToolbarButton(),
        });
    }
}

var form = undefined

function onClickToolbarButton() {
    if (form === undefined) {
        form = new EncounterRTVApplication(game.actors);
    }
    form.render(true);
}

Hooks.on('getSceneControlButtons', getSceneControlButtons);
