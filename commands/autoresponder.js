const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    name: 'autoresponder',
    description: 'Create and manage autoresponders (hardcoded admins only).',
    data: new SlashCommandBuilder()
        .setName('autoresponder')
        .setDescription('Create and manage autoresponders (hardcoded admins only).'),
    buildListPayload({ client, guildId, page = 0 }) {
        const responders = client.getAutoresponders(guildId);
        const variableInfo = [
            '{user} -> mention of the user who triggered the response',
            '{avatar} -> avatar URL of that user',
            '{username} -> username of that user',
            '{server} -> server name',
            '{channel} -> channel name',
            '{&RoleName} -> mention a role by exact role name (example: {&Gamers})'
        ].join('\n');
        const pageSize = 25;
        const pageCount = Math.max(1, Math.ceil(responders.length / pageSize));
        const currentPage = Math.min(Math.max(Number(page) || 0, 0), pageCount - 1);
        const pageEntries = responders.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

        const options = pageEntries.map((entry, index) => ({
            label: `${currentPage * pageSize + index + 1}. ${entry.trigger}`.slice(0, 100),
            value: entry.id,
            description: `${entry.matchType === 'exact' ? 'Exact' : 'Contains'} | ${entry.enabled === false ? 'Disabled' : 'Enabled'}`.slice(0, 100)
        }));
        const components = [];
        if (options.length) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ar_existing_select')
                    .setPlaceholder('Select an autoresponder to edit')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(options)
            ));
        }

        const navigation = [];
        if (currentPage > 0) {
            navigation.push(new ButtonBuilder().setCustomId(`ar_page:${currentPage - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary));
        }
        if (currentPage < pageCount - 1) {
            navigation.push(new ButtonBuilder().setCustomId(`ar_page:${currentPage + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary));
        }
        if (navigation.length) components.push(new ActionRowBuilder().addComponents(navigation));
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ar_create_start').setLabel('Create New').setStyle(ButtonStyle.Success)
        ));

        return {
            content: [
                'Autoresponder manager',
                'Create automatic replies for configured words or phrases, or select one below to edit it.',
                `Configured: ${responders.length} | Page ${currentPage + 1}/${pageCount}`,
                '',
                `Variables:\n${variableInfo}`
            ].join('\n'),
            components,
            ephemeral: true
        };
    },
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const responders = client.getAutoresponders(interaction.guildId);

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

        return interaction.reply(this.buildListPayload({ client, guildId: interaction.guildId }));
    }
};
