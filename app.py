from flask import Flask, render_template, request, jsonify, session, has_request_context, send_from_directory
import json
import os
import webbrowser
from threading import Timer, Lock, Thread
import glob
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from flask_wtf.csrf import CSRFProtect, generate_csrf
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from datetime import datetime, timedelta
from werkzeug.middleware.proxy_fix import ProxyFix
import logging
from logging.handlers import TimedRotatingFileHandler
import shutil
import subprocess
import secrets

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
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=30)

if os.environ.get('APP_ENV') == 'production':
    app.config['SESSION_COOKIE_SECURE'] = True

# Security Extensions
csrf = CSRFProtect(app)
limiter = Limiter(get_remote_address, app=app, default_limits=["200 per day", "50 per hour"])

# ------------------------------------------------------------------------------
# 2. File Paths & Logging Setup
# ------------------------------------------------------------------------------
DATA_DIR = os.path.join(BASE_DIR, 'data')
LOG_DIR = os.path.join(BASE_DIR, 'logs')
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')

# 디렉토리 생성
for d in [DATA_DIR, LOG_DIR, BACKUP_DIR]:
    if not os.path.exists(d):
        os.makedirs(d)

# JSON 파일 경로 정의
FILE_SETUP = os.path.join(DATA_DIR, 'setup_data.json')
FILE_MAINTENANCE = os.path.join(DATA_DIR, 'maintenance_data.json')
FILE_HOME = os.path.join(DATA_DIR, 'home_data.json')
FILE_WITHTECH_DATA = os.path.join(DATA_DIR, 'withtech_data.json')

# [변경] 로그 파일 경로 (logs 폴더로 이동 및 분리)
FILE_COMMON_LOG = os.path.join(LOG_DIR, 'common_log.json')
FILE_SETUP_LOG = os.path.join(LOG_DIR, 'setup_log.json')
FILE_MAINTENANCE_LOG = os.path.join(LOG_DIR, 'maintenance_log.json')

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
file_handler.setLevel(logging.WARNING)

app.logger.addHandler(file_handler)
app.logger.setLevel(logging.WARNING)
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
    tmp_path = filepath + '.tmp'
    try:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
            f.flush()
            os.fsync(f.fileno()) # 디스크 기록 강제
        os.replace(tmp_path, filepath) # 원자적 교체
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
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
            shutil.copy2(filepath, backup_path)
            
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
    try:
        if not os.path.exists(os.path.join(BASE_DIR, '.git')):
            return

        # [수정] 특정 폴더(data/)가 아닌 전체 변경 사항 감지
        status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
        if not status.stdout.strip():
            return

        # [수정] 데이터 파일뿐만 아니라 소스 코드 등 모든 변경 사항을 Commit & Push
        subprocess.run(["git", "add", "."], check=True)
        subprocess.run(["git", "commit", "-m", f"Auto-save: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"], check=True)
        subprocess.run(["git", "push"], check=True)
        app.logger.info("GitHub sync successful")
    except Exception as e:
        app.logger.error(f"GitHub sync failed: {e}")

# [추가] GitHub 데이터 가져오기 (Pull)
def git_pull_data():
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
COMMON_ACTIONS = {'LOGIN', 'LOGOUT', 'ADD_USER', 'CHANGE_PW', 'ADD_SITE', 'DELETE_SITE', 'ADD_EQUIP', 'DELETE_EQUIP', 'RENAME_ITEM', 'BACKUP_EXPORT', 'BACKUP_IMPORT'}
SETUP_ACTIONS = {
    'UPDATE_SETUP', 'ADD_SETUP_ITEM', 'DELETE_SETUP_ITEM', 'UPDATE_SETUP_ITEM', 'REORDER_SETUP',
    'UPDATE_SETUP_DETAILS', 'UPDATE_SETUP_STATUS', 'CALC_SETUP_SCHEDULE', 'START_SETUP_EXEC',
    'UPDATE_SETUP_COMPLETION', 'ADD_SETUP_LOG', 'DELETE_SETUP_LOG', 'UPDATE_SETUP_LOG_MEMO', 'UPDATE_SETUP_LOG'
}

def get_log_category(action):
    if action in COMMON_ACTIONS: return 'common'
    if action in SETUP_ACTIONS: return 'setup'
    return 'maintenance'

