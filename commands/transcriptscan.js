const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');

const TRANSCRIPT_CHANNEL_ID = '964450455247794246';
const PAGE_SIZE = 25;

function getOpenedBy(embed) {
    const fields = (embed.fields || []).filter(field =>
        /(?:^|\s)opened\s+by\s*$/i.test(String(field.name || '').trim())
    );
    if (fields.length !== 1) return null;
    const match = String(fields[0].value || '').trim().match(/^<@!?(\d{17,20})>$/);
    return match ? match[1] : null;
}

async function scanTranscripts(channel, limit) {
    const counts = new Map();
    let scanned = 0;
    let unrecognized = 0;
    let before;
    while (scanned < limit) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!messages.size) break;
        const ordered = [...messages.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0);
        for (const message of ordered) {
            for (const embed of message.embeds || []) {
                if (!/^ticket closed$/i.test(String(embed.title || '').trim())) continue;
                scanned++;
                const userId = getOpenedBy(embed);
                if (userId) counts.set(userId, (counts.get(userId) || 0) + 1);
                else unrecognized++;
                if (scanned === limit) break;
            }
            if (scanned === limit) break;
        }
        const oldest = ordered[ordered.length - 1].id;
        if (before && BigInt(oldest) >= BigInt(before)) throw new Error('Transcript message pagination did not advance.');
        before = oldest;
        if (messages.size < 100) break;
    }
    return {
        scanned, unrecognized,
        rankings: [...counts.entries()]
            .map(([userId, count]) => ({ userId, count }))
            .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId))
    };
}

function buildPage(result, listLimit, page, interactionId) {
    const rankings = result.rankings.slice(0, listLimit);
    const pageCount = Math.max(1, Math.ceil(rankings.length / PAGE_SIZE));
    const lines = rankings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
        .map((row, index) => `${page * PAGE_SIZE + index + 1}. <@${row.userId}> — **${row.count}** ticket(s)`);
    const embed = new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle('Top ticket openers')
        .setDescription(lines.length ? lines.join('\n') : 'No recognizable ticket openers were found.')
        .setFooter({
            text: `Scanned ${result.scanned} transcript embed(s) | ${result.unrecognized} without a recognizable opener | Page ${page + 1}/${pageCount}`
        });
    const components = pageCount > 1 ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`transcriptscan_back:${interactionId}`)
            .setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`transcriptscan_next:${interactionId}`)
            .setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page === pageCount - 1)
    )] : [];
    return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

module.exports = {
    name: 'transcriptscan',
    data: new SlashCommandBuilder()
        .setName('transcriptscan')
        .setDescription('Rank ticket openers from the latest transcript embeds.')
        .addIntegerOption(option => option.setName('count').setDescription('Number of recent transcript embeds to scan')
            .setRequired(true).setMinValue(1).setMaxValue(10000))
        .addIntegerOption(option => option.setName('list').setDescription('Number of top ticket openers to show')
            .setRequired(true).setMinValue(1).setMaxValue(100)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
        }
        if (!client.isMemberAllowed(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
        }
        const count = interaction.options.getInteger('count', true);
        const list = interaction.options.getInteger('list', true);
        if (!Number.isInteger(count) || count < 1 || count > 10000
            || !Number.isInteger(list) || list < 1 || list > 100) {
            return interaction.reply({ content: 'Count must be 1–10,000 and list must be 1–100.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let result;
        try {
            const channel = await client.channels.fetch(TRANSCRIPT_CHANNEL_ID);
            if (!channel?.isTextBased?.() || !channel.messages?.fetch || channel.guildId !== interaction.guildId) {
                throw new Error('Transcript channel is unavailable in this server.');
            }
            result = await scanTranscripts(channel, count);
        } catch (error) {
            console.error('Failed to scan transcript messages:', error);
            return interaction.editReply('Could not scan transcripts. Check the bot’s access to the transcript channel and try again.');
        }
        let page = 0;
        const message = await interaction.editReply(buildPage(result, list, page, interaction.id));
        const pageCount = Math.ceil(Math.min(result.rankings.length, list) / PAGE_SIZE);
        if (pageCount <= 1) return;
        const backId = `transcriptscan_back:${interaction.id}`;
        const nextId = `transcriptscan_next:${interaction.id}`;
        const collector = message.createMessageComponentCollector({
            filter: button => button.user.id === interaction.user.id && [backId, nextId].includes(button.customId),
            time: 5 * 60 * 1000
        });
        collector.on('collect', async button => {
            const nextPage = Math.max(0, Math.min(pageCount - 1, page + (button.customId === nextId ? 1 : -1)));
            try {
                await button.update(buildPage(result, list, nextPage, interaction.id));
                page = nextPage;
            } catch (error) {
                console.error('Failed to update transcript scan results:', error);
                collector.stop('error');
                try {
                    await interaction.followUp({ content: 'Could not change pages. Run /transcriptscan again.', flags: MessageFlags.Ephemeral });
                } catch (replyError) {
                    console.error('Failed to report transcript pagination error:', replyError);
                }
            }
        });
        collector.on('end', async () => {
            try {
                await interaction.editReply({ components: [] });
            } catch (error) {
                console.error('Failed to remove expired transcript scan buttons:', error);
            }
        });
    },
    getOpenedBy,
    scanTranscripts,
    buildPage
};
