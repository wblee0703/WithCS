"""EDU 클라우드 버킷에 접근 허용 사이트(CORS) 등록.

브라우저가 저장소로 직접 업로드할 때 필요. 사이트 주소가 바뀌거나 운영 도메인을 추가할 때 실행.
(.env 의 EDU_S3_* 값 사용, 기존 설정을 덮어씀)

사용 예:
    python -m edu.setup_cors https://withon.example.com
    python -m edu.setup_cors http://127.0.0.1:5500 http://192.168.0.108:5500
"""
import os
import sys

from dotenv import load_dotenv


def main(origins):
    if not origins:
        print(__doc__)
        return 1
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    from .storage import S3Storage
    e = os.environ.get
    s = S3Storage(e("EDU_S3_ENDPOINT", ""), e("EDU_S3_REGION", ""), e("EDU_S3_BUCKET", ""),
                  e("EDU_S3_ACCESS_KEY", ""), e("EDU_S3_SECRET_KEY", ""))
    rules = s.set_cors([o.rstrip("/") for o in origins])
    print(f"[{s.bucket}] 허용 사이트:", ", ".join(rules[0]["AllowedOrigins"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
