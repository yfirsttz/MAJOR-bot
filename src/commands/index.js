const {
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js");

const commands = [
    new SlashCommandBuilder()
        .setName("votacao")
        .setDescription("Gerencia votacoes privadas de aprovacao.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("abrir")
                .setDescription("Abre uma votacao privada para um jogador especifico.")
                .addUserOption((option) =>
                    option
                        .setName("jogador")
                        .setDescription("Jogador que sera avaliado.")
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName("posicao")
                        .setDescription("Posicao de aprovacao.")
                        .setRequired(true)
                        .addChoices(
                            { name: "LINHA", value: "major" },
                            { name: "GK", value: "gkmajor" }
                        )
                )
                .addBooleanOption((option) =>
                    option
                        .setName("forcar")
                        .setDescription("Reabre mesmo se ja existir votacao registrada para essa posicao.")
                        .setRequired(false)
                )
        )
        .toJSON(),
    new SlashCommandBuilder()
        .setName("smartping")
        .setDescription("Gerencia configuracoes do smart ping.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("cooldown")
                .setDescription("Mostra ou altera o cooldown do ping.")
                .addIntegerOption((option) =>
                    option
                        .setName("segundos")
                        .setDescription("Novo cooldown em segundos.")
                        .setMinValue(1)
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("resetar-cooldown")
                .setDescription("Volta o cooldown para o valor configurado no .env.")
        )
        .toJSON(),
];

module.exports = commands;
