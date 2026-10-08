const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'dm',
    description: 'Send a silent DM to a user.',
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a DM to a user silently.')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to DM')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The message to send')
                .setRequired(true)
                .setMaxLength(2000)
        )
        .setDMPermission(false),
    async executeInteraction({ interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: 'You need Manage Server to use this command.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user', true);
        const dmText = String(interaction.options.getString('message', true) || '').trim();

        if (!dmText) {
            return interaction.reply({ content: 'Please provide a message to send.', ephemeral: true });
        }

        try {
            await targetUser.send(dmText);
            return interaction.reply({ content: `✅ DM sent to <@${targetUser.id}>.`, ephemeral: true });
        } catch (error) {
            console.error('Failed to send DM:', error);
            return interaction.reply({ content: 'Unable to send a DM to that user. They may have DMs disabled.', ephemeral: true });
        }
    }
};
