# এই ফাইলটি Mikrotik RouterOS API integration service।
# live traffic check, router backup, PPPoE user import, bulk import - এই কাজগুলো করে।
import routeros_api
from django.conf import settings
import logging

logger = logging.getLogger(__name__)



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_PPP_ACTIVE = '/ppp/active'
_INTERFACE = '/interface'
_PPP_SECRET = '/ppp/secret'

class MikrotikService:
    def __init__(self, host: str, username: str, password: str, port: int = 8728):
        # Mikrotik Router-এর সাথে RouterOS API দিয়ে সংযোগ স্থাপন
        self.host = host
        self.username = username
        self.password = password
        self.port = port
        self._connection = None

    def _connect(self):
        # RouterOS API connection তৈরি করা হচ্ছে
        self._connection = routeros_api.RouterOsApiPool(
            self.host,
            username=self.username,
            password=self.password,
            port=self.port,
            plaintext_login=True,
        )
        return self._connection.get_api()

    def get_user_traffic(self, username: str) -> dict | None:
        """PPPoE interface <pppoe-username> থেকে real-time bytes + session info।"""
        try:
            api = self._connect()

            # Session info (IP, uptime)
            session_ip, uptime, caller_id = '', '', ''
            try:
                sessions = api.get_resource(_PPP_ACTIVE).get(name=username)
                if sessions:
                    s = sessions[0]
                    session_ip = s.get('address', '')
                    uptime = s.get('uptime', '')
                    caller_id = s.get('caller-id', '')
                else:
                    return None  # user offline
            except Exception:
                return None

            # Traffic bytes from PPPoE interface <pppoe-username>
            iface_name = f'<pppoe-{username}>'
            bytes_dl, bytes_ul = 0, 0
            try:
                ifaces = api.get_resource(_INTERFACE).get(name=iface_name)
                if ifaces:
                    iface = ifaces[0]
                    # tx-byte = router→client = download; rx-byte = client→router = upload
                    bytes_dl = int(iface.get('tx-byte', 0) or 0)
                    bytes_ul = int(iface.get('rx-byte', 0) or 0)
            except Exception:
                pass

            return {
                'username': username,
                'nas_ip': self.host,
                'ip': session_ip,
                'uptime': uptime,
                'caller_id': caller_id,
                'bytes_in': bytes_dl,   # client download
                'bytes_out': bytes_ul,  # client upload
            }
        except Exception as e:
            # user-controlled মান log injection (CWE-117) রোধে CR/LF সরাই
            safe_user = str(username).replace('\r', '').replace('\n', '')
            logger.exception("Mikrotik get_user_traffic error for %s: %s", safe_user, e)
            return None
        finally:
            if self._connection:
                self._connection.disconnect()

    def check_client_connectivity(self, ip: str) -> dict:
        """PPPoE active session + interface status দেখে client connectivity যাচাই করে।
        Mikrotik API /tool/ping session-based API-তে সরাসরি সমর্থিত নয়।"""
        try:
            api = self._connect()

            # Active session চেক
            sessions = api.get_resource(_PPP_ACTIVE).get(address=ip)
            if not sessions:
                return {
                    'success': False, 'connected': False,
                    'uptime': None, 'link_downs': None,
                    'note': 'No active PPPoE session for this IP',
                }
            s = sessions[0]
            username = s.get('name', '')
            uptime = s.get('uptime', '')

            # PPPoE interface status চেক
            iface_name = f'<pppoe-{username}>'
            ifaces = api.get_resource(_INTERFACE).get(name=iface_name)
            running = False
            link_downs = 0
            if ifaces:
                iface = ifaces[0]
                running = iface.get('running') == 'true'
                link_downs = int(iface.get('link-downs', 0) or 0)

            return {
                'success': running,
                'connected': running,
                'uptime': uptime,
                'link_downs': link_downs,
                'note': f'Interface {"running" if running else "down"} | Uptime: {uptime} | Link drops: {link_downs}',
            }
        except Exception as e:
            logger.exception('Mikrotik check_client_connectivity error for %s: %s', ip, e)
            return {'success': False, 'connected': False, 'error': str(e)}
        finally:
            if self._connection:
                self._connection.disconnect()

    def get_pppoe_users(self) -> list:
        # Mikrotik থেকে সব PPPoE secret (user) তালিকা আনে
        try:
            api = self._connect()
            secrets = api.get_resource(_PPP_SECRET)
            users = secrets.get()
            return users
        except Exception as e:
            logger.exception(f"Mikrotik get_pppoe_users error ({self.host}): {e}")
            return []
        finally:
            if self._connection:
                self._connection.disconnect()

    def get_active_connections(self) -> list:
        # বর্তমানে active PPPoE connection তালিকা - live traffic check
        try:
            api = self._connect()
            active = api.get_resource(_PPP_ACTIVE)
            return active.get()
        except Exception as e:
            logger.exception(f"Mikrotik active connections error ({self.host}): {e}")
            return []
        finally:
            if self._connection:
                self._connection.disconnect()

    def get_interface_traffic(self, interface: str = 'ether1') -> dict:
        # নির্দিষ্ট interface-এর live traffic data আনে (bytes in/out)
        try:
            api = self._connect()
            interfaces = api.get_resource(_INTERFACE)
            result = interfaces.get(name=interface)
            if result:
                iface = result[0]
                return {
                    'rx_byte': iface.get('rx-byte', 0),
                    'tx_byte': iface.get('tx-byte', 0),
                    'rx_packet': iface.get('rx-packet', 0),
                    'tx_packet': iface.get('tx-packet', 0),
                    'running': iface.get('running', False),
                }
            return {}
        except Exception as e:
            logger.exception(f"Mikrotik traffic error ({self.host}): {e}")
            return {}
        finally:
            if self._connection:
                self._connection.disconnect()

    def disconnect_active_session(self, username: str) -> bool:
        # active PPPoE session disconnect করে — RADIUS-only mode-এ disable-এর জন্য
        try:
            api = self._connect()
            active = api.get_resource(_PPP_ACTIVE)
            sessions = active.get(name=username)
            for s in sessions:
                active.remove(id=s['id'])
            if sessions:
                logger.info(f"Mikrotik active session disconnected: {username}")
            return True
        except Exception as e:
            logger.exception(f"Mikrotik disconnect_active_session error: {e}")
            return False
        finally:
            if self._connection:
                self._connection.disconnect()

    # ──────────────────────────────────────────
    # CoA / Packet of Disconnect (PoD)
    # ──────────────────────────────────────────
    #
    # কেন আলাদা CoA path:
    #   API-ভিত্তিক disconnect_active_session() ভালো কাজ করে কিন্তু
    #   pure RADIUS protocol-এ session terminate করার standard উপায়
    #   হলো Packet of Disconnect (RFC 5176)। এতে MikroTik /radius/incoming
    #   accept=yes থাকলে session-কে instantly drop করে।
    #
    # Mikrotik default CoA/DM listening port:  3799 (RFC standard)
    # User-চাহিদা অনুযায়ী 1700-ও সাপোর্ট — কনফিগারেবল।
    #
    # secret = Mikrotik-এর /radius entry-এর secret (একই shared secret)।
    #
    # radclient (FreeRADIUS package-এর অংশ) ব্যবহার করা হয়েছে — কোনো
    # অতিরিক্ত Python dependency লাগে না। radclient না থাকলে call ফেল হবে
    # এবং caller fallback হিসেবে API disconnect ব্যবহার করতে পারবে।
    # ──────────────────────────────────────────────────────────────

    @staticmethod
    def send_coa_disconnect(username: str, nas_host: str, shared_secret: str,
                            coa_port: int = 3799, timeout: int = 3) -> dict:
        """RADIUS Packet of Disconnect পাঠায় Mikrotik NAS-এ।

        Args:
            username:       যাকে disconnect করতে হবে (User-Name attribute)
            nas_host:       Mikrotik router-এর IP (যেখানে CoA পাঠানো হবে)
            shared_secret:  RADIUS shared secret (Mikrotik /radius entry-র)
            coa_port:       Mikrotik /radius/incoming port (default 3799)
            timeout:        radclient timeout সেকেন্ডে

        Returns: {'success': bool, 'message': str, 'output': str}
        """
        import subprocess

        if not (username and nas_host and shared_secret):
            return {'success': False, 'message': 'username/nas_host/secret প্রয়োজন'}

        # radclient stdin-এ User-Name দিতে হয় — disconnect request-এর জন্য
        # NAS-IP-Address-ও দিলে multi-NAS setup-এ সঠিক session match হয়।
        attrs = f"User-Name = {username}\nNAS-IP-Address = {nas_host}\n"
        target = f"{nas_host}:{coa_port}"

        try:
            proc = subprocess.run(
                ['radclient', '-x', '-t', str(timeout), '-r', '2',
                 target, 'disconnect', shared_secret],
                input=attrs,
                capture_output=True, text=True, timeout=timeout + 5,
            )
            out = (proc.stdout or '') + (proc.stderr or '')
            # "Received Disconnect-ACK" → সফল।
            # "Disconnect-ACK" substring শুধু চেক করলে error message
            # ("Expected Disconnect-ACK got Disconnect-NAK") false-positive
            # দেয় — তাই "Received Disconnect-ACK" prefix যাচাই করা হচ্ছে।
            ok = 'Received Disconnect-ACK' in out
            msg = ('PoD-ACK পাওয়া গেছে — session terminated' if ok else
                   ('PoD-NAK / timeout — Mikrotik /radius/incoming accept=yes '
                    'এবং port সঠিক কিনা যাচাই করুন'))
            logger.info("CoA disconnect %s → %s : %s",
                        username, target, 'ACK' if ok else 'NAK/timeout')
            return {'success': ok, 'message': msg, 'output': out[-400:]}
        except FileNotFoundError:
            return {'success': False,
                    'message': 'radclient ইনস্টল নেই (apt install freeradius-utils)',
                    'output': ''}
        except subprocess.TimeoutExpired:
            return {'success': False, 'message': 'radclient timeout', 'output': ''}
        except Exception as e:
            logger.exception("send_coa_disconnect error: %s", e)
            return {'success': False, 'message': str(e), 'output': ''}

    def create_pppoe_user(self, username: str, password: str, profile: str = 'default',
                          comment: str = '') -> bool:
        # Local secret সবসময় disabled=yes — Mikrotik local auth ব্যবহার করে না।
        # RADIUS-এ auth হয়; Mikrotik-Group থেকে profile, Framed-Pool থেকে IP নেয়।
        try:
            api = self._connect()
            secrets = api.get_resource(_PPP_SECRET)
            existing = secrets.get(name=username)
            if existing:
                secrets.set(id=existing[0]['id'], password=password,
                            profile=profile, comment=comment, disabled='yes')
            else:
                secrets.add(name=username, password=password, service='pppoe',
                            profile=profile, comment=comment, disabled='yes')
            logger.info(f"Mikrotik PPPoE secret created/updated (disabled, RADIUS-only): {username}")
            return True
        except Exception as e:
            logger.exception(f"Mikrotik create_pppoe_user error: {e}")
            return False
        finally:
            if self._connection:
                self._connection.disconnect()

    def disable_pppoe_user(self, username: str) -> bool:
        # RADIUS-only: শুধু active session disconnect। Auth RADIUS-এ Auth-Type:Reject দিয়ে হয়।
        return self.disconnect_active_session(username)

    def update_pppoe_user(self, username: str, password: str = None, profile: str = None) -> bool:
        # PPPoE secret-এর password ও/অথবা profile আপডেট করে — secret disabled=yes অপরিবর্তিত থাকে
        try:
            api = self._connect()
            secrets = api.get_resource(_PPP_SECRET)
            users = secrets.get(name=username)
            if not users:
                return False
            params = {}
            if password:
                params['password'] = password
            if profile:
                params['profile'] = profile
            if params:
                secrets.set(id=users[0]['id'], **params)
            logger.info(f"Mikrotik PPPoE user updated: {username} {list(params.keys())}")
            return True
        except Exception as e:
            logger.exception(f"Mikrotik update_pppoe_user error: {e}")
            return False
        finally:
            if self._connection:
                self._connection.disconnect()

    def delete_pppoe_user(self, username: str) -> bool:
        # /ppp/secret থেকে PPPoE secret সম্পূর্ণ মুছে দেয় — Left Client চিরতরে বাতিলের সময়।
        try:
            api = self._connect()
            secrets = api.get_resource(_PPP_SECRET)
            users = secrets.get(name=username)
            if users:
                secrets.remove(id=users[0]['id'])
                logger.info(f"Mikrotik PPPoE secret deleted: {username}")
            return True
        except Exception as e:
            logger.exception(f"Mikrotik delete_pppoe_user error for {username}: {e}")
            return False
        finally:
            if self._connection:
                self._connection.disconnect()

    def enable_pppoe_user(self, username: str) -> bool:
        # RADIUS-only: enable মানে RADIUS-এ Auth-Type:Reject সরানো — Mikrotik-এ কিছু করার নেই।
        logger.info(f"enable_pppoe_user: RADIUS-only, no Mikrotik action for {username}")
        return True

    def create_backup(self) -> str:
        # Mikrotik router-এর configuration backup তৈরি করে
        try:
            api = self._connect()
            from datetime import datetime
            backup_name = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            system = api.get_resource('/system/backup')
            system.call('save', {'name': backup_name})
            logger.info(f"Mikrotik backup created: {backup_name}")
            return backup_name
        except Exception as e:
            logger.exception(f"Mikrotik backup error: {e}")
            return ''
        finally:
            if self._connection:
                self._connection.disconnect()

    def get_system_resource(self) -> dict:
        # Router-এর CPU, RAM, uptime তথ্য আনে
        try:
            api = self._connect()
            resource = api.get_resource('/system/resource')
            data = resource.get()
            if data:
                return data[0]
            return {}
        except Exception as e:
            logger.exception(f"Mikrotik system resource error: {e}")
            return {}
        finally:
            if self._connection:
                self._connection.disconnect()

    def configure_radius(self, radius_host: str, shared_secret: str,
                         auth_port: int = 1812, acct_port: int = 1813) -> dict:
        # Router-এ RADIUS client যোগ করে এবং PPPoE-এ RADIUS authentication enable করে।
        # একই address আগে থেকে থাকলে update করে, না থাকলে নতুন add করে।
        try:
            api = self._connect()

            radius_res = api.get_resource('/radius')
            existing = radius_res.get(**{'address': radius_host})
            radius_params = {
                'address': radius_host,
                'secret': shared_secret,
                'authentication-port': str(auth_port),
                'accounting-port': str(acct_port),
                'service': 'ppp,login',
                'timeout': '3000ms',
            }
            if existing:
                radius_res.set(id=existing[0]['id'], **{k: v for k, v in radius_params.items() if k != 'address'})
                logger.info(f"Mikrotik RADIUS updated on {self.host}: {radius_host}")
            else:
                radius_res.add(**radius_params)
                logger.info(f"Mikrotik RADIUS added on {self.host}: {radius_host}")

            # PPPoE authentication-এ RADIUS enable করা হচ্ছে
            ppp_aaa = api.get_resource('/ppp/aaa')
            ppp_aaa.set(**{'use-radius': 'yes', 'accounting': 'yes'})

            return {'success': True, 'message': f'RADIUS ({radius_host}) সফলভাবে Router-এ কনফিগার হয়েছে।'}
        except Exception as e:
            logger.exception(f"Mikrotik configure_radius error ({self.host}): {e}")
            raise
        finally:
            if self._connection:
                self._connection.disconnect()

    def remove_radius_config(self, radius_host: str = None) -> dict:
        """Router থেকে নির্দিষ্ট RADIUS server entry মুছে দেয়।
        radius_host দিলে শুধু সেই IP-র entry মুছে, না দিলে সব RADIUS entry মুছে।
        PPPoE use-radius বন্ধ করা হয় না — অন্য RADIUS থাকতে পারে।
        """
        try:
            api = self._connect()
            radius_res = api.get_resource('/radius')
            if radius_host:
                existing = radius_res.get(**{'address': radius_host})
                for entry in existing:
                    try:
                        radius_res.remove(id=entry['id'])
                    except Exception:
                        pass
            else:
                # সব RADIUS entry মুছে দেওয়া
                all_entries = radius_res.get()
                for entry in all_entries:
                    try:
                        radius_res.remove(id=entry['id'])
                    except Exception:
                        pass
            logger.info(f"Mikrotik RADIUS config removed on {self.host} (host={radius_host or 'all'})")
            return {'success': True, 'message': 'RADIUS config মুছে দেওয়া হয়েছে।'}
        except Exception as e:
            logger.exception(f"Mikrotik remove_radius_config error ({self.host}): {e}")
            raise
        finally:
            if self._connection:
                self._connection.disconnect()

    def get_identity(self) -> dict:
        # Router-এর নাম (identity), model ও RouterOS version একসাথে আনে
        try:
            api = self._connect()
            identity_res = api.get_resource('/system/identity')
            identity = identity_res.get()
            resource_res = api.get_resource('/system/resource')
            resource = resource_res.get()
            result = {}
            if identity:
                result['name'] = identity[0].get('name', '')
            if resource:
                r = resource[0]
                result['model'] = r.get('board-name', '')
                result['version'] = r.get('version', '')
                result['uptime'] = r.get('uptime', '')
                result['cpu_load'] = r.get('cpu-load', '')
            return result
        except Exception as e:
            logger.exception(f"Mikrotik get_identity error ({self.host}): {e}")
            raise
        finally:
            if self._connection:
                self._connection.disconnect()

    def disconnect_all_active_sessions(self) -> dict:
        # সব active PPPoE session disconnect করে — পরবর্তী reconnect-এ RADIUS দিয়ে auth হবে
        try:
            api = self._connect()
            active = api.get_resource(_PPP_ACTIVE)
            sessions = active.get()
            count = 0
            for session in sessions:
                try:
                    active.remove(id=session['id'])
                    count += 1
                except Exception:
                    pass
            logger.info(f"Mikrotik: {count} active sessions disconnected on {self.host}")
            return {'success': True, 'disconnected': count, 'total': len(sessions)}
        except Exception as e:
            logger.exception(f"Mikrotik disconnect_all_active_sessions error ({self.host}): {e}")
            raise
        finally:
            if self._connection:
                self._connection.disconnect()

    def check_user_exists(self, username: str) -> bool:
        # Mikrotik /ppp/secret-এ username আছে কিনা চেক করে
        try:
            api = self._connect()
            secrets = api.get_resource(_PPP_SECRET)
            result = secrets.get(name=username)
            return len(result) > 0
        except Exception as e:
            logger.exception(f"Mikrotik check_user_exists error ({self.host}): {e}")
            return False
        finally:
            if self._connection:
                self._connection.disconnect()

    def get_pppoe_profiles(self) -> list:
        # Mikrotik Router থেকে সব PPPoE profile নাম ও সেটিং আনে
        try:
            api = self._connect()
            profiles_res = api.get_resource('/ppp/profile')
            profiles = profiles_res.get()
            return [
                {
                    'name': p.get('name', ''),
                    'local_address': p.get('local-address', ''),
                    'remote_address': p.get('remote-address', ''),
                    'rate_limit': p.get('rate-limit', ''),
                    'only_one': p.get('only-one', ''),
                }
                for p in profiles
            ]
        except Exception as e:
            logger.exception(f"Mikrotik get_pppoe_profiles error ({self.host}): {e}")
            return []
        finally:
            if self._connection:
                self._connection.disconnect()

    def create_ip_pool(self, pool_name: str, network: str, next_pool: str = '') -> dict:
        # Mikrotik Router-এ নতুন IP Pool তৈরি করে।
        # network: CIDR format যেমন 192.168.10.0/24
        # next_pool: একাধিক pool chain করতে পরবর্তী pool নাম
        try:
            import ipaddress
            net = ipaddress.ip_network(network, strict=False)
            # প্রথম IP (network address) ও শেষ IP (broadcast) বাদ দিয়ে range
            first_ip = str(net.network_address + 1)
            last_ip = str(net.broadcast_address - 1)
            ip_range = f"{first_ip}-{last_ip}"

            api = self._connect()
            pool_res = api.get_resource('/ip/pool')

            # একই নামের pool আছে কিনা চেক
            existing = pool_res.get(name=pool_name)
            params = {'name': pool_name, 'ranges': ip_range}
            if next_pool:
                params['next-pool'] = next_pool

            if existing:
                pool_res.set(id=existing[0]['id'], **{k: v for k, v in params.items() if k != 'name'})
                action = 'updated'
            else:
                pool_res.add(**params)
                action = 'created'

            logger.info(f"Mikrotik IP pool {action}: {pool_name} = {ip_range}")
            return {
                'success': True,
                'action': action,
                'pool_name': pool_name,
                'range': ip_range,
                'total_ips': net.num_addresses - 2,
            }
        except Exception as e:
            logger.exception(f"Mikrotik create_ip_pool error ({self.host}): {e}")
            raise
        finally:
            if self._connection:
                self._connection.disconnect()

    def get_ip_pools(self) -> list:
        # Mikrotik Router-এর সব IP Pool তালিকা আনে
        try:
            api = self._connect()
            pool_res = api.get_resource('/ip/pool')
            pools = pool_res.get()
            return [
                {
                    'name': p.get('name', ''),
                    'ranges': p.get('ranges', ''),
                    'next_pool': p.get('next-pool', ''),
                }
                for p in pools
            ]
        except Exception as e:
            logger.exception(f"Mikrotik get_ip_pools error ({self.host}): {e}")
            return []
        finally:
            if self._connection:
                self._connection.disconnect()

    @classmethod
    def from_server_model(cls, server) -> 'MikrotikService':
        # MikrotikServer model থেকে service instance তৈরি করা হয়
        return cls(
            host=server.host,
            username=server.username,
            password=server.password,
            port=server.port,
        )
