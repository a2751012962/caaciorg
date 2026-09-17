import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Gift, Minus, Plus, PlusCircle, RotateCcw, ScanLine } from 'lucide-react';
import { FluidTabs } from '../components/FluidTabs';
import {
  CARD,
  INPUT,
  LABEL,
  Notice,
  PRIMARY,
  SECONDARY,
  Spinner,
  Status,
  ToolPage,
  tr,
  useSignedIn,
} from '../components/tokens/ui';
import type { ApiResult } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Lang } from '../lib/lang';
import {
  day,
  newIdemKey,
  pickName,
  refusalText,
  tokens,
  usd,
  type Refusal,
  type Scan,
} from '../lib/tokens';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAST_MERCHANT = 'caaci-token-merchant';
const LAST_GROUP = 'caaci-token-group';
const CASH_QUICK = [500, 1000, 2000, 5000];

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the choice just isn't remembered
  }
};
const recall = (key: string) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

interface Done {
  txId: string;
  amount: number;
  balance: number;
  undone: boolean;
}

// /charge/?m=<member uuid> — where the "Merchant sign-in" button on a scanned
// member card (/api/verify) lands. A merchant's staff pick what was bought and
// take the tokens; an admin at an event desk can also grant the year's tokens
// and take cash. The server decides what this account may do (tokens/scan.js).
export function ChargePage({ lang }: { lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const signedIn = useSignedIn();
  const auth = useAuth();
  const memberId = useMemo(() => new URLSearchParams(window.location.search).get('m') || '', []);

  const [scan, setScan] = useState<Scan | null>(null);
  const [loadError, setLoadError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [merchantId, setMerchantId] = useState('');
  const [group, setGroup] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  // one key per basket: a retry after a dropped connection must not charge twice
  const [idem, setIdem] = useState(newIdemKey);

  const load = useCallback(async () => {
    if (!UUID_RE.test(memberId)) return;
    const res = await tokens.scan(memberId);
    if (res.ok) {
      setScan(res.data);
      setLoadError('');
      const usable = res.data.merchants.filter((m) => m.status === 'active');
      const last = recall(LAST_MERCHANT);
      setMerchantId(
        (current) => current || (usable.find((m) => m.id === last) ?? usable[0])?.id || '',
      );
    } else if (res.status === 403) {
      setForbidden(true);
    } else {
      setLoadError(refusalText(res, lang));
    }
  }, [memberId, lang]);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  const merchant = scan?.merchants.find((m) => m.id === merchantId) ?? null;
  const groups = useMemo(
    () => [...new Set((merchant?.items ?? []).map((i) => i.group_label || ''))].filter(Boolean),
    [merchant],
  );
  useEffect(() => {
    if (!groups.length) return setGroup('');
    setGroup((current) =>
      groups.includes(current)
        ? current
        : groups.includes(recall(LAST_GROUP))
          ? recall(LAST_GROUP)
          : groups[0],
    );
  }, [groups]);

  const visibleItems = (merchant?.items ?? []).filter(
    (i) => !groups.length || (i.group_label || '') === group,
  );
  const customTokens = /^\d+$/.test(custom) ? Number(custom) : 0;
  const total =
    (merchant?.items ?? []).reduce((sum, i) => sum + i.tokens * (qty[i.id] || 0), 0) + customTokens;
  const max = scan?.limits.max_charge ?? 500;
  const short = scan ? total - scan.balance : 0;

  const resetBasket = () => {
    setQty({});
    setCustom('');
    setNote('');
    setConfirming(false);
    setError('');
    setIdem(newIdemKey());
  };

  const bump = (id: string, by: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(50, (q[id] || 0) + by)) }));

  const submit = async () => {
    if (!scan || !merchant || total <= 0) return;
    setBusy(true);
    setError('');
    const res = await tokens.charge({
      member_id: scan.member.id,
      merchant_id: merchant.id,
      items: Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ id, qty: n })),
      custom_tokens: customTokens,
      note: note.trim(),
      idem_key: idem,
    });
    setBusy(false);
    if (!res.ok) {
      setConfirming(false);
      setError(refusalText(res, lang));
      if (typeof (res.data as { balance?: number }).balance === 'number') void load();
      return;
    }
    setDone({
      txId: res.data.tx_id,
      amount: res.data.amount,
      balance: res.data.balance,
      undone: false,
    });
    setScan((s) => (s ? { ...s, balance: res.data.balance } : s));
    resetBasket();
  };

  const undo = async () => {
    if (!done) return;
    setBusy(true);
    const res = await tokens.void(done.txId, 'undo at the counter');
    setBusy(false);
    if (!res.ok) return setError(refusalText(res, lang));
    const balance = res.data.balance ?? done.balance + done.amount;
    setDone({ ...done, balance, undone: true });
    setScan((s) => (s ? { ...s, balance } : s));
  };

  const eyebrow = t('CAACI Tokens', '华协币');
  if (!UUID_RE.test(memberId))
    return (
      <ToolPage eyebrow={eyebrow} title={t('Scan a member card', '请扫描会员卡')}>
        <div className={`${CARD} flex items-start gap-3 text-sm text-neutral-700 leading-relaxed`}>
          <ScanLine className="w-5 h-5 text-brick shrink-0 mt-0.5" aria-hidden />
          <p>
            {t(
              'Open your phone camera, scan the QR code on the member’s card, then tap “Merchant sign-in” on the page that opens.',
              '打开手机相机，扫描会员卡上的二维码，在打开的页面上点“商家登录扣币”。',
            )}
          </p>
        </div>
        <a href={lang === 'zh' ? '/zh/merchant/' : '/merchant/'} className={SECONDARY}>
          {t('Merchant console', '商家中台')}
        </a>
      </ToolPage>
    );

  if (forbidden)
    return (
      <ToolPage eyebrow={eyebrow} title={t('Not a merchant account', '不是商家账号')}>
        <Notice tone="warn">
          {t(
            `You are signed in as ${auth.user?.email ?? ''}. This account is not on any merchant’s staff list, so it cannot take tokens. Ask CAACI to add it, or sign in with your merchant account.`,
            `当前登录账号为 ${auth.user?.email ?? ''}。该账号不在任何商家的店员名单中，不能扣币。请联系华协添加，或改用商家账号登录。`,
          )}
        </Notice>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => void auth.signOut().then(() => window.location.reload())}
        >
          {t('Sign in with another account', '换一个账号登录')}
        </button>
      </ToolPage>
    );

  if (loadError)
    return (
      <ToolPage eyebrow={eyebrow} title={t('Take tokens', '扣币')}>
        <Notice tone="error">{loadError}</Notice>
        <button type="button" className={SECONDARY} onClick={() => void load()}>
          {t('Try again', '重试')}
        </button>
      </ToolPage>
    );

  if (!signedIn || !scan)
    return (
      <ToolPage eyebrow={eyebrow} title={t('Take tokens', '扣币')}>
        <Spinner label={t('Loading…', '加载中…')} />
      </ToolPage>
    );

  const usable = scan.merchants.filter((m) => m.status === 'active');

  return (
    <ToolPage eyebrow={eyebrow} title={t('Take tokens', '扣币')}>
      {/* who is at the counter */}
      <div className="bg-ink text-white rounded-2xl p-6 shadow-xl border border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] text-neutral-400">{t('Customer', '顾客')}</p>
            <p className="text-2xl font-bold font-serif-caaci truncate">{scan.member.name}</p>
            <p className="text-xs text-neutral-300 mt-1">
              {scan.member.valid
                ? `${scan.member.tier_name ?? t('Member', '会员')}${scan.member.until ? ` · ${t('to', '至')} ${day(scan.member.until, lang)}` : ''}`
                : t('No valid membership', '会员资格无效或已过期')}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-neutral-400">{t('Balance', '余额')}</p>
            <p className="text-3xl font-bold text-gold tabular-nums">{scan.balance}</p>
          </div>
        </div>
      </div>

      {done && (
        <Notice tone={done.undone ? 'warn' : 'success'}>
          {done.undone
            ? t(
                `Cancelled. ${done.amount} tokens went back. Balance ${done.balance}.`,
                `已撤销，${done.amount} 币已退回。余额 ${done.balance}。`,
              )
            : t(
                `Took ${done.amount} tokens. New balance ${done.balance}. The member gets an email receipt.`,
                `已扣 ${done.amount} 币，余额 ${done.balance}。会员会收到邮件回执。`,
              )}
          {!done.undone && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={busy}
              className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden />
              {t('Undo', '撤销')}
            </button>
          )}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {scan.member.is_self ? (
        <Notice tone="warn">
          {t(
            'This is your own card. You cannot charge yourself.',
            '这是你自己的会员卡，不能给自己扣币。',
          )}
        </Notice>
      ) : usable.length === 0 ? (
        <Notice tone="warn">
          {scan.merchants.length
            ? t(
                'Your merchant is suspended. Please contact CAACI.',
                '你的商家已被暂停，请联系华协。',
              )
            : t(
                'No merchant to charge for. Ask a CAACI admin to set one up.',
                '没有可用的商家，请联系华协管理员创建。',
              )}
        </Notice>
      ) : (
        <div className={`${CARD} space-y-5`}>
          {usable.length > 1 && (
            <div>
              <label className={LABEL} htmlFor="charge-merchant">
                {t('Charging for', '扣币商家')}
              </label>
              <select
                id="charge-merchant"
                className={INPUT}
                value={merchantId}
                onChange={(e) => {
                  setMerchantId(e.target.value);
                  remember(LAST_MERCHANT, e.target.value);
                  resetBasket();
                }}
              >
                {usable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {pickName(m, lang)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {usable.length === 1 && merchant && (
            <p className="text-xs text-neutral-500">
              {t('Charging for', '扣币商家')}:{' '}
              <span className="font-semibold text-neutral-800">{pickName(merchant, lang)}</span>
            </p>
          )}

          {groups.length > 1 && (
            <FluidTabs
              id="charge-stall"
              value={group}
              onChange={(g: string) => {
                setGroup(g);
                remember(LAST_GROUP, g);
              }}
              items={groups.map((g) => ({ value: g, label: g }))}
              className="flex overflow-x-auto"
            />
          )}

          {visibleItems.length > 0 && (
            <ul className="space-y-2">
              {visibleItems.map((item) => {
                const n = qty[item.id] || 0;
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${n ? 'border-brick/40 bg-white' : 'border-neutral-200/80 bg-white'}`}
                  >
                    <button
                      type="button"
                      onClick={() => bump(item.id, 1)}
                      className="flex-1 min-w-0 text-left min-h-[44px] cursor-pointer"
                    >
                      <span className="block text-sm font-semibold text-neutral-900 truncate">
                        {lang === 'zh' && item.name_zh ? item.name_zh : item.name}
                      </span>
                      <span className="block text-xs text-neutral-500 tabular-nums">
                        {item.tokens} {t('tokens', '币')}
                      </span>
                    </button>
                    {n > 0 && (
                      <button
                        type="button"
                        aria-label={t('One fewer', '减一份')}
                        onClick={() => bump(item.id, -1)}
                        className="w-11 h-11 rounded-full border border-neutral-300 flex items-center justify-center text-neutral-700 hover:border-neutral-800 cursor-pointer"
                      >
                        <Minus className="w-4 h-4" aria-hidden />
                      </button>
                    )}
                    {n > 0 && (
                      <span className="w-6 text-center text-sm font-bold tabular-nums">{n}</span>
                    )}
                    <button
                      type="button"
                      aria-label={t('One more', '加一份')}
                      onClick={() => bump(item.id, 1)}
                      className="w-11 h-11 rounded-full bg-brick/10 text-brick flex items-center justify-center hover:bg-brick/20 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="charge-custom">
                {t('Other amount (tokens)', '其他金额（币）')}
              </label>
              <input
                id="charge-custom"
                className={INPUT}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="charge-note">
                {t('Note (optional)', '备注（可选）')}
              </label>
              <input
                id="charge-note"
                className={INPUT}
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {total > max && (
            <Notice tone="warn">
              {t(
                `One charge can take at most ${max} tokens. Split it into two.`,
                `单笔最多扣 ${max} 币，请分两笔。`,
              )}
            </Notice>
          )}
          {total > 0 && short > 0 && (
            <Notice tone="warn">
              {t(
                `${short} tokens short. That is ${usd((short * 100) / scan.limits.rate)} to pay another way, or top up first.`,
                `还差 ${short} 币（约 ${usd((short * 100) / scan.limits.rate)}），请用其他方式补足或先充值。`,
              )}
            </Notice>
          )}

          {!confirming ? (
            <button
              type="button"
              className={`${PRIMARY} w-full`}
              disabled={total <= 0 || total > max || short > 0}
              onClick={() => setConfirming(true)}
            >
              {total > 0
                ? t(`Take ${total} tokens`, `扣 ${total} 币`)
                : t('Pick what was bought', '请选择商品')}
            </button>
          ) : (
            <div className="space-y-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm text-amber-900 font-semibold">
                {t(
                  `Say it out loud: “${scan.member.name}, ${total} tokens — is that right?”`,
                  `请口头确认：“${scan.member.name}，扣 ${total} 币，对吗？”`,
                )}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${PRIMARY} flex-1`}
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {busy ? t('Taking…', '扣币中…') : t('Confirmed — take them', '已确认，扣币')}
                </button>
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  {t('Back', '返回')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {scan.admin && (
        <AdminDesk
          scan={scan}
          lang={lang}
          onBalance={(balance) => setScan((s) => (s ? { ...s, balance } : s))}
        />
      )}

      <p className="text-[11px] text-neutral-500 text-center">
        {t(
          'Next customer: scan their card with your phone camera.',
          '下一位顾客：用手机相机扫描对方的会员卡。',
        )}
      </p>
    </ToolPage>
  );
}

// What an admin does at an event desk, on the same scan: grant the year's
// tokens, take cash, or add tokens with a reason. The caps are the server's.
function AdminDesk({
  scan,
  lang,
  onBalance,
}: {
  scan: Scan;
  lang: Lang;
  onBalance: (n: number) => void;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [cash, setCash] = useState('');
  const [mint, setMint] = useState('');
  const [reason, setReason] = useState('');
  const id = scan.member.id;
  const cashCents = /^\d+(\.\d{1,2})?$/.test(cash) ? Math.round(Number(cash) * 100) : 0;

  const run = async <T extends { balance: number }>(
    key: string,
    call: () => Promise<ApiResult<T & Refusal>>,
    said: (data: T) => string,
  ) => {
    setBusy(key);
    setMessage(null);
    const res = await call();
    setBusy('');
    if (!res.ok) return setMessage({ tone: 'error', text: refusalText(res, lang) });
    onBalance(res.data.balance);
    setMessage({ tone: 'success', text: said(res.data) });
  };

  return (
    <div className={`${CARD} space-y-5`}>
      <div>
        <span className="text-xs font-semibold text-brick block">
          {t('Admin desk', '管理员操作')}
        </span>
        <p className="text-xs text-neutral-500 mt-1">
          {t('Only CAACI admins see this part.', '仅华协管理员可见。')}
        </p>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="space-y-2">
        <p className={LABEL}>{t('This year’s membership tokens', '本年度会员赠币')}</p>
        {scan.grant_target > 0 && scan.member.valid ? (
          <button
            type="button"
            className={`${SECONDARY} w-full`}
            disabled={!!busy}
            onClick={() =>
              void run<{ balance: number; granted: number }>(
                'grant',
                () => tokens.admin.grant(id),
                (d) =>
                  d.granted > 0
                    ? t(`Granted ${d.granted} tokens.`, `已发放 ${d.granted} 币。`)
                    : t(
                        'Already granted for this membership year. Nothing added.',
                        '本会员年度已发放过，未重复发放。',
                      ),
              )
            }
          >
            <Gift className="w-4 h-4" aria-hidden />
            {busy === 'grant'
              ? t('Granting…', '发放中…')
              : t(`Grant up to ${scan.grant_target} tokens`, `补发至 ${scan.grant_target} 币`)}
          </button>
        ) : (
          <Status tone="muted">
            {t('This plan has no yearly tokens.', '该会员等级没有年度赠币。')}
          </Status>
        )}
      </div>

      <div className="space-y-2">
        <label className={LABEL} htmlFor="desk-cash">
          {t('Cash top-up (US$)', '现金充值（美元）')}
        </label>
        <div className="flex flex-wrap gap-2">
          {CASH_QUICK.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCash(String(c / 100))}
              className="px-3 min-h-[44px] rounded-full border border-neutral-300 bg-neutral-50 text-xs font-semibold hover:border-brick hover:text-brick cursor-pointer"
            >
              {usd(c)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            id="desk-cash"
            className={INPUT}
            inputMode="decimal"
            placeholder="10"
            value={cash}
            onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))}
          />
          <button
            type="button"
            className={SECONDARY}
            disabled={!!busy || cashCents < scan.limits.cash_min_cents}
            onClick={() =>
              void run<{ balance: number }>(
                'cash',
                () => tokens.admin.cashTopUp(id, cashCents),
                () => {
                  setCash('');
                  return t(
                    `Took ${usd(cashCents)} in cash. Added ${(cashCents * scan.limits.rate) / 100} tokens.`,
                    `已收现金 ${usd(cashCents)}，充入 ${(cashCents * scan.limits.rate) / 100} 币。`,
                  );
                },
              )
            }
          >
            <Banknote className="w-4 h-4" aria-hidden />
            {cashCents > 0 ? `+${(cashCents * scan.limits.rate) / 100}` : t('Add', '充值')}
          </button>
        </div>
        <p className="text-[11px] text-neutral-500">
          {t(
            `Minimum ${usd(scan.limits.cash_min_cents)}. Put the cash in the box before you tap.`,
            `最低 ${usd(scan.limits.cash_min_cents)}。先把现金放进钱箱，再点按钮。`,
          )}
        </p>
      </div>

      <div className="space-y-2">
        <label className={LABEL} htmlFor="desk-mint">
          {t('Add tokens for free (needs a reason)', '免费发币（必须填写原因）')}
        </label>
        <div className="grid grid-cols-3 gap-2">
          <input
            id="desk-mint"
            className={INPUT}
            inputMode="numeric"
            placeholder={t('Tokens', '币数')}
            value={mint}
            onChange={(e) => setMint(e.target.value.replace(/\D/g, '').slice(0, 5))}
          />
          <input
            className={`${INPUT} col-span-2`}
            placeholder={t('Reason', '原因')}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={t('Reason', '原因')}
          />
        </div>
        <button
          type="button"
          className={`${SECONDARY} w-full`}
          disabled={!!busy || !Number(mint) || !reason.trim()}
          onClick={() =>
            void run<{ balance: number }>(
              'mint',
              () => tokens.admin.mint(id, Number(mint), reason.trim()),
              () => {
                const n = mint;
                setMint('');
                setReason('');
                return t(`Added ${n} tokens.`, `已发放 ${n} 币。`);
              },
            )
          }
        >
          <PlusCircle className="w-4 h-4" aria-hidden />
          {busy === 'mint' ? t('Adding…', '发放中…') : t('Add tokens', '发币')}
        </button>
        {!scan.root && (
          <p className="text-[11px] text-neutral-500">
            {t(
              `Up to ${scan.limits.admin_mint_cap} tokens at a time. More needs root.`,
              `单次最多 ${scan.limits.admin_mint_cap} 币，超出请找 root。`,
            )}
          </p>
        )}
      </div>
    </div>
  );
}
