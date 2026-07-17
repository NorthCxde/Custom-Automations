const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    description: 'Ping command',
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency.'),
    async execute({ message }) {
        const sent = await message.channel.send('Pinging...');
        await sent.edit(`Pong! Latency: ${sent.createdTimestamp - message.createdTimestamp}ms`);
    },
    async executeInteraction({ interaction }) {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        await interaction.editReply({ content: `Pong! Latency: ${latency}ms` });
    }
};
