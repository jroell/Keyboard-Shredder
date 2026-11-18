import type { SongCredit } from '../shared/song';

type CatalogTrack = readonly [id: string, title: string, genre: string, prompt: string, long?: {
  seconds: number;
  credit?: SongCredit & { download: string };
}];

export const catalogTracks: readonly CatalogTrack[] = [
  ['blacktop-sparks', 'Blacktop Sparks', 'Hard rock', 'Crunchy highway hard rock, chunky palm-muted riff, rising pentatonic turnaround, 128 BPM, anthemic snare'],
  ['redline-radio', 'Redline Radio', 'Hard rock', 'Bright glam hard rock, swaggering half-time chorus riff, wide open chords, 110 BPM'],
  ['river-amp', 'River Amp', 'Blues', 'Slow electric blues shuffle, call-and-response bends, dry tube-amp lead, 94 BPM'],
  ['midnight-toll', 'Midnight Toll', 'Blues', 'Texas blues-rock boogie, staccato double-stops and walking bass, 134 BPM'],
  ['detour-kids', 'Detour Kids', 'Pop punk', 'Bright pop punk with a bouncing octave hook and fast stop-start power chords, 165 BPM'],
  ['parking-lot-postcard', 'Parking Lot Postcard', 'Pop punk', 'Emotional melodic pop punk, ringing guitar counter-melody and skater-rock drums, 155 BPM'],
  ['glass-circuit', 'Glass Circuit', 'Metal', 'Angular progressive metal, articulated odd-meter chugs alternating with bright single-note lead, 142 BPM'],
  ['foundry-bloom', 'Foundry Bloom', 'Metal', 'Melodic heavy metal, galloping drums, twin lead impression played by one distinct electric guitar, 155 BPM'],
  ['mirrorball-static', 'Mirrorball Static', 'Funk', 'Seventies funk, bright clean electric guitar syncopation, tight dead notes and a memorable pick-scrape hook, 112 BPM'],
  ['orange-pocket', 'Orange Pocket', 'Funk', 'Loose jazz-funk pocket, slippery bluesy lead above a thick bass groove, 101 BPM'],
  ['neon-afterhours', 'Neon Afterhours', 'Synth rock', 'Original synth-rock night drive, gated drums and analog bass behind a distinct soaring electric lead guitar, 118 BPM'],
  ['arc-lights', 'Arc Lights', 'Synth rock', 'Dark electro-rock, half-time drum machine and short distorted guitar phrases with long ringing notes, 105 BPM'],
  ['signal-coast', 'Signal Coast', 'Surf', 'Surf rock, splashy spring reverb and nimble single note tremolo lead, walking bass and organic drums, 146 BPM'],
  ['salt-motor', 'Salt Motor', 'Surf', 'Reverb-drenched instrumental garage surf, bluesy descending electric guitar hook, 120 BPM'],
  ['southbound-61', 'Southbound 61', 'Country rock', 'Country rock, clean twangy electric guitar chicken-picking and held pedal-like bends, 121 BPM'],
  ['open-range', 'Open Range', 'Country rock', 'Dusty southern rock with a relaxed country gallop and a slide-like electric lead theme, 102 BPM'],
  ['umbra-samba', 'Umbra Samba', 'Latin fusion', 'Syncopated Latin rock, crisp clean electric melody over a samba-flavored percussion groove, 115 BPM'],
  ['marigold-run', 'Marigold Run', 'Latin fusion', 'Warm Latin rock with sustained electric guitar bends, steady backbeat and auxiliary congas, 99 BPM'],
  ['paper-antenna', 'Paper Antenna', 'Indie rock', 'Jangly indie guitar rock, chiming electric lead in a wistful repeated motif with live drums, 124 BPM'],
  ['midnight-switch', 'Midnight Switch', 'Indie rock', 'Moody post-punk lead guitar, bright staccato groove, dry bass and a simple escalating hook, 136 BPM'],
  ['voltage-parade', 'Voltage Parade', 'Pop punk', 'Driving pop punk at 148 BPM, palm-muted verse, octave chorus hook, half-time bridge and a melodic eight-bar solo', { seconds: 92 }],
  ['copper-moon', 'Copper Moon', 'Latin fusion', 'Warm Latin rock at 106 BPM, call-and-response guitar hook, live congas and drums, a quieter breakdown and a soaring sustained electric solo', { seconds: 104 }],
  ['big-rock', 'Big Rock', 'Hard rock', '', { seconds: 231, credit: {
    artist: 'Kevin MacLeod', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100305&Search=Search',
    download: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Big%20Rock.mp3',
  } }],
  ['end-of-days', 'End Of Days', 'Metal', '', { seconds: 193, credit: {
    artist: 'Severed Fifth', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    source: 'https://www.jonobacon.com/creative/#liberate',
    download: 'https://audio.lugradio.org/severedfifth/liberate/severedfifth-endofdays.mp3',
  } }],
];
