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
  const timeSig = { num: ts[0] || 4, den: ts[1] || 4 };
  const beatsPerBar = timeSig.num * (4 / timeSig.den);

  const notes: RawNote[] = [];
  midi.tracks.forEach((track, index) => {
    if (track.channel === 9) return; // percussion
    if (track.notes.length === 0) return;
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

  const totalBeats = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0);
  const tracks = describeTracks(notes, midi.tracks.map((t) => t.name), totalBeats);
  const name = title || midi.name || 'Untitled';
  return { title: name, source, ppq, bpm, timeSig, beatsPerBar, tracks, notes, totalBeats };
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
    tracks: describeTracks(sorted, trackNames, totalBeats),
  };
}

export function describeTracks(notes: RawNote[], names: string[], totalBeats: number): TrackInfo[] {
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
      meanPitch, polyphony, coverage, isMelodyCandidate: tn.length >= 8,
    });
  }
  return infos.sort((a, b) => a.index - b.index);
}
