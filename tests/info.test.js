const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MessageFlags } = require('discord.js');
const command = require('../commands/info');
const displayNameCommand = require('../commands/search');

function user(id, displayName = 'Target') {
    return { id, name: `user_${id}`, displayName };
}

function mockSearch(t, handler) {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (url.startsWith('https://inventory.roblox.com/')) {
            return { ok: true, json: async () => ({ data: [] }) };
        }
        assert.ok(options.signal instanceof AbortSignal);
        if (new URL(url).pathname === '/search-api/omni-search') {
            return { ok: true, json: async () => ({ searchResults: [], nextPageToken: '' }) };
        }
        assert.equal(new URL(url).pathname, '/v1/users/search');
        assert.equal(new URL(url).searchParams.get('limit'), '100');
        return { ok: true, json: async () => handler(new URL(url).searchParams) };
    });
}

test('search filters exact case-insensitive display names, deduplicates and follows cursors', async t => {
    let calls = 0;
    mockSearch(t, params => {
        calls++;
        assert.equal(params.get('keyword'), 'Target');
        if (calls === 1) {
            assert.equal(params.get('cursor'), null);
            return { data: [user(1, 'target'), user(2, 'Target2'), user(3, 'Different')], nextPageCursor: 'cursor+&=' };
        }
        assert.equal(params.get('cursor'), 'cursor+&=');
        return { data: [user(1), user(4, 'TARGET')], nextPageCursor: null };
    });
    assert.deepEqual(await command.searchDisplayName(' Target '), {
        displayName: 'Target', users: [{ id: 1, name: 'user_1' }, { id: 4, name: 'user_4' }],
        limited: false, peopleSearchUnavailable: false, peopleSearchSkipped: false
    });
    assert.equal(calls, 2);
});

test('people search adds exact matches with unrelated usernames and deduplicates across sources', async t => {
    let peopleCalls = 0;
    let sessionId;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        const parsed = new URL(url);
        if (parsed.pathname === '/v1/users/search') {
            return { ok: true, json: async () => ({ data: [user(1, 'Yang')], nextPageCursor: null }) };
        }
        assert.equal(parsed.pathname, '/search-api/omni-search');
        assert.equal(parsed.searchParams.get('verticalType'), 'user');
        assert.equal(parsed.searchParams.get('searchQuery'), 'Yang');
        sessionId = sessionId || parsed.searchParams.get('sessionId');
        assert.equal(parsed.searchParams.get('sessionId'), sessionId);
        assert.equal(parsed.searchParams.get('globalSessionId'), sessionId);
        peopleCalls++;
        if (peopleCalls === 1) {
            assert.equal(parsed.searchParams.get('pageToken'), null);
            return { ok: true, json: async () => ({
                searchResults: [{ contents: [
                    { contentId: 1, username: 'user_1', displayName: 'Yang' },
                    { contentId: 531359446, username: 'NorthCxde', displayName: 'YANG' },
                    { contentId: 3, username: 'other', displayName: 'Yang2' }
                ] }], nextPageToken: 'next+&='
            }) };
        }
        assert.equal(parsed.searchParams.get('pageToken'), 'next+&=');
        return { ok: true, json: async () => ({
            searchResults: [{ contents: [{ contentId: 4, username: 'different', displayName: 'yang' }] }],
            nextPageToken: ''
        }) };
    });
    const result = await command.searchDisplayName('Yang');
    assert.deepEqual(result.users, [
        { id: 1, name: 'user_1' }, { id: 531359446, name: 'NorthCxde' }, { id: 4, name: 'different' }
    ]);
    assert.equal(result.peopleSearchUnavailable, false);
    assert.equal(peopleCalls, 2);
});

