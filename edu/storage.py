"""교육 영상/썸네일/첨부 파일 저장소 (DB 에는 파일 키만 저장).

바꿔 끼울 수 있는 구조:
  - LocalStorage : 서버 디스크 (기본값, EDU_STORAGE=local)
  - S3Storage    : S3 호환 클라우드 (NCP Object Storage, Cloudflare R2 등, EDU_STORAGE=s3)
                   비공개 버킷 + Presigned URL 로 브라우저가 직접 업로드/재생

파일 키 형식: "<kind>/<uuid><확장자>"  (kind = videos | thumbs | attachments)

환경변수(.env)
  EDU_STORAGE=local | s3
  EDU_STORAGE_DIR=<로컬 저장 폴더>           (기본: data/edu)
  EDU_S3_ENDPOINT=https://...                (NCP: https://kr.object.ncloudstorage.com,
                                              R2: https://<계정ID>.r2.cloudflarestorage.com)
  EDU_S3_REGION=kr-standard | auto
  EDU_S3_BUCKET=<버킷 이름>
  EDU_S3_ACCESS_KEY=...
  EDU_S3_SECRET_KEY=...
  EDU_S3_URL_EXPIRES=600                     (재생/다운로드 임시 주소 유효 시간, 초. 만료 시 화면이 자동 재발급)
"""
import mimetypes
import os
import re
import shutil
import uuid
from urllib.parse import quote

from flask import redirect, send_file

KINDS = ("videos", "thumbs", "attachments")
CHUNK = 1024 * 1024
_KEY_RE = re.compile(r"^(videos|thumbs|attachments)/[0-9a-f]{32}\.[A-Za-z0-9]{1,10}$")

mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("video/mp4", ".m4v")
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("video/quicktime", ".mov")


def safe_ext(name):
    ext = os.path.splitext(name or "")[1][:11].lower()
    return ext if re.fullmatch(r"\.[a-z0-9]{1,10}", ext) else ".bin"


def new_key(kind, name):
    if kind not in KINDS:
        raise ValueError("잘못된 파일 종류입니다.")
    return f"{kind}/{uuid.uuid4().hex}{safe_ext(name)}"


def valid_key(key, kind=None):
    if not key or not _KEY_RE.match(key):
        return False
    return kind is None or key.startswith(kind + "/")


# 브라우저에서 바로 열어도 안전한 형식. 그 외(HTML, SVG, 스크립트 등)는 항상 다운로드로만 제공
INLINE_SAFE_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
                    ".mp4", ".m4v", ".webm", ".mov", ".mp3", ".m4a", ".wav", ".txt"}

# 저장소 파일 응답에 공통으로 붙이는 보안 헤더 (캐시 금지, 형식 추측 금지, 스크립트 실행 차단)
SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"


def content_type(key):
    if key.lower().endswith(".txt"):
        return "text/plain; charset=utf-8"
    return mimetypes.guess_type(key)[0] or "application/octet-stream"


def inline_safe(key):
    return os.path.splitext(key)[1].lower() in INLINE_SAFE_EXTS


def secure_headers(resp, key):
    resp.headers["Cache-Control"] = "no-store, private"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    # PDF 는 브라우저 PDF 뷰어가 sandbox 에서 차단되므로 제외 (PDF 는 사이트 권한으로 실행되지 않음)
    if not key.lower().endswith(".pdf"):
        resp.headers["Content-Security-Policy"] = SANDBOX_CSP
    return resp


def content_disposition(download_name):
    return f"attachment; filename*=UTF-8''{quote(download_name)}"


def summarize(objs):
    """파일 목록 → 종류별 {count, bytes}."""
    out = {k: {"count": 0, "bytes": 0} for k in KINDS + ("other",)}
    for o in objs:
        k = o["key"].split("/", 1)[0]
        k = k if k in KINDS else "other"
        out[k]["count"] += 1
        out[k]["bytes"] += o["size"]
    return out


