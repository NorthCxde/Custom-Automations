const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const timers = require('node:timers/promises');
const { Collection } = require('discord.js');
const { repostVideo } = require('../lib/video-repost');
const { warnAboutOldVideos, extractVideoLinks } = require('../lib/video-age');
const command = require('../commands/fetch');

const link = 'https://streamable.com/ohjj74';
const now = Date.parse('2026-11-24T22:00:00Z');
const DAY = 86400000;
let messageId = 0;

function message() {
    return {
        id: `test-${++messageId}`, guildId: 'guild', guild: { id: 'guild', maximumUploadLimit: 100 * 1024 * 1024 },
        channelId: 'thread',
        author: { id: 'reporter' }, createdTimestamp: now, content: link,
        channel: { isThread: () => true, parentId: '964450684613328916' },
        replies: [], reactions: [], updates: [],
        async reply(payload) {
            const update = async value => {
                if (value.files) {
                    this.file = await fs.readFile(value.files[0].attachment);
                    this.outputPath = value.files[0].attachment;
                }
                this.updates.push(value);
            };
            await update(payload);
            const index = this.replies.length;
            this.replies.push(payload);
            return {
                edit: async value => {
                    await update(value);
                    this.replies[index] = value;
                }
            };
        },
        async react(emoji) { this.reactions.push(emoji); }
    };
}

function fakeDownload(t, body = Buffer.from('0000ftypisom'), expectedLink = link) {
    t.mock.method(childProcess, 'spawn', (executable, args, options) => {
        assert.equal(options.shell, undefined);
        assert.ok(args.includes('--ignore-config'));
        assert.ok(args.includes('--no-playlist'));
        assert.deepEqual(args.slice(-2), ['--', expectedLink]);
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => { child.emit('close', 1); };
        const output = args[args.indexOf('--output') + 1];
        setImmediate(async () => {
            await fs.writeFile(output, body);
            child.emit('close', 0);
        });
        return child;
    });
}

test('evidence becomes an MP4 reply with source attribution and temporary files are removed', async t => {
    fakeDownload(t);
    const msg = message();
    await repostVideo(msg, link);
    assert.equal(msg.replies.length, 1);
    assert.equal(msg.replies[0].content, `Saved video.\nSource: <${link}>`);
    assert.ok(msg.replies[0].content.includes(link));
    assert.equal(msg.replies[0].files[0].name, 'evidence.mp4');
    assert.deepEqual(msg.replies[0].allowedMentions, { parse: [], repliedUser: false });
    assert.equal(childProcess.spawn.mock.callCount(), 1);
    await assert.rejects(fs.stat(path.dirname(msg.outputPath)), { code: 'ENOENT' });
});

test('repeated processing of the same video in one message does not download or reply twice', async t => {
    fakeDownload(t);
    const msg = message();
    const first = repostVideo(msg, link);
    assert.equal(await repostVideo(msg, link), 'in_progress');
    await first;
    assert.equal(await repostVideo(msg, link), 'already_saved');
    assert.equal(msg.replies.length, 1);
    assert.equal(childProcess.spawn.mock.callCount(), 1);
    const differentMessage = message();
    await repostVideo(differentMessage, link);
    assert.equal(differentMessage.replies.length, 1);
    assert.equal(childProcess.spawn.mock.callCount(), 2);
});

test('TikTok text and embed links with different tracking parameters identify one clip', () => {
    const msg = message();
    const canonical = 'https://www.tiktok.com/@reporter/video/7710612324310125844';
    msg.content = `${canonical}?_r=1&_t=abc`;
    msg.embeds = [{ url: `${canonical}?is_from_webapp=1`, description: canonical }];
    assert.deepEqual(extractVideoLinks(msg), [canonical]);
});

for (const succeedsOn of [2, 3, null]) {
    test(`download retries ${succeedsOn ? `succeed on attempt ${succeedsOn}` : 'report failure only after three attempts'}`, async t => {
        t.mock.method(console, 'error', () => {});
        const msg = message();
        const directories = [];
        let attempts = 0;
        let pauses = 0;
        t.mock.method(timers, 'setTimeout', async delay => {
            pauses++;
            assert.equal(delay, 2000);
            assert.deepEqual(msg.replies, []);
            await assert.rejects(fs.stat(directories.at(-1)), { code: 'ENOENT' });
        });
        t.mock.method(childProcess, 'spawn', (_executable, args) => {
            attempts++;
            assert.deepEqual(msg.replies, []);
            const succeeds = attempts === succeedsOn;
            const output = args[args.indexOf('--output') + 1];
            directories.push(path.dirname(output));
            const child = new EventEmitter();
            child.stderr = new EventEmitter();
            child.kill = () => child.emit('close', 1);
            setImmediate(async () => {
                try {
                    await fs.writeFile(succeeds ? output : `${output}.part`, Buffer.from('0000ftypisom'));
                    if (!succeeds) child.stderr.emit('data', 'Unexpected response from webpage request');
                    child.emit('close', succeeds ? 0 : 1);
                } catch (error) {
                    child.emit('error', error);
                    child.emit('close', 1);
                }
            });
            return child;
        });
        await repostVideo(msg, link);
        assert.equal(attempts, succeedsOn || 3);
        assert.equal(pauses, attempts - 1);
        assert.equal(msg.replies.length, 1);
        assert.match(msg.replies[0].content, succeedsOn ? /Saved video\./ : /Video was not saved/);
        assert.equal(Boolean(msg.file), Boolean(succeedsOn));
        for (const directory of directories) {
            await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
        }
    });
}

