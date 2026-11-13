"""교육 영상 자동 압축 (업로드 후 서버가 백그라운드에서 처리).

흐름: 업로드 완료 → 원본으로 바로 재생 가능 → 백그라운드에서 H.264/AAC MP4 로 압축
      → 원본보다 충분히 작아졌을 때만 새 파일로 교체하고 원본 삭제.
  - 한 번에 1개씩, 낮은 우선순위로 실행 (사이트 응답 속도 보호)
  - 서버가 재시작돼도 끝나지 않은 영상은 다시 처리 (DB encode_state 로 관리)
  - 교체 중 재생 중이던 사용자는 옛 주소 → 새 주소로 자동 연결 (REPLACED)

encode_state: None(기존 영상, 처리 전) | wait | work | done | skip(줄어들지 않음) | fail

환경변수(.env, 모두 선택)
  EDU_ENCODE=on | off            (기본 on)
  EDU_ENCODE_MAX=720             (짧은 변 기준 최대 해상도: 720 → 1280x720)
  EDU_ENCODE_CRF=28              (화질. 낮을수록 고화질·대용량. 23~30 권장)
  EDU_ENCODE_THREADS=2           (압축에 쓸 CPU 코어 수)
  EDU_FFMPEG=<ffmpeg 경로>        (없으면 시스템 ffmpeg → imageio-ffmpeg 내장 파일 순서로 찾음)
"""
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time

from . import models as em
from . import storage as st

KEEP_RATIO = 0.9          # 원본의 90% 이상이면 교체하지 않음 (이미 압축된 영상)
TIMEOUT_SEC = 4 * 3600
PENDING_STATES = (None, "wait", "work")

REPLACED = {}             # 옛 파일 키 → 새 파일 키 (교체 직후 재생 중이던 화면 연결용)
_q = queue.Queue()
_lock = threading.Lock()
_started = False
_app = None
_storage = None
_tmp_root = None
_retry_delete = []        # 재생 중이라 바로 못 지운 원본 (Windows)


def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def enabled():
    return os.environ.get("EDU_ENCODE", "on").strip().lower() not in ("off", "0", "false", "no")


def ffmpeg_path():
    p = os.environ.get("EDU_FFMPEG") or shutil.which("ffmpeg")
    if p:
        return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return None


def setup(app, storage, tmp_root):
    """init_edu 에서 호출. 작업 스레드는 첫 요청 때 시작 (개발 서버 감시 프로세스에서 중복 실행 방지)."""
    global _app, _storage, _tmp_root
    _app, _storage, _tmp_root = app, storage, tmp_root

    @app.before_request
    def _edu_encoder_start():
        if not _started:
            start()


def start():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    if not enabled():
        _app.logger.info("[Edu] 영상 자동 압축 꺼짐 (EDU_ENCODE=off)")
        return
    if not ffmpeg_path():
        _app.logger.warning("[Edu] ffmpeg 를 찾지 못해 영상 자동 압축을 건너뜁니다. (pip install imageio-ffmpeg)")
        return
    threading.Thread(target=_worker, name="edu-encoder", daemon=True).start()


def enqueue(ver_id):
    if _started and enabled():
        _q.put(ver_id)


def _pending_ids():
    M = em.M
    # 이전 실행에서 중단된 작업(work)은 다시 대기 상태로
    M.Version.query.filter_by(encode_state="work").update({"encode_state": "wait"})
    M.db.session.commit()
    rows = (M.Version.query.with_entities(M.Version.id)
            .filter((M.Version.encode_state.is_(None)) | (M.Version.encode_state == "wait"))
            .order_by(M.Version.id.desc()).all())
    return [r[0] for r in rows]


def _worker():
    # 서버가 압축 도중 종료돼 남은 임시 폴더 정리
    if os.path.isdir(_tmp_root):
        for n in os.listdir(_tmp_root):
            if n.startswith("enc_"):
                shutil.rmtree(os.path.join(_tmp_root, n), ignore_errors=True)
    with _app.app_context():
        try:
            for vid in _pending_ids():
                _q.put(vid)
        except Exception as e:  # noqa: BLE001
            _app.logger.error(f"[Edu] 압축 대기 목록 조회 실패: {e}")
            em.M.db.session.rollback()
        finally:
            em.M.db.session.remove()
    while True:
        try:
            ver_id = _q.get(timeout=600)
        except queue.Empty:
            _retry_deletes()
            continue
        with _app.app_context():
            try:
                _process(ver_id)
            except Exception as e:  # noqa: BLE001
                _app.logger.error(f"[Edu] 영상 압축 실패 (버전 {ver_id}): {e}")
                em.M.db.session.rollback()
                _set_state(ver_id, "fail")
            finally:
                em.M.db.session.remove()
        _retry_deletes()


