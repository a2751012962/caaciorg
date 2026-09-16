export interface BusinessMerchant {
  id: string;
  name: string;
  nameEn?: string;
  category:
    | 'restaurant'
    | 'dental'
    | 'financial'
    | 'realestate'
    | 'education_media'
    | 'dining'
    | 'groceries'
    | 'professional'
    | 'services'
    | 'tech'
    | string;
  categoryLabel: string;
  discount?: string;
  address: string;
  phone?: string;
  hours?: string;
  website?: string;
  desc: string;
  featured?: boolean;
}

export interface BusinessEventItem {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  organizer: string;
  desc: string;
  rsvpUrl?: string;
}

export interface BusinessSponsorTier {
  name: string;
  price: string;
  period: string;
  subtitle: string;
  features: string[];
  recommended?: boolean;
  /** membership: link to Business Membership checkout; microloan: open the inquiry form */
  action?: 'membership' | 'microloan';
}

// Rendered strings may hold {count} (merchants actually listed), {price} (live
// Business Membership base price) and {card} (that price + 3.5% card fee);
// BusinessServicesPage fills them in.
export interface BusinessServicesContent {
  title: string;
  subtitle: string;
  instruction: string;
  stats: {
    value: string;
    label: string;
  }[];
  merchants: BusinessMerchant[];
  events: BusinessEventItem[];
  sponsorTiers: BusinessSponsorTier[];
}

