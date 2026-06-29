# 프로젝트 개발 규칙 (Project Development Rules)

## 1. 모바일 브라우저 호환성 유지 (Mobile Browser Compatibility)
- 코드를 추가하거나 수정할 때는 항상 **안드로이드(Chrome, Samsung Internet 등)** 및 **아이폰(iOS Safari 등)** 모바일 브라우저 호환성을 염두에 두어야 합니다.
- 데스크톱 특화 이벤트(`mousedown`, `mouseup` 등)를 사용할 때는 모바일 터치 스크린 동작을 고려하여 포인터 이벤트(`pointerdown`, `pointerup` 등)나 터치 이벤트(`touchstart`, `touchend` 등)를 호환하여 구현해야 합니다.
- 포커스 이동 및 소실(blur/focus) 주기가 모바일 디바이스마다 상이하므로 관련 로직을 작성할 때는 팝업이 닫히거나 무시되지 않도록 주의합니다.
- 모바일 가로/세로 레이아웃 및 뷰포트(viewport), `cursor: pointer` 스타일 지정을 고려하여 UI 클릭(터치) 동작이 정상 반응하도록 설계합니다.

## 2. 한국어 지원 원칙 (Korean Translation Principle)
- 프로젝트 문서(구현 계획서, 결과 보고서, 작업 목록 등) 및 안내 코멘트, UI 텍스트를 작성하거나 수정할 때는 한국어로 작성하거나 다국어일 경우 한국어 번역을 최우선으로 반영합니다.
