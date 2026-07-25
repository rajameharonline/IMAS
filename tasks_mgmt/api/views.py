# এই ফাইলটি Task Management module-এর সব DRF ViewSet ধারণ করে।
#
# Key responsibilities:
#   1. Role-based visibility — admin/superadmin সব task দেখে ("All Tasks");
#      অন্য staff শুধু নিজের assigned task দেখে ("My Tasks")।
#   2. Action endpoints — change-status / assign / stats / my-tasks — admin
#      panel থেকে এক-ক্লিকে operation এর জন্য।
#   3. actor inject — কোন user পরিবর্তন করল তা signal-এ পৌঁছে দেয় (audit +
#      notification)।
#
# কেন এভাবে: business logic (notification + audit) signals.py-তে centralize;
# view শুধু permission + queryset filter + actor injection সামলায়।

from django.utils import timezone
from django.db.models import Q, Count
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from tasks_mgmt.models import Task, TaskCategory
from tasks_mgmt.api.serializers import (
    TaskSerializer,
    TaskListSerializer,
    TaskCategorySerializer,
)


# ════════════════════════════════════════════════════════════════════
# Helper: কোন role admin-level visibility পাবে (support module-এর সাথে অভিন্ন)।
# ════════════════════════════════════════════════════════════════════
ADMIN_ROLES = ('admin', 'superadmin', 'manager')



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_ERR_ADMIN_PERM = 'Admin permission required.'

def _is_admin_level(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff:
        return True
    return getattr(user, 'role', '') in ADMIN_ROLES


# ════════════════════════════════════════════════════════════════════
# Task Category — admin CRUD (dropdown lookup)
# ════════════════════════════════════════════════════════════════════
class TaskCategoryViewSet(viewsets.ModelViewSet):
    queryset = TaskCategory.objects.all().order_by('name')
    serializer_class = TaskCategorySerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['name', 'description']
    ordering_fields = ['name']

    def perform_create(self, serializer):
        if not _is_admin_level(self.request.user):
            raise permissions.exceptions.PermissionDenied(_ERR_ADMIN_PERM)
        serializer.save()

    # update-এ create-এর সাথে অভিন্ন admin-check (S4144) — alias
    perform_update = perform_create

    def perform_destroy(self, instance):
        if not _is_admin_level(self.request.user):
            raise permissions.exceptions.PermissionDenied(_ERR_ADMIN_PERM)
        instance.delete()


# ════════════════════════════════════════════════════════════════════
# Task — main viewset (role-based filter + actions)
# ════════════════════════════════════════════════════════════════════
class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.select_related(
        'category', 'assigned_to', 'created_by', 'client',
    ).prefetch_related('history').all()
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['status', 'priority', 'assigned_to', 'category', 'client']
    search_fields = ['title', 'description',
                     'assigned_to__username', 'assigned_to__full_name']
    ordering_fields = ['created_at', 'deadline', 'priority', 'status']

    def get_serializer_class(self):
        # list-এ light-weight serializer — fast render।
        if self.action in ('list', 'my_tasks'):
            return TaskListSerializer
        return TaskSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        # Admin-level → "All Tasks" (পুরো queryset)।
        if _is_admin_level(user):
            return qs
        # অন্য staff → শুধু নিজের assigned/created task (employee scope)।
        return qs.filter(Q(assigned_to=user) | Q(created_by=user)).distinct()

    def perform_create(self, serializer):
        # created_by = current admin। creation-এর post_save signal এই created_by-কেই
        # "actor" ধরে নেয় (self-assign detection), তাই আলাদা actor inject লাগে না।
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        # update-এর আগে actor inject — status/assignment change signal ধরবে।
        instance = serializer.instance
        instance._actor_user = self.request.user
        serializer.save()

    # ── Action: My Tasks — শুধু current user-এর assigned task ─────
    # কেন আলাদা endpoint: employee dashboard/page সরাসরি এটি hit করে, role
    # যাই হোক (admin হলেও নিজের assigned task দেখতে পারে)।
    @action(detail=False, methods=['get'], url_path='my-tasks')
    def my_tasks(self, request):
        qs = (Task.objects
              .select_related('category', 'assigned_to', 'created_by', 'client')
              .filter(assigned_to=request.user))
        # status/priority filter query-param থেকে পাস-থ্রু।
        st = request.query_params.get('status')
        if st:
            qs = qs.filter(status=st)
        pr = request.query_params.get('priority')
        if pr:
            qs = qs.filter(priority=pr)
        qs = qs.order_by('-created_at')
        page = self.paginate_queryset(qs)
        ser = TaskListSerializer(page if page is not None else qs, many=True)
        if page is not None:
            return self.get_paginated_response(ser.data)
        return Response(ser.data)

    # ── Action: change status (employee + admin) ──────────────────
    @action(detail=True, methods=['post'], url_path='change-status')
    def change_status(self, request, pk=None):
        task = self.get_object()
        new_status = request.data.get('status')
        valid = [c for c, _ in Task.STATUS_CHOICES]
        if new_status not in valid:
            return Response({'detail': f'Invalid status. Allowed: {valid}'}, status=400)
        task._actor_user = request.user
        task.status = new_status
        task.save(update_fields=['status', 'updated_at'])
        task.refresh_from_db()   # completed_at signal-এ set হয় — fresh দিই।
        return Response(TaskSerializer(task).data)

    # ── Action: assign / re-assign (admin only) ───────────────────
    @action(detail=True, methods=['post'], url_path='assign')
    def assign(self, request, pk=None):
        if not _is_admin_level(request.user):
            return Response({'detail': 'Admin permission required to re-assign.'},
                            status=status.HTTP_403_FORBIDDEN)
        task = self.get_object()
        new_user_id = request.data.get('assigned_to')
        try:
            new_user_id = int(new_user_id) if new_user_id else None
        except (TypeError, ValueError):
            return Response({'detail': 'Invalid assigned_to id.'}, status=400)
        task._actor_user = request.user
        task.assigned_to_id = new_user_id
        task.save(update_fields=['assigned_to', 'updated_at'])
        return Response(TaskSerializer(task).data)

    # ── Action: dashboard statistics ──────────────────────────────
    # Dashboard "Pending Task" / "Processing Task" card-এর live count source।
    # role-based queryset reuse — employee নিজের metric দেখে, admin সব দেখে।
    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        qs = self.get_queryset()
        now = timezone.now()

        # pending = pending status; processing = processing (+ legacy in_progress)।
        pending_count = qs.filter(status='pending').count()
        processing_count = qs.filter(status__in=['processing', 'in_progress']).count()
        completed_count = qs.filter(status='completed').count()
        # overdue = deadline পেরিয়েছে অথচ এখনো শেষ/বাতিল হয়নি (live computed)।
        overdue_count = qs.filter(
            deadline__lt=now,
        ).exclude(status__in=list(Task.CLOSED_STATUSES)).count()

        # priority breakdown — চাইলে চার্টে কাজে লাগবে।
        by_priority = list(
            qs.values('priority').annotate(count=Count('id')).order_by('-count')
        )

        return Response({
            'pending_count':    pending_count,
            'processing_count': processing_count,
            'completed_count':  completed_count,
            'overdue_count':    overdue_count,
            'by_priority':      by_priority,
        })
