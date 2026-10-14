// The console's image editor: a dialog that takes a picked file or the URL of
// an image already on the site, lets the editor crop it (fixed shapes, or the
// picture's own), zoom, turn it a quarter at a time, straighten it a few
// degrees, and then saves the result to the media library
// (PUT /api/admin/media) and hands back the public URL.
//
// Cropping, dragging and pinch-zoom are react-easy-crop's (touch included);
// the export is ours (media/crop.ts): JPEG at quality 0.85, or PNG when the
// picture has transparency, at most 2000 px on the longest side and under
// 5 MB. Esc closes it.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import Cropper, { type Area, type MediaSize } from 'react-easy-crop';
import { ImageUp, Link2, RotateCcw, RotateCw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { FluidTabs } from '../../../components/FluidTabs';
import { overlayIn, panelFrom, panelIn, panelShown } from '../../../lib/motion';
import { Field, INPUT, LABEL, Notice, PRIMARY, ROW_BTN, SECONDARY, useAdmin } from '../kit';
import { exportCrop, hasTransparency, ImageLoadError, loadEditable } from './crop';
import { UPLOAD_MAX_BYTES, UploadAborted, uploadImage, type Upload } from './upload';

/** The crop shapes on offer. 'free' keeps the picture's own proportions. */
export type AspectKey = 'free' | '16:9' | '4:3' | '1:1' | '3:4';
const RATIOS: Record<Exclude<AspectKey, 'free'>, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
};
const ASPECTS: AspectKey[] = ['free', '16:9', '4:3', '1:1', '3:4'];

