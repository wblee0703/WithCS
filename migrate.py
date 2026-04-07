import os
from sqlalchemy import create_engine, MetaData, text

# app.py가 실행되면서 .env를 로드하고 가비아 MySQL에 빈 테이블들을 자동 생성합니다.
from app import app, db

def run_migration():
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(BASE_DIR, 'data', 'withtech.db')
    
    if not os.path.exists(db_path):
        print(f"❌ 로컬 SQLite 파일을 찾을 수 없습니다: {db_path}")
        print("기존 data 폴더와 withtech.db 파일이 함께 업로드되었는지 확인해주세요.")
        return

    print("\n🚀 데이터 복사(SQLite -> MySQL)를 시작합니다...")

    # 1. SQLite 엔진 연결 (원본 로컬 데이터)
    sqlite_uri = f"sqlite:///{db_path}"
    sqlite_engine = create_engine(sqlite_uri)

    # 2. MySQL 엔진 연결 (.env 설정으로 적용된 app.py의 환경 재활용)
    mysql_uri = app.config.get('SQLALCHEMY_DATABASE_URI')
    if not mysql_uri or not mysql_uri.startswith('mysql'):
        print("❌ 현재 DB_TYPE이 mysql이 아닙니다. .env 파일에서 DB_TYPE=mysql로 변경해주세요.")
        return
        
    mysql_engine = create_engine(mysql_uri)

    try:
        meta = MetaData()
        meta.reflect(bind=sqlite_engine)

        with mysql_engine.begin() as mysql_conn:
            with sqlite_engine.begin() as sqlite_conn:
                # 데이터 복사 중 외래키(Foreign Key) 충돌을 방지하기 위해 일시적으로 검사 해제
                mysql_conn.execute(text("SET FOREIGN_KEY_CHECKS=0;"))

                for table in meta.sorted_tables:
                    print(f"[*] '{table.name}' 테이블 복사 중...")
                    records = sqlite_conn.execute(table.select()).fetchall()
                    
                    if records:
                        data = [dict(row._mapping) for row in records]
                        mysql_conn.execute(table.delete()) # 기존에 생성된 초기 계정 등 비우기
                        mysql_conn.execute(table.insert(), data)
                        print(f"    -> {len(data)}건 복사 완료!")
                    else:
                        print("    -> 데이터 없음 (스킵)")

                mysql_conn.execute(text("SET FOREIGN_KEY_CHECKS=1;"))
                
        print("\n🎉 모든 데이터 마이그레이션이 성공적으로 완료되었습니다!")

    except Exception as e:
        print(f"\n❌ 복사 중 오류가 발생했습니다:\n{e}")

if __name__ == '__main__':
    with app.app_context():
        run_migration()