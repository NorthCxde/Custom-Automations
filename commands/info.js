const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

const ROBLOX_USERS_API = 'https://users.roblox.com/v1';
const ROBLOX_THUMBNAILS_API = 'https://thumbnails.roblox.com/v1';
const ROBLOX_INVENTORY_API = 'https://inventory.roblox.com/v1';
const TRELLO_BOARD_ID = 'QpzzqyE8';
const TRELLO_LIST_NAMES = ['Blacklist', 'TB Duels Blacklist'];
const TIMEBOMB_BADGE_ID = '2142457718';
const CUSTOM_MINIGAMES_BADGE_ID = '2124646244';

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Roblox request failed with status ${response.status}`);
    }
    return response.json();
}

async function resolveUser(input) {
    const value = String(input || '').trim();
    if (!value) throw new Error('A Roblox username or user ID is required.');

    if (/^\d+$/.test(value)) {
        return fetchJson(`${ROBLOX_USERS_API}/users/${value}`);
    }

    const result = await fetchJson(`${ROBLOX_USERS_API}/usernames/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [value], excludeBannedUsers: false })
    });

    const user = result?.data?.[0];
    if (!user?.id) throw new Error(`No Roblox user was found for \\"${value}\\".`);
    return fetchJson(`${ROBLOX_USERS_API}/users/${user.id}`);
}

async function fetchAvatarUrl(userId) {
    const result = await fetchJson(
        `${ROBLOX_THUMBNAILS_API}/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`
    );
    return result?.data?.[0]?.imageUrl || null;
}

async function fetchInventoryPrivacy(userId) {
    try {
        const result = await fetchJson(`${ROBLOX_INVENTORY_API}/users/${userId}/can-view-inventory`);
        return result?.canView === true;
    } catch {
        return false;
    }
}

async function ownsBadge(userId, badgeId) {
    try {
        const result = await fetchJson(`${ROBLOX_INVENTORY_API}/users/${userId}/items/Badge/${badgeId}`);
        return Array.isArray(result?.data) && result.data.some(item => String(item.id) === badgeId);
    } catch {
        return false;
    }
}

async function fetchGameActivity(userId) {
    const canViewInventory = await fetchInventoryPrivacy(userId);
    if (!canViewInventory) return '🔒 Inventory is private';

    const [hasTimebombBadge, hasCustomMinigamesBadge] = await Promise.all([
        ownsBadge(userId, TIMEBOMB_BADGE_ID),
        ownsBadge(userId, CUSTOM_MINIGAMES_BADGE_ID)
    ]);

    const history = [];
    if (hasTimebombBadge) history.push('✅ Has played Timebomb Duels');
    if (hasCustomMinigamesBadge) history.push('✅ Has played Custom Minigames');
    return history.length ? history.join('\n') : '❌ No game history';
}

async function fetchExistingTrelloCards(userId, discordUserId) {
    const { getRegisteredCredentials } = require('./trelloCredentials');
    const credentials = getRegisteredCredentials(discordUserId);
    if (!credentials) return [];

    const auth = new URLSearchParams({ key: credentials.key, token: credentials.token });
    const listsResponse = await fetch(`https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/lists?fields=id,name&${auth}`);
    if (!listsResponse.ok) throw new Error(`Trello list lookup failed with status ${listsResponse.status}`);

    const lists = await listsResponse.json();
    const matchingCards = [];
    for (const listName of TRELLO_LIST_NAMES) {
        const list = lists.find(entry => String(entry.name || '').trim().toLowerCase() === listName.toLowerCase());
        if (!list) continue;

        const cardsResponse = await fetch(`https://api.trello.com/1/lists/${list.id}/cards?fields=id,name,shortUrl,url,due&${auth}`);
        if (!cardsResponse.ok) throw new Error(`Trello card lookup failed with status ${cardsResponse.status}`);

        const cards = await cardsResponse.json();
        for (const card of cards) {
            if (String(card.name || '').trim() !== String(userId)) continue;
            const url = String(card.shortUrl || card.url || '').trim();
            if (url) matchingCards.push({
                id: String(card.id || ''),
                listName,
                url,
                due: card.due || null
            });
        }
    }

    return matchingCards;
}

