const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const statsCommand = require('./stats');

const QUOTA_PERCENT = 8;
const MAX_ROWS = 25;
const STATS_TIME_ZONE = 'America/New_York';

function formatMonth(date) {
    return date.toLocaleDateString('en-US', {
        month: 'long',
        timeZone: STATS_TIME_ZONE
    });
}

function getRecentModeratorStats(client, guildId, logs, date = new Date()) {
    const cutoff = date.getTime() - (30 * 24 * 60 * 60 * 1000);
    const stats = new Map();
    for (const entry of logs) {
        const timestamp = new Date(entry.timestamp || '').getTime();
        if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;

        const rawModeratorId = String(entry.moderatorId || '').trim();
        if (!rawModeratorId) continue;
        const moderatorId = client.whitelistedModeratorIds?.has(rawModeratorId)
            ? String(client.statsOwnerId || rawModeratorId)
            : rawModeratorId;
        const current = stats.get(moderatorId) || { mutes: 0, discordBans: 0 };
        const action = String(entry.action || '').trim().toLowerCase();
        if (action === 'mute') current.mutes += 1;
        if (action === 'ban' || action === 'temp ban') current.discordBans += 1;
        stats.set(moderatorId, current);
    }

    for (const [moderatorId, overrides] of client.modStatsOverrides?.get(guildId) || []) {
        if (!overrides?.['30d']) continue;
        stats.set(String(moderatorId), {
            mutes: Math.max(0, Number(overrides['30d'].mutes) || 0),
            discordBans: Math.max(0, Number(overrides['30d'].bans) || 0)
        });
    }

    return stats;
}

function formatLastMonthChange(currentCount, previousCount) {
    if (!previousCount && currentCount) return ' **(N/A Last month)**';
    const change = previousCount ? ((currentCount - previousCount) / previousCount) * 100 : 0;
    const sign = change > 0 ? '+' : '';
    const indicator = change > 0 ? '📈' : change < 0 ? '📉' : '';
    return ` **(${sign}${change.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% Last month${indicator ? ` ${indicator}` : ''})**`;
}

function buildSummaryEmbed(client, guild, includeServerStats = false, traineeId = null, includeLastMonth = false, now = new Date()) {
    const logs = client.getModLogs(guild.id) || [];
    const { counts, totalBans } = statsCommand.getModeratorBanCounts(client, guild.id, logs, now, traineeId);
    const { year, month } = statsCommand.getMonthRange(now);
    const previousMonthDate = new Date(Date.UTC(year, month - 1, 15, 12));
    const previousStats = includeLastMonth
        ? statsCommand.getModeratorBanCounts(client, guild.id, logs, previousMonthDate, traineeId)
        : null;
    const traineeBans = traineeId
        ? Math.max(0, statsCommand.getModeratorBanCounts(client, guild.id, logs, now).totalBans - totalBans)
        : 0;
    const recentStats = includeServerStats
        ? getRecentModeratorStats(client, guild.id, logs, now)
        : new Map();
    const rows = Array.from(counts.entries())
        .map(([moderatorId, count]) => ({
            moderatorId,
            count,
            percentage: totalBans ? (count / totalBans) * 100 : 0,
            ...(recentStats.get(moderatorId) || { mutes: 0, discordBans: 0 })
        }))
        .sort((left, right) => right.count - left.count || left.moderatorId.localeCompare(right.moderatorId))
        .slice(0, MAX_ROWS);

    const topCandidates = traineeId
        ? [...rows, { moderatorId: traineeId, count: traineeBans }]
        : rows;
    const topEntry = [...topCandidates].sort((left, right) =>
        right.count - left.count || left.moderatorId.localeCompare(right.moderatorId)
    )[0];
    const topModerator = topEntry?.moderatorId
        ? `<@${topEntry.moderatorId}>`
        : 'None';
    const lines = rows.length
        ? rows.map((row, index) => {
            const indicator = row.percentage < 4 ? '❌' : row.percentage >= QUOTA_PERCENT ? '✅' : '⚠️';
            const serverStats = includeServerStats
                ? ` | **${row.mutes}** Mutes | **${row.discordBans}** Discord Bans`
                : '';
            const lastMonth = includeLastMonth
                ? formatLastMonthChange(row.count, previousStats.counts.get(row.moderatorId) || 0)
                : '';
            return `${index + 1}. <@${row.moderatorId}> ${indicator} **(${row.percentage.toFixed(1)}%)** | **${row.count}** Roblox Bans${serverStats}${lastMonth}`;
        })
        : ['No Roblox bans recorded this month.'];

    const embed = new EmbedBuilder()
        .setTitle('Moderator Summary')
        .setDescription([
            `## ${formatMonth(now)}`,
            `Total Bans: **${totalBans.toLocaleString()}**${includeLastMonth ? formatLastMonthChange(totalBans, previousStats.totalBans) : ''}`,
            ...(traineeId ? ['(excluding trainee)'] : []),
            '',
            `Top Moderator: ${topModerator}`,
            '',
            lines.join('\n\n')
        ].join('\n'));

    if (traineeId) {
        const traineeStats = includeServerStats
            ? getRecentModeratorStats({ ...client, whitelistedModeratorIds: new Set() }, guild.id, logs, now).get(traineeId)
            : null;
        const serverStats = includeServerStats
            ? ` | **${traineeStats?.mutes || 0}** Mutes | **${traineeStats?.discordBans || 0}** Discord Bans`
            : '';
        const previousTraineeBans = includeLastMonth
            ? Math.max(0, statsCommand.getModeratorBanCounts(client, guild.id, logs, previousMonthDate).totalBans - previousStats.totalBans)
            : 0;
        embed.addFields({
            name: 'Trainee Total Bans:',
            value: `1. <@${traineeId}> | **${traineeBans}** Roblox Bans${serverStats}${includeLastMonth ? formatLastMonthChange(traineeBans, previousTraineeBans) : ''}`
        });
    }
    return embed;
}

module.exports = {
    name: 'summary',
    description: 'Show the moderator Roblox-ban summary.',
    data: new SlashCommandBuilder()
        .setName('summary')
        .setDescription('Show the moderator Roblox-ban summary.')
        .addStringOption(option => option
            .setName('visibility')
            .setDescription('Choose who can see the summary')
            .setRequired(true)
            .addChoices(
                { name: 'Visible', value: 'visible' },
                { name: 'Ephemeral', value: 'ephemeral' }
            ))
        .addBooleanOption(option => option
            .setName('server_stats')
            .setDescription('Include Discord Stats (optional)')
            .setRequired(false))
        .addUserOption(option => option
            .setName('trainee')
            .setDescription('Show this trainee separately and exclude their bans from moderator quota')
            .setRequired(false))
        .addStringOption(option => option
            .setName('last_month')
            .setDescription('Compare Roblox ban counts with the previous calendar month')
            .addChoices(
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            )
            .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const visibility = interaction.options.getString('visibility', true);
        const includeServerStats = interaction.options.getBoolean('server_stats') === true;
        const trainee = interaction.options.getUser('trainee');
        const includeLastMonth = interaction.options.getString('last_month') === 'yes';
        return interaction.reply({
            embeds: [buildSummaryEmbed(client, interaction.guild, includeServerStats, trainee?.id, includeLastMonth)],
            ephemeral: visibility !== 'visible'
        });
    },
    buildSummaryEmbed
};
