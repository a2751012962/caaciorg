import { supabase } from '../../../../lib/supabase';
import type { DirectoryRow } from '../../../../lib/directory';

// A business_directory row as /api/admin/business returns it (its COLUMNS).
export interface BizRow extends DirectoryRow {
  image_url: string | null;
  sort_order: number | null;
  owner_id: string | null;
  approved: boolean;
  created_at: string;
}

export interface BizPage {
  rows: BizRow[];
  total: number;
  limit: number;
  offset: number;
  pending_total: number;
}

export const ENDPOINT = '/api/admin/business';
export const BIZ_LIMIT = 25;
// Same limits as functions/api/admin/business.js.
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 40;

/**
 * Adds the text typed in a tag box to `tags`, the way the old panel did: commas
 * become spaces, blanks and case-insensitive repeats are dropped. ok = false
 * (and the text is kept) when the list is already full.
 */
export function commitTag(tags: string[], entry: string) {
  const tag = entry.replace(/[,，]/g, ' ').trim();
  if (!tag) return { ok: true, tags, entry };
  if (tags.some((x) => x.toLowerCase() === tag.toLowerCase())) return { ok: true, tags, entry: '' };
  if (tags.length >= MAX_TAGS) return { ok: false, tags, entry };
  return { ok: true, tags: [...tags, tag], entry: '' };
}

/**
 * Uploads one image to the media library (PUT /api/admin/media, multipart
 * `file`) and returns its public URL — what the old FilePond field did. The
 * kit's api() only speaks JSON, so this adds the bearer token itself.
 */
export async function uploadImage(file: File): Promise<{ url?: string; error?: string }> {
  const { data: s } = await supabase.auth.getSession();
  const fd = new FormData();
  fd.append('file', file, file.name);
  try {
    const res = await fetch('/api/admin/media', {
      method: 'PUT',
      headers: s.session ? { authorization: `Bearer ${s.session.access_token}` } : {},
      body: fd,
    });
    const data = (await res.json().catch(() => ({}))) as {
      file?: { url?: string };
      error?: string;
    };
    if (res.ok && data.file?.url) return { url: data.file.url };
    return { error: data.error || '' };
  } catch {
    return { error: '' };
  }
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
