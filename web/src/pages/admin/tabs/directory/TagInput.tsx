import { useRef } from 'react';
import { X } from 'lucide-react';
import { useAdmin } from '../../kit';
import { MAX_TAG_LENGTH, commitTag } from './shared';

// A free-text tag box: type a tag and press Enter (or a comma) to add it; the ×
// on a chip removes it, and Backspace in the empty box removes the last one.
// The typed-but-not-added text lives in the parent (`entry`), so Save can count
// it too, as the old panel's commitTags did.
export function TagInput({
  id,
  tags,
  entry,
  onChange,
}: {
  id?: string;
  tags: string[];
  entry: string;
  onChange: (tags: string[], entry: string) => void;
}) {
  const { t } = useAdmin();
  const input = useRef<HTMLInputElement>(null);
  const commit = () => {
    const r = commitTag(tags, entry);
    if (r.tags !== tags || r.entry !== entry) onChange(r.tags, r.entry);
  };

  return (
    <div
      className="w-full min-h-[44px] px-2 py-1.5 bg-neutral-50 border border-neutral-300 rounded-xl flex flex-wrap items-center gap-1.5 cursor-text focus-within:ring-2 focus-within:ring-brick"
      onClick={(e) => e.target === e.currentTarget && input.current?.focus()}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 pl-2.5 pr-1 py-0.5 rounded-full bg-neutral-100 text-xs text-neutral-700"
        >
          {tag}
          <button
            type="button"
            className="relative w-6 h-6 rounded-full inline-flex items-center justify-center text-neutral-500 hover:bg-neutral-200 hover:text-ink cursor-pointer before:absolute before:-inset-2.5 before:content-['']"
            aria-label={t(`Remove ${tag}`, `移除 ${tag}`)}
            onClick={() =>
              onChange(
                tags.filter((x) => x !== tag),
                entry,
              )
            }
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={input}
        id={id}
        type="text"
        className="flex-1 min-w-[8rem] h-8 px-1.5 bg-transparent text-sm text-ink outline-none"
        maxLength={MAX_TAG_LENGTH}
        placeholder={t('Type a tag, press Enter', '输入标签后按回车')}
        value={entry}
        onChange={(e) => onChange(tags, e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return; // a Chinese IME is still choosing
          if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !entry && tags.length) {
            onChange(tags.slice(0, -1), entry);
          }
        }}
      />
    </div>
  );
}
