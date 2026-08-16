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
    const avatarUrl = typeof member?.displayAvatarURL === 'function'
        ? member.displayAvatarURL({ extension: 'png', size: 4096, forceStatic: true })
        : user.displayAvatarURL({ extension: 'png', size: 4096, forceStatic: true });
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
    const normalized = String(rawTarget || '').trim();
    if (!normalized || ['me', 'myself', 'self'].includes(normalized.toLowerCase())) {
        return source.user || source.author;
    }

    const userId = extractUserId(normalized);
    if (userId) {
        return await client.users.fetch(userId).catch(() => null);
    }

    const guild = source?.guild || source?.member?.guild || null;
    const query = normalized.toLowerCase();
    if (!guild || !query) return null;

    const member = guild.members.cache.find((candidate) => {
        const candidateUser = candidate.user || null;
        const displayName = String(candidate.displayName || '').toLowerCase();
        const globalName = String(candidateUser?.globalName || '').toLowerCase();
        const username = String(candidateUser?.username || '').toLowerCase();
        const nickname = String(candidate.nickname || '').toLowerCase();
        return displayName.includes(query)
            || globalName.includes(query)
            || username.includes(query)
            || nickname.includes(query);
    }) || null;

    if (!member) return null;
    return member.user || null;
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
            return message.reply('Please provide a valid user mention, user ID, or guild username.');
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
