// Step 14 piece 2: the picture fingerprint (dHash). Copies of a screenshot (resized, JPEG, wider) stay within
// NEAR bits of it; different screens are further apart. Measured on our samples: copies 2-6, different 11+.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NEAR, dHash, hammingDistance } from "../src/memory/dhash.js";

const MOCKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../samples/mocks");
const read = (file) => readFileSync(path.join(MOCKS, file));
const m7 = read("m7-custom-buttons.png");

describe("dHash: a 64-bit picture fingerprint", () => {
  it("is 16 hex digits, and the same for the same picture", async () => {
    assert.match(await dHash(m7), /^[0-9a-f]{16}$/);
    assert.equal(await dHash(m7), await dHash(Buffer.from(m7)));
  });

  it("stays within NEAR (6) bits for copies: smaller, larger, saved as JPEG", async () => {
    assert.equal(NEAR, 6);
    const { width } = await sharp(m7).metadata();
    const copies = [
      await sharp(m7).resize(Math.round(width * 0.8)).png().toBuffer(),
      await sharp(m7).resize(1600).png().toBuffer(),
      await sharp(m7).jpeg({ quality: 70 }).toBuffer(),
    ];
    for (const copy of copies) assert.ok(hammingDistance(await dHash(m7), await dHash(copy)) <= NEAR);
  });

  it("puts every pair of different sample screenshots more than NEAR bits apart", async () => {
    const files = readdirSync(MOCKS).filter((f) => f.endsWith(".png"));
    const hashes = await Promise.all(files.map((f) => dHash(read(f))));
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        assert.ok(hammingDistance(hashes[i], hashes[j]) > NEAR, `${files[i]} vs ${files[j]}`);
      }
    }
  });
});

describe("hammingDistance: how many of the 64 bits differ", () => {
  it("counts differing bits", () => {
    assert.equal(hammingDistance("0".repeat(16), "0".repeat(16)), 0);
    assert.equal(hammingDistance("0".repeat(16), "f".repeat(16)), 64);
    assert.equal(hammingDistance("0000000000000001", "0000000000000003"), 1);
  });
});
