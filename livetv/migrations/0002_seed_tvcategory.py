from django.db import migrations

CATEGORIES = [
    ('news',          'News',          'bg-blue-100 text-blue-700',       1),
    ('entertainment', 'Entertainment', 'bg-purple-100 text-purple-700',   2),
    ('sports',        'Sports',        'bg-orange-100 text-orange-700',   3),
    ('religious',     'Religious',     'bg-emerald-100 text-emerald-700', 4),
    ('international', 'International', 'bg-sky-100 text-sky-700',         5),
    ('music',         'Music',         'bg-pink-100 text-pink-700',       6),
    ('movies',        'Movies',        'bg-red-100 text-red-700',         7),
    ('kids',          'Kids',          'bg-yellow-100 text-yellow-700',   8),
    ('other',         'Other',         'bg-gray-100 text-gray-600',       99),
]


def seed(apps, schema_editor):
    TVCategory = apps.get_model('livetv', 'TVCategory')
    TVCategory.objects.bulk_create(
        [TVCategory(slug=slug, name=name, color=color, sort_order=order)
         for slug, name, color, order in CATEGORIES],
        ignore_conflicts=True,
    )


def unseed(apps, schema_editor):
    TVCategory = apps.get_model('livetv', 'TVCategory')
    TVCategory.objects.filter(slug__in=[c[0] for c in CATEGORIES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('livetv', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
