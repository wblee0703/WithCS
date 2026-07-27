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
import urllib.parse

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
            app_secret = secrets.token_hex(24)
            f.write(f"APP_ENV=production\nSECRET_KEY={app_secret}\n")
            f.write(f"APP_ADMIN_ID=admin\nAPP_ADMIN_PW={init_admin_pw}\nAPP_USER_ID=user\nAPP_USER_PW={init_user_pw}\nAPP_PORT=8080\n")
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
app.config['WTF_CSRF_TIME_LIMIT'] = None  # [추가] CSRF 토큰의 독자적인 타임아웃(기본 3600초)을 해제하여 세션 수명과 100% 동기화

if os.environ.get('APP_ENV') == 'production':
    app.config['TEMPLATES_AUTO_RELOAD'] = False  # [수정] 운영 환경에서는 파일 감지로 인한 불필요한 서버 재시작 방지
else:
    app.config['TEMPLATES_AUTO_RELOAD'] = True

# [추가] JSON 데이터 저장 및 응답 시 키(Key)가 알파벳순으로 자동 정렬되는 것을 방지
app.config['JSON_SORT_KEYS'] = False
if hasattr(app, 'json'): app.json.sort_keys = False

# HTTPS(SSL) 인증서가 없는 HTTP(IP 주소) 접속 시 로그인이 풀리는(CSRF) 에러 방지
# 나중에 가비아에 도메인과 HTTPS를 적용하시면 .env에 USE_HTTPS=true 를 추가하세요.
if os.environ.get('USE_HTTPS') == 'true':
    app.config['SESSION_COOKIE_SECURE'] = True
else:
    app.config['SESSION_COOKIE_SECURE'] = False
    app.config['WTF_CSRF_SSL_STRICT'] = False

# [호환성] Python 3.12 이상에서 datetime.utcnow()가 deprecated 됨에 따라 최신 표준 함수 적용
def get_utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)

def update_content_part(content_str, old_code, new_code, old_part, new_part):
    import re
    if not content_str:
        return content_str
        
    items = [s.strip() for s in content_str.split(',') if s.strip()]
    new_items = []
    
    for item in items:
        # 1. 비용 코드 분리 (예: [유상] Particle Filter)
        cost_prefix = ''
        cost_match = re.match(r'^(\[(?:유상|무상|기타)\]-?)\s*(.*)$', item)
        if cost_match:
            cost_prefix = cost_match.group(1)
            item = cost_match.group(2).strip()
            
        # 2. 접두사 분리 (파트 이상 교체 - 등)
        prefix = ''
        prefix_match = re.match(r'^((?:파트 이상|파츠 이상|물품 이상)\s*\(?(?:교체|수리)\)?\s*-\s*)(.*)$', item)
        if prefix_match:
            prefix = prefix_match.group(1)
            item = prefix_match.group(2).strip()
            
        # 만약 접두사 분리 후 한 번 더 비용 코드가 나올 수 있으므로 재분리
        if not cost_prefix:
            cost_match = re.match(r'^(\[(?:유상|무상|기타)\]-?)\s*(.*)$', item)
            if cost_match:
                cost_prefix = cost_match.group(1)
                item = cost_match.group(2).strip()
                
        # 3. 스펙 분리 (예: Particle Filter [100ml])
        spec_suffix = ''
        spec_match = re.search(r'\s*(\[[^\]]+\])$', item)
        if spec_match:
            spec_suffix = spec_match.group(1)
            item = item[:spec_match.start()].strip()
            
        # 4. 비교 및 치환
        if old_code and item == old_code:
            item = new_code
        elif old_part and item == old_part:
            item = new_part
            
        # 5. 재조립
        reconstructed = f"{prefix}{cost_prefix} {item}{spec_suffix}".strip()
        reconstructed = re.sub(r'\s+', ' ', reconstructed)
        reconstructed = reconstructed.replace("- [", "- [").replace("] ", "] ")
        new_items.append(reconstructed)
        
    return ', '.join(new_items)

# Security Extensions
csrf = CSRFProtect(app)
# [수정] 메모리 저장소 명시적 설정
# 잦은 API 호출로 인한 429 에러를 방지하면서도 기본적인 무차별 대입 공격을 막기 위해 넉넉한 기본 제한(Rate Limit) 설정 적용
limiter = Limiter(get_remote_address, app=app, storage_uri="memory://", default_limits=["3000 per day", "500 per hour"])

# [변경] DB 설정 (환경변수에 따라 MySQL 또는 SQLite 사용)
 # [임시] 가비아 호스팅 전 로컬 환경을 위해 강제로 SQLite(로컬 파일 DB)를 사용하도록 고정합니다.
db_type = os.environ.get('DB_TYPE', 'sqlite').lower()
if db_type == 'mysql':
    mysql_user = urllib.parse.quote_plus(os.environ.get('MYSQL_USER', 'root'))
    mysql_pw = urllib.parse.quote_plus(os.environ.get('MYSQL_PASSWORD', ''))
    mysql_host = os.environ.get('MYSQL_HOST', 'localhost')
    mysql_db = os.environ.get('MYSQL_DB', 'withtech')
    app.config['SQLALCHEMY_DATABASE_URI'] = f"mysql+pymysql://{mysql_user}:{mysql_pw}@{mysql_host}/{mysql_db}?charset=utf8mb4"
    
    # [추가] MySQL Connection Timeout(2013, 2006 에러) 방지 설정
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_recycle': 280,   # 280초마다 연결을 새로 고침 (가비아의 타이트한 설정 방어)
        'pool_pre_ping': True  # 쿼리 실행 전 연결이 살아있는지 확인 후, 죽었으면 재연결
    }
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
    worker = db.Column(db.String(100), nullable=True) # [추가] 작업자 컬럼

# ------------------------------------------------------------------------------
# [추가] 100% DB 전환을 위한 Core Business Models (스키마)
# ------------------------------------------------------------------------------
class Site(db.Model):
    name = db.Column(db.String(100), primary_key=True)
    group = db.Column(db.String(50), default='기타사업장') # [추가] 사업장 구분
    buildings = db.Column(db.Text, default='[]') # JSON string

class Equipment(db.Model):
    id = db.Column(db.String(200), primary_key=True) # Site::Name::Serial::CustEquipName
    site_name = db.Column(db.String(100), db.ForeignKey('site.name', ondelete='CASCADE', onupdate='CASCADE'))
    name = db.Column(db.String(100))
    serial = db.Column(db.String(100))
    cust_equip_name = db.Column(db.String(100), default='') # [추가] 고객사 장비명
    special_note = db.Column(db.Text, default='')

class SetupInfo(db.Model):
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE', onupdate='CASCADE'), primary_key=True)
    cust_equip_name = db.Column(db.String(100), default='')
    project_no = db.Column(db.String(100), default='')
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
    md = db.Column(db.String(50), default='0')
    parts = db.Column(db.Text, default='')

class MaintItem(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50)) 
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE', onupdate='CASCADE'))
    type = db.Column(db.String(50), default='')
    detail_type = db.Column(db.String(100), default='')
    code = db.Column(db.String(100), default='')
    content = db.Column(db.String(255), default='')
    spec = db.Column(db.String(255), default='')
    date = db.Column(db.String(50), default='')
    period = db.Column(db.String(50), nullable=True)
    scheduled_date = db.Column(db.String(50), default='')
    cost_type = db.Column(db.String(50), default='')
    worker = db.Column(db.String(100), default='')
    md = db.Column(db.String(50), default='')
    item_cost = db.Column(db.String(50), default='')
    memo = db.Column(db.Text, default='')
    trouble_details = db.Column(db.Text, nullable=True) # [추가] 트러블 진행 경과 (JSON)
    trouble_occur_date = db.Column(db.String(50), default='') # [추가] 트러블 발생 일시
    original_log_id = db.Column(db.String(50), nullable=True) # [추가] 추가 작업(미완료)과 원본(부모) 로그를 연결하는 외래 식별자
    image_data = db.Column(db.Text(length=2000000), nullable=True) # [추가]
    sort_order = db.Column(db.Integer, default=0) # [추가] 물품 순서 영구 보존용 정렬 순서

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
    start_time = db.Column(db.String(50), default='')
    end_time = db.Column(db.String(50), default='')
    trouble_details = db.Column(db.Text, nullable=True) # [추가] 트러블 진행 경과 (JSON)
    trouble_occur_date = db.Column(db.String(50), default='') # [추가] 트러블 발생 일시
    is_issue_shared = db.Column(db.Boolean, default=False)
    original_log_id = db.Column(db.String(50), nullable=True)
    add_work_log_id = db.Column(db.String(50), nullable=True)
    image_data = db.Column(db.Text(length=2000000), nullable=True) # [추가]

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

# [추가] Trouble 이력 관리 모델
class TroubleLog(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200), db.ForeignKey('equipment.id', ondelete='CASCADE', onupdate='CASCADE'))
    occur_date = db.Column(db.String(50), default='')
    action_date = db.Column(db.String(50), default='') # [추가] 조치 일 (작업일)
    content = db.Column(db.Text, default='')
    memo = db.Column(db.Text, default='') # [추가] 진행 경과 저장용 컬럼
    worker = db.Column(db.String(100), default='')
    status = db.Column(db.String(50), default='조치중')
    image_data = db.Column(db.Text(length=2000000), nullable=True) # [추가] 사진 Base64 저장 컬럼

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

# [추가] Flask-WTF 모듈 자체에서 뱉어내는 불필요한 CSRF INFO 로그 숨김 (로그 도배 방지)
logging.getLogger('flask_wtf.csrf').setLevel(logging.WARNING)

