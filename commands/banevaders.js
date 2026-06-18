const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const config = require('../config.json');

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

module.exports = {
    name: 'banevaders',
    description: 'Scan your server for users evading server bans via Bloxlink-linked Roblox accounts',
    data: new SlashCommandBuilder()
        .setName('banevaders')
        .setDescription('Check your server for users evading server bans'),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be run in a server.', ephemeral: true });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.BanMembers)) {
            return interaction.reply({ content: 'You need Ban Members permission to run this command.', ephemeral: true });
        }

        const apiKey = process.env.BLOXLINK_API_KEY || config.bloxlinkApiKey;
        if (!apiKey) {
            return interaction.reply({ content: 'Bloxlink API key is not configured. Set BLOXLINK_API_KEY or bloxlinkApiKey in config.json.', ephemeral: true });
        }

        await interaction.deferReply();

        let bans;
        try {
            bans = await interaction.guild.bans.fetch();
        } catch (err) {
            console.error('Failed to fetch guild bans:', err);
            return interaction.editReply({ content: 'Unable to fetch ban list for this guild.' });
        }

        if (!bans.size) {
            return interaction.editReply({ content: 'There are no banned users in this server to scan.' });
        }

        const bannedIds = new Set(Array.from(bans.keys()));
        let guildMembers;
        try {
            guildMembers = await interaction.guild.members.fetch();
        } catch (err) {
            console.error('Failed to fetch guild members:', err);
            guildMembers = interaction.guild.members.cache;
        }

        if (!guildMembers || !guildMembers.size) {
            return interaction.editReply({ content: 'Unable to resolve server members for this scan. Try again later or invite the bot with member intents enabled.' });
        }

        const activeRoblox = new Map();
        for (const member of guildMembers.values()) {
            if (member.user.bot) continue;
            try {
                if (client.getLinkedRobloxId) {
                    const robloxId = await client.getLinkedRobloxId(interaction.guild.id, member.user.id);
                    if (robloxId) {
                        activeRoblox.set(member.user.id, robloxId);
                    }
                }
            } catch (err) {
                console.error(`Failed to lookup Roblox ID for member ${member.user.id}:`, err);
            }
        }

        if (!activeRoblox.size) {
            return interaction.editReply({ content: 'No active Bloxlink-linked members were found in this server.' });
        }

        const robloxToMembers = new Map();
        for (const [userId, robloxId] of activeRoblox.entries()) {
            if (!robloxToMembers.has(robloxId)) {
                robloxToMembers.set(robloxId, []);
            }
            robloxToMembers.get(robloxId).push(userId);
        }

        const robloxMatches = [];
        for (const [robloxId, linkedMemberIds] of robloxToMembers.entries()) {
            try {
                const response = await fetch(`https://api.blox.link/v4/public/guilds/${interaction.guild.id}/roblox-to-discord/${robloxId}`, {
                    headers: { Authorization: apiKey }
                });
                if (!response.ok) continue;

                const body = await response.json();
                const discordIDs = Array.isArray(body.discordIDs) ? body.discordIDs : [];
                const bannedLinked = discordIDs.filter(id => bannedIds.has(id));
                const activeLinked = discordIDs.filter(id => guildMembers.has(id) && !bannedIds.has(id));

                if (!bannedLinked.length || !activeLinked.length) continue;

                const activeAccounts = activeLinked.map(id => {
                    const member = guildMembers.get(id);
                    return member ? `${member.user.tag} (<@${id}>)` : `<@${id}>`;
                });

                const bannedAccounts = bannedLinked.map(id => {
                    const banned = bans.get(id);
                    return banned?.user?.tag ? `${banned.user.tag} (<@${id}>)` : `<@${id}>`;
                });

                const robloxUserData = await fetchRobloxUserById(robloxId);
                robloxMatches.push({
                    robloxId,
                    robloxName: robloxUserData?.name || 'Unknown',
                    robloxDisplay: robloxUserData?.displayName || '',
                    activeAccounts,
                    bannedAccounts
                });
            } catch (err) {
                console.error(`Failed to fetch roblox-to-discord for ${robloxId}:`, err);
            }
        }

        if (!robloxMatches.length) {
            const noMatchEmbed = new EmbedBuilder()
                .setTitle('Ban Evaders')
                .setDescription('No ban evaders were found in your server. Congrats! 🎉')
                .setColor(0x00ff00)
                .setTimestamp();

            return interaction.editReply({ embeds: [noMatchEmbed] });
        }

        const description = 'The following users have been found to be ban evading in your server. This means that Bloxlink detected users banned from your server with Roblox accounts linked to active Discord users in your server. Use the dropdown below to Ban or Kick the detected alternative accounts.';
        const embed = new EmbedBuilder()
            .setTitle('Ban Evaders')
            .setDescription(description)
            .setColor(0xff0000)
            .setTimestamp();

        for (const match of robloxMatches.slice(0, 10)) {
            const title = `${match.robloxName}${match.robloxDisplay ? ` (${match.robloxDisplay})` : ''} — ${match.robloxId}`;
            embed.addFields({
                name: title,
                value: `Banned user(s): ${match.bannedAccounts.join(', ')}\nAlternative Discord user(s): ${match.activeAccounts.join(', ')}`,
                inline: false
            });
        }

        const actionUsers = new Map();
        for (const match of matches) {
            if (match.activeAccounts.length) {
                for (const activeId of match.activeAccounts.map(line => line.match(/<@!?([0-9]+)>/)?.[1]).filter(Boolean)) {
                    actionUsers.set(activeId, { id: activeId, tag: guildMembers.get(activeId)?.user.tag || `<@${activeId}>` });
                }
            }
        }

        const selectedUsers = Array.from(actionUsers.values());
        if (!selectedUsers.length) {
            return interaction.editReply({ content: 'No alternative accounts could be resolved for action selection.' });
        }

        const actionKey = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        client.addPendingModerationAction(actionKey, {
            type: 'banevaders',
            users: selectedUsers,
            moderatorId: interaction.user.id
        });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`banevaders_action:${actionKey}`)
                .setPlaceholder('Select an action to take')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions([
                    {
                        label: 'Ban',
                        description: 'Ban all detected alternative accounts',
                        value: 'ban'
                    },
                    {
                        label: 'Kick',
                        description: 'Kick all detected alternative accounts',
                        value: 'kick'
                    }
                ])
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
    }
};
