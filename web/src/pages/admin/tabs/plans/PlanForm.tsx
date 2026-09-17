import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { withFee } from '../../../../lib/shared';
import { PLAN_PREVIEW_MESSAGE } from '../../../PlanPreviewPage';
import {
  Field,
  INPUT,
  LABEL,
  Notice,
  PRIMARY,
  SECONDARY,
  TEXTAREA,
  usd,
  useAdmin,
} from '../../kit';
import { useAsk } from '../members/shared';

// Limits match functions/api/admin/tiers.js.
export const PLAN_MAX_LINES = 12;

export interface PlanRow {
  id: string;
  name: string;
  price_cents: number;
  description?: string | null;
  description_zh?: string | null;
  features?: string[] | null;
  features_zh?: string[] | null;
  invite_only?: boolean | null;
  active?: boolean | null;
  [k: string]: unknown;
}

const linesOf = (text: string) =>
  text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

// One plan's editor (planForm in the old panel): price for paid plans, the
// card's short descriptions and benefit lines in both languages, and the live
// /plan-preview/ frame. The preview contract is the old one: post
// { type: 'caaci-plan-preview', tier: draft } to the frame on every change and
// when it loads, and again whenever it posts '<type>-ready'.
// A price change asks first, then goes through guarded() (the API wants the
// emailed code and moves the Stripe lookup_key before writing the row).
export function PlanForm({
  plan,
  onCancel,
  onSaved,
}: {
  plan: PlanRow;
  onCancel: () => void;
  onSaved: (tier: PlanRow) => void;
}) {
  const { t, api, guarded } = useAdmin();
  const { ask, panel } = useAsk();
  const paid = plan.price_cents > 0;
  const [price, setPrice] = useState((plan.price_cents / 100).toFixed(2));
  const [description, setDescription] = useState(plan.description || '');
  const [descriptionZh, setDescriptionZh] = useState(plan.description_zh || '');
  const [features, setFeatures] = useState((plan.features || []).join('\n'));
  const [featuresZh, setFeaturesZh] = useState((plan.features_zh || []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const dollars = parseFloat(price);
  const draft = useCallback(
    (): PlanRow => ({
      ...plan,
      price_cents:
        paid && dollars >= 1 && dollars <= 10000 ? Math.round(dollars * 100) : plan.price_cents,
      description: description.trim(),
      description_zh: descriptionZh.trim(),
      features: linesOf(features).slice(0, PLAN_MAX_LINES),
      features_zh: linesOf(featuresZh).slice(0, PLAN_MAX_LINES),
    }),
    [plan, paid, dollars, description, descriptionZh, features, featuresZh],
  );

  const send = useCallback(() => {
    const w = frame.current?.contentWindow;
    if (!frame.current?.isConnected || !w) return;
    w.postMessage({ type: PLAN_PREVIEW_MESSAGE, tier: draft() }, window.location.origin);
  }, [draft]);

  // On every change…
  useEffect(send, [send]);
  // …and when the frame's app says it has started listening.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (
        e.origin === window.location.origin &&
        e.source === frame.current?.contentWindow &&
        (e.data as { type?: string } | null)?.type === `${PLAN_PREVIEW_MESSAGE}-ready`
      )
        send();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [send]);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg('');
    const res = await guarded((headers) =>
      api<{ tier: PlanRow }>('/api/admin/tiers', { method: 'POST', headers, body }),
    );
    setBusy(false);
    if (res.cancelled) return;
    if (!res.ok) return setMsg(res.data.error || t('Save failed.', '保存失败。'));
    onSaved(res.data.tier);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      id: plan.id,
      description: description.trim(),
      description_zh: descriptionZh.trim(),
      features: linesOf(features),
      features_zh: linesOf(featuresZh),
    };
    if (
      (body.features as string[]).length > PLAN_MAX_LINES ||
      (body.features_zh as string[]).length > PLAN_MAX_LINES
    )
      return setMsg(
        t(`At most ${PLAN_MAX_LINES} benefit lines.`, `权益最多 ${PLAN_MAX_LINES} 条。`),
      );
    if (paid) {
      if (!Number.isFinite(dollars) || dollars < 1 || dollars > 10000)
        return setMsg(
          t('Enter a price between $1 and $10,000.', '请输入 $1 到 $10,000 之间的价格。'),
        );
      const cents = Math.round(dollars * 100);
      if (cents !== plan.price_cents) {
        setMsg('');
        return ask(
          t(
            `Change ${plan.name} from ${usd(plan.price_cents)} to ${usd(cents)} a year (${usd(withFee(cents))} by card)?\n\nNew sign-ups and plan switches pay the new price right away. Existing subscribers keep their current price when they renew.`,
            `将 ${plan.name} 的年费从 ${usd(plan.price_cents)} 改为 ${usd(cents)}（刷卡 ${usd(withFee(cents))}）？\n\n新加入和更换方案的会员立即按新价格付款；已订阅会员续费时仍按原价。`,
          ),
          t('Change price', '修改价格'),
          () => save({ ...body, price_cents: cents }),
        );
      }
    }
    void save(body);
  };

  const onePerLine = t(
    `One benefit per line, up to ${PLAN_MAX_LINES}. Leave empty to use the built-in text.`,
    `每行一条权益，最多 ${PLAN_MAX_LINES} 条。留空则使用内置文字。`,
  );

  return (
    <form ref={box} onSubmit={submit} className="space-y-5 scroll-mt-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-bold text-ink break-words min-w-0">{plan.name}</h3>
        <button
          type="button"
          className="w-11 h-11 shrink-0 rounded-full inline-flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-ink cursor-pointer transition-colors"
          aria-label={t('Cancel', '取消')}
          onClick={onCancel}
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label={t('Annual price (USD)', '年费（美元）')}
          hint={
            paid
              ? t(
                  'Base dues; paying by card adds 3.5%. Needs the emailed verification code. Existing subscribers keep their current price at renewal.',
                  '基础年费；刷卡另加 3.5%。需要邮件验证码。已订阅会员续费时仍按原价。',
                )
              : t('Free and invitation-only plans stay at $0.', '免费和邀请制方案固定为 $0。')
          }
        >
          <input
            type="number"
            className={`${INPUT} tabular-nums`}
            min={1}
            max={10000}
            step={0.01}
            inputMode="decimal"
            value={price}
            disabled={!paid || busy}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <div className="hidden md:block" />
        <Field label={t('Short description (English)', '简短描述（英文）')}>
          <textarea
            className={TEXTAREA}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label={t('Short description (Chinese)', '简短描述（中文）')}>
          <textarea
            className={TEXTAREA}
            rows={5}
            value={descriptionZh}
            onChange={(e) => setDescriptionZh(e.target.value)}
          />
        </Field>
        <Field label={t('Card benefits (English page)', '卡片权益（英文页）')} hint={onePerLine}>
          <textarea
            className={TEXTAREA}
            rows={5}
            value={features}
            onChange={(e) => setFeatures(e.target.value)}
          />
        </Field>
        <Field label={t('Card benefits (Chinese page)', '卡片权益（中文页）')} hint={onePerLine}>
          <textarea
            className={TEXTAREA}
            rows={5}
            value={featuresZh}
            onChange={(e) => setFeaturesZh(e.target.value)}
          />
        </Field>
      </div>
      <div>
        <span className={LABEL}>
          {t('Preview (updates as you type, not saved yet)', '预览（随输入更新，尚未保存）')}
        </span>
        <iframe
          ref={frame}
          src="/plan-preview/"
          title={t('Plan card preview', '方案卡片预览')}
          className="w-full h-[560px] rounded-2xl border border-neutral-200 bg-white"
          loading="lazy"
          onLoad={send}
        />
      </div>
      {panel}
      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {t('Save', '保存')}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          {t('Cancel', '取消')}
        </button>
      </div>
    </form>
  );
}
