const { SlashCommandBuilder, ChannelType, PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'forumping',
    description: 'Configure a role to automatically ping when a new post is created in a forum channel.',
    data: new SlashCommandBuilder()
        .setName('forumping')
        .setDescription('Configure a role to automatically ping when a new post is created in a forum channel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Ping a role whenever a new post is created in a forum channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The forum channel to watch')
                        .addChannelTypes(ChannelType.GuildForum, ChannelType.GuildMedia)
                        .setRequired(true))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('The role to ping in each new post')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Stop pinging a role for new posts in a forum channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The forum channel to stop watching')
                        .addChannelTypes(ChannelType.GuildForum, ChannelType.GuildMedia)
                        .setRequired(true))),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: 'You need Manage Server permission to configure forum pings.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const channel = interaction.options.getChannel('channel', true);

        if (subcommand === 'clear') {
            const removed = client.clearForumPing(interaction.guild.id, channel.id);
            return interaction.reply({
                content: removed
                    ? `Forum ping removed for ${channel}.`
                    : `${channel} did not have a forum ping configured.`,
                ephemeral: true
            });
        }

        const role = interaction.options.getRole('role', true);
        client.setForumPing(interaction.guild.id, channel.id, role.id);

        return interaction.reply({
            content: `${role} will now be pinged whenever a new post is created in ${channel}.`,
            ephemeral: true
        });
    }
};
