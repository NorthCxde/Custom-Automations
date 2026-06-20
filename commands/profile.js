const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

async function fetchRobloxUserById(id) {
    try {
        const response = await fetch(`https://users.roblox.com/v1/users/${id}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Roblox profile lookup failed:', err);
        return null;
    }
}

async function fetchRobloxAvatarUrl(userId) {
    try {
        const response = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
        if (!response.ok) return null;
        const body = await response.json();
        return body.data?.[0]?.imageUrl || null;
    } catch (err) {
        console.error('Roblox avatar lookup failed:', err);
        return null;
    }
}

module.exports = {
    name: 'profile',
    description: 'Show Discord profile details and linked Roblox account details for a user.',
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Show Discord profile details and linked Roblox account details for a user.')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to view (defaults to yourself)')
                .setRequired(false)
        ),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const user = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        let robloxId = null;
        try {
            if (client.getLinkedRobloxId) {
                robloxId = await client.getLinkedRobloxId(interaction.guild.id, user.id);
            }
        } catch (err) {
            console.error('Failed to get linked Roblox ID for profile command:', err);
        }

        let robloxUser = null;
        let robloxAvatarUrl = null;
        if (robloxId) {
            robloxUser = await fetchRobloxUserById(robloxId);
            robloxAvatarUrl = await fetchRobloxAvatarUrl(robloxId);
        }

        const discordLines = [
            `Mention: <@${user.id}>`,
            `Tag: ${user.tag}`,
            `ID: ${user.id}`,
            `Account Created: <t:${Math.floor(user.createdTimestamp / 1000)}:F>`
        ];

        if (member?.joinedTimestamp) {
            discordLines.push(`Joined Server: <t:${Math.floor(member.joinedTimestamp / 1000)}:F>`);
        }

        const robloxLines = robloxId
            ? [
                `Linked: Yes`,
                `Username: ${robloxUser?.name || 'Unknown'}`,
                `Display Name: ${robloxUser?.displayName || 'Unknown'}`,
                `Roblox ID: ${robloxId}`,
                `Profile: https://www.roblox.com/users/${robloxId}/profile`
            ]
            : [
                'Linked: No',
                'No Roblox account found for this user in Bloxlink.'
            ];

        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('User Profile')
            .setAuthor({
                name: `${user.tag}`,
                iconURL: user.displayAvatarURL({ extension: 'png', size: 256 })
            })
            .addFields(
                { name: 'Discord', value: discordLines.join('\n'), inline: false },
                { name: 'Roblox', value: robloxLines.join('\n'), inline: false }
            )
            .setTimestamp();

        if (robloxAvatarUrl) {
            embed.setThumbnail(robloxAvatarUrl);
        }

        return interaction.reply({ embeds: [embed], ephemeral: false });
    }
};
