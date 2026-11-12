const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../commands/stats');
const quota = require('../commands/quota');
const { buildSummaryEmbed } = require('../commands/summary');

const guildId = 'guild';
const moderatorId = '123456789012345678';
const otherId = '223456789012345678';
const traineeId = '323456789012345678';

function fixture(counts) {
    const { year, month } = stats.getMonthRange();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const overrides = new Map(Object.entries(counts));
    const logs = [];
    return {
        manualModerators: new Set(Object.keys(counts)),
        whitelistedModeratorIds: new Set(),
        removedModerators: new Set(),
        statsOverrides: new Map([[guildId, new Map([[monthKey, overrides]])]]),
        getModLogs: () => logs,
        logs
    };
}

async function quotaDescription(client, id = moderatorId) {
    let response;
    await quota.executeInteraction({
        client,
        interaction: {
            guild: { id: guildId }, user: { id },
            reply: async payload => { response = payload; }
        }
    });
    return response.embeds[0].toJSON().description;
}

test('six percent passes consistently across stats, quota and summary without changing saved progress', async () => {
    const client = fixture({ [moderatorId]: 6, [otherId]: 88, [traineeId]: 6 });
    const guild = { id: guildId, members: { fetch: async () => null } };
    const before = [...client.statsOverrides.get(guildId).values()][0];
    const savedCounts = [...before.entries()];

    assert.equal(stats.QUOTA_PERCENT, 6);
    const statsEmbed = (await stats.buildStatsEmbed(client, guild, client.logs)).toJSON();
    assert.match(statsEmbed.description, new RegExp(`✅ <@${moderatorId}> — 6 bans \\(6\\.0%\\)`));
    const description = await quotaDescription(client);
    assert.match(description, /quota: 6%/);
    assert.match(description, /✅ Above quota \(6\.0%\)/);
    const summary = buildSummaryEmbed(client, guild, false, [traineeId]).toJSON();
    assert.match(summary.description, new RegExp(`<@${moderatorId}> ✅`));
    assert.match(summary.fields[0].value, new RegExp(`<@${traineeId}> ✅`));
    assert.deepEqual([...before.entries()], savedCounts);
    assert.deepEqual(client.logs, []);
});

test('quota reports required additional bans including growth in the total', async () => {
    for (const [own, other, expected] of [[5, 95, 2], [0, 0, 1], [6, 94, 0]]) {
        const client = fixture({ [moderatorId]: own, [otherId]: other });
        const description = await quotaDescription(client);
        if (expected) {
            assert.match(description, new RegExp(`need ${expected} more ban\\(s\\) to reach 6%`));
        } else {
            assert.match(description, /✅ Above quota/);
        }
    }
});

test('below six percent remains below quota in stats and summary', async () => {
    const client = fixture({ [moderatorId]: 5, [otherId]: 95 });
    const guild = { id: guildId, members: { fetch: async () => null } };
    assert.match((await stats.buildStatsEmbed(client, guild, client.logs)).toJSON().description,
        new RegExp(`⚠️ <@${moderatorId}>`));
    assert.match(buildSummaryEmbed(client, guild).toJSON().description,
        new RegExp(`<@${moderatorId}> ⚠️`));
    assert.match(await quotaDescription(client), /⚠️ Below quota \(5\.0%\)/);
});
