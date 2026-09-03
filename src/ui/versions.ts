import type { RankedResult, SongGroup } from '../search/rank';
import { titleCase } from '../search/rank';
import { cachedAnalysis, describeVersion, recommendScore, SORT_META, sortVersions, type Badge, type VersionAnalysis, type VersionSort } from '../search/analyze';
import { el, esc } from './dom';

export interface GroupHandlers {
  pick(r: RankedResult): void;
  /** Start analysing these versions; the card is refreshed by the caller as each one lands. */
  analyze(versions: RankedResult[], card: GroupCard): void;
  preview(a: VersionAnalysis, button: HTMLButtonElement): void;
  /** One sentence per analysed version from Claude; absent when there is no API key. */
  explain?(g: SongGroup, analyses: VersionAnalysis[]): Promise<Map<string, string>>;
  sort: { get(): VersionSort; set(s: VersionSort): void };
}

export const ANALYZE_BATCH = 6;

/**
 * One result card: the song row, and behind a "N versions" toggle the uploads of that
 * song as comparison cards with badges, a sort control and a preview button. Opening the
 * list starts analysing the top uploads; once any are analysed the song row itself
 * points at the recommended one.
 */
export class GroupCard {
  readonly el: HTMLElement;
  private row: HTMLElement;
  private list: HTMLElement;
  private more: HTMLButtonElement | null = null;
  private explanations = new Map<string, string>();
  private explaining = false;
  private started = new Set<string>();

  constructor(private g: SongGroup, private h: GroupHandlers) {
    this.el = el('div', 'res-group');
    this.row = el('div', 'res-item');
    this.list = el('div', 'res-versions');
    this.list.hidden = true;
    this.el.append(this.row, this.list);
    this.renderRow();
    if (this.isCatalog) return;
    this.more = el('button', 'btn small res-more');
    this.more.type = 'button';
    this.more.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.row.appendChild(this.more);
    this.setMoreLabel();
    this.refresh();
  }

  private get isCatalog(): boolean { return this.g.best.source === 'catalog'; }

  /** The analysed version a beginner should get, if any has been analysed yet. */
  get recommended(): { r: RankedResult; a: VersionAnalysis } | undefined {
    const known = this.g.versions.map((r) => ({ r, a: cachedAnalysis(r)! })).filter((x) => x.a);
    if (known.length === 0) return undefined;
    return known.sort((x, y) => recommendScore(y.a) - recommendScore(x.a))[0];
  }

  private analyses(): Map<string, VersionAnalysis> {
    const m = new Map<string, VersionAnalysis>();
    for (const r of this.g.versions) { const a = cachedAnalysis(r); if (a) m.set(r.id, a); }
    return m;
  }

  private toggle(): void {
    this.list.hidden = !this.list.hidden;
    this.setMoreLabel();
    if (!this.list.hidden) this.analyzeNext();
  }

  private setMoreLabel(): void {
    if (!this.more) return;
    const n = this.g.versions.length;
    this.more.textContent = this.list.hidden ? (n > 1 ? `${n} versions` : 'Check file') : 'Hide';
  }

  private analyzeNext(): void {
    const todo = this.g.versions.filter((r) => !cachedAnalysis(r) && !this.started.has(r.id)).slice(0, ANALYZE_BATCH);
    if (todo.length === 0) return;
    for (const r of todo) this.started.add(r.id);
    this.h.analyze(todo, this);
    this.refresh();
  }

  private renderRow(): void {
    const g = this.g, best = g.best;
    const label = this.isCatalog ? esc(best.name) : esc(g.displayTitle) + (g.artist ? ` <span class="muted">· ${esc(titleCase(g.artist))}</span>` : '');
    this.row.innerHTML = `<span class="tag ${best.source}">${this.isCatalog ? 'built-in' : 'bitmidi'}</span>` +
      `<span class="name"><span class="res-title">${label}</span><span class="res-rec muted small"></span><span class="res-badges"></span></span>` +
      (best.views ? `<span class="muted small">${best.views.toLocaleString()} views</span>` : '');
    this.row.addEventListener('click', () => this.h.pick(this.recommended?.r ?? best));
  }

