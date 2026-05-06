const config = require("../utils/config");
const {
    getSmartPingCooldownMs,
    getSmartPingCooldownSeconds,
} = require("../utils/smartPingSettings");
const { readJson, saveJson } = require("../utils/jsonStore");
const { buildQueueSnapshotFromPayload } = require("../utils/queuePayload");
const messages = require("../ui/messages");
const log = require("./logger");

const STATE_FILE = "smart_ping_state";
const FETCH_LIMIT = 100;
const PING_CLEANUP_FETCH_LIMIT = 100;
const RETRY_DELAY_MS = 1_000;
const MAX_RETRIES = 3;

let smartPingEvaluationQueue = Promise.resolve();

let state = {
    qualified: false,
    lastPingAt: null,
    lastPingMessageId: null,
    lastPingChannelId: null,
    lastParsedMessageId: null,
    lastSignature: null,
    lastObservedQueue: null,
    ...readJson(STATE_FILE, {}),
};

function saveState() {
    saveJson(STATE_FILE, state);
}

function clearLastPingMessageReference() {
    state.lastPingMessageId = null;
    state.lastPingChannelId = null;
    saveState();
}

function getConfiguredSmartPingRoleIds() {
    return new Set([
        ...config.ROLES_MAJOR,
        ...config.ROLES_TEST_MAJOR,
        ...config.ROLES_GKMAJOR,
        ...config.ROLES_TEST_GKMAJOR,
    ]);
}

function getOnlyMentionedRoleIds(content) {
    const text = String(content || "").trim();
    const roleIds = [...text.matchAll(/<@&(\d+)>/g)].map((match) => match[1]);
    const textWithoutMentions = text.replace(/<@&\d+>/g, "").trim();

    return roleIds.length && !textWithoutMentions ? roleIds : [];
}

function isSmartPingMessage(message, client) {
    if (!message || message.author?.id !== client.user?.id) {
        return false;
    }

    const roleIds = getOnlyMentionedRoleIds(message.content);
    if (!roleIds.length) {
        return false;
    }

    const configuredRoleIds = getConfiguredSmartPingRoleIds();
    return roleIds.every((roleId) => configuredRoleIds.has(roleId));
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

    const normalizedText = String(text || "").toLowerCase();
    return normalizedText.includes(config.QUEUE_NAME.toLowerCase())
        || (/\b(gk|goleiro|goleiros|goalkeeper|goalkeepers)\b/i.test(normalizedText)
            && /\b(linha|linhas|line)\b/i.test(normalizedText));
}

function parseRoleCount(text, labels) {
    const labelPattern = labels.join("|");
    const normalizedLabels = new Set(labels.map((label) => String(label).toUpperCase()));
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const boundary = "[^A-Z0-9]";
    const labelRegex = new RegExp(`(?:^|${boundary})(?:[_*~\\s]*)(?:${labelPattern})(?:[_*~\\s]*)(?=${boundary}|$)`, "i");
    const countRegex = /(\d+)\s*\/\s*(\d+)/;
    const inlinePatterns = [
        new RegExp(`(?:^|${boundary})[_*~\\s]*(?:${labelPattern})[_*~\\s]*[:\\-]?\\s*(\\d+)\\s*\\/\\s*(\\d+)`, "i"),
        new RegExp(`(?:^|${boundary})(\\d+)\\s*\\/\\s*(\\d+)[_*~\\s]*(?:${labelPattern})(?:[_*~\\s]*)(?=${boundary}|$)`, "i"),
    ];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];

        for (const pattern of inlinePatterns) {
            const match = line.match(pattern);
            if (!match) {
                continue;
            }

            return {
                count: Number(match[1]),
                slots: Number(match[2]),
            };
        }

        const bareLabel = line.replace(/[_*~:.\-\s]/g, "").toUpperCase();
        if (labelRegex.test(line) && normalizedLabels.has(bareLabel)) {
            const nextLineMatch = lines[index + 1]?.match(countRegex);
            if (nextLineMatch) {
                return {
                    count: Number(nextLineMatch[1]),
                    slots: Number(nextLineMatch[2]),
                };
            }
        }
    }

    return null;
}

