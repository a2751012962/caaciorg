// Switches for /account/ features whose UI is built but whose backend is not.
//
// All three are false, and with all three false the account page renders
// exactly as it did before they existed. Turn one on only once the backend work
// in its comment is live (database + Pages Function) AND its stub in
// lib/account.ts calls it. Until then the stub answers
// { ok: false, error: 'not_available' }, so flipping a flag early shows a
// "not available yet" message — never a fake success, and nothing is written.
export const FEATURES = {
  /**
   * "Edit" on the Personal Information card → pages/account/ProfileEditModal.tsx
   * (contact phone, secondary phone, WeChat, mailing address, interests; the
   * name stays locked). Stub: updateProfile() in lib/account.ts.
   *
   * Before enabling:
   * - An endpoint, e.g. POST /api/profile (functions/api/profile.js), that
   *   authenticates the caller (requireUser) and, with the service role, updates
   *   ONLY the caller's own members row and ONLY whitelisted contact columns —
   *   never full_name, email, tier_id, status, is_admin, stripe_*, household_id,
   *   member_since or expires_at. 0014_members_rls_lockdown revoked browser
   *   writes on members because the old self-update policy let a member grant
   *   themselves is_admin or a paid tier; do not bring back an RLS update policy.
   * - A migration for the columns that do not exist yet. members has only
   *   full_name / email / phone, so secondary_phone, wechat, mailing_address and
   *   interests need adding; then add them to MemberRow (lib/auth.tsx) so the
   *   dialog can prefill them (it prefills only phone today).
   * - updateProfile() calling the endpoint; the page already refreshes the
   *   member row after a successful save.
   */
  profileEdit: false,

  /**
   * "Feedback" on concluded events in My Registered Events →
   * pages/account/EventFeedback.tsx (1–5 stars, highlight tags, optional
   * comment). Stub: submitEventFeedback() in lib/account.ts.
   *
   * Before enabling:
   * - A table, e.g. public.event_feedback (event_id → events, member_id →
   *   auth.users, rating smallint check 1–5, tags text[], comment text,
   *   created_at, unique (event_id, member_id)) with RLS enabled: a member may
   *   read their own rows; browser insert/update/delete revoked, as 0013 does
   *   for rsvps.
   * - An endpoint, e.g. POST /api/event-feedback, that authenticates the caller,
   *   checks they RSVP'd or registered for that event and that it has ended,
   *   validates rating/tags/comment length, and upserts the row with the
   *   service role.
   * - submitEventFeedback() calling it. To show "already sent" after a reload,
   *   also read the member's own feedback rows when the events load.
   */
  eventFeedback: false,

  /**
   * "Cancel RSVP" on upcoming RSVPs in My Registered Events →
   * pages/account/CancelRsvp.tsx (confirm dialog). Registration-form entries
   * (event_registrations, 0015) are not offered: they are changed on their own
   * register form. Stub: cancelRsvp() in lib/account.ts.
   *
   * Before enabling:
   * - An endpoint that deletes the caller's own rsvps row for an event with the
   *   service role — e.g. a DELETE handler in functions/api/rsvp.js (today it
   *   only has POST) — refusing events that have already started.
   *   0013_business_rsvps_rls revoked browser delete on rsvps, so this cannot be
   *   done from the page with the anon key.
   * - cancelRsvp() calling it; the page already drops the card on success.
   */
  rsvpCancel: false,
} as const;
