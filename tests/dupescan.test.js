const test = require('node:test');
const assert = require('node:assert/strict');
const command = require('../commands/dupescan');

function createInteraction() {
    const calls = [];
    return {
        calls,
        deferReply: async options => calls.push(['defer', options]),
        editReply: async content => calls.push(['edit', content])
    };
}

test('/dupescan immediately runs a forced reconciliation and summarizes results', async () => {
    const interaction = createInteraction();
    const client = {
        reconcileOpenReportTickets: async options => {
            assert.deepEqual(options, { force: true });
            return {
                scannedTicketCount: 4,
                duplicateNoticeCount: 2,
                closedTicketCount: 1,
                cancelledTicketCount: 1
            };
        }
    };
    await command.executeInteraction({ client, interaction });

    assert.deepEqual(interaction.calls, [
        ['defer', { ephemeral: true }],
        ['edit', 'Duplicate scan completed across **4** open exploit-report ticket(s). Started **2** duplicate close countdown(s); **1** ticket(s) closed, and **1** countdown(s) cancelled.']
    ]);
});

test('/dupescan reports an already-running reconciliation without starting another', async () => {
    const interaction = createInteraction();
    const client = {
        reconcileOpenReportTickets: async () => ({ busy: true })
    };
    await command.executeInteraction({ client, interaction });

    assert.equal(interaction.calls[1][1], 'A duplicate-report scan is already running. Please wait for it to finish.');
});
