const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
        const link = interaction.options.getString('link');
        const spoiler = interaction.options.getBoolean('spoiler') || false;
        const ephemeral = interaction.options.getBoolean('ephemeral') || false;

        if (!attachment && !link) {
            return interaction.reply({ content: 'Please provide either an image attachment or a URL.', ephemeral: true });
        }

        if (!sharp) {
            return interaction.reply({ content: 'Sharp library is not installed on the server. Contact the bot admin.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: ephemeral });

        let imagePath = null;
        try {
            const imageUrl = attachment ? attachment.url : link;
            imagePath = await downloadImage(imageUrl);

            const outputPath = path.join(os.tmpdir(), `gif_output_${Date.now()}.gif`);
            const success = await convertToGif(imagePath, outputPath);

            if (!success || !fs.existsSync(outputPath)) {
                return interaction.editReply({ content: 'Failed to convert image to GIF. Make sure the input is a valid image format.' });
            }

            const stats = fs.statSync(outputPath);
            if (stats.size > 25 * 1024 * 1024) {
                fs.unlinkSync(outputPath);
                return interaction.editReply({ content: 'The converted GIF exceeds Discord\'s 25MB file limit.' });
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
    }
};
