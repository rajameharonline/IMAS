from django.contrib import admin
from inventory.models import Unit, StoreLocation, ItemCategory, Item, Stock, StockTransaction

# বাংলায় মন্তব্য: admin-এ explicit registration রাখছি, কারণ নতুন Bandwidth Buy UI
# ছাড়াও ভবিষ্যতে superuser দ্রুত lookup table edit করতে পারবেন।
admin.site.register(Unit)
admin.site.register(StoreLocation)
admin.site.register(ItemCategory)
admin.site.register(Item)
admin.site.register(Stock)
admin.site.register(StockTransaction)
