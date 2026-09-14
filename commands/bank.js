const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'bank',
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Basic bank command'),
    async executeInteraction({ interaction }) {
        await interaction.reply({
            content: 'Bank command works.',
            ephemeral: true
        });
    }
};
