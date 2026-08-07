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

module.exports = {
    name: 'afk',
    description: 'AFK commands',
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('AFK commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription("Set an AFK status shown when you're mentioned, and display in nickname.")
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Message to set')
                        .setRequired(true)
                        .setMaxLength(150))),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== 'set') {
            return interaction.reply({ content: 'Unknown AFK subcommand.', ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const key = getAfkStateKey(guildId, userId);
        const now = Date.now();
        const cooldownUntil = Number(client.afkSetCooldowns.get(key) || 0);

        if (cooldownUntil > now) {
            return interaction.reply({
                content: `<@${interaction.user.id}>, a little too quick there.`,
                allowedMentions: { parse: [], users: [interaction.user.id], roles: [], repliedUser: false },
                ephemeral: true
            });
        }

        const afkMessage = String(interaction.options.getString('message') || '').trim();
        if (!afkMessage) {
            return interaction.reply({ content: 'Please provide a message to set.', ephemeral: true });
        }

        const member = interaction.member;
        const previousState = client.getAfkState(guildId, userId);
        const originalNickname = previousState
            ? previousState.originalNickname
            : (member && 'nickname' in member ? member.nickname ?? null : null);

        client.setAfkState({
            guildId,
            userId,
            message: afkMessage,
            setAt: now,
            returnEnabledAt: now + AFK_RETURN_GRACE_MS,
            originalNickname,
            notifyUsers: previousState?.notifyUsers || [],
            leaveMessages: previousState?.leaveMessages || []
        });

        if (member?.manageable) {
            const baseName = member.displayName || interaction.user.globalName || interaction.user.username;
            await member.setNickname(buildAfkNickname(baseName), 'AFK enabled').catch(() => null);
        }

        return interaction.reply({
            content: `<@${interaction.user.id}> I set your AFK: ${afkMessage}`,
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