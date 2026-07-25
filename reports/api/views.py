# এই ফাইলটি রিপোর্ট API views - বিভিন্ন রিপোর্ট generate করে।
from rest_framework import permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from django.db.models import Sum, Count, Q
from django.utils import timezone


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def bill_collection_report(request):
    # নির্দিষ্ট তারিখ পরিসরের বিল কালেকশন রিপোর্ট
    from billing.models import Payment, Bill
    from_date = request.query_params.get('from_date', timezone.now().date().replace(day=1))
    to_date = request.query_params.get('to_date', timezone.now().date())

    payments = Payment.objects.filter(
        payment_date__date__gte=from_date,
        payment_date__date__lte=to_date,
    ).values('payment_method').annotate(
        total_amount=Sum('amount'),
        count=Count('id'),
    )
    total = Payment.objects.filter(
        payment_date__date__gte=from_date,
        payment_date__date__lte=to_date,
    ).aggregate(total=Sum('amount'))['total'] or 0

    return Response({
        'from_date': from_date,
        'to_date': to_date,
        'by_method': list(payments),
        'total': total,
    })


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def customer_report(request):
    # ক্লায়েন্ট রিপোর্ট - জোন, প্যাকেজ অনুযায়ী সারসংক্ষেপ
    from clients.models import Client
    from django.db.models import Count, Sum
    zone_stats = Client.objects.values('zone__name').annotate(
        total=Count('id'),
        active=Count('id', filter=Q(status='active')),
        expired=Count('id', filter=Q(status='expired')),
        total_due=Sum('due_amount'),
    )
    return Response(list(zone_stats))


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def due_customer_report(request):
    # বকেয়া ক্লায়েন্টের বিস্তারিত রিপোর্ট
    from clients.models import Client
    clients = Client.objects.filter(due_amount__gt=0).values(
        'customer_id', 'full_name', 'phone', 'due_amount',
        'zone__name', 'package__name', 'status',
    ).order_by('-due_amount')
    return Response(list(clients))


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def financial_report(request):
    # আর্থিক লেনদেনের সার্বিক রিপোর্ট
    from billing.models import Bill, Payment
    from accounting.models import Income, Expense
    from django.db.models import Sum

    month = request.query_params.get('month', timezone.now().strftime('%Y-%m'))

    total_billed = Bill.objects.filter(bill_month=month).aggregate(
        total=Sum('net_amount'))['total'] or 0
    total_collected = Payment.objects.filter(
        payment_date__year=month[:4],
        payment_date__month=month[5:],
    ).aggregate(total=Sum('amount'))['total'] or 0

    return Response({
        'month': month,
        'total_billed': total_billed,
        'total_collected': total_collected,
        'collection_rate': f"{(total_collected/total_billed*100):.1f}%" if total_billed else "0%",
    })
