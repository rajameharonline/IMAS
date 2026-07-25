import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ─── Column definitions ─────────────────────────────────────────── */
const REQUIRED_COLS = [
  'Name', 'Mobile', 'Zone', 'Protocol',
  'Package', 'Profile', 'UserName', 'Password', 'B.Status', 'M.Bill',
];
const ALL_COLS = [
  'Customer ID', 'Name', 'Mobile', 'Email', 'Zone', 'Protocol',
  'Package', 'Profile', 'UserName', 'Password', 'B.Status',
  'Exp.Date', 'Bill.Date', 'M.Bill',
];
const REQUIRED_SET = new Set(REQUIRED_COLS);

/* ─── Smart column mapper ─────────────────────────────────────────────
 * অন্য ISP সফটওয়্যারের (NetBillingBD, ISP Digital ইত্যাদি) export ফাইলে
 * কলামের নাম ভিন্ন হয়। নিচের alias দিয়ে যেকোনো পরিচিত নাম আমাদের canonical
 * field-এ auto-map হয়। নতুন নাম পেলে এখানে যোগ করলেই চলবে। */
const HEADER_ALIASES = {
  'Name':      ['name', 'customername', 'clientname', 'fullname', 'cusname', 'customer', 'subscribername', 'subscriber'],
  'Mobile':    ['mobile', 'mobileno', 'mobilenumber', 'phone', 'phoneno', 'phonenumber', 'contact', 'contactno', 'contactnumber', 'msisdn', 'cell', 'cellno'],
  'Email':     ['email', 'emailaddress', 'mail', 'emailid'],
  'Zone':      ['zone', 'zonename', 'area', 'areaname', 'location', 'region', 'svzone'],
  'Protocol':  ['protocol', 'connectiontype', 'conntype', 'connection', 'servicetype', 'contype', 'medium'],
  'Package':   ['package', 'packagename', 'plan', 'planname', 'serviceplan', 'packageplan', 'bandwidth', 'pkg'],
  'Profile':   ['profile', 'pppoeprofile', 'mikrotikprofile', 'speed', 'speedprofile', 'ratelimit', 'mtkprofile'],
  'UserName':  ['username', 'user', 'userid', 'pppoeid', 'pppoeuser', 'pppoeusername', 'loginid', 'login', 'account', 'accountid', 'pppoename', 'connectionid'],
  'Password':  ['password', 'pass', 'pwd', 'pppoepassword', 'secret', 'loginpassword', 'userpassword', 'pppoepass'],
  'B.Status':  ['bstatus', 'status', 'billingstatus', 'accountstatus', 'state', 'activestatus', 'connectionstatus', 'clientstatus'],
  'Exp.Date':  ['expdate', 'expiredate', 'expirydate', 'expiry', 'expire', 'expiration', 'expirationdate', 'packageexpirationtime', 'packageexpiration', 'expirationtime', 'expiretime', 'duedate', 'nextbilldate', 'nextbillingdate', 'validity', 'validtill', 'expiredon'],
  'Bill.Date': ['billdate', 'billingdate', 'activationdate', 'joindate', 'joiningdate', 'connectiondate', 'registrationdate', 'createdate', 'startdate', 'activatedon'],
  'M.Bill':    ['mbill', 'monthlybill', 'billamount', 'monthlyfee', 'monthlycharge', 'monthlyrate', 'amount', 'fee', 'charge', 'packageprice', 'price', 'monthlyamount', 'billamt'],
};
const _normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS_TO_CANON = (() => {
  const m = {};
  for (const [canon, list] of Object.entries(HEADER_ALIASES)) {
    m[_normKey(canon)] = canon;
    for (const a of list) m[_normKey(a)] = canon;
  }
  return m;
})();
// header → canonical field। exact alias না মিললে গুরুত্বপূর্ণ field-এ contains-fallback
// (যেমন "Package Expire Date" / "Validity" → Exp.Date) যাতে তারিখ হারিয়ে না যায়।
function resolveCanon(cleanKey) {
  const nk = _normKey(cleanKey);
  if (ALIAS_TO_CANON[nk]) return ALIAS_TO_CANON[nk];
  if (/expir|validity|validtill|nextbill|duedate/.test(nk)) return 'Exp.Date';
  if (/billdate|billingdate|activat|joindate|connectiondate|registration/.test(nk)) return 'Bill.Date';
  if (/customerid|clientid|subscriberid|accountno|accountcode/.test(nk)) return 'Customer ID';
  return cleanKey;  // অজানা হলে যেমন আছে রাখি
}
// username-এর শেষ ৪ সংখ্যা → Customer ID (R3545001 → 5001)
function last4Digits(u) {
  const d = String(u || '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : d;
}
// যেকোনো তারিখ → YYYY-MM-DD। বিশেষ করে NetBillingBD-র "Jul 10 2026 01:00:52 +0600"
// (month-name + timezone) — timezone math এড়াতে সরাসরি month/day/year বের করি।
const _MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function toYMD(v) {
  if (!v) return '';
  const s = String(v).trim();
  // স্ট্রিং-এর যেকোনো জায়গায় YYYY-MM-DD (যেমন "Payment Date : 2026-05-10")
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // "Jul 10 2026 ..." বা "10 Jul 2026"
  m = s.match(/([A-Za-z]{3,})\s+(\d{1,2})[,\s]+(\d{4})/);              // Mon DD YYYY
  if (m && _MONTHS[m[1].slice(0, 3).toLowerCase()])
    return `${m[3]}-${_MONTHS[m[1].slice(0, 3).toLowerCase()]}-${String(m[2]).padStart(2, '0')}`;
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})[,\s]+(\d{4})/);              // DD Mon YYYY
  if (m && _MONTHS[m[2].slice(0, 3).toLowerCase()])
    return `${m[3]}-${_MONTHS[m[2].slice(0, 3).toLowerCase()]}-${String(m[1]).padStart(2, '0')}`;
  return s;   // DD/MM/YYYY ইত্যাদি — backend নিজেই পার্স করবে
}
// পূর্ণ তারিখ থেকে দিন (Bill.Date = বিলিং দিন ১–৩১); নইলে সংখ্যা যেমন আছে।
function toBillDay(v) {
  const ymd = toYMD(v);
  const m = ymd.match(/^\d{4}-\d{2}-(\d{2})/);
  if (m) return String(parseInt(m[1], 10));
  const n = parseInt(String(v || ''), 10);
  return (n >= 1 && n <= 31) ? String(n) : '';
}
// একটি কাঁচা row-এর সব header canonical field-এ map করে (প্রথম non-empty মান রাখে)।
function mapRowHeaders(rawRow) {
  const obj = {};
  for (const [k, v] of Object.entries(rawRow)) {
    const cleanKey = k.trim().replace(/\s*\*\s*$/, '');
    const val = v !== null && v !== undefined ? String(v).trim() : '';
    const canon = resolveCanon(cleanKey);
    if (!(canon in obj) || (!obj[canon] && val)) obj[canon] = val;
  }
  return obj;
}
// B.Status-এর বিভিন্ন রূপ (Enabled/1/Disabled ইত্যাদি) → Active/Inactive
function normStatus(v) {
  const s = String(v || '').toLowerCase().trim();
  if (!s) return v;
  if (['active', 'enabled', 'enable', 'online', 'running', '1', 'yes', 'true', 'on'].includes(s)) return 'Active';
  if (['inactive', 'disabled', 'disable', 'suspended', 'offline', 'expired', '0', 'no', 'false', 'off'].includes(s)) return 'Inactive';
  return v;
}

