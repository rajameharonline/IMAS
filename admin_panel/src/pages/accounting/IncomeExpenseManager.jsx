// ════════════════════════════════════════════════════════════════════════
//  IncomeExpenseManager.jsx  —  আয়/ব্যয় CRUD (tabbed)
// ════════════════════════════════════════════════════════════════════════
//
//  ব্যাকএন্ড ম্যাপিং:
//    GET    /api/v1/accounting/income/             → Income list
//    POST   /api/v1/accounting/income/             → Income create
//    PATCH  /api/v1/accounting/income/<id>/        → Income update
//    DELETE /api/v1/accounting/income/<id>/        → Income delete
//    (Expense-এর জন্য একই pattern, endpoint = /accounting/expense/)
//
//  প্রপস:
//    initialTab='income' বা 'expense' — URL-নির্ভর ডিফল্ট ট্যাব।
//    App.jsx route অনুযায়ী এই page দুটি ভিন্ন path-এ mount হয়:
//      /accounting/income   → initialTab='income'
//      /accounting/expense  → initialTab='expense'
//
//  কেন এক component-এ দুটি tab:
//    Income ও Expense-এর model schema প্রায় identical (category,
//    amount, date, description, reference)। DRY রাখতে এক component-এ
//    tab-ভিত্তিক switching — duplicate JSX এড়ানো হলো।
//
//  Category dropdown সম্পর্কে গুরুত্বপূর্ণ নোট:
//    Backend-এ IncomeCategory / ExpenseCategory model আছে, কিন্তু এই
//    মুহূর্তে আলাদা list endpoint expose নেই। তাই category-কে
//    optional রাখলাম — user চাইলে category ID (number) ম্যানুয়ালি
//    type করতে পারবে, না দিলে null হবে (model-এ on_delete=SET_NULL,
//    null=True থাকায় safe)। ভবিষ্যতে backend-এ Category endpoint
//    এলে এখানে dropdown যোগ করব (পারমিশনসহ)।
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

// ── Form-এর জন্য ফাঁকা state — reset/new ক্লিকে পুনঃব্যবহার ─────────
const EMPTY_FORM = {
  amount: '',
  date: new Date().toISOString().slice(0, 10),   // আজকের তারিখ default
  description: '',
  reference: '',
  category: '',     // optional FK ID (number, blank হলে null)
};

