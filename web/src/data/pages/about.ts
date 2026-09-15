export interface AboutContent {
  title: string;
  subtitle: string;
  missionTitle: string;
  missionText: string;
  valuesTitle: string;
  values: { title: string; desc: string }[];
  howWeDoItTitle: string;
  howWeDoItText: string;
  yearInReviewTitle: string;
  yearInReviewVideoId: string;
  managementTitle: string;
  managementSubtitle: string;
  team: { role: string; name: string; desc: string }[];
  pastPresidentsTitle: string;
  pastPresidentsSubtitle: string;
  pastPresidents: { year: string; name: string }[];
}

export const aboutDataEN: AboutContent = {
  title: 'About Us',
  subtitle:
    'Serving the Chinese and Chinese American community in Central Illinois for over two decades.',
  missionTitle: 'OUR MISSION',
  missionText:
    'Our Mission is to help members play a more active role in the community and to promote the wellbeing of Chinese and Chinese Americans within the area.',
  valuesTitle: 'Our Core Values',
  values: [
    {
      title: 'United',
      desc: 'Bringing together students, scholars, professionals, and families across Central Illinois.',
    },
    {
      title: 'Helping Each Other',
      desc: 'Sharing life experiences, business opportunities, and mutual support across generations.',
    },
    {
      title: 'Inclusive',
      desc: 'Welcoming everyone who shares an appreciation for Chinese culture and community fellowship.',
    },
  ],
  howWeDoItTitle: 'How We Do It',
  howWeDoItText:
    'To engage in cultural, educational, and social activities among all the Chinese within the area. The CAACI’s annual events include celebrations for the Chinese New Year’s, Dragon Boat Festival, Mid-Autumn Festival, workshops, forums, and educational activities throughout the year.',
  yearInReviewTitle: '2024-2025 Year in Review',
  yearInReviewVideoId: 'Lk6pZymzciE',
  managementTitle: 'Structure of the CAACI Management',
  managementSubtitle:
    'The president of CAACI works with dedicated board members, community agencies, advisory groups, and student leaders.',
  team: [
    {
      role: 'President',
      name: 'Ying Man Tang',
      desc: 'Lead CAACI, set directions for the association, coordinate multiple community agencies, centers, advisory groups, and student engagement.',
    },
    {
      role: 'Past President / Ex Officio',
      name: 'Helen Zhang',
      desc: 'Providing seasoned institutional guidance, continuity, and advisory support.',
    },
    {
      role: 'Treasurer',
      name: 'Hui Min Zhang',
      desc: 'Manage accounting, financial and tax reporting, collections, and vendor invoice management.',
    },
    {
      role: 'Secretary',
      name: 'Lieli Ye',
      desc: 'Record board meetings, coordinate director communications, and manage Chinese informational announcements.',
    },
    {
      role: 'Culture Director',
      name: 'Wesley Lu',
      desc: 'Promote Chinese heritage, coordinate cultural performances, and manage community educational programs.',
    },
    {
      role: 'Communications Director',
      name: 'Bo Liu',
      desc: 'Publish monthly e-newsletters, manage social media channels, and oversee community public relations.',
    },
    {
      role: 'Membership Director & Cashier',
      name: 'Charlene Pan',
      desc: 'Recruit and register members, manage membership records, and handle fee receipts.',
    },
    {
      role: 'Technology & AI Director',
      name: 'Jiachen Tu',
      desc: 'Oversee digital infrastructure, website management, and modern AI tool integration.',
    },
    {
      role: 'Student Engagement Director',
      name: 'TBD',
      desc: 'Liaison between resident community members and Chinese Student and Scholar Association (CSSA) leaders.',
    },
  ],
  pastPresidentsTitle: 'Honorary Past Presidents of CAACI',
  pastPresidentsSubtitle:
    'For over 23 years, the Chinese American Association of Central Illinois has flourished through the visionary volunteer leadership of our past presidents.',
  pastPresidents: [
    { year: '2000', name: 'Shau-Jin Chang' },
    { year: '2001', name: 'Mankin Mak' },
    { year: '2002', name: 'Ruth C. King' },
    { year: '2003', name: 'Kai-Wing Chow' },
    { year: '2004', name: 'Kong-Ling Yang' },
    { year: '2005', name: 'James Liaw' },
    { year: '2006', name: 'Kam Wong' },
    { year: '2007', name: 'Mei-In Melissa Chou' },
    { year: '2008', name: 'Yi-Kwei Wen' },
    { year: '2009', name: 'Lydia L. H. Huang' },
    { year: '2010', name: 'Yu Wang' },
    { year: '2011', name: 'Da Fei Chen' },
    { year: '2012', name: 'Wen Xin Zhang' },
    { year: '2013-2023', name: 'Helen Zhang' },
    { year: 'Present', name: 'Ying Man Tang' },
  ],
};

