// Per-plan card copy, keyed by membership_tiers.id. Names and prices come from
// the live tiers (web/src/lib/tiers.ts); this file only carries the benefit
// lines. A live tier without an entry here falls back to its description.
export type TierCopyId = 'free' | 'student' | 'individual' | 'family' | 'business';

export interface TierCopy {
  period: string;
  features: string[];
  isPopular?: boolean;
}

// The icon a privilege card draws; the glyphs themselves live in the page.
export type PrivilegeIcon = 'utensils' | 'gift' | 'star' | 'shield';

export interface MembershipPrivilege {
  icon: PrivilegeIcon;
  title: string;
  text: string;
}

// Copy that carries a value is a template filled by lib/text.ts: {email},
// {total}, {tokens}, {plan}, {code}, {percent}. Prices and dates are formatted
// in code and passed in.
export interface MembershipPageContent {
  // title, subtitle and benefits are not read by MembershipPage (its privileges
  // section below carries the cards); they have no effect on the page.
  title: string;
  subtitle: string;
  benefitsTitle: string;
  benefits: string[];
  note: string;
  inviteNote: string;
  /** Built-in per-plan period and benefit lines (the admin Plans tab wins over them). */
  tiers: Record<TierCopyId, TierCopy>;
  formTitle: string;
  formTier: string;
  formSubmit: string;
  /** The word shown instead of a price on the free plan. */
  freeLabel: string;
  breadcrumb: {
    backToMenu: string;
    /** Screen-reader label of the breadcrumb nav. */
    label: string;
  };
  plans: {
    eyebrow: string;
    title: string;
    text: string;
    previousLabel: string;
    nextLabel: string;
    /** Shown once under the cards while 华协币 grants are switched on. */
    tokensNote: string;
  };
  planCard: {
    recommended: string;
    /** Under the price of the free plan. */
    noCard: string;
    /** {total} = price plus the card fee. */
    cardTotal: string;
    /** {tokens} = 华协币 the plan grants each year. */
    tokensPerYear: string;
    currentPlan: string;
    selected: string;
    select: string;
    /** Period shown for a plan that has no built-in copy. */
    perYear: string;
  };
  pass: {
    eyebrow: string;
    title: string;
    text: string;
    logoImage: string;
    logoAlt: string;
    name: string;
    location: string;
    cardholder: string;
    guestName: string;
    memberIdLabel: string;
    memberIdValue: string;
    expiresLabel: string;
    scanHint: string;
    /** Expiry line of the free plan. */
    never: string;
    /** Expiry line of a plan not yet bought. */
    twelveMonths: string;
  };
  portal: {
    title: string;
    text: string;
    button: string;
  };
  form: {
    /** {email} = the association's contact address. */
    intro: string;
    signedInAs: string;
    /** {plan} = the selected plan's name. */
    summaryTitle: string;
    membership: string;
    freeNote: string;
    annual: string;
    cardFee: string;
    /** {code}, {percent}. */
    discountLine: string;
    newRate: string;
    totalToday: string;
    tokensIncluded: string;
    /** {total} = the full yearly price the plan renews at. */
    discountFirstYear: string;
    renewsYearly: string;
    codeLabel: string;
    codePlaceholder: string;
    codeApply: string;
    codeChecking: string;
    /** {code}, {percent}. */
    codeApplied: string;
    securePayment: string;
  };
  submit: {
    wait: string;
    loading: string;
    signin: string;
    current: string;
    billing: string;
    free: string;
    switchPlan: string;
  };
  notes: {
    signin: string;
    current: string;
    fixBilling: string;
    cancelFirst: string;
    switchPlan: string;
  };
  errors: {
    network: string;
    invalidCode: string;
    changePlan: string;
    checkout: string;
  };
  privileges: {
    eyebrow: string;
    text: string;
    items: MembershipPrivilege[];
  };
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
    'Save the $390 documentation fee per car you buy from partner showroom MYST SCC',
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
        'Save the $390 documentation fee per car from partner MYST SCC',
      ],
    },
    individual: {
      period: 'per year',
      features: [
        'Annual Member Meeting with lunch included',
        'Priority registration for cultural festivals',
        'Partner store discounts in Champaign & Chicago',
        'Voting eligibility in board general elections',
        'Save the $390 documentation fee per car from partner MYST SCC',
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
        'Save the $390 documentation fee per car from partner MYST SCC',
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
  freeLabel: 'Free',
  breadcrumb: { backToMenu: 'Back to Menu', label: 'Breadcrumb' },
  plans: {
    eyebrow: 'Choose Your Plan',
    title: 'Membership Tiers & Annual Dues',
    text: 'Every contribution directly supports our community cultural events and civic programs.',
    previousLabel: 'Previous plan',
    nextLabel: 'Next plan',
    tokensNote:
      'CAACI Tokens land in your member wallet when you join, and again at every renewal. Spend them at CAACI event stalls and participating partner shops — they never expire.',
  },
  planCard: {
    recommended: 'Recommended',
    noCard: 'No card needed',
    cardTotal: '{total} by card, incl. 3.5% fee',
    tokensPerYear: '{tokens} CAACI Tokens each year',
    currentPlan: 'Your current plan ✓',
    selected: 'Selected ✓',
    select: 'Select Plan',
    perYear: 'per year',
  },
  pass: {
    eyebrow: 'Digital Pass',
    title: 'Apple Wallet Pass',
    text: 'Your digital badge can be added to Apple Wallet or accessed anytime via your Member Account.',
    logoImage: '/images/logo.png',
    logoAlt: 'CAACI',
    name: 'CAACI Member Pass',
    location: 'Central Illinois • 501(c)(3)',
    cardholder: 'Cardholder Name',
    guestName: 'Guest Member',
    memberIdLabel: 'Member ID',
    memberIdValue: 'CAACI-••••',
    expiresLabel: 'Expires',
    scanHint: 'Tap or scan for merchant discounts',
    never: 'NEVER',
    twelveMonths: '12 MONTHS',
  },
  portal: {
    title: 'Already a member?',
    text: 'Access your digital pass and partner perks',
    button: 'Member Portal',
  },
  form: {
    intro:
      "Choose a plan and pay securely by card on Stripe; your membership is activated automatically once payment completes. We accept other payment methods too (check, Zelle, cash) — email {email} and we'll arrange it.",
    signedInAs: 'Signed in as',
    summaryTitle: 'Order Summary · {plan}',
    membership: 'Membership',
    freeNote:
      'No payment needed and nothing expires. Upgrade to a paid plan any time for the annual meeting and festival perks.',
    annual: 'Annual membership',
    cardFee: 'Card processing fee (3.5%)',
    discountLine: '{code} −{percent}%',
    newRate: 'New annual rate',
    totalToday: 'Total today',
    tokensIncluded: 'CAACI Tokens included',
    discountFirstYear: 'Discount applies to your first year only; renews at {total}/yr.',
    renewsYearly: 'Renews yearly; cancel anytime.',
    codeLabel: 'Discount Code (Optional)',
    codePlaceholder: 'Enter code',
    codeApply: 'Apply',
    codeChecking: 'Checking…',
    codeApplied: '{code} — {percent}% off your first year',
    securePayment: 'Secure payment via Stripe',
  },
  submit: {
    wait: 'Please wait…',
    loading: 'Loading…',
    signin: 'Log in or sign up to continue',
    current: 'Go to my account',
    billing: 'Manage billing in my account',
    free: 'Join for free',
    switchPlan: 'Confirm plan change',
  },
  notes: {
    signin: 'You will log in or create an account first, then come straight back here to finish.',
    current: 'You are already on this plan.',
    fixBilling:
      'Your last payment failed. Update your card from Manage billing in your account before changing plans.',
    cancelFirst:
      'To move to the free membership, cancel your paid plan from Manage billing in your account first.',
    switchPlan: 'Your subscription is updated in place — Stripe prorates the difference.',
  },
  errors: {
    network: 'Network error — please try again.',
    invalidCode: 'Invalid discount code.',
    changePlan: 'Could not change the plan.',
    checkout: 'Checkout failed — please try again.',
  },
  privileges: {
    eyebrow: 'Community Privileges',
    text: 'Join over 800+ members and families strengthening the Chinese American community across Central Illinois.',
    items: [
      {
        icon: 'utensils',
        title: 'Annual Meeting Free Luncheon',
        text: 'Enjoy complimentary gourmet Chinese lunch buffets and executive reports at the CAACI Annual Membership Conference.',
      },
      {
        icon: 'gift',
        title: 'Festival Ticket Discounts',
        text: 'Special discounted admission and priority seating at Spring Festival Gala, Mid-Autumn celebrations, and Dragon Boat picnics.',
      },
      {
        icon: 'star',
        title: 'Partner Business Discounts',
        text: 'Show your digital CAACI Membership Card at participating restaurants, grocery stores, and professional service providers.',
      },
      {
        icon: 'shield',
        title: 'Verified WeChat Network',
        text: 'Connect with scholars, alumni, and families in spam-free, verified local mutual-help community groups.',
      },
    ],
  },
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
    '在合作豪车展厅 MYST SCC 购车，每辆车免除价值 $390 的文件费',
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
        '在合作车行 MYST SCC 购车，每辆车免 $390 文件费',
      ],
    },
    individual: {
      period: '每年',
      features: [
        '参加年度会员大会（免费享用午餐）',
        '三大中华传统节日优先席位预订',
        '香槟与芝加哥合作中餐馆/商户专属折扣',
        '享有协会换届选举投票与监督权',
        '在合作车行 MYST SCC 购车，每辆车免 $390 文件费',
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
        '在合作车行 MYST SCC 购车，每辆车免 $390 文件费',
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
  freeLabel: '免费',
  breadcrumb: { backToMenu: '返回菜单', label: '面包屑导航' },
  plans: {
    eyebrow: '入会方案',
    title: '会员类别与年度会费',
    text: '所有会费直接投入到华协举办的重大文化庆典、社区互助与青少年公益项目中。',
    previousLabel: '上一个方案',
    nextLabel: '下一个方案',
    tokensNote:
      '华协币会在入会时存入您的会员钱包，之后每次续费都会再次到账。可在华协活动摊位及合作商户消费，永不过期。',
  },
  planCard: {
    recommended: '推荐首选',
    noCard: '无需付款',
    cardTotal: '刷卡合计 {total}（含 3.5% 手续费）',
    tokensPerYear: '每年赠送 {tokens} 华协币',
    currentPlan: '当前方案 ✓',
    selected: '已选择 ✓',
    select: '选择此方案',
    perYear: '每年',
  },
  pass: {
    eyebrow: '电子会员凭证',
    title: '电子会员卡实时预览',
    text: '入会后将自动生成专属实名电子卡，可出示享受合作商户立减与活动快速签到。',
    logoImage: '/images/logo.png',
    logoAlt: 'CAACI',
    // The pass is drawn in English on both language pages today; these lines
    // are kept as shown so the Chinese page does not change.
    name: 'CAACI Member Pass',
    location: 'Central Illinois • 501(c)(3)',
    cardholder: '持卡人姓名',
    guestName: '华协新会员',
    memberIdLabel: 'Member ID',
    memberIdValue: 'CAACI-••••',
    expiresLabel: 'Expires',
    scanHint: 'Tap or scan for merchant discounts',
    never: '永不过期',
    twelveMonths: '12 个月',
  },
  portal: {
    title: '已经是华协会员？',
    text: '登录会员中心查看折扣券与续费状态',
    button: '进入会员专区',
  },
  form: {
    intro:
      '选择方案后通过 Stripe 安全刷卡支付，付款完成后会员资格自动生效。我们也接受支票、Zelle、现金等其他付款方式，请发邮件至 {email} 与我们联系安排。',
    signedInAs: '当前登录',
    summaryTitle: '费用明细 · {plan}',
    membership: '会费',
    freeNote: '无需付款，永不过期。可随时升级为付费会员，享受会员大会和节日福利。',
    annual: '年度会费',
    cardFee: '银行卡手续费（3.5%）',
    discountLine: '{code} −{percent}%',
    newRate: '新年费',
    totalToday: '今日合计',
    tokensIncluded: '赠送华协币',
    discountFirstYear: '折扣仅限首年；续费价为 {total}/年。',
    renewsYearly: '按年续费，可随时取消。',
    codeLabel: '折扣码（选填）',
    codePlaceholder: '输入折扣码',
    codeApply: '应用',
    codeChecking: '验证中…',
    codeApplied: '{code} — {percent}% 首年折扣',
    securePayment: '通过 Stripe 安全支付',
  },
  submit: {
    wait: '请稍候…',
    loading: '加载中…',
    signin: '登录或注册后继续',
    current: '前往我的账户',
    billing: '在我的账户中管理账单',
    free: '免费加入',
    switchPlan: '确认更改方案',
  },
  notes: {
    signin: '需先登录或注册账户，完成后会自动返回本页继续。',
    current: '您已是该方案的会员。',
    fixBilling: '上次扣款失败。请先在账户的“管理账单”中更新银行卡，再更改方案。',
    cancelFirst: '如需改为免费会员，请先在账户的“管理账单”中取消付费方案。',
    switchPlan: '订阅将原地更新——Stripe 会按比例结算差价。',
  },
  errors: {
    network: '网络错误，请重试。',
    invalidCode: '折扣码无效。',
    changePlan: '无法更改方案。',
    checkout: '结账失败，请重试。',
  },
  privileges: {
    eyebrow: '会员专享礼遇',
    text: '加入香槟及中部伊利诺伊 800+ 位华人学者、留学生与家庭的互助大家庭，享有全年度社区礼遇。',
    items: [
      {
        icon: 'utensils',
        title: '年度大会免费午宴',
        text: '受邀参加每年一度的 CAACI 全体会员大会，全程免费享用丰盛传统中华午宴。',
      },
      {
        icon: 'gift',
        title: '节日盛典门票特惠',
        text: '享有新春晚会、中秋游园灯会、端午聚会等重大节日庆典的会员专属门票折扣与优先席位。',
      },
      {
        icon: 'star',
        title: '本地商户专属立减',
        text: '在香槟-厄巴纳合作中餐厅、亚洲超市及专业服务机构出示电子会员卡，享受专属立减折扣。',
      },
      {
        icon: 'shield',
        title: '实名认证微信互助社群',
        text: '加入实名认证的香槟伊大校友、学者及本地华人家庭专属微信交流群，第一时间获取安居与求学资讯。',
      },
    ],
  },
};
