# এই ফাইলটি configuration app-এর serializers: জোন, সাবজোন, বক্স, প্যাকেজ ইত্যাদি।
from rest_framework import serializers
from configuration.models import Zone, SubZone, Box, ClientType, ProtocolType, Package, District, Upazila


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = '__all__'


class SubZoneSerializer(serializers.ModelSerializer):
    zone_name = serializers.ReadOnlyField(source='zone.name')

    class Meta:
        model = SubZone
        fields = '__all__'


class BoxSerializer(serializers.ModelSerializer):
    subzone_name = serializers.ReadOnlyField(source='subzone.name')
    zone_name    = serializers.ReadOnlyField(source='subzone.zone.name')
    zone_id      = serializers.ReadOnlyField(source='subzone.zone.id')

    class Meta:
        model = Box
        fields = '__all__'


class ClientTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientType
        fields = '__all__'


class ProtocolTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProtocolType
        fields = '__all__'


class PackageSerializer(serializers.ModelSerializer):
    router_name = serializers.ReadOnlyField(source='router.name')

    class Meta:
        model = Package
        fields = '__all__'


class DistrictSerializer(serializers.ModelSerializer):
    upazila_count = serializers.SerializerMethodField()

    def get_upazila_count(self, obj):
        return obj.upazilas.filter(is_active=True).count()

    class Meta:
        model = District
        fields = '__all__'


class UpazilaSerializer(serializers.ModelSerializer):
    district_name = serializers.ReadOnlyField(source='district.name')

    class Meta:
        model = Upazila
        fields = '__all__'
