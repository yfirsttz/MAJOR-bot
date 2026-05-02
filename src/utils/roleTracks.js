const config = require("./config");

const TRACK_CONFIG = {
    major: {
        test: config.ROLES_TEST_MAJOR,
        approved: config.ROLES_MAJOR,
    },
    gkmajor: {
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

function getRoleIdsForTracks(roleTracks, kind) {
    const roleIds = [];

    for (const track of normalizeRoleTracks(roleTracks)) {
        roleIds.push(...TRACK_CONFIG[track][kind]);
    }

    return [...new Set(roleIds)];
}

module.exports = {
    normalizeRoleTracks,
    getMemberTestRoleTracks,
    getRoleIdsForTracks,
};
