export interface EventsContent {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  filterAll: string;
  filterUpcoming: string;
  filterPast: string;
  upcomingTitle: string;
  upcomingSubtitle: string;
  pastTitle: string;
  pastSubtitle: string;
  items: {
    id: string;
    title: string;
    date: string;
    isoDate: string;
    time: string;
    location: string;
    desc: string;
    organizer: string;
    isFeatured?: boolean;
    category?: 'job' | 'culture' | 'governance' | 'community';
    recapSummary?: string;
  }[];
}

export const eventsDataEN: EventsContent = {
  title: 'Events & Community Happenings',
  subtitle:
    'Discover cultural celebrations, professional workshops, job fairs, and social gatherings hosted by CAACI.',
  searchPlaceholder: 'Search events by keyword, location, or topic...',
  filterAll: 'All Events',
  filterUpcoming: 'Upcoming Events',
  filterPast: 'Past Highlights',
  upcomingTitle: 'Upcoming Events & Gatherings',
  upcomingSubtitle:
    'Join us for upcoming cultural celebrations, seminars, and networking sessions in Central Illinois.',
  pastTitle: 'Past Events & Historical Highlights',
  pastSubtitle:
    'A retrospective archive of our community galas, general assemblies, and milestone gatherings.',
  items: [
    {
      id: 'mid-autumn',
      title: 'Mid-Autumn Cultural Festival & Lantern Gala',
      date: 'September 20, 2026',
      isoDate: '2026-09-20',
      time: '5:30 PM - 8:30 PM',
      location: 'Champaign Public Library & Community Pavilion',
      desc: 'Celebrate the harvest moon with traditional mooncake tasting, Chinese folk music and dance performances, lantern riddles, and family crafting activities.',
      organizer: 'CAACI Culture Committee',
      isFeatured: true,
      category: 'culture',
    },
    {
      id: 'mentorship-forum',
      title: 'Career Mentorship & Chamber Networking Seminar',
      date: 'November 14, 2026',
      isoDate: '2026-11-14',
      time: '6:30 PM - 8:30 PM',
      location: 'UIUC Research Park Innovation Hub',
      desc: 'Connect with Chinese American executives and business founders in Central Illinois. Topics cover tech leadership, biotech entrepreneurship, and local market growth.',
      organizer: 'CAACI Business & Professional Group',
      category: 'job',
    },
    {
      id: 'cny-gala',
      title: 'Annual Chinese New Year Celebration Gala 2027',
      date: 'January 28, 2027',
      isoDate: '2027-01-28',
      time: '6:00 PM - 9:30 PM',
      location: 'Krannert Center for the Performing Arts, Urbana',
      desc: 'Our marquee annual banquet and cultural performance featuring dragon dance, martial arts, opera, youth scholarship presentations, and community awards.',
      organizer: 'CAACI Executive Board',
      isFeatured: true,
      category: 'culture',
    },
    {
      id: 'cny-gala-2026',
      title: '2026 Spring Festival Gala 农历丙午新春文艺晚会',
      date: 'February 14, 2026',
      isoDate: '2026-02-14',
      time: '6:00 PM - 9:30 PM',
      location: 'Krannert Center for the Performing Arts, Urbana',
      desc: 'Celebrated the Year of the Horse with over 800 community members, featuring dazzling youth performances, traditional culinary treats, and community service awards.',
      organizer: 'CAACI Executive Committee',
      category: 'culture',
      recapSummary: '800+ attendees · 18 stage performances · Community service honors',
    },
    {
      id: 'job-fair',
      title: 'All-State Agencies Job Fair 全州政府机构招聘会',
      date: 'October 26, 2025',
      isoDate: '2025-10-26',
      time: '8:00 AM - 5:00 PM',
      location: 'Champaign-Urbana Public Conference Center',
      desc: 'Hosted jointly by the Illinois Department of Public Health (IDPH) and the Chinese American Association of Central Illinois (CAACI). Meet state agency recruiters, explore civil service career paths, and receive on-site resume guidance.',
      organizer: 'IDPH & CAACI',
      category: 'job',
      recapSummary: '450+ attendees · 14 state agencies represented · 65 on-site interviews',
    },
    {
      id: 'rules-meeting',
      title: 'Proposed New Systems of the Chinese American Association of Central Illinois (CAACI)',
      date: 'June 8, 2025',
      isoDate: '2025-06-08',
      time: '8:00 AM - 5:00 PM',
      location: 'CAACI Community Hub & Virtual Zoom',
      desc: 'Official discussion and member voting on administrative rules, Honorary President System, Senior Advisor System, and Honorary Member System under the CAACI By-Laws.',
      organizer: 'CAACI Board of Directors',
      category: 'governance',
      recapSummary: 'By-laws ratified · Honorary President & Senior Advisor systems adopted',
    },
    {
      id: 'dragon-boat-2025',
      title: 'Dragon Boat Cultural Picnic & Zongzi Workshop',
      date: 'May 31, 2025',
      isoDate: '2025-05-31',
      time: '11:00 AM - 3:00 PM',
      location: 'Crystal Lake Park, Urbana',
      desc: 'Community outdoor gathering featuring handmade traditional zongzi wrapping demonstrations, folk games, and lakeside family picnic.',
      organizer: 'CAACI Culture Committee',
      category: 'culture',
      recapSummary: '300+ community members joined · 1,000+ handmade zongzi shared',
    },
  ],
};

