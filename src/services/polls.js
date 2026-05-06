const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const config = require("../utils/config");
const { readJson, saveJson } = require("../utils/jsonStore");
const messages = require("../ui/messages");
const { getVoteByMessageId, updateVoteStatusByMessageId } = require("../database/create");
const { getMemberApprovedRoleTracks, normalizeRoleTracks, getRoleIdsForTracks } = require("../utils/roleTracks");
const log = require("./logger");

const STORE_NAME = "pending_polls";
const PRIVATE_POLL_CUSTOM_ID_PREFIX = "private_poll";

let pendingPolls = readJson(STORE_NAME, {});
let interactionHandlerRegistered = false;

function savePendingPolls() {
    saveJson(STORE_NAME, pendingPolls);
}

function normalizeVotes(votes) {
    if (!votes || typeof votes !== "object" || Array.isArray(votes)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(votes)
            .filter(([, value]) => value === "yes" || value === "no")
    );
}

function normalizePendingPollData(pendingPoll) {
    const votes = normalizeVotes(pendingPoll?.votes);
    const eligibleVoters = Array.isArray(pendingPoll?.eligibleVoters)
        ? pendingPoll.eligibleVoters.filter(Boolean)
        : Object.keys(votes);

    return {
        mode: pendingPoll?.mode || (pendingPoll?.votes ? "dm" : "discord_poll"),
        memberId: pendingPoll?.memberId ?? null,
        endsAt: pendingPoll?.endsAt ?? 0,
        roleTracks: normalizeRoleTracks(pendingPoll?.roleTracks),
        channelId: pendingPoll?.channelId || config.CHANNEL_ID,
        thresholdGames: pendingPoll?.thresholdGames ?? config.POLL_THRESHOLD_GAMES,
        roleGames: pendingPoll?.roleGames ?? null,
        votes,
        eligibleVoters: [...new Set(eligibleVoters)],
        dmSentCount: Number(pendingPoll?.dmSentCount || 0),
        dmFailedCount: Number(pendingPoll?.dmFailedCount || 0),
    };
}

function removePendingPoll(messageId) {
    delete pendingPolls[messageId];
    savePendingPolls();
}

function buildPrivatePollCustomId(messageId, vote) {
    return `${PRIVATE_POLL_CUSTOM_ID_PREFIX}:${messageId}:${vote}`;
}

function parsePrivatePollCustomId(customId) {
    const [prefix, messageId, vote] = String(customId || "").split(":");
    if (prefix !== PRIVATE_POLL_CUSTOM_ID_PREFIX || !messageId || !["yes", "no"].includes(vote)) {
        return null;
    }

    return { messageId, vote };
}

function buildPrivatePollButtons(messageId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(buildPrivatePollCustomId(messageId, "yes"))
                .setLabel("Sim")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(buildPrivatePollCustomId(messageId, "no"))
                .setLabel("Nao")
                .setStyle(ButtonStyle.Danger)
        ),
    ];
}

function getPrivateVoteCounts(pendingPoll) {
    const votes = normalizeVotes(pendingPoll?.votes);
    return Object.values(votes).reduce(
        (counts, vote) => {
            if (vote === "yes") {
                counts.yesVotes += 1;
            }
            if (vote === "no") {
                counts.noVotes += 1;
            }
            return counts;
        },
        { yesVotes: 0, noVotes: 0 }
    );
}

function formatDmVoteContent(content, vote) {
    const cleanContent = String(content || "").replace(/\n\nSeu voto atual: .+$/s, "");
    return `${cleanContent}\n\nSeu voto atual: **${vote === "yes" ? "Sim" : "Nao"}**`;
}

async function getPollChannel(client, channelId) {
    return client.channels.cache.get(channelId)
        ?? (await client.channels.fetch(channelId).catch(() => null));
}

async function getGuild(client) {
    return client.guilds.cache.get(config.SERVER_ID)
        ?? (await client.guilds.fetch(config.SERVER_ID).catch(() => null));
}

async function getEligibleVoters(guild, candidateId) {
    const members = await guild.members.fetch().catch((error) => {
        log.warn("Falha ao buscar membros para votacao privada:", error.message);
        return null;
    });

    if (!members) {
        return [];
    }

    return [...members.values()]
        .filter((member) => !member.user.bot && member.id !== candidateId)
        .map((member) => member.id);
}

async function updatePrivatePollStaffMessage(client, messageId, memberOverride = null) {
    const pendingPoll = normalizePendingPollData(pendingPolls[messageId]);
    const channel = await getPollChannel(client, pendingPoll.channelId);
    if (!channel?.isTextBased()) {
        return null;
    }

    const staffMessage = await channel.messages.fetch(messageId).catch(() => null);
    if (!staffMessage) {
        return null;
    }

    const guild = await getGuild(client);
    const member = memberOverride
        ?? (pendingPoll.memberId ? await guild?.members.fetch(pendingPoll.memberId).catch(() => null) : null);
    const displayMember = member || `<@${pendingPoll.memberId}>`;
    const { yesVotes, noVotes } = getPrivateVoteCounts(pendingPoll);

    await staffMessage.edit({
        content: messages.buildPrivatePollStaffMessage(displayMember, {
            roleTracks: pendingPoll.roleTracks,
            thresholdGames: pendingPoll.thresholdGames,
            roleGames: pendingPoll.roleGames,
            yesVotes,
            noVotes,
            sentCount: pendingPoll.dmSentCount,
            failedCount: pendingPoll.dmFailedCount,
            endsAt: pendingPoll.endsAt,
        }),
    }).catch((error) => {
        log.warn(`Falha ao atualizar placar da votacao ${messageId}:`, error.message);
    });

    return staffMessage;
}

