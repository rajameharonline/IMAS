import { useState } from 'react';
import ClientPortalPage from './ClientPortalPage';
import MobilePushPage   from '../mobile/MobilePushPage';
import AppBannerPage    from '../mobile/AppBannerPage';
import AppVersionPage   from '../mobile/AppVersionPage';

// Apps Management — পুরনো "Mobile App" মেনুর পেজগুলো + Registered Clients একসাথে tab আকারে
const TABS = [
  { key: 'registered', label: 'Registered Clients', Comp: ClientPortalPage },
  { key: 'push',       label: 'Push Notification',  Comp: MobilePushPage },
  { key: 'banner',     label: 'App Banner',         Comp: AppBannerPage },
  { key: 'version',    label: 'Version Control',    Comp: AppVersionPage },
];

export default function AppsManagementPage() {
  const [tab, setTab] = useState('registered');
  const Active = (TABS.find(t => t.key === tab) || TABS[0]).Comp;

  return (
    <div className="bg-gray-100 min-h-screen">
      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 pt-3 flex gap-1 overflow-x-auto sticky top-0 z-20 shadow-sm">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition
              ${tab === t.key
                ? 'border-[#173d59] text-[#173d59]'
                : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Active tab page */}
      <Active />
    </div>
  );
}
