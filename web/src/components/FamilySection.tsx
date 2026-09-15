import { useState, type FormEvent } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  LogOut,
  Mail,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  History,
  Shield,
} from 'lucide-react';
import type { UserProfile } from '../types/account';

interface FamilySectionProps {
  user: UserProfile;
  lang: 'en' | 'zh';
  onUpdateUser: (updater: (prev: UserProfile) => UserProfile) => void;
  onNavigate: (page: string) => void;
}

export function FamilySection({ user, lang, onUpdateUser, onNavigate }: FamilySectionProps) {
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [showDissolveModal, setShowDissolveModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const family = user.familyData;
  const currentCount = family.members.length + family.pendingInvites.length;
  const maxQuota = family.maxMembers || 3;
  const isQuotaFull = currentCount >= maxQuota;

  // Send new family invite
  const handleSendInvite = (e: FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || isQuotaFull) return;

    const newInvite = {
      id: `inv_${Date.now()}`,
      name: inviteName.trim() || inviteEmail.split('@')[0],
      email: inviteEmail.trim(),
      sentDate: new Date().toISOString().split('T')[0],
    };

    onUpdateUser((prev) => ({
      ...prev,
      familyData: {
        ...prev.familyData,
        pendingInvites: [...prev.familyData.pendingInvites, newInvite],
        activityLog: [
          {
            id: `act_${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            textEN: `Sent family invitation to ${newInvite.email}`,
            textZH: `向 ${newInvite.email} 发送了家庭成员邀请`,
          },
          ...prev.familyData.activityLog,
        ],
      },
    }));

    setInviteName('');
    setInviteEmail('');
    setFeedbackMsg(
      lang === 'en'
        ? `Invitation link sent to ${newInvite.email}!`
        : `已成功向 ${newInvite.email} 发送专属家庭邀请链接！`,
    );
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  // Revoke a pending invite
  const handleRevokeInvite = (inviteId: string) => {
    onUpdateUser((prev) => ({
      ...prev,
      familyData: {
        ...prev.familyData,
        pendingInvites: prev.familyData.pendingInvites.filter((inv) => inv.id !== inviteId),
      },
    }));
  };

  // Remove a joined member (as creator)
  const handleRemoveMember = (memberId: string, memberName: string) => {
    if (
      !confirm(
        lang === 'en'
          ? `Remove ${memberName} from family plan?`
          : `确定要将 ${memberName} 移出家庭计划吗？`,
      )
    ) {
      return;
    }

    onUpdateUser((prev) => ({
      ...prev,
      familyData: {
        ...prev.familyData,
        members: prev.familyData.members.filter((m) => m.id !== memberId),
        activityLog: [
          {
            id: `act_${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            textEN: `Removed ${memberName} from family plan`,
            textZH: `将成员 ${memberName} 移出家庭计划`,
          },
          ...prev.familyData.activityLog,
        ],
      },
    }));
  };

  // Dissolve entire family (as creator)
  const handleDissolveFamily = () => {
    onUpdateUser((prev) => ({
      ...prev,
      familyRole: 'purchased_no_family',
      familyData: {
        ...prev.familyData,
        members: prev.familyData.members.filter((m) => m.isSelf),
        pendingInvites: [],
        activityLog: [
          {
            id: `act_${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            textEN: 'Dissolved family group. Slots reset.',
            textZH: '解散了家庭计划，家属名额已重置。',
          },
          ...prev.familyData.activityLog,
        ],
      },
    }));
    setShowDissolveModal(false);
  };

  // Leave family (as member)
  const handleLeaveFamily = () => {
    onUpdateUser((prev) => ({
      ...prev,
      familyRole: 'none',
      familyData: {
        ...prev.familyData,
        creatorName: '',
        creatorEmail: '',
        members: [],
      },
    }));
    setShowLeaveModal(false);
  };

  // Accept pending invite received
  const handleAcceptReceivedInvite = () => {
    onUpdateUser((prev) => ({
      ...prev,
      familyRole: 'member',
      familyData: {
        ...prev.familyData,
        creatorName: prev.familyData.receivedInvite?.fromName || '张建华 (Jianhua Zhang)',
        creatorEmail: prev.familyData.receivedInvite?.fromEmail || 'jianhua.zhang@example.com',
        receivedInvite: null,
      },
    }));
  };

  // Decline pending invite received
  const handleDeclineReceivedInvite = () => {
    onUpdateUser((prev) => ({
      ...prev,
      familyData: {
        ...prev.familyData,
        receivedInvite: null,
      },
    }));
  };

  return (
    <div
      id="family-section"
      className="bg-white rounded-2xl border border-neutral-200/90 p-6 sm:p-7 shadow-xs space-y-6"
    >
      <div className="flex items-center justify-between pb-4 border-b border-neutral-200">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-[#1d1d1f]">
            {lang === 'en' ? 'Family Plan & Shared Benefits' : '家庭方案与权益共享'}
          </h3>
        </div>

        {user.familyRole === 'creator' && (
          <span className="text-xs font-semibold text-neutral-600">
            {currentCount} / {maxQuota} {lang === 'en' ? 'Members' : '人'}
          </span>
        )}
      </div>

      {feedbackMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* 1. Universal: If there is an invitation sent to this user (所有人：收到发给自己的邀请) */}
      {family.receivedInvite && (
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border border-amber-200/90 space-y-3">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-amber-950">
                {lang === 'en' ? 'Pending Family Invitation Received' : '收到待接受的家庭会员邀请'}
              </h4>
              <p className="text-xs text-amber-800 mt-0.5">
                {lang === 'en'
                  ? `${family.receivedInvite.fromName} (${family.receivedInvite.fromEmail}) invites you to join their CAACI Family Plan.`
                  : `${family.receivedInvite.fromName}（${family.receivedInvite.fromEmail}）邀请您加入其 CAACI 家庭会员计划，共享全部会员特权。`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleAcceptReceivedInvite}
              className="px-4 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{lang === 'en' ? 'Accept Invitation' : '接受邀请'}</span>
            </button>
            <button
              type="button"
              onClick={handleDeclineReceivedInvite}
              className="px-3.5 py-1.5 rounded-full bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5 text-neutral-400" />
              <span>{lang === 'en' ? 'Decline' : '拒绝'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. CREATOR VIEW (创建人: 最多3人、成员列表、待接受邀请、邀请添加表单、解散家庭、家庭动态) */}
      {user.familyRole === 'creator' && (
        <div className="space-y-6">
          {/* Members List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                {lang === 'en' ? 'Active Family Members' : '家庭成员列表'}
              </span>
              <span className="text-[11px] text-neutral-500">max 3</span>
            </div>

            <div className="divide-y divide-neutral-100">
              {family.members.map((member) => (
                <div key={member.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-semibold text-neutral-900">
                        {member.name}
                      </span>
                      {member.isSelf ? (
                        <span className="text-xs text-neutral-500">
                          {lang === 'en' ? 'Creator (You)' : '创建人 (您)'}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-500">{member.relation}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-500 font-mono">
                      {member.email} • {lang === 'en' ? 'Joined' : '加入于'}: {member.joinedDate}
                    </div>
                  </div>

                  {!member.isSelf && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(member.id, member.name)}
                      className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title={lang === 'en' ? 'Remove member' : '移除此成员'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Pending Invites (待接受的邀请) */}
          {family.pendingInvites.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 block">
                {lang === 'en' ? 'Pending Invitations' : '待接受的邀请'}
              </span>
              <div className="divide-y divide-neutral-100">
                {family.pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                      <div>
                        <span className="font-semibold text-neutral-800">{invite.name}</span>
                        <span className="text-neutral-500 font-mono ml-2">({invite.email})</span>
                        <span className="text-[11px] text-neutral-400 block sm:inline sm:ml-2">
                          {lang === 'en' ? 'Sent:' : '发送于:'} {invite.sentDate}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(invite.id)}
                      className="text-xs text-neutral-500 hover:text-rose-600 cursor-pointer font-medium hover:underline"
                    >
                      {lang === 'en' ? 'Revoke Invite' : '撤回邀请'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invite & Add Form (邀请和添加表单) */}
          {!isQuotaFull && (
            <form
              onSubmit={handleSendInvite}
              className="p-4 bg-neutral-50/80 rounded-2xl border border-neutral-200/80 space-y-3"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-800 uppercase tracking-wider">
                <UserPlus className="w-4 h-4 text-[#8e2e11]" />
                <span>{lang === 'en' ? 'Invite Family Member' : '邀请并添加家庭成员'}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                    {lang === 'en' ? 'Member Name / Relation' : '家属姓名 / 关系'}
                  </label>
                  <input
                    type="text"
                    required
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder={lang === 'en' ? 'e.g. Alex Chen (Child)' : '如：陈小明 (子女)'}
                    className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                    {lang === 'en' ? 'Member Email Address' : '家属电子邮箱'}
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="family.member@example.com"
                    className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-neutral-500">
                  {lang === 'en'
                    ? 'Member receives a custom link to bind their account instantly.'
                    : '家属将收到专属邀请链接，点击即可直接绑定。'}
                </p>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#8e2e11] hover:brightness-110 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Send Invitation' : '发送专属邀请'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Family Activity Log (家庭动态) */}
          <div className="space-y-2 pt-2 border-t border-neutral-200">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-neutral-700">
              <History className="w-3.5 h-3.5 text-neutral-400" />
              <span>{lang === 'en' ? 'Family Activity Log' : '家庭动态记录'}</span>
            </div>

            <div className="space-y-1.5">
              {family.activityLog.slice(0, 4).map((log) => (
                <div
                  key={log.id}
                  className="text-xs text-neutral-600 flex items-start gap-2 bg-neutral-50 px-3 py-2 rounded-lg"
                >
                  <span className="font-mono text-[11px] text-neutral-400 shrink-0 mt-0.5">
                    {log.date}
                  </span>
                  <span>{lang === 'en' ? log.textEN : log.textZH}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dissolve Family Button (解散家庭) */}
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setShowDissolveModal(true)}
              className="text-xs text-rose-600 hover:text-rose-700 hover:underline cursor-pointer font-medium inline-flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{lang === 'en' ? 'Dissolve Family Group' : '解散家庭组'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. MEMBER VIEW (成员: 显示创建人是谁，可以退出家庭) */}
      {user.familyRole === 'member' && (
        <div className="space-y-4">
          <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3">
            <div className="text-xs text-neutral-500 font-medium">
              {lang === 'en' ? 'Current Family Group Status' : '当前归属家庭计划'}
            </div>

            <div className="space-y-1">
              <div className="text-xs text-neutral-500">
                {lang === 'en' ? 'Household Creator:' : '家庭创建人:'}
              </div>
              <div className="text-sm font-bold text-neutral-900">
                {family.creatorName || '陈海伦 博士 (Dr. Helen Chen)'}
              </div>
              <div className="text-xs text-neutral-500 font-mono">
                {family.creatorEmail || 'helen.chen@example.com'}
              </div>
            </div>

            <p className="text-xs text-emerald-800 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
              {lang === 'en'
                ? '✓ You enjoy full CAACI member benefits under this shared family plan.'
                : '✓ 您在此家庭计划下享有与主会员同等的社区活动门票优惠与商户专享折扣。'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowLeaveModal(true)}
            className="px-4 py-2 rounded-full border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Leave Family Group' : '退出家庭'}</span>
          </button>
        </div>
      )}

      {/* 4. PURCHASED BUT NO FAMILY YET (还没建家庭、但买了家庭方案的人: 邀请家人的入口) */}
      {user.familyRole === 'purchased_no_family' && (
        <div className="p-6 bg-gradient-to-br from-neutral-50 to-amber-50/40 rounded-2xl border border-neutral-200 space-y-4 text-center">
          <div className="w-12 h-12 rounded-full bg-[#8e2e11]/10 text-[#8e2e11] flex items-center justify-center mx-auto">
            <Sparkles className="w-6 h-6" />
          </div>

          <div className="space-y-1">
            <h4 className="text-base font-bold text-neutral-900">
              {lang === 'en' ? 'Set Up Your Family Group' : '建立您的家庭计划并邀请家属'}
            </h4>
            <p className="text-xs text-neutral-600 max-w-md mx-auto">
              {lang === 'en'
                ? 'You have subscribed to the Family Tier! Set up your household group now to add up to 2 other family members.'
                : '您已成功订阅家庭会员方案！立即创建家庭计划，并邀请最多 2 位直系家属共享全部会员特权。'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              onUpdateUser((prev) => ({
                ...prev,
                familyRole: 'creator',
                familyData: {
                  ...prev.familyData,
                  members: [
                    {
                      id: `mem_self`,
                      name: prev.name,
                      email: prev.email,
                      relation: '创建人 / 户主 (Owner)',
                      joinedDate: new Date().toISOString().split('T')[0],
                      isSelf: true,
                    },
                  ],
                },
              }));
            }}
            className="px-6 py-2.5 rounded-full bg-[#8e2e11] text-white hover:brightness-110 text-xs font-semibold tracking-wide cursor-pointer inline-flex items-center gap-2 shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            <span>
              {lang === 'en' ? 'Create Family & Invite Members' : '立即创建家庭并邀请家属'}
            </span>
          </button>
        </div>
      )}

      {/* 5. NONE / STANDARD INDIVIDUAL MEMBER (NON-FAMILY) */}
      {user.familyRole === 'none' && (
        <div className="p-5 bg-neutral-50 rounded-2xl border border-neutral-200 text-center space-y-3">
          <p className="text-xs text-neutral-600">
            {lang === 'en'
              ? 'Family benefits are exclusive to the CAACI Family Plan ($35/yr + 3.5% processing fee). Upgrade now to share benefits with 2 household members.'
              : '家庭成员共享权益为 CAACI 尊享家庭方案专属（$35/年 + 3.5% 手续费）。升级方案即可邀请 2 位直系家属一同享受会员特权。'}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('membership')}
            className="px-4 py-2 rounded-full bg-white border border-neutral-300 text-neutral-800 hover:border-[#8e2e11] text-xs font-semibold cursor-pointer"
          >
            {lang === 'en' ? 'Explore Family Plan' : '了解家庭方案详情'}
          </button>
        </div>
      )}

      {/* Dissolve Family Modal Confirmation */}
      {showDissolveModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-neutral-200 space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h4 className="text-base font-bold text-neutral-900">
                {lang === 'en' ? 'Dissolve Family Plan?' : '确认解散家庭组？'}
              </h4>
              <p className="text-xs text-neutral-500 mt-1">
                {lang === 'en'
                  ? 'All linked family members will lose their shared membership passes immediately.'
                  : '解散后，所有已绑定的家庭成员将立即失去共享会员资格及活动优惠待遇。'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowDissolveModal(false)}
                className="flex-1 py-2 rounded-full border border-neutral-200 text-xs font-medium cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button
                type="button"
                onClick={handleDissolveFamily}
                className="flex-1 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                {lang === 'en' ? 'Confirm Dissolve' : '确认解散'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Family Modal Confirmation */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-neutral-200 space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h4 className="text-base font-bold text-neutral-900">
                {lang === 'en' ? 'Leave Family Group?' : '确认退出家庭组？'}
              </h4>
              <p className="text-xs text-neutral-500 mt-1">
                {lang === 'en'
                  ? 'You will lose access to shared family discounts until you join or subscribe individually.'
                  : '退出后，您将不再享有该家庭计划的会员优惠，需重新受邀或自行加入会员。'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowLeaveModal(false)}
                className="flex-1 py-2 rounded-full border border-neutral-200 text-xs font-medium cursor-pointer"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button
                type="button"
                onClick={handleLeaveFamily}
                className="flex-1 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                {lang === 'en' ? 'Confirm Leave' : '确认退出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
