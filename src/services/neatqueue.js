const axios = require("axios");
const config = require("../utils/config");
const log = require("./logger");

const API_ROOT = "https://api.neatqueue.com";
const V2_BASE_URL = `${API_ROOT}/api/v2`;

function normalizePlayerRole(role) {
    const normalized = String(role || "").trim().toUpperCase();

    if (normalized === "LINHA") {
        return "major";
    }

    if (normalized === "GK") {
        return "gkmajor";
    }

    return null;
}

async function getRoleGameCountsByPlayer() {
    try {
        const response = await axios.get(`${API_ROOT}/api/v1/history/${config.SERVER_ID}`, {
            headers: {
                Authorization: `Bearer ${config.NEATQUEUE_API_TOKEN}`,
            },
            params: {
                limit: 1000,
                order: "desc",
                ...(config.QUEUE_NAME ? { queue_name: config.QUEUE_NAME } : {}),
            },
            validateStatus: () => true,
        });

        if (response.status < 200 || response.status >= 300) {
            log.error(`getRoleGameCountsByPlayer HTTP ${response.status}:`, response.data);
            return new Map();
        }

        const countsByPlayer = new Map();

        for (const match of response.data?.data || []) {
            for (const team of match?.teams || []) {
                for (const player of team || []) {
                    const discordId = String(player?.id || "").trim();
                    const roleTrack = normalizePlayerRole(player?.role);

                    if (!discordId || !roleTrack) {
                        continue;
                    }

                    const counts = countsByPlayer.get(discordId) || { major: 0, gkmajor: 0 };
                    counts[roleTrack] += 1;
                    countsByPlayer.set(discordId, counts);
                }
            }
        }

        return countsByPlayer;
    } catch (error) {
        log.error("Erro ao consultar historico por posicao:", error.response?.data ?? error.message);
        return new Map();
    }
}

async function getPlayers() {
    try {
        const roleGameCounts = await getRoleGameCountsByPlayer();
        const url = `${V2_BASE_URL}/leaderboard/${config.SERVER_ID}/${config.QUEUE_CHANNEL_ID}`;
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${config.NEATQUEUE_API_TOKEN}`,
            },
            validateStatus: () => true,
        });

        if (response.status < 200 || response.status >= 300) {
            log.error(`getPlayers HTTP ${response.status}:`, response.data);
            return [];
        }

        const rows = (response.data?.months || []).flatMap((month) => month?.data || []);
        return rows.map((player) => {
            const discordId = String(player.id || "").trim();

            return {
                discordId,
                matches: player.stats?.totalgames ?? 0,
                roleGames: roleGameCounts.get(discordId) || { major: 0, gkmajor: 0 },
                name: player.name,
            };
        });
    } catch (error) {
        log.error("Erro ao consultar leaderboard:", error.response?.data ?? error.message);
        return [];
    }
}

async function triggerForceStart() {
    const baseBody = {
        server_id: config.SERVER_ID,
        channel_id: config.QUEUE_CHANNEL_ID,
    };

    const variants = [
        {
            name: "bearer_complete",
            body: config.QUEUE_NAME ? { ...baseBody, queue_name: config.QUEUE_NAME } : baseBody,
            headers: { Authorization: `Bearer ${config.NEATQUEUE_API_TOKEN}` },
        },
        {
            name: "bearer_without_queue_name",
            body: baseBody,
            headers: { Authorization: `Bearer ${config.NEATQUEUE_API_TOKEN}` },
        },
        {
            name: "authorization_raw",
            body: config.QUEUE_NAME ? { ...baseBody, queue_name: config.QUEUE_NAME } : baseBody,
            headers: { Authorization: config.NEATQUEUE_API_TOKEN },
        },
        {
            name: "x_api_key",
            body: config.QUEUE_NAME ? { ...baseBody, queue_name: config.QUEUE_NAME } : baseBody,
            headers: { "x-api-key": config.NEATQUEUE_API_TOKEN },
        },
    ];

    let lastResponse = null;

    for (const variant of variants) {
        try {
            log.force(`Tentando forcestart [${variant.name}]`);
            const response = await axios.post(`${V2_BASE_URL}/forcestart`, variant.body, {
                headers: {
                    "Content-Type": "application/json",
                    ...variant.headers,
                },
                validateStatus: () => true,
            });

            lastResponse = response;
            log.force(`Forcestart [${variant.name}] -> HTTP ${response.status}`);

            if (response.status >= 200 && response.status < 300) {
                return response;
            }
        } catch (error) {
            log.error(`Falha no forcestart [${variant.name}]:`, error.response?.data ?? error.message);
        }
    }

    return lastResponse ?? {
        status: 500,
        data: { detail: "Todas as tentativas de forcestart falharam." },
    };
}

module.exports = {
    getPlayers,
    getRoleGameCountsByPlayer,
    triggerForceStart,
};
