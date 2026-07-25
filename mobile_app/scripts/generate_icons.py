#!/usr/bin/env python3
"""
যেকোনো সাইজের logo/ছবি থেকে app-এর সব icon asset তৈরি করে।

ব্যবহার:
    venv/bin/python mobile_app/scripts/generate_icons.py [logo_path]

logo_path না দিলে admin-এ আপলোড করা company logo (media/company/) ব্যবহার করে।
যেকোনো সাইজ/অনুপাতের ছবি চলবে — square canvas-এ centered ভাবে fit হয়।
উন্নত ফল পেতে high-resolution ছবি দিন।
"""
import sys, glob, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root
ASSETS = os.path.join(ROOT, 'mobile_app', 'assets')

WHITE  = (255, 255, 255, 255)
TRANSP = (255, 255, 255, 0)


def find_logo():
    # arg > admin company logo > error
    if len(sys.argv) > 1:
        return sys.argv[1]
    candidates = sorted(glob.glob(os.path.join(ROOT, 'media', 'company', '*')))
    imgs = [c for c in candidates if c.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
    if imgs:
        return imgs[0]
    raise SystemExit('logo পাওয়া যায়নি — path দিন বা admin-এ company logo আপলোড করুন।')


def canvas(logo, size, bg, pad=0.78):
    """logo-কে size×size canvas-এ pad অনুপাতে centered fit করে (যেকোনো input সাইজ)।"""
    c = Image.new('RGBA', (size, size), bg)
    maxw, maxh = int(size * pad), int(size * pad)
    lw, lh = logo.size
    s = min(maxw / lw, maxh / lh)
    nw, nh = max(1, int(lw * s)), max(1, int(lh * s))
    r = logo.resize((nw, nh), Image.LANCZOS)
    c.paste(r, ((size - nw) // 2, (size - nh) // 2), r)
    return c


def main():
    path = find_logo()
    logo = Image.open(path).convert('RGBA')
    print(f'Source logo: {path}  {logo.size}')

    outputs = [
        ('icon.png',                     1024, WHITE,  0.80),
        ('splash-icon.png',              1024, WHITE,  0.62),
        ('android-icon-foreground.png',   512, TRANSP, 0.56),
        ('android-icon-monochrome.png',   512, TRANSP, 0.56),
        ('favicon.png',                   196, WHITE,  0.86),
    ]
    for name, size, bg, pad in outputs:
        canvas(logo, size, bg, pad).save(os.path.join(ASSETS, name))
        print(f'  ✓ {name} ({size}x{size})')

    # adaptive background = solid white
    Image.new('RGBA', (512, 512), WHITE).save(os.path.join(ASSETS, 'android-icon-background.png'))
    print('  ✓ android-icon-background.png (512x512, white)')
    print('✅ সব icon তৈরি হয়েছে। নতুন build (eas build) করলে আইকন আপডেট হবে।')


if __name__ == '__main__':
    main()
