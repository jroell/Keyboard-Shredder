import { notesFor } from './difficulty';
import { keyLabel, PRACTICE_ROWS } from './practice';
import type { Chart, Difficulty, SongEvent } from './song';

export type Finger = 'L-pinky' | 'L-ring' | 'L-middle' | 'L-index' | 'R-index' | 'R-middle' | 'R-ring' | 'R-pinky' | 'thumb';
export type KeyInfo = {
  code: string;
  label: string;
  char: string;
  row: 0 | 1 | 2 | 3 | 4;
  column: number;
  finger: Finger;
  hand: 'L' | 'R' | 'both';
};

const columnFingers: readonly Finger[] = [
  'L-pinky', 'L-ring', 'L-middle', 'L-index', 'L-index',
  'R-index', 'R-index', 'R-middle', 'R-ring', 'R-pinky',
];

const keyLayout = PRACTICE_ROWS.flatMap(({ keys }, row) => keys.map((code, index): KeyInfo => {
  const column = Math.min(index, 9);
  const label = keyLabel(code);
  return { code, label, char: label.toLowerCase(), row: row as KeyInfo['row'], column, finger: columnFingers[column], hand: column < 5 ? 'L' : 'R' };
}));
keyLayout.push({ code: 'Space', label: 'Space', char: ' ', row: 4, column: 4.5, finger: 'thumb', hand: 'both' });

// Capital letters and a few marks need Shift. They are their own "keys", written as Shift+<code>.
const shiftedMarks: Record<string, string> = { Slash: '?', Digit1: '!' };
const shiftLayout = keyLayout.flatMap((key): KeyInfo[] => {
  const char = /^Key[A-Z]$/.test(key.code) ? key.char.toUpperCase() : shiftedMarks[key.code];
  return char ? [{ ...key, code: `Shift+${key.code}`, label: char, char }] : [];
});

const keysByCode = new Map([...keyLayout, ...shiftLayout].map(key => [key.code, key]));
const codesByChar = new Map([...keyLayout, ...shiftLayout].map(key => [key.char, key.code]));

/** Every plain key, without the Shift variants. */
export const ALL_TYPING_KEYS: readonly string[] = keyLayout.map(key => key.code);
export const SHIFT_TYPING_KEYS: readonly string[] = shiftLayout.map(key => key.code);
export const needsShift = (code: string) => code.startsWith('Shift+');
/** The physical key behind a code: 'Shift+KeyA' is 'KeyA'. */
export const baseKey = (code: string) => code.replace(/^Shift\+/, '');

export function keyInfo(code: string): KeyInfo | undefined {
  return keysByCode.get(code);
}

export function charFor(code: string): string {
  return keyInfo(code)?.char ?? '';
}

export function codeFor(char: string): string | undefined {
  return codesByChar.get(char) ?? codesByChar.get(char.toLowerCase());
}

export type LessonKind = 'drill' | 'words' | 'sentences';
export type TypingLesson = {
  id: string;
  unit: number;
  unitName: string;
  title: string;
  blurb: string;
  keys: string[];
  newKeys: string[];
  kind: LessonKind;
  songId: string;
  difficulty: Difficulty;
  goal: { accuracy: number; wpm: number };
};

type LessonRow = [
  id: string, title: string, blurb: string, characters: string, kind: LessonKind,
  songId: string, wpm: number, drillKeys?: string,
];

