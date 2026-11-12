from flask import Flask, render_template, request, jsonify, session, has_request_context, send_from_directory, redirect, url_for
from flask.sessions import SecureCookieSessionInterface
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
import socket

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
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=4)
app.config['WTF_CSRF_TIME_LIMIT'] = None  # [추가] CSRF 토큰의 독자적인 타임아웃(기본 3600초)을 해제하여 세션 수명과 100% 동기화

# [추가] 권한별 세션 수명 차등 적용 인터페이스 (관리자 권한: 4시간, 일반 권한: 1시간)
class RoleBasedSessionInterface(SecureCookieSessionInterface):
    def get_expiration_time(self, app, session):
        if not session.permanent:
            return None
        role = session.get('role')
        if role in ['admin', 'superadmin']:
            return datetime.now(timezone.utc) + timedelta(hours=4)
        return datetime.now(timezone.utc) + timedelta(hours=1)

    def open_session(self, app, request):
        s = self.get_signing_serializer(app)
        if s is None:
            return None
        val = request.cookies.get(self.get_cookie_name(app))
        if not val:
            return self.session_class()

        # 1. 관리자 최대 수명인 4시간 기준으로 서명 검증 및 복호화 시도
        max_age = int(timedelta(hours=4).total_seconds())
        try:
            data = s.loads(val, max_age=max_age)
        except Exception:
            return self.session_class()

        # 2. 일반 계정인 경우 1시간(3600초) 유효 시간 엄격 적용
        role = data.get('role')
        if role not in ['admin', 'superadmin']:
            try:
                data = s.loads(val, max_age=int(timedelta(hours=1).total_seconds()))
            except Exception:
                return self.session_class()

        return self.session_class(data)

app.session_interface = RoleBasedSessionInterface()

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
    # [추가] CSRF 토큰 쿠키 실시간 동기화 (세션 만료 및 재로그인 시 토큰 불일치 방어)
    try:
        token = generate_csrf()
        response.set_cookie(
            'csrf_token',
            token,
            httponly=False,
            samesite='Lax',
            secure=True if os.environ.get('USE_HTTPS') == 'true' else False
        )
    except Exception:
        pass
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

def normalize_key(val):
    if not val:
        return ""
    import re
    return re.sub(r'[^a-zA-Z0-9가-힣]', '', str(val)).lower()

# Security Extensions
csrf = CSRFProtect(app)
# [수정] 메모리 저장소 명시적 설정
# 잦은 API 호출로 인한 429 에러를 방지하면서도 기본적인 무차별 대입 공격을 막기 위해 넉넉한 기본 제한(Rate Limit) 설정 적용
limiter = Limiter(get_remote_address, app=app, storage_uri="memory://", default_limits=["3000 per day", "500 per hour"])

# 프롬프트 인젝션 및 AI 보안 남용 방지 메모리 카운터 및 블랙리스트
IP_ABUSE_COUNTER = {}
IP_BLACKLIST = {}

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

def ensure_setup_columns():
    setup_log_cols = [
        ('category', 'VARCHAR(100)'),
        ('subcategory', 'VARCHAR(100)'),
        ('special_note', 'TEXT')
    ]
    for col, typ in setup_log_cols:
        try:
            db.session.execute(text(f'ALTER TABLE setup_log ADD COLUMN {col} {typ}'))
        except Exception:
            pass

    setup_detail_cols = [
        ('subcategory', 'VARCHAR(100)')
    ]
    for col, typ in setup_detail_cols:
        try:
            db.session.execute(text(f'ALTER TABLE setup_detail ADD COLUMN {col} {typ}'))
        except Exception:
            pass

with app.app_context():
    ensure_equipment_columns()
    ensure_setup_columns()

class SetupDetail(db.Model):
    _unique_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    id = db.Column(db.String(50))
    equip_id = db.Column(db.String(200))
    category = db.Column(db.String(100), default='')
    subcategory = db.Column(db.String(100), default='')
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
    category = db.Column(db.String(100), default='')
    subcategory = db.Column(db.String(100), default='')
    worker = db.Column(db.String(100), default='')
    content = db.Column(db.String(255), default='')
    company = db.Column(db.String(100), default='위드텍')
    memo = db.Column(db.Text, default='')
    special_note = db.Column(db.Text, default='')
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
    updated_by = db.Column(db.String(100), default='')  # [추가] 마지막 등록/수정자 (로그인 사용자 이름)
    updated_at = db.Column(db.String(30), default='')   # [추가] 마지막 등록/수정 일시 (KST, YYYY-MM-DD HH:MM)

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

# [추가] 사업장 구분별 물품 관리 현황 (수량 관리) 테이블 (ItemStock)
class ItemStock(db.Model):
    __tablename__ = 'item_stock'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    site_group = db.Column(db.String(50), nullable=False, index=True)  # 사업장 구분 (SEC, SKH 이천 등)
    site_name = db.Column(db.String(100), default='', index=True)      # [추가] 사업장명 (평택, 화성 등)
    item_id = db.Column(db.String(50), nullable=True)                  # AdminItem.id 연동용 (optional)
    code = db.Column(db.String(100), default='')                       # 물품 코드명
    part = db.Column(db.String(100), default='')                       # 물품명
    spec = db.Column(db.String(255), default='')                       # 세부 규격
    partno = db.Column(db.String(100), default='')                     # 품번
    detail_type = db.Column(db.String(100), default='')                # 상세 구분
    grade = db.Column(db.String(20), default='A')                      # [추가] 물품 등급 (A, B, C)
    quantity = db.Column(db.Integer, default=0)                        # 보유/현재 수량
    safety_quantity = db.Column(db.Integer, default=0)                 # [추가] 안전 재고 수량
    memo = db.Column(db.String(255), default='')                       # 비고
    updated_at = db.Column(db.DateTime, default=get_utc_now, onupdate=get_utc_now)

    def to_dict(self):
        return {
            'id': self.id,
            'site_group': self.site_group or '',
            'site_name': self.site_name or '',
            'item_id': self.item_id or '',
            'code': self.code or '',
            'part': self.part or '',
            'spec': self.spec or '',
            'partno': self.partno or '',
            'detail_type': self.detail_type or '',
            'grade': self.grade or 'A',
            'quantity': self.quantity if self.quantity is not None else 0,
            'safety_quantity': self.safety_quantity if self.safety_quantity is not None else 0,
            'memo': self.memo or '',
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S') if self.updated_at else ''
        }

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

# [추가] 장비 Parameter 관리 마스터 데이터 테이블 (AdminParameter)
# Parameter 1행당 1줄로 기록, id부터 memo까지 컬럼 각각 입력, sort_order로 순서 보존
class AdminParameter(db.Model):
    __tablename__ = 'admin_parameter'
    id = db.Column(db.String(100), primary_key=True)
    model_name = db.Column(db.String(100), nullable=False, index=True)
    model_abbr = db.Column(db.String(100), default='')
    name = db.Column(db.String(150), default='')
    unit = db.Column(db.String(50), default='')
    standard = db.Column(db.String(255), default='')
    memo = db.Column(db.String(255), default='')
    sort_order = db.Column(db.Integer, default=0, index=True) # [추가] 등록 및 드래그 순서 보존용
    parameters = db.Column(db.Text, nullable=True, default='') # 레거시 호환용
    updated_at = db.Column(db.DateTime, default=get_utc_now, onupdate=get_utc_now)

    def to_dict(self):
        return {
            'id': self.id,
            'model_name': self.model_name,
            'model_abbr': self.model_abbr or '',
            'name': self.name or '',
            'unit': self.unit or '',
            'standard': self.standard or '',
            'memo': self.memo or '',
            'sort_order': self.sort_order if self.sort_order is not None else 0,
            'parameters': self.parameters or '',
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S') if self.updated_at else ''
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

# [추가] 장비 Working Report 저장 및 관리 모델 (EquipmentReport)
class EquipmentReport(db.Model):
    __tablename__ = 'equipment_report'
    id = db.Column(db.String(100), primary_key=True) # rep_YYYYMMDD_equipId
    site_name = db.Column(db.String(100), nullable=False, index=True)
    equip_id = db.Column(db.String(100), nullable=False, index=True)
    equip_name = db.Column(db.String(100), default='', index=True)
    model_name = db.Column(db.String(100), default='')
    report_date = db.Column(db.String(20), nullable=False, index=True) # YYYY-MM-DD
    title = db.Column(db.String(200), default='Working Report')
    inspector = db.Column(db.String(150), default='')
    location = db.Column(db.String(150), default='')
    serial_no = db.Column(db.String(100), default='')
    data_json = db.Column(db.Text, nullable=False, default='{}') # 전체 보고서 세부 항목(파라미터, 체크박스, 이력 등) JSON
    created_at = db.Column(db.DateTime, default=get_utc_now)
    updated_at = db.Column(db.DateTime, default=get_utc_now, onupdate=get_utc_now)

    def to_dict(self):
        parsed_data = {}
        if self.data_json:
            try:
                parsed_data = json.loads(self.data_json)
            except Exception:
                parsed_data = {}
        return {
            'id': self.id,
            'site_name': self.site_name,
            'equip_id': self.equip_id,
            'equip_name': self.equip_name or '',
            'model_name': self.model_name or '',
            'report_date': self.report_date,
            'title': self.title or 'Working Report',
            'inspector': self.inspector or '',
            'location': self.location or '',
            'serial_no': self.serial_no or '',
            'data': parsed_data,
            'data_json': self.data_json or json.dumps(parsed_data, ensure_ascii=False),
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else '',
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S') if self.updated_at else ''
        }

# [추가] Tracking(정상화 미완료) 작업 레포트 모델 - 작업 패밀리(최초 작업 + 추가작업)당 1건
class TrackingReport(db.Model):
    __tablename__ = 'tracking_report'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    equip_id = db.Column(db.String(200), nullable=False, index=True)
    family_id = db.Column(db.String(50), nullable=False, index=True)  # 최초 작업 로그 ID
    site_name = db.Column(db.String(100), default='')
    equip_key = db.Column(db.String(200), default='')
    symptom = db.Column(db.Text, default='')     # 증상
    action = db.Column(db.Text, default='')      # 조치사항
    parts = db.Column(db.Text, default='')       # 필요물품 비고 (발주/입고 현황 등)
    parts_items = db.Column(db.Text, default='[]')  # 필요물품 목록 JSON (물품 관리 항목 + 수량)
    discussion = db.Column(db.Text, default='')  # 협의 사항
    discussion_person = db.Column(db.String(100), default='')  # 협의 담당자 (수기 입력)
    basic_json = db.Column(db.Text, default='{}')  # 작성 시점 기본 정보 스냅샷
    created_by = db.Column(db.String(100), default='')
    updated_by = db.Column(db.String(100), default='')
    created_at = db.Column(db.DateTime, default=get_utc_now)
    updated_at = db.Column(db.DateTime, default=get_utc_now, onupdate=get_utc_now)

    def to_dict(self):
        try:
            basic = json.loads(self.basic_json or '{}')
        except Exception:
            basic = {}
        try:
            parts_items = json.loads(self.parts_items or '[]')
            if not isinstance(parts_items, list):
                parts_items = []
        except Exception:
            parts_items = []
        to_kst = lambda dt: (dt + timedelta(hours=9)).strftime('%Y-%m-%d %H:%M') if dt else ''
        return {
            'id': self.id,
            'equipId': self.equip_id,
            'familyId': self.family_id,
            'siteName': self.site_name or '',
            'equipKey': self.equip_key or '',
            'symptom': self.symptom or '',
            'action': self.action or '',
            'parts': self.parts or '',
            'partsItems': parts_items,
            'discussion': self.discussion or '',
            'discussionPerson': self.discussion_person or '',
            'basic': basic,
            'createdBy': self.created_by or '',
            'updatedBy': self.updated_by or '',
            'createdAt': to_kst(self.created_at),
            'updatedAt': to_kst(self.updated_at)
        }

# [추가] AI 챗봇 대화 기록 모델 (ChatHistory)
class ChatHistory(db.Model):
    __tablename__ = 'chat_history'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.String(50), nullable=False, index=True)
    sender = db.Column(db.String(10), nullable=False) # 'user' or 'ai'
    message = db.Column(db.Text, nullable=False)
    date_str = db.Column(db.String(20), nullable=False, index=True) # YYYY-MM-DD
    created_at = db.Column(db.DateTime, default=get_utc_now, index=True)
    session_id = db.Column(db.String(100), default="", index=True) # 세션/대화별 식별자
    title = db.Column(db.String(255), default="") # 대화 주제(첫 질문 요약)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'sender': self.sender,
            'text': self.message,
            'date': self.date_str,
            'session_id': self.session_id or '',
            'title': self.title or '',
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else ''
        }

