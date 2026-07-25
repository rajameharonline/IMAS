// এই ফাইলটি React app-এর main entry - সব route এখানে সংজ্ঞায়িত।
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { CompanyProvider } from './context/CompanyContext';
import { PermissionProvider, usePermission } from './context/PermissionContext';
import { lazy, Suspense } from 'react';

import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ClientList from './pages/clients/ClientList';
import ClientForm from './pages/clients/ClientForm';
import ClientProfile from './pages/clients/ClientProfile';
import CustomerSearchPage from './pages/clients/CustomerSearchPage';
import LeftClientPage from './pages/clients/LeftClientPage';
import ClientPortalPage from './pages/clients/ClientPortalPage';
import AppsManagementPage from './pages/clients/AppsManagementPage';
import CallLogPage from './pages/voip/CallLogPage';
import VoiceSmsPage from './pages/voip/VoiceSmsPage';
import HotlineControlPage from './pages/voip/HotlineControlPage';
import RingGroupPage from './pages/voip/RingGroupPage';
import IVRMenuPage from './pages/voip/IVRMenuPage';
import PBXAgentPage from './pages/voip/PBXAgentPage';
import BillList from './pages/billing/BillList';
import DailyCollection from './pages/billing/DailyCollection';
import PaymentReminderPage from './pages/billing/PaymentReminderPage';
import BulkClientImportPage from './pages/mikrotik/BulkClientImportPage';
import RadiusServerPage from './pages/radius/RadiusServerPage';
import OnlineClientMonitoring from './pages/radius/OnlineClientMonitoring';
import ClientTrafficPage from './pages/radius/ClientTrafficPage';
import PackagePage from './pages/config/PackagePage';
import ConnectionTypePage from './pages/config/ConnectionTypePage';
import ConfigPage from './pages/config/ConfigPage';
import DistrictPage from './pages/config/DistrictPage';
import UpazilaPage from './pages/config/UpazilaPage';
import EmployeePage from './pages/hr/EmployeePage';
import AddEmployeePage from './pages/hr/AddEmployeePage';
import PositionPage from './pages/hr/PositionPage';
import DepartmentPage from './pages/hr/DepartmentPage';
import PayHeadPage from './pages/hr/PayHeadPage';
import PayrollPage from './pages/hr/PayrollPage';
import SettingsPage from './pages/settings/SettingsPage';
import AccountPage from './pages/AccountPage';
import OLTListPage from './pages/olt/OLTListPage';
import ONUMonitoringPage from './pages/olt/ONUMonitoringPage';
import AppUsersPage from './pages/system/AppUsersPage';
import PaymentGatewaysPage from './pages/system/PaymentGatewaysPage';
import SmsGatewayPage from './pages/sms/SmsGatewayPage';
import SmsTemplatePage from './pages/sms/SmsTemplatePage';
import SendSmsPage from './pages/sms/SendSmsPage';
import IndividualSmsPage from './pages/sms/IndividualSmsPage';
import PayslipPage from './pages/hr/PayslipPage';
import SalarySheetPage from './pages/hr/SalarySheetPage';
import ResignRulePage from './pages/hr/ResignRulePage';
import ResignationPage from './pages/hr/ResignationPage';
import AttendancePage from './pages/hr/AttendancePage';
import RejoinPage from './pages/hr/RejoinPage';
import ProviderListPage from './pages/bandwidth/ProviderListPage';
import ProviderDetailPage from './pages/bandwidth/ProviderDetailPage';
import ItemCategoryPage from './pages/bandwidth/ItemCategoryPage';
import ItemCategoryFormPage from './pages/bandwidth/ItemCategoryFormPage';
import ItemPage from './pages/bandwidth/ItemPage';
import ProviderBillListPage from './pages/bandwidth/ProviderBillListPage';
import PurchaseBillFormPage from './pages/bandwidth/PurchaseBillFormPage';
import PurchaseBillInvoicePage from './pages/bandwidth/PurchaseBillInvoicePage';

