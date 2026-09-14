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
    name: 'balance',
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your current balance.'),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId || 'dm';
        const userId = interaction.user.id;
        const data = loadData();
        const user = readUser(data, guildId, userId);
        const balance = Number(user.balance) || 0;

        const embed = new EmbedBuilder()
            .setTitle('Balance')
            .setDescription(`<@${userId}> has **${balance.toLocaleString()}** coins available.`)
            .setTimestamp();

        saveData(data);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