# [추가] AI 챗봇 API 호출(라운드)별 토큰 사용량 기록 (ChatUsage)
class ChatUsage(db.Model):
    __tablename__ = 'chat_usage'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    created_at = db.Column(db.DateTime, default=get_utc_now, index=True)
    date_str = db.Column(db.String(20), nullable=False, index=True)  # YYYY-MM-DD (로컬 기준)
    user_id = db.Column(db.String(50), nullable=False, index=True)
    session_id = db.Column(db.String(100), default='')
    request_id = db.Column(db.String(32), nullable=False, index=True)  # 질문 1건 단위
    mode = db.Column(db.String(20), default='chat')  # chat(직접 입력) / analysis(원인 분석)
    question = db.Column(db.String(255), default='')
    round_no = db.Column(db.Integer, default=1)  # 질문 1건 안에서 몇 번째 API 호출인지
    model = db.Column(db.String(100), default='')
    status = db.Column(db.String(20), default='ok')  # ok / error
    prompt_tokens = db.Column(db.Integer, default=0)
    output_tokens = db.Column(db.Integer, default=0)
    thoughts_tokens = db.Column(db.Integer, default=0)
    cached_tokens = db.Column(db.Integer, default=0)
    total_tokens = db.Column(db.Integer, default=0)
    latency_ms = db.Column(db.Integer, default=0)
    tool_detail = db.Column(db.Text, default='')  # 이 호출 뒤 실행한 도구 [{name, chars}]
    chars_system = db.Column(db.Integer, default=0)  # 입력 구성(문자 수): 시스템 지침
    chars_tools_decl = db.Column(db.Integer, default=0)  # 도구 정의
    chars_history = db.Column(db.Integer, default=0)  # 이전 대화
    chars_question = db.Column(db.Integer, default=0)  # 질문
    chars_tool_results = db.Column(db.Integer, default=0)  # 누적 DB 조회 결과

def ensure_item_stock_table():
    try:
        db.create_all()
        # [추가] 사업장별 관리, 안전 재고 수량, 등급 컬럼 마이그레이션 (SQLite / MySQL 호환)
        stock_cols = [
            ('site_name', 'VARCHAR(100) DEFAULT ""'),
            ('safety_quantity', 'INTEGER DEFAULT 0'),
            ('grade', 'VARCHAR(20) DEFAULT "A"')
        ]
        for col, typ in stock_cols:
            try:
                db.session.execute(text(f'ALTER TABLE item_stock ADD COLUMN {col} {typ}'))
                db.session.commit()
            except Exception:
                db.session.rollback()
        try:
            db.session.execute(text("UPDATE item_stock SET grade='A' WHERE grade IS NULL OR grade=''"))
            db.session.commit()
        except Exception:
            db.session.rollback()
    except Exception as e:
        app.logger.error(f"Error creating/ensuring item_stock table: {e}")

def ensure_admin_parameter_table():
    try:
        db.create_all()
        # [추가] Parameter 관리 등록/드래그 순서 보존용 sort_order 컬럼 자동 마이그레이션
        try:
            db.session.execute(text('ALTER TABLE admin_parameter ADD COLUMN sort_order INTEGER DEFAULT 0'))
            db.session.commit()
        except Exception:
            db.session.rollback()
    except Exception as e:
        app.logger.error(f"Error ensuring admin_parameter table: {e}")

def ensure_equipment_report_table():
    try:
        db.create_all()
    except Exception as e:
        app.logger.error(f"Error ensuring equipment_report table: {e}")

