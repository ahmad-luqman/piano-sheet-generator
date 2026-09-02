import type { RawNote } from '../types';

const NOTE_RE = /^([A-G])([#b]?)(-?\d)$/;
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function nameToMidi(name: string): number {
  const m = NOTE_RE.exec(name);
  if (!m) throw new Error(`Bad note name: ${name}`);
  const pc = LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

/**
 * Tiny text format for catalog songs. Tokens are separated by whitespace:
 *   C4:1        note C4 lasting 1 beat, cursor advances 1 beat
 *   r:2         rest for 2 beats
 *   [C3 E3 G3]:2  chord, cursor advances 2 beats
 *   @6.5        move the cursor to beat 6.5 (absolute)
 *   |           bar line, ignored (for readability)
 */
export function parseDsl(text: string, track: number, velocity = 0.8): RawNote[] {
  const notes: RawNote[] = [];
  let cursor = 0;
  const tokens = text.replace(/\[([^\]]+)\]/g, (_, inner: string) => `[${inner.trim().replace(/\s+/g, ',')}]`).split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok === '|') continue;
    if (tok.startsWith('@')) { cursor = parseFloat(tok.slice(1)); continue; }
    const [head, durStr] = tok.split(':');
    const dur = parseFloat(durStr ?? '1');
    if (Number.isNaN(dur)) throw new Error(`Bad duration in token: ${tok}`);
    if (head === 'r') { cursor += dur; continue; }
    const names = head.startsWith('[') ? head.slice(1, -1).split(',') : [head];
    for (const n of names) notes.push({ midi: nameToMidi(n), startBeat: cursor, durationBeats: dur, velocity, track });
    cursor += dur;
  }
  return notes;
}
