import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Hierarchical menu tree (স্ক্রিনশট অনুযায়ী) ── */
const MENU_TREE = [
  {
    key: 'configuration', label: 'CONFIGURATION',
    children: [
      { key: 'config_zone',        label: 'ZONE' },
      { key: 'config_package',     label: 'PACKAGE' },
      { key: 'config_district',    label: 'DISTRICT' },
      { key: 'config_upazila',     label: 'UPAZILA' },
      { key: 'config_department',  label: 'DEPARTMENT' },
      { key: 'config_designation', label: 'DESIGNATION' },
      { key: 'config_sub_zone',    label: 'SUB ZONE' },
      { key: 'config_box',         label: 'BOX' },
      { key: 'config_device',      label: 'DEVICE' },
    ],
  },
  { key: 'mikrotik_client', label: 'MIKROTIK CLIENT', children: [] },
  {
    key: 'employee', label: 'EMPLOYEE',
    children: [
      { key: 'emp_add',    label: 'ADD EMPLOYEE' },
      { key: 'emp_list',   label: 'EMPLOYEE LIST' },
      { key: 'emp_salary', label: 'SALARY' },
    ],
  },
  {
    key: 'client', label: 'CLIENT',
    children: [
      { key: 'client_add',            label: 'ADD CLIENT' },
      { key: 'client_list',           label: 'CLIENT LIST' },
      { key: 'client_left',           label: 'LEFT CLIENT' },
      { key: 'client_scheduler',      label: 'SCHEDULER' },
      { key: 'client_change_request', label: 'CHANGE REQUEST' },
      { key: 'client_portal',         label: 'PORTAL MANAGE' },
    ],
  },
  {
    key: 'billing', label: 'BILLING',
    children: [
      { key: 'billing_list',             label: 'BILLING LIST' },
      { key: 'billing_invoice',          label: 'INVOICE' },
      { key: 'billing_daily_collection', label: 'DAILY BILL COLLECTION' },
    ],
  },
  {
    key: 'monitoring', label: 'MONITORING',
    children: [
      { key: 'monitoring_client', label: 'CLIENT MONITORING' },
    ],
  },
  {
    key: 'client_support', label: 'CLIENT SUPPORT',
    children: [
      { key: 'support_problem_cat',       label: 'PROBLEM CATEGORY' },
      { key: 'support_daily_complain',    label: 'DAILY COMPLAIN LIST' },
      { key: 'support_monthly_complain',  label: 'MONTHLY COMPLAIN LIST' },
    ],
  },
  {
    key: 'sms_service', label: 'SMS SERVICE',
    children: [
      { key: 'sms_template',   label: 'SMS TEMPLATE' },
      { key: 'sms_individual', label: 'INDIVIDUAL SMS' },
      { key: 'sms_groups',     label: 'SMS GROUPS' },
      { key: 'sms_group_send', label: 'GROUP SMS' },
      { key: 'sms_gateway',    label: 'SMS GATEWAY' },
    ],
  },
  {
    key: 'report', label: 'REPORT',
    children: [
      { key: 'report_btrc',           label: 'BTRC REPORT' },
      { key: 'report_enable_disable', label: 'ENABLE/DISABLE HISTORY' },
      { key: 'report_bill_collection',label: 'BILL COLLECTION' },
      { key: 'report_messages',       label: 'MESSAGES REPORT' },
      { key: 'report_processing_fee', label: 'P.PROCESSING FEE' },
      { key: 'report_all',            label: 'ALL REPORT' },
    ],
  },
  {
    key: 'fund_history', label: 'FUND HISTORY',
    children: [
      { key: 'fund_debit',  label: 'DEBIT HISTORY' },
      { key: 'fund_credit', label: 'CREDIT HISTORY' },
    ],
  },
  { key: 'tutorials', label: 'TUTORIALS', children: [] },
];

/* সব key (parent + child) এর flat list */
const ALL_KEYS = MENU_TREE.flatMap(m => [m.key, ...m.children.map(c => c.key)]);

const EMPTY = {
  contact_person: '', email: '', mobile: '', phone: '',
  national_id: '', district: '', upazila: '', zone: '',
  pop_prefix: '', set_prefix_in_mikrotik: false,
  pop_type: 'prepaid', min_rechargeable_amount: '5',
  address: '', business_name: '', tariff: '',
  want_to_disable_clients: true, min_balance: '0',
  username: '', password: '', confirm_password: '',
  menus: [], fund_start: '0', level: '1',
};