def ensure_chat_history_table():
    try:
        db.create_all()
        # [추가] 세션 및 대화 제목 컬럼 자동 마이그레이션
        cols = [
            ('session_id', 'VARCHAR(100) DEFAULT ""'),
            ('title', 'VARCHAR(255) DEFAULT ""')
        ]
        for col, typ in cols:
            try:
                db.session.execute(text(f'ALTER TABLE chat_history ADD COLUMN {col} {typ}'))
                db.session.commit()
            except Exception:
                db.session.rollback()
        # [추가] 대화 기록 테이블이 utf8mb3 이면 이모지(🔧 등) 저장이 실패하므로 utf8mb4 로 변환
        if db_type == 'mysql':
            try:
                coll = db.session.execute(text(
                    "SELECT TABLE_COLLATION FROM information_schema.TABLES "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_history'")).scalar()
                if coll and not str(coll).startswith('utf8mb4'):
                    db.session.execute(text(
                        'ALTER TABLE chat_history CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
                    db.session.commit()
                    app.logger.info('[Init] chat_history 테이블을 utf8mb4 로 변환했습니다.')
            except Exception as e:
                db.session.rollback()
                app.logger.error(f'chat_history utf8mb4 변환 실패: {e}')
        # [추가] 챗봇 사용량 모드(직접 입력/원인 분석) 컬럼 자동 마이그레이션
        try:
            db.session.execute(text('ALTER TABLE chat_usage ADD COLUMN mode VARCHAR(20) DEFAULT "chat"'))
            db.session.commit()
        except Exception:
            db.session.rollback()
    except Exception as e:
        app.logger.error(f"Error ensuring chat_history table: {e}")

def reset_legacy_issue_share_once():
    """[Tracking 전환] 기존 '이슈 공유' 체크 데이터를 1회만 초기화 (is_issue_shared 플래그를 Tracking 대상 플래그로 재사용)"""
    flag_key = 'tracking_legacy_reset_done'
    try:
        if SystemSetting.query.filter_by(key=flag_key).first():
            return
        LogItem.query.filter(LogItem.is_issue_shared == True).update({LogItem.is_issue_shared: False}, synchronize_session=False)
        db.session.add(SystemSetting(key=flag_key, value=json.dumps(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))))
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Failed to reset legacy issue share flags: {e}")

def ensure_tracking_report_columns():
    """[Tracking] tracking_report 테이블 신규 컬럼 자동 추가"""
    try:
        db.create_all()
    except Exception as e:
        app.logger.error(f"Error ensuring tracking_report table: {e}")
    for col, typ in [('parts_items', 'TEXT'), ('discussion_person', "VARCHAR(100) DEFAULT ''")]:
        try:
            db.session.execute(text(f'ALTER TABLE tracking_report ADD COLUMN {col} {typ}'))
            db.session.commit()
        except Exception:
            db.session.rollback()
    # [추가] 작업(maint_log) 마지막 등록/수정자 기록 컬럼
    for col, typ in [('updated_by', "VARCHAR(100) DEFAULT ''"), ('updated_at', "VARCHAR(30) DEFAULT ''")]:
        try:
            db.session.execute(text(f'ALTER TABLE maint_log ADD COLUMN {col} {typ}'))
            db.session.commit()
        except Exception:
            db.session.rollback()

with app.app_context():
    ensure_tracking_report_columns()
    ensure_item_stock_table()
    ensure_admin_parameter_table()
    ensure_equipment_report_table()
    ensure_chat_history_table()
    reset_legacy_issue_share_once()

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

# [추가] Windows 환경 멀티프로세스(Flask 리로더 등) 파일 락(WinError 32) 방어용 로깅 핸들러
class SafeTimedRotatingFileHandler(TimedRotatingFileHandler):
    def doRollover(self):
        if self.stream:
            self.stream.close()
            self.stream = None
        try:
            super().doRollover()
        except PermissionError:
            # 다른 프로세스가 파일을 점유 중일 경우 크래시 없이 현재 파일에 계속 기록
            if not self.stream:
                self.stream = self._open()

# 로깅 핸들러 설정 (매일 자정 회전, 30일 보관)
file_handler = SafeTimedRotatingFileHandler(
    os.path.join(LOG_DIR, 'server.log'),
    when='midnight',
    interval=1,
    backupCount=30,
    encoding='utf-8',
    delay=True
)
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

def split_safety_content(content_str):
    if not content_str:
        return []
    s_val = str(content_str).strip()
    if not s_val:
        return []

    try:
        admin_items = AdminItem.query.filter(
            (AdminItem.part.like('%,%')) | (AdminItem.code.like('%,%'))
        ).all()
        comma_keywords = set()
        for ai in admin_items:
            if ai.part and ',' in ai.part:
                comma_keywords.add(ai.part.strip())
            if ai.code and ',' in ai.code:
                comma_keywords.add(ai.code.strip())
        comma_parts = sorted(list(comma_keywords), key=lambda x: len(x), reverse=True)
    except Exception:
        comma_parts = []

    placeholder_map = {}
    temp_str = s_val
    for idx, part in enumerate(comma_parts):
        placeholder = f"___COMMA_PLACEHOLDER_{idx}___"
        if part in temp_str:
            temp_str = temp_str.replace(part, placeholder)
            placeholder_map[placeholder] = part

    splitted = [p.strip() for p in temp_str.split(',') if p.strip()]
    restored = []
    for item in splitted:
        r_item = item
        for ph, orig in placeholder_map.items():
            r_item = r_item.replace(ph, orig)
        restored.append(r_item)

    return restored


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

    # 2. 맨 앞 비용 태그('[유상]', '[무상]') 정제 (기존 파싱 유지)
    cost_tag = '유상'
    cm = re.match(r'^\[(.*?)\]\s*(.*)$', s)
    if cm:
        cost_tag = cm.group(1).strip()
        s = cm.group(2).strip()

    # 3. 맨 뒤 물품 상세 대괄호('[물품상세]') 추출 및 정제 (마스터 데이터 보호: 물품명/코드명 자체에 대괄호가 있는 경우 분리 방지)
    part_detail_tag = ''
    is_direct_admin_item = False
    try:
        match_direct = AdminItem.query.filter(
            (AdminItem.code == s) | (AdminItem.part == s) |
            (db.func.trim(AdminItem.code) == s) | (db.func.trim(AdminItem.part) == s)
        ).first()
        if match_direct:
            is_direct_admin_item = True
    except Exception:
        pass

    if not is_direct_admin_item:
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

    # 2-1. 사업장별 물품 관리 현황 (ItemStock)
    try:
        stocks = ItemStock.query.order_by(ItemStock.site_group, ItemStock.site_name, ItemStock.code, ItemStock.grade, ItemStock.id).all()
        data['item_stocks'] = [s.to_dict() for s in stocks]
    except Exception as e:
        app.logger.error(f"Error fetching item_stocks: {e}")
        data['item_stocks'] = []

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
                "updatedBy": getattr(m, 'updated_by', '') or '', "updatedAt": getattr(m, 'updated_at', '') or '',
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
            if not il_code or il_code in invalid_kws or (il.part and il.part in invalid_kws):
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
                "updatedBy": getattr(l, 'updated_by', '') or '', "updatedAt": getattr(l, 'updated_at', '') or '',
                "originalLogId": int(l.original_log_id) if l.original_log_id and str(l.original_log_id).isdigit() else l.original_log_id,
                "addWorkLogId": int(l.add_work_log_id) if l.add_work_log_id and str(l.add_work_log_id).isdigit() else l.add_work_log_id
            })

        # 셋업 화면 상세/일지 (setup_data)
        sd_list = setup_details.get(eq.id, [])
        sl_list = setup_logs.get(eq.id, [])
        if sd_list or sl_list:
            data['setup_data'][eq.id] = {
                "setupDetails": [{
                    "id": int(sd.id) if str(sd.id).isdigit() else sd.id,
                    "category": sd.category or '',
                    "subcategory": getattr(sd, 'subcategory', '') or '',
                    "content": sd.content or '',
                    "startDate": sd.start_date or '',
                    "date": sd.date or '',
                    "estDays": sd.est_days or '1',
                    "completed": sd.completed,
                    "execStartDate": sd.exec_start_date or '',
                    "delayReason": sd.delay_reason or ''
                } for sd in sd_list],
                "setupLogs": [{
                    "id": int(sl.id) if str(sl.id).isdigit() else sl.id,
                    "date": sl.date or '',
                    "category": getattr(sl, 'category', '') or '',
                    "subcategory": getattr(sl, 'subcategory', '') or '',
                    "worker": sl.worker or '',
                    "content": sl.content or '',
                    "company": sl.company or '위드텍',
                    "memo": sl.memo or '',
                    "specialNote": getattr(sl, 'special_note', '') or '',
                    "md": sl.md or '0',
                    "parts": sl.parts or ''
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

# [추가] 무차별 대입 방지(Limiter) 429 에러 발생 시 프론트엔드 대응
@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({"status": "fail", "message": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."}), 429

# [추가] 로그인 인증 데코레이터
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({"status": "fail", "message": "로그인이 필요합니다."}), 401
            return redirect('/')
        return f(*args, **kwargs)
    return decorated_function

# [추가] 관리자 권한 데코레이터
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({"status": "fail", "message": "로그인이 필요합니다."}), 401
            return redirect('/')
        if session.get('role') not in ['admin', 'superadmin']:
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({"status": "fail", "message": "관리자 권한이 필요합니다."}), 403
            return redirect('/')
        return f(*args, **kwargs)
    return decorated_function

# ==============================================================================
# [설비 Working Report 작성 및 관리 전용 API]
# ==============================================================================

# 0-1. 전체 사업장 목록 조회 API (Report 및 공통 사용)
@app.route('/api/sites', methods=['GET'])
def api_get_sites_list():
    try:
        sites = Site.query.order_by(Site.name.asc()).all()
        return jsonify([{'name': s.name, 'group': s.group or '기타사업장'} for s in sites if s.name])
    except Exception as e:
        app.logger.error(f"Error fetching sites in api_get_sites_list: {e}")
        return jsonify([]), 500

# 0-2. 전체 장비 목록 조회 API (Report 및 공통 사용)
@app.route('/api/equipment', methods=['GET'])
def api_get_equipment_list():
    try:
        site_filter = request.args.get('site', '').strip()
        query = Equipment.query
        if site_filter:
            query = query.filter_by(site_name=site_filter)
        equips = query.order_by(Equipment.site_name.asc(), Equipment.name.asc()).all()

        # [요청 반영] 모델명 약어 매핑 (EquipmentModel)
        try:
            models = EquipmentModel.query.all()
            model_abbr_map = {m.name: (m.abbr or m.name) for m in models}
        except Exception:
            model_abbr_map = {}

        result = []
        for eq in equips:
            abbr = model_abbr_map.get(eq.name, eq.name or '')
            result.append({
                'id': eq.id,
                'name': eq.name or '',
                'site_name': eq.site_name or '',
                'serial_no': eq.serial or '',
                'cust_equip_name': eq.cust_equip_name or '',
                'model_name': eq.name or '',
                'model_abbr': abbr,
                'building': eq.building or '',
                'floor': eq.floor or '',
                'detail_loc': eq.detail_loc or ''
            })
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"Error fetching equipment in api_get_equipment_list: {e}")
        return jsonify([]), 500

# [DATA/REPORT 공통] 장비별 엑셀형 데이터 시트 테이블명 생성 함수
def get_equip_data_table_name(abbr, cust_equip, serial, data_type='raw'):
    def clean_str(val):
        if not val:
            return ''
        cleaned = re.sub(r'[/\\.\x00]+', ' ', str(val).strip())
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        return cleaned

    abbr_part = clean_str(abbr) or 'EQUIP'
    cust_part = clean_str(cust_equip)
    serial_part = clean_str(serial)

    is_param = str(data_type).lower() in ('param', 'parameter')
    prefix = "zParam" if is_param else "zData"

    if cust_part:
        tbl = f"{prefix} {abbr_part} {cust_part}"
    elif serial_part:
        tbl = f"{prefix} {abbr_part} {serial_part}"
    else:
        tbl = f"{prefix} {abbr_part} DEFAULT"

    tbl = tbl[:64].rstrip()
    return tbl, tbl

# [요청 반영] Data 메뉴의 zParam 테이블명 다중 후보 및 퍼지 매칭 헬퍼
def resolve_zparam_table(model_name, model_abbr, cust_equip, serial):
    candidates = []
    # 1. 모델 약어 + 고객사장비명 / 시리얼
    if model_abbr:
        tbl1, _ = get_equip_data_table_name(model_abbr, cust_equip, serial, 'param')
        candidates.append(tbl1)
    # 2. 모델 정식명칭 + 고객사장비명 / 시리얼
    if model_name:
        tbl2, _ = get_equip_data_table_name(model_name, cust_equip, serial, 'param')
        candidates.append(tbl2)
    # 3. serial만 사용
    if serial:
        tbl3, _ = get_equip_data_table_name(model_abbr or model_name, '', serial, 'param')
        candidates.append(tbl3)
    # 4. cust_equip만 사용
    if cust_equip:
        tbl4, _ = get_equip_data_table_name(model_abbr or model_name, cust_equip, '', 'param')
        candidates.append(tbl4)

    # 존재하는 테이블 즉시 반환
    for tbl in candidates:
        if not tbl: continue
        if db_type == 'mysql':
            chk = db.session.execute(text("SHOW TABLES LIKE :tbl;"), {'tbl': tbl}).fetchone()
        else:
            chk = db.session.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name=:tbl;"), {'tbl': tbl}).fetchone()
        if chk:
            return tbl

    # 퍼지 검색: zParam 으로 시작하는 모든 테이블 중 cust_equip 또는 serial이 포함된 테이블 탐색
    try:
        if db_type == 'mysql':
            all_tbls = db.session.execute(text("SHOW TABLES LIKE 'zParam%';")).fetchall()
            tbl_names = [r[0] for r in all_tbls]
        else:
            all_tbls = db.session.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'zParam%';")).fetchall()
            tbl_names = [r[0] for r in all_tbls]

        clean_cust = re.sub(r'[/\\.\x00\s]+', '', str(cust_equip or '')).lower()
        clean_serial = re.sub(r'[/\\.\x00\s]+', '', str(serial or '')).lower()

        for t in tbl_names:
            t_clean = re.sub(r'[/\\.\x00\s]+', '', t).lower()
            if clean_cust and clean_cust in t_clean:
                return t
            if clean_serial and clean_serial in t_clean:
                return t
    except Exception as e:
        app.logger.warning(f"Error fuzzy resolving zParam table: {e}")

    return candidates[0] if candidates else f"zParam {model_abbr or model_name or 'EQUIP'} DEFAULT"

# [요청 반영] Data 메뉴의 zParam 테이블에서 해당 장비의 파라미터 점검 측정값 조회 헬퍼
def fetch_equipment_zparam_measurements(model_name, model_abbr, cust_equip, serial, report_date):
    table_name = resolve_zparam_table(model_name, model_abbr, cust_equip, serial)
    measured_map = {}
    extra_items = []
    has_table = False

    try:
        if db_type == 'mysql':
            chk = db.session.execute(text("SHOW TABLES LIKE :tbl;"), {'tbl': table_name}).fetchone()
            has_table = bool(chk)
        else:
            chk = db.session.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name=:tbl;"), {'tbl': table_name}).fetchone()
            has_table = bool(chk)

        if has_table:
            if db_type == 'mysql':
                cols_res = db.session.execute(text(f"SHOW COLUMNS FROM `{table_name}`")).fetchall()
                all_cols = [r[0] for r in cols_res]
            else:
                cols_res = db.session.execute(text(f"PRAGMA table_info(`{table_name}`)"))
                all_cols = [r[1] for r in cols_res]

            dt_clean = str(report_date or '').strip()
            dt_hyphen = dt_clean.replace('.', '-').replace('/', '-')
            dt_dot = dt_hyphen.replace('-', '.')

            target_row = db.session.execute(
                text(f"SELECT * FROM `{table_name}` WHERE record_date = :dt1 OR record_date = :dt2 OR record_date LIKE :dt3 ORDER BY id DESC LIMIT 1;"),
                {'dt1': dt_hyphen, 'dt2': dt_dot, 'dt3': f"%{dt_hyphen}%"}
            ).fetchone()

            if not target_row:
                target_row = db.session.execute(
                    text(f"SELECT * FROM `{table_name}` ORDER BY record_date DESC, id DESC LIMIT 1;")
                ).fetchone()

            if target_row:
                row_dict = dict(target_row._mapping)
                actual_date = str(row_dict.get('record_date') or dt_hyphen)
                act_hyphen = actual_date.replace('.', '-').replace('/', '-')
                act_dot = act_hyphen.replace('-', '.')

                col_lower_map = {c.lower(): c for c in all_cols}
                item_col = next((c for c in all_cols if '항목' in c or 'param' in c.lower() or 'item' in c.lower()), None)
                std_col = next((c for c in all_cols if '기준' in c or 'std' in c.lower() or 'normal' in c.lower()), None)
                val_col = next((c for c in all_cols if '측정' in c or 'value' in c.lower() or 'meas' in c.lower()), None)
                res_col = next((c for c in all_cols if '결과' in c or 'result' in c.lower() or 'status' in c.lower()), None)

                if item_col:
                    all_rows = db.session.execute(
                        text(f"SELECT * FROM `{table_name}` WHERE record_date = :dt1 OR record_date = :dt2 OR record_date LIKE :dt3 ORDER BY id ASC;"),
                        {'dt1': act_hyphen, 'dt2': act_dot, 'dt3': f"%{act_hyphen}%"}
                    ).fetchall()

                    if not all_rows:
                        all_rows = db.session.execute(
                            text(f"SELECT * FROM `{table_name}` ORDER BY id ASC;")
                        ).fetchall()

                    for r in all_rows:
                        rd = dict(r._mapping)
                        p_name = str(rd.get(item_col) or '').strip()
                        if not p_name: continue
                        p_std = str((rd.get(std_col) if std_col else None) or '').strip()
                        p_val = str((rd.get(val_col) if val_col else None) or '').strip()
                        res_val = str((rd.get(res_col) if res_col else None) or '').strip()

                        # [요청 반영] 상태 열에는 측정값을 최우선 반영
                        status_val = p_val if p_val else (res_val if res_val else '')

                        measured_map[p_name.lower()] = p_val or status_val
                        extra_items.append({
                            'name': p_name,
                            'standard': p_std,
                            'measured_val': p_val,
                            'status': p_val or status_val or '양호'
                        })
                else:
                    exclude_cols = ('id', 'record_date', 'created_at', 'updated_at', 'site', 'equip', 'date')
                    param_cols = [c for c in all_cols if c.lower() not in exclude_cols]

                    for col in param_cols:
                        measured = str(row_dict.get(col) if row_dict.get(col) is not None else '').strip()
                        measured_map[col.lower()] = measured
                        extra_items.append({
                            'name': col,
                            'standard': '',
                            'measured_val': measured,
                            'status': measured if measured else '양호'
                        })
    except Exception as e:
        app.logger.warning(f"Error fetching zParam measurements for {table_name}: {e}")

    return measured_map, extra_items, has_table, table_name

# 1. 장비 마스터 및 해당 일자 DB 작업 데이터 기반 리포트 소스 데이터 생성
@app.route('/api/report/source_data', methods=['GET'])
def get_report_source_data():
    try:
        equip_id = request.args.get('equip_id', '').strip()
        report_date = request.args.get('date', '').strip() or datetime.now().strftime('%Y-%m-%d')
        site_name = request.args.get('site_name', '').strip()

        if not equip_id:
            return jsonify({'status': 'error', 'message': '장비를 선택해주세요.'}), 400

        # 1. 장비 마스터 정보 조회
        equip = Equipment.query.filter_by(id=equip_id).first()
        if not equip:
            equip = Equipment.query.filter((Equipment.name == equip_id) | (Equipment.serial == equip_id)).first()

        equip_name = equip.name if equip else equip_id
        serial_no = equip.serial if equip else ''
        cust_equip = equip.cust_equip_name if equip else ''
        site_val = (equip.site_name if equip else site_name) or ''

        # [요청 반영] 설치장소 구성: 사업장명으로 기록
        location_str = site_val or ''

        # 2. 장비 모델명 추출
        model_name = equip_name
        model_abbr = ''
        eq_m = EquipmentModel.query.filter((EquipmentModel.name == equip_name) | (EquipmentModel.abbr == equip_name)).first()
        if eq_m:
            model_name = eq_m.name
            model_abbr = eq_m.abbr or ''

        # 3. 모델의 기본 Parameter 로드 (AdminParameter 테이블, sort_order 정렬)
        param_cond = (AdminParameter.model_name == model_name)
        if model_abbr:
            param_cond = param_cond | (AdminParameter.model_name == model_abbr) | (AdminParameter.model_abbr == model_abbr)
        if equip_name != model_name:
            param_cond = param_cond | (AdminParameter.model_name == equip_name)

        param_rows = AdminParameter.query.filter(param_cond).order_by(
            AdminParameter.sort_order.asc(), 
            AdminParameter.id.asc()
        ).all()

        # [요청 반영] Data 메뉴의 zParam 파라미터 점검 측정값 조회 및 상태(status) 칸에 매핑
        measured_map, extra_items, has_tbl, tbl_name = fetch_equipment_zparam_measurements(
            model_name, model_abbr, cust_equip, serial_no, report_date
        )

        default_params = []
        existing_names = set()
        for p in param_rows:
            if not p.name: continue
            p_lower = p.name.strip().lower()
            existing_names.add(p_lower)
            # [요청 반영] 상태에 Data parameter 측정값 자동 반영
            measured = measured_map.get(p_lower, '')
            default_params.append({
                'id': p.id,
                'name': p.name,
                'standard': p.standard or '',
                'unit': p.unit or '',
                'measured_val': measured,
                'status': measured,
                'memo': p.memo or ''
            })

        # AdminParameter에 없지만 Data parameter 테이블에만 존재하는 추가 항목이 있다면 보완 반영
        for ex in extra_items:
            ex_name = ex.get('name', '').strip()
            if ex_name and ex_name.lower() not in existing_names:
                default_params.append({
                    'id': f"zparam_{len(default_params)}",
                    'name': ex_name,
                    'standard': ex.get('standard', ''),
                    'unit': '',
                    'measured_val': ex.get('measured_val', ''),
                    'status': ex.get('status', ex.get('measured_val', '')),
                    'memo': ''
                })
                existing_names.add(ex_name.lower())

        # 4. 해당 날짜(report_date)의 실제 점검/작업 이력 로드 (LogItem)
        log_query = LogItem.query.filter(LogItem.date == report_date)
        if equip:
            log_query = log_query.filter((LogItem.equip_id == equip.id) | (LogItem.equip_id == equip.name) | (LogItem.equip_id == equip_id))
        else:
            log_query = log_query.filter(LogItem.equip_id == equip_id)
        day_logs = log_query.all()

        workers_set = set()
        history_items = []
        check_type_found = '정기'

        for log in day_logs:
            if log.worker and log.worker.strip():
                workers_set.add(log.worker.strip())
            if log.type:
                check_type_found = log.type
            content_line = log.content or ''
            if content_line:
                if not content_line.startswith('-') and not content_line.startswith('·'):
                    content_line = f"-. {content_line}"
                history_items.append(content_line)
            if log.memo and log.memo.strip():
                memo_line = f"-. {log.memo.strip()}"
                if memo_line not in history_items:
                    history_items.append(memo_line)

        inspector_str = ", ".join(sorted(list(workers_set))) if workers_set else (session.get('user_name') or '')

        # 5. 해당 날짜의 부품 교체 이력 로드 (ItemLog)
        item_query = ItemLog.query.filter(ItemLog.date == report_date)
        if equip:
            item_query = item_query.filter((ItemLog.equip_id == equip.id) | (ItemLog.equip_id == equip.name) | (ItemLog.equip_id == equip_id))
        else:
            item_query = item_query.filter(ItemLog.equip_id == equip_id)
        day_items = item_query.all()

        replaced_parts = []
        for it in day_items:
            part_name = it.code or it.part or ''
            if part_name:
                cost_val = getattr(it, 'cost', '')
                if not cost_val and (it.code or it.part):
                    ai = AdminItem.query.filter((AdminItem.code == it.code) | (AdminItem.part == (it.code or it.part))).first()
                    if ai and ai.additional:
                        cost_val = ai.additional
                cost_prefix = f"[{cost_val}] " if cost_val else ""
                detail_suffix = f" [{it.part_detail}]" if it.part_detail else ""
                formatted_part = f"{cost_prefix}{part_name}{detail_suffix}"
                if formatted_part not in replaced_parts:
                    replaced_parts.append(formatted_part)

        return jsonify({
            'status': 'success',
            'data': {
                'equip_id': equip_id,
                'equip_name': equip_name,
                'model_name': model_name,
                'model_abbr': model_abbr,
                'site_name': site_val,
                'building': equip.building if equip else '',
                'floor': equip.floor if equip else '',
                'detail_loc': equip.detail_loc if equip else '',
                'location': location_str,
                'serial_no': serial_no,
                'cust_equip_name': cust_equip,
                'report_date': report_date,
                'inspector': inspector_str,
                'check_type': check_type_found,
                'model_params': default_params,
                'history_items': history_items,
                'replaced_parts': replaced_parts,
                'special_note': equip.special_note if equip else ''
            }
        })
    except Exception as e:
        app.logger.error(f"Error in get_report_source_data: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500



# 1-2. Data 메뉴의 장비 파라미터 점검값(zParam) 조회 API (보고서 파라미터 항목 자동 연동)
@app.route('/api/report/data_parameters', methods=['GET'])
def get_report_data_parameters():
    try:
        equip_id = request.args.get('equip_id', '').strip()
        report_date = request.args.get('date', '').strip() or datetime.now().strftime('%Y-%m-%d')
        site_name = request.args.get('site_name', '').strip()

        if not equip_id:
            return jsonify({'status': 'error', 'message': '장비를 선택해주세요.'}), 400

        # 장비 마스터 조회
        equip = Equipment.query.filter_by(id=equip_id).first()
        if not equip:
            equip = Equipment.query.filter((Equipment.name == equip_id) | (Equipment.serial == equip_id)).first()

        if not equip:
            return jsonify({'status': 'error', 'message': '일치하는 장비 정보가 없습니다.'}), 404

        cust_equip = equip.cust_equip_name or ''
        serial = equip.serial or ''
        model_name = equip.name or ''

        # 모델 약어(Abbr) 조회
        model_abbr = ''
        eq_m = EquipmentModel.query.filter((EquipmentModel.name == model_name) | (EquipmentModel.abbr == model_name)).first()
        if eq_m:
            model_abbr = eq_m.abbr or eq_m.name
        else:
            model_abbr = model_name

        # Data 파라미터 점검 테이블명 생성 및 다중 매칭
        table_name = resolve_zparam_table(model_name, model_abbr, cust_equip, serial)

        # AdminParameter 마스터 조회 (기준값 매핑용)
        param_master_query = AdminParameter.query.filter(
            (AdminParameter.model_name == model_name) | 
            (AdminParameter.model_name == model_abbr) | 
            (AdminParameter.model_abbr == model_abbr)
        ).all()
        std_map = {}
        for p in param_master_query:
            if p.name:
                std_map[p.name.strip().lower()] = {
                    'name': p.name.strip(),
                    'standard': p.standard or '',
                    'unit': p.unit or ''
                }

        items = []
        actual_date = report_date

        # zParam 테이블 존재 여부 확인
        tbl_exists = False
        if db_type == 'mysql':
            chk = db.session.execute(text("SHOW TABLES LIKE :tbl;"), {'tbl': table_name}).fetchone()
            tbl_exists = bool(chk)
        else:
            chk = db.session.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name=:tbl;"), {'tbl': table_name}).fetchone()
            tbl_exists = bool(chk)

        if tbl_exists:
            # 컬럼 목록 조회
            if db_type == 'mysql':
                cols_res = db.session.execute(text(f"SHOW COLUMNS FROM `{table_name}`")).fetchall()
                all_cols = [r[0] for r in cols_res]
            else:
                cols_res = db.session.execute(text(f"PRAGMA table_info(`{table_name}`)"))
                all_cols = [r[1] for r in cols_res]

            dt_clean = str(report_date or '').strip()
            dt_hyphen = dt_clean.replace('.', '-').replace('/', '-')
            dt_dot = dt_hyphen.replace('-', '.')

            # 1. 일자 일치 행 조회 시도 (하이픈/점 및 부분 일치)
            target_row = db.session.execute(
                text(f"SELECT * FROM `{table_name}` WHERE record_date = :dt1 OR record_date = :dt2 OR record_date LIKE :dt3 ORDER BY id DESC LIMIT 1;"),
                {'dt1': dt_hyphen, 'dt2': dt_dot, 'dt3': f"%{dt_hyphen}%"}
            ).fetchone()

            # 일치하는 일자 행이 없으면 가장 최근 행 조회
            if not target_row:
                target_row = db.session.execute(
                    text(f"SELECT * FROM `{table_name}` ORDER BY record_date DESC, id DESC LIMIT 1;")
                ).fetchone()

            if target_row:
                row_dict = dict(target_row._mapping)
                actual_date = str(row_dict.get('record_date') or dt_hyphen)
                act_hyphen = actual_date.replace('.', '-').replace('/', '-')
                act_dot = act_hyphen.replace('-', '.')

                # 구조 A: 세로형 테이블인 경우 (파라미터 항목, 기준값, 측정값, 결과 컬럼)
                col_lower_map = {c.lower(): c for c in all_cols}
                item_col = next((c for c in all_cols if '항목' in c or 'param' in c.lower() or 'item' in c.lower()), None)
                std_col = next((c for c in all_cols if '기준' in c or 'std' in c.lower() or 'normal' in c.lower()), None)
                val_col = next((c for c in all_cols if '측정' in c or 'value' in c.lower() or 'meas' in c.lower()), None)
                res_col = next((c for c in all_cols if '결과' in c or 'result' in c.lower() or 'status' in c.lower()), None)

                if item_col:
                    # 해당 일자의 모든 행 조회
                    all_rows = db.session.execute(
                        text(f"SELECT * FROM `{table_name}` WHERE record_date = :dt1 OR record_date = :dt2 OR record_date LIKE :dt3 ORDER BY id ASC;"),
                        {'dt1': act_hyphen, 'dt2': act_dot, 'dt3': f"%{act_hyphen}%"}
                    ).fetchall()

                    if not all_rows:
                        all_rows = db.session.execute(
                            text(f"SELECT * FROM `{table_name}` ORDER BY id ASC;")
                        ).fetchall()

                    for r in all_rows:
                        rd = dict(r._mapping)
                        p_name = str(rd.get(item_col) or '').strip()
                        if not p_name:
                            continue
                        
                        m_info = std_map.get(p_name.lower(), {})
                        p_std = str((rd.get(std_col) if std_col else None) or m_info.get('standard') or '').strip()
                        p_val = str((rd.get(val_col) if val_col else None) or '').strip()
                        res_val = str((rd.get(res_col) if res_col else None) or '').strip()

                        # [요청 반영] 상태 열에는 입력한 측정값(p_val)을 최우선으로 입력
                        status_val = p_val if p_val else (res_val if res_val else '양호')

                        items.append({
                            'name': p_name,
                            'standard': p_std,
                            'measured_val': p_val,
                            'status': status_val
                        })

                # 구조 B: 가로형 컬럼 구조 (각 컬럼이 하나의 파라미터명인 경우)
                else:
                    exclude_cols = ('id', 'record_date', 'created_at', 'updated_at', 'site', 'equip', 'date')
                    param_cols = [c for c in all_cols if c.lower() not in exclude_cols]

                    for col in param_cols:
                        m_info = std_map.get(col.lower(), {})
                        measured = str(row_dict.get(col) if row_dict.get(col) is not None else '').strip()
                        items.append({
                            'name': col,
                            'standard': m_info.get('standard', ''),
                            'measured_val': measured,
                            'status': measured if measured else '양호'
                        })

        # DB에 zParam 테이블이나 데이터가 없더라도 AdminParameter 마스터가 있다면 기본 목록 제공
        if not items and param_master_query:
            for p in param_master_query:
                if not p.name: continue
                items.append({
                    'name': p.name.strip(),
                    'standard': p.standard or '',
                    'measured_val': '',
                    'status': '' # 측정값 대기
                })

        return jsonify({
            'status': 'success',
            'has_table': tbl_exists,
            'table_name': table_name,
            'record_date': actual_date,
            'count': len(items),
            'items': items
        })
    except Exception as e:
        app.logger.error(f"Error in get_report_data_parameters: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500


# 2. 특정 장비의 저장된 보고서 날짜 목록(히스토리) 조회
@app.route('/api/report/history', methods=['GET'])
def get_report_history():
    try:
        equip_id = request.args.get('equip_id', '').strip()
        site_name = request.args.get('site_name', '').strip()

        query = EquipmentReport.query
        if equip_id:
            query = query.filter_by(equip_id=equip_id)
        elif site_name:
            query = query.filter_by(site_name=site_name)

        reports = query.order_by(EquipmentReport.report_date.desc(), EquipmentReport.updated_at.desc()).all()

        history = [{
            'id': r.id,
            'equip_id': r.equip_id,
            'equip_name': r.equip_name,
            'site_name': r.site_name,
            'report_date': r.report_date,
            'title': r.title,
            'inspector': r.inspector,
            'updated_at': r.updated_at.strftime('%Y-%m-%d %H:%M') if r.updated_at else ''
        } for r in reports]

        return jsonify({'status': 'success', 'history': history})
    except Exception as e:
        app.logger.error(f"Error in get_report_history: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


# 3. 저장된 특정 보고서 상세 로드
@app.route('/api/report/<report_id>', methods=['GET'])
def get_single_report(report_id):
    try:
        report = EquipmentReport.query.filter_by(id=report_id).first()
        if not report:
            return jsonify({'status': 'error', 'message': '보고서를 찾을 수 없습니다.'}), 404
        return jsonify({'status': 'success', 'report': report.to_dict()})
    except Exception as e:
        app.logger.error(f"Error in get_single_report: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


# 4. 보고서 저장 (신규 작성 또는 기존 보고서 갱신)
@app.route('/api/report/save', methods=['POST'])
@csrf.exempt
def save_equipment_report():
    try:
        payload = request.get_json(silent=True) or {}
        site_name = payload.get('site_name', '').strip()
        equip_id = payload.get('equip_id', '').strip()
        report_date = payload.get('report_date', '').strip()

        if not site_name or not equip_id or not report_date:
            return jsonify({'status': 'error', 'message': '사업장, 장비, 점검일자는 필수 입력값입니다.'}), 400

        # [각 보고서 독립 관리] custom_id가 전달된 경우 해당 보고서 레코드를 최우선 조회하여 수정
        custom_id = payload.get('id')
        report = None
        if custom_id:
            report = EquipmentReport.query.filter_by(id=custom_id).first()

        # custom_id가 없거나 해당 ID가 없는 신규 건인 경우에만 해당 날짜 보고서 확인
        if not report and not custom_id:
            report = EquipmentReport.query.filter_by(equip_id=equip_id, report_date=report_date).first()

        if not report:
            safe_equip = equip_id.replace('::', '_').replace(' ', '_')
            target_id = custom_id or f"rep_{report_date.replace('-', '')}_{safe_equip}_{int(datetime.now().timestamp())}"
            if EquipmentReport.query.filter_by(id=target_id).first():
                target_id = f"{target_id}_{int(datetime.now().timestamp())}"
            custom_id = target_id

        data_content = payload.get('data_json') or payload.get('data') or {}
        if isinstance(data_content, str):
            data_json_str = data_content
        else:
            data_json_str = json.dumps(data_content, ensure_ascii=False)

        if report:
            report.site_name = site_name
            report.equip_id = equip_id
            report.equip_name = payload.get('equip_name', report.equip_name)
            report.model_name = payload.get('model_name', report.model_name)
            report.report_date = report_date
            report.title = payload.get('title', report.title)
            report.inspector = payload.get('inspector', report.inspector)
            report.location = payload.get('location', report.location)
            report.serial_no = payload.get('serial_no', report.serial_no)
            report.data_json = data_json_str
            report.updated_at = get_utc_now()
        else:
            report = EquipmentReport(
                id=custom_id,
                site_name=site_name,
                equip_id=equip_id,
                equip_name=payload.get('equip_name', ''),
                model_name=payload.get('model_name', ''),
                report_date=report_date,
                title=payload.get('title', 'Working Report'),
                inspector=payload.get('inspector', ''),
                location=payload.get('location', ''),
                serial_no=payload.get('serial_no', ''),
                data_json=data_json_str,
                created_at=get_utc_now(),
                updated_at=get_utc_now()
            )
            db.session.add(report)

        db.session.commit()
        return jsonify({'status': 'success', 'report_id': report.id, 'report': report.to_dict()})

    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error in save_equipment_report: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f"저장 실패: {str(e)}"}), 500


# 5. 보고서 삭제
@app.route('/api/report/<report_id>', methods=['DELETE'])
@csrf.exempt
def delete_equipment_report(report_id):
    try:
        report = EquipmentReport.query.filter_by(id=report_id).first()
        if not report:
            return jsonify({'status': 'error', 'message': '보고서를 찾을 수 없습니다.'}), 404
        db.session.delete(report)
        db.session.commit()
        return jsonify({'status': 'success', 'message': '보고서가 삭제되었습니다.'})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error in delete_equipment_report: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


# 6. 특정 모델의 마스터 파라미터 목록 조회 (파라미터 추가 팝업용)
@app.route('/api/report/model_parameters', methods=['GET'])
def get_report_model_parameters():
    try:
        model_name = request.args.get('model_name', '').strip()
        if not model_name:
            return jsonify({'status': 'success', 'parameters': []})

        eq_m = EquipmentModel.query.filter((EquipmentModel.name == model_name) | (EquipmentModel.abbr == model_name)).first()
        abbr = eq_m.abbr if eq_m else ''

        cond = (AdminParameter.model_name == model_name)
        if abbr:
            cond = cond | (AdminParameter.model_name == abbr) | (AdminParameter.model_abbr == abbr)

        rows = AdminParameter.query.filter(cond).order_by(AdminParameter.sort_order.asc(), AdminParameter.id.asc()).all()
        result = [{
            'id': r.id,
            'name': r.name,
            'standard': r.standard or '',
            'unit': r.unit or '',
            'memo': r.memo or ''
        } for r in rows if r.name]

        return jsonify({'status': 'success', 'parameters': result})
    except Exception as e:
        app.logger.error(f"Error in get_report_model_parameters: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ------------------------------------------------------------------------------
# [DATA 페이지] 장비별 엑셀형 데이터 시트 DB 연동 API
# 규칙: 현재 연동된 DB(로컬: dbwithtech001 / 가비아: .env 설정 DB) 내 장비별 테이블 자동 생성
# 테이블명: zData 장비약어 고객사장비명 또는 (고객사장비명 없을 시) zData 장비약어 시리얼넘버
# 접두사 zData: DB 툴에서 알파벳 순 정렬 시 최하단으로 정렬되어 시스템 테이블과 깔끔히 분리
# ------------------------------------------------------------------------------
# (get_equip_data_table_name 함수는 상단 공통 영역에 선언되어 공유됩니다)

@app.route('/api/datasheet/load', methods=['POST'])
@csrf.exempt
def load_datasheet():
    if 'user_id' not in session:
        return jsonify({"status": "fail", "message": "로그인이 필요합니다."}), 401

    req_data = request.json or {}
    model_abbr = req_data.get('model_abbr', '').strip()
    cust_equip = req_data.get('cust_equip', '').strip()
    serial = req_data.get('serial', '').strip()
    data_type = req_data.get('data_type', 'raw').strip().lower()

    table_name, display_name = get_equip_data_table_name(model_abbr, cust_equip, serial, data_type)
    if not table_name:
        return jsonify({"status": "fail", "message": "유효하지 않은 장비 정보입니다."}), 400

    try:
        # 테이블 존재 여부 확인
        if db_type == 'mysql':
            chk = db.session.execute(text("SHOW TABLES LIKE :tbl;"), {'tbl': table_name}).fetchone()
        else:
            chk = db.session.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name=:tbl;"), {'tbl': table_name}).fetchone()

        if not chk:
            return jsonify({
                "status": "success",
                "table_name": table_name,
                "display_name": display_name,
                "data_type": data_type,
                "exists": False,
                "columns": [],
                "rows": []
            })

        # 컬럼 목록 조회
        if db_type == 'mysql':
            cols_res = db.session.execute(text(f"SHOW COLUMNS FROM `{table_name}`")).fetchall()
            all_cols = [r[0] for r in cols_res]
        else:
            cols_res = db.session.execute(text(f"PRAGMA table_info(`{table_name}`)"))
            all_cols = [r[1] for r in cols_res]

        # raw 모드일 때 division, concentration, port_name, conc_unit 컬럼 누락 방지 (기존 테이블 마이그레이션)
        if data_type == 'raw':
            for fix_col, col_def in [('division', 'VARCHAR(50) DEFAULT \'\''), 
                                    ('concentration', 'VARCHAR(50) DEFAULT \'\''), 
                                    ('port_name', 'VARCHAR(100) DEFAULT \'\''), 
                                    ('conc_unit', 'VARCHAR(20) DEFAULT \'ppm\'')]:
                if fix_col not in all_cols:
                    if db_type == 'mysql':
                        db.session.execute(text(f"ALTER TABLE `{table_name}` ADD COLUMN `{fix_col}` {col_def};"))
                    else:
                        db.session.execute(text(f"ALTER TABLE `{table_name}` ADD COLUMN `{fix_col}` TEXT DEFAULT '';"))
                    all_cols.append(fix_col)
            db.session.commit()

        data_cols = [c for c in all_cols if c not in ('id', 'record_date', 'created_at', 'updated_at', 'division', 'concentration', 'port_name', 'conc_unit')]

        # 데이터 행 조회 (날짜는 최신순, 동일 날짜 내에서는 저장된 순서(id ASC) 그대로 유지)
        rows_res = db.session.execute(text(f"SELECT * FROM `{table_name}` ORDER BY record_date DESC, id ASC;")).fetchall()
        rows_data = []
        conc_unit_val = 'ppm'
        for idx, r in enumerate(rows_res):
            row_dict = dict(r._mapping)
            date_val = row_dict.get('record_date', '')
            div_val = row_dict.get('division')
            if div_val is None:
                div_val = ''
            conc_val = row_dict.get('concentration')
            if conc_val is None:
                conc_val = ''
            port_val = row_dict.get('port_name')
            if port_val is None:
                port_val = ''
            if row_dict.get('conc_unit'):
                conc_unit_val = row_dict.get('conc_unit')
            vals = {c: (row_dict.get(c) if row_dict.get(c) is not None else '') for c in data_cols}
            row_id_num = row_dict.get('id', idx + 1)
            rows_data.append({
                "id": f"row_{row_id_num}",
                "db_id": row_id_num,
                "db_order": idx,
                "date": date_val,
                "division": str(div_val),
                "concentration": str(conc_val),
                "port": str(port_val),
                "port_name": str(port_val),
                "values": vals
            })

        return jsonify({
            "status": "success",
            "table_name": table_name,
            "display_name": display_name,
            "data_type": data_type,
            "exists": True,
            "conc_unit": conc_unit_val,
            "columns": data_cols,
            "rows": rows_data
        })
    except Exception as e:
        app.logger.error(f"Error loading datasheet from table `{table_name}`: {e}", exc_info=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

@app.route('/api/datasheet/save', methods=['POST'])
@csrf.exempt
def save_datasheet():
    if 'user_id' not in session:
        return jsonify({"status": "fail", "message": "로그인이 필요합니다."}), 401

    req_data = request.json or {}
    model_abbr = req_data.get('model_abbr', '').strip()
    cust_equip = req_data.get('cust_equip', '').strip()
    serial = req_data.get('serial', '').strip()
    data_type = req_data.get('data_type', 'raw').strip().lower()
    columns = req_data.get('columns', [])
    rows = req_data.get('rows', [])
    reset_table = req_data.get('reset_table', False)
    conc_unit = req_data.get('conc_unit', 'ppm').strip() or 'ppm'

    table_name, display_name = get_equip_data_table_name(model_abbr, cust_equip, serial, data_type)
    if not table_name:
        return jsonify({"status": "fail", "message": "유효하지 않은 장비 정보입니다."}), 400

    try:
        # 테이블 초기화 요청 시 기존 테이블 완전 삭제 후 재생성
        if reset_table:
            db.session.execute(text(f"DROP TABLE IF EXISTS `{table_name}`;"))
            db.session.commit()

        # 1. 테이블 생성 (없는 경우)
        if db_type == 'mysql':
            create_tbl_sql = f"""
            CREATE TABLE IF NOT EXISTS `{table_name}` (
                `id` INT AUTO_INCREMENT PRIMARY KEY,
                `record_date` VARCHAR(30) NOT NULL,
                `division` VARCHAR(50) DEFAULT '',
                `concentration` VARCHAR(50) DEFAULT '',
                `port_name` VARCHAR(100) DEFAULT '',
                `conc_unit` VARCHAR(20) DEFAULT 'ppm',
                `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """
        else:
            create_tbl_sql = f"""
            CREATE TABLE IF NOT EXISTS `{table_name}` (
                `id` INTEGER PRIMARY KEY AUTOINCREMENT,
                `record_date` VARCHAR(30) NOT NULL,
                `division` VARCHAR(50) DEFAULT '',
                `concentration` VARCHAR(50) DEFAULT '',
                `port_name` VARCHAR(100) DEFAULT '',
                `conc_unit` VARCHAR(20) DEFAULT 'ppm',
                `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        db.session.execute(text(create_tbl_sql))
        db.session.commit()

        # 2. 기존 컬럼 확인
        if db_type == 'mysql':
            cols_res = db.session.execute(text(f"SHOW COLUMNS FROM `{table_name}`")).fetchall()
            existing_cols = [r[0] for r in cols_res]
        else:
            cols_res = db.session.execute(text(f"PRAGMA table_info(`{table_name}`)"))
            existing_cols = [r[1] for r in cols_res]

        # 2-1. raw 모드일 때 division, concentration, port_name, conc_unit 컬럼 누락 방지 (기존 테이블 마이그레이션)
        if data_type == 'raw':
            for fix_col, col_def in [('division', 'VARCHAR(50) DEFAULT \'\''), 
                                    ('concentration', 'VARCHAR(50) DEFAULT \'\''), 
                                    ('port_name', 'VARCHAR(100) DEFAULT \'\''), 
                                    ('conc_unit', 'VARCHAR(20) DEFAULT \'ppm\'')]:
                if fix_col not in existing_cols:
                    if db_type == 'mysql':
                        db.session.execute(text(f"ALTER TABLE `{table_name}` ADD COLUMN `{fix_col}` {col_def};"))
                    else:
                        db.session.execute(text(f"ALTER TABLE `{table_name}` ADD COLUMN `{fix_col}` TEXT DEFAULT '';"))
                    existing_cols.append(fix_col)
            db.session.commit()

        # 3. 새로운 열(Column) 동적 추가
        for col in columns:
            col_safe = col.replace('`', '').strip()
            if col_safe and col_safe not in existing_cols and col_safe not in ('id', 'record_date', 'created_at', 'updated_at', 'division', 'concentration', 'port_name', 'conc_unit'):
                if db_type == 'mysql':
                    db.session.execute(text(f"ALTER TABLE `{table_name}` ADD COLUMN `{col_safe}` TEXT NULL;"))
                else:
                    db.session.execute(text(f"ALTER TABLE `{table_name}` ADD COLUMN `{col_safe}` TEXT;"))
                existing_cols.append(col_safe)
        db.session.commit()

        # 4. 데이터 동기화 (전체 행 재반영)
        db.session.execute(text(f"DELETE FROM `{table_name}`;"))

        valid_columns = [c for c in columns if c.replace('`', '').strip() in existing_cols and c.replace('`', '').strip() not in ('id', 'record_date', 'created_at', 'updated_at', 'division', 'concentration', 'port_name', 'conc_unit')]
        for r in rows:
            date_val = r.get('date', '')
            vals = r.get('values', {})
            div_val = r.get('division') if r.get('division') is not None and str(r.get('division')).strip() != '' else vals.get('구분', '')
            conc_val = r.get('concentration') if r.get('concentration') is not None and str(r.get('concentration')).strip() != '' else vals.get('농도', '')
            port_val = r.get('port') if r.get('port') is not None and str(r.get('port')).strip() != '' else (r.get('port_name') if r.get('port_name') is not None and str(r.get('port_name')).strip() != '' else (vals.get('Port Name', '') or vals.get('포트', '')))

            col_list = ['`record_date`']
            ph_list = [':rec_date']
            params = {'rec_date': date_val}

            # raw 모드이거나 테이블에 division/concentration/port_name 컬럼이 존재하는 경우 항상 저장
            if 'division' in existing_cols and 'concentration' in existing_cols:
                col_list.extend(['`division`', '`concentration`'])
                ph_list.extend([':division', ':concentration'])
                params['division'] = str(div_val) if div_val is not None else ''
                params['concentration'] = str(conc_val) if conc_val is not None else ''

            if 'port_name' in existing_cols:
                col_list.append('`port_name`')
                ph_list.append(':port_name')
                params['port_name'] = str(port_val) if port_val is not None else ''

            if 'conc_unit' in existing_cols:
                col_list.append('`conc_unit`')
                ph_list.append(':conc_unit')
                params['conc_unit'] = str(conc_unit)

            for idx, c in enumerate(valid_columns):
                c_safe = c.replace('`', '').strip()
                col_list.append(f"`{c_safe}`")
                param_key = f"val_{idx}"
                ph_list.append(f":{param_key}")
                params[param_key] = str(vals.get(c, '')) if vals.get(c) is not None else ''

            insert_sql = f"INSERT INTO `{table_name}` ({', '.join(col_list)}) VALUES ({', '.join(ph_list)});"
            db.session.execute(text(insert_sql), params)

        db.session.commit()
        return jsonify({
            "status": "success",
            "table_name": table_name,
            "display_name": display_name,
            "row_count": len(rows),
            "column_count": len(valid_columns),
            "conc_unit": conc_unit
        })
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error saving datasheet to table `{table_name}`: {e}", exc_info=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

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
# 6. 라우트: 뷰 (Routes: Views)
# ------------------------------------------------------------------------------
@app.route('/')
@app.route('/home')
@app.route('/index.html')
def home():
    return render_template('index.html', active_page='home')

@app.route('/index')
def index():
    return redirect(url_for('home'))

@app.route('/setup')
@app.route('/setup.html')
def setup():
    return render_template('setup.html', active_page='setup')

@app.route('/maintenance')
@app.route('/maintenance.html')
def maintenance():
    return render_template('maintenance.html', active_page='maintenance')

@app.route('/trouble')
@app.route('/trouble.html')
def trouble():
    return render_template('trouble.html', active_page='trouble')

@app.route('/tracking')
@app.route('/tracking.html')
def tracking():
    return render_template('tracking.html', active_page='tracking')

@app.route('/api/tracking/reports', methods=['GET'])
@login_required
def get_tracking_reports():
    try:
        reports = TrackingReport.query.all()
        return jsonify({"status": "success", "reports": [r.to_dict() for r in reports]})
    except Exception as e:
        app.logger.error(f"Failed to load tracking reports: {e}")
        return jsonify({"status": "fail", "message": "Tracking 레포트를 불러오지 못했습니다."}), 500

@app.route('/api/tracking/report', methods=['POST'])
@login_required
def save_tracking_report():
    payload = request.json or {}
    equip_id = str(payload.get('equipId') or '').strip()
    family_id = str(payload.get('familyId') or '').strip()
    if not equip_id or not family_id:
        return jsonify({"status": "fail", "message": "장비 또는 작업 정보가 올바르지 않습니다."}), 400

    def clip(v, n=5000):
        return str(v or '')[:n]

    try:
        user = db.session.get(User, session.get('user_id'))
        writer = (user.name if user and user.name else session.get('user_id')) or ''

        report = TrackingReport.query.filter_by(equip_id=equip_id, family_id=family_id).first()
        if not report:
            report = TrackingReport(equip_id=equip_id, family_id=family_id, created_by=writer)
            db.session.add(report)

        report.site_name = clip(payload.get('siteName'), 100)
        report.equip_key = clip(payload.get('equipKey'), 200)
        report.symptom = clip(payload.get('symptom'))
        report.action = clip(payload.get('action'))
        if 'parts' in payload:  # 필요물품 텍스트 입력란 삭제 → 기존 값 보존
            report.parts = clip(payload.get('parts'))
        items = []
        for it in (payload.get('partsItems') or [])[:100]:
            if not isinstance(it, dict):
                continue
            try:
                qty = max(1, min(9999, int(it.get('qty') or 1)))
            except (TypeError, ValueError):
                qty = 1
            items.append({
                'id': clip(it.get('id'), 50), 'code': clip(it.get('code'), 100), 'part': clip(it.get('part'), 100),
                'spec': clip(it.get('spec'), 255), 'partno': clip(it.get('partno'), 100), 'qty': qty
            })
        report.parts_items = json.dumps(items, ensure_ascii=False)
        report.discussion = clip(payload.get('discussion'))
        report.discussion_person = clip(payload.get('discussionPerson'), 100)
        basic = payload.get('basic') if isinstance(payload.get('basic'), dict) else {}
        report.basic_json = json.dumps(basic, ensure_ascii=False)[:20000]
        report.updated_by = writer
        report.updated_at = get_utc_now()
        db.session.commit()
        return jsonify({"status": "success", "report": report.to_dict()})
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Failed to save tracking report: {e}")
        return jsonify({"status": "fail", "message": "Tracking 레포트 저장 중 오류가 발생했습니다."}), 500

@app.route('/data')
@app.route('/data_page')
@app.route('/data.html')
def data_page():
    return render_template('data.html', active_page='data')

@app.route('/operation')
@app.route('/operation.html')
def operation():
    return render_template('operation.html', active_page='operation')

@app.route('/sort')
@app.route('/sort.html')
def sort():
    return render_template('sort.html', active_page='sort')

@app.route('/report')
@app.route('/report_page')
@app.route('/report.html')
def report_page():
    return render_template('report.html', active_page='report')

@app.route('/admin')
@app.route('/admin.html')
def admin():
    return render_template('admin.html', active_page='admin')

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
    data = request.json or {}
    user_id = data.get('id', '').strip()  # [수정] 모바일/복붙 시 발생하는 보이지 않는 끝 공백 제거
    user_pw = data.get('pw', '').strip()

    if not user_id or not user_pw:
        return jsonify({"status": "fail", "message": "아이디와 비밀번호를 입력해주세요."}), 400

    user = User.query.filter_by(id=user_id).first()
    if not user:
        return jsonify({"status": "fail", "message": "아이디 또는 비밀번호가 올바르지 않습니다."}), 401

    
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
        
        # [추가] 새 세션에 대한 유효한 CSRF 토큰 발급 및 응답 전달
        new_csrf = generate_csrf()
        resp = jsonify({
            "status": "success", 
            "role": user.role, 
            "site": user.site,
            "department": user.department or "",
            "position": user.position or "",
            "name": user.name or "",
            "require_pw_change": require_pw_change,
            "csrf_token": new_csrf
        })
        resp.set_cookie(
            'csrf_token',
            new_csrf,
            httponly=False,
            samesite='Lax',
            secure=True if os.environ.get('USE_HTTPS') == 'true' else False
        )
        return resp

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
# [변경] AI 챗봇 (Tool Calling 방식) — 세부 구현은 chatbot_service.py
# ------------------------------------------------------------------------------
from chatbot_service import init_chatbot

init_chatbot(
    app, db, limiter, login_required,
    models={
        'User': User, 'Site': Site, 'Equipment': Equipment, 'EquipmentModel': EquipmentModel,
        'LogItem': LogItem, 'TroubleLog': TroubleLog, 'SetupDetail': SetupDetail, 'ItemLog': ItemLog,
        'ItemStock': ItemStock, 'ChatHistory': ChatHistory, 'ChatUsage': ChatUsage,
    },
    db_type=db_type,
    get_equip_data_table_name=get_equip_data_table_name,
)

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
    session.permanent = True
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

# [추가] 기존 비밀번호 유지(1개월 연장) API
@app.route('/api/user/password/keep', methods=['POST'])
@login_required
def keep_current_password():
    data = request.json or {}
    user_id = data.get('id') or session.get('user_id')
    if not user_id:
        return jsonify({"status": "fail", "message": "로그인이 필요합니다."}), 401

    user = User.query.filter_by(id=user_id).first()
    if not user:
        return jsonify({"status": "fail", "message": "계정을 찾을 수 없습니다."}), 404

    user.pw_changed_at = get_utc_now()
    db.session.commit()

    return jsonify({"status": "success", "message": "기존 비밀번호가 유지되었습니다."})

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
@csrf.exempt
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

# [추가] SystemSetting 조회 API (장비 모델별 파라미터 등 단일 설정 로드용)
@app.route('/api/setting/<key>', methods=['GET'])
@login_required
def get_system_setting(key):
    if key == 'equip_model_parameters':
        try:
            param_rows = AdminParameter.query.order_by(
                AdminParameter.model_name.asc(), 
                AdminParameter.sort_order.asc(), 
                AdminParameter.id.asc()
            ).all()
            val = {}
            for row in param_rows:
                item_dict = {
                    'id': str(row.id or ''),
                    'name': row.name or '',
                    'unit': row.unit or '',
                    'standard': row.standard or '',
                    'memo': row.memo or '',
                    'sort_order': row.sort_order if row.sort_order is not None else 0
                }
                # 레거시 데이터(parameters JSON 컬럼) 호환 처리
                if not row.name and row.parameters:
                    try:
                        legacy_items = json.loads(row.parameters)
                        if isinstance(legacy_items, list):
                            for leg_item in legacy_items:
                                if row.model_name:
                                    val.setdefault(row.model_name, []).append(leg_item)
                                if row.model_abbr and row.model_abbr != row.model_name:
                                    val.setdefault(row.model_abbr, []).append(leg_item)
                            continue
                    except Exception:
                        pass

                if row.model_name:
                    val.setdefault(row.model_name, []).append(item_dict)
                if row.model_abbr and row.model_abbr != row.model_name:
                    val.setdefault(row.model_abbr, []).append(item_dict)
            return jsonify({"status": "success", "value": val})
        except Exception as e:
            app.logger.error(f"Failed to query AdminParameter: {e}")
            pass

    setting = SystemSetting.query.filter_by(key=key).first()
    if setting and setting.value:
        try:
            val = json.loads(setting.value)
        except Exception:
            val = setting.value
        return jsonify({"status": "success", "value": val})
    return jsonify({"status": "success", "value": None})

# [추가] 장비 Parameter 전체 목록 조회 전용 API (admin_parameter 테이블)
@app.route('/api/admin/parameters', methods=['GET'])
@login_required
def get_admin_parameters():
    try:
        rows = AdminParameter.query.order_by(
            AdminParameter.model_name.asc(), 
            AdminParameter.sort_order.asc(), 
            AdminParameter.id.asc()
        ).all()
        return jsonify({"status": "success", "data": [r.to_dict() for r in rows]})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

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

                # [추가] 물품 관리에서 물품 정보 변경 시 '물품관리 현황'(ItemStock) 테이블 실시간 동기화
                item_id_str = str(payload['id'])
                new_partno = payload.get('partno', '')
                new_detail_type = payload.get('detailType', '')
                matched_stock_ids = set()

                # 1) item_id로 매칭되는 ItemStock 레코드 동기화
                stocks_by_id = ItemStock.query.filter_by(item_id=item_id_str).all()
                for s in stocks_by_id:
                    s.code = new_code
                    s.part = new_part
                    s.spec = new_spec
                    s.partno = new_partno
                    s.detail_type = new_detail_type
                    matched_stock_ids.add(s.id)

                # 2) 이전 코드/물품명 또는 새 코드/물품명으로 매칭되는 ItemStock 레코드 동기화
                match_targets = [t for t in [old_code, old_part, new_code, new_part] if t]
                for target in set(match_targets):
                    stocks = ItemStock.query.filter((ItemStock.code == target) | (ItemStock.part == target)).all()
                    for s in stocks:
                        if s.id not in matched_stock_ids:
                            s.code = new_code
                            s.part = new_part
                            s.spec = new_spec
                            s.partno = new_partno
                            s.detail_type = new_detail_type
                            if not s.item_id:
                                s.item_id = item_id_str
                            matched_stock_ids.add(s.id)
            elif action == 'DELETE':
                db.session.execute(text("DELETE FROM admin_item WHERE id=:i"), {'i': str(payload['id'])})

        elif domain == 'item_stock':
            if action == 'CREATE':
                site_group = str(payload.get('site_group', '')).strip()
                site_name = str(payload.get('site_name', '')).strip()
                code = str(payload.get('code', '')).strip()
                part = str(payload.get('part', '')).strip()
                spec = str(payload.get('spec', '')).strip()
                partno = str(payload.get('partno', '')).strip()
                detail_type = str(payload.get('detail_type', '')).strip()
                grade = str(payload.get('grade', 'A')).strip() or 'A'
                try:
                    quantity = int(payload.get('quantity', 0))
                except (ValueError, TypeError):
                    quantity = 0
                try:
                    safety_quantity = int(payload.get('safety_quantity', 0))
                except (ValueError, TypeError):
                    safety_quantity = 0
                memo = str(payload.get('memo', '')).strip()
                item_id = str(payload.get('item_id', '')).strip()

                if not site_group and not site_name:
                    return jsonify({"status": "fail", "message": "사업장 또는 사업장 구분이 필요합니다."}), 400
                if not part and not code:
                    return jsonify({"status": "fail", "message": "물품명 또는 코드명이 필요합니다."}), 400

                # 동일 사업장(또는 사업장 구분)에 동일한 물품(코드+물품명+규격) 및 동일한 등급(grade)이 있는지 확인
                query = ItemStock.query.filter_by(site_group=site_group, site_name=site_name, grade=grade)
                existing = None
                if code:
                    existing = query.filter_by(code=code, spec=spec).first()
                    if not existing:
                        existing = query.filter_by(code=code).first()
                if not existing and part:
                    existing = query.filter_by(part=part, spec=spec).first()

                if existing:
                    # 기존 물품 및 동일 등급이 이미 있으면 수량 누적 및 안전재고 갱신
                    existing.quantity = (existing.quantity or 0) + quantity
                    if 'safety_quantity' in payload:
                        existing.safety_quantity = safety_quantity
                    if memo: existing.memo = memo
                    if partno and not existing.partno: existing.partno = partno
                    if detail_type and not existing.detail_type: existing.detail_type = detail_type
                    existing.grade = grade
                    stock_id = existing.id
                else:
                    new_stock = ItemStock(
                        site_group=site_group,
                        site_name=site_name,
                        item_id=item_id,
                        code=code,
                        part=part,
                        spec=spec,
                        partno=partno,
                        detail_type=detail_type,
                        grade=grade,
                        quantity=quantity,
                        safety_quantity=safety_quantity,
                        memo=memo
                    )
                    db.session.add(new_stock)
                    db.session.flush()
                    stock_id = new_stock.id

                db.session.commit()
                return jsonify({"status": "success", "id": stock_id})

            elif action == 'UPDATE':
                stock_id = payload.get('id')
                stock = db.session.get(ItemStock, stock_id) if stock_id else None
                if not stock:
                    return jsonify({"status": "fail", "message": "물품 재고 항목을 찾을 수 없습니다."}), 404

                if 'quantity' in payload:
                    try:
                        stock.quantity = int(payload['quantity'])
                    except (ValueError, TypeError):
                        pass
                if 'safety_quantity' in payload:
                    try:
                        stock.safety_quantity = int(payload['safety_quantity'])
                    except (ValueError, TypeError):
                        pass
                if 'grade' in payload:
                    stock.grade = str(payload['grade']).strip() or 'A'
                if 'site_name' in payload:
                    stock.site_name = str(payload['site_name']).strip()
                if 'site_group' in payload:
                    stock.site_group = str(payload['site_group']).strip()
                if 'memo' in payload:
                    stock.memo = str(payload['memo']).strip()
                if 'code' in payload:
                    stock.code = str(payload['code']).strip()
                if 'part' in payload:
                    stock.part = str(payload['part']).strip()
                if 'spec' in payload:
                    stock.spec = str(payload['spec']).strip()
                if 'partno' in payload:
                    stock.partno = str(payload['partno']).strip()
                if 'detail_type' in payload:
                    stock.detail_type = str(payload['detail_type']).strip()

                db.session.commit()
                return jsonify({"status": "success"})

            elif action == 'BATCH_UPDATE':
                updates = payload.get('updates', [])
                for u in updates:
                    s_id = u.get('id')
                    s = db.session.get(ItemStock, s_id) if s_id else None
                    if s:
                        if 'quantity' in u:
                            try:
                                s.quantity = int(u['quantity'])
                            except (ValueError, TypeError):
                                pass
                        if 'safety_quantity' in u:
                            try:
                                s.safety_quantity = int(u['safety_quantity'])
                            except (ValueError, TypeError):
                                pass
                        if 'memo' in u:
                            s.memo = str(u['memo']).strip()
                db.session.commit()
                return jsonify({"status": "success"})

            elif action == 'DELETE':
                stock_id = payload.get('id')
                if stock_id:
                    ItemStock.query.filter_by(id=stock_id).delete()
                    db.session.commit()
                return jsonify({"status": "success"})

        elif domain == 'admin_parameter':
            if action in ['CREATE', 'UPDATE', 'SAVE']:
                m_name = str(payload.get('model_name', '')).strip()
                m_abbr = str(payload.get('model_abbr', '')).strip()
                raw_params = payload.get('parameters')

                if not m_name and not payload.get('id'):
                    return jsonify({"status": "fail", "message": "장비 모델명이 필요합니다."}), 400

                if not m_abbr and m_name:
                    eq_m = EquipmentModel.query.filter((EquipmentModel.name == m_name) | (EquipmentModel.abbr == m_name)).first()
                    if eq_m and eq_m.abbr:
                        m_abbr = eq_m.abbr

                # Case 1: parameters 리스트가 전달된 경우 (Admin 화면에서 모델 전체 파라미터 행 일괄 저장)
                if isinstance(raw_params, list):
                    cond = (AdminParameter.model_name == m_name) | (AdminParameter.model_abbr == m_name)
                    if m_abbr:
                        cond = cond | (AdminParameter.model_name == m_abbr) | (AdminParameter.model_abbr == m_abbr)
                    AdminParameter.query.filter(cond).delete(synchronize_session=False)

                    for idx, p in enumerate(raw_params):
                        if not isinstance(p, dict):
                            continue
                        p_id = str(p.get('id') or f"param_{int(time.time() * 1000)}_{idx}_{random.randint(100, 999)}")
                        p_name = str(p.get('name') or '').strip()
                        p_unit = str(p.get('unit') or '').strip()
                        p_std = str(p.get('standard') or '').strip()
                        p_memo = str(p.get('memo') or '').strip()
                        p_sort = p.get('sort_order', idx)
                        try:
                            p_sort = int(p_sort)
                        except Exception:
                            p_sort = idx

                        param_row = AdminParameter(
                            id=p_id,
                            model_name=m_name,
                            model_abbr=m_abbr,
                            name=p_name,
                            unit=p_unit,
                            standard=p_std,
                            memo=p_memo,
                            sort_order=p_sort,
                            parameters=''
                        )
                        db.session.add(param_row)
                    db.session.commit()
                    return jsonify({"status": "success"})

                # Case 2: 단일 파라미터 행 저장 (id 기준 수정 또는 신규 추가)
                p_id = str(payload.get('id') or f"param_{int(time.time() * 1000)}_{random.randint(100, 999)}")
                p_name = str(payload.get('name') or '').strip()
                p_unit = str(payload.get('unit') or '').strip()
                p_std = str(payload.get('standard') or '').strip()
                p_memo = str(payload.get('memo') or '').strip()
                p_sort = payload.get('sort_order', 0)
                try:
                    p_sort = int(p_sort)
                except Exception:
                    p_sort = 0

                param_row = AdminParameter.query.filter_by(id=p_id).first()
                if param_row:
                    if m_name: param_row.model_name = m_name
                    if m_abbr: param_row.model_abbr = m_abbr
                    param_row.name = p_name
                    param_row.unit = p_unit
                    param_row.standard = p_std
                    param_row.memo = p_memo
                    if 'sort_order' in payload:
                        param_row.sort_order = p_sort
                else:
                    param_row = AdminParameter(
                        id=p_id,
                        model_name=m_name,
                        model_abbr=m_abbr,
                        name=p_name,
                        unit=p_unit,
                        standard=p_std,
                        memo=p_memo,
                        sort_order=p_sort,
                        parameters=''
                    )
                    db.session.add(param_row)
                db.session.commit()
                return jsonify({"status": "success", "id": param_row.id})

            elif action == 'DELETE':
                p_id = payload.get('id')
                m_name = payload.get('model_name')
                if p_id:
                    AdminParameter.query.filter_by(id=str(p_id)).delete()
                elif m_name:
                    AdminParameter.query.filter(
                        (AdminParameter.model_name == m_name) | 
                        (AdminParameter.model_abbr == m_name)
                    ).delete(synchronize_session=False)
                db.session.commit()
                return jsonify({"status": "success"})

        elif domain == 'setting':
            deprecated_keys = ['check_type_categories', 'check_type_categories2', 'check_type_categories3', 'check_type_items', 'equipment_models', 'admin_items']
            if payload.get('key') not in deprecated_keys:
                val_json = json.dumps(payload['value'], ensure_ascii=False)
                setting = SystemSetting.query.filter_by(key=payload['key']).first()
                if setting: setting.value = val_json
                else: db.session.add(SystemSetting(key=payload['key'], value=val_json))

            if payload.get('key') == 'equip_model_parameters':
                val = payload.get('value', {})
                if isinstance(val, dict):
                    try:
                        for m_key, p_list in val.items():
                            if not m_key or not isinstance(p_list, list): continue
                            eq_m = EquipmentModel.query.filter((EquipmentModel.name == m_key) | (EquipmentModel.abbr == m_key)).first()
                            m_abbr = eq_m.abbr if eq_m else ''
                            m_name = eq_m.name if eq_m else m_key

                            cond = (AdminParameter.model_name == m_name) | (AdminParameter.model_abbr == m_name)
                            if m_abbr:
                                cond = cond | (AdminParameter.model_name == m_abbr) | (AdminParameter.model_abbr == m_abbr)
                            AdminParameter.query.filter(cond).delete(synchronize_session=False)

                            for idx, p in enumerate(p_list):
                                if not isinstance(p, dict): continue
                                p_id = str(p.get('id') or f"param_{int(time.time() * 1000)}_{idx}_{random.randint(100, 999)}")
                                p_sort = p.get('sort_order', idx)
                                try:
                                    p_sort = int(p_sort)
                                except Exception:
                                    p_sort = idx
                                db.session.add(AdminParameter(
                                    id=p_id,
                                    model_name=m_name,
                                    model_abbr=m_abbr,
                                    name=str(p.get('name') or '').strip(),
                                    unit=str(p.get('unit') or '').strip(),
                                    standard=str(p.get('standard') or '').strip(),
                                    memo=str(p.get('memo') or '').strip(),
                                    sort_order=p_sort,
                                    parameters=''
                                ))
                        db.session.commit()
                    except Exception as ex:
                        app.logger.error(f"Failed to sync equip_model_parameters to AdminParameter table: {ex}")

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

# [추가] 정기 PM 등록 시 동일 날짜 중복 작업 실시간 사전 감지 API
@app.route('/api/check_duplicate_schedule', methods=['GET', 'POST'])
@login_required
@limiter.exempt
def check_duplicate_schedule():
    if request.method == 'POST':
        payload = request.json or {}
    else:
        payload = request.args.to_dict()

    site = payload.get('site', '').strip()
    equip = payload.get('equip', '').strip()
    date_str = payload.get('date', '').strip()
    work_type = payload.get('type', '정기').strip()
    exclude_id = str(payload.get('exclude_id', '')).strip()

    if not site or not equip or not date_str:
        return jsonify({'is_duplicate': False})

    equip_id = lookup_equipment_id(equip_id=payload.get('equip_id'), site=site, equip_key=equip)
    if not equip_id:
        return jsonify({'is_duplicate': False})

    # 날짜 정규화 (YYYY-MM-DD)
    clean_date = date_str.split('T')[0].replace('.', '-').replace('/', '-').strip()
    parts = clean_date.split('-')
    if len(parts) == 3:
        clean_date = f"{parts[0].zfill(4)}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"

    target_type = work_type if work_type else '정기'

    if target_type == '정기':
        type_cond = db.or_(LogItem.type == '정기', LogItem.type == None, LogItem.type == '')
    else:
        type_cond = (LogItem.type == target_type)

    query = LogItem.query.filter(
        LogItem.equip_id == equip_id,
        db.or_(LogItem.scheduled_date == clean_date, LogItem.date == clean_date),
        type_cond,
        LogItem.status.in_(['작업예정', '조치완료'])
    )
    if exclude_id:
        query = query.filter(LogItem.id != exclude_id)

    dup = query.first()
    if dup:
        return jsonify({
            'is_duplicate': True,
            'worker': dup.worker or '',
            'type': dup.type or target_type,
            'scheduled_date': dup.scheduled_date or dup.date or clean_date,
            'content': dup.content or ''
        })

    return jsonify({'is_duplicate': False})

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

    # [추가] 작업 내용이 실제로 바뀐 경우에만 마지막 등록/수정자 기록 (Tracking 체크, 정렬 순서 변경 등은 제외)
    def _audit_fields(it):
        return tuple(str(getattr(it, f, '') or '') for f in (
            'status', 'date', 'scheduled_date', 'period', 'type', 'detail_type', 'detail_type2', 'detail_type3',
            'content', 'add_work', 'cost_type', 'md', 'worker', 'memo', 'start_time', 'end_time'))
    audit_targets = []  # [(item, before_snapshot)]

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
            audit_targets.append((item, _audit_fields(item)))

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

            # [요청 반영] item_log DB에서 비물품 키워드 레코드 자동 정리
            try:
                invalid_kws = ['내용 없음', '장비 점검', 'PM 점검', 'BM 점검', '파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '파츠 이상 교체', '파츠 이상 수리', '물품 이상 교체', '물품 이상 수리', '단순 조치', '현장 이슈', 'PC 이상', '작업자 실수', '통신 이상', '프로그램 이상', '기타']
                ItemLog.query.filter(
                    ItemLog.equip_id == equip_id,
                    (ItemLog.code.in_(invalid_kws)) | (ItemLog.part.in_(invalid_kws))
                ).delete(synchronize_session=False)
            except Exception:
                pass

            # [요청 반영] 완료된 작업 내용(content)에 물품이 포함되어 있으면 item_log(유지관리 물품) 및 maint_log(LogItem)의 물품 규격화 & 유령 데이터 제거
            c_text = l.get('content') or item.content or ''
            if c_text and c_text != '내용 없음':
                sub_parts = split_safety_content(c_text)
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
                    if not pure_p or pure_p in invalid_kws:
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
                    # [동시 등록 방지] 신규 작업 등록 시 동일 일자에 이미 등록된 동일 구분 작업이 있는지 DB 중복 검사
                    if not m.get('originalLogId'):
                        target_m_type = m_type if m_type else '정기'
                        if target_m_type == '정기':
                            type_filter = db.or_(LogItem.type == '정기', LogItem.type == None, LogItem.type == '')
                        else:
                            type_filter = (LogItem.type == target_m_type)

                        dup_item = LogItem.query.filter(
                            LogItem.equip_id == equip_id,
                            LogItem.id != m_id,
                            db.or_(LogItem.scheduled_date == m_sched_date, LogItem.date == m_sched_date),
                            type_filter,
                            LogItem.status.in_(['작업예정', '조치완료'])
                        ).first()
                        if dup_item:
                            db.session.rollback()
                            dup_worker = dup_item.worker or '다른 작업자'
                            return jsonify({
                                'status': 'fail',
                                'message': f'해당 일자({m_sched_date})에 이미 등록된 [{target_m_type}] 작업이 존재합니다. (작업자: {dup_worker})'
                            }), 400

                    item = LogItem(id=m_id, equip_id=equip_id, status='작업예정')
                    db.session.add(item)
                audit_targets.append((item, _audit_fields(item)))

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

                if clean_code and clean_code not in invalid_kws:
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

        # [추가] 마지막 등록/수정자 기록
        if audit_targets:
            _u = db.session.get(User, session.get('user_id'))
            _writer = ((_u.name if _u and _u.name else session.get('user_id')) or '')[:100]
            _now_kst = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime('%Y-%m-%d %H:%M')
            _seen = set()
            for _it, _before in audit_targets:
                if id(_it) in _seen:
                    continue
                _seen.add(id(_it))
                if _audit_fields(_it) != _before:
                    _it.updated_by = _writer
                    _it.updated_at = _now_kst

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
        # [추가] 클라이언트 캐시 갱신용 마지막 등록/수정자 정보
        audit_result = {}
        for _it, _before in audit_targets:
            try:
                if getattr(_it, 'updated_at', ''):
                    audit_result[str(_it.id)] = {"updatedBy": _it.updated_by or '', "updatedAt": _it.updated_at or ''}
            except Exception:
                pass  # 같은 요청에서 삭제된 항목 등
        return jsonify({"status": "success", "audit": audit_result})
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
                    id=str(sd.get('id', '')), equip_id=equip_id,
                    category=sd.get('category', ''), subcategory=sd.get('subcategory', ''), content=sd.get('content', ''),
                    start_date=sd.get('startDate', ''), date=sd.get('date', ''), est_days=str(sd.get('estDays', '1')),
                    completed=bool(sd.get('completed', False)), exec_start_date=sd.get('execStartDate', ''), delay_reason=sd.get('delayReason', '')
                ))
        if logs is not None:
            db.session.query(SetupLog).filter_by(equip_id=equip_id).delete(synchronize_session=False)
            for sl in logs:
                db.session.add(SetupLog(
                    id=str(sl.get('id', '')), equip_id=equip_id, date=sl.get('date', ''),
                    category=sl.get('category', ''), subcategory=sl.get('subcategory', ''),
                    worker=sl.get('worker', ''),
                    content=sl.get('content', ''), company=sl.get('company', '위드텍'), memo=sl.get('memo', ''),
                    special_note=sl.get('specialNote', '') or sl.get('special_note', '') or '',
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

        # [추가] admin_parameter 테이블 자동 생성 및 컬럼 보정 (id, model_name, model_abbr, name, unit, standard, memo, parameters, updated_at)
        try:
            db.session.execute(text('''
                CREATE TABLE IF NOT EXISTS admin_parameter (
                    id VARCHAR(100) PRIMARY KEY,
                    model_name VARCHAR(100) NOT NULL,
                    model_abbr VARCHAR(100) DEFAULT '',
                    name VARCHAR(150) DEFAULT '',
                    unit VARCHAR(50) DEFAULT '',
                    standard VARCHAR(255) DEFAULT '',
                    memo VARCHAR(255) DEFAULT '',
                    parameters LONGTEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_admin_param_model (model_name)
                )
            '''))
            db.session.commit()
        except Exception:
            db.session.rollback()

        # 기존 테이블 스키마 보정 (model_name UNIQUE 인덱스 해제 및 컬럼 타입/추가)
        try:
            db.session.execute(text('ALTER TABLE admin_parameter DROP INDEX model_name'))
            db.session.commit()
        except Exception:
            db.session.rollback()

        try:
            db.session.execute(text('ALTER TABLE admin_parameter MODIFY id VARCHAR(100) NOT NULL'))
            db.session.commit()
        except Exception:
            db.session.rollback()

        admin_param_cols = [
            ('model_name', 'VARCHAR(100) NOT NULL'),
            ('model_abbr', 'VARCHAR(100) DEFAULT ""'),
            ('name', 'VARCHAR(150) DEFAULT ""'),
            ('unit', 'VARCHAR(50) DEFAULT ""'),
            ('standard', 'VARCHAR(255) DEFAULT ""'),
            ('memo', 'VARCHAR(255) DEFAULT ""'),
            ('parameters', 'LONGTEXT'),
            ('updated_at', 'DATETIME')
        ]
        for col, col_type in admin_param_cols:
            try:
                db.session.execute(text(f'ALTER TABLE admin_parameter ADD COLUMN {col} {col_type}'))
                db.session.commit()
            except Exception:
                db.session.rollback()

        # [마이그레이션 1] 기존 admin_parameter 테이블에 1줄(JSON parameters)로 저장되어 있던 행들을 1행당 1개 파라미터로 개별 행 풀어서 이전
        try:
            legacy_rows = db.session.execute(text("SELECT id, model_name, model_abbr, parameters FROM admin_parameter WHERE parameters IS NOT NULL AND parameters != '' AND (name IS NULL OR name = '')")).fetchall()
            if legacy_rows:
                for r in legacy_rows:
                    r_id, m_name, m_abbr, p_str = r[0], r[1], r[2], r[3]
                    try:
                        items = json.loads(p_str) if p_str else []
                        if isinstance(items, list) and len(items) > 0:
                            for idx, item in enumerate(items):
                                if not isinstance(item, dict): continue
                                item_id = str(item.get('id') or f"param_{int(time.time() * 1000)}_{idx}_{random.randint(100, 999)}")
                                db.session.execute(text("""
                                    INSERT INTO admin_parameter (id, model_name, model_abbr, name, unit, standard, memo, parameters, updated_at)
                                    VALUES (:id, :model_name, :model_abbr, :name, :unit, :standard, :memo, '', NOW())
                                    ON DUPLICATE KEY UPDATE name = :name, unit = :unit, standard = :standard, memo = :memo
                                """), {
                                    'id': item_id,
                                    'model_name': m_name or '',
                                    'model_abbr': m_abbr or '',
                                    'name': str(item.get('name') or ''),
                                    'unit': str(item.get('unit') or ''),
                                    'standard': str(item.get('standard') or ''),
                                    'memo': str(item.get('memo') or '')
                                })
                            db.session.execute(text("DELETE FROM admin_parameter WHERE id = :old_id"), {'old_id': str(r_id)})
                    except Exception as parse_err:
                        app.logger.error(f"Failed to unpack legacy admin_parameter row {r_id}: {parse_err}")
                db.session.commit()
        except Exception as ex:
            db.session.rollback()

        # [마이그레이션 2] SystemSetting의 equip_model_parameters를 admin_parameter 테이블로 이전 (개별 행 단위)
        try:
            legacy_param_setting = SystemSetting.query.filter_by(key='equip_model_parameters').first()
            if legacy_param_setting and legacy_param_setting.value:
                legacy_params = json.loads(legacy_param_setting.value)
                if isinstance(legacy_params, dict):
                    for m_name, p_data in legacy_params.items():
                        if not m_name or not isinstance(p_data, list): continue
                        eq_m = EquipmentModel.query.filter((EquipmentModel.name == m_name) | (EquipmentModel.abbr == m_name)).first()
                        m_abbr = eq_m.abbr if eq_m else ''
                        for idx, item in enumerate(p_data):
                            if not isinstance(item, dict): continue
                            item_id = str(item.get('id') or f"param_{int(time.time() * 1000)}_{idx}_{random.randint(100, 999)}")
                            exists = AdminParameter.query.filter_by(id=item_id).first()
                            if not exists:
                                db.session.add(AdminParameter(
                                    id=item_id,
                                    model_name=m_name,
                                    model_abbr=m_abbr,
                                    name=str(item.get('name') or ''),
                                    unit=str(item.get('unit') or ''),
                                    standard=str(item.get('standard') or ''),
                                    memo=str(item.get('memo') or ''),
                                    parameters=''
                                ))
                    db.session.commit()
        except Exception as ex:
            db.session.rollback()

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