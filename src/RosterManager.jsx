import { useCallback, useEffect, useState } from 'react';
import { adminHeaders } from './auth.js';

const API = import.meta.env.VITE_API_URL || '';

export default function RosterManager() {
  const [tournaments, setTournaments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [tournamentId, setTournamentId] = useState('');
  const [directory, setDirectory] = useState({ teams: [], players: [] });
  const [teamName, setTeamName] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [role, setRole] = useState('BATTER');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [tournamentResponse, teamResponse, playerResponse] = await Promise.all([
      fetch(`${API}/api/admin/tournaments`, { headers: adminHeaders() }), fetch(`${API}/api/teams`), fetch(`${API}/api/players`),
    ]);
    if (!tournamentResponse.ok || !teamResponse.ok || !playerResponse.ok) throw new Error('Unable to load registrations.');
    const [tournamentData, teamData, playerData] = await Promise.all([tournamentResponse.json(), teamResponse.json(), playerResponse.json()]);
    setTournaments(tournamentData); setTeams(teamData); setPlayers(playerData);
    setTournamentId((current) => current || String(tournamentData[0]?.id || ''));
  }, []);
  const loadDirectory = useCallback(async () => {
    const tournament = tournaments.find((item) => String(item.id) === String(tournamentId));
    if (!tournament) return setDirectory({ teams: [], players: [] });
    const response = await fetch(`${API}/api/admin/tournaments/${tournament.slug}`, { headers: adminHeaders() });
    if (response.ok) setDirectory(await response.json()); else setDirectory({ teams: [], players: [] });
  }, [tournamentId, tournaments]);
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);
  useEffect(() => { loadDirectory(); }, [loadDirectory]);

  const request = async (path, body) => {
    const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The change could not be saved.'); return data;
  };
  const createTeam = async (event) => {
    event.preventDefault(); try { await request('/api/admin/teams', { name: teamName }); setTeamName(''); await load(); setMessage('Team created. Register it below.'); } catch (error) { setMessage(error.message); }
  };
  const createPlayer = async (event) => {
    event.preventDefault(); try { await request('/api/admin/players', { fullName: playerName, playingRole: role }); setPlayerName(''); await load(); setMessage('Player created. Register them below.'); } catch (error) { setMessage(error.message); }
  };
  const registerTeam = async (teamId) => {
    try { await request(`/api/admin/tournaments/${tournamentId}/teams/${teamId}`, {}); setMessage('Team registered.'); await loadDirectory(); } catch (error) { setMessage(error.message); }
  };
  const registerPlayer = async (playerId) => {
    try { await request(`/api/admin/tournaments/${tournamentId}/players/${playerId}`, {}); setMessage('Player registered. Assign a team before they play.'); await loadDirectory(); } catch (error) { setMessage(error.message); }
  };

  const registeredTeams = new Set(directory.teams?.map((team) => team.id));
  const registeredPlayers = new Set(directory.players?.map((player) => player.id));
  return <section className="ap-card ap-roster-manager">
    <h3>👥 Teams, players & registrations</h3>
    <p className="ap-manager-copy">Teams and player identities are reusable. Registration keeps every tournament’s squads independent.</p>
    {message && <p className="ap-manager-message">{message}</p>}
    <label className="ap-roster-tournament"><span>Manage tournament</span><select className="ap-select" value={tournamentId} onChange={(event) => setTournamentId(event.target.value)}>{tournaments.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
    <div className="ap-roster-create">
      <form onSubmit={createTeam}><label><span>New team</span><input className="ap-input" required value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Team name" /></label><button className="btn btn-blue">Add team</button></form>
      <form onSubmit={createPlayer}><label><span>New player</span><input className="ap-input" required value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Player name" /></label><select className="ap-select" value={role} onChange={(event) => setRole(event.target.value)}><option value="BATTER">Batter</option><option value="BOWLER">Bowler</option><option value="ALL_ROUNDER">All-rounder</option><option value="WICKETKEEPER">Wicketkeeper</option></select><button className="btn btn-blue">Add player</button></form>
    </div>
    <div className="ap-roster-lists">
      <article><h4>Teams</h4>{teams.map((team) => <div className="ap-roster-row" key={team.id}><span>{team.name}</span><button className={`btn ${registeredTeams.has(team.id) ? 'btn-slate' : 'btn-green'}`} disabled={registeredTeams.has(team.id) || !tournamentId} onClick={() => registerTeam(team.id)}>{registeredTeams.has(team.id) ? 'Registered' : 'Register'}</button></div>)}</article>
      <article><h4>Players</h4>{players.map((player) => <div className="ap-roster-row" key={player.id}><span>{player.fullName}<small>{player.playingRole?.replace('_', ' ')}</small></span><button className={`btn ${registeredPlayers.has(player.id) ? 'btn-slate' : 'btn-green'}`} disabled={registeredPlayers.has(player.id) || !tournamentId} onClick={() => registerPlayer(player.id)}>{registeredPlayers.has(player.id) ? 'Registered' : 'Register'}</button></div>)}</article>
    </div>
  </section>;
}
