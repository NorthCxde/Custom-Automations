const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

const OWNER_ID = '1486503754617323530';

module.exports = {
    name: 'deletemymessages',
    description: 'Delete your messages in a channel from the last 14 days',
    data: new SlashCommandBuilder()
        .setName('deletemymessages')
        .setDescription('Delete your messages in a channel from the last 14 days')
        .setDefaultMemberPermissions(0)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to clean up')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),
    async executeInteraction({ client, interaction }) {
        if (interaction.user.id !== OWNER_ID) return;
        if (!interaction.guild) {
            return interaction.reply({ content: 'This must be used in a server.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        const yesId = `dmm_yes_${interaction.id}`;
        const noId = `dmm_no_${interaction.id}`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(yesId).setLabel('Yes').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(noId).setLabel('No').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: `Warning: if you continue, I will delete all of your messages in <#${channel.id}> from the past 14 days.`,
            components: [row],
            ephemeral: true
        });

        const collector = interaction.channel.createMessageComponentCollector({
            filter: i => i.user.id === OWNER_ID && [yesId, noId].includes(i.customId),
            max: 1,
            time: 60_000
        });

        collector.on('collect', async (btn) => {
            await btn.deferUpdate();

            if (btn.customId === noId) {
                await interaction.editReply({ content: 'This command has been ended.', components: [] });
                return;
            }

            await interaction.editReply({
                content: `Starting deletion of your messages in <#${channel.id}> from the last 14 days...`,
                components: []
            });

            const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
            let deleted = 0;
            let scanned = 0;
            let lastId = null;

            while (true) {
                const fetchOptions = { limit: 100 };
                if (lastId) fetchOptions.before = lastId;

                const messages = await channel.messages.fetch(fetchOptions).catch(() => null);
                if (!messages || messages.size === 0) break;

                const arr = [...messages.values()];
                scanned += arr.length;
                lastId = arr[arr.length - 1].id;

                const mine = arr.filter(m => m.author.id === OWNER_ID && m.createdTimestamp >= cutoff);

                if (mine.length >= 2) {
                    const bulk = await channel.bulkDelete(mine, true).catch(() => null);
                    if (bulk) deleted += bulk.size;
                } else if (mine.length === 1) {
                    const success = await mine[0].delete().catch(() => null);
                    if (success) deleted += 1;
                }

                if (arr[arr.length - 1].createdTimestamp < cutoff || messages.size < 100) break;
            }

            await interaction.editReply({
                content: `Deleted ${deleted} of your messages from <#${channel.id}>. Scanned ${scanned} messages from the last 14 days.`
            });
        });

        collector.on('end', (collected) => {
            if (collected.size === 0) {
                interaction.editReply({ content: 'This command has been ended.', components: [] }).catch(() => null);
            }
        });
    }
};
