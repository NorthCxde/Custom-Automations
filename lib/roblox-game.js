const PLACE_ID = '11379739543';
const UNIVERSE_ID = '4049246711';

async function fetchGameData() {
    const response = await fetch(`https://games.roblox.com/v1/games?universeIds=${UNIVERSE_ID}`, {
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        throw new Error(`Roblox game request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const game = payload?.data?.find(entry => entry.id === Number(UNIVERSE_ID));
    if (!game || !Number.isSafeInteger(game.visits) || game.visits < 0
        || !Number.isSafeInteger(game.playing) || game.playing < 0) {
        throw new Error('Roblox returned missing or invalid game statistics');
    }

    return {
        name: String(game.name || 'Timebomb Duels'),
        visits: game.visits,
        ccu: game.playing,
        timestamp: Date.now()
    };
}

module.exports = { PLACE_ID, UNIVERSE_ID, fetchGameData };
