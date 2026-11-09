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

`/statistics game:<Timebomb Duels|Custom Minigames> type:<Visits|CCU|New Players|Favorites|Likes|Dislikes> [milestone:<goal>]` shows an ephemeral, non-updating snapshot of the selected game, visible only to the person running the command, with a link button to the game. Game and type are required; the optional milestone applies to the selected statistic. The command defaults to moderator access through the existing `/perms` roles; its access level can also be changed through `/manage`.

- Visits: current total, visits gained in the rolling past 24 hours and 7 days, and daily/weekly visit rates across all collected history. Rates need at least five minutes of history; the weekly rate is the daily rate multiplied by seven, not a completed week's total.
- CCU: current players online, time-weighted average CCU, and sampled peak CCU over the past 24 hours and 7 days. Peaks can miss spikes between samples. Incomplete time coverage is labeled, and samples are held for at most ten minutes so outages are not treated as observed activity.
- New Players: Roblox's rolling past-24-hour count of awards for the configured game badge, plus a past-7-day count calculated from badge-total snapshots. The badges are `Alpha` for Timebomb Duels and `Played Custom Minigames!` for Custom Minigames; badge awards are used as a proxy for new players.
- Favorites, Likes, and Dislikes: current totals plus net change in the rolling past 24 hours and 7 days. Net changes can be negative if players remove a favorite or vote.
- Milestone: an optional positive goal (commas accepted) shows the remaining count for the selected metric. Visits uses the saved all-history daily visit average. Favorites, Likes, Dislikes, and all-time badge awards use their own daily net growth across retained valid snapshots (up to eight days, with at least five minutes required). Dates are projections, not guarantees; zero/negative growth or missing data cannot produce a date. New Players shows separate rolling-24-hour and all-time badge-total milestones. CCU and rolling-24-hour goals show remaining counts without an estimated date because these values fluctuate rather than accumulate.
- Collection starts automatically on bot startup and repeats approximately every five minutes, without anyone running the command. Commands only read the latest saved snapshot (including its timestamp); they never trigger extra API requests. No Discord messages or routine collection logs are sent; only failures are logged. The bot saves each game's history separately: Timebomb Duels in `data/game-statistics.json` and Custom Minigames in `data/game-statistics-custom-minigames.json`. New metrics are appended to these existing files without resetting old visit/CCU snapshots or their averages. Keep these files across deploys and back them up. Run only one collector per data directory.
- Historical data cannot be backfilled from Roblox. Existing Visits/CCU history is preserved; new badge/favorite/vote history begins on the first successful collection after deployment, so their 24-hour and 7-day net changes fill in as history accumulates. Rolling visit totals remain unavailable until the relevant starting snapshot exists (within ten minutes of the window boundary); counts have approximately five-minute resolution. Visits use net growth between saved totals, including negative corrections. Recorded decreases no longer disable calculations or add a warning paragraph to the embed. These figures are net changes, not gross new visits; nonpositive growth cannot produce a milestone date. Existing history and persisted decrease flags are retained without resetting or rewriting them.
- The most recent eight days of raw snapshots are retained, plus the original baseline used for all-history visit rates. History survives restarts. API/storage failures are logged; invalid history is not silently overwritten.

Restart the bot to begin collection and register the new command. If needed, use `/synccommands` to refresh the server's commands.

Run the focused tests with `node --test tests/game-statistics.test.js`.

## GIF conversion

`/gif` and `?gif` show "Generating..." with the application's animated Loading emoji before downloading and converting an image or video, then replace that message with the GIF or an error. `/gif` preserves its ephemeral and spoiler options; `?gif video` uses the same loading behavior for video attachments.

## Roblox blacklists

For automatically scanned exploit-report tickets, the bot sends the normal info embed for every Roblox user who passes the ticket filters. A user found in either Trello blacklist list gets a **Status** section with `⚠️Already Banned` and no **Ban** button (the **Unban** button remains). Automatic duplicate closure is considered only when exactly one user passes the filters and has an info embed; tickets with multiple eligible info embeds remain open so moderators can review each report. Every 15 minutes, while automatic ticket scanning is enabled, the bot rechecks active exploit-report tickets against Trello so older open reports can be handled after a later ban. Reconciliation reads existing bot info embeds across the ticket's message history and fetches both Trello blacklist lists once per sweep. It never requests Roblox profiles, usernames, inventory or badges, and never reposts info embeds. Tickets without an existing info embed remain open; use `/scaninfo` to inspect them manually. If a single-embed report's account is listed, the bot identifies the first non-bot user added by the Reports bot, attempts to DM them, and posts a notice with a live 30-second countdown and a red **Don't Close** button. Anyone in the thread may press it during the countdown to cancel closure and leave the ticket open for more evidence; the button is removed when pressed or when time expires. Previously notified tickets, including cancelled countdowns, are skipped by future sweeps even after a restart. Otherwise the bot locks and archives the thread after 30 seconds. If the opener, owner credentials, or Trello lookup cannot be verified, it logs the issue and leaves the ticket open. If DMs are disabled, the in-thread notice still goes out. The bot needs thread send/manage permissions.

`/dupescan` immediately runs this duplicate check across open exploit-report tickets without waiting for the 15-minute schedule. It uses the same role access configured for other moderator commands and can run even when automatic ticket scanning is disabled.

