# এই ফাইলটি accounts API views - ইউজার তৈরি, আপডেট, পাসওয়ার্ড পরিবর্তন।
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from accounts.models import User
from accounts.api.serializers import (
    CustomTokenObtainPairSerializer, UserSerializer,
    UserCreateSerializer, ChangePasswordSerializer
)


class CustomTokenObtainPairView(TokenObtainPairView):
    # Custom login view - extra user info সহ token return করে
    serializer_class = CustomTokenObtainPairSerializer


class UserViewSet(viewsets.ModelViewSet):
    # অ্যাপ ইউজার CRUD API
    queryset = User.objects.all().order_by('-created_at')
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    def get_permissions(self):
        if self.action in ['list', 'create', 'destroy']:
            # শুধুমাত্র superadmin/admin সব ইউজার দেখতে বা তৈরি করতে পারবে
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    @action(detail=False, methods=['get'], url_path='me')
    def me(self, request):
        # লগইন করা ইউজারের নিজের তথ্য দেখার API
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='change-password')
    def change_password(self, request):
        # পাসওয়ার্ড পরিবর্তনের API
        serializer = ChangePasswordSerializer(data=request.data)
        if serializer.is_valid():
            if not request.user.check_password(serializer.validated_data['old_password']):
                return Response({'error': 'পুরনো পাসওয়ার্ড সঠিক নয়।'}, status=400)
            request.user.set_password(serializer.validated_data['new_password'])
            request.user.save()
            return Response({'message': 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে।'})
        return Response(serializer.errors, status=400)
