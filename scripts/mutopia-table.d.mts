export interface MutopiaRow {
  title: string;
  composer: string;
  dates?: string;
  opus?: string;
  instrument: string;
  date?: string;
  style?: string;
  arranger?: string;
  source?: string;
  licence: string;
  mutopiaId?: number;
  added?: string;
  midUrl?: string;
  zipUrl?: string;
  dir?: string;
  slug?: string;
}
export function decodeEntities(s: string): string;
export function parseComposer(cell: string): { composer: string; dates?: string };
export function slugFromUrl(url: string): { dir: string; slug: string } | undefined;
export function parseTable(html: string): MutopiaRow[];
