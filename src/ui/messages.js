const { EmbedBuilder } = require("discord.js");
const config = require("../utils/config");
const { formatDurationMs } = require("../utils/time");
const { getRoleTrackLabel, normalizeRoleTracks } = require("../utils/roleTracks");

const COLORS = {
    active: 0x2f80ed,
    approved: 0x27ae60,
    rejected: 0xeb5757,
    tied: 0xf2c94c,
};

function startup() {
    let text = [
        `Bot iniciado no perfil ${config.PROFILE_NAME.toUpperCase()}.`,
        config.DEBUG_MODE
            ? "DEBUG_MODE ativo: usando servidor de testes e enquetes curtas."
            : "DEBUG_MODE inativo: usando servidor oficial.",
    ].join(" ");

    if (config.AUTO_FORCESTART_ENABLED) {
        text += `\nAutoForceStart ativo: forcestart apos ${formatDurationMs(config.AUTO_FORCESTART_DELAY_MS)} em ${config.TARGET_PLAYERS}/${config.FULL_PLAYERS}.`;
    }

    if (config.SMART_PING_ENABLED) {
        text += `\nSmart ping ativo: alerta a partir de ${config.SMART_PING_MIN_PLAYERS} player(s) com cooldown de ${config.SMART_PING_COOLDOWN_SECONDS}s.`;
    }

    if (config.RESULT_AUDIT_ENABLED) {
        text += "\nAuditoria de resultados alterados ativa via DM.";
    }

    return text;
}

function buildPollMessage(member, options = {}) {
    const roleTracks = normalizeRoleTracks(options.roleTracks);
    const labels = roleTracks.map(getRoleTrackLabel);
    const trackText = labels.length ? ` como **${labels.join(" / ")}**` : "";
    const gamesText = options.roleGames != null
        ? `${options.roleGames}/${options.thresholdGames || config.POLL_THRESHOLD_GAMES}`
        : config.POLL_THRESHOLD_GAMES;

    return {
        content: `@everyone\n# Enquete de aprovacao - ${member} chegou a **${gamesText} partidas${trackText}** e finalizou a fase de teste.\nVote abaixo se ele(a) merece ser promovido(a).${config.DEBUG_MODE ? "\n[debug] Veredito sera processado na proxima verificacao." : ""}`,
        allowedMentions: { parse: ["everyone", "users"] },
        poll: {
            question: { text: `${member.user.username} merece o cargo de ${labels.join(" / ") || "aprovado"}?` },
            answers: [{ text: "Sim" }, { text: "Nao" }],
            duration: config.DEBUG_MODE ? 1 : 24,
            allowMultiselect: false,
        },
    };
}

function buildPrivatePollStaffMessage(member, options = {}) {
    const payload = buildPrivatePollStaffPayload(member, options);
    const fields = payload.embeds?.[0]?.data?.fields || [];

    return [
        payload.content,
        payload.embeds?.[0]?.data?.title,
        payload.embeds?.[0]?.data?.description,
        ...fields.map((field) => `${field.name}: ${field.value}`),
    ].filter(Boolean).join("\n");
}

function buildPrivatePollStaffPayload(member, options = {}) {
    const roleTracks = normalizeRoleTracks(options.roleTracks);
    const labels = roleTracks.map(getRoleTrackLabel);
    const positionText = labels.join(" / ") || "Aprovado";
    const gamesText = options.roleGames != null
        ? `${options.roleGames}/${options.thresholdGames || config.POLL_THRESHOLD_GAMES}`
        : config.POLL_THRESHOLD_GAMES;
    const yesVotes = options.yesVotes ?? 0;
    const noVotes = options.noVotes ?? 0;
    const totalVotes = yesVotes + noVotes;
    const sentCount = options.sentCount ?? 0;
    const failedCount = options.failedCount ?? 0;
    const status = options.status || "active";
    const statusLabel = {
        active: "Aberta",
        approved: "Aprovada",
        rejected: "Reprovada",
        tied: "Empatada",
        already_approved: "Ignorada",
        missing_role_track: "Ignorada",
    }[status] || status;
    const endsAt = Math.floor((options.endsAt || Date.now()) / 1_000);
    const memberName = member?.user?.tag || member?.user?.username || String(member);
    const memberMention = String(member);
    const color = COLORS[status] || COLORS.active;
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("Votacao de aprovacao")
        .setDescription(`${memberMention} finalizou a fase de teste. Vote no privado do bot.`)
        .addFields(
            { name: "Jogador", value: `${memberMention}\n${memberName}`, inline: true },
            { name: "Posicao", value: positionText, inline: true },
            { name: "Partidas", value: String(gamesText), inline: true },
            { name: "Placar", value: `Sim: **${yesVotes}**\nNao: **${noVotes}**\nTotal: **${totalVotes}**`, inline: true },
            { name: "DMs", value: `Enviadas: **${sentCount}**\nFalhas: **${failedCount}**`, inline: true },
            { name: "Status", value: `${statusLabel}\n<t:${endsAt}:R>`, inline: true }
        )
        .setFooter({ text: "Os votos sao privados. O placar mostra apenas totais." })
        .setTimestamp();

    return {
        content: `@everyone\nVotacao privada de aprovacao aberta para ${memberMention}. Confiram a DM do bot para votar.`,
        embeds: [embed],
        allowedMentions: { parse: ["everyone", "users"] },
    };
}

