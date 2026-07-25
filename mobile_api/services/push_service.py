# Firebase Cloud Messaging (FCM) push notification service
import logging
from django.conf import settings

logger = logging.getLogger(__name__)


def _get_firebase_app():
    # Firebase app singleton — প্রথমবার call-এ initialize হয়
    try:
        import firebase_admin
        from firebase_admin import credentials
        if not firebase_admin._apps:
            cred_path = getattr(settings, 'FIREBASE_CREDENTIALS_PATH', None)
            if cred_path:
                cred = credentials.Certificate(cred_path)
                # project_id সরাসরি service account JSON থেকে পাস করি
                # (auto-detection fail করলেও "Project ID required" error হবে না)
                project_id = None
                try:
                    import json
                    with open(cred_path) as f:
                        project_id = json.load(f).get('project_id')
                except Exception as je:
                    logger.warning(f"project_id পড়া যায়নি: {je}")
                options = {'projectId': project_id} if project_id else None
                firebase_admin.initialize_app(cred, options)
                logger.info(f"Firebase initialized (project_id={project_id})")
            else:
                logger.error("FIREBASE_CREDENTIALS_PATH সেট নেই — gunicorn full restart দরকার (.env reload)")
                cred = credentials.ApplicationDefault()
                firebase_admin.initialize_app(cred)
        return firebase_admin.get_app()
    except Exception as e:
        logger.exception(f"Firebase initialize error: {e}")
        return None


def send_to_token(fcm_token: str, title: str, body: str, data: dict = None,
                  high_priority: bool = False, data_only: bool = False) -> bool:
    # একটি নির্দিষ্ট device-এ notification পাঠানো।
    # high_priority=True → Android-এ priority=high (Doze/lock-screen-এও সাথে সাথে delivery)।
    # data_only=True → notification payload **বাদ** (শুধু data)। কেন দরকার: অ্যাপ
    #   killed/background থাকলে notification-payload message system tray-তে যায়,
    #   RNFirebase background handler **চলে না**। CallKeep ইনকামিং রিং দেখাতে JS
    #   handler চালাতে হয় — তাই data-only। (ইনকামিং কলের জন্য data_only+high_priority।)
    try:
        from firebase_admin import messaging
        import datetime
        _get_firebase_app()
        android = None
        if high_priority:
            android = messaging.AndroidConfig(
                priority='high',
                # ⚠️ ছোট TTL — ফোন offline/sleep থাকলে FCM message queue করে পরে deliver
                # করে (default ৪ সপ্তাহ) → পুরনো কলের push দেরিতে এসে ভুতুড়ে ইনকামিং দেখায়।
                # 45s পর message বাতিল হবে (ইনকামিং কল time-critical, পুরনো push অর্থহীন)।
                ttl=datetime.timedelta(seconds=45),
                notification=None if data_only else messaging.AndroidNotification(
                    channel_id='default', sound='default', priority='max',
                ),
            )
        message = messaging.Message(
            notification=None if data_only else messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in (data or {}).items()},
            token=fcm_token,
            android=android,
        )
        messaging.send(message)
        return True
    except Exception as e:
        logger.warning(f"FCM send failed ({fcm_token[:20]}...): {e}")
        return False


def send_to_multiple(tokens: list, title: str, body: str, data: dict = None) -> dict:
    # একাধিক token-এ একসাথে notification পাঠানো
    # returns: {'success': int, 'failure': int}
    if not tokens:
        return {'success': 0, 'failure': 0}
    try:
        from firebase_admin import messaging
        _get_firebase_app()
        messages = [
            messaging.Message(
                notification=messaging.Notification(title=title, body=body),
                data={k: str(v) for k, v in (data or {}).items()},
                token=token,
            )
            for token in tokens
        ]
        batch_response = messaging.send_each(messages)
        success = batch_response.success_count
        failure = batch_response.failure_count
        # প্রতিটি fail-হওয়া token-এর আসল কারণ log করি (invalid token / etc.)
        if failure:
            for i, resp in enumerate(batch_response.responses):
                if not resp.success:
                    logger.warning(f"FCM token #{i} failed: {resp.exception}")
        logger.info(f"FCM batch: {success} ok, {failure} failed")
        return {'success': success, 'failure': failure}
    except Exception as e:
        logger.exception(f"FCM batch send error: {e}")
        return {'success': 0, 'failure': len(tokens)}
