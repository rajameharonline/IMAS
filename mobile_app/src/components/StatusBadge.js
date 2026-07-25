import { View, Text, StyleSheet } from 'react-native';

const COLORS = {
  active:    { bg: '#d1fae5', text: '#065f46' },
  expired:   { bg: '#fee2e2', text: '#991b1b' },
  suspended: { bg: '#fef3c7', text: '#92400e' },
  inactive:  { bg: '#f3f4f6', text: '#6b7280' },
  cancelled: { bg: '#f3f4f6', text: '#6b7280' },
  paid:      { bg: '#d1fae5', text: '#065f46' },
  partial:   { bg: '#fef3c7', text: '#92400e' },
  unpaid:    { bg: '#fee2e2', text: '#991b1b' },
  open:      { bg: '#dbeafe', text: '#1e40af' },
  resolved:  { bg: '#d1fae5', text: '#065f46' },
  closed:    { bg: '#f3f4f6', text: '#6b7280' },
  in_progress: { bg: '#ede9fe', text: '#5b21b6' },
};

export default function StatusBadge({ status }) {
  const cfg = COLORS[status] || { bg: '#f3f4f6', text: '#6b7280' };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.text, { color: cfg.text }]}>
        {(status || '—').replace('_', ' ').toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  text:  { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
});
