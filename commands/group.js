const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const GROUP_ID = '5783673';

async function fetchGroupData(groupId) {
    const response = await fetch(`https://groups.roblox.com/v1/groups/${groupId}`);
    if (!response.ok) {
        throw new Error(`Roblox request failed with status ${response.status}`);
    }

    const data = await response.json();
    return {
        name: String(data?.name || 'Customs Community'),
        memberCount: Number(data?.memberCount || 0),
        iconUrl: String(data?.icon || '')
    };
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function formatCountdown(secondsLeft) {
    const safe = Math.max(0, Number(secondsLeft) || 0);
    const mins = String(Math.floor(safe / 60)).padStart(2, '0');
    const secs = String(safe % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

function buildGroupEmbed(memberCount, iconUrl, secondsLeft) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Customs Community')
        .setDescription('Live group member count')
        .setThumbnail(iconUrl || null)
        .addFields(
            { name: 'Members', value: `**${formatCount(memberCount)}**`, inline: false }
        )
        .setFooter({ text: `Updating in ${formatCountdown(secondsLeft)}` })
        .setTimestamp();
}

module.exports = {
    name: 'group',
    data: new SlashCommandBuilder()
        .setName('group')
        .setDescription('Show the live member count for Customs Community.'),
    async executeInteraction({ interaction }) {
        try {
            await interaction.deferReply();
            let secondsLeft = 60;
            let currentData = await fetchGroupData(GROUP_ID);
            let embed = buildGroupEmbed(currentData.memberCount, currentData.iconUrl, secondsLeft);
            const message = await interaction.editReply({ embeds: [embed] });

            const refreshTimer = setInterval(async () => {
                try {
                    secondsLeft -= 1;
                    if (secondsLeft <= 0) {
                        currentData = await fetchGroupData(GROUP_ID);
                        secondsLeft = 60;
                    }

                    const updatedEmbed = buildGroupEmbed(currentData.memberCount, currentData.iconUrl, secondsLeft);
                    await message.edit({ embeds: [updatedEmbed] });
                } catch (err) {
                    console.error('Failed to refresh group member count:', err);
                }
            }, 1000);

            setTimeout(() => {
                clearInterval(refreshTimer);
            }, 1000 * 60 * 60 * 24);

            return message;
        } catch (err) {
            console.error('Failed to fetch group count:', err);
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({ content: 'I could not fetch the live member count right now.', ephemeral: true });
            }
            return interaction.editReply({ content: 'I could not fetch the live member count right now.' });
        }
    }
};
