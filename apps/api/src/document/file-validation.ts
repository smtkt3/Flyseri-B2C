import { createHash } from 'node:crypto';
import { ApiException } from '../api-exception.js';

export interface UploadFile { buffer: Buffer; size: number; originalname: string; mimetype: string }
export interface ValidatedUpload { bytes: Buffer; size: number; filename: string; mimeType: string; extension: string; checksumSha256: string }
const formats = [
  { mime: 'application/pdf', extensions: ['pdf'], signature: (bytes: Buffer) => bytes.subarray(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], signature: (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: 'image/png', extensions: ['png'], signature: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
];
const invalid = () => new ApiException('VALIDATION_ERROR', 'Choose a PDF, JPG or PNG file and try again.', 400);
export function validateUpload(file: UploadFile | undefined, maxMb: number): ValidatedUpload {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer) || file.size < 1 || file.size !== file.buffer.length || file.size > maxMb * 1024 * 1024) {
    throw new ApiException('VALIDATION_ERROR', `Choose a file up to ${maxMb} MB.`, 400);
  }
  const basename = file.originalname.replace(/\\/g, '/').split('/').pop() ?? '';
  const filename = basename.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 180);
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const format = formats.find((item) => item.mime === file.mimetype && item.extensions.includes(extension));
  if (!filename || !format || !format.signature(file.buffer)) throw invalid();
  return { bytes: file.buffer, size: file.size, filename, mimeType: format.mime, extension, checksumSha256: createHash('sha256').update(file.buffer).digest('hex') };
}
