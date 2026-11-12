import { open } from 'fs/promises';
import { inflateRawSync } from 'zlib';

/** What an APK says about itself, read from its binary AndroidManifest.xml. */
export interface ApkInfo {
  packageName: string;
  versionCode: number;
  versionName: string;
}

const MANIFEST = 'AndroidManifest.xml';
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

/**
 * Reads package name and version from an APK without unpacking it or calling Android tools:
 * finds AndroidManifest.xml in the zip, inflates it, and reads the <manifest> element of the
 * binary XML. Throws a plain-English Error when the file is not an APK.
 */
export async function readApkInfo(path: string): Promise<ApkInfo> {
  const xml = await readZipEntry(path, MANIFEST);
  return parseManifest(xml);
}

async function readZipEntry(path: string, wanted: string): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65_557); // end record (22 bytes) + longest comment
    if (tailLen < 22) throw new Error('This is not an APK file (not a zip archive).');
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('This is not an APK file (not a zip archive).');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset + cdSize > size) throw new Error('This APK file is damaged.');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);

    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const rawSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (name !== wanted) continue;

      if (rawSize > MAX_MANIFEST_BYTES || compSize > MAX_MANIFEST_BYTES) throw new Error('This APK file is damaged.');
      const header = Buffer.alloc(30);
      await fh.read(header, 0, 30, local);
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('This APK file is damaged.');
      const start = local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const data = Buffer.alloc(compSize);
      await fh.read(data, 0, compSize, start);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_MANIFEST_BYTES });
      throw new Error('This APK uses an unsupported compression method.');
    }
    throw new Error('This is not an Android app: it has no AndroidManifest.xml.');
  } finally {
    await fh.close();
  }
}

/** Android binary XML: a string pool, a resource-id map, then element chunks. */
export function parseManifest(buf: Buffer): ApkInfo {
  const bad = () => new Error('This APK has an unreadable AndroidManifest.xml.');
  try {
    if (buf.length < 8 || buf.readUInt16LE(0) !== 0x0003) throw bad();
    let strings: string[] = [];
    let resIds: number[] = [];
    let p = buf.readUInt16LE(2);
    while (p + 8 <= buf.length) {
      const type = buf.readUInt16LE(p);
      const headerSize = buf.readUInt16LE(p + 2);
      const size = buf.readUInt32LE(p + 4);
      if (size < 8 || p + size > buf.length) throw bad();

      if (type === 0x0001) {
        strings = readStringPool(buf, p);
      } else if (type === 0x0180) {
        resIds = [];
        for (let i = p + headerSize; i + 4 <= p + size; i += 4) resIds.push(buf.readUInt32LE(i));
      } else if (type === 0x0102) {
        const ext = p + 16;
        if (strings[buf.readUInt32LE(ext + 4)] === 'manifest') {
          const attrStart = buf.readUInt16LE(ext + 8);
          const attrSize = buf.readUInt16LE(ext + 10);
          const attrCount = buf.readUInt16LE(ext + 12);
          let packageName = '';
          let versionCode = NaN;
          let versionName = '';
          for (let i = 0; i < attrCount; i++) {
            const a = ext + attrStart + i * attrSize;
            const nameIdx = buf.readUInt32LE(a + 4);
            const raw = buf.readInt32LE(a + 8);
            const dataType = buf.readUInt8(a + 15);
            const data = buf.readUInt32LE(a + 16);
            const name = strings[nameIdx];
            const id = resIds[nameIdx];
            const text = dataType === 0x03 ? strings[data] : raw >= 0 ? strings[raw] : undefined;
            if (name === 'package') packageName = text ?? '';
            else if (id === ATTR_VERSION_CODE || name === 'versionCode') versionCode = dataType >= 0x10 && dataType <= 0x1f ? data : Number(text);
            else if (id === ATTR_VERSION_NAME || name === 'versionName') versionName = text ?? String(data);
          }
          if (!packageName || !Number.isInteger(versionCode) || versionCode <= 0) throw bad();
          return { packageName, versionCode, versionName: versionName || String(versionCode) };
        }
      }
      p += size;
    }
  } catch (err) {
    if (err instanceof RangeError) throw bad();
    throw err;
  }
  throw bad();
}

function readStringPool(buf: Buffer, start: number): string[] {
  const count = buf.readUInt32LE(start + 8);
  const utf8 = (buf.readUInt32LE(start + 16) & 0x100) !== 0;
  const stringsStart = start + buf.readUInt32LE(start + 20);
  const offsets = start + buf.readUInt16LE(start + 2);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = stringsStart + buf.readUInt32LE(offsets + i * 4);
    if (utf8) {
      // character count, then byte count; each takes 1 or 2 bytes
      p += buf[p] & 0x80 ? 2 : 1;
      let len = buf[p];
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | buf[p + 1];
        p += 2;
      } else {
        p += 1;
      }
      out.push(buf.toString('utf8', p, p + len));
    } else {
      let len = buf.readUInt16LE(p);
      p += 2;
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p);
        p += 2;
      }
      out.push(buf.toString('utf16le', p, p + len * 2));
    }
  }
  return out;
}
