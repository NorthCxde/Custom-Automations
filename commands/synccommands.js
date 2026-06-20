const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'synccommands',
    description: 'Re-sync slash commands to every guild this bot is in (hardcoded admins only).',
    data: new SlashCommandBuilder()
        .setName('synccommands')
        .setDescription('Re-sync slash commands to every guild this bot is in (hardcoded admins only).'),
    async executeInteraction({ client, interaction }) {
        if (typeof client.syncSlashCommands !== 'function') {
            return interaction.reply({
                content: 'Slash command sync helper is not available on this bot instance.',
                ephemeral: true
            });
        }

        if (typeof client.loadCommands === 'function') {
            client.loadCommands();
        }

        await interaction.deferReply({ ephemeral: true });

        const { slashData, results } = await client.syncSlashCommands();
        const successLines = results
            .filter(result => result.success)
            .map(result => `- ${result.guildName}: synced ${result.count} command(s)`);
        const failureLines = results
            .filter(result => !result.success)
            .map(result => `- ${result.guildName}: ${result.error}`);

        const parts = [
            `Re-synced ${slashData.length} slash command(s).`
        ];

        if (successLines.length) {
            parts.push(`Success:\n${successLines.join('\n')}`);
        }

        if (failureLines.length) {
            parts.push(`Failures:\n${failureLines.join('\n')}`);
        }

        await interaction.editReply({
            content: parts.join('\n\n')
        });
    }
};