export const businessServicesDataEN: BusinessServicesContent = {
  title: 'Business Services & Directory',
  subtitle:
    'Promoting local Chinese businesses, providing publicity, and connecting entrepreneurs with community resources and chamber programs.',
  instruction: 'Explore authentic local businesses and economic development resources.',
  stats: [
    { value: '{count}', label: 'Verified Directory Merchants' },
    { value: '$7.5K - $15K', label: 'Chamber Microloan Support' },
    { value: '2.5% - 3%', label: 'Low Interest Microloan Rate' },
    { value: '{price}/yr', label: 'Business Directory Fee' },
  ],
  merchants: [
    {
      id: 'kung-fu-tea',
      name: 'Kung Fu Tea (功夫茶)',
      nameEn: 'Kung Fu Tea',
      category: 'restaurant',
      categoryLabel: 'Bubble Tea & Beverage',
      address: '707 S. Sixth Street, #107, Champaign, IL 61820',
      phone: '(217) 552-1668',
      hours: '11:00 AM - 10:00 PM',
      website: 'https://www.kungfutea.com',
      desc: 'Bubble tea store franchise with over 500 locations in America, offering freshly brewed tea, boba, specialty milk teas, and fresh food in Campustown.',
      featured: true,
    },
    {
      id: 'tenkyu',
      name: 'Tenkyu',
      nameEn: 'Tenkyu Japanese Fusion',
      category: 'restaurant',
      categoryLabel: 'Japanese Fusion Dining',
      address: '301 N Neil St, Unit 104, Champaign, IL 61820',
      hours: '11:30 AM - 10:00 PM',
      website: 'https://www.tenkyu.cafe',
      desc: 'Fine dining Japanese fusion restaurant located in Downtown Champaign, offering elevated culinary creations and fresh ingredients.',
      featured: true,
    },
    {
      id: 'szechuan-taste',
      name: 'Szechuan Taste (川之味)',
      nameEn: 'Szechuan Taste',
      category: 'restaurant',
      categoryLabel: 'Szechuan Cuisine',
      address: 'Champaign, IL',
      phone: '(217) 530-4972',
      hours: 'Lunch Daily 11:00 AM - 3:00 PM, Dinner',
      website: 'https://szechuantastetogo.com',
      desc: 'Authentic spicy Sichuan specialties, classic Chinese home-style dishes, and daily fast food lunch specials from 11:00 AM to 3:00 PM.',
      featured: true,
    },
    {
      id: 'susuru-ramen',
      name: 'Susuru Ramen',
      nameEn: 'Susuru Ramen',
      category: 'restaurant',
      categoryLabel: 'Japanese Cuisine & Ramen',
      address: '621 E Green St #A, Champaign, IL 61820',
      phone: '(217) 552-1266',
      website: 'https://susururamenuiuc.com',
      desc: 'Authentic Japanese cuisine specializing in flavorful ramen bowls, savory rice bowls, bento boxes, and stir-fried noodle dishes with authentic broth.',
      featured: true,
    },
    {
      id: 'u-of-i-credit-union',
      name: 'U of I Community Credit Union (UICCU)',
      nameEn: 'U of I Community Credit Union',
      category: 'financial',
      categoryLabel: 'Credit Union & Banking',
      address: '206 E University Ave, Urbana, IL 61801',
      phone: '(217) 278-7700',
      hours: 'Mon-Fri 9:00 AM - 5:00 PM, Sat 9:00 AM - 12:00 PM',
      website: 'https://uoficreditunion.org',
      desc: 'Member-owned financial cooperative serving University of Illinois faculty, staff, students, and Champaign County residents with personal & business banking, loans, and mortgages.',
      featured: true,
    },
    {
      id: 'caring-family-dental',
      name: 'Caring Family Dental',
      nameEn: 'Caring Family Dental',
      category: 'dental',
      categoryLabel: 'Dental Office',
      address: '201 W Springfield Ave #506, Champaign, IL 61820',
      phone: '(217) 954-1850',
      hours: 'Mon-Thu 8:00 AM - 5:00 PM, Fri 8:00 AM - 1:00 PM',
      website: 'https://caringdentalchampaign.com',
      desc: 'Comprehensive and compassionate family dental practice in Champaign, providing preventive cleanings, restorative treatments, and cosmetic dentistry.',
    },
    {
      id: 'urbana-family-dental',
      name: 'Urbana Family Dental Care',
      nameEn: 'Urbana Family Dental Care',
      category: 'dental',
      categoryLabel: 'Dental Office',
      address: '1812 S Philo Rd, Urbana, IL 61802',
      phone: '(217) 729-7411',
      hours: 'Mon-Thu 8:00 AM - 5:00 PM, Fri 8:00 AM - 1:00 PM',
      website: 'https://urbanadentalcare.com',
      desc: 'Dedicated family oral healthcare clinic in Urbana committed to personalized dental care, periodontal therapy, and maintaining healthy smiles for all ages.',
    },
    {
      id: 'financial-brilliance',
      name: 'Financial Brilliance Accounting Firm',
      nameEn: 'Financial Brilliance Corp',
      category: 'financial',
      categoryLabel: 'Accounting & Tax Services',
      address: 'Colony West, Champaign, IL 61820',
      phone: '(626) 800-8800',
      hours: 'By appointment',
      website: 'https://financial-brilliance.com',
      desc: 'Professional accounting firm specializing in comprehensive accounting, tax preparation, bookkeeping, and fractional CFO advisory services for individuals and businesses.',
    },
    {
      id: 'american-financial-alliance',
      name: 'American Financial Alliance',
      nameEn: 'American Financial Alliance',
      category: 'financial',
      categoryLabel: 'Financial & Wealth Advisory',
      // No address or phone on the live site's directory; none is shown.
      address: '',
      desc: 'Comprehensive financial planning, wealth management, retirement solutions, and family investment strategies tailored for Central Illinois residents.',
    },
    {
      id: 'jill-hess-realty',
      name: 'Jill Hess, Realtor® - RE/MAX Realty Associates',
      nameEn: 'Jill Hess, Realtor® - RE/MAX Realty Associates',
      category: 'realestate',
      categoryLabel: 'Real Estate Broker',
      address: '2919 Crossing Court, Champaign, IL',
      phone: '(217) 417-8177',
      website: 'https://jillhess.remax.com',
      desc: 'Licensed Realtor and Broker with RE/MAX Realty Associates in Champaign, guiding families, scholars, and buyers through residential buying, selling, and relocation.',
    },
    {
      id: 'julie-woller-aaa',
      name: 'Julie Woller - AAA Insurance',
      nameEn: 'Julie Woller - AAA Insurance',
      category: 'realestate',
      categoryLabel: 'Insurance Services',
      // No address or phone on the live site's directory; none is shown.
      address: '',
      desc: 'Trusted AAA insurance agent in Champaign offering comprehensive auto, home, and life insurance policies, as well as AAA roadside membership benefits.',
    },
    {
      id: 'immi-education',
      name: 'IMMI Education Inc. (欧美新锐教育)',
      nameEn: 'IMMI Education Inc.',
      category: 'education_media',
      categoryLabel: 'Education Consulting',
      address: '239 Washington St, Unit 304, Jersey City, NJ 07302',
      phone: '(978) 846-5229',
      website: 'https://www.immieducation.com',
      desc: 'Comprehensive international education organization specializing in academic planning, high school counseling, college application planning, and graduate school admissions.',
    },
    {
      id: 'magnify-film-media',
      name: 'Magnify Film & Media',
      nameEn: 'Magnify Film & Media',
      category: 'education_media',
      categoryLabel: 'Media Production & Videography',
      address: '2107 N High Cross Rd, Urbana, IL 61802',
      phone: '(217) 552-4636',
      website: 'https://magnifyfilms.org',
      desc: 'Professional business and personal videographers based in Urbana, IL, providing creative commercial video production, brand storytelling, and event documentation.',
    },
    {
      id: 'myst-scc',
      name: 'MYST SCC',
      nameEn: 'MYST SCC',
      category: 'services',
      categoryLabel: 'Luxury Car Showroom',
      address: '301 W Marketview Dr, Ste A, Champaign, IL 61822',
      phone: '(248) 850-8010',
      website: 'https://mystscc.com',
      featured: true,
      desc: 'Curated pre-owned luxury and performance cars, plus detailing, vinyl wraps and paint protection.',
    },
  ],
  events: [
    {
      id: 'job-fair',
      title: 'All-State Agencies Job Fair',
      date: 'Wednesday, Nov 12, 2025',
      time: '11:00 AM - 2:00 PM',
      location: 'Siebel Center for Design, UIUC Campus, Champaign, IL',
      organizer: 'IDPH (Illinois Dept of Public Health) & CAACI',
      desc: 'Hosted by CAACI in partnership with the Illinois Department of Public Health (IDPH). Meet directly with state agency recruiters, explore career opportunities in Illinois state government, and receive resume and interview advice. Free admission.',
    },
  ],
  sponsorTiers: [
    {
      name: 'Business Directory Membership',
      price: '{price}',
      period: 'per year',
      subtitle:
        'Official CAACI Business Membership, which includes the directory listing ({card} by card, incl. 3.5% processing fee).',
      features: [
        'Listing on the caaciorg.com Business Directory after staff review',
        'Publicity and exposure across Central Illinois Chinese community',
        'Annual rolling membership valid for 12 full months from joining date',
        'Pay online by card through Business Membership, or by check, Zelle or cash (email us to arrange)',
        'Submit your business details with the Join Directory form, or email caaci.org@gmail.com',
      ],
      recommended: true,
      action: 'membership',
    },
    {
      name: 'Chamber Microloan Program',
      price: 'Up to $15K',
      period: '5-yr term',
      subtitle: 'Affordable financing via Champaign County Chamber of Commerce.',
      action: 'microloan',
      features: [
        'Low interest rates capped at 3% (2.5% with auto monthly repayment)',
        'Focus on minority and women-owned businesses in Champaign County',
        'Requires EIN, IL Secretary of State good standing, and 1-page business plan',
        'Contact Laura Weis (lauraw@champaigncounty.org / 217.359.1791)',
      ],
    },
  ],
};