test('combined search reserves space for both sources within the 150-result limit', async t => {
    t.mock.method(globalThis, 'fetch', async url => {
        const parsed = new URL(url);
        if (parsed.pathname === '/v1/users/search') {
            return { ok: true, json: async () => ({
                data: Array.from({ length: 150 }, (_, i) => user(i + 1)), nextPageCursor: null
            }) };
        }
        return { ok: true, json: async () => ({
            searchResults: [{ contents: Array.from({ length: 150 }, (_, i) => ({
                contentId: i + 1001, username: `other_${i}`, displayName: 'Target'
            })) }], nextPageToken: ''
        }) };
    });
    const result = await command.searchDisplayName('Target');
    assert.equal(result.users.length, 150);
    assert.equal(result.users.filter(entry => entry.id > 1000).length, 75);
    assert.equal(result.limited, true);
});

test('people-search failures are visible and short display names skip that search', async t => {
    t.mock.method(console, 'error', () => {});
    let peopleCalls = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        if (new URL(url).pathname === '/v1/users/search') {
            return { ok: true, json: async () => ({ data: [], nextPageCursor: null }) };
        }
        peopleCalls++;
        return { ok: false, status: 429 };
    });
    const failed = await command.searchDisplayName('Target');
    assert.equal(failed.peopleSearchUnavailable, true);
    assert.match(command.buildDisplayNamePage(failed, 0, 'session').embeds[0].toJSON().footer.text,
        /People search unavailable; results incomplete/);
    const short = await command.searchDisplayName('ab');
    assert.equal(peopleCalls, 1);
    assert.equal(short.peopleSearchSkipped, true);
    assert.match(command.buildDisplayNamePage(short, 0, 'session').embeds[0].toJSON().footer.text,
        /People search requires at least 3 characters/);
});

test('search caps results at 150 and bounds sparse-match searches to 10 requests', async t => {
    let calls = 0;
    mockSearch(t, () => {
        calls++;
        return { data: Array.from({ length: 100 }, (_, index) => user((calls - 1) * 100 + index + 1)), nextPageCursor: `next${calls}` };
    });
    const result = await command.searchDisplayName('Target');
    assert.equal(result.users.length, 150);
    assert.equal(result.limited, true);
    assert.equal(calls, 2);
    calls = 0;
    mockSearch(t, () => {
        calls++;
        return { data: [user(calls, 'Different')], nextPageCursor: `cursor${calls}` };
    });
    const sparse = await command.searchDisplayName('Target');
    assert.equal(calls, 10);
    assert.equal(sparse.limited, true);
    assert.deepEqual(sparse.users, []);
});

test('pages have 15 numbered username-ID entries and correct Back/Next boundaries', () => {
    const result = {
        displayName: 'Target', users: Array.from({ length: 150 }, (_, index) => user(index + 1)), limited: true
    };
    for (let page = 0; page < 10; page++) {
        const payload = command.buildDisplayNamePage(result, page, 'session');
        const embed = payload.embeds[0].toJSON();
        assert.equal(payload.content, '');
        assert.equal(embed.description.split('\n').filter(line => /^\d+\./.test(line)).length, 15);
        assert.ok(embed.description.includes(`\n${page * 15 + 1}. `));
        assert.ok(embed.description.endsWith(` - ${(page + 1) * 15}`));
        assert.match(embed.description, /https:\/\/www\.roblox\.com\/users\/\d+\/profile/);
        assert.match(embed.footer.text, new RegExp(`Page ${page + 1}/10`));
        assert.match(embed.footer.text, /Search limit reached.*may omit accounts/);
        assert.ok(embed.description.length <= 4096);
        const buttons = payload.components[0].toJSON().components;
        assert.equal(buttons[0].disabled, page === 0);
        assert.equal(buttons[1].disabled, page === 9);
    }
    const empty = command.buildDisplayNamePage({ displayName: 'Target', users: [], limited: false }, 0, 'session');
    assert.match(empty.embeds[0].toJSON().description, /No exact display-name matches/);
    assert.deepEqual(empty.components, []);
});

