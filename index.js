const config = require("./config.json");
const token = process.env.DISCORD_TOKEN || config.token;
const { Client, GatewayIntentBits, PermissionsBitField, ApplicationCommandPermissionType, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageType, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

if (!token) {
    throw new Error("Missing Discord token. Set DISCORD_TOKEN or add token to config.json.");
}

const prefix = "?";
const HARD_CODED_ADMINS = [
    // Put your user IDs here. Only these users will be able to see /perms and /logs.
    '1486503754617323530',
    '841491704305811496'
];

const HQ_GUILD_ID_DEFAULT = '1512252919423176875';
const HQ_PERMS_LOG_CHANNEL_ID_DEFAULT = '1517292575239704907';

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

client.allowedRoles = new Map();
client.logChannels = new Map();
client.modLogs = new Map();
client.boostChannels = new Map();
client.pendingModerationActions = new Map();
client.pendingPermsUndoActions = new Map();
client.bloxlink = new Map();
client.bloxlinkHistory = new Map();
client.slashCommands = new Map();
client.prefixCommandsEnabled = false; // default; can be changed with /enablecommands and is persisted
client.prefixCommandReactionEmojiId = '1356003566925512934'; // Emoji ID for prefix command responses

client.sendPrefixCommandResponse = async (channel, content, options = {}) => {
    try {
        const msg = await channel.send({ content, ...options });
        if (client.prefixCommandReactionEmojiId) {
            await msg.react(client.prefixCommandReactionEmojiId).catch(err => console.error('Failed to react to prefix command response:', err));
        }
        return msg;
    } catch (error) {
        console.error('Failed to send prefix command response:', error);
        return null;
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

client.loadCommands = () => {
    client.commands.clear();
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
            if (cmd && cmd.data) {
                client.slashCommands.set(cmd.name, cmd);
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

client.getLinkedRobloxId = async (guildId, discordId) => {
    // check cache
    const cached = client.bloxlink.get(discordId);
    const now = Date.now();
    if (cached && cached.robloxId && (!cached.expires || cached.expires > now)) {
        return cached.robloxId;
    }

    const apiKey = process.env.BLOXLINK_API_KEY || config.bloxlinkApiKey;
    if (!apiKey) return null;

    const url = `https://api.blox.link/v4/public/guilds/${guildId}/discord-to-roblox/${discordId}`;
    try {
        const res = await fetch(url, { headers: { Authorization: apiKey } });
        if (res.status === 404) return null;
        if (!res.ok) return null;
        const body = await res.json();
        const robloxId = body.robloxID || body.robloxId || null;
        const ttl = Number(config.bloxlinkCacheTtlMs) || 5 * 60 * 1000;
        client.bloxlink.set(discordId, { robloxId, expires: Date.now() + ttl });
        client.saveBloxlink();
        return robloxId;
    } catch (err) {
        console.error('Bloxlink lookup failed:', err);
        return null;
    }
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
};

client.getModLogs = (guildId, userId) => {
    const logs = client.modLogs.get(guildId) || [];
    if (!userId) return logs;
    return logs.filter(log => log.userId === userId);
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
        return member.permissions.has(PermissionsBitField.Flags.Administrator) || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
    }
    return member.roles.cache.some(role => allowed.has(role.id));
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

client.loadCommands();
client.loadPermissions();
client.loadLogChannels();
client.loadModLogs();
client.loadBloxlink();
client.loadBloxlinkHistory();
client.loadBoostChannels();
client.loadPrefixCommandState();

client.refreshGuildBloxlinkCache = async (guild) => {
    if (!guild) return;
    try {
        const members = await guild.members.fetch();
        for (const member of members.values()) {
            if (member.user.bot) continue;
            try {
                if (client.getLinkedRobloxId) {
                    await client.getLinkedRobloxId(guild.id, member.user.id);
                }
            } catch (err) {
                console.error(`Failed to refresh Bloxlink cache for member ${member.user.id} in guild ${guild.id}:`, err);
            }
        }
    } catch (err) {
        console.error(`Failed to fetch guild members for Bloxlink cache refresh in guild ${guild.id}:`, err);
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
    const intervalMs = Number(config.bloxlinkCacheIntervalMs) || 60_000;
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

client.on('clientReady', async () => {
    const slashData = Array.from(client.slashCommands.values())
        .map(cmd => cmd.data.toJSON());

    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.commands.set(slashData);
        } catch (err) {
            console.error(`Failed to register slash commands for guild ${guild.id}:`, err);
        }
    }
    console.log(`Ready! Registered ${slashData.length} slash command(s).`);

    client.user.setPresence({
        activities: [{ name: 'Automating Customs Community', type: ActivityType.Watching }],
        status: 'online'
    });

    client.scheduleBloxlinkCacheRefresh();
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
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'perms' || interaction.commandName === 'logs' || interaction.commandName === 'enablecommands' || interaction.commandName === 'setboostchannel') {
            if (!HARD_CODED_ADMINS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Only the bot admins can use this command.', ephemeral: true });
            }
        } else {
            if (!client.isMemberAllowed(interaction.member)) {
                return interaction.reply({ content: 'You do not have permission to use bot commands. Use /perms to configure allowed roles.', ephemeral: true });
            }
        }

        const command = client.slashCommands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.executeInteraction({ client, interaction });
        } catch (err) {
            console.error(err);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error executing that command.', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true });
                }
            } catch (replyErr) {
                console.error('Failed to send error response to interaction:', replyErr);
            }
        }
        return;
    }

    if (interaction.isButton()) {
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

    if (interaction.isStringSelectMenu()) {
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
            return interaction.reply({ content: `${selectedAction === 'ban' ? 'Ban' : 'Kick'} complete: ${successCount} succeeded, ${failCount} failed. ${names}`, ephemeral: true });
        }

        if (interaction.customId === 'modlogs_remove_select') {
            if (!interaction.guild) {
                return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
            }

            const selectedCase = interaction.values[0];
            const logs = client.getModLogs(interaction.guild.id);
            const caseIndex = logs.findIndex(log => String(log.caseNumber ?? log.caseId) === selectedCase);
            if (caseIndex === -1) {
                return interaction.reply({ content: 'Selected case not found.', ephemeral: true });
            }

            const [removedLog] = logs.splice(caseIndex, 1);
            client.modLogs.set(interaction.guild.id, logs);
            client.saveModLogs();

            return interaction.reply({ content: `Removed Case ${removedLog.caseNumber ?? removedLog.caseId}.`, ephemeral: true });
        }
    }

    if (!interaction.isRoleSelectMenu()) return;
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

    const roleList = selectedRoleIds.length
        ? selectedRoleIds.map(id => `<@&${id}>`).join(', ')
        : 'none (command access will be restricted to server admins only)';

    await interaction.reply({ content: `Allowed roles updated: ${roleList}`, ephemeral: true });
    await client.logPermsAudit(interaction, selectedRoleNames, { hadExistingPermConfig, previousRoleIds });
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
    if (!message.content || !message.content.startsWith(prefix)) return;
    if (!message.guild) return;
    if (!client.prefixCommandsEnabled) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const command = client.commands.get(commandName);
    if (!command) return;

    if (commandName !== 'perms' && !client.isMemberAllowed(message.member)) {
        return message.reply('You do not have permission to use bot commands.');
    }

    try {
        await command.execute({ client, message, args });
    } catch (err) {
        console.error(err);
        message.reply('There was an error executing that command.');
    }
});

client.login(token);