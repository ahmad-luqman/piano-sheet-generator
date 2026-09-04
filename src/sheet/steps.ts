import type { Arrangement, Hand, Level, LevelId, Note, Section } from '../types';
import { midiToName } from '../arrange/theory';
import { findMotif, findShapes } from '../arrange/motifs';
import type { PlayMode } from '../practice/player';

export interface StepAction {
  startBar: number;      // 0-based inclusive
  endBar: number;        // 0-based inclusive
  hands: 'both' | 'rh' | 'lh';
  tempoScale: number;    // 0.5 = half speed
  level: LevelId;
  mode: PlayMode;
}

export interface Step {
  title: string;
  body: string;
  action?: StepAction;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  YOUR DECISION POINT #3 — how fast should a learner ramp up?
 *
 *  Returns the tempo fractions used for the "hands together" steps. The default
 *  goes 60% → 80% → 100%. Some teachers prefer more, smaller steps (50/65/80/90/100);
 *  others skip straight to 75% then full speed once a section is clean.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function tempoRamp(): number[] {
  return [0.6, 0.8, 1.0];
}

function barRange(s: Section): string {
  return s.startBar === s.endBar ? `bar ${s.startBar + 1}` : `bars ${s.startBar + 1}–${s.endBar + 1}`;
}

function notesIn(notes: Note[], hand: Hand, s: Section, beatsPerBar: number): Note[] {
  const a = s.startBar * beatsPerBar, b = (s.endBar + 1) * beatsPerBar;
  return notes.filter((n) => n.hand === hand && n.startBeat >= a && n.startBeat < b);
}

function letterSequence(notes: Note[], max = 24): string {
  const seq: string[] = [];
  let lastStart = -1;
  for (const n of notes) {
    if (Math.abs(n.startBeat - lastStart) < 0.01) { seq[seq.length - 1] += `+${n.letter}`; continue; }
    seq.push(n.letter);
    lastStart = n.startBeat;
  }
  return seq.length > max ? seq.slice(0, max).join(' ') + ' …' : seq.join(' ');
}

/** The adaptive drill that replaces the tempo ramp once a stage has been attempted. */
export interface NextStep { title: string; reason: string; action: StepAction }

export function generateSteps(arr: Arrangement, levelId: LevelId, next?: NextStep): Step[] {
  const level = arr.levels[levelId];
  const notes = level.notes;
  const rh = notes.filter((n) => n.hand === 'rh');
  const lh = notes.filter((n) => n.hand === 'lh');
  const steps: Step[] = [];
  const sections = arr.sections;

  // 1. Orientation
  const rhLow = rh.length ? Math.min(...rh.map((n) => n.midi)) : 60;
  const rhHigh = rh.length ? Math.max(...rh.map((n) => n.midi)) : 72;
  steps.push({
    title: 'Find your starting position',
    body: `This piece is in ${level.key.name}${level.transpose ? ` (moved from ${arr.key.name} to stay on white keys)` : ''} at about ${arr.bpm} beats per minute, ${arr.timeSig.num}/${arr.timeSig.den} time (count ${arr.timeSig.num} per bar). ` +
      `Middle C is the C nearest the centre of the keyboard, lit on the 3D piano. ` +
      `Your right hand will use the keys from ${midiToName(rhLow, level.key.useFlats)} up to ${midiToName(rhHigh, level.key.useFlats)}.` +
      (rh[0] ? ` The first right-hand note is ${rh[0].letter}${rh[0].octave}${rh[0].finger ? `, played with finger ${rh[0].finger} (1 = thumb, 5 = little finger)` : ''}.` : '') +
      (level.eased?.length ? ` ${level.eased.map((e) => barRange(sections[e.section])).join(' and ')} ${level.eased.length === 1 ? 'is' : 'are'} shown as stage ${level.eased[0].fromLevel} because ${level.eased.length === 1 ? 'it is' : 'they are'} much harder than the rest.` : ''),
  });

  // 2. Listen
  steps.push({
    title: 'Listen to the whole piece once',
    body: 'Watch the falling notes and the highlighted keys. Notice which hand plays what: blue is the right hand, orange is the left hand.',
    action: { startBar: 0, endBar: arr.totalBars - 1, hands: 'both', tempoScale: 1, level: levelId, mode: 'listen' },
  });

  // 2b. Building blocks: the melody's main motif and the left hand's few shapes, when they cover enough.
  const blocks = buildingBlocks(arr, levelId);
  if (blocks) steps.push(blocks);

  // 3. Right hand by section
  for (const s of sections) {
    const sn = notesIn(rh, 'rh', s, arr.beatsPerBar);
    if (sn.length === 0) continue;
    if (s.repeatOf !== undefined) {
      const orig = sections[s.repeatOf];
      steps.push({ title: `Right hand, ${barRange(s)}`, body: `Good news: these bars are the same as ${barRange(orig)}. Play them again from memory.`,
        action: { startBar: s.startBar, endBar: s.endBar, hands: 'rh', tempoScale: 0.6, level: levelId, mode: 'learn' } });
      continue;
    }
    steps.push({
      title: `Right hand, ${barRange(s)} (section ${s.label})`,
      body: `Notes in order: ${letterSequence(sn)}. Play slowly at half speed. The app waits for each correct key before moving on.`,
      action: { startBar: s.startBar, endBar: s.endBar, hands: 'rh', tempoScale: 0.5, level: levelId, mode: 'learn' },
    });
  }

  // 4. Left hand chords
  if (lh.length) {
    const chordList = uniqueChords(level, lh);
    steps.push({
      title: 'Learn the left-hand chords',
      body: `This piece uses ${chordList.length} chord${chordList.length === 1 ? '' : 's'}: ` +
        chordList.map((c) => `${c.name} (${c.keys})`).join(', ') + '. Practise moving between them before adding rhythm.',
    });
    for (const s of sections) {
      const sn = notesIn(lh, 'lh', s, arr.beatsPerBar);
      if (sn.length === 0) continue;
      if (s.repeatOf !== undefined) continue;
      steps.push({
        title: `Left hand, ${barRange(s)} (section ${s.label})`,
        body: `Left-hand notes: ${letterSequence(sn, 16)}.`,
        action: { startBar: s.startBar, endBar: s.endBar, hands: 'lh', tempoScale: 0.5, level: levelId, mode: 'learn' },
      });
    }
  }

  // 5. Hands together, ramping tempo
  if (lh.length) {
    for (const s of sections) {
      if (s.repeatOf !== undefined) continue;
      steps.push({
        title: `Hands together, ${barRange(s)}`,
        body: 'Start very slowly. Left hand lands on the beat, right hand fits on top.',
        action: { startBar: s.startBar, endBar: s.endBar, hands: 'both', tempoScale: 0.5, level: levelId, mode: 'learn' },
      });
    }
  }
  if (next) {
    steps.push({ title: `Next: ${next.title.replace(/, stage \d$/, '')}`, body: `${cap(next.reason)}. The app picks this from your last attempts; play it and the suggestion updates.`, action: next.action });
    return steps;
  }
  for (const t of tempoRamp()) {
    steps.push({
      title: `Whole piece at ${Math.round(t * 100)}% speed`,
      body: t >= 1 ? 'Full speed. Once this is comfortable, try the next stage.' : 'Play it through. Mistakes are fine; keep going and loop tricky bars.',
      action: { startBar: 0, endBar: arr.totalBars - 1, hands: lh.length ? 'both' : 'rh', tempoScale: t, level: levelId, mode: 'learn' },
    });
  }
  return steps;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — when is a pattern worth teaching before the sections?
 *
 *  The motif step appears when the melody's most repeated motif covers at least
 *  `minMotifCoverage` of its onsets, or when the left hand is at most `maxShapes`
 *  shapes covering `minShapeShare` of its onsets. Below that, section-by-section
 *  practice is the better path and the step stays out.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const BLOCKS = { minMotifCoverage: 0.3, maxShapes: 3, minShapeShare: 0.8 };

function buildingBlocks(arr: Arrangement, levelId: LevelId): Step | undefined {
  const level = arr.levels[levelId];
  const motif = findMotif(level.notes, arr.beatsPerBar);
  const shapes = findShapes(level.notes, arr.beatsPerBar, 'lh', BLOCKS.maxShapes);
  const shapeShare = shapes.reduce((s, x) => s + x.share, 0);
  const useMotif = !!motif && motif.coverage >= BLOCKS.minMotifCoverage;
  const useShapes = shapes.length > 0 && shapeShare >= BLOCKS.minShapeShare;
  if (!useMotif && !useShapes) return undefined;
  const parts: string[] = [];
  if (useMotif && motif) {
    const bars = motif.occurrences.map((o) => o.bar + 1);
    const moved = motif.occurrences.filter((o) => o.transposed).length;
    parts.push(`The melody's main motif is ${motif.letters} (${motif.length} notes). It appears ${motif.occurrences.length} times, in bar${bars.length === 1 ? '' : 's'} ${listBars(bars)}${moved ? `, ${moved} of them starting on a different note` : ''}, and covers ${Math.round(motif.coverage * 100)}% of the right hand.`);
  }
  if (useShapes) {
    const desc = shapes.map((s) => `${s.name} (${Math.round(s.share * 100)}%)`);
    parts.push(`The left hand is ${shapes.length === 1 ? 'one shape' : `${shapes.length} shapes`}: ${desc.join(', ')}. Learn ${shapes.length === 1 ? 'it' : 'them'} as hand positions and most bars are already known.`);
  }
  const action: StepAction | undefined = useMotif && motif
    ? { startBar: motif.occurrences[0].bar, endBar: Math.floor((motif.occurrences[0].endBeat - 1e-6) / arr.beatsPerBar), hands: 'rh', tempoScale: 0.5, level: levelId, mode: 'learn' }
    : undefined;
  return { title: 'Learn the building blocks first', body: parts.join(' ') + (action ? ' Practise the motif once, slowly.' : ''), action };
}

function listBars(bars: number[]): string {
  const shown = bars.slice(0, 6).join(', ');
  return bars.length > 6 ? `${shown} and ${bars.length - 6} more` : shown.replace(/, (\d+)$/, ' and $1');
}

function uniqueChords(level: Level, lh: Note[]): { name: string; keys: string }[] {
  const seen = new Map<string, string>();
  for (const c of level.chords) {
    if (seen.has(c.name)) continue;
    const pitches = lh.filter((n) => Math.abs(n.startBeat - c.startBeat) < 0.01).map((n) => n.midi);
    // Moving patterns put one note on the chord's first beat; show the whole voicing for those.
    // Held textures (one bass note, root and fifth, block) show exactly what sounds.
    const moving = level.lhPattern === 'broken' || level.lhPattern === 'alberti' || level.lhPattern === 'waltz' || (level.id === 5 && !level.lhPattern);
    const keys = (pitches.length && !moving ? pitches : c.pitches).sort((a, b) => a - b).map((m) => midiToName(m, level.key.useFlats)).join(' ');
    seen.set(c.name, keys);
  }
  return [...seen].map(([name, keys]) => ({ name, keys }));
}

function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
