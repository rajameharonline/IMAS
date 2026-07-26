# FreeRADIUS on PostgreSQL — network_mode: host থাকবে (docker-compose.yml দ্রষ্টব্য),
# কারণ RADIUS প্রোটোকল raw UDP (1812/1813/3799) + NAS (MikroTik) client-IP-নির্ভর,
# bridge network-এর NAT-এর পেছনে সঠিক client IP FreeRADIUS দেখতে পায় না।
FROM alpine:3.20

RUN apk add --no-cache \
        freeradius \
        freeradius-postgresql \
        freeradius-utils \
        postgresql-client \
        bash

# আসল mods-available/sql-এর জায়গায় আমাদের PostgreSQL+env-var ভার্সন বসানো,
# তারপর mods-enabled-এ symlink করে module সক্রিয় করা (PRD_POSTGRES_REBUILD.md §7.1)
COPY mods-available/sql /etc/raddb/mods-available/sql
RUN ln -sf /etc/raddb/mods-available/sql /etc/raddb/mods-enabled/sql

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 1812/udp 1813/udp 3799/udp

ENTRYPOINT ["entrypoint.sh"]
CMD ["radiusd", "-f", "-l", "stdout"]
