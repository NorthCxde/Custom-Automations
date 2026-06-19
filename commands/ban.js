const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the bans')
                .setRequired(false)),
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');
        if (!args[0]) return message.reply('Usage: ?ban @user [@user2 ...] [reason]');

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
            return message.reply('Please provide at least one valid user mention or user ID.');
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
                    await message.guild.members.ban(targetId, { reason });
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
                replyParts.push(`Banned ${success.length} user(s): ${success.join(', ')}. Reason: ${reason}`);
            }
            if (failures.length) {
                replyParts.push(`${failures.length} user(s) could not be banned. Check permissions or existing bans.`);
            }

            return client.sendPrefixCommandResponse(message.channel, replyParts.join(' '));
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

        await client.logToChannel(interaction.guild, { embeds: [embed] });
        return interaction.reply({ content: response, embeds: [embed], components: [row], ephemeral: true });
    }
};
