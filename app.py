from flask import Flask, render_template, request, jsonify, session, has_request_context, send_from_directory, redirect
import json
import os
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.engine import Engine
from sqlalchemy import event
from sqlalchemy import text
from flask_wtf.csrf import CSRFProtect, generate_csrf, CSRFError
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from datetime import datetime, timedelta, timezone
from werkzeug.middleware.proxy_fix import ProxyFix
import logging
from logging.handlers import TimedRotatingFileHandler
import secrets
import uuid

app = Flask(__name__)

# ------------------------------------------------------------------------------
# 1. 앱 설정 및 보안 (App Configuration & Security)
# ------------------------------------------------------------------------------
# 프록시 서버(Nginx 등) 뒤에서 실제 IP 처리를 위한 설정
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

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
            f.write("\n# Database Settings (sqlite or mysql)\n")
            f.write("DB_TYPE=sqlite\n")
            f.write("MYSQL_USER=your_gabia_id\nMYSQL_PASSWORD=your_gabia_pw\nMYSQL_HOST=your_gabia_ip\nMYSQL_DB=your_gabia_db_name\n")
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

# [호환성] Python 3.12 이상에서 datetime.utcnow()가 deprecated 됨에 따라 최신 표준 함수 적용
def get_utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)

# Security Extensions
csrf = CSRFProtect(app)
# [수정] 메모리 저장소 명시적 설정
# 잦은 자동 저장 및 API 호출 시 429 에러(Too Many Requests)가 발생하는 것을 막기 위해 전역 제한 해제(, default_limits=["200 per day", "50 per hour"]추가하면 보안 강화됨)
limiter = Limiter(get_remote_address, app=app, storage_uri="memory://")

# [변경] DB 설정 (환경변수에 따라 MySQL 또는 SQLite 사용)
 # [임시] 가비아 호스팅 전 로컬 환경을 위해 강제로 SQLite(로컬 파일 DB)를 사용하도록 고정합니다.
