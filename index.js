const config = require("./config.json");
const normalizeToken = (value) => String(value || '').trim().replace(/^['\"]|['\"]$/g, '');
const configToken = normalizeToken(config.token);
const envToken = normalizeToken(process.env.DISCORD_TOKEN);
const token = configToken || envToken;
const tokenSource = configToken ? 'config.json' : (envToken ? 'DISCORD_TOKEN env' : 'none');
const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    ApplicationCommandPermissionType,
    ActivityType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    MessageType,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    UserSelectMenuBuilder,
    ChannelType,
    Routes
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { DEFAULT_INFRACTION_RULES, sanitizeInfractionRules, cloneInfractionRules, cloneInfractionRule, parseDurationMs } = require('./infractions');

if (!token) {
    throw new Error("Missing Discord token. Set DISCORD_TOKEN or add token to config.json.");
}

if (envToken && configToken && envToken !== configToken) {
    console.warn('DISCORD_TOKEN differs from config token; using config.json token for startup stability.');
}

const prefix = "?";
const HARD_CODED_ADMINS = [
    // Put your user IDs here. Only these users will be able to see /perms and /logs.
    '1486503754617323530',
    '841491704305811496',
    '1335476704407191563',
    '582686715702018078'
];
const STATIC_HARD_CODED_ADMINS = [...HARD_CODED_ADMINS];

const trelloApiKey = String(config.trelloApiKey || process.env.TRELLO_API_KEY || '').trim();
const trelloToken = String(config.trelloToken || process.env.TRELLO_TOKEN || '').trim();
const trelloBoardId = String(config.trelloBoardId || process.env.TRELLO_BOARD_ID || '').trim();
const trelloAdminListName = String(config.trelloAdminListName || process.env.TRELLO_ADMIN_LIST_NAME || 'Hard Coded Admins').trim();
const trelloModeratorPermListName = String(config.trelloModeratorPermListName || process.env.TRELLO_MODERATOR_PERM_LIST_NAME || 'Moderator Level Perms').trim();
const configuredTrelloSyncMs = Number(config.trelloSyncIntervalMs || process.env.TRELLO_SYNC_INTERVAL_MS || 300000);
const trelloSyncIntervalMs = Number.isFinite(configuredTrelloSyncMs)
    ? Math.max(30000, configuredTrelloSyncMs)
    : 300000;
const STATIC_MODERATOR_LEVEL_PERM_ROLE_NAMES = [];

const HQ_GUILD_ID_DEFAULT = '1512252919423176875';
const HQ_PERMS_LOG_CHANNEL_ID_DEFAULT = '1517292575239704907';
const HQ_GLOBAL_LOG_CHANNEL_ID_DEFAULT = '1517325234712219718';
const BOOT_MARKER = 'trello-perms-sync-v3';

function trelloRequestJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`Trello request failed (${res.statusCode}): ${data.slice(0, 300)}`));
                }
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(new Error(`Failed to parse Trello response: ${err.message}`));
                }
            });
        }).on('error', reject);
    });
}

function trelloPostJson(url) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request({
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port,
            path: `${parsed.pathname}${parsed.search}`,
            method: 'POST'
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`Trello POST failed (${res.statusCode}): ${data.slice(0, 300)}`));
                }
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(new Error(`Failed to parse Trello POST response: ${err.message}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function extractDiscordIdsFromText(text) {
    const ids = String(text || '').match(/\b\d{17,20}\b/g);
    return ids ? ids.map(String) : [];
}

function extractTrelloRoleNamesFromText(text) {
    return String(text || '')
        .split(/[\n,;]+/g)
        .map(part => part.trim())
        .map(part => part.replace(/^[*\-•\d.):-]+\s*/g, '').trim())
        .filter(Boolean);
}

function collectConfiguredPermRoleNames() {
    const names = new Set();

    for (const [guildId, roleSet] of client.allowedRoles.entries()) {
        if (!roleSet || roleSet.size === 0) continue;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        for (const roleId of roleSet) {
            const role = guild.roles.cache.get(roleId);
            if (!role?.name) continue;
            names.add(String(role.name).trim().toLowerCase());
        }
    }

    return names;
}

function setsAreEqual(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    if (left.size !== right.size) return false;
    for (const value of left) {
        if (!right.has(value)) return false;
    }
    return true;
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Map();
const commandsPath = path.join(__dirname, "commands");
const dataPath = path.join(__dirname, "data");
const permsFile = path.join(dataPath, "perms.json");
const logsFile = path.join(dataPath, "logs.json");
const modLogsFile = path.join(dataPath, "modlogs.json");
const bloxlinkFile = path.join(dataPath, "bloxlink.json");
const bloxlinkHistoryFile = path.join(dataPath, "bloxlinkHistory.json");
const boostChannelFile = path.join(dataPath, "boostchannel.json");
const prefixStateFile = path.join(dataPath, "prefix-state.json");
const autorespondersFile = path.join(dataPath, "autoresponders.json");
const automodFile = path.join(dataPath, "automod.json");
const giveawaysFile = path.join(dataPath, "giveaways.json");
const entryRolesFile = path.join(dataPath, "entryroles.json");
const infractionsFile = path.join(dataPath, "infractions.json");
const manualLogsChannelsFile = path.join(dataPath, "manualLogsChannels.json");
const publicPermsFile = path.join(dataPath, "publicperms.json");

client.allowedRoles = new Map();
client.logChannels = new Map();
client.modLogs = new Map();
client.boostChannels = new Map();
client.pendingModerationActions = new Map();
client.pendingPermsUndoActions = new Map();
client.pendingGlobalModUndoActions = new Map();
client.bloxlink = new Map();
client.bloxlinkHistory = new Map();
client.bloxlinkRateLimitUntilByGuild = new Map();
client.bloxlinkRateLimitNoticeUntilByGuild = new Map();
client.bloxlinkLogCooldownByKey = new Map();
client.slashCommands = new Map();
client.autoresponders = new Map();
client.autoresponderDrafts = new Map();
client.autoresponderCooldowns = new Map();
client.automodRules = new Map();
client.automodDrafts = new Map();
client.automodMessageBuckets = new Map();
client.automodMentionBuckets = new Map();
client.giveaways = new Map();
client.giveawayTimers = new Map();
client.giveawayDrafts = new Map();
client.entryRoles = new Map();
client.infractionRules = new Map();
client.modStatsOverrides = new Map();
client.manualLogsChannels = new Map();
client.publicAllowedRoles = new Map();
client.prefixCommandsEnabled = false; // default; can be changed with /enablecommands and is persisted
client.prefixCommandReactionEmojiId = '1356003566925512934'; // Emoji ID for prefix command responses
client.banStickerId = '1480253710969082108';
client.hardcodedAdmins = new Set(STATIC_HARD_CODED_ADMINS);
client.trelloModeratorLevelPermRoleNames = new Set(STATIC_MODERATOR_LEVEL_PERM_ROLE_NAMES.map(name => String(name).toLowerCase()));
client.publicCommandNames = new Set(['profile']);

client.applyHardcodedAdmins = (ids = []) => {
    const merged = [...new Set([...STATIC_HARD_CODED_ADMINS.map(String), ...ids.map(String)])];
    client.hardcodedAdmins = new Set(merged);
    HARD_CODED_ADMINS.splice(0, HARD_CODED_ADMINS.length, ...merged);
    return merged;
};

client.applyModeratorLevelPermRoleNames = (names = []) => {
    const merged = [...new Set([
        ...STATIC_MODERATOR_LEVEL_PERM_ROLE_NAMES.map(name => String(name).toLowerCase()),
        ...names.map(name => String(name).toLowerCase())
    ])];
    client.trelloModeratorLevelPermRoleNames = new Set(merged);
    return merged;
};

client.ensureModeratorPermCardsByRoleNames = async (roleNames = []) => {
    if (!trelloApiKey || !trelloToken || !trelloBoardId) {
        return { enabled: false, trelloRoleNames: new Set(), createdCards: 0, source: 'static-only' };
    }

    const normalizedRoleNames = [...new Set(roleNames.map(name => String(name || '').trim().toLowerCase()).filter(Boolean))];
    const listsUrl = `https://api.trello.com/1/boards/${encodeURIComponent(trelloBoardId)}/lists?fields=id,name&key=${encodeURIComponent(trelloApiKey)}&token=${encodeURIComponent(trelloToken)}`;
    const lists = await trelloRequestJson(listsUrl);
    const targetList = Array.isArray(lists)
        ? lists.find(list => String(list?.name || '').trim().toLowerCase() === trelloModeratorPermListName.toLowerCase())
        : null;

    if (!targetList?.id) {
        return { enabled: true, trelloRoleNames: new Set(), createdCards: 0, source: 'trello-missing-list', listName: trelloModeratorPermListName };
    }

    const cardsUrl = `https://api.trello.com/1/lists/${encodeURIComponent(targetList.id)}/cards?fields=name,desc&key=${encodeURIComponent(trelloApiKey)}&token=${encodeURIComponent(trelloToken)}`;
    const cards = await trelloRequestJson(cardsUrl);
    const trelloRoleNames = new Set();

    if (Array.isArray(cards)) {
        for (const card of cards) {
            for (const roleName of extractTrelloRoleNamesFromText(card?.name)) trelloRoleNames.add(roleName.toLowerCase());
            for (const roleName of extractTrelloRoleNamesFromText(card?.desc)) trelloRoleNames.add(roleName.toLowerCase());
        }
    }

    let createdCards = 0;
    for (const roleName of normalizedRoleNames) {
        if (trelloRoleNames.has(roleName)) continue;

        const createCardUrl = `https://api.trello.com/1/cards?idList=${encodeURIComponent(targetList.id)}&name=${encodeURIComponent(roleName)}&desc=${encodeURIComponent('Auto-created from bot moderator level perms')}&key=${encodeURIComponent(trelloApiKey)}&token=${encodeURIComponent(trelloToken)}`;
        try {
            await trelloPostJson(createCardUrl);
            trelloRoleNames.add(roleName);
            createdCards += 1;
        } catch (err) {
            console.error(`Failed to create Trello moderator perm card for ${roleName}:`, err.message || err);
        }
    }

    return {
        enabled: true,
        trelloRoleNames,
        createdCards,
        listName: trelloModeratorPermListName,
        listId: targetList.id
    };
};

client.syncAllowedRolesFromModeratorPermNames = (roleNames = []) => {
    const normalizedRoleNames = new Set(roleNames.map(name => String(name || '').trim().toLowerCase()).filter(Boolean));
    let changedGuildCount = 0;

    for (const [guildId, currentRoleSet] of client.allowedRoles.entries()) {
        if (currentRoleSet === null) continue;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const nextRoleSet = new Set(
            Array.from(guild.roles.cache.values())
                .filter(role => normalizedRoleNames.has(String(role.name || '').trim().toLowerCase()))
                .map(role => role.id)
        );

        if (setsAreEqual(currentRoleSet, nextRoleSet)) continue;

        client.allowedRoles.set(guildId, nextRoleSet);
        changedGuildCount += 1;
    }

    if (changedGuildCount > 0) {
        client.savePermissions();
    }

    return changedGuildCount;
};

client.refreshHardcodedAdminsFromTrello = async () => {
    if (!trelloApiKey || !trelloToken || !trelloBoardId) {
        client.applyHardcodedAdmins([]);
        return { enabled: false, total: client.hardcodedAdmins.size, source: 'static-only' };
    }

    const listsUrl = `https://api.trello.com/1/boards/${encodeURIComponent(trelloBoardId)}/lists?fields=id,name&key=${encodeURIComponent(trelloApiKey)}&token=${encodeURIComponent(trelloToken)}`;
    const lists = await trelloRequestJson(listsUrl);
    const targetList = Array.isArray(lists)
        ? lists.find(list => String(list?.name || '').trim().toLowerCase() === trelloAdminListName.toLowerCase())
        : null;

    if (!targetList?.id) {
        client.applyHardcodedAdmins([]);
        return { enabled: true, total: client.hardcodedAdmins.size, source: 'trello-missing-list', listName: trelloAdminListName };
    }

    const cardsUrl = `https://api.trello.com/1/lists/${encodeURIComponent(targetList.id)}/cards?fields=name,desc&key=${encodeURIComponent(trelloApiKey)}&token=${encodeURIComponent(trelloToken)}`;
    const cards = await trelloRequestJson(cardsUrl);
    const trelloIds = new Set();

    if (Array.isArray(cards)) {
        for (const card of cards) {
            for (const id of extractDiscordIdsFromText(card?.name)) trelloIds.add(id);
            for (const id of extractDiscordIdsFromText(card?.desc)) trelloIds.add(id);
        }
    }

    const missingStaticIds = STATIC_HARD_CODED_ADMINS
        .map(String)
        .filter(id => !trelloIds.has(id));

    let createdCards = 0;
    for (const adminId of missingStaticIds) {
        const createCardUrl = `https://api.trello.com/1/cards?idList=${encodeURIComponent(targetList.id)}&name=${encodeURIComponent(adminId)}&desc=${encodeURIComponent('Auto-created from bot static hard coded admins')}&key=${encodeURIComponent(trelloApiKey)}&token=${encodeURIComponent(trelloToken)}`;
        try {
            await trelloPostJson(createCardUrl);
            trelloIds.add(adminId);
            createdCards += 1;
        } catch (err) {
            console.error(`Failed to create Trello admin card for ${adminId}:`, err.message || err);
        }
    }

    const merged = client.applyHardcodedAdmins([...trelloIds]);
    client.trelloAdminListId = String(targetList.id);
    client.trelloHardcodedAdminsLastSyncAt = new Date().toISOString();

    return {
        enabled: true,
        total: merged.length,
        staticCount: STATIC_HARD_CODED_ADMINS.length,
        trelloCount: trelloIds.size,
        createdCards,
        listName: trelloAdminListName,
        listId: targetList.id
    };
};

client.refreshModeratorLevelPermsFromTrello = async () => {
    if (!trelloApiKey || !trelloToken || !trelloBoardId) {
        client.applyModeratorLevelPermRoleNames([]);
        return { enabled: false, total: client.trelloModeratorLevelPermRoleNames.size, source: 'static-only' };
    }

    const listsUrl = `https://api.trello.com/1/boards/${encodeURIComponent(trelloBoardId)}/lists?fields=id,name&key=${encodeURIComponent(trelloApiKey)}&token=${encodeURIComponent(trelloToken)}`;
    const lists = await trelloRequestJson(listsUrl);
    const targetList = Array.isArray(lists)
        ? lists.find(list => String(list?.name || '').trim().toLowerCase() === trelloModeratorPermListName.toLowerCase())
        : null;

    if (!targetList?.id) {
        client.applyModeratorLevelPermRoleNames([]);
        return { enabled: true, total: client.trelloModeratorLevelPermRoleNames.size, source: 'trello-missing-list', listName: trelloModeratorPermListName };
    }

    const cardsUrl = `https://api.trello.com/1/lists/${encodeURIComponent(targetList.id)}/cards?fields=name,desc&key=${encodeURIComponent(trelloApiKey)}&token=${encodeURIComponent(trelloToken)}`;
    const cards = await trelloRequestJson(cardsUrl);
    let trelloRoleNames = new Set();

    if (Array.isArray(cards)) {
        for (const card of cards) {
            for (const roleName of extractTrelloRoleNamesFromText(card?.name)) trelloRoleNames.add(roleName.toLowerCase());
            for (const roleName of extractTrelloRoleNamesFromText(card?.desc)) trelloRoleNames.add(roleName.toLowerCase());
        }
    }

    const configuredPermRoleNames = collectConfiguredPermRoleNames();

    let createdCards = 0;
    if (trelloRoleNames.size === 0 && configuredPermRoleNames.size > 0) {
        const seedResult = await client.ensureModeratorPermCardsByRoleNames([...configuredPermRoleNames]);
        if (seedResult.enabled && seedResult.trelloRoleNames instanceof Set) {
            trelloRoleNames = seedResult.trelloRoleNames;
            createdCards = seedResult.createdCards || 0;
        }
    }

    const syncedGuildCount = client.syncAllowedRolesFromModeratorPermNames([...trelloRoleNames]);
    const merged = client.applyModeratorLevelPermRoleNames([...trelloRoleNames]);
    const syncedConfiguredPermRoleNames = collectConfiguredPermRoleNames();
    client.trelloModeratorPermListId = String(targetList.id);
    client.trelloModeratorPermsLastSyncAt = new Date().toISOString();

    return {
        enabled: true,
        total: merged.length,
        staticCount: STATIC_MODERATOR_LEVEL_PERM_ROLE_NAMES.length,
        configuredPermCount: syncedConfiguredPermRoleNames.size,
        trelloCount: trelloRoleNames.size,
        createdCards,
        syncedGuildCount,
        listName: trelloModeratorPermListName,
        listId: targetList.id
    };
};

client.scheduleHardcodedAdminsSync = () => {
    const sync = async () => {
        try {
            console.log('Starting hardcoded admin Trello sync...');
            const result = await client.refreshHardcodedAdminsFromTrello();
            if (result.enabled) {
                console.log(`Hardcoded admin sync complete: total=${result.total}, static=${result.staticCount || 0}, trello=${result.trelloCount || 0}, created=${result.createdCards || 0}, list=${result.listName || 'unknown'}`);
            }
        } catch (err) {
            console.error('Failed to sync hardcoded admins from Trello:', err.message || err);
            client.applyHardcodedAdmins([]);
        }

        try {
            console.log('Starting moderator level perms Trello sync...');
            const permsResult = await client.refreshModeratorLevelPermsFromTrello();
            if (permsResult.enabled) {
                console.log(`Moderator level perms sync complete: total=${permsResult.total}, static=${permsResult.staticCount || 0}, configured=${permsResult.configuredPermCount || 0}, trello=${permsResult.trelloCount || 0}, created=${permsResult.createdCards || 0}, list=${permsResult.listName || 'unknown'}`);
            }
        } catch (err) {
            console.error('Failed to sync moderator level perms from Trello:', err.message || err);
            client.applyModeratorLevelPermRoleNames([]);
        }
    };

    sync().catch(() => null);
    setInterval(() => sync().catch(() => null), trelloSyncIntervalMs);
};

client.sendPrefixCommandResponse = async (channel, content, options = {}) => {
    try {
        if (!channel || typeof channel.send !== 'function') return null;

        const safeContent = typeof content === 'string' ? content.trim() : '';
        const payload = { ...options };

        if (safeContent.length > 0) {
            payload.content = safeContent;
        }

        if (!payload.allowedMentions) {
            payload.allowedMentions = {
                parse: [],
                users: [],
                roles: [],
                repliedUser: false
            };
        }

        const hasEmbeds = Array.isArray(payload.embeds) && payload.embeds.length > 0;
        const hasFiles = Array.isArray(payload.files) && payload.files.length > 0;
        const hasComponents = Array.isArray(payload.components) && payload.components.length > 0;
        if (!payload.content && !hasEmbeds && !hasFiles && !hasComponents) {
            return null;
        }

        return await channel.send(payload);
    } catch (error) {
        console.error('Failed to send prefix command response:', error);
        return null;
    }
};

client.sendActionStatusCard = async (channelOrId, text) => {
    try {
        let channel = channelOrId || null;
        if (typeof channel === 'string') {
            channel = await client.channels.fetch(channel).catch(() => null);
        } else if (channel && typeof channel.send !== 'function' && channel.id) {
            channel = await client.channels.fetch(channel.id).catch(() => null);
        }

        if (!channel || typeof channel.send !== 'function') return false;

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setDescription(`✅ ${text}`);

        await channel.send({
            embeds: [embed],
            allowedMentions: {
                parse: [],
                users: [],
                roles: [],
                repliedUser: false
            }
        });
        return true;
    } catch (error) {
        console.error('Failed to send action status card:', error);
        return false;
    }
};

client.sendBanSticker = async (channelOrId) => {
    try {
        const stickerId = String(client.banStickerId || '').trim();
        if (!stickerId) return false;

        let channel = channelOrId || null;
        if (typeof channel === 'string') {
            channel = await client.channels.fetch(channel).catch(() => null);
        } else if (channel && typeof channel.send !== 'function' && channel.id) {
            channel = await client.channels.fetch(channel.id).catch(() => null);
        }

        const channelId = channel?.id || (typeof channelOrId === 'string' ? channelOrId : channelOrId?.id);

        if (channel && typeof channel.send === 'function') {
            await channel.send({
                stickers: [stickerId],
                allowedMentions: {
                    parse: [],
                    users: [],
                    roles: [],
                    repliedUser: false
                }
            });
            console.log('sendBanSticker success via channel.send:', { channelId: channel.id, stickerId });
            return true;
        }

        if (channelId) {
            await client.rest.post(Routes.channelMessages(channelId), {
                body: {
                    stickers: [stickerId],
                    allowed_mentions: {
                        parse: [],
                        users: [],
                        roles: [],
                        replied_user: false
                    }
                }
            });
            console.log('sendBanSticker success via REST fallback:', { channelId, stickerId });
            return true;
        }

        console.warn('sendBanSticker skipped: no resolvable channel or channelId.');
        return false;
    } catch (error) {
        console.error('Failed to send ban sticker:', error);
        return false;
    }
};

client.sendModerationDm = async ({ user, userId, guildName, action, duration, reason }) => {
    try {
        const targetUser = user || (userId ? await client.users.fetch(userId) : null);
        if (!targetUser) return false;

        let content = null;
        const safeReason = reason || 'No reason provided';

        if (action === 'mute') {
            content = `You were muted in ${guildName} for ${duration}. | ${safeReason}`;
        } else if (action === 'ban') {
            content = `You were banned in ${guildName}. | ${safeReason}`;
        }

        if (!content) return false;
        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setDescription(content);

        await targetUser.send({ embeds: [embed] });
        return true;
    } catch (error) {
        return false;
    }
};

client.loadPrefixCommandState = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    if (!fs.existsSync(prefixStateFile)) {
        fs.writeFileSync(prefixStateFile, JSON.stringify({ enabled: false }, null, 2), 'utf8');
    }

    let parsed = { enabled: false };
    try {
        parsed = JSON.parse(fs.readFileSync(prefixStateFile, 'utf8') || '{"enabled":false}');
    } catch (err) {
        console.error('Failed to read prefix state file:', err);
    }

    client.prefixCommandsEnabled = Boolean(parsed.enabled);
};

