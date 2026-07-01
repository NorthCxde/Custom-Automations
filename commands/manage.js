const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { RULE_CHOICES, parseDurationMs, normalizeInfractionStep } = require('../infractions');

const MANAGE_RULE_SELECT_ID = 'manage_infraction_rule_select';
const MANAGE_PANEL_SELECT_ID = 'manage_panel_select';
const MANAGE_USER_SELECT_ID = 'manage_user_infraction_user_select';
const MANAGE_USER_CASE_SELECT_ID = 'manage_user_infraction_case_select';
const MANAGE_EDIT_PREFIX = 'manage_infraction_rule_edit:';
const MANAGE_RESET_PREFIX = 'manage_infraction_rule_reset:';
const MANAGE_REMOVE_PREFIX = 'manage_user_infraction_remove:';
const MANAGE_MODAL_PREFIX = 'manage_infraction_modal:';
const MODAL_STEPS_INPUT_ID = 'steps';

const MANAGE_MODSTATS_USER_SELECT_ID = 'manage_modstats_user_select';
const MANAGE_MODSTATS_ACTION_SELECT_ID = 'manage_modstats_action_select';
const MANAGE_MODSTATS_EDIT_PREFIX = 'manage_modstats_edit:';
const MANAGE_MODSTATS_EDIT_PERIOD_PREFIX = 'manage_modstats_edit_period:';
const MANAGE_MODSTATS_RESET_USER_PREFIX = 'manage_modstats_reset_user:';
const MANAGE_MODSTATS_RESET_ALL_ID = 'manage_modstats_reset_all';
const MANAGE_MODSTATS_MODAL_PREFIX = 'manage_modstats_modal:';
const MODAL_MODSTATS_MUTES_INPUT_ID = 'mutes';
const MODAL_MODSTATS_BANS_INPUT_ID = 'bans';
const MODAL_MODSTATS_KICKS_INPUT_ID = 'kicks';
const MODAL_MODSTATS_WARNS_INPUT_ID = 'warns';

const MANAGE_PANEL_RULES = 'rules';
const MANAGE_PANEL_USER_INFRACTIONS = 'user_infractions';
const MANAGE_PANEL_MODSTATS = 'modstats';

function truncate(text, max = 100) {
    const value = String(text || '').trim();
    if (!value) return 'No reason provided';
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function isInfractionEntry(entry) {
    const action = String(entry?.action || '').trim().toLowerCase();
    return Boolean(
        entry?.infractionRule
        || entry?.infractionCount
        || ['mute', 'kick', 'ban', 'temp ban', 'ticket blacklist'].includes(action)
    );
}

function getUserInfractionEntries(client, guildId, userId) {
    if (!guildId || !userId || typeof client.getModLogs !== 'function') return [];
    return (client.getModLogs(guildId, userId) || []).filter(isInfractionEntry);
}

function formatInfractionEntry(entry) {
    const parts = [`Case ${entry.caseNumber ?? entry.caseId ?? 'N/A'}`, entry.action || 'Unknown'];
    if (entry.infractionRuleLabel) parts.push(entry.infractionRuleLabel);
    if (entry.duration) parts.push(entry.duration);
    return parts.join(' - ');
}

function buildPanelSelectRow(selectedPanel) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(MANAGE_PANEL_SELECT_ID)
            .setPlaceholder('Select a manage panel')
            .addOptions([
                {
                    label: 'Infraction Rules',
                    value: MANAGE_PANEL_RULES,
                    description: 'Edit escalation ladders for each rule',
                    default: selectedPanel === MANAGE_PANEL_RULES
                },
                {
                    label: 'User Infractions',
                    value: MANAGE_PANEL_USER_INFRACTIONS,
                    description: 'Review or remove a user\'s infraction cases',
                    default: selectedPanel === MANAGE_PANEL_USER_INFRACTIONS
                },
                {
                    label: 'Modstats',
                    value: MANAGE_PANEL_MODSTATS,
                    description: 'Edit or reset moderation statistics',
                    default: selectedPanel === MANAGE_PANEL_MODSTATS
                }
            ])
    );
}

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

function buildRuleManagePayload(client, guildId, selectedRuleKey) {
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

    return { embeds: [embed], components: [buildPanelSelectRow(MANAGE_PANEL_RULES), selectRow, buttonRow] };
}

