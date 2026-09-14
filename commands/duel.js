const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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
        data[key] = { balance: 0, lastDaily: 0, lastWork: 0, lastDuel: 0, inventory: [], stats: { earned: 0, spent: 0 } };
    }
    if (!data[key].stats) {
        data[key].stats = { earned: 0, spent: 0 };
    }
    if (data[key].lastDuel === undefined) {
        data[key].lastDuel = 0;
    }
    return data[key];
}

module.exports = {
    name: 'duel',
    data: new SlashCommandBuilder()
        .setName('duel')
        .setDescription('Challenge another user to a duel with coins at stake.')
        .addUserOption(option => option
            .setName('opponent')
            .setDescription('User to duel')
            .setRequired(true)
        )
        .addIntegerOption(option => option
            .setName('bet')
            .setDescription('Coins to bet (winner takes all)')
            .setRequired(true)
            .setMinValue(1)
        ),
    async executeInteraction({ interaction }) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const opponent = interaction.options.getUser('opponent');
        const betAmount = interaction.options.getInteger('bet');

        if (!opponent || opponent.bot) {
            return await interaction.reply({ content: '❌ You cannot duel a bot.', ephemeral: true });
        }

        if (opponent.id === userId) {
            return await interaction.reply({ content: '❌ You cannot duel yourself.', ephemeral: true });
        }

        const data = loadData();
        const challenger = readUser(data, guildId, userId);
        const opponentUser = readUser(data, guildId, opponent.id);
        const now = Date.now();
        const cooldownMs = 60 * 1000;

        if (challenger.lastDuel && now - Number(challenger.lastDuel) < cooldownMs) {
            const remainingMs = cooldownMs - (now - Number(challenger.lastDuel));
            const seconds = Math.ceil(remainingMs / 1000);
            return await interaction.reply({ content: `❌ You must wait **${seconds}s** before dueling again.`, ephemeral: true });
        }

        if (Number(challenger.balance || 0) < betAmount) {
            return await interaction.reply({ content: `❌ You need **${betAmount.toLocaleString()}** coins to make this bet.`, ephemeral: true });
        }

        if (Number(opponentUser.balance || 0) < betAmount) {
            return await interaction.reply({ content: `❌ <@${opponent.id}> doesn't have **${betAmount.toLocaleString()}** coins to accept this duel.`, ephemeral: true });
        }

        // Create duel request embed
        const duelEmbed = new EmbedBuilder()
            .setTitle('💣 Duel Request')
            .setDescription(`<@${userId}> challenged <@${opponent.id}> to a duel!\n\n**Bet:** ${betAmount.toLocaleString()} coins`)
            .setTimestamp();

        const acceptBtn = new ButtonBuilder()
            .setCustomId(`duel-accept-${userId}-${opponent.id}-${betAmount}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success);

        const denyBtn = new ButtonBuilder()
            .setCustomId(`duel-deny-${userId}-${opponent.id}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(acceptBtn, denyBtn);

        await interaction.reply({ embeds: [duelEmbed], components: [row], ephemeral: false });

        // Set up button collector (60 second timeout)
        const filter = i => i.customId.startsWith('duel-') && i.user.id === opponent.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

        let duelResolved = false;

        collector.on('collect', async (buttonInteraction) => {
            if (duelResolved) return;
            duelResolved = true;

            if (buttonInteraction.customId.startsWith('duel-deny')) {
                const denyEmbed = new EmbedBuilder()
                    .setTitle('Duel Denied')
                    .setDescription(`<@${opponent.id}> denied the duel challenge.`)
                    .setTimestamp();
                await buttonInteraction.reply({ embeds: [denyEmbed], ephemeral: false });
                return;
            }

            // Duel accepted
            const duelData = loadData();
            const challengerData = readUser(duelData, guildId, userId);
            const opponentData = readUser(duelData, guildId, opponent.id);

            // Validate both have enough coins
            if (Number(challengerData.balance || 0) < betAmount || Number(opponentData.balance || 0) < betAmount) {
                const failEmbed = new EmbedBuilder()
                    .setTitle('Duel Failed')
                    .setDescription('One or both players don\'t have enough coins to complete the duel.')
                    .setTimestamp();
                await buttonInteraction.reply({ embeds: [failEmbed], ephemeral: false });
                return;
            }

            // Run duel
            const outcomes = [
                { text: 'passed a 1 in the duel and won! <@winner> took <coins>!', weight: 15, winner: 'challenger' },
                { text: '<@loser> failed to track and lost the match! <@winner> took <coins>!', weight: 15, winner: 'opponent' },
                { text: 'passed a 2 in the duel and won! <@winner> took <coins>!', weight: 25, winner: 'challenger' },
                { text: 'passed a 3 in the duel and won by running! <@winner> took <coins>!', weight: 40, winner: 'challenger' },
                { text: 'passed a 0.5 in the duel and won by running! <@winner> took <coins>!', weight: 4.5, winner: 'challenger' },
                { text: 'passed a 0.1 in the duel and won by running! <@winner> took <coins>!', weight: 0.5, winner: 'challenger' }
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

            // Determine winner and loser
            const isWinnerChallenger = chosen.winner === 'challenger';
            const winner = isWinnerChallenger ? userId : opponent.id;
            const loser = isWinnerChallenger ? opponent.id : userId;

            // Update balances
            challengerData.balance = Number(challengerData.balance || 0) - betAmount;
            opponentData.balance = Number(opponentData.balance || 0) - betAmount;

            const winnerData = isWinnerChallenger ? challengerData : opponentData;
            winnerData.balance = Number(winnerData.balance || 0) + (betAmount * 2);

            // Update stats
            winnerData.stats.earned = Number(winnerData.stats.earned || 0) + (betAmount * 2);
            if (isWinnerChallenger) {
                opponentData.stats.spent = Number(opponentData.stats.spent || 0) + betAmount;
            } else {
                challengerData.stats.spent = Number(challengerData.stats.spent || 0) + betAmount;
            }

            // Update cooldowns
            challengerData.lastDuel = now;
            opponentData.lastDuel = now;

            saveData(duelData);

            // Format outcome
            const outcomeText = chosen.text
                .replace('<@winner>', `<@${winner}>`)
                .replace('<@loser>', `<@${loser}>`)
                .replace('<coins>', `**${(betAmount * 2).toLocaleString()} coins**`);

            const resultEmbed = new EmbedBuilder()
                .setTitle('💣 Duel Result')
                .setDescription(`<@${userId}> vs <@${opponent.id}>\n\n${outcomeText}`)
                .setTimestamp();

            await buttonInteraction.reply({ embeds: [resultEmbed], ephemeral: false });
        });

        collector.on('end', (collected) => {
            if (!duelResolved) {
                interaction.editReply({ components: [], content: 'Duel request timed out.' });
            }
        });
    }
};
