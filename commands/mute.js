const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const INFRACTION_RULES = {
    spam: {
        label: 'Spam',
        steps: [
            { type: 'timeout', duration: '4h' },
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'timeout', duration: '1d' },
            { type: 'kick' }
        ]
    },
    off_topic: {
        label: 'Off Topic',
        steps: [
            { type: 'timeout', duration: '1h' },
            { type: 'timeout', duration: '3h' },
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'kick' }
        ]
    },
    spam_pinging_owners: {
        label: 'Spam Pinging Owners',
        steps: [
            { type: 'timeout', duration: '1h' },
            { type: 'timeout', duration: '3h' },
            { type: 'timeout', duration: '6h' },
            { type: 'moderator_decision' }
        ]
    },
    blacklisted_words_bypass: {
        label: 'Bypassing Blacklisted Words',
        steps: [
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '9h' },
            { type: 'timeout', duration: '12h' },
            { type: 'timeout', duration: '1d' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'moderator_decision' }
        ]
    },
    nsfw_explicit_messages: {
        label: 'NSFW or Explicit Messages',
        steps: [
            { type: 'timeout', duration: '1d' },
            { type: 'timeout', duration: '3d' },
            { type: 'timeout', duration: '7d' },
            { type: 'ban' }
        ]
    },
    direct_slurs: {
        label: 'Direct Slurs',
        steps: [
            { type: 'timeout', duration: '1d' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'ban' }
        ]
    },
    harassment_disrespect: {
        label: 'Harassment/Disrespect',
        steps: [
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'timeout', duration: '1d' },
            { type: 'timeout', duration: '3d' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'ban' }
        ]
    },
    instigation: {
        label: 'Instigation',
        steps: [
            { type: 'timeout', duration: '3h' },
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'timeout', duration: '2d' },
            { type: 'timeout', duration: '4d' },
            { type: 'temp_ban' },
            { type: 'moderator_decision' }
        ]
    },
    promotion: {
        label: 'Promotion',
        steps: [
            { type: 'timeout', duration: '12h' },
            { type: 'ban' }
        ]
    },
    controversial_topics: {
        label: 'Controversial Topics',
        steps: [
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'ban' }
        ]
    },
    roblox_tos_violation: {
        label: 'Roblox TOS Violation',
        steps: [
            { type: 'timeout', duration: '1h' },
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '1d' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'moderator_decision' }
        ]
    },
    troll_tickets: {
        label: 'Troll Tickets',
        steps: [
            { type: 'ticket_blacklist' },
            { type: 'ban' }
        ]
    }
};

const RULE_CHOICES = [
    { name: 'Spam', value: 'spam' },
    { name: 'Off Topic', value: 'off_topic' },
    { name: 'Spam Pinging Owners', value: 'spam_pinging_owners' },
    { name: 'Bypassing Blacklisted Words', value: 'blacklisted_words_bypass' },
    { name: 'NSFW or Explicit Messages', value: 'nsfw_explicit_messages' },
    { name: 'Direct Slurs', value: 'direct_slurs' },
    { name: 'Harassment/Disrespect', value: 'harassment_disrespect' },
    { name: 'Instigation', value: 'instigation' },
    { name: 'Promotion', value: 'promotion' },
    { name: 'Controversial Topics', value: 'controversial_topics' },
    { name: 'Roblox TOS Violation', value: 'roblox_tos_violation' },
    { name: 'Troll Tickets', value: 'troll_tickets' }
];

function formatEscalationAction(step) {
    if (!step) return 'moderator decision';
    if (step.type === 'timeout' && step.duration) return `timeout (${step.duration})`;
    if (step.type === 'temp_ban' && step.duration) return `temp ban (${step.duration})`;
    return step.type.replace(/_/g, ' ');
}

function getRuleMuteCount(client, guildId, userId, ruleKey) {
    if (!client.getModLogs) return 0;
    const logs = client.getModLogs(guildId, userId) || [];
    return logs.filter(entry => {
        const action = (entry.action || '').toString().toLowerCase();
        return action === 'mute' && entry.infractionRule === ruleKey;
    }).length;
}

function getEscalationStep(ruleKey, previousCount) {
    const rule = INFRACTION_RULES[ruleKey];
    if (!rule || !rule.steps?.length) return null;
    const index = Math.min(previousCount, rule.steps.length - 1);
    return rule.steps[index];
}

