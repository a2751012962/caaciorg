import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function EventsTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Events', '活动')} />;
}
