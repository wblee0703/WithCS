"""업로드 파일 검사 (허용 형식 · 크기 · 영상 길이 · 실제 내용).

- 확장자 허용 목록에 없는 파일(실행 파일 등)은 업로드 시작 단계에서 거부
- 크기 상한: 업로드 시작(신고 크기) · 서버 경유 조각 저장 · 등록(실제 크기) 세 번 확인
- 내용 확인: 파일 앞부분(시그니처)이 확장자와 맞는지 확인 → 확장자만 바꾼 파일 차단

환경변수(.env, 선택)
  EDU_MAX_VIDEO_MB=2048     (영상 최대 크기, MB. 30분 1080p 기준 약 1.8GB)
  EDU_MAX_VIDEO_MIN=30      (영상 최대 길이, 분)
  EDU_MAX_ATTACH_MB=100     (첨부자료 최대 크기, MB)
"""
import os

MB = 1024 * 1024

VIDEO_EXTS = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"}
ATTACH_EXTS = {".pdf", ".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx", ".hwp", ".hwpx",
               ".txt", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
THUMB_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"          # 옛 오피스(ppt·doc·xls), 한글(hwp)
_ZIP = (b"PK\x03\x04", b"PK\x05\x06")                 # 새 오피스(pptx·docx·xlsx), hwpx


def _env_num(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def max_bytes(kind):
    if kind == "videos":
        return int(_env_num("EDU_MAX_VIDEO_MB", 2048) * MB)
    if kind == "attachments":
        return int(_env_num("EDU_MAX_ATTACH_MB", 100) * MB)
    return 5 * MB                                     # 썸네일 (브라우저가 만든 작은 이미지)


def max_video_ms():
    return int(_env_num("EDU_MAX_VIDEO_MIN", 30) * 60 * 1000)


def exts(kind):
    return {"videos": VIDEO_EXTS, "attachments": ATTACH_EXTS, "thumbs": THUMB_EXTS}.get(kind, set())


def ext_of(name):
    return os.path.splitext(name or "")[1].lower()


def fmt_mb(n):
    return f"{n / 1024 / MB:.1f}GB" if n >= 1024 * MB else f"{n / MB:.0f}MB"


def check_name(kind, name):
    """확장자 허용 여부. 문제 있으면 오류 메시지, 없으면 ''."""
    e = ext_of(name)
    if e not in exts(kind):
        allow = ", ".join(sorted(x.lstrip(".") for x in exts(kind)))
        what = "영상" if kind == "videos" else "첨부자료"
        return f"{what}로 올릴 수 없는 형식입니다 ({e or '확장자 없음'}). 가능한 형식: {allow}"
    return ""


def check_size(kind, size):
    lim = max_bytes(kind)
    if size and size > lim:
        what = "영상" if kind == "videos" else "첨부자료" if kind == "attachments" else "파일"
        return f"{what} 크기가 너무 큽니다 ({fmt_mb(size)}). 최대 {fmt_mb(lim)}까지 올릴 수 있습니다."
    return ""


def check_duration(duration_ms):
    lim = max_video_ms()
    # 길이를 읽지 못한 형식(0)은 통과, 반올림·끝부분 여유 1분
    if duration_ms and duration_ms > lim + 60 * 1000:
        return (f"영상 길이가 너무 깁니다 ({duration_ms // 60000}분). "
                f"최대 {lim // 60000}분까지 올릴 수 있습니다. 나눠서 올려 주세요.")
    return ""


def check_head(ext, head):
    """파일 앞부분이 확장자와 맞는지. 문제 있으면 오류 메시지, 없으면 ''."""
    h = head or b""
    if h[:2] == b"MZ" or h[:4] == b"\x7fELF":
        return "실행 파일은 올릴 수 없습니다."
    ok = True
    if ext in (".mp4", ".m4v", ".mov"):
        ok = h[4:8] in (b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot")
    elif ext in (".webm", ".mkv"):
        ok = h[:4] == b"\x1a\x45\xdf\xa3"
    elif ext == ".avi":
        ok = h[:4] == b"RIFF" and h[8:12] == b"AVI "
    elif ext == ".pdf":
        ok = b"%PDF" in h[:1024]
    elif ext in (".ppt", ".doc", ".xls", ".hwp"):
        ok = h[:8] == _OLE
    elif ext in (".pptx", ".docx", ".xlsx", ".hwpx"):
        ok = h[:4] in _ZIP
    elif ext == ".png":
        ok = h[:8] == b"\x89PNG\r\n\x1a\n"
    elif ext in (".jpg", ".jpeg"):
        ok = h[:3] == b"\xff\xd8\xff"
    elif ext == ".gif":
        ok = h[:4] == b"GIF8"
    elif ext == ".webp":
        ok = h[:4] == b"RIFF" and h[8:12] == b"WEBP"
    elif ext == ".bmp":
        ok = h[:2] == b"BM"
    elif ext in (".txt", ".csv"):
        ok = b"\x00" not in h[:4096] or h[:2] in (b"\xff\xfe", b"\xfe\xff")   # UTF-16 은 허용
    if not ok:
        return f"파일 내용이 확장자({ext})와 맞지 않습니다. 손상됐거나 확장자를 바꾼 파일입니다."
    return ""


def limits():
    """화면에 알려 줄 제한 값."""
    return {
        "video_max_bytes": max_bytes("videos"), "attach_max_bytes": max_bytes("attachments"),
        "video_max_min": max_video_ms() // 60000,
        "video_exts": sorted(VIDEO_EXTS), "attach_exts": sorted(ATTACH_EXTS),
    }
