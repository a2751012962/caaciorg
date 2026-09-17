import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function MembersTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Members & Subscriptions', '会员与订阅')} />;
}
