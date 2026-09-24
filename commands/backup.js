const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');

function copyDirectory(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
        else fs.copyFileSync(sourcePath, destinationPath);
    }
}

module.exports = {
    name: 'backup',
    data: new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Create an immediate backup of the bot data.'),
    async executeInteraction({ interaction }) {
        const dataDirectory = path.join(__dirname, '..', 'data');
        const backupRoot = process.env.BACKUP_DIR
            ? path.resolve(process.env.BACKUP_DIR)
            : path.join(__dirname, '..', 'backups');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDirectory = path.join(backupRoot, `data-${timestamp}`);

        try {
            if (!fs.existsSync(dataDirectory)) {
                return interaction.reply({ content: 'The bot data directory does not exist.', flags: MessageFlags.Ephemeral });
            }

            copyDirectory(dataDirectory, backupDirectory);
            return interaction.reply({
                content: `Manual backup completed successfully.\nLocation: \`${backupDirectory}\``,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Manual backup failed:', error);
            return interaction.reply({
                content: 'The manual backup failed. Check the bot logs and backup directory permissions.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
