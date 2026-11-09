import fs from 'node:fs';

export type UploadKind = 'image' | 'video';

/**
 * Check the actual file header after Multer has written the upload.
 * The browser-provided MIME type and original filename are not trustworthy.
 */
export function hasSupportedFileSignature(filePath: string, kind: UploadKind, extension: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(16);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (kind === 'image') {
    if (extension === '.png') {
      return bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (extension === '.jpg' || extension === '.jpeg') {
      return bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }
    if (extension === '.webp') {
      return bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' &&
        header.toString('ascii', 8, 12) === 'WEBP';
    }
    return false;
  }

  if (extension === '.mp4') {
    return bytesRead >= 12 && header.toString('ascii', 4, 8) === 'ftyp';
  }
  if (extension === '.webm') {
    return bytesRead >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  if (extension === '.ogg') {
    return bytesRead >= 4 && header.toString('ascii', 0, 4) === 'OggS';
  }
  return false;
}