  /** Re-read the analysis cache and repaint the song row and the version list. */
  refresh(): void {
    if (this.isCatalog) return;
    const rec = this.recommended;
    const recEl = this.row.querySelector<HTMLElement>('.res-rec')!;
    const badgesEl = this.row.querySelector<HTMLElement>('.res-badges')!;
    recEl.textContent = rec && this.g.versions.length > 1 ? `Recommended: ${rec.r.name}` : '';
    badgesEl.replaceChildren(...(rec ? badges(describeVersion(rec.a)) : []));
    this.renderList();
  }

  private renderList(): void {
    const analyses = this.analyses();
    const versions = sortVersions(this.g.versions, analyses, this.h.sort.get());
    const rec = this.recommended;
    const pendingCount = this.g.versions.filter((r) => this.started.has(r.id) && !cachedAnalysis(r)).length;
    const unchecked = this.g.versions.filter((r) => !cachedAnalysis(r) && !this.started.has(r.id)).length;

    const head = el('div', 'res-vhead');
    const status = pendingCount ? `Checking ${pendingCount} file${pendingCount === 1 ? '' : 's'}…`
      : analyses.size ? `${analyses.size} of ${this.g.versions.length} checked` : '';
    head.appendChild(el('span', 'muted small res-vstatus', esc(status)));
    if (unchecked && !pendingCount) {
      const b = el('button', 'btn small', `Check ${Math.min(ANALYZE_BATCH, unchecked)} more`);
      b.type = 'button';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.analyzeNext(); });
      head.appendChild(b);
    }
    if (this.h.explain && analyses.size > 0 && this.explanations.size === 0) {
      const b = el('button', 'btn small', this.explaining ? '✨ Thinking…' : '✨ Explain the picks');
      b.type = 'button'; b.disabled = this.explaining;
      b.addEventListener('click', (e) => { e.stopPropagation(); void this.explain(); });
      head.appendChild(b);
    }
    if (this.g.versions.length > 1) {
      const lab = el('label', 'small', 'Sort ');
      const sel = el('select', 'select small');
      for (const [k, v] of Object.entries(SORT_META)) { const o = el('option', undefined, v); o.value = k; sel.appendChild(o); }
      sel.value = this.h.sort.get();
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', (e) => { e.stopPropagation(); this.h.sort.set(sel.value as VersionSort); });
      lab.appendChild(sel);
      head.appendChild(lab);
    }

    const rows = versions.map((v) => {
      const a = analyses.get(v.id);
      const row = el('div', 'res-ver');
      const main = el('div', 'res-ver-main');
      main.innerHTML = `<span class="name">${esc(v.name)}</span>` +
        (v.views ? `<span class="muted small">${v.views.toLocaleString()} views</span>` : '') +
        (rec && rec.r.id === v.id && this.g.versions.length > 1 ? '<span class="res-star" title="Best file for a beginner by the badges">★ recommended</span>' : '');
      row.appendChild(main);
      if (a) {
        const bl = el('div', 'res-badges'); bl.replaceChildren(...badges(describeVersion(a))); row.appendChild(bl);
        const why = this.explanations.get(v.id);
        if (why) row.appendChild(el('div', 'res-why muted small', esc(why)));
        if (a.valid && a.preview.length) {
          const b = el('button', 'btn small res-prev', '▶ Preview');
          b.type = 'button'; b.title = 'Play the first eight bars of the stage 1 melody';
          b.addEventListener('click', (e) => { e.stopPropagation(); this.h.preview(a, b); });
          row.appendChild(b);
        }
      } else if (this.started.has(v.id)) {
        row.appendChild(el('div', 'res-badges muted small', 'checking…'));
      }
      row.addEventListener('click', () => this.h.pick(v));
      return row;
    });
    this.list.replaceChildren(head, ...rows);
  }

  private async explain(): Promise<void> {
    if (!this.h.explain || this.explaining) return;
    this.explaining = true; this.renderList();
    try {
      const analysed = [...this.analyses().values()];
      this.explanations = await this.h.explain(this.g, analysed);
    } finally { this.explaining = false; this.renderList(); }
  }
}

function badges(list: Badge[]): HTMLElement[] {
  return list.map((b) => { const s = el('span', `badge ${b.tone}`, esc(b.text)); if (b.title) s.title = b.title; return s; });
}