app.logger.addHandler(file_handler)
app.logger.setLevel(logging.INFO) # [수정] INFO 레벨 로그도 기록하도록 변경
# app.logger.warning('Server startup') # 불필요한 시작 로그 제거

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
    if 'setup_templates' not in data: data['setup_templates'] = {}

    # [추가] DB에 등록된 모든 장비의 모델명을 equipment_models 목록에 자동 통합 보정 (dict/str 호환)
    raw_models = data.get('equipment_models', [])
    model_strings = []
    if isinstance(raw_models, list):
        for item in raw_models:
            if isinstance(item, str) and item.strip():
                model_strings.append(item.strip())
            elif isinstance(item, dict):
                m_val = item.get('name') or item.get('model') or item.get('code')
                if m_val and isinstance(m_val, str) and m_val.strip():
                    model_strings.append(m_val.strip())

    existing_models = set(model_strings)
    for eq in Equipment.query.all():
        if eq.name and eq.name.strip() and eq.name.strip() != "기타(ETC)":
            existing_models.add(eq.name.strip())
    for si in SetupInfo.query.all():
        if si.model and si.model.strip() and si.model.strip() != "기타(ETC)":
            existing_models.add(si.model.strip())
    
    if raw_models and isinstance(raw_models, list) and len(raw_models) > 0 and isinstance(raw_models[0], dict):
        data['equipment_models'] = raw_models
    else:
        data['equipment_models'] = sorted(list(existing_models))

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
        data[f"site_meta_{site.name}"] = {"buildings": buildings, "group": site.group or '기타사업장'}

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
        si = setup_infos.get(eq.id)
        cust_equip_name = si.cust_equip_name if si else ""

        site_prefix = f"{eq.site_name}::"
        eq_name_serial = eq.id[len(site_prefix):] if str(eq.id).startswith(site_prefix) else eq.id
        parts = eq_name_serial.split('::')
        e_name = eq.name if eq.name else (parts[0] if len(parts) > 0 else "")
        e_serial = eq.serial if eq.serial is not None else (parts[1] if len(parts) > 1 else "")

        if e_name == "기타(ETC)":
            eq_key = "기타(ETC)::::"
        else:
            eq_key = f"{e_name}::{e_serial}::{cust_equip_name}"

        if eq.site_name not in device_data: device_data[eq.site_name] = []
        if eq_key not in device_data[eq.site_name]:
            device_data[eq.site_name].append(eq_key)

        detail_key = f"details_{eq.site_name}_{eq_key}"
        data[detail_key] = { "specialNote": eq.special_note, "maint": [], "logs": [], "setup": {} }
        
        # 장비 셋업(마스터) 정보
        si = setup_infos.get(eq.id)
        if si:
            data[detail_key]["setup"] = {
                "custEquipName": si.cust_equip_name, "equipStatus": si.equip_status, "deliveryDate": si.delivery_date,
                "projectNo": si.project_no,
                "warrantyStart": si.warranty_start, "warrantyPeriod": si.warranty_period, "building": si.building,
                "floor": si.floor, "detailLoc": si.detail_loc, "manager": si.manager, "contact": si.contact,
                "email": si.email, "custManager": si.cust_manager, "custContact": si.cust_contact,
                "custEmail": si.cust_email, "model": si.model
            }

        # 유지관리(maint) 예정 목록
        eq_maint_list = maint_items.get(eq.id, [])
        eq_maint_list.sort(key=lambda x: (x.sort_order if hasattr(x, 'sort_order') and x.sort_order is not None else 0, x._unique_id))
        for m in eq_maint_list:
            data[detail_key]["maint"].append({
                "id": int(m.id) if str(m.id).isdigit() else m.id, "type": m.type, "detailType": m.detail_type,
                "code": m.code, "content": m.content, "spec": m.spec, "date": m.date, "scheduledDate": m.scheduled_date,
                "period": int(m.period) if m.period and str(m.period).isdigit() else m.period,
                "costType": m.cost_type, "worker": m.worker, "md": m.md, "itemCost": m.item_cost, "memo": m.memo,
                "sortOrder": getattr(m, 'sort_order', 0),
                "originalLogId": int(m.original_log_id) if m.original_log_id and str(m.original_log_id).isdigit() else m.original_log_id
            })
            
        # 점검 이력(logs) 목록
        for l in log_items.get(eq.id, []):
            data[detail_key]["logs"].append({
                "id": int(l.id) if str(l.id).isdigit() else l.id, "date": l.date, "type": l.type,
                "detailType": l.detail_type, "detailType2": l.detail_type2, "content": l.content, "startTime": l.start_time,
                "endTime": l.end_time,
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
                    "content": sl.content, "company": sl.company, "memo": sl.memo,
                    "md": sl.md, "parts": sl.parts
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
    # app.logger.info(f"CSRF Expected Error (Session Expired): {e.description} (Path: {request.path})") # 자연스러운 현상이므로 로그 기록 생략
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

# [추가] 해킹 IP 차단 관리 (메모리 캐시)
IP_ABUSE_COUNTER = {} # { "ip": { "count": int, "last_attempt": datetime } }
IP_BLACKLIST = {}     # { "ip": ban_until_datetime }

@app.before_request
def check_ip_blacklist():
    """모든 요청 진입 전에 블랙리스트에 의한 강제 IP 차단을 검사합니다."""
    ip = get_remote_address()
    if ip in IP_BLACKLIST:
        ban_until = IP_BLACKLIST[ip]
        if datetime.now(timezone.utc) < ban_until:
            app.logger.warning(f"Blocked request from blacklisted IP: {ip} (Path: {request.path})")
            return jsonify({"status": "fail", "message": "보안 정책 위반으로 인해 해당 IP로부터의 접속이 일시적으로 차단되었습니다."}), 403
        else:
            # 차단 만료 시간 경과 시 자동 제거
            IP_BLACKLIST.pop(ip, None)
            IP_ABUSE_COUNTER.pop(ip, None)

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
    is_secure = os.environ.get('USE_HTTPS') == 'true'
    response.set_cookie('csrf_token', generate_csrf(), secure=is_secure, httponly=False, samesite='Lax')
    
    # 에러 로그 기록 (정적 파일 경로 제외)
    if not request.path.startswith(('/static', '/SettingDAO', '/favicon.ico', '/.well-known')):
        # [수정] 401 Unauthorized는 정상적인 인증 루틴일 수 있으므로 경고 로그에서 제외 (로그인 실패 등)
        # [개선] 400 에러는 위의 에러 핸들러와 일반 비즈니스 로직(중복 아이디 등)에서 처리/기록하므로 포괄 로그에서 제외 (중복 방지)
        if response.status_code > 400 and response.status_code != 401:
            app.logger.warning(f"Response Status: {response.status} (Path: {request.path})")
    
    # 보안 헤더
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
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

@app.route('/setup')
@app.route('/setup.html')
def setup():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('setup.html')

@app.route('/maintenance')
@app.route('/maintenance.html')
def maintenance():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('maintenance.html')

@app.route('/trouble')
@app.route('/trouble.html')
def trouble():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('trouble.html')

@app.route('/admin')
@app.route('/admin.html')
def admin():
    if 'user_id' not in session:
        return redirect('/')
    if session.get('role') not in ['admin', 'superadmin']:
        return redirect('/')
    return render_template('admin.html')

@app.route('/sort')
@app.route('/sort.html')
def sort():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('sort.html')

@app.route('/operation')
@app.route('/operation.html')
def operation():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('operation.html')

# [추가] SettingDAO 폴더 정적 파일 서빙
@app.route('/SettingDAO/<path:filename>')
@limiter.exempt
def SettingDAO(filename):
    return send_from_directory(os.path.join(app.root_path, 'SettingDAO'), filename)

# [추가] favicon.ico 404 에러 방지 (파일이 없을 경우 조용히 빈 응답 반환)
@app.route('/favicon.ico')
@limiter.exempt
def favicon():
    return '', 204

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
@csrf.exempt
def login():
    data = request.json
    user_id = data.get('id', '').strip()  # [수정] 모바일/복붙 시 발생하는 보이지 않는 끝 공백 제거
    user_pw = data.get('pw', '').strip()

    user = User.query.filter_by(id=user_id).first()

    if not user or user.id != os.getenv('APP_ADMIN_ID', 'admin'):
        return jsonify({"status": "fail", "message": "로그인시 로그인안되게 해주고 서버 점검중으로 현재 접속 불가능 입니다. 죄송합니다."}), 403

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
    try:
        is_valid = check_password_hash(user.pw, user_pw)
    except AttributeError:
        fallback_pw = os.environ.get('APP_ADMIN_PW', 'admin') if user.id in ['admin', os.environ.get('APP_ADMIN_ID', 'admin')] else (os.environ.get('APP_USER_PW', 'user') if user.id in ['user', os.environ.get('APP_USER_ID', 'user')] else 'withtech123!')
        user.pw = generate_password_hash(fallback_pw, method='pbkdf2:sha256:50000')
        db.session.commit()
        return jsonify({"status": "fail", "message": "보안 시스템 업데이트로 비밀번호가 안전하게 초기화되었습니다.\n최초 발급받은 초기 비밀번호로 다시 로그인해주세요."}), 401

    if is_valid:
        # 성공: 실패 횟수 초기화 및 세션 설정
        if user.failed_attempts > 0 or user.lockout_until:
            user.failed_attempts = 0
            user.lockout_until = None
            db.session.commit()

        # [추가] 비밀번호 만료 체크 (30일)
        require_pw_change = False
        if not user.pw_changed_at or user.pw_changed_at < get_utc_now() - timedelta(days=30):
            require_pw_change = True

        session.permanent = True  # [추가] 브라우저에 PERMANENT_SESSION_LIFETIME(60분)을 명시적으로 적용
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
@csrf.exempt
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

# ------------------------------------------------------------------------------
# [추가] AI 챗봇 및 DB 데이터 외부 유출 방지 (AI Chatbot & Security Filter)
# ------------------------------------------------------------------------------
import re
import urllib.request
import urllib.error

class AIChatSecurityManager:
    def __init__(self):
        self.email_pattern = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+')
        self.phone_pattern = re.compile(r'\b\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4}\b')
        self.ip_pattern = re.compile(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b')
        # 영대문자 및 숫자가 섞인 시리얼 번호 매칭 예: WT-12345, ABC12345
        self.serial_pattern = re.compile(r'\b[A-Z0-9]{2,}-[A-Z0-9]{4,}\b|\b[A-Z]+[0-9]{4,}\b')

    def mask_data(self, text, mapping, site_list=None):
        if not text:
            return text

        # 1. 사이트 명칭 마스킹 (등록된 사업장 리스트 기준)
        if site_list:
            for site in sorted(site_list, key=len, reverse=True):
                if site in text:
                    token = self._get_or_create_token(mapping, site, "SITE")
                    text = text.replace(site, token)

        # 2. 이메일 마스킹
        emails = self.email_pattern.findall(text)
        for email in set(emails):
            token = self._get_or_create_token(mapping, email, "EMAIL")
            text = text.replace(email, token)

        # 3. 전화번호 마스킹
        phones = self.phone_pattern.findall(text)
        for phone in set(phones):
            token = self._get_or_create_token(mapping, phone, "PHONE")
            text = text.replace(phone, token)

        # 4. IP 주소 마스킹
        ips = self.ip_pattern.findall(text)
        for ip in set(ips):
            token = self._get_or_create_token(mapping, ip, "IP")
            text = text.replace(ip, token)

        # 5. 장비 시리얼 마스킹
        serials = self.serial_pattern.findall(text)
        for serial in set(serials):
            if len(serial) >= 5:
                token = self._get_or_create_token(mapping, serial, "SERIAL")
                text = text.replace(serial, token)

        return text

    def _get_or_create_token(self, mapping, value, token_type):
        for k, v in mapping.items():
            if v == value:
                return k
        token = f"[MASK_{token_type}_{len(mapping) + 1}]"
        mapping[token] = value
        return token

    def demask_data(self, text, mapping):
        if not text:
            return text
        for token in sorted(mapping.keys(), key=len, reverse=True):
            text = text.replace(token, mapping[token])
        return text

security_manager = AIChatSecurityManager()

def parse_trouble_content(content_str):
    """
    TroubleLog.content의 JSON 데이터를 친근한 자연어로 파싱 및 복원합니다.
    """
    if not content_str:
        return ""
    content_str = content_str.strip()
    if content_str.startswith('{') and content_str.endswith('}'):
        try:
            parsed = json.loads(content_str)
            parts = []
            if parsed.get('situation'): parts.append(f"[상황/현상] {parsed['situation']}")
            if parsed.get('symptom'): parts.append(f"[증상] {parsed['symptom']}")
            if parsed.get('cause'): parts.append(f"[원인] {parsed['cause']}")
            if parsed.get('action'): parts.append(f"[조치사항] {parsed['action']}")
            if parsed.get('prevention'): parts.append(f"[재발방지대책] {parsed['prevention']}")
            if parsed.get('trouble_memo'): parts.append(f"[추가메모] {parsed['trouble_memo']}")
            if parts:
                return " | ".join(parts)
        except Exception:
            pass
    return content_str

def build_rag_context(user, user_message):
    """
    유저의 세션 권한 및 메시지 키워드를 정밀 분석하여
    의도(Intent)와 엔티티(Entity)를 파악한 뒤, 관련 DB 데이터를 타겟팅 쿼리하여 반환합니다.
    """
    user_site = user.site
    # 보안 보완: 빈 공백 및 문자열 "None", "null" 방어 처리
    if not user_site or not str(user_site).strip() or str(user_site).lower() in ['none', 'null']:
        user_site = None
        
    # [개선] superadmin 및 admin 권한의 관리자 계정은 사업장 제한 필터를 해제하여 전체 데이터를 RAG 조회할 수 있도록 허용
    if user.role in ['superadmin', 'admin']:
        user_site = None

    context_lines = []
    
    if user_site:
        context_lines.append(f"접속자 소속 사업장: {user_site}")
    
    # 보안 보완: RAG 검색 키워드에서 특수문자 및 유해 문자 소거 (SQL 인젝션 및 비정상 구문 방지)
    sanitized_message = re.sub(r'[^a-zA-Z0-9가-힣\s\-_]', '', user_message)
    msg_lower = sanitized_message.lower()
    raw_msg_lower = user_message.lower()
    msg_no_space = re.sub(r'[^a-zA-Z0-9가-힣]', '', user_message).lower()

    # [디버그 로그] RAG 매칭 진입 정보 기록 (디버깅용)
    app.logger.info(f"[AI Chat RAG Debug] User ID: '{user.id}', Site Filter: '{user_site}', Cleaned Msg: '{msg_lower}'")

    # 1. 엔티티 추출
    
    # (1) 사업장(Site) 매칭
    matched_site = None
    all_sites = Site.query.all()
    for site in sorted(all_sites, key=lambda s: len(s.name), reverse=True):
        site_clean = re.sub(r'[^a-zA-Z0-9가-힣]', '', site.name).lower()
        if (site.name.lower() in raw_msg_lower) or (site_clean in msg_no_space):
            # 로그인한 유저가 특정 사업장에 묶여있는데 다른 사업장을 물어본 경우 보안 필터링
            if user_site and user_site != site.name:
                continue
            matched_site = site.name
            break
            
    # 만약 명시적 사업장 매칭이 없어도 유저가 특정 사업장 소속이면 해당 사업장으로 고정
    if not matched_site and user_site:
        matched_site = user_site

    # (2) 작업자(Worker) 매칭
    matched_worker = None
    all_users = User.query.all()
    for u in all_users:
        names_to_check = []
        if u.name:
            names_to_check.append(u.name)
        if u.id and u.id not in ['admin', 'user', 'superadmin']:
            names_to_check.append(u.id)
            
        for n in sorted(names_to_check, key=len, reverse=True):
            n_clean = re.sub(r'[^a-zA-Z0-9가-힣]', '', n).lower()
            if len(n_clean) >= 2:
                if (n.lower() in raw_msg_lower) or (n_clean in msg_no_space):
                    matched_worker = u.name if u.name else u.id
                    break
        if matched_worker:
            break

    # (3) 장비(Equipment) 매칭 (시리얼, 장비명, 고객사 장비명)
    # [개선] 가상 장비인 "기타(ETC)" 장비는 챗봇 매칭 및 통계에서 제외합니다.
    # [개선] 특정 장비 조회 시 사용자 소속 사업장 필터에 막혀 매칭이 누락되는 현상을 방지하기 위해 전체 장비 목록에서 매칭을 수행합니다.
    all_equips = Equipment.query.filter(Equipment.name != "기타(ETC)").all()

    # N+1 쿼리 최적화를 위해 SetupInfo 사전 일괄 로드
    setup_infos_map = { si.equip_id: si for si in SetupInfo.query.all() }

    matched_equips = []
    for eq in all_equips:
        serial_strip = eq.serial.strip() if eq.serial else ""
        name_strip = eq.name.strip() if eq.name else ""
        
        # 고객사 장비명 파싱
        si_info = setup_infos_map.get(eq.id)
        cust_name_strip = si_info.cust_equip_name.strip() if si_info and si_info.cust_equip_name else ""
        
        serial_clean = re.sub(r'[^a-zA-Z0-9]', '', serial_strip).lower()
        name_clean = re.sub(r'[^a-zA-Z0-9가-힣]', '', name_strip).lower()
        cust_name_clean = re.sub(r'[^a-zA-Z0-9가-힣]', '', cust_name_strip).lower()
        
        serial_match = False
        if len(serial_clean) >= 2:
            serial_match = (serial_strip.lower() in raw_msg_lower) or (serial_clean in msg_no_space)
            
        name_match = False
        if len(name_clean) >= 2 and name_clean not in ['기타', 'etc']:
            name_match = (name_strip.lower() in raw_msg_lower) or (name_clean in msg_no_space)

        cust_name_match = False
        if len(cust_name_clean) >= 2:
            cust_name_match = (cust_name_strip.lower() in raw_msg_lower) or (cust_name_clean in msg_no_space)

        if serial_match or name_match or cust_name_match:
            matched_equips.append(eq)

    # [개선] 만약 장비가 매칭되었다면, 해당 장비가 소속된 사업장명을 기준으로 matched_site를 갱신해 줍니다.
    # 이를 통해 유저의 기본 소속 사업장 필터링에 가로막혀 쿼리 컨텍스트가 오인되는 문제를 이중으로 정정합니다.
    if matched_equips:
        matched_site = matched_equips[0].site_name

    # (4) 장비 모델명(Model) 매칭
    matched_model = None
    system_models = []
    model_setting = SystemSetting.query.filter_by(key='equipment_models').first()
    if model_setting:
        try:
            models_data = json.loads(model_setting.value)
            for m in models_data:
                if isinstance(m, dict):
                    if m.get('name'):
                        system_models.append(m['name'])
                    if m.get('abbr'):
                        system_models.append(m['abbr'])
                elif isinstance(m, str):
                    system_models.append(m)
        except Exception as e:
            app.logger.error(f"Error parsing equipment_models setting: {str(e)}")
    
    db_models = [eq_info.model for eq_info in SetupInfo.query.with_entities(SetupInfo.model).distinct() if eq_info.model]
    all_models = list(set(system_models + db_models))
    
    for m in sorted(all_models, key=len, reverse=True):
        m_clean = re.sub(r'[^a-zA-Z0-9가-힣]', '', m).lower()
        if len(m_clean) >= 2:
            if (m.lower() in raw_msg_lower) or (m_clean in msg_no_space):
                matched_model = m
                break

    # (5) 정렬 및 개수(Limit) 조건 파싱
    limit_num = 3  # 기본값 하향 조정 (토큰 절감)
    limit_match = re.search(r'(?:최근|최신|마지막)\s*(\d+)\s*(?:개|건|명|대|가지|번)', user_message)
    if limit_match:
        limit_num = min(int(limit_match.group(1)), 15)  # 상한선 15개로 조절 (기존 30)
    elif "최근" in user_message or "최신" in user_message or "마지막" in user_message:
        limit_num = 3  # 최근 검색 기본 건수 하향 (기존 5)

    is_recent_requested = any(k in user_message for k in ["최근", "최신", "마지막", "과거", "이력", "최근에"])

    # (6) 날짜 및 기간 필터 추출
    target_period = None
    period_label = ""
    month_match = re.search(r'(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월', user_message)
    if month_match:
        year_part = month_match.group(1) if month_match.group(1) else str(datetime.now().year)
        month_part = f"{int(month_match.group(2)):02d}"
        target_period = f"{year_part}-{month_part}"
        period_label = f"{year_part}년 {month_part}월"
    elif "오늘" in user_message:
        target_period = datetime.now().strftime("%Y-%m-%d")
        period_label = "오늘"
    elif "어제" in user_message:
        target_period = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        period_label = "어제"

    is_work_completion_query = any(k in msg_no_space for k in ["작업완료", "점검완료", "완료건수", "완료한", "완료된", "조치완료", "해결된", "수리완료", "조치건수", "해결건수"])

    # 2. 질문 의도(Intent) 분석
    intent_count = any(k in msg_no_space for k in ["몇대", "몇개", "수량", "개수", "얼마나", "건수", "몇건", "몇명", "총수", "합계", "통계"])
    intent_trouble = any(k in msg_no_space for k in ["트러블", "장애", "에러", "고장", "문제", "조치", "수리", "해결", "오류", "이상", "경과", "안됨", "불량", "알람"])
    intent_schedule = any(k in msg_no_space for k in ["점검", "일정", "계획", "언제", "예정", "유지보수", "스케줄", "날짜", "달력", "작업"])
    intent_setup = any(k in msg_no_space for k in ["셋업", "설치", "setup", "진행", "진척"])
    intent_detail = any(k in msg_no_space for k in ["상세", "정보", "디테일", "연락처", "담당자", "위치", "스펙", "전화번호", "이메일", "어디", "누구"])

    app.logger.info(f"[AI Chat RAG] 의도 분석 결과 -> Site: {matched_site}, Worker: {matched_worker}, Model: {matched_model}, Equips: {[e.id for e in matched_equips]}")
    app.logger.info(f"[AI Chat RAG] 의도 분류 -> COUNT:{intent_count}, TROUBLE:{intent_trouble}, SCHEDULE:{intent_schedule}, SETUP:{intent_setup}, DETAIL:{intent_detail}")

    # 3. 데이터베이스 쿼리 및 컨텍스트 작성
    
    # 3-1. 메타 요약 정보 (기본 통계 제공)
    maint_count_query = MaintItem.query
    trouble_count_query = TroubleLog.query
    log_count_query = LogItem.query
    
    if matched_site:
        maint_count_query = maint_count_query.filter(MaintItem.equip_id.like(f"{matched_site}::%"))
        trouble_count_query = trouble_count_query.filter(TroubleLog.equip_id.like(f"{matched_site}::%"))
        log_count_query = log_count_query.filter(LogItem.equip_id.like(f"{matched_site}::%"))
        
    total_maint = maint_count_query.count()
    total_trouble = trouble_count_query.count()
    active_trouble = trouble_count_query.filter_by(status='조치중').count()
    total_shared_log = log_count_query.filter_by(is_issue_shared=True).count()

    context_lines.append("[사내 데이터 요약 통계]")
    if target_period:
        context_lines.append(f"- 분석 조회 기준 기간: {period_label}")
    if matched_site:
        context_lines.append(f"- 소속/권한 범위: {matched_site}")
        context_lines.append(f"- [{matched_site}] 등록 장비 총 수량: {len(all_equips)}대")
        if target_period:
            period_maint = MaintItem.query.filter(MaintItem.equip_id.like(f"{matched_site}::%"), MaintItem.scheduled_date.like(f"{target_period}%")).count()
            period_trouble = TroubleLog.query.filter(TroubleLog.equip_id.like(f"{matched_site}::%"), TroubleLog.occur_date.like(f"{target_period}%")).count()
            context_lines.append(f"- [{matched_site}] {period_label} 점검 예정 일정 건수: {period_maint}건")
            context_lines.append(f"- [{matched_site}] {period_label} 장애 발생 건수: {period_trouble}건")
        else:
            context_lines.append(f"- [{matched_site}] 누적 장비 점검/유지관리 일정 건수: {total_maint}건")
            context_lines.append(f"- [{matched_site}] 누적 장애(Trouble) 로그 건수: {total_trouble}건 (현재 조치 중: {active_trouble}건)")
    else:
        context_lines.append(f"- 소속/권한 범위: 전체 사업장")
        context_lines.append(f"- 전체 등록 장비 총 수량: {len(all_equips)}대")
        if target_period:
            period_maint = MaintItem.query.filter(MaintItem.scheduled_date.like(f"{target_period}%")).count()
            period_trouble = TroubleLog.query.filter(TroubleLog.occur_date.like(f"{target_period}%")).count()
            context_lines.append(f"- 전체 {period_label} 점검 예정 일정 건수: {period_maint}건")
            context_lines.append(f"- 전체 {period_label} 장애 발생 건수: {period_trouble}건")
        else:
            context_lines.append(f"- 전체 누적 장비 점검/유지관리 일정 건수: {total_maint}건")
            context_lines.append(f"- 전체 누적 장애(Trouble) 로그 건수: {total_trouble}건 (현재 조치 중: {active_trouble}건)")

    # 3-2. 수량(COUNT) 관련 명확한 데이터 분석 제공
    if intent_count:
        context_lines.append("\n[수량 및 건수 집계 데이터]")
        if not matched_site:
            site_counts = {}
            for eq in all_equips:
                site_counts[eq.site_name] = site_counts.get(eq.site_name, 0) + 1
            for s_name, count in site_counts.items():
                context_lines.append(f"- 사업장 [{s_name}] 장비 수량: {count}대")
        else:
            context_lines.append(f"- 사업장 [{matched_site}]의 장비 수량: {len(all_equips)}대")
            
        model_counts = {}
        for eq in all_equips:
            si = SetupInfo.query.filter_by(equip_id=eq.id).first()
            m_name = si.model if si and si.model else "미지정"
            model_counts[m_name] = model_counts.get(m_name, 0) + 1
        model_summary = ", ".join([f"{k}: {v}대" for k, v in model_counts.items()])
        context_lines.append(f"- 모델별 장비 수량 분포: {model_summary}")

        t_status_counts = {"조치완료": 0, "조치중": 0}
        t_query = TroubleLog.query
        if matched_site:
            t_query = t_query.filter(TroubleLog.equip_id.like(f"{matched_site}::%"))
        for tl in t_query.all():
            status = tl.status if tl.status else "조치중"
            t_status_counts[status] = t_status_counts.get(status, 0) + 1
        context_lines.append(f"- 장애 조치 상태별 현황: 조치중 {t_status_counts.get('조치중', 0)}건, 완료 {t_status_counts.get('조치완료', 0)}건")

    # 3-2-2. 작업 완료 건수 및 이력 통계 제공 (사용자 질문이 완료 건수를 물어보는 경우)
    if is_work_completion_query or (intent_count and any(k in msg_no_space for k in ["작업", "점검", "조치", "셋업"])):
        context_lines.append(f"\n[{period_label if period_label else '전체 기간'} 작업 완료 및 조치 건수 통계]")
        
        # 1) 점검 완료 건수 (LogItem)
        log_query = LogItem.query
        if matched_site:
            log_query = log_query.filter(LogItem.equip_id.like(f"{matched_site}::%"))
        if target_period:
            log_query = log_query.filter(LogItem.date.like(f"{target_period}%"))
        
        completed_maint_count = log_query.count()
        context_lines.append(f"- 정상 완료된 점검 및 유지보수 작업 일지 건수 (성공 작업이며 오류 발생 기록이 아님): {completed_maint_count}건")
        
        # 2) 장애 조치 완료 건수 (TroubleLog)
        trouble_query = TroubleLog.query.filter_by(status='조치완료')
        if matched_site:
            trouble_query = trouble_query.filter(TroubleLog.equip_id.like(f"{matched_site}::%"))
        if target_period:
            trouble_query = trouble_query.filter(TroubleLog.action_date.like(f"{target_period}%"))
            
        completed_trouble_count = trouble_query.count()
        context_lines.append(f"- 정상적으로 조치(해결) 완료된 장애/트러블 건수 (성공 해결이며 현재 에러가 아님): {completed_trouble_count}건")
        
        # 3) 셋업 완료 건수 (SetupDetail)
        setup_query = SetupDetail.query.filter_by(completed=True)
        if matched_site:
            setup_query = setup_query.filter(SetupDetail.equip_id.like(f"{matched_site}::%"))
        if target_period:
            setup_query = setup_query.filter(SetupDetail.date.like(f"{target_period}%"))
            
        completed_setup_count = setup_query.count()
        context_lines.append(f"- 완료된 장비 셋업 작업 건수(Setup Completed): {completed_setup_count}건")

        # 세부 목록 간략 제시
        if completed_maint_count > 0:
            context_lines.append(f"  * 주요 완료 점검 내역 (최근 5건):")
            recent_logs = log_query.order_by(LogItem.date.desc()).limit(5).all()
            for rl in recent_logs:
                context_lines.append(f"    - [{rl.date}] {rl.equip_id.split('::')[-1]} 장비: {rl.content} (담당: {rl.worker})")
        if completed_trouble_count > 0:
            context_lines.append(f"  * 주요 장애 해결 내역 (최근 5건):")
            recent_troubles = trouble_query.order_by(TroubleLog.action_date.desc()).limit(5).all()
            for rt in recent_troubles:
                context_lines.append(f"    - [{rt.action_date}] {rt.equip_id.split('::')[-1]} 장비: {rt.content} (담당: {rt.worker})")

    # 3-3. 특정 장비가 매칭된 경우 (장비 타겟 정보 제공)
    if matched_equips:
        context_lines.append("\n[타겟 장비 분석 정보]")
        
        # 1) 매칭된 장비가 5대 이하로 소량인 경우: 기존과 같이 각 장비의 상세 개별 이력 제공
        if len(matched_equips) <= 5:
            for eq in matched_equips:
                si = setup_infos_map.get(eq.id)
                cust_name = si.cust_equip_name if si else "N/A"
                status = si.equip_status if si else "N/A"
                loc = f"{si.building} {si.floor} {si.detail_loc}".strip() if si else "N/A"
                manager = si.manager if si else "N/A"
                model = si.model if si else "N/A"
                
                context_lines.append(f"■ 장비: {eq.name} ({eq.serial}) | 모델: {model} | 사업장: {eq.site_name} | 고객장비명: {cust_name} | 상태: {status} | 위치: {loc} | 담당: {manager}")
                
                m_items = MaintItem.query.filter_by(equip_id=eq.id).order_by(MaintItem.scheduled_date).limit(3).all()
                if m_items:
                    context_lines.append(f"  - 예정된 점검 일정:")
                    for mi in m_items:
                        context_lines.append(f"    * [{mi.scheduled_date}] 구분: {mi.type} | 작업: {mi.detail_type} ({mi.worker})")
                
                s_details = SetupDetail.query.filter_by(equip_id=eq.id, completed=False).limit(3).all()
                if s_details:
                    context_lines.append(f"  - 미완료 셋업 과제:")
                    for sd in s_details:
                        context_lines.append(f"    * 구분: {sd.category} | 내용: {sd.content} | 목표일: {sd.date}")
                
                # 장애 분석 시에는 항상 최신 발생순으로 정렬하여 수집합니다.
                t_logs = TroubleLog.query.filter_by(equip_id=eq.id).order_by(TroubleLog.occur_date.desc()).limit(limit_num).all()
                if t_logs:
                    context_lines.append(f"  - 최근 장애/트러블 및 조치 이력 (최대 {limit_num}건):")
                    for tl in t_logs:
                        context_lines.append(f"    * [{tl.occur_date}] 현상: {parse_trouble_content(tl.content)} | 조치: {tl.memo or '진행중'} ({tl.worker})")

                # [추가] 과거 완료된 장비점검/유지보수 작업 실적 일지 (LogItem) 상세 수집
                completed_logs = LogItem.query.filter_by(equip_id=eq.id).order_by(LogItem.date.desc()).limit(limit_num).all()
                if completed_logs:
                    context_lines.append(f"  - 과거 점검 및 조치 완료 이력:")
                    for cl in completed_logs:
                        cl_trouble_info = parse_trouble_content(cl.trouble_details) if cl.trouble_details else ""
                        log_detail = f"{cl.content}"
                        if cl_trouble_info:
                            log_detail += f" ({cl_trouble_info})"
                        if cl.memo:
                            log_detail += f" / 메모: {cl.memo}"
                        context_lines.append(f"    * [{cl.date}] {log_detail} ({cl.worker})")

        # 2) 매칭된 장비가 5대를 초과하여 다량인 경우: 토큰 폭발 방지를 위해 사전 통계 분석 및 핵심 연관 조치사례(Top-5) 요약 제공
        else:
            eq_ids = [eq.id for eq in matched_equips]
            context_lines.append(f"※ 총 {len(matched_equips)}대의 많은 장비가 매칭되어 통계 집계 데이터 및 연관 핵심 이력만 요약 제공합니다.")
            
            # (A) 사전 가동 상태 및 모델 분포 집계 (Pre-aggregation)
            status_counts = {}
            model_counts = {}
            for eq in matched_equips:
                si = setup_infos_map.get(eq.id)
                status_val = si.equip_status if si and si.equip_status else "미지정"
                status_counts[status_val] = status_counts.get(status_val, 0) + 1
                
                model_val = si.model if si and si.model else "미지정"
                model_counts[model_val] = model_counts.get(model_val, 0) + 1
                
            status_summary = ", ".join([f"{k}: {v}대" for k, v in status_counts.items()])
            model_summary = ", ".join([f"{k}: {v}대" for k, v in model_counts.items()])
            
            context_lines.append(f"▶ 장비 그룹 종합 현황:")
            context_lines.append(f"  - 검색된 총 수량: {len(matched_equips)}대")
            context_lines.append(f"  - 가동 상태 분포: {status_summary}")
            context_lines.append(f"  - 모델 분포: {model_summary}")
            
            # (B) 과거 장애 및 조치 이력 분석 사전 통계화 및 연관 장애 조치 이력 상위 5건 추출 (Top-K)
            all_trouble_query = TroubleLog.query.filter(TroubleLog.equip_id.in_(eq_ids))
            
            # 질문과 유사한 키워드가 겹치는 트러블 로그 우선 검색
            search_keywords = [w for w in sanitized_message.split() if len(w) >= 2 and w not in ["pm", "작업", "완료", "건수", "분석", "해줘", "알려줘", "7월", "이번달"]]
            
            related_troubles = []
            if search_keywords:
                for kw in search_keywords:
                    kw_troubles = all_trouble_query.filter(TroubleLog.content.like(f"%{kw}%") | TroubleLog.memo.like(f"%{kw}%")).all()
                    related_troubles.extend(kw_troubles)
                seen_t = set()
                related_troubles = [t for t in related_troubles if not (t._unique_id in seen_t or seen_t.add(t._unique_id))]
            
            # 연관 사례가 부족할 경우 최근 해결 완료된 주요 조치 로그로 보충
            if len(related_troubles) < 5:
                extra_troubles = all_trouble_query.filter_by(status='조치완료').order_by(TroubleLog.action_date.desc()).limit(5 - len(related_troubles)).all()
                for et in extra_troubles:
                    if et._unique_id not in [t._unique_id for t in related_troubles]:
                        related_troubles.append(et)
            
            top_troubles = related_troubles[:5]
            if top_troubles:
                context_lines.append(f"\n▶ [과거 유사 장애 해결 및 조치 성공 사례 (최우수 레퍼런스 5건)]")
                for rt in top_troubles:
                    eq_serial = rt.equip_id.split('::')[-1]
                    context_lines.append(f"  * 발생일: {rt.occur_date} | 조치완료일: {rt.action_date or '미조치'} | 장비: {eq_serial} (담당: {rt.worker})")
                    context_lines.append(f"    - 고장 현상: {parse_trouble_content(rt.content)}")
                    context_lines.append(f"    - 해결 조치 내용: {rt.memo if rt.memo else '기록 없음'}")
            else:
                context_lines.append(f"\n▶ [과거 유사 장애 해결 및 조치 성공 사례]\n  - 해당 장비 그룹의 조치 완료된 트러블 이력이 없습니다.")

            # (C) 임박한 점검 예정 일정 요약 (최대 5건)
            upcoming_maint = MaintItem.query.filter(MaintItem.equip_id.in_(eq_ids)).order_by(MaintItem.scheduled_date).limit(5).all()
            if upcoming_maint:
                context_lines.append(f"\n▶ [다가오는 주요 점검 예정 일정 (임박 5건)]")
                for um in upcoming_maint:
                    eq_serial = um.equip_id.split('::')[-1]
                    context_lines.append(f"  - [{um.scheduled_date}] {eq_serial} ({um.type}): {um.detail_type} (담당: {um.worker})")

            # (C-2) 과거 점검 및 조치 완료 이력 요약 (최대 5건)
            all_log_query = LogItem.query.filter(LogItem.equip_id.in_(eq_ids))
            related_logs = []
            if search_keywords:
                for kw in search_keywords:
                    # [개선] 과거 완료 이력 중 상황, 증상, 조치, 메모 텍스트까지 검색 범위를 확장하여 매칭률을 극대화합니다.
                    kw_logs = all_log_query.filter(
                        LogItem.content.like(f"%{kw}%") |
                        LogItem.trouble_details.like(f"%{kw}%") |
                        LogItem.memo.like(f"%{kw}%")
                    ).all()
                    related_logs.extend(kw_logs)
                seen_l = set()
                related_logs = [l for l in related_logs if not (l._unique_id in seen_l or seen_l.add(l._unique_id))]
            
            if len(related_logs) < 5:
                extra_logs = all_log_query.order_by(LogItem.date.desc()).limit(5 - len(related_logs)).all()
                for el in extra_logs:
                    if el._unique_id not in [l._unique_id for l in related_logs]:
                        related_logs.append(el)
            
            top_logs = related_logs[:5]
            if top_logs:
                context_lines.append(f"\n▶ [과거 점검 및 조치 완료 이력 요약 (최근 5건)]")
                for rl in top_logs:
                    eq_serial = rl.equip_id.split('::')[-1]
                    rl_trouble_info = parse_trouble_content(rl.trouble_details) if rl.trouble_details else ""
                    rl_memo_info = rl.memo if rl.memo else ""
                    log_detail = f"점검내역: {rl.content}"
                    if rl_trouble_info:
                        log_detail += f" | 장애상세: {rl_trouble_info}"
                    if rl_memo_info:
                        log_detail += f" | 작업메모: {rl_memo_info}"
                    context_lines.append(f"  - [{rl.date}] {eq_serial} 장비: {log_detail} (담당: {rl.worker})")

            # (D) 장비 목록 요약 (최대 10개만 대표 노출)
            context_lines.append(f"\n▶ [대상 장비 목록 요약 (상위 10대)]")
            for eq in matched_equips[:10]:
                si = setup_infos_map.get(eq.id)
                cust_name = si.cust_equip_name if si else "N/A"
                status = si.equip_status if si else "N/A"
                model = si.model if si else "N/A"
                context_lines.append(f"  - {eq.name} (시리얼: {eq.serial}, 모델: {model}, 고객장비명: {cust_name}, 상태: {status})")
            if len(matched_equips) > 10:
                context_lines.append(f"  - 그 외 {len(matched_equips) - 10}대의 장비가 더 존재합니다.")

    # 3-4. 장비 매칭은 없지만 모델 매칭이 된 경우
    elif matched_model:
        context_lines.append(f"\n[모델명 '{matched_model}' 관련 장비 목록]")
        # [개선] 가상 장비인 "기타(ETC)" 장비는 챗봇 매칭 및 통계에서 제외합니다.
        model_equips = Equipment.query.join(SetupInfo, Equipment.id == SetupInfo.equip_id).filter(SetupInfo.model == matched_model, Equipment.name != "기타(ETC)")
        if matched_site:
            model_equips = model_equips.filter(Equipment.site_name == matched_site)
        m_eqs = model_equips.all()
        for eq in m_eqs[:10]:
            si = SetupInfo.query.filter_by(equip_id=eq.id).first()
            cust_name = si.cust_equip_name if si else "N/A"
            status = si.equip_status if si else "N/A"
            context_lines.append(f"- 장비명: {eq.name}, 일련번호: {eq.serial}, 사업장: {eq.site_name}, 고객 장비명: {cust_name}, 상태: {status}")
        if len(m_eqs) > 10:
            context_lines.append(f"  (외 {len(m_eqs) - 10}대의 장비가 더 존재합니다.)")

    # 3-5. 작업자(Worker) 매칭이 된 경우 관련 이력 조회
    if matched_worker:
        context_lines.append(f"\n[작업자 '{matched_worker}' 관련 배정 내역]")
        
        worker_maint = MaintItem.query.filter(MaintItem.worker.like(f"%{matched_worker}%"))
        if matched_site:
            worker_maint = worker_maint.filter(MaintItem.equip_id.like(f"{matched_site}::%"))
        wm_list = worker_maint.order_by(MaintItem.scheduled_date).limit(limit_num).all()
        if wm_list:
            context_lines.append(f"  - 점검 및 유지보수 일정 (최대 {limit_num}건):")
            for mi in wm_list:
                context_lines.append(f"    * 예정일: {mi.scheduled_date}, 장비ID: {mi.equip_id}, 구분: {mi.type}, 작업명: {mi.detail_type}")
        
        worker_trouble = TroubleLog.query.filter(TroubleLog.worker.like(f"%{matched_worker}%"))
        if matched_site:
            worker_trouble = worker_trouble.filter(TroubleLog.equip_id.like(f"{matched_site}::%"))
        wt_list = worker_trouble.order_by(TroubleLog.occur_date.desc()).limit(limit_num).all()
        if wt_list:
            context_lines.append(f"  - 장애/트러블 조치 이력 (최대 {limit_num}건):")
            for tl in wt_list:
                context_lines.append(f"    * 발생일: {tl.occur_date}, 조치일: {tl.action_date or '미조치'}, 상태: {tl.status}, 장비ID: {tl.equip_id}")
                context_lines.append(f"      현상: {parse_trouble_content(tl.content)}")
                context_lines.append(f"      조치/메모: {tl.memo if tl.memo else '기록 없음'}")

    # 3-6. 일반 의도별 다중 쿼리 (장비/작업자 개별 지목이 없는 경우)
    if not matched_equips and not matched_worker and not matched_model:
        # (1) 장애/트러블(INTENT_TROUBLE) 조회
        if intent_trouble:
            query = TroubleLog.query
            if matched_site:
                query = query.filter(TroubleLog.equip_id.like(f"{matched_site}::%"))
                
            if "조치중" in user_message or "미해결" in user_message or "진행중" in user_message:
                query = query.filter_by(status='조치중')
            elif "완료" in user_message or "해결" in user_message:
                query = query.filter_by(status='조치완료')
                
            t_logs = query.order_by(TroubleLog.occur_date.desc()).limit(limit_num).all()
            if t_logs:
                context_lines.append(f"\n[최근 트러블 및 조치 이력 (최대 {limit_num}건)]")
                for tl in t_logs:
                    context_lines.append(f"- 장비ID: {tl.equip_id}, 발생일: {tl.occur_date}, 조치일: {tl.action_date or '미조치'}, 상태: {tl.status}, 담당: {tl.worker}")
                    context_lines.append(f"  현상: {parse_trouble_content(tl.content)}")
                    context_lines.append(f"  조치/경과: {tl.memo if tl.memo else '기록 없음'}")
            else:
                context_lines.append("\n[최근 트러블 및 조치 이력]\n- 등록된 트러블 내역이 없습니다.")

        # (2) 점검/일정(INTENT_SCHEDULE) 조회
        if intent_schedule:
            query = MaintItem.query
            if matched_site:
                query = query.filter(MaintItem.equip_id.like(f"{matched_site}::%"))
            maint_items = query.order_by(MaintItem.scheduled_date).limit(limit_num).all()
            if maint_items:
                context_lines.append(f"\n[유지관리 점검 일정 (최대 {limit_num}건)]")
                for mi in maint_items:
                    context_lines.append(f"- 예정일: {mi.scheduled_date}, 장비ID: {mi.equip_id}, 구분: {mi.type}, 작업명: {mi.detail_type}, 담당: {mi.worker}")
            else:
                context_lines.append("\n[유지관리 점검 일정]\n- 예정된 점검 일정이 없습니다.")

        # (3) 셋업(INTENT_SETUP) 조회
        if intent_setup:
            setup_query = SetupDetail.query
            if matched_site:
                setup_query = setup_query.filter(SetupDetail.equip_id.like(f"{matched_site}::%"))
            
            if "미완료" in user_message or "대기" in user_message or "진행" in user_message:
                setup_query = setup_query.filter_by(completed=False)
            elif "완료" in user_message:
                setup_query = setup_query.filter_by(completed=True)
                
            setup_details = setup_query.order_by(SetupDetail.date).limit(limit_num).all()
            if setup_details:
                context_lines.append(f"\n[셋업 일정 및 상태 (최대 {limit_num}건)]")
                for sd in setup_details:
                    status_str = "완료" if sd.completed else "진행중"
                    context_lines.append(f"- 장비ID: {sd.equip_id}, 카테고리: {sd.category}, 작업내용: {sd.content}, 목표일: {sd.date}, 상태: {status_str}")
            else:
                context_lines.append("\n[셋업 일정]\n- 등록된 셋업 일정이 없습니다.")

        # (4) 기본: 키워드가 없거나 단순 장비 목록 조회인 경우
        if not intent_trouble and not intent_schedule and not intent_setup:
            # [개선] 특정 장비 지목 없이 사업장 단위의 분석을 요청한 경우, 사업장의 복합 이력을 추출해 컨텍스트 질을 비약적으로 상승시킵니다.
            if matched_site:
                context_lines.append(f"\n[{matched_site} 사업장 종합 현황 및 이력 분석 데이터]")
                
                # 1) 소속 장비 최근 장애/트러블 이력
                site_troubles = TroubleLog.query.filter(TroubleLog.equip_id.like(f"{matched_site}::%")).order_by(TroubleLog.occur_date.desc()).limit(5).all()
                if site_troubles:
                    context_lines.append(f"  * 최근 발생 장애 내역:")
                    for st in site_troubles:
                        context_lines.append(f"    - [{st.occur_date}] {st.equip_id.split('::')[-1]} (상태: {st.status}, 조치일: {st.action_date or '미조치'}): {parse_trouble_content(st.content)}")
                        if st.memo:
                            context_lines.append(f"      조치 세부내역: {st.memo}")
                else:
                    context_lines.append(f"  * 최근 발생한 장애 내역이 없습니다.")

                # 2) 소속 장비 최근 점검 이력
                site_completed_logs = LogItem.query.filter(LogItem.equip_id.like(f"{matched_site}::%")).order_by(LogItem.date.desc()).limit(5).all()
                if site_completed_logs:
                    context_lines.append(f"  * 최근 점검 수행 내역:")
                    for scl in site_completed_logs:
                        scl_trouble_info = parse_trouble_content(scl.trouble_details) if scl.trouble_details else ""
                        scl_memo_info = scl.memo if scl.memo else ""
                        log_detail = f"점검내역: {scl.content}"
                        if scl_trouble_info:
                            log_detail += f" | 장애상세: {scl_trouble_info}"
                        if scl_memo_info:
                            log_detail += f" | 작업메모: {scl_memo_info}"
                        context_lines.append(f"    - [{scl.date}] {scl.equip_id.split('::')[-1]}: {log_detail} (담당: {scl.worker})")

                # 3) 소속 장비 다가오는 점검 예정 일정
                site_upcoming_maint = MaintItem.query.filter(MaintItem.equip_id.like(f"{matched_site}::%")).order_by(MaintItem.scheduled_date).limit(5).all()
                if site_upcoming_maint:
                    context_lines.append(f"  * 예정된 점검 일정:")
                    for sumi in site_upcoming_maint:
                        context_lines.append(f"    - [{sumi.scheduled_date}] {sumi.equip_id.split('::')[-1]} ({sumi.type}): {sumi.detail_type} (담당: {sumi.worker})")

            context_lines.append("\n[등록 장비 현황]")
            for eq in all_equips[:15]:
                si = SetupInfo.query.filter_by(equip_id=eq.id).first()
                cust_name = si.cust_equip_name if si else "N/A"
                status = si.equip_status if si else "N/A"
                model = si.model if si else "N/A"
                context_lines.append(f"- 장비명: {eq.name}, 일련번호: {eq.serial}, 모델: {model}, 사업장: {eq.site_name}, 고객 장비명: {cust_name}, 상태: {status}")
            if len(all_equips) > 15:
                context_lines.append(f"  (외 {len(all_equips) - 15}대의 장비가 더 존재합니다. 특정 장비명이나 시리얼로 정확하게 검색하실 수 있습니다.)")

    return "\n".join(context_lines)

def call_external_chat_api(prompt, system_instruction):
    """환경변수에 설정된 AI API를 호출하여 결과를 가져옵니다."""
    api_type = os.environ.get('CHAT_API_TYPE', 'openai').lower()
    api_key = os.environ.get('CHAT_API_KEY', '')
    
    if not api_key:
        return "AI API 인증 키(CHAT_API_KEY)가 설정되지 않았습니다. 서버 환경설정을 확인해주세요."

    try:
        if api_type == 'gemini':
            model = os.environ.get('CHAT_API_MODEL', 'gemini-2.5-flash')
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            
            headers = {"Content-Type": "application/json"}
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": f"{system_instruction}\n\n[참고 데이터]\n{prompt}"}
                        ]
                    }
                ]
            }
        else:
            model = os.environ.get('CHAT_API_MODEL', 'gpt-4o-mini')
            url = os.environ.get('CHAT_API_URL', 'https://api.openai.com/v1/chat/completions')
            
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": prompt}
                ]
            }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
            if api_type == 'gemini':
                reply = res_data['candidates'][0]['content']['parts'][0]['text']
            else:
                reply = res_data['choices'][0]['message']['content']
                
            return reply.strip()

    except urllib.error.HTTPError as e:
        error_msg = e.read().decode('utf-8')
        app.logger.error(f"AI API HTTP Error: {e.code} - {error_msg}")
        if e.code == 429:
            return "현재 구글 AI Studio 무료 API Key의 일일/분당 호출 횟수 제한(Quota Exceeded)을 초과했습니다. 잠시 후(약 30초~1분 뒤) 다시 질문해 주시거나, 결제 카드가 등록된 API Key로 업그레이드해 주세요."
        elif e.code == 503:
            return "현재 구글 Gemini AI 서버의 일시적인 혼잡 및 트래픽 폭주 상태(503 Service Unavailable)입니다. 구글 API 서버의 부하가 줄어들 때까지 잠시 후(약 10초~30초 뒤) 다시 질문해 주세요."
        return f"AI API 호출 오류가 발생했습니다. (코드: {e.code})"
    except Exception as e:
        app.logger.error(f"AI API Connection Error: {str(e)}")
        return "AI API 서버 연결에 실패했습니다. 네트워크 상태 또는 환경변수를 확인해주세요."

