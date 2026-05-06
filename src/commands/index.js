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
];

module.exports = commands;
