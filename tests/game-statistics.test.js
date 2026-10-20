const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { MessageFlags } = require('discord.js');
const { GameStatistics, summarizeWindow, INTERVAL, DAY, WEEK } = require('../lib/game-statistics');
const { fetchGameData, UNIVERSE_ID, GAMES } = require('../lib/roblox-game');
const command = require('../commands/statistics');

const START = 1700000000000;
const snapshot = (timestamp, visits = 100, ccu = 10) =>
    ({ timestamp, visits, ccu, name: 'Timebomb Duels' });

function storage(t, fetchData) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'game-statistics-'));
    t.after(() => fs.rmSync(directory, { recursive: true }));
    const filePath = path.join(directory, 'history.json');
    return new GameStatistics(filePath, fetchData);
}

function interaction(type = 'visits', game = 'timebomb') {
    const replies = [];
    return {
        guildId: 'guild',
        options: { getString: name => (name === 'game' ? game : type) },
        replies,
        deferReply: async options => {
            assert.deepEqual(options, { flags: MessageFlags.Ephemeral });
            replies.push('deferred');
        },
        editReply: async payload => { replies.push(payload); return payload; },
        reply: async payload => { replies.push(payload); return payload; }
    };
}

test('Roblox fetch uses the matching universe, validates metrics, and has a timeout', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.match(url, new RegExp(`universeIds=${UNIVERSE_ID}`));
        assert.ok(options.signal instanceof AbortSignal);
        return {
            ok: true,
            json: async () => ({ data: [{ id: 1, visits: 0, playing: 0 },
                { id: Number(UNIVERSE_ID), name: 'Timebomb Duels', visits: 900001234, playing: 1250 }] })
        };
    });
    const result = await fetchGameData();
    assert.equal(result.visits, 900001234);
    assert.equal(result.ccu, 1250);
    assert.ok(result.timestamp >= START);
    fetchMock.mock.mockImplementation(async () => ({ ok: false, status: 429 }));
    await assert.rejects(fetchGameData(), /429/);
    fetchMock.mock.mockImplementation(async () => ({
        ok: true, json: async () => ({ data: [{ id: Number(UNIVERSE_ID), visits: '100', playing: 2 }] })
    }));
    await assert.rejects(fetchGameData(), /invalid/);
    fetchMock.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ data: [] }) }));
    await assert.rejects(fetchGameData(), /invalid/);
});

test('Custom Minigames fetches its own universe', async t => {
    t.mock.method(globalThis, 'fetch', async url => {
        assert.match(url, /universeIds=1617185934$/);
        return {
            ok: true,
            json: async () => ({ data: [{ id: 1617185934, name: 'Custom Minigames', visits: 15678922, playing: 180 }] })
        };
    });
    const result = await fetchGameData(GAMES.minigames);
    assert.equal(result.name, 'Custom Minigames');
    assert.equal(result.ccu, 180);
    assert.equal(GAMES.timebomb.historyFile, 'game-statistics.json');
    assert.notEqual(GAMES.minigames.historyFile, GAMES.timebomb.historyFile);
});

test('collects and restores history without requiring a command or extra fetches', async t => {
    let calls = 0;
    const service = storage(t, async () => snapshot(START + calls++ * INTERVAL, 100 + calls * 50));
    assert.equal(service.latest(), null);
    await service.collect();
    await service.collect();
    assert.equal(calls, 2);
    const restored = new GameStatistics(service.filePath, () => { throw new Error('Must not fetch'); });
    assert.deepEqual(restored.latest(), service.latest());
    assert.deepEqual(restored.state.origin, service.state.origin);
    const summary = restored.summarize(restored.latest());
    assert.equal(summary.dailyAverage, 50 * DAY / INTERVAL);
    assert.equal(summary.weeklyAverage, summary.dailyAverage * 7);
    assert.equal(summary.day.visits, null);
    assert.equal(summary.week.visits, null);
});