@app.route('/api/chat', methods=['POST'])
@login_required
@limiter.limit("20 per minute")
def ai_chatbot():
    try:
        # 개발 중 임시 조치: 최종 관리자(superadmin)만 챗봇 사용 가능
        role = session.get('role')
        if role != 'superadmin':
            return jsonify({"status": "fail", "message": "챗봇 사용 권한이 없습니다. (현재 개발 중)"}), 403

        data = request.json or {}
        user_message = data.get('message', '').strip()
        if not user_message:
            return jsonify({"status": "fail", "message": "질문 내용이 비어있습니다."}), 400

        # 보안 보완 1: 입력 데이터 길이 제한 (500자)
        if len(user_message) > 500:
            return jsonify({"status": "fail", "message": "질문 길이는 최대 500자 이하로 제한됩니다."}), 400

        # 보안 보완 2: 프롬프트 인젝션 키워드 차단 및 반복 시 IP 차단(밴) 실행
        injection_keywords = ["ignore instruction", "규칙 무시", "system prompt", "지침 무시", "마스킹 해제", "masking table"]
        if any(keyword in user_message.lower() for keyword in injection_keywords):
            ip = get_remote_address()
            now = datetime.now(timezone.utc)
            
            if ip not in IP_ABUSE_COUNTER:
                IP_ABUSE_COUNTER[ip] = {"count": 1, "last_attempt": now}
            else:
                attempt_info = IP_ABUSE_COUNTER[ip]
                if (now - attempt_info["last_attempt"]).total_seconds() < 3600:
                    attempt_info["count"] += 1
                else:
                    attempt_info["count"] = 1
                attempt_info["last_attempt"] = now
            
            current_abuse_count = IP_ABUSE_COUNTER[ip]["count"]
            app.logger.warning(f"AI Prompt Injection attempt detected from IP: {ip}, User: {session.get('user_id')} (Abuse Count: {current_abuse_count}/3)")

            if current_abuse_count >= 3:
                ban_until = now + timedelta(hours=24)
                IP_BLACKLIST[ip] = ban_until
                session.clear()
                app.logger.error(f"IP {ip} has been BANNED for 24 hours due to repeated prompt injection.")
                return jsonify({"status": "fail", "message": "보안 정책 반복 위반으로 인해 해당 IP 및 계정 접속이 24시간 동안 차단됩니다."}), 403

            return jsonify({"status": "fail", "message": "보안 위협이 감지되어 요청이 차단되었습니다."}), 400

        # 보안 보완 3: 세션 쿨다운 타이머 체크 (1.5초 연속 호출 차단)
        now = datetime.now(timezone.utc)
        last_time_str = session.get('last_chat_time')
        if last_time_str:
            try:
                last_time = datetime.fromisoformat(last_time_str)
                if (now - last_time).total_seconds() < 1.5:
                    return jsonify({"status": "fail", "message": "요청이 너무 빠릅니다. 잠시 후 다시 전송해주세요."}), 429
            except Exception:
                pass
        session['last_chat_time'] = now.isoformat()

        # 정당한 가입 유저 활성화 여부 확인
        user = User.query.filter_by(id=session.get('user_id')).first()
        if not user:
            return jsonify({"status": "fail", "message": "세션 정보가 유효하지 않습니다."}), 401

        # 계정 잠금 여부 재차 체크
        if user.lockout_until and user.lockout_until > datetime.now():
            return jsonify({"status": "fail", "message": "해당 계정은 현재 잠금 상태입니다."}), 403

        # 1. RAG 기반 DB 컨텍스트 수집
        db_context = build_rag_context(user, user_message)

        # 2. 비식별화(마스킹) 처리
        mapping_table = {}
        all_sites = [s.name for s in Site.query.all()]
        
        masked_user_message = security_manager.mask_data(user_message, mapping_table, all_sites)
        masked_db_context = security_manager.mask_data(db_context, mapping_table, all_sites)

        # 보안 보완 4: AI 대화 요청에 대한 마스킹 처리된 감사 로그 기록
        try:
            audit_log = SystemLog(
                action='AI_CHAT',
                target=user.id,
                details=f"AI 질의 수행 (마스킹된 내용: {masked_user_message})",
                worker=user.name or user.id
            )
            db.session.add(audit_log)
            db.session.commit()
        except Exception as log_err:
            db.session.rollback()
            app.logger.error(f"Failed to write AI chat audit log: {str(log_err)}")

        # 3. 프롬프트 및 지침 작성 (트러블슈팅 분석 및 통계 가이드 전문 정체성 부여)
        system_instruction = (
            "너는 위드텍(WITHTECH) 사내 장비 점검/유지보수 데이터 및 장애(Trouble) 로그 분석 전문 수석 엔지니어 AI 비서이다.\n"
            "너가 제공받는 컨텍스트 데이터(Context) 및 사용자 질문은 보안 유출 방지를 위해 마스킹 처리되어 전달된다.\n"
            "답변을 작성할 때 [MASK_SITE_*], [MASK_SERIAL_*], [MASK_NAME_*], [MASK_PHONE_*], [MASK_EMAIL_*] 등의 "
            "마스킹 토큰은 실제 기밀 데이터가 치환된 중요한 보안 키이므로 절대 임의로 복원하거나 변경(예: 이름 추측 등)하지 말고, "
            "대답 문장 내에서 그 형태 그대로(예: '[MASK_SERIAL_1]') 포함하여 문맥에 맞춰 안전하게 답변해야 한다.\n"
            "답변 구성 시 사용자의 '질문 의도'에 맞춰 유연하게 대처해라:\n"
            "  - [상황 A] 사용자가 고장, 에러, 트러블 분석, 장비 문제 해결 등을 물어볼 때:\n"
            "    제공된 [참고 컨텍스트]의 데이터를 분석하여 불필요하게 서술형으로 길게 나열하지 말고, 한눈에 핵심을 파악할 수 있도록 깔끔한 리포트 양식으로 개조식 요약하여 답변해라.\n"
            "    반드시 다음의 3개 주요 섹션 구조를 유지하고 가독성 높은 마크다운 포맷(볼드, 글머리 기호 등)을 사용해라:\n"
            "      1. **[요약] 과거 장애 이력 분석**:\n"
            "         - 대상 장비 및 발생일자 명시\n"
            "         - 현상/증상, 추정 원인, 수행 조치내용, 당시 재발방지대책을 간결한 항목별 글머리(bullet point)로 요약해라.\n"
            "      2. **현장 엔지니어 권장 조치 가이드**:\n"
            "         - 증상/원인별로 즉각 실행할 수 있는 물리 점검, 전원, SMPS, 소프트웨어(펌웨어) 등의 필수 조치 절차를 간략하게 요약해라.\n"
            "      3. **향후 예방을 위한 SOP(점검 매뉴얼) 보완 방안**:\n"
            "         - 구체적인 SOP 고도화 제안 및 예방 정비 주기(단축 및 점검 추가)에 대한 현실적인 보완책을 한두 문장씩 명료하게 기술해라.\n"
            "  - [상황 B] 사용자가 단순히 수량(몇 대인가, 몇 건인가), 일정 날짜 확인, 단순 인사 등 단발성 정보를 물어볼 때:\n"
            "    불필요한 대응 방안이나 조치 SOP를 억지로 지어내지 말고, 질문한 핵심 정답 수치와 날짜 정보만 명료하고 간결하게(1~2줄 내외) 한두 문장으로 신속하게 대답해라.\n"
            "만약 사용자가 장비, 점검 일정, 장애 이력 등 '사내 데이터'에 관해 질문했는데 제공된 [참고 컨텍스트]에 관련 정보가 전혀 없는 경우라면 억지로 거짓말을 꾸며내지 말고 정중하게 모른다고 대답해라.\n"
            "단순 인사, 자아정체성(너는 누구니 등), 일반 상식 대화는 [참고 컨텍스트]에 정보가 없더라도 AI가 가진 일반 지식을 바탕으로 자연스럽고 친절하게 응답해주어라.\n"
            "친절하고 정중한 높임말로 답변해라.\n"
            "**[중요 주의사항]**: 제공받는 컨텍스트 중 완료된 점검 및 유지보수 작업 일지 건수(Maint Logs)와 조치 완료된 트러블 건수는 현재 장애가 지속되고 있는 '오류 발생 건수'가 아니라 엔지니어들이 성공적으로 점검과 장애 해결을 **완료(성공)한 정상 실적 건수**입니다. 이 건수(예: 30건)를 '시스템 오류 30건 발생' 또는 '30건의 결함 발생'으로 오인하여 오답을 내지 않도록 엄격히 주의하십시오."
        )

        full_prompt = (
            f"[참고 컨텍스트]\n{masked_db_context if masked_db_context else '관련 데이터 없음'}\n\n"
            f"[사용자 질문]\n{masked_user_message}"
        )

        # 4. 외부 API 호출
        api_reply = call_external_chat_api(full_prompt, system_instruction)

        # 5. 역마스킹 복원
        demasked_reply = security_manager.demask_data(api_reply, mapping_table)

        return jsonify({
            "status": "success",
            "reply": demasked_reply
        })

    except Exception as e:
        # 보안 보완 5: 내부 시스템 예외 노출 전면 차단
        app.logger.error(f"Unexpected error in ai_chatbot endpoint: {str(e)}")
        return jsonify({"status": "fail", "message": "요청을 처리하는 중 서버 오류가 발생했습니다. 관리자에게 문의하세요."}), 500

