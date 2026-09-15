// Events page copy. Upcoming events are not listed here: they are the published
// rows of public.events (the admin panel's Events tab), read by useEvents.ts.
// `past` is the static archive shown under "Past Events" (#past).
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
  past: {
    id: string;
    title: string;
    date: string;
    isoDate: string;
    time: string;
    location: string;
    desc: string;
    organizer: string;
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
  upcomingSubtitle: "Join us at CAACI's upcoming celebrations and community gatherings.",
  pastTitle: 'Past Events & Historical Highlights',
  pastSubtitle:
    'A retrospective archive of our community galas, general assemblies, and milestone gatherings.',
  past: [
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
  upcomingSubtitle: '欢迎报名参加华协即将举办的节庆与社区活动。',
  pastTitle: '往期活动与历史档案',
  pastSubtitle: '回顾伊利诺伊中部华人协会历年举办的精彩节庆典礼、全员代表大会与里程碑事件。',
  past: [
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