client.savePrefixCommandState = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    fs.writeFileSync(prefixStateFile, JSON.stringify({ enabled: Boolean(client.prefixCommandsEnabled) }, null, 2), 'utf8');
};

client.loadAutoresponders = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    if (!fs.existsSync(autorespondersFile)) {
        fs.writeFileSync(autorespondersFile, '{}', 'utf8');
    }

    let raw = '{}';
    try {
        raw = fs.readFileSync(autorespondersFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read autoresponders file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse autoresponders file:', err);
    }

    client.autoresponders.clear();
    for (const [guildId, entries] of Object.entries(parsed)) {
        const normalized = Array.isArray(entries)
            ? entries
                .filter(entry => entry && typeof entry === 'object')
                .map((entry, index) => ({
                    id: String(entry.id || `ar_${Date.now()}_${index}`),
                    trigger: String(entry.trigger || '').trim(),
                    response: String(entry.response || ''),
                    enabled: entry.enabled !== false,
                    matchType: entry.matchType === 'exact' ? 'exact' : 'contains',
                    allowedChannelIds: Array.isArray(entry.allowedChannelIds) ? entry.allowedChannelIds.map(String) : [],
                    ignoredChannelIds: Array.isArray(entry.ignoredChannelIds) ? entry.ignoredChannelIds.map(String) : [],
                    allowedRoleIds: Array.isArray(entry.allowedRoleIds) ? entry.allowedRoleIds.map(String) : [],
                    ignoredRoleIds: Array.isArray(entry.ignoredRoleIds) ? entry.ignoredRoleIds.map(String) : [],
                    allowedUserIds: Array.isArray(entry.allowedUserIds) ? entry.allowedUserIds.map(String) : [],
                    ignoredUserIds: Array.isArray(entry.ignoredUserIds) ? entry.ignoredUserIds.map(String) : [],
                    createdBy: String(entry.createdBy || ''),
                    createdAt: String(entry.createdAt || new Date().toISOString())
                }))
                .filter(entry => entry.trigger.length > 0 && entry.response.length > 0)
            : [];

        client.autoresponders.set(guildId, normalized);
    }
};

client.saveAutoresponders = () => {
    const out = {};
    for (const [guildId, entries] of client.autoresponders.entries()) {
        out[guildId] = entries;
    }
    fs.writeFileSync(autorespondersFile, JSON.stringify(out, null, 2), 'utf8');
};

client.getAutoresponders = (guildId) => {
    if (!guildId) return [];
    return client.autoresponders.get(guildId) || [];
};

client.addAutoresponder = (guildId, entry) => {
    const existing = client.getAutoresponders(guildId);
    const next = [...existing, entry];
    client.autoresponders.set(guildId, next);
    client.saveAutoresponders();
};

client.upsertAutoresponder = (guildId, entry) => {
    const existing = client.getAutoresponders(guildId);
    const idx = existing.findIndex(item => item.id === entry.id);
    const next = [...existing];
    if (idx === -1) {
        next.push(entry);
    } else {
        next[idx] = { ...next[idx], ...entry };
    }
    client.autoresponders.set(guildId, next);
    client.saveAutoresponders();
};

client.deleteAutoresponder = (guildId, entryId) => {
    const existing = client.getAutoresponders(guildId);
    const next = existing.filter(item => item.id !== entryId);
    const deleted = next.length !== existing.length;
    if (!deleted) return false;
    client.autoresponders.set(guildId, next);
    client.saveAutoresponders();
    return true;
};

client.loadAutomodRules = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    if (!fs.existsSync(automodFile)) {
        fs.writeFileSync(automodFile, '{}', 'utf8');
    }

    let raw = '{}';
    try {
        raw = fs.readFileSync(automodFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read automod file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse automod file:', err);
    }

    client.automodRules.clear();
    for (const [guildId, entries] of Object.entries(parsed)) {
        const validTypes = new Set([
            'mentions_cooldown',
            'masked_links',
            'invite_links',
            'fast_message_spam',
            'anti_newline',
            'character_count',
            'zalgo_text',
            'word_blacklist',
            'emoji_spam',
            'anti_links',
            'keyword'
        ]);
        const validActions = new Set(['delete', 'delete_warn', 'timeout', 'kick', 'ban']);
        const normalizeActions = (raw, fallback) => {
            const source = Array.isArray(raw) ? raw : [raw || fallback || 'delete'];
            const values = [...new Set(source
                .map(v => String(v || '').trim().toLowerCase())
                .filter(v => validActions.has(v)))];
            return values.length ? values : ['delete'];
        };

        const normalized = Array.isArray(entries)
            ? entries
                .filter(entry => entry && typeof entry === 'object')
                .map((entry, index) => {
                    const action = String(entry.action || 'delete').trim().toLowerCase();
                    const type = String(entry.type || (entry.trigger ? 'keyword' : 'anti_links')).trim().toLowerCase();
                    const actions = normalizeActions(entry.actions, action);
                    return {
                        id: String(entry.id || `am_${Date.now()}_${index}`),
                        name: String(entry.name || '').trim() || String(type || 'Automod Rule').replace(/_/g, ' '),
                        type: validTypes.has(type) ? type : 'keyword',
                        trigger: String(entry.trigger || '').trim(),
                        enabled: entry.enabled !== false,
                        matchType: entry.matchType === 'exact' ? 'exact' : 'contains',
                        actions,
                        action: actions[0],
                        timeoutDuration: String(entry.timeoutDuration || '10m').trim() || '10m',
                        ignoreAdmins: entry.ignoreAdmins !== false,
                        allowedChannelIds: Array.isArray(entry.allowedChannelIds) ? entry.allowedChannelIds.map(String) : [],
                        ignoredChannelIds: Array.isArray(entry.ignoredChannelIds) ? entry.ignoredChannelIds.map(String) : [],
                        allowedRoleIds: Array.isArray(entry.allowedRoleIds) ? entry.allowedRoleIds.map(String) : [],
                        ignoredRoleIds: Array.isArray(entry.ignoredRoleIds) ? entry.ignoredRoleIds.map(String) : [],
                        allowedUserIds: Array.isArray(entry.allowedUserIds) ? entry.allowedUserIds.map(String) : [],
                        ignoredUserIds: Array.isArray(entry.ignoredUserIds) ? entry.ignoredUserIds.map(String) : [],
                        custom: entry.custom && typeof entry.custom === 'object' ? entry.custom : {},
                        logChannelId: String(entry.logChannelId || '').trim(),
                        customResponse: String(entry.customResponse || '').trim(),
                        createdBy: String(entry.createdBy || ''),
                        createdAt: String(entry.createdAt || new Date().toISOString())
                    };
                })
                .filter(entry => entry.type !== 'keyword' || entry.trigger.length > 0)
            : [];

        client.automodRules.set(guildId, normalized);
    }
};

client.saveAutomodRules = () => {
    const out = {};
    for (const [guildId, entries] of client.automodRules.entries()) {
        out[guildId] = entries;
    }
    fs.writeFileSync(automodFile, JSON.stringify(out, null, 2), 'utf8');
};

client.getAutomodRules = (guildId) => {
    if (!guildId) return [];
    return client.automodRules.get(guildId) || [];
};

client.upsertAutomodRule = (guildId, entry) => {
    const existing = client.getAutomodRules(guildId);
    const idx = existing.findIndex(item => item.id === entry.id);
    const next = [...existing];
    if (idx === -1) {
        next.push(entry);
    } else {
        next[idx] = { ...next[idx], ...entry };
    }
    client.automodRules.set(guildId, next);
    client.saveAutomodRules();
};

client.deleteAutomodRule = (guildId, entryId) => {
    const existing = client.getAutomodRules(guildId);
    const next = existing.filter(item => item.id !== entryId);
    const deleted = next.length !== existing.length;
    if (!deleted) return false;
    client.automodRules.set(guildId, next);
    client.saveAutomodRules();
    return true;
};

client.applyAutoresponderVariables = (template, message) => {
    let output = String(template || '');
    const guild = message.guild;
    const channel = message.channel;
    const user = message.author;
    const mentionedRoleIds = [];

    output = output.replace(/\{user\}/gi, `<@${user.id}>`);
    output = output.replace(/\{avatar\}/gi, user.displayAvatarURL({ size: 1024, extension: 'png' }));
    output = output.replace(/\{username\}/gi, user.username);
    output = output.replace(/\{usenname\}/gi, user.username);
    output = output.replace(/\{server\}/gi, guild?.name || 'Unknown Server');
    output = output.replace(/\{channel\}/gi, channel?.name || 'unknown-channel');
    output = output.replace(/\{&([^}]+)\}/g, (_, roleName) => {
        if (!guild) return roleName;
        const target = String(roleName || '').trim().toLowerCase();
        if (!target) return roleName;
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === target);
        if (!role) return roleName;
        mentionedRoleIds.push(role.id);
        return `<@&${role.id}>`;
    });

    return { output, mentionedRoleIds: [...new Set(mentionedRoleIds)] };
};

client.getAutoresponderDraftKey = (guildId, userId) => `${guildId}:${userId}`;

client.buildAutoresponderUserConfigPayload = (draft) => {
    const userMentions = (ids) => ids.length ? ids.map(id => `<@${id}>`).join(', ') : 'None';
    const embed = new EmbedBuilder()
        .setColor(0x2F3136)
        .setTitle('Autoresponder User Filters')
        .setDescription('Configure specific allowed or ignored users for this autoresponder.')
        .addFields(
            { name: 'Allowed Users', value: userMentions(draft.allowedUserIds), inline: false },
            { name: 'Ignored Users', value: userMentions(draft.ignoredUserIds), inline: false }
        );

    const allowedUsersMenu = new UserSelectMenuBuilder()
        .setCustomId('ar_allowed_users')
        .setPlaceholder('Allowed Users')
        .setMinValues(0)
        .setMaxValues(25);
    if (typeof allowedUsersMenu.setDefaultUsers === 'function' && draft.allowedUserIds.length) {
        allowedUsersMenu.setDefaultUsers(draft.allowedUserIds.slice(0, 25));
    }

    const ignoredUsersMenu = new UserSelectMenuBuilder()
        .setCustomId('ar_ignored_users')
        .setPlaceholder('Ignored Users')
        .setMinValues(0)
        .setMaxValues(25);
    if (typeof ignoredUsersMenu.setDefaultUsers === 'function' && draft.ignoredUserIds.length) {
        ignoredUsersMenu.setDefaultUsers(draft.ignoredUserIds.slice(0, 25));
    }

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(allowedUsersMenu),
            new ActionRowBuilder().addComponents(ignoredUsersMenu)
        ]
    };
};

client.buildAutoresponderConfigPayload = (draft) => {
    const channelMentions = (ids) => ids.length ? ids.map(id => `<#${id}>`).join(', ') : 'None';
    const roleMentions = (ids) => ids.length ? ids.map(id => `<@&${id}>`).join(', ') : 'None';
    const userMentions = (ids) => ids.length ? ids.map(id => `<@${id}>`).join(', ') : 'None';
    const responsePreview = draft.response.length > 180
        ? `${draft.response.slice(0, 177)}...`
        : draft.response;

    const embed = new EmbedBuilder()
        .setColor(0x2F3136)
        .setTitle('Autoresponder Setup')
        .setDescription('Configure filters, then press Save.')
        .addFields(
            { name: 'Trigger', value: `\`${draft.trigger}\``, inline: false },
            { name: 'Match Mode', value: draft.matchType === 'exact' ? 'Exact' : 'Contains', inline: true },
            { name: 'Enabled', value: draft.enabled ? 'Yes' : 'No', inline: true },
            { name: 'Response', value: responsePreview || 'No text', inline: false },
            { name: 'Allowed Channels', value: channelMentions(draft.allowedChannelIds), inline: false },
            { name: 'Ignored Channels', value: channelMentions(draft.ignoredChannelIds), inline: false },
            { name: 'Allowed Roles', value: roleMentions(draft.allowedRoleIds), inline: false },
            { name: 'Ignored Roles', value: roleMentions(draft.ignoredRoleIds), inline: false },
            { name: 'Allowed Users', value: userMentions(draft.allowedUserIds), inline: false },
            { name: 'Ignored Users', value: userMentions(draft.ignoredUserIds), inline: false }
        );

    const allowedChannelsMenu = new ChannelSelectMenuBuilder()
        .setCustomId('ar_allowed_channels')
        .setPlaceholder('Allowed Channels')
        .setMinValues(0)
        .setMaxValues(25)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    if (typeof allowedChannelsMenu.setDefaultChannels === 'function' && draft.allowedChannelIds.length) {
        allowedChannelsMenu.setDefaultChannels(draft.allowedChannelIds.slice(0, 25));
    }

    const ignoredChannelsMenu = new ChannelSelectMenuBuilder()
        .setCustomId('ar_ignored_channels')
        .setPlaceholder('Ignored Channels')
        .setMinValues(0)
        .setMaxValues(25)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    if (typeof ignoredChannelsMenu.setDefaultChannels === 'function' && draft.ignoredChannelIds.length) {
        ignoredChannelsMenu.setDefaultChannels(draft.ignoredChannelIds.slice(0, 25));
    }

    const allowedRolesMenu = new RoleSelectMenuBuilder()
        .setCustomId('ar_allowed_roles')
        .setPlaceholder('Allowed Roles')
        .setMinValues(0)
        .setMaxValues(25);
    if (draft.allowedRoleIds.length) {
        allowedRolesMenu.setDefaultRoles(draft.allowedRoleIds.slice(0, 25));
    }

    const ignoredRolesMenu = new RoleSelectMenuBuilder()
        .setCustomId('ar_ignored_roles')
        .setPlaceholder('Ignored Roles')
        .setMinValues(0)
        .setMaxValues(25);
    if (draft.ignoredRoleIds.length) {
        ignoredRolesMenu.setDefaultRoles(draft.ignoredRoleIds.slice(0, 25));
    }

    const primaryControlsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ar_toggle_exact')
            .setLabel(`Match: ${draft.matchType === 'exact' ? 'Exact' : 'Contains'}`)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('ar_toggle_enabled')
            .setLabel(draft.enabled ? 'Disable' : 'Enable')
            .setStyle(draft.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('ar_edit_response')
            .setLabel('Field')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ar_config_users')
            .setLabel('Users')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ar_save')
            .setLabel('Save')
            .setStyle(ButtonStyle.Success),
    );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(allowedChannelsMenu),
            new ActionRowBuilder().addComponents(ignoredChannelsMenu),
            new ActionRowBuilder().addComponents(allowedRolesMenu),
            new ActionRowBuilder().addComponents(ignoredRolesMenu),
            primaryControlsRow
        ]
    };
};

