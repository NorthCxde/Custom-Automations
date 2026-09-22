const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const ROBLOX_USERS_API = 'https://users.roblox.com/v1';
const ROBLOX_THUMBNAILS_API = 'https://thumbnails.roblox.com/v1';
const ROBLOX_INVENTORY_API = 'https://inventory.roblox.com/v1';

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

function formatCreatedDate(value) {
    const timestamp = Math.floor(new Date(value).getTime() / 1000);
    if (!Number.isFinite(timestamp)) return 'Unknown';
    return `<t:${timestamp}:F>`;
}

function formatDescription(description) {
    const text = String(description || '').trim();
    return text ? text.slice(0, 1024) : '• None';
}

function buildInfoEmbed(user, avatarUrl, canViewInventory) {
    const username = String(user.name || 'Unknown');
    const displayName = String(user.displayName || username);
    const userId = String(user.id);

    const embed = new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle(`${displayName} (${userId})`)
        .setThumbnail(avatarUrl || null)
        .addFields(
            { name: 'Roblox Information', value: `@${username}`, inline: false },
            { name: 'Account Created', value: formatCreatedDate(user.created), inline: false },
            { name: 'Description', value: formatDescription(user.description), inline: false },
            { name: 'Game Activity', value: canViewInventory ? 'Inventory is public' : '🔒 Inventory is private', inline: false },
            { name: 'Trello Cards', value: '• None', inline: false }
        )
        .setTimestamp();

    return embed;
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
            await interaction.deferReply();
            const input = interaction.options.getString('user', true);
            const user = await resolveUser(input);
            const [avatarUrl, canViewInventory] = await Promise.all([
                fetchAvatarUrl(user.id),
                fetchInventoryPrivacy(user.id)
            ]);

            return interaction.editReply({
                embeds: [buildInfoEmbed(user, avatarUrl, canViewInventory)]
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
    }
};
