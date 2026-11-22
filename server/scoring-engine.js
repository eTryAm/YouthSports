/**
 * Central cricket-delivery rules for the live scorer.
 * It intentionally has no database or Socket.IO dependency, making the rules
 * deterministic and directly testable.
 */
const BOWLER_WICKETS = new Set(['BOWLED', 'CAUGHT', 'CAUGHT_AND_BOWLED', 'LBW', 'STUMPED', 'HIT_WICKET']);

function normaliseDelivery(input) {
  if (typeof input === 'string') {
    if (/^[0-6]$/.test(input)) return { kind: 'RUN', batterRuns: Number(input) };
    if (input === 'Wd') return { kind: 'WIDE', extraRuns: 1 };
    if (input === 'Nb') return { kind: 'NO_BALL', extraRuns: 1, batterRuns: 0 };
    if (input === 'By') return { kind: 'BYE', extraRuns: 1 };
    if (input === 'Lb') return { kind: 'LEG_BYE', extraRuns: 1 };
    if (input === 'W') return { kind: 'WICKET', dismissalType: 'BOWLED' };
  }
  const kind = String(input?.kind || '').toUpperCase();
  const batterRuns = Number(input?.batterRuns || 0);
  const extraRuns = Number(input?.extraRuns || 0);
  if (!['RUN', 'WIDE', 'NO_BALL', 'BYE', 'LEG_BYE', 'PENALTY', 'WICKET'].includes(kind)) throw new Error('Unsupported scoring event.');
  if (![batterRuns, extraRuns].every(Number.isInteger) || batterRuns < 0 || batterRuns > 6 || extraRuns < 0 || extraRuns > 7) throw new Error('Invalid runs for scoring event.');
  if (kind === 'RUN' && extraRuns) throw new Error('A run event cannot include extras.');
  if (kind === 'WIDE' && batterRuns) throw new Error('Wides cannot include batter runs.');
  if (kind === 'NO_BALL' && extraRuns < 1) return { kind, batterRuns, extraRuns: 1 };
  return { kind, batterRuns, extraRuns, dismissalType: input?.dismissalType || null, dismissedPlayerId: input?.dismissedPlayerId || null };
}

function applyDelivery(state, input, { striker, bowler }) {
  const event = normaliseDelivery(input);
  const legal = !['WIDE', 'NO_BALL'].includes(event.kind);
  const extras = state.extras || (state.extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 });
  for (const key of ['wides', 'noBalls', 'byes', 'legByes', 'penalty']) extras[key] ||= 0;
  const batterRuns = event.kind === 'RUN' || event.kind === 'NO_BALL' ? event.batterRuns : 0;
  let extraRuns = event.extraRuns;
  if (event.kind === 'WIDE') extras.wides += extraRuns;
  if (event.kind === 'NO_BALL') extras.noBalls += extraRuns;
  if (event.kind === 'BYE') extras.byes += extraRuns;
  if (event.kind === 'LEG_BYE') extras.legByes += extraRuns;
  if (event.kind === 'PENALTY') extras.penalty += extraRuns;

  const totalRuns = batterRuns + extraRuns;
  state.totalRuns += totalRuns;
  if (legal && event.kind !== 'WICKET') striker.balls += 1;
  if (batterRuns) {
    striker.runs += batterRuns;
    if (batterRuns === 4) striker.fours += 1;
    if (batterRuns === 6) striker.sixes += 1;
  }
  if (legal) { state.legalBalls += 1; bowler.ballsBowled += 1; }
  // Byes and leg-byes are team extras but are not charged to the bowler.
  if (!['BYE', 'LEG_BYE', 'PENALTY'].includes(event.kind)) bowler.runsConceded += totalRuns;

  const dismissalType = String(event.dismissalType || '').toUpperCase();
  const wicket = event.kind === 'WICKET';
  if (wicket) {
    state.wickets += 1;
    striker.status = 'out';
    if (BOWLER_WICKETS.has(dismissalType)) bowler.wickets += 1;
  }
  const rotationRuns = event.kind === 'PENALTY' ? 0 : totalRuns;
  const label = wicket ? 'W' : event.kind === 'WIDE' ? `Wd${extraRuns > 1 ? extraRuns : ''}` : event.kind === 'NO_BALL' ? `Nb${batterRuns ? `+${batterRuns}` : ''}` : event.kind === 'BYE' ? `B${extraRuns}` : event.kind === 'LEG_BYE' ? `Lb${extraRuns}` : event.kind === 'PENALTY' ? `P${extraRuns}` : String(batterRuns);
  return { event, legal, wicket, bowlerCredited: BOWLER_WICKETS.has(dismissalType), rotateStrike: rotationRuns % 2 === 1, totalRuns, label };
}

module.exports = { normaliseDelivery, applyDelivery, BOWLER_WICKETS };
