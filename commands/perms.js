const { ActionRowBuilder, RoleSelectMenuBuilder, PermissionsBitField, SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'perms',
    data: new SlashCommandBuilder()
        .setName('perms')
        .setDescription('Configure which roles can use the bot commands.')
        .setDefaultMemberPermissions(0n),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: 'Only users with Manage Server permission can configure allowed roles.', ephemeral: true });
        }

        const existingRoles = client.getAllowedRoleIds(interaction.guild.id) || new Set();

        const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('perms-role-select')
                .setPlaceholder('Select roles that can use bot commands')
                .setMinValues(0)
                .setMaxValues(25)
                .setDefaultRoles(Array.from(existingRoles))
        );

        return interaction.reply({
            content: 'Select the roles that should be allowed to use the bot commands. If you select no roles, command access will be restricted to server admins only.',
            components: [row],
            ephemeral: true
        });
    }
};
