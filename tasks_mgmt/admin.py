# Task Management মডেলগুলো Django admin-এ register — দ্রুত debugging/lookup-এর জন্য।
from django.contrib import admin

from tasks_mgmt.models import Task, TaskCategory, TaskHistory


@admin.register(TaskCategory)
class TaskCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active', 'color')
    search_fields = ('name',)


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'status', 'priority', 'assigned_to',
                    'deadline', 'notification_sent', 'created_at')
    list_filter = ('status', 'priority')
    search_fields = ('title', 'description')
    date_hierarchy = 'created_at'


@admin.register(TaskHistory)
class TaskHistoryAdmin(admin.ModelAdmin):
    list_display = ('task', 'action', 'performed_by', 'created_at')
    list_filter = ('action',)
