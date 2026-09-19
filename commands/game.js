const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PLACE_ID = '11379739543';
const UNIVERSE_ID = '4049246711';
const NINE_HUNDRED_MILLION = 900000000;
const ONE_BILLION = 1000000000;

async function fetchGameData() {
    const response = await fetch(`https://games.roblox.com/v1/games?universeIds=${UNIVERSE_ID}`);
    if (!response.ok) {
        throw new Error(`Roblox game request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const game = payload?.data?.[0];
    if (!game) {
        throw new Error('Roblox game data was not returned');
    }

    return {
        name: String(game.name || 'Timebomb Duels'),
        visits: Number(game.visits || 0)
    };
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function formatCountdown(secondsLeft) {
    const safe = Math.max(0, Number(secondsLeft) || 0);
    const displaySeconds = Math.max(1, safe);
    return `Updating in ${displaySeconds} second${displaySeconds === 1 ? '' : 's'}`;
}

function buildGameEmbed(gameData, secondsLeft) {
    const target = gameData.visits >= NINE_HUNDRED_MILLION ? ONE_BILLION : NINE_HUNDRED_MILLION;
    const remaining = Math.max(target - gameData.visits, 0);
    const subtitle = gameData.visits >= ONE_BILLION
        ? '1 Billion Visits!'
        : `**${formatCount(remaining)}** visits left until ${target === ONE_BILLION ? '1 billion' : '900 million'} visits!`;

    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({ name: gameData.name })
        .setDescription(subtitle)
        .addFields(
            { name: 'Visits', value: `**${formatCount(gameData.visits)}**`, inline: false }
        )
        .setFooter({ text: formatCountdown(secondsLeft) })
        .setTimestamp();
}

function buildGameComponents() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Game')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://www.roblox.com/games/${PLACE_ID}/Timebomb-Duels`)
    );
}

module.exports = {
    name: 'game',
    data: new SlashCommandBuilder()
        .setName('game')
        .setDescription('Show the live visit count for Timebomb Duels.'),
    async executeInteraction({ interaction }) {
        try {
            await interaction.deferReply();
            let secondsLeft = 60;
            let currentData = await fetchGameData();
            const components = [buildGameComponents()];
            const message = await interaction.editReply({
                embeds: [buildGameEmbed(currentData, secondsLeft)],
                components
            });

            const refreshTimer = setInterval(async () => {
                try {
                    if (secondsLeft <= 0) {
                        currentData = await fetchGameData();
                        secondsLeft = 60;
                    } else {
                        secondsLeft -= 1;
                    }

                    await message.edit({
                        embeds: [buildGameEmbed(currentData, secondsLeft)],
                        components
                    });
                } catch (err) {
                    console.error('Failed to refresh game visit count:', err);
                }
            }, 1000);

            setTimeout(() => {
                clearInterval(refreshTimer);
            }, 1000 * 60 * 60 * 24);

            return message;
        } catch (err) {
            console.error('Failed to fetch game visit count:', err);
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({ content: 'I could not fetch the live game visit count right now.', ephemeral: true });
            }
            return interaction.editReply({ content: 'I could not fetch the live game visit count right now.' });
        }
    }
};
