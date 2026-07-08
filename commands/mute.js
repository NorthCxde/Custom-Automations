const {
    SlashCommandBuilder,
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const MOD_DECISION_PREFIX = 'moddec_';
const MOD_DECISION_MODAL_PREFIX = 'moddec_modal:';
const MOD_DECISION_DURATION_INPUT_ID = 'duration';
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2147483647;
const tempBanTimers = new Map();

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

async function sendMuteStatusCard(client, channel, text, isSuccess = true) {
    if (!channel || !text) return;

    const safeText = String(text).trim();
    if (!safeText) return;
    const emoji = isSuccess ? '✅' : '❌';

    const embed = new EmbedBuilder()
        .setColor(isSuccess ? 0x57F287 : 0xED4245)
        .setDescription(`${emoji} ${safeText}`);

    try {
        const msg = await channel.send({ embeds: [embed] });
        if (isSuccess && client.prefixCommandReactionEmojiId && msg) {
            await msg.react(client.prefixCommandReactionEmojiId).catch(() => null);
        }
    } catch (err) {
        console.error('Failed to send mute status card:', err);
    }
}

async function sendMuteUsageCard(channel) {
    if (!channel || typeof channel.send !== 'function') return;

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setDescription([
            '**Command:** ?mute',
            '',
            '**Description:** Timeout one or more users for a duration',
            '**Cooldown:** 3 seconds',
            '**Usage:**',
            '?mute [user] [duration] [reason]',
            '?mute [user1] [user2] [duration] [reason]',
            '',
            '**Example:**',
            '?mute @albeanie 1d nsfw messages',
            '?mute @albeanie @albeanie 2h spam'
        ].join('\n'));

    await channel.send({
        embeds: [embed],
        allowedMentions: {
            parse: [],
            users: [],
            roles: [],
            repliedUser: false
        }
    });
}

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

function getEscalationStep(rules, ruleKey, previousCount) {
    const rule = rules?.[ruleKey];
    if (!rule || !rule.steps?.length) return null;
    const index = Math.min(previousCount, rule.steps.length - 1);
    return rule.steps[index];
}

function parseDuration(duration) {
    const match = duration.match(/^(\d+)([smhdy])$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
        case 's': return amount * 1000;
        case 'm': return amount * 60 * 1000;
        case 'h': return amount * 60 * 60 * 1000;
        case 'd': return amount * 24 * 60 * 60 * 1000;
        case 'y': return amount * 365 * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

function buildModeratorDecisionRow(actionKey) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${MOD_DECISION_PREFIX}mute:${actionKey}`)
            .setLabel('Mute')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`${MOD_DECISION_PREFIX}kick:${actionKey}`)
            .setLabel('Kick')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${MOD_DECISION_PREFIX}ban:${actionKey}`)
            .setLabel('Ban')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${MOD_DECISION_PREFIX}temp_ban:${actionKey}`)
            .setLabel('Temp Ban')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`${MOD_DECISION_PREFIX}close:${actionKey}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Secondary)
    );
}

function scheduleTempUnban(client, guildId, userId, userTag, unbanAt) {
    const timerKey = `${guildId}:${userId}`;
    const existing = tempBanTimers.get(timerKey);
    if (existing) {
        clearTimeout(existing);
        tempBanTimers.delete(timerKey);
    }

    const run = () => {
        const remaining = Number(unbanAt) - Date.now();
        if (remaining <= 0) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                tempBanTimers.delete(timerKey);
                return;
            }

            guild.members.unban(userId, 'Temporary ban expired')
                .then(async () => {
                    if (client.addModLog) {
                        let robloxId = null;
                        try {
                            if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(guildId, userId);
                        } catch (err) {
                            console.error('Failed to lookup robloxId for temp unban modlog:', err);
                        }
                        client.addModLog(guildId, {
                            action: 'Unban',
                            userId,
                            userTag: userTag || `<@${userId}>`,
                            robloxId,
                            moderatorId: client.user?.id || 'system',
                            moderatorTag: client.user?.tag || 'TempBanScheduler',
                            reason: 'Temporary ban expired',
                            timestamp: new Date().toISOString()
                        });
                    }
                })
                .catch(err => console.error('Failed to auto-unban temp banned user:', err))
                .finally(() => {
                    tempBanTimers.delete(timerKey);
                });
            return;
        }

        const nextDelay = Math.min(remaining, MAX_TIMER_DELAY_MS);
        const timer = setTimeout(run, nextDelay);
        if (typeof timer.unref === 'function') timer.unref();
        tempBanTimers.set(timerKey, timer);
    };

    run();
}

