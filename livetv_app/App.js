import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme } from '@react-navigation/native';

import MenuScreen           from './src/screens/home/MenuScreen';
import HomeScreen           from './src/screens/home/HomeScreen';
import ChannelListScreen    from './src/screens/channels/ChannelListScreen';
import PlayerScreen         from './src/screens/player/PlayerScreen';
import LoginScreen          from './src/screens/auth/LoginScreen';
import FTPListScreen        from './src/screens/ftp/FTPListScreen';
import WebViewScreen        from './src/screens/ftp/WebViewScreen';
import FTPContentScreen     from './src/screens/ftp/FTPContentScreen';
import FTPVideoPlayerScreen from './src/screens/ftp/FTPVideoPlayerScreen';
import ErrorBoundary        from './src/components/ErrorBoundary';
import { AuthProvider, useAuth } from './src/context/AuthContext';

const Stack = createNativeStackNavigator();

const NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#111',
    card:        '#1a1a1a',
    text:        '#fff',
    border:      '#222',
    primary:     '#e55a00',
    notification: '#e55a00',
  },
};

function RootStack() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e50914" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={NAV_THEME}>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {!user ? (
          // Auth screens
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          // App screens
          <>
            <Stack.Screen name="Menu"        component={MenuScreen} />
            <Stack.Screen name="Home"        component={HomeScreen} />
            <Stack.Screen name="ChannelList" component={ChannelListScreen} />
            <Stack.Screen
              name="Player"
              component={PlayerScreen}
              options={{ orientation: 'all' }}
            />
            <Stack.Screen name="FTPList"        component={FTPListScreen} />
            <Stack.Screen name="WebView"        component={WebViewScreen} />
            <Stack.Screen name="FTPContent"     component={FTPContentScreen} />
            <Stack.Screen
              name="FTPVideoPlayer"
              component={FTPVideoPlayerScreen}
              options={{ orientation: 'all' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SafeAreaProvider>
          <RootStack />
        </SafeAreaProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
