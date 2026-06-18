const { ChannelType } = require('discord.js');

module.exports = {
    name: 'read',
    description: 'List all channels in the guild',
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');

        const lines = message.guild.channels.cache
            .filter(ch => ch.type !== ChannelType.GuildCategory)
            .map(ch => `<#${ch.id}>`)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        if (lines.length === 0) return message.channel.send('No channels found.');

        const chunks = [];
        let cur = '';
        for (const line of lines) {
            if ((cur + '\n' + line).length > 1900) {
                chunks.push(cur);
                cur = line;
            } else {
                cur = cur ? cur + '\n' + line : line;
            }
        }
        if (cur) chunks.push(cur);

        for (const chunk of chunks) {
            await message.channel.send(chunk);
        }
    }
};
