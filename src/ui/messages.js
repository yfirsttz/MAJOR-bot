const config = require("../utils/config");
const { formatDurationMs } = require("../utils/time");
const { getRoleTrackLabel, normalizeRoleTracks } = require("../utils/roleTracks");

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
    const gamesText = options.roleGames
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
