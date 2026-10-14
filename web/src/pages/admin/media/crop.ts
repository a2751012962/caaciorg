// The canvas side of the image editor: load a picture so it can be read back,
// tell whether it has transparent pixels, and draw the chosen crop (with its
// rotation) into a new image no longer than 2000 px on its longest side and
// under the 5 MB the media library accepts.
import type { Area } from 'react-easy-crop';
import { UPLOAD_MAX_BYTES } from './upload';

export const MAX_SIDE = 2000;
const JPEG_QUALITIES = [0.85, 0.75, 0.65];

/** Why an image could not be used for editing. */
export type LoadProblem = 'tainted' | 'unreadable';
export class ImageLoadError extends Error {
  constructor(public problem: LoadProblem) {
    super(problem);
  }
}

const loadOnce = (src: string, cors: boolean) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load'));
    img.src = src;
  });

/**
 * Loads `src` so its pixels can be read. Another site's picture must be served
 * with CORS for that; when it loads only without CORS the canvas would be
 * "tainted" and could not be exported, so this rejects with 'tainted' (the
 * caller offers to keep the URL as it is). 'unreadable' = not an image at all.
 */
export async function loadEditable(src: string): Promise<HTMLImageElement> {
  const local = src.startsWith('blob:') || src.startsWith('data:');
  try {
    const img = await loadOnce(src, !local);
    if (!local) assertReadable(img);
    return img;
  } catch (e) {
    if (e instanceof ImageLoadError) throw e;
    if (local) throw new ImageLoadError('unreadable');
    // It may still be a fine picture, just from a host that does not allow
    // reading it back.
    const plain = await loadOnce(src, false).catch(() => null);
    throw new ImageLoadError(plain ? 'tainted' : 'unreadable');
  }
}

// A one-pixel read: throws SecurityError when the browser would taint the canvas.
function assertReadable(img: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  try {
    ctx.drawImage(img, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
  } catch {
    throw new ImageLoadError('tainted');
  }
}

/**
 * True when some pixel of the picture is not fully opaque (checked on a copy
 * at most 256 px across, which is plenty to notice a transparent background).
 * Such a picture is kept as PNG; anything else becomes a JPEG.
 */
export function hasTransparency(img: HTMLImageElement): boolean {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const k = Math.min(1, 256 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
  return false;
}

/** The size of a w × h box turned by `deg` degrees. */
export function rotatedSize(w: number, h: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  return {
    width: Math.abs(Math.cos(r) * w) + Math.abs(Math.sin(r) * h),
    height: Math.abs(Math.sin(r) * w) + Math.abs(Math.cos(r) * h),
  };
}

/**
 * Draws the crop into a new canvas `scale` × its pixel size (capped at
 * MAX_SIDE). `area` is react-easy-crop's croppedAreaPixels, which with a
 * rotation are measured in the turned picture's bounding box; drawing goes
 * straight from the source with one transform, so a 6000 px photo never needs
 * a second full-size canvas (phones run out of memory on those).
 */
function draw(
  img: HTMLImageElement,
  area: Area,
  rotation: number,
  opaque: boolean,
  shrink: number,
): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const box = rotatedSize(w, h, rotation);
  const s = Math.min(1, MAX_SIDE / Math.max(area.width, area.height)) * shrink;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(area.width * s));
  c.height = Math.max(1, Math.round(area.height * s));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // A JPEG has no transparency: what straightening leaves uncovered is white.
  if (opaque) {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.scale(s, s);
  ctx.translate(-area.x, -area.y);
  ctx.translate(box.width / 2, box.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.drawImage(img, 0, 0);
  return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

/**
 * The edited picture as a file the media library will take: JPEG at quality
 * 0.85 (lowered, then the picture shrunk, until it is under 5 MB), or PNG when
 * the source has transparency. Rejects with ImageLoadError('tainted') if the
 * browser refuses to export.
 */
export async function exportCrop(
  img: HTMLImageElement,
  area: Area,
  rotation: number,
  png: boolean,
): Promise<{ blob: Blob; type: 'image/jpeg' | 'image/png' }> {
  const type = png ? 'image/png' : 'image/jpeg';
  let shrink = 1;
  for (let round = 0; round < 6; round += 1) {
    let canvas: HTMLCanvasElement;
    try {
      canvas = draw(img, area, rotation, !png, shrink);
    } catch {
      throw new ImageLoadError('unreadable');
    }
    for (const q of png ? [undefined] : JPEG_QUALITIES) {
      let blob: Blob | null;
      try {
        blob = await toBlob(canvas, type, q);
      } catch {
        throw new ImageLoadError('tainted');
      }
      if (!blob) throw new ImageLoadError('unreadable');
      if (blob.size <= UPLOAD_MAX_BYTES) return { blob, type };
    }
    shrink *= 0.8;
  }
  throw new Error('too-large');
}
