const {
    SlashCommandBuilder,
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    EmbedBuilder,
    MessageFlags,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle
} = require('discord.js');

const BADGE_CONFIG = {
    OWNER: {
        roleIds: ['944796064207220801'],
        emoji: '<:Owner:1518755754948034721>'
    },
    HEAD: {
        roleIds: ['1178953035230236742', '944796064207220801'],
        emoji: '<:Head:1518757566031859883>'
    },
    MODERATOR: {
        roleIds: ['1006267938543771648', '944796064207220801', '1178953035230236742', '1217365422501003284'],
        emoji: '<:Staff:1518753622618407062>'
    },
    HONORARY: {
        roleIds: ['1191552089105645619'],
        emoji: '<:Honorary:1518765957257105492>'
    },
    VAOSPY_PLUS: {
        roleIds: ['1203916959079600169'],
        emoji: '<:VaoSPY:1518760819330912268>'
    },
    RESPECTED_MEMBER: {
        roleIds: ['981706392010371072'],
        emoji: '<:RespectedMember:1518764326599524493>'
    },
    BOOSTER: {
        roleIds: ['978455981111537736'],
        emoji: '<:Booster:1518760430749876334>'
    },
    MEMBER: {
        roleIds: ['1052808144662827061'],
        emoji: '<:Member:1518763772922298398>'
    }
};

function getBadges(member) {
    if (!member) return '';
    const badges = [];
    
    if (BADGE_CONFIG.OWNER.roleIds.some(roleId => member.roles.cache.has(roleId))) {
        badges.push(BADGE_CONFIG.OWNER.emoji);
    }
    
    if (BADGE_CONFIG.HEAD.roleIds.some(roleId => member.roles.cache.has(roleId))) {
        badges.push(BADGE_CONFIG.HEAD.emoji);
    }
    
    if (BADGE_CONFIG.MODERATOR.roleIds.some(roleId => member.roles.cache.has(roleId))) {
        badges.push(BADGE_CONFIG.MODERATOR.emoji);
    }

    if (BADGE_CONFIG.HONORARY.roleIds.some(roleId => member.roles.cache.has(roleId))) {
        badges.push(BADGE_CONFIG.HONORARY.emoji);
    }

    if (BADGE_CONFIG.VAOSPY_PLUS.roleIds.some(roleId => member.roles.cache.has(roleId))) {
        badges.push(BADGE_CONFIG.VAOSPY_PLUS.emoji);
    }

    if (BADGE_CONFIG.RESPECTED_MEMBER.roleIds.some(roleId => member.roles.cache.has(roleId))) {
        badges.push(BADGE_CONFIG.RESPECTED_MEMBER.emoji);
    }
    
    if (BADGE_CONFIG.BOOSTER.roleIds.some(roleId => member.roles.cache.has(roleId))) {
        badges.push(BADGE_CONFIG.BOOSTER.emoji);
    }

    if (BADGE_CONFIG.MEMBER.roleIds.some(roleId => member.roles.cache.has(roleId))) {
        badges.push(BADGE_CONFIG.MEMBER.emoji);
    }
    
    return badges.slice(0, 8).join(' ');
}

function formatRoles(member) {
    if (!member?.roles?.cache) return 'None';
    const roles = member.roles.cache
        .filter(role => role.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map(role => role.toString());

    if (!roles.length) return 'None';
    if (roles.length <= 8) return roles.join(' ');
    return `${roles.slice(0, 8).join(' ')} (+${roles.length - 8} more)`;
}

module.exports = {
    name: 'profile',
    description: 'Show an advanced Discord profile card for a user.',
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Show an advanced Discord profile card for a user.')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to view (defaults to yourself)')
                .setRequired(false)
        ),
    contextData: new ContextMenuCommandBuilder()
        .setName('profile')
        .setType(ApplicationCommandType.Message),
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', flags: MessageFlags.Ephemeral });
        }

        let user = interaction.user;
        if (interaction.isChatInputCommand()) {
            user = interaction.options.getUser('user') || interaction.user;
        } else if (interaction.isMessageContextMenuCommand()) {
            user = interaction.targetMessage?.author || interaction.user;
        }

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        const bannerUrl = user.bannerURL({ extension: 'png', size: 1024 });
        const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 512 });
        const profileColor = 0x1f2937;

        const accountSummary = [
            `**${user.tag}** • ${user.id}`,
            `Created <t:${Math.floor(user.createdTimestamp / 1000)}:R>`
        ].join('\n');

        const serverSummary = member
            ? [
                `Joined <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
                `Role: ${member.roles.highest?.toString() || 'None'}`,
                member.premiumSinceTimestamp ? `Boosting since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>` : null
            ].filter(Boolean).join('\n')
            : 'Not a server member';

        const badges = getBadges(member);
        const titleWithBadges = badges 
            ? `${member?.displayName || user.username} ${badges}`
            : member?.displayName || user.username;

        const embed = new EmbedBuilder()
            .setColor(profileColor)
            .setTitle(titleWithBadges)
            .setAuthor({
                name: user.username,
                iconURL: avatarUrl
            })
            .setThumbnail(avatarUrl)
            .addFields(
                { name: 'Account', value: accountSummary, inline: true },
                { name: 'Server', value: serverSummary, inline: true },
                { name: 'Roles', value: formatRoles(member) || 'None', inline: false }
            )
            .setFooter({ text: `${interaction.user.tag}` })
            .setTimestamp();

        if (bannerUrl) {
            embed.setImage(bannerUrl);
        }

        const components = [];
        if (client.isMemberAllowed && client.isMemberAllowed(interaction.member)) {
            const banButton = new ButtonBuilder()
                .setCustomId(`profile-ban-user-${user.id}`)
                .setLabel('Ban User')
                .setStyle(ButtonStyle.Danger);
            components.push(new ActionRowBuilder().addComponents(banButton));
        }

        return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }
};
