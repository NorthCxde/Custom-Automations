const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const MUTE_ACTIONS  = ['Mute'];
const BAN_ACTIONS   = ['Ban', 'Temp Ban'];
const KICK_ACTIONS  = ['Kick'];
const WARN_ACTIONS  = ['Warn'];

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;

function countActions(logs, moderatorId, actionTypes, sinceMs, now = Date.now(), resetAt = null) {
    return logs.filter(log => {
        if (log.source === 'trello_blacklist') return false;
        if (String(log.moderatorId) !== String(moderatorId)) return false;
        if (!actionTypes.includes(log.action)) return false;
        const timestamp = new Date(log.timestamp).getTime();
        if (resetAt !== null && (!Number.isFinite(timestamp) || timestamp <= resetAt)) return false;
        if (sinceMs !== null) {
            if (!Number.isFinite(timestamp) || now - timestamp > sinceMs) return false;
        }
        return true;
    }).length;
}

function getDiscordModstatsCounts(client, guildId, moderatorId, period = 'all', now = Date.now()) {
    const logs = client.modLogs.get(guildId) || [];
    const override = client.modStatsOverrides?.get(guildId)?.get(String(moderatorId))?.[period];
    const resetAt = override?.resetAt ? new Date(override.resetAt).getTime() : null;
    const sinceMs = period === '7d' ? MS_7D : period === '30d' ? MS_30D : null;
    const actionTypes = { mutes: MUTE_ACTIONS, bans: BAN_ACTIONS, kicks: KICK_ACTIONS, warns: WARN_ACTIONS };
    return Object.fromEntries(Object.entries(actionTypes).map(([metric, actions]) => {
        const baseline = Math.max(0, Number(override?.[metric]) || 0);
        if (override && resetAt === null) return [metric, baseline];
        return [metric, baseline + countActions(logs, moderatorId, actions, sinceMs, now, resetAt)];
    }));
}

function buildModStatsEmbed(client, guildId, user, displayName, avatarUrl) {
    const uid  = user.id;
    const { mutes: mutes7, bans: bans7, kicks: kicks7, warns: warns7 } = getDiscordModstatsCounts(client, guildId, uid, '7d');
    const { mutes: mutes30, bans: bans30, kicks: kicks30, warns: warns30 } = getDiscordModstatsCounts(client, guildId, uid, '30d');
    const { mutes: mutesAll, bans: bansAll, kicks: kicksAll, warns: warnsAll } = getDiscordModstatsCounts(client, guildId, uid);

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
    getDiscordModstatsCounts,
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
            const user = message.author;
            const displayName = message.member?.displayName || user.username;
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
            const embed = buildModStatsEmbed(client, message.guild.id, user, displayName, avatarUrl);
            await message.channel.send({ embeds: [embed] });
            return null;
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
