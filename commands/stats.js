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
    name: 'stats',
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View your economy stats.')
        .addUserOption(option => option
            .setName('user')
            .setDescription('View another user\'s stats (optional)')
            .setRequired(false)
        ),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId;
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userId = targetUser.id;

        const data = loadData();
        const user = readUser(data, guildId, userId);

        const balance = Number(user.balance || 0);
        const earned = Number(user.stats.earned || 0);
        const spent = Number(user.stats.spent || 0);
        const net = balance;

        const embed = new EmbedBuilder()
            .setTitle(`💰 Economy Stats`)
            .setDescription(`Stats for <@${userId}>`)
            .addFields(
                { name: 'Current Balance', value: `**${balance.toLocaleString()} coins**`, inline: true },
                { name: 'Total Earned', value: `**${earned.toLocaleString()} coins**`, inline: true },
                { name: 'Total Spent', value: `**${spent.toLocaleString()} coins**`, inline: true },
                { name: 'Net Coins', value: `**${net.toLocaleString()} coins**`, inline: false }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
