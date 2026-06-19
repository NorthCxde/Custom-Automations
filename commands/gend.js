const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'gend',
    description: 'End a giveaway early.',
    data: new SlashCommandBuilder()
        .setName('gend')
        .setDescription('end a giveaway')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addStringOption(option =>
            option.setName('giveaway_id')
                .setDescription('Giveaway ID or giveaway message ID to end')
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

        if (giveaway.ended) {
            return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
        }

        const ended = await client.finalizeGiveaway(interaction.guildId, giveaway.id);
        if (!ended) {
            return interaction.reply({ content: 'Failed to end giveaway. Try again.', ephemeral: true });
        }

        return interaction.reply({
            content: `Giveaway ended early. ID: ${giveawayId}`,
            ephemeral: true
        });
    }
};
