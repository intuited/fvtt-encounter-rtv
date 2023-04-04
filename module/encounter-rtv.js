const MODULE_ID = 'encounter-rtv';
import EncounterRTVApplication from './rtv-form.js';

console.log('================================yooooo===========================');

Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(MODULE_ID);
});

const devModeActive = () => game.modules.get('_dev-mode')?.api?.getPackageDebugValue(MODULE_ID);

function log(...args) {
    try {
        // if(game.modules.get('_dev-mode')?.api?.getPackageDebugValue(MODULE_ID)) {
        if (devModeActive()) {
            console.log(MODULE_ID, '|', ...args);
        }
    } catch (e) {}
}
function logForce(...args) {
    console.log(MODULE_ID, '|', ...args);
}

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
