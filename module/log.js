const MODULE_ID = 'encounter-rtv';

Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(MODULE_ID);
    log('log devModeReady hook: this, registerPackageDebugFlag', this, registerPackageDebugFlag);
});

const devModeActive = () => game.modules.get('_dev-mode')?.api?.getPackageDebugValue(MODULE_ID);

export default function log(...args) {
    try {
        if (devModeActive()) {
            console.log(MODULE_ID, '|', ...args);
        }
    } catch (e) {}
}
export function logForce(...args) {
    console.log(MODULE_ID, '|', ...args);
}
