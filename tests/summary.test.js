const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSummaryEmbed, getSummaryDate, data, executeInteraction } = require('../commands/summary');
const { getMonthRange } = require('../commands/stats');
const { getDiscordModstatsCounts, getDiscordModstatsCountsInRange } = require('../commands/modstats');

const guild = { id: 'guild' };
const moderatorId = '123456789012345678';
const traineeId = '223456789012345678';

function entry(action, timestamp, moderator = moderatorId, extra = {}) {
    return { action, timestamp, moderatorId: moderator, ...extra };
}

function fixture(logs = []) {
    return {
        modLogs: new Map([[guild.id, logs]]),
        getModLogs: () => logs,
        manualModerators: new Set([moderatorId, traineeId]),
        whitelistedModeratorIds: new Set(),
        removedModerators: new Set(),
        statsOverrides: new Map(),
        modStatsOverrides: new Map()
    };
}

test('month selection defaults to current and handles Eastern month and year boundaries', () => {
    const now = new Date('2026-11-01T15:00:00Z');
    assert.equal(getSummaryDate(undefined, now), now);
    assert.equal(getSummaryDate('current', now), now);
    assert.equal(getSummaryDate('last', now).toISOString(), '2026-10-15T12:00:00.000Z');
    assert.equal(getSummaryDate('last', new Date('2027-01-01T15:00:00Z')).toISOString(),
        '2026-12-15T12:00:00.000Z');
    assert.equal(getSummaryDate('last', new Date('2026-11-01T03:59:59Z')).toISOString(),
        '2026-09-15T12:00:00.000Z');
    assert.throws(() => getSummaryDate('invalid'), /Invalid summary month/);
});

test('October summary uses October bans and compares September, preserving saved history', () => {
    const logs = [
        entry('Ban', '2026-09-20T12:00:00Z', moderatorId, { source: 'trello_blacklist', userId: 'one', blacklistType: 'game' }),
        entry('Ban', '2026-10-20T12:00:00Z', moderatorId, { source: 'trello_blacklist', userId: 'two', blacklistType: 'game' }),
        entry('Ban', '2026-10-21T12:00:00Z', moderatorId, { source: 'trello_blacklist', userId: 'three', blacklistType: 'game' }),
        entry('Ban', '2026-11-01T12:00:00Z', moderatorId, { source: 'trello_blacklist', userId: 'four', blacklistType: 'game' })
    ];
    const client = fixture(logs);
    client.statsOverrides.set(guild.id, new Map([['2026-10', new Map([[moderatorId, 1]])]]));
    const original = JSON.stringify(logs);
    const selected = getSummaryDate('last', new Date('2026-11-01T15:00:00Z'));
    const embed = buildSummaryEmbed(client, guild, false, [], true, selected).toJSON();
    assert.match(embed.description, /## October/);
    assert.match(embed.description, /Total Bans:\*\* \*\*3\*\*/);
    assert.match(embed.description, /\+200\.0% Last month/);
    assert.match(embed.description, /\*\*3\*\* Roblox Bans/);
    assert.equal(JSON.stringify(logs), original);
    const november = buildSummaryEmbed(client, guild, false, [], false,
        getSummaryDate('current', new Date('2026-11-01T15:00:00Z'))).toJSON();
    assert.match(november.description, /## November/);
    assert.match(november.description, /Total Bans:\*\* \*\*1\*\*/);
});

test('Discord calendar stats use inclusive start, exclusive end, and ignore rolling overrides', () => {
    const date = new Date('2026-10-15T12:00:00Z');
    const range = getMonthRange(date);
    assert.equal(new Date(range.start).toISOString(), '2026-10-01T04:00:00.000Z');
    assert.equal(new Date(range.end).toISOString(), '2026-11-01T04:00:00.000Z');
    const logs = [
        entry('Mute', new Date(range.start - 1).toISOString()),
        entry('Mute', new Date(range.start).toISOString()),
        entry('Ban', new Date(range.end - 1).toISOString()),
        entry('Temp Ban', new Date(range.start + 1000).toISOString()),
        entry('Ban', new Date(range.end).toISOString()),
        entry('Ban', '2026-10-20T00:00:00Z', moderatorId, { source: 'trello_blacklist' }),
        entry('Mute', 'invalid'),
        entry('Mute', '2026-10-20T00:00:00Z', traineeId)
    ];
    const client = fixture(logs);
    client.modStatsOverrides.set(guild.id, new Map([[moderatorId, { '30d': { mutes: 999, bans: 888 } }]]));
    assert.deepEqual(getDiscordModstatsCountsInRange(client, guild.id, moderatorId, range),
        { mutes: 1, bans: 2, kicks: 0, warns: 0 });
    assert.equal(getDiscordModstatsCounts(client, guild.id, moderatorId, '30d').mutes, 999,
        'Existing modstats override behavior stays unchanged');
    const embed = buildSummaryEmbed(client, guild, true, [traineeId], false, date, true).toJSON();
    assert.equal(embed.title, 'Mid-Month Moderator Summary');
    assert.match(embed.description, /\*\*1\*\* Mutes \| \*\*2\*\* Discord Bans/);
    assert.match(embed.fields[0].value, /\*\*1\*\* Mutes \| \*\*0\*\* Discord Bans/);
    assert.match(embed.footer.text, /calendar-month logs/);
    const novemberRange = getMonthRange(new Date('2026-11-15T12:00:00Z'));
    assert.equal(novemberRange.end - novemberRange.start, (30 * 24 + 1) * 3600000,
        'Eastern DST month has the additional hour');
});

test('optional month choices are registered and execution preserves visibility and defaults', async () => {
    const option = data.toJSON().options.find(option => option.name === 'month');
    assert.equal(option.required, false);
    assert.deepEqual(option.choices.map(({ name, value }) => ({ name, value })), [
        { name: 'Current month', value: 'current' }, { name: 'Last month', value: 'last' }
    ]);
    for (const selection of [null, 'current', 'last']) {
        let deferred;
        let response;
        await executeInteraction({
            client: fixture(),
            interaction: {
                guild,
                options: {
                    getString: name => ({ visibility: 'ephemeral', trainee: 'no', month: selection })[name] || null,
                    getBoolean: () => false
                },
                deferReply: async options => { deferred = options; },
                editReply: async payload => { response = payload; }
            }
        });
        assert.deepEqual(deferred, { ephemeral: true });
        const expected = getSummaryDate(selection || 'current').toLocaleDateString('en-US',
            { month: 'long', timeZone: 'America/New_York' });
        assert.ok(response.embeds[0].toJSON().description.includes(`## ${expected}`));
    }
});
