const config = require("../utils/config");
const { processQueueCount } = require("./forceStart");
const {
    evaluateSmartPing,
    findLatestQueueSnapshot,
    parseQueueSnapshot,
} = require("./rolePing");
const log = require("./logger");

const QUEUE_WATCH_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 1_500;

let watcherRegistered = false;
let debounceTimer = null;

async function materializeMessage(message) {
    if (!message?.partial) {
        return message;
    }

    return message.fetch().catch(() => null);
}

function isQueueMessage(message) {
    return message?.channelId === config.QUEUE_CHANNEL_ID
        && message.author?.id === config.NEATQUEUE_BOT_ID;
}

function buildQueuePayload(reason) {
    return {
        guild: config.SERVER_ID,
        channel: config.QUEUE_CHANNEL_ID,
        queue: config.QUEUE_NAME,
        source: reason,
    };
}

async function processQueueSnapshot(client, snapshot, reason) {
    if (!snapshot) {
        log.debug(`Nenhuma mensagem de fila parseavel encontrada (${reason}).`);
        return;
    }

    log.queue(
        `Fila observada (${reason}): ${snapshot.totalPlayers}/${snapshot.totalSlots} | GK ${snapshot.gkCount}/${snapshot.gkSlots} | LINHA ${snapshot.lineCount}/${snapshot.lineSlots}`
    );

    if (config.AUTO_FORCESTART_ENABLED) {
        await processQueueCount(client, snapshot.totalPlayers, buildQueuePayload(reason));
    }

    if (config.SMART_PING_ENABLED) {
        await evaluateSmartPing(client, {
            reason,
            expectedTotalPlayers: snapshot.totalPlayers,
            snapshot,
        });
    }
}

async function evaluateLatestQueueMessage(client, reason) {
    const snapshot = await findLatestQueueSnapshot(client);
    await processQueueSnapshot(client, snapshot, reason);
}

async function handleQueueMessage(client, message, reason) {
    const fullMessage = await materializeMessage(message);
    if (!isQueueMessage(fullMessage)) {
        return;
    }

    const snapshot = parseQueueSnapshot(fullMessage);
    if (snapshot) {
        await processQueueSnapshot(client, snapshot, reason);
        return;
    }

    await evaluateLatestQueueMessage(client, reason);
}

function scheduleLatestQueueCheck(client, reason) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        void evaluateLatestQueueMessage(client, reason);
    }, DEBOUNCE_MS);
}

function registerQueueWatcher(client) {
    if (watcherRegistered || !config.WEBHOOK_FEATURES_ENABLED) {
        return;
    }

    watcherRegistered = true;

    client.on("messageCreate", (message) => {
        void handleQueueMessage(client, message, "discord-message-create");
    });

    client.on("messageUpdate", (_oldMessage, newMessage) => {
        void handleQueueMessage(client, newMessage, "discord-message-update");
    });

    setInterval(() => {
        scheduleLatestQueueCheck(client, "discord-poll");
    }, QUEUE_WATCH_INTERVAL_MS);

    log.info(`Watcher da fila via Discord ativo a cada ${QUEUE_WATCH_INTERVAL_MS / 1_000}s.`);
}

module.exports = {
    evaluateLatestQueueMessage,
    registerQueueWatcher,
};
