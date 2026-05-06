require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Partials,
} = require("discord.js");
const { initDb } = require("./src/database/create");
const config = require("./src/utils/config");
const log = require("./src/services/logger");
const messages = require("./src/ui/messages");
const { startWebhookServer } = require("./src/services/webhook");
const { checkAutoForceStartTimer } = require("./src/services/forceStart");
const { evaluateSmartPing } = require("./src/services/rolePing");
const { registerQueueWatcher, evaluateLatestQueueMessage } = require("./src/services/queueWatcher");
const { registerResultAuditWatcher } = require("./src/services/resultAudit");
const { checkAllPendingPolls, restorePendingPolls, registerPollInteractionHandler } = require("./src/services/polls");
const { checkPlayers } = require("./src/services/playerWatcher");

const PLAYER_CHECK_INTERVAL_MS = 60_000;
const POLL_CHECK_INTERVAL_MS = 60_000;
const FORCESTART_TIMER_CHECK_MS = 5_000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
});

module.exports = { client };

registerResultAuditWatcher(client);
registerQueueWatcher(client);
registerPollInteractionHandler(client);
startWebhookServer(client);
setInterval(() => {
    void checkAutoForceStartTimer(client);
}, FORCESTART_TIMER_CHECK_MS);

client.once("clientReady", async () => {
    try {
        await initDb();

        log.ok(`Bot online como ${client.user.tag}`);
        log.info(`PROFILE=${config.PROFILE_NAME}`);
        log.info(`DEBUG_MODE=${config.DEBUG_MODE}`);
        log.info(`SERVER_ID=${config.SERVER_ID}`);
        log.info(`CHANNEL_ID=${config.CHANNEL_ID}`);
        log.info(`QUEUE_CHANNEL_ID=${config.QUEUE_CHANNEL_ID}`);
        log.info(`RESULTS_CHANNEL_ID=${config.RESULTS_CHANNEL_ID}`);
        log.info(`AUTO_FORCESTART_ENABLED=${config.AUTO_FORCESTART_ENABLED}`);
        log.info(`SMART_PING_ENABLED=${config.SMART_PING_ENABLED}`);
        log.info(`RESULT_AUDIT_ENABLED=${config.RESULT_AUDIT_ENABLED}`);

        const guild =
            client.guilds.cache.get(config.SERVER_ID) ??
            (await client.guilds.fetch(config.SERVER_ID).catch(() => null));
        const channel =
            client.channels.cache.get(config.CHANNEL_ID) ??
            (await client.channels.fetch(config.CHANNEL_ID).catch(() => null));
        const startupChannel =
            client.channels.cache.get(config.STARTUP_CHANNEL_ID) ??
            (await client.channels.fetch(config.STARTUP_CHANNEL_ID).catch(() => null));

        if (!guild) {
            throw new Error(`Servidor nao encontrado: ${config.SERVER_ID}`);
        }

        if (!channel || !channel.isTextBased()) {
            throw new Error(`Canal principal nao encontrado ou invalido: ${config.CHANNEL_ID}`);
        }

        if (startupChannel?.isTextBased()) {
            await startupChannel.send(messages.startup()).catch((error) => {
                log.warn("Falha ao enviar mensagem de startup:", error.message);
            });
        }

        await restorePendingPolls(client);
        await evaluateSmartPing(client, { reason: "startup" });
        await evaluateLatestQueueMessage(client, "startup-queue-watch");
        await checkPlayers(client, guild, channel);

        setInterval(() => {
            void checkPlayers(client, guild, channel);
        }, PLAYER_CHECK_INTERVAL_MS);

        setInterval(() => {
            void checkAllPendingPolls(client);
        }, POLL_CHECK_INTERVAL_MS);
    } catch (error) {
        log.error("Falha durante a inicializacao do bot:", error.stack || error.message || error);
        process.exit(1);
    }
});

client.login(config.BOT_TOKEN).catch((error) => {
    log.error(`Erro ao logar no Discord: ${error.message}`);
    process.exit(1);
});
