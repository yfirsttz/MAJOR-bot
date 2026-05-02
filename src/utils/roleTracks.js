const config = require("./config");

const TRACK_CONFIG = {
    major: {
        label: "LINHA",
        statsKey: "major",
        test: config.ROLES_TEST_MAJOR,
        approved: config.ROLES_MAJOR,
    },
    gkmajor: {
        label: "GK",
        statsKey: "gkmajor",
        test: config.ROLES_TEST_GKMAJOR,
        approved: config.ROLES_GKMAJOR,
    },
};

function normalizeRoleTracks(roleTracks) {
    return [...new Set((roleTracks || []).filter((track) => TRACK_CONFIG[track]))];
}

function memberHasRole(member, roleIds) {
    return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function getMemberTestRoleTracks(member) {
    const tracks = [];

    if (memberHasRole(member, TRACK_CONFIG.major.test)) {
        tracks.push("major");
    }

    if (memberHasRole(member, TRACK_CONFIG.gkmajor.test)) {
        tracks.push("gkmajor");
    }

    return tracks;
}

function getMemberApprovedRoleTracks(member) {
    const tracks = [];

    if (memberHasRole(member, TRACK_CONFIG.major.approved)) {
        tracks.push("major");
    }

    if (memberHasRole(member, TRACK_CONFIG.gkmajor.approved)) {
        tracks.push("gkmajor");
    }

    return tracks;
}

function getRoleIdsForTracks(roleTracks, kind) {
    const roleIds = [];

    for (const track of normalizeRoleTracks(roleTracks)) {
        roleIds.push(...TRACK_CONFIG[track][kind]);
    }

    return [...new Set(roleIds)];
}

function getRoleTrackLabel(track) {
    return TRACK_CONFIG[track]?.label || track;
}

function getRoleTrackStatsKey(track) {
    return TRACK_CONFIG[track]?.statsKey || track;
}

module.exports = {
    normalizeRoleTracks,
    getMemberTestRoleTracks,
    getMemberApprovedRoleTracks,
    getRoleIdsForTracks,
    getRoleTrackLabel,
    getRoleTrackStatsKey,
};
