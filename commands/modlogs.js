const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    name: 'modlogs',
    description: 'Show moderation history for a user, or all guild logs if no user is selected.',
    data: new SlashCommandBuilder()
        .setName('modlogs')
        .setDescription('Show moderation history for a user, or all guild logs if no user is selected.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose moderation history you want to view')
                .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const logs = client.getModLogs(interaction.guild.id, user?.id);

        if (!logs || logs.length === 0) {
            if (user) {
                return interaction.reply({ content: `No moderation history found for ${user.tag}.`, ephemeral: true });
            }
            return interaction.reply({ content: 'No moderation logs are available for this server.', ephemeral: true });
        }

        const displayLogs = logs.slice(0, 10);
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle(user ? 'User Moderation Logs' : 'All Moderation Logs')
            .setDescription(`Showing ${displayLogs.length} of ${logs.length} records`)
            .setTimestamp();

        for (const entry of displayLogs) {
            const lines = [];
            lines.push(`Type: ${entry.action}`);
            lines.push(`User: <@${entry.userId}>`);
            if (entry.duration) lines.push(`Length: ${entry.duration}`);
            if (entry.count) lines.push(`Count: ${entry.count}`);
            if (entry.channelId) lines.push(`Channel: <#${entry.channelId}>`);
            if (entry.reason) lines.push(`Reason: ${entry.reason}`);
            lines.push(`Moderator: <@${entry.moderatorId}>`);
            lines.push(`Date: ${new Date(entry.timestamp).toLocaleString()}`);

            embed.addFields({
                name: `Case ${entry.caseNumber ?? entry.caseId ?? 'N/A'}`,
                value: lines.join('\n'),
                inline: false
            });
        }

        if (logs.length > displayLogs.length) {
            embed.addFields({ name: 'More logs', value: `Use /modlogs to view the first ${displayLogs.length} records.`, inline: false });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('modlogs_remove_button')
                .setLabel('Remove Log')
                .setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
};
