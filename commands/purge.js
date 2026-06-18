const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'purge',
    description: 'Delete recent messages from one or more users or the current channel',
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete recent messages from one or more users or the current channel')
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('How many messages to delete (1-100)')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The first user whose messages should be deleted')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user2')
                .setDescription('Another user whose messages should be deleted')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user3')
                .setDescription('Another user whose messages should be deleted')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user4')
                .setDescription('Another user whose messages should be deleted')
                .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: 'You need the Manage Messages permission to use this command.', ephemeral: true });
        }

        const count = interaction.options.getInteger('count');
        const users = [
            interaction.options.getUser('user'),
            interaction.options.getUser('user2'),
            interaction.options.getUser('user3'),
            interaction.options.getUser('user4')
        ].filter(Boolean);

        if (!count || count < 1 || count > 100) {
            return interaction.reply({ content: 'Please provide a number between 1 and 100 for the count.', ephemeral: true });
        }

        if (!interaction.channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: 'I need Manage Messages permission to delete messages.', ephemeral: true });
        }

        try {
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            const candidates = users.length > 0
                ? messages.filter(msg => users.some(user => msg.author.id === user.id)).first(count)
                : messages.first(count);

            if (candidates.length === 0) {
                const message = users.length > 0
                    ? 'No recent messages from the selected users were found to delete.'
                    : 'No recent messages were found to delete.';
                return interaction.reply({ content: message, ephemeral: true });
            }

            await interaction.channel.bulkDelete(candidates, true);
            for (const user of users) {
                await client.addModLog(interaction.guild.id, {
                    action: 'Purge',
                    userId: user.id,
                    userTag: `${user.tag}`,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    reason: `Deleted up to ${candidates.length} messages`,
                    count: candidates.length,
                    channelId: interaction.channel.id,
                    timestamp: new Date().toISOString()
                });
            }
            const mentionText = users.length > 0
                ? ` from ${users.map(user => `<@${user.id}>`).join(', ')}`
                : '';
            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle(`Purge Action`)
                .setDescription(`Case by ${interaction.user.tag}`)
                .addFields(
                    { name: 'Deleted', value: `${candidates.length} message(s)`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Channel', value: `<#${interaction.channel.id}>`, inline: false },
                    { name: 'Users', value: users.length > 0 ? users.map(user => `<@${user.id}>`).join(', ') : 'All recent messages', inline: false },
                    { name: 'Target IDs', value: users.length > 0 ? users.map(user => user.id).join(', ') : 'N/A', inline: false }
                )
                .setTimestamp();

            await client.logToChannel(interaction.guild, { embeds: [embed] });
            return interaction.reply({ content: `Purged ${candidates.length} message(s)${mentionText}.`, ephemeral: true });
        } catch (error) {
            console.error(error);
            return interaction.reply({ content: 'Unable to purge messages. Ensure the messages are not older than 14 days and I have the correct permissions.', ephemeral: true });
        }
    }
};
