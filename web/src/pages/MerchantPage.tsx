import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  INPUT,
  LABEL,
  Notice,
  SECONDARY,
  Spinner,
  Status,
  ToolPage,
  tr,
  useSignedIn,
} from '../components/tokens/ui';
import type { Lang } from '../lib/lang';
import {
  day,
  kindLabel,
  lineText,
  pickName,
  refusalText,
  tokens,
  usd,
  when,
  type MerchantConsole,
  type MerchantRef,
  type MerchantTx,
} from '../lib/tokens';

const PAGE = 50;

// /merchant/ — a shop's own console: what CAACI owes it, its statements, and
// every charge with a Void button while the window is open. Customers show by
// family name only; the server sends nothing more (tokens/merchant.js).
export function MerchantPage({ lang }: { lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const signedIn = useSignedIn();
  const [shops, setShops] = useState<MerchantRef[] | null>(null);
  const [shopId, setShopId] = useState('');
  const [data, setData] = useState<MerchantConsole | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyTx, setBusyTx] = useState('');

  useEffect(() => {
    if (!signedIn) return;
    void tokens.myMerchants().then((res) => {
      if (!res.ok) return setError(refusalText(res, lang));
      setShops(res.data.merchants);
      setShopId((current) => current || res.data.merchants[0]?.id || '');
    });
  }, [signedIn, lang]);

  const load = useCallback(async () => {
    if (!shopId) return;
    const res = await tokens.merchant(shopId, offset);
    if (res.ok) {
      setData(res.data);
      setError('');
    } else setError(refusalText(res, lang));
  }, [shopId, offset, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const voidTx = async (row: MerchantTx) => {
    const ok = window.confirm(
      t(
        `Cancel this charge and return ${-row.amount} tokens to ${row.customer}?`,
        `撤销这笔扣币，把 ${-row.amount} 币退还给 ${row.customer}？`,
      ),
    );
    if (!ok) return;
    setBusyTx(row.id);
    const res = await tokens.void(row.id, 'voided from the merchant console');
    setBusyTx('');
    if (!res.ok) return setError(refusalText(res, lang));
    setNotice(t(`Returned ${res.data.amount} tokens.`, `已退回 ${res.data.amount} 币。`));
    void load();
  };

  const eyebrow = t('CAACI Tokens', '华协币');
  const title = t('Merchant console', '商家中台');

  if (!signedIn || shops === null)
    return (
      <ToolPage eyebrow={eyebrow} title={title} wide>
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <Spinner label={t('Loading…', '加载中…')} />
        )}
      </ToolPage>
    );

  if (shops.length === 0)
    return (
      <ToolPage eyebrow={eyebrow} title={title} wide>
        <Notice tone="warn">
          {t(
            'This account is not on any merchant’s staff list. Ask CAACI to add it.',
            '该账号不在任何商家的店员名单中，请联系华协添加。',
          )}
        </Notice>
      </ToolPage>
    );

  const m = data?.merchant;
  return (
    <ToolPage eyebrow={eyebrow} title={title} wide>
      {shops.length > 1 && (
        <div className="max-w-sm">
          <label className={LABEL} htmlFor="merchant-pick">
            {t('Merchant', '商家')}
          </label>
          <select
            id="merchant-pick"
            className={INPUT}
            value={shopId}
            onChange={(e) => {
              setShopId(e.target.value);
              setOffset(0);
              setData(null);
            }}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {pickName(s, lang)}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {!data || !m ? (
        <Spinner label={t('Loading…', '加载中…')} />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-6 sm:gap-10 items-start">
            <div className="bg-ink text-white rounded-2xl p-6 shadow-xl border border-white/10">
              <p className="text-[11px] text-neutral-400">{pickName(m, lang)}</p>
              {m.kind === 'internal' ? (
                <>
                  <p className="text-3xl font-bold text-gold tabular-nums mt-1">
                    {data.open.tokens}
                  </p>
                  <p className="text-xs text-neutral-300 mt-1">
                    {t(
                      'tokens taken at CAACI’s own stalls (never paid out)',
                      '华协自有摊位收到的币（不结算）',
                    )}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold text-gold tabular-nums mt-1">
                    {usd(data.open.amount_cents)}
                  </p>
                  <p className="text-xs text-neutral-300 mt-1">
                    {t(
                      `CAACI owes you for ${data.open.tokens} tokens not on a statement yet`,
                      `尚未出账的 ${data.open.tokens} 币，华协应付金额`,
                    )}
                  </p>
                </>
              )}
              <div className="mt-3">
                {m.status === 'active' ? (
                  <span className="text-xs text-emerald-300">{t('Active', '正常')}</span>
                ) : (
                  <span className="text-xs text-rose-300">
                    {t('Suspended', '已暂停')}
                    {m.suspended_reason ? ` · ${m.suspended_reason}` : ''}
                  </span>
                )}
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold text-brick block mb-3">
                {t('Statements', '月结对账单')}
              </span>
              {data.settlements.length === 0 ? (
                <p className="text-xs text-neutral-500 leading-relaxed">
                  {m.kind === 'internal'
                    ? t('CAACI’s own merchant has no statements.', '华协内部商家没有对账单。')
                    : t(
                        'None yet. CAACI closes a statement each month and pays by the 10th. A month under $20 rolls into the next one.',
                        '暂无。华协每月出一次对账单，次月 10 日前付款；不满 $20 的月份滚入下月。',
                      )}
                </p>
              ) : (
                <ul className="divide-y divide-neutral-200/80">
                  {data.settlements.map((s) => (
                    <li key={s.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                      <span className="text-neutral-700">
                        {t('to', '截至')} {day(s.period_end, lang)} · {s.tokens} {t('tokens', '币')}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-semibold tabular-nums text-neutral-900">
                          {usd(s.amount_cents)}
                        </span>
                        {s.status === 'paid' ? (
                          <Status tone="good">
                            {t('Paid', '已付')}
                            {s.reference ? ` · ${s.reference}` : ''}
                          </Status>
                        ) : (
                          <Status tone="warn">{t('Due', '待付')}</Status>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="pt-6 border-t border-neutral-200/80">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-xs font-semibold text-brick">{t('Charges', '扣币记录')}</span>
              <span className="text-[11px] text-neutral-500">
                {data.total} {t('in total', '条')}
              </span>
            </div>
            {data.rows.length === 0 ? (
              <p className="text-xs text-neutral-500">{t('Nothing yet.', '暂无记录。')}</p>
            ) : (
              <ul className="divide-y divide-neutral-200/80">
                {data.rows.map((row) => (
                  <li key={row.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-900">
                        {row.customer}
                        <span className="ml-2 text-xs font-normal text-neutral-500">
                          {when(row.at, lang)}
                        </span>
                      </p>
                      <p className="text-xs text-neutral-600 truncate">
                        {row.kind === 'charge'
                          ? lineText(row.items, lang) || row.note
                          : kindLabel(row.kind, lang)}
                        {row.kind === 'charge' && row.note && lineText(row.items, lang)
                          ? ` · ${row.note}`
                          : ''}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        {row.by}
                        {row.settled ? ` · ${t('on a statement', '已出账')}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p
                        className={`text-sm font-bold tabular-nums ${row.amount < 0 ? 'text-neutral-900' : 'text-rose-700'}`}
                      >
                        {row.amount < 0 ? `+${-row.amount}` : `−${row.amount}`}
                      </p>
                      {row.state === 'voided' && (
                        <Status tone="muted">{t('Voided', '已撤销')}</Status>
                      )}
                      {row.state === 'reversed' && (
                        <Status tone="bad">{t('Reversed', '已冲回')}</Status>
                      )}
                      {row.state === 'disputed' && (
                        <Status tone="warn">{t('Disputed', '争议中')}</Status>
                      )}
                      {row.can_void && (
                        <button
                          type="button"
                          disabled={busyTx === row.id}
                          onClick={() => void voidTx(row)}
                          className="min-h-[44px] inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 hover:text-brick cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden />
                          {t('Void', '撤销')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data.total > PAGE && (
              <div className="flex justify-between pt-4">
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  {t('Newer', '较新')}
                </button>
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={offset + PAGE >= data.total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  {t('Older', '较早')}
                </button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-neutral-500 leading-relaxed">
            {t(
              'Amounts on the right are tokens your shop received (+) or gave back (−). To take tokens, scan the customer’s member card with your phone camera.',
              '右侧数字为本店收到（+）或退回（−）的币数。扣币请用手机相机扫描顾客的会员卡。',
            )}
          </p>
        </>
      )}
    </ToolPage>
  );
}