/* ─── Import result badge ────────────────────────────────────────── */
function RowStatus({ r }) {
  if (!r) return null;
  if (r.status === 'ok') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700">
          ✓ {r.customer_id}
        </span>
        <div className="flex gap-1 flex-wrap mt-0.5">
          <span className={`rounded px-1.5 text-[10px] font-medium ${r.radius   ? 'bg-blue-100 text-blue-700'   : 'bg-slate-100 text-slate-400'}`}>RADIUS</span>
          <span className={`rounded px-1.5 text-[10px] font-medium ${r.mikrotik ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-400'}`}>PPPoE</span>
          <span className={`rounded px-1.5 text-[10px] font-medium ${r.invoice  ? 'bg-amber-100 text-amber-700'  : 'bg-slate-100 text-slate-400'}`}>Invoice</span>
        </div>
      </div>
    );
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
      r.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
    }`}>
      ✗ {r.reason}
    </span>
  );
}

/* ─── Month Picker (Bill Month) ──────────────────────────────────────
 * Click করলে বছর-navigation + মাসের grid popup দেখায় — screenshot অনুযায়ী। */
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const POPUP_W = 224;   // w-56
const POPUP_H = 210;   // approx rendered height
function MonthPicker({ value, onChange, inputClass }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);   // {top, left}
  const boxRef = useRef(null);
  const popRef = useRef(null);

  // value ফরম্যাট: "MM-YYYY"
  const [selMonth, selYear] = (() => {
    const m = /^(\d{1,2})-(\d{4})$/.exec(value || '');
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [null, null];
  })();
  const [viewYear, setViewYear] = useState(selYear || new Date().getFullYear());

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);   // stale position এড়াতে বন্ধ করে দাও
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  const pick = (mIdx) => {
    onChange(`${String(mIdx + 1).padStart(2, '0')}-${viewYear}`);
    setOpen(false);
  };

  const toggleOpen = () => {
    if (open) { setOpen(false); return; }
    setViewYear(selYear || new Date().getFullYear());
    // viewport-এর সাপেক্ষে জায়গা হিসাব করে যেদিকে খালি সেদিকে খোলে (উপরে/নিচে/ডানে-বামে)
    if (boxRef.current) {
      const rect = boxRef.current.getBoundingClientRect();
      const openUp = window.innerHeight - rect.bottom < POPUP_H + 8 && rect.top > POPUP_H + 8;
      let left = rect.left;
      if (left + POPUP_W + 8 > window.innerWidth) left = window.innerWidth - POPUP_W - 8;
      if (left < 8) left = 8;
      const top = openUp ? rect.top - POPUP_H - 4 : rect.bottom + 4;
      setCoords({ top, left });
    }
    setOpen(true);
  };

  return (
    <div className="relative" ref={boxRef}>
      <input
        className={inputClass}
        readOnly
        value={value || ''}
        placeholder="MM-YYYY"
        onClick={toggleOpen}
      />
      {open && coords && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPUP_W }}
          className="z-[999] rounded-lg border border-slate-200 bg-white shadow-xl p-2"
        >
          <div className="flex items-center justify-between px-1 py-1 mb-1">
            <button type="button" onClick={() => setViewYear((y) => y - 1)}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 font-bold">«</button>
            <span className="text-sm font-bold text-slate-700">{viewYear}</span>
            <button type="button" onClick={() => setViewYear((y) => y + 1)}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 font-bold">»</button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTH_ABBR.map((m, i) => {
              const isSel = selMonth === i + 1 && selYear === viewYear;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(i)}
                  className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    isSel ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ─── Row Edit Modal ─────────────────────────────────────────────────
 * সিলেক্ট বক্সে ক্লিক করলে DB থেকে আনা Zone/Protocol/Package/Profile/Status
 * dropdown-এ দেখায় — ম্যানুয়ালি টাইপ করতে হয় না। */
function EditRowModal({ row, zones, protocols, packages, profiles, onCancel, onSubmit }) {
  const [vals, setVals] = useState({ ...row });
  const set = (k) => (e) => setVals((v) => ({ ...v, [k]: e.target.value }));

  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#1E3A5F] focus:ring-2 focus:ring-blue-50';
  const sel = inp + ' cursor-pointer';
  const lbl = 'text-[11px] font-semibold text-slate-500 uppercase tracking-wide';

  const handleSubmit = () => {
    if (!vals.Name?.trim()) { toast.error('Customer Name আবশ্যক।'); return; }
    if (!vals.UserName?.trim()) { toast.error('Username আবশ্যক।'); return; }

    const out = { ...vals };
    const day = parseInt(out['Exp.Date'], 10);
    if (day >= 1 && day <= 31) {
      // Bill Date আলাদা ঘর নেই — backend-এর bill_date (বিলিং দিন) Exp Date-এর দিন থেকেই নেওয়া হয়
      out['Bill.Date'] = String(day);
      // Bill Month সিলেক্ট করা থাকলে দিন + মাস মিলিয়ে আসল YYYY-MM-DD তৈরি করি
      // (শুধু দিন সংখ্যা পাঠালে backend-এর _parse_import_date তা parse করতে পারে না — expiry_date ফাঁকা থেকে যায়)
      if (out._billMonth) {
        const [mm, yyyy] = out._billMonth.split('-');
        const lastDay = new Date(parseInt(yyyy, 10), parseInt(mm, 10), 0).getDate();
        const d = Math.min(day, lastDay);
        out['Exp.Date'] = `${yyyy}-${mm}-${String(d).padStart(2, '0')}`;
      }
    }
    onSubmit(out);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-y-auto overflow-x-visible">
        <div className="sticky top-0 z-10 bg-[#1E3A5F] px-5 py-3 flex items-center justify-between">
          <h2 className="text-white font-bold text-sm">Importable Client Update</h2>
          <button onClick={onCancel} className="text-white/80 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="space-y-1"><label className={lbl}>Customer Name *</label>
            <input className={inp} value={vals.Name || ''} onChange={set('Name')} /></div>
          <div className="space-y-1"><label className={lbl}>Mobile Number</label>
            <input className={inp} value={vals.Mobile || ''} onChange={set('Mobile')} placeholder="01XXXXXXXXX" /></div>
          <div className="space-y-1"><label className={lbl}>Email</label>
            <input className={inp} value={vals.Email || ''} onChange={set('Email')} /></div>
          <div className="space-y-1"><label className={lbl}>Customer ID</label>
            <input className={inp} value={vals['Customer ID'] || ''} onChange={set('Customer ID')} /></div>

          <div className="space-y-1"><label className={lbl}>Zone</label>
            <select className={sel} value={vals.Zone || ''} onChange={set('Zone')}>
              <option value="">— Select Zone —</option>
              {zones.map((z) => <option key={z.id} value={z.name}>{z.name}</option>)}
            </select></div>
          <div className="space-y-1"><label className={lbl}>Conn. Type</label>
            <select className={sel} value={vals.Protocol || ''} onChange={set('Protocol')}>
              <option value="">— Select —</option>
              {protocols.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select></div>
          <div className="space-y-1"><label className={lbl}>Package</label>
            <select className={sel} value={vals.Package || ''} onChange={set('Package')}>
              <option value="">— Select Package —</option>
              {packages.map((p) => <option key={p.id} value={p.name}>{p.name}{p.price ? ` — ৳${p.price}` : ''}</option>)}
            </select></div>
          <div className="space-y-1"><label className={lbl}>Profile</label>
            {profiles.length > 0 ? (
              <select className={sel} value={vals.Profile || ''} onChange={set('Profile')}>
                <option value="">— Select Profile —</option>
                {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}{p.rate_limit ? ` (${p.rate_limit})` : ''}</option>)}
              </select>
            ) : (
              <input className={inp} value={vals.Profile || ''} onChange={set('Profile')} placeholder="Router নির্বাচন করলে dropdown দেখাবে" />
            )}</div>

          <div className="space-y-1"><label className={lbl}>Username *</label>
            <input className={inp} value={vals.UserName || ''} onChange={set('UserName')} /></div>
          <div className="space-y-1"><label className={lbl}>Password</label>
            <input className={inp} value={vals.Password || ''} onChange={set('Password')} /></div>
          <div className="space-y-1"><label className={lbl}>Billing Status</label>
            <select className={sel} value={vals['B.Status'] || ''} onChange={set('B.Status')}>
              <option value="">— Select —</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select></div>
          <div className="space-y-1"><label className={lbl}>Monthly Bill</label>
            <input className={inp} type="number" value={vals['M.Bill'] || ''} onChange={set('M.Bill')} /></div>

          <div className="space-y-1"><label className={lbl}>Bill Month</label>
            <MonthPicker inputClass={inp} value={vals._billMonth} onChange={(v) => setVals((p) => ({ ...p, _billMonth: v }))} /></div>
          <div className="space-y-1"><label className={lbl}>Exp. Date</label>
            <select className={sel} value={vals['Exp.Date'] || ''} onChange={set('Exp.Date')}>
              <option value="">Select</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select></div>
        </div>

        <div className="px-5 pb-5 flex justify-end gap-3">
          <button onClick={onCancel}
            className="px-5 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSubmit}
            className="px-5 py-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700">
            ✓ Submit
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────── */
export default function BulkClientImportPage() {
  const fileRef = useRef(null);
  const [rows, setRows]         = useState([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);   // {done,total}
  const [result, setResult]     = useState(null);
  const [search, setSearch]     = useState('');
  const [show, setShow]         = useState('All');
  const [colFilters, setColFilters] = useState({});   // প্রতি কলামের filter মান
  const [showColFilters, setShowColFilters] = useState(false);

  /* ── Target router + default package/profile ────────────────── */
  const [servers, setServers]         = useState([]);
  const [packages, setPackages]       = useState([]);
  const [zones, setZones]             = useState([]);
  const [protocols, setProtocols]     = useState([]);
  const [editProfiles, setEditProfiles] = useState([]);   // Edit modal-এর Profile dropdown (importRouter অনুযায়ী)
  const [importRouter, setImportRouter]   = useState('');   // কোন router-এ import
  const [importPackage, setImportPackage] = useState('');   // default package (optional)

  useEffect(() => {
    const L = (d) => d.data?.results || d.data || [];
    api.get('/mikrotik/servers/').then((d) => {
      const list = L(d);
      setServers(list);
      if (list.length === 1) setImportRouter(String(list[0].id));   // একটাই হলে auto
    }).catch(() => {});
    api.get('/config/packages/').then((d) => setPackages(L(d))).catch(() => {});
    api.get('/config/zones/?is_active=true').then((d) => setZones(L(d))).catch(() => {});
    api.get('/config/protocol-types/?is_active=true').then((d) => setProtocols(L(d))).catch(() => {});
  }, []);

  // ── Edit modal-এর Profile dropdown — নির্বাচিত router-এর PPPoE profile list ──
  useEffect(() => {
    if (!importRouter) { setEditProfiles([]); return; }
    api.get(`/mikrotik/servers/${importRouter}/pppoe-profiles/`)
      .then((d) => setEditProfiles(d.data?.profiles || []))
      .catch(() => setEditProfiles([]));
  }, [importRouter]);

  /* ── Row selection (Set of indices into rows[]) ─────────────── */
  const [selected, setSelected] = useState(new Set());

  /* ── Download Sample Excel ──────────────────────────────────── */
  const downloadSample = async () => {
    try {
      const res = await api.get('/clients/bulk-import-sample/', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'bulk_import_sample.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Sample download failed.'); }
  };

  /* ── Upload & parse Excel ───────────────────────────────────── */
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb  = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
        if (!raw.length) { toast.error('Excel ফাইলে কোনো data নেই।'); return; }
        const normalized = raw.map((r) => {
          const obj = mapRowHeaders(r);   // যেকোনো সফটওয়্যারের header auto-map
          if ('B.Status' in obj) obj['B.Status'] = normStatus(obj['B.Status']);
          // Exp.Date (Package Expiration Time) → YYYY-MM-DD
          if (obj['Exp.Date']) obj['Exp.Date'] = toYMD(obj['Exp.Date']);
          // Bill.Date source = Registration/Joining/Payment date।
          // full তারিখ joining হিসেবে _joining-এ রাখি, আর দিন Bill.Date-এ।
          if (obj['Bill.Date']) {
            const _jy = toYMD(obj['Bill.Date']);
            if (/^\d{4}-\d{2}-\d{2}/.test(_jy)) obj['_joining'] = _jy.slice(0, 10);
            obj['Bill.Date'] = toBillDay(obj['Bill.Date']);
          }
          // খালি হলে (যেমন "Free Customer") → Exp.Date-এর দিন থেকে নাও
          if (!obj['Bill.Date'] && obj['Exp.Date']) {
            const _m = String(obj['Exp.Date']).match(/^\d{4}-\d{2}-(\d{2})/);
            if (_m) obj['Bill.Date'] = String(parseInt(_m[1], 10));
          }
          // Customer ID = username-এর শেষ ৪ সংখ্যা (R3545001 → 5001)
          const cid = last4Digits(obj['UserName']);
          if (cid) obj['Customer ID'] = cid;
          return obj;
        }).filter((r) => Object.values(r).some(Boolean));

        const startIdx = rows.length;
        setRows((prev) => [...prev, ...normalized]);
        // নতুন rows স্বয়ংক্রিয়ভাবে সিলেক্ট হবে
        setSelected((prev) => {
          const n = new Set(prev);
          for (let i = 0; i < normalized.length; i++) n.add(startIdx + i);
          return n;
        });
        toast.success(`${normalized.length} টি row লোড ও সিলেক্ট হয়েছে।`);
        markAlreadyImported(normalized, startIdx);   // 'already imported' badge
      } catch { toast.error('Excel পার্স করতে সমস্যা হয়েছে।'); }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  /* ── ইতিমধ্যে import করা username চিহ্নিত করা (badge + auto-deselect) ── */
  const markAlreadyImported = async (newRows, startIdx) => {
    const names = newRows.map((r) => r.UserName).filter(Boolean);
    if (!names.length) return;
    try {
      const res = await api.post('/clients/check-existing/', { usernames: names });
      const exSet = new Set(res.data?.existing || []);
      if (!exSet.size) return;
      setRows((prev) => prev.map((r, i) =>
        (i >= startIdx && exSet.has(r.UserName)) ? { ...r, _exists: true } : r));
      // যেগুলো আগে থেকেই আছে সেগুলো deselect (পুনরায় import এড়াতে)
      setSelected((prev) => {
        const n = new Set(prev);
        newRows.forEach((r, i) => { if (exSet.has(r.UserName)) n.delete(startIdx + i); });
        return n;
      });
    } catch { /* badge ঐচ্ছিক — ব্যর্থ হলে চুপ */ }
  };

  /* ── MikroTik secret list থেকে load ─────────────────────────── */
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const loadFromMikrotik = async () => {
    if (!importRouter) { toast.error('আগে Target MikroTik Router নির্বাচন করুন।'); return; }
    setLoadingSecrets(true); setResult(null);
    try {
      const res = await api.get(`/mikrotik/servers/${importRouter}/pppoe-secrets/`);
      const got = res.data?.rows || [];
      if (!got.length) { toast.error('এই router-এ কোনো PPPoE secret পাওয়া যায়নি।'); return; }
      const startIdx = rows.length;
      setRows((prev) => [...prev, ...got]);
      // ইতিমধ্যে DB-তে নেই (_exists=false) এমন row-ই auto-select হবে
      setSelected((prev) => {
        const n = new Set(prev);
        got.forEach((r, i) => { if (!r._exists) n.add(startIdx + i); });
        return n;
      });
      const fresh = got.filter((r) => !r._exists).length;
      toast.success(`${got.length} টি secret লোড — ${fresh} টি নতুন সিলেক্ট (${got.length - fresh} টি ইতিমধ্যে আছে)।`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Secret লোড ব্যর্থ — router সংযোগ চেক করুন।');
    } finally { setLoadingSecrets(false); }
  };

  /* ── Clear All ──────────────────────────────────────────────── */
  const clearAll = () => {
    setRows([]); setSelected(new Set()); setResult(null);
    toast('সব data মুছে ফেলা হয়েছে।');
  };

  /* ── Download Edited ────────────────────────────────────────── */
  const downloadEdited = () => {
    if (!rows.length) { toast.error('কোনো data নেই।'); return; }
    const ws = XLSX.utils.json_to_sheet(rows, { header: ALL_COLS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clients');
    XLSX.writeFile(wb, 'edited_clients.xlsx');
  };

  /* ── Import selected rows ───────────────────────────────────── */
  const importClients = async () => {
    if (selected.size === 0) {
      toast.error('আগে import করতে চাওয়া row সিলেক্ট করুন।');
      return;
    }
    if (servers.length > 0 && !importRouter) {
      toast.error('আগে Target MikroTik Router নির্বাচন করুন।');
      return;
    }
    // sorted index list → ordered rows
    const selIdxArr = [...selected].sort((a, b) => a - b);
    const toImport  = selIdxArr.map((i) => rows[i]);

    // ── Pre-import validation ────────────────────────────────────────
    const BD_PHONE = /^01[3-9]\d{8}$/;
    const invalidRows = [];
    toImport.forEach((row, idx) => {
      const rowNum = selIdxArr[idx] + 1;
      if (!row.UserName?.trim())
        invalidRows.push(`Row ${rowNum}: Username খালি।`);
      const ph = (row.Mobile || row.Phone || '').toString().trim();
      if (ph && !BD_PHONE.test(ph))
        invalidRows.push(`Row ${rowNum} (${row.UserName}): মোবাইল নম্বর "${ph}" সঠিক নয় — ১১ সংখ্যার 01XXXXXXXXX হতে হবে।`);
    });
    if (invalidRows.length > 0) {
      invalidRows.slice(0, 5).forEach(msg => toast.error(msg, { duration: 5000 }));
      if (invalidRows.length > 5)
        toast.error(`আরও ${invalidRows.length - 5}টি validation error আছে।`, { duration: 5000 });
      return;
    }

    // ── ছোট batch-এ ভাগ করে পাঠাই — প্রতিটি client-এ RADIUS+MikroTik+invoice
    //    synchronous; বড় ব্যাচ একসাথে পাঠালে gunicorn 120s timeout পার হয়।
    //    batch-ভিত্তিক করায় প্রতিটি request দ্রুত শেষ হয় + live progress দেখায়।
    const BATCH = 20;
    setImporting(true); setResult(null);
    let allResults = [];
    let success = 0, failed = 0, total = 0;
    try {
      for (let start = 0; start < toImport.length; start += BATCH) {
        const chunk    = toImport.slice(start, start + BATCH);
        const chunkIdx = selIdxArr.slice(start, start + BATCH);
        setImportProgress({ done: start, total: toImport.length });
        const res = await api.post('/clients/bulk-import/', {
          rows: chunk,
          router_id:  importRouter || null,
          package_id: importPackage || null,
        });
        const remapped = (res.data.results || []).map((r) => ({
          ...r, row: chunkIdx[r.row - 1] + 1,
        }));
        allResults = allResults.concat(remapped);
        success += res.data.success || 0;
        failed  += res.data.failed  || 0;
        total   += res.data.total   || 0;
        // প্রতিটি batch শেষে live result update
        setResult({ success, failed, total, results: allResults });
      }
      setImportProgress({ done: toImport.length, total: toImport.length });
      if (success > 0) toast.success(`${success} client import সফল${failed ? `, ${failed} skip/ব্যর্থ` : ''}।`);
      else toast.error('কোনো client import হয়নি।');
    } catch (err) {
      // আংশিক সফল হলেও যা হয়েছে তা দেখাই
      if (allResults.length) setResult({ success, failed, total, results: allResults });
      toast.error((err.response?.data?.error || 'Import বন্ধ হয়েছে') +
        ` — ${success} টি সম্পন্ন হয়েছে। বাকিগুলো আবার Import করুন।`);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  /* ── Row edit modal ─────────────────────────────────────────── */
  const [editIdx, setEditIdx] = useState(null);   // rows[]-এ যে index edit হচ্ছে
  const saveEditedRow = (vals) => {
    setRows((prev) => prev.map((r, i) => (i === editIdx ? { ...r, ...vals } : r)));
    setEditIdx(null);
    toast.success('Row আপডেট হয়েছে।');
  };

  /* ── Delete a row ───────────────────────────────────────────── */
  const deleteRow = (ri) => {
    setRows((prev) => prev.filter((_, i) => i !== ri));
    setSelected((prev) => {
      const n = new Set();
      prev.forEach((i) => { if (i < ri) n.add(i); else if (i > ri) n.add(i - 1); });
      return n;
    });
    setResult(null);
    toast('Row মুছে ফেলা হয়েছে।');
  };

  /* ── Filtered & paginated ───────────────────────────────────── */
  // কম-বৈচিত্র্যের কলামে dropdown, বাকিগুলোতে text (contains) filter
  const SELECT_COLS = ['Zone', 'Protocol', 'Package', 'Profile', 'B.Status'];
  const distinctVals = (col) => {
    const s = new Set();
    rows.forEach((r) => { const v = String(r[col] ?? '').trim(); if (v) s.add(v); });
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };
  const activeColFilters = Object.entries(colFilters).filter(([, v]) => String(v).trim() !== '');
  const setCol = (col, val) => setColFilters((p) => ({ ...p, [col]: val }));
  const clearColFilters = () => setColFilters({});

  const q        = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (q && !Object.values(r).some((v) => String(v).toLowerCase().includes(q))) return false;
    for (const [col, val] of activeColFilters) {
      const cell = String(r[col] ?? '').toLowerCase();
      const fv   = String(val).toLowerCase().trim();
      if (SELECT_COLS.includes(col)) { if (cell !== fv) return false; }       // exact match
      else if (!cell.includes(fv)) return false;                              // contains
    }
    return true;
  });
  const pageSize  = show === 'All' ? filtered.length : parseInt(show, 10);
  const displayed = filtered.slice(0, pageSize);

  /* ── Checkbox: select all (visible rows) ────────────────────── */
  const dispIdxs   = displayed.map((r) => rows.indexOf(r));
  const allSel     = dispIdxs.length > 0 && dispIdxs.every((i) => selected.has(i));
  const someSel    = dispIdxs.some((i) => selected.has(i));

  const toggleAll = () => {
    if (allSel) {
      setSelected((prev) => { const n = new Set(prev); dispIdxs.forEach((i) => n.delete(i)); return n; });
    } else {
      setSelected((prev) => { const n = new Set(prev); dispIdxs.forEach((i) => n.add(i)); return n; });
    }
  };
  const toggleOne = (ri) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(ri) ? n.delete(ri) : n.add(ri);
      return n;
    });
  };

  /* ── resultMap: global 1-based row → result ─────────────────── */
  const resultMap = {};
  (result?.results || []).forEach((r) => { resultMap[r.row] = r; });

  const selCount = selected.size;

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Bulk Clients Import</h1>
        <p className="text-sm text-slate-500">
          Excel upload করুন → যতটি row import করতে চান select করুন → Import করুন।
          RADIUS, PPPoE ও Invoice স্বয়ংক্রিয়ভাবে তৈরি হবে।
        </p>
      </div>

      {/* ── Column Legend ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs">
        <span className="font-semibold text-slate-600">Column Legend:</span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded px-2 py-0.5 bg-[#1E3A5F] text-white font-semibold">Name *</span>
          <span className="text-slate-500">Required</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded px-2 py-0.5 bg-[#D6E4F0] text-[#1E3A5F] font-semibold">Email</span>
          <span className="text-slate-500">Optional</span>
        </span>
        <span className="inline-flex items-center gap-1 ml-4">
          <span className="rounded px-1.5 bg-blue-100 text-blue-700 font-medium">RADIUS</span>
          <span className="rounded px-1.5 bg-purple-100 text-purple-700 font-medium">PPPoE</span>
          <span className="rounded px-1.5 bg-amber-100 text-amber-700 font-medium">Invoice</span>
          <span className="text-slate-500">— import পর status</span>
        </span>
      </div>

      {/* ── Target Router + Default Package ────────────────────── */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">
            Target MikroTik Router <span className="text-red-500">*</span>
          </label>
          <select value={importRouter} onChange={(e) => setImportRouter(e.target.value)}
            className={`rounded-lg border px-3 py-2 text-sm min-w-[220px] ${
              importRouter ? 'border-slate-300 text-slate-800' : 'border-amber-300 bg-amber-50 text-slate-600'}`}>
            <option value="">— Router নির্বাচন করুন —</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="text-[11px] text-slate-400">এই router-এ সব নির্বাচিত client import হবে</span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">Default Package (optional)</label>
          <select value={importPackage} onChange={(e) => setImportPackage(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-[220px] text-slate-800">
            <option value="">— Excel-এর Package অনুযায়ী —</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.price ? ` — ৳${p.price}` : ''}{p.mikrotik_profile ? ` (${p.mikrotik_profile})` : ''}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-400">Excel-এর package না মিললে এই package/profile/bill বসবে</span>
        </div>

        {/* MikroTik secret list থেকে সরাসরি load */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-600">অথবা — Router-এর Secret থেকে</label>
          <button onClick={loadFromMikrotik} disabled={!importRouter || loadingSecrets}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
              importRouter && !loadingSecrets ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300 cursor-not-allowed'}`}>
            {loadingSecrets
              ? <><svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> লোড হচ্ছে…</>
              : <><svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H6a2 2 0 00-2 2z" /></svg> Load PPPoE Secrets</>}
          </button>
          <span className="text-[11px] text-slate-400">নির্বাচিত router-এর secret list টেবিলে আসবে</span>
        </div>
      </div>

      {/* ── Action Bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">

        {/* Left: Download + Clear */}
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadSample}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Sample Excel
          </button>
          <button onClick={clearAll}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear All
          </button>
          <button onClick={downloadEdited}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Edited Data
          </button>
        </div>

        {/* Center: Upload Excel */}
        <div className="flex flex-col items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
          <button onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-6 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Importable Clients (Excel)
          </button>
        </div>

        {/* Right: Import Selected */}
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={importClients}
            disabled={importing || selCount === 0}
            className={`inline-flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-semibold text-white transition-colors ${
              selCount > 0
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-slate-300 cursor-not-allowed'
            } disabled:opacity-60`}
          >
            {importing
              ? <><svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg> {importProgress ? `Importing… ${importProgress.done}/${importProgress.total}` : 'Importing…'}</>
              : <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Import Selected
                  {selCount > 0 && (
                    <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
                      {selCount}
                    </span>
                  )}
                </>
            }
          </button>
          {importing && importProgress
            ? <span className="text-xs font-semibold text-indigo-600">{importProgress.done}/{importProgress.total} সম্পন্ন…</span>
            : selCount > 0 && (
              <span className="text-xs text-slate-500">{selCount} টি row সিলেক্ট করা হয়েছে</span>
            )}
        </div>
      </div>

      {/* ── Import Result ───────────────────────────────────────── */}
      {result && (
        <div className={`rounded-lg border p-4 ${result.success > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold text-slate-800">Import Result:</span>
            <span className="rounded-full bg-emerald-600 text-white px-3 py-0.5 text-sm font-bold">✓ {result.success} সফল</span>
            {result.failed > 0 && (
              <span className="rounded-full bg-red-500 text-white px-3 py-0.5 text-sm font-bold">✗ {result.failed} ব্যর্থ</span>
            )}
            <span className="text-sm text-slate-500">মোট চেষ্টা: {result.total}</span>
          </div>
        </div>
      )}

      {/* ── DataTable ──────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white">

        {/* Table Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>SHOW</span>
            <select value={show} onChange={(e) => setShow(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm">
              {['10', '25', '50', '100', 'All'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <span>ENTRIES</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">মোট: <strong>{rows.length}</strong></span>
            {selCount > 0 && (
              <span className="rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-xs font-semibold">
                {selCount} সিলেক্ট
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <button onClick={() => setShowColFilters((s) => !s)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                showColFilters || activeColFilters.length
                  ? 'bg-[#1E3A5F] text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L14 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 018 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              Column Filters
              {activeColFilters.length > 0 && (
                <span className="ml-1 rounded-full bg-white/25 px-1.5 text-[10px] font-bold">{activeColFilters.length}</span>
              )}
            </button>
            {activeColFilters.length > 0 && (
              <button onClick={clearColFilters}
                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">
                ✕ Clear
              </button>
            )}
            <span className="ml-1">SEARCH:</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-left">
              <tr>
                {/* Checkbox header */}
                <th className="px-3 py-2 bg-slate-800 text-white w-8">
                  <input
                    type="checkbox"
                    checked={allSel}
                    ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded border-slate-400 accent-emerald-500 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2 whitespace-nowrap bg-slate-800 text-white">#</th>
                {result && <th className="px-3 py-2 whitespace-nowrap bg-slate-800 text-white">Status</th>}
                {ALL_COLS.map((c) => {
                  const req = REQUIRED_SET.has(c);
                  return (
                    <th key={c} className={`px-3 py-2 whitespace-nowrap ${req ? 'bg-[#1E3A5F] text-white' : 'bg-[#D6E4F0] text-[#1E3A5F]'}`}>
                      {c}{req && <span className="ml-0.5 text-blue-300 text-[10px]">*</span>}
                    </th>
                  );
                })}
                <th className="px-3 py-2 whitespace-nowrap bg-slate-700 text-white">Action</th>
              </tr>

              {/* ── Per-column filter row ── */}
              {showColFilters && (
                <tr className="bg-slate-50">
                  <th className="px-2 py-1.5 border-b border-slate-200"></th>
                  <th className="px-2 py-1.5 border-b border-slate-200"></th>
                  {result && <th className="px-2 py-1.5 border-b border-slate-200"></th>}
                  {ALL_COLS.map((c) => (
                    <th key={c} className="px-2 py-1.5 border-b border-slate-200 font-normal">
                      {SELECT_COLS.includes(c) ? (
                        <select value={colFilters[c] || ''} onChange={(e) => setCol(c, e.target.value)}
                          className="w-full min-w-[80px] rounded border border-slate-300 px-1.5 py-1 text-[11px] text-slate-700">
                          <option value="">All</option>
                          {distinctVals(c).map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input value={colFilters[c] || ''} onChange={(e) => setCol(c, e.target.value)}
                          placeholder="filter…"
                          className="w-full min-w-[70px] rounded border border-slate-300 px-1.5 py-1 text-[11px] text-slate-700 placeholder-slate-300" />
                      )}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 border-b border-slate-200 text-center">
                    {activeColFilters.length > 0 && (
                      <button onClick={clearColFilters} title="Clear column filters"
                        className="text-red-500 hover:text-red-700 text-sm font-bold">✕</button>
                    )}
                  </th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={ALL_COLS.length + (result ? 4 : 3)}
                    className="py-12 text-center text-sm text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="h-10 w-10 text-slate-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      Sample Excel download করুন, পূরণ করে upload করুন।
                    </div>
                  </td>
                </tr>
              ) : (
                displayed.map((row, dispIdx) => {
                  const ri     = dispIdxs[dispIdx];
                  const rowNum = ri + 1;
                  const res    = resultMap[rowNum];
                  const isSel  = selected.has(ri);
                  const done   = res?.status === 'ok';
                  const exists = row._exists || res?.reason?.includes('ইতোমধ্যে');

                  return (
                    <tr
                      key={ri}
                      onClick={() => toggleOne(ri)}
                      className={`cursor-pointer transition-colors ${
                        isSel      ? 'bg-emerald-50 hover:bg-emerald-100' :
                        res?.status === 'error' ? 'bg-red-50 hover:bg-red-100' :
                        res?.status === 'skip'  ? 'bg-amber-50 hover:bg-amber-100' :
                        exists     ? 'bg-slate-100 text-slate-400 hover:bg-slate-200' :
                        'hover:bg-slate-50'
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleOne(ri)}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-400 select-none whitespace-nowrap">
                        {rowNum}
                        {exists && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 align-middle"
                            title="এই client ইতিমধ্যে import করা হয়েছে">
                            ✓ Imported
                          </span>
                        )}
                      </td>
                      {result && (
                        <td className="px-3 py-2 whitespace-nowrap align-top" onClick={(e) => e.stopPropagation()}>
                          <RowStatus r={res} />
                        </td>
                      )}
                      {ALL_COLS.map((col) => (
                        <td key={col} className={`px-3 py-2 whitespace-nowrap max-w-[160px] truncate ${
                          REQUIRED_SET.has(col) ? 'text-slate-800 font-medium' : 'text-slate-500'
                        }`}>
                          {row[col] ?? ''}
                        </td>
                      ))}
                      {/* Edit + Delete */}
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {!done ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => setEditIdx(ri)} title="Edit row"
                              className="rounded p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors">
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button onClick={() => deleteRow(ri)} title="Delete row"
                              className="rounded p-1 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-emerald-600 font-semibold">✓</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
          <span>Showing 1–{displayed.length} of {filtered.length} entries</span>
          <div className="flex gap-1">
            <button className="rounded border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50">Previous</button>
            <button className="rounded border border-blue-500 bg-blue-500 px-3 py-1 text-xs font-bold text-white">1</button>
            <button className="rounded border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50">Next</button>
          </div>
        </div>
      </div>

      {/* ── Row Edit Modal ─────────────────────────────────────── */}
      {editIdx !== null && rows[editIdx] && (
        <EditRowModal
          row={rows[editIdx]}
          zones={zones}
          protocols={protocols}
          packages={packages}
          profiles={editProfiles}
          onCancel={() => setEditIdx(null)}
          onSubmit={saveEditedRow}
        />
      )}
    </div>
  );
}
