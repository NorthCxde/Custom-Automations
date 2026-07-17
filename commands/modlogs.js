const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const MODLOGS_PAGE_SIZE = 10;

function parseModlogsPageCustomId(customId) {
    const raw = String(customId || '');
    if (!raw.startsWith('modlogs_page:')) return null;
    const parts = raw.split(':');
    if (parts.length < 5) return null;
    const page = Number(parts[2]);
    if (!Number.isInteger(page) || page < 0) return null;
    return {
        page,
        targetUserId: parts[3] === 'all' ? null : parts[3],
        ownerId: parts[4]
    };
}

function parseMentionOrId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const mention = raw.match(/^<@!?(\d{17,20})>$/);
    if (mention) return mention[1];
    if (/^\d{17,20}$/.test(raw)) return raw;
    return null;
}

function truncate(text, max = 220) {
    const value = String(text || '').trim();
    if (!value) return 'No reason provided.';
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function getActionBadge(action) {
    const normalized = String(action || '').trim().toLowerCase();
    if (normalized === 'mute') return '🔇';
    if (normalized === 'unmute') return '🔊';
    if (normalized === 'ban') return '⛔';
    if (normalized === 'unban') return '✅';
    if (normalized === 'kick') return '👢';
    if (normalized === 'warn') return '⚠️';
    return '📌';
}

function formatDuration(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return raw
        .replace(/\b(\d+)h\b/gi, '$1 hour')
        .replace(/\b(\d+)d\b/gi, '$1 day')
        .replace(/\b(\d+)m\b/gi, '$1 minute');
}

function getTimeBlockLabel(date) {
    const hour = date.getHours();
    if (hour < 6) return 'Late Night (00:00-05:59)';
    if (hour < 12) return 'Morning (06:00-11:59)';
    if (hour < 18) return 'Afternoon (12:00-17:59)';
    return 'Evening (18:00-23:59)';
}

function formatTimestampBlock(timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.getTime())) {
        return {
            when: 'Unknown',
            block: 'Unknown'
        };
    }

    const unix = Math.floor(parsed.getTime() / 1000);
    return {
        when: `<t:${unix}:F> • <t:${unix}:R>`,
        block: getTimeBlockLabel(parsed)
    };
}

function buildModlogsPayload({ logs, user, page = 0, ownerId = '0', targetUserId = null }) {
    const totalPages = Math.max(1, Math.ceil(logs.length / MODLOGS_PAGE_SIZE));
    const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
    const start = safePage * MODLOGS_PAGE_SIZE;
    const displayLogs = logs.slice(start, start + MODLOGS_PAGE_SIZE);
    const separator = '────────────────────────';
    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle(user ? `Modlogs for ${user.username}` : 'All Moderation Logs')
        .setDescription(user
            ? `${user.id}\n\nShowing ${displayLogs.length} of ${logs.length} records | Page ${safePage + 1}/${totalPages}`
            : `Showing ${displayLogs.length} of ${logs.length} records | Page ${safePage + 1}/${totalPages}`)
        .setTimestamp();

    for (const entry of displayLogs) {
        const action = String(entry.action || 'Unknown');
        const badge = getActionBadge(action);
        const timestampInfo = formatTimestampBlock(entry.timestamp);
        const lines = [];
        lines.push(`**Type**: ${badge} ${action}`);
        lines.push(`**User**: <@${entry.userId}>`);
        lines.push(`**Moderator**: <@${entry.moderatorId}>`);
        if (entry.duration) {
            const formattedDuration = formatDuration(entry.duration);
            lines.push(`**Length**: ${formattedDuration || entry.duration}`);
        }
        if (entry.count) lines.push(`**Count**: ${entry.count}`);
        if (entry.channelId) lines.push(`**Channel**: <#${entry.channelId}>`);
        lines.push(`**Reason**: ${truncate(entry.reason || 'No reason provided.')}`);
        lines.push(`**Date**: ${timestampInfo.when}`);
        lines.push(`**Time Block**: ${timestampInfo.block}`);
        lines.push(separator);

        embed.addFields({
            name: `Case ${entry.caseNumber ?? entry.caseId ?? 'N/A'}  —  ${badge} ${action}`,
            value: lines.join('\n'),
            inline: false
        });
    }

    const components = [];

    if (logs.length > MODLOGS_PAGE_SIZE) {
        const normalizedTarget = targetUserId || user?.id || 'all';
        const prevButton = new ButtonBuilder()
            .setCustomId(`modlogs_page:goto:${Math.max(0, safePage - 1)}:${normalizedTarget}:${ownerId}`)
            .setLabel('Previous Page')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0);
        const nextButton = new ButtonBuilder()
            .setCustomId(`modlogs_page:goto:${Math.min(totalPages - 1, safePage + 1)}:${normalizedTarget}:${ownerId}`)
            .setLabel('Next Page')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1);
        components.push(new ActionRowBuilder().addComponents(prevButton, nextButton));
    }

    components.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('modlogs_remove_button')
                .setLabel('Remove Log')
                .setStyle(ButtonStyle.Danger)
        )
    );

    return { embeds: [embed], components };
}

