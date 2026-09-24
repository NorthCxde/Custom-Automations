const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'ticketscan',
    data: new SlashCommandBuilder()
        .setName('ticketscan')
        .setDescription('Enable or disable the automatic Roblox ticket info scan.')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Enable, disable, or check the scanner state')
                .setRequired(true)
                .addChoices(
                    { name: 'Enable', value: 'enable' },
                    { name: 'Disable', value: 'disable' },
                    { name: 'Status', value: 'status' }
                )
        ),
    async executeInteraction({ client, interaction }) {
        if (!Array.isArray(client.hardcodedAdmins) && !client.hardcodedAdmins?.has) {
            return interaction.reply({ content: 'Ticket scan settings are unavailable right now.', ephemeral: true });
        }

        if (!client.hardcodedAdmins.has(String(interaction.user.id))) {
            return interaction.reply({ content: 'Only bot admins can toggle the ticket scan feature.', ephemeral: true });
        }

        const action = interaction.options.getString('action', true).toLowerCase();

        if (action === 'enable') {
            client.ticketScanEnabled = true;
            if (typeof client.saveTicketScanState === 'function') client.saveTicketScanState();
            return interaction.reply({ content: 'Automatic ticket scanning is now **enabled**.', ephemeral: true });
        }

        if (action === 'disable') {
            client.ticketScanEnabled = false;
            if (typeof client.saveTicketScanState === 'function') client.saveTicketScanState();
            return interaction.reply({ content: 'Automatic ticket scanning is now **disabled**.', ephemeral: true });
        }

        const state = client.ticketScanEnabled ? 'enabled' : 'disabled';
        return interaction.reply({ content: `Automatic ticket scanning is currently **${state}**.`, ephemeral: true });
    }
};
