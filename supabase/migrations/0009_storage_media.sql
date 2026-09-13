-- Media storage — a public-read bucket for admin-uploaded images (event photos,
-- business-directory logos). Uploads/deletes go ONLY through /api/admin/media,
-- which uses the service-role key; storage.objects keeps RLS enabled with NO
-- policies, so anon/authenticated clients can neither write nor list. Public
-- reads use /storage/v1/object/public/media/<name>, which a public bucket
-- serves without consulting RLS. The size and MIME limits below are enforced
-- server-side by the Storage service itself (belt and braces on top of the
-- checks in functions/api/admin/media.js).
-- Apply by pasting into the Supabase SQL editor, in filename order (see SETUP.md).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public            = true,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
