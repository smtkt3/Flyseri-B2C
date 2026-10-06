import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { parseConfig } from '@flyseri/config';

const config = parseConfig(process.env);
if (!config.SUPABASE_URL || !config.SUPABASE_STORAGE_SECRET_KEY) throw new Error('Supabase Storage server configuration is required');
const client = createClient(config.SUPABASE_URL, config.SUPABASE_STORAGE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const existing = await client.storage.getBucket(config.DOCUMENT_BUCKET);
if (existing.data) {
  if (existing.data.public) throw new Error('Document bucket is public; make it private before continuing');
  process.stdout.write('Private document bucket already exists\n');
} else {
  const { error } = await client.storage.createBucket(config.DOCUMENT_BUCKET, {
    public: false,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    fileSizeLimit: config.DOCUMENT_MAX_UPLOAD_MB * 1024 * 1024,
  });
  if (error) throw new Error('Could not create the private document bucket');
  process.stdout.write('Private document bucket created\n');
}
