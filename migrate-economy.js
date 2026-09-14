const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, 'data', 'economy.json');

function ensureDataFile() {
    if (!fs.existsSync(path.dirname(dataFile))) {
        fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    }
    if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, '{}', 'utf8');
    }
}

function migrateEconomyData() {
    ensureDataFile();
    try {
        const raw = fs.readFileSync(dataFile, 'utf8') || '{}';
        const data = JSON.parse(raw);

        // Check if any keys have the old format (guildId:userId)
        const oldFormatKeys = Object.keys(data).filter(key => key.includes(':'));
        
        if (oldFormatKeys.length === 0) {
            console.log('No old format keys found. Data is already migrated.');
            return;
        }

        const migratedData = {};

        // Migrate old format keys to new format
        for (const [key, value] of Object.entries(data)) {
            if (key.includes(':')) {
                // Old format: guildId:userId
                const userId = key.split(':').slice(1).join(':');
                
                // If this userId already exists in new format, merge the data
                if (migratedData[userId]) {
                    migratedData[userId].balance = Math.max(
                        migratedData[userId].balance || 0,
                        value.balance || 0
                    );
                    migratedData[userId].stats.earned = (migratedData[userId].stats.earned || 0) + (value.stats?.earned || 0);
                    migratedData[userId].stats.spent = (migratedData[userId].stats.spent || 0) + (value.stats?.spent || 0);
                    migratedData[userId].inventory = Array.from(new Set([
                        ...(migratedData[userId].inventory || []),
                        ...(value.inventory || [])
                    ]));
                } else {
                    migratedData[userId] = value;
                }
            } else {
                // Already in new format
                if (!migratedData[key]) {
                    migratedData[key] = value;
                }
            }
        }

        // Save migrated data
        fs.writeFileSync(dataFile, JSON.stringify(migratedData, null, 2), 'utf8');
        console.log(`✅ Migration complete! Migrated ${oldFormatKeys.length} old format keys to global format.`);
        console.log(`Total users in new format: ${Object.keys(migratedData).length}`);
    } catch (err) {
        console.error('❌ Migration failed:', err);
    }
}

migrateEconomyData();
