# CAACI — Unified UI Guideline / 统一界面规范

The public site is a **byte-for-byte mirror** of caaciorg.com (WordPress + Divi).
Its look is therefore _fixed_ — we do not restyle it. This guideline governs the
**custom UI we layer on top of the public mirror** (contact-form notices, the donation
checkout, accessibility repairs) so that everything we add looks like it was
always part of the site.

> 网站前端是 caaciorg.com 的逐字节镜像，外观固定不可改。本规范约束我们**新增**的
> 界面（表单提示、捐款弹窗、无障碍修补等），确保新组件与镜像风格一致。

**Two layers, one set of tokens.**

| Layer          | Pages                                                            | Built with                       | Styled by                                                                                  |
| -------------- | ---------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| Mirror overlay | every mirrored WordPress page                                    | `caaci-app.js` injects markup    | `.caaci-*` component classes in [`src/caaci-ui.css`](src/caaci-ui.css)                     |
| Tabler pages   | `/admin/`, `/login-3/`, `/membership/`, `/account/`, `/privacy/` | **Tabler** (`@tabler/core`, MIT) | Tabler/Bootstrap classes, skinned by [`src/caaci-theme.css`](src/caaci-theme.css) — see §5 |

Both layers read the same `--caaci-*` tokens. The Tabler pages use Tabler classes
only, never `.caaci-*` visual classes (element `id`s and `data-*` hooks keep the
`caaci-` prefix, CSS classes do not). The `.caaci-*` vocabulary in §4 applies to
the mirror overlay alone.

**Source of truth:** [`src/caaci-ui.css`](src/caaci-ui.css) holds every token below as a
CSS variable. Use the variables / classes — never hard-code a hex value or paste
inline styles into [`src/caaci-app.js`](src/caaci-app.js) or a page file.
[`test/ui-consistency.test.js`](test/ui-consistency.test.js) fails the build when a
page carries a `<style>` block, a `style=""` attribute or a hex literal, when a
stylesheet defines a class nothing references, or when `--tblr-*` is overridden
outside the theme file.

---

## 1. Brand palette

Warm earth tones — a Chinese-American identity in terracotta, maroon, and gold.
Values are lifted from the live site's compiled Divi CSS (the `et_color_scheme_red`
scheme plus the homepage/contact module).

| Token                | Hex       | Role                                                           |
| -------------------- | --------- | -------------------------------------------------------------- |
| `--caaci-brick`      | `#8e2e11` | **Primary action** — button background, section accent borders |
| `--caaci-brick-dark` | `#561100` | Primary action hover / pressed                                 |
| `--caaci-maroon`     | `#300200` | Display headings (Playfair)                                    |
| `--caaci-red`        | `#cd5c5c` | Links, active nav, the Divi "red" scheme key color             |
| `--caaci-rust`       | `#ce4327` | Fixed-header active nav, warm accent                           |
| `--caaci-rust-deep`  | `#aa4e20` | Dropdown borders, secondary warm accent                        |
| `--caaci-clay`       | `#b27c77` | Dusty-rose section backgrounds                                 |
| `--caaci-gold`       | `#edbb5f` | Eyebrow / sub-heading accent                                   |

**Neutrals:** `--caaci-ink #000` · `--caaci-body rgba(0,0,0,.78)` ·
`--caaci-muted #666` · `--caaci-line #dfdfe3` (borders) · `--caaci-fill #f3f3f3` ·
`--caaci-surface #fff` · `--caaci-plum #3d2d33` (dark panels).

**Status:** `--caaci-success #1a7f37` · `--caaci-error #b3261e`.

**RGB triplets:** `--caaci-brick-rgb`, `--caaci-red-rgb`, `--caaci-surface-rgb`,
`--caaci-success-rgb`, `--caaci-error-rgb` hold the same colours as `r, g, b` for
`rgba()` tints and the Tabler `-rgb` variables. Change both when a hex changes.

