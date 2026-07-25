import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── ট্যাব তালিকা (স্ক্রিনশট অনুযায়ী) ── */
const TABS = [
  'POP Information',
  'Exported Clients',
  'Unexported Clients',
  'Debited Transactions',
  'Credited Transactions',
  'Recharge Transactions',
  'POP Change Logs',
  'POP Fund Start Logs',
  'POP Online Clients',
];

/* ── ছোট helper components ── */
function Toggle({ on }) {
  return (
    <span className={`relative inline-flex h-5 w-9 items-center rounded-full ${on ? 'bg-blue-600' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </span>
  );
}

function SidebarRow({ icon, label, value, children }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
      <span className="flex items-center gap-2 text-sm text-gray-600">
        <span className="text-gray-400">{icon}</span> {label}
      </span>
      {children || <span className="text-sm font-semibold text-gray-800">{value}</span>}
    </div>
  );
}

function SidebarBtn({ icon, label, onClick, full }) {
  return (
    <button onClick={onClick}
      className={`flex items-center justify-center gap-2 px-3 py-2.5 bg-[#1e3a5f] text-white text-xs font-semibold rounded hover:bg-[#284b78] ${full ? 'col-span-2' : ''}`}>
      <span>{icon}</span> {label}
    </button>
  );
}

function SectionBar({ title }) {
  return (
    <div className="bg-[#1e3a5f] text-white px-4 py-2.5 rounded-t-lg font-semibold text-sm">{title}</div>
  );
}

function InfoRow({ label, value, label2, value2, badge, badge2 }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-4 py-2.5 text-sm text-gray-600 w-1/4">{label}</td>
      <td className="px-2 py-2.5 text-sm text-gray-400 w-px">:</td>
      <td className="px-4 py-2.5 text-sm font-medium text-gray-800 w-1/4">
        {badge ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">{value}</span> : value}
      </td>
      <td className="px-4 py-2.5 text-sm text-gray-600 w-1/4">{label2}</td>
      <td className="px-2 py-2.5 text-sm text-gray-400 w-px">{label2 ? ':' : ''}</td>
      <td className="px-4 py-2.5 text-sm font-medium text-gray-800 w-1/4">
        {badge2 ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500 text-white">{value2}</span> : value2}
      </td>
    </tr>
  );
}

/* ── DataTable: show/search + header + rows ── */
function DataTable({ columns, rows, render, empty = 'No data available in table', footer }) {
  const [search, setSearch] = useState('');
  const [perPage, setPerPage] = useState(25);
  const filtered = rows.filter(r =>
    !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>SHOW</span>
          <select value={perPage} onChange={e => setPerPage(+e.target.value)}
            className="border rounded px-2 py-1 text-sm">
            {[10,25,50,100].map(n => <option key={n}>{n}</option>)}
          </select>
          <span>ENTRIES</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>SEARCH:</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-44" />
        </div>
      </div>
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              {columns.map(c => <th key={c} className="px-3 py-2.5 text-left font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={columns.length} className="py-8 text-center text-gray-400">{empty}</td></tr>
            ) : filtered.slice(0, perPage).map((r, i) => render(r, i))}
            {footer}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-sm text-gray-500 flex items-center justify-between">
        <span>Showing {filtered.length === 0 ? 0 : 1} to {Math.min(perPage, filtered.length)} of {filtered.length} entries</span>
        <div className="flex gap-2">
          <button className="px-3 py-1 text-xs border rounded text-gray-500">Previous</button>
          <button className="px-3 py-1 text-xs bg-blue-600 text-white rounded">1</button>
          <button className="px-3 py-1 text-xs border rounded text-gray-500">Next</button>
        </div>
      </div>
    </div>
  );
}

function DateRange({ from, to, setFrom, setTo, extra }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">From Date</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">To Date</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-sm" />
      </div>
      {extra}
    </div>
  );
}

const BulkBtn = ({ label, color = 'bg-[#1e3a5f]' }) => (
  <button className={`px-4 py-2 ${color} text-white text-xs font-semibold rounded-full hover:opacity-90`}>{label}</button>
);

export default function POPProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pop, setPop] = useState(null);
  const [tab, setTab] = useState('POP Information');

  useEffect(() => {
    api.get(`/pop/pops/${id}/`).then(r => setPop(r.data)).catch(() => toast.error('POP লোড ব্যর্থ'));
  }, [id]);

  if (!pop) return <div className="p-6 text-gray-400">লোড হচ্ছে...</div>;

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <span>POP</span><span>&gt;</span>
            <span className="cursor-pointer text-blue-600" onClick={() => navigate('/pop/list')}>POP List</span>
            <span>&gt;</span><span>Profile</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">👤 POP <span className="text-sm font-normal text-gray-400">POP Profile</span></h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
        {/* ── Left Sidebar Card ── */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden h-fit">
          {/* Avatar header */}
          <div className="bg-[#1e3a5f] h-28 relative">
            <div className="absolute left-1/2 -translate-x-1/2 top-10 w-28 h-28 rounded-full bg-gray-200 border-4 border-white flex items-center justify-center text-5xl text-gray-400">
              🖥️
            </div>
          </div>
          <div className="pt-16 pb-4 px-5 text-center border-b">
            <h2 className="text-lg font-bold text-gray-800">{pop.business_name}</h2>
            <p className="text-sm text-gray-500">{pop.contact_person}</p>
            <p className="text-sm text-blue-600">{pop.email}</p>
          </div>

          <div className="px-5 py-2">
            <SidebarRow icon="🏷️" label="POP Code:" value={pop.code} />
            <SidebarRow icon="📱" label="Mobile Number:" value={pop.mobile} />
            <SidebarRow icon="👥" label="Running Clients:" value="0" />
            <SidebarRow icon="👤" label="Left Clients:" value="0" />
            <SidebarRow icon="💳" label="Remaining Balance:" value={`৳${Number(pop.fund_start || 0).toFixed(0)}`} />
            <SidebarRow icon="🏷️" label="Set Prefix in Mikrotik?"><Toggle on={pop.set_prefix_in_mikrotik} /></SidebarRow>
            <SidebarRow icon="📄" label="Credit Refund Policy?"><Toggle on={pop.restrict_online_payment} /></SidebarRow>
            <SidebarRow icon="🕐" label="Joining Date:" value={pop.created_at?.slice(0, 10)} />
            <SidebarRow icon="📍" label="Address:" value={pop.address} />
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2 p-4">
            <SidebarBtn icon="✎" label="Update Information" onClick={() => navigate(`/pop/${id}/edit`)} />
            <SidebarBtn icon="💬" label="Send Email/Message" onClick={() => toast('শীঘ্রই আসছে')} />
            <SidebarBtn icon="💼" label="POP Type Change" onClick={() => toast('শীঘ্রই আসছে')} />
            <SidebarBtn icon="🔄" label="Reset Recharge Started" onClick={() => toast('শীঘ্রই আসছে')} />
            <SidebarBtn icon="🔒" label="Password Regenerate" onClick={() => toast('শীঘ্রই আসছে')} />
            <SidebarBtn icon="🔑" label="Login As POP" onClick={() => toast('শীঘ্রই আসছে')} />
            <SidebarBtn icon="👤+" label="Add PoP Client" onClick={() => toast('শীঘ্রই আসছে')} />
            <SidebarBtn icon="‹" label="Go To POPs" onClick={() => navigate('/pop/list')} full />
          </div>
        </div>

        {/* ── Right Tab Panel ── */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          {/* Tab bar */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-b mb-5">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`pb-2 text-sm font-medium transition-colors ${tab === t ? 'text-blue-700 border-b-2 border-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'POP Information'      && <TabInfo pop={pop} />}
          {tab === 'Exported Clients'    && <TabClients id={id} exported />}
          {tab === 'Unexported Clients'  && <TabClients id={id} exported={false} />}
          {tab === 'Debited Transactions'  && <TabDebited id={id} />}
          {tab === 'Credited Transactions' && <TabCredited id={id} />}
          {tab === 'Recharge Transactions' && <TabRecharge id={id} />}
          {tab === 'POP Change Logs'     && <TabChangeLogs id={id} />}
          {tab === 'POP Fund Start Logs' && <TabFundStartLogs id={id} />}
          {tab === 'POP Online Clients'  && <TabOnline id={id} />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ Tab: POP Information ═══════════════ */
function TabInfo({ pop }) {
  return (
    <div className="space-y-6">
      <div>
        <SectionBar title="Service Information" />
        <div className="border border-t-0 rounded-b-lg overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <tbody>
              <InfoRow label="User Name" value={pop.username} label2="Min.Rechargable Amount" value2={Number(pop.min_rechargeable_amount).toFixed(2)} />
              <InfoRow label="Password" value="••••••" label2="Tariff Name" value2={pop.tariff_name || '—'} />
              <InfoRow label="POP Level" value={`Level ${pop.level}`} label2="Min. Activation Days" value2="—" />
              <InfoRow label="Total Clients" value="0" label2="POP Type" value2={pop.pop_type === 'prepaid' ? 'Prepaid' : 'Postpaid'} badge2 />
              <InfoRow label="Total Enabled Clients" value="0" label2="Total Disabled Clients" value2="0" />
              <InfoRow label="Minimum Balance" value={Number(pop.min_balance || 0).toFixed(0)}
                label2="Client Disabled Settings"
                value2={pop.want_to_disable_clients ? 'Yes, Clients will disabled!' : 'No'} badge2={pop.want_to_disable_clients} />
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <SectionBar title="Personal Information" />
        <div className="border border-t-0 rounded-b-lg overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <tbody>
              <InfoRow label="Company Name" value={pop.business_name} label2="Contact person" value2={pop.contact_person} />
              <InfoRow label="Mobile Number" value={pop.mobile} label2="Email" value2={pop.email} />
              <InfoRow label="Phone Number" value={pop.phone || ''} label2="National ID" value2={pop.national_id || ''} />
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <SectionBar title="Fund Information At A Glance" />
        <div className="border border-t-0 rounded-b-lg overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <tbody>
              <InfoRow label="Remaining Client Balance" value="৳0" label2="Total Client Balance" value2="৳" />
              <InfoRow label="Rechargable Amount" value="৳0.00" label2="Minimum Fund" value2={`৳${Number(pop.fund_start || 0).toFixed(0)}`} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ Tab: Exported / Unexported Clients ═══════════════ */
function TabClients({ id, exported }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get(`/pop/pops/${id}/clients/?exported=${exported}`)
      .then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [id, exported]);

  const cols = exported
    ? ['ID','User ID/IP','Password','Customer Name','Mobile','Zone','Client Type','Package/Speed','R. Days','Private IP','MAC Address','Server','B.Status','M.Status']
    : ['Name','Password','Package','Protocol','Profile','Server Name','R. Days','Enabled','Export'];

  return (
    <div>
      <SectionBar title={exported ? 'All Exported Clients' : 'All Unexported Clients'} />
      <div className="border border-t-0 rounded-b-lg p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {exported ? (
            <>
              <BulkBtn label="$ Bulk Recharge/Renewal" />
              <BulkBtn label="$ Bulk Package Change" />
              <BulkBtn label="✓ Bulk Clients Enable" />
              <BulkBtn label="⊘ Bulk Clients Disable" />
              <BulkBtn label="↺ Bulk R. Days Revert" />
            </>
          ) : (
            <>
              <BulkBtn label="🔄 Clients Bulk Revert" />
              <BulkBtn label="$ Bulk Recharge/Renewal" />
              <BulkBtn label="✓ Bulk Clients Enable" />
              <BulkBtn label="⊘ Bulk Clients Disable" />
            </>
          )}
          <div className="ml-auto flex gap-2">
            <BulkBtn label="📄 Generate PDF" />
            <BulkBtn label="📄 Generate CSV" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {['Package','Server','Protocol','Profile'].map(l => (
            <div key={l}>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{l}</label>
              <select className="w-full border rounded-lg px-2 py-1.5 text-sm"><option>Select {l}</option></select>
            </div>
          ))}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">R. Days</label>
            <select className="w-full border rounded-lg px-2 py-1.5 text-sm"><option>Select R.Days</option></select>
          </div>
        </div>
        <DataTable
          columns={['☐', ...cols]}
          rows={rows}
          render={(c, i) => (
            <tr key={c.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
              <td className="px-3 py-2"><input type="checkbox" /></td>
              {exported ? (
                <>
                  <td className="px-3 py-2">{c.id}</td>
                  <td className="px-3 py-2">{c.username}</td>
                  <td className="px-3 py-2">{c.password}</td>
                  <td className="px-3 py-2">{c.full_name}</td>
                  <td className="px-3 py-2">{c.phone}</td>
                  <td className="px-3 py-2">{c.zone_name}</td>
                  <td className="px-3 py-2">{c.client_type_name}</td>
                  <td className="px-3 py-2">{c.package_name}</td>
                  <td className="px-3 py-2">{c.expiry_day}</td>
                  <td className="px-3 py-2">{c.ip_address}</td>
                  <td className="px-3 py-2">{c.mac_address}</td>
                  <td className="px-3 py-2">{c.server_name}</td>
                  <td className="px-3 py-2">{c.status}</td>
                  <td className="px-3 py-2">{c.app_enabled ? 'On' : 'Off'}</td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2">{c.full_name}</td>
                  <td className="px-3 py-2">{c.password}</td>
                  <td className="px-3 py-2">{c.package_name}</td>
                  <td className="px-3 py-2">PPPoE</td>
                  <td className="px-3 py-2">{c.package_name}</td>
                  <td className="px-3 py-2">{c.server_name}</td>
                  <td className="px-3 py-2">{c.expiry_day}</td>
                  <td className="px-3 py-2">{c.status}</td>
                  <td className="px-3 py-2"><input type="checkbox" /></td>
                </>
              )}
            </tr>
          )}
        />
      </div>
    </div>
  );
}

/* ═══════════════ Tab: Debited Transactions ═══════════════ */
function TabDebited({ id }) {
  const [rows, setRows] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    api.get(`/pop/pops/${id}/debited-transactions/`).then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [id]);
  return (
    <div>
      <SectionBar title="All Debited Transactions History" />
      <div className="border border-t-0 rounded-b-lg p-4">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}
          extra={<div className="flex items-end gap-2"><BulkBtn label="Generate PDF" /><BulkBtn label="Generate CSV" /></div>} />
        <DataTable
          columns={['Sn#','POP','Funding Date','Amount','Total Paid','Total Discount','Total Due','Payment Date','Paid Amount','Discount','Remarks','ReceivedBy']}
          rows={rows}
          render={(r, i) => (
            <tr key={r.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
              <td className="px-3 py-2">{i + 1}</td>
              <td className="px-3 py-2">{r.pop_name}</td>
              <td className="px-3 py-2">{r.funding_date}</td>
              <td className="px-3 py-2">{r.fund_amount}</td>
              <td className="px-3 py-2">{r.received_amount}</td>
              <td className="px-3 py-2">{r.discount}</td>
              <td className="px-3 py-2">{r.due_amount}</td>
              <td className="px-3 py-2">{r.received_date}</td>
              <td className="px-3 py-2">{r.received_amount}</td>
              <td className="px-3 py-2">{r.discount}</td>
              <td className="px-3 py-2">{r.remarks}</td>
              <td className="px-3 py-2">{r.received_by_name}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

/* ═══════════════ Tab: Credited Transactions ═══════════════ */
function TabCredited({ id }) {
  const [rows, setRows] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    api.get(`/pop/pops/${id}/credited-transactions/`).then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [id]);
  return (
    <div>
      <SectionBar title="All Credited Transactions History" />
      <div className="border border-t-0 rounded-b-lg p-4">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}
          extra={<div className="flex items-end gap-2"><BulkBtn label="Generate PDF" /><BulkBtn label="Generate CSV" /></div>} />
        <DataTable
          columns={['Date','Total User','Total Credited User','Packages','Profiles','Protocol Types','Servers','Total Credited Amount','Action']}
          rows={rows}
          render={(r, i) => (
            <tr key={i} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
              <td className="px-3 py-2">{r.day}</td>
              <td className="px-3 py-2">{r.total_user}</td>
              <td className="px-3 py-2">{r.total_user}</td>
              <td className="px-3 py-2">—</td>
              <td className="px-3 py-2">—</td>
              <td className="px-3 py-2">—</td>
              <td className="px-3 py-2">—</td>
              <td className="px-3 py-2">{Number(r.total_amount || 0).toFixed(2)}</td>
              <td className="px-3 py-2">—</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

/* ═══════════════ Tab: Recharge Transactions ═══════════════ */
function TabRecharge({ id }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get(`/pop/pops/${id}/recharge-transactions/`).then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [id]);
  return (
    <div>
      <SectionBar title="All Recharge Transactions History" />
      <div className="border border-t-0 rounded-b-lg p-4">
        <DataTable
          columns={['UserName','Package','DailyRate','R.From Date','R.To Date','Days','CreditedAmount','TransactionType','CreditedOn','CreditedBy','Remarks']}
          rows={rows}
          render={(r, i) => (
            <tr key={r.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
              <td className="px-3 py-2">{r.username}</td>
              <td className="px-3 py-2">{r.package_name}</td>
              <td className="px-3 py-2">{r.daily_rate}</td>
              <td className="px-3 py-2">{r.r_from_date}</td>
              <td className="px-3 py-2">{r.r_to_date}</td>
              <td className="px-3 py-2">{r.days}</td>
              <td className="px-3 py-2">{r.credited_amount}</td>
              <td className="px-3 py-2">{r.trans_type}</td>
              <td className="px-3 py-2">{r.credited_on?.slice(0,10)}</td>
              <td className="px-3 py-2">{r.credited_by_name}</td>
              <td className="px-3 py-2">{r.remarks}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

/* ═══════════════ Tab: POP Change Logs ═══════════════ */
function TabChangeLogs({ id }) {
  const [rows, setRows] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    api.get(`/pop/pops/${id}/change-logs/`).then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [id]);
  return (
    <div>
      <SectionBar title="POP Change Logs" />
      <div className="border border-t-0 rounded-b-lg p-4">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <DataTable
          columns={['POP Name','Company Name','Tariff Name','Mobile Number','Zone','Thana','District','Prefix','Client M.Status','Fund Start','M.Rechargeable Amount','Prefix Set To UserName','Credit Refund Policy','Client Create Permission','Remarks','ChangedBy','Changed Date']}
          rows={rows}
          render={(r, i) => (
            <tr key={r.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
              <td className="px-3 py-2">{r.business_name}</td>
              <td className="px-3 py-2">{r.business_name}</td>
              <td className="px-3 py-2">{r.tariff_name}</td>
              <td className="px-3 py-2">{r.mobile}</td>
              <td className="px-3 py-2">{r.zone_name}</td>
              <td className="px-3 py-2">{r.upazila_name}</td>
              <td className="px-3 py-2">{r.district_name}</td>
              <td className="px-3 py-2">{r.pop_prefix}</td>
              <td className="px-3 py-2">{r.client_will_be_disabled ? 'Client will be disabled' : '—'}</td>
              <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.fund_start_on ? 'bg-cyan-500 text-white' : 'bg-gray-200'}`}>{r.fund_start_on ? 'ON' : 'OFF'}</span></td>
              <td className="px-3 py-2">{r.min_rechargeable_amount}</td>
              <td className="px-3 py-2">{r.set_prefix_in_mikrotik ? 'Prefix will be set' : "Prefix won't be set"}</td>
              <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs bg-gray-300 text-gray-600">{r.restrict_online_payment ? 'Enable' : 'Disable'}</span></td>
              <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs bg-gray-300 text-gray-600">Disable</span></td>
              <td className="px-3 py-2">{r.remarks}</td>
              <td className="px-3 py-2">{r.changed_by_name}</td>
              <td className="px-3 py-2">{r.changed_at?.slice(0,10)}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

/* ═══════════════ Tab: POP Fund Start Logs ═══════════════ */
function TabFundStartLogs({ id }) {
  const [rows, setRows] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    api.get(`/pop/pops/${id}/fund-start-logs/`).then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [id]);
  return (
    <div>
      <SectionBar title="POP Fund Start Logs" />
      <div className="border border-t-0 rounded-b-lg p-4">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <DataTable
          columns={['POP Name','Company Name','Changed By','ChangedDate','Effective From','Effective To','Activated/Deactived For','Fund Start On/Off']}
          rows={rows}
          render={(r, i) => (
            <tr key={r.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
              <td className="px-3 py-2">{r.changed_by_name}</td>
              <td className="px-3 py-2">{r.changed_by_name}</td>
              <td className="px-3 py-2">{r.changed_by_name}</td>
              <td className="px-3 py-2">{r.changed_at?.slice(0,10)}</td>
              <td className="px-3 py-2">{r.effective_from}</td>
              <td className="px-3 py-2">{r.effective_to || ''}</td>
              <td className="px-3 py-2">Activated For {r.activated_days} days</td>
              <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.is_enabled ? 'bg-blue-500 text-white' : 'bg-gray-300'}`}>{r.is_enabled ? 'Enable' : 'Disable'}</span></td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

/* ═══════════════ Tab: POP Online Clients ═══════════════ */
function TabOnline({ id }) {
  const [data, setData] = useState({ total_users: 0, online_users: 0, offline_users: 0, sessions: [] });
  useEffect(() => {
    api.get(`/pop/pops/${id}/online-clients/`).then(r => setData(r.data)).catch(() => {});
  }, [id]);

  const Card = ({ icon, label, value, color }) => (
    <div className={`${color} text-white rounded-xl p-5 flex items-center gap-4`}>
      <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">{icon}</div>
      <div><div className="text-sm font-semibold">{label}</div><div className="text-3xl font-bold">{value}</div></div>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card icon="👥" label="Total Users" value={data.total_users} color="bg-cyan-500" />
        <Card icon="✓" label="Online Users" value={data.online_users} color="bg-emerald-500" />
        <Card icon="✕" label="Offline Users" value={data.offline_users} color="bg-gray-600" />
      </div>
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Server</label>
        <select className="w-full md:w-64 border rounded-lg px-2 py-1.5 text-sm"><option>Select</option></select>
      </div>
      <DataTable
        columns={['Client Code','Name','Mobile','ID/IP','Server Name','Profile','Service','IP Address','Status','Duration','Logout Time']}
        rows={data.sessions || []}
        render={(s, i) => (
          <tr key={i} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
            <td className="px-3 py-2">{s.client_code || '—'}</td>
            <td className="px-3 py-2">{s.name || s.username}</td>
            <td className="px-3 py-2">{s.mobile || '—'}</td>
            <td className="px-3 py-2">{s.username}</td>
            <td className="px-3 py-2">{s.server || '—'}</td>
            <td className="px-3 py-2">{s.profile || '—'}</td>
            <td className="px-3 py-2">{s.service || 'PPPoE'}</td>
            <td className="px-3 py-2">{s.framed_ip || s.ip_address || '—'}</td>
            <td className="px-3 py-2">Online</td>
            <td className="px-3 py-2">{s.duration || '—'}</td>
            <td className="px-3 py-2">{s.logout_time || '—'}</td>
          </tr>
        )}
      />
    </div>
  );
}
