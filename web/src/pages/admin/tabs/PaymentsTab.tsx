import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function PaymentsTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Payments', '收款记录')} />;
}
