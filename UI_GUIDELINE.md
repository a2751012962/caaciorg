# CAACI — Unified UI Guideline / 统一界面规范

The public site is a **byte-for-byte mirror** of caaciorg.com (WordPress + Divi).
Its look is therefore *fixed* — we do not restyle it. This guideline governs the
**custom UI we layer on top** (login wiring, the account box, form notices, and
any future member/admin pages or modals) so that everything we add looks like it
was always part of the site.

> 网站前端是 caaciorg.com 的逐字节镜像，外观固定不可改。本规范约束我们**新增**的
> 界面（账户区、表单提示、未来的会员/管理页面等），确保新组件与镜像风格一致。

**Source of truth:** [`src/caaci-ui.css`](src/caaci-ui.css) holds every token below as a
CSS variable. Use the variables / classes — never hard-code a hex value or paste
inline styles into [`src/caaci-app.js`](src/caaci-app.js).

---

## 1. Brand palette

Warm earth tones — a Chinese-American identity in terracotta, maroon, and gold.
Values are lifted from the live site's compiled Divi CSS (the `et_color_scheme_red`
scheme plus the homepage/contact module).

| Token | Hex | Role |
|---|---|---|
| `--caaci-brick` | `#8e2e11` | **Primary action** — button background, section accent borders |
| `--caaci-brick-dark` | `#561100` | Primary action hover / pressed |
| `--caaci-maroon` | `#300200` | Display headings (Playfair) |
| `--caaci-red` | `#cd5c5c` | Links, active nav, the Divi "red" scheme key color |
| `--caaci-rust` | `#ce4327` | Fixed-header active nav, warm accent |
| `--caaci-rust-deep` | `#aa4e20` | Dropdown borders, secondary warm accent |
| `--caaci-clay` | `#b27c77` | Dusty-rose section backgrounds |
| `--caaci-gold` | `#edbb5f` | Eyebrow / sub-heading accent |

**Neutrals:** `--caaci-ink #000` · `--caaci-body rgba(0,0,0,.78)` ·
`--caaci-muted #666` · `--caaci-line #dfdfe3` (borders) · `--caaci-fill #f3f3f3` ·
`--caaci-surface #fff` · `--caaci-plum #3d2d33` (dark panels).

**Status:** `--caaci-success #1a7f37` · `--caaci-error #b3261e`.

> **Do not** introduce `#2ea3f2` (Divi's default blue). It appears in the compiled
> CSS but is a leftover theme default, not a CAACI brand color. Links are
> `--caaci-red`, actions are `--caaci-brick`.

---

## 2. Typography

| Use | Stack | Notes |
|---|---|---|
| Display / headings | `--caaci-font-display` → `'cwTeXFangSong', 'Playfair Display', Georgia, serif` | Color `--caaci-maroon`, letter-spacing 1–3px |
| Body / UI | `--caaci-font-body` → `'cwTeXFangSong', 'Poppins', Helvetica, Arial, sans-serif` | line-height 1.8 |

The live site overrides **all** text to `cwTeXFangSong` to keep the EN/中文 layout
uniform, so it is listed first in both stacks. Added UI inherits the same face
automatically.

**Type scale:** display `48px` · h2 `38px` · h3 `24px` · body `18px` · small `16px`
· eyebrow `14px` (uppercase, letter-spacing 1px). Tokens: `--caaci-fs-*`.

---

## 3. Shape, spacing & motion

- **Radius:** `--caaci-radius: 3px` (the mirror's standard). Use `--caaci-radius-0`
  for squared elements that echo the contact-form submit button.
- **Border:** `--caaci-border: 2px solid` (Divi button convention).
- **Card shadow:** `--caaci-shadow: 0 15px 80px -6px rgba(0,0,0,.2)`.
- **Gap / rhythm:** base `--caaci-gap: 24px`.
- **Content width:** `--caaci-content-max: 1080px` (matches Divi `.container`).
- **Transition:** `--caaci-transition: .2s ease`.

---

## 4. Components

All custom UI is namespaced `.caaci-*` so it can never collide with Divi classes.

| Class | What it is | Use for |
|---|---|---|
| `.caaci-notice` | Inline feedback line. Add `data-state="error"` for the red variant. | Form success/error messages |
| `.caaci-card` | White boxed panel (max 620px, centered, shadowed). | Account area, member panels |
| `.caaci-eyebrow` | Small uppercase gold label. | Label above a heading |
| `.caaci-btn` | Filled brick button. | Primary actions |
| `.caaci-btn--secondary` | Outlined brick button. | Secondary actions |

### Examples

```html
<!-- feedback -->
<p class="caaci-notice">Thank you! Your message has been sent.</p>
<p class="caaci-notice" data-state="error">Email is required.</p>

<!-- account / member panel -->
<div class="caaci-card">
  <span class="caaci-eyebrow">Membership</span>
  <h2>My Account</h2>
  <p><b>Email:</b> you@example.com</p>
  <a class="caaci-btn" href="/membership/">Manage membership</a>
</div>
```

---

## 5. Rules

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
