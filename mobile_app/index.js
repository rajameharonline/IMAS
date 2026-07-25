import { registerRootComponent } from 'expo';

// ⚠️ App register-এর আগে FCM background handler + CallKeep events bind করতে হয়,
// নইলে অ্যাপ killed অবস্থায় ইনকামিং কল রিং দেখাবে না।
import './src/services/messaging';

// ⚠️ TaskManager.defineTask() module load-এই call হওয়া দরকার (registerRootComponent-এর আগে)।
import './src/services/backgroundService';

// ⚠️ notifee.registerForegroundService() module load-এই call হতে হয় (App register-এর আগে)।
import './src/services/foregroundService';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
