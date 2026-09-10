/** Tamaños en píxeles CSS: el espacio que comparten editor y resultados. */
export function resultPanelLayout(available: number, preferred: number | null) {
  const space = Math.max(0, available);
  const editor = Math.min(160, space * 0.55);
  const max = Math.floor(Math.min(700, space - editor));
  const min = Math.min(120, max);
  const initial = Math.min(322, Math.round(space * 0.38));
  return { min, max, height: Math.max(min, Math.min(max, preferred ?? initial)) };
}

/** El chat se superpone cuando no caben 360 px de editor y 280 px de asistente. */
export function assistantPanelLayout(width: number, sidebar: number, preferred: number | null) {
  const space = Math.max(0, width - sidebar);
  const overlay = space < 641;
  const max = Math.floor(Math.max(0, Math.min(640, overlay ? width - 40 : space - 361)));
  const min = Math.min(280, max);
  return { overlay, min, max, width: Math.max(min, Math.min(max, preferred ?? 380)) };
}
