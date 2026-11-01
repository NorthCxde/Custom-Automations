const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    escapeMarkdown
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

    const isNumeric = /^\d+$/.test(value);

    if (isNumeric) {
        try {
            const usernameResult = await fetchJson(`${ROBLOX_USERS_API}/usernames/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usernames: [value], excludeBannedUsers: false })
            });

            const usernameMatch = usernameResult?.data?.find(user =>
                typeof user?.name === 'string' && user.name.toLowerCase() === value.toLowerCase()
            );

            if (usernameMatch?.id) {
                return fetchJson(`${ROBLOX_USERS_API}/users/${usernameMatch.id}`);
            }
        } catch (error) {
            // Fall through to numeric ID lookup if the username endpoint rejects the input.
        }

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
    const { getEffectiveCredentials } = require('./trelloCredentials');
    const credentials = getEffectiveCredentials(discordUserId);
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
    const timestamp = Math.floor(date.getTime() / 1000);
    return `Ends <t:${timestamp}:R>`;
}

function buildInfoEmbed(user, avatarUrl, gameActivity, trelloCards = [], { showTrelloCards = true } = {}) {
    const username = String(user.name || 'Unknown');
    const displayName = String(user.displayName || '').trim();
    const titleName = displayName && displayName !== username ? `${displayName} (@${username})` : username;
    const userId = String(user.id);
    const profileUrl = `https://www.roblox.com/users/${userId}/profile`;
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
    const usernameLink = `[${username}](${profileUrl})`;
    const embedDescription = [
        '**Roblox Information**',
        `${usernameLink} (${userId})`,
        '',
        '**Account Created**',
        formatCreatedDate(user.created),
        '',
        '**Description**',
        profileDescription,
        '',
        '**Game Activity**',
        gameActivity
    ].join('\n');

    const description = showTrelloCards
        ? `${embedDescription}\n\n**Trello Cards**\n${trelloCardLines}`
        : embedDescription;

    const embed = new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle(titleName)
        .setThumbnail(avatarUrl || null)
        .setDescription(description);

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

async function searchDisplayName(input) {
    const displayName = input.trim();
    const users = [];
    const seenIds = new Set();
    const seenCursors = new Set();
    const signal = AbortSignal.timeout(30000);
    let cursor = null;
    let limited = false;
    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({ keyword: displayName, limit: '100' });
        if (cursor) params.set('cursor', cursor);
        const result = await fetchJson(`${ROBLOX_USERS_API}/users/search?${params}`, { signal });
        if (!Array.isArray(result.data) ||
            (result.nextPageCursor != null && typeof result.nextPageCursor !== 'string')) {
            throw new Error('Roblox returned invalid user-search results');
        }
        for (const user of result.data) {
            if (!Number.isSafeInteger(user.id) || user.id <= 0 ||
                typeof user.name !== 'string' || typeof user.displayName !== 'string') {
                throw new Error('Roblox returned an invalid user-search entry');
            }
            if (user.displayName.toLowerCase() !== displayName.toLowerCase() || seenIds.has(user.id)) continue;
            seenIds.add(user.id);
            users.push({ id: user.id, name: user.name });
            if (users.length === 75) break;
        }
        cursor = result.nextPageCursor;
        if (users.length === 75) {
            limited = true;
            break;
        }
        if (!cursor) break;
        if (seenCursors.has(cursor)) throw new Error('Roblox repeated a user-search page cursor');
        seenCursors.add(cursor);
        if (page === 9) limited = true;
    }
    return { displayName, users, limited };
}

function buildDisplayNamePage(result, page, interactionId) {
    const pageCount = Math.max(1, Math.ceil(result.users.length / 25));
    const start = page * 25;
    const lines = result.users.slice(start, start + 25).map((user, index) =>
        `${start + index + 1}. [${escapeMarkdown(user.name)}](https://www.roblox.com/users/${user.id}/profile) - ${user.id}`);
    const embed = new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle(`Display Name: ${result.displayName}`)
        .setDescription(lines.length ? lines.join('\n') : 'No exact display-name matches were found in the searched results.')
        .setFooter({
            text: `Page ${page + 1}/${pageCount} | ${result.users.length} exact matches${result.limited ? ' | Search limit reached' : ''}. Roblox search may omit accounts.`
        });
    const components = pageCount > 1 ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`info_display_back:${interactionId}`)
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`info_display_next:${interactionId}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === pageCount - 1)
    )] : [];
    return { content: '', embeds: [embed], components };
}

async function showDisplayNameSearch(interaction, displayName) {
    let result;
    try {
        result = await searchDisplayName(displayName);
    } catch (error) {
        console.error('Failed to search Roblox display names:', error);
        await interaction.editReply({
            content: 'Roblox display-name search failed or timed out. Please try again later.',
            embeds: [], components: []
        });
        return;
    }
    let page = 0;
    const message = await interaction.editReply(buildDisplayNamePage(result, page, interaction.id));
    if (result.users.length <= 25) return;
    const backId = `info_display_back:${interaction.id}`;
    const nextId = `info_display_next:${interaction.id}`;
    const collector = message.createMessageComponentCollector({
        filter: button => button.user.id === interaction.user.id && [backId, nextId].includes(button.customId),
        time: 5 * 60 * 1000
    });
    collector.on('collect', async button => {
        page = Math.max(0, Math.min(Math.ceil(result.users.length / 25) - 1,
            page + (button.customId === nextId ? 1 : -1)));
        try {
            await button.update(buildDisplayNamePage(result, page, interaction.id));
        } catch (error) {
            console.error('Failed to update Roblox display-name results:', error);
            collector.stop('error');
            try {
                await interaction.followUp({ content: 'Could not change search pages. Run /info again.', flags: MessageFlags.Ephemeral });
            } catch (replyError) {
                console.error('Failed to send display-name pagination error:', replyError);
            }
        }
    });
    collector.on('end', async () => {
        try {
            await interaction.editReply({ components: [] });
        } catch (error) {
            console.error('Failed to remove expired display-name search buttons:', error);
        }
    });
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
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('display_name')
                .setDescription('Display Name: find up to 75 users with this exact Roblox display name')
                .setMaxLength(20)
                .setRequired(false)
        ),
    async executeInteraction({ interaction }) {
        try {
            const input = interaction.options.getString('user')?.trim();
            const displayName = interaction.options.getString('display_name')?.trim();
            if ((!input && !displayName) || (input && displayName)) {
                return interaction.reply({
                    content: 'Provide either user (username/ID) or display_name, but not both.',
                    flags: MessageFlags.Ephemeral
                });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (displayName) return await showDisplayNameSearch(interaction, displayName);
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
    resolveUser,
    fetchInfoData,
    buildInfoEmbed,
    buildInfoComponents,
    fetchExistingTrelloCards,
    searchDisplayName,
    buildDisplayNamePage
};
