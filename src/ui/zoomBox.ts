// Where the demo video stands when zoomed (detail.tsx useZoom): as large as the window allows,
// short of full screen, with the microphone below it still in view.

/** Room the video leaves to the window's edge, and below it for the microphone. */
export const ZOOM_MARGIN = 32;
export const ZOOM_BELOW = 112;

export type Box = { left: number; top: number; width: number; height: number };

/** The largest box of the video's shape in a window of `w`×`h`, centred above the microphone. */
export function zoomBox(aspect: number, w: number, h: number): Box {
  const width = Math.max(0, Math.min(w - 2 * ZOOM_MARGIN, (h - ZOOM_MARGIN - ZOOM_BELOW) * aspect));
  const height = width / aspect;
  return { left: (w - width) / 2, top: ZOOM_MARGIN + (h - ZOOM_MARGIN - ZOOM_BELOW - height) / 2, width, height };
}

/** The transform that puts a box of `to`'s place and size onto `from` (with transform-origin 0 0). */
export const onto = (from: Box, to: Box) => `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`;
