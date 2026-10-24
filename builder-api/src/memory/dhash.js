// Step 14 piece 2: a picture fingerprint (dHash). The image is shrunk to 9x8 grey pixels; each of the 64 bits
// says whether a pixel is brighter than its right-hand neighbour. A resized or re-saved copy keeps nearly
// all bits; another screen changes many. Measured on our samples: copies 2-6 bits apart, different screens 11+.
import sharp from "sharp";

export const NEAR = 6; // at most this many differing bits = the same picture

/** The image's 64-bit dHash as 16 hex digits. */
export async function dHash(buffer) {
  const { data } = await sharp(buffer).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, "0");
}

/** How many of the 64 bits differ between two dHashes. */
export function hammingDistance(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  for (; x; x >>= 1n) count += Number(x & 1n);
  return count;
}