class BaseStorage:
    """저장소 공통 인터페이스."""
    name = "base"
    direct_upload = False   # True 면 브라우저가 저장소로 직접 업로드 (Presigned PUT)

    def upload_target(self, key, ctype):
        """직접 업로드용 {url, headers}. 서버 경유 업로드 저장소는 None."""
        return None

    def append_chunk(self, key, offset, stream, length):
        """서버 경유 업로드: 조각 이어쓰기. 저장된 전체 크기 반환."""
        raise NotImplementedError

    def finish_upload(self, key):
        """서버 경유 업로드 완료 처리. 최종 크기 반환."""
        raise NotImplementedError

    def abort_upload(self, key):
        pass

    def size(self, key):
        """저장된 파일 크기. 없으면 None."""
        raise NotImplementedError

    def delete(self, keys):
        """여러 파일 삭제. 오류 메시지 목록 반환."""
        raise NotImplementedError

    def serve(self, key, download_name=None):
        """재생/다운로드 응답 (로컬: 파일 전송, 클라우드: 임시 주소로 이동)."""
        raise NotImplementedError

    def fetch(self, key, dst):
        """압축용: 서버에서 읽을 수 있는 파일 경로 반환 (필요하면 dst 로 내려받음). 없으면 None."""
        raise NotImplementedError

    def put(self, key, src, ctype):
        """압축 결과 파일(src)을 key 로 저장 (src 는 이동/삭제될 수 있음)."""
        raise NotImplementedError

    def usage(self):
        """저장소에 실제로 있는 파일 집계 {kind: {"count", "bytes"}}."""
        return summarize(self.list_objects())

    def list_objects(self):
        """저장소의 모든 파일 [{"key", "size", "mtime"(epoch 초)}] (업로드 중인 조각 제외)."""
        raise NotImplementedError

    def file_url(self, key, download_name=None):
        """화면에 넣을 주소. 기본은 서버 경유 주소(로그인 확인 후 serve)."""
        url = f"/api/edu/files/{key}"
        if download_name:
            url += f"?download={quote(download_name)}"
        return url


class LocalStorage(BaseStorage):
    name = "local"

    def __init__(self, root):
        self.root = os.path.abspath(root)
        for k in KINDS:
            os.makedirs(os.path.join(self.root, k), exist_ok=True)

    def path(self, key):
        if not valid_key(key):
            raise ValueError("잘못된 파일 키입니다.")
        return os.path.join(self.root, *key.split("/"))

    def _part(self, key):
        return self.path(key) + ".part"

    def append_chunk(self, key, offset, stream, length):
        part = self._part(key)
        cur = os.path.getsize(part) if os.path.exists(part) else 0
        if offset != cur:
            raise ValueError(f"업로드 위치가 맞지 않습니다. (서버 {cur}, 요청 {offset})")
        left = length
        with open(part, "ab") as f:
            while left > 0:
                buf = stream.read(min(CHUNK, left))
                if not buf:
                    raise ValueError("업로드가 중간에 끊겼습니다.")
                f.write(buf)
                left -= len(buf)
        return cur + length

    def finish_upload(self, key):
        part = self._part(key)
        if not os.path.exists(part):
            raise ValueError("업로드된 파일을 찾을 수 없습니다.")
        os.replace(part, self.path(key))
        return os.path.getsize(self.path(key))

    def abort_upload(self, key):
        for p in (self._part(key), self.path(key)):
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass

    def size(self, key):
        p = self.path(key)
        return os.path.getsize(p) if os.path.isfile(p) else None

    def delete(self, keys):
        errors = []
        for key in keys:
            if not key:
                continue
            try:
                p = self.path(key)
                if os.path.isfile(p):
                    os.remove(p)
            except (OSError, ValueError) as e:
                errors.append(f"{key}: {e}")
        return errors

    def serve(self, key, download_name=None):
        p = self.path(key)
        if not os.path.isfile(p):
            return None
        # conditional=True → Range 요청(영상 탐색) 지원
        resp = send_file(p, mimetype=content_type(key), conditional=True,
                         as_attachment=bool(download_name), download_name=download_name or None,
                         max_age=0)
        return secure_headers(resp, key)

    def fetch(self, key, dst):
        p = self.path(key)
        return p if os.path.isfile(p) else None

    def put(self, key, src, ctype):
        shutil.move(src, self.path(key))

    def list_objects(self):
        out = []
        for k in KINDS:
            d = os.path.join(self.root, k)
            for e in os.scandir(d) if os.path.isdir(d) else []:
                if e.is_file() and not e.name.endswith(".part"):
                    stt = e.stat()
                    out.append({"key": f"{k}/{e.name}", "size": stt.st_size, "mtime": stt.st_mtime})
        return out


def _add_content_md5(request, **kwargs):
    import base64
    import hashlib
    body = request.body or b""
    if isinstance(body, str):
        body = body.encode("utf-8")
    request.headers["Content-MD5"] = base64.b64encode(hashlib.md5(body).digest()).decode()