def _set_state(ver_id, state):
    try:
        M = em.M
        M.Version.query.filter_by(id=ver_id).update({"encode_state": state})
        M.db.session.commit()
    except Exception:  # noqa: BLE001
        em.M.db.session.rollback()


def _claim(ver_id):
    """대기 중인 버전을 작업 중으로 표시. 이미 처리됐거나 없으면 None."""
    M = em.M
    n = (M.Version.query.filter(M.Version.id == ver_id)
         .filter((M.Version.encode_state.is_(None)) | (M.Version.encode_state == "wait"))
         .update({"encode_state": "work"}, synchronize_session=False))
    M.db.session.commit()
    return M.db.session.get(M.Version, ver_id) if n else None


def _ffmpeg_cmd(src, dst):
    mx = max(240, _env_int("EDU_ENCODE_MAX", 720))
    long_ = round(mx * 16 / 9)
    # 가로 영상은 1280x720, 세로 영상은 720x1280 안에 맞춤 (작은 영상은 키우지 않음)
    vf = (f"scale=w='min(iw,if(gte(iw,ih),{long_},{mx}))':h='min(ih,if(gte(iw,ih),{mx},{long_}))'"
          f":force_original_aspect_ratio=decrease:force_divisible_by=2")
    return [ffmpeg_path(), "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
            "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-vf", vf, "-fpsmax", "30",
            "-c:v", "libx264", "-preset", "faster", "-crf", str(_env_int("EDU_ENCODE_CRF", 28)),
            "-pix_fmt", "yuv420p", "-threads", str(max(1, _env_int("EDU_ENCODE_THREADS", 2))),
            "-c:a", "aac", "-b:a", "96k", "-ac", "2",
            "-movflags", "+faststart", dst]


def _run(cmd):
    kw = {"stdout": subprocess.DEVNULL, "stderr": subprocess.PIPE, "timeout": TIMEOUT_SEC}
    if os.name == "nt":
        kw["creationflags"] = subprocess.BELOW_NORMAL_PRIORITY_CLASS | subprocess.CREATE_NO_WINDOW
    else:
        kw["preexec_fn"] = lambda: os.nice(10)
    r = subprocess.run(cmd, **kw)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[-500:])


def _process(ver_id):
    M = em.M
    ver = _claim(ver_id)
    if ver is None:
        return
    old_key = ver.file_path
    os.makedirs(_tmp_root, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="enc_", dir=_tmp_root)
    try:
        src = _storage.fetch(old_key, os.path.join(tmp, "in" + os.path.splitext(old_key)[1]))
        if not src:
            _set_state(ver_id, "fail")
            return
        in_size = os.path.getsize(src)
        dst = os.path.join(tmp, "out.mp4")
        t0 = time.time()
        _run(_ffmpeg_cmd(src, dst))
        out_size = os.path.getsize(dst)
        if out_size >= in_size * KEEP_RATIO:
            _set_state(ver_id, "skip")
            _app.logger.info(f"[Edu] 압축 생략 (버전 {ver_id}): 이미 충분히 작음")
            return
        new_key = st.new_key("videos", "x.mp4")
        _storage.put(new_key, dst, "video/mp4")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # 압축하는 동안 버전이 삭제·변경됐으면 새 파일만 정리
    M.db.session.expire_all()
    ver = M.db.session.get(M.Version, ver_id)
    if ver is None or ver.file_path != old_key:
        _storage.delete([new_key])
        return
    ver.file_path, ver.file_size, ver.encode_state = new_key, out_size, "done"
    M.db.session.commit()
    REPLACED[old_key] = new_key
    _delete_later([old_key])
    _app.logger.info(f"[Edu] 영상 압축 완료 (버전 {ver_id}): {in_size / 1048576:.1f}MB → "
                     f"{out_size / 1048576:.1f}MB, {time.time() - t0:.0f}초")


def _delete_later(keys):
    if _storage.delete(keys):
        _retry_delete.extend(keys)


def _retry_deletes():
    if not _retry_delete:
        return
    keys = list(_retry_delete)
    _retry_delete.clear()
    failed = set()
    for k in keys:
        if _storage.delete([k]):
            failed.add(k)
    _retry_delete.extend(failed)
