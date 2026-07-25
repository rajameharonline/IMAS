# Auto invoice number generator utility।
from sales.models import ProductSalesInvoice, ServiceSalesInvoice


def next_product_invoice_no():
    # PINV-000001 format-এ পরবর্তী invoice number বের করা।
    last = (
        ProductSalesInvoice.objects
        .order_by('-invoice_no')
        .values_list('invoice_no', flat=True)
        .first()
    )
    if last:
        raw = ''.join(ch for ch in str(last) if ch.isdigit())
        try:
            return f'PINV-{int(raw) + 1:06d}'
        except (TypeError, ValueError):
            pass
    return 'PINV-000001'


def next_service_invoice_no():
    # SINV-000001 format-এ পরবর্তী service invoice number।
    last = (
        ServiceSalesInvoice.objects
        .order_by('-invoice_no')
        .values_list('invoice_no', flat=True)
        .first()
    )
    if last:
        raw = ''.join(ch for ch in str(last) if ch.isdigit())
        try:
            return f'SINV-{int(raw) + 1:06d}'
        except (TypeError, ValueError):
            pass
    return 'SINV-000001'
