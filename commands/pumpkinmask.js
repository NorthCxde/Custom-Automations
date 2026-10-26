const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { downloadImage, renderPumpkinMask, ImageInputError } = require('../lib/pumpkin-mask');

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
    async executeInteraction({ interaction }) {
        await interaction.deferReply();
        await interaction.editReply({ content: 'Generating... <a:Halloween:1564405562068705360>' });
        let result;
        try {
            const image = interaction.options.getAttachment('image', true);
            const input = await downloadImage(image);
            result = await renderPumpkinMask(input);
        } catch (error) {
            console.error('Failed to create pumpkin mask:', error);
            return interaction.editReply({
                content: error instanceof ImageInputError
                    ? error.message
                    : 'I could not create your pumpkin mask right now. Please try again later.'
            });
        }
        return interaction.editReply({
            content: '',
            files: [new AttachmentBuilder(result, { name: 'pumpkinmask.png' })]
        });
    }
};
