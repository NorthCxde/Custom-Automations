module.exports = {
    name: 'reload',
    description: 'Reload all command modules without restarting the bot.',
    async execute({ client, message, args }) {
        client.loadCommands();
        return message.channel.send(`Reloaded ${client.commands.size} command(s).`);
    }
};
