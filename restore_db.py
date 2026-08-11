import gzip
import os
import glob
import pymysql
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, '.env'))

db_user = os.environ.get('MYSQL_USER', 'root')
db_pw = os.environ.get('MYSQL_PASSWORD', '')
db_host = os.environ.get('MYSQL_HOST', '127.0.0.1')
db_port = int(os.environ.get('MYSQL_PORT', 3306))
db_name = os.environ.get('MYSQL_DB', 'dbwithtech001')

# backups 폴더에서 가장 최근 백업 파일(.sql 또는 .sql.gz) 자동 선택
backups_dir = os.path.join(BASE_DIR, 'backups')
backup_files = sorted(
    glob.glob(os.path.join(backups_dir, '*.sql')) + glob.glob(os.path.join(backups_dir, '*.sql.gz')),
    key=os.path.getmtime,
    reverse=True
)

if not backup_files:
    print(f"❌ Error: backups 폴더({backups_dir}) 내에 복원할 백업 파일(.sql 또는 .sql.gz)이 없습니다.")
    exit(1)

backup_file = backup_files[0]
print(f"📦 복원할 백업 파일: {os.path.basename(backup_file)}")

# 스크립트 읽기 (.gz 압축 파일 및 일반 .sql 지원)
if backup_file.endswith('.gz'):
    with gzip.open(backup_file, 'rt', encoding='utf-8', errors='ignore') as f:
        sql_script = f.read()
else:
    with open(backup_file, 'r', encoding='utf-8', errors='ignore') as f:
        sql_script = f.read()

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
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{db_name}` DEFAULT CHARACTER SET utf8mb4;")
        cursor.execute(f"USE `{db_name}`;")
        print(f"🧹 데이터베이스([{db_name}]) 복원 및 테이블 갱신 작업 실행 중...")
        cursor.execute("SET FOREIGN_KEY_CHECKS = 0;")
        cursor.execute(sql_script)
        cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")
    conn.commit()
    print(f"✅ 성공! 데이터베이스([{db_name}])가 최신 백업 파일 데이터로 완벽하게 복원 및 초기화되었습니다.")
except Exception as e:
    conn.rollback()
    print(f"❌ DB 복원 중 오류 발생: {e}")
    exit(1)
finally:
    conn.close()
