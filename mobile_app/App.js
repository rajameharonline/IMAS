import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { CallProvider } from './src/context/CallContext';
import CallScreen from './src/screens/call/CallScreen';
// notifications: top-level import এড়ানো হয়েছে — Expo Go crash ঠেকাতে lazy load
const { registerForPushNotifications, setupNotificationListeners } =
  require('./src/services/notifications');

// Auth screens — Customer Code + Password login + self-registration
import LoginScreen      from './src/screens/auth/LoginScreen';
import ClientCodeScreen from './src/screens/auth/ClientCodeScreen';
import RegisterScreen   from './src/screens/auth/RegisterScreen';

// Main screens
import HomeScreen          from './src/screens/home/HomeScreen';
import TrafficScreen       from './src/screens/home/TrafficScreen';
import BannerDetailScreen  from './src/screens/home/BannerDetailScreen';
import NotificationsScreen from './src/screens/home/NotificationsScreen';
import WebViewScreen       from './src/screens/home/WebViewScreen';
import BillListScreen      from './src/screens/billing/BillListScreen';
import InvoiceScreen       from './src/screens/billing/InvoiceScreen';
import RechargeScreen      from './src/screens/billing/RechargeScreen';
import PackageScreen       from './src/screens/billing/PackageScreen';
import BkashWebViewScreen  from './src/screens/billing/BkashWebViewScreen';
import { PaymentSuccessScreen, PaymentCancelledScreen } from './src/screens/billing/PaymentResultScreen';
import ProfileScreen       from './src/screens/profile/ProfileScreen';
import SmsScreen           from './src/screens/sms/SmsScreen';
import SupportListScreen   from './src/screens/support/SupportListScreen';
import SupportCreateScreen from './src/screens/support/SupportCreateScreen';
import SupportDetailScreen from './src/screens/support/SupportDetailScreen';
import AIChatScreen        from './src/screens/support/AIChatScreen';
import DialPadScreen       from './src/screens/call/DialPadScreen';
import DueOverlay          from './src/components/DueOverlay';

// Staff/Admin screens (role-based)
import StaffDashboardScreen   from './src/screens/staff/StaffDashboardScreen';
import StaffReportScreen      from './src/screens/staff/StaffReportScreen';
import StaffPendingPaymentsScreen from './src/screens/staff/StaffPendingPaymentsScreen';
import StaffPOPListScreen     from './src/screens/staff/StaffPOPListScreen';
import StaffPOPDetailScreen   from './src/screens/staff/StaffPOPDetailScreen';
import StaffBillsScreen       from './src/screens/staff/StaffBillsScreen';
import StaffHRScreen          from './src/screens/staff/StaffHRScreen';
import AdminPanelScreen       from './src/screens/staff/AdminPanelScreen';
import StaffSupportListScreen from './src/screens/staff/StaffSupportListScreen';
import StaffTicketDetailScreen from './src/screens/staff/StaffTicketDetailScreen';
import StaffClientListScreen   from './src/screens/staff/StaffClientListScreen';
import StaffClientDetailScreen from './src/screens/staff/StaffClientDetailScreen';
// POP reseller screens
import POPHomeScreen         from './src/screens/pop/POPHomeScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// ── Footer tab bar styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#fff',
    borderTopWidth: 0,
    height: 68,
    paddingBottom: 10,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    shadowColor: '#1e293b', shadowOpacity: 0.12, shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 }, elevation: 18,
    overflow: 'visible',  // raised call button উপরে উঠতে পারবে
  },
  tabIconWrap: {
    width: 46, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  tabIconWrapActive: { backgroundColor: '#e0e9fb' },

  // ── Raised center call button ───────────────────────────────────
  callTabOuter: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: -26,          // tab bar উপরে উঠে
    width: 70,
  },
  callTabCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22c55e',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 14,
    borderWidth: 3,
    borderColor: '#fff',
  },
  callTabCircleActive: {
    backgroundColor: '#15803d',
    shadowOpacity: 0.8,
  },
  callTabIcon: { fontSize: 24 },
  callTabLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#16a34a',
    marginTop: 5,
  },
  callTabLabelActive: { color: '#15803d' },
});

// ── Tab Icons ─────────────────────────────────────────────────────────────
function tabIcon(name, focused) {
  const icons = {
    Home:    focused ? '🏠' : '🏠',
    Bills:   focused ? '💵' : '💵',
    Support: focused ? '🎫' : '🎫',
    SMS:     focused ? '📩' : '📨',
    Profile: focused ? '👤' : '👥',
  };
  return icons[name] || '•';
}