def init_data_files():
    """데이터 파일이 없으면 초기화하고 기본 계정을 생성합니다."""
    
    # [추가] 중요 파일이 없으면 백업에서 복원 시도
    for filepath in [FILE_HOME, FILE_SETUP, FILE_MAINTENANCE, FILE_WITHTECH_DATA, FILE_COMMON_LOG, FILE_SETUP_LOG, FILE_MAINTENANCE_LOG]:
        if not os.path.exists(filepath):
            restore_from_backup(filepath)

    # [추가] 기존 system_log.json 마이그레이션 (분할 저장)
    old_log_path = os.path.join(DATA_DIR, 'system_log.json')
    if os.path.exists(old_log_path):
        if not os.path.exists(FILE_COMMON_LOG) and not os.path.exists(FILE_SETUP_LOG) and not os.path.exists(FILE_MAINTENANCE_LOG):
            app.logger.warning("Migrating system_log.json to split log files...")
            old_logs = load_json_file(old_log_path)
            if isinstance(old_logs, list):
                common, setup, maint = [], [], []
                for log in old_logs:
                    cat = get_log_category(log.get('action', ''))
                    if cat == 'common': common.append(log)
                    elif cat == 'setup': setup.append(log)
                    else: maint.append(log)
                save_json_file(FILE_COMMON_LOG, common)
                save_json_file(FILE_SETUP_LOG, setup)
                save_json_file(FILE_MAINTENANCE_LOG, maint)
            try:
                os.rename(old_log_path, old_log_path + '.migrated')
            except: pass

    # [수정] 파일이 존재하더라도 계정 정보가 없으면(손상/삭제 등) 복구하도록 로직 개선
    home_data = load_json_file(FILE_HOME)
    
    if not home_data.get('user_accounts'):
        # 환경 변수 또는 기본값으로 계정 생성
        admin_id = os.environ.get('APP_ADMIN_ID', 'admin')
        admin_pw = os.environ.get('APP_ADMIN_PW')
        if not admin_pw:
            admin_pw = secrets.token_urlsafe(8)
            app.logger.warning(f"Initial Admin PW generated: {admin_pw}")

        user_id = os.environ.get('APP_USER_ID', 'user')
        user_pw = os.environ.get('APP_USER_PW')
        if not user_pw:
            user_pw = secrets.token_urlsafe(8)
            app.logger.warning(f"Initial User PW generated: {user_pw}")

        user_accounts = []
        if admin_id and admin_pw:
            user_accounts.append({"id": admin_id, "pw": generate_password_hash(admin_pw), "role": "admin"})
        if user_id and user_pw:
            user_accounts.append({"id": user_id, "pw": generate_password_hash(user_pw), "role": "user"})

        home_data['user_accounts'] = user_accounts
        save_json_file(FILE_HOME, home_data)
        app.logger.warning("User accounts initialized/restored to defaults.")

    for filepath in [FILE_SETUP, FILE_MAINTENANCE, FILE_WITHTECH_DATA, FILE_COMMON_LOG, FILE_SETUP_LOG, FILE_MAINTENANCE_LOG]:
        if not os.path.exists(filepath):
            save_json_file(filepath, {} if 'log.json' not in filepath else [])

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
                # [보안] 사용자 계정 정보 제외
                if 'user_accounts' in home_data:
                    home_data = home_data.copy()
                    del home_data['user_accounts']
                data.update(home_data)

        # 2. 단일 키 파일 로드 (개별 파일이 우선순위를 가짐)
        if os.path.exists(FILE_SETUP):
            setup_content = load_json_file(FILE_SETUP)
            # [수정] 중첩된 setup_data 키가 있다면 평탄화 (구조 보정)
            if isinstance(setup_content, dict) and 'setup_data' in setup_content and len(setup_content) == 1:
                setup_content = setup_content['setup_data']
            data['setup_data'] = setup_content
            
        if os.path.exists(FILE_WITHTECH_DATA):
            withtech_content = load_json_file(FILE_WITHTECH_DATA)
            # [추가] 중첩된 withtech_data 키가 있다면 평탄화 (구조 보정)
            if isinstance(withtech_content, dict) and 'withtech_data' in withtech_content and len(withtech_content) == 1:
                withtech_content = withtech_content['withtech_data']
            data['withtech_data'] = withtech_content
            
        # [변경] 3개의 로그 파일을 읽어서 하나로 합침 (프론트엔드 호환성 유지)
        common_logs = load_json_file(FILE_COMMON_LOG)
        if not isinstance(common_logs, list): common_logs = []
        
        setup_logs = load_json_file(FILE_SETUP_LOG)
        if not isinstance(setup_logs, list): setup_logs = []
        
        maint_logs = load_json_file(FILE_MAINTENANCE_LOG)
        if not isinstance(maint_logs, list): maint_logs = []
        
        data['system_logs'] = common_logs + setup_logs + maint_logs

        return data

