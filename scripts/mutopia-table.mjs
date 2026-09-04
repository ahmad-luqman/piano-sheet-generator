/**
 * Parse Mutopia's search-result HTML (cgibin/make-table.cgi) into piece records.
 *
 * Each hit is one <table class="result-table"> whose cells arrive in a fixed order:
 *   row 1: title | "by A. Adam (1803–1856)" | opus | —
 *   row 2: "for Piano" | date | style | "arr. …"
 *   row 3: source | licence | "More Information" (piece-info.cgi?id=N) | date added
 *   row 4: .ly | .mid (or a -mids.zip for multi-movement works) | preview | ftp area
 * Plain string work so it can be unit-tested against a saved page.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function text(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** "by A. Adam (1803–1856)" → { composer: "A. Adam", dates: "1803–1856" } */
export function parseComposer(cell) {
  const m = /^by\s+(.+?)(?:\s*\(([^)]*)\))?$/.exec(cell.trim());
  if (!m) return { composer: cell.trim() };
  return { composer: m[1].trim(), dates: m[2]?.trim() || undefined };
}

/** "https://www.mutopiaproject.org/ftp/AdamA/giselle/giselle.mid" → { dir: "AdamA/giselle", slug: "adama-giselle" } */
export function slugFromUrl(url) {
  const m = /\/ftp\/([^/]+)\/(.+)\/[^/]+$/.exec(url);
  if (!m) return undefined;
  const dir = `${m[1]}/${m[2]}`;
  const slug = dir.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { dir, slug };
}

export function parseTable(html) {
  const out = [];
  const blocks = html.split(/<table class="[^"]*result-table"[^>]*>/).slice(1);
  for (const block of blocks) {
    const body = block.split('</table>')[0];
    const cellsHtml = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const cells = cellsHtml.map(text);
    if (cells.length < 12) continue;
    const midHref = /href="([^"]+\.mid)"/.exec(body)?.[1];
    const zipHref = /href="([^"]+-mids\.zip)"/.exec(body)?.[1];
    const id = /piece-info\.cgi\?id=(\d+)/.exec(body)?.[1];
    const { composer, dates } = parseComposer(cells[1]);
    out.push({
      title: cells[0],
      composer, dates,
      opus: cells[2] || undefined,
      instrument: cells[4].replace(/^for\s+/, ''),
      date: cells[5] || undefined,
      style: cells[6] || undefined,
      arranger: cells[7].replace(/^arr\.\s*/, '') || undefined,
      source: cells[8] || undefined,
      licence: cells[9],
      mutopiaId: id ? parseInt(id, 10) : undefined,
      added: cells[11] || undefined,
      midUrl: midHref,
      zipUrl: zipHref,
      ...(midHref ? slugFromUrl(midHref) : {}),
    });
  }
  return out;
}
