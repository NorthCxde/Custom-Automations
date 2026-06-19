const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    name: 'autoresponder',
    description: 'Create and manage autoresponders (hardcoded admins only).',
    data: new SlashCommandBuilder()
        .setName('autoresponder')
        .setDescription('Create and manage autoresponders (hardcoded admins only).'),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const responders = client.getAutoresponders(interaction.guildId);

        const variableInfo = [
            '{user} -> mention of the user who triggered the response',
            '{avatar} -> avatar URL of that user',
            '{username} -> username of that user',
            '{server} -> server name',
            '{channel} -> channel name',
            '{&RoleName} -> mention a role by exact role name (example: {&Gamers})'
        ].join('\n');

        if (!responders.length) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ar_create_start')
                    .setLabel('Yes, Create One')
                    .setStyle(ButtonStyle.Success)
            );

            return interaction.reply({
                content: `You do not have any autoresponders yet.\nWould you like to create one?\n\nVariables:\n${variableInfo}`,
                components: [row],
                ephemeral: true
            });
        }

        const lines = responders.slice(0, 20).map((entry, idx) => {
            const mode = entry.matchType === 'exact' ? 'exact' : 'contains';
            const status = entry.enabled === false ? 'disabled' : 'enabled';
            return `${idx + 1}. ${entry.trigger} (${mode}, ${status})`;
        });

        const listText = [
            'Existing autoresponders:',
            ...lines,
            responders.length > 20 ? `...and ${responders.length - 20} more.` : null
        ].filter(Boolean).join('\n');

        const options = responders.slice(0, 25).map((entry, idx) => ({
            label: `${idx + 1}. ${entry.trigger}`.slice(0, 100),
            value: entry.id,
            description: `${entry.matchType === 'exact' ? 'Exact' : 'Contains'} | ${entry.enabled === false ? 'Disabled' : 'Enabled'}`.slice(0, 100)
        }));

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ar_existing_select')
                .setPlaceholder('Select an autoresponder to edit')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(options)
        );

        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ar_create_start')
                .setLabel('Create New')
                .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({
            content: `${listText}\n\nVariables:\n${variableInfo}`,
            components: [selectRow, buttonRow],
            ephemeral: true
        });
    }
};
