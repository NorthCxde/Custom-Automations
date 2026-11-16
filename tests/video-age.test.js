const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoLinks, parseUploadTime, parseYouTubeUploadTime, warnAboutOldVideos } = require('../lib/video-age');

const DAY = 24 * 60 * 60 * 1000;
const uploadedAt = 1700000000000;
const link = 'https://www.tiktok.com/@example/video/123';

function html(seconds = uploadedAt / 1000, id = '123') {
    return `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({
        __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { id, createTime: seconds } } } }
    })}</script>`;
}

function message(age = 6 * DAY) {
    return {
        id: 'message', guildId: 'guild', author: { id: 'reporter' }, content: link, embeds: [],
        createdTimestamp: uploadedAt + age,
        channel: { parentId: '964450684613328916', isThread: () => true },
        reactions: [],
        async react(emoji) { this.reactions.push(emoji); }
    };
}

function pageResponse(body = html()) {
    return new Response(body, { status: 200 });
}

test('only real TikTok hosts are accepted, including short links and questionnaire embeds', () => {
    const msg = message();
    msg.content = `${link} ${link} https://tiktok.com.evil.example/video/1 https://example.com/tiktok
        https://www.tiktok.com@127.0.0.1/video/1 https://vm.tiktok.com/short/`;
    msg.embeds = [{ fields: [{ value: 'Evidence: https://vt.tiktok.com/short/' }] }];
    assert.deepEqual(extractVideoLinks(msg), [link, 'https://vm.tiktok.com/short/', 'https://vt.tiktok.com/short/']);
});

test('parses upload metadata for the matching video only, including legacy metadata', () => {
    assert.equal(parseUploadTime(html(), '123'), uploadedAt);
    const legacy = `<script id="SIGI_STATE">${JSON.stringify({
        ItemModule: { 123: { id: '123', createTime: String(uploadedAt / 1000) } }
    })}</script>`;
    assert.equal(parseUploadTime(legacy, '123'), uploadedAt);
    for (const body of [html(0), html('invalid'), html(undefined, '456'), '<html>Blocked</html>']) {
        assert.throws(() => parseUploadTime(body, '123'), /valid upload date/);
    }
});

test('reacts only when upload age is strictly greater than five days at message creation', async t => {
    t.mock.method(globalThis, 'fetch', async () => pageResponse());
    for (const [age, expected] of [[5 * DAY - 1, []], [5 * DAY, []], [5 * DAY + 1, ['⚠️']], [-DAY, []]]) {
        const msg = message(age);
        await warnAboutOldVideos(msg, 'bot');
        assert.deepEqual(msg.reactions, expected);
    }
});

test('ignores parent-channel messages, other threads, DMs and the bot itself', async t => {
    t.mock.method(globalThis, 'fetch', async () => assert.fail('Unexpected request'));
    for (const change of [
        msg => { msg.channel.isThread = () => false; },
        msg => { msg.channel.parentId = '1406849874925719583'; },
        msg => { msg.guildId = null; },
        msg => { msg.author.id = 'bot'; }
    ]) {
        const msg = message();
        change(msg);
        await warnAboutOldVideos(msg, 'bot');
        assert.deepEqual(msg.reactions, []);
    }
});

test('resolves shortened links and keeps redirects limited to TikTok HTTPS hosts', async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push(url);
        assert.equal(options.redirect, 'manual');
        assert.ok(options.signal instanceof AbortSignal);
        return calls.length === 1
            ? new Response(null, { status: 302, headers: { location: link } })
            : pageResponse();
    });
    const msg = message();
    msg.content = 'https://vm.tiktok.com/short/';
    await warnAboutOldVideos(msg, 'bot');
    assert.equal(calls.length, 2);
    assert.deepEqual(msg.reactions, ['⚠️']);

    t.mock.method(console, 'error', () => {});
    for (const destination of ['http://www.tiktok.com/video/123', 'https://127.0.0.1/', 'https://example.com/']) {
        let count = 0;
        t.mock.method(globalThis, 'fetch', async () => {
            count++;
            return new Response(null, { status: 302, headers: { location: destination } });
        });
        const blocked = message();
        await warnAboutOldVideos(blocked, 'bot');
        assert.equal(count, 1);
        assert.deepEqual(blocked.reactions, []);
    }
});

