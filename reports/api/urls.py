from django.urls import path
from reports.api.views import (
    bill_collection_report, customer_report,
    due_customer_report, financial_report
)

urlpatterns = [
    path('bill-collection/', bill_collection_report),
    path('customers/', customer_report),
    path('due-customers/', due_customer_report),
    path('financial/', financial_report),
]
