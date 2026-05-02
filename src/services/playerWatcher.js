const { getPlayers } = require("./neatqueue");
const { openPoll } = require("./polls");
const {
    getVoteByUserAndThreshold,
    createVote,
    getPlayerProgress,
    upsertPlayerProgress,
} = require("../database/create");
const config = require("../utils/config");
const {
    getMemberApprovedRoleTracks,
    getMemberTestRoleTracks,
    getRoleTrackLabel,
    getRoleTrackStatsKey,
} = require("../utils/roleTracks");
const log = require("./logger");

async function checkPlayers(client, guild, channel) {
    try {
        const players = await getPlayers();
        log.info(`Players recebidos da API: ${players.length}`);

        for (const player of players) {
            const discordUserId = String(player.discordId || "").trim();
            const totalGames = Number(player.matches || 0);
            const threshold = config.POLL_THRESHOLD_GAMES;

            if (!discordUserId) {
                continue;
            }

            const member = await guild.members.fetch(discordUserId).catch(() => null);
            if (!member) {
                log.warn(`Membro nao encontrado no servidor: ${discordUserId}`);
                continue;
            }

            const testRoleTracks = getMemberTestRoleTracks(member);
            const approvedRoleTracks = getMemberApprovedRoleTracks(member);
            const roleTracks = testRoleTracks.filter((track) => !approvedRoleTracks.includes(track));
            const progress = await getPlayerProgress(discordUserId);

            if (testRoleTracks.length > roleTracks.length) {
                log.warn(
                    `${member.user.tag} ja possui cargo aprovado para: ${approvedRoleTracks.join(", ")}. Ignorando trilha(s) de teste duplicada(s).`
                );
            }

            if (roleTracks.length > 1) {
                log.warn(`${member.user.tag} esta em multiplas trilhas de teste pendentes: ${roleTracks.join(", ")}`);
            }

            log.info(
                `${member.user.tag} | total=${totalGames} | major=${player.roleGames?.major || 0} | gkmajor=${player.roleGames?.gkmajor || 0} | testTracks=${testRoleTracks.join(",") || "none"} | approvedTracks=${approvedRoleTracks.join(",") || "none"} | pendingTracks=${roleTracks.join(",") || "none"}`
            );

            for (const roleTrack of roleTracks) {
                const statsKey = getRoleTrackStatsKey(roleTrack);
                const roleGames = Number(player.roleGames?.[statsKey] || 0);
                const previousRoleGames = progress
                    ? Number(progress[`last_${statsKey}_games`] || 0)
                    : roleGames;
                const existingVote = await getVoteByUserAndThreshold(discordUserId, threshold, roleTrack);
                const label = getRoleTrackLabel(roleTrack);

                log.info(
                    `${member.user.tag} | track=${roleTrack} (${label}) | prev=${previousRoleGames} | now=${roleGames} | vote=${Boolean(existingVote)}`
                );

                if (previousRoleGames < threshold && roleGames >= threshold && !existingVote) {
                    log.poll(`${member.user.tag} cruzou ${threshold} partidas como ${label}. Abrindo enquete.`);
                    const pollMessage = await openPoll(channel, member, {
                        roleTracks: [roleTrack],
                        thresholdGames: threshold,
                        roleGames,
                    });

                    if (pollMessage) {
                        await createVote({
                            discordUserId,
                            discordTag: member.user.tag,
                            roleTrack,
                            thresholdGames: threshold,
                            totalGamesWhenTriggered: roleGames,
                            roleTracks: [roleTrack],
                            voteMessageId: pollMessage.id,
                            voteChannelId: channel.id,
                            status: "open",
                        });
                    }
                }
            }

            await upsertPlayerProgress(discordUserId, member.user.tag, totalGames, player.roleGames);
        }
    } catch (error) {
        log.error("Erro no loop de players:", error.message);
    }
}

module.exports = {
    checkPlayers,
};
