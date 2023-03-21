class EncounterRTV {
    static getSceneControlButtons(buttons) {
        let tokenButton = buttons.find(b => b.name === "token");

        if (tokenButton && game.user.isGM) {
            tokenButton.tools.push({
                name: "encounter-rtv",
                title: game.i18n.localize('EB.Title'),
                icon: "fas fa-crown",
                visible: game.user.isGM,
                onClick: () => EncounterRTV.openForm()
            });
        }
    }

    static openForm() {
        if (this.form === undefined) {
            this.form = new EncounterRTVApplication(game.actors);
        }
        this.form.render(true);
    }
}
Hooks.on('getSceneControlButtons', EncounterRTV.getSceneControlButtons);
