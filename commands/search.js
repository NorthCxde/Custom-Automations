const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { showDisplayNameSearch } = require('./info');

module.exports = {
    name: 'search',
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Find Roblox users by display name and optionally check item ownership.')
        .addStringOption(option => option
            .setName('displayname')
            .setDescription('Find up to 150 users with this exact Roblox display name')
            .setMaxLength(20)
            .setRequired(true))
        .addStringOption(option => option
            .setName('item')
            .setDescription('Optional Roblox catalog asset ID to prioritize owners')
            .setMaxLength(20)),
    async executeInteraction({ interaction }) {
        const displayName = interaction.options.getString('displayname', true).trim();
        const item = interaction.options.getString('item');
        if (!displayName) {
            return interaction.reply({
                content: 'A Roblox display name is required.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (item !== null && !/^[1-9]\d{0,19}$/.test(item.trim())) {
            return interaction.reply({
                content: 'Enter a valid positive Roblox asset ID for item.',
                flags: MessageFlags.Ephemeral
            });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return showDisplayNameSearch(interaction, displayName, item?.trim() || null);
    }
};
