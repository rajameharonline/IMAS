from django.contrib import admin
from .models import TVChannel


@admin.register(TVChannel)
class TVChannelAdmin(admin.ModelAdmin):
    list_display = ['name', 'category', 'status', 'ffmpeg_pid', 'created_at']
    list_filter  = ['status', 'category']
    search_fields = ['name']
    readonly_fields = ['ffmpeg_pid', 'status', 'stream_started_at', 'created_at', 'updated_at']
