const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const QUOTA_PERCENT = 8;

function isBanEntry(entry) {
    const action = String(entry?.action || '').trim().toLowerCase();
    return action === 'ban' || action === 'blacklist';
}

function getMonthRange(date = new Date()) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    return { year, month, start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) };
}

function getCurrentMonthBans(logs, date = new Date()) {
    const { start, end } = getMonthRange(date);
    return logs.filter(entry => {
        if (!isBanEntry(entry)) return false;
        const timestamp = new Date(entry.timestamp || '').getTime();
        return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
    });
}

function formatMonth(year, month) {
    return new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    });
}

async function buildStatsEmbed(client, guild, logs) {
    const now = new Date();
    const { year, month } = getMonthRange(now);
    const bans = getCurrentMonthBans(logs, now);
    const counts = new Map();

    for (const entry of bans) {
        const moderatorId = String(entry.moderatorId || '').trim();
        if (moderatorId) counts.set(moderatorId, (counts.get(moderatorId) || 0) + 1);
    }

    const rows = await Promise.all(Array.from(counts.entries()).map(async ([moderatorId, count]) => ({
        moderatorId,
        count,
        member: await guild.members.fetch(moderatorId).catch(() => null)
    })));

    rows.sort((left, right) => {
        const leftPosition = left.member?.roles?.highest?.position ?? 0;
        const rightPosition = right.member?.roles?.highest?.position ?? 0;
        if (leftPosition !== rightPosition) return rightPosition - leftPosition;
        return left.moderatorId.localeCompare(right.moderatorId);
    });

    const lines = rows.length
        ? rows.map(row => {
            const percentage = bans.length ? (row.count / bans.length) * 100 : 0;
            const indicator = percentage >= QUOTA_PERCENT ? '✅' : '⚠️';
            return `${indicator} <@${row.moderatorId}> — ${row.count} bans (${percentage.toFixed(1)}%)`;
        })
        : ['No bans recorded this month.'];

    return new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle(`Mod quota standings — ${formatMonth(year, month)}`)
        .setDescription([`Total bans: **${bans.length}**`, '', ...lines].join('\n'));
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
    QUOTA_PERCENT
};
