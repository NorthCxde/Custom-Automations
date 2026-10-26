const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const fs = require('fs');
const { Readable } = require('stream');
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const sharp = require('sharp');

const GENERATING = 'Generating... <a:Loading:1564411829290008737>';

async function setup(t, replies, invalid = false) {
    const input = invalid ? Buffer.from('not an image') : await sharp({
        create: { width: 20, height: 20, channels: 3, background: '#ff0000' }
    }).png().toBuffer();
    const gif = invalid ? null : await sharp(input).gif().toBuffer();
    t.mock.method(https, 'get', (url, callback) => {
        assert.equal(replies[0].content, GENERATING, 'Loading message must precede downloading');
        const request = new EventEmitter();
        process.nextTick(() => callback(Readable.from([input])));
        return request;
    });
    t.mock.method(childProcess, 'spawn', (binary, args) => {
        const process = new EventEmitter();
        process.stderr = new EventEmitter();
        queueMicrotask(() => {
            fs.writeFileSync(args.at(-1), gif);
            process.emit('close', 0);
        });
        return process;
    });
    delete require.cache[require.resolve('../commands/gif')];
    t.after(() => { delete require.cache[require.resolve('../commands/gif')]; });
    return require('../commands/gif');
}

async function readFileReply(payload, replies) {
    if (payload.files) {
        const file = payload.files[0];
        assert.equal((await sharp(file.attachment).metadata()).format, 'gif');
    }
    replies.push(payload);
}

test('slash image/video loading is replaced by GIF while preserving ephemeral and spoiler options', async t => {
    for (const video of [false, true]) {
        const replies = [];
        const command = await setup(t, replies);
        let deferred;
        await command.executeInteraction({
            interaction: {
                options: {
                    getAttachment: name => name === (video ? 'video' : 'image')
                        ? { url: 'https://cdn.discordapp.com/input' } : null,
                    getString: () => null,
                    getBoolean: () => true
                },
                deferReply: async options => { deferred = options; },
                editReply: payload => readFileReply(payload, replies)
            }
        });
        assert.deepEqual(deferred, { ephemeral: true });
        assert.equal(replies.length, 2);
        assert.equal(replies[1].content, '');
        assert.equal(replies[1].files[0].name, 'SPOILER_converted.gif');
    }
});

test('prefix image/video conversions edit the loading reply instead of sending a second message', async t => {
    for (const video of [false, true]) {
        const replies = [];
        const command = await setup(t, replies);
        let replyCount = 0;
        await command.execute({
            args: video ? ['video'] : [],
            message: {
                attachments: { first: () => ({
                    url: 'https://cdn.discordapp.com/input',
                    name: video ? 'input.mp4' : 'input.png'
                }) },
                reply: async payload => {
                    replyCount += 1;
                    replies.push(payload);
                    return { edit: result => readFileReply(result, replies) };
                }
            }
        });
        assert.equal(replyCount, 1);
        assert.deepEqual(replies[0].allowedMentions, { repliedUser: false });
        assert.equal(replies.length, 2);
        assert.equal(replies[1].content, '');
        assert.equal(replies[1].files[0].name, 'converted.gif');
    }
});

test('conversion errors replace loading for slash and prefix commands', async t => {
    t.mock.method(console, 'error', () => {});
    for (const prefix of [false, true]) {
        const replies = [];
        const command = await setup(t, replies, true);
        if (prefix) {
            await command.execute({
                args: [],
                message: {
                    attachments: { first: () => ({ url: 'https://cdn.discordapp.com/input' }) },
                    reply: async payload => {
                        replies.push(payload);
                        return { edit: async result => { replies.push(result); } };
                    }
                }
            });
        } else {
            await command.executeInteraction({
                interaction: {
                    options: {
                        getAttachment: name => name === 'image' ? { url: 'https://cdn.discordapp.com/input' } : null,
                        getString: () => null,
                        getBoolean: () => false
                    },
                    deferReply: async () => {},
                    editReply: async payload => { replies.push(payload); }
                }
            });
        }
        assert.equal(replies.length, 2);
        assert.match(replies[1].content, /Failed to convert/);
        assert.equal(replies[1].files, undefined);
    }
});
