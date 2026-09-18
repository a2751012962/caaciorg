// The event image: a URL box plus a file picker that uploads to
// /api/admin/media (PUT, multipart field "file") and fills the box with the
// stored file's public URL. Replaces the old FilePond; the transport is the
// same XHR as pondProcess so the upload reports real progress.
import { useEffect, useRef, useState } from 'react';
import { ImageUp, X } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { INPUT, LABEL, Notice, SECONDARY, useAdmin } from '../../kit';

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;

export function ImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const { t } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [previewOk, setPreviewOk] = useState(true);

  useEffect(() => setPreviewOk(true), [value]);
  useEffect(() => () => xhrRef.current?.abort(), []);

  const upload = async (file: File) => {
    setErr('');
    if (!TYPES.includes(file.type))
      return setErr(t('Images only (JPEG/PNG/WebP/GIF)', '仅支持图片（JPEG/PNG/WebP/GIF）'));
    if (file.size > MAX_BYTES) return setErr(t('Too large (max 5 MB)', '文件过大（最大 5 MB）'));
    const { data: s } = await supabase.auth.getSession();
    const fd = new FormData();
    fd.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('PUT', '/api/admin/media');
    if (s.session) xhr.setRequestHeader('authorization', `Bearer ${s.session.access_token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      xhrRef.current = null;
      setProgress(null);
      let data: { file?: { url?: string }; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.file?.url) onChange(data.file.url);
      else setErr(data.error || t('Upload failed.', '上传失败。'));
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setProgress(null);
      setErr(t('Upload failed.', '上传失败。'));
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      setProgress(null);
    };
    setProgress(0);
    xhr.send(fd);
  };

  const uploading = progress !== null;

  return (
    <div>
      <label className="block">
        <span className={LABEL}>{t('Image', '图片')}</span>
        <input
          type="text"
          className={INPUT}
          value={value}
          placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {value && previewOk && (
          <img
            src={value}
            alt=""
            onError={() => setPreviewOk(false)}
            className="w-16 h-16 rounded-xl object-cover border border-neutral-200 bg-white"
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept={TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
        {uploading ? (
          <>
            <div className="flex-1 min-w-[120px]" aria-live="polite">
              <div className="text-xs text-neutral-600 mb-1">
                {t('Uploading…', '上传中…')} {progress}%
              </div>
              <div className="h-1.5 rounded-full bg-neutral-200 overflow-hidden">
                <div
                  className="h-full bg-brick transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <button type="button" className={SECONDARY} onClick={() => xhrRef.current?.abort()}>
              <X className="w-4 h-4" aria-hidden />
              {t('Cancel', '取消')}
            </button>
          </>
        ) : (
          <button type="button" className={SECONDARY} onClick={() => fileRef.current?.click()}>
            <ImageUp className="w-4 h-4" aria-hidden />
            {t('Upload an image', '上传图片')}
          </button>
        )}
      </div>
      <span className="block mt-1.5 text-[11px] text-neutral-500">
        {t('JPEG, PNG, WebP or GIF, up to 5 MB.', 'JPEG、PNG、WebP 或 GIF，最大 5 MB。')}
      </span>
      {err && (
        <div className="mt-2">
          <Notice tone="error">{err}</Notice>
        </div>
      )}
    </div>
  );
}
