import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function DirectoryTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Business directory', '商家名录')} />;
}
