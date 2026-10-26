const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const command = require('../commands/pumpkinmask');
const { renderPumpkinMask, downloadImage, MAX_BYTES } = require('../lib/pumpkin-mask');

const maskPath = path.join(__dirname, '..', 'assets', 'pumpkin-mask.png');
const squareMaskPath = path.join(__dirname, '..', 'assets', 'pumpkin-mask-square.png');
const attachment = {
    url: 'https://cdn.discordapp.com/attachments/123/456/image.png?ex=123',
    size: 100
};

async function solid(width, height, background = '#ff0000') {
    return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}

test('mask is contained and centered on the original image canvas with opaque black outside it', async () => {
    for (const [width, height, left, top, fittedWidth, fittedHeight, selectedMask] of [
        [2350, 768, 587, 0, 1175, 768, maskPath],
        [470, 1536, 0, 533, 470, 470, squareMaskPath],
        [470, 470, 0, 0, 470, 470, squareMaskPath],
        [1175, 768, 0, 0, 1175, 768, maskPath]
    ]) {
        const { data: resized, info: maskInfo } = await sharp(selectedMask)
            .resize(fittedWidth, fittedHeight, { fit: 'fill' })
            .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const output = await renderPumpkinMask(await solid(width, height));
        const metadata = await sharp(output).metadata();
        assert.equal(metadata.format, 'png');
        assert.equal(metadata.width, width);
        assert.equal(metadata.height, height);
        const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let paddingPixels = 0;
        let visiblePixels = 0;
        let maxDifference = 0;
        for (let y = 0; y < info.height; y += 1) {
            for (let x = 0; x < info.width; x += 1) {
                const index = y * info.width + x;
                const inside = x >= left && x < left + fittedWidth && y >= top && y < top + fittedHeight;
                const maskIndex = ((y - top) * maskInfo.width + x - left) * 4 + 3;
                const expected = inside ? 255 - resized[maskIndex] : 0;
                maxDifference = Math.max(maxDifference, Math.abs(data[index * 3] - expected),
                    data[index * 3 + 1], data[index * 3 + 2]);
                if (!inside) paddingPixels += 1;
                if (expected > 0) visiblePixels += 1;
            }
        }
        assert.ok(maxDifference <= 1, `Pixel mismatch for ${width}x${height}: ${maxDifference}`);
        assert.ok(visiblePixels > 0, 'Transparent mask holes reveal the uploaded image');
        if (fittedWidth < width || fittedHeight < height) assert.ok(paddingPixels > 0);
    }
});

test('square, transparent and EXIF-rotated images produce opaque black-backed output', async () => {
    const square = await renderPumpkinMask(await solid(256, 256));
    assert.equal((await sharp(square).metadata()).width, 256);
    const transparent = await renderPumpkinMask(await solid(400, 200, { r: 0, g: 0, b: 0, alpha: 0 }));
    const stats = await sharp(transparent).stats();
    for (const channel of stats.channels.slice(0, 3)) assert.equal(channel.max, 0);
    if (stats.channels.length === 4) assert.equal(stats.channels[3].min, 255);
    const rotated = await sharp(await solid(768, 235)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await renderPumpkinMask(rotated);
    const { data, info } = await sharp(result).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    assert.equal(info.width, 235);
    assert.equal(info.height, 768);
    assert.deepEqual(pixel(100, 100), [0, 0, 0], 'EXIF rotation makes a portrait canvas with black mask padding');
});

test('invalid, unsupported and oversized decoded images have explicit input errors', async () => {
    await assert.rejects(renderPumpkinMask(Buffer.from('not an image')), /Could not read that image/);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    await assert.rejects(renderPumpkinMask(svg), /Please upload a PNG/);
    const oversized = await solid(5001, 5000, '#000000');
    await assert.rejects(renderPumpkinMask(oversized), /25 megapixels/);
});

test('downloads only Discord attachments with bounded size, timeout and no redirects', async t => {
    const input = await solid(10, 10);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls += 1;
        assert.equal(url.hostname, 'cdn.discordapp.com');
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        return new Response(input);
    });
    assert.deepEqual(await downloadImage({ ...attachment, size: input.length }), input);
    await assert.rejects(downloadImage({ ...attachment, size: MAX_BYTES + 1 }), /10 MB/);
    await assert.rejects(downloadImage({ ...attachment, url: 'https://example.com/image.png' }), /uploaded directly/);
    await assert.rejects(downloadImage({ ...attachment, url: 'http://cdn.discordapp.com/image.png' }), /uploaded directly/);
    assert.equal(calls, 1);
});

test('download errors, empty responses and oversized streams cannot return a result', async t => {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
    await assert.rejects(downloadImage(attachment), /status 403/);
    mock.mock.mockImplementation(async () => new Response(Buffer.alloc(0)));
    await assert.rejects(downloadImage(attachment), /empty/);
    mock.mock.mockImplementation(async () => new Response(Buffer.alloc(MAX_BYTES + 1)));
    await assert.rejects(downloadImage(attachment), /10 MB/);
    mock.mock.mockImplementation(async () => { throw new Error('Timed out'); });
    await assert.rejects(downloadImage(attachment), /Timed out/);
});

