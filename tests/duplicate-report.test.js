const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageType } = require('discord.js');
const {
    REPORTED_MESSAGE, findTicketOpenerId, findBlacklistCard, notifyAndCloseDuplicate
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

test('duplicate notice is sent in thread and lock/archive wait 30 seconds after DM attempt', async () => {
    const events = [];
    const opener = {
        id: 'reporter',
        send: async content => { events.push(['dm', content]); }
    };
    const thread = {
        id: 'ticket',
        send: async payload => { events.push(['thread', payload]); },
        setLocked: async (locked, reason) => { events.push(['locked', locked, reason]); },
        setArchived: async (archived, reason) => { events.push(['archived', archived, reason]); }
    };
    const result = await notifyAndCloseDuplicate({
        thread, opener, delay: async ms => { events.push(['delay', ms]); }
    });
    assert.equal(result.dmSent, true);
    assert.equal(result.closed, true);
    assert.deepEqual(events.map(event => event[0]), ['dm', 'thread', 'delay', 'locked', 'archived']);
    assert.equal(events[0][1], REPORTED_MESSAGE);
    assert.match(events[1][1].content, new RegExp(REPORTED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(events[1][1].content, /Ticket closing in 30 seconds/);
    assert.deepEqual(events[1][1].allowedMentions, { users: ['reporter'] });
    assert.equal(events[2][1], 30000);
    assert.equal(events[3][1], true);
    assert.equal(events[4][1], true);
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
        send: async () => { events.push('thread'); },
        setLocked: async () => { events.push('locked'); },
        setArchived: async () => { events.push('archived'); }
    };
    const result = await notifyAndCloseDuplicate({
        thread, opener, delay: async ms => { assert.equal(ms, 30000); events.push('delay'); }
    });
    assert.equal(result.dmSent, false);
    assert.deepEqual(events, ['dm', 'thread', 'delay', 'locked', 'archived']);
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
        thread, opener, delay: async () => { events.push('delay'); }
    }), /Missing Send Messages/);
    assert.deepEqual(events, ['dm']);
});
