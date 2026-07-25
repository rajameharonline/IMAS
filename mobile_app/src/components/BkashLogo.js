import { View, Text, Image } from 'react-native';

// আসল bKash পাখি (high-res raster, assets/bkash-bird.png)
const BIRD = require('../../assets/bkash-bird.png');
const BIRD_RATIO = 1412 / 1334;   // width / height

// শুধু পাখি — size = উচ্চতা (px)। ছোট square জায়গার জন্য।
export function BkashBird({ size = 20 }) {
  return (
    <Image
      source={BIRD}
      style={{ height: size, width: size * BIRD_RATIO }}
      resizeMode="contain"
    />
  );
}

// পূর্ণ lockup — "bKash" wordmark (পিংক "b" + কালো "Kash") + আসল পাখি
// হালকা/সাদা background-এ ব্যবহার করুন (official রঙ ঠিক দেখাতে)
export default function BkashLogo({ height = 16, dark = '#2B2B2B' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Text style={{ fontSize: height, fontWeight: '700', letterSpacing: -0.4 }}>
        <Text style={{ color: '#E2136E' }}>b</Text>
        <Text style={{ color: dark }}>Kash</Text>
      </Text>
      <BkashBird size={height * 1.35} />
    </View>
  );
}
