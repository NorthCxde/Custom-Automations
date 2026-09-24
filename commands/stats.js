const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const QUOTA_PERCENT = 8;
const QUOTA_TIME_ZONE = 'America/New_York';

function isBanEntry(entry) {
    const action = String(entry?.action || '').trim().toLowerCase();
    return (action === 'ban' || action === 'blacklist')
        && entry?.source === 'trello_blacklist';
}

function getTimeZoneParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: QUOTA_TIME_ZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    }).formatToParts(date);
    return Object.fromEntries(parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]));
}

function getTimeZoneOffsetMs(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: QUOTA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]));
    return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - date.getTime();
}

function getEasternMidnightUtc(year, month) {
    let timestamp = Date.UTC(year, month, 1);
    timestamp -= getTimeZoneOffsetMs(new Date(timestamp));
    timestamp -= getTimeZoneOffsetMs(new Date(timestamp));
    return timestamp;
}

function getMonthRange(date = new Date()) {
    const { year, month } = getTimeZoneParts(date);
    return {
        year,
        month: month - 1,
        start: getEasternMidnightUtc(year, month - 1),
        end: getEasternMidnightUtc(year, month)
    };
}

function getCurrentMonthBans(logs, date = new Date()) {
    const { start, end } = getMonthRange(date);
    const currentMonthBans = logs.filter(entry => {
        if (!isBanEntry(entry)) return false;
        const timestamp = new Date(entry.timestamp || '').getTime();
        return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
    });
    const uniqueBans = new Map();
    for (const entry of currentMonthBans) {
        const userId = String(entry.userId || '').trim();
        const blacklistType = String(entry.blacklistType || '').trim().toLowerCase();
        const key = `${userId}:${blacklistType}`;
        if (userId && blacklistType && !uniqueBans.has(key)) {
            uniqueBans.set(key, entry);
        }
    }
    return Array.from(uniqueBans.values());
}

function formatMonth(year, month) {
    return new Date(getEasternMidnightUtc(year, month)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: QUOTA_TIME_ZONE
    });
}

function getMonthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

async function buildStatsEmbed(client, guild, logs) {
    const now = new Date();
    const { year, month } = getMonthRange(now);
    const bans = getCurrentMonthBans(logs, now);
    const counts = new Map();
    const monthKey = getMonthKey(year, month);
    const overrides = client.statsOverrides?.get(guild.id)?.get(monthKey) || new Map();

    for (const moderatorId of client.manualModerators || []) {
        counts.set(String(moderatorId), 0);
    }

    for (const entry of bans) {
        const moderatorId = String(entry.moderatorId || '').trim();
        if (moderatorId) counts.set(moderatorId, (counts.get(moderatorId) || 0) + 1);
    }

    for (const [moderatorId, count] of overrides.entries()) {
        counts.set(String(moderatorId), Number(count) || 0);
    }

    const totalBans = Array.from(counts.values()).reduce((total, count) => total + count, 0);

    const rows = await Promise.all(Array.from(counts.entries()).map(async ([moderatorId, count]) => ({
        moderatorId,
        count,
        member: await guild.members.fetch(moderatorId).catch(() => null)
    })));

    rows.sort((left, right) => right.count - left.count || left.moderatorId.localeCompare(right.moderatorId));

    const lines = rows.length
        ? rows.map(row => {
            const percentage = totalBans ? (row.count / totalBans) * 100 : 0;
            const indicator = percentage >= QUOTA_PERCENT ? '✅' : '⚠️';
            return `${indicator} <@${row.moderatorId}> — ${row.count} bans (${percentage.toFixed(1)}%)`;
        })
        : ['No bans recorded this month.'];

    return new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle(`Mod quota standings — ${formatMonth(year, month)}`)
        .setDescription([`Total bans: **${totalBans}**`, '', ...lines].join('\n'));
}

module.exports = {
    name: 'stats',
    description: 'Show current-month moderator quota standings.',
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show current-month moderator quota standings.'),
    async execute({ client, message }) {
        if (!message.guild) return null;
        const embed = await buildStatsEmbed(client, message.guild, client.getModLogs(message.guild.id));
        return message.reply({ embeds: [embed] });
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', flags: MessageFlags.Ephemeral });
        }
        const embed = await buildStatsEmbed(client, interaction.guild, client.getModLogs(interaction.guild.id));
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
    isBanEntry,
    getCurrentMonthBans,
    getMonthRange,
    buildStatsEmbed,
    QUOTA_PERCENT
};
