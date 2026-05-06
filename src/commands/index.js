const {
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require("discord.js");

const commands = [
    new SlashCommandBuilder()
        .setName("votacao")
        .setDescription("Gerencia votacoes privadas de aprovacao.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
                        .setName("trilha")
                        .setDescription("Cargo/trilha de aprovacao.")
                        .setRequired(true)
                        .addChoices(
                            { name: "LINHA", value: "major" },
                            { name: "GK", value: "gkmajor" }
                        )
                )
                .addIntegerOption((option) =>
                    option
                        .setName("partidas")
                        .setDescription("Numero de partidas exibido na votacao.")
                        .setMinValue(1)
                        .setRequired(false)
                )
                .addBooleanOption((option) =>
                    option
                        .setName("forcar")
                        .setDescription("Reabre mesmo se ja existir votacao registrada para essa trilha.")
                        .setRequired(false)
                )
        )
        .toJSON(),
];

module.exports = commands;
