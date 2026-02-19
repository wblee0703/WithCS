from flask import Flask, render_template, request, jsonify, session, has_request_context
import json
import os
import webbrowser
from threading import Timer, Lock, Thread
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

app = Flask(__name__)
# [배포 설정] 프록시 서버(Nginx, AWS ALB 등) 뒤에서 실행될 때 실제 클라이언트 IP를 찾기 위한 설정
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
# 파일 접근 충돌 방지를 위한 락 생성
data_lock = Lock()

# [수정] 파일 경로를 절대 경로로 설정하여 실행 위치에 상관없이 동작하도록 함
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# [추가] .env 파일 로드
env_path = os.path.join(BASE_DIR, '.env')
# .env 파일이 없으면 기본값으로 자동 생성
if not os.path.exists(env_path):
    try:
        with open(env_path, 'w', encoding='utf-8') as f:
            f.write("APP_ADMIN_ID=admin\nAPP_ADMIN_PW=1234\nAPP_USER_ID=user\nAPP_USER_PW=1234\nAPP_PORT=5500\n")
    except: pass
load_dotenv(env_path)

# [보안] 세션 암호화를 위한 시크릿 키 설정 (배포 시 .env에서 관리 권장)
app.secret_key = os.environ.get('SECRET_KEY', 'CHANGE_THIS_TO_A_COMPLEX_RANDOM_KEY')

# [보안] 쿠키 보안 설정 (XSS 및 CSRF 방지 강화)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
# [추가] 배포 환경(HTTPS)에서 쿠키 보안 강화 (서버 .env에 APP_ENV=production 추가 필요)
if os.environ.get('APP_ENV') == 'production':
    app.config['SESSION_COOKIE_SECURE'] = True
# [보안] 세션 타임아웃 설정 (30분 후 자동 로그아웃)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=30)

# [보안] CSRF 보호 및 속도 제한 초기화
csrf = CSRFProtect(app)
limiter = Limiter(get_remote_address, app=app, default_limits=["200 per day", "50 per hour"])

# [수정] 데이터 관리를 위한 폴더 및 분리된 파일 경로 설정
DATA_DIR = os.path.join(BASE_DIR, 'data')
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

# [추가] 로그 디렉토리 및 파일 로깅 설정
LOG_DIR = os.path.join(BASE_DIR, 'logs')
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

# [추가] 백업 디렉토리 설정
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')
if not os.path.exists(BACKUP_DIR):
    os.makedirs(BACKUP_DIR)

# [추가] 로그에 요청 정보(IP, URL)를 주입하기 위한 필터
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

# [수정] 로그 파일을 매일 자정에 회전시키고, 30일이 지난 로그는 자동으로 삭제하도록 설정
file_handler = TimedRotatingFileHandler(os.path.join(LOG_DIR, 'server.log'), when='midnight', interval=1, backupCount=30, encoding='utf-8')
file_handler.addFilter(RequestInfoFilter())
file_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s [%(ip)s] %(method)s %(url)s: %(message)s [in %(pathname)s:%(lineno)d]'))
file_handler.setLevel(logging.WARNING)
app.logger.addHandler(file_handler)
app.logger.setLevel(logging.WARNING)
app.logger.warning('Server startup')

FILE_SETUP = os.path.join(DATA_DIR, 'setup_data.json')
FILE_MAINTENANCE = os.path.join(DATA_DIR, 'maintenance_data.json')
FILE_HOME = os.path.join(DATA_DIR, 'home_data.json')
FILE_SYSTEM_LOG = os.path.join(DATA_DIR, 'system_log.json')
FILE_WITHTECH_DATA = os.path.join(DATA_DIR, 'withtech_data.json')

# 헬퍼 함수: JSON 파일 읽기
def load_json_file(filepath):
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {}
    return {}

# [수정] JSON 파일 쓰기 (Atomic Write 적용 - 저장 중 오류 발생 시 데이터 깨짐 방지)
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

# [추가] 일일 백업 생성 함수 (최근 30일 보관)
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

# [추가] 데이터 파일 초기화 (없으면 빈 파일 생성)
def init_data_files():
    # home_data.json이 없으면 기본 계정 정보 생성
    if not os.path.exists(FILE_HOME):
        # [수정] 환경 변수에서 계정 정보 가져오기 (보안 강화)
        # 값이 없으면 기본값(admin/1234) 사용
        admin_id = os.environ.get('APP_ADMIN_ID') or 'admin'
        admin_pw = os.environ.get('APP_ADMIN_PW') or '1234'
        user_id = os.environ.get('APP_USER_ID') or 'user'
        user_pw = os.environ.get('APP_USER_PW') or '1234'

        user_accounts = []
        if admin_id and admin_pw:
            user_accounts.append({"id": admin_id, "pw": generate_password_hash(admin_pw), "role": "admin"})
        if user_id and user_pw:
            user_accounts.append({"id": user_id, "pw": generate_password_hash(user_pw), "role": "user"})

        default_home_data = {
            "user_accounts": user_accounts
        }
        save_json_file(FILE_HOME, default_home_data)

    for filepath in [FILE_SETUP, FILE_MAINTENANCE, FILE_SYSTEM_LOG, FILE_WITHTECH_DATA]:
        if not os.path.exists(filepath):
            save_json_file(filepath, {})