def save_data(full_data):
    """데이터를 분류하여 각 파일에 저장하고 백업 및 Git 동기화를 수행합니다."""
    with data_lock:
        # 1. 백업 수행
        for filepath in [FILE_SETUP, FILE_MAINTENANCE, FILE_HOME, FILE_WITHTECH_DATA, FILE_COMMON_LOG, FILE_SETUP_LOG, FILE_MAINTENANCE_LOG]:
            create_daily_backup(filepath)

        # 2. 기존 데이터 로드 (병합 준비)
        setup_data = load_json_file(FILE_SETUP)
        maintenance_data = load_json_file(FILE_MAINTENANCE)
        home_data = load_json_file(FILE_HOME)
        withtech_data_storage = load_json_file(FILE_WITHTECH_DATA)
        
        # [수정] maintenance_data 및 home_data에 잘못 포함된 주요 데이터 제거 (중복/덮어쓰기 방지)
        for container in [maintenance_data, home_data]:
            if isinstance(container, dict):
                if 'setup_data' in container: del container['setup_data']
                if 'withtech_data' in container: del container['withtech_data']
                # details_로 시작하는 키도 home_data에서 제거 (maintenance_data는 details_를 가짐)
                if container is home_data:
                    keys_to_remove = [k for k in container.keys() if k.startswith('details_')]
                    for k in keys_to_remove: del container[k]
        
        # 3. 데이터 분류 및 병합
        existing_accounts = home_data.get('user_accounts', [])
        
        common_logs_list = []
        setup_logs_list = []
        maint_logs_list = []

        for key, value in full_data.items():
            if key == 'setup_data':
                # [수정] 중첩 방지: 딕셔너리 키 할당이 아닌 변수(파일 내용) 자체 교체
                setup_data = value
            elif key == 'system_logs':
                if isinstance(value, list):
                    for log in value:
                        cat = get_log_category(log.get('action', ''))
                        if cat == 'common': common_logs_list.append(log)
                        elif cat == 'setup': setup_logs_list.append(log)
                        else: maint_logs_list.append(log)
            elif key == 'withtech_data':
                # [수정] 중첩 방지
                withtech_data_storage = value
            elif key.startswith('details_'):
                # setup 관련 데이터 제거 후 maintenance에 저장
                if isinstance(value, dict):
                    value.pop('setupDetails', None)
                    value.pop('setupLogs', None)
                    value.pop('setupTasks', None)
                maintenance_data[key] = value
            else:
                # user_accounts 제외하고 home_data에 저장
                if key != 'user_accounts':
                    home_data[key] = value
        
        # 계정 정보 보존
        if isinstance(home_data, dict):
            home_data['user_accounts'] = existing_accounts

        # 4. 파일 저장
        save_json_file(FILE_SETUP, setup_data)
        save_json_file(FILE_MAINTENANCE, maintenance_data)
        save_json_file(FILE_HOME, home_data)
        save_json_file(FILE_WITHTECH_DATA, withtech_data_storage)
        
        save_json_file(FILE_COMMON_LOG, common_logs_list)
        save_json_file(FILE_SETUP_LOG, setup_logs_list)
        save_json_file(FILE_MAINTENANCE_LOG, maint_logs_list)

        # 5. Git 동기화 (비동기)
        Thread(target=git_push_data).start()

# ------------------------------------------------------------------------------
# 5. Decorators & Middlewares
# ------------------------------------------------------------------------------
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
    
    # 에러 로그 기록 (정적 파일 제외)
    if not request.path.startswith('/static') and not request.path.startswith('/favicon.ico'):
        if response.status_code >= 400:
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
        return render_template('index.html')
    return render_template('setup.html')

