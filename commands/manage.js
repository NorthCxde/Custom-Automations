const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
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
const MANAGE_PANEL_AUTOMOD = 'automod';

const MANAGE_AUTOMOD_RULE_SELECT_ID = 'manage_automod_rule_select';
const MANAGE_AUTOMOD_CREATE_ID = 'manage_automod_create';
const MANAGE_AUTOMOD_EDIT_PREFIX = 'manage_automod_edit:';
const MANAGE_AUTOMOD_DELETE_PREFIX = 'manage_automod_delete:';
const MANAGE_AUTOMOD_DRAFT_ALLOWED_CHANNELS_ID = 'manage_automod_draft_allowed_channels';
const MANAGE_AUTOMOD_DRAFT_IGNORED_CHANNELS_ID = 'manage_automod_draft_ignored_channels';
const MANAGE_AUTOMOD_DRAFT_LOG_CHANNEL_ID = 'manage_automod_draft_log_channel';
const MANAGE_AUTOMOD_DRAFT_ALLOWED_ROLES_ID = 'manage_automod_draft_allowed_roles';
const MANAGE_AUTOMOD_DRAFT_IGNORED_ROLES_ID = 'manage_automod_draft_ignored_roles';
const MANAGE_AUTOMOD_DRAFT_ALLOWED_USERS_ID = 'manage_automod_draft_allowed_users';
const MANAGE_AUTOMOD_DRAFT_IGNORED_USERS_ID = 'manage_automod_draft_ignored_users';
const MANAGE_AUTOMOD_DRAFT_MATCH_ID = 'manage_automod_draft_match';
const MANAGE_AUTOMOD_DRAFT_TYPE_ID = 'manage_automod_draft_type';
const MANAGE_AUTOMOD_DRAFT_ACTION_ID = 'manage_automod_draft_action';
const MANAGE_AUTOMOD_DRAFT_IGNORE_ADMINS_ID = 'manage_automod_draft_ignore_admins';
const MANAGE_AUTOMOD_DRAFT_ENABLED_ID = 'manage_automod_draft_enabled';
const MANAGE_AUTOMOD_DRAFT_FIELD_ID = 'manage_automod_draft_field';
const MANAGE_AUTOMOD_DRAFT_CUSTOM_ID = 'manage_automod_draft_custom';
const MANAGE_AUTOMOD_DRAFT_ROLES_ID = 'manage_automod_draft_roles';
const MANAGE_AUTOMOD_DRAFT_USERS_ID = 'manage_automod_draft_users';
const MANAGE_AUTOMOD_DRAFT_SAVE_ID = 'manage_automod_draft_save';
const MANAGE_AUTOMOD_MODAL_PREFIX = 'manage_automod_modal:';
const MANAGE_AUTOMOD_CUSTOM_MODAL_PREFIX = 'manage_automod_custom_modal:';
const MODAL_AUTOMOD_NAME_INPUT_ID = 'name';
const MODAL_AUTOMOD_TRIGGER_INPUT_ID = 'trigger';
const MODAL_AUTOMOD_ACTION_INPUT_ID = 'action';
const MODAL_AUTOMOD_TIMEOUT_INPUT_ID = 'timeout';
const MODAL_AUTOMOD_CUSTOM_A_ID = 'custom_a';
const MODAL_AUTOMOD_CUSTOM_B_ID = 'custom_b';
const MODAL_AUTOMOD_CUSTOM_RESPONSE_INPUT_ID = 'custom_response';

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
                },
                {
                    label: 'Automod',
                    value: MANAGE_PANEL_AUTOMOD,
                    description: 'Create and manage custom automod rules',
                    default: selectedPanel === MANAGE_PANEL_AUTOMOD
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
        const logs7dStats = {
            mutes: logs7d.filter(log => log.action === 'Mute').length,
            bans: logs7d.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
            kicks: logs7d.filter(log => log.action === 'Kick').length,
            warns: logs7d.filter(log => log.action === 'Warn').length
        };
        stats7d = userOverrides['7d'] || logs7dStats;

        // 30 days
        const logs30d = userLogs.filter(log => {
            const ts = new Date(log.timestamp).getTime();
            return !isNaN(ts) && now - ts <= MS_30D;
        });
        const logs30dStats = {
            mutes: logs30d.filter(log => log.action === 'Mute').length,
            bans: logs30d.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
            kicks: logs30d.filter(log => log.action === 'Kick').length,
            warns: logs30d.filter(log => log.action === 'Warn').length
        };
        stats30d = userOverrides['30d'] || logs30dStats;

        // All time
        const logsAllStats = {
            mutes: userLogs.filter(log => log.action === 'Mute').length,
            bans: userLogs.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
            kicks: userLogs.filter(log => log.action === 'Kick').length,
            warns: userLogs.filter(log => log.action === 'Warn').length
        };
        statsAll = userOverrides['all'] || logsAllStats;
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

const AUTOMOD_TYPE_ORDER = [
    'mentions_cooldown',
    'masked_links',
    'invite_links',
    'fast_message_spam',
    'anti_newline',
    'character_count',
    'zalgo_text',
    'word_blacklist',
    'emoji_spam',
    'anti_links',
    'keyword'
];

const AUTOMOD_TYPE_LABELS = {
    mentions_cooldown: 'Mentions Cooldown',
    masked_links: 'Masked Links',
    invite_links: 'Invite Links',
    fast_message_spam: 'Fast Message Spam',
    anti_newline: 'Anti Newline',
    character_count: 'Character Count',
    zalgo_text: 'Zalgo Text',
    word_blacklist: 'Word Blacklist',
    emoji_spam: 'Emoji Spam',
    anti_links: 'Anti Links',
    keyword: 'Keyword Trigger'
};

const AUTOMOD_ACTION_ORDER = ['delete', 'delete_warn', 'timeout', 'kick', 'ban'];
const AUTOMOD_ACTION_LABELS = {
    delete: 'Delete',
    delete_warn: 'Warn + Delete',
    timeout: 'Instant Mute',
    kick: 'Kick',
    ban: 'Ban'
};

const AUTOMOD_ACTION_PRESETS = [
    ['delete'],
    ['delete', 'delete_warn'],
    ['delete', 'timeout'],
    ['delete', 'kick'],
    ['delete', 'ban'],
    ['delete', 'delete_warn', 'timeout']
];

function normalizeAutomodActions(rawActions, fallbackAction = 'delete') {
    const source = Array.isArray(rawActions) ? rawActions : [rawActions || fallbackAction];
    const normalized = [...new Set(source
        .map(value => String(value || '').trim().toLowerCase())
        .filter(value => AUTOMOD_ACTION_ORDER.includes(value)))];

    return normalized.length ? normalized : ['delete'];
}

function parseAutomodActionsInput(text) {
    const rawTokens = String(text || '')
        .split(/[,+]/g)
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);

    if (!rawTokens.length) {
        return { actions: ['delete'], invalid: [] };
    }

    const invalid = rawTokens.filter(token => !AUTOMOD_ACTION_ORDER.includes(token));
    const actions = normalizeAutomodActions(rawTokens);
    return { actions, invalid };
}

function formatAutomodActions(actions) {
    return normalizeAutomodActions(actions)
        .map(action => AUTOMOD_ACTION_LABELS[action] || action)
        .join(' + ');
}

function getAutomodDraftKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function getDefaultCustomForType(type) {
    switch (type) {
    case 'mentions_cooldown':
        return { maxMentions: 6, windowSeconds: 30 };
    case 'fast_message_spam':
        return { maxMessages: 8, windowSeconds: 5 };
    case 'anti_newline':
        return { maxNewlines: 7 };
    case 'character_count':
        return { maxCharacters: 350 };
    case 'emoji_spam':
        return { maxEmojis: 6 };
    case 'word_blacklist':
        return { bannedWordsWildcard: [], bannedWordsExact: [] };
    case 'anti_links':
        return { deleteAllLinks: true, allowedLinks: [] };
    case 'invite_links':
        return { allowedInvites: [] };
    default:
        return {};
    }
}

function sanitizeCustomByType(type, customInput) {
    const defaults = getDefaultCustomForType(type);
    const custom = { ...(customInput && typeof customInput === 'object' ? customInput : {}) };

    if (type === 'mentions_cooldown') {
        return {
            maxMentions: Math.max(1, Number(custom.maxMentions) || defaults.maxMentions),
            windowSeconds: Math.max(1, Number(custom.windowSeconds) || defaults.windowSeconds)
        };
    }

    if (type === 'fast_message_spam') {
        return {
            maxMessages: Math.max(2, Number(custom.maxMessages) || defaults.maxMessages),
            windowSeconds: Math.max(1, Number(custom.windowSeconds) || defaults.windowSeconds)
        };
    }

    if (type === 'anti_newline') {
        return {
            maxNewlines: Math.max(1, Number(custom.maxNewlines) || defaults.maxNewlines)
        };
    }

    if (type === 'character_count') {
        return {
            maxCharacters: Math.max(25, Number(custom.maxCharacters) || defaults.maxCharacters)
        };
    }

    if (type === 'emoji_spam') {
        return {
            maxEmojis: Math.max(1, Number(custom.maxEmojis) || defaults.maxEmojis)
        };
    }

    if (type === 'word_blacklist') {
        return {
            bannedWordsWildcard: Array.isArray(custom.bannedWordsWildcard) ? custom.bannedWordsWildcard.map(String).map(v => v.trim()).filter(Boolean) : [],
            bannedWordsExact: Array.isArray(custom.bannedWordsExact) ? custom.bannedWordsExact.map(String).map(v => v.trim()).filter(Boolean) : []
        };
    }

    if (type === 'anti_links') {
        return {
            deleteAllLinks: custom.deleteAllLinks !== false,
            allowedLinks: Array.isArray(custom.allowedLinks) ? custom.allowedLinks.map(String).map(v => v.trim()).filter(Boolean) : []
        };
    }

    if (type === 'invite_links') {
        return {
            allowedInvites: Array.isArray(custom.allowedInvites) ? custom.allowedInvites.map(String).map(v => v.trim()).filter(Boolean) : []
        };
    }

    return defaults;
}

function buildAutomodDraftFromRule(rule, userId) {
    const type = AUTOMOD_TYPE_ORDER.includes(rule?.type) ? rule.type : 'keyword';
    const actions = normalizeAutomodActions(rule?.actions, rule?.action);
    return {
        id: String(rule?.id || `am_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`),
        name: String(rule?.name || AUTOMOD_TYPE_LABELS[type] || 'AutoMod Rule').trim(),
        type,
        trigger: String(rule?.trigger || '').trim(),
        matchType: rule?.matchType === 'exact' ? 'exact' : 'contains',
        actions,
        action: actions[0],
        timeoutDuration: String(rule?.timeoutDuration || '10m').trim() || '10m',
        enabled: rule?.enabled !== false,
        ignoreAdmins: rule?.ignoreAdmins !== false,
        allowedChannelIds: Array.isArray(rule?.allowedChannelIds) ? [...rule.allowedChannelIds] : [],
        ignoredChannelIds: Array.isArray(rule?.ignoredChannelIds) ? [...rule.ignoredChannelIds] : [],
        allowedRoleIds: Array.isArray(rule?.allowedRoleIds) ? [...rule.allowedRoleIds] : [],
        ignoredRoleIds: Array.isArray(rule?.ignoredRoleIds) ? [...rule.ignoredRoleIds] : [],
        allowedUserIds: Array.isArray(rule?.allowedUserIds) ? [...rule.allowedUserIds] : [],
        ignoredUserIds: Array.isArray(rule?.ignoredUserIds) ? [...rule.ignoredUserIds] : [],
        custom: sanitizeCustomByType(type, rule?.custom),
        logChannelId: String(rule?.logChannelId || '').trim(),
        customResponse: String(rule?.customResponse || '').trim(),
        createdBy: String(rule?.createdBy || userId || ''),
        createdAt: String(rule?.createdAt || new Date().toISOString())
    };
}

function createDefaultAutomodDraft(userId) {
    return buildAutomodDraftFromRule({
        type: 'mentions_cooldown',
        actions: ['delete', 'delete_warn'],
        name: 'Mentions Cooldown'
    }, userId);
}

function formatAutomodCustom(type, custom = {}) {
    const value = sanitizeCustomByType(type, custom);
    if (type === 'mentions_cooldown') return `Max Mentions: ${value.maxMentions}\nWindow: ${value.windowSeconds}s`;
    if (type === 'fast_message_spam') return `Max Messages: ${value.maxMessages}\nWindow: ${value.windowSeconds}s`;
    if (type === 'anti_newline') return `Max Newlines: ${value.maxNewlines}`;
    if (type === 'character_count') return `Max Characters: ${value.maxCharacters}`;
    if (type === 'emoji_spam') return `Max Emojis: ${value.maxEmojis}`;
    if (type === 'word_blacklist') {
        const wildcard = value.bannedWordsWildcard?.length ? value.bannedWordsWildcard.join(', ') : 'None';
        const exact = value.bannedWordsExact?.length ? value.bannedWordsExact.join(', ') : 'None';
        return `Wildcard Words: ${truncate(wildcard, 250)}\nExact Words: ${truncate(exact, 250)}`;
    }
    if (type === 'anti_links') {
        const allow = value.allowedLinks?.length ? value.allowedLinks.join(', ') : 'None';
        return `Mode: ${value.deleteAllLinks ? 'Delete all links' : 'Delete disallowed links only'}\nAllowlist: ${truncate(allow, 250)}`;
    }
    if (type === 'invite_links') {
        const allow = value.allowedInvites?.length ? value.allowedInvites.join(', ') : 'None';
        return `Allowed Invites: ${truncate(allow, 250)}`;
    }
    return 'No extra settings.';
}

function getAutomodCustomHint(type) {
    if (type === 'mentions_cooldown') return 'maxMentions=6\nwindowSeconds=30';
    if (type === 'fast_message_spam') return 'maxMessages=8\nwindowSeconds=5';
    if (type === 'anti_newline') return 'maxNewlines=7';
    if (type === 'character_count') return 'maxCharacters=350';
    if (type === 'emoji_spam') return 'maxEmojis=6';
    if (type === 'word_blacklist') return 'bannedWordsWildcard=paypal, /discord.gg\nbannedWordsExact=paypal, bio';
    if (type === 'anti_links') return 'deleteAllLinks=true\nallowedLinks=https://youtube.com, https://roblox.com';
    if (type === 'invite_links') return 'allowedInvites=myserver, discord.gg/myserver';
    return 'No custom keys for this rule type.';
}

function parsePositiveIntInput(value, fieldLabel, min = 1) {
    const parsed = Number(String(value || '').trim());
    if (!Number.isFinite(parsed) || parsed < min) {
        return { value: null, error: `${fieldLabel} must be a number >= ${min}.` };
    }
    return { value: Math.floor(parsed), error: null };
}