test('automatic age warnings never download videos, including recent evidence', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(childProcess, 'spawn', () => assert.fail('No downloads expected'));
    const msg = message();
    for (const date of [new Date(now - DAY).toISOString(), new Date(now - 6 * DAY).toISOString(), null]) {
        t.mock.method(globalThis, 'fetch', async () => new Response(
            `<link rel="canonical" href="${link}"><script type="application/ld+json">${
                JSON.stringify({ '@type': 'VideoObject', uploadDate: date })
            }</script>`
        ));
        await warnAboutOldVideos(msg, 'bot');
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
        await repostVideo(msg, link);
        assert.equal(msg.replies.length, 1);
        assert.equal(msg.file, undefined);
        assert.match(msg.replies[0].content, /Video was not saved/);
    }
});

test('YouTube fetch does not require exact upload metadata', async t => {
    const youtubeLink = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
    fakeDownload(t, Buffer.from('0000ftypisom'), youtubeLink);
    t.mock.method(globalThis, 'fetch', () => assert.fail('Fetch must not request upload metadata'));
    const msg = message();
    await repostVideo(msg, youtubeLink);
    assert.ok(msg.file);
    assert.match(msg.replies[0].content, /Saved video\./);
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
    await repostVideo(msg, link);
    assert.equal(msg.file, undefined);
    assert.match(msg.replies[0].content, /Video was not saved/);
});

function fetchClient(allowedRoles = new Set(['mod'])) {
    return { hardcodedAdmins: new Set(['admin']), getAllowedRoleIds: () => allowedRoles };
}

function fetchMessage() {
    const msg = message();
    msg.content = '?fetch';
    msg.member = { roles: { cache: new Collection([['mod', { id: 'mod' }]]) } };
    return msg;
}

function slashInteraction(msg, input = link) {
    let response;
    return {
        id: msg.id, guild: msg.guild, member: msg.member, user: msg.author,
        channel: msg.channel, createdTimestamp: msg.createdTimestamp,
        options: { getString: () => input },
        reply: payload => msg.reply(payload),
        deferReply: async () => { msg.deferred = true; },
        editReply: async payload => {
            assert.equal(msg.deferred, true);
            if (!response) response = await msg.reply(payload);
            else await response.edit(payload);
            return response;
        }
    };
}

test('?fetch requires a reply and does not accept a link in the command instead', async t => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('No metadata requests expected'));
    const msg = fetchMessage();
    msg.content = `?fetch ${link}`;
    await command.execute({ client: fetchClient(), message: msg });
    assert.match(msg.replies[0].content, /Reply to the message/);
});

test('?fetch saves the referenced clip once and replies to its source rather than the command', async t => {
    fakeDownload(t);
    const source = message();
    source.embeds = [{ url: `${link}?tracking=1` }];
    const msg = fetchMessage();
    msg.reference = { messageId: source.id };
    msg.fetchReference = async () => source;
    await command.execute({ client: fetchClient(), message: msg });
    assert.equal(source.replies.length, 1);
    assert.match(source.replies[0].content, /Saved video\./);
    assert.equal(source.updates[0].content, 'Fetching... <a:Loading:1564411829290008737>');
    assert.equal(source.updates.length, 2);
    assert.deepEqual(msg.replies, []);
    await command.execute({ client: fetchClient(), message: msg });
    assert.equal(source.replies.length, 2);
    assert.match(source.replies[1].content, /already been saved/);
    assert.equal(childProcess.spawn.mock.callCount(), 1);
});

test('both fetch forms download without consulting upload dates, including old source messages', async t => {
    fakeDownload(t);
    t.mock.method(globalThis, 'fetch', () => assert.fail('Fetch must not request upload metadata'));
    const source = message();
    source.createdTimestamp = now - 365 * DAY;
    const msg = fetchMessage();
    msg.reference = { messageId: source.id };
    msg.fetchReference = async () => source;
    await command.execute({ client: fetchClient(), message: msg });
    assert.ok(source.file);
    assert.match(source.replies[0].content, /Saved video\./);
    const slash = fetchMessage();
    await command.executeInteraction({ client: fetchClient(), interaction: slashInteraction(slash) });
    assert.ok(slash.file);
    assert.equal(childProcess.spawn.mock.callCount(), 2);
});

