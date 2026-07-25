# Task Management module-এর সব REST API endpoint route এখান থেকে wire করা হয়।
# DRF DefaultRouter দিয়ে standard CRUD + custom @action সব auto-expose হয়।
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from tasks_mgmt.api.views import (
    TaskViewSet,
    TaskCategoryViewSet,
)

router = DefaultRouter()
# /tasks/categories/  → Task Category lookup (Installation, Maintenance, ...)
router.register(r'categories', TaskCategoryViewSet, basename='task-category')
# /tasks/tasks/       → main Task CRUD + my-tasks / change-status / assign / stats
router.register(r'tasks', TaskViewSet, basename='task')

urlpatterns = [
    path('', include(router.urls)),
]
