require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { REST, Routes } = require("discord.js");
const config = require("../src/utils/config");
const log = require("../src/services/logger");
const commands = require("../src/commands");

if (!config.CLIENT_ID) {
    log.error(
        `CLIENT_ID obrigatorio para deploy de comandos no perfil ${config.PROFILE_NAME}. Preencha ${config.ACTIVE_PROFILE_PREFIX}_CLIENT_ID.`
    );
    process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(config.BOT_TOKEN);

(async () => {
    try {
        log.info(
            `Registrando ${commands.length} comando(s) na guild ${config.SERVER_ID} (${config.PROFILE_NAME}).`
        );
        const data = await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, config.SERVER_ID), {
            body: commands,
        });
        log.ok(`${data.length} comando(s) registrado(s) com sucesso.`);
    } catch (error) {
        log.error("Erro ao registrar comandos:", error.message);
        process.exit(1);
    }
})();
