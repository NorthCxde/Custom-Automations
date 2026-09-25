const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'trello-credentials.json');
const ENCRYPTION_VERSION = 1;
const TRUSTED_TRELLO_USER_IDS = new Set([
    '1486503754617323530',
    '1051287809132077136',
    '582686715702018078',
    '1335476704407191563'
]);

function getEncryptionKeys() {
    const secrets = [
        process.env.TRELLO_CREDENTIAL_SECRET,
        process.env.DISCORD_TOKEN,
        config.token
    ]
        .map(value => String(value || '').trim())
        .filter(Boolean);

    const uniqueSecrets = [...new Set(secrets)];
    if (!uniqueSecrets.length) throw new Error('Credential encryption secret is not configured.');
    return uniqueSecrets.map(secret => crypto.createHash('sha256').update(secret).digest());
}

function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKeys()[0], iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
        version: ENCRYPTION_VERSION,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        value: encrypted.toString('base64')
    };
}

function decrypt(payload) {
    if (!payload || payload.version !== ENCRYPTION_VERSION) return null;
    for (const key of getEncryptionKeys()) {
        try {
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                key,
                Buffer.from(payload.iv, 'base64')
            );
            decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
            return Buffer.concat([
                decipher.update(Buffer.from(payload.value, 'base64')),
                decipher.final()
            ]).toString('utf8');
        } catch {}
    }
    return null;
}

function readCredentials() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CREDENTIALS_FILE)) return {};
    try {
        const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8') || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function saveCredentials(credentials) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
}

function getRegisteredCredentials(discordUserId) {
    const stored = readCredentials()[String(discordUserId)];
    if (!stored) return null;
    try {
        const key = decrypt(stored.key);
        const token = decrypt(stored.token);
        if (!key || !token) return null;
        return { key, token };
    } catch {
        return null;
    }
}

function getOwnerCredentials() {
    const ownerCredentials = getRegisteredCredentials('1486503754617323530');
    if (ownerCredentials) return ownerCredentials;

    const apiKey = String(config.trelloApiKey || process.env.TRELLO_API_KEY || '').trim();
    const token = String(config.trelloToken || process.env.TRELLO_TOKEN || '').trim();
    if (apiKey && token) return { key: apiKey, token };
    return null;
}

function getEffectiveCredentials(discordUserId) {
    const normalizedId = String(discordUserId || '').trim();
    const directCredentials = getRegisteredCredentials(normalizedId);
    if (directCredentials) return directCredentials;

    if (!TRUSTED_TRELLO_USER_IDS.has(normalizedId)) return null;
    return getOwnerCredentials();
}

module.exports = {
    encrypt,
    getRegisteredCredentials,
    getEffectiveCredentials,
    readCredentials,
    saveCredentials,
    CREDENTIALS_FILE,
    TRUSTED_TRELLO_USER_IDS
};
