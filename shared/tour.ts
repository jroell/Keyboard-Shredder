export type TourTrack = { id: string; title: string };
export type TourVenue = {
  id: string;
  name: string;
  scene: string;
  sendoff: string;
  tracks: readonly TourTrack[];
};
export type TourProgress = Record<string, number>;

export const TOUR_PASS_ACCURACY = 60;
export const TOUR_VENUES: readonly TourVenue[] = [
  {
    id: 'switchyard', name: 'Switchyard Rehearsal',
    scene: 'A mechanic clears a corner of the workshop for your first set. Start with blues and country rock while the crew finishes the night shift.',
    sendoff: 'A pavilion booker caught the last song. You leave with your first weekend booking.',
    tracks: [
      { id: 'river-amp', title: 'River Amp' },
      { id: 'midnight-toll', title: 'Midnight Toll' },
      { id: 'southbound-61', title: 'Southbound 61' },
      { id: 'open-range', title: 'Open Range' },
    ],
  },
  {
    id: 'breakwater', name: 'Breakwater Pavilion',
    scene: 'Someone from the workshop books you at a wind-battered pavilion. Play surf riffs and indie rock while the crowd moves in from the pier.',
    sendoff: 'The crowd stayed through the cold. The pavilion manager puts you in touch with a club downtown.',
    tracks: [
      { id: 'signal-coast', title: 'Signal Coast' },
      { id: 'salt-motor', title: 'Salt Motor' },
      { id: 'paper-antenna', title: 'Paper Antenna' },
      { id: 'midnight-switch', title: 'Midnight Switch' },
    ],
  },
  {
    id: 'copper-room', name: 'The Copper Room',
    scene: 'A dance club has an opening before its headliner. Its rhythm section will keep the floor moving while you work through funk and Latin fusion.',
    sendoff: 'The owner offers you a return set, and the sound tech has another show in mind.',
    tracks: [
      { id: 'orange-pocket', title: 'Orange Pocket' },
      { id: 'mirrorball-static', title: 'Mirrorball Static' },
      { id: 'umbra-samba', title: 'Umbra Samba' },
      { id: 'marigold-run', title: 'Marigold Run' },
    ],
  },
  {
    id: 'afterglow', name: 'Afterglow Arcade',
    scene: 'The club sound tech gets you a slot at an all-ages arcade. Build from synth rock to pop punk as the players leave their cabinets for the stage.',
    sendoff: 'The arcade empties onto the dance floor. A promoter asks you to open at Rivet Hall.',
    tracks: [
      { id: 'neon-afterhours', title: 'Neon Afterhours' },
      { id: 'arc-lights', title: 'Arc Lights' },
      { id: 'parking-lot-postcard', title: 'Parking Lot Postcard' },
      { id: 'detour-kids', title: 'Detour Kids' },
    ],
  },
  {
    id: 'rivet-hall', name: 'Rivet Hall',
    scene: 'Your arcade crowd follows you to a converted factory. Handle the hard rock and metal set to earn the last open slot at the festival.',
    sendoff: 'You clear the heaviest set of the tour. The promoter hands you the festival schedule.',
    tracks: [
      { id: 'blacktop-sparks', title: 'Blacktop Sparks' },
      { id: 'redline-radio', title: 'Redline Radio' },
      { id: 'glass-circuit', title: 'Glass Circuit' },
      { id: 'foundry-bloom', title: 'Foundry Bloom' },
      { id: 'raincoat-static', title: 'Raincoat Static' },
    ],
  },
  {
    id: 'skybridge', name: 'Skybridge Festival',
    scene: 'You have the closing slot on a stage above the rail yard. The mechanic from your first show is in the front row for your festival set.',
    sendoff: 'A promoter in the crowd books you on a tour abroad, starting with a cruise out of the harbor.',
    tracks: [
      { id: 'voltage-parade', title: 'Voltage Parade' },
      { id: 'copper-moon', title: 'Copper Moon' },
      { id: 'big-rock', title: 'Big Rock' },
      { id: 'end-of-days', title: 'End Of Days' },
    ],
  },
  {
    id: 'harbor-lights', name: 'Harbor Lights Cruise',
    scene: 'You board a music cruise ship as it leaves the harbor. You start at a laid-back deck party at sunset, then you move to the ballroom and the late-night lounge.',
    sendoff: 'You leave the ship and head to the Crossroads Fairground.',
    tracks: [
      { id: 'sunday-skank', title: 'Sunday Skank' },
      { id: 'glitter-engine', title: 'Glitter Engine' },
      { id: 'lantern-lofi', title: 'Lantern Lo-fi' },
      { id: 'velvet-detective', title: 'Velvet Detective' },
    ],
  },
  {
    id: 'crossroads', name: 'Crossroads Fairground',
    scene: 'You arrive at a huge summer fair with four stages and a storm on the horizon. You play the rodeo arena, a street party and the stadium stage.',
    sendoff: 'You leave the Crossroads Fairground and fly overseas to the Passport Festival.',
    tracks: [
      { id: 'banjo-lightning', title: 'Banjo Lightning' },
      { id: 'neon-rodeo', title: 'Neon Rodeo' },
      { id: 'havana-voltage', title: 'Havana Voltage' },
      { id: 'kings-of-saturday', title: 'Kings of Saturday' },
    ],
  },
  {
    id: 'passport', name: 'Passport Festival',
    scene: 'You join the Passport Festival, a travelling festival with a stage in a different country nightly. You play ska punk in a checkerboard club, Celtic rock at an Irish harbor, flamenco rock in a Spanish courtyard and city pop on a rooftop above a neon skyline.',
    sendoff: 'Your last flight lands under the northern lights at the Aurora Dome.',
    tracks: [
      { id: 'rude-brass-riot', title: 'Rude Brass Riot' },
      { id: 'emerald-reel', title: 'Emerald Reel' },
      { id: 'flamenco-thunder', title: 'Flamenco Thunder' },
      { id: 'sugar-skyline', title: 'Sugar Skyline' },
    ],
  },
  {
    id: 'aurora-dome', name: 'Aurora Dome',
    scene: 'You play a futuristic arena under the northern lights. You face the biggest crowd of the tour in the final show before you go home.',
    sendoff: 'You return home to the courtyard for the Sunrise Encore.',
    tracks: [
      { id: 'pixel-comet', title: 'Pixel Comet' },
      { id: 'midnight-monsoon', title: 'Midnight Monsoon' },
      { id: 'iron-harvest', title: 'Iron Harvest' },
      { id: 'tidal-cathedral', title: 'Tidal Cathedral' },
      { id: 'clockwork-sirens', title: 'Clockwork Sirens' },
    ],
  },
  {
    id: 'sunrise-encore', name: 'Sunrise Encore',
    scene: 'The festival ends, but the crew has one request. Play a familiar folk-blues tune in a courtyard as the sun comes up.',
    sendoff: 'The crew sings the melody back to you. You started in a workshop and finished the tour with the whole city listening.',
    tracks: [{ id: 'house-of-the-rising-sun', title: 'House of the Rising Sun' }],
  },
];

