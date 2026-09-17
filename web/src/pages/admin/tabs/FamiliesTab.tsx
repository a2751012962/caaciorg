import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function FamiliesTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Families', '家庭')} />;
}
