import axios from 'axios';
import Constants from 'expo-constants';

const BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl || 'https://roisp.duckdns.org/api/v1';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Live TV subscriber session invalid হয়ে গেলে (admin deactivate করলে বা মেয়াদ
// শেষ হলে) backend প্রতিটা endpoint-এ 401 + auth_required:true পাঠায়। আগে কোনো
// screen-ই এটা handle করত না — user শুধু frozen/stale UI দেখত, কোনো কারণ জানত
// না। AuthContext নিজেকে এখানে register করে যাতে global-ভাবে auto logout +
// Login screen-এ স্পষ্ট বার্তা দেখানো যায়।
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const authRequired = err.response?.data?.auth_required;
    if (status === 401 && authRequired && unauthorizedHandler) {
      unauthorizedHandler(err.response?.data?.detail);
    }
    return Promise.reject(err);
  }
);

export default api;
