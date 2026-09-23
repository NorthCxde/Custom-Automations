const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const DEFAULT_COUNT = 10;
const MAX_COUNT = 25;
const BAN_ACTIONS = new Set(['ban', 'blacklist']);

function formatRecentBan(entry) {
    const timestamp = Math.floor(new Date(entry.timestamp || '').getTime() / 1000);
    const time = Number.isFinite(timestamp) ? `<t:${timestamp}:R>` : 'Unknown time';
    const userId = String(entry.userId || 'Unknown ID');
    const listName = String(entry.blacklistType || entry.reason || 'Blacklist');
    const moderator = entry.moderatorId ? `<@${entry.moderatorId}>` : 'Unknown moderator';
    return `🔨 ${time} · \`${userId}\` (${listName}) by ${moderator}`;
}

function buildRecentBansPayload(logs, count) {
    const recentBans = logs
        .filter(entry => BAN_ACTIONS.has(String(entry.action || '').trim().toLowerCase()) && entry.source === 'trello_blacklist')
        .slice(0, count);

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Recent actions')
        .setDescription(recentBans.length ? recentBans.map(formatRecentBan).join('\n') : 'No recent bans are available.')
        .setTimestamp();

    return { embeds: [embed] };
}

module.exports = {
    name: 'recentbans',
    description: 'Show the most recent ban actions.',
    data: new SlashCommandBuilder()
        .setName('recentbans')
        .setDescription('Show the most recent ban actions.')
        .addIntegerOption(option => option
            .setName('count')
            .setDescription('How many to show (default 10, max 25)')
            .setMinValue(1)
            .setMaxValue(MAX_COUNT)
            .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const count = Math.min(MAX_COUNT, Math.max(1, interaction.options.getInteger('count') || DEFAULT_COUNT));
        const logs = client.getModLogs(interaction.guild.id);
        return interaction.reply({ ...buildRecentBansPayload(logs, count), ephemeral: true });
    },
    async execute({ client, message, args }) {
        if (!message.guild) return null;

        const parsedCount = Number.parseInt(args[0], 10);
        const count = Math.min(MAX_COUNT, Math.max(1, Number.isFinite(parsedCount) ? parsedCount : DEFAULT_COUNT));
        const logs = client.getModLogs(message.guild.id);
        return message.reply(buildRecentBansPayload(logs, count));
    }
};
