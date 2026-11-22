// Force IPv4 over IPv6 — fixes Render + Supabase ENETUNREACH error
require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config();
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');
const { applyDelivery } = require('./scoring-engine');

const {
  saveActiveMatch,
  loadActiveMatch,
  clearActiveMatch,
  createMatchRecord,
  listTournaments,
  getTournamentBySlug,
  createTournament,
  updateTournament,
  getTournamentDirectory,
  listTeams,
  createTeam,
  listPlayers,
  createPlayer,
  registerTournamentTeam,
  registerTournamentPlayer,
  listTournamentFixtures,
  createFixture,
  getFixtureForScoring,
  markFixtureLive,
  archiveMatch,
  saveBallEvent,
  recordMatchParticipation,
  upsertBattingStats,
  upsertBowlingStats,
  upsertTeamRecord,
  getBattingStats,
  getBowlingStats,
  getTeamStats,
  getMatchHistory,
  getMatchBalls,
  getMatchFullState,
  getPointsTable,
  getPublicStandings,
  getAdminStandings,
  saveDraftStandings,
  publishStandings,
} = require('./db');

const app = express();
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:5173', 'http://localhost:5174'];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const adminSessions = new Map();
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const configuredAdminPin = process.env.ADMIN_PIN || (process.env.NODE_ENV !== 'production' ? '123456' : null);
const validAdminSession = (token) => {
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) adminSessions.delete(token);
    return false;
  }
  return true;
};
const requireAdmin = (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!validAdminSession(token)) return res.status(401).json({ error: 'Administrator authentication is required.' });
  next();
};
const compareSecret = (left, right) => {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const TOURNAMENT_FORMATS = new Set(['ROUND_ROBIN', 'KNOCKOUT', 'LEAGUE_PLAYOFFS', 'GROUP_KNOCKOUT']);
const TOURNAMENT_STATUSES = new Set(['DRAFT', 'UPCOMING', 'REGISTRATION_OPEN', 'ONGOING', 'COMPLETED', 'ARCHIVED']);
const slugify = (value) => String(value || '')
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function parseTournamentPayload(body) {
  const name = String(body.name || '').trim();
  const slug = slugify(body.slug || name);
  const oversPerInnings = Number.parseInt(body.oversPerInnings, 10);
  const format = body.format || 'ROUND_ROBIN';
  const status = body.status || 'DRAFT';
  if (name.length < 3 || name.length > 160) throw new Error('Tournament name must contain 3–160 characters.');
  if (!slug) throw new Error('A valid tournament URL slug is required.');
  if (!Number.isInteger(oversPerInnings) || oversPerInnings < 1 || oversPerInnings > 100) {
    throw new Error('Overs per innings must be between 1 and 100.');
  }
  if (!TOURNAMENT_FORMATS.has(format)) throw new Error('Unsupported tournament format.');
  if (!TOURNAMENT_STATUSES.has(status)) throw new Error('Unsupported tournament status.');
  return {
    name, slug, description: String(body.description || '').trim(), startDate: body.startDate || null,
    endDate: body.endDate || null, venues: Array.isArray(body.venues) ? body.venues.filter(Boolean) : [],
    format, status, oversPerInnings,
    pointsForWin: Number.isInteger(Number(body.pointsForWin)) ? Number(body.pointsForWin) : 2,
    pointsForLoss: Number.isInteger(Number(body.pointsForLoss)) ? Number(body.pointsForLoss) : 0,
    pointsForTie: Number.isInteger(Number(body.pointsForTie)) ? Number(body.pointsForTie) : 1,
    pointsForNoResult: Number.isInteger(Number(body.pointsForNoResult)) ? Number(body.pointsForNoResult) : 1,
    qualificationRules: body.qualificationRules && typeof body.qualificationRules === 'object' ? body.qualificationRules : {},
    playingRules: body.playingRules && typeof body.playingRules === 'object' ? body.playingRules : {},
    isPublished: Boolean(body.isPublished),
  };
}

function parseEntityPayload(body, type) {
  const name = String(type === 'TEAM' ? body.name || '' : body.fullName || '').trim();
  const slug = slugify(body.slug || name);
  if (name.length < 2 || name.length > 140 || !slug) throw new Error(`A valid ${type.toLowerCase()} name is required.`);
  if (type === 'TEAM') return { name, slug, abbreviation: String(body.abbreviation || '').trim().slice(0, 10), description: String(body.description || '').trim(), logoUrl: body.logoUrl || null };
  const validRoles = new Set(['BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER']);
  if (body.playingRole && !validRoles.has(body.playingRole)) throw new Error('Unsupported playing role.');
  return { fullName: name, slug, photoUrl: body.photoUrl || null, dateOfBirth: body.dateOfBirth || null,
    battingStyle: body.battingStyle || null, bowlingStyle: body.bowlingStyle || null,
    playingRole: body.playingRole || null, bio: String(body.bio || '').trim() };
}

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.post('/api/auth/admin-session', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  if (!configuredAdminPin) return res.status(503).json({ error: 'ADMIN_PIN is not configured on the server.' });
  if (!compareSecret(String(req.body?.pin || ''), configuredAdminPin)) return res.status(401).json({ error: 'Incorrect PIN.' });
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, expiresAt);
  res.json({ token, expiresAt, role: 'SUPER_ADMIN' });
});