function buildUserInfractionsPayload(client, guildId, selectedUserId, selectedCaseNumber, notice) {
    const entries = selectedUserId ? getUserInfractionEntries(client, guildId, selectedUserId) : [];
    const selectedEntry = selectedCaseNumber
        ? entries.find(entry => String(entry.caseNumber ?? entry.caseId) === String(selectedCaseNumber))
        : null;

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Manage Panel - User Infractions')
        .setDescription('Pick a user to review their recorded infraction cases. Removing a false case will also reduce future escalation counts that rely on modlogs.')
        .setTimestamp();

    if (!selectedUserId) {
        embed.addFields({
            name: 'Select a User',
            value: 'Use the user picker below to load infraction cases for a member.',
            inline: false
        });
    } else {
        const userLabel = entries[0]?.userTag ? `${entries[0].userTag} (<@${selectedUserId}>)` : `<@${selectedUserId}>`;
        embed.addFields({ name: 'Selected User', value: `${userLabel}\nID: ${selectedUserId}`, inline: false });

        if (!entries.length) {
            embed.addFields({
                name: 'Recorded Infractions',
                value: 'No removable infraction cases were found for this user.',
                inline: false
            });
        } else {
            embed.addFields({
                name: 'Recorded Infractions',
                value: entries.slice(0, 10).map((entry) => {
                    const details = [
                        `Case ${entry.caseNumber ?? entry.caseId ?? 'N/A'}: ${entry.action || 'Unknown'}`,
                        entry.infractionRuleLabel ? `Rule: ${entry.infractionRuleLabel}` : null,
                        entry.duration ? `Duration: ${entry.duration}` : null,
                        entry.reason ? `Reason: ${truncate(entry.reason, 90)}` : null
                    ].filter(Boolean);
                    return details.join(' | ');
                }).join('\n') || 'No removable infraction cases were found for this user.',
                inline: false
            });
        }

        if (selectedEntry) {
            embed.addFields({
                name: 'Selected Case',
                value: [
                    `Case ${selectedEntry.caseNumber ?? selectedEntry.caseId ?? 'N/A'} - ${selectedEntry.action || 'Unknown'}`,
                    selectedEntry.infractionRuleLabel ? `Rule: ${selectedEntry.infractionRuleLabel}` : null,
                    selectedEntry.duration ? `Duration: ${selectedEntry.duration}` : null,
                    selectedEntry.reason ? `Reason: ${truncate(selectedEntry.reason, 250)}` : 'Reason: No reason provided',
                    selectedEntry.timestamp ? `Timestamp: ${selectedEntry.timestamp}` : null
                ].filter(Boolean).join('\n'),
                inline: false
            });
        }
    }

    const components = [
        buildPanelSelectRow(MANAGE_PANEL_USER_INFRACTIONS),
        new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(MANAGE_USER_SELECT_ID)
                .setPlaceholder('Select a user to review infractions')
                .setMinValues(1)
                .setMaxValues(1)
        )
    ];

    if (selectedUserId && entries.length) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${MANAGE_USER_CASE_SELECT_ID}:${selectedUserId}`)
                    .setPlaceholder('Select an infraction case')
                    .addOptions(entries.slice(0, 25).map(entry => ({
                        label: formatInfractionEntry(entry).slice(0, 100),
                        value: String(entry.caseNumber ?? entry.caseId),
                        description: truncate(entry.reason || entry.timestamp || 'No reason provided', 100),
                        default: String(entry.caseNumber ?? entry.caseId) === String(selectedCaseNumber || '')
                    })))
            )
        );
    }

    if (selectedEntry) {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${MANAGE_REMOVE_PREFIX}${selectedUserId}:${selectedEntry.caseNumber ?? selectedEntry.caseId}`)
                    .setLabel(`Remove Case ${selectedEntry.caseNumber ?? selectedEntry.caseId}`)
                    .setStyle(ButtonStyle.Danger)
            )
        );
    }

    return {
        content: notice || null,
        embeds: [embed],
        components
    };
}