function buildPrivatePollDm(member, options = {}) {
    const payload = buildPrivatePollDmPayload(member, options);
    const fields = payload.embeds?.[0]?.data?.fields || [];

    return [
        payload.content,
        payload.embeds?.[0]?.data?.title,
        payload.embeds?.[0]?.data?.description,
        ...fields.map((field) => `${field.name}: ${field.value}`),
    ].filter(Boolean).join("\n");
}

function buildPrivatePollDmPayload(member, options = {}) {
    const roleTracks = normalizeRoleTracks(options.roleTracks);
    const labels = roleTracks.map(getRoleTrackLabel);
    const positionText = labels.join(" / ") || "Aprovado";
    const gamesText = options.roleGames != null
        ? `${options.roleGames}/${options.thresholdGames || config.POLL_THRESHOLD_GAMES}`
        : config.POLL_THRESHOLD_GAMES;
    const selectedVote = options.selectedVote || null;
    const selectedText = selectedVote
        ? (selectedVote === "yes" ? "Sim" : "Nao")
        : "Ainda nao votou";
    const memberName = member?.user?.tag || member?.user?.username || String(member);
    const memberMention = String(member);
    const embed = new EmbedBuilder()
        .setColor(selectedVote === "no" ? COLORS.rejected : selectedVote === "yes" ? COLORS.approved : COLORS.active)
        .setTitle("Votacao privada de aprovacao")
        .setDescription(`${memberMention} chegou a **${gamesText} partidas** e finalizou a fase de teste.`)
        .addFields(
            { name: "Jogador", value: `${memberMention}\n${memberName}`, inline: true },
            { name: "Posicao", value: positionText, inline: true },
            { name: "Seu voto", value: selectedText, inline: true }
        )
        .setFooter({ text: "Seu voto e privado. Voce pode mudar ate a votacao encerrar." })
        .setTimestamp();

    return {
        content: "Escolha uma opcao abaixo.",
        embeds: [embed],
        allowedMentions: { users: [member?.id].filter(Boolean) },
    };
}

function buildSmartPingMessage(_queueSnapshot, roleIds) {
    const mentions = roleIds.map((roleId) => `<@&${roleId}>`).join(" ");

    return {
        content: mentions,
        allowedMentions: { roles: roleIds },
    };
}

function buildResultAuditDm(data) {
    const lines = [
        "**Alerta de resultado alterado**",
        `Modificado por: ${data.modifierName}`,
        `Horario: ${data.modifiedAt}`,
        `Fila: #${data.queueNumber}`,
        `Transcript: ${data.transcriptUrl || "Nao encontrado"}`,
        `Mensagem: ${data.messageUrl}`,
    ];

    return lines.join("\n");
}

const messages = {
    startup,
    buildPollMessage,
    buildPrivatePollDm,
    buildPrivatePollDmPayload,
    buildPrivatePollStaffMessage,
    buildPrivatePollStaffPayload,
    buildSmartPingMessage,
    buildResultAuditDm,
    pollApproved: (member) =>
        `A enquete encerrou! ${member} foi aprovado(a) pela comunidade e recebeu o cargo.`,
    pollApprovedNotFound: (memberId) =>
        `A enquete encerrou com aprovacao, mas o membro <@${memberId}> nao foi encontrado no servidor.`,
    pollRejected: (tag) =>
        `A enquete encerrou! **${tag}** foi reprovado(a) pela comunidade e removido(a) do servidor.`,
    pollRejectedNotFound: (memberId) =>
        `A enquete encerrou com reprovacao, mas o membro <@${memberId}> ja nao esta no servidor.`,
    pollTie: (memberId) =>
        `A enquete encerrou em empate para <@${memberId}>. Nenhuma acao foi tomada.`,
    forceStartArmed: () =>
        `A fila ficou em **${config.TARGET_PLAYERS}/${config.FULL_PLAYERS}**. Forcestart automatico em **${formatDurationMs(config.AUTO_FORCESTART_DELAY_MS)}** se permanecer assim.`,
    forceStartSent: () =>
        `Forcestart automatico enviado apos ${formatDurationMs(config.AUTO_FORCESTART_DELAY_MS)} com **${config.TARGET_PLAYERS}/${config.FULL_PLAYERS}**.`,
    forceStartError: (status) =>
        `NeatQueue retornou erro no forcestart. Status: ${status}.`,
    forceStartFailed: () =>
        "Falha ao enviar o forcestart automatico. Verifique permissoes e token da API do NeatQueue.",
};

module.exports = messages;
