import { afterEach, describe, expect, it, vi } from 'vitest';
import { Midi } from '@tonejs/midi';
import { analyzeMidi, analyzeVersion, analyzeVersions, cachedAnalysis, completeness, describeVersion, duration, PREVIEW_BARS, recommendScore, sortVersions, type VersionAnalysis } from '../src/search/analyze';
import { parseMidi } from '../src/midi/parse';
import { CATALOG, loadCatalogSong } from '../src/catalog/songs';
import type { SearchResult } from '../src/search/bitmidi';

const PPQ = 480;

/** Serialize catalog notes into a MIDI file with the given per-track programs and names. */
function midiFrom(id: string, tracks: { track: number; name: string; program?: number; channel?: number; transpose?: number }[], extra?: (m: Midi) => void): ArrayBuffer {
  const song = loadCatalogSong(CATALOG.find((c) => c.id === id)!);
  const m = new Midi();
  m.header.setTempo(song.bpm);
  m.header.timeSignatures.push({ ticks: 0, timeSignature: [song.timeSig.num, song.timeSig.den] });
  for (const t of tracks) {
    const tr = m.addTrack();
    tr.name = t.name; tr.channel = t.channel ?? t.track; tr.instrument.number = t.program ?? 0;
    for (const n of song.notes.filter((x) => x.track === t.track)) tr.addNote({ midi: n.midi + (t.transpose ?? 0), ticks: Math.round(n.startBeat * PPQ), durationTicks: Math.round(n.durationBeats * PPQ), velocity: n.velocity });
  }
  extra?.(m);
  return m.toArray().buffer as ArrayBuffer;
}

const pianoTwinkle = () => midiFrom('twinkle', [{ track: 0, name: 'Right hand' }, { track: 1, name: 'Left hand' }]);
/** The same tune as a band: guitar lead, bass, string pad doubling the chords, drums. */
const bandTwinkle = () => midiFrom('twinkle', [
  { track: 0, name: 'Lead', program: 27 }, { track: 1, name: 'Bass', program: 33 }, { track: 1, name: 'Strings', program: 48, channel: 2, transpose: 12 },
], (m) => { const d = m.addTrack(); d.name = 'Drums'; d.channel = 9; for (let b = 0; b < 48; b++) d.addNote({ midi: 36, ticks: b * PPQ, durationTicks: 100 }); });
const melodyOnly = () => midiFrom('twinkle', [{ track: 0, name: 'Melody' }]);

describe('parseMidi keeps instrument families', () => {
  it('reads the GM family per track and flags drums', () => {
    const band = parseMidi(bandTwinkle(), 'band', 'test');
    expect(band.tracks.map((t) => t.family)).toEqual(['guitar', 'bass', 'ensemble']);
    expect(band.hasDrums).toBe(true);
    const piano = parseMidi(pianoTwinkle(), 'piano', 'test');
    expect(piano.tracks.every((t) => t.family === 'piano')).toBe(true);
    expect(piano.hasDrums).toBe(false);
  });
});

describe('analyzeMidi', () => {
  it('recognises a clean two-hand piano file', () => {
    const a = analyzeMidi(pianoTwinkle(), 'p', 'twinkle piano');
    expect(a.valid).toBe(true);
    expect(a.instrumentation).toBe('piano');
    expect(a.trackCount).toBe(2);
    expect(a.handSplit).toBeGreaterThanOrEqual(0.8);
    expect(a.melodyConfidence).toBeGreaterThanOrEqual(0.7);
    expect(a.durationSec).toBeCloseTo(12 * 4 * 60 / 100, 0);
    expect(a.bars).toBe(12);
    expect(a.fingerprint!.overall).toBeLessThan(0.3);
    expect(a.suggestedLevel).toBeDefined();
    expect(a.preview.length).toBeGreaterThan(0);
    expect(a.preview.every((n) => n.startBeat < PREVIEW_BARS * a.beatsPerBar)).toBe(true);
    expect(new Set(a.preview.map((n) => n.hand))).toEqual(new Set(['rh']));
    expect(a.song).toBeDefined();
  });
  it('recognises a band arrangement', () => {
    const a = analyzeMidi(bandTwinkle(), 'b', 'twinkle band');
    expect(a.valid).toBe(true);
    expect(a.instrumentation).toBe('band');
    expect(a.instruments).toContain('drums');
    expect(a.instruments).toContain('guitar');
    expect(a.trackCount).toBe(3);
  });
  it('flags a single-track file as a guessed split', () => {
    const a = analyzeMidi(melodyOnly(), 'm', 'melody');
    expect(a.trackCount).toBe(1);
    expect(a.handSplit).toBeLessThan(0.7);
    expect(describeVersion(a).map((b) => b.text)).toContain('single track');
    expect(describeVersion(a).map((b) => b.text)).toContain('no left hand');
  });
  it('previews eight bars from the first melody note, not from bar 1', () => {
    const shifted = midiFrom('twinkle', [{ track: 0, name: 'Right hand' }, { track: 1, name: 'Left hand' }], (m) => {
      for (const t of m.tracks) for (const n of t.notes) n.ticks += 10 * 4 * PPQ;
    });
    const a = analyzeMidi(shifted, 's', 'late start');
    expect(a.preview.length).toBeGreaterThan(0);
    expect(Math.min(...a.preview.map((n) => n.startBeat))).toBeGreaterThanOrEqual(40);
    expect(a.preview.every((n) => n.startBeat < 40 + PREVIEW_BARS * a.beatsPerBar)).toBe(true);
  });
  it('returns an invalid analysis instead of throwing on garbage', () => {
    const a = analyzeMidi(new TextEncoder().encode('hello').buffer as ArrayBuffer, 'x', 'junk');
    expect(a.valid).toBe(false);
    expect(a.error).toMatch(/not a readable MIDI/);
    expect(describeVersion(a)[0].tone).toBe('bad');
  });
});