client.parseGiveawayDurationMs = (input) => {
    if (!input || typeof input !== 'string') return null;
    const normalized = input.trim().toLowerCase();
    const regex = /(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/g;
    let total = 0;
    let matched = false;
    let match;

    while ((match = regex.exec(normalized)) !== null) {
        matched = true;
        const value = Number(match[1]);
        const unit = match[2];
        if (!Number.isFinite(value) || value <= 0) continue;

        if (unit.startsWith('d')) total += value * 24 * 60 * 60 * 1000;
        else if (unit.startsWith('h')) total += value * 60 * 60 * 1000;
        else if (unit.startsWith('m')) total += value * 60 * 1000;
        else total += value * 1000;
    }

    if (!matched) return null;
    if (total < 5_000) return null;
    return total;
};

client.parseGiveawayRoleBonuses = (rawInput, guild) => {
    const text = String(rawInput || '').trim();
    if (!text) return { bonuses: [], invalidTokens: [] };

    const tokens = text.split(',').map(token => token.trim()).filter(Boolean);
    const bonusesMap = new Map();
    const invalidTokens = [];

    for (const token of tokens) {
        const [left, right] = token.split(':').map(part => String(part || '').trim());
        if (!left || !right) {
            invalidTokens.push(token);
            continue;
        }

        const parsedExtra = Number(String(right).replace(/^\+/, ''));
        if (!Number.isInteger(parsedExtra) || parsedExtra < 1 || parsedExtra > 50) {
            invalidTokens.push(token);
            continue;
        }

        let roleId = null;
        const mention = left.match(/^<@&(\d{17,20})>$/);
        if (mention) {
            roleId = mention[1];
        } else if (/^\d{17,20}$/.test(left)) {
            roleId = left;
        } else if (guild?.roles?.cache) {
            const byName = guild.roles.cache.find(role => role.name.toLowerCase() === left.toLowerCase());
            if (byName) roleId = byName.id;
        }

        if (!roleId) {
            invalidTokens.push(token);
            continue;
        }

        bonusesMap.set(roleId, parsedExtra);
    }

    const bonuses = Array.from(bonusesMap.entries()).map(([roleId, extraEntries]) => ({ roleId, extraEntries }));
    return { bonuses, invalidTokens };
};

client.getGiveawayDraftKey = (guildId, userId) => `${guildId}:${userId}`;

client.getGiveawayRoleBonusesFromPresetSelection = (guildId, selectedRoleIds = []) => {
    const selectedSet = new Set((selectedRoleIds || []).map(String));
    return client.getGiveawayEntryRoles(guildId)
        .filter(item => selectedSet.has(item.roleId))
        .map(item => ({ roleId: item.roleId, extraEntries: item.extraEntries }));
};

client.buildGiveawayDraftPayload = (draft) => {
    const preview = {
        ...draft,
        ended: false,
        winnerIds: [],
        entries: [],
        endAt: draft.endAt || (Date.now() + (draft.durationMs || 60_000))
    };

    const embed = client.buildGiveawayEmbed(preview)
        .setTitle(`${draft.prize || 'Giveaway'} (Preview)`);

    const entryRoleRules = client.getGiveawayEntryRoles(draft.guildId);
    const selectedRoleIds = (draft.selectedBonusRoleIds || []).map(String);
    const selectedBonuses = client.getGiveawayRoleBonusesFromPresetSelection(draft.guildId, selectedRoleIds);
    const selectedBonusMap = new Map(selectedBonuses.map(item => [item.roleId, item.extraEntries]));
    const guild = draft.guildId ? client.guilds.cache.get(draft.guildId) : null;

    const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('gv_bonus_create')
            .setLabel('Create Giveaway')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('gv_bonus_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const selectedText = selectedBonuses.length
        ? selectedBonuses.map(item => `<@&${item.roleId}> (+${item.extraEntries})`).join(', ')
        : 'None selected';

    const components = [controls];
    let content = 'Select bonus roles and create the giveaway.';

    if (entryRoleRules.length) {
        const options = entryRoleRules.slice(0, 25).map(item => {
            const roleName = guild?.roles?.cache?.get(item.roleId)?.name || `Role ${item.roleId}`;
            return {
                label: roleName.slice(0, 100),
                value: item.roleId,
                description: `+${item.extraEntries} entries`,
                default: selectedBonusMap.has(item.roleId)
            };
        });

        const selector = new StringSelectMenuBuilder()
            .setCustomId('gv_bonus_roles')
            .setPlaceholder('Select preset bonus role(s)')
            .setMinValues(0)
            .setMaxValues(Math.max(1, options.length))
            .addOptions(options);

        components.unshift(new ActionRowBuilder().addComponents(selector));
        content = `Choose any preset bonus roles below.\nSelected roles: ${selectedText}`;
    } else {
        content = 'No preset entry roles configured yet. Use /entryroles to add them, or click Create Giveaway to continue with no bonus roles.';
    }

    return {
        content,
        embeds: [embed],
        components
    };
};

client.formatGiveawayWinnersValue = (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return 'No winner yet';
    return ids.map(id => `<@${id}>`).join(', ');
};

client.calculateGiveawayTicketsForMember = (member, roleBonuses = []) => {
    let tickets = 1;
    if (!member?.roles?.cache) return tickets;

    for (const rule of roleBonuses) {
        if (member.roles.cache.has(rule.roleId)) {
            tickets += Math.max(1, Number(rule.extraEntries || 1));
        }
    }

    return Math.min(100, Math.max(1, tickets));
};

client.getGiveawayTotalTickets = (giveaway) => {
    const entries = Array.isArray(giveaway?.entries) ? giveaway.entries : [];
    if (!entries.length) return 0;

    const weights = giveaway?.entryWeights && typeof giveaway.entryWeights === 'object'
        ? giveaway.entryWeights
        : null;

    if (!weights) return entries.length;

    let total = 0;
    for (const userId of entries) {
        const v = Number(weights[userId]);
        total += Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
    }
    return total;
};

client.buildGiveawayEmbed = (giveaway) => {
    const endUnix = Math.floor(Number(giveaway.endAt) / 1000);
    const ended = Boolean(giveaway.ended) || Date.now() >= Number(giveaway.endAt);

    const embed = new EmbedBuilder()
        .setColor(0x2F3136)
        .setTitle(giveaway.prize || 'Giveaway')
        .setDescription(giveaway.description || null)
        .addFields(
            {
                name: ended ? 'Ended' : 'Ends',
                value: ended
                    ? `<t:${endUnix}:R> (<t:${endUnix}:F>)`
                    : `<t:${endUnix}:R> (<t:${endUnix}:F>)`,
                inline: false
            },
            { name: 'Hosted by', value: `<@${giveaway.hostId}>`, inline: true },
            { name: 'Entries', value: String(client.getGiveawayTotalTickets(giveaway)), inline: true },
            { name: 'Winners', value: ended ? client.formatGiveawayWinnersValue(giveaway.winnerIds) : String(giveaway.winnerCount || 1), inline: true }
        )
        .setTimestamp(Number(giveaway.endAt));

    if (Array.isArray(giveaway.roleBonuses) && giveaway.roleBonuses.length) {
        const bonusText = giveaway.roleBonuses
            .map(item => `<@&${item.roleId}> +${item.extraEntries}`)
            .join('\n')
            .slice(0, 1024);
        embed.addFields({ name: 'Bonus Entries', value: bonusText || 'None', inline: false });
    }

    return embed;
};

client.buildGiveawayActionRow = (giveaway) => {
    if (giveaway.ended) {
        return null;
    }

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`gv_join:${giveaway.id}`)
            .setLabel('🎉')
            .setStyle(ButtonStyle.Primary)
    );
};

client.buildGiveawayComponents = (giveaway) => {
    const row = client.buildGiveawayActionRow(giveaway);
    return row ? [row] : [];
};

client.loadGiveaways = () => {
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    if (!fs.existsSync(giveawaysFile)) fs.writeFileSync(giveawaysFile, '{}', 'utf8');

    let raw = '{}';
    try {
        raw = fs.readFileSync(giveawaysFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read giveaways file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse giveaways file:', err);
    }

    client.giveaways.clear();
    for (const [guildId, entries] of Object.entries(parsed)) {
        const normalized = Array.isArray(entries)
            ? entries
                .filter(item => item && typeof item === 'object')
                .map(item => ({
                    id: String(item.id || `gv_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`),
                    guildId: String(guildId),
                    channelId: String(item.channelId || ''),
                    messageId: String(item.messageId || ''),
                    hostId: String(item.hostId || ''),
                    prize: String(item.prize || ''),
                    description: String(item.description || ''),
                    durationMs: Number(item.durationMs || 0),
                    winnerCount: Math.max(1, Number(item.winnerCount || 1)),
                    createdAt: Number(item.createdAt || Date.now()),
                    endAt: Number(item.endAt || Date.now()),
                    entries: Array.isArray(item.entries) ? [...new Set(item.entries.map(String))] : [],
                    entryWeights: item.entryWeights && typeof item.entryWeights === 'object'
                        ? Object.fromEntries(
                            Object.entries(item.entryWeights).map(([k, v]) => [String(k), Math.max(1, Number(v) || 1)])
                        )
                        : {},
                    ended: Boolean(item.ended),
                    winnerIds: Array.isArray(item.winnerIds) ? [...new Set(item.winnerIds.map(String))] : [],
                    roleBonuses: Array.isArray(item.roleBonuses)
                        ? item.roleBonuses
                            .filter(b => b && typeof b === 'object')
                            .map(b => ({ roleId: String(b.roleId || ''), extraEntries: Math.max(1, Number(b.extraEntries || 1)) }))
                            .filter(b => b.roleId)
                        : []
                }))
                .filter(item => item.channelId && item.messageId && item.hostId && item.prize)
            : [];

        client.giveaways.set(guildId, normalized);
    }
};

client.loadEntryRoles = () => {
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    if (!fs.existsSync(entryRolesFile)) fs.writeFileSync(entryRolesFile, '{}', 'utf8');

    let raw = '{}';
    try {
        raw = fs.readFileSync(entryRolesFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read entryroles file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse entryroles file:', err);
    }

    client.entryRoles.clear();
    for (const [guildId, rules] of Object.entries(parsed)) {
        const normalized = Array.isArray(rules)
            ? rules
                .filter(item => item && typeof item === 'object')
                .map(item => ({
                    roleId: String(item.roleId || ''),
                    extraEntries: Math.max(1, Math.min(50, Number(item.extraEntries || 1)))
                }))
                .filter(item => item.roleId)
            : [];

        client.entryRoles.set(String(guildId), normalized);
    }
};

client.saveEntryRoles = () => {
    const out = {};
    for (const [guildId, rules] of client.entryRoles.entries()) {
        out[guildId] = rules;
    }
    fs.writeFileSync(entryRolesFile, JSON.stringify(out, null, 2), 'utf8');
};

client.getGiveawayEntryRoles = (guildId) => {
    return client.entryRoles.get(String(guildId)) || [];
};

client.upsertGiveawayEntryRole = (guildId, roleId, extraEntries) => {
    const rules = [...client.getGiveawayEntryRoles(guildId)];
    const idx = rules.findIndex(item => item.roleId === String(roleId));
    const nextRule = {
        roleId: String(roleId),
        extraEntries: Math.max(1, Math.min(50, Number(extraEntries || 1)))
    };
    if (idx === -1) rules.push(nextRule);
    else rules[idx] = nextRule;

    client.entryRoles.set(String(guildId), rules);
    client.saveEntryRoles();
    return nextRule;
};

client.removeGiveawayEntryRole = (guildId, roleId) => {
    const rules = client.getGiveawayEntryRoles(guildId);
    const next = rules.filter(item => item.roleId !== String(roleId));
    client.entryRoles.set(String(guildId), next);
    client.saveEntryRoles();
    return next.length !== rules.length;
};

client.clearGiveawayEntryRoles = (guildId) => {
    client.entryRoles.set(String(guildId), []);
    client.saveEntryRoles();
};

client.saveGiveaways = () => {
    const out = {};
    for (const [guildId, entries] of client.giveaways.entries()) {
        out[guildId] = entries;
    }
    fs.writeFileSync(giveawaysFile, JSON.stringify(out, null, 2), 'utf8');
};

client.getGuildGiveaways = (guildId) => {
    return client.giveaways.get(guildId) || [];
};

client.getGiveaway = (guildId, giveawayId) => {
    return client.getGuildGiveaways(guildId).find(item => item.id === giveawayId) || null;
};

client.findGiveawayByInput = (guildId, input) => {
    const normalized = String(input || '').trim();
    if (!normalized) return null;
    const giveaways = client.getGuildGiveaways(guildId);
    return giveaways.find(item => item.id === normalized || item.messageId === normalized) || null;
};

client.upsertGiveaway = (guildId, giveaway) => {
    const existing = client.getGuildGiveaways(guildId);
    const idx = existing.findIndex(item => item.id === giveaway.id);
    const next = [...existing];
    if (idx === -1) next.push(giveaway);
    else next[idx] = { ...next[idx], ...giveaway };
    client.giveaways.set(guildId, next);
    client.saveGiveaways();
};

client.cancelGiveawayTimer = (guildId, giveawayId) => {
    const timerKey = `${guildId}:${giveawayId}`;
    const timer = client.giveawayTimers.get(timerKey);
    if (timer) {
        clearTimeout(timer);
        client.giveawayTimers.delete(timerKey);
    }
};

client.deleteGiveawayRecord = (guildId, giveawayId) => {
    const existing = client.getGuildGiveaways(guildId);
    const next = existing.filter(item => item.id !== giveawayId);
    client.giveaways.set(guildId, next);
    client.saveGiveaways();
    client.cancelGiveawayTimer(guildId, giveawayId);
};

client.pickRandomUnique = (source, count, excluded = new Set()) => {
    const pool = source.filter(id => !excluded.has(id));
    const picked = [];
    while (pool.length > 0 && picked.length < count) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return picked;
};

client.pickWeightedWinners = async (giveaway, count, excluded = new Set()) => {
    const entries = Array.isArray(giveaway.entries) ? [...new Set(giveaway.entries)] : [];
    if (!entries.length) return [];

    giveaway.entryWeights = giveaway.entryWeights && typeof giveaway.entryWeights === 'object'
        ? giveaway.entryWeights
        : {};

    const guild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
    if (!guild) {
        return client.pickRandomUnique(entries, count, excluded);
    }

    const weightedPool = [];
    const bonusRules = Array.isArray(giveaway.roleBonuses) ? giveaway.roleBonuses : [];

    for (const userId of entries) {
        if (excluded.has(userId)) continue;

        let tickets = Number(giveaway.entryWeights[userId]);
        if (!Number.isFinite(tickets) || tickets < 1) {
            tickets = 1;
            if (bonusRules.length) {
                const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    tickets = client.calculateGiveawayTicketsForMember(member, bonusRules);
                    giveaway.entryWeights[userId] = tickets;
                }
            }
        }

        const safeTickets = Math.min(100, Math.max(1, tickets));
        for (let i = 0; i < safeTickets; i++) {
            weightedPool.push(userId);
        }
    }

    if (!weightedPool.length) return [];

    const winners = [];
    while (winners.length < count && weightedPool.length > 0) {
        const idx = Math.floor(Math.random() * weightedPool.length);
        const selected = weightedPool[idx];
        winners.push(selected);

        for (let i = weightedPool.length - 1; i >= 0; i--) {
            if (weightedPool[i] === selected) weightedPool.splice(i, 1);
        }
    }

    return winners;
};

client.resolveGiveawayMessage = async (giveaway) => {
    const guild = client.guilds.cache.get(giveaway.guildId) || await client.guilds.fetch(giveaway.guildId).catch(() => null);
    if (!guild) return null;

    const channel = guild.channels.cache.get(giveaway.channelId) || await guild.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;

    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (!message) return null;

    return { guild, channel, message };
};

client.finalizeGiveaway = async (guildId, giveawayId) => {
    const giveaway = client.getGiveaway(guildId, giveawayId);
    if (!giveaway || giveaway.ended) return giveaway || null;

    giveaway.ended = true;
    const winners = await client.pickWeightedWinners(giveaway, giveaway.winnerCount || 1);
    giveaway.winnerIds = winners;
    client.upsertGiveaway(guildId, giveaway);

    const resolved = await client.resolveGiveawayMessage(giveaway);
    if (resolved) {
        const { channel, message } = resolved;
        await message.edit({
            embeds: [client.buildGiveawayEmbed(giveaway)],
            components: client.buildGiveawayComponents(giveaway)
        }).catch(() => null);

        if (winners.length) {
            await channel.send({
                content: `Congratulations ${winners.map(id => `<@${id}>`).join(', ')}! You won the **${giveaway.prize}**!`
            }).catch(() => null);
        } else {
            await channel.send({ content: `Giveaway **${giveaway.prize}** ended with no valid entries.` }).catch(() => null);
        }
    }

    client.cancelGiveawayTimer(guildId, giveawayId);

    return giveaway;
};

client.rerollGiveaway = async (guildId, giveawayId, count = 1, actorId = null) => {
    const giveaway = client.getGiveaway(guildId, giveawayId);
    if (!giveaway || !giveaway.ended) return { giveaway: null, winners: [] };

    const excluded = new Set(giveaway.winnerIds || []);
    const winners = await client.pickWeightedWinners(giveaway, Math.max(1, count), excluded);
    if (!winners.length) return { giveaway, winners: [] };

    giveaway.winnerIds = [...new Set([...(giveaway.winnerIds || []), ...winners])];
    client.upsertGiveaway(guildId, giveaway);

    const resolved = await client.resolveGiveawayMessage(giveaway);
    if (resolved) {
        const { channel } = resolved;
        const actorPrefix = actorId ? `<@${actorId}> rerolled the giveaway!` : 'Giveaway rerolled!';
        await channel.send({
            content: `${actorPrefix} Congratulations ${winners.map(id => `<@${id}>`).join(', ')}!`
        }).catch(() => null);
    }

    return { giveaway, winners };
};

client.scheduleGiveaway = (giveaway) => {
    if (!giveaway || giveaway.ended) return;
    const timerKey = `${giveaway.guildId}:${giveaway.id}`;

    const existing = client.giveawayTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    const delay = Math.max(0, Number(giveaway.endAt) - Date.now());
    const timer = setTimeout(() => {
        client.finalizeGiveaway(giveaway.guildId, giveaway.id)
            .catch(err => console.error('Failed to finalize giveaway:', err));
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    client.giveawayTimers.set(timerKey, timer);
};

client.scheduleGiveawaysOnStartup = () => {
    for (const entries of client.giveaways.values()) {
        for (const giveaway of entries) {
            if (giveaway.ended) continue;
            if (Date.now() >= giveaway.endAt) {
                client.finalizeGiveaway(giveaway.guildId, giveaway.id)
                    .catch(err => console.error('Failed to finalize overdue giveaway:', err));
            } else {
                client.scheduleGiveaway(giveaway);
            }
        }
    }
};

client.loadCommands = () => {
    client.commands.clear();
    client.slashCommands.clear();
    if (!fs.existsSync(commandsPath)) return;

    const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            delete require.cache[require.resolve(filePath)];
            const cmd = require(filePath);
            if (cmd && cmd.name && typeof cmd.execute === 'function') {
                client.commands.set(cmd.name, cmd);
            }

            const registrationDefs = [cmd?.data, cmd?.contextData].filter(Boolean);
            if (registrationDefs.length) {
                for (const def of registrationDefs) {
                    const json = typeof def.toJSON === 'function' ? def.toJSON() : null;
                    if (!json?.name) continue;
                    client.slashCommands.set(json.name, cmd);
                }
            }
        } catch (err) {
            console.error(`Failed to load command ${file}:`, err);
        }
    }
};

client.loadPermissions = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    if (!fs.existsSync(permsFile)) {
        fs.writeFileSync(permsFile, '{}', 'utf8');
    }

    let raw = '{}';
    try {
        raw = fs.readFileSync(permsFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read perms file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse perms file:', err);
    }

    client.allowedRoles.clear();
    for (const [guildId, roleIds] of Object.entries(parsed)) {
        client.allowedRoles.set(guildId, Array.isArray(roleIds) ? new Set(roleIds) : null);
    }
};

client.savePermissions = () => {
    const out = {};
    for (const [guildId, roles] of client.allowedRoles.entries()) {
        out[guildId] = roles === null ? [] : Array.from(roles);
    }
    fs.writeFileSync(permsFile, JSON.stringify(out, null, 2), 'utf8');
};

client.loadLogChannels = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    if (!fs.existsSync(logsFile)) {
        fs.writeFileSync(logsFile, '{}', 'utf8');
    }
    try {
        raw = fs.readFileSync(logsFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read logs file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse logs file:', err);
    }

    client.logChannels.clear();
    for (const [guildId, channelId] of Object.entries(parsed)) {
        if (typeof channelId === 'string') {
            client.logChannels.set(guildId, channelId);
        }
    }
};

client.saveLogChannels = () => {
    const out = {};
    for (const [guildId, channelId] of client.logChannels.entries()) {
        out[guildId] = channelId;
    }
    fs.writeFileSync(logsFile, JSON.stringify(out, null, 2), 'utf8');
};

client.loadBloxlink = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    if (!fs.existsSync(bloxlinkFile)) {
        fs.writeFileSync(bloxlinkFile, '{}', 'utf8');
    }

    let raw = '{}';
    try {
        raw = fs.readFileSync(bloxlinkFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read bloxlink file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse bloxlink file:', err);
    }

    client.bloxlink.clear();
    for (const [discordId, entry] of Object.entries(parsed)) {
        client.bloxlink.set(discordId, entry);
    }
};

client.saveBloxlink = () => {
    const out = {};
    for (const [discordId, entry] of client.bloxlink.entries()) {
        out[discordId] = entry;
    }
    fs.writeFileSync(bloxlinkFile, JSON.stringify(out, null, 2), 'utf8');
};

client.loadBloxlinkHistory = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    if (!fs.existsSync(bloxlinkHistoryFile)) {
        fs.writeFileSync(bloxlinkHistoryFile, '{}', 'utf8');
    }

    let raw = '{}';
    try {
        raw = fs.readFileSync(bloxlinkHistoryFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read bloxlink history file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse bloxlink history file:', err);
    }

    client.bloxlinkHistory.clear();
    for (const [guildId, history] of Object.entries(parsed)) {
        const guildHistory = { robloxToBannedDiscord: new Map() };
        if (history && typeof history.robloxToBannedDiscord === 'object') {
            for (const [robloxId, discordIds] of Object.entries(history.robloxToBannedDiscord)) {
                guildHistory.robloxToBannedDiscord.set(robloxId, new Set(Array.isArray(discordIds) ? discordIds : []));
            }
        }
        client.bloxlinkHistory.set(guildId, guildHistory);
    }
};

client.saveBloxlinkHistory = () => {
    const out = {};
    for (const [guildId, history] of client.bloxlinkHistory.entries()) {
        out[guildId] = { robloxToBannedDiscord: {} };
        for (const [robloxId, discordIds] of history.robloxToBannedDiscord.entries()) {
            out[guildId].robloxToBannedDiscord[robloxId] = Array.from(discordIds);
        }
    }
    fs.writeFileSync(bloxlinkHistoryFile, JSON.stringify(out, null, 2), 'utf8');
};

client.rememberBannedRobloxId = (guildId, robloxId, discordId) => {
    if (!guildId || !robloxId || !discordId) return;
    let history = client.bloxlinkHistory.get(guildId);
    if (!history) {
        history = { robloxToBannedDiscord: new Map() };
        client.bloxlinkHistory.set(guildId, history);
    }
    let set = history.robloxToBannedDiscord.get(robloxId);
    if (!set) {
        set = new Set();
        history.robloxToBannedDiscord.set(robloxId, set);
    }
    set.add(discordId);
    client.saveBloxlinkHistory();
};

client.getBannedDiscordIdsForRoblox = (guildId, robloxId) => {
    const history = client.bloxlinkHistory.get(guildId);
    if (!history) return [];
    return Array.from(history.robloxToBannedDiscord.get(robloxId) ?? []);
};

client.getKnownBannedRobloxIds = (guildId) => {
    const history = client.bloxlinkHistory.get(guildId);
    if (!history) return new Set();
    return new Set(history.robloxToBannedDiscord.keys());
};

client.getBloxlinkApiKey = (guildId) => {
    const guildSpecificEnvKey = guildId ? process.env[`BLOXLINK_API_KEY_${guildId}`] : null;
    if (guildSpecificEnvKey) return guildSpecificEnvKey;

    const perGuildConfig = config.bloxlinkApiKeys && guildId
        ? config.bloxlinkApiKeys[String(guildId)]
        : null;
    if (perGuildConfig) return perGuildConfig;

    return process.env.BLOXLINK_API_KEY || config.bloxlinkApiKey || null;
};

const extractRobloxIdFromBloxlinkPayload = (body) => {
    const candidates = [
        body?.robloxID,
        body?.robloxId,
        body?.roblox_id,
        body?.user?.robloxID,
        body?.user?.robloxId,
        body?.user?.roblox_id,
        body?.user?.id,
        body?.robloxAccount?.id,
        body?.robloxAccount?.robloxID,
        body?.robloxAccount?.robloxId,
        body?.primaryAccount?.id,
        body?.primaryAccount?.robloxID,
        body?.primaryAccount?.robloxId,
        body?.account?.id,
        body?.account?.robloxID,
        body?.account?.robloxId
    ];

    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
            return String(candidate).trim();
        }
    }

    return null;
};