function formatAutomodRuleSummary(rule, idx) {
    const typeLabel = AUTOMOD_TYPE_LABELS[rule.type] || rule.type || 'Unknown';
    const actionLabel = formatAutomodActions(rule.actions || rule.action);
    return `${idx + 1}. ${rule.name || typeLabel}\n${typeLabel} | ${actionLabel} | ${rule.enabled === false ? 'Disabled' : 'Enabled'}`;
}

function buildAutomodListPayload(client, guildId, selectedRuleId, notice) {
    const rules = client.getAutomodRules(guildId);
    const selected = rules.find(rule => rule.id === selectedRuleId) || null;

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Manage Panel - Automod')
        .setDescription('Build highly customizable automod rules with per-rule actions, thresholds, and permission filters.')
        .setTimestamp();

    if (!rules.length) {
        embed.addFields({
            name: 'No Rules Yet',
            value: 'Create your first automod rule below.',
            inline: false
        });
    } else {
        embed.addFields({
            name: 'Rules',
            value: rules.slice(0, 10).map(formatAutomodRuleSummary).join('\n\n') || 'No rules found.',
            inline: false
        });

        if (selected) {
            embed.addFields({
                name: 'Selected Rule',
                value: [
                    `Name: ${selected.name || (AUTOMOD_TYPE_LABELS[selected.type] || selected.type)}`,
                    `Type: ${AUTOMOD_TYPE_LABELS[selected.type] || selected.type}`,
                    `Actions: ${formatAutomodActions(selected.actions || selected.action)}`,
                    `Enabled: ${selected.enabled === false ? 'No' : 'Yes'}`
                ].join('\n'),
                inline: false
            });
        }
    }

    const components = [buildPanelSelectRow(MANAGE_PANEL_AUTOMOD)];

    if (rules.length) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(MANAGE_AUTOMOD_RULE_SELECT_ID)
                    .setPlaceholder('Select an automod rule to edit')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(rules.slice(0, 25).map((rule) => ({
                        label: String(rule.name || (AUTOMOD_TYPE_LABELS[rule.type] || rule.type)).slice(0, 100),
                        value: rule.id,
                        description: `${AUTOMOD_TYPE_LABELS[rule.type] || rule.type} | ${rule.enabled === false ? 'Disabled' : 'Enabled'}`.slice(0, 100),
                        default: rule.id === selectedRuleId
                    })))
            )
        );
    }

    components.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(MANAGE_AUTOMOD_CREATE_ID)
                .setLabel('Create New')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(selected ? `${MANAGE_AUTOMOD_EDIT_PREFIX}${selected.id}` : `${MANAGE_AUTOMOD_EDIT_PREFIX}none`)
                .setLabel('Edit Selected')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!selected),
            new ButtonBuilder()
                .setCustomId(selected ? `${MANAGE_AUTOMOD_DELETE_PREFIX}${selected.id}` : `${MANAGE_AUTOMOD_DELETE_PREFIX}none`)
                .setLabel('Delete Selected')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!selected)
        )
    );

    return {
        content: notice || null,
        embeds: [embed],
        components
    };
}

function buildAutomodUserFiltersPayload(draft) {
    const userMentions = (ids) => ids.length ? ids.map(id => `<@${id}>`).join(', ') : 'None';
    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Automod Rule - User Filters')
        .setDescription('Configure allowed or ignored users for this automod rule.')
        .addFields(
            { name: 'Allowed Users', value: userMentions(draft.allowedUserIds), inline: false },
            { name: 'Ignored Users', value: userMentions(draft.ignoredUserIds), inline: false }
        );

    const allowedUsersMenu = new UserSelectMenuBuilder()
        .setCustomId(MANAGE_AUTOMOD_DRAFT_ALLOWED_USERS_ID)
        .setPlaceholder('Allowed Users')
        .setMinValues(0)
        .setMaxValues(25);
    if (typeof allowedUsersMenu.setDefaultUsers === 'function' && draft.allowedUserIds.length) {
        allowedUsersMenu.setDefaultUsers(draft.allowedUserIds.slice(0, 25));
    }

    const ignoredUsersMenu = new UserSelectMenuBuilder()
        .setCustomId(MANAGE_AUTOMOD_DRAFT_IGNORED_USERS_ID)
        .setPlaceholder('Ignored Users')
        .setMinValues(0)
        .setMaxValues(25);
    if (typeof ignoredUsersMenu.setDefaultUsers === 'function' && draft.ignoredUserIds.length) {
        ignoredUsersMenu.setDefaultUsers(draft.ignoredUserIds.slice(0, 25));
    }

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(allowedUsersMenu),
            new ActionRowBuilder().addComponents(ignoredUsersMenu),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(MANAGE_AUTOMOD_DRAFT_BACK_ID)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    };
}

const MANAGE_AUTOMOD_DRAFT_BACK_ID = 'manage_automod_draft_back';

function buildAutomodRoleFiltersPayload(draft) {
    const roleMentions = (ids) => ids.length ? ids.map(id => `<@&${id}>`).join(', ') : 'None';
    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Automod Rule - Role Filters')
        .setDescription('Configure allowed or ignored roles for this automod rule.')
        .addFields(
            { name: 'Allowed Roles', value: roleMentions(draft.allowedRoleIds), inline: false },
            { name: 'Ignored Roles', value: roleMentions(draft.ignoredRoleIds), inline: false }
        );

    const allowedRolesMenu = new RoleSelectMenuBuilder()
        .setCustomId(MANAGE_AUTOMOD_DRAFT_ALLOWED_ROLES_ID)
        .setPlaceholder('Allowed Roles')
        .setMinValues(0)
        .setMaxValues(25);
    if (draft.allowedRoleIds.length) {
        allowedRolesMenu.setDefaultRoles(draft.allowedRoleIds.slice(0, 25));
    }

    const ignoredRolesMenu = new RoleSelectMenuBuilder()
        .setCustomId(MANAGE_AUTOMOD_DRAFT_IGNORED_ROLES_ID)
        .setPlaceholder('Ignored Roles')
        .setMinValues(0)
        .setMaxValues(25);
    if (draft.ignoredRoleIds.length) {
        ignoredRolesMenu.setDefaultRoles(draft.ignoredRoleIds.slice(0, 25));
    }

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(allowedRolesMenu),
            new ActionRowBuilder().addComponents(ignoredRolesMenu),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(MANAGE_AUTOMOD_DRAFT_BACK_ID)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    };
}

