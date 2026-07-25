import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_STYLE = {
  active:   'bg-green-50 text-green-700 border-green-200',
  inactive: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  resigned: 'bg-red-50 text-red-600 border-red-200',
};
const STATUS_LABEL = { active: 'Active', inactive: 'Inactive', resigned: 'Resigned' };
const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Other' };

const inp  = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20';
const sel  = `${inp} bg-white`;
const fmt  = v => '৳' + Number(v || 0).toLocaleString();

// বাংলা নোট:
// এই gradient টোনগুলো Employee/Provider/Billing module-এ একরকম visual language রাখে।
// একই palette ব্যবহার করলে card, table, pagination, এবং shell সব জায়গায় consistency থাকে।
// ai.md Section 9 — 4-tone gradient standard (sky/teal/violet/slate)
const STAT_TONES = {
  sky:    'from-sky-500 to-cyan-600',
  teal:   'from-teal-500 to-emerald-600',
  violet: 'from-violet-500 to-indigo-600',
  slate:  'from-slate-500 to-slate-600',
};

const EMPTY = {
  full_name: '', phone: '', email: '', nid: '', gender: 'male',
  date_of_birth: '', join_date: '', designation: '', department: '', position: '',
  basic_salary: '', address: '', status: 'active', employee_id: '',
};

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 overflow-y-auto">
      <div className={`bg-white rounded-2xl shadow-2xl w-full my-4 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color = 'text-gray-900', icon, sub, tone = 'sky' }) {
  return (
    <div className={`rounded-2xl text-white p-4 shadow-sm bg-gradient-to-br ${STAT_TONES[tone] || STAT_TONES.sky}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-95 mb-1">{label}</p>
          <p className={`text-xl font-bold leading-none ${color}`}>{value}</p>
          {sub && <p className="text-[11px] opacity-80 mt-1">{sub}</p>}
        </div>
        {icon && <span className="text-2xl opacity-35 shrink-0">{icon}</span>}
      </div>
    </div>
  );
}

