"""교육(WITH Edu) API — /api/edu/...

권한
  - 조회/재생 : 로그인 사용자 (login_required)
  - 등록/수정/삭제, 재생 기록, 저장소 현황 : 최종관리자만 (role = superadmin, EDU_MANAGER_ROLES)

업로드 흐름 (저장소 종류와 상관없이 화면 코드는 동일)
  1) POST /api/edu/uploads {kind, name, size}
       → {key, mode: "server", chunk_size}  또는  {key, mode: "direct", url, headers}
  2-a) server : PUT /api/edu/uploads/<key>?offset=N  (조각 본문) 반복
                POST /api/edu/uploads/<key>/complete
  2-b) direct : 브라우저가 url 로 PUT (클라우드 Presigned URL)
  3) 영상/버전/첨부 등록 API 에 key 전달 → 서버가 실제 저장 여부와 크기 확인 후 DB 기록
"""
import io
import os
import threading
import time
from datetime import timedelta
from functools import wraps

from flask import Blueprint, jsonify, redirect, request, send_file, session, current_app
from sqlalchemy.exc import IntegrityError

from . import models as em
from . import encoder
from . import storage as st
from .models import CATEGORIES, CAT_KEYS, fmt_dt, now

bp = Blueprint("edu", __name__, url_prefix="/api/edu")
CAT_NAME = dict(CATEGORIES)

DEFAULT_LANGUAGES = ["한국어", "English", "中文"]
TEMPLATE_XLSX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "모델목록_양식.xlsx")
UPLOAD_CHUNK = 8 * 1024 * 1024          # 서버 경유 업로드 조각 크기 (프록시 본문 제한 회피)
MAX_CHUNK = 16 * 1024 * 1024
PENDING_MAX_AGE = 6 * 3600              # 등록되지 않은 업로드 파일 보관 시간


class _Deps:
    storage = None
    login_required = None
    admin_required = None
    User = None
    SystemLog = None


D = _Deps()


# ---------------------------------------------------------------- 공통
class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


@bp.errorhandler(ApiError)
def _api_error(e):
    return jsonify({"status": "fail", "message": e.message}), e.status


def ok(**data):
    return jsonify({"status": "success", **data})


def need_login(f):
    @wraps(f)
    def w(*a, **k):
        return D.login_required(f)(*a, **k)
    return w


# EDU 관리(모델·영상·첨부 추가/수정/삭제, 재생 기록, 저장소 현황)는 최종관리자만.
# 일반 계정·관리자는 영상 시청과 첨부자료 열기/내려받기만 가능 (내부 자료 보호)
EDU_MANAGER_ROLES = ("superadmin",)


def is_admin():
    return session.get("role") in EDU_MANAGER_ROLES


def need_admin(f):
    @wraps(f)
    def checked(*a, **k):
        if not is_admin():
            raise ApiError(403, "최종관리자만 사용할 수 있는 기능입니다.")
        return f(*a, **k)

    @wraps(f)
    def w(*a, **k):
        return D.login_required(checked)(*a, **k)   # 로그인·세션 확인은 사이트 공통 규칙 그대로
    return w


def clean(s, limit=2000):
    return str(s or "").strip()[:limit]


def body():
    return request.get_json(silent=True) or {}


def to_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def user_name():
    uid = session.get("user_id")
    try:
        u = em.M.db.session.get(D.User, uid) if D.User else None
        return (u.name if u and getattr(u, "name", None) else uid) or ""
    except Exception:  # noqa: BLE001
        return uid or ""


def get_or_404(cls, id_, msg):
    obj = em.M.db.session.get(cls, id_)
    if not obj:
        raise ApiError(404, msg)
    return obj


def commit():
    try:
        em.M.db.session.commit()
    except Exception:
        em.M.db.session.rollback()
        raise


# ---------------------------------------------------------------- 기록 (시스템 로그 / 재생 기록)
VIEW_DEDUP_MIN = 30          # 같은 사람이 같은 영상(버전)을 이 시간 안에 다시 열면 1회로 계산
_dl_lock = threading.Lock()
_dl_recent = {}              # (user, key) -> 시각 : 첨부 다운로드 중복 기록 방지


def audit(action, target, details=""):
    """시스템 로그(📜)에 교육 메뉴 작업 기록. 실패해도 본 작업은 계속."""
    if not D.SystemLog:
        return
    db = em.M.db
    try:
        db.session.add(D.SystemLog(action=action[:50], target=str(target or "")[:100],
                                   details=str(details or "")[:2000], worker=user_name()[:100]))
        db.session.commit()
    except Exception as e:  # noqa: BLE001
        db.session.rollback()
        current_app.logger.error(f"[Edu] 시스템 로그 기록 실패: {e}")


def _first_request():
    """영상 탐색(중간 구간 요청)이 아니라 처음 여는 요청인지."""
    rng = request.headers.get("Range", "").replace(" ", "")
    return not rng or rng.startswith("bytes=0-")


