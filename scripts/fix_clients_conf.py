#!/usr/bin/env python3
"""
FreeRADIUS clients.conf fix — BlastRADIUS security update
require_message_authenticator = true যোগ করে সব client block এ
"""
import sys

CONF_PATH = "/etc/freeradius/3.0/clients.conf"

with open(CONF_PATH, 'r') as f:
    lines = f.readlines()

result = []
in_client = False
brace_depth = 0
block_lines = []
block_has_auth = False

def flush_block(blines, has_auth):
    if not has_auth:
        for idx in range(len(blines) - 1, -1, -1):
            if blines[idx].strip() == '}':
                blines.insert(idx, '\trequire_message_authenticator = true\n')
                break
    return blines

for line in lines:
    stripped = line.strip()
    if not in_client and stripped.startswith('client ') and stripped.endswith('{'):
        in_client = True
        brace_depth = 1
        block_lines = [line]
        block_has_auth = False
    elif in_client:
        block_lines.append(line)
        brace_depth += stripped.count('{') - stripped.count('}')
        if 'require_message_authenticator' in line:
            block_has_auth = True
        if brace_depth <= 0:
            result.extend(flush_block(block_lines, block_has_auth))
            in_client = False
            block_lines = []
    else:
        result.append(line)

with open(CONF_PATH, 'w') as f:
    f.writelines(result)

print("[OK] clients.conf updated — require_message_authenticator = true added")
