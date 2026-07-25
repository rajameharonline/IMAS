# role_permissions/api/serializers.py
from rest_framework import serializers
from role_permissions.models import RoleGroup, RoleModulePermission, RoleGranularPermission, UserRoleAssignment


class RoleGroupSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    assigned_user_count = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.full_name or obj.created_by.username
        return 'System'

    def get_assigned_user_count(self, obj):
        return obj.assigned_users.count()

    class Meta:
        model  = RoleGroup
        fields = ['id', 'name', 'status', 'redirect_url', 'is_default',
                  'created_by_name', 'assigned_user_count', 'created_at']
        read_only_fields = ['is_default', 'created_at']


class RoleModulePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = RoleModulePermission
        fields = ['id', 'module_key', 'sub_module_key', 'access_level', 'is_enabled']


class RoleGranularPermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = RoleGranularPermission
        fields = ['id', 'context_key', 'permission_key', 'is_enabled']


class RoleDetailSerializer(serializers.ModelSerializer):
    """Role-এর সব permission একসাথে — Permission modal-এর জন্য"""
    module_permissions  = RoleModulePermissionSerializer(many=True, read_only=True)
    granular_permissions = RoleGranularPermissionSerializer(many=True, read_only=True)

    class Meta:
        model  = RoleGroup
        fields = ['id', 'name', 'status', 'redirect_url', 'is_default',
                  'module_permissions', 'granular_permissions']


class SaveRolePermissionsSerializer(serializers.Serializer):
    """Permission modal-এর Save — সব permission একসাথে save করে"""
    role_id = serializers.IntegerField()
    # [{'module_key': 'billing', 'sub_module_key': '', 'access_level': 'full', 'is_enabled': True}, ...]
    module_permissions   = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    # [{'context_key': 'billing_list', 'permission_key': 'download_invoice', 'is_enabled': True}, ...]
    granular_permissions = serializers.ListField(child=serializers.DictField(), required=False, default=list)


class UserRoleAssignmentSerializer(serializers.ModelSerializer):
    role_group_name = serializers.SerializerMethodField()
    user_name       = serializers.SerializerMethodField()

    def get_role_group_name(self, obj):
        return obj.role_group.name if obj.role_group else None

    def get_user_name(self, obj):
        return obj.user.full_name or obj.user.username

    class Meta:
        model  = UserRoleAssignment
        fields = ['id', 'user', 'user_name', 'role_group', 'role_group_name', 'assigned_at']
