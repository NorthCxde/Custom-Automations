const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'linkaccounts',
    description: 'Add or remove a linked alternate account.',
    data: new SlashCommandBuilder()
        .setName('linkaccounts')
        .setDescription('Add or remove an alternate account from a linked group.')
        .addUserOption(option => option
            .setName('account')
            .setDescription('The main account for this linked group')
            .setRequired(true))
        .addUserOption(option => option
            .setName('alt')
            .setDescription('The alternate account to add or remove')
            .setRequired(true))
        .addStringOption(option => option
            .setName('action')
            .setDescription('Add or remove the alternate account')
            .setRequired(true)
            .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'Remove', value: 'remove' }
            )),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const account = interaction.options.getUser('account', true);
        const alt = interaction.options.getUser('alt', true);
        const action = interaction.options.getString('action', true);

        if (account.id === alt.id) {
            return interaction.reply({ content: 'The account and alternate cannot be the same user.', ephemeral: true });
        }

        if (action === 'remove') {
            const remainingIds = client.unlinkAccount(interaction.guild.id, account.id, alt.id);
            if (!remainingIds) {
                return interaction.reply({ content: 'That alternate is not linked to the selected account.', ephemeral: true });
            }
            return interaction.reply({
                content: `Removed <@${alt.id}> from <@${account.id}>'s linked account group.`,
                ephemeral: true
            });
        }

        const linkedIds = client.linkAccounts(
            interaction.guild.id,
            account.id,
            [alt.id],
            interaction.user.id
        );

        if (!linkedIds) {
            return interaction.reply({ content: 'Those accounts could not be linked.', ephemeral: true });
        }

        return interaction.reply({
            content: `Linked ${linkedIds.map(id => `<@${id}>`).join(', ')} into one infraction group.`,
            ephemeral: true
        });
    }
};
