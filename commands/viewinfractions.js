const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { RULE_CHOICES } = require('../infractions');

module.exports = {
    name: 'viewinfractions',
    description: 'View current infraction levels for a rule.',
    data: new SlashCommandBuilder()
        .setName('viewinfractions')
        .setDescription('View current infraction levels for a rule.')
        .addUserOption(option => option
            .setName('user')
            .setDescription('The user whose infractions you want to view')
            .setRequired(true))
        .addStringOption(option => {
            option
                .setName('rule')
                .setDescription('The infraction rule to review')
                .setRequired(false)
                .addChoices({ name: 'All ✨', value: 'all' });
            for (const choice of RULE_CHOICES) option.addChoices(choice);
            return option;
        }),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const selectedUser = interaction.options.getUser('user', true);
        const selectedRule = interaction.options.getString('rule') || 'all';
        const rules = client.getInfractionRules(interaction.guild.id);
        const linkedIds = typeof client.getLinkedAccountIds === 'function'
            ? client.getLinkedAccountIds(interaction.guild.id, selectedUser.id)
            : [selectedUser.id];
        const ruleEntries = selectedRule === 'all'
            ? RULE_CHOICES.map(choice => [choice.value, rules?.[choice.value]])
            : [[selectedRule, rules?.[selectedRule]]];

        if (selectedRule !== 'all' && !rules?.[selectedRule]) {
            return interaction.reply({ content: 'That infraction rule is not configured.', ephemeral: true });
        }

        const levels = ruleEntries
            .map(([ruleKey, rule]) => ({
                label: rule?.label || ruleKey,
                level: client.getLinkedInfractionCount(interaction.guild.id, selectedUser.id, ruleKey)
            }))
            .filter(entry => entry.level > 0);
        const lines = levels.map(entry => `• **${entry.label}** — Level **${entry.level}**`);
        const accountText = linkedIds.length > 1
            ? `\nLinked accounts: ${linkedIds.map(userId => `<@${userId}>`).join(', ')}`
            : '';

        const embed = new EmbedBuilder()
            .setColor(0x36393f)
            .setTitle(`Infraction Levels: ${selectedUser.username}`)
            .setDescription(lines.length
                ? `${lines.join('\n')}${accountText}`
                : `No active infractions found for ${selectedUser}.${accountText}`);

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
