const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function formatProofLinks(files = []) {
    const sanitizeProofUrl = (value) => {
        const url = String(value || '').trim();
        if (!url) return '';
        const questionIndex = url.indexOf('?');
        return questionIndex === -1 ? url : url.slice(0, questionIndex);
    };

    const links = (files || [])
        .map(file => {
            const url = sanitizeProofUrl(file?.url || file?.attachment);
            const rawName = String(file?.name || 'attachment').trim() || 'attachment';
            const name = rawName.startsWith('SPOILER_') ? rawName : `SPOILER_${rawName}`;
            return url ? `[${name}](${url})` : null;
        })
        .filter(Boolean);

    if (!links.length) return 'None';

    const kept = [];
    let totalLength = 0;
    for (const link of links) {
        const nextLength = totalLength + (kept.length ? 1 : 0) + link.length;
        if (nextLength > 1000) break;
        kept.push(link);
        totalLength = nextLength;
    }

    if (kept.length < links.length) {
        kept.push(`...and ${links.length - kept.length} more`);
    }

    const result = kept.join('\n').trim();
    if (!result) return 'None';
    return result.length > 1024 ? `${result.slice(0, 1021)}...` : result;
}

function toSpoilerFiles(files = []) {
    return (files || []).map(file => {
        const url = String(file?.url || file?.attachment || '').trim();
        const rawName = String(file?.name || 'attachment').trim() || 'attachment';
        const name = rawName.startsWith('SPOILER_') ? rawName : `SPOILER_${rawName}`;
        return { attachment: url, name, spoiler: true };
    });
}

async function sendBanStatusCard(client, channel, text) {
    if (!channel || !text) return;

    const safeText = String(text).trim();
    if (!safeText) return;

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setDescription(`✅ ${safeText}`);

    try {
        const msg = await channel.send({ embeds: [embed] });
        if (client.prefixCommandReactionEmojiId && msg) {
            await msg.react(client.prefixCommandReactionEmojiId).catch(() => null);
        }
    } catch (err) {
        console.error('Failed to send ban status card:', err);
    }
}

