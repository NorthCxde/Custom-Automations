const test = require('node:test');
const assert = require('node:assert/strict');
const { ButtonStyle, TextInputStyle } = require('discord.js');
const {
    buildBlacklistMenu, handleWeekInteraction, getBlacklistRequest,
    createBlacklistCard, addBlacklistComment, setBlacklistDueDate, verifyBlacklistDueDate
} = require('../lib/info-blacklist');

const client = { isManuallyAddedModerator: id => id === 'moderator' };
let sequence = 0;

function interaction(customId, modal = false) {
    return {
        id: `draft${++sequence}`,
        customId,
        user: { id: 'moderator' },
        guildId: 'guild',
        isButton: () => !modal,
        isModalSubmit: () => modal,
        fields: { getTextInputValue: () => '  alt farming\nContext & evidence: https://example.com/?a=1&b=2  ' },
        reply: async function (payload) { this.response = payload; },
        showModal: async function (payload) { this.modal = payload.toJSON(); }
    };
}

test('menu preserves two red two-week options and adds a green 1 Week option', () => {
    const buttons = buildBlacklistMenu('531359446').toJSON().components;
    assert.deepEqual(buttons.map(button => [button.label, button.style]), [
        ['Blacklist', ButtonStyle.Danger], ['TB Duels Blacklist', ButtonStyle.Danger],
        ['1 Week', ButtonStyle.Success]
    ]);
    for (const button of buttons.slice(0, 2)) {
        const request = getBlacklistRequest(interaction(button.custom_id));
        assert.equal(request.days, 14);
        assert.equal(request.comment, null);
    }
});

test('1 Week opens required paragraph modal before offering both lists and retaining context', async () => {
    const start = interaction('info_blacklist_week:531359446');
    assert.equal(await handleWeekInteraction(client, start), true);
    assert.equal(start.response, undefined);
    const input = start.modal.components[0].components[0];
    assert.equal(input.custom_id, 'blacklist_comment');
    assert.equal(input.style, TextInputStyle.Paragraph);
    assert.equal(input.required, true);
    assert.equal(input.max_length, 4000);

    for (const listName of ['Blacklist', 'TB Duels Blacklist']) {
        const submit = interaction(start.modal.custom_id, true);
        assert.equal(await handleWeekInteraction(client, submit), true);
        assert.equal(submit.response.ephemeral, true);
        const buttons = submit.response.components[0].toJSON().components;
        assert.deepEqual(buttons.map(button => button.label), ['Blacklist', 'TB Duels Blacklist']);
        const button = buttons.find(button => button.label === listName);
        assert.ok(button.custom_id.length <= 100);
        const selection = interaction(button.custom_id);
        assert.deepEqual(getBlacklistRequest(selection), {
            userId: '531359446', listName, days: 7,
            comment: 'alt farming\nContext & evidence: https://example.com/?a=1&b=2'
        });
        assert.throws(() => getBlacklistRequest(selection), /expired or was already used/);
    }
});

test('permission, owner, server, expiry and invalid-input guards prevent unauthorized drafts', async t => {
    const denied = interaction('info_blacklist_week:531359446');
    denied.user.id = 'outsider';
    await handleWeekInteraction(client, denied);
    assert.match(denied.response.content, /manually added/);
    assert.equal(denied.modal, undefined);
    const deniedModal = interaction('info_blacklist_week_comment:531359446', true);
    deniedModal.user.id = 'outsider';
    await handleWeekInteraction(client, deniedModal);
    assert.match(deniedModal.response.content, /manually added/);
    const blank = interaction('info_blacklist_week_comment:531359446', true);
    blank.fields.getTextInputValue = () => '   ';
    await handleWeekInteraction(client, blank);
    assert.match(blank.response.content, /Enter a Trello comment/);
    const invalid = interaction('info_blacklist_week:invalid');
    await handleWeekInteraction(client, invalid);
    assert.match(invalid.response.content, /Invalid Roblox/);

    const submit = interaction('info_blacklist_week_comment:531359446', true);
    await handleWeekInteraction(client, submit);
    const customId = submit.response.components[0].toJSON().components[0].custom_id;
    const wrongOwner = interaction(customId);
    wrongOwner.user.id = 'other';
    assert.throws(() => getBlacklistRequest(wrongOwner), /another moderator or server/);
    const wrongGuild = interaction(customId);
    wrongGuild.guildId = 'other';
    assert.throws(() => getBlacklistRequest(wrongGuild), /another moderator or server/);
    assert.throws(() => getBlacklistRequest(interaction(customId.replace('531359446', '123'))), /another moderator/);
    t.mock.method(Date, 'now', () => new Date('2099-01-01T00:00:00Z').getTime());
    assert.throws(() => getBlacklistRequest(interaction(customId)), /expired/);
    assert.throws(() => getBlacklistRequest(interaction('info_blacklist_add:531359446:Other list')), /Invalid blacklist/);
    assert.equal(await handleWeekInteraction(client, interaction('unrelated')), false);
});

