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
# (ARG দিয়ে parametrize করা হয়নি ইচ্ছাকৃতভাবে — Coolify-র build-secrets Dockerfile
# rewriter প্রতিটা stage-এ নিজের ARG ইনজেক্ট করে, যেটা global ARG-ভিত্তিক
# FROM node:${NODE_VERSION} প্যাটার্নকে ভেঙে "invalid reference format" error দিয়েছিল)
FROM node:22-alpine AS admin_panel_build
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
FROM node:22-alpine AS user_portal_build
# admin_panel_build স্টেজের উপর একটা কৃত্রিম নির্ভরতা — এই COPY না থাকলে BuildKit
# দুটো independent Node/Vite build (ভারী: xlsx/leaflet/jspdf/recharts সহ) একসাথে
# parallel-এ চালাত, যেটা কম-RAM সার্ভারে (~3.3G, build-এর আগেই মাত্র ~1.5G ফাঁকা)
# OOM kill ঘটিয়ে exit code 255 দিচ্ছিল কোনো স্পষ্ট error ছাড়াই। এই dependency দিয়ে
# দুটো build সিরিয়ালি চলতে বাধ্য হয়, peak memory কমে।
COPY --from=admin_panel_build /src/dist /tmp/_admin_panel_dist_marker
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