const units: { name: string; lessons: LessonRow[] }[] = [
  { name: 'Home row', lessons: [
    ['f-j', 'F and J', 'Rest your index fingers on F and J.', 'fj', 'drill', 'river-amp', 10],
    ['d-k', 'D and K', 'Use your middle fingers for D and K.', 'dk', 'drill', 'marigold-run', 11],
    ['s-l', 'S and L', 'Use your ring fingers for S and L.', 'sl', 'drill', 'orange-pocket', 12],
    ['a-semicolon', 'A and semicolon', 'Use your pinkies for A and semicolon.', 'a;', 'drill', 'arc-lights', 13],
    ['g-h', 'G and H', 'Reach inward with your index fingers for G and H.', 'gh', 'drill', 'mirrorball-static', 14],
    ['home-words', 'Home row words', 'Keep your fingers on the home row and tap Space with a thumb.', ' ', 'words', 'redline-radio', 16],
  ] },
  { name: 'Top row', lessons: [
    ['e-i', 'E and I', 'Reach up with your middle fingers for E and I.', 'ei', 'drill', 'mirrorball-static', 17],
    ['r-u', 'R and U', 'Reach up with your index fingers for R and U.', 'ru', 'drill', 'redline-radio', 18],
    ['t-y', 'T and Y', 'Reach diagonally up with your index fingers for T and Y.', 'ty', 'drill', 'umbra-samba', 19],
    ['w-o', 'W and O', 'Reach up with your ring fingers for W and O.', 'wo', 'drill', 'neon-afterhours', 20],
    ['q-p', 'Q and P', 'Reach up with your pinkies for Q and P.', 'qp', 'drill', 'salt-motor', 21],
    ['top-words', 'Top row words', 'Bring each finger back to the home row after reaching up.', '', 'words', 'southbound-61', 22],
  ] },
  { name: 'Bottom row', lessons: [
    ['v-m', 'V and M', 'Reach down with your index fingers for V and M.', 'vm', 'drill', 'neon-afterhours', 23],
    ['c-n', 'C and N', 'Use your left middle finger for C and your right index finger for N.', 'cn', 'drill', 'salt-motor', 24],
    ['b-x', 'B and X', 'Use your left index finger for B and your left ring finger for X.', 'bx', 'drill', 'southbound-61', 25],
    ['z-comma-period', 'Z, comma and period', 'Use your left pinky for Z and your right middle and ring fingers for comma and period.', 'z,.', 'drill', 'paper-antenna', 26],
    ['all-letter-words', 'All letter words', 'Bring each finger back to the home row between reaches.', '', 'words', 'blacktop-sparks', 28],
  ] },
  { name: 'Fluency', lessons: [
    ['common-words', 'Word mix', 'Keep your fingers relaxed and tap Space with a thumb.', '', 'words', 'blacktop-sparks', 30],
    ['longer-words', 'Longer words', 'Let each finger take its own column through the whole word.', '', 'words', 'midnight-switch', 33],
    ['sentences', 'Sentences', 'Keep your fingers near the home row and use a thumb between words.', '', 'sentences', 'copper-moon', 36],
    ['speed-run', 'Speed run', 'Use light taps and return your fingers to the home row as you pick up speed.', '', 'sentences', 'voltage-parade', 40],
  ] },
  { name: 'Capitals and punctuation', lessons: [
    ['capital-words', 'Capital letters', 'Hold Shift with the little finger of the other hand, then press the letter.', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'words', 'umbra-samba', 30],
    ['proper-sentences', 'Proper sentences', 'Start each sentence with a capital and end it with a full stop.', '', 'sentences', 'copper-moon', 34],
    ['questions', 'Questions and shouts', 'Hold Shift for the question mark and the exclamation mark.', '?!', 'sentences', 'voltage-parade', 36],
  ] },
  { name: 'Numbers', lessons: [
    ['middle-numbers', '4, 5, 6 and 7', 'Reach up with your index fingers for the four middle numbers.', '4567', 'drill', 'midnight-toll', 40, '4567 '],
    ['outer-numbers', 'Outer numbers', 'Reach up with your pinkies, ring fingers and middle fingers for the outer numbers.', '123890', 'drill', 'glass-circuit', 41, '123890 '],
    ['mixed-numbers', 'All ten numbers', 'Mix all ten numbers. Each one belongs to the finger for the letters below it.', '', 'drill', 'signal-coast', 42, '1234567890 '],
  ] },
  { name: 'Coder keys', lessons: [
    ['coder-punctuation', 'Semicolon, quote and slash', 'Use your right pinky for semicolon, quote and slash.', "'/", 'drill', 'midnight-switch', 43, ";'/ "],
    ['brackets-minus-equal', 'Brackets, minus and equal', 'Reach right with your right pinky for brackets, minus and equal.', '[]-=', 'drill', 'glass-circuit', 44, '[]-= '],
    ['vim-moves', 'Vim moves', 'Use your index fingers for H, J, B and G, then reach with your other fingers for K, L, W and E.', '', 'drill', 'signal-coast', 45, 'hjklwbeg '],
  ] },
];