function formatCreatedDate(value) {
    const timestamp = Math.floor(new Date(value).getTime() / 1000);
    if (!Number.isFinite(timestamp)) return 'Unknown';
    return `<t:${timestamp}:F>`;
}

function formatDescription(description) {
    const text = String(description || '').trim();
    if (!text) return '• None';
    if (text.length <= 100) return text;
    return `${text.slice(0, 100)}...`;
}

function formatDueCountdown(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const remainingDays = Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    if (remainingDays <= 0) return 'Ended';
    return `Ends in ${remainingDays} day${remainingDays === 1 ? '' : 's'}`;
}

function buildInfoEmbed(user, avatarUrl, gameActivity, trelloCards = []) {
    const username = String(user.name || 'Unknown');
    const displayName = String(user.displayName || username);
    const userId = String(user.id);
    const profileDescription = formatDescription(user.description);
    const gameNameMap = {
        blacklist: 'Custom Minigames',
        'tb duels blacklist': 'Timebomb Duels'
    };
    const trelloCardLines = trelloCards.length
        ? trelloCards.map(card => {
            const gameName = gameNameMap[String(card.listName || '').trim().toLowerCase()] || card.listName;
            const dueDate = formatDueCountdown(card.due);
            return `• [${gameName}](${card.url})${dueDate ? ` (${dueDate})` : ''}`;
        }).join('\n')
        : '• None';
    const embedDescription = [
        '**Roblox Information**',
        `@${username}`,
        '',
        '**Account Created**',
        formatCreatedDate(user.created),
        '',
        '**Description**',
        profileDescription,
        '',
        '**Game Activity**',
        gameActivity,
        '',
        '**Trello Cards**',
        trelloCardLines
    ].join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle(`${displayName} (${userId})`)
        .setThumbnail(avatarUrl || null)
        .setDescription(embedDescription);

    return embed;
}

async function fetchInfoData(userId, discordUserId) {
    const user = await fetchJson(`${ROBLOX_USERS_API}/users/${userId}`);
    const [avatarUrl, gameActivity, trelloCards] = await Promise.all([
        fetchAvatarUrl(user.id),
        fetchGameActivity(user.id),
        fetchExistingTrelloCards(user.id, discordUserId)
    ]);
    return { user, avatarUrl, gameActivity, trelloCards };
}

function buildInfoComponents(userId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`info_blacklist_menu:${userId}`)
                .setLabel('Ban')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`info_unban_menu:${userId}`)
                .setLabel('Unban')
                .setStyle(ButtonStyle.Secondary)
        )
    ];
}

module.exports = {
    name: 'info',
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Get Roblox information for a user ID or username.')
        .addStringOption(option =>
            option
                .setName('user')
                .setDescription('Roblox user ID or username')
                .setRequired(true)
        ),
    async executeInteraction({ interaction }) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const input = interaction.options.getString('user', true);
            const user = await resolveUser(input);
            const { avatarUrl, gameActivity, trelloCards } = await fetchInfoData(user.id, interaction.user.id);

            return interaction.editReply({
                embeds: [buildInfoEmbed(user, avatarUrl, gameActivity, trelloCards)],
                components: buildInfoComponents(user.id)
            });
        } catch (err) {
            console.error('Failed to fetch Roblox user info:', err);
            const message = err.message?.includes('No Roblox user was found')
                ? err.message
                : 'I could not find that Roblox user right now.';

            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({ content: message, ephemeral: true });
            }
            return interaction.editReply({ content: message });
        }
    },
    fetchInfoData,
    buildInfoEmbed,
    buildInfoComponents,
    fetchExistingTrelloCards
};