// ── Accounting Module — সম্পূর্ণ rebuild (Dashboard, Vouchers, Reports) ──
import AccountingDashboard     from './pages/accounting/AccountingDashboard';
import ChartOfAccountsPage     from './pages/accounting/ChartOfAccountsPage';
import CreditVoucherPage       from './pages/accounting/CreditVoucherPage';
import AddIncomePage           from './pages/accounting/AddIncomePage';
import DebitVoucherPage        from './pages/accounting/DebitVoucherPage';
import AddExpensePage          from './pages/accounting/AddExpensePage';
import JournalVoucherPage      from './pages/accounting/JournalVoucherPage';
import CreateJournalVoucherPage from './pages/accounting/CreateJournalVoucherPage';
import AccountTransactionsPage from './pages/accounting/AccountTransactionsPage';
import AccountBalancesPage     from './pages/accounting/AccountBalancesPage';
import BalanceSheetPage        from './pages/accounting/BalanceSheetPage';
import ProfitLossPage          from './pages/accounting/ProfitLossPage';
import CompareProfitLossPage   from './pages/accounting/CompareProfitLossPage';
import TrialBalancePage        from './pages/accounting/TrialBalancePage';
import CashBookPage            from './pages/accounting/CashBookPage';

// ── Module 6 — Support & Ticketing dedicated pages ────────────────
import TicketTypePage       from './pages/support/TicketTypePage';
import ClientSupportPage    from './pages/support/ClientSupportPage';
import SupportHistoryPage   from './pages/support/SupportHistoryPage';

// ── Module 7 — Task Management dedicated pages ────────────────────
//    AllTasksPage = admin "All Tasks"; MyTasksPage = employee "My Tasks"।
import AllTasksPage         from './pages/tasks/AllTasksPage';
import MyTasksPage          from './pages/tasks/MyTasksPage';

// ── Module 9 — Network GIS Map & Topology ─────────────────────────
//    NetworkMap: Leaflet মানচিত্রে node placement + fiber polyline drawing।
//    NetworkTopology: React Flow hierarchy diagram (Router→OLT→Splitter→Client)।
import NetworkMap      from './pages/network/NetworkMap';
import NetworkTopology from './pages/network/NetworkTopology';

// ── Sales & Service — Product + Service Invoice pages ─────────────
import ProductSalesInvoicePage from './pages/sales/ProductSalesInvoicePage';
import ServiceSalesInvoicePage from './pages/sales/ServiceSalesInvoicePage';
import CreateSalesInvoicePage  from './pages/sales/CreateSalesInvoicePage';

// ── Mobile App Management pages ────────────────────────────────────
import MobilePushPage   from './pages/mobile/MobilePushPage';
import AppBannerPage    from './pages/mobile/AppBannerPage';
import AppVersionPage   from './pages/mobile/AppVersionPage';

// ── POP Management pages ────────────────────────────────────────────
import POPPackagePage          from './pages/pop/POPPackagePage';
import POPTariffPage           from './pages/pop/POPTariffPage';
import POPAddPage              from './pages/pop/POPAddPage';
import POPListPage             from './pages/pop/POPListPage';
import POPFundingPage          from './pages/pop/POPFundingPage';
import ClientPGWPaymentsPage   from './pages/pop/ClientPGWPaymentsPage';
import POPNoticePage           from './pages/pop/POPNoticePage';
import POPPGWSettlementPage    from './pages/pop/POPPGWSettlementPage';
import POPProfilePage          from './pages/pop/POPProfilePage';

// ── Live TV ──────────────────────────────────────────────────────────
import LiveTVPage             from './pages/livetv/LiveTVPage';
import LiveTVRegistrationPage from './pages/livetv/LiveTVRegistrationPage';
import FTPMovieServerPage     from './pages/livetv/FTPMovieServerPage';

// ── Purchase & Inventory ────────────────────────────────────────────
import VendorListPage       from './pages/purchase/VendorListPage';
import RequisitionListPage  from './pages/purchase/RequisitionListPage';
import RequisitionEntryPage from './pages/purchase/RequisitionEntryPage';
import PurchaseListPage     from './pages/purchase/PurchaseListPage';
import PurchaseEntryPage    from './pages/purchase/PurchaseEntryPage';
import StockPage            from './pages/inventory/StockPage';
import InvItemCategoryPage  from './pages/inventory/ItemCategoryPage';
import InvItemPage          from './pages/inventory/ItemPage';
import UnitPage             from './pages/inventory/UnitPage';
import StoreLocationPage    from './pages/inventory/StoreLocationPage';

// Lazy-loaded pages for better performance
const GenericListPage = lazy(() => import('./pages/GenericListPage'));

function LoadingSpinner() {
  return <div className="flex items-center justify-center h-64 text-gray-500">লোড হচ্ছে...</div>;
}

