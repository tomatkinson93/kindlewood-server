require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { initDB } = require('./db');

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const mapRoutes = require('./routes/map');
const citizenRoutes = require('./routes/citizens');
const buildingRoutes = require('./routes/buildings');

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = [
  'https://kindlewood.quest',
  'https://www.kindlewood.quest',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean)
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true, service: 'kindlewood-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/citizens', citizenRoutes);
app.use('/api/buildings', buildingRoutes);
const expeditionRoutes = require('./routes/expeditions');
app.use('/api/expeditions', expeditionRoutes);
const questRoutes = require('./routes/quests');
app.use('/api/quests', questRoutes);
const questAdminRoutes = require('./routes/quest_admin');
app.use('/api/quest-admin', questAdminRoutes);
const inventoryRoutes = require('./routes/inventory');
app.use('/api/inventory', inventoryRoutes);
const diplomacyRoutes = require('./routes/diplomacy');
app.use('/api/diplomacy', diplomacyRoutes);
// item-admin endpoints are in /api/game/items (routes/game.js)
const housingRoutes = require('./routes/housing');
app.use('/api/housing', housingRoutes);
const eventsRoutes = require('./routes/events');
app.use('/api/events', eventsRoutes);
const relationshipsRoutes = require('./routes/relationships');
app.use('/api/relationships', relationshipsRoutes);
const combatRoutes = require('./routes/combat');
app.use('/api/combat', combatRoutes);
const streamRoutes = require('./routes/stream');
app.use('/api/stream', streamRoutes);

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Kindlewood API running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
