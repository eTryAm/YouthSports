import { useState, useEffect, useCallback } from "react";
import MatchDetailsModal from "./MatchDetailsModal.jsx";
import "./Stats.css";

const API = `${import.meta.env.VITE_API_URL || ''}/api/stats`;

/* ── Rank medal ─────────────────────────────────────────────────────────── */
const MEDALS = ["🥇", "🥈", "🥉"];
const getRankIcon = (pos) => MEDALS[pos - 1] || String(pos);

/* ── Format helpers ─────────────────────────────────────────────────────── */
const fmt     = (v, dec = 2) => (v == null || v === "" ? "–" : Number(v).toFixed(dec));
const fmtOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
const fmtDate  = (iso) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/* ── Sortable helper ─────────────────────────────────────────────────────── */
function useSorted(data, defaultKey, defaultDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggle = (key) => {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };
  const sorted = [...(data || [])].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });
  return { sorted, sortKey, sortDir, toggle };
}

/* ── Sortable <th> ──────────────────────────────────────────────────────── */
function Th({ label, field, sortKey, sortDir, onToggle, title }) {
  const active = field === sortKey;
  const arrow  = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th className={active ? "sorted" : ""} onClick={() => onToggle(field)} title={title || ""}>
      {label}{arrow}
    </th>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function Stats() {
  const [tab,     setTab]     = useState("batting");
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [batting, setBatting] = useState(null);   // batting_stats_view
  const [bowling, setBowling] = useState(null);   // bowling_stats_view
  const [matches, setMatches] = useState(null);   // match_history_view
  const [error,   setError]   = useState(null);
  const [lastUpd, setLastUpd] = useState(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [bat, bowl, m] = await Promise.all([
        fetch(`${API}/batting`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
        fetch(`${API}/bowling`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
        fetch(`${API}/matches`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
      ]);
      setBatting (Array.isArray(bat)  ? bat  : []);
      setBowling (Array.isArray(bowl) ? bowl : []);
      setMatches (Array.isArray(m)    ? m    : []);
      setLastUpd (new Date().toLocaleTimeString("en-IN"));
    } catch (e) {
      setError("Cannot reach server. Make sure node server.js is running.");
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── Sorted states ────────────────────────────────────────────────────── */
  // Points table is now its own route — ptTbl removed
  const battingTbl = useSorted(batting, "total_runs");
  const bowlingTbl = useSorted(bowling, "total_wickets");

  if (error) return (
    <div className="stats-wrap">
      <div className="stats-empty" style={{ color: "#f87171", paddingTop: 60 }}>⚠️ {error}</div>
    </div>
  );

  /* ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="stats-wrap">

      {/* ── PAGE HEADER ─────────────────────────────────────────────── */}
      <div className="stats-page-header">
        <h2 className="stats-title">📊 Tournament Centre</h2>
        <button className="stats-refresh-btn" onClick={fetchAll} title="Refresh">
          🔄 Refresh {lastUpd && <span className="stats-upd-time">· {lastUpd}</span>}
        </button>
      </div>

      {/* ── TABS ────────────────────────────────────────────────────── */}
      <div className="stats-tabs">
        {[
          { key: "batting", label: "🏏 Batting"       },
          { key: "bowling", label: "⚡ Bowling"       },
          { key: "matches", label: "📋 Matches"       },
        ].map(t => (
          <button key={t.key}
            className={`stats-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════
          BATTING — from batting_stats_view (PostgreSQL)
      ════════════════════════════════════════════════════════════════ */}
      {tab === "batting" && (
        <div className="stats-card">
          <div className="stats-card-title">Batting Records</div>
          {batting === null ? (
            <div className="stats-loading"><div className="stats-spinner" /><span>Loading…</span></div>
          ) : battingTbl.sorted.length === 0 ? (
            <div className="stats-empty">No batting data yet. Complete a match to see stats.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <Th label="M"   field="matches_played"    {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="R"   field="total_runs"         {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="B"   field="total_balls_faced"  {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="Avg" field="batting_average"    {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="SR"  field="strike_rate"        {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="HS"  field="highest_score"      {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="100" field="centuries"          {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="50"  field="half_centuries"     {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="4s"  field="total_fours"        {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="6s"  field="total_sixes"        {...battingTbl} onToggle={battingTbl.toggle} />
                    <Th label="NO"  field="not_outs"           {...battingTbl} onToggle={battingTbl.toggle} />
                  </tr>
                </thead>
                <tbody>
                  {battingTbl.sorted.map((p, i) => (
                    <tr key={p.id}>
                      <td className="st-rank">{i + 1}</td>
                      <td>{p.player_name}</td>
                      <td>{p.matches_played}</td>
                      <td className="st-highlight">{p.total_runs}</td>
                      <td>{p.total_balls_faced}</td>
                      <td>{fmt(p.batting_average)}</td>
                      <td>{fmt(p.strike_rate)}</td>
                      <td>{p.highest_score}</td>
                      <td>{p.centuries}</td>
                      <td>{p.half_centuries}</td>
                      <td>{p.total_fours}</td>
                      <td>{p.total_sixes}</td>
                      <td>{p.not_outs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          BOWLING — from bowling_stats_view (PostgreSQL)
      ════════════════════════════════════════════════════════════════ */}
      {tab === "bowling" && (
        <div className="stats-card">
          <div className="stats-card-title">Bowling Records</div>
          {bowling === null ? (
            <div className="stats-loading"><div className="stats-spinner" /><span>Loading…</span></div>
          ) : bowlingTbl.sorted.length === 0 ? (
            <div className="stats-empty">No bowling data yet. Complete a match to see stats.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <Th label="M"    field="matches_played"     {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                    <Th label="W"    field="total_wickets"       {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                    <Th label="O"    field="total_balls_bowled"  {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                    <Th label="R"    field="total_runs_conceded" {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                    <Th label="Avg"  field="bowling_average"     {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                    <Th label="Econ" field="economy"             {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                    <Th label="SR"   field="bowling_sr"          {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                    <Th label="BB"   field="best_bowling_wickets" {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                    <Th label="5W"   field="five_wicket_hauls"   {...bowlingTbl} onToggle={bowlingTbl.toggle} />
                  </tr>
                </thead>
                <tbody>
                  {bowlingTbl.sorted.map((p, i) => (
                    <tr key={p.id}>
                      <td className="st-rank">{i + 1}</td>
                      <td>{p.player_name}</td>
                      <td>{p.matches_played}</td>
                      <td className="st-highlight">{p.total_wickets}</td>
                      <td>{p.overs_bowled}</td>
                      <td>{p.total_runs_conceded}</td>
                      <td>{p.bowling_average != null ? fmt(p.bowling_average) : "–"}</td>
                      <td className={parseFloat(p.economy) > 8 ? "st-warn" : ""}>{fmt(p.economy)}</td>
                      <td>{p.bowling_sr != null ? fmt(p.bowling_sr) : "–"}</td>
                      <td>{p.best_bowling}</td>
                      <td>{p.five_wicket_hauls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          MATCHES — from match_history_view (PostgreSQL)
      ════════════════════════════════════════════════════════════════ */}
      {tab === "matches" && (
        <div className="stats-card">
          <div className="stats-card-title">Match History</div>
          {matches === null ? (
            <div className="stats-loading"><div className="stats-spinner" /><span>Loading…</span></div>
          ) : matches.length === 0 ? (
            <div className="stats-empty">No completed matches yet.</div>
          ) : (
            <div className="match-list">
              {matches.map((m, i) => (
                <div 
                  key={m.id} 
                  className="match-item" 
                  onClick={() => setSelectedMatchId(m.id)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="match-header">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="match-num">#{matches.length - i}</span>
                      <span className="match-teams">
                        {m.team1_name} vs {m.team2_name}
                      </span>
                    </div>
                    <span className="match-date">{fmtDate(m.match_date)}</span>
                  </div>
                  <div className="match-score">
                    {m.team1_name}: <strong>{m.inning1_runs}/{m.inning1_wickets}</strong>
                    {m.inning1_balls > 0 && ` (${fmtOvers(m.inning1_balls)})`}
                    {m.inning2_runs > 0 && (
                      <>&nbsp;&nbsp;|&nbsp;&nbsp;{m.team2_name}: <strong>{m.inning2_runs}/{m.inning2_wickets}</strong>{m.inning2_balls > 0 && ` (${fmtOvers(m.inning2_balls)})`}</>
                    )}
                  </div>
                  <div className={`match-result ${m.result?.includes("Tied") ? "tied" : ""}`}>
                    {m.result || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedMatchId && (
        <MatchDetailsModal 
          matchId={selectedMatchId} 
          onClose={() => setSelectedMatchId(null)} 
        />
      )}

    </div>
  );
}
