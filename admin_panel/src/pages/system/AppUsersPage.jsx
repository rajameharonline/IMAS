// App Users Page — Application Users, Roles, Role Modules/Permissions management
// তিনটি ট্যাব: Application Users | User Roles(Groups) | Role Modules(Permissions)
import { useState, useEffect, useCallback } from 'react'
import api from '../../utils/api'
import toast from 'react-hot-toast'

/* ─── সাধারণ style constants ───────────────────────────────────────────────── */
const INP = 'w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1d435d] focus:border-[#1d435d] bg-white'
const SEL = `${INP} appearance-none`
const LBL = 'block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide'
const HDR_BG = 'bg-[#1d435d]'

/* ─── Module definitions — API থেকে আসে, fallback হিসেবে এখানে static ──────── */
const STATIC_MODULES = [
  { key: 'dashboard', label: 'DASHBOARD (EMPLOYEE)', access_type: 'toggle', granular_context: 'dashboard_cards', granular_label: 'Dashboard Card Permissions', sub_modules: [] },
  { key: 'configuration', label: 'CONFIGURATION', access_type: 'toggle', sub_modules: [
    { key: 'zone', label: 'ZONE', access_type: 'fwr' },
    { key: 'package', label: 'PACKAGE', access_type: 'fwr' },
    { key: 'connection_type', label: 'CONNECTION TYPE', access_type: 'fwr' },
  ]},
  { key: 'clients', label: 'CLIENTS', access_type: 'toggle', sub_modules: [
    { key: 'client_list', label: 'CLIENT LIST', access_type: 'granular', granular_context: 'client_list' },
    { key: 'client_add', label: 'ADD CLIENT', access_type: 'fwr' },
    { key: 'client_search', label: 'CLIENT SEARCH', access_type: 'fwr' },
    { key: 'left_clients', label: 'LEFT CLIENTS', access_type: 'fwr' },
  ]},
  { key: 'billing', label: 'BILLING', access_type: 'toggle', sub_modules: [
    { key: 'billing_list', label: 'BILLING LIST', access_type: 'granular', granular_context: 'billing_list' },
    { key: 'daily_collection', label: 'DAILY BILL COLLECTION', access_type: 'fwr' },
  ]},
  { key: 'accounting', label: 'ACCOUNTING', access_type: 'toggle', sub_modules: [
    { key: 'accounting_dashboard', label: 'ACCOUNTING DASHBOARD', access_type: 'fwr' },
    { key: 'chart_of_accounts', label: 'CHART OF ACCOUNTS', access_type: 'fwr' },
    { key: 'credit_voucher', label: 'CREDIT VOUCHER', access_type: 'fwr' },
    { key: 'debit_voucher', label: 'DEBIT VOUCHER', access_type: 'fwr' },
    { key: 'journal_voucher', label: 'JOURNAL VOUCHER', access_type: 'fwr' },
  ]},
  { key: 'hr', label: 'HR / PAYROLL', access_type: 'toggle', sub_modules: [
    { key: 'employee', label: 'EMPLOYEE', access_type: 'fwr' },
    { key: 'payroll', label: 'PAYROLL', access_type: 'fwr' },
    { key: 'attendance', label: 'ATTENDANCE', access_type: 'fwr' },
  ]},
  { key: 'support', label: 'SUPPORT', access_type: 'toggle', sub_modules: [
    { key: 'ticket', label: 'SUPPORT TICKET', access_type: 'fwr' },
  ]},
  { key: 'tasks', label: 'TASKS', access_type: 'toggle', sub_modules: [
    { key: 'all_tasks', label: 'ALL TASKS', access_type: 'fwr' },
    { key: 'my_tasks', label: 'MY TASKS', access_type: 'fwr' },
  ]},
  { key: 'network', label: 'NETWORK', access_type: 'toggle', sub_modules: [
    { key: 'network_map', label: 'NETWORK MAP', access_type: 'fwr' },
  ]},
  { key: 'radius', label: 'RADIUS', access_type: 'toggle', sub_modules: [
    { key: 'radius_server', label: 'RADIUS SERVER', access_type: 'fwr' },
    { key: 'online_clients', label: 'ONLINE CLIENTS', access_type: 'fwr' },
  ]},
  { key: 'reports', label: 'REPORTS', access_type: 'toggle', sub_modules: [
    { key: 'income_report', label: 'INCOME REPORT', access_type: 'fwr' },
    { key: 'expense_report', label: 'EXPENSE REPORT', access_type: 'fwr' },
  ]},
  { key: 'system', label: 'SYSTEM', access_type: 'toggle', sub_modules: [
    { key: 'app_users', label: 'APP USERS', access_type: 'fwr' },
    { key: 'settings', label: 'SETTINGS', access_type: 'fwr' },
  ]},
]

