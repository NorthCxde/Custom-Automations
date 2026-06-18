module.exports = {
    name: 'dm',
    description: 'Send a DM to a server member by mention or ID.',
    async execute({ client, message, args }) {
        if (!message.guild) return message.reply('This command must be used in a server channel.');
        if (!args[0] || args.length < 2) return message.reply('Usage: ?dm @user your message here');

        const targetId = args[0].replace(/[<@!>]/g, '');
        const dmText = args.slice(1).join(' ').trim();

        if (!/^[0-9]{17,19}$/.test(targetId)) {
            return message.reply('Please provide a valid user mention or user ID.');
        }
        if (!dmText) {
            return message.reply('Please provide a message to send.');
        }

        try {
            let targetUser = null;

            try {
                const member = await message.guild.members.fetch(targetId);
                targetUser = member.user;
            } catch {
                targetUser = await client.users.fetch(targetId);
            }

            if (!targetUser) {
                return message.reply('Could not find that user in the server.');
            }

            await targetUser.send(dmText);
            return message.channel.send(`DM sent to <@${targetId}>.`);
        } catch (error) {
            console.error(error);
            return message.reply('Unable to send a DM to that user. They may have DMs disabled.');
        }
    }
};
