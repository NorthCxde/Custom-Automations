const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'enablecommands',
    description: 'Enable or disable prefix commands (e.g. ?ban) — hardcoded admins only',
    data: new SlashCommandBuilder()
        .setName('enablecommands')
        .setDescription('Enable or disable prefix commands (e.g. ?ban) — hardcoded admins only')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Enable or disable prefix commands')
                .setRequired(true)
                .addChoices(
                    { name: 'Enable', value: 'enable' },
                    { name: 'Disable', value: 'disable' }
                )
        ),
    async executeInteraction({ client, interaction }) {
        const action = interaction.options.getString('action');
        client.prefixCommandsEnabled = action === 'enable';

        const state = client.prefixCommandsEnabled ? 'enabled' : 'disabled';
        await interaction.reply({
            content: `Prefix commands (e.g. \`?ban\`) are now **${state}**.`,
            ephemeral: true
        });
    }
};
