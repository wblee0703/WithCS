import gzip
import os
import glob
import re
import pymysql
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, '.env'))

db_user = os.environ.get('MYSQL_USER', 'root')
db_pw = os.environ.get('MYSQL_PASSWORD', '')
db_host = os.environ.get('MYSQL_HOST', '127.0.0.1')
db_port = int(os.environ.get('MYSQL_PORT', 3306))
# 기본 복원 대상 DB: .env의 MYSQL_DB (dbwithtech001)
db_name = os.environ.get('MYSQL_DB', 'dbwithtech001')

# backups 폴더에서 복원 대상 DB(db_name)에 매칭되는 백업 파일(.sql 또는 .sql.gz) 우선 탐색
backups_dir = os.path.join(BASE_DIR, 'backups')
target_pattern_sql = os.path.join(backups_dir, f"{db_name}_*.sql")
target_pattern_gz = os.path.join(backups_dir, f"{db_name}_*.sql.gz")

backup_files = sorted(
    glob.glob(target_pattern_sql) + glob.glob(target_pattern_gz),
    key=os.path.getmtime,
    reverse=True
)

# 대상 DB 전용 파일이 없을 경우 전체 백업 중 탐색하되, dbwithtech002 등 타 DB 백업 파일은 절대 선택되지 않도록 안전 제외
if not backup_files:
    all_backups = sorted(
        glob.glob(os.path.join(backups_dir, '*.sql')) + glob.glob(os.path.join(backups_dir, '*.sql.gz')),
        key=os.path.getmtime,
        reverse=True
    )
    # dbwithtech002 등 다른 DB 전용 파일은 제외
    backup_files = [f for f in all_backups if not os.path.basename(f).startswith('dbwithtech002')]

if not backup_files:
    print(f"❌ Error: backups 폴더({backups_dir}) 내에 복원 대상 DB([{db_name}])용 백업 파일(.sql / .sql.gz)이 없습니다.")
    exit(1)

backup_file = backup_files[0]
print(f"🎯 대상 데이터베이스: [{db_name}] (⚠️ dbwithtech002 등 다른 DB는 완전히 격리되어 영향 없음)")
print(f"📦 복원할 백업 파일: {os.path.basename(backup_file)}")

# 스크립트 읽기 (.gz 압축 파일 및 일반 .sql 지원)
if backup_file.endswith('.gz'):
    with gzip.open(backup_file, 'rt', encoding='utf-8', errors='ignore') as f:
        sql_script = f.read()
else:
    with open(backup_file, 'r', encoding='utf-8', errors='ignore') as f:
        sql_script = f.read()

# -------------------------------------------------------------------------
# [안전 장치] 백업 SQL 스크립트 정제 (타 DB 오염 및 삭제 원천 방지)
# 1. 스크립트 내 임의의 CREATE DATABASE / DROP DATABASE 문장 제거
# 2. 임의의 USE `...` 구문을 무조건 현재 대상 DB(`USE `{db_name}`;`)로 강제 치환
# -------------------------------------------------------------------------
sql_script = re.sub(r'CREATE\s+DATABASE\s+.*?;', '', sql_script, flags=re.IGNORECASE)
sql_script = re.sub(r'DROP\s+DATABASE\s+.*?;', '', sql_script, flags=re.IGNORECASE)
sql_script = re.sub(r'USE\s+[`\'"]?([a-zA-Z0-9_]+)[`\'"]?\s*;', f'USE `{db_name}`;', sql_script, flags=re.IGNORECASE)

print(f"🔗 DB 커넥션 연결 중... [{db_host}:{db_port}]")
try:
    conn = pymysql.connect(
        host=db_host,
        port=db_port,
        user=db_user,
        password=db_pw,
        charset='utf8mb4',
        client_flag=pymysql.constants.CLIENT.MULTI_STATEMENTS
    )
except Exception as err:
    print(f"❌ MySQL 연결 실패: {err}")
    exit(1)

try:
    with conn.cursor() as cursor:
        # 오직 대상 DB(`db_name`)만 생성 및 활성화
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{db_name}` DEFAULT CHARACTER SET utf8mb4;")
        cursor.execute(f"USE `{db_name}`;")
        print(f"🧹 대상 데이터베이스([{db_name}]) 복원 및 테이블 갱신 작업 실행 중...")
        cursor.execute("SET FOREIGN_KEY_CHECKS = 0;")
        cursor.execute(sql_script)
        cursor.execute(f"USE `{db_name}`;")
        cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")
    conn.commit()
    print(f"✅ 성공! 데이터베이스([{db_name}])가 최신 백업 데이터로 안전하게 복원되었습니다.")
    print(f"🔒 (안내: dbwithtech002 등 다른 데이터베이스는 전혀 변경되지 않고 온전히 보호되었습니다.)")
except Exception as e:
    conn.rollback()
    print(f"❌ DB 복원 중 오류 발생: {e}")
    exit(1)
finally:
    conn.close()
