const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { downloadImage, renderPumpkinMask, ImageInputError } = require('../lib/pumpkin-mask');

const GENERATING = 'Generating... <a:Halloween:1564405562068705360>';

async function generateMask(image, editReply) {
    let result;
    try {
        const input = await downloadImage(image);
        result = await renderPumpkinMask(input);
    } catch (error) {
        console.error('Failed to create pumpkin mask:', error);
        return editReply({
            content: error instanceof ImageInputError
                ? error.message
                : 'I could not create your pumpkin mask right now. Please try again later.'
        });
    }
    return editReply({
        content: '',
        files: [new AttachmentBuilder(result, { name: 'pumpkinmask.png' })]
    });
}

module.exports = {
    name: 'pumpkinmask',
    public: true,
    data: new SlashCommandBuilder()
        .setName('pumpkinmask')
        .setDescription('Put a pumpkin mask over your image.')
        .addAttachmentOption(option => option
            .setName('image')
            .setDescription('Upload an image to wear the mask (up to 10 MB)')
            .setRequired(true)),
    async execute({ message }) {
        const image = message.attachments.first();
        if (!image) {
            return message.reply({
                content: 'Attach an image to your message when using ?pumpkinmask.',
                allowedMentions: { repliedUser: false }
            });
        }
        const response = await message.reply({
            content: GENERATING,
            allowedMentions: { repliedUser: false }
        });
        return generateMask(image, payload => response.edit(payload));
    },
    async executeInteraction({ interaction }) {
        await interaction.deferReply();
        await interaction.editReply({ content: GENERATING });
        const image = interaction.options.getAttachment('image', true);
        return generateMask(image, payload => interaction.editReply(payload));
    }
};