const STATIC_GRANULAR = {
  dashboard_cards: [
    // Top cards
    { key: 'total_client', label: 'TOTAL CLIENT' },
    { key: 'running_clients', label: 'RUNNING CLIENTS' },
    { key: 'inactive_clients', label: 'INACTIVE CLIENTS' },
    { key: 'waiver_clients', label: 'WAIVER CLIENTS' },
    { key: 'new_client', label: 'NEW CLIENT' },
    { key: 'renewed_clients', label: 'RENEWED CLIENTS' },
    { key: 'deactivated_clients', label: 'DEACTIVATED CLIENTS' },
    { key: 'left_clients', label: 'LEFT CLIENTS' },
    { key: 'billing_clients', label: 'BILLING CLIENTS' },
    { key: 'paid_clients', label: 'PAID CLIENTS' },
    { key: 'partially_paid', label: 'PARTIALLY PAID' },
    { key: 'unpaid_clients', label: 'UNPAID CLIENTS' },
    { key: 'online_clients', label: 'ONLINE CLIENTS' },
    { key: 'blocked_clients', label: 'BLOCKED CLIENTS' },
    { key: 'bill_date_expire', label: 'BILL DATE EXPIRE' },
    { key: 'unpaid_extension', label: 'UNPAID EXTENSION' },
    { key: 'total_pop', label: 'TOTAL POP' },
    { key: 'total_pop_clients', label: 'TOTAL POP CLIENTS' },
    { key: 'enabled_pop_clients', label: 'ENABLED POP CLIENTS' },
    { key: 'disabled_pop_clients', label: 'DISABLED POP CLIENTS' },
    // Ticket / task cards
    { key: 'pending_tickets', label: 'PENDING TICKETS' },
    { key: 'processing_tickets', label: 'PROCESSING TICKETS' },
    { key: 'pending_task', label: 'PENDING TASK' },
    { key: 'processing_task', label: 'PROCESSING TASK' },
    // Bottom (financial) cards
    { key: 'monthly_bill', label: 'MONTHLY BILL' },
    { key: 'collected_bill', label: 'COLLECTED BILL' },
    { key: 'discount', label: 'DISCOUNT' },
    { key: 'total_due', label: 'TOTAL DUE' },
    { key: 'service_sales_invoice', label: 'SERVICE SALES INVOICE' },
    { key: 'product_sales_invoice', label: 'PRODUCT SALES INVOICE' },
    { key: 'income', label: 'INCOME' },
    { key: 'expense', label: 'EXPENSE' },
    { key: 'credited_amount', label: 'CREDITED AMOUNT' },
    { key: 'pop_fund', label: 'POP FUND' },
    { key: 'pop_bill', label: 'POP BILL' },
    { key: 'receivable_amount', label: 'RECEIVABLE AMOUNT' },
    { key: 'bwidth_provider_bill', label: 'B.WIDTH PROVIDER BILL' },
    { key: 'bwidth_provider_due', label: 'B.WIDTH PROVIDER DUE' },
    { key: 'bwidth_pop_bill', label: 'B.WIDTH POP BILL' },
    { key: 'paid_salary', label: 'PAID SALARY' },
    { key: 'sms_balance', label: 'SMS BALANCE' },
    { key: 'purchase_payable_due', label: 'PURCHASE PAYABLE DUE' },
    { key: 'purchase_paid_amount', label: 'PURCHASE PAID AMOUNT' },
    { key: 'cash_on_hand', label: 'CASH ON HAND' },
  ],
  client_list: [
    { key: 'view_profile', label: 'VIEW PROFILE' },
    { key: 'edit_client', label: 'EDIT CLIENT' },
    { key: 'delete_client', label: 'DELETE CLIENT' },
    { key: 'change_status', label: 'CHANGE STATUS' },
    { key: 'download_invoice', label: 'DOWNLOAD INVOICE' },
    { key: 'send_sms', label: 'SEND SMS' },
  ],
  billing_list: [
    { key: 'download_invoice', label: 'DOWNLOAD INVOICE' },
    { key: 'print_invoice', label: 'PRINT INVOICE' },
    { key: 'edit_payment', label: 'EDIT PAYMENT' },
    { key: 'delete_payment', label: 'DELETE PAYMENT' },
    { key: 'export_excel', label: 'EXPORT EXCEL' },
  ],
}

