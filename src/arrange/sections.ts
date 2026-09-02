import type { Note, Section } from '../types';

function barHash(notes: Note[], barStart: number, beatsPerBar: number): string {
  return notes
    .filter((n) => n.startBeat >= barStart && n.startBeat < barStart + beatsPerBar)
    .map((n) => `${n.hand}${n.midi}@${Math.round((n.startBeat - barStart) * 4)}`)
    .join('|');
}

/**
 * Split the piece into sections of `barsPerSection` bars and detect exact repeats
 * by hashing bar contents, so the how-to-play steps can say "same as bars 1–4".
 */
export function detectSections(notes: Note[], totalBars: number, beatsPerBar: number, barsPerSection = 4): Section[] {
  const sections: Section[] = [];
  const hashes: string[] = [];
  let label = 0;
  for (let start = 0; start < totalBars; start += barsPerSection) {
    const end = Math.min(totalBars - 1, start + barsPerSection - 1);
    const hash = Array.from({ length: end - start + 1 }, (_, i) => barHash(notes, (start + i) * beatsPerBar, beatsPerBar)).join('//');
    const index = sections.length;
    const repeatOf = hash.replace(/\|/g, '').length > 0 ? hashes.indexOf(hash) : -1;
    hashes.push(hash);
    if (repeatOf >= 0) {
      sections.push({ index, startBar: start, endBar: end, label: sections[repeatOf].label, repeatOf });
    } else {
      sections.push({ index, startBar: start, endBar: end, label: String.fromCharCode(65 + (label++ % 26)) });
    }
  }
  return sections;
}
