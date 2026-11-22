const assert = require('node:assert/strict');
const { applyDelivery } = require('../scoring-engine');

const createState = () => ({ totalRuns: 0, wickets: 0, legalBalls: 0, extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 } });
const createBatter = () => ({ runs: 0, balls: 0, fours: 0, sixes: 0, status: 'batting' });
const createBowler = () => ({ ballsBowled: 0, runsConceded: 0, wickets: 0 });

{ const s = createState(), p = createBatter(), b = createBowler(); applyDelivery(s, { kind: 'WIDE', extraRuns: 2 }, { striker: p, bowler: b }); assert.deepEqual([s.totalRuns, s.legalBalls, b.ballsBowled, b.runsConceded, s.extras.wides], [2, 0, 0, 2, 2]); }
{ const s = createState(), p = createBatter(), b = createBowler(); applyDelivery(s, { kind: 'BYE', extraRuns: 3 }, { striker: p, bowler: b }); assert.deepEqual([s.totalRuns, s.legalBalls, p.balls, b.runsConceded, s.extras.byes], [3, 1, 1, 0, 3]); }
{ const s = createState(), p = createBatter(), b = createBowler(); applyDelivery(s, { kind: 'NO_BALL', batterRuns: 4, extraRuns: 1 }, { striker: p, bowler: b }); assert.deepEqual([s.totalRuns, s.legalBalls, p.runs, p.balls, b.runsConceded], [5, 0, 4, 0, 5]); }
{ const s = createState(), p = createBatter(), b = createBowler(); applyDelivery(s, { kind: 'WICKET', dismissalType: 'RUN_OUT' }, { striker: p, bowler: b }); assert.deepEqual([s.wickets, b.wickets, b.ballsBowled], [1, 0, 1]); }
console.log('scoring-engine tests passed');
