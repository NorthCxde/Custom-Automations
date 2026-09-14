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
    name: 'work',
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Do quick work for a payout.'),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId || 'dm';
        const userId = interaction.user.id;
        const data = loadData();
        const user = readUser(data, guildId, userId);
        const now = Date.now();
        const cooldownMs = 10 * 60 * 1000;

        if (user.lastWork && now - Number(user.lastWork) < cooldownMs) {
            const remainingMs = cooldownMs - (now - Number(user.lastWork));
            const minutes = Math.ceil(remainingMs / 60000);
            const embed = new EmbedBuilder()
                .setTitle('Work')
                .setDescription(`You need to wait **${minutes}m** before working again.`)
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const payout = Math.floor(Math.random() * 41) + 20;
        user.balance = Number(user.balance || 0) + payout;
        user.lastWork = now;
        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('Work complete')
            .setDescription(`<@${userId}> earned **${payout}** and now has **${user.balance}** total.`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
