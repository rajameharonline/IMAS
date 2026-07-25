# Accounting module URL routing।
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from accounting.api.views import (
    AccountTypeViewSet,
    ChartOfAccountViewSet,
    IncomeCategoryViewSet,
    ExpenseCategoryViewSet,
    IncomeViewSet,
    ExpenseViewSet,
    JournalEntryViewSet,
    DailyAccountViewSet,
    AccountingDashboardView,
    BalanceSheetView,
    AccountTransactionsView,
    AccountBalancesView,
    CompareProfitLossView,
    CashBookView,
)

router = DefaultRouter()
router.register(r'account-types',      AccountTypeViewSet,     basename='account-type')
router.register(r'chart-of-accounts',  ChartOfAccountViewSet,  basename='chart-of-account')
router.register(r'income-categories',  IncomeCategoryViewSet,  basename='income-category')
router.register(r'expense-categories', ExpenseCategoryViewSet, basename='expense-category')
router.register(r'income',             IncomeViewSet,          basename='income')
router.register(r'expense',            ExpenseViewSet,         basename='expense')
router.register(r'journal',            JournalEntryViewSet,    basename='journal')
router.register(r'daily-accounts',     DailyAccountViewSet,    basename='daily-account')

urlpatterns = [
    path('', include(router.urls)),
    path('dashboard/',            AccountingDashboardView.as_view(),  name='accounting-dashboard'),
    path('balance-sheet/',        BalanceSheetView.as_view(),         name='balance-sheet'),
    path('account-transactions/', AccountTransactionsView.as_view(),  name='account-transactions'),
    path('account-balances/',     AccountBalancesView.as_view(),      name='account-balances'),
    path('compare-profit-loss/',  CompareProfitLossView.as_view(),    name='compare-profit-loss'),
    path('cash-book/',            CashBookView.as_view(),             name='cash-book'),
]