test('rolling visit totals and full CCU coverage use the exact window', () => {
    const samples = [];
    for (let index = 0; index <= WEEK / INTERVAL; index += 1) {
        samples.push(snapshot(START + index * INTERVAL, 1000 + index * 10, 100));
    }
    const current = samples.at(-1);
    const day = summarizeWindow(samples, current, DAY);
    const week = summarizeWindow(samples, current, WEEK);
    assert.equal(day.visits, DAY / INTERVAL * 10);
    assert.equal(week.visits, WEEK / INTERVAL * 10);
    assert.equal(day.average, 100);
    assert.equal(week.average, 100);
    assert.equal(day.coverage, 1);
    assert.equal(week.complete, true);
    assert.equal(week.peak, 100);
});

test('CCU averages are time-weighted, not averaged by number of samples', () => {
    const samples = [snapshot(START, 100, 10), snapshot(START + INTERVAL, 110, 30)];
    const result = summarizeWindow(samples, snapshot(START + 3 * INTERVAL, 120, 20), 3 * INTERVAL);
    assert.equal(result.average, (10 + 30 * 2) / 3);
    assert.equal(result.peak, 30);
    assert.equal(result.complete, true);
});

test('outages are excluded from CCU averages and stale visit baselines are unavailable', () => {
    const samples = [snapshot(START, 100, 10)];
    const result = summarizeWindow(samples, snapshot(START + DAY, 1000, 50), DAY);
    assert.equal(result.visits, 900);
    assert.equal(result.average, 10);
    assert.equal(result.peak, 50);
    assert.equal(result.complete, false);
    assert.equal(result.coverage, 2 * INTERVAL / DAY);
    const stale = summarizeWindow(samples, snapshot(START + DAY + 3 * INTERVAL, 1000), DAY);
    assert.equal(stale.visits, null);
    const empty = summarizeWindow([], snapshot(START, 100, 20), DAY);
    assert.equal(empty.average, null);
    assert.equal(empty.visits, null);
    assert.equal(empty.coverage, 0);
});

test('counter decreases invalidate affected gains and persist across restarts', async t => {
    let calls = 0;
    const samples = [snapshot(START, 1000), snapshot(START + INTERVAL, 500),
        snapshot(START + 2 * INTERVAL, 1100)];
    const service = storage(t, async () => samples[calls++]);
    for (const sample of samples) await service.collect();
    const restored = new GameStatistics(service.filePath);
    assert.equal(restored.summarize(restored.latest()).dailyAverage, null);
    const result = summarizeWindow(samples, samples.at(-1), 2 * INTERVAL);
    assert.equal(result.visits, null);
    assert.equal(result.counterReset, true);
});

test('raw history is bounded while all-history average retains its original baseline', async t => {
    let current = snapshot(START, 100);
    const service = storage(t, async () => current);
    await service.collect();
    current = snapshot(START + 30 * DAY, 3100);
    await service.collect();
    assert.equal(service.state.snapshots.length, 1);
    assert.equal(service.state.origin.timestamp, START);
    const summary = service.summarize(current);
    assert.equal(summary.dailyAverage, 100);
    assert.equal(summary.weeklyAverage, 700);
    assert.equal(summary.week.visits, null);
});

test('corrupt history is rejected without overwriting it', t => {
    const service = storage(t);
    fs.writeFileSync(service.filePath, '{"version":1,"snapshots":[{}]}');
    const original = fs.readFileSync(service.filePath, 'utf8');
    assert.throws(() => new GameStatistics(service.filePath), /Invalid game statistics history/);
    assert.equal(fs.readFileSync(service.filePath, 'utf8'), original);
    fs.writeFileSync(service.filePath, '{');
    assert.throws(() => new GameStatistics(service.filePath), SyntaxError);
});