client.logBloxlinkThrottled = (key, message, level = 'warn', cooldownMs = 5 * 60 * 1000) => {
    const now = Date.now();
    const nextAllowed = Number(client.bloxlinkLogCooldownByKey.get(key) || 0);
    if (nextAllowed > now) return;
    client.bloxlinkLogCooldownByKey.set(key, now + Math.max(1000, Number(cooldownMs) || 0));

    if (level === 'error') {
        console.error(message);
    } else {
        console.warn(message);
    }
};

client.lookupLinkedRobloxAccount = async (guildId, discordId) => {
    if (!guildId || !discordId) {
        return { ok: false, status: 400, reason: 'missing-params', robloxId: null };
    }

    const cacheKey = `${guildId}:${discordId}`;
    const cached = client.bloxlink.get(cacheKey) || client.bloxlink.get(discordId);
    const now = Date.now();

    const rateLimitedUntil = Number(client.bloxlinkRateLimitUntilByGuild.get(guildId) || 0);
    if (rateLimitedUntil > now) {
        if (cached && cached.robloxId) {
            return { ok: true, status: 200, reason: 'stale-cache', robloxId: cached.robloxId };
        }
        return { ok: false, status: 429, reason: 'rate-limited', robloxId: null };
    }

    if (cached && cached.robloxId && (!cached.expires || cached.expires > now)) {
        if (client.bloxlink.has(discordId) && !client.bloxlink.has(cacheKey)) {
            client.bloxlink.set(cacheKey, cached);
            client.bloxlink.delete(discordId);
            client.saveBloxlink();
        }
        return { ok: true, status: 200, reason: 'cache', robloxId: cached.robloxId };
    }

    const apiKey = client.getBloxlinkApiKey(guildId);
    if (!apiKey) {
        return { ok: false, status: 0, reason: 'missing-api-key', robloxId: null };
    }

    const url = `https://api.blox.link/v4/public/guilds/${guildId}/discord-to-roblox/${discordId}`;
    try {
        const res = await fetch(url, { headers: { Authorization: apiKey } });
        if (res.status === 404) {
            return { ok: false, status: 404, reason: 'not-linked', robloxId: null };
        }

        const bodyText = await res.text();
        let body = null;
        if (bodyText) {
            try {
                body = JSON.parse(bodyText);
            } catch {
                body = null;
            }
        }

        if (res.status === 429) {
            const retryAfterHeader = Number(res.headers.get('retry-after'));
            const headerBackoffMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
                ? Math.ceil(retryAfterHeader * 1000)
                : 0;
            const configuredBackoffMs = Number(config.bloxlinkRateLimitBackoffMs);
            const fallbackBackoffMs = Number.isFinite(configuredBackoffMs) && configuredBackoffMs > 0
                ? configuredBackoffMs
                : 10 * 60 * 1000;
            const backoffMs = Math.max(headerBackoffMs, fallbackBackoffMs);
            const cooldownUntil = now + backoffMs;

            client.bloxlinkRateLimitUntilByGuild.set(guildId, cooldownUntil);

            const nextNoticeAt = Number(client.bloxlinkRateLimitNoticeUntilByGuild.get(guildId) || 0);
            if (nextNoticeAt <= now) {
                client.bloxlinkRateLimitNoticeUntilByGuild.set(guildId, cooldownUntil);
                client.logBloxlinkThrottled(
                    `rate-limit:${guildId}`,
                    `Bloxlink is rate limited (429) for guild ${guildId}. Backing off lookups for ${Math.ceil(backoffMs / 1000)}s.`,
                    'warn',
                    backoffMs
                );
            }

            if (cached && cached.robloxId) {
                return { ok: true, status: 200, reason: 'stale-cache', robloxId: cached.robloxId };
            }
            return { ok: false, status: 429, reason: 'rate-limited', robloxId: null };
        }

        if (!res.ok) {
            client.logBloxlinkThrottled(
                `request-failed:${guildId}:${res.status}`,
                `Bloxlink discord-to-roblox lookup returned ${res.status} for guild ${guildId}. Body: ${bodyText || '<empty body>'}`,
                'error',
                5 * 60 * 1000
            );
            return { ok: false, status: res.status, reason: 'request-failed', robloxId: null };
        }

        const robloxId = extractRobloxIdFromBloxlinkPayload(body);
        if (!robloxId) {
            client.logBloxlinkThrottled(
                `unrecognized-payload:${guildId}`,
                `Bloxlink discord-to-roblox lookup returned an unrecognized payload for guild ${guildId}. Body: ${bodyText || '<empty body>'}`,
                'error',
                5 * 60 * 1000
            );
            return { ok: false, status: res.status, reason: 'unrecognized-payload', robloxId: null };
        }

        const ttl = Number(config.bloxlinkCacheTtlMs) || 5 * 60 * 1000;
        client.bloxlink.set(cacheKey, { robloxId, expires: Date.now() + ttl });
        if (client.bloxlink.has(discordId)) client.bloxlink.delete(discordId);
        client.saveBloxlink();
        return { ok: true, status: res.status, reason: 'api', robloxId };
    } catch (err) {
        client.logBloxlinkThrottled(
            `network-error:${guildId}`,
            `Bloxlink lookup failed for guild ${guildId}: ${err?.message || 'Unknown network error'}`,
            'error',
            5 * 60 * 1000
        );
        return { ok: false, status: 0, reason: 'network-error', robloxId: null };
    }
};

client.getLinkedRobloxId = async (guildId, discordId) => {
    const result = await client.lookupLinkedRobloxAccount(guildId, discordId);
    return result.robloxId || null;
};

client.loadModLogs = () => {
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    if (!fs.existsSync(modLogsFile)) {
        fs.writeFileSync(modLogsFile, '{}', 'utf8');
    }

    let raw = '{}';
    try {
        raw = fs.readFileSync(modLogsFile, 'utf8') || '{}';
    } catch (err) {
        console.error('Failed to read modlogs file:', err);
    }

    let parsed = {};
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Failed to parse modlogs file:', err);
    }

    client.modLogs.clear();
    for (const [guildId, logs] of Object.entries(parsed)) {
        const loadedLogs = Array.isArray(logs) ? logs : [];
        const normalizedLogs = [];
        const orderedLogs = [...loadedLogs].reverse();
        for (let i = 0; i < orderedLogs.length; i++) {
            const entry = { ...orderedLogs[i] };
            entry.caseNumber = i + 1;
            normalizedLogs.push(entry);
        }
        client.modLogs.set(guildId, normalizedLogs.reverse());
    }
};

client.saveModLogs = () => {
    const out = {};
    for (const [guildId, logs] of client.modLogs.entries()) {
        out[guildId] = logs;
    }
    fs.writeFileSync(modLogsFile, JSON.stringify(out, null, 2), 'utf8');
};

client.getNextModCaseNumber = (guildId) => {
    const logs = client.modLogs.get(guildId) || [];
    let maxNumber = 0;
    for (const log of logs) {
        const candidate = Number(log.caseNumber ?? log.caseId);
        if (Number.isInteger(candidate) && candidate > maxNumber) {
            maxNumber = candidate;
        }
    }
    return maxNumber + 1;
};

client.addModLog = (guildId, entry) => {
    const logs = client.modLogs.get(guildId) || [];
    const caseNumber = client.getNextModCaseNumber(guildId);
    const newEntry = { caseNumber, ...entry };
    logs.unshift(newEntry);
    client.modLogs.set(guildId, logs);
    client.saveModLogs();

    if (typeof client.logGlobalModerationAudit === 'function') {
        client.logGlobalModerationAudit(guildId, newEntry)
            .catch(err => console.error('[GlobalAudit] Failed to write moderation audit log:', err));
    }
};

client.getModLogs = (guildId, userId) => {
    const logs = client.modLogs.get(guildId) || [];
    if (!userId) return logs;
    return logs.filter(log => log.userId === userId);
};

client.removeModLogCase = (guildId, caseNumber, userId = null) => {
    const logs = client.modLogs.get(guildId) || [];
    const caseIndex = logs.findIndex((log) => {
        const sameCase = String(log.caseNumber ?? log.caseId) === String(caseNumber);
        const sameUser = !userId || String(log.userId) === String(userId);
        return sameCase && sameUser;
    });

    if (caseIndex === -1) return null;

    const [removedLog] = logs.splice(caseIndex, 1);
    client.modLogs.set(guildId, logs);
    client.saveModLogs();
    return removedLog;
};

client.getAllowedRoleIds = (guildId) => {
    if (!client.allowedRoles.has(guildId)) return null;
    return client.allowedRoles.get(guildId);
};

client.getLogChannelId = (guildId) => {
    return client.logChannels.get(guildId) || null;
};

client.logToChannel = async (guild, payload) => {
    if (!guild) return;
    const channelId = client.getLogChannelId(guild.id);
    if (!channelId) return;

    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
        try {
            channel = await guild.channels.fetch(channelId);
        } catch (err) {
            console.error(`Failed to fetch log channel for guild ${guild.id}:`, err);
            return;
        }
    }

    if (!channel || !channel.isTextBased()) return;
    try {
        const safeAllowedMentions = {
            parse: [],
            users: [],
            roles: [],
            repliedUser: false
        };

        if (typeof payload === 'string') {
            await channel.send({ content: payload, allowedMentions: safeAllowedMentions });
        } else {
            await channel.send({ ...payload, allowedMentions: safeAllowedMentions });
        }
    } catch (err) {
        console.error(`Failed to send log payload to channel ${channelId} in guild ${guild.id}:`, err);
    }
};

