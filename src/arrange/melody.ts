import type { RawNote, Song, TrackInfo } from '../types';

/**
 * Score each track for "melody-ness". Higher pitch, more monophonic, and good
 * coverage all help. Tracks with very few notes are excluded.
 */
export function scoreMelodyTracks(song: Song): { track: TrackInfo; score: number }[] {
  const candidates = song.tracks.filter((t) => t.isMelodyCandidate);
  if (candidates.length === 0) return song.tracks.map((track) => ({ track, score: 0 }));
  const maxPitch = Math.max(...candidates.map((t) => t.meanPitch));
  const minPitch = Math.min(...candidates.map((t) => t.meanPitch));
  const range = Math.max(1, maxPitch - minPitch);
  const maxNotes = Math.max(...candidates.map((t) => t.noteCount));
  return candidates
    .map((track) => {
      const pitchScore = (track.meanPitch - minPitch) / range;         // 0..1
      const monoScore = 1 - track.polyphony;                          // 0..1
      const densityScore = Math.min(1, track.noteCount / maxNotes);   // 0..1
      const nameBonus = /melod|lead|vocal|voice|right|rh|solo/i.test(track.name) ? 0.3 : 0;
      const namePenalty = /bass|drum|perc|left|lh|chord|pad|string/i.test(track.name) ? -0.3 : 0;
      const score = 0.45 * pitchScore + 0.3 * monoScore + 0.25 * densityScore * track.coverage + nameBonus + namePenalty;
      return { track, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function pickMelodyTrack(song: Song): number {
  const scored = scoreMelodyTracks(song);
  return scored[0]?.track.index ?? song.tracks[0]?.index ?? 0;
}

/**
 * Skyline: reduce a possibly polyphonic note list to a single top voice.
 * Notes starting within `tolerance` beats of each other are one onset; keep the highest.
 * Durations are trimmed so consecutive melody notes never overlap.
 */
export function skyline(notes: RawNote[], tolerance = 0.06): RawNote[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || b.midi - a.midi);
  const out: RawNote[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.startBeat - n.startBeat) < tolerance) {
      if (n.midi > last.midi) out[out.length - 1] = { ...n };
      continue;
    }
    out.push({ ...n });
  }
  for (let i = 0; i < out.length - 1; i++) {
    const gap = out[i + 1].startBeat - out[i].startBeat;
    if (out[i].durationBeats > gap) out[i].durationBeats = gap;
  }
  return out;
}

/** Notes of the melody track, reduced to one voice. */
export function extractMelody(song: Song, trackIndex: number): RawNote[] {
  const trackNotes = song.notes.filter((n) => n.track === trackIndex);
  return skyline(trackNotes);
}
