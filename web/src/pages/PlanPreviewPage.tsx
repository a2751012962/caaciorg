import { useEffect, useState } from 'react';
import { PlanCard } from '../components/PlanCard';
import { mergeTiers } from '../lib/shared';
import type { Tier } from '../lib/tiers';

// /plan-preview/ — the admin Plans tab loads this in an iframe beside its edit
// form and posts the unsaved plan here as it is typed, so staff see the real
// /membership/ card (English and Chinese) before saving. It has no site chrome,
// reads nothing, and only accepts messages from the page that framed it on this
// same origin.
export const PLAN_PREVIEW_MESSAGE = 'caaci-plan-preview';

export function PlanPreviewPage() {
  const [tier, setTier] = useState<Tier | null>(null);

  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const data = e.data as { type?: string; tier?: Tier } | null;
      // Merged the way /membership/ merges a live row, so the Chinese name and
      // the built-in lines fill in exactly as they would there.
      if (data?.type === PLAN_PREVIEW_MESSAGE && data.tier) {
        const draft = data.tier;
        const merged = (mergeTiers([draft]) as unknown as Tier[]).find((x) => x.id === draft.id);
        setTier(merged ?? draft);
      }
    };
    window.addEventListener('message', onMessage);
    // Ask the admin page for the current draft (it may have posted before we listened).
    if (window.parent !== window)
      window.parent.postMessage({ type: `${PLAN_PREVIEW_MESSAGE}-ready` }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!tier)
    return (
      <p className="p-6 text-xs text-neutral-500">
        Open a plan in the admin Plans tab to preview it here. /
        在后台“会员方案”中编辑方案即可在此预览。
      </p>
    );

  return (
    <div className="min-h-screen bg-surface-3 p-6 font-sans">
      <div className="grid grid-cols-2 gap-6 max-w-[680px] mx-auto">
        {(['en', 'zh'] as const).map((lang) => (
          <div key={lang} className="flex flex-col gap-5" data-preview-lang={lang}>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
              {lang === 'en' ? 'English page' : '中文页'}
            </div>
            <PlanCard tier={tier} lang={lang} />
          </div>
        ))}
      </div>
    </div>
  );
}
