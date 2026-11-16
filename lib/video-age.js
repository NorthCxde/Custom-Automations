const REPORT_CHANNEL_ID = '964450684613328916';
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const YOUTUBE_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'
]);

function isAllowedUrl(url, hosts) {
    return url.protocol === 'https:' && hosts.has(url.hostname)
        && !url.username && !url.password && !url.port;
}

function getYouTubeVideoId(url) {
    if (!isAllowedUrl(url, YOUTUBE_HOSTS)) return null;
    let id;
    if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) {
        id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
    } else if (url.pathname === '/watch') {
        id = url.searchParams.get('v');
    } else {
        id = url.pathname.match(/^\/(?:shorts|live|embed|v|e)\/([^/]+)\/?$/)?.[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
}

function extractVideoLinks(message) {
    const text = [
        message.content,
        ...(message.embeds || []).flatMap(embed => [
            embed.url, embed.description,
            ...(embed.fields || []).map(field => field.value)
        ])
    ].filter(Boolean).join('\n');
    const links = new Set();
    for (const match of text.matchAll(/https?:\/\/[^\s<>"`]+/gi)) {
        try {
            const url = new URL(match[0].replace(/[),.!?;]+$/, ''));
            url.protocol = 'https:';
            const youtubeId = getYouTubeVideoId(url);
            if (youtubeId) links.add(`https://www.youtube.com/watch?v=${youtubeId}`);
            else if (isAllowedUrl(url, TIKTOK_HOSTS)) links.add(url.href);
        } catch {
            // Message text can contain incomplete URLs.
        }
    }
    return [...links];
}

function parseUploadTime(html, videoId) {
    for (const match of html.matchAll(/<script\b[^>]*\bid=["'](__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        const data = JSON.parse(match[2]);
        const item = match[1] === 'SIGI_STATE'
            ? data.ItemModule?.[videoId]
            : data.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
        if (String(item?.id) !== videoId) continue;
        const seconds = Number(item.createTime);
        const timestamp = seconds * 1000;
        if (Number.isSafeInteger(seconds) && seconds > 0 && Number.isSafeInteger(timestamp)) return timestamp;
    }
    throw new Error('TikTok did not provide a valid upload date for this video');
}

function parseYouTubeUploadTime(html) {
    const dates = new Map();
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attributes = Object.fromEntries([...match[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)]
            .map(attribute => [attribute[1].toLowerCase(), attribute[3]]));
        if (['uploadDate', 'datePublished'].includes(attributes.itemprop)) {
            dates.set(attributes.itemprop, attributes.content);
        }
    }
    for (const key of ['uploadDate', 'datePublished']) {
        const date = dates.get(key);
        // A date without a time/offset cannot establish a strict 120-hour age.
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(date || '')) continue;
        const timestamp = Date.parse(date);
        if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
    }
    throw new Error('YouTube did not provide a valid upload timestamp for this video');
}

async function fetchUploadTime(link, signal) {
    let url = new URL(link);
    const youtubeId = getYouTubeVideoId(url);
    const platform = youtubeId ? 'YouTube' : 'TikTok';
    const hosts = youtubeId ? YOUTUBE_HOSTS : TIKTOK_HOSTS;
    for (let redirects = 0; redirects <= 5; redirects++) {
        if (!isAllowedUrl(url, hosts)) throw new Error(`${platform} redirected outside the allowed video hosts`);
        const response = await fetch(url.href, { redirect: 'manual', signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            const location = response.headers.get('location');
            if (!location) throw new Error(`${platform} returned a redirect without a location`);
            url = new URL(location, url);
            continue;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`${platform} request failed with status ${response.status}`);
        }
        const videoId = youtubeId ? getYouTubeVideoId(url) : url.pathname.match(/\/video\/(\d+)(?:\/|$)/)?.[1];
        if (!videoId || (youtubeId && videoId !== youtubeId)) {
            await response.body?.cancel();
            throw new Error(`${platform} link did not resolve to the requested video`);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_PAGE_BYTES) throw new Error(`${platform} page exceeded the size limit`);
            chunks.push(Buffer.from(chunk));
        }
        const html = Buffer.concat(chunks).toString('utf8');
        return youtubeId ? parseYouTubeUploadTime(html) : parseUploadTime(html, videoId);
    }
    throw new Error(`${platform} exceeded the redirect limit`);
}

async function warnAboutOldVideos(message, botUserId) {
    if (!message.guildId || message.author?.id === botUserId
        || !message.channel?.isThread?.() || message.channel.parentId !== REPORT_CHANNEL_ID) return;
    const links = extractVideoLinks(message);
    if (!links.length) return;
    const signal = AbortSignal.timeout(20000);
    const referenceTime = message.createdTimestamp;
    for (const link of links) {
        try {
            const uploadedAt = await fetchUploadTime(link, signal);
            if (referenceTime - uploadedAt > FIVE_DAYS_MS) {
                await message.react('\u26a0\ufe0f');
                return;
            }
        } catch (error) {
            console.error(`Failed to check video age or react in message ${message.id}:`, error.message);
        }
        if (signal.aborted) break;
    }
}

module.exports = { extractVideoLinks, parseUploadTime, parseYouTubeUploadTime, fetchUploadTime, warnAboutOldVideos };
