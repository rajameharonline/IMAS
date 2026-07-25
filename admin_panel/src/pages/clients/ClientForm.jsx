import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { usePermission } from '../../context/PermissionContext';

// ─── Shared styles ─────────────────────────────────────────────────────
const inp  = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-50 transition-all duration-150';
const sel  = inp + ' cursor-pointer';

// ─── Tiny helpers ──────────────────────────────────────────────────────
function SectionTitle({ num, color, title, subtitle }) {
  return (
    <div className={`flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gradient-to-r ${color}`}>
      <span className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-white text-xs font-bold shrink-0">
        {num}
      </span>
      <div>
        <p className="text-sm font-bold text-white leading-tight">{title}</p>
        {subtitle && <p className="text-[11px] text-white/60">{subtitle}</p>}
      </div>
    </div>
  );
}

function Fl({ label, required, tip, children }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide leading-none">
          {label}
        </label>
        {required && <span className="text-red-400 text-xs leading-none">*</span>}
        {tip && <span className="text-[10px] text-gray-300 ml-1 normal-case font-normal">{tip}</span>}
      </div>
      {children}
    </div>
  );
}

function AddBtn({ label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="ml-1.5 text-[10px] font-bold text-white bg-teal-600 px-1.5 py-0.5 rounded-md hover:bg-teal-700 transition-colors leading-none">
      +{label}
    </button>
  );
}

