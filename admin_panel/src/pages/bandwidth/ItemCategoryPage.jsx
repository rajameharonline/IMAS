// Item Category list page.
// কেন আলাদা view: sample অনুযায়ী list screen-এ tree-style categories
// দেখাতে হবে, আর add/edit আলাদা full-page route-এ যাবে।

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { RefreshCw, SquarePen, Plus, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import { asList, formatApiError } from './bandwidthHelpers';

function groupTree(rows) {
  const byParent = new Map();
  rows.forEach((row) => {
    const parentKey = row.parent || null;
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey).push(row);
  });
  return byParent;
}

function CategoryNode({ row, children, onEdit, onDelete }) {
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="min-w-0 break-words text-sm font-semibold text-slate-900">
            {row.name}
            {row.description ? <span className="ml-2 font-normal text-slate-500">({row.description})</span> : null}
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {row.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => onEdit(row)} className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-cyan-600 hover:bg-cyan-50">
            Edit
          </button>
          <button onClick={() => onDelete(row)} className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50">
            Delete
          </button>
        </div>
      </div>

      {children?.length ? (
        <div className="mt-3 ml-8 border-l border-slate-300 pl-6">
          {children.map((child) => (
            <CategoryNode key={child.id} row={child} children={[]} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ItemCategoryPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/inventory/item-categories/?page_size=500');
      setRows(asList(data));
    } catch (err) {
      toast.error(formatApiError(err, 'Item category লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [
      row.name,
      row.description,
      row.parent_name,
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [rows, search]);

  const tree = useMemo(() => {
    const byParent = groupTree(filtered);
    return byParent.get(null) || [];
  }, [filtered]);

  const childrenFor = (id) => {
    const byParent = groupTree(filtered);
    return byParent.get(id) || [];
  };

  const handleDelete = async (row) => {
    if (!confirm(`Delete ${row.name}?`)) return;
    try {
      await api.delete(`/inventory/item-categories/${row.id}/`);
      toast.success('Deleted.');
      fetchRows();
    } catch {
      toast.error('Delete failed.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900">Item Category</h1>
          <p className="text-xs text-slate-500">Item Category List</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchRows}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={() => navigate('/bandwidth/buy/item-categories/new')}
            className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <Plus className="h-4 w-4" /> Create Item Category
          </button>
        </div>
      </div>

      <div className="rounded-[4px] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-5">
          <div className="text-sm font-semibold text-slate-700">Item Categories</div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full max-w-[360px] rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </div>

        <div className="p-5">
          <div className="rounded border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="text-[14px] font-semibold text-slate-800">Items</div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-slate-400 text-sm">লোড হচ্ছে...</div>
            ) : (
              <div className="px-4 py-4">
                {tree.map((row) => (
                  <div key={row.id}>
                    <CategoryNode
                      row={row}
                      children={childrenFor(row.id)}
                      onEdit={(item) => navigate(`/bandwidth/buy/item-categories/${item.id}/edit`)}
                      onDelete={handleDelete}
                    />
                  </div>
                ))}

                {tree.length === 0 && (
                  <div className="py-20 text-center text-slate-400 text-sm">No category found.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
