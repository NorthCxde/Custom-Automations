const path = require('path');
const sharp = require('sharp');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 25 * 1000 * 1000;
const MASK_PATH = path.join(__dirname, '..', 'assets', 'pumpkin-mask.png');
const FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);

class ImageInputError extends Error {}

async function downloadImage(attachment) {
    if (!Number.isSafeInteger(attachment.size) || attachment.size <= 0 || attachment.size > MAX_BYTES) {
        throw new ImageInputError('Please upload an image no larger than 10 MB.');
    }
    const url = new URL(attachment.url);
    if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
        || url.username || url.password || url.port) {
        throw new ImageInputError('Please use an image uploaded directly to Discord.');
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`Image download failed with status ${response.status}`);
    if (!response.body) throw new Error('Image download returned no body');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES) {
            throw new ImageInputError('Please upload an image no larger than 10 MB.');
        }
        chunks.push(chunk);
    }
    if (size === 0) throw new ImageInputError('The uploaded image is empty.');
    return Buffer.concat(chunks, size);
}

async function renderPumpkinMask(input) {
    let image;
    let metadata;
    try {
        image = sharp(input, { limitInputPixels: MAX_PIXELS });
        metadata = await image.metadata();
    } catch (error) {
        throw new ImageInputError('Could not read that image. Use PNG, JPG, WebP, GIF, or AVIF, up to 25 megapixels.', { cause: error });
    }
    if (!FORMATS.has(metadata.format)) {
        throw new ImageInputError('Please upload a PNG, JPG, WebP, GIF, or AVIF image.');
    }

    const mask = await sharp(MASK_PATH).metadata();
    if (!mask.width || !mask.height || !mask.hasAlpha) throw new Error('Pumpkin mask asset is invalid');
    let base;
    try {
        base = await image
            .rotate()
            .resize(mask.width, mask.height, { fit: 'contain', position: 'centre', background: '#000000' })
            .flatten({ background: '#000000' })
            .png()
            .toBuffer();
    } catch (error) {
        throw new ImageInputError('Could not process that image. Try uploading a different image.', { cause: error });
    }
    return sharp(base)
        .composite([{ input: MASK_PATH, gravity: 'centre', blend: 'over' }])
        .flatten({ background: '#000000' })
        .png()
        .toBuffer();
}

module.exports = { downloadImage, renderPumpkinMask, ImageInputError, MAX_BYTES };
