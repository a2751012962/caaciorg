// Ties a form's error message to the field it is about (WCAG 3.3.1, and the
// ARIA error pattern from SHS 482 week 7): the field is marked aria-invalid
// and described by the message, so a screen reader reads the error together
// with the field when focus lands on it. One message per form, identified by
// `errorId` (the id of its role="alert" element).
export function flagInvalid(fieldId: string | null, errorId: string) {
  for (const el of document.querySelectorAll(`[data-error-for="${errorId}"]`)) {
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
    el.removeAttribute('data-error-for');
  }
  if (!fieldId) return;
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', errorId);
  field.setAttribute('data-error-for', errorId);
}

// Flags the field, then moves focus to it.
export function focusInvalid(fieldId: string, errorId: string) {
  flagInvalid(fieldId, errorId);
  document.getElementById(fieldId)?.focus();
}
