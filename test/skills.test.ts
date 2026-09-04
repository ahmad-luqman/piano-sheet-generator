import { describe, expect, it } from 'vitest';
import { METRIC_KEYS, fingerprintFromValues, fingerprintValues, fingerprint } from '../src/arrange/difficulty';
import { bridgeSong, creditedValues, readiness, skillProfile, type SkillProfile } from '../src/practice/skills';
import { emptyStage, type SongProgress } from '../src/practice/progress';
import { buildArrangement } from '../src/arrange';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';

// [density, ioi, range, stretch, displacement, tempo]
const EASY = [1.5, 0.5, 14, 4, 2, 80];
const song = (stages: Record<number, { fingerprint?: number[]; bestCleanTempo: number }>): SongProgress => ({
  key: 'k', title: 't', updatedAt: '', journal: [],
  stages: Object.fromEntries(Object.entries(stages).map(([id, s]) => [id, { ...emptyStage(), ...s }])),
});

describe('fingerprint values', () => {
  it('round-trip through the stored list', () => {
    const arr = buildArrangement(loadCatalogSong(CATALOG[0]));
    const fp = fingerprint(arr.levels[4].notes, arr.bpm);
    const back = fingerprintFromValues(fingerprintValues(fp), fp.noteCount);
    for (const k of METRIC_KEYS) expect(back[k].score).toBeCloseTo(fp[k].score, 5);
    expect(back.overall).toBeCloseTo(fp.overall, 5);
  });
});

describe('skill profile', () => {
  it('credits tempo-dependent metrics at the clean tempo, the rest at face value', () => {
    expect(creditedValues([4, 0.2, 24, 9, 6, 120], 0.5)).toEqual([2, 0.4, 24, 9, 6, 60]);
  });
  it('is empty until a stage has a fingerprint and a clean timed run', () => {
    expect(skillProfile([song({ 1: { fingerprint: EASY, bestCleanTempo: 0 } }), song({ 1: { bestCleanTempo: 1 } })])).toEqual({ values: undefined, credited: 0 });
  });
  it('keeps the hardest value per metric across songs', () => {
    const p = skillProfile([
      song({ 1: { fingerprint: [1, 0.6, 12, 0, 2, 80], bestCleanTempo: 1 } }),
      song({ 3: { fingerprint: [3, 0.3, 20, 7, 4, 100], bestCleanTempo: 0.5 } }),
    ]);
    expect(p.credited).toBe(2);
    expect(p.values).toEqual([1.5, 0.6, 20, 7, 4, 80]);
  });
});

describe('readiness', () => {
  const profile: SkillProfile = { values: [2, 0.4, 20, 6, 3, 90], credited: 2 };
  it('says unknown with a difficulty word when nothing is credited', () => {
    const r = readiness(EASY, { credited: 0 });
    expect(r.kind).toBe('unknown');
    expect(r.label).toBe('Beginner');
  });
  it('is ready when nothing is beyond the profile', () => {
    expect(readiness([1.8, 0.45, 19, 5, 3, 85], profile).kind).toBe('ready');
  });
  it('is a small stretch on exactly one metric a little above', () => {
    const r = readiness([2, 0.4, 20, 6, 4.5, 90], profile);
    expect(r.kind).toBe('stretch');
    expect(r.gaps.map((g) => g.key)).toEqual(['displacement']);
    expect(r.detail).toBe('bigger hand jumps');
  });
  it('names the skills when two metrics are well above, hardest gap first', () => {
    const r = readiness([6, 0.4, 20, 6, 9, 90], profile);
    expect(r.kind).toBe('needs');
    expect(r.label).toBe('Needs two skills');
    expect(r.gaps.map((g) => g.key)).toEqual(['displacement', 'density']);
    expect(r.detail).toBe('bigger hand jumps and more notes at once');
  });
});

describe('bridge song', () => {
  const profile: SkillProfile = { values: [2, 0.4, 20, 6, 3, 90], credited: 2 };
  const target = readiness([6, 0.4, 20, 6, 9, 90], profile);
  const pool = [
    { id: 'too-easy', title: 'Easy', values: [1, 0.5, 12, 4, 2, 80], bars: 8 },
    { id: 'jumps-long', title: 'Jumps long', values: [2, 0.4, 20, 6, 4.5, 90], bars: 40 },
    { id: 'jumps-short', title: 'Jumps short', values: [2, 0.4, 20, 6, 4.5, 90], bars: 16 },
    { id: 'wrong-skill', title: 'Reach', values: [2, 0.4, 26, 6, 3, 90], bars: 8 },
    { id: 'two-skills', title: 'Both', values: [5, 0.4, 20, 6, 8, 90], bars: 8 },
  ];
  it('picks the shortest piece that is a stretch on one of the missing skills', () => {
    const b = bridgeSong(target, profile, pool)!;
    expect(b.id).toBe('jumps-short');
    expect(b.teaches).toBe('displacement');
    expect(b.reason).toContain('16 bars');
  });
  it('excludes the current song and gives nothing for a ready target', () => {
    expect(bridgeSong(target, profile, pool, 'jumps-short')!.id).toBe('jumps-long');
    expect(bridgeSong(readiness(EASY, profile), profile, pool)).toBeUndefined();
  });
});