export const businessServicesDataZH: BusinessServicesContent = {
  title: '商业服务与名录',
  subtitle: '推广本地华人商户、提升企业知名度、对接社区资源与商会扶持项目。',
  instruction: '浏览香槟及厄巴纳地区真实商家名录、商会小额贷款扶持与经贸活动信息。',
  stats: [
    { value: '{count}', label: '名录收录商户与机构' },
    { value: '$7,500 - $15,000', label: '商会小额贷款扶持额度' },
    { value: '2.5% - 3%', label: '扶持性低息贷款年化利率' },
    { value: '{price}/年', label: '商户名录入驻年度会费' },
  ],
  merchants: [
    {
      id: 'kung-fu-tea',
      name: 'Kung Fu Tea (功夫茶)',
      nameEn: 'Kung Fu Tea',
      category: 'restaurant',
      categoryLabel: '茶饮与简餐',
      address: '707 S. Sixth Street, #107, Champaign, IL 61820',
      phone: '(217) 552-1668',
      hours: '上午 11:00 - 晚上 10:00',
      website: 'https://www.kungfutea.com',
      desc: '全美超 500 家门店的知名连锁茶饮品牌，位于香槟校区 Sixth Street，主打现泡原茶、波霸奶茶、鲜果特调及特色简餐小吃。',
      featured: true,
    },
    {
      id: 'tenkyu',
      name: 'Tenkyu 日本融合料理',
      nameEn: 'Tenkyu Japanese Fusion',
      category: 'restaurant',
      categoryLabel: '日式融合料理',
      address: '301 N Neil St, Unit 104, Champaign, IL 61820',
      hours: '上午 11:30 - 晚上 10:00',
      website: 'https://www.tenkyu.cafe',
      desc: '位于香槟市中心（Downtown Champaign）的精致日式融合料理餐厅，精选新鲜食材，提供高品质的用餐与社交体验。',
      featured: true,
    },
    {
      id: 'szechuan-taste',
      name: 'Szechuan Taste (川之味)',
      nameEn: 'Szechuan Taste',
      category: 'restaurant',
      categoryLabel: '正宗川味特色菜',
      address: 'Champaign, IL',
      phone: '(217) 530-4972',
      hours: '每日午餐 11:00 AM - 3:00 PM，晚餐正常营业',
      website: 'https://szechuantastetogo.com',
      desc: '主打正宗地道麻辣川菜、经典传统家常菜肴，每日上午 11 点至下午 3 点提供快捷午市特惠快餐。',
      featured: true,
    },
    {
      id: 'susuru-ramen',
      name: 'Susuru Ramen 日式拉面',
      nameEn: 'Susuru Ramen',
      category: 'restaurant',
      categoryLabel: '日式拉面与料理',
      address: '621 E Green St #A, Champaign, IL 61820',
      phone: '(217) 552-1266',
      website: 'https://susururamenuiuc.com',
      desc: '主营地道正宗日本风味料理，提供浓郁醇香的日式拉面、盖浇饭、日式便当盒及镬气炒面系列。',
      featured: true,
    },
    {
      id: 'u-of-i-credit-union',
      name: 'U of I Community Credit Union (UICCU) 社区信用社',
      nameEn: 'U of I Community Credit Union',
      category: 'financial',
      categoryLabel: '社区信用社与金融服务',
      address: '206 E University Ave, Urbana, IL 61801',
      phone: '(217) 278-7700',
      hours: '周一至周五 9:00 AM - 5:00 PM，周六 9:00 AM - 12:00 PM',
      website: 'https://uoficreditunion.org',
      desc: '服务伊利诺伊大学教职员工、在校学生及香槟县广大居民的合作制金融机构，提供个人与企业开户、房屋贷款、车贷与低息储蓄支持。',
      featured: true,
    },
    {
      id: 'caring-family-dental',
      name: 'Caring Family Dental 关爱家庭牙科诊所',
      nameEn: 'Caring Family Dental',
      category: 'dental',
      categoryLabel: '牙科门诊',
      address: '201 W Springfield Ave #506, Champaign, IL 61820',
      phone: '(217) 954-1850',
      hours: '周一至周四 8:00 AM - 5:00 PM，周五 8:00 AM - 1:00 PM',
      website: 'https://caringdentalchampaign.com',
      desc: '位于香槟市中心的温馨家庭牙科诊所，提供常规洁牙保健、牙齿修复、牙冠补牙及美容牙科等全方位口腔诊疗。',
    },
    {
      id: 'urbana-family-dental',
      name: 'Urbana Family Dental Care 厄巴纳家庭牙科',
      nameEn: 'Urbana Family Dental Care',
      category: 'dental',
      categoryLabel: '牙科门诊',
      address: '1812 S Philo Rd, Urbana, IL 61802',
      phone: '(217) 729-7411',
      hours: '周一至周四 8:00 AM - 5:00 PM，周五 8:00 AM - 1:00 PM',
      website: 'https://urbanadentalcare.com',
      desc: '位于厄巴纳 Philo Rd 的现代化专业口腔诊所，致力于为各年龄段家庭成员提供个性化口腔护理、牙周诊治与健康微笑守护。',
    },
    {
      id: 'financial-brilliance',
      name: 'Financial Brilliance Accounting Firm 辉盛会计师事务所',
      nameEn: 'Financial Brilliance Corp',
      category: 'financial',
      categoryLabel: '会计与税务服务',
      address: 'Colony West, Champaign, IL 61820',
      phone: '(626) 800-8800',
      hours: '预约制',
      website: 'https://financial-brilliance.com',
      desc: '专业会计与财务咨询机构，专注为个人、在美留学生学者及中小微企业提供记账报税、税务合规筹划、公司成立及 CFO 顾问服务。',
    },
    {
      id: 'american-financial-alliance',
      name: 'American Financial Alliance 美洲金融联盟',
      nameEn: 'American Financial Alliance',
      category: 'financial',
      categoryLabel: '金融咨询与财富规划',
      // 旧站名录没有地址和电话，这里不显示。
      address: '',
      desc: '面向伊利诺伊中部居民的综合财富管理机构，提供退休金规划、人寿与资产保全、教育基金配置及家庭财务战略。',
    },
    {
      id: 'jill-hess-realty',
      name: 'Jill Hess, Realtor® - RE/MAX Realty Associates',
      nameEn: 'Jill Hess, Realtor® - RE/MAX Realty Associates',
      category: 'realestate',
      categoryLabel: '房地产经纪人',
      address: '2919 Crossing Court, Champaign, IL',
      phone: '(217) 417-8177',
      website: 'https://jillhess.remax.com',
      desc: '香槟 RE/MAX Realty Associates 资深持牌房产经纪，专注为本地家庭、学者及新购房者提供住宅买卖、学区房选购与全流程过户服务。',
    },
    {
      id: 'julie-woller-aaa',
      name: 'Julie Woller - AAA Insurance 保险顾问',
      nameEn: 'Julie Woller - AAA Insurance',
      category: 'realestate',
      categoryLabel: '保险代理与道路救援',
      // 旧站名录没有地址和电话，这里不显示。
      address: '',
      desc: '深耕香槟地区的资深 AAA 保险代理人，提供汽车保险、房屋保险、人寿保单及 AAA 道路紧急救援会员办理。',
    },
    {
      id: 'immi-education',
      name: 'IMMI Education Inc. (欧美新锐教育)',
      nameEn: 'IMMI Education Inc.',
      category: 'education_media',
      categoryLabel: '国际教育咨询',
      address: '239 Washington St, Unit 304, Jersey City, NJ 07302',
      phone: '(978) 846-5229',
      website: 'https://www.immieducation.com',
      desc: '国际综合性教育咨询机构，专注于中美跨境留学申请长线学术规划、高中及大学转学辅导、研究生深造咨询与文书润色。',
    },
    {
      id: 'magnify-film-media',
      name: 'Magnify Film & Media 影视与商业摄像',
      nameEn: 'Magnify Film & Media',
      category: 'education_media',
      categoryLabel: '商业摄像与媒体制作',
      address: '2107 N High Cross Rd, Urbana, IL 61802',
      phone: '(217) 552-4636',
      website: 'https://magnifyfilms.org',
      desc: '位于厄巴纳的专业商业与个人影视摄制团队，承接企业宣传视频摄制、品牌故事包装、社区庆典活动高清录制与视觉创作服务。',
    },
    {
      id: 'myst-scc',
      name: 'MYST SCC 豪车展厅',
      nameEn: 'MYST SCC',
      category: 'services',
      categoryLabel: '豪车展厅',
      address: '301 W Marketview Dr, Ste A, Champaign, IL 61822',
      phone: '(248) 850-8010',
      website: 'https://mystscc.com',
      featured: true,
      desc: '精选二手豪华车与高性能车，并提供精细洗护、车身改色贴膜与漆面保护。',
    },
  ],
  events: [
    {
      id: 'job-fair',
      title: '全州政府机构招聘会',
      date: '2025 年 11 月 12 日（周三）',
      time: '上午 11:00 - 下午 2:00',
      location: 'UIUC Siebel 设计中心（Siebel Center for Design, Champaign, IL）',
      organizer: 'IDPH（伊利诺伊州公共卫生部）与 CAACI 联合主办',
      desc: '由 CAACI 与伊利诺伊州公共卫生部（IDPH）联合主办，面向社区求职者与毕业生。与伊利诺伊全州各政府部门招聘专员面对面交流，了解州政府公职招聘流程，现场享有简历修改与面试咨询辅导，免费入场。',
    },
  ],
  sponsorTiers: [
    {
      name: '商户名录年度入驻',
      price: '{price}',
      period: '每年',
      subtitle: 'CAACI 官方商业会员，含商业名录收录（刷卡合计 {card}，含 3.5% 手续费）。',
      features: [
        '经工作人员审核后收录于官方网站 caaciorg.com 商业名录',
        '直面伊利诺伊中部广大华人家庭、留学生学者与社区读者',
        '会籍自加入之日起滚动生效整整 12 个月',
        '可通过商业会员在线刷卡支付，也接受支票、Zelle、现金（请来信安排）',
        '通过“商户入驻”表格提交商户信息，或发送邮件至 caaci.org@gmail.com',
      ],
      recommended: true,
      action: 'membership',
    },
    {
      name: '香槟县商会小贷扶持',
      price: '最高 $15K',
      period: '最长 5 年期',
      subtitle: '香槟县商会（Champaign County Chamber）联合扶持小微企业资金。',
      action: 'microloan',
      features: [
        '优惠低息利率不高于 3.0%（绑定每月自动还款享 2.5% 特惠）',
        '重点扶持香槟县少数族裔与女性创业团队及小微企业',
        '需持有 EIN 税号、伊利诺伊州务卿注册良好证明及单页商业计划书',
        '商会官方联系人：Laura Weis (lauraw@champaigncounty.org / 217.359.1791)',
      ],
    },
  ],
};
