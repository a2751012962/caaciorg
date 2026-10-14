// One editable field of a page: a text in English and Chinese side by side, a
// photo, or a list (board members, links, past events) whose items are edited
// in both languages at once so the two lists keep the same length and order.
import { useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw } from 'lucide-react';
import {
  defaultOf,
  labelFor,
  type ContentField,
  type ContentLang,
  type ItemKey,
  type ItemShape,
} from '../../../../lib/siteContent';
import { HIDDEN_ITEM_KEYS, deepEqual, newItem } from '../../../../lib/siteContentCore';
import { INPUT, InlineConfirm, LABEL, ROW_BTN, SECONDARY, TEXTAREA } from '../../kit';
import type { ContentDraft } from './useContentDraft';
import { PageImageField } from './PageImageField';

type T = (en: string, zh: string) => string;
type Texts = { en: string; zh: string };

export interface EditorCtx {
  d: ContentDraft;
  t: T;
  lang: ContentLang;
  /** A field got focus: show its text (or photo) in the preview. */
  focus: (key: string, texts: Texts, image: boolean) => void;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rowsFor = (s: string) => Math.min(14, Math.max(3, Math.ceil(s.length / 70) + 1));
const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/g;

/** A short note when the default holds {placeholders} the page fills in. */
function TemplateHint({ text, t }: { text: string; t: T }) {
  const names = [...new Set(text.match(PLACEHOLDER) ?? [])];
  if (!names.length) return null;
  return (
    <p className="text-[11px] text-neutral-500">
      {t(
        `Keep ${names.join(' ')} as written: the page puts the real value there.`,
        `请保留 ${names.join(' ')}：页面会在此处填入实际数值。`,
      )}
    </p>
  );
}

function TextInput({
  kind,
  value,
  placeholder,
  label,
  onChange,
  onFocus,
}: {
  kind: string;
  value: string;
  placeholder: string;
  label: string;
  onChange: (v: string) => void;
  onFocus: () => void;
}) {
  return (
    <label className="block min-w-0">
      <span className={LABEL}>{label}</span>
      {kind === 'longtext' || kind === 'lines' ? (
        <textarea
          className={TEXTAREA}
          rows={rowsFor(value || placeholder)}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
        />
      ) : (
        <input
          type="text"
          className={INPUT}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
        />
      )}
    </label>
  );
}

/** The field's name, its "changed" marks and Reset. */
function FieldHead({
  label,
  modified,
  unsaved,
  onReset,
  t,
}: {
  label: string;
  modified: boolean;
  unsaved: boolean;
  onReset: () => void;
  t: T;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        {label}
        {modified && (
          <span
            className="w-2 h-2 rounded-full bg-brick"
            title={t('Changed from the default', '已改动（与默认不同）')}
            aria-label={t('Changed from the default', '已改动（与默认不同）')}
          />
        )}
        {unsaved && (
          <span className="text-[11px] font-semibold text-brick">{t('Unsaved', '未保存')}</span>
        )}
      </span>
      {modified && (
        <button type="button" className={ROW_BTN} onClick={onReset}>
          <RotateCcw className="w-3.5 h-3.5" aria-hidden />
          {t('Reset to default', '恢复默认')}
        </button>
      )}
    </div>
  );
}

function SameForBoth({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 min-h-[44px] text-xs text-neutral-600 cursor-pointer">
      <input
        type="checkbox"
        className="w-4 h-4 accent-brick"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** One field of a page, whatever its kind. `hideLabel` when the section already names it. */
export function FieldEditor({
  field,
  ctx,
  hideLabel,
}: {
  field: ContentField;
  ctx: EditorCtx;
  hideLabel?: boolean;
}) {
  const { d, t, lang } = ctx;
  const { key } = field;
  const cur = { en: d.value(key, 'en'), zh: d.value(key, 'zh') };
  const def = { en: defaultOf(key, 'en'), zh: defaultOf(key, 'zh') };
  const modified = !deepEqual(cur.en, def.en) || !deepEqual(cur.zh, def.zh);
  const name = labelFor(field.entryId, field.path);
  const head = (
    <FieldHead
      label={hideLabel ? '' : name[lang]}
      modified={modified}
      unsaved={d.changed.has(key)}
      onReset={() => d.reset(key)}
      t={t}
    />
  );

  let body: ReactNode;
  if (field.kind === 'list' && field.shape) {
    body = <ListEditor field={field} shape={field.shape} ctx={ctx} />;
  } else if (field.kind === 'image') {
    body = <ImagePair fieldKey={key} cur={cur} ctx={ctx} />;
  } else {
    body = (
      <TextPair
        fieldKey={key}
        kind={field.kind}
        cur={{ en: str(cur.en), zh: str(cur.zh) }}
        def={{ en: str(def.en), zh: str(def.zh) }}
        ctx={ctx}
      />
    );
  }
  return (
    <div id={`cms-${key}`} className="py-4 space-y-3 scroll-mt-28">
      {head}
      {body}
    </div>
  );
}

function TextPair({
  fieldKey,
  kind,
  cur,
  def,
  ctx,
}: {
  fieldKey: string;
  kind: string;
  cur: Texts;
  def: Texts;
  ctx: EditorCtx;
}) {
  const { d, t, focus } = ctx;
  // Text the two languages share (an address, a video id) is one box until
  // the editor asks for two.
  const [linked, setLinked] = useState(() => def.en === def.zh && cur.en === cur.zh);
  const show = (next: Texts) => focus(fieldKey, next, false);
  return (
    <div className="space-y-2">
      {linked ? (
        <TextInput
          kind={kind}
          label={t('English and Chinese', '中英文相同')}
          value={cur.en}
          placeholder={def.en}
          onChange={(v) => {
            d.set(fieldKey, { en: v, zh: v });
          }}
          onFocus={() => show(cur)}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            kind={kind}
            label="EN"
            value={cur.en}
            placeholder={def.en}
            onChange={(v) => {
              d.set(fieldKey, { en: v });
            }}
            onFocus={() => show(cur)}
          />
          <TextInput
            kind={kind}
            label="中文"
            value={cur.zh}
            placeholder={def.zh}
            onChange={(v) => {
              d.set(fieldKey, { zh: v });
            }}
            onFocus={() => show(cur)}
          />
        </div>
      )}
      <TemplateHint text={def.en || def.zh} t={t} />
      {def.en === def.zh && (
        <SameForBoth
          checked={linked}
          label={t('Same text in both languages', '中英文使用相同文字')}
          onChange={(on) => {
            setLinked(on);
            if (on) d.set(fieldKey, { zh: cur.en });
          }}
        />
      )}
    </div>
  );
}

function ImagePair({
  fieldKey,
  cur,
  ctx,
}: {
  fieldKey: string;
  cur: { en: unknown; zh: unknown };
  ctx: EditorCtx;
}) {
  const { d, t, focus } = ctx;
  const en = str(cur.en);
  const zh = str(cur.zh);
  const [linked, setLinked] = useState(() => en === zh);
  const show = (next: Texts) => focus(fieldKey, next, true);
  return (
    <div className="space-y-2">
      {linked ? (
        <div onFocus={() => show({ en, zh })}>
          <PageImageField
            value={en}
            onChange={(v) => {
              d.set(fieldKey, { en: v, zh: v });
            }}
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(['en', 'zh'] as const).map((l) => (
            <div key={l} className="min-w-0" onFocus={() => show({ en, zh })}>
              <span className={LABEL}>{l === 'en' ? 'EN' : '中文'}</span>
              <PageImageField
                value={l === 'en' ? en : zh}
                onChange={(v) => {
                  d.set(fieldKey, { [l]: v });
                }}
              />
            </div>
          ))}
        </div>
      )}
      <SameForBoth
        checked={linked}
        label={t('Same image for both languages', '中英文使用同一张图片')}
        onChange={(on) => {
          setLinked(on);
          if (on) d.set(fieldKey, { zh: en });
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ lists

/** Stable row keys for a list edited in place (so typing never remounts a row). */
function useRowIds(length: number) {
  const next = useRef(0);
  const ids = useRef<string[]>([]);
  const make = () => `row-${(next.current += 1)}`;
  while (ids.current.length < length) ids.current.push(make());
  if (ids.current.length > length) ids.current = ids.current.slice(0, length);
  return {
    ids: ids.current,
    add: () => ids.current.push(make()),
    remove: (i: number) => ids.current.splice(i, 1),
    move: (i: number, j: number) => {
      const [x] = ids.current.splice(i, 1);
      ids.current.splice(j, 0, x);
    },
  };
}

/**
 * Item keys whose default is the same text in both languages in every item
 * (a link, a logo, a year): edited once, written to both lists.
 */
function sharedKeys(fieldKey: string, shape: ItemShape): Set<string> {
  if (shape.type !== 'object') return new Set();
  const en = arr(defaultOf(fieldKey, 'en'));
  const zh = arr(defaultOf(fieldKey, 'zh'));
  if (!en.length || en.length !== zh.length) return new Set();
  const out = new Set<string>();
  for (const k of shape.keys) {
    if (k.kind === 'longtext' || k.kind === 'keep') continue;
    const same = en.every((x, i) =>
      deepEqual((x as Record<string, unknown>)[k.key], (zh[i] as Record<string, unknown>)[k.key]),
    );
    const any = en.some((x) => {
      const v = (x as Record<string, unknown>)[k.key];
      return typeof v === 'string' ? v !== '' : Array.isArray(v) && v.length > 0;
    });
    if (same && any) out.add(k.key);
  }
  return out;
}

/** The first bit of text in an item, for its row heading. */
function itemTitle(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  for (const k of ['name', 'title', 'label', 'role', 'year']) {
    const v = (item as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

function ListEditor({
  field,
  shape,
  ctx,
}: {
  field: ContentField;
  shape: ItemShape;
  ctx: EditorCtx;
}) {
  const { d, t, lang, focus } = ctx;
  const { key } = field;
  const en = arr(d.value(key, 'en'));
  const zh = arr(d.value(key, 'zh'));
  const length = Math.max(en.length, zh.length);
  const rows = useRowIds(length);
  const [shared] = useState(() => sharedKeys(key, shape));
  const blank = () => newItem(shape) as unknown;
  const pad = (a: unknown[]) => Array.from({ length }, (_, i) => (i < a.length ? a[i] : blank()));

  const write = (nextEn: unknown[], nextZh: unknown[]) => d.set(key, { en: nextEn, zh: nextZh });

  const update = (i: number, langs: ContentLang[], itemKey: string | null, v: unknown) => {
    const lists = { en: pad(en), zh: pad(zh) };
    for (const l of langs) {
      const list = lists[l];
      list[i] = itemKey === null ? v : { ...(list[i] as Record<string, unknown>), [itemKey]: v };
    }
    write(lists.en, lists.zh);
  };
  const add = () => {
    const item = blank();
    rows.add();
    write([...pad(en), item], [...pad(zh), structuredClone(item)]);
  };
  const removeRow = (rowId: string) => {
    const i = rows.ids.indexOf(rowId);
    if (i < 0) return;
    rows.remove(i);
    const a = pad(en);
    const b = pad(zh);
    a.splice(i, 1);
    b.splice(i, 1);
    write(a, b);
  };
  const move = (i: number, j: number) => {
    if (j < 0 || j >= length) return;
    rows.move(i, j);
    const a = pad(en);
    const b = pad(zh);
    a.splice(j, 0, a.splice(i, 1)[0]);
    b.splice(j, 0, b.splice(i, 1)[0]);
    write(a, b);
  };

  const keys: ItemKey[] =
    shape.type === 'object'
      ? shape.keys.filter(
          (k) =>
            k.kind !== 'keep' &&
            !HIDDEN_ITEM_KEYS.includes(k.key) &&
            !field.fixedKeys?.includes(k.key),
        )
      : [];

  return (
    <div className="space-y-3">
      <ol className="divide-y divide-neutral-200/80 border-y border-neutral-200/80">
        {rows.ids.map((rowId, i) => {
          const a = en[i];
          const b = zh[i];
          const title = itemTitle(lang === 'zh' ? b : a) || itemTitle(a);
          return (
            <li key={rowId} className="py-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-neutral-500 min-w-0 truncate">
                  {i + 1}. {title}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={ROW_BTN}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                    aria-label={t('Move up', '上移')}
                  >
                    <ArrowUp className="w-4 h-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={ROW_BTN}
                    disabled={i === length - 1}
                    onClick={() => move(i, i + 1)}
                    aria-label={t('Move down', '下移')}
                  >
                    <ArrowDown className="w-4 h-4" aria-hidden />
                  </button>
                  <InlineConfirm
                    label={t('Remove', '移除')}
                    keepLabel={t('Keep', '保留')}
                    confirmLabel={t('Remove', '移除')}
                    doneLabel={t('Removing…', '即将移除…')}
                    undoLabel={t('Undo', '撤销')}
                    onCommit={() => removeRow(rowId)}
                  />
                </div>
              </div>
              {shape.type === 'string' ? (
                <ItemValue
                  kind={shape.kind}
                  label=""
                  shared={false}
                  en={a}
                  zh={b}
                  ctx={ctx}
                  onChange={(langs, v) => update(i, langs, null, v)}
                  onFocus={(texts, image) => focus(key, texts, image)}
                />
              ) : (
                keys.map((k) => (
                  <ItemValue
                    key={k.key}
                    kind={k.kind}
                    label={labelFor(field.entryId, k.key)[lang]}
                    shared={shared.has(k.key)}
                    en={(a as Record<string, unknown> | undefined)?.[k.key]}
                    zh={(b as Record<string, unknown> | undefined)?.[k.key]}
                    ctx={ctx}
                    onChange={(langs, v) => update(i, langs, k.key, v)}
                    onFocus={(texts, image) => focus(key, texts, image)}
                  />
                ))
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className={SECONDARY} onClick={add}>
        <Plus className="w-4 h-4" aria-hidden />
        {t('Add an item', '添加一项')}
      </button>
    </div>
  );
}

/** One value inside a list item, in both languages (or once, when shared). */
function ItemValue({
  kind,
  label,
  shared,
  en,
  zh,
  ctx,
  onChange,
  onFocus,
}: {
  kind: string;
  label: string;
  shared: boolean;
  en: unknown;
  zh: unknown;
  ctx: EditorCtx;
  onChange: (langs: ContentLang[], v: unknown) => void;
  onFocus: (texts: Texts, image: boolean) => void;
}) {
  const { t } = ctx;
  const lines = kind === 'lines';
  const asText = (v: unknown) => (lines ? (Array.isArray(v) ? v.join('\n') : '') : str(v));
  const fromText = (s: string): unknown => (lines ? s.split('\n') : s);
  const texts = { en: asText(en), zh: asText(zh) };
  const image = kind === 'image';
  const both: ContentLang[] = ['en', 'zh'];

  if (image) {
    return (
      <div className="min-w-0" onFocus={() => onFocus(texts, true)}>
        {label && <span className={LABEL}>{label}</span>}
        {shared ? (
          <PageImageField value={texts.en} onChange={(v) => onChange(both, v)} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <PageImageField value={texts.en} onChange={(v) => onChange(['en'], v)} />
            <PageImageField value={texts.zh} onChange={(v) => onChange(['zh'], v)} />
          </div>
        )}
      </div>
    );
  }
  if (shared) {
    return (
      <TextInput
        kind={kind}
        label={`${label} · ${t('both languages', '中英文相同')}`}
        value={texts.en}
        placeholder=""
        onChange={(v) => {
          onChange(both, fromText(v));
        }}
        onFocus={() => onFocus(texts, false)}
      />
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextInput
        kind={kind}
        label={label ? `${label} · EN` : 'EN'}
        value={texts.en}
        placeholder=""
        onChange={(v) => {
          onChange(['en'], fromText(v));
        }}
        onFocus={() => onFocus(texts, false)}
      />
      <TextInput
        kind={kind}
        label={label ? `${label} · 中文` : '中文'}
        value={texts.zh}
        placeholder=""
        onChange={(v) => {
          onChange(['zh'], fromText(v));
        }}
        onFocus={() => onFocus(texts, false)}
      />
    </div>
  );
}
