import { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';

// ── Constants ────────────────────────────────────────────────────────────────
const ICONS = ['🗄️', '🎬', '🎥', '📽️', '🎞️', '📁', '💿', '📡', '🖥️', '🌐'];
const EMPTY_SERVER = { name: '', url: '', icon: '🗄️', note: '' };
const EMPTY_CONTENT = {
  title: '', content_type: 'movie', thumbnail_url: '', description: '',
  year: '', genre: '', language: 'বাংলা', video_url: '',
  series_title: '', season: '', episode: '', is_active: true,
};
const TYPE_LABELS = { movie: '🎬 মুভি', drama: '📺 নাটক', series: '📂 সিরিজ' };
const TYPE_COLORS = {
  movie:  'bg-blue-100 text-blue-700',
  drama:  'bg-purple-100 text-purple-700',
  series: 'bg-green-100 text-green-700',
};
const SUPPORTED_FORMATS = '.mp4,.mkv,.webm,.avi,.mov,.ts,.flv,.m4v,.3gp,.wmv,.ogv,.m2ts';

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1: FTP সার্ভার ম্যানেজমেন্ট
// ══════════════════════════════════════════════════════════════════════════════

function ServerCard({ server, index, total, onChange, onDelete, onMove, saving }) {
  const [expanded, setExpanded] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm(`"${server.name || 'এই সার্ভার'}" মুছে দেওয়া হবে?`)) return;
    setDeleting(true);
    await onDelete(index);
    setDeleting(false);
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-opacity ${deleting ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50"
        role="button" tabIndex={0}
        onClick={() => setExpanded(e => !e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(x => !x); } }}
      >
        <span className="text-2xl">{server.icon || '🗄️'}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 truncate">{server.name || 'নামহীন সার্ভার'}</p>
          <p className="text-xs text-gray-400 truncate font-mono">{server.url || 'URL দেওয়া হয়নি'}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={e => { e.stopPropagation(); onMove(index, -1); }} disabled={index === 0 || saving} className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30">↑</button>
          <button onClick={e => { e.stopPropagation(); onMove(index, 1); }} disabled={index === total - 1 || saving} className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30">↓</button>
          <button onClick={handleDelete} disabled={deleting || saving} className="p-1.5 rounded text-rose-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30" title="সার্ভার মুছুন">
            {deleting ? '⟳' : '✕'}
          </button>
          <span className="text-gray-300 ml-1 text-sm">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">আইকন</label>
            <div className="flex gap-2 flex-wrap">
              {ICONS.map(ic => (
                <button key={ic} onClick={() => onChange(index, 'icon', ic)}
                  className={`text-xl p-2 rounded-xl border-2 transition-all ${server.icon === ic ? 'border-[#173d59] bg-blue-50 scale-110' : 'border-transparent hover:border-gray-200'}`}>
                  {ic}
                </button>
              ))}
              <input value={server.icon || ''} onChange={e => onChange(index, 'icon', e.target.value)}
                className="w-14 border border-gray-200 rounded-xl px-2 py-1.5 text-center text-xl" placeholder="✏️" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">সার্ভারের নাম</label>
            <input value={server.name || ''} onChange={e => onChange(index, 'name', e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]" placeholder="যেমন: Rajamehar Movie Server" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">সার্ভার URL</label>
            <input value={server.url || ''} onChange={e => onChange(index, 'url', e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#173d59]" placeholder="http://192.168.1.1/" />
            {server.url && <a href={server.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#173d59] mt-1 inline-block hover:underline">🔗 URL পরীক্ষা করুন</a>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">📢 নোটিশ</label>
            <textarea value={server.note || ''} onChange={e => onChange(index, 'note', e.target.value)}
              rows={2} className="w-full border border-amber-200 bg-amber-50 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder="যেমন: রাত ১২টা থেকে সার্ভার বন্ধ থাকে।" />
          </div>
        </div>
      )}
    </div>
  );
}

function ServerTab() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [msg, setMsg]         = useState(null);

  useEffect(() => {
    api.get('/system/mobile-app-config/current/').then(r => {
      setServers(r.data.ftp_servers || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // সার্ভার list সরাসরি PATCH করে save করে
  const saveToServer = async (list) => {
    setSaving(true); setMsg(null);
    try {
      await api.patch('/system/mobile-app-config/current/', { ftp_servers: list });
      setDirty(false);
      setMsg({ type: 'success', text: `✅ ${list.length}টি FTP সার্ভার সংরক্ষণ হয়েছে।` });
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ type: 'error', text: '❌ সংরক্ষণ ব্যর্থ।' });
    }
    setSaving(false);
  };

  const mark = fn => { fn(); setDirty(true); setMsg(null); };
  const handleAdd    = () => mark(() => setServers(s => [...s, { ...EMPTY_SERVER }]));
  const handleChange = (i, f, v) => mark(() => setServers(s => s.map((sv, idx) => idx === i ? { ...sv, [f]: v } : sv)));

  // ✕ বাটন: immediate server-side delete
  const handleDelete = async (i) => {
    const updated = servers.filter((_, idx) => idx !== i);
    setServers(updated);
    await saveToServer(updated);
  };

  const handleMove = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= servers.length) return;
    mark(() => { const a = [...servers]; [a[i], a[j]] = [a[j], a[i]]; setServers(a); });
  };

  if (loading) return <div className="p-8 text-center text-gray-400">লোড হচ্ছে...</div>;

  return (
    <div className="space-y-4">
      {msg && <div className={`rounded-xl px-4 py-3 text-sm font-medium ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>{msg.text}</div>}
      <div className="flex items-center gap-4 bg-white rounded-2xl border border-slate-200 px-5 py-3 shadow-sm">
        <div className="text-center"><p className="text-2xl font-bold text-[#173d59]">{servers.length}</p><p className="text-xs text-gray-400">মোট সার্ভার</p></div>
        <div className="w-px h-8 bg-gray-200" />
        <div className="text-center"><p className="text-2xl font-bold text-emerald-600">{servers.filter(s => s.url).length}</p><p className="text-xs text-gray-400">URL সহ</p></div>
        <div className="ml-auto flex items-center gap-3">
          {dirty && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">● অসংরক্ষিত</span>}
          <button onClick={handleAdd} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-full text-sm font-semibold">+ সার্ভার যোগ</button>
          <button onClick={() => saveToServer(servers)} disabled={saving || !dirty} className="bg-[#173d59] hover:bg-[#1f5075] text-white px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-40">
            {saving ? '⟳ সংরক্ষণ...' : '💾 সংরক্ষণ'}
          </button>
        </div>
      </div>
      {servers.length === 0
        ? <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
            <div className="text-5xl mb-3">🗄️</div>
            <p className="text-gray-500">কোনো FTP সার্ভার নেই</p>
            <button onClick={handleAdd} className="mt-4 bg-[#173d59] text-white px-6 py-2.5 rounded-full text-sm font-semibold">+ সার্ভার যোগ করুন</button>
          </div>
        : servers.map((sv, i) => (
            <ServerCard key={i} server={sv} index={i} total={servers.length}
              onChange={handleChange} onDelete={handleDelete} onMove={handleMove} saving={saving} />
          ))
      }
      {servers.length > 0 && (
        <button onClick={handleAdd} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-2xl text-sm text-gray-500 hover:border-[#173d59] hover:text-[#173d59]">
          + আরও সার্ভার যোগ
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ভিডিও আপলোড কম্পোনেন্ট
// ══════════════════════════════════════════════════════════════════════════════

function VideoUploader({ onUploaded, currentUrl, currentFilename }) {
  const [uploading, setUploading]   = useState(false);
  const [progress, setProgress]     = useState(0);
  const [error, setError]           = useState('');
  // edit mode: existing filename দিয়ে শুরু করো
  const [uploadedFile, setUploadedFile] = useState(
    currentFilename
      ? { filename: currentFilename, url: currentUrl, size_mb: null, ext: currentFilename.split('.').pop() }
      : null
  );
  const fileRef      = useRef();
  const abortCtrlRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // একই file আবার select করা যাবে

    setError(''); setProgress(0); setUploading(true); setUploadedFile(null);

    const formData = new FormData();
    formData.append('video_file', file);

    // AbortController — cancel বাটনের জন্য
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    try {
      // api instance ব্যবহার করি — token interceptor + base URL automatically correct
      const res = await api.post('/livetv/ftp-content/upload-video/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: ctrl.signal,
        onUploadProgress: (ev) => {
          if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      setUploadedFile(res.data);
      setProgress(100);
      onUploaded(res.data.url, res.data.filename);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') return; // user cancel
      const msg = err?.response?.data?.detail
        || err?.response?.data?.video_file?.[0]
        || `আপলোড ব্যর্থ (${err?.response?.status || 'নেটওয়ার্ক সমস্যা'})`;
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    abortCtrlRef.current?.abort();
    setUploading(false); setProgress(0);
  };

  const handleRemove = async () => {
    if (!uploadedFile?.filename) return;
    try {
      await api.delete('/livetv/ftp-content/delete-upload/', { data: { filename: uploadedFile.filename } });
    } catch (_) {}
    setUploadedFile(null); setProgress(0);
    onUploaded('', null);
  };

  const SIZE_LABELS = {
    '.mp4': 'সর্বোচ্চ সামঞ্জস্যপূর্ণ', '.mkv': 'ভালো', '.webm': 'ভালো',
    '.avi': 'পুরনো format', '.mov': 'পুরনো format',
  };

  return (
    <div className="space-y-3">
      {/* Upload zone */}
      <div
        className={`relative border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer
          ${uploading ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-[#173d59] hover:bg-slate-50'}`}
        role="button" tabIndex={0}
        onClick={() => !uploading && fileRef.current?.click()}
        onKeyDown={(e) => { if (!uploading && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fileRef.current?.click(); } }}
      >
        <input ref={fileRef} type="file" accept={SUPPORTED_FORMATS} className="hidden" onChange={handleFile} />
        {uploading ? (
          <div className="space-y-2">
            <div className="text-2xl animate-bounce">⬆️</div>
            <p className="text-sm font-semibold text-blue-700">আপলোড হচ্ছে... {progress}%</p>
            <div className="w-full bg-blue-100 rounded-full h-2.5">
              <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <button onClick={e => { e.stopPropagation(); handleCancel(); }}
              className="text-xs text-rose-500 hover:text-rose-700 mt-1">✕ বাতিল</button>
          </div>
        ) : uploadedFile ? (
          <div className="space-y-1">
            <div className="text-3xl">✅</div>
            <p className="text-sm font-bold text-emerald-700">{uploadedFile.filename}</p>
            <p className="text-xs text-gray-500">{uploadedFile.size_mb} MB • {uploadedFile.ext?.toUpperCase()}</p>
            <div className="flex justify-center gap-3 mt-2">
              <button onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-100">↺ পরিবর্তন</button>
              <button onClick={e => { e.stopPropagation(); handleRemove(); }}
                className="text-xs bg-rose-50 text-rose-600 px-3 py-1.5 rounded-lg hover:bg-rose-100">🗑 মুছুন</button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-4xl">🎬</div>
            <p className="text-sm font-semibold text-gray-700">ভিডিও ফাইল বেছে নিন বা এখানে ড্রপ করুন</p>
            <p className="text-xs text-gray-400">MP4, MKV, WebM, AVI, MOV, TS, FLV, 3GP, WMV</p>
            <span className="inline-block mt-1 bg-[#173d59] text-white text-xs px-4 py-1.5 rounded-full">📂 ফাইল বেছে নিন</span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-xl">
          ❌ {error}
        </div>
      )}

      {/* Format guide */}
      <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">App Compatibility (ExoPlayer)</p>
        <div className="flex flex-wrap gap-2">
          {[['MP4', '★★★★★', 'text-emerald-700 bg-emerald-50'], ['MKV', '★★★★', 'text-blue-700 bg-blue-50'], ['WebM', '★★★★', 'text-blue-700 bg-blue-50'], ['AVI', '★★★', 'text-amber-700 bg-amber-50'], ['TS', '★★★', 'text-amber-700 bg-amber-50'], ['FLV', '★★', 'text-gray-700 bg-gray-100']].map(([fmt, stars, cls]) => (
            <span key={fmt} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-semibold ${cls}`}>
              {fmt} <span className="opacity-70 text-[10px]">{stars}</span>
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">💡 সর্বোচ্চ সামঞ্জস্যের জন্য <strong>MP4 (H.264)</strong> ব্যবহার করুন।</p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// থাম্বনেইল ইমেজ আপলোড কম্পোনেন্ট
// ══════════════════════════════════════════════════════════════════════════════

function ThumbnailUploader({ onUploaded, currentUrl, currentFilename }) {
  const [uploading, setUploading]   = useState(false);
  const [progress, setProgress]     = useState(0);
  const [error, setError]           = useState('');
  const [uploadedFile, setUploadedFile] = useState(
    currentFilename
      ? { filename: currentFilename, url: currentUrl, size_kb: null, ext: currentFilename.split('.').pop() }
      : null
  );
  const fileRef      = useRef();
  const abortCtrlRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setError(''); setProgress(0); setUploading(true); setUploadedFile(null);

    const formData = new FormData();
    formData.append('thumbnail_file', file);

    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    try {
      const res = await api.post('/livetv/ftp-content/upload-thumbnail/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: ctrl.signal,
        onUploadProgress: (ev) => {
          if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      setUploadedFile(res.data);
      setProgress(100);
      onUploaded(res.data.url, res.data.filename);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') return;
      const msg = err?.response?.data?.detail
        || err?.response?.data?.thumbnail_file?.[0]
        || `আপলোড ব্যর্থ (${err?.response?.status || 'নেটওয়ার্ক সমস্যা'})`;
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => { abortCtrlRef.current?.abort(); setUploading(false); setProgress(0); };

  const handleRemove = async () => {
    if (!uploadedFile?.filename) return;
    try {
      await api.delete('/livetv/ftp-content/delete-thumbnail/', { data: { filename: uploadedFile.filename } });
    } catch (_) {}
    setUploadedFile(null); setProgress(0);
    onUploaded('', null);
  };

  return (
    <div className="space-y-3">
      <div
        className={`relative border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer
          ${uploading ? 'border-purple-300 bg-purple-50' : 'border-gray-200 hover:border-[#173d59] hover:bg-slate-50'}`}
        role="button" tabIndex={0}
        onClick={() => !uploading && fileRef.current?.click()}
        onKeyDown={(e) => { if (!uploading && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fileRef.current?.click(); } }}
      >
        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.avif" className="hidden" onChange={handleFile} />

        {uploading ? (
          <div className="space-y-2">
            <div className="text-2xl animate-bounce">🖼️</div>
            <p className="text-sm font-semibold text-purple-700">আপলোড হচ্ছে... {progress}%</p>
            <div className="w-full bg-purple-100 rounded-full h-2.5">
              <div className="bg-purple-500 h-2.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <button onClick={e => { e.stopPropagation(); handleCancel(); }} className="text-xs text-rose-500 mt-1">✕ বাতিল</button>
          </div>
        ) : uploadedFile ? (
          <div className="space-y-2">
            {uploadedFile.url && (
              <img src={uploadedFile.url} alt="thumb" className="h-32 mx-auto rounded-xl object-cover border border-gray-200" onError={e => e.target.style.display='none'} />
            )}
            <p className="text-sm font-bold text-emerald-700">✅ {uploadedFile.filename}</p>
            {uploadedFile.size_kb && <p className="text-xs text-gray-500">{uploadedFile.size_kb} KB • {uploadedFile.ext?.toUpperCase()}</p>}
            <div className="flex justify-center gap-3 mt-1">
              <button onClick={e => { e.stopPropagation(); fileRef.current?.click(); }} className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-100">↺ পরিবর্তন</button>
              <button onClick={e => { e.stopPropagation(); handleRemove(); }} className="text-xs bg-rose-50 text-rose-600 px-3 py-1.5 rounded-lg hover:bg-rose-100">🗑 মুছুন</button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-4xl">🖼️</div>
            <p className="text-sm font-semibold text-gray-700">কভার ইমেজ আপলোড করুন</p>
            <p className="text-xs text-gray-400">JPG, PNG, WebP, GIF, AVIF</p>
            <span className="inline-block mt-1 bg-[#173d59] text-white text-xs px-4 py-1.5 rounded-full">📂 ছবি বেছে নিন</span>
          </div>
        )}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-xl">❌ {error}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2: কন্টেন্ট ডেটাবেজ
// ══════════════════════════════════════════════════════════════════════════════

function ContentForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_CONTENT, ...initial });
  const [saving, setSaving]             = useState(false);
  const [videoMode, setVideoMode]       = useState(initial?.video_filename     ? 'upload' : 'url');
  const [thumbMode, setThumbMode]       = useState(initial?.thumbnail_filename ? 'upload' : 'url');
  const [uploadedVideo, setUploadedVideo]   = useState(initial?.video_filename     || null);
  const [uploadedThumb, setUploadedThumb]   = useState(initial?.thumbnail_filename || null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleVideoUploaded = (url, filename) => { set('video_url', url);      setUploadedVideo(filename); };
  const handleThumbUploaded = (url, filename) => { set('thumbnail_url', url);  setUploadedThumb(filename); };

  const handleSubmit = async () => {
    if (!form.title.trim()) return alert('শিরোনাম দিন।');
    setSaving(true);
    try {
      await onSave({
        ...form,
        video_filename:     uploadedVideo || '',
        thumbnail_filename: uploadedThumb || '',
      });
    } finally { setSaving(false); }
  };

  const F = ({ label, name, type = 'text', placeholder, hint, colSpan }) => (
    <div className={colSpan}>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      <input type={type} value={form[name] ?? ''} onChange={e => set(name, e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]" />
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800 text-lg">{initial?.id ? '✏️ কন্টেন্ট সম্পাদনা' : '➕ নতুন কন্টেন্ট যোগ'}</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100">✕</button>
      </div>

      {/* Type selector */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">ধরন</label>
        <div className="flex gap-2">
          {Object.entries(TYPE_LABELS).map(([k, l]) => (
            <button key={k} onClick={() => set('content_type', k)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${form.content_type === k ? 'border-[#173d59] bg-[#173d59] text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <F label="শিরোনাম *" name="title" placeholder="মুভি / নাটকের নাম" colSpan="md:col-span-1" />
        <F label="বছর" name="year" type="number" placeholder="2024" colSpan="" />
        <F label="ভাষা" name="language" placeholder="বাংলা" colSpan="" />
      </div>

      <F label="ঘরানা (Genre)" name="genre" placeholder="Action, Drama, Comedy" hint="কমা দিয়ে আলাদা করুন" colSpan="" />

      {/* সিরিজ fields */}
      {form.content_type === 'series' && (
        <div className="bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">সিরিজ তথ্য</p>
          <F label="সিরিজের নাম" name="series_title" placeholder="সিরিজের মূল নাম" colSpan="" />
          <div className="grid grid-cols-2 gap-3">
            <F label="সিজন" name="season" type="number" placeholder="1" colSpan="" />
            <F label="এপিসোড" name="episode" type="number" placeholder="1" colSpan="" />
          </div>
        </div>
      )}

      {/* ভিডিও — URL বা Upload */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">ভিডিও সোর্স</label>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-4">
          {[['url', '🔗 URL লিংক'], ['upload', '⬆️ ফাইল আপলোড']].map(([mode, label]) => (
            <button key={mode} onClick={() => setVideoMode(mode)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${videoMode === mode ? 'bg-white shadow text-[#173d59]' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {videoMode === 'url' ? (
          <div>
            <input
              type="text" value={form.video_url || ''} onChange={e => set('video_url', e.target.value)}
              placeholder="http://192.168.1.1/movies/example.mp4"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#173d59]"
            />
            <p className="text-xs text-gray-400 mt-1">FTP / HTTP ডাইরেক্ট লিংক — App-এ এটি প্লে হবে</p>
          </div>
        ) : (
          <VideoUploader
            onUploaded={handleVideoUploaded}
            currentUrl={form.video_url}
            currentFilename={initial?.video_filename || ''}
          />
        )}

        {form.video_url && videoMode === 'upload' && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="text-emerald-600 text-sm">✓</span>
            <p className="text-xs text-emerald-700 font-mono break-all flex-1">{form.video_url}</p>
          </div>
        )}
      </div>

      {/* Thumbnail */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">থাম্বনেইল / কভার ইমেজ</label>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-4">
          {[['url', '🔗 URL লিংক'], ['upload', '🖼️ ছবি আপলোড']].map(([mode, label]) => (
            <button key={mode} onClick={() => setThumbMode(mode)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${thumbMode === mode ? 'bg-white shadow text-[#173d59]' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {thumbMode === 'url' ? (
          <div>
            <input type="text" value={form.thumbnail_url || ''} onChange={e => set('thumbnail_url', e.target.value)}
              placeholder="http://... অথবা https://..."
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]" />
            <p className="text-xs text-gray-400 mt-1">বাইরের ইমেজ লিংক — ঐচ্ছিক</p>
            {form.thumbnail_url && (
              <img src={form.thumbnail_url} alt="preview"
                className="h-28 rounded-xl object-cover border border-gray-200 mt-2"
                onError={e => e.target.style.display = 'none'} />
            )}
          </div>
        ) : (
          <ThumbnailUploader
            onUploaded={handleThumbUploaded}
            currentUrl={form.thumbnail_url}
            currentFilename={initial?.thumbnail_filename || ''}
          />
        )}
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">বিবরণ</label>
        <textarea value={form.description || ''} onChange={e => set('description', e.target.value)}
          rows={3} placeholder="সংক্ষিপ্ত বিবরণ..."
          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#173d59]" />
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="w-4 h-4 accent-[#173d59]" />
        <span className="text-sm font-medium text-gray-700">সক্রিয় (App-এ দেখাবে)</span>
      </label>

      <div className="flex gap-3 pt-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50">বাতিল</button>
        <button onClick={handleSubmit} disabled={saving}
          className="flex-1 py-2.5 rounded-xl bg-[#173d59] text-white text-sm font-semibold hover:bg-[#1f5075] disabled:opacity-40">
          {saving ? '⟳ সংরক্ষণ হচ্ছে...' : (initial?.id ? '💾 আপডেট করুন' : '✅ যোগ করুন')}
        </button>
      </div>
    </div>
  );
}

function ContentCard({ item, onEdit, onDelete, onToggle }) {
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    await onToggle(item);
    setToggling(false);
  };

  const handleDelete = async () => {
    if (!confirm(`"${item.title}" মুছে দেওয়া হবে?`)) return;
    setDeleting(true);
    await onDelete(item);
  };

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden flex transition-opacity ${!item.is_active ? 'opacity-50' : ''} ${deleting ? 'opacity-30 pointer-events-none' : ''}`}>
      {/* Thumbnail */}
      <div className="w-20 h-28 flex-shrink-0 bg-gray-100 flex items-center justify-center relative">
        {item.thumbnail_url
          ? <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />
          : <span className="text-3xl">🎬</span>
        }
        <div className={`absolute top-1 left-1 text-[9px] px-1.5 py-0.5 rounded font-bold text-white ${item.content_type === 'movie' ? 'bg-blue-500' : item.content_type === 'drama' ? 'bg-purple-500' : 'bg-green-500'}`}>
          {item.content_type === 'movie' ? 'MOVIE' : item.content_type === 'drama' ? 'DRAMA' : 'SERIES'}
        </div>
      </div>
      <div className="flex-1 p-3 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-800 text-sm truncate">{item.title}</p>
            {item.content_type === 'series' && item.episode && (
              <p className="text-xs text-indigo-600 font-medium">S{item.season || 1}E{item.episode} {item.series_title && `— ${item.series_title}`}</p>
            )}
            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400 flex-wrap">
              {item.year && <span>{item.year}</span>}
              {item.language && <span>• {item.language}</span>}
              {item.genre && <span>• {item.genre.split(',')[0]}</span>}
            </div>
            {item.video_url
              ? <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <span>✓</span>
                  <span className="font-mono truncate">{item.video_url.length > 40 ? item.video_url.slice(0, 40) + '…' : item.video_url}</span>
                </p>
              : <p className="text-xs text-amber-500 mt-1">⚠ ভিডিও URL নেই</p>
            }
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button onClick={handleToggle} disabled={toggling}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium ${item.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {toggling ? '⟳' : item.is_active ? '● সক্রিয়' : '○ বন্ধ'}
            </button>
            <button onClick={() => onEdit(item)} className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100">✏️ সম্পাদনা</button>
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-40">
              {deleting ? '⟳' : '🗑 মুছুন'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContentTab() {
  const [items, setItems]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showForm, setShowForm]       = useState(false);
  const [editItem, setEditItem]       = useState(null);
  const [filterType, setFilterType]   = useState('');
  const [search, setSearch]           = useState('');
  const [msg, setMsg]                 = useState(null);

  const flash = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3500);
  };

  const load = (type = filterType, q = search) => {
    setLoading(true);
    const params = {};
    if (type) params.type = type;
    if (q)    params.q = q;
    api.get('/livetv/ftp-content/', { params }).then(r => {
      setItems(r.data); setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (formData) => {
    if (editItem?.id) {
      const r = await api.patch(`/livetv/ftp-content/${editItem.id}/`, formData);
      setItems(prev => prev.map(it => it.id === editItem.id ? r.data : it));
      flash('✅ কন্টেন্ট আপডেট হয়েছে।');
    } else {
      const r = await api.post('/livetv/ftp-content/', formData);
      setItems(prev => [r.data, ...prev]);
      flash('✅ নতুন কন্টেন্ট যোগ হয়েছে।');
    }
    setShowForm(false); setEditItem(null);
  };

  const handleEdit = (item) => { setEditItem(item); setShowForm(true); };

  const handleDelete = async (item) => {
    await api.delete(`/livetv/ftp-content/${item.id}/`);
    setItems(prev => prev.filter(it => it.id !== item.id));
    flash(`🗑 "${item.title}" মুছে গেছে।`);
  };

  const handleToggle = async (item) => {
    const r = await api.patch(`/livetv/ftp-content/${item.id}/`, { is_active: !item.is_active });
    setItems(prev => prev.map(it => it.id === item.id ? r.data : it));
  };

  const counts = {
    all:    items.length,
    movie:  items.filter(i => i.content_type === 'movie').length,
    drama:  items.filter(i => i.content_type === 'drama').length,
    series: items.filter(i => i.content_type === 'series').length,
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          {msg.text}
        </div>
      )}

      {showForm && (
        <ContentForm
          initial={editItem}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditItem(null); }}
        />
      )}

      {/* Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {[['', 'সকল', counts.all], ['movie', '🎬 মুভি', counts.movie], ['drama', '📺 নাটক', counts.drama], ['series', '📂 সিরিজ', counts.series]].map(([k, l, c]) => (
              <button key={k} onClick={() => { setFilterType(k); load(k, search); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filterType === k ? 'bg-white shadow text-[#173d59]' : 'text-gray-500 hover:text-gray-700'}`}>
                {l} <span className="ml-1 opacity-60">({c})</span>
              </button>
            ))}
          </div>
          <input
            value={search} onChange={e => { setSearch(e.target.value); load(filterType, e.target.value); }}
            placeholder="🔍 শিরোনাম খুঁজুন..."
            className="flex-1 min-w-40 border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]"
          />
          <button onClick={() => { setEditItem(null); setShowForm(true); }}
            className="ml-auto bg-[#173d59] hover:bg-[#1f5075] text-white px-4 py-2 rounded-full text-sm font-semibold">
            + নতুন কন্টেন্ট
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[['🎬', 'মুভি', counts.movie, 'text-blue-600'], ['📺', 'নাটক', counts.drama, 'text-purple-600'], ['📂', 'সিরিজ', counts.series, 'text-green-600']].map(([em, lb, ct, cls]) => (
          <div key={lb} className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
            <span className="text-xl">{em}</span>
            <p className={`text-lg font-bold mt-0.5 ${cls}`}>{ct}</p>
            <p className="text-xs text-gray-400">{lb}</p>
          </div>
        ))}
      </div>

      {/* List */}
      {loading
        ? <div className="text-center py-12 text-gray-400">লোড হচ্ছে...</div>
        : items.length === 0
          ? <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
              <div className="text-5xl mb-3">🎬</div>
              <p className="text-gray-500 font-medium">কোনো কন্টেন্ট নেই</p>
              <p className="text-sm text-gray-400 mt-1">উপরের "+ নতুন কন্টেন্ট" বাটন দিয়ে প্রথম মুভি/নাটক যোগ করুন</p>
              <button onClick={() => { setEditItem(null); setShowForm(true); }}
                className="mt-4 bg-[#173d59] text-white px-6 py-2.5 rounded-full text-sm font-semibold">
                + নতুন কন্টেন্ট যোগ করুন
              </button>
            </div>
          : <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {items.map(item => (
                <ContentCard key={item.id} item={item} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} />
              ))}
            </div>
      }
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function FTPMovieServerPage() {
  const [activeTab, setActiveTab] = useState('server');

  const tabs = [
    { key: 'server',  label: '🗄️ FTP সার্ভার' },
    { key: 'content', label: '🎬 কন্টেন্ট ডেটাবেজ' },
  ];

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🎬 FTP Movie Server</h1>
        <p className="text-sm text-gray-500 mt-1">Live TV App-এ FTP সার্ভার ও মুভি/নাটক/সিরিজ কন্টেন্ট পরিচালনা করুন</p>
      </div>

      <div className="flex gap-1 bg-white rounded-2xl border border-slate-200 shadow-sm p-1.5 mb-6 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === t.key ? 'bg-[#173d59] text-white shadow' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'server'  && <ServerTab />}
      {activeTab === 'content' && <ContentTab />}
    </div>
  );
}
