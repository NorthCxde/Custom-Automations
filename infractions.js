const DEFAULT_INFRACTION_RULES = {
    spam: {
        label: 'Spam',
        steps: [
            { type: 'timeout', duration: '4h' },
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'timeout', duration: '1d' },
            { type: 'kick' }
        ]
    },
    off_topic: {
        label: 'Off Topic',
        steps: [
            { type: 'timeout', duration: '1h' },
            { type: 'timeout', duration: '3h' },
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'kick' }
        ]
    },
    spam_pinging_owners: {
        label: 'Spam Pinging Owners',
        steps: [
            { type: 'timeout', duration: '1h' },
            { type: 'timeout', duration: '3h' },
            { type: 'timeout', duration: '6h' },
            { type: 'moderator_decision' }
        ]
    },
    blacklisted_words_bypass: {
        label: 'Bypassing Blacklisted Words',
        steps: [
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '9h' },
            { type: 'timeout', duration: '12h' },
            { type: 'timeout', duration: '1d' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'moderator_decision' }
        ]
    },
    nsfw_explicit_messages: {
        label: 'NSFW or Explicit Messages',
        steps: [
            { type: 'timeout', duration: '1d' },
            { type: 'timeout', duration: '3d' },
            { type: 'timeout', duration: '7d' },
            { type: 'ban' }
        ]
    },
    direct_slurs: {
        label: 'Direct Slurs',
        steps: [
            { type: 'timeout', duration: '1d' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'ban' }
        ]
    },
    harassment_disrespect: {
        label: 'Harassment/Disrespect',
        steps: [
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'timeout', duration: '1d' },
            { type: 'timeout', duration: '3d' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'ban' }
        ]
    },
    instigation: {
        label: 'Instigation',
        steps: [
            { type: 'timeout', duration: '3h' },
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'timeout', duration: '2d' },
            { type: 'timeout', duration: '4d' },
            { type: 'temp_ban' },
            { type: 'moderator_decision' }
        ]
    },
    promotion: {
        label: 'Promotion',
        steps: [
            { type: 'timeout', duration: '12h' },
            { type: 'ban' }
        ]
    },
    controversial_topics: {
        label: 'Controversial Topics',
        steps: [
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '12h' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'ban' }
        ]
    },
    roblox_tos_violation: {
        label: 'Roblox TOS Violation',
        steps: [
            { type: 'timeout', duration: '1h' },
            { type: 'timeout', duration: '6h' },
            { type: 'timeout', duration: '1d' },
            { type: 'temp_ban', duration: '7d' },
            { type: 'moderator_decision' }
        ]
    },
    troll_tickets: {
        label: 'Troll Tickets',
        steps: [
            { type: 'ticket_blacklist' },
            { type: 'ban' }
        ]
    }
};

const RULE_CHOICES = Object.entries(DEFAULT_INFRACTION_RULES).map(([key, value]) => ({
    name: value.label,
    value: key
}));

function cloneInfractionRules(rules = DEFAULT_INFRACTION_RULES) {
    return JSON.parse(JSON.stringify(rules));
}

function cloneInfractionRule(rule) {
    return JSON.parse(JSON.stringify(rule));
}

function parseDurationMs(duration) {
    if (typeof duration !== 'string') return null;
    const match = duration.trim().match(/^(\d+)([smhd])$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
        case 's': return amount * 1000;
        case 'm': return amount * 60 * 1000;
        case 'h': return amount * 60 * 60 * 1000;
        case 'd': return amount * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

function normalizeInfractionStep(step) {
    if (!step || typeof step !== 'object') return null;
    const typeRaw = String(step.type || '').trim().toLowerCase();
    if (!typeRaw) return null;

    const type = typeRaw.replace(/\s+/g, '_');
    const durationRaw = typeof step.duration === 'string' ? step.duration.trim().toLowerCase() : '';

    if (type === 'timeout') {
        if (!durationRaw || !parseDurationMs(durationRaw)) return null;
        return { type, duration: durationRaw };
    }

    if (type === 'temp_ban') {
        if (!durationRaw) return { type };
        if (!parseDurationMs(durationRaw)) return null;
        return { type, duration: durationRaw };
    }

    if (['kick', 'ban', 'moderator_decision', 'ticket_blacklist'].includes(type)) {
        return { type };
    }

    return null;
}

function sanitizeInfractionRules(inputRules) {
    const out = {};
    const source = inputRules && typeof inputRules === 'object' ? inputRules : {};

    for (const [ruleKey, defaults] of Object.entries(DEFAULT_INFRACTION_RULES)) {
        const candidate = source[ruleKey] && typeof source[ruleKey] === 'object' ? source[ruleKey] : {};
        const label = typeof candidate.label === 'string' && candidate.label.trim()
            ? candidate.label.trim()
            : defaults.label;

        const normalizedSteps = Array.isArray(candidate.steps)
            ? candidate.steps.map(normalizeInfractionStep).filter(Boolean)
            : [];

        out[ruleKey] = {
            label,
            steps: normalizedSteps.length ? normalizedSteps : cloneInfractionRule(defaults).steps
        };
    }

    return out;
}

module.exports = {
    DEFAULT_INFRACTION_RULES,
    RULE_CHOICES,
    cloneInfractionRule,
    cloneInfractionRules,
    parseDurationMs,
    normalizeInfractionStep,
    sanitizeInfractionRules
};
