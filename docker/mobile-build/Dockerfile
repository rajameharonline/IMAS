# মোবাইল অ্যাপ (mobile_app/, livetv_app/) — Expo/EAS local Android build কন্টেইনার।
# উদ্দেশ্য: production সার্ভারের বদলে আলাদা বিল্ড-মেশিনে (172.16.6.10) এই ভারী
# Gradle/Android SDK toolchain চালানো — production RAM/disk-এর সাথে প্রতিযোগিতা এড়াতে।
FROM eclipse-temurin:17-jdk-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    NODE_VERSION=20

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        unzip \
        wget \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 — NodeSource-এর "curl | bash" সেটআপ script সরাসরি pipe করে চালানো হতো
# আগে (SonarCloud docker:S8482 — downloaded script যাচাই ছাড়া execute করা ঠিক না)।
# এর বদলে GPG-signed apt repo নিজে যোগ করছি — script download/execute করার দরকার নেই।
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL --proto '=https' --tlsv1.2 https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g --ignore-scripts eas-cli@latest expo-cli@latest

# Android cmdline-tools + platform 35 + build-tools 35 + NDK — Expo SDK 54/RN 0.81-এর
# baseline; Gradle প্রয়োজনে network থেকে বাড়তি component নিজেই আনতে পারবে (license
# আগে থেকেই accept করা আছে বলে)।
#
# SHA-256 checksum pin করা (SonarCloud docker:S8482 — unverified downloaded artifact
# সরাসরি execute করা ঠিক না) — নিজে download করে sha256sum দিয়ে verify করা হয়েছে
# (২০২৬-০৭-১০, commandlinetools-linux-14742923_latest.zip, ১৭২.৮MB, Google-এর
# developer.android.com/studio#command-line-tools-only পেজের সাথে সাইজ মিলিয়ে
# নিশ্চিত করা)। checksum না মিললে build fail হবে, silently ভুল ফাইল ব্যবহার হবে না।
ARG ANDROID_CMDLINE_TOOLS_VERSION=14742923
ARG ANDROID_CMDLINE_TOOLS_SHA256=04453066b540409d975c676d781da1477479dde3761310f1a7eb92a1dfb15af7
RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
    && cd /tmp \
    && wget -q --https-only --max-redirect=0 "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip" -O cmdline-tools.zip \
    && echo "${ANDROID_CMDLINE_TOOLS_SHA256}  cmdline-tools.zip" | sha256sum -c - \
    && unzip -q cmdline-tools.zip -d "${ANDROID_HOME}/cmdline-tools" \
    && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" \
    && rm cmdline-tools.zip

ENV PATH=${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools

RUN yes | sdkmanager --licenses >/dev/null 2>&1 || true \
    && sdkmanager \
        "platform-tools" \
        "platforms;android-35" \
        "build-tools;35.0.0" \
        "ndk;27.1.12297006"

WORKDIR /build

# entrypoint script container-এর বাইরে থেকে mount হবে (docker/mobile-build/build.sh) —
# এতে script পরিবর্তন করতে image rebuild লাগবে না।
ENTRYPOINT ["/bin/bash"]
