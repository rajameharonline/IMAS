import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

// সব screen-এর জন্য consistent dark header — status bar এলাকা header-এর রঙে ঢেকে দেয়
// (edge-to-edge-এ আইকন দৃশ্যমান থাকে, "উপরের অংশ দেখা যায় না" সমস্যা ঠিক হয়)।
export default function ScreenHeader({ title, subtitle, onBack, right, color = '#0f2d42' }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: color, paddingTop: insets.top }}>
      <StatusBar style="light" />
      <View style={styles.bar}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backTxt}>‹</Text>
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right || null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14, gap: 8,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  backTxt:  { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: -3 },
  title:    { color: '#fff', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#93c5fd', fontSize: 12, fontWeight: '600', marginTop: 1 },
});
