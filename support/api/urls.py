# Support module-এর সব REST API endpoint route এখান থেকে wire করা হয়েছে।
# DRF DefaultRouter দিয়ে standard CRUD + custom @action সব নিজে থেকে expose হয়।
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from support.api.views import (
    SupportCategoryViewSet,
    SupportTicketViewSet,
    StaffNotificationViewSet,
)

router = DefaultRouter()
# /support/categories/  → TicketType lookup (Fiber Cut, Router Issue, ...)
router.register(r'categories', SupportCategoryViewSet, basename='support-category')
# /support/tickets/     → main ticket CRUD + assign / change-status / reply
router.register(r'tickets',    SupportTicketViewSet,   basename='support-ticket')
# /support/notifications/ → staff bell badge feed
router.register(r'notifications', StaffNotificationViewSet, basename='support-notification')

urlpatterns = [
    path('', include(router.urls)),
]
