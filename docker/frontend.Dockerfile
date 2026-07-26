# admin_panel + user_portal (Vite/React) build + nginx serve — multi-stage।
# আলাদা Dockerfile কারণ root Dockerfile Python/Django ইমেজ, এটা Node build + nginx।
#
# গুরুত্বপূর্ণ: dist/ ফোল্ডার .gitignore-এ আছে (host-এ ম্যানুয়াল vite build করে
# volume-mount করার পুরনো পদ্ধতি ছিল), তাই fresh git clone-এ dist/ থাকে না —
# Coolify/CI থেকে সরাসরি docker compose build করলে nginx-এ blank site দেখাত।
# এই multi-stage build repo থেকে সরাসরি dist/ তৈরি করে, তাই host-এ আলাদা
# `vite build` চালানোর দরকার নেই — শুধু `docker compose build` যথেষ্ট।

# vite@8/rolldown-এর নেটিভ optional dependency (@rolldown/binding-linux-x64-gnu)
# engines: node ^20.19.0 || >=22.12.0 চায় — এর নিচে থাকলে npm optional দেপ silently
# skip করে আর build "Cannot find module rolldown-binding..." দিয়ে fail করে।
# 22-alpine দিয়ে এই সীমা নিয়ে কোনো অস্পষ্টতা রাখা হলো না।
ARG NODE_VERSION=22-alpine

# --- admin_panel ---
FROM node:${NODE_VERSION} AS admin_panel_build
WORKDIR /src
COPY admin_panel/package.json admin_panel/package-lock.json ./
# --legacy-peer-deps: react-leaflet@4.2.1-এর peerDependency react@^18.0.0 এখনো
# React 19-কে অন্তর্ভুক্ত করেনি (React 19-এর সাথে বাস্তবে কাজ করে, শুধু peer range
# আপডেট হয়নি) — এটা ছাড়া npm ci ERESOLVE error দিয়ে fail করে।
RUN npm ci --legacy-peer-deps
COPY admin_panel/ .
# Vite env var build-time-এ bake হয় (runtime-configurable নয়) — /api/v1 একই origin
# দিয়ে nginx-এর /api/ proxy_pass ব্যবহার করে, অন্য origin থেকে serve করলে
# `docker compose build --build-arg VITE_API_BASE_URL=https://yourdomain/api/v1` দিন।
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# --- user_portal ---
FROM node:${NODE_VERSION} AS user_portal_build
WORKDIR /src
COPY user_portal/package.json user_portal/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY user_portal/ .
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# --- nginx ---
FROM nginx:1.27-alpine
COPY --from=admin_panel_build /src/dist /var/www/IMAS/admin_panel/dist
COPY --from=user_portal_build /src/dist /var/www/IMAS/user_portal/dist
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
