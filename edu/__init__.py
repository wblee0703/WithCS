"""교육(WITH Edu) 기능 패키지.

app.py 에서 한 번만 호출:
    from edu import init_edu
    init_edu(app, db, limiter, login_required, admin_required, User)
"""
import os

from sqlalchemy import inspect, text

from . import encoder
from . import models as em
from . import routes
from .storage import create_storage


def _add_missing_columns(db):
    """기존 테이블에 나중에 추가된 컬럼을 덧붙임 (MySQL / SQLite 공용)."""
    cols = {c["name"] for c in inspect(db.engine).get_columns("edu_video_version")}
    adds = {"encode_state": "VARCHAR(10) NULL", "source_size": "BIGINT NULL"}
    for name, ddl in adds.items():
        if name not in cols:
            with db.engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE edu_video_version ADD COLUMN {name} {ddl}"))


def init_edu(app, db, limiter, login_required, admin_required, User=None, SystemLog=None):
    M = em.define_models(db)

    routes.D.login_required = login_required
    routes.D.admin_required = admin_required
    routes.D.User = User
    routes.D.SystemLog = SystemLog
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    routes.D.storage = create_storage(root)

    # 영상 재생(Range 요청)과 업로드 조각은 요청 수가 많으므로 기본 요청 제한에서 제외
    for view in (routes.api_files, routes.api_upload_chunk):
        limiter.exempt(view)

    app.register_blueprint(routes.bp)

    with app.app_context():
        try:
            tables = [M.Model.__table__, M.Video.__table__, M.Version.__table__,
                      M.Attachment.__table__, M.ViewLog.__table__]
            db.metadata.create_all(bind=db.engine, tables=tables)
            _add_missing_columns(db)
        except Exception as e:  # noqa: BLE001
            app.logger.error(f"[Edu] 테이블 생성 실패: {e}")

    encoder.setup(app, routes.D.storage, os.path.join(root, "data", "edu_tmp"))

    app.logger.info(f"[Edu] 교육 메뉴 활성화 (저장소: {routes.D.storage.name})")
    return M
