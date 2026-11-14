// Reads the text files out of a .zip, with no library: the browser's own
// DecompressionStream does the inflating (iOS Safari 16.4+, every current
// desktop browser, Node 18+). Built for Letterboxd's data export (2026-11-14,
// "It'll be cool if a new user could import their letterbox data"), which
// arrives as a zip a phone can't conveniently unpack — so the import takes the
// zip as it comes.
//
// Only what an export needs: stored (0) and deflate (8) entries, no zip64, no
// encryption. Anything else is skipped, not thrown, so one odd file can't sink
// the rest.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const findEndOfCentralDirectory = (view) => {
  // The record is 22 bytes plus a comment of up to 65,535.
  const last = view.byteLength - 22;
  const first = Math.max(0, last - 65535);
  for (let offset = last; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
};

const inflateRaw = async (bytes) => {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
};

export const isZip = (buffer) => {
  const view = new DataView(buffer);
  return view.byteLength >= 4 && view.getUint32(0, true) === LOCAL_SIGNATURE;
};

/**
 * The entries of a zip as { name, text }, for every entry `wanted(name)`
 * accepts (default: all). `name` is the full path inside the zip.
 */
export async function readZipTextFiles (buffer, wanted = () => true) {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error("That file isn't a zip we can read.");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');
  const files = [];

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    const encrypted = flags & 1;
    if (encrypted || name.endsWith('/') || !wanted(name)) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = new Uint8Array(buffer, dataStart, compressedSize);

    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) bytes = await inflateRaw(data);
    else continue;
    files.push({ name, text: decoder.decode(bytes) });
  }
  return files;
}
