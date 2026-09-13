import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registrationConfirmation,
  eventAnnouncement,
  newsTemplate,
  PLACEHOLDER,
  templateVariables,
  centralTime,
  emailLogo,
  esc,
} from '../functions/api/_event-emails.js';
import { validateQuestions } from '../functions/api/_event-form.js';

const ORIGIN = 'https://caaciorg.com';
const LOGO = emailLogo('https://db.example');
const BEFORE_DEADLINE = Date.parse('2026-09-01T12:00:00Z');

// 2:00–6:00 PM in Champaign (CDT = UTC-5); the gift deadline is the start.
const MID_AUTUMN = {
  slug: 'mid-autumn-festival',
  title: 'Mid-Autumn Festival 中秋节',
  title_zh: '中秋节',
  description: 'Mooncakes and lanterns',
  starts_at: '2026-09-27T19:00:00+00:00',
  ends_at: '2026-09-27T23:00:00+00:00',
  location: 'Siebel Center for Design, 1208 S Fourth St, Champaign, IL',
  perk_deadline: null,
  perk_item_zh: '月饼',
  perk_item_en: 'mooncake',
};

const { questions: QUESTIONS } = validateQuestions([
  {
    id: 'attending',
    type: 'single',
    required: true,
    label_en: 'Can you attend?',
    label_zh: '您能参加吗？',
    options: [
      { id: 'yes', label_en: "Yes, I'll be there", label_zh: '能，我会参加' },
      { id: 'no', label_en: "Sorry, can't make it", label_zh: '抱歉，无法参加' },
    ],
  },
  {
    id: 'names',
    type: 'textarea',
    required: true,
    label_en: 'What are the names of people attending?',
    label_zh: '参加者的姓名是？',
  },
  {
    id: 'heard_from',
    type: 'single',
    label_en: 'How did you hear about this event?',
    label_zh: '您是从哪里得知本次活动的？',
    other: true,
    options: [
      { id: 'website', label_en: 'Website', label_zh: '网站' },
      { id: 'social', label_en: 'Social Media', label_zh: '社交媒体' },
    ],
  },
  {
    id: 'food',
    type: 'multi',
    label_en: 'What will you bring?',
    label_zh: '您会带什么？',
    other: true,
    options: [
      { id: 'dumplings', label_en: 'Dumplings', label_zh: '饺子' },
      { id: 'tea', label_en: 'Tea', label_zh: '茶' },
    ],
  },
  { id: 'note', type: 'text', label_en: 'Anything else?', label_zh: '其他说明' },
]);

const confirm = (over = {}) =>
  registrationConfirmation({
    origin: ORIGIN,
    logo: LOGO,
    event: MID_AUTUMN,
    questions: QUESTIONS,
    answers: { attending: { option: 'yes' }, names: 'Pat' },
    linked: false,
    now: BEFORE_DEADLINE,
    ...over,
  });
const announce = (over = {}) =>
  eventAnnouncement({
    origin: ORIGIN,
    logo: LOGO,
    event: MID_AUTUMN,
    now: BEFORE_DEADLINE,
    ...over,
  });

// Visible text with tags removed and entities decoded, whitespace collapsed.
const text = (html) =>
  html
    .replace(/<br>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e],
    )
    .replace(/\s+/g, ' ');
const cell = (label, value) => new RegExp(`${label}</td><td[^>]*>${value}</td>`);

// ------------------------------------------------------------- centralTime ----

test('centralTime: names the zone in words in both languages', () => {
  for (const [iso, en, zh] of [
    [
      '2026-09-27T19:00:00Z',
      'September 27, 2:00 PM Central Time',
      '9月27日下午2点（美国中部时间）',
    ],
    [
      '2099-09-20T04:59:59Z',
      'September 19, 11:59 PM Central Time',
      '9月19日晚上11点59分（美国中部时间）',
    ],
    [
      '2026-12-01T18:00:00Z',
      'December 1, 12:00 PM Central Time',
      '12月1日中午12点（美国中部时间）',
    ], // CST
    [
      '2026-03-02T06:05:00Z',
      'March 2, 12:05 AM Central Time',
      '3月2日凌晨12点05分（美国中部时间）',
    ],
    ['2026-03-02T15:30:00Z', 'March 2, 9:30 AM Central Time', '3月2日上午9点30分（美国中部时间）'],
  ]) {
    assert.equal(centralTime(iso, 'en'), en, iso);
    assert.equal(centralTime(iso, 'zh'), zh, iso);
  }
  assert.equal(centralTime(null, 'en'), '');
  assert.equal(centralTime('not a date', 'zh'), '');
});

