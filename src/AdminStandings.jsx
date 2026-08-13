import React, { useState, useEffect } from 'react';
import './AdminPanel.css'; // Reuse existing admin styles

export default function AdminStandings() {
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    fetchStandings();
  }, []);

  const fetchStandings = async () => {
    setLoading(true);
    try {
      const apiUrl = `${import.meta.env.VITE_API_URL || ''}/api/admin/standings`;
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error('Failed to fetch admin standings');
      const data = await res.json();
      setStandings(data);
    } catch (e) {
      showMessage(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  const handleInputChange = (teamName, field, value) => {
    setStandings(prev => prev.map(t => {
      if (t.teamName === teamName) {
        return {
          ...t,
          draft: { ...t.draft, [field]: value }
        };
      }
      return t;
    }));
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      // Validate numbers
      const validatedStandings = standings.map(t => {
        const d = t.draft;
        const rrdParsed = parseFloat(d.rrd);
        if (isNaN(rrdParsed)) throw new Error(`Invalid RRD for ${t.teamName}`);
        
        return {
          ...t,
          draft: {
            played: parseInt(d.played) || 0,
            wins: parseInt(d.wins) || 0,
            losses: parseInt(d.losses) || 0,
            ties: parseInt(d.ties) || 0,
            noResults: parseInt(d.noResults) || 0,
            points: parseInt(d.points) || 0,
            rrd: rrdParsed.toFixed(2),
          }
        };
      });

      const apiUrl = `${import.meta.env.VITE_API_URL || ''}/api/admin/standings/draft`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standings: validatedStandings })
      });

      if (!res.ok) throw new Error('Failed to save draft');
      setStandings(validatedStandings); // update local state with parsed values
      showMessage('Draft saved successfully', 'success');
      setPreviewMode(true); // switch to preview automatically
    } catch (e) {
      showMessage(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const publishFinal = async () => {
    if (!window.confirm("Are you sure you want to publish these tournament standings?\n\nThe updated Points, Wins, Losses, and RRD values will become visible to all users.")) return;

    setPublishing(true);
    try {
      const apiUrl = `${import.meta.env.VITE_API_URL || ''}/api/admin/standings/publish`;
      const res = await fetch(apiUrl, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to publish standings');
      
      showMessage('Final standings published to public table!', 'success');
      setPreviewMode(false);
      fetchStandings(); // reload to get new published state
    } catch (e) {
      showMessage(e.message, 'error');
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <div className="ap-card"><p>Loading standings...</p></div>;

  return (
    <div className="ap-card" style={{ marginTop: '20px' }}>
      <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📊 RRD & STANDINGS MANAGEMENT</span>
        <button onClick={fetchStandings} className="btn" style={{ padding: '4px 8px', fontSize: '12px', background: '#334155' }}>↻ Reload</button>
      </h3>
      
      <div style={{ background: '#334155', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', color: '#cbd5e1' }}>
        ⚠️ <strong>These values are official tournament statistics.</strong> Changes made here will be visible to all users after publication. Auto-calculated points update the DRAFT state.
      </div>

      {message.text && (
        <div style={{ padding: '10px', marginBottom: '16px', borderRadius: '4px', background: message.type === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)', color: message.type === 'error' ? '#f87171' : '#4ade80', border: `1px solid ${message.type === 'error' ? '#f87171' : '#4ade80'}` }}>
          {message.text}
        </div>
      )}

      {previewMode ? (
        <div className="ap-standings-preview">
          <h4 style={{ marginBottom: '12px', color: '#e2e8f0' }}>FINAL TABLE PREVIEW</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', marginBottom: '20px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #475569', color: '#94a3b8' }}>
                <th style={{ textAlign: 'left', padding: '8px' }}>POS</th>
                <th style={{ textAlign: 'left', padding: '8px' }}>TEAM</th>
                <th style={{ textAlign: 'center', padding: '8px' }}>P</th>
                <th style={{ textAlign: 'center', padding: '8px' }}>W</th>
                <th style={{ textAlign: 'center', padding: '8px' }}>L</th>
                <th style={{ textAlign: 'center', padding: '8px' }}>T</th>
                <th style={{ textAlign: 'center', padding: '8px' }}>NR</th>
                <th style={{ textAlign: 'center', padding: '8px' }}>PTS</th>
                <th style={{ textAlign: 'right', padding: '8px' }}>RRD</th>
              </tr>
            </thead>
            <tbody>
              {/* Sort by points, then rrd just for preview */}
              {[...standings].sort((a,b) => b.draft.points - a.draft.points || b.draft.rrd - a.draft.rrd).map((t, idx) => (
                <tr key={t.teamName} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '8px', color: '#f8fafc' }}>{idx + 1}</td>
                  <td style={{ padding: '8px', color: '#f8fafc', fontWeight: 'bold' }}>{t.teamName}</td>
                  <td style={{ textAlign: 'center', padding: '8px', color: '#cbd5e1' }}>{t.draft.played}</td>
                  <td style={{ textAlign: 'center', padding: '8px', color: '#cbd5e1' }}>{t.draft.wins}</td>
                  <td style={{ textAlign: 'center', padding: '8px', color: '#cbd5e1' }}>{t.draft.losses}</td>
                  <td style={{ textAlign: 'center', padding: '8px', color: '#cbd5e1' }}>{t.draft.ties}</td>
                  <td style={{ textAlign: 'center', padding: '8px', color: '#cbd5e1' }}>{t.draft.noResults}</td>
                  <td style={{ textAlign: 'center', padding: '8px', color: '#22c55e', fontWeight: 'bold' }}>{t.draft.points}</td>
                  <td style={{ textAlign: 'right', padding: '8px', color: t.draft.rrd > 0 ? '#4ade80' : t.draft.rrd < 0 ? '#f87171' : '#cbd5e1' }}>
                    {t.draft.rrd > 0 ? `+${t.draft.rrd}` : t.draft.rrd}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-orange" onClick={() => setPreviewMode(false)}>✏️ Edit Draft</button>
            <button className="btn btn-green" onClick={publishFinal} disabled={publishing}>
              {publishing ? 'Publishing...' : '📢 UPDATE FINAL POINTS TABLE'}
            </button>
          </div>
        </div>
      ) : (
        <div className="ap-standings-editor" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #475569', color: '#94a3b8' }}>
                <th style={{ textAlign: 'left', padding: '8px 4px' }}>TEAM</th>
                <th style={{ textAlign: 'center', padding: '8px 4px' }}>P</th>
                <th style={{ textAlign: 'center', padding: '8px 4px' }}>W</th>
                <th style={{ textAlign: 'center', padding: '8px 4px' }}>L</th>
                <th style={{ textAlign: 'center', padding: '8px 4px' }}>T</th>
                <th style={{ textAlign: 'center', padding: '8px 4px' }}>NR</th>
                <th style={{ textAlign: 'center', padding: '8px 4px' }}>PTS</th>
                <th style={{ textAlign: 'right', padding: '8px 4px' }}>RRD</th>
              </tr>
            </thead>
            <tbody>
              {standings.map(t => (
                <tr key={t.teamName} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '8px 4px', color: '#f8fafc', fontWeight: 'bold' }}>
                    {t.teamName}
                    {/* Tiny badge indicating published RRD */}
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 'normal' }}>
                      Pub: {t.published ? (t.published.rrd > 0 ? `+${t.published.rrd}` : t.published.rrd) : '—'}
                    </div>
                  </td>
                  <td style={{ padding: '8px 4px' }}>
                    <input type="number" value={t.draft.played} onChange={(e) => handleInputChange(t.teamName, 'played', e.target.value)} style={inputStyle} />
                  </td>
                  <td style={{ padding: '8px 4px' }}>
                    <input type="number" value={t.draft.wins} onChange={(e) => handleInputChange(t.teamName, 'wins', e.target.value)} style={inputStyle} />
                  </td>
                  <td style={{ padding: '8px 4px' }}>
                    <input type="number" value={t.draft.losses} onChange={(e) => handleInputChange(t.teamName, 'losses', e.target.value)} style={inputStyle} />
                  </td>
                  <td style={{ padding: '8px 4px' }}>
                    <input type="number" value={t.draft.ties} onChange={(e) => handleInputChange(t.teamName, 'ties', e.target.value)} style={inputStyle} />
                  </td>
                  <td style={{ padding: '8px 4px' }}>
                    <input type="number" value={t.draft.noResults} onChange={(e) => handleInputChange(t.teamName, 'noResults', e.target.value)} style={inputStyle} />
                  </td>
                  <td style={{ padding: '8px 4px' }}>
                    <input type="number" value={t.draft.points} onChange={(e) => handleInputChange(t.teamName, 'points', e.target.value)} style={{ ...inputStyle, border: '1px solid #4ade80' }} />
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                    <input type="number" step="0.01" value={t.draft.rrd} onChange={(e) => handleInputChange(t.teamName, 'rrd', e.target.value)} style={{ ...inputStyle, width: '70px', textAlign: 'right' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
            <button className="btn" style={{ background: '#4f46e5' }} onClick={saveDraft} disabled={saving}>
              {saving ? 'Saving...' : '💾 Save Draft'}
            </button>
            <button className="btn" style={{ background: '#334155' }} onClick={() => setPreviewMode(true)}>
              👁️ Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '45px',
  background: '#0f172a',
  color: '#f8fafc',
  border: '1px solid #475569',
  borderRadius: '4px',
  padding: '6px 4px',
  textAlign: 'center',
  fontSize: '14px',
};
