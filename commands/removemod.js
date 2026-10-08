const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    name: 'removemod',
    description: 'Remove a Discord user from the moderator list and quota standings.',
    data: new SlashCommandBuilder()
        .setName('removemod')
        .setDescription('Remove a moderator from the list and quota standings.')
        .addStringOption(option => option
            .setName('discord_id')
            .setDescription('The Discord user ID to remove as a moderator')
            .setRequired(true)),
    async executeInteraction({ client, interaction }) {
        const discordId = interaction.options.getString('discord_id', true).trim();
        if (!/^\d{17,20}$/.test(discordId)) {
            return interaction.reply({
                content: 'Please provide a valid Discord user ID.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!client.removeManualModerator(discordId)) {
            return interaction.reply({
                content: 'That user is not on the manually added moderator list.',
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            content: `<@${discordId}> was removed from the moderator list and quota standings. Their historical bans remain included in the total ban count.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { users: [discordId] }
        });
    }
};