# 서버 시작 시 파일 초기화 실행
init_data_files()

# 데이터 불러오기 함수 (분리된 파일 통합 로드)
def load_data():
    with data_lock: # 동시 접근 방지
        data = {}
        
        # 1. data 폴더 내의 모든 .json 파일을 읽어서 병합
        if os.path.exists(DATA_DIR):
            for filename in os.listdir(DATA_DIR):
                if filename.endswith('.json'):
                    file_data = load_json_file(os.path.join(DATA_DIR, filename))
                    if file_data:
                        data.update(file_data)

        return data

# 데이터 저장 함수 (데이터 분류 후 개별 저장)
def save_data(full_data):
    with data_lock: # 동시 접근 방지 (읽기-수정-쓰기 원자성 보장)
        # [추가] 저장 전 기존 파일 백업 수행
        for filepath in [FILE_SETUP, FILE_MAINTENANCE, FILE_HOME, FILE_SYSTEM_LOG, FILE_WITHTECH_DATA]:
            create_daily_backup(filepath)

        # [수정] 계정 정보(user_accounts)는 클라이언트에서 보내지 않으므로 기존 데이터를 유지해야 함
        existing_home = load_json_file(FILE_HOME)
        existing_accounts = existing_home.get('user_accounts', [])

        # [수정] 기존 데이터를 불러오지 않고 초기화하여 클라이언트의 삭제 상태를 반영함
        setup_data = {}
        maintenance_data = {}
        home_data = {"user_accounts": existing_accounts} # 기존 계정 정보 유지
        system_log_data = {}
        withtech_data_storage = {}

        for key, value in full_data.items():
            if key == 'setup_data':
                setup_data[key] = value # 셋업 데이터만 저장
            elif key == 'system_logs':
                system_log_data[key] = value # 시스템 로그 저장
            elif key == 'withtech_data':
                withtech_data_storage[key] = value # 사이트/장비 목록 저장
            elif key.startswith('details_'):
                # [추가] maintenance 데이터에서 setup 관련 데이터 제거 (정리)
                if isinstance(value, dict):
                    value.pop('setupDetails', None)
                    value.pop('setupLogs', None)
                    value.pop('setupTasks', None)
                maintenance_data[key] = value # 유지보수 데이터만 저장
            else:
                # user_accounts는 위에서 이미 처리했으므로 덮어쓰지 않도록 주의 (클라이언트가 안 보냄)
                if key != 'user_accounts':
                    home_data[key] = value

        save_json_file(FILE_SETUP, setup_data)
        save_json_file(FILE_MAINTENANCE, maintenance_data)
        save_json_file(FILE_HOME, home_data)
        save_json_file(FILE_SYSTEM_LOG, system_log_data)
        save_json_file(FILE_WITHTECH_DATA, withtech_data_storage)

        # [추가] 별도 스레드에서 GitHub 동기화 실행 (응답 지연 방지)
        # 주의: 빈번한 저장 시 충돌 가능성이 있으므로 실제 운영 시에는 주기적 실행(cron 등)을 권장합니다.
        Thread(target=git_push_data).start()

# 데이터 저장 및 업데이트 함수
def update_data(data, filename):
    filepath = os.path.join(DATA_DIR, filename)
    save_json_file(filepath, data)

# [추가] GitHub 자동 동기화 함수
def git_push_data():
    """data 폴더의 변경사항을 GitHub에 커밋하고 푸시합니다."""
    try:
        # .git 폴더가 없으면 실행하지 않음
        if not os.path.exists(os.path.join(BASE_DIR, '.git')):
            return

        # 변경사항이 있는지 확인
        status = subprocess.run(["git", "status", "--porcelain", "data/"], capture_output=True, text=True)
        if not status.stdout.strip():
            return # 변경사항 없음

        # Git 명령 실행 (add -> commit -> push)
        subprocess.run(["git", "add", "data/*.json"], check=True)
        subprocess.run(["git", "commit", "-m", f"Auto-save: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"], check=True)
        subprocess.run(["git", "push"], check=True)
        app.logger.info("GitHub sync successful")
    except Exception as e:
        app.logger.error(f"GitHub sync failed: {e}")

# [보안] 로그인 필수 데코레이터
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"status": "fail", "message": "로그인이 필요합니다."}), 401
        return f(*args, **kwargs)
    return decorated_function

# 1. HTML 페이지 연결
@app.route('/') 
@app.route('/index.html') # [수정] index.html로 접속 시에도 홈으로 연결
def home():
    # HTML 페이지는 보여주되, 데이터 로드는 API에서 차단됨
    return render_template('index.html')

