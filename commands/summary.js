const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const statsCommand = require('./stats');

const QUOTA_PERCENT = 8;
const MAX_ROWS = 25;
const STATS_TIME_ZONE = 'America/New_York';
const TRAINEE_ROLE_ID = '1217365422501003284';

function formatMonth(date) {
    return date.toLocaleDateString('en-US', {
        month: 'long',
        timeZone: STATS_TIME_ZONE
    });
}

function getRecentModeratorStats(client, guildId, logs, date = new Date()) {
    const stats = new Map();
    const moderatorIds = new Set(logs.map(entry => String(entry.moderatorId || '').trim()).filter(Boolean));
    for (const moderatorId of client.modStatsOverrides?.get(guildId)?.keys() || []) moderatorIds.add(String(moderatorId));
    for (const rawModeratorId of moderatorIds) {
        if (!rawModeratorId) continue;
        const moderatorId = client.whitelistedModeratorIds?.has(rawModeratorId)
            ? String(client.statsOwnerId || rawModeratorId)
            : rawModeratorId;
        const current = stats.get(moderatorId) || { mutes: 0, discordBans: 0 };
        const counts = require('./modstats').getDiscordModstatsCounts(client, guildId, rawModeratorId, '30d', date.getTime());
        current.mutes += counts.mutes;
        current.discordBans += counts.bans;
        stats.set(moderatorId, current);
    }
    return stats;
}

function formatLastMonthChange(currentCount, previousCount) {
    if (!previousCount && currentCount) return ' **(N/A Last month)**';
    const change = previousCount ? ((currentCount - previousCount) / previousCount) * 100 : 0;
    const sign = change > 0 ? '+' : '';
    const indicator = change > 0 ? '<:increase:1528565392245653615>' : '<:decrease:1528565414207160521>';
    return ` **(${sign}${change.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% Last month${indicator ? ` ${indicator}` : ''})**`;
}