db_type = 'sqlite' # 나중에 가비아에 올릴 때 os.environ.get('DB_TYPE', 'sqlite').lower() 로 복구
if db_type == 'mysql':
    mysql_user = os.environ.get('MYSQL_USER', 'root')
    mysql_pw = os.environ.get('MYSQL_PASSWORD', '')
    mysql_host = os.environ.get('MYSQL_HOST', 'localhost')
    mysql_db = os.environ.get('MYSQL_DB', 'withtech')
    app.config['SQLALCHEMY_DATABASE_URI'] = f"mysql+pymysql://{mysql_user}:{mysql_pw}@{mysql_host}/{mysql_db}?charset=utf8mb4"
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(BASE_DIR, 'data', 'withtech.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# [추가] SQLite 외래키(Foreign Key) 및 Cascade(연쇄 삭제/수정) 기능 강제 활성화
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if type(dbapi_connection).__module__ == "sqlite3":
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

class User(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    pw = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default='user')
    site = db.Column(db.String(100), nullable=True) # [추가] 사업장 필드
    department = db.Column(db.String(100), nullable=True) # [추가] 소속
    position = db.Column(db.String(100), nullable=True) # [추가] 직급
    name = db.Column(db.String(100), nullable=True) # [추가] 이름
    pw_changed_at = db.Column(db.DateTime, default=get_utc_now) # [추가] 비밀번호 변경일 (1개월 만료용)
    failed_attempts = db.Column(db.Integer, default=0)
    lockout_until = db.Column(db.DateTime, nullable=True)

class SystemLog(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    timestamp = db.Column(db.DateTime, default=get_utc_now)
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
    site_name = db.Column(db.String(100), db.ForeignKey('site.name', ondelete='CASCADE', onupdate='CASCADE'))
    name = db.Column(db.String(100))
    serial = db.Column(db.String(100))
    special_note = db.Column(db.Text, default='')

class SetupInfo(db.Model):
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE', onupdate='CASCADE'), primary_key=True)
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

# [추가] 셋업(SETUP) 진행 세부사항(체크리스트) 모델
class SetupDetail(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE', onupdate='CASCADE'))
    category = db.Column(db.String(100), default='')
    content = db.Column(db.String(255), default='')
    start_date = db.Column(db.String(50), default='')
    date = db.Column(db.String(50), default='')
    est_days = db.Column(db.String(50), default='1')
    completed = db.Column(db.Boolean, default=False)
    exec_start_date = db.Column(db.String(50), default='')
    delay_reason = db.Column(db.Text, default='')

# [추가] 셋업(SETUP) 이력/일지 모델
class SetupLog(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE', onupdate='CASCADE'))
    date = db.Column(db.String(50), default='')
    worker = db.Column(db.String(100), default='')
    content = db.Column(db.String(255), default='')
    company = db.Column(db.String(100), default='위드텍')
    memo = db.Column(db.Text, default='')

class MaintItem(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50)) 
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE', onupdate='CASCADE'))
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
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE', onupdate='CASCADE'))
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

# [추가] 관리자 물품 관리 테이블 (AdminItem)
class AdminItem(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    detail_type = db.Column(db.String(100), default='')
    additional = db.Column(db.String(100), default='')
    partno = db.Column(db.String(100), default='')
    code = db.Column(db.String(100), default='')
    part = db.Column(db.String(100), default='')
    spec = db.Column(db.String(255), default='')
    equip = db.Column(db.Text, default='')

# [추가] 점검 구분 등 동적 설정 데이터 테이블 (SystemSetting)
class SystemSetting(db.Model):
    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text)

# ------------------------------------------------------------------------------
# 2. 경로 및 로깅 설정 (Paths & Logging Setup)
# ------------------------------------------------------------------------------
DATA_DIR = os.path.join(BASE_DIR, 'data')
LOG_DIR = os.path.join(BASE_DIR, 'logs')
DATA_LOG_DIR = os.path.join(DATA_DIR, 'log') # [추가] 데이터 로그 폴더
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')

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
# 3. 유틸리티 함수 (Utility Functions)
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

# ------------------------------------------------------------------------------
# 4. 핵심 로직: 데이터 로딩 (Core Logic: Data Loading)
# ------------------------------------------------------------------------------
def load_data():
    """
    [Phase 3: DB 100% 전환 완료]
    더 이상 JSON 파일을 읽지 않고, 오직 DB(SQLite/MySQL)에서 전체 데이터를 조회하여 
    프론트엔드가 요구하는 JSON 구조로 즉석에서 조립해 반환합니다.
    """
    data = {}
    
    # 1. 시스템 설정 (점검 구분, 장비 모델 등)
    settings = SystemSetting.query.all()
    for s in settings:
        try:
            data[s.key] = json.loads(s.value)
        except:
            data[s.key] = [] if s.key == 'equipment_models' else {}
            
    if 'equipment_models' not in data: data['equipment_models'] = []
    if 'check_type_categories' not in data: data['check_type_categories'] = {}
    if 'check_type_categories2' not in data: data['check_type_categories2'] = {}
    if 'check_type_items' not in data: data['check_type_items'] = {}

    # 2. 물품 관리 마스터 데이터
    admin_items = AdminItem.query.all()
    data['admin_items'] = [{
        'id': int(i.id) if str(i.id).isdigit() else i.id,
        'detailType': i.detail_type, 'additional': i.additional, 'partno': i.partno,
        'code': i.code, 'part': i.part, 'spec': i.spec, 'equip': i.equip
    } for i in admin_items]

    # 3. 사업장(Site) 및 장비 트리(device_data) 구성
    device_data = {}
    sites = Site.query.all()
    for site in sites:
        device_data[site.name] = []
        try: buildings = json.loads(site.buildings)
        except: buildings = []
        data[f"site_meta_{site.name}"] = {"buildings": buildings}

    data['device_data'] = device_data
    data['setup_data'] = {}

    # N+1 쿼리 성능 저하 방지를 위한 전체 데이터 사전 로드 (Dictionary 매핑)
    setup_infos = { s.equip_id: s for s in SetupInfo.query.all() }
    maint_items = {}; log_items = {}; setup_details = {}; setup_logs = {}
    
    for m in MaintItem.query.all(): maint_items.setdefault(m.equip_id, []).append(m)
    for l in LogItem.query.all(): log_items.setdefault(l.equip_id, []).append(l)
    for sd in SetupDetail.query.all(): setup_details.setdefault(sd.equip_id, []).append(sd)
    for sl in SetupLog.query.all(): setup_logs.setdefault(sl.equip_id, []).append(sl)

    # 4. 장비 상세 데이터 (details_ 및 setup_data) 매핑
    equips = Equipment.query.all()
    for eq in equips:
        site_prefix = f"{eq.site_name}::"
        eq_name_serial = eq.id[len(site_prefix):] if str(eq.id).startswith(site_prefix) else eq.id
        
        if eq.site_name not in device_data: device_data[eq.site_name] = []
        device_data[eq.site_name].append(eq_name_serial)

        detail_key = f"details_{eq.site_name}_{eq_name_serial}"
        data[detail_key] = { "specialNote": eq.special_note, "maint": [], "logs": [], "setup": {} }
        
        # 장비 셋업(마스터) 정보
        si = setup_infos.get(eq.id)
        if si:
            data[detail_key]["setup"] = {
                "custEquipName": si.cust_equip_name, "equipStatus": si.equip_status, "deliveryDate": si.delivery_date,
                "warrantyStart": si.warranty_start, "warrantyPeriod": si.warranty_period, "building": si.building,
                "floor": si.floor, "detailLoc": si.detail_loc, "manager": si.manager, "contact": si.contact,
                "email": si.email, "custManager": si.cust_manager, "custContact": si.cust_contact,
                "custEmail": si.cust_email, "model": si.model
            }

        # 유지관리(maint) 예정 목록
        for m in maint_items.get(eq.id, []):
            data[detail_key]["maint"].append({
                "id": int(m.id) if str(m.id).isdigit() else m.id, "type": m.type, "detailType": m.detail_type,
                "code": m.code, "content": m.content, "date": m.date, "scheduledDate": m.scheduled_date,
                "period": int(m.period) if m.period and str(m.period).isdigit() else m.period,
                "costType": m.cost_type, "worker": m.worker, "md": m.md, "itemCost": m.item_cost, "memo": m.memo
            })
            
        # 점검 이력(logs) 목록
        for l in log_items.get(eq.id, []):
            data[detail_key]["logs"].append({
                "id": int(l.id) if str(l.id).isdigit() else l.id, "date": l.date, "type": l.type,
                "detailType": l.detail_type, "detailType2": l.detail_type2, "content": l.content,
                "addWork": l.add_work, "costType": l.cost_type, "md": l.md, "worker": l.worker, "memo": l.memo,
                "isIssueShared": l.is_issue_shared,
                "originalLogId": int(l.original_log_id) if l.original_log_id and str(l.original_log_id).isdigit() else l.original_log_id,
                "addWorkLogId": int(l.add_work_log_id) if l.add_work_log_id and str(l.add_work_log_id).isdigit() else l.add_work_log_id
            })

        # 셋업 화면 상세/일지 (setup_data)
        sd_list = setup_details.get(eq.id, [])
        sl_list = setup_logs.get(eq.id, [])
        if sd_list or sl_list:
            data['setup_data'][eq.id] = {
                "setupDetails": [{
                    "id": int(sd.id) if str(sd.id).isdigit() else sd.id, "category": sd.category, "content": sd.content,
                    "startDate": sd.start_date, "date": sd.date, "estDays": sd.est_days, "completed": sd.completed,
                    "execStartDate": sd.exec_start_date, "delayReason": sd.delay_reason
                } for sd in sd_list],
                "setupLogs": [{
                    "id": int(sl.id) if str(sl.id).isdigit() else sl.id, "date": sl.date, "worker": sl.worker,
                    "content": sl.content, "company": sl.company, "memo": sl.memo
                } for sl in sl_list]
            }

    return data

# ------------------------------------------------------------------------------
# 5. 데코레이터 및 미들웨어 (Decorators & Middlewares)
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
# 6. 라우트: 화면 (Routes: Views)
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

@app.route('/sort.html')
def sort():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('sort.html')

# [추가] SettingDAO 폴더 정적 파일 서빙
@app.route('/SettingDAO/<path:filename>')
@limiter.exempt
def SettingDAO(filename):
    return send_from_directory(os.path.join(app.root_path, 'SettingDAO'), filename)

# [추가] 보안: 데이터베이스(.db), 로그, 환경변수 등 민감한 폴더에 대한 웹 브라우저 직접 경로 접근(다운로드) 원천 차단
@app.route('/data/<path:filename>')
@app.route('/logs/<path:filename>')
@app.route('/backups/<path:filename>')
def block_sensitive_data(filename):
    app.logger.warning(f"Unauthorized direct file access blocked: {request.path}")
    return jsonify({"status": "fail", "message": "비정상적인 접근이 감지되어 시스템에 의해 차단되었습니다."}), 403

# ------------------------------------------------------------------------------
# 7. 라우트: API (Routes: API)
# ------------------------------------------------------------------------------
@app.route('/api/data', methods=['GET', 'POST'])
@login_required
def handle_data():
    # [Phase 3] POST 요청은 더 이상 사용하지 않음 (개별 API로 대체)
    if request.method == 'GET':
        return jsonify(load_data())
    return jsonify({"status": "fail", "message": "지원하지 않는 요청입니다."}), 405

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

        # [추가] 비밀번호 만료 체크 (30일)
        require_pw_change = False
        if not user.pw_changed_at or user.pw_changed_at < get_utc_now() - timedelta(days=30):
            require_pw_change = True

        session['user_id'] = user.id
        session['role'] = user.role
        session['site'] = user.site # [추가]
        return jsonify({
            "status": "success", 
            "role": user.role, 
            "site": user.site,
            "department": user.department or "",
            "position": user.position or "",
            "name": user.name or "",
            "require_pw_change": require_pw_change
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

    new_user = User(id=new_id, pw=generate_password_hash(new_pw), role=role, site=site, department=department, position=position, name=name, pw_changed_at=get_utc_now())
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
    user.pw_changed_at = get_utc_now() # [추가] 비밀번호 변경일 갱신
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

# [추가] 통합 Admin 설정 관리를 위한 만능 DB CRUD API
@app.route('/api/admin/crud', methods=['POST'])
@login_required
def admin_crud():
    if session.get('role') not in ['admin', 'superadmin']:
        return jsonify({"status": "fail", "message": "권한이 없습니다."}), 403
    data = request.json
    domain = data.get('domain')
    action = data.get('action')
    payload = data.get('payload')
    
    try:
        if domain == 'site':
            if action == 'CREATE':
                db.session.add(Site(name=payload['name'], buildings='[]'))
            elif action == 'UPDATE':
                old_name = payload['old_name']
                new_name = payload['new_name']
                if old_name != new_name:
                    # DB 차원 이름 변경 (연쇄 업데이트 작동)
                    db.session.execute(text("UPDATE site SET name=:n WHERE name=:o"), {'n':new_name, 'o':old_name})
                    # 하위 장비 ID 강제 병합 업데이트
                    equips = Equipment.query.filter_by(site_name=new_name).all()
                    for eq in equips:
                        frontend_id = eq.id
                        if frontend_id.startswith(f"{old_name}::"):
                            frontend_id = frontend_id[len(f"{old_name}::"):]
                        elif frontend_id.startswith(f"{new_name}::"):
                            frontend_id = frontend_id[len(f"{new_name}::"):]
                        new_eq_id = f"{new_name}::{frontend_id}"
                        db.session.execute(text("UPDATE equipment SET id=:n WHERE id=:o"), {'n':new_eq_id, 'o':eq.id})
                site = Site.query.filter_by(name=new_name).first()
                if site: site.buildings = json.dumps(payload.get('buildings', []), ensure_ascii=False)
            elif action == 'DELETE':
                db.session.execute(text("DELETE FROM site WHERE name=:n"), {'n':payload['name']})
                
        elif domain == 'equip':
            new_id = payload.get('new_id')
            site_name = payload.get('site')
            
            if action == 'CREATE':
                db_id = f"{site_name}::{new_id}"
                e_name = new_id.split('::')[0]
                e_serial = new_id.split('::')[1] if '::' in new_id else ''
                db.session.add(Equipment(id=db_id, site_name=site_name, name=e_name, serial=e_serial, special_note=payload.get('special_note', '')))
                db.session.add(SetupInfo(
                    equip_id=db_id, cust_equip_name=payload['setup'].get('custEquipName', ''), equip_status=payload['setup'].get('equipStatus', ''),
                    delivery_date=payload['setup'].get('deliveryDate', ''), warranty_start=payload['setup'].get('warrantyStart', ''), warranty_period=str(payload['setup'].get('warrantyPeriod', '')),
                    building=payload['setup'].get('building', ''), floor=payload['setup'].get('floor', ''), detail_loc=payload['setup'].get('detailLoc', ''),
                    manager=payload['setup'].get('manager', ''), contact=payload['setup'].get('contact', ''), email=payload['setup'].get('email', ''),
                    cust_manager=payload['setup'].get('custManager', ''), cust_contact=payload['setup'].get('custContact', ''), cust_email=payload['setup'].get('custEmail', ''), model=payload['setup'].get('model', '')
                ))
            elif action == 'UPDATE':
                old_id = payload['old_id']
                db_old_id = f"{site_name}::{old_id}"
                db_new_id = f"{site_name}::{new_id}"
                
                if old_id != new_id:
                    db.session.execute(text("UPDATE equipment SET id=:n WHERE id=:o1 OR id=:o2"), {'n':db_new_id, 'o1':db_old_id, 'o2':old_id})
                else:
                    db.session.execute(text("UPDATE equipment SET id=:n WHERE id=:o"), {'n':db_new_id, 'o':old_id})
                    
                equip = Equipment.query.filter_by(id=db_new_id).first()
                if equip:
                    equip.special_note = payload.get('special_note', '')
                    setup = SetupInfo.query.filter_by(equip_id=db_new_id).first()
                    if not setup:
                        setup = SetupInfo(equip_id=db_new_id)
                        db.session.add(setup)
                    # 매핑
                    s_data = payload.get('setup', {})
                    setup.cust_equip_name = s_data.get('custEquipName', '')
                    setup.equip_status = s_data.get('equipStatus', '')
                    setup.delivery_date = s_data.get('deliveryDate', '')
                    setup.warranty_start = s_data.get('warrantyStart', '')
                    setup.warranty_period = str(s_data.get('warrantyPeriod', ''))
                    setup.building = s_data.get('building', '')
                    setup.floor = s_data.get('floor', '')
                    setup.detail_loc = s_data.get('detailLoc', '')
                    setup.manager = s_data.get('manager', '')
                    setup.contact = s_data.get('contact', '')
                    setup.email = s_data.get('email', '')
                    setup.cust_manager = s_data.get('custManager', '')
                    setup.cust_contact = s_data.get('custContact', '')
                    setup.cust_email = s_data.get('custEmail', '')
                    setup.model = s_data.get('model', '')
            elif action == 'DELETE':
                del_id = payload['id']
                del_site = payload.get('site', '')
                db_del_id = f"{del_site}::{del_id}"
                db.session.execute(text("DELETE FROM equipment WHERE id=:n1 OR id=:n2"), {'n1':db_del_id, 'n2':del_id})

        elif domain == 'item':
            if action == 'CREATE' or action == 'UPDATE':
                item = AdminItem.query.filter_by(id=str(payload['id'])).first()
                if not item: db.session.add(AdminItem(id=str(payload['id'])))
                db.session.execute(text("UPDATE admin_item SET detail_type=:dt, additional=:add, partno=:pn, code=:cd, part=:pt, spec=:sp, equip=:eq WHERE id=:i"), {'dt':payload.get('detailType',''), 'add':payload.get('additional',''), 'pn':payload.get('partno',''), 'cd':payload.get('code',''), 'pt':payload.get('part',''), 'sp':payload.get('spec',''), 'eq':payload.get('equip',''), 'i':str(payload['id'])})
            elif action == 'DELETE':
                db.session.execute(text("DELETE FROM admin_item WHERE id=:i"), {'i': str(payload['id'])})
                
        elif domain == 'setting':
            setting = SystemSetting.query.filter_by(key=payload['key']).first()
            val_json = json.dumps(payload['value'], ensure_ascii=False)
            if setting: setting.value = val_json
            else: db.session.add(SystemSetting(key=payload['key'], value=val_json))
                
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] 유지관리 및 캘린더 장비 이력 100% DB 동기화 전용 트랜잭션 API
@app.route('/api/history/transaction', methods=['POST'])
@login_required
def history_transaction():
    data = request.json
    equip_id = data.get('equip_id')
    maint_upserts = data.get('maint_upserts', [])
    maint_deletes = data.get('maint_deletes', [])
    log_upserts = data.get('log_upserts', [])
    log_deletes = data.get('log_deletes', [])

    try:
        if maint_deletes:
            MaintItem.query.filter(MaintItem.id.in_(maint_deletes)).delete(synchronize_session=False)
        
        for m in maint_upserts:
            m_id = str(m['id'])
            item = MaintItem.query.filter_by(id=m_id).first()
            if not item:
                item = MaintItem(id=m_id, equip_id=equip_id)
                db.session.add(item)
            item.type = m.get('type', item.type)
            item.detail_type = m.get('detailType', item.detail_type)
            item.code = m.get('code', item.code)
            item.content = m.get('content', item.content)
            item.date = m.get('date', item.date)
            item.period = str(m.get('period')) if m.get('period') is not None else item.period
            item.scheduled_date = m.get('scheduledDate', item.scheduled_date)
            item.cost_type = m.get('costType', item.cost_type)
            item.worker = m.get('worker', item.worker)
            item.md = str(m.get('md', item.md))
            item.item_cost = m.get('itemCost', item.item_cost)
            item.memo = m.get('memo', item.memo)

        if log_deletes:
            LogItem.query.filter(LogItem.id.in_(log_deletes)).delete(synchronize_session=False)

        for l in log_upserts:
            l_id = str(l['id'])
            item = LogItem.query.filter_by(id=l_id).first()
            if not item:
                item = LogItem(id=l_id, equip_id=equip_id)
                db.session.add(item)
            item.date = l.get('date', item.date)
            item.type = l.get('type', item.type)
            item.detail_type = l.get('detailType', item.detail_type)
            item.detail_type2 = l.get('detailType2', item.detail_type2)
            item.content = l.get('content', item.content)
            item.add_work = l.get('addWork', item.add_work)
            item.cost_type = l.get('costType', item.cost_type)
            item.md = str(l.get('md', item.md))
            item.worker = l.get('worker', item.worker)
            item.memo = l.get('memo', item.memo)
            item.is_issue_shared = bool(l.get('isIssueShared', item.is_issue_shared))
            item.original_log_id = str(l.get('originalLogId')) if l.get('originalLogId') else item.original_log_id
            item.add_work_log_id = str(l.get('addWorkLogId')) if l.get('addWorkLogId') else item.add_work_log_id

        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] 셋업 화면 데이터 전용 100% DB 동기화 API
@app.route('/api/setup/sync_equip', methods=['POST'])
@login_required
def sync_setup_equip():
    data = request.json
    equip_id = data.get('equip_id')
    details = data.get('details') # 리스트 형태 (없으면 None)
    logs = data.get('logs') # 리스트 형태 (없으면 None)

    try:
        if details is not None:
            db.session.query(SetupDetail).filter_by(equip_id=equip_id).delete(synchronize_session=False)
            for sd in details:
                db.session.add(SetupDetail(
                    id=str(sd.get('id', '')), equip_id=equip_id, category=sd.get('category', ''), content=sd.get('content', ''),
                    start_date=sd.get('startDate', ''), date=sd.get('date', ''), est_days=str(sd.get('estDays', '1')),
                    completed=bool(sd.get('completed', False)), exec_start_date=sd.get('execStartDate', ''), delay_reason=sd.get('delayReason', '')
                ))
        if logs is not None:
            db.session.query(SetupLog).filter_by(equip_id=equip_id).delete(synchronize_session=False)
            for sl in logs:
                db.session.add(SetupLog(
                    id=str(sl.get('id', '')), equip_id=equip_id, date=sl.get('date', ''), worker=sl.get('worker', ''),
                    content=sl.get('content', ''), company=sl.get('company', ''), memo=sl.get('memo', '')
                ))
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "fail", "message": str(e)}), 500

# ------------------------------------------------------------------------------
# 8. 앱 초기화 및 실행 (Initialization & Main Execution)
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
        
        # [마이그레이션] 비밀번호 변경일(보안) 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE "user" ADD COLUMN pw_changed_at DATETIME'))
            db.session.commit()
            db.session.execute(text('UPDATE "user" SET pw_changed_at = CURRENT_TIMESTAMP WHERE pw_changed_at IS NULL'))
            db.session.commit()
        except:
            db.session.rollback()
        
        # [DB 마이그레이션] 사용자 데이터
        # Admin 초기 계정 생성
        admin_id = os.environ.get('APP_ADMIN_ID', 'admin')
        admin_user = User.query.filter_by(id=admin_id).first()
        if not admin_user:
            admin_pw = os.environ.get('APP_ADMIN_PW', secrets.token_urlsafe(8))
            admin_user = User(id=admin_id, pw=generate_password_hash(admin_pw), role='superadmin', pw_changed_at=get_utc_now())
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
            normal_user = User(id=user_id, pw=generate_password_hash(user_pw), role='user', pw_changed_at=get_utc_now())
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

# WSGI 서버(PythonAnywhere 등) 환경에서도 앱 구동 시 초기화가 실행되도록 __main__ 블록 밖으로 이동
# [Phase 3] JSON 파일 관련 로직이 제거되었으므로, 폴더 생성만 수행
for d in [DATA_DIR, LOG_DIR, BACKUP_DIR, DATA_LOG_DIR]:
    if not os.path.exists(d):
        os.makedirs(d, mode=0o700)

init_db()

if __name__ == '__main__':
    port = int(os.environ.get("APP_PORT", 5500))

    # [수정] Waitress 서버 적용 (개발 서버 경고 제거 및 안정성 향상)
    try:
        from waitress import serve
        print(f" * Serving with Waitress on http://0.0.0.0:{port}")
        serve(app, host='0.0.0.0', port=port, threads=6)
    except ImportError:
        # Waitress가 설치되지 않은 경우 기존 Flask 개발 서버 사용
        print(" * Waitress not found. Running with basic Flask server.")
        import sys
        print(f" * To fix the warning, run: pip install waitress")
        app.run(debug=False, port=port, host='0.0.0.0')
