import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Edit3 } from 'lucide-react';
import type { Lang } from '../../lib/lang';
import { actionErrorText, tr, updateProfile, type ProfileUpdate } from '../../lib/account';
import type { MemberRow } from '../../types/account';
import { AccountModal } from './AccountModal';

// Behind FEATURES.profileEdit (lib/features.ts): the "Edit" button for the
// Personal Information card and the design's edit-profile dialog. Saving goes
// through updateProfile(), which has no backend yet and answers not_available.

interface ProfileEditProps {
  lang: Lang;
  member: MemberRow | null;
  onSaved: () => void | Promise<void>;
}

const SAVED_CLOSE_MS = 700;

const inputClass =
  'w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#8e2e11]';

// Prefilled only from columns members really has; the rest start empty.
const fromMember = (member: MemberRow | null): ProfileUpdate => ({
  phone: member?.phone ?? '',
  secondary_phone: '',
  wechat: '',
  mailing_address: '',
  interests: '',
});

export function ProfileEdit({ lang, member, onSaved }: ProfileEditProps) {
  const t = tr(lang);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProfileUpdate>(() => fromMember(member));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const show = () => {
    setForm(fromMember(member));
    setError(null);
    setSaved(false);
    setOpen(true);
  };
  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
    setSaved(false);
  };
  const field = (key: keyof ProfileUpdate) => ({
    id: `${id}-${key}`,
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || saved) return;
    setBusy(true);
    setError(null);
    const res = await updateProfile(form);
    setBusy(false);
    if (!res.ok) {
      setError(actionErrorText(res.error, lang));
      return;
    }
    setSaved(true);
    void onSaved();
    setTimeout(() => {
      setOpen(false);
      setSaved(false);
    }, SAVED_CLOSE_MS);
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="min-h-[36px] px-3 py-1 rounded-full text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-all bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200/80 active:scale-95 shadow-2xs"
      >
        <Edit3 className="w-3.5 h-3.5 text-[#8e2e11]" />
        <span>{t('Edit', '编辑')}</span>
      </button>

      {open && (
        <AccountModal
          onClose={close}
          labelledBy={`${id}-title`}
          className="bg-white rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl border border-neutral-200 space-y-5 max-h-[90vh] overflow-y-auto"
        >
          <form onSubmit={save} className="space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-full bg-[#8e2e11]/10 text-[#8e2e11] flex items-center justify-center">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h4 id={`${id}-title`} className="text-base font-bold text-neutral-900">
                    {t('Edit Account Profile', '编辑个人账户信息')}
                  </h4>
                  <p className="text-xs text-neutral-500">
                    {t(
                      'Update your contact and directory preferences',
                      '更新您的通讯方式与会员联系档案',
                    )}
                  </p>
                </div>
              </div>
            </div>

            {saved && (
              <div
                role="status"
                className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>{t('Profile updated successfully!', '个人账户资料已成功更新保存！')}</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${id}-name`} className="block text-neutral-600 font-medium mb-1">
                    {t('Full Name (Verified by Membership)', '会员真实姓名（官方认证）')}
                  </label>
                  <input
                    id={`${id}-name`}
                    type="text"
                    disabled
                    value={member?.full_name || ''}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-500 cursor-not-allowed text-xs font-medium"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${id}-phone`}
                    className="block text-neutral-700 font-medium mb-1"
                  >
                    {t('Contact Phone', '联系电话')}
                  </label>
                  <input type="tel" autoComplete="tel" className={inputClass} {...field('phone')} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor={`${id}-secondary_phone`}
                    className="block text-neutral-700 font-medium mb-1"
                  >
                    {t('Secondary / Cell Phone', '备用联系电话')}
                  </label>
                  <input type="tel" className={inputClass} {...field('secondary_phone')} />
                </div>

                <div>
                  <label
                    htmlFor={`${id}-wechat`}
                    className="block text-neutral-700 font-medium mb-1"
                  >
                    {t('WeChat ID (Optional)', '微信号（选填）')}
                  </label>
                  <input type="text" className={inputClass} {...field('wechat')} />
                </div>
              </div>

              <div>
                <label
                  htmlFor={`${id}-mailing_address`}
                  className="block text-neutral-700 font-medium mb-1"
                >
                  {t(
                    'Mailing Address (For newsletters & souvenirs)',
                    '通讯/邮寄地址（用于协会会刊与新年纪念品）',
                  )}
                </label>
                <input
                  type="text"
                  autoComplete="street-address"
                  className={inputClass}
                  {...field('mailing_address')}
                />
              </div>

              <div>
                <label
                  htmlFor={`${id}-interests`}
                  className="block text-neutral-700 font-medium mb-1"
                >
                  {t('Community Interests & Volunteer Roles', '社区志愿意向 / 关注领域')}
                </label>
                <input type="text" className={inputClass} {...field('interests')} />
              </div>
            </div>

            <div className="flex gap-2.5 pt-2 border-t border-neutral-100">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="flex-1 min-h-[44px] py-2.5 rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-50 text-xs font-medium cursor-pointer active:scale-98 disabled:opacity-60"
              >
                {t('Cancel', '取消')}
              </button>
              <button
                type="submit"
                disabled={busy || saved}
                className="flex-1 min-h-[44px] py-2.5 rounded-full bg-[#8e2e11] hover:bg-[#72240d] text-white text-xs font-semibold cursor-pointer shadow-xs active:scale-98 disabled:opacity-60"
              >
                {busy ? t('Saving…', '正在保存…') : t('Save Changes', '保存修改')}
              </button>
            </div>
          </form>
        </AccountModal>
      )}
    </>
  );
}
