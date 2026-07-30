const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');

const ASSET_DIR = path.join(__dirname, '..', 'assets', 'profilebeta');
const BACKGROUND_PATH = path.join(ASSET_DIR, 'background.png');

const CARD_LAYOUT = {
    avatar: { x: 111, y: 65, size: 250 },
    username: { x: 388, y: 114, maxWidth: 800, size: 64, color: '#DEE2EA' },
    userId: { x: 388, y: 194, maxWidth: 800, size: 56, color: '#A7ADB9' },
    badges: { size: 48, gap: 10, offsetAfterName: 12 }
};

const GRID_LAYOUT = {
    leftPadding: 72,
    rightPadding: 72,
    contentGap: 28,
    headerBottomY: 282
};

// Output dimensions — match new background aspect ratio (1856x841 → ~940x426)
const OUTPUT_WIDTH = 940;
const OUTPUT_HEIGHT = Math.round(940 * (841 / 1856)); // ≈ 426

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
let cachedBackgroundPath = null;

async function fetchImageBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image (${response.status})`);
    }
    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
}

async function loadBackgroundImage() {
    if (!cachedBackgroundImage || cachedBackgroundPath !== BACKGROUND_PATH) {
        cachedBackgroundImage = await loadImage(BACKGROUND_PATH);
        cachedBackgroundPath = BACKGROUND_PATH;
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

function drawDebugGuides(ctx, canvas, zones) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 200, 0.5)';
    ctx.lineWidth = 2;

    ctx.strokeRect(zones.avatar.x, zones.avatar.y, zones.avatar.w, zones.avatar.h);
    ctx.strokeRect(zones.text.x, zones.text.y, zones.text.w, zones.text.h);

    ctx.strokeStyle = 'rgba(255, 200, 0, 0.45)';
    ctx.beginPath();
    ctx.moveTo(0, GRID_LAYOUT.headerBottomY);
    ctx.lineTo(canvas.width, GRID_LAYOUT.headerBottomY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(130, 160, 255, 0.25)';
    for (let x = 0; x <= canvas.width; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    ctx.restore();
}

function drawContainedImage(ctx, image, x, y, boxSize) {
    const sourceWidth = Number(image.width) || boxSize;
    const sourceHeight = Number(image.height) || boxSize;
    const scale = Math.min(boxSize / sourceWidth, boxSize / sourceHeight);
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
    const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
    const drawX = x + Math.floor((boxSize - drawWidth) / 2);
    const drawY = y + Math.floor((boxSize - drawHeight) / 2);

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

async function renderProfileBetaCard({ user, member, debugGrid = false }) {
    const background = await loadBackgroundImage();
    const canvas = createCanvas(background.width, background.height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(background, 0, 0, background.width, background.height);

    const avatarBuffer = await fetchImageBuffer(user.displayAvatarURL({ extension: 'png', size: 512 }));
    const avatarImage = await loadImage(avatarBuffer);
    drawCircularImage(ctx, avatarImage, CARD_LAYOUT.avatar.x, CARD_LAYOUT.avatar.y, CARD_LAYOUT.avatar.size);

    const textStartX = Math.max(
        CARD_LAYOUT.username.x,
        CARD_LAYOUT.avatar.x + CARD_LAYOUT.avatar.size + GRID_LAYOUT.contentGap
    );
    const textRightX = canvas.width - GRID_LAYOUT.rightPadding;
    const textMaxWidth = Math.max(120, Math.min(CARD_LAYOUT.username.maxWidth, textRightX - textStartX));

    const displayName = String(member?.displayName || user.username || 'Unknown').trim();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = CARD_LAYOUT.username.color;
    ctx.font = `700 ${CARD_LAYOUT.username.size}px sans-serif`;
    ctx.fillText(displayName, textStartX, CARD_LAYOUT.username.y, textMaxWidth);

    const nameWidth = Math.min(ctx.measureText(displayName).width, textMaxWidth);
    let badgeX = textStartX + Math.max(0, Math.round(nameWidth)) + CARD_LAYOUT.badges.offsetAfterName;
    const badgeSize = CARD_LAYOUT.badges.size;
    const badgeY = CARD_LAYOUT.username.y + Math.floor((CARD_LAYOUT.username.size - badgeSize) / 2);
    const badgeFiles = getBadgeFileNames(member);

    for (const badgeFile of badgeFiles) {
        const badge = await loadBadgeImage(badgeFile);
        if (badgeX + badgeSize > textRightX) break;
        drawContainedImage(ctx, badge, badgeX, badgeY, badgeSize);
        badgeX += badgeSize + CARD_LAYOUT.badges.gap;
    }

    ctx.fillStyle = CARD_LAYOUT.userId.color;
    ctx.font = `700 ${CARD_LAYOUT.userId.size}px sans-serif`;
    const idMaxWidth = Math.max(120, Math.min(CARD_LAYOUT.userId.maxWidth, textRightX - textStartX));
    ctx.fillText(`ID: ${user.id}`, textStartX, CARD_LAYOUT.userId.y, idMaxWidth);

    if (debugGrid) {
        drawDebugGuides(ctx, canvas, {
            avatar: {
                x: CARD_LAYOUT.avatar.x,
                y: CARD_LAYOUT.avatar.y,
                w: CARD_LAYOUT.avatar.size,
                h: CARD_LAYOUT.avatar.size
            },
            text: {
                x: textStartX,
                y: CARD_LAYOUT.username.y,
                w: textMaxWidth,
                h: GRID_LAYOUT.headerBottomY - CARD_LAYOUT.username.y
            }
        });
    }

    // Scale full source canvas down to compact output size
    const outputCanvas = createCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT);
    const outputCtx = outputCanvas.getContext('2d');
    outputCtx.drawImage(canvas, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    if (typeof outputCanvas.encode === 'function') {
        return await outputCanvas.encode('png');
    }
    if (typeof outputCanvas.toBuffer === 'function') {
        return outputCanvas.toBuffer('image/png');
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
        )
        .addBooleanOption(option =>
            option
                .setName('debuggrid')
                .setDescription('Show debug guides for layout tuning')
                .setRequired(false)
        ),
    contextData: null,
    async executeInteraction({ client, interaction }) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command must be used in a server channel.', flags: MessageFlags.Ephemeral });
        }

        const user = interaction.options.getUser('user') || interaction.user;
        const debugGrid = interaction.options.getBoolean('debuggrid') || false;
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        try {
            const cardBuffer = await renderProfileBetaCard({ user, member, debugGrid });
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
