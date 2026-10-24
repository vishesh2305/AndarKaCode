import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { computeDHash, hammingDistance } from "../src/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(__dirname, "../../samples");

describe("hammingDistance: count differing bits between 64-bit hex hashes", () => {
  it("returns 0 for identical hex strings", () => {
    assert.equal(hammingDistance("0123456789abcdef", "0123456789abcdef"), 0);
    assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
    assert.equal(hammingDistance("ffffffffffffffff", "ffffffffffffffff"), 0);
  });

  it("counts differing bits correctly", () => {
    assert.equal(hammingDistance("0000000000000000", "0000000000000001"), 1);
    assert.equal(hammingDistance("0000000000000000", "0000000000000003"), 2);
    assert.equal(hammingDistance("0000000000000003", "0000000000000005"), 2); // 0011 vs 0101
    assert.equal(hammingDistance("0000000000000000", "ffffffffffffffff"), 64);
    assert.equal(hammingDistance("0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f0"), 64);
  });

  it("handles case-insensitivity in hex strings", () => {
    assert.equal(hammingDistance("A1B2C3D4E5F60718", "a1b2c3d4e5f60718"), 0);
  });

  it("throws TypeError for non-string inputs", () => {
    assert.throws(() => hammingDistance(null, "0123456789abcdef"), { name: "TypeError" });
    assert.throws(() => hammingDistance("0123456789abcdef", undefined), { name: "TypeError" });
    assert.throws(() => hammingDistance(12345, "0123456789abcdef"), { name: "TypeError" });
  });

  it("throws Error for strings with invalid length or non-hex characters", () => {
    assert.throws(() => hammingDistance("123", "0123456789abcdef"), /16-character hex/);
    assert.throws(() => hammingDistance("0123456789abcdef0", "0123456789abcdef"), /16-character hex/);
    assert.throws(() => hammingDistance("zzzzzzzzzzzzzzzz", "0123456789abcdef"), /hex/);
  });
});

describe("computeDHash: 64-bit perceptual difference hash", () => {
  it("returns a 16-character hex string for an image buffer", async () => {
    const img = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 128, g: 128, b: 128 } }
    }).png().toBuffer();

    const hash = await computeDHash(img);
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  it("returns distance 0 for identical images", async () => {
    const img = await readFile(path.join(SAMPLES, "employees.png"));
    const hash1 = await computeDHash(img);
    const hash2 = await computeDHash(img);
    assert.equal(hammingDistance(hash1, hash2), 0);
  });

  it("returns distance <= 6 for slight image modifications", async () => {
    const original = await readFile(path.join(SAMPLES, "employees.png"));
    // Add a tiny subtle 2x2 square in one corner of the 1200+ px image
    const modified = await sharp(original)
      .composite([{
        input: Buffer.from('<svg><rect width="2" height="2" fill="red"/></svg>'),
        top: 0,
        left: 0
      }])
      .png()
      .toBuffer();

    const hash1 = await computeDHash(original);
    const hash2 = await computeDHash(modified);
    const dist = hammingDistance(hash1, hash2);
    assert.ok(dist <= 6, `Expected distance <= 6 for slight change, got ${dist}`);
  });

  it("returns distance > 15 for completely different images", async () => {
    // A horizontal gradient (each pixel x+1 > pixel x everywhere)
    // vs a vertical gradient (horizontal pixels are identical, pixel x+1 == pixel x)
    const img1 = await readFile(path.join(SAMPLES, "employees.png"));
    const img2 = await readFile(path.join(SAMPLES, "mocks/m4-login.png"));

    const hash1 = await computeDHash(img1);
    const hash2 = await computeDHash(img2);
    const dist = hammingDistance(hash1, hash2);
    assert.ok(dist > 15, `Expected distance > 15 for completely different images, got ${dist}`);
  });

  it("throws TypeError for invalid / missing buffer", async () => {
    await assert.rejects(() => computeDHash(null), { name: "TypeError" });
    await assert.rejects(() => computeDHash(undefined), { name: "TypeError" });
    await assert.rejects(() => computeDHash("not a buffer"), { name: "TypeError" });
  });

  it("throws Error for unreadable / non-image buffer", async () => {
    await assert.rejects(() => computeDHash(Buffer.from("hello world not an image")));
  });
});
