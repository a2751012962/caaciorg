import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ImageUp, Loader2, X } from 'lucide-react';
import { DIRECTORY_CATEGORIES } from '../../../../lib/directory';
import {
  Field,
  INPUT,
  LABEL,
  LiquidToggle,
  Notice,
  PRIMARY,
  SECONDARY,
  SELECT,
  TEXTAREA,
  useAdmin,
} from '../../kit';
import { BizPreview } from './BizPreview';
import { TagInput } from './TagInput';
import {
  ENDPOINT,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  MAX_TAGS,
  commitTag,
  uploadImage,
  type BizRow,
} from './shared';

const TEXT = [
  'name',
  'name_zh',
  'label',
  'label_zh',
  'phone',
  'website',
  'address',
  'image_url',
  'hours',
  'hours_zh',
  'description',
  'description_zh',
] as const;
type TextField = (typeof TEXT)[number];

// Create or edit one listing (businessForm in the old panel). Left: every
// business_directory field; right: the live card preview. Create is PUT, edit
// is POST { id, ...fields } — the same bodies the old form sent.
export function BusinessForm({
  biz,
  onCancel,
  onSaved,
}: {
  biz: BizRow | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t, api } = useAdmin();
  const edit = !!biz;
  const [text, setText] = useState<Record<TextField, string>>(
    () =>
      Object.fromEntries(TEXT.map((f) => [f, (biz?.[f] as string | null) ?? ''])) as Record<
        TextField,
        string
      >,
  );
  const set = (f: TextField) => (v: string) => setText((x) => ({ ...x, [f]: v }));
  const [category, setCategory] = useState(biz?.category ?? '');
  const [sortOrder, setSortOrder] = useState(edit ? String(biz.sort_order ?? 0) : '');
  const [tags, setTags] = useState<string[]>(biz?.tags ?? []);
  const [tagEntry, setTagEntry] = useState('');
  const [tagsZh, setTagsZh] = useState<string[]>(biz?.tags_zh ?? []);
  const [tagZhEntry, setTagZhEntry] = useState('');
  const [verified, setVerified] = useState(!!biz?.verified);
  const [approved, setApproved] = useState(edit ? !!biz.approved : true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // A row saved before 0022 may still hold an old category; show it rather than silently blank it.
  const cats = ['', ...DIRECTORY_CATEGORIES.map((c) => c.id)];
  if (category && !cats.includes(category)) cats.push(category);
  const catLabel = (id: string) => {
    if (!id) return t('— none (Other Services) —', '— 无（其他服务）—');
    const c = DIRECTORY_CATEGORIES.find((x) => x.id === id);
    return c ? t(c.en, c.zh) : id;
  };

  const draft = {
    id: biz?.id ?? 'draft',
    ...Object.fromEntries(TEXT.map((f) => [f, text[f].trim()])),
    name: text.name.trim(),
    category: category || null,
    verified,
    approved,
    tags,
    tags_zh: tagsZh,
  } as BizRow;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // A tag still in the text box (typed but no Enter) counts too.
    const en = commitTag(tags, tagEntry);
    const zh = commitTag(tagsZh, tagZhEntry);
    setTags(en.tags);
    setTagEntry(en.entry);
    setTagsZh(zh.tags);
    setTagZhEntry(zh.entry);
    if (!en.ok || !zh.ok)
      return setMsg(
        t(`At most ${MAX_TAGS} tags per language.`, `每种语言最多 ${MAX_TAGS} 个标签。`),
      );
    const body: Record<string, unknown> = {
      ...Object.fromEntries(TEXT.map((f) => [f, text[f].trim()])),
      approved,
      verified,
      category,
      sort_order: sortOrder.trim(),
      tags: en.tags,
      tags_zh: zh.tags,
    };
    if (!body.name) return setMsg(t('Name is required.', '名称为必填项。'));
    setBusy(true);
    setMsg('');
    const res = edit
      ? await api(ENDPOINT, { method: 'POST', body: { id: biz.id, ...body } })
      : await api(ENDPOINT, { method: 'PUT', body });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Save failed.', '保存失败。'));
    onSaved();
  };

  const input = (label: ReactNode, f: TextField, type = 'text', extra: object = {}) => (
    <Field label={label}>
      <input
        type={type}
        className={INPUT}
        value={text[f]}
        onChange={(e) => set(f)(e.target.value)}
        {...extra}
      />
    </Field>
  );

  return (
    <form ref={box} onSubmit={submit} className="space-y-5 scroll-mt-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-bold text-ink break-words min-w-0">
          {edit ? biz.name : t('New listing', '新建条目')}
        </h3>
        <button
          type="button"
          className="w-11 h-11 shrink-0 rounded-full inline-flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-ink cursor-pointer transition-colors"
          aria-label={t('Cancel', '取消')}
          onClick={onCancel}
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-4 min-w-0">
          <div className="grid gap-4 md:grid-cols-2">
            {input(`${t('Name (English page)', '名称（英文页）')} *`, 'name', 'text', {
              required: true,
            })}
            {input(t('Name (Chinese page)', '名称（中文页）'), 'name_zh')}
            <Field label={t('Category (filter on the page)', '类别（页面筛选）')}>
              <select
                className={SELECT}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {cats.map((c) => (
                  <option key={c} value={c}>
                    {catLabel(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t('Sort order', '排序')}
              hint={t('Smaller numbers come first.', '数字小的排在前面。')}
            >
              <input
                type="number"
                step={1}
                inputMode="numeric"
                className={INPUT}
                placeholder="0"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </Field>
            {input(t('Card label (English)', '卡片小标签（英文）'), 'label')}
            {input(t('Card label (Chinese)', '卡片小标签（中文）'), 'label_zh')}
            <div>
              <span className={LABEL}>{t('Tags (English page)', '标签（英文页）')}</span>
              <TagInput
                tags={tags}
                entry={tagEntry}
                onChange={(a, b) => {
                  setTags(a);
                  setTagEntry(b);
                }}
              />
            </div>
            <div>
              <span className={LABEL}>{t('Tags (Chinese page)', '标签（中文页）')}</span>
              <TagInput
                tags={tagsZh}
                entry={tagZhEntry}
                onChange={(a, b) => {
                  setTagsZh(a);
                  setTagZhEntry(b);
                }}
              />
              <span className="block mt-1.5 text-[11px] text-neutral-500">
                {t(
                  'If one language has no tags, that page shows the other language’s.',
                  '某一语言没有标签时，该页显示另一语言的标签。',
                )}
              </span>
            </div>
            {input(t('Phone', '电话'), 'phone', 'tel')}
            {/* Text, not type="url": rows imported without a scheme
                ("kungfutea.com") are valid to the eye and invalid to the
                browser, and native validation would then refuse to save the
                row at all, with no message of its own. The preview says when a
                link cannot be used, which is the warning that belongs here. */}
            {input(t('Website', '网站'), 'website', 'text', { inputMode: 'url' })}
            {input(t('Address', '地址'), 'address')}
            <ImageField value={text.image_url} onChange={set('image_url')} />
            {input(t('Hours (English)', '营业时间（英文）'), 'hours')}
            {input(t('Hours (Chinese)', '营业时间（中文）'), 'hours_zh')}
            <Field label={t('Description (English)', '描述（英文）')}>
              <textarea
                className={TEXTAREA}
                rows={3}
                value={text.description}
                onChange={(e) => set('description')(e.target.value)}
              />
            </Field>
            <Field label={t('Description (Chinese)', '描述（中文）')}>
              <textarea
                className={TEXTAREA}
                rows={3}
                value={text.description_zh}
                onChange={(e) => set('description_zh')(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-neutral-500">
            {t(
              'Empty Chinese fields show the English text on the Chinese page.',
              '中文栏留空时，中文页显示英文内容。',
            )}
          </p>
          <div className="flex items-center gap-3">
            <LiquidToggle
              checked={verified}
              onChange={setVerified}
              label={t('CAACI Verified badge', '显示 CAACI Verified 认证标记')}
            />
            <span className="text-sm text-neutral-700">
              {t('CAACI Verified badge', '显示 CAACI Verified 认证标记')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <LiquidToggle
              checked={approved}
              onChange={setApproved}
              label={t('Approved (publicly listed)', '已批准（公开显示）')}
            />
            <span className="text-sm text-neutral-700">
              {t('Approved (publicly listed)', '已批准（公开显示）')}
            </span>
          </div>
        </div>
        <div className="min-w-0 xl:sticky xl:top-4 self-start">
          <BizPreview draft={draft} />
        </div>
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {edit ? t('Save', '保存') : t('Create listing', '创建条目')}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          {t('Cancel', '取消')}
        </button>
      </div>
    </form>
  );
}

// The image field: a URL box plus an upload that fills it in (the old panel's
// URL input + single-file FilePond, same types and 5 MB limit).
function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (file.current) file.current.value = '';
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type))
      return setMsg({
        tone: 'error',
        text: t('Images only (JPEG/PNG/WebP/GIF)', '仅支持图片（JPEG/PNG/WebP/GIF）'),
      });
    if (f.size > IMAGE_MAX_BYTES)
      return setMsg({ tone: 'error', text: t('Too large (max 5 MB)', '文件过大（最大 5 MB）') });
    setBusy(true);
    setMsg(null);
    const res = await uploadImage(f);
    setBusy(false);
    if (res.url) {
      onChange(res.url);
      setMsg({ tone: 'success', text: t('Uploaded', '已上传') });
    } else setMsg({ tone: 'error', text: res.error || t('Upload failed.', '上传失败。') });
  };

  return (
    <div className="space-y-2">
      <Field label={t('Image', '图片')}>
        <input
          type="text"
          className={INPUT}
          placeholder="https://…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`${SECONDARY} ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          ) : (
            <ImageUp className="w-4 h-4" aria-hidden />
          )}
          {busy ? t('Uploading…', '上传中…') : t('Upload image', '上传图片')}
          <input
            ref={file}
            type="file"
            className="sr-only"
            accept={IMAGE_TYPES.join(',')}
            disabled={busy}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </label>
        {value && /^https?:\/\//i.test(value) && (
          <img
            src={value}
            alt=""
            className="w-11 h-11 rounded-full object-cover border border-neutral-200"
          />
        )}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
