import type { Arrangement, Chord, Hand, Level, Note } from '../types';

/** Generate ABC notation (grand staff, two voices) for a level. Rhythm is quantized to 16ths. */
export function toAbc(arr: Arrangement, level: Level): string {
  const bpb16 = Math.round(arr.beatsPerBar * 4);
  const keyName = keyToAbc(arr);
  const header = [
    'X:1',
    `T:${escapeAbc(arr.title)}`,
    `C:Level ${level.id} · ${level.name}`,
    `M:${arr.timeSig.num}/${arr.timeSig.den}`,
    'L:1/16',
    `Q:1/4=${arr.bpm}`,
    '%%score {RH LH}',
    'V:RH clef=treble name="R.H."',
    'V:LH clef=bass name="L.H."',
    `K:${keyName}`,
  ];
  const keySig = keySignatureMap(arr.key.sharps);
  const rhBars = voiceBars(level.notes.filter((n) => n.hand === 'rh'), arr, bpb16, keySig, arr.chords);
  const lhBars = voiceBars(level.notes.filter((n) => n.hand === 'lh'), arr, bpb16, keySig, null);
  const lines: string[] = [];
  for (let b = 0; b < arr.totalBars; b += 4) {
    const end = Math.min(arr.totalBars, b + 4);
    lines.push(`[V:RH] ${rhBars.slice(b, end).join(' | ')} |${end === arr.totalBars ? ']' : ''}`);
    lines.push(`[V:LH] ${lhBars.slice(b, end).join(' | ')} |${end === arr.totalBars ? ']' : ''}`);
  }
  return [...header, ...lines].join('\n');
}

function escapeAbc(s: string): string {
  return s.replace(/[\r\n]/g, ' ');
}

function keyToAbc(arr: Arrangement): string {
  const tonic = arr.key.name.split(' ')[0].replace('#', '#').replace('b', 'b');
  return arr.key.mode === 'minor' ? `${tonic}m` : tonic;
}

/** letter -> accidental (-1 flat, 0, +1 sharp) implied by the key signature. */
function keySignatureMap(sharps: number): Record<string, number> {
  const order = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const m: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (sharps > 0) for (let i = 0; i < sharps; i++) m[order[i]] = 1;
  if (sharps < 0) for (let i = 0; i < -sharps; i++) m[order[6 - i]] = -1;
  return m;
}

interface Ev { start16: number; len16: number; notes: Note[]; tie: boolean }

function voiceBars(notes: Note[], arr: Arrangement, bpb16: number, keySig: Record<string, number>, chords: Chord[] | null): string[] {
  // Split notes at bar lines, marking ties.
  const pieces: { start16: number; end16: number; note: Note; tie: boolean }[] = [];
  for (const n of notes) {
    let s = Math.round(n.startBeat * 4);
    const e = Math.max(s + 1, Math.round((n.startBeat + n.durationBeats) * 4));
    while (s < e) {
      const barEnd = (Math.floor(s / bpb16) + 1) * bpb16;
      const pieceEnd = Math.min(e, barEnd);
      pieces.push({ start16: s, end16: pieceEnd, note: n, tie: pieceEnd < e });
      s = pieceEnd;
    }
  }
  const bars: string[] = [];
  for (let b = 0; b < arr.totalBars; b++) {
    const bs = b * bpb16, be = bs + bpb16;
    const inBar = pieces.filter((p) => p.start16 >= bs && p.start16 < be).sort((x, y) => x.start16 - y.start16 || x.note.midi - y.note.midi);
    const events: Ev[] = [];
    for (const p of inBar) {
      const last = events[events.length - 1];
      if (last && last.start16 === p.start16) {
        if (!last.notes.some((x) => x.midi === p.note.midi)) last.notes.push(p.note);
        last.len16 = Math.min(last.len16, p.end16 - p.start16);
        last.tie = last.tie || p.tie;
      } else {
        events.push({ start16: p.start16, len16: p.end16 - p.start16, notes: [p.note], tie: p.tie });
      }
    }
    for (let i = 0; i < events.length - 1; i++) events[i].len16 = Math.min(events[i].len16, events[i + 1].start16 - events[i].start16);

    const barChords = chords ? chords.filter((c) => { const cs = Math.round(c.startBeat * 4); return cs >= bs && cs < be; }) : [];
    let chordIdx = 0;
    const state: Record<string, number> = { ...keySig };
    const tokens: string[] = [];
    let pos = bs;
    const chordPrefix = (at: number): string => {
      let prefix = '';
      while (chordIdx < barChords.length && Math.round(barChords[chordIdx].startBeat * 4) <= at) {
        prefix = `"${barChords[chordIdx].name}"`;
        chordIdx++;
      }
      return prefix;
    };
    // Chords that start in this bar before any note also need to be shown at the bar start.
    for (const ev of events) {
      if (ev.start16 > pos) { tokens.push(chordPrefix(pos) + restTokens(ev.start16 - pos)); pos = ev.start16; }
      const body = ev.notes.map((n) => noteToken(n, state)).join('');
      const tok = (ev.notes.length > 1 ? `[${body}]` : body) + lenStr(ev.len16) + (ev.tie ? '-' : '');
      tokens.push(chordPrefix(ev.start16) + tok);
      pos = ev.start16 + ev.len16;
    }
    if (pos < be) tokens.push(chordPrefix(pos) + restTokens(be - pos));
    bars.push(tokens.join(' '));
  }
  return bars;
}

function lenStr(len16: number): string {
  return len16 === 1 ? '' : String(len16);
}

/** Split long rests into readable chunks (max a whole note per token). */
function restTokens(len16: number): string {
  const parts: string[] = [];
  let rem = len16;
  while (rem > 0) { const chunk = Math.min(rem, 16); parts.push(`z${lenStr(chunk)}`); rem -= chunk; }
  return parts.join(' ');
}

function noteToken(n: Note, state: Record<string, number>): string {
  const letter = n.letter[0];
  const acc = n.letter[1] === '#' ? 1 : n.letter[1] === 'b' ? -1 : 0;
  let accStr = '';
  if (state[letter] !== acc) {
    accStr = acc === 1 ? '^' : acc === -1 ? '_' : '=';
    state[letter] = acc;
  }
  let pitch: string;
  if (n.octave >= 5) pitch = letter.toLowerCase() + "'".repeat(n.octave - 5);
  else pitch = letter.toUpperCase() + ','.repeat(Math.max(0, 4 - n.octave));
  return accStr + pitch;
}

export function handLabel(h: Hand): string {
  return h === 'rh' ? 'Right hand' : 'Left hand';
}
