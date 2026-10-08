const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'dm',
    description: 'Send a silent DM to a user.',
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a DM to a user silently.')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The message to send')
                .setRequired(true)
                .setMaxLength(2000)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to DM (choose this or a role)')
                .setRequired(false)
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('DM everyone with this role (choose this or a user)')
                .setRequired(false)
        )
        .setDMPermission(false),
    async executeInteraction({ interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: 'You need Manage Server to use this command.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const targetRole = interaction.options.getRole('role');
        const dmText = String(interaction.options.getString('message', true) || '').trim();

        if (!dmText) {
            return interaction.reply({ content: 'Please provide a message to send.', ephemeral: true });
        }

        if (Boolean(targetUser) === Boolean(targetRole)) {
            return interaction.reply({ content: 'Choose exactly one target: a user or a role.', ephemeral: true });
        }

        if (targetRole) {
            await interaction.deferReply({ ephemeral: true });

            let members;
            try {
                members = await interaction.guild.members.fetch();
            } catch (error) {
                console.error('Failed to fetch guild members for role DM:', error);
                return interaction.editReply('I could not load the server member list, so no DMs were sent.');
            }

            const recipients = [...members.values()].filter(member =>
                !member.user.bot && member.roles.cache.has(targetRole.id)
            );
            if (!recipients.length) {
                return interaction.editReply(`No human members currently have the ${targetRole} role.`);
            }

            let sent = 0;
            let failed = 0;
            for (let index = 0; index < recipients.length; index += 5) {
                const batch = recipients.slice(index, index + 5);
                const results = await Promise.allSettled(batch.map(member =>
                    member.send({
                        content: dmText,
                        allowedMentions: { parse: [] }
                    })
                ));
                for (const result of results) {
                    if (result.status === 'fulfilled') sent++;
                    else failed++;
                }
            }

            return interaction.editReply(
                `Role DM complete for ${targetRole}: sent to ${sent} of ${recipients.length} members.`
                + (failed ? ` ${failed} could not receive DMs (likely due to privacy settings).` : '')
            );
        }

        try {
            await targetUser.send(dmText);
            return interaction.reply({ content: `✅ DM sent to <@${targetUser.id}>.`, ephemeral: true });
        } catch (error) {
            console.error('Failed to send DM:', error);
            return interaction.reply({ content: 'Unable to send a DM to that user. They may have DMs disabled.', ephemeral: true });
        }
    }
};