// -------------------------------------------------------- the announcement ----

test('announcement: the mooncake renders the approved Mid-Autumn copy exactly', () => {
  const { html } = announce();
  const body = text(html);
  for (const approved of [
    '免费领月饼',
    '9月27日下午2点（美国中部时间）前报名，并免费注册一个 CAACI 网站账户，活动当天就能在现场免费领一份月饼。',
    '不注册账户也可以报名参加活动，只是领不到月饼。',
    'Register and create a free CAACI website account by September 27, 2:00 PM Central Time, and pick up your free mooncake at the event.',
    "You can register without an account — you just won't get the free mooncake.",
  ]) {
    assert.ok(body.includes(approved), approved);
  }
});

test('announcement: no emails show GMT, UTC or a zone abbreviation', () => {
  for (const { subject, html } of [
    announce(),
    announce({ event: { ...MID_AUTUMN, perk_deadline: '2026-12-01T18:00:00Z' } }),
    confirm(),
    confirm({ linked: true }),
  ]) {
    assert.doesNotMatch(`${subject} ${html}`, /GMT|UTC|\bC[DS]T\b/);
  }
});

test('announcement: subject, times, place, description and the register button', () => {
  const { subject, html } = announce();
  assert.equal(subject, '中秋节 · Mid-Autumn Festival 中秋节 报名开始 / Registration open');
  assert.match(html, /Sunday, September 27, 2026 at 2:00\sPM – 6:00\sPM/);
  assert.match(html, /2026年9月27日星期日 14:00 – 18:00/);
  assert.match(html, /地点 · Where<\/strong><br>Siebel Center for Design/);
  assert.match(html, /Mooncakes and lanterns/);
  assert.match(
    html,
    /<a href="https:\/\/caaciorg\.com\/events\/mid-autumn-festival\/register\/"[^>]*>报名 · Register<\/a>/,
  );
  assert.match(
    html,
    /src="https:\/\/db\.example\/storage\/v1\/object\/public\/media\/email\/caaci-logo\.png"/,
  );
  assert.match(html, /P\.O\. Box 2276/);
  assert.match(html, /caaci\.org@gmail\.com/);
  assert.match(html, />caaciorg\.com<\/a>/);
  assert.equal(html.includes('{{{'), false, 'every placeholder filled');
});

