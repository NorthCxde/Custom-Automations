const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const timers = require('node:timers/promises');

const LIST_NAMES = ['Blacklist', 'TB Duels Blacklist'];
const LIST_LABELS = { Blacklist: 'Custom Minigames', 'TB Duels Blacklist': 'Timebomb Duels' };
const drafts = new Map();
const DRAFT_TTL = 10 * 60 * 1000;

function buildBlacklistMenu(userId, draftId = null) {
    const row = new ActionRowBuilder().addComponents(
        LIST_NAMES.map(listName => new ButtonBuilder()
            .setCustomId(draftId
                ? `info_blacklist_week_add:${userId}:${listName}:${draftId}`
                : `info_blacklist_add:${userId}:${listName}`)
            .setLabel(LIST_LABELS[listName])
            .setStyle(ButtonStyle.Danger))
    );
    if (!draftId) {
        row.addComponents(new ButtonBuilder()
            .setCustomId(`info_blacklist_week:${userId}`)
            .setLabel('1 Week')
            .setStyle(ButtonStyle.Success));
    }
    return row;
}

async function handleWeekInteraction(client, interaction) {
    const isButton = interaction.isButton();
    const isModal = interaction.isModalSubmit();
    if (!(isButton && interaction.customId.startsWith('info_blacklist_week:')) &&
        !(isModal && interaction.customId.startsWith('info_blacklist_week_comment:'))) return false;

    if (!client.isManuallyAddedModerator(interaction.user.id)) {
        await interaction.reply({ content: 'You must be manually added as a moderator before using this action.', ephemeral: true });
        return true;
    }
    const userId = interaction.customId.split(':')[1];
    if (!/^\d+$/.test(userId)) {
        await interaction.reply({ content: 'Invalid Roblox user ID. Run /info again.', ephemeral: true });
        return true;
    }
    if (isButton) {
        const modal = new ModalBuilder()
            .setCustomId(`info_blacklist_week_comment:${userId}`)
            .setTitle('1 Week Blacklist');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('blacklist_comment')
            .setLabel('Trello comment')
            .setPlaceholder('Context for this one-week blacklist')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000)));
        await interaction.showModal(modal);
        return true;
    }

    const comment = interaction.fields.getTextInputValue('blacklist_comment').trim();
    if (!comment || comment.length > 4000) {
        await interaction.reply({ content: 'Enter a Trello comment between 1 and 4000 characters.', ephemeral: true });
        return true;
    }
    const draftId = interaction.id;
    drafts.set(draftId, {
        userId, comment, ownerId: interaction.user.id, guildId: interaction.guildId,
        expiresAt: Date.now() + DRAFT_TTL
    });
    const timer = setTimeout(() => drafts.delete(draftId), DRAFT_TTL);
    timer.unref();
    await interaction.reply({
        content: `Choose blacklist type for: **${userId}** (1 week). Your comment will be added to the card.`,
        components: [buildBlacklistMenu(userId, draftId)],
        ephemeral: true
    });
    return true;
}

function getBlacklistRequest(interaction) {
    const [prefix, userId, listName, draftId] = interaction.customId.split(':');
    if (!/^\d+$/.test(userId) || !LIST_NAMES.includes(listName)) {
        throw new Error('Invalid blacklist selection. Run /info again.');
    }
    if (prefix === 'info_blacklist_add') return { userId, listName, days: 14, comment: null };
    const draft = drafts.get(draftId);
    if (prefix !== 'info_blacklist_week_add' || !draft || draft.expiresAt <= Date.now()) {
        if (draft) drafts.delete(draftId);
        throw new Error('This one-week blacklist request expired or was already used. Choose 1 Week again.');
    }
    if (draft.ownerId !== interaction.user.id || draft.guildId !== interaction.guildId || draft.userId !== userId) {
        throw new Error('This blacklist request belongs to another moderator or server.');
    }
    drafts.delete(draftId);
    return { userId, listName, days: 7, comment: draft.comment };
}

async function createBlacklistCard(credentials, listId, userId, days) {
    const dueDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
        idList: listId, name: userId, due: dueDate,
        key: credentials.key, token: credentials.token
    });
    const response = await fetch(`https://api.trello.com/1/cards?${params}`, { method: 'POST' });
    if (!response.ok) throw new Error(`Trello card creation failed with status ${response.status}`);
    return { card: await response.json(), dueDate };
}

async function addBlacklistComment(credentials, cardId, comment) {
    if (!cardId) throw new Error('Trello did not return a card ID for the comment');
    const response = await fetch(`https://api.trello.com/1/cards/${cardId}/actions/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ key: credentials.key, token: credentials.token, text: comment })
    });
    if (!response.ok) throw new Error(`Trello comment creation failed with status ${response.status}`);
}

async function setBlacklistDueDate(credentials, cardId, dueDate) {
    if (!cardId) throw new Error('Trello did not return a card ID for the due-date update');
    const response = await fetch(`https://api.trello.com/1/cards/${cardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            key: credentials.key, token: credentials.token, due: dueDate, dueComplete: 'false'
        })
    });
    if (!response.ok) throw new Error(`Trello due-date update failed with status ${response.status}`);
    const card = await response.json();
    if (new Date(card.due).getTime() !== new Date(dueDate).getTime()) {
        throw new Error('Trello did not retain the requested blacklist due date');
    }
}

async function verifyBlacklistDueDate(credentials, cardId, dueDate) {
    if (!cardId) throw new Error('Trello did not return a card ID for the due-date verification');
    const auth = new URLSearchParams({
        key: credentials.key, token: credentials.token, fields: 'due'
    });
    // Board automation can overwrite a date after the create/update response.
    let confirmations = 0;
    for (let check = 0; check < 6; check++) {
        await timers.setTimeout(5000);
        const response = await fetch(`https://api.trello.com/1/cards/${cardId}?${auth}`);
        if (!response.ok) throw new Error(`Trello due-date verification failed with status ${response.status}`);
        const card = await response.json();
        if (new Date(card.due).getTime() === new Date(dueDate).getTime()) {
            confirmations++;
            if (confirmations === 2) return;
            continue;
        }
        confirmations = 0;
        if (check === 5) throw new Error('Trello kept overriding the one-week due date during verification');
        await setBlacklistDueDate(credentials, cardId, dueDate);
    }
    throw new Error('Trello did not confirm the one-week due date twice within 30 seconds');
}

module.exports = {
    buildBlacklistMenu, handleWeekInteraction, getBlacklistRequest,
    createBlacklistCard, addBlacklistComment, setBlacklistDueDate, verifyBlacklistDueDate
};
