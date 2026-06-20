const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
    name: 'manuallogschannel',
    description: 'Configure secondary manual moderation log channels for mute and ban actions.',
    data: new SlashCommandBuilder()
        .setName('manuallogschannel')
        .setDescription('Configure secondary manual moderation log channels for mute and ban actions.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set one or both manual moderation log channels')
                .addChannelOption(option =>
                    option
                        .setName('mute_channel')
                        .setDescription('Channel for mute manual logs')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('ban_channel')
                        .setDescription('Channel for ban manual logs')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear one or both manual moderation log channels')
                .addStringOption(option =>
                    option
                        .setName('target')
                        .setDescription('Which configured channel(s) to clear')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Mute Channel', value: 'mute' },
                            { name: 'Ban Channel', value: 'ban' },
                            { name: 'Both Channels', value: 'both' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View current manual moderation log channel settings')
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const current = client.getManualLogsChannels(interaction.guild.id);

        if (subcommand === 'view') {
            const muteText = current.muteChannelId ? `<#${current.muteChannelId}>` : 'Not set';
            const banText = current.banChannelId ? `<#${current.banChannelId}>` : 'Not set';
            return interaction.reply({
                content: `Manual logs channels:\n- Mute: ${muteText}\n- Ban: ${banText}`,
                ephemeral: true
            });
        }

        if (subcommand === 'clear') {
            const target = interaction.options.getString('target', true);
            const updates = {};
            if (target === 'mute' || target === 'both') updates.muteChannelId = null;
            if (target === 'ban' || target === 'both') updates.banChannelId = null;

            const next = client.setManualLogsChannels(interaction.guild.id, updates);
            const muteText = next.muteChannelId ? `<#${next.muteChannelId}>` : 'Not set';
            const banText = next.banChannelId ? `<#${next.banChannelId}>` : 'Not set';

            return interaction.reply({
                content: `Manual logs channels updated.\n- Mute: ${muteText}\n- Ban: ${banText}`,
                ephemeral: true
            });
        }

        const muteChannel = interaction.options.getChannel('mute_channel');
        const banChannel = interaction.options.getChannel('ban_channel');

        if (!muteChannel && !banChannel) {
            return interaction.reply({ content: 'Provide at least one channel (mute_channel or ban_channel).', ephemeral: true });
        }

        const updates = {};
        if (muteChannel) updates.muteChannelId = muteChannel.id;
        if (banChannel) updates.banChannelId = banChannel.id;

        const next = client.setManualLogsChannels(interaction.guild.id, updates);
        const muteText = next.muteChannelId ? `<#${next.muteChannelId}>` : 'Not set';
        const banText = next.banChannelId ? `<#${next.banChannelId}>` : 'Not set';

        return interaction.reply({
            content: `Manual logs channels updated.\n- Mute: ${muteText}\n- Ban: ${banText}`,
            ephemeral: true
        });
    }
};
