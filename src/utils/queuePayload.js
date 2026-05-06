const config = require("./config");

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function flattenTeamPlayers(teams) {
    return asArray(teams).flatMap((team) => {
        if (Array.isArray(team)) {
            return team;
        }

        return asArray(team?.players);
    });
}

function getPayloadPlayers(payload) {
    if (!payload || typeof payload !== "object") {
        return [];
    }

    if (Array.isArray(payload.players)) {
        return payload.players;
    }

    for (const key of ["queue_players", "current_players", "queued_players"]) {
        if (Array.isArray(payload[key])) {
            return payload[key];
        }
    }

    if (Array.isArray(payload?.data?.players)) {
        return payload.data.players;
    }

    if (Array.isArray(payload?.queue?.players)) {
        return payload.queue.players;
    }

    const teamPlayers = flattenTeamPlayers(payload.teams)
        .concat(flattenTeamPlayers(payload?.data?.teams));

    if (teamPlayers.length) {
        return teamPlayers;
    }

    return [];
}

function parseNumericCount(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function getPayloadPlayerCount(payload) {
    const players = getPayloadPlayers(payload);
    if (players.length) {
        return players.length;
    }

    for (const key of [
        "totalPlayers",
        "total_players",
        "playerCount",
        "player_count",
        "queueSize",
        "queue_size",
        "count",
    ]) {
        const parsed = parseNumericCount(payload?.[key]);
        if (parsed != null) {
            return parsed;
        }
    }

    return 0;
}

function isGoalkeeperRole(role) {
    const normalized = String(role || "").trim().toUpperCase();
    return /(^|\s|[-_/])(GK|GOLEIRO|GOALKEEPER)(\s|[-_/]|$)/.test(normalized);
}

function getPayloadGoalkeeperCount(payload) {
    const players = getPayloadPlayers(payload);
    if (players.length) {
        return players.filter((player) => isGoalkeeperRole(player?.role ?? player?.position)).length;
    }

    for (const key of ["gkCount", "gk_count", "goalkeeperCount", "goalkeeper_count"]) {
        const parsed = parseNumericCount(payload?.[key]);
        if (parsed != null) {
            return parsed;
        }
    }

    return 0;
}

function buildQueueSnapshotFromPayload(payload) {
    const totalPlayers = getPayloadPlayerCount(payload);
    if (!totalPlayers) {
        return null;
    }

    const gkCount = Math.min(getPayloadGoalkeeperCount(payload), totalPlayers);
    const totalSlots = Math.max(config.FULL_PLAYERS, totalPlayers);
    const gkSlots = Math.max(config.AUTO_FORCESTART_MIN_GK * 2, gkCount);
    const lineCount = Math.max(totalPlayers - gkCount, 0);
    const lineSlots = Math.max(totalSlots - gkSlots, lineCount);

    return {
        messageId: null,
        gkCount,
        gkSlots,
        lineCount,
        lineSlots,
        totalPlayers,
        totalSlots,
        rawText: "webhook payload",
        source: "webhook",
    };
}

module.exports = {
    buildQueueSnapshotFromPayload,
    getPayloadPlayerCount,
    getPayloadPlayers,
    isGoalkeeperRole,
};
