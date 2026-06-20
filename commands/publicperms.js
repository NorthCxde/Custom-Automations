const { SlashCommandBuilder, RoleSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    name: 'publicperms',
    description: 'Configure which roles are treated as public users for public commands.',
    data: new SlashCommandBuilder()
        .setName('publicperms')
        .setDescription('Configure which roles are treated as public users for public commands.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Select roles that can use public commands')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear public role restrictions (all members can use public commands)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View currently configured public roles')
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            const allowed = client.getPublicRoleIds(interaction.guild.id);
            if (allowed === null) {
                return interaction.reply({
                    content: 'Public commands are currently available to all members (no role restrictions set).',
                    ephemeral: true
                });
            }

            if (allowed.size === 0) {
                return interaction.reply({
                    content: 'No public roles are set. Only server admins/managers can use public commands.',
                    ephemeral: true
                });
            }

            const mentions = Array.from(allowed).map(roleId => `<@&${roleId}>`).join(', ');
            return interaction.reply({
                content: `Public command roles: ${mentions}`,
                ephemeral: true
            });
        }

        if (subcommand === 'clear') {
            client.publicAllowedRoles.delete(interaction.guild.id);
            client.savePublicPermissions();
            return interaction.reply({
                content: 'Public role restrictions cleared. Public commands are now available to all members.',
                ephemeral: true
            });
        }

        const existing = client.getPublicRoleIds(interaction.guild.id);
        const defaultValues = existing && existing.size ? Array.from(existing) : [];

        const roleMenu = new RoleSelectMenuBuilder()
            .setCustomId('publicperms_role_select')
            .setPlaceholder('Select roles that should be treated as public users')
            .setMinValues(0)
            .setMaxValues(25)
            .setDefaultRoles(defaultValues);

        const row = new ActionRowBuilder().addComponents(roleMenu);
        const saveRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('publicperms_save')
                .setLabel('Save')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('publicperms_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        const draftKey = `${interaction.guild.id}:${interaction.user.id}`;
        client.publicPermDrafts = client.publicPermDrafts || new Map();
        client.publicPermDrafts.set(draftKey, { selectedRoleIds: defaultValues });

        return interaction.reply({
            content: 'Select roles for public commands, then click Save.',
            components: [row, saveRow],
            ephemeral: true
        });
    }
};
