export interface CommunityCalendarContent {
  title: string;
  subtitle: string;
  heroImage: string;
  badge: string;
  instruction: string;
  openLabel: string;
  calendars: {
    id: string;
    name: string;
    image: string;
    url: string;
    desc: string;
  }[];
}

export const calendarDataEN: CommunityCalendarContent = {
  title: 'Community Calendar',
  subtitle:
    'Connect with public events, academic conferences, arts, and festivals across Central Illinois.',
  heroImage: '/images/central-il.jpg',
  badge: 'Community Portals',
  instruction: 'Click on the Institutional Logos Below to Access Event Calendars in the Community',
  openLabel: 'Open Calendar',
  calendars: [
    {
      id: 'uiuc',
      name: 'University of Illinois at Urbana-Champaign',
      image: '/images/cal-uiuc.png',
      url: 'https://calendars.illinois.edu',
      desc: 'Comprehensive academic, athletic, arts, and lecture calendar across all UIUC colleges and departments.',
    },
    {
      id: 'krannert',
      name: 'Krannert Center for the Performing Arts',
      image: '/images/cal-krannert.png',
      url: 'https://krannertcenter.com/events',
      desc: 'World-class performing arts, symphonies, theater productions, dance, and cultural recitals in Urbana.',
    },
    {
      id: 'champaign',
      name: 'City of Champaign Community Events',
      image: '/images/cal-champaign.png',
      url: 'https://champaignil.gov/calendar/',
      desc: "Official civic meetings, community festivals, parades, public forums, and farmers' market schedules.",
    },
    {
      id: 'urbana',
      name: 'City of Urbana Events Calendar',
      image: '/images/cal-urbana.png',
      url: 'https://urbanaillinois.us/calendar',
      desc: 'Urbana park district festivals, neighborhood gatherings, public library workshops, and arts celebrations.',
    },
  ],
};

export const calendarDataZH: CommunityCalendarContent = {
  title: '社区活动日历',
  subtitle: '一站式获取伊利诺伊中部大学校园、艺术中心与双城市政官方活动日程。',
  heroImage: '/images/central-il.jpg',
  badge: 'Community Portals',
  instruction: '单击下面的机构徽标可访问社区中的活动日历',
  openLabel: '进入日历',
  calendars: [
    {
      id: 'uiuc',
      name: '伊利诺伊大学厄巴纳-香槟分校 (UIUC)',
      image: '/images/cal-uiuc.png',
      url: 'https://calendars.illinois.edu',
      desc: 'UIUC 全校各学院官方学术日历、国际会议、体育赛事、艺术展览与前沿公开讲座。',
    },
    {
      id: 'krannert',
      name: 'Krannert 演艺中心',
      image: '/images/cal-krannert.png',
      url: 'https://krannertcenter.com/events',
      desc: '美中地区享誉盛名的艺术殿堂，上演世界级交响乐、百老汇舞台剧、芭蕾舞及传统文化展演。',
    },
    {
      id: 'champaign',
      name: '香槟市政府社区活动日历',
      image: '/images/cal-champaign.png',
      url: 'https://champaignil.gov/calendar/',
      desc: '香槟市官方公共听证会、农夫市集、节日游行、市民体育赛事与社区文化节日程。',
    },
    {
      id: 'urbana',
      name: '厄巴纳市政府社区活动日历',
      image: '/images/cal-urbana.png',
      url: 'https://urbanaillinois.us/calendar',
      desc: '厄巴纳公园管理局家庭活动、公共图书馆儿童研讨会、社区户外艺术节日程安排。',
    },
  ],
};
