export interface SearchResult {
  id: string;
  name: string;
  downloadUrl: string;
  pageUrl?: string;
  views?: number;
  source: 'bitmidi' | 'catalog';
}

const BASE = 'https://bitmidi.com';

/** Search bitmidi.com (CORS-open, undocumented JSON API). */
export async function searchBitmidi(query: string, page = 0, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `${BASE}/api/midi/search?q=${encodeURIComponent(query)}&page=${page}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`bitmidi search failed: HTTP ${res.status}`);
  const json = await res.json();
  const results: any[] = json?.result?.results ?? [];
  return results.map((r) => ({
    id: String(r.id), name: String(r.name).replace(/\.mid$/i, ''), downloadUrl: BASE + r.downloadUrl,
    pageUrl: BASE + (r.url ?? ''), views: r.views, source: 'bitmidi' as const,
  }));
}

export async function downloadMidi(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  const magic = String.fromCharCode(...head);
  if (magic !== 'MThd' && magic !== 'RIFF') throw new Error('That URL did not return a MIDI file.');
  return buf;
}
