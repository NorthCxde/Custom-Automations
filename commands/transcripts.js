const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

const TRANSCRIPTS_URL = 'https://dashboard.tickets.bot/manage/944796064207220797/transcripts?panel=34428';

module.exports = {
    name: 'transcripts',
    data: new SlashCommandBuilder()
        .setName('transcripts')
        .setDescription('Access online ticket transcripts.'),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
        }

        if (!client.isMemberAllowed(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setDescription('**DO NOT SHARE**');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Online Transcripts')
                .setStyle(ButtonStyle.Link)
                .setURL(TRANSCRIPTS_URL)
        );

        return interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }
};