function canUseDecisionPanel(client, interaction, decision) {
    if (!decision) return false;
    if (interaction.user.id === decision.moderatorId) return true;
    return Boolean(client.hardcodedAdmins && client.hardcodedAdmins.has(interaction.user.id));
}

function getRequiredPermission(action) {
    if (action === 'mute') return PermissionsBitField.Flags.ModerateMembers;
    if (action === 'kick') return PermissionsBitField.Flags.KickMembers;
    return PermissionsBitField.Flags.BanMembers;
}

async function applyDecisionAction({ client, guild, decision, action, durationRaw, moderator, sourceChannel = null }) {
    const results = [];
    let durationMs = null;
    let stickerSentForBatch = false;

    if (action === 'mute' || action === 'temp_ban') {
        durationMs = parseDuration(durationRaw || '');
        if (!durationMs) {
            return { error: 'Please provide a valid duration such as 1m, 1h, 1d, or 1y.' };
        }
        if (action === 'mute' && durationMs > MAX_TIMEOUT_MS) {
            return { error: 'Discord timeouts can only be up to 28 days.' };
        }
    }

    for (const target of decision.users || []) {
        const userId = target.id;
        const userTag = target.tag || `<@${userId}>`;
        const reasonPrefix = `[Rule: ${decision.ruleLabel || 'Unknown'}] [Infraction ${target.infractionCount || '?'}]`;
        const reason = `${reasonPrefix} ${decision.baseReason || 'No reason provided'} | Moderator decision: ${action}${durationRaw ? ` ${durationRaw}` : ''}`;

        try {
            if (action === 'mute') {
                const member = await guild.members.fetch(userId);
                await client.sendModerationDm({
                    user: member.user,
                    guildName: guild.name,
                    action: 'mute',
                    duration: durationRaw,
                    reason
                });
                await member.timeout(durationMs, reason);
                if (client.addModLog) {
                    let robloxId = null;
                    try {
                        if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(guild.id, userId);
                    } catch (err) {
                        console.error('Failed to lookup robloxId for moderator decision mute modlog:', err);
                    }
                    await client.addModLog(guild.id, {
                        action: 'Mute',
                        userId,
                        userTag,
                        robloxId,
                        moderatorId: moderator.id,
                        moderatorTag: moderator.tag,
                        reason,
                        duration: durationRaw,
                        infractionRule: decision.ruleKey || null,
                        infractionRuleLabel: decision.ruleLabel || null,
                        infractionCount: target.infractionCount || null,
                        timestamp: new Date().toISOString()
                    });
                }
            } else if (action === 'kick') {
                const member = await guild.members.fetch(userId);
                await member.kick(reason);
                if (client.addModLog) {
                    let robloxId = null;
                    try {
                        if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(guild.id, userId);
                    } catch (err) {
                        console.error('Failed to lookup robloxId for moderator decision kick modlog:', err);
                    }
                    await client.addModLog(guild.id, {
                        action: 'Kick',
                        userId,
                        userTag,
                        robloxId,
                        moderatorId: moderator.id,
                        moderatorTag: moderator.tag,
                        reason,
                        infractionRule: decision.ruleKey || null,
                        infractionRuleLabel: decision.ruleLabel || null,
                        infractionCount: target.infractionCount || null,
                        timestamp: new Date().toISOString()
                    });
                }
            } else if (action === 'ban' || action === 'temp_ban') {
                await client.sendModerationDm({
                    userId,
                    guildName: guild.name,
                    action: 'ban',
                    reason: action === 'temp_ban' ? `${reason} (Duration: ${durationRaw})` : reason
                });
                await guild.members.ban(userId, { reason });

                if (!stickerSentForBatch && client.sendBanSticker) {
                    await client.sendBanSticker(sourceChannel);
                    stickerSentForBatch = true;
                }

                if (action === 'temp_ban') {
                    scheduleTempUnban(client, guild.id, userId, userTag, Date.now() + durationMs);
                }

                if (client.addModLog) {
                    let robloxId = null;
                    try {
                        if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(guild.id, userId);
                    } catch (err) {
                        console.error('Failed to lookup robloxId for moderator decision ban modlog:', err);
                    }
                    await client.addModLog(guild.id, {
                        action: action === 'temp_ban' ? 'Temp Ban' : 'Ban',
                        userId,
                        userTag,
                        robloxId,
                        moderatorId: moderator.id,
                        moderatorTag: moderator.tag,
                        reason,
                        duration: action === 'temp_ban' ? durationRaw : null,
                        infractionRule: decision.ruleKey || null,
                        infractionRuleLabel: decision.ruleLabel || null,
                        infractionCount: target.infractionCount || null,
                        timestamp: new Date().toISOString()
                    });
                }
            }

            results.push({ userId, success: true });
        } catch (error) {
            console.error('Failed moderator decision action:', error);
            results.push({ userId, success: false, reason: error.message || 'Unknown error' });
        }
    }

    return {
        error: null,
        results,
        durationRaw
    };
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
        .addAttachmentOption(option =>
            option.setName('evidence1')
                .setDescription('Screenshot evidence 1')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('evidence2')
                .setDescription('Screenshot evidence 2')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('evidence3')
                .setDescription('Screenshot evidence 3')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('evidence4')
                .setDescription('Screenshot evidence 4')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false)),
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');
        if (!args[0] || !args[1]) {
            await sendMuteUsageCard(message.channel);
            return null;
        }

        const durationIndex = args.findIndex(arg => parseDuration(arg) !== null);
        if (durationIndex <= 0) {
            await sendMuteUsageCard(message.channel);
            return null;
        }

        const rawTargets = args.slice(0, durationIndex);
        const uniqueTargetIds = [...new Set(rawTargets.map(target => target.replace(/[<@!>]/g, '')))].filter(Boolean);
        const invalidTarget = uniqueTargetIds.find(id => !/^[0-9]{17,19}$/.test(id));
        if (invalidTarget) {
            await sendMuteUsageCard(message.channel);
            return null;
        }

        const duration = args[durationIndex];
        const durationMs = parseDuration(duration);
        if (durationMs === null) {
            await sendMuteUsageCard(message.channel);
            return null;
        }

        const reason = args.slice(durationIndex + 1).join(' ') || 'No reason provided';
        const evidenceFiles = (message.attachments
            ? Array.from(message.attachments.values())
            : [])
            .slice(0, 4);

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                await sendMuteStatusCard(client, message.channel, 'I do not have permission to timeout members.', false);
                return null;
            }

            const results = await Promise.all(uniqueTargetIds.map(async (targetId) => {
                try {
                    const member = await message.guild.members.fetch(targetId);
                    if (!member) {
                        return { targetId, success: false, reason: 'Member not found' };
                    }

                    if (!member.moderatable) {
                        return {
                            targetId,
                            success: false,
                            reason: `I cannot timeout ${member.user.username} due to role hierarchy or missing permissions.`
                        };
                    }

                    const isAlreadyMuted = Number(member.communicationDisabledUntilTimestamp || 0) > Date.now();
                    if (isAlreadyMuted) {
                        return { targetId, success: false, reason: `${member.user.username} is already muted.` };
                    }

                    await member.timeout(durationMs, reason);

                    if (client.sendModerationDm) {
                        try {
                            await client.sendModerationDm({
                                user: member.user,
                                guildName: message.guild.name,
                                action: 'mute',
                                duration,
                                reason
                            });
                        } catch (err) {
                            console.error('Failed to send mute DM:', err);
                        }
                    }

                    if (client.addModLog) {
                        let robloxId = null;
                        try {
                            if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(message.guild.id, targetId);
                        } catch (err) {
                            console.error('Failed to lookup robloxId for mute modlog:', err);
                        }
                        try {
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
                        } catch (err) {
                            console.error('Failed to write mute modlog:', err);
                        }
                    }
                    return { targetId, success: true, username: member.user.username };
                } catch (error) {
                    console.error(error);
                    let reason = error?.message || 'Unknown error';
                    if (error?.code === 50013) {
                        reason = 'Missing permissions to timeout that user.';
                    }
                    return { targetId, success: false, reason };
                }
            }));

            const success = results.filter(result => result.success).map(result => `<@${result.targetId}>`);
            const successIds = results.filter(result => result.success).map(result => result.targetId);
            const failures = results.filter(result => !result.success);

            if (success.length > 0) {
                const firstSuccess = results.find(result => result.success);
                const cardText = success.length === 1
                    ? `${firstSuccess?.username || 'User'} was muted.`
                    : `${success.length} users were muted.`;
                await sendMuteStatusCard(client, message.channel, cardText, true);

                if (client.logToChannel && successIds.length) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle('Mute Action')
                        .setDescription(`Case by ${message.author.tag}`)
                        .addFields(
                            { name: 'User(s)', value: successIds.map(id => `<@${id}>`).join(', '), inline: true },
                            { name: 'Moderator', value: `<@${message.author.id}>`, inline: true },
                            { name: 'Duration', value: duration, inline: true },
                            { name: 'Evidence', value: evidenceFiles.length ? `${evidenceFiles.length} attachment(s)` : 'None', inline: true },
                            { name: 'Reason', value: reason, inline: false },
                            { name: 'Target IDs', value: successIds.join(', '), inline: false }
                        )
                        .setTimestamp();

                    try {
                        await client.logToChannel(message.guild, {
                            embeds: [logEmbed],
                            files: evidenceFiles.map(file => ({
                                attachment: file.url,
                                name: file.name,
                                contentType: file.contentType || null
                            }))
                        });
                    } catch (err) {
                        console.error('Failed to send mute log channel embed:', err);
                    }
                }

                if (successIds.length) {
                    const manualEmbed = new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle('Manual Mute Log')
                        .addFields(
                            { name: 'User(s)', value: successIds.map(id => `<@${id}>`).join(', '), inline: true },
                            { name: 'Moderator', value: `<@${message.author.id}>`, inline: true },
                            { name: 'Duration', value: duration, inline: true },
                            { name: 'Evidence', value: evidenceFiles.length ? `${evidenceFiles.length} attachment(s)` : 'None', inline: true },
                            { name: 'Reason', value: reason, inline: false },
                            { name: 'Outcome', value: `${success.length} muted, ${failures.length} failed`, inline: false }
                        )
                        .setTimestamp();

                    if (client.logManualModerationAction && evidenceFiles.length > 0) {
                        try {
                            await client.logManualModerationAction(message.guild, {
                                category: 'mute',
                                embeds: [manualEmbed],
                                files: evidenceFiles.map(file => ({
                                    attachment: file.url,
                                    name: file.name,
                                    contentType: file.contentType || null
                                }))
                            });
                        } catch (err) {
                            console.error('Failed to send prefix manual mute log:', err);
                        }
                    }

                    // Direct send to configured manual mute channel to keep prefix flow deterministic.
                    if (client.getManualLogsChannels && evidenceFiles.length > 0) {
                        try {
                            const manualConfig = client.getManualLogsChannels(message.guild.id);
                            const manualMuteChannelId = manualConfig?.muteChannelId || null;
                            if (manualMuteChannelId) {
                                const manualChannel = message.guild.channels.cache.get(manualMuteChannelId)
                                    || await message.guild.channels.fetch(manualMuteChannelId).catch(() => null);
                                if (manualChannel && manualChannel.isTextBased()) {
                                    await manualChannel.send({
                                        embeds: [manualEmbed],
                                        files: evidenceFiles.map(file => ({ attachment: file.url, name: file.name })),
                                        allowedMentions: {
                                            parse: [],
                                            users: [],
                                            roles: [],
                                            repliedUser: false
                                        }
                                    });
                                }
                            }
                        } catch (err) {
                            console.error('Failed to send direct prefix manual mute log fallback:', err);
                        }
                    }
                }
            }

            if (success.length === 0 && failures.length > 0) {
                const firstReason = failures[0]?.reason || 'Could not timeout that user.';
                const cardText = failures.length === 1
                    ? firstReason
                    : `${failures.length} users could not be timed out.`;
                await sendMuteStatusCard(client, message.channel, cardText, false);
                return null;
            }

            if (success.length > 0 && failures.length > 0) {
                const firstReason = failures[0]?.reason || 'Some users could not be timed out.';
                await sendMuteStatusCard(client, message.channel, `${success.length} muted, ${failures.length} failed. ${firstReason}`, false);
            }
            return null;
        } catch (error) {
            console.error(error);
            await sendMuteStatusCard(client, message.channel, 'Unable to timeout the provided users. Check IDs and permissions.', false);
            return null;
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
        const evidenceFiles = [
            interaction.options.getAttachment('evidence1'),
            interaction.options.getAttachment('evidence2'),
            interaction.options.getAttachment('evidence3'),
            interaction.options.getAttachment('evidence4')
        ].filter(Boolean);
        const manualDuration = interaction.options.getString('duration');
        const ruleKey = interaction.options.getString('rule');
        const guildRules = client.getInfractionRules ? client.getInfractionRules(interaction.guild.id) : INFRACTION_RULES;
        const ruleConfig = ruleKey ? guildRules?.[ruleKey] : null;
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

        const moderatorDecisionTargets = [];
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
                    escalationStep = getEscalationStep(guildRules, ruleKey, priorRuleMutes);

                    if (!escalationStep) {
                        return {
                            user,
                            success: false,
                            reason: 'Escalation step could not be determined.'
                        };
                    }

                    if (escalationStep.type === 'moderator_decision') {
                        moderatorDecisionTargets.push({
                            id: user.id,
                            tag: user.tag,
                            infractionCount
                        });
                        return {
                            user,
                            success: false,
                            needsModeratorDecision: true,
                            infractionCount
                        };
                    }

                    if (escalationStep.type !== 'timeout' || !escalationStep.duration) {
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
        const decisionCount = results.filter(r => r.needsModeratorDecision).length;
        const failCount = results.length - successCount - decisionCount;
        const mentions = results.map(r => `<@${r.user.id}>`).join(', ');
        const reply = [];

        if (successCount > 0) {
            const firstSuccess = successResults[0];
            const cardText = successCount === 1 && firstSuccess
                ? `${firstSuccess.user.username} was muted.`
                : `${successCount} users were muted.`;

            const statusChannel = interaction.channel || (interaction.channelId
                ? await client.channels.fetch(interaction.channelId).catch(() => null)
                : null);
            await sendMuteStatusCard(client, statusChannel, cardText, true);
        }

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

        let decisionRow = null;
        let decisionEmbed = null;
        let decisionReply = null;

        if (moderatorDecisionTargets.length) {
            const actionKey = `moddec_${interaction.id}`;
            client.addPendingModerationAction(actionKey, {
                type: 'moderator_decision',
                guildId: interaction.guild.id,
                moderatorId: interaction.user.id,
                moderatorTag: interaction.user.tag,
                ruleKey,
                ruleLabel: ruleConfig?.label || 'Unknown Rule',
                baseReason,
                evidenceFiles: evidenceFiles.map(file => ({ url: file.url, name: file.name })),
                users: moderatorDecisionTargets
            });

            decisionRow = buildModeratorDecisionRow(actionKey);
            decisionEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle('Moderator Decision Required')
                .setDescription(`Use the buttons below to decide action for ${moderatorDecisionTargets.length} user(s).`)
                .addFields(
                    { name: 'Rule', value: ruleConfig?.label || 'Unknown Rule', inline: true },
                    { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'User(s)', value: moderatorDecisionTargets.map(target => `<@${target.id}> (Infraction ${target.infractionCount})`).join('\n').slice(0, 1024), inline: false },
                    { name: 'Reason', value: baseReason || 'No reason provided', inline: false }
                )
                .setTimestamp();

            decisionReply = `Moderator decision required for ${moderatorDecisionTargets.length} user(s).`;
            reply.push(decisionReply);
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
                { name: 'Evidence', value: evidenceFiles.length ? `${evidenceFiles.length} attachment(s)` : 'None', inline: true },
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

        const logEmbeds = [embed];
        const logComponents = [buildUnmuteRow()];
        if (decisionEmbed && decisionRow) {
            logEmbeds.push(decisionEmbed);
            logComponents.push(decisionRow);
        }

        await client.logToChannel(interaction.guild, {
            embeds: logEmbeds,
            components: logComponents,
            files: evidenceFiles.map(file => ({ attachment: file.url, name: file.name }))
        });

        if (client.logManualModerationAction && evidenceFiles.length > 0) {
            const manualEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle('Manual Mute Log')
                .addFields(
                    { name: 'User(s)', value: mentions || 'None', inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Evidence', value: evidenceFiles.length ? `${evidenceFiles.length} attachment(s)` : 'None', inline: true },
                    { name: 'Rule', value: ruleConfig ? ruleConfig.label : 'None', inline: true },
                    { name: 'Reason', value: baseReason || 'No reason provided', inline: false },
                    { name: 'Outcome', value: `${successCount} muted, ${decisionCount} needs decision, ${failCount} failed`, inline: false }
                )
                .setTimestamp();

            await client.logManualModerationAction(interaction.guild, {
                category: 'mute',
                embeds: [manualEmbed],
                files: evidenceFiles.map(file => ({ attachment: file.url, name: file.name }))
            });
        }

        const replyEmbeds = [embed];
        const replyComponents = [buildUnmuteRow()];
        if (decisionEmbed && decisionRow) {
            replyEmbeds.push(decisionEmbed);
            replyComponents.push(decisionRow);
        }

        return interaction.reply({ content: response, embeds: replyEmbeds, components: replyComponents, ephemeral: true });
    },
    async handleButton({ client, interaction }) {
        if (!interaction.customId.startsWith(MOD_DECISION_PREFIX)) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        const [, action, actionKey] = interaction.customId.match(/^moddec_([^:]+):(.+)$/) || [];
        if (!action || !actionKey) return false;

        const decision = client.getPendingModerationAction ? client.getPendingModerationAction(actionKey) : null;
        if (!decision || decision.type !== 'moderator_decision') {
            await interaction.reply({ content: 'This moderator decision panel has expired.', ephemeral: true });
            return true;
        }

        if (!canUseDecisionPanel(client, interaction, decision)) {
            await interaction.reply({ content: 'Only the assigned moderator (or bot admins) can use this panel.', ephemeral: true });
            return true;
        }

        if (action === 'close') {
            if (client.deletePendingModerationAction) client.deletePendingModerationAction(actionKey);
            await interaction.update({
                content: 'Moderator decision panel closed.',
                embeds: interaction.message.embeds,
                components: []
            });
            return true;
        }

        const requiredPerm = getRequiredPermission(action);
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(requiredPerm)) {
            await interaction.reply({ content: 'You do not have permission to perform this moderation action.', ephemeral: true });
            return true;
        }

        if (!interaction.guild.members.me.permissions.has(requiredPerm)) {
            await interaction.reply({ content: 'I do not have the required permission to perform that action.', ephemeral: true });
            return true;
        }

        if (action === 'mute' || action === 'temp_ban') {
            const modal = new ModalBuilder()
                .setCustomId(`${MOD_DECISION_MODAL_PREFIX}${action}:${actionKey}`)
                .setTitle(action === 'mute' ? 'Moderator Decision - Mute' : 'Moderator Decision - Temp Ban');

            const durationInput = new TextInputBuilder()
                .setCustomId(MOD_DECISION_DURATION_INPUT_ID)
                .setLabel('Duration (e.g. 1m, 1h, 7d, 1y)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('Example: 1h');

            modal.addComponents(new ActionRowBuilder().addComponents(durationInput));
            await interaction.showModal(modal);
            return true;
        }

        const applied = await applyDecisionAction({
            client,
            guild: interaction.guild,
            decision,
            action,
            moderator: interaction.user,
            sourceChannel: (interaction.channel || interaction.channelId)
        });

        if (applied.error) {
            await interaction.reply({ content: applied.error, ephemeral: true });
            return true;
        }

        if (client.deletePendingModerationAction) client.deletePendingModerationAction(actionKey);

        const successCount = applied.results.filter(result => result.success).length;
        const failCount = applied.results.length - successCount;

        if (action === 'mute' && successCount > 0) {
            const cardText = successCount === 1 ? 'A user was muted.' : `${successCount} users were muted.`;
            const statusChannel = interaction.channel || (interaction.channelId
                ? await client.channels.fetch(interaction.channelId).catch(() => null)
                : null);
            await sendMuteStatusCard(client, statusChannel, cardText, true);
        }

        const decisionEvidenceFiles = Array.isArray(decision.evidenceFiles) ? decision.evidenceFiles : [];
        if (client.logManualModerationAction && decisionEvidenceFiles.length > 0 && (action === 'mute' || action === 'ban' || action === 'temp_ban')) {
            const manualEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle(action === 'mute' ? 'Manual Mute Log' : 'Manual Ban Log')
                .addFields(
                    { name: 'User(s)', value: (decision.users || []).map(user => `<@${user.id}>`).join(', ') || 'None', inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Action', value: action === 'temp_ban' ? `temp ban (${applied.durationRaw || 'unspecified'})` : action, inline: true },
                    { name: 'Rule', value: decision.ruleLabel || 'Unknown Rule', inline: true },
                    { name: 'Reason', value: decision.baseReason || 'No reason provided', inline: false },
                    { name: 'Outcome', value: `${successCount} succeeded, ${failCount} failed`, inline: false }
                )
                .setTimestamp();

            await client.logManualModerationAction(interaction.guild, {
                category: action === 'mute' ? 'mute' : 'ban',
                embeds: [manualEmbed],
                files: decisionEvidenceFiles.map(file => ({ attachment: file.url, name: file.name }))
            });
        }

        await interaction.update({
            content: `Moderator decision applied: ${action}. ${successCount} succeeded, ${failCount} failed.`,
            embeds: interaction.message.embeds,
            components: []
        });
        return true;
    },
    async handleModalSubmit({ client, interaction }) {
        if (!interaction.customId.startsWith(MOD_DECISION_MODAL_PREFIX)) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            return true;
        }

        const [, action, actionKey] = interaction.customId.match(/^moddec_modal:([^:]+):(.+)$/) || [];
        if (!action || !actionKey) return false;

        const decision = client.getPendingModerationAction ? client.getPendingModerationAction(actionKey) : null;
        if (!decision || decision.type !== 'moderator_decision') {
            await interaction.reply({ content: 'This moderator decision panel has expired.', ephemeral: true });
            return true;
        }

        if (!canUseDecisionPanel(client, interaction, decision)) {
            await interaction.reply({ content: 'Only the assigned moderator (or bot admins) can use this panel.', ephemeral: true });
            return true;
        }

        const requiredPerm = getRequiredPermission(action);
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(requiredPerm)) {
            await interaction.reply({ content: 'You do not have permission to perform this moderation action.', ephemeral: true });
            return true;
        }

        if (!interaction.guild.members.me.permissions.has(requiredPerm)) {
            await interaction.reply({ content: 'I do not have the required permission to perform that action.', ephemeral: true });
            return true;
        }

        const durationRaw = interaction.fields.getTextInputValue(MOD_DECISION_DURATION_INPUT_ID).trim().toLowerCase();
        const applied = await applyDecisionAction({
            client,
            guild: interaction.guild,
            decision,
            action,
            durationRaw,
            moderator: interaction.user,
            sourceChannel: (interaction.channel || interaction.channelId)
        });

        if (applied.error) {
            await interaction.reply({ content: applied.error, ephemeral: true });
            return true;
        }

        if (client.deletePendingModerationAction) client.deletePendingModerationAction(actionKey);

        const successCount = applied.results.filter(result => result.success).length;
        const failCount = applied.results.length - successCount;

        if (action === 'mute' && successCount > 0) {
            const cardText = successCount === 1 ? 'A user was muted.' : `${successCount} users were muted.`;
            const statusChannel = interaction.channel || (interaction.channelId
                ? await client.channels.fetch(interaction.channelId).catch(() => null)
                : null);
            await sendMuteStatusCard(client, statusChannel, cardText, true);
        }

        const modalDecisionEvidenceFiles = Array.isArray(decision.evidenceFiles) ? decision.evidenceFiles : [];
        if (client.logManualModerationAction && modalDecisionEvidenceFiles.length > 0 && (action === 'mute' || action === 'ban' || action === 'temp_ban')) {
            const manualEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle(action === 'mute' ? 'Manual Mute Log' : 'Manual Ban Log')
                .addFields(
                    { name: 'User(s)', value: (decision.users || []).map(user => `<@${user.id}>`).join(', ') || 'None', inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Action', value: action === 'temp_ban' ? `temp ban (${durationRaw})` : action, inline: true },
                    { name: 'Rule', value: decision.ruleLabel || 'Unknown Rule', inline: true },
                    { name: 'Reason', value: decision.baseReason || 'No reason provided', inline: false },
                    { name: 'Outcome', value: `${successCount} succeeded, ${failCount} failed`, inline: false }
                )
                .setTimestamp();

            await client.logManualModerationAction(interaction.guild, {
                category: action === 'mute' ? 'mute' : 'ban',
                embeds: [manualEmbed],
                files: modalDecisionEvidenceFiles.map(file => ({ attachment: file.url, name: file.name }))
            });
        }

        await interaction.reply({
            content: `Moderator decision applied: ${action} ${durationRaw}. ${successCount} succeeded, ${failCount} failed.`,
            ephemeral: true
        });
        return true;
    }
};
