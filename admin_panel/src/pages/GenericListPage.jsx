import { useEffect, useState } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';

export default function GenericListPage({ title, endpoint }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState([]);

  useEffect(() => {
    api.get(endpoint).then(res => {
      const items = res.data.results || res.data;
      if (items.length > 0) {
        setColumns(Object.keys(items[0]).filter(k => !['id', 'created_at', 'updated_at'].includes(k)).slice(0, 6));
      }
      setData(items);
    }).catch(() => toast.error('Failed to load data.'))
      .finally(() => setLoading(false));
  }, [endpoint]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <div className="card">
        {loading ? (
          <div className="text-center py-10 text-gray-500">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                {columns.map(col => (
                  <th key={col} className="px-4 py-3 font-medium text-gray-600 capitalize">
                    {col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {columns.map(col => (
                    <td key={col} className="px-4 py-3 text-gray-700">
                      {typeof row[col] === 'boolean'
                        ? (row[col] ? '✅' : '❌')
                        : String(row[col] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {!loading && data.length === 0 && (
          <div className="text-center py-10 text-gray-400">No data found.</div>
        )}
      </div>
    </div>
  );
}
