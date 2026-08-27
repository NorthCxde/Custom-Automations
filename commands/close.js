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

        try {
            // ack immediately, since unfollowing every thread member can take longer than the 3s interaction window
            await interaction.deferReply({ ephemeral: true });
            const result = await client.closeForumPost({ thread: interaction.channel, closedBy: interaction.user, reason });
            return await interaction.editReply({ content: result.success ? 'Post closed.' : result.error });
        } catch (err) {
            console.error('Failed to close forum post via /close command:', err);
            const content = 'Something went wrong while closing this post. Check the bot logs.';
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content }).catch(() => null);
            }
            return interaction.reply({ content, ephemeral: true }).catch(() => null);
        }
    }
};
