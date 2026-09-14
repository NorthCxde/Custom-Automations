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
    name: 'give',
    data: new SlashCommandBuilder()
        .setName('give')
        .setDescription('Give another user some of your balance.')
        .addUserOption(option => option.setName('user').setDescription('User to give money to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(1)),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId;
        const fromUserId = interaction.user.id;
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (!targetUser || !amount) {
            await interaction.reply({ content: 'Please choose a valid user and amount.', ephemeral: true });
            return;
        }

        if (targetUser.id === fromUserId) {
            await interaction.reply({ content: 'You cannot give money to yourself.', ephemeral: true });
            return;
        }

        const data = loadData();
        const sender = readUser(data, guildId, fromUserId);
        const receiver = readUser(data, guildId, targetUser.id);

        if (Number(sender.balance || 0) < amount) {
            await interaction.reply({ content: 'You do not have enough balance to give that amount.', ephemeral: true });
            return;
        }

        sender.balance = Number(sender.balance || 0) - amount;
        sender.stats.spent = Number(sender.stats.spent || 0) + amount;
        receiver.balance = Number(receiver.balance || 0) + amount;
        receiver.stats.earned = Number(receiver.stats.earned || 0) + amount;
        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('Transfer')
            .setDescription(`<@${fromUserId}> gave <@${targetUser.id}> **${amount}**.`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
