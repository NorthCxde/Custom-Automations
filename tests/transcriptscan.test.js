const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MessageFlags } = require('discord.js');
const command = require('../commands/transcriptscan');

const userId = index => String(100000000000000000n + BigInt(index));
const transcript = (opener, other = userId(99)) => ({
    title: 'Ticket Closed',
    fields: [
        { name: '✅ Opened By', value: `<@${opener}>` },
        { name: '🔒 Closed By', value: `<@${other}>` },
        { name: 'Claimed By', value: `<@${other}>` }
    ]
});

function channelFor(messages) {
    const calls = [];
    return {
        guildId: 'guild', isTextBased: () => true, calls,
        messages: {
            fetch: async ({ limit, before }) => {
                calls.push({ limit, before });
                const filtered = messages.filter(message => !before || BigInt(message.id) < BigInt(before));
                return new Map(filtered.slice(0, limit).map(message => [message.id, message]));
            }
        }
    };
}

function history(count, numberOfUsers = 20) {
    return Array.from({ length: count }, (_, index) => ({
        id: String(1000000 - index),
        embeds: [transcript(userId(index % numberOfUsers))]
    }));
}

function interaction(count = 1000, list = 15) {
    const replies = [];
    const collector = new EventEmitter();
    collector.stop = reason => collector.emit('end', [], reason);
    return {
        id: 'interaction', guild: { id: 'guild' }, guildId: 'guild', member: {}, user: { id: 'caller' },
        options: { getInteger: name => name === 'count' ? count : list },
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

test('slash command requires count and list with requested bounds', () => {
    const json = command.data.toJSON();
    assert.equal(json.name, 'transcriptscan');
    assert.deepEqual(json.options.map(({ name, required, min_value, max_value }) =>
        [name, required, min_value, max_value]), [
        ['count', true, 1, 10000], ['list', true, 1, 100]
    ]);
});

test('only Opened By mentions count, including moderators and excluding unrelated mentions', async () => {
    const messages = [
        { id: '9', embeds: [transcript(userId(1), userId(2))] },
        { id: '8', embeds: [{ title: 'Ticket Closed', fields: [{ name: '✅ Opened By', value: `<@!${userId(1)}>` }] }] },
        { id: '7', embeds: [transcript(userId(3), userId(2))] },
        { id: '6', embeds: [{ title: 'Ticket Closed', fields: [{ name: 'Opened By', value: `<@${userId(2)}> <@${userId(3)}>` }] }] },
        { id: '5', embeds: [{ title: 'Exploiter Report Closed', fields: [{ name: 'Closed By', value: `<@${userId(2)}>` }] }] },
        { id: '4', embeds: [] }
    ];
    const result = await command.scanTranscripts(channelFor(messages), 1000);
    assert.equal(result.scanned, 4);
    assert.equal(result.unrecognized, 1);
    assert.deepEqual(result.rankings, [
        { userId: userId(1), count: 2 }, { userId: userId(3), count: 1 }
    ]);
});

test('scan 1000 embeds and show only top 15 with no user pings', async () => {
    const channel = channelFor(history(1200));
    const request = interaction();
    const client = { isMemberAllowed: () => true, channels: { fetch: async () => channel } };
    await command.executeInteraction({ client, interaction: request });
    assert.deepEqual(request.replies[0], { flags: MessageFlags.Ephemeral });
    const payload = request.replies[1];
    assert.equal(payload.embeds[0].toJSON().description.split('\n').length, 15);
    assert.match(payload.embeds[0].toJSON().description, /50\*\* ticket/);
    assert.match(payload.embeds[0].toJSON().footer.text, /Scanned 1000 transcript/);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    assert.equal(channel.calls.length, 10);
});

test('scan supports exactly 10000 transcripts, with non-transcripts excluded from count', async () => {
    const messages = history(10020);
    messages.splice(5, 0, { id: '999995', embeds: [{ title: 'Other' }] });
    // Keep distinct descending snowflake IDs so pagination is representative of Discord.
    messages.forEach((message, index) => { message.id = String(2000000 - index); });
    const channel = channelFor(messages);
    const result = await command.scanTranscripts(channel, 10000);
    assert.equal(result.scanned, 10000);
    assert.equal(result.rankings.reduce((sum, item) => sum + item.count, 0), 10000);
    assert.equal(channel.calls.length, 101);
});

test('leaderboard paginates top 100 and only requester can change page', async () => {
    const request = interaction(100, 100);
    const client = { isMemberAllowed: () => true, channels: { fetch: async () => channelFor(history(100, 100)) } };
    await command.executeInteraction({ client, interaction: request });
    assert.equal(request.collectorOptions.time, 300000);
    assert.equal(request.collectorOptions.filter({ user: { id: 'other' }, customId: 'transcriptscan_next:interaction' }), false);
    assert.equal(request.collectorOptions.filter({ user: request.user, customId: 'transcriptscan_next:interaction' }), true);
    let updated;
    await request.collector.listeners('collect')[0]({
        customId: 'transcriptscan_next:interaction',
        update: async payload => { updated = payload; }
    });
    assert.match(updated.embeds[0].toJSON().footer.text, /Page 2\/4/);
    assert.match(updated.embeds[0].toJSON().description, /^26\./);
    await request.collector.listeners('end')[0]();
    assert.deepEqual(request.replies[request.replies.length - 1], { components: [] });
});

test('permissions, channel and fetch failures are reported without successful partial results', async t => {
    const denied = interaction();
    await command.executeInteraction({ client: { isMemberAllowed: () => false }, interaction: denied });
    assert.match(denied.replies[0].content, /permission/);
    const invalid = interaction(10001, 1);
    await command.executeInteraction({ client: { isMemberAllowed: () => true }, interaction: invalid });
    assert.match(invalid.replies[0].content, /Count must/);
    const request = interaction();
    t.mock.method(console, 'error', () => {});
    const channel = channelFor(history(101));
    const fetch = channel.messages.fetch;
    channel.messages.fetch = async options => {
        if (options.before) throw new Error('Missing Read Message History');
        return fetch(options);
    };
    await command.executeInteraction({
        client: { isMemberAllowed: () => true, channels: { fetch: async () => channel } },
        interaction: request
    });
    assert.match(request.replies[1], /Could not scan transcripts/);
    const wrongGuild = interaction();
    channel.guildId = 'different-guild';
    await command.executeInteraction({
        client: { isMemberAllowed: () => true, channels: { fetch: async () => channel } },
        interaction: wrongGuild
    });
    assert.match(wrongGuild.replies[1], /Could not scan transcripts/);
});

test('a repeated history page is rejected rather than returning a partial leaderboard', async () => {
    const messages = channelFor(history(100));
    const page = await messages.messages.fetch({ limit: 100 });
    messages.messages.fetch = async () => page;
    await assert.rejects(command.scanTranscripts(messages, 1000), /pagination did not advance/);
});
