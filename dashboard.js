const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'online',
    activity: 'Watching Automating Custom Minigames',
    prefix: '?'
  });
});

app.listen(PORT, () => {
  console.log(`Dashboard available at http://localhost:${PORT}`);
});