client.logGlobalModerationAudit = async (sourceGuildId, logEntry) => {
    const hqGuildId = process.env.HQ_GUILD_ID || config.hqGuildId || HQ_GUILD_ID_DEFAULT;
    const hqGlobalLogChannelId = process.env.HQ_GLOBAL_LOG_CHANNEL_ID || config.hqGlobalLogChannelId || HQ_GLOBAL_LOG_CHANNEL_ID_DEFAULT;
    if (!hqGuildId || !hqGlobalLogChannelId) {
        return;
    }

    let channel;
    try {
        channel = await client.channels.fetch(hqGlobalLogChannelId);
    } catch (err) {
        console.error(`[GlobalAudit] Failed to fetch HQ global log channel ${hqGlobalLogChannelId}:`, err);
        return;
    }

    if (!channel || !channel.isTextBased()) {
        console.error(`[GlobalAudit] Channel ${hqGlobalLogChannelId} is not text-based or is inaccessible.`);
        return;
    }

    if (channel.guildId !== hqGuildId) {
        console.error(`[GlobalAudit] Channel guild mismatch. Channel guild: ${channel.guildId}, expected HQ guild: ${hqGuildId}.`);
        return;
    }

    const now = new Date();
    const usedAtUnix = Math.floor(now.getTime() / 1000);
    const action = logEntry?.action || 'Unknown';
    const moderatorTag = logEntry?.moderatorTag || 'Unknown Moderator';
    const moderatorId = logEntry?.moderatorId || 'Unknown ID';
    const userTag = logEntry?.userTag || 'Unknown User';
    const userId = logEntry?.userId || 'Unknown ID';
    const sourceGuild = sourceGuildId ? client.guilds.cache.get(sourceGuildId) : null;
    const sourceGuildName = sourceGuild?.name || 'Unknown Server';
    const normalizedAction = String(action).toLowerCase();
    const canUndo = normalizedAction === 'mute' || normalizedAction === 'ban';

    const fields = [
        { name: 'Moderator', value: `${moderatorTag} (${moderatorId})`, inline: false },
        { name: 'Source Server', value: `${sourceGuildName} (${sourceGuildId || 'Unknown Guild ID'})`, inline: false },
        { name: 'Action', value: action, inline: false },
        { name: 'Target User', value: `${userTag} (${userId})`, inline: false }
    ];

    if (logEntry?.reason) {
        fields.push({ name: 'Reason', value: String(logEntry.reason), inline: false });
    }
    if (logEntry?.duration) {
        fields.push({ name: 'Duration', value: String(logEntry.duration), inline: false });
    }
    if (Number.isInteger(logEntry?.count) || (typeof logEntry?.count === 'number' && !Number.isNaN(logEntry.count))) {
        fields.push({ name: 'Count', value: String(logEntry.count), inline: false });
    }
    if (logEntry?.channelId) {
        fields.push({ name: 'Channel', value: `<#${logEntry.channelId}> (${logEntry.channelId})`, inline: false });
    }
    fields.push({ name: 'Used At', value: `<t:${usedAtUnix}:F>`, inline: false });

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Moderation Log')
        .setDescription('Cross-server moderation activity was recorded')
        .addFields(fields)
        .setTimestamp(now);

    let components = [];
    let undoKey = null;
    if (canUndo && sourceGuildId && userId && moderatorId) {
        undoKey = `globalmod_undo_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`globalmod_undo:${undoKey}`)
                .setLabel('Undo')
                .setStyle(ButtonStyle.Danger)
        );
        components = [row];

        client.pendingGlobalModUndoActions.set(undoKey, {
            sourceGuildId,
            action,
            userId,
            userTag
        });

        const expiryTimer = setTimeout(() => {
            client.pendingGlobalModUndoActions.delete(undoKey);
        }, 24 * 60 * 60 * 1000);
        if (typeof expiryTimer.unref === 'function') expiryTimer.unref();
    }

    try {
        await channel.send({
            embeds: [embed],
            components,
            allowedMentions: {
                parse: [],
                users: [],
                roles: [],
                repliedUser: false
            }
        });
    } catch (err) {
        if (undoKey) client.pendingGlobalModUndoActions.delete(undoKey);
        throw err;
    }
};

client.logPermsAudit = async (interaction, selectedRoleNames, previousConfig) => {
    const hqGuildId = process.env.HQ_GUILD_ID || config.hqGuildId || HQ_GUILD_ID_DEFAULT;
    const hqPermsLogChannelId = process.env.HQ_PERMS_LOG_CHANNEL_ID || config.hqPermsLogChannelId || HQ_PERMS_LOG_CHANNEL_ID_DEFAULT;
    if (!hqGuildId || !hqPermsLogChannelId) {
        console.warn('[PermsAudit] Missing HQ_GUILD_ID/hqGuildId or HQ_PERMS_LOG_CHANNEL_ID/hqPermsLogChannelId. Skipping perms audit log.');
        return;
    }

    let channel;
    try {
        channel = await client.channels.fetch(hqPermsLogChannelId);
    } catch (err) {
        console.error(`[PermsAudit] Failed to fetch HQ perms log channel ${hqPermsLogChannelId}:`, err);
        return;
    }

    if (!channel || !channel.isTextBased()) {
        console.error(`[PermsAudit] Channel ${hqPermsLogChannelId} is not text-based or is inaccessible.`);
        return;
    }

    if (channel.guildId !== hqGuildId) {
        console.error(`[PermsAudit] Channel guild mismatch. Channel guild: ${channel.guildId}, expected HQ guild: ${hqGuildId}.`);
        return;
    }

    const now = new Date();
    const unix = Math.floor(now.getTime() / 1000);
    const actorTag = interaction.user?.tag || interaction.user?.username || 'Unknown User';
    const sourceGuildName = interaction.guild?.name || 'Unknown Server';
    const sourceGuildId = interaction.guildId || 'Unknown Guild ID';
    const rolesText = selectedRoleNames.length
        ? selectedRoleNames.join(', ')
        : 'none (command access restricted to server admins only)';
    const undoKey = `perms_undo_${interaction.id}`;

    try {
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('Perms Updated')
            .setDescription('Cross-server permission roles were updated')
            .addFields(
                { name: 'Moderator', value: `${actorTag} (${interaction.user.id})`, inline: false },
                { name: 'Source Server', value: `${sourceGuildName} (${sourceGuildId})`, inline: false },
                { name: 'Updated Roles', value: rolesText, inline: false },
                { name: 'Used At', value: `<t:${unix}:F>`, inline: false }
            )
            .setTimestamp(now);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`perms_undo:${undoKey}`)
                .setLabel('Undo')
                .setStyle(ButtonStyle.Danger)
        );

        client.pendingPermsUndoActions.set(undoKey, {
            sourceGuildId,
            previousRoleIds: previousConfig.previousRoleIds,
            hadExistingPermConfig: previousConfig.hadExistingPermConfig
        });

        const expiryTimer = setTimeout(() => {
            client.pendingPermsUndoActions.delete(undoKey);
        }, 24 * 60 * 60 * 1000);
        if (typeof expiryTimer.unref === 'function') expiryTimer.unref();

        await channel.send({
            embeds: [embed],
            components: [row],
            allowedMentions: {
                parse: [],
                users: [],
                roles: [],
                repliedUser: false
            }
        });
        console.log(`[PermsAudit] Logged /perms update from guild ${sourceGuildId} to HQ channel ${hqPermsLogChannelId}.`);
    } catch (err) {
        client.pendingPermsUndoActions.delete(undoKey);
        console.error('[PermsAudit] Failed to write /perms HQ audit log:', err);
    }
};

client.isMemberAllowed = (member) => {
    if (!member || !member.guild) return false;
    const allowed = client.getAllowedRoleIds(member.guild.id);
    if (allowed === null) return true;
    if (allowed.size === 0) {
        const hasTrelloRoleName = member.roles.cache.some(role => client.trelloModeratorLevelPermRoleNames.has(String(role.name || '').toLowerCase()));
        return member.permissions.has(PermissionsBitField.Flags.Administrator) || member.permissions.has(PermissionsBitField.Flags.ManageGuild) || hasTrelloRoleName;
    }
    return member.roles.cache.some(role => allowed.has(role.id) || client.trelloModeratorLevelPermRoleNames.has(String(role.name || '').toLowerCase()));
};

client.loadBoostChannels = () => {
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    if (!fs.existsSync(boostChannelFile)) fs.writeFileSync(boostChannelFile, '{}', 'utf8');
    let parsed = {};
    try { parsed = JSON.parse(fs.readFileSync(boostChannelFile, 'utf8') || '{}'); } catch (err) { console.error('Failed to read boostchannel file:', err); }
    client.boostChannels.clear();
    for (const [guildId, channelId] of Object.entries(parsed)) {
        if (typeof channelId === 'string') client.boostChannels.set(guildId, channelId);
    }
};

client.saveBoostChannels = () => {
    const out = {};
    for (const [guildId, channelId] of client.boostChannels.entries()) out[guildId] = channelId;
    fs.writeFileSync(boostChannelFile, JSON.stringify(out, null, 2), 'utf8');
};

client.loadManualLogsChannels = () => {
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    if (!fs.existsSync(manualLogsChannelsFile)) fs.writeFileSync(manualLogsChannelsFile, '{}', 'utf8');

    let parsed = {};
    try {
        parsed = JSON.parse(fs.readFileSync(manualLogsChannelsFile, 'utf8') || '{}');
    } catch (err) {
        console.error('Failed to read manual logs channels file:', err);
    }

    client.manualLogsChannels.clear();
    for (const [guildId, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        client.manualLogsChannels.set(guildId, {
            muteChannelId: typeof value.muteChannelId === 'string' ? value.muteChannelId : null,
            banChannelId: typeof value.banChannelId === 'string' ? value.banChannelId : null
        });
    }
};

client.loadPublicPermissions = () => {
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    if (!fs.existsSync(publicPermsFile)) fs.writeFileSync(publicPermsFile, '{}', 'utf8');

    let parsed = {};
    try {
        parsed = JSON.parse(fs.readFileSync(publicPermsFile, 'utf8') || '{}');
    } catch (err) {
        console.error('Failed to read public perms file:', err);
    }

    client.publicAllowedRoles.clear();
    for (const [guildId, roleIds] of Object.entries(parsed)) {
        client.publicAllowedRoles.set(guildId, Array.isArray(roleIds) ? new Set(roleIds.map(String)) : null);
    }
};

client.savePublicPermissions = () => {
    const out = {};
    for (const [guildId, roleSet] of client.publicAllowedRoles.entries()) {
        out[guildId] = roleSet === null ? [] : Array.from(roleSet);
    }
    fs.writeFileSync(publicPermsFile, JSON.stringify(out, null, 2), 'utf8');
};

client.getPublicRoleIds = (guildId) => {
    if (!client.publicAllowedRoles.has(guildId)) return null;
    return client.publicAllowedRoles.get(guildId);
};

client.isPublicMemberAllowed = (member) => {
    if (!member || !member.guild) return false;

    const hasAdminBypass = member.permissions.has(PermissionsBitField.Flags.Administrator)
        || member.permissions.has(PermissionsBitField.Flags.ManageGuild);

    const allowed = client.getPublicRoleIds(member.guild.id);
    if (allowed === null) return true;
    if (allowed.size === 0) return hasAdminBypass;
    if (hasAdminBypass) return true;
    return member.roles.cache.some(role => allowed.has(role.id));
};

client.saveManualLogsChannels = () => {
    const out = {};
    for (const [guildId, value] of client.manualLogsChannels.entries()) {
        out[guildId] = {
            muteChannelId: value?.muteChannelId || null,
            banChannelId: value?.banChannelId || null
        };
    }
    fs.writeFileSync(manualLogsChannelsFile, JSON.stringify(out, null, 2), 'utf8');
};

client.getManualLogsChannels = (guildId) => {
    const existing = client.manualLogsChannels.get(guildId);
    if (existing) return existing;
    return { muteChannelId: null, banChannelId: null };
};

client.setManualLogsChannels = (guildId, updates = {}) => {
    const existing = client.getManualLogsChannels(guildId);
    const next = {
        muteChannelId: Object.prototype.hasOwnProperty.call(updates, 'muteChannelId') ? (updates.muteChannelId || null) : existing.muteChannelId,
        banChannelId: Object.prototype.hasOwnProperty.call(updates, 'banChannelId') ? (updates.banChannelId || null) : existing.banChannelId
    };
    client.manualLogsChannels.set(guildId, next);
    client.saveManualLogsChannels();
    return next;
};

client.logManualModerationAction = async (guild, payload) => {
    if (!guild || !payload || typeof payload !== 'object') return;
    const category = String(payload.category || '').toLowerCase();
    if (category !== 'mute' && category !== 'ban') return;

    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length) return;

    const config = client.getManualLogsChannels(guild.id);
    const channelId = category === 'ban' ? config.banChannelId : config.muteChannelId;
    if (!channelId) return;

    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
        try {
            channel = await guild.channels.fetch(channelId);
        } catch (err) {
            console.error(`Failed to fetch manual logs channel for guild ${guild.id}:`, err);
            return;
        }
    }

    if (!channel || !channel.isTextBased()) return;
    try {
        await channel.send({
            embeds: Array.isArray(payload.embeds) ? payload.embeds : [],
            files,
            allowedMentions: {
                parse: [],
                users: [],
                roles: [],
                repliedUser: false
            }
        });
    } catch (err) {
        console.error(`Failed to send manual moderation log to channel ${channelId} in guild ${guild.id}:`, err);
    }
};

client.loadInfractionRules = () => {
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    if (!fs.existsSync(infractionsFile)) fs.writeFileSync(infractionsFile, '{}', 'utf8');

    let parsed = {};
    try {
        parsed = JSON.parse(fs.readFileSync(infractionsFile, 'utf8') || '{}');
    } catch (err) {
        console.error('Failed to read infractions file:', err);
    }

    client.infractionRules.clear();
    for (const [guildId, rules] of Object.entries(parsed)) {
        client.infractionRules.set(guildId, sanitizeInfractionRules(rules));
    }
};

client.saveInfractionRules = () => {
    const out = {};
    for (const [guildId, rules] of client.infractionRules.entries()) {
        out[guildId] = sanitizeInfractionRules(rules);
    }
    fs.writeFileSync(infractionsFile, JSON.stringify(out, null, 2), 'utf8');
};

client.getInfractionRules = (guildId) => {
    if (!guildId) return cloneInfractionRules(DEFAULT_INFRACTION_RULES);
    if (!client.infractionRules.has(guildId)) {
        client.infractionRules.set(guildId, cloneInfractionRules(DEFAULT_INFRACTION_RULES));
    }
    return client.infractionRules.get(guildId);
};

client.setInfractionRule = (guildId, ruleKey, ruleData) => {
    if (!guildId || !ruleKey) return null;
    if (!DEFAULT_INFRACTION_RULES[ruleKey]) return null;

    const existing = client.getInfractionRules(guildId);
    const next = sanitizeInfractionRules({
        ...existing,
        [ruleKey]: ruleData
    });

    client.infractionRules.set(guildId, next);
    client.saveInfractionRules();
    return next[ruleKey] || null;
};

client.resetInfractionRule = (guildId, ruleKey) => {
    if (!guildId || !ruleKey) return null;
    const defaults = DEFAULT_INFRACTION_RULES[ruleKey];
    if (!defaults) return null;

    const existing = client.getInfractionRules(guildId);
    const next = sanitizeInfractionRules({
        ...existing,
        [ruleKey]: cloneInfractionRule(defaults)
    });

    client.infractionRules.set(guildId, next);
    client.saveInfractionRules();
    return next[ruleKey] || null;
};

client.loadCommands();
client.loadPermissions();
client.loadLogChannels();
client.loadModLogs();
client.loadBloxlink();
client.loadBloxlinkHistory();
client.loadBoostChannels();
client.loadPrefixCommandState();
client.loadAutoresponders();
client.loadAutomodRules();
client.loadGiveaways();
client.loadEntryRoles();
client.loadInfractionRules();
client.loadManualLogsChannels();
client.loadPublicPermissions();

client.refreshGuildBloxlinkCache = async (guild) => {
    if (!guild) return;
    const now = Date.now();
    const rateLimitedUntil = Number(client.bloxlinkRateLimitUntilByGuild.get(guild.id) || 0);
    if (rateLimitedUntil > now) return;

    // Avoid full member fetches, which can trigger gateway opcode 8 rate limits on large guilds.
    const cachedMembers = Array.from(guild.members.cache.values()).slice(0, 100);
    for (const member of cachedMembers) {
        if (member.user.bot) continue;
        try {
            if (client.getLinkedRobloxId) {
                await client.getLinkedRobloxId(guild.id, member.user.id);
            }
        } catch (err) {
            console.error(`Failed to refresh Bloxlink cache for cached member ${member.user.id} in guild ${guild.id}:`, err);
        }
    }

    try {
        const bans = await guild.bans.fetch();
        for (const ban of bans.values()) {
            try {
                if (client.getLinkedRobloxId) {
                    const robloxId = await client.getLinkedRobloxId(guild.id, ban.user.id);
                    if (robloxId && client.rememberBannedRobloxId) {
                        client.rememberBannedRobloxId(guild.id, robloxId, ban.user.id);
                    }
                }
            } catch (err) {
                console.error(`Failed to refresh Bloxlink cache for banned user ${ban.user.id} in guild ${guild.id}:`, err);
            }
        }
    } catch (err) {
        console.error(`Failed to fetch guild bans for Bloxlink cache refresh in guild ${guild.id}:`, err);
    }
};

client.scheduleBloxlinkCacheRefresh = () => {
    const configuredMs = Number(config.bloxlinkCacheIntervalMs);
    const intervalMs = Number.isFinite(configuredMs) && configuredMs > 0
        ? Math.max(configuredMs, 300_000)
        : 900_000;
    const refresh = async () => {
        for (const guild of client.guilds.cache.values()) {
            await client.refreshGuildBloxlinkCache(guild);
        }
    };
    refresh().catch(err => console.error('Initial bloxlink cache refresh failed:', err));
    setInterval(() => refresh().catch(err => console.error('Periodic bloxlink cache refresh failed:', err)), intervalMs);
};

client.addPendingModerationAction = (key, data) => {
    client.pendingModerationActions.set(key, data);
};

client.getPendingModerationAction = (key) => {
    return client.pendingModerationActions.get(key);
};

client.deletePendingModerationAction = (key) => {
    client.pendingModerationActions.delete(key);
};

client.getPendingPermsUndoAction = (key) => {
    return client.pendingPermsUndoActions.get(key);
};

client.deletePendingPermsUndoAction = (key) => {
    client.pendingPermsUndoActions.delete(key);
};

client.getPendingGlobalModUndoAction = (key) => {
    return client.pendingGlobalModUndoActions.get(key);
};

client.deletePendingGlobalModUndoAction = (key) => {
    client.pendingGlobalModUndoActions.delete(key);
};

client.isIgnorableInteractionError = (error) => {
    const code = Number(error?.code ?? error?.rawError?.code);
    return code === 40060 || code === 10062;
};

client.syncSlashCommands = async (options = {}) => {
    const {
        guildIds,
        perGuildTimeoutMs = 45_000
    } = options;

    const slashData = [];
    const seenCommands = new Set();
    for (const cmd of client.slashCommands.values()) {
        const registrationDefs = [cmd?.data, cmd?.contextData].filter(Boolean);
        for (const def of registrationDefs) {
            if (typeof def.toJSON !== 'function') continue;
            const json = def.toJSON();
            if (!json?.name) continue;
            const commandType = json.type ?? 1;
            const key = `${commandType}:${json.name}`;
            if (seenCommands.has(key)) continue;
            seenCommands.add(key);
            slashData.push(json);
        }
    }

    const guildsToSync = Array.isArray(guildIds) && guildIds.length
        ? guildIds.map(id => client.guilds.cache.get(id)).filter(Boolean)
        : Array.from(client.guilds.cache.values());

    const results = [];
    for (const guild of guildsToSync) {
        try {
            const syncPromise = guild.commands.set(slashData);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timed out while syncing this guild.')), perGuildTimeoutMs);
            });
            await Promise.race([syncPromise, timeoutPromise]);
            results.push({ guildId: guild.id, guildName: guild.name, success: true, count: slashData.length });
        } catch (err) {
            console.error(`Failed to register slash commands for guild ${guild.id}:`, err);
            results.push({ guildId: guild.id, guildName: guild.name, success: false, error: err.message || 'Unknown error' });
        }
    }

    return { slashData, results };
};

client.on('clientReady', async () => {
    console.log(`Discord login successful. Token source: ${tokenSource}.`);
    console.log(`Boot marker: ${BOOT_MARKER}`);
    const { slashData } = await client.syncSlashCommands();
    console.log(`Ready! Registered ${slashData.length} slash command(s).`);

    client.user.setPresence({
        activities: [{ name: 'Automating Customs Community', type: ActivityType.Watching }],
        status: 'online'
    });

    client.scheduleHardcodedAdminsSync();
    client.scheduleBloxlinkCacheRefresh();
    client.scheduleGiveawaysOnStartup();
});

client.on('guildBanAdd', async (ban) => {
    try {
        if (client.getLinkedRobloxId) {
            const robloxId = await client.getLinkedRobloxId(ban.guild.id, ban.user.id);
            if (robloxId && client.rememberBannedRobloxId) {
                client.rememberBannedRobloxId(ban.guild.id, robloxId, ban.user.id);
            }
        }
    } catch (err) {
        console.error(`Failed to refresh Bloxlink cache for banned user ${ban.user.id}:`, err);
    }
});

client.on('guildMemberAdd', async (member) => {
    try {
        if (client.getLinkedRobloxId) {
            await client.getLinkedRobloxId(member.guild.id, member.user.id);
        }
    } catch (err) {
        console.error(`Failed to refresh Bloxlink cache for new member ${member.user.id}:`, err);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
        if (interaction.commandName === 'perms' || interaction.commandName === 'logs' || interaction.commandName === 'enablecommands' || interaction.commandName === 'setboostchannel' || interaction.commandName === 'autoresponder' || interaction.commandName === 'synccommands' || interaction.commandName === 'manage' || interaction.commandName === 'manuallogschannel' || interaction.commandName === 'publicperms') {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this command.', ephemeral: true });
            }
        } else {
            if (client.publicCommandNames.has(interaction.commandName)) {
                if (!client.isPublicMemberAllowed(interaction.member)) {
                    return interaction.reply({ content: 'You do not have permission to use this public command. Ask an admin to configure /publicperms.', ephemeral: true });
                }
            } else if (!client.isMemberAllowed(interaction.member)) {
                return interaction.reply({ content: 'You do not have permission to use bot commands. Use /perms to configure allowed roles.', ephemeral: true });
            }
        }

        const command = client.slashCommands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.executeInteraction({ client, interaction });
        } catch (err) {
            if (client.isIgnorableInteractionError(err)) {
                console.warn(`[Interaction] Ignoring already-acknowledged/expired command interaction for /${interaction.commandName}.`);
                return;
            }
            console.error(err);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error executing that command.', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true });
                }
            } catch (replyErr) {
                if (client.isIgnorableInteractionError(replyErr)) {
                    console.warn('[Interaction] Failed to send command error response because the interaction was already acknowledged or expired.');
                } else {
                    console.error('Failed to send error response to interaction:', replyErr);
                }
            }
        }
        return;
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('moddec_modal:')) {
            const muteCommand = client.slashCommands.get('mute');
            if (muteCommand && typeof muteCommand.handleModalSubmit === 'function') {
                const handled = await muteCommand.handleModalSubmit({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId.startsWith('manage_infraction_modal:')) {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const manageCommand = client.slashCommands.get('manage');
            if (manageCommand && typeof manageCommand.handleModalSubmit === 'function') {
                const handled = await manageCommand.handleModalSubmit({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId.startsWith('manage_modstats_modal:')) {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const manageCommand = client.slashCommands.get('manage');
            if (manageCommand && typeof manageCommand.handleModalSubmit === 'function') {
                const handled = await manageCommand.handleModalSubmit({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId.startsWith('manage_automod_modal:') || interaction.customId.startsWith('manage_automod_custom_modal:')) {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const manageCommand = client.slashCommands.get('manage');
            if (manageCommand && typeof manageCommand.handleModalSubmit === 'function') {
                const handled = await manageCommand.handleModalSubmit({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId === 'gv_create_modal') {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }

            const durationRaw = interaction.fields.getTextInputValue('gv_duration').trim();
            const winnersRaw = interaction.fields.getTextInputValue('gv_winners').trim();
            const prize = interaction.fields.getTextInputValue('gv_prize').trim();
            const description = (interaction.fields.getTextInputValue('gv_description') || '').trim();

            const durationMs = client.parseGiveawayDurationMs(durationRaw);
            const winnerCount = Number(winnersRaw);

            if (!durationMs) {
                return interaction.reply({
                    content: 'Invalid duration. Examples: `10 minutes`, `1h`, `2d 3h`.',
                    ephemeral: true
                });
            }
            if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 25) {
                return interaction.reply({
                    content: 'Number of winners must be a whole number between 1 and 25.',
                    ephemeral: true
                });
            }
            if (!prize) {
                return interaction.reply({ content: 'Prize is required.', ephemeral: true });
            }

            const now = Date.now();
            const draftKey = client.getGiveawayDraftKey(interaction.guildId, interaction.user.id);
            const draft = {
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                hostId: interaction.user.id,
                prize,
                description,
                durationMs,
                winnerCount,
                createdAt: now,
                endAt: now + durationMs,
                roleBonuses: [],
                selectedBonusRoleIds: []
            };

            client.giveawayDrafts.set(draftKey, draft);

            return interaction.reply({
                ...client.buildGiveawayDraftPayload(draft),
                ephemeral: true
            });
        }

        if (interaction.customId !== 'ar_create_modal' && interaction.customId !== 'ar_edit_response_modal') return;

        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
            return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
        }

        const draftKey = client.getAutoresponderDraftKey(interaction.guildId, interaction.user.id);
        const draft = client.autoresponderDrafts.get(draftKey);

        if (interaction.customId === 'ar_create_modal') {
            const trigger = interaction.fields.getTextInputValue('ar_trigger').trim();
            const response = interaction.fields.getTextInputValue('ar_response').trim();

            if (!trigger || !response) {
                return interaction.reply({ content: 'Trigger and response are required.', ephemeral: true });
            }

            const nextDraft = {
                trigger,
                response,
                enabled: true,
                matchType: 'contains',
                allowedChannelIds: [],
                ignoredChannelIds: [],
                allowedRoleIds: [],
                ignoredRoleIds: [],
                allowedUserIds: [],
                ignoredUserIds: [],
                createdBy: interaction.user.id,
                createdAt: new Date().toISOString()
            };

            client.autoresponderDrafts.set(draftKey, nextDraft);

            return interaction.reply({
                content: 'Initial values saved. Configure filters below:',
                ...client.buildAutoresponderConfigPayload(nextDraft),
                ephemeral: true
            });
        }

        if (!draft) {
            return interaction.reply({ content: 'No active autoresponder draft was found. Run /autoresponder again.', ephemeral: true });
        }

        const response = interaction.fields.getTextInputValue('ar_edit_response_text').trim();
        if (!response) {
            return interaction.reply({ content: 'Response text is required.', ephemeral: true });
        }

        draft.response = response;
        client.autoresponderDrafts.set(draftKey, draft);

        return interaction.reply({
            content: 'Updated autoresponder response field.',
            ...client.buildAutoresponderConfigPayload(draft),
            ephemeral: true
        });
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'publicperms_save' || interaction.customId === 'publicperms_cancel') {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            if (!interaction.guild) {
                return interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            }

            const draftKey = `${interaction.guild.id}:${interaction.user.id}`;
            client.publicPermDrafts = client.publicPermDrafts || new Map();
            const draft = client.publicPermDrafts.get(draftKey);

            if (interaction.customId === 'publicperms_cancel') {
                client.publicPermDrafts.delete(draftKey);
                return interaction.update({ content: 'Public perms setup canceled.', components: [] });
            }

            if (!draft) {
                return interaction.reply({ content: 'No active public perms draft found. Run /publicperms set again.', ephemeral: true });
            }

            const selectedRoleIds = Array.isArray(draft.selectedRoleIds) ? draft.selectedRoleIds : [];
            client.publicAllowedRoles.set(interaction.guild.id, new Set(selectedRoleIds));
            client.savePublicPermissions();
            client.publicPermDrafts.delete(draftKey);

            const roleList = selectedRoleIds.length
                ? selectedRoleIds.map(roleId => `<@&${roleId}>`).join(', ')
                : 'none (only admins/managers will be able to use public commands)';

            return interaction.update({
                content: `Public command roles updated: ${roleList}`,
                components: []
            });
        }

        if (interaction.customId.startsWith('moddec_')) {
            const muteCommand = client.slashCommands.get('mute');
            if (muteCommand && typeof muteCommand.handleButton === 'function') {
                const handled = await muteCommand.handleButton({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId.startsWith('manage_')) {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const manageCommand = client.slashCommands.get('manage');
            if (manageCommand && typeof manageCommand.handleButton === 'function') {
                const handled = await manageCommand.handleButton({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId.startsWith('profile-ban-user-')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            }

            if (!client.isMemberAllowed(interaction.member)) {
                return interaction.reply({ content: 'You do not have permission to ban users.', ephemeral: true });
            }

            const userId = interaction.customId.split('-').slice(3).join('-');
            const targetUser = await client.users.fetch(userId).catch(() => null);

            if (!targetUser) {
                return interaction.reply({ content: 'User could not be found.', ephemeral: true });
            }

            if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return interaction.reply({ content: 'I do not have permission to ban members.', ephemeral: true });
            }

            const confirmButton = new ButtonBuilder()
                .setCustomId(`profile-ban-confirm-${userId}`)
                .setLabel('Confirm Ban')
                .setStyle(ButtonStyle.Danger);
            const cancelButton = new ButtonBuilder()
                .setCustomId(`profile-ban-cancel-${userId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);
            
            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            return interaction.reply({
                content: `⚠️ Are you sure you want to ban **${targetUser.tag}**?`,
                components: [row],
                ephemeral: true
            });
        }

        if (interaction.customId.startsWith('profile-ban-confirm-')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            }

            if (!client.isMemberAllowed(interaction.member)) {
                return interaction.reply({ content: 'You do not have permission to ban users.', ephemeral: true });
            }

            const userId = interaction.customId.split('-').slice(3).join('-');
            const targetUser = await client.users.fetch(userId).catch(() => null);

            if (!targetUser) {
                return interaction.reply({ content: 'User could not be found.', ephemeral: true });
            }

            const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);

            if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return interaction.reply({ content: 'I do not have permission to ban members.', ephemeral: true });
            }

            try {
                await client.sendModerationDm({
                    userId: userId,
                    guildName: interaction.guild.name,
                    action: 'ban',
                    reason: 'Banned via profile command'
                });

                await interaction.guild.members.ban(userId, { reason: 'Banned via profile command' });

                if (client.addModLog) {
                    let robloxId = null;
                    if (targetMember && client.bloxlink && client.bloxlink.cache) {
                        const cached = client.bloxlink.cache.get(userId);
                        if (cached) robloxId = cached.robloxId;
                    }

                    await client.addModLog({
                        client,
                        guildId: interaction.guild.id,
                        moderatorId: interaction.user.id,
                        targetId: userId,
                        action: 'ban',
                        reason: 'Banned via profile command',
                        robloxId
                    });
                }

                return interaction.update({
                    content: `✅ ${targetUser.tag} has been banned.`,
                    components: []
                });
            } catch (err) {
                console.error('Error banning user from profile button:', err);
                return interaction.reply({
                    content: 'An error occurred while attempting to ban the user.',
                    ephemeral: true
                });
            }
        }

        if (interaction.customId.startsWith('profile-ban-cancel-')) {
            return interaction.update({
                content: '❌ Ban cancelled.',
                components: []
            });
        }

        if (interaction.customId === 'gv_bonus_create' || interaction.customId === 'gv_bonus_cancel') {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            }

            const draftKey = client.getGiveawayDraftKey(interaction.guildId, interaction.user.id);
            const draft = client.giveawayDrafts.get(draftKey);
            if (!draft) {
                return interaction.reply({ content: 'No giveaway setup draft found. Run /gcreate again.', ephemeral: true });
            }

            if (interaction.customId === 'gv_bonus_cancel') {
                client.giveawayDrafts.delete(draftKey);
                return interaction.update({ content: 'Giveaway setup canceled.', embeds: [], components: [] });
            }

            if (interaction.customId === 'gv_bonus_create') {
                const now = Date.now();
                const selectedRoleIds = Array.isArray(draft.selectedBonusRoleIds)
                    ? draft.selectedBonusRoleIds.map(String)
                    : [];
                const giveaway = {
                    id: String(BigInt(now) * 1000000n + BigInt(Math.floor(Math.random() * 1_000_000))),
                    guildId: draft.guildId,
                    channelId: draft.channelId,
                    messageId: '',
                    hostId: draft.hostId,
                    prize: draft.prize,
                    description: draft.description,
                    durationMs: draft.durationMs,
                    winnerCount: draft.winnerCount,
                    createdAt: now,
                    endAt: now + draft.durationMs,
                    entries: [],
                    entryWeights: {},
                    ended: false,
                    winnerIds: [],
                    roleBonuses: client.getGiveawayRoleBonusesFromPresetSelection(draft.guildId, selectedRoleIds)
                };

                const channel = interaction.guild.channels.cache.get(draft.channelId)
                    || await interaction.guild.channels.fetch(draft.channelId).catch(() => null);
                if (!channel || !channel.isTextBased()) {
                    return interaction.reply({ content: 'Original channel is unavailable. Run /gcreate again.', ephemeral: true });
                }

                const msg = await channel.send({
                    embeds: [client.buildGiveawayEmbed(giveaway)],
                    components: client.buildGiveawayComponents(giveaway)
                });

                giveaway.messageId = msg.id;
                client.upsertGiveaway(interaction.guildId, giveaway);
                client.scheduleGiveaway(giveaway);
                client.giveawayDrafts.delete(draftKey);

                return interaction.update({
                    content: `The giveaway was successfully created! ID: ${giveaway.id}`,
                    embeds: [],
                    components: []
                });
            }
        }

        if (interaction.customId.startsWith('gv_join:') || interaction.customId.startsWith('gv_leave:')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This button must be used in a server channel.', ephemeral: true });
            }

            const giveawayId = interaction.customId.split(':')[1];
            const giveaway = client.getGiveaway(interaction.guildId, giveawayId);
            if (!giveaway) {
                return interaction.reply({ content: 'This giveaway could not be found.', ephemeral: true });
            }
            if (giveaway.ended) {
                return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
            }

            const isJoined = giveaway.entries.includes(interaction.user.id);

            if (interaction.customId.startsWith('gv_join:')) {
                if (isJoined) {
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`gv_leave:${giveaway.id}`)
                            .setLabel('Leave Giveaway')
                            .setStyle(ButtonStyle.Danger)
                    );

                    return interaction.reply({
                        content: 'You have already entered this giveaway!',
                        components: [row],
                        ephemeral: true
                    });
                }

                giveaway.entries.push(interaction.user.id);
                giveaway.entries = [...new Set(giveaway.entries)];
                giveaway.entryWeights = giveaway.entryWeights && typeof giveaway.entryWeights === 'object'
                    ? giveaway.entryWeights
                    : {};
                giveaway.entryWeights[interaction.user.id] = client.calculateGiveawayTicketsForMember(interaction.member, giveaway.roleBonuses || []);
                client.upsertGiveaway(interaction.guildId, giveaway);

                const resolved = await client.resolveGiveawayMessage(giveaway);
                if (resolved) {
                    await resolved.message.edit({
                        embeds: [client.buildGiveawayEmbed(giveaway)],
                        components: client.buildGiveawayComponents(giveaway)
                    }).catch(() => null);
                }

                return interaction.reply({ content: 'You are now entered in this giveaway.', ephemeral: true });
            }

            if (!isJoined) {
                return interaction.reply({ content: 'You are not currently entered in this giveaway.', ephemeral: true });
            }

            giveaway.entries = giveaway.entries.filter(id => id !== interaction.user.id);
            if (giveaway.entryWeights && typeof giveaway.entryWeights === 'object') {
                delete giveaway.entryWeights[interaction.user.id];
            }
            client.upsertGiveaway(interaction.guildId, giveaway);

            const resolved = await client.resolveGiveawayMessage(giveaway);
            if (resolved) {
                await resolved.message.edit({
                    embeds: [client.buildGiveawayEmbed(giveaway)],
                    components: client.buildGiveawayComponents(giveaway)
                }).catch(() => null);
            }

            return interaction.reply({ content: 'You have left this giveaway.', ephemeral: true });
        }

        if (interaction.customId === 'ar_create_start' || interaction.customId === 'ar_toggle_exact' || interaction.customId === 'ar_toggle_enabled' || interaction.customId === 'ar_edit_response' || interaction.customId === 'ar_save' || interaction.customId === 'ar_cancel' || interaction.customId === 'ar_config_users' || interaction.customId === 'ar_delete') {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            if (interaction.customId === 'ar_create_start') {
                const modal = new ModalBuilder()
                    .setCustomId('ar_create_modal')
                    .setTitle('Create Autoresponder');

                const triggerInput = new TextInputBuilder()
                    .setCustomId('ar_trigger')
                    .setLabel('Trigger Word/Phrase')
                    .setPlaceholder('Example: hello')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(120);

                const responseInput = new TextInputBuilder()
                    .setCustomId('ar_response')
                    .setLabel('Response Text')
                    .setPlaceholder('Enter the exact text the bot should send')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1800);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(triggerInput),
                    new ActionRowBuilder().addComponents(responseInput)
                );

                return interaction.showModal(modal);
            }

            const draftKey = client.getAutoresponderDraftKey(interaction.guildId, interaction.user.id);
            const draft = client.autoresponderDrafts.get(draftKey);
            if (!draft) {
                return interaction.reply({ content: 'No active autoresponder draft was found. Run /autoresponder again.', ephemeral: true });
            }

            if (interaction.customId === 'ar_toggle_exact') {
                draft.matchType = draft.matchType === 'exact' ? 'contains' : 'exact';
                client.autoresponderDrafts.set(draftKey, draft);
                return interaction.update({
                    content: 'Updated match mode.',
                    ...client.buildAutoresponderConfigPayload(draft)
                });
            }

            if (interaction.customId === 'ar_toggle_enabled') {
                draft.enabled = !draft.enabled;
                client.autoresponderDrafts.set(draftKey, draft);
                return interaction.update({
                    content: draft.enabled ? 'Autoresponder enabled.' : 'Autoresponder disabled.',
                    ...client.buildAutoresponderConfigPayload(draft)
                });
            }

            if (interaction.customId === 'ar_edit_response') {
                const modal = new ModalBuilder()
                    .setCustomId('ar_edit_response_modal')
                    .setTitle('Edit Autoresponder Response');

                const responseInput = new TextInputBuilder()
                    .setCustomId('ar_edit_response_text')
                    .setLabel('Response Text')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1800)
                    .setValue(draft.response || '');

                modal.addComponents(new ActionRowBuilder().addComponents(responseInput));
                return interaction.showModal(modal);
            }

            if (interaction.customId === 'ar_config_users') {
                return interaction.reply({
                    content: 'Configure user filters for this autoresponder below:',
                    ...client.buildAutoresponderUserConfigPayload(draft),
                    ephemeral: true
                });
            }

            if (interaction.customId === 'ar_cancel') {
                client.autoresponderDrafts.delete(draftKey);
                return interaction.update({ content: 'Autoresponder setup canceled.', embeds: [], components: [] });
            }

            if (interaction.customId === 'ar_delete') {
                if (!draft.editingId) {
                    return interaction.reply({ content: 'You can only delete an existing autoresponder while editing it.', ephemeral: true });
                }

                const removed = client.deleteAutoresponder(interaction.guildId, draft.editingId);
                client.autoresponderDrafts.delete(draftKey);
                if (!removed) {
                    return interaction.update({ content: 'That autoresponder was already removed.', embeds: [], components: [] });
                }

                return interaction.update({
                    content: `Deleted autoresponder for trigger \`${draft.trigger}\`.`,
                    embeds: [],
                    components: []
                });
            }

            if (interaction.customId === 'ar_save') {
                const entryId = draft.editingId || `ar_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
                const entry = { ...draft, id: entryId };
                delete entry.editingId;
                client.upsertAutoresponder(interaction.guildId, entry);
                client.autoresponderDrafts.delete(draftKey);

                return interaction.update({
                    content: `Saved autoresponder for trigger \`${entry.trigger}\`.`,
                    embeds: [],
                    components: []
                });
            }
        }

        if (interaction.customId.startsWith('globalmod_undo:')) {
            const undoKey = interaction.customId.split(':')[1];

            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this button.', ephemeral: true });
            }

            const actionData = client.getPendingGlobalModUndoAction(undoKey);
            if (!actionData) {
                return interaction.reply({ content: 'This undo action is no longer available.', ephemeral: true });
            }

            const sourceGuild = client.guilds.cache.get(actionData.sourceGuildId)
                || await client.guilds.fetch(actionData.sourceGuildId).catch(() => null);
            if (!sourceGuild) {
                return interaction.reply({ content: 'Source server is unavailable for undo.', ephemeral: true });
            }

            const actionLower = String(actionData.action || '').toLowerCase();
            let revertedAction = null;

            try {
                if (actionLower === 'mute') {
                    const member = await sourceGuild.members.fetch(actionData.userId).catch(() => null);
                    if (!member) {
                        return interaction.reply({ content: 'Member is no longer in the source server, so mute cannot be undone.', ephemeral: true });
                    }
                    await member.timeout(null, 'Undone from HQ global logs');
                    revertedAction = 'Unmute';
                } else if (actionLower === 'ban') {
                    await sourceGuild.members.unban(actionData.userId);
                    revertedAction = 'Unban';
                } else {
                    return interaction.reply({ content: 'This action type cannot be undone from global logs.', ephemeral: true });
                }

                if (client.addModLog) {
                    let robloxId = null;
                    try {
                        if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(sourceGuild.id, actionData.userId);
                    } catch (err) {
                        console.error('Failed to lookup robloxId for global undo modlog:', err);
                    }
                    client.addModLog(sourceGuild.id, {
                        action: revertedAction,
                        userId: actionData.userId,
                        userTag: actionData.userTag || `<@${actionData.userId}>`,
                        robloxId,
                        moderatorId: interaction.user.id,
                        moderatorTag: interaction.user.tag,
                        reason: 'Undone from HQ global logs',
                        timestamp: new Date().toISOString()
                    });
                }

                client.deletePendingGlobalModUndoAction(undoKey);

                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`globalmod_undo_used:${undoKey}`)
                        .setLabel('Undo Used')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );

                await interaction.update({ components: [disabledRow] });
                return interaction.followUp({
                    content: `${revertedAction} completed in ${sourceGuild.name} for <@${actionData.userId}>.`,
                    ephemeral: true
                });
            } catch (err) {
                console.error('[GlobalAudit] Undo failed:', err);
                return interaction.reply({ content: 'Failed to undo this action. Check permissions and current target state.', ephemeral: true });
            }
        }

        if (interaction.customId.startsWith('perms_undo:')) {
            const undoKey = interaction.customId.split(':')[1];

            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this button.', ephemeral: true });
            }

            const actionData = client.getPendingPermsUndoAction(undoKey);
            if (!actionData) {
                return interaction.reply({ content: 'This undo action is no longer available.', ephemeral: true });
            }

            if (actionData.hadExistingPermConfig) {
                client.allowedRoles.set(actionData.sourceGuildId, new Set(actionData.previousRoleIds));
            } else {
                client.allowedRoles.delete(actionData.sourceGuildId);
            }
            client.savePermissions();
            client.deletePendingPermsUndoAction(undoKey);

            const sourceGuild = client.guilds.cache.get(actionData.sourceGuildId)
                || await client.guilds.fetch(actionData.sourceGuildId).catch(() => null);

            const restoredRoleNames = actionData.previousRoleIds
                .map(id => sourceGuild?.roles?.cache?.get(id)?.name || `Unknown Role (${id})`);

            const restoredText = actionData.hadExistingPermConfig
                ? (restoredRoleNames.length ? restoredRoleNames.join(', ') : 'none (command access restricted to server admins only)')
                : 'unrestricted (all members can use bot commands)';

            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`perms_undo_used:${undoKey}`)
                    .setLabel('Undo Used')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            await interaction.update({ components: [disabledRow] });
            return interaction.followUp({
                content: `Perms were reverted for guild ${actionData.sourceGuildId}. Restored roles: ${restoredText}`,
                ephemeral: true
            });
        }

        if (interaction.customId.startsWith('mute_unmute_specific:') || interaction.customId.startsWith('mute_unmute_all:') || interaction.customId.startsWith('ban_unban_specific:') || interaction.customId.startsWith('ban_unban_all:')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }

            const actionKey = interaction.customId.split(':')[1];
            const actionData = client.getPendingModerationAction(actionKey);
            if (!actionData) {
                return interaction.reply({ content: 'This action is no longer available.', ephemeral: true });
            }
            if (interaction.user.id !== actionData.moderatorId) {
                return interaction.reply({ content: 'Only the moderator who ran the command can use this button.', ephemeral: true });
            }

            const isUnmuteSpecific = interaction.customId.startsWith('mute_unmute_specific:');
            const isUnmuteAll = interaction.customId.startsWith('mute_unmute_all:');
            const isUnbanSpecific = interaction.customId.startsWith('ban_unban_specific:');
            const isUnbanAll = interaction.customId.startsWith('ban_unban_all:');

            if (isUnmuteSpecific || isUnbanSpecific) {
                const verb = isUnmuteSpecific ? 'unmute' : 'unban';
                const options = actionData.users.slice(0, 25).map(user => ({
                    label: user.tag,
                    value: user.id,
                    description: `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${user.tag}`.slice(0, 50)
                }));

                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`${isUnmuteSpecific ? 'mute_unmute_specific_select' : 'ban_unban_specific_select'}:${actionKey}`)
                    .setPlaceholder(`Select users to ${verb}`)
                    .setMinValues(1)
                    .setMaxValues(Math.min(actionData.users.length, 25))
                    .addOptions(options);

                const row = new ActionRowBuilder().addComponents(menu);
                return interaction.reply({ content: `Select the user(s) to ${verb} for this action:`, components: [row], ephemeral: true });
            }

            if (isUnmuteAll || isUnbanAll) {
                const results = await Promise.all(actionData.users.map(async (user) => {
                    try {
                        if (actionData.type === 'mute') {
                            const member = await interaction.guild.members.fetch(user.id);
                            if (!member) {
                                return { user, success: false, reason: 'Member not found' };
                            }
                            await member.timeout(null, 'Unmuted via button');
                        } else {
                            await interaction.guild.members.unban(user.id);
                        }

                        if (client.addModLog) {
                            let robloxId = null;
                            try {
                                if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(interaction.guild.id, user.id);
                            } catch (err) {
                                console.error('Failed to lookup robloxId for modlog:', err);
                            }
                            client.addModLog(interaction.guild.id, {
                                action: actionData.type === 'mute' ? 'Unmute' : 'Unban',
                                userId: user.id,
                                userTag: user.tag,
                                robloxId,
                                moderatorId: interaction.user.id,
                                moderatorTag: interaction.user.tag,
                                timestamp: new Date().toISOString()
                            });
                        }
                        return { user, success: true };
                    } catch (error) {
                        console.error(error);
                        return { user, success: false, reason: error.message };
                    }
                }));

                client.deletePendingModerationAction(actionKey);
                const successCount = results.filter(r => r.success).length;
                const failCount = results.length - successCount;
                if (successCount > 0 && client.sendActionStatusCard) {
                    const statusText = isUnmuteAll
                        ? (successCount === 1 ? 'A user was unmuted.' : `${successCount} users were unmuted.`)
                        : (successCount === 1 ? 'A user was unbanned.' : `${successCount} users were unbanned.`);
                    await client.sendActionStatusCard(interaction.channel || interaction.channelId, statusText);
                }
                const names = results.map(r => `${r.success ? `<@${r.user.id}>` : `${r.user.tag}`}`).join(', ');
                return interaction.reply({ content: `${actionData.type === 'mute' ? 'Unmute' : 'Unban'} all complete: ${successCount} succeeded, ${failCount} failed. ${names}`, ephemeral: true });
            }
        }

        if (interaction.customId === 'modlogs_remove_button') {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }

            const logs = client.getModLogs(interaction.guild.id);
            if (!logs.length) {
                return interaction.reply({ content: 'No moderation logs are available to remove.', ephemeral: true });
            }

            const options = logs.slice(0, 25).map(log => ({
                label: `Case ${log.caseNumber ?? log.caseId ?? 'N/A'} - ${log.action}`,
                value: String(log.caseNumber ?? log.caseId),
                description: log.reason ? log.reason.slice(0, 50) : 'No reason provided'
            }));

            const menu = new StringSelectMenuBuilder()
                .setCustomId('modlogs_remove_select')
                .setPlaceholder('Select a case to remove')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(menu);
            return interaction.reply({ content: 'Choose a case to remove from the modlogs:', components: [row], ephemeral: true });
        }
    }

    if (interaction.isChannelSelectMenu()) {
        if (interaction.customId.startsWith('manage_')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            }
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const manageCommand = client.slashCommands.get('manage');
            if (manageCommand && typeof manageCommand.handleChannelSelect === 'function') {
                const handled = await manageCommand.handleChannelSelect({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId !== 'ar_allowed_channels' && interaction.customId !== 'ar_ignored_channels') return;

        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
            return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
        }

        const draftKey = client.getAutoresponderDraftKey(interaction.guildId, interaction.user.id);
        const draft = client.autoresponderDrafts.get(draftKey);
        if (!draft) {
            return interaction.reply({ content: 'No active autoresponder draft was found. Run /autoresponder again.', ephemeral: true });
        }

        if (interaction.customId === 'ar_allowed_channels') {
            draft.allowedChannelIds = [...new Set(interaction.values.map(String))];
            draft.ignoredChannelIds = draft.ignoredChannelIds.filter(id => !draft.allowedChannelIds.includes(id));
        } else {
            draft.ignoredChannelIds = [...new Set(interaction.values.map(String))];
            draft.allowedChannelIds = draft.allowedChannelIds.filter(id => !draft.ignoredChannelIds.includes(id));
        }
        client.autoresponderDrafts.set(draftKey, draft);

        return interaction.update({
            content: 'Updated channel filters.',
            ...client.buildAutoresponderConfigPayload(draft)
        });
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('manage_')) {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const manageCommand = client.slashCommands.get('manage');
            if (manageCommand && typeof manageCommand.handleStringSelect === 'function') {
                const handled = await manageCommand.handleStringSelect({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId === 'gv_bonus_roles') {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            }

            const draftKey = client.getGiveawayDraftKey(interaction.guildId, interaction.user.id);
            const draft = client.giveawayDrafts.get(draftKey);
            if (!draft) {
                return interaction.reply({ content: 'No giveaway setup draft found. Run /gcreate again.', ephemeral: true });
            }

            draft.selectedBonusRoleIds = [...new Set(interaction.values.map(String))];
            draft.roleBonuses = client.getGiveawayRoleBonusesFromPresetSelection(interaction.guildId, draft.selectedBonusRoleIds);
            client.giveawayDrafts.set(draftKey, draft);

            return interaction.update(client.buildGiveawayDraftPayload(draft));
        }

        if (interaction.customId === 'ar_existing_select') {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const selectedId = interaction.values[0];
            const all = client.getAutoresponders(interaction.guildId);
            const existing = all.find(item => item.id === selectedId);
            if (!existing) {
                return interaction.reply({ content: 'That autoresponder no longer exists.', ephemeral: true });
            }

            const draftKey = client.getAutoresponderDraftKey(interaction.guildId, interaction.user.id);
            const draft = {
                trigger: existing.trigger,
                response: existing.response,
                enabled: existing.enabled !== false,
                matchType: existing.matchType === 'exact' ? 'exact' : 'contains',
                allowedChannelIds: Array.isArray(existing.allowedChannelIds) ? [...existing.allowedChannelIds] : [],
                ignoredChannelIds: Array.isArray(existing.ignoredChannelIds) ? [...existing.ignoredChannelIds] : [],
                allowedRoleIds: Array.isArray(existing.allowedRoleIds) ? [...existing.allowedRoleIds] : [],
                ignoredRoleIds: Array.isArray(existing.ignoredRoleIds) ? [...existing.ignoredRoleIds] : [],
                allowedUserIds: Array.isArray(existing.allowedUserIds) ? [...existing.allowedUserIds] : [],
                ignoredUserIds: Array.isArray(existing.ignoredUserIds) ? [...existing.ignoredUserIds] : [],
                createdBy: existing.createdBy || interaction.user.id,
                createdAt: existing.createdAt || new Date().toISOString(),
                editingId: existing.id
            };
            client.autoresponderDrafts.set(draftKey, draft);

            return interaction.update({
                content: 'Editing selected autoresponder:',
                ...client.buildAutoresponderConfigPayload(draft)
            });
        }

        if (interaction.customId.startsWith('mute_unmute_specific_select:') || interaction.customId.startsWith('ban_unban_specific_select:')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }

            const actionKey = interaction.customId.split(':')[1];
            const actionData = client.getPendingModerationAction(actionKey);
            if (!actionData) {
                return interaction.reply({ content: 'This action is no longer available.', ephemeral: true });
            }
            if (interaction.user.id !== actionData.moderatorId) {
                return interaction.reply({ content: 'Only the moderator who ran the command can use this selection.', ephemeral: true });
            }

            const isUnmute = interaction.customId.startsWith('mute_unmute_specific_select:');
            const selectedUsers = interaction.values;
            const results = await Promise.all(selectedUsers.map(async (userId) => {
                const user = actionData.users.find(u => u.id === userId);
                try {
                    if (isUnmute) {
                        const member = await interaction.guild.members.fetch(userId);
                        if (!member) {
                            return { user, success: false, reason: 'Member not found' };
                        }
                        await member.timeout(null, 'Unmuted via button');
                    } else {
                        await interaction.guild.members.unban(userId);
                    }

                    if (client.addModLog) {
                        let robloxId = null;
                        try {
                            if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(interaction.guild.id, userId);
                        } catch (err) {
                            console.error('Failed to lookup robloxId for modlog:', err);
                        }
                        client.addModLog(interaction.guild.id, {
                            action: isUnmute ? 'Unmute' : 'Unban',
                            userId: userId,
                            userTag: user?.tag || 'Unknown',
                            robloxId,
                            moderatorId: interaction.user.id,
                            moderatorTag: interaction.user.tag,
                            timestamp: new Date().toISOString()
                        });
                    }
                    return { user, success: true };
                } catch (error) {
                    console.error(error);
                    return { user, success: false, reason: error.message };
                }
            }));

            client.deletePendingModerationAction(actionKey);
            const successCount = results.filter(r => r.success).length;
            const failCount = results.length - successCount;
            if (successCount > 0 && client.sendActionStatusCard) {
                const statusText = isUnmute
                    ? (successCount === 1 ? 'A user was unmuted.' : `${successCount} users were unmuted.`)
                    : (successCount === 1 ? 'A user was unbanned.' : `${successCount} users were unbanned.`);
                await client.sendActionStatusCard(interaction.channel || interaction.channelId, statusText);
            }
            const names = results.map(r => `${r.success ? `<@${r.user.id}>` : `${r.user?.tag ?? r.userId}`}`).join(', ');
            return interaction.reply({ content: `Selected ${isUnmute ? 'unmute' : 'unban'} complete: ${successCount} succeeded, ${failCount} failed. ${names}`, ephemeral: true });
        }

        if (interaction.customId.startsWith('banevaders_action:')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }

            const actionKey = interaction.customId.split(':')[1];
            const actionData = client.getPendingModerationAction(actionKey);
            if (!actionData) {
                return interaction.reply({ content: 'This action is no longer available.', ephemeral: true });
            }
            if (interaction.user.id !== actionData.moderatorId) {
                return interaction.reply({ content: 'Only the moderator who ran the command can use this selection.', ephemeral: true });
            }

            const selectedAction = interaction.values[0];
            if (!['ban', 'kick'].includes(selectedAction)) {
                return interaction.reply({ content: 'Invalid action selected.', ephemeral: true });
            }

            const results = await Promise.all(actionData.users.map(async (user) => {
                try {
                    if (selectedAction === 'ban') {
                        await interaction.guild.members.ban(user.id, { reason: 'Ban evader detected by /banevaders' });
                    } else {
                        const member = await interaction.guild.members.fetch(user.id);
                        if (!member) {
                            return { user, success: false, reason: 'Member not found' };
                        }
                        await member.kick('Kick evader detected by /banevaders');
                    }

                    if (client.addModLog) {
                        let robloxId = null;
                        try {
                            if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(interaction.guild.id, user.id);
                        } catch (err) {
                            console.error('Failed to lookup robloxId for modlog:', err);
                        }
                        client.addModLog(interaction.guild.id, {
                            action: selectedAction === 'ban' ? 'Ban' : 'Kick',
                            userId: user.id,
                            userTag: user.tag,
                            robloxId,
                            moderatorId: interaction.user.id,
                            moderatorTag: interaction.user.tag,
                            timestamp: new Date().toISOString()
                        });
                    }

                    return { user, success: true };
                } catch (error) {
                    console.error(error);
                    return { user, success: false, reason: error.message };
                }
            }));

            client.deletePendingModerationAction(actionKey);
            const successCount = results.filter(r => r.success).length;
            const failCount = results.length - successCount;
            const names = results.map(r => `${r.success ? `<@${r.user.id}>` : `${r.user.tag}`}`).join(', ');

            if (selectedAction === 'ban' && successCount > 0 && client.sendBanSticker) {
                await client.sendBanSticker(interaction.channel);
            }

            return interaction.reply({ content: `${selectedAction === 'ban' ? 'Ban' : 'Kick'} complete: ${successCount} succeeded, ${failCount} failed. ${names}`, ephemeral: true });
        }

        if (interaction.customId === 'modlogs_remove_select') {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }

            const selectedCase = interaction.values[0];
            const removedLog = client.removeModLogCase(interaction.guild.id, selectedCase);
            if (!removedLog) {
                return interaction.reply({ content: 'Selected case not found.', ephemeral: true });
            }

            return interaction.reply({ content: `Removed Case ${removedLog.caseNumber ?? removedLog.caseId}.`, ephemeral: true });
        }
    }

    if (interaction.isRoleSelectMenu()) {
        if (interaction.customId.startsWith('manage_')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            }
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const manageCommand = client.slashCommands.get('manage');
            if (manageCommand && typeof manageCommand.handleRoleSelect === 'function') {
                const handled = await manageCommand.handleRoleSelect({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId === 'publicperms_role_select') {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            if (!interaction.guild) {
                return interaction.reply({ content: 'This action must be used in a server channel.', ephemeral: true });
            }

            const draftKey = `${interaction.guild.id}:${interaction.user.id}`;
            client.publicPermDrafts = client.publicPermDrafts || new Map();
            const draft = client.publicPermDrafts.get(draftKey) || {};
            draft.selectedRoleIds = [...new Set(interaction.values.map(String))];
            client.publicPermDrafts.set(draftKey, draft);

            return interaction.update({
                content: `Selected ${draft.selectedRoleIds.length} public role(s). Click Save to apply.`,
                components: interaction.message.components
            });
        }
    }

    if (interaction.isUserSelectMenu()) {
        if (interaction.customId.startsWith('manage_')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
            }

            const manageCommand = client.slashCommands.get('manage');
            if (manageCommand && typeof manageCommand.handleUserSelect === 'function') {
                const handled = await manageCommand.handleUserSelect({ client, interaction });
                if (handled) return;
            }
        }

        if (interaction.customId !== 'ar_allowed_users' && interaction.customId !== 'ar_ignored_users') return;

        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
            return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
        }

        const draftKey = client.getAutoresponderDraftKey(interaction.guildId, interaction.user.id);
        const draft = client.autoresponderDrafts.get(draftKey);
        if (!draft) {
            return interaction.reply({ content: 'No active autoresponder draft was found. Run /autoresponder again.', ephemeral: true });
        }

        if (interaction.customId === 'ar_allowed_users') {
            draft.allowedUserIds = [...new Set(interaction.values.map(String))];
            draft.ignoredUserIds = draft.ignoredUserIds.filter(id => !draft.allowedUserIds.includes(id));
        } else {
            draft.ignoredUserIds = [...new Set(interaction.values.map(String))];
            draft.allowedUserIds = draft.allowedUserIds.filter(id => !draft.ignoredUserIds.includes(id));
        }
        client.autoresponderDrafts.set(draftKey, draft);

        return interaction.update({
            content: 'Updated user filters. Return to the main autoresponder setup message and press Save when finished.',
            ...client.buildAutoresponderUserConfigPayload(draft)
        });
    }

    if (!interaction.isRoleSelectMenu()) return;

    if (interaction.customId === 'ar_allowed_roles' || interaction.customId === 'ar_ignored_roles') {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }
        if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
            return interaction.reply({ content: 'Only the bot admins can use this action.', ephemeral: true });
        }

        const draftKey = client.getAutoresponderDraftKey(interaction.guildId, interaction.user.id);
        const draft = client.autoresponderDrafts.get(draftKey);
        if (!draft) {
            return interaction.reply({ content: 'No active autoresponder draft was found. Run /autoresponder again.', ephemeral: true });
        }

        if (interaction.customId === 'ar_allowed_roles') {
            draft.allowedRoleIds = [...new Set(interaction.values.map(String))];
            draft.ignoredRoleIds = draft.ignoredRoleIds.filter(id => !draft.allowedRoleIds.includes(id));
        } else {
            draft.ignoredRoleIds = [...new Set(interaction.values.map(String))];
            draft.allowedRoleIds = draft.allowedRoleIds.filter(id => !draft.ignoredRoleIds.includes(id));
        }
        client.autoresponderDrafts.set(draftKey, draft);

        return interaction.update({
            content: 'Updated role filters.',
            ...client.buildAutoresponderConfigPayload(draft)
        });
    }

    if (interaction.customId !== 'perms-role-select') return;

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'Only users with Manage Server can configure permitted roles.', ephemeral: true });
    }

    const hadExistingPermConfig = client.allowedRoles.has(interaction.guildId);
    const previousRoleSet = hadExistingPermConfig ? client.allowedRoles.get(interaction.guildId) : null;
    const previousRoleIds = previousRoleSet ? Array.from(previousRoleSet) : [];

    const selectedRoleIds = interaction.values;
    client.allowedRoles.set(interaction.guildId, new Set(selectedRoleIds));
    client.savePermissions();

    const selectedRoleNames = selectedRoleIds
        .map(id => interaction.guild.roles.cache.get(id)?.name || `Unknown Role (${id})`);

    try {
        await client.ensureModeratorPermCardsByRoleNames(selectedRoleNames);
    } catch (err) {
        console.error('Failed to seed moderator level perm Trello cards from /perms update:', err);
    }

    const roleList = selectedRoleIds.length
        ? selectedRoleIds.map(id => `<@&${id}>`).join(', ')
        : 'none (command access will be restricted to server admins only)';

    await interaction.reply({ content: `Allowed roles updated: ${roleList}`, ephemeral: true });
    await client.logPermsAudit(interaction, selectedRoleNames, { hadExistingPermConfig, previousRoleIds });
    } catch (err) {
        if (client.isIgnorableInteractionError(err)) {
            const label = interaction.commandName || interaction.customId || interaction.type;
            console.warn(`[Interaction] Ignoring already-acknowledged/expired interaction: ${label}`);
            return;
        }
        console.error('[Interaction] Unhandled interaction error:', err);
    }
});

