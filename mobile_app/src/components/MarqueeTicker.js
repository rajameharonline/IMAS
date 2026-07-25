import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useFrameCallback,
} from 'react-native-reanimated';

// নোটিশের মাঝে স্পষ্ট বিভাজক
const SEP = '   ◆   ';

// পাঁচটি copy — যেকোনো screen width ঢাকার জন্য যথেষ্ট, fixed (dynamic change → jitter)
const COPIES     = 5;
const COPIES_ARR = Array.from({ length: COPIES });

export default function MarqueeTicker({ text, speed = 60, color = '#1e3a8a', bg = '#dbeafe' }) {
  const [unitW, setUnitW] = useState(0);

  // Shared values — worklet-এ access হবে (JS closure হলে stale হয়)
  const sharedUnitW = useSharedValue(0);
  const elapsed     = useSharedValue(0);  // মোট scroll pixel — কখনো reset নেই

  const tickerText = (text || '').replace(/\n+/g, SEP);
  const unit       = tickerText + SEP;

  // unitW পরিমাপ হলে shared value sync + elapsed reset (নতুন নোটিশে শুরু থেকে)
  useEffect(() => {
    sharedUnitW.value = unitW;
    elapsed.value     = 0;
  }, [unitW]);

  // ── useFrameCallback: প্রতি frame-এ UI thread-এ elapsed বাড়াই ──────────────
  // withRepeat-এর মতো reset নেই → কোনো jump/khapu নেই।
  // modulo (%) দিয়ে position wrap → সম্পূর্ণ seamless।
  useFrameCallback((frame) => {
    'worklet';
    if (sharedUnitW.value <= 0) return;
    elapsed.value += (frame.timeSincePreviousFrame ?? 16) / 1000 * speed;
  });

  const animStyle = useAnimatedStyle(() => {
    const uw = sharedUnitW.value;
    if (uw <= 0) return { transform: [{ translateX: 0 }], opacity: 0 };
    // elapsed % uw: position কখনো -uw-এর নিচে যায় না — seamless wrap
    return {
      transform: [{ translateX: -(elapsed.value % uw) }],
      opacity: 1,
    };
  });

  if (!text) return null;

  return (
    <View style={[s.wrapper, { backgroundColor: bg }]}>
      {/* পরিমাপের Text — wrapper-এ absolute (overflow:hidden-এর বাইরে) */}
      <Text
        style={[s.tickerText, s.measure, { color }]}
        onLayout={e => setUnitW(e.nativeEvent.layout.width)}
        pointerEvents="none"
      >
        {unit}
      </Text>

      <View style={s.row}>
        {/* স্থির NOTICE badge */}
        <View style={s.badge}>
          <Text style={s.badgeIcon}>📢</Text>
          <Text style={s.badgeText}>NOTICE</Text>
        </View>

        <View style={s.divider} />

        {/* চলন্ত area */}
        <View style={s.overflow}>
          <Animated.View style={[s.track, animStyle]}>
            {COPIES_ARR.map((_, i) => (
              <Text key={i} style={[s.tickerText, { color }]}>{unit}</Text>
            ))}
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {},

  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
  },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f59e0b',
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginLeft: 10,
    borderRadius: 4,
  },
  badgeIcon: { fontSize: 11 },
  badgeText: {
    color: '#1e1e1e',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },

  divider: {
    width: 1,
    height: 18,
    backgroundColor: '#cbd5e1',
    marginHorizontal: 10,
  },

  overflow: {
    flex: 1,
    height: 26,
    overflow: 'hidden',
  },

  track: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },

  tickerText: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 0,
  },
});
