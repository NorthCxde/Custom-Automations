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

        let earned = 0;
        let description = '';

        if (selectedGame === 'Timebomb') {
            const outcomes = [
                { text: 'passed a 1 in Timebomb and won the match! You earned <coins>.', weight: 15, type: 'win', multiplier: [1.5, 2.2] },
                { text: 'failed to track a player and lost the match. You lost <coins>.', weight: 15, type: 'loss', multiplier: [0.1, 0.5] },
                { text: 'passed a 2 in Timebomb and won the match! You earned <coins>.', weight: 25, type: 'win', multiplier: [1, 1.2] },
                { text: 'passed a 3 in Timebomb and won the match by running! You earned <coins>.', weight: 40, type: 'win', multiplier: [1, 1.25] },
                { text: 'passed a 0.5 in Timebomb and won the match by running! You earned <coins>.', weight: 4.5, type: 'win', multiplier: [2, 3.2] },
                { text: 'passed a 0.1 in Timebomb and won the match by running! You earned <coins>.', weight: 0.5, type: 'win', multiplier: [2.5, 3.8] }
            ];

            const totalWeight = outcomes.reduce((sum, item) => sum + item.weight, 0);
            let roll = Math.random() * totalWeight;
            let chosen = outcomes[0];

            for (const outcome of outcomes) {
                roll -= outcome.weight;
                if (roll <= 0) {
                    chosen = outcome;
                    break;
                }
            }

            const basePrize = Math.floor(Math.random() * (rewardConfig.max - rewardConfig.min + 1)) + rewardConfig.min;
            const [minMult, maxMult] = chosen.multiplier;
            const multiplier = Number((Math.random() * (maxMult - minMult) + minMult).toFixed(2));

            if (chosen.type === 'loss') {
                const lostCoins = Math.max(1, Math.floor(basePrize * multiplier));
                const nextBalance = Math.max(0, Number(user.balance || 0) - lostCoins);
                user.balance = nextBalance;
                description = `<@${userId}> ${chosen.text.replace('<coins>', `**${lostCoins} coins**`)}`;
            } else {
                const earnedCoins = Math.max(1, Math.floor(basePrize * multiplier));
                user.balance = Number(user.balance || 0) + earnedCoins;
                description = `<@${userId}> ${chosen.text.replace('<coins>', `**${earnedCoins} coins**`)}`;
            }
        } else {
            earned = Math.floor(Math.random() * (rewardConfig.max - rewardConfig.min + 1)) + rewardConfig.min;
            user.balance = Number(user.balance || 0) + earned;
            description = `<@${userId}> played **${selectedGame}**. You earned **${earned} coins**.`;
        }

        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('Minigame')
            .setDescription(description)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
