from flask import Flask, render_template, request, jsonify, session, has_request_context, send_from_directory, redirect
import json
import os
import sys
import webbrowser
from threading import Timer, Lock, Thread
import glob
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from flask_wtf.csrf import CSRFProtect, generate_csrf, CSRFError
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from datetime import datetime, timedelta
from werkzeug.middleware.proxy_fix import ProxyFix
import logging
from logging.handlers import TimedRotatingFileHandler
import shutil
import subprocess
import secrets
import uuid

app = Flask(__name__)

# ------------------------------------------------------------------------------
# 1. App Configuration & Security
# ------------------------------------------------------------------------------
# 프록시 서버(Nginx 등) 뒤에서 실제 IP 처리를 위한 설정
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

# 스레드 락 (파일 동시 접근 방지)
data_lock = Lock()

# 경로 설정
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(BASE_DIR, '.env')

# .env 파일 로드 및 기본값 생성
if not os.path.exists(env_path):
    try:
        with open(env_path, 'w', encoding='utf-8') as f:
            # [보안] 초기 비밀번호 랜덤 생성 (소스코드 내 하드코딩 제거)
            init_admin_pw = secrets.token_urlsafe(8)
            init_user_pw = secrets.token_urlsafe(8)
            f.write(f"APP_ADMIN_ID=admin\nAPP_ADMIN_PW={init_admin_pw}\nAPP_USER_ID=user\nAPP_USER_PW={init_user_pw}\nAPP_PORT=5500\n")
    except: pass
load_dotenv(env_path)

# Flask Config
app.secret_key = os.environ.get('SECRET_KEY', 'CHANGE_THIS_TO_A_COMPLEX_RANDOM_KEY')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=60)
app.config['TEMPLATES_AUTO_RELOAD'] = True

# [추가] JSON 데이터 저장 및 응답 시 키(Key)가 알파벳순으로 자동 정렬되는 것을 방지
app.config['JSON_SORT_KEYS'] = False
if hasattr(app, 'json'): app.json.sort_keys = False

if os.environ.get('APP_ENV') == 'production':
    app.config['SESSION_COOKIE_SECURE'] = True

# Security Extensions
csrf = CSRFProtect(app)
# [수정] 메모리 저장소 명시적 설정
# 잦은 자동 저장 및 API 호출 시 429 에러(Too Many Requests)가 발생하는 것을 막기 위해 전역 제한 해제(, default_limits=["200 per day", "50 per hour"]추가하면 보안 강화됨)
limiter = Limiter(get_remote_address, app=app, storage_uri="memory://")

