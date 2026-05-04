const config = require("./config");

function getPayloadPlayers(payload) {
    if (Array.isArray(payload?.players)) {
        return payload.players;
    }

    if (Array.isArray(payload?.teams)) {
        return payload.teams.flatMap((team) => Array.isArray(team) ? team : []);
    }

    return [];
}

function isGoalkeeperRole(role) {
    const normalized = String(role || "").trim().toUpperCase();
    return /(^|\s|[-_/])(GK|GOLEIRO|GOALKEEPER)(\s|[-_/]|$)/.test(normalized);
}

function buildQueueSnapshotFromPayload(payload) {
    const players = getPayloadPlayers(payload);
    if (!players.length) {
        return null;
    }

    const gkCount = players.filter((player) => isGoalkeeperRole(player?.role)).length;
    const totalPlayers = players.length;
    const totalSlots = Math.max(config.FULL_PLAYERS, totalPlayers);
    const gkSlots = Math.max(config.AUTO_FORCESTART_MIN_GK * 2, gkCount);
    const lineCount = totalPlayers - gkCount;
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
    getPayloadPlayers,
    isGoalkeeperRole,
};
