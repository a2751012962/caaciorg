export interface MembershipPageContent {
  title: string;
  subtitle: string;
  benefitsTitle: string;
  benefits: string[];
  note: string;
  tiers: {
    name: string;
    price: string;
    period: string;
    desc: string;
    features: string[];
    isPopular?: boolean;
  }[];
  formTitle: string;
  formName: string;
  formEmail: string;
  formPhone: string;
  formTier: string;
  formSubmit: string;
  successMsg: string;
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
  ],
  note: '* All prices include standard card-processing fees. Memberships are tax-deductible to the extent permitted by law.',
  tiers: [
    {
      name: 'Student Member',
      price: '$10',
      period: 'per year',
      desc: 'For full-time undergraduate or graduate students.',
      features: [
        'Free or discounted entry to CAACI celebrations',
        'Career mentorship and resume workshops',
        'Community volunteer service hours certification',
        'Member networking WeChat group',
      ],
    },
    {
      name: 'Individual Member',
      price: '$20',
      period: 'per year',
      desc: 'For residents, scholars, and individual professionals.',
      features: [
        'Annual Member Meeting with lunch included',
        'Priority registration for cultural festivals',
        'Partner store discounts in Champaign & Chicago',
        'Voting eligibility in board general elections',
      ],
      isPopular: true,
    },
    {
      name: 'Family Membership',
      price: '$35',
      period: 'per year',
      desc: 'Covers parents, children, and seniors in one household.',
      features: [
        'All Individual privileges for up to 4 family members',
        'Youth culture workshops and kids activity perks',
        'Senior member care and community support assistance',
        'Group discounts for live theater and concerts',
      ],
    },
    {
      name: 'Lifetime / Patron Member',
      price: '$200',
      period: 'one-time',
      desc: "For dedicated supporters wishing to endow CAACI's mission.",
      features: [
        'Permanent lifetime membership status',
        'VIP seating at the Annual Chinese New Year Gala',
        'Special recognition in annual reports and programs',
        'Direct participation in CAACI Advisory Council',
      ],
    },
  ],
  formTitle: 'Membership Registration & Renewal Application',
  formName: 'Full Name',
  formEmail: 'Email Address',
  formPhone: 'Phone Number',
  formTier: 'Select Membership Tier',
  formSubmit: 'Proceed to Register & Pay',
  successMsg: 'Thank you! Your membership application has been received. Welcome to CAACI!',
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
  ],
  note: '* 费用已包含信用卡交易处理费。捐赠与会费依照 501(c)(3) 非营利法例享有相应免税抵扣资格。',
  tiers: [
    {
      name: '学生会员',
      price: '$10',
      period: '每年',
      desc: '面向全日制在读本科生、硕士生与博士生。',
      features: [
        '节日联欢活动门票特惠或免费体验',
        '参与名企导师职业讲座与求职指导',
        '开具官方社区义工公益服务时长证明',
        '加入 CAACI 青年学生交流群',
      ],
    },
    {
      name: '个人会员',
      price: '$20',
      period: '每年',
      desc: '面向本地华人居民、访问学者与职场人士。',
      features: [
        '参加年度会员大会（免费享用午餐）',
        '三大中华传统节日优先席位预订',
        '香槟与芝加哥合作中餐馆/商户专属折扣',
        '享有协会换届选举投票与监督权',
      ],
      isPopular: true,
    },
    {
      name: '家庭会员',
      price: '$35',
      period: '每年',
      desc: '全家共享（包含父母、子女及常住长辈）。',
      features: [
        '全家最多4人同享个人会员全部福利',
        '儿童中华传统文化体验营专享福利',
        '社区长辈生活协助与医疗讲座服务',
        '剧院文艺演出与高品质演出团购优惠',
      ],
    },
    {
      name: '终身荣誉会员',
      price: '$200',
      period: '一次性',
      desc: '面向长期热心资助华协公益事业的杰出支持者。',
      features: [
        '终身享有 CAACI 尊贵会员资格无须年审',
        '新春联欢晚会 VIP 前排荣誉专席',
        '协会年度报告与宣传册特别鸣谢',
        '受邀列席 CAACI 高级顾问委员会会议',
      ],
    },
  ],
  formTitle: 'CAACI 会员注册 / 续费申请',
  formName: '真实姓名',
  formEmail: '电子邮箱',
  formPhone: '联系电话',
  formTier: '选择会员类型',
  formSubmit: '提交申请并完成注册',
  successMsg: '诚挚感谢！您的会员申请已提交成功，欢迎成为 CAACI 正式会员！',
};
