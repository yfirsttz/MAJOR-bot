const config = require("../utils/config");
const { readJson, saveJson } = require("../utils/jsonStore");
const { buildQueueSnapshotFromPayload } = require("../utils/queuePayload");
const messages = require("../ui/messages");
const log = require("./logger");

const STATE_FILE = "smart_ping_state";
const FETCH_LIMIT = 25;
const RETRY_DELAY_MS = 1_000;
const MAX_RETRIES = 3;

let state = {
    qualified: false,
    lastPingAt: null,
    lastParsedMessageId: null,
    lastSignature: null,
    lastObservedQueue: null,
    ...readJson(STATE_FILE, {}),
};

function saveState() {
    saveJson(STATE_FILE, state);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectMessageText(message) {
    const parts = [message.content];

    for (const embed of message.embeds || []) {
        parts.push(embed.title, embed.description);

        for (const field of embed.fields || []) {
            parts.push(field.name, field.value);
        }
    }

    return parts.filter(Boolean).join("\n");
}

function messageMatchesActiveQueue(text) {
    if (!config.QUEUE_NAME) {
        return true;
    }

    return String(text || "").toLowerCase().includes(config.QUEUE_NAME.toLowerCase());
}

function parseQueueSnapshot(message) {
    if (!message || message.author?.id !== config.NEATQUEUE_BOT_ID) {
        return null;
    }

    const text = collectMessageText(message);
    if (!messageMatchesActiveQueue(text)) {
        return null;
    }

    const gkMatch = text.match(/GK\s+(\d+)\s*\/\s*(\d+)/i);
    const lineMatch = text.match(/LINHA\s+(\d+)\s*\/\s*(\d+)/i);

    if (!gkMatch || !lineMatch) {
        return null;
    }

    const gkCount = Number(gkMatch[1]);
    const gkSlots = Number(gkMatch[2]);
    const lineCount = Number(lineMatch[1]);
    const lineSlots = Number(lineMatch[2]);

    if ([gkCount, gkSlots, lineCount, lineSlots].some((value) => Number.isNaN(value))) {
        return null;
    }

    return {
        messageId: message.id,
        gkCount,
        gkSlots,
        lineCount,
        lineSlots,
        totalPlayers: gkCount + lineCount,
        totalSlots: gkSlots + lineSlots,
        rawText: text,
    };
}

async function getQueueChannel(client) {
    return client.channels.cache.get(config.QUEUE_CHANNEL_ID)
        ?? (await client.channels.fetch(config.QUEUE_CHANNEL_ID).catch(() => null));
}

async function findLatestQueueSnapshot(client, expectedTotalPlayers = null) {
    const channel = await getQueueChannel(client);
    if (!channel || !channel.isTextBased()) {
        log.warn(`Canal da fila nao encontrado: ${config.QUEUE_CHANNEL_ID}`);
        return null;
    }

    let latestSnapshot = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        const recentMessages = await channel.messages.fetch({ limit: FETCH_LIMIT }).catch(() => null);
        if (!recentMessages) {
            return null;
        }

        for (const message of recentMessages.values()) {
            const snapshot = parseQueueSnapshot(message);
            if (!snapshot) {
                continue;
            }

            latestSnapshot = snapshot;
            if (expectedTotalPlayers == null || snapshot.totalPlayers === expectedTotalPlayers) {
                return snapshot;
            }
        }

        if (attempt < MAX_RETRIES - 1 && expectedTotalPlayers != null) {
            await wait(RETRY_DELAY_MS);
        }
    }

    return latestSnapshot;
}

function getTargetRoleIds(queueSnapshot) {
    const roleIds = queueSnapshot.gkCount >= 1
        ? [...config.ROLES_MAJOR, ...config.ROLES_TEST_MAJOR]
        : [
            ...config.ROLES_MAJOR,
            ...config.ROLES_TEST_MAJOR,
            ...config.ROLES_GKMAJOR,
            ...config.ROLES_TEST_GKMAJOR,
        ];

    return [...new Set(roleIds)];
}

