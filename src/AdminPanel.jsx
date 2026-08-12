import { useState, useEffect } from "react";
import { socket } from "./socket.js";
import AdminStandings from "./AdminStandings.jsx";
import "./AdminPanel.css";

const BALL_BTNS = [
  { type: "0",  label: "0",  size: "normal" },
  { type: "1",  label: "1",  size: "normal" },
  { type: "2",  label: "2",  size: "normal" },
  { type: "3",  label: "3",  size: "normal" },
  { type: "4",  label: "4",  size: "big"    },
  { type: "6",  label: "6",  size: "big"    },
  { type: "W",  label: "W",  size: "big"    },
  { type: "Wd", label: "Wd", size: "normal" },
  { type: "Nb", label: "Nb", size: "normal" },
];

export default function AdminPanel() {
  const [match, setMatch]           = useState(null);
  const [connected, setConnected]   = useState(socket.connected);
  const [playerName, setPlayerName] = useState("");
  const [bowlerName, setBowlerName] = useState("");
  const [cfg, setCfg] = useState({ team1Name: "", team2Name: "", maxOvers: "" });
  const [error, setError]           = useState("");
  const [toast, setToast]           = useState(null);
  const [ptUpdated, setPtUpdated]   = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin]               = useState("");

  useEffect(() => {
    const onConnect    = () => { setConnected(true); socket.emit("requestState"); };
    const onDisconnect = () => setConnected(false);
    const onMatchState = (data) => {
      setMatch(data);
      setCfg(prev => ({
        team1Name: prev.team1Name || data.team1Name,
        team2Name: prev.team2Name || data.team2Name,
        maxOvers : prev.maxOvers  || (data.maxOvers > 0 ? String(data.maxOvers) : ""),
      }));
    };
    const onBallError = (msg) => { setError(msg); setTimeout(() => setError(""), 3500); };
    const onPtUpdated = () => { setPtUpdated(true); showToast("✅ Points Table Updated!", ""); };

    socket.on("connect",           onConnect);
    socket.on("disconnect",        onDisconnect);
    socket.on("matchState",        onMatchState);
    socket.on("ballError",         onBallError);
    socket.on("pointsTableUpdated", onPtUpdated);
    if (socket.connected) socket.emit("requestState");

    return () => {
      socket.off("connect",           onConnect);
      socket.off("disconnect",        onDisconnect);
      socket.off("matchState",        onMatchState);
      socket.off("ballError",         onBallError);
      socket.off("pointsTableUpdated", onPtUpdated);
    };
  }, []);

  const showToast = (msg, cls = "") => { setToast({ msg, cls }); setTimeout(() => setToast(null), 1800); };

  const addBall = (type) => {
    socket.emit("addBall", { type });
    if (type === "4") showToast("🔥 FOUR!", "toast-four");
    if (type === "6") showToast("💥 SIX!",  "toast-six");
    if (type === "W") showToast("🚨 WICKET!", "toast-wicket");
  };

  const saveConfig = () => {
    socket.emit("updateMatchConfig", {
      team1Name: cfg.team1Name,
      team2Name: cfg.team2Name,
      maxOvers : parseInt(cfg.maxOvers) || 0,
    });
  };

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!connected && !match) {
    return (
      <div className="ap-wrap">
        <div style={{ textAlign: "center", paddingTop: 80, color: "#64748b" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔌</div>
          <p style={{ fontSize: 16, marginBottom: 8 }}>Connecting to server…</p>
          <p style={{ fontSize: 13, color: "#334155" }}>
            Run:{" "}
            <code style={{ color: "#22c55e", background: "rgba(34,197,94,.1)", padding: "2px 8px", borderRadius: 4 }}>
              node server.js
            </code>{" "}
            inside the <code style={{ color: "#94a3b8" }}>server/</code> folder.
          </p>
        </div>
      </div>
    );
  }

  if (!match) return <div className="ap-wrap"><p style={{ textAlign:"center", padding:60, color:"#64748b" }}>Loading…</p></div>;

  const handleLogin = () => {
    const adminPin = import.meta.env.VITE_ADMIN_PIN || "123456";
    if (pin === adminPin) {
      setIsAuthenticated(true);
    } else {
      showToast("❌ Incorrect PIN", "toast-wicket");
      setPin("");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="ap-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ background: 'rgba(30,41,59,.7)', padding: '40px', borderRadius: '16px', border: '1px solid #334155', textAlign: 'center', minWidth: '320px' }}>
          <h2 style={{ color: '#f8fafc', marginBottom: '24px' }}>Admin Access</h2>
          <input 
            type="password" 
            value={pin} 
            onChange={(e) => setPin(e.target.value)} 
            placeholder="Enter Security PIN"
            style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#f8fafc', marginBottom: '16px', width: '100%', boxSizing: 'border-box' }}
            onKeyDown={(e) => { if(e.key === 'Enter') handleLogin(); }}
          />
          <button 
            onClick={handleLogin}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', background: '#4f46e5', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Login
          </button>
        </div>
        {toast && <div className={`ap-toast ${toast.cls}`}>{toast.msg}</div>}
      </div>
    );
  }

  /* ── DERIVED ────────────────────────────────────────────────────────────── */
  const striker    = match.players.find(p => p.id === match.strikerId);
  const nonStriker = match.players.find(p => p.id === match.nonStrikerId);
  const curBowler  = match.bowlers.find(b => b.id === match.currentBowlerId);

  const completedOvers = match.overHistory.length;
  const legalInOver    = match.currentOverBalls.filter(b => b !== "Wd" && b !== "Nb").length;
  const emptySlots     = Math.max(0, 6 - legalInOver);
  const oversStr       = `${completedOvers}.${legalInOver}`;
  const totalLegal     = completedOvers * 6 + legalInOver;
  const crr            = totalLegal > 0 ? ((match.totalRuns / totalLegal) * 6).toFixed(2) : "0.00";

  // Inning 2 chase
  const runsNeeded     = match.target ? match.target - match.totalRuns : null;
  const ballsUsed      = totalLegal;
  const maxBalls       = match.maxOvers > 0 ? match.maxOvers * 6 : null;
  const ballsRemaining = maxBalls ? Math.max(0, maxBalls - ballsUsed) : null;
  const rrr            = ballsRemaining && runsNeeded > 0
    ? ((runsNeeded / ballsRemaining) * 6).toFixed(2) : null;

  const availableBatsmen = match.players.filter(
    p => p.status !== "out" && p.id !== match.strikerId && p.id !== match.nonStrikerId
  );
  const needNewBowler  = !match.currentBowlerId && completedOvers > 0 && !match.waitingForBatsman && !match.allOut;
  const readyToInput   = match.status === "live" && !match.waitingForBatsman && !match.allOut &&
    !match.targetReached && !!match.strikerId && !!match.nonStrikerId && !!match.currentBowlerId;

  // Batting / bowling team labels for current inning
  const battingLabel  = match.currentInning === 1 ? (match.team1Name || "Team 1") : (match.team2Name || "Team 2");
  const bowlingLabel  = match.currentInning === 1 ? (match.team2Name || "Team 2") : (match.team1Name || "Team 1");

  /* ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="ap-wrap">
      {toast && <div className={`ap-toast ${toast.cls}`}>{toast.msg}</div>}

      <h2 className="ap-title">⚙️ Admin Control Room</h2>

      {/* ── MATCH CONTROLS ──────────────────────────────────────────────── */}
      <div className="ap-card ap-control-bar">
        <span className={`ap-status st-${match.status.replace("_","-")}`}>
          {match.status === "not_started"  ? "NOT STARTED"
           : match.status === "live"       ? `🔴 LIVE · INNING ${match.currentInning}`
           : match.status === "inning_break" ? "⏸️ INNINGS BREAK"
           :                                "✅ FINISHED"}
        </span>

        {match.status === "not_started" && (
          <button className="btn btn-green"
            onClick={() => socket.emit("startMatch")}>
            ▶ Start Match
          </button>
        )}
        {match.status === "live" && match.currentInning === 1 && (
          <button className="btn btn-orange"
            onClick={() => window.confirm("End Inning 1 and move to Innings Break?") && socket.emit("endInning")}>
            ⏸ End Inning 1
          </button>
        )}
        {match.status === "live" && match.currentInning === 2 && (
          <button className="btn btn-red"
            onClick={() => window.confirm("End the match?") && socket.emit("endMatch")}>
            ■ End Match
          </button>
        )}
        {match.status === "inning_break" && (
          <button className="btn btn-green"
            onClick={() => socket.emit("startInning2")}>
            ▶ Start Inning 2
          </button>
        )}
        <button className="btn btn-slate"
          onClick={() => window.confirm("Reset the entire match?") && socket.emit("resetMatch")}>
          ↺ Reset
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* NOT STARTED — full setup screen                                    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {match.status === "not_started" && (
        <>
          {/* Team & overs config */}
          <div className="ap-card">
            <h3>🏟️ Match Configuration</h3>
            <div className="ap-grid2" style={{ marginBottom: 12 }}>
              <div>
                <label className="ap-label">Team 1 Name (bats first) *</label>
                <input className="ap-input" placeholder="e.g. Mumbai Indians"
                  value={cfg.team1Name}
                  onChange={e => setCfg(p => ({ ...p, team1Name: e.target.value }))} />
              </div>
              <div>
                <label className="ap-label">Team 2 Name (bowls first) *</label>
                <input className="ap-input" placeholder="e.g. Chennai Super Kings"
                  value={cfg.team2Name}
                  onChange={e => setCfg(p => ({ ...p, team2Name: e.target.value }))} />
              </div>
            </div>
            <div style={{ maxWidth: 240, marginBottom: 12 }}>
              <label className="ap-label">Max Overs (0 = unlimited)</label>
              <input className="ap-input" placeholder="e.g. 20"
                type="number" min="0"
                value={cfg.maxOvers}
                onChange={e => setCfg(p => ({ ...p, maxOvers: e.target.value }))} />
            </div>
            <button className="btn btn-blue" onClick={saveConfig}>
              💾 Save Config
            </button>
            {match.team1Name && match.team2Name && (
              <span style={{ marginLeft: 12, fontSize: 13, color: "#4ade80" }}>
                ✓ {match.team1Name} vs {match.team2Name}
                {match.maxOvers > 0 ? ` · ${match.maxOvers} overs` : ""}
              </span>
            )}
          </div>

          {/* Squads */}
          <div className="ap-grid2">
            <div className="ap-card">
              <h3>🏏 {match.team1Name || "Team 1"} — Batting Squad</h3>
              <div className="ap-input-row">
                <input className="ap-input" placeholder="Batsman name…" value={playerName}
                  onChange={e => setPlayerName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && playerName.trim()) { socket.emit("addPlayer", { name: playerName }); setPlayerName(""); } }} />
                <button className="btn btn-blue" onClick={() => { if (playerName.trim()) { socket.emit("addPlayer", { name: playerName }); setPlayerName(""); } }}>Add</button>
              </div>
              <ul className="ap-player-list">
                {match.players.length === 0 && <li className="ap-empty-hint">No batsmen added yet</li>}
                {match.players.map(p => (
                  <li key={p.id} className="ap-player-item">
                    <span className="ap-player-name">{p.name}</span>
                    <button className="btn-icon" onClick={() => socket.emit("removePlayer", { playerId: p.id })}>✕</button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="ap-card">
              <h3>⚡ {match.team2Name || "Team 2"} — Bowling Squad</h3>
              <div className="ap-input-row">
                <input className="ap-input" placeholder="Bowler name…" value={bowlerName}
                  onChange={e => setBowlerName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && bowlerName.trim()) { socket.emit("addBowler", { name: bowlerName }); setBowlerName(""); } }} />
                <button className="btn btn-blue" onClick={() => { if (bowlerName.trim()) { socket.emit("addBowler", { name: bowlerName }); setBowlerName(""); } }}>Add</button>
              </div>
              <ul className="ap-player-list">
                {match.bowlers.length === 0 && <li className="ap-empty-hint">No bowlers added yet</li>}
                {match.bowlers.map(b => (
                  <li key={b.id} className="ap-player-item">
                    <span className="ap-player-name">{b.name}</span>
                    <button className="btn-icon" onClick={() => socket.emit("removeBowler", { bowlerId: b.id })}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* INNINGS BREAK                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {match.status === "inning_break" && match.inning1 && (
        <div className="ap-card ap-inning-break-card">
          <div className="ib-header">⏸️ Innings Break</div>

          {/* Inning 1 summary */}
          <div className="ib-summary">
            <div className="ib-team">{match.team1Name || "Team 1"} (Inning 1)</div>
            <div className="ib-score">
              {match.inning1.totalRuns}<span className="ib-sep">/</span>
              <span className="ib-wkt">{match.inning1.wickets}</span>
            </div>
            <div className="ib-meta">
              {match.inning1.overHistory.length} overs completed
              &nbsp;·&nbsp; Extras: {match.inning1.extras.wides + match.inning1.extras.noBalls}
            </div>
          </div>

          {/* Target */}
          <div className="ib-target-box">
            <div className="ib-target-label">Target for {match.team2Name || "Team 2"}</div>
            <div className="ib-target-num">{match.inning1.totalRuns + 1}</div>
            <div className="ib-target-sub">
              {match.team2Name || "Team 2"} need{" "}
              <strong>{match.inning1.totalRuns + 1} runs</strong> to win
              {match.maxOvers > 0 && ` in ${match.maxOvers} overs`}
            </div>
          </div>

          <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 16 }}>
            Squads will auto-swap when Inning 2 starts.
            Set new openers &amp; bowler after clicking Start.
          </p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* FINISHED                                                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {match.status === "finished" && match.result && (
        <div className="ap-card ap-result-card">
          <div className="result-emoji">🏆</div>
          <div className="result-text">{match.result}</div>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 8, marginBottom: 20 }}>
            Click ↺ Reset to start a new match.
          </div>

          {/* Points Table Update Button */}
          {!ptUpdated ? (
            <button
              className="btn btn-green"
              style={{ fontSize: 16, padding: "12px 28px", width: "100%", marginTop: 4 }}
              onClick={() => { socket.emit("updatePointsTable"); }}>
              📊 Update Points Table
            </button>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "12px 20px",
              background: "rgba(34,197,94,.08)",
              border: "1px solid rgba(34,197,94,.3)",
              borderRadius: 12, fontSize: 14, color: "#4ade80", fontWeight: 700,
            }}>
              ✅ Points table updated for this match!
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* LIVE — ball-by-ball interface                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {match.status === "live" && (
        <>
          {/* Squad display (read-only during live, collapsible) */}
          <div className="ap-grid2">
            <div className="ap-card">
              <h3>🏏 {battingLabel} — Batting</h3>
              <ul className="ap-player-list">
                {match.players.map(p => {
                  const isS = p.id === match.strikerId;
                  const isN = p.id === match.nonStrikerId;
                  return (
                    <li key={p.id} className={`ap-player-item ${(isS||isN) ? "pi-batting" : p.status === "out" ? "pi-out" : ""}`}>
                      <span className="ap-player-name">{p.name}</span>
                      {isS && <span className="ap-player-badge badge-striker">⚡ Striker *</span>}
                      {isN && <span className="ap-player-badge badge-nonstriker">🏃 Non-striker</span>}
                      {p.status === "out" && <span className="ap-player-badge badge-out">OUT</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="ap-card">
              <h3>⚡ {bowlingLabel} — Bowling</h3>
              <ul className="ap-player-list">
                {match.bowlers.map(b => (
                  <li key={b.id} className={`ap-player-item ${b.id === match.currentBowlerId ? "pi-current" : ""}`}>
                    <span className="ap-player-name">{b.name}</span>
                    {b.id === match.currentBowlerId && <span className="ap-player-badge badge-bowler">🎯 Bowling</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Mini scoreline */}
          <div className="ap-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#22c55e", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>
              Inning {match.currentInning} · {battingLabel}
            </div>
            <div className="ap-scoreline">
              <span>{match.totalRuns}</span>
              <span className="sl-sep">/</span>
              <span className="sl-wkt">{match.wickets}</span>
            </div>
            <div className="ap-meta-mini">{oversStr} ov &nbsp;·&nbsp; CRR {crr}</div>

            {/* Inning 2: target chase mini */}
            {match.currentInning === 2 && match.target && (
              <div className="ib-chase-mini">
                <span>Target <strong>{match.target}</strong></span>
                <span>·</span>
                <span>Need <strong style={{ color: runsNeeded <= 0 ? "#4ade80" : "#fbbf24" }}>
                  {runsNeeded > 0 ? runsNeeded : "—"}</strong> runs</span>
                {rrr && <><span>·</span><span>RRR <strong style={{ color: "#f87171" }}>{rrr}</strong></span></>}
                {ballsRemaining !== null && <><span>·</span><span>{ballsRemaining} balls left</span></>}
              </div>
            )}
          </div>

          {/* All out / target reached banner */}
          {match.allOut && (
            <div className="ap-card ap-alert-orange">
              <h3>🏏 All Out / Over Limit Reached!</h3>
              <p>
                {match.currentInning === 1
                  ? "Click ⏸ End Inning 1 to proceed to the innings break."
                  : "Click ■ End Match to finish the match."}
              </p>
            </div>
          )}
          {match.targetReached && (
            <div className="ap-card ap-alert-green">
              <h3>🏆 Target Reached!</h3>
              <p>
                {match.team2Name || "Team 2"} has won. Click ■ End Match to finalise.
              </p>
            </div>
          )}

          {/* Selection */}
          <div className="ap-grid3">
            <div className="ap-card">
              <h4>⚡ Striker *</h4>
              <select className="ap-select" value={match.strikerId || ""}
                onChange={e => socket.emit("setStriker", { playerId: +e.target.value })}>
                <option value="">-- Select --</option>
                {match.players.filter(p => p.status !== "out").map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="ap-card">
              <h4>🏃 Non-Striker</h4>
              <select className="ap-select" value={match.nonStrikerId || ""}
                onChange={e => socket.emit("setNonStriker", { playerId: +e.target.value })}>
                <option value="">-- Select --</option>
                {match.players.filter(p => p.status !== "out").map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="ap-card">
              <h4>🎯 Bowler</h4>
              <select className="ap-select" value={match.currentBowlerId || ""}
                onChange={e => socket.emit("setCurrentBowler", { bowlerId: +e.target.value })}>
                <option value="">-- Select --</option>
                {match.bowlers.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Wicket: next batsman */}
          {match.waitingForBatsman && (
            <div className="ap-card ap-alert-red">
              <h3>🚨 WICKET! Select Next Batsman</h3>
              <div className="ap-batsman-grid">
                {availableBatsmen.length === 0
                  ? <p style={{ color: "#f87171", fontSize: 14 }}>All out — no more batsmen.</p>
                  : availableBatsmen.map(p => (
                    <button key={p.id} className="btn-batsman"
                      onClick={() => socket.emit("selectNextBatsman", { playerId: p.id })}>
                      {p.name}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* New bowler needed */}
          {needNewBowler && (
            <div className="ap-card ap-alert-indigo">
              <h3>⏱️ Over {completedOvers} Complete!</h3>
              <p>Select bowler for Over {completedOvers + 1} above.</p>
            </div>
          )}

          {/* Current over */}
          <div className="ap-card">
            <div className="ap-over-title">Over {completedOvers + 1} — {legalInOver} / 6 balls</div>
            <div className="ap-over-row">
              {match.currentOverBalls.map((ball, i) => (
                <span key={i} className={`ap-ball ball-${ball}`}>{ball}</span>
              ))}
              {Array.from({ length: emptySlots }).map((_, i) => (
                <span key={`e${i}`} className="ap-ball ball-empty">·</span>
              ))}
            </div>
          </div>

          {error && <div className="ap-error">⚠️ {error}</div>}

          {/* Ball input */}
          <div className="ap-card">
            <h3>🏏 Ball by Ball Input</h3>
            {readyToInput ? (
              <>
                <div className="ap-ball-info">
                  <span>⚡ <strong>{striker?.name}</strong> *</span>
                  <span className="sep">vs</span>
                  <span>🎯 <strong>{curBowler?.name}</strong></span>
                </div>
                <div className="ap-ball-grid">
                  {BALL_BTNS.map(({ type, label, size }) => (
                    <button key={type} className={`ap-ball-btn type-${type} size-${size}`}
                      onClick={() => addBall(type)}
                      title={type === "Wd" ? "Wide" : type === "Nb" ? "No Ball" : type === "W" ? "Wicket" : `${type} run${type !== "1" ? "s" : ""}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="ap-hint">
                {match.allOut || match.targetReached
                  ? "Innings over — use the button above to proceed."
                  : match.waitingForBatsman ? "⬆️ Select next batsman above"
                  : !match.strikerId || !match.nonStrikerId ? "⬆️ Set striker & non-striker above"
                  : !match.currentBowlerId ? "⬆️ Select bowler above"
                  : "Getting ready…"}
              </p>
            )}
          </div>
        </>
      )}

      {/* RRD Management section shown when authenticated */}
      {isAuthenticated && <AdminStandings />}

    </div>
  );
}