describe('recommendation and sorts', () => {
  const piano = analyzeMidi(pianoTwinkle(), 'p', 'piano');
  const band = analyzeMidi(bandTwinkle(), 'b', 'band');
  const stub = analyzeMidi(melodyOnly(), 'm', 'melody');
  const junk = analyzeMidi(new ArrayBuffer(0), 'x', 'junk');
  const analyses = new Map<string, VersionAnalysis>([['p', piano], ['b', band], ['m', stub], ['x', junk]]);
  const versions = [
    { id: 'x', views: 900 }, { id: 'b', views: 500 }, { id: 'm', views: 100 }, { id: 'p', views: 10 }, { id: 'u', views: 5 },
  ];

  it('prefers piano over band over a melody stub, and sinks invalid files', () => {
    expect(recommendScore(piano)).toBeGreaterThan(recommendScore(band));
    expect(recommendScore(band)).toBeGreaterThan(recommendScore(stub));
    expect(recommendScore(junk)).toBeLessThan(recommendScore(stub));
  });
  it('sorts by best match and keeps unanalysed versions last in search order', () => {
    expect(sortVersions(versions, analyses, 'best').map((v) => v.id)).toEqual(['p', 'b', 'm', 'x', 'u']);
  });
  it('sorts by popularity with invalid files last', () => {
    expect(sortVersions(versions, analyses, 'popular').map((v) => v.id)).toEqual(['b', 'm', 'p', 'x', 'u']);
  });
  it('puts piano-only first', () => {
    const ids = sortVersions(versions, analyses, 'piano').map((v) => v.id);
    expect(ids[0]).toBe('p');
    expect(ids.indexOf('x')).toBe(3);
  });
  it('measures completeness against the group', () => {
    const group = [piano, band, stub];
    expect(completeness(piano, group)).toBe(1);
    expect(completeness(stub, group)).toBeLessThan(completeness(piano, group));
    expect(completeness(junk, group)).toBe(0);
    expect(sortVersions(versions, analyses, 'original')[0].id).toBe('p');
  });
  it('sorts easiest by the fingerprint', () => {
    const ids = sortVersions(versions, analyses, 'easiest').map((v) => v.id);
    expect(ids.indexOf('x')).toBe(3);
    const overall = (id: string) => analyses.get(id)!.fingerprint!.overall;
    expect(overall(ids[0])).toBeLessThanOrEqual(overall(ids[1]));
  });
  it('describes a version with badges', () => {
    const texts = describeVersion(piano).map((b) => b.text);
    expect(texts).toContain('piano only');
    expect(texts).toContain('clear hands');
    expect(texts.some((t) => t.startsWith('start at stage'))).toBe(true);
    expect(describeVersion(band).map((b) => b.text)).toContain('band');
    expect(duration(29)).toBe('29s');
    expect(duration(125)).toBe('2:05');
  });
});

describe('analyzeVersion cache', () => {
  afterEach(() => vi.unstubAllGlobals());
  const result = (id: string): SearchResult => ({ id, name: `file ${id}`, downloadUrl: `https://example.test/${id}.mid`, source: 'bitmidi' });

  it('downloads once per url and serves the parsed song afterwards', async () => {
    const fetchMock = vi.fn(async () => new Response(pianoTwinkle(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = result('cache-1');
    expect(cachedAnalysis(r)).toBeUndefined();
    const [a, b] = await Promise.all([analyzeVersion(r), analyzeVersion(r)]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedAnalysis(r)?.song?.title).toBe('file cache-1');
    await analyzeVersion(r);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('records a failed download as an invalid version without a parsed song', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const a = await analyzeVersion(result('cache-404'));
    expect(a.valid).toBe(false);
    expect(a.error).toMatch(/404/);
    expect(a.song).toBeUndefined();
  });
  it('analyses the top N with a concurrency cap and skips catalog entries', async () => {
    let inFlight = 0, peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(pianoTwinkle(), { status: 200 });
    }));
    const list: SearchResult[] = [{ id: 'cat', name: 'Twinkle', downloadUrl: '', source: 'catalog' }, ...['a', 'b', 'c', 'd', 'e'].map((x) => result(`many-${x}`))];
    const seen: string[] = [];
    const out = await analyzeVersions(list, { limit: 4, concurrency: 2, onEach: (a) => seen.push(a.id) });
    expect(out.length).toBe(4);
    expect(seen.sort()).toEqual(['many-a', 'many-b', 'many-c', 'many-d']);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