module.exports = {
    name: 'modlogs',
    description: 'Show moderation history for a user, or all guild logs if no user is selected.',
    data: new SlashCommandBuilder()
        .setName('modlogs')
        .setDescription('Show moderation history for a user, or all guild logs if no user is selected.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose moderation history you want to view')
                .setRequired(false)),
    async execute({ client, message, args }) {
        if (!message.guild) return null;

        let user = null;
        if (args[0]) {
            const parsedId = parseMentionOrId(args[0]);
            if (!parsedId) {
                return message.reply('Please provide a valid user mention or ID.');
            }
            user = await client.users.fetch(parsedId).catch(() => null);
            if (!user) {
                return message.reply('Could not find that user.');
            }
        }

        const logs = client.getModLogs(message.guild.id, user?.id);
        if (!logs || logs.length === 0) {
            if (user) {
                return message.reply(`No moderation history found for ${user.tag}.`);
            }
            return message.reply('No moderation logs are available for this server.');
        }

        return message.reply(buildModlogsPayload({
            logs,
            user,
            page: 0,
            ownerId: message.author.id,
            targetUserId: user?.id || null
        }));
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const logs = client.getModLogs(interaction.guild.id, user?.id);

        if (!logs || logs.length === 0) {
            if (user) {
                return interaction.reply({ content: `No moderation history found for ${user.tag}.`, ephemeral: true });
            }
            return interaction.reply({ content: 'No moderation logs are available for this server.', ephemeral: true });
        }

        return interaction.reply({
            ...buildModlogsPayload({
                logs,
                user,
                page: 0,
                ownerId: interaction.user.id,
                targetUserId: user?.id || null
            }),
            ephemeral: true
        });
    },
    async handleButton({ client, interaction }) {
        const parsed = parseModlogsPageCustomId(interaction.customId);
        if (!parsed) return false;

        if (!interaction.guild) {
            await interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            return true;
        }

        if (parsed.ownerId && parsed.ownerId !== '0' && parsed.ownerId !== interaction.user.id) {
            await interaction.reply({ content: 'Only the user who opened this modlogs panel can switch pages.', ephemeral: true });
            return true;
        }

        const logs = client.getModLogs(interaction.guild.id, parsed.targetUserId || undefined);
        if (!logs || logs.length === 0) {
            await interaction.reply({ content: 'No moderation logs are available for this view anymore.', ephemeral: true });
            return true;
        }

        let targetUser = null;
        if (parsed.targetUserId) {
            targetUser = await client.users.fetch(parsed.targetUserId).catch(() => null);
        }

        await interaction.update(buildModlogsPayload({
            logs,
            user: targetUser,
            page: parsed.page,
            ownerId: parsed.ownerId || interaction.user.id,
            targetUserId: parsed.targetUserId
        }));
        return true;
    }
};