def record_view(key):
    """영상 파일 요청 시 재생 기록. 실패해도 재생은 계속."""
    M = em.M
    db = M.db
    try:
        ver = M.Version.query.filter_by(file_path=key).first()
        if not ver:
            return
        uid = session.get("user_id") or ""
        since = now() - timedelta(minutes=VIEW_DEDUP_MIN)
        dup = (M.ViewLog.query.filter(M.ViewLog.video_id == ver.video_id, M.ViewLog.user_id == uid,
                                      M.ViewLog.version_id == ver.id, M.ViewLog.created_at >= since)
               .first())
        if dup:
            return
        db.session.add(M.ViewLog(video_id=ver.video_id, version_id=ver.id, revision=ver.revision,
                                 user_id=uid[:50], user_name=user_name()[:100], created_at=now()))
        db.session.commit()
    except Exception as e:  # noqa: BLE001
        db.session.rollback()
        current_app.logger.error(f"[Edu] 재생 기록 실패: {e}")


def record_download(key, name):
    uid = session.get("user_id") or ""
    t = time.time()
    with _dl_lock:
        for k in [k for k, v in _dl_recent.items() if t - v > 60]:
            _dl_recent.pop(k, None)
        if (uid, key) in _dl_recent:
            return
        _dl_recent[(uid, key)] = t
    audit("EDU_OPEN_FILE", name or key, f"교육 첨부자료 열람/다운로드: {name or key}")


