from flask import Flask, render_template, request, jsonify, session, has_request_context, send_from_directory, redirect
import json
import os
import time
import re
import random
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
import unicodedata

app = Flask(__name__)

# [요청 반영] Werkzeug HTTP 접근 콘솔 로그 비활성화 (GET/POST 요청 터미널 로그 숨김)
w_log = logging.getLogger('werkzeug')
w_log.setLevel(logging.ERROR)
w_log.disabled = True

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
    app.config['TEMPLATES_AUTO_RELOAD'] = False  # 운영 환경
else:
    app.config['TEMPLATES_AUTO_RELOAD'] = True   # 개발 환경 (템플릿 즉시 반영)
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0   # 정적 파일(JS, CSS) 캐시 해제
    app.jinja_env.auto_reload = True

@app.after_request
def add_no_cache_header(response):
    if os.environ.get('APP_ENV') != 'production':
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

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

# ---------- Migration ----------


# Ensure new columns exist (SQLite will ignore if already present)
def ensure_equipment_columns():
    columns = [
        ('equip_status', 'VARCHAR(50)'),
        ('delivery_date', 'VARCHAR(50)'),
        ('warranty_start', 'VARCHAR(50)'),
        ('warranty_period', 'VARCHAR(50)'),
        ('building', 'VARCHAR(100)'),
        ('floor', 'VARCHAR(50)'),
        ('detail_loc', 'VARCHAR(200)'),
        ('manager', 'VARCHAR(100)'),
        ('contact', 'VARCHAR(100)'),
        ('email', 'VARCHAR(100)'),
        ('cust_manager', 'VARCHAR(100)'),
        ('cust_contact', 'VARCHAR(100)'),
        ('cust_email', 'VARCHAR(100)'),
        ('project_no', 'VARCHAR(100)')
    ]
    for col, typ in columns:
        try:
            db.session.execute(text(f'ALTER TABLE equipment ADD COLUMN {col} {typ}'))
        except Exception:
            pass  # column may already exist




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
    project_no = db.Column(db.String(100), default='')

# [추가] 셋업(SETUP) 진행 세부사항(체크리스트) 모델

with app.app_context():
    ensure_equipment_columns()
class SetupDetail(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200))
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
    equip_id = db.Column(db.String(200))
    date = db.Column(db.String(50), default='')
    worker = db.Column(db.String(100), default='')
    content = db.Column(db.String(255), default='')
    company = db.Column(db.String(100), default='위드텍')
    memo = db.Column(db.Text, default='')
    md = db.Column(db.String(50), default='0')
    parts = db.Column(db.Text, default='')



class LogItem(db.Model):
    __tablename__ = 'maint_log'
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200))
    date = db.Column(db.String(50), default='')
    scheduled_date = db.Column(db.String(50), default='') # [통합] 예정일
    period = db.Column(db.String(50), nullable=True) # [통합] 주기
    type = db.Column(db.String(50), default='')
    detail_type = db.Column(db.String(100), default='')
    detail_type2 = db.Column(db.String(100), default='')
    detail_type3 = db.Column(db.String(100), default='')
    content = db.Column(db.String(255), default='')
    add_work = db.Column(db.String(255), default='')
    cost_type = db.Column(db.String(50), default='')
    md = db.Column(db.String(50), default='')
    worker = db.Column(db.String(100), default='')
    memo = db.Column(db.Text, default='')
    start_time = db.Column(db.String(50), default='')
    end_time = db.Column(db.String(50), default='')
    is_issue_shared = db.Column(db.Boolean, default=False)
    original_log_id = db.Column(db.String(50), nullable=True)
    add_work_log_id = db.Column(db.String(50), nullable=True)
    image_data = db.Column(db.Text(length=2000000), nullable=True) # [추가]
    status = db.Column(db.String(50), default='조치완료') # [통합] 상태 (작업예정 / 조치완료 / 연기됨 등)
    sort_order = db.Column(db.Integer, default=0)

# [추가] 장비별 유지관리 물품 관리 테이블 (ItemLog / item_log)
class ItemLog(db.Model):
    __tablename__ = 'item_log'
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200))
    date = db.Column(db.String(50), default='')
    code = db.Column(db.String(100), default='')
    part = db.Column(db.String(100), default='')
    spec = db.Column(db.String(255), default='')
    part_detail = db.Column(db.String(255), default='')
    cycle = db.Column(db.String(50), nullable=True)

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

# [추가] 장비 모델 마스터 데이터 테이블 (EquipmentModel)
class EquipmentModel(db.Model):
    __tablename__ = 'equipment_model'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False)
    abbr = db.Column(db.String(100), default='')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'abbr': self.abbr or self.name
        }

# [추가] 점검 구분 마스터 데이터 통합 테이블 (CheckTypeCategory)
class CheckTypeCategory(db.Model):
    __tablename__ = 'check_type_category'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    check_type = db.Column(db.String(100), nullable=False)   # 작업 구분 (정기, 비정기, 고객대응, 용액제조, 온라인점검)
    type_detail = db.Column(db.String(100), default='')       # 세부 구분 1 (PM 점검, BM 점검, Alarm, Hunting 등)
    type_detail2 = db.Column(db.String(100), default='')      # 세부 구분 2 (Hardware, Software, Flow/Temp/Pressure 등)
    type_detail3 = db.Column(db.String(100), default='')      # 세부 구분 3 (파트 이상 교체, 파트 이상 수리, 단순조치 등)
    sort_order = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            'id': self.id,
            'check_type': self.check_type,
            'type_detail': self.type_detail,
            'type_detail2': self.type_detail2,
            'type_detail3': self.type_detail3,
            'sort_order': self.sort_order
        }

# [추가] 점검 구분 등 동적 설정 데이터 테이블 (SystemSetting)
class SystemSetting(db.Model):
    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text)

# [추가] Trouble 이력 관리 모델
class TroubleLog(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200))
    occur_date = db.Column(db.String(50), default='')
    action_date = db.Column(db.String(50), default='') # [추가] 조치 일 (작업일)
    type = db.Column(db.String(50), default='비정기')   # [추가] 구분 (기본: 비정기)
    detail_type = db.Column(db.String(100), default='') # [추가] 세부구분 1
    detail_type2 = db.Column(db.String(100), default='') # [추가] 세부구분 2
    detail_type3 = db.Column(db.String(100), default='') # [추가] 세부구분 3
    situation = db.Column(db.Text, default='') # 트러블 상황
    symptom = db.Column(db.Text, default='')   # 트러블 증상
    cause = db.Column(db.Text, default='')     # 트러블 원인
    measure = db.Column(db.Text, default='')   # 조치사항
    prevent = db.Column(db.Text, default='')   # 재발방지 대책
    trouble_details = db.Column(db.Text, nullable=True) # [이동] 트러블 진행 경과 (JSON)
    status = db.Column(db.String(50), default='미기록')
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

