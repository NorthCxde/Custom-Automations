const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const statsCommand = require('./stats');

function buildQuotaEmbed(user, logs) {
    const now = new Date();
    const bans = statsCommand.getCurrentMonthBans(logs, now);
    const userBans = bans.filter(entry => String(entry.moderatorId) === String(user.id)).length;
    const totalBans = bans.length;
    const share = totalBans > 0 ? (userBans / totalBans) * 100 : 0;
    const quota = statsCommand.QUOTA_PERCENT;
    const targetBans = Math.floor(totalBans * (quota / 100));
    const additionalNeeded = Math.max(0, targetBans - userBans);
    const monthLabel = now.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
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
        return message.reply({ embeds: [buildQuotaEmbed(message.author, client.getModLogs(message.guild.id))] });
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
            embeds: [buildQuotaEmbed(interaction.user, client.getModLogs(interaction.guild.id))],
            flags: MessageFlags.Ephemeral
        });
    }
};
