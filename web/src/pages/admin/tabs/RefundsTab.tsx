import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function RefundsTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Refunds', '退款')} />;
}
