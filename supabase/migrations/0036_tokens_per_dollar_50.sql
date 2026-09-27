-- 0036 — $1 buys 50 tokens (was 10).
--
-- Owner's decision on 2026-09-27: change the rate and NOTHING else. There is
-- one rate in the system, token_settings.tokens_per_dollar, and every reader
-- (buy page, cash desk, Stripe webhook, wallet, menus, settlement) takes it
-- from this row, so this single update is the whole change. Deliberately NOT
-- rescaled here, so the owner knows what the new rate does to them:
--
--   * Existing balances keep their token count and are now worth 2¢ a token
--     (450 tokens: $45 → $9). Bought tokens in the treasurer's "still owed"
--     figure shrink the same way.
--   * Menu prices stay in tokens as entered. A 30-token drink now costs 60¢ of
--     bought tokens instead of $3. Reprice by hand if that is not intended.
--   * Partner shops are settled at tokens_per_dollar (0024), so they are paid
--     2¢ per token taken from now on — including tokens sold before today.
--   * Yearly grants (150/450/900), the honorary 20, max_charge (500 tokens),
--     admin_mint_cap and admin_daily_cap are all token counts and stay as they
--     are; in dollars they are now a fifth of what they were.
--   * The 0028 Mid-Autumn bonus (+50% on 2026-09-27) stacks on top: $1 buys 75.
--
-- The column default moves too, so a fresh database starts at the same rate
-- as this one. Re-running the file is harmless.

alter table public.token_settings
  alter column tokens_per_dollar set default 50;

update public.token_settings
   set tokens_per_dollar = 50,
       updated_at        = now()
 where id
   and tokens_per_dollar <> 50;