Automatic info scans also run for exploit-report questionnaire threads in the mixed-purpose channel `1406849874925719583`. Appeals questionnaires are not treated as exploit reports. These threads receive the regular Roblox info embed and already-banned status when applicable, but are never DM'd, notified, locked, archived, or automatically closed by duplicate-report handling; appeals remain a manual process.

Automatic info scans run when new tickets or questionnaire messages arrive, not as a periodic Roblox backfill of all older tickets. This prevents background scans from exhausting Roblox rate limits needed by moderator commands. Run the focused sweep tests with `node --test tests/ticket-reconciliation.test.js`.

`/info user:<username or ID>` requires a user and retains its existing profile lookup. Use the separate `/displayname display_name:<Display Name>` command to search for exact Roblox display-name matches (case-insensitive); its display_name option is required. Both commands retain manual-moderator access and the existing moderator permission policy. Results are ephemeral and numbered as username - ID, with profile links, 25 per page and up to four pages. Back/Next buttons expire after five minutes. Searches scan at most 1,000 Roblox search results and display at most 100 unique matches; Roblox search may omit accounts, so this is not an exhaustive account directory. Empty matches and API failures are reported explicitly. Restart to register the changed commands, or use `/synccommands`.

Display-name results use the same inventory badge-ownership lookup and badge IDs as normal `/info`: Timebomb Duels badge `2142457718` and Custom Minigames badge `2124646244`. Checks use at most four concurrent requests and a 30-second timeout for the badge-check phase. Badge-confirmed players appear first under **Top Results**, followed by **Other Results**, preserving search order within each group. A played badge is evidence of prior play, not current presence or proof of wrongdoing. Other Results does not mean "never played"; users with unavailable checks are counted in a visible warning. Rate limiting stops additional badge requests. The animated Loading emoji appears while checking; page navigation reuses the cached ranking.

Run the display-name tests with `node --test tests/info.test.js`.

Each Top Results entry includes **Played Timebomb Duels**, **Played Custom Minigames**, or **Played Both Games**, based on confirmed badge ownership. Other Results entries do not receive a played label.

In `/info`, click Ban to choose Blacklist or TB Duels Blacklist (the existing two-week duration), or the green **1 Week** button. The one-week path opens a required Trello-comment modal, then shows the two list choices. Selecting a list creates a card with a due date seven days from creation and posts the context as a Trello comment using your registered credentials. Existing cards are not duplicated or modified. Moderator access and ban-stat logging are unchanged.

The one-week path explicitly updates the due date after card creation and posts the comment, then checks the saved date every five seconds for up to 30 seconds, reapplying it if the board's automation overwrites it. Checks stop after two consecutive matching lookups; a mismatch resets the confirmation count. It does not report success based only on the immediate update response. Failed updates or verification produce a warning identifying whether the comment was saved. Automation running after confirmation can still change the date; adjust the board's default two-week rule to exclude one-week cards for a permanent guarantee.

The comment draft is private to the submitting moderator and server, expires after ten minutes, and is lost on restart. If card creation succeeds but the comment fails, the bot explicitly tells you to check the date and add the comment manually. This sets a Trello due date; it does not introduce automatic card archiving.

During one-week due-date verification, the bot shows "Changing due date..." with the animated Loading emoji, then replaces it with the refreshed info embed or an error.

Run the focused tests with `node --test tests/info-blacklist.test.js`.

## Moderator summary

`/summary month:Last month` regenerates the previous calendar month's summary from saved moderation logs and month-specific Roblox-ban overrides. Omitting `month` (or selecting Current month) summarizes the current month. Months follow America/New_York time, including year transitions. `last_month:Yes` compares the selected month against the month before it; `half` only changes the title.

Optional `server_stats` uses Discord moderation logs within the selected calendar month, excluding Trello Roblox bans. Rolling 7-day/30-day/all-time Discord-stat overrides are not included because they cannot be assigned to a calendar month; `/modstats` retains its existing behavior. Trainees and moderator membership are based on current configuration and server roles, not archived role membership. No summary snapshot is automatically archived, and selecting a month does not reset or modify saved logs.

## Pumpkin mask

Alternatively, send `?pumpkinmask` with an image attached to the same message. It processes the first attachment, using the same loading message, mask fitting, limits, and public command permissions as the slash command.

Use `?pumpkinmask @user` or `?pumpkinmask USER_ID` to mask a current server member's server avatar (falling back to their normal avatar if no server avatar is set). A provided user ID/mention takes priority over an attached image. Invalid targets receive an error; avatar downloads have the same size, timeout, and pixel limits as uploads.

`/pumpkinmask image:<attachment>` shows "Generating..." with the application's animated Halloween emoji while processing, then replaces it with a public, downloadable PNG. The output keeps the uploaded image's dimensions and aspect ratio (after correcting camera orientation). It automatically selects the proportionally closest mask: `assets/pumpkin-mask.png` for wide images, or `assets/pumpkin-mask-square.png` for square and portrait images. The selected mask is scaled proportionally to fit inside that canvas, centered on top, with solid black filling any space outside it. Transparent input pixels are also black-backed. The image is not stretched or cropped, and the command does not detect or reposition faces.

The command defaults to public access and respects the existing `/publicperms` settings and `/manage` access overrides. PNG, JPG, WebP, GIF, and AVIF are supported up to 10 MB and 25 megapixels; animated uploads use the first frame. Restart the bot to register the command, or use `/synccommands` if necessary. Include both mask assets when deploying.

Run the focused tests with `node --test tests/pumpkin-mask.test.js`.

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
