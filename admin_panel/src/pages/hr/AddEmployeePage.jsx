// Add / Edit Employee — পূর্ণ পেজ ফর্ম (স্ক্রিনশট অনুযায়ী)
import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ─── Design tokens ─────────────────────────────────────────────────────── */
const inp = [
  'w-full border border-gray-300 rounded-md px-3 py-[7px] text-sm',
  'bg-white text-gray-800 placeholder-gray-400',
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
  'transition-all duration-150',
].join(' ');
const sel = `${inp} appearance-none cursor-pointer`;
const textarea = `${inp} resize-none`;

/* ─── Empty form state ──────────────────────────────────────────────────── */
const EMPTY = {
  // Basic Info
  full_name: '', phone: '', office_contact: '', guardian_contact: '',
  date_of_birth: '', gender: '', marital_status: '', nid: '',
  email: '', facebook_link: '', reference: '', district: '', upazila: '',
  working_experience: '', present_address: '', permanent_address: '',
  // Attendance
  punch_card_id: '', in_time: '', out_time: '',
  // Education
  last_degree: '', institution: '', passing_year: '',
  // Posting
  join_date: '', department: '', position: '', designation: '', basic_salary: '',
  status: 'active', photo: null,
};

/* ─── Helper components ─────────────────────────────────────────────────── */
function SectionCard({ icon, title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
      {/* Card header */}
      <div style={{ backgroundColor: '#23445f', borderBottom: '1px solid #24364d' }} className="flex items-center gap-2.5 px-5 py-3.5">
        <span className="text-white/70 text-base">{icon}</span>
        <h2 className="text-sm font-semibold text-white uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function FieldLabel({ children, required }) {
  return (
    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-0.5 normal-case">*</span>}
    </label>
  );
}

function Field({ label, required, children, colSpan = '' }) {
  return (
    <div className={colSpan}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
    </div>
  );
}

/* ─── Bangladesh Districts ──────────────────────────────────────────────── */
const BD_DISTRICTS = [
  'Bagerhat','Bandarban','Barguna','Barishal','Bhola','Bogura','Brahmanbaria',
  'Chandpur','Chapai Nawabganj','Chattogram','Chuadanga','Cox\'s Bazar',
  'Cumilla','Dhaka','Dinajpur','Faridpur','Feni','Gaibandha','Gazipur',
  'Gopalganj','Habiganj','Jamalpur','Jashore','Jhalokathi','Jhenaidah',
  'Joypurhat','Khagrachari','Khulna','Kishoreganj','Kurigram','Kushtia',
  'Lakshmipur','Lalmonirhat','Madaripur','Magura','Manikganj','Meherpur',
  'Moulvibazar','Munshiganj','Mymensingh','Naogaon','Narail','Narayanganj',
  'Narsingdi','Natore','Netrokona','Nilphamari','Noakhali','Pabna',
  'Panchagarh','Patuakhali','Pirojpur','Rajbari','Rajshahi','Rangamati',
  'Rangpur','Satkhira','Shariatpur','Sherpur','Sirajganj','Sunamganj',
  'Sylhet','Tangail','Thakurgaon',
];

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function AddEmployeePage() {
  const navigate   = useNavigate();
  const { id }     = useParams();
  const isEdit     = Boolean(id);

  const [form,        setForm]        = useState({ ...EMPTY, join_date: new Date().toISOString().slice(0, 10) });
  const [departments, setDepartments] = useState([]);
  const [positions,   setPositions]   = useState([]);
  const [loading,     setLoading]     = useState(isEdit);
  const [saving,      setSaving]      = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);

  /* Fetch departments */
  const fetchDepts = useCallback(async () => {
    try {
      const res = await api.get('/hr/departments/?page_size=200');
      setDepartments(res.data.results || res.data);
    } catch { /* silent */ }
  }, []);

  /* Fetch positions */
  const fetchPositions = useCallback(async () => {
    try {
      const res = await api.get('/hr/positions/?status=active&page_size=200');
      setPositions(res.data.results || res.data);
    } catch { /* silent */ }
  }, []);

  /* Fetch employee if editing */
  const fetchEmployee = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/hr/employees/${id}/`);
      const d   = res.data;
      setForm({
        full_name:          d.full_name || '',
        phone:              d.phone || '',
        office_contact:     d.office_contact || '',
        guardian_contact:   d.guardian_contact || '',
        date_of_birth:      d.date_of_birth || '',
        gender:             d.gender || '',
        marital_status:     d.marital_status || '',
        nid:                d.nid || '',
        email:              d.email || '',
        facebook_link:      d.facebook_link || '',
        reference:          d.reference || '',
        district:           d.district || '',
        upazila:            d.upazila || '',
        working_experience: d.working_experience || '',
        present_address:    d.present_address || '',
        permanent_address:  d.permanent_address || '',
        punch_card_id:      d.punch_card_id || '',
        in_time:            d.in_time || '',
        out_time:           d.out_time || '',
        last_degree:        d.last_degree || '',
        institution:        d.institution || '',
        passing_year:       d.passing_year || '',
        join_date:          d.join_date || '',
        department:         d.department || '',
        position:           d.position || '',
        designation:        d.designation || '',
        basic_salary:       d.basic_salary || '',
        status:             d.status || 'active',
        photo:              null,
      });
      if (d.photo) setPhotoPreview(d.photo);
    } catch {
      toast.error('Failed to load employee data.');
      navigate('/hr/employees');
    } finally { setLoading(false); }
  }, [id, navigate]);

  useEffect(() => {
    fetchDepts();
    fetchPositions();
    if (isEdit) fetchEmployee();
  }, [fetchDepts, fetchPositions, fetchEmployee, isEdit]);

  /* Field setter */
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  /* Photo change */
  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Photo must be under 2 MB.'); return; }
    setForm(f => ({ ...f, photo: file }));
    setPhotoPreview(URL.createObjectURL(file));
  };

  /* Submit */
  const handleSubmit = async () => {
    // Validation
    if (!form.full_name.trim())   { toast.error('Employee name is required.'); return; }
    if (!form.phone.trim())       { toast.error('Personal contact number is required.'); return; }
    if (!form.join_date)          { toast.error('Join date is required.'); return; }
    if (!form.designation.trim()) { toast.error('Designation is required.'); return; }

    setSaving(true);
    try {
      // Use FormData for photo upload support
      // empty string পাঠালে TimeField/DateField/Choice ফিল্ডে validation error হয়
      // তাই শুধু actual value-ই পাঠানো হয়
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'photo') {
          if (v instanceof File) fd.append('photo', v);
        } else if (v !== null && v !== undefined && v !== '') {
          fd.append(k, v);
        }
      });

      if (isEdit) {
        await api.patch(`/hr/employees/${id}/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Employee updated successfully.');
      } else {
        await api.post('/hr/employees/', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('New employee added successfully.');
      }
      navigate('/hr/employees');
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') {
        Object.entries(d).forEach(([k, v]) => toast.error(`${k}: ${Array.isArray(v) ? v[0] : v}`));
      } else {
        toast.error('Failed to save.');
      }
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">

      {/* ── Breadcrumb + Header ── */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1.5">
            <Link to="/" className="hover:text-blue-500 transition">Home</Link>
            <span>›</span>
            <Link to="/hr/employees" className="hover:text-blue-500 transition">HR &amp; Payroll</Link>
            <span>›</span>
            <span className="text-gray-600 font-medium">{isEdit ? 'Edit Employee' : 'Add Employee'}</span>
          </div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100 text-blue-600 text-sm">
              👤
            </span>
            Employee
            <span className="text-sm font-normal text-gray-500 ml-1">
              {isEdit ? 'Edit Employee' : 'Add New Employee'}
            </span>
          </h1>
        </div>
        {/* Breadcrumb right */}
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <span className="text-blue-500 font-medium">HR &amp; PAYROLL</span>
          <span>›</span>
          <span>{isEdit ? 'Edit Employee' : 'Add Employee'}</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          SECTION 1 — Basic Information
      ══════════════════════════════════════════════════════════════ */}
      <SectionCard icon="🧑" title="Basic Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-4">

          <Field label="Employee Name" required>
            <input className={inp} placeholder="Full Name"
              value={form.full_name} onChange={set('full_name')} />
          </Field>

          <Field label="Date of Birth">
            <input className={inp} type="date" placeholder="MM/DD/YY"
              value={form.date_of_birth} onChange={set('date_of_birth')} />
          </Field>

          <Field label="Gender">
            <select className={sel} value={form.gender} onChange={set('gender')}>
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>

          <Field label="Personal Contact No." required>
            <input className={inp} type="tel" placeholder="01XXXXXXXXX"
              value={form.phone} onChange={set('phone')} />
          </Field>

          <Field label="Office Contact No." required={false}>
            <input className={inp} type="tel" placeholder="01XXXXXXXXX"
              value={form.office_contact} onChange={set('office_contact')} />
          </Field>

          <Field label="Guardian Contact No.">
            <input className={inp} type="tel" placeholder="01XXXXXXXXX"
              value={form.guardian_contact} onChange={set('guardian_contact')} />
          </Field>

          <Field label="Marital Status">
            <select className={sel} value={form.marital_status} onChange={set('marital_status')}>
              <option value="">Select</option>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="divorced">Divorced</option>
              <option value="widowed">Widowed</option>
            </select>
          </Field>

          <Field label="NID Number / Birth Certificate">
            <input className={inp} placeholder="NID Number"
              value={form.nid} onChange={set('nid')} />
          </Field>

          <Field label="Email">
            <input className={inp} type="email" placeholder="email@example.com"
              value={form.email} onChange={set('email')} />
          </Field>

          <Field label="Facebook ID Link">
            <input className={inp} placeholder="https://facebook.com/..."
              value={form.facebook_link} onChange={set('facebook_link')} />
          </Field>

          <Field label="Reference">
            <input className={inp} placeholder="Reference person name"
              value={form.reference} onChange={set('reference')} />
          </Field>

          <Field label="District">
            <select className={sel} value={form.district} onChange={set('district')}>
              <option value="">Select</option>
              {BD_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>

          <Field label="Upazila">
            <input className={inp} placeholder="Upazila / Thana"
              value={form.upazila} onChange={set('upazila')} />
          </Field>

          {/* Textareas — full row */}
          <Field label="Working Experience" colSpan="sm:col-span-2 md:col-span-2 lg:col-span-2">
            <textarea className={`${textarea} h-20`} placeholder="Previous work experience..."
              value={form.working_experience} onChange={set('working_experience')} />
          </Field>

          <Field label="Present Address" colSpan="sm:col-span-2 md:col-span-1 lg:col-span-2">
            <textarea className={`${textarea} h-20`} placeholder="Present address"
              value={form.present_address} onChange={set('present_address')} />
          </Field>

          <Field label="Permanent Address" colSpan="sm:col-span-2 md:col-span-3 lg:col-span-4">
            <textarea className={`${textarea} h-20`} placeholder="Permanent address"
              value={form.permanent_address} onChange={set('permanent_address')} />
          </Field>

        </div>
      </SectionCard>

      {/* ══════════════════════════════════════════════════════════════
          SECTION 2 — Attendance Information
      ══════════════════════════════════════════════════════════════ */}
      <SectionCard icon="🕐" title="Attendance Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-4">

          <Field label="Device">
            <select className={sel} value="" onChange={() => {}}>
              <option value="">Select Device</option>
              <option value="biometric">Biometric</option>
              <option value="card">Card Reader</option>
              <option value="mobile">Mobile App</option>
              <option value="manual">Manual</option>
            </select>
          </Field>

          <Field label="Punch Card ID">
            <input className={inp} placeholder="Card / Badge ID"
              value={form.punch_card_id} onChange={set('punch_card_id')} />
          </Field>

          <Field label="In Time" required>
            <input className={inp} type="time"
              value={form.in_time} onChange={set('in_time')} />
          </Field>

          <Field label="Out Time" required>
            <input className={inp} type="time"
              value={form.out_time} onChange={set('out_time')} />
          </Field>

        </div>
      </SectionCard>

      {/* ══════════════════════════════════════════════════════════════
          SECTION 3 — Educational Qualification
      ══════════════════════════════════════════════════════════════ */}
      <SectionCard icon="🎓" title="Educational Qualification">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-5 gap-y-4">

          <Field label="Last Achieved Degree">
            <input className={inp} placeholder="e.g. B.Sc, HSC, SSC"
              value={form.last_degree} onChange={set('last_degree')} />
          </Field>

          <Field label="Institution / Board">
            <input className={inp} placeholder="শিক্ষা প্রতিষ্ঠানের নাম"
              value={form.institution} onChange={set('institution')} />
          </Field>

          <Field label="Passing Year">
            <input className={inp} type="number" placeholder={new Date().getFullYear()}
              min="1970" max={new Date().getFullYear()}
              value={form.passing_year} onChange={set('passing_year')} />
          </Field>

        </div>
      </SectionCard>

      {/* ══════════════════════════════════════════════════════════════
          SECTION 4 — Posting Information
      ══════════════════════════════════════════════════════════════ */}
      <SectionCard icon="🏢" title="Posting Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-4">

          <Field label="Joining Date" required>
            <input className={inp} type="date" placeholder="MM/DD/YY"
              value={form.join_date} onChange={set('join_date')} />
          </Field>

          <Field label="Department">
            <select className={sel} value={form.department} onChange={set('department')}>
              <option value="">Select</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Position">
            <select className={sel} value={form.position}
              onChange={e => {
                const posId = e.target.value;
                const pos = positions.find(p => String(p.id) === posId);
                setForm(f => ({
                  ...f,
                  position: posId,
                  designation: !f.designation.trim() && pos ? pos.name : f.designation,
                }));
              }}>
              <option value="">Select</option>
              {positions.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Designation" required>
            <input className={inp} placeholder="যেমন: Network Engineer, Accountant"
              value={form.designation} onChange={set('designation')}
              list="designation-list" />
            <datalist id="designation-list">
              <option value="Network Engineer" />
              <option value="System Administrator" />
              <option value="Accountant" />
              <option value="Support Engineer" />
              <option value="Bill Collector" />
              <option value="Manager" />
              <option value="HR Officer" />
              <option value="Sales Executive" />
            </datalist>
          </Field>

          <Field label="Basic Salary (৳)">
            <input className={inp} type="number" min="0" placeholder="0.00"
              value={form.basic_salary} onChange={set('basic_salary')} />
          </Field>

          <Field label="Status">
            <select className={sel} value={form.status} onChange={set('status')}>
              <option value="active">Active — কর্মরত</option>
              <option value="inactive">Inactive — নিষ্ক্রিয়</option>
              <option value="resigned">Resigned — পদত্যাগ</option>
            </select>
          </Field>

          {/* Photo Upload */}
          <Field label="Image (Photo)" colSpan="sm:col-span-2 md:col-span-3 lg:col-span-3">
            <div className="flex items-start gap-4">
              {/* Preview */}
              <div className="shrink-0">
                {photoPreview ? (
                  <img src={photoPreview} alt="Preview"
                    className="w-16 h-16 rounded-xl object-cover border-2 border-blue-200 shadow-sm" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-gray-100 border-2 border-dashed border-gray-300
                    flex items-center justify-center text-2xl text-gray-300">
                    👤
                  </div>
                )}
              </div>
              {/* File input styled */}
              <div className="flex-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg
                    text-xs font-medium text-gray-600 bg-white hover:bg-gray-50 transition shadow-sm">
                    📎 Choose File
                  </span>
                  <span className="text-xs text-gray-400">
                    {form.photo instanceof File ? form.photo.name : 'No file chosen'}
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                </label>
                <p className="text-[10px] text-gray-400 mt-1.5">JPG, PNG · সর্বোচ্চ ২ MB</p>
              </div>
            </div>
          </Field>

        </div>
      </SectionCard>

      {/* ── Submit / Cancel buttons ── */}
      <div className="flex justify-end gap-3 mt-2 mb-8">
        <Link to="/hr/employees"
          className="px-6 py-2.5 text-sm font-medium rounded-lg border border-gray-300
            text-gray-700 hover:bg-gray-50 transition">
          বাতিল
        </Link>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center gap-2 px-8 py-2.5 text-sm font-semibold rounded-lg
            bg-gradient-to-r from-slate-700 to-slate-600 text-white
            hover:from-slate-800 hover:to-slate-700 shadow-md disabled:opacity-60
            active:scale-95 transition-all"
        >
          {saving ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M5 13l4 4L19 7" />
            </svg>
          )}
          {saving ? 'Saving...' : (isEdit ? 'Update' : 'Submit')}
        </button>
      </div>

    </div>
  );
}
