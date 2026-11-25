const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { repostRecentVideo } = require('../lib/video-repost');
const { warnAboutOldVideos } = require('../lib/video-age');
const command = require('../commands/repoststatus');

const link = 'https://streamable.com/ohjj74';
const now = Date.parse('2026-11-24T22:00:00Z');
const DAY = 86400000;

function message() {
    return {
        id: 'test', guildId: 'guild', guild: { maximumUploadLimit: 100 * 1024 * 1024 },
        author: { id: 'reporter' }, createdTimestamp: now, content: link,
        channel: { isThread: () => true, parentId: '964450684613328916' },
        replies: [], reactions: [],
        async reply(payload) {
            if (payload.files) {
                this.file = await fs.readFile(payload.files[0].attachment);
                this.outputPath = payload.files[0].attachment;
            }
            this.replies.push(payload);
        },
        async react(emoji) { this.reactions.push(emoji); }
    };
}

function fakeDownload(t, body = Buffer.from('0000ftypisom'), afterWrite = () => {}) {
    t.mock.method(childProcess, 'spawn', (executable, args, options) => {
        assert.equal(options.shell, undefined);
        assert.ok(args.includes('--ignore-config'));
        assert.ok(args.includes('--no-playlist'));
        assert.deepEqual(args.slice(-2), ['--', link]);
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => { child.emit('close', 1); };
        const output = args[args.indexOf('--output') + 1];
        setImmediate(async () => {
            await fs.writeFile(output, body);
            afterWrite();
            child.emit('close', 0);
        });
        return child;
    });
}

test('recent evidence becomes an MP4 reply with source attribution and temporary files are removed', async t => {
    fakeDownload(t);
    const msg = message();
    await repostRecentVideo(msg, link, now - DAY);
    assert.equal(msg.replies.length, 1);
    assert.match(msg.replies[0].content, /Saved video evidence/);
    assert.ok(msg.replies[0].content.includes(link));
    assert.equal(msg.replies[0].files[0].name, 'evidence.mp4');
    assert.deepEqual(msg.replies[0].allowedMentions, { parse: [], repliedUser: false });
    await assert.rejects(fs.stat(path.dirname(msg.outputPath)), { code: 'ENOENT' });
});

test('old videos warn but do not repost, unknown dates do not repost, and disabled reposting does no work', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(childProcess, 'spawn', () => assert.fail('No downloads expected'));
    const msg = message();
    await repostRecentVideo(msg, link, now - DAY, () => false);
    assert.deepEqual(msg.replies, []);
    for (const date of [new Date(now - 6 * DAY).toISOString(), null]) {
        t.mock.method(globalThis, 'fetch', async () => new Response(
            `<link rel="canonical" href="${link}"><script type="application/ld+json">${
                JSON.stringify({ '@type': 'VideoObject', uploadDate: date })
            }</script>`
        ));
        await warnAboutOldVideos(msg, 'bot', repostRecentVideo);
    }
    assert.deepEqual(msg.reactions, ['⚠️']);
    assert.deepEqual(msg.replies, []);
});

test('oversized or invalid files report failure instead of uploading', async t => {
    t.mock.method(console, 'error', () => {});
    for (const [body, limit] of [[Buffer.from('0000ftypisom'), 5], [Buffer.from('not a video'), 100]]) {
        fakeDownload(t, body);
        const msg = message();
        msg.guild.maximumUploadLimit = limit;
        await repostRecentVideo(msg, link, now - DAY);
        assert.equal(msg.replies.length, 1);
        assert.equal(msg.file, undefined);
        assert.match(msg.replies[0].content, /Video was not saved/);
    }
});

test('disabling while a download finishes prevents the upload', async t => {
    let enabled = true;
    fakeDownload(t, Buffer.from('0000ftypisom'), () => { enabled = false; });
    const msg = message();
    await repostRecentVideo(msg, link, now - DAY, () => enabled);
    assert.deepEqual(msg.replies, []);
});

test('YouTube date-only responses are not eligible for reposting', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async () => new Response('<meta itemprop="uploadDate" content="2026-11-23">'));
    t.mock.method(childProcess, 'spawn', () => assert.fail('No download expected'));
    const msg = message();
    await repostRecentVideo(msg, 'https://www.youtube.com/watch?v=jNQXAC9IVRw', now - DAY);
    assert.equal(msg.file, undefined);
    assert.match(msg.replies[0].content, /Video was not saved/);
});

test('a missing downloader reports a failure without claiming the video was saved', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(childProcess, 'spawn', () => {
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => {
            child.emit('error', Object.assign(new Error('yt-dlp not found'), { code: 'ENOENT' }));
            child.emit('close', -2);
        });
        return child;
    });
    const msg = message();
    await repostRecentVideo(msg, link, now - DAY);
    assert.equal(msg.file, undefined);
    assert.match(msg.replies[0].content, /Video was not saved/);
});

test('multiple links independently repost recent videos and warn once for old videos', async t => {
    const msg = message();
    msg.content = `${link} https://streamable.com/older https://streamable.com/recent`;
    t.mock.method(globalThis, 'fetch', async url => new Response(
        `<link rel="canonical" href="${url}"><script type="application/ld+json">${
            JSON.stringify({ '@type': 'VideoObject', uploadDate: new Date(
                now - (url.endsWith('older') ? 6 : 1) * DAY
            ).toISOString() })
        }</script>`
    ));
    const reposts = [];
    await warnAboutOldVideos(msg, 'bot', async (_message, url) => reposts.push(url));
    assert.deepEqual(reposts, [link, 'https://streamable.com/recent']);
    assert.deepEqual(msg.reactions, ['⚠️']);
});

test('repoststatus is hardcoded-admin-only and preserves the setting on persistence failure', async t => {
    t.mock.method(console, 'error', () => {});
    const client = {
        hardcodedAdmins: new Set(['admin']), videoRepostEnabled: false,
        setVideoRepostEnabled(enabled) { this.videoRepostEnabled = enabled; }
    };
    async function run(action, userId = 'admin') {
        let payload;
        await command.executeInteraction({
            client, interaction: {
                user: { id: userId }, options: { getString: () => action },
                reply: async value => { payload = value; }
            }
        });
        return payload.content;
    }
    assert.match(await run('enable', 'outsider'), /Only hardcoded admins/);
    assert.equal(client.videoRepostEnabled, false);
    assert.match(await run('enable'), /\*\*enabled\*\*/);
    assert.match(await run('status'), /\*\*enabled\*\*/);
    client.setVideoRepostEnabled = () => { throw new Error('Disk unavailable'); };
    assert.match(await run('disable'), /previous setting remains/);
    assert.equal(client.videoRepostEnabled, true);
});