function interaction(values) {
    const collector = new EventEmitter();
    collector.stop = reason => collector.emit('end', [], reason);
    const replies = [];
    return {
        id: 'session', user: { id: 'moderator' },
        options: { getString: name => values[name] || null },
        replies, collector,
        reply: async payload => { replies.push(payload); },
        deferReply: async payload => { replies.push(payload); },
        editReply: async function (payload) {
            replies.push(payload);
            return { createMessageComponentCollector: options => {
                this.collectorOptions = options;
                return collector;
            } };
        }
    };
}

test('info requires user and search requires displayname with optional item', async () => {
    const options = command.data.toJSON().options;
    assert.deepEqual(options.map(option => [option.name, option.required]), [['user', true]]);
    assert.equal(displayNameCommand.data.toJSON().name, 'search');
    assert.deepEqual(displayNameCommand.data.toJSON().options.map(option => [option.name, Boolean(option.required)]), [['displayname', true], ['item', false]]);
    for (const [handler, values, expected] of [
        [command, { user: '   ' }, /username or user ID is required/],
        [displayNameCommand, { displayname: '   ' }, /display name is required/]
    ]) {
        const request = interaction(values);
        await handler.executeInteraction({ interaction: request });
        assert.equal(request.replies.length, 1);
        assert.match(request.replies[0].content, expected);
        assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    }
});

test('display-name execution stays ephemeral and buttons paginate cached results and expire', async t => {
    let calls = 0;
    mockSearch(t, () => {
        calls++;
        return { data: Array.from({ length: 45 }, (_, index) => user(index + 1)), nextPageCursor: null };
    });
    const request = interaction({ displayname: 'Target' });
    await displayNameCommand.executeInteraction({ interaction: request });
    assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    assert.equal(request.collectorOptions.time, 300000);
    assert.equal(request.collectorOptions.filter({ user: { id: 'other' }, customId: 'info_display_next:session' }), false);
    assert.equal(request.collectorOptions.filter({ user: request.user, customId: 'info_display_next:other' }), false);
    assert.equal(request.collectorOptions.filter({ user: request.user, customId: 'info_display_next:session' }), true);
    for (const [direction, expected] of [['next', 2], ['next', 3], ['back', 2], ['back', 1]]) {
        let updated;
        const button = { customId: `info_display_${direction}:session`, update: async payload => { updated = payload; } };
        await request.collector.listeners('collect')[0](button);
        assert.match(updated.embeds[0].toJSON().footer.text, new RegExp(`Page ${expected}/3`));
    }
    assert.equal(calls, 1);
    await request.collector.listeners('end')[0]();
    assert.deepEqual(request.replies.at(-1), { components: [] });
});

test('failed/malformed/repeated search pages reject rather than return successful partial results', async t => {
    mockSearch(t, () => ({ data: [user(1)], nextPageCursor: 'repeat' }));
    await assert.rejects(command.searchDisplayName('Target'), /repeated/);
    for (const result of [{}, { data: [user('invalid')] }, { data: [], nextPageCursor: 1 }]) {
        mockSearch(t, () => result);
        await assert.rejects(command.searchDisplayName('Target'), /invalid/);
    }
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 429 }));
    t.mock.method(console, 'error', () => {});
    const request = interaction({ displayname: 'Target' });
    await displayNameCommand.executeInteraction({ interaction: request });
    assert.match(request.replies.at(-1).content, /search failed or timed out/);
    assert.deepEqual(request.replies.at(-1).components, []);
});

test('existing username lookup still shows profile info and Ban/Unban buttons', async t => {
    t.mock.method(globalThis, 'fetch', async url => {
        if (url.endsWith('/usernames/users')) return { ok: true, json: async () => ({ data: [{ id: 123 }] }) };
        if (url.endsWith('/users/123')) return {
            ok: true, json: async () => ({ id: 123, name: 'Original', displayName: 'Original', created: '2020-01-01T00:00:00Z' })
        };
        if (url.includes('can-view-inventory')) return { ok: true, json: async () => ({ canView: false }) };
        if (url.includes('avatar-headshot')) return { ok: true, json: async () => ({ data: [] }) };
        throw new Error(`Unexpected request: ${url}`);
    });
    // This synthetic moderator has no registered Trello credentials.
    const request = interaction({ user: 'Original' });
    await command.executeInteraction({ interaction: request });
    const payload = request.replies.at(-1);
    assert.equal(payload.embeds[0].toJSON().title, 'Original');
    assert.deepEqual(payload.components[0].toJSON().components.map(button => button.label), ['Ban', 'Unban']);
});

