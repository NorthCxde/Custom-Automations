const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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
                .setRequired(true))
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
        if (!args[0] || !args[1]) return message.reply('Usage: ?mute @user 1h or ?mute userId 30m');

        const targetId = args[0].replace(/[<@!>]/g, '');
        const durationMs = parseDuration(args[1]);
        const reason = args.slice(2).join(' ') || 'No reason provided';

        if (!/^[0-9]{17,19}$/.test(targetId)) {
            return message.reply('Please provide a valid user mention or user ID.');
        }
        if (durationMs === null) {
            return message.reply('Please provide a valid duration, e.g. 1m, 1h, or 1d.');
        }

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return message.reply('I do not have permission to timeout members.');
            }

            const member = await message.guild.members.fetch(targetId);
            if (!member) {
                return message.reply('Could not find that member in this guild.');
            }

            await member.timeout(durationMs, reason);
            return message.channel.send(`Timed out <@${targetId}> for ${args[1]}. Reason: ${reason}`);
        } catch (error) {
            console.error(error);
            return message.reply('Unable to timeout that user. They may already be timed out, the ID may be invalid, or I may not have permission.');
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
        const duration = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const durationMs = parseDuration(duration);

        if (!durationMs) {
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
                await member.timeout(durationMs, reason);
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
                    reason,
                    duration,
                    timestamp: new Date().toISOString()
                });
                return { user, success: true };
            } catch (error) {
                console.error(error);
                return { user, success: false, reason: error.message };
            }
        }));

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        const mentions = results.map(r => `<@${r.user.id}>`).join(', ');
        const reply = [];

        if (successCount) {
            reply.push(`Timed out ${successCount} user(s): ${mentions} for ${duration}.`);
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
                { name: 'Duration', value: duration, inline: true },
                { name: 'Reason', value: reason || 'No reason provided', inline: false },
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
