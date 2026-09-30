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

    return stats;
}

function buildSummaryEmbed(client, guild, includeServerStats = false) {
    const logs = client.getModLogs(guild.id) || [];
    const now = new Date();
    const { counts, totalBans } = statsCommand.getModeratorBanCounts(client, guild.id, logs, now);
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

    const topModerator = rows[0]?.moderatorId
        ? `<@${rows[0].moderatorId}>`
        : 'None';
    const lines = rows.length
        ? rows.map((row, index) => {
            const indicator = row.percentage >= QUOTA_PERCENT ? '✅' : '⚠️';
            const serverStats = includeServerStats
                ? ` | **${row.mutes}** Mutes | **${row.discordBans}** Discord Bans`
                : '';
            return `${index + 1}. <@${row.moderatorId}> ${indicator} **(${row.percentage.toFixed(1)}%)** | **${row.count}** Roblox Bans${serverStats}`;
        })
        : ['No Roblox bans recorded this month.'];

    return new EmbedBuilder()
        .setTitle('Moderator Summary')
        .setDescription([
            `## ${formatMonth(now)}`,
            `Total Bans: **${totalBans.toLocaleString()}**`,
            '',
            `Top Moderator: ${topModerator}`,
            '',
            lines.join('\n\n')
        ].join('\n'));
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
            .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const visibility = interaction.options.getString('visibility', true);
        const includeServerStats = interaction.options.getBoolean('server_stats') === true;
        return interaction.reply({
            embeds: [buildSummaryEmbed(client, interaction.guild, includeServerStats)],
            ephemeral: visibility !== 'visible'
        });
    },
    buildSummaryEmbed
};