> **Do not** introduce `#2ea3f2` (Divi's default blue). It appears in the compiled
> CSS but is a leftover theme default, not a CAACI brand color. Links are
> `--caaci-red`, actions are `--caaci-brick`.

---

## 2. Typography

| Use                | Stack                                                                                      | Notes                                        |
| ------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Display / headings | `--caaci-font-display` → `'Playfair Display', Georgia, 'Times New Roman', 'cwTeXFangSong'` | Color `--caaci-maroon`, letter-spacing 1–3px |
| Body / UI          | `--caaci-font-body` → `'Poppins', Helvetica, Arial, 'cwTeXFangSong', sans-serif`           | line-height 1.8                              |
| Buttons            | `--caaci-font-button` → `'Saira Extra Condensed', Helvetica, Arial, 'cwTeXFangSong'`       | uppercase, letter-spacing 1px, weight 600    |

What actually renders on the mirror (measured, not assumed): Divi sets all body and
menu text to `cwTeXFangSong`, but that face is never served, so body copy and the
navigation fall back to the **system sans-serif**. Headings really are Playfair
Display and buttons really are Saira Extra Condensed — both loaded from Google
Fonts by the mirror, and by `caaci-theme.css` for the Tabler pages. Poppins is in
the body stack for parity with the theme settings but is deliberately not loaded
(§5). `cwTeXFangSong` stays at the end of every stack as the CJK fallback.

**Type scale:** display `48px` · h2 `38px` · h3 `24px` · body `18px` · small `16px`
· eyebrow `14px` (uppercase, letter-spacing 1px). Tokens: `--caaci-fs-*`.

---

## 3. Shape, spacing & motion

- **Radius:** `--caaci-radius: 3px` (the mirror's standard, also applied to every
  Tabler control and card). Use `--caaci-radius-0` for squared elements that echo
  the contact-form submit button; `--caaci-radius-card: 12px` is reserved for the
  digital membership card's physical-card silhouette.
- **Border:** `--caaci-border: 2px solid` (Divi button convention).
- **Card shadow:** `--caaci-shadow: 0 15px 80px -6px rgba(0,0,0,.2)`.
- **Gap / rhythm:** base `--caaci-gap: 24px`.
- **Content width:** `--caaci-content-max: 1080px` (matches Divi `.container`).
- **Transition:** `--caaci-transition: .2s ease`.

---

## 4. Components (mirror overlay)

All custom UI is namespaced `.caaci-*` so it can never collide with Divi classes.

| Class            | What it is                                                          | Use for                     |
| ---------------- | ------------------------------------------------------------------- | --------------------------- |
| `.caaci-notice`  | Inline feedback line. Add `data-state="error"` for the red variant. | Form success/error messages |
| `.caaci-eyebrow` | Small uppercase gold label.                                         | Label above a heading       |
| `.caaci-btn`     | Filled brick button.                                                | Primary actions             |

### Examples

```html
<!-- feedback -->
<p class="caaci-notice">Thank you! Your message has been sent.</p>
<p class="caaci-notice" data-state="error">Email is required.</p>

<!-- donation summary (caaci-app.js openDonation) -->
<aside class="caaci-summary">
  <span class="caaci-eyebrow">Order summary · 订单</span>
  <h3>One-time donation · 一次性捐款</h3>
  <button class="caaci-btn">Donate $50.00 · 捐赠</button>
</aside>
```

---

## 5. Tabler pages (admin + member)

[`src/caaci-theme.css`](src/caaci-theme.css) is the only place Tabler is skinned. It
re-points Tabler's own variables at the tokens, so every `btn-primary`, link, tab,
badge, focus ring and corner takes the brand look with no page-level CSS:

| Tabler variable                                 | Token                                 |
| ----------------------------------------------- | ------------------------------------- |
| `--tblr-primary` / `-rgb` / `-darken` / `-lt`   | `--caaci-brick`, `--caaci-brick-dark` |
| `--tblr-link-color` / `--tblr-link-hover-color` | `--caaci-red` → `--caaci-brick`       |
| `--tblr-success` / `--tblr-danger`              | `--caaci-success` / `--caaci-error`   |
| `--tblr-font-sans-serif`                        | `--caaci-font-body`                   |
| `--tblr-border-radius` (+ `-sm`, `-lg`)         | `--caaci-radius`                      |

Three element rules finish the match with the mirror: `h1`–`h3` are set in
`--caaci-font-display`, maroon, 1px tracking (white inside `.caaci-hero`);
`.btn-primary` is the Divi CTA — `--caaci-font-button`, uppercase, 1px tracking,
`--caaci-radius-0` — the same shape as the overlay's `.caaci-btn`; and the theme
`@import`s the Playfair Display and Saira Extra Condensed faces the mirror already
loads from Google Fonts, so headings and buttons resolve to the same glyphs on both
kinds of page. Poppins is deliberately not loaded: Divi sets all body and menu text
to cwTeXFangSong, which is never served, so the mirror's body copy renders in the
system sans-serif, and the `--caaci-font-body` stack falls back to the same face.

The site navigation is measured against the mirror's Divi header, not designed
independently: 69px bar, no shadow, 40px logo, menu right-aligned to the container,
14px/600 black links 22px apart, carets 4px after their label, language toggle and
Log In / Sign out as plain menu items.

Every Tabler page links, in this order: `tabler.min.css` → `caaci-ui.css` (tokens) →
`caaci-theme.css`. Shared chrome lives in the theme file under named sections:

| Section         | Class            | Used on                                     |
| --------------- | ---------------- | ------------------------------------------- |
| Site navigation | `.caaci-sitenav` | admin header and `member-src/_nav.html`     |
| Hero band       | `.caaci-hero`    | `/membership/`, `/account/`                 |
| Membership card | `.caaci-mcard2`  | `/account/` (rendered by `caaci-member.js`) |
| Long-form copy  | `.caaci-legal`   | `/privacy/`                                 |

A page that needs something new gets a section here, written in tokens — not a
`<style>` block. Prefer a Tabler utility or component first.

---

## 6. Rules

1. **Never edit the mirror by hand.** `mirror/` is pristine; all custom behaviour
   and styling lives in `src/` and is injected at build time (see
   [`build.mjs`](build.mjs)).
2. **No inline styles in JS.** Add a class to `caaci-ui.css` and reference it.
   The one historical exception (the account box) has been migrated.
3. **Use tokens, not literals.** New color/size → add a `--caaci-*` variable.
4. **Bilingual first.** Every added string needs an EN and 中文 form; don't assume
   a font — inherit `--caaci-font-body`. Don't hard-set a Latin-only family.
5. **Stay subordinate to the mirror.** Added UI should read as part of the page,
   not as a different app. Match radius (3px), the warm palette, and the serif/
   sans pairing above.
6. **Tabler pages carry no CSS of their own.** No `<style>` blocks, no `style=""`
   attributes, no hex literals in `admin-src/` or `member-src/`. Shared chrome goes
   in `caaci-theme.css`; `--tblr-*` is overridden there and nowhere else.
7. **No dead classes.** A `.caaci-*` class in either stylesheet must be referenced
   by a page or a client module; delete the rule when the last use goes.
8. **Design tools are downstream.** A Figma library or a Stitch mock is a picture of
   these tokens, not a second source of truth: change the token here first, then
   the mock.
