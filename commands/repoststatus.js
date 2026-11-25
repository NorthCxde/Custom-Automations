const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    name: 'repoststatus',
    data: new SlashCommandBuilder()
        .setName('repoststatus')
        .setDescription('Enable, disable, or check automatic evidence video reposting.')
        .addStringOption(option => option
            .setName('action')
            .setDescription('Choose the reposting state')
            .setRequired(true)
            .addChoices(
                { name: 'Enable', value: 'enable' },
                { name: 'Disable', value: 'disable' },
                { name: 'Status', value: 'status' }
            )),
    async executeInteraction({ client, interaction }) {
        if (!client.hardcodedAdmins?.has(String(interaction.user.id))) {
            return interaction.reply({
                content: 'Only hardcoded admins can manage video reposting.',
                flags: MessageFlags.Ephemeral
            });
        }
        const action = interaction.options.getString('action', true);
        if (action !== 'status') {
            if (!['enable', 'disable'].includes(action)) {
                return interaction.reply({ content: 'Invalid repost action.', flags: MessageFlags.Ephemeral });
            }
            try {
                client.setVideoRepostEnabled(action === 'enable');
            } catch (error) {
                console.error('Failed to save video repost settings:', error);
                return interaction.reply({
                    content: 'Could not save video repost settings. The previous setting remains in effect.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        return interaction.reply({
            content: `Automatic video reposting is **${client.videoRepostEnabled ? 'enabled' : 'disabled'}**. The five-day warning scan is unchanged.`,
            flags: MessageFlags.Ephemeral
        });
    }
};
