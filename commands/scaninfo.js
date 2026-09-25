const { SlashCommandBuilder } = require('discord.js');

const TICKET_PARENT_CHANNEL_ID = '964450684613328916';
const APPEALS_PARENT_CHANNEL_ID = '1406849439104106677';
const SCANINFO_WHITELIST_CHANNEL_ID = '1406849874925719583';

module.exports = {
    name: 'scaninfo',
    data: new SlashCommandBuilder()
        .setName('scaninfo')
        .setDescription('Scan this ticket for Roblox user information.'),
    async executeInteraction({ client, interaction }) {
        const isTicketThread = interaction.channel?.isThread?.()
            && interaction.channel.parentId === TICKET_PARENT_CHANNEL_ID;
        const isAppealsThread = interaction.channel?.isThread?.()
            && interaction.channel.parentId === APPEALS_PARENT_CHANNEL_ID;
        const isAppealsParentChannel = interaction.channelId === APPEALS_PARENT_CHANNEL_ID;
        const isWhitelistedChannel = interaction.channelId === SCANINFO_WHITELIST_CHANNEL_ID
            || (interaction.channel?.isThread?.() && interaction.channel.parentId === SCANINFO_WHITELIST_CHANNEL_ID);

        if (!isTicketThread && !isAppealsThread && !isAppealsParentChannel && !isWhitelistedChannel) {
            return interaction.reply({
                content: 'Use this command inside whitelisted channels.',
                ephemeral: true
            });
        }

        if (!client.isManuallyAddedModerator(interaction.user.id)) {
            return interaction.reply({
                content: 'You must be manually added as a moderator before using this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        if (isAppealsThread || isAppealsParentChannel) {
            if (!interaction.channel?.isThread?.()) {
                return interaction.editReply('Use this command inside an Appeals thread so the same questionnaire detection applies.');
            }

            const result = await client.scanAppealsThread(interaction.channel, { interaction });
            if (result?.sentCount) {
                return interaction.editReply(`Appeals thread scan completed and sent **${result.sentCount}** Roblox info embed${result.sentCount === 1 ? '' : 's'}.`);
            }
            return interaction.editReply('Appeals thread scan completed using the Appeals questionnaire detection, but no valid Roblox user was found.');
        }

        const result = await client.scanTicketThread(interaction.channel, {
            force: true,
            interaction,
            trelloUserId: interaction.user.id
        });

        if (result?.sentCount) {
            return interaction.editReply(`Scanned this ticket and sent **${result.sentCount}** private Roblox info embed${result.sentCount === 1 ? '' : 's'}.`);
        }

        return interaction.editReply('No valid Roblox usernames or numeric IDs were found in this ticket questionnaire.');
    }
};
