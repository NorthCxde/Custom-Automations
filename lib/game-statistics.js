const fs = require('fs');
const path = require('path');
const { fetchGameData } = require('./roblox-game');

const INTERVAL = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const MAX_HOLD = 2 * INTERVAL;

function validSnapshot(value) {
    return value && Number.isSafeInteger(value.timestamp) && value.timestamp > 0
        && Number.isSafeInteger(value.visits) && value.visits >= 0
        && Number.isSafeInteger(value.ccu) && value.ccu >= 0;
}

function summarizeWindow(snapshots, current, duration) {
    const start = current.timestamp - duration;
    const samples = [...snapshots.filter(sample => sample.timestamp < current.timestamp), current];
    const baseline = samples.filter(sample => sample.timestamp <= start).at(-1);
    const relevant = samples.filter(sample => sample.timestamp > start);
    const visitSamples = baseline ? [baseline, ...relevant] : relevant;
    const counterReset = visitSamples.some((sample, index) =>
        index > 0 && sample.visits < visitSamples[index - 1].visits);
    const visits = baseline && start - baseline.timestamp <= MAX_HOLD && !counterReset
        ? current.visits - baseline.visits : null;
    let weighted = 0;
    let covered = 0;
    let peak = null;

    for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        if (sample.timestamp >= start) peak = Math.max(peak ?? 0, sample.ccu);
        const from = Math.max(start, sample.timestamp);
        const to = Math.min(current.timestamp, samples[index + 1]?.timestamp ?? current.timestamp,
            sample.timestamp + MAX_HOLD);
        if (to <= from) continue;
        weighted += sample.ccu * (to - from);
        covered += to - from;
        peak = Math.max(peak ?? 0, sample.ccu);
    }

    return {
        visits,
        counterReset,
        average: covered > 0 ? weighted / covered : null,
        peak,
        coverage: covered / duration,
        complete: covered >= duration,
        baselineTimestamp: visits === null ? null : baseline.timestamp
    };
}

function summarizeMetricChange(snapshots, current, field, duration, cumulative = false) {
    const currentValue = current[field];
    if (!Number.isSafeInteger(currentValue) || currentValue < 0) return null;

    const start = current.timestamp - duration;
    const baseline = snapshots
        .filter(sample => sample.timestamp <= start
            && Number.isSafeInteger(sample[field]) && sample[field] >= 0)
        .at(-1);
    if (!baseline || start - baseline.timestamp > MAX_HOLD) return null;

    const change = currentValue - baseline[field];
    if (cumulative && change < 0) return null;
    return change;
}

class GameStatistics {
    constructor(filePath, fetchData = fetchGameData) {
        this.filePath = filePath;
        this.fetchData = fetchData;
        this.state = { version: 1, origin: null, counterReset: false, snapshots: [] };
        this.running = false;
        this.pending = null;
        if (fs.existsSync(filePath)) {
            const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (state?.version !== 1 || typeof state.counterReset !== 'boolean'
                || !Array.isArray(state.snapshots)
                || (state.origin !== null && !validSnapshot(state.origin))
                || (state.snapshots.length > 0 && state.origin === null)
                || !state.snapshots.every((sample, index) => validSnapshot(sample)
                    && sample.timestamp >= state.origin.timestamp
                    && (index === 0 || sample.timestamp > state.snapshots[index - 1].timestamp))) {
                throw new Error('Invalid game statistics history; restore the history file from a backup');
            }
            this.state = state;
        }
    }

    async current() {
        if (!this.pending) {
            this.pending = this.fetchData().then(sample => {
                if (!validSnapshot(sample)) throw new Error('Invalid game statistics snapshot');
                return sample;
            }).finally(() => { this.pending = null; });
        }
        return this.pending;
    }

    async collect() {
        const sample = await this.current();
        const previous = this.state.snapshots.at(-1);
        if (previous && sample.timestamp <= previous.timestamp) {
            throw new Error('Game statistics timestamps must increase');
        }
        const state = {
            version: 1,
            origin: this.state.origin || sample,
            counterReset: this.state.counterReset || Boolean(previous && sample.visits < previous.visits),
            snapshots: [...this.state.snapshots, sample]
                .filter(entry => entry.timestamp >= sample.timestamp - WEEK - DAY)
        };
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(state), 'utf8');
        fs.renameSync(temporaryPath, this.filePath);
        this.state = state;
        return sample;
    }

    start() {
        if (this.running) return;
        this.running = true;
        const tick = async () => {
            try {
                await this.collect();
            } catch (error) {
                console.error('Failed to collect game statistics:', error);
            } finally {
                if (this.running) {
                    this.timer = setTimeout(tick, INTERVAL);
                    this.timer.unref();
                }
            }
        };
        void tick();
    }

    stop() {
        this.running = false;
        clearTimeout(this.timer);
    }

    latest() {
        return this.state.snapshots.at(-1) || null;
    }

    summarize(current) {
        const { origin, snapshots } = this.state;
        const elapsed = origin ? current.timestamp - origin.timestamp : 0;
        const counterReset = this.state.counterReset || snapshots.some((sample, index) =>
            sample.visits < (index > 0 ? snapshots[index - 1].visits : origin.visits))
            || Boolean(snapshots.length && current.visits < snapshots.at(-1).visits);
        const dailyAverage = origin && elapsed >= INTERVAL && !counterReset
            ? (current.visits - origin.visits) / (elapsed / DAY) : null;
        return {
            origin,
            lastCollected: snapshots.at(-1) || null,
            counterReset,
            dailyAverage,
            weeklyAverage: dailyAverage === null ? null : dailyAverage * 7,
            day: summarizeWindow(snapshots, current, DAY),
            week: summarizeWindow(snapshots, current, WEEK),
            metricChanges: {
                favorites: {
                    day: summarizeMetricChange(snapshots, current, 'favorites', DAY),
                    week: summarizeMetricChange(snapshots, current, 'favorites', WEEK)
                },
                likes: {
                    day: summarizeMetricChange(snapshots, current, 'likes', DAY),
                    week: summarizeMetricChange(snapshots, current, 'likes', WEEK)
                },
                dislikes: {
                    day: summarizeMetricChange(snapshots, current, 'dislikes', DAY),
                    week: summarizeMetricChange(snapshots, current, 'dislikes', WEEK)
                },
                badgeAwards: {
                    day: summarizeMetricChange(snapshots, current, 'badgeAwards', DAY, true),
                    week: summarizeMetricChange(snapshots, current, 'badgeAwards', WEEK, true)
                }
            }
        };
    }
}

module.exports = { GameStatistics, summarizeWindow, INTERVAL, DAY, WEEK };
