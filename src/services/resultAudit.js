const config = require("../utils/config");
const { readJson, saveJson } = require("../utils/jsonStore");
const messages = require("../ui/messages");
const log = require("./logger");

const STATE_FILE = "results_alert_state";
const MAX_PROCESSED_KEYS = 500;

let state = {
    processedKeys: [],
    ...readJson(STATE_FILE, {}),
};

let watcherRegistered = false;

function saveState() {
    if (state.processedKeys.length > MAX_PROCESSED_KEYS) {
        state.processedKeys = state.processedKeys.slice(-MAX_PROCESSED_KEYS);
    }

    saveJson(STATE_FILE, state);
}

function buildDedupKey(message) {
    return `${message.id}:${message.editedTimestamp || 0}`;
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

function extractModifierName(text) {
    return text.match(/MODIFIED BY\s+([^\n\r]+)/i)?.[1]?.trim() || "Desconhecido";
}

function extractQueueNumber(text) {
    const lobbyMatch = text.match(/Nome do Lobby:\s*Major SA\s*(\d+)/i);
    if (lobbyMatch) {
        return lobbyMatch[1];
    }

    const queueMatch = text.match(/fila\s*#?(\d+)/i);
    if (queueMatch) {
        return queueMatch[1];
    }

    return "desconhecida";
}

function extractModifiedAt(text, message) {
    const match = text.match(/(?:modified at|alterado em|edited at)\s*:?\s*([^\n\r]+)/i);
    if (match) {
        return match[1].trim();
    }

    if (message.editedAt) {
        return message.editedAt.toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
        });
    }

    return "Horario nao identificado";
}

function extractTranscriptUrl(message) {
    for (const row of message.components || []) {
        for (const component of row.components || []) {
            if (component.label && /transcript/i.test(component.label) && component.url) {
                return component.url;
            }
        }
    }

    return null;
}

async function materializeMessage(message) {
    if (!message?.partial) {
        return message;
    }

    return message.fetch().catch(() => null);
}

async function sendAuditDm(client, payload) {
    try {
        const user = await client.users.fetch(config.RESULTS_ALERT_USER_ID);
        await user.send(messages.buildResultAuditDm(payload));
        log.ok(`Auditoria de resultado enviada por DM para ${config.RESULTS_ALERT_USER_ID}.`);
    } catch (error) {
        log.warn("Falha ao enviar DM de auditoria de resultado:", error.message);
    }
}

function registerResultAuditWatcher(client) {
    if (watcherRegistered || !config.RESULT_AUDIT_ENABLED) {
        return;
    }

    watcherRegistered = true;

    client.on("messageUpdate", async (_oldMessage, newMessage) => {
        const message = await materializeMessage(newMessage);
        if (!message || message.channelId !== config.RESULTS_CHANNEL_ID) {
            return;
        }

        if (message.author?.id !== config.NEATQUEUE_BOT_ID) {
            return;
        }

        const dedupKey = buildDedupKey(message);
        if (state.processedKeys.includes(dedupKey)) {
            return;
        }

        const text = collectMessageText(message);
        if (!/MODIFIED BY/i.test(text)) {
            return;
        }

        const payload = {
            modifierName: extractModifierName(text),
            modifiedAt: extractModifiedAt(text, message),
            queueNumber: extractQueueNumber(text),
            transcriptUrl: extractTranscriptUrl(message),
            messageUrl: message.url,
        };

        state.processedKeys.push(dedupKey);
        saveState();

        await sendAuditDm(client, payload);
    });
}

module.exports = {
    registerResultAuditWatcher,
};
