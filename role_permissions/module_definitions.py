# module_definitions.py — সমস্ত Module ও Permission-এর static definition
# এই ফাইলটি UI তৈরিতে এবং permission enforcement-এ ব্যবহার হয়।

# access_type:
#   'toggle'   → শুধু on/off (parent module level)
#   'fwr'      → Full / Write / Read radio
#   'granular' → sub-modal-এ checkbox list

MODULES = [
    {
        'key': 'dashboard',
        'label': 'DASHBOARD (EMPLOYEE)',
        'access_type': 'toggle',
        'granular_context': 'dashboard_cards',
        'granular_label': 'Dashboard Card Permissions',
        'sub_modules': [],
    },
    {
        'key': 'configuration',
        'label': 'CONFIGURATION',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'zone',            'label': 'ZONE',            'access_type': 'fwr'},
            {'key': 'subzone',         'label': 'SUB ZONE',        'access_type': 'fwr'},
            {'key': 'box',             'label': 'BOX',             'access_type': 'fwr'},
            {'key': 'connection_type', 'label': 'CONNECTION TYPE', 'access_type': 'fwr'},
            {'key': 'client_type',     'label': 'CLIENT TYPE',     'access_type': 'fwr'},
            {'key': 'protocol_type',   'label': 'PROTOCOL TYPE',   'access_type': 'fwr'},
            {'key': 'billing_status',  'label': 'BILLING STATUS',  'access_type': 'fwr'},
            {'key': 'package',         'label': 'PACKAGE',         'access_type': 'fwr'},
            {'key': 'district',        'label': 'DISTRICT',        'access_type': 'fwr'},
            {'key': 'upazila',         'label': 'UPAZILA',         'access_type': 'fwr'},
        ],
    },
    {
        'key': 'client',
        'label': 'CLIENT',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'new_request',    'label': 'NEW REQUEST',    'access_type': 'granular', 'granular_context': 'new_request'},
            {'key': 'add_new',        'label': 'ADD NEW',        'access_type': 'granular', 'granular_context': 'add_new'},
            {'key': 'client_list',    'label': 'CLIENT LIST',    'access_type': 'granular', 'granular_context': 'client_list'},
            {'key': 'left_client',    'label': 'LEFT CLIENT',    'access_type': 'granular', 'granular_context': 'left_client'},
            {'key': 'scheduler',      'label': 'SCHEDULER',      'access_type': 'fwr'},
            {'key': 'customer_edit',  'label': 'CUSTOMER EDIT',  'access_type': 'fwr'},
            {'key': 'customer_detail','label': 'CUSTOMER DETAILS','access_type': 'fwr'},
        ],
    },
    {
        'key': 'billing',
        'label': 'BILLING',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'billing_list',        'label': 'BILLING LIST',        'access_type': 'granular', 'granular_context': 'billing_list'},
            {'key': 'daily_collection',    'label': 'DAILY BILL COLLECTION','access_type': 'fwr'},
            {'key': 'invoice',             'label': 'INVOICE',             'access_type': 'fwr'},
            {'key': 'installation_fees',   'label': 'INSTALLATION FEES',   'access_type': 'fwr'},
        ],
    },
    {
        'key': 'mikrotik_server',
        'label': 'MIKROTIK SERVER',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'server',              'label': 'SERVER',              'access_type': 'fwr'},
            {'key': 'server_backup',       'label': 'SERVER BACKUP',       'access_type': 'fwr'},
            {'key': 'import_from_mikrotik','label': 'IMPORT FROM MIKROTIK','access_type': 'fwr'},
            {'key': 'bulk_clients_import', 'label': 'BULK CLIENTS IMPORT', 'access_type': 'fwr'},
        ],
    },
    {
        'key': 'hr',
        'label': 'HR & PAYROLL',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'department',    'label': 'DEPARTMENT',    'access_type': 'fwr'},
            {'key': 'payhead',       'label': 'PAY HEAD',      'access_type': 'fwr'},
            {'key': 'payroll',       'label': 'PAYROLL',       'access_type': 'fwr'},
            {'key': 'position',      'label': 'POSITION',      'access_type': 'fwr'},
            {'key': 'payslip',       'label': 'PAYSLIP',       'access_type': 'fwr'},
            {'key': 'add_employee',  'label': 'ADD EMPLOYEE',  'access_type': 'fwr'},
            {'key': 'employee_list', 'label': 'EMPLOYEE LIST', 'access_type': 'fwr'},
            {'key': 'salary_sheet',  'label': 'SALARY SHEET',  'access_type': 'fwr'},
            {'key': 'resign_rule',   'label': 'RESIGN RULE',   'access_type': 'fwr'},
            {'key': 'resignation',   'label': 'RESIGNATION',   'access_type': 'fwr'},
            {'key': 'rejoin',        'label': 'REJOIN',        'access_type': 'fwr'},
            {'key': 'attendance',    'label': 'ATTENDANCE',    'access_type': 'fwr'},
        ],
    },
    {
        'key': 'olt_management',
        'label': 'OLT MANAGEMENT',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'olt',       'label': 'OLT',       'access_type': 'fwr'},
            {'key': 'olt_users', 'label': 'OLT USERS', 'access_type': 'fwr'},
        ],
    },
    {
        'key': 'network_diagram',
        'label': 'NETWORK DIAGRAM',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'diagram',              'label': 'DIAGRAM',              'access_type': 'fwr'},
            {'key': 'network_pop',          'label': 'NETWORK POP',          'access_type': 'fwr'},
            {'key': 'clients_in_diagram',   'label': 'CLIENTS IN DIAGRAM',   'access_type': 'fwr'},
            {'key': 'network_connections',  'label': 'NETWORK CONNECTIONS',  'access_type': 'fwr'},
            {'key': 'distributed_inv_items','label': 'DISTRIBUTED INV. ITEMS','access_type': 'fwr'},
            {'key': 'network_view_in_map',  'label': 'NETWORK VIEW IN MAP',  'access_type': 'fwr'},
        ],
    },
    {
        'key': 'leave_management',
        'label': 'LEAVE MANAGEMENT',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'leave_category', 'label': 'CATEGORY', 'access_type': 'fwr'},
            {'key': 'leave_setup',    'label': 'SETUP',    'access_type': 'fwr'},
            {'key': 'leave_apply',    'label': 'APPLY',    'access_type': 'fwr'},
            {'key': 'leave_approval', 'label': 'APPROVAL', 'access_type': 'fwr'},
        ],
    },
    {
        'key': 'pop',
        'label': 'POP',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'pop_package',     'label': 'PACKAGE',     'access_type': 'fwr'},
            {'key': 'tariff_config',   'label': 'TARIFF CONFIG','access_type': 'fwr'},
            {'key': 'add_pop',         'label': 'ADD POP',     'access_type': 'fwr'},
            {'key': 'pop_list',        'label': 'POP LIST',    'access_type': 'fwr'},
        ],
    },
    {
        'key': 'events_holidays',
        'label': 'EVENTS & HOLIDAYS',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'events_index', 'label': 'INDEX', 'access_type': 'fwr'},
        ],
    },
    {
        'key': 'support_ticketing',
        'label': 'SUPPORT & TICKETING',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'support_category', 'label': 'SUPPORT CATEGORY', 'access_type': 'fwr'},
            {'key': 'client_support',   'label': 'CLIENT SUPPORT',   'access_type': 'fwr'},
            {'key': 'support_history',  'label': 'SUPPORT HISTORY',  'access_type': 'fwr'},
        ],
    },
    {
        'key': 'task_management',
        'label': 'TASK MANAGEMENT',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'task_category', 'label': 'TASK CATEGORY', 'access_type': 'fwr'},
            {'key': 'task',          'label': 'TASK',          'access_type': 'fwr'},
            {'key': 'task_history',  'label': 'TASK HISTORY',  'access_type': 'fwr'},
        ],
    },
    {
        'key': 'purchase',
        'label': 'PURCHASE',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'vendor',       'label': 'VENDOR',       'access_type': 'fwr'},
            {'key': 'requisition',  'label': 'REQUISITION',  'access_type': 'fwr'},
            {'key': 'purchase',     'label': 'PURCHASE',     'access_type': 'fwr'},
            {'key': 'purchase_bill','label': 'PURCHASE BILL','access_type': 'fwr'},
        ],
    },
    {
        'key': 'inventory',
        'label': 'INVENTORY',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'unit',           'label': 'UNIT',           'access_type': 'fwr'},
            {'key': 'store_location', 'label': 'STORE LOCATION', 'access_type': 'fwr'},
            {'key': 'item_category',  'label': 'ITEM CATEGORY',  'access_type': 'fwr'},
            {'key': 'item',           'label': 'ITEM',           'access_type': 'fwr'},
            {'key': 'stock',          'label': 'STOCK',          'access_type': 'fwr'},
        ],
    },
    {
        'key': 'assets',
        'label': 'ASSETS',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'asset_list',      'label': 'ASSET LIST',      'access_type': 'fwr'},
            {'key': 'destroyed_items', 'label': 'DESTROYED ITEMS', 'access_type': 'fwr'},
        ],
    },
    {
        'key': 'sales_service',
        'label': 'SALES & SERVICE',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'product_invoice',  'label': 'PRODUCT INVOICE',  'access_type': 'fwr'},
            {'key': 'service_invoice',  'label': 'SERVICE INVOICE',  'access_type': 'fwr'},
            {'key': 'installation_fee', 'label': 'INSTALLATION FEE', 'access_type': 'fwr'},
        ],
    },
    {
        'key': 'income',
        'label': 'INCOME',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'income_category', 'label': 'INCOME CATEGORY', 'access_type': 'fwr'},
            {'key': 'daily_income',    'label': 'DAILY INCOME',    'access_type': 'fwr'},
            {'key': 'income_history',  'label': 'INCOME HISTORY',  'access_type': 'fwr'},
        ],
    },
    {
        'key': 'expense',
        'label': 'EXPENSE',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'expense_category', 'label': 'EXPENSE CATEGORY', 'access_type': 'fwr'},
            {'key': 'daily_expense',    'label': 'DAILY EXPENSE',    'access_type': 'fwr'},
            {'key': 'expense_history',  'label': 'EXPENSE HISTORY',  'access_type': 'fwr'},
        ],
    },
    {
        'key': 'daily_account',
        'label': 'DAILY ACCOUNT',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'daily_total_income',  'label': 'DAILY TOTAL INCOME',  'access_type': 'fwr'},
            {'key': 'daily_total_expense', 'label': 'DAILY TOTAL EXPENSE', 'access_type': 'fwr'},
            {'key': 'daily_account_closing','label': 'DAILY ACCOUNT CLOSING','access_type': 'fwr'},
        ],
    },
    {
        'key': 'accounting',
        'label': 'ACCOUNTING',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'accounting_dashboard',    'label': 'ACCOUNTING DASHBOARD',    'access_type': 'fwr'},
            {'key': 'chart_of_accounts',       'label': 'CHART OF ACCOUNTS',       'access_type': 'fwr'},
            {'key': 'accounting_income',       'label': 'INCOME',                  'access_type': 'fwr'},
            {'key': 'accounting_expense',      'label': 'EXPENSE',                 'access_type': 'fwr'},
            {'key': 'journal',                 'label': 'JOURNAL',                 'access_type': 'fwr'},
            {'key': 'accounting_transactions', 'label': 'ACCOUNTING TRANSACTIONS', 'access_type': 'fwr'},
            {'key': 'account_balances',        'label': 'ACCOUNT BALANCES',        'access_type': 'fwr'},
            {'key': 'balance_sheet',           'label': 'BALANCE SHEET',           'access_type': 'fwr'},
            {'key': 'profit_loss',             'label': 'PROFIT LOSS',             'access_type': 'fwr'},
            {'key': 'compare_profit_loss',     'label': 'COMPARE PROFIT LOSS',     'access_type': 'fwr'},
            {'key': 'trial_balance',           'label': 'TRIAL BALANCE',           'access_type': 'fwr'},
            {'key': 'cash_book',               'label': 'CASH BOOK',               'access_type': 'fwr'},
        ],
    },
    {
        'key': 'report',
        'label': 'REPORT',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'bill_collection_report', 'label': 'BILL COLLECTION',      'access_type': 'fwr'},
            {'key': 'discount_report',        'label': 'DISCOUNT REPORT',      'access_type': 'fwr'},
            {'key': 'customer_report',        'label': 'CUSTOMER REPORT',      'access_type': 'fwr'},
            {'key': 'financial_transactions', 'label': 'FINANCIAL TRANSACTIONS','access_type': 'fwr'},
            {'key': 'all_report',             'label': 'ALL REPORT',           'access_type': 'fwr'},
        ],
    },
    {
        'key': 'sms_service',
        'label': 'SMS SERVICE',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'individual_sms', 'label': 'INDIVIDUAL SMS', 'access_type': 'fwr'},
            {'key': 'sms_template',   'label': 'SMS TEMPLATE',   'access_type': 'fwr'},
            {'key': 'sms_group',      'label': 'SMS GROUP',      'access_type': 'fwr'},
            {'key': 'send_sms',       'label': 'SEND SMS',       'access_type': 'fwr'},
            {'key': 'sms_gateway',    'label': 'SMS GATEWAY',    'access_type': 'fwr'},
        ],
    },
    {
        'key': 'system',
        'label': 'SYSTEM',
        'access_type': 'toggle',
        'sub_modules': [
            {'key': 'app_users',        'label': 'APP USERS',        'access_type': 'fwr'},
            {'key': 'company_setup',    'label': 'COMPANY SETUP',    'access_type': 'fwr'},
            {'key': 'invoice_setup',    'label': 'INVOICE SETUP',    'access_type': 'fwr'},
            {'key': 'system_setup',     'label': 'SYSTEM SETUP',     'access_type': 'fwr'},
            {'key': 'activity_loggers', 'label': 'ACTIVITY LOGGERS', 'access_type': 'fwr'},
            {'key': 'automatic_process','label': 'AUTOMATIC PROCESS','access_type': 'fwr'},
        ],
    },
    # standalone modules — শুধু Full/Write/Read, sub-module নেই
    {'key': 'online_client_monitoring', 'label': 'ONLINE CLIENT MONITORING', 'access_type': 'fwr', 'sub_modules': []},
    {'key': 'money_receipt',            'label': 'MONEY RECEIPT',            'access_type': 'fwr', 'sub_modules': []},
    {'key': 'notifications',            'label': 'NOTIFICATIONS',            'access_type': 'fwr', 'sub_modules': []},
    {'key': 'search_customer',          'label': 'SEARCH CUSTOMER',          'access_type': 'fwr', 'sub_modules': []},
    {
        'key': 'common_permissions',
        'label': 'COMMON PERMISSIONS',
        'access_type': 'toggle',
        'granular_context': 'common',
        'granular_label': 'Common Permissions',
        'sub_modules': [],
    },
]

