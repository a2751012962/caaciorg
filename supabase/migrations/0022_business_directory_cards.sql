-- Business directory = the cards on /business-services/. Until now the page
-- showed 13 merchants hard-coded in web/src/data/pages/business.ts and only
-- appended approved business_directory rows after them, so the admin panel's
-- Business directory list could not see, edit or hide those 13. This moves
-- them into the table and adds the card fields the table was missing:
--   * name_zh, label/label_zh (the small grey label on a card, e.g.
--     "Bubble Tea & Beverage" / "茶饮与简餐"), description_zh, hours/hours_zh.
--     A null Chinese field makes the Chinese page show the English one.
--   * verified — the "CAACI Verified" badge, separate from approved (approved
--     = publicly listed at all).
--   * tags/tags_zh — free-text chips staff type in the admin panel. An empty
--     list on one language falls back to the other language's list.
--   * sort_order — card order on the page (ascending, then name).
-- category now uses the page's filter ids (restaurant | groceries | dental |
-- financial | realestate | education_media | services); the old admin values
-- bakery / supermarket / other are mapped onto them.
-- The seed insert skips any name already in the table (case-insensitive), so
-- pasting this again never duplicates a merchant or overrides an admin edit.
-- Paste this BEFORE deploying the code that reads these columns. (If the code
-- goes first, the page's select fails and it shows its built-in list instead.)
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

alter table public.business_directory add column if not exists name_zh text;
alter table public.business_directory add column if not exists label text;
alter table public.business_directory add column if not exists label_zh text;
alter table public.business_directory add column if not exists description_zh text;
alter table public.business_directory add column if not exists hours text;
alter table public.business_directory add column if not exists hours_zh text;
alter table public.business_directory add column if not exists verified boolean not null default false;
alter table public.business_directory add column if not exists tags text[] not null default '{}';
alter table public.business_directory add column if not exists tags_zh text[] not null default '{}';
alter table public.business_directory add column if not exists sort_order integer not null default 0;

update public.business_directory set category = 'restaurant' where category = 'bakery';
update public.business_directory set category = 'groceries' where category = 'supermarket';
update public.business_directory set category = 'services' where category = 'other';

insert into public.business_directory
  (name, name_zh, category, label, label_zh, description, description_zh,
   address, phone, hours, hours_zh, website, verified, sort_order, approved)
select v.name, v.name_zh, v.category, v.label, v.label_zh, v.description, v.description_zh,
       v.address, v.phone, v.hours, v.hours_zh, v.website, v.verified, v.sort_order, true
from (values
  ('Kung Fu Tea (功夫茶)', 'Kung Fu Tea (功夫茶)', 'restaurant', 'Bubble Tea & Beverage', '茶饮与简餐', 'Bubble tea store franchise with over 500 locations in America, offering freshly brewed tea, boba, specialty milk teas, and fresh food in Campustown.', '全美超 500 家门店的知名连锁茶饮品牌，位于香槟校区 Sixth Street，主打现泡原茶、波霸奶茶、鲜果特调及特色简餐小吃。', '707 S. Sixth Street, #107, Champaign, IL 61820', '(217) 552-1668', '11:00 AM - 10:00 PM', '上午 11:00 - 晚上 10:00', 'https://www.kungfutea.com', true, 10),
  ('Tenkyu', 'Tenkyu 日本融合料理', 'restaurant', 'Japanese Fusion Dining', '日式融合料理', 'Fine dining Japanese fusion restaurant located in Downtown Champaign, offering elevated culinary creations and fresh ingredients.', '位于香槟市中心（Downtown Champaign）的精致日式融合料理餐厅，精选新鲜食材，提供高品质的用餐与社交体验。', '301 N Neil St, Unit 104, Champaign, IL 61820', null, '11:30 AM - 10:00 PM', '上午 11:30 - 晚上 10:00', 'https://www.tenkyu.cafe', true, 20),
  ('Szechuan Taste (川之味)', 'Szechuan Taste (川之味)', 'restaurant', 'Szechuan Cuisine', '正宗川味特色菜', 'Authentic spicy Sichuan specialties, classic Chinese home-style dishes, and daily fast food lunch specials from 11:00 AM to 3:00 PM.', '主打正宗地道麻辣川菜、经典传统家常菜肴，每日上午 11 点至下午 3 点提供快捷午市特惠快餐。', 'Champaign, IL', '(217) 530-4972', 'Lunch Daily 11:00 AM - 3:00 PM, Dinner', '每日午餐 11:00 AM - 3:00 PM，晚餐正常营业', 'https://szechuantastetogo.com', true, 30),
  ('Susuru Ramen', 'Susuru Ramen 日式拉面', 'restaurant', 'Japanese Cuisine & Ramen', '日式拉面与料理', 'Authentic Japanese cuisine specializing in flavorful ramen bowls, savory rice bowls, bento boxes, and stir-fried noodle dishes with authentic broth.', '主营地道正宗日本风味料理，提供浓郁醇香的日式拉面、盖浇饭、日式便当盒及镬气炒面系列。', '621 E Green St #A, Champaign, IL 61820', '(217) 552-1266', null, null, 'https://susururamenuiuc.com', true, 40),
  ('U of I Community Credit Union (UICCU)', 'U of I Community Credit Union (UICCU) 社区信用社', 'financial', 'Credit Union & Banking', '社区信用社与金融服务', 'Member-owned financial cooperative serving University of Illinois faculty, staff, students, and Champaign County residents with personal & business banking, loans, and mortgages.', '服务伊利诺伊大学教职员工、在校学生及香槟县广大居民的合作制金融机构，提供个人与企业开户、房屋贷款、车贷与低息储蓄支持。', '206 E University Ave, Urbana, IL 61801', '(217) 278-7700', 'Mon-Fri 9:00 AM - 5:00 PM, Sat 9:00 AM - 12:00 PM', '周一至周五 9:00 AM - 5:00 PM，周六 9:00 AM - 12:00 PM', 'https://uoficreditunion.org', true, 50),
  ('Caring Family Dental', 'Caring Family Dental 关爱家庭牙科诊所', 'dental', 'Dental Office', '牙科门诊', 'Comprehensive and compassionate family dental practice in Champaign, providing preventive cleanings, restorative treatments, and cosmetic dentistry.', '位于香槟市中心的温馨家庭牙科诊所，提供常规洁牙保健、牙齿修复、牙冠补牙及美容牙科等全方位口腔诊疗。', '201 W Springfield Ave #506, Champaign, IL 61820', '(217) 954-1850', 'Mon-Thu 8:00 AM - 5:00 PM, Fri 8:00 AM - 1:00 PM', '周一至周四 8:00 AM - 5:00 PM，周五 8:00 AM - 1:00 PM', 'https://caringdentalchampaign.com', false, 60),
  ('Urbana Family Dental Care', 'Urbana Family Dental Care 厄巴纳家庭牙科', 'dental', 'Dental Office', '牙科门诊', 'Dedicated family oral healthcare clinic in Urbana committed to personalized dental care, periodontal therapy, and maintaining healthy smiles for all ages.', '位于厄巴纳 Philo Rd 的现代化专业口腔诊所，致力于为各年龄段家庭成员提供个性化口腔护理、牙周诊治与健康微笑守护。', '1812 S Philo Rd, Urbana, IL 61802', '(217) 729-7411', 'Mon-Thu 8:00 AM - 5:00 PM, Fri 8:00 AM - 1:00 PM', '周一至周四 8:00 AM - 5:00 PM，周五 8:00 AM - 1:00 PM', 'https://urbanadentalcare.com', false, 70),
  ('Financial Brilliance Accounting Firm', 'Financial Brilliance Accounting Firm 辉盛会计师事务所', 'financial', 'Accounting & Tax Services', '会计与税务服务', 'Professional accounting firm specializing in comprehensive accounting, tax preparation, bookkeeping, and fractional CFO advisory services for individuals and businesses.', '专业会计与财务咨询机构，专注为个人、在美留学生学者及中小微企业提供记账报税、税务合规筹划、公司成立及 CFO 顾问服务。', 'Colony West, Champaign, IL 61820', '(626) 800-8800', 'By appointment', '预约制', 'https://financial-brilliance.com', false, 80),
  ('American Financial Alliance', 'American Financial Alliance 美洲金融联盟', 'financial', 'Financial & Wealth Advisory', '金融咨询与财富规划', 'Comprehensive financial planning, wealth management, retirement solutions, and family investment strategies tailored for Central Illinois residents.', '面向伊利诺伊中部居民的综合财富管理机构，提供退休金规划、人寿与资产保全、教育基金配置及家庭财务战略。', null, null, null, null, null, false, 90),
  ('Jill Hess, Realtor® - RE/MAX Realty Associates', 'Jill Hess, Realtor® - RE/MAX Realty Associates', 'realestate', 'Real Estate Broker', '房地产经纪人', 'Licensed Realtor and Broker with RE/MAX Realty Associates in Champaign, guiding families, scholars, and buyers through residential buying, selling, and relocation.', '香槟 RE/MAX Realty Associates 资深持牌房产经纪，专注为本地家庭、学者及新购房者提供住宅买卖、学区房选购与全流程过户服务。', '2919 Crossing Court, Champaign, IL', '(217) 417-8177', null, null, 'https://jillhess.remax.com', false, 100),
  ('Julie Woller - AAA Insurance', 'Julie Woller - AAA Insurance 保险顾问', 'realestate', 'Insurance Services', '保险代理与道路救援', 'Trusted AAA insurance agent in Champaign offering comprehensive auto, home, and life insurance policies, as well as AAA roadside membership benefits.', '深耕香槟地区的资深 AAA 保险代理人，提供汽车保险、房屋保险、人寿保单及 AAA 道路紧急救援会员办理。', null, null, null, null, null, false, 110),
  ('IMMI Education Inc. (欧美新锐教育)', 'IMMI Education Inc. (欧美新锐教育)', 'education_media', 'Education Consulting', '国际教育咨询', 'Comprehensive international education organization specializing in academic planning, high school counseling, college application planning, and graduate school admissions.', '国际综合性教育咨询机构，专注于中美跨境留学申请长线学术规划、高中及大学转学辅导、研究生深造咨询与文书润色。', '239 Washington St, Unit 304, Jersey City, NJ 07302', '(978) 846-5229', null, null, 'https://www.immieducation.com', false, 120),
  ('Magnify Film & Media', 'Magnify Film & Media 影视与商业摄像', 'education_media', 'Media Production & Videography', '商业摄像与媒体制作', 'Professional business and personal videographers based in Urbana, IL, providing creative commercial video production, brand storytelling, and event documentation.', '位于厄巴纳的专业商业与个人影视摄制团队，承接企业宣传视频摄制、品牌故事包装、社区庆典活动高清录制与视觉创作服务。', '2107 N High Cross Rd, Urbana, IL 61802', '(217) 552-4636', null, null, 'https://magnifyfilms.org', false, 130)
) as v(name, name_zh, category, label, label_zh, description, description_zh,
       address, phone, hours, hours_zh, website, verified, sort_order)
where not exists (
  select 1 from public.business_directory b where lower(b.name) = lower(v.name)
);
