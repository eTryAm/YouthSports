import React, { useState, useEffect } from 'react';
import './MatchDetailsModal.css';

export default function MatchDetailsModal({ matchId, onClose }) {
  const [matchData, setMatchData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('inning1');

  useEffect(() => {
    const fetchMatch = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/tournament/match/${matchId}`);
        if (!res.ok) throw new Error('Failed to fetch match details');
        const data = await res.json();
        setMatchData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchMatch();
  }, [matchId]);

  if (loading) return (
    <div className="mdm-overlay">
      <div className="mdm-content loading">
        <div className="mdm-spinner"></div>
        <p>Loading Match Details...</p>
      </div>
    </div>
  );

  if (error || !matchData) return (
    <div className="mdm-overlay" onClick={onClose}>
      <div className="mdm-content" onClick={e => e.stopPropagation()}>
        <h3>Error</h3>
        <p>{error || 'Match not found'}</p>
        <button onClick={onClose} className="mdm-close-btn">Close</button>
      </div>
    </div>
  );

  const inn1 = matchData.inning1 || {};
  const inn2 = matchData; // Since it finished in inning 2, state is at root

  const renderBatting = (players) => {
    if (!players || players.length === 0) return <p className="mdm-empty">No batting data</p>;
    const batters = players.filter(p => p.status !== 'yet_to_bat' || p.runs > 0 || p.balls > 0);
    return (
      <table className="mdm-table">
        <thead>
          <tr>
            <th style={{textAlign: 'left'}}>Batter</th>
            <th>R</th>
            <th>B</th>
            <th>4s</th>
            <th>6s</th>
            <th>SR</th>
          </tr>
        </thead>
        <tbody>
          {batters.map(p => (
            <tr key={p.id}>
              <td style={{textAlign: 'left'}}>
                {p.name} {p.status === 'batting' ? '*' : ''}
              </td>
              <td className="mdm-bold">{p.runs}</td>
              <td>{p.balls}</td>
              <td>{p.fours}</td>
              <td>{p.sixes}</td>
              <td>{p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(1) : '0.0'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderBowling = (bowlers) => {
    if (!bowlers || bowlers.length === 0) return <p className="mdm-empty">No bowling data</p>;
    const activeBowlers = bowlers.filter(b => b.ballsBowled > 0);
    return (
      <table className="mdm-table">
        <thead>
          <tr>
            <th style={{textAlign: 'left'}}>Bowler</th>
            <th>O</th>
            <th>R</th>
            <th>W</th>
            <th>Econ</th>
          </tr>
        </thead>
        <tbody>
          {activeBowlers.map(b => {
            const overs = Math.floor(b.ballsBowled / 6);
            const balls = b.ballsBowled % 6;
            const oversStr = `${overs}.${balls}`;
            const econ = b.ballsBowled > 0 ? ((b.runsConceded / b.ballsBowled) * 6).toFixed(1) : '0.0';
            return (
              <tr key={b.id}>
                <td style={{textAlign: 'left'}}>{b.name}</td>
                <td>{oversStr}</td>
                <td>{b.runsConceded}</td>
                <td className="mdm-bold">{b.wickets}</td>
                <td>{econ}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="mdm-overlay" onClick={onClose}>
      <div className="mdm-content" onClick={e => e.stopPropagation()}>
        
        <div className="mdm-header">
          <div className="mdm-teams">
            <h2>{matchData.team1Name} vs {matchData.team2Name}</h2>
            <div className="mdm-result">{matchData.result || 'Match Completed'}</div>
          </div>
          <button onClick={onClose} className="mdm-close-x">✕</button>
        </div>

        <div className="mdm-tabs">
          <button 
            className={activeTab === 'inning1' ? 'active' : ''} 
            onClick={() => setActiveTab('inning1')}
          >
            {matchData.team1Name} Inning
          </button>
          <button 
            className={activeTab === 'inning2' ? 'active' : ''} 
            onClick={() => setActiveTab('inning2')}
          >
            {matchData.team2Name} Inning
          </button>
        </div>

        <div className="mdm-tab-content">
          {activeTab === 'inning1' && (
            <div className="mdm-inning">
              <div className="mdm-score-header">
                <h3>{matchData.team1Name}</h3>
                <span className="mdm-total">{inn1.totalRuns || 0}/{inn1.wickets || 0}</span>
              </div>
              <div className="mdm-section">
                <h4>Batting</h4>
                {renderBatting(inn1.players)}
              </div>
              <div className="mdm-section">
                <h4>Bowling</h4>
                {renderBowling(inn1.bowlers)}
              </div>
            </div>
          )}

          {activeTab === 'inning2' && (
            <div className="mdm-inning">
              <div className="mdm-score-header">
                <h3>{matchData.team2Name}</h3>
                <span className="mdm-total">{inn2.totalRuns || 0}/{inn2.wickets || 0}</span>
              </div>
              <div className="mdm-section">
                <h4>Batting</h4>
                {renderBatting(inn2.players)}
              </div>
              <div className="mdm-section">
                <h4>Bowling</h4>
                {renderBowling(inn2.bowlers)}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
