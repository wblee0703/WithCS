# WITHTECH Equipment Management System

웹 기반 장비 셋업 및 유지보수 관리 시스템입니다.

## 주요 기능
- **장비 셋업 관리**: 간트 차트를 이용한 일정 관리, 셋업 단계별 진행 상황 체크
- **운영 관리 (Maintenance)**: PM(예방 정비)/BM(사후 정비) 일정 및 이력 관리
- **시스템 로그**: 사용자 활동 및 데이터 변경 이력 추적
- **사용자 관리**: 관리자/일반 사용자 권한 분리

## 기술 스택
- **Backend**: Flask (Python)
- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Database**: JSON File Storage (Local)
- **Database**: SQLite (Local)

## 설치 및 실행 방법

1. **환경 설정**
   Python 3.10 이상이 필요합니다.
   ```bash
   pip install -r requirements.txt
   ```

2. **환경 변수 설정**
   `.env` 파일을 프로젝트 루트에 생성하고 필요한 설정을 입력합니다. (보안상 Git에 포함되지 않음)
   예시:
   ```
   APP_ADMIN_ID=admin
   APP_ADMIN_PW=1234
   SECRET_KEY=your-secret-key
   APP_ENV=production
   ```

3. **서버 실행**
   ```bash
   python app.py
   ```