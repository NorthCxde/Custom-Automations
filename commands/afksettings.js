const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'afksettings',
    description: 'Configure your AFK preferences.',
    data: new SlashCommandBuilder()
        .setName('afksettings')
        .setDescription('Configure your AFK preferences.')
        .addBooleanOption(option =>
            option.setName('notify_button')
                .setDescription('Enable or disable the "Tell me when back" button on your AFK notices.')
                .setRequired(true)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const notifyButton = interaction.options.getBoolean('notify_button');
        client.setAfkNotifyEnabled(interaction.guild.id, interaction.user.id, notifyButton);

        return interaction.reply({
            content: notifyButton
                ? 'The \'Tell me when back\' button is now **enabled** on your AFK notices.'
                : 'The \'Tell me when back\' button is now **disabled** on your AFK notices.',
            ephemeral: true
        });
    }
};