# [추가] 비밀번호 확인 API (수정 전 인증용)
@app.route('/api/user/verify', methods=['POST'])
@login_required
def verify_user_pw():
    data = request.json
    pw = data.get('pw')
    user = User.query.filter_by(id=session.get('user_id')).first()
    try:
        is_valid = check_password_hash(user.pw, pw) if user else False
    except AttributeError:
        is_valid = False
    if not user or not is_valid:
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
                "site": u.site or "",
                "role": u.role
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
    if role == 'admin' and session.get('role') != 'superadmin':
        return jsonify({"status": "fail", "message": "일반 관리자는 일반 계정만 생성할 수 있습니다."}), 403

    if User.query.filter_by(id=new_id).first():
        return jsonify({"status": "fail", "message": "이미 존재하는 아이디입니다."}), 400

    new_user = User(id=new_id, pw=generate_password_hash(new_pw, method='pbkdf2:sha256:50000'), role=role, site=site, department=department, position=position, name=name, pw_changed_at=get_utc_now())
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
    try:
        is_valid = check_password_hash(user.pw, current_pw)
    except AttributeError:
        is_valid = False
        
    if not is_valid:
        return jsonify({"status": "fail", "message": "현재 비밀번호가 일치하지 않습니다."}), 401

    user.pw = generate_password_hash(new_pw, method='pbkdf2:sha256:50000')
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
    try:
        is_valid = check_password_hash(user.pw, pw) if user else False
    except AttributeError:
        is_valid = False
        
    if not user or not is_valid:
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

# [추가] 최종 관리자 전용 모든 사용자 목록 조회 API
@app.route('/api/admin/users/all', methods=['GET'])
@login_required
def get_all_users_for_admin():
    if session.get('role') != 'superadmin':
        return jsonify({"status": "fail", "message": "최종 관리자 권한이 필요합니다."}), 403
    users = User.query.order_by(User.name).all()
    user_list = [{
        "id": u.id, "name": u.name or '', "department": u.department or '',
        "position": u.position or '', "role": u.role, "site": u.site or ''
    } for u in users]
    return jsonify({"status": "success", "users": user_list})

# [추가] 최종 관리자 전용 타 계정 정보 강제 수정 API
@app.route('/api/admin/user/update_all', methods=['POST'])
@login_required
def admin_update_any_user():
    if session.get('role') != 'superadmin':
        return jsonify({"status": "fail", "message": "최종 관리자 권한이 필요합니다."}), 403
    data = request.json
    target_id = data.get('id')
    user = User.query.filter_by(id=target_id).first()
    if not user:
        return jsonify({"status": "fail", "message": "사용자를 찾을 수 없습니다."}), 404

    if target_id in ['admin', os.environ.get('APP_ADMIN_ID', 'admin')] and data.get('role') != 'superadmin':
        return jsonify({"status": "fail", "message": "시스템 보호: 최고 관리자 계정의 권한은 하향할 수 없습니다."}), 403

    if 'department' in data: user.department = data['department']
    if 'position' in data: user.position = data['position']
    if 'name' in data: user.name = data['name']
    if 'site' in data: user.site = data['site']
    if 'role' in data: user.role = data['role']
    if 'pw' in data and data['pw']: # 비밀번호 변경(입력) 시에만 적용
        user.pw = generate_password_hash(data['pw'], method='pbkdf2:sha256:50000')
        user.pw_changed_at = get_utc_now()

    db.session.commit()
    return jsonify({"status": "success"})

