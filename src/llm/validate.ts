import type { Song } from '../types';
import { parseDsl } from '../catalog/dsl';
import { songFromNotes } from '../midi/parse';

/**
 * Code-side checks for the three Phase F model outputs. The model proposes; these decide.
 * Pure so they can be tested with hand-written answers.
 */

// ───────────────────────── recommendations ─────────────────────────

export interface Pick { id: string; reason: string }

/** Keep only picks whose id is in the catalog, in order, without repeats, at most `max`. */
export function validPicks(raw: unknown, ids: Set<string>, max = 3): Pick[] {
  const list = Array.isArray((raw as { picks?: unknown })?.picks) ? ((raw as { picks: unknown[] }).picks) : [];
  const out: Pick[] = [];
  for (const p of list as { id?: unknown; reason?: unknown }[]) {
    if (typeof p.id !== 'string' || !ids.has(p.id) || out.some((o) => o.id === p.id)) continue;
    out.push({ id: p.id, reason: typeof p.reason === 'string' ? p.reason.trim() : '' });
    if (out.length >= max) break;
  }
  return out;
}

// ───────────────────────── mnemonics ─────────────────────────

export interface MnemonicRequest { section: number; noteCount: number }
export interface Mnemonic { section: number; words: string }

/** "Twin-kle twin-kle lit-tle star" → 7 syllables. Hyphens and spaces both split; punctuation does not count. */
export function syllableCount(words: string): number {
  return words.split(/[\s-]+/).map((w) => w.replace(/[^\p{L}\p{N}']/gu, '')).filter(Boolean).length;
}

/** Keep the sections whose syllable count equals the note count; everything else is dropped. */
export function validMnemonics(raw: unknown, requests: MnemonicRequest[]): Mnemonic[] {
  const list = Array.isArray((raw as { sections?: unknown })?.sections) ? ((raw as { sections: unknown[] }).sections) : [];
  const out: Mnemonic[] = [];
  for (const m of list as { section?: unknown; words?: unknown }[]) {
    if (typeof m.section !== 'number' || typeof m.words !== 'string') continue;
    const req = requests.find((r) => r.section === m.section);
    if (!req || out.some((o) => o.section === m.section)) continue;
    const words = m.words.trim();
    if (syllableCount(words) !== req.noteCount) continue;
    out.push({ section: m.section, words });
  }
  return out;
}

// ───────────────────────── sheet photo ─────────────────────────

export interface SheetTranscription { title: string; bpm: number; timeSig: { num: number; den: number }; rh: string; lh?: string; notes?: string }

/** Several photographed pages become one song: each page's DSL starts where the longer hand of the previous page ended. */
export function songFromPages(pages: SheetTranscription[], minNotes = 4): Song {
  if (pages.length === 0) throw new Error('No pages.');
  const first = pages[0];
  let offset = 0;
  let rh = '', lh = '';
  for (const p of pages) {
    const r = parseDsl(p.rh ?? '', 0, 0.85), l = p.lh?.trim() ? parseDsl(p.lh, 1, 0.65) : [];
    const end = Math.max(0, ...r.map((n) => n.startBeat + n.durationBeats), ...l.map((n) => n.startBeat + n.durationBeats));
    rh += ` @${offset} ${p.rh ?? ''}`;
    if (p.lh?.trim()) lh += ` @${offset} ${p.lh}`;
    offset += end;
  }
  return songFromTranscription({ ...first, rh, lh, title: first.title }, minNotes);
}

/**
 * Build a Song from the model's DSL. parseDsl throws on any token it does not understand,
 * which is the validation: a made-up note name or duration never reaches the pipeline.
 */
export function songFromTranscription(t: SheetTranscription, minNotes = 4): Song {
  const bpm = Number.isFinite(t.bpm) && t.bpm >= 30 && t.bpm <= 240 ? Math.round(t.bpm) : 100;
  const num = Number.isInteger(t.timeSig?.num) && t.timeSig.num >= 1 && t.timeSig.num <= 12 ? t.timeSig.num : 4;
  const den = [1, 2, 4, 8, 16].includes(t.timeSig?.den) ? t.timeSig.den : 4;
  const rh = parseDsl(t.rh ?? '', 0, 0.85);
  const lh = t.lh?.trim() ? parseDsl(t.lh, 1, 0.65) : [];
  if (rh.length < minNotes) throw new Error(`Only ${rh.length} melody notes were read; the photo needs to show a clear melody line.`);
  const title = (typeof t.title === 'string' && t.title.trim()) || 'From a photo';
  return songFromNotes(title, [...rh, ...lh], bpm, { num, den }, 'photo');
}
