const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { RULE_CHOICES, parseDurationMs, normalizeInfractionStep } = require('../infractions');

const MANAGE_RULE_SELECT_ID = 'manage_infraction_rule_select';
const MANAGE_EDIT_PREFIX = 'manage_infraction_rule_edit:';
const MANAGE_RESET_PREFIX = 'manage_infraction_rule_reset:';
const MANAGE_MODAL_PREFIX = 'manage_infraction_modal:';
const MODAL_STEPS_INPUT_ID = 'steps';

function formatStep(step, index) {
    const number = `${index + 1}.`;
    if (!step) return `${number} moderator_decision`;
    if ((step.type === 'timeout' || step.type === 'temp_ban') && step.duration) {
        return `${number} ${step.type} ${step.duration}`;
    }
    return `${number} ${step.type}`;
}

function ruleToModalText(rule) {
    if (!rule || !Array.isArray(rule.steps)) return '';
    return rule.steps
        .map((step) => {
            if (!step) return '';
            if ((step.type === 'timeout' || step.type === 'temp_ban') && step.duration) {
                return `${step.type} ${step.duration}`;
            }
            return String(step.type || '').trim();
        })
        .filter(Boolean)
        .join('\n');
}

function parseModalSteps(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (!lines.length) {
        return { steps: [], errors: ['At least one step is required.'] };
    }

    const steps = [];
    const errors = [];

    lines.forEach((line, idx) => {
        const cleaned = line
            .replace(/^\d+\s*[).:-]\s*/, '')
            .replace(/^[-*]\s*/, '')
            .trim();

        if (!cleaned) return;

        const normalized = cleaned
            .toLowerCase()
            .replace(/[:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const parts = normalized.split(' ');
        let type = parts[0] || '';
        let duration = parts[1] || null;

        if (type === 'temp' && parts[1] === 'ban') {
            type = 'temp_ban';
            duration = parts[2] || null;
        }
        if (type === 'moderator' && parts[1] === 'decision') {
            type = 'moderator_decision';
            duration = null;
        }
        if (type === 'ticket' && parts[1] === 'blacklist') {
            type = 'ticket_blacklist';
            duration = null;
        }

        const rawStep = {
            type,
            ...(duration ? { duration } : {})
        };

        const normalizedStep = normalizeInfractionStep(rawStep);
        if (!normalizedStep) {
            errors.push(`Line ${idx + 1} is invalid: "${line}"`);
            return;
        }

        if (normalizedStep.type === 'timeout' && !parseDurationMs(normalizedStep.duration)) {
            errors.push(`Line ${idx + 1} has invalid timeout duration.`);
            return;
        }

        steps.push(normalizedStep);
    });

    return { steps, errors };
}

function buildManagePayload(client, guildId, selectedRuleKey) {
    const rules = client.getInfractionRules(guildId);
    const fallbackKey = RULE_CHOICES[0]?.value;
    const safeRuleKey = rules[selectedRuleKey] ? selectedRuleKey : fallbackKey;
    const rule = rules[safeRuleKey];

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Manage Panel - Infraction Rules')
        .setDescription('Select a rule, then edit or reset its escalation steps.\nUse one step per line in this format: `timeout 6h`, `kick`, `ban`, `moderator_decision`, `temp_ban 7d`, `ticket_blacklist`.')
        .addFields(
            { name: 'Rule', value: rule?.label || safeRuleKey, inline: false },
            { name: 'Current Steps', value: rule?.steps?.map(formatStep).join('\n') || 'No steps configured.', inline: false }
        )
        .setTimestamp();

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(MANAGE_RULE_SELECT_ID)
            .setPlaceholder('Select rule to edit')
            .addOptions(RULE_CHOICES.map(choice => ({
                label: rules[choice.value]?.label || choice.name,
                value: choice.value,
                default: choice.value === safeRuleKey
            })))
    );

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${MANAGE_EDIT_PREFIX}${safeRuleKey}`)
            .setLabel('Edit Steps')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${MANAGE_RESET_PREFIX}${safeRuleKey}`)
            .setLabel('Reset Rule')
            .setStyle(ButtonStyle.Danger)
    );

    return { embeds: [embed], components: [selectRow, buttonRow] };
}