// ── Permission-protected route ─────────────────────────────────────────────
// moduleKey/subModuleKey না থাকলে সবাই দেখতে পারে
function PermissionRoute({ moduleKey, subModuleKey, children }) {
  const { hasModule, hasSubModule, isSuper, loaded } = usePermission();
  if (!loaded) return <LoadingSpinner />;
  if (isSuper || !moduleKey) return children;
  const ok = subModuleKey
    ? hasSubModule(moduleKey, subModuleKey)
    : hasModule(moduleKey);
  if (!ok) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <span className="text-5xl">🔒</span>
      <p className="text-gray-600 font-medium">এই পেজ দেখার অনুমতি নেই।</p>
      <p className="text-xs text-gray-400">Admin-এর সাথে যোগাযোগ করুন।</p>
    </div>
  );
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <PermissionProvider>
      <CompanyProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />

            {/* ক্লায়েন্ট routes */}
            <Route path="/clients" element={<ClientList />} />
            <Route path="/clients/new" element={<ClientForm />} />
            <Route path="/clients/left" element={<LeftClientPage />} />
            <Route path="/clients/portal" element={<ClientPortalPage />} />
            <Route path="/clients/apps-management" element={<AppsManagementPage />} />
            <Route path="/clients/:id/profile" element={<ClientProfile />} />
            <Route path="/search" element={<CustomerSearchPage />} />
            {/* Live TV */}
            <Route path="/livetv"              element={<LiveTVPage />} />
            <Route path="/livetv/registration" element={<LiveTVRegistrationPage />} />
            <Route path="/livetv/ftp"          element={<FTPMovieServerPage />} />

            <Route path="/voip/call-logs"    element={<CallLogPage />} />
            <Route path="/voip/voice-sms"   element={<VoiceSmsPage />} />
            <Route path="/voip/hotline"     element={<HotlineControlPage />} />
            <Route path="/voip/ring-groups" element={<RingGroupPage />} />
            <Route path="/voip/ivr"         element={<IVRMenuPage />} />
            <Route path="/voip/pbx-agents"  element={<PBXAgentPage />} />
            <Route path="/clients/:id" element={<ClientForm />} />

            {/* বিলিং routes */}
            <Route path="/billing/bills" element={<BillList />} />
            <Route path="/billing/daily-collection" element={<DailyCollection />} />
            <Route path="/billing/payment-reminder" element={<PaymentReminderPage />} />

            {/* Mikrotik routes */}
            <Route path="/mikrotik/bulk-import" element={<BulkClientImportPage />} />

            {/* RADIUS routes */}
            <Route path="/radius/servers" element={<RadiusServerPage />} />
            <Route path="/radius/online" element={<OnlineClientMonitoring />} />
            <Route path="/radius/traffic/:username" element={<ClientTrafficPage />} />

            {/* OLT Management routes */}
            <Route path="/olt/list" element={<OLTListPage />} />
            <Route path="/olt/onus" element={<ONUMonitoringPage />} />

            {/* কনফিগারেশন routes */}
            <Route path="/config/zones" element={<ConfigPage />} />
            <Route path="/config/subzones" element={<ConfigPage />} />
            <Route path="/config/boxes" element={<ConfigPage />} />
            <Route path="/config/client-types" element={<ConfigPage />} />
            <Route path="/config/protocol-types" element={<ConnectionTypePage />} />

            <Route path="/config/districts" element={<DistrictPage />} />
            <Route path="/config/upazilas" element={<UpazilaPage />} />

            {/* অন্যান্য routes - GenericListPage ব্যবহার */}
            <Route path="/config/packages" element={<PackagePage />} />
            {/* ── HR & Payroll routes — permission protected ── */}
            <Route path="/hr/department"       element={<PermissionRoute moduleKey="hr" subModuleKey="department"><DepartmentPage /></PermissionRoute>} />
            <Route path="/hr/payhead"          element={<PermissionRoute moduleKey="hr" subModuleKey="payhead"><PayHeadPage /></PermissionRoute>} />
            <Route path="/hr/payroll"          element={<PermissionRoute moduleKey="hr" subModuleKey="payroll"><PayrollPage /></PermissionRoute>} />
            <Route path="/hr/employees"        element={<PermissionRoute moduleKey="hr" subModuleKey="employee_list"><EmployeePage /></PermissionRoute>} />
            <Route path="/hr/employees/new"    element={<PermissionRoute moduleKey="hr" subModuleKey="add_employee"><AddEmployeePage /></PermissionRoute>} />
            <Route path="/hr/employees/:id/edit" element={<PermissionRoute moduleKey="hr" subModuleKey="employee_list"><AddEmployeePage /></PermissionRoute>} />
            <Route path="/hr/position"         element={<PermissionRoute moduleKey="hr" subModuleKey="position"><PositionPage /></PermissionRoute>} />
            <Route path="/hr/payslip"          element={<PermissionRoute moduleKey="hr" subModuleKey="payslip"><PayslipPage /></PermissionRoute>} />
            <Route path="/hr/salary-sheet"     element={<PermissionRoute moduleKey="hr" subModuleKey="salary_sheet"><SalarySheetPage /></PermissionRoute>} />
            <Route path="/hr/resign-rule"      element={<PermissionRoute moduleKey="hr" subModuleKey="resign_rule"><ResignRulePage /></PermissionRoute>} />
            <Route path="/hr/resignation"      element={<PermissionRoute moduleKey="hr" subModuleKey="resignation"><ResignationPage /></PermissionRoute>} />
            <Route path="/hr/attendance"       element={<PermissionRoute moduleKey="hr" subModuleKey="attendance"><AttendancePage /></PermissionRoute>} />
            <Route path="/hr/rejoin"           element={<PermissionRoute moduleKey="hr" subModuleKey="rejoin"><RejoinPage /></PermissionRoute>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/system/app-users" element={<AppUsersPage />} />
            <Route path="/system/payment-gateways" element={<PaymentGatewaysPage />} />
            <Route path="/bandwidth/buy/providers" element={<ProviderListPage />} />
            <Route path="/bandwidth/buy/providers/:id" element={<ProviderDetailPage />} />
            <Route path="/bandwidth/buy/item-categories" element={<ItemCategoryPage />} />
            <Route path="/bandwidth/buy/item-categories/new" element={<ItemCategoryFormPage />} />
            <Route path="/bandwidth/buy/item-categories/:id/edit" element={<ItemCategoryFormPage />} />
            <Route path="/bandwidth/buy/items" element={<ItemPage />} />
            <Route path="/bandwidth/buy/bills" element={<ProviderBillListPage />} />
            <Route path="/bandwidth/buy/bills/new" element={<PurchaseBillFormPage />} />
            <Route path="/bandwidth/buy/bills/:id/edit" element={<PurchaseBillFormPage />} />
            <Route path="/bandwidth/buy/bills/:id/invoice" element={<PurchaseBillInvoicePage />} />
            {/* ── Module 6 — Support & Ticketing ───────────────
                Sidebar entries: Ticket Types, Client Support
                (active), Full History — তিনটি page। আগের
                GenericListPage placeholder সরানো হলো। */}
            <Route path="/support/tickets" element={<ClientSupportPage />} />
            <Route path="/support/types"   element={<TicketTypePage />} />
            <Route path="/support/history" element={<SupportHistoryPage />} />
            {/* ── Module 7 — Task Management ───────────────────
                /tasks/list = All Tasks (admin); /tasks/mine = My Tasks
                (employee)। Sidebar entries আগেই এই path-এ point করে। */}
            <Route path="/tasks/list" element={<AllTasksPage />} />
            <Route path="/tasks/mine" element={<MyTasksPage />} />
            {/* ── Accounting Module 5 ─────────────────────────
                পূর্বের GenericListPage placeholder সরিয়ে full UI
                component mount করা হলো। দুটি tab-mode page (Income/
                Expense + P&L/Trial) বিভিন্ন path-এ initial tab prop
                সহ render হবে। */}
            {/* ── Accounting Module — Dashboard, Vouchers, Reports ─── */}
            <Route path="/accounting/dashboard"          element={<AccountingDashboard />} />
            <Route path="/accounting/chart-of-accounts"  element={<ChartOfAccountsPage />} />
            <Route path="/accounting/income"             element={<CreditVoucherPage />} />
            <Route path="/accounting/add-income"         element={<AddIncomePage />} />
            <Route path="/accounting/expense"            element={<DebitVoucherPage />} />
            <Route path="/accounting/add-expense"        element={<AddExpensePage />} />
            <Route path="/accounting/journal"            element={<JournalVoucherPage />} />
            <Route path="/accounting/create-journal"     element={<CreateJournalVoucherPage />} />
            <Route path="/accounting/account-transactions" element={<AccountTransactionsPage />} />
            <Route path="/accounting/account-balances"   element={<AccountBalancesPage />} />
            <Route path="/accounting/balance-sheet"      element={<BalanceSheetPage />} />
            <Route path="/accounting/profit-loss"        element={<ProfitLossPage />} />
            <Route path="/accounting/compare-profit-loss" element={<CompareProfitLossPage />} />
            <Route path="/accounting/trial-balance"      element={<TrialBalancePage />} />
            <Route path="/accounting/cash-book"          element={<CashBookPage />} />
            <Route path="/sms/gateways" element={<SmsGatewayPage />} />
            <Route path="/sms/templates" element={<SmsTemplatePage />} />
            <Route path="/sms/send" element={<SendSmsPage />} />
            <Route path="/sms/individual" element={<IndividualSmsPage />} />
            <Route path="/sms/logs" element={<Suspense fallback={<LoadingSpinner />}><GenericListPage title="SMS লগ" endpoint="/sms/logs/" /></Suspense>} />

            {/* ── Module 9 — Network GIS Map & Topology ────────────────
                /network/map      → Leaflet মানচিত্রে node/link management
                /network/topology → React Flow hierarchy diagram
                Sidebar-এ "Network Diagram" section-এর দুটি entry এই path-এ point করে */}
            <Route path="/network/map"      element={<NetworkMap />} />
            <Route path="/network/topology" element={<NetworkTopology />} />

            {/* ── Sales & Service ──────────────────────────────────
                Product Sales Invoice: list + create/edit
                Service Sales Invoice: list + create/edit */}
            <Route path="/sales/product-invoice"          element={<ProductSalesInvoicePage />} />
            <Route path="/sales/product-invoice/new"      element={<CreateSalesInvoicePage type="product" />} />
            <Route path="/sales/product-invoice/:id/edit" element={<CreateSalesInvoicePage type="product" />} />
            <Route path="/sales/service-invoice"          element={<ServiceSalesInvoicePage />} />
            <Route path="/sales/service-invoice/new"      element={<CreateSalesInvoicePage type="service" />} />
            <Route path="/sales/service-invoice/:id/edit" element={<CreateSalesInvoicePage type="service" />} />

            {/* Mobile App Management */}
            <Route path="/mobile/push"        element={<MobilePushPage />} />
            <Route path="/mobile/banners"     element={<AppBannerPage />} />
            <Route path="/mobile/app-version" element={<AppVersionPage />} />

            {/* POP Management */}
            <Route path="/pop/packages"      element={<POPPackagePage />} />
            <Route path="/pop/tariff-config" element={<POPTariffPage />} />
            <Route path="/pop/add"           element={<POPAddPage />} />
            <Route path="/pop/:id/edit"      element={<POPAddPage />} />
            <Route path="/pop/:id/profile"   element={<POPProfilePage />} />
            <Route path="/pop/list"          element={<POPListPage />} />
            <Route path="/pop/funding"       element={<POPFundingPage />} />
            <Route path="/pop/pgw-payments"  element={<ClientPGWPaymentsPage />} />
            <Route path="/pop/pgw-settlement" element={<POPPGWSettlementPage />} />
            <Route path="/pop/notice"        element={<POPNoticePage />} />

            {/* Purchase & Inventory */}
            <Route path="/purchase/vendors"              element={<VendorListPage />} />
            <Route path="/purchase/requisition"           element={<RequisitionListPage />} />
            <Route path="/purchase/requisition/new"       element={<RequisitionEntryPage />} />
            <Route path="/purchase/requisition/:id/edit"  element={<RequisitionEntryPage />} />
            <Route path="/purchase/list"                  element={<PurchaseListPage />} />
            <Route path="/purchase/new"                   element={<PurchaseEntryPage />} />
            <Route path="/purchase/new/:id/edit"          element={<PurchaseEntryPage />} />
            <Route path="/inventory/stock"                element={<StockPage />} />
            <Route path="/inventory/categories"            element={<InvItemCategoryPage />} />
            <Route path="/inventory/items"                 element={<InvItemPage />} />
            <Route path="/inventory/units"                 element={<UnitPage />} />
            <Route path="/inventory/store-locations"       element={<StoreLocationPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </CompanyProvider>
      </PermissionProvider>
    </AuthProvider>
  );
}
