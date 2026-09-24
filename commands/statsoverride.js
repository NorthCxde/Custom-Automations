const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    name: 'statsoverride',
    data: new SlashCommandBuilder()
        .setName('statsoverride')
        .setDescription('Set or remove a moderator ban count for the current month.')
        .addStringOption(option => option
            .setName('action')
            .setDescription('Choose whether to set or remove the override.')
            .setRequired(true)
            .addChoices(
                { name: 'Set', value: 'set' },
                { name: 'Remove', value: 'remove' }
            ))
        .addStringOption(option => option
            .setName('moderator')
            .setDescription('Discord user ID of the moderator.')
            .setRequired(true))
        .addIntegerOption(option => option
            .setName('bans')
            .setDescription('September/current-month ban count.')
            .setMinValue(0)
            .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        const moderatorId = interaction.options.getString('moderator', true).trim();
        const action = interaction.options.getString('action', true);
        const bans = interaction.options.getInteger('bans');

        if (!/^\d{17,20}$/.test(moderatorId)) {
            return interaction.reply({ content: 'Provide a valid Discord user ID.', flags: MessageFlags.Ephemeral });
        }
        if (action === 'set' && bans === null) {
            return interaction.reply({ content: 'The bans value is required when setting an override.', flags: MessageFlags.Ephemeral });
        }

        const statsCommand = client.slashCommands.get('stats') || require('./stats');
        const { year, month } = statsCommand.getMonthRange(new Date());
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        const guildOverrides = client.statsOverrides.get(interaction.guildId) || new Map();
        const monthOverrides = guildOverrides.get(monthKey) || new Map();

        if (action === 'remove') {
            monthOverrides.delete(moderatorId);
        } else {
            // Store the gap between the real logged count and the desired total, so the
            // override lands on "bans" right now and still grows as new bans are logged.
            const logs = client.getModLogs(interaction.guildId) || [];
            const currentRealCount = statsCommand.getCurrentMonthBans(logs)
                .filter(entry => String(entry.moderatorId || '').trim() === moderatorId).length;
            monthOverrides.set(moderatorId, bans - currentRealCount);
        }

        if (monthOverrides.size) guildOverrides.set(monthKey, monthOverrides);
        else guildOverrides.delete(monthKey);
        if (guildOverrides.size) client.statsOverrides.set(interaction.guildId, guildOverrides);
        else client.statsOverrides.delete(interaction.guildId);
        client.saveStatsOverrides();

        return interaction.reply({
            content: action === 'remove'
                ? `Removed the ${monthKey} stats override for <@${moderatorId}>.`
                : `Set <@${moderatorId}> to **${bans}** bans for ${monthKey}.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { users: [moderatorId] }
        });
    }
};