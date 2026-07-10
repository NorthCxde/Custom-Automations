const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
    name: 'gcreate',
    description: 'Create a giveaway using a modal form.',
    data: new SlashCommandBuilder()
        .setName('gcreate')
        .setDescription('Create a giveaway using a modal form.'),
    async executeInteraction({ interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('gv_create_modal')
            .setTitle('Create a Giveaway');

        const duration = new TextInputBuilder()
            .setCustomId('gv_duration')
            .setLabel('Duration')
            .setPlaceholder('Ex: 10 minutes')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80);

        const winners = new TextInputBuilder()
            .setCustomId('gv_winners')
            .setLabel('Number of Winners')
            .setPlaceholder('1')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(2);

        const prize = new TextInputBuilder()
            .setCustomId('gv_prize')
            .setLabel('Prize')
            .setPlaceholder('$10 Robux')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(200);

        const description = new TextInputBuilder()
            .setCustomId('gv_description')
            .setLabel('Description')
            .setPlaceholder('Optional description')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500);

        modal.addComponents(
            new ActionRowBuilder().addComponents(duration),
            new ActionRowBuilder().addComponents(winners),
            new ActionRowBuilder().addComponents(prize),
            new ActionRowBuilder().addComponents(description)
        );

        return interaction.showModal(modal);
    }
};
