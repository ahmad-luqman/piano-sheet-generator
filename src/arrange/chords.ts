import type { Chord, ChordQuality, KeyInfo, RawNote } from '../types';
import { PC_NAMES_FLAT, PC_NAMES_SHARP, pitchClass } from './theory';

const TEMPLATES: { quality: ChordQuality; intervals: number[]; suffix: string; weight: number }[] = [
  { quality: 'maj', intervals: [0, 4, 7], suffix: '', weight: 1.0 },
  { quality: 'min', intervals: [0, 3, 7], suffix: 'm', weight: 1.0 },
  { quality: '7', intervals: [0, 4, 7, 10], suffix: '7', weight: 0.9 },
  { quality: 'min7', intervals: [0, 3, 7, 10], suffix: 'm7', weight: 0.85 },
  { quality: 'maj7', intervals: [0, 4, 7, 11], suffix: 'maj7', weight: 0.8 },
  { quality: 'dim', intervals: [0, 3, 6], suffix: 'dim', weight: 0.7 },
  { quality: 'aug', intervals: [0, 4, 8], suffix: 'aug', weight: 0.6 },
];

interface Window { start: number; end: number }

/** Duration-weighted pitch-class histogram of the notes sounding in a window, plus the lowest note. */
function histogram(notes: RawNote[], w: Window): { hist: number[]; bass: number | null; total: number } {
  const hist = new Array(12).fill(0);
  let bass: number | null = null;
  let total = 0;
  for (const n of notes) {
    const s = Math.max(n.startBeat, w.start);
    const e = Math.min(n.startBeat + n.durationBeats, w.end);
    if (e <= s) continue;
    const weight = (e - s) * (0.5 + 0.5 * n.velocity) * (n.startBeat >= w.start ? 1.2 : 1); // onsets count a bit more
    hist[pitchClass(n.midi)] += weight;
    total += weight;
    if (bass === null || n.midi < bass) bass = n.midi;
  }
  return { hist, bass, total };
}

function bestChord(hist: number[], bass: number | null, total: number): { root: number; quality: ChordQuality; suffix: string; score: number } | null {
  if (total <= 0) return null;
  let best: { root: number; quality: ChordQuality; suffix: string; score: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      let inside = 0;
      for (const iv of t.intervals) inside += hist[(root + iv) % 12];
      const outside = total - inside;
      let score = (inside - 0.8 * outside) / total * t.weight;
      if (bass !== null && pitchClass(bass) === root) score += 0.15;
      if (hist[root] === 0) score -= 0.25;                     // a chord without its root is unlikely
      if (t.intervals.length === 4 && hist[(root + t.intervals[3]) % 12] / total < 0.12) score -= 0.3; // 7th must be audible
      if (!best || score > best.score) best = { root, quality: t.quality, suffix: t.suffix, score };
    }
  }
  return best;
}

export function chordName(root: number, quality: ChordQuality, key: KeyInfo): string {
  const names = key.useFlats ? PC_NAMES_FLAT : PC_NAMES_SHARP;
  const suffix = TEMPLATES.find((t) => t.quality === quality)?.suffix ?? '';
  return `${names[root]}${suffix}`;
}

export function chordIntervals(quality: ChordQuality): number[] {
  return TEMPLATES.find((t) => t.quality === quality)?.intervals ?? [0, 4, 7];
}

/** Voice a chord as a root-position block in the left-hand range starting at or above `low`. */
export function voiceChord(root: number, quality: ChordQuality, low = 48, maxNotes = 3): number[] {
  const intervals = chordIntervals(quality).slice(0, maxNotes);
  let rootMidi = low + ((root - pitchClass(low) + 12) % 12);
  return intervals.map((iv) => rootMidi + iv);
}

/**
 * Detect one chord per bar, splitting into half bars when the harmony clearly changes mid-bar.
 * Returns chords covering the whole piece; low-confidence windows inherit the previous chord.
 */
export function detectChords(notes: RawNote[], beatsPerBar: number, totalBeats: number, key: KeyInfo): Chord[] {
  const chords: Chord[] = [];
  const bars = Math.max(1, Math.ceil(totalBeats / beatsPerBar));
  let prev: { root: number; quality: ChordQuality } | null = null;

  for (let b = 0; b < bars; b++) {
    const start = b * beatsPerBar;
    const whole = histogram(notes, { start, end: start + beatsPerBar });
    const wholeBest = bestChord(whole.hist, whole.bass, whole.total);

    const half = beatsPerBar / 2;
    const h1 = histogram(notes, { start, end: start + half });
    const h2 = histogram(notes, { start: start + half, end: start + beatsPerBar });
    const b1 = bestChord(h1.hist, h1.bass, h1.total);
    const b2 = bestChord(h2.hist, h2.bass, h2.total);

    const splits: { start: number; dur: number; best: typeof wholeBest }[] = [];
    const clearlyDifferent = b1 && b2 && b1.root !== b2.root && b1.score > 0.55 && b2.score > 0.55
      && (wholeBest === null || Math.min(b1.score, b2.score) > wholeBest.score - 0.05);
    if (clearlyDifferent && beatsPerBar >= 3) {
      splits.push({ start, dur: half, best: b1 }, { start: start + half, dur: half, best: b2 });
    } else {
      splits.push({ start, dur: beatsPerBar, best: wholeBest });
    }

    for (const s of splits) {
      let root: number, quality: ChordQuality, confidence: number;
      if (s.best && s.best.score > 0.3) {
        root = s.best.root; quality = s.best.quality; confidence = Math.min(1, s.best.score);
      } else if (prev) {
        root = prev.root; quality = prev.quality; confidence = 0.2;
      } else if (s.best) {
        root = s.best.root; quality = s.best.quality; confidence = Math.max(0, s.best.score);
      } else {
        root = key.tonic; quality = key.mode === 'major' ? 'maj' : 'min'; confidence = 0.1;
      }
      const last = chords[chords.length - 1];
      if (last && last.root === root && last.quality === quality) {
        last.durationBeats += s.dur;               // merge repeated chords
        last.confidence = Math.max(last.confidence, confidence);
      } else {
        chords.push({
          startBeat: s.start, durationBeats: s.dur, root, quality,
          name: chordName(root, quality, key), pitches: voiceChord(root, quality), confidence,
        });
      }
      prev = { root, quality };
    }
  }
  return chords;
}

export function chordAt(chords: Chord[], beat: number): Chord | undefined {
  return chords.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats) ?? chords[chords.length - 1];
}
