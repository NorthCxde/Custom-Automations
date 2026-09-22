const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
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

async function validateTrelloCredentials(key, token) {
    const params = new URLSearchParams({ key, token, fields: 'fullName,username' });
    const response = await fetch(`https://api.trello.com/1/members/me?${params}`);
    if (!response.ok) return null;
    return response.json();
}

module.exports = {
    name: 'register',
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Store your Trello API key and token.')
        .addStringOption(option =>
            option
                .setName('key')
                .setDescription('Your Trello API key')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('token')
                .setDescription('Your Trello API token')
                .setRequired(true)
        ),
    async executeInteraction({ interaction }) {
        try {
            const key = interaction.options.getString('key', true).trim();
            const token = interaction.options.getString('token', true).trim();

            if (!key || !token) {
                return interaction.reply({
                    content: 'Both a Trello key and token are required.',
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const trelloUser = await validateTrelloCredentials(key, token);
            if (!trelloUser) {
                return interaction.editReply('Those Trello credentials were rejected. Nothing was saved.');
            }

            const credentials = readCredentials();
            credentials[String(interaction.user.id)] = {
                key: encrypt(key),
                token: encrypt(token),
                trelloMemberId: String(trelloUser.id || ''),
                trelloUsername: String(trelloUser.username || ''),
                updatedAt: new Date().toISOString()
            };
            saveCredentials(credentials);

            return interaction.editReply('Your Trello account has been linked successfully.');
        } catch (err) {
            console.error('Failed to register Trello credentials:', err);
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({
                    content: 'I could not save your Trello credentials right now.',
                    flags: MessageFlags.Ephemeral
                });
            }
            return interaction.editReply('I could not save your Trello credentials right now.');
        }
    }
};
