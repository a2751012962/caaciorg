// Templates for a question builder (form_templates, 0035): fill the builder
// from a saved template, save what is in the builder as one, make one the
// default, or delete one. Copy, never reference — filling in copies the
// questions into the event's draft, and saving copies the draft out — so an
// event and a template never change each other.
// GET/PUT/POST/DELETE /api/admin/form-templates.
import { useState } from 'react';
import { Copy, Save, Star } from 'lucide-react';
import { INPUT, InlineConfirm, Notice, SECONDARY, SELECT, useAdmin, useLoad } from '../../kit';
import {
  questionState,
  questionsError,
  questionsPayload,
  type DraftQuestion,
  type FormTemplate,
} from './rules';

const ENDPOINT = '/api/admin/form-templates';
const SMALL_BTN =
  'min-h-[44px] px-4 rounded-full border border-neutral-300 bg-white text-xs font-semibold text-neutral-700 hover:border-neutral-800 inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export function TemplateBar({
  kind,
  questions,
  onFill,
}: {
  kind: FormTemplate['kind'];
  questions: DraftQuestion[];
  /** Replace the builder's questions with a template's (a copy). */
  onFill: (qs: DraftQuestion[]) => void;
}) {
  const { t, api, toast } = useAdmin();
  const list = useLoad(() => api<{ rows: FormTemplate[] }>(`${ENDPOINT}?kind=${kind}`), [kind]);
  const templates = list.data?.rows ?? [];
  const [picked, setPicked] = useState('');
  const [saveName, setSaveName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const chosen = templates.find((x) => x.id === picked);

  const fill = () => {
    if (!chosen) return;
    onFill(questionState(chosen.questions));
    toast('success', t(`Filled in from “${chosen.name}”.`, `已从“${chosen.name}”填入问题。`));
  };

  const save = async () => {
    setMsg('');
    const name = saveName.trim();
    if (!name) return setMsg(t('Give the template a name.', '请给模板起个名字。'));
    const problem = questionsError(t, questions);
    if (problem) return setMsg(problem);
    setBusy(true);
    const body = { kind, name, questions: questionsPayload(questions) };
    // Same name as an existing template: overwrite it, so "save" is repeatable.
    const same = templates.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const res = same
      ? await api(ENDPOINT, { method: 'POST', body: { id: same.id, ...body } })
      : await api(ENDPOINT, { method: 'PUT', body });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Save failed.', '保存失败。'));
    toast(
      'success',
      same
        ? t(`Template “${name}” updated.`, `模板“${name}”已更新。`)
        : t(`Saved as template “${name}”.`, `已保存为模板“${name}”。`),
    );
    setSaveName('');
    await list.reload();
  };

  const makeDefault = async () => {
    if (!chosen || chosen.is_default) return;
    setMsg('');
    setBusy(true);
    const res = await api(ENDPOINT, { method: 'POST', body: { id: chosen.id, is_default: true } });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Update failed.', '更新失败。'));
    toast('success', t(`“${chosen.name}” is now the default.`, `“${chosen.name}”已设为默认。`));
    await list.reload();
  };

  const remove = async () => {
    if (!chosen) return;
    setMsg('');
    const res = await api(ENDPOINT, { method: 'DELETE', body: { id: chosen.id } });
    if (!res.ok) return setMsg(res.data.error || t('Delete failed.', '删除失败。'));
    toast('success', t(`Deleted template “${chosen.name}”.`, `已删除模板“${chosen.name}”。`));
    setPicked('');
    await list.reload();
  };

  const defaultHint =
    kind === 'volunteer'
      ? t(
          'The default template is what the volunteer dialog asks, and what an event without questions of its own asks on its volunteer page.',
          '默认模板用于综合志愿者弹窗，以及没有专属问题的活动的志愿者报名页。',
        )
      : t(
          'The default template is offered first when a new event is created.',
          '新建活动时优先提供默认模板。',
        );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${SELECT} sm:w-72`}
          value={picked}
          aria-label={t('Template', '模板')}
          onChange={(e) => setPicked(e.target.value)}
        >
          <option value="">
            {list.loading
              ? t('Loading templates…', '正在加载模板…')
              : templates.length
                ? t('Choose a template…', '选择模板…')
                : t('No templates yet', '暂无模板')}
          </option>
          {templates.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.is_default ? t(' (default)', '（默认）') : ''}
            </option>
          ))}
        </select>
        <button type="button" className={SMALL_BTN} disabled={!chosen || busy} onClick={fill}>
          <Copy className="w-4 h-4" aria-hidden />
          {t('Fill in from template', '从模板填入')}
        </button>
        <button
          type="button"
          className={SMALL_BTN}
          disabled={!chosen || chosen.is_default || busy}
          onClick={() => void makeDefault()}
        >
          <Star className="w-4 h-4" aria-hidden />
          {t('Make default', '设为默认')}
        </button>
        {chosen && !chosen.is_default && (
          <InlineConfirm
            label={t('Delete template', '删除模板')}
            keepLabel={t('Keep', '保留')}
            confirmLabel={t('Delete', '删除')}
            doneLabel={t('Deleting…', '即将删除…')}
            undoLabel={t('Undo', '撤销')}
            onCommit={() => void remove()}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${INPUT} sm:w-72`}
          maxLength={80}
          placeholder={t('Template name', '模板名称')}
          aria-label={t('Save the questions as a template named', '保存为模板，名称')}
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <button
          type="button"
          className={SECONDARY}
          disabled={busy || !questions.length}
          onClick={() => void save()}
        >
          <Save className="w-4 h-4" aria-hidden />
          {t('Save as template', '保存为模板')}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        {defaultHint}{' '}
        {t(
          'Templates are copies: filling in or saving never links the event and the template.',
          '模板是副本：填入或保存都不会把活动和模板关联起来。',
        )}
      </p>
      {msg && <Notice tone="error">{msg}</Notice>}
      {list.error && <Notice tone="error">{list.error}</Notice>}
    </div>
  );
}