# [추가] DB 기반 로그 API
@app.route('/api/log/add', methods=['POST'])
@login_required
@limiter.exempt
def add_log():
    data = request.json
    user_id = session.get('user_id')
    user = User.query.filter_by(id=user_id).first()
    worker_name = user.name if user and user.name else user_id

    action_type = data.get('action')
    target_val = data.get('target')
    details_val = data.get('details', '')

    # [중복 방지 가드] 워런티 기간 만료 자동 전환 로그는 장비당 최초 1회만 기록되도록 제한
    if action_type == 'UPDATE_EQUIP_STATUS' and details_val == '워런티 기간 만료에 따른 가동 장비 자동 전환':
        exists = SystemLog.query.filter_by(
            action='UPDATE_EQUIP_STATUS',
            target=target_val,
            details='워런티 기간 만료에 따른 가동 장비 자동 전환'
        ).first()
        if exists:
            return jsonify({"status": "success", "message": "already logged"})

    new_log = SystemLog(
        action=action_type,
        target=target_val,
        details=details_val,
        worker=worker_name
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
        "details": log.details,
        "worker": log.worker or "-" # [추가] 작업자 반환 (없으면 하이픈)
    } for log in logs]
    return jsonify(result)

# [추가] 통합 Admin 설정 관리를 위한 만능 DB CRUD API
@app.route('/api/admin/crud', methods=['POST'])
@login_required
@limiter.exempt
def admin_crud():
    role = session.get('role')
    if role not in ['admin', 'superadmin']:
        return jsonify({"status": "fail", "message": "권한이 없습니다."}), 403
    data = request.json
    domain = data.get('domain')
    action = data.get('action')
    payload = data.get('payload')
    
    # [수정] 일반 관리자(admin)는 사업장(site) 마스터 관리만 superadmin으로 제한하고, 장비/물품/점검구분/셋업/설정 변경은 모두 허용
    if role == 'admin':
        if domain == 'site':
            return jsonify({"status": "fail", "message": "사업장 데이터의 추가/삭제/수정은 최종 관리자(superadmin)만 가능합니다."}), 403
            
    
    try:
        if domain == 'site':
            if action == 'CREATE':
                site_name = payload['name']
                site_group = payload.get('group', '기타사업장')
                db.session.add(Site(name=site_name, group=site_group, buildings='[]'))
                db.session.flush() # 부모(사업장) 레코드를 먼저 DB에 반영하여 FK 에러 방지
                
                # [추가] 사업장 생성 시 '기타(ETC)' 장비 기본 등록
                etc_id = f"{site_name}::기타(ETC)::::"
                db.session.add(Equipment(id=etc_id, site_name=site_name, name="기타(ETC)", serial=""))
                db.session.add(SetupInfo(equip_id=etc_id, cust_equip_name="", model=""))
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
                if site: 
                    site.buildings = json.dumps(payload.get('buildings', []), ensure_ascii=False)
                    if 'group' in payload:
                        site.group = payload['group']
            elif action == 'DELETE':
                db.session.execute(text("DELETE FROM site WHERE name=:n"), {'n':payload['name']})
                
        elif domain == 'equip':
            new_id = payload.get('new_id')
            site_name = payload.get('site')
            
            if action == 'CREATE':
                # [추가] 없는 사업장에 장비 추가 시 사업장과 기타(ETC) 자동 생성 (CSV 일괄 등록 대응)
                if not Site.query.filter_by(name=site_name).first():
                    db.session.add(Site(name=site_name, buildings='[]'))
                    db.session.flush() # 부모 레코드 먼저 반영
                    etc_id = f"{site_name}::기타(ETC)::::"
                    db.session.add(Equipment(id=etc_id, site_name=site_name, name="기타(ETC)", serial=""))
                    db.session.add(SetupInfo(equip_id=etc_id, cust_equip_name="", model=""))
                    db.session.flush()
                
                parts = new_id.split('::')
                e_name = parts[0] if len(parts) > 0 else ""
                e_serial = (parts[1] if len(parts) > 1 else "").replace('?', '-')
                cust_name = payload['setup'].get('custEquipName', '').replace('?', '-')

                if e_name == "기타(ETC)":
                    db_id = f"{site_name}::기타(ETC)::::"
                    e_serial = ""
                else:
                    db_id = f"{site_name}::{e_name}::{e_serial}::{cust_name}"

                db.session.add(Equipment(id=db_id, site_name=site_name, name=e_name, serial=e_serial, cust_equip_name=cust_name, special_note=payload.get('special_note', '')))
                db.session.add(SetupInfo(
                    equip_id=db_id, cust_equip_name=cust_name, project_no=payload['setup'].get('projectNo', ''), equip_status=payload['setup'].get('equipStatus', ''),
                    delivery_date=payload['setup'].get('deliveryDate', ''), warranty_start=payload['setup'].get('warrantyStart', ''), warranty_period=str(payload['setup'].get('warrantyPeriod', '')),
                    building=payload['setup'].get('building', ''), floor=payload['setup'].get('floor', ''), detail_loc=payload['setup'].get('detailLoc', ''),
                    manager=payload['setup'].get('manager', ''), contact=payload['setup'].get('contact', ''), email=payload['setup'].get('email', ''),
                    cust_manager=payload['setup'].get('custManager', ''), cust_contact=payload['setup'].get('custContact', ''), cust_email=payload['setup'].get('custEmail', ''), model=payload['setup'].get('model', '')
                ))
            elif action == 'UPDATE':
                old_id = payload['old_id']
                old_site = payload.get('old_site', site_name)
                
                parts = new_id.split('::')
                e_name = parts[0] if len(parts) > 0 else ""
                e_serial = (parts[1] if len(parts) > 1 else "").replace('?', '-')
                cust_name = payload.get('setup', {}).get('custEquipName', '').replace('?', '-')

                if e_name == "기타(ETC)":
                    db_new_id = f"{site_name}::기타(ETC)::::"
                    e_serial = ""
                else:
                    db_new_id = f"{site_name}::{e_name}::{e_serial}::{cust_name}"
                
                raw_old_id = f"{old_site}::{old_id}"
                resolved_old = resolve_master_equip_id(raw_old_id)
                db_old_id = resolved_old if resolved_old else raw_old_id

                db.session.expire_all()

                # 수정 대상이 되는 기존 객체를 우선적으로 찾기
                equip = Equipment.query.filter_by(id=db_old_id).first()
                if not equip and db_old_id != raw_old_id:
                    equip = Equipment.query.filter_by(id=raw_old_id).first()
                if not equip:
                    equip = Equipment.query.filter_by(id=db_new_id).first()
                if not equip:
                    equip = Equipment.query.filter_by(site_name=old_site, name=e_name, serial=e_serial).first()
                if not equip and e_name and e_serial:
                    equip = Equipment.query.filter_by(name=e_name, serial=e_serial).first()
                    
                if equip:
                    db_old_id = equip.id

                    # 1. ID가 변경되었을 때의 처리 (중복 제거 & CASCADE 및 식별자 갱신)
                    if db_old_id != db_new_id:
                        # 이미 db_new_id를 가리키는 중복 레코드가 DB에 있다면 우선 제거하여 PK 충돌 방지
                        dup_new = Equipment.query.filter_by(id=db_new_id).first()
                        if dup_new and dup_new.id != equip.id:
                            db.session.delete(dup_new)
                            db.session.flush()

                        try:
                            db.session.execute(text("SET FOREIGN_KEY_CHECKS=0;"))
                        except:
                            try:
                                db.session.execute(text("PRAGMA foreign_keys = OFF;"))
                            except:
                                pass

                        db.session.execute(text("UPDATE maint_item SET equip_id=:n WHERE equip_id=:o"), {'n':db_new_id, 'o':db_old_id})
                        db.session.execute(text("UPDATE log_item SET equip_id=:n WHERE equip_id=:o"), {'n':db_new_id, 'o':db_old_id})
                        db.session.execute(text("UPDATE setup_detail SET equip_id=:n WHERE equip_id=:o"), {'n':db_new_id, 'o':db_old_id})
                        db.session.execute(text("UPDATE setup_log SET equip_id=:n WHERE equip_id=:o"), {'n':db_new_id, 'o':db_old_id})
                        db.session.execute(text("UPDATE trouble_log SET equip_id=:n WHERE equip_id=:o"), {'n':db_new_id, 'o':db_old_id})
                        
                        equip.id = db_new_id
                        equip.site_name = site_name
                        equip.name = e_name
                        equip.serial = e_serial
                        equip.cust_equip_name = cust_name
                        db.session.flush()

                        try:
                            db.session.execute(text("SET FOREIGN_KEY_CHECKS=1;"))
                        except:
                            try:
                                db.session.execute(text("PRAGMA foreign_keys = ON;"))
                            except:
                                pass
                    else:
                        equip.site_name = site_name
                        equip.name = e_name
                        equip.serial = e_serial
                        equip.cust_equip_name = cust_name

                    # 2. 상세 스펙 정보 및 셋업 매핑 갱신
                    equip.special_note = payload.get('special_note', '')
                    
                    setup = SetupInfo.query.filter_by(equip_id=db_new_id).first()
                    if not setup and db_old_id != db_new_id:
                        setup = SetupInfo.query.filter_by(equip_id=db_old_id).first()
                        if setup:
                            setup.equip_id = db_new_id
                            
                    if not setup:
                        setup = SetupInfo(equip_id=db_new_id)
                        db.session.add(setup)
                        
                    s_data = payload.get('setup', {})
                    setup.cust_equip_name = s_data.get('custEquipName', '')
                    setup.project_no = s_data.get('projectNo', '')
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
                del_id = str(payload['id'])
                del_site = str(payload.get('site', ''))
                raw_target_id = f"{del_site}::{del_id}"
                
                target_equip_id = resolve_master_equip_id(raw_target_id)
                if not target_equip_id or target_equip_id == raw_target_id:
                    target_equip_id = resolve_master_equip_id(del_id)

                db.session.execute(text("DELETE FROM equipment WHERE id=:i1 OR id=:i2 OR id=:i3"), {
                    'i1': target_equip_id,
                    'i2': raw_target_id,
                    'i3': del_id
                })
                
                # 정규화 ID 비교 기반 2차 안전 삭제
                norm_del1 = normalize_key(raw_target_id)
                norm_del2 = normalize_key(target_equip_id)
                if norm_del1 or norm_del2:
                    all_eqs = Equipment.query.all()
                    for eq in all_eqs:
                        eq_norm = normalize_key(eq.id)
                        if (norm_del1 and eq_norm == norm_del1) or (norm_del2 and eq_norm == norm_del2):
                            db.session.delete(eq)

        elif domain == 'item':
            if action == 'CREATE' or action == 'UPDATE':
                item = AdminItem.query.filter_by(id=str(payload['id'])).first()
                old_code = item.code if item else None
                old_part = item.part if item else None
                
                new_code = payload.get('code', '')
                new_part = payload.get('part', '')
                
                if not item: 
                    db.session.add(AdminItem(id=str(payload['id'])))
                
                db.session.execute(text("UPDATE admin_item SET detail_type=:dt, additional=:add, partno=:pn, code=:cd, part=:pt, spec=:sp, equip=:eq WHERE id=:i"), {'dt':payload.get('detailType',''), 'add':payload.get('additional',''), 'pn':payload.get('partno',''), 'cd':payload.get('code',''), 'pt':payload.get('part',''), 'sp':payload.get('spec',''), 'eq':payload.get('equip',''), 'i':str(payload['id'])})
                
                # UPDATE 시 코드명이나 물품명이 변경된 경우, 기존 등록/완료된 작업의 물품 정보 일괄 동기화
                if action == 'UPDATE' and item and (old_code != new_code or old_part != new_part):
                    # 1. MaintItem code 필드 업데이트
                    if old_code and old_code != new_code:
                        MaintItem.query.filter_by(code=old_code).update({MaintItem.code: new_code})
                    
                    # 2. MaintItem content 필드 업데이트
                    maint_items = MaintItem.query.all()
                    for m in maint_items:
                        if m.content:
                            updated_content = update_content_part(m.content, old_code, new_code, old_part, new_part)
                            if updated_content != m.content:
                                m.content = updated_content
                                
                    # 3. LogItem content 필드 업데이트
                    log_items = LogItem.query.all()
                    for l in log_items:
                        if l.content:
                            updated_content = update_content_part(l.content, old_code, new_code, old_part, new_part)
                            if updated_content != l.content:
                                l.content = updated_content
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
        # [추가] 500 에러 발생 시 정확한 원인 파악을 위해 상세 에러 로그 기록
        app.logger.error(f"Admin CRUD Error ({domain} - {action}): {str(e)}", exc_info=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] 장비 ID 지능형 점수 기반 다원 일치 보정 헬퍼 함수
def resolve_master_equip_id(equip_id):
    if not equip_id or not isinstance(equip_id, str):
        return equip_id
    
    import unicodedata, re
    clean_id = unicodedata.normalize('NFC', str(equip_id).strip()).rstrip(':').strip()

    def normalize_key(val):
        if not val:
            return ""
        return re.sub(r'[^a-zA-Z0-9가-힣]', '', str(val)).lower()

    # 1. DB에 완벽히 동일한 ID로 있는 경우 즉시 반환
    exact = Equipment.query.filter_by(id=clean_id).first()
    if exact:
        return exact.id

    # [추가] 연속된 콜론(:::) 축소 ID로 2차 DB 직접 매칭
    collapsed_id = re.sub(r':{2,}', '::', clean_id)
    collapsed_exact = Equipment.query.filter_by(id=collapsed_id).first()
    if collapsed_exact:
        return collapsed_exact.id

    all_equips = Equipment.query.all()
    if not all_equips:
        return clean_id

    # [추가] SystemSetting에서 모델명 <-> 약어 매핑 맵 구축
    model_alias_map = {}
    try:
        setting = SystemSetting.query.filter_by(key='equipment_models').first()
        if setting and setting.value:
            import json
            models_data = json.loads(setting.value)
            if isinstance(models_data, list):
                for m in models_data:
                    if isinstance(m, dict):
                        n = normalize_key(m.get('name'))
                        a = normalize_key(m.get('abbr'))
                        if n and a:
                            model_alias_map[n] = a
                            model_alias_map[a] = n
    except Exception as e:
        app.logger.warning(f"Failed to load equipment_models setting: {e}")

    # [추가] 특수문자/공백/콜론 개수 차이 및 모델명 약어 매칭 흡수를 위한 정규화 ID 1:1 매칭
    norm_clean_id = normalize_key(clean_id)
    if norm_clean_id:
        for cand in all_equips:
            cand_norm_id = normalize_key(cand.id)
            if cand_norm_id == norm_clean_id:
                app.logger.info(f"[Master Equip Direct Resolve] '{equip_id}' -> '{cand.id}'")
                return cand.id
            # 모델명 약어 치환 정규화 매칭 시도
            if model_alias_map:
                for k, v in model_alias_map.items():
                    if k in norm_clean_id and cand_norm_id == norm_clean_id.replace(k, v):
                        app.logger.info(f"[Master Equip Alias Resolve] '{equip_id}' -> '{cand.id}'")
                        return cand.id

    # 2. 콜론(::) 파싱 및 비어있지 않은 토큰 추출
    raw_tokens = [p.strip() for p in clean_id.split('::') if p and p.strip()]
    if not raw_tokens:
        return clean_id

    # [추가] 4개 이상 복합 토큰 및 모델명 약어 치환 토큰 조합(Token Subsets) 직접 1:1 DB 탐색
    if len(raw_tokens) >= 2:
        site_tok = raw_tokens[0]
        model_tok = raw_tokens[1]
        model_alias = model_alias_map.get(normalize_key(model_tok), "")

        # 사업장 변형 리스트 구축 (예: SCS 서안 vs SCS)
        sites_to_try = [site_tok]
        norm_s = normalize_key(site_tok)
        for cand in all_equips:
            if cand.site_name:
                cand_s_norm = normalize_key(cand.site_name)
                if cand_s_norm and (cand_s_norm == norm_s or cand_s_norm in norm_s or norm_s in cand_s_norm):
                    if cand.site_name not in sites_to_try:
                        sites_to_try.append(cand.site_name)

        models_to_try = [model_tok]
        if model_alias and model_alias != normalize_key(model_tok):
            setting = SystemSetting.query.filter_by(key='equipment_models').first()
            if setting and setting.value:
                try:
                    import json
                    m_data = json.loads(setting.value)
                    for m in m_data:
                        if isinstance(m, dict):
                            if normalize_key(m.get('abbr')) == normalize_key(model_tok) and m.get('name'):
                                models_to_try.append(m.get('name'))
                            elif normalize_key(m.get('name')) == normalize_key(model_tok) and m.get('abbr'):
                                models_to_try.append(m.get('abbr'))
                except Exception:
                    pass

        # 1) site + model + last_token (시리얼/고객사 장비명 위치) 탐색
        for s_try in sites_to_try:
            for m_try in models_to_try:
                for last_idx in range(len(raw_tokens) - 1, 1, -1):
                    try_id = f"{s_try}::{m_try}::{raw_tokens[last_idx]}"
                    found = Equipment.query.filter_by(id=try_id).first()
                    if found:
                        app.logger.info(f"[Master Equip Subset Resolve] '{equip_id}' -> '{found.id}'")
                        return found.id

        # 2) site + model 단독 ID 탐색
        for s_try in sites_to_try:
            for m_try in models_to_try:
                try_id = f"{s_try}::{m_try}"
                found = Equipment.query.filter_by(id=try_id).first()
                if found:
                    app.logger.info(f"[Master Equip Model-Only Resolve] '{equip_id}' -> '{found.id}'")
                    return found.id

    norm_tokens = [normalize_key(t) for t in raw_tokens if normalize_key(t)]
    if not norm_tokens:
        return clean_id

    invalid_serials = ['na', 'none', 'null', 'undefined', '없음', '-']

    # [추가] 컬럼별 직접 일치 보정 (사업장 + 시리얼/고객사 장비명 1:1 일치 장비 구출)
    site_tok_norm = normalize_key(raw_tokens[0])
    valid_toks = [t for t in norm_tokens[1:] if t not in invalid_serials and len(t) >= 2]
    if valid_toks:
        for cand in all_equips:
            c_site = normalize_key(cand.site_name)
            if c_site and (c_site == site_tok_norm or c_site in site_tok_norm or site_tok_norm in c_site):
                c_serial = normalize_key(cand.serial)
                si = SetupInfo.query.filter_by(equip_id=cand.id).first()
                c_cust = normalize_key(si.cust_equip_name) if si else ""
                for tok in valid_toks:
                    if (c_serial and tok == c_serial) or (c_cust and tok == c_cust):
                        app.logger.info(f"[Master Equip Field Match Resolve] '{equip_id}' -> '{cand.id}'")
                        return cand.id

    # 3. DB 전체 장비 대상 점수 기반 다원 유사도 매칭
    cand_scores = []
    for cand in all_equips:
        c_site = normalize_key(cand.site_name)
        c_name = normalize_key(cand.name)
        c_serial = normalize_key(cand.serial)
        si = SetupInfo.query.filter_by(equip_id=cand.id).first()
        c_cust = normalize_key(si.cust_equip_name) if si else ""
        c_model = normalize_key(si.model) if si else ""
        c_id = normalize_key(cand.id)

        c_name_alias = model_alias_map.get(c_name, "")
        c_model_alias = model_alias_map.get(c_model, "")

        score = 0
        for tok in norm_tokens:
            if not tok: continue
            if tok == c_site: score += 10
            elif (tok in c_site or (c_site and c_site in tok)) and min(len(tok), len(c_site) if c_site else 0) >= 2: score += 5

            # 모델명 / 약어 / SetupInfo.model 다원 매칭
            if tok == c_name or (c_name_alias and tok == c_name_alias) or tok == c_model or (c_model_alias and tok == c_model_alias): score += 15
            elif (tok in c_name or (c_name and c_name in tok)) or (c_name_alias and (tok in c_name_alias or c_name_alias in tok)) or (tok in c_model or (c_model and c_model in tok)): score += 8

            if tok == c_cust: score += 15
            elif (tok in c_cust or (c_cust and c_cust in tok)) and min(len(tok), len(c_cust) if c_cust else 0) >= 2: score += 8

            if tok == c_serial and tok not in invalid_serials: score += 15
            elif (tok in c_serial or (c_serial and c_serial in tok)) and tok not in invalid_serials and min(len(tok), len(c_serial) if c_serial else 0) >= 3: score += 8

            if (tok and tok in c_id) or (c_id and c_id in tok): score += 5

        if score > 0:
            cand_scores.append((score, cand))

    if cand_scores:
        cand_scores.sort(key=lambda x: x[0], reverse=True)
        best_score, best_cand = cand_scores[0]
        app.logger.info(f"[Master Equip Resolve] '{equip_id}' -> '{best_cand.id}' (Score: {best_score})")
        return best_cand.id

    return clean_id

