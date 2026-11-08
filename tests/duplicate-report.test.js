const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MessageType, ButtonStyle } = require('discord.js');
const {
    REPORTED_MESSAGE, findTicketOpenerId, findBlacklistCard,
    shouldAutoCloseDuplicate, notifyAndCloseDuplicate, waitForCloseDecision, CLOSE_DELAY_MS
} = require('../lib/duplicate-report');

const REPORTS_BOT = '1325579039888511056';

function addMessage(id, { authorId = REPORTS_BOT, type = MessageType.RecipientAdd, mentions = [] } = {}) {
    return {
        id,
        type,
        author: { id: authorId },
        createdTimestamp: Number(id),
        mentions: { users: { find: predicate => mentions.find(predicate) || null } }
    };
}

test('opener is the first non-bot member added by Reports', () => {
    const messages = new Map([
        ['30', addMessage('30', { mentions: [{ id: 'later-reporter' }] })],
        ['20', addMessage('20', { authorId: 'other-bot', mentions: [{ id: 'ignored-bot-user' }] })],
        ['10', addMessage('10', { mentions: [{ id: REPORTS_BOT }, { id: 'ticket-opener' }] })],
        ['5', addMessage('5', { type: MessageType.Default, mentions: [{ id: 'not-a-system-message' }] })]
    ]);
    assert.equal(findTicketOpenerId(messages, REPORTS_BOT), 'ticket-opener');
    assert.equal(findTicketOpenerId(new Map([['1', addMessage('1', {
        type: MessageType.ThreadCreated, mentions: [{ id: 'not-an-add-message' }]
    })]]), REPORTS_BOT), null);
});

test('either active Trello blacklist list identifies a duplicate card case-insensitively', () => {
    assert.equal(findBlacklistCard([
        { listName: 'Archived' },
        { listName: ' tb duels blacklist ', url: 'https://trello.example/card' }
    ]).listName, ' tb duels blacklist ');
    assert.equal(findBlacklistCard([{ listName: 'Other' }]), null);
});

test('automatic duplicate closure is restricted to one detected user in automatic tickets', () => {
    const base = { isAutomaticTicket: true, interaction: null, openerId: 'reporter', detectedUserCount: 1 };
    assert.equal(shouldAutoCloseDuplicate(base), true);
    assert.equal(shouldAutoCloseDuplicate({ ...base, detectedUserCount: 2 }), false);
    assert.equal(shouldAutoCloseDuplicate({ ...base, detectedUserCount: 0 }), false);
    assert.equal(shouldAutoCloseDuplicate({ ...base, isAutomaticTicket: false }), false);
    assert.equal(shouldAutoCloseDuplicate({ ...base, interaction: {} }), false);
    assert.equal(shouldAutoCloseDuplicate({ ...base, openerId: null }), false);
});

