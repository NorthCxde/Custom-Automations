const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const MUTE_ACTIONS  = ['Mute'];
const BAN_ACTIONS   = ['Ban', 'Temp Ban'];
const KICK_ACTIONS  = ['Kick'];
const WARN_ACTIONS  = ['Warn'];

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;

function countActions(logs, moderatorId, actionTypes, sinceMs) {
    const now = Date.now();
    return logs.filter(log => {
        if (String(log.moderatorId) !== String(moderatorId)) return false;
        if (!actionTypes.includes(log.action)) return false;
        if (sinceMs !== null) {
            const ts = new Date(log.timestamp).getTime();
            if (isNaN(ts) || now - ts > sinceMs) return false;
        }
        return true;
    }).length;
}

function buildModStatsEmbed(client, guildId, user, displayName, avatarUrl) {
    const logs = client.modLogs.get(guildId) || [];
    const uid  = user.id;

    // Check if there's an override for this user
    const hasOverrides = client.modStatsOverrides?.has(guildId) && client.modStatsOverrides.get(guildId).has(uid);
    const userOverrides = hasOverrides ? client.modStatsOverrides.get(guildId).get(uid) : {};
    
    let mutes7, mutes30, mutesAll;
    let bans7, bans30, bansAll;
    let kicks7, kicks30, kicksAll;
    let warns7, warns30, warnsAll;

    // For 7 days
    if (userOverrides['7d']) {
        mutes7 = userOverrides['7d'].mutes || 0;
        bans7 = userOverrides['7d'].bans || 0;
        kicks7 = userOverrides['7d'].kicks || 0;
        warns7 = userOverrides['7d'].warns || 0;
    } else {
        mutes7   = countActions(logs, uid, MUTE_ACTIONS,  MS_7D);
        bans7    = countActions(logs, uid, BAN_ACTIONS,   MS_7D);
        kicks7   = countActions(logs, uid, KICK_ACTIONS,  MS_7D);
        warns7   = countActions(logs, uid, WARN_ACTIONS,  MS_7D);
    }

    // For 30 days
    if (userOverrides['30d']) {
        mutes30 = userOverrides['30d'].mutes || 0;
        bans30 = userOverrides['30d'].bans || 0;
        kicks30 = userOverrides['30d'].kicks || 0;
        warns30 = userOverrides['30d'].warns || 0;
    } else {
        mutes30  = countActions(logs, uid, MUTE_ACTIONS,  MS_30D);
        bans30   = countActions(logs, uid, BAN_ACTIONS,   MS_30D);
        kicks30  = countActions(logs, uid, KICK_ACTIONS,  MS_30D);
        warns30  = countActions(logs, uid, WARN_ACTIONS,  MS_30D);
    }

    // For all time
    if (userOverrides['all']) {
        mutesAll = userOverrides['all'].mutes || 0;
        bansAll = userOverrides['all'].bans || 0;
        kicksAll = userOverrides['all'].kicks || 0;
        warnsAll = userOverrides['all'].warns || 0;
    } else {
        mutesAll = countActions(logs, uid, MUTE_ACTIONS,  null);
        bansAll  = countActions(logs, uid, BAN_ACTIONS,   null);
        kicksAll = countActions(logs, uid, KICK_ACTIONS,  null);
        warnsAll = countActions(logs, uid, WARN_ACTIONS,  null);
    }

    const total7   = mutes7   + bans7   + kicks7   + warns7;
    const total30  = mutes30  + bans30  + kicks30  + warns30;
    const totalAll = mutesAll + bansAll + kicksAll + warnsAll;

    return new EmbedBuilder()
        .setColor(0x4E5D94)
        .setAuthor({ name: displayName, iconURL: avatarUrl })
        .setTitle('Moderation Statistics')
        .addFields(
            { name: 'Mutes (last 7 days)',   value: String(mutes7),   inline: true },
            { name: 'Mutes (last 30 days)',  value: String(mutes30),  inline: true },
            { name: 'Mutes (all time)',       value: String(mutesAll), inline: true },

            { name: 'Bans (last 7 days)',    value: String(bans7),    inline: true },
            { name: 'Bans (last 30 days)',   value: String(bans30),   inline: true },
            { name: 'Bans (all time)',        value: String(bansAll),  inline: true },

            { name: 'Kicks (last 7 days)',   value: String(kicks7),   inline: true },
            { name: 'Kicks (last 30 days)',  value: String(kicks30),  inline: true },
            { name: 'Kicks (all time)',       value: String(kicksAll), inline: true },

            { name: 'Warns (last 7 days)',   value: String(warns7),   inline: true },
            { name: 'Warns (last 30 days)',  value: String(warns30),  inline: true },
            { name: 'Warns (all time)',       value: String(warnsAll), inline: true },

            { name: 'Total (last 7 days)',   value: String(total7),   inline: true },
            { name: 'Total (last 30 days)',  value: String(total30),  inline: true },
            { name: 'Total (all time)',       value: String(totalAll), inline: true }
        )
        .setFooter({ text: `ID: ${uid}` })
        .setTimestamp();
}

module.exports = {
    name: 'modstats',
    description: 'Get moderation statistics for a mod/admin (based on mod log entries).',
    data: new SlashCommandBuilder()
        .setName('modstats')
        .setDescription('Get moderation statistics for a mod/admin (based on mod log entries).')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('View this user\'s moderation statistics.')
                .setRequired(false)
        ),

    async execute({ client, message, args }) {
        if (!message.guild) return;

        const input = args[0];
        if (!input) {
            return message.reply('Usage: `?modstats <user ID or @mention>`');
        }

        const rawId = input.replace(/[<@!>]/g, '').trim();

        let member = await message.guild.members.fetch(rawId).catch(() => null);
        let user = member?.user ?? null;
        let displayName = member?.displayName ?? null;

        if (!user) {
            user = await client.users.fetch(rawId).catch(() => null);
            displayName = user?.username ?? null;
        }

        if (!user) {
            return message.reply(`Could not find user \`${rawId}\`.`);
        }

        displayName = displayName || user.username;
        const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });

        const embed = buildModStatsEmbed(client, message.guild.id, user, displayName, avatarUrl);
        await message.channel.send({ embeds: [embed] });
    },

    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', flags: MessageFlags.Ephemeral });
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        const displayName = member?.displayName || targetUser.username;
        const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });

        const embed = buildModStatsEmbed(client, interaction.guild.id, targetUser, displayName, avatarUrl);
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
