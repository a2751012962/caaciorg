import { TabHeader, useAdmin } from '../kit';

// Stub: being ported from the Tabler /admin/ (src/caaci-admin.js).
export default function AccountTab() {
  const { t } = useAdmin();
  return <TabHeader title={t('My account', '我的账号')} />;
}