export const eventsDataZH: EventsContent = {
  title: '社区近期与往期活动',
  subtitle: '浏览 CAACI 主办的中华传统文化节庆、职业讲座、政府招聘会与社区联谊活动。',
  searchPlaceholder: '输入关键词、地点或主题搜索活动...',
  filterAll: '全部活动',
  filterUpcoming: '近期活动',
  filterPast: '往期回顾',
  upcomingTitle: '近期活动与社区日程',
  upcomingSubtitle: '欢迎报名参与即将举办的传统节日盛宴、政务招聘交流与职业导师讲座。',
  pastTitle: '往期活动与历史档案',
  pastSubtitle: '回顾伊利诺伊中部华人协会历年举办的精彩节庆典礼、全员代表大会与里程碑事件。',
  items: [
    {
      id: 'mid-autumn',
      title: '中秋传统文化节与赏月游园灯会',
      date: '2026 年 9 月 20 日',
      isoDate: '2026-09-20',
      time: '下午 5:30 - 晚上 8:30',
      location: '香槟市立公共图书馆及社区草坪广场',
      desc: '月圆中秋，阖家团聚。品尝各式传统广式与苏式月饼、欣赏中华民乐合奏与古典舞、参与中秋猜灯谜与儿童手工制作玉兔花灯。',
      organizer: 'CAACI 文化委员会',
      isFeatured: true,
      category: 'culture',
    },
    {
      id: 'mentorship-forum',
      title: '青年职业发展与香槟商会创业导师论坛',
      date: '2026 年 11 月 14 日',
      isoDate: '2026-11-14',
      time: '晚上 6:30 - 8:30',
      location: 'UIUC 科技研究园创新中心',
      desc: '邀请美中地区杰出华裔科学家、科技创业者及资深经理人分享行业洞察，助力留学生与青年学者顺利迈向职场巅峰。',
      organizer: 'CAACI 商务与职业发展工作组',
      category: 'job',
    },
    {
      id: 'cny-gala',
      title: '2027 CAACI 农历新春联欢晚会',
      date: '2027 年 1 月 28 日',
      isoDate: '2027-01-28',
      time: '晚上 6:00 - 9:30',
      location: '厄巴纳 Krannert 演艺中心',
      desc: '协会年度最为盛大的标志性迎春文艺晚会，涵盖舞龙舞狮、武术展示、京剧民谣、优秀华裔青年奖学金颁奖典礼与新春千人团拜会。',
      organizer: 'CAACI 执行理事会',
      isFeatured: true,
      category: 'culture',
    },
    {
      id: 'cny-gala-2026',
      title: '2026 CAACI 农历丙午新春文艺晚会',
      date: '2026 年 2 月 14 日',
      isoDate: '2026-02-14',
      time: '晚上 6:00 - 9:30',
      location: '厄巴纳 Krannert 演艺中心',
      desc: '喜迎马年新春，八百余位各界华人华侨与国际友人欢聚一堂，奉献了舞龙、戏曲与民乐盛宴，并表彰了年度杰出社区义工。',
      organizer: 'CAACI 执行理事会',
      category: 'culture',
      recapSummary: '800余位观众到场 · 18个高水准节目 · 颁发年度优秀社区服务奖',
    },
    {
      id: 'job-fair',
      title: 'All-State Agencies Job Fair 全州政府机构招聘会',
      date: '2025 年 10 月 26 日',
      isoDate: '2025-10-26',
      time: '上午 8:00 - 下午 5:00',
      location: '香槟-厄巴纳公共会议中心',
      desc: '由伊利诺伊州公共卫生部（IDPH）与中伊利诺伊华人协会（CAACI）联合主办。汇聚全州多个重要政府部门招聘专员，提供面对面咨询、公共服务职业晋升指导及现场简历辅导。',
      organizer: 'IDPH 与 CAACI 联合主办',
      category: 'job',
      recapSummary: '450+ 参与者 · 14 家州政府直属部门 · 现场进行 65 场求职咨询',
    },
    {
      id: 'rules-meeting',
      title: '伊利诺伊州中部美国华人协会提议新制度全员大会',
      date: '2025 年 6 月 8 日',
      isoDate: '2025-06-08',
      time: '上午 8:00 - 下午 5:00',
      location: 'CAACI 社区中心与 Zoom 线上同步',
      desc: '根据《伊利诺伊州中部美国华人协会章程》（BY-LAWS）起草并审议《管理细则》，设立名誉主席制度、高级顾问制度与荣誉会员制度，规范会员管理与权益保障。',
      organizer: 'CAACI 理事会',
      category: 'governance',
      recapSummary: '全票通过协会管理细则 · 确立名誉主席与高级顾问制度',
    },
    {
      id: 'dragon-boat-2025',
      title: '端午民俗文化野餐会与手工包粽工坊',
      date: '2025 年 5 月 31 日',
      isoDate: '2025-05-31',
      time: '上午 11:00 - 下午 3:00',
      location: '厄巴纳 Crystal Lake 公园',
      desc: '仲夏端午，协会组织会员与社区居民包粽子、品香茗、赛民俗，在湖畔享受阳光、绿树与传统中华美食。',
      organizer: 'CAACI 文化委员会',
      category: 'culture',
      recapSummary: '300+ 社区家庭欢聚 · 亲手包制超过 1,000 只甜咸香粽',
    },
  ],
};