module.exports = {
    name: 'manage',
    description: 'Hardcoded-admin management panel for moderation settings.',
    data: new SlashCommandBuilder()
        .setName('manage')
        .setDescription('Open the management panel for infractions and moderation settings.'),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const firstRule = RULE_CHOICES[0]?.value;
        return interaction.reply({
            ...buildManagePayload(client, interaction.guild.id, firstRule),
            ephemeral: true
        });
    },
    async handleStringSelect({ client, interaction }) {
        if (interaction.customId !== MANAGE_RULE_SELECT_ID) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        const selectedRuleKey = interaction.values?.[0] || RULE_CHOICES[0]?.value;
        await interaction.update(buildManagePayload(client, interaction.guild.id, selectedRuleKey));
        return true;
    },
    async handleButton({ client, interaction }) {
        if (!interaction.customId.startsWith(MANAGE_EDIT_PREFIX) && !interaction.customId.startsWith(MANAGE_RESET_PREFIX)) {
            return false;
        }

        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        if (interaction.customId.startsWith(MANAGE_EDIT_PREFIX)) {
            const ruleKey = interaction.customId.slice(MANAGE_EDIT_PREFIX.length);
            const rules = client.getInfractionRules(interaction.guild.id);
            const rule = rules[ruleKey];
            if (!rule) {
                await interaction.reply({ content: 'Unknown infraction rule.', ephemeral: true });
                return true;
            }

            const modal = new ModalBuilder()
                .setCustomId(`${MANAGE_MODAL_PREFIX}${ruleKey}`)
                .setTitle(`Edit ${rule.label}`);

            const stepsInput = new TextInputBuilder()
                .setCustomId(MODAL_STEPS_INPUT_ID)
                .setLabel('Escalation steps (one per line)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setValue(ruleToModalText(rule));

            modal.addComponents(new ActionRowBuilder().addComponents(stepsInput));
            await interaction.showModal(modal);
            return true;
        }

        const ruleKey = interaction.customId.slice(MANAGE_RESET_PREFIX.length);
        const reset = client.resetInfractionRule(interaction.guild.id, ruleKey);
        if (!reset) {
            await interaction.reply({ content: 'Unknown infraction rule.', ephemeral: true });
            return true;
        }

        await interaction.update(buildManagePayload(client, interaction.guild.id, ruleKey));
        return true;
    },
    async handleModalSubmit({ client, interaction }) {
        if (!interaction.customId.startsWith(MANAGE_MODAL_PREFIX)) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        const ruleKey = interaction.customId.slice(MANAGE_MODAL_PREFIX.length);
        const rules = client.getInfractionRules(interaction.guild.id);
        const existingRule = rules[ruleKey];
        if (!existingRule) {
            await interaction.reply({ content: 'Unknown infraction rule.', ephemeral: true });
            return true;
        }

        const stepsRaw = interaction.fields.getTextInputValue(MODAL_STEPS_INPUT_ID);
        const { steps, errors } = parseModalSteps(stepsRaw);
        if (errors.length) {
            await interaction.reply({
                content: `Could not save rule:\n${errors.slice(0, 6).map(error => `- ${error}`).join('\n')}`,
                ephemeral: true
            });
            return true;
        }

        client.setInfractionRule(interaction.guild.id, ruleKey, {
            label: existingRule.label,
            steps
        });

        await interaction.reply({
            content: `Updated ${existingRule.label} with ${steps.length} step(s).`,
            ...buildManagePayload(client, interaction.guild.id, ruleKey),
            ephemeral: true
        });
        return true;
    }
};
