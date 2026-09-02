import { Piano2D } from './fallback2d';
import { PianoScene } from './scene';
import type { PianoView } from './types';

export function createPiano(container: HTMLElement): PianoView {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) throw new Error('no webgl');
    return new PianoScene(container);
  } catch (e) {
    console.warn('WebGL unavailable, using 2D keyboard', e);
    container.querySelectorAll('canvas').forEach((c) => c.remove()); // a half-built scene may have left one behind
    return new Piano2D(container);
  }
}

export * from './types';
