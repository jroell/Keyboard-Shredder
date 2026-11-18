import { useMemo, useState } from 'react';
import { Award, Check, LockKeyhole } from 'lucide-react';
import { avatars, badgeNames, type Profile } from '../../shared/duel';
import { ACHIEVEMENTS, levelFor, MAX_LEVEL, UNLOCKS, type UnlockKind } from '../../shared/progression';
import { useApp } from '../App';
import { sfx } from '../game/sfx';
import { LANE_PALETTES } from '../game/themes';
import { laneColors, saveStore, settingsStore, useCell } from '../state/store';
import { Screen } from './common';
import DemoHighway from './DemoHighway';

const KINDS: { kind: UnlockKind; label: string }[] = [
  { kind: 'highway', label: 'Neck' }, { kind: 'gem', label: 'Gems' }, { kind: 'fx', label: 'Hit effect' },
];
const TABS = ['Style', 'Achievements', 'Stats', 'Profile'] as const;

function hours(ms: number) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export default function Locker() {
  const app = useApp();
  const save = useCell(saveStore);
  const settings = useCell(settingsStore);
  const [tab, setTab] = useState<typeof TABS[number]>('Style');
  const [name, setName] = useState(save.name);
  const [status, setStatus] = useState('');
  const level = levelFor(save.xp);
  const colors = useMemo(() => laneColors(settings), [settings]);
  const look = useMemo(() => ({ theme: save.equipped.highway, gem: save.equipped.gem, fx: save.equipped.fx, hidden: false, calm: settings.calm }),
    [save.equipped, settings.calm]);
  const earned = ACHIEVEMENTS.filter(item => save.achievements[item.id]);
  const starTotal = Object.values(save.records).reduce((total, record) => total + Math.min(5, record.stars), 0);

  const equip = (kind: UnlockKind, id: string, locked: boolean) => {
    if (locked) { sfx.play('ui-error'); return; }
    sfx.play('ui-select');
    saveStore.set(previous => ({ ...previous, equipped: { ...previous.equipped, [kind]: id } }));
  };
  const saveName = async (patch: Partial<Profile> = {}) => {
    const clean = name.trim().slice(0, 24) || 'Shredder';
    saveStore.set(previous => ({ ...previous, name: clean }));
    setName(clean);
    if (!app.profile) { setStatus('Saved on this device.'); return; }
    try {
      await app.saveProfile({ ...app.profile, name: clean, ...patch });
      setStatus('Profile saved.');
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Could not save your profile.');
    }
  };

  return <Screen title="Locker" eyebrow={`Level ${level.level} · ${level.title}`} onBack={() => app.go({ name: 'menu' })} className="locker-screen">
    <div className="level-banner">
      <span className="chip-level big">{level.level}</span>
      <div><strong>{save.name || 'New shredder'}</strong><span>{level.level >= MAX_LEVEL ? 'Maximum level' : `${Math.round(level.needed - level.current)} XP to level ${level.level + 1}`}</span>
        <i className="xp-bar"><b style={{ width: `${level.progress * 100}%` }} /></i></div>
    </div>
    <div className="chips" role="tablist">
      {TABS.map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'on' : ''}
        onClick={() => { sfx.play('ui-toggle'); setTab(item); }}>{item}{item === 'Achievements' ? ` ${earned.length}/${ACHIEVEMENTS.length}` : ''}</button>)}
    </div>

    {tab === 'Style' && <div className="locker-style">
      <div className="locker-preview"><DemoHighway look={look} colors={colors} /></div>
      <div className="locker-options">
        {KINDS.map(group => <section key={group.kind}>
          <h2>{group.label}</h2>
          <div className="swatches">
            {UNLOCKS.filter(item => item.kind === group.kind).map(item => {
              const locked = item.level > level.level;
              const on = save.equipped[group.kind] === item.id;
              return <button key={item.id} className={`swatch${on ? ' on' : ''}${locked ? ' locked' : ''}`} aria-pressed={on}
                title={item.blurb} onClick={() => equip(group.kind, item.id, locked)}>
                <strong>{item.name}</strong>
                <small>{locked ? <><LockKeyhole size={12} aria-hidden="true" /> Level {item.level}</> : on ? <><Check size={12} aria-hidden="true" /> Equipped</> : item.blurb}</small>
              </button>;
            })}
          </div>
        </section>)}
        <section>
          <h2>Lane colors</h2>
          <div className="swatches">
            {Object.entries(LANE_PALETTES).map(([id, palette]) => <button key={id} className={`swatch${settings.palette === id ? ' on' : ''}`} aria-pressed={settings.palette === id}
              onClick={() => { sfx.play('ui-select'); settingsStore.set(previous => ({ ...previous, palette: id })); }}>
              <strong>{id}</strong>{settings.palette === id && <small><Check size={12} aria-hidden="true" /> Equipped</small>}<span className="palette-dots">{palette.map(color => <i key={color} style={{ background: color }} />)}</span>
            </button>)}
          </div>
        </section>
      </div>
    </div>}

    {tab === 'Achievements' && <ul className="achievements">
      {ACHIEVEMENTS.map(item => {
        const at = save.achievements[item.id];
        const hidden = item.secret && !at;
        return <li key={item.id} className={at ? 'earned' : ''}>
          <Award aria-hidden="true" />
          <div><strong>{hidden ? 'Secret achievement' : item.name}</strong><p>{hidden ? 'Keep playing to find it.' : item.blurb}</p></div>
          <em>{at ? new Date(at).toLocaleDateString() : `+${item.xp} XP`}</em>
        </li>;
      })}
    </ul>}

    {tab === 'Stats' && <dl className="stats-grid">
      <div><dt>Songs played</dt><dd>{save.totals.plays}</dd></div>
      <div><dt>Notes hit</dt><dd>{save.totals.notesHit.toLocaleString()}</dd></div>
      <div><dt>Perfect hits</dt><dd>{save.totals.perfects.toLocaleString()}</dd></div>
      <div><dt>Best streak</dt><dd>{save.totals.bestCombo}</dd></div>
      <div><dt>Full combos</dt><dd>{save.totals.fullCombos}</dd></div>
      <div><dt>Stars earned</dt><dd>{starTotal}</dd></div>
      <div><dt>Best typing speed</dt><dd>{Math.round(save.totals.bestWpm)} WPM</dd></div>
      <div><dt>Time on stage</dt><dd>{hours(save.totals.playMs)}</dd></div>
      <div><dt>Day streak</dt><dd>{save.streak.days} (best {save.streak.best})</dd></div>
      <div><dt>Daily challenges</dt><dd>{save.totals.dailies}</dd></div>
      <div><dt>Online wins</dt><dd>{app.profile?.wins ?? 0} of {app.profile?.played ?? 0}</dd></div>
      <div><dt>Party games</dt><dd>{save.totals.partyGames}</dd></div>
    </dl>}

    {tab === 'Profile' && <form className="panel profile-form" onSubmit={event => { event.preventDefault(); void saveName(); }}>
      <label className="field">Stage name<input required maxLength={24} value={name} onChange={event => { setName(event.target.value); setStatus(''); }} /></label>
      {app.profile && <>
        <label className="field">Avatar<select value={app.profile.avatar} onChange={event => void saveName({ avatar: event.target.value as Profile['avatar'] })}>
          {avatars.map(avatar => <option key={avatar}>{avatar}</option>)}</select></label>
        <label className="field">Featured badge<select value={app.profile.badge ?? ''} onChange={event => void saveName({ badge: (event.target.value || null) as Profile['badge'] })}>
          <option value="">None</option>{app.profile.badges.map(badge => <option key={badge} value={badge}>{badgeNames[badge]}</option>)}</select></label>
        <ul className="badge-list">{Object.entries(badgeNames).map(([badge, label]) =>
          <li key={badge} className={app.profile!.badges.includes(badge as keyof typeof badgeNames) ? 'earned' : ''}>{label}</li>)}</ul>
      </>}
      <button type="submit" className="primary">Save profile</button>
      <p role="status">{status}</p>
    </form>}
  </Screen>;
}
