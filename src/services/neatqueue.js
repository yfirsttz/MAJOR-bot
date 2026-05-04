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

function findPlayerInMatch(match, discordId) {
    for (const team of match?.teams || []) {
        for (const player of team || []) {
            if (String(player?.id || "").trim() === discordId) {
                return player;
            }
        }
    }

    return null;
}

async function getPlayerRoleGameCounts(discordId) {
    const playerId = String(discordId || "").trim();
    if (!playerId) {
        return null;
    }

    try {
        const [statsResponse, historyResponse] = await Promise.all([
            axios.get(`${API_ROOT}/api/v1/playerstats/${config.SERVER_ID}/${playerId}/${encodeURIComponent(config.QUEUE_NAME)}`, {
                headers: {
                    Authorization: `Bearer ${config.NEATQUEUE_API_TOKEN}`,
                },
                params: {
                    include_games: true,
                },
                validateStatus: () => true,
            }),
            axios.get(`${API_ROOT}/api/v1/history/${config.SERVER_ID}`, {
                headers: {
                    Authorization: `Bearer ${config.NEATQUEUE_API_TOKEN}`,
                },
                params: {
                    limit: 1000,
                    player_id: playerId,
                    ...(config.QUEUE_NAME ? { queue_name: config.QUEUE_NAME } : {}),
                },
                validateStatus: () => true,
            }),
        ]);

        if (statsResponse.status < 200 || statsResponse.status >= 300) {
            log.error(`getPlayerRoleGameCounts/playerstats HTTP ${statsResponse.status}:`, statsResponse.data);
            return null;
        }

        if (historyResponse.status < 200 || historyResponse.status >= 300) {
            log.error(`getPlayerRoleGameCounts/history HTTP ${historyResponse.status}:`, historyResponse.data);
            return null;
        }

        const gameNumbers = new Set(
            (statsResponse.data?.games || [])
                .map((game) => String(game?.game_num || "").trim())
                .filter(Boolean)
        );
        const counts = { major: 0, gkmajor: 0, missing: 0 };

        for (const gameNumber of gameNumbers) {
            const match = (historyResponse.data?.data || [])
                .find((game) => String(game?.game_num || "").trim() === gameNumber);
            const player = match ? findPlayerInMatch(match, playerId) : null;
            const roleTrack = normalizePlayerRole(player?.role);

            if (roleTrack) {
                counts[roleTrack] += 1;
            } else {
                counts.missing += 1;
            }
        }

        counts.total = gameNumbers.size;
        return counts;
    } catch (error) {
        log.error("Erro ao consultar partidas por posicao do jogador:", error.response?.data ?? error.message);
        return null;
    }
}

async function getPlayers() {
    try {
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
                roleGames: { major: 0, gkmajor: 0 },
                name: player.name,
            };
        });
    } catch (error) {
        log.error("Erro ao consultar leaderboard:", error.response?.data ?? error.message);
        return [];
    }
}

function buildJsonWithSnowflake(key, value) {
    const snowflake = String(value || "").trim();
    if (!/^\d+$/.test(snowflake)) {
        throw new Error(`ID invalido para ${key}: ${value}`);
    }

    return `{"${key}":${snowflake}}`;
}

async function triggerForceStart() {
    const variants = [
        {
            name: "bearer_channel_id_integer",
            body: buildJsonWithSnowflake("channel_id", config.QUEUE_CHANNEL_ID),
            headers: { Authorization: `Bearer ${config.NEATQUEUE_API_TOKEN}` },
        },
        {
            name: "bearer_channel_id_string",
            body: { channel_id: config.QUEUE_CHANNEL_ID },
            headers: { Authorization: `Bearer ${config.NEATQUEUE_API_TOKEN}` },
        },
        {
            name: "authorization_raw_channel_id_integer",
            body: buildJsonWithSnowflake("channel_id", config.QUEUE_CHANNEL_ID),
            headers: { Authorization: config.NEATQUEUE_API_TOKEN },
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
    getPlayerRoleGameCounts,
    triggerForceStart,
};
