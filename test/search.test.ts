import { describe, expect, it } from 'vitest';
import { cleanFileName, fold, normalizeName, normalizeQuery, splitArtistTitle } from '../src/search/normalize';
import { groupResults, rankResults, searchGroups, titleCase } from '../src/search/rank';
import { buildQueryVariants, fromBitmidiRecord, mergeById, type SearchResult } from '../src/search/bitmidi';
import p0 from './fixtures/bitmidi-let-it-be-p0.json';
import p1 from './fixtures/bitmidi-let-it-be-p1.json';
import quoted from './fixtures/bitmidi-let-it-be-quoted-p0.json';
import underscored from './fixtures/bitmidi-let_it_be-p0.json';
import beatles from './fixtures/bitmidi-let-it-be-beatles-p0.json';
import furElise from './fixtures/bitmidi-fur-elise-p0.json';

const records = (fx: any): SearchResult[] => (fx.result.results as any[]).map(fromBitmidiRecord);

describe('normalize: file names', () => {
  it('folds accents, case and punctuation', () => {
    expect(fold('Für Elise (opening)')).toBe('fur elise opening');
    expect(fold("Don't Let Me Down")).toBe('dont let me down');
  });
  it('strips extension, brackets, karaoke flag and version suffix', () => {
    expect(cleanFileName('THE BEATLES.Let it be K.mid')).toBe('THE BEATLES.Let it be');
    expect(cleanFileName('Let-It-Be-3.mid')).toBe('Let-It-Be');
    expect(cleanFileName('Fur-Elise-2.mid')).toBe('Fur-Elise');
    expect(cleanFileName('Let It Snow! Let It Snow! Let It Snow! (1DX Only) (Xmas) (Seq Harry Todd) letitsnow_ht.mid'))
      .toBe('Let It Snow! Let It Snow! Let It Snow!');
    expect(cleanFileName('Baby D - Let Me Be Your Fantasy (Rank 1 Remix).mid')).toBe('Baby D - Let Me Be Your Fantasy');
  });
  it('keeps numbers that are part of a title', () => {
    expect(cleanFileName('Bagatelle No. 25.mid')).toBe('Bagatelle No. 25');
    expect(cleanFileName('Let me be Alone at the Brook, Opus.82.mid')).toBe('Let me be Alone at the Brook, Opus.82');
    expect(cleanFileName('Let It Go.mid')).toBe('Let It Go');
  });
  it('splits artist and title in the common upload formats', () => {
    expect(splitArtistTitle('THE BEATLES.Let it be')).toEqual({ artist: 'THE BEATLES', title: 'Let it be' });
    expect(splitArtistTitle('A.PARSON PROJECT.Dont let it show')).toEqual({ artist: 'A.PARSON PROJECT', title: 'Dont let it show' });
    expect(splitArtistTitle('Baby D - Let Me Be Your Fantasy')).toEqual({ artist: 'Baby D', title: 'Let Me Be Your Fantasy' });
    expect(splitArtistTitle('beatles-let_it_be')).toEqual({ artist: 'beatles', title: 'let_it_be' });
    expect(splitArtistTitle('Kim_Lukas_-_Let_it_be_the_night')).toEqual({ artist: 'Kim_Lukas', title: 'Let_it_be_the_night' });
    expect(splitArtistTitle('Mr. Blue Sky')).toEqual({ title: 'Mr. Blue Sky' });
  });
  it('normalizes every spelling of Let It Be to the same title', () => {
    const names = ['THE BEATLES.Let it be K.mid', 'Let-It-Be-1.mid', 'let_it_be.mid', 'beatles-let_it_be.mid', 'Let It Be.mid'];
    for (const n of names) expect(normalizeName(n).title, n).toBe('let it be');
    expect(normalizeName('THE BEATLES.Let it be K.mid').artist).toBe('the beatles');
  });
});

