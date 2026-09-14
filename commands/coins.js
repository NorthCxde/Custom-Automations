const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'economy.db');

const SHOP_ITEMS = [
    { id: 'cookie', name: 'Cookie', price: 125, bonusPercent: 10, description: 'A tasty little treat for a quick boost.' },
    { id: 'badge', name: 'Badge', price: 350, bonusPercent: 15, description: 'A shiny badge to show off in the server.' },
    { id: 'booster', name: 'Booster', price: 650, bonusPercent: 20, description: 'A premium status item for your collection.' },
    { id: 'vip', name: 'VIP', price: 1200, bonusPercent: 35, description: 'A premium-looking title for your collection.' }
];

function ensureDataDir() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function getDb() {
    ensureDataDir();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    return db;
}

function ensureColumn(db, tableName, columnName, definition) {
    const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = info.some(column => String(column.name) === columnName);
    if (!exists) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

function initDb() {
    const db = getDb();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS economy_users (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            coins INTEGER NOT NULL DEFAULT 0,
            last_daily INTEGER NOT NULL DEFAULT 0,
            last_work INTEGER NOT NULL DEFAULT 0,
            last_give INTEGER NOT NULL DEFAULT 0,
            streak INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id)
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS economy_items (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price INTEGER NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            bonus_percent INTEGER NOT NULL DEFAULT 0
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS economy_inventory (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id, item_id)
        )
    `).run();

    ensureColumn(db, 'economy_users', 'streak', 'INTEGER NOT NULL DEFAULT 0');

    const insertItem = db.prepare(`
        INSERT OR IGNORE INTO economy_items (id, name, price, description, bonus_percent)
        VALUES (@id, @name, @price, @description, @bonusPercent)
    `);

    for (const item of SHOP_ITEMS) {
        insertItem.run({
            id: item.id,
            name: item.name,
            price: item.price,
            description: item.description,
            bonusPercent: item.bonusPercent
        });
    }

    db.close();
}

function formatCoins(value) {
    return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatTime(ms) {
    const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function buildCardEmbed(title, subtitle, accentColor = 0x3b82f6) {
    return new EmbedBuilder()
        .setColor(accentColor)
        .setTitle(title)
        .setDescription(subtitle)
        .setTimestamp();
}

function getCooldownRemaining(lastTs, ms) {
    const remaining = (Number(lastTs) || 0) + ms - Date.now();
    return Math.max(0, remaining);
}

function ensureUser(guildId, userId) {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM economy_users WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId));

    if (!existing) {
        db.prepare(`
            INSERT INTO economy_users (guild_id, user_id, coins, last_daily, last_work, last_give, streak)
            VALUES (?, ?, 0, 0, 0, 0, 0)
        `).run(String(guildId), String(userId));
    }

    const result = db.prepare('SELECT * FROM economy_users WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId));
    db.close();
    return result || { coins: 0, last_daily: 0, last_work: 0, last_give: 0, streak: 0 };
}

function setUserBalance(guildId, userId, coins) {
    const db = getDb();
    db.prepare(`
        INSERT INTO economy_users (guild_id, user_id, coins, last_daily, last_work, last_give, streak)
        VALUES (?, ?, ?, 0, 0, 0, 0)
        ON CONFLICT(guild_id, user_id)
        DO UPDATE SET coins = excluded.coins
    `).run(String(guildId), String(userId), Number(coins) || 0);
    db.close();
}

function updateUserField(guildId, userId, field, value) {
    const db = getDb();
    db.prepare(`
        INSERT INTO economy_users (guild_id, user_id, coins, last_daily, last_work, last_give, streak)
        VALUES (?, ?, 0, 0, 0, 0, 0)
        ON CONFLICT(guild_id, user_id)
        DO NOTHING
    `).run(String(guildId), String(userId));

    db.prepare(`UPDATE economy_users SET ${field} = ? WHERE guild_id = ? AND user_id = ?`).run(Number(value), String(guildId), String(userId));
    db.close();
}

function getInventory(guildId, userId) {
    const db = getDb();
    const rows = db.prepare(`
        SELECT i.id, i.name, i.price, i.description, i.bonus_percent, inv.quantity
        FROM economy_inventory inv
        INNER JOIN economy_items i ON i.id = inv.item_id
        WHERE inv.guild_id = ? AND inv.user_id = ?
        ORDER BY i.price ASC
    `).all(String(guildId), String(userId));
    db.close();
    return rows;
}

function addItemToInventory(guildId, userId, itemId, quantity = 1) {
    const db = getDb();
    db.prepare(`
        INSERT INTO economy_inventory (guild_id, user_id, item_id, quantity)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id, item_id)
        DO UPDATE SET quantity = quantity + excluded.quantity
    `).run(String(guildId), String(userId), String(itemId), Number(quantity) || 1);
    db.close();
}

function getUserMultiplier(guildId, userId) {
    const db = getDb();
    const rows = db.prepare(`
        SELECT i.bonus_percent, inv.quantity
        FROM economy_inventory inv
        INNER JOIN economy_items i ON i.id = inv.item_id
        WHERE inv.guild_id = ? AND inv.user_id = ?
    `).all(String(guildId), String(userId));
    db.close();

    const bonus = rows.reduce((sum, row) => sum + (Number(row.bonus_percent || 0) * Number(row.quantity || 0)), 0);
    return 1 + (bonus / 100);
}

function getUserNameFromId(guild, userId) {
    if (!guild) return `User ${userId}`;
    const member = guild.members.cache.get(userId) || null;
    if (member) return member.displayName || member.user?.username || userId;
    return userId;
}

function getLeaderboardRows(guildId, limit = 10) {
    const db = getDb();
    const rows = db.prepare(`
        SELECT user_id, coins
        FROM economy_users
        WHERE guild_id = ?
        ORDER BY coins DESC, user_id ASC
        LIMIT ?
    `).all(String(guildId), Number(limit));
    db.close();
    return rows;
}

function getShopItems() {
    const db = getDb();
    const rows = db.prepare(`
        SELECT id, name, price, description, bonus_percent
        FROM economy_items
        ORDER BY price ASC
    `).all();
    db.close();
    return rows;
}

function getItemById(itemId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM economy_items WHERE id = ?').get(String(itemId));
    db.close();
    return row || null;
}

function purchaseItem(guildId, userId, itemId) {
    const item = getItemById(itemId);
    if (!item) {
        return { ok: false, error: 'That item does not exist.' };
    }

    const user = ensureUser(guildId, userId);
    const currentCoins = Number(user.coins || 0);
    if (currentCoins < Number(item.price)) {
        return { ok: false, error: `You need ${formatCoins(item.price)} Coins to buy **${item.name}**.` };
    }

    const nextBalance = currentCoins - Number(item.price);
    setUserBalance(guildId, userId, nextBalance);
    addItemToInventory(guildId, userId, itemId, 1);

    const multiplier = getUserMultiplier(guildId, userId);
    return {
        ok: true,
        item,
        balance: nextBalance,
        multiplier,
        message: `You bought **${item.name}** for **${formatCoins(item.price)} Coins**.`
    };
}

function getInventorySummary(guildId, userId) {
    const inventory = getInventory(guildId, userId);
    if (!inventory.length) return 'No items yet';
    return inventory.map(entry => `**${entry.name}** x${entry.quantity}`).join(', ');
}

module.exports = {
    name: 'bank',
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Manage the server economy.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('balance')
                .setDescription('View your balance.')
                .addUserOption(option => option.setName('user').setDescription('User to check. Defaults to you.').setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('daily')
                .setDescription('Claim your daily reward.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('work')
                .setDescription('Work for a random payout.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('Show the top holders in the server.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('give')
                .setDescription('Give a user some currency.')
                .addUserOption(option => option.setName('user').setDescription('User to give currency to.').setRequired(true))
                .addIntegerOption(option => option.setName('amount').setDescription('Amount to give.').setRequired(true).setMinValue(1))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('buy')
                .setDescription('Buy an item from the shop.')
                .addStringOption(option => option.setName('item').setDescription('Item to buy.').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('shop')
                .setDescription('View the available shop items.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('profile')
                .setDescription('View a richer profile card for a user.')
                .addUserOption(option => option.setName('user').setDescription('User to view. Defaults to you.').setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset a user balance to zero. Admin use only.')
                .addUserOption(option => option.setName('user').setDescription('User to reset.').setRequired(true))
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (subcommand === 'balance') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const user = ensureUser(guildId, targetUser.id);
            const multiplier = getUserMultiplier(guildId, targetUser.id);
            const bonus = Math.round((multiplier - 1) * 100);
            const embed = buildCardEmbed(
                `${targetUser.username}'s Balance`,
                `**${formatCoins(user.coins)}**\n\nMulti Bonus: +${bonus}%`,
                0x22c55e
            );
            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'daily') {
            const user = ensureUser(guildId, interaction.user.id);
            const cooldownMs = 24 * 60 * 60 * 1000;
            const remaining = getCooldownRemaining(user.last_daily, cooldownMs);

            if (remaining > 0) {
                const embed = buildCardEmbed('Daily Reward', `You still have **${formatTime(remaining)}** left before your next daily reward.`, 0xf59e0b);
                return interaction.reply({ embeds: [embed] });
            }

            const multiplier = getUserMultiplier(guildId, interaction.user.id);
            const streakBonus = Number(user.streak || 0) * 35;
            const rewardBase = 500 + streakBonus;
            const reward = Math.round(rewardBase * multiplier);
            const nextCoins = Number(user.coins || 0) + reward;
            setUserBalance(guildId, interaction.user.id, nextCoins);
            updateUserField(guildId, interaction.user.id, 'last_daily', Date.now());
            updateUserField(guildId, interaction.user.id, 'streak', Number(user.streak || 0) + 1);

            const embed = buildCardEmbed(
                'Daily Reward Claimed',
                `You claimed **${formatCoins(reward)}** and now have **${formatCoins(nextCoins)}** total.\n\nMulti Bonus: +${Math.round((multiplier - 1) * 100)}%`,
                0xfacc15
            );
            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'work') {
            const user = ensureUser(guildId, interaction.user.id);
            const cooldownMs = 60 * 60 * 1000;
            const remaining = getCooldownRemaining(user.last_work, cooldownMs);

            if (remaining > 0) {
                const embed = buildCardEmbed('Work Shift', `You need to wait **${formatTime(remaining)}** before working again.`, 0xef4444);
                return interaction.reply({ embeds: [embed] });
            }

            const base = 75 + Math.floor(Math.random() * 225);
            const multiplier = getUserMultiplier(guildId, interaction.user.id);
            const payout = Math.round(base * multiplier);
            const nextCoins = Number(user.coins || 0) + payout;
            setUserBalance(guildId, interaction.user.id, nextCoins);
            updateUserField(guildId, interaction.user.id, 'last_work', Date.now());

            const embed = buildCardEmbed(
                'Work Complete',
                `You worked a shift and earned **${formatCoins(payout)}**. Your total is now **${formatCoins(nextCoins)}**.\n\nMulti Bonus: +${Math.round((multiplier - 1) * 100)}%`,
                0x0ea5e9
            );
            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'leaderboard') {
            const rows = getLeaderboardRows(guildId, 10);
            if (!rows.length) {
                return interaction.reply({ embeds: [buildCardEmbed('Leaderboard', 'No one has started earning yet. Start working and earning!', 0x8b5cf6)] });
            }

            const lines = rows.map((row, index) => `${index + 1}. **${getUserNameFromId(interaction.guild, row.user_id)}** — ${formatCoins(row.coins)}`).join('\n');
            return interaction.reply({ embeds: [buildCardEmbed('Leaderboard', lines, 0x8b5cf6)] });
        }

        if (subcommand === 'give') {
            const receiver = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const sender = ensureUser(guildId, interaction.user.id);
            const target = ensureUser(guildId, receiver.id);
            const cooldownMs = 30 * 1000;
            const remaining = getCooldownRemaining(sender.last_give, cooldownMs);

            if (remaining > 0) {
                return interaction.reply({ embeds: [buildCardEmbed('Give', `You need to wait **${formatTime(remaining)}** before giving again.`, 0xf97316)] });
            }

            if (Number(sender.coins || 0) < amount) {
                return interaction.reply({ embeds: [buildCardEmbed('Give', `You do not have enough to give **${formatCoins(amount)}**.`, 0xef4444)] });
            }

            const newSenderBalance = Number(sender.coins || 0) - amount;
            const newReceiverBalance = Number(target.coins || 0) + amount;
            setUserBalance(guildId, interaction.user.id, newSenderBalance);
            setUserBalance(guildId, receiver.id, newReceiverBalance);
            updateUserField(guildId, interaction.user.id, 'last_give', Date.now());

            const embed = buildCardEmbed(
                'Gift Sent',
                `You gave **${formatCoins(amount)}** to **${receiver.tag}**. You now have **${formatCoins(newSenderBalance)}**.`,
                0x10b981
            );
            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'buy') {
            const itemId = String(interaction.options.getString('item') || '').trim().toLowerCase();
            if (!itemId) {
                return interaction.reply({ embeds: [buildCardEmbed('Shop', 'Please choose a valid item ID from the shop.', 0xef4444)] });
            }

            const result = purchaseItem(guildId, interaction.user.id, itemId);
            if (!result.ok) {
                return interaction.reply({ embeds: [buildCardEmbed('Shop', result.error, 0xef4444)] });
            }

            const embed = buildCardEmbed(
                'Item Purchased',
                `${result.message}\n\nYour total is now **${formatCoins(result.balance)}**.\nMulti Bonus: +${Math.round((result.multiplier - 1) * 100)}%`,
                0x7c3aed
            );
            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'shop') {
            const items = getShopItems();
            const lines = items.map(item => `**${item.name}** — ${formatCoins(item.price)}\n+${Number(item.bonus_percent || 0)}% multiplier\n${item.description}`).join('\n\n');
            const embed = buildCardEmbed('Shop', lines, 0x7c3aed);
            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'profile') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const user = ensureUser(guildId, targetUser.id);
            const multiplier = getUserMultiplier(guildId, targetUser.id);
            const inventorySummary = getInventorySummary(guildId, targetUser.id);
            const embed = new EmbedBuilder()
                .setColor(0x7c3aed)
                .setTitle(`${targetUser.username}'s Profile`)
                .setDescription(`**${formatCoins(user.coins)}**`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: 'Multi Bonus', value: `+${Math.round((multiplier - 1) * 100)}%`, inline: true },
                    { name: 'Daily Streak', value: `${Number(user.streak || 0)} days`, inline: true },
                    { name: 'Inventory', value: inventorySummary, inline: false }
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'reset') {
            if (!client.isMemberAllowed || !client.isMemberAllowed(interaction.member)) {
                return interaction.reply({ content: 'Only /perms-approved users can reset economy balances.', ephemeral: true });
            }

            const target = interaction.options.getUser('user');
            setUserBalance(guildId, target.id, 0);
            return interaction.reply({ embeds: [buildCardEmbed('Reset', `**${target.tag}** has had their balance reset to **0**.`, 0xf43f5e)] });
        }

        return interaction.reply({ embeds: [buildCardEmbed('Bank', 'Use a subcommand such as /bank balance or /bank daily.', 0x3b82f6)] });
    }
};

if (require.main === module) {
    initDb();
    console.log(`Coins database initialized at ${dbPath}`);
}