/* ─── Helper: বাধাহীন দৃষ্টিতে access badge ──────────────────────────────── */
function AccessBadge({ access }) {
  const map = {
    full:  { label: 'Full', cls: 'bg-blue-100 text-blue-700' },
    write: { label: 'Write', cls: 'bg-yellow-100 text-yellow-700' },
    read:  { label: 'Read', cls: 'bg-gray-100 text-gray-600' },
  }
  const b = map[access] || map.read
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${b.cls}`}>{b.label}</span>
}

/* ─── Status Badge ────────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  if (status === true || status === 'active' || status === 'Active') {
    return <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">Active</span>
  }
  if (status === false || status === 'inactive' || status === 'InActive') {
    return <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">InActive</span>
  }
  return <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">Not Assigned</span>
}

/* ─── Eye icon (password toggle) ─────────────────────────────────────────── */
function EyeIcon({ open }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
    </svg>
  )
}

/* ─── Pencil icon ─────────────────────────────────────────────────────────── */
function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  )
}

/* ─── Trash icon ──────────────────────────────────────────────────────────── */
function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

/* ─── Confirm Delete Modal ────────────────────────────────────────────────── */
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-gray-800 font-medium mb-5">{message}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={onCancel} className="px-5 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">Delete</button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
   TAB 1 — Application Users
══════════════════════════════════════════════════════════════════════════════ */

/* ─── 3-Step Wizard Modal: Create / Edit User ─────────────────────────────── */
function UserWizardModal({ open, onClose, onSaved, roles, employees, editData }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    username: '', password: '', confirm_password: '',
    is_active: 'active', employee: '', role: '', account_role: 'collector',
  })
  const [saving, setSaving] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const isEdit = !!editData?.id

  useEffect(() => {
    if (!open) return
    setStep(1)
    if (editData) {
      setForm({
        username: editData.username || '',
        // edit-এ আসল password দেখাই (backend password_display = decrypt করা enc_password)
        password: editData.password_display || '',
        confirm_password: editData.password_display || '',
        is_active: editData.is_active ? 'active' : 'inactive',
        employee: editData.employee?.id || editData.employee || '',
        role: editData.role_group_id || '',                 // RoleGroup (permissions)
        account_role: editData.role || 'collector',          // Django role (mobile scope)
      })
    } else {
      setForm({ username: '', password: '', confirm_password: '', is_active: 'active', employee: '', role: '', account_role: 'collector' })
    }
  }, [open, editData])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const validateStep = () => {
    if (step === 1) {
      if (!form.username.trim()) { toast.error('Username আবশ্যক।'); return false }
      if (!isEdit && !form.password) { toast.error('Password আবশ্যক।'); return false }
      if (!isEdit && form.password !== form.confirm_password) { toast.error('Password মিলছে না।'); return false }
    }
    if (step === 3) {
      if (!form.role) { toast.error('Role সিলেক্ট করুন।'); return false }
    }
    return true
  }

  const handleNext = () => { if (validateStep()) setStep(s => s + 1) }
  const handlePrev = () => setStep(s => s - 1)

  const handleSave = async () => {
    if (!validateStep()) return
    setSaving(true)
    try {
      const payload = {
        username: form.username,
        is_active: form.is_active === 'active',
        employee: form.employee || null,
        role_group_id: form.role || null,    // RoleGroup (permissions)
        account_role: form.account_role,     // Django role → mobile permission scope
      }
      if (form.password) payload.password = form.password
      if (isEdit) {
        await api.patch(`/role-permissions/app-users/${editData.id}/`, payload)
        toast.success('User আপডেট হয়েছে।')
      } else {
        await api.post('/role-permissions/app-users/', payload)
        toast.success('User তৈরি হয়েছে।')
      }
      onSaved(); onClose()
    } catch (err) {
      const d = err?.response?.data
      toast.error(d ? JSON.stringify(d).slice(0, 150) : 'Save ব্যর্থ।')
    } finally { setSaving(false) }
  }

  if (!open) return null

  const stepLabels = ['User Info', 'Employee Assign', 'User Role']
  const stepIcons = [
    // person icon
    <svg key="s1" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
    // briefcase icon
    <svg key="s2" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
    // grid icon
    <svg key="s3" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>,
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className={`flex items-center justify-between px-6 py-4 ${HDR_BG}`}>
          <h3 className="text-base font-bold text-white">{isEdit ? 'Edit User' : 'Create New User'}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        {/* Step Indicators */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center justify-between relative">
            {/* connecting line */}
            <div className="absolute top-5 left-5 right-5 h-0.5 bg-gray-200 z-0" />
            <div
              className="absolute top-5 left-5 h-0.5 bg-[#1d435d] z-0 transition-all duration-300"
              style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }}
            />
            {[1, 2, 3].map(s => (
              <div key={s} className="flex flex-col items-center z-10 relative">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-200
                  ${s < step ? 'bg-[#1d435d] border-[#1d435d] text-white' :
                    s === step ? 'bg-[#1d435d] border-[#1d435d] text-white' :
                    'bg-white border-gray-300 text-gray-400'}`}>
                  {stepIcons[s - 1]}
                </div>
                <span className={`mt-1 text-[10px] font-semibold ${s <= step ? 'text-[#1d435d]' : 'text-gray-400'}`}>
                  Step {s}/3
                </span>
                <span className={`text-[10px] ${s <= step ? 'text-gray-700' : 'text-gray-400'}`}>
                  {stepLabels[s - 1]}
                </span>
              </div>
            ))}
          </div>
          {/* progress bar */}
          <div className="mt-3 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#1d435d] rounded-full transition-all duration-300"
              style={{ width: `${((step - 1) / 2) * 100}%` }}
            />
          </div>
        </div>

        {/* Step Content */}
        <div className="px-6 py-4 space-y-4 min-h-[220px]">
          {step === 1 && (
            <>
              <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">User Information</h4>
              <div>
                <label className={LBL}>USER NAME <span className="text-red-500">*</span></label>
                {/* autoComplete off — browser যেন আগের admin/password autofill না করে (clean form) */}
                <input className={INP} value={form.username} onChange={e => set('username', e.target.value)}
                  placeholder="Enter username" autoComplete="off" name="ru-username" />
              </div>
              <div>
                <label className={LBL}>PASSWORD {isEdit && <span className="text-gray-400 font-normal normal-case">(edit করতে নতুন লিখুন)</span>} <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} className={`${INP} pr-10`}
                    value={form.password} onChange={e => set('password', e.target.value)}
                    placeholder="Enter password" autoComplete="new-password" name="ru-password" />
                  <button type="button" onClick={() => setShowPwd(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                    <EyeIcon open={showPwd} />
                  </button>
                </div>
              </div>
              <div>
                <label className={LBL}>CONFIRM PASSWORD {!isEdit && <span className="text-red-500">*</span>}</label>
                <input type={showPwd ? 'text' : 'password'} className={INP}
                  value={form.confirm_password} onChange={e => set('confirm_password', e.target.value)}
                  placeholder="Re-enter password" autoComplete="new-password" name="ru-confirm" />
              </div>
              <div>
                <label className={LBL}>ACTIVITY STATUS <span className="text-red-500">*</span></label>
                <select className={SEL} value={form.is_active} onChange={e => set('is_active', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">InActive</option>
                </select>
              </div>
              <div>
                <label className={LBL}>ACCOUNT TYPE (মোবাইল অ্যাপ access) <span className="text-red-500">*</span></label>
                <select className={SEL} value={form.account_role} onChange={e => set('account_role', e.target.value)}>
                  <option value="collector">Bill Collector — শুধু নিজের কালেকশন</option>
                  <option value="support">Support — সাপোর্ট/কল</option>
                  <option value="accountant">Accountant — পেমেন্ট অনুমোদন, বিল</option>
                  <option value="manager">Manager — পূর্ণ অ্যাডমিন-লেভেল</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  মোবাইল অ্যাপে কী কী দেখবে তা নির্ধারণ করে (dashboard scope, payment approval, POP/বিল)।
                  বিস্তারিত module permission Step 3-এর Role(Group) থেকে।
                </p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">Employee Selection (Designation অনুযায়ী)</h4>
              <div>
                <label className={LBL}>SELECT EMPLOYEE</label>
                <select className={SEL} value={form.employee} onChange={e => set('employee', e.target.value)}>
                  <option value="">-- Not Assigned --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}{emp.designation ? ` — ${emp.designation}` : ''}{emp.employee_id ? ` (${emp.employee_id})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {/* নির্বাচিত employee-র designation/department দেখাই */}
              {form.employee && (() => {
                const emp = employees.find(e => String(e.id) === String(form.employee))
                if (!emp) return null
                return (
                  <div className="mt-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-800">
                    <div><span className="font-semibold">Designation:</span> {emp.designation || '—'}</div>
                    <div><span className="font-semibold">Department:</span> {emp.department_name_display || emp.department_name || '—'}</div>
                  </div>
                )
              })()}
              <p className="text-xs text-gray-500 mt-2">Employee সংযুক্ত করলে সেই employee-র HR data (designation, attendance, payslip) এই user ও মোবাইল অ্যাপের সাথে লিঙ্ক হবে।</p>
            </>
          )}

          {step === 3 && (
            <>
              <h4 className="text-sm font-semibold text-gray-700 border-b pb-2">User Role(Group) Assign</h4>
              <div>
                <label className={LBL}>SELECT A ROLE <span className="text-red-500">*</span></label>
                <select className={SEL} value={form.role} onChange={e => set('role', e.target.value)}>
                  <option value="">-- Select Role --</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-gray-500 mt-2">Role নির্ধারণ করলে সেই role-এর সকল permissions এই user-কে দেওয়া হবে।</p>
            </>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="flex justify-between items-center px-6 py-4 border-t bg-gray-50">
          {step > 1 ? (
            <button onClick={handlePrev} className="px-5 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-300">Previous</button>
          ) : (
            <div />
          )}
          {step < 3 ? (
            <button onClick={handleNext} className={`px-5 py-2 rounded-lg ${HDR_BG} text-white text-sm font-semibold hover:opacity-90`}>Next</button>
          ) : (
            <button onClick={handleSave} disabled={saving} className={`px-5 py-2 rounded-lg ${HDR_BG} text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60`}>
              {saving ? 'Saving…' : 'Save & Exit'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Tab 1: Application Users Table ─────────────────────────────────────── */
function ApplicationUsersTab({ roles, employees }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(10)
  // password সবসময় visible — toggle নেই
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/role-permissions/app-users/', { params: { page_size: 500 } })
      const data = Array.isArray(res.data) ? res.data : (res.data?.results || [])
      setUsers(data)
    } catch { toast.error('Users লোড ব্যর্থ।') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const filtered = users.filter(u => {
    if (filterStatus === 'active' && !u.is_active) return false
    if (filterStatus === 'inactive' && u.is_active) return false
    const empId = u.employee?.id || u.employee
    if (filterEmployee && String(empId) !== String(filterEmployee)) return false
    const roleId = u.role?.id || u.role
    if (filterRole && String(roleId) !== String(filterRole)) return false
    if (search) {
      const q = search.toLowerCase()
      const name = (u.username || '').toLowerCase()
      if (!name.includes(q)) return false
    }
    return true
  }).slice(0, pageSize)

  const openCreate = () => { setEditData(null); setModalOpen(true) }
  const openEdit = (u) => { setEditData(u); setModalOpen(true) }

  const handleDelete = async () => {
    if (!confirmDel) return
    try {
      await api.delete(`/role-permissions/app-users/${confirmDel.id}/`)
      toast.success('User ডিলিট হয়েছে।')
      fetchUsers()
    } catch { toast.error('Delete ব্যর্থ।') }
    finally { setConfirmDel(null) }
  }

  const getAssignedModules = (u) => {
    if (u.assigned_modules && Array.isArray(u.assigned_modules)) return u.assigned_modules.join(', ')
    if (u.role?.modules) return Object.keys(u.role.modules).join(', ')
    return '—'
  }

  const getRoleName = (u) => {
    // backend role_group_name সরাসরি দেয় (RoleGroup); fallback id দিয়ে roles list।
    if (u.role_group_name) return u.role_group_name
    if (u.role_group_id) {
      const found = roles.find(r => String(r.id) === String(u.role_group_id))
      return found?.name || '—'
    }
    return '—'
  }

  const getEmpName = (u) => {
    if (u.employee?.full_name) return u.employee.full_name
    if (u.employee) {
      const found = employees.find(e => String(e.id) === String(u.employee))
      return found?.full_name || '—'
    }
    return null
  }

  return (
    <div>
      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-3 mb-4 p-4 bg-gray-50 rounded-lg border">
        <div className="flex-1 min-w-[140px]">
          <label className={LBL}>USER STATUS</label>
          <select className={SEL} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">InActive</option>
          </select>
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className={LBL}>EMPLOYEE</label>
          <select className={SEL} value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>
            <option value="">All Employees</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className={LBL}>USER ROLE</label>
          <select className={SEL} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
            <option value="">All Roles</option>
            {roles.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-end gap-2">
          <div>
            <label className={LBL}>SHOW</label>
            <select className={`${SEL} w-20`} value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>SEARCH</label>
            <input className={`${INP} w-44`} placeholder="Search user…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Action Button */}
      <div className="flex justify-end mb-3">
        <button onClick={openCreate}
          className={`flex items-center gap-1.5 px-4 py-2 ${HDR_BG} text-white rounded-lg text-sm font-semibold hover:opacity-90 transition`}>
          <span className="text-base leading-none">+</span> New User
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className={`${HDR_BG} text-white`}>
              {['Sr.No', 'User Name', 'Password', 'Status', 'Employee', 'Role/Group', 'Assigned Module', 'Action'].map(h => (
                <th key={h} className="px-3 py-3 text-left font-semibold text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">কোনো User পাওয়া যায়নি।</td></tr>
            ) : filtered.map((u, i) => {
              const empName = getEmpName(u)
              const roleName = getRoleName(u)
              const modules = getAssignedModules(u)
              const truncModules = modules.length > 40 ? modules.slice(0, 40) + '…' : modules
              return (
                <tr key={u.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50/30 transition`}>
                  <td className="px-3 py-3 text-gray-500 font-medium">{i + 1}</td>
                  <td className="px-3 py-3 font-semibold text-gray-800">{u.username}</td>
                  <td className="px-3 py-3">
                    <span className="font-mono text-gray-700 text-xs select-all">
                      {u.password_display || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3"><StatusBadge status={u.is_active} /></td>
                  <td className="px-3 py-3 text-gray-600">
                    {empName
                      ? <span>{empName}{u.employee?.designation ? <span className="block text-xs text-gray-400">{u.employee.designation}</span> : null}</span>
                      : <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">Not Assigned</span>
                    }
                  </td>
                  <td className="px-3 py-3 text-gray-600">{roleName}</td>
                  <td className="px-3 py-3 text-gray-500 text-xs max-w-[200px]" title={modules}>{truncModules}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openEdit(u)}
                        className="p-1.5 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition" title="Edit">
                        <PencilIcon />
                      </button>
                      <button onClick={() => setConfirmDel(u)}
                        className="p-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition" title="Delete">
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <UserWizardModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchUsers}
        roles={roles}
        employees={employees}
        editData={editData}
      />
      {confirmDel && (
        <ConfirmModal
          message={`"${confirmDel.username}" user-টি ডিলিট করবেন?`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
   TAB 2 — User Roles (Groups)
══════════════════════════════════════════════════════════════════════════════ */

function RoleModal({ open, onClose, onSaved, editData }) {
  const [form, setForm] = useState({ name: '', status: 'active', redirect_url: '' })
  const [saving, setSaving] = useState(false)
  const isEdit = !!editData?.id

  useEffect(() => {
    if (!open) return
    if (editData) {
      setForm({
        name: editData.name || '',
        status: editData.status || 'active',
        redirect_url: editData.redirect_url || '',
      })
    } else {
      setForm({ name: '', status: 'active', redirect_url: '' })
    }
  }, [open, editData])

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Role Name আবশ্যক।'); return }
    setSaving(true)
    try {
      if (isEdit) {
        await api.patch(`/role-permissions/roles/${editData.id}/`, form)
        toast.success('Role আপডেট হয়েছে।')
      } else {
        await api.post('/role-permissions/roles/', form)
        toast.success('Role তৈরি হয়েছে।')
      }
      onSaved(); onClose()
    } catch (err) {
      const d = err?.response?.data
      toast.error(d ? JSON.stringify(d).slice(0, 150) : 'Save ব্যর্থ।')
    } finally { setSaving(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className={`flex items-center justify-between px-5 py-4 ${HDR_BG}`}>
          <h3 className="text-base font-bold text-white text-center w-full">{isEdit ? 'Edit Role(Group)' : 'Create New Role(Group)'}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none absolute right-5">&times;</button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div>
            <label className={LBL}>ROLE NAME <span className="text-red-500">*</span></label>
            <input className={INP} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Enter role name" required />
          </div>
          <div>
            <label className={LBL}>ROLE STATUS</label>
            <select className={SEL} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">InActive</option>
            </select>
          </div>
          <div>
            <label className={LBL}>REDERICT URL</label>
            <input className={INP} value={form.redirect_url} onChange={e => setForm(p => ({ ...p, redirect_url: e.target.value }))} placeholder="e.g. /dashboard" />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className={`px-5 py-2 text-sm font-semibold ${HDR_BG} text-white rounded-lg hover:opacity-90 disabled:opacity-60`}>
              {saving ? 'Saving…' : 'Save & Exit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Tab 2: User Roles(Groups) Table ────────────────────────────────────── */
function UserRolesTab({ roles, onRolesChange }) {
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetchRoles = async () => {
    setLoading(true)
    try {
      const res = await api.get('/role-permissions/roles/', { params: { page_size: 500 } })
      const data = Array.isArray(res.data) ? res.data : (res.data?.results || [])
      onRolesChange(data)
    } catch { toast.error('Roles লোড ব্যর্থ।') }
    finally { setLoading(false) }
  }

  const handleDelete = async () => {
    if (!confirmDel) return
    try {
      await api.delete(`/role-permissions/roles/${confirmDel.id}/`)
      toast.success('Role ডিলিট হয়েছে।')
      fetchRoles()
    } catch { toast.error('Delete ব্যর্থ।') }
    finally { setConfirmDel(null) }
  }

  const filtered = roles
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, pageSize)

  const isDefault = (r) => r.is_default || r.is_system || r.name?.toLowerCase().includes('super')

  const fmtDate = (d) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('en-GB') } catch { return d }
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-end gap-2">
          <div>
            <label className={LBL}>SHOW</label>
            <select className={`${SEL} w-20`} value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>SEARCH</label>
            <input className={`${INP} w-44`} placeholder="Search role…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <button onClick={() => { setEditData(null); setModalOpen(true) }}
          className={`flex items-center gap-1.5 px-4 py-2 ${HDR_BG} text-white rounded-lg text-sm font-semibold hover:opacity-90 transition`}>
          <span className="text-base leading-none">+</span> New Role(Group)
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className={`${HDR_BG} text-white`}>
              {['Sr.No', 'Name', 'Status', 'RederictURL', 'CreatedBy', 'CreatedOn', 'Action'].map(h => (
                <th key={h} className="px-3 py-3 text-left font-semibold text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">কোনো Role পাওয়া যায়নি।</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50/30 transition`}>
                <td className="px-3 py-3 text-gray-500">{i + 1}</td>
                <td className="px-3 py-3 font-semibold text-gray-800">{r.name}</td>
                <td className="px-3 py-3"><StatusBadge status={r.status || 'active'} /></td>
                <td className="px-3 py-3 text-gray-500 text-xs">{r.redirect_url || '—'}</td>
                <td className="px-3 py-3 text-gray-500">{r.created_by_name || r.created_by || 'System'}</td>
                <td className="px-3 py-3 text-gray-500 text-xs">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-3">
                  {isDefault(r) ? (
                    <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-100 text-teal-700 border border-teal-200 whitespace-nowrap">
                      Default(Can't Edit/Delete)
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => { setEditData(r); setModalOpen(true) }}
                        className="p-1.5 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition" title="Edit">
                        <PencilIcon />
                      </button>
                      <button onClick={() => setConfirmDel(r)}
                        className="p-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition" title="Delete">
                        <TrashIcon />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RoleModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={fetchRoles} editData={editData} />
      {confirmDel && (
        <ConfirmModal
          message={`"${confirmDel.name}" role-টি ডিলিট করবেন?`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
   TAB 3 — Role Modules (Permissions)
══════════════════════════════════════════════════════════════════════════════ */

/* ─── Granular Permissions Sub-Modal ──────────────────────────────────────── */
function GranularModal({ open, contextKey, label, granularDefs, granularState, onClose, onSave }) {
  const [local, setLocal] = useState({})

  useEffect(() => {
    if (open) setLocal(granularState[contextKey] || {})
  }, [open, contextKey, granularState])

  const perms = granularDefs[contextKey] || []
  const toggle = (key) => setLocal(p => ({ ...p, [key]: !p[key] }))

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className={`flex items-center justify-between px-5 py-4 ${HDR_BG}`}>
          <h3 className="text-sm font-bold text-white">All Permissions of {label}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {perms.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">No permissions defined.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {perms.map(p => (
                <label key={p.key} className="flex items-center gap-2 cursor-pointer p-2 rounded border border-gray-200 hover:bg-gray-50">
                  <input type="checkbox" checked={!!local[p.key]} onChange={() => toggle(p.key)} className="accent-[#1d435d]" />
                  <span className="text-xs font-medium text-gray-700">{p.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-red-50">Close</button>
          <button onClick={() => { onSave(contextKey, local); onClose() }}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">Save</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Permission Assignment Modal ────────────────────────────────────────── */
function PermissionModal({ open, onClose, onSaved, roles, modules, granularDefs, editData }) {
  const [selectedRole, setSelectedRole] = useState('')
  const [permState, setPermState] = useState({})
  const [granularState, setGranularState] = useState({})
  const [saving, setSaving] = useState(false)
  const [loadingPerms, setLoadingPerms] = useState(false)
  const [granularModal, setGranularModal] = useState({ open: false, contextKey: '', label: '' })
  const isEdit = !!editData?.id

  // modal খুলার সময় initial state set
  useEffect(() => {
    if (!open) return
    if (editData) {
      setSelectedRole(editData.role?.id || editData.role || '')
      // existing permissions load
      loadExistingPerms(editData.role?.id || editData.role)
    } else {
      setSelectedRole('')
      resetState()
    }
  }, [open, editData])

  const resetState = () => {
    const ps = {}
    modules.forEach(mod => {
      ps[mod.key] = { enabled: false, access: 'full', subModules: {} }
      mod.sub_modules?.forEach(sub => {
        ps[mod.key].subModules[sub.key] = { enabled: false, access: 'full' }
      })
    })
    setPermState(ps)
    setGranularState({})
  }

  const loadExistingPerms = async (roleId) => {
    if (!roleId) { resetState(); return }
    setLoadingPerms(true)
    try {
      const res = await api.get(`/role-permissions/roles/${roleId}/permissions/`)
      const data = res.data
      // backend flat shape parse: module_permissions=[{module_key, sub_module_key, access_level}]
      const mods = data.module_permissions || []
      const ps = {}
      modules.forEach(mod => {
        const parent = mods.find(m => m.module_key === mod.key && !m.sub_module_key)
        const subRows = mods.filter(m => m.module_key === mod.key && m.sub_module_key)
        ps[mod.key] = {
          enabled: !!parent || subRows.length > 0,
          access: parent?.access_level || 'full',
          subModules: {},
        }
        mod.sub_modules?.forEach(sub => {
          const sr = subRows.find(s => s.sub_module_key === sub.key)
          ps[mod.key].subModules[sub.key] = {
            enabled: !!sr,
            access: sr?.access_level || 'full',
          }
        })
      })
      setPermState(ps)
      // granular flat: [{context_key, permission_key, is_enabled}] → {context: {perm: true}}
      const gs = {}
      data.granular_permissions?.forEach(g => {
        if (!gs[g.context_key]) gs[g.context_key] = {}
        gs[g.context_key][g.permission_key] = g.is_enabled !== false
      })
      setGranularState(gs)
    } catch {
      resetState()
    } finally { setLoadingPerms(false) }
  }

  // role change হলে permissions reload
  const handleRoleChange = async (roleId) => {
    setSelectedRole(roleId)
    if (roleId) await loadExistingPerms(roleId)
    else resetState()
  }

  // parent module toggle
  const toggleModule = (modKey) => {
    setPermState(prev => {
      const mod = modules.find(m => m.key === modKey)
      const cur = prev[modKey] || { enabled: false, access: 'full', subModules: {} }
      const newEnabled = !cur.enabled
      const newSubs = {}
      mod?.sub_modules?.forEach(sub => {
        newSubs[sub.key] = { enabled: newEnabled, access: cur.subModules?.[sub.key]?.access || 'full' }
      })
      return { ...prev, [modKey]: { ...cur, enabled: newEnabled, subModules: newSubs } }
    })
  }

  // sub-module toggle
  const toggleSubModule = (modKey, subKey) => {
    setPermState(prev => {
      const cur = prev[modKey] || { enabled: false, access: 'full', subModules: {} }
      const curSub = cur.subModules?.[subKey] || { enabled: false, access: 'full' }
      return {
        ...prev,
        [modKey]: {
          ...cur,
          subModules: {
            ...cur.subModules,
            [subKey]: { ...curSub, enabled: !curSub.enabled },
          },
        },
      }
    })
  }

  // sub-module access change
  const setSubAccess = (modKey, subKey, access) => {
    setPermState(prev => {
      const cur = prev[modKey] || { enabled: false, access: 'full', subModules: {} }
      return {
        ...prev,
        [modKey]: {
          ...cur,
          subModules: {
            ...cur.subModules,
            [subKey]: { ...(cur.subModules?.[subKey] || {}), access },
          },
        },
      }
    })
  }

  const handleSaveGranular = (contextKey, newPerms) => {
    setGranularState(prev => ({ ...prev, [contextKey]: newPerms }))
  }

  const handleSave = async () => {
    if (!selectedRole) { toast.error('Role সিলেক্ট করুন।'); return }
    setSaving(true)
    try {
      // module_permissions — backend flat shape: {module_key, sub_module_key, access_level, is_enabled}
      // parent module = sub_module_key '' ; প্রতিটি enabled sub-module আলাদা row।
      const modulePerm = []
      modules.forEach(mod => {
        const mp = permState[mod.key]
        if (!mp?.enabled) return
        modulePerm.push({ module_key: mod.key, sub_module_key: '', access_level: mp.access || 'full', is_enabled: true })
        mod.sub_modules?.forEach(sub => {
          const sp = mp.subModules?.[sub.key]
          if (sp?.enabled) {
            modulePerm.push({ module_key: mod.key, sub_module_key: sub.key, access_level: sp.access || 'full', is_enabled: true })
          }
        })
      })
      // granular_permissions — backend flat shape: {context_key, permission_key, is_enabled}
      const granularPerm = []
      Object.entries(granularState).forEach(([context, perms]) => {
        Object.entries(perms || {}).forEach(([pk, val]) => {
          if (val) granularPerm.push({ context_key: context, permission_key: pk, is_enabled: true })
        })
      })

      await api.post('/role-permissions/roles/save-permissions/', {
        role_id: selectedRole,
        module_permissions: modulePerm,
        granular_permissions: granularPerm,
      })
      toast.success('Permissions সেভ হয়েছে।')
      onSaved(); onClose()
    } catch (err) {
      const d = err?.response?.data
      toast.error(d ? JSON.stringify(d).slice(0, 150) : 'Save ব্যর্থ।')
    } finally { setSaving(false) }
  }

  const handleReset = () => {
    resetState()
    toast('State reset হয়েছে।', { icon: '🔄' })
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className={`flex items-center justify-between px-6 py-4 ${HDR_BG} flex-shrink-0`}>
            <h3 className="text-sm font-bold text-white">{isEdit ? 'Edit Role Module(Permission)' : 'Create New Role Module(Permission)'}</h3>
            <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none">&times;</button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Role selector */}
            <div>
              <label className={LBL}>USER ROLE(GROUP) <span className="text-red-500">*</span></label>
              <select className={SEL} value={selectedRole} onChange={e => handleRoleChange(e.target.value)}>
                <option value="">-- Select Role --</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            {/* Module Permissions */}
            <div>
              <label className={`${LBL} mb-2`}>MODULE PERMISSIONS <span className="text-red-500">*</span></label>
              {loadingPerms ? (
                <div className="text-center py-6 text-gray-400 text-sm">Loading permissions…</div>
              ) : (
                <div className="space-y-2">
                  {modules.map(mod => {
                    const mp = permState[mod.key] || { enabled: false, access: 'full', subModules: {} }
                    return (
                      <div key={mod.key} className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* Module row */}
                        <div className={`flex items-center gap-3 px-4 py-2.5 ${mp.enabled ? 'bg-[#1d435d]/5 border-l-4 border-l-[#1d435d]' : 'bg-gray-50'}`}>
                          <input
                            type="checkbox"
                            checked={mp.enabled}
                            onChange={() => toggleModule(mod.key)}
                            className="accent-[#1d435d] w-4 h-4 cursor-pointer"
                          />
                          <span className="font-semibold text-sm text-gray-800 flex-1">{mod.label}</span>

                          {/* Granular link for parent-only modules */}
                          {mp.enabled && mod.granular_context && mod.sub_modules?.length === 0 && (
                            <button
                              onClick={() => setGranularModal({ open: true, contextKey: mod.granular_context, label: mod.granular_label || mod.label })}
                              className="text-xs text-[#1d435d] underline hover:text-[#1d435d]/80 font-medium">
                              Click to Assign {mod.granular_label || 'Card'} Permissions?
                            </button>
                          )}
                        </div>

                        {/* Sub-modules */}
                        {mp.enabled && mod.sub_modules?.length > 0 && (
                          <div className="px-4 pb-3 pt-2 space-y-2 bg-white">
                            {mod.sub_modules.map(sub => {
                              const sp = mp.subModules?.[sub.key] || { enabled: false, access: 'full' }
                              return (
                                <div key={sub.key} className="flex items-center gap-3 pl-6">
                                  <input
                                    type="checkbox"
                                    checked={sp.enabled}
                                    onChange={() => toggleSubModule(mod.key, sub.key)}
                                    className="accent-[#1d435d] w-3.5 h-3.5 cursor-pointer"
                                  />
                                  <span className="text-xs text-gray-700 flex-1 font-medium">{sub.label}</span>

                                  {sp.enabled && (
                                    <>
                                      {sub.access_type === 'fwr' && (
                                        <div className="flex items-center gap-2">
                                          {['full', 'write', 'read'].map(a => (
                                            <label key={a} className="flex items-center gap-1 cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`${mod.key}_${sub.key}_access`}
                                                value={a}
                                                checked={sp.access === a}
                                                onChange={() => setSubAccess(mod.key, sub.key, a)}
                                                className="accent-[#1d435d]"
                                              />
                                              <span className="text-[10px] font-medium text-gray-600 capitalize">{a}</span>
                                            </label>
                                          ))}
                                        </div>
                                      )}
                                      {sub.access_type === 'granular' && sub.granular_context && (
                                        <button
                                          onClick={() => setGranularModal({ open: true, contextKey: sub.granular_context, label: sub.label })}
                                          className="text-[11px] text-[#1d435d] underline hover:text-[#1d435d]/80 font-medium">
                                          Click to Assign Module Permissions?
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="flex justify-between items-center px-6 py-4 border-t bg-gray-50 flex-shrink-0">
            <button onClick={handleReset}
              className="px-4 py-2 rounded-lg border border-red-400 text-red-600 text-sm font-medium hover:bg-red-50">
              Reset / Clear
            </button>
            <div className="flex gap-3">
              <button onClick={onClose}
                className="px-4 py-2 rounded-lg border border-gray-400 text-gray-700 text-sm font-medium hover:bg-gray-100">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className={`px-5 py-2 rounded-lg ${HDR_BG} text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60`}>
                {saving ? 'Saving…' : 'Save & Exit'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Granular Sub-Modal */}
      <GranularModal
        open={granularModal.open}
        contextKey={granularModal.contextKey}
        label={granularModal.label}
        granularDefs={granularDefs}
        granularState={granularState}
        onClose={() => setGranularModal({ open: false, contextKey: '', label: '' })}
        onSave={handleSaveGranular}
      />
    </>
  )
}

/* ─── View Permissions Modal — role-এর সব permission একসাথে ───────────────── */
function ViewPermissionsModal({ open, data, modules, granularDefs, onClose }) {
  if (!open || !data) return null
  const mp = data.module_permissions || []
  const parents = mp.filter(m => !m.sub_module_key)
  const subsByMod = {}
  mp.filter(m => m.sub_module_key).forEach(m => {
    (subsByMod[m.module_key] = subsByMod[m.module_key] || []).push(m)
  })
  const modLabel = k => modules.find(x => x.key === k)?.label || k
  const subLabel = (mk, sk) => modules.find(x => x.key === mk)?.sub_modules?.find(s => s.key === sk)?.label || sk
  const granLabel = (ctx, pk) => (granularDefs[ctx] || []).find(p => p.key === pk)?.label || pk
  const gran = (data.granular_permissions || []).filter(g => g.is_enabled !== false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className={`flex items-center justify-between px-6 py-4 ${HDR_BG}`}>
          <h3 className="text-sm font-bold text-white">{data.role?.name} — সব Permission</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          {/* Modules + sub-modules */}
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Modules ({parents.length})</h4>
            {parents.length === 0 ? <p className="text-xs text-gray-400">কোনো module assign করা নেই।</p> : parents.map(pm => (
              <div key={pm.module_key} className="mb-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">{modLabel(pm.module_key)}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 uppercase">{pm.access_level}</span>
                </div>
                {(subsByMod[pm.module_key] || []).length > 0 && (
                  <div className="mt-1.5 pl-3 border-l-2 border-blue-100 space-y-1">
                    {subsByMod[pm.module_key].map(s => (
                      <div key={s.sub_module_key} className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">• {subLabel(pm.module_key, s.sub_module_key)}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 uppercase">{s.access_level}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Granular permissions */}
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Granular Permissions ({gran.length})</h4>
            {gran.length === 0 ? <p className="text-xs text-gray-400">কোনো granular permission নেই।</p> : (
              <div className="flex flex-wrap gap-1.5">
                {gran.map((g, i) => (
                  <span key={i} className="text-[11px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {granLabel(g.context_key, g.permission_key)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-300">Close</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Tab 3: Role Modules(Permissions) Table ─────────────────────────────── */
function RoleModulesTab({ roles, modules, granularDefs }) {
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [viewPerm, setViewPerm] = useState(null)   // PERMISSIONS column modal

  const fetchPermissions = useCallback(async () => {
    setLoading(true)
    try {
      // সব role-এর permissions একসাথে load করা
      const results = []
      for (const role of roles) {
        try {
          const res = await api.get(`/role-permissions/roles/${role.id}/permissions/`)
          if (res.data && (res.data.module_permissions?.length > 0 || res.data.granular_permissions?.length > 0)) {
            results.push({ id: role.id, role, ...res.data })
          }
        } catch { /* skip roles without permissions */ }
      }
      setPermissions(results)
    } catch { toast.error('Permissions লোড ব্যর্থ।') }
    finally { setLoading(false) }
  }, [roles])

  useEffect(() => {
    if (roles.length > 0) fetchPermissions()
  }, [fetchPermissions, roles])

  const filtered = permissions
    .filter(p => !search || p.role?.name?.toLowerCase().includes(search.toLowerCase()))
    .slice(0, pageSize)

  const getModuleNames = (p) => {
    // flat shape: parent module = sub_module_key '' ; unique module_key অনুযায়ী নাম
    const keys = [...new Set((p.module_permissions || [])
      .filter(m => !m.sub_module_key).map(m => m.module_key))]
    const names = keys.map(k => {
      const mod = modules.find(x => x.key === k)
      return mod?.label || k
    })
    const str = names.join(', ')
    return str.length > 50 ? str.slice(0, 50) + '…' : (str || '—')
  }

  const getPermNames = (p) => {
    // flat shape: [{context_key, permission_key, is_enabled}]
    const all = (p.granular_permissions || [])
      .filter(g => g.is_enabled !== false)
      .map(g => g.permission_key)
    const str = all.join(', ')
    return str.length > 50 ? str.slice(0, 50) + '…' : (str || '—')
  }

  const fmtDate = (d) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('en-GB') } catch { return d }
  }

  const handleDelete = async () => {
    if (!confirmDel) return
    try {
      // permissions clear করা
      await api.post('/role-permissions/roles/save-permissions/', {
        role_id: confirmDel.id,
        module_permissions: [],
        granular_permissions: [],
      })
      toast.success('Permissions ডিলিট হয়েছে।')
      fetchPermissions()
    } catch { toast.error('Delete ব্যর্থ।') }
    finally { setConfirmDel(null) }
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-end gap-2">
          <div>
            <label className={LBL}>SHOW</label>
            <select className={`${SEL} w-20`} value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>SEARCH</label>
            <input className={`${INP} w-44`} placeholder="Search role…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <button onClick={() => { setEditData(null); setModalOpen(true) }}
          className={`flex items-center gap-1.5 px-4 py-2 ${HDR_BG} text-white rounded-lg text-sm font-semibold hover:opacity-90 transition`}>
          <span className="text-base leading-none">+</span> New Role Module(Permission)
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className={`${HDR_BG} text-white`}>
              {['Sr.No', 'Role', 'Status', 'Modules', 'Permissions', 'CreatedBy', 'CreatedOn', 'Action'].map(h => (
                <th key={h} className="px-3 py-3 text-left font-semibold text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">কোনো Permission entry পাওয়া যায়নি।</td></tr>
            ) : filtered.map((p, i) => (
              <tr key={p.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50/30 transition`}>
                <td className="px-3 py-3 text-gray-500">{i + 1}</td>
                <td className="px-3 py-3 font-semibold text-gray-800">{p.role?.name}</td>
                <td className="px-3 py-3"><StatusBadge status={p.role?.status || 'active'} /></td>
                <td className="px-3 py-3 text-gray-500 text-xs" title={p.module_permissions?.map(m => m.module_key).join(', ')}>{getModuleNames(p)}</td>
                <td className="px-3 py-3">
                  {(() => {
                    const total = (p.module_permissions?.length || 0) +
                      (p.granular_permissions?.filter(g => g.is_enabled !== false).length || 0)
                    return total > 0 ? (
                      <button onClick={() => setViewPerm(p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold hover:bg-blue-100 transition"
                        title="সব permission দেখুন">
                        👁 {total} টি permission
                      </button>
                    ) : <span className="text-gray-400 text-xs">—</span>
                  })()}
                </td>
                <td className="px-3 py-3 text-gray-500">{p.role?.created_by_name || 'System'}</td>
                <td className="px-3 py-3 text-gray-500 text-xs">{fmtDate(p.role?.created_at)}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { setEditData(p); setModalOpen(true) }}
                      className="p-1.5 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition" title="Edit">
                      <PencilIcon />
                    </button>
                    <button onClick={() => setConfirmDel(p)}
                      className="p-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition" title="Delete">
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PermissionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchPermissions}
        roles={roles}
        modules={modules}
        granularDefs={granularDefs}
        editData={editData}
      />
      <ViewPermissionsModal
        open={!!viewPerm}
        data={viewPerm}
        modules={modules}
        granularDefs={granularDefs}
        onClose={() => setViewPerm(null)}
      />
      {confirmDel && (
        <ConfirmModal
          message={`"${confirmDel.role?.name}" role-এর সব permissions ডিলিট করবেন?`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
export default function AppUsersPage() {
  const [activeTab, setActiveTab] = useState(0)
  const [roles, setRoles] = useState([])
  const [employees, setEmployees] = useState([])
  const [modules, setModules] = useState(STATIC_MODULES)
  const [granularDefs, setGranularDefs] = useState(STATIC_GRANULAR)
  const [initLoading, setInitLoading] = useState(true)

  // Initial data load: roles, employees, module definitions
  const loadInitialData = useCallback(async () => {
    setInitLoading(true)
    try {
      const [rolesRes, empRes] = await Promise.allSettled([
        api.get('/role-permissions/roles/', { params: { page_size: 500 } }),
        api.get('/hr/employees/', { params: { status: 'active', page_size: 500 } }),
      ])

      if (rolesRes.status === 'fulfilled') {
        const d = rolesRes.value.data
        setRoles(Array.isArray(d) ? d : (d?.results || []))
      }
      if (empRes.status === 'fulfilled') {
        const d = empRes.value.data
        setEmployees(Array.isArray(d) ? d : (d?.results || []))
      }

      // Module definitions load (optional endpoint)
      try {
        const modRes = await api.get('/role-permissions/roles/module-definitions/')
        if (modRes.data?.modules) setModules(modRes.data.modules)
        if (modRes.data?.granular_permissions) setGranularDefs(modRes.data.granular_permissions)
      } catch { /* static fallback ব্যবহার করা হবে */ }
    } catch { toast.error('Initial data লোড ব্যর্থ।') }
    finally { setInitLoading(false) }
  }, [])

  useEffect(() => { loadInitialData() }, [loadInitialData])

  const tabs = [
    { label: '☰ Application Users' },
    { label: '☰ User Roles(Groups)' },
    { label: '☰ Role Modules(Permissions)' },
  ]

  return (
    <div className="min-h-screen bg-[#e9e9e9] p-5">
      {/* Page Title & Breadcrumb */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-[#1d435d]">⊕</span> App Users
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">All Users of Application</p>
        </div>
        <div className="text-xs text-gray-500 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
          ⚙ System &gt; App Users
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Tab Header */}
        <div className="flex items-center gap-0 border-b border-gray-200 px-4 pt-4 overflow-x-auto">
          {tabs.map((tab, idx) => (
            <button
              key={idx}
              onClick={() => setActiveTab(idx)}
              className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg mr-1 border transition-all whitespace-nowrap
                ${activeTab === idx
                  ? `${HDR_BG} text-white border-[#1d435d]`
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-5">
          {initLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <svg className="animate-spin h-6 w-6 mr-2 text-[#1d435d]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading…
            </div>
          ) : (
            <>
              {activeTab === 0 && (
                <ApplicationUsersTab roles={roles} employees={employees} />
              )}
              {activeTab === 1 && (
                <UserRolesTab roles={roles} onRolesChange={setRoles} />
              )}
              {activeTab === 2 && (
                <RoleModulesTab roles={roles} modules={modules} granularDefs={granularDefs} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
