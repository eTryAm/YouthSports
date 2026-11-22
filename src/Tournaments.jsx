import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './Tournaments.css';

const API = import.meta.env.VITE_API_URL || '';

const statusLabel = (status) => status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatLabel = (format) => format.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function Tournaments() {
  const [tournaments, setTournaments] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const response = await fetch(`${API}/api/tournaments`);
      if (!response.ok) throw new Error();
      setTournaments(await response.json());
    } catch {
      setError('Unable to load tournaments. Please try again shortly.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <section className="tournaments-wrap">
    <header className="tournaments-hero">
      <p className="tournaments-kicker">CricketLive competitions</p>
      <h1>Follow every tournament.</h1>
      <p>Fixtures, scores, tables, and player records—kept separate for every competition.</p>
    </header>
    {error && <div className="tournaments-message is-error">{error}</div>}
    {tournaments === null && !error && <div className="tournaments-message">Loading tournaments…</div>}
    {tournaments?.length === 0 && <div className="tournaments-message">No published tournaments yet.</div>}
    <div className="tournament-grid">
      {tournaments?.map((tournament) => <Link key={tournament.id} className="tournament-card" to={`/tournaments/${tournament.slug}`}>
        <span className={`tournament-status status-${tournament.status.toLowerCase()}`}>{statusLabel(tournament.status)}</span>
        <h2>{tournament.name}</h2>
        <p>{tournament.description || 'Tournament details will be announced soon.'}</p>
        <div className="tournament-meta">
          <span>{formatLabel(tournament.format)}</span><span>{tournament.oversPerInnings} overs</span>
          <span>{tournament.teamCount} teams</span><span>{tournament.matchCount} matches</span>
        </div>
      </Link>)}
    </div>
  </section>;
}

export function TournamentDetail({ slug }) {
  const [data, setData] = useState(null);
  const [fixtures, setFixtures] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([fetch(`${API}/api/tournaments/${slug}`), fetch(`${API}/api/tournaments/${slug}/fixtures`)]).then(async ([detailResponse, fixturesResponse]) => {
      if (!detailResponse.ok || !fixturesResponse.ok) throw new Error();
      const [detail, fixtureData] = await Promise.all([detailResponse.json(), fixturesResponse.json()]);
      setData(detail); setFixtures(fixtureData);
    }).catch(() => setError('This published tournament is not available.'));
  }, [slug]);
  if (error) return <div className="tournaments-message is-error">{error}</div>;
  if (!data) return <div className="tournaments-message">Loading tournament…</div>;
  return <section className="tournaments-wrap">
    <Link className="tournament-back" to="/tournaments">← All tournaments</Link>
    <header className="tournament-detail-head">
      <span className={`tournament-status status-${data.status.toLowerCase()}`}>{statusLabel(data.status)}</span>
      <h1>{data.name}</h1><p>{data.description || 'Tournament information will be available soon.'}</p>
      <div className="tournament-meta"><span>{formatLabel(data.format)}</span><span>{data.oversPerInnings} overs per innings</span></div>
    </header>
    <div className="tournament-directory">
      <article><h2>Teams</h2>{data.teams.length ? <ul>{data.teams.map((team) => <li key={team.id}>{team.name}{team.abbreviation ? ` · ${team.abbreviation}` : ''}</li>)}</ul> : <p>Teams have not been published yet.</p>}</article>
      <article><h2>Registered players</h2>{data.players.length ? <ul>{data.players.map((player) => <li key={player.id}>{player.fullName}{player.playingRole ? ` · ${player.playingRole.replace('_', ' ')}` : ''}</li>)}</ul> : <p>Player registrations have not been published yet.</p>}</article>
    </div>
    <article className="tournament-fixtures"><h2>Fixtures & results</h2>{fixtures.length ? <div>{fixtures.map((fixture) => <div key={fixture.id}><strong>{fixture.team1Name} vs {fixture.team2Name}</strong><span>{fixture.status}{fixture.venue ? ` · ${fixture.venue}` : ''}{fixture.result ? ` · ${fixture.result}` : ''}</span></div>)}</div> : <p>No published fixtures yet.</p>}</article>
  </section>;
}