async function sendPrivatePollDms(client, messageId, member, voterIds, options) {
    let sentCount = 0;
    let failedCount = 0;
    const deliveredVoters = [];
    const content = messages.buildPrivatePollDm(member, options);
    const components = buildPrivatePollButtons(messageId);

    for (const voterId of voterIds) {
        const user = await client.users.fetch(voterId).catch(() => null);
        if (!user) {
            failedCount += 1;
            continue;
        }

        const dmMessage = await user.send({ content, components }).catch((error) => {
            log.warn(`Nao foi possivel enviar DM de votacao para ${voterId}:`, error.message);
            return null;
        });

        if (dmMessage) {
            sentCount += 1;
            deliveredVoters.push(voterId);
        } else {
            failedCount += 1;
        }
    }

    const pendingPoll = normalizePendingPollData(pendingPolls[messageId]);
    pendingPoll.dmSentCount = sentCount;
    pendingPoll.dmFailedCount = failedCount;
    pendingPoll.eligibleVoters = deliveredVoters;
    pendingPolls[messageId] = pendingPoll;
    savePendingPolls();
}

async function openPoll(channel, member, options = {}) {
    const roleTracks = normalizeRoleTracks(options.roleTracks);
    const endsAt = Date.now() + config.POLL_DURATION_MS;
    const pollOptions = {
        roleTracks,
        thresholdGames: options.thresholdGames ?? config.POLL_THRESHOLD_GAMES,
        roleGames: options.roleGames,
        endsAt,
    };

    try {
        const message = await channel.send({
            content: messages.buildPrivatePollStaffMessage(member, pollOptions),
            allowedMentions: { users: [member.id] },
        });
        pendingPolls[message.id] = {
            mode: "dm",
            memberId: member.id,
            endsAt,
            roleTracks,
            channelId: channel.id,
            thresholdGames: pollOptions.thresholdGames,
            roleGames: options.roleGames ?? null,
            votes: {},
            eligibleVoters: [],
            dmSentCount: 0,
            dmFailedCount: 0,
        };
        savePendingPolls();

        const guild = member.guild ?? await getGuild(channel.client);
        const voterIds = guild ? await getEligibleVoters(guild, member.id) : [];
        await sendPrivatePollDms(channel.client, message.id, member, voterIds, pollOptions);
        await updatePrivatePollStaffMessage(channel.client, message.id, member);

        log.poll(
            `Votacao privada aberta para ${member.user.tag} (${roleTracks.join(", ") || "sem trilha"}) | DMs ${pendingPolls[message.id].dmSentCount}/${voterIds.length}.`
        );
        return message;
    } catch (error) {
        log.error("Erro ao criar votacao privada:", error.message);
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

async function resolvePollOutcome(client, channel, messageId, pendingPoll, yesVotes, noVotes) {
    const guild = await getGuild(client);
    const member = pendingPoll.memberId
        ? await guild?.members.fetch(pendingPoll.memberId).catch(() => null)
        : null;
    let roleTracks = await resolveStoredRoleTracks(messageId, pendingPoll);

    if (!roleTracks.length) {
        log.warn(`Votacao ${messageId} ignorada; trilha de posicao nao encontrada.`);
        await updateVoteStatusByMessageId(messageId, "missing_role_track").catch((error) => {
            log.error("Falha ao marcar votacao sem trilha no banco:", error.message);
        });
        removePendingPoll(messageId);
        return "missing_role_track";
    }

    if (member) {
        const approvedRoleTracks = getMemberApprovedRoleTracks(member);
        const pendingRoleTracks = roleTracks.filter((track) => !approvedRoleTracks.includes(track));

        if (roleTracks.length && !pendingRoleTracks.length) {
            log.warn(`Votacao ${messageId} ignorada; ${member.user.tag} ja possui cargo aprovado.`);
            await updateVoteStatusByMessageId(messageId, "already_approved").catch((error) => {
                log.error("Falha ao marcar votacao duplicada no banco:", error.message);
            });
            removePendingPoll(messageId);
            return "already_approved";
        }

        roleTracks = pendingRoleTracks;
    }

    if (roleTracks.length > 1) {
        log.warn(`Votacao ${messageId} sera resolvida para multiplas trilhas: ${roleTracks.join(", ")}`);
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
            log.ok(`Membro aprovado pela votacao: ${member.user.tag}`);
        } else {
            await channel.send(messages.pollApprovedNotFound(pendingPoll.memberId));
        }
    } else if (noVotes > yesVotes) {
        status = "rejected";

        if (member) {
            const approvedRoleTracks = getMemberApprovedRoleTracks(member)
                .filter((track) => !roleTracks.includes(track));

            if (approvedRoleTracks.length) {
                const testRoleIds = getRoleIdsForTracks(roleTracks, "test");

                if (testRoleIds.length) {
                    await member.roles.remove(testRoleIds).catch((error) => {
                        log.error("Falha ao remover cargos de teste:", error.message);
                    });
                }

                await channel.send(
                    `A votacao encerrou! **${member.user.tag}** foi reprovado(a) nesta posicao. O cargo de teste foi removido.`
                );
                log.ok(`Membro reprovado em ${roleTracks.join(", ")}; mantido no servidor por ja possuir outra aprovacao: ${member.user.tag}`);
            } else {
                await channel.send(messages.pollRejected(member.user.tag));
                await member.kick("Reprovado na votacao da comunidade.").catch((error) => {
                    log.error("Falha ao kickar membro reprovado:", error.message);
                });
                log.ok(`Membro reprovado e removido: ${member.user.tag}`);
            }
        } else {
            await channel.send(messages.pollRejectedNotFound(pendingPoll.memberId));
        }
    } else {
        await channel.send(messages.pollTie(pendingPoll.memberId));
        log.poll(`Empate na votacao ${messageId}.`);
    }

    await updateVoteStatusByMessageId(messageId, status).catch((error) => {
        log.error("Falha ao atualizar status da votacao no banco:", error.message);
    });

    return status;
}

async function finalizeDiscordPoll(client, channel, messageId, pendingPoll) {
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

    await resolvePollOutcome(client, channel, messageId, pendingPoll, yesVotes, noVotes);
    await message.delete().catch(() => {
        log.warn(`Nao foi possivel deletar a mensagem da enquete ${messageId}`);
    });
    removePendingPoll(messageId);
}

async function finalizePrivatePoll(client, channel, messageId, pendingPoll) {
    const { yesVotes, noVotes } = getPrivateVoteCounts(pendingPoll);
    const status = await resolvePollOutcome(client, channel, messageId, pendingPoll, yesVotes, noVotes);
    const staffMessage = pendingPolls[messageId]
        ? await updatePrivatePollStaffMessage(client, messageId)
        : null;

    if (staffMessage) {
        await staffMessage.edit({
            content: `${staffMessage.content}\n\nEncerrada com status: **${status}**.`,
            components: [],
        }).catch(() => null);
    }

    removePendingPoll(messageId);
}

async function finalizePoll(client, messageId) {
    const pendingPoll = normalizePendingPollData(pendingPolls[messageId]);
    const channel = await getPollChannel(client, pendingPoll.channelId);

    if (!channel || !channel.isTextBased()) {
        log.warn(`Canal da votacao nao encontrado: ${pendingPoll.channelId}`);
        return;
    }

    if (pendingPoll.mode === "dm") {
        await finalizePrivatePoll(client, channel, messageId, pendingPoll);
        return;
    }

    await finalizeDiscordPoll(client, channel, messageId, pendingPoll);
}

async function checkAllPendingPolls(client) {
    const ids = Object.keys(pendingPolls);
    if (!ids.length) {
        return;
    }

    log.poll(`Verificando ${ids.length} votacao(oes) pendente(s).`);

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

    log.poll(`Restaurando ${count} votacao(oes) pendente(s) apos restart.`);
    await checkAllPendingPolls(client);
}

function registerPollInteractionHandler(client) {
    if (interactionHandlerRegistered) {
        return;
    }

    interactionHandlerRegistered = true;

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isButton()) {
            return;
        }

        const parsed = parsePrivatePollCustomId(interaction.customId);
        if (!parsed) {
            return;
        }

        const pendingPoll = normalizePendingPollData(pendingPolls[parsed.messageId]);
        if (pendingPoll.mode !== "dm" || !pendingPolls[parsed.messageId]) {
            await interaction.reply({ content: "Essa votacao ja foi encerrada." }).catch(() => null);
            return;
        }

        if (Date.now() >= pendingPoll.endsAt) {
            await interaction.reply({ content: "Essa votacao ja encerrou." }).catch(() => null);
            return;
        }

        if (!pendingPoll.eligibleVoters.includes(interaction.user.id)) {
            await interaction.reply({ content: "Voce nao esta habilitado(a) para votar nesta votacao." }).catch(() => null);
            return;
        }

        pendingPoll.votes[interaction.user.id] = parsed.vote;
        pendingPolls[parsed.messageId] = pendingPoll;
        savePendingPolls();

        await updatePrivatePollStaffMessage(client, parsed.messageId);
        await interaction.update({
            content: formatDmVoteContent(interaction.message.content, parsed.vote),
            components: buildPrivatePollButtons(parsed.messageId),
        }).catch(async () => {
            await interaction.reply({
                content: `Voto registrado: **${parsed.vote === "yes" ? "Sim" : "Nao"}**.`,
            }).catch(() => null);
        });
    });
}

module.exports = {
    openPoll,
    checkAllPendingPolls,
    restorePendingPolls,
    registerPollInteractionHandler,
};
