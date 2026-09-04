import { describe, expect, it } from 'vitest';
import { parseComposer, parseTable, slugFromUrl } from '../scripts/mutopia-table.mjs';
import { describeLength, mutopiaEntries, type MutopiaIndex } from '../src/catalog/mutopia';
import { allCatalog, CATALOG, findCatalog, isMidiEntry, registerCatalog, searchCatalog } from '../src/catalog/songs';
import { rankResults } from '../src/search/rank';

import html from './fixtures/mutopia-table.html?raw';

describe('ingest: Mutopia result table', () => {
  const rows = parseTable(html);
  it('reads one record per result table', () => {
    expect(rows.map((r) => r.title)).toEqual(['Vocalise № 1', 'Giselle - Pas de deux (1er Acte)', 'Rumores de la Caleta']);
  });
  it('separates composer, dates, instrument, licence, opus and the midi link', () => {
    const g = rows[1];
    expect(g).toBeDefined();
    expect(g.composer).toBe('A. Adam');
    expect(g.dates).toBe('1803–1856');
    expect(g.instrument).toBe('Piano');
    expect(g.licence).toBe('Public Domain');
    expect(g.arranger).toBe('Laurence Sardain');
    expect(g.mutopiaId).toBe(897);
    expect(g.midUrl).toBe('https://www.mutopiaproject.org/ftp/AdamA/giselle/giselle.mid');
    expect(g.slug).toBe('adama-giselle');
    expect(rows[2].opus).toBe('71');
    expect(rows[0].instrument).toBe('Voice, Piano');
  });
  it('decodes entities and folds the ftp path into a slug', () => {
    expect(parseComposer('by I. M. F. Albéniz (1860–1909)')).toEqual({ composer: 'I. M. F. Albéniz', dates: '1860–1909' });
    expect(parseComposer('by Anonymous')).toEqual({ composer: 'Anonymous', dates: undefined });
    expect(slugFromUrl('https://www.mutopiaproject.org/ftp/AlbenizIMF/O71/Rumores_de_la-caleta/Rumores_de_la-caleta.mid'))
      .toEqual({ dir: 'AlbenizIMF/O71/Rumores_de_la-caleta', slug: 'albenizimf-o71-rumores-de-la-caleta' });
  });
});

const index: MutopiaIndex = {
  source: 'test', generated: '2026-09-04', count: 2,
  pieces: [
    { id: 'mutopia-beethovenlv-moonlight', title: 'Sonata No. 14 “Moonlight”', composer: 'L. van Beethoven', opus: 'Op. 27, No. 2', licence: 'Public Domain', file: 'beethovenlv-moonlight.mid', bpm: 54, timeSig: { num: 2, den: 2 }, notes: 900, bars: 69, seconds: 312 },
    { id: 'mutopia-satiee-gymnopedie1', title: 'Gymnopédie No. 1', composer: 'E. Satie', licence: 'Public Domain', file: 'satiee-gymnopedie1.mid', bpm: 70, timeSig: { num: 3, den: 4 }, notes: 300, bars: 78, seconds: 200 },
  ],
};

describe('catalog: Mutopia entries', () => {
  const entries = mutopiaEntries(index, '/');
  it('become MIDI entries with a base-relative url and the opus as an alias', () => {
    expect(entries.every(isMidiEntry)).toBe(true);
    expect(entries[0].url).toBe('/catalog/mutopia/beethovenlv-moonlight.mid');
    expect(entries[0].aliases).toEqual(['Op. 27, No. 2']);
    expect(describeLength(entries[0])).toBe('69 bars · 5:12');
  });
  it('are searchable once registered, after the bundled pieces', () => {
    registerCatalog(entries);
    expect(allCatalog().slice(0, CATALOG.length)).toEqual(CATALOG);
    expect(findCatalog('moonlight sonata')[0].id).toBe('mutopia-beethovenlv-moonlight');
    expect(findCatalog('gymnopedie')[0].id).toBe('mutopia-satiee-gymnopedie1');
    expect(findCatalog('satie')[0].id).toBe('mutopia-satiee-gymnopedie1');
    expect(findCatalog('op 27')[0].id).toBe('mutopia-beethovenlv-moonlight');
    const beethoven = findCatalog('beethoven').map((e) => e.id);
    expect(beethoven).toContain('mutopia-beethovenlv-moonlight');
    expect(beethoven).toContain('fur-elise');
  });
  it('registering the same id again replaces it', () => {
    registerCatalog(entries);
    expect(allCatalog().filter((e) => e.id === entries[0].id)).toHaveLength(1);
  });
  it('keep the catalog score through the results ranker', () => {
    const hits = searchCatalog('moonlight sonata');
    const results = hits.map(({ entry, score }) => ({ id: entry.id, name: `${entry.title} — ${entry.composer}`, downloadUrl: '', source: 'catalog' as const, relevance: score }));
    const ranked = rankResults([...results].reverse(), 'moonlight sonata');
    expect(ranked[0].id).toBe('mutopia-beethovenlv-moonlight');
    expect(ranked[0].score).toBeCloseTo(16 + hits[0].score);
  });
});
