import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function VolunteersTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Volunteers', '志愿者')} />;
}