function buildSummaryEmbed(client, guild, includeServerStats = false, traineeIds = [], includeLastMonth = false, now = new Date(), isMidMonth = false) {
    const trainees = new Set(
        traineeIds instanceof Set || Array.isArray(traineeIds)
            ? [...traineeIds].map(String)
            : traineeIds ? [String(traineeIds)] : []
    );
    const logs = client.getModLogs(guild.id) || [];
    const { counts, totalBans } = statsCommand.getModeratorBanCounts(client, guild.id, logs, now, trainees);
    const grandTotal = statsCommand.getModeratorBanCounts(client, guild.id, logs, now).totalBans;
    const { year, month } = statsCommand.getMonthRange(now);
    const previousMonthDate = new Date(Date.UTC(year, month - 1, 15, 12));
    const previousStats = includeLastMonth
        ? statsCommand.getModeratorBanCounts(client, guild.id, logs, previousMonthDate, trainees)
        : null;
    const previousGrandTotal = includeLastMonth
        ? statsCommand.getModeratorBanCounts(client, guild.id, logs, previousMonthDate).totalBans
        : 0;
    const traineeClient = { ...client, whitelistedModeratorIds: new Set(), removedModerators: new Set() };
    const allStats = statsCommand.getModeratorBanCounts(traineeClient, guild.id, logs, now);
    const previousTraineeCounts = trainees.size && includeLastMonth
        ? statsCommand.getModeratorBanCounts(traineeClient, guild.id, logs, previousMonthDate).counts
        : new Map();
    const traineeRows = [...trainees].map(moderatorId => ({
        moderatorId,
        count: allStats.counts.get(moderatorId) || 0
    })).sort((left, right) => right.count - left.count || left.moderatorId.localeCompare(right.moderatorId));
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

    const topCandidates = [...rows, ...traineeRows];
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
            return `${index + 1}. <@${row.moderatorId}> ${indicator} **(${row.percentage.toFixed(1)}%)** | **${row.count}** Roblox Bans${serverStats}${lastMonth ? `\n⤷${lastMonth}` : ''}`;
        })
        : ['No Roblox bans recorded this month.'];

    const embed = new EmbedBuilder()
        .setTitle(isMidMonth ? 'Mid-Month Moderator Summary' : 'Moderator Summary')
        .setDescription([
            `## ${formatMonth(now)}`,
            `**Total Bans:** **${grandTotal.toLocaleString()}**${includeLastMonth ? formatLastMonthChange(grandTotal, previousGrandTotal) : ''}`,
            `**Top Moderator:** ${topModerator}`,
            '',
            `Moderators: **${totalBans.toLocaleString()}**${includeLastMonth ? formatLastMonthChange(totalBans, previousStats.totalBans) : ''}`,
            ...(trainees.size ? ['-# (excluding trainees)'] : []),
            '',
            lines.join('\n\n')
        ].join('\n'));

    if (trainees.size) {
        const traineeStats = includeServerStats
            ? getRecentModeratorStats(traineeClient, guild.id, logs, now)
            : new Map();
        const traineeLines = traineeRows.map((row, index) => {
            const percentage = allStats.totalBans ? (row.count / allStats.totalBans) * 100 : 0;
            const indicator = percentage < 4 ? '❌' : percentage >= QUOTA_PERCENT ? '✅' : '⚠️';
            const discordStats = traineeStats.get(row.moderatorId);
            const serverStats = includeServerStats
                ? ` | **${discordStats?.mutes || 0}** Mutes | **${discordStats?.discordBans || 0}** Discord Bans`
                : '';
            const lastMonth = includeLastMonth
                ? formatLastMonthChange(row.count, previousTraineeCounts.get(row.moderatorId) || 0)
                : '';
            return `${index + 1}. <@${row.moderatorId}> ${indicator} | **${row.count}** Roblox Bans${serverStats}${lastMonth ? `\n⤷${lastMonth}` : ''}`;
        });
        const traineeHeading = 'Trainee Bans:\n';
        let fieldValue = '';
        for (const line of traineeLines) {
            if (fieldValue && traineeHeading.length + fieldValue.length + line.length + 2 > 1024) {
                embed.addFields({ name: '\u200b', value: traineeHeading + fieldValue });
                fieldValue = '';
            }
            fieldValue += `${fieldValue ? '\n\n' : ''}${line}`;
        }
        if (fieldValue) embed.addFields({ name: '\u200b', value: traineeHeading + fieldValue });
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
        .addStringOption(option => option
            .setName('trainee')
            .setDescription('Separate trainee-role members from quota standings (default Yes)')
            .addChoices(
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            )
            .setRequired(false))
        .addStringOption(option => option
            .setName('last_month')
            .setDescription('Compare Roblox ban counts with the previous calendar month')
            .addChoices(
                { name: 'Yes', value: 'yes' },
                { name: 'No', value: 'no' }
            )
            .setRequired(false))
        .addStringOption(option => option
            .setName('half')
            .setDescription('Use the Mid-Month Moderator Summary title')
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
        const includeLastMonth = interaction.options.getString('last_month') === 'yes';
        const isMidMonth = interaction.options.getString('half') === 'yes';
        const includeTrainees = interaction.options.getString('trainee') !== 'no';
        await interaction.deferReply({ ephemeral: visibility !== 'visible' });
        let traineeIds = [];
        if (includeTrainees) {
            try {
                const role = await interaction.guild.roles.fetch(TRAINEE_ROLE_ID);
                if (role) {
                    const members = await interaction.guild.members.fetch();
                    traineeIds = [...members.values()]
                        .filter(member => !member.user.bot && member.roles.cache.has(TRAINEE_ROLE_ID))
                        .map(member => member.id);
                }
            } catch (error) {
                if (Number(error?.code) !== 10011) {
                    console.error('Failed to load trainees for summary:', error);
                    return interaction.editReply({ content: 'I could not load the trainee role members. Please try again.' });
                }
            }
        }
        return interaction.editReply({
            embeds: [buildSummaryEmbed(client, interaction.guild, includeServerStats, traineeIds, includeLastMonth, new Date(), isMidMonth)]
        });
    },
    buildSummaryEmbed
};
