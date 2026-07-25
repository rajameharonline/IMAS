// এই পেজটি ইউজার পোর্টালের লগইন পেজ।
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/login/', form);
      localStorage.setItem('user_access_token', res.data.access);
      localStorage.setItem('user_refresh_token', res.data.refresh);
      localStorage.setItem('user_info', JSON.stringify(res.data.user));
      toast.success('লগইন সফল!');
      navigate('/');
    } catch {
      toast.error('Username বা পাসওয়ার্ড সঠিক নয়।');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">ইউজার পোর্টাল</h1>
          <p className="text-gray-500 mt-1 text-sm">আপনার ISP অ্যাকাউন্টে প্রবেশ করুন</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username (PPPoE)</label>
            <input type="text" className="input"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              placeholder="আপনার username" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">পাসওয়ার্ড</label>
            <input type="password" className="input"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="পাসওয়ার্ড" required />
          </div>
          <button type="submit" className="btn w-full text-center" disabled={loading}>
            {loading ? 'লগইন হচ্ছে...' : 'লগইন করুন'}
          </button>
        </form>
      </div>
    </div>
  );
}