def parse_part_item_string(raw_str):
    if not raw_str:
        return None
    s = str(raw_str).strip()
    if not s or s in ['내용 없음', '장비 점검']:
        return None

    # 1. '파트 이상 교체 -', '파트 이상 수리 -' 등 접두사 정제
    for prefix_kw in ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '물품 이상 교체', '물품 이상 수리', '파츠 이상 교체', '파츠 이상 수리']:
        if s.startswith(prefix_kw + ' -'):
            s = s[len(prefix_kw) + 2:].strip()
            break
        elif s.startswith(prefix_kw + '-'):
            s = s[len(prefix_kw) + 1:].strip()
            break
        elif s.startswith(prefix_kw):
            s = s[len(prefix_kw):].strip()
            break

    # 2. 맨 앞 비용 태그('[유상]', '[무상]') 정제
    cost_tag = '유상'
    cm = re.match(r'^\[(.*?)\]\s*(.*)$', s)
    if cm:
        cost_tag = cm.group(1).strip()
        s = cm.group(2).strip()

    # 3. 맨 뒤 물품 상세 대괄호('[물품상세]') 추출 및 정제
    part_detail_tag = ''
    sm = re.search(r'\s*\[(.*?)\]$', s)
    if sm:
        part_detail_tag = sm.group(1).strip()
        s = s[:sm.start()].strip()

    clean_name = s.strip()
    if not clean_name or clean_name in ['내용 없음', '장비 점검']:
        return None

    return {
        'clean_name': clean_name,
        'cost_tag': cost_tag,
        'part_detail': part_detail_tag
    }


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

    # 1-1. 장비 모델 마스터 데이터 (EquipmentModel 테이블 연동)
    try:
        models = EquipmentModel.query.order_by(EquipmentModel.id).all()
        if models:
            data['equipment_models'] = [m.to_dict() for m in models]
        else:
            data['equipment_models'] = []
    except Exception as e:
        app.logger.error(f"Error fetching equipment_models: {e}")
        data['equipment_models'] = []

    # 1-2. 세부구분 1, 2, 3 마스터 데이터 (CheckTypeCategory 테이블 연동)
    try:
        all_cats = CheckTypeCategory.query.order_by(CheckTypeCategory.sort_order, CheckTypeCategory.id).all()
        if all_cats:
            cat_dict1 = {}
            cat_dict2 = {}
            cat_dict3 = {}

            for row in all_cats:
                if row.check_type and row.type_detail:
                    if row.type_detail not in cat_dict1.setdefault(row.check_type, []):
                        cat_dict1[row.check_type].append(row.type_detail)

                if row.type_detail and row.type_detail2:
                    if row.type_detail2 not in cat_dict2.setdefault(row.type_detail, []):
                        cat_dict2[row.type_detail].append(row.type_detail2)

                if row.type_detail2 and row.type_detail3:
                    if row.type_detail3 not in cat_dict3.setdefault(row.type_detail2, []):
                        cat_dict3[row.type_detail2].append(row.type_detail3)

            data['check_type_categories'] = cat_dict1
            data['check_type_categories2'] = cat_dict2
            data['check_type_categories3'] = cat_dict3
            data['check_type_category_list'] = [r.to_dict() for r in all_cats]
    except Exception as e:
        app.logger.error(f"Error fetching check_type_categories: {e}")

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
    data['equip_id_map'] = {}

    # N+1 쿼리 성능 저하 방지를 위한 전체 데이터 사전 로드 (Dictionary 매핑)
    maint_items = {}; log_items = {}; setup_details = {}; setup_logs = {}; item_logs = {}
    
    for l in LogItem.query.all():
        if l.equip_id:
            n_eid = unicodedata.normalize('NFC', str(l.equip_id).strip())
            log_items.setdefault(n_eid, []).append(l)
    for sd in SetupDetail.query.all():
        if sd.equip_id:
            n_eid = unicodedata.normalize('NFC', str(sd.equip_id).strip())
            setup_details.setdefault(n_eid, []).append(sd)
    for sl in SetupLog.query.all():
        if sl.equip_id:
            n_eid = unicodedata.normalize('NFC', str(sl.equip_id).strip())
            setup_logs.setdefault(n_eid, []).append(sl)
    for il in ItemLog.query.all():
        if il.equip_id:
            n_eid = unicodedata.normalize('NFC', str(il.equip_id).strip())
            item_logs.setdefault(n_eid, []).append(il)

    # 4. 장비 상세 데이터 (details_ 및 setup_data) 매핑
    equips = Equipment.query.all()
    for eq in equips:
        cust_equip_name = eq.cust_equip_name or ""

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
        data[detail_key] = { "equipmentId": eq.id, "specialNote": eq.special_note, "maint": [], "logs": [], "setup": {} }
        data['equip_id_map'][f"{eq.site_name}::{eq_key}"] = eq.id
        
        # 장비 셋업(마스터) 정보
        data[detail_key]["setup"] = {
            "custEquipName": eq.cust_equip_name or "", "equipStatus": eq.equip_status or "", "deliveryDate": eq.delivery_date or "",
            "projectNo": eq.project_no or "",
            "warrantyStart": eq.warranty_start or "", "warrantyPeriod": eq.warranty_period or "", "building": eq.building or "",
            "floor": eq.floor or "", "detailLoc": eq.detail_loc or "", "manager": eq.manager or "", "contact": eq.contact or "",
            "email": eq.email or "", "custManager": eq.cust_manager or "", "custContact": eq.cust_contact or "",
            "custEmail": eq.cust_email or "", "model": eq.name or ""
        }

        # 유지관리(maint) 예정 및 이력(logs) 분류 매핑 (maint_log 단일 구조)
        norm_eq_id = unicodedata.normalize('NFC', str(eq.id).strip())
        eq_all_logs = log_items.get(norm_eq_id, []) or log_items.get(eq.id, [])
        maint_list = [l for l in eq_all_logs if getattr(l, 'status', '') == '작업예정']
            
        maint_list.sort(key=lambda x: (getattr(x, 'sort_order', 0) if getattr(x, 'sort_order', None) is not None else 0, getattr(x, '_unique_id', 0)))

        maint_ids = set()
        maint_code_specs = set()

        eq_item_logs = item_logs.get(norm_eq_id, []) or item_logs.get(eq.id, [])
        item_log_map = {str(il.id): il for il in eq_item_logs}
        item_log_code_map = {(il.code or il.part or '').strip(): il for il in eq_item_logs if (il.code or il.part)}

        for m in maint_list:
            m_id = int(m.id) if str(m.id).isdigit() else m.id
            m_id_str = str(m_id)
            m_code = getattr(m, 'code', '') or m.content or ''
            parsed_m = parse_part_item_string(m_code)
            clean_c = parsed_m['clean_name'] if (parsed_m and parsed_m.get('clean_name')) else re.sub(r'\[.*?\]', '', m_code).replace('파트 이상 교체 -', '').replace('파트 이상 수리 -', '').strip()
            m_spec = (parsed_m.get('part_detail') if parsed_m else '') or getattr(m, 'spec', '') or ''
            if not m_spec:
                il_match = item_log_map.get(m_id_str) or item_log_code_map.get(clean_c) or item_log_code_map.get(m_code.strip())
                m_spec = il_match.part_detail if (il_match and il_match.part_detail) else ''

            maint_ids.add(m_id_str)
            maint_code_specs.add((m_code.strip(), m_spec.strip()))
            if clean_c:
                maint_code_specs.add((clean_c, m_spec.strip()))

            data[detail_key]["maint"].append({
                "id": m_id, "type": m.type, "detailType": m.detail_type,
                "detailType2": getattr(m, 'detail_type2', ''), "detailType3": getattr(m, 'detail_type3', ''),
                "code": m_code, "content": m.content, "spec": m_spec, "date": m.date, "scheduledDate": getattr(m, 'scheduled_date', m.date),
                "period": int(m.period) if getattr(m, 'period', None) and str(m.period).isdigit() else getattr(m, 'period', ''),
                "costType": m.cost_type, "worker": m.worker, "md": m.md, "itemCost": getattr(m, 'item_cost', ''), "memo": m.memo,
                "sortOrder": getattr(m, 'sort_order', 0),
                "originalLogId": int(m.original_log_id) if m.original_log_id and str(m.original_log_id).isdigit() else m.original_log_id
            })

        # [요청 반영] item_log 테이블에 기록된 해당 장비의 유지관리 물품 리스트 무조건 equip_id 매칭하여 반영
        eq_item_logs = item_logs.get(norm_eq_id, []) or item_logs.get(eq.id, [])
        for il in eq_item_logs:
            il_id = int(il.id) if str(il.id).isdigit() else il.id
            il_code = (il.code or il.part or '').strip()
            il_part_detail = (il.part_detail or '').strip()
            il_cycle = int(il.cycle) if il.cycle and str(il.cycle).isdigit() else (il.cycle or '')

            invalid_kws = ['내용 없음', '장비 점검', 'PM 점검', 'BM 점검', '파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '파츠 이상 교체', '파츠 이상 수리', '물품 이상 교체', '물품 이상 수리', '단순 조치', '현장 이슈', 'PC 이상', '작업자 실수', '통신 이상', '프로그램 이상', '기타']
            if not il_code or ',' in il_code or ',' in (il.part or '') or il_code in invalid_kws or (il.part and il.part in invalid_kws):
                continue

            # [유지관리 물품 100% 보장 반영] 이미 동일 ID로 maint_list에 존재하는 경우만 중복 추가 차단 (item_log 마스터 데이터는 무조건 100% data.maint 반영)
            if str(il_id) in maint_ids:
                continue

            # item_log 유지관리 물품 항목은 scheduledDate가 빈 값('')인 물품 마스터로 data.maint에 보장 반영
            data[detail_key]["maint"].append({
                "id": il_id,
                "type": '',
                "detailType": 'Parts 교체',
                "detailType2": '',
                "detailType3": '',
                "code": il_code,
                "content": il_code,
                "spec": il_part_detail,
                "date": il.date or '',
                "scheduledDate": '',
                "period": il_cycle,
                "costType": '유상',
                "worker": '',
                "md": '0',
                "itemCost": '',
                "memo": '',
                "sortOrder": 999,
                "originalLogId": None
            })
            maint_ids.add(str(il_id))
            
        logs_list = [l for l in eq_all_logs if getattr(l, 'status', '조치완료') != '작업예정']
        for l in logs_list:
            data[detail_key]["logs"].append({
                "id": int(l.id) if str(l.id).isdigit() else l.id, "date": l.date, "type": l.type,
                "detailType": l.detail_type, "detailType2": l.detail_type2, "detailType3": getattr(l, 'detail_type3', ''), "content": l.content, "startTime": getattr(l, 'start_time', ''),
                "endTime": getattr(l, 'end_time', ''),
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

    
    # Login block removed for normal operation
    # if user and user.role in ['superadmin']:
    #     pass  # allow login to proceed
    # else:
    #     return jsonify({"status": "fail", "message": "서버 점검 중으로 현재 접속 불가능 합니다. 죄송합니다."}), 403

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

    matched_equips = []
    for eq in all_equips:
        serial_strip = eq.serial.strip() if eq.serial else ""
        name_strip = eq.name.strip() if eq.name else ""
        cust_name_strip = eq.cust_equip_name.strip() if eq.cust_equip_name else ""
        
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
    try:
        for m in EquipmentModel.query.all():
            if m.name:
                system_models.append(m.name)
            if m.abbr:
                system_models.append(m.abbr)
    except Exception as e:
        app.logger.error(f"Error reading EquipmentModel: {str(e)}")
    
    db_models = [eq.name for eq in Equipment.query.with_entities(Equipment.name).distinct() if eq.name]
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
    intent_part = any(k in msg_no_space for k in ["물품", "부품", "파트", "소모품", "필터", "filter", "cone", "gc", "spec", "스펙", "교체물품", "유지관리물품", "부품교체", "물품이력", "물품목록", "부품목록"])
    intent_detail = any(k in msg_no_space for k in ["상세", "정보", "디테일", "연락처", "담당자", "위치", "전화번호", "이메일", "어디", "누구"])

    app.logger.info(f"[AI Chat RAG] 의도 분석 결과 -> Site: {matched_site}, Worker: {matched_worker}, Model: {matched_model}, Equips: {[e.id for e in matched_equips]}")
    app.logger.info(f"[AI Chat RAG] 의도 분류 -> COUNT:{intent_count}, TROUBLE:{intent_trouble}, SCHEDULE:{intent_schedule}, SETUP:{intent_setup}, PART:{intent_part}, DETAIL:{intent_detail}")

    # 3. 데이터베이스 쿼리 및 컨텍스트 작성
    
    # 3-1. 메타 요약 정보 (기본 통계 제공)
    maint_count_query = LogItem.query.filter_by(status='작업예정')
    trouble_count_query = TroubleLog.query
    log_count_query = LogItem.query
    
    if matched_site:
        maint_count_query = maint_count_query.filter(LogItem.equip_id.like(f"{matched_site}::%"))
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
            period_maint = LogItem.query.filter(LogItem.equip_id.like(f"{matched_site}::%"), LogItem.status == '작업예정', LogItem.scheduled_date.like(f"{target_period}%")).count()
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
            period_maint = LogItem.query.filter(LogItem.status == '작업예정', LogItem.scheduled_date.like(f"{target_period}%")).count()
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
            m_name = eq.name if eq.name else "미지정"
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
                ml = LogItem.query.filter_by(id=str(rt.id)).first()
                w_str = ml.worker if ml else '-'
                t_desc = parse_trouble_content(rt.trouble_details) or rt.situation or rt.symptom or rt.measure or '장애 내역'
                context_lines.append(f"    - [{rt.action_date or rt.occur_date or '미기록'}] {rt.equip_id.split('::')[-1]} 장비: {t_desc} (담당: {w_str})")

    # 3-3. 특정 장비가 매칭된 경우 (장비 타겟 정보 제공)
    if matched_equips:
        context_lines.append("\n[타겟 장비 분석 정보]")
        
        # 1) 매칭된 장비가 5대 이하로 소량인 경우: 기존과 같이 각 장비의 상세 개별 이력 제공
        if len(matched_equips) <= 5:
            for eq in matched_equips:
                cust_name = eq.cust_equip_name or "N/A"
                status = eq.equip_status or "N/A"
                loc = f"{eq.building or ''} {eq.floor or ''} {eq.detail_loc or ''}".strip() or "N/A"
                manager = eq.manager or "N/A"
                model = eq.name or "N/A"
                
                context_lines.append(f"■ 장비: {eq.name} ({eq.serial}) | 모델: {model} | 사업장: {eq.site_name} | 고객장비명: {cust_name} | 상태: {status} | 위치: {loc} | 담당: {manager}")
                
                m_items = LogItem.query.filter_by(equip_id=eq.id, status='작업예정').order_by(LogItem.scheduled_date).limit(3).all()
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
                        context_lines.append(f"    * [발생일: {tl.occur_date or '미기록'}] 트러블상세: {parse_trouble_content(tl.trouble_details)}")

                # [추가] 과거 완료된 장비점검/유지보수 작업 실적 일지 (LogItem) 상세 수집
                completed_logs = LogItem.query.filter_by(equip_id=eq.id).order_by(LogItem.date.desc()).limit(limit_num).all()
                if completed_logs:
                    context_lines.append(f"  - 과거 점검 및 조치 완료 이력:")
                    for cl in completed_logs:
                        log_detail = f"{cl.content}"
                        if cl.memo:
                            log_detail += f" / 메모: {cl.memo}"
                        context_lines.append(f"    * [{cl.date}] {log_detail} ({cl.worker})")

                # [추가] 장비 등록 유지관리 물품 마스터 (ItemLog) 수집
                item_logs = ItemLog.query.filter_by(equip_id=eq.id).all()
                if item_logs:
                    context_lines.append(f"  - 장비 등록 유지관리 물품 목록 ({len(item_logs)}건):")
                    for il in item_logs:
                        det = f" [{il.part_detail}]" if il.part_detail else ""
                        context_lines.append(f"    * [코드: {il.code}] {il.part}{det} (스펙: {il.spec or '-'}, 교체/등록일: {il.date or '-'}, 주기: {il.cycle or '-'})")

        # 2) 매칭된 장비가 5대를 초과하여 다량인 경우: 토큰 폭발 방지를 위해 사전 통계 분석 및 핵심 연관 조치사례(Top-5) 요약 제공
        else:
            eq_ids = [eq.id for eq in matched_equips]
            context_lines.append(f"※ 총 {len(matched_equips)}대의 많은 장비가 매칭되어 통계 집계 데이터 및 연관 핵심 이력만 요약 제공합니다.")
            
            # (A) 사전 가동 상태 및 모델 분포 집계 (Pre-aggregation)
            status_counts = {}
            model_counts = {}
            for eq in matched_equips:
                status_val = eq.equip_status if eq.equip_status else "미지정"
                status_counts[status_val] = status_counts.get(status_val, 0) + 1
                
                model_val = eq.name if eq.name else "미지정"
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
                    kw_troubles = all_trouble_query.filter(
                        TroubleLog.situation.like(f"%{kw}%") |
                        TroubleLog.symptom.like(f"%{kw}%") |
                        TroubleLog.cause.like(f"%{kw}%") |
                        TroubleLog.measure.like(f"%{kw}%") |
                        TroubleLog.prevent.like(f"%{kw}%") |
                        TroubleLog.trouble_details.like(f"%{kw}%")
                    ).all()
                    related_troubles.extend(kw_troubles)
                seen_t = set()
                related_troubles = [t for t in related_troubles if not (t._unique_id in seen_t or seen_t.add(t._unique_id))]
            
            # 연관 사례가 부족할 경우 최근 해결 완료된 주요 조치 로그로 보충
            if len(related_troubles) < 5:
                extra_troubles = all_trouble_query.filter(TroubleLog.status == '기록완료').order_by(TroubleLog.action_date.desc()).limit(5 - len(related_troubles)).all()
                for et in extra_troubles:
                    if et._unique_id not in [t._unique_id for t in related_troubles]:
                        related_troubles.append(et)
            
            top_troubles = related_troubles[:5]
            if top_troubles:
                context_lines.append(f"\n▶ [과거 유사 장애 해결 및 조치 성공 사례 (최우수 레퍼런스 5건)]")
                for rt in top_troubles:
                    eq_serial = rt.equip_id.split('::')[-1]
                    m_rt = LogItem.query.filter_by(id=str(rt.id)).first()
                    w_name = m_rt.worker if m_rt else '미지정'
                    context_lines.append(f"  * 발생일: {rt.occur_date or '미기록'} | 조치완료일: {rt.action_date or '미조치'} | 장비: {eq_serial} (담당: {w_name})")
                    context_lines.append(f"    - 트러블 상세: {parse_trouble_content(rt.trouble_details)}")
            else:
                context_lines.append(f"\n▶ [과거 유사 장애 해결 및 조치 성공 사례]\n  - 해당 장비 그룹의 조치 완료된 트러블 이력이 없습니다.")

            # (C) 임박한 점검 예정 일정 요약 (최대 5건)
            upcoming_maint = LogItem.query.filter(LogItem.equip_id.in_(eq_ids), LogItem.status == '작업예정').order_by(LogItem.scheduled_date).limit(5).all()
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
                    rl_memo_info = rl.memo if rl.memo else ""
                    log_detail = f"점검내역: {rl.content}"
                    if rl_memo_info:
                        log_detail += f" | 작업메모: {rl_memo_info}"
                    context_lines.append(f"  - [{rl.date}] {eq_serial} 장비: {log_detail} (담당: {rl.worker})")

            # (D) 장비 목록 요약 (최대 10개만 대표 노출)
            context_lines.append(f"\n▶ [대상 장비 목록 요약 (상위 10대)]")
            for eq in matched_equips[:10]:
                cust_name = eq.cust_equip_name or "N/A"
                status = eq.equip_status or "N/A"
                model = eq.name or "N/A"
                context_lines.append(f"  - {eq.name} (시리얼: {eq.serial}, 모델: {model}, 고객장비명: {cust_name}, 상태: {status})")
            if len(matched_equips) > 10:
                context_lines.append(f"  - 그 외 {len(matched_equips) - 10}대의 장비가 더 존재합니다.")

    # 3-4. 장비 매칭은 없지만 모델 매칭이 된 경우
    elif matched_model:
        context_lines.append(f"\n[모델명 '{matched_model}' 관련 장비 목록]")
        # [개선] 가상 장비인 "기타(ETC)" 장비는 챗봇 매칭 및 통계에서 제외합니다.
        model_equips = Equipment.query.filter(Equipment.name == matched_model, Equipment.name != "기타(ETC)")
        if matched_site:
            model_equips = model_equips.filter(Equipment.site_name == matched_site)
        m_eqs = model_equips.all()
        for eq in m_eqs[:10]:
            cust_name = eq.cust_equip_name or "N/A"
            status = eq.equip_status or "N/A"
            context_lines.append(f"  - 사업장: {eq.site_name} | 장비명: {eq.name} ({eq.serial}) | 고객장비명: {cust_name} | 상태: {status}")
        if len(m_eqs) > 10:
            context_lines.append(f"  (외 {len(m_eqs) - 10}대의 장비가 더 존재합니다.)")

    # 3-5. 작업자(Worker) 매칭이 된 경우 관련 이력 조회
    if matched_worker:
        context_lines.append(f"\n[작업자 '{matched_worker}' 관련 배정 내역]")
        
        worker_maint = LogItem.query.filter(LogItem.worker.like(f"%{matched_worker}%"), LogItem.status == '작업예정')
        if matched_site:
            worker_maint = worker_maint.filter(LogItem.equip_id.like(f"{matched_site}::%"))
        wm_list = worker_maint.order_by(LogItem.scheduled_date).limit(limit_num).all()
        if wm_list:
            context_lines.append(f"  - 점검 및 유지보수 일정 (최대 {limit_num}건):")
            for mi in wm_list:
                context_lines.append(f"    * 예정일: {mi.scheduled_date}, 장비ID: {mi.equip_id}, 구분: {mi.type}, 작업명: {mi.detail_type}")
        
        worker_trouble = LogItem.query.filter(LogItem.worker.like(f"%{matched_worker}%"), db.func.trim(LogItem.type) == '비정기')
        if matched_site:
            worker_trouble = worker_trouble.filter(LogItem.equip_id.like(f"{matched_site}::%"))
        wt_list = worker_trouble.order_by(LogItem.date.desc()).limit(limit_num).all()
        if wt_list:
            context_lines.append(f"  - 장애/트러블 조치 이력 (최대 {limit_num}건):")
            for wl in wt_list:
                t_l = TroubleLog.query.filter_by(id=str(wl.id)).first()
                occ_str = t_l.occur_date if t_l and t_l.occur_date else '미기록'
                context_lines.append(f"    * 발생일: {occ_str}, 조치일: {wl.date or '미조치'}, 장비ID: {wl.equip_id}")
                context_lines.append(f"      작업내용: {wl.content}")
                context_lines.append(f"      조치/메모: {wl.memo if wl.memo else '기록 없음'}")

    # 3-6. 일반 의도별 다중 쿼리 (장비/작업자 개별 지목이 없는 경우)
    if not matched_equips and not matched_worker and not matched_model:
        # (1) 장애/트러블(INTENT_TROUBLE) 조회
        if intent_trouble:
            query = TroubleLog.query
            if matched_site:
                query = query.filter(TroubleLog.equip_id.like(f"{matched_site}::%"))
                
            if "기록완료" in user_message or "완료" in user_message or "해결" in user_message:
                query = query.filter_by(status='기록완료')
            elif "미기록" in user_message or "미해결" in user_message:
                query = query.filter_by(status='미기록')
                
            t_logs = query.order_by(TroubleLog.action_date.desc()).limit(limit_num).all()
            if t_logs:
                context_lines.append(f"\n[최근 트러블 및 조치 이력 (최대 {limit_num}건)]")
                for tl in t_logs:
                    ml = LogItem.query.filter_by(id=str(tl.id)).first()
                    worker_str = ml.worker if ml else '-'
                    t_desc = parse_trouble_content(tl.trouble_details) or tl.situation or tl.symptom or tl.measure or '-'
                    t_memo = tl.measure or tl.prevent or (ml.memo if ml else '기록 없음')
                    context_lines.append(f"- 장비ID: {tl.equip_id}, 발생일: {tl.occur_date or '미기록'}, 조치일: {tl.action_date or '미조치'}, 기록상태: {tl.status}, 담당: {worker_str}")
                    context_lines.append(f"  트러블내용: {t_desc}")
                    context_lines.append(f"  조치/대책: {t_memo}")
            else:
                context_lines.append("\n[최근 트러블 및 조치 이력]\n- 등록된 트러블 내역이 없습니다.")

        # (2) 점검/일정(INTENT_SCHEDULE) 조회
        if intent_schedule:
            query = LogItem.query.filter(LogItem.status == '작업예정')
            if matched_site:
                query = query.filter(LogItem.equip_id.like(f"{matched_site}::%"))
            maint_items = query.order_by(LogItem.scheduled_date).limit(limit_num).all()

            if maint_items:
                context_lines.append(f"\n[유지관리 점검 일정 (최대 {limit_num}건)]")
                for mi in maint_items:
                    s_date = getattr(mi, 'scheduled_date', '') or mi.date
                    context_lines.append(f"- 예정일: {s_date}, 장비ID: {mi.equip_id}, 구분: {mi.type}, 작업명: {mi.detail_type}, 담당: {mi.worker}")
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

        # (4) 물품/부품(INTENT_PART) 조회
        if intent_part:
            item_query = ItemLog.query
            if matched_site:
                item_query = item_query.filter(ItemLog.equip_id.like(f"{matched_site}::%"))
            
            search_kws = [w for w in sanitized_message.split() if len(w) >= 2 and w not in ["물품", "부품", "유지관리", "목록", "알려줘", "조회", "이력", "스펙", "어떤"]]
            if search_kws:
                for skw in search_kws:
                    item_query = item_query.filter(
                        ItemLog.code.like(f"%{skw}%") |
                        ItemLog.part.like(f"%{skw}%") |
                        ItemLog.spec.like(f"%{skw}%") |
                        ItemLog.part_detail.like(f"%{skw}%")
                    )

            i_logs = item_query.order_by(ItemLog.date.desc()).limit(limit_num * 2).all()
            if i_logs:
                context_lines.append(f"\n[장비 등록 유지관리 물품 내역 (최대 {limit_num * 2}건)]")
                for il in i_logs:
                    det = f" [{il.part_detail}]" if il.part_detail else ""
                    context_lines.append(f"- 장비ID: {il.equip_id} | 코드명: {il.code} | 부품명: {il.part}{det} | 스펙: {il.spec or '-'} | 등록/교체일: {il.date or '-'} | 주기: {il.cycle or '-'}")
            else:
                context_lines.append("\n[장비 유지관리 등록 물품 내역]\n- 등록된 유지관리 물품 내역이 없습니다.")

        # (5) 기본: 키워드가 없거나 단순 장비 목록 조회인 경우
        if not intent_trouble and not intent_schedule and not intent_setup and not intent_part:
            # [개선] 특정 장비 지목 없이 사업장 단위의 분석을 요청한 경우, 사업장의 복합 이력을 추출해 컨텍스트 질을 비약적으로 상승시킵니다.
            if matched_site:
                context_lines.append(f"\n[{matched_site} 사업장 종합 현황 및 이력 분석 데이터]")
                
                # 1) 소속 장비 최근 장애/트러블 이력
                site_troubles = TroubleLog.query.filter(TroubleLog.equip_id.like(f"{matched_site}::%")).order_by(TroubleLog.occur_date.desc()).limit(5).all()
                if site_troubles:
                    context_lines.append(f"  * 최근 발생 장애 내역:")
                    for st in site_troubles:
                        st_desc = parse_trouble_content(st.trouble_details) or st.situation or st.symptom or '-'
                        st_memo = st.measure or st.prevent or ''
                        context_lines.append(f"    - [{st.occur_date or '미기록'}] {st.equip_id.split('::')[-1]} (상태: {st.status}, 조치일: {st.action_date or '미조치'}): {st_desc}")
                        if st_memo:
                            context_lines.append(f"      조치 세부내역: {st_memo}")
                else:
                    context_lines.append(f"  * 최근 발생한 장애 내역이 없습니다.")

                # 2) 소속 장비 최근 점검 이력
                site_completed_logs = LogItem.query.filter(LogItem.equip_id.like(f"{matched_site}::%")).order_by(LogItem.date.desc()).limit(5).all()
                if site_completed_logs:
                    context_lines.append(f"  * 최근 점검 수행 내역:")
                    for scl in site_completed_logs:
                        scl_memo_info = scl.memo if scl.memo else ""
                        log_detail = f"점검내역: {scl.content}"
                        if scl_memo_info:
                            log_detail += f" | 작업메모: {scl_memo_info}"
                        context_lines.append(f"    - [{scl.date}] {scl.equip_id.split('::')[-1]}: {log_detail} (담당: {scl.worker})")

                # 3) 소속 장비 다가오는 점검 예정 일정
                site_upcoming_maint = LogItem.query.filter(LogItem.equip_id.like(f"{matched_site}::%"), LogItem.status == '작업예정').order_by(LogItem.scheduled_date).limit(5).all()
                if site_upcoming_maint:
                    context_lines.append(f"  * 예정된 점검 일정:")
                    for sumi in site_upcoming_maint:
                        context_lines.append(f"    - [{sumi.scheduled_date}] {sumi.equip_id.split('::')[-1]} ({sumi.type}): {sumi.detail_type} (담당: {sumi.worker})")

            context_lines.append("\n[등록 장비 현황]")
            for eq in all_equips[:15]:
                cust_name = eq.cust_equip_name or "N/A"
                status = eq.equip_status or "N/A"
                model = eq.name or "N/A"
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
        # 오직 최종 관리자(superadmin)만 챗봇 기능 사용 가능
        if session.get('role') != 'superadmin':
            return jsonify({"status": "fail", "message": "챗봇 사용 권한이 없습니다. (최종관리자 전용)"}), 403

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
        if domain == 'setting':
            if action == 'UPDATE':
                deprecated_keys = ['check_type_categories', 'check_type_categories2', 'check_type_categories3', 'check_type_items', 'equipment_models', 'admin_items']
                if payload.get('key') not in deprecated_keys:
                    val_json = json.dumps(payload['value'], ensure_ascii=False)
                    setting = SystemSetting.query.filter_by(key=payload['key']).first()
                    if setting: setting.value = val_json
                    else: db.session.add(SystemSetting(key=payload['key'], value=val_json))
        elif domain == 'site':
            if action == 'CREATE':
                site_name = payload['name']
                site_group = payload.get('group', '기타사업장')
                db.session.add(Site(name=site_name, group=site_group, buildings='[]'))
                db.session.flush() # 부모(사업장) 레코드를 먼저 DB에 반영하여 FK 에러 방지
                
                # [추가] 사업장 생성 시 '기타(ETC)' 장비 기본 등록
                etc_id = f"{site_name}::기타(ETC)::::"
                db.session.add(Equipment(id=etc_id, site_name=site_name, name="기타(ETC)", serial=""))
                # [추가] 사업장 생성 시 '기타(ETC)' 장비 기본 등록
                etc_id = f"{site_name}::기타(ETC)::::"
                db.session.add(Equipment(id=etc_id, site_name=site_name, name="기타(ETC)", serial=""))
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
                    db.session.flush()
                
                parts = new_id.split('::')
                e_name = parts[0] if len(parts) > 0 else ""
                e_name = normalize_equipment_model_to_abbr(e_name)
                e_serial = (parts[1] if len(parts) > 1 else "").replace('?', '-').replace('"', '')
                cust_name = payload.get('setup', {}).get('custEquipName', '').replace('?', '-')
                s_data = payload.get('setup', {})

                if e_name == "기타(ETC)":
                    db_id = f"{site_name}::기타(ETC)::::"
                    e_serial = ""
                else:
                    db_id = f"{site_name}::{e_name}::{e_serial}::{cust_name}"

                db.session.add(Equipment(
                    id=db_id, site_name=site_name, name=e_name, serial=e_serial, cust_equip_name=cust_name, special_note=payload.get('special_note', ''),
                    project_no=s_data.get('projectNo', ''), equip_status=s_data.get('equipStatus', ''),
                    delivery_date=s_data.get('deliveryDate', ''), warranty_start=s_data.get('warrantyStart', ''), warranty_period=str(s_data.get('warrantyPeriod', '')),
                    building=s_data.get('building', ''), floor=s_data.get('floor', ''), detail_loc=s_data.get('detailLoc', ''),
                    manager=s_data.get('manager', ''), contact=s_data.get('contact', ''), email=s_data.get('email', ''),
                    cust_manager=s_data.get('custManager', ''), cust_contact=s_data.get('custContact', ''), cust_email=s_data.get('custEmail', '')
                ))
            elif action == 'UPDATE':
                old_id = payload['old_id']
                old_site = payload.get('old_site', site_name)
                
                parts = new_id.split('::')
                e_name = parts[0] if len(parts) > 0 else ""
                e_name = normalize_equipment_model_to_abbr(e_name)
                e_serial = (parts[1] if len(parts) > 1 else "").replace('?', '-').replace('"', '')
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

                        db.session.execute(text("UPDATE item_log SET equip_id=:n WHERE equip_id=:o"), {'n':db_new_id, 'o':db_old_id})
                        db.session.execute(text("UPDATE maint_log SET equip_id=:n WHERE equip_id=:o"), {'n':db_new_id, 'o':db_old_id})
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
                    s_data = payload.get('setup', {})
                    equip.cust_equip_name = s_data.get('custEquipName', '')
                    equip.project_no = s_data.get('projectNo', '')
                    equip.equip_status = s_data.get('equipStatus', '')
                    equip.delivery_date = s_data.get('deliveryDate', '')
                    equip.warranty_start = s_data.get('warrantyStart', '')
                    equip.warranty_period = str(s_data.get('warrantyPeriod', ''))
                    equip.building = s_data.get('building', '')
                    equip.floor = s_data.get('floor', '')
                    equip.detail_loc = s_data.get('detailLoc', '')
                    equip.manager = s_data.get('manager', '')
                    equip.contact = s_data.get('contact', '')
                    equip.email = s_data.get('email', '')
                    equip.cust_manager = s_data.get('custManager', '')
                    equip.cust_contact = s_data.get('custContact', '')
                    equip.cust_email = s_data.get('custEmail', '')
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
                new_spec = payload.get('spec', '')
                
                if not item: 
                    db.session.add(AdminItem(id=str(payload['id'])))
                
                db.session.execute(text("UPDATE admin_item SET detail_type=:dt, additional=:add, partno=:pn, code=:cd, part=:pt, spec=:sp, equip=:eq WHERE id=:i"), {'dt':payload.get('detailType',''), 'add':payload.get('additional',''), 'pn':payload.get('partno',''), 'cd':payload.get('code',''), 'pt':payload.get('part',''), 'sp':payload.get('spec',''), 'eq':payload.get('equip',''), 'i':str(payload['id'])})
                
                # UPDATE 시 코드명이나 물품명이 변경된 경우, 기존 등록/완료된 작업의 물품 정보 및 item_log 테이블 일괄 동기화
                if action == 'UPDATE' and item and (old_code != new_code or old_part != new_part):
                    if old_code and new_code and old_code != new_code:
                        db.session.execute(text("UPDATE item_log SET code=:nc WHERE code=:oc"), {'nc': new_code, 'oc': old_code})
                    if old_part and new_part and old_part != new_part:
                        db.session.execute(text("UPDATE item_log SET part=:np WHERE part=:op"), {'np': new_part, 'op': old_part})

                    # LogItem content 필드 업데이트
                    log_items = LogItem.query.all()
                    for l in log_items:
                        if l.content:
                            updated_content = update_content_part(l.content, old_code, new_code, old_part, new_part)
                            if updated_content != l.content:
                                l.content = updated_content

                # [추가] 물품 상세 정보 수정/생성 시 item_log 테이블의 spec도 새 규격(new_spec)으로 즉시 동기화
                targets = [t for t in [new_code, new_part, old_code, old_part] if t]
                if targets:
                    for t in set(targets):
                        db.session.execute(text("UPDATE item_log SET spec=:sp WHERE code=:t OR part=:t"), {'sp': new_spec, 't': t})
            elif action == 'DELETE':
                db.session.execute(text("DELETE FROM admin_item WHERE id=:i"), {'i': str(payload['id'])})
                
        elif domain == 'setting':
            deprecated_keys = ['check_type_categories', 'check_type_categories2', 'check_type_categories3', 'check_type_items', 'equipment_models', 'admin_items']
            if payload.get('key') not in deprecated_keys:
                val_json = json.dumps(payload['value'], ensure_ascii=False)
                setting = SystemSetting.query.filter_by(key=payload['key']).first()
                if setting: setting.value = val_json
                else: db.session.add(SystemSetting(key=payload['key'], value=val_json))

            if payload.get('key') == 'equipment_models':
                val = payload.get('value', [])
                if isinstance(val, list):
                    try:
                        EquipmentModel.query.delete()
                        for idx, m in enumerate(val, 1):
                            if isinstance(m, dict):
                                n = (m.get('name') or m.get('model') or '').strip()
                                a = (m.get('abbr') or n).strip()
                                if n:
                                    db.session.add(EquipmentModel(id=m.get('id', idx), name=n, abbr=a))
                            elif isinstance(m, str) and m.strip():
                                db.session.add(EquipmentModel(id=idx, name=m.strip(), abbr=m.strip()))
                    except Exception as ex:
                        app.logger.error(f"Failed to sync equipment_model table: {ex}")

            if payload.get('key') == 'admin_items':
                val = payload.get('value', [])
                if isinstance(val, list):
                    try:
                        AdminItem.query.delete()
                        for idx, item in enumerate(val, 1):
                            if isinstance(item, dict):
                                i_id = str(item.get('id', idx))
                                cd = item.get('code', '')
                                pt = item.get('part', '')
                                sp = item.get('spec', '')
                                db.session.add(AdminItem(
                                    id=i_id,
                                    detail_type=item.get('detailType', item.get('detail_type', '')),
                                    additional=item.get('additional', ''),
                                    partno=item.get('partno', ''),
                                    code=cd,
                                    part=pt,
                                    spec=sp,
                                    equip=item.get('equip', '')
                                ))
                                if sp and (cd or pt):
                                    if cd:
                                        db.session.execute(text("UPDATE item_log SET spec=:sp WHERE code=:cd OR part=:cd"), {'sp': sp, 'cd': cd})
                                    if pt:
                                        db.session.execute(text("UPDATE item_log SET spec=:sp WHERE code=:pt OR part=:pt"), {'sp': sp, 'pt': pt})
                        # system_setting 행 자동 제거
                        SystemSetting.query.filter_by(key='admin_items').delete()
                    except Exception as ex:
                        app.logger.error(f"Failed to sync AdminItem table: {ex}")

            elif payload.get('key') in ['check_type_categories', 'check_type_categories2', 'check_type_categories3', 'check_type_category_list']:
                val = payload.get('value', {})
                if isinstance(val, list):
                    try:
                        CheckTypeCategory.query.delete()
                        for idx, item in enumerate(val, 1):
                            if isinstance(item, dict):
                                db.session.add(CheckTypeCategory(
                                    id=item.get('id', idx),
                                    check_type=item.get('check_type', item.get('checkType', '')),
                                    type_detail=item.get('type_detail', item.get('typeDetail', '')),
                                    type_detail2=item.get('type_detail2', item.get('typeDetail2', '')),
                                    type_detail3=item.get('type_detail3', item.get('typeDetail3', '')),
                                    sort_order=item.get('sort_order', idx)
                                ))
                    except Exception as ex:
                        app.logger.error(f"Failed to sync CheckTypeCategory table: {ex}")
                
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        # [추가] 500 에러 발생 시 정확한 원인 파악을 위해 상세 에러 로그 기록
        app.logger.error(f"Admin CRUD Error ({domain} - {action}): {str(e)}", exc_info=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] equipment_models 약어 매핑 관련 헬퍼 함수
def get_equipment_model_alias_maps():
    """
    EquipmentModel 테이블의 (name <-> abbr) 매핑을 로드합니다.
    Returns:
      - full_to_abbr: full model name -> abbr
      - abbr_to_full: abbr -> full model name
    """
    import re as _re

    def _normalize_key(val):
        if not val:
            return ""
        return _re.sub(r'[^a-zA-Z0-9가-힣]', '', str(val)).lower()

    full_to_abbr = {}
    abbr_to_full = {}
    try:
        models = EquipmentModel.query.all()
        for m in models:
            n = m.name
            a = m.abbr or m.name
            if n and a:
                nn = _normalize_key(n)
                aa = _normalize_key(a)
                if nn and aa:
                    full_to_abbr[nn] = a
                    abbr_to_full[aa] = n
    except Exception as e:
        app.logger.warning(f"Failed to load EquipmentModel: {e}")

    return full_to_abbr, abbr_to_full

def normalize_equipment_model_to_abbr(model_name):
    """equipment.name/equipment.id의 모델 토큰을 약어(abbr)로 정규화합니다."""
    if model_name is None:
        return model_name
    model_name = str(model_name).strip()
    if not model_name or model_name == '기타(ETC)':
        return model_name

    import re as _re
    def _normalize_key(val):
        if not val:
            return ""
        return _re.sub(r'[^a-zA-Z0-9가-힣]', '', str(val)).lower()

    full_to_abbr, _ = get_equipment_model_alias_maps()
    norm = _normalize_key(model_name)
    return full_to_abbr.get(norm, model_name)

# [추가] equipment.id 직접 조회 헬퍼 함수
def lookup_equipment_id(equip_id=None, site=None, equip_key=None):
    """UI 키 또는 조합 ID를 DB의 equipment.id로 직접 매핑합니다."""
    import unicodedata, re

    def norm(val):
        if val is None:
            return ''
        return unicodedata.normalize('NFC', str(val).strip())

    def collapse(val):
        return re.sub(r':{2,}', '::', norm(val).rstrip(':'))

    candidates = []
    if equip_id:
        clean = collapse(equip_id)
        candidates.append(clean)
        candidates.append(norm(equip_id).rstrip(':'))

    if site and equip_key:
        combined = collapse(f"{norm(site)}::{norm(equip_key)}")
        candidates.append(combined)

    seen = set()
    for cid in candidates:
        if not cid or cid in seen:
            continue
        seen.add(cid)
        found = Equipment.query.filter_by(id=cid).first()
        if found:
            return found.id

    search_site = norm(site) if site else ''
    search_key = norm(equip_key) if equip_key else ''

    if not search_site and equip_id:
        parts = collapse(equip_id).split('::')
        if parts:
            search_site = parts[0]
            search_key = '::'.join(parts[1:])

    if not search_site:
        return equip_id

    key_parts = search_key.split('::')
    e_name = key_parts[0] if len(key_parts) > 0 else ''
    e_name = normalize_equipment_model_to_abbr(e_name)
    e_serial = (key_parts[1] if len(key_parts) > 1 else '').replace('?', '-').replace('"', '')
    e_cust = (key_parts[2] if len(key_parts) > 2 else '').replace('?', '-')

    if e_name == '기타(ETC)':
        found = Equipment.query.filter_by(site_name=search_site, name='기타(ETC)').first()
        if found:
            return found.id

    query = Equipment.query.filter_by(site_name=search_site, name=e_name)
    if e_serial:
        query = query.filter_by(serial=e_serial)
    equips = query.all()

    if e_cust and equips:
        for eq in equips:
            cust = eq.cust_equip_name or ''
            if cust == e_cust:
                return eq.id

    if len(equips) == 1:
        return equips[0].id

    return resolve_master_equip_id(equip_id or f"{search_site}::{search_key}")

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

    # [추가] EquipmentModel 테이블에서 모델명 <-> 약어 매핑 맵 구축
    model_alias_map = {}
    try:
        models_data = EquipmentModel.query.all()
        for m in models_data:
            n = normalize_key(m.name)
            a = normalize_key(m.abbr or m.name)
            if n and a:
                model_alias_map[n] = a
                model_alias_map[a] = n
    except Exception as e:
        app.logger.warning(f"Failed to load EquipmentModel: {e}")

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
                # [유령데이터 방지] 작업 완료 시 maint_log(LogItem)에서 동일 장비 내 동일 물품의 중복/미정형 잔재 레코드(status='작업예정' 및 id != item.id) 자동 제거
                try:
                    clean_kw = re.sub(r'\[.*?\]', '', pure_p).strip()
                    if equip_id:
                        LogItem.query.filter(
                            LogItem.equip_id == equip_id,
                            LogItem.id != item.id,
                            LogItem.status == '작업예정',
                            ((LogItem.content == pure_p) | (LogItem.content == code_val) |
                             (LogItem.content.like(f"%{pure_p}%")) | (LogItem.content.like(f"%{code_val}%")) |
                             (LogItem.content.like(f"%{clean_kw}%")))
                        ).delete(synchronize_session=False)
                except Exception:
                    pass
                c_serial = normalize_key(cand.serial)
                c_cust = normalize_key(cand.cust_equip_name) if cand.cust_equip_name else ""
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
        c_cust = normalize_key(cand.cust_equip_name) if cand.cust_equip_name else ""
        c_model = c_name
        c_id = normalize_key(cand.id)

        c_name_alias = model_alias_map.get(c_name, "")
        c_model_alias = model_alias_map.get(c_model, "")

        score = 0
        for tok in norm_tokens:
            if not tok: continue
            if tok == c_site: score += 10
            elif (tok in c_site or (c_site and c_site in tok)) and min(len(tok), len(c_site) if c_site else 0) >= 2: score += 5

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

def reassign_child_extra_works(equip_id, deleted_ids):
    """
    [요청 반영] 최초 작업(부모 작업) 삭제 시:
    가장 첫 번째 추가작업(추가작업 1)을 최초 작업(original_log_id = None)으로 격상하고,
    나머지 추가작업들의 original_log_id를 해당 추가작업 1의 ID로 업데이트.
    """
    if not deleted_ids or not equip_id:
        return

    for d_id in deleted_ids:
        d_id_str = str(d_id).strip()
        if not d_id_str:
            continue

        # 삭제 대상 최초 작업의 기존 TroubleLog 조회
        old_trouble = TroubleLog.query.filter_by(id=d_id_str).first()

        # 삭제 대상 항목 ID를 original_log_id로 가지고 있는 자식 작업들 조회 (조치일/예정일/ID 순 정렬)
        children = LogItem.query.filter(
            LogItem.equip_id == equip_id,
            LogItem.original_log_id == d_id_str
        ).order_by(
            db.func.coalesce(LogItem.date, LogItem.scheduled_date).asc(),
            LogItem.id.asc()
        ).all()

        if children:
            # 1. 가장 첫 번째 추가작업(추가작업 1)이 새로운 최초 작업(부모)이 됨 (original_log_id = None)
            new_parent = children[0]
            new_parent_id = str(new_parent.id)
            new_parent.original_log_id = None

            # 2. 기존 최초 작업의 TroubleLog 작성 데이터가 존재하면 새로운 최초 작업(new_parent_id)의 TroubleLog로 이전
            if old_trouble:
                new_trouble = TroubleLog.query.filter_by(id=new_parent_id).first()
                if not new_trouble:
                    new_trouble = TroubleLog(
                        id=new_parent_id,
                        equip_id=equip_id,
                        type='비정기',
                        detail_type=new_parent.detail_type or old_trouble.detail_type or '',
                        detail_type2=getattr(new_parent, 'detail_type2', '') or old_trouble.detail_type2 or '',
                        detail_type3=getattr(new_parent, 'detail_type3', '') or old_trouble.detail_type3 or ''
                    )
                    db.session.add(new_trouble)

                if old_trouble.occur_date:
                    new_trouble.occur_date = old_trouble.occur_date
                if old_trouble.situation:
                    new_trouble.situation = old_trouble.situation
                if old_trouble.symptom:
                    new_trouble.symptom = old_trouble.symptom
                if old_trouble.cause:
                    new_trouble.cause = old_trouble.cause
                if old_trouble.measure:
                    new_trouble.measure = old_trouble.measure
                if old_trouble.prevent:
                    new_trouble.prevent = old_trouble.prevent
                if old_trouble.image_data:
                    new_trouble.image_data = old_trouble.image_data
                if old_trouble.status:
                    new_trouble.status = old_trouble.status

            # 3. 나머지 추가작업들의 original_log_id를 추가작업 1의 ID로 수정
            for child in children[1:]:
                child.original_log_id = new_parent_id

        # 4. 삭제된 기존 최초 작업의 TroubleLog 레코드는 DB에서 완전히 삭제
        if old_trouble:
            TroubleLog.query.filter_by(id=d_id_str).delete(synchronize_session=False)

# [추가] 유지관리 및 캘린더 장비 이력 100% DB 동기화 전용 트랜잭션 API
@app.route('/api/history/transaction', methods=['POST'])
@login_required
@limiter.exempt
def history_transaction():
    data = request.json or {}
    equip_id = data.get('equip_id')
    maint_upserts = data.get('maint_upserts', [])
    maint_deletes = data.get('maint_deletes', [])
    log_upserts = data.get('log_upserts', [])
    log_deletes = data.get('log_deletes', [])

    if equip_id:
        equip_id = lookup_equipment_id(equip_id=equip_id)

    # [Rule 3 준수] DB에 등록되지 않은 마스터 장비 데이터 자동 생성 차단
    if equip_id and not Equipment.query.filter_by(id=equip_id).first():
        app.logger.warning(f"[Rule 3] 등록되지 않은 마스터 장비 차단: {equip_id}")
        return jsonify({'status': 'fail', 'message': f'등록되지 않은 마스터 장비 데이터입니다 ({equip_id}). ADMIN에서 장비를 수동으로 등록해주세요.'}), 400

    try:
        # 1. log_upserts (작업 완료 처리)
        completed_orig_ids = set()
        for l in log_upserts:
            l_id = str(l.get('id', ''))
            orig_id = str(l.get('originalLogId') or '').strip()
            if orig_id and orig_id != 'None' and orig_id != '-':
                completed_orig_ids.add(orig_id)

            item = None
            if l_id:
                item = LogItem.query.filter_by(id=l_id).first()

            # l_id로 찾지 못하고 orig_id가 존재하는 경우, 해당 orig_id 작업이 '작업예정' 상태이고 l_id == orig_id 인 경우에만
            # 기존 작업예정 건을 조치완료 상태로 전환 (추가작업(l_id != orig_id)인 경우 원본 작업을 덮어쓰지 않고 독립 신규 생성)
            if not item and orig_id and orig_id != 'None' and orig_id != '-':
                if not l_id or l_id == orig_id:
                    orig_item = LogItem.query.filter_by(id=orig_id).first()
                    if orig_item and orig_item.status == '작업예정':
                        item = orig_item

            if not item:
                item = LogItem(id=l_id, equip_id=equip_id, status='조치완료')
                db.session.add(item)

            # [수정] 원본 작업예정 레코드(orig_id)가 별도 신규 l_id로 조치완료된 경우 원본 작업예정 레코드 삭제 (유령 데이터 방지)
            if orig_id and orig_id != 'None' and orig_id != '-' and orig_id != l_id:
                try:
                    LogItem.query.filter(LogItem.id == orig_id, LogItem.status == '작업예정').delete(synchronize_session=False)
                except Exception:
                    pass

            item.equip_id = equip_id
            item.status = '조치완료'
            item.date = l.get('date', item.date)
            item.scheduled_date = l.get('scheduledDate') or l.get('scheduled_date') or item.scheduled_date or l.get('date')
            item.type = l.get('type', item.type)
            raw_dt1 = str(l.get('detailType') or l.get('detail_type') or item.detail_type or '').strip()
            raw_dt2 = str(l.get('detailType2') or l.get('detail_type2') or getattr(item, 'detail_type2', '') or '').strip()
            raw_dt3 = str(l.get('detailType3') or l.get('detail_type3') or getattr(item, 'detail_type3', '') or '').strip()
            if '>' in raw_dt1:
                parts = [p.strip() for p in raw_dt1.split('>') if p.strip()]
                if len(parts) >= 1: raw_dt1 = parts[0]
                if len(parts) >= 2 and not raw_dt2: raw_dt2 = parts[1]
                if len(parts) >= 3 and not raw_dt3: raw_dt3 = parts[2]
            item.detail_type = raw_dt1
            item.detail_type2 = raw_dt2
            item.detail_type3 = raw_dt3
            item.content = l.get('content', item.content)
            item.add_work = l.get('addWork', getattr(item, 'add_work', ''))
            item.cost_type = l.get('costType', getattr(item, 'cost_type', ''))
            item.md = str(l.get('md', getattr(item, 'md', '')))
            item.worker = l.get('worker', item.worker)
            item.memo = l.get('memo', item.memo)
            item.start_time = l.get('startTime', getattr(item, 'start_time', ''))
            item.end_time = l.get('endTime', getattr(item, 'end_time', ''))
            item.is_issue_shared = bool(l.get('isIssueShared', getattr(item, 'is_issue_shared', False)))
            item.original_log_id = orig_id if orig_id else item.original_log_id
            item.add_work_log_id = str(l.get('addWorkLogId')) if l.get('addWorkLogId') else getattr(item, 'add_work_log_id', None)

            # [요청 반영] item_log DB에서 콤마(,)가 포함된 결합 레코드 및 비물품 키워드 레코드 자동 정리
            try:
                invalid_kws = ['내용 없음', '장비 점검', 'PM 점검', 'BM 점검', '파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '파츠 이상 교체', '파츠 이상 수리', '물품 이상 교체', '물품 이상 수리', '단순 조치', '현장 이슈', 'PC 이상', '작업자 실수', '통신 이상', '프로그램 이상', '기타']
                ItemLog.query.filter(
                    ItemLog.equip_id == equip_id,
                    (ItemLog.code.like('%,%')) | (ItemLog.part.like('%,%')) |
                    (ItemLog.code.in_(invalid_kws)) | (ItemLog.part.in_(invalid_kws))
                ).delete(synchronize_session=False)
            except Exception:
                pass

            # [요청 반영] 완료된 작업 내용(content)에 물품이 포함되어 있으면 item_log(유지관리 물품) 및 maint_log(LogItem)의 물품 규격화 & 유령 데이터 제거
            c_text = l.get('content') or item.content or ''
            if c_text and c_text != '내용 없음':
                sub_parts = [sp.strip() for sp in c_text.split(',') if sp.strip()]
                formatted_contents = []
                for sp in sub_parts:
                    clean_sp = re.sub(r'^\[(유상|무상|기타)\]\s*', '', sp).strip()
                    if not clean_sp or clean_sp in ['내용 없음', '장비 점검']:
                        continue

                    parsed = parse_part_item_string(sp)
                    if not parsed:
                        formatted_contents.append(clean_sp)
                        continue

                    pure_p = parsed['clean_name']
                    cost_tag = parsed.get('cost_tag') or '유상'
                    spec_tag = parsed.get('part_detail') or ''

                    invalid_kws = ['내용 없음', '장비 점검', 'PM 점검', 'BM 점검', '파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '파츠 이상 교체', '파츠 이상 수리', '물품 이상 교체', '물품 이상 수리', '단순 조치', '현장 이슈', 'PC 이상', '작업자 실수', '통신 이상', '프로그램 이상', '기타']
                    if not pure_p or pure_p in invalid_kws or ',' in pure_p:
                        formatted_contents.append(clean_sp)
                        continue

                    # AdminItem 매칭 (코드명 AdminItem.code 우선 검색 후 물품명 AdminItem.part 검색)
                    match_admin = AdminItem.query.filter(
                        (AdminItem.code == pure_p) | (db.func.trim(AdminItem.code) == pure_p)
                    ).first()
                    if not match_admin:
                        match_admin = AdminItem.query.filter(
                            (AdminItem.part == pure_p) | (db.func.trim(AdminItem.part) == pure_p)
                        ).first()

                    # [Rule 3 / 사용자 요청] AdminItem 마스터 DB에 등록되지 않은 일반 텍스트는 비용처리 라벨 제거 후 저장 (item_log 자동 생성 차단)
                    if not match_admin:
                        formatted_contents.append(clean_sp)
                        continue

                    code_val = match_admin.code if match_admin.code else pure_p
                    part_name_val = match_admin.part if match_admin.part else pure_p
                    spec_val = (match_admin.spec if match_admin and match_admin.spec else '') or spec_tag or ''
                    cycle_val = getattr(match_admin, 'cycle', None) if match_admin else getattr(item, 'period', None)

                    # [Rule 11] 표준 물품 표현 방식으로 번들링: [비용처리] 코드명 [물품상세] 또는 [비용처리] 코드명 1세트화
                    std_part = f"[{cost_tag}] {code_val} [{spec_tag}]" if spec_tag else f"[{cost_tag}] {code_val}"
                    formatted_contents.append(std_part)

                    # 기존 ItemLog DB에서 동일 equip_id, 물품명(code/part/pure_p) 및 물품상세(part_detail) 매칭 검색 (독립 세트 보장)
                    exist_log = ItemLog.query.filter(
                        ItemLog.equip_id == equip_id,
                        ((ItemLog.part == part_name_val) | (ItemLog.code == code_val) |
                         (ItemLog.part == pure_p) | (ItemLog.code == pure_p)),
                        db.func.coalesce(ItemLog.part_detail, '') == (spec_tag or '')
                    ).first()

                    if not exist_log:
                        exist_log = ItemLog(
                            id=f"item_{int(time.time()*1000)}_{random.randint(100, 999)}",
                            equip_id=equip_id,
                            date=l.get('date', item.date or ''),
                            code=code_val,
                            part=part_name_val,
                            spec=spec_val,
                            part_detail=spec_tag,
                            cycle=str(cycle_val) if cycle_val is not None else None
                        )
                        db.session.add(exist_log)
                    else:
                        if l.get('date'):
                            exist_log.date = l.get('date')
                        if code_val:
                            exist_log.code = code_val
                        if part_name_val:
                            exist_log.part = part_name_val
                        if spec_val:
                            exist_log.spec = spec_val
                        exist_log.part_detail = spec_tag
                        if cycle_val is not None:
                            exist_log.cycle = str(cycle_val)

                    # [추가] 동일 장비 내 동일 물품/동일 물품상세의 중복 레코드만 정리 (다른 물품상세 레코드는 보호)
                    if exist_log and exist_log._unique_id:
                        try:
                            ItemLog.query.filter(
                                ItemLog.equip_id == equip_id,
                                ((ItemLog.part == part_name_val) | (ItemLog.code == code_val) |
                                 (ItemLog.part == pure_p) | (ItemLog.code == pure_p)),
                                db.func.coalesce(ItemLog.part_detail, '') == (spec_tag or ''),
                                ItemLog._unique_id != exist_log._unique_id
                            ).delete(synchronize_session=False)
                        except Exception:
                            pass

                    # [유령데이터 방지] 작업 완료 시 maint_log(LogItem)에서 동일 장비 내 동일 물품의 중복/미정형 잔재 레코드(status='작업예정' 및 id != item.id) 자동 제거
                    try:
                        LogItem.query.filter(
                            LogItem.equip_id == equip_id,
                            LogItem.id != item.id,
                            LogItem.status == '작업예정',
                            ((LogItem.content == pure_p) | (LogItem.content == code_val) |
                             (LogItem.content.like(f"%{pure_p}%")) | (LogItem.content.like(f"%{code_val}%")))
                        ).delete(synchronize_session=False)
                    except Exception:
                        pass

                if formatted_contents:
                    item.content = ', '.join(formatted_contents)
                else:
                    item.content = '내용 없음'

        # 2. maint_deletes 처리 (LogItem 및 ItemLog 삭제 - maint_upserts 대상 보호)
        if maint_deletes:
            maint_upsert_ids = {str(m.get('id', '')) for m in maint_upserts}
            actual_deletes = [str(d) for d in maint_deletes if str(d) not in maint_upsert_ids]
            if actual_deletes:
                deleted_log_items = LogItem.query.filter(LogItem.id.in_(actual_deletes)).all()
                deleted_codes = set()
                for d_item in deleted_log_items:
                    if d_item.content:
                        parsed = parse_part_item_string(d_item.content)
                        if parsed and parsed.get('clean_name'):
                            deleted_codes.add(parsed['clean_name'])
                        clean_c = re.sub(r'\[.*?\]', '', d_item.content).strip()
                        if clean_c:
                            deleted_codes.add(clean_c)

                # 1) ItemLog (item_log) DB에서 id 또는 equip_id + code/part로 동시 삭제
                ItemLog.query.filter(ItemLog.id.in_(actual_deletes)).delete(synchronize_session=False)
                if equip_id and deleted_codes:
                    ItemLog.query.filter(
                        ItemLog.equip_id == equip_id,
                        (ItemLog.code.in_(deleted_codes) | ItemLog.part.in_(deleted_codes))
                    ).delete(synchronize_session=False)

                # 2) LogItem (maint_log) DB에서 삭제
                LogItem.query.filter(LogItem.id.in_(actual_deletes)).delete(synchronize_session=False)
                reassign_child_extra_works(equip_id, actual_deletes)

        # 3. maint_upserts (작업 예정 생성/수정 및 유지관리 물품 item_log동기화)
        for idx, m in enumerate(maint_upserts):
            m_id = str(m.get('id', '')).strip()
            if not m_id:
                m_id = str(int(time.time() * 1000))
                m['id'] = m_id

            m_sched_date = str(m.get('scheduledDate') or m.get('scheduled_date') or '').strip()
            m_type = str(m.get('type') or '').strip()
            # 예정일(scheduledDate)이 명시된 경우에만 LogItem(maint_log) 작업예정 레코드 생성 (유령 데이터 방지)
            is_scheduled_task = bool(m_sched_date and m_sched_date != '-')

            item = None
            if is_scheduled_task:
                # 1) exact ID matching
                item = LogItem.query.filter_by(id=m_id).first()

                # 2) legacy ID matching: 이전 버그로 인해 id가 'item_{m_id}_%' 형태로 DB에 저장된 LogItem 보정
                if not item:
                    legacy_item = LogItem.query.filter(
                        LogItem.equip_id == equip_id,
                        LogItem.id.like(f"item_{m_id}_%")
                    ).first()
                    if legacy_item:
                        item = legacy_item
                        item.id = m_id  # 정상 task ID로 보정

                # 3) 작업 내용 및 날짜 기준 기존 작업예정 항목 추가 매칭 (중복 레코드 생성 방지)
                if not item:
                    m_content = m.get('content', '')
                    if m_sched_date and m_content:
                        parsed = parse_part_item_string(m_content)
                        clean_c = parsed['clean_name'] if (parsed and parsed.get('clean_name')) else re.sub(r'\[.*?\]', '', m_content).strip()
                        item = LogItem.query.filter(
                            LogItem.equip_id == equip_id,
                            LogItem.status == '작업예정',
                            LogItem.scheduled_date == m_sched_date,
                            ((LogItem.content == m_content) | (LogItem.content == clean_c) | (LogItem.content.like(f"%{clean_c}%")) if clean_c else False)
                        ).first()
                        if item:
                            item.id = m_id

                if not item:
                    item = LogItem(id=m_id, equip_id=equip_id, status='작업예정')
                    db.session.add(item)

                # 이전 버그로 생성된 동일 장비의 legacy duplicate LogItem 레코드 정밀 삭제
                try:
                    LogItem.query.filter(
                        LogItem.equip_id == equip_id,
                        LogItem.id.like(f"item_{m_id}_%"),
                        LogItem.id != item.id
                    ).delete(synchronize_session=False)
                except Exception:
                    pass

                item.equip_id = equip_id
                item.sort_order = idx
                item.status = '작업예정'
                item.type = m.get('type', item.type)
                m_dt1 = str(m.get('detailType') or m.get('detail_type') or item.detail_type or '').strip()
                m_dt2 = str(m.get('detailType2') or m.get('detail_type2') or getattr(item, 'detail_type2', '') or '').strip()
                m_dt3 = str(m.get('detailType3') or m.get('detail_type3') or getattr(item, 'detail_type3', '') or '').strip()
                if '>' in m_dt1:
                    parts = [p.strip() for p in m_dt1.split('>') if p.strip()]
                    if len(parts) >= 1: m_dt1 = parts[0]
                    if len(parts) >= 2 and not m_dt2: m_dt2 = parts[1]
                    if len(parts) >= 3 and not m_dt3: m_dt3 = parts[2]
                item.detail_type = m_dt1
                item.detail_type2 = m_dt2
                item.detail_type3 = m_dt3
                item.content = m.get('content', item.content)
                item.date = m.get('date', item.date)
                item.period = str(m.get('period')) if m.get('period') is not None else item.period
                item.scheduled_date = m_sched_date
                item.cost_type = m.get('costType', getattr(item, 'cost_type', ''))
                item.worker = m.get('worker', item.worker)
                item.md = str(m.get('md', getattr(item, 'md', '')))
                item.memo = m.get('memo', item.memo)
                item.original_log_id = str(m.get('originalLogId')) if m.get('originalLogId') else item.original_log_id
            else:
                # [사용자 요청] 순수 유지관리 물품인 경우 maint_log(LogItem) 잔재 데이터 제거 및 신규 기록 방지
                LogItem.query.filter_by(id=m_id).delete(synchronize_session=False)

            # [수정/추가] item_log(ItemLog) DB 동기화 (물품상세 spec / part_detail)
            m_code = m.get('code') or m.get('content') or ''
            m_spec = m.get('spec', '') if m.get('spec') is not None else ''
            m_date = m.get('date', '') or ''
            m_period = str(m.get('period')) if m.get('period') is not None else None

            if m_code and equip_id:
                invalid_kws = ['내용 없음', '장비 점검', 'PM 점검', 'BM 점검', '파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '파츠 이상 교체', '파츠 이상 수리', '물품 이상 교체', '물품 이상 수리', '단순 조치', '현장 이슈', 'PC 이상', '작업자 실수', '통신 이상', '프로그램 이상', '기타']
                parsed_c = parse_part_item_string(m.get('content') or (item.content if item else '') or m_code)
                clean_code = parsed_c['clean_name'] if (parsed_c and parsed_c.get('clean_name')) else re.sub(r'\[.*?\]', '', m_code).strip()

                if clean_code and clean_code not in invalid_kws and ',' not in clean_code:
                    if item:
                        item.content = f"{clean_code} [{m_spec}]" if m_spec else clean_code

                    # Master AdminItem 데이터 조회하여 code, part, spec 수집
                    match_admin = AdminItem.query.filter(
                        (AdminItem.code == clean_code) | (db.func.trim(AdminItem.code) == clean_code) |
                        (AdminItem.part == clean_code) | (db.func.trim(AdminItem.part) == clean_code)
                    ).first()

                    # [Rule 3 / 사용자 요청 반영] AdminItem 마스터 DB에 등록되지 않은 일반 텍스트는 ItemLog(유지관리 물품) 자동 생성 차단
                    if not match_admin:
                        continue

                    code_val = match_admin.code if match_admin.code else clean_code
                    part_name_val = match_admin.part if match_admin.part else clean_code
                    spec_val = (match_admin.spec if match_admin.spec else '') or m_spec

                    # ItemLog (item_log DB) 동시 동기화 (독립 세트 보장)
                    il_rec = ItemLog.query.filter_by(id=m_id).first() if m_id.startswith('item_') else None
                    if not il_rec:
                        il_rec = ItemLog.query.filter(
                            ItemLog.equip_id == equip_id,
                            ((ItemLog.code == code_val) | (ItemLog.part == part_name_val) |
                             (ItemLog.code == clean_code) | (ItemLog.part == clean_code)),
                            db.func.coalesce(ItemLog.part_detail, '') == (m_spec or '')
                        ).first()

                    if il_rec:
                        il_rec.code = code_val
                        il_rec.part = part_name_val
                        if spec_val: il_rec.spec = spec_val
                        il_rec.part_detail = m_spec
                        if m_date: il_rec.date = m_date
                        if m_period is not None: il_rec.cycle = str(m_period)
                    else:
                        item_log_id = m_id if m_id.startswith('item_') else f"item_{int(time.time()*1000)}_{random.randint(100, 999)}"
                        il_rec = ItemLog(
                            id=item_log_id,
                            equip_id=equip_id,
                            date=m_date,
                            code=code_val,
                            part=part_name_val,
                            spec=spec_val,
                            part_detail=m_spec,
                            cycle=str(m_period) if m_period is not None else None
                        )
                        db.session.add(il_rec)

            # [maint_log 유령데이터 정밀 정리] 순수 유지관리 물품(item_log) 등록/수정 시 maint_log의 동일 장비/동일 물품 잔재 작업예정 유령 데이터 정리
            if not is_scheduled_task:
                m_content = m.get('content', '') or m.get('code', '') or ''
                if equip_id:
                    parsed = parse_part_item_string(m_content)
                    clean_p = parsed['clean_name'] if (parsed and parsed.get('clean_name')) else re.sub(r'\[.*?\]', '', m_content).replace('파트 이상 교체 -', '').replace('파트 이상 수리 -', '').strip()
                    LogItem.query.filter(
                        LogItem.equip_id == equip_id,
                        LogItem.status == '작업예정',
                        (LogItem.id == m_id) | (LogItem.id.like('item_%')) | ((LogItem.content == clean_p) if clean_p else False) | ((LogItem.content.like(f"%{clean_p}%")) if clean_p else False)
                    ).delete(synchronize_session=False)

        # 4. log_deletes 처리 (maint_upserts에 포함된 완료 취소 항목은 DB 삭제 대상에서 제외)
        if log_deletes:
            maint_upsert_ids = {str(m.get('id', '')) for m in maint_upserts}
            actual_log_deletes = [str(d) for d in log_deletes if str(d) not in maint_upsert_ids]
            if actual_log_deletes:
                LogItem.query.filter(LogItem.id.in_(actual_log_deletes)).delete(synchronize_session=False)
                reassign_child_extra_works(equip_id, actual_log_deletes)

        # 비정기 작업(type == '비정기') 등록/수정 시 status와 관계없이 무조건 TroubleLog 연동
        non_regular_in_session = LogItem.query.filter(
            LogItem.equip_id == equip_id,
            db.func.trim(LogItem.type) == '비정기'
        ).all()

        all_log_ids = {str(l.id) for l in LogItem.query.filter_by(equip_id=equip_id).all()}
        trouble_logs_map = {str(t.id): t for t in TroubleLog.query.filter_by(equip_id=equip_id).all()}
        
        parent_logs = {}
        child_logs_map = {}

        for nl in non_regular_in_session:
            nl_id = str(nl.id)
            orig_id = str(getattr(nl, 'original_log_id', '') or '').strip()
            if orig_id in ('None', '-'):
                orig_id = ''

            # orig_id가 존재하고 부모 레코드가 실제로 존재하며 orig_id != nl_id 인 경우에만 추가작업(자식)으로 분류
            if orig_id and orig_id in all_log_ids and orig_id != nl_id:
                if orig_id not in child_logs_map:
                    child_logs_map[orig_id] = []
                child_logs_map[orig_id].append(nl)
                # 추가작업의 TroubleLog 독립 레코드는 제거
                TroubleLog.query.filter_by(id=nl_id).delete(synchronize_session=False)
            else:
                # 원본 작업 (TroubleLog에 1:1 필수 기록 대상)
                parent_logs[nl_id] = nl

        def clean_log_text(raw_val):
            if not raw_val:
                return ""
            val_str = str(raw_val).strip()
            if not val_str or val_str == '-':
                return ""
            if val_str.startswith('{') and val_str.endswith('}'):
                try:
                    parsed = json.loads(val_str)
                    parts = []
                    for key in ['situation', 'symptom', 'cause', 'action', 'measure', 'prevention', 'prevent', 'trouble_memo']:
                        v = str(parsed.get(key, '') or '').strip()
                        if v and v != '-':
                            parts.append(v)
                    if parts:
                        return "\n".join(parts)
                except Exception:
                    pass
            return val_str

        for p_id, p_log in parent_logs.items():
            t_item = trouble_logs_map.get(p_id)
            
            # 최초 및 추가작업 내용을 요청된 양식(<최초> (날짜 / 작업자))으로 통합 구성
            blocks = []
            p_date = str(p_log.date or p_log.scheduled_date or '').strip()[:10] or '미기록'
            p_worker = str(p_log.worker or '').strip() or '미지정'
            p_text = clean_log_text(p_log.memo or p_log.content)

            if p_text:
                blocks.append(f"<최초> ({p_date} / {p_worker})\n{p_text}")
            else:
                blocks.append(f"<최초> ({p_date} / {p_worker})")

            children = child_logs_map.get(p_id, [])
            for idx, c_log in enumerate(children, 1):
                c_date = str(c_log.date or c_log.scheduled_date or '').strip()[:10] or '미기록'
                c_worker = str(c_log.worker or '').strip() or '미지정'
                c_text = clean_log_text(c_log.memo or c_log.content)
                if c_text:
                    blocks.append(f"<추가{idx}> ({c_date} / {c_worker})\n{c_text}")
                else:
                    blocks.append(f"<추가{idx}> ({c_date} / {c_worker})")

            combined_details_str = "\n\n".join(blocks)

            if not t_item:
                t_item = TroubleLog(
                    id=p_id,
                    equip_id=p_log.equip_id,
                    occur_date='',
                    action_date=p_log.date or p_log.scheduled_date or '',
                    type='비정기',
                    detail_type=p_log.detail_type or '',
                    detail_type2=getattr(p_log, 'detail_type2', '') or '',
                    detail_type3=getattr(p_log, 'detail_type3', '') or '',
                    trouble_details=combined_details_str,
                    status='미기록',
                    image_data=getattr(p_log, 'image_data', '')
                )
                db.session.add(t_item)
                trouble_logs_map[p_id] = t_item
            else:
                t_item.type = '비정기'
                t_item.detail_type = p_log.detail_type or ''
                t_item.detail_type2 = getattr(p_log, 'detail_type2', '') or ''
                t_item.detail_type3 = getattr(p_log, 'detail_type3', '') or ''
                t_item.action_date = p_log.date or p_log.scheduled_date or t_item.action_date
                if combined_details_str:
                    t_item.trouble_details = combined_details_str
                t_item.status = '기록완료' if (t_item.occur_date and str(t_item.occur_date).strip() not in ('', '-')) else '미기록'
                t_item.image_data = getattr(p_log, 'image_data', '') or t_item.image_data

        # [유령데이터 방지] parent_logs에 속하지 않는 장비 내 잔재 고아(Orphan) TroubleLog 유령 레코드 완전 제거
        for t_id in list(trouble_logs_map.keys()):
            if t_id not in parent_logs:
                TroubleLog.query.filter_by(id=t_id).delete(synchronize_session=False)

        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"History Transaction Error: {str(e)}", exc_info=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] 장비별 item_log 유지관리 물품 리스트 조회 API
@app.route('/api/item_log/<path:equip_id>', methods=['GET'])
@login_required
def get_item_logs_by_equip(equip_id):
    try:
        import urllib.parse
        import unicodedata
        equip_id = urllib.parse.unquote(equip_id).strip()
        equip_id = unicodedata.normalize('NFC', equip_id)

        items = ItemLog.query.filter_by(equip_id=equip_id).all()
        result = [{
            "id": item.id,
            "equip_id": item.equip_id,
            "date": item.date,
            "code": item.code,
            "part": item.part,
            "spec": item.spec,
            "part_detail": item.part_detail,
            "cycle": item.cycle
        } for item in items]
        return jsonify({"status": "success", "items": result})
    except Exception as e:
        return jsonify({"status": "fail", "message": str(e)}), 500

# [추가] 셋업 화면 데이터 전용 100% DB 동기화 API
@app.route('/api/setup/sync_equip', methods=['POST'])
@login_required
@limiter.exempt
def sync_setup_equip():
    data = request.json or {}
    equip_id = data.get('equip_id')
    details = data.get('details')
    logs = data.get('logs')

    try:
        app.logger.warning(f"[Sync Setup] Received raw equip_id: {equip_id}")

        if equip_id:
            import urllib.parse
            import unicodedata
            equip_id = urllib.parse.unquote(equip_id).strip()
            equip_id = unicodedata.normalize('NFC', equip_id)

        if equip_id:
            equip = Equipment.query.filter_by(id=equip_id).first()
            if not equip:
                equip = Equipment.query.filter(Equipment.id.like(f"{equip_id}%")).first()

            if not equip:
                parts_equip = [p.strip() for p in equip_id.split('::') if p.strip()]
                if len(parts_equip) >= 3:
                    s_name = parts_equip[0]
                    m_name = parts_equip[1]
                    m_abbr = normalize_equipment_model_to_abbr(m_name)
                    s_num = parts_equip[2]
                    equip = Equipment.query.filter(
                        Equipment.site_name == s_name,
                        (Equipment.name == m_name) | (Equipment.name == m_abbr),
                        Equipment.serial == s_num
                    ).first()

            if not equip:
                all_equips = Equipment.query.all()
                import unicodedata
                norm_equip_id = unicodedata.normalize('NFC', equip_id)
                parts_equip = [unicodedata.normalize('NFC', p.strip()) for p in norm_equip_id.split('::')]
                parts_equip_clean = [" ".join(p.split()) for p in parts_equip if p]

                for eq in all_equips:
                    norm_db_id = unicodedata.normalize('NFC', eq.id)
                    parts_db = [unicodedata.normalize('NFC', p.strip()) for p in norm_db_id.split('::')]
                    parts_db_clean = [" ".join(p.split()) for p in parts_db if p]

                    min_len = min(len(parts_equip_clean), len(parts_db_clean))
                    if min_len >= 3:
                        match = True
                        for idx in range(min_len):
                            v1 = parts_equip_clean[idx]
                            v2 = parts_db_clean[idx]
                            n1 = normalize_equipment_model_to_abbr(v1)
                            n2 = normalize_equipment_model_to_abbr(v2)
                            if v1 != v2 and n1 != n2 and n1 != v2 and v1 != n2:
                                match = False
                                break
                        if match:
                            equip = eq
                            break

            if not equip:
                return jsonify({"status": "fail", "message": f"등록되지 않은 장비 정보입니다. ADMIN 메뉴에서 해당 장비를 먼저 등록해주세요. (ID: {equip_id})"}), 400

            equip_id = equip.id

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
    log_items = LogItem.query.filter(db.func.trim(LogItem.type) == '비정기').all()

    equips = {eq.id: eq for eq in Equipment.query.all()}

    def get_eq_info(equip_id):
        if equip_id:
            eq = equips.get(equip_id)
            cust_name = eq.cust_equip_name if eq and eq.cust_equip_name else ""
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

    log_map = {str(l.id): l for l in LogItem.query.all()}
    result = []
    for t in troubles:
        site_name, equip_name = get_eq_info(t.equip_id)
        m_log = log_map.get(str(t.id))
        td_val = getattr(t, 'trouble_details', '') or ''

        result.append({
            "id": t.id,
            "source": "trouble",
            "equip_id": t.equip_id,
            "site": site_name,
            "equip": equip_name,
            "occur_date": t.occur_date,
            "action_date": getattr(t, 'action_date', '') or (m_log.date if m_log and m_log.date else (getattr(m_log, 'scheduled_date', '') if m_log else '')),
            "type": getattr(t, 'type', '') or (m_log.type if m_log else '비정기'),
            "detail_type": getattr(t, 'detail_type', '') or (m_log.detail_type if m_log else '-'),
            "detail_type2": getattr(t, 'detail_type2', '') or (getattr(m_log, 'detail_type2', '') if m_log else '-'),
            "detail_type3": getattr(t, 'detail_type3', '') or (getattr(m_log, 'detail_type3', '') if m_log else '-'),
            "situation": getattr(t, 'situation', '') or '',
            "symptom": getattr(t, 'symptom', '') or '',
            "cause": getattr(t, 'cause', '') or '',
            "measure": getattr(t, 'measure', '') or '',
            "prevent": getattr(t, 'prevent', '') or '',
            "check_item": (m_log.content if m_log else '-') or '-',
            "content": td_val,
            "trouble_details": td_val,
            "memo": (m_log.memo if m_log else '') or '',
            "worker": (m_log.worker if m_log else '') or '',
            "status": "기록완료" if (t.occur_date and str(t.occur_date).strip() not in ('', '-')) else "미기록",
            "image_data": t.image_data or (getattr(m_log, 'image_data', '') if m_log else ''),
            "group_key": f"trouble_{t.id}"
        })

    for l in log_items:
        if str(l.id) in [str(t.id) for t in troubles]:
            continue  # 이미 TroubleLog 항목으로 포함됨

        orig_id = str(getattr(l, 'original_log_id', '') or '').strip()
        add_work_id = str(getattr(l, 'add_work_log_id', '') or '').strip()
        if orig_id or add_work_id:
            continue  # 추가작업 항목은 최초작업 trouble_details에 통합 관리되므로 독립 행 노출 생략
        l_id = str(l.id or '').strip()

        date_str = str(l.date or '').strip()[:10]
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

        text_val = str(l.memo or l.content or '').strip()
        safe_content = json.dumps({'situation': text_val}, ensure_ascii=False) if text_val and text_val != '-' else ''

        result.append({
            "id": l_id,
            "source": "log",
            "equip_id": l.equip_id,
            "site": site_name,
            "equip": equip_name,
            "occur_date": "",
            "action_date": l.date or getattr(l, 'scheduled_date', '') or '',
            "type": l.type,
            "detail_type": l.detail_type,
            "detail_type2": l.detail_type2,
            "detail_type3": getattr(l, 'detail_type3', ''),
            "check_item": l.content,
            "content": safe_content,
            "trouble_details": safe_content,
            "memo": l.memo,
            "worker": l.worker,
            "status": "미기록",
            "image_data": getattr(l, 'image_data', ''),
            "group_key": group_key,
            "original_log_id": orig_id if orig_id else None
        })
        
    grouped = {}
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
            
        raw_items = item.get('_raw_items', [])
        if len(raw_items) > 1:
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
                    date_val = r_item.get('action_date') or r_item.get('occur_date') or ''
                    if len(date_val) >= 10:
                        date_val = date_val[:10]
                    
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
    payload = data.get('payload', {})
    user = User.query.filter_by(id=session.get('user_id')).first()
    worker_name = user.name if user and user.name else session.get('user_id')
    
    try:
        if action == 'CREATE':
            content_val = payload.get('content', '')
            if isinstance(content_val, (dict, list)):
                content_val = json.dumps(content_val, ensure_ascii=False)
            else:
                content_val = str(content_val) if content_val is not None else ''

            trouble_details_val = payload.get('trouble_details', '')
            if isinstance(trouble_details_val, (dict, list)):
                trouble_details_val = json.dumps(trouble_details_val, ensure_ascii=False)
            elif not trouble_details_val:
                trouble_details_val = content_val

            equip_id = payload.get('equip_id')
            if not equip_id and payload.get('site') and payload.get('equip'):
                equip_id = lookup_equipment_id(None, payload.get('site'), payload.get('equip'))
            elif equip_id:
                equip_id = lookup_equipment_id(equip_id, payload.get('site'), payload.get('equip'))

            occ_val = payload.get('occur_date', '')
            status_val = '기록완료' if (occ_val and str(occ_val).strip() not in ('', '-')) else '미기록'

            sit_val = payload.get('situation', '')
            sym_val = payload.get('symptom', '')
            cau_val = payload.get('cause', '')
            mea_val = payload.get('measure', '') or payload.get('action', '')
            pre_val = payload.get('prevent', '') or payload.get('prevention', '')

            if isinstance(content_val, dict):
                sit_val = sit_val or content_val.get('situation', '')
                sym_val = sym_val or content_val.get('symptom', '')
                cau_val = cau_val or content_val.get('cause', '')
                mea_val = mea_val or content_val.get('action', '')
                pre_val = pre_val or content_val.get('prevention', '')

            new_log = TroubleLog(
                id=str(payload.get('id')), 
                equip_id=equip_id, 
                occur_date=occ_val, 
                action_date=payload.get('action_date', ''), 
                type=payload.get('type', '비정기'),
                detail_type=payload.get('detail_type', ''),
                detail_type2=payload.get('detail_type2', ''),
                detail_type3=payload.get('detail_type3', ''),
                situation=sit_val,
                symptom=sym_val,
                cause=cau_val,
                measure=mea_val,
                prevent=pre_val,
                trouble_details=trouble_details_val,
                status=status_val, 
                image_data=payload.get('image_data', '')
            )
            db.session.add(new_log)

            # maint_log에도 기본 작업 정보 동기화 유지
            m_item = LogItem.query.filter_by(id=str(payload.get('id'))).first()
            if not m_item:
                m_item = LogItem(
                    id=str(payload.get('id')),
                    equip_id=equip_id,
                    date=payload.get('action_date', ''),
                    type=payload.get('type', '비정기'),
                    detail_type=payload.get('detail_type', ''),
                    detail_type2=payload.get('detail_type2', ''),
                    detail_type3=payload.get('detail_type3', ''),
                    content=json.dumps(content_val, ensure_ascii=False) if isinstance(content_val, (dict, list)) else str(content_val or ''),
                    memo=payload.get('memo', ''),
                    worker=payload.get('worker', worker_name),
                    status='조치완료',
                    image_data=payload.get('image_data', '')
                )
                db.session.add(m_item)
            else:
                if 'action_date' in payload: m_item.date = payload.get('action_date')
                if 'memo' in payload: m_item.memo = payload.get('memo')
                if 'worker' in payload: m_item.worker = payload.get('worker')
                if 'image_data' in payload: m_item.image_data = payload.get('image_data')

            db.session.add(SystemLog(action='ADD_TROUBLE', target=equip_id, details="Trouble 등록", worker=worker_name))
        elif action == 'UPDATE':
            source = payload.get('source', 'trouble')
            if source == 'trouble':
                log = TroubleLog.query.filter_by(id=str(payload.get('id'))).first()
                m_item = LogItem.query.filter_by(id=str(payload.get('id'))).first()

                if log:
                    if payload.get('equip_id') or (payload.get('site') and payload.get('equip')): 
                        log.equip_id = lookup_equipment_id(payload.get('equip_id'), payload.get('site'), payload.get('equip'))
                    if 'occur_date' in payload: log.occur_date = payload.get('occur_date')
                    if 'action_date' in payload: log.action_date = payload.get('action_date')
                    if payload.get('type'): log.type = payload.get('type')
                    
                    dt1_in = str(payload.get('detail_type') or log.detail_type or '').strip()
                    dt2_in = str(payload.get('detail_type2') or log.detail_type2 or '').strip()
                    dt3_in = str(payload.get('detail_type3') or log.detail_type3 or '').strip()
                    if '>' in dt1_in:
                        parts = [p.strip() for p in dt1_in.split('>') if p.strip()]
                        if len(parts) >= 1: dt1_in = parts[0]
                        if len(parts) >= 2 and not dt2_in: dt2_in = parts[1]
                        if len(parts) >= 3 and not dt3_in: dt3_in = parts[2]

                    log.detail_type = dt1_in
                    log.detail_type2 = dt2_in
                    log.detail_type3 = dt3_in

                    # 5개 항목 오직 trouble_log의 전용 컬럼에만 독립 저장
                    if 'situation' in payload: log.situation = payload.get('situation') or ''
                    if 'symptom' in payload: log.symptom = payload.get('symptom') or ''
                    if 'cause' in payload: log.cause = payload.get('cause') or ''
                    if 'measure' in payload or 'action' in payload: log.measure = payload.get('measure') or payload.get('action') or ''
                    if 'prevent' in payload or 'prevention' in payload: log.prevent = payload.get('prevent') or payload.get('prevention') or ''

                    if 'trouble_details' in payload:
                        log.trouble_details = str(payload.get('trouble_details') or '')
                    if 'image_data' in payload: log.image_data = payload.get('image_data')

                    log.status = '기록완료' if (log.occur_date and str(log.occur_date).strip() not in ('', '-')) else '미기록'

                if m_item:
                    if 'action_date' in payload: m_item.date = payload.get('action_date')
                    # Trouble 상세정보 저장 시 maint_log.memo는 함께 변경되지 않고 독립 유지
                    if 'worker' in payload: m_item.worker = payload.get('worker')
                    if 'image_data' in payload: m_item.image_data = payload.get('image_data')

                db.session.add(SystemLog(action='UPDATE_TROUBLE', target=payload.get('id', ''), details="Trouble 수정", worker=worker_name))
            elif source in ('log', 'maint'):
                log_item = LogItem.query.filter_by(id=str(payload.get('id'))).first()
                if log_item:
                    if 'action_date' in payload:
                        log_item.date = payload.get('action_date', log_item.date)
                        if hasattr(log_item, 'scheduled_date'):
                            log_item.scheduled_date = payload.get('action_date', log_item.scheduled_date)

                    # Trouble 상세정보 저장 시 maint_log.memo는 자동 변경되지 않음

                    if 'worker' in payload and payload.get('worker'):
                        log_item.worker = payload.get('worker')

                    if 'image_data' in payload:
                        log_item.image_data = payload.get('image_data', log_item.image_data)

                    if str(log_item.type).strip() == '비정기':
                        t_log = TroubleLog.query.filter_by(id=str(log_item.id)).first()
                        occ_val = payload.get('occur_date', '')
                        td_val = payload.get('trouble_details', '')
                        if isinstance(td_val, (dict, list)):
                            td_val = json.dumps(td_val, ensure_ascii=False)

                        c_dict = payload.get('content', {}) if isinstance(payload.get('content'), dict) else {}

                        if not t_log:
                            t_log = TroubleLog(
                                id=str(log_item.id),
                                equip_id=log_item.equip_id,
                                occur_date=occ_val,
                                action_date=payload.get('action_date', log_item.date),
                                type='비정기',
                                detail_type=log_item.detail_type or '',
                                detail_type2=log_item.detail_type2 or '',
                                detail_type3=getattr(log_item, 'detail_type3', '') or '',
                                situation=payload.get('situation', c_dict.get('situation', '')),
                                symptom=payload.get('symptom', c_dict.get('symptom', '')),
                                cause=payload.get('cause', c_dict.get('cause', '')),
                                measure=payload.get('measure', payload.get('action', c_dict.get('action', ''))),
                                prevent=payload.get('prevent', payload.get('prevention', c_dict.get('prevention', ''))),
                                trouble_details=td_val,
                                status='기록완료' if (occ_val and str(occ_val).strip() not in ('', '-')) else '미기록',
                                image_data=log_item.image_data
                            )
                            db.session.add(t_log)
                        else:
                            if 'occur_date' in payload: t_log.occur_date = payload.get('occur_date')
                            if 'action_date' in payload: t_log.action_date = payload.get('action_date')
                            if 'situation' in payload or c_dict.get('situation'): t_log.situation = payload.get('situation') or c_dict.get('situation', t_log.situation)
                            if 'symptom' in payload or c_dict.get('symptom'): t_log.symptom = payload.get('symptom') or c_dict.get('symptom', t_log.symptom)
                            if 'cause' in payload or c_dict.get('cause'): t_log.cause = payload.get('cause') or c_dict.get('cause', t_log.cause)
                            if 'measure' in payload or payload.get('action') or c_dict.get('action'): t_log.measure = payload.get('measure') or payload.get('action') or c_dict.get('action', t_log.measure)
                            if 'prevent' in payload or payload.get('prevention') or c_dict.get('prevention'): t_log.prevent = payload.get('prevent') or payload.get('prevention') or c_dict.get('prevention', t_log.prevent)
                            if 'trouble_details' in payload: t_log.trouble_details = td_val
                            if 'image_data' in payload: t_log.image_data = payload.get('image_data')

                            t_log.status = '기록완료' if (t_log.occur_date and str(t_log.occur_date).strip() not in ('', '-')) else '미기록'

                    db.session.add(SystemLog(action='UPDATE_LOG', target=log_item.equip_id, details=f"점검 이력 수정(Trouble 팝업)", worker=worker_name))
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
        additional_logs = LogItem.query.filter_by(original_log_id=str(parent_id)).all()
        
        result = []
        for l in additional_logs:
            result.append({
                "id": l.id,
                "date": l.scheduled_date or l.date,
                "type": l.type,
                "detail_type": l.detail_type,
                "content": l.content,
                "worker": l.worker,
                "status": getattr(l, 'status', '조치완료'),
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



def init_check_type_category_tables():
    """check_type_category 단일 통합 테이블 초기화 및 점검 구분 마스터 데이터 구성"""
    try:
        db.create_all()

        # 이미 점검 구분 마스터 데이터가 존재하는 경우 재시딩을 하지 않고 바로 반환
        if CheckTypeCategory.query.count() > 0:
            return

        app.logger.info("[Init] Seeding clean CheckTypeCategory table with exact work registration categories...")
        rows = []
        order = 1

        # 1. 정기
        rows.append(CheckTypeCategory(check_type='정기', type_detail='PM 점검', type_detail2='', type_detail3='', sort_order=order))
        order += 1

        # 2. 용액제조
        rows.append(CheckTypeCategory(check_type='용액제조', type_detail='용액제조', type_detail2='', type_detail3='', sort_order=order))
        order += 1

        # 3. 온라인점검
        rows.append(CheckTypeCategory(check_type='온라인점검', type_detail='온라인점검', type_detail2='', type_detail3='', sort_order=order))
        order += 1

        d3_list = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상", "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"]

        # 4. 비정기 - Alarm
        alarm2_list = ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람']
        for a2 in alarm2_list:
            for d3 in d3_list:
                rows.append(CheckTypeCategory(check_type='비정기', type_detail='Alarm', type_detail2=a2, type_detail3=d3, sort_order=order))
                order += 1

        # 5. 비정기 - Hunting
        hunting2_list = ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅']
        for h2 in hunting2_list:
            for d3 in d3_list:
                rows.append(CheckTypeCategory(check_type='비정기', type_detail='Hunting', type_detail2=h2, type_detail3=d3, sort_order=order))
                order += 1

        # 6. 비정기 - Data / Para 이상
        datapara2_list = ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈']
        for dp2 in datapara2_list:
            for d3 in d3_list:
                rows.append(CheckTypeCategory(check_type='비정기', type_detail='Data / Para 이상', type_detail2=dp2, type_detail3=d3, sort_order=order))
                order += 1

        # 7. 비정기 - 기타
        etc2_list = ['배수 펌프 이슈', '구동 이상']
        for e2 in etc2_list:
            for d3 in d3_list:
                rows.append(CheckTypeCategory(check_type='비정기', type_detail='기타', type_detail2=e2, type_detail3=d3, sort_order=order))
                order += 1

        # 8. 고객대응
        cust_details = ['순회 점검', '프로그램 변경 / 평가', '설비 평가', '파티클 필터 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '기타']
        for cd in cust_details:
            rows.append(CheckTypeCategory(check_type='고객대응', type_detail=cd, type_detail2='', type_detail3='', sort_order=order))
            order += 1

        db.session.bulk_save_objects(rows)
        db.session.commit()
        app.logger.info(f"[Init] Successfully inserted {len(rows)} CheckTypeCategory rows into database.")
    except Exception as e:
        db.session.rollback()
def migrate_clean_log_contents():
    """
    [마이그레이션] 완료된 작업(LogItem) 중:
    1. '내용 없음' 앞에 비용처리 라벨([유상], [무상] 등)이 붙은 경우 -> pure '내용 없음'으로 정합성 보정
    2. 마스터 물품(AdminItem) 코드가 아닌 단순 일반 텍스트 내용 앞에 비용처리 라벨이 붙은 경우 -> 비용처리 라벨 제거
    3. 고객대응 > 파티클 필터 교체 건 -> '[유상] Particle Filter' 고정 유지
    """
    try:
        flag = SystemSetting.query.filter_by(key='migrated_clean_log_contents_v1').first()
        if flag and flag.value == 'true':
            return
        admin_items = AdminItem.query.all()
        known_codes = set()
        for ai in admin_items:
            if ai.code:
                known_codes.add(ai.code.strip().lower())
            if ai.part:
                known_codes.add(ai.part.strip().lower())

        part_keywords = [
            '파트 이상 (교체)', '파트 이상 교체', '파트 이상 (수리)', '파트 이상 수리',
            '용액 / 용자 이상', '용액 용자 이상', '파츠 이상 교체', '파츠 이상 수리',
            '물품 이상 교체', '물품 이상 수리', 'particle filter'
        ]

        logs = LogItem.query.filter(LogItem.status != '작업예정').all()
        updated_count = 0

        for log in logs:
            c = (log.content or '').strip()
            if not c:
                continue

            # 1. 파티클 필터 교체 예외 처리 (Rule #8 고정)
            dt1 = (log.detail_type or '').strip()
            dt3 = (getattr(log, 'detail_type3', '') or '').strip()
            if log.type == '고객대응' and ('파티클 필터' in dt1 or '파티클 필터' in dt3):
                if c != '[유상] Particle Filter':
                    log.content = '[유상] Particle Filter'
                    updated_count += 1
                continue

            # 2. '내용 없음' 관련 처리
            clean_c = re.sub(r'^\[.*?\]\s*-?\s*', '', c).strip()
            if '내용 없음' in clean_c or clean_c == '내용 없음':
                if c != '내용 없음':
                    log.content = '내용 없음'
                    updated_count += 1
                continue

            # 3. 콤마 구분의 콤보 텍스트 처리
            sub_parts = [sp.strip() for sp in c.split(',') if sp.strip()]
            new_parts = []
            changed = False

            for sp in sub_parts:
                cost_match = re.match(r'^(\[.*?\])\s*-?\s*(.*)$', sp)
                if cost_match:
                    cost_label = cost_match.group(1).strip()
                    body_text = cost_match.group(2).strip()

                    # body_text에서 스펙([물품상세]) 분리
                    spec_match = re.search(r'\s*(\[[^\]]+\])$', body_text)
                    pure_body = body_text[:spec_match.start()].strip() if spec_match else body_text
                    clean_pure_body = pure_body.replace('파트 이상 교체 -', '').replace('파트 이상 수리 -', '').strip()

                    is_known_part = (clean_pure_body.lower() in known_codes) or any(kw in pure_body.lower() for kw in part_keywords)

                    if not is_known_part and body_text and body_text != '내용 없음':
                        # 물품이 아닌 일반 텍스트 내용인 경우 비용처리 라벨 제거
                        new_parts.append(body_text)
                        changed = True
                    elif body_text == '내용 없음':
                        new_parts.append('내용 없음')
                        changed = True
                    else:
                        new_parts.append(sp)
                else:
                    new_parts.append(sp)

            if changed:
                final_content = ', '.join(new_parts)
                if final_content != c:
                    log.content = final_content
                    updated_count += 1

        if not flag:
            flag = SystemSetting(key='migrated_clean_log_contents_v1', value='true')
            db.session.add(flag)
        else:
            flag.value = 'true'
        db.session.commit()
        if updated_count > 0:
            app.logger.info(f"[Migration] Cleaned cost labels from non-part contents in {updated_count} LogItem records.")
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"[Migration Error] migrate_clean_log_contents: {str(e)}")

def sync_all_trouble_logs_migration():
    """
    [마이그레이션] 모든 비정기 작업(type == '비정기')이 TroubleLog에 누락 없이 동기화되도록 보정
    """
    try:
        flag = SystemSetting.query.filter_by(key='migrated_trouble_logs_v1').first()
        if flag and flag.value == 'true':
            return
        non_regular_logs = LogItem.query.filter(db.func.trim(LogItem.type) == '비정기').all()
        if not non_regular_logs:
            return

        all_log_ids = {str(l.id) for l in LogItem.query.all()}
        trouble_logs_map = {str(t.id): t for t in TroubleLog.query.all()}

        parent_logs = {}
        child_logs_map = {}

        for nl in non_regular_logs:
            nl_id = str(nl.id)
            orig_id = str(getattr(nl, 'original_log_id', '') or '').strip()
            if orig_id in ('None', '-'):
                orig_id = ''

            if orig_id and orig_id in all_log_ids and orig_id != nl_id:
                if orig_id not in child_logs_map:
                    child_logs_map[orig_id] = []
                child_logs_map[orig_id].append(nl)
                TroubleLog.query.filter_by(id=nl_id).delete(synchronize_session=False)
            else:
                parent_logs[nl_id] = nl

        def clean_log_text(raw_val):
            if not raw_val:
                return ""
            val_str = str(raw_val).strip()
            if not val_str or val_str == '-':
                return ""
            if val_str.startswith('{') and val_str.endswith('}'):
                try:
                    parsed = json.loads(val_str)
                    parts = []
                    for key in ['situation', 'symptom', 'cause', 'action', 'measure', 'prevention', 'prevent', 'trouble_memo']:
                        v = str(parsed.get(key, '') or '').strip()
                        if v and v != '-':
                            parts.append(v)
                    if parts:
                        return "\n".join(parts)
                except Exception:
                    pass
            return val_str

        created_count = 0
        for p_id, p_log in parent_logs.items():
            t_item = trouble_logs_map.get(p_id)

            blocks = []
            p_date = str(p_log.date or p_log.scheduled_date or '').strip()[:10] or '미기록'
            p_worker = str(p_log.worker or '').strip() or '미지정'
            p_text = clean_log_text(p_log.memo or p_log.content)

            if p_text:
                blocks.append(f"<최초> ({p_date} / {p_worker})\n{p_text}")
            else:
                blocks.append(f"<최초> ({p_date} / {p_worker})")

            children = child_logs_map.get(p_id, [])
            for idx, c_log in enumerate(children, 1):
                c_date = str(c_log.date or c_log.scheduled_date or '').strip()[:10] or '미기록'
                c_worker = str(c_log.worker or '').strip() or '미지정'
                c_text = clean_log_text(c_log.memo or c_log.content)
                if c_text:
                    blocks.append(f"<추가{idx}> ({c_date} / {c_worker})\n{c_text}")
                else:
                    blocks.append(f"<추가{idx}> ({c_date} / {c_worker})")

            combined_details_str = "\n\n".join(blocks)

            if not t_item:
                t_item = TroubleLog(
                    id=p_id,
                    equip_id=p_log.equip_id,
                    occur_date='',
                    action_date=p_log.date or p_log.scheduled_date or '',
                    type='비정기',
                    detail_type=p_log.detail_type or '',
                    detail_type2=getattr(p_log, 'detail_type2', '') or '',
                    detail_type3=getattr(p_log, 'detail_type3', '') or '',
                    trouble_details=combined_details_str,
                    status='미기록',
                    image_data=getattr(p_log, 'image_data', '')
                )
                db.session.add(t_item)
                created_count += 1
            else:
                t_item.type = '비정기'
                t_item.detail_type = p_log.detail_type or ''
                t_item.detail_type2 = getattr(p_log, 'detail_type2', '') or ''
                t_item.detail_type3 = getattr(p_log, 'detail_type3', '') or ''
                t_item.action_date = p_log.date or p_log.scheduled_date or t_item.action_date
                if combined_details_str:
                    t_item.trouble_details = combined_details_str
                t_item.status = '기록완료' if (t_item.occur_date and str(t_item.occur_date).strip() not in ('', '-')) else '미기록'
                t_item.image_data = getattr(p_log, 'image_data', '') or t_item.image_data

        # [유령데이터 방지] parent_logs에 속하지 않는 고아(Orphan) TroubleLog 유령 레코드 일괄 정비
        for t_id in list(trouble_logs_map.keys()):
            if t_id not in parent_logs:
                TroubleLog.query.filter_by(id=t_id).delete(synchronize_session=False)

        if not flag:
            flag = SystemSetting(key='migrated_trouble_logs_v1', value='true')
            db.session.add(flag)
        else:
            flag.value = 'true'
        db.session.commit()
        if created_count > 0:
            app.logger.info(f"[Migration] Successfully synced {created_count} non-regular tasks to TroubleLog.")
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"[Migration Error] sync_all_trouble_logs_migration: {str(e)}")

def init_db():
    with app.app_context():
        db.create_all()
        init_check_type_category_tables()

        # item_log 테이블 자동 생성 및 컬럼 명세 보정 (id, equip_id, date, code, part, spec, part_detail, cycle)
        try:
            db.session.execute(text('''
                CREATE TABLE IF NOT EXISTS item_log (
                    _unique_id INT AUTO_INCREMENT PRIMARY KEY,
                    id VARCHAR(50),
                    equip_id VARCHAR(200),
                    date VARCHAR(50) DEFAULT '',
                    code VARCHAR(100) DEFAULT '',
                    part VARCHAR(100) DEFAULT '',
                    spec VARCHAR(255) DEFAULT '',
                    part_detail VARCHAR(255) DEFAULT '',
                    cycle VARCHAR(50) NULL
                )
            '''))
            db.session.commit()
        except Exception:
            db.session.rollback()

        item_log_cols = [
            ('date', 'VARCHAR(50) DEFAULT ""'),
            ('code', 'VARCHAR(100) DEFAULT ""'),
            ('part', 'VARCHAR(100) DEFAULT ""'),
            ('spec', 'VARCHAR(255) DEFAULT ""'),
            ('part_detail', 'VARCHAR(255) DEFAULT ""'),
            ('cycle', 'VARCHAR(50) NULL')
        ]
        for col, col_type in item_log_cols:
            try:
                db.session.execute(text(f'ALTER TABLE item_log ADD COLUMN {col} {col_type}'))
                db.session.commit()
            except Exception:
                db.session.rollback()

        for drop_col in ['type', 'detail_type', 'detail_type2', 'detail_type3', 'code_name', 'name', 'detail', 'content', 'period', 'cost_type', 'item_cost', 'sort_order']:
            try:
                db.session.execute(text(f'ALTER TABLE item_log DROP COLUMN {drop_col}'))
                db.session.commit()
            except Exception:
                db.session.rollback()

        # [ItemLog 기존 legacy 데이터 id 및 spec 자동 보정]
        try:
            items_to_fix = ItemLog.query.all()
            if items_to_fix:
                for il in items_to_fix:
                    if il.id and not str(il.id).startswith('item_'):
                        rand_num = random.randint(100, 999)
                        il.id = f"item_{il.id}_{rand_num}" if str(il.id).isdigit() else f"item_{int(time.time()*1000)}_{rand_num}"
                    match_admin = AdminItem.query.filter(
                        (AdminItem.code == il.code) | (AdminItem.part == il.code) |
                        (AdminItem.code == il.part) | (AdminItem.part == il.part)
                    ).first()
                    if match_admin and match_admin.spec:
                        il.spec = match_admin.spec
                    elif not il.spec and il.part_detail:
                        il.spec = il.part_detail
                db.session.commit()
        except Exception:
            db.session.rollback()

        # [유지관리 물품 찌꺼기 레코드 정리] maint_log(LogItem) 중 유령/잔재 작업예정 데이터 및 item_ 관련 ID 정밀 삭제
        try:
            LogItem.query.filter(
                LogItem.status == '작업예정',
                (LogItem.id.like('item_%')) | (LogItem.scheduled_date == None) | (LogItem.scheduled_date == '') | (LogItem.scheduled_date == '-')
            ).delete(synchronize_session=False)

            # 2) 이미 조치완료(status='조치완료')된 original_log_id와 동일한 id를 가진 잔재 작업예정(status='작업예정') 레코드 삭제
            completed_orig_ids_in_db = [
                str(l.original_log_id) for l in LogItem.query.filter(
                    LogItem.status == '조치완료',
                    LogItem.original_log_id != None,
                    LogItem.original_log_id != ''
                ).all() if l.original_log_id
            ]
            if completed_orig_ids_in_db:
                LogItem.query.filter(
                    LogItem.status == '작업예정',
                    LogItem.id.in_(completed_orig_ids_in_db)
                ).delete(synchronize_session=False)

            db.session.commit()
        except Exception:
            db.session.rollback()



        # [테이블 컬럼 보정]
        try:
            db.session.execute(text('ALTER TABLE site ADD COLUMN `group` VARCHAR(50) DEFAULT \'기타사업장\''))
            db.session.commit()
        except:
            db.session.rollback()

        try:
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN site VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()

        try:
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN department VARCHAR(100)'))
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN position VARCHAR(100)'))
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN name VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()

        try:
            db.session.execute(text('ALTER TABLE `user` ADD COLUMN pw_changed_at DATETIME'))
            db.session.commit()
            db.session.execute(text('UPDATE `user` SET pw_changed_at = CURRENT_TIMESTAMP WHERE pw_changed_at IS NULL'))
            db.session.commit()
        except:
            db.session.rollback()

        try:
            db.session.execute(text('ALTER TABLE system_log ADD COLUMN worker VARCHAR(100)'))
            db.session.commit()
        except:
            db.session.rollback()

        try:
            db.session.execute(text('ALTER TABLE maint_log ADD COLUMN spec VARCHAR(255)'))
            db.session.commit()
        except:
            db.session.rollback()

        try:
            db.session.execute(text('ALTER TABLE maint_log ADD COLUMN original_log_id VARCHAR(50)'))
            db.session.commit()
        except:
            db.session.rollback()

        try:
            db.session.execute(text('ALTER TABLE maint_log ADD COLUMN sort_order INT DEFAULT 0'))
            db.session.commit()
        except:
            db.session.rollback()

        for col in ['trouble_details', 'trouble_occur_date']:
            try:
                db.session.execute(text(f'ALTER TABLE maint_log DROP COLUMN {col}'))
                db.session.commit()
            except Exception:
                db.session.rollback()

        # ==============================================================================
        # [순차적 데이터 완전 무결성 마이그레이션 Workflow]
        # ==============================================================================
        
        # 1. trouble_log 테이블 전용 컬럼 먼저 100% 생성 (ADD COLUMN)
        for col in ['content', 'worker', 'memo']:
            try:
                db.session.execute(text(f'ALTER TABLE trouble_log DROP COLUMN {col}'))
                db.session.commit()
            except Exception:
                db.session.rollback()

        trouble_log_cols = [
            ('image_data', 'LONGTEXT'),
            ('action_date', 'VARCHAR(50) DEFAULT ""'),
            ('type', 'VARCHAR(50) DEFAULT "비정기"'),
            ('detail_type', 'VARCHAR(100) DEFAULT ""'),
            ('detail_type2', 'VARCHAR(100) DEFAULT ""'),
            ('detail_type3', 'VARCHAR(100) DEFAULT ""'),
            ('situation', 'TEXT'),
            ('symptom', 'TEXT'),
            ('cause', 'TEXT'),
            ('measure', 'TEXT'),
            ('prevent', 'TEXT'),
            ('trouble_details', 'TEXT')
        ]
        for col, col_type in trouble_log_cols:
            try:
                db.session.execute(text(f'ALTER TABLE trouble_log ADD COLUMN {col} {col_type}'))
                db.session.commit()
            except Exception:
                db.session.rollback()

        try:
            db.session.execute(text("ALTER TABLE equipment ADD COLUMN cust_equip_name VARCHAR(100) DEFAULT ''"))
            db.session.commit()
        except:
            db.session.rollback()

        # Admin 계정 생성 및 권한 부여
        admin_id = os.environ.get('APP_ADMIN_ID', 'admin')
        admin_user = User.query.filter_by(id=admin_id).first()
        if not admin_user:
            admin_pw = os.environ.get('APP_ADMIN_PW', secrets.token_urlsafe(8))
            admin_user = User(id=admin_id, pw=generate_password_hash(admin_pw, method='pbkdf2:sha256:50000'), role='superadmin', pw_changed_at=get_utc_now())
            db.session.add(admin_user)
            db.session.commit()
        elif admin_user.role == 'admin':
            admin_user.role = 'superadmin'
            db.session.commit()

        # 사업장별 '기타(ETC)' 장비 자동 추가
        try:
            sites = Site.query.all()
            for site in sites:
                etc_id = f"{site.name}::기타(ETC)::::"
                if not Equipment.query.filter_by(id=etc_id).first():
                    db.session.add(Equipment(id=etc_id, site_name=site.name, name="기타(ETC)", serial="", cust_equip_name=""))
            db.session.commit()
        except Exception:
            db.session.rollback()

        # [마이그레이션] 완료된 작업 내용 중 '내용 없음' 및 일반 텍스트 내용의 비용처리 라벨 정비
        migrate_clean_log_contents()
        sync_all_trouble_logs_migration()

# ------------------------------------------------------------------------------
# [추가] 서버 점검중 상태 조회 및 관리자 토글 API
# ------------------------------------------------------------------------------
@app.route('/api/server-status', methods=['GET'])
def get_server_status():
    try:
        setting = SystemSetting.query.filter_by(key='server_maintenance').first()
        is_maint = (setting.value == 'true') if setting and setting.value else False
        return jsonify({'status': 'success', 'maintenance': is_maint})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/admin/server-maintenance', methods=['POST'])
def toggle_server_maintenance():
    if session.get('role') != 'superadmin':
        return jsonify({'status': 'fail', 'message': '최종관리자 권한이 필요합니다.'}), 403
    try:
        data = request.get_json() or {}
        is_maint = data.get('maintenance', False)
        val_str = 'true' if is_maint else 'false'
        setting = SystemSetting.query.filter_by(key='server_maintenance').first()
        if not setting:
            setting = SystemSetting(key='server_maintenance', value=val_str)
            db.session.add(setting)
        else:
            setting.value = val_str
        db.session.commit()
        return jsonify({'status': 'success', 'maintenance': is_maint})
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': str(e)}), 500

# WSGI 서버(PythonAnywhere 등) 환경에서도 앱 구동 시 초기화가 실행되도록 __main__ 블록 밖으로 이동
# [Phase 3] JSON 파일 관련 로직이 제거되었으므로, 폴더 생성만 수행
for d in [DATA_DIR, LOG_DIR, BACKUP_DIR, DATA_LOG_DIR]:
    if not os.path.exists(d):
        os.makedirs(d, mode=0o700)



init_db()

if __name__ == '__main__':
    # 로컬과 서버 환경을 분리하기 위해 .env 파일에서 APP_PORT 값을 읽어옵니다. (기본값: 8080)
    port = int(os.environ.get('APP_PORT', 8080))
    env_mode = os.environ.get('APP_ENV', 'development').lower()

    if env_mode == 'development':
        # 로컬 개발 환경: 코드 수정 시 자동 감지(Auto-reload) 및 디버그 모드 적용
        app.run(debug=True, host='0.0.0.0', port=port, use_reloader=True)
    else:
        # 운영 환경: Waitress 서버 적용
        try:
            from waitress import serve
            print(f" * Production Mode: Serving with Waitress on http://0.0.0.0:{port}")
            serve(app, host='0.0.0.0', port=port, threads=12)
        except (PermissionError, OSError) as port_err:
            new_port = port + 1
            print(f"\n ! Port {port} is in use ({port_err}). Trying port {new_port}...")
            try:
                serve(app, host='0.0.0.0', port=new_port, threads=12)
            except Exception as e:
                print(f" ! Failed to start server on port {new_port} as well. Please check your firewall or use a different port.")
                print(f"   Error: {e}")
        except ImportError:
            print(" * Waitress not found. Running with basic Flask server.")
            app.run(debug=False, port=port, host='0.0.0.0')