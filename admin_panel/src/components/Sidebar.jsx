import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useCompany } from '../context/CompanyContext';
import { usePermission } from '../context/PermissionContext';
import { useAuth } from '../context/AuthContext';

// ── All menu items — moduleKey দিয়ে permission mapping ────────────────────
// moduleKey: parent module, subModuleKey: child module (permission check-এ ব্যবহার)
// alwaysShow: true হলে সব user-কে দেখাবে (permission check skip)
const MENU = [
  {
    label: 'Dashboard', path: '/', exact: true, moduleKey: 'dashboard',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>,
  },
  {
    label: 'Configuration', moduleKey: 'configuration',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Zone',            path: '/config/zones',          subModuleKey: 'zone' },
      { label: 'Sub Zone',        path: '/config/subzones',       subModuleKey: 'subzone' },
      { label: 'Box',             path: '/config/boxes',          subModuleKey: 'box' },
      { label: 'Connection Type', path: '/config/protocol-types', subModuleKey: 'connection_type' },
      { label: 'Client Type',     path: '/config/client-types',   subModuleKey: 'client_type' },
      { label: 'Package',         path: '/config/packages',       subModuleKey: 'package' },
      { label: 'District',        path: '/config/districts',      subModuleKey: 'district' },
      { label: 'Upazila',         path: '/config/upazilas',       subModuleKey: 'upazila' },
    ],
  },
  {
    label: 'Client', moduleKey: 'client',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" /></svg>,
    children: [
      { label: 'Add New',        path: '/clients/new',            subModuleKey: 'add_new' },
      { label: 'Client List',    path: '/clients',                subModuleKey: 'client_list' },
      { label: 'Left Client',    path: '/clients/left',           subModuleKey: 'left_client' },
      { label: 'Apps Management', path: '/clients/apps-management', subModuleKey: 'scheduler' },
    ],
  },
  {
    label: 'Billing', moduleKey: 'billing',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Bills',             path: '/billing/bills',              subModuleKey: 'billing_list' },
      { label: 'Daily Collection',  path: '/billing/daily-collection',   subModuleKey: 'daily_collection' },
      { label: 'Payment Reminder',  path: '/billing/payment-reminder',   subModuleKey: 'payment_reminder' },
    ],
  },
  {
    label: 'Server', moduleKey: 'mikrotik_server',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm14 1a1 1 0 11-2 0 1 1 0 012 0zM2 13a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2zm14 1a1 1 0 11-2 0 1 1 0 012 0z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Server',              path: '/radius/servers',        subModuleKey: 'server' },
      { label: 'Bulk Clients Import', path: '/mikrotik/bulk-import',  subModuleKey: 'bulk_clients_import' },
    ],
  },
  {
    label: 'HR & Payroll', moduleKey: 'hr',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Department',    path: '/hr/department',    subModuleKey: 'department' },
      { label: 'Payhead',       path: '/hr/payhead',       subModuleKey: 'payhead' },
      { label: 'Payroll',       path: '/hr/payroll',       subModuleKey: 'payroll' },
      { label: 'Position',      path: '/hr/position',      subModuleKey: 'position' },
      { label: 'Payslip',       path: '/hr/payslip',       subModuleKey: 'payslip' },
      { label: 'Add Employee',  path: '/hr/employees/new', subModuleKey: 'add_employee' },
      { label: 'Employee List', path: '/hr/employees',     subModuleKey: 'employee_list' },
      { label: 'Salary Sheet',  path: '/hr/salary-sheet',  subModuleKey: 'salary_sheet' },
      { label: 'Resign Rule',   path: '/hr/resign-rule',   subModuleKey: 'resign_rule' },
      { label: 'Resignation',   path: '/hr/resignation',   subModuleKey: 'resignation' },
      { label: 'Rejoin',        path: '/hr/rejoin',        subModuleKey: 'rejoin' },
      { label: 'Attendance',    path: '/hr/attendance',    subModuleKey: 'attendance' },
    ],
  },
  {
    label: 'OLT Management', moduleKey: 'olt_management',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'OLT List',       path: '/olt/list',  subModuleKey: 'olt' },
      { label: 'ONU Monitoring', path: '/olt/onus',  subModuleKey: 'olt_users' },
    ],
  },
  {
    label: 'Network Diagram', moduleKey: 'network_diagram',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Network Map', path: '/network/map',      subModuleKey: 'diagram' },
      { label: 'Topology',    path: '/network/topology', subModuleKey: 'network_connections' },
    ],
  },
  {
    label: 'POP', moduleKey: 'pop',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 3.636a1 1 0 010 1.414 7 7 0 000 9.9 1 1 0 11-1.414 1.414 9 9 0 010-12.728 1 1 0 011.414 0zm9.9 0a1 1 0 011.414 0 9 9 0 010 12.728 1 1 0 11-1.414-1.414 7 7 0 000-9.9 1 1 0 010-1.414zM7.879 6.464a1 1 0 010 1.414 3 3 0 000 4.243 1 1 0 11-1.415 1.414 5 5 0 010-7.07 1 1 0 011.415 0zm4.242 0a1 1 0 011.415 0 5 5 0 010 7.072 1 1 0 01-1.415-1.415 3 3 0 000-4.242 1 1 0 010-1.415zM10 9a1 1 0 011 1v.01a1 1 0 11-2 0V10a1 1 0 011-1z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Package',                   path: '/pop/packages',            subModuleKey: 'pop_package' },
      { label: 'Tariff Config',             path: '/pop/tariff-config',       subModuleKey: 'pop_tariff' },
      { label: 'Add POP',                   path: '/pop/add',                 subModuleKey: 'add_pop' },
      { label: 'POP List',                  path: '/pop/list',                subModuleKey: 'pop_list' },
      { label: 'POP Funding',               path: '/pop/funding',             subModuleKey: 'pop_funding' },
      { label: 'Client PGW Payments',       path: '/pop/pgw-payments',        subModuleKey: 'pop_pgw' },
      { label: 'PGW Transaction Settlement',path: '/pop/pgw-settlement',      subModuleKey: 'pop_pgw_settle' },
      { label: 'POP Notice',                path: '/pop/notice',              subModuleKey: 'pop_notice' },
    ],
  },
  {
    label: 'Support & Ticketing', moduleKey: 'support_ticketing',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Client Support',  path: '/support/tickets', subModuleKey: 'client_support' },
      { label: 'Support History', path: '/support/history', subModuleKey: 'support_history' },
      { label: 'Ticket Types',    path: '/support/types',   subModuleKey: 'support_category' },
    ],
  },
  {
    label: 'Task Management', moduleKey: 'task_management',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Tasks',    path: '/tasks/list', subModuleKey: 'task' },
      { label: 'My Tasks', path: '/tasks/mine', subModuleKey: 'task' },
    ],
  },
  {
    label: 'Bandwidth Buy', moduleKey: 'bandwidth_buy',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Item',          path: '/bandwidth/buy/items',          subModuleKey: 'item' },
      { label: 'Item Category', path: '/bandwidth/buy/item-categories',subModuleKey: 'item_category' },
      { label: 'Providers',     path: '/bandwidth/buy/providers',      subModuleKey: 'provider' },
      { label: 'Bills',         path: '/bandwidth/buy/bills',          subModuleKey: 'purchase_bill' },
    ],
  },
  {
    label: 'Purchase', moduleKey: 'purchase',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg>,
    children: [
      { label: 'Purchase List', path: '/purchase/list',        subModuleKey: 'purchase' },
      { label: 'Requisitions',  path: '/purchase/requisition',  subModuleKey: 'requisition' },
      { label: 'Vendors',       path: '/purchase/vendors',     subModuleKey: 'vendor' },
    ],
  },
  {
    label: 'Inventory', moduleKey: 'inventory',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" /><path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Stock',          path: '/inventory/stock',           subModuleKey: 'stock' },
      { label: 'Items',          path: '/inventory/items',           subModuleKey: 'item' },
      { label: 'Categories',     path: '/inventory/categories',      subModuleKey: 'item_category' },
      { label: 'Units',          path: '/inventory/units',           subModuleKey: 'unit' },
      { label: 'Store Location', path: '/inventory/store-locations', subModuleKey: 'store_location' },
    ],
  },
  {
    label: 'Sales & Service', moduleKey: 'sales_service',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2a2 2 0 100-4V6z" /></svg>,
    children: [
      { label: 'Product Invoice', path: '/sales/product-invoice', subModuleKey: 'product_invoice' },
      { label: 'Service Invoice', path: '/sales/service-invoice', subModuleKey: 'service_invoice' },
    ],
  },
  {
    label: 'Income', moduleKey: 'income',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Credit Voucher', path: '/accounting/income',     subModuleKey: 'daily_income' },
      { label: 'Add Income',     path: '/accounting/add-income', subModuleKey: 'daily_income' },
    ],
  },
  {
    label: 'Expense', moduleKey: 'expense',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Debit Voucher', path: '/accounting/expense',     subModuleKey: 'daily_expense' },
      { label: 'Add Expense',   path: '/accounting/add-expense', subModuleKey: 'daily_expense' },
    ],
  },
  {
    label: 'Daily Account', moduleKey: 'daily_account',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Cash Book', path: '/accounting/cash-book', subModuleKey: 'daily_account_closing' },
    ],
  },
  {
    label: 'Accounting', moduleKey: 'accounting',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Accounting Dashboard',    path: '/accounting/dashboard',           subModuleKey: 'accounting_dashboard' },
      { label: 'Chart of Accounts',       path: '/accounting/chart-of-accounts',   subModuleKey: 'chart_of_accounts' },
      { label: 'Income',                  path: '/accounting/income',              subModuleKey: 'accounting_income' },
      { label: 'Expense',                 path: '/accounting/expense',             subModuleKey: 'accounting_expense' },
      { label: 'Journal',                 path: '/accounting/journal',             subModuleKey: 'journal' },
      { label: 'Accounting Transactions', path: '/accounting/account-transactions',subModuleKey: 'accounting_transactions' },
      { label: 'Account Balances',        path: '/accounting/account-balances',    subModuleKey: 'account_balances' },
      { label: 'Balance Sheet',           path: '/accounting/balance-sheet',       subModuleKey: 'balance_sheet' },
      { label: 'Profit Loss',             path: '/accounting/profit-loss',         subModuleKey: 'profit_loss' },
      { label: 'Compare Profit Loss',     path: '/accounting/compare-profit-loss', subModuleKey: 'compare_profit_loss' },
      { label: 'Trial Balance',           path: '/accounting/trial-balance',       subModuleKey: 'trial_balance' },
      { label: 'Cash Book',               path: '/accounting/cash-book',           subModuleKey: 'cash_book' },
    ],
  },
  {
    label: 'SMS Service', moduleKey: 'sms_service',
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'Gateway Setup', path: '/sms/gateways', subModuleKey: 'sms_gateway', alwaysShow: true },
      { label: 'Individual SMS', path: '/sms/individual', subModuleKey: 'individual_sms', alwaysShow: true },
      { label: 'Send SMS',  path: '/sms/send',      subModuleKey: 'send_sms' },
      { label: 'Templates', path: '/sms/templates', subModuleKey: 'sms_template' },
      { label: 'SMS Logs',  path: '/sms/logs',      subModuleKey: 'individual_sms' },
    ],
  },
  {
    label: 'Live TV', moduleKey: 'livetv', superOnly: true,
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" /><circle cx="7" cy="3" r="1.2" fill="#ef4444" /><circle cx="7" cy="3" r="1.2" fill="#ef4444" className="animate-ping" /></svg>,
    children: [
      { label: 'Channels',          path: '/livetv',              subModuleKey: 'livetv_channels',     alwaysShow: true },
      { label: 'Registration',      path: '/livetv/registration', subModuleKey: 'livetv_registration', alwaysShow: true },
      { label: 'FTP Movie Server',  path: '/livetv/ftp',          subModuleKey: 'livetv_ftp',          alwaysShow: true },
    ],
  },
  {
    label: 'VoIP', moduleKey: 'voip', superOnly: true,
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>,
    children: [
      { label: 'Call Log',           path: '/voip/call-logs',   subModuleKey: 'call_log',       alwaysShow: true },
      { label: 'Voice SMS Service',  path: '/voip/voice-sms',   subModuleKey: 'voice_sms',      alwaysShow: true },
      { label: 'Hotline Control',    path: '/voip/hotline',     subModuleKey: 'pbx_hotline',    alwaysShow: true },
      { label: 'Ring Groups',        path: '/voip/ring-groups', subModuleKey: 'pbx_ring_groups',alwaysShow: true },
      { label: 'IVR Menu',           path: '/voip/ivr',         subModuleKey: 'pbx_ivr',        alwaysShow: true },
      { label: 'PBX Agents',         path: '/voip/pbx-agents',  subModuleKey: 'pbx_agents',     alwaysShow: true },
    ],
  },
  {
    label: 'System', moduleKey: 'system', superOnly: true,
    icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>,
    children: [
      { label: 'System Settings',   path: '/settings',                    subModuleKey: 'system_setup',      alwaysShow: true },
      { label: 'App Users',         path: '/system/app-users',            subModuleKey: 'app_users',         alwaysShow: true },
      { label: 'Company Info',      path: '/settings?tab=company',        subModuleKey: 'company_setup',     alwaysShow: true },
      { label: 'Payment Gateways',  path: '/system/payment-gateways',     subModuleKey: 'payment_gateways',  alwaysShow: true },
    ],
  },
];

