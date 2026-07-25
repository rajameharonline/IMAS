# ════════════════════════════════════════════════════════════
#  Walled Garden — payment-allow auto-refresh (RouterOS 6.49)
#  expired client-দের app পেমেন্টের জন্য API + bKash IP নিয়মিত
#  re-resolve করে payment-allow list আপডেট রাখে (IP বদলালেও কাজ করে)।
#
#  Install (প্রতি router-এ একবার):
#   1) এই script যোগ করুন:  /system script
#      name=wg-payment-refresh  source={...নিচের :local ... অংশ...}
#   2) scheduler-এ প্রতি ৬ ঘণ্টায় চালান:
#      /system scheduler add name=wg-payment-refresh interval=6h \
#          on-event="/system script run wg-payment-refresh"
# ════════════════════════════════════════════════════════════

# ── যে domain গুলোর IP allow থাকবে ──
:local domains {"roisp.duckdns.org"; "tokenized.pay.bka.sh"; "www.bkash.com"}

# ── পুরনো auto-entry মুছি (comment "WG-auto" দিয়ে চিহ্নিত) ──
/ip firewall address-list remove [/ip firewall address-list find list="payment-allow" comment~"WG-auto"]

# ── প্রতিটি domain resolve করে payment-allow-এ যোগ ──
:foreach d in=$domains do={
    :do {
        :local ip [:resolve $d]
        /ip firewall address-list add list="payment-allow" address=$ip comment=("WG-auto " . $d)
    } on-error={ :log warning ("wg-payment-refresh: resolve failed for " . $d) }
}

# নোট: portal-এর fixed IP (172.16.3.254) আলাদাভাবে manually যোগ করা আছে
#      (comment "WG: ISP portal") — script সেটা মুছবে না।
