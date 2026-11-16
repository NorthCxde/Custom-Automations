const REPORT_CHANNEL_ID = '964450684613328916';
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const YOUTUBE_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'
]);
const MEDAL_HOSTS = new Set(['medal.tv', 'www.medal.tv']);

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

function getMedalClipId(url) {
    if (!isAllowedUrl(url, MEDAL_HOSTS)) return null;
    return url.pathname.match(/^\/(?:games\/[^/]+\/)?clips?\/([A-Za-z0-9_-]+)\/?$/)?.[1] || null;
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
            else if (getMedalClipId(url)) {
                url.hostname = 'medal.tv';
                url.search = '';
                url.hash = '';
                links.add(url.href);
            } else if (isAllowedUrl(url, TIKTOK_HOSTS)) links.add(url.href);
        } catch {
            // Message text can contain incomplete URLs.
        }
    }
    return [...links];
}

function parseExactTimestamp(date) {
    if (typeof date !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(date)) return null;
    const timestamp = Date.parse(date);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function parseMedalUploadTime(html, clipId) {
    for (const match of html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        const data = JSON.parse(match[1]);
        const entries = (Array.isArray(data) ? data : [data]).flatMap(entry => entry?.['@graph'] || [entry]);
        for (const entry of entries) {
            const types = Array.isArray(entry?.['@type']) ? entry['@type'] : [entry?.['@type']];
            if (!types.includes('VideoObject')) continue;
            const clipUrl = entry['@id'] || entry.url || entry.embedUrl;
            if (typeof clipUrl !== 'string' || !URL.canParse(clipUrl)) continue;
            if (getMedalClipId(new URL(clipUrl)) !== clipId) continue;
            const timestamp = parseExactTimestamp(entry.uploadDate);
            if (timestamp !== null) return timestamp;
        }
    }
    throw new Error('Medal did not provide a valid upload timestamp for this clip');
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

function latestTimeForDate(value) {
    if (typeof value !== 'string') return null;
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const english = value.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const monthIndex = english ? months.findIndex(month =>
        [month.toLowerCase(), month.slice(0, 3).toLowerCase()].includes(english[1].toLowerCase())) : -1;
    if (!iso && (!english || monthIndex < 0)) return null;
    const year = Number(iso ? iso[1] : english[3]);
    const month = iso ? Number(iso[2]) - 1 : monthIndex;
    const day = Number(iso ? iso[3] : english[2]);
    const start = Date.UTC(year, month, day);
    const date = new Date(start);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
    // Unknown time/zone: use the end of that day in UTC-12 to avoid premature warnings.
    return start + 36 * 60 * 60 * 1000;
}

function readJsonObject(text, start) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
    throw new Error('YouTube returned incomplete publication-date metadata');
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
        const timestamp = parseExactTimestamp(dates.get(key));
        if (timestamp !== null) return timestamp;
    }
    for (const key of ['uploadDate', 'datePublished']) {
        const latest = latestTimeForDate(dates.get(key));
        if (latest !== null) return latest;
    }
    for (const match of html.matchAll(/"videoDescriptionHeaderRenderer"\s*:\s*(?=\{)/g)) {
        const header = readJsonObject(html, match.index + match[0].length);
        const latest = latestTimeForDate(header.publishDate?.simpleText);
        if (latest !== null) return latest;
    }
    throw new Error('YouTube did not provide a valid upload timestamp for this video');
}

async function fetchUploadTime(link, signal) {
    let url = new URL(link);
    const youtubeId = getYouTubeVideoId(url);
    const medalId = getMedalClipId(url);
    const platform = youtubeId ? 'YouTube' : medalId ? 'Medal' : 'TikTok';
    const hosts = youtubeId ? YOUTUBE_HOSTS : medalId ? MEDAL_HOSTS : TIKTOK_HOSTS;
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
        const videoId = youtubeId ? getYouTubeVideoId(url)
            : medalId ? getMedalClipId(url) : url.pathname.match(/\/video\/(\d+)(?:\/|$)/)?.[1];
        if (!videoId || (youtubeId && videoId !== youtubeId) || (medalId && videoId !== medalId)) {
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
        if (medalId) return parseMedalUploadTime(html, videoId);
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

module.exports = {
    extractVideoLinks, parseUploadTime, parseYouTubeUploadTime, parseMedalUploadTime,
    fetchUploadTime, warnAboutOldVideos
};
