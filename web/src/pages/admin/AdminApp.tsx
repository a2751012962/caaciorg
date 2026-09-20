// /admin/ — the back office in React. It replaced the Tabler panel that used to
// live at this address tab for tab (archive/admin-tabler/), and was built at
// /admin-next/, which is now a stub into here. Same Pages Functions
// (/api/admin/*), which check the caller again on
// every request; this page only gates the UI. Rendered without the public
// site's navbar and footer (App.tsx), with its own header and tab rail.
import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  BadgeCheck,
  CalendarDays,
  Coins,
  ExternalLink,
  HandHeart,
  Home,
  Languages,
  LayoutDashboard,
  LogOut,
  Receipt,
  Send,
  Store,
  TicketPercent,
  Undo2,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { loginUrl, useAuth } from '../../lib/auth';
import { initialLang, storeLang, type Lang } from '../../lib/lang';
import { api as publicApi } from '../../lib/api';
import { fluidTab } from '../../lib/motion';
import { AdminProvider, Notice, SECONDARY, Spinner, type TabId } from './kit';

type Tab = { id: TabId; en: string; zh: string; icon: LucideIcon; C: ComponentType };

const tab = (
  id: TabId,
  en: string,
  zh: string,
  icon: LucideIcon,
  load: () => Promise<{ default: ComponentType }>,
): Tab => ({
  id,
  en,
  zh,
  icon,
  C: lazy(load),
});

const TABS: Tab[] = [
  tab('dashboard', 'Dashboard', '看板', LayoutDashboard, () => import('./tabs/DashboardTab')),
  tab('members', 'Members & Subscriptions', '会员与订阅', Users, () => import('./tabs/MembersTab')),
  tab('families', 'Families', '家庭', Home, () => import('./tabs/FamiliesTab')),
  tab('payments', 'Payments', '收款记录', Receipt, () => import('./tabs/PaymentsTab')),
  tab('discounts', 'Discount codes', '折扣码', TicketPercent, () => import('./tabs/DiscountsTab')),
  tab('events', 'Events', '活动', CalendarDays, () => import('./tabs/EventsTab')),
  tab('volunteers', 'Volunteers', '志愿者', HandHeart, () => import('./tabs/VolunteersTab')),
  tab('directory', 'Business directory', '商家名录', Store, () => import('./tabs/DirectoryTab')),
  tab('plans', 'Membership plans', '会员方案', BadgeCheck, () => import('./tabs/PlansTab')),
  tab('news', 'Send news', '发送通讯', Send, () => import('./tabs/NewsTab')),
  tab('refunds', 'Refunds', '退款', Undo2, () => import('./tabs/RefundsTab')),
  tab('account', 'My account', '我的账号', UserCog, () => import('./tabs/AccountTab')),
];

// Shortcuts to the dashboards behind the site. Plain links: each asks for its own login.
const CONSOLES = [
  ['Supabase', 'https://supabase.com/dashboard/project/wslzeqhipvibeflmxznh'],
  ['Resend', 'https://resend.com/emails'],
  ['Cloudflare', 'https://dash.cloudflare.com/60fc7d5394f94e7cbe99e82e34cfc640/pages/view/caaci'],
  ['Stripe', 'https://dashboard.stripe.com/acct_1PfYMiJ3oYxWrRWD/dashboard'],
] as const;

