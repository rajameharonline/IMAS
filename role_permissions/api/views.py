# role_permissions/api/views.py
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction

from role_permissions.models import RoleGroup, RoleModulePermission, RoleGranularPermission, UserRoleAssignment
from role_permissions.module_definitions import MODULES, GRANULAR_PERMISSIONS
from role_permissions.api.serializers import (
    RoleGroupSerializer, RoleDetailSerializer,
    SaveRolePermissionsSerializer, UserRoleAssignmentSerializer,
)
from role_permissions.utils import encrypt_password, decrypt_password
from accounts.models import User


def _link_employee(user, employee_id):
    """User ↔ Employee (OneToOne, Employee.user) link/relink/unlink।
    employee_id ফাঁকা হলে user-এর বিদ্যমান employee link সরায়।"""
    from hr.models import Employee
    # আগের link সরাই (এক user → এক employee)
    Employee.objects.filter(user=user).exclude(id=employee_id or 0).update(user=None)
    if employee_id:
        Employee.objects.filter(id=employee_id).update(user=user)


def _employee_brief(user):
    from hr.models import Employee
    emp = Employee.objects.filter(user=user).select_related('department').first()
    if not emp:
        return None
    return {
        'id': emp.id, 'employee_id': emp.employee_id, 'full_name': emp.full_name,
        'designation': emp.designation or '',
        'department': emp.department.name if emp.department else '',
    }


class IsAdminOrSuperAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return getattr(request.user, 'role', '') in ('admin', 'superadmin')