function FieldWrap({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

/* ── Mobile Employee Card ── */
function MobileEmployeeCard({ emp, idx, setViewEmp, navigate, setDeleteId }) {
  const isEven = idx % 2 === 0;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[11px] font-bold text-[#23445f]">{emp.employee_id}</span>
            <span className="font-bold text-gray-900 text-[13px] truncate">{emp.full_name}</span>
          </div>
          <p className="text-[11px] text-gray-400">{emp.phone}</p>
        </div>
        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[emp.status] || ''}`}>
          {STATUS_LABEL[emp.status] || emp.status}
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Designation</span>
          <span className="text-[12px] font-medium text-gray-800 truncate">{emp.designation || '—'}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Department</span>
          <span className="text-[12px] font-medium text-gray-800 truncate">{emp.department || '—'}</span>
        </div>
      </div>
      <div>
        <FRow label="Gender"><span className="text-[12px] text-gray-700">{GENDER_LABEL[emp.gender] || emp.gender}</span></FRow>
        <FRow label="Join Date"><span className="font-mono text-[12px] text-gray-700">{emp.join_date}</span></FRow>
        <FRow label="Basic Salary"><span className="font-semibold text-[12px] text-gray-900">{fmt(emp.basic_salary)}</span></FRow>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <button onClick={() => setViewEmp(emp)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">Details</button>
        <button onClick={() => navigate(`/hr/employees/${emp.id}/edit`)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
        <button onClick={() => setDeleteId(emp.id)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

export default function EmployeePage() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [summary, setSummary]     = useState(null);
  const [count, setCount]         = useState(0);
  const [page, setPage]           = useState(1);

  // filters
  const [search,  setSearch]  = useState('');
  const [statusF, setStatusF] = useState('active');
  const [deptF,   setDeptF]   = useState('');

  // modal
  const [showModal,  setShowModal]  = useState(false);
  const [editEmp,    setEditEmp]    = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [saving,     setSaving]     = useState(false);

  // view detail
  const [viewEmp, setViewEmp] = useState(null);

  // delete
  const [deleteId, setDeleteId] = useState(null);

  // positions (for Position dropdown)
  const [positions, setPositions] = useState([]);
  useEffect(() => {
    api.get('/hr/positions/?status=active&page_size=200')
      .then(res => setPositions(res.data.results || res.data))
      .catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page });
      if (search)  params.append('search', search);
      if (statusF) params.append('status', statusF);
      if (deptF)   params.append('department', deptF);

      const [empRes, sumRes] = await Promise.all([
        api.get(`/hr/employees/?${params}`),
        api.get('/hr/employees/summary/'),
      ]);
      setEmployees(empRes.data.results || empRes.data);
      setCount(empRes.data.count || 0);
      setSummary(sumRes.data);
    } catch {
      toast.error('Failed to load employee list.');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusF, deptF]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openAdd = () => {
    setEditEmp(null);
    setForm({ ...EMPTY, join_date: new Date().toISOString().slice(0, 10) });
    setShowModal(true);
  };

  const openEdit = (emp) => {
    setEditEmp(emp);
    setForm({
      employee_id:   emp.employee_id,
      full_name:     emp.full_name,
      phone:         emp.phone,
      email:         emp.email || '',
      nid:           emp.nid || '',
      gender:        emp.gender,
      date_of_birth: emp.date_of_birth || '',
      join_date:     emp.join_date,
      designation:   emp.designation,
      department:    emp.department || '',
      position:      emp.position || '',
      basic_salary:  emp.basic_salary,
      address:       emp.address || '',
      status:        emp.status,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.full_name)    { toast.error('Enter full name.'); return; }
    if (!form.phone)        { toast.error('Enter phone number.'); return; }
    if (!form.join_date)    { toast.error('Enter join date.'); return; }
    if (!form.designation)  { toast.error('Enter designation.'); return; }
    if (!form.basic_salary) { toast.error('Enter basic salary.'); return; }
    setSaving(true);
    try {
      const payload = { ...form, position: form.position || null };
      if (editEmp) {
        await api.patch(`/hr/employees/${editEmp.id}/`, payload);
        toast.success('Employee updated successfully.');
      } else {
        await api.post('/hr/employees/', payload);
        toast.success('New employee added successfully.');
      }
      setShowModal(false);
      fetchAll();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('Failed to save.');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/hr/employees/${deleteId}/`);
      toast.success('Employee deleted.');
      setDeleteId(null);
      fetchAll();
    } catch { toast.error('Failed to delete.'); }
  };

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const departments = summary?.departments || [];

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-sm text-gray-500 mt-0.5">Total {count} Employees</p>
        </div>
        <button onClick={() => navigate('/hr/employees/new')}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-[#173d59] text-white rounded-full hover:bg-[#1c2f44] font-semibold shadow-sm transition">
          + New Employee
        </button>
      </div>

      {/* ── Summary Cards ── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total Employees" value={summary.total || 0}             icon="👥" tone="sky" />
          <StatCard label="Active"          value={summary.active || 0}            color="text-white" icon="✅" tone="teal" />
          <StatCard label="Inactive"        value={summary.inactive || 0}          color="text-white" icon="⏸" tone="violet" />
          <StatCard label="Resigned"        value={summary.resigned || 0}          color="text-white" icon="🚪" tone="slate" />
          <StatCard label="Monthly Salary"  value={fmt(summary.total_salary)}      color="text-white" icon="💰" tone="sky"
            sub="(Active Employees)" />
        </div>
      )}

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input type="text" placeholder="Search by name / ID / phone / designation..."
            className="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            value={statusF} onChange={e => { setStatusF(e.target.value); setPage(1); }}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="resigned">Resigned</option>
          </select>
          <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            value={deptF} onChange={e => { setDeptF(e.target.value); setPage(1); }}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {(search || deptF || statusF !== 'active') && (
            <button onClick={() => { setSearch(''); setStatusF('active'); setDeptF(''); setPage(1); }}
              className="text-xs text-red-500 hover:text-red-700 px-2 border border-red-200 rounded-lg py-2 hover:bg-red-50">
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-20 text-gray-400 text-sm">Loading...</div>
        ) : employees.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">No employees found.</div>
        ) : (
          <>
          <div className="md:hidden space-y-2 p-3">
            {employees.map((emp, idx) => (
              <MobileEmployeeCard key={emp.id} emp={emp} idx={idx}
                setViewEmp={setViewEmp} navigate={navigate} setDeleteId={setDeleteId} />
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#23445f] text-left text-xs font-semibold text-white uppercase tracking-wide border-b border-[#23445f]">
                  <th className="px-4 py-3">Employee ID</th>
                  <th className="px-4 py-3">Name & Contact</th>
                  <th className="px-4 py-3">Designation / Dept</th>
                  <th className="px-4 py-3">Gender</th>
                  <th className="px-4 py-3">Join Date</th>
                  <th className="px-4 py-3 text-right">Basic Salary</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{emp.employee_id}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{emp.full_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{emp.phone}{emp.email ? ` · ${emp.email}` : ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700">{emp.designation}</p>
                      {emp.department && <p className="text-xs text-gray-400 mt-0.5">{emp.department}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{GENDER_LABEL[emp.gender] || emp.gender}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{emp.join_date}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(emp.basic_salary)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[emp.status] || ''}`}>
                        {STATUS_LABEL[emp.status] || emp.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => setViewEmp(emp)}
                          className="text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 font-medium">
                          Details
                        </button>
                        <button onClick={() => navigate(`/hr/employees/${emp.id}/edit`)}
                          className="text-xs px-2.5 py-1 rounded-md bg-primary-50 text-primary-700 hover:bg-primary-100 border border-primary-200 font-medium">
                          Edit
                        </button>
                        <button onClick={() => setDeleteId(emp.id)}
                          className="text-xs px-2.5 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}

        {/* Pagination */}
        {!loading && count > 20 && (
          <div className="flex justify-between items-center px-4 py-3 border-t border-slate-100">
            <span className="text-sm text-gray-500">Total {count} employees</span>
            <div className="flex gap-2 items-center">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40">← Prev</button>
              <span className="text-sm text-gray-600 px-1">Page {page}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={employees.length < 20}
                className="px-3 py-1 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* ── View Detail Modal ── */}
      {viewEmp && (
        <Modal title="Employee Details" onClose={() => setViewEmp(null)}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-4 pb-3 border-b border-slate-100">
              <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-xl font-bold">
                {viewEmp.full_name.charAt(0)}
              </div>
              <div>
                <p className="font-bold text-gray-900 text-base">{viewEmp.full_name}</p>
                <p className="text-gray-500">{viewEmp.designation}{viewEmp.department ? ` · ${viewEmp.department}` : ''}</p>
                <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border mt-1 ${STATUS_STYLE[viewEmp.status]}`}>
                  {STATUS_LABEL[viewEmp.status]}
                </span>
              </div>
            </div>
            {[
              ['Employee ID',  viewEmp.employee_id],
              ['Phone',        viewEmp.phone],
              ['Email',        viewEmp.email || '—'],
              ['NID',          viewEmp.nid || '—'],
              ['Gender',       GENDER_LABEL[viewEmp.gender]],
              ['Date of Birth', viewEmp.date_of_birth || '—'],
              ['Join Date',    viewEmp.join_date],
              ['Basic Salary', fmt(viewEmp.basic_salary)],
              ['Address',      viewEmp.address || '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-gray-500 shrink-0 w-32">{label}</span>
                <span className="text-gray-900 text-right">{value}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => { setViewEmp(null); openEdit(viewEmp); }}
              className="px-4 py-2 text-sm bg-[#173d59] text-white rounded-xl hover:bg-[#1c2f44] font-semibold">Edit</button>
            <button onClick={() => setViewEmp(null)}
              className="px-4 py-2 text-sm text-gray-600 border border-slate-300 rounded-lg hover:bg-slate-50">Close</button>
          </div>
        </Modal>
      )}

      {/* ── Add / Edit Modal ── */}
      {showModal && (
        <Modal title={editEmp ? 'Edit Employee' : 'Add New Employee'} onClose={() => setShowModal(false)} wide>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {editEmp && (
              <FieldWrap label="Employee ID">
                <input className={`${inp} bg-slate-50 text-slate-500`} value={form.employee_id} readOnly />
              </FieldWrap>
            )}

            <FieldWrap label="Full Name" required>
              <input className={inp} value={form.full_name} onChange={set('full_name')} placeholder="Employee full name" />
            </FieldWrap>

            <FieldWrap label="Phone Number" required>
              <input className={inp} type="tel" value={form.phone} onChange={set('phone')} placeholder="01XXXXXXXXX" />
            </FieldWrap>

            <FieldWrap label="Email">
              <input className={inp} type="email" value={form.email} onChange={set('email')} placeholder="email@example.com" />
            </FieldWrap>

            <FieldWrap label="NID Number">
              <input className={inp} value={form.nid} onChange={set('nid')} placeholder="National ID number" />
            </FieldWrap>

            <FieldWrap label="Gender" required>
              <select className={sel} value={form.gender} onChange={set('gender')}>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </FieldWrap>

            <FieldWrap label="Date of Birth">
              <input className={inp} type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
            </FieldWrap>

            <FieldWrap label="Join Date" required>
              <input className={inp} type="date" value={form.join_date} onChange={set('join_date')} />
            </FieldWrap>

            <FieldWrap label="Position">
              <select className={sel} value={form.position} onChange={set('position')}>
                <option value="">Select</option>
                {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FieldWrap>

            <FieldWrap label="Designation" required>
              <input className={inp} value={form.designation} onChange={set('designation')} placeholder="e.g. Network Engineer" />
            </FieldWrap>

            <FieldWrap label="Department">
              <input className={inp} value={form.department} onChange={set('department')} placeholder="e.g. Technical, Billing" list="dept-list" />
              <datalist id="dept-list">
                {departments.map(d => <option key={d} value={d} />)}
              </datalist>
            </FieldWrap>

            <FieldWrap label="Basic Salary (৳)" required>
              <input className={inp} type="number" min="0" value={form.basic_salary} onChange={set('basic_salary')} placeholder="0" />
            </FieldWrap>

            <FieldWrap label="Status" required>
              <select className={sel} value={form.status} onChange={set('status')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="resigned">Resigned</option>
              </select>
            </FieldWrap>

            <div className="md:col-span-2">
              <FieldWrap label="Address">
                <textarea className={inp} rows={2} value={form.address} onChange={set('address')} placeholder="Village / Area, Upazila, District" />
              </FieldWrap>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-slate-100">
            <button onClick={() => setShowModal(false)}
              className="px-4 py-2 text-sm text-gray-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2 text-sm font-semibold bg-[#173d59] text-white rounded-xl hover:bg-[#1c2f44] disabled:opacity-50 transition">
              {saving ? 'Saving...' : (editEmp ? 'Update' : '+ Add Employee')}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <Modal title="Delete Employee" onClose={() => setDeleteId(null)}>
          <p className="text-sm text-gray-600 mb-6">
            All employee data will be permanently deleted. Are you sure?
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteId(null)}
              className="px-4 py-2 text-sm text-gray-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete}
              className="px-5 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
