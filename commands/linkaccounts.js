const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'linkaccounts',
    description: 'Link a main Discord account with alternate accounts for shared infractions.',
    data: new SlashCommandBuilder()
        .setName('linkaccounts')
        .setDescription('Link accounts so they share infraction progression.')
        .addUserOption(option => option
            .setName('main')
            .setDescription('The main account for this linked group')
            .setRequired(true))
        .addUserOption(option => option
            .setName('alt')
            .setDescription('An alternate account to link')
            .setRequired(true))
        .addUserOption(option => option
            .setName('alt2')
            .setDescription('Another alternate account to link')
            .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const main = interaction.options.getUser('main', true);
        const alt = interaction.options.getUser('alt', true);
        const alt2 = interaction.options.getUser('alt2');
        const altIds = [alt.id, alt2?.id].filter(Boolean);

        if (altIds.includes(main.id)) {
            return interaction.reply({ content: 'The main account cannot also be an alternate account.', ephemeral: true });
        }

        const linkedIds = client.linkAccounts(
            interaction.guild.id,
            main.id,
            altIds,
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
