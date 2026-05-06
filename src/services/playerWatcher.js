const { getPlayerRoleGameCounts, getPlayers } = require("./neatqueue");
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

function getPreviousRoleGames(progress, statsKey, currentRoleGames) {
    if (!progress) {
        return currentRoleGames;
    }

    const previousRoleGames = Number(progress[`last_${statsKey}_games`] || 0);
    const previousTotalGames = Number(progress.last_total_games || 0);
    const hasFreshRoleProgress =
        Number(progress.last_major_games || 0) > 0 ||
        Number(progress.last_gkmajor_games || 0) > 0;

    if (!hasFreshRoleProgress && previousTotalGames > 0) {
        return currentRoleGames;
    }

    return previousRoleGames;
}

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
            const roleGames = roleTracks.length
                ? await getPlayerRoleGameCounts(discordUserId)
                : { major: 0, gkmajor: 0 };

            if (roleTracks.length && !roleGames) {
                log.warn(`Nao foi possivel calcular partidas por posicao para ${member.user.tag}; pulando verificacao.`);
                await upsertPlayerProgress(discordUserId, member.user.tag, totalGames);
                continue;
            }

            if (testRoleTracks.length > roleTracks.length) {
                log.warn(
                    `${member.user.tag} ja possui cargo aprovado para: ${approvedRoleTracks.join(", ")}. Ignorando posicao(oes) de teste duplicada(s).`
                );
            }

            if (roleTracks.length > 1) {
                log.warn(`${member.user.tag} esta em multiplas posicoes de teste pendentes: ${roleTracks.join(", ")}`);
            }

            log.info(
                `${member.user.tag} | total=${totalGames} | major=${roleGames.major || 0} | gkmajor=${roleGames.gkmajor || 0} | missing=${roleGames.missing || 0} | testTracks=${testRoleTracks.join(",") || "none"} | approvedTracks=${approvedRoleTracks.join(",") || "none"} | pendingTracks=${roleTracks.join(",") || "none"}`
            );

            if (roleGames.missing) {
                log.warn(
                    `${member.user.tag} tem ${roleGames.missing} partida(s) sem posicao no historico; pulando votacao para evitar contagem errada.`
                );
                await upsertPlayerProgress(discordUserId, member.user.tag, totalGames, roleGames);
                continue;
            }

            for (const roleTrack of roleTracks) {
                const statsKey = getRoleTrackStatsKey(roleTrack);
                const currentRoleGames = Number(roleGames?.[statsKey] || 0);
                const previousRoleGames = getPreviousRoleGames(progress, statsKey, currentRoleGames);
                const existingVote = await getVoteByUserAndThreshold(discordUserId, threshold, roleTrack);
                const label = getRoleTrackLabel(roleTrack);

                log.info(
                    `${member.user.tag} | track=${roleTrack} (${label}) | prev=${previousRoleGames} | now=${currentRoleGames} | vote=${Boolean(existingVote)}`
                );

                if (previousRoleGames < threshold && currentRoleGames >= threshold && !existingVote) {
                    log.poll(`${member.user.tag} cruzou ${threshold} partidas como ${label}. Abrindo enquete.`);
                    const pollMessage = await openPoll(channel, member, {
                        roleTracks: [roleTrack],
                        thresholdGames: threshold,
                        roleGames: currentRoleGames,
                    });

                    if (pollMessage) {
                        await createVote({
                            discordUserId,
                            discordTag: member.user.tag,
                            roleTrack,
                            thresholdGames: threshold,
                            totalGamesWhenTriggered: currentRoleGames,
                            roleTracks: [roleTrack],
                            voteMessageId: pollMessage.id,
                            voteChannelId: channel.id,
                            status: "open",
                        });
                    }
                }
            }

            await upsertPlayerProgress(discordUserId, member.user.tag, totalGames, roleGames);
        }
    } catch (error) {
        log.error("Erro no loop de players:", error.message);
    }
}

module.exports = {
    checkPlayers,
};
