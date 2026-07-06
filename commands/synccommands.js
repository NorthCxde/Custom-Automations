const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'synccommands',
    description: 'Re-sync slash commands to every guild this bot is in (hardcoded admins only).',
    data: new SlashCommandBuilder()
        .setName('synccommands')
        .setDescription('Re-sync slash commands (hardcoded admins only).')
        .addStringOption(option =>
            option
                .setName('scope')
                .setDescription('Choose whether to sync only this guild or all guilds')
                .addChoices(
                    { name: 'current', value: 'current' },
                    { name: 'all', value: 'all' }
                )
        ),
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

        const scope = interaction.options.getString('scope') || 'current';
        const shouldSyncAll = scope === 'all';
        const guildIds = shouldSyncAll ? undefined : [interaction.guildId];

        await interaction.deferReply({ ephemeral: true });

        const { slashData, globalSlashData, guildSlashData, globalResult, results } = await client.syncSlashCommands({ guildIds });
        const successLines = results
            .filter(result => result.success)
            .map(result => `- ${result.guildName}: synced ${result.count} command(s)`);
        const failureLines = results
            .filter(result => !result.success)
            .map(result => `- ${result.guildName}: ${result.error}`);

        const parts = [
            `Re-synced ${slashData.length} slash command(s).`,
            `Global commands: ${globalSlashData.length ? globalSlashData.map(cmd => `/${cmd.name}`).join(', ') : 'none'}`,
            `Guild commands: ${guildSlashData.length ? guildSlashData.map(cmd => `/${cmd.name}`).join(', ') : 'none'}`,
            `Global sync: ${globalResult?.success ? `ok (${globalResult.count} command(s))` : `failed (${globalResult?.error || 'unknown error'})`}`,
            `Scope: ${shouldSyncAll ? 'all guilds' : 'current guild'}`,
            `Commands: ${slashData.map(cmd => `/${cmd.name}`).join(', ')}`
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
