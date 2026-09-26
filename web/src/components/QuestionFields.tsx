// The questions of a form (events.registration_questions, an event's
// volunteer_questions or a volunteer template, all the shape
// functions/api/_event-form.js validates), drawn as fields: one box per typed
// kind, radios or checkboxes with an optional "Other" for the choices. The
// registration page, the volunteer page and the volunteer dialog share it, so
// a question looks the same wherever it is asked. State is the plain shape
// readAnswers in lib/registration.js reads: a string for a typed question,
// { picked, other } for a choice.
import type { Lang } from '../lib/lang';
import { isTypedQuestion, otherFieldId, questionFieldId, questionLabel } from '../lib/registration';

export interface Question {
  id: string;
  type: 'text' | 'textarea' | 'number' | 'phone' | 'date' | 'single' | 'multi';
  label_en: string;
  label_zh?: string | null;
  required?: boolean;
  other?: boolean;
  options?: { id: string; label_en: string; label_zh?: string | null }[];
  /** A number question's optional bounds (whole numbers). */
  min?: number;
  max?: number;
}

/** One question's state: a typed string, or the choices picked plus "Other". */
export type ChoiceState = { picked: string[]; other: string | null };
export type AnswerState = Record<string, string | ChoiceState>;

/** One entry per question, so every field is controlled from the start. */
export function blankAnswers(questions: Question[]): AnswerState {
  const blank: AnswerState = {};
  for (const q of questions) blank[q.id] = isTypedQuestion(q) ? '' : { picked: [], other: null };
  return blank;
}

// web/DESIGN_SYSTEM.md §5.2 / §5.1, verbatim.
const INPUT =
  'w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brick';
const LABEL = 'block text-xs font-bold text-neutral-500 mb-2';

export function QuestionFields({
  questions,
  answers,
  onChange,
  lang,
}: {
  questions: Question[];
  answers: AnswerState;
  onChange: (next: AnswerState) => void;
  lang: Lang;
}) {
  const en = lang === 'en';
  const set = (id: string, value: string | ChoiceState) => onChange({ ...answers, [id]: value });
  const choiceOf = (q: Question): ChoiceState => {
    const value = answers[q.id];
    return typeof value === 'object' && value ? value : { picked: [], other: null };
  };

  return (
    <>
      {questions.map((q) => {
        const label = questionLabel(q, lang);
        const mark = q.required ? ' *' : '';
        if (isTypedQuestion(q)) {
          const value = typeof answers[q.id] === 'string' ? (answers[q.id] as string) : '';
          const common = {
            id: questionFieldId(q),
            value,
            autoComplete: 'off',
            onChange: (e: { target: { value: string } }) => set(q.id, e.target.value),
          };
          // One box per kind: the phone keyboard for a number or a phone, the
          // device's date picker for a date. The API re-checks every one of them.
          const box =
            q.type === 'textarea' ? (
              <textarea rows={3} maxLength={2000} className={`${INPUT} resize-none`} {...common} />
            ) : q.type === 'number' ? (
              <input
                type="number"
                inputMode="numeric"
                step={1}
                min={q.min}
                max={q.max}
                className={INPUT}
                {...common}
              />
            ) : q.type === 'phone' ? (
              <input
                type="tel"
                inputMode="tel"
                maxLength={40}
                className={INPUT}
                {...common}
                autoComplete="tel"
              />
            ) : q.type === 'date' ? (
              <input type="date" className={INPUT} {...common} />
            ) : (
              <input type="text" maxLength={500} className={INPUT} {...common} />
            );
          return (
            <div key={q.id}>
              <label className={LABEL} htmlFor={questionFieldId(q)}>
                {label}
                {mark}
              </label>
              {box}
            </div>
          );
        }
        const single = q.type === 'single';
        const state = choiceOf(q);
        return (
          <fieldset key={q.id}>
            <legend className={LABEL}>
              {label}
              {mark}
            </legend>
            <div className="space-y-1.5">
              {(q.options ?? []).map((o, i) => {
                const checked = state.picked.includes(o.id);
                return (
                  <label key={o.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      id={i === 0 ? questionFieldId(q) : `${questionFieldId(q)}-o-${o.id}`}
                      type={single ? 'radio' : 'checkbox'}
                      name={questionFieldId(q)}
                      className="accent-brick"
                      value={o.id}
                      checked={checked}
                      onChange={() =>
                        set(
                          q.id,
                          single
                            ? { picked: [o.id], other: null }
                            : {
                                ...state,
                                picked: checked
                                  ? state.picked.filter((id) => id !== o.id)
                                  : [...state.picked, o.id],
                              },
                        )
                      }
                    />
                    <span className="text-neutral-800">{questionLabel(o, lang)}</span>
                  </label>
                );
              })}
              {q.other && (
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      id={`${questionFieldId(q)}-other`}
                      type={single ? 'radio' : 'checkbox'}
                      name={questionFieldId(q)}
                      className="accent-brick"
                      checked={state.other !== null}
                      onChange={() =>
                        set(
                          q.id,
                          state.other !== null
                            ? { ...state, other: null }
                            : { picked: single ? [] : state.picked, other: state.other ?? '' },
                        )
                      }
                    />
                    <span className="text-neutral-800">{en ? 'Other:' : '其他：'}</span>
                  </label>
                  <label className="sr-only" htmlFor={otherFieldId(q)}>
                    {en ? `Other — ${q.label_en}` : `其他——${label}`}
                  </label>
                  <input
                    id={otherFieldId(q)}
                    type="text"
                    maxLength={200}
                    autoComplete="off"
                    className={INPUT}
                    placeholder={en ? 'Please specify' : '请注明'}
                    value={state.other ?? ''}
                    // Typing an "Other" answer picks Other, as the Google Form did.
                    onChange={(e) =>
                      set(q.id, {
                        picked: single && e.target.value.trim() ? [] : state.picked,
                        other: e.target.value,
                      })
                    }
                  />
                </div>
              )}
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
