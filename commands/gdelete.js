const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'gdelete',
    description: 'End a giveaway and delete its message.',
    data: new SlashCommandBuilder()
        .setName('gdelete')
        .setDescription('Delete giveaway (ends it and removes giveaway message)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addStringOption(option =>
            option.setName('giveaway_id')
                .setDescription('Giveaway ID or giveaway message ID to delete')
                .setRequired(true)
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const giveawayId = interaction.options.getString('giveaway_id');
        const giveaway = client.findGiveawayByInput(interaction.guildId, giveawayId);
        if (!giveaway) {
            return interaction.reply({ content: 'Giveaway not found for this server.', ephemeral: true });
        }

        if (!giveaway.ended) {
            await client.finalizeGiveaway(interaction.guildId, giveaway.id);
        }

        const resolved = await client.resolveGiveawayMessage(giveaway).catch(() => null);
        if (resolved?.message) {
            await resolved.message.delete().catch(() => null);
        }

        client.deleteGiveawayRecord(interaction.guildId, giveaway.id);

        return interaction.reply({
            content: `Giveaway ended and deleted. ID: ${giveawayId}`,
            ephemeral: true
        });
    }
};
