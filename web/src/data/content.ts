export interface CAACIContent {
  nav: {
    welcome: string;
    aboutUs: string;
    volunteer: string;
    donate: string;
    events: string;
    membership: string;
    account: string;
    resources: string;
    marketplace: string;
    communityCalendar: string;
    businessServices: string;
    login: string;
    /** The small line under "CAACI" beside the logo. */
    tagline: string;
    myAccount: string;
    memberPortal: string;
    signOut: string;
    /** The language button names the language it switches to. */
    langButton: string;
    langTitle: string;
    menuLabel: string;
  };
  hero: {
    title: string;
    subtitle: string;
    btnDonation: string;
    btnEvents: string;
    btnMembership: string;
  };
  welcome: {
    heading: string;
    description: string;
    aboutCta: string;
    /** The group photo beside the welcome text. */
    heroImage: string;
    heroImageAlt: string;
    heroCaption: string;
    focusLabel: string;
    focusText: string;
    regionLabel: string;
    regionText: string;
  };
  /** The thank-you shown on the home page after a finished donation. */
  home: {
    donatedTitle: string;
    donatedText: string;
  };
  /** The four pinned statements ("pillars") under the welcome. */
  stacked: {
    /** "{year}" is the current year. */
    header: string;
    /** "{current}" and "{total}" are two-digit counts. */
    progress: string;
    scrollHint: string;
    statements: {
      number: string;
      title: string;
      desc: string;
      action: string;
      /** The page the button opens: events, about, resources, membership… */
      targetPage: string;
    }[];
  };
  whyJoin: {
    eyebrow: string;
    heading: string;
    blurbs: {
      title: string;
      description: string;
    }[];
  };
  community: {
    tag: string;
    heading: string;
    description: string;
    /** The photo that scrolls behind the join card. */
    backgroundImage: string;
  };
  marketplace: {
    eyebrow: string;
    title: string;
    description: string;
    browse: string;
    more: string;
    features: { title: string; description: string }[];
    note: string;
  };
  /** The banner behind a subpage title when the page passes none. */
  subpageHero: {
    defaultBgImage: string;
  };
  contact: {
    eyebrow: string;
    photoImage: string;
    photoAlt: string;
    heading: string;
    namePlaceholder: string;
    emailPlaceholder: string;
    phonePlaceholder: string;
    messagePlaceholder: string;
    submitBtn: string;
    sending: string;
    sentTitle: string;
    sentSuccess: string;
    sendAnother: string;
    requiredError: string;
    sendFailed: string;
    networkError: string;
    addressLine1: string;
    addressLine2: string;
    email: string;
  };
  footer: {
    copyright: string;
    quickLinks: string;
    aboutText: string;
    nonProfit: string;
    facebook: string;
    tagline: string;
    contactHeading: string;
  };
  modals: {
    donateTitle: string;
    donateDesc: string;
    close: string;
    volunteerTitle: string;
    networkError: string;
    donate: {
      frequency: string;
      once: string;
      monthly: string;
      amountLabel: string;
      other: string;
      customAmountLabel: string;
      customAmountPlaceholder: string;
      nameLabel: string;
      emailLabel: string;
      minimumError: string;
      startFailed: string;
      redirecting: string;
      proceed: string;
      /** "{amount}" is the formatted dollar amount. */
      payOnce: string;
      payMonthly: string;
      secureNote: string;
    };
    volunteer: {
      intro: string;
      nameLabel: string;
      emailLabel: string;
      phoneLabel: string;
      eventQuestion: string;
      loadingEvents: string;
      anyEvent: string;
      nameEmailError: string;
      sendFailed: string;
      thanksTitle: string;
      /** "{events}" is the picked events' names joined with eventSeparator. */
      signedUp: string;
      eventSeparator: string;
      onList: string;
      confirmation: string;
      done: string;
      sending: string;
      submit: string;
    };
  };
}