test('unavailable dates are logged without warnings and another old link can still trigger one', async t => {
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    for (const response of [
        () => new Response(null, { status: 403 }),
        () => pageResponse('<html>Challenge</html>'),
        () => { throw new Error('Network failed'); }
    ]) {
        t.mock.method(globalThis, 'fetch', async () => response());
        const msg = message();
        await warnAboutOldVideos(msg, 'bot');
        assert.deepEqual(msg.reactions, []);
    }
    assert.equal(errors.length, 3);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1
        ? new Response(null, { status: 404 }) : pageResponse());
    const msg = message();
    msg.content = `https://www.tiktok.com/@example/video/456 ${link}`;
    await warnAboutOldVideos(msg, 'bot');
    assert.deepEqual(msg.reactions, ['⚠️']);
});

const youtubeId = 'jNQXAC9IVRw';
const youtubeLink = `https://www.youtube.com/watch?v=${youtubeId}`;

function youtubeHtml(timestamp = new Date(uploadedAt).toISOString()) {
    return `<meta itemprop="uploadDate" content="${timestamp}">`;
}

test('YouTube watch, short, Shorts, live and embed variants normalize to one video', () => {
    const msg = message();
    for (const url of [
        `https://youtube.com/watch?v=${youtubeId}&list=playlist&t=3`,
        `http://www.youtube.com/watch?feature=shared&v=${youtubeId}`,
        `https://m.youtube.com/watch?v=${youtubeId}`,
        `https://music.youtube.com/watch?v=${youtubeId}`,
        `https://youtu.be/${youtubeId}?si=tracking`,
        `https://www.youtu.be/${youtubeId}`,
        `https://www.youtube.com/shorts/${youtubeId}?feature=share`,
        `https://www.youtube.com/live/${youtubeId}`,
        `https://www.youtube.com/embed/${youtubeId}`,
        `https://www.youtube-nocookie.com/embed/${youtubeId}`,
        `https://youtube.com/v/${youtubeId}`,
        `https://youtube.com/e/${youtubeId}`
    ]) {
        msg.content = `${url} ${youtubeLink}`;
        assert.deepEqual(extractVideoLinks(msg), [youtubeLink], url);
    }
    msg.content = `https://youtube.com.evil.example/watch?v=${youtubeId}
        https://www.youtube.com@127.0.0.1/watch?v=${youtubeId}
        https://www.youtube.com/playlist?list=123 https://www.youtube.com/@channel
        https://youtube.com/watch?v=invalid https://youtu.be/${youtubeId}/extra`;
    assert.deepEqual(extractVideoLinks(msg), []);
});

test('YouTube upload timestamps respect offsets and reject missing or date-only metadata', () => {
    assert.equal(parseYouTubeUploadTime(youtubeHtml()), uploadedAt);
    assert.equal(parseYouTubeUploadTime('<meta content="2023-11-14T17:13:20-05:00" itemprop="datePublished">'), uploadedAt);
    for (const body of [youtubeHtml('2023-11-14'), youtubeHtml('invalid'), '<html>Sign in</html>']) {
        assert.throws(() => parseYouTubeUploadTime(body), /valid upload timestamp/);
    }
});

test('YouTube warns strictly after five days, checks canonical links, and deduplicates reactions', async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls++;
        assert.equal(url, youtubeLink);
        assert.equal(options.redirect, 'manual');
        return pageResponse(youtubeHtml());
    });
    for (const [age, expected] of [[5 * DAY, []], [5 * DAY + 1, ['⚠️']], [-DAY, []]]) {
        const msg = message(age);
        msg.content = `https://youtu.be/${youtubeId} ${youtubeLink}`;
        await warnAboutOldVideos(msg, 'bot');
        assert.deepEqual(msg.reactions, expected);
    }
    assert.equal(calls, 3);
});

test('mixed-platform messages still warn when one source is blocked; YouTube redirects cannot leave its hosts', async t => {
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    t.mock.method(globalThis, 'fetch', async url => url === link
        ? new Response(null, { status: 403 }) : pageResponse(youtubeHtml()));
    const msg = message();
    msg.content = `${link} ${youtubeLink}`;
    await warnAboutOldVideos(msg, 'bot');
    assert.deepEqual(msg.reactions, ['⚠️']);
    assert.equal(errors.length, 1);

    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location: 'https://example.com/' } });
    });
    const redirected = message();
    redirected.content = youtubeLink;
    await warnAboutOldVideos(redirected, 'bot');
    assert.equal(calls, 1);
    assert.deepEqual(redirected.reactions, []);
});