test('already-banned automatic info shows Status and hides only the Ban button', () => {
    const user = { id: 123, name: 'ReportedUser', displayName: 'ReportedUser', created: '2020-01-01T00:00:00Z' };
    const embed = command.buildInfoEmbed(user, null, '✅ Has played Timebomb Duels', [], {
        showTrelloCards: false, status: '⚠️Already Banned'
    }).toJSON();
    assert.match(embed.description, /\*\*Status\*\*\n⚠️Already Banned/);
    assert.deepEqual(command.buildInfoComponents('123', { alreadyBanned: true })[0]
        .toJSON().components.map(button => button.label), ['Unban']);
    assert.deepEqual(command.buildInfoComponents('123')[0]
        .toJSON().components.map(button => button.label), ['Ban', 'Unban']);
});

test('both game badges prioritize players stably without mutating search results', async t => {
    const result = { displayName: 'Target', users: [user(1), user(2), user(3), user(4)], limited: false };
    const original = JSON.stringify(result);
    let active = 0;
    let peak = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        const parsed = new URL(url);
        assert.equal(parsed.hostname, 'inventory.roblox.com');
        const badgeId = Number(parsed.pathname.split('/').at(-1));
        assert.ok([2142457718, 2124646244].includes(badgeId));
        const id = Number(parsed.pathname.split('/')[3]);
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        const badges = id === 2 ? [2142457718] : id === 3 ? [2124646244] : id === 4 ? [2142457718, 2124646244] : [];
        return {
            ok: true,
            json: async () => ({ data: badges.includes(badgeId) ? [{ id: badgeId }] : [] })
        };
    });
    const ranked = await command.prioritizeGamePlayers(result);
    assert.deepEqual(ranked.users.map(user => user.id), [2, 3, 4, 1]);
    assert.deepEqual(ranked.users[0].games, ['Timebomb Duels']);
    assert.deepEqual(ranked.users[1].games, ['Custom Minigames']);
    assert.deepEqual(ranked.users[2].games, ['Timebomb Duels', 'Custom Minigames']);
    assert.equal(ranked.badgeCheckFailures, 0);
    assert.equal(JSON.stringify(result), original);
    assert.ok(peak <= 4);
    const description = command.buildDisplayNamePage(ranked, 0, 'session').embeds[0].toJSON().description;
    assert.ok(description.indexOf('**Top Results**') < description.indexOf('**Other Results**'));
    assert.ok(description.includes('4. [user\\_1]'));
});

test('item owners with a badge rank first, followed by item owners and badge owners', async t => {
    const result = { displayName: 'Target', users: [user(1), user(2), user(3), user(4), user(5)], limited: false };
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        const path = new URL(url).pathname.split('/');
        const id = Number(path[3]);
        if (path[5] === 'Asset') {
            assert.equal(path[6], '123456789');
            assert.equal(path[7], 'is-owned');
            return { ok: true, json: async () => [2, 4].includes(id) };
        }
        return { ok: true, json: async () => ({
            data: [3, 4].includes(id) && path[6] === '2142457718' ? [{ id: '2142457718' }] : []
        }) };
    });
    const ranked = await command.prioritizeGamePlayers(result, '123456789');
    assert.deepEqual(ranked.users.map(entry => entry.id), [4, 2, 3, 1, 5]);
    assert.equal(ranked.itemCheckFailures, 0);
    const description = command.buildDisplayNamePage(ranked, 0, 'session').embeds[0].toJSON().description;
    assert.ok(description.indexOf('**Item Owners with Game History**') < description.indexOf('**Item Owners**'));
    assert.ok(description.indexOf('**Item Owners**') < description.indexOf('**Top Results**'));
    assert.ok(description.indexOf('**Top Results**') < description.indexOf('**Other Results**'));
});

