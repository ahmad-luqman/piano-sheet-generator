import { buildArrangement } from '../arrange';
import { fingerprint, fingerprintFromValues, fingerprintValues } from '../arrange/difficulty';
import type { LevelId } from '../types';
import { readiness, type BridgeCandidate, type Readiness, type SkillProfile } from '../practice/skills';
import { isMidiEntry, loadCatalogSong, type CatalogEntry } from './songs';

/**
 * "Playable for you": every catalog entry with the fingerprint of its suggested stage.
 * Mutopia entries carry theirs from the index (scripts/fingerprint-catalog.ts); the eight
 * hand-entered pieces are arranged once here and cached.
 */

export interface CatalogFit { entry: CatalogEntry; suggested: LevelId; values: number[]; fit: Readiness }

const dslCache = new Map<string, { suggested: LevelId; values: number[] }>();

export function catalogFingerprint(entry: CatalogEntry): { suggested: LevelId; values: number[] } | undefined {
  if (isMidiEntry(entry)) {
    const suggested = entry.suggested ?? 1;
    const values = entry.fp?.[String(suggested)];
    return values ? { suggested, values } : undefined;
  }
  let hit = dslCache.get(entry.id);
  if (!hit) {
    const arr = buildArrangement(loadCatalogSong(entry));
    const suggested = arr.suggestedLevel?.level ?? 1;
    hit = { suggested, values: fingerprintValues(fingerprint(arr.levels[suggested].notes, arr.bpm)) };
    dslCache.set(entry.id, hit);
  }
  return hit;
}

export function catalogFit(entry: CatalogEntry, profile: SkillProfile): CatalogFit | undefined {
  const fp = catalogFingerprint(entry);
  return fp ? { entry, ...fp, fit: readiness(fp.values, profile) } : undefined;
}

const KIND_ORDER: Record<Readiness['kind'], number> = { ready: 0, stretch: 1, needs: 2, unknown: 3 };

/**
 * Library order: ready pieces first, then small stretches, then the rest, each group easiest
 * first. Without a profile every piece is "unknown" and the order is plain difficulty.
 */
export function sortForLearner(entries: CatalogEntry[], profile: SkillProfile): CatalogFit[] {
  // An entry without a fingerprint (an index built before the fingerprint pass) stays listed, last, as unknown.
  const unknown: Readiness = { kind: 'unknown', gaps: [], label: 'Not rated', detail: 'run npm run fingerprint:catalog to rate this piece' };
  return entries
    .map((e) => catalogFit(e, profile) ?? { entry: e, suggested: 1 as LevelId, values: [], fit: unknown })
    .sort((a, b) => KIND_ORDER[a.fit.kind] - KIND_ORDER[b.fit.kind]
      || (a.values.length ? overall(a.values) : 9) - (b.values.length ? overall(b.values) : 9)
      || bars(a.entry) - bars(b.entry));
}

export function bridgeCandidates(entries: CatalogEntry[]): BridgeCandidate[] {
  const out: BridgeCandidate[] = [];
  for (const e of entries) {
    const fp = catalogFingerprint(e);
    if (fp) out.push({ id: e.id, title: `${e.title} — ${e.composer}`, values: fp.values, bars: bars(e) });
  }
  return out;
}

export function fitTone(fit: Readiness): 'good' | 'warn' | 'bad' | 'neutral' {
  return fit.kind === 'ready' ? 'good' : fit.kind === 'stretch' ? 'warn' : fit.kind === 'needs' ? 'bad' : 'neutral';
}

function overall(values: number[]): number { return fingerprintFromValues(values).overall; }
function bars(e: CatalogEntry): number { return isMidiEntry(e) ? e.bars : 16; }
