const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');

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
        if (!args[0]) return message.reply('Usage: ?unmute @user [@user2 ...]');

        const parsedIds = [];
        for (const arg of args) {
            const normalized = arg.replace(/[<@!>]/g, '');
            if (!/^[0-9]{17,19}$/.test(normalized)) break;
            parsedIds.push(normalized);
        }

        const targetIds = [...new Set(parsedIds)];
        if (!targetIds.length) {
            return message.reply('Please provide at least one valid user mention or user ID.');
        }

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return message.reply('I do not have permission to untimeout members.');
            }

            const results = await Promise.all(targetIds.map(async (targetId) => {
                try {
                    const member = await message.guild.members.fetch(targetId);
                    if (!member) {
                        return { targetId, success: false, reason: 'Member not found' };
                    }

                    await member.timeout(null, 'Removing timeout');
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

                    return { targetId, success: true };
                } catch (error) {
                    console.error(error);
                    return { targetId, success: false, reason: error.message };
                }
            }));

            const successIds = results.filter(result => result.success).map(result => result.targetId);
            const failedCount = results.length - successIds.length;

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
            if (successIds.length) {
                replyParts.push(`Removed timeout from ${successIds.map(id => `<@${id}>`).join(', ')}.`);
            }
            if (failedCount) {
                replyParts.push(`${failedCount} user(s) could not be unmuted.`);
            }

            return client.sendPrefixCommandResponse(message.channel, replyParts.join(' '));
        } catch (error) {
            console.error(error);
            return message.reply('Unable to remove timeout for the provided users.');
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

            await member.timeout(null, 'Removing timeout');
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