test('command requires Image, defaults to public permissions and sends downloadable PNG publicly', async t => {
    const definition = command.data.toJSON();
    assert.equal(definition.name, 'pumpkinmask');
    assert.equal(definition.options[0].name, 'image');
    assert.equal(definition.options[0].type, 11);
    assert.equal(definition.options[0].required, true);
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const assignment = source.match(/client\.getDefaultCommandAccessLevel = \(commandName\) => \{[\s\S]*?\n};/)[0];
    const publicNames = source.match(/const DEFAULT_PUBLIC_COMMAND_NAMES = new Set\([^\n]+/)[0];
    const adminNames = source.match(/const ADMIN_ONLY_COMMAND_NAMES = new Set\([\s\S]*?\);/)[0];
    const client = {};
    vm.runInNewContext(`${publicNames}\n${adminNames}\n${assignment}`, { client });
    assert.equal(client.getDefaultCommandAccessLevel('pumpkinmask'), 'public');
    const input = await solid(100, 200);
    const replies = [];
    t.mock.method(globalThis, 'fetch', async () => {
        assert.deepEqual(replies, [{ content: 'Generating... <a:Halloween:1564405562068705360>' }]);
        return new Response(input);
    });
    let reply;
    let deferred = false;
    await command.executeInteraction({
        interaction: {
            options: { getAttachment: (name, required) => {
                assert.equal(name, 'image');
                assert.equal(required, true);
                return { ...attachment, size: input.length };
            } },
            deferReply: async options => { assert.equal(options, undefined); deferred = true; },
            editReply: async payload => { replies.push(payload); reply = payload; }
        }
    });
    assert.equal(deferred, true);
    assert.equal(replies.length, 2);
    assert.equal(reply.content, '');
    assert.equal(reply.files[0].name, 'pumpkinmask.png');
    assert.equal((await sharp(reply.files[0].attachment).metadata()).format, 'png');
    assert.equal(reply.flags, undefined);
});

test('command logs and replies explicitly on invalid image and download failure', async t => {
    const errors = t.mock.method(console, 'error', () => {});
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response('invalid'));
    let reply;
    const interaction = {
        options: { getAttachment: () => attachment },
        deferReply: async () => {},
        editReply: async payload => { reply = payload; }
    };
    await command.executeInteraction({ interaction });
    assert.match(reply.content, /Could not read that image/);
    assert.doesNotMatch(reply.content, /Generating/);
    assert.equal(reply.files, undefined);
    mock.mock.mockImplementation(async () => new Response('', { status: 500 }));
    await command.executeInteraction({ interaction });
    assert.match(reply.content, /could not create your pumpkin mask/);
    assert.equal(errors.mock.callCount(), 2);
});

test('prefix command processes the attached image and edits its loading reply without pinging', async t => {
    const input = await solid(256, 256);
    const events = [];
    t.mock.method(globalThis, 'fetch', async () => {
        assert.equal(events[0].content, 'Generating... <a:Halloween:1564405562068705360>');
        return new Response(input);
    });
    const response = {
        edit: async payload => { events.push(payload); return payload; }
    };
    const result = await command.execute({
        message: {
            attachments: { first: () => ({ ...attachment, size: input.length }) },
            reply: async payload => { events.push(payload); return response; }
        }
    });
    assert.deepEqual(events[0].allowedMentions, { repliedUser: false });
    assert.equal(events.length, 2);
    assert.equal(result.content, '');
    assert.equal(result.files[0].name, 'pumpkinmask.png');
    const metadata = await sharp(result.files[0].attachment).metadata();
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
});

test('prefix command explains missing attachments and replaces loading with image errors', async t => {
    let reply;
    await command.execute({
        message: {
            attachments: { first: () => undefined },
            reply: async payload => { reply = payload; }
        }
    });
    assert.match(reply.content, /Attach an image.*\?pumpkinmask/);
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async () => new Response('invalid'));
    await command.execute({
        message: {
            attachments: { first: () => attachment },
            reply: async () => ({ edit: async payload => { reply = payload; } })
        }
    });
    assert.match(reply.content, /Could not read that image/);
    assert.equal(reply.files, undefined);
});

test('prefix IDs and mentions use the fetched server avatar before an attached image', async t => {
    const userId = '123456789012345678';
    const input = await solid(128, 128);
    for (const [target, avatar] of [
        [userId, 'https://cdn.discordapp.com/guilds/123/users/456/avatars/server.png'],
        [`<@${userId}>`, 'https://cdn.discordapp.com/avatars/456/global.png'],
        [`<@!${userId}>`, 'https://cdn.discordapp.com/embed/avatars/0.png']
    ]) {
        const events = [];
        t.mock.method(globalThis, 'fetch', async url => {
            assert.equal(url.href, avatar);
            assert.match(events[0].content, /Generating/);
            return new Response(input);
        });
        const result = await command.execute({
            args: [target],
            message: {
                attachments: { first: () => attachment },
                guild: { members: { fetch: async options => {
                    assert.deepEqual(options, { user: userId, force: true });
                    return { displayAvatarURL: options => {
                        assert.deepEqual(options, { extension: 'png', size: 1024, forceStatic: true });
                        return avatar;
                    } };
                } } },
                reply: async payload => {
                    events.push(payload);
                    return { edit: async payload => { events.push(payload); return payload; } };
                }
            }
        });
        assert.equal(result.files[0].name, 'pumpkinmask.png');
        assert.equal(events.length, 2);
    }
});

test('invalid targets and missing members return errors instead of using an unrelated attachment', async t => {
    const errors = t.mock.method(console, 'error', () => {});
    let reply;
    const message = {
        attachments: { first: () => attachment },
        guild: { members: { fetch: async () => { throw Object.assign(new Error('Unknown member'), { code: 10007 }); } } },
        reply: async payload => {
            reply = payload;
            return { edit: async payload => { reply = payload; return payload; } };
        }
    };
    await command.execute({ message, args: ['not-a-user'] });
    assert.match(reply.content, /valid user ID or mention/);
    await command.execute({ message, args: ['123456789012345678'] });
    assert.match(reply.content, /could not be found in this server/);
    assert.equal(reply.files, undefined);
    assert.equal(errors.mock.callCount(), 1);
});
