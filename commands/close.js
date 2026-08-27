const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'close',
    description: 'Close (lock) the current forum post.',
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close (lock) the current forum post.')
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason the post was closed')
                .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild || !interaction.channel?.isThread()) {
            return interaction.reply({ content: 'This command must be used inside a forum post.', ephemeral: true });
        }
        if (!client.isMemberAllowed(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to close this post.', ephemeral: true });
        }
        if (!client.isForumPingThread(interaction.channel)) {
            return interaction.reply({ content: 'This command can only be used in a monitored forum post.', ephemeral: true });
        }

        const reason = interaction.options.getString('reason');
        const result = await client.closeForumPost({ thread: interaction.channel, closedBy: interaction.user, reason });
        return interaction.reply({ content: result.success ? 'Post closed.' : result.error, ephemeral: true });
    }
};
