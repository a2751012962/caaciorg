import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function DashboardTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Dashboard', '看板')} />;
}
