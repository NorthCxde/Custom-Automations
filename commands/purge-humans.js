const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'purge-humans',
    description: 'Delete messages that were sent by humans (non-bots)',
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete messages that were sent by humans (non-bots)')
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Number of messages to delete.')
                .setRequired(true)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: 'You need the Manage Messages permission to use this command.', ephemeral: true });
        }

        const count = interaction.options.getInteger('count');

        if (!count || count < 1) {
            return interaction.reply({ content: 'Please provide a valid number for the count.', ephemeral: true });
        }

        if (!interaction.channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: 'I need Manage Messages permission to delete messages.', ephemeral: true });
        }

        try {
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            const candidates = messages.filter(msg => msg.author.bot === false).first(count);

            if (candidates.length === 0) {
                return interaction.reply({ content: 'No recent messages from humans were found to delete.', ephemeral: true });
            }

            await interaction.channel.bulkDelete(candidates, true);
            await client.addModLog(interaction.guild.id, {
                action: 'Purge',
                userId: null,
                userTag: 'Humans',
                moderatorId: interaction.user.id,
                moderatorTag: interaction.user.tag,
                reason: `Deleted ${candidates.length} messages from humans`,
                count: candidates.length,
                channelId: interaction.channel.id,
                timestamp: new Date().toISOString()
            });
            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle(`Purge Action`)
                .setDescription(`Case by ${interaction.user.tag}`)
                .addFields(
                    { name: 'Deleted', value: `${candidates.length} message(s)`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Channel', value: `<#${interaction.channel.id}>`, inline: false },
                    { name: 'Filter', value: 'Messages from humans (non-bots)', inline: false },
                    { name: 'Target IDs', value: 'N/A', inline: false }
                )
                .setTimestamp();

            await client.logToChannel(interaction.guild, { embeds: [embed] });
            return interaction.reply({ content: `Purged ${candidates.length} message(s) from humans.`, ephemeral: true });
        } catch (error) {
            console.error(error);
            return interaction.reply({ content: 'Unable to purge messages. Ensure the messages are not older than 14 days and I have the correct permissions.', ephemeral: true });
        }
    }
};
