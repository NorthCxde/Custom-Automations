const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');

async function sendUnmuteStatusCard(client, channel, text, isSuccess = true) {
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
        console.error('Failed to send unmute status card:', err);
    }
}

async function sendUnmuteUsageCard(channel) {
    if (!channel || typeof channel.send !== 'function') return;

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setDescription([
            '**Command:** ?unmute',
            '',
            '**Description:** Remove timeout from one or more users',
            '**Cooldown:** 3 seconds',
            '**Usage:**',
            '?unmute [user]',
            '?unmute [user1] [user2] [user3]',
            '',
            '**Example:**',
            '?unmute @albeanie',
            '?unmute @albeanie @albeanie'
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
    name: 'unmute',
    description: 'Remove timeout from a member by mention or ID.',
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove timeout from a member')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to remove timeout from')
                .setRequired(true)),
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');
        if (!args[0]) {
            await sendUnmuteUsageCard(message.channel);
            return null;
        }

        const parsedIds = [];
        for (const arg of args) {
            const normalized = arg.replace(/[<@!>]/g, '');
            if (!/^[0-9]{17,19}$/.test(normalized)) break;
            parsedIds.push(normalized);
        }

        const targetIds = [...new Set(parsedIds)];
        if (!targetIds.length) {
            await sendUnmuteUsageCard(message.channel);
            return null;
        }

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                await sendUnmuteStatusCard(client, message.channel, 'I do not have permission to untimeout members.', false);
                return null;
            }

            const results = await Promise.all(targetIds.map(async (targetId) => {
                try {
                    const member = await message.guild.members.fetch(targetId);
                    if (!member) {
                        return { targetId, success: false, reason: 'Member not found' };
                    }

                    const isMuted = Number(member.communicationDisabledUntilTimestamp || 0) > Date.now();
                    if (!isMuted) {
                        return { targetId, success: false, reason: `${member.user.username} is not muted.` };
                    }

                    await member.timeout(null, 'Removing timeout');
                    if (typeof client.markLatestInfractionMuteAsAppealed === 'function') {
                        client.markLatestInfractionMuteAsAppealed(message.guild.id, targetId, Date.now());
                    }
                    let robloxId = null;
                    try {
                        if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(message.guild.id, targetId);
                    } catch (err) {
                        console.error('Failed to lookup robloxId for unmute modlog:', err);
                    }

                    if (client.addModLog) {
                        client.addModLog(message.guild.id, {
                            action: 'Unmute',
                            userId: targetId,
                            userTag: `<@${targetId}>`,
                            robloxId,
                            moderatorId: message.author.id,
                            moderatorTag: message.author.tag,
                            timestamp: new Date().toISOString()
                        });
                    }

                    return { targetId, success: true, username: member.user.username };
                } catch (error) {
                    console.error(error);
                    return { targetId, success: false, reason: error.message };
                }
            }));

            const successIds = results.filter(result => result.success).map(result => result.targetId);
            const successResults = results.filter(result => result.success);
            const failureResults = results.filter(result => !result.success);
            const failedCount = results.length - successIds.length;

            if (successIds.length > 0) {
                const cardText = successIds.length === 1
                    ? `${successResults[0]?.username || 'User'} was unmuted.`
                    : `${successIds.length} users were unmuted.`;
                await sendUnmuteStatusCard(client, message.channel, cardText);
            }

            if (!successIds.length && failureResults.length) {
                const firstReason = failureResults[0]?.reason || 'Could not unmute that user.';
                const cardText = failureResults.length === 1
                    ? `I can't unmute that user, ${firstReason.toLowerCase()}`
                    : `I couldn't unmute ${failureResults.length} users.`;
                await sendUnmuteStatusCard(client, message.channel, cardText, false);
            }

            if (successIds.length && client.logToChannel) {
                const mentions = successIds.map(id => `<@${id}>`).join(', ');
                const embed = new EmbedBuilder()
                    .setColor(0x000000)
                    .setTitle('Unmute Action')
                    .setDescription(`Case by ${message.author.tag}`)
                    .addFields(
                        { name: 'User(s)', value: mentions, inline: true },
                        { name: 'Moderator', value: `<@${message.author.id}>`, inline: true },
                        { name: 'Reason', value: 'Removing timeout', inline: false },
                        { name: 'Target IDs', value: successIds.join(', '), inline: false }
                    )
                    .setTimestamp();

                await client.logToChannel(message.guild, { embeds: [embed] });
            }

            const replyParts = [];
            if (failedCount) {
                replyParts.push(`${failedCount} user(s) could not be unmuted.`);
            }

            if (replyParts.length) {
                return client.sendPrefixCommandResponse(message.channel, replyParts.join(' '));
            }
            return null;
        } catch (error) {
            console.error(error);
            await sendUnmuteStatusCard(client, message.channel, 'Unable to remove timeout for the provided users.', false);
            return null;
        }
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({ content: 'You need Moderate Members permission to use this command.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        if (!user) {
            return interaction.reply({ content: 'Please provide a user to unmute.', ephemeral: true });
        }

        try {
            const member = await interaction.guild.members.fetch(user.id);
            if (!member) {
                return interaction.reply({ content: 'Could not find that member in this guild.', ephemeral: true });
            }

            const isMuted = Number(member.communicationDisabledUntilTimestamp || 0) > Date.now();
            if (!isMuted) {
                const statusChannel = interaction.channel || (interaction.channelId
                    ? await client.channels.fetch(interaction.channelId).catch(() => null)
                    : null);
                await sendUnmuteStatusCard(client, statusChannel, `I can't unmute ${user.username}, they aren't muted.`, false);
                return interaction.reply({ content: `${user.tag} is not muted.`, ephemeral: true });
            }

            await member.timeout(null, 'Removing timeout');
            if (typeof client.markLatestInfractionMuteAsAppealed === 'function') {
                client.markLatestInfractionMuteAsAppealed(interaction.guild.id, user.id, Date.now());
            }
            const statusChannel = interaction.channel || (interaction.channelId
                ? await client.channels.fetch(interaction.channelId).catch(() => null)
                : null);
            await sendUnmuteStatusCard(client, statusChannel, `${user.username} was unmuted.`);
            await interaction.reply({ content: `Removed timeout from ${user.tag}.`, ephemeral: true });
            if (client.addModLog) {
                let robloxId = null;
                try {
                    if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(interaction.guild.id, user.id);
                } catch (err) {
                    console.error('Failed to lookup robloxId for unmute modlog:', err);
                }
                client.addModLog(interaction.guild.id, {
                    action: 'Unmute',
                    userId: user.id,
                    userTag: user.tag,
                    robloxId,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    timestamp: new Date().toISOString()
                });
                if (client.logToChannel) {
                    const embed = new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle('Unmute Action')
                        .setDescription(`Case by ${interaction.user.tag}`)
                        .addFields(
                            { name: 'User(s)', value: `<@${user.id}>`, inline: true },
                            { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Reason', value: 'Removing timeout', inline: false },
                            { name: 'Target IDs', value: user.id, inline: false }
                        )
                        .setTimestamp();

                    await client.logToChannel(interaction.guild, { embeds: [embed] });
                }
            }
        } catch (error) {
            console.error(error);
            return interaction.reply({ content: 'Unable to remove timeout. The user may not be timed out, or the ID may be invalid.', ephemeral: true });
        }
    }
};
