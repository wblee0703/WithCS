# ------------------------------------------------------------------------------
# WITHTECH AI 챗봇 서비스 (Tool Calling 방식)
#
# 동작 흐름
#   1. 사용자 질문 + 최근 대화 몇 턴을 마스킹(고객사/장비/인적 정보 → [TOKEN])
#   2. AI가 아래 조회 도구(TOOL_DECLS) 중 필요한 것을 골라 호출
#   3. 서버가 도구를 실행(DB 읽기 전용) → 결과를 마스킹해서 AI에 다시 전달
#   4. AI 최종 답변을 역마스킹해서 사용자에게 반환
#   5. 호출 1회(라운드)마다 토큰 사용량과 입력 구성(문자 수)을 chat_usage 테이블에 기록
#
# app.py 와의 순환 import 를 피하기 위해 init_chatbot() 으로 의존성을 주입받습니다.
# ------------------------------------------------------------------------------
import json
import os
import re
import socket
import time
import uuid
import urllib.request
import urllib.error
from datetime import datetime, timedelta

from flask import jsonify, request, session
from sqlalchemy import func, or_, case, text
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import defer, load_only


class _Deps:
    pass


D = _Deps()  # init_chatbot() 에서 app, db, 모델 클래스, 헬퍼 함수가 채워집니다.


# ------------------------------------------------------------------------------
# 1. 설정 (.env) — 재시작 없이 바뀌지 않으므로 호출 시점에 읽습니다.
# ------------------------------------------------------------------------------
def _env_int(name, default):
    try:
        return int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