test('announcement: every admin-written field is escaped; the description keeps its line breaks', () => {
  const { subject, html } = announce({
    event: {
      ...MID_AUTUMN,
      slug: 'a b',
      title: 'Moon & <Lantern> Night',
      title_zh: '"月"',
      location: '<script>x</script>',
      description: 'Line one <b>\nLine two',
      perk_item_zh: '<i>饼</i>',
      perk_item_en: 'cake & tea',
    },
  });
  assert.equal(
    subject,
    '"月" · Moon & <Lantern> Night 报名开始 / Registration open',
    'subject is text',
  );
  for (const raw of ['<Lantern>', '<script>', '<b>', '<i>饼']) {
    assert.equal(html.includes(raw), false, raw);
  }
  assert.match(html, /Moon &amp; &lt;Lantern&gt; Night/);
  assert.match(html, /&quot;月&quot; 报名开始/);
  assert.match(html, /Line one &lt;b&gt;<br>Line two/);
  assert.match(html, /免费领&lt;i&gt;饼&lt;\/i&gt; · Free cake &amp; tea/);
  assert.match(html, /\/events\/a%20b\/register\//);
});

test('announcement: a title in {{{…}}} is shown as typed, not expanded', () => {
  const { html } = announce({
    event: { ...MID_AUTUMN, title: '{{{PERK_HTML}}} {{{REGISTER_URL}}}' },
  });
  assert.match(html, /\{\{\{PERK_HTML\}\}\} \{\{\{REGISTER_URL\}\}\}/);
});

test('announcement: no gift box when there is no gift or its deadline has passed', () => {
  for (const [label, over] of [
    ['no items', { event: { ...MID_AUTUMN, perk_item_zh: null, perk_item_en: null } }],
    ['one item', { event: { ...MID_AUTUMN, perk_item_en: null } }],
    ['after the deadline', { now: Date.parse('2026-09-27T19:00:01Z') }],
  ]) {
    const { html } = announce(over);
    assert.doesNotMatch(html, /免费领|Free mooncake|without an account/, label);
    assert.match(html, /报名 · Register/, `${label}: still announces`);
  }
  assert.match(
    announce({ now: Date.parse('2026-09-27T19:00:00Z') }).html,
    /免费领月饼/,
    'inclusive',
  );
});

test('announcement: another gift and event use the same sentences with their own words', () => {
  const body = text(
    announce({
      event: {
        ...MID_AUTUMN,
        title: 'Summer Picnic',
        title_zh: null,
        perk_item_zh: '雨伞',
        perk_item_en: 'umbrella',
      },
    }).html,
  );
  assert.ok(body.includes('免费领雨伞 · Free umbrella'));
  assert.ok(body.includes('活动当天就能在现场免费领一份雨伞。'));
  assert.ok(body.includes('and pick up your free umbrella at the event.'));
  assert.ok(body.includes("you just won't get the free umbrella."));
  assert.equal(
    announce({ event: { ...MID_AUTUMN, title: 'Summer Picnic', title_zh: null } }).subject,
    'Summer Picnic · Summer Picnic 报名开始 / Registration open',
  );
});

// --------------------------------------------------------- the confirmation ----

test('confirmation: subject uses the Chinese title, else the title', () => {
  assert.equal(confirm().subject, '中秋节 · 报名确认 / Registration confirmed');
  assert.equal(
    confirm({ event: { ...MID_AUTUMN, title_zh: '' } }).subject,
    'Mid-Autumn Festival 中秋节 · 报名确认 / Registration confirmed',
  );
});

test('confirmation: one row per choice question with its labels; text questions left out', () => {
  const { html } = confirm({
    answers: {
      attending: { option: 'yes' },
      names: 'Pat Lee',
      heard_from: { option: 'social' },
      food: { options: ['dumplings', 'tea'] },
      note: 'Bringing a friend',
    },
  });
  assert.match(
    html,
    cell('您能参加吗？ · Can you attend\\?', '能，我会参加 · Yes, I&#39;ll be there'),
  );
  assert.match(
    html,
    cell(
      '您是从哪里得知本次活动的？ · How did you hear about this event\\?',
      '社交媒体 · Social Media',
    ),
  );
  assert.match(html, cell('您会带什么？ · What will you bring\\?', '饺子、茶 · Dumplings, Tea'));
  assert.equal(html.includes('参加者的姓名是'), false, 'the textarea question is not listed');
  assert.equal(html.includes('其他说明'), false, 'the text question is not listed');
  assert.equal(html.includes('Pat Lee'), false);
  assert.equal(html.includes('Bringing a friend'), false);
});

test('confirmation: an unanswered choice question shows a dash; no choice questions, no table', () => {
  const { html } = confirm();
  assert.match(html, cell('您会带什么？ · What will you bring\\?', '—'));
  const onlyText = confirm({ questions: [QUESTIONS[1]], answers: { names: 'Pat' } }).html;
  assert.equal(
    onlyText.includes(
      '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;font-size:15px;">',
    ),
    false,
  );
  assert.match(onlyText, /You're registered/);
});

// Anyone can make the endpoint mail any address from CAACI: nothing typed may
// reach the email, even through an Other answer.
test('confirmation: Other answers are the word "Other", never the typed text', () => {
  const typed =
    'Your account is suspended, verify at https://evil.example <a href="https://evil.example">here</a>';
  const { subject, html } = confirm({
    answers: {
      attending: { option: 'yes' },
      names: typed,
      heard_from: { other: typed },
      food: { options: ['tea'], other: 'Call now http://evil.example <b>urgent</b>' },
      note: typed,
    },
  });
  for (const word of ['evil', 'suspended', 'verify', 'urgent', 'Call now', 'here</a>']) {
    assert.equal(html.includes(word), false, `body contains "${word}"`);
    assert.equal(subject.includes(word), false, `subject contains "${word}"`);
  }
  assert.match(
    html,
    cell('您是从哪里得知本次活动的？ · How did you hear about this event\\?', '其他 · Other'),
  );
  assert.match(html, cell('您会带什么？ · What will you bring\\?', '茶、其他 · Tea, Other'));
});

test('confirmation: unlinked, the gift box offers a sign-up link built from the origin', () => {
  const { html } = registrationConfirmation({
    origin: 'https://beta.caaciorg.com',
    logo: LOGO,
    event: MID_AUTUMN,
    questions: QUESTIONS,
    answers: {},
    linked: false,
    now: BEFORE_DEADLINE,
  });
  const body = text(html);
  assert.ok(body.includes('免费领月饼 · Free mooncake'));
  assert.ok(
    body.includes(
      '9月27日下午2点（美国中部时间）前用此邮箱免费注册一个 CAACI 网站账户，活动当天就能在现场免费领一份月饼。',
    ),
  );
  assert.ok(
    body.includes(
      'Create a free CAACI website account with this email by September 27, 2:00 PM Central Time, and pick up your free mooncake at the event.',
    ),
  );
  assert.match(html, /href="https:\/\/beta\.caaciorg\.com\/login-3\/"/);
  assert.match(html, />beta\.caaciorg\.com<\/a>/, 'footer host follows the origin');
  assert.equal(html.includes('counts for your free mooncake'), false);
});

test('confirmation: linked, the gift box says it counts and offers no sign-up link', () => {
  const { html } = confirm({ linked: true });
  assert.match(html, /counts for your free mooncake at the event/);
  assert.match(html, /你的报名已关联你的 CAACI 账户/);
  assert.equal(html.includes('/login-3/'), false);
});

test('confirmation: no gift box after the deadline or without a gift; the answers are still confirmed', () => {
  for (const over of [
    { now: Date.parse('2026-09-27T19:00:01Z') },
    { event: { ...MID_AUTUMN, perk_deadline: '2000-01-01T00:00:00Z' }, now: BEFORE_DEADLINE },
    { event: { ...MID_AUTUMN, perk_item_zh: null } },
  ]) {
    const { html } = confirm(over);
    assert.equal(/mooncake|月饼/.test(html), false);
    assert.equal(html.includes('/login-3/'), false);
    assert.match(html, /能，我会参加 · Yes, I&#39;ll be there/);
  }
});

test('confirmation: event fields are escaped', () => {
  const { html } = confirm({
    event: {
      ...MID_AUTUMN,
      title: 'Moon & <Lantern> Night',
      title_zh: null,
      location: 'Hall "A" <b>',
    },
    questions: [{ ...QUESTIONS[0], label_en: '<img src=x>' }],
  });
  assert.equal(html.includes('<Lantern>'), false);
  assert.equal(html.includes('<img src=x>'), false);
  assert.match(html, /Moon &amp; &lt;Lantern&gt; Night/);
  assert.match(html, /Hall &quot;A&quot; &lt;b&gt;/);
  // 19:00–23:00 UTC is 2:00–6:00 PM in Champaign, not 7:00 PM.
  assert.match(html, /Sunday, September 27, 2026 at 2:00\sPM – 6:00\sPM/);
  assert.equal(/7:00\sPM/.test(html), false);
});

// -------------------------------------------------------- Resend templates ----

const RESERVED = [
  'FIRST_NAME',
  'LAST_NAME',
  'EMAIL',
  'UNSUBSCRIBE_URL',
  'RESEND_UNSUBSCRIBE_URL',
  'CONTACT',
  'THIS',
];

// Mid-Autumn taking registrations, for the Compose News templates.
const REGISTERING = { ...MID_AUTUMN, registration_questions: QUESTIONS };
const news = (name, over = {}) =>
  newsTemplate(name, {
    origin: ORIGIN,
    logo: LOGO,
    event: REGISTERING,
    now: BEFORE_DEADLINE,
    ...over,
  });
const SITE_KEYS = ['SITE_URL', 'SITE_HOST', 'LOGO_URL'];

test('templateVariables: every template, with every placeholder declared and every variable used', () => {
  assert.deepEqual(
    templateVariables.map((t) => t.alias),
    [
      'event-registration-confirmation',
      'event-announcement',
      'event-reminder',
      'event-thank-you',
      'news-general',
      'membership-renewal-reminder',
    ],
  );
  for (const t of templateVariables) {
    assert.ok(t.name && t.subject && t.html, t.alias);
    const used = new Set(
      [...`${t.subject}${t.html}`.matchAll(/\{\{\{([^}]*)\}\}\}/g)].map((m) => m[1]),
    );
    const declared = t.variables.map((v) => v.key);
    assert.deepEqual([...used].sort(), [...declared].sort(), t.alias);
    for (const v of t.variables) {
      assert.match(v.key, /^[A-Z][A-Z0-9_]{0,49}$/, v.key);
      assert.equal(RESERVED.includes(v.key.toUpperCase()), false, v.key);
      assert.equal(v.type, 'string');
    }
  }
  const keysOf = (alias) =>
    templateVariables.find((t) => t.alias === alias).variables.map((v) => v.key);
  for (const alias of ['event-registration-confirmation', 'event-announcement', 'event-reminder'])
    assert.ok(keysOf(alias).includes('PERK_HTML'), `${alias} has PERK_HTML`);
  assert.ok(keysOf('event-registration-confirmation').includes('ANSWERS_HTML'));
  assert.ok(keysOf('event-announcement').includes('REGISTER_URL'));
  assert.ok(keysOf('event-reminder').includes('ACTION_HTML'));
  assert.deepEqual(keysOf('event-thank-you'), [...SITE_KEYS, 'EVENT_TITLE_ZH', 'EVENT_TITLE']);
  assert.deepEqual(keysOf('news-general'), SITE_KEYS);
  assert.deepEqual(keysOf('membership-renewal-reminder'), SITE_KEYS);
});

test('templateVariables: the rendered emails are these templates filled in', () => {
  // Replace each placeholder with a pattern that matches anything; the rendered
  // email must match the rest of the template character for character.
  const shape = (template) =>
    new RegExp(
      `^${template
        .split(/\{\{\{[A-Z0-9_]+\}\}\}/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\S]*')}$`,
    );
  const byAlias = Object.fromEntries(templateVariables.map((t) => [t.alias, t]));
  for (const [alias, email] of [
    ['event-registration-confirmation', confirm()],
    ['event-announcement', announce()],
    ['event-reminder', news('reminder')],
    ['event-reminder', news('reminder', { event: MID_AUTUMN })],
    ['event-thank-you', news('thanks')],
    ['news-general', news('general')],
    ['membership-renewal-reminder', news('renewal')],
  ]) {
    assert.match(email.html, shape(byAlias[alias].html), alias);
    assert.match(email.subject, shape(byAlias[alias].subject), alias);
  }
});

// ------------------------------------------------------------ Compose News ----

test('newsTemplate: announcement is eventAnnouncement; an unknown name throws', () => {
  assert.deepEqual(news('announcement', { event: MID_AUTUMN }), announce());
  assert.throws(() => news('bogus'), /Unknown news template: bogus/);
});

test('newsTemplate reminder: when, where, the gift and the registration link for an event that takes registrations', () => {
  const { subject, html } = news('reminder');
  assert.equal(subject, '中秋节 · Mid-Autumn Festival 中秋节 活动提醒 / Event reminder');
  const t = text(html);
  assert.match(t, /中秋节 即将举行/);
  assert.match(html, /Sunday, September 27, 2026 at 2:00\sPM – 6:00\sPM/);
  assert.match(t, /Siebel Center for Design/);
  assert.match(t, /免费领月饼 · Free mooncake/);
  const reg = 'https://caaciorg.com/events/mid-autumn-festival/register/';
  assert.ok(html.includes(`href="${reg}"`));
  assert.match(t, /Not registered yet, or need to change your answers\?/);
  assert.equal(PLACEHOLDER.test(subject + html), false, 'ready to send as it is');

  // After the gift deadline the gift box is gone and the link stays.
  const late = news('reminder', { now: Date.parse('2026-09-28T00:00:00Z') });
  assert.doesNotMatch(late.html, /免费领/);
  assert.ok(late.html.includes(`href="${reg}"`));
});

test('newsTemplate reminder: an event that takes no registrations gets no registration link and no gift', () => {
  const { html } = news('reminder', { event: MID_AUTUMN }); // no registration_questions
  assert.doesNotMatch(html, /\/register\//);
  assert.doesNotMatch(html, /免费领/);
  assert.ok(html.includes('href="https://caaciorg.com/events/"'));
});

test('newsTemplate thanks: the event title, text to fill in, and a link to upcoming events', () => {
  const { subject, html } = news('thanks');
  assert.equal(subject, '中秋节 · Mid-Autumn Festival 中秋节 感谢参与 / Thank you');
  assert.match(text(html), /感谢大家参加 中秋节 ！/);
  assert.ok(PLACEHOLDER.test(html));
  assert.match(html, /【待填写：相册链接】/);
  assert.ok(html.includes('href="https://caaciorg.com/events/"'));
  assert.doesNotMatch(html, /免费领|\/register\//);
});

test('newsTemplate general and renewal: no event; general has text to fill in, renewal is ready to send', () => {
  const general = newsTemplate('general', { origin: ORIGIN, logo: LOGO });
  assert.equal(general.subject, 'CAACI 通讯 / CAACI News');
  assert.ok(PLACEHOLDER.test(general.html));
  assert.match(general.html, /\[To fill in: English heading\]/);
  assert.ok(general.html.includes(`src="${LOGO}"`));
  assert.match(text(general.html), /Visit caaciorg\.com/);

  const renewal = newsTemplate('renewal', { origin: ORIGIN, logo: LOGO });
  assert.equal(renewal.subject, 'CAACI 会员续费提醒 / Membership renewal reminder');
  assert.equal(PLACEHOLDER.test(renewal.subject + renewal.html), false);
  assert.ok(renewal.html.includes('href="https://caaciorg.com/membership/"'));
  assert.ok(renewal.html.includes('href="https://caaciorg.com/account/"'));
});

test('newsTemplate: event text is escaped in the reminder and the thank-you', () => {
  const hostile = {
    ...REGISTERING,
    title: '<b>Gala</b>',
    title_zh: '<i>晚会</i>',
    location: '<img src=x>',
    slug: 'a"b',
  };
  for (const name of ['reminder', 'thanks']) {
    const { html } = news(name, { event: hostile });
    assert.doesNotMatch(html, /<b>|<i>|<img src=x>/, name);
    assert.match(html, /&lt;i&gt;晚会&lt;\/i&gt;/, name);
  }
  assert.ok(news('reminder', { event: hostile }).html.includes('/events/a%22b/register/'));
});

test('PLACEHOLDER matches the fill-in markers and nothing like them', () => {
  for (const s of ['【待填写：标题】', '[To fill in: heading]']) assert.ok(PLACEHOLDER.test(s), s);
  for (const s of ['【活动】', '[To fill]', 'To fill in', '待填写'])
    assert.equal(PLACEHOLDER.test(s), false, s);
});

test('esc escapes the five HTML characters', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});