export const TYPING_LESSONS: readonly TypingLesson[] = (() => {
  const learned = new Set<string>();
  return units.flatMap(({ name, lessons }, index) => lessons.map(
    ([id, title, blurb, characters, kind, songId, wpm, drillKeys], lessonIndex): TypingLesson => {
      const newKeys = Array.from(characters, char => codesByChar.get(char)!);
      newKeys.forEach(code => learned.add(code));
      // A drill mixes its new keys with the home-row anchors, so the new reaches come up often.
      const anchors = ['KeyF', 'KeyJ', 'KeyD', 'KeyK', 'KeyS', 'KeyL', 'Space'].filter(code => learned.has(code));
      const keys = drillKeys ? Array.from(drillKeys, char => codesByChar.get(char)!)
        : kind === 'drill' ? [...new Set([...newKeys, ...anchors])] : [...learned];
      const difficulty = index === 0 && lessonIndex < 3 ? 'beginner'
        : id === 'speed-run' ? 'hard' : index === 3 ? 'medium' : 'easy';
      return {
        id, unit: index + 1, unitName: name, title, blurb, keys, newKeys, kind, songId, difficulty,
        goal: { accuracy: kind === 'drill' ? 80 : 85, wpm },
      };
    },
  ));
})();

export const WORDS: readonly string[] = `
ad add adds ads aha alas all as ash ask asks dad dads dash fad fads fall falls flag flags flash flask flasks gag gags gal gals gall gas glad glass had hall halls half has lad lads lag lags lash lass sag sags saga salad salads salsa shall slash
able about above absent accept across act action active actual adapt admit adopt adult after again age ago agree aid aim air aisle alarm album alert alike alive allow ally almost alone along aloud also alter always amber among amount angel angle animal ankle answer any apart apple apron area argue arise arm armor army around art artist aspen atlas atom attach attic aunt autumn avoid awake award away awful
baby back badge bag bake baker ball band bang bank barn base basic basil basin basket bass batch bath bay beach bead beam bean bear beat bearable beauty become bed bee beef been before begin behind bell below belt bend bent berry best better bike bill bind bird birth bit bite black blade blame bland blank blast blaze blend bless blind blink block bloom blot blow blue board boat body boil bold bolt bond bone bonus book boom boot border born boss both bowl box boy brain brake branch brass brave bread break breeze brick bride brief bright bring brisk broad brook broom brown brush budget build bulb bulk bump bunch bundle bunny burn burst bus bush busy butter button buzz
cabin cable cage cake call calm camel camp can canal candy canoe cape cap card care cargo carp carry cart carve case cash cast castle cat catch cause cave cedar cell cent center cereal chain chair chalk chance change chant charm chart chase chat cheap check cheek cheer cheese chef cherry chess chest chew chick chief child chill chime chin chip chirp choice choose chord chunk city claim clam clap class clay clean clear clerk click cliff climb clip clock close cloth cloud clover club clue coach coast coat cocoa coffee coil coin cold collar color colt comb come comet comic common cone cook cookie cool coral cord core cork corn corner cost cotton couch could count county court cove cover cow crack craft crane crate crawl cream create creek crew crisp crop cross crowd crown crumb crush cub cube cuff cup cure curl curve cushion cycle cymbal
dance dare dark dart date dawn day dear deck deep deer delay denim dense dent depth desk dial dice diet dig dime dine dinner direct dirt dish dive dock dodge dog doll dome done door dot dove down dozen draft drag draw drawer dream dress drift drill drink drip drive drop drum dry duck dull dune dusk dust duty
each eagle ear early earn earth ease east easy eat echo edge edit eel effect egg eight either elbow elder elect elf elk elm else email end enjoy enter entry equal erase error essay even event ever every exact exam exit extra eye
face fact fade faint fair fairy faith fake fame fan fancy far farm fast feast fed feel fern fetch few field fig file fill film final fin find fine firm first fish fizz flat fleet flew flip float flock flood floor flour flow flute foam fog fold folk food foot force ford fork form fort forth found fox free fresh frog from front frost fruit fuel full fun funny fur fuse
gain game gap garage garden gate gather gauge gears gem gentle giant gift gill give given glacier glow glue goal goat goes gold golf gone good goose grain grand grape grass grate gravy gray great green greet grew grill grin grip grit grow guard guess guide guild guitar gull gust gym
habit hail hair hand  happy hard harp harvest  hat hatch hawk hay hazel head heal heap hear heard heart heat heavy hedge heel held hello help herb herd here hero hers hide high hike hill hint hip hire hive hold hole hollow home honey hood hook hope horn horse hose host hot hotel hour house hover howl huge hum hunt hurry hush
ice icon idea idle inch index indoor ink inn input inside into iris iron island item ivory
ivy jack jade jam jar jazz jeep jelly jet jewel job jog join joke jolly joy judge jug juice jump june just keen keep kelp kept kettle key kick kid kind king kite knee knew knit knob knot know
label lace lack lake lamb lamp land lane lap large last late later latte laugh lay layer lazy lead leaf lean leap learn lease least leave ledge leek left legal lemon lend lens lent level lever lid life lift light lime limit line linen link lion lips list live load loaf loan lobby local lock lodge loft log long look loop loose lord lose loss lost loud love low loyal luck lunar lunch lush lute
machine mail main make mall malt mane many maple marble march mark marsh mask mast mat match mate maze meadow meal mean melt memo mend menu mere merge merit merry mesh mess metal meter mild mile milk mill mind mine mint minute mist mitt mix mochi mode mole month moon moor moss moth motor mound mount mouse mouth move movie mow much mule mulch mural muse music must myth
nail name narrow navy near neat neck need nest net never news new next nice night nine noble node noise noon north nose note noun novel now numb nurse nut nylon
oar oasis obey ocean odd offer often oil okay old olive omen once one onion only onto open opera orbit order organ otter other our outer oven over oval owl own
pace pack page paid pail paint pair pale palm pan panda panel paper park part party pass past pasta patch path pause pave paw pea peach peak pear pearl pecan peel peer pen penny perch pest pet phase piano pick picnic pie pier pig pile pill pilot pine pink pin pipe pitch pizza place plain plan plane plank plant plate play plaza plea plow plug plum plus poem poet point pole polo pond pony pool pop porch pose post  pound pour power press price pride prime print prism prize proof prop prose proud prune puff pull pulp pulse pump punch pup puppy pure purse push put puzzle
quail quart queen query quest quick quiet quilt quite quiz quote
race rack raft rag rail rain raise rake ramp ranch rang range rank rapid rare rate ratio rave raw ray reach read ready real reed reef reel reign relay rent rest ride ridge right rim ring rinse ripe rise risk river road roam roast robe robin rock rod rode roll roof rook room root rope rose round route row royal ruby rug rule run rung rush rust
sack safe sage sail sake sale salt same sand save saw scale scan scarf scene scent scoop score scout scrap seal seam seat seed seek seem seen self sell send sense sent serve seven shade shake shale shape share shark sharp shawl shed sheep sheet shelf shell shift shine ship shirt shoe shop shore short shout show shrub shut shy side sift sign silk sill silo silver simple sing sink sip sir size skate sketch ski skill skim skin skip skirt sky slab slack sled sleep sleek slice slide slim slope slot slow slug small smart smell smile  smooth snack snail snap snow sock soda soft soil solar sold sole solo solve some song soon sore sort soup sour south space spark speak spear spell spice spill spin spoke spoon sport spot spray spring spur square stack staff stage stair stamp stand star stare start stay steam steel stem step stew stick still stir stone stool stop store stork storm story stove straw stream street string  strum study stuff style such suit sugar sum sun sunny super sure surf swamp swan sway sweep sweet swell swept swift swim swing swirl
table tack taco tail take tale talk tall tame tang tank tap tape task taste taught team tear teak tell tempo ten tent term test text than thank that thaw them then there these theta thick thief thin thing think third thorn those three threw throw thumb thyme tick tide tidy tie tier tile tilt time tin tint tiny tire toast today toe tofu token told toll tone tonic took tool top torch toss tote touch tour towel tower town toy trace track trade trail train tray treat tree trek trend trim trio trip troll trout true trunk trust truth tube tuck tulip tuna tune turf turn tusk twig twin twine twist two type
under undo unit until upon upper urban urge use usher usual
vale valve value van vase vast vault veer vegan veil vein vent venue verb verse vest view vine vinyl viola violet viral visit vivid vocal voice volt vote vow
wade wafer wage wait wake walk wall wand want warm warp wash wasp waste watch wave wax way wear weave web  week weigh well west wet whale wheat wheel when where which while white whole wide width wild will wily wind  wing wink wipe wire wise wish wisp with woke wolf wood wool word wore work world worm worn woven wrap wren wrist write
yacht yam yard yarn yawn year yeast yell yoga yoke yolk you young your youth yummy zebra zero zest zinc zone zoom
`.trim().split(/\s+/);

