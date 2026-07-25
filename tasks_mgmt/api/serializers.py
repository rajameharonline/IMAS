# এই ফাইলটি Task Management module-এর DRF serializer সংজ্ঞা ধারণ করে।
#
# Design rule (support module-এর মতোই): frontend form-এ "task_title" wording
# ব্যবহার হয়, কিন্তু DB field হলো title। তাই alias করি — DB rename ছাড়াই API
# surface পরিষ্কার রাখার জন্য।
#
# Countdown-সংক্রান্ত field (deadline, remaining_seconds, is_overdue,
# effective_status) এখান থেকে expose করা হয় — frontend live timer deadline
# থেকে নিজে tick করে, আর badge/stats backend-computed value ব্যবহার করে।

from rest_framework import serializers

from tasks_mgmt.models import Task, TaskCategory, TaskHistory


# ════════════════════════════════════════════════════════════════════
# Task Category — admin lookup CRUD
# ════════════════════════════════════════════════════════════════════
class TaskCategorySerializer(serializers.ModelSerializer):
    task_count = serializers.SerializerMethodField()

    class Meta:
        model = TaskCategory
        fields = ['id', 'name', 'description', 'color', 'is_active', 'task_count']
        read_only_fields = ['id']

    def get_task_count(self, obj):
        # কোন category-তে কতগুলো task — admin lookup-এ দেখানোর জন্য।
        return obj.task_set.count() if hasattr(obj, 'task_set') else 0


# ════════════════════════════════════════════════════════════════════
# Task History — read-only audit timeline
# ════════════════════════════════════════════════════════════════════
class TaskHistorySerializer(serializers.ModelSerializer):
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskHistory
        fields = ['id', 'action', 'details', 'performed_by',
                  'performed_by_name', 'created_at']
        read_only_fields = fields

    def get_performed_by_name(self, obj):
        u = obj.performed_by
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username


# ════════════════════════════════════════════════════════════════════
# Task — main serializer (alias + countdown computed fields + history)
# ════════════════════════════════════════════════════════════════════
class TaskSerializer(serializers.ModelSerializer):
    # ── Alias: UI "task_title" ↔ DB "title" ───────────────────────
    task_title = serializers.CharField(source='title')

    # ── Relation display snapshots (table render-এ JOIN ছাড়া কাজ চলে) ─
    assigned_to_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    category_name = serializers.ReadOnlyField(source='category.name')
    client_name = serializers.ReadOnlyField(source='client.full_name')

    # ── Display helpers ───────────────────────────────────────────
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    # ── Countdown / overdue (model property থেকে — single source of truth) ─
    is_overdue = serializers.ReadOnlyField()
    effective_status = serializers.ReadOnlyField()
    remaining_seconds = serializers.ReadOnlyField()

    # ── Nested: audit timeline ────────────────────────────────────
    history = TaskHistorySerializer(many=True, read_only=True)

    class Meta:
        model = Task
        fields = [
            'id', 'title', 'task_title',
            'category', 'category_name',
            'description',
            'priority', 'priority_display',
            'status', 'status_display',
            'effective_status', 'is_overdue', 'remaining_seconds',
            'assigned_to', 'assigned_to_name',
            'created_by', 'created_by_name',
            'client', 'client_name',
            'deadline', 'due_date',
            'notification_sent', 'completed_at',
            'created_at', 'updated_at',
            'history',
        ]
        read_only_fields = [
            # 'title' read-only — লেখার canonical field হলো alias 'task_title'
            # (source='title')। দুটোই writable হলে DRF bare 'title'-কে required
            # ধরে "This field is required." দিত। তাই title read-only রাখি।
            'id', 'title', 'created_by', 'created_by_name',
            'notification_sent', 'completed_at',
            'created_at', 'updated_at',
        ]

    def get_assigned_to_name(self, obj):
        u = obj.assigned_to
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username

    def get_created_by_name(self, obj):
        u = obj.created_by
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username

    def validate(self, attrs):
        # title খালি রাখা যাবে না (frontend bypass হলেও guard)।
        title = attrs.get('title')
        if title is not None and not str(title).strip():
            raise serializers.ValidationError({'task_title': 'Task title is required.'})
        # deadline না দিলে legacy due_date থেকে fallback — countdown যেন কাজ করে।
        if not attrs.get('deadline') and attrs.get('due_date'):
            attrs['deadline'] = attrs['due_date']
        return attrs


# ════════════════════════════════════════════════════════════════════
# Light-weight list serializer — বড় table দ্রুত render-এর জন্য।
# (history nested বাদ — list-এ দরকার নেই, query সাশ্রয়)।
# ════════════════════════════════════════════════════════════════════
class TaskListSerializer(serializers.ModelSerializer):
    task_title = serializers.CharField(source='title', read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    category_name = serializers.ReadOnlyField(source='category.name')
    client_name = serializers.ReadOnlyField(source='client.full_name')
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_overdue = serializers.ReadOnlyField()
    effective_status = serializers.ReadOnlyField()
    remaining_seconds = serializers.ReadOnlyField()

    class Meta:
        model = Task
        fields = [
            'id', 'title', 'task_title',
            'category', 'category_name',
            'description',
            'priority', 'priority_display',
            'status', 'status_display',
            'effective_status', 'is_overdue', 'remaining_seconds',
            'assigned_to', 'assigned_to_name',
            'created_by', 'created_by_name',
            'client', 'client_name',
            'deadline', 'due_date', 'completed_at',
            'created_at', 'updated_at',
        ]

    def get_assigned_to_name(self, obj):
        u = obj.assigned_to
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username

    def get_created_by_name(self, obj):
        u = obj.created_by
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username
