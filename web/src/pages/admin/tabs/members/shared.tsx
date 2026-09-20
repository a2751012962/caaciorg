// Pieces the Members and Families tabs share: row types, the tier / status /
// family options (src/caaci-admin.js "shared form helpers"), and the in-page
// "are you sure?" step that replaces the old window.confirm for actions that
// are not deletions (deletions use InlineConfirm).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HelpCircle } from 'lucide-react';
import { listExit, mountIn, riseFromSm, shown } from '../../../../lib/motion';
import { MEMBER_STATUSES, PRIMARY, SECONDARY, memberStatusLabel, useAdmin } from '../../kit';

export interface MemberRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  tier_id: string | null;
  status: string | null;
  member_since: string | null;
  expires_at: string | null;
  household_id: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  tier_id: string | null;
  /** So the status can be read as of today (effectiveStatus), not as stored. */
  expires_at: string | null;
}
export interface Person {
  id: string;
  household_id: string;
  member_id: string | null;
  full_name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}
export interface Invite {
  id: string;
  email: string;
  full_name: string | null;
  relationship: string | null;
  created_at: string;
  expires_at: string;
  person_id: string | null;
}
export interface FamilyEvent {
  type: string;
  actor_email: string | null;
  subject_email: string | null;
  subject_name: string | null;
  created_at: string;
}
export interface Household {
  id: string;
  name: string;
  tier_id: string | null;
  status: string;
  member_since: string | null;
  expires_at: string | null;
  notes: string | null;
  founder_member_id?: string | null;
  accounts?: Account[];
  people?: Person[];
  founder?: { id: string; full_name: string | null; email: string | null } | null;
  invites?: Invite[];
  events?: FamilyEvent[];
  seats_used?: number;
  seats_limit?: number;
}
export interface PlanMember {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  member_since: string | null;
  expires_at: string | null;
}
export interface HouseholdsAnswer {
  rows: Household[];
  invites_available?: boolean;
  /** null = the server could not read them; missing = an older server. */
  family_plan_members?: PlanMember[] | null;
}

/** A household (family) status list has no past_due. */
export const FAMILY_STATUSES = ['active', 'pending', 'expired', 'cancelled'] as const;
export const RELATIONSHIPS = ['head', 'spouse', 'child', 'parent', 'other'] as const;

type T = (en: string, zh: string) => string;

export function relationshipLabel(t: T, r: string | null | undefined) {
  return (
    {
      head: t('Head', '户主'),
      spouse: t('Spouse', '配偶'),
      child: t('Child', '子女'),
      parent: t('Parent', '父母'),
      other: t('Other', '其他'),
    }[r || ''] ||
    r ||
    ''
  );
}

export function TierOptions() {
  const { t, tiers } = useAdmin();
  return (
    <>
      <option value="">{t('— none —', '— 无 —')}</option>
      {tiers.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </>
  );
}

export function StatusOptions({ list = MEMBER_STATUSES }: { list?: readonly string[] }) {
  const { t } = useAdmin();
  return (
    <>
      {list.map((s) => (
        <option key={s} value={s}>
          {memberStatusLabel(t, s)}
        </option>
      ))}
    </>
  );
}

export function HouseholdOptions({ households }: { households: Household[] }) {
  const { t } = useAdmin();
  return (
    <>
      <option value="">{t('— none —', '— 无 —')}</option>
      {households.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ ask step

interface Asking {
  text: string;
  confirmLabel: string;
  run: () => void | Promise<void>;
}

/**
 * `ask(text, confirmLabel, run)` shows the question inline; `run` goes only
 * after Confirm. Render `panel` where the question should appear.
 *
 * `ruled: false` drops the panel's own rule above, for a panel that already
 * sits inside a ruled-off block — two rules there read as two blocks.
 */
export function useAsk({ ruled = true }: { ruled?: boolean } = {}): {
  ask: (text: string, confirmLabel: string, run: Asking['run']) => void;
  asking: boolean;
  panel: ReactNode;
} {
  const { t } = useAdmin();
  const [q, setQ] = useState<Asking | null>(null);
  const ask = useCallback(
    (text: string, confirmLabel: string, run: Asking['run']) => setQ({ text, confirmLabel, run }),
    [],
  );
  const panel = (
    <AnimatePresence initial={false}>
      {q && (
        <motion.div
          key="ask"
          initial={riseFromSm}
          animate={shown}
          exit={listExit}
          transition={mountIn}
          role="alertdialog"
          aria-live="polite"
          className={`space-y-3 ${ruled ? 'pt-4 border-t border-neutral-200/80' : 'pt-2'}`}
        >
          <div className="flex items-start gap-2 text-sm text-neutral-800">
            <HelpCircle className="w-4 h-4 mt-0.5 shrink-0 text-brick" aria-hidden />
            <p className="whitespace-pre-line leading-relaxed min-w-0 break-words">{q.text}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={PRIMARY}
              autoFocus
              onClick={() => {
                const run = q.run;
                setQ(null);
                void run();
              }}
            >
              {q.confirmLabel}
            </button>
            <button type="button" className={SECONDARY} onClick={() => setQ(null)}>
              {t('Cancel', '取消')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return { ask, asking: !!q, panel };
}

/** Re-renders once a second while `active`; returns Date.now(). */
export function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

export type Msg = { tone: 'success' | 'error'; text: string } | null;
