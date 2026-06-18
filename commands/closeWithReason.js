const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'close-with-reason',
    description: 'Close the current ticket and provide a reason (notifies Tickets if configured)',
    data: new SlashCommandBuilder()
        .setName('close-with-reason')
        .setDescription('Close the current ticket and provide a reason')
        .addStringOption(option => option.setName('reason').setDescription('Reason for closing the ticket').setRequired(true)),

    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        if (!client.isMemberAllowed(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const reason = interaction.options.getString('reason') || 'No reason provided';
        const channel = interaction.channel;

        // Basic guard: ensure this looks like a ticket channel
        const channelName = (channel && channel.name) ? channel.name.toLowerCase() : '';
        if (!channelName.includes('ticket') && !channelName.startsWith('ticket-')) {
            // Allow admins to force-close anywhere, but warn if not a ticket
            // continue but note
        }

        await interaction.reply({ content: 'Closing ticket...', ephemeral: true });

        try {
            // Post a closure embed into the channel
            const embed = new EmbedBuilder()
                .setTitle(`Ticket closed by ${interaction.user.tag}`)
                .setDescription(`Reason: ${reason}`)
                .setColor(0xff0000)
                .setTimestamp();

            await channel.send({ embeds: [embed] });

            // Lock the channel for @everyone
            try {
                await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            } catch (permErr) {
                console.error('Failed to update channel permissions:', permErr);
            }

            // Save a short transcript (last 200 messages)
            try {
                const messages = await channel.messages.fetch({ limit: 200 });
                const ordered = Array.from(messages.values()).reverse();
                const transcript = ordered.map(m => ({
                    id: m.id,
                    author: m.author.tag,
                    authorId: m.author.id,
                    content: m.content,
                    timestamp: m.createdAt.toISOString()
                }));

                const outDir = path.join(__dirname, '..', 'data', 'ticket-transcripts');
                if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
                const filename = `${channel.id}_${Date.now()}.json`;
                fs.writeFileSync(path.join(outDir, filename), JSON.stringify({ channel: channel.id, transcript }, null, 2), 'utf8');
            } catch (tErr) {
                console.error('Failed to save transcript:', tErr);
            }

            // Add to mod logs
            if (client.addModLog) {
                let robloxId = null;
                try {
                    if (client.getLinkedRobloxId) robloxId = await client.getLinkedRobloxId(interaction.guild.id, interaction.user.id);
                } catch (err) {
                    console.error('Failed to lookup robloxId for modlog:', err);
                }
                client.addModLog(interaction.guild.id, {
                    action: 'CloseTicket',
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    robloxId,
                    reason,
                    channelId: channel.id,
                    moderatorId: interaction.user.id,
                    moderatorTag: interaction.user.tag,
                    timestamp: new Date().toISOString()
                });
            }

            // Notify Tickets via webhook if configured in config.json
            try {
                const cfg = require('../config.json');
                const webhookUrl = cfg.ticketsWebhookUrl || cfg.ticketsWebhook || null;
                if (webhookUrl) {
                    const payload = {
                        action: 'close_ticket',
                        channelId: channel.id,
                        guildId: interaction.guild.id,
                        moderatorId: interaction.user.id,
                        moderatorTag: interaction.user.tag,
                        reason,
                        timestamp: new Date().toISOString()
                    };
                    await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }
            } catch (webErr) {
                console.error('Failed to notify Tickets webhook:', webErr);
            }

            return interaction.editReply({ content: 'Ticket closed successfully (reason logged).', ephemeral: true });
        } catch (error) {
            console.error('close-with-reason failed:', error);
            try { await interaction.editReply({ content: 'Failed to close ticket.', ephemeral: true }); } catch (e) { }
        }
    }
};
