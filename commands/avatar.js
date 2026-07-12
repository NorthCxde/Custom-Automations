const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} = require('discord.js');

function extractUserId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const mention = raw.match(/^<@!?(\d{17,20})>$/);
    if (mention) return mention[1];
    if (/^\d{17,20}$/.test(raw)) return raw;
    return null;
}

function buildAvatarPayload(user, member = null) {
    const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 4096, forceStatic: true });
    const title = member?.displayName || user.globalName || user.username;

    const embed = new EmbedBuilder()
        .setColor(0x2f3136)
        .setTitle(title)
        .setImage(avatarUrl);

    const button = new ButtonBuilder()
        .setLabel('Open avatar in browser')
        .setStyle(ButtonStyle.Link)
        .setURL(avatarUrl);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(button)]
    };
}

async function resolveTargetUser(client, source, rawTarget) {
    if (!rawTarget) return source.user || source.author;
    const userId = extractUserId(rawTarget);
    if (!userId) return null;
    return await client.users.fetch(userId).catch(() => null);
}

module.exports = {
    name: 'avatar',
    aliases: ['av'],
    public: true,
    description: 'Show a user avatar with a direct browser link.',
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Show a user avatar with a direct browser link.')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to view (defaults to yourself)')
                .setRequired(false)
        ),
    async execute({ client, message, args }) {
        if (!message.guild) return null;

        const targetUser = await resolveTargetUser(client, message, args[0]);
        if (!targetUser) {
            return message.reply('Please provide a valid user mention or user ID.');
        }

        const member = await message.guild.members.fetch(targetUser.id).catch(() => null);

        return message.reply(buildAvatarPayload(targetUser, member));
    },
    async executeInteraction({ interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        return interaction.reply(buildAvatarPayload(targetUser, member));
    }
};