class RoleGroupViewSet(viewsets.ModelViewSet):
    """RoleGroup CRUD — User Roles(Groups) tab"""
    queryset = RoleGroup.objects.all()
    serializer_class = RoleGroupSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_default:
            return Response(
                {'error': 'Default role delete করা যাবে না।'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_default:
            return Response(
                {'error': 'Default role edit করা যাবে না।'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=['get'], url_path='permissions')
    def get_permissions_detail(self, request, pk=None):
        """Role-এর সব permission — Permission modal খোলার সময়"""
        role = self.get_object()
        serializer = RoleDetailSerializer(role)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='save-permissions')
    def save_permissions(self, request):
        """Permission modal-এর Save & Exit — সব permission একসাথে save"""
        ser = SaveRolePermissionsSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        role_id   = ser.validated_data['role_id']
        mod_perms = ser.validated_data['module_permissions']
        gran_perms = ser.validated_data['granular_permissions']

        try:
            role = RoleGroup.objects.get(pk=role_id)
        except RoleGroup.DoesNotExist:
            return Response({'error': 'Role পাওয়া যায়নি।'}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            # পুরনো permission মুছে নতুন করে save
            RoleModulePermission.objects.filter(role=role).delete()
            RoleGranularPermission.objects.filter(role=role).delete()

            for p in mod_perms:
                RoleModulePermission.objects.create(
                    role=role,
                    module_key=p.get('module_key', ''),
                    sub_module_key=p.get('sub_module_key', ''),
                    access_level=p.get('access_level', 'full'),
                    is_enabled=p.get('is_enabled', True),
                )
            for p in gran_perms:
                RoleGranularPermission.objects.create(
                    role=role,
                    context_key=p.get('context_key', ''),
                    permission_key=p.get('permission_key', ''),
                    is_enabled=p.get('is_enabled', True),
                )

        return Response({'message': 'Permission সংরক্ষণ হয়েছে।'})

    @action(detail=False, methods=['get'], url_path='module-definitions')
    def module_definitions(self, request):
        """Frontend-এ permission modal build করতে static module list"""
        return Response({
            'modules': MODULES,
            'granular_permissions': GRANULAR_PERMISSIONS,
        })


def _apply_appuser_filters(qs, params):
    """App Users list-এর status/role/search query-param filter প্রয়োগ করে।"""
    status_filter = params.get('status')
    if status_filter == 'active':
        qs = qs.filter(is_active=True)
    elif status_filter == 'inactive':
        qs = qs.filter(is_active=False)
    role_filter = params.get('user_role')
    if role_filter:
        qs = qs.filter(role_assignment__role_group_id=role_filter)
    search = params.get('search', '').strip()
    if search:
        qs = qs.filter(username__icontains=search)
    return qs


def _serialize_app_user(u):
    """একটি User → App Users list row dict (assigned modules + decrypted password সহ)।"""
    assignment = getattr(u, 'role_assignment', None)
    assigned_modules = []
    if assignment and assignment.role_group:
        assigned_modules = list(
            assignment.role_group.module_permissions.filter(
                is_enabled=True, sub_module_key=''
            ).values_list('module_key', flat=True)
        )
    password_display = ''
    if assignment and assignment.enc_password:
        password_display = decrypt_password(assignment.enc_password)
    return {
        'id':               u.id,
        'username':         u.username,
        'full_name':        u.full_name,
        'is_active':        u.is_active,
        'role':             u.role,
        'role_group_id':    assignment.role_group_id if assignment else None,
        'role_group_name':  assignment.role_group.name if assignment and assignment.role_group else None,
        'assigned_modules': assigned_modules,
        'password_display': password_display,   # decrypt করা password
        'employee':         _employee_brief(u),  # linked employee (designation সহ)
    }


class AppUserViewSet(viewsets.ViewSet):
    """Application Users management — App Users tab।"""
    permission_classes = [permissions.IsAuthenticated, IsAdminOrSuperAdmin]

    def list(self, request):
        # superadmin DB থেকে manually তৈরি হয় — এই App Users লিস্টে দেখানো হয় না।
        # (তবু login + full access পায়; login এই লিস্টের উপর নির্ভর করে না।)
        qs = (User.objects.select_related('role_assignment__role_group')
              .exclude(role='superadmin').order_by('id'))
        qs = _apply_appuser_filters(qs, request.query_params)
        return Response([_serialize_app_user(u) for u in qs])

    # App Users পেজ থেকে assign করা যাবে এমন role (admin/superadmin বাদ — privilege
    # escalation ঠেকাতে; সেগুলো শুধু superuser/Django admin দিয়ে)।
    ASSIGNABLE_ROLES = ('collector', 'support', 'accountant', 'manager')

    def create(self, request):
        """নতুন user তৈরি — password encrypt করে store করা হয়"""
        username      = request.data.get('username', '').strip()
        password      = request.data.get('password', '')
        is_active     = request.data.get('is_active', True)
        role_group_id = request.data.get('role_group_id')
        # account_role = Django role field (mobile permission scope); RoleGroup আলাদা।
        role          = request.data.get('account_role', 'collector')
        if role not in self.ASSIGNABLE_ROLES:
            role = 'collector'

        if not username or not password:
            return Response({'error': 'Username ও Password আবশ্যক।'}, status=400)
        if User.objects.filter(username=username).exists():
            return Response({'error': 'এই username ইতোমধ্যে আছে।'}, status=400)

        with transaction.atomic():
            user = User.objects.create_user(
                username=username,
                email=f"{username}@isp.local",
                password=password,
                role=role,
                is_active=bool(is_active),
            )
            rg = None
            if role_group_id:
                try:
                    rg = RoleGroup.objects.get(pk=role_group_id)
                except RoleGroup.DoesNotExist:
                    pass

            UserRoleAssignment.objects.create(
                user=user,
                role_group=rg,
                assigned_by=request.user,
                enc_password=encrypt_password(password),  # encrypted store
            )

            # Employee ↔ User link (designation অনুযায়ী HR relation)
            _link_employee(user, request.data.get('employee'))

        return Response({'id': user.id, 'username': user.username}, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        """User update — password পরিবর্তন হলে re-encrypt করো"""
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'error': 'User পাওয়া যায়নি।'}, status=404)

        if 'is_active' in request.data:
            user.is_active = bool(request.data['is_active'])
            user.save(update_fields=['is_active'])

        # account_role পরিবর্তন — শুধু assignable role; admin/superadmin user-এর role এই
        # পেজ থেকে বদলানো যাবে না (নিরাপত্তা)।
        new_role = request.data.get('account_role')
        if new_role and new_role in self.ASSIGNABLE_ROLES and user.role not in ('superadmin', 'admin'):
            user.role = new_role
            user.save(update_fields=['role'])

        new_password = request.data.get('password', '')
        if new_password:
            user.set_password(new_password)
            user.save(update_fields=['password'])

        role_group_id = request.data.get('role_group_id')
        assignment, _ = UserRoleAssignment.objects.get_or_create(
            user=user, defaults={'assigned_by': request.user}
        )
        update_fields = ['assigned_by']

        if role_group_id is not None:
            if role_group_id == '' or role_group_id == 0:
                assignment.role_group = None
            else:
                try:
                    assignment.role_group = RoleGroup.objects.get(pk=role_group_id)
                except RoleGroup.DoesNotExist:
                    pass
            update_fields.append('role_group')

        if new_password:
            assignment.enc_password = encrypt_password(new_password)
            update_fields.append('enc_password')

        assignment.assigned_by = request.user
        assignment.save(update_fields=update_fields)

        # Employee link update (employee key পাঠানো হলে relink/unlink)
        if 'employee' in request.data:
            _link_employee(user, request.data.get('employee'))

        return Response({'message': 'Updated'})

    def destroy(self, request, pk=None):
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'error': 'User পাওয়া যায়নি।'}, status=404)
        if user.role in ('superadmin', 'admin'):
            return Response({'error': 'Admin/Superadmin delete করা যাবে না।'}, status=403)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyPermissionsView(viewsets.ViewSet):
    """Login করা user-এর নিজের permission — Frontend sidebar/route guard-এর জন্য"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        user = request.user
        # superadmin/admin → সব permission
        if user.role in ('superadmin', 'admin'):
            return Response({'is_super': True, 'modules': [], 'granular': []})

        assignment = getattr(user, 'role_assignment', None)
        if not assignment or not assignment.role_group:
            return Response({'is_super': False, 'modules': [], 'granular': []})

        role = assignment.role_group
        modules = list(role.module_permissions.filter(is_enabled=True).values(
            'module_key', 'sub_module_key', 'access_level'
        ))
        granular = list(role.granular_permissions.filter(is_enabled=True).values(
            'context_key', 'permission_key'
        ))
        return Response({
            'is_super':   False,
            'role_name':  role.name,
            'modules':    modules,
            'granular':   granular,
        })
