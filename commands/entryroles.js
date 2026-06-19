const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'entryroles',
    description: 'Manage preset giveaway bonus-entry roles.',
    data: new SlashCommandBuilder()
        .setName('entryroles')
        .setDescription('Manage preset giveaway bonus-entry roles.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add or update a preset bonus-entry role')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role to grant bonus entries')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('extra_entries')
                        .setDescription('Extra entries for this role (1-50)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(50)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a preset bonus-entry role')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role to remove from presets')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List preset bonus-entry roles')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear all preset bonus-entry roles')
        ),

    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: 'Only users with Manage Server can edit entry roles.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const role = interaction.options.getRole('role', true);
            const extraEntries = interaction.options.getInteger('extra_entries', true);

            client.upsertGiveawayEntryRole(interaction.guildId, role.id, extraEntries);
            return interaction.reply({
                content: `Saved preset: ${role} gets +${extraEntries} entries.`,
                ephemeral: true
            });
        }

        if (subcommand === 'remove') {
            const role = interaction.options.getRole('role', true);
            const removed = client.removeGiveawayEntryRole(interaction.guildId, role.id);

            return interaction.reply({
                content: removed
                    ? `Removed preset for ${role}.`
                    : `${role} was not in the preset entry-role list.`,
                ephemeral: true
            });
        }

        if (subcommand === 'clear') {
            client.clearGiveawayEntryRoles(interaction.guildId);
            return interaction.reply({ content: 'Cleared all preset giveaway entry roles.', ephemeral: true });
        }

        const rules = client.getGiveawayEntryRoles(interaction.guildId);
        if (!rules.length) {
            return interaction.reply({
                content: 'No preset entry roles set yet. Use `/entryroles add` first.',
                ephemeral: true
            });
        }

        const lines = rules
            .slice()
            .sort((a, b) => b.extraEntries - a.extraEntries)
            .map(item => `<@&${item.roleId}>: +${item.extraEntries}`);

        return interaction.reply({
            content: `Preset giveaway entry roles:\n${lines.join('\n')}`,
            ephemeral: true
        });
    }
};