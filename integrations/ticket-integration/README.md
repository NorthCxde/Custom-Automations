Ticket Integration
==================

Minimal Express integration for the Developer Portal ticket integration.

Quick start
-----------

1. Install dependencies:

```bash
cd integrations/ticket-integration
npm install
```

2. Copy `.env.example` to `.env` and set `INTEGRATION_SECRET` if you want to require auth.

3. Run locally:

```bash
node server.js
```

4. Expose to the internet for testing (ngrok example):

```bash
ngrok http 3000
```

5. In the Developer Portal, set the Request URL to:

```
https://<ngrok-id>.ngrok.io/open-ticket?discord_id=%user_id%
```

Headers (in Developer Portal):

```
Authorization: Bearer %integration_secret%
```

6. Test with curl (replace SECRET and URL):

```bash
curl -i -H "Authorization: Bearer YOUR_SECRET" \
  "https://<ngrok-id>.ngrok.io/open-ticket?discord_id=123456789012345678"
```

Expected JSON response:

```json
{
  "custom_automations": "enabled",
  "user": { "id": "123456789012345678", "username": "user_5678" },
  "welcome_message": "Thanks <@123456789012345678>!"
}
```

Validation endpoint
-------------------
The portal may POST to `/validate-secrets` with the secrets to validate during installation. This endpoint returns `200 OK` when secrets match, otherwise non-2xx.

Next steps
----------
- I can wire this to call your bot to auto-create ticket channels (requires bot token).  
- Or deploy this to a public host and update your portal URL.
