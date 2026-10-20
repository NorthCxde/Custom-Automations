const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const count = value => value.toLocaleString('en-US', { maximumFractionDigits: 1 });

function visitPeriod(period) {
    if (period.counterReset) return 'Unavailable: Roblox visit counter decreased.';
    if (period.visits === null) return 'Insufficient history for this period.';
    return `**${count(period.visits)}** visits`;
}

function ccuPeriod(period) {
    if (period.average === null) return 'Insufficient history for an average.';
    const coverage = period.complete
        ? 'Full sampled history'
        : `Incomplete history: ${(period.coverage * 100).toFixed(1)}% time coverage`;
    return `Average: **${count(period.average)}**\nSampled peak: **${count(period.peak)}**\n${coverage}`;
}

function buildStatisticsEmbed(current, summary, type) {
    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({ name: current.name })
        .setTitle(`Statistics - ${type === 'visits' ? 'Visits' : 'CCU'}`)
        .setTimestamp(current.timestamp);

    if (type === 'visits') {
        const unavailable = summary.counterReset
            ? 'Unavailable: Roblox visit counter decreased.'
            : 'Collecting history (at least two snapshots, 5 minutes apart).';
        embed.addFields(
            { name: 'Current visits', value: `**${count(current.visits)}**` },
            { name: 'Past 24 hours', value: visitPeriod(summary.day), inline: true },
            { name: 'Past 7 days', value: visitPeriod(summary.week), inline: true },
            { name: 'Daily average', value: summary.dailyAverage === null
                ? unavailable : `**${count(summary.dailyAverage)}** visits/day`, inline: true },
            { name: 'Weekly average', value: summary.weeklyAverage === null
                ? unavailable : `**${count(summary.weeklyAverage)}** visits/week`, inline: true }
        ).setDescription('Daily and weekly averages are rates across all collected history, not completed calendar periods.');
    } else {
        embed.addFields(
            { name: 'Current CCU', value: `**${count(current.ccu)}** players online` },
            { name: 'Past 24 hours', value: ccuPeriod(summary.day), inline: true },
            { name: 'Past 7 days', value: ccuPeriod(summary.week), inline: true }
        ).setDescription('CCU averages are time-weighted. Peaks are observed at collection times, not guaranteed real-time peaks. Gaps longer than 10 minutes are not filled.');
    }

    const history = summary.origin
        ? `History started <t:${Math.floor(summary.origin.timestamp / 1000)}:f>.`
        : 'History collection has not succeeded yet.';
    const last = summary.lastCollected
        ? `Last saved snapshot: <t:${Math.floor(summary.lastCollected.timestamp / 1000)}:R>.`
        : 'No snapshots saved.';
    return embed.addFields({ name: 'History', value: `${history}\n${last}` })
        .setFooter({ text: 'Latest saved 5-minute snapshot; visit counts have ~5-minute resolution. This message does not auto-update.' });
}

module.exports = {
    name: 'statistics',
    data: new SlashCommandBuilder()
        .setName('statistics')
        .setDescription('Show Timebomb Duels visit or player statistics.')
        .setDMPermission(false)
        .addStringOption(option => option
            .setName('type')
            .setDescription('The performance statistics to display')
            .setRequired(true)
            .addChoices({ name: 'Visits', value: 'visits' }, { name: 'CCU', value: 'ccu' })),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guildId) {
            return interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply();
        let embed;
        try {
            if (!client.gameStatistics) throw new Error('Game statistics history service is unavailable');
            const current = client.gameStatistics.latest();
            if (!current) {
                return interaction.editReply({ content: 'No game statistics have been saved yet. Background collection runs every five minutes; please try again shortly.' });
            }
            const summary = client.gameStatistics.summarize(current);
            const type = interaction.options.getString('type', true);
            if (type !== 'visits' && type !== 'ccu') throw new Error(`Invalid statistics type: ${type}`);
            embed = buildStatisticsEmbed(current, summary, type);
        } catch (error) {
            console.error('Failed to fetch game statistics:', error);
            return interaction.editReply({ content: 'I could not load game statistics right now. Please try again later.' });
        }
        return interaction.editReply({ embeds: [embed] });
    }
};
