import type { SongCredit } from '../shared/song';

type CatalogTrack = readonly [id: string, title: string, genre: string, prompt: string, long?: {
  seconds: number;
  excerpt?: boolean;
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
  ['sunday-skank', 'Sunday Skank', 'Reggae', 'Sunny roots reggae at 84 BPM, offbeat guitar skank, a singing clean lead guitar melody, deep bass, a dub breakdown with echoing lead notes and a joyful final chorus', { seconds: 120 }],
  ['glitter-engine', 'Glitter Engine', 'Disco', 'Seventies disco funk at 118 BPM, four on the floor drums, wah guitar hook, octave bass, a string-like guitar chorus melody, a breakdown with handclaps and a flashy lead guitar solo', { seconds: 120 }],
  ['banjo-lightning', 'Banjo Lightning', 'Bluegrass', 'Fast bluegrass flatpicking at 150 BPM played on a bright electric guitar, upright bass and brushed snare, a fiddle-tune style melody, a half-time verse and a blazing final run', { seconds: 110 }],
  ['velvet-detective', 'Velvet Detective', 'Jazz', 'Smoky swing jazz at 126 BPM, walking bass and ride cymbal, a clean hollow-body guitar playing a catchy noir melody, call and response phrases, a bebop-flavored solo and a big ending', { seconds: 120 }],
  ['pixel-comet', 'Pixel Comet', 'Chiptune rock', 'Chiptune rock at 160 BPM, eight-bit arpeggios behind a soaring distorted lead guitar melody, driving drums, a bright heroic chorus, a quiet bridge and a triumphant key change', { seconds: 115 }],
  ['iron-harvest', 'Iron Harvest', 'Metal', 'Epic power metal at 170 BPM, galloping double-kick drums, harmonized lead guitar theme, palm-muted verses, a neoclassical solo with clear single notes and a heroic final chorus', { seconds: 125 }],
  ['lantern-lofi', 'Lantern Lo-fi', 'Lo-fi', 'Dreamy lo-fi hip hop at 78 BPM, dusty drums and warm bass, a mellow clean jazz guitar playing a simple memorable melody with long ringing notes, a sparse middle section and a gentle ending', { seconds: 110 }],
  ['neon-rodeo', 'Neon Rodeo', 'Country rock', 'Upbeat modern country rock at 132 BPM, twangy telecaster lead, train-beat drums, a singalong chorus melody played on guitar, a chicken-picking solo and a stomping finale', { seconds: 115 }],
  ['tidal-cathedral', 'Tidal Cathedral', 'Post-rock', 'Cinematic post-rock at 100 BPM, a clean delayed guitar motif that builds layer by layer, a quiet opening, a slow crescendo, a huge distorted climax with a soaring lead melody and a calm ending', { seconds: 130 }],
  ['havana-voltage', 'Havana Voltage', 'Latin fusion', 'Fiery Latin rock at 124 BPM, congas and timbales, a singing sustained lead guitar theme, montuno-style rhythm, a percussion break and a fast melodic solo with clear phrases', { seconds: 120 }],
  ['kings-of-saturday', 'Kings of Saturday', 'Hard rock', 'Arena hard rock anthem at 122 BPM, a huge open-chord riff, stomp-clap verse, a fist-pumping chorus melody on lead guitar, a breakdown and a wailing bluesy solo before the last chorus', { seconds: 125 }],
  ['midnight-monsoon', 'Midnight Monsoon', 'Synth rock', 'Dark synthwave rock at 110 BPM, pulsing analog bass and gated snare, a neon lead guitar melody with long bends, a tense verse, a wide chorus and an emotional solo', { seconds: 120 }],
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
  ['house-of-the-rising-sun', 'House of the Rising Sun', 'Folk blues', '', { seconds: 210, credit: {
    artist: 'HoliznaCC0', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'https://freemusicarchive.org/music/holiznacc0/house-of-the-rising-sun/house-of-the-rising-sun/',
    download: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/UuS2LvIJRrA6rYTTrGuFI0XzTtESTF0e8XI0reUj.mp3',
  }, excerpt: true }],
];
