/**
 * Turning a picked photo into something small enough to live in a database
 * column, done on the client so a 4 MB camera roll image never crosses the
 * network at all.
 */

/**
 * Matches the server's expectation of a small square. 256px covers every place
 * the picture is drawn (the largest is the Account screen at 64px, so this is
 * already 2x for a 128px-rendered future) while keeping the encoded string in
 * the tens of kilobytes.
 */
export const AVATAR_SIZE_PX = 256;

/** Quality for the JPEG re-encode. Below ~0.8 the 256px square visibly mushes. */
const AVATAR_JPEG_QUALITY = 0.85;

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('The selected file could not be read as an image'));
  image.src = src;
});

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('The selected file could not be read'));
  reader.readAsDataURL(file);
});

/**
 * Centre-crops the picked file to a square and re-encodes it at
 * `AVATAR_SIZE_PX`. Always JPEG: transparency is meaningless once the image is
 * clipped to a circle over a solid surface, and PNG would multiply the size of
 * a photograph several times over for no visible gain.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const image = await loadImage(await readFileAsDataUrl(file));

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE_PX;
  canvas.height = AVATAR_SIZE_PX;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Image processing is unavailable in this browser');
  }

  // Cover, not contain: the picture is displayed in a circle, so letterboxing
  // it would show the canvas background in the corners of that circle.
  const side = Math.min(image.width, image.height);
  context.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE_PX,
    AVATAR_SIZE_PX,
  );

  return canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY);
}
