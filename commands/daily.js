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
        data[key] = { balance: 0, lastDaily: 0, lastWork: 0, inventory: [], stats: { earned: 0, spent: 0 } };
    }
    if (!data[key].stats) {
        data[key].stats = { earned: 0, spent: 0 };
    }
    return data[key];
}

module.exports = {
    name: 'daily',
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily reward.'),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId || 'dm';
        const userId = interaction.user.id;
        const data = loadData();
        const user = readUser(data, guildId, userId);
        const now = Date.now();
        const reward = 100;
        const cooldownMs = 24 * 60 * 60 * 1000;

        if (user.lastDaily && now - Number(user.lastDaily) < cooldownMs) {
            const remainingMs = cooldownMs - (now - Number(user.lastDaily));
            const hours = Math.floor(remainingMs / (60 * 60 * 1000));
            const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
            const embed = new EmbedBuilder()
                .setTitle('Daily Reward')
                .setDescription(`You already claimed your daily reward. Come back in **${hours}h ${minutes}m**.`)
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        user.balance = Number(user.balance || 0) + reward;
        user.stats.earned = Number(user.stats.earned || 0) + reward;
        user.lastDaily = now;
        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('Daily Reward')
            .setDescription(`<@${userId}> claimed **${reward}** and now has **${user.balance}** total.`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
