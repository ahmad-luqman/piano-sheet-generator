import { describe, expect, it } from 'vitest';
import { describeFingerprint, fingerprint } from '../src/arrange/difficulty';
import { buildArrangement } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';

const song = (id: string) => loadCatalogSong(CATALOG.find((c) => c.id === id)!);
const fpOf = (id: string) => {
  const s = song(id);
  return fingerprint(s.notes.map((n) => ({ ...n, hand: n.track === 0 ? 'rh' as const : 'lh' as const })), s.bpm);
};

describe('difficulty fingerprint', () => {
  it('returns zeros for an empty list', () => {
    const fp = fingerprint([], 120);
    expect(fp.noteCount).toBe(0);
    expect(fp.overall).toBe(0);
  });
  it('rates Twinkle easier than Für Elise on density, note speed and overall', () => {
    const twinkle = fpOf('twinkle');
    const elise = fpOf('fur-elise');
    expect(twinkle.density.score).toBeLessThan(elise.density.score);
    expect(twinkle.ioi.score).toBeLessThan(elise.ioi.score);
    expect(twinkle.overall).toBeLessThan(elise.overall);
    expect(twinkle.overall).toBeLessThan(0.3);
  });
  it('keeps every score inside 0..1 and reports raw units', () => {
    for (const c of CATALOG) {
      const fp = fpOf(c.id);
      for (const m of [fp.density, fp.ioi, fp.range, fp.stretch, fp.displacement, fp.tempo]) {
        expect(m.score).toBeGreaterThanOrEqual(0);
        expect(m.score).toBeLessThanOrEqual(1);
      }
      expect(fp.tempo.value).toBe(c.bpm);
    }
  });
  it('measures stretch within one hand only', () => {
    // C3 in the left hand and C6 in the right at the same time is a range of 36 but no stretch.
    const fp = fingerprint([
      { midi: 48, startBeat: 0, durationBeats: 1, hand: 'lh' }, { midi: 84, startBeat: 0, durationBeats: 1, hand: 'rh' },
      { midi: 48, startBeat: 1, durationBeats: 1, hand: 'lh' }, { midi: 84, startBeat: 1, durationBeats: 1, hand: 'rh' },
    ], 100);
    expect(fp.range.value).toBe(36);
    expect(fp.stretch.value).toBe(0);
    expect(fp.displacement.value).toBe(0);
  });
  it('falls back to a middle-C split when hands are not given', () => {
    const fp = fingerprint([
      { midi: 48, startBeat: 0, durationBeats: 1 }, { midi: 55, startBeat: 0, durationBeats: 1 },
      { midi: 72, startBeat: 0, durationBeats: 1 },
    ], 100);
    expect(fp.stretch.value).toBe(7);
  });
  it('rates a Level 1 melody easier than the original', () => {
    const arr = buildArrangement(song('fur-elise'));
    const l1 = fingerprint(arr.levels[1].notes, arr.bpm);
    const l6 = fingerprint(arr.levels[6].notes, arr.bpm);
    expect(l1.density.score).toBeLessThanOrEqual(l6.density.score);
    expect(l1.overall).toBeLessThanOrEqual(l6.overall);
  });
  it('describes with a level word first', () => {
    expect(describeFingerprint(fpOf('twinkle'))[0]).toBe('beginner');
  });
});
