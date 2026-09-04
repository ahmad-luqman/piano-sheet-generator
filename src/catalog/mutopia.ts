import type { LevelId } from '../types';
import { isMidiEntry, type MidiEntry } from './songs';

/**
 * The Mutopia Project slice of the catalog: public-domain solo-piano MIDI files pulled at
 * build time by scripts/ingest-mutopia.mjs into public/catalog/mutopia/, described by
 * public/catalog/mutopia.json. Mutopia itself has no CORS headers, so the files must be
 * served from this site; that also makes them work offline.
 */

export interface MutopiaPiece {
  id: string;
  title: string;
  composer: string;
  dates?: string;
  opus?: string;
  date?: string;
  style?: string;
  arranger?: string;
  licence: string;
  mutopiaId?: number;
  file: string;
  bpm: number;
  timeSig: { num: number; den: number };
  notes: number;
  bars: number;
  seconds: number;
  /** Written by scripts/fingerprint-catalog.ts: key name, suggested stage, and fingerprint values per stage. */
  key?: string;
  suggested?: number;
  fp?: Record<string, number[]>;
}

export interface MutopiaIndex {
  source: string;
  generated: string;
  count: number;
  pieces: MutopiaPiece[];
}

export const MUTOPIA_ORIGIN = 'Mutopia';

function baseUrl(): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function mutopiaIndexUrl(): string {
  return `${baseUrl()}catalog/mutopia.json`;
}

/** Turn the index into catalog entries. The opus doubles as an alias so "op 27" finds the piece. */
export function mutopiaEntries(index: MutopiaIndex, base = baseUrl()): MidiEntry[] {
  return index.pieces.map((p) => ({
    id: p.id, title: p.title, composer: p.composer, aliases: p.opus ? [p.opus] : undefined,
    bpm: p.bpm, timeSig: p.timeSig,
    url: `${base}catalog/mutopia/${p.file}`, origin: MUTOPIA_ORIGIN, licence: p.licence,
    opus: p.opus, date: p.date, style: p.style, arranger: p.arranger,
    notes: p.notes, bars: p.bars, seconds: p.seconds,
    key: p.key, suggested: p.suggested as LevelId | undefined, fp: p.fp,
  }));
}

/**
 * Fetch the index. A missing file (the ingest script has not been run) is not an error for
 * the app, only a smaller catalog, so it resolves to an empty list after a console warning.
 */
export async function loadMutopiaIndex(signal?: AbortSignal): Promise<MidiEntry[]> {
  const url = mutopiaIndexUrl();
  let res: Response;
  try { res = await fetch(url, { signal }); }
  catch (err) { console.warn(`Mutopia catalog not loaded (${url}): ${err instanceof Error ? err.message : String(err)}`); return []; }
  if (!res.ok) { console.warn(`Mutopia catalog not loaded: HTTP ${res.status} for ${url}. Run \`npm run ingest:mutopia\` to build it.`); return []; }
  const index = (await res.json()) as MutopiaIndex;
  if (!Array.isArray(index.pieces)) throw new Error('Mutopia index has no pieces array');
  return mutopiaEntries(index);
}

/** "48 bars · 1:12" for a result card. */
export function describeLength(e: MidiEntry): string {
  const m = Math.floor(e.seconds / 60), s = e.seconds % 60;
  return `${e.bars} bars · ${m}:${String(s).padStart(2, '0')}`;
}

export { isMidiEntry };
