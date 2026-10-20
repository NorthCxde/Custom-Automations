const GAMES = {
    timebomb: {
        key: 'timebomb',
        label: 'Timebomb Duels',
        placeId: '11379739543',
        universeId: '4049246711',
        url: 'https://www.roblox.com/games/11379739543/Timebomb-Duels',
        historyFile: 'game-statistics.json'
    },
    minigames: {
        key: 'minigames',
        label: 'Custom Minigames',
        placeId: '4796282774',
        universeId: '1617185934',
        url: 'https://www.roblox.com/games/4796282774/Custom-Minigames',
        historyFile: 'game-statistics-custom-minigames.json'
    }
};

const PLACE_ID = GAMES.timebomb.placeId;
const UNIVERSE_ID = GAMES.timebomb.universeId;

async function fetchGameData(game = GAMES.timebomb) {
    const response = await fetch(`https://games.roblox.com/v1/games?universeIds=${game.universeId}`, {
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        throw new Error(`Roblox game request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const data = payload?.data?.find(entry => entry.id === Number(game.universeId));
    if (!data || !Number.isSafeInteger(data.visits) || data.visits < 0
        || !Number.isSafeInteger(data.playing) || data.playing < 0) {
        throw new Error('Roblox returned missing or invalid game statistics');
    }

    return {
        name: String(data.name || game.label),
        visits: data.visits,
        ccu: data.playing,
        timestamp: Date.now()
    };
}

module.exports = { GAMES, PLACE_ID, UNIVERSE_ID, fetchGameData };
