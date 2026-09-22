// One merchant's menu, edited in place: the list, an item opened onto its own
// fields, and the QR sticker that is printed from it.
//
// Both pages that keep a menu render this — the back office (/token-admin/,
// any shop) and the shop's own console (/merchant/, the shops the account
// works at). They differ in the endpoint their `act` posts to and in what they
// can show underneath an item; everything a menu IS lives here, so the two
// cannot drift into two slightly different menus the way the directory card
// once did.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Download, Printer } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { LiquidToggle } from '../bencho/LiquidToggle';
import {
  ASIDE,
  AddRow,
  Confirm,
  EYEBROW,
  Field,
  INPUT,
  LABEL,
  Notice,
  PRIMARY,
  SECONDARY,
  SECTION,
  Status,
  TEXT_ACTION,
  tr,
  type Act,
  type Say,
} from './ui';
import type { Lang } from '../../lib/lang';
import { openPaySheet, PRINT_CELL } from '../../lib/payPrint.js';
import { day, type MenuItem } from '../../lib/tokens';

/** All a menu needs to know about the shop it belongs to. */
export interface MenuMerchant {
  id: string;
  kind: 'internal' | 'partner';
}

interface MenuProps {
  lang: Lang;
  m: MenuMerchant;
  items: MenuItem[];
  /** tokens per dollar, so a printed sticker can show the money as well */
  rate: number;
  act: Act;
  say: Say;
  /** whether root has scan-to-pay switched on for partner shops; omitted when the page did not ask */
  allowPartners?: boolean;
  /** an item's own record, under its fields — the back office has the ledger for this */
  sales?: (item: MenuItem) => ReactNode;
  /** the page has already drawn the heading and the rule above (a disclosure) */
  bare?: boolean;
}

