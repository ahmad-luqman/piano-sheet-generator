import type { Hand, Note } from '../types';
import { keyLayout, totalWidth, type KeyGeom } from './layout';
import { HAND_COLORS, STATE_COLORS, type KeyState, type PianoView } from './types';

/** Canvas-2D keyboard used when WebGL is unavailable. Same behaviour, flat look. */
export class Piano2D implements PianoView {
  readonly kind = '2d' as const;
  onKeyPress?: (midi: number) => void;
  onKeyRelease?: (midi: number) => void;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private keys = keyLayout();
  private state = new Map<number, { state: KeyState; hand?: Hand }>();
  private hints = new Set<number>();
  private hintHands = new Map<number, Hand>();
  private labels = new Map<number, string>();
  private showLabels = true;
  private notes: Note[] = [];
  private position = 0;
  private raf = 0;
  private ro: ResizeObserver;
  private pointerKey: number | null = null;

  constructor(private container: HTMLElement) {
    container.appendChild(this.canvas);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%'; this.canvas.style.touchAction = 'none';
    this.ctx = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointerleave', this.onUp);
    this.draw();
  }
  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.container.clientWidth * dpr;
    this.canvas.height = this.container.clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setNotes(notes: Note[]): void { this.notes = [...notes].sort((a, b) => a.startBeat - b.startBeat); }
  setPosition(beat: number): void { this.position = beat; }
  setKeyState(midi: number, state: KeyState, hand?: Hand): void { this.state.set(midi, { state, hand }); }
  setHints(notes: Note[] | null): void {
    this.hints.clear(); this.hintHands.clear();
    for (const n of notes ?? []) { this.hints.add(n.midi); this.hintHands.set(n.midi, n.hand); }
  }
  setKeyLabels(labels: Map<number, string>): void { this.labels = labels; }
  setShowLabels(on: boolean): void { this.showLabels = on; }
  resetView(): void {}

  private geom() {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const keyH = Math.min(H * 0.42, 140);
    const scale = W / totalWidth();
    return { W, H, keyH, scale, top: H - keyH };
  }
  private keyRect(k: KeyGeom) {
    const g = this.geom();
    const x = k.x * g.scale, w = k.width * g.scale;
    return k.black ? { x, y: g.top, w, h: g.keyH * 0.62 } : { x, y: g.top, w, h: g.keyH };
  }
  private colorFor(midi: number, black: boolean): string {
    const s = this.state.get(midi);
    if (s?.state === 'wrong') return STATE_COLORS.wrong;
    if (s?.state === 'user') return STATE_COLORS.user;
    if (s?.state === 'playback') return HAND_COLORS[s.hand ?? 'rh'];
    if (this.hints.has(midi)) return HAND_COLORS[this.hintHands.get(midi) ?? 'rh'];
    return black ? '#151515' : '#f7f6f1';
  }
  private draw = (): void => {
    this.raf = requestAnimationFrame(this.draw);
    const { W, H, keyH, scale, top } = this.geom();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, W, top);
    const upb = top / 7; // pixels per beat
    for (const n of this.notes) {
      if (n.startBeat > this.position + 7) break;
      if (n.startBeat + n.durationBeats < this.position) continue;
      const k = this.keys[n.midi - 21]; if (!k) continue;
      const x = k.x * scale, w = k.width * scale;
      const y1 = top - (n.startBeat + n.durationBeats - this.position) * upb;
      const y2 = top - (n.startBeat - this.position) * upb;
      ctx.fillStyle = HAND_COLORS[n.hand];
      ctx.globalAlpha = 0.9;
      roundRect(ctx, x + 1, Math.max(0, y1), w - 2, Math.min(y2, top) - Math.max(0, y1) - 2, 4); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = `${Math.max(9, w * 0.5)}px system-ui`; ctx.textAlign = 'center';
      ctx.fillText(n.letter, x + w / 2, Math.min(y2, top) - 6);
    }
    for (const k of this.keys.filter((k) => !k.black)) {
      const r = this.keyRect(k);
      ctx.fillStyle = this.colorFor(k.midi, false);
      roundRect(ctx, r.x + 1, r.y, r.w - 2, r.h, 4); ctx.fill();
      if (k.midi === 60) { ctx.fillStyle = '#e11d48'; ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h - 12, 3, 0, 7); ctx.fill(); }
    }
    for (const k of this.keys.filter((k) => k.black)) {
      const r = this.keyRect(k);
      ctx.fillStyle = this.colorFor(k.midi, true);
      roundRect(ctx, r.x, r.y, r.w, r.h, 3); ctx.fill();
    }
    if (this.showLabels) {
      ctx.font = `bold ${Math.max(9, scale * 0.4)}px system-ui`; ctx.textAlign = 'center';
      for (const k of this.keys) {
        const l = this.labels.get(k.midi); if (!l) continue;
        const r = this.keyRect(k);
        ctx.fillStyle = k.black ? '#fff' : '#334155';
        ctx.fillText(l, r.x + r.w / 2, r.y + r.h - (k.black ? 8 : keyH * 0.3));
      }
    }
  };
  private keyAt(e: PointerEvent): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    for (const k of this.keys.filter((k) => k.black)) { const r = this.keyRect(k); if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return k.midi; }
    for (const k of this.keys.filter((k) => !k.black)) { const r = this.keyRect(k); if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return k.midi; }
    return null;
  }
  private onDown = (e: PointerEvent) => { const m = this.keyAt(e); if (m === null) return; this.pointerKey = m; this.onKeyPress?.(m); };
  private onMove = (e: PointerEvent) => { if (this.pointerKey === null) return; const m = this.keyAt(e); if (m !== null && m !== this.pointerKey) { this.onKeyRelease?.(this.pointerKey); this.pointerKey = m; this.onKeyPress?.(m); } };
  private onUp = () => { if (this.pointerKey === null) return; this.onKeyRelease?.(this.pointerKey); this.pointerKey = null; };
  dispose(): void { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.canvas.remove(); }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (h <= 0 || w <= 0) return;
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
