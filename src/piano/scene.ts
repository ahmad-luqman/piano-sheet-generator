import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Hand, Note } from '../types';
import { keyLayout, totalWidth, WHITE_W } from './layout';
import { HAND_COLORS, STATE_COLORS, type KeyState, type PianoView } from './types';

const WHITE_LEN = 6, WHITE_H = 0.7, BLACK_LEN = 3.9, BLACK_H = 0.75;
const UNITS_PER_BEAT = 2.6;          // falling-note speed
const WINDOW_AHEAD = 7;               // beats of upcoming notes shown
const WINDOW_BEHIND = 0.5;

interface KeyObj {
  midi: number; black: boolean; pivot: THREE.Group; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial;
  base: THREE.Color; state: KeyState; hand?: Hand; hint: boolean; target: number; label?: THREE.Sprite;
}

export class PianoScene implements PianoView {
  readonly kind = '3d' as const;
  onKeyPress?: (midi: number) => void;
  onKeyRelease?: (midi: number) => void;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private keys = new Map<number, KeyObj>();
  private keyMeshes: THREE.Mesh[] = [];
  private notes: Note[] = [];
  private noteMeshes = new Map<Note, THREE.Mesh>();
  private notesGroup = new THREE.Group();
  private position = 0;
  private raf = 0;
  private ro: ResizeObserver;
  private pointerKey: number | null = null;
  private labelCache = new Map<string, THREE.Texture>();
  private showLabels = true;
  private labels = new Map<number, string>();
  private lastFrame = performance.now();
  private noteGeomCache = new Map<string, RoundedBoxGeometry>();
  private width = totalWidth();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 90;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.15;
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(this.width / 2 - 10, 20, 12);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(this.width / 2 + 20, 10, -10);
    this.scene.add(fill);

