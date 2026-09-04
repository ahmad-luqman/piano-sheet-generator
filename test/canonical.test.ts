import { describe, expect, it } from 'vitest';
import { candidateQuery, candidatesFromItunes, candidatesFromMusicBrainz, cleanTrackTitle, musicBrainzQuery, overlap, rankCandidates, sameAsQuery, type QueryCandidate } from '../src/search/canonical';
import { looksLikeProse, resultsAreWeak } from '../src/search/intent';
import { rankResults, groupResults, WEIGHTS } from '../src/search/rank';
import itunes from './fixtures/itunes-yesturday-beetles.json';
import mb from './fixtures/musicbrainz-yesturday-beetles.json';

describe('canonical lookup: iTunes', () => {
  it('reads songs with their artist', () => {
    const raw = candidatesFromItunes(itunes);
    expect(raw[0]).toEqual({ title: 'Yesterday', artist: 'The Beatles', source: 'itunes' });
    expect(raw.length).toBe(10);
  });
  it('keeps only the candidates that explain the whole query when one does', () => {
    const ranked = rankCandidates(candidatesFromItunes(itunes), 'yesturday beetles');
    expect(ranked).toEqual([{ title: 'Yesterday', artist: 'The Beatles', source: 'itunes' }]);
  });
  it('keeps partial matches, most words first, when nothing explains everything', () => {
    const raw: QueryCandidate[] = [
      { title: 'Another Sad Love Song', artist: 'Toni Braxton', source: 'itunes' },
      { title: 'Interstellar Main Theme', artist: 'Random Piano', source: 'itunes' },
      { title: 'Cornfield Chase', artist: 'Hans Zimmer', source: 'itunes' },
      { title: 'Interstellar', artist: 'Random Piano', source: 'itunes' },
    ];
    const ranked = rankCandidates(raw, 'that sad piano song from interstellar');
    expect(ranked.map((c) => c.title)).toEqual(['Interstellar', 'Interstellar Main Theme', 'Another Sad Love Song']);
    expect(ranked[0].artist).toBe('Random Piano');
  });
  it('offers each title once', () => {
    const raw: QueryCandidate[] = [
      { title: 'Interstellar', artist: 'Anna Lapwood', source: 'itunes' },
      { title: 'Interstellar', artist: 'Random Piano', source: 'itunes' },
    ];
    expect(rankCandidates(raw, 'interstellar piano')).toEqual([{ title: 'Interstellar', artist: 'Anna Lapwood', source: 'itunes' }]);
  });
  it('cleans remaster and bracket noise from track names', () => {
    expect(cleanTrackTitle('Yesterday (Remastered 2009)')).toBe('Yesterday');
    expect(cleanTrackTitle('Let It Be - Single Version')).toBe('Let It Be');
    expect(cleanTrackTitle('Hey Jude [Live]')).toBe('Hey Jude');
  });
  it('counts fuzzy word overlap and detects a circular suggestion', () => {
    const c: QueryCandidate = { title: 'Yesterday', artist: 'The Beatles', source: 'itunes' };
    expect(overlap('yesturday beetles', c)).toBe(2);
    expect(overlap('let it be', c)).toBe(0);
    expect(candidateQuery(c)).toBe('Yesterday - The Beatles');
    expect(sameAsQuery(c, 'yesterday - the beatles')).toBe(true);
    expect(sameAsQuery(c, 'Yesterday')).toBe(true);
    expect(sameAsQuery(c, 'yesturday beetles')).toBe(false);
  });
});

describe('canonical lookup: MusicBrainz', () => {
  it('builds a fuzzy Lucene query, per field when the query is split', () => {
    expect(musicBrainzQuery('yesturday beetles')).toBe('recording:(yesturday~ beetles~)');
    expect(musicBrainzQuery('yesturday - beetles')).toBe('recording:(yesturday~) AND artist:(beetles~)');
    expect(musicBrainzQuery('let it be by the beatles')).toBe('recording:(let~ it~ be~) AND artist:(the~ beatles~)');
  });
  it('reads recordings and their artist credits', () => {
    const raw = candidatesFromMusicBrainz(mb);
    expect(raw[0].title).toBe('Yesterday');
    expect(raw[0].source).toBe('musicbrainz');
    const ranked = rankCandidates(raw, 'yesturday beetles');
    expect(ranked[0].title).toBe('Yesterday');
    expect(ranked.length).toBeLessThanOrEqual(4);
  });
});

describe('intent', () => {
  it('spots descriptions and questions, not titles', () => {
    expect(looksLikeProse('that sad piano song from interstellar')).toBe(true);
    expect(looksLikeProse('the beatles one that goes let it be')).toBe(true);
    expect(looksLikeProse('what is the song from titanic?')).toBe(true);
    expect(looksLikeProse('let it be')).toBe(false);
    expect(looksLikeProse('i want to hold your hand')).toBe(false);
    expect(looksLikeProse('yesturday beetles')).toBe(false);
    expect(looksLikeProse('für elise')).toBe(false);
  });
  it('calls empty or phrase-less results weak', () => {
    expect(resultsAreWeak([])).toBe(true);
    const mk = (name: string, views = 100) => ({ id: name, name, downloadUrl: '', source: 'bitmidi' as const, views });
    const strong = groupResults(rankResults([mk('Let It Be.mid')], 'let it be'));
    expect(resultsAreWeak(strong)).toBe(false);
    const weak = groupResults(rankResults([mk('Fairy Tail - Sad Theme (Piano).mid'), mk('BRAXTON.Another sad love song.MID')], 'that sad piano song from interstellar'));
    expect(weak[0].score).toBeLessThan(WEIGHTS.phrase);
    expect(resultsAreWeak(weak)).toBe(true);
  });
});
