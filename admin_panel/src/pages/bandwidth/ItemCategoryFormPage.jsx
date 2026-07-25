// Item Category full-page create/edit form.
// কেন আলাদা route: sample screenshot-এ add/edit page dedicated, modal না।
// এখানে status dropdown, parent category, description, এবং clear/save action
// same screen-এ রাখা হয়েছে।

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import api from '../../utils/api';
import { asList, formatApiError } from './bandwidthHelpers';

const EMPTY = {
  name: '',
  parent: '',
  description: '',
  is_active: true,
};

export default function ItemCategoryFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const title = isEdit ? 'Edit Item Category' : 'Add Item Category';

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const [listRes, detailRes] = await Promise.all([
          api.get('/inventory/item-categories/?page_size=500'),
          isEdit ? api.get(`/inventory/item-categories/${id}/`) : Promise.resolve({ data: null }),
        ]);
        const list = asList(listRes.data);
        setRows(list);
        if (detailRes.data) {
          setForm({
            name: detailRes.data.name || '',
            parent: detailRes.data.parent || '',
            description: detailRes.data.description || '',
            is_active: detailRes.data.is_active ?? true,
          });
        }
      } catch (err) {
        toast.error(formatApiError(err, 'Item category load করা যায়নি।'));
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [id, isEdit]);

  const parentOptions = useMemo(
    () => rows.filter((row) => !isEdit || String(row.id) !== String(id)),
    [rows, id, isEdit],
  );

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: String(form.name || '').trim(),
        parent: form.parent ? Number(form.parent) : null,
        description: String(form.description || '').trim(),
        is_active: !!form.is_active,
      };
      if (isEdit) {
        await api.patch(`/inventory/item-categories/${id}/`, payload);
        toast.success('Category updated.');
      } else {
        await api.post('/inventory/item-categories/', payload);
        toast.success('Category created.');
      }
      navigate('/bandwidth/buy/item-categories');
    } catch (err) {
      toast.error(formatApiError(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => setForm(EMPTY);

  if (loading) {
    return <div className="py-20 text-center text-slate-400">লোড হচ্ছে...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900">{title}</h1>
          <p className="text-xs text-slate-500">Item Category List</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div className="font-semibold text-slate-700">Bandwidth</div>
          <div>{title}</div>
        </div>
      </div>

      <div className="rounded-[4px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5">
          <button
            type="button"
            onClick={() => navigate('/bandwidth/buy/item-categories')}
            className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Back to List
          </button>
        </div>

        <form onSubmit={handleSave} className="px-5 py-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                Item Category Name<span className="text-rose-500">*</span>
              </span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                Item Category Status
              </span>
              <select
                value={form.is_active ? '1' : '0'}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === '1' }))}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                Sub-Category Of
              </span>
              <select
                value={form.parent}
                onChange={(e) => setForm((f) => ({ ...f, parent: e.target.value }))}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">Select a parent category</option>
                {parentOptions.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6">
            <label className="block">
              <span className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                Short Description
              </span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={7}
                className="w-full rounded border border-slate-300 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
              />
            </label>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClear}
              className="rounded bg-[#ff4b3a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-[#2ea043] px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