/* ── Hierarchical checkbox component ── */
function MenuCheckbox({ checked, indeterminate, onChange, label, bold }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate || false;
  }, [indeterminate]);
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange}
        className="w-4 h-4 accent-blue-600 cursor-pointer" />
      <span className={`text-sm tracking-wide ${bold ? 'font-semibold text-gray-700' : 'text-gray-600 font-medium'}`}>
        {label}
      </span>
    </label>
  );
}

/* ── shared section header (Add New Client পেজের মতো gradient হেডার) ── */
function SecHdr({ icon, title, color = 'from-[#1d3a50] to-[#2d5473]' }) {
  return (
    <div className={`bg-gradient-to-r ${color} px-5 py-3.5 flex items-center gap-3`}>
      <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center text-base select-none shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-white leading-tight tracking-wide">{title}</p>
        <p className="text-[11px] text-white/50 mt-0.5">Fill Up All Required (*) Field Data</p>
      </div>
    </div>
  );
}

export default function POPAddPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [form, setForm]       = useState({ ...EMPTY });
  const [logo, setLogo]       = useState(null);
  const [districts, setDistricts] = useState([]);
  const [upazilas, setUpazilas]   = useState([]);
  const [zones, setZones]         = useState([]);
  const [tariffs, setTariffs]     = useState([]);
  const [nextCode, setNextCode]   = useState('0001');
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/config/districts/?page_size=500'),
      api.get('/config/zones/?page_size=500'),
      api.get('/pop/tariffs/?page_size=500'),
      !isEdit ? api.get('/pop/pops/next-code/') : Promise.resolve(null),
    ]).then(([d, z, t, c]) => {
      setDistricts(d.data.results || d.data);
      setZones(z.data.results || z.data);
      setTariffs(t.data.results || t.data);
      if (c) setNextCode(c.data.code);
    });

    if (isEdit) {
      api.get(`/pop/pops/${id}/`).then(r => {
        const p = r.data;
        setForm({
          ...EMPTY, ...p,
          district: p.district || '', upazila: p.upazila || '',
          zone: p.zone || '', tariff: p.tariff || '',
          password: '', confirm_password: '',
          menus: Array.isArray(p.menus) ? p.menus : [],
        });
        if (p.district) loadUpazilas(p.district);
      });
    }
  }, [id]);

  const loadUpazilas = distId => {
    if (!distId) { setUpazilas([]); return; }
    api.get(`/config/upazilas/?district=${distId}&page_size=500`)
      .then(r => setUpazilas(r.data.results || r.data));
  };

  const set = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    if (name === 'district') {
      setForm(f => ({ ...f, district: value, upazila: '' }));
      loadUpazilas(value);
    }
  };

  /* ── Menu toggle logic ── */
  const toggleMenu = key => {
    setForm(f => {
      const cur = new Set(f.menus);
      const node = MENU_TREE.find(m => m.key === key);

      if (node) {
        /* parent toggle → সব children সহ */
        if (cur.has(key)) {
          cur.delete(key);
          node.children.forEach(c => cur.delete(c.key));
        } else {
          cur.add(key);
          node.children.forEach(c => cur.add(c.key));
        }
      } else {
        /* child toggle */
        if (cur.has(key)) {
          cur.delete(key);
          /* সব child uncheck হলে parent-ও uncheck */
          const parent = MENU_TREE.find(m => m.children.some(c => c.key === key));
          if (parent) {
            const anyLeft = parent.children.some(c => c.key !== key && cur.has(c.key));
            if (!anyLeft) cur.delete(parent.key);
          }
        } else {
          cur.add(key);
          /* অন্তত একটি child checked হলে parent auto-check */
          const parent = MENU_TREE.find(m => m.children.some(c => c.key === key));
          if (parent) cur.add(parent.key);
        }
      }
      return { ...f, menus: [...cur] };
    });
  };

  const toggleAll = () => {
    setForm(f => ({
      ...f,
      menus: f.menus.length === ALL_KEYS.length ? [] : [...ALL_KEYS],
    }));
  };

  /* parent checkbox state helper */
  const parentState = node => {
    if (node.children.length === 0) {
      return { checked: form.menus.includes(node.key), indeterminate: false };
    }
    const total   = node.children.length;
    const checked = node.children.filter(c => form.menus.includes(c.key)).length;
    return {
      checked: checked === total,
      indeterminate: checked > 0 && checked < total,
    };
  };

  const save = async e => {
    e.preventDefault();
    if (!form.contact_person || !form.email || !form.mobile)
      return toast.error('Contact Person, Email, Mobile দিন');
    if (!form.business_name || !form.username)
      return toast.error('Business Name ও Username দিন');
    if (!isEdit && form.password !== form.confirm_password)
      return toast.error('পাসওয়ার্ড মিলছে না');

    setSaving(true);
    try {
      const data = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'confirm_password') return;
        if (k === 'menus') { data.append(k, JSON.stringify(v)); return; }
        if (v !== '' && v !== null && v !== undefined) data.append(k, v);
      });
      if (logo) data.append('logo', logo);

      if (isEdit)
        await api.patch(`/pop/pops/${id}/`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      else
        await api.post('/pop/pops/', data, { headers: { 'Content-Type': 'multipart/form-data' } });

      toast.success(isEdit ? 'POP আপডেট হয়েছে' : 'POP যোগ হয়েছে');
      navigate('/pop/list');
    } catch (err) {
      const msg = err.response?.data;
      toast.error(typeof msg === 'object' ? JSON.stringify(msg).slice(0, 120) : 'সংরক্ষণ ব্যর্থ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <span className="text-blue-600 cursor-pointer" onClick={() => navigate('/pop/list')}>POP</span>
            <span>&gt;</span>
            <span>{isEdit ? 'Edit POPs' : 'Add POPs'}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">{isEdit ? 'Edit POPs' : 'Add POPs'}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{isEdit ? 'Editing POP' : 'Adding POP'}</p>
        </div>
      </div>

      <form onSubmit={save} className="space-y-6">

        {/* ── Personal Information ── */}
        <div className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-md ring-1 ring-black/5">
          <SecHdr icon="👤" title="Personal Information" color="from-[#1d3a50] to-[#2d5473]" />
          <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <Field label="CONTACT PERSON NAME" required>
              <input name="contact_person" value={form.contact_person} onChange={set}
                className="ifield" placeholder="Person" />
            </Field>
            <Field label="EMAIL ADDRESS" required>
              <input name="email" type="email" value={form.email} onChange={set}
                className="ifield" placeholder="Person@demo.com" />
            </Field>
            <Field label="MOBILE NO." required>
              <input name="mobile" value={form.mobile} onChange={set}
                className="ifield" placeholder="01700000000" />
            </Field>
            <Field label="PHONE NO.">
              <input name="phone" value={form.phone} onChange={set}
                className="ifield" placeholder="" />
            </Field>
            <Field label="NATIONAL ID">
              <input name="national_id" value={form.national_id} onChange={set}
                className="ifield" placeholder="" />
            </Field>
            <Field label="DISTRICT" required>
              <select name="district" value={form.district} onChange={set} className="ifield">
                <option value="">Select</option>
                {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="UPAZILA" required>
              <select name="upazila" value={form.upazila} onChange={set} className="ifield">
                <option value="">Select</option>
                {upazilas.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="ZONE" required>
              <select name="zone" value={form.zone} onChange={set} className="ifield">
                <option value="">Select</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </Field>
            <Field label="POP CODE" required>
              <input value={isEdit ? (form.code || '') : nextCode} readOnly
                className="ifield bg-gray-50 text-gray-500 cursor-not-allowed" />
            </Field>
            <Field label="POP PREFIX" info="Username prefix for clients">
              <input name="pop_prefix" value={form.pop_prefix} onChange={set}
                className="ifield" placeholder="RAE" />
            </Field>
            <Field label="SET PREFIX IN MIKROTIK USERNAME?" info="Apply prefix in PPPoE username">
              <select name="set_prefix_in_mikrotik"
                value={form.set_prefix_in_mikrotik ? 'yes' : 'no'}
                onChange={e => setForm(f => ({ ...f, set_prefix_in_mikrotik: e.target.value === 'yes' }))}
                className="ifield">
                <option value="no">No, I Don't</option>
                <option value="yes">Yes, I Do</option>
              </select>
            </Field>
            <Field label="POP TYPE" required info="Prepaid or Postpaid">
              <select name="pop_type" value={form.pop_type} onChange={set} className="ifield">
                <option value="prepaid">Prepaid</option>
                <option value="postpaid">Postpaid</option>
              </select>
            </Field>
            <Field label="MINIMUM RECHARGEABLE AMOUNT" required info="Minimum top-up amount">
              <input name="min_rechargeable_amount" type="number" value={form.min_rechargeable_amount} onChange={set}
                className="ifield" />
            </Field>
            <div className="col-span-2">
              <Field label="ADDRESS" required>
                <textarea name="address" value={form.address} onChange={set} rows={2}
                  className="ifield resize-none" placeholder="Person" />
              </Field>
            </div>
            <Field label="POP LOGO">
              <input type="file" accept="image/*"
                onChange={e => setLogo(e.target.files[0])}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:text-xs file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100" />
            </Field>
          </div>
          </div>
        </div>

        {/* ── Business & Login ── */}
        <div className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-md ring-1 ring-black/5">
          <SecHdr icon="💼" title="Business & Login Information" color="from-[#1a4a3a] to-[#2d6b55]" />
          <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <div className="col-span-2">
              <Field label="POP / BUSINESS NAME" required>
                <input name="business_name" value={form.business_name} onChange={set}
                  className="ifield" placeholder="Person" />
              </Field>
            </div>
            <Field label="TARIFF NAME" required>
              <select name="tariff" value={form.tariff} onChange={set} className="ifield">
                <option value="">Select</option>
                {tariffs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="WANT TO DISABLED CLIENTS?" info="Auto-disable clients on low balance">
              <select name="want_to_disable_clients"
                value={form.want_to_disable_clients ? 'yes' : 'no'}
                onChange={e => setForm(f => ({ ...f, want_to_disable_clients: e.target.value === 'yes' }))}
                className="ifield">
                <option value="yes">Yes, I Want</option>
                <option value="no">No, I Don't</option>
              </select>
            </Field>
            <Field label="MINIMUM BALANCE">
              <input name="min_balance" type="number" value={form.min_balance} onChange={set}
                className="ifield bg-gray-50 text-gray-500 cursor-not-allowed" readOnly />
            </Field>
            <Field label="USER NAME" required>
              <input name="username" value={form.username} onChange={set}
                className="ifield" placeholder="Person" />
            </Field>
            <Field label="PASSWORD" required={!isEdit}>
              <input name="password" type="password" value={form.password} onChange={set}
                className="ifield" placeholder={isEdit ? '(পরিবর্তন না করলে ফাঁকা রাখুন)' : '••••••'} />
            </Field>
            <Field label="CONFIRM PASSWORD" required={!isEdit}>
              <input name="confirm_password" type="password" value={form.confirm_password} onChange={set}
                className="ifield" placeholder="••••••" />
            </Field>
          </div>
          </div>
        </div>

        {/* ── POP Menus (Hierarchical) ── */}
        <div className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-md ring-1 ring-black/5">
          <SecHdr icon="☰" title="POP Menus" color="from-[#3a2a1d] to-[#5a4530]" />
          <div className="p-4 sm:p-5">

          {/* SELECT ALL */}
          <div className="mb-4">
            <MenuCheckbox
              checked={form.menus.length === ALL_KEYS.length}
              indeterminate={form.menus.length > 0 && form.menus.length < ALL_KEYS.length}
              onChange={toggleAll}
              label="SELECT ALL MENUS"
              bold
            />
          </div>

          <div className="space-y-3">
            {MENU_TREE.map(node => {
              const { checked, indeterminate } = parentState(node);
              return (
                <div key={node.key}>
                  {/* Parent row */}
                  <MenuCheckbox
                    checked={checked}
                    indeterminate={indeterminate}
                    onChange={() => toggleMenu(node.key)}
                    label={node.label}
                    bold
                  />
                  {/* Children (indented) */}
                  {node.children.length > 0 && (
                    <div className="ml-7 mt-2 space-y-2 border-l-2 border-blue-100 pl-4">
                      {node.children.map(child => (
                        <MenuCheckbox
                          key={child.key}
                          checked={form.menus.includes(child.key)}
                          onChange={() => toggleMenu(child.key)}
                          label={child.label}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </div>
        </div>

        {/* Actions — মোবাইলে নিচে sticky bar (সবসময় হাতের নাগালে), ডেস্কটপে inline */}
        <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:z-auto sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
          <button type="button" onClick={() => navigate('/pop/list')}
            className="flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-600 transition-all shadow-sm sm:flex-none sm:py-2">
            ← Go To List
          </button>
          <button type="submit" disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#1d3a50] to-[#2d5473] hover:from-[#16304a] hover:to-[#264a63] text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50 shadow-md hover:shadow-lg sm:flex-none sm:py-2">
            {saving ? 'Saving...' : (isEdit ? 'Update →' : 'Save →')}
          </button>
        </div>
      </form>

      <style>{`
        .ifield {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #1f2937;
          outline: none;
          background: #fff;
          transition: all .15s ease;
        }
        .ifield::placeholder { color: #9ca3af; }
        .ifield:focus {
          border-color: #14b8a6;
          box-shadow: 0 0 0 2px #f0fdfa;
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, info, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {info && <span className="ml-1 text-gray-400 cursor-help" title={info}>ℹ</span>}
      </label>
      {children}
    </div>
  );
}