# ── Granular Permission Definitions ────────────────────────────────────────────

GRANULAR_PERMISSIONS = {

    # Employee Panel home stat-card permissions। key গুলো frontend
    # Dashboard.CARD_GRANULAR ও AppUsersPage STATIC_GRANULAR.dashboard_cards-এর
    # সাথে হুবহু মিলবে — নাহলে tick করা কার্ড employee দেখবে না।
    'dashboard_cards': [
        # Top cards
        {'key': 'total_client',           'label': 'TOTAL CLIENT'},
        {'key': 'running_clients',        'label': 'RUNNING CLIENTS'},
        {'key': 'inactive_clients',       'label': 'INACTIVE CLIENTS'},
        {'key': 'waiver_clients',         'label': 'WAIVER CLIENTS'},
        {'key': 'new_client',             'label': 'NEW CLIENT'},
        {'key': 'renewed_clients',        'label': 'RENEWED CLIENTS'},
        {'key': 'deactivated_clients',    'label': 'DEACTIVATED CLIENTS'},
        {'key': 'left_clients',           'label': 'LEFT CLIENTS'},
        {'key': 'billing_clients',        'label': 'BILLING CLIENTS'},
        {'key': 'paid_clients',           'label': 'PAID CLIENTS'},
        {'key': 'partially_paid',         'label': 'PARTIALLY PAID'},
        {'key': 'unpaid_clients',         'label': 'UNPAID CLIENTS'},
        {'key': 'online_clients',         'label': 'ONLINE CLIENTS'},
        {'key': 'blocked_clients',        'label': 'BLOCKED CLIENTS'},
        {'key': 'bill_date_expire',       'label': 'BILL DATE EXPIRE'},
        {'key': 'unpaid_extension',       'label': 'UNPAID EXTENSION'},
        {'key': 'total_pop',              'label': 'TOTAL POP'},
        {'key': 'total_pop_clients',      'label': 'TOTAL POP CLIENTS'},
        {'key': 'enabled_pop_clients',    'label': 'ENABLED POP CLIENTS'},
        {'key': 'disabled_pop_clients',   'label': 'DISABLED POP CLIENTS'},
        # Ticket / task cards
        {'key': 'pending_tickets',        'label': 'PENDING TICKETS'},
        {'key': 'processing_tickets',     'label': 'PROCESSING TICKETS'},
        {'key': 'pending_task',           'label': 'PENDING TASK'},
        {'key': 'processing_task',        'label': 'PROCESSING TASK'},
        # Bottom (financial) cards
        {'key': 'monthly_bill',           'label': 'MONTHLY BILL'},
        {'key': 'collected_bill',         'label': 'COLLECTED BILL'},
        {'key': 'discount',               'label': 'DISCOUNT'},
        {'key': 'total_due',              'label': 'TOTAL DUE'},
        {'key': 'service_sales_invoice',  'label': 'SERVICE SALES INVOICE'},
        {'key': 'product_sales_invoice',  'label': 'PRODUCT SALES INVOICE'},
        {'key': 'income',                 'label': 'INCOME'},
        {'key': 'expense',                'label': 'EXPENSE'},
        {'key': 'credited_amount',        'label': 'CREDITED AMOUNT'},
        {'key': 'pop_fund',               'label': 'POP FUND'},
        {'key': 'pop_bill',               'label': 'POP BILL'},
        {'key': 'receivable_amount',      'label': 'RECEIVABLE AMOUNT'},
        {'key': 'bwidth_provider_bill',   'label': 'B.WIDTH PROVIDER BILL'},
        {'key': 'bwidth_provider_due',    'label': 'B.WIDTH PROVIDER DUE'},
        {'key': 'bwidth_pop_bill',        'label': 'B.WIDTH POP BILL'},
        {'key': 'paid_salary',            'label': 'PAID SALARY'},
        {'key': 'sms_balance',            'label': 'SMS BALANCE'},
        {'key': 'purchase_payable_due',   'label': 'PURCHASE PAYABLE DUE'},
        {'key': 'purchase_paid_amount',   'label': 'PURCHASE PAID AMOUNT'},
        {'key': 'cash_on_hand',           'label': 'CASH ON HAND'},
    ],

    'common': [
        {'key': 'customer_edit',          'label': 'CUSTOMER EDIT'},
        {'key': 'location_edit',          'label': 'CLIENT LOCATION (LAT/LNG) EDIT/UPDATE'},
        {'key': 'customer_details',       'label': 'CUSTOMER DETAILS'},
        {'key': 'register_new_client',    'label': 'REGISTER NEW CLIENT'},
        {'key': 'change_mikrotik_status', 'label': 'CHANGE MIKROTIK STATUS'},
        {'key': 'enable_selected',        'label': 'ENABLE SELECTED CLIENTS'},
        {'key': 'disable_selected',       'label': 'DISABLE SELECTED CLIENTS'},
        {'key': 'bulk_status_change',     'label': 'BULK STATUS CHANGE'},
        {'key': 'client_delete',          'label': 'CLIENT DELETE'},
        {'key': 'password_regenerate',    'label': 'PASSWORD REGENERATE'},
        {'key': 'allow_discount_edit',    'label': 'ALLOW DISCOUNT EDIT (RECEIVE BILL)'},
        {'key': 'receive_bill_cancel',    'label': 'RECEIVE BILL HISTORY CANCEL'},
        {'key': 'status_change_scheduler','label': 'STATUS CHANGE SCHEDULER'},
        {'key': 'package_change_scheduler','label': 'PACKAGE CHANGE SCHEDULER'},
        {'key': 'send_individual_sms',    'label': 'SEND INDIVIDUAL SMS'},
    ],

    'client_list': [
        {'key': 'customer_table',          'label': 'CUSTOMER TABLE'},
        {'key': 'excel_download',          'label': 'EXCEL DOWNLOAD'},
        {'key': 'pdf_download',            'label': 'PDF DOWNLOAD'},
        {'key': 'sync_clients_servers',    'label': 'SYNC CLIENTS & SERVERS'},
        {'key': 'customer_bulk_profile',   'label': 'CUSTOMER BULK PROFILE CHANGE'},
        {'key': 'bulk_package_change',     'label': 'BULK PACKAGE CHANGE'},
    ],

    'billing_list': [
        {'key': 'data_table',              'label': 'DATA TABLE'},
        {'key': 'billing_list_excel',      'label': 'BILLING LIST EXCEL DOWNLOAD'},
        {'key': 'billing_list_pdf',        'label': 'BILLING LIST PDF DOWNLOAD'},
        {'key': 'expiry_date_update',      'label': 'EXPIRY DATE SET/UPDATE'},
        {'key': 'download_invoice',        'label': 'DOWNLOAD INVOICE'},
        {'key': 'bulk_sms',                'label': 'BULK SMS'},
        {'key': 'customer_bill_receive',   'label': 'CUSTOMER BILL RECEIVE'},
        {'key': 'money_receipt',           'label': 'MONEY RECEIPT'},
        {'key': 'bulk_email',              'label': 'BULK EMAIL'},
    ],

    'add_new': [
        {'key': 'add_new_customer', 'label': 'ADD NEW CUSTOMER'},
    ],

    'left_client': [
        {'key': 'left_client_table', 'label': 'LEFT CLIENT TABLE'},
    ],
}
