/**
 * 力度推断与 AlphaTex 力度标记
 */
import { Dynamic } from '../types';

const SECTION_DYNAMIC: Record<string, Dynamic> = {
  'A1': Dynamic.MP, 'A2': Dynamic.MP, 'Verse': Dynamic.MP,
  'Pre': Dynamic.MF, 'PreChorus': Dynamic.MF,
  'B1': Dynamic.F, 'B2': Dynamic.F, 'Chorus': Dynamic.F,
  'C': Dynamic.FF, 'Bridge': Dynamic.FF,
  'Outro': Dynamic.MP, 'Ending': Dynamic.P,
};

export function inferDynamic(sectionName: string): Dynamic {
  if (SECTION_DYNAMIC[sectionName]) return SECTION_DYNAMIC[sectionName];
  const l = sectionName.toLowerCase();
  if (l.includes('verse') || l.startsWith('a')) return Dynamic.MP;
  if (l.includes('chorus') || l.startsWith('b')) return Dynamic.F;
  if (l.includes('bridge') || l.startsWith('c')) return Dynamic.FF;
  if (l.includes('outro') || l.includes('end')) return Dynamic.P;
  return Dynamic.MF;
}

export function dynamicToAlphaTex(d: Dynamic): string {
  return `{${d}}`;
}