function buildAutomodDraftPayload(draft, notice) {
    const channelMentions = (ids) => ids.length ? ids.map(id => `<#${id}>`).join(', ') : 'None';
    const roleMentions = (ids) => ids.length ? ids.map(id => `<@&${id}>`).join(', ') : 'None';
    const userMentions = (ids) => ids.length ? ids.map(id => `<@${id}>`).join(', ') : 'None';
    const typeLabel = AUTOMOD_TYPE_LABELS[draft.type] || draft.type;
    const actionLabel = formatAutomodActions(draft.actions);

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Manage Panel - Automod Rule Editor')
        .setDescription('Fine-tune this rule, then press Save.')
        .addFields(
            { name: 'Name', value: draft.name || typeLabel, inline: false },
            { name: 'Rule Type', value: typeLabel, inline: true },
            { name: 'Actions', value: actionLabel, inline: true },
            { name: 'Enabled', value: draft.enabled ? 'Yes' : 'No', inline: true },
            { name: 'Match', value: draft.matchType === 'exact' ? 'Exact' : 'Contains', inline: true },
            { name: 'Ignore Admins', value: draft.ignoreAdmins ? 'Yes' : 'No', inline: true },
            { name: 'Trigger / Pattern', value: draft.trigger || 'None', inline: false },
            { name: 'Timeout Duration', value: draft.timeoutDuration || '10m', inline: true },
            { name: 'Custom Settings', value: formatAutomodCustom(draft.type, draft.custom), inline: false },
            { name: 'Log Channel', value: draft.logChannelId ? `<#${draft.logChannelId}>` : 'None', inline: true },
            { name: 'Custom Response', value: draft.customResponse || 'None', inline: true },
            { name: 'Allowed Channels', value: channelMentions(draft.allowedChannelIds), inline: false },
            { name: 'Ignored Channels', value: channelMentions(draft.ignoredChannelIds), inline: false },
            { name: 'Allowed Roles', value: roleMentions(draft.allowedRoleIds), inline: false },
            { name: 'Ignored Roles', value: roleMentions(draft.ignoredRoleIds), inline: false },
            { name: 'Allowed Users', value: userMentions(draft.allowedUserIds), inline: false },
            { name: 'Ignored Users', value: userMentions(draft.ignoredUserIds), inline: false }
        )
        .setTimestamp();

    const allowedChannelsMenu = new ChannelSelectMenuBuilder()
        .setCustomId(MANAGE_AUTOMOD_DRAFT_ALLOWED_CHANNELS_ID)
        .setPlaceholder('Allowed Channels')
        .setMinValues(0)
        .setMaxValues(25);
    if (typeof allowedChannelsMenu.setDefaultChannels === 'function' && draft.allowedChannelIds.length) {
        allowedChannelsMenu.setDefaultChannels(draft.allowedChannelIds.slice(0, 25));
    }

    const ignoredChannelsMenu = new ChannelSelectMenuBuilder()
        .setCustomId(MANAGE_AUTOMOD_DRAFT_IGNORED_CHANNELS_ID)
        .setPlaceholder('Ignored Channels')
        .setMinValues(0)
        .setMaxValues(25);
    if (typeof ignoredChannelsMenu.setDefaultChannels === 'function' && draft.ignoredChannelIds.length) {
        ignoredChannelsMenu.setDefaultChannels(draft.ignoredChannelIds.slice(0, 25));
    }

    const logChannelMenu = new ChannelSelectMenuBuilder()
        .setCustomId(MANAGE_AUTOMOD_DRAFT_LOG_CHANNEL_ID)
        .setPlaceholder('Log Channel (optional)')
        .setMinValues(0)
        .setMaxValues(1);
    if (typeof logChannelMenu.setDefaultChannels === 'function' && draft.logChannelId) {
        logChannelMenu.setDefaultChannels([draft.logChannelId]);
    }

    const primaryRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_TYPE_ID)
            .setLabel(`Type: ${typeLabel}`.slice(0, 80))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_ACTION_ID)
            .setLabel(`Actions: ${actionLabel}`.slice(0, 80))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_MATCH_ID)
            .setLabel(`Match: ${draft.matchType === 'exact' ? 'Exact' : 'Contains'}`)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_ENABLED_ID)
            .setLabel(draft.enabled ? 'Disable' : 'Enable')
            .setStyle(draft.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_IGNORE_ADMINS_ID)
            .setLabel(`Ignore Admins: ${draft.ignoreAdmins ? 'On' : 'Off'}`)
            .setStyle(ButtonStyle.Secondary)
    );

    const secondaryRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_FIELD_ID)
            .setLabel('Field')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_CUSTOM_ID)
            .setLabel('Custom')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_ROLES_ID)
            .setLabel('Roles')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_USERS_ID)
            .setLabel('Users')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(MANAGE_AUTOMOD_DRAFT_SAVE_ID)
            .setLabel('Save')
            .setStyle(ButtonStyle.Success)
    );

    return {
        content: notice || null,
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(allowedChannelsMenu),
            new ActionRowBuilder().addComponents(ignoredChannelsMenu),
            new ActionRowBuilder().addComponents(logChannelMenu),
            primaryRow,
            secondaryRow
        ]
    };
}

function parseAutomodCustomInput(text, draftType, currentCustom) {
    const out = { ...(currentCustom || {}) };
    const errors = [];
    const lines = String(text || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);

    for (const line of lines) {
        const sep = line.indexOf('=');
        if (sep === -1) {
            errors.push(`Invalid custom line: ${line}`);
            continue;
        }
        const key = line.slice(0, sep).trim();
        const value = line.slice(sep + 1).trim();
        if (!key) continue;

        if (['maxMentions', 'windowSeconds', 'maxMessages', 'maxNewlines', 'maxCharacters', 'maxEmojis'].includes(key)) {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 1) {
                errors.push(`Invalid number for ${key}`);
            } else {
                out[key] = Math.floor(n);
            }
            continue;
        }

        if (key === 'deleteAllLinks') {
            out.deleteAllLinks = ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
            continue;
        }

        if (['bannedWordsWildcard', 'bannedWordsExact', 'allowedLinks', 'allowedInvites'].includes(key)) {
            out[key] = value.split(',').map(v => v.trim()).filter(Boolean);
            continue;
        }

        errors.push(`Unknown custom key: ${key}`);
    }

    return { custom: sanitizeCustomByType(draftType, out), errors };
}

function buildAutomodRulePayloadFromDraft(draft, fallbackUserId) {
    const actions = normalizeAutomodActions(draft.actions, draft.action);
    return {
        id: draft.id,
        name: String(draft.name || (AUTOMOD_TYPE_LABELS[draft.type] || 'Automod Rule')).trim(),
        type: AUTOMOD_TYPE_ORDER.includes(draft.type) ? draft.type : 'keyword',
        trigger: String(draft.trigger || '').trim(),
        matchType: draft.matchType === 'exact' ? 'exact' : 'contains',
        actions,
        action: actions[0],
        timeoutDuration: String(draft.timeoutDuration || '10m').trim() || '10m',
        enabled: draft.enabled !== false,
        ignoreAdmins: draft.ignoreAdmins !== false,
        allowedChannelIds: [...new Set((draft.allowedChannelIds || []).map(String))],
        ignoredChannelIds: [...new Set((draft.ignoredChannelIds || []).map(String))],
        allowedRoleIds: [...new Set((draft.allowedRoleIds || []).map(String))],
        ignoredRoleIds: [...new Set((draft.ignoredRoleIds || []).map(String))],
        allowedUserIds: [...new Set((draft.allowedUserIds || []).map(String))],
        ignoredUserIds: [...new Set((draft.ignoredUserIds || []).map(String))],
        custom: sanitizeCustomByType(draft.type, draft.custom),
        logChannelId: String(draft.logChannelId || '').trim(),
        customResponse: String(draft.customResponse || '').trim(),
        createdBy: draft.createdBy || fallbackUserId,
        createdAt: draft.createdAt || new Date().toISOString()
    };
}

