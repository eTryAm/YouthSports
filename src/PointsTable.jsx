import React, { useState, useEffect } from 'react';
import './PointsTable.css';

const PointsTable = () => {
  const [standings, setStandings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [error, setError] = useState(null);

  const fetchStandings = async () => {
    setLoading(true);
    setError(null);
    try {
      const apiUrl = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/tournament/standings`;
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      const data = await response.json();
      setStandings(data);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Error fetching standings:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStandings();

    // Re-fetch when admin publishes new standings
    import('./socket.js').then(({ socket }) => {
      socket.on("pointsTableUpdated", fetchStandings);
    });

    return () => {
      import('./socket.js').then(({ socket }) => {
        socket.off("pointsTableUpdated", fetchStandings);
      });
    };
  }, []);

  const formatRRD = (rrd) => {
    const num = parseFloat(rrd);
    if (isNaN(num)) return '0.00';
    const formatted = Math.abs(num).toFixed(2);
    return num > 0 ? `+${formatted}` : num < 0 ? `-${formatted}` : '0.00';
  };

  const renderPosition = (pos) => {
    if (pos === 1) return '🥇';
    if (pos === 2) return '🥈';
    if (pos === 3) return '🥉';
    return pos;
  };

  return (
    <div className="pt-container">
      <div className="pt-header-section">
        <div className="pt-hub-title">YOUTH EMPOWERMENT HUB</div>
        <h1 className="pt-main-title">TOURNAMENT POINTS TABLE</h1>
        
        <div className="pt-controls">
          <span className="pt-last-updated">
            {lastUpdated ? `Last updated: ${lastUpdated}` : 'Updating...'}
          </span>
          <button className="pt-refresh-btn" onClick={fetchStandings} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh ↻'}
          </button>
        </div>
      </div>

      <div className="pt-table-card">
        {loading && !standings ? (
          <div className="pt-loading-spinner">
            <div className="pt-spinner"></div>
            <p>Loading standings...</p>
          </div>
        ) : error && !standings ? (
           <div className="pt-empty-state">
            <p>Could not load standings: {error}</p>
            <button className="pt-refresh-btn" onClick={fetchStandings}>Try Again</button>
          </div>
        ) : standings && standings.length === 0 ? (
          <div className="pt-empty-state">
            <p>No tournament data available right now. Check back soon!</p>
          </div>
        ) : (
          <div className="pt-table-wrapper">
            <table className="pt-table">
              <thead>
                <tr>
                  <th className="pt-col-pos">POS</th>
                  <th className="pt-col-team">TEAM</th>
                  <th className="pt-col-num">P</th>
                  <th className="pt-col-num">W</th>
                  <th className="pt-col-num">L</th>
                  <th className="pt-col-num">T</th>
                  <th className="pt-col-num">NR</th>
                  <th className="pt-col-num pt-col-pts">PTS</th>
                  <th className="pt-col-num">RRD</th>
                </tr>
              </thead>
              <tbody>
                {standings && standings.map((team, index) => (
                  <tr key={index} className={`pt-row ${team.position <= 3 ? `pt-top-${team.position}` : ''}`}>
                    <td className="pt-col-pos pt-pos-value">{renderPosition(team.position)}</td>
                    <td className="pt-col-team">
                      <div className="pt-team-name-wrapper">
                        <span className="pt-team-name">{team.teamName}</span>
                        {team.position === 1 && <span className="pt-badge-leader">LEADER</span>}
                      </div>
                    </td>
                    <td className="pt-col-num">{team.played}</td>
                    <td className="pt-col-num">{team.wins}</td>
                    <td className="pt-col-num">{team.losses}</td>
                    <td className="pt-col-num">{team.ties}</td>
                    <td className="pt-col-num">{team.noResults}</td>
                    <td className="pt-col-num pt-col-pts">
                      <span className="pt-pts-badge">{team.points}</span>
                    </td>
                    <td className={`pt-col-num pt-rrd ${parseFloat(team.rrd) > 0 ? 'pt-rrd-positive' : parseFloat(team.rrd) < 0 ? 'pt-rrd-negative' : ''}`}>
                      {formatRRD(team.rrd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="pt-footer-info">
        <p className="pt-legend">
          Teams ranked by Points → RRD. Win = 2 pts · Tie = 1 pt · No Result = 1 pt · Loss = 0 pts
        </p>

        <div className="pt-rules-section">
          <button 
            className="pt-rules-toggle" 
            onClick={() => setShowRules(!showRules)}
          >
            <span className="pt-rules-icon">ℹ️</span> 
            Youth Empowerment Hub RRD Rules
            <span className={`pt-chevron ${showRules ? 'pt-chevron-up' : ''}`}>▼</span>
          </button>
          
          <div className={`pt-rules-content ${showRules ? 'pt-rules-expanded' : ''}`}>
            <p>
              RRD is maintained and published by the tournament administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PointsTable;