// ── Raised circular call button (center tab) ──────────────────────────────
function CallTabButton({ onPress, accessibilityState }) {
  const focused = accessibilityState?.selected;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.callTabOuter}
      activeOpacity={0.82}
      accessible
      accessibilityLabel="সাপোর্টে কল করুন"
      accessibilityRole="button"
    >
      <View style={[styles.callTabCircle, focused && styles.callTabCircleActive]}>
        <Text style={styles.callTabIcon}>📞</Text>
      </View>
      <Text style={[styles.callTabLabel, focused && styles.callTabLabelActive]}>কল করুন</Text>
    </TouchableOpacity>
  );
}

// ── Home Stack ────────────────────────────────────────────────────────────
function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="Traffic"  component={TrafficScreen} />
      <Stack.Screen name="BannerDetail" component={BannerDetailScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="WebView"  component={WebViewScreen} />
      <Stack.Screen name="Invoice"          component={InvoiceScreen} />
      <Stack.Screen name="Recharge"         component={RechargeScreen} />
      <Stack.Screen name="Package"          component={PackageScreen} />
      <Stack.Screen name="BkashWebView"     component={BkashWebViewScreen}     options={{ gestureEnabled: false }} />
      <Stack.Screen name="PaymentSuccess"   component={PaymentSuccessScreen}   options={{ gestureEnabled: false }} />
      <Stack.Screen name="PaymentCancelled" component={PaymentCancelledScreen} options={{ gestureEnabled: false }} />
    </Stack.Navigator>
  );
}

// ── Main Tab Navigator ─────────────────────────────────────────────────────
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => (
          <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
            <Text style={{ fontSize: 18 }}>{tabIcon(route.name, focused)}</Text>
          </View>
        ),
        tabBarActiveTintColor:   '#173d59',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: { paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700', marginTop: 2 },
      })}
    >
      <Tab.Screen name="Home"    component={HomeStack}     options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="Bills"   component={BillListScreen} options={{ tabBarLabel: 'Bills' }} />
      {/* Center raised call button — সাপোর্ট হটলাইন ডায়াল প্যাড */}
      <Tab.Screen
        name="DialPad"
        component={DialPadScreen}
        options={{
          tabBarLabel: () => null,
          tabBarButton: (props) => <CallTabButton {...props} />,
          // DialPad screen-এ tab bar hide — screen-এর নিজস্ব call button-ই একমাত্র button।
          // floating CallTabButton (marginTop:-26) DialPad-এর button-এর উপরে overlap করত।
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tab.Screen name="Support" component={SupportStack}  options={{ tabBarLabel: 'Support' }} />
      <Tab.Screen name="SMS"     component={SmsScreen}     options={{ tabBarLabel: 'SMS' }} />
      {/* Profile tab bar-এ দেখায় না — header-এর 👤 button দিয়ে খোলে।
          display:'none' দিলে slot-টাও layout থেকে সরে, ডানে খালি জায়গা থাকে না */}
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarItemStyle: { display: 'none' } }} />
    </Tab.Navigator>
  );
}

// ── Support Stack ──────────────────────────────────────────────────────────
function SupportStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SupportList"   component={SupportListScreen} />
      <Stack.Screen name="SupportCreate" component={SupportCreateScreen} />
      <Stack.Screen name="SupportDetail" component={SupportDetailScreen} />
      <Stack.Screen name="AIChat"        component={AIChatScreen} />
    </Stack.Navigator>
  );
}

// ── Staff Home Stack — Home tab = web Admin Panel WebView (role-aware) ──
// এমপ্লয়ির হোমস্ক্রিন এখন superadmin-এর মতোই পূর্ণ admin panel WebView দেখায়,
// web panel-ই role permission অনুযায়ী Employee Panel (profile + salary + permitted
// cards/menu) render করে। পুরনো native StaffDashboard ও অন্য staff screens deep
// navigation-এর জন্য registered থাকল।
function StaffHomeStack() {
  return (
    <Stack.Navigator initialRouteName="AdminPanel" screenOptions={{ headerShown: false }}>
      {/* home:true → AdminPanelScreen brand header দেখায় (admin app-এর মতো), back-bar নয় */}
      <Stack.Screen name="AdminPanel"     component={AdminPanelScreen} initialParams={{ home: true }} />
      <Stack.Screen name="StaffDashboard" component={StaffDashboardScreen} />
      <Stack.Screen name="StaffReport"    component={StaffReportScreen} />
      <Stack.Screen name="StaffPendingPayments" component={StaffPendingPaymentsScreen} />
      <Stack.Screen name="StaffPOPList"   component={StaffPOPListScreen} />
      <Stack.Screen name="StaffPOPDetail" component={StaffPOPDetailScreen} />
      <Stack.Screen name="StaffBills"     component={StaffBillsScreen} />
      <Stack.Screen name="StaffHR"        component={StaffHRScreen} />
      {/* DialPad — bottom tab থেকে সরানো হয়েছে; home header-এর call button এখান দিয়েই খোলে */}
      <Stack.Screen name="DialPad"        component={DialPadScreen} />
    </Stack.Navigator>
  );
}

