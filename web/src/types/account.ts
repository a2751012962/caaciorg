export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  authProvider: 'email' | 'google' | 'microsoft';
  memberId: string;
  membership: {
    tier: 'family' | 'individual' | 'student' | 'none';
    tierNameEN: string;
    tierNameZH: string;
    status: 'active' | 'failed' | 'inactive';
    basePrice: number;
    feeRate: number; // 0.035 for 3.5%
    totalPrice: number; // basePrice * 1.035
    renewalDateEN: string;
    renewalDateZH: string;
    validThrough: string;
    hasPaid: boolean;
    paymentFailed: boolean;
  };
  familyRole: 'creator' | 'member' | 'purchased_no_family' | 'invited_only' | 'none';
  familyData: {
    creatorName: string;
    creatorEmail: string;
    maxMembers: number;
    members: {
      id: string;
      name: string;
      email: string;
      relation: string;
      joinedDate: string;
      isSelf?: boolean;
    }[];
    pendingInvites: {
      id: string;
      name: string;
      email: string;
      sentDate: string;
    }[];
    activityLog: {
      id: string;
      date: string;
      textEN: string;
      textZH: string;
    }[];
    receivedInvite?: {
      id: string;
      fromName: string;
      fromEmail: string;
      familyPlanName: string;
      inviteDate: string;
    } | null;
  };
  registeredEvents: {
    id: string;
    titleEN: string;
    titleZH: string;
    date: string;
    time: string;
    location: string;
    status: 'confirmed' | 'concluded' | 'waitlist';
    ticketCode: string;
  }[];
  paymentHistory: {
    id: string;
    date: string;
    type: 'initiation' | 'renewal'; // Only "入会 / 续费" as requested
    typeEN: string;
    typeZH: string;
    amount: number; // with 3.5% fee
    fee: number;
    status: 'succeeded' | 'failed';
    invoiceUrl?: string;
  }[];
}

export const initialMockUser: UserProfile = {
  id: 'usr_caaci_842',
  name: '陈海伦 博士 (Dr. Helen Chen)',
  email: 'helen.chen@example.com',
  phone: '+1 (217) 555-0198',
  authProvider: 'email',
  memberId: 'CAACI-2026-0842',
  membership: {
    tier: 'family',
    tierNameEN: 'Family Membership',
    tierNameZH: '尊享家庭会员',
    status: 'active',
    basePrice: 35.0,
    feeRate: 0.035,
    totalPrice: 36.23, // 35 * 1.035
    renewalDateEN: 'January 28, 2027',
    renewalDateZH: '2027年1月28日',
    validThrough: '2027-01-28',
    hasPaid: true,
    paymentFailed: false,
  },
  familyRole: 'creator',
  familyData: {
    creatorName: '陈海伦 (Dr. Helen Chen)',
    creatorEmail: 'helen.chen@example.com',
    maxMembers: 3,
    members: [
      {
        id: 'mem_1',
        name: '陈海伦 (Dr. Helen Chen)',
        email: 'helen.chen@example.com',
        relation: '创建人 / 户主 (Owner)',
        joinedDate: '2026-01-28',
        isSelf: true,
      },
      {
        id: 'mem_2',
        name: '陈建国 (Jianguo Chen)',
        email: 'jianguo.chen@example.com',
        relation: '配偶 (Spouse)',
        joinedDate: '2026-02-01',
      },
    ],
    pendingInvites: [
      {
        id: 'inv_1',
        name: '王小明 (Xiaoming Wang)',
        email: 'xiaoming.wang@example.com',
        sentDate: '2026-09-02',
      },
    ],
    activityLog: [
      {
        id: 'act_1',
        date: '2026-09-02',
        textEN: 'Sent family membership invitation to xiaoming.wang@example.com',
        textZH: '向 xiaoming.wang@example.com 发送了家庭成员邀请',
      },
      {
        id: 'act_2',
        date: '2026-02-01',
        textEN: 'Jianguo Chen accepted your invitation and joined the family plan',
        textZH: '陈建国 接受了您的家庭邀请并成功绑定家庭权益',
      },
      {
        id: 'act_3',
        date: '2026-01-28',
        textEN: 'Family Membership established with 3 total member quota',
        textZH: '成功订阅家庭会员方案，已分配主会员卡及 2 个家属共享名额',
      },
    ],
    receivedInvite: null,
  },
  registeredEvents: [
    {
      id: 'mid-autumn',
      titleEN: 'Mid-Autumn Cultural Festival & Lantern Gala',
      titleZH: '中秋传统文化节与赏月游园灯会',
      date: 'September 20, 2026',
      time: '5:30 PM - 8:30 PM',
      location: 'Champaign Public Library & Community Pavilion',
      status: 'confirmed',
      ticketCode: 'CAACI-RSVP-9821-VIP',
    },
    {
      id: 'job-fair',
      titleEN: 'All-State Agencies Job Fair 全州政府机构招聘会',
      titleZH: 'All-State Agencies Job Fair 全州政府机构招聘会',
      date: 'October 26, 2025',
      time: '8:00 AM - 5:00 PM',
      location: 'Champaign-Urbana Public Conference Center',
      status: 'concluded',
      ticketCode: 'CAACI-RSVP-4112',
    },
    {
      id: 'cny-gala-2026',
      titleEN: '2026 Spring Festival Gala 农历丙午新春文艺晚会',
      titleZH: '2026 CAACI 农历丙午新春文艺晚会',
      date: 'February 14, 2026',
      time: '6:00 PM - 9:30 PM',
      location: 'Krannert Center for the Performing Arts, Urbana',
      status: 'concluded',
      ticketCode: 'CAACI-RSVP-3028',
    },
  ],
  paymentHistory: [
    {
      id: 'pay_1',
      date: '2026-01-28',
      type: 'renewal',
      typeEN: 'Annual Membership Renewal',
      typeZH: '年度会员续费',
      amount: 36.23,
      fee: 1.23,
      status: 'succeeded',
      invoiceUrl: '#',
    },
    {
      id: 'pay_2',
      date: '2025-01-28',
      type: 'renewal',
      typeEN: 'Annual Membership Renewal',
      typeZH: '年度会员续费',
      amount: 36.23,
      fee: 1.23,
      status: 'succeeded',
      invoiceUrl: '#',
    },
    {
      id: 'pay_3',
      date: '2024-01-28',
      type: 'renewal',
      typeEN: 'Annual Membership Renewal',
      typeZH: '年度会员续费',
      amount: 36.23,
      fee: 1.23,
      status: 'succeeded',
      invoiceUrl: '#',
    },
    {
      id: 'pay_4',
      date: '2023-01-28',
      type: 'initiation',
      typeEN: 'New Membership Initiation',
      typeZH: '新会员入会',
      amount: 36.23,
      fee: 1.23,
      status: 'succeeded',
      invoiceUrl: '#',
    },
  ],
};
