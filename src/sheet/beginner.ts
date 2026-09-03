import type { Arrangement, Chord, Level, Note } from '../types';
import { PC_COLORS } from '../piano/types';
import { pitchClass } from '../arrange/theory';

export interface BeginnerSheetOptions { showFingers: boolean; showOctaves: boolean; showLetters: boolean; barsPerRow: number; highlightNew: boolean }

/**
 * Letter-notation sheet. Each bar is a beat grid; notes are pills whose width is
 * their duration, coloured by pitch class, in two lanes (right hand above left).
 */
export class BeginnerSheet {
  onSeek?: (beat: number) => void;
  onChordClick?: (chord: Chord, bar: number, x: number, y: number) => void;
  private root: HTMLElement;
  private noteEls = new Map<Note, HTMLElement>();
  private barEls: HTMLElement[] = [];
  private arr: Arrangement | null = null;
  private level: Level | null = null;
  private activeNotes = new Set<HTMLElement>();
  private activeBar = -1;
  private cursor: HTMLElement | null = null;
  private opts: BeginnerSheetOptions = { showFingers: true, showOctaves: false, showLetters: true, barsPerRow: 4, highlightNew: true };
  private barScores = new Map<number, number>();

  constructor(private container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'bs';
    container.appendChild(this.root);
  }

  setOptions(o: Partial<BeginnerSheetOptions>): void {
    this.opts = { ...this.opts, ...o };
    if (this.arr && this.level) this.render(this.arr, this.level);
  }

