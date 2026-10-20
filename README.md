# Custom Automations Dashboard

A simple website dashboard for your Discord bot.

## Bot deployment

For production hosting, prefer environment variables over storing secrets in `config.json`.

Example:

```bash
export DISCORD_TOKEN="your-bot-token"
npm start
```

The bot will read `DISCORD_TOKEN` first and fall back to `config.json` only if the environment variable is not set.

## Content channel

Use `/setcontentchannel` to select the text channel for creator links. HTTP(S) links containing `youtube` or `tiktok` anywhere in the URL (case-insensitive), as well as `youtu.be` links, trigger a fire reaction and the existing creator-role ping. This includes mobile and shortened link variations; plain-text platform names do not trigger it.

## Game statistics

`/statistics game:<Timebomb Duels|Custom Minigames> type:<Visits|CCU>` shows an ephemeral, non-updating snapshot of the selected game, visible only to the person running the command, with a link button to the game. Both options are required. The command defaults to moderator access through the existing `/perms` roles; its access level can also be changed through `/manage`.

- Visits: current total, visits gained in the rolling past 24 hours and 7 days, and daily/weekly visit rates across all collected history. Rates need at least five minutes of history; the weekly rate is the daily rate multiplied by seven, not a completed week's total.
- CCU: current players online, time-weighted average CCU, and sampled peak CCU over the past 24 hours and 7 days. Peaks can miss spikes between samples. Incomplete time coverage is labeled, and samples are held for at most ten minutes so outages are not treated as observed activity.
- Collection starts automatically on bot startup and repeats approximately every five minutes, without anyone running the command. Commands only read the latest saved snapshot (including its timestamp); they never trigger extra API requests. No Discord messages or routine collection logs are sent; only failures are logged. The bot saves each game's history separately: Timebomb Duels in `data/game-statistics.json` (unchanged, so existing history is kept) and Custom Minigames in `data/game-statistics-custom-minigames.json`. Keep these files across deploys and back them up. Run only one collector per data directory.
- Historical data cannot be backfilled from the current Roblox game endpoint. Rolling visit totals remain unavailable until the relevant starting snapshot exists (within ten minutes of the window boundary); counts have approximately five-minute resolution. Visit counter decreases make affected totals and all-history rates unavailable rather than reporting misleading gains.
- The most recent eight days of raw snapshots are retained, plus the original baseline used for all-history visit rates. History survives restarts. API/storage failures are logged; invalid history is not silently overwritten.

Restart the bot to begin collection and register the new command. If needed, use `/synccommands` to refresh the server's commands.

Run the focused tests with `node --test tests/game-statistics.test.js`.

## Run locally

1. Install the new dependency:

```bash
npm install
```

2. Start the dashboard server:

```bash
npm run dashboard
```

3. Open `http://localhost:3000` in your browser.

## What it includes

- `dashboard.js` — an Express server serving a static dashboard.
- `public/index.html` — the dashboard page.
- `public/style.css` — styling for the page.

## Deploying to your domain

Your domain needs to point to a server running this code.

- If you host on a VPS, set the domain's A record to the server IP.
- If you use a hosting provider, deploy the project there and map the domain.
- For HTTPS, use a reverse proxy like Nginx or a platform that handles certificates.

## Next steps

If you want, I can also add:

- Discord OAuth login for the dashboard
- live command control buttons
- a real bot status endpoint using your existing bot process
