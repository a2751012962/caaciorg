# Illini Market entry points

## Scope

The CAACI website introduces Illini Market to local residents and students through the home page, Resources page, desktop/mobile navigation, footer, and the shared login/privacy header. English and Chinese copy follows the website language.

The primary link opens the marketplace directly in a separate tab. Fixed campaign parameters distinguish home, resources, navigation, and footer placements; they contain no member identifiers. These parameters do not by themselves implement conversion tracking. The secondary link opens Community & contact (the Chinese link goes to its Chinese section).

CAACI membership and Illini Market remain separate accounts. This change transfers no session, membership, billing, or personal data. It does not enable the WeChat mini program or promise identity, transaction, or payment guarantees.

The shared login-page language toggle also updates an explicit `lang` query parameter before navigation. Previously, opening `?lang=en` and choosing Chinese reloaded the English page. The fix preserves other parameters and the fragment; a regression test covers both directions.

## Ready-to-use newsletter copy

### English

**Looking for a desk, or ready to pass yours on?**

Local buy-and-sell posts can be hard to find when they are scattered across group chats. Illini Market brings items for sale and wanted posts together for UIUC and Champaign–Urbana. Browse by category, search for what you need, or message a seller to check the details and arrange pickup. The website supports English and Chinese.

Have something to sell, or something specific you need? Try one post. If a step feels confusing or does not work, use the Community & contact page to send feedback to Eric, the developer. The WeChat mini program is still being prepared; the website is available now.

[Explore Illini Market](https://www.illinimarket.com/?utm_source=caaci&utm_medium=newsletter&utm_campaign=community_marketplace) · [Community & contact](https://www.illinimarket.com/community)

### 中文

**想找张桌子，还是有张闲置桌子想转给邻居？**

本地二手信息常常散落在不同的微信群里，刚好需要的人未必看得到。Illini 集市把 UIUC 和香槟–厄巴纳的出售、求购信息放在一起：可以按分类浏览、搜索想找的东西，也可以私信对方，确认尺寸和成色后再约取货。网站支持中文和英文。

有闲置，或正在找一件东西，都欢迎先发一条试试。遇到不顺手、点了没反应的地方，可以从“社区与联系”页面告诉开发者 Eric。微信小程序还在准备中，现在可以先用网站。

[逛逛 Illini 集市](https://www.illinimarket.com/?utm_source=caaci&utm_medium=newsletter&utm_campaign=community_marketplace) · [社区与联系](https://www.illinimarket.com/community#zh)

## Release notes

- Newsletter copy is prepared only; it has not been added to a mailing list or sent.
- The public website inspected on September 17, 2026 still showed the older WordPress/Divi page. This branch targets the React frontend in repository main. Confirm the intended frontend rollout before merging; SETUP.md says main triggers production deployment.
- Existing account, payment, and backend behavior is outside this link-only change.
