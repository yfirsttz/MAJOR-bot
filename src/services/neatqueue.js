const axios = require("axios");
const config = require("../utils/config");
const log = require("./logger");

const BASE_URL = "https://api.neatqueue.com/api/v2";

async function getPlayers() {
    try {
        const url = `${BASE_URL}/leaderboard/${config.SERVER_ID}/${config.QUEUE_CHANNEL_ID}`;
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
        return rows.map((player) => ({
            discordId: player.id,
            matches: player.stats?.totalgames ?? 0,
            name: player.name,
        }));
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
            const response = await axios.post(`${BASE_URL}/forcestart`, variant.body, {
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
    triggerForceStart,
};