class S3Storage(BaseStorage):
    """S3 호환 저장소 (비공개 버킷). boto3 필요. ※ 6단계에서 실제 연결 후 검증 예정."""
    name = "s3"
    direct_upload = True

    def __init__(self, endpoint, region, bucket, access_key, secret_key, expires=600):
        import boto3
        from botocore.config import Config
        self.bucket = bucket
        self.expires = int(expires)
        opts = {"signature_version": "s3v4", "s3": {"addressing_style": "path"}}
        try:
            # NCP 등 S3 호환 저장소는 boto3 1.36+ 의 기본 무결성 헤더(CRC32)를 지원하지 않아 필요할 때만 사용
            cfg = Config(request_checksum_calculation="when_required",
                         response_checksum_validation="when_required", **opts)
        except TypeError:   # boto3 1.36 미만 (Python 3.8/3.9 호스팅) 은 해당 옵션이 없고 문제도 없음
            cfg = Config(**opts)
        self.client = boto3.client(
            "s3", endpoint_url=endpoint, region_name=region or None,
            aws_access_key_id=access_key, aws_secret_access_key=secret_key, config=cfg)
        # 버킷 설정 변경(CORS 등)은 Content-MD5 헤더가 필수
        self.client.meta.events.register("before-sign.s3.PutBucketCors", _add_content_md5)

    def set_cors(self, origins):
        """브라우저 직접 업로드/재생을 허용할 사이트 주소 등록 (기존 설정 덮어씀)."""
        rule = {"AllowedOrigins": list(origins), "AllowedMethods": ["GET", "PUT", "HEAD"],
                "AllowedHeaders": ["*"], "MaxAgeSeconds": 3000,
                "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"]}
        self.client.put_bucket_cors(Bucket=self.bucket, CORSConfiguration={"CORSRules": [rule]})
        return self.client.get_bucket_cors(Bucket=self.bucket)["CORSRules"]

    def upload_target(self, key, ctype):
        # 업로드 주소는 관리자 전용이고 큰 파일 전송 시작까지 여유가 필요하므로 최소 1시간
        url = self.client.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": ctype},
            ExpiresIn=max(self.expires, 3600))
        return {"url": url, "headers": {"Content-Type": ctype}}

    def size(self, key):
        try:
            return int(self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])
        except Exception:  # noqa: BLE001 (없는 파일 → 404)
            return None

    def abort_upload(self, key):
        self.delete([key])

    def delete(self, keys):
        errors = []
        keys = [k for k in keys if k]
        for i in range(0, len(keys), 1000):
            try:
                r = self.client.delete_objects(
                    Bucket=self.bucket,
                    Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]], "Quiet": True})
                errors += [f"{e.get('Key')}: {e.get('Message')}" for e in r.get("Errors", [])]
            except Exception as e:  # noqa: BLE001
                errors.append(str(e))
        return errors

    def fetch(self, key, dst):
        if self.size(key) is None:
            return None
        self.client.download_file(self.bucket, key, dst)
        return dst

    def put(self, key, src, ctype):
        self.client.upload_file(src, self.bucket, key, ExtraArgs={"ContentType": ctype})

    def list_objects(self):
        out = []
        for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket):
            for o in page.get("Contents", []):
                out.append({"key": o["Key"], "size": int(o["Size"]), "mtime": o["LastModified"].timestamp()})
        return out

    def serve(self, key, download_name=None):
        params ={"Bucket": self.bucket, "Key": key, "ResponseCacheControl": "no-store, private"}
        if download_name:
            params["ResponseContentDisposition"] = content_disposition(download_name)
        url = self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=self.expires)
        resp = redirect(url, code=302)
        resp.headers["Cache-Control"] = "no-store, private"   # 임시 주소가 브라우저에 저장되지 않게
        resp.headers["Referrer-Policy"] = "no-referrer"
        return resp


def create_storage(base_dir):
    kind = os.environ.get("EDU_STORAGE", "local").strip().lower()
    if kind == "s3":
        return S3Storage(
            endpoint=os.environ.get("EDU_S3_ENDPOINT", ""),
            region=os.environ.get("EDU_S3_REGION", ""),
            bucket=os.environ.get("EDU_S3_BUCKET", ""),
            access_key=os.environ.get("EDU_S3_ACCESS_KEY", ""),
            secret_key=os.environ.get("EDU_S3_SECRET_KEY", ""),
            expires=os.environ.get("EDU_S3_URL_EXPIRES", "600"))
    root = os.environ.get("EDU_STORAGE_DIR") or os.path.join(base_dir, "data", "edu")
    return LocalStorage(root)
