const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const timers = require('node:timers/promises');

const MAX_BYTES = 100 * 1024 * 1024;
let active = false;
const inProgress = new Set();

async function downloadVideo(link, directory, limit) {
    const output = path.join(directory, 'evidence.mp4');
    await new Promise((resolve, reject) => {
        const child = childProcess.spawn(process.env.YT_DLP_PATH || 'yt-dlp', [
            '--ignore-config', '--no-playlist', '--no-progress', '--no-warnings',
            '--socket-timeout', '20', '--retries', '1', '--fragment-retries', '1',
            '--max-filesize', String(limit), '--format', 'best[ext=mp4]',
            '--output', output, '--', link
        ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let reason;
        let stderr = '';
        let checking = false;
        const stop = error => { reason = reason || error; child.kill(); };
        const timeout = setTimeout(() => stop(Object.assign(
            new Error('Video download timed out'), { retryable: true }
        )), 120000);
        const monitor = setInterval(async () => {
            if (checking) return;
            checking = true;
            try {
                let size = 0;
                for (const name of await fs.readdir(directory)) {
                    try {
                        size += (await fs.stat(path.join(directory, name))).size;
                    } catch (error) {
                        if (error.code !== 'ENOENT') throw error;
                    }
                }
                if (size > limit) stop(new Error('Video exceeds the upload size limit'));
            } catch (error) {
                stop(error);
            } finally {
                checking = false;
            }
        }, 250);
        child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
        child.on('error', error => { reason = error; });
        child.on('close', code => {
            clearTimeout(timeout);
            clearInterval(monitor);
            if (reason) reject(reason);
            else if (code !== 0) reject(Object.assign(
                new Error(`yt-dlp failed (${code}): ${stderr.trim()}`), { retryable: true }
            ));
            else resolve();
        });
    });
    const stat = await fs.stat(output);
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) {
        throw new Error('Video is empty or exceeds the upload size limit');
    }
    const handle = await fs.open(output, 'r');
    try {
        const header = Buffer.alloc(12);
        await handle.read(header, 0, header.length, 0);
        if (header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Downloaded file is not an MP4');
    } finally {
        await handle.close();
    }
    return output;
}

async function repostVideo(message, link) {
    const key = `${message.id}:${link}`;
    if (inProgress.has(key)) return 'in_progress';
    if (active) {
        await message.reply({
            content: 'Another evidence download is in progress. Please run fetch again shortly.',
            allowedMentions: { parse: [], repliedUser: false }
        });
        return 'busy';
    }
    active = true;
    inProgress.add(key);
    let directory;
    try {
        const limit = Math.min(MAX_BYTES, message.guild?.maximumUploadLimit || MAX_BYTES);
        let file;
        for (let attempt = 1; attempt <= 3; attempt++) {
            directory = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-video-'));
            try {
                file = await downloadVideo(link, directory, limit);
                break;
            } catch (error) {
                if (!error.retryable || attempt === 3) throw error;
                console.error(`Evidence download attempt ${attempt}/3 failed for message ${message.id}; retrying:`, error.message);
                await fs.rm(directory, { recursive: true, force: true });
                directory = undefined;
                await timers.setTimeout(2000);
            }
        }
        await message.reply({
            content: `Saved video.\nSource: <${link}>`,
            files: [{ attachment: file, name: 'evidence.mp4' }],
            allowedMentions: { parse: [], repliedUser: false }
        });
        return 'saved';
    } catch (error) {
        console.error(`Failed to repost video for message ${message.id}:`, error.message);
        await message.reply({
            content: 'Video was not saved: the download could not be verified, was blocked, or exceeded the upload limit.',
            allowedMentions: { parse: [], repliedUser: false }
        });
        return 'failed';
    } finally {
        if (directory) {
            try {
                await fs.rm(directory, { recursive: true, force: true });
            } catch (error) {
                console.error(`Failed to clean up evidence download for message ${message.id}:`, error.message);
            }
        }
        active = false;
        inProgress.delete(key);
    }
}

module.exports = { downloadVideo, repostVideo };
