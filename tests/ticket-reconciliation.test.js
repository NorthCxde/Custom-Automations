const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageType } = require('discord.js');
const { reconcileTicket, REPORTED_MESSAGE } = require('../lib/duplicate-report');
const { buildInfoEmbed, fetchTrelloBlacklistSnapshot } = require('../commands/info');

const BOT = 'automation';
const REPORTS = 'reports';
const USER = '10204861101';

function info(userId = USER, authorId = BOT) {
    const user = { id: userId, name: 'ReportedUser', created: '2020-01-01', description: '' };
    return {
        author: { id: authorId },
        embeds: [buildInfoEmbed(user, null, 'No game history', [], { showTrelloCards: false }).toJSON()]
    };
}

function fixture(extraMessages = []) {
    const events = [];
    const messages = new Map([
        ['10', {
            type: MessageType.RecipientAdd, author: { id: REPORTS }, createdTimestamp: 10,
            mentions: { users: { find: predicate => [{ id: 'opener' }].find(predicate) } }
        }],
        ['20', info()],
        ...extraMessages
    ]);
    const thread = {
        id: 'ticket', parentId: '964450684613328916', archived: false, locked: false,
        messages: { fetch: async () => messages },
        send: async () => {
            events.push('notice');
            return {
                edit: async () => {},
                createMessageComponentCollector: () => ({
                    on: (event, listener) => { if (event === 'end') listener([], 'time'); }
                })
            };
        },
        setLocked: async () => events.push('locked'),
        setArchived: async () => events.push('archived')
    };
    return {
        events, messages, thread,
        options: {
            thread, botId: BOT, reportsBotId: REPORTS,
            blacklistCards: [{ userId: USER, listName: 'Blacklist' }],
            fetchUser: async id => ({
                id, send: async text => { assert.equal(text, REPORTED_MESSAGE); events.push('dm'); }
            })
        }
    };
}

test('reconciliation closes a blacklisted single-embed ticket without any Roblox or other HTTP requests', async t => {
    t.mock.method(global, 'fetch', async () => { throw new Error('No HTTP requests allowed'); });
    const { options, events } = fixture();
    assert.deepEqual(await reconcileTicket(options), { duplicateClosed: true, closeCancelled: undefined });
    assert.deepEqual(events, ['dm', 'notice', 'locked', 'archived']);
    assert.equal(global.fetch.mock.callCount(), 0);
});

test('reconciliation keeps multi-user, unbanned, cancelled, missing-opener and out-of-scope tickets open', async () => {
    const cases = [
        f => f.messages.set('30', info('987654321')),
        f => { f.options.blacklistCards = []; },
        f => f.messages.set('30', { author: { id: BOT }, content: `${REPORTED_MESSAGE}\nAutomatic closure cancelled.` }),
        f => f.messages.delete('10'),
        f => { f.thread.parentId = '1406849874925719583'; },
        f => { f.thread.archived = true; },
        f => { f.thread.locked = true; },
        f => { f.messages.delete('20'); }
    ];
    for (const change of cases) {
        const f = fixture();
        change(f);
        assert.deepEqual(await reconcileTicket(f.options), {});
        assert.deepEqual(f.events, []);
    }
});

test('duplicate embeds count once and another bots embed is ignored', async () => {
    const f = fixture([['30', info()], ['40', info('987654321', 'someone-else')]]);
    assert.equal((await reconcileTicket(f.options)).duplicateClosed, true);
});

test('reconciliation paginates history so an older second embed prevents closure', async () => {
    const f = fixture();
    const recent = new Map(Array.from({ length: 100 }, (_, i) => [String(1000 + i), { author: { id: 'reporter' } }]));
    recent.set('1099', info());
    const older = new Map([['10', f.messages.get('10')], ['20', info('987654321')]]);
    const requests = [];
    f.thread.messages.fetch = async options => {
        requests.push(options);
        return options.before ? older : recent;
    };
    assert.deepEqual(await reconcileTicket(f.options), {});
    assert.deepEqual(requests, [{ limit: 100 }, { limit: 100, before: '1000' }]);
    assert.deepEqual(f.events, []);
});

test('history fetch errors and malformed bot info embeds fail safely without closing', async () => {
    const f = fixture();
    f.messages.set('30', { author: { id: BOT }, embeds: [{ description: '**Roblox Information**\nUnknown format' }] });
    await assert.rejects(reconcileTicket(f.options), /Cannot safely identify/);
    f.thread.messages.fetch = async () => { throw new Error('Discord unavailable'); };
    await assert.rejects(reconcileTicket(f.options), /Discord unavailable/);
    assert.deepEqual(f.events, []);
});

test('one Trello snapshot fetches both lists once for all users and rejects rate limits', async t => {
    const urls = [];
    t.mock.method(global, 'fetch', async url => {
        urls.push(new URL(url));
        if (url.includes('/boards/')) {
            return { ok: true, json: async () => [{ id: 'cm', name: 'Blacklist' }, { id: 'tb', name: 'TB Duels Blacklist' }] };
        }
        return { ok: true, json: async () => [
            { id: 'card', name: USER, shortUrl: 'https://trello.example/card' },
            { id: 'second', name: '987654321', shortUrl: 'https://trello.example/second' }
        ] };
    });
    const cards = await fetchTrelloBlacklistSnapshot({ key: 'test-key', token: 'test-token' });
    assert.equal(urls.length, 3);
    assert.equal(urls.every(url => url.hostname === 'api.trello.com'), true);
    assert.equal(cards.length, 4);
    assert.equal(cards.filter(card => card.userId === USER).length, 2);
    t.mock.method(global, 'fetch', async () => ({ ok: false, status: 429 }));
    await assert.rejects(fetchTrelloBlacklistSnapshot({ key: 'test-key', token: 'test-token' }), /status 429/);
});
