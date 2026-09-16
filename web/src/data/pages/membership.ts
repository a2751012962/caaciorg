// Per-plan card copy, keyed by membership_tiers.id. Names and prices come from
// the live tiers (web/src/lib/tiers.ts); this file only carries the benefit
// lines. A live tier without an entry here falls back to its description.
export type TierCopyId = 'free' | 'student' | 'individual' | 'family' | 'business';

export interface TierCopy {
  period: string;
  features: string[];
  isPopular?: boolean;
}

export interface MembershipPageContent {
  title: string;
  subtitle: string;
  benefitsTitle: string;
  benefits: string[];
  note: string;
  inviteNote: string;
  tiers: Record<TierCopyId, TierCopy>;
  formTitle: string;
  formTier: string;
  formSubmit: string;
}

export const membershipPageDataEN: MembershipPageContent = {
  title: 'Join the Community - CAACI Membership',
  subtitle:
    'Annual membership supports our festivals, educational programs, and community services.',
  benefitsTitle: 'Paid members receive exclusive privileges:',
  benefits: [
    'Annual member meeting admission with complimentary lunch included',
    'Special member perks and ticket discounts at Dragon Boat Festival, Mid-Autumn Festival, and Spring Festival Gala',
    'Exclusive discounts with partner businesses across Champaign-Urbana, Chicago, and Milwaukee',
    'Access to CAACI Member Directory and private community WeChat groups',
    'Save the $390 documentation fee when you buy a car from partner showroom MYST SCC',
  ],
  note: '* Prices are annual base dues. Paying by card adds a 3.5% processing fee; each plan shows its card total. CAACI is a 501(c)(3) non-profit; dues and donations are tax-deductible to the extent permitted by law.',
  inviteNote: 'Honorable Membership is granted by invitation of the CAACI Board.',
  tiers: {
    free: {
      period: 'no expiry',
      features: [
        'Community updates and event announcements',
        'No card needed, and it never expires',
        'Upgrade to a paid plan any time for member perks',
        'A free drink at partner showroom MYST SCC',
      ],
    },
    student: {
      period: 'per year',
      features: [
        'Free or discounted entry to CAACI celebrations',
        'Career mentorship and resume workshops',
        'Community volunteer service hours certification',
        'Member networking WeChat group',
        'Save the $390 documentation fee on a car from partner MYST SCC',
      ],
    },
    individual: {
      period: 'per year',
      features: [
        'Annual Member Meeting with lunch included',
        'Priority registration for cultural festivals',
        'Partner store discounts in Champaign & Chicago',
        'Voting eligibility in board general elections',
        'Save the $390 documentation fee on a car from partner MYST SCC',
      ],
      isPopular: true,
    },
    family: {
      period: 'per year',
      features: [
        'All Individual privileges for up to 3 people, including you',
        'Youth culture workshops and kids activity perks',
        'Senior member care and community support assistance',
        'Group discounts for live theater and concerts',
        'Save the $390 documentation fee on a car from partner MYST SCC',
      ],
    },
    business: {
      period: 'per year',
      features: [
        'Listing in the CAACI Business Directory (after staff review)',
        'Exposure to the Central Illinois Chinese community',
        'Renews yearly from your joining date',
      ],
    },
  },
  formTitle: 'Membership Registration & Renewal',
  formTier: 'Select Membership Tier',
  formSubmit: 'Continue to payment',
};

export const membershipPageDataZH: MembershipPageContent = {
  title: '加入华协大家庭 - CAACI 会员',
  subtitle: '您的会员年费直接用于资助传统文化节日、青年教育讲座及社区公共服务。',
  benefitsTitle: '正式会员专享多重权益：',
  benefits: [
    '免费参加华协年度会员大会（含丰盛午餐）',
    '端午节、中秋节及农历新春晚会享会员专享礼遇与门票优惠',
    '遍布香槟-厄巴纳、芝加哥、密尔沃基等美中合作商家的专属消费折扣',
    '进入 CAACI 认证会员实名微信群与商业资讯交流圈',
    '在合作豪车展厅 MYST SCC 购车，免除价值 $390 的文件费',
  ],
  note: '* 所示价格为年度基础会费。刷卡支付另加 3.5% 手续费，各方案均列出刷卡合计金额。CAACI 是 501(c)(3) 非营利组织，会费与捐款可依法享受免税抵扣。',
  inviteNote: '荣誉会员由 CAACI 理事会邀请授予。',
  tiers: {
    free: {
      period: '永不过期',
      features: [
        '社区动态与活动通知',
        '无需付款，永不过期',
        '可随时升级为付费会员，享受会员福利',
        '在合作豪车展厅 MYST SCC 享免费饮品一杯',
      ],
    },
    student: {
      period: '每年',
      features: [
        '节日联欢活动门票特惠或免费体验',
        '参与名企导师职业讲座与求职指导',
        '开具官方社区义工公益服务时长证明',
        '加入 CAACI 青年学生交流群',
        '在合作车行 MYST SCC 购车，免 $390 文件费',
      ],
    },
    individual: {
      period: '每年',
      features: [
        '参加年度会员大会（免费享用午餐）',
        '三大中华传统节日优先席位预订',
        '香槟与芝加哥合作中餐馆/商户专属折扣',
        '享有协会换届选举投票与监督权',
        '在合作车行 MYST SCC 购车，免 $390 文件费',
      ],
      isPopular: true,
    },
    family: {
      period: '每年',
      features: [
        '最多 3 人（含您本人）同享个人会员全部福利',
        '儿童中华传统文化体验营专享福利',
        '社区长辈生活协助与医疗讲座服务',
        '剧院文艺演出与高品质演出团购优惠',
        '在合作车行 MYST SCC 购车，免 $390 文件费',
      ],
    },
    business: {
      period: '每年',
      features: [
        '收录于 CAACI 商业名录（经工作人员审核）',
        '面向伊利诺伊中部华人社区推广',
        '自加入之日起按年续费',
      ],
    },
  },
  formTitle: 'CAACI 会员注册 / 续费',
  formTier: '选择会员类型',
  formSubmit: '前往支付',
};
