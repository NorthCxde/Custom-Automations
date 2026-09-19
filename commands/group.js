const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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
        iconUrl: typeof data?.icon === 'string' && data.icon.trim() ? data.icon.trim() : undefined
    };
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function formatCountdown(secondsLeft) {
    const safe = Math.max(0, Number(secondsLeft) || 0);
    const displaySeconds = Math.max(1, safe);
    return `Updating in ${displaySeconds} second${displaySeconds === 1 ? '' : 's'}`;
}

function buildGroupEmbed(memberCount, iconUrl, secondsLeft) {
    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setDescription('Live group member count')
        .addFields(
            { name: 'Members', value: `**${formatCount(memberCount)}**`, inline: false }
        )
        .setFooter({ text: formatCountdown(secondsLeft) })
        .setTimestamp();

    if (iconUrl) {
        embed.setAuthor({
            name: 'Customs Community',
            iconURL: iconUrl
        });
    } else {
        embed.setAuthor({ name: 'Customs Community' });
    }

    return embed;
}

function buildGroupComponents() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Group')
            .setStyle(ButtonStyle.Link)
            .setURL('https://www.roblox.com/communities/5783673/Customs-Community#!/about')
    );
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
            const components = [buildGroupComponents()];
            const message = await interaction.editReply({ embeds: [embed], components });

            const refreshTimer = setInterval(async () => {
                try {
                    if (secondsLeft <= 0) {
                        currentData = await fetchGroupData(GROUP_ID);
                        secondsLeft = 60;
                    } else {
                        secondsLeft -= 1;
                    }

                    const updatedEmbed = buildGroupEmbed(currentData.memberCount, currentData.iconUrl, secondsLeft);
                    await message.edit({ embeds: [updatedEmbed], components });
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
