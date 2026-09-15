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
}

export interface BusinessServicesContent {
  title: string;
  subtitle: string;
  instruction: string;
  stats: {
    value: string;
    label: string;
  }[];
  tabs: {
    id: string;
    title: string;
    heading: string;
    content: string[];
    actionText?: string;
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
    { value: '13+', label: 'Verified Directory Merchants' },
    { value: '$7.5K - $15K', label: 'Chamber Microloan Support' },
    { value: '2.5% - 3%', label: 'Low Interest Microloan Rate' },
    { value: '$100/yr', label: 'Business Directory Fee' },
  ],
  tabs: [
    {
      id: 'directory',
      title: 'Business Directory',
      heading: 'CAACI Local Chinese Business Directory',
      content: [
        'The Chinese American Association of Central Illinois (CAACI) features an official Business Directory to support and promote local Chinese businesses across Urbana, Champaign, and Central Illinois.',
        'The directory increases publicity for participating businesses, fosters connections with community members, and provides opportunities for networking and development.',
        'Categories include authentic restaurants, beverage shops, dental offices, education consulting, financial services, accounting firms, real estate, insurance, and media production.',
      ],
      actionText: 'Explore Directory',
    },
    {
      id: 'microloan',
      title: 'Chamber Microloan',
      heading: 'Champaign County Chamber Microloan Program',
      content: [
        'Featured by CAACI in our Business Services section: The Champaign County Chamber Microloan Program provides accessible financial support for Champaign County entrepreneurs, with a focus on minority and women-owned businesses.',
        'Borrowers can receive up to $7,500 (with some programs up to $15,000) with flexible repayment terms spanning five years and low interest rates not exceeding 3.0% (2.5% with automatic monthly repayment).',
        'Eligibility requires a registered EIN, good standing with the Illinois Secretary of State, and a completed one-page business plan. The program prioritizes character, reputation, and capacity to repay over strict conventional collateral.',
      ],
      actionText: 'Chamber Loan Details',
    },
    {
      id: 'events',
      title: 'Career & Commercial Events',
      heading: 'All-State Agencies Job Fair & Community Opportunities',
      content: [
        'CAACI partners with state and local institutions to bring meaningful professional and employment opportunities to community members.',
        'In partnership with the Illinois Department of Public Health (IDPH), CAACI co-hosts the All-State Agencies Job Fair at the Siebel Center for Design on the UIUC campus.',
        'Job seekers connect directly with recruiters from Illinois state government agencies, receive resume tips, and explore civil service career pathways.',
      ],
      actionText: 'View Upcoming Event',
    },
    {
      id: 'registration',
      title: 'Directory Membership',
      heading: 'Join the CAACI Business Directory',
      content: [
        'Local businesses can join the CAACI Business Directory for $100 per year ($103.50 if paying by credit card with convenience fee).',
        'Membership is on a rolling basis with the anniversary date set to the joining date.',
        'Payments can be made via check payable to CAACI (Mailing Address: P.O. Box 2276, Champaign, IL 61825-2136) or credit card. For directory registration and inquiries, contact caaci.org@gmail.com.',
      ],
      actionText: 'Register Business',
    },
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
      hours: 'Lunch Daily 11:00 AM - 3:00 PM, Dinner',
      desc: 'Authentic spicy Sichuan specialties, classic Chinese home-style dishes, and daily fast food lunch specials from 11:00 AM to 3:00 PM.',
      featured: true,
    },
    {
      id: 'susuru-ramen',
      name: 'Susuru Ramen',
      nameEn: 'Susuru Ramen',
      category: 'restaurant',
      categoryLabel: 'Japanese Cuisine & Ramen',
      address: 'Champaign, IL',
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
      address: 'Central Illinois',
      website: 'https://financial-brilliance.com',
      desc: 'Professional accounting firm specializing in comprehensive accounting, tax preparation, bookkeeping, and fractional CFO advisory services for individuals and businesses.',
    },
    {
      id: 'american-financial-alliance',
      name: 'American Financial Alliance',
      nameEn: 'American Financial Alliance',
      category: 'financial',
      categoryLabel: 'Financial & Wealth Advisory',
      address: 'Central Illinois',
      desc: 'Comprehensive financial planning, wealth management, retirement solutions, and family investment strategies tailored for Central Illinois residents.',
    },
    {
      id: 'jill-hess-realty',
      name: 'Jill Hess, Realtor® - RE/MAX Realty Associates',
      nameEn: 'Jill Hess, Realtor® - RE/MAX Realty Associates',
      category: 'realestate',
      categoryLabel: 'Real Estate Broker',
      address: 'Champaign-Urbana, IL',
      desc: 'Licensed Realtor and Broker with RE/MAX Realty Associates in Champaign, guiding families, scholars, and buyers through residential buying, selling, and relocation.',
    },
    {
      id: 'julie-woller-aaa',
      name: 'Julie Woller - AAA Insurance',
      nameEn: 'Julie Woller - AAA Insurance',
      category: 'realestate',
      categoryLabel: 'Insurance Services',
      address: 'Champaign, IL',
      phone: '(217) 351-4040',
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
      address: 'Urbana, IL',
      website: 'https://magnifyfilms.org',
      desc: 'Professional business and personal videographers based in Urbana, IL, providing creative commercial video production, brand storytelling, and event documentation.',
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
      price: '$100',
      period: 'per year',
      subtitle:
        'Official CAACI Business Directory membership ($103.50 with credit card convenience fee).',
      features: [
        'Verified permanent listing on caaciorg.com Business Directory',
        'Publicity and exposure across Central Illinois Chinese community',
        'Annual rolling membership valid for 12 full months from joining date',
        'Payment via check to P.O. Box 2276, Champaign, IL 61825-2136 or card',
        'Contact: caaci.org@gmail.com to submit your business information',
      ],
      recommended: true,
    },
    {
      name: 'Chamber Microloan Program',
      price: 'Up to $15K',
      period: '5-yr term',
      subtitle: 'Affordable financing via Champaign County Chamber of Commerce.',
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
    { value: '13+', label: '名录收录商户与机构' },
    { value: '$7,500 - $15,000', label: '商会小额贷款扶持额度' },
    { value: '2.5% - 3%', label: '扶持性低息贷款年化利率' },
    { value: '$100/年', label: '商户名录入驻年度会费' },
  ],
  tabs: [
    {
      id: 'directory',
      title: '商业名录',
      heading: 'CAACI 官方认证华人商业名录',
      content: [
        '美中伊利诺伊华人协会（CAACI）官方网站开设“商业名录（Business Directory）”，旨在扶持与推广厄巴纳、香槟及伊利诺伊中部地区的华人企业与商户。',
        '入驻名录可有效提升商户在本地社区的知名度与美誉度，促进与华人家庭、留学生及主流社区的沟通对接，并获得商会管理培训及政府扶持资金信息。',
        '名录主要分为餐饮（Restaurant）与服务（Service）两大板块，涵盖地道风味餐厅、茶饮简餐、牙科诊所、信用社金融、会计报税、房地产经纪、保险顾问、留学咨询与影视摄制等领域。',
      ],
      actionText: '浏览名录商户',
    },
    {
      id: 'microloan',
      title: '商会小额贷款',
      heading: '香槟县商会小额贷款扶持计划 (Microloan Program)',
      content: [
        'CAACI 官网重点推荐的商业扶持资源：香槟县商会小额贷款项目（Champaign County Chamber Microloan Program）为香槟县创业者和小微企业提供低息资金支持，特别重点扶持少数族裔与女性拥有的商业项目。',
        '贷款额度最高可达 $7,500（部分项目最高可达 $15,000），还款期长达 5 年，年化利率不超过 3.0%（绑定每月自动还款可享 2.5% 优惠利率）。',
        '申请要求：在香槟县合法经营、持有联邦雇主识别号（EIN）、在伊利诺伊州务卿办公室良好合规注册，并提交一份单页商业计划书/申请表。评审注重申请人信用声誉与还款能力，无需复杂繁重的传统抵押物。',
      ],
      actionText: '查看商会贷款政策',
    },
    {
      id: 'events',
      title: '经贸活动与招聘',
      heading: '伊利诺伊全州政府机构招聘会',
      content: [
        'CAACI 携手主流机构与州政府部门，为社区成员和青年毕业生提供就业与职业发展支持。',
        '由 CAACI 与伊利诺伊州公共卫生部（IDPH）联合主办的“全州政府机构招聘会（All-State Agencies Job Fair）”在伊利诺伊大学厄巴纳-香槟分校（UIUC）Siebel 设计中心举行。',
        '求职者可直接与各州政府机构招聘专员面对面沟通，了解公务员公职机会，并免费获取现场简历辅导与面试建议。',
      ],
      actionText: '查看招聘会详情',
    },
    {
      id: 'registration',
      title: '商户入驻申请',
      heading: '商户加入名录政策与会费说明',
      content: [
        'CAACI 商业名录面向本地商户开放申请，仅加入名录商户会费为 $100/年（如使用信用卡支付需另加 3.5% 手续费，合计 $103.50）。',
        '会员资格按滚动周期计算，到期日为加入之日起满一整年。',
        '付款方式可邮寄支票（抬头写 CAACI，邮寄地址：P.O. Box 2276, Champaign, IL 61825-2136）或通过官方邮箱联络线上刷卡。商户登记请发送邮件至 caaci.org@gmail.com。',
      ],
      actionText: '申请商户入驻',
    },
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
      hours: '每日午餐 11:00 AM - 3:00 PM，晚餐正常营业',
      desc: '主打正宗地道麻辣川菜、经典传统家常菜肴，每日上午 11 点至下午 3 点提供快捷午市特惠快餐。',
      featured: true,
    },
    {
      id: 'susuru-ramen',
      name: 'Susuru Ramen 日式拉面',
      nameEn: 'Susuru Ramen',
      category: 'restaurant',
      categoryLabel: '日式拉面与料理',
      address: 'Champaign, IL',
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
      address: 'Central Illinois',
      website: 'https://financial-brilliance.com',
      desc: '专业会计与财务咨询机构，专注为个人、在美留学生学者及中小微企业提供记账报税、税务合规筹划、公司成立及 CFO 顾问服务。',
    },
    {
      id: 'american-financial-alliance',
      name: 'American Financial Alliance 美洲金融联盟',
      nameEn: 'American Financial Alliance',
      category: 'financial',
      categoryLabel: '金融咨询与财富规划',
      address: 'Central Illinois',
      desc: '面向伊利诺伊中部居民的综合财富管理机构，提供退休金规划、人寿与资产保全、教育基金配置及家庭财务战略。',
    },
    {
      id: 'jill-hess-realty',
      name: 'Jill Hess, Realtor® - RE/MAX Realty Associates',
      nameEn: 'Jill Hess, Realtor® - RE/MAX Realty Associates',
      category: 'realestate',
      categoryLabel: '房地产经纪人',
      address: 'Champaign-Urbana, IL',
      desc: '香槟 RE/MAX Realty Associates 资深持牌房产经纪，专注为本地家庭、学者及新购房者提供住宅买卖、学区房选购与全流程过户服务。',
    },
    {
      id: 'julie-woller-aaa',
      name: 'Julie Woller - AAA Insurance 保险顾问',
      nameEn: 'Julie Woller - AAA Insurance',
      category: 'realestate',
      categoryLabel: '保险代理与道路救援',
      address: 'Champaign, IL',
      phone: '(217) 351-4040',
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
      address: 'Urbana, IL',
      website: 'https://magnifyfilms.org',
      desc: '位于厄巴纳的专业商业与个人影视摄制团队，承接企业宣传视频摄制、品牌故事包装、社区庆典活动高清录制与视觉创作服务。',
    },
  ],
  events: [
    {
      id: 'job-fair',
      title: 'All-State Agencies Job Fair 全州政府机构招聘会',
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
      price: '$100',
      period: '每年',
      subtitle: 'CAACI 官方认证华人商业名录标准入驻（信用卡支付手续费后为 $103.50）。',
      features: [
        '官方网站 caaciorg.com 商业名录常年认证展示',
        '直面伊利诺伊中部广大华人家庭、留学生学者与社区读者',
        '会籍自加入之日起滚动生效整整 12 个月',
        '可邮寄支票至 P.O. Box 2276, Champaign, IL 或联络在线支付',
        '名录信息登记与对接邮箱：caaci.org@gmail.com',
      ],
      recommended: true,
    },
    {
      name: '香槟县商会小贷扶持',
      price: '最高 $15K',
      period: '最长 5 年期',
      subtitle: '香槟县商会（Champaign County Chamber）联合扶持小微企业资金。',
      features: [
        '优惠低息利率不高于 3.0%（绑定每月自动还款享 2.5% 特惠）',
        '重点扶持香槟县少数族裔与女性创业团队及小微企业',
        '需持有 EIN 税号、伊利诺伊州务卿注册良好证明及单页商业计划书',
        '商会官方联系人：Laura Weis (lauraw@champaigncounty.org / 217.359.1791)',
      ],
    },
  ],
};
