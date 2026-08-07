const { SlashCommandBuilder } = require('discord.js');

const AFK_RETURN_GRACE_MS = 30_000;

function getAfkStateKey(guildId, userId) {
    return `${String(guildId || '')}:${String(userId || '')}`;
}

function stripAfkPrefix(value) {
    return String(value || '').replace(/^\[AFK\]\s*/i, '').trim();
}

function buildAfkNickname(value) {
    const prefix = '[AFK] ';
    const base = stripAfkPrefix(value) || 'AFK';
    const full = `${prefix}${base}`;
    return full.length <= 32 ? full : `${prefix}${base.slice(0, 32 - prefix.length)}`;
}

async function setAfk({ client, guild, user, member, afkMessage }) {
    const guildId = guild.id;
    const userId = user.id;
    const key = getAfkStateKey(guildId, userId);
    const now = Date.now();
    const cooldownUntil = Number(client.afkSetCooldowns.get(key) || 0);

    if (cooldownUntil > now) {
        return { ok: false, content: `${user.username}, a little too quick there.` };
    }

    const normalizedMessage = String(afkMessage || '').trim();
    if (!normalizedMessage) {
        return { ok: false, content: 'Please provide a message to set.' };
    }

    const previousState = client.getAfkState(guildId, userId);
    const originalNickname = previousState
        ? previousState.originalNickname
        : (member && 'nickname' in member ? member.nickname ?? null : null);

    client.setAfkState({
        guildId,
        userId,
        message: normalizedMessage,
        setAt: now,
        returnEnabledAt: now + AFK_RETURN_GRACE_MS,
        originalNickname,
        notifyUsers: previousState?.notifyUsers || [],
        leaveMessages: previousState?.leaveMessages || []
    });

    if (member?.manageable) {
        const baseName = member.displayName || user.globalName || user.username;
        await member.setNickname(buildAfkNickname(baseName), 'AFK enabled').catch(() => null);
    }

    return { ok: true, content: `<@${user.id}> I set your AFK: ${normalizedMessage}` };
}

module.exports = {
    name: 'afk',
    description: 'AFK commands',
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription("Set an AFK status shown when you're mentioned, and display in nickname.")
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message to set')
                .setRequired(true)
                .setMaxLength(150)),
    async execute({ client, message, args }) {
        if (!message.guild) {
            return message.reply('This command must be used in a server channel.');
        }

        const afkMessage = String((args || []).join(' ') || '').trim();
        const result = await setAfk({
            client,
            guild: message.guild,
            user: message.author,
            member: message.member,
            afkMessage
        });

        return message.reply({
            content: result.content,
            allowedMentions: { parse: [], users: [message.author.id], roles: [], repliedUser: false }
        });
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand(false);

        if (subcommand === 'settings') {
            const notifyButton = interaction.options.getBoolean('notify_button');
            client.setAfkNotifyEnabled(interaction.guild.id, interaction.user.id, notifyButton);
            return interaction.reply({
                content: notifyButton
                    ? 'The \'Tell me when back\' button is now **enabled** on your AFK notices.'
                    : 'The \'Tell me when back\' button is now **disabled** on your AFK notices.',
                ephemeral: true
            });
        }

        if (subcommand !== null && subcommand !== 'set') {
            return interaction.reply({ content: 'Unknown AFK subcommand.', ephemeral: true });
        }

        const afkMessage = String(interaction.options.getString('message') || '').trim();
        const result = await setAfk({
            client,
            guild: interaction.guild,
            user: interaction.user,
            member: interaction.member,
            afkMessage
        });

        return interaction.reply({
            content: result.content,
            allowedMentions: { parse: [], users: [interaction.user.id], roles: [], repliedUser: false },
            ephemeral: true
        });
    },
    async handleButton({ client, interaction }) {
        if (!interaction.customId.startsWith('afk_notify_me:')) {
            return false;
        }

        const [, guildId, userId] = interaction.customId.split(':');
        if (!guildId || !userId) {
            await interaction.reply({ content: 'This AFK action is missing data.', ephemeral: true });
            return true;
        }

        const state = client.getAfkState(guildId, userId);
        if (!state) {
            await interaction.reply({ content: 'That user is no longer AFK.', ephemeral: true });
            return true;
        }

        const member = interaction.guild?.members?.cache.get(userId)
            || await interaction.guild?.members?.fetch(userId).catch(() => null);
        const displayName = stripAfkPrefix(member?.displayName || interaction.client?.users?.cache.get(userId)?.username || 'User');

        if (interaction.user.id === userId) {
            await interaction.reply({ content: 'You are the AFK user.', ephemeral: true });
            return true;
        }

        const added = client.addAfkNotificationSubscriber(guildId, userId, interaction.user.id, interaction.channelId || 'dm');
        await interaction.reply({
            content: added ? `I will tell you when ${displayName} is back.` : `You are already subscribed for when ${displayName} is back.`,
            ephemeral: true
        });
        return true;
    }
};