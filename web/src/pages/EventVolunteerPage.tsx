import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Calendar, Check, MapPin, RefreshCw } from 'lucide-react';
import {
  QuestionFields,
  blankAnswers,
  type AnswerState,
  type Question,
} from '../components/QuestionFields';
import { SubpageHero } from '../components/SubpageHero';
import { TurnstileBox, useTurnstile } from '../components/Turnstile';
import type { CAACIContent } from '../data/content';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  eventDescription,
  eventTitle,
  eventWhenText,
  eventsPath,
  isUpcoming,
  type EventRow,
} from '../lib/events';
import type { Lang } from '../lib/lang';
import { mountIn, riseFromSm, shown } from '../lib/motion';
import { answerStateFrom, eventSlugFrom, readAnswers, volunteerZhError } from '../lib/registration';

// ---------------------------------------------------------------- the API's shapes

/** GET /api/volunteer?event=<slug> → `events[0]`. */
interface VolEvent {
  slug: string;
  title: string;
  title_zh: string | null;
  description: string | null;
  description_zh: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  /** The event's own volunteer questions, or null: it asks the default ones. */
  questions: Question[] | null;
}

interface VolInfo {
  events?: VolEvent[];
  /** The site's default volunteer questions (the default template, 0035). */
  questions?: Question[];
  signed_in?: boolean;
  email?: string | null;
  signup?: {
    name: string;
    phone: string | null;
    answers: Record<string, unknown>;
    created_at: string;
    updated_at: string | null;
  } | null;
  error?: string;
}

interface PostResult {
  ok?: boolean;
  already?: boolean;
  created_at?: string | null;
  signed_in?: boolean;
  linked?: boolean;
  error?: string;
}

// The event GET is the only thing between the visitor and the form, so a
// request that never answers gets cut off and offered a Retry instead.
const LOAD_TIMEOUT_MS = 6000;

// ---------------------------------------------------------------- shared classes
// web/DESIGN_SYSTEM.md §5.2 / §5.1 / §5.3, verbatim (as on the registration page).

const INPUT =
  'w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brick';
const LABEL = 'block text-xs font-bold text-neutral-500 mb-2';
const PRIMARY =
  'min-h-[44px] px-8 py-3 rounded-full bg-brick hover:bg-brick-hover text-white font-semibold text-xs uppercase tracking-wider shadow-xs transition-all active:scale-98 cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait';
const SECONDARY =
  'min-h-[44px] px-6 py-2.5 rounded-full bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 text-xs font-semibold cursor-pointer transition-colors';
const CARD =
  'bg-surface-2 p-6 sm:p-7 rounded-2xl border border-neutral-200/80 shadow-xs max-w-2xl mx-auto';
const ALERT_ERROR =
  'p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2';

interface EventVolunteerPageProps {
  content: CAACIContent;
  lang: Lang;
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// An event's own volunteer sign-up (/events/<slug>/volunteer/, 0035): the
// registration page as a template, minus the free gift and the account step.
// GET /api/volunteer?event= answers with the event, the questions it asks (its
// own, else the site's default) and, signed in, the visitor's sign-up so far;
// POST /api/volunteer with events: [slug] saves name, email, phone and the
// answers, merging into what was stored before. No account needed.
export function EventVolunteerPage({
  content,
  lang,
  onOpenModal,
  onNavigate,
}: EventVolunteerPageProps) {
  const en = lang === 'en';
  const auth = useAuth();
  const [slug] = useState(() =>
    eventSlugFrom(window.location.pathname, window.location.search, 'volunteer'),
  );

  const [status, setStatus] = useState<'loading' | 'missing' | 'failed' | 'ready'>('loading');
  const [signedIn, setSignedIn] = useState(false);
  const [ev, setEv] = useState<VolEvent | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempt, setAttempt] = useState(0);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState<AnswerState>({});
  const [hp, setHp] = useState('');

  const [busy, setBusy] = useState(false);
  const turnstile = useTurnstile('volunteer');
  const [error, setError] = useState('');
  // The success card: when the sign-up was first made, and whether this
  // submission updated an earlier one.
  const [done, setDone] = useState<{ createdAt: string | null; already: boolean } | null>(null);
  const doneTitle = useRef<HTMLHeadingElement>(null);
  const [refocus, setRefocus] = useState(0);

  // The account email is the one the API will file the sign-up under, so it is
  // fixed once the GET has confirmed the session and handed back an address.
  const emailLocked = signedIn && !!email;

