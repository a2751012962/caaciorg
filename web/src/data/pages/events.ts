// Events page copy. Upcoming events are not listed here: they are the published
// rows of public.events (the admin panel's Events tab), read by useEvents.ts.
// `past` is the static archive shown under "Past Events" (#past).
export interface EventsContent {
  title: string;
  subtitle: string;
  heroImage: string;
  searchPlaceholder: string;
  filterAll: string;
  filterUpcoming: string;
  filterPast: string;
  upcomingTitle: string;
  upcomingSubtitle: string;
  pastTitle: string;
  pastSubtitle: string;
  // The organizer chip on every upcoming event (events carry no organizer column).
  organizer: string;
  spotlight: { badge: string };
  toolbar: {
    eyebrow: string;
    heading: string;
    tabsLabel: string;
    tabAll: string;
    tabUpcoming: string;
    tabPast: string;
    clearSearch: string;
    search: string;
    closeSearch: string;
    sortTitle: string;
    sortAsc: string;
    sortDesc: string;
    sortAscShort: string;
    sortDescShort: string;
  };
  // Category filter pills; `id` matches the event's category, 'all' shows everything.
  categories: { id: string; label: string }[];
  actions: {
    register: string;
    registerNow: string;
    rsvp: string;
    rsvpFull: string;
    saving: string;
    confirmed: string;
    confirmedFull: string;
    volunteerShort: string;
    volunteer: string;
    share: string;
    shareTitle: string;
    copied: string;
    linkCopied: string;
    copyPrompt: string;
  };
  // What the RSVP call said, under the event.
  notes: {
    rsvpAlready: string;
    rsvpDone: string;
    errorNetwork: string;
    errorClosed: string;
    errorFailed: string;
  };
  upcomingMessages: {
    loading: string;
    error: string;
    retry: string;
    empty: string;
    noMatch: string;
    resetFilters: string;
    jumpToPast: string;
  };
  pastLabels: {
    jumpToUpcoming: string;
    empty: string;
    recap: string;
    feedback: string;
    feedbackTitle: string;
    volunteer: string;
    volunteerArchive: string;
    shareTitle: string;
    // Pre-filled into the contact form; {title} is the past event's title.
    feedbackPrefill: string;
    // Shown on a past event by its category; any other category uses `governance`.
    categories: { culture: string; job: string; governance: string };
  };
  // Twelve month names for the date box of the past archive, January first.
  months: string[];
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
  heroImage: '/images/hero-bg.jpg',
  searchPlaceholder: 'Search events by keyword, location, or topic...',
  filterAll: 'All Events',
  filterUpcoming: 'Upcoming Events',
  filterPast: 'Past Highlights',
  upcomingTitle: 'Upcoming Events & Gatherings',
  upcomingSubtitle: "Join us at CAACI's upcoming celebrations and community gatherings.",
  pastTitle: 'Past Events & Historical Highlights',
  pastSubtitle:
    'A retrospective archive of our community galas, general assemblies, and milestone gatherings.',
  organizer: 'CAACI',
  spotlight: { badge: 'Upcoming Spotlight' },
  toolbar: {
    eyebrow: 'Schedule & Archive',
    heading: 'Explore CAACI Events',
    tabsLabel: 'Show events',
    tabAll: 'All',
    tabUpcoming: 'Upcoming',
    tabPast: 'Past',
    clearSearch: 'Clear search',
    search: 'Search',
    closeSearch: 'Close Search',
    sortTitle: 'Toggle date sort order',
    sortAsc: 'Date: Ascending',
    sortDesc: 'Date: Descending',
    sortAscShort: 'Asc',
    sortDescShort: 'Desc',
  },
  categories: [
    { id: 'all', label: 'All Categories' },
    { id: 'culture', label: 'Cultural Galas' },
    { id: 'job', label: 'Career & Professional' },
    { id: 'governance', label: 'Civic & Meetings' },
  ],
  actions: {
    register: 'Register',
    registerNow: 'Register Now',
    rsvp: 'RSVP',
    rsvpFull: 'RSVP for Admission',
    saving: 'Saving…',
    confirmed: 'Confirmed',
    confirmedFull: 'RSVP Confirmed',
    volunteerShort: 'Volunteer',
    volunteer: 'Volunteer',
    share: 'Share',
    shareTitle: 'Share event',
    copied: 'Copied',
    linkCopied: 'Link Copied',
    copyPrompt: 'Copy this link:',
  },
  notes: {
    rsvpAlready: 'You had already RSVPed for this event.',
    rsvpDone: 'RSVP confirmed. See you there!',
    errorNetwork: 'Network error. Please check your connection and try again.',
    errorClosed: 'This event is no longer taking RSVPs.',
    errorFailed: 'Your RSVP could not be saved. Please try again.',
  },
  upcomingMessages: {
    loading: 'Loading upcoming events…',
    error: 'We couldn’t load upcoming events.',
    retry: 'Try again',
    empty: 'No upcoming events are scheduled right now. Please check back soon.',
    noMatch: 'No upcoming events found matching your criteria.',
    resetFilters: 'Reset search filters',
    jumpToPast: 'Jump to Past Archive',
  },
  pastLabels: {
    jumpToUpcoming: 'Jump back to upcoming',
    empty: 'No past events found matching your criteria.',
    recap: 'Highlight Recap:',
    feedback: 'Feedback',
    feedbackTitle: 'Provide event feedback',
    volunteer: 'Volunteer',
    volunteerArchive: 'Volunteer Archive',
    shareTitle: 'Share archive',
    feedbackPrefill: 'Feedback regarding past event: "{title}"\n\n',
    categories: { culture: 'Culture', job: 'Career', governance: 'Civic' },
  },
  months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  past: [
    {
      id: 'cny-gala-2026',
      title: '2026 CAACI Spring Festival Gala',
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
      title: 'All-State Agencies Job Fair',
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
  heroImage: '/images/hero-bg.jpg',
  searchPlaceholder: '输入关键词、地点或主题搜索活动...',
  filterAll: '全部活动',
  filterUpcoming: '近期活动',
  filterPast: '往期回顾',
  upcomingTitle: '近期活动与社区日程',
  upcomingSubtitle: '欢迎报名参加华协即将举办的节庆与社区活动。',
  pastTitle: '往期活动与历史档案',
  pastSubtitle: '回顾伊利诺伊中部华人协会历年举办的精彩节庆典礼、全员代表大会与里程碑事件。',
  organizer: 'CAACI',
  spotlight: { badge: '近期重点活动推荐' },
  toolbar: {
    eyebrow: '活动日程与档案',
    heading: '浏览华协社区活动',
    tabsLabel: '筛选活动',
    tabAll: '全部',
    tabUpcoming: '近期',
    tabPast: '往期',
    clearSearch: '清除搜索',
    search: '搜索',
    closeSearch: '关闭搜索',
    sortTitle: '切换日期排序',
    sortAsc: '日期升序',
    sortDesc: '日期降序',
    sortAscShort: '升序',
    sortDescShort: '降序',
  },
  categories: [
    { id: 'all', label: '全部分类' },
    { id: 'culture', label: '中华文化节庆' },
    { id: 'job', label: '求职与政务招聘' },
    { id: 'governance', label: '华协治理与大会' },
  ],
  actions: {
    register: '报名',
    registerNow: '立即报名',
    rsvp: '预约报名',
    rsvpFull: '立即预约报名',
    saving: '提交中…',
    confirmed: '已预约',
    confirmedFull: '已预约报名',
    volunteerShort: '义工',
    volunteer: '报名义工',
    share: '分享',
    shareTitle: '分享活动',
    copied: '已复制',
    linkCopied: '链接已复制',
    copyPrompt: '复制此链接：',
  },
  notes: {
    rsvpAlready: '您之前已预约过此活动。',
    rsvpDone: '预约成功，期待与您相见！',
    errorNetwork: '网络错误，请检查网络连接后重试。',
    errorClosed: '该活动已不再接受预约。',
    errorFailed: '预约未能保存，请重试。',
  },
  upcomingMessages: {
    loading: '正在加载近期活动…',
    error: '近期活动加载失败。',
    retry: '重试',
    empty: '目前暂无已安排的近期活动，敬请关注。',
    noMatch: '暂无符合筛选条件的近期活动。',
    resetFilters: '重置筛选条件',
    jumpToPast: '直达往期回顾',
  },
  pastLabels: {
    jumpToUpcoming: '返回近期活动',
    empty: '暂无符合筛选条件的往期活动。',
    recap: '精彩回顾：',
    feedback: '活动反馈',
    feedbackTitle: '提交活动反馈',
    volunteer: '致敬义工',
    volunteerArchive: '致敬义工',
    shareTitle: '分享此活动档案',
    feedbackPrefill: '关于往期活动【{title}】的反馈与建议：\n\n',
    categories: { culture: '文化节庆', job: '职业政务', governance: '协会治理' },
  },
  months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
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
      title: '全州政府机构招聘会',
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