// Boost message types (plain boost + tier 1/2/3 upgrades)
const BOOST_MESSAGE_TYPES = new Set([8, 9, 10, 11]);

// Primary: detect boost via role change, then find and react to the system message
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.premiumSince || !newMember.premiumSince) return;

    const boostChannelId = client.boostChannels.get(newMember.guild.id);
    if (!boostChannelId) return;

    // Wait for Discord to post the system message
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        const channel = newMember.guild.channels.cache.get(boostChannelId)
            || await newMember.guild.channels.fetch(boostChannelId);
        if (!channel || !channel.isTextBased()) return;

        const messages = await channel.messages.fetch({ limit: 5 });
        const cutoff = Date.now() - 20000;
        const boostMsg = messages.find(m =>
            BOOST_MESSAGE_TYPES.has(m.type) && m.createdTimestamp > cutoff
        );

        if (boostMsg && !boostMsg.reactions.cache.has('❤️')) {
            await boostMsg.react('❤️');
        }
    } catch (err) {
        console.error('Failed to react to boost message:', err);
    }
});

// Fallback: also catch boost system messages directly via messageCreate
client.on('messageCreate', async (message) => {
    if (BOOST_MESSAGE_TYPES.has(message.type) && message.guild) {
        const boostChannelId = client.boostChannels.get(message.guild.id);
        if (boostChannelId && message.channel.id === boostChannelId) {
            try {
                if (!message.reactions.cache.has('❤️')) await message.react('❤️');
            } catch (err) {
                console.error('Failed to react to boost message (messageCreate):', err);
            }
        }
    }

    if (message.author?.bot) return;

    if (message.guild && message.member && message.content) {
        const guildAutomodRules = client.getAutomodRules(message.guild.id);
        if (guildAutomodRules.length) {
            const contentLower = message.content.toLowerCase();
            const now = Date.now();

            for (const rule of guildAutomodRules) {
                if (!rule.enabled) continue;

                if (rule.ignoreAdmins && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    continue;
                }

                const allowedChannels = Array.isArray(rule.allowedChannelIds) ? rule.allowedChannelIds : [];
                const ignoredChannels = Array.isArray(rule.ignoredChannelIds) ? rule.ignoredChannelIds : [];
                const allowedRoles = Array.isArray(rule.allowedRoleIds) ? rule.allowedRoleIds : [];
                const ignoredRoles = Array.isArray(rule.ignoredRoleIds) ? rule.ignoredRoleIds : [];
                const allowedUsers = Array.isArray(rule.allowedUserIds) ? rule.allowedUserIds : [];
                const ignoredUsers = Array.isArray(rule.ignoredUserIds) ? rule.ignoredUserIds : [];
                const hasAllowedIdentityFilters = allowedRoles.length > 0 || allowedUsers.length > 0;
                const matchesAllowedRole = allowedRoles.length > 0 && message.member.roles.cache.some(role => allowedRoles.includes(role.id));
                const matchesAllowedUser = allowedUsers.includes(message.author.id);

                if (allowedChannels.length && !allowedChannels.includes(message.channel.id)) continue;
                if (ignoredChannels.includes(message.channel.id)) continue;
                if (ignoredRoles.length && message.member.roles.cache.some(role => ignoredRoles.includes(role.id))) continue;
                if (ignoredUsers.includes(message.author.id)) continue;
                if (hasAllowedIdentityFilters && !matchesAllowedRole && !matchesAllowedUser) continue;

                const type = String(rule.type || (rule.trigger ? 'keyword' : 'anti_links')).trim().toLowerCase();
                const normalizedActions = [...new Set((Array.isArray(rule.actions) ? rule.actions : [rule.action || 'delete'])
                    .map(v => String(v || '').trim().toLowerCase())
                    .filter(v => ['delete', 'delete_warn', 'timeout', 'kick', 'ban'].includes(v)))];
                const actions = normalizedActions.length ? normalizedActions : ['delete'];
                const custom = rule.custom && typeof rule.custom === 'object' ? rule.custom : {};
                let matched = false;
                let matchDetails = null;

                if (type === 'mentions_cooldown') {
                    const mentionCount = (message.mentions.users?.size || 0) + (message.mentions.roles?.size || 0);
                    if (mentionCount > 0) {
                        const maxMentions = Math.max(1, Number(custom.maxMentions) || 6);
                        const windowMs = Math.max(1000, (Number(custom.windowSeconds) || 30) * 1000);
                        const bucketKey = `${message.guild.id}:${message.author.id}:${rule.id}`;
                        const bucket = client.automodMentionBuckets.get(bucketKey) || [];
                        const filtered = bucket.filter(item => now - item.ts <= windowMs);
                        filtered.push({ ts: now, count: mentionCount });
                        client.automodMentionBuckets.set(bucketKey, filtered);
                        const totalMentions = filtered.reduce((sum, item) => sum + item.count, 0);
                        matched = totalMentions >= maxMentions;
                        matchDetails = `${totalMentions} mentions in ${Math.round(windowMs / 1000)}s`;
                    }
                } else if (type === 'fast_message_spam') {
                    const maxMessages = Math.max(2, Number(custom.maxMessages) || 8);
                    const windowMs = Math.max(1000, (Number(custom.windowSeconds) || 5) * 1000);
                    const bucketKey = `${message.guild.id}:${message.author.id}:${rule.id}`;
                    const bucket = client.automodMessageBuckets.get(bucketKey) || [];
                    const filtered = bucket.filter(ts => now - ts <= windowMs);
                    filtered.push(now);
                    client.automodMessageBuckets.set(bucketKey, filtered);
                    matched = filtered.length >= maxMessages;
                    matchDetails = `${filtered.length} messages in ${Math.round(windowMs / 1000)}s`;
                } else if (type === 'anti_newline') {
                    const maxNewlines = Math.max(1, Number(custom.maxNewlines) || 7);
                    const runs = message.content.match(/\n+/g) || [];
                    const highestRun = runs.length ? Math.max(...runs.map(run => run.length)) : 0;
                    matched = highestRun >= maxNewlines;
                    matchDetails = `newline run: ${highestRun}`;
                } else if (type === 'character_count') {
                    const maxCharacters = Math.max(25, Number(custom.maxCharacters) || 350);
                    matched = message.content.length >= maxCharacters;
                    matchDetails = `characters: ${message.content.length}`;
                } else if (type === 'emoji_spam') {
                    const maxEmojis = Math.max(1, Number(custom.maxEmojis) || 6);
                    const customEmojiCount = (message.content.match(/<a?:\w+:\d+>/g) || []).length;
                    const unicodeEmojiCount = (message.content.match(/\p{Extended_Pictographic}/gu) || []).length;
                    const emojiCount = customEmojiCount + unicodeEmojiCount;
                    matched = emojiCount >= maxEmojis;
                    matchDetails = `emoji count: ${emojiCount}`;
                } else if (type === 'word_blacklist') {
                    const wildcardWords = Array.isArray(custom.bannedWordsWildcard) ? custom.bannedWordsWildcard.map(v => String(v).toLowerCase()) : [];
                    const exactWords = Array.isArray(custom.bannedWordsExact) ? custom.bannedWordsExact.map(v => String(v).toLowerCase()) : [];
                    const normalizedTokens = contentLower.split(/[^a-z0-9_]+/g).filter(Boolean);
                    const hasWildcard = wildcardWords.some(word => word && contentLower.includes(word));
                    const hasExact = exactWords.some(word => word && normalizedTokens.includes(word));
                    matched = hasWildcard || hasExact;
                    matchDetails = hasExact ? 'exact banned word' : (hasWildcard ? 'wildcard banned phrase' : null);
                } else if (type === 'anti_links') {
                    const links = message.content.match(/((?:https?:\/\/|www\.)[^\s<]+)/gi) || [];
                    if (links.length) {
                        const deleteAllLinks = custom.deleteAllLinks !== false;
                        const allowlist = Array.isArray(custom.allowedLinks) ? custom.allowedLinks.map(v => String(v).toLowerCase()) : [];
                        const disallowed = links.filter((link) => {
                            const lower = link.toLowerCase();
                            if (deleteAllLinks) return !allowlist.some(prefix => prefix && lower.includes(prefix));
                            return !allowlist.some(prefix => prefix && lower.includes(prefix));
                        });
                        matched = deleteAllLinks ? disallowed.length > 0 : disallowed.length > 0;
                        matchDetails = `links found: ${links.length}`;
                    }
                } else if (type === 'invite_links') {
                    const inviteMatches = [...message.content.matchAll(/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/gi)];
                    if (inviteMatches.length) {
                        const allowedInvites = Array.isArray(custom.allowedInvites)
                            ? custom.allowedInvites.map(v => String(v).toLowerCase())
                            : [];
                        const blocked = inviteMatches.filter((match) => {
                            const code = String(match[1] || '').toLowerCase();
                            const full = String(match[0] || '').toLowerCase();
                            return !allowedInvites.some(value => value && (code === value || full.includes(value)));
                        });
                        matched = blocked.length > 0;
                        matchDetails = `invite links: ${inviteMatches.length}`;
                    }
                } else if (type === 'masked_links') {
                    const masked = [...message.content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi)];
                    matched = masked.some(match => {
                        const text = String(match[1] || '').toLowerCase();
                        const url = String(match[2] || '').toLowerCase();
                        return !text.includes(url.replace(/^https?:\/\//, ''));
                    });
                    matchDetails = matched ? 'masked markdown link' : null;
                } else if (type === 'zalgo_text') {
                    const zalgoMarks = message.content.match(/[\u0300-\u036f\u0483-\u0489\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED]/g) || [];
                    matched = zalgoMarks.length >= 6;
                    matchDetails = `zalgo marks: ${zalgoMarks.length}`;
                } else {
                    const trigger = String(rule.trigger || '').trim().toLowerCase();
                    if (!trigger) continue;
                    matched = rule.matchType === 'exact'
                        ? contentLower === trigger
                        : contentLower.includes(trigger);
                    matchDetails = `keyword: ${trigger}`;
                }

                if (!matched) continue;

                const reason = `AutoMod ${rule.name || rule.type || 'rule'} matched (${matchDetails || 'rule trigger'})`;
                const logChannelId = String(rule.logChannelId || '').trim();
                const customResponse = String(rule.customResponse || '').trim();
                const executedActions = [];
                let messageDeleted = false;
                const ensureDeleted = async () => {
                    if (messageDeleted) return;
                    if (message.deletable) {
                        await message.delete().catch(err => console.error('AutoMod failed to delete message:', err));
                        messageDeleted = true;
                    }
                };

                for (const action of actions) {
                    if (action === 'delete') {
                        await ensureDeleted();
                        executedActions.push('Delete');
                        continue;
                    }

                    if (action === 'delete_warn') {
                        await ensureDeleted();
                        const warning = await message.channel.send({
                            content: customResponse || `<@${message.author.id}>, your message was removed by AutoMod.`,
                            allowedMentions: { parse: [], users: [message.author.id], roles: [], repliedUser: false }
                        }).catch(() => null);
                        executedActions.push('Warn + Delete');

                        if (warning) {
                            setTimeout(() => {
                                warning.delete().catch(() => {});
                            }, 10_000);
                        }
                        continue;
                    }

                    if (action === 'timeout') {
                        const timeoutMs = parseDurationMs(String(rule.timeoutDuration || '').trim()) || parseDurationMs('10m');
                        if (timeoutMs && message.member.moderatable && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            await message.member.timeout(timeoutMs, reason)
                                .catch(err => console.error('AutoMod failed to timeout member:', err));

                            if (typeof client.addModLog === 'function') {
                                client.addModLog(message.guild.id, {
                                    action: 'Mute',
                                    userId: message.author.id,
                                    userTag: message.author.tag,
                                    moderatorId: client.user?.id || '0',
                                    moderatorTag: `${client.user?.tag || 'AutoMod'}`,
                                    reason,
                                    duration: String(rule.timeoutDuration || '10m'),
                                    timestamp: new Date().toISOString(),
                                    infractionRule: 'automod',
                                    infractionRuleLabel: 'AutoMod'
                                });
                            }
                        }
                        executedActions.push(`Timeout (${String(rule.timeoutDuration || '10m')})`);
                        continue;
                    }

                    if (action === 'kick') {
                        if (message.member.kickable && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            await message.member.kick(reason).catch(err => console.error('AutoMod failed to kick member:', err));
                            if (typeof client.addModLog === 'function') {
                                client.addModLog(message.guild.id, {
                                    action: 'Kick',
                                    userId: message.author.id,
                                    userTag: message.author.tag,
                                    moderatorId: client.user?.id || '0',
                                    moderatorTag: `${client.user?.tag || 'AutoMod'}`,
                                    reason,
                                    timestamp: new Date().toISOString(),
                                    infractionRule: 'automod',
                                    infractionRuleLabel: 'AutoMod'
                                });
                            }
                        }
                        executedActions.push('Kick');
                        continue;
                    }

                    if (action === 'ban') {
                        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            await message.guild.members.ban(message.author.id, { reason }).catch(err => console.error('AutoMod failed to ban member:', err));
                            if (typeof client.addModLog === 'function') {
                                client.addModLog(message.guild.id, {
                                    action: 'Ban',
                                    userId: message.author.id,
                                    userTag: message.author.tag,
                                    moderatorId: client.user?.id || '0',
                                    moderatorTag: `${client.user?.tag || 'AutoMod'}`,
                                    reason,
                                    timestamp: new Date().toISOString(),
                                    infractionRule: 'automod',
                                    infractionRuleLabel: 'AutoMod'
                                });
                            }
                        }
                        executedActions.push('Ban');
                    }
                }

                if (logChannelId) {
                    const logChannel = message.guild.channels.cache.get(logChannelId)
                        || await message.guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel && logChannel.isTextBased()) {
                        const preview = String(message.content || '').slice(0, 300) || '(no text content)';
                        const avatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 256 });
                        const automodEmbed = new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('AutoMod Triggered')
                            .setThumbnail(avatarUrl)
                            .addFields(
                                { name: 'Rule', value: String(rule.name || rule.type || 'Unknown Rule').slice(0, 1024), inline: true },
                                { name: 'Actions', value: String(executedActions.length ? executedActions.join(', ') : actions.join(', ')).slice(0, 1024), inline: true },
                                { name: 'User', value: `<@${message.author.id}> (${message.author.tag})`, inline: false },
                                { name: 'User ID', value: message.author.id, inline: true },
                                { name: 'Profile Picture', value: `[Open Avatar](${avatarUrl})`, inline: true },
                                { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                                { name: 'Reason', value: String(reason).slice(0, 1024), inline: false },
                                { name: 'Message', value: String(preview).slice(0, 1024), inline: false }
                            )
                            .setTimestamp();

                        await logChannel.send({
                            embeds: [automodEmbed],
                            allowedMentions: { parse: [], users: [], roles: [], repliedUser: false }
                        }).catch(() => {});
                    }
                }

                break;
            }
        }

        const guildAutoresponders = client.getAutoresponders(message.guild.id);
        if (guildAutoresponders.length) {
            const contentLower = message.content.toLowerCase();

            for (const responder of guildAutoresponders) {
                if (!responder.enabled) continue;

                const trigger = String(responder.trigger || '').trim().toLowerCase();
                if (!trigger) continue;

                const allowedChannels = Array.isArray(responder.allowedChannelIds) ? responder.allowedChannelIds : [];
                const ignoredChannels = Array.isArray(responder.ignoredChannelIds) ? responder.ignoredChannelIds : [];
                const allowedRoles = Array.isArray(responder.allowedRoleIds) ? responder.allowedRoleIds : [];
                const ignoredRoles = Array.isArray(responder.ignoredRoleIds) ? responder.ignoredRoleIds : [];
                const allowedUsers = Array.isArray(responder.allowedUserIds) ? responder.allowedUserIds : [];
                const ignoredUsers = Array.isArray(responder.ignoredUserIds) ? responder.ignoredUserIds : [];
                const hasAllowedIdentityFilters = allowedRoles.length > 0 || allowedUsers.length > 0;
                const matchesAllowedRole = allowedRoles.length > 0 && message.member.roles.cache.some(role => allowedRoles.includes(role.id));
                const matchesAllowedUser = allowedUsers.includes(message.author.id);

                if (allowedChannels.length && !allowedChannels.includes(message.channel.id)) continue;
                if (ignoredChannels.includes(message.channel.id)) continue;
                if (ignoredRoles.length && message.member.roles.cache.some(role => ignoredRoles.includes(role.id))) continue;
                if (ignoredUsers.includes(message.author.id)) continue;
                if (hasAllowedIdentityFilters && !matchesAllowedRole && !matchesAllowedUser) continue;

                const isMatch = responder.matchType === 'exact'
                    ? contentLower === trigger
                    : contentLower.includes(trigger);
                if (!isMatch) continue;

                const cooldownKey = `${message.guild.id}:${message.channel.id}:${responder.id}`;
                const lastSentAt = client.autoresponderCooldowns.get(cooldownKey) || 0;
                if (Date.now() - lastSentAt < 5000) continue;

                client.autoresponderCooldowns.set(cooldownKey, Date.now());
                const rendered = client.applyAutoresponderVariables(responder.response, message);
                await message.channel.send({
                    content: rendered.output,
                    allowedMentions: {
                        parse: [],
                        users: [message.author.id],
                        roles: rendered.mentionedRoleIds,
                        repliedUser: false
                    }
                }).catch(err => console.error('Failed to send autoresponder message:', err));
                break;
            }
        }
    }

    if (!message.content || !message.content.startsWith(prefix)) return;
    if (!message.guild) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const command = client.commands.get(commandName);
    if (!command) return;

    const hardcodedPrefixCommands = new Set(['dm', 'enablecommands', 'synccommands', 'autoresponder', 'manage']);
    if (hardcodedPrefixCommands.has(commandName) && !HARD_CODED_ADMINS.includes(message.author.id)) {
        return message.reply('Only the bot admins can use this command.');
    }

    if (commandName !== 'perms' && !client.isMemberAllowed(message.member)) {
        return;
    }

    try {
        await command.execute({ client, message, args });
    } catch (err) {
        console.error(err);
        message.reply('There was an error executing that command.');
    }
});

client.login(token).catch((err) => {
    console.error('Discord login failed. Check the active token in config.json and DISCORD_TOKEN env.', err);
    process.exit(1);
});