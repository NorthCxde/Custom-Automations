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
        memberCount: Number(data?.memberCount || 0)
    };
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function buildGroupEmbed(memberCount) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Customs Community')
        .setDescription('Live group member count')
        .addFields(
            { name: 'Members', value: `**${formatCount(memberCount)}**`, inline: false }
        )
        .setFooter({ text: 'Updated every 60 seconds' })
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
            const initialData = await fetchGroupData(GROUP_ID);
            const embed = buildGroupEmbed(initialData.memberCount);
            const message = await interaction.editReply({ embeds: [embed] });

            const refreshTimer = setInterval(async () => {
                try {
                    const freshData = await fetchGroupData(GROUP_ID);
                    const updatedEmbed = buildGroupEmbed(freshData.memberCount);
                    await message.edit({ embeds: [updatedEmbed] });
                } catch (err) {
                    console.error('Failed to refresh group member count:', err);
                }
            }, 60000);

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
