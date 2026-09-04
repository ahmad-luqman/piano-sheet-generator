import { describe, expect, it } from 'vitest';
import { bridgeCandidates, catalogFingerprint, sortForLearner } from '../src/catalog/readiness';
import { CATALOG, type MidiEntry } from '../src/catalog/songs';
import type { SkillProfile } from '../src/practice/skills';

const midi = (id: string, bars: number, values: number[]): MidiEntry => ({
  id, title: id, composer: 'X', bpm: 100, timeSig: { num: 4, den: 4 }, url: `/${id}.mid`, origin: 'Mutopia', licence: 'Public Domain',
  notes: 100, bars, seconds: 60, suggested: 3, fp: { '3': values },
});

describe('catalog readiness', () => {
  it('fingerprints hand-entered pieces once through the pipeline', () => {
    const fp = catalogFingerprint(CATALOG.find((c) => c.id === 'twinkle')!)!;
    expect(fp.values).toHaveLength(6);
    expect(catalogFingerprint(CATALOG[0])).toBe(catalogFingerprint(CATALOG[0]));
  });
  it('orders the library ready → stretch → needs, easiest first inside each group', () => {
    const profile: SkillProfile = { values: [2, 0.4, 20, 6, 3, 90], credited: 1 };
    const entries = [
      midi('needs', 8, [6, 0.4, 20, 6, 9, 90]),
      midi('stretch', 8, [2, 0.4, 20, 6, 4.5, 90]),
      midi('ready-harder', 8, [1.9, 0.4, 19, 6, 3, 88]),
      midi('ready-easy', 8, [1, 0.6, 12, 0, 1, 60]),
    ];
    expect(sortForLearner(entries, profile).map((f) => f.entry.id)).toEqual(['ready-easy', 'ready-harder', 'stretch', 'needs']);
  });
  it('falls back to plain difficulty without a profile', () => {
    const entries = [midi('hard', 8, [6, 0.2, 40, 12, 9, 160]), midi('easy', 8, [1, 0.6, 12, 0, 1, 60])];
    const sorted = sortForLearner(entries, { credited: 0 });
    expect(sorted.map((f) => f.entry.id)).toEqual(['easy', 'hard']);
    expect(sorted[0].fit.kind).toBe('unknown');
  });
  it('keeps an entry without a fingerprint, last and unrated', () => {
    const bare = { ...midi('bare', 8, []), fp: undefined, suggested: undefined };
    const sorted = sortForLearner([bare, midi('easy', 8, [1, 0.6, 12, 0, 1, 60])], { credited: 0 });
    expect(sorted.map((f) => f.entry.id)).toEqual(['easy', 'bare']);
    expect(sorted[1].fit.label).toBe('Not rated');
  });
  it('lists bridge candidates with bar counts', () => {
    const c = bridgeCandidates([midi('a', 24, [1, 0.6, 12, 0, 1, 60])]);
    expect(c).toEqual([{ id: 'a', title: 'a — X', values: [1, 0.6, 12, 0, 1, 60], bars: 24 }]);
  });
});