@app.route('/maintenance.html')
def maintenance():
    if 'user_id' not in session:
        return render_template('index.html')
    return render_template('maintenance.html')

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
    user_id = data.get('id')
    user_pw = data.get('pw')

    with data_lock:
        home_data = load_json_file(FILE_HOME)
        accounts = home_data.get('user_accounts', [])
        
        user = next((u for u in accounts if u['id'] == user_id), None)
        
        if not user:
            return jsonify({"status": "fail", "message": "아이디 또는 비밀번호가 올바르지 않습니다."}), 401

        # 1. 계정 잠금 확인
        now = datetime.now()
        lockout_until_str = user.get('lockout_until')
        if lockout_until_str:
            lockout_until = datetime.fromisoformat(lockout_until_str)
            if now < lockout_until:
                remaining_seconds = (lockout_until - now).total_seconds()
                remaining_minutes = int(remaining_seconds // 60) + 1
                return jsonify({"status": "fail", "message": f"비밀번호 5회 오류로 계정이 잠겼습니다.\n{remaining_minutes}분 후에 다시 시도해주세요."}), 403
            else:
                user['failed_attempts'] = 0
                user['lockout_until'] = None

        # 2. 비밀번호 검증
        if check_password_hash(user['pw'], user_pw):
            # 성공: 실패 횟수 초기화 및 세션 설정
            if user.get('failed_attempts', 0) > 0 or user.get('lockout_until'):
                user['failed_attempts'] = 0
                user['lockout_until'] = None
                save_json_file(FILE_HOME, home_data)

            session['user_id'] = user['id']
            session['role'] = user['role']
            return jsonify({"status": "success", "role": user['role']})
        
        # 3. 실패 처리
        current_attempts = user.get('failed_attempts', 0) + 1
        user['failed_attempts'] = current_attempts
        
        message = f"아이디 또는 비밀번호가 올바르지 않습니다.\n(실패 횟수: {current_attempts}/5)"
        
        if current_attempts >= 5:
            lockout_time = now + timedelta(minutes=5)
            user['lockout_until'] = lockout_time.isoformat()
            message = f"비밀번호 5회 오류.\n계정이 5분간 잠깁니다."
        
        save_json_file(FILE_HOME, home_data)
        return jsonify({"status": "fail", "message": message}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"status": "success"})

@app.route('/api/user/add', methods=['POST'])
@login_required
def add_user():
    data = request.json
    new_id = data.get('id')
    new_pw = data.get('pw')
    role = data.get('role', 'user')
    
    with data_lock:
        if session.get('role') != 'admin':
             return jsonify({"status": "fail", "message": "관리자 권한이 필요합니다."}), 403

        home_data = load_json_file(FILE_HOME)
        accounts = home_data.get('user_accounts', [])
        
        if any(u['id'] == new_id for u in accounts):
            return jsonify({"status": "fail", "message": "이미 존재하는 아이디입니다."}), 400
            
        accounts.append({"id": new_id, "pw": generate_password_hash(new_pw), "role": role})
        home_data['user_accounts'] = accounts
        save_json_file(FILE_HOME, home_data)
        
    return jsonify({"status": "success"})

@app.route('/api/user/password', methods=['POST'])
@login_required
def change_password():
    data = request.json
    user_id = data.get('id')
    current_pw = data.get('current_pw')
    new_pw = data.get('new_pw')
    
    with data_lock:
        home_data = load_json_file(FILE_HOME)
        accounts = home_data.get('user_accounts', [])
        user = next((u for u in accounts if u['id'] == user_id), None)
        
        if not user:
            return jsonify({"status": "fail", "message": "계정을 찾을 수 없습니다."}), 404
        if not check_password_hash(user['pw'], current_pw):
            return jsonify({"status": "fail", "message": "현재 비밀번호가 일치하지 않습니다."}), 401
            
        user['pw'] = generate_password_hash(new_pw)
        home_data['user_accounts'] = accounts
        save_json_file(FILE_HOME, home_data)
        
    return jsonify({"status": "success"})

@app.route('/api/admin/sync', methods=['POST'])
@login_required
def manual_sync():
    if session.get('role') != 'admin':
        return jsonify({"status": "fail", "message": "관리자 권한이 필요합니다."}), 403
    
    try:
        if not os.path.exists(os.path.join(BASE_DIR, '.git')):
             return jsonify({"status": "fail", "message": "Git 저장소가 아닙니다."}), 400

        # 변경 사항 확인
        status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
        if not status.stdout.strip():
             return jsonify({"status": "success", "message": "변경 사항이 없습니다."})

        # 전체 추가 및 커밋/푸시
        subprocess.run(["git", "add", "."], check=True)
        subprocess.run(["git", "commit", "-m", f"Manual-sync: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"], check=True)
        subprocess.run(["git", "push"], check=True)
        
        app.logger.info("Manual GitHub sync successful")
        return jsonify({"status": "success", "message": "GitHub 동기화가 완료되었습니다."})
    except Exception as e:
        app.logger.error(f"Manual sync failed: {e}")
        return jsonify({"status": "fail", "message": f"동기화 실패: {str(e)}"}), 500

# ------------------------------------------------------------------------------
# 8. Main Execution
# ------------------------------------------------------------------------------
if __name__ == '__main__':
    # 서버 시작 전 데이터 파일 초기화
    init_data_files()
    
    # [추가] 서버 시작 시 GitHub에서 최신 데이터 동기화
    git_pull_data()
    
    port = int(os.environ.get("APP_PORT", 5500))
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        Timer(1, lambda: webbrowser.open(f'http://127.0.0.1:{port}/')).start()
    app.run(debug=False, port=port, host='0.0.0.0')
