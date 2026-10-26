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
    async execute({ message, args = [] }) {
        let image = message.attachments.first();
        const target = args[0];
        const userId = target?.match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
        if (target && !userId) {
            return message.reply({
                content: 'Please provide a valid user ID or mention, such as ?pumpkinmask @user.',
                allowedMentions: { repliedUser: false }
            });
        }
        if (!image && !target) {
            return message.reply({
                content: 'Attach an image to ?pumpkinmask, or use ?pumpkinmask @user / user ID for a server avatar.',
                allowedMentions: { repliedUser: false }
            });
        }
        const response = await message.reply({
            content: GENERATING,
            allowedMentions: { repliedUser: false }
        });
        if (userId) {
            try {
                if (!message.guild) {
                    return response.edit({ content: 'Server avatars can only be used in a server.' });
                }
                const member = await message.guild.members.fetch({ user: userId[1] || userId[2], force: true });
                image = { url: member.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true }) };
            } catch (error) {
                console.error('Failed to fetch pumpkin mask server avatar:', error);
                return response.edit({
                    content: error.code === 10007 || error.code === 10013
                        ? 'That user could not be found in this server.'
                        : 'I could not load that server avatar right now. Please try again later.'
                });
            }
        }
        return generateMask(image, payload => response.edit(payload));
    },
    async executeInteraction({ interaction }) {
        await interaction.deferReply();
        await interaction.editReply({ content: GENERATING });
        const image = interaction.options.getAttachment('image', true);
        return generateMask(image, payload => interaction.editReply(payload));
    }
};