// ─── TOURNAMENT API ────────────────────────────────────────────────────────
// Public reads return published tournaments only. The administrative endpoints
// are deliberately separate while server-side role middleware is introduced.
app.get('/api/tournaments', async (req, res) => {
  try { res.json(await listTournaments({ publishedOnly: true })); }
  catch (error) { res.status(500).json({ error: 'Unable to load tournaments.' }); }
});

app.get('/api/admin/tournaments', requireAdmin, async (_req, res) => {
  try { res.json(await listTournaments()); }
  catch (error) { res.status(500).json({ error: 'Unable to load tournaments.' }); }
});

app.get('/api/admin/tournaments/:slug', requireAdmin, async (req, res) => {
  try {
    const tournament = await getTournamentBySlug(req.params.slug);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    res.json({ ...tournament, ...(await getTournamentDirectory(tournament.id)) });
  } catch { res.status(500).json({ error: 'Unable to load the tournament.' }); }
});

app.get('/api/tournaments/:slug', async (req, res) => {
  try {
    const tournament = await getTournamentBySlug(req.params.slug, { publishedOnly: true });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    const directory = await getTournamentDirectory(tournament.id);
    res.json({ ...tournament, ...directory });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load the tournament.' });
  }
});

app.post('/api/admin/tournaments', requireAdmin, async (req, res) => {
  try {
    const tournament = await createTournament(parseTournamentPayload(req.body));
    res.status(201).json(tournament);
  } catch (error) {
    const duplicate = error.code === '23505';
    res.status(duplicate ? 409 : 400).json({ error: duplicate ? 'That tournament name or URL slug is already in use.' : error.message });
  }
});

app.put('/api/admin/tournaments/:id', requireAdmin, async (req, res) => {
  try {
    const tournament = await updateTournament(Number(req.params.id), parseTournamentPayload(req.body));
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    res.json(tournament);
  } catch (error) {
    res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'That tournament name or URL slug is already in use.' : error.message });
  }
});

