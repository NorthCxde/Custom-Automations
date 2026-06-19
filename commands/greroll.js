const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'greroll',
    description: 'Reroll one or more new winners from a giveaway.',
    data: new SlashCommandBuilder()
        .setName('greroll')
        .setDescription('Reroll one or more new winners from a giveaway.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addStringOption(option =>
            option.setName('giveaway_id')
                .setDescription('The giveaway ID shown when it was created')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Number of new winners to pick')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10)
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const giveawayId = interaction.options.getString('giveaway_id');
        const count = interaction.options.getInteger('count') || 1;

        const giveaway = client.getGiveaway(interaction.guildId, giveawayId);
        if (!giveaway) {
            return interaction.reply({ content: 'Giveaway not found for this server.', ephemeral: true });
        }
        if (!giveaway.ended) {
            return interaction.reply({ content: 'You can only reroll a giveaway after it has ended.', ephemeral: true });
        }

        const result = await client.rerollGiveaway(interaction.guildId, giveawayId, count, interaction.user.id);
        if (!result.giveaway) {
            return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
        }
        if (!result.winners.length) {
            return interaction.reply({ content: 'No new eligible winners were available to reroll.', ephemeral: true });
        }

        return interaction.reply({
            content: `${interaction.user} rerolled the giveaway! Congratulations ${result.winners.map(id => `<@${id}>`).join(', ')}!`,
            ephemeral: false
        });
    }
};
