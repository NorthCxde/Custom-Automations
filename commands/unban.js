const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');

async function sendUnbanStatusCard(client, channel, text) {
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
        console.error('Failed to send unban status card:', err);
    }
}

async function sendUnbanUsageCard(channel) {
    if (!channel || typeof channel.send !== 'function') return;

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setDescription([
            '**Command:** ?unban',
            '',
            '**Description:** Unban a user by mention or ID',
            '**Cooldown:** 3 seconds',
            '**Usage:**',
            '?unban [user]',
            '?unban [userId]',
            '',
            '**Example:**',
            '?unban @albeanie',
            '?unban 123456789012345678'
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
    name: 'unban',
    description: 'Unban a user by mention or ID',
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to unban')
                .setRequired(true)),
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');
        if (!args[0]) {
            await sendUnbanUsageCard(message.channel);
            return null;
        }

        const targetId = args[0].replace(/[<@!>]/g, '');

        if (!/^[0-9]{17,19}$/.test(targetId)) {
            await sendUnbanUsageCard(message.channel);
            return null;
        }

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return message.reply('I do not have permission to unban members.');
            }

            await message.guild.members.unban(targetId);
            const fetchedUser = await client.users.fetch(targetId).catch(() => null);
            await sendUnbanStatusCard(client, message.channel, `${fetchedUser?.username || 'User'} was unbanned.`);
            if (client.addModLog) {
                let robloxId = null;
                try {
                    if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(message.guild.id, targetId);
                } catch (err) {
                    console.error('Failed to lookup robloxId for unban modlog:', err);
                }
                client.addModLog(message.guild.id, {
                    action: 'Unban',
                    userId: targetId,
                    userTag: `<@${targetId}>`,
                    robloxId,
                    moderatorId: message.author.id,
                    moderatorTag: message.author.tag,
                    timestamp: new Date().toISOString()
                });
                if (client.logToChannel) await client.logToChannel(message.guild, `Unban: <@${targetId}> by ${message.author.tag}`);
            }
            return null;
        } catch (error) {
            console.error(error);
            return message.reply('Unable to unban that user. They may not be banned or the ID may be invalid.');
        }
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.BanMembers)) {
            return interaction.reply({ content: 'You need Ban Members permission to use this command.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        if (!user) {
            return interaction.reply({ content: 'Please provide a user to unban.', ephemeral: true });
        }

        try {
            await interaction.guild.members.unban(user.id);
            const statusChannel = interaction.channel || (interaction.channelId
                ? await client.channels.fetch(interaction.channelId).catch(() => null)
                : null);
            await sendUnbanStatusCard(client, statusChannel, `${user.username} was unbanned.`);
            await interaction.reply({ content: `Unbanned ${user.tag}.`, ephemeral: true });
            if (client.addModLog) {
                let robloxId = null;
                try {
                    if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(interaction.guild.id, user.id);
                } catch (err) {
                    console.error('Failed to lookup robloxId for unban modlog:', err);
                }
                client.addModLog(interaction.guild.id, {
                    action: 'Unban',
                    userId: user.id,
                    userTag: user.tag,
                    robloxId,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    timestamp: new Date().toISOString()
                });
                if (client.logToChannel) await client.logToChannel(interaction.guild, `Unban: ${user.tag} by ${interaction.user.tag}`);
            }
        } catch (error) {
            console.error(error);
            return interaction.reply({ content: 'Unable to unban that user. They may not be banned or the ID may be invalid.', ephemeral: true });
        }
    }
};
