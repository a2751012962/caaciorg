import { useState, useEffect, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  Shield,
  CreditCard,
  History,
  Lock,
  Mail,
  Phone,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Calendar,
  MapPin,
  Clock,
  Ticket,
  Edit3,
  ChevronRight,
  LogOut,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Info,
  Building,
  Users,
  Layers,
  Award,
  Copy,
  Maximize2,
  Store,
  ShoppingBag,
  Utensils,
  Wrench,
  Check,
  Search,
  MessageSquare,
  Star,
  X,
} from 'lucide-react';
import { SubpageHero } from '../components/SubpageHero';
import { ContactSection } from '../components/ContactSection';
import { DigitalMemberCard } from '../components/DigitalMemberCard';
import { FamilySection } from '../components/FamilySection';
import { initialMockUser, type UserProfile } from '../types/account';
import type { CAACIContent } from '../data/content';

interface AccountPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
  user?: UserProfile;
  onUpdateUser?: (updater: (prev: UserProfile) => UserProfile) => void;
}

export function AccountPage({
  content,
  lang,
  onOpenModal,
  onNavigate,
  isLoggedIn,
  onLogin,
  onLogout,
  user: externalUser,
  onUpdateUser: externalUpdateUser,
}: AccountPageProps) {
  // Local user fallback if not provided externally
  const [localUser, setLocalUser] = useState<UserProfile>(initialMockUser);
  const user = externalUser || localUser;
  const onUpdateUser = externalUpdateUser || setLocalUser;

  // Mobile segmented navigation tab state
  const [activeMobileTab, setActiveMobileTab] = useState<
    'pass' | 'events' | 'family' | 'billing' | 'profile' | 'all'
  >('pass');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showQrZoomModal, setShowQrZoomModal] = useState(false);

  // Quick Toast Helper
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Copy to clipboard helper
  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    triggerToast(
      lang === 'en' ? `${label} copied to clipboard!` : `已成功复制 ${label} 到剪贴板！`,
    );
  };

  // Invite link simulation state
  const [hasInviteParam, setHasInviteParam] = useState(false);
  const [inviteArrivedFamily, setInviteArrivedFamily] = useState<{
    fromName: string;
    fromEmail: string;
    plan: string;
  } | null>(null);

  // Password reset url banner states
  const [resetAlertMode, setResetAlertMode] = useState<'none' | 'reset_token' | 'expired'>('none');

  // Account Security: Password Change/Set States
  const [passwordVerificationSent, setPasswordVerificationSent] = useState(false);
  const [passwordCountdown, setPasswordCountdown] = useState(0);
  const [verifyCode, setVerifyCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Account Security: Email Change States
  const [newEmail, setNewEmail] = useState('');
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  // Stripe Portal Simulation Modal
  const [showStripeModal, setShowStripeModal] = useState(false);

  // Edit Account Modal State
  const [showEditAccountModal, setShowEditAccountModal] = useState(false);
  const [editSecondaryPhone, setEditSecondaryPhone] = useState('(217) 555-0199');
  const [editWeChat, setEditWeChat] = useState('michael_cu_2026');
  const [editAddress, setEditAddress] = useState('Champaign, IL 61820');
  const [editInterests, setEditInterests] = useState(
    'Cultural Gala Volunteer, Youth Science Mentor',
  );
  const [editSavedToast, setEditSavedToast] = useState(false);

  // Cancel RSVP Modal
  const [cancelEventId, setCancelEventId] = useState<string | null>(null);

  // Event Feedback Modal State
  const [feedbackEvent, setFeedbackEvent] = useState<UserProfile['registeredEvents'][0] | null>(
    null,
  );
  const [feedbackRatings, setFeedbackRatings] = useState<{
    [eventId: string]: {
      rating: number;
      comment: string;
      tags: string[];
      submittedAt: string;
    };
  }>({
    'job-fair': {
      rating: 5,
      comment:
        'Very informative and well-organized job fair! Connected directly with Illinois state agency recruiters.',
      tags: ['Helpful Recruiters', 'Well Organized', 'Great Networking'],
      submittedAt: 'October 27, 2025',
    },
  });
  const [currentRating, setCurrentRating] = useState(5);
  const [currentHoverRating, setCurrentHoverRating] = useState(0);
  const [currentComment, setCurrentComment] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [feedbackSuccessToast, setFeedbackSuccessToast] = useState(false);

  const handleOpenFeedback = (evt: UserProfile['registeredEvents'][0]) => {
    setFeedbackEvent(evt);
    const existing = feedbackRatings[evt.id];
    if (existing) {
      setCurrentRating(existing.rating);
      setCurrentComment(existing.comment);
      setSelectedTags(existing.tags || []);
    } else {
      setCurrentRating(5);
      setCurrentComment('');
      setSelectedTags([]);
    }
    setFeedbackSuccessToast(false);
  };

  const handleSaveFeedback = (e: FormEvent) => {
    e.preventDefault();
    if (!feedbackEvent) return;
    setFeedbackRatings((prev) => ({
      ...prev,
      [feedbackEvent.id]: {
        rating: currentRating,
        comment: currentComment,
        tags: selectedTags,
        submittedAt: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      },
    }));
    setFeedbackSuccessToast(true);
    triggerToast(
      lang === 'en'
        ? 'Thank you! Your feedback has been submitted.'
        : '感谢您的评价！活动反馈已成功提交至 CAACI 组委会。',
    );
    setTimeout(() => {
      setFeedbackEvent(null);
      setFeedbackSuccessToast(false);
    }, 1200);
  };

  const toggleFeedbackTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  // Apple Wallet server cert toggle
  const [serverCertConfigured, setServerCertConfigured] = useState(true);

  // Check URL query parameters for invitation or reset token on mount
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const inviteCode = searchParams.get('invite');
    const reset = searchParams.get('reset');
    const expired = searchParams.get('expired');

    if (inviteCode) {
      setHasInviteParam(true);
      setInviteArrivedFamily({
        fromName: '张建华 (Jianhua Zhang)',
        fromEmail: 'jianhua.zhang@example.com',
        plan: 'CAACI Family Plan',
      });
      setActiveMobileTab('family');
    }

    if (reset === '1' || searchParams.has('reset_token')) {
      setResetAlertMode('reset_token');
      setActiveMobileTab('profile');
    } else if (expired === '1' || searchParams.has('link_expired')) {
      setResetAlertMode('expired');
      setActiveMobileTab('profile');
    }
  }, []);

  // Countdown timer for email verification code
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (passwordCountdown > 0) {
      timer = setTimeout(() => setPasswordCountdown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [passwordCountdown]);

  // Countdown timer for email change confirmation
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (emailCountdown > 0) {
      timer = setTimeout(() => setEmailCountdown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [emailCountdown]);

  // Handle Login action (with automatic redirect to family invite if applicable)
  const handlePerformLogin = () => {
    if (hasInviteParam && inviteArrivedFamily) {
      // Set the pending invite on the user account
      onUpdateUser((prev) => ({
        ...prev,
        familyData: {
          ...prev.familyData,
          receivedInvite: {
            id: 'inv_incoming_1',
            fromName: inviteArrivedFamily.fromName,
            fromEmail: inviteArrivedFamily.fromEmail,
            familyPlanName: inviteArrivedFamily.plan,
            inviteDate: new Date().toISOString().split('T')[0],
          },
        },
      }));
    }

    onLogin();

    // If entering via invite, automatically scroll to family section
    if (hasInviteParam) {
      setActiveMobileTab('family');
      setTimeout(() => {
        const familyElem = document.getElementById('family-section');
        if (familyElem) {
          familyElem.scrollIntoView({ behavior: 'smooth' });
        }
      }, 300);
    }
  };

  // Password update submit
  const handleUpdatePassword = (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!verifyCode.trim()) {
      setPasswordError(
        lang === 'en'
          ? 'Please enter the 6-digit verification code sent to your email.'
          : '请输入发送至您邮箱的 6 位验证码。',
      );
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(
        lang === 'en'
          ? 'Password must be at least 8 characters long.'
          : '新密码长度至少需要 8 个字符。',
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(lang === 'en' ? 'Passwords do not match.' : '两次输入的新密码不一致。');
      return;
    }

    // Success
    setPasswordSuccess(
      lang === 'en'
        ? 'Password updated successfully! Your account credentials are secure.'
        : '密码已成功更新！您的账户安全凭证已生效。',
    );
    setVerifyCode('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordVerificationSent(false);
  };

  // Send password verification code
  const handleSendPasswordCode = () => {
    setPasswordVerificationSent(true);
    setPasswordCountdown(60);
    setPasswordError(null);
  };

  // Send email change confirmation
  const handleSendEmailChange = (e: FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newEmail.includes('@')) return;

    setEmailVerificationSent(true);
    setEmailCountdown(60);
    setEmailSuccess(
      lang === 'en'
        ? `Confirmation email sent to ${newEmail}. Please click the link inside to verify.`
        : `确认邮件已发送至 ${newEmail}。请在邮件内点击确认链接以完成变更。`,
    );
  };

  // Cancel RSVP Handler
  const handleConfirmCancelEvent = (eventId: string) => {
    onUpdateUser((prev) => ({
      ...prev,
      registeredEvents: prev.registeredEvents.filter((ev) => ev.id !== eventId),
    }));
    setCancelEventId(null);
  };

  // Smooth scroll and jump to specific section
  const handleJumpToSection = (
    tab: 'pass' | 'events' | 'family' | 'billing' | 'profile',
    targetId?: string,
  ) => {
    setActiveMobileTab(tab);
    if (targetId) {
      setTimeout(() => {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('ring-2', 'ring-[#8e2e11]', 'ring-offset-2');
          setTimeout(() => el.classList.remove('ring-2', 'ring-[#8e2e11]', 'ring-offset-2'), 1800);
        }
      }, 80);
    }
  };

  const handleJumpToEditInfo = () => {
    handleJumpToSection('profile', 'edit-information');
  };

  return (
    <div className="min-h-screen bg-[#fafafc] pb-24 overflow-x-hidden">
      {/* Editorial Header - Desktop Only to keep Mobile clean & focused */}
      <div className="hidden sm:block">
        <SubpageHero
          title={lang === 'en' ? 'Member Portal' : '会员中心'}
          subtitle={
            lang === 'en'
              ? 'Account credentials, digital member passes, and household privileges.'
              : 'CAACI 个人中心、电子会员卡、家庭方案及活动凭证管理'
          }
          content={content}
          onOpenModal={onOpenModal}
          onNavigate={onNavigate}
          currentPage="account"
          showActionBanners={false}
        />
      </div>

      {/* ========================================================================= */}
      {/* 1. NOT LOGGED IN STATE (没登录时) */}
      {/* ========================================================================= */}
      {!isLoggedIn ? (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 sm:pt-0 sm:-mt-8 relative z-20">
          <div className="bg-white rounded-3xl border border-neutral-200/90 shadow-xl p-6 sm:p-12 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-400 flex items-center justify-center mx-auto shadow-inner">
              <User className="w-8 h-8 text-neutral-500" />
            </div>

            <div className="space-y-2 max-w-md mx-auto">
              <h2 className="text-xl sm:text-2xl font-bold font-serif-caaci text-[#1d1d1f]">
                {lang === 'en' ? 'You are not logged in' : '您尚未登录'}
              </h2>
              <p className="text-xs sm:text-sm text-neutral-500 leading-relaxed">
                {lang === 'en'
                  ? 'Please sign in to view your CAACI digital member card, subscription status, and family household benefits.'
                  : '请登录后查看您的 CAACI 电子会员卡、会费订阅状态、家庭成员权益以及活动报名凭证。'}
              </p>
            </div>

            {/* If arriving via Family Invite Link */}
            {hasInviteParam && inviteArrivedFamily && (
              <div className="max-w-md mx-auto p-4 bg-amber-50 border border-amber-200/90 rounded-2xl text-left space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                  <Mail className="w-4 h-4 text-amber-700" />
                  <span>
                    {lang === 'en'
                      ? 'Family Invitation Link Detected'
                      : '检测到家庭会员专属邀请链接'}
                  </span>
                </div>
                <p className="text-xs text-amber-800 leading-relaxed">
                  {lang === 'en'
                    ? `${inviteArrivedFamily.fromName} has invited you to join their CAACI Family Membership. Logging in will immediately bind this invitation to your account.`
                    : `您正在通过 ${inviteArrivedFamily.fromName} 发送的家庭邀请链接访问。登录后系统将自动为您呈现该邀请并激活权益绑定。`}
                </p>
              </div>
            )}

            {/* Action Buttons: 登录、加入会员 */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 pt-2">
              <button
                type="button"
                onClick={handlePerformLogin}
                className="w-full sm:w-auto min-h-[44px] px-8 py-3 rounded-full bg-[#8e2e11] hover:brightness-110 text-white font-semibold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md inline-flex items-center justify-center gap-2 active:scale-98"
              >
                <KeyRound className="w-4 h-4" />
                <span>{lang === 'en' ? 'Log In to Account' : '登录'}</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('membership')}
                className="w-full sm:w-auto min-h-[44px] px-8 py-3 rounded-full bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 font-semibold text-xs uppercase tracking-wider transition-all cursor-pointer inline-flex items-center justify-center gap-2 active:scale-98"
              >
                <Sparkles className="w-4 h-4 text-[#8e2e11]" />
                <span>{lang === 'en' ? 'Join Membership' : '加入会员'}</span>
              </button>
            </div>

            {/* Quick Demo Simulator for Testing Family Invite Link */}
            <div className="pt-6 border-t border-neutral-100 max-w-sm mx-auto">
              <button
                type="button"
                onClick={() => {
                  setHasInviteParam(!hasInviteParam);
                  setInviteArrivedFamily(
                    hasInviteParam
                      ? null
                      : {
                          fromName: '张建华 (Jianhua Zhang)',
                          fromEmail: 'jianhua.zhang@example.com',
                          plan: 'CAACI Family Plan',
                        },
                  );
                }}
                className="text-[11px] text-neutral-400 hover:text-neutral-700 underline cursor-pointer py-1"
              >
                {hasInviteParam
                  ? lang === 'en'
                    ? 'Cancel simulated family invite link'
                    : '取消模拟家庭邀请链接'
                  : lang === 'en'
                    ? 'Demo: Simulate arriving via Family Invite link'
                    : '演示：模拟点家庭邀请链接进入'}
              </button>
            </div>
          </div>
        </section>
      ) : (
        /* ========================================================================= */
        /* 2. LOGGED IN STATE (登录后) */
        /* ========================================================================= */
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 pt-4 sm:pt-0 sm:-mt-8 relative z-20 space-y-5 sm:space-y-8">
          {/* ======================================================================= */}
          {/* PERSONAL PROFILE SUMMARY (个人信息与快捷状态) - 移除外围卡片，保留完整信息 */}
          {/* ======================================================================= */}
          <div className="py-2 px-1 transition-all">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Left: Avatar & User Identity */}
              <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                <div className="relative shrink-0">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-[#8e2e11] to-[#5c1c0a] text-white flex items-center justify-center font-bold text-lg sm:text-xl shadow-xs">
                    {user.name.slice(0, 1) || '陈'}
                  </div>
                  <span
                    className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-2xs"
                    title={lang === 'en' ? 'Active Account' : '账户正常'}
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-base sm:text-xl font-bold text-[#1d1d1f] tracking-tight">
                      {user.name}
                    </h2>
                    <span className="text-xs sm:text-sm font-medium text-[#8e2e11]">
                      {lang === 'en' ? user.membership.tierNameEN : user.membership.tierNameZH}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                    <span className="truncate">{user.email}</span>
                    <span className="text-neutral-300 hidden sm:inline">•</span>
                    <span className="font-mono text-[11px] text-neutral-400 shrink-0">
                      ID: {user.memberId || 'CAACI-2026-0842'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Quick Jump Shortcuts showing Events Count & Pass Status */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0 pt-1 lg:pt-0">
                {/* 1. Events: 3 */}
                <button
                  type="button"
                  onClick={() => handleJumpToSection('events', 'registered-events')}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 shadow-2xs active:scale-95 ${
                    activeMobileTab === 'events'
                      ? 'bg-[#8e2e11] text-white'
                      : 'bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-200/90'
                  }`}
                  title={lang === 'en' ? 'Jump to Registered Events' : '直接跳转至活动日程'}
                >
                  <Ticket className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Events: ' : '活动: '}</span>
                  <span className="font-bold">{user.registeredEvents.length}</span>
                </button>

                {/* 2. Pass Status */}
                <button
                  type="button"
                  onClick={() => handleJumpToSection('pass')}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 shadow-2xs active:scale-95 ${
                    activeMobileTab === 'pass'
                      ? 'bg-[#8e2e11] text-white'
                      : 'bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-200/90'
                  }`}
                  title={lang === 'en' ? 'Digital Member Pass Status' : '会员通行证状态'}
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Pass: ' : '会员卡: '}</span>
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        user.membership.status === 'active' && !user.membership.paymentFailed
                          ? activeMobileTab === 'pass'
                            ? 'bg-emerald-300'
                            : 'bg-emerald-500'
                          : 'bg-neutral-400'
                      }`}
                    />
                    <span>
                      {user.membership.status === 'active' && !user.membership.paymentFailed
                        ? lang === 'en'
                          ? 'Active'
                          : '有效'
                        : lang === 'en'
                          ? 'Inactive'
                          : '未激活'}
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* ======================================================================= */}
          {/* TOP ALERTS & MOBILE QUICK TABS */}
          {/* ======================================================================= */}
          <div className="space-y-4">
            {/* 1. Conditional Alerts: Reset Password / Link Expired */}
            {resetAlertMode === 'expired' && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3 animate-fadeIn">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs">
                  <span className="font-bold text-rose-950 block sm:inline mr-2">
                    {lang === 'en' ? 'Password Reset Link Expired' : '重置密码链接已失效'}
                  </span>
                  <span className="text-rose-800">
                    {lang === 'en'
                      ? 'For security reasons, password reset tokens expire in 15 minutes. Please request a new verification code.'
                      : '出于安全考虑，密码重置安全口令有效期为 15 分钟。该链接已失效，请重新发送邮件验证码。'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setResetAlertMode('none')}
                  className="text-xs text-rose-600 font-semibold hover:underline cursor-pointer p-1"
                >
                  {lang === 'en' ? 'Dismiss' : '关闭'}
                </button>
              </div>
            )}

            {resetAlertMode === 'reset_token' && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3 animate-fadeIn">
                <KeyRound className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs">
                  <span className="font-bold text-amber-950 block sm:inline mr-2">
                    {lang === 'en' ? 'Password Reset Mode Active' : '正在通过密码重置链接访问'}
                  </span>
                  <span className="text-amber-800">
                    {lang === 'en'
                      ? 'You entered via an email reset token. Please set your new password in the Account Security section below.'
                      : '您已通过邮件安全验证访问，请在下方【账户安全】模块内设置您的新密码。'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setResetAlertMode('none')}
                  className="text-xs text-amber-700 font-semibold hover:underline cursor-pointer p-1"
                >
                  {lang === 'en' ? 'Dismiss' : '关闭'}
                </button>
              </div>
            )}

            {/* Mobile Sticky Segmented Quick Tabs */}
            <div className="lg:hidden sticky top-16 z-30 bg-[#fafafc]/95 backdrop-blur-md py-1.5 -mx-3.5 px-3.5 border-y border-neutral-200/70 shadow-xs">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                <button
                  type="button"
                  onClick={() => setActiveMobileTab('pass')}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
                    activeMobileTab === 'pass'
                      ? 'bg-[#8e2e11] text-white shadow-sm'
                      : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200/80'
                  }`}
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Digital Pass' : '会员卡'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMobileTab('events')}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
                    activeMobileTab === 'events'
                      ? 'bg-[#8e2e11] text-white shadow-sm'
                      : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200/80'
                  }`}
                >
                  <Ticket className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'My Events' : '我的活动'}</span>
                  {user.registeredEvents.length > 0 && (
                    <span className="font-bold text-xs">{user.registeredEvents.length}</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMobileTab('family')}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
                    activeMobileTab === 'family'
                      ? 'bg-[#8e2e11] text-white shadow-sm'
                      : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200/80'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Family' : '家庭成员'}</span>
                  {user.familyData.members.length > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        activeMobileTab === 'family'
                          ? 'bg-white/20 text-white'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {user.familyData.members.length}/{user.familyData.maxMembers || 3}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMobileTab('billing')}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
                    activeMobileTab === 'billing'
                      ? 'bg-[#8e2e11] text-white shadow-sm'
                      : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200/80'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Billing' : '订阅账单'}</span>
                  {user.membership.paymentFailed && (
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMobileTab('profile')}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
                    activeMobileTab === 'profile'
                      ? 'bg-[#8e2e11] text-white shadow-sm'
                      : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200/80'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Profile & Security' : '资料与安全'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMobileTab('all')}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1 shrink-0 ${
                    activeMobileTab === 'all'
                      ? 'bg-neutral-900 text-white shadow-sm'
                      : 'bg-white text-neutral-500 hover:text-neutral-800 border border-neutral-200/80'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'All' : '全部'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* ======================================================================= */}
          {/* SECTION: DIGITAL MEMBER CARD & PERKS (PROMINENT FOR MOBILE PASS TAB) */}
          {/* ======================================================================= */}
          <div
            className={`${activeMobileTab === 'pass' || activeMobileTab === 'all' ? 'block' : 'hidden'} lg:hidden space-y-4`}
          >
            {user.membership.status === 'active' && !user.membership.paymentFailed ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                {/* Action Bar for Mobile Member Pass */}
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-[#8e2e11]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                      {lang === 'en' ? 'Official Member Pass' : 'CAACI 官方会员通行证'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQrZoomModal(true)}
                    className="min-h-[34px] px-3 py-1 rounded-full bg-neutral-900 hover:bg-neutral-800 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs active:scale-98"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-[#edbb5f]" />
                    <span>{lang === 'en' ? 'Enlarge QR' : '放大条码'}</span>
                  </button>
                </div>

                {/* Digital Member Card Render directly */}
                <DigitalMemberCard
                  user={user}
                  lang={lang}
                  serverCertConfigured={serverCertConfigured}
                />
              </motion.div>
            ) : (
              <div className="bg-white rounded-2xl sm:rounded-3xl border border-neutral-200/90 p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto">
                  <Lock className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-neutral-900">
                  {lang === 'en' ? 'Digital Member Card Locked' : '电子会员卡未激活'}
                </h4>
                <p className="text-xs text-neutral-500 leading-relaxed max-w-xs mx-auto">
                  {lang === 'en'
                    ? 'Digital card with real-time merchant QR verification is only accessible when your membership status is active.'
                    : '电子会员卡及商户扫码验真二维码仅在会员资格有效时开放。'}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('membership')}
                  className="min-h-[44px] px-6 py-2.5 rounded-full bg-[#8e2e11] text-white text-xs font-semibold cursor-pointer active:scale-98"
                >
                  {lang === 'en' ? 'Activate Membership' : '激活会员资格'}
                </button>
              </div>
            )}
          </div>

          {/* ======================================================================= */}
          {/* SECTION: MY REGISTERED EVENTS (CLEAN DIRECT CONTAINER) */}
          {/* ======================================================================= */}
          <div
            id="registered-events"
            className={`${activeMobileTab === 'events' || activeMobileTab === 'all' ? 'block' : 'hidden'} lg:block space-y-3 sm:space-y-4 scroll-mt-24 transition-all`}
          >
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-[#8e2e11]" />
                <h3 className="text-base sm:text-lg font-bold text-[#1d1d1f]">
                  {lang === 'en' ? 'My Registered Events' : '我报名的活动'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('events')}
                className="min-h-[36px] text-xs text-[#8e2e11] hover:underline font-semibold inline-flex items-center gap-1 cursor-pointer py-1"
              >
                <span>{lang === 'en' ? 'Browse All Events' : '浏览更多社区活动'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {user.registeredEvents.length === 0 ? (
              <div className="text-center py-8 text-xs text-neutral-500 bg-white rounded-2xl sm:rounded-3xl border border-dashed border-neutral-200 shadow-xs">
                <Ticket className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                <p>
                  {lang === 'en'
                    ? 'You have not registered for any upcoming events yet.'
                    : '您目前暂未报名任何社区活动。'}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('events')}
                  className="mt-3 text-xs font-semibold text-[#8e2e11] hover:underline cursor-pointer"
                >
                  {lang === 'en' ? 'Explore CAACI Events' : '立即浏览活动日程'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                {user.registeredEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-4.5 rounded-2xl border border-neutral-200/90 bg-white shadow-xs flex flex-col justify-between space-y-3 hover:border-neutral-300 transition-colors"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        {evt.status === 'confirmed' ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <span>{lang === 'en' ? 'RSVP Confirmed' : '报名已确认'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
                            <span className="w-2 h-2 rounded-full bg-neutral-400 shrink-0" />
                            <span>{lang === 'en' ? 'Concluded' : '已结束'}</span>
                          </div>
                        )}
                        <span className="text-xs font-mono text-neutral-400">{evt.ticketCode}</span>
                      </div>

                      <h4 className="text-sm font-bold text-neutral-900 leading-snug line-clamp-2">
                        {lang === 'en' ? evt.titleEN : evt.titleZH}
                      </h4>

                      <div className="space-y-1 text-xs text-neutral-500 pt-1">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span>{evt.date}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span>{evt.time}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span className="truncate">{evt.location}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-neutral-100 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onNavigate('events')}
                        className="min-h-[36px] text-xs text-[#8e2e11] hover:underline font-semibold cursor-pointer inline-flex items-center"
                      >
                        {lang === 'en' ? 'View Details' : '查看详情'}
                      </button>

                      <div className="flex items-center gap-2">
                        {evt.status === 'concluded' && (
                          <button
                            type="button"
                            onClick={() => handleOpenFeedback(evt)}
                            className="min-h-[32px] px-3 py-1 rounded-full text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-all bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200/80 active:scale-95 shadow-2xs"
                            title={
                              lang === 'en'
                                ? 'Provide or view event feedback'
                                : '填写或查看活动评价反馈'
                            }
                          >
                            {feedbackRatings[evt.id] ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <MessageSquare className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                            )}
                            <span>
                              {feedbackRatings[evt.id]
                                ? lang === 'en'
                                  ? 'Feedback'
                                  : '已反馈'
                                : lang === 'en'
                                  ? 'Feedback'
                                  : '活动反馈'}
                            </span>
                          </button>
                        )}

                        {evt.status === 'confirmed' && (
                          <button
                            type="button"
                            onClick={() => setCancelEventId(evt.id)}
                            className="min-h-[36px] text-xs text-neutral-400 hover:text-rose-600 font-medium cursor-pointer inline-flex items-center"
                          >
                            {lang === 'en' ? 'Cancel RSVP' : '取消报名'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ======================================================================= */}
          {/* TWO-COLUMN LAYOUT: LEFT & RIGHT COLUMNS */}
          {/* ======================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
            {/* --------------------------------------------------------------------- */}
            {/* LEFT COLUMN: Profile Info, Security, Subscription, History */}
            {/* --------------------------------------------------------------------- */}
            <div className="lg:col-span-7 space-y-6">
              {/* 1. 个人信息 (姓名、邮箱、电话。只能看，不能改) */}
              <div
                id="edit-information"
                className={`${activeMobileTab === 'profile' || activeMobileTab === 'all' ? 'block' : 'hidden'} lg:block bg-white rounded-2xl sm:rounded-3xl border border-neutral-200/90 p-4.5 sm:p-7 shadow-xs space-y-5 transition-all duration-300 scroll-mt-24`}
              >
                <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
                  <div className="flex items-center gap-2">
                    <User className="w-5 h-5 text-[#8e2e11]" />
                    <h3 className="text-base sm:text-lg font-bold text-[#1d1d1f]">
                      {lang === 'en' ? 'Personal Information' : '个人信息'}
                    </h3>
                  </div>
                  <span className="text-[11px] font-semibold text-neutral-400 flex items-center gap-1">
                    <Lock className="w-3 h-3 text-neutral-400" />
                    <span>{lang === 'en' ? 'Read-only' : '只能查看，不能修改'}</span>
                  </span>
                </div>

                <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200/70 text-xs text-neutral-600 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                  <p>
                    {lang === 'en'
                      ? 'To maintain merchant discount validation and voter registry accuracy, member name and verified phone cannot be edited online. Please contact CAACI administration to request updates.'
                      : '为确保合作商户折扣验证与社团选举名录真实有效，持卡人姓名与认证电话为只读锁定状态。如需变更请联络华协秘书处：caaci.org@gmail.com。'}
                  </p>
                </div>

                <div className="space-y-3.5">
                  {/* Name (Read-only) */}
                  <div>
                    <label className="block text-xs font-semibold text-neutral-500 mb-1">
                      {lang === 'en' ? 'Full Legal Name' : '持卡人姓名'}
                    </label>
                    <div className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-neutral-100 border border-neutral-200 text-xs font-medium text-neutral-900 flex items-center justify-between select-none">
                      <span>{user.name}</span>
                      <Lock className="w-3.5 h-3.5 text-neutral-400" />
                    </div>
                  </div>

                  {/* Email (Read-only) */}
                  <div>
                    <label className="block text-xs font-semibold text-neutral-500 mb-1">
                      {lang === 'en' ? 'Primary Email' : '电子邮箱'}
                    </label>
                    <div className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-neutral-100 border border-neutral-200 text-xs font-medium text-neutral-900 flex items-center justify-between select-none">
                      <span className="font-mono">{user.email}</span>
                      <Lock className="w-3.5 h-3.5 text-neutral-400" />
                    </div>
                  </div>

                  {/* Phone (Read-only) */}
                  <div>
                    <label className="block text-xs font-semibold text-neutral-500 mb-1">
                      {lang === 'en' ? 'Contact Phone' : '联系电话'}
                    </label>
                    <div className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-neutral-100 border border-neutral-200 text-xs font-medium text-neutral-900 flex items-center justify-between select-none">
                      <span className="font-mono">{user.phone}</span>
                      <Lock className="w-3.5 h-3.5 text-neutral-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. 账户安全 (修改密码 / 设置密码、修改邮箱) */}
              <div
                className={`${activeMobileTab === 'profile' || activeMobileTab === 'all' ? 'block' : 'hidden'} lg:block bg-white rounded-2xl sm:rounded-3xl border border-neutral-200/90 p-4.5 sm:p-7 shadow-xs space-y-6`}
              >
                <div className="flex items-center gap-2 pb-3 border-b border-neutral-100">
                  <Shield className="w-5 h-5 text-[#8e2e11]" />
                  <h3 className="text-base sm:text-lg font-bold text-[#1d1d1f]">
                    {lang === 'en' ? 'Account Security' : '账户安全'}
                  </h3>
                </div>

                {/* Password Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-neutral-900">
                        {user.authProvider === 'google' || user.authProvider === 'microsoft'
                          ? lang === 'en'
                            ? 'Set Local Password'
                            : '设置密码'
                          : lang === 'en'
                            ? 'Change Password'
                            : '修改密码'}
                      </h4>
                      <p className="text-[11px] text-neutral-500 mt-0.5">
                        {user.authProvider === 'google' || user.authProvider === 'microsoft'
                          ? lang === 'en'
                            ? `Signed in via ${user.authProvider.toUpperCase()}. You can set an independent local password.`
                            : `您当前使用 ${user.authProvider.toUpperCase()} 快速登录。可在此设置独立的账号密码。`
                          : lang === 'en'
                            ? 'Requires an email verification code before updating.'
                            : '修改密码需输入发送至您认证邮箱的 6 位验证码。'}
                      </p>
                    </div>
                  </div>

                  {passwordSuccess && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{passwordSuccess}</span>
                    </div>
                  )}

                  {passwordError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>{passwordError}</span>
                    </div>
                  )}

                  <form onSubmit={handleUpdatePassword} className="space-y-3">
                    {/* Verification Code Row */}
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                        {lang === 'en' ? 'Email Verification Code' : '邮箱验证码'}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          maxLength={6}
                          placeholder={lang === 'en' ? '6-digit code' : '6位验证码'}
                          value={verifyCode}
                          onChange={(e) => setVerifyCode(e.target.value)}
                          className="flex-1 min-h-[44px] px-3.5 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#8e2e11] font-mono tracking-widest"
                        />
                        <button
                          type="button"
                          onClick={handleSendPasswordCode}
                          disabled={passwordCountdown > 0}
                          className="min-h-[44px] px-4 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap active:scale-98"
                        >
                          {passwordCountdown > 0
                            ? `${passwordCountdown}s`
                            : passwordVerificationSent
                              ? lang === 'en'
                                ? 'Resend Code'
                                : '重新获取'
                              : lang === 'en'
                                ? 'Send Code'
                                : '获取验证码'}
                        </button>
                      </div>
                      {passwordVerificationSent && (
                        <p className="text-[10px] text-emerald-600 mt-1">
                          {lang === 'en'
                            ? `Verification code dispatched to ${user.email}`
                            : `验证码已发送至 ${user.email}，请查收`}
                        </p>
                      )}
                    </div>

                    {/* New Password & Confirm Password */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                          {lang === 'en' ? 'New Password' : '新密码'}
                        </label>
                        <input
                          type="password"
                          placeholder="••••••••"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                          {lang === 'en' ? 'Confirm New Password' : '确认新密码'}
                        </label>
                        <input
                          type="password"
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-full bg-neutral-900 text-white hover:bg-neutral-800 text-xs font-semibold cursor-pointer active:scale-98"
                    >
                      {user.authProvider === 'google' || user.authProvider === 'microsoft'
                        ? lang === 'en'
                          ? 'Set Password'
                          : '保存设置密码'
                        : lang === 'en'
                          ? 'Update Password'
                          : '确认修改密码'}
                    </button>
                  </form>
                </div>

                {/* Email Change Section */}
                <div className="space-y-3 pt-5 border-t border-neutral-100">
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-neutral-900">
                      {lang === 'en' ? 'Change Primary Email' : '修改认证邮箱'}
                    </h4>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      {lang === 'en'
                        ? 'A confirmation link will be sent to the new email address. Can be resent.'
                        : '系统将向新邮箱发送确认邮件，点击确认后方可完成变更，支持重发。'}
                    </p>
                  </div>

                  {emailSuccess && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{emailSuccess}</span>
                    </div>
                  )}

                  <form
                    onSubmit={handleSendEmailChange}
                    className="flex flex-col sm:flex-row gap-2"
                  >
                    <input
                      type="email"
                      required
                      placeholder="new.email@example.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="flex-1 min-h-[44px] px-3.5 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
                    />
                    <button
                      type="submit"
                      disabled={emailCountdown > 0}
                      className="min-h-[44px] px-5 py-2.5 rounded-full bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-98"
                    >
                      {emailCountdown > 0
                        ? `${emailCountdown}s (${lang === 'en' ? 'Wait' : '可重发'})`
                        : emailVerificationSent
                          ? lang === 'en'
                            ? 'Resend Email'
                            : '重发确认邮件'
                          : lang === 'en'
                            ? 'Send Confirmation Email'
                            : '发送确认邮件'}
                    </button>
                  </form>
                </div>
              </div>

              {/* 3. 订阅 (方案、状态、价格含3.5%手续费、续费或到期日期、更改方案/升级、管理账单Stripe、扣款失败红提醒) */}
              <div
                className={`${activeMobileTab === 'billing' || activeMobileTab === 'all' ? 'block' : 'hidden'} lg:block bg-white rounded-2xl sm:rounded-3xl border border-neutral-200/90 p-4.5 sm:p-7 shadow-xs space-y-5`}
              >
                <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-[#8e2e11]" />
                    <h3 className="text-base sm:text-lg font-bold text-[#1d1d1f]">
                      {lang === 'en' ? 'Membership Subscription' : '会员订阅与会费方案'}
                    </h3>
                  </div>

                  <div className="flex items-center">
                    {user.membership.paymentFailed ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                        <span>{lang === 'en' ? 'Payment Failed' : '扣款失败'}</span>
                      </span>
                    ) : user.membership.status === 'active' ? (
                      <span
                        className="relative flex h-2.5 w-2.5"
                        title={lang === 'en' ? 'Active Subscription' : '订阅有效'}
                      >
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                    ) : (
                      <span
                        className="w-2.5 h-2.5 rounded-full bg-neutral-300"
                        title={lang === 'en' ? 'Not Active' : '未加入'}
                      />
                    )}
                  </div>
                </div>

                {/* 扣款失败时显示红色提醒 (Red alert when payment failed) */}
                {user.membership.paymentFailed && (
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-xs text-rose-900 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-rose-950">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      <span>
                        {lang === 'en' ? 'Payment Deduction Failed' : '会费自动扣款失败提醒'}
                      </span>
                    </div>
                    <p className="leading-relaxed">
                      {lang === 'en'
                        ? 'Your recurring subscription charge of $36.23 on card ending in 4242 failed. Please update your payment method immediately to keep your member privileges and family passes active.'
                        : '您的信用卡（尾号 4242）年度会费 $36.23（含 3.5% 手续费）扣款未成功。请立即更新支付方式，以防止您的会员电子卡及家庭共享名额被暂停。'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowStripeModal(true)}
                      className="min-h-[40px] px-4 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs cursor-pointer inline-flex items-center gap-1 shadow-xs active:scale-98"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>
                        {lang === 'en' ? 'Update Card on Stripe' : '立即前往 Stripe 更新卡片'}
                      </span>
                    </button>
                  </div>
                )}

                {/* Subscription Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-4 rounded-2xl bg-neutral-50/80 border border-neutral-200/80 text-xs">
                  <div>
                    <span className="text-neutral-400 block uppercase tracking-wider text-[10px]">
                      {lang === 'en' ? 'Plan Tier' : '当前方案'}
                    </span>
                    <span className="font-bold text-neutral-900 text-sm mt-0.5 block">
                      {lang === 'en' ? user.membership.tierNameEN : user.membership.tierNameZH}
                    </span>
                  </div>

                  <div>
                    <span className="text-neutral-400 block uppercase tracking-wider text-[10px]">
                      {lang === 'en'
                        ? 'Annual Dues (incl. 3.5% fee)'
                        : '年度会费（含 3.5% 手续费）'}
                    </span>
                    <span className="font-bold text-[#8e2e11] text-sm mt-0.5 block">
                      ${user.membership.totalPrice.toFixed(2)} / {lang === 'en' ? 'year' : '年'}
                      <span className="text-[10px] text-neutral-400 font-normal ml-1">
                        (Base ${user.membership.basePrice} + 3.5% fee)
                      </span>
                    </span>
                  </div>

                  <div>
                    <span className="text-neutral-400 block uppercase tracking-wider text-[10px]">
                      {lang === 'en' ? 'Renewal / Expiry Date' : '下次续费或到期日期'}
                    </span>
                    <span className="font-semibold text-neutral-800 text-xs mt-0.5 block">
                      {lang === 'en'
                        ? user.membership.renewalDateEN
                        : user.membership.renewalDateZH}
                    </span>
                  </div>

                  <div>
                    <span className="text-neutral-400 block uppercase tracking-wider text-[10px]">
                      {lang === 'en' ? 'Payment Method' : '支付方式'}
                    </span>
                    <span className="font-mono text-neutral-700 text-xs mt-0.5 block">
                      Visa •••• 4242 (Stripe Portal)
                    </span>
                  </div>
                </div>

                {/* Subscription Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  {user.membership.tier === 'none' ? (
                    <button
                      type="button"
                      onClick={() => onNavigate('membership')}
                      className="min-h-[44px] px-6 py-2.5 rounded-full bg-[#8e2e11] hover:brightness-110 text-white font-semibold text-xs cursor-pointer shadow-xs active:scale-98"
                    >
                      {lang === 'en' ? 'Join Membership' : '加入会员'}
                    </button>
                  ) : (
                    <>
                      {/* 更改方案 (免费/未加入会员显示为升级) */}
                      <button
                        type="button"
                        onClick={() => onNavigate('membership')}
                        className="min-h-[42px] px-5 py-2.5 rounded-full bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5 active:scale-98"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>
                          {user.membership.basePrice === 0
                            ? lang === 'en'
                              ? 'Upgrade Membership'
                              : '升级会员'
                            : lang === 'en'
                              ? 'Change Membership Plan'
                              : '更改方案'}
                        </span>
                      </button>

                      {/* 付过款的人还有管理账单，会打开 Stripe 页面 */}
                      {user.membership.hasPaid && (
                        <button
                          type="button"
                          onClick={() => setShowStripeModal(true)}
                          className="min-h-[42px] px-5 py-2.5 rounded-full bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5 active:scale-98"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-[#8e2e11]" />
                          <span>
                            {lang === 'en' ? 'Manage Billing (Stripe)' : '管理账单 (Stripe)'}
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 4. 付款记录 (最近 10 笔，严格只显示入会和续费) */}
              <div
                className={`${activeMobileTab === 'billing' || activeMobileTab === 'all' ? 'block' : 'hidden'} lg:block bg-white rounded-2xl sm:rounded-3xl border border-neutral-200/90 p-4.5 sm:p-7 shadow-xs space-y-4`}
              >
                <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-[#8e2e11]" />
                    <h3 className="text-base sm:text-lg font-bold text-[#1d1d1f]">
                      {lang === 'en' ? 'Payment History' : '付款记录'}
                    </h3>
                  </div>

                  <span className="text-[11px] text-neutral-500">
                    {lang === 'en' ? 'Membership & Renewal Only' : '仅显示入会与续费记录'}
                  </span>
                </div>

                <div className="divide-y divide-neutral-100 border border-neutral-200/80 rounded-2xl overflow-hidden">
                  {user.paymentHistory.slice(0, 10).map((record) => (
                    <div
                      key={record.id}
                      className="p-3.5 sm:p-4 flex items-center justify-between bg-white hover:bg-neutral-50 text-xs transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-neutral-900">
                            {lang === 'en' ? record.typeEN : record.typeZH}
                          </span>
                          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium border border-emerald-200">
                            {lang === 'en' ? 'Paid' : '已支付'}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-neutral-400 block">
                          {record.date} • {record.id}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="font-bold text-neutral-900 font-mono text-sm block">
                          ${record.amount.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-neutral-400 block">
                          {lang === 'en' ? 'incl. 3.5% fee' : '含 3.5% 手续费'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* --------------------------------------------------------------------- */}
            {/* RIGHT COLUMN: Digital Card (Desktop) & Family Section */}
            {/* --------------------------------------------------------------------- */}
            <div className="lg:col-span-5 space-y-6">
              {/* 1. 电子会员卡 (Desktop View - on mobile handled above) */}
              <div className="hidden lg:block space-y-3">
                {user.membership.status === 'active' && !user.membership.paymentFailed ? (
                  <div className="space-y-3">
                    {/* Member Card Component directly rendered without extra card box wrapper */}
                    <DigitalMemberCard
                      user={user}
                      lang={lang}
                      serverCertConfigured={serverCertConfigured}
                    />

                    <p className="text-xs text-neutral-500 font-poppins text-center leading-relaxed px-2">
                      {lang === 'en'
                        ? 'Present your dynamic QR code or save to Apple Wallet to claim exclusive partner discounts across Central Illinois.'
                        : '消费时向中伊利诺伊合作商户出示此卡或扫码验证，即可实时享有专属优待与折扣。'}
                    </p>
                  </div>
                ) : (
                  <div className="bg-white rounded-3xl border border-neutral-200/90 p-6 sm:p-7 shadow-xs text-center space-y-3">
                    <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto">
                      <Lock className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-bold text-neutral-900">
                      {lang === 'en' ? 'Digital Member Card Locked' : '电子会员卡未激活'}
                    </h4>
                    <p className="text-xs text-neutral-500 leading-relaxed max-w-xs mx-auto">
                      {lang === 'en'
                        ? 'Digital card with real-time merchant QR verification is only accessible when your membership status is active.'
                        : '电子会员卡及商户扫码验真二维码仅在会员资格有效时开放。'}
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate('membership')}
                      className="px-5 py-2 rounded-full bg-[#8e2e11] text-white text-xs font-semibold cursor-pointer"
                    >
                      {lang === 'en' ? 'Activate Membership' : '激活会员资格'}
                    </button>
                  </div>
                )}
              </div>

              {/* 2. 家庭系统 (按身份显示不同内容) */}
              <div
                id="family-section"
                className={`${activeMobileTab === 'family' || activeMobileTab === 'all' ? 'block' : 'hidden'} lg:block scroll-mt-24`}
              >
                <FamilySection
                  user={user}
                  lang={lang}
                  onUpdateUser={onUpdateUser}
                  onNavigate={onNavigate}
                />
              </div>
            </div>
          </div>

          {/* ======================================================================= */}
          {/* DEMO / TESTING TOOLBAR (测试与功能验收演示栏 - 响应式收纳) */}
          {/* ======================================================================= */}
          <div className="p-4 sm:p-5 rounded-2xl bg-neutral-900 text-white space-y-3 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#edbb5f]" />
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                  {lang === 'en' ? 'Account Dashboard Testing Controls' : '功能验证与状态演示工具'}
                </span>
              </div>
              <span className="text-[10px] text-neutral-400">
                {lang === 'en'
                  ? 'Switch states to inspect all requested logic'
                  : '一键切换不同身份与告警视角'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {/* Provider Toggle */}
              <button
                type="button"
                onClick={() =>
                  onUpdateUser((prev) => ({
                    ...prev,
                    authProvider:
                      prev.authProvider === 'email'
                        ? 'google'
                        : prev.authProvider === 'google'
                          ? 'microsoft'
                          : 'email',
                  }))
                }
                className="p-2 sm:p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-left cursor-pointer border border-neutral-700 active:scale-98"
              >
                <span className="block text-[10px] text-neutral-400">登录方式 / Provider:</span>
                <span className="font-bold text-[#edbb5f] uppercase truncate block">
                  {user.authProvider} ({user.authProvider === 'email' ? '修改密码' : '设置密码'})
                </span>
              </button>

              {/* Family Role Selector */}
              <button
                type="button"
                onClick={() =>
                  onUpdateUser((prev) => {
                    const roles: UserProfile['familyRole'][] = [
                      'creator',
                      'member',
                      'purchased_no_family',
                      'none',
                    ];
                    const next = roles[(roles.indexOf(prev.familyRole) + 1) % roles.length];
                    return { ...prev, familyRole: next };
                  })
                }
                className="p-2 sm:p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-left cursor-pointer border border-neutral-700 active:scale-98"
              >
                <span className="block text-[10px] text-neutral-400">家庭身份 / Role:</span>
                <span className="font-bold text-[#edbb5f] truncate block">
                  {user.familyRole === 'creator'
                    ? '创建人 (Creator)'
                    : user.familyRole === 'member'
                      ? '家庭成员 (Member)'
                      : user.familyRole === 'purchased_no_family'
                        ? '买家庭未建'
                        : '个人会员 (None)'}
                </span>
              </button>

              {/* Payment Failed Toggle */}
              <button
                type="button"
                onClick={() =>
                  onUpdateUser((prev) => ({
                    ...prev,
                    membership: {
                      ...prev.membership,
                      paymentFailed: !prev.membership.paymentFailed,
                    },
                  }))
                }
                className="p-2 sm:p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-left cursor-pointer border border-neutral-700 active:scale-98"
              >
                <span className="block text-[10px] text-neutral-400">扣款状态:</span>
                <span
                  className={`font-bold truncate block ${
                    user.membership.paymentFailed ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {user.membership.paymentFailed ? '扣款失败 (红提醒)' : '扣款正常'}
                </span>
              </button>

              {/* Apple Wallet Cert Toggle */}
              <button
                type="button"
                onClick={() => setServerCertConfigured(!serverCertConfigured)}
                className="p-2 sm:p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-left cursor-pointer border border-neutral-700 active:scale-98"
              >
                <span className="block text-[10px] text-neutral-400">Apple Wallet证书:</span>
                <span className="font-bold text-[#edbb5f] truncate block">
                  {serverCertConfigured ? '已配置 (显示按钮)' : '未配置 (隐藏)'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stripe Customer Billing Portal Simulation Modal */}
      {showStripeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-neutral-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-[#635BFF] tracking-tight font-sans">
                  stripe
                </span>
                <span className="text-xs text-neutral-500 font-medium">
                  Customer Billing Portal
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowStripeModal(false)}
                className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-neutral-600">
                {lang === 'en'
                  ? 'In production, this opens Stripe Customer Portal where members securely manage payment cards, invoices, and auto-renewals.'
                  : '在生产环境中，点击将跳转至官方 Stripe 客户结算中心，会员可在此安全更新支付信用卡、下载报销收据及管理续费。'}
              </p>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 space-y-1.5">
                <div className="flex justify-between font-semibold text-neutral-800">
                  <span>CAACI Family Plan Annual</span>
                  <span>$36.23 / yr</span>
                </div>
                <div className="flex justify-between text-neutral-500 text-[11px]">
                  <span>Next Invoice Date:</span>
                  <span>{user.membership.renewalDateEN}</span>
                </div>
                <div className="flex justify-between text-neutral-500 text-[11px]">
                  <span>Payment Card:</span>
                  <span>Visa ending in 4242</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  onUpdateUser((prev) => ({
                    ...prev,
                    membership: { ...prev.membership, paymentFailed: false },
                  }));
                  setShowStripeModal(false);
                  alert(
                    lang === 'en'
                      ? 'Payment card updated successfully via Stripe.'
                      : '信用卡已通过 Stripe 成功更新，扣款状态恢复正常。',
                  );
                }}
                className="flex-1 min-h-[44px] py-2.5 rounded-full bg-[#635BFF] text-white hover:bg-[#5851ea] text-xs font-semibold cursor-pointer text-center active:scale-98"
              >
                {lang === 'en' ? 'Simulate Updating Card' : '模拟更新卡片成功'}
              </button>
              <button
                type="button"
                onClick={() => setShowStripeModal(false)}
                className="min-h-[44px] px-5 py-2.5 rounded-full border border-neutral-200 text-xs font-medium cursor-pointer active:scale-98"
              >
                {lang === 'en' ? 'Close' : '关闭'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Feedback Modal */}
      {feedbackEvent && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl border border-neutral-200 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-[#8e2e11]/10 text-[#8e2e11] flex items-center justify-center shrink-0 mt-0.5">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded border border-neutral-200">
                      {feedbackEvent.ticketCode}
                    </span>
                    <span className="text-[10px] font-semibold text-neutral-400">
                      {lang === 'en' ? 'Concluded Event' : '往期已结束活动'}
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-neutral-900 mt-1 leading-snug">
                    {lang === 'en' ? feedbackEvent.titleEN : feedbackEvent.titleZH}
                  </h4>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 mt-1">
                    <span>{feedbackEvent.date}</span>
                    <span>•</span>
                    <span className="truncate">{feedbackEvent.location}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFeedbackEvent(null)}
                className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-full hover:bg-neutral-100 cursor-pointer shrink-0 transition-colors"
                title={lang === 'en' ? 'Close' : '关闭'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {feedbackSuccessToast ? (
              <div className="py-8 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h5 className="text-sm font-bold text-neutral-900">
                  {lang === 'en' ? 'Feedback Submitted Successfully!' : '反馈提交成功！'}
                </h5>
                <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                  {lang === 'en'
                    ? 'Thank you for helping us improve future CAACI community activities.'
                    : '感谢您的真诚分享与宝贵建议，CAACI 组委会将持续优化活动体验。'}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSaveFeedback} className="space-y-4 text-xs">
                {/* Star Rating */}
                <div>
                  <label className="block font-semibold text-neutral-800 mb-2">
                    {lang === 'en' ? 'Overall Experience Rating' : '活动整体满意度评星'}
                  </label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => {
                      const isFilled = (currentHoverRating || currentRating) >= star;
                      return (
                        <button
                          key={star}
                          type="button"
                          onMouseEnter={() => setCurrentHoverRating(star)}
                          onMouseLeave={() => setCurrentHoverRating(0)}
                          onClick={() => setCurrentRating(star)}
                          className="p-1 cursor-pointer transition-transform hover:scale-110 active:scale-95"
                          title={`${star} Star${star > 1 ? 's' : ''}`}
                        >
                          <Star
                            className={`w-7 h-7 ${
                              isFilled ? 'text-amber-400 fill-amber-400' : 'text-neutral-300'
                            }`}
                          />
                        </button>
                      );
                    })}
                    <span className="text-xs font-bold text-neutral-700 ml-2 font-mono">
                      {currentHoverRating || currentRating} / 5
                    </span>
                  </div>
                </div>

                {/* Quick Impression Tags */}
                <div>
                  <label className="block font-semibold text-neutral-800 mb-2">
                    {lang === 'en' ? 'Key Highlights & Impressions' : '活动亮点与直观印象'}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(lang === 'en'
                      ? [
                          'Helpful Recruiters',
                          'Well Organized',
                          'Great Networking',
                          'Inspiring Sessions',
                          'Convenient Location',
                          'Need More Time',
                        ]
                      : [
                          '招聘机构专业热情',
                          '组织井然有序',
                          '结识了许多朋友',
                          '宣讲内容充实',
                          '场地交通便利',
                          '希望延长交流时间',
                        ]
                    ).map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleFeedbackTag(tag)}
                          className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all border active:scale-95 ${
                            isSelected
                              ? 'bg-[#8e2e11] text-white border-[#8e2e11]'
                              : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Detailed comments */}
                <div>
                  <label className="block font-semibold text-neutral-800 mb-1.5">
                    {lang === 'en'
                      ? 'Detailed Feedback & Suggestions (Optional)'
                      : '心得体验与改进建议（选填）'}
                  </label>
                  <textarea
                    rows={3}
                    value={currentComment}
                    onChange={(e) => setCurrentComment(e.target.value)}
                    placeholder={
                      lang === 'en'
                        ? 'Share your thoughts, memorable moments, or suggestions for next year...'
                        : '请写下您对本次活动的感受、难忘瞬间或对下届活动形式的建议...'
                    }
                    className="w-full p-3 text-xs bg-neutral-50 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#8e2e11] text-neutral-900 resize-none"
                  />
                </div>

                {/* Footer Buttons */}
                <div className="flex gap-2.5 pt-2">
                  <button
                    type="submit"
                    className="flex-1 min-h-[44px] py-2.5 rounded-full bg-[#8e2e11] hover:brightness-110 text-white text-xs font-semibold cursor-pointer shadow-xs active:scale-98"
                  >
                    {lang === 'en' ? 'Submit Feedback' : '提交反馈评价'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedbackEvent(null)}
                    className="min-h-[44px] px-5 py-2.5 rounded-full border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-xs font-medium cursor-pointer active:scale-98"
                  >
                    {lang === 'en' ? 'Cancel' : '取消'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Cancel RSVP Confirmation Modal */}
      {cancelEventId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-neutral-200 space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h4 className="text-base font-bold text-neutral-900">
                {lang === 'en' ? 'Cancel Event Registration?' : '确认取消活动报名？'}
              </h4>
              <p className="text-xs text-neutral-500 mt-1">
                {lang === 'en'
                  ? 'Your admission pass code will be released and registration status revoked.'
                  : '取消后您的入场确认凭证将作废，名额将释放给其他社区成员。'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCancelEventId(null)}
                className="flex-1 min-h-[44px] py-2.5 rounded-full border border-neutral-200 text-xs font-medium cursor-pointer active:scale-98"
              >
                {lang === 'en' ? 'Keep RSVP' : '保留报名'}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmCancelEvent(cancelEventId)}
                className="flex-1 min-h-[44px] py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer active:scale-98"
              >
                {lang === 'en' ? 'Confirm Cancel' : '确认取消'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Account Modal (编辑账户资料) */}
      {showEditAccountModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl border border-neutral-200 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-full bg-[#8e2e11]/10 text-[#8e2e11] flex items-center justify-center">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-neutral-900">
                    {lang === 'en' ? 'Edit Account Profile' : '编辑个人账户信息'}
                  </h4>
                  <p className="text-xs text-neutral-500">
                    {lang === 'en'
                      ? 'Update your contact and directory preferences'
                      : '更新您的通讯方式与会员联系档案'}
                  </p>
                </div>
              </div>
            </div>

            {editSavedToast && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>
                  {lang === 'en' ? 'Profile updated successfully!' : '个人账户资料已成功更新保存！'}
                </span>
              </div>
            )}

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-neutral-600 font-medium mb-1">
                  {lang === 'en'
                    ? 'Full Name (Verified by Membership)'
                    : '会员真实姓名（官方认证）'}
                </label>
                <input
                  type="text"
                  disabled
                  value={user.name}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-500 cursor-not-allowed text-xs font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-700 font-medium mb-1">
                    {lang === 'en' ? 'Secondary / Cell Phone' : '备用联系电话'}
                  </label>
                  <input
                    type="text"
                    value={editSecondaryPhone}
                    onChange={(e) => setEditSecondaryPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#8e2e11]"
                  />
                </div>

                <div>
                  <label className="block text-neutral-700 font-medium mb-1">
                    {lang === 'en' ? 'WeChat ID (Optional)' : '微信号（选填）'}
                  </label>
                  <input
                    type="text"
                    value={editWeChat}
                    onChange={(e) => setEditWeChat(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#8e2e11]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-neutral-700 font-medium mb-1">
                  {lang === 'en'
                    ? 'Mailing Address (For newsletters & souvenirs)'
                    : '通讯/邮寄地址（用于协会会刊与新年纪念品）'}
                </label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#8e2e11]"
                />
              </div>

              <div>
                <label className="block text-neutral-700 font-medium mb-1">
                  {lang === 'en'
                    ? 'Community Interests & Volunteer Roles'
                    : '社区志愿意向 / 关注领域'}
                </label>
                <input
                  type="text"
                  value={editInterests}
                  onChange={(e) => setEditInterests(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#8e2e11]"
                />
              </div>
            </div>

            <div className="flex gap-2.5 pt-2 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => {
                  setShowEditAccountModal(false);
                  setEditSavedToast(false);
                }}
                className="flex-1 min-h-[44px] py-2.5 rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-50 text-xs font-medium cursor-pointer active:scale-98"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditSavedToast(true);
                  triggerToast(
                    lang === 'en' ? 'Profile updated successfully' : '账户资料已成功保存',
                  );
                  setTimeout(() => {
                    setShowEditAccountModal(false);
                    setEditSavedToast(false);
                  }, 700);
                }}
                className="flex-1 min-h-[44px] py-2.5 rounded-full bg-[#8e2e11] hover:bg-[#72240d] text-white text-xs font-semibold cursor-pointer shadow-xs active:scale-98"
              >
                {lang === 'en' ? 'Save Changes' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen / High Brightness QR Zoom Modal for Merchant Check-in */}
      {showQrZoomModal && (
        <div
          onClick={() => setShowQrZoomModal(false)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl border border-neutral-200 text-center space-y-4 relative"
          >
            <button
              type="button"
              onClick={() => setShowQrZoomModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 flex items-center justify-center cursor-pointer text-sm font-bold"
            >
              ✕
            </button>

            <div className="space-y-1 pt-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  {lang === 'en' ? 'Verified CAACI Member Pass' : 'CAACI 官方会员有效通行证'}
                </span>
              </div>
              <h3 className="text-lg font-bold font-serif-caaci text-neutral-900">{user.name}</h3>
              <p className="text-xs font-mono text-neutral-500">ID: {user.memberId}</p>
            </div>

            {/* High Contrast QR Code Presentation */}
            <div className="p-4 bg-white rounded-2xl border-2 border-neutral-900 inline-block shadow-inner mx-auto">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
                  `https://caaci.org/verify?id=${user.memberId}&name=${user.name}&t=${user.membership.tier}`,
                )}`}
                alt="Member Pass QR Code"
                className="w-48 h-48 sm:w-56 sm:h-56 mx-auto"
              />
            </div>

            {/* Quick Barcode Simulation for Register Scanners */}
            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 space-y-1">
              <div className="h-10 flex items-center justify-center gap-[3px] overflow-hidden px-4">
                {[
                  3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 2, 4, 1, 2, 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1,
                  3, 1, 4, 2, 1, 3, 2,
                ].map((w, idx) => (
                  <div
                    key={idx}
                    className="bg-neutral-900 h-full"
                    style={{ width: `${w * 1.6}px` }}
                  />
                ))}
              </div>
              <p className="text-[11px] font-mono tracking-widest text-neutral-600 font-bold">
                {user.memberId}
              </p>
            </div>

            <p className="text-[11px] text-neutral-500 leading-relaxed px-2">
              {lang === 'en'
                ? 'Tip: Turn up screen brightness when presenting to merchant scanner registers.'
                : '提示：向收银机出示时建议调高屏幕亮度，以便扫码枪快速感应。'}
            </p>

            <button
              type="button"
              onClick={() => {
                handleCopyText(user.memberId, lang === 'en' ? 'Member ID' : '会员卡号');
                setShowQrZoomModal(false);
              }}
              className="w-full min-h-[44px] py-2.5 rounded-full bg-[#8e2e11] hover:bg-[#72240d] text-white text-xs font-semibold cursor-pointer shadow-xs active:scale-98"
            >
              {lang === 'en' ? 'Copy Member ID & Close' : '复制会员卡号并关闭'}
            </button>
          </div>
        </div>
      )}

      {/* Interactive Floating Toast Feedback */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-neutral-900/95 text-white px-4 py-2.5 rounded-full text-xs font-medium shadow-2xl backdrop-blur-md flex items-center gap-2 border border-white/15"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <ContactSection content={content} />
    </div>
  );
}