test('failed fetches, invalid snapshots, and save failures never become successful data', async t => {
    const service = storage(t, async () => { throw new Error('API unavailable'); });
    await assert.rejects(service.collect(), /API unavailable/);
    assert.equal(service.latest(), null);
    service.fetchData = async () => snapshot(START, -1);
    await assert.rejects(service.collect(), /Invalid/);
    service.fetchData = async () => snapshot(START);
    t.mock.method(fs, 'renameSync', () => { throw new Error('Disk unavailable'); });
    await assert.rejects(service.collect(), /Disk unavailable/);
    assert.equal(service.latest(), null);
});

test('background collection is immediate, single-start, and scheduled at five minutes', async t => {
    const callbacks = [];
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        assert.equal(delay, INTERVAL);
        callbacks.push(callback);
        return { unref() {} };
    });
    t.mock.method(globalThis, 'clearTimeout', () => {});
    let calls = 0;
    const logs = t.mock.method(console, 'log', () => {});
    const errors = t.mock.method(console, 'error', () => {});
    const service = storage(t, async () => snapshot(START + calls++ * INTERVAL));
    service.start();
    service.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(callbacks.length, 1);
    await callbacks[0]();
    assert.equal(calls, 2);
    assert.equal(logs.mock.callCount(), 0);
    assert.equal(errors.mock.callCount(), 0);
    service.stop();
});

test('pending requests are shared and duplicate timestamps cannot be saved', async t => {
    let resolve;
    let calls = 0;
    const service = storage(t, () => {
        calls += 1;
        return new Promise(done => { resolve = done; });
    });
    const first = service.current();
    const second = service.current();
    assert.equal(calls, 1);
    resolve(snapshot(START));
    assert.deepEqual(await first, await second);
    service.fetchData = async () => snapshot(START);
    await service.collect();
    await assert.rejects(service.collect(), /timestamps must increase/);
    assert.equal(service.state.snapshots.length, 1);
});

test('background errors are logged and retried without posting messages', async t => {
    let callback;
    t.mock.method(globalThis, 'setTimeout', (next, delay) => {
        assert.equal(delay, INTERVAL);
        callback = next;
        return { unref() {} };
    });
    t.mock.method(globalThis, 'clearTimeout', () => {});
    const errors = t.mock.method(console, 'error', () => {});
    const service = storage(t, async () => { throw new Error('Rate limited'); });
    service.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors.mock.callCount(), 1);
    assert.equal(typeof callback, 'function');
    assert.equal(service.latest(), null);
    service.stop();
});