    this.buildKeys();
    this.buildBody();
    this.scene.add(this.notesGroup);
    this.resetView();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.animate();
  }

  private buildKeys(): void {
    const whiteGeo = new RoundedBoxGeometry(WHITE_W * 0.94, WHITE_H, WHITE_LEN, 2, 0.06);
    const blackGeo = new RoundedBoxGeometry(0.56, BLACK_H, BLACK_LEN, 2, 0.06);
    for (const k of keyLayout()) {
      const base = new THREE.Color(k.black ? '#151515' : '#f7f6f1');
      const mat = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: k.black ? 0.45 : 0.35, metalness: 0.05, emissive: new THREE.Color(0x000000) });
      const mesh = new THREE.Mesh(k.black ? blackGeo : whiteGeo, mat);
      mesh.userData.midi = k.midi;
      const pivot = new THREE.Group();
      // Pivot at the back edge so the key rotates like a real lever.
      pivot.position.set(k.x + k.width / 2, k.black ? WHITE_H + BLACK_H / 2 - 0.15 : WHITE_H / 2, -WHITE_LEN / 2);
      mesh.position.set(0, 0, k.black ? BLACK_LEN / 2 : WHITE_LEN / 2);
      pivot.add(mesh);
      this.scene.add(pivot);
      this.keyMeshes.push(mesh);
      this.keys.set(k.midi, { midi: k.midi, black: k.black, pivot, mesh, mat, base, state: 'off', hint: false, target: 0 });
    }
  }

  private buildBody(): void {
    const w = this.width;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w + 2.4, 1.6, WHITE_LEN + 2.2), new THREE.MeshStandardMaterial({ color: '#2a2320', roughness: 0.6 }));
    body.position.set(w / 2, -0.5, -0.6);
    this.scene.add(body);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w + 2.4, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: '#3a302b', roughness: 0.5 }));
    rail.position.set(w / 2, 0.9, -WHITE_LEN / 2 - 0.8);
    this.scene.add(rail);
    // Faint falling-note backdrop with beat lines.
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 2.4, WINDOW_AHEAD * UNITS_PER_BEAT + 2), new THREE.MeshBasicMaterial({ color: '#0b1020', transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    back.position.set(w / 2, (WINDOW_AHEAD * UNITS_PER_BEAT + 2) / 2 + 1.0, -WHITE_LEN / 2 - 1.5);
    this.scene.add(back);
    const hitLine = new THREE.Mesh(new THREE.BoxGeometry(w + 2.4, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: '#94a3b8' }));
    hitLine.position.set(w / 2, 1.5, -WHITE_LEN / 2 - 1.45);
    this.scene.add(hitLine);
    // Middle C marker.
    const c4 = this.keys.get(60)!;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: '#e11d48' }));
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(c4.pivot.position.x, WHITE_H + 0.01, WHITE_LEN / 2 - 0.9);
    this.scene.add(dot);
  }

  private focus: { low: number; high: number } = { low: 21, high: 108 };

  setFocusRange(lowMidi: number, highMidi: number): void {
    // Show at least two and a half octaves, centred on the notes actually used.
    let low = Math.max(21, lowMidi - 3), high = Math.min(108, highMidi + 3);
    const minSpan = 30;
    if (high - low < minSpan) { const mid = (low + high) / 2; low = Math.max(21, Math.round(mid - minSpan / 2)); high = Math.min(108, low + minSpan); low = Math.max(21, high - minSpan); }
    this.focus = { low, high };
    this.resetView();
  }

  resetView(): void {
    const kl = this.keys.get(this.focus.low) ?? this.keys.get(21);
    const kh = this.keys.get(this.focus.high) ?? this.keys.get(108);
    if (!kl || !kh) return;
    const cx = (kl.pivot.position.x + kh.pivot.position.x) / 2;
    const span = Math.max(8, kh.pivot.position.x - kl.pivot.position.x + 2);
    const dist = span / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.camera.aspect) * 1.25;
    this.camera.position.set(cx, dist * 0.8 + 3, dist * 0.9 + 4);
    this.controls.target.set(cx, 3.5, -2.5);
    this.controls.update();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setNotes(notes: Note[]): void {
    for (const m of this.noteMeshes.values()) this.notesGroup.remove(m);
    this.noteMeshes.clear();
    this.notes = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  }

  setPosition(beat: number): void {
    this.position = beat;
  }

  setKeyState(midi: number, state: KeyState, hand?: Hand): void {
    const k = this.keys.get(midi);
    if (!k) return;
    k.state = state;
    k.hand = hand;
    k.target = state === 'off' ? 0 : 0.055;
    this.applyKeyColor(k);
  }

  setHints(notes: Note[] | null): void {
    for (const k of this.keys.values()) { if (k.hint) { k.hint = false; this.applyKeyColor(k); } }
    if (!notes) return;
    for (const n of notes) { const k = this.keys.get(n.midi); if (k) { k.hint = true; k.hand = n.hand; this.applyKeyColor(k); } }
  }

  private applyKeyColor(k: KeyObj): void {
    let color: string | null = null;
    if (k.state === 'wrong') color = STATE_COLORS.wrong;
    else if (k.state === 'user') color = STATE_COLORS.user;
    else if (k.state === 'playback') color = HAND_COLORS[k.hand ?? 'rh'];
    else if (k.hint) color = k.hand ? HAND_COLORS[k.hand] : STATE_COLORS.hint;
    if (color) {
      k.mat.color.set(color);
      k.mat.emissive.set(color);
      k.mat.emissiveIntensity = k.hint && k.state === 'off' ? 0.35 : 0.6;
    } else {
      k.mat.color.copy(k.base);
      k.mat.emissive.set(0x000000);
      k.mat.emissiveIntensity = 0;
    }
  }

  setKeyLabels(labels: Map<number, string>): void {
    this.labels = labels;
    this.rebuildKeyLabels();
  }
  setShowLabels(on: boolean): void { this.showLabels = on; this.rebuildKeyLabels(); }

  private rebuildKeyLabels(): void {
    for (const k of this.keys.values()) {
      if (k.label) { k.pivot.remove(k.label); k.label = undefined; }
      const text = this.labels.get(k.midi);
      if (!text || !this.showLabels) continue;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTexture(text, k.black ? '#ffffff' : '#334155', k.black ? '#333333' : '#e2e8f0'), depthTest: false }));
      sprite.scale.set(0.7, 0.7, 1);
      sprite.position.set(0, k.black ? BLACK_H / 2 + 0.3 : WHITE_H / 2 + 0.3, k.black ? BLACK_LEN - 0.6 : WHITE_LEN - 0.7);
      k.pivot.add(sprite);
      k.label = sprite;
    }
  }

  private labelTexture(text: string, fg: string, bg: string): THREE.Texture {
    const key = `${text}|${fg}|${bg}`;
    const cached = this.labelCache.get(key);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(48, 48, 44, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = `bold ${text.length > 2 ? 34 : 48}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 48, 52);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.labelCache.set(key, tex);
    return tex;
  }

  private noteGeom(w: number, h: number): RoundedBoxGeometry {
    const key = `${w.toFixed(2)}|${h.toFixed(2)}`;
    let g = this.noteGeomCache.get(key);
    if (!g) { g = new RoundedBoxGeometry(w, h, 0.35, 2, 0.1); this.noteGeomCache.set(key, g); }
    return g;
  }

  private updateFallingNotes(): void {
    const pos = this.position;
    const lo = pos - WINDOW_BEHIND, hi = pos + WINDOW_AHEAD;
    const visible = new Set<Note>();
    for (const n of this.notes) {
      if (n.startBeat > hi) break;
      if (n.startBeat + n.durationBeats < lo) continue;
      visible.add(n);
      let mesh = this.noteMeshes.get(n);
      if (!mesh) {
        const k = this.keys.get(n.midi);
        if (!k) continue;
        const w = k.black ? 0.5 : WHITE_W * 0.86;
        const h = Math.max(0.35, n.durationBeats * UNITS_PER_BEAT - 0.12);
        const color = HAND_COLORS[n.hand];
        mesh = new THREE.Mesh(this.noteGeom(w, h), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
        mesh.position.x = k.pivot.position.x;
        mesh.position.z = -WHITE_LEN / 2 - 1.2 + (k.black ? 0.25 : 0);
        mesh.userData.h = h;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTexture(n.letter, '#ffffff', color), depthTest: false }));
        label.scale.set(0.62, 0.62, 1);
        label.position.set(0, -h / 2 + 0.4, 0.3);
        mesh.add(label);
        this.notesGroup.add(mesh);
        this.noteMeshes.set(n, mesh);
      }
      const h = mesh.userData.h as number;
      mesh.position.y = 1.5 + (n.startBeat - pos) * UNITS_PER_BEAT + h / 2 + 0.06;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const sounding = pos >= n.startBeat && pos < n.startBeat + n.durationBeats;
      mat.emissiveIntensity = sounding ? 0.9 : 0.35;
      mat.opacity = 1;
    }
    for (const [n, mesh] of this.noteMeshes) {
      if (!visible.has(n)) { this.notesGroup.remove(mesh); this.noteMeshes.delete(n); }
    }
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const t = now / 1000;
    for (const k of this.keys.values()) {
      const cur = k.pivot.rotation.x;
      k.pivot.rotation.x += (k.target - cur) * Math.min(1, dt * 25);
      if (k.hint && k.state === 'off') k.mat.emissiveIntensity = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 6));
    }
    this.updateFallingNotes();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private raycaster = new THREE.Raycaster();
  private keyAt(e: PointerEvent): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.keyMeshes, false);
    return hits.length ? (hits[0].object.userData.midi as number) : null;
  }
  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const midi = this.keyAt(e);
    if (midi === null) return;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pointerKey = midi;
    this.onKeyPress?.(midi);
  };
  private onPointerMove = (e: PointerEvent) => {
    if (this.pointerKey === null) return;
    const midi = this.keyAt(e);
    if (midi !== null && midi !== this.pointerKey) {
      this.onKeyRelease?.(this.pointerKey);
      this.pointerKey = midi;
      this.onKeyPress?.(midi);
    }
  };
  private onPointerUp = () => {
    if (this.pointerKey === null) return;
    this.onKeyRelease?.(this.pointerKey);
    this.pointerKey = null;
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