export const contentEN: CAACIContent = {
  nav: {
    welcome: 'Welcome',
    aboutUs: 'About Us',
    volunteer: 'Volunteer',
    donate: 'Donate',
    events: 'Events',
    membership: 'Membership',
    account: 'Account',
    resources: 'Resources',
    marketplace: 'Illini Market',
    communityCalendar: 'Community Calendar',
    businessServices: 'Business Services',
    login: 'Log In',
    tagline: 'Central Illinois',
    myAccount: 'My Account',
    memberPortal: 'Member Portal',
    signOut: 'Sign Out',
    langButton: '中',
    langTitle: 'Switch Language / 切换语言',
    menuLabel: 'Toggle Navigation Menu',
  },
  hero: {
    title: 'Chinese American Association of Central Illinois(CAACI)',
    subtitle:
      'A not-for-profit community organization dedicated to cultural, educational, and social enrichment in Central Illinois.',
    btnDonation: 'Make A Donation',
    btnEvents: 'Check Out Events',
    btnMembership: 'Become A Member',
  },
  welcome: {
    heading: 'Welcome to the Chinese American Association of Central Illinois (CAACI) website.',
    description:
      'The Chinese American Association of Central Illinois (CAACI) is a not-for-profit, for Chinese and Chinese Americans in Central Illinois. Its goal is to engage in cultural, educational, and social activities, to help members play a more active role in the community and to promote the wellbeing of Chinese and Chinese Americans within the area. It also seeks to cultivate the Chinese people’s understanding and appreciation of Chinese culture, and to encourage communication and friendship between Chinese and other groups.',
    aboutCta: 'About Us • Our Mission & Purpose',
    heroImage: '/images/about-group.jpg',
    heroImageAlt: 'CAACI Members Group Gathering',
    heroCaption: 'CAACI Members Group Gathering · 伊利诺伊中部华人协会会员齐聚一堂',
    focusLabel: 'Community Focus',
    focusText: 'Cultural, Educational & Social Exchange',
    regionLabel: 'Region',
    regionText: 'Champaign-Urbana & Central Illinois',
  },
  home: {
    donatedTitle: 'Thank you for your donation!',
    donatedText:
      'Your payment to CAACI went through. Your gift supports our community festivals, programs, and services across Central Illinois.',
  },
  stacked: {
    header: 'CAACI · 2000 — {year}',
    progress: 'SECTION {current} OF {total}',
    scrollHint: 'Scroll down like waterfall',
    statements: [
      {
        number: '01',
        title: 'Culture & Heritage',
        desc: 'Cultivate understanding and appreciation of Chinese culture through signature festivals and heritage programs in Central Illinois.',
        action: 'See upcoming events',
        targetPage: 'events',
      },
      {
        number: '02',
        title: 'Community Wellbeing',
        desc: 'Promote the wellbeing of Chinese and Chinese Americans across Champaign-Urbana, empowering members to play an active role.',
        action: 'Our mission',
        targetPage: 'about',
      },
      {
        number: '03',
        title: 'Friendship & Dialogue',
        desc: 'Encourage meaningful communication, mutual respect, and lasting friendship between the Chinese community and diverse regional groups.',
        action: 'Browse community resources',
        targetPage: 'resources',
      },
      {
        number: '04',
        title: 'Network & Growth',
        desc: 'Provide local residents, scholars, and students with valuable opportunities to connect, share experiences, and grow together.',
        action: 'Become a member',
        targetPage: 'membership',
      },
    ],
  },
  whyJoin: {
    eyebrow: 'Why Join CAACI · 为什么加入华协',
    heading: 'Why join the Chinese American Association of Central Illinois (CAACI)?',
    blurbs: [
      {
        title: 'Networking Opportunities',
        description:
          'The Chinese American Association of Central Illinois provides local Chinese in the Champaign-Urbana area with the opportunity to network, build relationships and share experiences. Our members include residents and Chinese students, who come from all different industries, backgrounds, and different experiences. This makes it as the large Chinese community to make valuable connections and enable students’ success.',
      },
      {
        title: 'Professional Development and Exposure',
        description:
          'The Chinese American Association of Central Illinois offers our members professional development and exposure to community leaders and let the Chinese voice heard by the society. Through our educational programming and events, our members can gain insight into the latest trends, develop their professional or business skills, access family useful information and services.',
      },
      {
        title: 'Supporting Local Chinese Businesses',
        description:
          'Members enjoy free or discounted tickets for CAACI events or other community events. We also offer group discounts for shows. Our partner businesses in the mid-west from Champaign/Urbana, Chicago, Milwaukee offer shopping discounts.',
      },
      {
        title: 'Elevate the Business and Further Development',
        description:
          'Local Chinese businesses will participate the business directory, have a dedicated article about your business to increase publicity, access Chinese Chamber business management trainings and have opportunities to receive government funding and support. This will help increase revenue and elevate your business in the community.',
      },
    ],
  },
  community: {
    tag: 'Our Vibrant community',
    heading: 'Join Now',
    description:
      'Embrace the warmth of our old immigrants who are eager to lend a helping hand, ensuring your smooth settlement. In return, inspire our community by offering your invaluable expertise through the services you excel at. Together, we will create an extraordinary tapestry of growth, unity, and shared success.',
    backgroundImage: '/images/central-il.jpg',
  },
  marketplace: {
    eyebrow: 'Illini Market · Illini 集市',
    title: 'Buy, sell, and find what you need nearby.',
    description:
      'A desk for your new place. A bike you no longer use. Illini Market brings for-sale and wanted posts together for UIUC and Champaign–Urbana, so useful finds do not get lost in separate group chats.',
    browse: 'Explore Illini Market',
    more: 'Community & contact',
    features: [
      { title: 'Find it', description: 'Search listings and browse by category.' },
      { title: 'Post it', description: 'Sell an item or say what you are looking for.' },
      { title: 'Talk it through', description: 'Ask about condition and arrange pickup in chat.' },
    ],
    note: 'Opens a separate website, in English and Chinese. Posting and messaging use your Illini Market account.',
  },
  subpageHero: {
    defaultBgImage: '/images/hero-bg.jpg',
  },
  contact: {
    eyebrow: 'Get In Touch · 联络我们',
    photoImage: '/images/contact-photo.jpg',
    photoAlt: 'CAACI Community Event',
    heading: 'Get In Touch With CAACI',
    namePlaceholder: 'Name',
    emailPlaceholder: 'Email Address',
    phonePlaceholder: 'Phone Number',
    messagePlaceholder: 'Message',
    submitBtn: 'SEND',
    sending: 'SENDING...',
    sentTitle: 'Message Received!',
    sentSuccess:
      'Thank you! Your message has been sent to CAACI. We will get back to you by email.',
    sendAnother: 'Send Another Message',
    requiredError: 'Please fill in all required fields (Name, Email, Message).',
    sendFailed: 'Sorry, your message could not be sent. Please try again, or email us directly.',
    networkError: 'Network error. Please check your connection and try again.',
    addressLine1: 'P.O. Box 2276',
    addressLine2: 'Champaign, IL 61825-2136',
    email: 'caaci.org@gmail.com',
  },
  footer: {
    copyright: `© ${new Date().getFullYear()} Chinese American Association of Central Illinois (CAACI). All rights reserved.`,
    quickLinks: 'Quick Links',
    aboutText:
      'A community not-for-profit organization dedicated to fostering cultural exchange, professional development, and mutual assistance in the Champaign-Urbana area.',
    nonProfit: 'Non-Profit 501(c)(3)',
    facebook: 'CAACI on Facebook',
    tagline: 'Serving Champaign, Urbana, Savoy, and the greater Central Illinois area since 2000.',
    contactHeading: 'Contact',
  },
  modals: {
    donateTitle: 'Make A Donation to CAACI',
    donateDesc:
      'Your contribution supports our community festivals, educational workshops, senior assistance, and youth cultural programs. CAACI is a 501(c)(3) non-profit, so donations are tax-deductible to the extent permitted by law.',
    close: 'Close',
    volunteerTitle: 'Volunteer with CAACI',
    networkError: 'Network error. Please check your connection and try again.',
    donate: {
      frequency: 'Frequency',
      once: 'One-time',
      monthly: 'Monthly',
      amountLabel: 'Select Donation Amount',
      other: 'Other',
      customAmountLabel: 'Enter Amount ($USD)',
      customAmountPlaceholder: 'e.g. 150',
      nameLabel: 'Name (optional)',
      emailLabel: 'Email (optional)',
      minimumError: 'Minimum donation is $1.',
      startFailed: 'Could not start the donation. Please try again.',
      redirecting: 'Redirecting to Stripe…',
      proceed: 'Proceed with Donation',
      payOnce: 'Donate {amount}',
      payMonthly: 'Donate {amount} / month',
      secureNote: 'Secure checkout on Stripe. We never see your card details.',
    },
    volunteer: {
      intro:
        'Join our enthusiastic volunteer team! Opportunities include event coordination, stage management, translation, graphic design, and senior support.',
      nameLabel: 'Your Name',
      emailLabel: 'Your Email',
      phoneLabel: 'Phone (optional)',
      eventQuestion: 'Is this for a particular event?',
      loadingEvents: 'Loading events…',
      anyEvent: 'Any event / wherever needed',
      nameEmailError: 'Please enter your name and email.',
      sendFailed: 'Sorry, your sign-up could not be sent. Please try again.',
      thanksTitle: 'Thank You for Volunteering!',
      signedUp:
        "You're signed up to help with {events}. We'll be in touch by email before the event.",
      eventSeparator: ', ',
      onList: "You're on our volunteer list. We'll be in touch by email when we need a hand.",
      confirmation: 'A confirmation has been emailed to you.',
      done: 'Done',
      sending: 'Sending…',
      submit: 'Sign Up to Volunteer',
    },
  },
};

