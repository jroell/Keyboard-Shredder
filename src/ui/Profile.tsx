import { Flame, Guitar, Star, Zap } from 'lucide-react';
import { badgeNames, type Profile } from '../../shared/duel';

const icons = { Guitar, Lightning: Zap, Star, Fire: Flame };

export function PlayerCard({ profile }: { profile: Profile }) {
  const Icon = icons[profile.avatar] ?? Guitar;
  return <div className="player-card">
    <Icon aria-hidden="true" size={25} />
    <div><strong>{profile.name}</strong>{profile.badge && <span className="duel-badge">{badgeNames[profile.badge]}</span>}</div>
  </div>;
}
