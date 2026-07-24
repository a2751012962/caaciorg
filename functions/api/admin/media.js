// /api/admin/media  (admin only)
//   GET    — list the media library (public Supabase Storage bucket "media").
//   PUT    — upload an image (multipart form data, field "file"; ≤ 5 MB,
//            JPEG/PNG/WebP/GIF only — SVG is deliberately excluded because it
//            can carry scripts). Returns the public URL to paste into an event
//            or business-directory entry.
//   DELETE — remove a file by name.
// Every request is gated by requireAdmin. The bucket itself (created by
// migration 0009) re-enforces the size/MIME limits server-side.
import { json, bad, storage, requireAdmin } from '../_lib.js';

const BUCKET = 'media';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the bucket's file_size_limit
// MIME whitelist doubles as the extension map for stored names.
const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
// Stored names are flat (no folders); reject anything that could traverse.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1),
    100,
  );
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const st = storage(env);
    const entries = await st.list(BUCKET, { limit, offset });
    // Folder placeholders come back with a null id — real objects only.
    const rows = (Array.isArray(entries) ? entries : [])
      .filter((e) => e.id != null)
      .map((e) => ({
        name: e.name,
        size: e.metadata?.size ?? null,
        type: e.metadata?.mimetype ?? null,
        created_at: e.created_at ?? null,
        url: st.publicUrl(BUCKET, e.name),
      }));
    return json({ rows });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let form;
  try {
    form = await request.formData();
  } catch {
    return bad('Expected multipart form data.');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return bad('A file is required.');
  const ext = TYPES[file.type];
  if (!ext) return bad('Only JPEG, PNG, WebP or GIF images are allowed.');
  if (file.size > MAX_BYTES) return bad('Image is too large (max 5 MB).');

  // <timestamp>-<sanitized original name>.<ext> — unique, flat, URL-safe.
  const stem = String(file.name || 'image')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '') // drop the original extension
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  const name = `${Date.now()}-${stem || 'image'}.${ext}`;

  try {
    const st = storage(env);
    await st.upload(BUCKET, name, await file.arrayBuffer(), file.type);
    return json({
      ok: true,
      file: { name, url: st.publicUrl(BUCKET, name), size: file.size, type: file.type },
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let name = new URL(request.url).searchParams.get('name') || '';
  if (!name) {
    try {
      name = (await request.json()).name || '';
    } catch {
      /* no body */
    }
  }
  if (!name) return bad('File name is required.');
  if (!NAME_RE.test(name)) return bad('Invalid file name.');

  try {
    await storage(env).remove(BUCKET, name);
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
