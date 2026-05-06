const config = require("../utils/config");
const { readJson, saveJson } = require("../utils/jsonStore");
const messages = require("../ui/messages");
const { triggerForceStart } = require("./neatqueue");
const log = require("./logger");

const STATE_FILE = "queue_watch_state";

let state = {
    watching: false,
    watchedSince: null,
    lastKnownCount: 0,
    lastQueue: null,
    lastChannel: null,
    timerEndsAt: null,
    forcestartTriggeredAt: null,
    ...readJson(STATE_FILE, {}),
};

let lastNotificationMessageId = null;

function normalizeQueueName(value) {
    return String(value || "").trim().toLowerCase();
}

function getPayloadQueueName(payload) {
    if (typeof payload?.queue === "string" || typeof payload?.queue === "number") {
        return payload.queue;
    }

    return payload?.queue?.name ?? payload?.queue_name ?? payload?.data?.queue ?? "";
}

function saveState() {
    saveJson(STATE_FILE, state);
}

function isTargetQueue(payload) {
    if (!payload) {
        return false;
    }

    const receivedGuild = String(payload.guild || "").trim();
    const receivedChannel = String(payload.channel || "").trim();

    if (receivedGuild && receivedGuild !== config.SERVER_ID) {
        return false;
    }

    if (receivedChannel && receivedChannel !== config.QUEUE_CHANNEL_ID) {
        return false;
    }

    if (receivedChannel && receivedChannel === config.QUEUE_CHANNEL_ID) {
        return true;
    }

    if (config.QUEUE_NAME) {
        const expectedQueue = normalizeQueueName(config.QUEUE_NAME);
        const receivedQueue = normalizeQueueName(getPayloadQueueName(payload));

        if (receivedQueue && receivedQueue !== expectedQueue) {
            return false;
        }
    }

    return true;
}

async function clearLastNotification(client) {
    if (!lastNotificationMessageId) {
        return;
    }

    try {
        const channel = client.channels.cache.get(config.AUTO_FORCESTART_NOTIFY_CHANNEL_ID)
            ?? (await client.channels.fetch(config.AUTO_FORCESTART_NOTIFY_CHANNEL_ID).catch(() => null));

        const message = await channel?.messages.fetch(lastNotificationMessageId).catch(() => null);
        if (message) {
            await message.delete().catch(() => null);
        }
    } catch (error) {
        log.warn("Falha ao limpar notificacao anterior do AutoForceStart:", error.message);
    } finally {
        lastNotificationMessageId = null;
    }
}

async function sendNotification(client, content) {
    try {
        const channel = client.channels.cache.get(config.AUTO_FORCESTART_NOTIFY_CHANNEL_ID)
            ?? (await client.channels.fetch(config.AUTO_FORCESTART_NOTIFY_CHANNEL_ID).catch(() => null));

        if (!channel || !channel.isTextBased()) {
            log.warn("Canal de notificacao do AutoForceStart nao encontrado.");
            return;
        }

        await clearLastNotification(client);

        if (!content) {
            return;
        }

        const sentMessage = await channel.send(content);
        lastNotificationMessageId = sentMessage.id;
    } catch (error) {
        log.warn("Falha ao enviar notificacao do AutoForceStart:", error.message);
    }
}

async function resetAutoForceStartWatcher(client, reason = "") {
    const wasWatching = state.watching;

    state = {
        ...state,
        watching: false,
        watchedSince: null,
        lastKnownCount: 0,
        lastQueue: null,
        lastChannel: null,
        timerEndsAt: null,
    };

    saveState();

    if (wasWatching) {
        log.info(`AutoForceStart resetado${reason ? `: ${reason}` : ""}`);
    }

    if (client) {
        await clearLastNotification(client);
    }
}

async function processQueueCount(client, totalPlayers, payload) {
    if (!config.AUTO_FORCESTART_ENABLED) {
        return;
    }

    if (!isTargetQueue(payload)) {
        log.debug("Payload ignorado pelo AutoForceStart; fila diferente.");
        return;
    }

    state.lastKnownCount = totalPlayers;
    state.lastQueue = payload?.queue ?? null;
    state.lastChannel = payload?.channel ?? null;

    log.queue(`Queue update: ${totalPlayers}/${config.FULL_PLAYERS} (target ${config.TARGET_PLAYERS})`);

    if (totalPlayers === config.TARGET_PLAYERS) {
        if (!state.watching) {
            const now = Date.now();
            state.watching = true;
            state.watchedSince = now;
            state.timerEndsAt = now + config.AUTO_FORCESTART_DELAY_MS;
            saveState();

            log.force(`AutoForceStart armado em ${config.TARGET_PLAYERS}/${config.FULL_PLAYERS}`);
            await sendNotification(client, messages.forceStartArmed());
        } else {
            saveState();
        }

        return;
    }

    if (state.watching) {
        const reason =
            totalPlayers >= config.FULL_PLAYERS
                ? `fila encheu (${totalPlayers}/${config.FULL_PLAYERS})`
                : `fila mudou para ${totalPlayers}/${config.FULL_PLAYERS}`;
        await resetAutoForceStartWatcher(client, reason);
    } else {
        saveState();
    }
}

async function triggerAutoForceStart(client, reason = "") {
    if (!config.AUTO_FORCESTART_ENABLED) {
        return;
    }

    const now = Date.now();
    if (state.forcestartTriggeredAt && now - state.forcestartTriggeredAt < 60_000) {
        log.warn("Forcestart ignorado para evitar duplicidade em menos de 60s.");
        return;
    }

    try {
        log.force(`Disparando forcestart: ${reason}`);
        const response = await triggerForceStart();

        if (response.status >= 200 && response.status < 300) {
            state.forcestartTriggeredAt = now;
            saveState();
            await sendNotification(client, messages.forceStartSent());
        } else {
            await sendNotification(client, messages.forceStartError(response.status));
        }
    } catch (error) {
        log.error("Erro ao disparar forcestart:", error.message);
        await sendNotification(client, messages.forceStartFailed());
    } finally {
        await resetAutoForceStartWatcher(client, "forcestart executado ou tentado");
    }
}

async function checkAutoForceStartTimer(client) {
    if (!config.AUTO_FORCESTART_ENABLED || !state.watching || !state.timerEndsAt) {
        return;
    }

    const remainingMs = state.timerEndsAt - Date.now();
    if (remainingMs > 0) {
        if (remainingMs <= 10_000) {
            log.info(`AutoForceStart em contagem final: ${Math.ceil(remainingMs / 1000)}s`);
        }

        return;
    }

    await triggerAutoForceStart(
        client,
        `Permaneceu em ${config.TARGET_PLAYERS}/${config.FULL_PLAYERS} por ${config.AUTO_FORCESTART_DELAY_SECONDS}s`
    );
}

module.exports = {
    isTargetQueue,
    processQueueCount,
    triggerAutoForceStart,
    checkAutoForceStartTimer,
    resetAutoForceStartWatcher,
};