  // ---------------------------------------------------------------- load
  useEffect(() => {
    if (!slug) {
      setStatus('missing');
      return;
    }
    if (!auth.ready) return;
    let alive = true;
    setStatus('loading');
    let timer = 0;
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
    });
    Promise.race([
      api<VolInfo>(`/api/volunteer?event=${encodeURIComponent(slug)}`, undefined, {
        auth: true,
      }),
      timeout,
    ]).then((result) => {
      window.clearTimeout(timer);
      if (!alive) return;
      if (!result) return setStatus('failed');
      const { ok, status: code, data } = result;
      if (code === 404) return setStatus('missing');
      const event = data.events?.[0];
      if (!ok || !event) return setStatus('failed');
      setEv(event);
      const asked = event.questions ?? data.questions ?? [];
      setQuestions(asked);
      setSignedIn(!!data.signed_in);
      if (data.signed_in && data.email) setEmail(data.email);
      // Signed up before: the form opens as it was sent, so a resubmission
      // changes only what the person changes.
      if (data.signup) {
        setName(data.signup.name || '');
        setPhone(data.signup.phone || '');
        setAnswers(answerStateFrom(asked, data.signup.answers));
        setDone({ createdAt: data.signup.created_at, already: false });
      } else {
        setAnswers(blankAnswers(asked));
      }
      setStatus('ready');
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [slug, attempt, auth.ready]);

  // The member row carries the name and phone the form would otherwise ask for.
  useEffect(() => {
    if (auth.member?.full_name) setName((n) => n || auth.member?.full_name || '');
    if (auth.member?.phone) setPhone((p) => p || auth.member?.phone || '');
  }, [auth.member]);

  useEffect(() => {
    const title = ev ? eventTitle(ev as unknown as EventRow, lang) : '';
    if (title)
      document.title = `${en ? 'Volunteer' : '志愿者报名'} · ${title} | Chinese American Association of Central Illinois`;
  }, [ev, lang, en]);

  useEffect(() => {
    if (done) doneTitle.current?.focus();
  }, [done]);

  useEffect(() => {
    if (refocus) document.getElementById('vol-name')?.focus();
  }, [refocus]);

  // ---------------------------------------------------------------- submit
  const submit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (busy || !ev) return;
    const focus = (field: string) => document.getElementById(field)?.focus();
    if (!name.trim()) {
      setError(en ? 'Enter your name.' : '请填写姓名。');
      focus('vol-name');
      return;
    }
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(en ? 'Enter a valid email address.' : '请填写有效邮箱。');
      focus('vol-email');
      return;
    }
    const read = readAnswers(questions, answers, lang);
    if ('error' in read) {
      setError(read.error);
      focus(read.field);
      return;
    }
    const problem = turnstile.problem(!en);
    if (problem) return setError(problem);
    const token = turnstile.token();

    const body = {
      events: [slug],
      name: name.trim(),
      email: address,
      phone: phone.trim(),
      answers: read.answers,
      _hp: hp,
      'cf-turnstile-response': token,
    };