async function sendSmartPing(client, queueSnapshot, roleIds) {
    const channel = await getQueueChannel(client);
    if (!channel || !channel.isTextBased()) {
        log.warn("Nao foi possivel enviar smart ping; canal da fila indisponivel.");
        return null;
    }

    const payload = messages.buildSmartPingMessage(queueSnapshot, roleIds);
    return channel.send(payload).catch((error) => {
        log.error("Erro ao enviar smart ping:", error.message);
        return null;
    });
}

function resetSmartPingState(reason = "") {
    const wasQualified = state.qualified;

    state = {
        ...state,
        qualified: false,
        lastParsedMessageId: null,
        lastSignature: null,
        lastObservedQueue: null,
    };

    saveState();

    if (wasQualified) {
        log.info(`Smart ping resetado${reason ? `: ${reason}` : ""}`);
    }
}

async function evaluateSmartPing(client, options = {}) {
    if (!config.SMART_PING_ENABLED) {
        return;
    }

    const expectedTotalPlayers = options.expectedTotalPlayers ?? null;
    const payloadSnapshot = buildQueueSnapshotFromPayload(options.payload);
    const messageSnapshot = await findLatestQueueSnapshot(client, expectedTotalPlayers);
    let snapshot = messageSnapshot;

    if (
        expectedTotalPlayers != null
        && messageSnapshot
        && messageSnapshot.totalPlayers !== expectedTotalPlayers
        && payloadSnapshot
    ) {
        log.warn(
            `Mensagem da fila ainda em ${messageSnapshot.totalPlayers}/${messageSnapshot.totalSlots}; usando payload do webhook com ${payloadSnapshot.totalPlayers}/${payloadSnapshot.totalSlots}.`
        );
        snapshot = payloadSnapshot;
    } else if (!snapshot && payloadSnapshot) {
        log.warn("Mensagem da fila nao encontrada; usando payload do webhook para smart ping.");
        snapshot = payloadSnapshot;
    }

    if (!snapshot) {
        log.debug("Nenhuma mensagem de fila parseavel encontrada para smart ping.");
        return;
    }

    state.lastObservedQueue = snapshot;

    if (snapshot.totalPlayers < config.SMART_PING_MIN_PLAYERS) {
        resetSmartPingState(`fila abaixo do minimo (${snapshot.totalPlayers}/${config.SMART_PING_MIN_PLAYERS})`);
        return;
    }

    const targetRoleIds = getTargetRoleIds(snapshot);
    const signature = `${snapshot.gkCount}:${snapshot.lineCount}:${targetRoleIds.join(",")}`;
    const cooldownActive =
        state.qualified &&
        state.lastPingAt != null &&
        Date.now() - state.lastPingAt < config.SMART_PING_COOLDOWN_MS;

    if (state.qualified && cooldownActive) {
        state.lastParsedMessageId = snapshot.messageId;
        state.lastSignature = signature;
        saveState();
        log.info(
            `Smart ping em cooldown (${config.SMART_PING_COOLDOWN_SECONDS}s) para ${snapshot.totalPlayers}/${snapshot.totalSlots}.`
        );
        return;
    }

    const sentMessage = await sendSmartPing(client, snapshot, targetRoleIds);
    if (!sentMessage) {
        return;
    }

    state = {
        ...state,
        qualified: true,
        lastPingAt: Date.now(),
        lastParsedMessageId: snapshot.messageId,
        lastSignature: signature,
        lastObservedQueue: snapshot,
    };
    saveState();

    log.ok(
        `Smart ping enviado (${options.reason || "manual"}) para ${snapshot.totalPlayers}/${snapshot.totalSlots} | GK ${snapshot.gkCount}/${snapshot.gkSlots} | LINHA ${snapshot.lineCount}/${snapshot.lineSlots}`
    );
}

module.exports = {
    evaluateSmartPing,
    resetSmartPingState,
};