test('Trello requests set exact seven/fourteen-day due dates and post context as a comment, not description', async t => {
    const now = new Date('2026-11-01T16:00:00Z').getTime();
    t.mock.method(Date, 'now', () => now);
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url: new URL(url), options });
        return { ok: true, json: async () => ({ id: 'card', shortUrl: 'https://trello.com/c/card' }) };
    });
    const credentials = { key: 'test-key', token: 'test-token' };
    for (const days of [7, 14]) {
        const { card, dueDate } = await createBlacklistCard(credentials, 'selected-list', '531359446', days);
        assert.equal(new Date(dueDate).getTime() - now, days * 86400000);
        assert.equal(card.id, 'card');
        const call = calls.at(-1);
        assert.equal(call.options.method, 'POST');
        assert.equal(call.url.searchParams.get('idList'), 'selected-list');
        assert.equal(call.url.searchParams.get('name'), '531359446');
        assert.equal(call.url.searchParams.get('due'), dueDate);
        assert.equal(call.url.searchParams.has('desc'), false);
    }
    const comment = 'alt farming & context\nhttps://example.com/?a=1&b=2';
    await addBlacklistComment(credentials, 'card', comment);
    const call = calls.at(-1);
    assert.equal(call.url.pathname, '/1/cards/card/actions/comments');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.body.get('text'), comment);
    assert.equal(call.options.body.get('token'), 'test-token');
});

test('Trello card/comment failures reject explicitly and never appear successful', async t => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
    const credentials = { key: 'test-key', token: 'test-token' };
    await assert.rejects(createBlacklistCard(credentials, 'list', '123', 7), /card creation failed.*403/);
    await assert.rejects(addBlacklistComment(credentials, 'card', 'context'), /comment creation failed.*403/);
    await assert.rejects(addBlacklistComment(credentials, null, 'context'), /card ID/);
});

test('one-week due-date update overrides the board default and verifies the returned date', async t => {
    const credentials = { key: 'test-key', token: 'test-token' };
    const dueDate = '2026-11-08T16:00:00.000Z';
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, options });
        return {
            ok: true,
            json: async () => options.method === 'POST'
                ? { id: 'card', due: '2026-11-16T06:59:00.000Z' }
                : { id: 'card', due: dueDate }
        };
    });
    const { card } = await createBlacklistCard(credentials, 'list', '123', 7);
    await setBlacklistDueDate(credentials, card.id, dueDate);
    assert.equal(calls[1].url, 'https://api.trello.com/1/cards/card');
    assert.equal(calls[1].options.method, 'PUT');
    assert.equal(calls[1].options.body.get('due'), dueDate);
    assert.equal(calls[1].options.body.get('dueComplete'), 'false');
    assert.equal(calls[1].options.body.get('token'), 'test-token');
});

test('due-date updates reject API errors, missing IDs and dates overridden by Trello', async t => {
    const credentials = { key: 'test-key', token: 'test-token' };
    const dueDate = '2026-11-08T16:00:00.000Z';
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
    await assert.rejects(setBlacklistDueDate(credentials, 'card', dueDate), /due-date update failed.*403/);
    await assert.rejects(setBlacklistDueDate(credentials, null, dueDate), /card ID/);
    t.mock.method(globalThis, 'fetch', async () => ({
        ok: true, json: async () => ({ due: '2026-11-16T06:59:00.000Z' })
    }));
    await assert.rejects(setBlacklistDueDate(credentials, 'card', dueDate), /did not retain/);
});

test('delayed verification corrects an automation override and stops once the saved date matches', async t => {
    const timers = require('node:timers/promises');
    let elapsed = 0;
    t.mock.method(timers, 'setTimeout', async delay => { elapsed += delay; });
    const dueDate = '2026-11-08T16:00:00.000Z';
    let savedDate = '2026-11-16T06:59:00.000Z';
    let reads = 0;
    let writes = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (options?.method === 'PUT') {
            writes++;
            savedDate = options.body.get('due');
        } else {
            reads++;
            assert.equal(new URL(url).searchParams.get('fields'), 'due');
        }
        return { ok: true, json: async () => ({ due: savedDate }) };
    });
    await verifyBlacklistDueDate({ key: 'test-key', token: 'test-token' }, 'card', dueDate);
    assert.equal(elapsed, 10000);
    assert.equal(reads, 2);
    assert.equal(writes, 1);
    assert.equal(savedDate, dueDate);
});

test('matching date on the first delayed lookup stops all further checks and writes', async t => {
    const timers = require('node:timers/promises');
    let waits = 0;
    let reads = 0;
    t.mock.method(timers, 'setTimeout', async delay => {
        assert.equal(delay, 5000);
        waits++;
    });
    const dueDate = '2026-11-08T16:00:00.000Z';
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(options, undefined, 'No update should be sent for an already matching date');
        reads++;
        return { ok: true, json: async () => ({ due: dueDate }) };
    });
    await verifyBlacklistDueDate({ key: 'test-key', token: 'test-token' }, 'card', dueDate);
    assert.equal(waits, 1);
    assert.equal(reads, 1);
});

test('persistent automation conflicts and verification API failures cannot report success', async t => {
    const timers = require('node:timers/promises');
    t.mock.method(timers, 'setTimeout', async () => {});
    const credentials = { key: 'test-key', token: 'test-token' };
    const dueDate = '2026-11-08T16:00:00.000Z';
    t.mock.method(globalThis, 'fetch', async (url, options) => ({
        ok: true,
        json: async () => ({ due: options?.method === 'PUT' ? dueDate : '2026-11-16T06:59:00.000Z' })
    }));
    await assert.rejects(verifyBlacklistDueDate(credentials, 'card', dueDate), /kept overriding/);
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
    await assert.rejects(verifyBlacklistDueDate(credentials, 'card', dueDate), /verification failed.*403/);
    await assert.rejects(verifyBlacklistDueDate(credentials, null, dueDate), /card ID/);
});
