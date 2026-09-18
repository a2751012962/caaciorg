import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil } from 'lucide-react';
import { withFee } from '../../../lib/shared';
import { listExit, mountIn, riseFromSm, shown } from '../../../lib/motion';
import { DataTable, Loaded, Notice, ROW_BTN, TabHeader, usd, useAdmin, useLoad } from '../kit';
import { PlanForm, type PlanRow } from './plans/PlanForm';

// Membership plans (price + card copy): everything /membership/ shows on a
// plan card. One editor at a time opens above the list (it holds the preview
// iframe, so it stays out of the table, which renders its rows twice).
// functions/api/admin/tiers.js.
export default function PlansTab() {
  const { t, api } = useAdmin();
  const list = useLoad(async () => {
    const res = await api<{ rows: PlanRow[] }>('/api/admin/tiers');
    if (!res.ok && res.status !== 403 && !res.data.error)
      res.data.error = t('Could not load plans.', '无法加载会员方案。');
    return res;
  });
  const rows = list.data?.rows ?? [];
  const [open, setOpen] = useState<PlanRow | null>(null);
  const [saved, setSaved] = useState('');

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Plans', '会员方案')}
        description={t(
          "Edit each plan's price and the text on its card on the Membership page. A new price applies to new sign-ups and plan switches; existing subscribers keep the price they joined at when they renew.",
          '编辑各会员方案的价格及会员页卡片上的文字。新价格适用于新加入和更换方案的会员；已订阅的会员续费时仍按原价。',
        )}
      />

      {saved && <Notice tone="success">{saved}</Notice>}
      {list.error && list.data && <Notice tone="error">{list.error}</Notice>}

      <AnimatePresence initial={false} mode="wait">
        {open && (
          <motion.div
            key={open.id}
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
          >
            <PlanForm
              plan={open}
              onCancel={() => setOpen(null)}
              onSaved={() => {
                setSaved(t(`${open.name} saved.`, `${open.name} 已保存。`));
                setOpen(null);
                void list.reload();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Loaded
        loading={list.loading}
        error={list.data ? '' : list.error}
        isEmpty={list.data ? rows.length === 0 : undefined}
      >
        <DataTable
          rows={rows}
          rowKey={(p) => p.id}
          columns={[
            {
              key: 'plan',
              label: t('Plan', '方案'),
              render: (p) => (
                <span className="inline-block min-w-0">
                  <span className="font-semibold text-ink">{p.name}</span>
                  {p.invite_only && (
                    <span className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-neutral-900 text-white whitespace-nowrap">
                      {t('Invitation only', '仅限邀请')}
                    </span>
                  )}
                  {p.active === false && (
                    <span className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 whitespace-nowrap">
                      {t('Hidden', '已隐藏')}
                    </span>
                  )}
                  <span className="block text-xs text-neutral-500 font-mono">{p.id}</span>
                </span>
              ),
            },
            {
              key: 'price',
              label: t('Annual price', '年费'),
              className: 'tabular-nums',
              render: (p) =>
                p.price_cents > 0 ? (
                  <span className="inline-block">
                    {usd(p.price_cents)}
                    <span className="block text-xs text-neutral-500">
                      {t('by card', '刷卡')} {usd(withFee(p.price_cents))}
                    </span>
                  </span>
                ) : (
                  t('Free', '免费')
                ),
            },
            {
              key: 'lines',
              label: t('Card benefits', '卡片权益'),
              render: (p) => {
                const en = (p.features || []).length;
                const zh = (p.features_zh || []).length;
                return en || zh ? (
                  t(`${en} English · ${zh} Chinese`, `英文 ${en} 条 · 中文 ${zh} 条`)
                ) : (
                  <span className="text-neutral-500">{t('Built-in text', '使用内置文字')}</span>
                );
              },
            },
          ]}
          actions={(p) => (
            <button
              type="button"
              className={ROW_BTN}
              aria-expanded={open?.id === p.id}
              onClick={() => {
                setSaved('');
                setOpen((o) => (o?.id === p.id ? null : p));
              }}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden />
              {t('Edit', '编辑')}
            </button>
          )}
        />
      </Loaded>
    </div>
  );
}