# [추가] 유지관리 및 캘린더 장비 이력 100% DB 동기화 전용 트랜잭션 API
@app.route('/api/history/transaction', methods=['POST'])
@login_required
@limiter.exempt
def history_transaction():
    data = request.json
    equip_id = data.get('equip_id')
    maint_upserts = data.get('maint_upserts', [])
    maint_deletes = data.get('maint_deletes', [])
    log_upserts = data.get('log_upserts', [])
    log_deletes = data.get('log_deletes', [])

    # [추가] 외래 키 충돌 방지를 위한 equip_id 지능형 보정 장치
    if equip_id:
        equip_id = resolve_master_equip_id(equip_id)

    # [Rule 3 준수] DB에 등록되지 않은 마스터 장비 데이터 자동 생성 차단
    if equip_id and not Equipment.query.filter_by(id=equip_id).first():
        app.logger.warning(f"[Rule 3] 등록되지 않은 마스터 장비 차단: {equip_id}")
        return jsonify({'status': 'fail', 'message': f'등록되지 않은 마스터 장비 데이터입니다 ({equip_id}). ADMIN에서 장비를 수동으로 등록해주세요.'}), 400

    try:
        if maint_deletes:
            MaintItem.query.filter(MaintItem.id.in_(maint_deletes)).delete(synchronize_session=False)
        
        for idx, m in enumerate(maint_upserts):
            m_id = str(m['id'])
            item = MaintItem.query.filter_by(id=m_id).first()
            if not item:
                item = MaintItem(id=m_id, equip_id=equip_id)
                db.session.add(item)
            item.sort_order = idx
            item.type = m.get('type', item.type)
            item.detail_type = m.get('detailType', item.detail_type)
            item.code = m.get('code', item.code)
            item.content = m.get('content', item.content)
            item.spec = m.get('spec', item.spec)
            item.date = m.get('date', item.date)
            item.period = str(m.get('period')) if m.get('period') is not None else item.period
            item.scheduled_date = m.get('scheduledDate', item.scheduled_date)
            item.cost_type = m.get('costType', item.cost_type)
            item.worker = m.get('worker', item.worker)
            item.md = str(m.get('md', item.md))
            item.item_cost = m.get('itemCost', item.item_cost)
            item.memo = m.get('memo', item.memo)
            item.original_log_id = str(m.get('originalLogId')) if m.get('originalLogId') else item.original_log_id

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
            item.start_time = l.get('startTime', item.start_time)
            item.end_time = l.get('endTime', item.end_time)
            item.is_issue_shared = bool(l.get('isIssueShared', item.is_issue_shared))
            item.original_log_id = str(l.get('originalLogId')) if l.get('originalLogId') else item.original_log_id
            item.add_work_log_id = str(l.get('addWorkLogId')) if l.get('addWorkLogId') else item.add_work_log_id

        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"History Transaction Error: {str(e)}", exc_info=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] 셋업 화면 데이터 전용 100% DB 동기화 API
@app.route('/api/setup/sync_equip', methods=['POST'])
@login_required
@limiter.exempt
def sync_setup_equip():
    data = request.json
    equip_id = data.get('equip_id')
    details = data.get('details') # 리스트 형태 (없으면 None)
    logs = data.get('logs') # 리스트 형태 (없으면 None)

    try:
        # [디버깅 로깅]
        app.logger.warning(f"[Sync Setup] Received raw equip_id: {equip_id}")
        
        # URL 디코딩 및 한글 유니코드 자모분리 정규화
        if equip_id:
            import urllib.parse
            import unicodedata
            equip_id = urllib.parse.unquote(equip_id).strip()
            equip_id = unicodedata.normalize('NFC', equip_id)
            app.logger.warning(f"[Sync Setup] Unquoted and NFC normalized equip_id: {equip_id}")

        # [수정] DB에 등록되지 않은 장비(Equipment)인 경우 임의 자동 생성을 금지하고 에러 처리
        if equip_id:
            equip = Equipment.query.filter_by(id=equip_id).first()
            if not equip:
                equip = Equipment.query.filter(Equipment.id.like(f"{equip_id}%")).first()
            
            # [디버깅 & 유사도 전파 복구 (자모분리 정규화, 공백 정규화 및 컴포넌트 단위 정밀 대조 적용)]
            if not equip:
                all_equips = Equipment.query.all()
                all_ids = [eq.id for eq in all_equips]
                app.logger.warning(f"[Sync Setup] Match failed. Available database equipment IDs: {all_ids}")
                
                import unicodedata
                # 수신 ID 컴포넌트 분리 및 정규화
                norm_equip_id = unicodedata.normalize('NFC', equip_id)
                parts_equip = [unicodedata.normalize('NFC', p.strip()) for p in norm_equip_id.split('::')]
                parts_equip_clean = [" ".join(p.split()) for p in parts_equip if p]
                
                # 메모리 상의 장비 객체들과 컴포넌트별 매칭 시도
                for eq in all_equips:
                    norm_db_id = unicodedata.normalize('NFC', eq.id)
                    parts_db = [unicodedata.normalize('NFC', p.strip()) for p in norm_db_id.split('::')]
                    parts_db_clean = [" ".join(p.split()) for p in parts_db if p]
                    
                    # 사업장, 모델, 시리얼 등 앞의 컴포넌트 단계들이 정확히 일치하는지 비교 (최소 3단계 대조)
                    min_len = min(len(parts_equip_clean), len(parts_db_clean))
                    if min_len >= 3:
                        match = True
                        for idx in range(min_len):
                            # 만약 앞부분 3단계 중 하나라도 틀리면 매칭 실패
                            if parts_equip_clean[idx] != parts_db_clean[idx]:
                                match = False
                                break
                        if match:
                            equip = eq
                            app.logger.warning(f"[Sync Setup] Recovered match via components similarity: {eq.id}")
                            break

            if not equip:
                return jsonify({"status": "fail", "message": f"등록되지 않은 장비 정보입니다. ADMIN 메뉴에서 해당 장비를 먼저 등록해주세요. (ID: {equip_id})"}), 400
            
            # 실제 DB에 저장된 정식 ID(예: Site::Model::Serial::CustName)로 덮어쓰기
            equip_id = equip.id
            app.logger.warning(f"[Sync Setup] Final resolved equip_id: {equip_id}")

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
                    content=sl.get('content', ''), company=sl.get('company', ''), memo=sl.get('memo', ''),
                    md=str(sl.get('md', '0')), parts=sl.get('parts', '')
                ))
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Setup DB Sync Error: {str(e)}", exc_info=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] Trouble 이력 리스트 조회 API
@app.route('/api/trouble/list', methods=['GET'])
@login_required
def get_trouble_list():
    troubles = TroubleLog.query.all()
    # [수정] 작업 구분(type)이 '비정기'인 모든 완료 이력을 공백 제거하여 누락 없이 완벽하게 가져옴
    log_items = LogItem.query.filter(db.func.trim(LogItem.type) == '비정기').all()
    
    equips = {eq.id: eq for eq in Equipment.query.all()}
    setup_infos = {si.equip_id: si for si in SetupInfo.query.all()}
    
    def get_eq_info(equip_id):
        if equip_id:
            eq = equips.get(equip_id)
            si = setup_infos.get(equip_id)
            cust_name = si.cust_equip_name if si and si.cust_equip_name else ""
            if eq:
                equip_name = f"{eq.name}"
                if cust_name:
                    equip_name += f" [{cust_name}]"
                elif eq.serial:
                    equip_name += f" ({eq.serial})"
                return eq.site_name, equip_name
            else:
                parts = equip_id.split('::')
                return parts[0], parts[1] if len(parts) > 1 else ""
        return "", ""

    result = []
    for t in troubles:
        site_name, equip_name = get_eq_info(t.equip_id)

        # [복구] 기존에 잘못된 포맷(파이썬 딕셔너리 문자열)으로 저장된 경우 JSON 포맷으로 강제 변환
        safe_content = t.content
        if safe_content and safe_content.startswith("{") and "'" in safe_content and '"' not in safe_content:
            safe_content = safe_content.replace("'", '"')
            
        result.append({
            "id": t.id,
            "source": "trouble",
            "equip_id": t.equip_id,
            "site": site_name,
            "equip": equip_name,
            "occur_date": t.occur_date,
            "action_date": getattr(t, 'action_date', ''),
            "type": "-",
            "detail_type": "-",
            "detail_type2": "-",
            "check_item": "-",
            "content": safe_content,
            "memo": getattr(t, 'memo', ''), # [추가] 진행 경과 반환
            "worker": t.worker,
            "status": t.status,
            "image_data": t.image_data,
            "group_key": f"trouble_{t.id}"
        })
        
    for l in log_items:
        site_name, equip_name = get_eq_info(l.equip_id)
        orig_id = str(getattr(l, 'original_log_id', '') or '').strip()
        add_work_id = str(getattr(l, 'add_work_log_id', '') or '').strip()
        l_id = str(l.id or '').strip()

        date_str = str(l.date or getattr(l, 'trouble_occur_date', '') or '').strip()[:10]
        clean_memo = str(l.memo or '').strip()
        clean_worker = str(l.worker or '').strip()
        clean_dt = str(l.detail_type or '').strip()
        clean_type = str(l.type or '비정기').strip()

        if orig_id:
            group_key = f"log_parent_{orig_id}"
        elif add_work_id:
            group_key = f"log_parent_{add_work_id}"
        elif clean_memo or clean_dt:
            group_key = f"task_{l.equip_id}_{date_str}_{clean_type}_{clean_dt}_{clean_worker}_{clean_memo}"
        else:
            group_key = f"log_{l_id}"

        safe_content = getattr(l, 'trouble_details', '') or ''
        result.append({
            "id": l_id,
            "source": "log",
            "equip_id": l.equip_id,
            "site": site_name,
            "equip": equip_name,
            "occur_date": getattr(l, 'trouble_occur_date', ''),
            "action_date": l.date,
            "type": l.type,
            "detail_type": l.detail_type,
            "detail_type2": l.detail_type2,
            "check_item": l.content,
            "content": safe_content,
            "memo": l.memo,
            "worker": l.worker,
            "status": "조치완료",
            "image_data": getattr(l, 'image_data', ''),
            "group_key": group_key,
            "original_log_id": orig_id if orig_id else None
        })
        
    grouped = {}
    # [수정] 최초작업(original_log_id가 없는 항목)이 대표 항목으로 무조건 우선 등록되도록 정렬
    def item_priority(x):
        is_child = 1 if (str(x.get('original_log_id') or '').strip() != '') else 0
        return is_child

    result.sort(key=item_priority)

    for item in result:
        key = item['group_key']
        if key not in grouped:
            grouped[key] = item
            grouped[key]['_check_items'] = set([x.strip() for x in str(item['check_item']).split(',') if x.strip() and x.strip() != '-'])
            grouped[key]['_raw_items'] = [item]
        else:
            grouped[key]['_raw_items'].append(item)
            for x in str(item['check_item']).split(','):
                x = x.strip()
                if x and x != '-':
                    grouped[key]['_check_items'].add(x)
            
            if item['content'] and str(item['content']).strip() != '' and item['content'] != '-':
                if not grouped[key]['content'] or str(grouped[key]['content']).strip() == '' or grouped[key]['content'] == '-':
                    grouped[key]['content'] = item['content']
                elif item['content'] not in grouped[key]['content']:
                    grouped[key]['content'] += f" | {item['content']}"
            
            # [추가] 병합 시 이미지 데이터 우선 보존
            if item.get('image_data'):
                if not grouped[key].get('image_data'):
                    grouped[key]['image_data'] = item['image_data']

    final_result = []
    for item in grouped.values():
        check_items = list(item['_check_items'])
        if check_items:
            item['check_item'] = ", ".join(check_items)
        else:
            item['check_item'] = "-"
        del item['_check_items']
        
        if not item['content'] or str(item['content']).strip() == "":
            item['content'] = "-"
            
        # [추가] memo 병합 처리
        raw_items = item.get('_raw_items', [])
        if len(raw_items) > 1:
            # 부모(original_log_id 가 없는 것)를 최우선, 나머지는 날짜순 정렬
            def sort_key(x):
                has_parent = 1 if (x.get('original_log_id') or '') != '' else 0
                date_val = x.get('action_date') or x.get('occur_date') or ''
                return (has_parent, date_val)
            
            raw_items.sort(key=sort_key)
            
            memos = []
            add_work_idx = 1
            for idx, r_item in enumerate(raw_items):
                m_val = str(r_item.get('memo') or '').strip()
                if m_val and m_val != '-':
                    # 작업일 추출
                    date_val = r_item.get('action_date') or r_item.get('occur_date') or ''
                    if len(date_val) >= 10:
                        date_val = date_val[:10]
                    
                    # 작업자 정보 추출
                    worker_val = str(r_item.get('worker') or '').strip()
                    if worker_val and worker_val != '-':
                        date_suffix = f" ({date_val} / {worker_val})" if date_val else f" ({worker_val})"
                    else:
                        date_suffix = f" ({date_val})" if date_val else ""
                    
                    if m_val.startswith('<최초>') or m_val.startswith('<추가'):
                        memos.append(m_val)
                    elif idx == 0:
                        memos.append(f"<최초>{date_suffix}\n{m_val}")
                    else:
                        memos.append(f"<추가{add_work_idx}>{date_suffix}\n{m_val}")
                        add_work_idx += 1
            
            if memos:
                item['memo'] = "\n\n".join(memos)
            else:
                item['memo'] = ""
        else:
            # 단일 건일 때도 memo가 존재하면 <최초> 포맷 부여
            m_val = str(item.get('memo') or '').strip()
            if m_val and m_val != '-' and not m_val.startswith('<최초>') and not m_val.startswith('<추가'):
                date_val = item.get('action_date') or item.get('occur_date') or ''
                if len(date_val) >= 10:
                    date_val = date_val[:10]
                
                worker_val = str(item.get('worker') or '').strip()
                if worker_val and worker_val != '-':
                    date_suffix = f" ({date_val} / {worker_val})" if date_val else f" ({worker_val})"
                else:
                    date_suffix = f" ({date_val})" if date_val else ""
                
                item['memo'] = f"<최초>{date_suffix}\n{m_val}"
                
        if '_raw_items' in item:
            del item['_raw_items']
            
        final_result.append(item)
        
    final_result.sort(key=lambda x: x.get('action_date') or x.get('occur_date') or '', reverse=True)
    
    return jsonify({"status": "success", "data": final_result})