function buildManagePayload(client, guildId, options = {}) {
    const {
        panel = MANAGE_PANEL_RULES,
        selectedRuleKey,
        selectedUserId,
        selectedCaseNumber,
        selectedModstatsUserId,
        selectedAutomodRuleId,
        automodDraft,
        notice
    } = options;

    if (panel === MANAGE_PANEL_USER_INFRACTIONS) {
        return buildUserInfractionsPayload(client, guildId, selectedUserId, selectedCaseNumber, notice);
    }

    if (panel === MANAGE_PANEL_MODSTATS) {
        return buildModstatsManagePayload(client, guildId, selectedModstatsUserId, notice);
    }

    if (panel === MANAGE_PANEL_AUTOMOD) {
        if (automodDraft) return buildAutomodDraftPayload(automodDraft, notice);
        return buildAutomodListPayload(client, guildId, selectedAutomodRuleId, notice);
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
            && interaction.customId !== MANAGE_AUTOMOD_RULE_SELECT_ID
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
            
            // Calculate stats from logs using the EXACT same method as the panel
            const logs = client.modLogs?.get(interaction.guild.id) || [];
            const userLogs = logs.filter(log => String(log.moderatorId) === String(userId));
            const userOverrides = client.modStatsOverrides.get(interaction.guild.id).get(userId) || {};
            
            const MS_7D  = 7  * 24 * 60 * 60 * 1000;
            const MS_30D = 30 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            
            let periodStats;
            if (timePeriod === '7d') {
                const logs7d = userLogs.filter(log => {
                    const ts = new Date(log.timestamp).getTime();
                    return !isNaN(ts) && now - ts <= MS_7D;
                });
                const logsStats = {
                    mutes: logs7d.filter(log => log.action === 'Mute').length,
                    bans: logs7d.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
                    kicks: logs7d.filter(log => log.action === 'Kick').length,
                    warns: logs7d.filter(log => log.action === 'Warn').length
                };
                // Use override if it exists, otherwise use logs
                periodStats = userOverrides[timePeriod] || logsStats;
            } else if (timePeriod === '30d') {
                const logs30d = userLogs.filter(log => {
                    const ts = new Date(log.timestamp).getTime();
                    return !isNaN(ts) && now - ts <= MS_30D;
                });
                const logsStats = {
                    mutes: logs30d.filter(log => log.action === 'Mute').length,
                    bans: logs30d.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
                    kicks: logs30d.filter(log => log.action === 'Kick').length,
                    warns: logs30d.filter(log => log.action === 'Warn').length
                };
                // Use override if it exists, otherwise use logs
                periodStats = userOverrides[timePeriod] || logsStats;
            } else {
                const logsStats = {
                    mutes: userLogs.filter(log => log.action === 'Mute').length,
                    bans: userLogs.filter(log => log.action === 'Ban' || log.action === 'Temp Ban').length,
                    kicks: userLogs.filter(log => log.action === 'Kick').length,
                    warns: userLogs.filter(log => log.action === 'Warn').length
                };
                // Use override if it exists, otherwise use logs
                periodStats = userOverrides[timePeriod] || logsStats;
            }
            
            // Ensure all values are valid numbers
            const mutesVal = Math.max(0, Number(periodStats.mutes) || 0);
            const bansVal = Math.max(0, Number(periodStats.bans) || 0);
            const kicksVal = Math.max(0, Number(periodStats.kicks) || 0);
            const warnsVal = Math.max(0, Number(periodStats.warns) || 0);

            const modal = new ModalBuilder()
                .setCustomId(`${MANAGE_MODSTATS_MODAL_PREFIX}${userId}:${timePeriod}:${Math.floor(Math.random() * 9999)}`)
                .setTitle(`Edit Modstats (${timePeriod === '7d' ? 'Last 7 Days' : timePeriod === '30d' ? 'Last 30 Days' : 'All Time'})`);

            const mutesInput = new TextInputBuilder()
                .setCustomId(MODAL_MODSTATS_MUTES_INPUT_ID)
                .setLabel('Mutes')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(mutesVal));
            
            const bansInput = new TextInputBuilder()
                .setCustomId(MODAL_MODSTATS_BANS_INPUT_ID)
                .setLabel('Bans')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(bansVal));
            
            const kicksInput = new TextInputBuilder()
                .setCustomId(MODAL_MODSTATS_KICKS_INPUT_ID)
                .setLabel('Kicks')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(kicksVal));
            
            const warnsInput = new TextInputBuilder()
                .setCustomId(MODAL_MODSTATS_WARNS_INPUT_ID)
                .setLabel('Warns')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(warnsVal));

            modal.addComponents(
                new ActionRowBuilder().addComponents(mutesInput),
                new ActionRowBuilder().addComponents(bansInput),
                new ActionRowBuilder().addComponents(kicksInput),
                new ActionRowBuilder().addComponents(warnsInput)
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

             if (panel === MANAGE_PANEL_AUTOMOD) {
                await interaction.update(buildManagePayload(client, interaction.guild.id, { panel: MANAGE_PANEL_AUTOMOD }));
                return true;
            }

            const firstRule = RULE_CHOICES[0]?.value;
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_RULES,
                selectedRuleKey: firstRule
            }));
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_RULE_SELECT_ID) {
            const selectedAutomodRuleId = interaction.values?.[0] || null;
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_AUTOMOD,
                selectedAutomodRuleId
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
            && interaction.customId !== MANAGE_AUTOMOD_CREATE_ID
            && !interaction.customId.startsWith(MANAGE_AUTOMOD_EDIT_PREFIX)
            && !interaction.customId.startsWith(MANAGE_AUTOMOD_DELETE_PREFIX)
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_MATCH_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_TYPE_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_ACTION_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_IGNORE_ADMINS_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_ENABLED_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_FIELD_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_CUSTOM_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_ROLES_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_USERS_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_SAVE_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_BACK_ID
            && !interaction.customId.startsWith(MANAGE_MODSTATS_EDIT_PREFIX)
            && !interaction.customId.startsWith(MANAGE_MODSTATS_RESET_USER_PREFIX)
            && interaction.customId !== MANAGE_MODSTATS_RESET_ALL_ID) {
            return false;
        }

        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        const automodDraftKey = getAutomodDraftKey(interaction.guild.id, interaction.user.id);
        const getDraft = () => client.automodDrafts?.get(automodDraftKey) || null;
        const saveDraft = (draft) => {
            if (!client.automodDrafts) client.automodDrafts = new Map();
            client.automodDrafts.set(automodDraftKey, draft);
        };

        if (interaction.customId === MANAGE_AUTOMOD_CREATE_ID) {
            const draft = createDefaultAutomodDraft(interaction.user.id);
            saveDraft(draft);
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_AUTOMOD,
                automodDraft: draft,
                notice: 'Created a new automod draft. Configure and save it.'
            }));
            return true;
        }

        if (interaction.customId.startsWith(MANAGE_AUTOMOD_EDIT_PREFIX)) {
            const ruleId = interaction.customId.slice(MANAGE_AUTOMOD_EDIT_PREFIX.length);
            const rule = client.getAutomodRules(interaction.guild.id).find(item => item.id === ruleId);
            if (!rule) {
                await interaction.reply({ content: 'That automod rule could not be found.', ephemeral: true });
                return true;
            }

            const draft = buildAutomodDraftFromRule(rule, interaction.user.id);
            saveDraft(draft);
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_AUTOMOD,
                automodDraft: draft,
                notice: `Editing automod rule: ${draft.name}`
            }));
            return true;
        }

        if (interaction.customId.startsWith(MANAGE_AUTOMOD_DELETE_PREFIX)) {
            const ruleId = interaction.customId.slice(MANAGE_AUTOMOD_DELETE_PREFIX.length);
            const deleted = typeof client.deleteAutomodRule === 'function'
                ? client.deleteAutomodRule(interaction.guild.id, ruleId)
                : false;
            if (!deleted) {
                await interaction.reply({ content: 'That automod rule no longer exists.', ephemeral: true });
                return true;
            }

            if (client.automodDrafts) client.automodDrafts.delete(automodDraftKey);
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_AUTOMOD,
                notice: 'Automod rule deleted.'
            }));
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_BACK_ID) {
            const draft = getDraft();
            if (draft) {
                await interaction.update(buildManagePayload(client, interaction.guild.id, {
                    panel: MANAGE_PANEL_AUTOMOD,
                    automodDraft: draft,
                    notice: 'Returned to automod editor.'
                }));
            } else {
                await interaction.update(buildManagePayload(client, interaction.guild.id, {
                    panel: MANAGE_PANEL_AUTOMOD
                }));
            }
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_USERS_ID) {
            const draft = getDraft();
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            await interaction.update({
                content: 'Configure user filters, then return to the main draft.',
                ...buildAutomodUserFiltersPayload(draft)
            });
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_ROLES_ID) {
            const draft = getDraft();
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            await interaction.update({
                content: 'Configure role filters, then return to the main draft.',
                ...buildAutomodRoleFiltersPayload(draft)
            });
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_CUSTOM_ID) {
            const draft = getDraft();
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            const custom = sanitizeCustomByType(draft.type, draft.custom);
            const modal = new ModalBuilder()
                .setCustomId(`${MANAGE_AUTOMOD_CUSTOM_MODAL_PREFIX}${draft.id}`)
                .setTitle(`Custom: ${String(draft.name || 'Automod').slice(0, 25)}`);

            if (draft.type === 'mentions_cooldown' || draft.type === 'fast_message_spam') {
                const countLabel = draft.type === 'mentions_cooldown' ? 'Max Mentions' : 'Max Messages';
                const countValue = draft.type === 'mentions_cooldown' ? custom.maxMentions : custom.maxMessages;
                const countInput = new TextInputBuilder()
                    .setCustomId(MODAL_AUTOMOD_CUSTOM_A_ID)
                    .setLabel(countLabel)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(countValue || '1'));
                const windowInput = new TextInputBuilder()
                    .setCustomId(MODAL_AUTOMOD_CUSTOM_B_ID)
                    .setLabel('Window Seconds')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(custom.windowSeconds || '5'));
                modal.addComponents(
                    new ActionRowBuilder().addComponents(countInput),
                    new ActionRowBuilder().addComponents(windowInput)
                );
            } else if (draft.type === 'anti_newline' || draft.type === 'character_count' || draft.type === 'emoji_spam') {
                const inputLabel = draft.type === 'anti_newline'
                    ? 'Max Newlines'
                    : (draft.type === 'character_count' ? 'Max Characters' : 'Max Emojis');
                const value = draft.type === 'anti_newline'
                    ? custom.maxNewlines
                    : (draft.type === 'character_count' ? custom.maxCharacters : custom.maxEmojis);
                const input = new TextInputBuilder()
                    .setCustomId(MODAL_AUTOMOD_CUSTOM_A_ID)
                    .setLabel(inputLabel)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(value || '1'));
                modal.addComponents(new ActionRowBuilder().addComponents(input));
            } else if (draft.type === 'word_blacklist') {
                const wildcardInput = new TextInputBuilder()
                    .setCustomId(MODAL_AUTOMOD_CUSTOM_A_ID)
                    .setLabel('Wildcard Words (comma separated)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue((custom.bannedWordsWildcard || []).join(', ').slice(0, 4000));
                const exactInput = new TextInputBuilder()
                    .setCustomId(MODAL_AUTOMOD_CUSTOM_B_ID)
                    .setLabel('Exact Words (comma separated)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue((custom.bannedWordsExact || []).join(', ').slice(0, 4000));
                modal.addComponents(
                    new ActionRowBuilder().addComponents(wildcardInput),
                    new ActionRowBuilder().addComponents(exactInput)
                );
            } else if (draft.type === 'anti_links') {
                const modeInput = new TextInputBuilder()
                    .setCustomId(MODAL_AUTOMOD_CUSTOM_A_ID)
                    .setLabel('Delete All Links? (true/false)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(custom.deleteAllLinks !== false));
                const allowInput = new TextInputBuilder()
                    .setCustomId(MODAL_AUTOMOD_CUSTOM_B_ID)
                    .setLabel('Allowed Links (comma separated)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue((custom.allowedLinks || []).join(', ').slice(0, 4000));
                modal.addComponents(
                    new ActionRowBuilder().addComponents(modeInput),
                    new ActionRowBuilder().addComponents(allowInput)
                );
            } else if (draft.type === 'invite_links') {
                const inviteInput = new TextInputBuilder()
                    .setCustomId(MODAL_AUTOMOD_CUSTOM_A_ID)
                    .setLabel('Allowed Invites (comma separated)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue((custom.allowedInvites || []).join(', ').slice(0, 4000));
                modal.addComponents(new ActionRowBuilder().addComponents(inviteInput));
            } else {
                await interaction.reply({ content: 'This rule type has no custom settings.', ephemeral: true });
                return true;
            }

            const customResponseInput = new TextInputBuilder()
                .setCustomId(MODAL_AUTOMOD_CUSTOM_RESPONSE_INPUT_ID)
                .setLabel('Custom Response (optional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(String(draft.customResponse || '').slice(0, 4000));

            modal.addComponents(
                new ActionRowBuilder().addComponents(customResponseInput)
            );

            await interaction.showModal(modal);
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_FIELD_ID) {
            const draft = getDraft();
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            const modal = new ModalBuilder()
                .setCustomId(`${MANAGE_AUTOMOD_MODAL_PREFIX}${draft.id}`)
                .setTitle(`Automod Field: ${draft.name.slice(0, 30)}`);

            const nameInput = new TextInputBuilder()
                .setCustomId(MODAL_AUTOMOD_NAME_INPUT_ID)
                .setLabel('Rule Name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(draft.name || '').slice(0, 4000));

            const triggerInput = new TextInputBuilder()
                .setCustomId(MODAL_AUTOMOD_TRIGGER_INPUT_ID)
                .setLabel('Trigger / Pattern (leave blank if not needed)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(String(draft.trigger || '').slice(0, 4000));

            const actionInput = new TextInputBuilder()
                .setCustomId(MODAL_AUTOMOD_ACTION_INPUT_ID)
                .setLabel('Actions (comma: delete,timeout,ban)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(normalizeAutomodActions(draft.actions).join(', ').slice(0, 4000));

            const timeoutInput = new TextInputBuilder()
                .setCustomId(MODAL_AUTOMOD_TIMEOUT_INPUT_ID)
                .setLabel('Timeout duration (used for timeout action)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(String(draft.timeoutDuration || '10m').slice(0, 4000));

            modal.addComponents(
                new ActionRowBuilder().addComponents(nameInput),
                new ActionRowBuilder().addComponents(triggerInput),
                new ActionRowBuilder().addComponents(actionInput),
                new ActionRowBuilder().addComponents(timeoutInput)
            );

            await interaction.showModal(modal);
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_TYPE_ID
            || interaction.customId === MANAGE_AUTOMOD_DRAFT_ACTION_ID
            || interaction.customId === MANAGE_AUTOMOD_DRAFT_MATCH_ID
            || interaction.customId === MANAGE_AUTOMOD_DRAFT_IGNORE_ADMINS_ID
            || interaction.customId === MANAGE_AUTOMOD_DRAFT_ENABLED_ID) {
            const draft = getDraft();
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            if (interaction.customId === MANAGE_AUTOMOD_DRAFT_TYPE_ID) {
                const idx = AUTOMOD_TYPE_ORDER.indexOf(draft.type);
                const nextType = AUTOMOD_TYPE_ORDER[(idx + 1) % AUTOMOD_TYPE_ORDER.length];
                draft.type = nextType;
                if (!draft.name || AUTOMOD_TYPE_LABELS[draft.name] === draft.name) {
                    draft.name = AUTOMOD_TYPE_LABELS[nextType] || nextType;
                }
                draft.custom = sanitizeCustomByType(nextType, draft.custom);
            } else if (interaction.customId === MANAGE_AUTOMOD_DRAFT_ACTION_ID) {
                const current = normalizeAutomodActions(draft.actions);
                const currentKey = current.join('|');
                const presetIndex = AUTOMOD_ACTION_PRESETS.findIndex(preset => preset.join('|') === currentKey);
                const nextPreset = AUTOMOD_ACTION_PRESETS[(presetIndex + 1) % AUTOMOD_ACTION_PRESETS.length] || ['delete'];
                draft.actions = [...nextPreset];
                draft.action = draft.actions[0];
            } else if (interaction.customId === MANAGE_AUTOMOD_DRAFT_MATCH_ID) {
                draft.matchType = draft.matchType === 'exact' ? 'contains' : 'exact';
            } else if (interaction.customId === MANAGE_AUTOMOD_DRAFT_IGNORE_ADMINS_ID) {
                draft.ignoreAdmins = !draft.ignoreAdmins;
            } else if (interaction.customId === MANAGE_AUTOMOD_DRAFT_ENABLED_ID) {
                draft.enabled = !draft.enabled;
            }

            saveDraft(draft);
            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_AUTOMOD,
                automodDraft: draft,
                notice: 'Updated draft settings.'
            }));
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_SAVE_ID) {
            const draft = getDraft();
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            if (draft.type === 'keyword' && !String(draft.trigger || '').trim()) {
                await interaction.reply({ content: 'Keyword rules require a trigger phrase.', ephemeral: true });
                return true;
            }

            const normalizedActions = normalizeAutomodActions(draft.actions, draft.action);
            if (normalizedActions.includes('timeout') && !parseDurationMs(String(draft.timeoutDuration || '').trim())) {
                await interaction.reply({ content: 'Timeout action requires a valid duration like 5m, 1h, 2d.', ephemeral: true });
                return true;
            }

            const payload = buildAutomodRulePayloadFromDraft(draft, interaction.user.id);

            if (typeof client.upsertAutomodRule !== 'function') {
                await interaction.reply({ content: 'Automod storage is not available in this build.', ephemeral: true });
                return true;
            }

            client.upsertAutomodRule(interaction.guild.id, payload);
            if (client.automodDrafts) client.automodDrafts.delete(automodDraftKey);

            await interaction.update(buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_AUTOMOD,
                selectedAutomodRuleId: payload.id,
                notice: `Saved automod rule: ${payload.name}`
            }));
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
        if (interaction.customId !== MANAGE_USER_SELECT_ID
            && interaction.customId !== MANAGE_MODSTATS_USER_SELECT_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_ALLOWED_USERS_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_IGNORED_USERS_ID) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_ALLOWED_USERS_ID || interaction.customId === MANAGE_AUTOMOD_DRAFT_IGNORED_USERS_ID) {
            const draftKey = getAutomodDraftKey(interaction.guild.id, interaction.user.id);
            const draft = client.automodDrafts?.get(draftKey);
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            if (interaction.customId === MANAGE_AUTOMOD_DRAFT_ALLOWED_USERS_ID) {
                draft.allowedUserIds = [...new Set(interaction.values.map(String))];
                draft.ignoredUserIds = draft.ignoredUserIds.filter(id => !draft.allowedUserIds.includes(id));
            } else {
                draft.ignoredUserIds = [...new Set(interaction.values.map(String))];
                draft.allowedUserIds = draft.allowedUserIds.filter(id => !draft.ignoredUserIds.includes(id));
            }

            client.automodDrafts.set(draftKey, draft);
            await interaction.update({
                content: 'Updated user filters.',
                ...buildAutomodUserFiltersPayload(draft)
            });
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
    async handleChannelSelect({ client, interaction }) {
        if (interaction.customId !== MANAGE_AUTOMOD_DRAFT_ALLOWED_CHANNELS_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_IGNORED_CHANNELS_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_LOG_CHANNEL_ID) return false;

        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        const draftKey = getAutomodDraftKey(interaction.guild.id, interaction.user.id);
        const draft = client.automodDrafts?.get(draftKey);
        if (!draft) {
            await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_ALLOWED_CHANNELS_ID) {
            draft.allowedChannelIds = [...new Set(interaction.values.map(String))];
            draft.ignoredChannelIds = draft.ignoredChannelIds.filter(id => !draft.allowedChannelIds.includes(id));
        } else if (interaction.customId === MANAGE_AUTOMOD_DRAFT_IGNORED_CHANNELS_ID) {
            draft.ignoredChannelIds = [...new Set(interaction.values.map(String))];
            draft.allowedChannelIds = draft.allowedChannelIds.filter(id => !draft.ignoredChannelIds.includes(id));
        } else {
            draft.logChannelId = String(interaction.values?.[0] || '').trim();
        }

        client.automodDrafts.set(draftKey, draft);
        await interaction.update(buildManagePayload(client, interaction.guild.id, {
            panel: MANAGE_PANEL_AUTOMOD,
            automodDraft: draft,
            notice: 'Updated channel filters.'
        }));
        return true;
    },
    async handleRoleSelect({ client, interaction }) {
        if (interaction.customId !== MANAGE_AUTOMOD_DRAFT_ALLOWED_ROLES_ID
            && interaction.customId !== MANAGE_AUTOMOD_DRAFT_IGNORED_ROLES_ID) return false;

        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        const draftKey = getAutomodDraftKey(interaction.guild.id, interaction.user.id);
        const draft = client.automodDrafts?.get(draftKey);
        if (!draft) {
            await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
            return true;
        }

        if (interaction.customId === MANAGE_AUTOMOD_DRAFT_ALLOWED_ROLES_ID) {
            draft.allowedRoleIds = [...new Set(interaction.values.map(String))];
            draft.ignoredRoleIds = draft.ignoredRoleIds.filter(id => !draft.allowedRoleIds.includes(id));
        } else {
            draft.ignoredRoleIds = [...new Set(interaction.values.map(String))];
            draft.allowedRoleIds = draft.allowedRoleIds.filter(id => !draft.ignoredRoleIds.includes(id));
        }

        client.automodDrafts.set(draftKey, draft);

        const hasExistingRule = typeof client.getAutomodRules === 'function'
            ? client.getAutomodRules(interaction.guild.id).some(rule => rule.id === draft.id)
            : false;
        if (hasExistingRule && typeof client.upsertAutomodRule === 'function') {
            const payload = buildAutomodRulePayloadFromDraft(draft, interaction.user.id);
            client.upsertAutomodRule(interaction.guild.id, payload);
        }

        await interaction.update({
            content: hasExistingRule
                ? 'Updated role filters and saved them to this rule.'
                : 'Updated role filters.',
            ...buildAutomodRoleFiltersPayload(draft)
        });
        return true;
    },
    async handleModalSubmit({ client, interaction }) {
        if (!interaction.customId.startsWith(MANAGE_MODAL_PREFIX)
            && !interaction.customId.startsWith(MANAGE_MODSTATS_MODAL_PREFIX)
            && !interaction.customId.startsWith(MANAGE_AUTOMOD_MODAL_PREFIX)
            && !interaction.customId.startsWith(MANAGE_AUTOMOD_CUSTOM_MODAL_PREFIX)) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        if (interaction.customId.startsWith(MANAGE_AUTOMOD_CUSTOM_MODAL_PREFIX)) {
            const draftKey = getAutomodDraftKey(interaction.guild.id, interaction.user.id);
            const draft = client.automodDrafts?.get(draftKey);
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            const customA = interaction.fields.getTextInputValue(MODAL_AUTOMOD_CUSTOM_A_ID).trim();
            let customB = '';
            try {
                customB = interaction.fields.getTextInputValue(MODAL_AUTOMOD_CUSTOM_B_ID).trim();
            } catch (_) {
                customB = '';
            }
            let customResponse = '';
            try {
                customResponse = interaction.fields.getTextInputValue(MODAL_AUTOMOD_CUSTOM_RESPONSE_INPUT_ID).trim();
            } catch (_) {
                customResponse = '';
            }

            const nextCustom = { ...(draft.custom || {}) };
            const errors = [];

            if (draft.type === 'mentions_cooldown') {
                const maxMentions = parsePositiveIntInput(customA, 'Max Mentions', 1);
                const windowSeconds = parsePositiveIntInput(customB, 'Window Seconds', 1);
                if (maxMentions.error) errors.push(maxMentions.error);
                if (windowSeconds.error) errors.push(windowSeconds.error);
                if (!errors.length) {
                    nextCustom.maxMentions = maxMentions.value;
                    nextCustom.windowSeconds = windowSeconds.value;
                }
            } else if (draft.type === 'fast_message_spam') {
                const maxMessages = parsePositiveIntInput(customA, 'Max Messages', 2);
                const windowSeconds = parsePositiveIntInput(customB, 'Window Seconds', 1);
                if (maxMessages.error) errors.push(maxMessages.error);
                if (windowSeconds.error) errors.push(windowSeconds.error);
                if (!errors.length) {
                    nextCustom.maxMessages = maxMessages.value;
                    nextCustom.windowSeconds = windowSeconds.value;
                }
            } else if (draft.type === 'anti_newline') {
                const maxNewlines = parsePositiveIntInput(customA, 'Max Newlines', 1);
                if (maxNewlines.error) errors.push(maxNewlines.error);
                else nextCustom.maxNewlines = maxNewlines.value;
            } else if (draft.type === 'character_count') {
                const maxCharacters = parsePositiveIntInput(customA, 'Max Characters', 25);
                if (maxCharacters.error) errors.push(maxCharacters.error);
                else nextCustom.maxCharacters = maxCharacters.value;
            } else if (draft.type === 'emoji_spam') {
                const maxEmojis = parsePositiveIntInput(customA, 'Max Emojis', 1);
                if (maxEmojis.error) errors.push(maxEmojis.error);
                else nextCustom.maxEmojis = maxEmojis.value;
            } else if (draft.type === 'word_blacklist') {
                nextCustom.bannedWordsWildcard = customA
                    ? customA.split(',').map(v => v.trim()).filter(Boolean)
                    : [];
                nextCustom.bannedWordsExact = customB
                    ? customB.split(',').map(v => v.trim()).filter(Boolean)
                    : [];
            } else if (draft.type === 'anti_links') {
                const deleteAllLinks = ['true', '1', 'yes', 'on'].includes(customA.toLowerCase());
                nextCustom.deleteAllLinks = deleteAllLinks;
                nextCustom.allowedLinks = customB
                    ? customB.split(',').map(v => v.trim()).filter(Boolean)
                    : [];
            } else if (draft.type === 'invite_links') {
                nextCustom.allowedInvites = customA
                    ? customA.split(',').map(v => v.trim()).filter(Boolean)
                    : [];
            }

            if (errors.length) {
                await interaction.reply({ content: `Could not save custom settings:\n${errors.map(error => `- ${error}`).join('\n')}`, ephemeral: true });
                return true;
            }

            draft.custom = sanitizeCustomByType(draft.type, nextCustom);
            draft.customResponse = customResponse.slice(0, 200);
            client.automodDrafts.set(draftKey, draft);

            await interaction.reply({
                ...buildManagePayload(client, interaction.guild.id, {
                    panel: MANAGE_PANEL_AUTOMOD,
                    automodDraft: draft,
                    notice: 'Updated custom settings.'
                }),
                ephemeral: true
            });
            return true;
        }

        if (interaction.customId.startsWith(MANAGE_AUTOMOD_MODAL_PREFIX)) {
            const draftKey = getAutomodDraftKey(interaction.guild.id, interaction.user.id);
            const draft = client.automodDrafts?.get(draftKey);
            if (!draft) {
                await interaction.reply({ content: 'No active automod draft found. Open Automod panel and create/edit a rule first.', ephemeral: true });
                return true;
            }

            const nameField = interaction.fields.getTextInputValue(MODAL_AUTOMOD_NAME_INPUT_ID).trim();
            const triggerField = interaction.fields.getTextInputValue(MODAL_AUTOMOD_TRIGGER_INPUT_ID).trim();
            const actionField = interaction.fields.getTextInputValue(MODAL_AUTOMOD_ACTION_INPUT_ID).trim().toLowerCase();
            const timeoutField = (interaction.fields.getTextInputValue(MODAL_AUTOMOD_TIMEOUT_INPUT_ID) || '').trim();

            const name = nameField || draft.name;
            const type = draft.type;
            const trigger = triggerField;

            const parsed = parseAutomodActionsInput(actionField);
            if (parsed.invalid.length) {
                await interaction.reply({
                    content: `Unknown actions: ${parsed.invalid.join(', ')}. Valid actions: ${AUTOMOD_ACTION_ORDER.join(', ')}`,
                    ephemeral: true
                });
                return true;
            }
            const parsedActions = parsed.actions;

            if (type === 'keyword' && !trigger) {
                await interaction.reply({ content: 'Keyword rules require a trigger phrase.', ephemeral: true });
                return true;
            }

            const timeoutDuration = timeoutField || draft.timeoutDuration || '10m';
            if (parsedActions.includes('timeout') && !parseDurationMs(timeoutDuration)) {
                await interaction.reply({ content: 'Timeout action requires a valid duration like 5m, 1h, 2d.', ephemeral: true });
                return true;
            }

            draft.name = name;
            draft.type = type;
            draft.trigger = trigger;
            draft.actions = parsedActions;
            draft.action = parsedActions[0];
            draft.timeoutDuration = timeoutDuration;
            draft.custom = sanitizeCustomByType(draft.type, draft.custom);
            client.automodDrafts.set(draftKey, draft);

            await interaction.reply({
                ...buildManagePayload(client, interaction.guild.id, {
                    panel: MANAGE_PANEL_AUTOMOD,
                    automodDraft: draft,
                    notice: 'Updated automod draft fields.'
                }),
                ephemeral: true
            });
            return true;
        }

        // Modstats: Save edited stats
        if (interaction.customId.startsWith(MANAGE_MODSTATS_MODAL_PREFIX)) {
            const modalPayload = interaction.customId.slice(MANAGE_MODSTATS_MODAL_PREFIX.length);
            const parts = modalPayload.split(':');
            const userId = parts[0];
            const timePeriod = parts[1] || 'all';
            // parts[2] is the random number suffix, ignore it

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
            const payload = buildManagePayload(client, interaction.guild.id, {
                panel: MANAGE_PANEL_MODSTATS,
                selectedModstatsUserId: userId
            });
            await interaction.reply({
                ...payload,
                content: `Updated ${periodLabel} modstats for <@${userId}>: Mutes: ${mutes}, Bans: ${bans}, Kicks: ${kicks}, Warns: ${warns}`,
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
