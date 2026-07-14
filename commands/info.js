const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function isNumeric(value) {
    return /^[0-9]+$/.test(value);
}

async function fetchRobloxUserById(id) {
    try {
        const response = await fetch(`https://users.roblox.com/v1/users/${id}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Roblox user lookup failed:', err);
        return null;
    }
}

async function fetchRobloxUserByUsername(username) {
    try {
        const response = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}`);
        if (!response.ok) return null;
        const body = await response.json();
        if (!Array.isArray(body.data) || body.data.length === 0) return null;
        return body.data[0];
    } catch (err) {
        console.error('Roblox username lookup failed:', err);
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
    name: 'search',
    description: 'Retrieve Bloxlink and Discord/Roblox linked information for a user',
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Retrieve Bloxlink and Discord/Roblox linked information for a user')
        .addUserOption(option =>
            option.setName('discord_user')
                .setDescription('Retrieve the Roblox information of this Discord user')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('roblox_user')
                .setDescription('Retrieve the Discord IDs linked to this Roblox username or ID')
                .setRequired(false)),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', ephemeral: true });
        }

        const discordUser = interaction.options.getUser('discord_user');
        const robloxUser = interaction.options.getString('roblox_user')?.trim();

        if (!discordUser && !robloxUser) {
            return interaction.reply({ content: 'Please provide either a Discord user or a Roblox username/ID.', ephemeral: true });
        }

        const apiKey = client.getBloxlinkApiKey ? client.getBloxlinkApiKey(interaction.guild.id) : null;
        if (!apiKey) {
            return interaction.reply({ content: 'Bloxlink API key is not configured for this server.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('Bloxlink Lookup')
            .setColor(0x000000)
            .setFooter({ text: 'Bloxlink data lookup' })
            .setTimestamp();

        if (discordUser) {
            embed.setAuthor({
                name: `${discordUser.tag} on Discord`,
                iconURL: discordUser.displayAvatarURL({ extension: 'png', size: 128 })
            });

            const discordInfo = [
                `Mention: <@${discordUser.id}>`,
                `ID: ${discordUser.id}`,
                `Created: ${discordUser.createdAt.toUTCString()}`
            ].join('\n');
            embed.addFields({ name: 'Discord Information', value: discordInfo, inline: false });

            let robloxId = null;
            let lookupResult = null;
            try {
                if (client.lookupLinkedRobloxAccount) {
                    lookupResult = await client.lookupLinkedRobloxAccount(interaction.guild.id, discordUser.id);
                    robloxId = lookupResult?.robloxId || null;
                } else if (client.getLinkedRobloxId) {
                    robloxId = await client.getLinkedRobloxId(interaction.guild.id, discordUser.id);
                }
            } catch (err) {
                console.error('Bloxlink discord-to-roblox lookup failed:', err);
            }

            if (!robloxId) {
                let statusText = 'No linked Roblox account found via Bloxlink.';
                if (lookupResult?.reason === 'missing-api-key') {
                    statusText = 'Bloxlink API key is missing for this server.';
                } else if (lookupResult?.reason === 'request-failed') {
                    statusText = `Bloxlink lookup failed for this server with status ${lookupResult.status}. Check the guild-specific API key for this guild.`;
                } else if (lookupResult?.reason === 'unrecognized-payload') {
                    statusText = 'Bloxlink returned an unexpected response shape for this server. Check bot logs for the raw payload.';
                } else if (lookupResult?.reason === 'network-error') {
                    statusText = 'Bloxlink lookup failed due to a network error. Check bot logs and try again.';
                }
                embed.addFields({ name: 'Bloxlink Status', value: statusText, inline: false });
            } else {
                const robloxUserData = await fetchRobloxUserById(robloxId);
                const robloxInfo = [
                    `Username: ${robloxUserData?.name ?? 'Unknown'}`,
                    `Display Name: ${robloxUserData?.displayName ?? 'Unknown'}`,
                    `ID: ${robloxId}`
                ].join('\n');
                embed.addFields({ name: 'Linked Roblox Account', value: robloxInfo, inline: false });

                const avatarUrl = await fetchRobloxAvatarUrl(robloxId);
                if (avatarUrl) {
                    embed.setThumbnail(avatarUrl);
                }
            }
        }

        if (robloxUser) {
            let resolvedRoblox = null;
            if (isNumeric(robloxUser)) {
                resolvedRoblox = await fetchRobloxUserById(robloxUser);
            } else {
                resolvedRoblox = await fetchRobloxUserByUsername(robloxUser);
            }

            if (!resolvedRoblox || !resolvedRoblox.id) {
                embed.addFields({ name: 'Roblox Lookup', value: `Could not resolve Roblox user: ${robloxUser}`, inline: false });
            } else {
                const resolvedId = String(resolvedRoblox.id);
                const robloxLabel = [
                    `Username: ${resolvedRoblox.name}`,
                    `Display Name: ${resolvedRoblox.displayName || 'No display name'}`,
                    `ID: ${resolvedId}`
                ].join('\n');
                embed.addFields({ name: 'Roblox Lookup', value: robloxLabel, inline: false });

                const avatarUrl = await fetchRobloxAvatarUrl(resolvedId);
                if (avatarUrl) {
                    embed.setThumbnail(avatarUrl);
                }

                try {
                    const response = await fetch(`https://api.blox.link/v4/public/guilds/${interaction.guild.id}/roblox-to-discord/${resolvedId}`, {
                        headers: { Authorization: apiKey }
                    });
                    if (response.status === 404) {
                        embed.addFields({ name: 'Bloxlink Status', value: 'No linked Discord accounts found for this Roblox user in this guild.', inline: false });
                    } else if (!response.ok) {
                        embed.addFields({ name: 'Bloxlink Status', value: `Lookup failed with status ${response.status}.`, inline: false });
                    } else {
                        const body = await response.json();
                        const discordIds = Array.isArray(body.discordIDs) ? body.discordIDs : [];
                        if (discordIds.length === 0) {
                            embed.addFields({ name: 'Bloxlink Status', value: 'No linked Discord accounts found for this Roblox user in this guild.', inline: false });
                        } else {
                            const discordLinks = discordIds.map(id => `<@${id}>`).join('\n');
                            embed.addFields({ name: 'Linked Discord Accounts', value: discordLinks, inline: false });
                        }
                    }
                } catch (err) {
                    console.error('Bloxlink roblox-to-discord lookup failed:', err);
                    embed.addFields({ name: 'Bloxlink Status', value: 'An error occurred while querying Bloxlink.', inline: false });
                }
            }
        }

        return interaction.reply({ embeds: [embed] });
    }
};
