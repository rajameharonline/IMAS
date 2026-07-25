// Provider detail page.
// কেন আলাদা route: provider summary + invoice table একসাথে দেখালে
// screenshot-এর মতো operational drill-down experience পাওয়া যায়।

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, CreditCard, FileText } from 'lucide-react';
import api from '../../utils/api';
import { asList, downloadBlob, money } from './bandwidthHelpers';

/* ── Mobile Provider Bill Card ── */
function MobileProviderBillCard({ bill, idx, openInvoice, handlePay, money }) {
  const isEven = idx % 2 === 0;
  const statusCls = bill.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : bill.status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">
        <div className="min-w-0 truncate">{children}</div>
      </div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <p className="font-mono font-bold text-sky-700 text-[13px] truncate min-w-0">{bill.bill_no}</p>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${statusCls}`}>{bill.status}</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col min-w-0 px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Bill Amount</span>
          <span className="font-mono text-[12px] font-semibold text-gray-800 truncate">৳ {money(bill.net_amount)}</span>
        </div>
        <div className="flex flex-col min-w-0 px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Due</span>
          <span className="font-mono text-[12px] font-bold text-rose-600 truncate">৳ {money(bill.due_amount)}</span>
        </div>
      </div>
      <div>
        <FRow label="Bill Month"><span className="text-[12px] text-gray-700">{bill.billing_month || '—'}</span></FRow>
        <FRow label="Paid"><span className="font-mono text-[12px] text-emerald-600">৳ {money(bill.paid_amount)}</span></FRow>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <button onClick={() => openInvoice(bill)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-sky-50 text-sky-600 border border-sky-200 hover:bg-sky-100">Invoice</button>
        {bill.status !== 'paid' && (
          <button onClick={() => handlePay(bill)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100">Pay</button>
        )}
      </div>
    </div>
  );
}

export default function ProviderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [provider, setProvider] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pRes, bRes] = await Promise.all([
        api.get(`/purchase/providers/${id}/`),
        api.get(`/purchase/provider-bills/?provider=${id}&page_size=500`),
      ]);
      setProvider(pRes.data);
      setBills(asList(bRes.data));
    } catch {
      toast.error('Provider details load করা যায়নি।');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [id]);

  const openInvoice = (bill) => {
    navigate(`/bandwidth/buy/bills/${bill.id}/invoice`);
  };

  const handlePay = async (bill) => {
    const raw = window.prompt(`Pay amount for ${bill.invoice_no}`, String(bill.due_amount || 0));
    if (!raw) return;
    const amount = Number(raw);
    if (!amount || amount <= 0) return toast.error('Valid amount দিন।');
    try {
      await api.post(`/purchase/provider-bills/${bill.id}/pay/`, {
        amount,
        payment_date: new Date().toISOString().slice(0, 10),
        payment_method: 'cash',
        description: 'Manual payment from provider detail page',
      });
      toast.success('Payment posted.');
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Payment failed.');
    }
  };

  if (loading || !provider) {
    return <div className="py-16 text-center text-slate-400">লোড হচ্ছে...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Provider Details</h1>
          <p className="text-xs text-slate-500">Current due, contact info, and invoice history</p>
        </div>
        <button onClick={() => navigate('/bandwidth/buy/providers')} className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] px-4 py-2 text-sm font-semibold text-white">
          <ArrowLeft className="h-4 w-4" /> Go To List
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 h-32 w-32 overflow-hidden rounded-full bg-slate-100 flex items-center justify-center text-5xl text-slate-300">
              {provider.logo_url ? <img src={provider.logo_url} alt={provider.name} className="h-full w-full object-cover" /> : '🏢'}
            </div>
            <h2 className="text-xl font-bold text-slate-900">{provider.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{provider.contact_person || 'No contact person'}</p>
            <div className="mt-5 w-full rounded-2xl bg-slate-50 p-4 text-left space-y-2 text-sm">
              <p><span className="font-semibold">Mobile:</span> {provider.mobile_number || provider.phone_number || '—'}</p>
              <p><span className="font-semibold">Email:</span> {provider.email || '—'}</p>
              <p><span className="font-semibold">Website:</span> {provider.website || '—'}</p>
              <p><span className="font-semibold">Due:</span> <span className="font-bold text-rose-600">৳ {money(provider.current_due)}</span></p>
            </div>
            <button
              onClick={() => navigate('/bandwidth/buy/bills')}
              className="mt-4 w-full rounded-xl bg-[#173d59] px-4 py-2 text-sm font-semibold text-white"
            >
              View All Bills
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h3 className="text-lg font-bold text-slate-900">Invoice Information</h3>
          </div>
          <>
          <div className="md:hidden space-y-2 p-3">
            {bills.length === 0
              ? <p className="text-center py-8 text-slate-400 text-sm">No invoice found.</p>
              : bills.map((bill, idx) => (
                  <MobileProviderBillCard key={bill.id} bill={bill} idx={idx}
                    openInvoice={openInvoice} handlePay={handlePay} money={money} />
                ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#23445f] text-white">
                <tr>
                  <th className="px-4 py-3 text-left">Bill No</th>
                  <th className="px-4 py-3 text-left">Bill Month</th>
                  <th className="px-4 py-3 text-left">Bill Amount</th>
                  <th className="px-4 py-3 text-left">Paid Amount</th>
                  <th className="px-4 py-3 text-left">Due</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={bill.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-sky-700">{bill.bill_no}</td>
                    <td className="px-4 py-3">{bill.billing_month || '—'}</td>
                    <td className="px-4 py-3">৳ {money(bill.net_amount)}</td>
                    <td className="px-4 py-3">৳ {money(bill.paid_amount)}</td>
                    <td className="px-4 py-3">৳ {money(bill.due_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${bill.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : bill.status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                        {bill.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => openInvoice(bill)} className="rounded-lg border border-slate-200 p-2 text-sky-700 hover:bg-sky-50" title="Open Invoice">
                          <FileText className="h-4 w-4" />
                        </button>
                        <button onClick={() => handlePay(bill)} className="rounded-lg border border-slate-200 p-2 text-emerald-700 hover:bg-emerald-50" title="Pay">
                          <CreditCard className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {bills.length === 0 && (
                  <tr>
                    <td colSpan="7" className="py-16 text-center text-slate-400">No invoice found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </>
        </div>
      </div>
    </div>
  );
}
