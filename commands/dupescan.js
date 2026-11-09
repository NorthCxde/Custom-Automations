const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'dupescan',
    data: new SlashCommandBuilder()
        .setName('dupescan')
        .setDescription('Immediately check open exploit reports for duplicate banned users.'),
    async executeInteraction({ client, interaction }) {
        await interaction.deferReply({ ephemeral: true });

        const result = await client.reconcileOpenReportTickets({ force: true });
        if (result?.busy) {
            return interaction.editReply('A duplicate-report scan is already running. Please wait for it to finish.');
        }
        if (!result) {
            return interaction.editReply('The duplicate-report scan could not be started.');
        }
        if (result.error) {
            return interaction.editReply('The duplicate-report scan could not complete. Check the bot logs for details.');
        }

        const noticeCount = result.duplicateNoticeCount || 0;
        const closedCount = result.closedTicketCount || 0;
        const cancelledCount = result.cancelledTicketCount || 0;
        return interaction.editReply(
            `Duplicate scan completed across **${result.scannedTicketCount}** open exploit-report ticket(s). `
            + `Started **${noticeCount}** duplicate close countdown(s); **${closedCount}** ticket(s) closed, `
            + `and **${cancelledCount}** countdown(s) cancelled.`
            + (result.failedTicketCount ? ` **${result.failedTicketCount}** ticket(s) could not be checked; see the bot logs.` : '')
        );
    }
};
