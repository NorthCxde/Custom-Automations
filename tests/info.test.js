const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MessageFlags } = require('discord.js');
const command = require('../commands/info');

function user(id, displayName = 'Target') {
    return { id, name: `user_${id}`, displayName };
}

function mockSearch(t, handler) {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
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
        displayName: 'Target', users: [{ id: 1, name: 'user_1' }, { id: 4, name: 'user_4' }], limited: false
    });
    assert.equal(calls, 2);
});

test('search caps results at 75 and bounds sparse-match searches to 10 requests', async t => {
    let calls = 0;
    mockSearch(t, () => {
        calls++;
        return { data: Array.from({ length: 100 }, (_, index) => user(index + 1)), nextPageCursor: 'next' };
    });
    const result = await command.searchDisplayName('Target');
    assert.equal(result.users.length, 75);
    assert.equal(result.limited, true);
    assert.equal(calls, 1);
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

test('pages have 25 numbered username-ID entries and correct Back/Next boundaries', () => {
    const result = {
        displayName: 'Target', users: Array.from({ length: 75 }, (_, index) => user(index + 1)), limited: true
    };
    for (let page = 0; page < 3; page++) {
        const payload = command.buildDisplayNamePage(result, page, 'session');
        const embed = payload.embeds[0].toJSON();
        assert.equal(payload.content, '');
        assert.equal(embed.description.split('\n').length, 25);
        assert.ok(embed.description.startsWith(`${page * 25 + 1}. `));
        assert.ok(embed.description.endsWith(` - ${(page + 1) * 25}`));
        assert.match(embed.description, /https:\/\/www\.roblox\.com\/users\/\d+\/profile/);
        assert.match(embed.footer.text, new RegExp(`Page ${page + 1}/3`));
        assert.match(embed.footer.text, /Search limit reached.*may omit accounts/);
        assert.ok(embed.description.length <= 4096);
        const buttons = payload.components[0].toJSON().components;
        assert.equal(buttons[0].disabled, page === 0);
        assert.equal(buttons[1].disabled, page === 2);
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

test('optional options require exactly one input and reject empty/ambiguous requests', async () => {
    const options = command.data.toJSON().options;
    assert.deepEqual(options.map(option => [option.name, option.required]), [['user', false], ['display_name', false]]);
    for (const values of [{}, { user: '123', display_name: 'Target' }, { display_name: '   ' }]) {
        const request = interaction(values);
        await command.executeInteraction({ interaction: request });
        assert.equal(request.replies.length, 1);
        assert.match(request.replies[0].content, /either user.*not both/);
        assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    }
});

test('display-name execution stays ephemeral and buttons paginate cached results and expire', async t => {
    let calls = 0;
    mockSearch(t, () => {
        calls++;
        return { data: Array.from({ length: 75 }, (_, index) => user(index + 1)), nextPageCursor: null };
    });
    const request = interaction({ display_name: 'Target' });
    await command.executeInteraction({ interaction: request });
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
    const request = interaction({ display_name: 'Target' });
    await command.executeInteraction({ interaction: request });
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
