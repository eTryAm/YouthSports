import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "./socket.js";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
} from "recharts";
import CricketBg3D from "./CricketBg3D.jsx";
import "./Scoreboard.css";

function BallDot({ ball, mini }) {
  return <span className={`sb-ball-dot ball-${ball} ${mini ? "sb-ball-mini" : ""}`}>{ball}</span>;
}

function overRunTotal(overArr) {
  return overArr.reduce((sum, b) => {
    if (b === "W") return sum;
    if (b === "Wd" || b === "Nb") return sum + 1;
    return sum + (parseInt(b) || 0);
  }, 0);
}

export default function Scoreboard() {
  const navigate = useNavigate();
  const [match, setMatch]           = useState(null);
  const [connected, setConnected]   = useState(socket.connected);
  const [pulse, setPulse]           = useState(false);
  const prevRuns                    = useRef(0);

  useEffect(() => {
    const onConnect    = () => { setConnected(true); socket.emit("requestState"); };
    const onDisconnect = () => setConnected(false);
    const onMatchState = (data) => {
      setMatch(data);
      if (data.totalRuns !== prevRuns.current) {
        prevRuns.current = data.totalRuns;
        setPulse(true);
        setTimeout(() => setPulse(false), 600);
      }
    };

    socket.on("connect",    onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("matchState", onMatchState);
    if (socket.connected) socket.emit("requestState");

    return () => {
      socket.off("connect",    onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("matchState", onMatchState);
    };
  }, []);

  /* ── No server ─────────────────────────────────────────────────────────── */
  if (!connected && !match) {
    return (
      <div className="sb-loading">
        <div className="sb-spinner" />
        <p style={{ color: "#64748b", fontSize: 15 }}>Connecting to server…</p>
        <p style={{ color: "#334155", fontSize: 13, marginTop: 6 }}>
          Make sure backend is running: <code style={{ color: "#22c55e" }}>node server.js</code>
        </p>
      </div>
    );
  }

  if (!match) return <div className="sb-loading"><div className="sb-spinner" /><p>Loading…</p></div>;

  /* ── NOT STARTED: Three.js interactive background ──────────────────── */
  if (match.status === "not_started") {
    const matchTitle = match.team1Name && match.team2Name
      ? `${match.team1Name} vs ${match.team2Name}`
      : "Match Setup in Progress";
    return (
      <div style={{ position: 'relative', minHeight: '80vh' }}>
        <CricketBg3D message={matchTitle} />
        <button className="sb-ai-fab" onClick={() => setShowAiPanel(true)} title="AI Match Intelligence">
          <span className="sb-ai-fab-ring" />
          <span className="sb-ai-fab-ring r2" />
          🤖
        </button>
      </div>
    );
  }

  /* ── INNINGS BREAK: Three.js background + info overlay ──────────────── */
  if (match.status === "inning_break" && match.inning1) {
    return (
      <div style={{ position: 'relative', minHeight: '80vh' }}>
        <CricketBg3D message="⏸️ Innings Break" />

        {/* Info bar pinned to the bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(10,15,30,.88)', backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(99,102,241,.2)',
          padding: '20px 28px',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          justifyContent: 'center', gap: 32,
          fontFamily: "'Inter', sans-serif",
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#475569', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>{match.team1Name}</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#e2e8f0' }}>
              {match.inning1.totalRuns}
              <span style={{ color: '#475569', fontWeight: 400, fontSize: 24 }}>/{match.inning1.wickets}</span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{match.inning1.overHistory.length} overs · Extras {match.inning1.extras.wides + match.inning1.extras.noBalls}</div>
          </div>

          <div style={{
            textAlign: 'center', padding: '14px 28px',
            background: 'rgba(79,70,229,.12)',
            border: '1px solid rgba(99,102,241,.35)',
            borderRadius: 18,
          }}>
            <div style={{ fontSize: 11, color: '#818cf8', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>Target</div>
            <div style={{ fontSize: 42, fontWeight: 900, color: '#a5b4fc', lineHeight: 1 }}>{match.inning1.totalRuns + 1}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
              {match.team2Name} need <strong style={{ color: '#e2e8f0' }}>{match.inning1.totalRuns + 1}</strong> to win
              {match.maxOvers > 0 ? ` in ${match.maxOvers} overs` : ''}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#334155', letterSpacing: 2, textTransform: 'uppercase' }}>Status</div>
            <div style={{ fontSize: 14, color: '#64748b' }}>Inning 2 starting soon…</div>
            <div className="waiting-dots"><span /><span /><span /></div>
          </div>
        </div>

        <button className="sb-ai-fab" onClick={() => setShowAiPanel(true)} title="AI Insights">
          <span className="sb-ai-fab-ring" />
          <span className="sb-ai-fab-ring r2" />
          🤖
        </button>
      </div>
    );
  }

  /* ── FINISHED ───────────────────────────────────────────────────────────── */
  if (match.status === "finished") {
    const inn1 = match.inning1;
    return (
      <div className="sb-wrap">
        {/* Result banner */}
        <div className="sb-result-banner">
          <div className="sbr-emoji">🏏</div>
          <div className="sbr-result">{match.result || "Match Complete"}</div>
          {inn1 && (
            <div className="sbr-summary">
              {match.team1Name || "Team 1"}: {inn1.totalRuns}/{inn1.wickets}
              &nbsp;&nbsp;|&nbsp;&nbsp;
              {match.team2Name || "Team 2"}: {match.totalRuns}/{match.wickets}
            </div>
          )}
        </div>

        {/* AI Post-match analysis CTA */}
        <div className="sb-ai-banner sb-ai-banner--result" onClick={() => navigate('/insights')}>
          <div className="sb-ai-banner-left">
            <div className="sb-ai-glow-dot"></div>
            <div className="sb-ai-banner-text">
              <span className="sb-ai-label">🤖 POST-MATCH AI ANALYSIS</span>
              <span className="sb-ai-desc">Full match analysis · Player ratings · Key moments · CricketGPT review</span>
            </div>
          </div>
          <div className="sb-ai-banner-right">
            <div className="sb-ai-pill">Analysis</div>
            <div className="sb-ai-pill">Ratings</div>
            <div className="sb-ai-arrow">→</div>
          </div>
        </div>

        {/* Floating AI button */}
        <button className="sb-ai-fab" onClick={() => navigate('/insights')} title="AI Match Analysis">
          <span className="sb-ai-fab-ring" />
          <span className="sb-ai-fab-ring r2" />
          🤖
        </button>

        {/* Inning 1 batting */}
        {inn1 && inn1.players.some(p => p.balls > 0) && (
          <div className="sb-section">
            <div className="sb-section-title">
              Inning 1 — {match.team1Name || "Team 1"} Batting · {inn1.totalRuns}/{inn1.wickets}
            </div>
            <table className="sb-table">
              <thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
              <tbody>
                {inn1.players.filter(p => p.balls > 0 || p.status !== "yet_to_bat").map((p, i) => (
                  <tr key={i} className={p.status === "out" ? "sb-out-row" : ""}>
                    <td>{p.name}</td>
                    <td><strong>{p.runs}</strong></td>
                    <td>{p.balls}</td>
                    <td>{p.fours}</td>
                    <td>{p.sixes}</td>
                    <td>{p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(1) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Inning 1 bowling (Team 2 bowled during inning 1) */}
        {inn1 && inn1.bowlers && inn1.bowlers.some(b => b.ballsBowled > 0) && (
          <div className="sb-section">
            <div className="sb-section-title">{match.team2Name || "Team 2"} Bowling (Inning 1)</div>
            <table className="sb-table">
              <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
              <tbody>
                {inn1.bowlers.filter(b => b.ballsBowled > 0).map((b, i) => (
                  <tr key={i}>
                    <td>{b.name}</td>
                    <td>{Math.floor(b.ballsBowled/6)}.{b.ballsBowled%6}</td>
                    <td>{b.runsConceded}</td>
                    <td>{b.wickets}</td>
                    <td>{((b.runsConceded/b.ballsBowled)*6).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Inning 2 batting */}
        {match.players.some(p => p.balls > 0 || p.status !== "yet_to_bat") && (
          <div className="sb-section">
            <div className="sb-section-title">
              Inning 2 — {match.team2Name || "Team 2"} Batting · {match.totalRuns}/{match.wickets}
            </div>
            <table className="sb-table">
              <thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
              <tbody>
                {match.players.filter(p => p.balls > 0 || p.status !== "yet_to_bat").map((p, i) => (
                  <tr key={i} className={p.status === "out" ? "sb-out-row" : ""}>
                    <td>{p.name}</td>
                    <td><strong>{p.runs}</strong></td>
                    <td>{p.balls}</td>
                    <td>{p.fours}</td>
                    <td>{p.sixes}</td>
                    <td>{p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(1) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Inning 2 bowling (Team 1 bowled during inning 2) */}
        {match.bowlers && match.bowlers.some(b => b.ballsBowled > 0) && (
          <div className="sb-section">
            <div className="sb-section-title">{match.team1Name || "Team 1"} Bowling (Inning 2)</div>
            <table className="sb-table">
              <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
              <tbody>
                {match.bowlers.filter(b => b.ballsBowled > 0).map((b, i) => (
                  <tr key={i}>
                    <td>{b.name}</td>
                    <td>{Math.floor(b.ballsBowled/6)}.{b.ballsBowled%6}</td>
                    <td>{b.runsConceded}</td>
                    <td>{b.wickets}</td>
                    <td>{((b.runsConceded/b.ballsBowled)*6).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ── LIVE ───────────────────────────────────────────────────────────────── */
  const striker      = match.players.find(p => p.id === match.strikerId);
  const nonStriker   = match.players.find(p => p.id === match.nonStrikerId);
  const currentBowler= match.bowlers.find(b => b.id === match.currentBowlerId);

  const completedOvers  = match.overHistory.length;
  const ballsInThisOver = match.currentOverBalls.filter(b => b !== "Wd" && b !== "Nb").length;
  const totalLegalBalls = completedOvers * 6 + ballsInThisOver;
  const oversStr        = `${completedOvers}.${ballsInThisOver}`;
  const crr             = totalLegalBalls > 0
    ? ((match.totalRuns / totalLegalBalls) * 6).toFixed(2) : "0.00";
  const emptySlots      = Math.max(0, 6 - ballsInThisOver);
  const extrasTotal     = match.extras.wides + match.extras.noBalls;

  // Inning 2 chase data
  const isChase        = match.currentInning === 2 && match.target != null;
  const runsNeeded     = isChase ? Math.max(0, match.target - match.totalRuns) : null;
  const maxBalls       = match.maxOvers > 0 ? match.maxOvers * 6 : null;
  const ballsRemaining = maxBalls ? Math.max(0, maxBalls - totalLegalBalls) : null;
  const rrr            = isChase && ballsRemaining && runsNeeded > 0
    ? ((runsNeeded / ballsRemaining) * 6).toFixed(2) : null;

  const battingTeamName = match.currentInning === 1 ? (match.team1Name || "Team 1") : (match.team2Name || "Team 2");
  const bowlingTeamName = match.currentInning === 1 ? (match.team2Name || "Team 2") : (match.team1Name || "Team 1");

  const la      = match.lastBall;
  const laClass = la === "W" ? "la-wicket" : la === "4" ? "la-four" : la === "6" ? "la-six" : "";

  const battingChartData = match.players.filter(p => p.balls > 0)
    .map(p => ({ name: p.name, Runs: p.runs }));

  return (
    <div className="sb-wrap">

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div className={`sb-header ${pulse ? "sb-pulse" : ""}`}>
        <div className="sb-inning-badge">INNINGS {match.currentInning}</div>

        <div className="sb-teams">
          <span className={`sb-team-name ${match.currentInning === 1 ? "sb-batting-team" : ""}`}>
            {match.team1Name || "Team 1"}
          </span>
          <span className="sb-vs">vs</span>
          <span className={`sb-team-name ${match.currentInning === 2 ? "sb-batting-team" : ""}`}>
            {match.team2Name || "Team 2"}
          </span>
        </div>

        <div className="sb-score">
          <span className="sb-runs">{match.totalRuns}</span>
          <span className="sb-divider">/</span>
          <span className="sb-wickets">{match.wickets}</span>
        </div>

        <div className="sb-meta">
          <span>{oversStr} overs</span>
          <span className="sb-meta-sep">•</span>
          <span className="sb-crr">CRR {crr}</span>
          {extrasTotal > 0 && (
            <><span className="sb-meta-sep">•</span>
            <span className="sb-extras">Extras {extrasTotal} (wd {match.extras.wides}, nb {match.extras.noBalls})</span></>
          )}
        </div>

        {/* Inning 2 target chase row */}
        {isChase && (
          <div className="sb-chase-row">
            <div className="sb-chase-item">
              <span className="sb-chase-label">Target</span>
              <span className="sb-chase-val sb-target-val">{match.target}</span>
            </div>
            <div className="sb-chase-item">
              <span className="sb-chase-label">Need</span>
              <span className="sb-chase-val" style={{ color: runsNeeded === 0 ? "#4ade80" : "#fbbf24" }}>
                {runsNeeded}
              </span>
            </div>
            {rrr && (
              <div className="sb-chase-item">
                <span className="sb-chase-label">RRR</span>
                <span className="sb-chase-val" style={{ color: "#f87171" }}>{rrr}</span>
              </div>
            )}
            {ballsRemaining !== null && (
              <div className="sb-chase-item">
                <span className="sb-chase-label">Balls left</span>
                <span className="sb-chase-val">{ballsRemaining}</span>
              </div>
            )}
          </div>
        )}

        <div className={`sb-live-badge ${match.status}`}>
          {match.status === "live"
            ? <><div className="sb-live-dot" /> LIVE</>
            : <>✅ MATCH OVER</>}
        </div>
      </div>



      {match.lastAction && (
        <div className={`sb-last-action ${laClass}`}>{match.lastAction}</div>
      )}

      {/* ── CURRENT OVER ────────────────────────────────────────────────── */}
      <div className="sb-section">
        <div className="sb-section-title">Over {completedOvers + 1} · {ballsInThisOver} / 6</div>
        <div className="sb-over-row">
          {match.currentOverBalls.map((ball, i) => <BallDot key={i} ball={ball} />)}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <span key={`e${i}`} className="sb-ball-dot ball-empty">·</span>
          ))}
        </div>
      </div>

      {/* ── BATSMEN AT CREASE ───────────────────────────────────────────── */}
      {(striker || nonStriker) && (
        <div className="sb-section">
          <div className="sb-section-title">At the Crease · {battingTeamName}</div>
          <table className="sb-table">
            <thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
            <tbody>
              {striker && (
                <tr className="sb-striker-row">
                  <td><span className="striker-star">★</span>{striker.name} *</td>
                  <td><strong>{striker.runs}</strong></td>
                  <td>{striker.balls}</td>
                  <td>{striker.fours}</td>
                  <td>{striker.sixes}</td>
                  <td>{striker.balls > 0 ? ((striker.runs / striker.balls) * 100).toFixed(1) : "–"}</td>
                </tr>
              )}
              {nonStriker && (
                <tr>
                  <td>{nonStriker.name}</td>
                  <td><strong>{nonStriker.runs}</strong></td>
                  <td>{nonStriker.balls}</td>
                  <td>{nonStriker.fours}</td>
                  <td>{nonStriker.sixes}</td>
                  <td>{nonStriker.balls > 0 ? ((nonStriker.runs / nonStriker.balls) * 100).toFixed(1) : "–"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── CURRENT BOWLER ──────────────────────────────────────────────── */}
      {currentBowler && (
        <div className="sb-section">
          <div className="sb-section-title">Bowling · {bowlingTeamName}</div>
          <table className="sb-table">
            <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
            <tbody>
              <tr className="sb-bowler-row">
                <td>{currentBowler.name} 🎯</td>
                <td>{Math.floor(currentBowler.ballsBowled/6)}.{currentBowler.ballsBowled%6}</td>
                <td>{currentBowler.runsConceded}</td>
                <td>{currentBowler.wickets}</td>
                <td>{currentBowler.ballsBowled > 0 ? ((currentBowler.runsConceded/currentBowler.ballsBowled)*6).toFixed(2) : "–"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── BATTING SCORECARD ───────────────────────────────────────────── */}
      {match.players.some(p => p.status !== "yet_to_bat" || p.balls > 0) && (
        <div className="sb-section">
          <div className="sb-section-title">Batting — {battingTeamName}</div>
          <table className="sb-table">
            <thead><tr><th>Batsman</th><th>Status</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
            <tbody>
              {match.players.map(p => {
                if (p.status === "yet_to_bat" && p.balls === 0) return null;
                const isS = p.id === match.strikerId;
                return (
                  <tr key={p.id} className={isS ? "sb-striker-row" : p.status === "out" ? "sb-out-row" : ""}>
                    <td>{isS && <span className="striker-star">★</span>}{p.name}{isS ? " *" : ""}</td>
                    <td style={{ color: p.status === "out" ? "#ef4444" : p.status === "batting" ? "#22c55e" : "#64748b" }}>
                      {p.status === "out" ? "out" : p.status === "batting" ? "batting" : "dnb"}
                    </td>
                    <td><strong>{p.runs}</strong></td>
                    <td>{p.balls}</td>
                    <td>{p.fours}</td>
                    <td>{p.sixes}</td>
                    <td>{p.balls > 0 ? ((p.runs/p.balls)*100).toFixed(1) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── BOWLING SCORECARD ───────────────────────────────────────────── */}
      {match.bowlers.some(b => b.ballsBowled > 0) && (
        <div className="sb-section">
          <div className="sb-section-title">Bowling — {bowlingTeamName}</div>
          <table className="sb-table">
            <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
            <tbody>
              {match.bowlers.filter(b => b.ballsBowled > 0).map(b => (
                <tr key={b.id} className={b.id === match.currentBowlerId ? "sb-bowler-row" : ""}>
                  <td>{b.name}{b.id === match.currentBowlerId ? " 🎯" : ""}</td>
                  <td>{Math.floor(b.ballsBowled/6)}.{b.ballsBowled%6}</td>
                  <td>{b.runsConceded}</td>
                  <td>{b.wickets}</td>
                  <td>{((b.runsConceded/b.ballsBowled)*6).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── INNING 1 SCORECARD (visible during inning 2 and after match) ── */}
      {(match.currentInning === 2 || match.status === 'finished') && match.inning1 && (
        <>
          <div className="sb-section">
            <div className="sb-section-title">Inning 1 Batting — {match.team1Name || "Team 1"} · {match.inning1.totalRuns}/{match.inning1.wickets}</div>
            <table className="sb-table">
              <thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
              <tbody>
                {match.inning1.players.filter(p => p.balls > 0 || p.status !== "yet_to_bat").map((p, i) => (
                  <tr key={i} className={p.status === "out" ? "sb-out-row" : ""}>
                    <td>{p.name}</td>
                    <td><strong>{p.runs}</strong></td>
                    <td>{p.balls}</td>
                    <td>{p.fours}</td>
                    <td>{p.sixes}</td>
                    <td>{p.balls > 0 ? ((p.runs/p.balls)*100).toFixed(1) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {match.inning1.bowlers && match.inning1.bowlers.some(b => b.ballsBowled > 0) && (
            <div className="sb-section">
              <div className="sb-section-title">Inning 1 Bowling — {match.team2Name || "Team 2"}</div>
              <table className="sb-table">
                <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
                <tbody>
                  {match.inning1.bowlers.filter(b => b.ballsBowled > 0).map((b, i) => (
                    <tr key={i}>
                      <td>{b.name}</td>
                      <td>{Math.floor(b.ballsBowled/6)}.{b.ballsBowled%6}</td>
                      <td>{b.runsConceded}</td>
                      <td>{b.wickets}</td>
                      <td>{((b.runsConceded/b.ballsBowled)*6).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── FALL OF WICKETS ─────────────────────────────────────────────── */}
      {match.fallOfWickets.length > 0 && (
        <div className="sb-section">
          <div className="sb-section-title">Fall of Wickets</div>
          <div className="sb-fow-list">
            {match.fallOfWickets.map(fow => (
              <span key={fow.wicketNum} className="sb-fow-item">
                {fow.wicketNum}-{fow.score} ({fow.playerName}, {fow.over} ov)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── OVER HISTORY ────────────────────────────────────────────────── */}
      {match.overHistory.length > 0 && (
        <div className="sb-section">
          <div className="sb-section-title">Over History</div>
          <div className="sb-oh-list">
            {match.overHistory.map((over, i) => (
              <div key={i} className="sb-oh-row">
                <span className="sb-oh-num">Ov {i + 1}</span>
                <div className="sb-oh-balls">{over.map((ball, j) => <BallDot key={j} ball={ball} mini />)}</div>
                <span className="sb-oh-total">{overRunTotal(over)} runs</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CHART ───────────────────────────────────────────────────────── */}
      {battingChartData.length >= 2 && (
        <div className="sb-section sb-chart-wrap">
          <div className="sb-section-title">Run Chart</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={battingChartData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" stroke="#475569" tick={{ fontSize: 12 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 13 }} cursor={{ fill: "rgba(255,255,255,.04)" }} />
              <Bar dataKey="Runs" fill="#22c55e" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}
