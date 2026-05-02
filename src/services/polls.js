const config = require("../utils/config");
const { readJson, saveJson } = require("../utils/jsonStore");
const messages = require("../ui/messages");
const { getVoteByMessageId, updateVoteStatusByMessageId } = require("../database/create");
const { normalizeRoleTracks, getRoleIdsForTracks } = require("../utils/roleTracks");
const log = require("./logger");

const STORE_NAME = "pending_polls";
let pendingPolls = readJson(STORE_NAME, {});

function savePendingPolls() {
    saveJson(STORE_NAME, pendingPolls);
}

function normalizePendingPollData(pendingPoll) {
    return {
        memberId: pendingPoll?.memberId ?? null,
        endsAt: pendingPoll?.endsAt ?? 0,
        roleTracks: normalizeRoleTracks(pendingPoll?.roleTracks),
        channelId: pendingPoll?.channelId || config.CHANNEL_ID,
        thresholdGames: pendingPoll?.thresholdGames ?? config.POLL_THRESHOLD_GAMES,
    };
}

function removePendingPoll(messageId) {
    delete pendingPolls[messageId];
    savePendingPolls();
}

async function openPoll(channel, member, options = {}) {
    const roleTracks = normalizeRoleTracks(options.roleTracks);

    try {
        const message = await channel.send(messages.buildPollMessage(member));
        pendingPolls[message.id] = {
            memberId: member.id,
            endsAt: Date.now() + config.POLL_DURATION_MS,
            roleTracks,
            channelId: channel.id,
            thresholdGames: options.thresholdGames ?? config.POLL_THRESHOLD_GAMES,
        };
        savePendingPolls();

        log.poll(
            `Enquete aberta para ${member.user.tag} (${roleTracks.join(", ") || "sem trilha"}).`
        );
        return message;
    } catch (error) {
        log.error("Erro ao criar enquete:", error.message);
        return null;
    }
}

async function resolveStoredRoleTracks(messageId, pendingPoll) {
    if (pendingPoll.roleTracks.length) {
        return pendingPoll.roleTracks;
    }

    const vote = await getVoteByMessageId(messageId);
    return normalizeRoleTracks(vote?.role_tracks);
}

async function getPollChannel(client, channelId) {
    return client.channels.cache.get(channelId)
        ?? (await client.channels.fetch(channelId).catch(() => null));
}

async function getGuild(client) {
    return client.guilds.cache.get(config.SERVER_ID)
        ?? (await client.guilds.fetch(config.SERVER_ID).catch(() => null));
}

async function finalizePoll(client, messageId) {
    const pendingPoll = normalizePendingPollData(pendingPolls[messageId]);
    const channel = await getPollChannel(client, pendingPoll.channelId);

    if (!channel || !channel.isTextBased()) {
        log.warn(`Canal da enquete nao encontrado: ${pendingPoll.channelId}`);
        return;
    }

    let message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message?.poll) {
        log.warn(`Mensagem/enquete nao encontrada: ${messageId}`);
        await updateVoteStatusByMessageId(messageId, "missing_message").catch(() => null);
        removePendingPoll(messageId);
        return;
    }

    if (config.DEBUG && !message.poll.isFinalized) {
        log.debug(`Forcando encerramento da enquete ${messageId} em DEBUG.`);
        await client.rest.post(`/channels/${channel.id}/polls/${messageId}/expire`).catch((error) => {
            log.error("Falha ao expirar enquete em DEBUG:", error.message);
        });
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message?.poll) {
            await updateVoteStatusByMessageId(messageId, "missing_message").catch(() => null);
            removePendingPoll(messageId);
            return;
        }
    }

    if (!config.DEBUG && !message.poll.isFinalized) {
        log.poll(`Enquete ${messageId} ainda nao finalizada pelo Discord.`);
        return;
    }

    let yesVotes = 0;
    let noVotes = 0;
    for (const [, answer] of message.poll.answers) {
        const label = String(answer.text || "").trim().toLowerCase();
        if (label === "sim") {
            yesVotes = answer.voteCount ?? 0;
        }
        if (label === "nao") {
            noVotes = answer.voteCount ?? 0;
        }
    }

    const guild = await getGuild(client);
    const member = pendingPoll.memberId
        ? await guild?.members.fetch(pendingPoll.memberId).catch(() => null)
        : null;
    const roleTracks = await resolveStoredRoleTracks(messageId, pendingPoll);

    if (roleTracks.length > 1) {
        log.warn(`Enquete ${messageId} sera resolvida para multiplas trilhas: ${roleTracks.join(", ")}`);
    }

    let status = "tied";
    if (yesVotes > noVotes) {
        status = "approved";

        if (member) {
            const approvedRoleIds = getRoleIdsForTracks(roleTracks, "approved");
            const testRoleIds = getRoleIdsForTracks(roleTracks, "test");

            if (approvedRoleIds.length) {
                await member.roles.add(approvedRoleIds).catch((error) => {
                    log.error("Falha ao adicionar cargos aprovados:", error.message);
                });
            }

            if (testRoleIds.length) {
                await member.roles.remove(testRoleIds).catch((error) => {
                    log.error("Falha ao remover cargos de teste:", error.message);
                });
            }

            await channel.send(messages.pollApproved(member));
            log.ok(`Membro aprovado pela enquete: ${member.user.tag}`);
        } else {
            await channel.send(messages.pollApprovedNotFound(pendingPoll.memberId));
        }
    } else if (noVotes > yesVotes) {
        status = "rejected";

        if (member) {
            await channel.send(messages.pollRejected(member.user.tag));
            await member.kick("Reprovado na enquete da comunidade.").catch((error) => {
                log.error("Falha ao kickar membro reprovado:", error.message);
            });
            log.ok(`Membro reprovado e removido: ${member.user.tag}`);
        } else {
            await channel.send(messages.pollRejectedNotFound(pendingPoll.memberId));
        }
    } else {
        await channel.send(messages.pollTie(pendingPoll.memberId));
        log.poll(`Empate na enquete ${messageId}.`);
    }

    await updateVoteStatusByMessageId(messageId, status).catch((error) => {
        log.error("Falha ao atualizar status da enquete no banco:", error.message);
    });

    await message.delete().catch(() => {
        log.warn(`Nao foi possivel deletar a mensagem da enquete ${messageId}`);
    });

    removePendingPoll(messageId);
}

async function checkAllPendingPolls(client) {
    const ids = Object.keys(pendingPolls);
    if (!ids.length) {
        return;
    }

    log.poll(`Verificando ${ids.length} enquete(s) pendente(s).`);

    for (const messageId of ids) {
        const pendingPoll = normalizePendingPollData(pendingPolls[messageId]);
        if (Date.now() >= pendingPoll.endsAt) {
            await finalizePoll(client, messageId);
        }
    }
}

async function restorePendingPolls(client) {
    const count = Object.keys(pendingPolls).length;
    if (!count) {
        return;
    }

    log.poll(`Restaurando ${count} enquete(s) pendente(s) apos restart.`);
    await checkAllPendingPolls(client);
}

module.exports = {
    openPoll,
    checkAllPendingPolls,
    restorePendingPolls,
};
