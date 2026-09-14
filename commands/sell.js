const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const dataFile = path.join(__dirname, '..', 'data', 'economy.json');

const SHOP_ITEMS = {
    'Golden Sword': { buyPrice: 500, sellPrice: 250 },
    'Diamond Pickaxe': { buyPrice: 750, sellPrice: 375 },
    'Emerald Amulet': { buyPrice: 1000, sellPrice: 500 },
    'Crown': { buyPrice: 2000, sellPrice: 1000 },
    'Legendary Bow': { buyPrice: 1500, sellPrice: 750 }
};

function ensureDataFile() {
    if (!fs.existsSync(path.dirname(dataFile))) {
        fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    }
    if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, '{}', 'utf8');
    }
}

function loadData() {
    ensureDataFile();
    try {
        const raw = fs.readFileSync(dataFile, 'utf8') || '{}';
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.error('Failed to read economy data:', err);
        return {};
    }
}

function saveData(data) {
    ensureDataFile();
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function getGuildUserKey(guildId, userId) {
    return String(userId || 'unknown');
}

function readUser(data, guildId, userId) {
    const key = getGuildUserKey(guildId, userId);
    if (!data[key]) {
        data[key] = { balance: 0, lastDaily: 0, lastWork: 0, inventory: [], stats: { earned: 0, spent: 0 } };
    }
    if (!data[key].stats) {
        data[key].stats = { earned: 0, spent: 0 };
    }
    return data[key];
}

module.exports = {
    name: 'sell',
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell an item from your inventory.')
        .addStringOption(option => option
            .setName('item')
            .setDescription('Item to sell')
            .setRequired(true)
        )
        .addIntegerOption(option => option
            .setName('quantity')
            .setDescription('How many to sell (default: 1)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100)
        ),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const itemName = interaction.options.getString('item');
        const quantity = interaction.options.getInteger('quantity') || 1;

        const data = loadData();
        const user = readUser(data, guildId, userId);

        if (!SHOP_ITEMS[itemName]) {
            return await interaction.reply({ content: '❌ Item not found.', ephemeral: true });
        }

        const itemInInventory = user.inventory.find(item => item.name === itemName);
        if (!itemInInventory || itemInInventory.quantity < quantity) {
            return await interaction.reply({ 
                content: `❌ You don't have **${quantity}** of **${itemName}**.`, 
                ephemeral: true 
            });
        }

        const sellPrice = SHOP_ITEMS[itemName].sellPrice;
        const totalCoins = sellPrice * quantity;

        itemInInventory.quantity -= quantity;
        if (itemInInventory.quantity <= 0) {
            user.inventory = user.inventory.filter(item => item.name !== itemName);
        }

        user.balance = Number(user.balance || 0) + totalCoins;
        user.stats.earned = Number(user.stats.earned || 0) + totalCoins;

        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('Item Sold')
            .setDescription(`<@${userId}> sold **${quantity}x ${itemName}** for **${totalCoins.toLocaleString()}** coins.`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