const fmt = (n) => Number(n || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Tab-অনুযায়ী endpoint resolver ─────────────────────────────────
//    এক জায়গায় keep — accidental typo এড়াতে।
const endpointFor = (tab) => (tab === 'income' ? '/accounting/income/' : '/accounting/expense/');

export default function IncomeExpenseManager({ initialTab = 'income' }) {
  // tab          → 'income' | 'expense' — কোন endpoint হিট হবে
  // records      → current tab-এর সব record
  // editing      → modal-এ open হওয়া record (null = create mode)
  // form         → controlled input state
  // dateFrom/To  → server-side filter (DRF filterset_fields)
  const [tab,        setTab]        = useState(initialTab);
  const [records,    setRecords]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');

  // Modal state
  const [open,       setOpen]       = useState(false);
  const [editing,    setEditing]    = useState(null);   // null = new, object = edit
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);

  // ── tab বদলালে initialTab prop অগ্রাহ্য করে নতুন tab অনুযায়ী data ──
  //    initialTab শুধু প্রথমবার React state seed করতে — পরে URL change-এ
  //    এই page remount হবে, তাই এখানে useEffect না।
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  // ── fetch records (server-side filter সহ) ─────────────────────────
  //    URL parameter দিয়ে filter পাঠাই — server-side filter বেশি
  //    accurate ও bandwidth-efficient।
  const fetchRecords = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page_size: 500 });
      if (dateFrom) qs.append('date__gte', dateFrom);
      if (dateTo)   qs.append('date__lte', dateTo);
      const { data } = await api.get(`${endpointFor(tab)}?${qs.toString()}`);
      setRecords(Array.isArray(data) ? data : (data.results || []));
    } catch (err) {
      toast.error('লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  };
  // tab বা date filter বদলালে refetch।
  useEffect(() => { fetchRecords(); /* eslint-disable-line */ }, [tab, dateFrom, dateTo]);

  // ── ক্লায়েন্ট-সাইড search filter (description/reference) ──────────
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return records;
    return records.filter((r) =>
      `${r.description || ''} ${r.reference || ''} ${r.category_name || ''}`
        .toLowerCase()
        .includes(term)
    );
  }, [records, search]);

  // ── মোট amount — header widget-এ দেখানোর জন্য ─────────────────────
  const totalAmount = useMemo(
    () => filtered.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    [filtered]
  );

  // ── Modal open helpers ────────────────────────────────────────────
  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };
  const openEdit = (record) => {
    setEditing(record);
    setForm({
      amount:      record.amount || '',
      date:        record.date   || EMPTY_FORM.date,
      description: record.description || '',
      reference:   record.reference   || '',
      category:    record.category ?? '',   // FK ID; null হলে ''
    });
    setOpen(true);
  };
  const closeModal = () => {
    if (saving) return;   // মাঝপথে close ব্লক — accidental data loss এড়ানো
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  // ── Save (create বা update) ───────────────────────────────────────
  //    "Why is_auto বা other meta field পাঠাই না":
  //    backend Income/Expense model-এ এসব ফিল্ড নেই — শুধু amount/date
  //    /description/reference/category যথেষ্ট।
  const handleSave = async (e) => {
    e.preventDefault();
    // basic validation — amount must be positive
    const amt = Number(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) {
      toast.error('Amount অবশ্যই শূন্যের বেশি হতে হবে।');
      return;
    }
    if (!form.date) {
      toast.error('তারিখ প্রয়োজন।');
      return;
    }
    setSaving(true);
    // payload তৈরি — empty category কে null পাঠাই (FK constraint সম্মত)
    const payload = {
      amount: amt,
      date: form.date,
      description: form.description || '',
      reference:   form.reference   || '',
      category:    form.category === '' ? null : Number(form.category),
    };
    try {
      if (editing) {
        await api.patch(`${endpointFor(tab)}${editing.id}/`, payload);
        toast.success('আপডেট হয়েছে।');
      } else {
        await api.post(endpointFor(tab), payload);
        toast.success(`${tab === 'income' ? 'আয়' : 'ব্যয়'} যোগ হয়েছে।`);
      }
      closeModal();
      fetchRecords();
    } catch (err) {
      // DRF serializer error-এর প্রথম field message তুলে দেখাই
      const data = err?.response?.data;
      const firstErr = data && typeof data === 'object'
        ? Object.values(data).flat()[0]
        : 'সংরক্ষণ ব্যর্থ।';
      toast.error(String(firstErr));
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────
  const handleDelete = async (record) => {
    if (!window.confirm(`এই ${tab === 'income' ? 'আয়' : 'ব্যয়'} entry মুছে ফেলবেন?`)) return;
    try {
      await api.delete(`${endpointFor(tab)}${record.id}/`);
      toast.success('মুছে ফেলা হয়েছে।');
      fetchRecords();
    } catch {
      toast.error('Delete ব্যর্থ।');
    }
  };

  // ── UI-তে theme-ভিত্তিক রঙ-একটি ছোট derived value ────────────────
  const isIncome = tab === 'income';
  const accent   = isIncome ? 'emerald' : 'rose';

  return (
    <div className="space-y-4">
      {/* ── Header + tab switcher ──────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1c2333]">
            {isIncome ? 'Income Manager' : 'Expense Manager'}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {isIncome
              ? 'Non-billing আয় (donation, equipment sale ইত্যাদি)'
              : 'কোম্পানির সব expense — vendor bill, rent, utility, salary etc.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab buttons */}
          <div className="inline-flex rounded-lg overflow-hidden border border-gray-200">
            <button
              onClick={() => setTab('income')}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                isIncome ? 'bg-[#1d3a50] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Income
            </button>
            <button
              onClick={() => setTab('expense')}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                !isIncome ? 'bg-[#1d3a50] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Expense
            </button>
          </div>
          <button
            onClick={openNew}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1d3a50] text-white hover:bg-[#26536f] transition-colors"
          >
            + Add {isIncome ? 'Income' : 'Expense'}
          </button>
        </div>
      </div>

      {/* ── Summary widget — মোট entries ও total amount ────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg bg-${accent}-50 text-${accent}-600 flex items-center justify-center font-bold`}>#</div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Records</p>
            <p className="text-xl font-bold text-[#1c2333]">{filtered.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg bg-${accent}-50 text-${accent}-600 flex items-center justify-center font-bold`}>৳</div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Total {isIncome ? 'Income' : 'Expense'}</p>
            <p className="text-xl font-bold text-[#1c2333]">৳ {fmt(totalAmount)}</p>
          </div>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="🔍 description / reference / category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-[#1d3a50]"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          title="To date"
        />
        <span className="text-xs text-gray-500 ml-auto">
          {filtered.length} / {records.length}
        </span>
      </div>

      {/* ── Main table ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#1c2333] text-white text-[11px] uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2.5 text-left">Date</th>
              <th className="px-3 py-2.5 text-left">Reference</th>
              <th className="px-3 py-2.5 text-left">Category</th>
              <th className="px-3 py-2.5 text-left">Description</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5 text-center w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">কোনো entry নেই।</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{r.date}</td>
                <td className="px-3 py-2 text-gray-700">{r.reference || '—'}</td>
                <td className="px-3 py-2 text-gray-600 text-xs">{r.category_name || '—'}</td>
                <td className="px-3 py-2 text-gray-600 truncate max-w-[260px]">{r.description || '—'}</td>
                <td className="px-3 py-2 text-right font-mono">৳ {fmt(r.amount)}</td>
                <td className="px-3 py-2 text-center">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => openEdit(r)}
                      className="px-2 py-0.5 text-[11px] rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(r)}
                      className="px-2 py-0.5 text-[11px] rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Modal (create / edit) ──────────────────────────────── */}
      {open && (
        <FormModal
          mode={editing ? 'edit' : 'new'}
          isIncome={isIncome}
          form={form}
          setForm={setForm}
          onClose={closeModal}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}

// ── FormModal: প্রায় সব field common — Income/Expense একই form ─────────
//    আলাদা ফাইল বানালে অনুসন্ধানে কষ্ট হবে; same file-এ private
//    component হিসেবে রাখা হয়েছে।
function FormModal({ mode, isIncome, form, setForm, onClose, onSave, saving }) {
  const isEdit = mode === 'edit';
  const inp = 'w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1d3a50]';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={onSave} className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-[#1c2333] text-white rounded-t-lg">
          <h2 className="text-base font-semibold">
            {isEdit ? 'Edit' : 'Add'} {isIncome ? 'Income' : 'Expense'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded bg-white/10 hover:bg-white/20 text-white text-lg leading-none"
          >×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">
                Amount <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={inp}
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                className={inp}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">
              Reference
            </label>
            <input
              type="text"
              className={inp}
              placeholder="Invoice no / receipt no / external ref"
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">
              Category ID <span className="text-gray-400 normal-case font-normal">(optional)</span>
            </label>
            <input
              type="number"
              className={inp}
              placeholder="optional — কোনো category-র সংখ্যা ID"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
            {/* কেন free-input: backend-এ Category list endpoint এখনো expose
                নেই — dropdown দিতে পারিনি। অ্যাডমিন চাইলে DB থেকে দেখে
                ID টাইপ করতে পারে; খালি রাখলে category=null হবে। */}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">
              Description
            </label>
            <textarea
              className={`${inp} h-20`}
              placeholder="বিস্তারিত নোট..."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            বাতিল
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 text-sm font-semibold rounded bg-[#1d3a50] text-white hover:bg-[#26536f] disabled:opacity-60"
          >
            {saving ? 'সংরক্ষণ...' : (isEdit ? 'আপডেট' : 'সংরক্ষণ')}
          </button>
        </div>
      </form>
    </div>
  );
}