@app.route('/setup.html')
def setup():
    if 'user_id' not in session:
        return render_template('index.html') # 비로그인 시 홈으로 리다이렉트 효과
    return render_template('setup.html')

@app.route('/maintenance.html')
def maintenance():
    if 'user_id' not in session:
        return render_template('index.html')
    return render_template('maintenance.html')

# [보안] 모든 응답에 CSRF 토큰 쿠키 설정 (SPA 클라이언트용)
@app.after_request
def set_csrf_cookie(response):
    response.set_cookie('csrf_token', generate_csrf())
    # [추가] 접속 로그 기록 (정적 파일 및 파비콘 제외)
    if not request.path.startswith('/static') and not request.path.startswith('/favicon.ico'):
        # [수정] 에러(400 이상) 발생 시에만 로그 기록 (로그 용량 절약)
        if response.status_code >= 400:
            app.logger.warning(f"Response Status: {response.status}")
    
    # [보안] 보안 헤더 추가 (HSTS, X-Frame-Options 등)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    if os.environ.get('APP_ENV') == 'production':
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        
    return response

# 2. 데이터 통신 API (JavaScript와 통신)
@app.route('/api/data', methods=['GET', 'POST'])
@login_required # [보안] 로그인한 사용자만 접근 가능
def handle_data():
    if request.method == 'POST':
        # JS에서 보낸 데이터를 받아서 파일로 저장
        data = request.json
        save_data(data)
        return jsonify({"status": "success", "message": "저장되었습니다."})
    else:
        return jsonify(load_data())

# [추가] 로그인 API (서버에서 해시 검증)
@app.route('/api/login', methods=['POST'])
@limiter.limit("5 per minute") # [보안] 분당 5회 로그인 시도로 제한 (무차별 대입 방지)
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

        # 계정 잠금 확인
        now = datetime.now()
        lockout_until_str = user.get('lockout_until')
        if lockout_until_str:
            lockout_until = datetime.fromisoformat(lockout_until_str)
            if now < lockout_until:
                remaining_seconds = (lockout_until - now).total_seconds()
                remaining_minutes = int(remaining_seconds // 60) + 1
                return jsonify({"status": "fail", "message": f"비밀번호 5회 오류로 계정이 잠겼습니다.\n{remaining_minutes}분 후에 다시 시도해주세요."}), 403
            else:
                # 잠금 시간 만료 시 초기화
                user['failed_attempts'] = 0
                user['lockout_until'] = None

        if check_password_hash(user['pw'], user_pw):
            # 로그인 성공 시 실패 횟수 초기화
            if user.get('failed_attempts', 0) > 0 or user.get('lockout_until'):
                user['failed_attempts'] = 0
                user['lockout_until'] = None
                save_json_file(FILE_HOME, home_data)

            # [보안] 세션에 사용자 정보 저장
            session['user_id'] = user['id']
            session['role'] = user['role']
            return jsonify({"status": "success", "role": user['role']})
        else:
            # 로그인 실패 처리
            current_attempts = user.get('failed_attempts', 0) + 1
            user['failed_attempts'] = current_attempts
            
            message = "아이디 또는 비밀번호가 올바르지 않습니다."
            
            if current_attempts >= 5:
                # 5회 이상 실패 시 5분간 잠금
                lockout_time = now + timedelta(minutes=5)
                user['lockout_until'] = lockout_time.isoformat()
                message = f"비밀번호 5회 오류.\n계정이 5분간 잠깁니다."
            else:
                message = f"아이디 또는 비밀번호가 올바르지 않습니다.\n(실패 횟수: {current_attempts}/5)"
            
            save_json_file(FILE_HOME, home_data)
            return jsonify({"status": "fail", "message": message}), 401

# [추가] 로그아웃 API
@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"status": "success"})

# [추가] 사용자 추가 API
@app.route('/api/user/add', methods=['POST'])
@login_required # [보안] 로그인 필수
def add_user():
    data = request.json
    new_id = data.get('id')
    new_pw = data.get('pw')
    role = data.get('role', 'user')
    
    with data_lock:
        # [보안] 관리자 권한 체크 (선택 사항)
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

# [추가] 비밀번호 변경 API
@app.route('/api/user/password', methods=['POST'])
@login_required # [보안] 로그인 필수
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

if __name__ == '__main__':
    # [추가] 서버 실행 시 1초 뒤에 브라우저를 자동으로 엽니다.
    port = int(os.environ.get("APP_PORT", 5500))
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        Timer(1, lambda: webbrowser.open(f'http://127.0.0.1:{port}/')).start()
    # [보안] 배포 시 debug=False로 변경해야 함. 호스팅 환경에서는 보통 WSGI를 사용하므로 이 줄은 로컬 테스트용.
    app.run(debug=False, port=port, host='0.0.0.0')
