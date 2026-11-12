const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const statsCommand = require('./stats');

function buildQuotaEmbed(client, guildId, user, logs) {
    const now = new Date();
    const { counts, totalBans } = statsCommand.getModeratorBanCounts(client, guildId, logs, now);
    const userBans = counts.get(String(user.id)) || 0;
    const share = totalBans > 0 ? (userBans / totalBans) * 100 : 0;
    const quota = statsCommand.QUOTA_PERCENT;
    const additionalNeeded = share >= quota
        ? 0
        : Math.max(1, Math.ceil((quota * totalBans - 100 * userBans) / (100 - quota)));
    const monthLabel = now.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'America/New_York'
    });
    const standing = share >= quota
        ? `✅ Above quota (${share.toFixed(1)}%)`
        : `⚠️ Below quota (${share.toFixed(1)}%) — need ${additionalNeeded} more ban(s) to reach ${quota}%`;

    return new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle(`Your quota standing — ${monthLabel}`)
        .setDescription([
            `Bans this month: **${userBans}**`,
            `Total bans (all mods): **${totalBans}**`,
            `Your share: **${share.toFixed(1)}%** (quota: ${quota}%)`,
            '',
            standing
        ].join('\n'));
}

module.exports = {
    name: 'quota',
    description: 'View your current-month moderation quota standing.',
    data: new SlashCommandBuilder()
        .setName('quota')
        .setDescription('View your current-month moderation quota standing.'),
    async execute({ client, message }) {
        if (!message.guild) return null;
        return message.reply({ embeds: [buildQuotaEmbed(client, message.guild.id, message.author, client.getModLogs(message.guild.id))] });
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
            embeds: [buildQuotaEmbed(client, interaction.guild.id, interaction.user, client.getModLogs(interaction.guild.id))],
            flags: MessageFlags.Ephemeral
        });
    }
};
