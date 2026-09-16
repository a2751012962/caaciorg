// Copy for the 404 page (web/src/pages/NotFoundPage.tsx). build.mjs writes
// the app at dist/404.html, which Cloudflare Pages serves, with a 404 status,
// for any address that matches no file, rewrite or stub.
export interface NotFoundData {
  eyebrow: string;
  title: string;
  subtitle: string;
  body: string;
  requested: string;
  home: string;
  events: string;
  membership: string;
  contact: string;
}

export const notFoundDataEN: NotFoundData = {
  eyebrow: 'Error 404',
  title: 'Page not found',
  subtitle: 'The page you asked for is not here.',
  body: 'The address may be mistyped, or the page moved when the site was rebuilt. Pick up from one of these instead.',
  requested: 'You asked for',
  home: 'Back to the homepage',
  events: 'Events',
  membership: 'Membership',
  contact: 'Contact us',
};

export const notFoundDataZH: NotFoundData = {
  eyebrow: '错误 404',
  title: '找不到页面',
  subtitle: '您访问的页面不存在。',
  body: '网址可能输错了，或者该页面在网站改版后已经移动。您可以从下面继续浏览。',
  requested: '您访问的地址',
  home: '返回首页',
  events: '活动',
  membership: '会员',
  contact: '联系我们',
};