test('private or malformed item checks remain unknown and show a warning', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async url => {
        if (url.includes('/items/Asset/')) {
            return url.includes('/users/1/')
                ? { ok: false, status: 403 }
                : { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [] }) };
    });
    const ranked = await command.prioritizeGamePlayers({ displayName: 'Target', users: [user(1), user(2)] }, '123');
    assert.equal(ranked.itemCheckFailures, 2);
    assert.deepEqual(ranked.users.map(entry => entry.ownsItem), [null, null]);
    assert.match(command.buildDisplayNamePage(ranked, 0, 'session').embeds[0].toJSON().footer.text,
        /2 item checks unavailable; ownership unknown/);
});

test('search rejects invalid item IDs before making requests', async t => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch'); });
    for (const item of ['0', '-1', '123abc', '1.2']) {
        const request = interaction({ displayname: 'Target', item });
        await displayNameCommand.executeInteraction({ interaction: request });
        assert.match(request.replies[0].content, /valid positive Roblox asset ID/);
        assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    }
});

test('/search ranks an item and badge owner found only by people search first', async t => {
    let assetChecks = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        const parsed = new URL(url);
        if (parsed.pathname === '/v1/users/search') {
            return { ok: true, json: async () => ({ data: [user(1), user(2)], nextPageCursor: null }) };
        }
        if (parsed.pathname === '/search-api/omni-search') {
            return { ok: true, json: async () => ({
                searchResults: [{ contents: [{ contentId: 3, username: 'different', displayName: 'Target' }] }],
                nextPageToken: ''
            }) };
        }
        if (parsed.pathname.includes('/items/Asset/123/is-owned')) {
            assetChecks++;
            return { ok: true, json: async () => /\/users\/[23]\//.test(parsed.pathname) };
        }
        if (parsed.pathname.includes('/users/3/items/Badge/2142457718')) {
            return { ok: true, json: async () => ({ data: [{ id: '2142457718' }] }) };
        }
        return { ok: true, json: async () => ({ data: [] }) };
    });
    const request = interaction({ displayname: 'Target', item: '123' });
    await displayNameCommand.executeInteraction({ interaction: request });
    assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(request.replies[1].content, /item ownership/);
    const embed = request.replies.at(-1).embeds[0].toJSON();
    assert.equal(assetChecks, 3);
    assert.match(embed.description, /\*\*Item Owners with Game History\*\*\n1\. \[different\]/);
    assert.match(embed.description, /\*\*Item Owners\*\*\n2\. \[user\\_2\]/);
    assert.match(embed.footer.text, /Item 123/);
});

test('item rate limiting stops further requests and reports all unchecked ownership', async t => {
    t.mock.method(console, 'error', () => {});
    let itemCalls = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        if (url.includes('/items/Asset/')) {
            itemCalls++;
            return { ok: false, status: 429 };
        }
        return { ok: true, json: async () => ({ data: [] }) };
    });
    const ranked = await command.prioritizeGamePlayers({
        displayName: 'Target', users: Array.from({ length: 20 }, (_, i) => user(i + 1))
    }, '123');
    assert.ok(itemCalls <= 4);
    assert.equal(ranked.itemCheckFailures, 20);
    assert.ok(ranked.users.every(entry => entry.ownsItem === null));
});

