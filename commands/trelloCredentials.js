const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'trello-credentials.json');
const ENCRYPTION_VERSION = 1;

function getEncryptionKey() {
    const secret = String(process.env.TRELLO_CREDENTIAL_SECRET || process.env.DISCORD_TOKEN || config.token || '').trim();
    if (!secret) throw new Error('Credential encryption secret is not configured.');
    return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
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
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        getEncryptionKey(),
        Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(payload.value, 'base64')),
        decipher.final()
    ]).toString('utf8');
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

module.exports = {
    encrypt,
    getRegisteredCredentials,
    readCredentials,
    saveCredentials,
    CREDENTIALS_FILE
};