  render(arr: Arrangement, level: Level): void {
    this.arr = arr; this.level = level;
    this.root.innerHTML = '';
    this.noteEls.clear(); this.barEls = []; this.activeNotes.clear(); this.activeBar = -1;
    const bpb = arr.beatsPerBar;
    const hasLH = level.notes.some((n) => n.hand === 'lh');
    const barsPerRow = this.opts.barsPerRow;
    for (let rowStart = 0; rowStart < arr.totalBars; rowStart += barsPerRow) {
      const row = document.createElement('div');
      row.className = 'bs-row';
      for (let b = rowStart; b < Math.min(arr.totalBars, rowStart + barsPerRow); b++) {
        const barStart = b * bpb;
        const bar = document.createElement('div');
        bar.className = 'bs-bar' + (hasLH ? ' two-hands' : '');
        bar.style.setProperty('--beats', String(bpb));
        bar.dataset.bar = String(b);
        bar.addEventListener('click', (e) => {
          const rect = bar.getBoundingClientRect();
          const frac = Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width));
          const beat = barStart + Math.floor(frac * bpb * 2) / 2;
          this.onSeek?.(beat);
        });
        const num = document.createElement('div'); num.className = 'bs-num'; num.textContent = String(b + 1); bar.appendChild(num);
        const chordsRow = document.createElement('div'); chordsRow.className = 'bs-chords';
        for (const c of level.chords) {
          const cs = c.startBeat;
          const inBar = cs >= barStart && cs < barStart + bpb;
          const continues = b === 0 ? false : cs < barStart && cs + c.durationBeats > barStart && Math.abs(cs % bpb) > 1e-6 && false;
          if (!inBar && !continues) continue;
          const el = document.createElement('span'); el.className = 'bs-chord';
          el.style.left = `${((cs - barStart) / bpb) * 100}%`;
          el.textContent = c.name;
          el.title = `${c.name}: ${c.pitches.map((p) => noteName(p, level.key.useFlats)).join(' ')} · click for why`;
          el.addEventListener('click', (e) => { e.stopPropagation(); this.onChordClick?.(c, b, e.clientX, e.clientY); });
          chordsRow.appendChild(el);
        }
        bar.appendChild(chordsRow);
        const grid = document.createElement('div'); grid.className = 'bs-grid';
        for (let i = 0; i < bpb; i++) { const g = document.createElement('div'); g.className = 'bs-beat'; grid.appendChild(g); }
        bar.appendChild(grid);
        for (const hand of hasLH ? (['rh', 'lh'] as const) : (['rh'] as const)) {
          const lane = document.createElement('div'); lane.className = `bs-lane ${hand}`;
          const laneNotes = level.notes.filter((n) => n.hand === hand && n.startBeat >= barStart && n.startBeat < barStart + bpb);
          // Stack simultaneous notes (chords) vertically.
          const groups = new Map<number, Note[]>();
          for (const n of laneNotes) { const k = Math.round(n.startBeat * 64); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(n); }
          for (const g of groups.values()) {
            g.sort((a, b) => b.midi - a.midi);
            g.forEach((n, i) => {
              const el = document.createElement('div');
              el.className = 'bs-note' + (g.length > 1 ? ' stacked' : '') + (this.opts.highlightNew && n.isNew ? ' new' : '');
              el.style.left = `${((n.startBeat - barStart) / bpb) * 100}%`;
              el.style.width = `calc(${(Math.min(n.durationBeats, barStart + bpb - n.startBeat) / bpb) * 100}% - 3px)`;
              el.style.setProperty('--c', PC_COLORS[pitchClass(n.midi)]);
              if (g.length > 1) { el.style.top = `${(i / g.length) * 100}%`; el.style.height = `${100 / g.length}%`; }
              const acc = n.letter.slice(1);
              el.innerHTML = (this.opts.showLetters ? `<span class="bs-letter">${n.letter[0]}${acc ? `<sup>${acc === '#' ? '♯' : '♭'}</sup>` : ''}${this.opts.showOctaves ? `<sub>${n.octave}</sub>` : ''}</span>` : '') +
                (this.opts.showFingers && n.finger && g.length === 1 ? `<span class="bs-finger">${n.finger}</span>` : '');
              el.title = `${n.letter}${n.octave} · ${hand === 'rh' ? 'right' : 'left'} hand · ${n.durationBeats} beat${n.durationBeats === 1 ? '' : 's'}${n.finger ? ` · finger ${n.finger}` : ''}`;
              lane.appendChild(el);
              this.noteEls.set(n, el);
            });
          }
          bar.appendChild(lane);
        }
        row.appendChild(bar);
        this.barEls[b] = bar;
      }
      this.root.appendChild(row);
    }
    this.cursor = document.createElement('div'); this.cursor.className = 'bs-cursor'; this.root.appendChild(this.cursor);
    this.paintBarScores();
  }

  /** Heat per bar from saved progress: 0..1 quality, absent = not yet played. */
  setBarScores(scores: Map<number, number>): void {
    this.barScores = scores;
    this.paintBarScores();
  }

  private paintBarScores(): void {
    this.barEls.forEach((el, i) => {
      const q = this.barScores.get(i);
      const num = el.querySelector<HTMLElement>('.bs-num');
      if (!num) return;
      num.classList.remove('good', 'warn', 'bad');
      if (q === undefined) { num.title = ''; return; }
      num.classList.add(q >= 0.9 ? 'good' : q >= 0.7 ? 'warn' : 'bad');
      num.title = `${Math.round(q * 100)}% clean in your recent attempts`;
    });
  }

  setPosition(beat: number): void {
    if (!this.arr || !this.level) return;
    const bar = Math.floor(beat / this.arr.beatsPerBar);
    if (bar !== this.activeBar) {
      this.barEls[this.activeBar]?.classList.remove('active');
      this.activeBar = bar;
      const el = this.barEls[bar];
      if (el) {
        el.classList.add('active');
        const rowTop = el.parentElement!.offsetTop;
        const c = this.container;
        if (rowTop < c.scrollTop || rowTop + el.parentElement!.offsetHeight > c.scrollTop + c.clientHeight) c.scrollTo({ top: rowTop - 8, behavior: 'smooth' });
      }
    }
    for (const el of this.activeNotes) el.classList.remove('active');
    this.activeNotes.clear();
    for (const [n, el] of this.noteEls) {
      if (beat >= n.startBeat - 1e-3 && beat < n.startBeat + n.durationBeats) { el.classList.add('active'); this.activeNotes.add(el); }
    }
    const barEl = this.barEls[bar];
    if (this.cursor && barEl) {
      const frac = (beat - bar * this.arr.beatsPerBar) / this.arr.beatsPerBar;
      const row = barEl.parentElement!;
      this.cursor.style.display = 'block';
      this.cursor.style.left = `${barEl.offsetLeft + frac * barEl.offsetWidth}px`;
      this.cursor.style.top = `${row.offsetTop}px`;
      this.cursor.style.height = `${row.offsetHeight}px`;
    }
  }

  setRequired(notes: Note[] | null): void {
    this.root.querySelectorAll('.bs-note.required').forEach((e) => e.classList.remove('required'));
    for (const n of notes ?? []) this.noteEls.get(n)?.classList.add('required');
  }

  highlightBars(startBar: number, endBar: number, on: boolean): void {
    this.barEls.forEach((el, i) => el.classList.toggle('looped', on && i >= startBar && i <= endBar));
  }
}

function noteName(midi: number, useFlats: boolean): string {
  const names = useFlats ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
