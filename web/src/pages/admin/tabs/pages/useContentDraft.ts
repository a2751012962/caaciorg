// The Page content tab's state: what is saved (GET /api/admin/site-content),
// the editor's unsaved draft on top of it, and the one PUT that saves it. The
// rules (what counts as a change, null to clear, the preview's full set) are
// in lib/siteContentCore.js; this only wires them to React.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultOf, type ContentLang, type OverrideSet } from '../../../../lib/siteContent';
import {
  currentValue,
  diffDraft,
  effectiveOverrides,
  rowsToOverrides,
} from '../../../../lib/siteContentCore';
import { useAdmin, useLoad } from '../../kit';

type Row = {
  key: string;
  value_en: unknown;
  value_zh: unknown;
  updated_at?: string;
  updated_by_name?: string | null;
};

// The draft survives switching to another admin tab and back (the tab
// unmounts); it is per browser tab and goes when it closes.
const DRAFT_KEY = 'caaci-cms-draft';
const readDraft = (): OverrideSet => {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as OverrideSet) : {};
  } catch {
    return {};
  }
};

export function useContentDraft() {
  const { t, api, toast } = useAdmin();
  const load = useLoad(async () => {
    const res = await api<{ rows: Row[] }>('/api/admin/site-content');
    if (!res.ok && res.status !== 403 && !res.data.error)
      res.data.error = t('Could not load the page content.', '无法加载页面内容。');
    return res;
  });
  const saved = useMemo<OverrideSet>(
    () => rowsToOverrides(load.data?.rows ?? []) as OverrideSet,
    [load.data],
  );
  const rows = useMemo(() => new Map((load.data?.rows ?? []).map((r) => [r.key, r])), [load.data]);
  const [draft, setDraft] = useState<OverrideSet>(readDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      if (Object.keys(draft).length) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Storage blocked: the draft lives as long as the tab is open.
    }
  }, [draft]);

  const value = useCallback(
    (key: string, lang: ContentLang): unknown => currentValue(saved, draft, defaultOf, key, lang),
    [saved, draft],
  );
  /** Sets one language, or both when `zh` is given too. */
  const set = useCallback((key: string, values: { en?: unknown; zh?: unknown }) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...values } }));
  }, []);
  const reset = useCallback(
    (key: string) => set(key, { en: defaultOf(key, 'en'), zh: defaultOf(key, 'zh') }),
    [set],
  );

  const changes = useMemo(
    () => diffDraft(saved, draft, defaultOf) as { key: string; en?: unknown; zh?: unknown }[],
    [saved, draft],
  );
  const changed = useMemo(() => new Set(changes.map((c) => c.key)), [changes]);
  const effective = useMemo(
    () => effectiveOverrides(saved, draft, defaultOf) as OverrideSet,
    [saved, draft],
  );

  const save = useCallback(async () => {
    if (!changes.length) return;
    setSaving(true);
    const res = await api('/api/admin/site-content', { method: 'PUT', body: { changes } });
    if (res.ok) await load.reload();
    setSaving(false);
    if (!res.ok) {
      toast('error', res.data.error || t('Could not save.', '保存失败。'));
      return;
    }
    setDraft({});
    toast(
      'success',
      t(
        'Saved. Visitors see the new text within a minute.',
        '已保存。访客一分钟内即可看到新内容。',
      ),
    );
  }, [api, changes, load, t, toast]);

  return {
    loading: load.loading && !load.data,
    error: load.error,
    saved,
    rows,
    value,
    set,
    reset,
    changes,
    changed,
    effective,
    discard: () => setDraft({}),
    save,
    saving,
  };
}

export type ContentDraft = ReturnType<typeof useContentDraft>;