def _env_float(name, default):
    try:
        return float(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


def _env_bool(name, default):
    val = str(os.environ.get(name, '1' if default else '0')).strip().lower()
    return val in ('1', 'true', 'yes', 'y', 'on')


def get_config():
    api_type = os.environ.get('CHAT_API_TYPE', 'gemini').strip().lower()
    default_model = 'gemini-2.5-flash' if api_type == 'gemini' else 'gpt-4o-mini'
    model = os.environ.get('CHAT_API_MODEL', default_model).strip() or default_model
    thinking_raw = os.environ.get('CHAT_THINKING_BUDGET', '').strip()
    if thinking_raw == '':
        # 2.5 Flash 계열은 사고(thinking) 토큰이 출력 요금으로 과금되므로 기본 0 으로 끕니다.
        thinking_budget = 0 if ('flash' in model and '2.5' in model) else None
    else:
        try:
            thinking_budget = int(thinking_raw)
        except ValueError:
            thinking_budget = None
    roles_raw = os.environ.get('CHAT_ALLOWED_ROLES', 'superadmin')
    return {
        'api_type': api_type,
        'api_key': os.environ.get('CHAT_API_KEY', '').strip(),
        'model': model,
        'api_url': os.environ.get('CHAT_API_URL', 'https://api.openai.com/v1/chat/completions').strip(),
        'timeout': _env_int('CHAT_API_TIMEOUT', 60),
        'max_tool_rounds': max(0, min(_env_int('CHAT_MAX_TOOL_ROUNDS', 3), 5)),
        'max_calls_per_round': 6,
        'history_turns': max(0, min(_env_int('CHAT_HISTORY_TURNS', 3), 10)),
        'history_ai_chars': _env_int('CHAT_HISTORY_AI_CHARS', 400),
        'tool_result_chars': _env_int('CHAT_TOOL_RESULT_CHARS', 3000),
        'max_output_tokens': _env_int('CHAT_MAX_OUTPUT_TOKENS', 1200),
        'thinking_budget': thinking_budget,
        'temperature': _env_float('CHAT_TEMPERATURE', 0.2),
        'daily_limit': _env_int('CHAT_DAILY_LIMIT', 200),
        'mask_model': _env_bool('CHAT_MASK_MODEL', True),
        'price_in': _env_float('CHAT_PRICE_INPUT_PER_1M', 0.0),
        'price_out': _env_float('CHAT_PRICE_OUTPUT_PER_1M', 0.0),
        'allowed_roles': [r.strip() for r in roles_raw.split(',') if r.strip()],
        # 원인 분석 모드: 서버가 데이터를 미리 모아 AI 1회 호출
        'analysis_model_cases': max(1, min(_env_int('CHAT_ANALYSIS_MODEL_CASES', 10), 30)),
        'analysis_equip_troubles': max(1, min(_env_int('CHAT_ANALYSIS_EQUIP_TROUBLES', 15), 40)),
        'analysis_equip_logs': max(1, min(_env_int('CHAT_ANALYSIS_EQUIP_LOGS', 20), 60)),
        'analysis_max_output_tokens': _env_int('CHAT_ANALYSIS_MAX_OUTPUT_TOKENS', 3000),
        'analysis_context_chars': _env_int('CHAT_ANALYSIS_CONTEXT_CHARS', 20000),
    }


def chatbot_allowed_for(role):
    return bool(role) and role in get_config()['allowed_roles']


# ------------------------------------------------------------------------------
# 2. 공통 유틸
# ------------------------------------------------------------------------------
def _norm(val):
    """대소문자·공백·특수문자를 무시한 비교 키"""
    if val is None:
        return ''
    return re.sub(r'[^a-zA-Z0-9가-힣]', '', str(val)).lower()


def _t(val, limit=120):
    """한 줄로 정리하고 길이를 제한합니다 (토큰 절약)."""
    if val is None:
        return ''
    s = re.sub(r'\s+', ' ', str(val)).strip()
    if len(s) > limit:
        s = s[:limit].rstrip() + '…'
    return s


def _strip_4byte(val):
    """MySQL utf8mb3 컬럼에 저장할 수 없는 4바이트 문자(이모지 등) 제거"""
    return re.sub(r'[\U00010000-\U0010FFFF]', '', str(val or '')).strip()


def _like(col, kw):
    """대소문자 무시 부분 일치"""
    esc = str(kw).lower().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return func.lower(col).like(f'%{esc}%', escape='\\')


def _clamp_limit(val, default, hi=30):
    try:
        n = int(val)
    except (TypeError, ValueError):
        n = default
    return max(1, min(n, hi))


_DATE_RE = re.compile(r'^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$')


def _parse_date(val, is_end=False):
    """'YYYY-MM-DD' 또는 'YYYY-MM' → 비교용 문자열. 잘못된 값은 None."""
    if not val:
        return None
    m = _DATE_RE.match(str(val).strip())
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), m.group(3)
    if d is None:
        if is_end:
            nxt = datetime(y + (mo // 12), (mo % 12) + 1, 1) - timedelta(days=1)
            return nxt.strftime('%Y-%m-%d')
        return f'{y:04d}-{mo:02d}-01'
    return f'{y:04d}-{mo:02d}-{int(d):02d}'


def _apply_date_range(query, expr, date_from, date_to):
    df = _parse_date(date_from)
    dt = _parse_date(date_to, is_end=True)
    if df:
        query = query.filter(expr >= df)
    if dt:
        # '2025-03-31 10:00' 같은 시간 포함 값도 포함되도록 '~'(숫자/공백보다 큼)를 붙입니다.
        query = query.filter(expr <= dt + '~')
    return query


def _cond_text(**kw):
    parts = [f'{k}={v}' for k, v in kw.items() if v not in (None, '', [])]
    return ', '.join(parts) if parts else '조건 없음'


# ------------------------------------------------------------------------------
# 3. 마스킹 (고객사·장비·인적 정보는 외부 AI 로 원문 전송 금지)
# ------------------------------------------------------------------------------
TOKEN_TYPES = 'SITE|CUST|EQ|SN|CEQ|LOC|PRJ|PERSON|MODEL|EMAIL|PHONE|IP'
TOKEN_RE = re.compile(r'\[\s*(' + TOKEN_TYPES + r')_(\d+)\s*\]')
EQ_MODEL_SUFFIX_RE = re.compile(r'(\[\s*EQ_\d+\s*\])\s*\(\s*\[?\s*MODEL_\d+\s*\]?\s*\)')
BARE_TOKEN_RE = re.compile(r'(?<![A-Za-z0-9_\[])(' + TOKEN_TYPES + r')_(\d+)(?![A-Za-z0-9_\]])')

EMAIL_RE = re.compile(r'[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+')
PHONE_RE = re.compile(r'(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)')
IP_RE = re.compile(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])')

GENERIC_TERMS = {
    'admin', 'user', 'superadmin', '기타', 'etc', '기타(etc)', 'n/a', 'na', '-', 'none', 'null',
    'test', '기타사업장', '미지정', '없음',
}

_ENTITY_CACHE = {'at': 0.0, 'mask_model': None, 'entities': None, 'regex': None}
_ENTITY_TTL = 120  # 마스터 데이터는 자주 바뀌지 않으므로 2분 캐시


def _build_entities(mask_model):
    ents = {}

    def add(val, typ, min_len=2):
        if val is None:
            return
        v = str(val).strip()
        if len(v) < min_len or v.lower() in GENERIC_TERMS:
            return
        ents.setdefault(v.lower(), (typ, v))

    sites = D.Site.query.all()
    for s in sites:
        add(s.name, 'SITE')
    for s in sites:
        add(getattr(s, 'group', None), 'CUST')
    equips = D.Equipment.query.options(load_only(
        D.Equipment.id, D.Equipment.name, D.Equipment.serial, D.Equipment.cust_equip_name,
        D.Equipment.building, D.Equipment.detail_loc, D.Equipment.project_no, D.Equipment.manager,
        D.Equipment.cust_manager, D.Equipment.contact, D.Equipment.email, D.Equipment.cust_contact,
        D.Equipment.cust_email,
    )).all()
    for e in equips:
        add(e.serial, 'SN', 3)
        add(e.cust_equip_name, 'CEQ')
    if mask_model:
        for m in D.EquipmentModel.query.all():
            add(m.name, 'MODEL')
            add(m.abbr, 'MODEL')
        for e in equips:
            add(e.name, 'MODEL')
    for e in equips:
        add(e.project_no, 'PRJ', 3)
        add(e.manager, 'PERSON')
        add(e.cust_manager, 'PERSON')
        add(e.building, 'LOC')
        add(e.detail_loc, 'LOC', 3)
        add(e.contact, 'PHONE', 4)
        add(e.cust_contact, 'PHONE', 4)
        add(e.email, 'EMAIL', 4)
        add(e.cust_email, 'EMAIL', 4)
    for u in D.User.query.options(load_only(D.User.id, D.User.name)).all():
        add(u.name, 'PERSON')
        add(u.id, 'PERSON', 3)

    patterns = []
    for term in sorted(ents.keys(), key=len, reverse=True):
        p = re.escape(term)
        # 영문/숫자로 시작·끝나는 용어는 다른 영문 단어 안에서 오탐되지 않도록 경계를 둡니다.
        if re.match(r'[a-z0-9]', term):
            p = r'(?<![A-Za-z0-9_])' + p
        if re.search(r'[a-z0-9]$', term):
            p = p + r'(?![A-Za-z0-9_])'
        patterns.append(p)
    regex = re.compile('|'.join(patterns), re.IGNORECASE) if patterns else None
    return ents, regex


def _get_entities(mask_model):
    now = time.time()
    c = _ENTITY_CACHE
    if c['entities'] is None or c['mask_model'] != mask_model or now - c['at'] > _ENTITY_TTL:
        c['entities'], c['regex'] = _build_entities(mask_model)
        c['mask_model'] = mask_model
        c['at'] = now
    return c['entities'], c['regex']


class Masker:
    def __init__(self, mask_model=True):
        self.entities, self.regex = _get_entities(mask_model)
        self.fwd = {}      # (type, 원문) → 토큰
        self.rev = {}      # 토큰 → 원문(표시용)
        self.eq_ids = {}   # EQ 토큰 → Equipment.id
        self.counters = {}

    def _new_token(self, typ, value, display=None):
        key = (typ, value)
        if key in self.fwd:
            return self.fwd[key]
        self.counters[typ] = self.counters.get(typ, 0) + 1
        tok = f'[{typ}_{self.counters[typ]}]'
        self.fwd[key] = tok
        self.rev[tok] = display if display is not None else value
        return tok

    def eq_token(self, eq):
        # 답변에서는 고객사 장비명만 표시 (없으면 시리얼)
        display = (eq.cust_equip_name or '').strip() or (eq.serial or '').strip() or eq.id
        tok = self._new_token('EQ', eq.id, display)
        self.eq_ids[tok] = eq.id
        return tok

    def _mask_plain(self, s):
        if self.regex is not None:
            def repl(m):
                ent = self.entities.get(m.group(0).lower())
                if not ent:
                    return m.group(0)
                return self._new_token(ent[0], ent[1])
            s = self.regex.sub(repl, s)
        s = EMAIL_RE.sub(lambda m: self._new_token('EMAIL', m.group(0)), s)
        s = PHONE_RE.sub(lambda m: self._new_token('PHONE', m.group(0)), s)
        s = IP_RE.sub(lambda m: self._new_token('IP', m.group(0)), s)
        return s

    def mask(self, s):
        if not s:
            return s or ''
        s = str(s)
        # 이미 들어간 토큰([EQ_1] 등)은 다시 마스킹하지 않도록 토큰 사이 구간만 처리합니다.
        out, last = [], 0
        for m in TOKEN_RE.finditer(s):
            out.append(self._mask_plain(s[last:m.start()]))
            out.append(m.group(0))
            last = m.end()
        out.append(self._mask_plain(s[last:]))
        return ''.join(out)

    def _lookup(self, typ, num):
        return self.rev.get(f'[{typ}_{num}]')

    def unmask(self, s):
        """AI 최종 답변 → 원문 복원 (괄호가 빠진 토큰도 복원)"""
        if not s:
            return s or ''

        def repl(m):
            val = self._lookup(m.group(1), m.group(2))
            return val if val is not None else m.group(0)
        # 장비 뒤에 붙은 모델명 괄호 제거: [EQ_1]([MODEL_2]) → [EQ_1]
        s = EQ_MODEL_SUFFIX_RE.sub(r'\1', s)
        s = TOKEN_RE.sub(repl, s)
        return BARE_TOKEN_RE.sub(repl, s)

    def unmask_arg(self, s):
        """도구 인자 → 원문 복원. EQ 토큰은 장비 식별에 쓰이므로 그대로 둡니다."""
        if not isinstance(s, str):
            return s

        def repl(m):
            if m.group(1) == 'EQ':
                return f'[EQ_{m.group(2)}]'
            for (typ, value), tok in self.fwd.items():
                if tok == f'[{m.group(1)}_{m.group(2)}]':
                    return value
            return m.group(0)
        s = TOKEN_RE.sub(repl, s)
        return BARE_TOKEN_RE.sub(repl, s)


# ------------------------------------------------------------------------------
# 4. 도구 실행 컨텍스트 (장비 식별·권한 범위·레거시 equip_id 대응)
# ------------------------------------------------------------------------------
class ToolError(Exception):
    pass


class ToolContext:
    def __init__(self, user, masker):
        self.user = user
        self.masker = masker
        self.scope_sites = None
        site = (user.site or '').strip() if getattr(user, 'site', None) else ''
        if user.role not in ('superadmin', 'admin') and site and site.lower() not in ('none', 'null'):
            self.scope_sites = {_norm(site)}
        self._equips = None
        self._raw_index = {}
        self._model_alias = None
        self._statuses = {}

    # ---- 장비 마스터 ----
    @property
    def equips(self):
        if self._equips is None:
            rows = D.Equipment.query.all()
            if self.scope_sites is not None:
                rows = [e for e in rows if _norm(e.site_name) in self.scope_sites]
            self._equips = rows
        return self._equips

    def _eq_by_key(self):
        by_id, by_site_serial = {}, {}
        for e in self.equips:
            by_id[_norm(e.id)] = e
            if e.serial:
                by_site_serial[(_norm(e.site_name), _norm(e.serial))] = e
        return by_id, by_site_serial

    def raw_index(self, Model):
        """로그 테이블의 equip_id 원문 → Equipment (대소문자·콜론 개수 차이 무시)"""
        key = Model.__table__.name
        if key not in self._raw_index:
            by_id, by_site_serial = self._eq_by_key()
            idx = {}
            for (raw,) in D.db.session.query(Model.equip_id).distinct():
                if not raw:
                    continue
                eq = by_id.get(_norm(raw))
                if eq is None:
                    parts = [p for p in str(raw).split('::')]
                    if len(parts) >= 3:
                        eq = by_site_serial.get((_norm(parts[0]), _norm(parts[2])))
                idx[raw] = eq
            self._raw_index[key] = idx
        return self._raw_index[key]

    def label_raw(self, Model, raw):
        eq = self.raw_index(Model).get(raw)
        if eq is not None:
            return self.masker.eq_token(eq)
        parts = [p for p in str(raw or '').split('::') if p]
        return ' '.join(parts[1:]) if len(parts) > 1 else (raw or '-')

    def site_of_raw(self, Model, raw):
        eq = self.raw_index(Model).get(raw)
        if eq is not None:
            return eq.site_name or '미지정'
        return (str(raw or '').split('::')[0] or '미지정')

    def model_of_raw(self, Model, raw):
        eq = self.raw_index(Model).get(raw)
        if eq is not None:
            return eq.name or '미지정'
        parts = str(raw or '').split('::')
        return parts[1] if len(parts) > 1 and parts[1] else '미지정'

    # ---- 이름 해석 ----
    def model_alias(self):
        if self._model_alias is None:
            alias = {}
            try:
                for m in D.EquipmentModel.query.all():
                    n, a = _norm(m.name), _norm(m.abbr)
                    if n:
                        alias.setdefault(n, set()).update({n, a} - {''})
                    if a:
                        alias.setdefault(a, set()).update({n, a} - {''})
            except Exception as e:
                D.app.logger.warning(f'[AI Chat] EquipmentModel 조회 실패: {e}')
            self._model_alias = alias
        return self._model_alias

    def resolve_sites(self, site):
        n = _norm(site)
        if not n:
            return None
        sites = D.Site.query.all()
        exact = {s.name for s in sites if _norm(s.name) == n}
        group = {s.name for s in sites if _norm(getattr(s, 'group', '')) == n}
        found = exact | group
        if not found and len(n) >= 2:
            found = {s.name for s in sites if n in _norm(s.name)}
        if not found:
            raise ToolError(f"사업장/고객사 '{site}' 을(를) 찾지 못했습니다.")
        return {_norm(x) for x in found}

    def resolve_models(self, model):
        n = _norm(model)
        if not n:
            return None
        alias = self.model_alias()
        names = {_norm(e.name) for e in self.equips if e.name}
        found = set(alias.get(n, set()))
        if n in names:
            found.add(n)
        if not found and len(n) >= 2:
            found = {x for x in names if n in x}
            for k, v in alias.items():
                if n in k:
                    found |= v
        if not found:
            raise ToolError(f"모델 '{model}' 을(를) 찾지 못했습니다.")
        return found

    def resolve_equip_text(self, equip):
        val = str(equip or '').strip()
        m = TOKEN_RE.search(val)
        if m and m.group(1) == 'EQ':
            eq_id = self.masker.eq_ids.get(f'[EQ_{m.group(2)}]')
            rows = [e for e in self.equips if e.id == eq_id]
            if rows:
                return rows
        n = _norm(val)
        if not n:
            return None
        keys = lambda e: (_norm(e.serial), _norm(e.cust_equip_name), _norm(e.id))
        rows = [e for e in self.equips if n in keys(e)]
        if not rows and len(n) >= 3:
            rows = [e for e in self.equips if any(n in k for k in keys(e)[:2] if k)]
        if not rows:
            raise ToolError(f"장비 '{equip}' 을(를) 찾지 못했습니다.")
        return rows

    def resolve_equips(self, equip=None, site=None, model=None):
        """조건에 맞는 장비 목록. 조건이 하나도 없으면 None(전체)."""
        if not (equip or site or model):
            return None
        rows = self.equips
        site_keys = self.resolve_sites(site) if site else None
        if site_keys is not None:
            rows = [e for e in rows if _norm(e.site_name) in site_keys]
        model_keys = self.resolve_models(model) if model else None
        if model_keys is not None:
            rows = [e for e in rows if _norm(e.name) in model_keys]
        if equip:
            ids = {e.id for e in self.resolve_equip_text(equip)}
            rows = [e for e in rows if e.id in ids]
        return rows

    def target_raw_ids(self, Model, equip=None, site=None, model=None):
        """로그 테이블 필터용 equip_id 원문 목록. None 이면 필터 없음."""
        eqs = self.resolve_equips(equip, site, model)
        if eqs is None and self.scope_sites is None:
            return None
        idx = self.raw_index(Model)
        if eqs is None:
            eq_ids = {e.id for e in self.equips}
        else:
            eq_ids = {e.id for e in eqs}
        raws = [r for r, e in idx.items() if e is not None and e.id in eq_ids]
        # 마스터에 없는 레거시 ID 도 사업장 조건이면 사업장 접두사로 포함합니다.
        site_keys = self.resolve_sites(site) if site else self.scope_sites
        if site_keys and not equip and not model:
            raws += [r for r, e in idx.items() if e is None and _norm(str(r).split('::')[0]) in site_keys]
        return raws

    def statuses(self, Model):
        key = Model.__table__.name
        if key not in self._statuses:
            self._statuses[key] = [s for (s,) in D.db.session.query(Model.status).distinct() if s]
        return self._statuses[key]

    def resolve_status(self, Model, status):
        n = _norm(status)
        if not n:
            return None
        vals = self.statuses(Model)
        found = [v for v in vals if _norm(v) == n] or [v for v in vals if n in _norm(v)]
        if not found:
            raise ToolError(f"상태 '{status}' 없음. DB 에 있는 상태값: {', '.join(vals) or '없음'}")
        return found


def _filter_raw(query, col, raws):
    if raws is None:
        return query, False
    if not raws:
        return query, True  # 결과 없음
    return query.filter(col.in_(raws)), False


# ------------------------------------------------------------------------------
# 5. 조회 도구 (모두 읽기 전용, 연락처·이메일·비밀번호 컬럼은 조회하지 않음)
# ------------------------------------------------------------------------------
def _log_eff_date():
    L = D.LogItem
    return case(
        (L.status == '작업예정', func.coalesce(func.nullif(L.scheduled_date, ''), L.date)),
        else_=func.coalesce(func.nullif(L.date, ''), L.scheduled_date),
    )


def _trouble_eff_date():
    T = D.TroubleLog
    return func.coalesce(func.nullif(T.occur_date, ''), T.action_date)


def tool_find_equipment(ctx, equip=None, site=None, model=None, status=None, limit=10):
    limit = _clamp_limit(limit, 10)
    rows = ctx.resolve_equips(equip, site, model)
    rows = list(ctx.equips if rows is None else rows)
    rows = [e for e in rows if (e.name or '').strip() != '기타(ETC)']
    if status:
        n = _norm(status)
        rows = [e for e in rows if n in _norm(e.equip_status)]
    lines = [f'장비 검색 ({_cond_text(equip=equip, site=site, model=model, status=status)}): 총 {len(rows)}대']
    if not rows:
        return lines[0]

    def dist(key_fn, title):
        cnt = {}
        for e in rows:
            k = key_fn(e) or '미지정'
            cnt[k] = cnt.get(k, 0) + 1
        if len(cnt) > 1:
            items = sorted(cnt.items(), key=lambda x: -x[1])[:15]
            lines.append(f'- {title}별: ' + ', '.join(f'{k} {v}대' for k, v in items))
    dist(lambda e: e.site_name, '사업장')
    dist(lambda e: e.name, '모델')
    dist(lambda e: e.equip_status, '상태')
    lines.append(f'목록(최대 {limit}대): 장비|모델|사업장|상태|납품일')
    for e in rows[:limit]:
        lines.append(f'{ctx.masker.eq_token(e)}|{e.name or "-"}|{e.site_name or "-"}|{e.equip_status or "-"}|{e.delivery_date or "-"}')
    return '\n'.join(lines)


def tool_equipment_detail(ctx, equip):
    if not equip:
        raise ToolError('equip 인자가 필요합니다.')
    rows = ctx.resolve_equips(equip=equip)
    if len(rows) > 1:
        return f'{len(rows)}대가 일치합니다. 하나를 지정해 주세요: ' + ', '.join(ctx.masker.eq_token(e) for e in rows[:8])
    e = rows[0]
    L, T = D.LogItem, D.TroubleLog
    lines = [
        f'장비 {ctx.masker.eq_token(e)} | 모델 {e.name or "-"} | 사업장 {e.site_name or "-"} | 상태 {e.equip_status or "-"}',
        f'납품 {e.delivery_date or "-"} | 보증시작 {e.warranty_start or "-"} | 보증기간 {e.warranty_period or "-"}',
        f'위치 {_t(" ".join(x for x in [e.building, e.floor, e.detail_loc] if x), 60) or "-"}',
    ]
    if e.special_note:
        lines.append(f'특이사항: {_t(e.special_note, 200)}')

    log_raws = [r for r, x in ctx.raw_index(L).items() if x is not None and x.id == e.id]
    tr_raws = [r for r, x in ctx.raw_index(T).items() if x is not None and x.id == e.id]
    if log_raws:
        base = L.query.options(defer(L.image_data)).filter(L.equip_id.in_(log_raws))
        planned = base.filter(L.status == '작업예정').order_by(L.scheduled_date.asc()).limit(3).all()
        done_q = base.filter(L.status != '작업예정')
        lines.append(f'작업이력 {done_q.count()}건 / 예정 {base.filter(L.status == "작업예정").count()}건')
        for p in planned:
            lines.append(f'- 예정 {p.scheduled_date or p.date}|{p.type}/{p.detail_type}|{p.worker or "-"}')
        for d in done_q.order_by(_log_eff_date().desc()).limit(3).all():
            lines.append(f'- 완료 {d.date}|{d.type}/{d.detail_type}|{_t(d.content, 80)}|{d.worker or "-"}')
    if tr_raws:
        tq = T.query.options(defer(T.image_data)).filter(T.equip_id.in_(tr_raws))
        lines.append(f'트러블 {tq.count()}건')
        for tr in tq.order_by(_trouble_eff_date().desc()).limit(3).all():
            summary = tr.symptom or tr.situation or tr.cause or tr.trouble_details
            lines.append(f'- 트러블 {tr.occur_date or tr.action_date or "-"}|{tr.detail_type or "-"}|{_t(summary, 100)}')
    item_cnt = D.ItemLog.query.filter(D.ItemLog.equip_id.in_(
        [r for r, x in ctx.raw_index(D.ItemLog).items() if x is not None and x.id == e.id] or ['__none__']
    )).count()
    lines.append(f'등록 유지관리 물품 {item_cnt}건')
    return '\n'.join(lines)


def tool_search_work_logs(ctx, equip=None, site=None, model=None, worker=None, status=None, work_type=None,
                          keyword=None, date_from=None, date_to=None, limit=10, order='desc'):
    L = D.LogItem
    limit = _clamp_limit(limit, 10)
    q = L.query.options(defer(L.image_data))
    q, empty = _filter_raw(q, L.equip_id, ctx.target_raw_ids(L, equip, site, model))
    cond = _cond_text(equip=equip, site=site, model=model, worker=worker, status=status, work_type=work_type,
                      keyword=keyword, date_from=date_from, date_to=date_to)
    if empty:
        return f'작업 이력 ({cond}): 0건'
    if status:
        q = q.filter(L.status.in_(ctx.resolve_status(L, status)))
    if worker:
        q = q.filter(_like(L.worker, worker))
    if work_type:
        q = q.filter(or_(_like(L.type, work_type), _like(L.detail_type, work_type),
                         _like(L.detail_type2, work_type), _like(L.detail_type3, work_type)))
    if keyword:
        q = q.filter(or_(_like(L.content, keyword), _like(L.memo, keyword), _like(L.add_work, keyword),
                         _like(L.detail_type, keyword), _like(L.detail_type2, keyword), _like(L.detail_type3, keyword)))
    eff = _log_eff_date()
    q = _apply_date_range(q, eff, date_from, date_to)
    total = q.count()
    rows = q.order_by(eff.asc() if order == 'asc' else eff.desc()).limit(limit).all()
    lines = [f'작업 이력 ({cond}): 총 {total}건, 표시 {len(rows)}건', '날짜|장비|상태|구분|내용|작업자|메모']
    for r in rows:
        kind = '/'.join(x for x in [r.type, r.detail_type, r.detail_type2, r.detail_type3] if x)
        d = r.scheduled_date if r.status == '작업예정' else (r.date or r.scheduled_date)
        lines.append(f'{d or "-"}|{ctx.label_raw(L, r.equip_id)}|{r.status or "-"}|{kind or "-"}|'
                     f'{_t(r.content, 120) or "-"}|{r.worker or "-"}|{_t(r.memo, 100) or "-"}')
    return '\n'.join(lines)


def tool_search_troubles(ctx, equip=None, site=None, model=None, keyword=None, record_status=None,
                         date_from=None, date_to=None, limit=5, detail=False):
    T, L = D.TroubleLog, D.LogItem
    limit = _clamp_limit(limit, 5, hi=15)
    q = T.query.options(defer(T.image_data))
    q, empty = _filter_raw(q, T.equip_id, ctx.target_raw_ids(T, equip, site, model))
    cond = _cond_text(equip=equip, site=site, model=model, keyword=keyword, record_status=record_status,
                      date_from=date_from, date_to=date_to)
    if empty:
        return f'트러블 이력 ({cond}): 0건'
    if record_status:
        q = q.filter(T.status.in_(ctx.resolve_status(T, record_status)))
    if keyword:
        q = q.filter(or_(*[_like(c, keyword) for c in (T.situation, T.symptom, T.cause, T.measure, T.prevent,
                                                        T.trouble_details, T.detail_type, T.detail_type2, T.detail_type3)]))
    eff = _trouble_eff_date()
    q = _apply_date_range(q, eff, date_from, date_to)
    total = q.count()
    rows = q.order_by(eff.desc()).limit(limit).all()

    workers = {}
    ids = [str(r.id) for r in rows if r.id]
    if ids:
        for wid, w in D.db.session.query(L.id, L.worker).filter(L.id.in_(ids)):
            if w and wid not in workers:
                workers[wid] = w

    n = 400 if detail else 150
    lines = [f'트러블 이력 ({cond}): 총 {total}건, 표시 {len(rows)}건 (기록상태는 상세기록 작성 여부이며 조치 여부가 아님)']
    for r in rows:
        kind = '/'.join(x for x in [r.detail_type, r.detail_type2, r.detail_type3] if x) or '-'
        lines.append(f'■ 발생 {r.occur_date or "-"} | 조치 {r.action_date or "-"} | {ctx.label_raw(T, r.equip_id)} | '
                     f'{kind} | 기록 {r.status or "-"} | 작업자 {workers.get(str(r.id), "-")}')
        for label, val in (('상황', r.situation), ('증상', r.symptom), ('원인', r.cause),
                           ('조치', r.measure), ('대책', r.prevent)):
            if val and str(val).strip():
                lines.append(f'  {label}: {_t(val, n)}')
        if r.trouble_details and str(r.trouble_details).strip():
            lines.append(f'  경과: {_t(r.trouble_details, 600 if detail else 250)}')
    return '\n'.join(lines)


def tool_get_statistics(ctx, target, group_by, equip=None, site=None, model=None, status=None,
                        date_from=None, date_to=None, top=15):
    top = _clamp_limit(top, 15, hi=40)
    target = (target or '').strip().lower()
    group_by = (group_by or '').strip().lower()
    cond = _cond_text(equip=equip, site=site, model=model, status=status, date_from=date_from, date_to=date_to)
    counts = {}

    def bump(k, n=1):
        k = (str(k).strip() if k is not None else '') or '미지정'
        counts[k] = counts.get(k, 0) + n

    if target == 'equipment':
        rows = ctx.resolve_equips(equip, site, model)
        rows = [e for e in (ctx.equips if rows is None else rows) if (e.name or '').strip() != '기타(ETC)']
        if status:
            rows = [e for e in rows if _norm(status) in _norm(e.equip_status)]
        key = {'site': lambda e: e.site_name, 'model': lambda e: e.name,
               'status': lambda e: e.equip_status}.get(group_by)
        if key is None:
            raise ToolError("equipment 의 group_by 는 site/model/status 중 하나입니다.")
        for e in rows:
            bump(key(e))
        title = '장비 수'
        unit = '대'
    elif target in ('work', 'trouble', 'setup'):
        if target == 'work':
            M = D.LogItem
            eff = _log_eff_date()
            cols = {'status': M.status, 'type': M.type, 'detail_type': M.detail_type, 'worker': M.worker}
        elif target == 'trouble':
            M = D.TroubleLog
            eff = _trouble_eff_date()
            cols = {'status': M.status, 'type': M.type, 'detail_type': M.detail_type}
        else:
            M = D.SetupDetail
            eff = M.date
            cols = {'status': M.completed, 'type': M.category, 'detail_type': M.subcategory}
        if group_by not in ('site', 'model', 'month', 'none') and group_by not in cols:
            raise ToolError(f"{target} 의 group_by 는 site/model/month/none/{'/'.join(cols)} 중 하나입니다.")
        q = D.db.session.query(M.equip_id, eff.label('eff'), *[c.label(k) for k, c in cols.items()])
        q, empty = _filter_raw(q, M.equip_id, ctx.target_raw_ids(M, equip, site, model))
        if not empty:
            if status:
                if target == 'setup':
                    q = q.filter(M.completed.is_(_norm(status) in ('완료', 'true', 'done', 'completed')))
                else:
                    q = q.filter(M.status.in_(ctx.resolve_status(M, status)))
            q = _apply_date_range(q, eff, date_from, date_to)
            for r in q.all():
                if group_by == 'site':
                    bump(ctx.site_of_raw(M, r.equip_id))
                elif group_by == 'model':
                    bump(ctx.model_of_raw(M, r.equip_id))
                elif group_by == 'month':
                    bump((r.eff or '')[:7])
                elif group_by == 'none':
                    bump('전체')
                elif group_by == 'worker':
                    names = [x.strip() for x in re.split(r'[,/·&]', r.worker or '') if x.strip()]
                    for nm in names or ['미지정']:
                        bump(nm)
                elif target == 'setup' and group_by == 'status':
                    bump('완료' if getattr(r, 'status') else '미완료')
                else:
                    bump(getattr(r, group_by))
        title = {'work': '작업 이력 건수', 'trouble': '트러블 건수', 'setup': '셋업 항목 수'}[target]
        unit = '건'
    else:
        raise ToolError('target 은 equipment/work/trouble/setup 중 하나입니다.')

    total = sum(counts.values())
    if group_by == 'month':
        items = sorted(counts.items(), key=lambda x: x[0])
    else:
        items = sorted(counts.items(), key=lambda x: -x[1])
    lines = [f'{title} 통계 ({cond}, 기준={group_by}): 총 {total}{unit}']
    for k, v in items[:top]:
        lines.append(f'- {k}: {v}{unit}')
    if len(items) > top:
        rest = sum(v for _, v in items[top:])
        lines.append(f'- 그 외 {len(items) - top}개 그룹: {rest}{unit}')
    return '\n'.join(lines)


def tool_search_setup(ctx, equip=None, site=None, model=None, completed=None, keyword=None, limit=10):
    S = D.SetupDetail
    limit = _clamp_limit(limit, 10)
    q = S.query
    q, empty = _filter_raw(q, S.equip_id, ctx.target_raw_ids(S, equip, site, model))
    cond = _cond_text(equip=equip, site=site, model=model, completed=completed, keyword=keyword)
    if empty:
        return f'셋업 항목 ({cond}): 0건'
    if completed is not None:
        q = q.filter(S.completed.is_(bool(completed)))
    if keyword:
        q = q.filter(or_(_like(S.category, keyword), _like(S.subcategory, keyword), _like(S.content, keyword)))
    total = q.count()
    rows = q.order_by(S.date.asc()).limit(limit).all()
    lines = [f'셋업 항목 ({cond}): 총 {total}건, 표시 {len(rows)}건', '장비|구분|내용|시작|목표일|상태|지연사유']
    for r in rows:
        kind = '/'.join(x for x in [r.category, r.subcategory] if x) or '-'
        lines.append(f'{ctx.label_raw(S, r.equip_id)}|{kind}|{_t(r.content, 80)}|{r.start_date or "-"}|{r.date or "-"}|'
                     f'{"완료" if r.completed else "미완료"}|{_t(r.delay_reason, 60) or "-"}')
    return '\n'.join(lines)


def tool_search_parts(ctx, keyword=None, equip=None, site=None, model=None, include_stock=False, limit=10):
    I = D.ItemLog
    limit = _clamp_limit(limit, 10)
    q = I.query
    q, empty = _filter_raw(q, I.equip_id, ctx.target_raw_ids(I, equip, site, model))
    cond = _cond_text(keyword=keyword, equip=equip, site=site, model=model)
    lines = []
    if empty:
        lines.append(f'장비 등록 물품 ({cond}): 0건')
    else:
        if keyword:
            q = q.filter(or_(_like(I.code, keyword), _like(I.part, keyword), _like(I.spec, keyword),
                             _like(I.part_detail, keyword)))
        total = q.count()
        rows = q.order_by(I.date.desc()).limit(limit).all()
        lines.append(f'장비 등록 물품 ({cond}): 총 {total}건, 표시 {len(rows)}건')
        lines.append('장비|코드|물품명|상세|규격|등록/교체일|주기')
        for r in rows:
            lines.append(f'{ctx.label_raw(I, r.equip_id)}|{r.code or "-"}|{r.part or "-"}|{r.part_detail or "-"}|'
                         f'{_t(r.spec, 60) or "-"}|{r.date or "-"}|{r.cycle or "-"}')
    if include_stock:
        S = D.ItemStock
        sq = S.query
        if site:
            site_keys = ctx.resolve_sites(site)
            names = [s.name for s in D.Site.query.all() if _norm(s.name) in site_keys]
            groups = [g for g in {getattr(s, 'group', '') for s in D.Site.query.all() if _norm(s.name) in site_keys} if g]
            sq = sq.filter(or_(S.site_name.in_(names or ['__none__']), S.site_group.in_(groups or ['__none__'])))
        if keyword:
            sq = sq.filter(or_(_like(S.code, keyword), _like(S.part, keyword), _like(S.spec, keyword)))
        stocks = sq.order_by(S.code.asc()).limit(limit).all()
        lines.append(f'재고 현황: 표시 {len(stocks)}건')
        lines.append('구분|사업장|코드|물품명|현재수량|안전재고|등급')
        for s in stocks:
            lines.append(f'{s.site_group or "-"}|{s.site_name or "-"}|{s.code or "-"}|{s.part or "-"}|'
                         f'{s.quantity or 0}|{s.safety_quantity or 0}|{s.grade or "-"}')
    return '\n'.join(lines)


def _table_exists(name):
    if D.db_type == 'mysql':
        return bool(D.db.session.execute(text('SHOW TABLES LIKE :t'), {'t': name}).fetchone())
    return bool(D.db.session.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"), {'t': name}).fetchone())


def _resolve_zdata_table(eq, ctx):
    n = _norm(eq.name)
    abbrs = [m.abbr for m in D.EquipmentModel.query.all() if m.abbr and n in (_norm(m.name), _norm(m.abbr))]
    candidates = []
    for base in abbrs + [eq.name]:
        if base:
            candidates.append(D.get_equip_data_table_name(base, eq.cust_equip_name, eq.serial)[0])
            candidates.append(D.get_equip_data_table_name(base, '', eq.serial)[0])
    for c in candidates:
        if c and _table_exists(c):
            return c
    # 대소문자·공백 차이를 무시한 퍼지 매칭
    if D.db_type == 'mysql':
        names = [r[0] for r in D.db.session.execute(text("SHOW TABLES LIKE 'zData%'")).fetchall()]
    else:
        names = [r[0] for r in D.db.session.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'zData%'")).fetchall()]
    keys = [k for k in (_norm(eq.cust_equip_name), _norm(eq.serial)) if len(k) >= 3]
    for nm in names:
        nn = _norm(nm)
        if any(k in nn for k in keys):
            return nm
    return None


def tool_get_measurements(ctx, equip, limit=5, column_keyword=None):
    if not equip:
        raise ToolError('equip 인자가 필요합니다.')
    rows = ctx.resolve_equips(equip=equip)
    if len(rows) > 1:
        return f'{len(rows)}대가 일치합니다. 하나를 지정해 주세요: ' + ', '.join(ctx.masker.eq_token(e) for e in rows[:8])
    eq = rows[0]
    limit = _clamp_limit(limit, 5, hi=20)
    tok = ctx.masker.eq_token(eq)
    tbl = _resolve_zdata_table(eq, ctx)
    if not tbl:
        return f'{tok}: 측정 데이터 시트가 없습니다.'
    if D.db_type == 'mysql':
        cols = [r[0] for r in D.db.session.execute(text(f'SHOW COLUMNS FROM `{tbl}`')).fetchall()]
    else:
        cols = [r[1] for r in D.db.session.execute(text(f'PRAGMA table_info(`{tbl}`)')).fetchall()]
    data_cols = [c for c in cols if c not in ('id', 'record_date', 'created_at')]
    if column_keyword:
        sel = [c for c in data_cols if _norm(column_keyword) in _norm(c)]
        data_cols = sel or data_cols
    cut = len(data_cols) > 12
    data_cols = data_cols[:12]
    total = D.db.session.execute(text(f'SELECT COUNT(*) FROM `{tbl}`')).scalar() or 0
    order = 'record_date DESC, id DESC' if 'record_date' in cols else 'id DESC'
    recs = D.db.session.execute(text(f'SELECT * FROM `{tbl}` ORDER BY {order} LIMIT {limit}')).fetchall()
    lines = [f'{tok} 측정 데이터: 총 {total}행, 최근 {len(recs)}행' + (' (항목이 많아 12개만 표시)' if cut else ''),
             '기록일|' + '|'.join(data_cols)]
    for r in recs:
        mp = dict(r._mapping)
        lines.append(f"{mp.get('record_date', '-')}|" + '|'.join(_t(mp.get(c), 20) for c in data_cols))
    return '\n'.join(lines)


TOOL_FUNCS = {
    'find_equipment': tool_find_equipment,
    'equipment_detail': tool_equipment_detail,
    'search_work_logs': tool_search_work_logs,
    'search_troubles': tool_search_troubles,
    'get_statistics': tool_get_statistics,
    'search_setup': tool_search_setup,
    'search_parts': tool_search_parts,
    'get_measurements': tool_get_measurements,
}

_S = {'type': 'string'}
_I = {'type': 'integer'}
_B = {'type': 'boolean'}
_EQ = {'type': 'string', 'description': '장비 토큰([EQ_1]) 또는 시리얼/고객장비명'}
_SITE = {'type': 'string', 'description': '사업장 또는 고객사 구분'}
_MODEL = {'type': 'string', 'description': '장비 모델명 또는 약어'}
_DF = {'type': 'string', 'description': 'YYYY-MM-DD 또는 YYYY-MM'}

TOOL_DECLS = [
    {'name': 'find_equipment', 'description': '장비 목록과 사업장/모델/상태별 대수.',
     'parameters': {'type': 'object', 'properties': {
         'equip': _EQ, 'site': _SITE, 'model': _MODEL, 'status': {'type': 'string', 'description': '가동 상태'},
         'limit': _I}}},
    {'name': 'equipment_detail', 'description': '장비 1대의 기본정보, 최근 작업/예정/트러블 요약.',
     'parameters': {'type': 'object', 'properties': {'equip': _EQ}, 'required': ['equip']}},
    {'name': 'search_work_logs', 'description': '점검/유지보수 작업 이력과 예정 일정 목록.',
     'parameters': {'type': 'object', 'properties': {
         'equip': _EQ, 'site': _SITE, 'model': _MODEL, 'worker': _S,
         'status': {'type': 'string', 'description': '예정/완료/연기 등'},
         'work_type': {'type': 'string', 'description': '정기/비정기/고객대응, PM, Alarm 등'},
         'keyword': {'type': 'string', 'description': '내용·메모 검색어'},
         'date_from': _DF, 'date_to': _DF, 'limit': _I,
         'order': {'type': 'string', 'enum': ['desc', 'asc']}}}},
    {'name': 'search_troubles', 'description': '장애(트러블) 이력: 상황/증상/원인/조치/대책.',
     'parameters': {'type': 'object', 'properties': {
         'equip': _EQ, 'site': _SITE, 'model': _MODEL, 'keyword': _S,
         'record_status': {'type': 'string', 'description': '미기록/기록완료 (상세기록 작성 여부)'},
         'date_from': _DF, 'date_to': _DF, 'limit': _I,
         'detail': {'type': 'boolean', 'description': '경과 내용을 길게 볼 때만 true'}}}},
    {'name': 'get_statistics', 'description': '건수/대수 집계. 개수 질문은 목록 대신 이것을 사용. work 는 작업예정 포함이므로 완료만 셀 때 status=완료.',
     'parameters': {'type': 'object', 'properties': {
         'target': {'type': 'string', 'enum': ['equipment', 'work', 'trouble', 'setup']},
         'group_by': {'type': 'string', 'enum': ['none', 'site', 'model', 'status', 'type', 'detail_type', 'worker', 'month']},
         'equip': _EQ, 'site': _SITE, 'model': _MODEL, 'status': _S,
         'date_from': _DF, 'date_to': _DF, 'top': _I}, 'required': ['target', 'group_by']}},
    {'name': 'search_setup', 'description': '장비 셋업 항목과 진행 상태.',
     'parameters': {'type': 'object', 'properties': {
         'equip': _EQ, 'site': _SITE, 'model': _MODEL, 'completed': _B, 'keyword': _S, 'limit': _I}}},
    {'name': 'search_parts', 'description': '장비별 유지관리 물품(코드/규격/교체일), 선택 시 재고 수량.',
     'parameters': {'type': 'object', 'properties': {
         'keyword': _S, 'equip': _EQ, 'site': _SITE, 'model': _MODEL, 'include_stock': _B, 'limit': _I}}},
    {'name': 'get_measurements', 'description': '장비 데이터 시트의 최근 측정값.',
     'parameters': {'type': 'object', 'properties': {
         'equip': _EQ, 'limit': _I, 'column_keyword': {'type': 'string', 'description': '측정 항목 이름 일부'}},
         'required': ['equip']}},
]


def execute_tool(ctx, name, args):
    fn = TOOL_FUNCS.get(name)
    if fn is None:
        return f'알 수 없는 도구: {name}'
    clean = {}
    for k, v in (args or {}).items():
        if v in (None, ''):
            continue
        clean[k] = ctx.masker.unmask_arg(v) if isinstance(v, str) else v
    try:
        return fn(ctx, **clean)
    except ToolError as e:
        return f'조회 결과 없음: {e}'
    except TypeError as e:
        return f'도구 인자 오류: {e}'
    except Exception as e:
        D.db.session.rollback()
        D.app.logger.error(f'[AI Chat] 도구 실행 오류 {name}({clean}): {e}')
        return '도구 실행 중 서버 오류가 발생했습니다. (DB 구조 변경 여부 확인 필요)'


# ------------------------------------------------------------------------------
# 6. AI 공급자 어댑터 (Gemini / OpenAI 호환)
# ------------------------------------------------------------------------------
class ChatAPIError(Exception):
    pass


def _http_post(url, payload, headers, timeout):
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode('utf-8')[:500]
        except Exception:
            pass
        D.app.logger.error(f'[AI Chat] API HTTP {e.code}: {body}')
        msg = {
            400: 'AI API 요청 형식 오류입니다. 모델명(CHAT_API_MODEL)과 설정을 확인해 주세요.',
            401: 'AI API 키가 올바르지 않습니다. (CHAT_API_KEY 확인)',
            403: 'AI API 키에 권한이 없습니다. (CHAT_API_KEY 확인)',
            404: 'AI 모델을 찾을 수 없습니다. (CHAT_API_MODEL 확인)',
            429: 'AI 사용량 한도(분당/일일 호출 수)를 초과했습니다. 잠시 후 다시 시도하시거나 유료 플랜을 확인해 주세요.',
        }.get(e.code)
        if msg is None and e.code >= 500:
            msg = 'AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.'
        raise ChatAPIError(msg or f'AI API 호출 오류가 발생했습니다. (코드: {e.code})')
    except urllib.error.URLError as e:
        if isinstance(getattr(e, 'reason', None), socket.timeout) or 'timed out' in str(e).lower():
            raise ChatAPIError('AI 응답 시간이 초과되었습니다. 질문 범위를 좁혀 다시 시도해 주세요.')
        D.app.logger.error(f'[AI Chat] API 연결 오류: {e}')
        raise ChatAPIError('AI API 서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.')
    except (socket.timeout, TimeoutError):
        raise ChatAPIError('AI 응답 시간이 초과되었습니다. 질문 범위를 좁혀 다시 시도해 주세요.')


def _gemini_schema(node):
    """OpenAPI 소문자 타입 → Gemini 대문자 타입"""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == 'type' and isinstance(v, str):
                out[k] = v.upper()
            else:
                out[k] = _gemini_schema(v)
        return out
    if isinstance(node, list):
        return [_gemini_schema(x) for x in node]
    return node


class _Reply:
    def __init__(self, text='', calls=None, usage=None, raw=None, truncated=False):
        self.text = text
        self.calls = calls or []   # [(call_id, name, args)]
        self.usage = usage or {}
        self.raw = raw
        self.truncated = truncated


class GeminiChat:
    def __init__(self, cfg, system, tools):
        self.cfg = cfg
        self.system = system
        self.tools = [{'functionDeclarations': [_gemini_schema(t) for t in tools]}] if tools else []
        self.contents = []

    def add_text(self, role, text):
        self.contents.append({'role': 'model' if role == 'ai' else 'user', 'parts': [{'text': text}]})

    def send(self, allow_tools):
        gen = {'maxOutputTokens': self.cfg['max_output_tokens'], 'temperature': self.cfg['temperature']}
        if self.cfg['thinking_budget'] is not None:
            gen['thinkingConfig'] = {'thinkingBudget': self.cfg['thinking_budget']}
        payload = {
            'systemInstruction': {'parts': [{'text': self.system}]},
            'contents': self.contents,
            'generationConfig': gen,
        }
        if self.tools:
            payload['tools'] = self.tools
            payload['toolConfig'] = {'functionCallingConfig': {'mode': 'AUTO' if allow_tools else 'NONE'}}
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.cfg['model']}:generateContent"
        res = _http_post(url, payload, {'Content-Type': 'application/json', 'x-goog-api-key': self.cfg['api_key']},
                         self.cfg['timeout'])
        um = res.get('usageMetadata', {}) or {}
        usage = {
            'prompt': um.get('promptTokenCount', 0) or 0,
            'output': um.get('candidatesTokenCount', 0) or 0,
            'thoughts': um.get('thoughtsTokenCount', 0) or 0,
            'cached': um.get('cachedContentTokenCount', 0) or 0,
            'total': um.get('totalTokenCount', 0) or 0,
        }
        cands = res.get('candidates') or []
        if not cands:
            reason = (res.get('promptFeedback') or {}).get('blockReason', '')
            return _Reply(text=f'AI 가 답변을 생성하지 못했습니다. {reason}'.strip(), usage=usage)
        content = cands[0].get('content') or {}
        parts = content.get('parts') or []
        calls, texts = [], []
        for i, p in enumerate(parts):
            if 'functionCall' in p:
                fc = p['functionCall']
                calls.append((fc.get('id') or str(i), fc.get('name'), fc.get('args') or {}))
            elif p.get('text') and not p.get('thought'):
                texts.append(p['text'])
        return _Reply(text='\n'.join(texts).strip(), calls=calls, usage=usage, raw=content,
                      truncated=cands[0].get('finishReason') == 'MAX_TOKENS')

    def add_tool_results(self, reply, results):
        self.contents.append(reply.raw)  # thoughtSignature 등 원본 그대로 되돌려 보내야 합니다.
        parts = []
        for (call_id, name, _), res in results:
            fr = {'name': name, 'response': {'result': res}}
            if call_id and not call_id.isdigit():
                fr['id'] = call_id
            parts.append({'functionResponse': fr})
        self.contents.append({'role': 'user', 'parts': parts})


class OpenAIChat:
    def __init__(self, cfg, system, tools):
        self.cfg = cfg
        self.tools = [{'type': 'function', 'function': t} for t in tools]
        self.messages = [{'role': 'system', 'content': system}]

    def add_text(self, role, text):
        self.messages.append({'role': 'assistant' if role == 'ai' else 'user', 'content': text})

    def send(self, allow_tools):
        payload = {
            'model': self.cfg['model'],
            'messages': self.messages,
            'max_tokens': self.cfg['max_output_tokens'],
            'temperature': self.cfg['temperature'],
        }
        if self.tools:
            payload['tools'] = self.tools
            payload['tool_choice'] = 'auto' if allow_tools else 'none'
        res = _http_post(self.cfg['api_url'], payload,
                         {'Content-Type': 'application/json', 'Authorization': f"Bearer {self.cfg['api_key']}"},
                         self.cfg['timeout'])
        u = res.get('usage', {}) or {}
        reasoning = ((u.get('completion_tokens_details') or {}).get('reasoning_tokens') or 0)
        usage = {
            'prompt': u.get('prompt_tokens', 0) or 0,
            'output': max(0, (u.get('completion_tokens', 0) or 0) - reasoning),
            'thoughts': reasoning,
            'cached': ((u.get('prompt_tokens_details') or {}).get('cached_tokens') or 0),
            'total': u.get('total_tokens', 0) or 0,
        }
        choice = (res.get('choices') or [{}])[0]
        msg = choice.get('message') or {}
        calls = []
        for tc in msg.get('tool_calls') or []:
            fn = tc.get('function') or {}
            try:
                args = json.loads(fn.get('arguments') or '{}')
            except ValueError:
                args = {}
            calls.append((tc.get('id'), fn.get('name'), args))
        return _Reply(text=(msg.get('content') or '').strip(), calls=calls, usage=usage, raw=msg,
                      truncated=choice.get('finish_reason') == 'length')

    def add_tool_results(self, reply, results):
        self.messages.append({'role': 'assistant', 'content': reply.raw.get('content'),
                              'tool_calls': reply.raw.get('tool_calls')})
        for (call_id, name, _), res in results:
            self.messages.append({'role': 'tool', 'tool_call_id': call_id, 'content': res})


# ------------------------------------------------------------------------------
# 7. 에이전트 루프
# ------------------------------------------------------------------------------
def build_system_prompt():
    today = datetime.now()
    return (
        f"너는 위드텍(WITHTECH) 설비 유지보수 데이터 비서다. 오늘은 {today.strftime('%Y-%m-%d')}({'월화수목금토일'[today.weekday()]})이다.\n"
        "규칙:\n"
        "1. 사내 데이터(장비/작업/트러블/셋업/물품/측정값) 질문은 반드시 도구 조회 결과만 근거로 답한다. 결과에 없으면 없다고 말하고 추측하지 않는다.\n"
        "2. [SITE_1], [EQ_2], [PERSON_3] 같은 대괄호 토큰은 보안상 가린 실제 값이다. 답변과 도구 인자에 그대로 쓰고 풀어서 추측하지 않는다. "
        "장비는 [EQ_n] 토큰만 쓰고 모델명을 괄호로 붙이지 않는다.\n"
        "3. '이번 달', '3월', '어제' 같은 기간은 date_from/date_to(YYYY-MM-DD)로 바꿔 넘긴다.\n"
        "4. 개수·건수 질문은 get_statistics 로 답한다. 목록은 필요한 만큼만 작은 limit 으로 조회한다.\n"
        "5. 도구 호출은 최소한으로 하고, 필요한 도구는 한 번에 함께 호출한다. 이전 대화에 이미 있는 정보는 다시 조회하지 않는다.\n"
        "6. 완료된 작업 건수는 정상 정비 실적이며 오류 건수가 아니다.\n"
        "7. 한국어 높임말, 간결한 마크다운으로 답한다. 단순 질문은 1~3줄. 장애 분석을 요청받은 경우에만 "
        "'이력 요약 / 권장 조치 / 예방 방안' 구성으로 답한다.\n"
        "8. 일반 상식·인사는 도구 없이 짧게 답한다."
    )


def _load_history(user_id, session_id, cfg):
    if cfg['history_turns'] <= 0:
        return []
    H = D.ChatHistory
    # 하루 단위 대화이므로 오늘 주고받은 최근 대화를 맥락으로 사용합니다.
    rows = (H.query.filter_by(user_id=user_id, date_str=datetime.now().strftime('%Y-%m-%d'))
            .order_by(H.id.desc()).limit(cfg['history_turns'] * 2).all())
    rows.reverse()
    out = []
    for r in rows:
        msg = r.message or ''
        if r.sender == 'ai':
            if msg.startswith('⚠️'):
                # 오류 답변과 그 질문은 맥락에서 제외 (같은 역할이 연속되지 않도록)
                if out and out[-1][0] == 'user':
                    out.pop()
                continue
            msg = _t(msg, cfg['history_ai_chars']) if len(msg) > cfg['history_ai_chars'] else msg
        out.append((r.sender, msg))
    # Gemini 는 user 로 시작해야 하므로 앞쪽 ai 메시지는 버립니다.
    while out and out[0][0] != 'user':
        out.pop(0)
    return out


def run_agent(user, question, session_id):
    cfg = get_config()
    if not cfg['api_key']:
        raise ChatAPIError('AI API 키(CHAT_API_KEY)가 설정되지 않았습니다. 서버 환경설정을 확인해 주세요.')

    masker = Masker(cfg['mask_model'])
    ctx = ToolContext(user, masker)
    system = build_system_prompt()
    chat = (GeminiChat if cfg['api_type'] == 'gemini' else OpenAIChat)(cfg, system, TOOL_DECLS)

    history = _load_history(user.id, session_id, cfg)
    hist_chars = 0
    for role, msg in history:
        m = masker.mask(msg)
        hist_chars += len(m)
        chat.add_text(role, m)
    masked_q = masker.mask(question)
    chat.add_text('user', masked_q)

    request_id = uuid.uuid4().hex[:16]
    base_chars = {
        'system': len(system),
        'tools_decl': len(json.dumps(TOOL_DECLS, ensure_ascii=False)),
        'history': hist_chars,
        'question': len(masked_q),
    }
    tool_chars = 0          # 이번 질문에서 누적된 도구 결과 문자 수 (다음 호출부터 매번 재전송됨)
    rounds = []
    tools_used = []
    final_text = ''
    truncated = False
    error = None

    try:
        for round_no in range(1, cfg['max_tool_rounds'] + 2):
            allow = round_no <= cfg['max_tool_rounds']
            t0 = time.time()
            reply = chat.send(allow_tools=allow)
            info = {
                'round_no': round_no, 'usage': reply.usage, 'latency_ms': int((time.time() - t0) * 1000),
                'chars': dict(base_chars, tool_results=tool_chars), 'tools': [],
            }
            rounds.append(info)
            if reply.calls and allow:
                results = []
                for call in reply.calls[:cfg['max_calls_per_round']]:
                    _, name, args = call
                    res = masker.mask(execute_tool(ctx, name, args))
                    if len(res) > cfg['tool_result_chars']:
                        res = res[:cfg['tool_result_chars']] + '\n…(결과가 길어 잘림. 조건을 좁혀 다시 조회 가능)'
                    tool_chars += len(res)
                    info['tools'].append({'name': name, 'chars': len(res)})
                    tools_used.append(name)
                    results.append((call, res))
                chat.add_tool_results(reply, results)
                continue
            final_text = reply.text
            truncated = reply.truncated
            break
    except ChatAPIError as e:
        error = str(e)

    answer = masker.unmask(final_text) if final_text else ''
    if truncated:
        answer += '\n\n_(답변 길이 제한으로 일부가 잘렸습니다. 범위를 좁혀 다시 질문해 주세요.)_'
    if not answer and not error:
        error = 'AI 가 답변을 생성하지 못했습니다. 질문을 바꿔 다시 시도해 주세요.'
    _save_usage(user.id, session_id, request_id, question, cfg, rounds, error)

    total = {k: sum(r['usage'].get(k, 0) for r in rounds) for k in ('prompt', 'output', 'thoughts', 'cached', 'total')}
    summary = {'request_id': request_id, 'api_calls': len(rounds), 'tools': tools_used, **total}
    D.app.logger.info(f"[AI Chat] user={user.id} req={request_id} calls={len(rounds)} tools={tools_used} "
                      f"in={total['prompt']} out={total['output']} think={total['thoughts']} err={bool(error)}")
    return answer, error, summary


def _save_usage(user_id, session_id, request_id, question, cfg, rounds, error, mode='chat'):
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        for r in rounds:
            u, c = r['usage'], r['chars']
            D.db.session.add(D.ChatUsage(
                user_id=user_id, session_id=session_id or '', request_id=request_id, date_str=today, mode=mode,
                question=_t(question, 100), round_no=r['round_no'], model=cfg['model'], status='ok',
                prompt_tokens=u.get('prompt', 0), output_tokens=u.get('output', 0),
                thoughts_tokens=u.get('thoughts', 0), cached_tokens=u.get('cached', 0),
                total_tokens=u.get('total', 0), latency_ms=r['latency_ms'],
                tool_detail=json.dumps(r['tools'], ensure_ascii=False),
                chars_system=c['system'], chars_tools_decl=c['tools_decl'], chars_history=c['history'],
                chars_question=c['question'], chars_tool_results=c['tool_results'],
            ))
        if error:
            D.db.session.add(D.ChatUsage(
                user_id=user_id, session_id=session_id or '', request_id=request_id, date_str=today, mode=mode,
                question=_t(question, 100), round_no=len(rounds) + 1, model=cfg['model'], status='error',
                tool_detail=json.dumps({'error': _t(error, 150)}, ensure_ascii=False),
            ))
        D.db.session.commit()
    except Exception as e:
        D.db.session.rollback()
        D.app.logger.error(f'[AI Chat] 사용량 기록 실패: {e}')


# ------------------------------------------------------------------------------
# 7-2. 장비 문제 원인 파악 모드 (서버가 분석 데이터를 미리 모아 AI 1회 호출)
#   - 기간: 항상 전체 / 사업장: 항상 전체 (권한 범위 내)
#   - 모델 전체 경향 + (선택 시) 이상 장비 상세 이력
#   - 증상은 관련 사례를 앞쪽에 배치하는 용도이며 분석 범위는 트러블 전반
# ------------------------------------------------------------------------------
_TROUBLE_FIELDS = (('상황', 'situation'), ('증상', 'symptom'), ('원인', 'cause'), ('조치', 'measure'), ('대책', 'prevent'))


def _symptom_keywords(symptom):
    return [w for w in re.split(r'[\s,./·]+', str(symptom or '')) if len(w) >= 2][:5]


def _trouble_text_filter(T, kws):
    cols = (T.situation, T.symptom, T.cause, T.measure, T.prevent, T.trouble_details,
            T.detail_type, T.detail_type2, T.detail_type3)
    return or_(*[_like(c, kw) for kw in kws for c in cols])


def _pick_troubles(raws, kws, limit):
    """증상 관련 사례 우선 + 최근 사례로 채움 (전체 기간)"""
    T = D.TroubleLog
    if not raws:
        return [], set()
    base = T.query.options(defer(T.image_data)).filter(T.equip_id.in_(raws))
    eff = _trouble_eff_date()
    picked, related_ids = [], set()
    if kws:
        for r in base.filter(_trouble_text_filter(T, kws)).order_by(eff.desc()).limit(limit).all():
            picked.append(r)
            related_ids.add(r._unique_id)
    if len(picked) < limit:
        seen = {r._unique_id for r in picked}
        for r in base.order_by(eff.desc()).limit(limit + len(seen)).all():
            if r._unique_id not in seen and len(picked) < limit:
                picked.append(r)
    return picked, related_ids


def _worker_map(ids):
    L = D.LogItem
    out = {}
    ids = [str(i) for i in ids if i]
    if ids:
        for wid, w in D.db.session.query(L.id, L.worker).filter(L.id.in_(ids)):
            if w and wid not in out:
                out[wid] = w
    return out


def _format_case(ctx, r, workers, related, field_len, detail_len):
    T = D.TroubleLog
    kind = '/'.join(x for x in [r.detail_type, r.detail_type2, r.detail_type3] if x) or '-'
    mark = ' ★증상관련' if related else ''
    lines = [f'■ 발생 {r.occur_date or "-"} | 조치 {r.action_date or "-"} | {ctx.label_raw(T, r.equip_id)} | {kind} | '
             f'작업자 {workers.get(str(r.id), "-")}{mark}']
    for label, attr in _TROUBLE_FIELDS:
        val = getattr(r, attr)
        if val and str(val).strip():
            lines.append(f'  {label}: {_t(val, field_len)}')
    if r.trouble_details and str(r.trouble_details).strip():
        lines.append(f'  경과: {_t(r.trouble_details, detail_len)}')
    return lines


def _count_top(values, top):
    cnt = {}
    for v in values:
        k = (str(v).strip() if v else '') or '미지정'
        cnt[k] = cnt.get(k, 0) + 1
    items = sorted(cnt.items(), key=lambda x: -x[1])
    out = ', '.join(f'{k} {v}' for k, v in items[:top])
    if len(items) > top:
        out += f' 외 {len(items) - top}종'
    return out


def build_analysis_context(ctx, model, equip_id, symptom, cfg):
    T, L, I = D.TroubleLog, D.LogItem, D.ItemLog
    model_keys = ctx.resolve_models(model)
    m_equips = [e for e in ctx.equips if _norm(e.name) in model_keys and (e.name or '').strip() != '기타(ETC)']
    if not m_equips:
        raise ToolError(f"모델 '{model}' 에 등록된 장비가 없습니다.")
    target = None
    if equip_id:
        target = next((e for e in m_equips if e.id == equip_id), None)
        if target is None:
            raise ToolError('선택한 장비가 해당 모델에 없습니다.')
    eq_ids = {e.id for e in m_equips}

    def raws_of(Model, ids):
        return [r for r, e in ctx.raw_index(Model).items() if e is not None and e.id in ids]

    t_raws, l_raws, i_raws = raws_of(T, eq_ids), raws_of(L, eq_ids), raws_of(I, eq_ids)
    kws = _symptom_keywords(symptom)
    lines = []

    # 1) 모델 개요
    sites = {_norm(e.site_name) for e in m_equips if e.site_name}
    lines.append('[1. 모델 개요]')
    lines.append(f'- 모델 {m_equips[0].name} | 장비 {len(m_equips)}대 | 설치 사업장 {len(sites)}곳 | '
                 f'상태: {_count_top([e.equip_status for e in m_equips], 6)}')

    # 2) 모델 전체 트러블 집계 (전체 기간)
    eff = _trouble_eff_date()
    rows = []
    if t_raws:
        rows = D.db.session.query(T.equip_id, T.detail_type, T.detail_type2, T.detail_type3, eff.label('eff')) \
            .filter(T.equip_id.in_(t_raws)).all()
    per_eq = {}
    for r in rows:
        per_eq[r.equip_id] = per_eq.get(r.equip_id, 0) + 1
    lines.append('\n[2. 모델 전체 트러블 집계 (전체 기간)]')
    lines.append(f'- 총 {len(rows)}건, 장비당 평균 {len(rows) / len(m_equips):.1f}건')
    if rows:
        lines.append(f'- 세부구분1: {_count_top([r.detail_type for r in rows], 8)}')
        lines.append(f'- 세부구분2: {_count_top([r.detail_type2 for r in rows], 8)}')
        lines.append(f'- 조치구분: {_count_top([r.detail_type3 for r in rows], 6)}')
        lines.append(f'- 연도별: {_count_top([(r.eff or "")[:4] for r in rows], 10)}')
        recent_from = (datetime.now() - timedelta(days=365)).strftime('%Y-%m')
        month_cnt = {}
        for r in rows:
            m = (r.eff or '')[:7]
            if m >= recent_from:
                month_cnt[m] = month_cnt.get(m, 0) + 1
        if month_cnt:
            lines.append('- 최근 12개월: ' + ', '.join(f'{m} {c}' for m, c in sorted(month_cnt.items())))
        top_eq = sorted(per_eq.items(), key=lambda x: -x[1])[:5]
        lines.append('- 트러블 많은 장비: ' + ', '.join(f'{ctx.label_raw(T, k)} {v}건' for k, v in top_eq))
        if kws:
            rel = T.query.filter(T.equip_id.in_(t_raws), _trouble_text_filter(T, kws)).count()
            lines.append(f'- 입력 증상({", ".join(kws)}) 관련 트러블: {rel}건')

    # 3) 모델 전체 작업·물품 집계
    if l_raws or i_raws:
        lines.append('\n[3. 모델 전체 작업·물품 집계]')
    if l_raws:
        type_rows = D.db.session.query(L.type, func.count()).filter(
            L.equip_id.in_(l_raws), L.status != '작업예정').group_by(L.type).all()
        lines.append('- 완료 작업 구분별: ' + ', '.join(
            f'{k or "미지정"} {v}' for k, v in sorted(type_rows, key=lambda x: -x[1])[:8]))
    if i_raws:
        part_rows = D.db.session.query(I.code, func.count(), func.max(I.date)).filter(
            I.equip_id.in_(i_raws)).group_by(I.code).order_by(func.count().desc()).limit(10).all()
        if part_rows:
            lines.append('- 등록/교체 물품 빈도: ' + ', '.join(
                f'{c or "미지정"} {n}건(최근 {d or "-"})' for c, n, d in part_rows))

    # 4) 모델 대표 사례
    cases, related = _pick_troubles(t_raws, kws, cfg['analysis_model_cases'])
    workers = _worker_map([c.id for c in cases])
    lines.append(f'\n[4. 모델 대표 트러블 사례 {len(cases)}건 (증상 관련 우선, 이후 최근순)]')
    for c in cases:
        lines += _format_case(ctx, c, workers, c._unique_id in related, 120, 150)

    # 5) 이상 장비 상세
    if target is not None:
        tok = ctx.masker.eq_token(target)
        tt_raws, tl_raws, ti_raws = raws_of(T, {target.id}), raws_of(L, {target.id}), raws_of(I, {target.id})
        t_total = sum(per_eq.get(r, 0) for r in tt_raws)
        avg = len(rows) / len(m_equips)
        rank = 1 + sum(1 for k, v in per_eq.items() if v > t_total and k not in tt_raws)
        lines.append(f'\n[5. 이상 장비 {tok} 상세]')
        lines.append(f'- 상태 {target.equip_status or "-"} | 납품 {target.delivery_date or "-"} | '
                     f'보증 {target.warranty_start or "-"} ({target.warranty_period or "-"})')
        if target.special_note:
            lines.append(f'- 특이사항: {_t(target.special_note, 200)}')
        rank_text = f', 모델 내 {rank}위/{len(m_equips)}대' if t_total else ''
        lines.append(f'- 트러블 {t_total}건 (모델 평균 {avg:.1f}건{rank_text})')
        e_cases, e_related = _pick_troubles(tt_raws, kws, cfg['analysis_equip_troubles'])
        e_workers = _worker_map([c.id for c in e_cases])
        lines.append(f'- 트러블 이력 {len(e_cases)}건:')
        for c in e_cases:
            lines += _format_case(ctx, c, e_workers, c._unique_id in e_related, 200, 300)
        if tl_raws:
            base = L.query.options(defer(L.image_data)).filter(L.equip_id.in_(tl_raws))
            logs = base.filter(L.status != '작업예정').order_by(_log_eff_date().desc()) \
                .limit(cfg['analysis_equip_logs']).all()
            lines.append(f'- 최근 작업 이력 {len(logs)}건 (날짜|구분|내용|메모|작업자):')
            for g in logs:
                kind = '/'.join(x for x in [g.type, g.detail_type, g.detail_type2, g.detail_type3] if x) or '-'
                lines.append(f'  {g.date or g.scheduled_date or "-"}|{kind}|{_t(g.content, 80)}|'
                             f'{_t(g.memo, 60) or "-"}|{g.worker or "-"}')
            for g in base.filter(L.status == '작업예정').order_by(L.scheduled_date.asc()).limit(3).all():
                lines.append(f'  예정 {g.scheduled_date or g.date}|{g.type}/{g.detail_type}')
        if ti_raws:
            parts = I.query.filter(I.equip_id.in_(ti_raws)).order_by(I.date.desc()).limit(15).all()
            lines.append('- 등록/교체 물품: ' + ', '.join(
                f'{p.code or p.part}({p.date or "-"}, 주기 {p.cycle or "-"})' for p in parts))

    ctx_text = '\n'.join(lines)
    if len(ctx_text) > cfg['analysis_context_chars']:
        ctx_text = ctx_text[:cfg['analysis_context_chars']] + '\n…(데이터가 길어 일부 생략)'
    return ctx_text, target is not None


def build_analysis_prompt():
    return (
        f"너는 위드텍(WITHTECH) 설비 트러블 분석 엔지니어다. 오늘은 {datetime.now().strftime('%Y-%m-%d')}이다.\n"
        "규칙:\n"
        "1. [분석 데이터]만 근거로 판단하고, 근거가 된 사례의 날짜와 장비를 함께 적는다. 데이터에 없는 내용은 '(일반 가이드)'로 구분한다.\n"
        "2. [SITE_1], [EQ_2] 같은 대괄호 토큰은 보안상 가린 실제 값이다. 그대로 쓰고 추측하지 않는다.\n"
        "3. 장비는 [EQ_n] 토큰만 쓰고 뒤에 모델명을 괄호로 붙이지 않는다.\n"
        "4. 증상이 주어지면 ★증상관련 사례를 중심으로 보되, 모델 전체 트러블 경향도 함께 분석한다.\n"
        "5. 모델 공통 문제는 따로 표기하지 않는다. 이상 장비에만 해당하는 개별 문제 가능성이 있을 때만 "
        "해당 항목 앞에 **[개별 장비 문제 가능성]** 을 붙이고 근거를 쓴다.\n"
        "6. 트러블 이력이 거의 없으면 그 사실을 먼저 밝히고 일반 가이드는 짧게 쓴다.\n"
        "7. 한국어 높임말, 마크다운 개조식. 각 섹션은 핵심 3~4개 항목, 항목은 1~2문장으로 쓰고 "
        "'확인 항목:', '근거:' 같은 소제목은 같은 줄에 이어 쓴다. 전체 1,500자 내외. 아래 순서를 지킨다.\n"
        "## 1. 관련 이력 요약\n## 2. 추정 원인 (가능성 높은 순)\n## 3. 권장 조치 순서\n## 4. 예방 방안 (점검 주기·확인 항목)"
    )


def run_analysis(user, model, equip_id, symptom, session_id, question_text):
    cfg = get_config()
    if not cfg['api_key']:
        raise ChatAPIError('AI API 키(CHAT_API_KEY)가 설정되지 않았습니다. 서버 환경설정을 확인해 주세요.')
    masker = Masker(cfg['mask_model'])
    ctx = ToolContext(user, masker)
    ctx_text, has_equip = build_analysis_context(ctx, model, equip_id, symptom, cfg)
    masked_ctx = masker.mask(ctx_text)

    req_parts = ['선택한 모델의 장비 문제 원인을 분석해 주세요.']
    if has_equip:
        req_parts.append('이상 장비로 선택한 장비의 이력도 자세히 분석해 주세요.')
    if symptom:
        req_parts.append(f'현재 증상: {symptom}')
    req_text = masker.mask('\n'.join(req_parts))
    user_text = f"[분석 데이터]\n{masked_ctx}\n\n[요청]\n{req_text}"

    system = build_analysis_prompt()
    acfg = dict(cfg, max_output_tokens=cfg['analysis_max_output_tokens'])
    chat = (GeminiChat if cfg['api_type'] == 'gemini' else OpenAIChat)(acfg, system, [])
    chat.add_text('user', user_text)

    request_id = uuid.uuid4().hex[:16]
    rounds, error, answer, truncated = [], None, '', False
    t0 = time.time()
    try:
        reply = chat.send(allow_tools=False)
        rounds.append({
            'round_no': 1, 'usage': reply.usage, 'latency_ms': int((time.time() - t0) * 1000),
            'chars': {'system': len(system), 'tools_decl': 0, 'history': 0,
                      'question': len(req_text), 'tool_results': len(masked_ctx)},
            'tools': [{'name': 'analysis_context', 'chars': len(masked_ctx)}],
        })
        answer = masker.unmask(reply.text) if reply.text else ''
        truncated = reply.truncated
    except ChatAPIError as e:
        error = str(e)
    if truncated and answer:
        answer += '\n\n_(답변 길이 제한으로 일부가 잘렸습니다. 이어서 질문해 주세요.)_'
    if not answer and not error:
        error = 'AI 가 답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    _save_usage(user.id, session_id, request_id, question_text, cfg, rounds, error, mode='analysis')

    total = {k: sum(r['usage'].get(k, 0) for r in rounds) for k in ('prompt', 'output', 'thoughts', 'cached', 'total')}
    summary = {'request_id': request_id, 'api_calls': len(rounds), 'tools': ['analysis_context'] if rounds else [],
               'mode': 'analysis', **total}
    D.app.logger.info(f"[AI Chat] user={user.id} req={request_id} mode=analysis calls={len(rounds)} "
                      f"ctx_chars={len(masked_ctx)} in={total['prompt']} out={total['output']} "
                      f"think={total['thoughts']} err={bool(error)}")
    return answer, error, summary


def _trouble_count_by_equip(ctx):
    T = D.TroubleLog
    out = {}
    for raw, cnt in D.db.session.query(T.equip_id, func.count()).group_by(T.equip_id):
        eq = ctx.raw_index(T).get(raw)
        if eq is not None:
            out[eq.id] = out.get(eq.id, 0) + cnt
    return out


def list_guide_models(ctx):
    t_cnt = _trouble_count_by_equip(ctx)
    per_model = {}
    for e in ctx.equips:
        name = (e.name or '').strip()
        if not name or name == '기타(ETC)':
            continue
        b = per_model.setdefault(_norm(name), {'model': name, 'equip_count': 0, 'trouble_count': 0})
        b['equip_count'] += 1
        b['trouble_count'] += t_cnt.get(e.id, 0)
    abbr = {_norm(m.name): m.abbr for m in D.EquipmentModel.query.all() if m.name and m.abbr}
    out = [dict(v, abbr=abbr.get(k, '')) for k, v in per_model.items()]
    out.sort(key=lambda x: x['model'].lower())
    return out


def list_guide_equipments(ctx, model):
    keys = ctx.resolve_models(model)
    t_cnt = _trouble_count_by_equip(ctx)
    eqs = [e for e in ctx.equips if _norm(e.name) in keys and (e.name or '').strip() != '기타(ETC)']
    out = [{'id': e.id, 'cust_equip_name': e.cust_equip_name or '', 'serial': e.serial or '',
            'site': e.site_name or '', 'status': e.equip_status or '', 'trouble_count': t_cnt.get(e.id, 0)}
           for e in eqs]
    out.sort(key=lambda x: (-x['trouble_count'], x['site'], x['cust_equip_name'] or x['serial']))
    return out


def list_guide_symptoms(ctx, model):
    T = D.TroubleLog
    keys = ctx.resolve_models(model)
    ids = {e.id for e in ctx.equips if _norm(e.name) in keys}
    raws = [r for r, e in ctx.raw_index(T).items() if e is not None and e.id in ids]
    if not raws:
        return []
    cnt = {}
    for col in (T.detail_type, T.detail_type2):
        for v, n in D.db.session.query(col, func.count()).filter(T.equip_id.in_(raws)).group_by(col):
            v = (v or '').strip()
            if v:
                cnt[v] = cnt.get(v, 0) + n
    return [{'label': k, 'count': v} for k, v in sorted(cnt.items(), key=lambda x: -x[1])[:12]]


# ------------------------------------------------------------------------------
# 8. DB 구조 점검 (기능 수정으로 컬럼이 바뀌면 챗봇이 잘못 읽는 문제를 조기 발견)
# ------------------------------------------------------------------------------
REQUIRED_COLUMNS = {
    'Equipment': ['id', 'site_name', 'name', 'serial', 'cust_equip_name', 'equip_status', 'delivery_date',
                  'warranty_start', 'warranty_period', 'building', 'floor', 'detail_loc', 'special_note'],
    'LogItem': ['id', 'equip_id', 'date', 'scheduled_date', 'type', 'detail_type', 'detail_type2', 'detail_type3',
                'content', 'add_work', 'worker', 'memo', 'status'],
    'TroubleLog': ['id', 'equip_id', 'occur_date', 'action_date', 'type', 'detail_type', 'detail_type2',
                   'detail_type3', 'situation', 'symptom', 'cause', 'measure', 'prevent', 'trouble_details', 'status'],
    'SetupDetail': ['equip_id', 'category', 'subcategory', 'content', 'start_date', 'date', 'completed', 'delay_reason'],
    'ItemLog': ['equip_id', 'date', 'code', 'part', 'spec', 'part_detail', 'cycle'],
    'ItemStock': ['site_group', 'site_name', 'code', 'part', 'spec', 'quantity', 'safety_quantity', 'grade'],
    'Site': ['name', 'group'],
    'EquipmentModel': ['name', 'abbr'],
}
EXPECTED_STATUS = {'LogItem': {'작업예정'}}
_SCHEMA_CACHE = {'at': 0.0, 'issues': None}


def check_schema(force=False):
    now = time.time()
    if not force and _SCHEMA_CACHE['issues'] is not None and now - _SCHEMA_CACHE['at'] < 600:
        return _SCHEMA_CACHE['issues']
    issues = []
    try:
        insp = sa_inspect(D.db.engine)
        for model_name, cols in REQUIRED_COLUMNS.items():
            Model = getattr(D, model_name)
            table = Model.__table__.name
            try:
                db_cols = {c['name'] for c in insp.get_columns(table)}
            except Exception:
                issues.append(f'{table} 테이블이 없습니다.')
                continue
            for c in cols:
                if not hasattr(Model, c):
                    issues.append(f'{model_name}.{c} 필드가 모델에서 사라졌습니다.')
                elif c not in db_cols:
                    issues.append(f'{table}.{c} 컬럼이 DB 에 없습니다.')
        for model_name, expected in EXPECTED_STATUS.items():
            Model = getattr(D, model_name)
            actual = {s for (s,) in D.db.session.query(Model.status).distinct() if s}
            if actual and not (expected & actual):
                issues.append(f'{model_name}.status 에 {expected} 값이 없습니다. 실제 값: {sorted(actual)}')
    except Exception as e:
        issues.append(f'구조 점검 실패: {e}')
    if issues:
        D.app.logger.warning(f'[AI Chat] DB 구조 점검 경고: {issues}')
    _SCHEMA_CACHE.update(at=now, issues=issues)
    return issues


# ------------------------------------------------------------------------------
# 9. 사용량 집계 (어디서 토큰이 많이 쓰였는지)
# ------------------------------------------------------------------------------
def build_usage_report(user_id, days):
    cfg = get_config()
    U = D.ChatUsage
    start = (datetime.now() - timedelta(days=days - 1)).strftime('%Y-%m-%d')
    today = datetime.now().strftime('%Y-%m-%d')
    rows = U.query.filter(U.user_id == user_id, U.date_str >= start).order_by(U.id.asc()).all()
    ok = [r for r in rows if r.status == 'ok']

    def tsum(rs, attr):
        return sum(getattr(r, attr) or 0 for r in rs)

    def cost(rs):
        if not (cfg['price_in'] or cfg['price_out']):
            return None
        p_in = tsum(rs, 'prompt_tokens') - tsum(rs, 'cached_tokens')
        p_cache = tsum(rs, 'cached_tokens')
        out = tsum(rs, 'output_tokens') + tsum(rs, 'thoughts_tokens')
        # 캐시 입력은 보통 정가의 25% 로 과금되어 근사 계산합니다.
        return round((p_in + p_cache * 0.25) / 1e6 * cfg['price_in'] + out / 1e6 * cfg['price_out'], 4)

    req_ids = list(dict.fromkeys(r.request_id for r in rows))
    today_rows = [r for r in rows if r.date_str == today]

    # 입력 구성(문자 수 기준) → 입력 토큰을 비율대로 나눠 추정
    comp_keys = [('system', 'chars_system', '시스템 지침'), ('tools_decl', 'chars_tools_decl', '도구 정의'),
                 ('history', 'chars_history', '이전 대화'), ('question', 'chars_question', '질문'),
                 ('tool_results', 'chars_tool_results', 'DB 조회 결과')]
    comp_tokens = {k: 0.0 for k, _, _ in comp_keys}
    for r in ok:
        chars = {k: (getattr(r, a) or 0) for k, a, _ in comp_keys}
        total_chars = sum(chars.values()) or 1
        for k in chars:
            comp_tokens[k] += (r.prompt_tokens or 0) * chars[k] / total_chars
    breakdown = [{'key': k, 'label': lbl, 'tokens': int(round(comp_tokens[k]))} for k, _, lbl in comp_keys]
    breakdown.append({'key': 'output', 'label': '답변 출력', 'tokens': tsum(ok, 'output_tokens')})
    breakdown.append({'key': 'thoughts', 'label': 'AI 사고(thinking)', 'tokens': tsum(ok, 'thoughts_tokens')})

    by_tool = {}
    for r in ok:
        try:
            det = json.loads(r.tool_detail or '[]')
        except ValueError:
            det = []
        if isinstance(det, list):
            for t in det:
                b = by_tool.setdefault(t.get('name', '?'), {'name': t.get('name', '?'), 'calls': 0, 'chars': 0})
                b['calls'] += 1
                b['chars'] += t.get('chars', 0)
    tools = sorted(by_tool.values(), key=lambda x: -x['chars'])
    for t in tools:
        t['avg_chars'] = int(t['chars'] / t['calls']) if t['calls'] else 0

    reqs = {}
    for r in rows:
        q = reqs.setdefault(r.request_id, {'request_id': r.request_id, 'question': r.question, 'date': r.date_str,
                                           'mode': getattr(r, 'mode', None) or 'chat',
                                           'time': r.created_at.strftime('%m-%d %H:%M') if r.created_at else r.date_str,
                                           'api_calls': 0, 'prompt': 0, 'output': 0, 'thoughts': 0, 'total': 0,
                                           'tools': [], 'error': ''})
        if r.status == 'ok':
            q['api_calls'] += 1
            q['prompt'] += r.prompt_tokens or 0
            q['output'] += r.output_tokens or 0
            q['thoughts'] += r.thoughts_tokens or 0
            q['total'] += r.total_tokens or 0
            try:
                det = json.loads(r.tool_detail or '[]')
                q['tools'] += [t.get('name') for t in det] if isinstance(det, list) else []
            except ValueError:
                pass
        else:
            try:
                q['error'] = (json.loads(r.tool_detail or '{}') or {}).get('error', '오류')
            except ValueError:
                q['error'] = '오류'
    top = sorted(reqs.values(), key=lambda x: -x['total'])[:10]
    recent = list(reqs.values())[-20:][::-1]

    daily = {}
    for r in ok:
        d = daily.setdefault(r.date_str, {'date': r.date_str, 'requests': set(), 'api_calls': 0, 'total': 0})
        d['requests'].add(r.request_id)
        d['api_calls'] += 1
        d['total'] += r.total_tokens or 0
    daily_list = [{'date': d['date'], 'requests': len(d['requests']), 'api_calls': d['api_calls'], 'total': d['total']}
                  for d in sorted(daily.values(), key=lambda x: x['date'], reverse=True)]

    n_req = len([1 for q in reqs.values() if q['api_calls']])

    # 모드별 (원인 분석 / 직접 입력) 비중
    by_mode = {}
    for r in ok:
        m = getattr(r, 'mode', None) or 'chat'
        b = by_mode.setdefault(m, {'mode': m, 'requests': set(), 'api_calls': 0, 'total': 0, 'rows': []})
        b['requests'].add(r.request_id)
        b['api_calls'] += 1
        b['total'] += r.total_tokens or 0
        b['rows'].append(r)
    all_tokens = sum(b['total'] for b in by_mode.values()) or 1
    modes = []
    for m in ('analysis', 'chat'):
        if m in by_mode:
            b = by_mode[m]
            n = len(b['requests'])
            modes.append({'mode': m, 'label': '원인 분석' if m == 'analysis' else '직접 입력', 'requests': n,
                          'api_calls': b['api_calls'], 'total': b['total'],
                          'avg_tokens': int(b['total'] / n) if n else 0,
                          'share': round(b['total'] / all_tokens * 100, 1), 'cost': cost(b['rows'])})

    return {
        'status': 'success',
        'days': days,
        'config': {
            'api_type': cfg['api_type'], 'model': cfg['model'], 'max_tool_rounds': cfg['max_tool_rounds'],
            'history_turns': cfg['history_turns'], 'max_output_tokens': cfg['max_output_tokens'],
            'thinking_budget': cfg['thinking_budget'], 'daily_limit': cfg['daily_limit'],
            'price_set': bool(cfg['price_in'] or cfg['price_out']), 'mask_model': cfg['mask_model'],
        },
        'today': {
            'requests': len({r.request_id for r in today_rows if r.status == 'ok'}),
            'api_calls': len([r for r in today_rows if r.status == 'ok']),
            'errors': len([r for r in today_rows if r.status == 'error']),
            'total_tokens': tsum([r for r in today_rows if r.status == 'ok'], 'total_tokens'),
            'cost': cost([r for r in today_rows if r.status == 'ok']),
        },
        'period': {
            'requests': n_req,
            'api_calls': len(ok),
            'prompt_tokens': tsum(ok, 'prompt_tokens'),
            'output_tokens': tsum(ok, 'output_tokens'),
            'thoughts_tokens': tsum(ok, 'thoughts_tokens'),
            'cached_tokens': tsum(ok, 'cached_tokens'),
            'total_tokens': tsum(ok, 'total_tokens'),
            'avg_tokens_per_request': int(tsum(ok, 'total_tokens') / n_req) if n_req else 0,
            'avg_calls_per_request': round(len(ok) / n_req, 2) if n_req else 0,
            'cost': cost(ok),
        },
        'breakdown': breakdown,
        'modes': modes,
        'tools': tools,
        'top_requests': top,
        'recent_requests': recent,
        'daily': daily_list,
        'schema_issues': check_schema(),
        'request_count_all': len(req_ids),
    }


# ------------------------------------------------------------------------------
# 10. 라우트 등록
# ------------------------------------------------------------------------------
def init_chatbot(app, db, limiter, login_required, models, db_type, get_equip_data_table_name):
    D.app = app
    D.db = db
    D.db_type = db_type
    D.get_equip_data_table_name = get_equip_data_table_name
    for k, v in models.items():
        setattr(D, k, v)

    def forbidden():
        return jsonify({'status': 'fail', 'message': '챗봇 사용 권한이 없습니다.'}), 403

    @app.context_processor
    def _inject_chatbot_flag():
        return {'chatbot_enabled': chatbot_allowed_for(session.get('role'))}

    def precheck():
        """질문 요청 공통 검사: 권한·연속 클릭·계정 잠금·일일 한도. (user, 오류응답) 반환"""
        if not chatbot_allowed_for(session.get('role')):
            return None, forbidden()
        now = datetime.now()
        last = session.get('last_chat_time')
        if last:
            try:
                if (now - datetime.fromisoformat(last)).total_seconds() < 1.5:
                    return None, (jsonify({'status': 'fail', 'message': '요청이 너무 빠릅니다. 잠시 후 다시 전송해주세요.'}), 429)
            except (ValueError, TypeError):
                pass
        session['last_chat_time'] = now.isoformat()

        user = D.User.query.filter_by(id=session.get('user_id')).first()
        if not user:
            return None, (jsonify({'status': 'fail', 'message': '세션 정보가 유효하지 않습니다.'}), 401)
        if user.lockout_until and user.lockout_until > now:
            return None, (jsonify({'status': 'fail', 'message': '해당 계정은 현재 잠금 상태입니다.'}), 403)

        cfg = get_config()
        if cfg['daily_limit'] > 0:
            U = D.ChatUsage
            used = (db.session.query(func.count(func.distinct(U.request_id)))
                    .filter(U.user_id == user.id, U.date_str == now.strftime('%Y-%m-%d')).scalar() or 0)
            if used >= cfg['daily_limit']:
                return None, (jsonify({'status': 'fail',
                                       'message': f"오늘 챗봇 질문 한도({cfg['daily_limit']}회)를 모두 사용했습니다."}), 429)
        return user, None

    def run_safely(fn, *args):
        try:
            return fn(*args)
        except ChatAPIError as e:
            return '', str(e), None
        except ToolError as e:
            return '', str(e), None
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'[AI Chat] 처리 오류: {e}', exc_info=True)
            return '', '요청을 처리하는 중 서버 오류가 발생했습니다. 관리자에게 문의하세요.', None

    def save_history(user, session_id, question, reply, title):
        H = D.ChatHistory
        today = datetime.now().strftime('%Y-%m-%d')
        db.session.add(H(user_id=user.id, sender='user', message=question, date_str=today,
                         session_id=session_id, title=title))
        db.session.add(H(user_id=user.id, sender='ai', message=reply, date_str=today,
                         session_id=session_id, title=title))
        db.session.commit()

    def save_and_respond(user, session_id, question, answer, error, usage):
        reply = answer if not error else f'⚠️ {error}'
        title = ''
        try:
            H = D.ChatHistory
            first = H.query.filter_by(user_id=user.id, session_id=session_id).order_by(H.id.asc()).first()
            title = first.title if first and first.title else _t(question.split('\n')[0], 40) or '대화 내용'
            save_history(user, session_id, question, reply, title)
        except Exception as e:
            db.session.rollback()
            # 테이블이 utf8mb3 라 이모지 등 4바이트 문자를 못 넣는 경우를 대비해 제거 후 한 번 더 저장
            try:
                save_history(user, session_id, _strip_4byte(question), _strip_4byte(reply), _strip_4byte(title))
                app.logger.warning(f'[AI Chat] 대화 기록을 4바이트 문자 제거 후 저장했습니다 (원인: {e})')
            except Exception as e2:
                db.session.rollback()
                app.logger.error(f'[AI Chat] 대화 기록 저장 실패: {e2}')
        return jsonify({'status': 'success' if not error else 'fail', 'reply': reply, 'message': reply,
                        'session_id': session_id, 'title': title, 'usage': usage})

    def get_session_id(data):
        # 새 대화 기능 없이 하루 = 대화 1개로 관리합니다.
        return f"day_{datetime.now().strftime('%Y-%m-%d')}"

    @app.route('/api/chat', methods=['POST'])
    @login_required
    @limiter.limit('20 per minute')
    def ai_chatbot():
        data = request.json or {}
        question = str(data.get('message', '')).strip()
        if not question:
            return jsonify({'status': 'fail', 'message': '질문 내용이 비어있습니다.'}), 400
        if len(question) > 500:
            return jsonify({'status': 'fail', 'message': '질문 길이는 최대 500자 이하로 제한됩니다.'}), 400
        user, err = precheck()
        if err:
            return err
        session_id = get_session_id(data)
        answer, error, usage = run_safely(run_agent, user, question, session_id)
        return save_and_respond(user, session_id, question, answer, error, usage)

    @app.route('/api/chat/analyze', methods=['POST'])
    @login_required
    @limiter.limit('10 per minute')
    def ai_chatbot_analyze():
        data = request.json or {}
        model = str(data.get('model', '')).strip()[:100]
        equip_id = str(data.get('equip_id', '')).strip()[:200]
        equip_label = str(data.get('equip_label', '')).strip()[:100]
        symptom = str(data.get('symptom', '')).strip()[:300]
        if not model:
            return jsonify({'status': 'fail', 'message': '모델을 선택해 주세요.'}), 400
        user, err = precheck()
        if err:
            return err
        session_id = get_session_id(data)
        question = (f"🔧 장비 문제 원인 파악\n- 모델: {model}\n"
                    f"- 이상 장비: {equip_label or ('선택됨' if equip_id else '선택 안 함 (모델 전체 분석)')}\n"
                    f"- 증상: {symptom or '입력 안 함 (트러블 전반 분석)'}")
        answer, error, usage = run_safely(run_analysis, user, model, equip_id or None, symptom, session_id, question)
        return save_and_respond(user, session_id, question, answer, error, usage)

    def guide_ctx():
        user = D.User.query.filter_by(id=session.get('user_id')).first()
        return ToolContext(user, Masker(get_config()['mask_model'])) if user else None

    @app.route('/api/chat/guide/models', methods=['GET'])
    @login_required
    def chat_guide_models():
        if not chatbot_allowed_for(session.get('role')):
            return forbidden()
        try:
            ctx = guide_ctx()
            return jsonify({'status': 'success', 'models': list_guide_models(ctx) if ctx else []})
        except Exception as e:
            app.logger.error(f'[AI Chat] 모델 목록 조회 실패: {e}')
            return jsonify({'status': 'fail', 'message': '모델 목록을 불러오지 못했습니다.'}), 500

    @app.route('/api/chat/guide/equipments', methods=['GET'])
    @login_required
    def chat_guide_equipments():
        if not chatbot_allowed_for(session.get('role')):
            return forbidden()
        model = request.args.get('model', '').strip()
        try:
            ctx = guide_ctx()
            return jsonify({'status': 'success',
                            'equipments': list_guide_equipments(ctx, model) if ctx else [],
                            'symptoms': list_guide_symptoms(ctx, model) if ctx else []})
        except ToolError as e:
            return jsonify({'status': 'fail', 'message': str(e)}), 400
        except Exception as e:
            app.logger.error(f'[AI Chat] 장비 목록 조회 실패: {e}')
            return jsonify({'status': 'fail', 'message': '장비 목록을 불러오지 못했습니다.'}), 500

    @app.route('/api/chat/enabled', methods=['GET'])
    @login_required
    def chat_enabled():
        return jsonify({'status': 'success', 'enabled': chatbot_allowed_for(session.get('role'))})

    @app.route('/api/chat/history', methods=['GET'])
    @login_required
    def get_chat_history():
        if not chatbot_allowed_for(session.get('role')):
            return forbidden()
        H = D.ChatHistory
        user_id = session.get('user_id')
        session_id = request.args.get('session_id', '').strip()
        try:
            if request.args.get('today'):
                # 챗봇 창 복원용: 오늘 대화 전체
                records = (H.query.filter_by(user_id=user_id, date_str=datetime.now().strftime('%Y-%m-%d'))
                           .order_by(H.id.asc()).all())
                return jsonify({'status': 'success', 'messages': [r.to_dict() for r in records]})
            if session_id:
                q = H.query.filter_by(user_id=user_id)
                if session_id.startswith('date_'):
                    q = q.filter(H.date_str == session_id[5:], or_(H.session_id == '', H.session_id.is_(None)))
                else:
                    q = q.filter_by(session_id=session_id)
                records = q.order_by(H.id.asc()).all()
                return jsonify({'status': 'success', 'session_id': session_id,
                                'messages': [r.to_dict() for r in records]})

            rows = (db.session.query(H.session_id, H.date_str, func.min(H.id), func.count(H.id),
                                     func.max(H.created_at), func.min(H.created_at))
                    .filter(H.user_id == user_id)
                    .group_by(H.session_id, H.date_str).all())
            sessions = {}
            for sid, d, first_id, cnt, last_at, first_at in rows:
                key = sid or f'date_{d}'
                s = sessions.setdefault(key, {'session_id': key, 'first_id': first_id, 'date': d,
                                              'message_count': 0, 'last_at': last_at, 'first_at': first_at})
                s['message_count'] += cnt
                s['first_id'] = min(s['first_id'], first_id)
                if last_at and (not s['last_at'] or last_at > s['last_at']):
                    s['last_at'] = last_at
                if first_at and (not s['first_at'] or first_at < s['first_at']):
                    s['first_at'] = first_at
            firsts = {r.id: r for r in H.query.filter(H.id.in_([s['first_id'] for s in sessions.values()] or [0]))}
            out = []
            for s in sessions.values():
                f = firsts.get(s['first_id'])
                title = (f.title if f and f.title else '') or (_t(f.message, 40) if f else '') or f"{s['date']} 대화"
                out.append({'session_id': s['session_id'], 'title': title, 'date': s['date'],
                            'created_at': s['first_at'].strftime('%Y-%m-%d %H:%M') if s['first_at'] else s['date'],
                            'sort_key': s['last_at'].isoformat() if s['last_at'] else s['date'],
                            'message_count': s['message_count']})
            out.sort(key=lambda x: x['sort_key'], reverse=True)
            return jsonify({'status': 'success', 'sessions': out})
        except Exception as e:
            app.logger.error(f'[AI Chat] 대화 기록 조회 실패: {e}')
            return jsonify({'status': 'fail', 'message': '대화 기록을 불러오지 못했습니다.'}), 500

    @app.route('/api/chat/history/delete', methods=['POST'])
    @login_required
    def delete_chat_history():
        if not chatbot_allowed_for(session.get('role')):
            return forbidden()
        H = D.ChatHistory
        user_id = session.get('user_id')
        data = request.json or {}
        session_id = str(data.get('session_id', '')).strip()
        try:
            if data.get('all'):
                H.query.filter_by(user_id=user_id).delete()
                msg = '모든 대화 기록이 삭제되었습니다.'
            elif session_id.startswith('date_'):
                H.query.filter(H.user_id == user_id, H.date_str == session_id[5:],
                               or_(H.session_id == '', H.session_id.is_(None))).delete(synchronize_session=False)
                msg = '해당 대화 기록이 삭제되었습니다.'
            elif session_id:
                H.query.filter_by(user_id=user_id, session_id=session_id).delete()
                msg = '해당 대화 기록이 삭제되었습니다.'
            else:
                return jsonify({'status': 'fail', 'message': '삭제할 대화가 지정되지 않았습니다.'}), 400
            db.session.commit()
            return jsonify({'status': 'success', 'message': msg})
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'[AI Chat] 대화 기록 삭제 실패: {e}')
            return jsonify({'status': 'fail', 'message': '대화 기록 삭제에 실패했습니다.'}), 500

    @app.route('/api/chat/usage', methods=['GET'])
    @login_required
    def get_chat_usage():
        if not chatbot_allowed_for(session.get('role')):
            return forbidden()
        days = _clamp_limit(request.args.get('days', 7), 7, hi=90)
        try:
            return jsonify(build_usage_report(session.get('user_id'), days))
        except Exception as e:
            app.logger.error(f'[AI Chat] 사용량 조회 실패: {e}', exc_info=True)
            return jsonify({'status': 'fail', 'message': '사용량을 불러오지 못했습니다.'}), 500
