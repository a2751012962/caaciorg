export interface ResourcesContent {
  title: string;
  subtitle: string;
  intro: string;
  items: {
    title: string;
    category: string;
    url: string;
    desc: string;
  }[];
}

export const resourcesDataEN: ResourcesContent = {
  title: 'Central Illinois Resources',
  subtitle:
    'Essential community, educational, civic, and governmental resources for residents and newcomers.',
  intro:
    'Central Illinois is a vibrant destination for businesses and families alike. As a Chinese immigrant or student, settling here is made effortless with our dedicated assistance. Embrace the limitless opportunities and welcoming community that await you in this captivating region. Let us guide you in establishing a prosperous future, surrounded by the charm and boundless potential of Central Illinois.',
  items: [
    {
      title: 'University of Illinois at Urbana-Champaign (UIUC)',
      category: 'Higher Education & Research',
      url: 'https://illinois.edu',
      desc: 'A world-renowned public research university, home to top engineering, agriculture, business programs, and a vibrant Chinese student community.',
    },
    {
      title: 'City of Champaign',
      category: 'Local Government & Municipal',
      url: 'https://champaignil.gov',
      desc: 'Official municipal portal for city services, public safety, community development, parks, housing permits, and local initiatives.',
    },
    {
      title: 'City of Urbana',
      category: 'Local Government & Municipal',
      url: 'https://urbanaillinois.us',
      desc: 'Civic resources, sustainability initiatives, arts & culture programs, public works, and community services in Urbana.',
    },
    {
      title: 'UI Alumni Association (UIAA)',
      category: 'Alumni & Professional Networks',
      url: 'https://via.illinois.edu',
      desc: 'Connecting over 470,000 University of Illinois alumni worldwide for networking, career mentoring, and fellowship.',
    },
    {
      title: 'UI Alumni Taiwan',
      category: 'Alumni & Cultural Exchange',
      url: 'https://www.facebook.com/groups/IllinoisAlumniTaiwan/',
      desc: 'Dedicated network for Illinois alumni from and connecting to Taiwan, facilitating professional collaboration and cultural reunions.',
    },
    {
      title: "Consulate General of the People's Republic of China in Chicago",
      category: 'Consular & Diplomatic',
      url: 'http://chicago.china-consulate.gov.cn',
      desc: 'Consular services including passport renewal, visa processing, notarization, authentication, and consular protection for Central Illinois.',
    },
    {
      title: 'Taipei Economic and Cultural Office in Chicago (TECO)',
      category: 'Consular & Diplomatic',
      url: 'https://www.taiwanembassy.org/uschi/',
      desc: 'Consular documentation, academic cooperation, trade facilitation, and cultural exchange representation in the Midwest.',
    },
    {
      title: 'Champaign-Urbana Public Health District (CUPHD)',
      category: 'Healthcare & Wellness',
      url: 'https://c-uphd.org',
      desc: 'Public healthcare clinic, immunizations, family wellness programs, maternal care, and preventive health guidance.',
    },
  ],
};

export const resourcesDataZH: ResourcesContent = {
  title: '中部伊利诺伊地区资源',
  subtitle: '汇集教育、市政、校友、领事与公共卫生核心资源，助力华人安心定居与发展。',
  intro:
    '伊利诺伊州中部是企业和家庭充满活力的目的地。作为中国移民、留学生或访问学者，在我们的竭诚帮助下，您可以轻松在这里顺利安家。在这个迷人的地区拥抱无限的学术与商业机会，热情的社区正期待着您的加入。让我们引导您在伊利诺伊州中部的魅力和无限潜力的包围下建立繁荣的未来。',
  items: [
    {
      title: '伊利诺伊大学厄巴纳-香槟分校 (UIUC)',
      category: '顶尖学府与科研',
      url: 'https://illinois.edu',
      desc: '世界顶尖公立研究型大学，工程、农学、商学闻名遐迩，拥有美中地区最为庞大且优秀的华人留学生与学者群体。',
    },
    {
      title: '香槟市政府 (City of Champaign)',
      category: '地方市政公共服务',
      url: 'https://champaignil.gov',
      desc: '香槟市官方政务入口，提供居民市政服务、公共安全、社区发展、市政公园与住房法规咨询。',
    },
    {
      title: '厄巴纳市政府 (City of Urbana)',
      category: '地方市政公共服务',
      url: 'https://urbanaillinois.us',
      desc: '厄巴纳市民政务指南，涵盖社区艺术文化节庆、公共交通规划、环保回收与公共设施预约服务。',
    },
    {
      title: 'UIUC 校友联合总会 (UIAA)',
      category: '校友社交与职业网络',
      url: 'https://via.illinois.edu',
      desc: '联络全球超过 47 万名伊利诺伊大学杰出校友，提供全球校友交流、职场导师与终身人脉网络。',
    },
    {
      title: '伊大台湾校友会 (UI Alumni Taiwan)',
      category: '校友网络与文化联络',
      url: 'https://www.facebook.com/groups/IllinoisAlumniTaiwan/',
      desc: '凝聚来自台湾及海内外的伊大校友群体，定期开展跨行业交流聚会与母校文化纪念活动。',
    },
    {
      title: '中华人民共和国驻芝加哥总领事馆',
      category: '领事认证与侨胞服务',
      url: 'http://chicago.china-consulate.gov.cn',
      desc: '负责领区中国公民护照换发、签证、公证认证、领事协助与同胞海外安全保护工作。',
    },
    {
      title: '驻芝加哥台北经济文化办事处 (TECO)',
      category: '经贸文化与领事服务',
      url: 'https://www.taiwanembassy.org/uschi/',
      desc: '提供领事文件证明、赴台经贸洽谈、学术教育交流及多元文化推广支持。',
    },
    {
      title: '香槟-厄巴纳公共卫生局 (CUPHD)',
      category: '医疗关怀与社区健康',
      url: 'https://c-uphd.org',
      desc: '本地公共医疗诊所、儿童与成人疫苗接种、妇幼健康照护计划及多语种健康咨询支持。',
    },
  ],
};
