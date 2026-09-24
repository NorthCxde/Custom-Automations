const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const BACKUP_ADMIN_ID = '1486503754617323530';

function copyDirectory(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    let fileCount = 0;
    let totalBytes = 0;
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            const nested = copyDirectory(sourcePath, destinationPath);
            fileCount += nested.fileCount;
            totalBytes += nested.totalBytes;
        } else {
            fs.copyFileSync(sourcePath, destinationPath);
            fileCount++;
            totalBytes += fs.statSync(sourcePath).size;
        }
    }
    return { fileCount, totalBytes };
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

module.exports = {
    name: 'backup',
    data: new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Create an immediate backup of the bot data.'),
    async executeInteraction({ interaction }) {
        if (interaction.user.id !== BACKUP_ADMIN_ID) {
            return interaction.reply({
                content: 'Only the designated backup administrator can use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

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

            const stats = copyDirectory(dataDirectory, backupDirectory);
            const locationMessage = [
                'Manual backup details:',
                `Location: \`${backupDirectory}\``,
                `Files copied: **${stats.fileCount}**`,
                `Data size: **${formatBytes(stats.totalBytes)}**`,
                `Created: **${new Date().toISOString()}**`
            ].join('\n');
            const statsCommand = interaction.client.slashCommands.get('stats') || require('./stats');
            const statsEmbed = interaction.guild
                ? await statsCommand.buildStatsEmbed(
                    interaction.client,
                    interaction.guild,
                    interaction.client.getModLogs(interaction.guild.id)
                )
                : null;
            const dmSent = await interaction.user.send({
                content: locationMessage,
                embeds: statsEmbed ? [statsEmbed] : []
            }).then(() => true).catch(() => false);

            return interaction.reply({
                content: dmSent
                    ? 'Manual backup completed successfully.'
                    : 'Manual backup completed successfully, but I could not send the backup location by DM. Please enable DMs from server members.',
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
