import { isBlackKey } from '../arrange/theory';
import { FIRST_KEY, LAST_KEY } from './types';

export interface KeyGeom { midi: number; black: boolean; x: number; width: number }

export const WHITE_W = 1;
export const WHITE_GAP = 0.06;
export const BLACK_W = 0.58;

/** Horizontal layout of the 88 keys in "white key widths". Black keys are nudged like a real piano. */
export function keyLayout(): KeyGeom[] {
  const keys: KeyGeom[] = [];
  let whiteIndex = 0;
  for (let m = FIRST_KEY; m <= LAST_KEY; m++) {
    if (!isBlackKey(m)) {
      keys.push({ midi: m, black: false, x: whiteIndex * (WHITE_W + WHITE_GAP), width: WHITE_W });
      whiteIndex++;
    }
  }
  const whiteX = new Map(keys.map((k) => [k.midi, k.x]));
  for (let m = FIRST_KEY; m <= LAST_KEY; m++) {
    if (!isBlackKey(m)) continue;
    const left = whiteX.get(m - 1)!;
    const pc = m % 12;
    // C#/F# lean left, D#/A# lean right, G# centred — matches real key placement.
    const nudge = pc === 1 || pc === 6 ? -0.08 : pc === 3 || pc === 10 ? 0.08 : 0;
    keys.push({ midi: m, black: true, x: left + WHITE_W + WHITE_GAP / 2 + nudge, width: BLACK_W });
  }
  return keys.sort((a, b) => a.midi - b.midi);
}

export function totalWidth(): number {
  return 52 * (WHITE_W + WHITE_GAP) - WHITE_GAP;
}
