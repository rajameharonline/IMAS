# Walled Garden — Expired client notice page
# ──────────────────────────────────────────────────────────────
# Expired PPPoE profile-এ থাকা client-এর সব HTTP traffic MikroTik
# এই server-এ redirect করে (dst-nat + DNS hijack)। এই view যেকোনো
# Host/path-এ "মেয়াদ শেষ — বিল দিন" notice page দেখায়।
#
# গুরুত্বপূর্ণ:
#  • auth লাগে না (anonymous) — client তো লগইন করতে পারবে না।
#  • SPA/React-এর উপর নির্ভর করে না — standalone HTML, inline CSS।
#  • OS-এর captive-portal probe (captive.apple.com ইত্যাদি) এই
#    page পেলেই "Sign in to network" popup দেখায় → payment page খোলে।
# ──────────────────────────────────────────────────────────────
from django.shortcuts import render
from django.views.decorators.http import require_safe
# নোট: expired.html template পরিবর্তনের পর gunicorn reload লাগে (cached template loader)। (amount = package note)


def _wg_logo_data_uri(company, request):
    """Company logo base64 data-URI inline করে (walled garden-এ /media/ rewrite-এ
    আটকে যায় বলে self-contained দরকার)। ব্যর্থ হলে absolute URL fallback, নইলে ''।"""
    if not (company and getattr(company, 'logo', None)):
        return ''
    try:
        import base64, mimetypes
        with open(company.logo.path, 'rb') as f:
            raw = base64.b64encode(f.read()).decode('ascii')
        mime = mimetypes.guess_type(company.logo.name)[0] or 'image/png'
        return f'data:{mime};base64,{raw}'
    except Exception:
        # fallback: absolute URL (nginx-এ /media/ allow করা থাকলে কাজ করবে)
        try:
            return request.build_absolute_uri(company.logo.url)
        except Exception:
            return ''


def _wg_guide_images():
    """bKash পেমেন্ট গাইড ছবি (media/walled_garden/payment_guide*.{png,jpg,jpeg,webp})
    নাম অনুযায়ী sort করে base64 data-URI list-এ ফেরায়। না থাকলে খালি list
    (template তখন CSS-আঁকা ধাপ-গাইড দেখায়)।"""
    try:
        import base64, mimetypes, glob, os
        from django.conf import settings as dj_settings
        gdir = os.path.join(dj_settings.MEDIA_ROOT, 'walled_garden')
        files = []
        for ext in ('png', 'jpg', 'jpeg', 'webp'):
            files += glob.glob(os.path.join(gdir, f'payment_guide*.{ext}'))
        imgs = []
        for fp in sorted(files):
            with open(fp, 'rb') as f:
                raw = base64.b64encode(f.read()).decode('ascii')
            mime = mimetypes.guess_type(fp)[0] or 'image/png'
            imgs.append(f'data:{mime};base64,{raw}')
        return imgs
    except Exception:
        return []


# CSRF নোট: এই view @require_safe দিয়ে সীমাবদ্ধ (শুধু GET/HEAD)। Django-র CSRF
# check কেবল unsafe method-এ চলে, যেগুলো require_safe আগেই 405 দেয় — তাই আলাদা
# csrf_exempt দরকার নেই (redundant ছিল, নিরাপত্তা-hotspot এড়াতে সরানো হলো)।
@require_safe
def expired_notice(request):
    """Expired client-দের জন্য walled-garden notice page।

    MikroTik redirect-এর কারণে যেকোনো path/Host-এ এই view-ই render হয়।
    """
    # CompanySetup থেকে নাম/লোগো/হটলাইন — না থাকলে নিরাপদ default
    company = None
    try:
        from system_settings.models import CompanySetup
        company = CompanySetup.objects.first()
    except Exception:
        company = None

    logo_url = _wg_logo_data_uri(company, request)
    guide_imgs = _wg_guide_images()

    context = {
        'company_name': (company.name if company and company.name else 'আপনার ইন্টারনেট সেবা'),
        'logo_url':     logo_url,
        'phone':        (company.phone if company else ''),
        'email':        (company.email if company else ''),
        'website':      (company.website if company else ''),
        'guide_imgs':   guide_imgs,
    }
    # 200 দিই (302 নয়) — captive-portal detection HTTP body দেখে popup খোলে
    return render(request, 'walled_garden/expired.html', context)
