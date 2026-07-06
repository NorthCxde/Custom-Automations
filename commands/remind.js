const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const MAX_REMINDER_TEXT = 1000;
const MAX_TARGETS = 5;
const MIN_DELAY_MS = 5_000;
const MAX_DELAY_MS = 1000 * 60 * 60 * 24 * 365 * 2;

const TIME_EXAMPLES = [
    '10m',
    '1h',
    '2h 30m',
    '1d',
    '1d 2h',
    'in 45 minutes',
    'tomorrow 5pm'
];

const BASE_TIMEZONES = [
    'UTC',
    'EST',
    'CET',
    'GMT',
    'Asia/Tokyo',
    'Japan',
    'Europe/Berlin',
    'America/New_York',
    'US/Eastern',
    'US/Central',
    'Asia/Manila',
    'Europe/London',
    'Europe/Paris',
    'America/Los_Angeles',
    'Asia/Jakarta',
    'US/Pacific',
    'Asia/Kolkata',
    'America/Sao_Paulo',
    'Singapore',
    'Europe/Moscow',
    'America/Chicago'
];

function sanitizeText(value, max = MAX_REMINDER_TEXT) {
    return String(value || '').trim().slice(0, max);
}

function parseDurationMs(input) {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return null;

    const normalized = raw.replace(/^in\s+/, '');
    const regex = /(\d+)\s*(w|week|weeks|d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/g;

    let total = 0;
    let matched = false;
    let match;

    while ((match = regex.exec(normalized)) !== null) {
        matched = true;
        const value = Number(match[1]);
        const unit = match[2];
        if (!Number.isFinite(value) || value <= 0) continue;

        if (unit.startsWith('w')) total += value * 7 * 24 * 60 * 60 * 1000;
        else if (unit.startsWith('d')) total += value * 24 * 60 * 60 * 1000;
        else if (unit.startsWith('h')) total += value * 60 * 60 * 1000;
        else if (unit.startsWith('m')) total += value * 60 * 1000;
        else total += value * 1000;
    }

    if (!matched) return null;
    return total;
}

function parseTimeMs(timeRaw, timezoneRaw) {
    const now = Date.now();
    const durationMs = parseDurationMs(timeRaw);
    if (durationMs) {
        return now + durationMs;
    }

    const absoluteRaw = String(timeRaw || '').trim();
    if (!absoluteRaw) return null;

    const direct = Date.parse(absoluteRaw);
    if (Number.isFinite(direct)) return direct;

    const timezone = String(timezoneRaw || '').trim();
    if (timezone) {
        const withTimezone = Date.parse(`${absoluteRaw} ${timezone}`);
        if (Number.isFinite(withTimezone)) return withTimezone;
    }

    return null;
}

function formatDuration(ms) {
    let remaining = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(remaining / 86400);
    remaining -= days * 86400;
    const hours = Math.floor(remaining / 3600);
    remaining -= hours * 3600;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining - minutes * 60;

    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (!parts.length && seconds) parts.push(`${seconds}s`);
    return parts.join(' ') || '0s';
}

function buildActionRow(reminderId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`remind_cancel:${reminderId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`remind_edit:${reminderId}`)
            .setLabel('Edit')
            .setStyle(ButtonStyle.Secondary)
    );
}

function buildSetEmbed(reminder) {
    return new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('1 Reminder Set')
        .setDescription(`Reminder for <@${reminder.userId}> set for <t:${Math.floor(reminder.nextAt / 1000)}:R>`)
        .addFields({ name: 'Content', value: reminder.content, inline: false })
        .setTimestamp(new Date(reminder.createdAt));
}

function buildCanceledEmbed(reminder) {
    return new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('Reminder Canceled')
        .setDescription('This reminder has been canceled.')
        .addFields({ name: 'Content', value: reminder.content, inline: false })
        .setTimestamp(new Date());
}

function parseTargets(raw, interaction) {
    const text = String(raw || '').trim();
    if (!text) {
        if (interaction.guildId && interaction.channelId) {
            return [{ kind: 'channel', id: interaction.channelId }];
        }
        return [{ kind: 'user', id: interaction.user.id }];
    }

    const targets = [];
    const seen = new Set();

    const channelMatches = [...text.matchAll(/<#(\d{17,20})>/g)];
    const userMatches = [...text.matchAll(/<@!?(\d{17,20})>/g)];

    for (const match of channelMatches) {
        const id = String(match[1]);
        const key = `channel:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ kind: 'channel', id });
    }

    for (const match of userMatches) {
        const id = String(match[1]);
        const key = `user:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ kind: 'user', id });
    }

    if (!targets.length) {
        return null;
    }

    return targets.slice(0, MAX_TARGETS);
}

async function updateConfirmationMessage(client, reminder) {
    if (!reminder.confirmationChannelId || !reminder.confirmationMessageId) return;

    try {
        const channel = await client.channels.fetch(reminder.confirmationChannelId).catch(() => null);
        if (!channel || typeof channel.messages?.fetch !== 'function') return;

        const message = await channel.messages.fetch(reminder.confirmationMessageId).catch(() => null);
        if (!message) return;

        if (reminder.status === 'canceled') {
            await message.edit({ embeds: [buildCanceledEmbed(reminder)], components: [buildActionRow(reminder.id)] });
        } else {
            await message.edit({ embeds: [buildSetEmbed(reminder)], components: [buildActionRow(reminder.id)] });
        }
    } catch (err) {
        console.error(`Failed to update reminder confirmation message ${reminder.id}:`, err);
    }
}

function createReminderId() {
    return `rem_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function makeTimezoneList() {
    const values = new Set(BASE_TIMEZONES);
    if (typeof Intl.supportedValuesOf === 'function') {
        for (const tz of Intl.supportedValuesOf('timeZone')) {
            values.add(String(tz));
            if (values.size >= 250) break;
        }
    }
    return [...values];
}

const TIMEZONE_VALUES = makeTimezoneList();

module.exports = {
    name: 'remind',
    description: 'Create a reminder.',
    data: new SlashCommandBuilder()
        .setName('remind')
        .setDescription('Create a reminder.')
        .addStringOption(option =>
            option
                .setName('time')
                .setDescription('The time (and optionally date) to set the reminder for')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option
                .setName('content')
                .setDescription('What you want to be reminded about')
                .setRequired(true)
                .setMaxLength(MAX_REMINDER_TEXT)
        )
        .addStringOption(option =>
            option
                .setName('channels')
                .setDescription('Channel or user mentions to set the reminder for')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('interval')
                .setDescription('Time to wait before repeating the reminder')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('expires')
                .setDescription('For repeating reminders, the time this reminder should stop')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('tts')
                .setDescription('Set TTS on the reminder message')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('timezone')
                .setDescription('Set a timezone override for this reminder only')
                .setRequired(false)
                .setAutocomplete(true)
        ),

    async executeInteraction({ client, interaction }) {
        const timeRaw = sanitizeText(interaction.options.getString('time'), 120);
        const content = sanitizeText(interaction.options.getString('content'), MAX_REMINDER_TEXT);
        const channelsRaw = sanitizeText(interaction.options.getString('channels'), 400);
        const intervalRaw = sanitizeText(interaction.options.getString('interval'), 120);
        const expiresRaw = sanitizeText(interaction.options.getString('expires'), 120);
        const timezone = sanitizeText(interaction.options.getString('timezone'), 80);
        const tts = Boolean(interaction.options.getBoolean('tts'));

        if (!content) {
            return interaction.reply({ content: 'Reminder content is required.', ephemeral: true });
        }

        const nextAt = parseTimeMs(timeRaw, timezone);
        if (!nextAt || !Number.isFinite(nextAt)) {
            return interaction.reply({ content: 'Invalid time. Try values like `10m`, `1d 2h`, or a valid date/time.', ephemeral: true });
        }

        const now = Date.now();
        if (nextAt - now < MIN_DELAY_MS) {
            return interaction.reply({ content: 'Reminder time must be at least 5 seconds from now.', ephemeral: true });
        }
        if (nextAt - now > MAX_DELAY_MS) {
            return interaction.reply({ content: 'Reminder time is too far in the future.', ephemeral: true });
        }

        let intervalMs = null;
        if (intervalRaw) {
            intervalMs = parseDurationMs(intervalRaw);
            if (!intervalMs || intervalMs < MIN_DELAY_MS) {
                return interaction.reply({ content: 'Invalid interval. Try values like `30m`, `2h`, `1d`.', ephemeral: true });
            }
        }

        let expiresAt = null;
        if (expiresRaw) {
            const parsedExpires = parseTimeMs(expiresRaw, timezone);
            if (!parsedExpires || !Number.isFinite(parsedExpires)) {
                return interaction.reply({ content: 'Invalid expires value. Use a duration or valid date/time.', ephemeral: true });
            }
            expiresAt = parsedExpires;
        }

        if (intervalMs && expiresAt && expiresAt <= nextAt) {
            return interaction.reply({ content: 'Expires must be after the first reminder time.', ephemeral: true });
        }

        if (!intervalMs && expiresAt) {
            return interaction.reply({ content: 'The `expires` option requires `interval` (repeating reminder).', ephemeral: true });
        }

        const targets = parseTargets(channelsRaw, interaction);
        if (!targets || !targets.length) {
            return interaction.reply({ content: 'Could not parse `channels`. Use mentions like `#channel` or `@user`.', ephemeral: true });
        }

        const reminders = [];
        for (const target of targets) {
            const reminder = {
                id: createReminderId(),
                userId: interaction.user.id,
                guildId: interaction.guildId || null,
                sourceChannelId: interaction.channelId || null,
                content,
                createdAt: now,
                nextAt,
                timezone,
                tts,
                intervalMs,
                expiresAt,
                status: 'active',
                targetKind: target.kind,
                targetId: target.id,
                confirmationChannelId: interaction.channelId || null,
                confirmationMessageId: null,
                lastTriggeredAt: null,
                canceledAt: null,
                completedAt: null
            };

            client.upsertReminder(reminder);
            client.scheduleReminder(reminder.id);
            reminders.push(reminder);
        }

        for (let idx = 0; idx < reminders.length; idx += 1) {
            const reminder = reminders[idx];
            const payload = {
                embeds: [buildSetEmbed(reminder)],
                components: [buildActionRow(reminder.id)],
                allowedMentions: {
                    parse: [],
                    users: [interaction.user.id],
                    roles: [],
                    repliedUser: false
                }
            };

            let message = null;
            if (idx === 0) {
                await interaction.reply(payload);
                message = await interaction.fetchReply().catch(() => null);
            } else {
                message = await interaction.followUp(payload).catch(() => null);
            }

            if (message?.id) {
                reminder.confirmationChannelId = message.channelId;
                reminder.confirmationMessageId = message.id;
                client.upsertReminder(reminder);
            }
        }
    },

    async handleAutocomplete({ interaction }) {
        const focused = interaction.options.getFocused(true);
        const query = String(focused.value || '').trim().toLowerCase();

        if (focused.name === 'time') {
            const choices = [];
            for (const example of TIME_EXAMPLES) {
                if (query && !example.toLowerCase().includes(query)) continue;
                choices.push({ name: example, value: example });
                if (choices.length >= 20) break;
            }

            const parsed = parseDurationMs(query);
            if (parsed && parsed >= MIN_DELAY_MS) {
                choices.unshift({ name: `In approximately ${formatDuration(parsed)}`, value: query });
            }

            const unique = [];
            const seen = new Set();
            for (const item of choices) {
                const key = `${item.name}|${item.value}`;
                if (seen.has(key)) continue;
                seen.add(key);
                unique.push(item);
                if (unique.length >= 25) break;
            }

            return interaction.respond(unique.length ? unique : [{ name: 'Try: 10m, 2h, 1d 2h', value: '10m' }]);
        }

        if (focused.name === 'timezone') {
            const choices = [];
            for (const tz of TIMEZONE_VALUES) {
                if (query && !tz.toLowerCase().includes(query)) continue;
                choices.push({ name: tz, value: tz });
                if (choices.length >= 25) break;
            }

            if (!choices.length) {
                choices.push({ name: 'UTC', value: 'UTC' });
            }

            return interaction.respond(choices);
        }

        return interaction.respond([]);
    },

    async handleButton({ client, interaction }) {
        if (interaction.customId.startsWith('remind_cancel:')) {
            const reminderId = interaction.customId.split(':')[1];
            const reminder = client.getReminder(reminderId);
            if (!reminder) {
                return interaction.reply({ content: 'This reminder no longer exists.', ephemeral: true });
            }
            if (reminder.userId !== interaction.user.id) {
                return interaction.reply({ content: 'Only the reminder creator can manage this reminder.', ephemeral: true });
            }

            if (reminder.status === 'canceled') {
                return interaction.reply({ content: 'This reminder is already canceled.', ephemeral: true });
            }
            if (reminder.status === 'completed') {
                return interaction.reply({ content: 'This reminder has already completed.', ephemeral: true });
            }

            const canceled = client.cancelReminder(reminder.id);
            await interaction.update({ embeds: [buildCanceledEmbed(canceled)], components: [buildActionRow(canceled.id)] });
            return true;
        }

        if (interaction.customId.startsWith('remind_edit:')) {
            const reminderId = interaction.customId.split(':')[1];
            const reminder = client.getReminder(reminderId);
            if (!reminder) {
                return interaction.reply({ content: 'This reminder no longer exists.', ephemeral: true });
            }
            if (reminder.userId !== interaction.user.id) {
                return interaction.reply({ content: 'Only the reminder creator can manage this reminder.', ephemeral: true });
            }

            const modal = new ModalBuilder()
                .setCustomId(`remind_edit_modal:${reminder.id}`)
                .setTitle('Edit Reminder');

            const timeInput = new TextInputBuilder()
                .setCustomId('remind_edit_time')
                .setLabel('Time')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(120)
                .setValue(formatDuration(Math.max(MIN_DELAY_MS, reminder.nextAt - Date.now())));

            const contentInput = new TextInputBuilder()
                .setCustomId('remind_edit_content')
                .setLabel('Content')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(MAX_REMINDER_TEXT)
                .setValue(reminder.content);

            const intervalInput = new TextInputBuilder()
                .setCustomId('remind_edit_interval')
                .setLabel('Interval (optional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(120);
            if (reminder.intervalMs) {
                intervalInput.setValue(formatDuration(reminder.intervalMs));
            }

            const expiresInput = new TextInputBuilder()
                .setCustomId('remind_edit_expires')
                .setLabel('Expires (optional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(120);
            if (reminder.expiresAt) {
                expiresInput.setValue(formatDuration(Math.max(MIN_DELAY_MS, reminder.expiresAt - Date.now())));
            }

            const timezoneInput = new TextInputBuilder()
                .setCustomId('remind_edit_timezone')
                .setLabel('Timezone (optional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(80);
            if (reminder.timezone) {
                timezoneInput.setValue(reminder.timezone);
            }

            modal.addComponents(
                new ActionRowBuilder().addComponents(timeInput),
                new ActionRowBuilder().addComponents(contentInput),
                new ActionRowBuilder().addComponents(intervalInput),
                new ActionRowBuilder().addComponents(expiresInput),
                new ActionRowBuilder().addComponents(timezoneInput)
            );

            await interaction.showModal(modal);
            return true;
        }

        return false;
    },

    async handleModalSubmit({ client, interaction }) {
        if (!interaction.customId.startsWith('remind_edit_modal:')) return false;

        const reminderId = interaction.customId.split(':')[1];
        const reminder = client.getReminder(reminderId);
        if (!reminder) {
            await interaction.reply({ content: 'This reminder no longer exists.', ephemeral: true });
            return true;
        }

        if (reminder.userId !== interaction.user.id) {
            await interaction.reply({ content: 'Only the reminder creator can manage this reminder.', ephemeral: true });
            return true;
        }

        const timeRaw = sanitizeText(interaction.fields.getTextInputValue('remind_edit_time'), 120);
        const content = sanitizeText(interaction.fields.getTextInputValue('remind_edit_content'), MAX_REMINDER_TEXT);
        const intervalRaw = sanitizeText(interaction.fields.getTextInputValue('remind_edit_interval'), 120);
        const expiresRaw = sanitizeText(interaction.fields.getTextInputValue('remind_edit_expires'), 120);
        const timezone = sanitizeText(interaction.fields.getTextInputValue('remind_edit_timezone'), 80);

        const now = Date.now();
        const nextAt = parseTimeMs(timeRaw, timezone || reminder.timezone);
        if (!nextAt || !Number.isFinite(nextAt) || nextAt - now < MIN_DELAY_MS) {
            await interaction.reply({ content: 'Invalid time. Use values like `10m`, `2h`, or a valid date/time.', ephemeral: true });
            return true;
        }

        let intervalMs = null;
        if (intervalRaw) {
            intervalMs = parseDurationMs(intervalRaw);
            if (!intervalMs || intervalMs < MIN_DELAY_MS) {
                await interaction.reply({ content: 'Invalid interval value.', ephemeral: true });
                return true;
            }
        }

        let expiresAt = null;
        if (expiresRaw) {
            expiresAt = parseTimeMs(expiresRaw, timezone || reminder.timezone);
            if (!expiresAt || !Number.isFinite(expiresAt)) {
                await interaction.reply({ content: 'Invalid expires value.', ephemeral: true });
                return true;
            }
        }

        if (intervalMs && expiresAt && expiresAt <= nextAt) {
            await interaction.reply({ content: 'Expires must be after the first reminder time.', ephemeral: true });
            return true;
        }

        if (!intervalMs && expiresAt) {
            await interaction.reply({ content: 'The `expires` value requires `interval`.', ephemeral: true });
            return true;
        }

        reminder.content = content;
        reminder.nextAt = nextAt;
        reminder.intervalMs = intervalMs;
        reminder.expiresAt = expiresAt;
        reminder.timezone = timezone || reminder.timezone || '';
        reminder.status = 'active';
        reminder.canceledAt = null;
        reminder.completedAt = null;

        client.upsertReminder(reminder);
        client.scheduleReminder(reminder.id);
        await updateConfirmationMessage(client, reminder);

        await interaction.reply({
            content: `Reminder updated. Next trigger: <t:${Math.floor(reminder.nextAt / 1000)}:F>`,
            ephemeral: true
        });
        return true;
    }
};
