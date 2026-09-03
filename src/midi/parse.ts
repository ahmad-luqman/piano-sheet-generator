import { Midi } from '@tonejs/midi';
import type { RawNote, Song, TrackInfo } from '../types';

/**
 * Parse MIDI bytes into a Song with beat-based timing.
 * Tempo changes are flattened to the first tempo; the arrangement is played at a constant bpm.
 */
export function parseMidi(data: ArrayBuffer | Uint8Array, title: string, source: string): Song {
  const midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data));
  const ppq = midi.header.ppq || 480;
  const bpm = Math.round(midi.header.tempos[0]?.bpm ?? 120);
  const ts = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  let timeSig = { num: ts[0] || 4, den: ts[1] || 4 };
  let beatsPerBar = timeSig.num * (4 / timeSig.den);

  const notes: RawNote[] = [];
  let hasDrums = false;
  const families: string[] = [];
  midi.tracks.forEach((track, index) => {
    if (track.notes.length === 0) return;
    if (track.channel === 9 || track.instrument.percussion) { hasDrums = true; return; } // percussion
    families[index] = track.instrument.family;
    for (const n of track.notes) {
      notes.push({
        midi: n.midi,
        startBeat: n.ticks / ppq,
        durationBeats: Math.max(n.durationTicks / ppq, 1 / 32),
        velocity: n.velocity,
        track: index,
      });
    }
  });
  notes.sort((a, b) => a.startBeat - b.startBeat || b.midi - a.midi);
  dedupe(notes);

  // Some files carry a meaningless meter (1/8, 1/4). Infer one from where the strong notes land.
  if (beatsPerBar < 1.5 || beatsPerBar > 12) {
    beatsPerBar = inferBeatsPerBar(notes);
    timeSig = beatsPerBar === 1.5 ? { num: 3, den: 8 } : { num: beatsPerBar, den: 4 };
  }

  const totalBeats = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0);
  const tracks = describeTracks(notes, midi.tracks.map((t) => t.name), totalBeats, families);
  const name = title || midi.name || 'Untitled';
  return { title: name, source, ppq, bpm, timeSig, beatsPerBar, tracks, notes, totalBeats, hasDrums };
}

/**
 * Guess the bar length from accent structure: the period whose downbeat slots carry the
 * most note weight wins; ties go to the shorter period.
 */
export function inferBeatsPerBar(notes: RawNote[], candidates = [1.5, 2, 3, 4]): number {
  if (notes.length === 0) return 4;
  const total = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0);
  let best = 4, bestScore = -1;
  for (const p of candidates) {
    const slots = Math.max(1, Math.floor(total / p));
    let weight = 0;
    for (const n of notes) {
      const phase = n.startBeat % p;
      if (phase < 0.03 || p - phase < 0.03) weight += n.durationBeats * (0.5 + n.velocity) * (n.midi < 60 ? 1.5 : 1);
    }
    const score = weight / slots;
    if (score > bestScore * 1.03) { best = p; bestScore = score; }
  }
  return best;
}

/** Remove notes doubled across tracks (same pitch, same onset), a common MIDI artifact. Keeps the longer one. */
function dedupe(notes: RawNote[]): void {
  for (let i = notes.length - 1; i > 0; i--) {
    for (let j = i - 1; j >= 0 && notes[i].startBeat - notes[j].startBeat < 0.03; j--) {
      if (notes[j].midi === notes[i].midi) {
        if (notes[i].durationBeats > notes[j].durationBeats) notes[j] = { ...notes[j], durationBeats: notes[i].durationBeats };
        notes.splice(i, 1);
        break;
      }
    }
  }
}

/** Build a Song directly from notes (used by the bundled catalog). */
export function songFromNotes(
  title: string,
  notes: RawNote[],
  bpm: number,
  timeSig: { num: number; den: number },
  source = 'catalog',
): Song {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || b.midi - a.midi);
  const totalBeats = sorted.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0);
  const beatsPerBar = timeSig.num * (4 / timeSig.den);
  const trackNames: string[] = [];
  for (const n of sorted) trackNames[n.track] = trackNames[n.track] ?? (n.track === 0 ? 'Right hand' : 'Left hand');
  return {
    title, source, ppq: 480, bpm, timeSig, beatsPerBar, notes: sorted, totalBeats,
    tracks: describeTracks(sorted, trackNames, totalBeats, trackNames.map(() => 'piano')),
  };
}

export function describeTracks(notes: RawNote[], names: string[], totalBeats: number, families: string[] = []): TrackInfo[] {
  const byTrack = new Map<number, RawNote[]>();
  for (const n of notes) {
    if (!byTrack.has(n.track)) byTrack.set(n.track, []);
    byTrack.get(n.track)!.push(n);
  }
  const infos: TrackInfo[] = [];
  for (const [index, tn] of byTrack) {
    const meanPitch = tn.reduce((s, n) => s + n.midi, 0) / tn.length;
    // Polyphony: fraction of onsets that share their start with another note.
    let shared = 0;
    for (let i = 0; i < tn.length; i++) {
      const j = i + 1;
      if (j < tn.length && Math.abs(tn[j].startBeat - tn[i].startBeat) < 0.05) shared++;
    }
    const polyphony = tn.length ? shared / tn.length : 0;
    const sounding = tn.reduce((s, n) => s + n.durationBeats, 0);
    const coverage = totalBeats ? Math.min(1, sounding / totalBeats) : 0;
    infos.push({
      index, name: names[index] || `Track ${index + 1}`, noteCount: tn.length,
      meanPitch, polyphony, coverage, isMelodyCandidate: tn.length >= 8, family: families[index],
    });
  }
  return infos.sort((a, b) => a.index - b.index);
}
