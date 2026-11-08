const { MessageType } = require('discord.js');

const BLACKLIST_LISTS = new Set(['blacklist', 'tb duels blacklist']);
const REPORTED_MESSAGE = 'The exploiter you reported is already banned, thank you for reporting!';

function findTicketOpenerId(messages, reportsBotId) {
    const memberAddedMessages = [...(messages?.values?.() || [])]
        .filter(message => message.type === MessageType.ThreadMemberUpdate
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

async function notifyAndCloseDuplicate({ thread, opener, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    let dmSent = false;
    try {
        await opener.send(REPORTED_MESSAGE);
        dmSent = true;
    } catch (error) {
        console.error(`Could not DM duplicate-report opener ${opener.id} for ticket ${thread.id}:`, error);
    }

    await thread.send({
        content: `<@${opener.id}> ${REPORTED_MESSAGE} (Ticket closing in 30 seconds.)`,
        allowedMentions: { users: [opener.id] }
    });
    await delay(30_000);
    await thread.setLocked(true, 'Reported Roblox user is already on the Trello blacklist');
    await thread.setArchived(true, 'Reported Roblox user is already on the Trello blacklist');
    return { closed: true, dmSent };
}

module.exports = { REPORTED_MESSAGE, findTicketOpenerId, findBlacklistCard, notifyAndCloseDuplicate };