export const SENTENCES: readonly string[] = [
  'the quick brown fox jumps over the lazy dog',
  'the whole room clapped along with the drummer',
  'we tuned our guitars before the sun came up',
  'the singer waved and counted in the band',
  'a bright melody drifted down the busy street',
  'our drummer taught the crowd a steady beat',
  'the neighbors sang the chorus from their porch',
  'we played the last chord and took a bow',
  'she tapped her foot as the record spun',
  'his bass line made the little speakers shake',
  'the band played on beneath the paper stars',
  'we heard the guitar across the school yard',
  'i hummed that tune all the way home',
  'the piano filled the hall with gentle chords',
  'our friends brought snacks for the long rehearsal',
  'we took turns playing solos after the show',
  'the crowd cheered when the lights came up',
  'we found our rhythm halfway through the verse',
  'she played a riff that made us grin',
  'he fixed a loose cable before the show',
  'the first song started with a single drum',
  'we packed the van and hit the road',
  'the summer breeze carried music across the park',
  'we learned a new song on the train',
  'everyone stomped in time with the bass drum',
  'a quiet verse gave way to bright harmonies',
  'our little garage sounded like a concert hall',
  'we wrote the chorus on a paper bag',
  'they asked the band to play one more',
  'she sang a melody over the opening riff',
  'he found the right note on his keyboard',
  'the brass section made the whole parade dance',
  'the guitarist smiled and handed me a pick',
  'our best songs started with a simple beat',
  'we tried a slower groove and liked it',
  'the cymbals rang as we finished the song',
  'i heard the tune and started to dance',
  'every voice in the room found the chorus',
  'we carried the drums up the back stairs',
  'the radio played our song on the drive',
  'we played three chords and the room sang',
  'the little stage glowed under the warm lights',
  'she hit the high note and we cheered',
  'we stayed in time and finished together',
  'the bass player counted and everyone came in',
  'a kid in the front row knew every word',
  'the room went quiet before the opening chord',
  'we made a song from four easy notes',
  'the fiddle led us through the final chorus',
  'a borrowed amp got us through the set',
];

