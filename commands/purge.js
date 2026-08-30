const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'purge',
    description: 'Delete messages',
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete messages')
        .addSubcommand(sub =>
            sub
                .setName('any')
                .setDescription('Delete any message type.')
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Number of messages to delete. Limit 1000')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub
                .setName('user')
                .setDescription('Delete messages that were sent by this user')
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Number of messages to delete. Limit 1000')
                        .setRequired(true))
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user whose messages should be deleted')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub
                .setName('bots')
                .setDescription('Delete messages that were sent by bots.')
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Number of messages to delete. Limit 1000')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub
                .setName('humans')
                .setDescription('Delete messages that were sent by humans (non-bots)')
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Number of messages to delete. Limit 1000')
                        .setRequired(true))),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: 'You need the Manage Messages permission to use this command.', ephemeral: true });
        }

        if (!interaction.channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: 'I need Manage Messages permission to delete messages.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const count = interaction.options.getInteger('count');

        if (!count || count < 1 || count > 1000) {
            const limit = 1000;
            return interaction.reply({ content: `Please provide a number between 1 and ${limit} for the count.`, ephemeral: true });
        }

        try {
            let allMessages = new Map();
            let lastId = null;
            const batchSize = 100;
            const targetFetchSize = Math.min(count * 2, 1000);
            
            while (allMessages.size < targetFetchSize) {
                const fetchOptions = { limit: batchSize };
                if (lastId) fetchOptions.before = lastId;
                const batch = await interaction.channel.messages.fetch(fetchOptions);
                if (batch.size === 0) break;
                batch.forEach((msg, id) => allMessages.set(id, msg));
                lastId = batch.last().id;
            }

            let candidates = [];

            if (subcommand === 'any') {
                candidates = Array.from(allMessages.values()).slice(0, count);
            } else if (subcommand === 'user') {
                const targetUser = interaction.options.getUser('user');
                candidates = Array.from(allMessages.values()).filter(msg => msg.author.id === targetUser.id).slice(0, count);
            } else if (subcommand === 'bots') {
                candidates = Array.from(allMessages.values()).filter(msg => msg.author.bot === true).slice(0, count);
            } else if (subcommand === 'humans') {
                candidates = Array.from(allMessages.values()).filter(msg => msg.author.bot === false).slice(0, count);
            }

            if (candidates.length === 0) {
                let noMessagesText = 'No recent messages were found to delete.';
                if (subcommand === 'user') noMessagesText = 'No recent messages from that user were found to delete.';
                else if (subcommand === 'bots') noMessagesText = 'No recent messages from bots were found to delete.';
                else if (subcommand === 'humans') noMessagesText = 'No recent messages from humans were found to delete.';
                return interaction.reply({ content: noMessagesText, ephemeral: true });
            }

            await interaction.channel.bulkDelete(candidates, true);

            const targetUser = subcommand === 'user' ? interaction.options.getUser('user') : null;
            let userTag = 'Any';
            if (subcommand === 'user') userTag = targetUser.tag;
            else if (subcommand === 'bots') userTag = 'Bots';
            else if (subcommand === 'humans') userTag = 'Humans';

            await client.addModLog(interaction.guild.id, {
                action: 'Purge',
                userId: targetUser ? targetUser.id : null,
                userTag: userTag,
                moderatorId: interaction.user.id,
                moderatorTag: interaction.user.tag,
                reason: `Deleted ${candidates.length} messages`,
                count: candidates.length,
                channelId: interaction.channel.id,
                timestamp: new Date().toISOString()
            });

            let filterText = 'Any message type';
            if (subcommand === 'user') filterText = `Messages from <@${targetUser.id}>`;
            else if (subcommand === 'bots') filterText = 'Messages from bots';
            else if (subcommand === 'humans') filterText = 'Messages from humans (non-bots)';

            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle(`Purge Action`)
                .setDescription(`Case by ${interaction.user.tag}`)
                .addFields(
                    { name: 'Deleted', value: `${candidates.length} message(s)`, inline: true },
                    { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Channel', value: `<#${interaction.channel.id}>`, inline: false },
                    { name: 'Filter', value: filterText, inline: false },
                    { name: 'Target IDs', value: targetUser ? targetUser.id : 'N/A', inline: false }
                )
                .setTimestamp();

            await client.logToChannel(interaction.guild, { embeds: [embed] });

            let replyText = `Purged ${candidates.length} message(s).`;
            if (subcommand === 'user') replyText = `Purged ${candidates.length} message(s) from <@${targetUser.id}>.`;
            else if (subcommand === 'bots') replyText = `Purged ${candidates.length} message(s) from bots.`;
            else if (subcommand === 'humans') replyText = `Purged ${candidates.length} message(s) from humans.`;

            return interaction.reply({ content: replyText, ephemeral: true });
        } catch (error) {
            console.error('[Purge Error]', error.message || error);
            return interaction.reply({ content: `Unable to purge messages: ${error.message || 'Unknown error. Check bot logs.'}`, ephemeral: true });
        }
    }
};