// ── MenuItem ───────────────────────────────────────────────────────────
function MenuItem({ item }) {
  const location = useLocation();
  const isChildActive = item.children?.some(c =>
    location.pathname === c.path || location.pathname.startsWith(c.path + '/')
  );
  const [open, setOpen] = useState(isChildActive);

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className={`w-full flex items-center justify-between px-3 py-2 text-[12.5px] font-medium transition-all duration-150
            ${isChildActive
              ? 'bg-gradient-to-r from-gray-700 to-gray-400 text-white shadow-sm'
              : 'text-[#1c2333] hover:bg-gray-100 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <span className={`shrink-0 ${isChildActive ? 'text-white' : 'text-[#6b7280]'}`}>
              {item.icon}
            </span>
            <span className="truncate leading-tight">{item.label}</span>
          </span>
          <svg
            className={`w-3 h-3 shrink-0 transition-transform duration-150
              ${isChildActive ? 'text-white' : 'text-[#9ca3af]'} ${open ? 'rotate-90' : ''}`}
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </button>

        {open && (
          <div className="bg-gray-50 border-l-2 border-gray-300 ml-3">
            {item.children.map(child => (
              <NavLink
                key={child.path}
                to={child.path}
                end
                className={({ isActive }) =>
                  `flex items-center gap-2 pl-6 pr-3 py-[7px] text-xs transition-all duration-150
                    ${isActive
                      ? 'bg-gradient-to-r from-gray-700 to-gray-400 text-white font-semibold shadow-sm'
                      : 'text-[#4a5568] hover:bg-gray-100 hover:text-gray-700'}`
                }
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = item.exact
    ? location.pathname === item.path
    : location.pathname === item.path || location.pathname.startsWith(item.path + '/');

  return (
    <NavLink
      to={item.path}
      end={item.exact}
      className={`flex items-center gap-2.5 px-3 py-2 text-[12.5px] font-medium transition-all duration-150
        ${isActive
          ? 'bg-gradient-to-r from-gray-700 to-gray-400 text-white shadow-sm'
          : 'text-[#1c2333] hover:bg-gray-100 hover:text-gray-700'}`}
    >
      <span className={`shrink-0 ${isActive ? 'text-white' : 'text-[#6b7280]'}`}>
        {item.icon}
      </span>
      <span className="truncate leading-tight">{item.label}</span>
    </NavLink>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────
export default function Sidebar({ open, onClose }) {
  const [search, setSearch] = useState('');
  const { company } = useCompany();
  const { hasModule, hasSubModule, isSuper, loaded } = usePermission();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'superadmin';

  // Permission filter — parent module visible কিনা check করে
  const canSeeItem = (item) => {
    // superOnly: শুধুমাত্র superadmin দেখবে (admin সহ অন্য কেউ নয়)
    if (item.superOnly) return isSuperAdmin;
    if (item.alwaysShow) return true;
    if (!loaded || isSuper) return true;   // superadmin/admin → সব দেখে
    if (!item.moduleKey) return true;
    return hasModule(item.moduleKey);
  };

  // Child item visible কিনা
  const canSeeChild = (parentModuleKey, child) => {
    if (child.alwaysShow) return true;
    if (!loaded || isSuper) return true;
    if (!child.subModuleKey) return true;
    return hasSubModule(parentModuleKey, child.subModuleKey);
  };

  // Permission filter করা menu
  const permissionFiltered = MENU
    .filter(item => canSeeItem(item))
    .map(item => {
      if (!item.children) return item;
      const visibleChildren = item.children.filter(c => canSeeChild(item.moduleKey, c));
      return { ...item, children: visibleChildren };
    })
    .filter(item => !item.children || item.children.length > 0);

  // Search filter
  const filtered = search.trim()
    ? permissionFiltered.filter(item => {
        const q = search.toLowerCase();
        if (item.label.toLowerCase().includes(q)) return true;
        if (item.children?.some(c => c.label.toLowerCase().includes(q))) return true;
        return false;
      })
    : permissionFiltered;

  return (
    <>
      {/* Mobile backdrop — Leaflet .leaflet-top z-index=1000 এর উপরে রাখতে z-[1100] */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-[1100] lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel — backdrop (1100) এর উপরে z-[1200] */}
      <div className={`
        fixed top-[56px] left-0 h-[calc(100vh-56px)] z-[1200] w-[205px]
        bg-white border-r border-gray-200 flex flex-col overflow-hidden
        transition-transform duration-300 ease-in-out
        lg:static lg:top-auto lg:h-auto lg:z-auto lg:translate-x-0 lg:shrink-0
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden
          [&::-webkit-scrollbar]:w-1
          [&::-webkit-scrollbar-track]:bg-transparent
          [&::-webkit-scrollbar-thumb]:bg-gray-300
          [&::-webkit-scrollbar-thumb]:rounded">
          {filtered.map((item, i) => (
            <MenuItem key={i} item={item} />
          ))}
        </nav>
      </div>
    </>
  );
}
