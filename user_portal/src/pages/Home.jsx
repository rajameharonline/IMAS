// এই পেজটি ইউজারের প্রোফাইল, বিল, প্যাকেজ তথ্য দেখায়।
import { useEffect, useState } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';

export default function Home() {
  const [bills, setBills] = useState([]);
  const [user] = useState(() => JSON.parse(localStorage.getItem('user_info') || '{}'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ব্যবহারকারীর বিলের তালিকা লোড করা হচ্ছে
    api.get('/billing/bills/').then(res => {
      setBills(res.data.results || res.data || []);
    }).catch(() => toast.error('বিল লোড করতে ব্যর্থ।'))
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    localStorage.clear();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">ইউজার পোর্টাল</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm opacity-90">{user.username}</span>
          <button onClick={logout} className="text-sm opacity-80 hover:opacity-100">লগআউট</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 text-gray-900">আমার বিল</h2>
          {loading ? (
            <p className="text-gray-500 text-center py-8">লোড হচ্ছে...</p>
          ) : bills.length === 0 ? (
            <p className="text-gray-400 text-center py-8">কোনো বিল পাওয়া যায়নি।</p>
          ) : (
            <div className="space-y-3">
              {bills.map(bill => (
                <div key={bill.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{bill.bill_month}</p>
                    <p className="text-sm text-gray-500">বিল: ৳{Number(bill.net_amount).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    {bill.due_amount > 0 ? (
                      <div>
                        <p className="text-red-600 font-semibold">বকেয়া: ৳{Number(bill.due_amount).toLocaleString()}</p>
                        <button className="btn text-sm py-1.5 mt-1">পেমেন্ট করুন</button>
                      </div>
                    ) : (
                      <span className="text-green-600 font-medium">✅ পরিশোধিত</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card text-center">
            <div className="text-3xl mb-2">🌐</div>
            <h3 className="font-semibold text-gray-900">ব্যান্ডউইথ ব্যবহার</h3>
            <p className="text-sm text-gray-500 mt-1">শীঘ্রই আসছে</p>
          </div>
          <div className="card text-center">
            <div className="text-3xl mb-2">📦</div>
            <h3 className="font-semibold text-gray-900">প্যাকেজ তথ্য</h3>
            <p className="text-sm text-gray-500 mt-1">আপনার বর্তমান প্যাকেজ</p>
          </div>
          <div className="card text-center">
            <div className="text-3xl mb-2">🎫</div>
            <h3 className="font-semibold text-gray-900">সাপোর্ট টিকেট</h3>
            <p className="text-sm text-gray-500 mt-1">সমস্যা রিপোর্ট করুন</p>
          </div>
        </div>
      </main>
    </div>
  );
}
