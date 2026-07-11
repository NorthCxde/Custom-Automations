const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'hidecommand',
    description: 'Enable or disable deleting moderation prefix command messages after use.',
    data: new SlashCommandBuilder()
        .setName('hidecommand')
        .setDescription('Enable or disable deleting moderation prefix command messages after use.')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Enable or disable command hiding')
                .setRequired(true)
                .addChoices(
                    { name: 'Enable', value: 'enable' },
                    { name: 'Disable', value: 'disable' }
                )
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const action = interaction.options.getString('action', true);
        const enabled = action === 'enable';

        if (typeof client.setHideCommandState === 'function') {
            client.setHideCommandState(interaction.guild.id, enabled);
        }

        await interaction.reply({
            content: enabled
                ? 'Moderation prefix command messages will now be deleted after use.'
                : 'Moderation prefix command messages will no longer be deleted after use.',
            ephemeral: true
        });
    }
};