function parseQueueSnapshot(message) {
    if (!message || message.author?.id !== config.NEATQUEUE_BOT_ID) {
        return null;
    }

    const text = collectMessageText(message);
    if (!messageMatchesActiveQueue(text)) {
        return null;
    }

    const gkMatch = parseRoleCount(text, ["GK", "GOLEIRO", "GOLEIROS", "GOALKEEPER", "GOALKEEPERS"]);
    const lineMatch = parseRoleCount(text, ["LINHA", "LINHAS", "LINE"]);

    if (!gkMatch || !lineMatch) {
        return null;
    }

    const gkCount = gkMatch.count;
    const gkSlots = gkMatch.slots;
    const lineCount = lineMatch.count;
    const lineSlots = lineMatch.slots;

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

async function collectSmartPingMessages(client, currentChannel) {
    const messagesById = new Map();
    const channelIds = [
        currentChannel.id,
        state.lastPingChannelId,
    ].filter(Boolean);

    for (const channelId of [...new Set(channelIds)]) {
        const channel = channelId === currentChannel.id
            ? currentChannel
            : await client.channels.fetch(channelId).catch(() => null);

        if (!channel?.isTextBased()) {
            log.warn(`Nao foi possivel varrer smart pings antigos; canal indisponivel: ${channelId}`);
            continue;
        }

        const recentMessages = await channel.messages.fetch({ limit: PING_CLEANUP_FETCH_LIMIT }).catch((error) => {
            log.warn(`Falha ao buscar smart pings recentes em ${channelId}:`, error.message);
            return null;
        });

        for (const message of recentMessages?.values() || []) {
            if (isSmartPingMessage(message, client)) {
                messagesById.set(message.id, message);
            }
        }
    }

    if (state.lastPingMessageId) {
        const channelId = state.lastPingChannelId || currentChannel.id;
        const channel = channelId === currentChannel.id
            ? currentChannel
            : await client.channels.fetch(channelId).catch(() => null);

        const trackedMessage = await channel?.messages.fetch(state.lastPingMessageId).catch(() => null);
        if (trackedMessage && isSmartPingMessage(trackedMessage, client)) {
            messagesById.set(trackedMessage.id, trackedMessage);
        } else if (!trackedMessage) {
            log.info(`Smart ping anterior nao encontrado para apagar: ${state.lastPingMessageId}`);
            clearLastPingMessageReference();
        }
    }

    return [...messagesById.values()]
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
}

async function deleteSmartPingMessages(client, currentChannel, options = {}) {
    const messagesToCheck = await collectSmartPingMessages(client, currentChannel);
    let keepMessageId = options.keepMessageId || null;
    const keepMessageFound = keepMessageId
        && messagesToCheck.some((message) => message.id === keepMessageId);

    if (keepMessageId && !keepMessageFound && options.keepLatest) {
        keepMessageId = null;
    }

    if (!keepMessageId && options.keepLatest) {
        keepMessageId = messagesToCheck[0]?.id || null;

        if (keepMessageId) {
            state.lastPingMessageId = keepMessageId;
            state.lastPingChannelId = messagesToCheck[0].channelId;
            saveState();
        }
    }

    let deletedCount = 0;

    for (const message of messagesToCheck) {
        if (message.id === keepMessageId) {
            continue;
        }

        await message.delete().then(() => {
            deletedCount += 1;
            log.info(`Smart ping antigo apagado: ${message.id}`);
        }).catch((error) => {
            log.warn(`Falha ao apagar smart ping antigo ${message.id}:`, error.message);
        });
    }

    if (!keepMessageId && deletedCount > 0) {
        clearLastPingMessageReference();
    }

    return deletedCount;
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

    await deleteSmartPingMessages(client, channel);

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

async function evaluateSmartPingNow(client, options = {}) {
    if (!config.SMART_PING_ENABLED) {
        return;
    }

    const expectedTotalPlayers = options.expectedTotalPlayers ?? null;
    const payloadSnapshot = buildQueueSnapshotFromPayload(options.payload);
    const messageSnapshot = options.snapshot ?? await findLatestQueueSnapshot(client, expectedTotalPlayers);
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
    const cooldownMs = getSmartPingCooldownMs();
    const cooldownActive =
        state.qualified &&
        state.lastPingAt != null &&
        Date.now() - state.lastPingAt < cooldownMs;

    if (state.qualified && cooldownActive) {
        const channel = await getQueueChannel(client);
        if (channel?.isTextBased()) {
            await deleteSmartPingMessages(client, channel, {
                keepMessageId: state.lastPingMessageId,
                keepLatest: true,
            });
        }

        state.lastParsedMessageId = snapshot.messageId;
        state.lastSignature = signature;
        saveState();
        log.info(
            `Smart ping em cooldown (${getSmartPingCooldownSeconds()}s) para ${snapshot.totalPlayers}/${snapshot.totalSlots}.`
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
        lastPingMessageId: sentMessage.id,
        lastPingChannelId: sentMessage.channelId,
        lastParsedMessageId: snapshot.messageId,
        lastSignature: signature,
        lastObservedQueue: snapshot,
    };
    saveState();

    log.ok(
        `Smart ping enviado (${options.reason || "manual"}) para ${snapshot.totalPlayers}/${snapshot.totalSlots} | GK ${snapshot.gkCount}/${snapshot.gkSlots} | LINHA ${snapshot.lineCount}/${snapshot.lineSlots}`
    );
}

function evaluateSmartPing(client, options = {}) {
    const queuedEvaluation = smartPingEvaluationQueue.then(
        () => evaluateSmartPingNow(client, options),
        () => evaluateSmartPingNow(client, options)
    );

    smartPingEvaluationQueue = queuedEvaluation.catch(() => null);
    return queuedEvaluation;
}

module.exports = {
    evaluateSmartPing,
    findLatestQueueSnapshot,
    parseQueueSnapshot,
    resetSmartPingState,
};
