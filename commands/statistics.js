const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { GAMES } = require('../lib/roblox-game');

const count = value => Math.round(value).toLocaleString('en-US');
const COLLECTING = '*Collecting data…*';
const UNAVAILABLE = '*Unavailable*';
const discordTime = (timestamp, style) => `<t:${Math.floor(timestamp / 1000)}:${style}>`;

function visitGain(period) {
    if (period.counterReset) return UNAVAILABLE;
    return period.visits === null ? COLLECTING : `**${count(period.visits)}**`;
}

function ccuValue(period, key) {
    return period.average === null ? COLLECTING : `**${count(period[key])}**`;
}

function section(title, lines) {
    return [`### ${title}`, ...lines.map(line => `> ${line}`)].join('\n');
}

function buildStatisticsEmbed(current, summary, type, game) {
    const sections = [];
    if (type === 'visits') {
        const average = value => (value === null
            ? (summary.counterReset ? UNAVAILABLE : COLLECTING)
            : `**${count(value)}**`);
        sections.push(
            section('Current Visits', [`**${count(current.visits)}**`]),
            section('Visits Gained', [
                `Past 24 hours: ${visitGain(summary.day)}`,
                `Past 7 days: ${visitGain(summary.week)}`
            ]),
            section('Averages', [
                `Daily: ${average(summary.dailyAverage)}`,
                `Weekly: ${average(summary.weeklyAverage)}`
            ])
        );
    } else {
        sections.push(
            section('Current CCU', [`**${count(current.ccu)}** players online`]),
            section('Average CCU', [
                `Past 24 hours: ${ccuValue(summary.day, 'average')}`,
                `Past 7 days: ${ccuValue(summary.week, 'average')}`
            ]),
            section('Peak CCU', [
                `Past 24 hours: ${ccuValue(summary.day, 'peak')}`,
                `Past 7 days: ${ccuValue(summary.week, 'peak')}`
            ])
        );
        const partial = [['24h', summary.day], ['7d', summary.week]]
            .filter(([, period]) => period.average !== null && !period.complete)
            .map(([label, period]) => `${label} ${(period.coverage * 100).toFixed(1)}%`);
        if (partial.length) sections.push(`-# Partial data coverage: ${partial.join(' · ')}`);
    }

    const tracking = summary.origin
        ? `Since ${discordTime(summary.origin.timestamp, 'D')} · Updated ${discordTime(summary.lastCollected.timestamp, 'R')}`
        : 'Not started yet';
    sections.push(section('Tracking', [tracking]));

    return new EmbedBuilder()
        .setColor(0x393A41)
        .setAuthor({ name: current.name, url: game.url })
        .setTitle(type === 'visits' ? 'Visit Statistics' : 'CCU Statistics')
        .setDescription(sections.join('\n\n'))
        .setFooter({ text: 'Collected every 5 minutes · Does not auto-update' });
}

module.exports = {
    name: 'statistics',
    data: new SlashCommandBuilder()
        .setName('statistics')
        .setDescription('Show Timebomb Duels visit or player statistics.')
        .setDMPermission(false)
        .addStringOption(option => option
            .setName('game')
            .setDescription('The game to show statistics for')
            .setRequired(true)
            .addChoices(...Object.values(GAMES).map(game => ({ name: game.label, value: game.key }))))
        .addStringOption(option => option
            .setName('type')
            .setDescription('The performance statistics to display')
            .setRequired(true)
            .addChoices({ name: 'Visits', value: 'visits' }, { name: 'CCU', value: 'ccu' })),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guildId) {
            return interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let embed;
        let game;
        try {
            game = GAMES[interaction.options.getString('game', true)];
            if (!game) throw new Error('Invalid statistics game');
            const service = client.gameStatistics?.[game.key];
            if (!service) throw new Error(`${game.label} statistics history service is unavailable`);
            const current = service.latest();
            if (!current) {
                return interaction.editReply({ content: `No ${game.label} statistics have been saved yet. Background collection runs every five minutes; please try again shortly.` });
            }
            const summary = service.summarize(current);
            const type = interaction.options.getString('type', true);
            if (type !== 'visits' && type !== 'ccu') throw new Error(`Invalid statistics type: ${type}`);
            embed = buildStatisticsEmbed(current, summary, type, game);
        } catch (error) {
            console.error('Failed to fetch game statistics:', error);
            return interaction.editReply({ content: 'I could not load game statistics right now. Please try again later.' });
        }
        const components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Game').setStyle(ButtonStyle.Link).setURL(game.url)
        )];
        return interaction.editReply({ embeds: [embed], components });
    }
};