export type TypingOptions = {
  keys: readonly string[];
  newKeys?: readonly string[];
  focus?: readonly string[];
  kind: LessonKind;
  difficulty: Difficulty;
  seed: number;
  /** Only use words at least this long. */
  minLength?: number;
};
export type TypingChart = {
  keys: string[];
  events: SongEvent[];
  text: string;
  words: { text: string; first: number; last: number }[];
};

const minGaps: Record<Difficulty, number> = { beginner: 420, easy: 300, medium: 220, hard: 170, expert: 130 };

function seededRandom(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

function drillGroups(
  length: number, chars: readonly string[], preferred: ReadonlySet<string>, separator: string, random: () => number,
): string[] {
  if (!chars.length) return [];
  const groups: string[] = [];
  const maxSize = chars.length === 1 ? 2 : 5;
  if (!separator && chars.length === 1) length = Math.min(length, maxSize);
  const weighted = chars.flatMap(char => preferred.has(char) ? [char, char, char] : [char]);
  let remaining = length;
  let previous = '';
  let streak = 0;
  while (remaining > 0) {
    const sizes: number[] = [];
    for (let size = 2; size <= Math.min(maxSize, remaining); size++) {
      const rest = remaining - size;
      if (rest === 0 || rest >= separator.length + 2) sizes.push(size);
    }
    const size = sizes.length ? pick(sizes, random) : 1;
    let group = '';
    for (let index = 0; index < size; index++) {
      const char = pick(streak < 2 ? weighted : weighted.filter(key => key !== previous), random);
      streak = char === previous ? streak + 1 : 1;
      previous = char;
      group += char;
    }
    groups.push(group);
    remaining -= size + separator.length;
    if (separator) streak = 0;
  }
  return groups;
}

function typingGroups(length: number, options: TypingOptions): { groups: string[]; separator: string } {
  const chars = [...new Set(options.keys.map(charFor))].filter(char => char && char !== ' ');
  const allowed = new Set(chars);
  const preferred = new Set([...(options.newKeys ?? []), ...(options.focus ?? [])].map(charFor));
  const random = seededRandom(options.seed);
  const isTypeable = (phrase: string) => Array.from(phrase).every(char => char === ' ' || allowed.has(char));
  const plain = (phrase: string) => Array.from(phrase).every(char => char === ' ' || allowed.has(char));
  const sentences = options.kind === 'sentences' ? SENTENCES.filter(plain) : [];
  const words = options.kind !== 'drill' && !sentences.length ? WORDS.filter(word => plain(word) && word.length >= (options.minLength ?? 0)) : [];
  const vim = options.kind === 'drill' && options.keys.length <= 9 && ['KeyH', 'KeyJ', 'KeyK', 'KeyL', 'KeyW', 'KeyB'].every(code => options.keys.includes(code));
  const cased = options.keys.some(needsShift);
  const marks = ['.', '?', '!'].filter(mark => allowed.has(mark));
  const dress = (phrase: string, index: number) => {
    if (!cased) return phrase;
    if (options.kind !== 'sentences') return phrase[0].toUpperCase() + phrase.slice(1);
    const body = phrase.split(' ').map(word => word === 'i' ? 'I' : word).join(' ');
    return body[0].toUpperCase() + body.slice(1) + (allowed.has('.') ? '.' : '');
  };
  // Question marks only follow real questions, and exclamation marks real shouts.
  const marked = [
    ...(allowed.has('?') ? QUESTIONS.filter(plain).map(text => dress(text, 0).replace(/\.$/, '') + '?') : []),
    ...(allowed.has('!') ? SHOUTS.filter(plain).map(text => dress(text, 0).replace(/\.$/, '') + '!') : []),
  ];
  const source = vim ? VIM_MOVES : sentences.length ? sentences : words.length >= 8 ? words : [];
  const bank = (options.kind === 'sentences' && marked.length ? [...marked, ...source.slice(0, marked.length).map(dress)] : source.map(dress)).filter(isTypeable);
  const preferredWords = sentences.length ? [] : bank.filter(word => Array.from(word).some(char => preferred.has(char)));
  const separator = bank.length || options.keys.includes('Space') ? ' ' : '';
  const groups: string[] = [];
  let remaining = length;
  let previous = '';
  const used = new Set<string>();

  while (remaining > 0) {
    const fitsRemaining = (phrase: string) => phrase !== previous &&
      (phrase.length === remaining || phrase.length <= remaining - 2);
    // Sentences are not repeated inside one lesson while fresh ones remain.
    const fresh = bank.filter(phrase => fitsRemaining(phrase) && !used.has(phrase));
    const fits = fresh.length || bank.length > 40 ? fresh : bank.filter(fitsRemaining);
    if (!fits.length) break;
    const favored = preferredWords.filter(fitsRemaining);
    const phrase = pick(favored.length && random() < 0.7 ? favored : fits, random);
    groups.push(...phrase.split(' '));
    previous = phrase;
    used.add(phrase);
    remaining -= phrase.length + separator.length;
  }

  // A lesson of words or sentences ends on a whole one. Only key drills are filled with letter groups.
  if (!groups.length) groups.push(...drillGroups(remaining, chars, preferred, separator, random));
  return { groups, separator };
}

const QUESTIONS = ['can you play the drums fast', 'who wants to sing along today', 'what song should we play next', 'can you hear the guitar solo', 'do you like this happy tune', 'who is ready to dance now', 'can we make music together friends', 'what instrument do you like best', 'is the band ready to play', 'can you clap to the beat', 'who loves a fun music show', 'do you want to join us', 'can you sing a high note', 'what music makes you smile most'];
const SHOUTS = ['we love this song so much', 'play it again please friends', 'best band ever yay team', 'dance with us right now', 'sing it loud and proud', 'hooray for the music show', 'that guitar sounds so cool', 'clap your hands with joy', 'we did it together band', 'more music more fun please'];

/** Real Vim motions: move by character, by word, to the top and to the end of a word. */
const VIM_MOVES = ['hjkl', 'jjj', 'kkk', 'hhh', 'lll', 'jk', 'kj', 'hl', 'lh', 'www', 'bbb', 'wb', 'bw', 'eee', 'we', 'gg', 'ge', 'jjkk', 'hhll', 'wwbb', 'ggjj', 'lwe', 'kbh'];

export function buildTypingChart(chart: Chart, options: TypingOptions): TypingChart {
  // Riff notes plus every beat, so letters keep coming through the quiet bars.
  const noteTimes = notesFor(chart, options.difficulty).map(note => note.timeMs);
  const beats = chart.beatsMs.filter(beat => beat < chart.durationMs - 700 && !noteTimes.some(time => Math.abs(time - beat) < 140));
  const times: number[] = [];
  for (const time of [...noteTimes, ...beats].sort((a, b) => a - b)) {
    if (time - (times.at(-1) ?? -Infinity) >= minGaps[options.difficulty]) times.push(time);
  }

  const { groups, separator } = typingGroups(times.length, options);
  const text = groups.join(separator);
  const usedCodes = new Set(Array.from(text, char => codesByChar.get(char)!));
  const keys = [...ALL_TYPING_KEYS, ...SHIFT_TYPING_KEYS].filter(code => usedCodes.has(code)).sort((a, b) => Number(a === 'Space') - Number(b === 'Space'));
  const lanes = new Map(keys.map((code, index) => [charFor(code), index]));
  const events = Array.from(text, (char, index): SongEvent => ({
    id: 'type-' + index, timeMs: times[index], lanes: [lanes.get(char)!], durationMs: 0,
  }));
  let offset = 0;
  const words = groups.map(group => {
    const first = offset;
    offset += group.length + separator.length;
    return { text: group, first, last: first + group.length - 1 };
  });
  return { keys, events, text, words };
}

export function wpm(correctChars: number, elapsedMs: number): number {
  return elapsedMs < 1000 ? 0 : Math.round(correctChars * 120_000 / elapsedMs) / 10;
}

export type KeyStat = { attempts: number; hits: number; timingTotal: number };
export type KeyStats = Record<string, KeyStat>;

export function mergeKeyStats(a: KeyStats, b: KeyStats): KeyStats {
  const codes = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Object.fromEntries(Array.from(codes, code => {
    const first = Object.hasOwn(a, code) ? a[code] : undefined;
    const second = Object.hasOwn(b, code) ? b[code] : undefined;
    return [code, {
      attempts: (first?.attempts ?? 0) + (second?.attempts ?? 0),
      hits: (first?.hits ?? 0) + (second?.hits ?? 0),
      timingTotal: (first?.timingTotal ?? 0) + (second?.timingTotal ?? 0),
    }];
  }));
}

export function weakestKeys(stats: KeyStats, count: number, minAttempts = 5): string[] {
  const hitRate = (stat: KeyStat) => stat.attempts ? stat.hits / stat.attempts : 0;
  const meanTiming = (stat: KeyStat) => stat.hits ? stat.timingTotal / stat.hits : 0;
  return Object.entries(stats)
    .filter(([, stat]) => stat.attempts >= minAttempts)
    .sort(([, a], [, b]) => hitRate(a) - hitRate(b) || meanTiming(b) - meanTiming(a))
    .slice(0, Math.max(0, count))
    .map(([code]) => code);
}

export type LessonProgress = Record<string, { bestAccuracy: number; bestWpm: number; stars: number; plays: number }>;

export function lessonStatus(lessonId: string, progress: LessonProgress): 'locked' | 'open' | 'passed' {
  const index = TYPING_LESSONS.findIndex(lesson => lesson.id === lessonId);
  if (index < 0) return 'locked';
  const passed = (lesson: TypingLesson) => (progress[lesson.id]?.bestAccuracy ?? 0) >= lesson.goal.accuracy;
  if (passed(TYPING_LESSONS[index])) return 'passed';
  return index === 0 || passed(TYPING_LESSONS[index - 1]) ? 'open' : 'locked';
}

export function typingStars(accuracy: number, wpmValue: number, lesson: TypingLesson): 0 | 1 | 2 | 3 {
  // Speed is set by the song, so stars reward accuracy. `wpmValue` only has to show the run was played.
  if (accuracy < lesson.goal.accuracy || wpmValue <= 0) return 0;
  return accuracy >= 97 ? 3 : accuracy >= 92 ? 2 : 1;
}
