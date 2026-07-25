import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, Linking, Alert, Dimensions,
} from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';

const { width: SW } = Dimensions.get('window');

export default function BannerDetailScreen({ navigation, route }) {
  const banner  = route.params?.banner || {};
  const imgUri  = banner.image_url || banner.image || '';
  const hasLink = !!banner.link_url;
  const [ratio, setRatio] = useState(null);   // ছবির আসল aspect ratio

  // পূর্ণ-প্রস্থ hero; খুব লম্বা ছবি হলে উচ্চতা সীমিত
  const imgH = ratio ? Math.min(SW / ratio, SW * 1.2) : SW * 0.6;

  const openLink = () => {
    if (hasLink) Linking.openURL(banner.link_url).catch(() => Alert.alert('Could not open the link'));
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#eef2f7' }}>
      <ScreenHeader title="Details" onBack={() => navigation.goBack()} color="#3b5998" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Hero ছবি — পূর্ণ-প্রস্থ */}
        {imgUri ? (
          <Image
            source={{ uri: imgUri }}
            style={{ width: SW, height: imgH, backgroundColor: '#dbe3f0' }}
            resizeMode="cover"
            onLoad={e => {
              const { width, height } = e.nativeEvent.source || {};
              if (width && height) setRatio(width / height);
            }}
          />
        ) : (
          <View style={styles.heroEmpty}><Text style={{ fontSize: 58 }}>📢</Text></View>
        )}

        {/* বিবরণ কার্ড — ছবির উপর সামান্য overlap */}
        <View style={styles.card}>
          <View style={styles.eyebrow}>
            <Text style={styles.eyebrowTxt}>📢  Offer / Notice</Text>
          </View>

          <Text style={styles.title}>{banner.title}</Text>
          <View style={styles.divider} />

          {banner.body
            ? <Text style={styles.text}>{banner.body}</Text>
            : <Text style={styles.textMuted}>No details available.</Text>}

          {hasLink && (
            <TouchableOpacity style={styles.linkBtn} onPress={openLink} activeOpacity={0.88}>
              <Text style={styles.linkBtnTxt}>Learn More / Open Link  ›</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#3b5998',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center', justifyContent: 'center',
  },
  backTxt:     { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: -3 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },

  heroEmpty: { width: SW, height: SW * 0.5, backgroundColor: '#dbe3f0', alignItems: 'center', justifyContent: 'center' },

  card: {
    backgroundColor: '#fff',
    marginHorizontal: 14, marginTop: -24,
    borderRadius: 20, padding: 20,
    shadowColor: '#3b5998', shadowOpacity: 0.14, shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  eyebrow: {
    alignSelf: 'flex-start', backgroundColor: '#eef2fb',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 12,
  },
  eyebrowTxt: { color: '#3b5998', fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3 },
  title:   { fontSize: 21, fontWeight: '900', color: '#0f2d42', lineHeight: 29 },
  divider: { height: 3, width: 44, backgroundColor: '#3b82f6', borderRadius: 2, marginTop: 12, marginBottom: 14 },
  text:    { fontSize: 15, color: '#475569', lineHeight: 24 },
  textMuted: { fontSize: 14, color: '#94a3b8', fontStyle: 'italic' },
  linkBtn: {
    backgroundColor: '#3b5998', borderRadius: 14,
    paddingVertical: 15, alignItems: 'center', marginTop: 24,
    shadowColor: '#3b5998', shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  linkBtnTxt: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
});
