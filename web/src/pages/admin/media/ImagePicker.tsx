// The console's one image field: the picture's address, a thumbnail, and
// Upload (choose a file → crop it in ImageEditor → saved to the media library),
// Edit / crop (the current picture through the same editor, saved as a new
// file), and Remove.
//
//   <ImagePicker value={url} onChange={setUrl} />
//   <ImagePicker value={cover} onChange={setCover} aspect="16:9" lockAspect
//     label="Cover" hint="Shown at the top of the article." />
//
// value / onChange: the public URL ('' = no picture). label: the field's
// label (default "Image"). aspect: the crop shape the editor starts with
// (default the picture's own). lockAspect: always crop to `aspect` (no shape
// choice). hint: a line under the field.
import { useEffect, useRef, useState } from 'react';
import { Crop, ImageUp, Trash2 } from 'lucide-react';
import { INPUT, LABEL, ROW_BTN, SECONDARY, useAdmin } from '../kit';
import { ImageEditor, type AspectKey } from './ImageEditor';

export interface ImagePickerProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  aspect?: AspectKey;
  lockAspect?: boolean;
  hint?: string;
}

export function ImagePicker({
  value,
  onChange,
  label,
  aspect = 'free',
  lockAspect = false,
  hint,
}: ImagePickerProps) {
  const { t } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  // null = closed; a File = cropping a new upload; a string = editing that URL.
  const [editing, setEditing] = useState<File | string | null>(null);
  const [previewOk, setPreviewOk] = useState(true);
  useEffect(() => setPreviewOk(true), [value]);

  const fixedShape = lockAspect && aspect !== 'free';
  const thumb = fixedShape && aspect === '16:9' ? 'w-32 aspect-video' : 'w-20 h-20';

  return (
    <div>
      <label className="block">
        <span className={LABEL}>{label ?? t('Image', '图片')}</span>
        <input
          type="text"
          inputMode="url"
          className={INPUT}
          value={value}
          placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {value && previewOk && (
          <img
            src={value}
            alt=""
            onError={() => setPreviewOk(false)}
            className={`${thumb} shrink-0 rounded-xl object-cover border border-neutral-200 bg-white`}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setEditing(f);
          }}
        />
        <button type="button" className={SECONDARY} onClick={() => fileRef.current?.click()}>
          <ImageUp className="w-4 h-4" aria-hidden />
          {value ? t('Replace', '更换') : t('Upload', '上传')}
        </button>
        {value && (
          <>
            <button
              type="button"
              className={ROW_BTN}
              onClick={() => setEditing(value)}
              disabled={!previewOk}
            >
              <Crop className="w-4 h-4" aria-hidden />
              {t('Edit / crop', '编辑 / 裁剪')}
            </button>
            <button type="button" className={ROW_BTN} onClick={() => onChange('')}>
              <Trash2 className="w-4 h-4" aria-hidden />
              {t('Remove', '移除')}
            </button>
          </>
        )}
      </div>
      <span className="block mt-1.5 text-[11px] text-neutral-500">
        {hint ??
          (fixedShape
            ? t(
                `Any picture; it is cropped to ${aspect}. Saved under 5 MB.`,
                `任意图片均可，会裁成 ${aspect}，保存后小于 5 MB。`,
              )
            : t(
                'Any picture; you can crop it before it is saved (under 5 MB).',
                '任意图片均可，保存前可以裁剪（小于 5 MB）。',
              ))}
      </span>
      {editing !== null && (
        <ImageEditor
          source={editing}
          aspect={aspect}
          lockAspect={lockAspect}
          onCancel={() => setEditing(null)}
          onDone={(r) => {
            setEditing(null);
            onChange(r.url);
          }}
        />
      )}
    </div>
  );
}
