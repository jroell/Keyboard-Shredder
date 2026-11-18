import { useState, type FormEvent } from 'react';
import { Flame, Guitar, Star, Zap } from 'lucide-react';
import { avatars, badgeNames, palettes, type Profile } from '../../shared/duel';

const icons = { Guitar, Lightning: Zap, Star, Fire: Flame };
export function PlayerCard({ profile }: { profile: Profile }) {
  const Icon = icons[profile.avatar];
  return <div className="player-card">
    <Icon aria-hidden="true" size={25} />
    <div><strong>{profile.name}</strong>{profile.badge && <span className="duel-badge">{badgeNames[profile.badge]}</span>}</div>
  </div>;
}

export default function PlayerProfile({ profile, save }: { profile: Profile; save: (value: Profile) => Promise<Profile> }) {
  const [draft, setDraft] = useState(profile);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  function field<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setStatus('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      setDraft(await save(draft));
      setStatus('Profile saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save profile.');
    } finally { setSaving(false); }
  }
  return <details className="panel settings">
    <summary>Player profile</summary>
    <PlayerCard profile={draft} />
    <p>{profile.wins} wins · {profile.played} completed duels</p>
    <form className="profile-fields" onSubmit={event => void submit(event)}>
      <label>Display name<input required maxLength={24} value={draft.name} onChange={event => field('name', event.target.value)} /></label>
      <label>Avatar<select value={draft.avatar} onChange={event => field('avatar', event.target.value as Profile['avatar'])}>
        {avatars.map(avatar => <option key={avatar}>{avatar}</option>)}</select></label>
      <label>Lane palette<select value={draft.palette} onChange={event => field('palette', event.target.value as Profile['palette'])}>
        {Object.keys(palettes).map(palette => <option key={palette}>{palette}</option>)}</select></label>
      <label>Note scroll speed<select value={draft.speed} onChange={event => field('speed', Number(event.target.value))}>
        <option value={2400}>Relaxed</option><option value={1900}>Standard</option><option value={1450}>Fast</option>
      </select></label>
      <label>Featured badge<select value={draft.badge ?? ''} onChange={event => field('badge', (event.target.value || null) as Profile['badge'])}>
        <option value="">None</option>{profile.badges.map(badge => <option key={badge} value={badge}>{badgeNames[badge]}</option>)}
      </select></label>
      <button type="submit" disabled={saving || !draft.name.trim()}>{saving ? 'Saving…' : 'Save profile'}</button>
    </form>
    <p role="status">{status}</p>
    <ul className="badge-list">{Object.entries(badgeNames).map(([badge, name]) =>
      <li key={badge}>{name} {profile.badges.includes(badge as keyof typeof badgeNames) ? '· Earned' : '· Locked'}</li>)}</ul>
  </details>;
}
