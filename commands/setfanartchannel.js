const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');

const FANART_EMOJIS = ['\u2B50', '\u{1F525}', '\u2764\uFE0F'];

async function handleMessage({ client, message }) {
    if (!message.guild || message.author?.bot) return;
    if (client.fanartChannels.get(message.guild.id) !== message.channel.id) return;

    const hasAttachment = [...(message.attachments?.values() || [])].some(attachment => {
        if (attachment.contentType) return /^(image|video)\//i.test(attachment.contentType);
        return /\.(png|jpe?g|gif|webp|avif|bmp|apng|mp4|webm|mov|m4v|avi|mkv)$/i.test(attachment.name || '');
    });
    const hasEmbed = (message.embeds || []).some(embed =>
        embed.image?.url || embed.video?.url
        || (['image', 'video', 'gifv'].includes(embed.type) && (embed.url || embed.thumbnail?.url))
    );
    if (!hasAttachment && !hasEmbed) return;

    for (const emoji of FANART_EMOJIS) {
        if (message.reactions.cache.get(emoji)?.me) continue;
        try {
            await message.react(emoji);
        } catch (error) {
            console.error('Failed to add fanart reaction:', error);
        }
    }
}

module.exports = {
    name: 'setfanartchannel',
    data: new SlashCommandBuilder()
        .setName('setfanartchannel')
        .setDescription('Set the channel where images and videos receive star, fire, and heart reactions.')
        .addChannelOption(option => option
            .setName('channel')
            .setDescription('The fanart channel to watch')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guildId) {
            return interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
        }
        if (!client.hardcodedAdmins?.has(interaction.user.id)) {
            return interaction.reply({ content: 'Only bot admins can set the fanart channel.', flags: MessageFlags.Ephemeral });
        }
        const channel = interaction.options.getChannel('channel', true);
        client.fanartChannels.set(interaction.guildId, channel.id);
        client.saveFanartChannels();
        return interaction.reply({
            content: `Fanart channel set to ${channel}. Images and videos posted there will receive ${FANART_EMOJIS.join(' ')} reactions.`,
            flags: MessageFlags.Ephemeral
        });
    },
    handleMessage
};