/** Files the media library stores unchanged ("Upload as is"). */
const AS_IS_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// A typed or stored picture address, as a full URL the dialog may load and
// hand back: http(s) anywhere, or a path on this site. Anything else (a
// javascript: or data: address, a protocol-relative //host) is refused.
function safeImageUrl(raw: string): string | null {
  const s = raw.trim();
  if (!/^(https?:\/\/|\/(?!\/))/i.test(s)) return null;
  try {
    const u = new URL(s, window.location.origin);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export interface ImageEditorResult {
  url: string;
  /** Only filled when the editor was opened with `askText`. */
  alt: string;
  caption: string;
}

export interface ImageEditorProps {
  /** A picked file, the URL of an existing image, or null to ask for one first. */
  source: File | string | null;
  /** The crop shape to start with (default 'free'). */
  aspect?: AspectKey;
  /** Keep `aspect` and hide the shape choice (an article cover is always 16:9). */
  lockAspect?: boolean;
  /** Also ask for alt text and an optional caption (images inside an article). */
  askText?: boolean;
  onDone: (result: ImageEditorResult) => void;
  onCancel: () => void;
}

type Phase = 'pick' | 'loading' | 'edit' | 'tainted' | 'unreadable';

const stemOf = (name: string) =>
  name
    .replace(/[?#].*$/, '')
    .split('/')
    .pop()!
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 60) || 'image';

export function ImageEditor({
  source,
  aspect = 'free',
  lockAspect = false,
  askText = false,
  onDone,
  onCancel,
}: ImageEditorProps) {
  const { t } = useAdmin();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useRef<Upload | null>(null);

  // What is being edited: the file or URL given, or one picked in the dialog.
  const [picked, setPicked] = useState<File | string | null>(source);
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(source ? 'loading' : 'pick');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [png, setPng] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  const [preset, setPreset] = useState<AspectKey>(aspect);
  const [mediaAspect, setMediaAspect] = useState(4 / 3);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [quarter, setQuarter] = useState(0);
  const [straighten, setStraighten] = useState(0);
  const area = useRef<Area | null>(null);

  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');

  const rotation = quarter * 90 + straighten;
  const turned = quarter % 2 === 1;
  const ratio =
    preset === 'free' ? (turned ? 1 / mediaAspect : mediaAspect) : RATIOS[preset as '16:9'];

  // The object URL of a picked file lives as long as the dialog shows it.
  useEffect(() => {
    if (!picked) return;
    const url = typeof picked === 'string' ? safeImageUrl(picked) : URL.createObjectURL(picked);
    if (!url) {
      setSrc(null);
      setPhase('unreadable');
      return;
    }
    setSrc(url);
    setPhase('loading');
    setErr('');
    let gone = false;
    loadEditable(url)
      .then((loaded) => {
        if (gone) return;
        setImg(loaded);
        setPng(hasTransparency(loaded));
        setPhase('edit');
      })
      .catch((e) => {
        if (!gone) setPhase(e instanceof ImageLoadError ? e.problem : 'unreadable');
      });
    return () => {
      gone = true;
      if (typeof picked !== 'string') URL.revokeObjectURL(url);
    };
  }, [picked]);

  // Through a ref, so a parent passing a new arrow each render does not re-run
  // the open/close effect below (it moves focus and locks scrolling).
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const close = useCallback(() => {
    upload.current?.abort();
    cancelRef.current();
  }, []);

  // Esc closes; the page behind does not scroll; focus comes back on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [close]);

  useEffect(() => () => upload.current?.abort(), []);

  const reset = () => {
    setPreset(aspect);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setQuarter(0);
    setStraighten(0);
  };

  const filename = (type: string) => {
    const base =
      typeof picked === 'string' ? stemOf(picked) : picked ? stemOf(picked.name) : 'image';
    return `${base}.${type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] ?? 'jpg')}`;
  };

  const send = async (blob: Blob, name: string) => {
    const up = uploadImage(blob, name, setProgress);
    upload.current = up;
    try {
      const url = await up.promise;
      onDone({ url, alt: alt.trim(), caption: caption.trim() });
    } catch (e) {
      if (!(e instanceof UploadAborted))
        setErr((e instanceof Error && e.message) || t('Upload failed.', '上传失败。'));
    } finally {
      upload.current = null;
      setProgress(null);
    }
  };

  const save = async () => {
    if (!img || !area.current) return;
    setErr('');
    setWorking(true);
    try {
      const out = await exportCrop(img, area.current, rotation, png);
      await send(out.blob, filename(out.type));
    } catch (e) {
      if (e instanceof ImageLoadError && e.problem === 'tainted') setPhase('tainted');
      else
        setErr(
          e instanceof Error && e.message === 'too-large'
            ? t(
                'Even made smaller this picture stays over 5 MB. Crop it tighter and try again.',
                '即使缩小后图片仍超过 5 MB，请裁得更小一些再试。',
              )
            : t('The picture could not be prepared.', '图片处理失败。'),
        );
    } finally {
      setWorking(false);
    }
  };

  const asIs =
    picked instanceof File && AS_IS_TYPES.includes(picked.type) && picked.size <= UPLOAD_MAX_BYTES
      ? picked
      : null;
  const uploadAsIs = async () => {
    if (!asIs) return;
    setErr('');
    setWorking(true);
    await send(asIs, filename(asIs.type));
    setWorking(false);
  };

  const keepUrl = () => {
    if (typeof picked === 'string' && safeImageUrl(picked))
      onDone({ url: picked.trim(), alt: alt.trim(), caption: caption.trim() });
  };

  const openUrl = () => {
    const u = urlInput.trim();
    if (!safeImageUrl(u))
      return setErr(
        t('Enter a web address starting with https://', '请输入以 https:// 开头的网址'),
      );
    setErr('');
    setPicked(u);
  };

  const busy = working || progress !== null;

  const textFields = askText && (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label={t('Describe the picture (alt text)', '图片说明（替代文字）')}
        hint={t(
          'Read aloud to people who cannot see it. One short sentence.',
          '供看不到图片的读者朗读，一句话即可。',
        )}
      >
        <input className={INPUT} value={alt} onChange={(e) => setAlt(e.target.value)} />
      </Field>
      <Field
        label={t('Caption (optional)', '图注（可选）')}
        hint={t('Shown under the picture.', '显示在图片下方。')}
      >
        <input className={INPUT} value={caption} onChange={(e) => setCaption(e.target.value)} />
      </Field>
    </div>
  );

  let content: ReactNode;
  if (phase === 'pick')
    content = (
      <div className="space-y-5">
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
            if (f) setPicked(f);
          }}
        />
        <button type="button" className={PRIMARY} onClick={() => fileRef.current?.click()}>
          <ImageUp className="w-4 h-4" aria-hidden />
          {t('Choose a picture', '选择图片')}
        </button>
        <div className="pt-5 border-t border-neutral-200/80">
          <Field
            label={t('…or use a picture already online', '……或使用网上已有的图片')}
            hint={t('Paste its address.', '粘贴图片网址。')}
          >
            <div className="flex gap-2">
              <input
                className={INPUT}
                value={urlInput}
                placeholder="https://…"
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    openUrl();
                  }
                }}
              />
              <button type="button" className={SECONDARY} onClick={openUrl}>
                <Link2 className="w-4 h-4" aria-hidden />
                {t('Open', '打开')}
              </button>
            </div>
          </Field>
        </div>
      </div>
    );
  else if (phase === 'loading')
    content = (
      <p className="py-16 text-center text-xs text-neutral-500" role="status">
        {t('Opening the picture…', '正在打开图片…')}
      </p>
    );
  else if (phase === 'tainted')
    content = (
      <div className="space-y-4">
        <Notice tone="warn">
          {t(
            'This picture is on another website that does not allow it to be edited here. You can keep using it as it is.',
            '这张图片来自其他网站，对方不允许在这里编辑。可以直接按原样使用。',
          )}
        </Notice>
        {src && (
          <img
            src={src}
            alt=""
            className="max-h-64 mx-auto rounded-xl border border-neutral-200 bg-white"
          />
        )}
        {textFields}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} onClick={keepUrl}>
            {t('Keep this picture', '保留这张图片')}
          </button>
          <button type="button" className={SECONDARY} onClick={close}>
            {t('Cancel', '取消')}
          </button>
        </div>
      </div>
    );
  else if (phase === 'unreadable')
    content = (
      <div className="space-y-4">
        <Notice tone="error">
          {t(
            'This picture could not be opened. Try a JPEG or PNG file.',
            '无法打开这张图片，请换用 JPEG 或 PNG 文件。',
          )}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={SECONDARY}
            onClick={() => {
              setPicked(null);
              setErr('');
              setPhase('pick');
            }}
          >
            {t('Choose another picture', '换一张图片')}
          </button>
          <button type="button" className={SECONDARY} onClick={close}>
            {t('Cancel', '取消')}
          </button>
        </div>
      </div>
    );
  else
    content = (
      <div className="space-y-5">
        <div className="relative w-full h-[46vh] sm:h-[400px] rounded-xl overflow-hidden bg-neutral-900">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={ratio}
              minZoom={1}
              maxZoom={4}
              zoomSpeed={0.2}
              objectFit="contain"
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onMediaLoaded={(m: MediaSize) => setMediaAspect(m.naturalWidth / m.naturalHeight)}
              onCropComplete={(_: Area, px: Area) => {
                area.current = px;
              }}
              mediaProps={{ alt: '' }}
              cropperProps={{
                'aria-label': t(
                  'Crop frame. Drag the picture, or focus here and use the arrow keys.',
                  '裁剪框。拖动图片，或聚焦此处后用方向键移动。',
                ),
              }}
            />
          )}
        </div>

        {!lockAspect && (
          <div className="overflow-x-auto [scrollbar-width:none]">
            <FluidTabs<AspectKey>
              id="image-editor-aspect"
              role="group"
              ariaLabel={t('Shape', '比例')}
              value={preset}
              onChange={setPreset}
              items={ASPECTS.map((a) => ({
                value: a,
                label: a === 'free' ? t('Original', '原比例') : a,
              }))}
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Slider
            label={t('Zoom', '缩放')}
            value={zoom}
            min={1}
            max={4}
            step={0.01}
            onChange={setZoom}
            display={`${Math.round(zoom * 100)}%`}
            lowIcon={<ZoomOut className="w-4 h-4" aria-hidden />}
            highIcon={<ZoomIn className="w-4 h-4" aria-hidden />}
          />
          <Slider
            label={t('Straighten', '拉直')}
            value={straighten}
            min={-45}
            max={45}
            step={0.5}
            onChange={setStraighten}
            display={`${straighten > 0 ? '+' : ''}${straighten}°`}
            hint={t(
              'Zoom in a little afterwards so no corner is left blank.',
              '拉直后可稍微放大，避免边角留白。',
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={ROW_BTN} onClick={() => setQuarter((q) => (q + 3) % 4)}>
            <RotateCcw className="w-4 h-4" aria-hidden />
            {t('Rotate left', '向左转')}
          </button>
          <button type="button" className={ROW_BTN} onClick={() => setQuarter((q) => (q + 1) % 4)}>
            <RotateCw className="w-4 h-4" aria-hidden />
            {t('Rotate right', '向右转')}
          </button>
          <button type="button" className={ROW_BTN} onClick={reset}>
            <Undo2 className="w-4 h-4" aria-hidden />
            {t('Reset', '复原')}
          </button>
        </div>

        {textFields}

        {progress !== null && (
          <div aria-live="polite">
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
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} disabled={busy} onClick={() => void save()}>
            {working && progress === null
              ? t('Preparing…', '处理中…')
              : t('Save picture', '保存图片')}
          </button>
          {asIs && (
            <button
              type="button"
              className={SECONDARY}
              disabled={busy}
              onClick={() => void uploadAsIs()}
            >
              {t('Upload as is', '不裁剪直接上传')}
            </button>
          )}
          <button type="button" className={SECONDARY} onClick={close}>
            {progress !== null ? t('Stop upload', '停止上传') : t('Cancel', '取消')}
          </button>
        </div>
        <p className="text-[11px] text-neutral-500">
          {png
            ? t(
                'Saved as PNG (the picture has a transparent background), at most 2000 px across.',
                '保存为 PNG（图片有透明背景），最长边不超过 2000 像素。',
              )
            : t(
                'Saved as JPEG, at most 2000 px across and under 5 MB.',
                '保存为 JPEG，最长边不超过 2000 像素，小于 5 MB。',
              )}
        </p>
      </div>
    );

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-ink/50 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={overlayIn}
      onClick={(e) => e.target === e.currentTarget && !busy && close()}
    >
      <motion.div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={panelFrom}
        animate={panelShown}
        transition={panelIn}
        className="w-full sm:max-w-2xl max-h-[100dvh] sm:max-h-[94vh] overflow-y-auto bg-white sm:rounded-2xl shadow-lg p-4 sm:p-6 space-y-5 focus:outline-none"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-bold text-ink">
            {phase === 'pick' ? t('Add a picture', '添加图片') : t('Edit picture', '编辑图片')}
          </h2>
          <button type="button" className={ROW_BTN} onClick={close} aria-label={t('Close', '关闭')}>
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        {content}
        {err && <Notice tone="error">{err}</Notice>}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  hint,
  lowIcon,
  highIcon,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  hint?: string;
  lowIcon?: ReactNode;
  highIcon?: ReactNode;
}) {
  return (
    <label className="block">
      <span className={`${LABEL} flex items-center justify-between`}>
        <span>{label}</span>
        <span className="tabular-nums font-semibold text-neutral-700">{display}</span>
      </span>
      <span className="flex items-center gap-2 text-neutral-500">
        {lowIcon}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-11 accent-brick cursor-pointer"
        />
        {highIcon}
      </span>
      {hint && <span className="block mt-1 text-[11px] text-neutral-500">{hint}</span>}
    </label>
  );
}
