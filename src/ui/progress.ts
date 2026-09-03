import type { Arrangement, LevelId } from '../types';
import type { StepAction } from '../sheet/steps';
import type { AttemptScore } from '../practice/score';
import { PROMOTION } from '../practice/score';
import { SCAFFOLD_NAMES, type DailyItem, type SongProgress, type StageProgress } from '../practice/progress';
import type { NextAction } from '../practice/next';
import { el, esc } from './dom';

export interface ProgressHandlers {
  run(action: StepAction): void;
  showAllAids(): void;
  /** Claude's diagnosis; absent without an API key. */
  diagnose?(): Promise<void>;
  /** Claude's two-sentence journal entry; absent without an API key. */
  journal?(): Promise<void>;
}

export interface ProgressState {
  arr: Arrangement;
  levelId: LevelId;
  stage?: StageProgress;
  song?: SongProgress;
  last?: AttemptScore;
  next: NextAction;
  today: DailyItem[];
  scaffold: number;
  diagnosis?: string;     // Claude's cause, once asked
  busy?: 'diagnose' | 'journal';
}

/** "Your progress" card in the side panel: last attempt, the streak, the next drill, today's set, aids, journal. */
export class ProgressPanel {
  constructor(private root: HTMLElement, private h: ProgressHandlers) {}

  render(s: ProgressState): void {
    const { stage, last, next } = s;
    const root = this.root;
    root.innerHTML = '';
    const nextLevel = s.levelId < 6 ? s.levelId + 1 : undefined;
    root.appendChild(el('h3', undefined, `Your progress <span class="muted">stage ${s.levelId}${stage?.attempts.length ? ` · ${stage.attempts.length} attempt${stage.attempts.length === 1 ? '' : 's'}` : ''}</span>`));

    if (last) {
      const bits = [
        `${modeName(last.mode)}, ${bars(last.startBar, last.endBar)}, ${Math.round(last.tempoScale * 100)}%`,
        `notes ${pct(last.noteAccuracy)}`,
        last.timingAccuracy !== undefined ? `timing ${pct(last.timingAccuracy)}` : `${last.pauses} pause${last.pauses === 1 ? '' : 's'}`,
        `${last.wrong} wrong`,
      ];
      root.appendChild(el('div', 'pg-row', `<span>Last: ${esc(bits.join(' · '))}</span>${last.clean ? '<span class="badge good">clean</span>' : ''}`));
    } else if (!stage?.attempts.length) {
      root.appendChild(el('div', 'pg-row muted', 'Play in Learn, Rhythm or Perform mode and your attempts are scored here. Progress stays in this browser.'));
    }

    if (stage && nextLevel) {
      const dots = Array.from({ length: PROMOTION.runs }, (_, i) => `<i class="${i < stage.cleanRuns ? 'on' : ''}"></i>`).join('');
      const text = stage.earned ? `Stage ${s.levelId} earned. Stage ${nextLevel} is open.`
        : `<span class="pg-streak" title="Consecutive clean whole-piece runs in Rhythm or Perform mode at ${Math.round(PROMOTION.tempo * 100)}% tempo or faster">${dots}</span> ${stage.cleanRuns} of ${PROMOTION.runs} clean runs toward stage ${nextLevel}`;
      root.appendChild(el('div', 'pg-row', text));
    }

    const card = el('div', 'pg-next');
    card.innerHTML = `<b>Next: ${esc(next.title.replace(/, stage \d$/, ''))}</b><span class="muted">${esc(cap(s.diagnosis ?? next.reason))}.</span>`;
    const row = el('div', 'pg-row');
    const go = el('button', 'btn small primary', '▶ Do it'); go.addEventListener('click', () => this.h.run(next.action)); row.appendChild(go);
    if (this.h.diagnose && stage?.attempts.length && !s.diagnosis) {
      const b = el('button', 'btn small', s.busy === 'diagnose' ? '✨ Thinking…' : '✨ Ask Claude why');
      b.disabled = s.busy === 'diagnose';
      b.addEventListener('click', () => void this.h.diagnose!());
      row.appendChild(b);
    }
    card.appendChild(row);
    root.appendChild(card);

    if (s.today.length) {
      const today = el('div', 'pg-row pg-today', '<span>Today:</span>');
      for (const item of s.today) {
        const label = item.kind === 'new' ? 'New' : item.kind === 'weak' ? 'Weak' : 'Keep fresh';
        const b = el('button', 'btn small', `${label}: ${bars(item.section.startBar, item.section.endBar)}`);
        b.title = item.kind === 'new' ? 'A section you have not tried yet' : item.kind === 'weak' ? 'Your weakest section' : 'Mastered a while ago; play it once so it stays';
        const hands = s.arr.levels[s.levelId].notes.some((n) => n.hand === 'lh') ? 'both' : 'rh';
        b.addEventListener('click', () => this.h.run({ startBar: item.section.startBar, endBar: item.section.endBar, hands, tempoScale: item.kind === 'mastered' ? 0.9 : 0.6, level: s.levelId, mode: item.kind === 'new' ? 'learn' : 'rhythm' }));
        today.appendChild(b);
      }
      root.appendChild(today);
    }

    const aids = el('div', 'pg-row');
    const hidden = SCAFFOLD_NAMES.slice(0, s.scaffold);
    aids.innerHTML = `<span>${hidden.length ? `Hidden after clean runs: ${esc(hidden.join(', '))}.` : `All reading aids on; one fades every ${PROMOTION.fadeRuns} clean runs.`}</span>`;
    if (hidden.length) { const b = el('button', 'btn small', 'Show all aids'); b.addEventListener('click', () => this.h.showAllAids()); aids.appendChild(b); }
    root.appendChild(aids);

    const entry = s.song?.journal[s.song.journal.length - 1];
    if (entry || (this.h.journal && stage?.attempts.length)) {
      const j = el('div', 'pg-journal');
      if (entry) j.appendChild(el('div', undefined, `${esc(entry.text)} <span class="muted small">— ${new Date(entry.at).toLocaleDateString()}</span>`));
      if (this.h.journal && stage?.attempts.length) {
        const b = el('button', 'btn small', s.busy === 'journal' ? '✨ Writing…' : '✨ Write today\'s note');
        b.disabled = s.busy === 'journal';
        b.style.marginTop = '6px';
        b.addEventListener('click', () => void this.h.journal!());
        j.appendChild(b);
      }
      root.appendChild(j);
    }
  }
}

function bars(a: number, b: number): string { return a === b ? `bar ${a + 1}` : `bars ${a + 1}–${b + 1}`; }
function pct(x: number): string { return `${Math.round(x * 100)}%`; }
function modeName(m: string): string { return m[0].toUpperCase() + m.slice(1); }
function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
