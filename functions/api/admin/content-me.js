// /api/admin/content-me  (content staff) — what the signed-in caller may do in
// the content tabs, so /admin/ shows an editor only those.
//   GET → { is_admin, all_columns, column_ids, can_edit_pages,
//         perms }; 403 for anyone who is neither an administrator
//         nor a content manager.
import { json } from '../_lib.js';
import { contentRole } from '../_content.js';

export async function onRequestGet({ request, env }) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate.error;
  return json(gate.role);
}
