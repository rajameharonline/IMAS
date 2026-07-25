# role_permissions/utils.py — App user password encryption (Fernet AES)
from django.conf import settings


def _get_fernet():
    from cryptography.fernet import Fernet
    key = getattr(settings, 'PASSWORD_ENCRYPT_KEY', '').encode()
    if not key:
        raise ValueError('PASSWORD_ENCRYPT_KEY .env-এ set করা নেই।')
    return Fernet(key)


def encrypt_password(plain: str) -> str:
    """Password encrypt করে base64 string ফেরত দেয়"""
    if not plain:
        return ''
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_password(token: str) -> str:
    """Encrypted token decrypt করে plaintext ফেরত দেয়"""
    if not token:
        return ''
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except Exception:
        return ''


def user_has_granular(user, context_key: str, permission_key: str) -> bool:
    """user-এর role-এ নির্দিষ্ট granular permission আছে কিনা।
    superadmin/admin → সবসময় True। অন্যদের assigned role_group-এর granular চেক করে।"""
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'role', '') in ('superadmin', 'admin'):
        return True
    assignment = getattr(user, 'role_assignment', None)
    if not assignment or not assignment.role_group:
        return False
    return assignment.role_group.granular_permissions.filter(
        is_enabled=True, context_key=context_key, permission_key=permission_key
    ).exists()
