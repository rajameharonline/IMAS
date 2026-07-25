import Constants from 'expo-constants';

// API base URL — app.json-এর extra.apiBaseUrl থেকে নেওয়া হয়।
// domain বদলালে শুধু app.json-এ একবার বদলালেই পুরো অ্যাপে কার্যকর হবে।
export const BASE_URL =
  Constants.expoConfig?.extra?.apiBaseUrl ||
  Constants.manifest?.extra?.apiBaseUrl ||
  'https://roisp.duckdns.org/api/v1';
