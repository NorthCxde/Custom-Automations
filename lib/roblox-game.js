const GAMES = {
    timebomb: {
        key: 'timebomb',
        label: 'Timebomb Duels',
        placeId: '11379739543',
        universeId: '4049246711',
        badgeId: '2142457718',
        badgeName: 'Alpha',
        url: 'https://www.roblox.com/games/11379739543/Timebomb-Duels',
        historyFile: 'game-statistics.json'
    },
    minigames: {
        key: 'minigames',
        label: 'Custom Minigames',
        placeId: '4796282774',
        universeId: '1617185934',
        badgeId: '2124646244',
        badgeName: 'Played Custom Minigames!',
        url: 'https://www.roblox.com/games/4796282774/Custom-Minigames',
        historyFile: 'game-statistics-custom-minigames.json'
    }
};

const PLACE_ID = GAMES.timebomb.placeId;
const UNIVERSE_ID = GAMES.timebomb.universeId;
const optionalFailures = new Set();

async function fetchJson(url) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        throw new Error(`Roblox request failed with status ${response.status}`);
    }
    return response.json();
}

async function optionalMetric(game, metric, request, read) {
    const failureKey = `${game.key}:${metric}`;
    try {
        const value = read(await request());
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Roblox returned a missing or invalid count');
        optionalFailures.delete(failureKey);
        return value;
    } catch (error) {
        if (!optionalFailures.has(failureKey)) {
            console.error(`Failed to fetch ${metric} for ${game.label}:`, error);
            optionalFailures.add(failureKey);
        }
        return null;
    }
}

async function fetchGameData(game = GAMES.timebomb, includeExtended = false) {
    const gameRequest = fetchJson(`https://games.roblox.com/v1/games?universeIds=${game.universeId}`);
    const [gameResult, votesResult, badgeResult] = includeExtended
        ? await Promise.allSettled([
            gameRequest,
            fetchJson(`https://games.roblox.com/v1/games/${game.universeId}/votes`),
            fetchJson(`https://badges.roblox.com/v1/badges/${game.badgeId}`)
        ])
        : [await gameRequest.then(
            value => ({ status: 'fulfilled', value }),
            reason => ({ status: 'rejected', reason })
        ), null, null];
    if (gameResult.status === 'rejected') throw gameResult.reason;

    const data = gameResult.value?.data?.find(entry => entry.id === Number(game.universeId));
    if (!data || !Number.isSafeInteger(data.visits) || data.visits < 0
        || !Number.isSafeInteger(data.playing) || data.playing < 0) {
        throw new Error('Roblox returned missing or invalid game statistics');
    }

    const optionalNumber = (metric, response, read) => optionalMetric(
        game,
        metric,
        async () => {
            if (response.status === 'rejected') throw response.reason;
            return response.value;
        },
        read
    );
    const badgeStatistic = field => value =>
        value.awardingUniverse?.id === Number(game.universeId) ? value.statistics?.[field] : null;
    let favorites = null;
    let likes = null;
    let dislikes = null;
    let newPlayers = null;
    let badgeAwards = null;
    if (includeExtended) {
        [favorites, likes, dislikes, newPlayers, badgeAwards] = await Promise.all([
            optionalNumber('favorites', { status: 'fulfilled', value: data }, value => value.favoritedCount),
            optionalNumber('likes', votesResult, value => value.id === Number(game.universeId) ? value.upVotes : null),
            optionalNumber('dislikes', votesResult, value => value.id === Number(game.universeId) ? value.downVotes : null),
            optionalNumber('past-day badge awards', badgeResult, badgeStatistic('pastDayAwardedCount')),
            optionalNumber('total badge awards', badgeResult, badgeStatistic('awardedCount'))
        ]);
    }

    return {
        name: String(data.name || game.label),
        visits: data.visits,
        ccu: data.playing,
        favorites,
        likes,
        dislikes,
        newPlayers,
        badgeAwards,
        timestamp: Date.now()
    };
}

module.exports = { GAMES, PLACE_ID, UNIVERSE_ID, fetchGameData };
