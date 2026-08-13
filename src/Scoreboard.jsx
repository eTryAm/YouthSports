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
  const [activeTab, setActiveTab]   = useState("live");
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
      
      if (data.status === "finished" && activeTab === "live") {
        setActiveTab("scorecard");
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
  }, [activeTab]);

  /* ── No server ─────────────────────────────────────────────────────────── */
  if (!connected && !match) {
    return (
      <div className="sb-loading">
        <div className="sb-spinner" />
        <p style={{ color: "#64748b", fontSize: 15 }}>Connecting to server…</p>
      </div>
    );
  }

  if (!match) return <div className="sb-loading"><div className="sb-spinner" /><p>Loading…</p></div>;

  /* ── NOT STARTED ───────────────────────────────────────────────────────── */
  if (match.status === "not_started") {
    const matchTitle = match.team1Name && match.team2Name
      ? `${match.team1Name} vs ${match.team2Name}`
      : "Match Setup in Progress";
    return (
      <div style={{ position: 'relative', minHeight: '80vh' }}>
        <CricketBg3D message={matchTitle} />
      </div>
    );
  }

  /* ── INNINGS BREAK ─────────────────────────────────────────────────────── */
  if (match.status === "inning_break" && match.inning1) {
    return (
      <div style={{ position: 'relative', minHeight: '80vh' }}>
        <CricketBg3D message="⏸️ Innings Break" />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(10,15,30,.88)', backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(99,102,241,.2)',
          padding: '20px 28px', display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          justifyContent: 'center', gap: 32, fontFamily: "'Inter', sans-serif",
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#475569', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>{match.team1Name}</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#e2e8f0' }}>
              {match.inning1.totalRuns}
              <span style={{ color: '#475569', fontWeight: 400, fontSize: 24 }}>/{match.inning1.wickets}</span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{match.inning1.overHistory.length} overs</div>
          </div>
          <div style={{
            textAlign: 'center', padding: '14px 28px', background: 'rgba(79,70,229,.12)',
            border: '1px solid rgba(99,102,241,.35)', borderRadius: 18,
          }}>
            <div style={{ fontSize: 11, color: '#818cf8', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>Target</div>
            <div style={{ fontSize: 42, fontWeight: 900, color: '#a5b4fc', lineHeight: 1 }}>{match.inning1.totalRuns + 1}</div>
          </div>
        </div>
      </div>
    );
  }

  /* ── LIVE OR FINISHED DATA PREP ────────────────────────────────────────── */
  const completedOvers  = match.overHistory.length;
  const ballsInThisOver = match.currentOverBalls.filter(b => b !== "Wd" && b !== "Nb").length;
  const totalLegalBalls = completedOvers * 6 + ballsInThisOver;
  const oversStr        = `${completedOvers}.${ballsInThisOver}`;
  const crr             = totalLegalBalls > 0 ? ((match.totalRuns / totalLegalBalls) * 6).toFixed(2) : "0.00";
  const emptySlots      = Math.max(0, 6 - ballsInThisOver);
  const extrasTotal     = match.extras.wides + match.extras.noBalls;

  const isChase        = match.currentInning === 2 && match.target != null;
  const runsNeeded     = isChase ? Math.max(0, match.target - match.totalRuns) : null;
  const maxBalls       = match.maxOvers > 0 ? match.maxOvers * 6 : null;
  const ballsRemaining = maxBalls ? Math.max(0, maxBalls - totalLegalBalls) : null;
  const rrr            = isChase && ballsRemaining && runsNeeded > 0 ? ((runsNeeded / ballsRemaining) * 6).toFixed(2) : null;

  const battingTeamName = match.currentInning === 1 ? (match.team1Name || "Team 1") : (match.team2Name || "Team 2");
  const bowlingTeamName = match.currentInning === 1 ? (match.team2Name || "Team 2") : (match.team1Name || "Team 1");

  const laClass = match.lastAction === "W" ? "la-wicket" : match.lastAction === "4" ? "la-four" : match.lastAction === "6" ? "la-six" : "";

  const renderBattingTable = (title, players) => {
    if (!players || !players.some(p => p.balls > 0 || p.status !== "yet_to_bat")) return null;
    return (
      <div className="sb-section">
        <div className="sb-section-title">{title}</div>
        <table className="sb-table">
          <thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
          <tbody>
            {players.filter(p => p.balls > 0 || p.status !== "yet_to_bat").map((p, i) => (
              <tr key={i} className={p.status === "out" ? "sb-out-row" : ""}>
                <td>{p.name} {p.status === "out" ? "(c)" : p.status === "batting" ? "*" : ""}</td>
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
    );
  };

  const renderBowlingTable = (title, bowlers) => {
    if (!bowlers || !bowlers.some(b => b.ballsBowled > 0)) return null;
    return (
      <div className="sb-section">
        <div className="sb-section-title">{title}</div>
        <table className="sb-table">
          <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
          <tbody>
            {bowlers.filter(b => b.ballsBowled > 0).map((b, i) => (
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
    );
  };

  return (
    <div className="sb-wrap">
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div className={`sb-header ${pulse ? "sb-pulse" : ""}`}>
        {match.status === "finished" ? (
          <div className="sb-inning-badge" style={{ background: '#22c55e' }}>MATCH COMPLETE</div>
        ) : (
          <div className="sb-inning-badge">INNINGS {match.currentInning}</div>
        )}

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
        </div>

        {isChase && match.status !== "finished" && (
          <div className="sb-chase-row">
            <div className="sb-chase-item">
              <span className="sb-chase-label">Target</span>
              <span className="sb-chase-val sb-target-val">{match.target}</span>
            </div>
            <div className="sb-chase-item">
              <span className="sb-chase-label">Need</span>
              <span className="sb-chase-val">{runsNeeded}</span>
            </div>
            {ballsRemaining !== null && (
              <div className="sb-chase-item">
                <span className="sb-chase-label">Balls</span>
                <span className="sb-chase-val">{ballsRemaining}</span>
              </div>
            )}
          </div>
        )}

        {match.status === "finished" && match.result && (
          <div style={{ marginTop: 16, color: '#fbbf24', fontWeight: 600 }}>{match.result}</div>
        )}
      </div>

      {/* ── TAB BAR ─────────────────────────────────────────────────────── */}
      <div className="sb-tabs">
        {match.status !== "finished" && (
          <button className={`sb-tab ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
            Live
          </button>
        )}
        <button className={`sb-tab ${activeTab === 'scorecard' ? 'active' : ''}`} onClick={() => setActiveTab('scorecard')}>
          Scorecard
        </button>
        <button className={`sb-tab ${activeTab === 'analysis' ? 'active' : ''}`} onClick={() => setActiveTab('analysis')}>
          Analysis
        </button>
      </div>

      {/* ── TAB CONTENT ─────────────────────────────────────────────────── */}
      <div className="sb-tab-content">
        {activeTab === 'live' && match.status !== "finished" && (
          <div className="sb-live-tab">
            {match.lastAction && (
              <div className={`sb-last-action ${laClass}`}>{match.lastAction}</div>
            )}

            {/* Current Over */}
            <div className="sb-section">
              <div className="sb-section-title">Over {completedOvers + 1} · {ballsInThisOver} / 6</div>
              <div className="sb-over-row">
                {match.currentOverBalls.map((ball, i) => <BallDot key={i} ball={ball} />)}
                {Array.from({ length: emptySlots }).map((_, i) => (
                  <span key={`e${i}`} className="sb-ball-dot ball-empty">·</span>
                ))}
              </div>
            </div>

            {/* Batsmen At Crease */}
            <div className="sb-section">
              <div className="sb-section-title">Batting · {battingTeamName}</div>
              <table className="sb-table">
                <thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
                <tbody>
                  {match.players.filter(p => p.id === match.strikerId || p.id === match.nonStrikerId).map((p, i) => (
                    <tr key={i} className={p.id === match.strikerId ? "sb-striker-row" : ""}>
                      <td>{p.id === match.strikerId && <span className="striker-star">★</span>}{p.name}{p.id === match.strikerId ? " *" : ""}</td>
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

            {/* Current Bowler */}
            {match.bowlers.find(b => b.id === match.currentBowlerId) && (() => {
              const b = match.bowlers.find(b => b.id === match.currentBowlerId);
              return (
                <div className="sb-section">
                  <div className="sb-section-title">Bowling · {bowlingTeamName}</div>
                  <table className="sb-table">
                    <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
                    <tbody>
                      <tr className="sb-bowler-row">
                        <td>{b.name} 🎯</td>
                        <td>{Math.floor(b.ballsBowled/6)}.{b.ballsBowled%6}</td>
                        <td>{b.runsConceded}</td>
                        <td>{b.wickets}</td>
                        <td>{b.ballsBowled > 0 ? ((b.runsConceded/b.ballsBowled)*6).toFixed(2) : "–"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Recent Overs */}
            {match.overHistory.length > 0 && (
              <div className="sb-section">
                <div className="sb-section-title">Recent Overs</div>
                <div className="sb-oh-list">
                  {match.overHistory.slice(-3).reverse().map((over, i) => (
                    <div key={i} className="sb-oh-row" style={{ padding: '8px 12px' }}>
                      <span className="sb-oh-num">Ov {match.overHistory.length - i}</span>
                      <div className="sb-oh-balls">{over.map((ball, j) => <BallDot key={j} ball={ball} mini />)}</div>
                      <span className="sb-oh-total">{overRunTotal(over)} runs</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'scorecard' && (
          <div className="sb-scorecard-tab">
            {/* INNING 1 */}
            {(match.currentInning === 2 || match.status === 'finished') && match.inning1 ? (
              <div style={{ marginBottom: 32 }}>
                {renderBattingTable(`Inning 1 — ${match.team1Name} Batting · ${match.inning1.totalRuns}/${match.inning1.wickets}`, match.inning1.players)}
                {renderBowlingTable(`${match.team2Name} Bowling`, match.inning1.bowlers)}
              </div>
            ) : match.currentInning === 1 ? (
              <div style={{ marginBottom: 32 }}>
                {renderBattingTable(`Inning 1 — ${match.team1Name} Batting · ${match.totalRuns}/${match.wickets}`, match.players)}
                {renderBowlingTable(`${match.team2Name} Bowling`, match.bowlers)}
              </div>
            ) : null}

            {/* INNING 2 */}
            {(match.currentInning === 2 || match.status === 'finished') && (
              <div>
                {match.status === 'finished' ? (
                  <>
                    {renderBattingTable(`Inning 2 — ${match.team2Name} Batting · ${match.totalRuns}/${match.wickets}`, match.players)}
                    {renderBowlingTable(`${match.team1Name} Bowling`, match.bowlers)}
                  </>
                ) : (
                  <>
                    {renderBattingTable(`Inning 2 — ${match.team2Name} Batting · ${match.totalRuns}/${match.wickets}`, match.players)}
                    {renderBowlingTable(`${match.team1Name} Bowling`, match.bowlers)}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="sb-analysis-tab">
            {/* CHART */}
            <div className="sb-section sb-chart-wrap">
              <div className="sb-section-title">Run Chart</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={match.players.filter(p => p.balls > 0).map(p => ({ name: p.name, Runs: p.runs }))} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#475569" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#475569" tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 13 }} cursor={{ fill: "rgba(255,255,255,.04)" }} />
                  <Bar dataKey="Runs" fill="#22c55e" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* FALL OF WICKETS */}
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

            {/* OVER HISTORY */}
            {match.overHistory.length > 0 && (
              <div className="sb-section">
                <div className="sb-section-title">All Overs</div>
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
          </div>
        )}
      </div>
    </div>
  );
}
