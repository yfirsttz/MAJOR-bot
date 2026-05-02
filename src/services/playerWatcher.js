const { getPlayers } = require("./neatqueue");
const { openPoll } = require("./polls");
const {
    getVoteByUserAndThreshold,
    createVote,
    getPlayerProgress,
    upsertPlayerProgress,
} = require("../database/create");
const config = require("../utils/config");
const { getMemberTestRoleTracks } = require("../utils/roleTracks");
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

            const roleTracks = getMemberTestRoleTracks(member);
            const progress = await getPlayerProgress(discordUserId);
            const previousGames = Number(progress?.last_total_games ?? 0);
            const existingVote = await getVoteByUserAndThreshold(discordUserId, threshold);

            if (roleTracks.length > 1) {
                log.warn(`${member.user.tag} esta em multiplas trilhas de teste: ${roleTracks.join(", ")}`);
            }

            log.info(
                `${member.user.tag} | prev=${previousGames} | now=${totalGames} | tracks=${roleTracks.join(",") || "none"} | vote=${Boolean(existingVote)}`
            );

            if (roleTracks.length && previousGames < threshold && totalGames >= threshold && !existingVote) {
                log.poll(`${member.user.tag} cruzou ${threshold} partidas. Abrindo enquete.`);
                const pollMessage = await openPoll(channel, member, {
                    roleTracks,
                    thresholdGames: threshold,
                });

                if (pollMessage) {
                    await createVote({
                        discordUserId,
                        discordTag: member.user.tag,
                        thresholdGames: threshold,
                        totalGamesWhenTriggered: totalGames,
                        roleTracks,
                        voteMessageId: pollMessage.id,
                        voteChannelId: channel.id,
                        status: "open",
                    });
                }
            }

            await upsertPlayerProgress(discordUserId, member.user.tag, totalGames);
        }
    } catch (error) {
        log.error("Erro no loop de players:", error.message);
    }
}

module.exports = {
    checkPlayers,
};
