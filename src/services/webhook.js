const http = require("http");
const config = require("../utils/config");
const {
    processQueueCount,
    resetAutoForceStartWatcher,
    isTargetQueue,
} = require("./forceStart");
const { evaluateSmartPing, resetSmartPingState } = require("./rolePing");
const log = require("./logger");

let serverInstance = null;

function startWebhookServer(client) {
    if (!config.WEBHOOK_FEATURES_ENABLED) {
        log.info("Webhook do NeatQueue desativado; nenhuma feature depende dele no perfil atual.");
        return null;
    }

    if (serverInstance) {
        return serverInstance;
    }

    log.info("Iniciando webhook do NeatQueue.");
    log.info(`PATH=${config.PUBLIC_WEBHOOK_PATH}`);
    log.info(`PORT=${config.WEBHOOK_PORT}`);
    log.info(`SMART_PING=${config.SMART_PING_ENABLED}`);
    log.info(`AUTO_FORCESTART=${config.AUTO_FORCESTART_ENABLED}`);

    serverInstance = http.createServer((req, res) => {
        if (req.method === "GET" && req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                ok: true,
                autoForceStart: config.AUTO_FORCESTART_ENABLED,
                smartPing: config.SMART_PING_ENABLED,
            }));
            return;
        }

        if (req.method !== "POST" || req.url !== config.PUBLIC_WEBHOOK_PATH) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }

        const authHeader = String(req.headers.authorization || "");
        if (config.NEATQUEUE_WEBHOOK_TOKEN && authHeader !== config.NEATQUEUE_WEBHOOK_TOKEN) {
            log.warn("Token do webhook invalido.");
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
        }

        let rawBody = "";
        req.on("data", (chunk) => {
            rawBody += chunk.toString();
        });

        req.on("end", async () => {
            let payload;

            try {
                payload = rawBody ? JSON.parse(rawBody) : {};
            } catch (error) {
                log.error("Payload JSON invalido no webhook:", error.message);
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid JSON" }));
                return;
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));

            try {
                if (!isTargetQueue(payload)) {
                    log.debug("Payload ignorado; nao corresponde a fila alvo.");
                    return;
                }

                const action = payload.action;
                const totalPlayers = Array.isArray(payload.players) ? payload.players.length : 0;

                if (action === "JOIN_QUEUE" || action === "LEAVE_QUEUE") {
                    log.queue(`${action} recebido com ${totalPlayers} player(s).`);

                    if (config.AUTO_FORCESTART_ENABLED) {
                        await processQueueCount(client, totalPlayers, payload);
                    }

                    if (config.SMART_PING_ENABLED) {
                        await evaluateSmartPing(client, {
                            reason: action,
                            expectedTotalPlayers: totalPlayers,
                        });
                    }
                    return;
                }

                if (action === "MATCH_STARTED") {
                    log.info("MATCH_STARTED recebido; resetando watchers da fila.");

                    if (config.AUTO_FORCESTART_ENABLED) {
                        await resetAutoForceStartWatcher(client, "partida iniciada");
                    }

                    if (config.SMART_PING_ENABLED) {
                        resetSmartPingState("partida iniciada");
                    }
                    return;
                }

                if (action === "MATCH_CANCELLED") {
                    log.warn(`MATCH_CANCELLED recebido; recalculando com ${totalPlayers} player(s).`);

                    if (config.AUTO_FORCESTART_ENABLED) {
                        await processQueueCount(client, totalPlayers, payload);
                    }

                    if (config.SMART_PING_ENABLED) {
                        await evaluateSmartPing(client, {
                            reason: action,
                            expectedTotalPlayers: totalPlayers,
                        });
                    }
                    return;
                }

                log.debug(`Acao de webhook sem handler especifico: ${action}`);
            } catch (error) {
                log.error("Erro ao processar webhook:", error.message);
            }
        });
    });

    serverInstance.listen(config.WEBHOOK_PORT, () => {
        log.ok(`Webhook server ouvindo em :${config.WEBHOOK_PORT}${config.PUBLIC_WEBHOOK_PATH}`);
    });

    return serverInstance;
}

module.exports = {
    startWebhookServer,
};
