'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

async function createBucket() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env');
    process.exit(1);
  }

  if (process.env.SUPABASE_SERVICE_KEY === 'your_supabase_service_role_key') {
    console.error(
      'Replace SUPABASE_SERVICE_KEY in backend/.env with your real service_role key ' +
        '(Supabase Dashboard → Project Settings → API).'
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { error } = await supabase.storage.createBucket('veriflow-uploads', {
    public: false,
    allowedMimeTypes: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ],
    fileSizeLimit: 5242880, // 5MB
  });

  if (error && !/already exists/i.test(error.message || '')) {
    console.error('Failed to create bucket:', error.message);
    process.exit(1);
  }

  console.log('Bucket veriflow-uploads ready');
}

createBucket();