export const aboutDataZH: AboutContent = {
  title: '关于我们',
  subtitle: '二十余载携手同行，深耕伊利诺伊中部华人与华裔社区。',
  missionTitle: '我们的使命与宗旨',
  missionText:
    '我们的使命是帮助会员在社区中扮演更积极的角色，并全面提升该地区华人及华裔美国人的福祉与发展权益。',
  valuesTitle: '我们的核心价值观',
  values: [
    { title: '团结', desc: '紧密联结香槟-厄巴纳及周边各郡的学生、学者、专业人士与华人家庭。' },
    { title: '互相帮助', desc: '老移民帮扶新定居者，各行各业守望相助，携手共同繁荣发展。' },
    { title: '包容性', desc: '拥抱多元背景与文化，促进华人与其他族裔群体的友好交流与理解。' },
  ],
  howWeDoItTitle: '实现途径与活动开展',
  howWeDoItText:
    '广泛参与该地区华人的文化、教育和社会活动。CAACI的标志性年度盛事包括庆祝农历新春晚会、端午传统聚会、中秋文化灯会，以及常年举办的职业研讨会、法务讲座、商贸论坛与亲子教育活动。',
  yearInReviewTitle: '2024-2025 年度精彩回顾',
  yearInReviewVideoId: 'Lk6pZymzciE',
  managementTitle: 'CAACI 理事会与管理架构',
  managementSubtitle: 'CAACI 主席与全体理事、社区机构、顾问团队以及青年学生领袖密切协作。',
  team: [
    {
      role: '主席',
      name: 'Ying Man Tang',
      desc: '全面领导 CAACI，制定协会战略发展方向，统筹协调政府机构、社区中心、咨询智囊团及青年学生工作。',
    },
    {
      role: '前任主席 / 当然理事',
      name: 'Helen Zhang',
      desc: '为协会提供资深顾问支持、制度传承与跨机构联络。',
    },
    {
      role: '财务主管',
      name: 'Hui Min Zhang',
      desc: '负责财务会计核算、非营利组织税务申报、资金收支与票据凭证合规管理。',
    },
    {
      role: '秘书长',
      name: 'Lieli Ye',
      desc: '记录董事会重要决策，协调理事工作日程，审核并发布中文官方公告与资讯。',
    },
    {
      role: '文化总监',
      name: 'Wesley Lu',
      desc: '弘扬中华优秀传统文化，策划大型文艺演出与中华民俗文化体验项目。',
    },
    {
      role: '传媒总监',
      name: 'Bo Liu',
      desc: '编辑每月官方电子简报，运营社交媒体矩阵与网站公关宣传。',
    },
    {
      role: '会员总监及出纳',
      name: 'Charlene Pan',
      desc: '会员招募、会员信息库档案维护、会费收缴管理与专属权益发放。',
    },
    {
      role: '科技与 AI 总监',
      name: 'Jiachen Tu',
      desc: '负责数字化网络基础设施、网站运维与现代 AI 智能赋能服务。',
    },
    {
      role: '学生互动总监',
      name: '待定 (TBD)',
      desc: '作为华人居民与伊利诺伊大学中国学生学者联谊会 (CSSA) 的联络桥梁。',
    },
  ],
  pastPresidentsTitle: '华协历任荣誉主席',
  pastPresidentsSubtitle:
    '23年来，中伊利诺伊州华人协会（CAACI）一直致力于弘扬中华文化，促进当地华人和华裔美国人的和谐发展。前任主席热忱奉献，为社区筑牢坚实基石。',
  pastPresidents: [
    { year: '2000', name: 'Shau-Jin Chang' },
    { year: '2001', name: 'Mankin Mak' },
    { year: '2002', name: 'Ruth C. King' },
    { year: '2003', name: 'Kai-Wing Chow' },
    { year: '2004', name: 'Kong-Ling Yang' },
    { year: '2005', name: 'James Liaw' },
    { year: '2006', name: 'Kam Wong' },
    { year: '2007', name: 'Mei-In Melissa Chou' },
    { year: '2008', name: 'Yi-Kwei Wen' },
    { year: '2009', name: 'Lydia L. H. Huang' },
    { year: '2010', name: 'Yu Wang' },
    { year: '2011', name: 'Da Fei Chen' },
    { year: '2012', name: 'Wen Xin Zhang' },
    { year: '2013-2023', name: 'Helen Zhang' },
    { year: '现任', name: 'Ying Man Tang' },
  ],
};
