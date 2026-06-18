const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

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
        if (!args[0]) return message.reply('Usage: ?unban @user or ?unban userId');

        const targetId = args[0].replace(/[<@!>]/g, '');

        if (!/^[0-9]{17,19}$/.test(targetId)) {
            return message.reply('Please provide a valid user mention or user ID.');
        }

        try {
            if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return message.reply('I do not have permission to unban members.');
            }

            await message.guild.members.unban(targetId);
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
            return message.channel.send(`Unbanned <@${targetId}>.`);
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