export const contentZH: CAACIContent = {
  nav: {
    welcome: '首页',
    aboutUs: '关于我们',
    volunteer: '志愿者',
    donate: '捐赠支持',
    events: '近期活动',
    membership: '会员专区',
    account: '个人账户',
    resources: '社区资源',
    marketplace: 'Illini 集市',
    communityCalendar: '社区日历',
    businessServices: '商业服务',
    login: '登录',
    tagline: '伊利诺伊中部',
    myAccount: '我的账户',
    memberPortal: '会员中心',
    signOut: '退出登录',
    langButton: 'En',
    langTitle: 'Switch Language / 切换语言',
    menuLabel: 'Toggle Navigation Menu',
  },
  hero: {
    title: '伊利诺伊中部华人协会 (CAACI)',
    subtitle: '服务伊利诺伊中部华人与华裔社区的非营利性公益组织，致力于文化、教育和社交活动。',
    btnDonation: '捐赠支持',
    btnEvents: '近期活动',
    btnMembership: '成为会员',
  },
  welcome: {
    heading: '欢迎参观伊利诺伊中部华人协会网站',
    description:
      '伊利诺伊中部华人协会（CAACI）是一家面向伊利诺伊中部华人及华裔的非营利组织。其宗旨是开展文化、教育和社交活动，帮助会员在社区中发挥更积极的作用，促进该地区华人及华侨同胞的福祉。协会还致力于培养对中华文化的理解与欣赏，促进华人与其他族群之间的交流与友谊。',
    aboutCta: '关于我们 • 我们的使命与宗旨',
    heroImage: '/images/about-group.jpg',
    heroImageAlt: 'CAACI Members Group Gathering',
    heroCaption: 'CAACI Members Group Gathering · 伊利诺伊中部华人协会会员齐聚一堂',
    focusLabel: '社区宗旨',
    focusText: '文化、教育与社交交流',
    regionLabel: '服务地区',
    regionText: '香槟-厄巴纳及伊利诺伊中部',
  },
  home: {
    donatedTitle: '感谢您的慷慨捐赠！',
    donatedText:
      '您对华人协会的捐款已支付成功，将用于支持协会在伊利诺伊中部的节庆活动、社区项目与公共服务。',
  },
  stacked: {
    header: 'CAACI · 2000 — {year}',
    progress: 'SECTION {current} OF {total}',
    scrollHint: '向下滚动 · 如瀑布流般连贯切换',
    statements: [
      {
        number: '01',
        title: '文化传承 · 华夏精粹',
        desc: '开展丰富多彩的传统节庆与文化交流活动，培养对中华文化的理解与欣赏，让华夏文化在伊利诺伊中部生生不息。',
        action: '查看近期活动',
        targetPage: 'events',
      },
      {
        number: '02',
        title: '同胞福祉 · 社区发声',
        desc: '促进伊利诺伊中部华人及华侨同胞的福祉，帮助会员在社区中发挥更积极的作用，让主流社会听见华人的声音。',
        action: '了解宗旨与使命',
        targetPage: 'about',
      },
      {
        number: '03',
        title: '族群友谊 · 交流共融',
        desc: '积极搭建跨文化沟通桥梁，促进华人与其他族群之间的深入交流与真挚友谊，构筑多元包容的和谐社区。',
        action: '浏览社区资源',
        targetPage: 'resources',
      },
      {
        number: '04',
        title: '互助网络 · 携手前行',
        desc: '为香槟-厄巴纳及周边地区的居民、学者与留学生提供结识良友、交流经验与支持本地商户的平台，携手共创繁荣。',
        action: '成为协会会员',
        targetPage: 'membership',
      },
    ],
  },
  whyJoin: {
    eyebrow: 'Why Join CAACI · 为什么加入华协',
    heading: '为什么加入伊利诺伊州中部华人协会？',
    blurbs: [
      {
        title: '社交与交流机会',
        description:
          '伊利诺伊中部华人协会为香槟-厄巴纳（Champaign-Urbana）地区的华人提供了建立联系、交流经验与拓展社交网络的重要平台。我们的会员涵盖居民、学者与留学生，来自各行各业，拥有多元背景与丰富经历，汇聚成强大的华人互助网络。',
      },
      {
        title: '职业发展与社会发声',
        description:
          '协会为会员提供职业成长空间以及与社区领袖面对面交流的机会，让主流社会听见华人的声音。通过我们的教育讲座与活动，会员能够洞悉行业前沿动态，提升专业素养与商业技能，并获取丰富的家庭生活与本地服务资讯。',
      },
      {
        title: '支持本地华人商户',
        description:
          'CAACI 会员可享受协会各类文化及社区活动的免费或折扣门票，以及文艺演出的团购优惠。我们遍布香槟/厄巴纳、芝加哥、密尔沃基等美中地区的多家合作商家还为会员提供专享消费折扣。',
      },
      {
        title: '商业评估与拓展机遇',
        description:
          '本地华人商企可加入协会商家名录，获得专属专访报道以提升知名度，参与华商管理培训课程，并享有申请政府扶持基金与资源的指导机会，助力商企提高收益并在社区树立卓越声誉。',
      },
    ],
  },
  community: {
    tag: '充满活力的社区',
    heading: '现在就加入我们',
    description:
      '体验早期移民的热情，他们热切希望伸出援手，确保您顺利定居。作为回报，您可以通过自己擅长的服务，提供宝贵的专业知识，从而激励我们的社区。我们将携手共创一个成长、团结并共享成功的非凡社区。',
    backgroundImage: '/images/central-il.jpg',
  },
  marketplace: {
    eyebrow: 'Illini Market · Illini 集市',
    title: '附近的闲置，和你正在找的东西。',
    description:
      '刚搬家想找张桌子，或是有辆闲置自行车？Illini 集市把 UIUC 和香槟–厄巴纳的出售、求购信息放在一起，不用再挨个翻找不同的微信群。',
    browse: '逛逛 Illini 集市',
    more: '社区与联系',
    features: [
      { title: '找一找', description: '搜索商品，按分类浏览附近的闲置。' },
      { title: '发一条', description: '发布出售，或说说你想求购什么。' },
      { title: '聊清楚', description: '私信确认成色、尺寸，再约好取货。' },
    ],
    note: '将在独立网站打开，中英文均可；发布和私信使用 Illini 集市账号。',
  },
  subpageHero: {
    defaultBgImage: '/images/hero-bg.jpg',
  },
  contact: {
    eyebrow: 'Get In Touch · 联络我们',
    photoImage: '/images/contact-photo.jpg',
    photoAlt: 'CAACI Community Event',
    heading: '欢迎联系华人协会',
    namePlaceholder: '姓名',
    emailPlaceholder: '电子邮箱',
    phonePlaceholder: '电话号码',
    messagePlaceholder: '留言内容',
    submitBtn: '发送留言',
    sending: '发送中...',
    sentTitle: '留言已收到！',
    sentSuccess: '非常感谢！您的留言已发送给华人协会，我们会通过邮件回复您。',
    sendAnother: '再发一条留言',
    requiredError: '请填写所有必填项（姓名、电子邮箱、留言内容）。',
    sendFailed: '抱歉，留言发送失败。请重试，或直接发邮件联系我们。',
    networkError: '网络错误，请检查网络连接后重试。',
    addressLine1: 'P.O. Box 2276',
    addressLine2: 'Champaign, IL 61825-2136',
    email: 'caaci.org@gmail.com',
  },
  footer: {
    copyright: `© ${new Date().getFullYear()} 伊利诺伊中部华人协会 (CAACI). 版权所有.`,
    quickLinks: '快捷导航',
    aboutText:
      '致力于在香槟-厄巴纳地区促进中华文化交流、专业职业发展与华人同胞互助共荣的非营利性社区组织。',
    nonProfit: '501(c)(3) 非营利组织',
    facebook: 'CAACI Facebook 主页',
    tagline: 'Serving Champaign, Urbana, Savoy, and the greater Central Illinois area since 2000.',
    contactHeading: 'Contact',
  },
  modals: {
    donateTitle: '向 CAACI 捐赠支持',
    donateDesc:
      '您的捐款将直接用于资助传统文化节日、青年与老人福利项目、教育讲座与社区公共服务。CAACI 是 501(c)(3) 非营利组织，捐款可依法享受免税抵扣。',
    close: '关闭',
    volunteerTitle: '加入 CAACI 志愿者',
    networkError: '网络错误，请检查网络连接后重试。',
    donate: {
      frequency: '捐款频率',
      once: '一次性',
      monthly: '每月',
      amountLabel: '选择捐款金额',
      other: '其它',
      customAmountLabel: '输入金额 ($美元)',
      customAmountPlaceholder: '例如 150',
      nameLabel: '姓名（选填）',
      emailLabel: '电子邮箱（选填）',
      minimumError: '最低捐款金额为 $1。',
      startFailed: '无法发起捐款，请重试。',
      redirecting: '正在跳转至 Stripe…',
      proceed: '确认捐赠',
      payOnce: '捐赠 {amount}',
      payMonthly: '每月捐赠 {amount}',
      secureNote: '由 Stripe 安全处理付款，我们不会接触您的银行卡信息。',
    },
    volunteer: {
      intro:
        '加入我们充满活力的志愿者团队！服务内容涵盖活动现场协调、舞台管理、中英翻译、平面设计与长者关怀等。',
      nameLabel: '姓名',
      emailLabel: '电子邮箱',
      phoneLabel: '电话（选填）',
      eventQuestion: '是为某场具体活动报名志愿者吗？',
      loadingEvents: '正在加载活动…',
      anyEvent: '任何活动均可',
      nameEmailError: '请填写姓名和电子邮箱。',
      sendFailed: '抱歉，报名信息发送失败，请重试。',
      thanksTitle: '感谢您支持社区志愿服务！',
      signedUp: '您已报名参与「{events}」的志愿服务，活动前我们会通过邮件与您联系。',
      eventSeparator: '、',
      onList: '您已加入志愿者名单，需要帮手时我们会通过邮件与您联系。',
      confirmation: '确认邮件已发送到您的邮箱。',
      done: '完成',
      sending: '发送中…',
      submit: '报名成为志愿者',
    },
  },
};
