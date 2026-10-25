const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { GAMES } = require('../lib/roblox-game');
const { DAY } = require('../lib/game-statistics');

const count = value => Math.round(value).toLocaleString('en-US');
const countBigInt = value => value.toLocaleString('en-US');
const COLLECTING = '*Collecting data…*';
const UNAVAILABLE = '*Unavailable*';
const discordTime = (timestamp, style) => `<t:${Math.floor(timestamp / 1000)}:${style}>`;

function metricCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? `**${count(value)}**` : UNAVAILABLE;
}

function metricChange(value) {
    if (!Number.isSafeInteger(value)) return COLLECTING;
    return `**${value > 0 ? '+' : ''}${count(value)}**`;
}

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

function parseMilestone(value) {
    if (!value) return null;
    const text = value.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) {
        throw new Error('Enter a whole-number milestone, such as 1,000,000,000.');
    }
    const milestone = BigInt(text.replace(/,/g, ''));
    if (milestone <= 0n) throw new Error('Milestone must be greater than zero.');
    return milestone;
}

function milestoneSection(current, milestone, value, unit, dailyRate, title = 'Milestone', estimateDate = true) {
    if (!Number.isSafeInteger(value) || value < 0) {
        return section(title, [`Current ${unit}: ${UNAVAILABLE}`]);
    }
    const target = BigInt(value);
    if (milestone <= target) {
        return section(title, [`**${countBigInt(milestone)}** ${unit} reached`]);
    }

    const remaining = milestone - target;
    const lines = [`**${countBigInt(remaining)}** ${unit} to **${countBigInt(milestone)}**`];
    if (!estimateDate) return section(title, lines);
    if (dailyRate === null || dailyRate === undefined) {
        lines.push(`Estimated date: ${COLLECTING}`);
    } else if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
        lines.push('Estimated date: *Unavailable — no positive growth*');
    } else {
        const estimate = current.timestamp
            + Math.ceil(Number(remaining) / dailyRate * DAY);
        if (Number.isSafeInteger(estimate) && Number.isFinite(new Date(estimate).getTime())) {
            lines.push(`Estimated date: ${discordTime(estimate, 'D')}`);
        } else {
            lines.push('Estimated date: *Unavailable for this milestone*');
        }
    }
    return section(title, lines);
}

function buildStatisticsEmbed(current, summary, type, game, milestone = null) {
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
    } else if (type === 'ccu') {
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
    } else if (type === 'new_players') {
        sections.push(section('New Players', [
            `Past 24 hours (rolling): ${metricCount(current.newPlayers)}`,
            `Past 7 days: ${metricChange(summary.metricChanges.badgeAwards.week)}`,
            `All time: ${metricCount(current.badgeAwards)}`,
            `Based on the “${game.badgeName}” badge`
        ]));
    } else {
        const metricNames = {
            favorites: { title: 'Favorites', field: 'favorites' },
            likes: { title: 'Likes', field: 'likes' },
            dislikes: { title: 'Dislikes', field: 'dislikes' }
        };
        const metric = metricNames[type];
        if (!metric) throw new Error(`Invalid statistics type: ${type}`);
        const changes = summary.metricChanges[metric.field];
        sections.push(
            section(metric.title, [`Current: ${metricCount(current[metric.field])}`]),
            section('Net Change', [
                `Past 24 hours: ${metricChange(changes.day)}`,
                `Past 7 days: ${metricChange(changes.week)}`
            ])
        );
    }
    if (milestone !== null) {
        if (type === 'new_players') {
            sections.push(
                milestoneSection(current, milestone, current.newPlayers, 'new players',
                    null, 'Milestone — Past 24 Hours', false),
                milestoneSection(current, milestone, current.badgeAwards, 'new players',
                    summary.metricDailyRates.badgeAwards, 'Milestone — All Time')
            );
        } else {
            const metric = {
                visits: { value: current.visits, unit: 'visits', rate: summary.dailyAverage },
                ccu: { value: current.ccu, unit: 'players online', rate: null },
                favorites: { value: current.favorites, unit: 'favorites', rate: summary.metricDailyRates.favorites },
                likes: { value: current.likes, unit: 'likes', rate: summary.metricDailyRates.likes },
                dislikes: { value: current.dislikes, unit: 'dislikes', rate: summary.metricDailyRates.dislikes }
            }[type];
            sections.push(milestoneSection(current, milestone, metric.value, metric.unit, metric.rate,
                'Milestone', type !== 'ccu'));
        }
    }

    const tracking = summary.origin
        ? `Since ${discordTime(summary.origin.timestamp, 'D')} · Updated ${discordTime(summary.lastCollected.timestamp, 'R')}`
        : 'Not started yet';
    sections.push(section('Tracking', [tracking]));

    return new EmbedBuilder()
        .setColor(0x393A41)
        .setAuthor({ name: current.name, url: game.url })
        .setTitle({
            visits: 'Visit Statistics',
            ccu: 'CCU Statistics',
            new_players: 'New Players Statistics',
            favorites: 'Favorites Statistics',
            likes: 'Likes Statistics',
            dislikes: 'Dislikes Statistics'
        }[type])
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
            .addChoices(
                { name: 'Visits', value: 'visits' },
                { name: 'CCU', value: 'ccu' },
                { name: 'New Players', value: 'new_players' },
                { name: 'Favorites', value: 'favorites' },
                { name: 'Likes', value: 'likes' },
                { name: 'Dislikes', value: 'dislikes' }
            ))
        .addStringOption(option => option
            .setName('milestone')
            .setDescription('Optional goal for the selected statistic, for example 1,000,000,000')
            .setMaxLength(30)
            .setRequired(false)),
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
            const type = interaction.options.getString('type', true);
            const milestoneInput = interaction.options.getString('milestone');
            const milestone = parseMilestone(milestoneInput);
            const service = client.gameStatistics?.[game.key];
            if (!service) throw new Error(`${game.label} statistics history service is unavailable`);
            const current = service.latest();
            if (!current) {
                return interaction.editReply({ content: `No ${game.label} statistics have been saved yet. Background collection runs every five minutes; please try again shortly.` });
            }
            const summary = service.summarize(current);
            embed = buildStatisticsEmbed(current, summary, type, game, milestone);
        } catch (error) {
            if (error.message.startsWith('Enter a whole-number milestone')
                || error.message === 'Milestone must be greater than zero.') {
                return interaction.editReply({ content: error.message });
            }
            console.error('Failed to fetch game statistics:', error);
            return interaction.editReply({ content: 'I could not load game statistics right now. Please try again later.' });
        }
        const components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Game').setStyle(ButtonStyle.Link).setURL(game.url)
        )];
        return interaction.editReply({ embeds: [embed], components });
    }
};
