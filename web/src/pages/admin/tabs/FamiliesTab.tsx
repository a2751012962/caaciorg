import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil, Plus, Search as SearchIcon, UserPlus, X } from 'lucide-react';
import { listExit, listItem, mountIn, riseFromSm, shown } from '../../../lib/motion';
import {
  DIVIDED,
  DataTable,
  EYEBROW,
  Field,
  INPUT,
  InlineConfirm,
  LiquidToggle,
  Loaded,
  Notice,
  PRIMARY,
  ROW_BTN,
  SECONDARY,
  SECTION,
  SELECT,
  Status,
  TEXTAREA,
  TabHeader,
  dateInput,
  fmtDate,
  memberStatusLabel,
  memberStatusTone,
  useAdmin,
  useLoad,
  useTabParams,
} from '../kit';
import {
  FAMILY_STATUSES,
  RELATIONSHIPS,
  StatusOptions,
  TierOptions,
  relationshipLabel,
  useAsk,
  type FamilyEvent,
  type Household,
  type HouseholdsAnswer,
  type Invite,
  type Person,
  type PlanMember,
} from './members/shared';

const HOUSEHOLDS = '/api/admin/households';
const PEOPLE = '/api/admin/household-members';

// Families: one card per household (login accounts + seats, name-only family
// members, pending invitations and activity), a form to add or edit a family
// or a person, and the family-plan members who have no family yet.
// functions/api/admin/households.js, household-members.js.
export default function FamiliesTab() {
  const { t, api, toast } = useAdmin();
  const params = useTabParams();
  const list = useLoad(() => api<HouseholdsAnswer>(HOUSEHOLDS));
  const rows = list.data?.rows ?? [];
  const [adding, setAdding] = useState(false);
  const focus = params.household;

  const reload = () => list.reload();

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Families', '家庭')}
        description={t(
          "A family covers several people under one membership. Link login accounts via a member's Family field; add members without their own login (children, a spouse) below.",
          '一个家庭会员可涵盖多人。通过会员的“家庭”字段关联登录账户；在下方添加没有独立登录的成员（如子女、配偶）。',
        )}
        actions={
          <button type="button" className={PRIMARY} onClick={() => setAdding((a) => !a)}>
            {adding ? (
              <X className="w-4 h-4" aria-hidden />
            ) : (
              <Plus className="w-4 h-4" aria-hidden />
            )}
            {adding ? t('Cancel', '取消') : t('New family', '新建家庭')}
          </button>
        }
      />

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            key="new"
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
          >
            <FamilyForm
              onCancel={() => setAdding(false)}
              onSaved={async () => {
                setAdding(false);
                toast('success', t('Family created.', '家庭已创建。'));
                await reload();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Loaded
        loading={list.loading}
        error={list.error}
        isEmpty={list.data ? rows.length === 0 : undefined}
        empty={t('No families yet.', '暂无家庭。')}
      >
        <ul className={DIVIDED}>
          {rows.map((h, i) => (
            <motion.li
              key={h.id}
              initial={riseFromSm}
              animate={shown}
              transition={listItem(i)}
              className="py-6"
            >
              <FamilyCard
                h={h}
                focused={focus === h.id}
                invitesAvailable={list.data?.invites_available !== false}
                onChanged={reload}
              />
            </motion.li>
          ))}
        </ul>
      </Loaded>

      {list.data && <PlanMembers list={list.data.family_plan_members} onCreated={reload} />}
    </div>
  );
}

// ------------------------------------------------------------------ plan members

// Family-plan members with no family yet, e.g. imported MemberPress family
// plans. null = the server couldn't read them; undefined = a server that
// doesn't send the list, so nothing is shown.
function PlanMembers({
  list,
  onCreated,
}: {
  list: PlanMember[] | null | undefined;
  onCreated: () => Promise<void>;
}) {
  const { t, lang, api, toast, go } = useAdmin();
  const { ask, panel } = useAsk();
  const [busy, setBusy] = useState<string | null>(null);
  if (list === undefined) return null;

  // The member becomes the new family's founder, as if they had started it from
  // /account/, so they can invite family from there.
  const create = (m: PlanMember) => {
    const who = m.email || m.full_name || '';
    ask(
      t(
        `Create a family for ${who}? They become its founder and can invite family from their account page.`,
        `为 ${who} 建家庭？该会员会成为创始人，之后可以在账户页邀请家人。`,
      ),
      t('Create family', '建家庭'),
      async () => {
        setBusy(m.id);
        const res = await api(HOUSEHOLDS, { method: 'PUT', body: { founder_member_id: m.id } });
        if (!res.ok) {
          setBusy(null);
          return toast(
            'error',
            res.data.error || t('Could not create the family.', '建家庭失败。'),
          );
        }
        await onCreated();
        setBusy(null);
        toast('success', t(`Family created for ${who}.`, `已为 ${who} 建家庭。`));
      },
    );
  };

  return (
    <section className={SECTION}>
      <h2 className="text-lg font-bold text-ink flex items-center gap-2">
        {t('Family-plan members without a family', '还没建家庭的家庭会员')}
        {!!list?.length && (
          <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700">
            {list.length}
          </span>
        )}
      </h2>
      {list === null ? (
        <p className="text-sm text-neutral-500">
          {t("Couldn't load family-plan members.", '无法加载家庭会员列表。')}
        </p>
      ) : !list.length ? (
        <p className="text-sm text-neutral-500">
          {t('Every family-plan member has a family.', '所有家庭会员都已建家庭。')}
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            {t(
              'These members are on the Family plan but have no family yet. They can start one from their account page by inviting family, or you can create it here.',
              '这些会员买的是家庭会员，但还没建家庭。他们可以在账户页邀请家人时自动建立，也可以由你在这里直接建。',
            )}
          </p>
          {panel}
          <DataTable
            rows={list}
            rowKey={(m) => m.id}
            columns={[
              { key: 'name', label: t('Name', '姓名'), render: (m) => m.full_name || '—' },
              {
                key: 'email',
                label: t('Email', '邮箱'),
                render: (m) => <span className="break-all">{m.email || '—'}</span>,
              },
              {
                key: 'status',
                label: t('Status', '状态'),
                render: (m) => (
                  <Status tone={memberStatusTone(m.status)}>
                    {memberStatusLabel(t, m.status)}
                  </Status>
                ),
              },
              {
                key: 'expires',
                label: t('Expires', '到期'),
                render: (m) => fmtDate(lang, m.expires_at),
              },
            ]}
            actions={(m) => (
              <>
                {m.email && (
                  <button
                    type="button"
                    className={ROW_BTN}
                    onClick={() => go('members', { q: m.email as string })}
                    aria-label={t(`Find ${m.email} in Members`, `在会员中查找 ${m.email}`)}
                  >
                    <SearchIcon className="w-3.5 h-3.5" aria-hidden />
                    {t('Member', '会员')}
                  </button>
                )}
                <button
                  type="button"
                  className={ROW_BTN}
                  disabled={busy === m.id}
                  onClick={() => create(m)}
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden />
                  {t('Create family', '建家庭')}
                </button>
              </>
            )}
          />
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ card

function FamilyCard({
  h,
  focused,
  invitesAvailable,
  onChanged,
}: {
  h: Household;
  focused: boolean;
  invitesAvailable: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t, lang, api, tierName, toast, go } = useAdmin();
  const [editing, setEditing] = useState(false);
  // null = closed, 'new' = add person, otherwise the person being edited.
  const [personForm, setPersonForm] = useState<Person | 'new' | null>(null);
  const ref = useRef<HTMLElement>(null);

  // Opened from a member's editor (#families?household=<id>): bring it into view.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focused]);

  const accounts = h.accounts ?? [];
  const people = h.people ?? [];
  const founderId = h.founder?.id || h.founder_member_id;
  const f = h.founder;
  // A founder an admin moved out of the family is still named, marked as outside.
  const founderOutside = f && !accounts.some((a) => a.id === f.id);

  const deleteFamily = async () => {
    const res = await api(HOUSEHOLDS, { method: 'DELETE', body: { id: h.id } });
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    toast('success', t(`Deleted family "${h.name}".`, `已删除家庭“${h.name}”。`));
    await onChanged();
  };
  const deletePerson = async (p: Person) => {
    const res = await api(PEOPLE, { method: 'DELETE', body: { id: p.id } });
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    toast('success', t(`Removed ${p.full_name}.`, `已移除 ${p.full_name}。`));
    await onChanged();
  };

  return (
    <section
      ref={ref}
      className={`scroll-mt-32 ${focused ? 'border-l-2 border-brick pl-4 -ml-4' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink break-words">{h.name}</h2>
          <p className="mt-1 text-xs text-neutral-500 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{h.tier_id ? tierName(h.tier_id) : t('— no tier —', '— 无类型 —')}</span>
            <span aria-hidden>·</span>
            <Status tone={memberStatusTone(h.status)}>{memberStatusLabel(t, h.status)}</Status>
            {h.expires_at && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {t('expires', '到期')} {fmtDate(lang, h.expires_at)}
                </span>
              </>
            )}
          </p>
          {h.notes && <p className="mt-1 text-xs text-neutral-500 break-words">{h.notes}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={ROW_BTN}
            aria-expanded={editing}
            onClick={() => setEditing((e) => !e)}
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden />
            {editing ? t('Close', '收起') : t('Edit', '编辑')}
          </button>
          <InlineConfirm
            label={t('Delete', '删除')}
            keepLabel={t('Keep', '保留')}
            confirmLabel={t('Delete family', '删除家庭')}
            doneLabel={t('Deleting…', '即将删除…')}
            undoLabel={t('Undo', '撤销')}
            onCommit={() => void deleteFamily()}
          />
        </div>
        <p className="basis-full text-[11px] text-neutral-500">
          {t(
            'Deleting a family removes its family members; linked login accounts are kept.',
            '删除家庭会移除其家庭成员；关联的登录账户会保留。',
          )}
        </p>
      </div>

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key="edit"
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
            className="pb-4"
          >
            <FamilyForm
              h={h}
              onCancel={() => setEditing(false)}
              onSaved={async () => {
                setEditing(false);
                toast('success', t('Saved.', '已保存。'));
                await onChanged();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* login accounts */}
      <div className="py-4 border-t border-neutral-200/80 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={EYEBROW}>{t('Login accounts', '登录账户')}</span>
          <span className="text-xs text-neutral-500">
            {t('Seats', '名额')}: {h.seats_used ?? '—'} / {h.seats_limit ?? '—'}
          </span>
        </div>
        {accounts.length ? (
          <ul className="space-y-1">
            {accounts.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => a.email && go('members', { q: a.email })}
                  disabled={!a.email}
                  className="min-h-[44px] w-full text-left rounded-xl px-2 -mx-2 hover:bg-white flex flex-wrap items-center gap-x-2 gap-y-1 text-sm cursor-pointer disabled:cursor-default"
                  title={t('Open in Members', '在会员中打开')}
                >
                  <span className="font-semibold text-ink">{a.full_name || '—'}</span>
                  <span className="text-neutral-500 break-all">{a.email || ''}</span>
                  {founderId && a.id === founderId && (
                    <span className="px-2 py-0.5 rounded-full bg-brick/10 text-brick text-[11px] font-semibold">
                      {t('Founder', '创始人')}
                    </span>
                  )}
                  <Status tone={memberStatusTone(a.status)}>
                    {memberStatusLabel(t, a.status)}
                  </Status>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">
            {t(
              'None linked. Edit a member and choose this family.',
              '暂无关联账户。编辑会员并选择该家庭即可关联。',
            )}
          </p>
        )}
        {founderOutside && (
          <p className="text-xs text-neutral-500 break-words">
            {t(
              `Founder: ${f.full_name || '—'} — ${f.email || ''} (not in this family)`,
              `创始人：${f.full_name || '—'} — ${f.email || ''}（不在此家庭）`,
            )}
          </p>
        )}
      </div>

      {/* people */}
      <div className="py-4 border-t border-neutral-200/80 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={EYEBROW}>{t('Family members', '家庭成员')}</span>
          <button
            type="button"
            className={ROW_BTN}
            aria-expanded={personForm === 'new'}
            onClick={() => setPersonForm((p) => (p === 'new' ? null : 'new'))}
          >
            <UserPlus className="w-3.5 h-3.5" aria-hidden />
            {t('Add person', '添加成员')}
          </button>
        </div>
        <AnimatePresence initial={false}>
          {personForm && (
            <motion.div
              key={personForm === 'new' ? 'new' : personForm.id}
              initial={riseFromSm}
              animate={shown}
              exit={listExit}
              transition={mountIn}
            >
              <PersonForm
                householdId={h.id}
                p={personForm === 'new' ? undefined : personForm}
                onCancel={() => setPersonForm(null)}
                onSaved={async () => {
                  setPersonForm(null);
                  toast('success', t('Saved.', '已保存。'));
                  await onChanged();
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {people.length ? (
          <DataTable
            rows={people}
            rowKey={(p) => p.id}
            columns={[
              {
                key: 'name',
                label: t('Name', '姓名'),
                render: (p) => (
                  <span className="inline-flex flex-wrap items-center justify-end md:justify-start gap-1.5">
                    <span className="font-semibold text-ink">{p.full_name}</span>
                    {p.is_primary && (
                      <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-700">
                        {t('primary', '主要')}
                      </span>
                    )}
                    {!p.member_id && (
                      <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-[11px] text-neutral-500">
                        {t('Not linked to an account', '未关联账号')}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: 'rel',
                label: t('Relationship', '关系'),
                render: (p) => relationshipLabel(t, p.relationship) || '—',
              },
              {
                key: 'email',
                label: t('Email', '邮箱'),
                render: (p) => <span className="break-all">{p.email || '—'}</span>,
              },
              { key: 'phone', label: t('Phone', '电话'), render: (p) => p.phone || '—' },
            ]}
            actions={(p) => (
              <>
                <button
                  type="button"
                  className={ROW_BTN}
                  aria-expanded={personForm !== 'new' && personForm?.id === p.id}
                  onClick={() =>
                    setPersonForm((cur) => (cur !== 'new' && cur?.id === p.id ? null : p))
                  }
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden />
                  {t('Edit', '编辑')}
                </button>
                <InlineConfirm
                  label={t('Delete', '删除')}
                  keepLabel={t('Keep', '保留')}
                  confirmLabel={t('Remove', '移除')}
                  doneLabel={t('Removing…', '即将移除…')}
                  undoLabel={t('Undo', '撤销')}
                  onCommit={() => void deletePerson(p)}
                />
              </>
            )}
          />
        ) : (
          <p className="text-sm text-neutral-500">
            {t('No family members added yet.', '尚未添加家庭成员。')}
          </p>
        )}
      </div>

      {/* invitations + activity */}
      <div className="py-4 border-t border-neutral-200/80">
        <InvitesBlock h={h} available={invitesAvailable} />
      </div>
    </section>
  );
}

// Pending invitations and activity, or a note when they couldn't be read.
function InvitesBlock({ h, available }: { h: Household; available: boolean }) {
  const { t, lang } = useAdmin();
  if (!available)
    return (
      <p className="text-xs text-neutral-500">
        {t('Invitations and activity are unavailable right now.', '邀请和动态暂不可用。')}
      </p>
    );
  const invites = h.invites ?? [];
  const events = h.events ?? [];
  const inviteItem = (i: Invite) => {
    const rel = relationshipLabel(t, i.relationship);
    return `${i.email}${rel ? ` · ${rel}` : ''} · ${t('expires', '到期')} ${fmtDate(lang, i.expires_at)}`;
  };
  const eventItem = (e: FamilyEvent) => {
    const label = eventLabel(t, e.type);
    const subject = [e.subject_name, e.subject_email].filter(Boolean).join(' ');
    const by = e.actor_email ? ` · ${t('by', '操作人')} ${e.actor_email}` : '';
    return `${fmtDate(lang, e.created_at)} · ${label}${subject ? ` · ${subject}` : ''}${by}`;
  };
  return (
    <div className="space-y-2">
      <span className={EYEBROW}>{t('Pending invitations', '待接受的邀请')}</span>
      {invites.length ? (
        <ul className="space-y-1 text-sm text-neutral-700">
          {invites.map((i) => (
            <li key={i.id} className="break-words">
              {inviteItem(i)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">
          {t('No pending invitations.', '暂无待接受的邀请。')}
        </p>
      )}
      {events.length > 0 && (
        <details className="pt-2 group">
          <summary className="min-h-[44px] flex items-center cursor-pointer text-xs font-bold text-neutral-600 hover:text-ink">
            {t('Activity', '动态')} ({events.length})
          </summary>
          <ul className="mt-1 space-y-1 text-xs text-neutral-600">
            {events.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="break-words">
                {eventItem(e)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function eventLabel(t: (en: string, zh: string) => string, type: string) {
  return (
    {
      invite_sent: t('Invitation sent', '已发送邀请'),
      invite_cancelled: t('Invitation cancelled', '邀请已取消'),
      invite_declined: t('Invitation declined', '邀请被拒绝'),
      joined: t('Joined the family', '加入家庭'),
      left: t('Left the family', '退出家庭'),
      member_removed: t('Removed from the family', '被移出家庭'),
      person_added: t('Person added', '已添加成员'),
      person_removed: t('Person removed', '已移除成员'),
      dissolved: t('Family dissolved', '家庭已解散'),
    }[type] || type
  );
}

// ------------------------------------------------------------------ forms

function FamilyForm({
  h,
  onCancel,
  onSaved,
}: {
  h?: Household;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, api } = useAdmin();
  const edit = !!h;
  const [f, setF] = useState({
    name: h?.name ?? '',
    tier_id: edit ? (h.tier_id ?? '') : 'family',
    status: h?.status ?? 'active',
    member_since: dateInput(h?.member_since),
    expires_at: dateInput(h?.expires_at),
    notes: h?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...f, name: f.name.trim(), notes: f.notes.trim() };
    if (!body.name) return setMsg(t('Family name is required.', '家庭名称为必填项。'));
    setBusy(true);
    const res = edit
      ? await api(HOUSEHOLDS, { method: 'POST', body: { id: h.id, ...body } })
      : await api(HOUSEHOLDS, { method: 'PUT', body });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Save failed.', '保存失败。'));
    await onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={`${t('Family name', '家庭名称')} *`}>
          <input className={INPUT} value={f.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label={t('Tier', '类型')}>
          <select className={SELECT} value={f.tier_id} onChange={set('tier_id')}>
            <TierOptions />
          </select>
        </Field>
        <Field label={t('Status', '状态')}>
          <select className={SELECT} value={f.status} onChange={set('status')}>
            <StatusOptions list={FAMILY_STATUSES} />
          </select>
        </Field>
        <Field label={t('Member since', '加入时间')}>
          <input
            type="date"
            className={INPUT}
            value={f.member_since}
            onChange={set('member_since')}
          />
        </Field>
        <Field label={t('Expires', '到期')}>
          <input type="date" className={INPUT} value={f.expires_at} onChange={set('expires_at')} />
        </Field>
        <Field className="md:col-span-2" label={t('Notes', '备注')}>
          <textarea className={TEXTAREA} rows={2} value={f.notes} onChange={set('notes')} />
        </Field>
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {edit ? t('Save', '保存') : t('Create', '创建')}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          {t('Cancel', '取消')}
        </button>
      </div>
    </form>
  );
}

function PersonForm({
  householdId,
  p,
  onCancel,
  onSaved,
}: {
  householdId: string;
  p?: Person;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, api } = useAdmin();
  const edit = !!p;
  const [f, setF] = useState({
    full_name: p?.full_name ?? '',
    relationship: p?.relationship ?? '',
    email: p?.email ?? '',
    phone: p?.phone ?? '',
  });
  const [primary, setPrimary] = useState(!!p?.is_primary);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      full_name: f.full_name.trim(),
      relationship: f.relationship,
      email: f.email.trim(),
      phone: f.phone.trim(),
      is_primary: primary,
    };
    if (!body.full_name) return setMsg(t('Full name is required.', '姓名为必填项。'));
    setBusy(true);
    const res = edit
      ? await api(PEOPLE, { method: 'POST', body: { id: p.id, ...body } })
      : await api(PEOPLE, { method: 'PUT', body: { household_id: householdId, ...body } });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Save failed.', '保存失败。'));
    await onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={`${t('Full name', '姓名')} *`}>
          <input
            className={INPUT}
            value={f.full_name}
            onChange={set('full_name')}
            required
            autoFocus
          />
        </Field>
        <Field label={t('Relationship', '关系')}>
          <select className={SELECT} value={f.relationship} onChange={set('relationship')}>
            <option value="" />
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {relationshipLabel(t, r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Email', '邮箱')}>
          <input type="email" className={INPUT} value={f.email} onChange={set('email')} />
        </Field>
        <Field label={t('Phone', '电话')}>
          <input type="tel" className={INPUT} value={f.phone} onChange={set('phone')} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <LiquidToggle
          checked={primary}
          onChange={setPrimary}
          label={t('Primary contact', '主要联系人')}
        />
        <span className="text-sm text-neutral-700">{t('Primary contact', '主要联系人')}</span>
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {edit ? t('Save', '保存') : t('Add', '添加')}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          {t('Cancel', '取消')}
        </button>
      </div>
    </form>
  );
}
