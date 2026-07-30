const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');

const ASSET_DIR = path.join(__dirname, '..', 'assets', 'profilebeta');
const BACKGROUND_PATH = path.join(ASSET_DIR, 'background.png');

const CARD_LAYOUT = {
    avatar: { x: 111, y: 98, size: 250 },
    username: { x: 330, y: 147, maxWidth: 860, size: 64, color: '#DEE2EA' },
    userId: { x: 330, y: 227, maxWidth: 860, size: 56, color: '#A7ADB9' },
    badges: { y: 154, size: 48, gap: 10, offsetAfterName: 14 }
};

const BADGE_CONFIG = {
    OWNER: {
        roleIds: ['944796064207220801'],
        fileName: 'owner-badge.png'
    },
    HEAD: {
        roleIds: ['1178953035230236742', '944796064207220801'],
        fileName: 'head-badge.png'
    },
    MODERATOR: {
        roleIds: ['1006267938543771648', '944796064207220801', '1178953035230236742', '1217365422501003284'],
        fileName: 'moderator-badge.png'
    },
    HONORARY: {
        roleIds: ['1191552089105645619'],
        fileName: 'honorary-badge.png'
    },
    VAOSPY_PLUS: {
        roleIds: ['1203916959079600169'],
        fileName: 'vaospy-badge.png'
    },
    RESPECTED_MEMBER: {
        roleIds: ['981706392010371072'],
        fileName: 'respectedmember-badge.png'
    },
    BOOSTER: {
        roleIds: ['978455981111537736'],
        fileName: 'booster-badge.png'
    },
    MEMBER: {
        roleIds: ['1052808144662827061'],
        fileName: 'member-badge.png'
    }
};

const badgeCache = new Map();
let cachedBackgroundImage = null;

async function fetchImageBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image (${response.status})`);
    }
    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
}

async function loadBackgroundImage() {
    if (!cachedBackgroundImage) {
        cachedBackgroundImage = await loadImage(BACKGROUND_PATH);
    }
    return cachedBackgroundImage;
}

async function loadBadgeImage(fileName) {
    if (badgeCache.has(fileName)) {
        return badgeCache.get(fileName);
    }

    const img = await loadImage(path.join(ASSET_DIR, fileName));
    badgeCache.set(fileName, img);
    return img;
}

function getBadgeFileNames(member) {
    if (!member) return [];
    const files = [];

    for (const cfg of Object.values(BADGE_CONFIG)) {
        if (cfg.roleIds.some((roleId) => member.roles.cache.has(roleId))) {
            files.push(cfg.fileName);
        }
    }

    return files.slice(0, 8);
}

function drawCircularImage(ctx, image, x, y, size) {
    const radius = size / 2;
    const centerX = x + radius;
    const centerY = y + radius;

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
}

async function renderProfileBetaCard({ user, member }) {
    const background = await loadBackgroundImage();
    const canvas = createCanvas(background.width, background.height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(background, 0, 0, background.width, background.height);

    const avatarBuffer = await fetchImageBuffer(user.displayAvatarURL({ extension: 'png', size: 512 }));
    const avatarImage = await loadImage(avatarBuffer);
    drawCircularImage(ctx, avatarImage, CARD_LAYOUT.avatar.x, CARD_LAYOUT.avatar.y, CARD_LAYOUT.avatar.size);

    const displayName = String(member?.displayName || user.username || 'Unknown').trim();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = CARD_LAYOUT.username.color;
    ctx.font = `700 ${CARD_LAYOUT.username.size}px sans-serif`;
    ctx.fillText(displayName, CARD_LAYOUT.username.x, CARD_LAYOUT.username.y, CARD_LAYOUT.username.maxWidth);

    const nameWidth = ctx.measureText(displayName).width;
    let badgeX = CARD_LAYOUT.username.x + Math.max(0, Math.round(nameWidth)) + CARD_LAYOUT.badges.offsetAfterName;
    const badgeY = CARD_LAYOUT.badges.y;
    const badgeSize = CARD_LAYOUT.badges.size;
    const badgeFiles = getBadgeFileNames(member);

    for (const badgeFile of badgeFiles) {
        const badge = await loadBadgeImage(badgeFile);
        if (badgeX + badgeSize > canvas.width - 24) break;
        ctx.drawImage(badge, badgeX, badgeY, badgeSize, badgeSize);
        badgeX += badgeSize + CARD_LAYOUT.badges.gap;
    }

    ctx.fillStyle = CARD_LAYOUT.userId.color;
    ctx.font = `700 ${CARD_LAYOUT.userId.size}px sans-serif`;
    ctx.fillText(`ID: ${user.id}`, CARD_LAYOUT.userId.x, CARD_LAYOUT.userId.y, CARD_LAYOUT.userId.maxWidth);

    if (typeof canvas.encode === 'function') {
        return await canvas.encode('png');
    }
    if (typeof canvas.toBuffer === 'function') {
        return canvas.toBuffer('image/png');
    }
    throw new Error('No supported canvas buffer export method found.');
}

module.exports = {
    name: 'profilebeta',
    description: 'Show an advanced Discord profile card for testing.',
    data: new SlashCommandBuilder()
        .setName('profilebeta')
        .setDescription('Show an advanced Discord profile card for testing.')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to view (defaults to yourself)')
                .setRequired(false)
        ),
    contextData: null,
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', flags: MessageFlags.Ephemeral });
        }

        const user = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        try {
            const cardBuffer = await renderProfileBetaCard({ user, member });
            const file = new AttachmentBuilder(cardBuffer, { name: 'profilebeta-card.png' });
            return interaction.reply({ files: [file], flags: MessageFlags.Ephemeral });
        } catch (err) {
            console.error('[profilebeta] render failed:', err);
            return interaction.reply({
                content: `Profile beta card failed to render: ${err.message || 'Unknown error'}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
