from django.contrib import admin
from purchase.models import (
    Vendor, Provider, PurchaseRequisition, PurchaseOrder, PurchaseOrderItem,
    PurchaseBill, ProviderBill, ProviderBillLine, ProviderBillPayment,
)

# পুরোনো vendor/purchase flow এবং নতুন bandwidth provider flow — দুইটাই admin-এ
# register করা হলো, যাতে data repair/debug করতে হলে backend only access থাকলেই হয়।
admin.site.register(Vendor)
admin.site.register(Provider)
admin.site.register(PurchaseRequisition)
admin.site.register(PurchaseOrder)
admin.site.register(PurchaseOrderItem)
admin.site.register(PurchaseBill)
admin.site.register(ProviderBill)
admin.site.register(ProviderBillLine)
admin.site.register(ProviderBillPayment)
