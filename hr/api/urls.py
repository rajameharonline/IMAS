from django.urls import path, include
from rest_framework.routers import DefaultRouter
from hr.api.views import (
    DepartmentViewSet, PayHeadViewSet, PayrollViewSet,
    EmployeeViewSet, AttendanceViewSet, PayrollSheetViewSet, PositionViewSet,
    EmployeeAdvanceViewSet, ResignRuleViewSet, ResignationViewSet, RejoinViewSet,
    CollectorCashViewSet,
)

router = DefaultRouter()
router.register(r'departments',   DepartmentViewSet)
router.register(r'payheads',      PayHeadViewSet)
router.register(r'payrolls',      PayrollViewSet)
router.register(r'employees',     EmployeeViewSet)
router.register(r'attendance',    AttendanceViewSet)
router.register(r'payroll',       PayrollSheetViewSet)
router.register(r'positions',     PositionViewSet)
router.register(r'advances',      EmployeeAdvanceViewSet)
router.register(r'resign-rules',  ResignRuleViewSet)
router.register(r'resignations',  ResignationViewSet)
router.register(r'rejoins',       RejoinViewSet)
router.register(r'collector-cash', CollectorCashViewSet, basename='collector-cash')

urlpatterns = [path('', include(router.urls))]
