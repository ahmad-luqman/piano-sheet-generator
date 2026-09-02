import abcjs from 'abcjs';
import type { Arrangement, Level } from '../types';
import { toAbc } from './abc';

/** Standard notation via abcjs, with bar-level cursor and click-to-seek. */
export class AdvancedSheet {
  onSeek?: (beat: number) => void;
  private root: HTMLElement;
  private arr: Arrangement | null = null;
  private activeBar = -1;
  private abcText = '';

  constructor(private container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'adv';
    container.appendChild(this.root);
  }

  get abc(): string { return this.abcText; }

  render(arr: Arrangement, level: Level): void {
    this.arr = arr;
    this.activeBar = -1;
    this.abcText = toAbc(arr, level);
    this.root.innerHTML = '';
    const width = Math.max(500, this.container.clientWidth - 24);
    abcjs.renderAbc(this.root, this.abcText, {
      add_classes: true,
      responsive: 'resize',
      staffwidth: width,
      paddingleft: 8, paddingright: 8, paddingtop: 8,
      clickListener: (_el: unknown, _tune: unknown, classes: string) => {
        const m = /abcjs-m(\d+)/.exec(classes ?? '');
        if (m && this.arr) this.onSeek?.(parseInt(m[1], 10) * this.arr.beatsPerBar);
      },
    });
  }

  setPosition(beat: number): void {
    if (!this.arr) return;
    const bar = Math.floor(beat / this.arr.beatsPerBar);
    if (bar === this.activeBar) return;
    this.root.querySelectorAll('.adv-active').forEach((e) => e.classList.remove('adv-active'));
    this.activeBar = bar;
    const els = this.root.querySelectorAll(`.abcjs-m${bar}`);
    els.forEach((e) => e.classList.add('adv-active'));
    const first = els[0] as SVGElement | undefined;
    if (first) {
      const r = first.getBoundingClientRect(), c = this.container.getBoundingClientRect();
      if (r.top < c.top || r.bottom > c.bottom) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}
