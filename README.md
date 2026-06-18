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