async function sendBanUsageCard(channel) {
    if (!channel || typeof channel.send !== 'function') return;

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setDescription([
            '**Command:** ?ban',
            '',
            '**Description:** Ban a member, optional time limit',
            '**Cooldown:** 3 seconds',
            '**Usage:**',
            '?ban [user] [limit] [reason]',
            '?ban save [user] [limit] [reason]',
            '?ban noappeal [user] [limit] [reason]',
            '',
            '**Example:**',
            '?ban albeanie making bugs',
            '?ban save albeanie 2d needs to calm down',
            '?ban noappeal albeanie dont come back'
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

module.exports = {
    name: 'ban',
    description: 'Ban one or more users from the guild',
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban one or more users from the guild')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The first user to ban')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user2')
                .setDescription('Another user to ban')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user3')
                .setDescription('Another user to ban')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user4')
                .setDescription('Another user to ban')
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
                .setDescription('Reason for the bans')
                .setRequired(false)),
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');
        if (!args[0]) {
            await sendBanUsageCard(message.channel);
            return null;
        }

        const parsedIds = [];
        let reasonStartIndex = args.length;
        for (let i = 0; i < args.length; i++) {
            const normalized = args[i].replace(/[<@!>]/g, '');
            if (/^[0-9]{17,19}$/.test(normalized)) {
                parsedIds.push(normalized);
                continue;
            }
            reasonStartIndex = i;
            break;
        }

        const uniqueTargetIds = [...new Set(parsedIds)];
        if (!uniqueTargetIds.length) {
            await sendBanUsageCard(message.channel);
            return null;
        }

        const reason = args.slice(reasonStartIndex).join(' ') || 'No reason provided';

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return message.reply('I do not have permission to ban members.');
            }

            const results = await Promise.all(uniqueTargetIds.map(async (targetId) => {
                try {
                    await client.sendModerationDm({
                        userId: targetId,
                        guildName: message.guild.name,
                        action: 'ban',
                        reason
                    });
                    const fetchedUser = await client.users.fetch(targetId).catch(() => null);
                    await message.guild.members.ban(targetId, { reason });
                    if (client.addModLog) {
                        let robloxId = null;
                        try {
                            if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(message.guild.id, targetId);
                        } catch (err) {
                            console.error('Failed to lookup robloxId for ban modlog:', err);
                        }
                        await client.addModLog(message.guild.id, {
                            action: 'Ban',
                            userId: targetId,
                            userTag: `<@${targetId}>`,
                            robloxId,
                            moderatorId: message.author.id,
                            moderatorTag: message.author.tag,
                            reason,
                            timestamp: new Date().toISOString()
                        });
                    }
                    return { targetId, success: true, username: fetchedUser?.username || null };
                } catch (error) {
                    console.error(error);
                    return { targetId, success: false, reason: error.message };
                }
            }));

            const success = results.filter(result => result.success).map(result => `<@${result.targetId}>`);
            const failures = results.filter(result => !result.success);

            if (success.length > 0 && client.sendBanSticker) {
                await client.sendBanSticker(message.channel);
                const firstSuccess = results.find(result => result.success);
                const cardText = success.length === 1
                    ? `${firstSuccess?.username || 'User'} was banned.`
                    : `${success.length} users were banned.`;
                await sendBanStatusCard(client, message.channel, cardText);
            }

            const replyParts = [];
            if (failures.length) {
                replyParts.push(`${failures.length} user(s) could not be banned. Check permissions or existing bans.`);
            }

            if (replyParts.length) {
                return client.sendPrefixCommandResponse(message.channel, replyParts.join(' '));
            }
            return null;
        } catch (error) {
            console.error(error);
            return message.reply('Unable to ban the provided users. Check IDs and permissions.');
        }
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.BanMembers)) {
            return interaction.reply({ content: 'You need Ban Members permission to use this command.', ephemeral: true });
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
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return interaction.reply({ content: 'I do not have permission to ban members.', ephemeral: true });
        }

        const results = await Promise.all(users.map(async (user) => {
            try {
                await client.sendModerationDm({
                    user,
                    guildName: interaction.guild.name,
                    action: 'ban',
                    reason
                });
                await interaction.guild.members.ban(user.id, { reason });
                let robloxId = null;
                try {
                    if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(interaction.guild.id, user.id);
                } catch (err) {
                    console.error('Failed to lookup robloxId for ban modlog:', err);
                }
                await client.addModLog(interaction.guild.id, {
                    action: 'Ban',
                    userId: user.id,
                    userTag: `${user.tag}`,
                    robloxId,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    reason,
                    timestamp: new Date().toISOString()
                });
                return { user, success: true };
            } catch (error) {
                console.error(error);
                return { user, success: false, error };
            }
        }));

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        const mentions = results.map(r => `<@${r.user.id}>`).join(', ');
        const reply = [];

        if (successCount > 0 && client.sendBanSticker) {
            await client.sendBanSticker(interaction.channel || interaction.channelId);

            const firstSuccess = results.find(result => result.success);
            const cardText = successCount === 1 && firstSuccess
                ? `${firstSuccess.user.username} was banned.`
                : `${successCount} users were banned.`;

            const statusChannel = interaction.channel || (interaction.channelId
                ? await client.channels.fetch(interaction.channelId).catch(() => null)
                : null);
            await sendBanStatusCard(client, statusChannel, cardText);
        }

        if (successCount) {
            reply.push(`Banned ${successCount} user(s): ${mentions}`);
        }
        if (failCount) {
            reply.push(`${failCount} user(s) could not be banned. Check permissions or existing bans.`);
        }

        const response = reply.join(' ');
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle(`Ban Action`)
            .setDescription(`Case by ${interaction.user.tag}`)
            .addFields(
                { name: 'User(s)', value: mentions || 'None', inline: true },
                { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Evidence', value: evidenceFiles.length ? `${evidenceFiles.length} attachment(s)` : 'None', inline: true },
                { name: 'Reason', value: reason || 'No reason provided', inline: false },
                { name: 'Target IDs', value: users.map(u => u.id).join(', ') || 'None', inline: false }
            )
            .setTimestamp();

        const actionKey = `ban_action_${interaction.id}`;
        client.addPendingModerationAction(actionKey, {
            type: 'ban',
            moderatorId: interaction.user.id,
            users: users.map(user => ({ id: user.id, tag: user.tag }))
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ban_unban_specific:${actionKey}`)
                .setLabel('Unban Specific')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`ban_unban_all:${actionKey}`)
                .setLabel('Unban All')
                .setStyle(ButtonStyle.Success)
        );

        await client.logToChannel(interaction.guild, {
            embeds: [embed],
            files: evidenceFiles.map(file => ({ attachment: file.url, name: file.name }))
        });

        if (client.logManualModerationAction && evidenceFiles.length > 0) {
            const manualEmbed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle('Manual Ban Log')
                .addFields(
                    { name: 'User(s)', value: mentions || 'None', inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Evidence', value: evidenceFiles.length ? `${evidenceFiles.length} attachment(s)` : 'None', inline: true },
                    { name: 'Proofs', value: formatProofLinks(evidenceFiles), inline: false },
                    { name: 'Reason', value: reason || 'No reason provided', inline: false },
                    { name: 'Outcome', value: `${successCount} succeeded, ${failCount} failed`, inline: false }
                )
                .setTimestamp();

            await client.logManualModerationAction(interaction.guild, {
                category: 'ban',
                embeds: [manualEmbed],
                files: toSpoilerFiles(evidenceFiles)
            });
        }

        return interaction.reply({ content: response, embeds: [embed], components: [row], ephemeral: true });
    }
};
