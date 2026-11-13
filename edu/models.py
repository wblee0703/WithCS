"""교육(WITH Edu) DB 모델 — MySQL(운영) / SQLite(로컬) 공용.

app.py 의 db(SQLAlchemy) 객체를 받아 모델 클래스를 만든다 (순환 import 방지).
테이블 이름은 기존 테이블과 겹치지 않도록 모두 edu_ 로 시작한다.
"""
from datetime import datetime

CATEGORIES = [
    ("equipment", "설비 교육"),
    ("program", "프로그램 교육"),
    ("maintenance", "유지관리 교육"),
]
CAT_KEYS = [k for k, _ in CATEGORIES]

M = None  # define_models() 후 모델 클래스 묶음 (M.Model, M.Video, M.Version, M.Attachment)


def now():
    return datetime.now().replace(microsecond=0)


def fmt_dt(dt):
    return dt.strftime("%Y-%m-%d %H:%M") if dt else ""


class _Models:
    pass


def define_models(db):
    global M
    if M is not None:
        return M

    class EduModel(db.Model):
        __tablename__ = "edu_model"
        id = db.Column(db.Integer, primary_key=True, autoincrement=True)
        name = db.Column(db.String(200), nullable=False, unique=True)
        created_at = db.Column(db.DateTime, nullable=False, default=now)

    class EduVideo(db.Model):
        __tablename__ = "edu_video"
        id = db.Column(db.Integer, primary_key=True, autoincrement=True)
        model_id = db.Column(db.Integer, db.ForeignKey("edu_model.id", ondelete="CASCADE"),
                             nullable=False)
        category = db.Column(db.String(20), nullable=False)
        title = db.Column(db.String(300), nullable=False)
        description = db.Column(db.Text, nullable=False, default="")
        author = db.Column(db.String(100), nullable=False, default="")
        language = db.Column(db.String(50), nullable=False, default="")
        sort_order = db.Column(db.Integer, nullable=False, default=0)
        created_at = db.Column(db.DateTime, nullable=False, default=now)
        updated_at = db.Column(db.DateTime, nullable=False, default=now)
        __table_args__ = (db.Index("idx_edu_video_model", "model_id", "category", "sort_order"),)

    class EduVideoVersion(db.Model):
        __tablename__ = "edu_video_version"
        id = db.Column(db.Integer, primary_key=True, autoincrement=True)
        video_id = db.Column(db.Integer, db.ForeignKey("edu_video.id", ondelete="CASCADE"),
                             nullable=False, index=True)
        revision = db.Column(db.String(50), nullable=False)
        file_path = db.Column(db.String(300), nullable=False)      # 저장소 키 (예: videos/abc.mp4)
        thumb_path = db.Column(db.String(300), nullable=False, default="")
        duration_ms = db.Column(db.BigInteger, nullable=False, default=0)
        file_size = db.Column(db.BigInteger, nullable=False, default=0)
        original_name = db.Column(db.String(300), nullable=False, default="")
        note = db.Column(db.String(1000), nullable=False, default="")
        author = db.Column(db.String(100), nullable=False, default="")
        created_at = db.Column(db.DateTime, nullable=False, default=now)
        # 자동 압축 상태 (encoder.py): None(처리 전) | wait | work | done | skip | fail
        encode_state = db.Column(db.String(10), nullable=True)
        # 업로드한 원본 크기 (압축 후 file_size 는 압축본 크기로 바뀜 → 압축용 내려받기 전송량 계산에 사용)
        source_size = db.Column(db.BigInteger, nullable=True)
        encode_error = db.Column(db.String(300), nullable=True)      # 압축 실패 이유

    class EduAttachment(db.Model):
        __tablename__ = "edu_attachment"
        id = db.Column(db.Integer, primary_key=True, autoincrement=True)
        model_id = db.Column(db.Integer, db.ForeignKey("edu_model.id", ondelete="CASCADE"),
                             nullable=False, index=True)
        title = db.Column(db.String(300), nullable=False)
        file_path = db.Column(db.String(300), nullable=False)
        original_name = db.Column(db.String(300), nullable=False, default="")
        file_size = db.Column(db.BigInteger, nullable=False, default=0)
        created_at = db.Column(db.DateTime, nullable=False, default=now)

    class EduViewLog(db.Model):
        """영상 재생 기록 (서버가 영상 파일을 내줄 때 기록 → 주소를 직접 열어도 빠지지 않음)."""
        __tablename__ = "edu_view_log"
        id = db.Column(db.Integer, primary_key=True, autoincrement=True)
        video_id = db.Column(db.Integer, db.ForeignKey("edu_video.id", ondelete="CASCADE"),
                             nullable=False)
        version_id = db.Column(db.Integer, nullable=True)       # 버전이 삭제돼도 기록은 유지
        revision = db.Column(db.String(50), nullable=False, default="")
        user_id = db.Column(db.String(50), nullable=False, default="")
        user_name = db.Column(db.String(100), nullable=False, default="")
        created_at = db.Column(db.DateTime, nullable=False, default=now)
        __table_args__ = (db.Index("idx_edu_view_video", "video_id", "created_at"),
                          db.Index("idx_edu_view_user", "video_id", "user_id", "created_at"))

    M = _Models()
    M.db = db
    M.Model, M.Video, M.Version, M.Attachment = EduModel, EduVideo, EduVideoVersion, EduAttachment
    M.ViewLog = EduViewLog
    return M


def view_counts(video_ids):
    """{video_id: 재생 횟수}"""
    if not video_ids:
        return {}
    db = M.db
    rows = (db.session.query(M.ViewLog.video_id, db.func.count(M.ViewLog.id))
            .filter(M.ViewLog.video_id.in_(video_ids)).group_by(M.ViewLog.video_id).all())
    return {vid: n for vid, n in rows}


# ---------------------------------------------------------------- 조회 도우미
def latest_versions(video_ids):
    """{video_id: (최신 버전, 버전 수)}"""
    if not video_ids:
        return {}
    db = M.db
    rows = (db.session.query(M.Version.video_id, db.func.max(M.Version.id), db.func.count(M.Version.id))
            .filter(M.Version.video_id.in_(video_ids)).group_by(M.Version.video_id).all())
    latest_ids = {r[1]: (r[0], r[2]) for r in rows}
    out = {}
    for ver in M.Version.query.filter(M.Version.id.in_(list(latest_ids))).all():
        vid, cnt = latest_ids[ver.id]
        out[vid] = (ver, cnt)
    return out


def video_files(video_id):
    """영상의 모든 버전 파일 키 목록."""
    keys = []
    for ver in M.Version.query.filter_by(video_id=video_id).all():
        keys.append(ver.file_path)
        if ver.thumb_path:
            keys.append(ver.thumb_path)
    return keys


def model_files(model_id):
    """모델에 속한 모든 파일 키 (모든 버전 + 첨부자료)."""
    keys = []
    for v in M.Video.query.filter_by(model_id=model_id).all():
        keys.extend(video_files(v.id))
    keys.extend(a.file_path for a in M.Attachment.query.filter_by(model_id=model_id).all())
    return keys
