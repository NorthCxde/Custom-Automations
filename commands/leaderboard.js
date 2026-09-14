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

function getGuildUserKey(guildId, userId) {
    return String(userId || 'unknown');
}

module.exports = {
    name: 'leaderboard',
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the top balances globally.'),
    async executeInteraction({ interaction }) {
        const data = loadData();
        const entries = Object.entries(data)
            .map(([userId, value]) => ({
                userId,
                balance: Number(value?.balance || 0)
            }))
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 10);

        const lines = entries.length
            ? entries.map((entry, index) => `${index + 1}. <@${entry.userId}> — **${entry.balance.toLocaleString()}**`).join('\n')
            : 'No balances yet.';

        const embed = new EmbedBuilder()
            .setTitle('Leaderboard')
            .setDescription(lines)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
