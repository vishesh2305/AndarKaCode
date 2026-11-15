// Step 33a: packs a generated app's files as a tar (ustar), to copy them into its sandbox through
// `docker exec -i ... tar -x`. Written here so it works the same on Windows, macOS and Linux (no tar
// program, no AppleDouble files, no paths of this computer). node_modules is left out: the sandbox image
// has the packages.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const BLOCK = 512;

// A name over 100 characters is split at a "/" into prefix (up to 155) and name (up to 100).
function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return { prefix: "", name };
  for (let i = name.indexOf("/"); i !== -1; i = name.indexOf("/", i + 1)) {
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100 && rest) return { prefix, name: rest };
  }
  throw new Error(`The file name is too long to copy into the sandbox: ${name}`);
}

function header(name, { size, directory }) {
  const block = Buffer.alloc(BLOCK);
  const put = (text, at, length) => block.write(text, at, length, "utf8");
  const octal = (value, at, length) => put(value.toString(8).padStart(length - 1, "0"), at, length - 1);
  const parts = splitName(name);
  put(parts.name, 0, 100);
  octal(directory ? 0o755 : 0o644, 100, 8);
  octal(0, 108, 8); // uid
  octal(0, 116, 8); // gid
  octal(size, 124, 12);
  octal(0, 136, 12); // mtime: the same bytes for the same app
  put(directory ? "5" : "0", 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(parts.prefix, 345, 155);
  block.fill(32, 148, 156); // the checksum counts its own field as spaces
  const sum = block.reduce((s, b) => s + b, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return block;
}

/** The files under dir (folders first, each folder before what it holds), as a tar Buffer. */
export async function tarOf(dir, { skip = ["node_modules"] } = {}) {
  const chunks = [];
  async function add(relative) {
    const entries = (await readdir(path.join(dir, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (skip.includes(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        chunks.push(header(`${name}/`, { size: 0, directory: true }));
        await add(name);
      } else if (entry.isFile()) {
        const body = await readFile(path.join(dir, name));
        chunks.push(header(name, { size: body.length }), body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK));
      }
      // links and anything else: left out
    }
  }
  await add("");
  chunks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(chunks);
}
