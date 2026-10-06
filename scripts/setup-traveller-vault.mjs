import {createRequire} from 'node:module';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const {createClient}=require('@supabase/supabase-js');
process.loadEnvFile('.env');
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_STORAGE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const name='traveller-private-data';
const existing=await client.storage.getBucket(name);
if(existing.data){if(existing.data.public)throw new Error('Traveler data bucket must be private');console.log('Private traveler data bucket already exists.');}
else {const {error}=await client.storage.createBucket(name,{public:false,fileSizeLimit:4096,allowedMimeTypes:['application/octet-stream']});if(error)throw new Error('Private traveler data bucket could not be created');console.log('Private encrypted traveler data bucket created.');}