// ─── Quick-Add Inline Modal ────────────────────────────────────────────
function QuickAddModal({ config, onClose, onSaved }) {
  const minp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-50 transition-all';
  const [vals, setVals] = useState(config.initial || {});
  const [saving, setSaving] = useState(false);

  const set = k => e => setVals(p => ({ ...p, [k]: e.target.value }));

  async function handleSave() {
    if (!vals.name?.trim()) { toast.error('নাম দিন'); return; }
    setSaving(true);
    try {
      const res = await api.post(config.endpoint, vals);
      toast.success(`${config.label} তৈরি হয়েছে`);
      onSaved(res.data);
      onClose();
    } catch (err) {
      const msg = err.response?.data?.name?.[0] || err.response?.data?.detail || 'Error';
      toast.error(msg);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className={`bg-gradient-to-r ${config.color} px-5 py-4 flex items-center justify-between`}>
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{config.icon}</span>
            <div>
              <p className="text-sm font-bold text-white">Add {config.label}</p>
              <p className="text-[11px] text-white/60">নতুন {config.label} যোগ করুন</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        {/* Body */}
        <div className="p-5 space-y-3.5">
          {config.fields.map(f => (
            <div key={f.key} className="space-y-1">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {f.type === 'textarea'
                ? <textarea className={minp} rows={3} placeholder={f.placeholder || ''} value={vals[f.key] || ''} onChange={set(f.key)} />
                : f.type === 'select'
                  ? <select className={minp + ' cursor-pointer'} value={vals[f.key] || ''} onChange={set(f.key)} disabled={f.disabled}>
                      <option value="">Select</option>
                      {(f.options || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  : <input className={minp} type="text" placeholder={f.placeholder || ''} value={vals[f.key] || ''} onChange={set(f.key)} autoFocus={f.autoFocus} />
              }
            </div>
          ))}
        </div>
        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2.5">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm font-medium text-gray-600 transition-all">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r ${config.color} text-white text-sm font-semibold transition-all disabled:opacity-60`}>
            {saving
              ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving...</>
              : <>Save {config.label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Form ─────────────────────────────────────────────────────────
export default function ClientForm() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const isEdit     = !!id;
  const location   = useLocation();
  const { isSuper, hasGranular } = usePermission();
  // Lat/Lng edit: superadmin/admin অথবা 'location_edit' permission যাদের আছে।
  // (Delete/খালি করা backend-এ শুধু admin পারে।) field কোথাও hide করা হয় না।
  const canEditLoc = isSuper || hasGranular('common', 'location_edit');
  const fromLeft   = new URLSearchParams(location.search).get('from') === 'left';

  const photoRef       = useRef(null);
  const nidPhotoRef    = useRef(null);
  const regFormPicRef  = useRef(null);
  const usernameTimer  = useRef(null);

  // ── Backend form ────────────────────────────────────────────────────
  const [form, setForm] = useState({
    customer_id: '', full_name: '', phone: '', alt_phone: '', email: '',
    nid: '', address: '', username: '', password: '', ip_address: '',
    mac_address: '', zone: '', subzone: '', box: '', client_type: '',
    protocol: '', package: '', router: '', pppoe_profile: '',
    bill_date: 1, monthly_bill: '', discount: '0',
    connection_date: new Date().toISOString().slice(0, 10),
    billing_start_month: new Date().toISOString().slice(0, 7),
    expiry_day: '', expiry_date: '', notes: '', status: 'active',
    map_lat: '', map_lng: '',
  });

  // ── UI-only fields (not saved) ──────────────────────────────────────
  const [ui, setUi] = useState({
    occupation: '', registration_form_no: '', gender: '', father_name: '',
    mother_name: '', date_of_birth: '',
    facebook: '', linkedin: '', twitter: '', district: '', upazila: '',
    road_number: '', house_number: '', permanent_address: '',
    same_address: false, connection_type: '', cable_metre: '',
    fiber_code: '', num_core: '', core_color: '', device_type: '',
    vendor: '', purchase_date: '', reference_by: '', is_vip: false,
    connected_by: '', affiliator: '', send_sms: false,
  });

  const [photoFile,         setPhotoFile]         = useState(null);
  const [photoPreview,      setPhotoPreview]      = useState(null);
  const [nidPhotoFile,      setNidPhotoFile]      = useState(null);
  const [nidPhotoPreview,   setNidPhotoPreview]   = useState(null);
  const [regFormPicFile,    setRegFormPicFile]    = useState(null);
  const [regFormPicPreview, setRegFormPicPreview] = useState(null);

  const [options, setOptions] = useState({
    zones: [], subzones: [], boxes: [], packages: [],
    protocols: [], clientTypes: [], routers: [], profiles: [],
    districts: [], upazilas: [],
  });
  const [loading,            setLoading]          = useState(false);
  const [billEditable,       setBillEditable]      = useState(false);
  const [usernameStatus,     setUsernameStatus]    = useState(null);
  const [quickAdd,           setQuickAdd]          = useState(null); // { type, config }
  const [customerIdEditable, setCustomerIdEditable] = useState(false); // System Settings থেকে
  const [nextCustomerId,     setNextCustomerId]    = useState('');      // Add mode preview
  const [locating,           setLocating]          = useState(false);

  // ── Load ────────────────────────────────────────────────────────────
  useEffect(() => {
    // System Settings: Customer ID edit permission + Add mode next ID preview
    api.get('/system/company/current/')
      .then(r => setCustomerIdEditable(!!r.data.customer_id_editable))
      .catch(() => {});

    // Add mode-এ পরবর্তী Customer ID preview করো
    if (!isEdit) {
      api.get('/system/company/next-customer-id/')
        .then(r => setNextCustomerId(r.data.next_customer_id || ''))
        .catch(() => {});
    }

    Promise.all([
      api.get('/config/zones/?is_active=true'),
      api.get('/config/packages/?is_active=true'),
      api.get('/config/protocol-types/?is_active=true'),
      api.get('/config/client-types/?is_active=true'),
      api.get('/mikrotik/servers/?is_active=true'),
      api.get('/config/districts/?is_active=true&ordering=name&page_size=200'),
    ]).then(([z, pkg, proto, ct, rt, dist]) => {
      setOptions(p => ({
        ...p,
        zones:       z.data.results    || z.data,
        packages:    pkg.data.results  || pkg.data,
        protocols:   proto.data.results|| proto.data,
        clientTypes: ct.data.results   || ct.data,
        routers:     rt.data.results   || rt.data,
        districts:   dist.data.results || dist.data,
      }));
    });

    if (isEdit) {
      api.get(`/clients/${id}/`).then(res => {
        const d = res.data;
        setForm({
          customer_id: d.customer_id || '', full_name: d.full_name || '',
          phone: d.phone || '', alt_phone: d.alt_phone || '',
          email: d.email || '', nid: d.nid || '', address: d.address || '',
          username: d.username || '', password: d.password || '',
          ip_address: d.ip_address || '', mac_address: d.mac_address || '',
          zone: d.zone || '', subzone: d.subzone || '', box: d.box || '',
          client_type: d.client_type || '', protocol: d.protocol || '',
          package: d.package || '', router: d.router || '',
          pppoe_profile: d.pppoe_profile || '', bill_date: d.bill_date || 1,
          monthly_bill: d.monthly_bill || '', discount: d.discount || '0',
          connection_date: d.connection_date || '',
          billing_start_month: d.billing_start_month || (d.connection_date ? d.connection_date.slice(0, 7) : new Date().toISOString().slice(0, 7)),
          expiry_day: d.expiry_day || '', expiry_date: d.expiry_date || '',
          notes: d.notes || '',
          status: fromLeft && d.status === 'left' ? 'active' : (d.status || 'active'),
          map_lat: d.map_lat != null && d.map_lat !== '' ? String(d.map_lat) : '',
          map_lng: d.map_lng != null && d.map_lng !== '' ? String(d.map_lng) : '',
        });
        if (d.photo)        setPhotoPreview(d.photo);
        if (d.nid_photo)    setNidPhotoPreview(d.nid_photo);
        if (d.reg_form_pic) setRegFormPicPreview(d.reg_form_pic);
        if (d.zone)    loadSubzones(d.zone);
        if (d.subzone) loadBoxes(d.subzone);
        if (d.router)  loadProfiles(d.router);
        setBillEditable(true);
      });
    }
  }, [id, isEdit]);

  const loadSubzones  = async z   => { if (!z)  return; const r = await api.get(`/config/subzones/?zone=${z}`);       setOptions(p => ({ ...p, subzones: r.data.results || r.data })); };
  const loadBoxes     = async sz  => { if (!sz) return; const r = await api.get(`/config/boxes/?subzone=${sz}`);      setOptions(p => ({ ...p, boxes:    r.data.results || r.data })); };
  const loadUpazilas  = async did => { if (!did){ setOptions(p => ({ ...p, upazilas: [] })); return; } const r = await api.get(`/config/upazilas/?district=${did}&is_active=true&ordering=name&page_size=200`); setOptions(p => ({ ...p, upazilas: r.data.results || r.data })); };
  const loadProfiles = async rt => {
    if (!rt) { setOptions(p => ({ ...p, profiles: [] })); return; }
    try { const r = await api.get(`/mikrotik/servers/${rt}/pppoe-profiles/`); setOptions(p => ({ ...p, profiles: r.data.profiles || [] })); }
    catch { setOptions(p => ({ ...p, profiles: [] })); }
  };

  const handleZoneChange    = v => { setForm(f => ({ ...f, zone: v, subzone: '', box: '' })); setOptions(p => ({ ...p, subzones: [], boxes: [] })); if (v) loadSubzones(v); };
  const handleSubzoneChange = v => { setForm(f => ({ ...f, subzone: v, box: '' }));           setOptions(p => ({ ...p, boxes: [] }));               if (v) loadBoxes(v); };
  const handleRouterChange  = v => { setForm(f => ({ ...f, router: v, pppoe_profile: '' })); setUsernameStatus(null); loadProfiles(v); };
  const handlePackageChange = v => {
    const pkg = options.packages.find(p => String(p.id) === String(v));
    setForm(f => ({ ...f, package: v, monthly_bill: pkg ? pkg.price : f.monthly_bill }));
    setBillEditable(false);
  };

  // ── Quick-add openers ───────────────────────────────────────────────
  function openQuickAdd(type) {
    const configs = {
      zone: {
        label: 'Zone', icon: '📍', color: 'from-[#1d3a50] to-[#2d5473]',
        endpoint: '/config/zones/',
        fields: [
          { key: 'name', label: 'Zone Name', required: true, autoFocus: true, placeholder: 'e.g. Rajamehar North' },
          { key: 'description', label: 'Details (Optional)', type: 'textarea', placeholder: 'Additional info...' },
        ],
        initial: { name: '', description: '' },
        onSaved: async item => {
          const r = await api.get('/config/zones/?is_active=true');
          setOptions(p => ({ ...p, zones: r.data.results || r.data }));
          handleZoneChange(String(item.id));
        },
      },
      subzone: {
        label: 'Sub Zone', icon: '📌', color: 'from-[#1a4a3a] to-[#2d6b55]',
        endpoint: '/config/subzones/',
        fields: [
          { key: 'zone', label: 'Zone', type: 'select', required: true, options: options.zones, disabled: !!form.zone },
          { key: 'name', label: 'Sub Zone Name', required: true, autoFocus: true, placeholder: 'e.g. West Block' },
          { key: 'description', label: 'Details (Optional)', type: 'textarea' },
        ],
        initial: { zone: form.zone || '', name: '', description: '' },
        onSaved: async item => {
          await loadSubzones(form.zone || item.zone);
          setForm(f => ({ ...f, subzone: String(item.id), box: '' }));
          setOptions(p => ({ ...p, boxes: [] }));
        },
      },
      box: {
        label: 'Box', icon: '📦', color: 'from-[#3a2a1d] to-[#5a4530]',
        endpoint: '/config/boxes/',
        fields: [
          { key: 'subzone', label: 'Sub Zone', type: 'select', required: true, options: options.subzones, disabled: !!form.subzone },
          { key: 'name', label: 'Box Name', required: true, autoFocus: true, placeholder: 'e.g. Box-12' },
          { key: 'location', label: 'Location (Optional)', placeholder: 'Physical location' },
        ],
        initial: { subzone: form.subzone || '', name: '', location: '' },
        onSaved: async item => {
          await loadBoxes(form.subzone || item.subzone);
          setForm(f => ({ ...f, box: String(item.id) }));
        },
      },
      clienttype: {
        label: 'Client Type', icon: '🏷️', color: 'from-[#2d1d4a] to-[#472d6b]',
        endpoint: '/config/client-types/',
        fields: [
          { key: 'name', label: 'Type Name', required: true, autoFocus: true, placeholder: 'e.g. Corporate' },
          { key: 'description', label: 'Details (Optional)', type: 'textarea' },
        ],
        initial: { name: '', description: '' },
        onSaved: async item => {
          const r = await api.get('/config/client-types/?is_active=true');
          setOptions(p => ({ ...p, clientTypes: r.data.results || r.data }));
          setForm(f => ({ ...f, client_type: String(item.id) }));
        },
      },
    };
    const cfg = configs[type];
    if (cfg) setQuickAdd(cfg);
  }

  const checkUsername = useCallback((username, routerId) => {
    clearTimeout(usernameTimer.current);
    if (!username || !routerId) { setUsernameStatus(null); return; }
    setUsernameStatus('checking');
    usernameTimer.current = setTimeout(async () => {
      try {
        const r = await api.get(`/mikrotik/servers/${routerId}/check-username/?username=${encodeURIComponent(username)}`);
        setUsernameStatus(r.data.exists ? 'taken' : 'available');
      } catch { setUsernameStatus(null); }
    }, 600);
  }, [isEdit]);

  const set  = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setU = k => e => setUi(u => ({ ...u, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const handleGetLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocation is not supported by your browser'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({ ...f, map_lat: pos.coords.latitude.toFixed(6), map_lng: pos.coords.longitude.toFixed(6) }));
        setLocating(false);
        toast.success('Location captured!');
      },
      err => { setLocating(false); toast.error('Location error: ' + err.message); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // billing_start_month বদলালে expiry_date re-calculate
  const handleBillingMonthChange = e => {
    const month = e.target.value;
    setForm(f => {
      let expiryDate = f.expiry_date;
      if (f.expiry_day && month) {
        const [y, m] = month.split('-').map(Number);
        const d = new Date(y, m, f.expiry_day);
        expiryDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      return { ...f, billing_start_month: month, expiry_date: expiryDate };
    });
  };

  // ── Expire Day handler: পরবর্তী মাসের ওই তারিখ হিসেবে expiry_date auto-calc ──
  const handleExpiryDayChange = e => {
    const day = e.target.value ? Number(e.target.value) : '';
    let expiryDate = '';
    if (day && form.billing_start_month) {
      // billing_start_month = "2026-05" → y=2026, m=5
      // JS: new Date(2026, 5, day) = June (পরবর্তী মাস) — কারণ JS month 0-indexed
      const [y, m] = form.billing_start_month.split('-').map(Number);
      const d = new Date(y, m, day);          // m = next month in JS (May string=5, JS June=5)
      expiryDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    setForm(f => ({ ...f, expiry_day: day, expiry_date: expiryDate }));
  };

  // connection_date পরিবর্তন হলে billing_start_month auto-sync (যদি এখনো manually set না করা থাকে)
  const handleConnectionDateChange = e => {
    const dateVal = e.target.value;
    const newMonth = dateVal ? dateVal.slice(0, 7) : '';
    setForm(f => ({
      ...f,
      connection_date: dateVal,
      billing_start_month:
        f.billing_start_month === (f.connection_date ? f.connection_date.slice(0, 7) : '')
          ? newMonth
          : f.billing_start_month,
    }));
  };

  const handleSubmit = async e => {
    e.preventDefault();

    // ── Frontend validation ──────────────────────────────────────────
    const errors = [];

    if (!form.full_name?.trim())
      errors.push('নাম (Customer Name) অবশ্যই দিতে হবে।');

    const phone = form.phone?.trim() || '';
    if (!phone)
      errors.push('মোবাইল নম্বর অবশ্যই দিতে হবে।');
    else if (!/^01[3-9]\d{8}$/.test(phone))
      errors.push('মোবাইল নম্বর সঠিক নয় — ১১ সংখ্যার বাংলাদেশি নম্বর দিন (01XXXXXXXXX)।');

    const altPhone = form.alt_phone?.trim() || '';
    if (altPhone && !/^01[3-9]\d{8}$/.test(altPhone))
      errors.push('বিকল্প মোবাইল নম্বর সঠিক নয় — ১১ সংখ্যার বাংলাদেশি নম্বর দিন।');

    if (!form.username?.trim())
      errors.push('Username অবশ্যই দিতে হবে।');

    if (!isEdit && !form.password?.trim())
      errors.push('Password অবশ্যই দিতে হবে।');

    if (!form.router)
      errors.push('Server (Router) অবশ্যই সিলেক্ট করতে হবে।');

    if (!form.package)
      errors.push('Package অবশ্যই সিলেক্ট করতে হবে।');

    if (!form.pppoe_profile?.trim())
      errors.push('Profile অবশ্যই দিতে হবে।');

    if (!form.zone)
      errors.push('Zone অবশ্যই সিলেক্ট করতে হবে।');

    const nid = form.nid?.trim() || '';
    if (nid && !/^\d{10}$|^\d{13}$|^\d{17}$/.test(nid))
      errors.push('NID সঠিক নয় — ১০, ১৩ বা ১৭ সংখ্যার হতে হবে।');

    const email = form.email?.trim() || '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.push('Email ঠিকানা সঠিক নয়।');

    if (errors.length > 0) {
      errors.forEach(msg => toast.error(msg, { duration: 4000 }));
      return;
    }

    setLoading(true);
    const NULLABLE = ['zone','subzone','box','client_type','protocol','package','router',
                      'ip_address','connection_date','expiry_day','expiry_date'];
    try {
      // সবসময় multipart/form-data — photo থাকুক বা না থাকুক
      const fd = new FormData();
      const keys = ['full_name','phone','alt_phone','email','nid','address','username','password',
        'ip_address','mac_address','zone','subzone','box','client_type','protocol','package','router',
        'pppoe_profile','bill_date','monthly_bill','discount','connection_date','billing_start_month',
        'expiry_day','expiry_date','status','notes'];
      if (isEdit) keys.push('customer_id');
      keys.forEach(k => {
        const v = form[k];
        if (NULLABLE.includes(k) && !v) return;
        if (v !== undefined && v !== null) fd.append(k, v);
      });
      // map_lat / map_lng: মান থাকলে 6 decimal; edit-এ খালি হলে '' পাঠাই (delete signal → backend None করে)
      const _lat = form.map_lat ? parseFloat(form.map_lat) : NaN;
      const _lng = form.map_lng ? parseFloat(form.map_lng) : NaN;
      if (!isNaN(_lat))      fd.append('map_lat', _lat.toFixed(6));
      else if (isEdit)       fd.append('map_lat', '');
      if (!isNaN(_lng))      fd.append('map_lng', _lng.toFixed(6));
      else if (isEdit)       fd.append('map_lng', '');
      if (photoFile)      fd.append('photo',        photoFile);
      if (nidPhotoFile)   fd.append('nid_photo',    nidPhotoFile);
      if (regFormPicFile) fd.append('reg_form_pic', regFormPicFile);

      if (isEdit) await api.patch(`/clients/${id}/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else        await api.post('/clients/', fd,       { headers: { 'Content-Type': 'multipart/form-data' } });

      toast.success(isEdit ? 'Client updated.' : 'Client created — RADIUS & Mikrotik configured.');
      navigate('/clients');
    } catch (err) {
      const errors = err.response?.data;
      if (errors && typeof errors === 'object') {
        Object.entries(errors).forEach(([f, m]) => toast.error(`${f}: ${Array.isArray(m) ? m[0] : m}`));
      } else { toast.error('Failed to save.'); }
    } finally { setLoading(false); }
  };

  // ── Billing month options: January – December (১২টি fix মাস) ──
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  // Year: connection_date থেকে নেয়, না থাকলে current year
  const billingYear = form.connection_date
    ? new Date(form.connection_date).getFullYear()
    : new Date().getFullYear();
  const billingMonthOptions = MONTHS.map((label, idx) => ({
    val:   `${billingYear}-${String(idx + 1).padStart(2, '0')}`,
    label,
  }));

  const selectedPkg = options.packages.find(p => String(p.id) === String(form.package));

  /* ── shared section header ── */
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

  /* ── file-upload thumbnail — any size image, with existing preview ── */
  function ThumbUpload({ inputRef, preview, label, onChange }) {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
        <div
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
          aria-label={label}
          className="relative w-full aspect-[4/3] max-h-32 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden cursor-pointer hover:border-[#1d3a50] transition-colors group focus:outline-none focus:ring-2 focus:ring-[#1d3a50] focus:ring-offset-1"
        >
          {preview ? (
            <img
              src={preview}
              alt={label}
              className="w-full h-full object-contain bg-white"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 p-2">
              <svg className="w-7 h-7 text-gray-300 group-hover:text-[#1d3a50]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-[10px] text-gray-400">Click to upload</span>
            </div>
          )}
          <div className="absolute bottom-1 right-1 w-5 h-5 bg-[#1d3a50] rounded-full flex items-center justify-center shadow">
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </div>
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-gray-50 to-blue-50/30">

      {/* ── Sticky top action bar ── */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
        <div className="px-5 py-3 flex items-center justify-between">
          {/* Left: breadcrumb */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1d3a50] flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800 leading-none">
                {isEdit ? 'Edit Client' : 'Add New Client'}
              </p>
              <nav className="text-[11px] text-gray-400 mt-0.5">
                <button type="button" onClick={() => navigate('/clients')} className="hover:text-[#1d3a50] transition-colors">Client List</button>
                <span className="mx-1">›</span>
                <span className="text-gray-500">{isEdit ? 'Edit' : 'Add New'}</span>
              </nav>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => navigate(fromLeft ? '/clients/left' : '/clients')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-600 transition-all shadow-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Cancel
            </button>
            <button type="submit" form="client-form" disabled={loading || usernameStatus === 'taken'}
              className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-[#1d3a50] to-[#2d5473] hover:from-[#16304a] hover:to-[#264a63] text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50 shadow-md hover:shadow-lg">
              {loading
                ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving...</>
                : <>{isEdit
                    ? <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Update Client</>
                    : <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>Save Client</>
                  }</>
              }
            </button>
          </div>
        </div>

        {/* Section tab quick-links */}
        <div className="px-5 pb-0 flex gap-0.5 overflow-x-auto scrollbar-hide">
          {[
            { icon: '👤', label: 'Personal', href: 'sec-personal', border: 'hover:border-[#2d5473]', text: 'hover:text-[#1d3a50]' },
            { icon: '📡', label: 'Contact',  href: 'sec-contact',  border: 'hover:border-[#2d6b55]', text: 'hover:text-[#1a4a3a]' },
            { icon: '📶', label: 'Network',  href: 'sec-network',  border: 'hover:border-[#5a4530]', text: 'hover:text-[#3a2a1d]' },
            { icon: '⚡', label: 'Service',  href: 'sec-service',  border: 'hover:border-[#472d6b]', text: 'hover:text-[#2d1d4a]' },
          ].map(tab => (
            <a key={tab.href} href={`#${tab.href}`}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-semibold text-gray-500 ${tab.text} border-b-2 border-transparent ${tab.border} transition-all whitespace-nowrap`}>
              <span>{tab.icon}</span>{tab.label}
            </a>
          ))}
        </div>
      </div>

      <form id="client-form" onSubmit={handleSubmit}>
        <div className="p-5 space-y-5">

          {/* ══════════════════════════════════════════════════════
              SECTION 1 — Personal Information
          ══════════════════════════════════════════════════════ */}
          <div id="sec-personal" className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-md ring-1 ring-black/5">
            <SecHdr icon="👤" title="Personal Information" color="from-[#1d3a50] to-[#2d5473]" />
            <div className="p-5 space-y-4">

              {/* Row 1: Photo + Name + Remarks */}
              <div className="flex flex-col sm:flex-row gap-4">
                {/* Profile photo */}
                <div className="shrink-0 mx-auto sm:mx-0 flex flex-col items-center gap-1.5">
                  <div onClick={() => photoRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); photoRef.current?.click(); } }}
                    aria-label="Profile Picture upload"
                    className="relative w-28 h-28 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden cursor-pointer hover:border-[#1d3a50] transition-colors group focus:outline-none focus:ring-2 focus:ring-[#1d3a50] focus:ring-offset-1">
                    {photoPreview
                      ? <img src={photoPreview} alt="Profile" className="w-full h-full object-contain bg-white" />
                      : <svg className="w-9 h-9 text-gray-300 group-hover:text-[#1d3a50]" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                        </svg>}
                    <div className="absolute bottom-1 right-1 w-5 h-5 bg-[#1d3a50] rounded-full flex items-center justify-center shadow">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide text-center">Profile<br/>Picture</p>
                  <input ref={photoRef} type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const f = e.target.files[0];
                      if (f) { setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); }
                    }} />
                </div>

                {/* Name + Remarks */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Fl label="Customer Name" required>
                      <input className={inp} value={form.full_name} onChange={set('full_name')} required />
                    </Fl>
                  </div>
                  <div className="col-span-2">
                    <Fl label="Remarks / Special Note">
                      <textarea className={inp} rows={3} value={form.notes} onChange={set('notes')} />
                    </Fl>
                  </div>
                </div>
              </div>

              {/* Row 2: Occupation, NID, NID Photo, Reg No, Reg Form Pic */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <Fl label="Occupation">
                  <input className={inp} value={ui.occupation} onChange={setU('occupation')} />
                </Fl>
                <Fl label="NID / Birth Certificate No">
                  <input className={inp} value={form.nid} onChange={set('nid')} />
                </Fl>
                <ThumbUpload
                  inputRef={nidPhotoRef}
                  preview={nidPhotoPreview}
                  label="NID / Birth Certificate Picture"
                  onChange={e => {
                    const f = e.target.files[0];
                    if (f) { setNidPhotoFile(f); setNidPhotoPreview(URL.createObjectURL(f)); }
                  }}
                />
                <Fl label="Registration Form No">
                  <input className={inp} value={ui.registration_form_no} onChange={setU('registration_form_no')} />
                </Fl>
                <ThumbUpload
                  inputRef={regFormPicRef}
                  preview={regFormPicPreview}
                  label="Registration Form Picture"
                  onChange={e => {
                    const f = e.target.files[0];
                    if (f) { setRegFormPicFile(f); setRegFormPicPreview(URL.createObjectURL(f)); }
                  }}
                />
              </div>

              {/* Row 3: Gender, Father, DOB, Mother */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Fl label="Gender">
                  <select className={sel} value={ui.gender} onChange={setU('gender')}>
                    <option value="">Select</option>
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </Fl>
                <Fl label="Father Name">
                  <input className={inp} value={ui.father_name} onChange={setU('father_name')} />
                </Fl>
                <Fl label="Date of Birth">
                  <input className={inp} type="date" value={ui.date_of_birth} onChange={setU('date_of_birth')} />
                </Fl>
                <Fl label="Mother Name">
                  <input className={inp} value={ui.mother_name} onChange={setU('mother_name')} />
                </Fl>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              SECTION 2 — Contact Information
          ══════════════════════════════════════════════════════ */}
          <div id="sec-contact" className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-md ring-1 ring-black/5">
            <SecHdr icon="📡" title="Contact Information" color="from-[#1a4a3a] to-[#2d6b55]" />
            <div className="p-5 space-y-4">

              {/* Row 1 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Fl label="Mobile Number" required>
                  <input className={inp} type="tel" value={form.phone} onChange={set('phone')} required placeholder="01XXXXXXXXX" />
                </Fl>
                <Fl label="District">
                  <select className={sel} value={ui.district}
                    onChange={e => { setUi(p => ({ ...p, district: e.target.value, upazila: '' })); loadUpazilas(e.target.value); }}>
                    <option value="">Select District</option>
                    {options.districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Fl>
                <div className="md:col-span-2">
                  <Fl label="Present Address">
                    <textarea className={inp} rows={3} value={form.address} onChange={set('address')} />
                  </Fl>
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Fl label="Phone Number">
                  <input className={inp} type="tel" value={form.alt_phone} onChange={set('alt_phone')} placeholder="01XXXXXXXXX" />
                </Fl>
                <Fl label="Upazila / Thana">
                  <select className={sel} value={ui.upazila} onChange={setU('upazila')} disabled={!options.upazilas.length && !ui.district}>
                    <option value="">Select Upazila</option>
                    {options.upazilas.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </Fl>
                <div className="md:col-span-2">
                  <Fl label="Permanent Address">
                    <textarea className={inp} rows={2} value={ui.permanent_address}
                      onChange={setU('permanent_address')} />
                  </Fl>
                  <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={ui.same_address}
                      onChange={e => { const v = e.target.checked; setUi(u => ({ ...u, same_address: v, permanent_address: v ? form.address : u.permanent_address })); }}
                      className="w-3.5 h-3.5 accent-[#1d3a50]" />
                    <span className="text-[11px] text-gray-500">Same As Present Address?</span>
                  </label>
                </div>
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Fl label="Facebook URL">
                  <input className={inp} value={ui.facebook} onChange={setU('facebook')} />
                </Fl>
                <Fl label="Email Address">
                  <input className={inp} type="email" value={form.email} onChange={set('email')} placeholder="example@email.com" />
                </Fl>
                <Fl label="Road Number">
                  <input className={inp} value={ui.road_number} onChange={setU('road_number')} />
                </Fl>
                <Fl label="House Number">
                  <input className={inp} value={ui.house_number} onChange={setU('house_number')} />
                </Fl>
              </div>

              {/* Row 4 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Fl label="LinkedIn URL">
                  <input className={inp} value={ui.linkedin} onChange={setU('linkedin')} />
                </Fl>
                <Fl label="Twitter URL">
                  <input className={inp} value={ui.twitter} onChange={setU('twitter')} placeholder="@handle" />
                </Fl>
                <div className="md:col-span-2 space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide leading-none">
                      Map Location
                    </label>
                    <span className="text-[10px] text-gray-300 ml-1 normal-case font-normal">(Lat / Lng)</span>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      className={inp + ' flex-1 min-w-[130px]' + (!canEditLoc ? ' bg-gray-100 text-gray-500 cursor-not-allowed' : '')}
                      value={form.map_lat}
                      onChange={set('map_lat')}
                      disabled={!canEditLoc}
                      readOnly={!canEditLoc}
                      placeholder="Latitude (e.g. 23.7104)"
                    />
                    <input
                      className={inp + ' flex-1 min-w-[130px]' + (!canEditLoc ? ' bg-gray-100 text-gray-500 cursor-not-allowed' : '')}
                      value={form.map_lng}
                      onChange={set('map_lng')}
                      disabled={!canEditLoc}
                      readOnly={!canEditLoc}
                      placeholder="Longitude (e.g. 90.4074)"
                    />
                    <button
                      type="button"
                      onClick={handleGetLocation}
                      disabled={locating || !canEditLoc}
                      title="Click to get your current GPS location"
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 active:bg-teal-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                      {locating ? (
                        <>
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Locating…
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                            <path d="M12 9a3 3 0 100 6 3 3 0 000-6z" />
                          </svg>
                          Get Location
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              SECTION 3 — Network & Product Information
          ══════════════════════════════════════════════════════ */}
          <div id="sec-network" className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-md ring-1 ring-black/5">
            <SecHdr icon="📶" title="Network & Product Information" color="from-[#3a2a1d] to-[#5a4530]" />
            <div className="p-5 space-y-4">

              {/* Row 1: Server, Zone, SubZone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <Fl label="Server" required>
                  <select className={sel} value={form.router} onChange={e => handleRouterChange(e.target.value)} required>
                    <option value="">Select</option>
                    {options.routers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Fl>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Zone</label>
                    <span className="text-red-400 text-xs">*</span>
                    <AddBtn label="ZONE" onClick={() => openQuickAdd('zone')} />
                  </div>
                  <select className={sel} value={form.zone} onChange={e => handleZoneChange(e.target.value)} required>
                    <option value="">Select</option>
                    {options.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Sub Zone</label>
                    <AddBtn label="SUB ZONE" onClick={() => openQuickAdd('subzone')} />
                  </div>
                  <select className={sel} value={form.subzone} onChange={e => handleSubzoneChange(e.target.value)} disabled={!options.subzones.length}>
                    <option value="">Select</option>
                    {options.subzones.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 2: Box, Connection Type, Cable, Fiber */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Box</label>
                    <AddBtn label="BOX" onClick={() => openQuickAdd('box')} />
                  </div>
                  <select className={sel} value={form.box} onChange={set('box')} disabled={!options.boxes.length}>
                    <option value="">Select</option>
                    {options.boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <Fl label="Connection Type" required>
                  <select className={sel} value={form.protocol} onChange={set('protocol')} required>
                    <option value="">Select</option>
                    {options.protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Fl>
                <Fl label="Cable Requirement in Metre">
                  <input className={inp} type="number" value={ui.cable_metre} onChange={setU('cable_metre')} placeholder="Example: 100" min="0" />
                </Fl>
                <Fl label="Fiber Code">
                  <input className={inp} value={ui.fiber_code} onChange={setU('fiber_code')} placeholder="Example: 121" />
                </Fl>
              </div>

              {/* Row 3: Core, Color, Device, MAC, Vendor, Purchase */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Fl label="Number of Core">
                  <input className={inp} value={ui.num_core} onChange={setU('num_core')} placeholder="Example: 2" />
                </Fl>
                <Fl label="Core Color">
                  <input className={inp} value={ui.core_color} onChange={setU('core_color')} placeholder="Example: Red" />
                </Fl>
                <Fl label="Device">
                  <select className={sel} value={ui.device_type} onChange={setU('device_type')}>
                    <option value="">Select</option>
                    <option value="router">Router</option><option value="onu">ONU</option>
                    <option value="modem">Modem</option><option value="switch">Switch</option>
                    <option value="other">Other</option>
                  </select>
                </Fl>
                <Fl label="Device MAC / Serial No">
                  <input className={inp} value={form.mac_address} onChange={set('mac_address')} placeholder="AA:BB:CC:DD:EE:FF" />
                </Fl>
              </div>

              {/* Row 4: Vendor, Purchase Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Fl label="Vendor">
                  <select className={sel} value={ui.vendor} onChange={setU('vendor')}>
                    <option value="">Select</option>
                    <option value="mikrotik">Mikrotik</option><option value="tp-link">TP-Link</option>
                    <option value="huawei">Huawei</option><option value="zte">ZTE</option>
                    <option value="other">Other</option>
                  </select>
                </Fl>
                <Fl label="Purchase Date">
                  <input className={inp} type="date" value={ui.purchase_date} onChange={setU('purchase_date')} />
                </Fl>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              SECTION 4 — Service Information
          ══════════════════════════════════════════════════════ */}
          <div id="sec-service" className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-md ring-1 ring-black/5">
            <SecHdr icon="⚡" title="Service Information" color="from-[#2d1d4a] to-[#472d6b]" />
            <div className="p-5 space-y-4">

              {/* Row 1: Customer ID (conditional), Package, Profile, Client Type, Billing Status */}
              {/* Add: Customer ID readonly দেখায়; Edit: toggle=ON হলে editable দেখায়, OFF হলে লুকানো */}
              <div className={`grid gap-4 ${
                !isEdit ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5'            // Add → 5 col
                : customerIdEditable ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5' // Edit + editable → 5 col
                : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-4'                                   // Edit + locked → 4 col
              }`}>
                {/* Customer ID field */}
                {(!isEdit || customerIdEditable) && (
                  <Fl
                    label="Customer ID"
                    required={!isEdit}
                    hint={isEdit && customerIdEditable ? '⚠️ সতর্কতার সাথে পরিবর্তন করুন' : ''}>
                    {!isEdit ? (
                      /* Add mode: next ID preview — readonly, teal badge style */
                      <div className="relative">
                        <input
                          readOnly
                          value={nextCustomerId}
                          placeholder="লোড হচ্ছে…"
                          className={`${inp} bg-teal-50 border-teal-300 text-teal-700 font-mono font-bold
                            tracking-wider cursor-not-allowed pr-20`} />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2
                          bg-teal-100 text-teal-600 text-[10px] font-bold px-2 py-0.5
                          rounded-full border border-teal-200 whitespace-nowrap">
                          Auto
                        </span>
                      </div>
                    ) : (
                      /* Edit mode: editable with orange border */
                      <input
                        className={`${inp} border-orange-300 focus:border-orange-400
                          focus:ring-orange-100 font-mono font-semibold`}
                        value={form.customer_id}
                        onChange={set('customer_id')}
                        placeholder="" />
                    )}
                  </Fl>
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Package</label>
                    <span className="text-red-400 text-xs">*</span>
                    <AddBtn label="PACKAGE" onClick={() => navigate('/config/packages')} />
                  </div>
                  <select className={sel} value={form.package} onChange={e => handlePackageChange(e.target.value)} required>
                    <option value="">Select</option>
                    {options.packages.map(p => <option key={p.id} value={p.id}>{p.name} — ৳{p.price}</option>)}
                  </select>
                </div>
                <Fl label="Profile" required>
                  {options.profiles.length > 0
                    ? <select className={sel} value={form.pppoe_profile} onChange={set('pppoe_profile')}>
                        <option value="">Select</option>
                        {options.profiles.map(p => <option key={p.name} value={p.name}>{p.name}{p.rate_limit ? ` (${p.rate_limit})` : ''}</option>)}
                      </select>
                    : <input className={inp} value={form.pppoe_profile} onChange={set('pppoe_profile')}
                        placeholder={form.router ? 'Type profile name' : 'Select server first'} />}
                </Fl>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Client Type</label>
                    <span className="text-red-400 text-xs">*</span>
                    <AddBtn label="CLIENT TYPE" onClick={() => openQuickAdd('clienttype')} />
                  </div>
                  <select className={sel} value={form.client_type} onChange={set('client_type')}>
                    <option value="">Select</option>
                    {options.clientTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <Fl label="Billing Status" required>
                  <select className={`${sel}${fromLeft ? ' ring-2 ring-teal-400 border-teal-400' : ''}`}
                    value={form.status} onChange={set('status')} required>
                    <option value="">Select</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    {!fromLeft && <option value="left">Left</option>}
                  </select>
                </Fl>
              </div>

              {/* Row 2: Username, Password, Joining Date, Monthly Bill */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Username / IP</label>
                    <span className="text-red-400 text-xs">*</span>
                  </div>
                  <input
                    className={`${inp} ${usernameStatus === 'taken' ? 'border-red-400 ring-1 ring-red-100' : usernameStatus === 'available' ? 'border-teal-400 ring-1 ring-teal-100' : ''}`}
                    value={form.username} required
                    onChange={e => { setForm(f => ({ ...f, username: e.target.value })); checkUsername(e.target.value, form.router); }}
                    placeholder="PPPoE username" />
                  {usernameStatus === 'checking'  && <p className="text-[10px] text-blue-500">Checking…</p>}
                  {usernameStatus === 'available' && <p className="text-[10px] text-teal-600 font-semibold">✓ Available</p>}
                  {usernameStatus === 'taken'     && <p className="text-[10px] text-red-500 font-semibold">✗ Already in use</p>}
                </div>
                <Fl label="Password" required>
                  <input className={inp} value={form.password} onChange={set('password')} required placeholder="PPPoE password" autoComplete="new-password" />
                </Fl>
                <Fl label="Joining Date (No Relation in Billing)" required>
                  <input className={inp} type="date" value={form.connection_date || ''} onChange={handleConnectionDateChange} required />
                </Fl>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Monthly Bill</label>
                    <span className="text-red-400 text-xs">*</span>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 transition-colors ${billEditable ? 'border-teal-400 bg-white focus:ring-teal-100' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                      type="number" value={form.monthly_bill} min="0" readOnly={!billEditable}
                      onChange={e => setForm(f => ({ ...f, monthly_bill: e.target.value }))}
                      required placeholder="Provide client monthly bill amount." />
                    <button type="button" onClick={() => setBillEditable(v => !v)}
                      className={`w-9 rounded-lg border text-sm font-bold shrink-0 transition-colors ${billEditable ? 'bg-[#1d3a50] text-white border-[#1d3a50]' : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-[#1d3a50]'}`}>
                      {billEditable
                        ? <svg className="w-4 h-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        : <svg className="w-4 h-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}
                    </button>
                  </div>
                </div>
              </div>

              {/* Row 3: Billing Start, Expire Date, Ref, VIP, Connected By */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {/* ── Billing Start Month — required ── */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide leading-none">
                      Billing Start Month
                    </label>
                    <span className="text-red-400 text-xs leading-none font-bold">*</span>
                  </div>
                  <select
                    className={`${sel} ${
                      form.billing_start_month
                        ? 'border-teal-400 ring-1 ring-teal-100 text-gray-800 font-semibold'
                        : 'border-red-300 ring-1 ring-red-100 text-gray-400'
                    }`}
                    value={form.billing_start_month}
                    onChange={handleBillingMonthChange}
                    required
                  >
                    <option value="">— Select Billing Month —</option>
                    {billingMonthOptions.map(o => (
                      <option key={o.val} value={o.val}>{o.label}</option>
                    ))}
                  </select>
                  {form.billing_start_month
                    ? <p className="text-[10px] text-teal-600 font-semibold flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        বিলিং শুরু: {billingMonthOptions.find(o => o.val === form.billing_start_month)?.label}
                      </p>
                    : <p className="text-[10px] text-red-500 font-semibold flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        বিলিং মাস অবশ্যই নির্বাচন করুন
                      </p>
                  }
                </div>
                {/* ── Expire Day ── */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide leading-none">
                      Expire Day
                    </label>
                    <span className="text-[10px] text-gray-400 normal-case font-normal ml-1">পরবর্তী মাসের তারিখ</span>
                  </div>
                  <select
                    className={`${sel} ${form.expiry_day ? 'border-teal-400 ring-1 ring-teal-100' : ''}`}
                    value={form.expiry_day || ''}
                    onChange={handleExpiryDayChange}
                  >
                    <option value="">Select Day</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  {form.expiry_day && form.expiry_date && (
                    <p className="text-[10px] text-teal-600 font-semibold flex items-center gap-1">
                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Expire: {new Date(form.expiry_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                  {form.expiry_day && !form.billing_start_month && (
                    <p className="text-[10px] text-amber-500 font-semibold">⚠ Billing মাস আগে select করুন</p>
                  )}
                </div>
                <Fl label="Reference By">
                  <input className={inp} value={ui.reference_by} onChange={setU('reference_by')} />
                </Fl>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-yellow-600 uppercase tracking-wide flex items-center gap-1">
                    <span>⭐</span> IS VIP CLIENT?
                  </label>
                  <label className="flex items-center gap-2 h-[38px] cursor-pointer">
                    <input type="checkbox" checked={ui.is_vip} onChange={setU('is_vip')} className="w-4 h-4 accent-[#1d3a50]" />
                    <span className="text-sm text-gray-600 font-medium">Click to Set</span>
                  </label>
                </div>
                <Fl label="Connected By">
                  <input className={inp} value={ui.connected_by} onChange={setU('connected_by')} placeholder="Select Employee" />
                </Fl>
              </div>

              {/* Send SMS */}
              <div className="pt-1 border-t border-gray-100 flex justify-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={ui.send_sms} onChange={setU('send_sms')} className="w-4 h-4 accent-[#1d3a50]" />
                  <span className="text-sm text-gray-600 font-medium">Send Greetings SMS?</span>
                </label>
              </div>
            </div>
          </div>

          {/* ── Bottom action strip ── */}
          <div className="bg-white/80 backdrop-blur rounded-xl border border-gray-100 shadow-sm px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <svg className="w-4 h-4 shrink-0 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <span>Fields marked with <span className="text-red-400 font-bold">*</span> are required</span>
            </div>
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => navigate(fromLeft ? '/clients/left' : '/clients')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm font-medium text-gray-600 transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Discard
              </button>
              <button type="submit" disabled={loading || usernameStatus === 'taken'}
                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-[#1d3a50] to-[#2d5473] hover:from-[#16304a] hover:to-[#264a63] text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50 shadow-md hover:shadow-lg">
                {loading
                  ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving...</>
                  : <>{isEdit
                      ? <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Update Client</>
                      : <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>Save Client</>
                    }</>}
              </button>
            </div>
          </div>

        </div>
      </form>

      {/* ── Quick-Add Modal ── */}
      {quickAdd && (
        <QuickAddModal
          config={quickAdd}
          onClose={() => setQuickAdd(null)}
          onSaved={item => quickAdd.onSaved(item)}
        />
      )}
    </div>
  );
}
