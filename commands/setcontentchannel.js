const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
    name: 'setcontentchannel',
    data: new SlashCommandBuilder()
        .setName('setcontentchannel')
        .setDescription('Set the channel where creator video links should be auto-reacted with 🔥.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel where YouTube or TikTok video links are posted')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),
    async executeInteraction({ client, interaction }) {
        const channel = interaction.options.getChannel('channel');
        client.contentReactChannels.set(interaction.guildId, channel.id);
        client.saveContentReactChannels();
        return interaction.reply({ content: `Content channel set to ${channel}. I'll react with 🔥 to YouTube and TikTok links posted there.`, ephemeral: true });
    }
};
