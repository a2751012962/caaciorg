// Shapes the /account/ page reads: its own rows through Supabase RLS
// (membership_tiers, payments, rsvps, events) and GET /api/family
// (functions/api/family.js). The members row itself is MemberRow in lib/auth.
export type { MemberRow } from '../lib/auth';

// One membership tier after mergeTiers (live row over TIERS_FALLBACK).
export interface Tier {
  id: string;
  name: string;
  name_zh?: string;
  price_cents: number;
  invite_only?: boolean;
  description?: string;
  description_zh?: string;
}

// payments (0008 + refund columns from 0010), readable by its member.
export interface PaymentRow {
  id: string;
  paid_at: string | null;
  kind: string | null; // membership (first year) | renewal
  amount_cents: number | null;
  currency: string | null;
  tier_id: string | null;
  refunded_cents: number | null;
}

// The published-event columns the account page shows.
export interface EventSummary {
  id: string;
  slug: string | null;
  title: string;
  title_zh: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
}

// An event the member signed up for: an RSVP (rsvps_self_read) or a
// registration form entry (GET /api/event-register, upcoming events only).
export interface RegisteredEvent {
  key: string;
  source: 'rsvp' | 'registration';
  event: EventSummary;
  guests: number | null;
  registered_at: string | null;
}

// ---- GET /api/family ----
export type FamilyRole = 'founder' | 'member' | 'none';

export interface FamilyPlan {
  tier_id: string | null;
  status: string | null;
  expires_at: string | null;
}

export interface FamilyPerson {
  id: string;
  kind: 'account' | 'name_only';
  member_id: string | null;
  full_name: string | null;
  relationship: string | null;
  is_founder: boolean;
  linked: boolean;
}

export interface FamilyInvite {
  id: string;
  email: string;
  full_name: string | null;
  relationship: string | null;
  person_id: string | null;
  status: string;
  created_at: string | null;
  expires_at: string | null;
}

export interface FamilyEvent {
  type: string;
  actor_email: string | null;
  subject_email: string | null;
  subject_name: string | null;
  created_at: string | null;
}

export interface InvitationForMe {
  id: string;
  household_name: string | null;
  founder_email: string | null;
  expires_at: string | null;
}

export interface FamilyData {
  role: FamilyRole;
  can_start_family: boolean | null;
  household: { id: string; name: string | null; status: string | null } | null;
  plan: FamilyPlan | null;
  founder: { member_id: string; email: string | null } | null;
  seats: { used: number; limit: number };
  people: FamilyPerson[];
  invites: FamilyInvite[];
  events: FamilyEvent[];
  invitations_for_me: InvitationForMe[];
}

// POST /api/family answers { ok } plus these on some actions, or { error }.
export interface FamilyActionData {
  ok?: boolean;
  delivered?: 'invite' | 'magic_link';
  retry_after?: number;
  notified?: boolean;
}
