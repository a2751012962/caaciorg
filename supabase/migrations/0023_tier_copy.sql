-- Membership plan copy, editable from the admin Plans tab.
-- The plan cards on /membership/ used to take their benefit lines from
-- web/src/data/pages/membership.ts, so staff could change a price in the admin
-- panel but not the words next to it. These columns hold the Chinese
-- description and the card's benefit lines in both languages; the page uses
-- them when set and falls back to the built-in copy when a list is empty.
-- The UPDATEs seed today's built-in lines so the admin form opens with the text
-- visitors already see; a row that already has lines is left alone.
alter table public.membership_tiers
  add column if not exists description_zh text,
  add column if not exists features       text[] not null default '{}',
  add column if not exists features_zh    text[] not null default '{}';

update public.membership_tiers set
  description_zh = coalesce(description_zh, '社区动态与活动通知——无需付款。随时可升级以享受节日福利。'),
  features = array[
    'Community updates and event announcements',
    'No card needed, and it never expires',
    'Upgrade to a paid plan any time for member perks',
    'A free drink at partner showroom MYST SCC'],
  features_zh = array[
    '社区动态与活动通知',
    '无需付款，永不过期',
    '可随时升级为付费会员，享受会员福利',
    '在合作豪车展厅 MYST SCC 享免费饮品一杯']
where id = 'free' and features = '{}' and features_zh = '{}';

update public.membership_tiers set
  description_zh = coalesce(description_zh, '面向年满 18 岁的在校大学生。'),
  features = array[
    'Free or discounted entry to CAACI celebrations',
    'Career mentorship and resume workshops',
    'Community volunteer service hours certification',
    'Member networking WeChat group',
    'Save the $390 documentation fee on a car from partner MYST SCC'],
  features_zh = array[
    '节日联欢活动门票特惠或免费体验',
    '参与名企导师职业讲座与求职指导',
    '开具官方社区义工公益服务时长证明',
    '加入 CAACI 青年学生交流群',
    '在合作车行 MYST SCC 购车，免 $390 文件费']
where id = 'student' and features = '{}' and features_zh = '{}';

update public.membership_tiers set
  description_zh = coalesce(description_zh, '适用于个人的完整会员资格。'),
  features = array[
    'Annual Member Meeting with lunch included',
    'Priority registration for cultural festivals',
    'Partner store discounts in Champaign & Chicago',
    'Voting eligibility in board general elections',
    'Save the $390 documentation fee on a car from partner MYST SCC'],
  features_zh = array[
    '参加年度会员大会（免费享用午餐）',
    '三大中华传统节日优先席位预订',
    '香槟与芝加哥合作中餐馆/商户专属折扣',
    '享有协会换届选举投票与监督权',
    '在合作车行 MYST SCC 购车，免 $390 文件费']
where id = 'individual' and features = '{}' and features_zh = '{}';

update public.membership_tiers set
  description_zh = coalesce(description_zh, '适用于一个家庭，全家共享。'),
  features = array[
    'All Individual privileges for up to 3 people, including you',
    'Youth culture workshops and kids activity perks',
    'Senior member care and community support assistance',
    'Group discounts for live theater and concerts',
    'Save the $390 documentation fee on a car from partner MYST SCC'],
  features_zh = array[
    '最多 3 人（含您本人）同享个人会员全部福利',
    '儿童中华传统文化体验营专享福利',
    '社区长辈生活协助与医疗讲座服务',
    '剧院文艺演出与高品质演出团购优惠',
    '在合作车行 MYST SCC 购车，免 $390 文件费']
where id = 'family' and features = '{}' and features_zh = '{}';

update public.membership_tiers set
  description_zh = coalesce(description_zh, '包含商家名录收录。'),
  features = array[
    'Listing in the CAACI Business Directory (after staff review)',
    'Exposure to the Central Illinois Chinese community',
    'Renews yearly from your joining date'],
  features_zh = array[
    '收录于 CAACI 商业名录（经工作人员审核）',
    '面向伊利诺伊中部华人社区推广',
    '自加入之日起按年续费']
where id = 'business' and features = '{}' and features_zh = '{}';

update public.membership_tiers set
  description_zh = coalesce(description_zh, '授予为社区做出重大贡献者的免费会员资格。')
where id = 'honorary';
