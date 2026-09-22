const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    name: 'addmod',
    data: new SlashCommandBuilder()
        .setName('addmod')
        .setDescription('Add a Discord user as a moderator.')
        .addStringOption(option =>
            option
                .setName('discord_id')
                .setDescription('The Discord user ID to add as a mod')
                .setRequired(true)
        ),
    async executeInteraction({ client, interaction }) {
        const discordId = interaction.options.getString('discord_id', true).trim();
        if (!/^\d{17,20}$/.test(discordId)) {
            return interaction.reply({
                content: 'Please provide a valid Discord user ID.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!client.addManualModerator(discordId)) {
            return interaction.reply({
                content: 'That Discord user ID could not be added.',
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            content: `<@${discordId}> has been added as a moderator. They can now use /info and /register.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { users: [discordId] }
        });
    }
};
