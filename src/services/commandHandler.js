const { PermissionFlagsBits } = require("discord.js");
const config = require("../utils/config");
const {
    createVote,
    getVoteByUserAndThreshold,
} = require("../database/create");
const { openPoll } = require("./polls");
const { getPlayerRoleGameCounts } = require("./neatqueue");
const { getRoleTrackLabel, getRoleTrackStatsKey } = require("../utils/roleTracks");
const log = require("./logger");

let commandHandlerRegistered = false;

async function getPollChannel(client) {
    return client.channels.cache.get(config.CHANNEL_ID)
        ?? (await client.channels.fetch(config.CHANNEL_ID).catch(() => null));
}

function canManageVotes(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

async function handleOpenVoteCommand(interaction) {
    if (!canManageVotes(interaction)) {
        await interaction.reply({
            content: "Somente administradores podem abrir votacoes.",
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser("jogador", true);
    const roleTrack = interaction.options.getString("posicao")
        ?? interaction.options.getString("trilha");
    const force = interaction.options.getBoolean("forcar") ?? false;
    const thresholdGames = config.POLL_THRESHOLD_GAMES;

    if (!roleTrack) {
        await interaction.editReply("Informe a posicao da votacao.");
        return;
    }

    if (user.bot) {
        await interaction.editReply("Nao da para abrir votacao para bot.");
        return;
    }

    const guild = interaction.guild
        ?? (await interaction.client.guilds.fetch(config.SERVER_ID).catch(() => null));
    const member = await guild?.members.fetch(user.id).catch(() => null);
    if (!member) {
        await interaction.editReply(`Nao encontrei ${user} no servidor.`);
        return;
    }

    if (!force) {
        const existingVote = await getVoteByUserAndThreshold(user.id, thresholdGames, roleTrack);
        if (existingVote) {
            await interaction.editReply(
                `Ja existe uma votacao registrada para ${user} nessa posicao com status **${existingVote.status}**. Use \`forcar:true\` para reabrir mesmo assim.`
            );
            return;
        }
    }

    const roleGameCounts = await getPlayerRoleGameCounts(user.id);
    if (!roleGameCounts) {
        await interaction.editReply(`Nao consegui consultar as partidas por posicao de ${user} na NeatQueue.`);
        return;
    }

    if (roleGameCounts.missing) {
        await interaction.editReply(
            `${user} tem ${roleGameCounts.missing} partida(s) sem posicao no historico da NeatQueue. Corrija isso antes de abrir a votacao para eu nao mostrar uma contagem errada.`
        );
        return;
    }

    const roleLabel = getRoleTrackLabel(roleTrack);
    const statsKey = getRoleTrackStatsKey(roleTrack);
    const roleGames = Number(roleGameCounts[statsKey] || 0);

    const pollChannel = await getPollChannel(interaction.client);
    if (!pollChannel?.isTextBased()) {
        await interaction.editReply(`Canal de votacao nao encontrado: ${config.CHANNEL_ID}`);
        return;
    }

    const pollMessage = await openPoll(pollChannel, member, {
        roleTracks: [roleTrack],
        thresholdGames,
        roleGames,
    });

    if (!pollMessage) {
        await interaction.editReply("Falha ao abrir a votacao privada. Veja os logs do bot.");
        return;
    }

    await createVote({
        discordUserId: user.id,
        discordTag: member.user.tag,
        roleTrack,
        thresholdGames,
        totalGamesWhenTriggered: roleGames,
        roleTracks: [roleTrack],
        voteMessageId: pollMessage.id,
        voteChannelId: pollChannel.id,
        status: "open",
    });

    await interaction.editReply(
        `Votacao privada aberta para ${user} como **${roleLabel}** com **${roleGames}/${thresholdGames}** partidas. Canal: <#${pollChannel.id}>. Mensagem: ${pollMessage.url}`
    );
    log.poll(`Votacao aberta por comando para ${member.user.tag} (${roleTrack}: ${roleGames}/${thresholdGames}) por ${interaction.user.tag}.`);
}

function registerCommandHandler(client) {
    if (commandHandlerRegistered) {
        return;
    }

    commandHandlerRegistered = true;

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand()) {
            return;
        }

        try {
            if (interaction.commandName === "votacao") {
                const subcommand = interaction.options.getSubcommand();
                if (subcommand === "abrir") {
                    await handleOpenVoteCommand(interaction);
                }
            }
        } catch (error) {
            log.error("Erro ao executar comando:", error.stack || error.message || error);
            const content = "Erro ao executar o comando. Veja os logs do bot.";

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(content).catch(() => null);
            } else {
                await interaction.reply({ content, ephemeral: true }).catch(() => null);
            }
        }
    });
}

module.exports = {
    registerCommandHandler,
};
