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
    communityCalendar: string;
    businessServices: string;
    login: string;
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
  };
  whyJoin: {
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
  };
  contact: {
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
  };
  modals: {
    donateTitle: string;
    donateDesc: string;
    close: string;
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
    communityCalendar: 'Community Calendar',
    businessServices: 'Business Services',
    login: 'Log In',
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
  },
  whyJoin: {
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
  },
  contact: {
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
  },
  modals: {
    donateTitle: 'Make A Donation to CAACI',
    donateDesc:
      'Your contribution supports our community festivals, educational workshops, senior assistance, and youth cultural programs. CAACI is a 501(c)(3) non-profit, so donations are tax-deductible to the extent permitted by law.',
    close: 'Close',
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
    communityCalendar: '社区日历',
    businessServices: '商业服务',
    login: '登录',
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
  },
  whyJoin: {
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
  },
  contact: {
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
  },
  modals: {
    donateTitle: '向 CAACI 捐赠支持',
    donateDesc:
      '您的捐款将直接用于资助传统文化节日、青年与老人福利项目、教育讲座与社区公共服务。CAACI 是 501(c)(3) 非营利组织，捐款可依法享受免税抵扣。',
    close: '关闭',
  },
};
