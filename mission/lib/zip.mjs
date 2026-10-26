// Gzip for the server's answers (R7 #1: every byte counts on a gallery's Wi-Fi), without blocking the event loop (CR7 #12):
// gzipSync on every answer held the server for each static file and for the 481 KB LED map, on every ask. Now
//   - a static file is compressed once per key (its path and ETag): the next ask gets the same bytes, at once;
//   - a small answer (under SMALL) is compressed at once: well under a millisecond;
//   - a big answer is compressed off the event loop (zlib's thread pool), and the last few big ones are kept by content, so the
//     same LED map asked by the next phone is not compressed again.
// zip(data, key?) -> Buffer (at once: small, or from a cache) | Promise<Buffer>. Never throws for a cache's sake.
import { gzip, gzipSync } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
export const SMALL = 64 * 1024;
const same = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a === b : Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length === b.length && a.equals(b));

export class Zipper {
  constructor({ files = 64, bodies = 4 } = {}) {
    this.maxFiles = files;
    this.maxBodies = bodies;
    this.files = new Map();        // key -> gzipped Buffer, oldest first (a Map keeps insertion order)
    this.bodies = [];              // [{ data, z }], newest last: big answers by content
  }

  /** data: a string or a Buffer; key: a static file's path and ETag (its bytes never change under one key), else null. */
  zip(data, key = null) {
    if (key != null) {
      const hit = this.files.get(key);
      if (hit) { this.files.delete(key); this.files.set(key, hit); return hit; }      // most recently used last
      const keep = (z) => { this.files.set(key, z); while (this.files.size > this.maxFiles) this.files.delete(this.files.keys().next().value); return z; };
      return Buffer.byteLength(data) < SMALL ? keep(gzipSync(data)) : gzipAsync(data).then(keep);
    }
    if (Buffer.byteLength(data) < SMALL) return gzipSync(data);
    const hit = this.bodies.find((b) => same(b.data, data));
    if (hit) return hit.z;
    return gzipAsync(data).then((z) => {
      this.bodies.push({ data, z });
      if (this.bodies.length > this.maxBodies) this.bodies.shift();
      return z;
    });
  }
}
