const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { RULE_CHOICES } = require('../infractions');

const MAX_RESULTS = 25;

function getInfractionUsers(client, guildId, ruleKey, selectedUserId = null) {
    const logs = client.getModLogs(guildId) || [];
    const selectedIds = selectedUserId && typeof client.getLinkedAccountIds === 'function'
        ? new Set(client.getLinkedAccountIds(guildId, selectedUserId))
        : null;
    const candidateIds = new Set(
        logs
            .filter(entry => {
                const action = String(entry.action || '').trim().toLowerCase();
                return ['mute', 'infraction'].includes(action)
                    && entry.infractionRule === ruleKey
                    && !entry.infractionClearedOnEarlyUnmute
                    && !entry.infractionRemoved
                    && (!selectedIds || selectedIds.has(String(entry.userId || '')));
            })
            .map(entry => String(entry.userId || '').trim())
            .filter(Boolean)
    );

    const groups = new Map();
    for (const userId of candidateIds) {
        const linkedIds = typeof client.getLinkedAccountIds === 'function'
            ? client.getLinkedAccountIds(guildId, userId)
            : [userId];
        const groupKey = [...linkedIds].sort().join(':');
        if (groups.has(groupKey)) continue;
        groups.set(groupKey, {
            accountIds: linkedIds,
            level: client.getLinkedInfractionCount(guildId, userId, ruleKey)
        });
    }

    return [...groups.values()]
        .filter(group => group.level > 0)
        .sort((left, right) => right.level - left.level || left.accountIds[0].localeCompare(right.accountIds[0]));
}

module.exports = {
    name: 'viewinfractions',
    description: 'View current infraction levels for a rule.',
    data: new SlashCommandBuilder()
        .setName('viewinfractions')
        .setDescription('View current infraction levels for a rule.')
        .addStringOption(option => {
            option
                .setName('rule')
                .setDescription('The infraction rule to review')
                .setRequired(true);
            for (const choice of RULE_CHOICES) option.addChoices(choice);
            return option;
        })
        .addUserOption(option => option
            .setName('user')
            .setDescription('Only show this user and linked accounts')
            .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const ruleKey = interaction.options.getString('rule', true);
        const rule = client.getInfractionRules(interaction.guild.id)?.[ruleKey];
        if (!rule) {
            return interaction.reply({ content: 'That infraction rule is not configured.', ephemeral: true });
        }

        const selectedUser = interaction.options.getUser('user');
        const groups = getInfractionUsers(client, interaction.guild.id, ruleKey, selectedUser?.id);
        const lines = groups.slice(0, MAX_RESULTS).map(group => {
            const accounts = group.accountIds.map(userId => `<@${userId}>`).join(', ');
            return `• **Level ${group.level}** — ${accounts}`;
        });
        const overflow = groups.length > MAX_RESULTS ? `\n…and ${groups.length - MAX_RESULTS} more.` : '';

        const embed = new EmbedBuilder()
            .setColor(0x36393f)
            .setTitle(`Infraction Levels: ${rule.label}`)
            .setDescription(lines.length ? `${lines.join('\n')}${overflow}` : 'No active infractions found for this rule.');

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
