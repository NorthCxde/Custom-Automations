const { SlashCommandBuilder } = require('discord.js');
const { RULE_CHOICES } = require('../infractions');

const ACTION_CHOICES = [
    { name: 'Set exact level', value: 'set' },
    { name: 'Add levels', value: 'add' },
    { name: 'Remove levels', value: 'remove' }
];

module.exports = {
    name: 'addinfraction',
    description: 'Add a manual infraction to a user.',
    data: new SlashCommandBuilder()
        .setName('addinfraction')
        .setDescription('Add a manual infraction to a user.')
        .addUserOption(option => option
            .setName('user')
            .setDescription('The user receiving the infraction')
            .setRequired(true))
        .addStringOption(option => {
            option
                .setName('rule')
                .setDescription('The infraction rule')
                .setRequired(true);
            for (const choice of RULE_CHOICES) option.addChoices(choice);
            return option;
        })
        .addIntegerOption(option => option
            .setName('level')
            .setDescription('Number of levels to set, add, or remove')
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(true))
        .addStringOption(option => {
            option
                .setName('action')
                .setDescription('Set, add, or remove levels')
                .setRequired(true);
            for (const choice of ACTION_CHOICES) option.addChoices(choice);
            return option;
        }),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const user = interaction.options.getUser('user', true);
        const ruleKey = interaction.options.getString('rule', true);
        const level = interaction.options.getInteger('level', true);
        const action = interaction.options.getString('action', true);
        const rules = client.getInfractionRules(interaction.guild.id);
        const rule = rules?.[ruleKey];

        if (!rule) {
            return interaction.reply({ content: 'That infraction rule is not configured.', ephemeral: true });
        }

        const previousCount = client.getLinkedInfractionCount(interaction.guild.id, user.id, ruleKey);
        let finalCount = previousCount;

        if (action === 'remove') {
            const removedCount = client.removeLinkedInfractionLevels(
                interaction.guild.id,
                user.id,
                ruleKey,
                level,
                interaction.user.id
            );
            finalCount = Math.max(0, previousCount - removedCount);
        } else {
            finalCount = action === 'set' ? level : previousCount + level;
            const additions = Math.max(0, finalCount - previousCount);
            for (let index = 0; index < additions; index++) {
                const infractionCount = previousCount + index + 1;
                client.addModLog(interaction.guild.id, {
                    action: 'Infraction',
                    source: 'manual_infraction',
                    userId: user.id,
                    userTag: user.tag,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    reason: `[Rule: ${rule.label}] [Infraction ${infractionCount}] Manual level adjustment`,
                    infractionRule: ruleKey,
                    infractionRuleLabel: rule.label,
                    infractionCount,
                    timestamp: new Date().toISOString()
                });
            }
            if (action === 'set' && level < previousCount) {
                client.removeLinkedInfractionLevels(
                    interaction.guild.id,
                    user.id,
                    ruleKey,
                    previousCount - level,
                    interaction.user.id
                );
            }
        }

        const linkedIds = client.getLinkedAccountIds(interaction.guild.id, user.id);
        const linkedText = linkedIds.length > 1
            ? ` This is shared with ${linkedIds.length - 1} linked account(s).`
            : '';

        return interaction.reply({
            content: `**${rule.label}** is now at shared infraction level **${finalCount}** for ${user}.${linkedText}`,
            ephemeral: true
        });
    }
};