    setError('');
    setBusy(true);
    const {
      ok,
      status: code,
      data,
    } = await api<PostResult>('/api/volunteer', body, {
      auth: true,
    });
    turnstile.reset();
    setBusy(false);
    if (!ok) {
      const server = data.error;
      setError(
        code === 0
          ? en
            ? 'Network error. Please check your connection and try again.'
            : '网络错误，请检查网络连接后重试。'
          : server
            ? en
              ? server
              : volunteerZhError(server) || '提交失败，请重试。'
            : en
              ? 'Could not submit — please try again.'
              : '提交失败，请重试。',
      );
      return;
    }
    if (!data.ok) {
      setError(
        en ? 'We could not confirm your sign-up. Please try again.' : '未能确认您的报名，请重试。',
      );
      return;
    }
    setDone({ createdAt: data.created_at ?? null, already: !!data.already });
  };

  // ---------------------------------------------------------------- pieces
  const title = ev ? eventTitle(ev as unknown as EventRow, lang) : en ? 'Volunteer' : '志愿者报名';
  const description = ev ? eventDescription(ev as unknown as EventRow, lang) : '';
  const when = ev ? eventWhenText(ev, lang) : '';
  const open = !!ev && isUpcoming(ev);

  const doneCard = () => {
    if (!done) return null;
    return (
      <div className={`${CARD} text-center space-y-3`}>
        <Check className="w-12 h-12 text-emerald-600 mx-auto" />
        <h2
          ref={doneTitle}
          tabIndex={-1}
          className="text-2xl font-bold text-maroon rounded focus:outline-none focus:ring-2 focus:ring-brick"
        >
          {en ? 'Thank you for volunteering' : '感谢您报名志愿者'}
        </h2>
        <p className="text-sm text-neutral-700 leading-relaxed">
          {en
            ? "You're on the volunteer list for this event. We'll be in touch by email before the event."
            : '您已加入本次活动的志愿者名单，活动前我们会通过邮件与您联系。'}
        </p>
        {done.already && (
          <p className="p-3 bg-neutral-100 border border-neutral-200 rounded-xl text-xs text-neutral-700 text-left">
            {en
              ? 'We updated your answers; your original sign-up time is kept.'
              : '我们已更新您的回答，最初的报名时间保持不变。'}
          </p>
        )}
        <p className="text-[11px] text-neutral-500">
          {en ? 'A confirmation has been emailed to you.' : '确认邮件已发送到您的邮箱。'}
        </p>
        {open && (
          <div className="pt-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={() => {
                setDone(null);
                setRefocus((n) => n + 1);
              }}
              className={SECONDARY}
            >
              {en ? 'Change my answers' : '修改我的回答'}
            </button>
          </div>
        )}
      </div>
    );
  };

  const formCard = () => (
    <form onSubmit={submit} className={`${CARD} relative space-y-5`} noValidate>
      <div>
        <h2 className="text-xl font-bold text-maroon">{en ? 'Volunteer sign-up' : '志愿者报名'}</h2>
        <p className="text-xs text-neutral-500 mt-1">
          {en ? 'Fields marked * are required.' : '带 * 的为必填项。'}
        </p>
      </div>

      <div>
        <label className={LABEL} htmlFor="vol-name">
          {en ? 'Full name *' : '姓名 *'}
        </label>
        <input
          id="vol-name"
          type="text"
          autoComplete="name"
          maxLength={120}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="vol-email">
          {en ? 'Email *' : '邮箱 *'}
        </label>
        <input
          id="vol-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          required
          readOnly={emailLocked}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={`${INPUT} ${emailLocked ? 'text-neutral-500' : ''}`}
        />
        {emailLocked && (
          <p className="mt-2 text-[11px] text-neutral-500">
            {en ? 'Signing up under another email? ' : '想用其他邮箱报名？'}
            <button
              type="button"
              onClick={() => void auth.signOut()}
              className="font-semibold text-neutral-700 hover:text-brick transition-colors cursor-pointer"
            >
              {en ? 'Sign out' : '退出登录'}
            </button>
          </p>
        )}
      </div>

      <div>
        <label className={LABEL} htmlFor="vol-phone">
          {en ? 'Phone' : '电话'}
        </label>
        <input
          id="vol-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={INPUT}
        />
      </div>

      <QuestionFields questions={questions} answers={answers} onChange={setAnswers} lang={lang} />

      {/* Honeypot: people never see or fill it; the API then answers ok without
          saving anything. Its name means nothing to browser autofill. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden">
        <input
          id="caaci_hp_field"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />
      </div>

      <p className="text-xs text-neutral-500">
        {en ? "You'll get a confirmation email after you sign up." : '报名后您会收到一封确认邮件。'}
      </p>

      {error && (
        <div role="alert" className={ALERT_ERROR}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <TurnstileBox handle={turnstile} />

      <button type="submit" disabled={busy} className={`${PRIMARY} w-full`}>
        {busy ? (en ? 'Submitting…' : '提交中…') : en ? 'Sign up to volunteer' : '报名成为志愿者'}
      </button>
    </form>
  );

  const body = () => {
    if (status === 'loading')
      return (
        <p role="status" className="text-center text-sm text-neutral-500 py-10">
          {en ? 'Loading…' : '加载中…'}
        </p>
      );
    if (status === 'missing')
      return (
        <div className={`${CARD} space-y-2`} role="alert">
          <h2 className="text-lg sm:text-xl font-bold text-maroon">
            {en ? 'This event is not taking volunteers' : '该活动未开放志愿者报名'}
          </h2>
          <p className="text-sm text-neutral-700 leading-relaxed">
            {en
              ? 'The link may be mistyped, or the event has already happened.'
              : '链接可能有误，或活动已经结束。'}{' '}
            <a
              href={eventsPath(lang)}
              onClick={(e) => {
                e.preventDefault();
                onNavigate('events');
              }}
              className="font-semibold text-neutral-700 hover:text-brick transition-colors"
            >
              {en ? 'See all events' : '查看全部活动'}
            </a>
            {' · '}
            <button
              type="button"
              onClick={() => onOpenModal('volunteer')}
              className="font-semibold text-neutral-700 hover:text-brick transition-colors cursor-pointer"
            >
              {en ? 'Volunteer for any event' : '报名任何活动的志愿者'}
            </button>
          </p>
        </div>
      );
    if (status === 'failed')
      return (
        <div className={`${CARD} space-y-3`} role="alert">
          <p className="text-sm text-rose-800 leading-relaxed">
            {en
              ? "We couldn't load the volunteer form. Check your connection and try again."
              : '无法加载志愿者报名表，请检查网络后重试。'}
          </p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={SECONDARY}>
            <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
            {en ? 'Try again' : '重试'}
          </button>
        </div>
      );
    return <div className="space-y-6">{done ? doneCard() : formCard()}</div>;
  };

  return (
    <div className="bg-white">
      <SubpageHero
        title={title}
        subtitle={description || undefined}
        bgImage="/images/hero-bg.jpg"
        content={content}
        onOpenModal={onOpenModal}
        onNavigate={onNavigate}
        currentPage="events"
        showActionBanners={false}
      />

      <motion.section
        initial={riseFromSm}
        animate={shown}
        transition={mountIn}
        className="py-12 sm:py-16"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          {status === 'ready' && (when || ev?.location) && (
            <div className="max-w-2xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-neutral-600">
              {when && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-brick" />
                  {when}
                </span>
              )}
              {ev?.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-brick" />
                  {ev.location}
                </span>
              )}
            </div>
          )}
          {body()}
        </div>
      </motion.section>
    </div>
  );
}
