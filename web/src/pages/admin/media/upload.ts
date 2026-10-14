// Uploads one image to the media library: PUT /api/admin/media, multipart field
// "file", the signed-in person's access token as a Bearer header. An XHR, not
// fetch, so the upload reports real progress (the same transport as the event
// form's ImageField). Resolves to the stored file's public URL.
import { supabase } from '../../../lib/supabase';

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export interface Upload {
  promise: Promise<string>;
  abort: () => void;
}

/** Thrown (rejected) when the upload was cancelled, so callers can stay quiet. */
export class UploadAborted extends Error {}

export function uploadImage(
  blob: Blob,
  filename: string,
  onProgress: (percent: number) => void,
): Upload {
  const xhr = new XMLHttpRequest();
  let aborted = false;
  const promise = (async () => {
    const { data: s } = await supabase.auth.getSession();
    if (aborted) throw new UploadAborted();
    return new Promise<string>((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', blob, filename);
      xhr.open('PUT', '/api/admin/media');
      if (s.session) xhr.setRequestHeader('authorization', `Bearer ${s.session.access_token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data: { file?: { url?: string }; error?: string } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON error body */
        }
        if (xhr.status >= 200 && xhr.status < 300 && data.file?.url) resolve(data.file.url);
        else reject(new Error(data.error || ''));
      };
      xhr.onerror = () => reject(new Error(''));
      xhr.onabort = () => reject(new UploadAborted());
      onProgress(0);
      xhr.send(fd);
    });
  })();
  return {
    promise,
    abort: () => {
      aborted = true;
      xhr.abort();
    },
  };
}
