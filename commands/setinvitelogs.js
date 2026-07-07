const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
    name: 'setinvitelogs',
    description: 'Set the invite tracker log channel.',
    data: new SlashCommandBuilder()
        .setName('setinvitelogs')
        .setDescription('Set the invite tracker log channel.')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel where invite join logs should be sent')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel', true);
        if (!channel || !channel.isTextBased()) {
            return interaction.reply({ content: 'Please select a valid text channel.', ephemeral: true });
        }

        client.setInviteLogChannelId(interaction.guild.id, channel.id);

        await interaction.reply({
            content: `Invite tracker logs will now be sent in ${channel}.`,
            ephemeral: true
        });

        try {
            await client.refreshInviteCacheForGuild(interaction.guild);
        } catch {
            // Best-effort refresh; command still succeeds.
        }
    }
};