// #members or #volunteers?event=<id>
function readHash(): { id: TabId; params: Record<string, string> } {
  const [name, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  const found = TABS.find((x) => x.id === name);
  return {
    id: found ? found.id : 'dashboard',
    params: Object.fromEntries(new URLSearchParams(query)),
  };
}

export function AdminApp() {
  const auth = useAuth();
  const [lang, setLang] = useState<Lang>(() => initialLang());
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);
  const [{ id: current, params }, setRoute] = useState(readHash);
  const [tokensOn, setTokensOn] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = `${t('Admin', '管理后台')} | CAACI`;
  });

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((id: TabId, p?: Record<string, string>) => {
    const q = p && Object.keys(p).length ? `?${new URLSearchParams(p)}` : '';
    window.history.pushState(null, '', `#${id}${q}`);
    setRoute({ id, params: p ?? {} });
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    if (auth.ready && !auth.user) window.location.assign(loginUrl());
  }, [auth.ready, auth.user]);

  const isAdmin = auth.member?.is_admin === true;
  useEffect(() => {
    if (!isAdmin) return;
    // The token back office link shows only when tokens are switched on.
    void publicApi<{ enabled?: boolean }>('/api/tokens/me', undefined, { auth: true }).then((r) =>
      setTokensOn(r.ok && r.data.enabled === true),
    );
  }, [isAdmin]);

  const toggleLang = () => {
    const next = lang === 'en' ? 'zh' : 'en';
    storeLang(next);
    setLang(next);
  };
  const signOut = async () => {
    await auth.signOut();
    window.location.assign(loginUrl('/admin/'));
  };

  const header = (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-neutral-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
        <a href="/" className="shrink-0">
          <img src="/images/logo.png" alt="CAACI" className="h-9 w-auto" />
        </a>
        <span className="text-sm font-semibold text-ink">{t('Admin', '管理后台')}</span>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {tokensOn && (
            <a
              href="/token-admin/"
              className="hidden sm:inline-flex h-11 px-3 items-center gap-1.5 rounded-full text-xs font-semibold text-neutral-700 hover:text-brick"
            >
              <Coins className="w-4 h-4" aria-hidden />
              {t('Tokens', '华协币')}
            </a>
          )}
          <button
            type="button"
            onClick={toggleLang}
            className="h-11 px-3 inline-flex items-center gap-1.5 rounded-full text-xs font-semibold text-neutral-700 hover:text-brick cursor-pointer"
          >
            <Languages className="w-4 h-4" aria-hidden />
            {lang === 'en' ? '中文' : 'EN'}
          </button>
          {auth.user && (
            <button
              type="button"
              onClick={() => void signOut()}
              className="h-11 px-3 inline-flex items-center gap-1.5 rounded-full text-xs font-semibold text-neutral-700 hover:text-brick cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden />
              <span className="hidden sm:inline">{t('Sign out', '退出登录')}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );

  if (!auth.ready || !auth.user)
    return (
      <div className="min-h-screen bg-white font-sans">
        {header}
        <Spinner label={t('Checking access…', '正在验证权限…')} />
      </div>
    );

  if (!isAdmin)
    return (
      <div className="min-h-screen bg-white font-sans">
        {header}
        <div className="max-w-md mx-auto px-4 py-16">
          <Notice tone="error">
            {t('This account is not an administrator.', '该账户不是管理员。')}
          </Notice>
        </div>
      </div>
    );

  const active = TABS.find((x) => x.id === current) ?? TABS[0];
  const Current = active.C;

  const nav = (vertical: boolean) => (
    <LayoutGroup id={vertical ? 'admin-rail' : 'admin-strip'}>
      <nav
        aria-label={t('Admin sections', '后台栏目')}
        className={
          vertical
            ? 'flex flex-col gap-0.5'
            : 'flex gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none]'
        }
      >
        {TABS.map((x) => {
          const on = x.id === current;
          const Icon = x.icon;
          return (
            <button
              key={x.id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => go(x.id)}
              className={`relative shrink-0 inline-flex items-center gap-2.5 min-h-[44px] px-3.5 rounded-full text-sm cursor-pointer transition-colors whitespace-nowrap ${
                on ? 'text-ink font-semibold' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {/* The page is white; grey is the mark of the tab that has focus. */}
              {on && (
                <motion.span
                  layoutId="admin-tab-pill"
                  transition={fluidTab}
                  className="absolute inset-0 rounded-full bg-neutral-100"
                  aria-hidden
                />
              )}
              <Icon className="relative w-4 h-4 shrink-0" aria-hidden />
              <span className="relative">{t(x.en, x.zh)}</span>
            </button>
          );
        })}
      </nav>
    </LayoutGroup>
  );

  return (
    <div className="min-h-screen bg-white font-sans text-neutral-800">
      {header}
      <div className="lg:hidden sticky top-16 z-30 bg-white/95 backdrop-blur border-b border-neutral-200/60">
        {nav(false)}
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:flex lg:gap-8">
        <aside className="hidden lg:block w-60 shrink-0 py-8">
          <div className="sticky top-24 space-y-6">
            {nav(true)}
            <div className="px-3.5 space-y-2">
              <p className="text-xs font-bold text-neutral-500">{t('Quick links', '快捷入口')}</p>
              <div className="flex flex-wrap gap-1.5">
                {CONSOLES.map(([name, href]) => (
                  <a
                    key={name}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-neutral-200 bg-white text-[11px] font-semibold text-neutral-600 hover:border-brick hover:text-brick"
                  >
                    {name}
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </aside>
        <main className="flex-1 min-w-0 py-6 sm:py-8">
          <AdminProvider
            lang={lang}
            myId={auth.user.id}
            myEmail={auth.user.email ?? null}
            go={go}
            params={params}
          >
            <Suspense fallback={<Spinner label={t('Loading…', '加载中…')} />}>
              {/* keyed so a tab starts fresh when it is opened again with new params */}
              <Current key={`${current}?${new URLSearchParams(params)}`} />
            </Suspense>
          </AdminProvider>
          <p className="lg:hidden mt-10 flex flex-wrap gap-1.5">
            {CONSOLES.map(([name, href]) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={SECONDARY}
              >
                {name}
                <ExternalLink className="w-3 h-3" aria-hidden />
              </a>
            ))}
          </p>
        </main>
      </div>
    </div>
  );
}
