const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const dataFile = path.join(__dirname, '..', 'data', 'economy.json');

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
        data[key] = { balance: 0, lastDaily: 0, lastWork: 0, inventory: [] };
    }
    return data[key];
}

module.exports = {
    name: 'inventory',
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View the items in your inventory.'),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const data = loadData();
        const user = readUser(data, guildId, userId);

        const items = Array.isArray(user.inventory) && user.inventory.length
            ? user.inventory.join(', ')
            : 'Empty';

        const embed = new EmbedBuilder()
            .setTitle('Inventory')
            .setDescription(`**${interaction.user.tag}**\n${items}`)
            .setTimestamp();

        saveData(data);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
