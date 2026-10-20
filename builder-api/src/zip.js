// A small zip writer (deflate, UTF-8 names) for "Download app": no extra package needed.
// Format: one local header + compressed data per file, then the central directory, then its end record.
import { crc32, deflateRawSync } from "node:zlib";

const UTF8_NAMES = 0x0800; // general-purpose flag bit 11: names are UTF-8
const DEFLATE = 8;

// A name must stay inside the folder it is extracted into.
function checkName(name) {
  const parts = name.split("/");
  if (!name || name.startsWith("/") || /^[a-zA-Z]:|\\/.test(name) || parts.some((p) => p === ".." || p === "")) {
    throw new Error(`Unsafe file name for a zip: "${name}"`);
  }
}

// MS-DOS date/time, as zip stores it.
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** entries: [{ name: "folder/file.js", data: string | Buffer }] -> Buffer of a .zip file */
export function createZip(entries, { date = new Date() } = {}) {
  const { time, day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    checkName(name);
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    const packed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra length, comment length, disk number, internal attributes: 0
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // where this file's local header starts
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