test('duplicate notice has a red Dont Close button that is available only during the countdown', async () => {
    const events = [];
    const opener = {
        id: 'reporter',
        send: async content => { events.push(['dm', content]); }
    };
    const thread = {
        id: 'ticket',
        send: async payload => {
            events.push(['thread', payload]);
            return { id: 'notice', payload, edit: async update => { events.push(['expired', update]); }, createMessageComponentCollector: options => {
                assert.equal(options.time, CLOSE_DELAY_MS);
                assert.equal(options.filter({ customId: 'duplicate_report_keep_open:ticket' }), true);
                assert.equal(options.filter({ customId: 'other' }), false);
                events.push(['collector', options.time]);
                return { on: (event, listener) => { if (event === 'end') listener([], 'time'); } };
            } };
        },
        setLocked: async (locked, reason) => { events.push(['locked', locked, reason]); },
        setArchived: async (archived, reason) => { events.push(['archived', archived, reason]); }
    };
    const result = await notifyAndCloseDuplicate({ thread, opener });
    assert.equal(result.dmSent, true);
    assert.equal(result.closed, true);
    assert.deepEqual(events.map(event => event[0]), ['dm', 'thread', 'collector', 'expired', 'locked', 'archived']);
    assert.equal(events[0][1], REPORTED_MESSAGE);
    assert.match(events[1][1].content, new RegExp(REPORTED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(events[1][1].content, /Ticket closing <t:\d+:R>/);
    const closeTimestamp = Number(events[1][1].content.match(/Ticket closing <t:(\d+):R>/)[1]);
    assert.ok(closeTimestamp >= Math.floor(Date.now() / 1000) + 29);
    assert.ok(closeTimestamp <= Math.floor(Date.now() / 1000) + 30);
    assert.deepEqual(events[1][1].allowedMentions, { users: ['reporter'] });
    const button = events[1][1].components[0].toJSON().components[0];
    assert.equal(button.label, "Don't Close");
    assert.equal(button.style, ButtonStyle.Danger);
    assert.deepEqual(events[3][1], { components: [] });
    assert.equal(events[4][1], true);
    assert.equal(events[5][1], true);
});

test('pressing Dont Close removes the button and leaves the ticket open', async () => {
    const events = [];
    const opener = { id: 'reporter', send: async () => { events.push('dm'); } };
    const thread = {
        id: 'ticket',
        send: async payload => {
            events.push('thread');
            return { id: 'notice', content: payload.content };
        },
        setLocked: async () => { events.push('locked'); },
        setArchived: async () => { events.push('archived'); }
    };
    const result = await notifyAndCloseDuplicate({
        thread,
        opener,
        waitForDecision: async (notice, customId) => {
            assert.equal(notice.id, 'notice');
            assert.equal(customId, 'duplicate_report_keep_open:ticket');
            events.push('cancelled');
            return true;
        }
    });
    assert.equal(result.closed, false);
    assert.equal(result.cancelled, true);
    assert.deepEqual(events, ['dm', 'thread', 'cancelled']);
});

test('button click acknowledges, stops collector, and timeout removes button', async () => {
    const collector = new EventEmitter();
    let stopReason;
    collector.stop = reason => {
        stopReason = reason;
        collector.emit('end', [], reason);
    };
    const edits = [];
    const message = {
        content: 'closing soon',
        createMessageComponentCollector: options => {
            assert.equal(options.time, CLOSE_DELAY_MS);
            assert.equal(options.filter({ customId: 'keep' }), true);
            assert.equal(options.filter({ customId: 'wrong' }), false);
            return collector;
        },
        edit: async payload => { edits.push(payload); }
    };
    const decision = waitForCloseDecision(message, 'keep');
    let updatePayload;
    collector.emit('collect', {
        customId: 'keep',
        message,
        update: async payload => { updatePayload = payload; },
        followUp: async () => {}
    });
    assert.equal(await decision, true);
    assert.equal(stopReason, 'cancelled');
    assert.deepEqual(updatePayload.components, []);
    assert.match(updatePayload.content, /Automatic closure cancelled/);
    assert.deepEqual(edits, []);

    const timedCollector = new EventEmitter();
    timedCollector.stop = reason => timedCollector.emit('end', [], reason);
    const timeoutEdits = [];
    const timeoutMessage = {
        createMessageComponentCollector: () => timedCollector,
        edit: async payload => { timeoutEdits.push(payload); }
    };
    const expired = waitForCloseDecision(timeoutMessage, 'keep');
    timedCollector.emit('end', [], 'time');
    assert.equal(await expired, false);
    assert.deepEqual(timeoutEdits, [{ components: [] }]);
});

test('if DM fails, the thread notice still goes out before ticket closes', async t => {
    const events = [];
    t.mock.method(console, 'error', () => {});
    const opener = {
        id: 'reporter',
        send: async () => { events.push('dm'); throw new Error('DMs disabled'); }
    };
    const thread = {
        id: 'ticket',
        send: async () => {
            events.push('thread');
            return { createMessageComponentCollector: options => {
                assert.equal(options.time, CLOSE_DELAY_MS);
                return { on: (event, listener) => { if (event === 'end') listener([], 'time'); } };
            } };
        },
        setLocked: async () => { events.push('locked'); },
        setArchived: async () => { events.push('archived'); }
    };
    const result = await notifyAndCloseDuplicate({ thread, opener });
    assert.equal(result.dmSent, false);
    assert.deepEqual(events, ['dm', 'thread', 'locked', 'archived']);
});

test('if thread notification fails, the ticket remains open', async () => {
    const events = [];
    const opener = { id: 'reporter', send: async () => { events.push('dm'); } };
    const thread = {
        id: 'ticket',
        send: async () => { throw new Error('Missing Send Messages permission'); },
        setLocked: async () => { events.push('locked'); },
        setArchived: async () => { events.push('archived'); }
    };
    await assert.rejects(notifyAndCloseDuplicate({
        thread, opener
    }), /Missing Send Messages/);
    assert.deepEqual(events, ['dm']);
});
