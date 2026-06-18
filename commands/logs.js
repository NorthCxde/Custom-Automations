const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
    name: 'logs',
    description: 'Configure the channel where moderation actions are logged.',
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Configure the channel where moderation actions are logged.')
        .setDefaultMemberPermissions(0n)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the channel where logs should be sent')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Select the channel where logs should be sent')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear the currently configured log channel')),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'clear') {
            const currentChannelId = client.getLogChannelId(interaction.guild.id);
            if (!currentChannelId) {
                return interaction.reply({ content: 'No logging channel is currently set.', ephemeral: true });
            }

            const currentChannel = interaction.guild.channels.cache.get(currentChannelId) || await interaction.guild.channels.fetch(currentChannelId).catch(() => null);
            client.logChannels.delete(interaction.guild.id);
            client.saveLogChannels();

            if (currentChannel && currentChannel.isTextBased()) {
                await currentChannel.send(`Logging channel was cleared by ${interaction.user.tag}.`)
                    .catch(() => null);
            }

            return interaction.reply({ content: 'Logging channel configuration cleared.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        if (!channel || !channel.isTextBased()) {
            return interaction.reply({ content: 'Please select a text channel for logs.', ephemeral: true });
        }

        client.logChannels.set(interaction.guild.id, channel.id);
        client.saveLogChannels();

        await interaction.reply({ content: `Logging channel set to ${channel}.`, ephemeral: true });
        await client.logToChannel(interaction.guild, `Logging channel was set to ${channel} by ${interaction.user.tag}.`);
    }
};
