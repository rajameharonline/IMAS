# OLT Real-time SNMP Trap → প্রজেক্ট সেটআপ

OLT থেকে real-time ONU **link up/down, register/deregister** ইভেন্ট সরাসরি প্রজেক্টে আনতে
(৫ মিনিট poll-এর অপেক্ষা ছাড়া)। `snmp_trap_listener` (pysnmp) trap শোনে এবং `ONUSignal`/
`OLTMacCache` live আপডেট করে; প্রতিটি trap `SNMPTrapLog`-এ সংরক্ষিত হয়।

## ১. সার্ভারে trap listener চালু

```bash
# একবার পরীক্ষা (port 1162, root লাগে না):
cd /var/www/isp_bnas && source venv/bin/activate
python manage.py snmp_trap_listener --host 0.0.0.0 --port 1162

# স্থায়ী service (port 162, standard) — root একবার:
sudo install -m 0644 deploy/isp-snmptrap.service /etc/systemd/system/isp-snmptrap.service
sudo systemctl daemon-reload
sudo systemctl enable --now isp-snmptrap.service
sudo systemctl status isp-snmptrap.service
# লগ: tail -f /var/www/isp_bnas/logs/snmptrap.log
```

> port 162 bind করতে unit-এ `AmbientCapabilities=CAP_NET_BIND_SERVICE` দেওয়া আছে (root ছাড়াই)।

## ২. Firewall — UDP 162 খোলা

```bash
sudo ufw allow 162/udp        # অথবা আপনার firewall অনুযায়ী
```

## ৩. OLT-এর trap config (V-SOL web UI)

`System Configuration → SNMP → SNMPV1/V2 → Add Trap`:

| Field | মান |
|---|---|
| Host | **আপনার প্রজেক্ট সার্ভারের IP** (api.ince.vsol-tech.com নয়) |
| UDP Port | `162` |
| Community Name | `public` |
| SNMP Version | `2c` (v2c) |

> বর্তমানে trap V-SOL cloud-এ যাচ্ছে — উপরের Host আপনার সার্ভারের IP দিন। চাইলে `Slave Server`-এ
> দুটোই রাখা যায়। **Save** চাপতে ভুলবেন না।

## ৪. যাচাই

```bash
# কোনো ONU plug/unplug করুন, অথবা লোকালি একটি test trap পাঠান:
snmptrap -v2c -c public <server-ip>:162 '' 1.3.6.1.6.3.1.1.5.3 \
    1.3.6.1.2.1.2.2.1.2.10 s "EPON0/1:5"
```
তারপর admin shell-এ:
```python
from olt_mgmt.models import SNMPTrapLog
SNMPTrapLog.objects.order_by('-created_at')[:5].values('source_ip','event','interface_id','handled')
```

## নোট — V-SOL vendor trap OID

V-SOL enterprise (`1.3.6.1.4.1.37950.*`) trap-এর exact register/dereg OID firmware-ভেদে আলাদা।
listener এগুলো `event=unknown`/`onu_register`/`onu_dereg` হিসেবে **store করে রাখে**। কয়েকটি আসল
trap পাওয়ার পর `SNMPTrapLog.varbinds` দেখে `olt_mgmt/services/trap_service.py`-তে exact OID
mapping যোগ করা হবে — তখন vendor trap-ও নির্ভুলভাবে handle হবে।

## সম্পর্কিত — TX power / temperature / voltage (V-SOL: auto)

V-SOL OLT-এর জন্য TX power, temperature, voltage **এখন স্বয়ংক্রিয়ভাবে** poll হয় (OID discover
করে wire করা: optical table `12.2.1.8.1` → .3=temp, .4=voltage, .6=TX, .7=RX)। celery worker
restart-এর পর ONU Monitoring-এ TX/temp/voltage দেখা যাবে (TX → ONUSignal.tx_power; temp/voltage
→ raw_data)। ভিন্ন firmware/vendor হলে:
```bash
python manage.py snmp_discover <olt-ip>           # column-wise OID→value
# TX OID আলাদা হলে OLT edit → "TX Power OID" (tx_snmp_oid) দিন
```
