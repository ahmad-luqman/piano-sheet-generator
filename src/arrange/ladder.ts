import type { Level, LevelId, Note, Section } from '../types';
import { fingerprint } from './difficulty';

const IDS: LevelId[] = [1, 2, 3, 4, 5, 6];

/**
 * Per-section easing: a section that is much harder than the rest of the piece at
 * stage N is shown with stage N−1's notes instead, so the piece is playable end to
 * end sooner. Runs bottom-up so an eased section can cascade. Sections are never
 * eased across a change of key (stage 3 → 4 when transposition is on), because
 * mixing keys inside one piece is worse than a hard passage.
 */
export function easeHardSections(
  levels: Record<LevelId, Level>, sections: Section[], beatsPerBar: number, bpm: number,
  opts: { margin?: number; floor?: number } = {},
): void {
  const margin = opts.margin ?? 0.15, floor = opts.floor ?? 0.45;
  for (const id of IDS) {
    if (id === 1) continue;
    const level = levels[id], lower = levels[(id - 1) as LevelId];
    if (level.transpose !== lower.transpose) continue;
    const eased: Level['eased'] = [];
    let notes = level.notes;
    for (const s of sections) {
      const a = s.startBar * beatsPerBar, b = (s.endBar + 1) * beatsPerBar;
      const inWin = (n: Note) => n.startBeat >= a && n.startBeat < b;
      const here = notes.filter(inWin);
      const rest = level.notes.filter((n) => !inWin(n));
      if (here.length < 4 || rest.length < 4) continue;
      // Compare the section with the rest of the piece, not the whole: a long hard passage
      // would otherwise drag the piece's own score up and hide itself.
      const hard = fingerprint(here, bpm).overall;
      const others = fingerprint(rest, bpm).overall;
      if (hard <= floor || hard <= others + margin) continue;
      const replacement = lower.notes.filter(inWin).map((n) => ({ ...n, isNew: false }));
      notes = [...notes.filter((n) => !inWin(n)), ...replacement].sort((x, y) => x.startBeat - y.startBeat || x.midi - y.midi);
      eased.push({ section: s.index, fromLevel: lower.id });
    }
    if (eased.length) { level.notes = notes; level.eased = eased; }
  }
}

/** Flag notes that are not present one stage lower: the "what changed" view. */
export function markNewNotes(levels: Record<LevelId, Level>): void {
  for (const id of IDS) {
    const level = levels[id];
    if (id === 1) { for (const n of level.notes) n.isNew = false; continue; }
    const lower = levels[(id - 1) as LevelId];
    const seen = new Set(lower.notes.map((n) => noteKey(n, lower.transpose)));
    for (const n of level.notes) n.isNew = !seen.has(noteKey(n, level.transpose));
  }
}

function noteKey(n: Note, transpose: number): string {
  return `${n.hand}|${Math.round(n.startBeat * 8)}|${n.midi - transpose}`;
}

/** Short human summary of what a stage adds over the one below. */
export function describeChanges(level: Level): string {
  if (level.id === 1) return '';
  const rh = level.notes.filter((n) => n.isNew && n.hand === 'rh').length;
  const lh = level.notes.filter((n) => n.isNew && n.hand === 'lh').length;
  const parts: string[] = [];
  if (lh) parts.push(`${lh} left-hand note${lh === 1 ? '' : 's'}`);
  if (rh) parts.push(`${rh} right-hand note${rh === 1 ? '' : 's'}`);
  return parts.length ? `Stage ${level.id} adds ${parts.join(' and ')}.` : `Stage ${level.id} adds nothing new here.`;
}
