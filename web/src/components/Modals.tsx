import { useEffect, useState, type FormEvent } from 'react';
import { X, Check, Heart, Lock } from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { api } from '../lib/api';
import { readAnswers, volunteerZhError } from '../lib/registration';
import { usd } from '../lib/shared';
import { fill } from '../lib/text';
import { FluidTabs } from './FluidTabs';
import { QuestionFields, blankAnswers, type AnswerState, type Question } from './QuestionFields';
import { TurnstileBox, useTurnstile } from './Turnstile';

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
              {modalType === 'volunteer' && content.modals.volunteerTitle}
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
          {modalType === 'donate' && <DonateModalContent content={content} />}
          {modalType === 'volunteer' && (
            <VolunteerModalContent lang={lang} content={content} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

// A donation is paid on Stripe Checkout: /api/checkout creates the session
// (minimum $1, one-time or monthly) and returns its URL. Stripe sends the donor
// back to /thank-you/?d=…, which App.tsx forwards to /?donated=1.
function DonateModalContent({ content }: { content: CAACIContent }) {
  const text = content.modals.donate;
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
      setError(text.minimumError);
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
    setError(status === 0 ? content.modals.networkError : data.error || text.startFailed);
  };

  const payLabel = busy
    ? text.redirecting
    : !valid
      ? text.proceed
      : fill(recurring ? text.payMonthly : text.payOnce, { amount: usd(cents) });

  return (
    <form onSubmit={submit} className="space-y-5 font-sans">
      <p className="text-sm text-neutral-600 leading-relaxed">{content.modals.donateDesc}</p>

      <div>
        <label className="block text-xs font-bold text-neutral-500 mb-2">{text.frequency}</label>
        <FluidTabs
          id="donate-frequency"
          role="group"
          ariaLabel={text.frequency}
          className="grid grid-cols-2"
          value={recurring ? 'monthly' : 'once'}
          onChange={(v) => setRecurring(v === 'monthly')}
          items={[
            { value: 'once', label: text.once },
            { value: 'monthly', label: text.monthly },
          ]}
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-neutral-500 mb-2">{text.amountLabel}</label>
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
            {text.other}
          </button>
        </div>
      </div>

      {selectedAmount === 'custom' && (
        <div>
          <label
            htmlFor="donate-amount"
            className="block text-xs font-semibold text-neutral-600 mb-1"
          >
            {text.customAmountLabel}
          </label>
          <input
            id="donate-amount"
            type="number"
            min="1"
            step="0.01"
            inputMode="decimal"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder={text.customAmountPlaceholder}
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
            {text.nameLabel}
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
            {text.emailLabel}
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
        <span>{text.secureNote}</span>
      </p>
    </form>
  );
}

// An upcoming event as GET /api/volunteer lists it: published and not over
// yet, with its own volunteer questions or null (it asks the default ones).
interface VolunteerEvent {
  slug: string;
  title: string;
  title_zh: string | null;
  starts_at: string;
  questions: Question[] | null;
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

// The dialog's event picker: no particular event, or one of the upcoming ones.
const ANY_EVENT = '';

// A volunteer sign-up goes to /api/volunteer: one event_volunteers row for the
// event picked (or the "wherever needed" row), a staff notification and a
// thank-you email to the volunteer. The dialog first asks whether the sign-up
// is for a particular event: picking one that has volunteer questions of its
// own (shifts, stations…) asks those right here; "any event", or an event
// without its own, asks the site's default questions (the default volunteer
// template, 0035). The picker only offers the events GET /api/volunteer lists —
// published ones that have not happened yet — so nobody signs up for a past
// event; with none listed (or the list failing to load) "any event" is the
// only choice, the same fallback the old /volunteer/ page had.
function VolunteerModalContent({
  lang,
  content,
  onClose,
}: {
  lang: 'en' | 'zh';
  content: CAACIContent;
  onClose: () => void;
}) {
  const en = lang === 'en';
  const text = content.modals.volunteer;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [events, setEvents] = useState<VolunteerEvent[] | null>(null);
  const [defaults, setDefaults] = useState<Question[]>([]);
  const [chosen, setChosen] = useState<string>(ANY_EVENT);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const turnstile = useTurnstile('volunteer');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<VolunteerEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ events?: VolunteerEvent[]; questions?: Question[] }>('/api/volunteer').then(
      ({ ok, data }) => {
        if (!alive) return;
        const list = ok && Array.isArray(data.events) ? data.events : [];
        // Only events that can still be helped with: the API filters by
        // (ends_at ?? starts_at) >= now, and a stale entry is dropped here too.
        setEvents(list.filter((ev) => ev && typeof ev.slug === 'string' && ev.slug));
        const asked = ok && Array.isArray(data.questions) ? data.questions : [];
        setDefaults(asked);
        setAnswers(blankAnswers(asked));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // The form in effect for the pick — the API applies the same rule.
  const picked = chosen ? (events ?? []).find((ev) => ev.slug === chosen) : undefined;
  const questions = picked?.questions ?? defaults;

  // Changing the pick can change the questions; the answers start over then.
  const pick = (slug: string) => {
    const next = slug ? (events ?? []).find((ev) => ev.slug === slug) : undefined;
    const asked = next?.questions ?? defaults;
    setChosen(slug);
    setAnswers(blankAnswers(asked));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim() || !email.trim()) {
      setError(text.nameEmailError);
      return;
    }
    const read = readAnswers(questions, answers, lang);
    if ('error' in read) {
      setError(read.error);
      document.getElementById(read.field)?.focus();
      return;
    }

    // A Turnstile token is spent by the request that carries it: read it, send
    // it, reset the widget whatever the answer was.
    const problem = turnstile.problem(!en);
    if (problem) return setError(problem);
    const token = turnstile.token();

    setError('');
    setBusy(true);
    const { ok, status, data } = await api<{ ok?: boolean; events?: VolunteerEvent[] }>(
      '/api/volunteer',
      {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        events: chosen ? [chosen] : [],
        answers: read.answers,
        _hp: hp,
        'cf-turnstile-response': token,
      },
    );
    turnstile.reset();
    setBusy(false);
    if (ok) {
      setSubmitted(Array.isArray(data.events) ? data.events : []);
      return;
    }
    const server = data.error;
    setError(
      status === 0
        ? content.modals.networkError
        : status < 500 && server
          ? en
            ? server
            : volunteerZhError(server) || text.sendFailed
          : text.sendFailed,
    );
  };

  if (submitted) {
    const names = submitted.map((ev) => (en ? ev.title : ev.title_zh || ev.title));
    return (
      <div role="status" className="text-center py-6 space-y-3 font-sans">
        <Check className="w-12 h-12 text-green-600 mx-auto" />
        <h4 className="text-lg font-bold text-neutral-900">{text.thanksTitle}</h4>
        <p className="text-xs text-neutral-600">
          {names.length
            ? fill(text.signedUp, { events: names.join(text.eventSeparator) })
            : text.onList}
        </p>
        <p className="text-[11px] text-neutral-500">{text.confirmation}</p>
        <button
          onClick={onClose}
          className="mt-3 px-5 py-2 bg-brick text-white rounded text-xs font-bold"
        >
          {text.done}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="relative space-y-4 font-sans text-xs">
      <p className="text-neutral-600 leading-relaxed text-sm">{text.intro}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          required
          autoComplete="name"
          aria-label={text.nameLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${text.nameLabel} *`}
          className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick"
        />
        <input
          type="email"
          required
          autoComplete="email"
          aria-label={text.emailLabel}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={`${text.emailLabel} *`}
          className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick"
        />
      </div>
      <input
        type="tel"
        autoComplete="tel"
        aria-label={text.phoneLabel}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={text.phoneLabel}
        className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brick"
      />

      <fieldset>
        <legend className="block text-xs font-bold text-neutral-500 mb-2">
          {text.eventQuestion}
        </legend>
        {events === null ? (
          <p className="text-neutral-500">{text.loadingEvents}</p>
        ) : (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="volunteer-event"
                className="accent-brick"
                value={ANY_EVENT}
                checked={chosen === ANY_EVENT}
                onChange={() => pick(ANY_EVENT)}
              />
              <span className="text-neutral-800">{text.anyEvent}</span>
            </label>
            {events.map((ev) => {
              const when = eventDate(ev.starts_at, en);
              return (
                <label key={ev.slug} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="volunteer-event"
                    className="accent-brick"
                    value={ev.slug}
                    checked={chosen === ev.slug}
                    onChange={() => pick(ev.slug)}
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

      {/* The questions of the form in effect: the picked event's own, else the
          site's default ones. Both come from the admin, not from this file. */}
      <QuestionFields questions={questions} answers={answers} onChange={setAnswers} lang={lang} />

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

      <TurnstileBox handle={turnstile} />

      <button
        type="submit"
        disabled={busy}
        className="w-full py-3 rounded-full font-bold uppercase tracking-wider text-xs text-white shadow-xs transition-all hover:bg-brick-hover active:scale-98 cursor-pointer bg-brick disabled:opacity-70 disabled:cursor-wait"
      >
        {busy ? text.sending : text.submit}
      </button>
    </form>
  );
}