# ---------------------------------------------------------------- 업로드 대기 목록
class _Pending:
    """업로드했지만 아직 DB 에 등록되지 않은 파일. 아무 키나 등록되지 않도록 확인용."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}   # key -> {"t": 시각, "user": 사용자, "done": 완료여부}

    def add(self, key, done):
        with self.lock:
            self.items[key] = {"t": time.time(), "user": session.get("user_id"), "done": done}

    def get(self, key):
        with self.lock:
            it = self.items.get(key)
            return dict(it) if it and it["user"] == session.get("user_id") else None

    def mark_done(self, key):
        with self.lock:
            if key in self.items:
                self.items[key]["done"] = True

    def pop(self, key):
        with self.lock:
            return self.items.pop(key, None)

    def purge_stale(self):
        cut = time.time() - PENDING_MAX_AGE
        with self.lock:
            old = [k for k, v in self.items.items() if v["t"] < cut]
            for k in old:
                self.items.pop(k, None)
        for k in old:
            D.storage.abort_upload(k)


PENDING = _Pending()


def take_upload(key, kind, required=True):
    """등록 API 에서 업로드 파일 확인. (key, size) 반환. 실패 시 ApiError."""
    key = clean(key, 300)
    if not key:
        if required:
            raise ApiError(400, "파일을 올려 주세요.")
        return "", 0
    it = PENDING.get(key)
    if not it or not st.valid_key(key, kind):
        raise ApiError(400, "업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.")
    if not it["done"] and not D.storage.direct_upload:
        raise ApiError(400, "업로드가 끝나지 않았습니다.")
    size = D.storage.size(key)
    if size is None:
        raise ApiError(400, "업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.")
    PENDING.pop(key)
    return key, size


# ---------------------------------------------------------------- JSON 변환
def model_json(m):
    return {"id": m.id, "name": m.name, "created_at": fmt_dt(m.created_at)}


def file_urls(d):
    d["file_url"] = D.storage.file_url(d["file_path"])
    d["thumb_url"] = D.storage.file_url(d["thumb_path"]) if d.get("thumb_path") else ""
    return d


def version_json(ver):
    return file_urls({
        "id": ver.id, "version_id": ver.id, "video_id": ver.video_id, "revision": ver.revision,
        "file_path": ver.file_path, "thumb_path": ver.thumb_path or "",
        "duration_ms": ver.duration_ms or 0, "file_size": ver.file_size or 0,
        "original_name": ver.original_name or "", "note": ver.note or "",
        "author": ver.author or "", "created_at": fmt_dt(ver.created_at),
        "encoding": encoder.enabled() and ver.encode_state in encoder.PENDING_STATES,
        "encode_state": ver.encode_state or "",
        # 실패 이유(서버 정보 포함 가능)는 관리자에게만
        "encode_error": (ver.encode_error or "") if is_admin() else "",
    })


def video_json(v, latest=None, count=0, views=0):
    d = {
        "id": v.id, "model_id": v.model_id, "category": v.category, "title": v.title,
        "description": v.description or "", "author": v.author or "", "language": v.language or "",
        "sort_order": v.sort_order, "created_at": fmt_dt(v.created_at),
        "updated_at": fmt_dt(v.updated_at), "version_count": count, "view_count": views,
    }
    if latest is not None:
        lv = version_json(latest)
        for k in ("version_id", "revision", "file_path", "thumb_path", "duration_ms",
                  "file_size", "original_name", "file_url", "thumb_url", "encoding",
                  "encode_state", "encode_error"):
            d[k] = lv[k]
    return d


def videos_with_latest(videos):
    ids = [v.id for v in videos]
    lat = em.latest_versions(ids)
    views = em.view_counts(ids)
    return [video_json(v, *lat[v.id], views=views.get(v.id, 0)) for v in videos if v.id in lat]


def delete_files(keys):
    errors = D.storage.delete(keys)
    if errors:
        current_app.logger.warning(f"[Edu] 파일 삭제 실패: {errors}")
    return errors


# ================================================================= 상태
@bp.route("/status", methods=["GET"])
@need_login
def api_status():
    return ok(admin=is_admin(), user_name=user_name(), storage=D.storage.name,
              categories=[{"key": k, "name": n} for k, n in CATEGORIES])


# ================================================================= 모델
@bp.route("/models", methods=["GET"])
@need_login
def api_models():
    M = em.M
    q = clean(request.args.get("q"), 100)
    query = M.Model.query
    if q:
        query = query.filter(M.Model.name.ilike(f"%{q}%"))
    rows = query.order_by(M.db.func.lower(M.Model.name)).all()
    return ok(models=[{"id": m.id, "name": m.name} for m in rows], total=M.Model.query.count())


def _model_name_taken(name, exclude_id=None):
    M = em.M
    q = M.Model.query.filter(M.db.func.lower(M.Model.name) == name.lower())
    if exclude_id:
        q = q.filter(M.Model.id != exclude_id)
    return q.first() is not None


@bp.route("/models", methods=["POST"])
@need_admin
def api_model_add():
    M = em.M
    name = clean(body().get("name"), 200)
    if not name:
        raise ApiError(400, "모델명을 입력하세요.")
    if _model_name_taken(name):
        raise ApiError(400, f"'{name}' 모델이 이미 있습니다.")
    m = M.Model(name=name, created_at=now())
    M.db.session.add(m)
    try:
        commit()
    except IntegrityError:
        raise ApiError(400, f"'{name}' 모델이 이미 있습니다.")
    audit("EDU_ADD_MODEL", name, f"교육 설비 모델 추가: {name}")
    return ok(id=m.id)


@bp.route("/models/<int:mid>", methods=["GET"])
@need_login
def api_model(mid):
    M = em.M
    m = get_or_404(M.Model, mid, "모델을 찾을 수 없습니다.")
    rows = (M.db.session.query(M.Video.category, M.db.func.count(M.Video.id))
            .filter(M.Video.model_id == mid).group_by(M.Video.category).all())
    counts = {c: n for c, n in rows}
    att = M.Attachment.query.filter_by(model_id=mid).count()
    return ok(**model_json(m), counts={k: counts.get(k, 0) for k in CAT_KEYS},
              total=sum(counts.values()), attachments=att)


@bp.route("/models/<int:mid>", methods=["PUT"])
@need_admin
def api_model_rename(mid):
    M = em.M
    name = clean(body().get("name"), 200)
    if not name:
        raise ApiError(400, "모델명을 입력하세요.")
    m = get_or_404(M.Model, mid, "모델을 찾을 수 없습니다.")
    if _model_name_taken(name, exclude_id=mid):
        raise ApiError(400, f"'{name}' 모델이 이미 있습니다.")
    old = m.name
    m.name = name
    try:
        commit()
    except IntegrityError:
        raise ApiError(400, f"'{name}' 모델이 이미 있습니다.")
    audit("EDU_RENAME_MODEL", name, f"교육 설비 모델 이름 변경: {old} → {name}")
    return ok()


@bp.route("/models/<int:mid>", methods=["DELETE"])
@need_admin
def api_model_delete(mid):
    M = em.M
    m = get_or_404(M.Model, mid, "모델을 찾을 수 없습니다.")
    name = m.name
    files = em.model_files(mid)
    vids = [v.id for v in M.Video.query.filter_by(model_id=mid).all()]
    if vids:
        M.ViewLog.query.filter(M.ViewLog.video_id.in_(vids)).delete(synchronize_session=False)
        M.Version.query.filter(M.Version.video_id.in_(vids)).delete(synchronize_session=False)
    M.Video.query.filter_by(model_id=mid).delete(synchronize_session=False)
    M.Attachment.query.filter_by(model_id=mid).delete(synchronize_session=False)
    M.Model.query.filter_by(id=mid).delete(synchronize_session=False)
    commit()
    audit("EDU_DELETE_MODEL", name, f"교육 설비 모델 삭제: {name} (영상 {len(vids)}개 포함)")
    return ok(file_errors=delete_files(files))


@bp.route("/models/import-xlsx", methods=["POST"])
@need_admin
def api_models_import_preview():
    """엑셀(첫 시트 A열)에서 모델명 목록만 읽어서 돌려줌. 실제 등록은 /models/bulk."""
    f = request.files.get("file")
    if not f:
        raise ApiError(400, "엑셀 파일을 선택하세요.")
    data = f.read(20 * 1024 * 1024 + 1)
    if not data or len(data) > 20 * 1024 * 1024:
        raise ApiError(400, "엑셀 파일이 비어 있거나 너무 큽니다. (최대 20MB)")
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise ApiError(500, "서버에 openpyxl 이 설치되어 있지 않습니다.")
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        names = []
        for i, r in enumerate(ws.iter_rows(min_col=1, max_col=1, values_only=True)):
            v = r[0] if r else None
            if v is None:
                continue
            v = str(v).strip()
            if i == 0 and v.replace(" ", "").lower() in ("모델명", "모델", "설비모델", "model", "name"):
                continue
            if v:
                names.append(v[:200])
        wb.close()
    except Exception as e:  # noqa: BLE001
        raise ApiError(400, f"엑셀을 읽을 수 없습니다: {e}")
    return ok(names=names)


@bp.route("/models/bulk", methods=["POST"])
@need_admin
def api_models_bulk():
    M = em.M
    names = body().get("names") or []
    if not isinstance(names, list):
        raise ApiError(400, "잘못된 요청입니다.")
    existing = {n.lower() for (n,) in M.db.session.query(M.Model.name).all()}
    added = skipped = 0
    t = now()
    for n in names[:5000]:
        n = clean(n, 200)
        if not n:
            continue
        if n.lower() in existing:
            skipped += 1
            continue
        existing.add(n.lower())
        M.db.session.add(M.Model(name=n, created_at=t))
        added += 1
    commit()
    if added:
        audit("EDU_ADD_MODEL", f"{added}개", f"교육 설비 모델 엑셀 일괄 등록: {added}개 (중복 {skipped}개 제외)")
    return ok(added=added, skipped=skipped)


@bp.route("/template.xlsx", methods=["GET"])
@need_login
def api_template():
    if not os.path.isfile(TEMPLATE_XLSX):
        raise ApiError(404, "양식 파일이 없습니다.")
    return send_file(TEMPLATE_XLSX, as_attachment=True, download_name="모델목록_양식.xlsx",
                     max_age=0)


# ================================================================= 업로드
@bp.route("/uploads", methods=["POST"])
@need_admin
def api_upload_start():
    PENDING.purge_stale()
    d = body()
    kind = d.get("kind")
    if kind not in st.KINDS:
        raise ApiError(400, "잘못된 업로드 종류입니다.")
    if to_int(d.get("size")) <= 0:
        raise ApiError(400, "빈 파일입니다.")
    key = st.new_key(kind, clean(d.get("name"), 300))
    target = D.storage.upload_target(key, st.content_type(key))
    PENDING.add(key, done=False)
    if target:
        return ok(key=key, mode="direct", url=target["url"], headers=target.get("headers", {}))
    return ok(key=key, mode="server", chunk_size=UPLOAD_CHUNK)


def _pending_server_upload(key):
    if not st.valid_key(key) or not PENDING.get(key) or D.storage.direct_upload:
        raise ApiError(400, "업로드 정보를 찾을 수 없습니다. 다시 올려 주세요.")


@bp.route("/uploads/<path:key>", methods=["PUT"])
@need_admin
def api_upload_chunk(key):
    _pending_server_upload(key)
    length = request.content_length or 0
    if length <= 0 or length > MAX_CHUNK:
        raise ApiError(400, "잘못된 업로드 조각입니다.")
    try:
        size = D.storage.append_chunk(key, to_int(request.args.get("offset"), -1),
                                      request.stream, length)
    except ValueError as e:
        raise ApiError(400, str(e))
    return ok(size=size)


@bp.route("/uploads/<path:key>/complete", methods=["POST"])
@need_admin
def api_upload_complete(key):
    _pending_server_upload(key)
    try:
        size = D.storage.finish_upload(key)
    except ValueError as e:
        raise ApiError(400, str(e))
    PENDING.mark_done(key)
    return ok(key=key, size=size)


@bp.route("/uploads/<path:key>", methods=["DELETE"])
@need_admin
def api_upload_cancel(key):
    if st.valid_key(key) and PENDING.get(key):
        PENDING.pop(key)
        D.storage.abort_upload(key)
    return ok()


# ================================================================= 영상
@bp.route("/models/<int:mid>/videos", methods=["GET"])
@need_login
def api_videos(mid):
    M = em.M
    cat = request.args.get("category") or CAT_KEYS[0]
    if cat not in CAT_KEYS:
        raise ApiError(400, "잘못된 분류입니다.")
    q = M.Video.query.filter_by(model_id=mid, category=cat)
    lang = clean(request.args.get("lang"), 50)
    if lang:
        q = q.filter_by(language=lang)
    rows = q.order_by(M.Video.sort_order, M.Video.id).all()
    langs = [l for (l,) in M.db.session.query(M.Video.language).distinct()
             .filter(M.Video.model_id == mid, M.Video.category == cat, M.Video.language != "")
             .order_by(M.Video.language).all()]
    return ok(videos=videos_with_latest(rows), languages=langs)


@bp.route("/languages", methods=["GET"])
@need_login
def api_languages():
    M = em.M
    langs = [l for (l,) in M.db.session.query(M.Video.language).distinct()
             .filter(M.Video.language != "").order_by(M.Video.language).all()]
    return ok(languages=list(dict.fromkeys(DEFAULT_LANGUAGES + langs)))


def _video_fields(d):
    title = clean(d.get("title"), 300)
    if not title:
        raise ApiError(400, "제목을 입력하세요.")
    return dict(title=title, description=clean(d.get("description"), 5000),
                author=clean(d.get("author"), 100), language=clean(d.get("language"), 50))


def _take_video_files(d):
    """영상 + 썸네일 업로드 확인. 실패하면 이미 올린 파일 정리."""
    keys = [k for k in (clean(d.get("video_key"), 300), clean(d.get("thumb_key"), 300)) if k]
    try:
        vkey, vsize = take_upload(d.get("video_key"), "videos")
        tkey, _ = take_upload(d.get("thumb_key"), "thumbs", required=False)
        return vkey, vsize, tkey
    except ApiError:
        for k in keys:
            if PENDING.pop(k):
                D.storage.abort_upload(k)
        raise


@bp.route("/models/<int:mid>/videos", methods=["POST"])
@need_admin
def api_video_add(mid):
    M = em.M
    d = body()
    f = _video_fields(d)
    cat = d.get("category")
    if cat not in CAT_KEYS:
        raise ApiError(400, "잘못된 분류입니다.")
    get_or_404(M.Model, mid, "모델을 찾을 수 없습니다.")
    vkey, vsize, tkey = _take_video_files(d)
    f["author"] = f["author"] or user_name()
    try:
        t = now()
        order = (M.db.session.query(M.db.func.coalesce(M.db.func.max(M.Video.sort_order), 0))
                 .filter(M.Video.model_id == mid, M.Video.category == cat).scalar()) + 1
        v = M.Video(model_id=mid, category=cat, sort_order=order, created_at=t, updated_at=t, **f)
        M.db.session.add(v)
        M.db.session.flush()
        ver = M.Version(
            video_id=v.id, revision=clean(d.get("revision"), 50) or "Rev.1", file_path=vkey,
            thumb_path=tkey, duration_ms=max(0, to_int(d.get("duration_ms"))), file_size=vsize,
            original_name=clean(d.get("original_name"), 300), note="최초 등록",
            author=f["author"], created_at=t, encode_state="wait", source_size=vsize)
        M.db.session.add(ver)
        commit()
    except Exception:
        delete_files([vkey, tkey])
        raise
    encoder.enqueue(ver.id)
    audit("EDU_ADD_VIDEO", f["title"], f"교육 영상 등록: [{CAT_NAME.get(cat, cat)}] {f['title']}")
    return ok(id=v.id)


@bp.route("/videos/<int:vid>", methods=["PUT"])
@need_admin
def api_video_edit(vid):
    M = em.M
    f = _video_fields(body())
    v = get_or_404(M.Video, vid, "영상을 찾을 수 없습니다.")
    for k, val in f.items():
        setattr(v, k, val)
    v.updated_at = now()
    commit()
    audit("EDU_EDIT_VIDEO", f["title"], f"교육 영상 정보 수정: {f['title']}")
    return ok()


@bp.route("/videos/<int:vid>", methods=["DELETE"])
@need_admin
def api_video_delete(vid):
    M = em.M
    v = get_or_404(M.Video, vid, "영상을 찾을 수 없습니다.")
    title = v.title
    files = em.video_files(vid)
    M.ViewLog.query.filter_by(video_id=vid).delete(synchronize_session=False)
    M.Version.query.filter_by(video_id=vid).delete(synchronize_session=False)
    M.Video.query.filter_by(id=vid).delete(synchronize_session=False)
    commit()
    audit("EDU_DELETE_VIDEO", title, f"교육 영상 삭제: {title}")
    return ok(file_errors=delete_files(files))


@bp.route("/videos/<int:vid>/move", methods=["POST"])
@need_admin
def api_video_move(vid):
    """같은 분류 안에서 순서 이동. step=-1 앞으로, +1 뒤로."""
    M = em.M
    step = -1 if to_int(body().get("step"), 1) < 0 else 1
    v = get_or_404(M.Video, vid, "영상을 찾을 수 없습니다.")
    rows = (M.Video.query.filter_by(model_id=v.model_id, category=v.category)
            .order_by(M.Video.sort_order, M.Video.id).all())
    i = next(n for n, r in enumerate(rows) if r.id == vid)
    j = i + step
    if j < 0 or j >= len(rows):
        return ok(moved=False)
    rows[i], rows[j] = rows[j], rows[i]
    for order, r in enumerate(rows, 1):
        r.sort_order = order
    commit()
    return ok(moved=True)


@bp.route("/videos/<int:vid>/versions", methods=["GET"])
@need_login
def api_versions(vid):
    M = em.M
    v = get_or_404(M.Video, vid, "영상을 찾을 수 없습니다.")
    vers = M.Version.query.filter_by(video_id=vid).order_by(M.Version.id.desc()).all()
    if not vers:
        raise ApiError(404, "영상 파일이 없습니다.")
    return ok(video=video_json(v, vers[0], len(vers)), versions=[version_json(r) for r in vers])


@bp.route("/videos/<int:vid>/versions", methods=["POST"])
@need_admin
def api_version_add(vid):
    M = em.M
    d = body()
    rev = clean(d.get("revision"), 50)
    if not rev:
        raise ApiError(400, "버전(Rev.)을 입력하세요.")
    v = get_or_404(M.Video, vid, "영상을 찾을 수 없습니다.")
    vkey, vsize, tkey = _take_video_files(d)
    try:
        t = now()
        ver = M.Version(
            video_id=vid, revision=rev, file_path=vkey, thumb_path=tkey,
            duration_ms=max(0, to_int(d.get("duration_ms"))), file_size=vsize,
            original_name=clean(d.get("original_name"), 300), note=clean(d.get("note"), 1000),
            author=clean(d.get("author"), 100) or user_name(), created_at=t, encode_state="wait", source_size=vsize)
        M.db.session.add(ver)
        v.updated_at = t
        commit()
    except Exception:
        delete_files([vkey, tkey])
        raise
    encoder.enqueue(ver.id)
    audit("EDU_ADD_VERSION", v.title, f"교육 영상 새 버전 업로드: {v.title} {rev}")
    return ok()


@bp.route("/versions/<int:ver_id>", methods=["DELETE"])
@need_admin
def api_version_delete(ver_id):
    """이전 버전 삭제 (최신 버전은 삭제 불가)."""
    M = em.M
    ver = get_or_404(M.Version, ver_id, "버전을 찾을 수 없습니다.")
    latest = (M.db.session.query(M.db.func.max(M.Version.id))
              .filter(M.Version.video_id == ver.video_id).scalar())
    if latest == ver_id:
        raise ApiError(400, "최신 버전은 삭제할 수 없습니다.")
    files = [p for p in (ver.file_path, ver.thumb_path) if p]
    v = M.db.session.get(M.Video, ver.video_id)
    label = f"{v.title if v else ver.video_id} {ver.revision}"
    M.db.session.delete(ver)
    commit()
    audit("EDU_DELETE_VERSION", label, f"교육 영상 이전 버전 삭제: {label}")
    return ok(file_errors=delete_files(files))


@bp.route("/versions/<int:ver_id>/encode", methods=["POST"])
@need_admin
def api_version_reencode(ver_id):
    """압축 실패한 버전 다시 압축."""
    ver = get_or_404(em.M.Version, ver_id, "버전을 찾을 수 없습니다.")
    if not encoder.enabled():
        raise ApiError(400, "자동 압축이 꺼져 있습니다. (.env EDU_ENCODE)")
    if not encoder.retry(ver.id):
        raise ApiError(400, "실패한 영상만 다시 압축할 수 있습니다.")
    return ok()


@bp.route("/videos/<int:vid>/views", methods=["GET"])
@need_admin
def api_video_views(vid):
    """영상 재생 기록 (관리자 전용): 시각·사람·버전 목록 + 사람별 횟수."""
    M = em.M
    db = M.db
    v = get_or_404(M.Video, vid, "영상을 찾을 수 없습니다.")
    total = M.ViewLog.query.filter_by(video_id=vid).count()
    rows = (M.ViewLog.query.filter_by(video_id=vid).order_by(M.ViewLog.id.desc()).limit(1000).all())
    by_user = (db.session.query(M.ViewLog.user_id, db.func.max(M.ViewLog.user_name),
                                db.func.count(M.ViewLog.id), db.func.max(M.ViewLog.created_at))
               .filter(M.ViewLog.video_id == vid).group_by(M.ViewLog.user_id)
               .order_by(db.func.count(M.ViewLog.id).desc()).all())
    return ok(title=v.title, total=total, viewers=len(by_user), dedup_minutes=VIEW_DEDUP_MIN,
              by_user=[{"user_id": u, "user_name": n or u, "count": c, "last": fmt_dt(t)}
                       for u, n, c, t in by_user],
              logs=[{"created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S"), "user_id": r.user_id,
                     "user_name": r.user_name or r.user_id, "revision": r.revision} for r in rows])


# ================================================================= 첨부자료
@bp.route("/models/<int:mid>/attachments", methods=["GET"])
@need_login
def api_attachments(mid):
    M = em.M
    out = []
    for a in M.Attachment.query.filter_by(model_id=mid).order_by(M.Attachment.id).all():
        out.append({
            "id": a.id, "model_id": a.model_id, "title": a.title, "file_path": a.file_path,
            "original_name": a.original_name or "", "file_size": a.file_size or 0,
            "created_at": fmt_dt(a.created_at),
            "url": D.storage.file_url(a.file_path, a.original_name or a.title),
            "view_url": D.storage.file_url(a.file_path),
        })
    return ok(attachments=out)


@bp.route("/models/<int:mid>/attachments", methods=["POST"])
@need_admin
def api_attachment_add(mid):
    M = em.M
    d = body()
    get_or_404(M.Model, mid, "모델을 찾을 수 없습니다.")
    key, size = take_upload(d.get("file_key"), "attachments")
    name = clean(d.get("original_name"), 300)
    title = clean(d.get("title"), 300) or os.path.splitext(name)[0] or "첨부자료"
    try:
        M.db.session.add(M.Attachment(model_id=mid, title=title, file_path=key,
                                      original_name=name, file_size=size, created_at=now()))
        commit()
    except Exception:
        delete_files([key])
        raise
    audit("EDU_ADD_FILE", title, f"교육 첨부자료 등록: {title} ({name})")
    return ok()


@bp.route("/attachments/<int:att_id>", methods=["DELETE"])
@need_admin
def api_attachment_delete(att_id):
    M = em.M
    a = get_or_404(M.Attachment, att_id, "첨부자료를 찾을 수 없습니다.")
    files, title = [a.file_path], a.title
    M.db.session.delete(a)
    commit()
    audit("EDU_DELETE_FILE", title, f"교육 첨부자료 삭제: {title}")
    return ok(file_errors=delete_files(files))


# ================================================================= 파일 (영상/썸네일/첨부)
@bp.route("/files/<path:key>", methods=["GET"])
@need_login
def api_files(key):
    if not st.valid_key(key):
        raise ApiError(404, "파일을 찾을 수 없습니다.")
    if key in encoder.REPLACED:
        # 압축으로 파일이 교체되기 전에 재생을 시작한 화면 → 새 파일로 연결
        return redirect(D.storage.file_url(encoder.REPLACED[key]), code=302)
    download = clean(request.args.get("download"), 300) or None
    kind = key.split("/", 1)[0]
    if kind == "attachments":
        att = em.M.Attachment.query.filter_by(file_path=key).first()
        name = (att.original_name or att.title) if att else os.path.basename(key)
        # HTML·SVG 등 브라우저에서 실행될 수 있는 형식은 '열기'여도 다운로드로만 제공
        if not download and not st.inline_safe(key):
            download = name
        if _first_request():
            record_download(key, name)
    elif kind == "videos" and _first_request():
        record_view(key)
    resp = D.storage.serve(key, download)
    if resp is None:
        raise ApiError(404, "파일을 찾을 수 없습니다.")
    return resp


# ================================================================= 저장소 현황 (관리자)
USAGE_TTL = 60            # 저장소 파일 목록 조회 결과 재사용 시간(초). 새로고침 버튼은 즉시 조회
_usage_cache = {"t": 0.0, "data": None}
GB = 1024 ** 3


ORPHAN_MIN_AGE = 6 * 3600   # 이보다 오래된 파일만 정리 대상 (업로드 직후~등록 전 파일 보호)


def _orphans(objs):
    """DB 어디에도 연결되지 않은 파일 (압축 실패·업로드 중단 등으로 남은 것)."""
    M = em.M
    used = set()
    for a, b in M.db.session.query(M.Version.file_path, M.Version.thumb_path).all():
        used.update((a, b))
    used.update(r[0] for r in M.db.session.query(M.Attachment.file_path).all())
    with PENDING.lock:
        used.update(PENDING.items)
    cut = time.time() - ORPHAN_MIN_AGE
    return [o for o in objs if o["key"] not in used and o["mtime"] < cut]


@bp.route("/orphans/cleanup", methods=["POST"])
@need_admin
def api_orphans_cleanup():
    objs = D.storage.list_objects()
    orphans = _orphans(objs)
    errors = delete_files([o["key"] for o in orphans]) if orphans else []
    _usage_cache["t"] = 0.0
    size = sum(o["size"] for o in orphans)
    if orphans:
        audit("EDU_CLEAN_FILES", f"{len(orphans)}개",
              f"교육 저장소 미사용 파일 정리: {len(orphans)}개, {size / 1048576:.1f}MB")
    return ok(count=len(orphans), bytes=size, errors=errors)


def _env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@bp.route("/usage", methods=["GET"])
@need_admin
def api_usage():
    """저장 용량(저장소 실측) + 이번 달 재생 전송량(재생 기록 × 파일 크기 추정) + 예상 비용."""
    M = em.M
    db = M.db
    if request.args.get("refresh") == "1" or time.time() - _usage_cache["t"] > USAGE_TTL:
        try:
            objs = D.storage.list_objects()
            _usage_cache.update(data=st.summarize(objs), orphans=_orphans(objs),
                                t=time.time())
        except Exception as e:  # noqa: BLE001
            current_app.logger.error(f"[Edu] 저장소 용량 조회 실패: {e}")
            if _usage_cache["data"] is None:
                raise ApiError(502, "저장소 용량을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    files = _usage_cache["data"]
    orphans = _usage_cache.get("orphans") or []
    storage_bytes = sum(v["bytes"] for v in files.values())

    t = now()
    month_start = t.replace(day=1, hour=0, minute=0, second=0)
    next_month = (month_start + timedelta(days=32)).replace(day=1)
    days_in_month = (next_month - month_start).days
    rows = (db.session.query(M.ViewLog.created_at, M.Version.file_size)
            .outerjoin(M.Version, M.Version.id == M.ViewLog.version_id)
            .filter(M.ViewLog.created_at >= month_start).all())
    daily = {}
    for created, size in rows:
        d = daily.setdefault(created.strftime("%m-%d"), [0, 0])
        d[0] += 1
        d[1] += size or 0
    plays = len(rows)
    traffic = sum(d[1] for d in daily.values())
    elapsed = max(1.0, (t - month_start).total_seconds() / 86400)
    traffic_proj = traffic / elapsed * days_in_month
    today = daily.get(t.strftime("%m-%d"), [0, 0])

    # 자동 압축용 내려받기 (클라우드 → 서버). 이번 달 올린 영상의 원본 크기 합계
    enc_bytes = 0
    if D.storage.name == "s3" and encoder.enabled():
        enc_bytes = int(db.session.query(db.func.coalesce(db.func.sum(
            db.func.coalesce(M.Version.source_size, M.Version.file_size)), 0))
            .filter(M.Version.created_at >= month_start,
                    M.Version.encode_state.in_(("work", "done", "skip", "fail"))).scalar() or 0)

    p_store = _env_float("EDU_PRICE_STORAGE_GB", 28)   # NCP 요금 계산기 기준 (원/GB·월)
    p_traffic = _env_float("EDU_PRICE_TRAFFIC_GB", 100)  # 인터넷 전송 (원/GB)
    # 운영 서버가 NCP 밖이면 인터넷 단가(100), NCP 서버면 사설 통신 단가(20) 등으로 변경
    p_enc = _env_float("EDU_PRICE_ENCODE_GB", p_traffic)
    cost_store = storage_bytes / GB * p_store
    cost_enc = enc_bytes / GB * p_enc
    cost_now = cost_store + traffic / GB * p_traffic + cost_enc
    cost_proj = cost_store + traffic_proj / GB * p_traffic + cost_enc

    states = dict(db.session.query(M.Version.encode_state, db.func.count(M.Version.id))
                  .group_by(M.Version.encode_state).all())
    top = (db.session.query(M.Version, M.Video.title, M.Model.name)
           .join(M.Video, M.Video.id == M.Version.video_id)
           .join(M.Model, M.Model.id == M.Video.model_id)
           .order_by(M.Version.file_size.desc()).limit(10).all())
    return ok(
        storage=D.storage.name, bucket=getattr(D.storage, "bucket", ""),
        checked_at=time.strftime("%H:%M:%S", time.localtime(_usage_cache["t"])),
        files=files, storage_bytes=storage_bytes,
        counts={"models": M.Model.query.count(), "videos": M.Video.query.count(),
                "versions": sum(states.values()), "attachments": M.Attachment.query.count()},
        encode={"pending": sum(states.get(k, 0) for k in (None, "wait")), "working": states.get("work", 0),
                "done": states.get("done", 0), "skip": states.get("skip", 0), "fail": states.get("fail", 0)},
        month=t.strftime("%Y-%m"), plays=plays, traffic_bytes=traffic, traffic_proj_bytes=round(traffic_proj),
        today={"plays": today[0], "bytes": today[1]},
        daily=[{"day": k, "plays": v[0], "bytes": v[1]} for k, v in sorted(daily.items(), reverse=True)],
        encode_bytes=enc_bytes,
        price={"storage_gb": p_store, "traffic_gb": p_traffic, "encode_gb": p_enc},
        cost={"storage": round(cost_store), "play": round(traffic / GB * p_traffic),
              "play_projected": round(traffic_proj / GB * p_traffic), "encode": round(cost_enc),
              "now": round(cost_now), "projected": round(cost_proj)},
        orphans={"count": len(orphans), "bytes": sum(o["size"] for o in orphans),
                 "min_age_hours": ORPHAN_MIN_AGE // 3600},
        top=[{"model": mn, "title": title, "revision": ver.revision, "bytes": ver.file_size or 0,
              "state": ver.encode_state or ""} for ver, title, mn in top],
    )
