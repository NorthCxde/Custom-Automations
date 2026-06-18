const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
    name: 'setboostchannel',
    data: new SlashCommandBuilder()
        .setName('setboostchannel')
        .setDescription('Set the channel to watch for server boost messages and react with ❤️.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel where boost messages appear')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),
    async executeInteraction({ client, interaction }) {
        const channel = interaction.options.getChannel('channel');
        client.boostChannels.set(interaction.guildId, channel.id);
        client.saveBoostChannels();
        return interaction.reply({ content: `Boost channel set to ${channel}. I'll react with ❤️ to every boost message there.`, ephemeral: true });
    }
};
