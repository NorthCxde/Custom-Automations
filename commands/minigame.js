const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const dataFile = path.join(__dirname, '..', 'data', 'economy.json');

const GAME_REWARDS = {
    HexagonJump: { min: 30, max: 70 },
    CanyonRun: { min: 35, max: 75 },
    BossFight: { min: 60, max: 120 },
    Brickbattle: { min: 45, max: 95 },
    IcebergPunchout: { min: 50, max: 100 },
    SwordFight: { min: 55, max: 110 },
    Dodgeball: { min: 40, max: 90 },
    RobloxianBowling: { min: 30, max: 80 },
    RobloxianTower: { min: 35, max: 85 },
    KingOfTheHill: { min: 65, max: 130 },
    Spleef: { min: 40, max: 90 },
    FreezeTag: { min: 45, max: 95 },
    CaptureTheFlag: { min: 55, max: 110 },
    CubeSpin: { min: 25, max: 70 },
    ZombieSurvival: { min: 70, max: 150 },
    Timebomb: { min: 50, max: 100 },
    FloorisLava: { min: 40, max: 95 },
    LaserTag: { min: 60, max: 125 },
    DesertBattle: { min: 50, max: 100 },
    LavaSpin: { min: 45, max: 95 },
    FourCorners: { min: 35, max: 85 },
    MarbleRace: { min: 30, max: 80 }
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
    return `${String(guildId || 'dm')}:${String(userId || 'unknown')}`;
}

function readUser(data, guildId, userId) {
    const key = getGuildUserKey(guildId, userId);
    if (!data[key]) {
        data[key] = { balance: 0, lastDaily: 0, lastWork: 0, inventory: [] };
    }
    return data[key];
}

module.exports = {
    name: 'minigame',
    data: new SlashCommandBuilder()
        .setName('minigame')
        .setDescription('Play a quick minigame and earn coins.')
        .addStringOption(option => option
            .setName('game')
            .setDescription('Choose a minigame')
            .setRequired(true)
            .addChoices(
                { name: 'HexagonJump', value: 'HexagonJump' },
                { name: 'CanyonRun', value: 'CanyonRun' },
                { name: 'BossFight', value: 'BossFight' },
                { name: 'Brickbattle', value: 'Brickbattle' },
                { name: 'IcebergPunchout', value: 'IcebergPunchout' },
                { name: 'SwordFight', value: 'SwordFight' },
                { name: 'Dodgeball', value: 'Dodgeball' },
                { name: 'RobloxianBowling', value: 'RobloxianBowling' },
                { name: 'RobloxianTower', value: 'RobloxianTower' },
                { name: 'KingOfTheHill', value: 'KingOfTheHill' },
                { name: 'Spleef', value: 'Spleef' },
                { name: 'FreezeTag', value: 'FreezeTag' },
                { name: 'CaptureTheFlag', value: 'CaptureTheFlag' },
                { name: 'CubeSpin', value: 'CubeSpin' },
                { name: 'ZombieSurvival', value: 'ZombieSurvival' },
                { name: 'Timebomb', value: 'Timebomb' },
                { name: 'FloorisLava', value: 'FloorisLava' },
                { name: 'LaserTag', value: 'LaserTag' },
                { name: 'DesertBattle', value: 'DesertBattle' },
                { name: 'LavaSpin', value: 'LavaSpin' },
                { name: 'FourCorners', value: 'FourCorners' },
                { name: 'MarbleRace', value: 'MarbleRace' }
            )
        ),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const selectedGame = interaction.options.getString('game');

        const data = loadData();
        const user = readUser(data, guildId, userId);
        const rewardConfig = GAME_REWARDS[selectedGame] || { min: 20, max: 60 };
        const earned = Math.floor(Math.random() * (rewardConfig.max - rewardConfig.min + 1)) + rewardConfig.min;
        user.balance = Number(user.balance || 0) + earned;
        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('Minigame')
            .setDescription(`User played **${selectedGame}** and earned **${earned}** coins.`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
