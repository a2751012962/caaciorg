import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function PlansTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Membership plans', '会员方案')} />;
}