# [추가] Trouble 이력 CRUD(등록/수정/삭제) 통합 API
@app.route('/api/trouble/crud', methods=['POST'])
@login_required
@limiter.exempt
def trouble_crud():
    data = request.json
    action = data.get('action')
    payload = data.get('payload')
    user = User.query.filter_by(id=session.get('user_id')).first()
    worker_name = user.name if user and user.name else session.get('user_id')
    
    try:
        if action == 'CREATE':
            content_val = payload.get('content', '')
            if isinstance(content_val, (dict, list)):
                content_val = json.dumps(content_val, ensure_ascii=False)
            else:
                content_val = str(content_val) if content_val is not None else ''

            new_log = TroubleLog(
                id=str(payload.get('id')), 
                equip_id=payload.get('equip_id'), 
                occur_date=payload.get('occur_date', ''), 
                action_date=payload.get('action_date', ''), 
                content=content_val, 
                memo=payload.get('memo', ''), 
                worker=payload.get('worker', ''), 
                status=payload.get('status', '조치중'), 
                image_data=payload.get('image_data', '')
            )
            db.session.add(new_log)
            db.session.add(SystemLog(action='ADD_TROUBLE', target=payload.get('equip_id'), details="Trouble 등록", worker=worker_name))
        elif action == 'UPDATE':
            source = payload.get('source', 'trouble')
            if source == 'trouble':
                log = TroubleLog.query.filter_by(id=str(payload.get('id'))).first()
                if log:
                    # [수정] 필드별 명시적 업데이트 (content와 memo의 데이터 교차 덮어쓰기 버그 방지)
                    if 'equip_id' in payload: log.equip_id = payload.get('equip_id')
                    if 'occur_date' in payload: log.occur_date = payload.get('occur_date')
                    if 'action_date' in payload: log.action_date = payload.get('action_date')
                    if 'content' in payload: 
                        c_val = payload.get('content')
                        if isinstance(c_val, (dict, list)):
                            log.content = json.dumps(c_val, ensure_ascii=False)
                        else:
                            log.content = str(c_val) if c_val is not None else ''
                    if 'memo' in payload: log.memo = payload.get('memo') # 세부 내용 (우측 메모장)
                    if 'worker' in payload: log.worker = payload.get('worker')
                    if 'status' in payload: log.status = payload.get('status')
                    if 'image_data' in payload: log.image_data = payload.get('image_data')
                        
                    db.session.add(SystemLog(action='UPDATE_TROUBLE', target=log.equip_id, details="Trouble 수정", worker=worker_name))
            elif source == 'log':
                log_item = LogItem.query.filter_by(id=str(payload.get('id'))).first()
                if log_item:
                    if 'action_date' in payload: log_item.date = payload.get('action_date', log_item.date)
                    if 'occur_date' in payload: log_item.trouble_occur_date = payload.get('occur_date', '')

                    if 'content' in payload: 
                        c_val = payload.get('content')
                        if isinstance(c_val, (dict, list)):
                            log_item.trouble_details = json.dumps(c_val, ensure_ascii=False)
                        else:
                            log_item.trouble_details = str(c_val) if c_val is not None else ''

                    if 'image_data' in payload:
                        log_item.image_data = payload.get('image_data', log_item.image_data)
                    db.session.add(SystemLog(action='UPDATE_LOG', target=log_item.equip_id, details=f"점검 이력 수정(Trouble 팝업): {log_item.memo}", worker=worker_name))
            elif source == 'maint':
                maint_item = MaintItem.query.filter_by(id=str(payload.get('id'))).first()
                if maint_item:
                    if 'action_date' in payload: 
                        maint_item.date = payload.get('action_date', maint_item.date)
                        maint_item.scheduled_date = payload.get('action_date', maint_item.scheduled_date)
                    if 'occur_date' in payload: maint_item.trouble_occur_date = payload.get('occur_date', '')

                    if 'content' in payload: 
                        c_val = payload.get('content')
                        if isinstance(c_val, (dict, list)):
                            maint_item.trouble_details = json.dumps(c_val, ensure_ascii=False)
                        else:
                            maint_item.trouble_details = str(c_val) if c_val is not None else ''

                    if 'image_data' in payload:
                        maint_item.image_data = payload.get('image_data', maint_item.image_data)
                    db.session.add(SystemLog(action='UPDATE_MAINT', target=maint_item.equip_id, details=f"예정 작업 수정(Trouble 팝업): {maint_item.memo}", worker=worker_name))
        elif action == 'DELETE':
            log = TroubleLog.query.filter_by(id=str(payload.get('id'))).first()
            if log:
                equip_id = log.equip_id; content = log.content
                db.session.delete(log)
                db.session.add(SystemLog(action='DELETE_TROUBLE', target=equip_id, details=f"Trouble 삭제: {content}", worker=worker_name))
            
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Trouble CRUD Error ({action}): {str(e)}", exc_info=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] DB 연결 상태 확인용 디버그 API (브라우저 확인용)
@app.route('/api/debug/db-check', methods=['GET'])
@csrf.exempt
def db_connection_check():
    try:
        from sqlalchemy import text
        db.session.execute(text('SELECT 1'))
        equip_count = Equipment.query.count()
        user_count = User.query.count()
        return jsonify({
            "status": "success",
            "message": "데이터베이스 연결 상태가 양호합니다.",
            "db_type": os.environ.get('DB_TYPE', 'sqlite'),
            "stats": {
                "total_equipments": equip_count,
                "total_users": user_count
            }
        }), 200
    except Exception as e:
        app.logger.error(f"DB Connection Check Failed: {str(e)}")
        return jsonify({
            "status": "fail",
            "message": "데이터베이스 연결에 실패했습니다.",
            "error_detail": str(e)
        }), 500


