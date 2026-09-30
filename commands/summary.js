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

function buildSummaryEmbed(client, guild) {
    const logs = client.getModLogs(guild.id) || [];
    const now = new Date();
    const { counts, totalBans } = statsCommand.getModeratorBanCounts(client, guild.id, logs, now);
    const rows = Array.from(counts.entries())
        .map(([moderatorId, count]) => ({
            moderatorId,
            count,
            percentage: totalBans ? (count / totalBans) * 100 : 0
        }))
        .sort((left, right) => right.count - left.count || left.moderatorId.localeCompare(right.moderatorId))
        .slice(0, MAX_ROWS);

    const topModerator = rows[0]?.moderatorId
        ? `<@${rows[0].moderatorId}>`
        : 'None';
    const lines = rows.length
        ? rows.map((row, index) => {
            const indicator = row.percentage >= QUOTA_PERCENT ? '✅' : '⚠️';
            return `${index + 1}. <@${row.moderatorId}> ${indicator} (${row.percentage.toFixed(1)}%) | ${row.count} Roblox Bans`;
        })
        : ['No Roblox bans recorded this month.'];

    return new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle('Moderator Summary')
        .setTimestamp(now)
        .setDescription([
            `## ${formatMonth(now)}`,
            `Total Bans: **${totalBans.toLocaleString()}**`,
            '',
            `Top Moderator: ${topModerator}`,
            '',
            ...lines
        ].join('\n'));
}

module.exports = {
    name: 'summary',
    description: 'Show the moderator Roblox-ban summary.',
    data: new SlashCommandBuilder()
        .setName('summary')
        .setDescription('Show the moderator Roblox-ban summary.'),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        return interaction.reply({
            embeds: [buildSummaryEmbed(client, interaction.guild)],
            ephemeral: true
        });
    },
    buildSummaryEmbed
};
