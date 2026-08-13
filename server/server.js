// Force IPv4 over IPv6 — fixes Render + Supabase ENETUNREACH error
require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config();
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const path    = require('path');

const {
  saveActiveMatch,
  loadActiveMatch,
  clearActiveMatch,
  createMatchRecord,
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

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

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
  extras           : { wides: 0, noBalls: 0 },
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
});

let matchState = createMatchState();
let _nextId = 1;
const nextId = () => _nextId++;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const getOverStr = () => {
  const legal = matchState.currentOverBalls.filter(b => b !== 'Wd' && b !== 'Nb').length;
  return `${matchState.overHistory.length}.${legal}`;
};

const rotateStrike = () => {
  [matchState.strikerId, matchState.nonStrikerId] =
    [matchState.nonStrikerId, matchState.strikerId];
};

const legalInCurrentOver = () =>
  matchState.currentOverBalls.filter(b => b !== 'Wd' && b !== 'Nb').length;

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
function processBall(type) {
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

  s.lastBall = type;
  const overNum    = s.overHistory.length;
  const ballInOver = legalInCurrentOver() + 1;

  // ── WIDE ──────────────────────────────────────────────────────────────────
  if (type === 'Wd') {
    s.totalRuns += 1; s.extras.wides += 1; bowler.runsConceded += 1;
    s.currentOverBalls.push('Wd');
    s.lastAction = 'Wide · +1';
    saveBallEvent(s.dbMatchId, s.currentInning, overNum, ballInOver, 'Wd', striker.name, bowler.name, 1);
    return null;
  }

  // ── NO BALL ───────────────────────────────────────────────────────────────
  if (type === 'Nb') {
    s.totalRuns += 1; s.extras.noBalls += 1; bowler.runsConceded += 1;
    s.currentOverBalls.push('Nb');
    s.lastAction = 'No Ball · +1';
    saveBallEvent(s.dbMatchId, s.currentInning, overNum, ballInOver, 'Nb', striker.name, bowler.name, 1);
    return null;
  }

  // ── WICKET ────────────────────────────────────────────────────────────────
  if (type === 'W') {
    s.wickets += 1; s.legalBalls += 1;
    striker.status = 'out';
    bowler.wickets += 1; bowler.ballsBowled += 1;
    s.currentOverBalls.push('W');
    s.fallOfWickets.push({ wicketNum: s.wickets, score: s.totalRuns, over: getOverStr(), playerName: striker.name });
    saveBallEvent(s.dbMatchId, s.currentInning, overNum, ballInOver, 'W', striker.name, bowler.name, 0);

    if (isAllOut()) {
      s.allOut = true; s.lastAction = `OUT! ${striker.name} · All Out!`;
      s.strikerId = null; s.waitingForBatsman = false;
    } else {
      s.lastAction = `OUT! ${striker.name}`; s.strikerId = null; s.waitingForBatsman = true;
    }

  // ── RUNS ──────────────────────────────────────────────────────────────────
  } else {
    const runs = parseInt(type) || 0;
    s.totalRuns += runs; striker.runs += runs; striker.balls += 1;
    if (runs === 4) striker.fours += 1;
    if (runs === 6) striker.sixes += 1;
    bowler.runsConceded += runs; bowler.ballsBowled += 1; s.legalBalls += 1;
    s.currentOverBalls.push(String(runs));

    saveBallEvent(s.dbMatchId, s.currentInning, overNum, ballInOver, String(runs), striker.name, bowler.name, runs);

    if      (runs === 6) s.lastAction = '💥 SIX!';
    else if (runs === 4) s.lastAction = '🔥 FOUR!';
    else if (runs === 0) s.lastAction = 'Dot ball';
    else                 s.lastAction = `${runs} run${runs !== 1 ? 's' : ''}`;

    if (runs % 2 === 1) rotateStrike();

    if (s.currentInning === 2 && s.target !== null && s.totalRuns >= s.target) {
      s.targetReached = true; s.lastAction += ' · 🏆 Target Reached!';
    }
  }

  // ── OVER COMPLETE ─────────────────────────────────────────────────────────
  if (type !== 'Wd' && type !== 'Nb') {
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
app.get('/api/admin/standings', async (_req, res) => {
  try {
    const data = await getAdminStandings();
    res.json(data);
  } catch (e) {
    console.error('Admin standings fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/standings/draft', async (req, res) => {
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

app.post('/api/admin/standings/publish', async (req, res) => {
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
    matchState.extras           = { wides: 0, noBalls: 0 };
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
  socket.on('addBall', ({ type }) => {
    const error = processBall(type);
    if (error) socket.emit('ballError', error);
    else       broadcast();
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