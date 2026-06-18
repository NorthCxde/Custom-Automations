require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

const SECRET = process.env.INTEGRATION_SECRET;
const PORT = process.env.PORT || 3000;

app.get('/open-ticket', (req, res) => {
  const discordId = req.query.discord_id;
  const auth = req.get('authorization') || '';

  if (SECRET) {
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!discordId) return res.status(400).json({ error: 'Missing discord_id' });

  return res.json({
    custom_automations: 'enabled',
    user: { id: discordId, username: `user_${discordId.slice(-4)}` },
    welcome_message: `Thanks <@${discordId}>!`
  });
});

app.post('/validate-secrets', (req, res) => {
  const { integration_secret } = req.body || {};
  // If no secret configured on server, accept any validation
  if (!SECRET) return res.status(200).json({ ok: true });
  if (integration_secret === SECRET) return res.status(200).json({ ok: true });
  return res.status(400).json({ ok: false });
});

app.listen(PORT, () => console.log(`Ticket integration listening on ${PORT}`));
