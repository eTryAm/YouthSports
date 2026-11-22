import { useCallback, useEffect, useState } from 'react';
import { adminHeaders } from './auth.js';

const API = import.meta.env.VITE_API_URL || '';
const initialForm = {
  name: '', slug: '', description: '', startDate: '', endDate: '', venues: '', format: 'ROUND_ROBIN',
  status: 'DRAFT', oversPerInnings: 20, pointsForWin: 2, pointsForLoss: 0, pointsForTie: 1,
  pointsForNoResult: 1, isPublished: false,
};

export default function TournamentManager() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`${API}/api/admin/tournaments`, { headers: adminHeaders() });
    if (!response.ok) throw new Error('Unable to load tournaments. Sign in again and retry.');
    setItems(await response.json());
  }, []);
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const edit = (item) => {
    setEditingId(item.id);
    setForm({
      ...initialForm, ...item, venues: (item.venues || []).join(', '),
      startDate: item.startDate ? item.startDate.slice(0, 10) : '', endDate: item.endDate ? item.endDate.slice(0, 10) : '',
    });
    setMessage('Editing tournament. Save when ready.');
  };
  const reset = () => { setEditingId(null); setForm(initialForm); setMessage(''); };
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setMessage('');
    const payload = { ...form, venues: form.venues.split(',').map((venue) => venue.trim()).filter(Boolean) };
    try {
      const response = await fetch(`${API}/api/admin/tournaments${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save tournament.');
      await load(); reset(); setMessage(`${data.name} saved successfully.`);
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };

  return <section className="ap-card ap-tournament-manager">
    <h3>🏆 Tournament management</h3>
    <p className="ap-manager-copy">Create independent tournaments first. Teams, registrations, fixtures, and scoring will be attached to the selected tournament.</p>
    {message && <p className="ap-manager-message">{message}</p>}
    <form className="ap-manager-form" onSubmit={submit}>
      <label><span>Name</span><input className="ap-input" required minLength="3" value={form.name} onChange={(e) => update('name', e.target.value)} /></label>
      <label><span>URL slug</span><input className="ap-input" value={form.slug} placeholder="generated-from-name" onChange={(e) => update('slug', e.target.value)} /></label>
      <label><span>Format</span><select className="ap-select" value={form.format} onChange={(e) => update('format', e.target.value)}><option value="ROUND_ROBIN">Round robin</option><option value="KNOCKOUT">Knockout</option><option value="LEAGUE_PLAYOFFS">League + playoffs</option><option value="GROUP_KNOCKOUT">Group stage + knockout</option></select></label>
      <label><span>Status</span><select className="ap-select" value={form.status} onChange={(e) => update('status', e.target.value)}><option value="DRAFT">Draft</option><option value="UPCOMING">Upcoming</option><option value="REGISTRATION_OPEN">Registration open</option><option value="ONGOING">Ongoing</option><option value="COMPLETED">Completed</option><option value="ARCHIVED">Archived</option></select></label>
      <label><span>Overs per innings</span><input className="ap-input" min="1" max="100" type="number" value={form.oversPerInnings} onChange={(e) => update('oversPerInnings', Number(e.target.value))} /></label>
      <label><span>Venues</span><input className="ap-input" value={form.venues} placeholder="Ground A, Ground B" onChange={(e) => update('venues', e.target.value)} /></label>
      <label><span>Start date</span><input className="ap-input" type="date" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} /></label>
      <label><span>End date</span><input className="ap-input" type="date" value={form.endDate} onChange={(e) => update('endDate', e.target.value)} /></label>
      <label className="ap-manager-wide"><span>Description</span><textarea className="ap-input" rows="3" value={form.description} onChange={(e) => update('description', e.target.value)} /></label>
      <label className="ap-manager-publish"><input type="checkbox" checked={form.isPublished} onChange={(e) => update('isPublished', e.target.checked)} /> Publish this tournament publicly</label>
      <div className="ap-manager-actions"><button className="btn btn-green" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save tournament' : 'Create tournament'}</button>{editingId && <button type="button" className="btn btn-slate" onClick={reset}>Cancel</button>}</div>
    </form>
    <div className="ap-manager-list">
      {items.map((item) => <button key={item.id} className="ap-manager-item" onClick={() => edit(item)}><span><strong>{item.name}</strong><small>{item.status} · {item.teamCount} teams · {item.matchCount} matches</small></span><span>{item.isPublished ? 'Published' : 'Draft'}</span></button>)}
    </div>
  </section>;
}
