import { useEffect, useState, type FormEvent } from 'react';
import { X, Check, Heart, Lock } from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { api } from '../lib/api';
import { usd } from '../lib/shared';
import { FluidTabs } from './FluidTabs';

export type ModalType = 'donate' | 'events' | 'membership' | 'volunteer' | null;

interface ModalsProps {
  modalType: ModalType;
  onClose: () => void;
  lang: 'en' | 'zh';
  content: CAACIContent;
}

// Only the donation and volunteer dialogs exist: "events" and "membership" are
// pages, and App.tsx navigates to them instead of opening a dialog.
export function Modals({ modalType, onClose, lang, content }: ModalsProps) {
  if (modalType !== 'donate' && modalType !== 'volunteer') return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-neutral-200 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-neutral-50">
          <div className="flex items-center gap-2">
            {modalType === 'donate' && <Heart className="w-5 h-5 text-brick" />}
            <h3 className="font-bold text-lg text-maroon">
              {modalType === 'donate' && content.modals.donateTitle}
              {modalType === 'volunteer' &&
                (lang === 'en' ? 'Volunteer with CAACI' : '加入 CAACI 志愿者')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 transition-colors"
            aria-label={content.modals.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {modalType === 'donate' && <DonateModalContent lang={lang} content={content} />}
          {modalType === 'volunteer' && <VolunteerModalContent lang={lang} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

// A donation is paid on Stripe Checkout: /api/checkout creates the session
// (minimum $1, one-time or monthly) and returns its URL. Stripe sends the donor
// back to /thank-you/?d=…, which App.tsx forwards to /?donated=1.
function DonateModalContent({ lang, content }: { lang: 'en' | 'zh'; content: CAACIContent }) {
  const en = lang === 'en';
  const [selectedAmount, setSelectedAmount] = useState<number | 'custom'>(50);
  const [customAmount, setCustomAmount] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cents =
    selectedAmount === 'custom'
      ? Math.round(parseFloat(customAmount || '0') * 100)
      : selectedAmount * 100;
  const valid = Number.isFinite(cents) && cents >= 100;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!valid) {
      setError(en ? 'Minimum donation is $1.' : '最低捐款金额为 $1。');
      return;
    }
    setError('');
    setBusy(true);
    const { ok, status, data } = await api<{ url?: string }>('/api/checkout', {
      type: 'donation',
      amount_cents: cents,
      recurring,
      name: name.trim(),
      email: email.trim(),
    });
    if (ok && data.url) {
      // Stays busy while the browser leaves for Stripe.
      window.location.assign(data.url);
      return;
    }
    setBusy(false);
    setError(
      status === 0
        ? en
          ? 'Network error. Please check your connection and try again.'
          : '网络错误，请检查网络连接后重试。'
        : data.error ||
            (en ? 'Could not start the donation. Please try again.' : '无法发起捐款，请重试。'),
    );
  };

  const payLabel = busy
    ? en
      ? 'Redirecting to Stripe…'
      : '正在跳转至 Stripe…'
    : !valid
      ? en
        ? 'Proceed with Donation'
        : '确认捐赠'
      : en
        ? `Donate ${usd(cents)}${recurring ? ' / month' : ''}`
        : `${recurring ? '每月' : ''}捐赠 ${usd(cents)}`;

  return (
    <form onSubmit={submit} className="space-y-5 font-sans">
      <p className="text-sm text-neutral-600 leading-relaxed">{content.modals.donateDesc}</p>

      <div>
        <label className="block text-xs font-bold text-neutral-500 mb-2">
          {en ? 'Frequency' : '捐款频率'}
        </label>
        <FluidTabs
          id="donate-frequency"
          role="group"
          ariaLabel={en ? 'Frequency' : '捐款频率'}
          className="grid grid-cols-2"
          value={recurring ? 'monthly' : 'once'}
          onChange={(v) => setRecurring(v === 'monthly')}
          items={[
            { value: 'once', label: en ? 'One-time' : '一次性' },
            { value: 'monthly', label: en ? 'Monthly' : '每月' },
          ]}
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-neutral-500 mb-2">
          {en ? 'Select Donation Amount' : '选择捐款金额'}
        </label>
        <div className="grid grid-cols-4 gap-3">
          {[25, 50, 100].map((amt) => (
            <button
              key={amt}
              type="button"
              aria-pressed={selectedAmount === amt}
              onClick={() => setSelectedAmount(amt)}
              className={`py-3 rounded font-bold text-sm border transition-all ${
                selectedAmount === amt
                  ? 'border-brick bg-brick text-white shadow-sm'
                  : 'border-neutral-200 hover:border-neutral-400 text-neutral-800'
              }`}
            >
              ${amt}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={selectedAmount === 'custom'}
            onClick={() => setSelectedAmount('custom')}
            className={`py-3 rounded font-bold text-sm border transition-all ${
              selectedAmount === 'custom'
                ? 'border-brick bg-brick text-white shadow-sm'
                : 'border-neutral-200 hover:border-neutral-400 text-neutral-800'
            }`}
          >
            {en ? 'Other' : '其它'}
          </button>
        </div>
      </div>

      {selectedAmount === 'custom' && (
        <div>
          <label
            htmlFor="donate-amount"
            className="block text-xs font-semibold text-neutral-600 mb-1"
          >
            {en ? 'Enter Amount ($USD)' : '输入金额 ($美元)'}
          </label>
          <input
            id="donate-amount"
            type="number"
            min="1"
            step="0.01"
            inputMode="decimal"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder={en ? 'e.g. 150' : '例如 150'}
            className="w-full px-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-brick"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label
            htmlFor="donate-name"
            className="block text-xs font-semibold text-neutral-600 mb-1"
          >
            {en ? 'Name (optional)' : '姓名（选填）'}
          </label>
          <input
            id="donate-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick"
          />
        </div>
        <div>
          <label
            htmlFor="donate-email"
            className="block text-xs font-semibold text-neutral-600 mb-1"
          >
            {en ? 'Email (optional)' : '电子邮箱（选填）'}
          </label>
          <input
            id="donate-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick"
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 text-red-700 text-xs font-medium rounded-xl border border-red-200"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full py-3.5 rounded-full font-bold uppercase tracking-wider text-xs sm:text-sm text-white shadow-xs transition-all hover:bg-brick-hover active:scale-98 cursor-pointer bg-brick disabled:opacity-70 disabled:cursor-wait"
      >
        {payLabel}
      </button>

      <p className="flex items-start justify-center gap-1.5 text-[11px] text-neutral-500 text-center">
        <Lock className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          {en
            ? 'Secure checkout on Stripe. We never see your card details.'
            : '由 Stripe 安全处理付款，我们不会接触您的银行卡信息。'}
        </span>
      </p>
    </form>
  );
}

// Choices listed in the message, in both languages so whoever reads the inbox
// can read them. Interests are the opportunities the dialog describes.
// "Other" points people at the notes box below for the detail.
const INTERESTS = [
  { en: 'Event coordination', zh: '活动现场协调' },
  { en: 'Stage management', zh: '舞台管理' },
  { en: 'Translation', zh: '中英翻译' },
  { en: 'Graphic design', zh: '平面设计' },
  { en: 'Senior support', zh: '长者关怀' },
  { en: 'Other', zh: '其他' },
];
const AVAILABILITY = [
  { en: 'Weekdays', zh: '工作日' },
  { en: 'Weekday evenings', zh: '工作日晚间' },
  { en: 'Weekends', zh: '周末' },
  { en: 'Other', zh: '其他' },
];

// An upcoming event as GET /api/volunteer lists it: published and not over yet.
interface VolunteerEvent {
  slug: string;
  title: string;
  title_zh: string | null;
  starts_at: string;
}

// The event's date the way the site's calendar rows show it. An unreadable
// date drops out of the label instead of showing "Invalid Date".
function eventDate(startsAt: string, en: boolean): string {
  const at = Date.parse(startsAt || '');
  if (Number.isNaN(at)) return '';
  try {
    return new Date(at).toLocaleDateString(en ? 'en-US' : 'zh-CN', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Chicago',
    });
  } catch {
    return '';
  }
}

// /api/volunteer refuses with English sentences; the ones a person can act on
// get a Chinese counterpart on /zh/.
const VOLUNTEER_ERRORS_ZH: Record<string, string> = {
  'Enter your name.': '请填写姓名。',
  'Enter a valid email address.': '请输入有效的电子邮箱。',
  'Event not found.': '所选活动已不可报名，请关闭后重新打开再试。',
  'Too many events selected.': '选择的活动太多了。',
};

// A volunteer sign-up goes to /api/volunteer: one event_volunteers row per event
// picked (or one "wherever needed" row), a staff notification and a thank-you
// email to the volunteer. The picker only offers the events GET /api/volunteer
// lists — published ones that have not happened yet — so nobody signs up for a
// past event; with none listed (or the list failing to load) "any event" is
// the only choice, the same fallback the old /volunteer/ page had.
function VolunteerModalContent({ lang, onClose }: { lang: 'en' | 'zh'; onClose: () => void }) {
  const en = lang === 'en';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [events, setEvents] = useState<VolunteerEvent[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [availability, setAvailability] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<VolunteerEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ events?: VolunteerEvent[] }>('/api/volunteer').then(({ ok, data }) => {
      if (!alive) return;
      const list = ok && Array.isArray(data.events) ? data.events : [];
      // Only events that can still be helped with: the API filters by
      // (ends_at ?? starts_at) >= now, and a stale entry is dropped here too.
      setEvents(list.filter((ev) => ev && typeof ev.slug === 'string' && ev.slug));
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (list: string[], set: (next: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const anyEvent = chosen.length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim() || !email.trim()) {
      setError(en ? 'Please enter your name and email.' : '请填写姓名和电子邮箱。');
      return;
    }
    const picked = (items: typeof INTERESTS, keys: string[]) =>
      items
        .filter((i) => keys.includes(i.en))
        .map((i) => `${i.en} / ${i.zh}`)
        .join(', ');
    const message = [
      picked(INTERESTS, interests) && `Interests · 意向: ${picked(INTERESTS, interests)}`,
      picked(AVAILABILITY, availability) &&
        `Availability · 可服务时间: ${picked(AVAILABILITY, availability)}`,
      notes.trim(),
    ]
      .filter(Boolean)
      .join('\n');

    setError('');
    setBusy(true);
    const { ok, status, data } = await api<{ ok?: boolean; events?: VolunteerEvent[] }>(
      '/api/volunteer',
      {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        message,
        events: chosen,
        _hp: hp,
      },
    );
    setBusy(false);
    if (ok) {
      setSubmitted(Array.isArray(data.events) ? data.events : []);
      return;
    }
    const server = data.error;
    setError(
      status === 0
        ? en
          ? 'Network error. Please check your connection and try again.'
          : '网络错误，请检查网络连接后重试。'
        : status < 500 && server
          ? en
            ? server
            : VOLUNTEER_ERRORS_ZH[server] || '抱歉，报名信息发送失败，请重试。'
          : en
            ? 'Sorry, your sign-up could not be sent. Please try again.'
            : '抱歉，报名信息发送失败，请重试。',
    );
  };

  if (submitted) {
    const names = submitted.map((ev) => (en ? ev.title : ev.title_zh || ev.title));
    return (
      <div role="status" className="text-center py-6 space-y-3 font-sans">
        <Check className="w-12 h-12 text-green-600 mx-auto" />
        <h4 className="text-lg font-bold text-neutral-900">
          {en ? 'Thank You for Volunteering!' : '感谢您支持社区志愿服务！'}
        </h4>
        <p className="text-xs text-neutral-600">
          {names.length
            ? en
              ? `You're signed up to help with ${names.join(', ')}. We'll be in touch by email before the event.`
              : `您已报名参与「${names.join('、')}」的志愿服务，活动前我们会通过邮件与您联系。`
            : en
              ? "You're on our volunteer list. We'll be in touch by email when we need a hand."
              : '您已加入志愿者名单，需要帮手时我们会通过邮件与您联系。'}
        </p>
        <p className="text-[11px] text-neutral-500">
          {en ? 'A confirmation has been emailed to you.' : '确认邮件已发送到您的邮箱。'}
        </p>
        <button
          onClick={onClose}
          className="mt-3 px-5 py-2 bg-brick text-white rounded text-xs font-bold"
        >
          {en ? 'Done' : '完成'}
        </button>
      </div>
    );
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer ${
      active
        ? 'border-brick bg-brick text-white shadow-xs'
        : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400'
    }`;

  return (
    <form onSubmit={submit} className="relative space-y-3 font-sans text-xs">
      <p className="text-neutral-600 leading-relaxed text-sm">
        {en
          ? 'Join our enthusiastic volunteer team! Opportunities include event coordination, stage management, translation, graphic design, and senior support.'
          : '加入我们充满活力的志愿者团队！服务内容涵盖活动现场协调、舞台管理、中英翻译、平面设计与长者关怀等。'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          required
          autoComplete="name"
          aria-label={en ? 'Your Name' : '姓名'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={en ? 'Your Name *' : '姓名 *'}
          className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick"
        />
        <input
          type="email"
          required
          autoComplete="email"
          aria-label={en ? 'Your Email' : '电子邮箱'}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={en ? 'Your Email *' : '电子邮箱 *'}
          className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick"
        />
      </div>
      <input
        type="tel"
        autoComplete="tel"
        aria-label={en ? 'Phone (optional)' : '电话（选填）'}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={en ? 'Phone (optional)' : '电话（选填）'}
        className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick"
      />

      <fieldset>
        <legend className="block text-xs font-bold text-neutral-500 mb-2">
          {en ? 'Which event(s) would you like to help with?' : '您想为哪些活动做志愿者？'}
        </legend>
        {events === null ? (
          <p className="text-neutral-500">{en ? 'Loading events…' : '正在加载活动…'}</p>
        ) : (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-brick"
                checked={anyEvent}
                onChange={() => setChosen([])}
              />
              <span className="text-neutral-800">
                {en ? 'Any event / wherever needed' : '任何活动均可'}
              </span>
            </label>
            {events.map((ev) => {
              const when = eventDate(ev.starts_at, en);
              return (
                <label key={ev.slug} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-brick"
                    value={ev.slug}
                    checked={chosen.includes(ev.slug)}
                    onChange={() => toggle(chosen, setChosen, ev.slug)}
                  />
                  <span className="text-neutral-800">
                    {en ? ev.title : ev.title_zh || ev.title}
                  </span>
                  {when && <span className="text-neutral-500">· {when}</span>}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="block text-xs font-bold text-neutral-500 mb-2">
          {en ? 'Areas of Interest' : '感兴趣的志愿领域'}
        </legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => (
            <button
              key={i.en}
              type="button"
              aria-pressed={interests.includes(i.en)}
              onClick={() => toggle(interests, setInterests, i.en)}
              className={chip(interests.includes(i.en))}
            >
              {en ? i.en : i.zh}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="block text-xs font-bold text-neutral-500 mb-2">
          {en ? 'Availability' : '可服务时间'}
        </legend>
        <div className="flex flex-wrap gap-2">
          {AVAILABILITY.map((a) => (
            <button
              key={a.en}
              type="button"
              aria-pressed={availability.includes(a.en)}
              onClick={() => toggle(availability, setAvailability, a.en)}
              className={chip(availability.includes(a.en))}
            >
              {en ? a.en : a.zh}
            </button>
          ))}
        </div>
      </fieldset>

      <textarea
        rows={3}
        aria-label={en ? 'Skills or notes' : '专长或备注'}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={
          en
            ? 'Skills or areas of interest (e.g., photography, event planning)'
            : '您的专长或感兴趣的志愿领域（如：摄影、活动策划、翻译等）'
        }
        className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick resize-none"
      />

      {/* Honeypot: people never see or fill it; /api/volunteer drops sign-ups that have it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden">
        <label htmlFor="volunteer-website">Website</label>
        <input
          id="volunteer-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 text-red-700 text-xs font-medium rounded-xl border border-red-200"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full py-3 rounded-full font-bold uppercase tracking-wider text-xs text-white shadow-xs transition-all hover:bg-brick-hover active:scale-98 cursor-pointer bg-brick disabled:opacity-70 disabled:cursor-wait"
      >
        {busy ? (en ? 'Sending…' : '发送中…') : en ? 'Sign Up to Volunteer' : '报名成为志愿者'}
      </button>
    </form>
  );
}
