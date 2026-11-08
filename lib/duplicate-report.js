const {
    MessageType, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const CLOSE_DELAY_MS = 30_000;

const BLACKLIST_LISTS = new Set(['blacklist', 'tb duels blacklist']);
const REPORTED_MESSAGE = 'The exploiter you reported is already banned, thank you for reporting!';

function findTicketOpenerId(messages, reportsBotId) {
    const memberAddedMessages = [...(messages?.values?.() || [])]
        .filter(message => message.type === MessageType.RecipientAdd
            && message.author?.id === reportsBotId)
        .sort((left, right) => left.createdTimestamp - right.createdTimestamp);
    for (const message of memberAddedMessages) {
        const opener = message.mentions?.users?.find(user => user.id !== reportsBotId);
        if (opener) return opener.id;
    }
    return null;
}

function findBlacklistCard(cards) {
    return cards.find(card => BLACKLIST_LISTS.has(String(card.listName || '').trim().toLowerCase())) || null;
}

function shouldAutoCloseDuplicate({ isAutomaticTicket, interaction, openerId, sentEmbedCount }) {
    return isAutomaticTicket === true
        && !interaction
        && Boolean(openerId)
        && sentEmbedCount === 1;
}

async function waitForCloseDecision(message, customId) {
    const collector = message.createMessageComponentCollector({
        time: CLOSE_DELAY_MS,
        filter: interaction => interaction.customId === customId
    });
    return new Promise(resolve => {
        let cancelled = false;
        let handling = false;
        collector.on('collect', async interaction => {
            if (handling) return;
            handling = true;
            try {
                await interaction.update({
                    content: `${interaction.message.content}\n\nAutomatic closure cancelled. You can add more evidence to this ticket.`,
                    components: []
                });
                cancelled = true;
                collector.stop('cancelled');
            } catch (error) {
                handling = false;
                console.error(`Failed to cancel automatic closure for ticket ${interaction.channelId || 'unknown'}:`, error);
                try {
                    await interaction.followUp({
                        content: 'I could not cancel the automatic closure. Please ask a moderator to keep the ticket open.',
                        ephemeral: true
                    });
                } catch (replyError) {
                    console.error('Failed to report the closure-cancellation error:', replyError);
                }
            }
        });
        collector.on('end', async (_collected, reason) => {
            if (reason === 'time') {
                try {
                    await message.edit({ components: [] });
                } catch (error) {
                    console.error('Failed to remove expired duplicate-ticket cancellation button:', error);
                }
            }
            resolve(cancelled && reason === 'cancelled');
        });
    });
}

async function notifyAndCloseDuplicate({
    thread, opener, waitForDecision = waitForCloseDecision
}) {
    let dmSent = false;
    try {
        await opener.send(REPORTED_MESSAGE);
        dmSent = true;
    } catch (error) {
        console.error(`Could not DM duplicate-report opener ${opener.id} for ticket ${thread.id}:`, error);
    }

    const closesAt = Math.floor((Date.now() + CLOSE_DELAY_MS) / 1000);
    const customId = `duplicate_report_keep_open:${thread.id}`;
    const notice = await thread.send({
        content: `<@${opener.id}> ${REPORTED_MESSAGE} (Ticket closing <t:${closesAt}:R>.)`,
        allowedMentions: { users: [opener.id] },
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel("Don't Close")
                .setStyle(ButtonStyle.Danger)
        )]
    });
    if (await waitForDecision(notice, customId)) {
        return { closed: false, cancelled: true, dmSent };
    }
    await thread.setLocked(true, 'Reported Roblox user is already on the Trello blacklist');
    await thread.setArchived(true, 'Reported Roblox user is already on the Trello blacklist');
    return { closed: true, dmSent };
}

module.exports = {
    REPORTED_MESSAGE, findTicketOpenerId, findBlacklistCard,
    shouldAutoCloseDuplicate, notifyAndCloseDuplicate, waitForCloseDecision, CLOSE_DELAY_MS
};
