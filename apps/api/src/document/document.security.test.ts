import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '@flyseri/config';
import { createDocumentStorage } from './storage.js';
import { validateUpload } from './file-validation.js';

const bucket = vi.hoisted(() => ({
  getBucket: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: { getBucket: bucket.getBucket, from: () => ({ upload: bucket.upload, remove: bucket.remove, createSignedUrl: bucket.createSignedUrl }) } }) }));

const config = parseConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_STORAGE_SECRET_KEY: 'sb_secret_test_server_only_key' });
describe('private document storage and file validation', () => {
  it('refuses to operate on a public bucket', async () => {
    bucket.getBucket.mockResolvedValue({ data: { public: true }, error: null });
    const storage = createDocumentStorage(config)!;
    await expect(storage.upload('opaque/path', Buffer.from('file'), 'application/pdf')).rejects.toThrow('Private document storage unavailable');
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it('creates a short lived URL only for a private bucket', async () => {
    bucket.getBucket.mockResolvedValue({ data: { public: false }, error: null });
    bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://example.supabase.co/signed' }, error: null });
    const storage = createDocumentStorage(config)!;
    await expect(storage.signedUrl('opaque/path', 60, true)).resolves.toContain('/signed');
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('opaque/path', 60, { download: true });
  });
  it('rejects empty, oversized, mismatched and disguised file content', () => {
    expect(() => validateUpload({ buffer: Buffer.alloc(0), size: 0, originalname: 'a.pdf', mimetype: 'application/pdf' }, 1)).toThrow();
    expect(() => validateUpload({ buffer: Buffer.alloc(1024 * 1024 + 1), size: 1024 * 1024 + 1, originalname: 'a.pdf', mimetype: 'application/pdf' }, 1)).toThrow();
    expect(() => validateUpload({ buffer: Buffer.from('%PDF-'), size: 5, originalname: 'a.jpg', mimetype: 'application/pdf' }, 1)).toThrow();
    expect(() => validateUpload({ buffer: Buffer.from('not really a PDF'), size: 16, originalname: 'a.pdf', mimetype: 'application/pdf' }, 1)).toThrow();
  });
  it('keeps a safe display filename and a checksum, without using the name as a path', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const result = validateUpload({ buffer: bytes, size: bytes.length, originalname: '../../A123/passport.jpg', mimetype: 'image/jpeg' }, 1);
    expect(result.filename).toBe('passport.jpg');
    expect(result.extension).toBe('jpg');
    expect(result.checksumSha256).toHaveLength(64);
  });
});
