require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { REST, Routes } = require("discord.js");
const config = require("../src/utils/config");
const log = require("../src/services/logger");

if (!config.CLIENT_ID) {
    log.error(
        `CLIENT_ID obrigatorio para limpar comandos globais no perfil ${config.PROFILE_NAME}. Preencha ${config.ACTIVE_PROFILE_PREFIX}_CLIENT_ID.`
    );
    process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(config.BOT_TOKEN);

(async () => {
    try {
        log.info(`Limpando comandos globais do aplicativo ${config.CLIENT_ID} (${config.PROFILE_NAME}).`);
        await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: [] });
        log.ok("Comandos globais removidos.");
    } catch (error) {
        log.error("Erro ao limpar comandos globais:", error.message);
        process.exit(1);
    }
})();