describe('normalize: queries', () => {
  it('keeps all tokens when every word is a stopword', () => {
    expect(normalizeQuery('Let It Be').significant).toEqual(['let', 'it', 'be']);
  });
  it('drops stopwords otherwise and splits "title by artist"', () => {
    const q = normalizeQuery('Let It Be by The Beatles');
    expect(q.title).toBe('let it be');
    expect(q.artist).toBe('the beatles');
    expect(normalizeQuery('The Sound of Silence').significant).toEqual(['sound', 'silence']);
    expect(normalizeQuery('the beatles').significant).toEqual(['beatles']);
  });
});

describe('query variants', () => {
  it('adds quoted, underscored and second-page variants, deduplicated', () => {
    const v = buildQueryVariants('let it be');
    expect(v).toContainEqual({ q: 'let it be', page: 0 });
    expect(v).toContainEqual({ q: 'let it be', page: 1 });
    expect(v).toContainEqual({ q: '"let it be"', page: 0 });
    expect(v).toContainEqual({ q: 'let_it_be', page: 0 });
    expect(new Set(v.map((x) => `${x.q}|${x.page}`)).size).toBe(v.length);
  });
  it('adds a title-plus-artist variant when the user separates them', () => {
    expect(buildQueryVariants('let it be - beatles')).toContainEqual({ q: '"let it be" beatles', page: 0 });
  });
  it('does not quote a single word', () => {
    expect(buildQueryVariants('beatles').some((x) => x.q.includes('"'))).toBe(false);
  });
});

describe('ranking against real bitmidi responses', () => {
  const merged = mergeById([records(p0), records(p1), records(quoted), records(underscored)]);

  it('merges by id without duplicates', () => {
    expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
    expect(merged.map((r) => r.id)).toContain('100821');
  });

  it('puts Let It Be above every Let It Snow for the query "let it be"', () => {
    const ranked = rankResults(merged, 'let it be');
    const firstSnow = ranked.findIndex((r) => r.norm.title.includes('snow'));
    const beatles = ranked.findIndex((r) => r.id === '100821');
    expect(beatles).toBe(0);
    expect(firstSnow).toBeGreaterThan(beatles);
    // every exact "let it be" upload outranks every near miss
    const exact = ranked.filter((r) => r.norm.title === 'let it be');
    const lastExact = ranked.indexOf(exact[exact.length - 1]);
    expect(lastExact).toBe(exact.length - 1);
  });

  it('groups the uploads into one Let It Be card with the Beatles file on top', () => {
    const groups = searchGroups(merged, 'let it be');
    expect(groups[0].title).toBe('let it be');
    expect(groups[0].best.id).toBe('100821');
    expect(groups[0].versions.length).toBeGreaterThanOrEqual(6);
    expect(groups[0].artist).toBe('the beatles');
    const me = groups.find((g) => g.title === 'let it be me');
    expect(me).toBeDefined();
    expect(me!.versions.length).toBe(2);
    expect(groups.findIndex((g) => g.title.includes('snow'))).toBeGreaterThan(1);
  });

  it('rewards the artist when the query names one', () => {
    const groups = searchGroups(mergeById([records(beatles), records(quoted)]), 'let it be beatles');
    expect(groups[0].best.id).toBe('100821');
    expect(groups[0].title).toBe('let it be');
  });

  it('collapses Für Elise uploads whichever way the accent was typed', () => {
    for (const q of ['fur elise', 'Für Elise']) {
      const groups = searchGroups(records(furElise), q);
      expect(groups[0].title).toBe('fur elise');
      expect(groups[0].versions.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('keeps catalog entries as their own cards', () => {
    const cat: SearchResult = { id: 'fur-elise', name: 'Für Elise (opening) — Ludwig van Beethoven', downloadUrl: '', source: 'catalog' };
    const groups = groupResults(rankResults([cat, ...records(furElise)], 'fur elise'));
    expect(groups.filter((g) => g.best.source === 'catalog').length).toBe(1);
  });
});

describe('titleCase', () => {
  it('capitalizes words except small ones', () => {
    expect(titleCase('let it be')).toBe('Let It Be');
    expect(titleCase('the sound of silence')).toBe('The Sound of Silence');
  });
});
