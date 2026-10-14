// LET'S DANCE!, or strike a pose (docs/superpowers/specs/2026-10-14-dance-or-pose-design.md §1).

/** Solo poses that do not need the whole face. */
export const POSES = [
  'Air guitar, as loud as it looks.',
  'Phone torch up, like the encore.',
  'Make a heart with your hands.',
  'Point at the stage like it owes you money.',
  'Side on, eyes on the stage.',
  'Your best album-cover stare.',
  'Both arms up for the chorus.',
  'Sunglasses on. Indoors. At night.',
];

export const PHOTO_SIDE = 640;       // the long side of a photo, at most
export const PHOTO_QUALITY = 0.8;    // JPEG quality
export const PHOTO_MAX = 300_000;    // bytes; the relay refuses more

/** Is what toBlob gave a JPEG? Asked for one, a browser that cannot make it gives a PNG, which the relay refuses. */
export const isJpeg = (blob) => !!blob && blob.type === 'image/jpeg';

/** Another pose, never the one shown now (`previous`, or -1 for none yet). */
export function nextPose(previous, random = Math.random) {
  const n = Math.min(POSES.length - 1, Math.floor(random() * POSES.length));
  return n === previous ? (n + 1) % POSES.length : n;
}
