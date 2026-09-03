import { describe, expect, it } from 'vitest';
import { CATALOG, editDistance, findCatalog } from '../src/catalog/songs';

const ids = (q: string) => findCatalog(q).map((e) => e.id);

describe('catalog lookup', () => {
  it('returns everything for an empty query', () => {
    expect(findCatalog('')).toEqual(CATALOG);
  });
  it('matches with or without the accent', () => {
    expect(ids('fur elise')[0]).toBe('fur-elise');
    expect(ids('Für Elise')[0]).toBe('fur-elise');
    expect(ids('fuer elise')[0]).toBe('fur-elise');
  });
  it('matches formal titles through aliases', () => {
    expect(ids('Bagatelle No. 25')[0]).toBe('fur-elise');
    expect(ids('bagatelle')[0]).toBe('fur-elise');
    expect(ids("pachelbel's canon")[0]).toBe('canon-in-d');
    expect(ids('symphony no 9')[0]).toBe('ode-to-joy');
  });
  it('tolerates a typo and a prefix', () => {
    expect(ids('twinkel')[0]).toBe('twinkle');
    expect(ids('twink')[0]).toBe('twinkle');
    expect(ids('jingle')[0]).toBe('jingle-bells');
  });
  it('matches by composer and lists both Beethoven pieces', () => {
    expect(new Set(ids('beethoven'))).toEqual(new Set(['ode-to-joy', 'fur-elise']));
  });
  it('rejects unrelated queries', () => {
    expect(ids('bohemian rhapsody')).toEqual([]);
    expect(ids('let it be')).toEqual([]);
  });
  it('edit distance counts a transposition as one', () => {
    expect(editDistance('twinkle', 'twinkel')).toBe(1);
    expect(editDistance('elise', 'elise')).toBe(0);
    expect(editDistance('abc', 'xyz')).toBe(3);
  });
});
