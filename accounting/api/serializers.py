# Accounting module serializers — সব voucher ও report এর জন্য।
from rest_framework import serializers
from django.contrib.auth import get_user_model
from accounting.models import (
    AccountType, ChartOfAccount, JournalEntry, JournalLine,
    IncomeCategory, Income, ExpenseCategory, Expense, DailyAccount,
)

User = get_user_model()

_ACCOUNT_NAME_SOURCE = 'account.name'


class AccountTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountType
        fields = '__all__'


class ChartOfAccountSerializer(serializers.ModelSerializer):
    account_type_name = serializers.ReadOnlyField(source='account_type.name')
    account_type_code = serializers.ReadOnlyField(source='account_type.code')

    class Meta:
        model = ChartOfAccount
        fields = '__all__'


class JournalLineSerializer(serializers.ModelSerializer):
    account_name = serializers.ReadOnlyField(source=_ACCOUNT_NAME_SOURCE)
    account_code = serializers.ReadOnlyField(source='account.code')

    class Meta:
        model = JournalLine
        fields = '__all__'


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalLineSerializer(many=True, read_only=True)
    lines_payload = serializers.JSONField(write_only=True, required=False)
    created_by_name  = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    status_display   = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, 'full_name', '') or obj.created_by.username
        return ''

    def get_approved_by_name(self, obj):
        if obj.approved_by:
            return getattr(obj.approved_by, 'full_name', '') or obj.approved_by.username
        return ''

    def get_status_display(self, obj):
        return 'Approved' if obj.is_posted else 'Pending'

    def create(self, validated_data):
        lines_payload = validated_data.pop('lines_payload', [])
        entry = JournalEntry.objects.create(**validated_data)
        total_dr = total_cr = 0
        for lp in (lines_payload or []):
            try:
                acct = ChartOfAccount.objects.get(pk=lp.get('account'))
            except ChartOfAccount.DoesNotExist:
                continue
            dr = float(lp.get('debit', 0) or 0)
            cr = float(lp.get('credit', 0) or 0)
            JournalLine.objects.create(
                journal=entry, account=acct,
                debit=dr, credit=cr,
                description=lp.get('description', ''),
            )
            total_dr += dr
            total_cr += cr
        entry.total_debit  = total_dr
        entry.total_credit = total_cr
        entry.save(update_fields=['total_debit', 'total_credit'])
        return entry

    class Meta:
        model = JournalEntry
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'total_debit', 'total_credit']


class IncomeCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = IncomeCategory
        fields = '__all__'


class IncomeSerializer(serializers.ModelSerializer):
    category_name    = serializers.ReadOnlyField(source='category.name')
    account_name     = serializers.ReadOnlyField(source=_ACCOUNT_NAME_SOURCE)
    created_by_name  = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    status           = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, 'full_name', '') or obj.created_by.username
        return ''

    def get_approved_by_name(self, obj):
        if obj.approved_by:
            return getattr(obj.approved_by, 'full_name', '') or obj.approved_by.username
        return ''

    def get_status(self, obj):
        return 'approved' if obj.is_approved else 'pending'

    class Meta:
        model = Income
        fields = '__all__'


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = '__all__'


class ExpenseSerializer(serializers.ModelSerializer):
    category_name    = serializers.ReadOnlyField(source='category.name')
    account_name     = serializers.ReadOnlyField(source=_ACCOUNT_NAME_SOURCE)
    created_by_name  = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    status           = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, 'full_name', '') or obj.created_by.username
        return ''

    def get_approved_by_name(self, obj):
        if obj.approved_by:
            return getattr(obj.approved_by, 'full_name', '') or obj.approved_by.username
        return ''

    def get_status(self, obj):
        return 'approved' if obj.is_approved else 'pending'

    class Meta:
        model = Expense
        fields = '__all__'


class DailyAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyAccount
        fields = '__all__'
