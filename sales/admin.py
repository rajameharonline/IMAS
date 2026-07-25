from django.contrib import admin
from .models import (
    ProductSalesInvoice, ProductSalesInvoiceLine, ProductSalesPayment,
    ServiceSalesInvoice, ServiceSalesInvoiceLine, ServiceSalesPayment,
)

admin.site.register(ProductSalesInvoice)
admin.site.register(ProductSalesInvoiceLine)
admin.site.register(ProductSalesPayment)
admin.site.register(ServiceSalesInvoice)
admin.site.register(ServiceSalesInvoiceLine)
admin.site.register(ServiceSalesPayment)
