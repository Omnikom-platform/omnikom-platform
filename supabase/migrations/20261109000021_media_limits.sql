-- Omnikom Platform: work order 16 (hardening H0-4, row E10), migration 21. Additive to migrations 1 to 20; changes one bucket row and drops one policy.
-- Before: the media bucket had no size or type limit. upload-start checks 25 MB and the five types, but only against what the caller says, and the signed
-- upload URL it returns takes any body, so a caller that declared 1 byte of image/png could upload 1 GB of anything. Now the bucket carries the same limits as
-- upload-start (MAX_BYTES and MIMES in supabase/functions/upload-start/index.ts; the runner's derivatives are image/webp, already listed), and Storage enforces
-- both on every upload, signed URLs included.
-- Also before: the policy media_objects_insert let any signed-in member write straight into their workspace's folder, skipping upload-start and record_media.
-- Nothing uses it: the dashboard uploads only through the signed URL, which Storage writes as the service role. media_objects_read stays (createSignedUrl).
-- Tests: tenancy.test.sql T10 and T30, run-local.mjs (T30c compares these limits to upload-start's constants) and the mutants "media limits: ...".
update storage.buckets set
  file_size_limit = 26214400,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
  where id = 'media';
drop policy media_objects_insert on storage.objects;
