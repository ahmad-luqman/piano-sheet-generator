import { describe, expect, it } from 'vitest';
import { buildArrangement } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';
import { toAbc } from '../src/sheet/abc';
import { generateSteps } from '../src/sheet/steps';

describe('ABC generation', () => {
  const arr = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'twinkle')!));
  it('writes a grand staff with chord symbols', () => {
    const abc = toAbc(arr, arr.levels[2]);
    expect(abc).toContain('K:C');
    expect(abc).toContain('V:RH clef=treble');
    expect(abc).toContain('[V:LH]');
    expect(abc).toMatch(/"C"C4 C4 G4 G4 \| "F"A4 A4 "C"G8/);
  });
  it('fills every bar to the same length', () => {
    const abc = toAbc(arr, arr.levels[1]);
    const rhLines = abc.split('\n').filter((l) => l.startsWith('[V:RH]'));
    const bars = rhLines.flatMap((l) => l.replace('[V:RH]', '').split('|')).map((b) => b.trim()).filter((b) => b && b !== ']');
    for (const bar of bars) {
      const total = bar.replace(/"[^"]*"/g, '').split(/\s+/).filter(Boolean).reduce((s, tok) => {
        const m = /(\d+)-?$/.exec(tok); return s + (m ? parseInt(m[1], 10) : 1);
      }, 0);
      expect(total).toBe(16);
    }
  });
  it('spells sharps once per bar in a sharp key', () => {
    const canon = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'canon-in-d')!));
    const abc = toAbc(canon, canon.levels[1]);
    expect(abc).toContain('K:D');
    expect(abc).not.toContain('^f');   // F# is in the key signature, so no explicit accidental
  });
});

describe('steps', () => {
  it('produces an orientation, a listen step, per-hand practice, and a tempo ramp', () => {
    const arr = buildArrangement(loadCatalogSong(CATALOG.find((c) => c.id === 'ode-to-joy')!));
    const steps = generateSteps(arr, 2);
    expect(steps[0].title).toMatch(/starting position/);
    expect(steps[1].action?.mode).toBe('listen');
    expect(steps.some((s) => s.action?.hands === 'rh')).toBe(true);
    expect(steps.some((s) => s.action?.hands === 'lh')).toBe(true);
    expect(steps[steps.length - 1].action?.tempoScale).toBe(1);
  });
});
