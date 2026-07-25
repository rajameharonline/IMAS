// Purchase Bill invoice preview page.
// কেন আলাদা route: sample অনুযায়ী user আগে invoice screen দেখবে, তারপর
// top-right button থেকে download/print action নেবে। এতে list page clean থাকে।
//
// এই page-এ এখন DOM থেকে সরাসরি PDF বানানো হচ্ছে, যাতে user "Download PDF"
// ক্লিক করলে যা screen-এ দেখছে সেটাই file হিসেবে download হয়।

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Send } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import api from '../../utils/api';
import { formatApiError, money, asList } from './bandwidthHelpers';

function InvoiceRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4 text-[13px] leading-6">
      <span className="font-semibold text-slate-900">{label}</span>
      <span className="text-slate-700 text-right">{value}</span>
    </div>
  );
}

export default function PurchaseBillInvoicePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const invoiceRef = useRef(null);
  const [bill, setBill] = useState(null);
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const billRes = await api.get(`/purchase/provider-bills/${id}/`);
      setBill(billRes.data);
      if (billRes.data?.provider) {
        const provRes = await api.get(`/purchase/providers/${billRes.data.provider}/`);
        setProvider(provRes.data);
      }
    } catch (err) {
      toast.error(formatApiError(err, 'Invoice load করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // id পরিবর্তন হলে invoice re-load করতে হবে।
  }, [id]);

  const handleDownload = async () => {
    if (!bill) return;
    setDownloading(true);
    try {
      // যেটা screen-এ render হয়েছে সেটাই capture করে PDF বানাচ্ছি।
      const node = invoiceRef.current;
      if (!node) throw new Error('Invoice preview পাওয়া যায়নি।');
      const canvas = await html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`invoice-${bill.invoice_no || bill.bill_no || bill.id}.pdf`);
    } catch (err) {
      toast.error(formatApiError(err, 'Invoice download failed.'));
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-slate-400">লোড হচ্ছে...</div>;
  }

  if (!bill) {
    return <div className="py-20 text-center text-slate-400">Invoice পাওয়া যায়নি।</div>;
  }

  const lines = asList(bill.lines);
  const payments = asList(bill.payments);
  const companyName = provider?.name || bill.provider_name || '—';

  return (
    <div className="min-h-screen bg-white px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[620px]">
        <div className="mb-4 flex items-center justify-between rounded-sm bg-white px-4 py-4 shadow-[0_4px_14px_rgba(15,23,42,0.12)]">
          <div className="flex items-center gap-3">
            <Send className="h-7 w-7 -rotate-12 text-[#173d59]" />
            <div>
              <h1 className="text-[22px] font-medium text-slate-900">Purchase Bill</h1>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="rounded bg-[#173d59] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-95 disabled:opacity-60"
          >
            {downloading ? 'Downloading...' : 'Download PDF'}
          </button>
        </div>

        <div ref={invoiceRef} className="bg-white shadow-[0_4px_14px_rgba(15,23,42,0.12)]">
          <div className="flex items-start justify-between gap-4 px-5 py-5">
            <div className="flex items-center gap-4">
              <div className="flex h-[86px] w-[86px] items-center justify-center overflow-hidden rounded-full bg-slate-100">
                {provider?.logo_url ? (
                  <img src={provider.logo_url} alt={companyName} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-4xl text-slate-300">🏢</span>
                )}
              </div>
            </div>

            <div className="text-right text-[13px] leading-6 text-slate-800">
              <div className="font-bold uppercase">Bill</div>
              <div>{companyName}</div>
              <div>{provider?.mobile_number || provider?.phone_number || ''}</div>
              <div>{provider?.email || ''}</div>
            </div>
          </div>

          <div className="border-t border-slate-300 px-5 py-4">
            <div className="grid grid-cols-2 gap-8 text-[13px]">
              <div>
                <div className="mb-1 text-[13px] font-bold uppercase text-slate-900">Bill To</div>
                <div className="font-bold text-slate-900">{bill.provider_name || companyName}</div>
                <div>Mobile Number: {provider?.mobile_number || provider?.phone_number || '—'}</div>
                <div>Email: {provider?.email || '—'}</div>
                <div>Address: {provider?.address || '—'}</div>
              </div>

              <div>
                <InvoiceRow label="Bill No" value={bill.bill_no} />
                <InvoiceRow label="Bill of Month" value={bill.billing_month || '—'} />
                <InvoiceRow label="Bill Date" value={bill.issue_date || '—'} />
                <InvoiceRow label="Payment Due" value={bill.due_date || '—'} />
                <InvoiceRow label="Amount Due(BDT)" value={`৳ ${money(bill.due_amount)}`} />
              </div>
            </div>
          </div>

          <div className="px-5 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#23445f] text-white">
                  <th className="px-3 py-2 text-left font-semibold">Item</th>
                  <th className="px-3 py-2 text-center font-semibold">Quantity</th>
                  <th className="px-3 py-2 text-center font-semibold">Price</th>
                  <th className="px-3 py-2 text-center font-semibold">VAT(%)</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id || `${line.item_name}-${line.description}`} className="border-b border-slate-200">
                    <td className="px-3 py-2 font-semibold text-slate-900">
                      {line.item_name || line.description || '—'}
                    </td>
                    <td className="px-3 py-2 text-center">{line.quantity || 0} {line.unit || ''}</td>
                    <td className="px-3 py-2 text-center">{money(line.rate)}</td>
                    <td className="px-3 py-2 text-center">{money(line.vat_percent)}</td>
                    <td className="px-3 py-2 text-right">{money(line.total_amount)}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan="5" className="px-3 py-4 text-center text-slate-400">No line items</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="ml-auto mt-2 w-[230px] pr-1 text-[13px]">
              <div className="flex items-center justify-between py-1">
                <span>Total Amount</span>
                <span>{money(bill.amount)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>Paid Amount</span>
                <span>{money(bill.paid_amount)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-900 py-2 font-bold">
                <span>Amount Due(BDT)</span>
                <span>{money(bill.due_amount)}</span>
              </div>
            </div>
          </div>

          <div className="px-5 pb-4 pt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-slate-100 text-slate-900">
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-left font-semibold">Payment Method</th>
                  <th className="px-3 py-2 text-left font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-slate-200">
                    <td className="px-3 py-2">{payment.payment_date || '—'}</td>
                    <td className="px-3 py-2">{payment.payment_method || '—'}</td>
                    <td className="px-3 py-2">{payment.description || ''}</td>
                    <td className="px-3 py-2 text-right">{money(payment.amount)}</td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-3 py-3 text-center text-slate-400">No payment found</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-4 text-[13px]">
              <span className="font-semibold">Remarks/Note :</span> {bill.notes || '—'}
            </div>
          </div>
        </div>

        <div className="mt-3 flex justify-start">
          <button
            type="button"
            onClick={() => navigate('/bandwidth/buy/bills')}
            className="inline-flex items-center gap-2 rounded bg-[#173d59] px-4 py-2 text-[12px] font-semibold text-white shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Back to List
          </button>
        </div>
      </div>
    </div>
  );
}
