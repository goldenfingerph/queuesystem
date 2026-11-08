import fs from 'node:fs';
import path from 'node:path';

const signatures: Record<string, (header: Buffer) => boolean> = {
  '.png': (header) => header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (header) => header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
  '.jpeg': (header) => header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
  '.webp': (header) => header.length >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP',
  '.mp4': (header) => header.length >= 8 && header.toString('ascii', 4, 8) === 'ftyp',
  '.webm': (header) => header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3,
  '.ogg': (header) => header.length >= 4 && header.toString('ascii', 0, 4) === 'OggS',
};

/**
 * Checks a small file header against the expected container/image signature.
 * This is a format sanity check, not malware scanning or full media decoding.
 */
export function hasExpectedFileSignature(filePath: string, extension: string): boolean {
  const check = signatures[path.extname(extension).toLowerCase()];
  if (!check) return false;

  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    return check(header.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}
