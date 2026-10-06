import { createClient } from '@supabase/supabase-js';
import type { AppConfig } from '@flyseri/config';

export interface DocumentStorage {
  upload(path: string, bytes: Buffer, mimeType: string): Promise<void>;
  remove(path: string): Promise<void>;
  signedUrl(path: string, seconds: number, download: boolean): Promise<string>;
}

export interface DocumentSecurityScanner {
  scan(bytes: Buffer, mimeType: string): Promise<'CLEAN' | 'FAILED'>;
}

export function createDocumentStorage(config: AppConfig): DocumentStorage | undefined {
  if (!config.SUPABASE_URL || !config.SUPABASE_STORAGE_SECRET_KEY) return undefined;
  // This client is server-only and never receives a customer session.
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_STORAGE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const bucket = config.DOCUMENT_BUCKET;
  async function privateBucket() {
    const { data, error } = await client.storage.getBucket(bucket);
    if (error || !data || data.public) throw new Error('Private document storage unavailable');
    return client.storage.from(bucket);
  }
  return {
    async upload(path, bytes, mimeType) {
      const storage = await privateBucket();
      const { error } = await storage.upload(path, bytes, { contentType: mimeType, upsert: false, cacheControl: '0' });
      if (error) throw new Error('Document storage upload failed');
    },
    async remove(path) {
      const storage = await privateBucket();
      const { error } = await storage.remove([path]);
      if (error) throw new Error('Document storage cleanup failed');
    },
    async signedUrl(path, seconds, download) {
      const storage = await privateBucket();
      const { data, error } = await storage.createSignedUrl(path, seconds, download ? { download: true } : undefined);
      if (error || !data?.signedUrl) throw new Error('Document storage access failed');
      return data.signedUrl;
    },
  };
}
