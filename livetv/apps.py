import os
import signal

from django.apps import AppConfig


class LivetvConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'livetv'
    verbose_name = 'Live TV'

    def ready(self):
        # FFmpeg relay process বন্ধ করার পর (SIGTERM) কেউ os.waitpid() না করলে সেটা
        # zombie (<defunct>) হয়ে থেকে যায় — যতক্ষণ না parent process exit করে।
        # এই handler নিশ্চিত করে এই worker process-এ শুরু হওয়া প্রতিটি ffmpeg child
        # মারা গেলেই সাথে সাথে reap হয়, process table জমে থাকে না।
        def _reap_children(signum, frame):
            while True:
                try:
                    pid, _status = os.waitpid(-1, os.WNOHANG)
                except ChildProcessError:
                    break
                if pid == 0:
                    break

        try:
            signal.signal(signal.SIGCHLD, _reap_children)
        except (ValueError, OSError):
            pass  # main thread ছাড়া অন্য কোথাও signal handler বসানো যায় না (যেমন Celery worker thread)