# [추가] 프론트엔드 작업 보안 감사 로그 API (CSV 내보내기 등)
@app.route('/api/log/action', methods=['POST'])
@login_required
def audit_log_action():
    data = request.json or {}
    action_val = data.get('action')
    details_val = data.get('details', '')
    target_val = data.get('target', '')
    
    if not action_val:
        return jsonify({"status": "fail", "message": "작업 유형(action)이 누락되었습니다."}), 400
        
    user = User.query.filter_by(id=session.get('user_id')).first()
    worker_name = user.name if user and user.name else session.get('user_id')
    
    try:
        audit_log = SystemLog(
            action=action_val,
            target=target_val,
            details=details_val,
            worker=worker_name
        )
        db.session.add(audit_log)
        db.session.commit()
        return jsonify({"status": "success"}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Audit log writing failed: {str(e)}")
        return jsonify({"status": "fail", "message": "로그 기록 실패"}), 500

# [추가] 특정 작업에 대한 연관 추가 작업 조회 API
@app.route('/api/maintenance/additional-works', methods=['GET'])
@login_required
def get_additional_works():
    parent_id = request.args.get('parent_id')
    if not parent_id:
        return jsonify({"status": "fail", "message": "부모 작업 ID(parent_id)가 누락되었습니다."}), 400
        
    try:
        additional_maint = MaintItem.query.filter_by(original_log_id=str(parent_id)).all()
        additional_logs = LogItem.query.filter_by(original_log_id=str(parent_id)).all()
        
        result = []
        for m in additional_maint:
            result.append({
                "id": m.id,
                "date": m.scheduled_date or m.date,
                "type": m.type,
                "detail_type": m.detail_type,
                "content": m.content,
                "worker": m.worker,
                "status": "예정",
                "memo": m.memo or ""
            })
            
        for l in additional_logs:
            result.append({
                "id": l.id,
                "date": l.date,
                "type": l.type,
                "detail_type": l.detail_type,
                "content": l.content,
                "worker": l.worker,
                "status": "완료",
                "memo": l.memo or ""
            })
            
        result.sort(key=lambda x: x['date'], reverse=True)
        return jsonify({"status": "success", "data": result}), 200
    except Exception as e:
        app.logger.error(f"Failed to query additional works: {str(e)}")
        return jsonify({"status": "fail", "message": "추가 작업 조회 중 오류 발생"}), 500

# ------------------------------------------------------------------------------
# 8. 앱 초기화 및 실행 (Initialization & Main Execution)
# ------------------------------------------------------------------------------
def migrate_db_to_four_fields():
    """
    기존 3개 필드 식별 장비(Site::Name::Serial) 데이터를 4개 필드 식별 장비(Site::Name::Serial::CustEquipName) 형태로 마이그레이션합니다.
    또한, 부모 장비가 없는 고아(Orphaned) 이력 데이터를 해당 사업장의 '기타(ETC)' 장비로 재매핑하여 복구합니다.
    """
    try:
        # 1. 기타(ETC) 장비 ID 규격 변경 (Site::기타(ETC) -> Site::기타(ETC)::::)
        equips = Equipment.query.all()
        setup_infos = {si.equip_id: si for si in SetupInfo.query.all()}
        # 외래키 무결성 제약조건으로 인한 에러 방지를 위해 connection 수준에서 임시로 FOREIGN KEY 검사를 끕니다. (MySQL 및 SQLite 호환)
        try:
            db.session.execute(text("SET FOREIGN_KEY_CHECKS=0;"))
            db.session.commit()
        except:
            try:
                db.session.execute(text("PRAGMA foreign_keys = OFF;"))
                db.session.commit()
            except:
                pass
        
        # 2. 고아 데이터(Orphaned data)를 찾기 위한 기존 장비 목록 집합
        existing_equip_ids = {eq.id for eq in equips}
        
        # 3. 각 장비 순회하며 ID 마이그레이션 수행
        for eq in equips:
            si = setup_infos.get(eq.id)
            cust_equip_name = si.cust_equip_name if si else ""
            
            # 기존 ID 형식 파싱
            site_prefix = f"{eq.site_name}::"
            eq_name_serial = eq.id[len(site_prefix):] if str(eq.id).startswith(site_prefix) else eq.id
            parts = eq_name_serial.split('::')
            e_name = parts[0] if len(parts) > 0 else ""
            e_serial = parts[1] if len(parts) > 1 else ""
            
            # 이미 4가지 항목이 적용되어 key가 'Name::Serial::CustEquipName' 구조인 경우 (parts 크기가 3) 스킵
            if len(parts) >= 3:
                continue
                
            # 신규 ID 생성 (Site::Name::Serial::CustEquipName)
            if e_name == "기타(ETC)":
                new_eq_id = f"{eq.site_name}::기타(ETC)::::"
            else:
                new_eq_id = f"{eq.site_name}::{e_name}::{e_serial}::{cust_equip_name}"
                
            old_eq_id = eq.id
            if old_eq_id != new_eq_id:
                # 대상 신규 ID(new_eq_id)가 이미 존재하는지 검사
                exists = db.session.execute(
                    text("SELECT 1 FROM equipment WHERE id=:new_id"),
                    {"new_id": new_eq_id}
                ).fetchone()

                if exists:
                    # 1. 이미 존재한다면 하위 연관 데이터들의 equip_id만 new_eq_id로 업데이트(병합)
                    db.session.execute(
                        text("UPDATE setup_info SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE maint_item SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE log_item SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE setup_detail SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE setup_log SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE trouble_log SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    # 2. 기존 중복된 구버전 부모 레코드 삭제
                    db.session.execute(
                        text("DELETE FROM setup_info WHERE equip_id=:old_id"),
                        {"old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("DELETE FROM equipment WHERE id=:old_id"),
                        {"old_id": old_eq_id}
                    )
                else:
                    # 존재하지 않는다면 정상적으로 부모 및 하위 레코드 ID 갱신
                    db.session.execute(
                        text("UPDATE equipment SET id=:new_id WHERE id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE setup_info SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE maint_item SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE log_item SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE setup_detail SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE setup_log SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                    db.session.execute(
                        text("UPDATE trouble_log SET equip_id=:new_id WHERE equip_id=:old_id"),
                        {"new_id": new_eq_id, "old_id": old_eq_id}
                    )
                db.session.commit()
                
        # 4. 고아 데이터 복구 (MaintItem, LogItem, SetupDetail, SetupLog, TroubleLog 등)
        updated_equips = Equipment.query.all()
        updated_equip_ids = {eq.id for eq in updated_equips}
        
        def recover_orphans(model_class, table_name):
            orphans = model_class.query.filter(~model_class.equip_id.in_(list(updated_equip_ids))).all()
            for orphan in orphans:
                old_id = orphan.equip_id
                parts = old_id.split('::') if old_id else []
                site_name = parts[0] if len(parts) > 0 else "기타사업장"
                fallback_id = f"{site_name}::기타(ETC)::::"
                
                if not Equipment.query.filter_by(id=fallback_id).first():
                    if not Site.query.filter_by(name=site_name).first():
                        db.session.add(Site(name=site_name, buildings='[]'))
                        db.session.flush()
                    db.session.add(Equipment(id=fallback_id, site_name=site_name, name="기타(ETC)", serial=""))
                    db.session.add(SetupInfo(equip_id=fallback_id, cust_equip_name="", model=""))
                    db.session.flush()
                    updated_equip_ids.add(fallback_id)
                
                db.session.execute(
                    text(f"UPDATE {table_name} SET equip_id=:fallback_id WHERE equip_id=:old_id"),
                    {"fallback_id": fallback_id, "old_id": old_id}
                )
            db.session.commit()
            
        recover_orphans(MaintItem, "maint_item")
        recover_orphans(LogItem, "log_item")
        recover_orphans(SetupDetail, "setup_detail")
        recover_orphans(SetupLog, "setup_log")
        recover_orphans(TroubleLog, "trouble_log")
        
        try:
            db.session.execute(text("SET FOREIGN_KEY_CHECKS=1;"))
            db.session.commit()
        except:
            try:
                db.session.execute(text("PRAGMA foreign_keys = ON;"))
                db.session.commit()
            except:
                pass
        print("[*] DB Migration to 4-field equipment matching completed successfully.")
    except Exception as e:
        db.session.rollback()
        try:
            db.session.execute(text("SET FOREIGN_KEY_CHECKS=1;"))
            db.session.commit()
        except:
            try:
                db.session.execute(text("PRAGMA foreign_keys = ON;"))
                db.session.commit()
            except:
                pass
        print(f"[x] DB Migration Error: {str(e)}")
        app.logger.error(f"DB Migration Error: {str(e)}", exc_info=True)

def init_db():
    with app.app_context():
        db.create_all()
        
        # [마이그레이션] 기존 site 테이블에 group 컬럼 추가 (사업장 구분)
        try:
            db.session.execute(text('ALTER TABLE site ADD COLUMN `group` VARCHAR(50) DEFAULT \'기타사업장\''))
            db.session.commit()
        except:
            db.session.rollback()

        # [마이그레이션] 기존 user 테이블에 site 컬럼 추가 (DB 업데이트)
        try:
            # [개선] 예약어 충돌 방지를 위해 테이블명을 큰따옴표로 감쌈
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN site VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()
            
        try:
            db.session.execute(text('ALTER TABLE setup_info ADD COLUMN project_no VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()
            
        # [마이그레이션] 기존 user 테이블에 추가 정보 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN department VARCHAR(100)'))
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN position VARCHAR(100)'))
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN name VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()
        
        # [마이그레이션] 비밀번호 변경일(보안) 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN pw_changed_at DATETIME'))
            db.session.commit()
            db.session.execute(text('UPDATE `user` SET pw_changed_at = CURRENT_TIMESTAMP WHERE pw_changed_at IS NULL'))
            db.session.commit()
        except:
            db.session.rollback()
        
        # [마이그레이션] 시스템 로그 테이블에 작업자(worker) 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE system_log ADD COLUMN worker VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()
        
        # [마이그레이션] maint_item 테이블에 spec 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE maint_item ADD COLUMN spec VARCHAR(255)'))
            db.session.commit()
        except:
            db.session.rollback()

        # [마이그레이션] maint_item 테이블에 original_log_id 컬럼 추가 (추가 작업 DB 연동 누락 수정)
        try:
            db.session.execute(text('ALTER TABLE maint_item ADD COLUMN original_log_id VARCHAR(50)'))
            db.session.commit()
        except:
            db.session.rollback()

        # [마이그레이션] maint_item 테이블에 sort_order 컬럼 추가 (드래그 순서 영구 유지용)
        try:
            db.session.execute(text('ALTER TABLE maint_item ADD COLUMN sort_order INT DEFAULT 0'))
            db.session.commit()
        except:
            db.session.rollback()
            
        # [마이그레이션] LogItem 테이블에 startTime, endTime 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE log_item ADD COLUMN start_time VARCHAR(50) DEFAULT ""'))
            db.session.execute(text('ALTER TABLE log_item ADD COLUMN end_time VARCHAR(50) DEFAULT ""'))
            db.session.commit()
        except:
            db.session.rollback()
            
        # [마이그레이션] trouble_log 테이블에 사진 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE trouble_log ADD COLUMN image_data LONGTEXT'))
            db.session.commit()
        except:
            db.session.rollback()
            try:
                db.session.execute(text('ALTER TABLE trouble_log ADD COLUMN image_data TEXT'))
                db.session.commit()
            except:
                db.session.rollback()
            
        # [마이그레이션] trouble_log 테이블에 memo 컬럼 추가 (진행 경과 저장용)
        try:
            db.session.execute(text('ALTER TABLE trouble_log ADD COLUMN memo TEXT DEFAULT ""'))
            db.session.commit()
        except:
            db.session.rollback()
            
        # [마이그레이션] LogItem, MaintItem 테이블에 사진 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE log_item ADD COLUMN image_data LONGTEXT'))
            db.session.commit()
        except:
            db.session.rollback()
            try:
                db.session.execute(text('ALTER TABLE log_item ADD COLUMN image_data TEXT'))
                db.session.commit()
            except: pass
        try:
            db.session.execute(text('ALTER TABLE maint_item ADD COLUMN image_data LONGTEXT'))
            db.session.commit()
        except:
            db.session.rollback()
            try:
                db.session.execute(text('ALTER TABLE maint_item ADD COLUMN image_data TEXT'))
                db.session.commit()
            except: pass
            
        # [마이그레이션] setup_log 테이블에 md, parts 컬럼 추가 (데이터 유실 방지)
        try:
            db.session.execute(text('ALTER TABLE setup_log ADD COLUMN md VARCHAR(50) DEFAULT "0"'))
            db.session.execute(text('ALTER TABLE setup_log ADD COLUMN parts TEXT DEFAULT ""'))
            db.session.commit()
        except:
            db.session.rollback()
        
        # [마이그레이션] LogItem, MaintItem 테이블에 trouble_details 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE log_item ADD COLUMN trouble_details TEXT'))
            db.session.commit()
        except: pass
        try:
            db.session.execute(text('ALTER TABLE maint_item ADD COLUMN trouble_details TEXT'))
            db.session.commit()
        except: pass
        
        # [마이그레이션] trouble_log 테이블에 action_date 컬럼 추가 및 복사
        try:
            db.session.execute(text('ALTER TABLE trouble_log ADD COLUMN action_date VARCHAR(50) DEFAULT ""'))
            db.session.commit()
            db.session.execute(text('UPDATE trouble_log SET action_date = SUBSTR(occur_date, 1, 10) WHERE action_date = "" OR action_date IS NULL'))
            db.session.commit()
        except:
            db.session.rollback()
            
        # [마이그레이션] LogItem, MaintItem 테이블에 trouble_occur_date 컬럼 추가
        try:
            db.session.execute(text('ALTER TABLE log_item ADD COLUMN trouble_occur_date VARCHAR(50) DEFAULT ""'))
            db.session.commit()
        except: pass
        try:
            db.session.execute(text('ALTER TABLE maint_item ADD COLUMN trouble_occur_date VARCHAR(50) DEFAULT ""'))
            db.session.commit()
        except: pass

        # [마이그레이션] 고객대응 > 파티클 필터 교체 작업의 내용을 '[유상] Particle Filter' 로 치환
        try:
            maint_filter_items = MaintItem.query.filter(
                (MaintItem.type == '고객대응') &
                ((MaintItem.detail_type == '파티클 필터 교체') | (MaintItem.detail_type.like('파티클 필터 교체%')))
            ).all()
            maint_changed = False
            for item in maint_filter_items:
                if (item.content or '').strip() != '[유상] Particle Filter' or item.item_cost != '유상':
                    item.content = '[유상] Particle Filter'
                    item.item_cost = '유상'
                    maint_changed = True

            log_filter_items = LogItem.query.filter(
                (LogItem.type == '고객대응') &
                ((LogItem.detail_type == '파티클 필터 교체') | (LogItem.detail_type.like('파티클 필터 교체%')))
            ).all()
            log_changed = False
            for item in log_filter_items:
                if (item.content or '').strip() != '[유상] Particle Filter':
                    item.content = '[유상] Particle Filter'
                    log_changed = True

            if maint_changed or log_changed:
                db.session.commit()
                app.logger.warning("[Migration] 고객대응 > 파티클 필터 교체 데이터의 내용을 '[유상] Particle Filter'로 일괄 마이그레이션 완료!")
        except Exception as ex:
            db.session.rollback()
            app.logger.error(f"[Migration] 고객대응 > 파티클 필터 교체 마이그레이션 실패: {str(ex)}")

        # [마이그레이션] PM 점검(정기) 작업인데 내용(content)에 '파트 이상 교체' 등의 라벨이 붙어 있는 데이터 정제
        try:
            import re
            clean_pattern = re.compile(r'^(?:파트\s*이상\s*\(?(?:교체|수리)\)?|물품\s*이상\s*\(?(?:교체|수리)\)?|파츠\s*이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자\s*이상)\s*-\s*(.*)$', re.IGNORECASE)
            
            # 1. MaintItem 테이블 정제
            maint_items = MaintItem.query.filter(
                (MaintItem.type == '정기') | 
                (MaintItem.detail_type == 'PM 점검') | 
                (MaintItem.detail_type.like('PM 점검%'))
            ).all()
            maint_updated = False
            for item in maint_items:
                if item.content:
                    parts = item.content.split(',')
                    cleaned_parts = []
                    for part in parts:
                        part_str = part.strip()
                        match = clean_pattern.match(part_str)
                        if match:
                            cleaned_parts.append(match.group(1).strip())
                        else:
                            cleaned_parts.append(part_str)
                    new_content = ", ".join(cleaned_parts)
                    if new_content != item.content:
                        item.content = new_content
                        maint_updated = True
            
            # 2. LogItem 테이블 정제
            log_items = LogItem.query.filter(
                (LogItem.type == '정기') | 
                (LogItem.detail_type == 'PM 점검') | 
                (LogItem.detail_type.like('PM 점검%'))
            ).all()
            log_updated = False
            for item in log_items:
                if item.content:
                    parts = item.content.split(',')
                    cleaned_parts = []
                    for part in parts:
                        part_str = part.strip()
                        match = clean_pattern.match(part_str)
                        if match:
                            cleaned_parts.append(match.group(1).strip())
                        else:
                            cleaned_parts.append(part_str)
                    new_content = ", ".join(cleaned_parts)
                    if new_content != item.content:
                        item.content = new_content
                        log_updated = True
            
            if maint_updated or log_updated:
                db.session.commit()
                app.logger.warning("[Migration] PM 점검 정기 데이터 내용에서 '파트 이상 교체' 접두사 라벨 일괄 제거 완료!")
        except Exception as ex:
            db.session.rollback()
            app.logger.error(f"[Migration] PM 점검 정기 데이터 라벨 정제 실패: {str(ex)}")

        # [마이그레이션] 유지관리 물품(MaintItem) 중복 데이터 제거 및 최근 시작일(date) 기준으로 단일화
        try:
            import re
            all_maint = MaintItem.query.all()
            groups = {}
            for item in all_maint:
                eq_id = (item.equip_id or '').strip()
                content = (item.content or '').strip()
                # 비용처리 대괄호 제거
                clean_content = re.sub(r'\[.*?\]\s*', '', content).replace(' ', '').lower()
                clean_code = (item.code or '').replace(' ', '').lower()
                clean_spec = (item.spec or '').replace(' ', '').lower()
                
                # 물품(부품)이 지정되지 않은 일반 작업 일지는 중복 제거 대상에서 제외
                if not clean_code and (not clean_content or clean_content == '내용없음'):
                    continue

                key = (eq_id, clean_content, clean_code, clean_spec)
                groups.setdefault(key, []).append(item)
                
            maint_deleted_count = 0
            for key, items in groups.items():
                if len(items) > 1:
                    # 날짜가 가장 최근인 것 탐색
                    # date 필드 정렬을 위해 빈 문자열은 가장 이전 날짜로 취급
                    def get_sort_key(it):
                        d_val = (it.date or '').strip()
                        s_val = (it.scheduled_date or '').strip()
                        return (d_val or '1970-01-01', s_val or '1970-01-01', it._unique_id)
                    
                    sorted_items = sorted(items, key=get_sort_key, reverse=True)
                    keep_item = sorted_items[0]
                    delete_items = sorted_items[1:]
                    
                    # 지워질 항목 중에 '정기' 타입이 있다면 keep_item을 '정기'로 보존
                    has_regular = any(it.type == '정기' or it.detail_type == 'PM 점검' for it in items)
                    if has_regular:
                        keep_item.type = '정기'
                        if not keep_item.detail_type or 'PM 점검' not in keep_item.detail_type:
                            keep_item.detail_type = 'PM 점검'
                    
                    for dit in delete_items:
                        db.session.delete(dit)
                        maint_deleted_count += 1
            
            if maint_deleted_count > 0:
                db.session.commit()
                app.logger.warning(f"[Migration] 중복된 유지관리 물품 {maint_deleted_count}개 감지 및 최신 교체일 기준으로 통합 완료!")
        except Exception as maint_ex:
            db.session.rollback()
            app.logger.error(f"[Migration] 유지관리 물품 중복 정제 오류: {str(maint_ex)}")

        # [마이그레이션] 비정기 세부구분 3 분리 및 작업 세부내용(memo) 파트 추가 정보 content 복원 마이그레이션
        try:
            import re
            sub3_list = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상", "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"]
            log_migrated = 0
            maint_migrated = 0

            def process_irregular_item(item):
                changed = False

                dt = (item.detail_type or '').strip()
                cnt = (item.content or '').strip()
                memo = (item.memo or '').strip()
                dt_parts = [p.strip() for p in dt.split(' > ') if p.strip()]

                found_sub3 = None
                prefix_pattern = re.compile(r'^(파트 이상 교체|파트 이상 수리|용액 용자 이상|현장 이슈|PC 이상|작업자 실수|통신 이상|프로그램 이상|단순조치|기타)\s*[-:]\s*')
                m = prefix_pattern.match(cnt)
                if m:
                    found_sub3 = m.group(1)
                    cnt = prefix_pattern.sub('', cnt).strip()
                    changed = True

                # memo에서 추가 파트 정보 추출
                memo_parts_str = ''
                if '[추가 파트]' in memo:
                    memo_parts_str = memo.split('[추가 파트]')[1].strip()

                # content가 비어버렸거나 단순 키워드만 있었던 경우 memo의 파트 정보 채우기
                if not cnt or cnt in sub3_list or cnt == '내용 없음':
                    if memo_parts_str:
                        cnt = memo_parts_str
                        changed = True
                    elif memo:
                        m_lines = [l.strip() for l in memo.split('\n') if l.strip()]
                        p_lines = [l for l in m_lines if re.search(r'\[(유상|무상|기타)\]', l) or any(c in l.lower() for c in ['valve', 'pump', 'filter', 'sensor', 'column', 'module', 'kit', '펌프', '필터', '밸브', '센서', '컬럼', '모듈', '키트', '파츠', '파트'])]
                        if p_lines:
                            cnt = ", ".join(p_lines)
                            changed = True

                if item.type == '비정기':
                    if len(dt_parts) == 2:
                        if not found_sub3:
                            for s3 in sub3_list:
                                if s3 in (item.content or ''):
                                    found_sub3 = s3
                                    break
                        if not found_sub3:
                            found_sub3 = '파트 이상 교체' if memo_parts_str else '기타'
                        dt_parts.append(found_sub3)
                        item.detail_type = ' > '.join(dt_parts)
                        changed = True
                    elif len(dt_parts) >= 3 and found_sub3:
                        dt_parts[2] = found_sub3
                        item.detail_type = ' > '.join(dt_parts)
                        changed = True

                if item.content != cnt and cnt:
                    item.content = cnt
                    changed = True

                return changed

            for log in LogItem.query.all():
                if process_irregular_item(log):
                    log_migrated += 1

            for maint in MaintItem.query.all():
                if process_irregular_item(maint):
                    maint_migrated += 1

            if log_migrated > 0 or maint_migrated > 0:
                db.session.commit()
                app.logger.warning(f"[Migration] 작업 완료/예정 세부내용 파트 content 복원 마이그레이션 완료! (LogItem: {log_migrated}개, MaintItem: {maint_migrated}개)")
        except Exception as ex_mig:
            db.session.rollback()
            app.logger.error(f"[Migration] 비정기 세부내용 마이그레이션 오류: {str(ex_mig)}")

        # [DB 마이그레이션] 사용자 데이터
        # Admin 초기 계정 생성
        admin_id = os.environ.get('APP_ADMIN_ID', 'admin')
        admin_user = User.query.filter_by(id=admin_id).first()
        if not admin_user:
            admin_pw = os.environ.get('APP_ADMIN_PW', secrets.token_urlsafe(8))
            admin_user = User(id=admin_id, pw=generate_password_hash(admin_pw, method='pbkdf2:sha256:50000'), role='superadmin', pw_changed_at=get_utc_now())
            db.session.add(admin_user)
            db.session.commit()
            app.logger.warning(f"Initial Admin PW generated in DB: {admin_pw}")
            print(f"[*] Super Admin Account Created -> ID: {admin_id} / PW: {admin_pw}")
        elif admin_user.role == 'admin':
            admin_user.role = 'superadmin'
            db.session.commit()
            print(f"[*] Admin Account '{admin_id}' elevated to 'superadmin'")
            

        # [수정] 가비아 서버(Python 3.9)에서 지원하지 않는 scrypt 해시를 pbkdf2로 강제 변환 및 평문 비밀번호 해싱
        all_users = User.query.all()
        for u in all_users:
            if u.pw and ('$' not in u.pw or u.pw.startswith('scrypt:') or '1000000' in u.pw):
                if u.id == os.environ.get('APP_ADMIN_ID', 'admin') or u.id == 'admin':
                    fallback_pw = os.environ.get('APP_ADMIN_PW', 'admin')
                elif u.id == os.environ.get('APP_USER_ID', 'user') or u.id == 'user':
                    fallback_pw = os.environ.get('APP_USER_PW', 'user')
                else:
                    fallback_pw = 'withtech123!'
                u.pw = generate_password_hash(fallback_pw, method='pbkdf2:sha256:50000')
                db.session.commit() # [수정] DB 연결 끊김 방지를 위해 1명 변환될 때마다 즉시 저장

        # [마이그레이션] Equipment 4필드 ID(site::name::serial::cust_name) 및 시리얼 정정 RAW SQL 강제 실행
        try:
            # 1. 컬럼 추가 (없으면 추가)
            try:
                db.session.execute(text("ALTER TABLE equipment ADD COLUMN cust_equip_name VARCHAR(100) DEFAULT ''"))
                db.session.commit()
            except:
                db.session.rollback()

            # 2. RAW SQL 기반 4필드 ID 및 시리얼 번호 정정
            raw_eqs = db.session.execute(text("SELECT id, site_name, name, serial, cust_equip_name FROM equipment")).fetchall()
            
            for row in raw_eqs:
                old_id = str(row[0] or '')
                site_val = str(row[1] or '').strip()
                name_val = str(row[2] or '').strip()
                serial_val = str(row[3] or '').replace('?', '-').strip()
                cust_val = str(row[4] or '').replace('?', '-').strip()

                parts = old_id.split('::')
                if len(parts) >= 4 and parts[3]:
                    if not cust_val:
                        cust_val = parts[3].replace('?', '-').strip()

                # SetupInfo 검색
                if not cust_val:
                    s_row = db.session.execute(text("SELECT cust_equip_name FROM setup_info WHERE equip_id=:o OR equip_id LIKE :l"), {'o': old_id, 'l': f"%::{serial_val}%"}).fetchone()
                    if s_row and s_row[0]:
                        cust_val = str(s_row[0]).replace('?', '-').strip()

                if name_val == '기타(ETC)':
                    new_id = f"{site_val}::기타(ETC)::::"
                else:
                    new_id = f"{site_val}::{name_val}::{serial_val}::{cust_val}"

                try: db.session.execute(text("SET FOREIGN_KEY_CHECKS=0;"))
                except: pass

                if old_id != new_id:
                    # 중복 새 ID 레코드가 있다면 삭제
                    db.session.execute(text("DELETE FROM equipment WHERE id=:n AND id!=:o"), {'n': new_id, 'o': old_id})
                    
                    db.session.execute(text("UPDATE maint_item SET equip_id=:n WHERE equip_id=:o"), {'n': new_id, 'o': old_id})
                    db.session.execute(text("UPDATE log_item SET equip_id=:n WHERE equip_id=:o"), {'n': new_id, 'o': old_id})
                    db.session.execute(text("UPDATE setup_detail SET equip_id=:n WHERE equip_id=:o"), {'n': new_id, 'o': old_id})
                    db.session.execute(text("UPDATE setup_log SET equip_id=:n WHERE equip_id=:o"), {'n': new_id, 'o': old_id})
                    db.session.execute(text("UPDATE trouble_log SET equip_id=:n WHERE equip_id=:o"), {'n': new_id, 'o': old_id})
                    db.session.execute(text("UPDATE setup_info SET equip_id=:n WHERE equip_id=:o"), {'n': new_id, 'o': old_id})

                db.session.execute(text("UPDATE equipment SET id=:n, serial=:s, cust_equip_name=:c WHERE id=:o"), {
                    'n': new_id,
                    's': serial_val,
                    'c': cust_val,
                    'o': old_id
                })

                try: db.session.execute(text("SET FOREIGN_KEY_CHECKS=1;"))
                except: pass

            db.session.commit()
            app.logger.warning("[Migration] Equipment 4필드 규격(site::name::serial::cust_name) RAW SQL 강제 정정 완료!")
        except Exception as ex_eq:
            db.session.rollback()
            app.logger.error(f"[Migration] Equipment 마이그레이션 오류: {str(ex_eq)}")

        # [마이그레이션] 기존 사업장에 '기타(ETC)' 장비 자동 추가 (신규 4필드 규격)
        try:
            sites = Site.query.all()
            for site in sites:
                etc_id = f"{site.name}::기타(ETC)::::"
                if not Equipment.query.filter_by(id=etc_id).first():
                    db.session.add(Equipment(id=etc_id, site_name=site.name, name="기타(ETC)", serial="", cust_equip_name=""))
                    db.session.add(SetupInfo(equip_id=etc_id, cust_equip_name="", model=""))
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            app.logger.error(f"ETC Equipment Migration Error: {str(e)}")

        # [마이그레이션] 점검 구분 전장비 고객대응의 'Parts 교체' 와 '파티클 필터 교체' 위치 변경 및 'Parts 교체' 삭제
        try:
            setting = SystemSetting.query.filter_by(key='check_type_categories').first()
            if setting and setting.value:
                import json
                cat_data = json.loads(setting.value)
                updated = False
                for k, lst in cat_data.items():
                    if k.endswith('::고객대응') and isinstance(lst, list):
                        has_parts = 'Parts 교체' in lst
                        has_particle = '파티클 필터 교체' in lst
                        
                        if has_parts and has_particle:
                            idx_parts = lst.index('Parts 교체')
                            idx_particle = lst.index('파티클 필터 교체')
                            lst[idx_parts], lst[idx_particle] = lst[idx_particle], lst[idx_parts]
                            lst.remove('Parts 교체')
                            updated = True
                        elif has_parts:
                            idx_parts = lst.index('Parts 교체')
                            lst[idx_parts] = '파티클 필터 교체'
                            updated = True
                        elif has_particle and 'Parts 교체' in lst:
                            lst.remove('Parts 교체')
                            updated = True
                
                if updated:
                    setting.value = json.dumps(cat_data, ensure_ascii=False)
                    db.session.commit()
                    app.logger.warning("[Migration] 점검 구분 관리 고객대응 내 '파티클 필터 교체' 및 'Parts 교체' 일괄 정리 완료!")
        except Exception as ex:
            db.session.rollback()
            app.logger.error(f"[Migration] 점검 구분 관리 마이그레이션 실패: {str(ex)}")

        # [마이그레이션] 4가지 항목 고유키 규격 변경 및 고아 데이터 복구 실행 (1회 완료되어 주석 처리)
        # migrate_db_to_four_fields()

# WSGI 서버(PythonAnywhere 등) 환경에서도 앱 구동 시 초기화가 실행되도록 __main__ 블록 밖으로 이동
# [Phase 3] JSON 파일 관련 로직이 제거되었으므로, 폴더 생성만 수행
for d in [DATA_DIR, LOG_DIR, BACKUP_DIR, DATA_LOG_DIR]:
    if not os.path.exists(d):
        os.makedirs(d, mode=0o700)



init_db()

if __name__ == '__main__':
    # 로컬과 서버 환경을 분리하기 위해 .env 파일에서 APP_PORT 값을 읽어옵니다. (기본값: 8080)
    port = int(os.environ.get('APP_PORT', 8080))

    # [수정] Waitress 서버 적용 (개발 서버 경고 제거 및 안정성 향상)
    try:
        from waitress import serve
        print(f" * Serving with Waitress on http://0.0.0.0:{port}")
        serve(app, host='0.0.0.0', port=port, threads=12)
    except (PermissionError, OSError) as port_err:
        # [추가] 포트 충돌(PermissionError/OSError) 발생 시 자동으로 다음 포트 시도
        new_port = port + 1
        print(f"\n ! Port {port} is in use ({port_err}). Trying port {new_port}...")
        try:
            serve(app, host='0.0.0.0', port=new_port, threads=12)
        except Exception as e:
            print(f" ! Failed to start server on port {new_port} as well. Please check your firewall or use a different port.")
            print(f"   Error: {e}")
    except ImportError:
        # Waitress가 설치되지 않은 경우 기존 Flask 개발 서버 사용
        print(" * Waitress not found. Running with basic Flask server.")
        import sys
        print(" * To fix the warning, run: pip install waitress")
        app.run(debug=False, port=port, host='0.0.0.0')