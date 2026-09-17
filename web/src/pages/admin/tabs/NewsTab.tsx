import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function NewsTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('Send news', '发送通讯')} />;
}