function buildModstatsManagePayload(client, guildId, selectedUserId, notice) {
    const userOverrides = selectedUserId
        ? (client.modStatsOverrides?.get(guildId)?.get(selectedUserId) || {})
        : null;

    // Calculate actual modstats from logs for each time period (count actions PERFORMED by this user)
    let stats7d = null, stats30d = null, statsAll = null;
    if (selectedUserId) {
        const logs = client.modLogs?.get(guildId) || [];
        const userLogs = logs.filter(log => String(log.moderatorId) === String(selectedUserId));
        
        const MS_7D  = 7  * 24 * 60 * 60 * 1000;
        const MS_30D = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        // 7 days
        const logs7d = userLogs.filter(log => {
            const ts = new Date(log.timestamp).getTime();
            return !isNaN(ts) && now - ts <= MS_7D;
        });
        stats7d = {
            mutes: logs7d.filter(log => log.action === 'Mute').length,
            bans: logs7d.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
            kicks: logs7d.filter(log => log.action === 'Kick').length,
            warns: logs7d.filter(log => log.action === 'Warn').length
        };

        // 30 days
        const logs30d = userLogs.filter(log => {
            const ts = new Date(log.timestamp).getTime();
            return !isNaN(ts) && now - ts <= MS_30D;
        });
        stats30d = {
            mutes: logs30d.filter(log => log.action === 'Mute').length,
            bans: logs30d.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
            kicks: logs30d.filter(log => log.action === 'Kick').length,
            warns: logs30d.filter(log => log.action === 'Warn').length
        };

        // All time
        statsAll = {
            mutes: userLogs.filter(log => log.action === 'Mute').length,
            bans: userLogs.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
            kicks: userLogs.filter(log => log.action === 'Kick').length,
            warns: userLogs.filter(log => log.action === 'Warn').length
        };
    }

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Manage Panel - Modstats')
        .setDescription('Edit moderation statistics for a user, reset a user\'s stats, or reset all stats in the server.')
        .setTimestamp();

    const components = [buildPanelSelectRow(MANAGE_PANEL_MODSTATS)];

    if (!selectedUserId) {
        embed.addFields({
            name: 'Select a User',
            value: 'Pick a user below to edit their moderation statistics.',
            inline: false
        });

        components.push(
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(MANAGE_MODSTATS_USER_SELECT_ID)
                    .setPlaceholder('Select a user to manage modstats')
                    .setMinValues(1)
                    .setMaxValues(1)
            )
        );

        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(MANAGE_MODSTATS_RESET_ALL_ID)
                    .setLabel('Reset All Modstats in Server')
                    .setStyle(ButtonStyle.Danger)
            )
        );
    } else {
        embed.addFields(
            { name: 'Selected User', value: `<@${selectedUserId}>\nID: ${selectedUserId}`, inline: false },
            { name: 'Last 7 Days', value: `Mutes: ${stats7d.mutes} | Bans: ${stats7d.bans} | Kicks: ${stats7d.kicks} | Warns: ${stats7d.warns}`, inline: false },
            { name: 'Last 30 Days', value: `Mutes: ${stats30d.mutes} | Bans: ${stats30d.bans} | Kicks: ${stats30d.kicks} | Warns: ${stats30d.warns}`, inline: false },
            { name: 'All Time', value: `Mutes: ${statsAll.mutes} | Bans: ${statsAll.bans} | Kicks: ${statsAll.kicks} | Warns: ${statsAll.warns}`, inline: false }
        );

        components.push(
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(MANAGE_MODSTATS_USER_SELECT_ID)
                    .setPlaceholder('Select a different user')
                    .setMinValues(1)
                    .setMaxValues(1)
            )
        );

        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${MANAGE_MODSTATS_EDIT_PREFIX}${selectedUserId}`)
                    .setLabel('Edit Stats')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`${MANAGE_MODSTATS_RESET_USER_PREFIX}${selectedUserId}`)
                    .setLabel('Reset This User')
                    .setStyle(ButtonStyle.Danger)
            )
        );

        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(MANAGE_MODSTATS_RESET_ALL_ID)
                    .setLabel('Reset All Modstats in Server')
                    .setStyle(ButtonStyle.Danger)
            )
        );
    }

    return {
        content: notice || null,
        embeds: [embed],
        components
    };
}

function buildManagePayload(client, guildId, options = {}) {
    const {
        panel = MANAGE_PANEL_RULES,
        selectedRuleKey,
        selectedUserId,
        selectedCaseNumber,
        selectedModstatsUserId,
        notice
    } = options;

    if (panel === MANAGE_PANEL_USER_INFRACTIONS) {
        return buildUserInfractionsPayload(client, guildId, selectedUserId, selectedCaseNumber, notice);
    }

    if (panel === MANAGE_PANEL_MODSTATS) {
        return buildModstatsManagePayload(client, guildId, selectedModstatsUserId, notice);
    }

    return buildRuleManagePayload(client, guildId, selectedRuleKey);
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
            ...buildManagePayload(client, interaction.guild.id, { panel: MANAGE_PANEL_RULES, selectedRuleKey: firstRule }),
            ephemeral: true
        });
    },
    async handleStringSelect({ client, interaction }) {
        if (interaction.customId !== MANAGE_RULE_SELECT_ID
            && interaction.customId !== MANAGE_PANEL_SELECT_ID
            && !interaction.customId.startsWith(`${MANAGE_USER_CASE_SELECT_ID}:`)
            && !interaction.customId.startsWith(MANAGE_MODSTATS_EDIT_PERIOD_PREFIX)) {
            return false;
        }
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        // Modstats: Handle time period selection for edit
        if (interaction.customId.startsWith(MANAGE_MODSTATS_EDIT_PERIOD_PREFIX)) {
            const userId = interaction.customId.slice(MANAGE_MODSTATS_EDIT_PERIOD_PREFIX.length);
            const timePeriod = interaction.values?.[0] || 'all';
            
            if (!client.modStatsOverrides) {
                client.modStatsOverrides = new Map();
            }
            if (!client.modStatsOverrides.has(interaction.guild.id)) {
                client.modStatsOverrides.set(interaction.guild.id, new Map());
            }
            
            // Calculate stats from logs for this user to use as defaults
            const logs = client.modLogs?.get(interaction.guild.id) || [];
            const userLogs = logs.filter(log => String(log.moderatorId) === String(userId));
            
            const MS_7D  = 7  * 24 * 60 * 60 * 1000;
            const MS_30D = 30 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            
            let statsFromLogs;
            if (timePeriod === '7d') {
                const logs7d = userLogs.filter(log => {
                    const ts = new Date(log.timestamp).getTime();
                    return !isNaN(ts) && now - ts <= MS_7D;
                });
                statsFromLogs = {
                    mutes: logs7d.filter(log => log.action === 'Mute').length,
                    bans: logs7d.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
                    kicks: logs7d.filter(log => log.action === 'Kick').length,
                    warns: logs7d.filter(log => log.action === 'Warn').length
                };
            } else if (timePeriod === '30d') {
                const logs30d = userLogs.filter(log => {
                    const ts = new Date(log.timestamp).getTime();
                    return !isNaN(ts) && now - ts <= MS_30D;
                });
                statsFromLogs = {
                    mutes: logs30d.filter(log => log.action === 'Mute').length,
                    bans: logs30d.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
                    kicks: logs30d.filter(log => log.action === 'Kick').length,
                    warns: logs30d.filter(log => log.action === 'Warn').length
                };
            } else {
                statsFromLogs = {
                    mutes: userLogs.filter(log => log.action === 'Mute').length,
                    bans: userLogs.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
                    kicks: userLogs.filter(log => log.action === 'Kick').length,
                    warns: userLogs.filter(log => log.action === 'Warn').length
                };
            }
            
            const periodStats = statsFromLogs;

            const modal = new ModalBuilder()
                .setCustomId(`${MANAGE_MODSTATS_MODAL_PREFIX}${userId}:${timePeriod}`)
                .setTitle(`Edit Modstats (${timePeriod === '7d' ? 'Last 7 Days' : timePeriod === '30d' ? 'Last 30 Days' : 'All Time'})`);

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(MODAL_MODSTATS_MUTES_INPUT_ID)
                        .setLabel('Mutes')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(String(periodStats.mutes || 0))
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(MODAL_MODSTATS_BANS_INPUT_ID)
                        .setLabel('Bans')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(String(periodStats.bans || 0))
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(MODAL_MODSTATS_KICKS_INPUT_ID)
                        .setLabel('Kicks')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(String(periodStats.kicks || 0))
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(MODAL_MODSTATS_WARNS_INPUT_ID)
                        .setLabel('Warns')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(String(periodStats.warns || 0))
                )
            );

            await interaction.showModal(modal);
            return true;
        }

        if (interaction.customId === MANAGE_PANEL_SELECT_ID) {
            const panel = interaction.values?.[0] || MANAGE_PANEL_RULES;
            if (panel === MANAGE_PANEL_USER_INFRACTIONS) {
                await interaction.update(buildManagePayload(client, interaction.guild.id, { panel }));
                return true;
            }

            if (panel === MANAGE_PANEL_MODSTATS) {
                await interaction.update(buildManagePayload(client, interaction.guild.id, { panel: MANAGE_PANEL_MODSTATS }));
                return true;
            }

            const firstRule = RULE_CHOICES[0]?.value;
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_RULES,
                selectedRuleKey: firstRule
            }));
            return true;
        }

        if (interaction.customId.startsWith(`${MANAGE_USER_CASE_SELECT_ID}:`)) {
            const selectedUserId = interaction.customId.slice(`${MANAGE_USER_CASE_SELECT_ID}:`.length);
            const selectedCaseNumber = interaction.values?.[0] || null;
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_USER_INFRACTIONS,
                selectedUserId,
                selectedCaseNumber
            }));
            return true;
        }

        const selectedRuleKey = interaction.values?.[0] || RULE_CHOICES[0]?.value;
        await interaction.update(buildManagePayload(client, interaction.guild.id, {
            panel: MANAGE_PANEL_RULES,
            selectedRuleKey
        }));
        return true;
    },
    async handleButton({ client, interaction }) {
        if (!interaction.customId.startsWith(MANAGE_EDIT_PREFIX)
            && !interaction.customId.startsWith(MANAGE_RESET_PREFIX)
            && !interaction.customId.startsWith(MANAGE_REMOVE_PREFIX)
            && !interaction.customId.startsWith(MANAGE_MODSTATS_EDIT_PREFIX)
            && !interaction.customId.startsWith(MANAGE_MODSTATS_RESET_USER_PREFIX)
            && interaction.customId !== MANAGE_MODSTATS_RESET_ALL_ID) {
            return false;
        }

        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        // Modstats: Edit user stats
        if (interaction.customId.startsWith(MANAGE_MODSTATS_EDIT_PREFIX)) {
            const userId = interaction.customId.slice(MANAGE_MODSTATS_EDIT_PREFIX.length);
            
            const selectRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${MANAGE_MODSTATS_EDIT_PERIOD_PREFIX}${userId}`)
                    .setPlaceholder('Select time period to edit')
                    .addOptions([
                        { label: 'Last 7 Days', value: '7d', description: 'Edit 7-day stats' },
                        { label: 'Last 30 Days', value: '30d', description: 'Edit 30-day stats' },
                        { label: 'All Time', value: 'all', description: 'Edit all-time stats' }
                    ])
            );

            await interaction.reply({
                content: `Select which time period to edit for <@${userId}>:`,
                components: [selectRow],
                ephemeral: true
            });
            return true;
        }

        // Modstats: Handle time period selection
        if (interaction.customId.startsWith(MANAGE_MODSTATS_EDIT_PERIOD_PREFIX)) {
            const userId = interaction.customId.slice(MANAGE_MODSTATS_EDIT_PERIOD_PREFIX.length);
            // This will be handled in handleStringSelect
            return false;
        }

        // Modstats: Reset single user
        if (interaction.customId.startsWith(MANAGE_MODSTATS_RESET_USER_PREFIX)) {
            const userId = interaction.customId.slice(MANAGE_MODSTATS_RESET_USER_PREFIX.length);
            
            if (!client.modStatsOverrides) {
                client.modStatsOverrides = new Map();
            }
            if (!client.modStatsOverrides.has(interaction.guild.id)) {
                client.modStatsOverrides.set(interaction.guild.id, new Map());
            }
            
            client.modStatsOverrides.get(interaction.guild.id).delete(userId);

            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_MODSTATS,
                selectedModstatsUserId: userId,
                notice: `Reset modstats for <@${userId}>.`
            }));
            return true;
        }

        // Modstats: Reset all
        if (interaction.customId === MANAGE_MODSTATS_RESET_ALL_ID) {
            if (!client.modStatsOverrides) {
                client.modStatsOverrides = new Map();
            }
            
            client.modStatsOverrides.delete(interaction.guild.id);

            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_MODSTATS,
                notice: 'Reset all modstats for the entire server.'
            }));
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

        if (interaction.customId.startsWith(MANAGE_REMOVE_PREFIX)) {
            const payload = interaction.customId.slice(MANAGE_REMOVE_PREFIX.length);
            const separatorIndex = payload.lastIndexOf(':');
            const userId = separatorIndex === -1 ? null : payload.slice(0, separatorIndex);
            const caseNumber = separatorIndex === -1 ? null : payload.slice(separatorIndex + 1);

            if (!userId || !caseNumber) {
                await interaction.reply({ content: 'That infraction removal request is invalid.', ephemeral: true });
                return true;
            }

            const removedLog = typeof client.removeModLogCase === 'function'
                ? client.removeModLogCase(interaction.guild.id, caseNumber, userId)
                : null;

            if (!removedLog) {
                await interaction.reply({ content: 'That case could not be found or no longer belongs to this user.', ephemeral: true });
                return true;
            }

            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_USER_INFRACTIONS,
                selectedUserId: userId,
                notice: `Removed Case ${removedLog.caseNumber ?? removedLog.caseId} for <@${userId}>.`
            }));
            return true;
        }

        const ruleKey = interaction.customId.slice(MANAGE_RESET_PREFIX.length);
        const reset = client.resetInfractionRule(interaction.guild.id, ruleKey);
        if (!reset) {
            await interaction.reply({ content: 'Unknown infraction rule.', ephemeral: true });
            return true;
        }

        await interaction.update(buildManagePayload(client, interaction.guild.id, {
            panel: MANAGE_PANEL_RULES,
            selectedRuleKey: ruleKey
        }));
        return true;
    },
    async handleUserSelect({ client, interaction }) {
        if (interaction.customId !== MANAGE_USER_SELECT_ID && interaction.customId !== MANAGE_MODSTATS_USER_SELECT_ID) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        const selectedUserId = interaction.values?.[0];
        
        if (interaction.customId === MANAGE_MODSTATS_USER_SELECT_ID) {
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_MODSTATS,
                selectedModstatsUserId: selectedUserId
            }));
        } else {
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_USER_INFRACTIONS,
                selectedUserId
            }));
        }
        return true;
    },
    async handleModalSubmit({ client, interaction }) {
        if (!interaction.customId.startsWith(MANAGE_MODAL_PREFIX) && !interaction.customId.startsWith(MANAGE_MODSTATS_MODAL_PREFIX)) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        // Modstats: Save edited stats
        if (interaction.customId.startsWith(MANAGE_MODSTATS_MODAL_PREFIX)) {
            const payload = interaction.customId.slice(MANAGE_MODSTATS_MODAL_PREFIX.length);
            const colonIndex = payload.lastIndexOf(':');
            const userId = colonIndex === -1 ? payload : payload.slice(0, colonIndex);
            const timePeriod = colonIndex === -1 ? 'all' : payload.slice(colonIndex + 1);

            const mutesStr = interaction.fields.getTextInputValue(MODAL_MODSTATS_MUTES_INPUT_ID).trim();
            const bansStr = interaction.fields.getTextInputValue(MODAL_MODSTATS_BANS_INPUT_ID).trim();
            const kicksStr = interaction.fields.getTextInputValue(MODAL_MODSTATS_KICKS_INPUT_ID).trim();
            const warnsStr = interaction.fields.getTextInputValue(MODAL_MODSTATS_WARNS_INPUT_ID).trim();

            const mutes = Math.max(0, parseInt(mutesStr, 10) || 0);
            const bans = Math.max(0, parseInt(bansStr, 10) || 0);
            const kicks = Math.max(0, parseInt(kicksStr, 10) || 0);
            const warns = Math.max(0, parseInt(warnsStr, 10) || 0);

            if (!client.modStatsOverrides) {
                client.modStatsOverrides = new Map();
            }
            if (!client.modStatsOverrides.has(interaction.guild.id)) {
                client.modStatsOverrides.set(interaction.guild.id, new Map());
            }

            const userOverrides = client.modStatsOverrides.get(interaction.guild.id).get(userId) || {};
            userOverrides[timePeriod] = { mutes, bans, kicks, warns };
            client.modStatsOverrides.get(interaction.guild.id).set(userId, userOverrides);

            const periodLabel = timePeriod === '7d' ? 'Last 7 Days' : timePeriod === '30d' ? 'Last 30 Days' : 'All Time';
            await interaction.reply({
                content: `Updated ${periodLabel} modstats for <@${userId}>: Mutes: ${mutes}, Bans: ${bans}, Kicks: ${kicks}, Warns: ${warns}`,
                ...buildManagePayload(client, interaction.guild.id, {
                    panel: MANAGE_PANEL_MODSTATS,
                    selectedModstatsUserId: userId
                }),
                ephemeral: true
            });
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
            ...buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_RULES,
                selectedRuleKey: ruleKey
            }),
            ephemeral: true
        });
        return true;
    }
};