// ── Staff Support Stack ──
function StaffSupportStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="StaffSupportList"   component={StaffSupportListScreen} />
      <Stack.Screen name="StaffTicketDetail"  component={StaffTicketDetailScreen} />
    </Stack.Navigator>
  );
}

// ── Staff Client Stack ──
function StaffClientStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="StaffClientList"   component={StaffClientListScreen} />
      <Stack.Screen name="StaffClientDetail" component={StaffClientDetailScreen} />
    </Stack.Navigator>
  );
}

// ── Staff tab icons ──
function staffTabIcon(name) {
  const icons = { Home: '🏠', Clients: '👥', Support: '🎫' };
  return icons[name] || '•';
}

// ── Staff/Admin Tabs (Phase 1: Home + Calls + Support) ──
function StaffMain() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => (
          <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
            <Text style={{ fontSize: 18 }}>{staffTabIcon(route.name)}</Text>
          </View>
        ),
        tabBarActiveTintColor:   '#173d59',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: { paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700', marginTop: 2 },
      })}
    >
      {/* নিচের bottom bar-এ শুধু হোম ও সাপোর্ট — কল ও ক্লায়েন্ট button সরানো হয়েছে।
          কল করতে হলে home header-এর green call button (DialPad) ব্যবহার হবে; incoming
          call global CallScreen overlay দিয়ে আসে (tab-এর দরকার নেই)। */}
      <Tab.Screen name="Home"    component={StaffHomeStack}   options={{ tabBarLabel: 'হোম' }} />
      <Tab.Screen name="Support" component={StaffSupportStack} options={{ tabBarLabel: 'সাপোর্ট' }} />
    </Tab.Navigator>
  );
}

// ── Super Admin Navigator ──
// superadmin → কোনো tab bar নেই; পূর্ণ admin panel WebView (brand header + logout)
// + floating call button (DialPad)। client/staff nav থেকে আলাদা।
function SuperAdminMain() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AdminPanelHome" component={AdminPanelScreen} />
      <Stack.Screen name="DialPad"        component={DialPadScreen} />
    </Stack.Navigator>
  );
}

// ── POP Reseller Navigator (Phase 1: home dashboard; module screens পরে) ──
function POPMain() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="POPHome" component={POPHomeScreen} />
    </Stack.Navigator>
  );
}

// ── Root Navigator (Auth-aware) ────────────────────────────────────────────
function RootNavigator() {
  const { client, staffUser, popUser, isStaff, isPop, isSuper, accountType, loading } = useAuth();
  const navRef = useRef(null);
  const [routeName, setRouteName] = useState(null);  // current screen — overlay-কে payment/support পেজে লুকাতে

  const authed = !!client || !!staffUser || !!popUser;

  useEffect(() => {
    if (authed) {
      registerForPushNotifications(accountType);
      const cleanup = setupNotificationListeners(navRef);
      return cleanup;
    }
  }, [authed, accountType]);

  if (loading) return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f2d42' }}>
      <ActivityIndicator size="large" color="#3b82f6" />
    </View>
  );

  return (
    <NavigationContainer ref={navRef}
      onReady={() => setRouteName(navRef.current?.getCurrentRoute()?.name)}
      onStateChange={() => setRouteName(navRef.current?.getCurrentRoute()?.name)}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!authed ? (
          <>
            <Stack.Screen name="Login"      component={LoginScreen} />
            <Stack.Screen name="ClientCode" component={ClientCodeScreen} />
            <Stack.Screen name="Register"   component={RegisterScreen} />
          </>
        ) : isStaff && isSuper ? (
          <Stack.Screen name="SuperAdminMain" component={SuperAdminMain} />
        ) : isStaff ? (
          <Stack.Screen name="StaffMain" component={StaffMain} />
        ) : isPop ? (
          <Stack.Screen name="POPMain" component={POPMain} />
        ) : (
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
      {/* DueOverlay শুধু client account-এর জন্য (staff/pop-এর বকেয়া concept নেই) */}
      {!isStaff && !isPop && <DueOverlay navRef={navRef} routeName={routeName} />}
    </NavigationContainer>
  );
}

// ── App Root ───────────────────────────────────────────────────────────────
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <CallProvider>
          <RootNavigator />
          {/* incoming/active কল overlay (Modal — সব স্ক্রিনের উপরে) */}
          <CallScreen />
        </CallProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
