import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { MenuSection } from '../components/tokens/Menu';
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
  type Act,
  type Say,
  type Tone,
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
  type MerchantMenu,
  type MerchantRef,
  type MerchantTx,
} from '../lib/tokens';

const PAGE = 50;

// /merchant/ — a shop's own console: what CAACI owes it, its statements, every
// charge with a Void button while the window is open, and the menu the shop
// keeps itself (prices, what is on sale, the printed QR stickers). Customers
// show by family name only; the server sends nothing more (tokens/merchant.js).
//
// ?m=<merchant id> opens that shop straight away, which is how the token back
// office links here. An admin is not on a partner shop's staff list, so the
// shop can be one the list below never offers; the server decides who may read
// it either way, and a refusal arrives as a plain refusal.
export function MerchantPage({ lang }: { lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const signedIn = useSignedIn();
  const asked = useMemo(() => new URLSearchParams(window.location.search).get('m') || '', []);
  const [shops, setShops] = useState<MerchantRef[] | null>(null);
  const [shopId, setShopId] = useState(asked);
  const [data, setData] = useState<MerchantConsole | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);
  const [busyTx, setBusyTx] = useState('');
  // The menu is loaded when it is opened: the counter's list is what this page
  // is for, and most days nobody touches the prices.
  const [menu, setMenu] = useState<MerchantMenu | null>(null);
  const [showMenu, setShowMenu] = useState(false);

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

  const loadMenu = useCallback(async () => {
    if (!shopId) return;
    const res = await tokens.menu(shopId);
    if (res.ok) setMenu(res.data);
    else setError(refusalText(res, lang));
  }, [shopId, lang]);

  useEffect(() => {
    if (showMenu) void loadMenu();
  }, [showMenu, loadMenu]);

  // Every menu write goes through here, so one refusal reads the same as any
  // other and the list is re-read from the server rather than patched locally.
  const say: Say = (tone, text) => {
    if (tone === 'error') {
      setError(text);
      setNote(null);
    } else {
      setError('');
      setNote({ tone, text });
    }
  };
  const act: Act = async (body, ok) => {
    const res = await tokens.menuAction(body);
    if (!res.ok) {
      say('error', refusalText(res, lang));
      return null;
    }
    say('success', ok);
    await loadMenu();
    return res.data;
  };

  // A scan-to-pay charge lands with nobody pressing anything here, and the
  // counter is checking this list against a customer's screen — so the newest
  // page keeps itself current while the console is actually on screen.
  useEffect(() => {
    if (offset !== 0) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => clearInterval(id);
  }, [offset, load]);

  // Tick a scan-to-pay charge off the list once the juice is in their hand.
  // The server refuses a second tick and says who took the first one, so two
  // volunteers serving the same payment find out at the counter.
  const collect = async (row: MerchantTx, collected: boolean) => {
    setBusyTx(row.id);
    setError('');
    setNote(null);
    const res = await tokens.collect(row.id, collected);
    setBusyTx('');
    if (!res.ok) {
      setError(refusalText(res, lang));
      void load(); // whatever really happened is in the list
      return;
    }
    say(
      'success',
      collected
        ? t(`${row.confirm} handed over.`, `${row.confirm} 已标记出货。`)
        : t(`${row.confirm} is waiting again.`, `${row.confirm} 已改回待出货。`),
    );
    void load();
  };

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
    say('success', t(`Returned ${res.data.amount} tokens.`, `已退回 ${res.data.amount} 币。`));
    void load();
  };

  const eyebrow = t('CAACI Tokens', '华协币');
  const title = t('Merchant console', '商家中台');
  // Paid by QR and not handed over yet, on this page of the list.
  const waiting = (data?.rows ?? []).filter((r) => r.can_collect && !r.collected_at).length;

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

  if (shops.length === 0 && !shopId)
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
  // A shop opened by ?m= belongs in the picker too, or the box would sit blank
  // on the very shop the page is showing.
  const picks = m && !shops.some((s) => s.id === m.id) ? [...shops, m] : shops;
  return (
    <ToolPage eyebrow={eyebrow} title={title} wide>
      {picks.length > 1 && (
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
              setMenu(null);
            }}
          >
            {picks.map((s) => (
              <option key={s.id} value={s.id}>
                {pickName(s, lang)}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {!data || !m ? (
        // A refused shop has already said so above; spinning on for ever would
        // only suggest something is still coming.
        !error && <Spinner label={t('Loading…', '加载中…')} />
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

          {/* The shop's own menu: prices, what is on sale today, the QR
              stickers. Closed by default — the list below is what this page is
              open for during an event, and the menu is a before-and-after job. */}
          <div className="pt-6 border-t border-neutral-200/80">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 text-left min-h-[44px] cursor-pointer"
              onClick={() => setShowMenu(!showMenu)}
              aria-expanded={showMenu}
            >
              <span className="text-xs font-semibold text-brick">{t('Menu', '菜单')}</span>
              <span className="text-[11px] text-neutral-500">
                {menu
                  ? t(`${menu.items.length} items`, `${menu.items.length} 项`)
                  : t('Prices and QR stickers', '价格与二维码贴纸')}
                {' · '}
                {showMenu ? t('Hide', '收起') : t('Open', '展开')}
              </span>
            </button>
            {showMenu &&
              (menu ? (
                <MenuSection
                  bare
                  lang={lang}
                  m={menu.merchant}
                  items={menu.items}
                  rate={menu.rate}
                  allowPartners={menu.allow_partners}
                  act={act}
                  say={say}
                />
              ) : (
                <Spinner label={t('Loading…', '加载中…')} />
              ))}
          </div>

          <div className="pt-6 border-t border-neutral-200/80">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-xs font-semibold text-brick">{t('Charges', '扣币记录')}</span>
              <span className="text-[11px] text-neutral-500">
                {/* What the counter is actually waiting on, before the total. */}
                {waiting > 0 && (
                  <span className="font-semibold text-brick">
                    {t(`${waiting} to hand over · `, `${waiting} 笔待出货 · `)}
                  </span>
                )}
                {data.total} {t('in total', '条')}
              </span>
            </div>
            {data.rows.length === 0 ? (
              <p className="text-xs text-neutral-500">{t('Nothing yet.', '暂无记录。')}</p>
            ) : (
              <ul className="divide-y divide-neutral-200/80">
                {data.rows.map((row) => (
                  <li key={row.id} className={`py-3 ${row.collected_at ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-900">
                          {row.customer}
                          {row.confirm && (
                            // What the customer's own screen shows. Check it —
                            // a screenshot of an old payment looks the same.
                            <span className="ml-2 font-mono tracking-widest text-brick">
                              {row.confirm}
                            </span>
                          )}
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
                          {row.self_serve ? t('Scanned the QR', '顾客扫码支付') : row.by}
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
                    </div>
                    {/* Scan-to-pay only: nothing was handed over at a till, so
                        the stall ticks it off here — and the server refuses a
                        second tick, which is how two volunteers serving one
                        payment find out before the juice is gone. */}
                    {row.can_collect &&
                      (row.collected_at ? (
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <Status tone="good">
                            {t('Handed over', '已出货')} {when(row.collected_at, lang)}
                            {row.collected_by ? ` · ${row.collected_by}` : ''}
                          </Status>
                          <button
                            type="button"
                            disabled={busyTx === row.id}
                            onClick={() => void collect(row, false)}
                            className="min-h-[44px] text-xs font-semibold text-neutral-500 hover:text-brick cursor-pointer"
                          >
                            {t('Undo', '撤销出货')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busyTx === row.id}
                          onClick={() => void collect(row, true)}
                          className="mt-2 w-full min-h-[44px] rounded-xl bg-brick/10 text-brick text-xs font-semibold inline-flex items-center justify-center gap-2 hover:bg-brick/20 cursor-pointer disabled:opacity-60"
                        >
                          <Check className="w-4 h-4" aria-hidden />
                          {busyTx === row.id
                            ? t('Ticking…', '处理中…')
                            : t(`Hand over ${row.confirm}`, `出货 ${row.confirm}`)}
                        </button>
                      ))}
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
              'Amounts on the right are tokens your shop received (+) or gave back (−). To take tokens, scan the customer’s member card with your phone camera. A customer who scanned a QR on the product shows a four-character code — find it in this list before you hand anything over; this list, not their screen, is the proof.',
              '右侧数字为本店收到（+）或退回（−）的币数。扣币请用手机相机扫描顾客的会员卡。顾客扫商品二维码付款后会看到一个四位确认码——出货前请在此列表中找到它；凭证是这份列表，不是顾客的手机屏幕。',
            )}
          </p>
        </>
      )}
    </ToolPage>
  );
}
