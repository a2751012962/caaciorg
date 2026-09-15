import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Calendar, Check, Gift, MapPin, RefreshCw } from 'lucide-react';
import { SubpageHero } from '../components/SubpageHero';
import type { CAACIContent } from '../data/content';
import { api } from '../lib/api';
import { loginUrl, useAuth } from '../lib/auth';
import {
  deadlineText,
  eventDescription,
  eventTitle,
  eventWhenText,
  eventsPath,
  EVENT_TZ,
  type EventRow,
} from '../lib/events';
import type { Lang } from '../lib/lang';
import { mountIn, riseFromSm, shown } from '../lib/motion';
import {
  eventSlugFrom,
  otherFieldId,
  perkStep,
  questionFieldId,
  questionLabel,
  readAnswers,
  volunteerBody,
  zhError,
} from '../lib/registration';

// ---------------------------------------------------------------- the API's shapes

/** A free gift: perkOf() in functions/api/_event-form.js. */
interface Perk {
  item_en: string;
  item_zh: string;
  deadline: string | null;
}

interface Question {
  id: string;
  type: 'text' | 'textarea' | 'single' | 'multi';
  label_en: string;
  label_zh?: string | null;
  required?: boolean;
  other?: boolean;
  options?: { id: string; label_en: string; label_zh?: string | null }[];
}

/** GET /api/event-register?event=<slug> → `event`. */
interface RegEvent {
  slug: string;
  title: string;
  title_zh: string | null;
  description: string | null;
  description_zh: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  perk: Perk | null;
  questions: Question[];
  open: boolean;
}

interface RegInfo {
  event?: RegEvent;
  signed_in?: boolean;
  email?: string | null;
  registration?: { registered_at: string; updated_at: string } | null;
  volunteer?: { name: string; phone: string | null; created_at: string } | null;
  error?: string;
}

interface PostResult {
  ok?: boolean;
  already?: boolean;
  registered_at?: string | null;
  signed_in?: boolean;
  linked?: boolean;
  volunteer?: boolean;
  perk?: Perk | null;
  error?: string;
}

/** What the success card shows, once a registration is known. */
interface Done {
  registeredAt: string | null;
  already: boolean;
  signedIn: boolean;
  linked: boolean;
  volunteer: boolean;
}

/** One question's state: a typed string, or the choices picked plus "Other". */
type ChoiceState = { picked: string[]; other: string | null };
type AnswerState = Record<string, string | ChoiceState>;

// The address an anonymous registrant's account is offered under, handed to
// /login-3/ through sessionStorage so the email never rides in the URL.
const SIGNUP_EMAIL_KEY = 'caaci-signup-email';

// The event GET is the only thing between the visitor and the form, so a
// request that never answers gets cut off and offered a Retry instead.
const LOAD_TIMEOUT_MS = 6000;
// How long the sign-out on the way to /login-3/ is given before the stored
// session is dropped by hand.
const SIGN_OUT_TIMEOUT_MS = 3500;

// Supabase keeps the session in localStorage under sb-<project-ref>-auth-token.
// Removing it is the blunt fallback for a signOut() that failed or hung: the
// login page must not find this account still signed in.
function dropStoredSession() {
  try {
    for (const key of Object.keys(localStorage))
      if (/^sb-.*-auth-token/.test(key)) localStorage.removeItem(key);
  } catch {
    // Storage blocked — there was nothing stored to drop either.
  }
}

// ---------------------------------------------------------------- copy helpers

// The registration time, to the second: "Sep 13, 2026, 3:04:05 PM Central Time"
// · "2026年9月13日 下午3:04:05（美国中部时间）". Intl's short zone name reads
// "CDT" in English but a bare UTC offset in Chinese, which people misread, so
// this is assembled from the Chicago clock parts instead.
const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function registeredText(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const h12 = hour % 12 || 12;
  const clock = `${h12}:${get('minute')}:${get('second')}`;
  const month = Number(get('month'));
  if (lang === 'zh') {
    const period =
      hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour === 12 ? '中午' : hour < 18 ? '下午' : '晚上';
    return `${get('year')}年${month}月${get('day')}日 ${period}${clock}（美国中部时间）`;
  }
  return `${MONTHS_EN[month - 1]} ${get('day')}, ${get('year')}, ${clock} ${hour >= 12 ? 'PM' : 'AM'} Central Time`;
}

