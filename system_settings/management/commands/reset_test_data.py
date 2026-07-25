# Production-level test-এর জন্য নিরাপদ data reset।
#
# শুধু OPERATIONAL/TEST data মুছে — clients, bills, payments, tickets, accounting
# transactions, OLT signals, payroll, sales/purchase ইত্যাদি — এবং RADIUS-এর
# client-নির্দিষ্ট টেবিল (radacct/radcheck/radusergroup ...)।
#
# অক্ষত রাখে (config/setup, নিরাপদ): admin/staff users, django_migrations,
# Zone/Package/Type, Chart of Accounts + Account types, role permissions,
# Mikrotik/RADIUS servers, RADIUS group profiles (nas, radgroupreply, radgroupcheck),
# company/system settings, HR master (Employee/Department/Position), categories।
#
# ব্যবহার:
#   python manage.py reset_test_data            # শুধু কী মুছবে দেখায় (dry preview)
#   python manage.py reset_test_data --yes      # সত্যিই মুছে (আগে BACKUP নিন!)
from django.core.management.base import BaseCommand
from django.db import connection
from django.apps import apps


class Command(BaseCommand):
    help = ('Operational/test data মুছে দেয় (config + users + RADIUS setup + '
            'migrations অক্ষত রেখে)। --yes ছাড়া শুধু preview দেখায়।')

    # মুছবে এমন operational model — child আগে, parent পরে (যদিও FK checks off-এ order জরুরি নয়)।
    CLEAR_MODELS = [
        # ── Support ──
        'support.TicketReply', 'support.TicketActivityLog',
        'support.StaffNotification', 'support.SupportTicket',
        # ── Billing ──
        'billing.Payment', 'billing.WebhookPayment', 'billing.InstallationFee',
        'billing.DailyCollection', 'billing.ReminderLog', 'billing.Bill',
        # ── Accounting transactions (Chart/Type/Category রাখে) ──
        'accounting.JournalLine', 'accounting.JournalEntry',
        'accounting.Income', 'accounting.Expense', 'accounting.DailyAccount',
        # ── OLT operational (OLT device config রাখে) ──
        'olt_mgmt.ONUSignal', 'olt_mgmt.OLTMacCache', 'olt_mgmt.ONU', 'olt_mgmt.SNMPTrapLog',
        # ── SMS log (gateway/template/group রাখে) ──
        'sms_service.SMSLog',
        # ── HR operational (Employee/Department/Position/PayHead রাখে) ──
        'hr.PayslipPayment', 'hr.PayslipEntry', 'hr.PayrollSheet', 'hr.PayrollPayHead',
        'hr.Payroll', 'hr.PayrollPeriod', 'hr.Attendance', 'hr.AdvanceRecovery',
        'hr.EmployeeAdvance', 'hr.CollectorCashTransaction', 'hr.CollectorCashBalance',
        'hr.Rejoin', 'hr.Resignation',
        # ── Tasks (TaskCategory রাখে) ──
        'tasks_mgmt.TaskHistory', 'tasks_mgmt.Task',
        # ── Purchase operational (Provider/Vendor রাখে) ──
        'purchase.ProviderBillPayment', 'purchase.ProviderBillLine', 'purchase.ProviderBill',
        'purchase.PurchaseOrderItem', 'purchase.PurchaseOrder',
        'purchase.PurchaseRequisitionItem', 'purchase.PurchaseRequisition', 'purchase.PurchaseBill',
        # ── Sales ──
        'sales.ProductSalesPayment', 'sales.ProductSalesInvoiceLine', 'sales.ProductSalesInvoice',
        'sales.ServiceSalesPayment', 'sales.ServiceSalesInvoiceLine', 'sales.ServiceSalesInvoice',
        # ── POP operational (Tariff config রাখে) ──
        'pop.ClientPGWPayment', 'pop.POPFunding', 'pop.POPNotice',
        # ── Assets ──
        'assets.DestroyedItem', 'assets.Asset',
        # ── Inventory operational (Item/Category/Store/Unit রাখে) ──
        'inventory.StockTransaction', 'inventory.Stock',
        # ── Logs/backups (server config রাখে) ──
        'radius_app.RadiusLog', 'radius_app.RadiusSession', 'mikrotik_app.RouterBackup',
        'system_settings.ActivityLog',
        # ── Clients (সবার শেষে) ──
        'clients.ClientActivityLog', 'clients.ClientChangeLog', 'clients.ClientStatusLog',
        'clients.ClientMonthlyTraffic', 'clients.ClientScheduler', 'clients.ChangeRequest',
        'clients.LeftClient', 'clients.Client',
    ]

    # RADIUS client-নির্দিষ্ট টেবিল — nas / radgroupreply / radgroupcheck (group config) রাখি
    RADIUS_TABLES = ['radacct', 'radcheck', 'radreply', 'radusergroup', 'radpostauth']

    def add_arguments(self, parser):
        parser.add_argument('--yes', action='store_true',
                            help='সত্যিই মুছে দেয় (নইলে শুধু preview)।')

    def _resolve_tables(self):
        existing = set(connection.introspection.table_names())
        tables = []
        for path in self.CLEAR_MODELS:
            app_label, model_name = path.split('.')
            try:
                t = apps.get_model(app_label, model_name)._meta.db_table
                if t in existing:
                    tables.append((path, t))
            except LookupError:
                self.stderr.write(f'  skip (model নেই): {path}')
        for t in self.RADIUS_TABLES:
            if t in existing:
                tables.append((f'radius.{t}', t))
        return tables

    def handle(self, *args, **opts):
        tables = self._resolve_tables()

        if not opts['yes']:
            self.stdout.write(self.style.WARNING(
                '\n⚠️  এই command নিচের operational/test টেবিলগুলো খালি করবে '
                '(config/users/RADIUS setup/migrations অক্ষত থাকবে):\n'))
            for path, t in tables:
                self.stdout.write(f'   • {path:42s} ({t})')
            self.stdout.write(self.style.WARNING(
                f'\nমোট {len(tables)} টেবিল। ⚠️ আগে BACKUP নিন '
                '(sudo bash install.sh backup)।'))
            self.stdout.write('সত্যিই মুছতে চাইলে আবার চালান:  '
                              + self.style.SQL_KEYWORD('python manage.py reset_test_data --yes'))
            return

        self.stdout.write('Operational/test data মুছে ফেলা হচ্ছে...')
        cleared, failed = 0, 0
        with connection.cursor() as cur:
            # DB-র আসল টেবিলের allowlist — dynamic SQL-এ শুধু এই set-এর নাম বসে (S2077)।
            valid_tables = set(connection.introspection.table_names(cur))
            for path, t in tables:
                if t not in valid_tables:
                    self.stdout.write(f'  ⚠ skip (আসল টেবিল নয়): {t}')
                    continue
                # allowlisted identifier + backend quote_name — নিরাপদ interpolation
                q = connection.ops.quote_name(t)
                try:
                    # TRUNCATE ... RESTART IDENTITY CASCADE: MySQL-এর
                    # DELETE FROM + ALTER TABLE AUTO_INCREMENT=1 + FOREIGN_KEY_CHECKS=0
                    # — এই তিনটার কাজ একসাথে করে (PostgreSQL-এ FK check bypass করতে
                    # CASCADE ব্যবহার হয়, sequence reset RESTART IDENTITY দিয়ে)।
                    cur.execute(f'TRUNCATE TABLE {q} RESTART IDENTITY CASCADE')
                    cleared += 1
                    self.stdout.write(f'  ✓ {t}')
                except Exception as e:
                    failed += 1
                    self.stderr.write(f'  ✗ {t}: {e}')

        self.stdout.write(self.style.SUCCESS(
            f'\n✓ সম্পন্ন — {cleared} টেবিল খালি'
            + (f', {failed} ব্যর্থ' if failed else '')
            + '।\nঅক্ষত: admin/staff users, config (zones/packages/types), '
            'Chart of Accounts, role permissions, Mikrotik/RADIUS servers, '
            'RADIUS group profiles (nas/radgroupreply), settings, migrations।\n'
            'এখন admin login করে নতুন (production) data দিয়ে শুরু করুন।'))