function parseDuration(duration) {
    const match = duration.match(/^(\d+)([smhd])$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
        case 's': return amount * 1000;
        case 'm': return amount * 60 * 1000;
        case 'h': return amount * 60 * 60 * 1000;
        case 'd': return amount * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

module.exports = {
    name: 'mute',
    description: 'Timeout one or more users for a duration like 1m, 1h, or 1d.',
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout one or more users for a duration')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The first user to timeout')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration like 1m, 1h, or 1d')
                .setRequired(false))
        .addStringOption(option => {
            option
                .setName('rule')
                .setDescription('Infraction rule category for auto-escalation')
                .setRequired(false);
            for (const choice of RULE_CHOICES) {
                option.addChoices(choice);
            }
            return option;
        })
        .addUserOption(option =>
            option.setName('user2')
                .setDescription('Another user to timeout')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user3')
                .setDescription('Another user to timeout')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user4')
                .setDescription('Another user to timeout')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false)),
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');
        if (!args[0] || !args[1]) return message.reply('Usage: ?mute @user [@user2 ...] 1h [reason]');

        const durationIndex = args.findIndex(arg => parseDuration(arg) !== null);
        if (durationIndex <= 0) {
            return message.reply('Please provide one or more users first, then a valid duration like 1m, 1h, or 1d.');
        }

        const rawTargets = args.slice(0, durationIndex);
        const uniqueTargetIds = [...new Set(rawTargets.map(target => target.replace(/[<@!>]/g, '')))].filter(Boolean);
        const invalidTarget = uniqueTargetIds.find(id => !/^[0-9]{17,19}$/.test(id));
        if (invalidTarget) {
            return message.reply(`Invalid user ID or mention: ${invalidTarget}`);
        }

        const duration = args[durationIndex];
        const durationMs = parseDuration(duration);
        if (durationMs === null) {
            return message.reply('Please provide a valid duration, e.g. 1m, 1h, or 1d.');
        }

        const reason = args.slice(durationIndex + 1).join(' ') || 'No reason provided';

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return message.reply('I do not have permission to timeout members.');
            }

            const results = await Promise.all(uniqueTargetIds.map(async (targetId) => {
                try {
                    const member = await message.guild.members.fetch(targetId);
                    if (!member) {
                        return { targetId, success: false, reason: 'Member not found' };
                    }
                    await client.sendModerationDm({
                        user: member.user,
                        guildName: message.guild.name,
                        action: 'mute',
                        duration,
                        reason
                    });
                    await member.timeout(durationMs, reason);
                    if (client.addModLog) {
                        let robloxId = null;
                        try {
                            if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(message.guild.id, targetId);
                        } catch (err) {
                            console.error('Failed to lookup robloxId for mute modlog:', err);
                        }
                        await client.addModLog(message.guild.id, {
                            action: 'Mute',
                            userId: targetId,
                            userTag: member.user.tag,
                            robloxId,
                            moderatorId: message.author.id,
                            moderatorTag: message.author.tag,
                            reason,
                            duration,
                            timestamp: new Date().toISOString()
                        });
                    }
                    return { targetId, success: true };
                } catch (error) {
                    console.error(error);
                    return { targetId, success: false, reason: error.message };
                }
            }));

            const success = results.filter(result => result.success).map(result => `<@${result.targetId}>`);
            const failures = results.filter(result => !result.success);

            const replyParts = [];
            if (success.length) {
                replyParts.push(`Timed out ${success.length} user(s): ${success.join(', ')} for ${duration}. Reason: ${reason}`);
            }
            if (failures.length) {
                replyParts.push(`${failures.length} user(s) could not be timed out.`);
            }

            return client.sendPrefixCommandResponse(message.channel, replyParts.join(' '));
        } catch (error) {
            console.error(error);
            return message.reply('Unable to timeout the provided users. Check IDs and permissions.');
        }
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const users = [
            interaction.options.getUser('user'),
            interaction.options.getUser('user2'),
            interaction.options.getUser('user3'),
            interaction.options.getUser('user4')
        ].filter(Boolean);
        const manualDuration = interaction.options.getString('duration');
        const ruleKey = interaction.options.getString('rule');
        const ruleConfig = ruleKey ? INFRACTION_RULES[ruleKey] : null;
        const baseReason = interaction.options.getString('reason') || 'No reason provided';

        if (!ruleKey && !manualDuration) {
            return interaction.reply({ content: 'Please provide either a duration or an infraction rule.', ephemeral: true });
        }

        if (ruleKey && !ruleConfig) {
            return interaction.reply({ content: 'That rule is not configured yet. Please contact an administrator.', ephemeral: true });
        }

        const manualDurationMs = manualDuration ? parseDuration(manualDuration) : null;
        if (manualDuration && !manualDurationMs) {
            return interaction.reply({ content: 'Please provide a valid duration like 1m, 1h, or 1d.', ephemeral: true });
        }

        if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({ content: 'I do not have permission to timeout members.', ephemeral: true });
        }

        const results = await Promise.all(users.map(async (user) => {
            try {
                const member = await interaction.guild.members.fetch(user.id);
                if (!member) {
                    return { user, success: false, reason: 'Member not found' };
                }

                let duration = manualDuration;
                let durationMs = manualDurationMs;
                let infractionCount = null;
                let escalationStep = null;

                if (ruleKey && ruleConfig) {
                    const priorRuleMutes = getRuleMuteCount(client, interaction.guild.id, user.id, ruleKey);
                    infractionCount = priorRuleMutes + 1;
                    escalationStep = getEscalationStep(ruleKey, priorRuleMutes);
                    if (!escalationStep || escalationStep.type !== 'timeout' || !escalationStep.duration) {
                        return {
                            user,
                            success: false,
                            reason: `Escalation requires ${formatEscalationAction(escalationStep)} instead of timeout.`
                        };
                    }

                    duration = escalationStep.duration;
                    durationMs = parseDuration(duration);
                    if (!durationMs) {
                        return { user, success: false, reason: `Invalid configured duration for ${ruleConfig.label}.` };
                    }
                }

                const effectiveReason = ruleConfig
                    ? `[Rule: ${ruleConfig.label}] [Infraction ${infractionCount}] ${baseReason}`
                    : baseReason;

                await client.sendModerationDm({
                    user,
                    guildName: interaction.guild.name,
                    action: 'mute',
                    duration,
                    reason: effectiveReason
                });
                await member.timeout(durationMs, effectiveReason);
                let robloxId = null;
                try {
                    if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(interaction.guild.id, user.id);
                } catch (err) {
                    console.error('Failed to lookup robloxId for mute modlog:', err);
                }
                await client.addModLog(interaction.guild.id, {
                    action: 'Mute',
                    userId: user.id,
                    userTag: `${user.tag}`,
                    robloxId,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    reason: effectiveReason,
                    duration,
                    infractionRule: ruleKey || null,
                    infractionRuleLabel: ruleConfig?.label || null,
                    infractionCount,
                    timestamp: new Date().toISOString()
                });
                return {
                    user,
                    success: true,
                    duration,
                    infractionCount,
                    ruleLabel: ruleConfig?.label || null
                };
            } catch (error) {
                console.error(error);
                return { user, success: false, reason: error.message };
            }
        }));

        const successResults = results.filter(r => r.success);
        const successCount = successResults.length;
        const failCount = results.length - successCount;
        const mentions = results.map(r => `<@${r.user.id}>`).join(', ');
        const reply = [];

        if (successCount) {
            if (ruleConfig) {
                const outcome = successResults
                    .map(result => `<@${result.user.id}> -> ${result.duration} (Infraction ${result.infractionCount})`)
                    .join('\n');
                reply.push(`Timed out ${successCount} user(s) using ${ruleConfig.label} escalation:\n${outcome}`);
            } else {
                reply.push(`Timed out ${successCount} user(s): ${mentions} for ${manualDuration}.`);
            }
        }
        if (failCount) {
            reply.push(`${failCount} user(s) could not be timed out.`);
        }

        const response = reply.join(' ');
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle(`Mute Action`)
            .setDescription(`Case by ${interaction.user.tag}`)
            .addFields(
                { name: 'User(s)', value: mentions || 'None', inline: true },
                { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Duration', value: ruleConfig ? 'Auto (by infraction rule)' : (manualDuration || 'N/A'), inline: true },
                { name: 'Rule', value: ruleConfig ? ruleConfig.label : 'None', inline: true },
                { name: 'Reason', value: baseReason || 'No reason provided', inline: false },
                { name: 'Target IDs', value: users.map(u => u.id).join(', ') || 'None', inline: false }
            )
            .setTimestamp();

        const actionKey = `mute_action_${interaction.id}`;
        client.addPendingModerationAction(actionKey, {
            type: 'mute',
            moderatorId: interaction.user.id,
            users: users.map(user => ({ id: user.id, tag: user.tag }))
        });

        const buildUnmuteRow = () => new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mute_unmute_specific:${actionKey}`)
                .setLabel('Unmute Specific')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`mute_unmute_all:${actionKey}`)
                .setLabel('Unmute All')
                .setStyle(ButtonStyle.Success)
        );

        await client.logToChannel(interaction.guild, { embeds: [embed], components: [buildUnmuteRow()] });
        return interaction.reply({ content: response, embeds: [embed], components: [buildUnmuteRow()], ephemeral: true });
    }
};
