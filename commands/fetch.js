const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { extractVideoLinks, REPORT_CHANNEL_ID } = require('../lib/video-age');
const { repostVideo } = require('../lib/video-repost');
const FETCHING = 'Fetching... <a:Loading:1564411829290008737>';

function validationError(client, guild, member, userId, channel) {
    if (!guild) return 'This command must be used in a server.';
    const allowedRoles = client.getAllowedRoleIds(guild.id);
    const hasRole = member?.roles?.cache
        ? member.roles.cache.some(role => allowedRoles?.has(role.id))
        : Array.isArray(member?.roles) && member.roles.some(id => allowedRoles?.has(id));
    if (!client.hardcodedAdmins.has(String(userId)) && !hasRole) {
        return 'Only members with roles allowed through /perms or bot admins can fetch evidence.';
    }
    if (!channel?.isThread?.() || channel.parentId !== REPORT_CHANNEL_ID) {
        return 'Use this command inside an exploiter-report thread.';
    }
    return null;
}

function reply(message, content) {
    return message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
}

module.exports = {
    name: 'fetch',
    description: 'Save video evidence from a replied-to message.',
    data: new SlashCommandBuilder()
        .setName('fetch')
        .setDescription('Download and save video evidence in this report thread.')
        .addStringOption(option => option
            .setName('link')
            .setDescription('A TikTok, YouTube, Medal or Streamable video link')
            .setRequired(true)),
    async execute({ client, message }) {
        const error = validationError(client, message.guild, message.member, message.author.id, message.channel);
        if (error) return reply(message, error);
        if (!message.reference?.messageId) {
            return reply(message, 'Reply to the message containing the video link with ?fetch.');
        }
        let source;
        try {
            source = await message.fetchReference();
        } catch (error) {
            console.error(`Failed to read fetch source for message ${message.id}:`, error);
            return reply(message, 'Could not read the replied-to message. Check that it still exists and the bot can read its history.');
        }
        if (source.channelId !== message.channelId) {
            return reply(message, 'Reply to a message in this report thread.');
        }
        const links = extractVideoLinks(source);
        if (!links.length) {
            return reply(message, 'The replied-to message has no supported TikTok, YouTube, Medal or Streamable video links.');
        }
        for (const link of links) {
            const progress = await reply(source, FETCHING);
            const result = await repostVideo({
                id: source.id,
                guild: message.guild,
                reply: payload => progress.edit(payload)
            }, link);
            if (result === 'already_saved') {
                await progress.edit({ content: `This clip has already been saved for that message: <${link}>` });
            }
            if (result === 'in_progress') {
                await progress.edit({ content: 'This clip is already being fetched for that message.' });
            }
        }
    },
    async executeInteraction({ client, interaction }) {
        const error = validationError(client, interaction.guild, interaction.member, interaction.user.id, interaction.channel);
        if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        const input = interaction.options.getString('link', true).trim();
        const links = extractVideoLinks({ content: input });
        if (!URL.canParse(input) || links.length !== 1) {
            return interaction.reply({
                content: 'Enter one supported TikTok, YouTube, Medal or Streamable video URL in the link option.',
                flags: MessageFlags.Ephemeral
            });
        }
        await interaction.deferReply();
        await interaction.editReply({ content: FETCHING, allowedMentions: { parse: [] } });
        const result = await repostVideo({
            id: interaction.id,
            guild: interaction.guild,
            reply: payload => interaction.editReply(payload)
        }, links[0]);
        if (result === 'already_saved' || result === 'in_progress') {
            await interaction.editReply({ content: 'This fetch request has already been processed or is in progress.' });
        }
    }
};