test('Visits and CCU replies use the selected game history and never call Roblox or schedule updates', async t => {
    let calls = 0;
    const service = storage(t, async () => snapshot(START + calls++ * INTERVAL, 100 + calls * 10));
    const other = storage(t, async () => { throw new Error('Wrong game'); });
    await service.collect();
    await service.collect();
    for (const [gameKey, gameStatistics] of [['timebomb', { timebomb: service, minigames: other }],
        ['minigames', { timebomb: other, minigames: service }]]) {
        for (const type of ['visits', 'ccu']) {
            const request = interaction(type, gameKey);
            await command.executeInteraction({ client: { gameStatistics }, interaction: request });
            assert.equal(request.replies[0], 'deferred');
            assert.equal(request.replies.length, 2);
            const embed = request.replies[1].embeds[0].toJSON();
            assert.equal(embed.title, type === 'visits' ? 'Visit Statistics' : 'CCU Statistics');
            assert.equal(embed.timestamp, undefined);
            assert.equal(embed.fields, undefined);
            assert.equal(embed.author.url, GAMES[gameKey].url);
            assert.equal(request.replies[1].components[0].toJSON().components[0].url, GAMES[gameKey].url);
            assert.match(embed.description, /### Tracking\n> Since <t:\d+:D> · Updated <t:\d+:R>/);
            assert.match(embed.footer.text, /Does not auto-update/);
            if (type === 'visits') {
                assert.match(embed.description, /### Current Visits\n> \*\*120\*\*/);
                assert.match(embed.description, /### Visits Gained\n> Past 24 hours: \*Collecting data…\*\n> Past 7 days: \*Collecting data…\*/);
                assert.match(embed.description, /### Averages\n> Daily: \*\*2,880\*\*\n> Weekly: \*\*20,160\*\*/);
            } else {
                assert.match(embed.description, /### Current CCU\n> \*\*10\*\* players online/);
                assert.match(embed.description, /### Average CCU\n> Past 24 hours: \*\*10\*\*/);
                assert.match(embed.description, /### Peak CCU\n> Past 24 hours: \*\*10\*\*/);
                assert.match(embed.description, /-# Partial data coverage: 24h 0\.3% · 7d 0\.0%/);
            }
        }
    }
    assert.equal(calls, 2);
});

test('command registers required game and type choices and defaults to existing moderator permissions', () => {
    const definition = command.data.toJSON();
    assert.equal(definition.name, 'statistics');
    assert.equal(definition.dm_permission, false);
    assert.deepEqual(definition.options.map(option => [option.name, option.required]), [['game', true], ['type', true]]);
    assert.deepEqual(definition.options[0].choices.map(choice => choice.name), ['Timebomb Duels', 'Custom Minigames']);
    assert.deepEqual(definition.options[1].choices.map(choice => choice.name), ['Visits', 'CCU']);
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const assignment = source.match(/client\.getDefaultCommandAccessLevel = \(commandName\) => \{[\s\S]*?\n};/)[0];
    const publicNames = source.match(/const DEFAULT_PUBLIC_COMMAND_NAMES = new Set\([^\n]+/)[0];
    const adminNames = source.match(/const ADMIN_ONLY_COMMAND_NAMES = new Set\([\s\S]*?\);/)[0];
    const client = {};
    vm.runInNewContext(`${publicNames}\n${adminNames}\n${assignment}`, { client });
    assert.equal(client.getDefaultCommandAccessLevel('statistics'), 'moderator');
});

test('missing history, unavailable service, and DMs receive explicit replies', async t => {
    const service = storage(t);
    const initial = interaction('visits', 'minigames');
    await command.executeInteraction({ client: { gameStatistics: { minigames: service } }, interaction: initial });
    assert.match(initial.replies[1].content, /No Custom Minigames statistics have been saved/);
    t.mock.method(console, 'error', () => {});
    const unavailable = interaction();
    await command.executeInteraction({ client: {}, interaction: unavailable });
    assert.match(unavailable.replies[1].content, /could not load/);
    const dm = interaction();
    dm.guildId = null;
    await command.executeInteraction({ client: {}, interaction: dm });
    assert.match(dm.replies[0].content, /must be used in a server/);
});

test('/game retains its visit embed, milestone, button, and existing update lifecycle', async t => {
    const gameCommand = require('../commands/game');
    t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        json: async () => ({
            data: [{ id: Number(UNIVERSE_ID), name: 'Timebomb Duels', visits: 950000000, playing: 100 }]
        })
    }));
    let refresh;
    let stop;
    const timer = {};
    const clear = t.mock.method(globalThis, 'clearInterval', value => assert.equal(value, timer));
    t.mock.method(globalThis, 'setInterval', (callback, delay) => {
        assert.equal(delay, 1000);
        refresh = callback;
        return timer;
    });
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        assert.equal(delay, DAY);
        stop = callback;
    });
    let initial;
    let updated;
    const message = { edit: async payload => { updated = payload; } };
    const request = {
        deferReply: async () => {},
        editReply: async payload => { initial = payload; return message; }
    };
    assert.equal(await gameCommand.executeInteraction({ interaction: request }), message);
    const embed = initial.embeds[0].toJSON();
    assert.match(embed.description, /50,000,000.*1 billion/);
    assert.equal(embed.fields[0].value, '**950,000,000**');
    assert.equal(embed.footer.text, 'Updating in 60 seconds');
    assert.match(initial.components[0].toJSON().components[0].url, /11379739543/);
    await refresh();
    assert.equal(updated.embeds[0].toJSON().footer.text, 'Updating in 59 seconds');
    stop();
    assert.equal(clear.mock.callCount(), 1);
});
