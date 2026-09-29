const { SlashCommandBuilder } = require('discord.js');
const { RULE_CHOICES } = require('../infractions');

module.exports = {
    name: 'add',
    description: 'Add a manual infraction to a user.',
    data: new SlashCommandBuilder()
        .setName('add')
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
        .addStringOption(option => option
            .setName('reason')
            .setDescription('Additional context for the infraction')
            .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const user = interaction.options.getUser('user', true);
        const ruleKey = interaction.options.getString('rule', true);
        const reason = String(interaction.options.getString('reason') || '').trim();
        const rules = client.getInfractionRules(interaction.guild.id);
        const rule = rules?.[ruleKey];

        if (!rule) {
            return interaction.reply({ content: 'That infraction rule is not configured.', ephemeral: true });
        }

        const previousCount = client.getLinkedInfractionCount(interaction.guild.id, user.id, ruleKey);
        const infractionCount = previousCount + 1;
        const effectiveReason = `[Rule: ${rule.label}] [Infraction ${infractionCount}]${reason ? ` ${reason}` : ''}`;

        client.addModLog(interaction.guild.id, {
            action: 'Infraction',
            source: 'manual_infraction',
            userId: user.id,
            userTag: user.tag,
            moderatorId: interaction.user.id,
            moderatorTag: interaction.user.tag,
            reason: effectiveReason,
            infractionRule: ruleKey,
            infractionRuleLabel: rule.label,
            infractionCount,
            timestamp: new Date().toISOString()
        });

        const linkedIds = client.getLinkedAccountIds(interaction.guild.id, user.id);
        const linkedText = linkedIds.length > 1
            ? ` This is shared with ${linkedIds.length - 1} linked account(s).`
            : '';

        return interaction.reply({
            content: `Added **${rule.label}** infraction **level ${infractionCount}** to ${user}.${linkedText}`,
            ephemeral: true
        });
    }
};
