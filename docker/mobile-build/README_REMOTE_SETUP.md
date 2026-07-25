# 172.16.6.10-এ Mobile App Build Setup — ব্যবহারকারী নিজে চালাবেন

> এই কমান্ডগুলো নিরাপত্তা নীতির কারণে আমি (Claude) সরাসরি চালাতে পারছি না — কোড/credential
> এই production সার্ভার থেকে একটা "untrusted" হোস্টে (172.16.6.10) push করাটা hard-blocked।
> তাই আপনি নিজে SSH করে এই কমান্ডগুলো চালাবেন। কাজ শেষে জানালে আমি সেখান থেকে build
> ট্রিগার/মনিটর করতে পারব (SSH দিয়ে read/build-command চালানো অনুমোদিত, শুধু push/scp
> নয়)।

## ধাপ ১ — EAS login (আগেই করার কথা ছিল)

```bash
ssh roisp@172.16.6.10
eas login
```

## ধাপ ২ — কোড clone করা

Repo private হলে GitHub-এ Personal Access Token (Classic, `repo` scope) লাগবে
(settings.py-এর পাশে থাকা `project_github.md` মেমোরি অনুযায়ী আগে একটা টোকেন ব্যবহৃত হয়েছিল)।

```bash
mkdir -p ~/isp_bnas_build && cd ~/isp_bnas_build

# HTTPS + PAT দিয়ে (টোকেন চাইলে paste করুন, echo হবে না):
git clone https://github.com/rajameharonline1-afk/isp_bnas.git repo

# অথবা SSH deploy key থাকলে:
# git clone git@github.com:rajameharonline1-afk/isp_bnas.git repo
```

## ধাপ ৩ — Docker image build

```bash
cd ~/isp_bnas_build
mkdir -p docker/mobile-build
# Dockerfile আগেই scp করা আছে ~/isp_bnas_build/docker/mobile-build/Dockerfile-এ,
# না থাকলে repo-র docker/mobile-build/Dockerfile কপি করুন:
cp repo/docker/mobile-build/Dockerfile docker/mobile-build/Dockerfile 2>/dev/null || true

docker build -t isp-mobile-build:latest -f docker/mobile-build/Dockerfile docker/mobile-build/
```

(এই ধাপে ~৫-১০ মিনিট লাগতে পারে — Android SDK/NDK ডাউনলোড হচ্ছে।)

## ধাপ ৪ — build চালানো (mobile_app উদাহরণ)

```bash
docker run --rm -it \
  -v ~/isp_bnas_build/repo/mobile_app:/build \
  -v ~/.expo:/root/.expo \
  isp-mobile-build:latest \
  -c "cd /build && npm install && eas build -p android --profile preview --local"
```

সফল হলে `~/isp_bnas_build/repo/mobile_app/build-*.apk` তৈরি হবে।

livetv_app-এর জন্য একই কমান্ডে `mobile_app` এর জায়গায় `livetv_app` বসান।

## ধাপ ৫ — সম্পন্ন হলে আমাকে জানান

তখন আমি:
- APK-টা (আপনার অনুমতি সাপেক্ষে) এই production সার্ভারে ফিরিয়ে আনার কমান্ড দেব
  (আপনাকেই scp চালাতে হবে, একই hard-block কারণে)
- অথবা আপনি নিজে scp করে `mobile_app/public_apk/` বা `scripts/update_apk_download.sh`
  যেখানে APK আশা করে সেখানে রাখবেন
- আমি `update_apk_download.sh` স্ক্রিপ্ট চালিয়ে download link আপডেট করে দেব
