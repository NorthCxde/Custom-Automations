const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');

function parseDuration(value) {
    const match = String(value || '').trim().match(/^(\d+)([mhd])$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    const multipliers = { m: 60_000, h: 3_600_000, d: 86_400_000 };
    const durationMs = amount * multipliers[match[2].toLowerCase()];
    return Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : null;
}

function getPrefixUserId(value) {
    const normalized = String(value || '').replace(/[<@!>]/g, '');
    return /^\d{17,20}$/.test(normalized) ? normalized : null;
}

function buildCommand() {
    return new SlashCommandBuilder()
        .setName('tempban')
        .setDescription('Temporarily ban one or more users from the guild')
        .addUserOption(option => option.setName('user').setDescription('The first user to temporarily ban').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Ban duration, e.g. 1m, 2h, or 3d').setRequired(true))
        .addUserOption(option => option.setName('user2').setDescription('Another user to temporarily ban').setRequired(false))
        .addUserOption(option => option.setName('user3').setDescription('Another user to temporarily ban').setRequired(false))
        .addUserOption(option => option.setName('user4').setDescription('Another user to temporarily ban').setRequired(false))
        .addAttachmentOption(option => option.setName('evidence1').setDescription('Screenshot evidence 1').setRequired(false))
        .addAttachmentOption(option => option.setName('evidence2').setDescription('Screenshot evidence 2').setRequired(false))
        .addAttachmentOption(option => option.setName('evidence3').setDescription('Screenshot evidence 3').setRequired(false))
        .addAttachmentOption(option => option.setName('evidence4').setDescription('Screenshot evidence 4').setRequired(false))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the temporary bans').setRequired(false));
}

async function applyTempBans({ client, guild, targetIds, durationRaw, moderator, reason }) {
    const durationMs = parseDuration(durationRaw);
    if (!durationMs) return { error: 'Use a valid duration such as `1m`, `2h`, or `3d`.' };
    if (!guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return { error: 'I do not have permission to ban members.' };
    }

    const unbanAt = Date.now() + durationMs;
    const results = await Promise.all(targetIds.map(async (userId) => {
        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member && typeof client.isModerationImmuneMember === 'function' && client.isModerationImmuneMember(member)) {
                return { userId, success: false, error: `${member.user.username} is immune to moderation actions.` };
            }

            const user = await client.users.fetch(userId).catch(() => null);
            await client.sendModerationDm({
                userId,
                guildName: guild.name,
                action: 'ban',
                reason: `${reason} (Temporary ban: ${durationRaw})`
            });
            await guild.members.ban(userId, { reason: `${reason} (Temporary ban: ${durationRaw})` });
            client.addTempBan({ guildId: guild.id, userId, userTag: user?.tag || `<@${userId}>`, unbanAt });

            if (client.addModLog) {
                const robloxId = client.getLinkedRobloxId
                    ? await client.getLinkedRobloxId(guild.id, userId).catch(() => null)
                    : null;
                await client.addModLog(guild.id, {
                    action: 'Temp Ban', userId, userTag: user?.tag || `<@${userId}>`, robloxId,
                    moderatorId: moderator.id, moderatorTag: moderator.tag,
                    reason, duration: durationRaw, timestamp: new Date().toISOString()
                });
            }
            return { userId, user, success: true };
        } catch (error) {
            console.error('Failed to temporarily ban user:', error);
            return { userId, success: false, error: error.message || 'Unknown error' };
        }
    }));

    return { results, unbanAt };
}

module.exports = {
    name: 'tempban',
    description: 'Temporarily ban one or more users from the guild',
    data: buildCommand(),
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');
        const userId = getPrefixUserId(args[0]);
        const durationRaw = args[1];
        if (!userId || !parseDuration(durationRaw)) {
            return message.reply('Usage: `?tempban <user mention or ID> <duration> [reason]`\nExample: `?tempban 123456789012345678 1d Repeated spam`');
        }

        const outcome = await applyTempBans({
            client,
            guild: message.guild,
            targetIds: [userId],
            durationRaw,
            moderator: message.author,
            reason: args.slice(2).join(' ') || 'No reason provided'
        });
        if (outcome.error) return message.reply(outcome.error);

        const result = outcome.results[0];
        if (!result.success) return message.reply(`Could not temporarily ban that user: ${result.error}`);
        return message.reply(`Temporarily banned ${result.user?.username || `<@${userId}>`} for ${durationRaw}.`);
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.BanMembers)) {
            return interaction.reply({ content: 'You need Ban Members permission to use this command.', ephemeral: true });
        }

        const users = ['user', 'user2', 'user3', 'user4'].map(name => interaction.options.getUser(name)).filter(Boolean);
        const durationRaw = interaction.options.getString('duration');
        const evidenceFiles = ['evidence1', 'evidence2', 'evidence3', 'evidence4']
            .map(name => interaction.options.getAttachment(name)).filter(Boolean);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const outcome = await applyTempBans({
            client, guild: interaction.guild, targetIds: [...new Set(users.map(user => user.id))],
            durationRaw, moderator: interaction.user, reason
        });
        if (outcome.error) return interaction.reply({ content: outcome.error, ephemeral: true });

        const successes = outcome.results.filter(result => result.success);
        const failures = outcome.results.filter(result => !result.success);
        const embed = new EmbedBuilder()
            .setColor(0xfaa61a)
            .setTitle('Temporary Ban Action')
            .addFields(
                { name: 'User(s)', value: users.map(user => `<@${user.id}>`).join(', ') || 'None', inline: false },
                { name: 'Duration', value: durationRaw, inline: true },
                { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Evidence', value: evidenceFiles.length ? `${evidenceFiles.length} attachment(s)` : 'None', inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp();

        if (client.logToChannel) {
            await client.logToChannel(interaction.guild, {
                embeds: [embed], files: evidenceFiles.map(file => ({ attachment: file.url, name: file.name }))
            });
        }

        const response = `${successes.length} user(s) temporarily banned for ${durationRaw}.${failures.length ? ` ${failures.length} could not be banned.` : ''}`;
        return interaction.reply({ content: response, embeds: [embed], ephemeral: true });
    }
};