app.get('/api/teams', async (_req, res) => {
  try { res.json(await listTeams()); }
  catch { res.status(500).json({ error: 'Unable to load teams.' }); }
});
app.post('/api/admin/teams', requireAdmin, async (req, res) => {
  try { res.status(201).json(await createTeam(parseEntityPayload(req.body, 'TEAM'))); }
  catch (error) { res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'That team name or slug already exists.' : error.message }); }
});
app.get('/api/players', async (_req, res) => {
  try { res.json(await listPlayers()); }
  catch { res.status(500).json({ error: 'Unable to load players.' }); }
});
app.post('/api/admin/players', requireAdmin, async (req, res) => {
  try { res.status(201).json(await createPlayer(parseEntityPayload(req.body, 'PLAYER'))); }
  catch (error) { res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'That player URL slug already exists.' : error.message }); }
});
app.post('/api/admin/tournaments/:id/teams/:teamId', requireAdmin, async (req, res) => {
  try { res.status(201).json(await registerTournamentTeam(Number(req.params.id), Number(req.params.teamId), req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/admin/tournaments/:id/players/:playerId', requireAdmin, async (req, res) => {
  try { res.status(201).json(await registerTournamentPlayer(Number(req.params.id), Number(req.params.playerId), req.body)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/tournaments/:slug/fixtures', async (req, res) => {
  try {
    const tournament = await getTournamentBySlug(req.params.slug, { publishedOnly: true });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    res.json(await listTournamentFixtures(tournament.id, { publishedOnly: true }));
  } catch { res.status(500).json({ error: 'Unable to load fixtures.' }); }
});
app.get('/api/admin/tournaments/:slug/fixtures', requireAdmin, async (req, res) => {
  try {
    const tournament = await getTournamentBySlug(req.params.slug);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });
    res.json(await listTournamentFixtures(tournament.id));
  } catch { res.status(500).json({ error: 'Unable to load fixtures.' }); }
});
app.post('/api/admin/tournaments/:id/fixtures', requireAdmin, async (req, res) => {
  try {
    const { team1Id, team2Id } = req.body;
    const maxOvers = Number.parseInt(req.body.maxOvers, 10);
    if (!Number.isInteger(Number(team1Id)) || !Number.isInteger(Number(team2Id)) || Number(team1Id) === Number(team2Id)) throw new Error('Choose two different registered teams.');
    if (!Number.isInteger(maxOvers) || maxOvers < 1 || maxOvers > 100) throw new Error('Overs must be between 1 and 100.');
    res.status(201).json(await createFixture({ tournamentId: Number(req.params.id), team1Id: Number(team1Id), team2Id: Number(team2Id), maxOvers,
      matchNumber: String(req.body.matchNumber || '').trim(), venue: String(req.body.venue || '').trim(), scheduledAt: req.body.scheduledAt || null, isPublished: Boolean(req.body.isPublished) }));
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/admin/fixtures/:id/start-scoring', requireAdmin, async (req, res) => {
  try {
    const fixture = await getFixtureForScoring(Number(req.params.id));
    if (!fixture) return res.status(404).json({ error: 'Fixture not found.' });
    if (matchState.status === 'live') return res.status(409).json({ error: 'Finish or reset the current live match before starting another fixture.' });
    matchState = {
      ...createMatchState(),
      status: 'live', dbMatchId: fixture.id, fixtureId: fixture.id, tournamentId: fixture.tournamentId,
      team1Id: fixture.team1Id, team2Id: fixture.team2Id, team1Name: fixture.team1Name,
      team2Name: fixture.team2Name, maxOvers: fixture.maxOvers,
      players: fixture.team1Players.map((player) => ({ id: player.id, name: player.name, runs: 0, balls: 0, fours: 0, sixes: 0, status: 'yet_to_bat' })),
      bowlers: fixture.team2Players.map((player) => ({ id: player.id, name: player.name, ballsBowled: 0, runsConceded: 0, wickets: 0 })),
    };
    await markFixtureLive(fixture.id);
    broadcast();
    res.json({ success: true, matchId: fixture.id });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: allowedOrigins } });

// ─────────────────────────────────────────────────────────────────────────────
// MATCH STATE FACTORY
// ─────────────────────────────────────────────────────────────────────────────
const createMatchState = () => ({
  status        : 'not_started',
  team1Name     : '',
  team2Name     : '',
  maxOvers      : 0,
  currentInning : 1,
  target        : null,
  targetReached : false,
  result        : null,
  inning1       : null,
  dbMatchId     : null,   // ← PostgreSQL matches.id

  totalRuns        : 0,
  wickets          : 0,
  legalBalls       : 0,
  extras           : { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 },
  players          : [],
  bowlers          : [],
  strikerId        : null,
  nonStrikerId     : null,
  currentBowlerId  : null,
  currentOverBalls : [],
  overHistory      : [],
  fallOfWickets    : [],
  waitingForBatsman: false,
  allOut           : false,
  lastBall         : null,
  lastAction       : '',
  undoStack        : [],
  auditTrail       : [],
});

let matchState = createMatchState();
let _nextId = 1;
const nextId = () => _nextId++;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const getOverStr = () => {
  const legal = matchState.currentOverBalls.filter(b => !String(b).startsWith('Wd') && !String(b).startsWith('Nb')).length;
  return `${matchState.overHistory.length}.${legal}`;
};

const rotateStrike = () => {
  [matchState.strikerId, matchState.nonStrikerId] =
    [matchState.nonStrikerId, matchState.strikerId];
};

const legalInCurrentOver = () =>
  matchState.currentOverBalls.filter(b => !String(b).startsWith('Wd') && !String(b).startsWith('Nb')).length;

const isAllOut = () => {
  const maxWickets = Math.min(matchState.players.length - 1, 10);
  return matchState.wickets >= maxWickets;
};

const isOverLimitReached = () =>
  matchState.maxOvers > 0 &&
  matchState.overHistory.length >= matchState.maxOvers;

/** Broadcast and persist every time state changes */
const broadcast = (state = matchState) => {
  io.emit('matchState', state);
  saveActiveMatch(state);
};

// ─────────────────────────────────────────────────────────────────────────────
// RESULT STRING
// ─────────────────────────────────────────────────────────────────────────────
function calcResult() {
  const s     = matchState;
  const team1 = s.team1Name || 'Team 1';
  const team2 = s.team2Name || 'Team 2';
  if (s.currentInning === 1) return `${team1}: ${s.totalRuns}/${s.wickets} · Match ended in Inning 1`;
  if (s.totalRuns >= s.target) {
    const maxWkts = Math.min(s.players.length - 1, 10);
    const left    = maxWkts - s.wickets;
    return `🏆 ${team2} won by ${left} wicket${left !== 1 ? 's' : ''}!`;
  }
  if (s.totalRuns === s.target - 1) return '🤝 Match Tied!';
  const margin = s.target - s.totalRuns - 1;
  return `🏆 ${team1} won by ${margin} run${margin !== 1 ? 's' : ''}!`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BALL PROCESSING
// ─────────────────────────────────────────────────────────────────────────────
function processBall(input) {
  const s = matchState;
  if (s.status !== 'live')              return 'Match is not live.';
  if (s.allOut)                         return 'Innings is over — all out or over limit reached.';
  if (s.targetReached)                  return 'Target already reached!';
  if (s.waitingForBatsman)              return 'Select the next batsman first!';
  if (!s.strikerId || !s.nonStrikerId)  return 'Set striker and non-striker first!';
  if (!s.currentBowlerId)              return 'Select a bowler for this over!';

  const striker = s.players.find(p => p.id === s.strikerId);
  const bowler  = s.bowlers.find(b => b.id === s.currentBowlerId);
  if (!striker || !bowler) return 'Invalid player or bowler selection.';

  // Keep a bounded, in-memory recovery point for the active match. The full
  // pre-change state remains in the audit trail instead of being overwritten.
  const recoveryPoint = JSON.parse(JSON.stringify({ ...s, undoStack: [], auditTrail: [] }));
  s.undoStack = [...(s.undoStack || []), recoveryPoint].slice(-30);

  s.lastBall = typeof input === 'string' ? input : input?.kind;
  const overNum    = s.overHistory.length;
  const ballInOver = legalInCurrentOver() + 1;
  let outcome;
  try { outcome = applyDelivery(s, input, { striker, bowler }); }
  catch (error) { return error.message; }
  s.currentOverBalls.push(outcome.label);
  saveBallEvent(s.dbMatchId, s.currentInning, overNum, ballInOver, outcome.label, striker.name, bowler.name, outcome.totalRuns);
  s.auditTrail = [...(s.auditTrail || []), {
    at: new Date().toISOString(), action: 'DELIVERY_ADDED', event: outcome.event,
    label: outcome.label, scoreAfter: `${s.totalRuns}/${s.wickets}`,
  }].slice(-200);

  if (outcome.wicket) {
    s.fallOfWickets.push({ wicketNum: s.wickets, score: s.totalRuns, over: getOverStr(), playerName: striker.name });
    if (isAllOut()) {
      s.allOut = true; s.lastAction = `OUT! ${striker.name} · All Out!`;
      s.strikerId = null; s.waitingForBatsman = false;
    } else {
      s.lastAction = `OUT! ${striker.name}`; s.strikerId = null; s.waitingForBatsman = true;
    }
  } else {
    if (outcome.rotateStrike) rotateStrike();
    if (outcome.event.kind === 'WIDE') s.lastAction = `Wide · +${outcome.totalRuns}`;
    else if (outcome.event.kind === 'NO_BALL') s.lastAction = `No ball · +${outcome.totalRuns}`;
    else if (outcome.event.kind === 'BYE') s.lastAction = `Bye · +${outcome.totalRuns}`;
    else if (outcome.event.kind === 'LEG_BYE') s.lastAction = `Leg bye · +${outcome.totalRuns}`;
    else if (outcome.event.batterRuns === 6) s.lastAction = '💥 SIX!';
    else if (outcome.event.batterRuns === 4) s.lastAction = '🔥 FOUR!';
    else if (outcome.totalRuns === 0) s.lastAction = 'Dot ball';
    else s.lastAction = `${outcome.totalRuns} run${outcome.totalRuns !== 1 ? 's' : ''}`;
  }

  if (s.currentInning === 2 && s.target !== null && s.totalRuns >= s.target) {
    s.targetReached = true; s.lastAction += ' · 🏆 Target Reached!';
  }

  // ── OVER COMPLETE ─────────────────────────────────────────────────────────
  if (outcome.legal) {
    if (legalInCurrentOver() >= 6) {
      s.overHistory.push([...s.currentOverBalls]);
      s.currentOverBalls = []; s.currentBowlerId = null;
      if (!s.waitingForBatsman && !s.allOut) rotateStrike();
      if (isOverLimitReached()) { s.allOut = true; }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// REST API — Stats endpoints (served from PostgreSQL views)
// ─── ANALYTICS VIEWS (Legacy) ────────────────────────────────────────────────
app.get('/api/stats/points-table', async (_req, res) => {
  try { res.json((await getPointsTable()).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/stats/batting', async (req, res) => {
  try {
    const data = await getBattingStats();
    res.json(data.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/stats/bowling', async (req, res) => {
  try {
    const data = await getBowlingStats();
    res.json(data.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/stats/teams', async (req, res) => {
  try {
    const data = await getTeamStats();
    res.json(data.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── MATCH DETAILS ───────────────────────────────────────────────────────────
app.get('/api/tournament/match/:id', async (req, res) => {
  try {
    const matchId = parseInt(req.params.id);
    if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid Match ID' });
    const data = await getMatchFullState(matchId);
    if (data.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
    res.json(data.rows[0].full_state || {});
  } catch (e) {
    console.error('Fetch match details error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats/matches', async (_req, res) => {
  try { res.json((await getMatchHistory()).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/matches/:id/balls', async (req, res) => {
  try { res.json((await getMatchBalls(req.params.id)).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// /api/ai/* was removed

// ─── YEH-RRD DYNAMIC TOURNAMENT STANDINGS (PUBLIC) ─────────────────────────────────────
app.get('/api/tournament/standings', async (_req, res) => {
  try {
    const standings = await getPublicStandings();
    res.json(standings);
  } catch (e) {
    console.error('Tournament standings error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN STANDINGS MANAGEMENT ──────────────────────────────────────────────
app.get('/api/admin/standings', requireAdmin, async (_req, res) => {
  try {
    const data = await getAdminStandings();
    res.json(data);
  } catch (e) {
    console.error('Admin standings fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/standings/draft', requireAdmin, async (req, res) => {
  try {
    const { standings } = req.body;
    if (!standings || !Array.isArray(standings)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }
    await saveDraftStandings(standings, 'Admin');
    res.json({ success: true });
  } catch (e) {
    console.error('Save draft error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/standings/publish', requireAdmin, async (req, res) => {
  try {
    await publishStandings('Admin');
    io.emit('pointsTableUpdated');
    res.json({ success: true });
  } catch (e) {
    console.error('Publish standings error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);
  socket.emit('matchState', matchState);

  // Spectators may subscribe to live state, but every mutation requires the
  // server-issued administrator session attached during the Socket.IO handshake.
  socket.use((packet, next) => {
    if (packet[0] === 'requestState') return next();
    if (!validAdminSession(socket.handshake.auth?.token)) {
      socket.emit('ballError', 'Administrator authentication is required.');
      return next(new Error('Administrator authentication is required.'));
    }
    return next();
  });

  socket.on('requestState', () => socket.emit('matchState', matchState));

  // ── CONFIG ────────────────────────────────────────────────────────────────
  socket.on('updateMatchConfig', ({ team1Name, team2Name, maxOvers }) => {
    if (team1Name !== undefined) matchState.team1Name = String(team1Name).trim();
    if (team2Name !== undefined) matchState.team2Name = String(team2Name).trim();
    if (maxOvers  !== undefined) matchState.maxOvers  = parseInt(maxOvers) || 0;
    broadcast();
  });

  // ── START MATCH ───────────────────────────────────────────────────────────
  socket.on('startMatch', async () => {
    if (!matchState.team1Name || !matchState.team2Name) {
      return socket.emit('ballError', 'Set both team names before starting!');
    }
    if (matchState.players.length < 2) {
      return socket.emit('ballError', 'Add at least 2 batsmen before starting!');
    }
    if (matchState.bowlers.length < 1) {
      return socket.emit('ballError', 'Add at least 1 bowler before starting!');
    }
    // Create DB record
    const dbId = await createMatchRecord(matchState.team1Name, matchState.team2Name, matchState.maxOvers);
    matchState.dbMatchId = dbId;
    matchState.status = 'live';
    broadcast();
  });

  // ── END INNING 1 ──────────────────────────────────────────────────────────
  socket.on('endInning', () => {
    if (matchState.status !== 'live' || matchState.currentInning !== 1) return;
    matchState.inning1 = {
      totalRuns    : matchState.totalRuns,
      wickets      : matchState.wickets,
      overHistory  : JSON.parse(JSON.stringify(matchState.overHistory)),
      currentOverBalls: [...matchState.currentOverBalls],
      extras       : { ...matchState.extras },
      players      : JSON.parse(JSON.stringify(matchState.players)),
      bowlers      : JSON.parse(JSON.stringify(matchState.bowlers)),
      fallOfWickets: JSON.parse(JSON.stringify(matchState.fallOfWickets)),
    };
    // Persist inning 1 stats to PostgreSQL via stored functions
    persistInningStats(matchState.players, matchState.bowlers);
    matchState.status = 'inning_break';
    broadcast();
  });

  // ── START INNING 2 ────────────────────────────────────────────────────────
  socket.on('startInning2', () => {
    if (matchState.status !== 'inning_break') return;
    const oldPlayers = matchState.players;
    const oldBowlers = matchState.bowlers;

    matchState.players = oldBowlers.map(b => ({
      id: nextId(), name: b.name,
      runs: 0, balls: 0, fours: 0, sixes: 0, status: 'yet_to_bat',
    }));
    matchState.bowlers = oldPlayers.map(p => ({
      id: nextId(), name: p.name,
      ballsBowled: 0, runsConceded: 0, wickets: 0,
    }));

    matchState.currentInning    = 2;
    matchState.totalRuns        = 0;
    matchState.wickets          = 0;
    matchState.legalBalls       = 0;
    matchState.extras           = { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 };
    matchState.strikerId        = null;
    matchState.nonStrikerId     = null;
    matchState.currentBowlerId  = null;
    matchState.currentOverBalls = [];
    matchState.overHistory      = [];
    matchState.fallOfWickets    = [];
    matchState.waitingForBatsman= false;
    matchState.allOut           = false;
    matchState.lastBall         = null;
    matchState.lastAction       = '';
    matchState.target           = matchState.inning1.totalRuns + 1;
    matchState.targetReached    = false;
    matchState.status           = 'live';
    broadcast();
  });

  // ── END MATCH ─────────────────────────────────────────────────────────────
  socket.on('endMatch', async () => {
    if (matchState.status !== 'live') return;
    matchState.result = calcResult();
    matchState.status = 'finished';
    broadcast();

    // Persist final state and update all career/team stats via stored functions
    await archiveMatch(matchState.dbMatchId, matchState);
    await persistInningStats(matchState.players, matchState.bowlers); // inning 2
    await persistTeamStats(matchState);
    clearActiveMatch();
  });

  // ── UPDATE POINTS TABLE (deprecated — kept for backwards compat) ──────────
  socket.on('updatePointsTable', async () => {
    // Old IPL-style NRR logic removed. Standings are now dynamically computed.
    // Just emit a refresh signal so clients know to re-fetch.
    console.log('⚠️  updatePointsTable event received — standings are now dynamic, no action needed.');
    io.emit('pointsTableUpdated');
  });

  // ── RESET ─────────────────────────────────────────────────────────────────
  socket.on('resetMatch', () => {
    matchState = createMatchState();
    _nextId = 1;
    clearActiveMatch();
    broadcast();
  });

  // ── SQUAD ─────────────────────────────────────────────────────────────────
  socket.on('addPlayer', ({ name }) => {
    if (!name?.trim()) return;
    matchState.players.push({ id: nextId(), name: name.trim(), runs: 0, balls: 0, fours: 0, sixes: 0, status: 'yet_to_bat' });
    broadcast();
  });
  socket.on('removePlayer', ({ playerId }) => {
    matchState.players = matchState.players.filter(p => p.id !== playerId);
    if (matchState.strikerId    === playerId) matchState.strikerId    = null;
    if (matchState.nonStrikerId === playerId) matchState.nonStrikerId = null;
    broadcast();
  });
  socket.on('addBowler', ({ name }) => {
    if (!name?.trim()) return;
    matchState.bowlers.push({ id: nextId(), name: name.trim(), ballsBowled: 0, runsConceded: 0, wickets: 0 });
    broadcast();
  });
  socket.on('removeBowler', ({ bowlerId }) => {
    matchState.bowlers = matchState.bowlers.filter(b => b.id !== bowlerId);
    if (matchState.currentBowlerId === bowlerId) matchState.currentBowlerId = null;
    broadcast();
  });

  // ── SELECTION ─────────────────────────────────────────────────────────────
  socket.on('setStriker', ({ playerId }) => {
    const p = matchState.players.find(x => x.id === playerId);
    if (p && p.status !== 'out') { p.status = 'batting'; matchState.strikerId = playerId; }
    broadcast();
  });
  socket.on('setNonStriker', ({ playerId }) => {
    const p = matchState.players.find(x => x.id === playerId);
    if (p && p.status !== 'out') { p.status = 'batting'; matchState.nonStrikerId = playerId; }
    broadcast();
  });
  socket.on('setCurrentBowler', ({ bowlerId }) => {
    matchState.currentBowlerId = bowlerId;
    broadcast();
  });
  socket.on('selectNextBatsman', ({ playerId }) => {
    const p = matchState.players.find(x => x.id === playerId);
    if (p && p.status !== 'out') { p.status = 'batting'; matchState.strikerId = playerId; matchState.waitingForBatsman = false; }
    broadcast();
  });

  // ── BALL ──────────────────────────────────────────────────────────────────
  socket.on('addBall', (payload) => {
    const error = processBall(payload?.event || payload?.type);
    if (error) socket.emit('ballError', error);
    else       broadcast();
  });

  socket.on('undoLastDelivery', () => {
    const stack = matchState.undoStack || [];
    if (!stack.length) return socket.emit('ballError', 'There is no delivery to undo.');
    const previous = stack[stack.length - 1];
    const auditTrail = [...(matchState.auditTrail || []), {
      at: new Date().toISOString(), action: 'DELIVERY_UNDONE', scoreBefore: `${matchState.totalRuns}/${matchState.wickets}`,
    }].slice(-200);
    matchState = { ...previous, undoStack: stack.slice(0, -1), auditTrail };
    broadcast();
  });

  socket.on('disconnect', () => console.log('❌ Disconnected:', socket.id));
});

// ─────────────────────────────────────────────────────────────────────────────
// STAT PERSISTENCE HELPERS  (call PostgreSQL stored functions, no logic in JS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist batting + bowling stats for one inning to PostgreSQL.
 * Calls record_match_participation() once per unique player, then
 * upsert_batting_stats() and upsert_bowling_stats() as stored functions.
 */
async function persistInningStats(players, bowlers) {
  // Collect all unique names who actually played
  const participants = new Set([
    ...players.filter(p => p.balls > 0 || p.status !== 'yet_to_bat').map(p => p.name),
    ...bowlers.filter(b => b.ballsBowled > 0).map(b => b.name),
  ]);

  // matches_played++ once per player
  for (const name of participants) await recordMatchParticipation(name);

  // Batting — calls upsert_batting_stats stored function
  for (const p of players) {
    if (p.balls === 0 && p.status === 'yet_to_bat') continue;
    await upsertBattingStats(p.name, p.runs, p.balls, p.fours, p.sixes, p.status !== 'out');
  }

  // Bowling — calls upsert_bowling_stats stored function
  for (const b of bowlers) {
    if (b.ballsBowled === 0) continue;
    await upsertBowlingStats(b.name, b.ballsBowled, b.runsConceded, b.wickets);
  }
}

/**
 * Persist team win/loss record — calls upsert_team_record stored function.
 */
async function persistTeamStats(s) {
  const inn1   = s.inning1;
  const tied   = s.result.includes('Tied');
  const team1Won = s.result.includes(s.team1Name) && s.result.includes('won');
  const team2Won = s.result.includes(s.team2Name) && s.result.includes('won');

  const inn1Runs    = inn1 ? inn1.totalRuns : 0;
  const inn1Wickets = inn1 ? inn1.wickets   : 0;
  const inn2Runs    = s.currentInning === 2 ? s.totalRuns : 0;
  const inn2Wickets = s.currentInning === 2 ? s.wickets   : 0;

  // Team 1 scored in inn1, team 2 took inn1 wickets as bowling team
  await upsertTeamRecord(s.team1Name, inn1Runs,  inn2Wickets, team1Won, team2Won, tied);
  // Team 2 scored in inn2, team 1 took inn2 wickets as bowling team
  await upsertTeamRecord(s.team2Name, inn2Runs,  inn1Wickets, team2Won, team1Won, tied);
}

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP — restore state from DB then listen
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../dist')));
app.get('/*path', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const PORT = process.env.PORT || 5000;

(async () => {
  const saved = await loadActiveMatch();
  if (saved && saved.status && saved.status !== 'finished') {
    matchState = { ...createMatchState(), ...saved };
    console.log(`📂 Restored: ${saved.team1Name} vs ${saved.team2Name} [${saved.status}]`);
    // Recalculate _nextId so new IDs don't clash
    const allIds = [...(saved.players || []), ...(saved.bowlers || [])].map(x => x.id).filter(Boolean);
    if (allIds.length) _nextId = Math.max(...allIds) + 1;
  }

  server.listen(PORT, () => console.log(`🚀 Cricket server running on port ${PORT}`));
})();