test('badge rate limits stop further requests and show incomplete-ranking warning', async t => {
    let calls = 0;
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async () => {
        calls++;
        return { ok: false, status: 429 };
    });
    const result = { displayName: 'Target', users: Array.from({ length: 100 }, (_, index) => user(index + 1)), limited: true };
    const ranked = await command.prioritizeGamePlayers(result);
    assert.ok(calls <= 4);
    assert.equal(ranked.badgeCheckFailures, 100);
    assert.deepEqual(ranked.users.map(user => user.id), result.users.map(user => user.id));
    const embed = command.buildDisplayNamePage(ranked, 0, 'session').embeds[0].toJSON();
    assert.match(embed.footer.text, /100 badge checks unavailable; ranking incomplete/);
    assert.doesNotMatch(embed.description, /Top Results/);
});

test('a confirmed badge remains a Top Result when the other game check fails', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async url => {
        if (url.endsWith('/2142457718')) return { ok: false, status: 403 };
        assert.ok(url.endsWith('/items/Badge/2124646244'));
        return { ok: true, json: async () => ({ data: [{ id: '2124646244' }] }) };
    });
    const ranked = await command.prioritizeGamePlayers({
        displayName: 'Target', users: [user(1)], limited: false
    });
    assert.deepEqual(ranked.users[0].games, ['Custom Minigames']);
    assert.equal(ranked.badgeCheckFailures, 1);
    assert.match(command.buildDisplayNamePage(ranked, 0, 'session').embeds[0].toJSON().description, /Top Results/);
});

test('invalid inventory responses are flagged rather than classified as no game history', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({}) }));
    const ranked = await command.prioritizeGamePlayers({
        displayName: 'Target', users: [user(1)], limited: false
    });
    assert.equal(ranked.badgeCheckFailures, 1);
    assert.deepEqual(ranked.users[0].games, []);
});

test('Top Results spanning pages keep 15 users per page and all 150 unique entries', () => {
    const result = {
        displayName: 'Target', limited: true,
        users: Array.from({ length: 150 }, (_, index) => ({
            ...user(index + 1), games: index < 20 ? ['Timebomb Duels'] : []
        }))
    };
    const lines = [];
    for (let page = 0; page < 10; page++) {
        const embed = command.buildDisplayNamePage(result, page, 'session').embeds[0].toJSON();
        const entries = embed.description.split('\n').filter(line => /^\d+\./.test(line));
        assert.equal(entries.length, 15);
        lines.push(...entries);
        if (page === 1) {
            assert.match(embed.description, /Top Results/);
            assert.match(embed.description, /Other Results/);
        }
    }
    assert.equal(new Set(lines).size, 150);
});

test('Top Results show exact played-game labels while Other Results stay unlabeled', () => {
    const result = {
        displayName: 'Target', users: [
            { ...user(1), games: ['Timebomb Duels'] },
            { ...user(2), games: ['Custom Minigames'] },
            { ...user(3), games: ['Timebomb Duels', 'Custom Minigames'] },
            { ...user(4), games: [] }
        ]
    };
    const description = command.buildDisplayNamePage(result, 0, 'session').embeds[0].toJSON().description;
    assert.match(description, / - 1 - Played Timebomb Duels/);
    assert.match(description, / - 2 - Played Custom Minigames/);
    assert.match(description, / - 3 - Played Both Games/);
    assert.ok(description.endsWith(' - 4'));
});

test('long usernames with played labels preserve all 15 entries within Discord embed limits', () => {
    const result = {
        displayName: 'Target',
        users: Array.from({ length: 15 }, (_, index) => ({
            id: Number.MAX_SAFE_INTEGER - index, name: '_'.repeat(20), games: ['Custom Minigames']
        }))
    };
    const embed = command.buildDisplayNamePage(result, 0, 'session').embeds[0].toJSON();
    assert.ok(embed.description.length <= 4096);
    for (const field of embed.fields || []) assert.ok(field.value.length <= 1024);
    const text = [embed.description, ...(embed.fields || []).map(field => field.value)].join('\n');
    assert.equal(text.split('\n').filter(line => /^\d+\./.test(line)).length, 15);
    assert.equal((text.match(/Played Custom Minigames/g) || []).length, 15);
    assert.ok(text.length + embed.title.length + embed.footer.text.length + 9 <= 6000);
});
