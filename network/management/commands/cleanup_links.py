"""
network/management/commands/cleanup_links.py

Usage:
  python manage.py cleanup_links            # dry-run (কিছু মুছবে না)
  python manage.py cleanup_links --fix      # actual deletion
"""

from django.core.management.base import BaseCommand
from network.models import NetworkLink


def _link_info_score(lk):
    """একটি link-এ কত port/fiber info আছে তার স্কোর (বেশি হলে বেশি "সম্পূর্ণ")।"""
    score = 0
    if lk.source_port:
        score += 2
    if lk.target_port:
        score += 2
    if lk.fiber_core_color:
        score += 1
    return score


def _find_port_duplicates(links, to_delete):
    """Rule 1: একই node-এর একই port দুই link-এ থাকলে নতুনটা (বড় id) duplicate।"""
    seen_port = {}   # (node_id, port) → first_link_id
    for lk in links:
        for node_id, port in [(lk.source_node_id, lk.source_port),
                              (lk.target_node_id, lk.target_port)]:
            if not port:
                continue
            key = (node_id, port)
            if key in seen_port:
                node_name = lk.source_node.name if node_id == lk.source_node_id else lk.target_node.name
                to_delete[lk.id] = (
                    f'Port duplicate: port "{port}" on {node_name} '
                    f'already used by Link#{seen_port[key]}'
                )
            else:
                seen_port[key] = lk.id


def _find_client_multi_links(links, to_delete):
    """Rule 2: CLIENT node → সর্বোচ্চ ১ connection; বেশি হলে সবচেয়ে বেশি-info লিংক রেখে বাকি মুছো।"""
    client_links = {}    # client_node_id → [link, ...]
    for lk in links:
        for node_id, node_type in [(lk.source_node_id, lk.source_node.node_type),
                                   (lk.target_node_id, lk.target_node.node_type)]:
            if node_type == 'CLIENT':
                client_links.setdefault(node_id, []).append(lk)
    for node_id, clk_list in client_links.items():
        if len(clk_list) <= 1:
            continue
        clk_sorted = sorted(clk_list, key=_link_info_score, reverse=True)
        keep = clk_sorted[0]
        for lk in clk_sorted[1:]:
            to_delete.setdefault(lk.id, (
                f'CLIENT single-port violation: Client node#{node_id} '
                f'has {len(clk_list)} connections; keeping Link#{keep.id}'
            ))


def _find_portless_redundant(links, to_delete):
    """Rule 3: একই node-pair-এ port-less পুরনো link redundant যখন port-সহ link-ও আছে।"""
    pair_map = {}   # frozenset({src, tgt}) → [links]
    for lk in links:
        key = frozenset({lk.source_node_id, lk.target_node_id})
        pair_map.setdefault(key, []).append(lk)
    for pair_links in pair_map.values():
        if len(pair_links) <= 1:
            continue
        no_port = [lk for lk in pair_links if not lk.source_port and not lk.target_port]
        with_port = [lk for lk in pair_links if lk.source_port or lk.target_port]
        if no_port and with_port:
            keep_ids = [l.id for l in with_port]
            for lk in no_port:
                to_delete.setdefault(lk.id, (
                    f'Port-less redundant link between same node pair; '
                    f'port-specified link(s) kept: {keep_ids}'
                ))


class Command(BaseCommand):
    help = 'Duplicate / invalid NetworkLink সনাক্ত করে রিপোর্ট দেয় (--fix দিলে মুছে ফেলে)।'

    def add_arguments(self, parser):
        parser.add_argument(
            '--fix',
            action='store_true',
            help='Duplicate link গুলো actually delete করো (ডিফল্ট: dry-run রিপোর্ট মাত্র)',
        )

    def handle(self, *args, **options):
        fix = options['fix']
        links = list(
            NetworkLink.objects.select_related('source_node', 'target_node')
            .order_by('id')
        )
        to_delete = {}   # id → reason string

        _find_port_duplicates(links, to_delete)      # Rule 1
        _find_client_multi_links(links, to_delete)   # Rule 2
        _find_portless_redundant(links, to_delete)   # Rule 3

        # ── Report ────────────────────────────────────────────────────────────────
        if not to_delete:
            self.stdout.write(self.style.SUCCESS('✓ কোনো duplicate / invalid link পাওয়া যায়নি।'))
            return

        self.stdout.write(
            self.style.WARNING(f'\n{len(to_delete)}টি সমস্যাযুক্ত link পাওয়া গেছে:\n')
        )
        for lid, reason in sorted(to_delete.items()):
            lk = next(l for l in links if l.id == lid)
            self.stdout.write(
                f'  Link#{lid}: {lk.source_node.name}({lk.source_port or "-"}) → '
                f'{lk.target_node.name}({lk.target_port or "-"})'
            )
            self.stdout.write(f'    ↳ {reason}')

        if fix:
            NetworkLink.objects.filter(id__in=to_delete.keys()).delete()
            self.stdout.write(
                self.style.SUCCESS(f'\n✓ {len(to_delete)}টি link মুছে ফেলা হয়েছে।')
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    '\nDry-run mode। মুছতে হলে: python manage.py cleanup_links --fix'
                )
            )