export function MenuSection({
  lang,
  m,
  items,
  rate,
  act,
  say,
  allowPartners,
  sales,
  bare = false,
}: MenuProps) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [openItem, setOpenItem] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', name_zh: '', tokens: '', group_label: '' });

  return (
    <section className={bare ? 'space-y-3' : SECTION}>
      {!bare && <span className={EYEBROW}>{t('Menu', '菜单')}</span>}
      {items.length === 0 ? (
        <p className="text-xs text-neutral-500">
          {t('Nothing on the menu yet.', '菜单还是空的。')}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200/80">
          {items.map((i) => (
            <li key={i.id} className="py-1 text-xs">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-3 text-left min-h-[44px] cursor-pointer"
                onClick={() => setOpenItem(openItem === i.id ? '' : i.id)}
                aria-expanded={openItem === i.id}
              >
                <span className="min-w-0 truncate">
                  {i.group_label && <span className="text-neutral-500">[{i.group_label}] </span>}
                  <span className="font-semibold text-neutral-900">{i.name}</span>
                  {i.name_zh ? ` · ${i.name_zh}` : ''}
                  {i.pay_code && (
                    <span className="ml-2 text-neutral-500 tabular-nums">QR {i.pay_code}</span>
                  )}
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  {i.active === false && <Status tone="muted">{t('Hidden', '已下架')}</Status>}
                  <span className="text-neutral-500 tabular-nums">
                    {t(`${i.sold ?? 0} sold`, `已售 ${i.sold ?? 0}`)}
                  </span>
                  <span className="font-bold tabular-nums text-neutral-900">
                    {i.tokens} {t('tokens', '币')}
                  </span>
                </span>
              </button>
              {openItem === i.id && (
                <ItemDetail
                  lang={lang}
                  m={m}
                  item={i}
                  rate={rate}
                  act={act}
                  say={say}
                  allowPartners={allowPartners}
                  sales={sales}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              {
                action: 'save_item',
                merchant_id: m.id,
                ...draft,
                tokens: Number(draft.tokens),
                sort_order: items.length,
              },
              t('Item added.', '已添加。'),
            ).then((done) => {
              if (done) {
                setDraft({ name: '', name_zh: '', tokens: '', group_label: draft.group_label });
                setAdding(false);
              }
            });
          }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label={t('Item', '品名（英）')}>
              <input
                className={INPUT}
                required
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label={t('Chinese name', '品名（中）')}>
              <input
                className={INPUT}
                value={draft.name_zh}
                onChange={(e) => setDraft({ ...draft, name_zh: e.target.value })}
              />
            </Field>
            <Field label={t('Price (tokens)', '价格（币）')}>
              <input
                className={INPUT}
                required
                inputMode="numeric"
                value={draft.tokens}
                onChange={(e) => setDraft({ ...draft, tokens: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label={t('Stall (optional)', '摊位（可选）')}>
              <input
                className={INPUT}
                value={draft.group_label}
                onChange={(e) => setDraft({ ...draft, group_label: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className={SECONDARY}>
              {t('Add item', '添加')}
            </button>
            <button type="button" className={TEXT_ACTION} onClick={() => setAdding(false)}>
              {t('Cancel', '取消')}
            </button>
          </div>
        </form>
      ) : (
        <AddRow label={t('Add an item', '添加菜品')} onClick={() => setAdding(true)} />
      )}
    </section>
  );
}

// One menu item, opened: its own fields, its printed QR, and whatever record
// the page can show for it.
function ItemDetail({
  lang,
  m,
  item,
  rate,
  act,
  say,
  allowPartners,
  sales,
}: Omit<MenuProps, 'items'> & { item: MenuItem }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [f, setF] = useState({
    name: item.name,
    name_zh: item.name_zh ?? '',
    tokens: String(item.tokens),
    group_label: item.group_label ?? '',
    sort_order: String(item.sort_order ?? 0),
    active: item.active !== false,
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const done = await act(
      {
        action: 'save_item',
        merchant_id: m.id,
        id: item.id,
        name: f.name,
        name_zh: f.name_zh,
        tokens: Number(f.tokens),
        group_label: f.group_label,
        sort_order: Number(f.sort_order) || 0,
        active: f.active,
      },
      t('Saved.', '已保存。'),
    );
    if (done?.reprint)
      say(
        'warn',
        t(
          'Saved. The QR carries the code, never the price — so every sticker already printed for this item now charges the new price. Reprint the sheets.',
          '已保存。二维码里只有编码、没有价格——所以已经贴出去的每一张贴纸，现在都按新价扣币，请重新打印。',
        ),
      );
  };

  return (
    <div className="mb-3 space-y-6">
      <form className="space-y-3" onSubmit={(e) => void save(e)}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Field label={t('Item', '品名（英）')}>
            <input
              className={INPUT}
              required
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field label={t('Chinese name', '品名（中）')}>
            <input
              className={INPUT}
              value={f.name_zh}
              onChange={(e) => setF({ ...f, name_zh: e.target.value })}
            />
          </Field>
          <Field label={t('Price (tokens)', '价格（币）')}>
            <input
              className={INPUT}
              required
              inputMode="numeric"
              value={f.tokens}
              onChange={(e) => setF({ ...f, tokens: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
          <Field label={t('Stall (optional)', '摊位（可选）')}>
            <input
              className={INPUT}
              value={f.group_label}
              onChange={(e) => setF({ ...f, group_label: e.target.value })}
            />
          </Field>
          <Field label={t('Order on the menu', '菜单排序')}>
            <input
              className={INPUT}
              inputMode="numeric"
              value={f.sort_order}
              onChange={(e) => setF({ ...f, sort_order: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className={SECONDARY}>
            {t('Save changes', '保存修改')}
          </button>
          <span className="inline-flex items-center gap-2 text-xs text-neutral-700">
            <LiquidToggle
              checked={f.active}
              onChange={(next) => setF({ ...f, active: next })}
              label={t('On the menu', '在售')}
            />
            {t('On the menu', '在售')}
          </span>
        </div>
        {item.active === false && (
          <p className={ASIDE}>
            {t(
              'Hidden: it is off the till’s menu and its QR refuses, but everything it has already sold stays in the ledger.',
              '已下架：收银台菜单中不再显示，二维码也不再受理；此前卖出的记录仍留在流水里。',
            )}
          </p>
        )}
      </form>

      <PayCode lang={lang} m={m} item={item} rate={rate} act={act} allowPartners={allowPartners} />
      {sales?.(item)}

      {/* the one irreversible thing, last and in words, away from the fields */}
      <div className="flex justify-end border-t border-dashed border-neutral-200/80 pt-1">
        <Confirm
          lang={lang}
          label={t('Delete this item', '删除该菜品')}
          confirmLabel={t('Yes, delete it', '确定删除')}
          onConfirm={() =>
            act(
              { action: 'delete_item', merchant_id: m.id, id: item.id },
              t('Deleted.', '已删除。'),
            )
          }
        />
      </div>
    </div>
  );
}

// The printed sticker for one menu item (0030). The code is the sticker: a new
// one kills every sheet already printed, which is the answer to a QR that was
// swapped, copied or photographed. The price is NOT in the code — it is read
// from this item when someone pays — so editing the price above changes what
// every sticker already on a cup charges, and the sheets have to be reprinted.
function PayCode({
  lang,
  m,
  item,
  rate,
  act,
  allowPartners,
}: {
  lang: Lang;
  m: MenuMerchant;
  item: MenuItem;
  rate: number;
  act: Act;
  allowPartners?: boolean;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [blocked, setBlocked] = useState(false);
  const url = item.pay_code ? `${window.location.origin}/pay/?c=${item.pay_code}` : '';
  const png = useMemo(() => (url ? drawQr(url, 8, 16) : ''), [url]);

  const issue = (ok: string) => act({ action: 'issue_code', merchant_id: m.id, id: item.id }, ok);

  // Redrawn at the sheet's own cell size: the 8px cells on screen would print
  // at about 90dpi, which a phone camera reads badly on a curved cup.
  const print = (size: 'small' | 'large') => {
    const cell = PRINT_CELL[size];
    setBlocked(
      !openPaySheet(
        {
          name: item.name,
          name_zh: item.name_zh,
          tokens: item.tokens,
          code: item.pay_code || '',
          url,
          rate,
        },
        size,
        lang,
        drawQr(url, cell, cell * 2),
      ),
    );
  };

  // A partner shop's codes are refused while root has the switch off, so the
  // page says so rather than handing out stickers that will not work.
  const partnerWarning =
    m.kind !== 'internal' && allowPartners !== true ? (
      <p className="border-l-2 border-amber-300 pl-3 text-[11px] text-amber-800 leading-relaxed">
        {allowPartners === false
          ? t(
              'Scan-to-pay is off for partner shops right now — this QR will tell customers to pay at the counter until CAACI turns it on.',
              '目前合作商家的扫码付款已关闭——在华协开启前，顾客扫这张码只会被提示到柜台付款。',
            )
          : t(
              'Partner shops can only take scan-to-pay once root turns it on in Settings.',
              '合作商家需由 root 在设置中开启后才能收扫码付款。',
            )}
      </p>
    ) : null;

  if (!item.pay_code)
    return (
      <div className="space-y-2">
        <p className={LABEL}>{t('Scan-to-pay', '扫码付款')}</p>
        <p className={ASIDE}>
          {t(
            `A QR on the product that charges ${item.tokens} tokens when a member scans it. Nobody needs a till.`,
            `给这件商品生成一张二维码，会员扫码即可支付 ${item.tokens} 币，摊位不需要任何设备。`,
          )}
        </p>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => void issue(t('QR code created.', '二维码已生成。'))}
        >
          {t('Make a QR code', '生成二维码')}
        </button>
        {partnerWarning}
      </div>
    );

  return (
    <div className="flex flex-col sm:flex-row gap-4 text-xs">
      {png && (
        <img
          src={png}
          alt={t(`Pay QR code for ${item.name}`, `${item.name} 付款二维码`)}
          className="w-36 h-36 rounded-xl border border-neutral-200 bg-white shrink-0"
        />
      )}
      <div className="min-w-0 space-y-2">
        <p className={LABEL}>
          {t('Scan-to-pay', '扫码付款')} · {item.tokens} {t('tokens', '币')}
        </p>
        <p className="text-neutral-600">
          <code className="break-all text-ink font-mono">{url}</code>
        </p>
        {item.pay_code_at && (
          <p className="text-[11px] text-neutral-500">
            {t('Issued', '生成于')} {day(item.pay_code_at, lang)} ·{' '}
            {t('reprint the sheet whenever you change the price above.', '上方改价后请重新打印。')}
          </p>
        )}
        {blocked && (
          <Notice tone="warn">
            {t(
              'Your browser blocked the print window. Allow pop-ups for this site and try again.',
              '浏览器拦截了打印窗口，请允许本站弹出窗口后重试。',
            )}
          </Notice>
        )}
        {partnerWarning}
        {/* one button — the thing this block exists for — and words for the rest */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button type="button" className={PRIMARY} onClick={() => print('small')}>
            <Printer className="w-4 h-4" aria-hidden />
            {t('Print 12 stickers', '打印贴纸 · 12 枚一页')}
          </button>
          <button type="button" className={TEXT_ACTION} onClick={() => print('large')}>
            {t('Print 4 signs', '打印立牌 · 4 枚一页')}
          </button>
          {png && (
            <a
              className={`${TEXT_ACTION} inline-flex items-center gap-1.5`}
              download={`caaci-pay-${item.pay_code}.gif`}
              href={png}
            >
              <Download className="w-3.5 h-3.5" aria-hidden />
              {t('Download image', '下载图片')}
            </a>
          )}
        </div>
        {/* both of these kill every sticker already on a cup, so they are quiet and ask first */}
        <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-neutral-500">
          <Confirm
            lang={lang}
            quiet
            label={t('New code', '换新码')}
            confirmLabel={t(
              'Yes, new code — the old stickers stop working',
              '确定换码，旧贴纸作废',
            )}
            onConfirm={() =>
              issue(t('New code. Reprint the stickers.', '已换新码，请重新打印贴纸。'))
            }
          />
          <span aria-hidden>·</span>
          <Confirm
            lang={lang}
            quiet
            label={t('Stop scan-to-pay', '停用扫码付款')}
            confirmLabel={t('Yes, stop it', '确定停用')}
            onConfirm={() =>
              act(
                { action: 'clear_code', merchant_id: m.id, id: item.id },
                t('Scan-to-pay is off for this item.', '该商品扫码付款已停用。'),
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

function drawQr(url: string, cell: number, margin: number) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createDataURL(cell, margin);
}