export const TOUR_TRACKS = TOUR_VENUES.flatMap(venue => venue.tracks);

function isValidAccuracy(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function isTourSongCleared(trackId: string, progress: TourProgress) {
  const accuracy = progress[trackId];
  return isValidAccuracy(accuracy) && accuracy >= TOUR_PASS_ACCURACY;
}

export function isTourSongUnlocked(trackId: string, progress: TourProgress) {
  const index = TOUR_TRACKS.findIndex(track => track.id === trackId);
  return index >= 0 && TOUR_TRACKS.slice(0, index).every(track => isTourSongCleared(track.id, progress));
}

export function tourStart(progress: TourProgress): string | null {
  return TOUR_TRACKS.find(track => !isTourSongCleared(track.id, progress))?.id ?? null;
}

export function recordTourResult(progress: TourProgress, trackId: string, accuracy: number): TourProgress {
  if (!isValidAccuracy(accuracy) || !isTourSongUnlocked(trackId, progress)) return progress;
  if (isValidAccuracy(progress[trackId]) && progress[trackId] >= accuracy) return progress;
  return { ...progress, [trackId]: accuracy };
}

export function normalizeTourProgress(value: unknown): TourProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const progress: TourProgress = {};
  for (const track of TOUR_TRACKS) {
    const accuracy = (value as Record<string, unknown>)[track.id];
    if (!isValidAccuracy(accuracy)) break;
    progress[track.id] = accuracy;
    if (!isTourSongCleared(track.id, progress)) break;
  }
  return progress;
}
