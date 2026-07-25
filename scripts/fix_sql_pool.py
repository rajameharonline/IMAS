#!/usr/bin/env python3
"""
FreeRADIUS SQL module pool fix — connection pool বাড়ানো
Backup রাখা হবে root-only ডিরেক্টরিতে (mods-enabled/ এ নয়, world-readable /tmp/-এও নয়)।
"""
import re, os, sys, shutil
from datetime import datetime

candidates = [
    "/etc/freeradius/3.0/mods-enabled/sql",
    "/etc/freeradius/3.0/mods-available/sql",
]

sql_path = None
for path in candidates:
    if os.path.isfile(path):
        sql_path = path
        break

if not sql_path:
    print("[SKIP] SQL module config not found")
    sys.exit(0)

print(f"[INFO] Found: {sql_path}")

# এই config-এ plaintext DB password থাকে — /tmp/ world-readable/writable (SonarCloud
# python:S5443), তাই backup mods-enabled/-এর বাইরে কিন্তু root-only একটা ডিরেক্টরিতে
# রাখা হয়, ও ফাইল permission স্পষ্টভাবে 0600-এ সীমিত করা হয়।
BACKUP_DIR = "/etc/freeradius/3.0/.backups"
os.makedirs(BACKUP_DIR, mode=0o700, exist_ok=True)
os.chmod(BACKUP_DIR, 0o700)
ts = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = os.path.join(BACKUP_DIR, f"sql.conf.bak.{ts}")
shutil.copy2(sql_path, backup)
os.chmod(backup, 0o600)
print(f"[INFO] Backup: {backup}")

with open(sql_path, 'r') as f:
    content = f.read()

original = content

replacements = [
    (r'(max_connections\s*=\s*)\d+', r'\g<1>32'),
    (r'(min_connections\s*=\s*)\d+', r'\g<1>5'),
    (r'(idle_timeout\s*=\s*)\d+',    r'\g<1>60'),
    (r'\b(start\s*=\s*)\d+',         r'\g<1>5'),
    (r'\b(spare\s*=\s*)\d+',         r'\g<1>10'),
]

for pattern, repl in replacements:
    content = re.sub(pattern, repl, content)

if content != original:
    with open(sql_path, 'w') as f:
        f.write(content)
    print("[OK] SQL pool updated: max=32, min=5, idle=60")
    print(f"[INFO] Restore with: sudo cp {backup} {sql_path}")
else:
    print("[INFO] SQL pool — no numeric settings found")
