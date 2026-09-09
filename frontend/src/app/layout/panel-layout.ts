/** Tamaños en píxeles CSS: el espacio que comparten editor y resultados. */
export function resultPanelLayout(available: number, preferred: number | null) {
  const space = Math.max(0, available);
  const editor = Math.min(160, space * 0.55);
  const max = Math.floor(Math.min(700, space - editor));
  const min = Math.min(120, max);
  const initial = Math.min(322, Math.round(space * 0.38));
  return { min, max, height: Math.max(min, Math.min(max, preferred ?? initial)) };
}
