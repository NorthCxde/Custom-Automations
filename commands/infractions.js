const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'infractions',
    description: 'Hardcoded-admin infraction tools.',
    data: new SlashCommandBuilder()
        .setName('infractions')
        .setDescription('Hardcoded-admin infraction tools.')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Choose an infraction action')
                .setRequired(true)
                .addChoices(
                    { name: 'Reset Everyone To Level 1', value: 'reset_all' }
                )
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const action = interaction.options.getString('action', true);

        if (action === 'reset_all') {
            if (typeof client.resetAllInfractionProgress !== 'function') {
                return interaction.reply({ content: 'Infraction reset helper is unavailable on this bot instance.', ephemeral: true });
            }

            const result = client.resetAllInfractionProgress(interaction.guild.id);
            return interaction.reply({
                content: `Reset infraction progression for this server. Updated ${result.resetCount} case(s) out of ${result.totalCases} total case(s). Everyone now starts back at level 1.`,
                ephemeral: true
            });
        }

        return interaction.reply({ content: 'Unknown action.', ephemeral: true });
    }
};
