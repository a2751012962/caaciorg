import { useState } from 'react';
import { X, Check, Heart, Calendar, UserCheck, HandHeart } from 'lucide-react';
import type { CAACIContent } from '../data/content';

export type ModalType = 'donate' | 'events' | 'membership' | 'volunteer' | null;

interface ModalsProps {
  modalType: ModalType;
  onClose: () => void;
  lang: 'en' | 'zh';
  content: CAACIContent;
}

export function Modals({ modalType, onClose, lang, content }: ModalsProps) {
  if (!modalType) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-neutral-200 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-neutral-50">
          <div className="flex items-center gap-2">
            {modalType === 'donate' && <Heart className="w-5 h-5 text-[#8e2e11]" />}
            {modalType === 'events' && <Calendar className="w-5 h-5 text-[#8e2e11]" />}
            {modalType === 'membership' && <UserCheck className="w-5 h-5 text-[#8e2e11]" />}
            {modalType === 'volunteer' && <HandHeart className="w-5 h-5 text-[#8e2e11]" />}
            <h3 className="font-serif-caaci font-bold text-lg text-[#300200]">
              {modalType === 'donate' && content.modals.donateTitle}
              {modalType === 'events' && content.modals.eventsTitle}
              {modalType === 'membership' && content.modals.membershipTitle}
              {modalType === 'volunteer' &&
                (lang === 'en' ? 'Volunteer with CAACI' : '加入 CAACI 志愿者')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {modalType === 'donate' && (
            <DonateModalContent lang={lang} content={content} onClose={onClose} />
          )}
          {modalType === 'events' && <EventsModalContent lang={lang} />}
          {modalType === 'membership' && <MembershipModalContent lang={lang} onClose={onClose} />}
          {modalType === 'volunteer' && <VolunteerModalContent lang={lang} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

function DonateModalContent({
  lang,
  content,
  onClose,
}: {
  lang: 'en' | 'zh';
  content: CAACIContent;
  onClose: () => void;
}) {
  const [selectedAmount, setSelectedAmount] = useState<number | 'custom'>(50);
  const [customAmount, setCustomAmount] = useState('');
  const [donated, setDonated] = useState(false);

  if (donated) {
    return (
      <div className="text-center py-6 space-y-4">
        <div className="w-12 h-12 bg-green-100 text-green-700 rounded-full flex items-center justify-center mx-auto">
          <Check className="w-6 h-6" />
        </div>
        <h4 className="text-xl font-bold text-neutral-900 font-serif-caaci">
          {lang === 'en' ? 'Thank You for Your Generosity!' : '诚挚感谢您的慷慨捐赠！'}
        </h4>
        <p className="text-sm text-neutral-600 font-poppins">
          {lang === 'en'
            ? 'Your gift supports cultural preservation and mutual support throughout Central Illinois. A tax receipt has been generated.'
            : '您的捐助将全力支持伊利诺伊中部的中华文化传承与同胞互助项目。捐赠收据已备妥。'}
        </p>
        <button
          onClick={onClose}
          className="mt-4 px-6 py-2.5 bg-[#8e2e11] text-white rounded font-semibold text-sm hover:brightness-110"
        >
          {content.modals.close}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 font-poppins">
      <p className="text-sm text-neutral-600 leading-relaxed">{content.modals.donateDesc}</p>

      <div>
        <label className="block text-xs uppercase font-bold text-neutral-500 mb-2">
          {lang === 'en' ? 'Select Donation Amount' : '选择捐款金额'}
        </label>
        <div className="grid grid-cols-4 gap-3">
          {[25, 50, 100].map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setSelectedAmount(amt)}
              className={`py-3 rounded font-bold text-sm border transition-all ${
                selectedAmount === amt
                  ? 'border-[#8e2e11] bg-[#8e2e11] text-white shadow-sm'
                  : 'border-neutral-200 hover:border-neutral-400 text-neutral-800'
              }`}
            >
              ${amt}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedAmount('custom')}
            className={`py-3 rounded font-bold text-sm border transition-all ${
              selectedAmount === 'custom'
                ? 'border-[#8e2e11] bg-[#8e2e11] text-white shadow-sm'
                : 'border-neutral-200 hover:border-neutral-400 text-neutral-800'
            }`}
          >
            {lang === 'en' ? 'Other' : '其它'}
          </button>
        </div>
      </div>

      {selectedAmount === 'custom' && (
        <div>
          <label className="block text-xs font-semibold text-neutral-600 mb-1">
            {lang === 'en' ? 'Enter Amount ($USD)' : '输入金额 ($美元)'}
          </label>
          <input
            type="number"
            min="1"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="e.g. 150"
            className="w-full px-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#8e2e11]"
          />
        </div>
      )}

      <button
        onClick={() => setDonated(true)}
        className="w-full py-3.5 rounded-full font-bold uppercase tracking-wider text-xs sm:text-sm text-white shadow-xs transition-all hover:bg-[#a63715] active:scale-98 cursor-pointer bg-[#8e2e11]"
      >
        {lang === 'en' ? 'Proceed with Donation' : '确认捐赠'}
      </button>
    </div>
  );
}

function EventsModalContent({ lang }: { lang: 'en' | 'zh' }) {
  const events = [
    {
      title: lang === 'en' ? 'Mid-Autumn Cultural Festival & Gala' : '中秋文化节与联欢晚会',
      date: 'September 20, 2026',
      time: '5:30 PM - 8:30 PM',
      location: 'Champaign Public Library & Community Pavilion',
      desc:
        lang === 'en'
          ? 'Mooncake tasting, traditional Chinese folk dance, children storytelling, and lantern crafting.'
          : '品尝各式传统月饼、中华民族民间舞蹈表演、儿童传统故事会与中秋花灯制作。',
    },
    {
      title:
        lang === 'en' ? 'Career Mentorship & Chamber Networking' : '青年职业导师交流与商会洽谈会',
      date: 'October 15, 2026',
      time: '6:00 PM - 8:00 PM',
      location: 'UIUC Research Park / Savoy Hub',
      desc:
        lang === 'en'
          ? 'Panel discussion with engineering, biotech, and business leaders in Central Illinois.'
          : '特邀伊利诺伊中部工程科技、生物医疗与商业领域的杰出行业领袖现场交流。',
    },
    {
      title: lang === 'en' ? 'Annual Chinese New Year Celebration Gala' : 'CAACI 2027 新春联欢晚会',
      date: 'January 28, 2027',
      time: '6:00 PM - 9:30 PM',
      location: 'Krannert Center for the Performing Arts, Urbana',
      desc:
        lang === 'en'
          ? 'Our signature grand community banquet, cultural music performances, and youth awards.'
          : '协会年度标志性盛大春晚，包含中华传统民乐演艺、舞狮、青年学术奖学金颁奖礼。',
    },
  ];

  return (
    <div className="space-y-4 font-poppins max-h-[420px] overflow-y-auto pr-1">
      {events.map((ev, i) => (
        <div
          key={i}
          className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50 transition-colors"
        >
          <div className="flex justify-between items-start mb-1">
            <h4 className="font-bold text-neutral-900 text-base">{ev.title}</h4>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#d3a971]/20 text-[#8e2e11] whitespace-nowrap ml-2">
              {ev.date}
            </span>
          </div>
          <div className="text-xs text-neutral-500 mb-2">
            <span>{ev.time}</span> • <span>{ev.location}</span>
          </div>
          <p className="text-xs text-neutral-600 leading-relaxed">{ev.desc}</p>
        </div>
      ))}
    </div>
  );
}

function MembershipModalContent({ lang, onClose }: { lang: 'en' | 'zh'; onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="text-center py-6 space-y-3 font-poppins">
        <Check className="w-12 h-12 text-green-600 mx-auto" />
        <h4 className="text-lg font-bold text-neutral-900">
          {lang === 'en' ? 'Welcome to CAACI!' : '欢迎加入 CAACI 大家庭！'}
        </h4>
        <p className="text-xs text-neutral-600">
          {lang === 'en'
            ? 'We have received your membership inquiry. Our board secretary will contact you shortly.'
            : '我们已收到您的会员申请，协会理事会将尽快与您取得联系并发送会员欢迎包。'}
        </p>
        <button
          onClick={onClose}
          className="mt-3 px-5 py-2 bg-[#8e2e11] text-white rounded text-xs font-bold"
        >
          Done
        </button>
      </div>
    );
  }

  const tiers = [
    {
      name: lang === 'en' ? 'Student Member' : '学生会员',
      fee: '$10 / year',
      desc:
        lang === 'en'
          ? 'Valid for full-time college or graduate students.'
          : '面向全日制在读本科生与研究生。',
    },
    {
      name: lang === 'en' ? 'Individual Member' : '个人会员',
      fee: '$20 / year',
      desc:
        lang === 'en'
          ? 'Free/discounted event access & partner discounts.'
          : '享活动优惠门票与合作商户专享折扣。',
    },
    {
      name: lang === 'en' ? 'Family Membership' : '家庭会员',
      fee: '$35 / year',
      desc:
        lang === 'en'
          ? 'Covers entire household with all membership perks.'
          : '全家共享所有会员福利与文化活动名额。',
    },
  ];

  return (
    <div className="space-y-4 font-poppins">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiers.map((t, idx) => (
          <div
            key={idx}
            className="p-3 border border-neutral-200 rounded-lg bg-neutral-50 text-center"
          >
            <div className="font-bold text-xs text-neutral-800">{t.name}</div>
            <div className="font-bold text-sm text-[#8e2e11] my-1">{t.fee}</div>
            <div className="text-[11px] text-neutral-500 leading-tight">{t.desc}</div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
        className="space-y-3 pt-2"
      >
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            required
            placeholder={lang === 'en' ? 'Full Name' : '姓名'}
            className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
          />
          <input
            type="email"
            required
            placeholder={lang === 'en' ? 'Email Address' : '电子邮箱'}
            className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
          />
        </div>
        <button
          type="submit"
          className="w-full py-3 rounded-full font-bold uppercase tracking-wider text-xs text-white shadow-xs transition-all hover:bg-[#a63715] active:scale-98 cursor-pointer bg-[#8e2e11]"
        >
          {lang === 'en' ? 'Submit Membership Application' : '提交入会申请'}
        </button>
      </form>
    </div>
  );
}

function VolunteerModalContent({ lang, onClose }: { lang: 'en' | 'zh'; onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="text-center py-6 space-y-3 font-poppins">
        <Check className="w-12 h-12 text-green-600 mx-auto" />
        <h4 className="text-lg font-bold text-neutral-900">
          {lang === 'en' ? 'Thank You for Volunteering!' : '感谢您支持社区志愿服务！'}
        </h4>
        <p className="text-xs text-neutral-600">
          {lang === 'en'
            ? 'Our volunteer coordinator will reach out to match your skills with upcoming festivals.'
            : '我们的志愿者协调员将很快与您联络，根据您的特长安排文化节与社区互助项目。'}
        </p>
        <button
          onClick={onClose}
          className="mt-3 px-5 py-2 bg-[#8e2e11] text-white rounded text-xs font-bold"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
      className="space-y-3 font-poppins text-xs"
    >
      <p className="text-neutral-600 leading-relaxed text-sm">
        {lang === 'en'
          ? 'Join our enthusiastic volunteer team! Opportunities include event coordination, stage management, translation, graphic design, and senior support.'
          : '加入我们充满活力的志愿者团队！服务内容涵盖活动现场协调、舞台管理、中英翻译、平面设计与长者关怀等。'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          required
          placeholder={lang === 'en' ? 'Your Name' : '姓名'}
          className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
        />
        <input
          type="email"
          required
          placeholder={lang === 'en' ? 'Your Email' : '电子邮箱'}
          className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#8e2e11]"
        />
      </div>
      <textarea
        rows={3}
        placeholder={
          lang === 'en'
            ? 'Skills or areas of interest (e.g., photography, event planning)'
            : '您的专长或感兴趣的志愿领域（如：摄影、活动策划、翻译等）'
        }
        className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#8e2e11] resize-none"
      />
      <button
        type="submit"
        className="w-full py-3 rounded-full font-bold uppercase tracking-wider text-xs text-white shadow-xs transition-all hover:bg-[#a63715] active:scale-98 cursor-pointer bg-[#8e2e11]"
      >
        {lang === 'en' ? 'Sign Up to Volunteer' : '报名成为志愿者'}
      </button>
    </form>
  );
}