test('both fetch forms enforce selected /perms roles, allow bot admins and reject other channels', async t => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('No metadata requests expected'));
    for (const variant of ['prefix', 'slash']) {
        for (const allowedRoles of [null, new Set(), new Set(['different-role'])]) {
            const msg = fetchMessage();
            const client = fetchClient(allowedRoles);
            if (variant === 'prefix') await command.execute({ client, message: msg });
            else await command.executeInteraction({ client, interaction: slashInteraction(msg) });
            assert.match(msg.replies[0].content, /roles allowed through \/perms/);
        }
        const admin = fetchMessage();
        admin.author.id = 'admin';
        admin.channel.parentId = 'other-channel';
        const client = fetchClient(null);
        if (variant === 'prefix') await command.execute({ client, message: admin });
        else await command.executeInteraction({ client, interaction: slashInteraction(admin) });
        assert.match(admin.replies[0].content, /exploiter-report thread/);
        const allowed = fetchMessage();
        allowed.channel.isThread = () => false;
        if (variant === 'prefix') await command.execute({ client: fetchClient(), message: allowed });
        else await command.executeInteraction({ client: fetchClient(), interaction: slashInteraction(allowed) });
        assert.match(allowed.replies[0].content, /exploiter-report thread/);
    }
});

test('/fetch requires a supported link and defers before downloading a public attachment', async t => {
    fakeDownload(t);
    for (const input of ['not a link', 'https://example.com/video']) {
        const msg = fetchMessage();
        await command.executeInteraction({ client: fetchClient(), interaction: slashInteraction(msg, input) });
        assert.match(msg.replies[0].content, /Enter one supported/);
        assert.equal(msg.deferred, undefined);
    }
    const msg = fetchMessage();
    await command.executeInteraction({ client: fetchClient(), interaction: slashInteraction(msg) });
    assert.equal(msg.deferred, true);
    assert.equal(msg.replies.length, 1);
    assert.ok(msg.file);
    assert.equal(msg.updates[0].content, 'Fetching... <a:Loading:1564411829290008737>');
    assert.match(msg.updates[1].content, /Saved video\./);
});

test('both fetch forms keep one loading message through retries and replace it on success or final failure', async t => {
    t.mock.method(console, 'error', () => {});
    for (const variant of ['prefix', 'slash']) {
        for (const succeeds of [true, false]) {
            const msg = fetchMessage();
            const source = message();
            msg.reference = { messageId: source.id };
            msg.fetchReference = async () => source;
            const output = variant === 'prefix' ? source : msg;
            let attempts = 0;
            t.mock.method(timers, 'setTimeout', async () => {
                assert.equal(output.replies.length, 1);
                assert.equal(output.replies[0].content, 'Fetching... <a:Loading:1564411829290008737>');
            });
            t.mock.method(childProcess, 'spawn', (_executable, args) => {
                attempts++;
                const child = new EventEmitter();
                child.stderr = new EventEmitter();
                child.kill = () => child.emit('close', 1);
                setImmediate(async () => {
                    try {
                        if (succeeds && attempts === 3) {
                            await fs.writeFile(args[args.indexOf('--output') + 1], Buffer.from('0000ftypisom'));
                            child.emit('close', 0);
                        } else {
                            child.emit('close', 1);
                        }
                    } catch (error) {
                        child.emit('error', error);
                        child.emit('close', 1);
                    }
                });
                return child;
            });
            if (variant === 'prefix') await command.execute({ client: fetchClient(), message: msg });
            else await command.executeInteraction({ client: fetchClient(), interaction: slashInteraction(msg) });
            assert.equal(attempts, 3);
            assert.equal(output.replies.length, 1);
            assert.equal(output.updates.length, 2);
            assert.match(output.replies[0].content, succeeds ? /Saved video\./ : /Video was not saved/);
            assert.equal(Boolean(output.file), succeeds);
        }
    }
});

test('?fetch reports an unreadable reference or a message without supported links', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', () => assert.fail('No metadata requests expected'));
    const msg = fetchMessage();
    msg.reference = { messageId: 'missing' };
    msg.fetchReference = async () => { throw new Error('Unknown Message'); };
    await command.execute({ client: fetchClient(), message: msg });
    assert.match(msg.replies[0].content, /Could not read/);
    msg.fetchReference = async () => ({ content: 'no video', channelId: msg.channelId });
    await command.execute({ client: fetchClient(), message: msg });
    assert.match(msg.replies[1].content, /no supported/);
});
