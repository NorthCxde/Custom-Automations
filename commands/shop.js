const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const dataFile = path.join(__dirname, '..', 'data', 'economy.json');

const SHOP_ITEMS = [
    { id: 'coffee', name: 'Coffee', price: 30 },
    { id: 'boost', name: 'Boost', price: 75 },
    { id: 'premium', name: 'Premium', price: 150 }
];

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
    return `${String(guildId || 'dm')}:${String(userId || 'unknown')}`;
}

function readUser(data, guildId, userId) {
    const key = getGuildUserKey(guildId, userId);
    if (!data[key]) {
        data[key] = { balance: 0, lastDaily: 0, lastWork: 0 };
    }
    return data[key];
}

module.exports = {
    name: 'shop',
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('View and buy simple shop items.')
        .addStringOption(option => option.setName('item').setDescription('Item to buy').setRequired(false)),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId;
        const selectedItem = interaction.options.getString('item');
        const userId = interaction.user.id;
        const data = loadData();
        const user = readUser(data, guildId, userId);

        const shopList = SHOP_ITEMS.map(item => `• ${item.name} — **${item.price.toLocaleString()}** coins`).join('\n');

        if (!selectedItem) {
            const embed = new EmbedBuilder()
                .setTitle('Shop')
                .setDescription(shopList)
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const item = SHOP_ITEMS.find(entry => entry.id.toLowerCase() === selectedItem.toLowerCase());
        if (!item) {
            await interaction.reply({ content: 'That item does not exist in the shop.', ephemeral: true });
            return;
        }

        if (Number(user.balance || 0) < item.price) {
            await interaction.reply({ content: `You do not have enough balance to buy **${item.name}**.`, ephemeral: true });
            return;
        }

        user.balance = Number(user.balance || 0) - item.price;
        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('Purchase complete')
            .setDescription(`<@${userId}> bought **${item.name}** for **${item.price}**.`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
