const REPORT_CHANNEL_ID = '964450684613328916';
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

function isTikTokUrl(url) {
    return url.protocol === 'https:' && TIKTOK_HOSTS.has(url.hostname)
        && !url.username && !url.password && !url.port;
}

function extractTikTokLinks(message) {
    const text = [
        message.content,
        ...(message.embeds || []).flatMap(embed => [
            embed.url, embed.description,
            ...(embed.fields || []).map(field => field.value)
        ])
    ].filter(Boolean).join('\n');
    const links = new Set();
    for (const match of text.matchAll(/https:\/\/[^\s<>"`]+/gi)) {
        try {
            const url = new URL(match[0].replace(/[),.!?;]+$/, ''));
            if (isTikTokUrl(url)) links.add(url.href);
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

async function fetchUploadTime(link, signal) {
    let url = new URL(link);
    for (let redirects = 0; redirects <= 5; redirects++) {
        if (!isTikTokUrl(url)) throw new Error('TikTok redirected outside the allowed video hosts');
        const response = await fetch(url.href, { redirect: 'manual', signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            const location = response.headers.get('location');
            if (!location) throw new Error('TikTok returned a redirect without a location');
            url = new URL(location, url);
            continue;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`TikTok request failed with status ${response.status}`);
        }
        const videoId = url.pathname.match(/\/video\/(\d+)(?:\/|$)/)?.[1];
        if (!videoId) {
            await response.body?.cancel();
            throw new Error('TikTok link did not resolve to a video');
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_PAGE_BYTES) throw new Error('TikTok page exceeded the size limit');
            chunks.push(Buffer.from(chunk));
        }
        return parseUploadTime(Buffer.concat(chunks).toString('utf8'), videoId);
    }
    throw new Error('TikTok exceeded the redirect limit');
}

async function warnAboutOldTikToks(message, botUserId) {
    if (!message.guildId || message.author?.id === botUserId
        || !message.channel?.isThread?.() || message.channel.parentId !== REPORT_CHANNEL_ID) return;
    const links = extractTikTokLinks(message);
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
            console.error(`Failed to check TikTok video age or react in message ${message.id}:`, error.message);
        }
        if (signal.aborted) break;
    }
}

module.exports = { extractTikTokLinks, parseUploadTime, fetchUploadTime, warnAboutOldTikToks };