# [추가] DB 설정 (SQLite)
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(BASE_DIR, 'data', 'withtech.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    pw = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default='user')
    site = db.Column(db.String(100), nullable=True) # [추가] 사업장 필드
    department = db.Column(db.String(100), nullable=True) # [추가] 소속
    position = db.Column(db.String(100), nullable=True) # [추가] 직급
    name = db.Column(db.String(100), nullable=True) # [추가] 이름
    failed_attempts = db.Column(db.Integer, default=0)
    lockout_until = db.Column(db.DateTime, nullable=True)

class SystemLog(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    action = db.Column(db.String(50))
    target = db.Column(db.String(100))
    details = db.Column(db.Text)

# ------------------------------------------------------------------------------
# [추가] 100% DB 전환을 위한 Core Business Models (스키마)
# ------------------------------------------------------------------------------
class Site(db.Model):
    name = db.Column(db.String(100), primary_key=True)
    buildings = db.Column(db.Text, default='[]') # JSON string

class Equipment(db.Model):
    id = db.Column(db.String(200), primary_key=True) # Site::Name::Serial
    site_name = db.Column(db.String(100), db.ForeignKey('site.name', ondelete='CASCADE'))
    name = db.Column(db.String(100))
    serial = db.Column(db.String(100))
    special_note = db.Column(db.Text, default='')

class SetupInfo(db.Model):
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE'), primary_key=True)
    cust_equip_name = db.Column(db.String(100), default='')
    equip_status = db.Column(db.String(50), default='')
    delivery_date = db.Column(db.String(50), default='')
    warranty_start = db.Column(db.String(50), default='')
    warranty_period = db.Column(db.String(50), default='')
    building = db.Column(db.String(100), default='')
    floor = db.Column(db.String(50), default='')
    detail_loc = db.Column(db.String(200), default='')
    manager = db.Column(db.String(100), default='')
    contact = db.Column(db.String(100), default='')
    email = db.Column(db.String(100), default='')
    cust_manager = db.Column(db.String(100), default='')
    cust_contact = db.Column(db.String(100), default='')
    cust_email = db.Column(db.String(100), default='')
    model = db.Column(db.String(100), default='')

class MaintItem(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50)) 
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE'))
    type = db.Column(db.String(50), default='')
    detail_type = db.Column(db.String(100), default='')
    code = db.Column(db.String(100), default='')
    content = db.Column(db.String(255), default='')
    date = db.Column(db.String(50), default='')
    period = db.Column(db.String(50), nullable=True)
    scheduled_date = db.Column(db.String(50), default='')
    cost_type = db.Column(db.String(50), default='')
    worker = db.Column(db.String(100), default='')
    md = db.Column(db.String(50), default='')
    item_cost = db.Column(db.String(50), default='')
    memo = db.Column(db.Text, default='')

class LogItem(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE'))
    date = db.Column(db.String(50), default='')
    type = db.Column(db.String(50), default='')
    detail_type = db.Column(db.String(100), default='')
    detail_type2 = db.Column(db.String(100), default='')
    content = db.Column(db.String(255), default='')
    add_work = db.Column(db.String(255), default='')
    cost_type = db.Column(db.String(50), default='')
    md = db.Column(db.String(50), default='')
    worker = db.Column(db.String(100), default='')
    memo = db.Column(db.Text, default='')
    is_issue_shared = db.Column(db.Boolean, default=False)
    original_log_id = db.Column(db.String(50), nullable=True)
    add_work_log_id = db.Column(db.String(50), nullable=True)

# ------------------------------------------------------------------------------
# 2. File Paths & Logging Setup
# ------------------------------------------------------------------------------
DATA_DIR = os.path.join(BASE_DIR, 'data')
LOG_DIR = os.path.join(BASE_DIR, 'logs')
DATA_LOG_DIR = os.path.join(DATA_DIR, 'log') # [추가] 데이터 로그 폴더
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')

# 디렉토리 생성
for d in [DATA_DIR, LOG_DIR, BACKUP_DIR, DATA_LOG_DIR]:
    if not os.path.exists(d):
        os.makedirs(d)

# JSON 파일 경로 정의
FILE_SETUP = os.path.join(DATA_DIR, 'setup_data.json')
FILE_MAINTENANCE = os.path.join(DATA_DIR, 'maintenance_data.json')
FILE_HOME = os.path.join(DATA_DIR, 'home_data.json')
FILE_WITHTECH = os.path.join(DATA_DIR, 'client_data.json')
FILE_DEVICE = os.path.join(DATA_DIR, 'device_data.json')
FILE_ITEM = os.path.join(DATA_DIR, 'item_data.json')
FILE_MANAGEMENT = os.path.join(DATA_DIR, 'management_data.json')

# [변경] 로그 파일 경로 (data/log 폴더로 이동)
FILE_COMMON_LOG = os.path.join(DATA_LOG_DIR, 'common_log.json')
FILE_SETUP_LOG = os.path.join(DATA_LOG_DIR, 'setup_log.json')
FILE_MAINTENANCE_LOG = os.path.join(DATA_LOG_DIR, 'maintenance_log.json')
FILE_ADMIN_LOG = os.path.join(DATA_LOG_DIR, 'admin_log.json')

# 로깅 필터 설정
class RequestInfoFilter(logging.Filter):
    def filter(self, record):
        if has_request_context():
            record.ip = get_remote_address()
            record.method = request.method
            record.url = request.url
        else:
            record.ip = 'SYSTEM'
            record.method = ''
            record.url = ''
        return True

# 로깅 핸들러 설정 (매일 자정 회전, 30일 보관)
file_handler = TimedRotatingFileHandler(os.path.join(LOG_DIR, 'server.log'), when='midnight', interval=1, backupCount=30, encoding='utf-8')
file_handler.addFilter(RequestInfoFilter())
file_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s [%(ip)s] %(method)s %(url)s: %(message)s [in %(pathname)s:%(lineno)d]'))
file_handler.setLevel(logging.INFO) # [수정] INFO 레벨 로그도 기록하도록 변경

app.logger.addHandler(file_handler)
app.logger.setLevel(logging.INFO) # [수정] INFO 레벨 로그도 기록하도록 변경
app.logger.warning('Server startup')

# ------------------------------------------------------------------------------
# 3. Utility Functions (File I/O, Backup, Git)
# ------------------------------------------------------------------------------
# [이동] load_json_file에서 사용하기 위해 위로 이동
def restore_from_backup(target_filepath):
    """파일이 없을 경우 백업 폴더에서 최신 백업을 찾아 복원합니다."""
    filename = os.path.basename(target_filepath)
    # 백업 파일 패턴: filename.YYYY-MM-DD.bak
    search_pattern = os.path.join(BACKUP_DIR, f"{filename}.*.bak")
    backups = glob.glob(search_pattern)
    
    if not backups:
        return False
        
    # 최신순 정렬 (파일명에 날짜가 포함되어 있으므로 역순 정렬 시 최신 날짜가 먼저 옴)
    backups.sort(reverse=True) 
    latest_backup = backups[0]
    
    try:
        shutil.copy2(latest_backup, target_filepath)
        app.logger.warning(f"Restored {filename} from backup: {os.path.basename(latest_backup)}")
        return True
    except Exception as e:
        app.logger.error(f"Failed to restore backup for {filename}: {e}")
        return False

def load_json_file(filepath):
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            app.logger.error(f"JSON Decode Error in {filepath}: {e}. Attempting to restore from backup.")
            # 파일이 깨졌으므로 백업에서 복구 시도
            if restore_from_backup(filepath):
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        return json.load(f)
                except Exception as retry_e:
                    app.logger.error(f"Failed to load restored file {filepath}: {retry_e}")
            return {}
        except Exception as e:
            app.logger.error(f"Error loading {filepath}: {e}")
            return {}
    return {}

# Atomic Write: 저장 중 오류 발생 시 데이터 깨짐 방지
def save_json_file(filepath, data):
    # [수정] 다중 프로세스(PythonAnywhere 워커) 환경에서 임시 파일 충돌로 인한 JSON 데이터 깨짐 방지
    tmp_path = f"{filepath}.{uuid.uuid4().hex}.tmp"
    try:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
            f.flush()
            os.fsync(f.fileno()) # 디스크 기록 강제
        os.replace(tmp_path, filepath) # 원자적 교체
    except Exception as e:
        if os.path.exists(tmp_path):
            try: os.remove(tmp_path)
            except: pass
        app.logger.error(f"Failed to save file {filepath}: {e}")
        raise e

# 일일 백업 생성 (최근 30일 보관)
def create_daily_backup(filepath):
    if not os.path.exists(filepath):
        return

    try:
        filename = os.path.basename(filepath)
        today = datetime.now().strftime('%Y-%m-%d')
        backup_filename = f"{filename}.{today}.bak"
        backup_path = os.path.join(BACKUP_DIR, backup_filename)

        # 오늘자 백업이 없으면 생성
        if not os.path.exists(backup_path):
            # [수정] 백업 파일 생성 시에도 임시 파일을 사용하여 충돌 방지
            tmp_backup = f"{backup_path}.{uuid.uuid4().hex}.tmp"
            shutil.copy2(filepath, tmp_backup)
            os.replace(tmp_backup, backup_path)
            
            # 30일 지난 백업 삭제
            cutoff_date = datetime.now() - timedelta(days=30)
            for f in os.listdir(BACKUP_DIR):
                if f.startswith(filename) and f.endswith('.bak'):
                    try:
                        date_part = f.split('.')[-2]
                        file_date = datetime.strptime(date_part, '%Y-%m-%d')
                        if file_date < cutoff_date:
                            os.remove(os.path.join(BACKUP_DIR, f))
                    except: pass
    except Exception as e:
        app.logger.error(f"Backup failed: {e}")

# GitHub 자동 동기화
def git_push_data():
    # [비활성화] 데이터는 PythonAnywhere 서버에만 저장하고 GitHub에는 올리지 않음
    return
    try:
        if not os.path.exists(os.path.join(BASE_DIR, '.git')):
            return

        # [수정] 특정 폴더(data/)가 아닌 전체 변경 사항 감지
        status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
        if not status.stdout.strip():
            return

        # [개선] Push 전 충돌 방지를 위해 Pull(rebase)을 먼저 수행하고, 실패 시 상세 로그(stderr) 캡처
        subprocess.run(["git", "pull", "--rebase"], capture_output=True, text=True)
        
        subprocess.run(["git", "add", "."], check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", f"Auto-save: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"], check=True, capture_output=True)
        
        push_res = subprocess.run(["git", "push"], capture_output=True, text=True)
        if push_res.returncode != 0:
            # [수정] 원격 저장소 동시 접근(Lock/Rejected) 오류는 시스템 장애가 아니므로 WARNING으로 변경
            app.logger.warning(f"GitHub push collision (ignored): {push_res.stderr.strip()}")
        else:
            app.logger.info("GitHub sync successful")
    except Exception as e:
        app.logger.error(f"GitHub sync failed: {e}")

# [추가] GitHub 데이터 가져오기 (Pull)
def git_pull_data():
    # [비활성화] 데이터는 PythonAnywhere 서버에만 저장하고 GitHub에는 올리지 않음
    return
    try:
        if not os.path.exists(os.path.join(BASE_DIR, '.git')):
            return

        subprocess.run(["git", "pull"], check=True)
        app.logger.info("GitHub pull successful")
    except Exception as e:
        app.logger.error(f"GitHub pull failed: {e}")

# ------------------------------------------------------------------------------
# 4. Core Logic (Data Management)
# ------------------------------------------------------------------------------
# [추가] 로그 카테고리 분류 로직 (Backend)
COMMON_ACTIONS = {'LOGIN', 'LOGOUT', 'ADD_USER', 'CHANGE_PW', 'BACKUP_EXPORT', 'BACKUP_IMPORT'}
ADMIN_ACTIONS = {
    'ADD_SITE', 'DELETE_SITE', 'RENAME_SITE', 
    'ADD_EQUIP', 'UPDATE_EQUIP', 'DELETE_EQUIP', 'RENAME_ITEM',
    'ADD_EQUIP_MODEL', 'UPDATE_EQUIP_MODEL', 'DELETE_EQUIP_MODEL',
    'ADD_ITEM_ADMIN', 'UPDATE_ITEM_ADMIN_DETAIL', 'DELETE_ITEM_ADMIN',
    'ADD_CHECK_CATEGORY', 'DELETE_CHECK_CATEGORY',
    'ADD_CHECK_ITEM', 'DELETE_CHECK_ITEM', 'LOAD_CHECK_TYPE'
}
SETUP_ACTIONS = {
    'UPDATE_SETUP', 'ADD_SETUP_ITEM', 'DELETE_SETUP_ITEM', 'UPDATE_SETUP_ITEM', 'REORDER_SETUP',
    'UPDATE_SETUP_DETAILS', 'UPDATE_SETUP_STATUS', 'CALC_SETUP_SCHEDULE', 'START_SETUP_EXEC',
    'UPDATE_SETUP_COMPLETION', 'ADD_SETUP_LOG', 'DELETE_SETUP_LOG', 'UPDATE_SETUP_LOG_MEMO', 'UPDATE_SETUP_LOG'
}

def get_log_category(action):
    if action in COMMON_ACTIONS: return 'common'
    if action in ADMIN_ACTIONS: return 'admin'
    if action in SETUP_ACTIONS: return 'setup'
    return 'maintenance'

def init_data_files():
    """데이터 파일이 없으면 초기화하고 기본 계정을 생성합니다."""

    # [추가] 중요 파일이 없으면 백업에서 복원 시도
    for filepath in [FILE_HOME, FILE_SETUP, FILE_MAINTENANCE, FILE_WITHTECH, FILE_DEVICE, FILE_ITEM, FILE_MANAGEMENT, FILE_COMMON_LOG, FILE_SETUP_LOG, FILE_MAINTENANCE_LOG, FILE_ADMIN_LOG]:
        if not os.path.exists(filepath):
            restore_from_backup(filepath)

    # [추가] logs/ 폴더의 json 로그 파일을 data/log/로 이동 (경로 변경 마이그레이션)
    old_log_dir = os.path.join(BASE_DIR, 'logs')
    for log_file in ['common_log.json', 'setup_log.json', 'maintenance_log.json', 'admin_log.json']:
        old_path = os.path.join(old_log_dir, log_file)
        new_path = os.path.join(DATA_LOG_DIR, log_file)
        if os.path.exists(old_path) and not os.path.exists(new_path):
            try:
                shutil.move(old_path, new_path)
                app.logger.info(f"Moved {log_file} from logs/ to data/log/")
            except Exception as e:
                app.logger.error(f"Failed to move {log_file}: {e}")

    # [추가] 기존 system_log.json 마이그레이션 (분할 저장)
    old_log_path = os.path.join(DATA_DIR, 'system_log.json')
    if os.path.exists(old_log_path):
        if not os.path.exists(FILE_COMMON_LOG) and not os.path.exists(FILE_SETUP_LOG) and not os.path.exists(FILE_MAINTENANCE_LOG) and not os.path.exists(FILE_ADMIN_LOG):
            app.logger.warning("Migrating system_log.json to split log files...")
            old_logs = load_json_file(old_log_path)
            if isinstance(old_logs, list):
                common, admin, setup, maint = [], [], [], []
                for log in old_logs:
                    cat = get_log_category(log.get('action', ''))
                    if cat == 'common': common.append(log)
                    elif cat == 'admin': admin.append(log)
                    elif cat == 'setup': setup.append(log)
                    else: maint.append(log)
                save_json_file(FILE_COMMON_LOG, common)
                save_json_file(FILE_ADMIN_LOG, admin)
                save_json_file(FILE_SETUP_LOG, setup)
                save_json_file(FILE_MAINTENANCE_LOG, maint)
            try:
                os.rename(old_log_path, old_log_path + '.migrated')
            except: pass

    for filepath in [FILE_SETUP, FILE_MAINTENANCE, FILE_WITHTECH, FILE_DEVICE, FILE_MANAGEMENT, FILE_COMMON_LOG, FILE_SETUP_LOG, FILE_MAINTENANCE_LOG, FILE_ADMIN_LOG]:
        if not os.path.exists(filepath):
            save_json_file(filepath, {} if 'log.json' not in filepath else [])
            
    if not os.path.exists(FILE_ITEM):
        save_json_file(FILE_ITEM, [])

def load_data():
    """모든 데이터 파일을 읽어 하나의 딕셔너리로 병합합니다."""
    with data_lock:
        data = {}
        
        # 1. 병합 파일 먼저 로드 (Maintenance, Home) - 기본 베이스
        if os.path.exists(FILE_MAINTENANCE):
            maint_data = load_json_file(FILE_MAINTENANCE)
            if isinstance(maint_data, dict):
                data.update(maint_data)
                
        if os.path.exists(FILE_HOME):
            home_data = load_json_file(FILE_HOME)
            if isinstance(home_data, dict):
                data.update(home_data)

        # 2. 단일 키 파일 로드 (개별 파일이 우선순위를 가짐)
        if os.path.exists(FILE_SETUP):
            setup_content = load_json_file(FILE_SETUP)
            # [수정] 중첩된 setup_data 키가 있다면 평탄화 (구조 보정)
            if isinstance(setup_content, dict) and 'setup_data' in setup_content and len(setup_content) == 1:
                setup_content = setup_content['setup_data']
            data['setup_data'] = setup_content
            
        # 3. 데이터 구조 재설계 파일들 (Adapter Pattern)
        # 3.1 client_data.json (사업장 관리)
        withtech_file = load_json_file(FILE_WITHTECH)
        if isinstance(withtech_file, dict):
            for site, info in withtech_file.items():
                if isinstance(info, dict) and 'buildings' in info:
                    data[f'site_meta_{site}'] = {'buildings': info['buildings']}

        # 3.2 device_data.json (장비 관리)
        device_file = load_json_file(FILE_DEVICE)
        if isinstance(device_file, dict):
            data['equipment_models'] = device_file.get('models', [])
            data['device_data'] = device_file.get('equipments', {})
            # device_data.json 내의 상세 정보(setup, specialNote)를 details_ 객체에 병합
            details_obj = device_file.get('details', {})
            for site_equip, info in details_obj.items():
                k = f'details_{site_equip}'
                if k not in data:
                    data[k] = {}
                data[k]['setup'] = info.get('setup', {})
                data[k]['specialNote'] = info.get('specialNote', '')
                
        # 3.3 Item.json (물품 관리)
        item_file = load_json_file(FILE_ITEM)
        data['admin_items'] = item_file if isinstance(item_file, list) else []
        
        # 3.4 management_data.json (점검 구분 관리)
        mgmt_file = load_json_file(FILE_MANAGEMENT)
        if isinstance(mgmt_file, dict):
            data['check_type_categories'] = mgmt_file.get('categories', {})
            data['check_type_items'] = mgmt_file.get('items', {})
            
        # [마이그레이션 호환성] 기존 withtech_data.json 이 남아있다면 병합 (초기 1회용)
        old_withtech_path = os.path.join(DATA_DIR, 'withtech_data.json')
        if os.path.exists(old_withtech_path) and not data.get('device_data'):
            old_data = load_json_file(old_withtech_path)
            if isinstance(old_data, dict) and 'withtech_data' in old_data:
                data['device_data'] = old_data['withtech_data']
            else:
                data['device_data'] = old_data

        return data

def save_data(full_data):
    """데이터를 분류하여 각 파일에 저장합니다. (클라이언트 상태 우선 신뢰)"""
    with data_lock:
        # 1. 백업 수행
        for filepath in [FILE_SETUP, FILE_MAINTENANCE, FILE_HOME, FILE_WITHTECH, FILE_DEVICE, FILE_ITEM, FILE_MANAGEMENT, FILE_COMMON_LOG, FILE_SETUP_LOG, FILE_MAINTENANCE_LOG, FILE_ADMIN_LOG]:
            create_daily_backup(filepath)

        # 2. 기존 데이터 로드
        home_data = load_json_file(FILE_HOME)
        home_data.clear()
        
        if not full_data:
            return

        # 각 저장소 컨테이너 초기화
        setup_data = {}
        maintenance_data = {}
        withtech_data = {}
        # [수정] 클라이언트 상태를 신뢰하여 즉각 삭제 반영 (기존 서버 데이터 부활 로직 제거)
        device_json_data = {
            "models": full_data.get('equipment_models', []),
            "equipments": full_data.get('device_data', {}),
            "details": {}
        }
        item_data = full_data.get('admin_items', [])
        management_data = {
            "categories": full_data.get('check_type_categories', {}),
            "items": full_data.get('check_type_items', {})
        }

        # [추가] 유효한 사업장 및 장비 목록 추출 (가비지/고아 데이터 필터링 방어막)
        valid_sites = set(device_json_data['equipments'].keys())
        valid_site_equips = {f"{site}_{equip}" for site, equips in device_json_data['equipments'].items() for equip in equips}

        # 3. 데이터 분류 및 병합
        for key, value in full_data.items():
            if key == 'setup_data':
                setup_data = value
            elif key.startswith('site_meta_'):
                site = key.replace('site_meta_', '')
                # [핵심] 실제 목록에 없는 사업장 메타데이터 무시
                if site not in valid_sites:
                    continue
                if site not in withtech_data:
                    withtech_data[site] = {}
                withtech_data[site]['buildings'] = value.get('buildings', [])
            elif key.startswith('details_'):
                site_equip = key.replace('details_', '', 1)
                if not isinstance(value, dict):
                    continue
                
                # [핵심] 장비 트리 목록에 존재하지 않는 외계어/찌꺼기 상세 데이터는 즉시 버림
                if site_equip not in valid_site_equips:
                    continue

                # maintenance_data.json 에는 운영 정보만 저장
                if key not in maintenance_data:
                    maintenance_data[key] = {}
                maintenance_data[key]['maint'] = value.get('maint', [])
                maintenance_data[key]['logs'] = value.get('logs', [])
                maintenance_data[key]['memo'] = value.get('memo', '')
                maintenance_data[key]['files'] = value.get('files', [])
                
                # device_data.json 에는 장비 설정 및 특이사항 정보 저장
                if site_equip not in device_json_data['details']:
                    device_json_data['details'][site_equip] = {}
                device_json_data['details'][site_equip]['setup'] = value.get('setup', {})
                device_json_data['details'][site_equip]['specialNote'] = value.get('specialNote', '')
            elif key in ['equipment_models', 'device_data', 'admin_items', 'check_type_categories', 'check_type_items']:
                # 이미 각 구조체로 매핑했으므로 무시
                pass
            else:
                # 위 분류에 속하지 않는 나머지 (예: 대시보드 기타 설정 등)는 home_data에 저장
                home_data[key] = value

        # [수정] 클라이언트에서 완전히 삭제된 데이터는 서버 JSON에서도 소멸되도록 처리
        # 장비 트리에 등록되어 있으나 상세 데이터가 누락된 경우에만 빈 껍데기로 초기화 (찌꺼기 방지)
        for site, equips in device_json_data['equipments'].items():
            for equip in equips:
                site_equip = f"{site}_{equip}"
                detail_key = f"details_{site_equip}"
                
                if site_equip not in device_json_data['details']:
                    device_json_data['details'][site_equip] = {"setup": {}, "specialNote": ""}
                        
                if detail_key not in maintenance_data:
                    maintenance_data[detail_key] = {"maint": [], "logs": [], "memo": "", "files": []}

        # [보완] 사업장 기본 골격 생성 및 기존 건물명 데이터 보호 (방어 로직)
        for site in device_json_data['equipments'].keys():
            if site not in withtech_data:
                withtech_data[site] = {"buildings": []}

        # 4. 파일 저장
        save_json_file(FILE_SETUP, setup_data)
        save_json_file(FILE_MAINTENANCE, maintenance_data)
        save_json_file(FILE_HOME, home_data)
        save_json_file(FILE_WITHTECH, withtech_data)
        save_json_file(FILE_DEVICE, device_json_data)
        save_json_file(FILE_ITEM, item_data)
        save_json_file(FILE_MANAGEMENT, management_data)
        
        # 5. Git 동기화 (비동기) - 비활성화됨
        # Thread(target=git_push_data).start()

# ------------------------------------------------------------------------------
# 5. Decorators & Middlewares
# ------------------------------------------------------------------------------
# [추가] 템플릿 전역에서 모바일 접속 여부(is_mobile)를 사용할 수 있도록 설정
@app.context_processor
def inject_mobile_info():
    user_agent = request.headers.get('User-Agent', '').lower()
    is_mobile = 'mobile' in user_agent or 'android' in user_agent or 'iphone' in user_agent
    return dict(is_mobile=is_mobile)

# [추가] CSRF 토큰 오류 전용 핸들러 (원인 명확화)
@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    # [개선] 세션 만료 후 자동 저장 요청 등에 의한 자연스러운 현상이므로 INFO 레벨로 낮춰 로그 도배 방지
    app.logger.info(f"CSRF Expected Error (Session Expired): {e.description} (Path: {request.path})")
    return jsonify({"status": "fail", "message": "보안 세션이 만료되었거나 유효하지 않습니다. 페이지를 새로고침 해주세요."}), 400

# [추가] 잘못된 요청(Bad Request) 전용 핸들러
@app.errorhandler(400)
def handle_bad_request(e):
    app.logger.warning(f"Bad Request: {e.description} (Path: {request.path})")
    return jsonify({"status": "fail", "message": "잘못된 데이터 형식입니다."}), 400

# [추가] 무차별 대입 방지(Limiter) 429 에러 발생 시 프론트엔드 크래시 방지용 JSON 핸들러
@app.errorhandler(429)
def handle_too_many_requests(e):
    return jsonify({"status": "fail", "message": "짧은 시간에 너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요."}), 429

def login_required(f):
    """로그인 여부를 확인하는 데코레이터"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"status": "fail", "message": "로그인이 필요합니다."}), 401
        return f(*args, **kwargs)
    return decorated_function

@app.after_request
def set_security_headers(response):
    """모든 응답에 보안 헤더 및 CSRF 토큰 설정"""
    response.set_cookie('csrf_token', generate_csrf())
    
    # 에러 로그 기록 (정적 파일 경로 제외)
    if not request.path.startswith(('/static', '/SettingDAO', '/favicon.ico')):
        # [수정] 401 Unauthorized는 정상적인 인증 루틴일 수 있으므로 경고 로그에서 제외 (로그인 실패 등)
        # [개선] 400 에러는 위의 에러 핸들러와 일반 비즈니스 로직(중복 아이디 등)에서 처리/기록하므로 포괄 로그에서 제외 (중복 방지)
        if response.status_code > 400 and response.status_code != 401:
            app.logger.warning(f"Response Status: {response.status}")
    
    # 보안 헤더
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    if os.environ.get('APP_ENV') == 'production':
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        
    return response

# ------------------------------------------------------------------------------
# 6. Routes: Views (HTML)
# ------------------------------------------------------------------------------
@app.route('/') 
@app.route('/index.html')
def home():
    return render_template('index.html')

@app.route('/setup.html')
def setup():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('setup.html')

@app.route('/maintenance.html')
def maintenance():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('maintenance.html')

@app.route('/admin.html')
def admin():
    if 'user_id' not in session:
        return redirect('/')
    if session.get('role') not in ['admin', 'superadmin']:
        return redirect('/')
    return render_template('admin.html')

@app.route('/sort')
def sort():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('sort.html')

# [추가] SettingDAO 폴더 정적 파일 서빙
@app.route('/SettingDAO/<path:filename>')
@limiter.exempt
def SettingDAO(filename):
    return send_from_directory(os.path.join(app.root_path, 'SettingDAO'), filename)

# ------------------------------------------------------------------------------
# 7. Routes: API
# ------------------------------------------------------------------------------
@app.route('/api/data', methods=['GET', 'POST'])
@login_required
def handle_data():
    if request.method == 'POST':
        data = request.json
        save_data(data)
        return jsonify({"status": "success", "message": "저장되었습니다."})
    else:
        return jsonify(load_data())

@app.route('/api/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    data = request.json
    user_id = data.get('id', '').strip()  # [수정] 모바일/복붙 시 발생하는 보이지 않는 끝 공백 제거
    user_pw = data.get('pw', '').strip()

    user = User.query.filter_by(id=user_id).first()

    if not user:
        return jsonify({"status": "fail", "message": "아이디 또는 비밀번호가 올바르지 않습니다."}), 401

    # 1. 계정 잠금 확인
    now = datetime.now()
    if user.lockout_until:
        if now < user.lockout_until:
            remaining_seconds = (user.lockout_until - now).total_seconds()
            remaining_minutes = int(remaining_seconds // 60) + 1
            return jsonify({"status": "fail", "message": f"비밀번호 5회 오류로 계정이 잠겼습니다.\n{remaining_minutes}분 후에 다시 시도해주세요."}), 403
        else:
            user.failed_attempts = 0
            user.lockout_until = None
            db.session.commit()

    # 2. 비밀번호 검증
    if check_password_hash(user.pw, user_pw):
        # 성공: 실패 횟수 초기화 및 세션 설정
        if user.failed_attempts > 0 or user.lockout_until:
            user.failed_attempts = 0
            user.lockout_until = None
            db.session.commit()

        session['user_id'] = user.id
        session['role'] = user.role
        session['site'] = user.site # [추가]
        return jsonify({
            "status": "success", 
            "role": user.role, 
            "site": user.site,
            "department": user.department or "",
            "position": user.position or "",
            "name": user.name or ""
        })

    # 3. 실패 처리
    user.failed_attempts += 1

    message = f"아이디 또는 비밀번호가 올바르지 않습니다.\n(실패 횟수: {user.failed_attempts}/5)"

    if user.failed_attempts >= 5:
        user.lockout_until = now + timedelta(minutes=5)
        message = f"비밀번호 5회 오류.\n계정이 5분간 잠깁니다."

    db.session.commit()
    return jsonify({"status": "fail", "message": message}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"status": "success"})

# [추가] 계정 정보 조회 API
@app.route('/api/user/info', methods=['GET'])
@login_required
def get_user_info():
    user = User.query.filter_by(id=session.get('user_id')).first()
    if not user:
        return jsonify({"status": "fail", "message": "사용자를 찾을 수 없습니다."}), 404
    return jsonify({
        "status": "success",
        "user": {
            "id": user.id,
            "role": user.role,
            "site": user.site or "",
            "department": user.department or "",
            "position": user.position or "",
            "name": user.name or ""
        }
    })

# [추가] 비밀번호 확인 API (수정 전 인증용)
@app.route('/api/user/verify', methods=['POST'])
@login_required
def verify_user_pw():
    data = request.json
    pw = data.get('pw')
    user = User.query.filter_by(id=session.get('user_id')).first()
    if not user or not check_password_hash(user.pw, pw):
        return jsonify({"status": "fail", "message": "비밀번호가 일치하지 않습니다."}), 401
    return jsonify({"status": "success"})

# [추가] 계정 정보 수정 API
@app.route('/api/user/update', methods=['POST'])
@login_required
def update_user_info():
    data = request.json
    user = User.query.filter_by(id=session.get('user_id')).first()
    if not user: return jsonify({"status": "fail", "message": "사용자를 찾을 수 없습니다."}), 404
    if 'department' in data: user.department = data['department']
    if 'position' in data: user.position = data['position']
    if 'name' in data: user.name = data['name']
    if 'site' in data: user.site = data['site']
    if 'role' in data and session.get('role') in ['admin', 'superadmin']:
        if user.role != 'superadmin' and user.id != 'admin' and user.id != os.environ.get('APP_ADMIN_ID', 'admin'): 
            user.role = data['role']
    db.session.commit()
    session['role'] = user.role
    session['site'] = user.site
    return jsonify({"status": "success"})

# [추가] 작업자 선택용 사용자 이름 목록 조회 API
@app.route('/api/users/names', methods=['GET'])
@login_required
def get_user_names():
    target_site = request.args.get('site', None)
    excluded_ids = ['admin', 'user', os.environ.get('APP_ADMIN_ID', 'admin'), os.environ.get('APP_USER_ID', 'user')]
    users = User.query.filter(~User.id.in_(excluded_ids)).all()
    
    site_workers = []
    other_workers = []
    seen = set()

    for u in users:
        name = u.name if u.name else u.id
        if name not in seen:
            seen.add(name)
            worker_data = {
                "name": name,
                "department": u.department or "",
                "position": u.position or "",
                "site": u.site or ""
            }
            if target_site and u.site == target_site:
                site_workers.append(worker_data)
            else:
                other_workers.append(worker_data)
    
    # 각 그룹을 이름순으로 정렬
    site_workers.sort(key=lambda x: x["name"])
    other_workers.sort(key=lambda x: x["name"])
    
    # 해당 사업장 작업자를 우선으로 하여 리스트 결합
    workers = site_workers + other_workers
            
    return jsonify({"status": "success", "workers": workers})

@app.route('/api/session/extend', methods=['POST'])
@login_required
def extend_session():
    session.modified = True
    return jsonify({"status": "success", "message": "세션이 연장되었습니다."})

@app.route('/api/user/add', methods=['POST'])
@login_required
def add_user():
    data = request.json
    new_id = data.get('id')
    new_pw = data.get('pw')
    role = data.get('role', 'user')
    site = data.get('site', '') # [추가]
    department = data.get('department', '') # [추가]
    position = data.get('position', '') # [추가]
    name = data.get('name', '') # [추가]
    
    if session.get('role') not in ['admin', 'superadmin']:
        return jsonify({"status": "fail", "message": "관리자 권한이 필요합니다."}), 403
    if role == 'superadmin' and session.get('role') != 'superadmin':
        return jsonify({"status": "fail", "message": "최종 관리자 계정은 최종 관리자만 생성할 수 있습니다."}), 403

    if User.query.filter_by(id=new_id).first():
        return jsonify({"status": "fail", "message": "이미 존재하는 아이디입니다."}), 400

    new_user = User(id=new_id, pw=generate_password_hash(new_pw), role=role, site=site, department=department, position=position, name=name)
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"status": "success"})

@app.route('/api/user/password', methods=['POST'])
@login_required
def change_password():
    data = request.json
    user_id = data.get('id')
    current_pw = data.get('current_pw')
    new_pw = data.get('new_pw')
    
    user = User.query.filter_by(id=user_id).first()

    if not user:
        return jsonify({"status": "fail", "message": "계정을 찾을 수 없습니다."}), 404
    if not check_password_hash(user.pw, current_pw):
        return jsonify({"status": "fail", "message": "현재 비밀번호가 일치하지 않습니다."}), 401

    user.pw = generate_password_hash(new_pw)
    db.session.commit()

    return jsonify({"status": "success"})

# [추가] 계정 삭제 API
@app.route('/api/user/delete', methods=['POST'])
@login_required
def delete_account():
    data = request.json
    user_id = data.get('id')
    pw = data.get('pw')
    
    if session.get('user_id') != user_id:
        return jsonify({"status": "fail", "message": "권한이 없습니다."}), 403

    if user_id == 'admin' or user_id == os.environ.get('APP_ADMIN_ID', 'admin'):
        return jsonify({"status": "fail", "message": "시스템 보호를 위해 최고 관리자 계정은 삭제할 수 없습니다."}), 403

    user = User.query.filter_by(id=user_id).first()
    if not user or not check_password_hash(user.pw, pw):
        return jsonify({"status": "fail", "message": "비밀번호가 일치하지 않습니다."}), 401

    db.session.delete(user)
    db.session.commit()
    return jsonify({"status": "success"})

# [추가] 관리자용 일반 사용자 목록 조회 API
@app.route('/api/users/deletable', methods=['GET'])
@login_required
def get_deletable_users():
    if session.get('role') not in ['admin', 'superadmin']:
        return jsonify({"status": "fail", "message": "권한이 없습니다."}), 403
    
    if session.get('role') == 'superadmin':
        users = User.query.filter(User.role.in_(['admin', 'user'])).all()
    else:
        users = User.query.filter(~User.role.in_(['admin', 'superadmin'])).all()
        
    user_list = [{"id": u.id, "name": u.name or '', "department": u.department or '', "position": u.position or '', "role": u.role} for u in users]
    return jsonify({"status": "success", "users": user_list})

# [추가] 관리자용 특정 사용자 삭제 API
@app.route('/api/admin/user/delete', methods=['POST'])
@login_required
def admin_delete_target_user():
    if session.get('role') not in ['admin', 'superadmin']:
        return jsonify({"status": "fail", "message": "권한이 없습니다."}), 403
    
    target_id = request.json.get('target_id')
    target_user = User.query.filter_by(id=target_id).first()
    
    if not target_user:
        return jsonify({"status": "fail", "message": "사용자를 찾을 수 없습니다."}), 404
    if target_user.role == 'superadmin' or target_id == 'admin' or target_id == os.environ.get('APP_ADMIN_ID', 'admin'):
        return jsonify({"status": "fail", "message": "최종 관리자 계정은 삭제할 수 없습니다."}), 403
    if session.get('role') == 'admin' and target_user.role == 'admin':
        return jsonify({"status": "fail", "message": "일반 관리자는 다른 관리자 계정을 삭제할 수 없습니다."}), 403
        
    db.session.delete(target_user)
    db.session.commit()
    return jsonify({"status": "success"})

# [추가] DB 기반 로그 API
@app.route('/api/log/add', methods=['POST'])
@login_required
def add_log():
    data = request.json
    new_log = SystemLog(
        action=data.get('action'),
        target=data.get('target'),
        details=data.get('details', '')
    )
    db.session.add(new_log)
    db.session.commit()
    return jsonify({"status": "success"})

@app.route('/api/logs', methods=['GET'])
@login_required
def get_logs():
    logs = SystemLog.query.order_by(SystemLog.timestamp.desc()).all()
    result = [{
        "id": log.id,
        "timestamp": log.timestamp.isoformat() + "Z",
        "action": log.action,
        "target": log.target,
        "details": log.details
    } for log in logs]
    return jsonify(result)

@app.route('/api/logs/clear', methods=['POST'])
@login_required
def clear_logs():
    if session.get('role') not in ['admin', 'superadmin']:
         return jsonify({"status": "fail", "message": "관리자 권한이 필요합니다."}), 403
    try:
        db.session.query(SystemLog).delete()
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] 안전한 데이터 마이그레이션 API (JSON -> DB 복사 전용)
@app.route('/api/admin/migrate_json_to_db', methods=['POST'])
@login_required
def migrate_json_to_db():
    if session.get('role') != 'superadmin':
        return jsonify({"status": "fail", "message": "최종 관리자 권한이 필요합니다."}), 403
        
    try:
        data = load_data() # 메모리에 머지된 전체 JSON 데이터 로드
        
        # 테스트 반복을 위해 기존 복사된 테이블 데이터만 초기화 (유저/시스템로그 제외)
        db.session.query(LogItem).delete()
        db.session.query(MaintItem).delete()
        db.session.query(SetupInfo).delete()
        db.session.query(Equipment).delete()
        db.session.query(Site).delete()
        
        # 1. 사업장 (Site) 마이그레이션
        withtech = data.get('withtech_data', {})
        equipments = data.get('device_data', {})
        all_sites = set(list(withtech.keys()) + list(equipments.keys()))
        
        for s_name in all_sites:
            bldgs = []
            meta_key = f"site_meta_{s_name}"
            if meta_key in data:
                bldgs = data[meta_key].get('buildings', [])
            db.session.add(Site(name=s_name, buildings=json.dumps(bldgs, ensure_ascii=False)))
            
        # 2. 장비(Equipment) 및 하위 데이터 마이그레이션
        for site_name, equips in equipments.items():
            for equip_name_serial in equips:
                equip_id = f"{site_name}::{equip_name_serial}"
                parts = equip_name_serial.split('::')
                e_name = parts[0]
                e_serial = parts[1] if len(parts) > 1 else ''
                
                detail_key = f"details_{site_name}_{equip_name_serial}"
                detail = data.get(detail_key, {})
                
                # 장비 기본 정보
                db.session.add(Equipment(
                    id=equip_id, site_name=site_name, name=e_name, 
                    serial=e_serial, special_note=detail.get('specialNote', '')
                ))
                
                # 셋업(마스터) 정보
                setup = detail.get('setup', {})
                db.session.add(SetupInfo(
                    equip_id=equip_id, cust_equip_name=setup.get('custEquipName', ''),
                    equip_status=setup.get('equipStatus', ''), delivery_date=setup.get('deliveryDate', ''),
                    warranty_start=setup.get('warrantyStart', ''), warranty_period=str(setup.get('warrantyPeriod', '')),
                    building=setup.get('building', ''), floor=setup.get('floor', ''), detail_loc=setup.get('detailLoc', ''),
                    manager=setup.get('manager', ''), contact=setup.get('contact', ''), email=setup.get('email', ''),
                    cust_manager=setup.get('custManager', ''), cust_contact=setup.get('custContact', ''),
                    cust_email=setup.get('custEmail', ''), model=setup.get('model', '')
                ))
                
                # 유지관리 예정 정보
                for m in detail.get('maint', []):
                    db.session.add(MaintItem(
                        id=str(m.get('id', '')), equip_id=equip_id, type=m.get('type', ''),
                        detail_type=m.get('detailType', ''), code=m.get('code', ''), content=m.get('content', ''),
                        date=m.get('date', ''), period=str(m.get('period', '')), scheduled_date=m.get('scheduledDate', ''),
                        cost_type=m.get('costType', ''), worker=m.get('worker', ''), md=str(m.get('md', '')),
                        item_cost=m.get('itemCost', ''), memo=m.get('memo', '')
                    ))
                    
                # 점검 이력
                for l in detail.get('logs', []):
                    db.session.add(LogItem(
                        id=str(l.get('id', '')), equip_id=equip_id, date=l.get('date', ''),
                        type=l.get('type', ''), detail_type=l.get('detailType', ''), detail_type2=l.get('detailType2', ''),
                        content=l.get('content', ''), add_work=l.get('addWork', ''), cost_type=l.get('costType', ''),
                        md=str(l.get('md', '')), worker=l.get('worker', ''), memo=l.get('memo', ''),
                        is_issue_shared=bool(l.get('isIssueShared', False)),
                        original_log_id=str(l.get('originalLogId', '')), add_work_log_id=str(l.get('addWorkLogId', ''))
                    ))
                    
        db.session.commit()
        app.logger.info("Data successfully cloned from JSON to SQLite DB.")
        return jsonify({"status": "success", "message": "현재 운영 중인 JSON 데이터가 SQLite DB로 완벽하게 안전 복사(마이그레이션) 되었습니다.\n\n(기존 JSON 데이터는 삭제되지 않았으며, 시스템은 계속 정상 작동합니다.)"})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "fail", "message": f"마이그레이션 실패: {str(e)}"}), 500

# ------------------------------------------------------------------------------
# 8. Main Execution
# ------------------------------------------------------------------------------
def init_db():
    with app.app_context():
        db.create_all()
        
        # [마이그레이션] 기존 user 테이블에 site 컬럼 추가 (DB 업데이트)
        try:
            # [개선] 예약어 충돌 방지를 위해 테이블명을 큰따옴표로 감쌈
            db.session.execute(text('ALTER TABLE "user" ADD COLUMN site VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()
            
        # [마이그레이션] 기존 user 테이블에 추가 정보 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE "user" ADD COLUMN department VARCHAR(100)'))
            db.session.execute(text('ALTER TABLE "user" ADD COLUMN position VARCHAR(100)'))
            db.session.execute(text('ALTER TABLE "user" ADD COLUMN name VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()
        
        # [DB 마이그레이션] 사용자 데이터
        home_data = load_json_file(FILE_HOME)
        accounts = home_data.get('user_accounts', [])
        if accounts:
            for acc in accounts:
                if not User.query.filter_by(id=acc['id']).first():
                    pw_val = acc['pw']
                    # 기존 JSON에 저장된 비밀번호가 평문인 경우 해시로 변환하여 삽입
                    if not (pw_val.startswith('scrypt:') or pw_val.startswith('pbkdf2:')):
                        pw_val = generate_password_hash(pw_val)
                        
                    new_user = User(id=acc['id'], pw=pw_val, role=acc.get('role', 'user'))
                    db.session.add(new_user)
            db.session.commit()
            del home_data['user_accounts']
            save_json_file(FILE_HOME, home_data)
            app.logger.warning("Migrated user accounts from JSON to SQLite DB.")
            
        # Admin 초기 계정 생성
        admin_id = os.environ.get('APP_ADMIN_ID', 'admin')
        admin_user = User.query.filter_by(id=admin_id).first()
        if not admin_user:
            admin_pw = os.environ.get('APP_ADMIN_PW', secrets.token_urlsafe(8))
            admin_user = User(id=admin_id, pw=generate_password_hash(admin_pw), role='superadmin')
            db.session.add(admin_user)
            db.session.commit()
            app.logger.warning(f"Initial Admin PW generated in DB: {admin_pw}")
            print(f"[*] Super Admin Account Created -> ID: {admin_id} / PW: {admin_pw}")
        elif admin_user.role == 'admin':
            admin_user.role = 'superadmin'
            db.session.commit()
            print(f"[*] Admin Account '{admin_id}' elevated to 'superadmin'")
            
        # 일반 사용자(User) 초기 계정 자동 생성
        user_id = os.environ.get('APP_USER_ID', 'user')
        if not User.query.filter_by(id=user_id).first():
            user_pw = os.environ.get('APP_USER_PW', secrets.token_urlsafe(8))
            normal_user = User(id=user_id, pw=generate_password_hash(user_pw), role='user')
            db.session.add(normal_user)
            db.session.commit()
            app.logger.warning(f"Initial User PW generated in DB: {user_pw}")
            print(f"[*] User Account Created -> ID: {user_id} / PW: {user_pw}")

        # [수정] 이중 해싱 방지: Werkzeug 해시는 방식(scrypt, pbkdf2, sha256 등)과 무관하게 반드시 '$' 기호를 포함합니다. 
        # '$'가 없는 경우에만 평문으로 간주하고 해시하도록 강력하게 제한합니다.
        all_users = User.query.all()
        for u in all_users:
            if u.pw and '$' not in u.pw:
                u.pw = generate_password_hash(u.pw)
        db.session.commit()

        # [DB 마이그레이션] 시스템 로그 데이터
        if not SystemLog.query.first():
            all_logs = []
            for filepath in [FILE_COMMON_LOG, FILE_SETUP_LOG, FILE_MAINTENANCE_LOG, FILE_ADMIN_LOG]:
                logs = load_json_file(filepath)
                if isinstance(logs, list):
                    all_logs.extend(logs)
            if all_logs:
                for log in all_logs:
                    try:
                        ts_str = log.get('timestamp', '')
                        if ts_str.endswith('Z'): ts_str = ts_str[:-1]
                        ts = datetime.fromisoformat(ts_str) if ts_str else datetime.utcnow()
                    except:
                        ts = datetime.utcnow()
                        
                    db.session.add(SystemLog(timestamp=ts, action=log.get('action'), target=log.get('target'), details=log.get('details', '')))
                db.session.commit()
                app.logger.warning("Migrated system logs from JSON to SQLite DB.")
            else:
                db.session.add(SystemLog(action='SYSTEM_INIT', target='Database', details='Database initialized.'))
                db.session.commit()

# WSGI 서버(PythonAnywhere 등) 환경에서도 앱 구동 시 초기화가 실행되도록 __main__ 블록 밖으로 이동
init_data_files()
init_db()

if __name__ == '__main__':
    
    # [추가] 서버 시작 시 GitHub에서 최신 데이터 동기화 - 비활성화됨
    # git_pull_data()
    
    port = int(os.environ.get("APP_PORT", 5500))
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        Timer(1, lambda: webbrowser.open(f'http://127.0.0.1:{port}/')).start()

    # [수정] Waitress 서버 적용 (개발 서버 경고 제거 및 안정성 향상)
    try:
        from waitress import serve
        print(f" * Serving with Waitress on http://0.0.0.0:{port}")
        serve(app, host='0.0.0.0', port=port, threads=6)
    except ImportError:
        # Waitress가 설치되지 않은 경우 기존 Flask 개발 서버 사용
        print(" * Waitress not found. Running with basic Flask server.")
        print(f" * To fix the warning, run: & \"{sys.executable}\" -m pip install waitress")
        app.run(debug=False, port=port, host='0.0.0.0')