// ---------------------------------------------------------------- shared classes
// web/DESIGN_SYSTEM.md §5.2 / §5.1 / §5.3, verbatim.

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

interface EventRegisterPageProps {
  content: CAACIContent;
  lang: Lang;
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// The React rebuild of the Tabler page member-src/event-register.html: one page
// serves every event that takes registrations. GET /api/event-register answers
// with the event's details, its free gift (the "perk") and its own questions,
// which are drawn here, and tells a signed-in visitor whether they registered
// already. Registering needs no account; a gift also needs one by its deadline,
// so the success card walks an anonymous registrant to signup.
export function EventRegisterPage({
  content,
  lang,
  onOpenModal,
  onNavigate,
}: EventRegisterPageProps) {
  const en = lang === 'en';
  const auth = useAuth();
  const [slug] = useState(() => eventSlugFrom(window.location.pathname, window.location.search));

  const [status, setStatus] = useState<'loading' | 'missing' | 'failed' | 'ready'>('loading');
  // What the GET said about the session, which is what the API will act on.
  const [signedIn, setSignedIn] = useState(false);
  const [ev, setEv] = useState<RegEvent | null>(null);
  const [perk, setPerk] = useState<Perk | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<AnswerState>({});
  const [hp, setHp] = useState('');
  const [volChecked, setVolChecked] = useState(false);
  const [volPrefilled, setVolPrefilled] = useState(false);
  const [volName, setVolName] = useState('');
  const [volPhone, setVolPhone] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const doneTitle = useRef<HTMLHeadingElement>(null);
  // Set when "Change my answers" sends someone back, so the form takes focus.
  const [refocus, setRefocus] = useState(0);

  const questions = ev?.questions ?? [];
  // Signed in, but registered under a different address than the login one:
  // the gift goes with the registration email, so that account has to be left
  // before the right one can be created or signed in to.
  const signOutFirst = !!done && done.signedIn && !done.linked;
  // The account email is the one the API will file the registration under, so
  // it is fixed here — but only once the GET has confirmed the session and
  // handed back an address; a local token alone would lock an empty box.
  const emailLocked = signedIn && !!email;

  // Same-site link back to this page as it was reached (with the query, which
  // names the event on /event-register/?event=), never a fixed host.
  const here = window.location.pathname + window.location.search;

  // ---------------------------------------------------------------- load
  useEffect(() => {
    if (!slug) {
      setStatus('missing');
      return;
    }
    if (!auth.ready) return;
    let alive = true;
    setStatus('loading');
    // A request that never answers would leave the spinner up for good, with
    // no way back; after LOAD_TIMEOUT_MS it becomes the ordinary error with
    // Retry, which starts a fresh attempt.
    let timer = 0;
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
    });
    Promise.race([
      api<RegInfo>(`/api/event-register?event=${encodeURIComponent(slug)}`, undefined, {
        auth: true,
      }),
      timeout,
    ]).then((result) => {
      window.clearTimeout(timer);
      if (!alive) return;
      if (!result) return setStatus('failed');
      const { ok, status: code, data } = result;
      if (code === 404) return setStatus('missing');
      if (!ok || !data.event) return setStatus('failed');
      const event = data.event;
      setEv(event);
      setPerk(event.perk ?? null);
      // One entry per question, so every field is controlled from the start.
      const blank: AnswerState = {};
      for (const q of event.questions ?? [])
        blank[q.id] = q.type === 'text' || q.type === 'textarea' ? '' : { picked: [], other: null };
      setAnswers(blank);
      setSignedIn(!!data.signed_in);
      if (data.signed_in) {
        if (data.email) setEmail(data.email);
        // Signed up to volunteer before: show it as it stands, so a
        // resubmission does not silently drop the sign-up.
        if (data.volunteer) {
          setVolPrefilled(true);
          setVolChecked(true);
          setVolName(data.volunteer.name || '');
          setVolPhone(data.volunteer.phone || '');
        }
        if (data.registration) {
          setRegisteredEmail(data.email || '');
          setDone({
            registeredAt: data.registration.registered_at,
            already: false,
            signedIn: true,
            linked: true,
            volunteer: !!data.volunteer,
          });
        }
      }
      setStatus('ready');
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [slug, attempt, auth.ready]);

  // The member row carries the name the volunteer box would otherwise ask for.
  useEffect(() => {
    if (auth.member?.full_name) setVolName((n) => n || auth.member?.full_name || '');
    if (auth.member?.phone) setVolPhone((p) => p || auth.member?.phone || '');
  }, [auth.member]);

  useEffect(() => {
    const title = ev ? eventTitle(ev as unknown as EventRow, lang) : '';
    if (title) document.title = `${title} | Chinese American Association of Central Illinois`;
  }, [ev, lang]);

  useEffect(() => {
    if (done) doneTitle.current?.focus();
  }, [done]);

  // Back from the success card: the form is on screen again, so start where it
  // is filled in rather than leaving focus on a button that is gone.
  useEffect(() => {
    if (refocus) document.getElementById('ev-email')?.focus();
  }, [refocus]);

  // ---------------------------------------------------------------- submit
  const submit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (busy || !ev) return;
    const focus = (field: string) => document.getElementById(field)?.focus();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(en ? 'Enter a valid email address.' : '请填写有效邮箱。');
      focus('ev-email');
      return;
    }
    const read = readAnswers(questions, answers, lang);
    if ('error' in read) {
      setError(read.error);
      focus(read.field);
      return;
    }
    if (volChecked && !volName.trim()) {
      setError(en ? 'Enter your name to volunteer.' : '请填写志愿者姓名。');
      focus('ev-vol-name');
      return;
    }
    const body = {
      event: slug,
      email: address,
      answers: read.answers,
      _hp: hp,
      ...volunteerBody(volPrefilled, volChecked, volName, volPhone),
    };

    setError('');
    setBusy(true);
    const {
      ok,
      status: code,
      data,
    } = await api<PostResult>('/api/event-register', body, {
      auth: true,
    });
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
              : zhError(server) || '提交失败，请重试。'
            : en
              ? 'Could not submit — please try again.'
              : '提交失败，请重试。',
      );
      return;
    }
    // A saved registration always has a time. An ok without one saved nothing
    // (the honeypot answer, or a response we do not understand), so "You're
    // registered" would be a lie.
    if (!data.registered_at) {
      setError(
        en
          ? 'We could not confirm your registration. Please try again.'
          : '未能确认您的报名，请重试。',
      );
      return;
    }
    setRegisteredEmail(address);
    if ('perk' in data) setPerk(data.perk ?? null);
    setDone({
      registeredAt: data.registered_at,
      already: !!data.already,
      signedIn: !!data.signed_in,
      linked: typeof data.linked === 'boolean' ? data.linked : !!data.signed_in,
      volunteer: !!data.volunteer,
    });
  };

  // The login page sends a signed-in visitor straight back to ?next=, so
  // someone who registered under another address is signed out on the way.
  const goToLogin = useCallback(
    async (url: string) => {
      if (signOutFirst) {
        // Leaving this account is the whole point of the trip, so a sign-out
        // that hangs or fails must not carry the session onto the login page:
        // past SIGN_OUT_TIMEOUT_MS the stored token is dropped by hand, the
        // way the Tabler page's dropStoredSession() did.
        const left = await Promise.race([
          auth.signOut().then(
            () => true,
            () => false,
          ),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SIGN_OUT_TIMEOUT_MS)),
        ]);
        if (!left) dropStoredSession();
      }
      window.location.assign(url);
    },
    [auth, signOutFirst],
  );

  const startSignup = () => {
    try {
      if (registeredEmail) sessionStorage.setItem(SIGNUP_EMAIL_KEY, registeredEmail);
    } catch {
      // Storage blocked — they type the address on the signup form.
    }
    void goToLogin(loginUrl(here, true));
  };

  // ---------------------------------------------------------------- pieces
  const title = ev
    ? eventTitle(ev as unknown as EventRow, lang)
    : en
      ? 'Event registration'
      : '活动报名';
  const description = ev ? eventDescription(ev as unknown as EventRow, lang) : '';
  const when = ev ? eventWhenText(ev, lang) : '';

  const perkOpen = !!perk && (!perk.deadline || Date.now() <= new Date(perk.deadline).getTime());
  const perkWhen = perk ? deadlineText(perk.deadline, lang) : '';

  const setChoice = (q: Question, next: ChoiceState) =>
    setAnswers((prev) => ({ ...prev, [q.id]: next }));
  const choiceOf = (q: Question): ChoiceState => {
    const value = answers[q.id];
    return typeof value === 'object' && value ? value : { picked: [], other: null };
  };

  const questionField = (q: Question, index: number) => {
    const label = questionLabel(q, lang);
    const mark = q.required ? ' *' : '';
    if (q.type === 'text' || q.type === 'textarea') {
      const value = typeof answers[q.id] === 'string' ? (answers[q.id] as string) : '';
      const common = {
        id: questionFieldId(q),
        value,
        autoComplete: 'off',
        onChange: (e: { target: { value: string } }) =>
          setAnswers((prev) => ({ ...prev, [q.id]: e.target.value })),
      };
      return (
        <div key={q.id}>
          <label className={LABEL} htmlFor={questionFieldId(q)}>
            {label}
            {mark}
          </label>
          {q.type === 'text' ? (
            <input type="text" maxLength={500} className={INPUT} {...common} />
          ) : (
            <textarea rows={3} maxLength={2000} className={`${INPUT} resize-none`} {...common} />
          )}
        </div>
      );
    }
    const single = q.type === 'single';
    const state = choiceOf(q);
    return (
      <fieldset key={q.id}>
        <legend className={LABEL} id={index === 0 ? undefined : undefined}>
          {label}
          {mark}
        </legend>
        <div className="space-y-1.5">
          {(q.options ?? []).map((o, i) => {
            const checked = state.picked.includes(o.id);
            return (
              <label key={o.id} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  id={i === 0 ? questionFieldId(q) : `${questionFieldId(q)}-o-${o.id}`}
                  type={single ? 'radio' : 'checkbox'}
                  name={questionFieldId(q)}
                  className="accent-brick"
                  value={o.id}
                  checked={checked}
                  onChange={() =>
                    setChoice(
                      q,
                      single
                        ? { picked: [o.id], other: null }
                        : {
                            ...state,
                            picked: checked
                              ? state.picked.filter((id) => id !== o.id)
                              : [...state.picked, o.id],
                          },
                    )
                  }
                />
                <span className="text-neutral-800">{questionLabel(o, lang)}</span>
              </label>
            );
          })}
          {q.other && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  id={`${questionFieldId(q)}-other`}
                  type={single ? 'radio' : 'checkbox'}
                  name={questionFieldId(q)}
                  className="accent-brick"
                  checked={state.other !== null}
                  onChange={() =>
                    setChoice(
                      q,
                      state.other !== null
                        ? { ...state, other: null }
                        : { picked: single ? [] : state.picked, other: state.other ?? '' },
                    )
                  }
                />
                <span className="text-neutral-800">{en ? 'Other:' : '其他：'}</span>
              </label>
              <label className="sr-only" htmlFor={otherFieldId(q)}>
                {en ? `Other — ${q.label_en}` : `其他——${label}`}
              </label>
              <input
                id={otherFieldId(q)}
                type="text"
                maxLength={200}
                autoComplete="off"
                className={INPUT}
                placeholder={en ? 'Please specify' : '请注明'}
                value={state.other ?? ''}
                // Typing an "Other" answer picks Other, as the Google Form did.
                onChange={(e) =>
                  setChoice(q, {
                    picked: single && e.target.value.trim() ? [] : state.picked,
                    other: e.target.value,
                  })
                }
              />
            </div>
          )}
        </div>
      </fieldset>
    );
  };

  const perkCallout = perk && ev?.open !== false && (
    <div
      className={`${CARD} flex items-start gap-3 ${perkOpen ? 'bg-amber-50 border-amber-200' : ''}`}
    >
      <Gift className={`w-5 h-5 shrink-0 ${perkOpen ? 'text-brick' : 'text-neutral-400'}`} />
      <div className="space-y-1">
        <h2 className="text-lg sm:text-xl font-bold text-maroon font-serif-caaci">
          {perkOpen
            ? en
              ? `Free ${perk.item_en}`
              : `免费领${perk.item_zh}`
            : en
              ? `Free ${perk.item_en} sign-up has closed`
              : `免费${perk.item_zh}登记已截止`}
        </h2>
        <p className="text-sm text-neutral-700 leading-relaxed">
          {perkOpen
            ? en
              ? `Register and create a free CAACI website account${perkWhen ? ` by ${perkWhen}` : ''}, and pick up your free ${perk.item_en} at the event.`
              : `${perkWhen ? `${perkWhen}前` : ''}报名，并免费注册一个 CAACI 网站账户，活动当天就能在现场免费领一份${perk.item_zh}。`
            : en
              ? `It closed on ${perkWhen}. You can still register below.`
              : `已于${perkWhen}截止。您仍可在下方报名参加活动。`}
        </p>
        {perkOpen && (
          <p className="text-xs text-neutral-500 leading-relaxed">
            {en
              ? `You can register without an account — you just won't get the free ${perk.item_en}.`
              : `不注册账户也可以报名参加活动，只是领不到${perk.item_zh}。`}
          </p>
        )}
      </div>
    </div>
  );

  const signupStepText = () => {
    if (!perk) return '';
    const { item_en: itemEn, item_zh: itemZh } = perk;
    if (signOutFirst)
      return en
        ? `The free ${itemEn} goes with the email you registered with, not the account you are signed in to. Create a free CAACI account with that email${perkWhen ? ` by ${perkWhen}` : ''}, or log in to it — you will be signed out of this account first.`
        : `免费${itemZh}与报名时填写的邮箱绑定，而不是您当前登录的账户。请${perkWhen ? `在${perkWhen}前` : ''}用该邮箱免费注册 CAACI 账户或登录——系统会先为您退出当前账户。`;
    if (perkWhen)
      return en
        ? `One more step for a free ${itemEn}: create a free CAACI account with the email you registered with by ${perkWhen}.`
        : `领取免费${itemZh}还差一步：请在${perkWhen}前，用报名时填写的邮箱免费注册 CAACI 账户。`;
    return en
      ? `One more step for a free ${itemEn}: create a free CAACI account with the email you registered with before the event starts.`
      : `领取免费${itemZh}还差一步：在活动开始前，用报名时填写的邮箱免费注册 CAACI 账户。`;
  };

  const doneCard = () => {
    if (!done) return null;
    const stamp = registeredText(done.registeredAt, lang);
    const step = perk
      ? perkStep({
          deadline: perk.deadline,
          registeredAt: done.registeredAt,
          signedIn: done.signedIn && done.linked,
          accountCreatedAt: auth.user?.created_at,
        })
      : null;
    return (
      <div className={`${CARD} text-center space-y-3`}>
        <Check className="w-12 h-12 text-emerald-600 mx-auto" />
        <h2
          ref={doneTitle}
          tabIndex={-1}
          className="text-2xl font-bold text-maroon font-serif-caaci focus:outline-none"
        >
          {en ? "You're registered" : '报名成功'}
        </h2>
        {stamp && (
          <p className="text-xs text-neutral-500">
            {en ? `Registered ${stamp}` : `报名时间：${stamp}`}
          </p>
        )}
        {done.already && (
          <p className="p-3 bg-neutral-100 border border-neutral-200 rounded-xl text-xs text-neutral-700 text-left">
            {en
              ? 'We updated your answers; your original registration time is kept.'
              : '我们已更新您的回答，最初的报名时间保持不变。'}
          </p>
        )}
        {done.volunteer && (
          <p className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 text-left">
            {en
              ? "Thank you for volunteering — we'll be in touch."
              : '感谢您报名志愿者，我们会与您联系。'}
          </p>
        )}
        {step === 'counted' && perk && (
          <p className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
            {en ? `✓ Counted for a free ${perk.item_en}` : `✓ 已计入免费${perk.item_zh}名单`}
          </p>
        )}
        {step === 'signup' && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-700 leading-relaxed">{signupStepText()}</p>
            <button type="button" onClick={startSignup} className={`${PRIMARY} w-full sm:w-auto`}>
              {en ? 'Create a free account' : '免费注册账户'}
            </button>
            <p>
              <a
                href={loginUrl(here)}
                onClick={(e) => {
                  if (!signOutFirst) return; // otherwise a plain link
                  e.preventDefault();
                  void goToLogin(loginUrl(here));
                }}
                className="text-xs font-semibold text-neutral-700 hover:text-brick transition-colors"
              >
                {en ? 'Already have an account? Log in' : '已有账户？登录'}
              </a>
            </p>
          </div>
        )}
        {step === 'closed' && perk && (
          <p className="text-xs text-neutral-500">
            {en ? `Free ${perk.item_en} sign-up has closed.` : `免费${perk.item_zh}登记已截止。`}
          </p>
        )}
        {/* Hidden once the event has closed: there is nothing left to change. */}
        {ev?.open !== false && (
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
        <h2 className="text-xl font-bold text-maroon font-serif-caaci">
          {en ? 'Register' : '报名'}
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          {en ? 'Fields marked * are required.' : '带 * 的为必填项。'}
        </p>
      </div>

      <div>
        <label className={LABEL} htmlFor="ev-email">
          {en ? 'Email *' : '邮箱 *'}
        </label>
        <input
          id="ev-email"
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
            {en ? 'Registering under another email? ' : '想用其他邮箱报名？'}
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

      {questions.map(questionField)}

      {/* Volunteering at this event, asked alongside the registration so nobody
          has to fill in the volunteer form as well. The name and phone only
          appear once the box is ticked. */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            id="ev-vol"
            type="checkbox"
            className="accent-brick"
            checked={volChecked}
            onChange={(e) => setVolChecked(e.target.checked)}
          />
          <span className="text-neutral-800">
            {en ? "I'd also like to volunteer at this event" : '我也想在本次活动做志愿者'}
          </span>
        </label>
        {volChecked && (
          <div className="space-y-3 pl-6">
            <div>
              <label className={LABEL} htmlFor="ev-vol-name">
                {en ? 'Your name *' : '姓名 *'}
              </label>
              <input
                id="ev-vol-name"
                type="text"
                autoComplete="name"
                maxLength={120}
                value={volName}
                onChange={(e) => setVolName(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="ev-vol-phone">
                {en ? 'Phone' : '电话'}
              </label>
              <input
                id="ev-vol-phone"
                type="tel"
                autoComplete="tel"
                maxLength={40}
                value={volPhone}
                onChange={(e) => setVolPhone(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>
        )}
      </div>

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
        {en
          ? "You'll get a confirmation email after you register."
          : '报名后您会收到一封确认邮件。'}
      </p>

      {error && (
        <div role="alert" className={ALERT_ERROR}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <button type="submit" disabled={busy} className={`${PRIMARY} w-full`}>
        {busy ? (en ? 'Submitting…' : '提交中…') : en ? 'Submit' : '提交'}
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
          <h2 className="text-lg sm:text-xl font-bold text-maroon font-serif-caaci">
            {en ? 'This event is not open for registration' : '该活动未开放报名'}
          </h2>
          <p className="text-sm text-neutral-700 leading-relaxed">
            {en
              ? 'The link may be mistyped, or registration has not opened yet.'
              : '链接可能有误，或报名尚未开始。'}{' '}
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
          </p>
        </div>
      );
    if (status === 'failed')
      return (
        <div className={`${CARD} space-y-3`} role="alert">
          <p className="text-sm text-rose-800 leading-relaxed">
            {en
              ? "We couldn't load the registration form. Check your connection and try again."
              : '无法加载报名表，请检查网络后重试。'}
          </p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={SECONDARY}>
            <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
            {en ? 'Try again' : '重试'}
          </button>
        </div>
      );
    return (
      <div className="space-y-6">
        {perkCallout}
        {done ? (
          doneCard()
        ) : ev?.open === false ? (
          <div className={`${CARD} space-y-2`} role="status">
            <h2 className="text-lg sm:text-xl font-bold text-maroon font-serif-caaci">
              {en ? 'Registration has closed' : '报名已截止'}
            </h2>
            <p className="text-sm text-neutral-700">
              {en ? 'This event is no longer taking registrations.' : '本活动已停止接受报名。'}
            </p>
          </div>
        ) : (
          formCard()
        )}
      </div>
    );
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
