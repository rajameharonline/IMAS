# ════════════════════════════════════════════════════════════
#  WALLED GARDEN — Payment whitelist স্থায়ীকরণ (DNS-force + auto refresh)
#  RouterOS 6.49 | MTK_PPP-তে একবার paste করুন।
#
#  কী করে: expired client-দের DNS router-এ আনে, payment domain গুলো
#  fixed IP-তে pin করে এবং payment-allow list আপডেট রাখে। প্রতি ৩ ঘণ্টায়
#  re-resolve করে — তাই CDN/bKash IP বদলালেও পেমেন্ট নিজে নিজে কাজ করে।
#
#  নিরাপদ: সব কিছু শুধু "expired" address-list-এর client-দের জন্য;
#          active client সম্পূর্ণ অপ্রভাবিত।
#
#  Rollback (দরকার হলে):
#    /system scheduler remove [find name=wg-payment-refresh]
#    /system script remove [find name=wg-payment-refresh]
#    /ip firewall address-list remove [find comment~"WG-auto"]
#    /ip dns static remove [find comment~"WG-auto"]
#    /ip firewall nat remove [find comment~"WG: expired DNS"]
#    /ip firewall filter remove [find comment~"WG: expired DNS in"]
# ════════════════════════════════════════════════════════════

# ── 1) expired client-এর DNS জোর করে router-এ আনি (একবার) ──
/ip dns set allow-remote-requests=yes
/ip firewall nat add chain=dstnat src-address-list=expired protocol=udp dst-port=53 \
    action=redirect to-ports=53 comment="WG: expired DNS"
/ip firewall nat add chain=dstnat src-address-list=expired protocol=tcp dst-port=53 \
    action=redirect to-ports=53 comment="WG: expired DNS"
/ip firewall filter add chain=input src-address-list=expired protocol=udp dst-port=53 \
    action=accept place-before=0 comment="WG: expired DNS in"
/ip firewall filter add chain=input src-address-list=expired protocol=tcp dst-port=53 \
    action=accept place-before=0 comment="WG: expired DNS in"

# ── 2) refresh script (resolve → DNS static pin + payment-allow) ──
/system script add name=wg-payment-refresh dont-require-permissions=no policy=read,write,test source={
    :local domains {"payment.bkash.com"; "api.paystation.com.bd"; "tokenized.pay.bka.sh"; \
        "cdn.jsdelivr.net"; "cdnjs.cloudflare.com"; "code.jquery.com"; "c.tenor.com"; \
        "fonts.googleapis.com"; "fonts.gstatic.com"; "roisp.duckdns.org"}
    # পুরনো auto entry মুছি (manually-added "WG:" entry অক্ষত থাকে)
    /ip firewall address-list remove [/ip firewall address-list find list="payment-allow" comment~"WG-auto"]
    /ip dns static remove [/ip dns static find comment~"WG-auto"]
    :foreach d in=$domains do={
        :do {
            :local ip [:resolve $d]
            /ip dns static add name=$d address=$ip comment=("WG-auto " . $d)
            /ip firewall address-list add list="payment-allow" address=$ip comment=("WG-auto " . $d)
        } on-error={ :log warning ("wg-payment: resolve fail " . $d) }
    }
    :log info "wg-payment-refresh: payment whitelist updated"
}

# ── 3) scheduler — প্রতি ৩ ঘণ্টায় + boot-এ চালায় ──
/system scheduler add name=wg-payment-refresh interval=3h start-time=startup \
    on-event="/system script run wg-payment-refresh" comment="WG payment whitelist auto-refresh"

# ── 4) এখনই একবার চালাই ──
/system script run wg-payment-refresh
