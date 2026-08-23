const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

let sharp;
try {
    sharp = require('sharp');
} catch {
    sharp = null;
}

async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const tempPath = path.join(os.tmpdir(), `gif_temp_${Date.now()}.tmp`);
        const file = fs.createWriteStream(tempPath);

        protocol.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(tempPath);
            });
        }).on('error', (err) => {
            fs.unlink(tempPath, () => {});
            reject(err);
        });
    });
}

async function convertToGif(inputPath, outputPath) {
    try {
        if (!sharp) {
            throw new Error('Sharp library not installed. Run: npm install sharp');
        }
        
        await sharp(inputPath)
            .gif({ effort: 7 })
            .toFile(outputPath);
        
        return true;
    } catch (err) {
        console.error('GIF conversion error:', err);
        return false;
    }
}

async function convertVideoToGif(inputPath, outputPath) {
    if (!ffmpegPath) throw new Error('FFmpeg binary is not available on this server.');

    return new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, [
            '-y',
            '-i', inputPath,
            '-t', '15',
            '-filter_complex', '[0:v]fps=15,scale=640:-2:flags=lanczos,format=rgb24,split[main][palette];[palette]palettegen=max_colors=256:stats_mode=full[colors];[main][colors]paletteuse=dither=bayer:bayer_scale=5',
            '-loop', '0',
            '-an',
            outputPath
        ], { windowsHide: true });

        let errorOutput = '';
        ffmpeg.stderr.on('data', chunk => {
            errorOutput += chunk.toString();
        });
        ffmpeg.on('error', reject);
        ffmpeg.on('close', code => {
            if (code === 0) return resolve(true);
            reject(new Error(errorOutput.trim().split('\n').pop() || `FFmpeg exited with code ${code}.`));
        });
    });
}

function isVideoAttachment(attachment) {
    const contentType = String(attachment?.contentType || '').toLowerCase();
    const name = String(attachment?.name || attachment?.url || '').toLowerCase();
    return contentType.startsWith('video/') || /\.(mp4|mov|webm|mkv)(?:$|\?)/.test(name);
}

module.exports = {
    name: 'gif',
    description: 'Converts an image into a GIF',
    data: new SlashCommandBuilder()
        .setName('gif')
        .setDescription('Converts an image into a GIF')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('An image/GIF attachment')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('video')
                .setDescription('An MP4/video attachment')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('link')
                .setDescription('An image/GIF URL')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('spoiler')
                .setDescription('Attempt to send output as a spoiler')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('ephemeral')
                .setDescription('Attempt to send output as an ephemeral/temporary response')
                .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        const attachment = interaction.options.getAttachment('image');
        const video = interaction.options.getAttachment('video');
        const link = interaction.options.getString('link');
        const spoiler = interaction.options.getBoolean('spoiler') || false;
        const ephemeral = interaction.options.getBoolean('ephemeral') || false;

        if (!attachment && !video && !link) {
            return interaction.reply({ content: 'Please provide an image, video attachment, or URL.', ephemeral: true });
        }

        if (!video && !sharp) {
            return interaction.reply({ content: 'Sharp library is not installed on the server. Contact the bot admin.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: ephemeral });

        let imagePath = null;
        try {
            const imageUrl = video ? video.url : (attachment ? attachment.url : link);
            imagePath = await downloadImage(imageUrl);

            const outputPath = path.join(os.tmpdir(), `gif_output_${Date.now()}.gif`);
            const success = video
                ? await convertVideoToGif(imagePath, outputPath)
                : await convertToGif(imagePath, outputPath);

            if (!success || !fs.existsSync(outputPath)) {
                return interaction.editReply({ content: 'Failed to convert image to GIF. Make sure the input is a valid image format.' });
            }

            const stats = fs.statSync(outputPath);
            if (stats.size > 100 * 1024 * 1024) {
                fs.unlinkSync(outputPath);
                return interaction.editReply({ content: 'The converted GIF exceeds Discord\'s 100MB file limit.' });
            }

            let fileName = 'converted.gif';
            if (spoiler) fileName = `SPOILER_${fileName}`;

            const file = new AttachmentBuilder(outputPath, { name: fileName });
            await interaction.editReply({ files: [file] });

            fs.unlinkSync(outputPath);
        } catch (error) {
            console.error('GIF conversion error:', error);
            return interaction.editReply({ content: `Error converting image: ${error.message}` });
        } finally {
            if (imagePath && fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }
    },
    async execute({ message }) {
        const attachment = message.attachments?.first?.();
        if (!attachment) {
            return message.reply('Attach an image to the `?gif` command.');
        }

        const isVideo = isVideoAttachment(attachment);
        if (!isVideo && !sharp) {
            return message.reply('Sharp library is not installed on the server. Contact the bot admin.');
        }

        let imagePath = null;
        let outputPath = null;
        try {
            imagePath = await downloadImage(attachment.url);
            outputPath = path.join(os.tmpdir(), `gif_output_${Date.now()}.gif`);
            const success = isVideo
                ? await convertVideoToGif(imagePath, outputPath)
                : await convertToGif(imagePath, outputPath);

            if (!success || !fs.existsSync(outputPath)) {
                return message.reply('Failed to convert the attachment to a GIF. Make sure it is a valid image.');
            }

            const stats = fs.statSync(outputPath);
            if (stats.size > 100 * 1024 * 1024) {
                return message.reply('The converted GIF exceeds Discord\'s 100MB file limit.');
            }

            return await message.reply({
                files: [new AttachmentBuilder(outputPath, { name: 'converted.gif' })]
            });
        } catch (error) {
            console.error('Prefix GIF conversion error:', error);
            return message.reply(`Error converting image: ${error.message}`);
        } finally {
            if (imagePath && fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            if (outputPath && fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
        }
    }
};
