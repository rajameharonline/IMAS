// SIP registration ডিবাগ ব্যাজ — register না হলে ছোট করে দেখায় কেন আটকেছে।
// উদ্দেশ্য: ফোনেই (logcat ছাড়া) বোঝা যাক — native-module নেই / WSS connect fail / auth fail।
// register সফল হলে কিছুই দেখায় না (production-এ নীরব)।
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { useCall } from '../../context/CallContext';

const LABEL = {
  idle: 'VoIP: নিষ্ক্রিয়',
  connecting: 'VoIP: সংযোগ হচ্ছে…',
  registered: 'VoIP: প্রস্তুত',
  failed: 'VoIP: ব্যর্থ',
  disabled: 'VoIP: বন্ধ',
};
const COLOR = {
  connecting: '#a16207', registered: '#16a34a', failed: '#e11d48', disabled: '#475569', idle: '#475569',
};

export default function SipStatusBadge() {
  const cc = useCall();
  const [open, setOpen] = useState(false);
  if (!cc) return null;
  const { status, error } = cc;
  // সব ঠিক থাকলে (registered) কিছু দেখাই না।
  if (status === 'registered') return null;

  return (
    <TouchableOpacity
      style={[styles.badge, { backgroundColor: COLOR[status] || '#475569' }]}
      onPress={() => setOpen((o) => !o)}
      activeOpacity={0.8}
    >
      <Text style={styles.txt}>{LABEL[status] || status}</Text>
      {open && error ? <Text style={styles.err}>{String(error)}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: 44, right: 8, zIndex: 9999,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, maxWidth: 260,
  },
  txt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  err: { color: '#ffe', fontSize: 10, marginTop: 4 },
});
