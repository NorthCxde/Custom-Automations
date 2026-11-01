const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { showDisplayNameSearch } = require('./info');

module.exports = {
    name: 'displayname',
    data: new SlashCommandBuilder()
        .setName('displayname')
        .setDescription('Find Roblox users by exact display name, prioritizing game players.')
        .addStringOption(option => option
            .setName('display_name')
            .setDescription('Display Name: find up to 100 users with this exact Roblox display name')
            .setMaxLength(20)
            .setRequired(true)),
    async executeInteraction({ interaction }) {
        const displayName = interaction.options.getString('display_name', true).trim();
        if (!displayName) {
            return interaction.reply({
                content: 'A Roblox display name is required.',
                flags: MessageFlags.Ephemeral
            });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return showDisplayNameSearch(interaction, displayName);
    }
};
