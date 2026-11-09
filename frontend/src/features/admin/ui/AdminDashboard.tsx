'use client';

import { useState } from 'react';
import { Tab, Tabs } from 'react-bootstrap';
import { usePathname, useRouter } from 'next/navigation';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { ListPageAuthGate } from '@/src/components/ListPageLayout';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { navLink } from '@/src/shared/list/listQueryMemory';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { useIsSobaAdmin } from '../useIsSobaAdmin';
import { DocumentGenerationAuditsPanel } from './DocumentGenerationAuditsPanel';
import { FeatureScopeListPanel } from './FeatureScopeListPanel';
import { JobsPanel } from './JobsPanel';
import { SobaAdminsPanel } from './SobaAdminsPanel';

export type AdminTab = 'admins' | 'featureScopes' | 'audits' | 'jobs';

/** Each tab's own page, so the address names the tab and browser Back returns to it. */
const TAB_PATHS: Record<AdminTab, string> = {
  admins: '/admin',
  featureScopes: '/admin/feature-scopes',
  audits: '/admin/document-generation',
  jobs: '/admin/jobs',
};

const isAdminTab = (key: string | null): key is AdminTab => key !== null && key in TAB_PATHS;

/**
 * Platform administration console. Rendered only for SOBA platform admins; the backend `/admin/*`
 * routes enforce the same rule, so this gate is presentation-only.
 */
export function AdminDashboard({
  defaultActiveTab = 'admins',
  documentGenerationEnabled = false,
  scopedFeatureCodes = [],
}: Readonly<{
  defaultActiveTab?: AdminTab;
  documentGenerationEnabled?: boolean;
  scopedFeatureCodes?: string[];
}>) {
  const dict = useDictionary();
  const dictAdmin = dict.admin;
  const { authenticated } = useKeycloak();
  const { isSobaAdmin, initializing } = useIsSobaAdmin();
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());
  // Set on the click so the tab shows at once; the page it opens starts on the same tab.
  const [selectedTab, setSelectedTab] = useState<AdminTab>(defaultActiveTab);
  // The document generation page shows the first tab when that feature is off.
  const activeTab = selectedTab === 'audits' && !documentGenerationEnabled ? 'admins' : selectedTab;

  if (initializing) {
    return <CenteredProgress label={dict.general.loading} />;
  }

  if (!authenticated) {
    return <ListPageAuthGate>{dict.general.notAuthenticated}</ListPageAuthGate>;
  }

  if (!isSobaAdmin) {
    return <ListPageAuthGate>{dictAdmin.forbidden}</ListPageAuthGate>;
  }

  return (
    <Tabs
      activeKey={activeTab}
      onSelect={(key) => {
        if (!isAdminTab(key) || key === activeTab) return;
        setSelectedTab(key);
        router.push(navLink(`/${locale}${TAB_PATHS[key]}`));
      }}
      id="admin-tabs"
      data-testid="admin-tabs"
    >
      <Tab eventKey="admins" title={dictAdmin.admins.heading}>
        {activeTab === 'admins' ? <SobaAdminsPanel /> : null}
      </Tab>
      <Tab eventKey="featureScopes" title={dictAdmin.featureScopes.heading}>
        {activeTab === 'featureScopes' ? (
          <FeatureScopeListPanel scopedFeatureCodes={scopedFeatureCodes} />
        ) : null}
      </Tab>
      {documentGenerationEnabled ? (
        <Tab eventKey="audits" title={dictAdmin.audits.heading}>
          {activeTab === 'audits' ? <DocumentGenerationAuditsPanel /> : null}
        </Tab>
      ) : null}
      <Tab eventKey="jobs" title={dict.jobs.heading}>
        {activeTab === 'jobs' ? <JobsPanel /> : null}
      </Tab>
    </Tabs>
  );
}

export default AdminDashboard;
