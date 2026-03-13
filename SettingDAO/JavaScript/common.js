/* ==========================================================================
   1. 전역 변수 및 데이터 관리 (Global State)
   ========================================================================== */
let storageData = JSON.parse(localStorage.getItem('withtech_data')) || {};
let currentPath = { site: '', equip: '' };
let selectedLogId = null;
let originalMemo = "";
let originalSetupData = null;
let currentLogFilter = 'all'; // [추가] 현재 로그 필터 상태

const setupInputIds = [
    'DeviceID-cust-equip-name', 'DeviceID-building', 'DeviceID-floor', 'DeviceID-detail-loc',
    'DeviceID-manager', 'DeviceID-contact', 'DeviceID-email',
    'DeviceID-cust-manager', 'DeviceID-cust-contact', 'DeviceID-cust-email'
];

// [보안] XSS 방지를 위한 HTML 이스케이프 함수
function escapeHtml(text) {
    if (!text) return text;
    return String(text).replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// [보안] 쿠키에서 CSRF 토큰 가져오기
function getCookie(name) {
    let value = "; " + document.cookie;
    let parts = value.split("; " + name + "=");
    if (parts.length === 2) return parts.pop().split(";").shift();
}

// [서버 동기화 로직] localStorage 변경 시 서버로 자동 전송
const originalSetItem = localStorage.setItem;
const originalRemoveItem = localStorage.removeItem;
let syncDebounceTimer = null;

function saveAllToServer() {
    // 연속된 호출 시 이전 타이머 취소 (과도한 요청 방지)
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);

    syncDebounceTimer = setTimeout(() => {
        const allData = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // 동기화할 키 필터링
            if (key === 'withtech_data' || key.startsWith('details_') || key === 'system_logs' || key === 'setup_data' || key === 'equipment_models') {
                try {
                    allData[key] = JSON.parse(localStorage.getItem(key));
                } catch (e) {
                    allData[key] = localStorage.getItem(key);
                }
            }
        }
        
        fetch('/api/data', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrf_token') // [보안] CSRF 토큰 추가
            },
            body: JSON.stringify(allData)
        }).catch(err => console.error('Server sync failed:', err));
    }, 500); // 0.5초 지연 후 전송
}

localStorage.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (key === 'withtech_data' || key.startsWith('details_') || key === 'system_logs' || key === 'setup_data' || key === 'equipment_models') {
        saveAllToServer();
    }
};

localStorage.removeItem = function(key) {
    originalRemoveItem.call(this, key);
    if (key === 'withtech_data' || key.startsWith('details_') || key === 'system_logs' || key === 'setup_data' || key === 'equipment_models') {
        saveAllToServer();
    }
};

function saveData() {
    localStorage.setItem('withtech_data', JSON.stringify(storageData));
}

/* ==========================================================================
   2. 초기화 및 이벤트 리스너 (Initialization)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // [변경] 1. 앱 초기화 즉시 실행 (UI 반응성 향상 - 버벅임 제거)
    // 로컬 스토리지에 캐시된 데이터를 사용하여 즉시 화면을 구성합니다.
    initializeApp();

    // [추가] 로그인하지 않은 상태에서는 서버 데이터 요청을 보내지 않음 (401 에러 로그 방지)
    if (sessionStorage.getItem('isLoggedIn') !== 'true') return;

    // 2. 서버 데이터 비동기 로드 (백그라운드 동기화)
    fetch('/api/data')
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.json();
        })
        .then(data => {
            // 기존 데이터 정리
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key === 'withtech_data' || key.startsWith('details_') || key === 'setup_data' || key === 'system_logs' || key === 'equipment_models') {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => originalRemoveItem.call(localStorage, key));

            // 서버 데이터를 localStorage에 반영
            Object.keys(data).forEach(key => {
                originalSetItem.call(localStorage, key, JSON.stringify(data[key]));
            });
            // [수정] 전역 변수 갱신 (초기 로드 시 데이터 누락 방지)
            storageData = JSON.parse(localStorage.getItem('withtech_data')) || {};
            
            // [추가] 데이터 갱신 후 UI 리프레시 (화면 깜빡임 없이 데이터만 최신화)
            refreshAppViews();
            
            // [중요] 데이터 로드 완료 이벤트 발생
            window.isDataLoaded = true;
            window.dispatchEvent(new Event('DataLoaded'));
        })
        .catch(err => {
            console.error('Failed to load data from server:', err);
            // 실패해도 이미 로컬 데이터로 초기화되었으므로 추가 조치 불필요
            window.isDataLoaded = true;
            window.dispatchEvent(new Event('DataLoaded'));
        });
});

function initializeApp() {
    // 2-1. 초기 설정
    // 2-2. 로그인 및 사용자 관리 이벤트
    setupAuthEvents();
    setupMobileNav(); // [이동] 페이지 접근 제어 전에 실행하여 홈 화면에서도 메뉴 작동하도록 수정
    setupLogoEvent(); // [추가] 로고 클릭 시 홈 이동

    // [개선] 데스크톱 네비게이션 링크 클릭 시, 이동 전 변경사항 확인
    const desktopNav = document.querySelector('.header .container .nav-links');
    if (desktopNav) {
        desktopNav.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href) {
                // 현재 페이지와 같은 링크는 무시
                if (new URL(link.href).pathname === window.location.pathname) {
                    e.preventDefault();
                    return;
                }
                // 저장되지 않은 변경사항이 있으면 확인창 표시 후 이동 중단
                if (!checkUnsavedChanges()) {
                    e.preventDefault();
                }
            }
        });
    }

    // 2-3. 페이지별 접근 제어
    if (!handlePageAccess()) return;
    // 2-4. UI 초기화
    checkLoginStatus();
    renderSites();
    setupSidebarEvents();
    setupDataManagementEvents();
    setupResizers();
    setupCollapsibleCards(); // [추가] 소분류 카드 접기 기능 초기화
    // 2-5. URL 파라미터 처리
    restoreLastState();
    // window.isDataLoaded 설정 및 이벤트 발생은 서버 동기화 완료 후로 이동됨
}

// [추가] 데이터 갱신 후 화면 리프레시 함수
function refreshAppViews() {
    // 1. 사이드바 갱신
    renderSites();
    
    // 2. 현재 화면 상태에 따라 뷰 갱신
    // Home 화면은 DataLoaded 이벤트에 의해 index.js가 처리하므로 여기서는 자동 처리됨
    
    // Setup/Maintenance 화면인 경우: 선택 상태 복원 및 상세 내용 갱신
    if (currentPath.site) {
        const activeSiteLi = Array.from(document.querySelectorAll('#site-list li .item-text'))
            .find(el => el.textContent.trim() === currentPath.site)?.parentElement;
        if (activeSiteLi) {
            // 사이트가 존재하면 장비 목록 재렌더링
            renderEquips(currentPath.site);
            // 부드러운 UX를 위해 마지막 선택 상태 강제 복원 (상세 내용 갱신 포함)
            restoreLastState();
        }
    }
}

function setupAuthEvents() {
    const btnLoginLogout = document.getElementById('btn-login-logout');
    const btnLoginSubmit = document.getElementById('btn-login-submit');
    const loginIdInput = document.getElementById('login-id');
    const loginPwInput = document.getElementById('login-pw');
    const btnUserSettings = document.getElementById('btn-user-settings');
    const btnCloseUserModal = document.getElementById('btn-close-user-modal');
    const userModal = document.getElementById('user-modal');
    const btnAddUser = document.getElementById('btn-add-user');
    const btnChangePw = document.getElementById('btn-change-pw');
    const userInfo = document.getElementById('user-info');

    // [추가] 홈 화면 로그인 요소 이벤트 연결
    const homeLoginBtn = document.getElementById('home-login-btn');
    const homeLoginId = document.getElementById('home-login-id');
    const homeLoginPw = document.getElementById('home-login-pw');

    if (homeLoginBtn) {
        homeLoginBtn.addEventListener('click', () => attemptLogin(homeLoginId.value, homeLoginPw.value, 'HOME'));
    }
    if (homeLoginPw) {
        homeLoginPw.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') attemptLogin(homeLoginId.value, homeLoginPw.value, 'HOME');
        });
    }

    if (userInfo) userInfo.addEventListener('click', handleLoginLogoutClick);
    if (btnUserSettings) btnUserSettings.addEventListener('click', openUserModal);
    if (btnCloseUserModal) btnCloseUserModal.addEventListener('click', closeUserModal);
    if (userModal) userModal.addEventListener('click', (e) => { if (e.target === userModal) closeUserModal(); });
    if (btnAddUser) btnAddUser.addEventListener('click', addNewUser);
    if (btnChangePw) btnChangePw.addEventListener('click', changePassword);

    if (btnLoginLogout) btnLoginLogout.addEventListener('click', handleLoginLogoutClick);
    if (btnLoginSubmit) btnLoginSubmit.addEventListener('click', () => attemptLogin(loginIdInput.value, loginPwInput.value, 'Modal'));
    if (loginPwInput) {
        loginPwInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') attemptLogin(loginIdInput.value, loginPwInput.value, 'Modal'); });
    }
}

// [추가] 모바일 네비게이션 설정 함수
function setupMobileNav() {
    // [수정] 요소가 없으면 동적으로 생성 (setup.html, maintenance.html 등에서 헤더 구조 보완)
    const header = document.querySelector('.header');
    if (!header) return;

    let hamburger = document.getElementById('hamburger-menu');
    if (!hamburger) {
        hamburger = document.createElement('button');
        hamburger.className = 'hamburger-menu';
        hamburger.id = 'hamburger-menu';
        hamburger.innerHTML = '<div class="bar"></div><div class="bar"></div><div class="bar"></div>';
        // 헤더의 첫 번째 자식으로 추가
        header.insertBefore(hamburger, header.firstChild);
    }

    let navOverlay = document.getElementById('nav-overlay');
    if (!navOverlay) {
        navOverlay = document.createElement('div');
        navOverlay.className = 'nav-overlay';
        navOverlay.id = 'nav-overlay';
        header.appendChild(navOverlay);
    }

    let mobileNav = document.getElementById('mobile-nav');
    if (!mobileNav) {
        mobileNav = document.createElement('nav');
        mobileNav.className = 'mobile-nav';
        mobileNav.id = 'mobile-nav';
        header.appendChild(mobileNav);
    }

    const mainNav = document.querySelector('.header .container .nav-links');
    if (!mainNav) return;

    // 메인 네비게이션 복제
    mobileNav.innerHTML = `<ul class="mobile-nav-links">${mainNav.innerHTML}</ul>`;

    // [추가] 유저 컨트롤 복제 및 모바일 메뉴 하단에 추가
    const userControls = document.querySelector('.user-controls');
    if (userControls) {
        const mobileControls = userControls.cloneNode(true);
        mobileControls.className = 'mobile-user-controls';
        
        // ID 변경 및 이벤트 연결
        const btnLogin = mobileControls.querySelector('#btn-login-logout');
        if (btnLogin) {
            btnLogin.id = 'mobile-btn-login-logout';
            btnLogin.addEventListener('click', () => {
                toggleNav(); // 메뉴 닫기
                handleLoginLogoutClick();
            });
        }
        
        const btnSettings = mobileControls.querySelector('#btn-user-settings');
        if (btnSettings) {
            btnSettings.id = 'mobile-btn-user-settings';
            btnSettings.addEventListener('click', () => {
                toggleNav(); // 메뉴 닫기
                openUserModal();
            });
        }
        
        const userInfo = mobileControls.querySelector('#user-info');
        if (userInfo) {
            userInfo.id = 'mobile-user-info';
            // [요청] 모바일 사용자 정보 클릭 시 로그아웃
            userInfo.addEventListener('click', () => {
                handleLoginLogoutClick();
            });
        }
        mobileNav.appendChild(mobileControls);
    }

    const toggleNav = () => {
        hamburger.classList.toggle('active');
        mobileNav.classList.toggle('active');
        navOverlay.classList.toggle('active');
    };

    hamburger.addEventListener('click', toggleNav);
    navOverlay.addEventListener('click', toggleNav);

    // [추가] 모바일 메뉴의 링크 클릭 시, 메뉴를 닫고 해당 페이지로 이동
    // innerHTML로 복제된 노드에 이벤트 리스너를 다시 연결합니다. (이벤트 위임 방식 사용)
    mobileNav.addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (link && link.href) {
            // [개선] 페이지 이동 전, 저장되지 않은 변경사항이 있는지 확인합니다.
            if (!checkUnsavedChanges()) {
                e.preventDefault(); // 사용자가 '취소'를 누르면 페이지 이동을 막습니다.
                return;
            }

            // 현재 페이지와 같은 링크는 메뉴만 닫고 새로고침하지 않습니다.
            if (new URL(link.href).pathname === window.location.pathname) {
                e.preventDefault();
                toggleNav(); // 메뉴만 닫습니다.
                return;
            }

            e.preventDefault(); // 기본 링크 동작을 막고, 애니메이션 후 수동으로 이동합니다.
            const destination = link.href;
            toggleNav();
            setTimeout(() => { window.location.href = destination; }, 300);
        }
    });

    // [수정] 초기 상태 반영 (로그인 여부에 따른 메뉴 표시)
    checkLoginStatus();
}

// [추가] 로고 클릭 이벤트 (PC/모바일 공통)
function setupLogoEvent() {
    const logo = document.querySelector('.header-logo');
    if (logo) {
        logo.addEventListener('click', () => {
            if (!checkUnsavedChanges()) return;
            window.location.href = 'index.html';
        });
    }
}

function handlePageAccess() {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
    const homeWelcomeContainer = document.getElementById('home-welcome-container');
    const homeLoginContainer = document.getElementById('home-login-container');

    if (homeWelcomeContainer) {
        // [HOME 화면]
        if (isLoggedIn) {
            homeWelcomeContainer.style.display = 'flex';
            if (homeLoginContainer) homeLoginContainer.style.display = 'none';
            updateHomeDashboard();
        } else {
            homeWelcomeContainer.style.display = 'none';
            if (homeLoginContainer) homeLoginContainer.style.display = 'flex';
            // 로그인 모달은 checkLoginStatus()에서 자동으로 표시됩니다.
        }

        const homeLogoutBtn = document.getElementById('home-logout-btn');
        if (homeLogoutBtn) homeLogoutBtn.addEventListener('click', () => {
            if (confirm('로그아웃 하시겠습니까?')) {
                // [보안] 서버 로그아웃 요청
                fetch('/api/logout', { 
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCookie('csrf_token') }
                }).then(() => {
                    localStorage.removeItem('lastHomeSection');
                    localStorage.removeItem('setupDashboardFilter');
                    localStorage.removeItem('currentGanttFilters');
                    sessionStorage.clear();
                    location.reload();
                });
            }
        });

        checkLoginStatus();
        return false; // HOME에서는 여기서 스크립트 종료
    }

    // [그 외 페이지]
    if (!isLoggedIn) {
        alert('로그인이 필요한 서비스입니다.');
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

function setupSidebarEvents() {
    // 사이드바 추가/검색/편집 이벤트
    const siteInput = document.getElementById('site-input');
    const siteAddBtn = document.getElementById('site-add-btn');
    if (siteAddBtn) {
        siteAddBtn.onclick = () => {
            const val = siteInput.value.trim();
            if (val && !storageData[val]) {
                storageData[val] = [];
                saveData();
                addSystemLog('ADD_SITE', val);
                renderSites();
                siteInput.value = '';
            }
        };
        siteInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') siteAddBtn.click(); });
    }

    const siteSettingBtn = document.getElementById('site-setting-btn');
    // [추가] 사업장 추가 입력창 그룹 (초기 숨김 처리)
    const siteInputGroup = siteInput ? siteInput.parentElement : null;
    if (siteInputGroup) {
        siteInputGroup.style.display = 'none';
    }

    if (siteSettingBtn) {
        siteSettingBtn.addEventListener('click', () => {
            document.getElementById('site-list').classList.toggle('edit-active');
            siteSettingBtn.classList.toggle('active');
            // [추가] 톱니바퀴 클릭 시 입력창 토글
            if (siteInputGroup) {
                siteInputGroup.style.display = siteInputGroup.style.display === 'none' ? 'flex' : 'none';
            }
        });
    }

    const equipSettingBtn = document.getElementById('equip-setting-btn');
    // [추가] 장비 추가 입력창 그룹 (초기 숨김 처리)
    const equipInputEl = document.getElementById('equip-input');
    const equipInputGroup = equipInputEl ? equipInputEl.parentElement : null;
    if (equipInputGroup) {
        equipInputGroup.style.display = 'none';
    }

    if (equipSettingBtn) {
        equipSettingBtn.addEventListener('click', () => {
            document.getElementById('equip-list').classList.toggle('edit-active');
            equipSettingBtn.classList.toggle('active');
            // [추가] 톱니바퀴 클릭 시 입력창 토글
            if (equipInputGroup) {
                equipInputGroup.style.display = equipInputGroup.style.display === 'none' ? 'flex' : 'none';
            }
        });
    }

    const equipInput = document.getElementById('equip-input');
    const equipModelInput = document.getElementById('equip-model-input');
    const equipAddBtn = document.getElementById('equip-add-btn');

    if (equipAddBtn) {
        equipAddBtn.onclick = () => {
            const activeSiteLi = document.querySelector('#site-list li.active');
            if (!activeSiteLi) return alert('사업장을 먼저 선택해주세요.');

            const siteName = activeSiteLi.querySelector('.item-text').textContent.trim();
            const equipVal = equipInput.value.trim();
            const equipModelVal = equipModelInput ? equipModelInput.value.trim() : '';

            if (equipVal) {
                const fullEquipName = equipModelVal ? `${equipVal}::${equipModelVal}` : equipVal;
                if (!storageData[siteName]) storageData[siteName] = [];
                if (storageData[siteName].includes(fullEquipName)) return alert('이미 존재하는 장비(Serial No.)입니다.');

                storageData[siteName].push(fullEquipName);
                saveData();

                const key = `details_${siteName}_${fullEquipName}`;
                
                // [수정] 장비 추가 시 BM 설비 점검 기본 추가
                const initData = { maint: [], logs: [], memo: "", setup: { model: equipModelVal } };
                localStorage.setItem(key, JSON.stringify(initData));

                addSystemLog('ADD_EQUIP', fullEquipName, `Site: ${siteName}`);
                renderEquips(siteName);
                equipInput.value = '';
                if (equipModelInput) equipModelInput.value = '';
                equipInput.focus();
            }
        };
        equipInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') equipAddBtn.click(); });
        if (equipModelInput) equipModelInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') equipAddBtn.click(); });
    }

    // 검색 및 드래그 앤 드롭
    const siteSearch = document.getElementById('site-search');
    const equipSearch = document.getElementById('equip-search');
    if (siteSearch) siteSearch.addEventListener('keypress', (e) => { if (e.key === 'Enter') filterList('site-list', e.target.value); });
    if (equipSearch) equipSearch.addEventListener('keypress', (e) => { if (e.key === 'Enter') filterList('equip-list', e.target.value); });

    const siteListEl = document.getElementById('site-list');
    const equipListEl = document.getElementById('equip-list');
    [siteListEl, equipListEl].forEach(list => {
        if (list) {
            list.addEventListener('dragover', e => {
                e.preventDefault();
                const afterElement = getDragAfterElement(list, e.clientY, 'li:not(.dragging)');
                const draggable = document.querySelector('.dragging');
                if (draggable && afterElement == null) list.appendChild(draggable);
                else if (draggable) list.insertBefore(draggable, afterElement);
            });
        }
    });
}

function setupDataManagementEvents() {
    const btnExport = document.getElementById('btn-export');
    const btnImport = document.getElementById('btn-import');
    const fileImport = document.getElementById('file-import');
    if (btnExport) btnExport.addEventListener('click', exportData);
    // [추가] 모바일에서 데이터 관리 숨기기 식별을 위한 클래스 추가
    if (btnExport && btnExport.parentElement) {
        btnExport.parentElement.classList.add('data-management-section');
    }
    
    if (btnImport) btnImport.addEventListener('click', () => fileImport.click());
    if (fileImport) fileImport.addEventListener('change', importData);

    const btnViewLogs = document.getElementById('btn-view-logs');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    const logModal = document.getElementById('log-modal');

    if (btnViewLogs) {
        btnViewLogs.addEventListener('click', (e) => { e.preventDefault(); openLogModal(); });
    }
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', (e) => { e.preventDefault(); closeLogModal(); });
    }
    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', (e) => { e.preventDefault(); clearSystemLogs(); });
    }
    if (logModal) {
        logModal.addEventListener('click', (e) => { if (e.target === logModal) closeLogModal(); });
    }

    // [추가] 로그 필터 버튼 이벤트
    const filterBtns = document.querySelectorAll('.btn-filter');
    if (filterBtns.length > 0) {
        filterBtns.forEach(btn => {
            btn.onclick = () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentLogFilter = btn.dataset.filter;
                renderSystemLogs();
            };
        });
    }
}

function setupResizers() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.dashboard-sidebar');
    if (resizer && sidebar) {
        let isResizing = false;
        resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.cursor = 'col-resize'; resizer.classList.add('resizing'); });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX - sidebar.getBoundingClientRect().left;
            if (newWidth > 300 && newWidth < 600) sidebar.style.width = `${newWidth}px`;
        });
        document.addEventListener('mouseup', () => { isResizing = false; document.body.style.cursor = 'default'; resizer.classList.remove('resizing'); });
    }
}

// [추가] 소분류 카드 접기 기능 (위아래 화살표 버튼 추가)
function setupCollapsibleCards() {
    const cards = document.querySelectorAll('.card, .setup-card');
    cards.forEach(card => {
        const header = card.querySelector('.card-header, .setup-card-header');
        const body = card.querySelector('.card-body, .setup-card-body');
        if (header && body && !header.querySelector('.btn-collapse')) {
            const btn = document.createElement('button');
            btn.className = 'btn-collapse';
            
            // [수정] 모바일(가로모드 포함) 초기 상태 설정
            if (window.innerWidth <= 950) {
                const headerText = header.textContent;
                // [요청] 셋업 진행 세부사항, 장비 점검 이력은 초기 상태에서 열어둠
                const keepOpen = (card.id === 'setup-detail-card') || headerText.includes('셋업 진행 세부사항') || headerText.includes('장비 점검 이력');
                
                if (keepOpen) {
                    btn.innerHTML = '▲';
                    body.style.display = '';
                } else {
                    btn.innerHTML = '▼';
                    body.style.display = 'none';
                }
            } else {
                btn.innerHTML = '▲'; // 초기 상태: 펼쳐짐
            }
            
            btn.style.cssText = 'float: right; background: none; border: none; color: #8b949e; cursor: pointer; font-size: 14px; line-height: 1;';
            
            btn.onclick = (e) => {
                e.stopPropagation();
                if (body.style.display === 'none') {
                    body.style.display = ''; // 원래 display 속성 복구
                    btn.innerHTML = '▲';
                } else {
                    body.style.display = 'none';
                    btn.innerHTML = '▼';
                }
            };
            header.appendChild(btn);
        }
    });
}

function restoreLastState() {
    const urlParams = new URLSearchParams(window.location.search);
    let siteToSelect = urlParams.get('site');
    let equipToSelect = urlParams.get('equip');

    // URL 파라미터가 없으면 마지막 저장된 상태 확인
    if (!siteToSelect || !equipToSelect) {
        try {
            let lastStateKey = 'lastSelectedPath'; // 기본값
            if (window.location.pathname.indexOf('setup') !== -1) lastStateKey = 'lastSetupPath';
            else if (window.location.pathname.indexOf('maintenance') !== -1) lastStateKey = 'lastMaintPath';

            const lastState = sessionStorage.getItem(lastStateKey);
            if (lastState) {
                const parsed = JSON.parse(lastState);
                siteToSelect = parsed.site;
                equipToSelect = parsed.equip;
            }
        } catch (e) { console.error(e); }
    }

    if (siteToSelect && equipToSelect) {
        setTimeout(() => {
            const siteItems = document.querySelectorAll('#site-list .item-text');
            const targetSiteLi = Array.from(siteItems).find(span => span.textContent.trim() === siteToSelect)?.parentElement;
            if (targetSiteLi) {
                targetSiteLi.click();
                setTimeout(() => {
                    // ID에 특수문자가 있을 수 있으므로 이스케이프 처리
                    const safeId = equipToSelect.replace(/"/g, '\\"');
                    const targetEquipLi = document.querySelector(`#equip-list li[data-id="${safeId}"]`);
                    if (targetEquipLi) targetEquipLi.click();
                }, 100);
            }
        }, 100);
    }
}

/* ==========================================================================
   3. 인증 및 사용자 관리 (Authentication)
   ========================================================================== */
function checkLoginStatus() {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
    const role = sessionStorage.getItem('userRole');
    const userId = sessionStorage.getItem('userId');

    const loginModal = document.getElementById('login-modal');
    const userInfo = document.getElementById('user-info');
    const btnLoginLogout = document.getElementById('btn-login-logout');
    const btnUserSettings = document.getElementById('btn-user-settings');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    const homeLoginContainer = document.getElementById('home-login-container');

    // [추가] 모바일 컨트롤 요소
    const mobileUserInfo = document.getElementById('mobile-user-info');
    const mobileBtnLogin = document.getElementById('mobile-btn-login-logout');
    const mobileBtnSettings = document.getElementById('mobile-btn-user-settings');

    if (isLoggedIn) {
        if (loginModal) loginModal.style.display = 'none';
        if (userInfo) {
            userInfo.textContent = `${userId} (${role === 'admin' ? '관리자' : '일반'})`;
            userInfo.style.display = 'inline';
        }
        if (btnLoginLogout) {
            btnLoginLogout.textContent = '로그아웃';
            btnLoginLogout.classList.replace('btn-blue', 'btn-gray');
        }
        if (btnUserSettings) btnUserSettings.style.display = 'inline-block';
        
        // [추가] 모바일 업데이트
        if (mobileUserInfo) {
            mobileUserInfo.textContent = `${userId} (${role === 'admin' ? '관리자' : '일반'})`;
            mobileUserInfo.style.display = 'block';
        }
        if (mobileBtnLogin) {
            mobileBtnLogin.textContent = '로그아웃';
            mobileBtnLogin.classList.replace('btn-blue', 'btn-gray');
        }
        if (mobileBtnSettings) mobileBtnSettings.style.display = 'block';

        if (dashboardWrapper) dashboardWrapper.style.filter = 'none';
        document.body.classList.remove('role-admin', 'role-user');
        document.body.classList.add(`role-${role}`);
    } else {
        if (loginModal && !homeLoginContainer) loginModal.style.display = 'flex';
        if (userInfo) userInfo.style.display = 'none';
        if (btnLoginLogout) {
            btnLoginLogout.textContent = '로그인';
            btnLoginLogout.classList.replace('btn-gray', 'btn-blue');
        }
        if (btnUserSettings) btnUserSettings.style.display = 'none';

        // [추가] 모바일 업데이트
        if (mobileUserInfo) mobileUserInfo.style.display = 'none';
        if (mobileBtnLogin) {
            mobileBtnLogin.textContent = '로그인';
            mobileBtnLogin.classList.replace('btn-gray', 'btn-blue');
        }
        if (mobileBtnSettings) mobileBtnSettings.style.display = 'none';

        document.body.classList.remove('role-admin', 'role-user');
    }

    // [추가] 모바일 메뉴 링크 제어 (로그인 상태에 따라 표시/숨김)
    const mobileNav = document.getElementById('mobile-nav');
    if (mobileNav) {
        const setupLink = mobileNav.querySelector('a[href*="setup"]');
        const maintLink = mobileNav.querySelector('a[href*="maintenance"]');
        if (setupLink) setupLink.style.display = isLoggedIn ? 'block' : 'none';
        if (maintLink) maintLink.style.display = isLoggedIn ? 'block' : 'none';
    }
}

function handleLoginLogoutClick() {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
    if (isLoggedIn) {
        if (confirm('로그아웃 하시겠습니까?')) {
            // [보안] 서버 로그아웃 요청
            fetch('/api/logout', { 
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrf_token') } // [보안] CSRF 토큰 추가
            }).then(() => {
                localStorage.removeItem('lastHomeSection');
                localStorage.removeItem('setupDashboardFilter');
                localStorage.removeItem('currentGanttFilters');
                sessionStorage.clear();
                location.reload();
            });
        }
    } else {
        const homeLoginId = document.getElementById('home-login-id');
        if (homeLoginId) {
            homeLoginId.focus();
        } else {
            checkLoginStatus();
        }
    }
}

function attemptLogin(id, pw, context) {
    // [수정] 서버 API를 통한 로그인 검증
    fetch('/api/login', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrf_token') // [보안] CSRF 토큰 추가
        },
        body: JSON.stringify({ id: id, pw: pw })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            sessionStorage.setItem('isLoggedIn', 'true');
            sessionStorage.setItem('userId', id);
            sessionStorage.setItem('userRole', data.role);
            addSystemLog('LOGIN', id, `로그인 성공 (${context})`);

            const homeLoginContainer = document.getElementById('home-login-container');
            if (homeLoginContainer) {
                document.getElementById('home-login-container').style.display = 'none';
                document.getElementById('home-welcome-container').style.display = 'flex';
                updateHomeDashboard();
                checkLoginStatus();
            } else {
                location.reload();
            }
        } else {
            alert(data.message || '로그인 실패');
        }
    })
    .catch(err => {
        console.error('Login error:', err);
        alert('로그인 중 오류가 발생했습니다.');
    });
}

function openUserModal() {
    const modal = document.getElementById('user-modal');
    const adminPanel = document.getElementById('admin-panel');
    const role = sessionStorage.getItem('userRole');

    if (modal) {
        modal.style.display = 'flex';
        if (adminPanel) {
            adminPanel.style.display = (role === 'admin') ? 'block' : 'none';
        }
    }
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.style.display = 'none';
    ['new-user-id', 'new-user-pw', 'change-pw-current', 'change-pw-new'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function addNewUser() {
    const id = document.getElementById('new-user-id').value.trim();
    const pw = document.getElementById('new-user-pw').value.trim();
    const role = document.getElementById('new-user-role').value;

    if (!id || !pw) return alert('아이디와 비밀번호를 입력해주세요.');
    
    // [수정] 서버 API 호출
    fetch('/api/user/add', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrf_token') // [보안] CSRF 토큰 추가
        },
        body: JSON.stringify({ id, pw, role })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            addSystemLog('ADD_USER', id, `Role: ${role}`);
            alert('계정이 추가되었습니다.');
            document.getElementById('new-user-id').value = '';
            document.getElementById('new-user-pw').value = '';
        } else {
            alert(data.message || '계정 추가 실패');
        }
    });
}

function changePassword() {
    const currentPw = document.getElementById('change-pw-current').value;
    const newPw = document.getElementById('change-pw-new').value;
    const userId = sessionStorage.getItem('userId');

    if (!currentPw || !newPw) return alert('현재 비밀번호와 새 비밀번호를 입력해주세요.');
    
    // [수정] 서버 API 호출
    fetch('/api/user/password', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrf_token') // [보안] CSRF 토큰 추가
        },
        body: JSON.stringify({ id: userId, current_pw: currentPw, new_pw: newPw })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            addSystemLog('CHANGE_PW', userId, '비밀번호 변경');
            alert('비밀번호가 변경되었습니다.');
            closeUserModal();
        } else {
            alert(data.message || '비밀번호 변경 실패');
        }
    });
}


/* ==========================================================================
   4. 사이드바 및 리스트 관리 (Sidebar & List)
   ========================================================================== */
function renderSites() {
    const list = document.getElementById('site-list');
    if (!list) return;
    list.innerHTML = '';

    Object.keys(storageData).forEach(name => {
        const li = createListItem(name, name, 'site', (selectedSite) => {
            const equipSection = document.getElementById('equip-section');
            const eInput = document.getElementById('equip-input');
            const eModelInput = document.getElementById('equip-model-input');
            const eBtn = document.getElementById('equip-add-btn');

            equipSection.classList.remove('disabled');
            eInput.disabled = false;
            if (eModelInput) eModelInput.disabled = false;
            eBtn.disabled = false;

            renderEquips(selectedSite);
        });
        list.appendChild(li);
    });

    const searchInput = document.getElementById('site-search');
    if (searchInput && searchInput.value) {
        filterList('site-list', searchInput.value);
    }

    const countEl = document.getElementById('site-count');
    if (countEl) countEl.textContent = Object.keys(storageData).length;
}

function renderEquips(siteName) {
    const list = document.getElementById('equip-list');
    if (!list) return;
    list.innerHTML = '';

    if (storageData[siteName]) {
        storageData[siteName].forEach(name => {
            const key = `details_${siteName}_${name}`;
            const detailData = JSON.parse(localStorage.getItem(key)) || {};
            const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

            const parts = name.split('::');
            const equipName = parts[0];
            const modelName = parts.length > 1 ? parts[1] : '';
            const displaySubText = modelName ? `/ ${modelName}` : '';

            const li = createListItem(name, equipName, 'equip', (selectedEquip) => {
                onEquipClick(siteName, selectedEquip);
            }, displaySubText);

            li.dataset.custName = custEquipName;
            list.appendChild(li);
        });
    }

    const searchInput = document.getElementById('equip-search');
    if (searchInput && searchInput.value) {
        filterList('equip-list', searchInput.value);
    }

    const countEl = document.getElementById('equip-count');
    if (countEl) {
        countEl.textContent = storageData[siteName] ? storageData[siteName].length : 0;
    }
}

function createListItem(id, text, type, onSelect, subText = '') {
    const li = document.createElement('li');
    li.dataset.id = id;
    li.draggable = true;

    li.addEventListener('dragstart', () => {
        li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        handleReorder(type);
    });

    li.innerHTML = `
        <div class="item-wrapper">
            <span class="item-text" contenteditable="false">${escapeHtml(text)}</span>
            ${subText ? `<span class="item-subtext">${escapeHtml(subText)}</span>` : ''}
        </div>
        <span class="icons">
            <span class="edit-btn">✏️</span>
            <span class="del-btn">✕</span>
        </span>
    `;

    const textSpan = li.querySelector('.item-text');
    const editBtn = li.querySelector('.edit-btn');

    editBtn.onclick = (e) => {
        e.stopPropagation();
        const isEditing = li.classList.contains('editing-mode');

        if (!isEditing) {
            li.draggable = false;
            editBtn.textContent = '✅';
            li.classList.add('editing-mode');

            if (type === 'equip') {
                const parts = id.split('::');
                const currentName = parts[0];
                const currentModel = parts.length > 1 ? parts[1] : '';

                const wrapper = li.querySelector('.item-wrapper');
                wrapper.innerHTML = `
                    <input type="text" class="edit-name-input" value="${currentName}" style="width: 100px;">
                    <input type="text" class="edit-model-input" value="${currentModel}" placeholder="Serial No." style="width: 80px;">
                `;

                const nameInput = wrapper.querySelector('.edit-name-input');
                const modelInput = wrapper.querySelector('.edit-model-input');

                nameInput.focus();

                [nameInput, modelInput].forEach(input => {
                    input.onclick = (ev) => ev.stopPropagation();
                    input.onkeypress = (ev) => {
                        if (ev.key === 'Enter') finalizeEdit();
                    };
                });
            } else {
                textSpan.contentEditable = true;
                textSpan.spellcheck = false;
                textSpan.focus();
            }
        } else {
            finalizeEdit();
        }
    };

    function finalizeEdit() {
        li.draggable = true;
        editBtn.textContent = '✏️';
        li.classList.remove('editing-mode');

        let newId = id;

        if (type === 'equip') {
            const wrapper = li.querySelector('.item-wrapper');
            const nameInput = wrapper.querySelector('.edit-name-input');
            const modelInput = wrapper.querySelector('.edit-model-input');

            if (nameInput) {
                const newName = nameInput.value.trim();
                // [수정] modelInput 값 안전하게 가져오기 (DOM 유실 대비)
                let newModel = '';
                if (modelInput) {
                    newModel = modelInput.value.trim();
                } else {
                    // input이 없으면 기존 id에서 모델명 추출 시도 (비정상 상황 방어)
                    const parts = id.split('::');
                    if (parts.length > 1) newModel = parts[1];
                }

                if (newName) {
                    newId = newModel ? `${newName}::${newModel}` : newName;
                }
            }
        } else {
            textSpan.contentEditable = false;
            const newName = textSpan.textContent.trim();
            if (newName) newId = newName;
        }

        if (newId && newId !== id) {
            // [추가] Serial No 삭제 방지 안전장치 (실수로 지워지는 것 방지)
            if (type === 'equip' && id.includes('::') && !newId.includes('::')) {
                if (!confirm(`Serial No가 입력되지 않았습니다.\n기존 Serial No가 삭제됩니다. 계속하시겠습니까?`)) {
                    // 취소 시 원래 상태로 복구 (리스트 재렌더링)
                    const activeSiteLi = document.querySelector('#site-list li.active');
                    if (activeSiteLi) {
                        const siteName = activeSiteLi.querySelector('.item-text').textContent.trim();
                        renderEquips(siteName);
                    }
                    return;
                }
            }
            handleRename(id, newId, type);
            addSystemLog('RENAME_ITEM', id, `New Name: ${newId}, Type: ${type}`);
        } else {
            if (type === 'equip') {
                const activeSiteLi = document.querySelector('#site-list li.active');
                if (activeSiteLi) {
                    const siteName = activeSiteLi.querySelector('.item-text').textContent.trim();
                    renderEquips(siteName);
                }
            } else {
                textSpan.textContent = text;
            }
        }
    }

    textSpan.onkeypress = (e) => { if (e.key === 'Enter') { e.preventDefault(); finalizeEdit(); } };
    textSpan.onblur = () => { if (textSpan.contentEditable === 'true') finalizeEdit(); };

    li.querySelector('.del-btn').onclick = (e) => {
        e.stopPropagation();
        if (confirm(`'${text}' 항목을 삭제하시겠습니까?`)) {
            if (type === 'site') {
                // [추가] 사이트 삭제 시 관련 장비 데이터(details_) 일괄 삭제
                const prefix = `details_${id}_`;
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith(prefix)) localStorage.removeItem(k);
                });

                // [추가] setup_data에서도 삭제
                const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
                Object.keys(setupData).forEach(k => {
                    if (k.startsWith(`${id}::`)) delete setupData[k];
                });
                localStorage.setItem('setup_data', JSON.stringify(setupData));

                delete storageData[id];
                addSystemLog('DELETE_SITE', id);
                renderSites();
                document.getElementById('equip-list').innerHTML = '';
            } else {
                const activeSiteLi = document.querySelector('#site-list li.active');
                const siteName = activeSiteLi.querySelector('.item-text').textContent.trim();
                storageData[siteName] = storageData[siteName].filter(i => i !== id);
                
                // [추가] 장비 삭제 시 관련 데이터(details_) 삭제
                const key = `details_${siteName}_${id}`;
                localStorage.removeItem(key);

                // [추가] setup_data에서도 삭제
                const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
                const equipKey = `${siteName}::${id}`;
                if (setupData[equipKey]) {
                    delete setupData[equipKey];
                    localStorage.setItem('setup_data', JSON.stringify(setupData));
                }

                addSystemLog('DELETE_EQUIP', id, `Site: ${siteName}`);
                renderEquips(siteName);
            }
            saveData();
        }
    };

    li.onclick = () => {
        if (!checkUnsavedChanges()) return;
        
        // [추가] 모바일: 대분류/중분류 선택 시 해당 항목만 표시하고 나머지 접기
        if (window.innerWidth <= 950) {
            const isActive = li.classList.contains('active');
            const siblings = Array.from(li.parentElement.children);
            
            if (isActive) {
                // 이미 선택된 항목을 다시 클릭하면 전체 펼치기/접기 토글
                const anyHidden = siblings.some(sib => sib !== li && sib.style.display === 'none');
                siblings.forEach(sib => {
                    if (sib !== li) sib.style.display = anyHidden ? '' : 'none';
                });
                return; // 데이터 재로드는 건너뜀
            } else {
                // 새로운 항목 선택 시 형제 요소 숨김
                siblings.forEach(sib => {
                    if (sib !== li) sib.style.display = 'none';
                });
            }
        }

        li.parentElement.querySelectorAll('li').forEach(i => i.classList.remove('active'));
        li.classList.add('active');
        onSelect(id);
    };

    return li;
}

function filterList(listId, keyword) {
    const list = document.getElementById(listId);
    if (!list) return;
    const items = list.querySelectorAll('li');
    const key = keyword.toLowerCase();

    items.forEach(item => {
        const text = item.querySelector('.item-text').textContent.toLowerCase();
        const subText = item.querySelector('.item-subtext') ? item.querySelector('.item-subtext').textContent.toLowerCase() : '';
        const custName = item.dataset.custName ? item.dataset.custName.toLowerCase() : '';

        if (text.includes(key) || subText.includes(key) || custName.includes(key)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

function handleRename(oldName, newName, type) {
    if (type === 'site') {
        if (storageData[newName]) {
            alert('이미 존재하는 이름입니다.');
            renderSites();
            return;
        }
        storageData[newName] = storageData[oldName];
        delete storageData[oldName];

        const oldPrefix = `details_${oldName}_`;
        const newPrefix = `details_${newName}_`;

        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(oldPrefix)) {
                const suffix = key.substring(oldPrefix.length);
                const newKey = newPrefix + suffix;
                localStorage.setItem(newKey, localStorage.getItem(key));
                localStorage.removeItem(key);
            }
        });

        saveData();
        renderSites();
    } else if (type === 'equip') {
        const activeSiteLi = document.querySelector('#site-list li.active');
        if (!activeSiteLi) return;
        const siteName = activeSiteLi.querySelector('.item-text').textContent.trim();

        if (storageData[siteName].includes(newName)) {
            alert('이미 존재하는 이름입니다.');
            renderEquips(siteName);
            return;
        }

        const idx = storageData[siteName].indexOf(oldName);
        if (idx !== -1) storageData[siteName][idx] = newName;

        const oldKey = `details_${siteName}_${oldName}`;
        const newKey = `details_${siteName}_${newName}`;
        const data = localStorage.getItem(oldKey);
        if (data) {
            localStorage.setItem(newKey, data);
            const parsedData = JSON.parse(data);
            if (!parsedData.setup) parsedData.setup = {};
            const parts = newName.split('::');
            parsedData.setup.model = parts.length > 1 ? parts[1] : '';
            localStorage.setItem(newKey, JSON.stringify(parsedData));
            localStorage.removeItem(oldKey);
        }

        // [추가] setup_data 키 변경
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const oldEquipKey = `${siteName}::${oldName}`;
        const newEquipKey = `${siteName}::${newName}`;
        if (setupData[oldEquipKey]) {
            setupData[newEquipKey] = setupData[oldEquipKey];
            delete setupData[oldEquipKey];
            localStorage.setItem('setup_data', JSON.stringify(setupData));
        }

        saveData();
        renderEquips(siteName);

        if (currentPath.site === siteName && currentPath.equip === oldName) {
            onEquipClick(siteName, newName);
        }
    }
}

function getDragAfterElement(container, y, selector) {
    const draggableElements = [...container.querySelectorAll(selector)];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleReorder(type) {
    if (type === 'site') {
        const newOrder = {};
        document.querySelectorAll('#site-list li').forEach(li => {
            const key = li.dataset.id;
            if (storageData[key]) newOrder[key] = storageData[key];
        });
        storageData = newOrder;
        saveData();
    } else if (type === 'equip') {
        const activeSiteLi = document.querySelector('#site-list li.active');
        if (!activeSiteLi) return;
        const siteName = activeSiteLi.dataset.id;

        const newEquips = [];
        document.querySelectorAll('#equip-list li').forEach(li => newEquips.push(li.dataset.id));

        if (storageData[siteName]) {
            storageData[siteName] = newEquips;
            saveData();
        }
    }
}

/* ==========================================================================
   4. 상세 화면 오케스트레이션 (Detail View)
   ========================================================================== */
function onEquipClick(site, equip) {
    currentPath = { site, equip };

    // [수정] 페이지별로 마지막 선택 상태 분리 저장
    if (window.location.pathname.indexOf('setup') !== -1) {
        sessionStorage.setItem('lastSetupPath', JSON.stringify(currentPath));
    } else if (window.location.pathname.indexOf('maintenance') !== -1) {
        sessionStorage.setItem('lastMaintPath', JSON.stringify(currentPath));
    }

    const detailWindow = document.getElementById('detail-window');
    detailWindow.classList.remove('disabled');
    detailWindow.querySelector('.placeholder-view').style.display = 'none';
    detailWindow.querySelector('.detail-content').style.display = 'flex';

    const nameParts = equip.split('::');
    const displayEquipName = nameParts[0];
    const displaySerialNo = nameParts.length > 1 ? nameParts[1] : '';

    const pathText = displaySerialNo ? `📍 ${site} > ${displayEquipName} > ${displaySerialNo}` : `📍 ${site} > ${displayEquipName}`;
    document.getElementById('current-path').textContent = pathText;

    // 장비 변경 시 선택된 로그 및 메모 초기화
    selectedLogId = null;
    originalMemo = "";
    const memoInput = document.getElementById('device-memo');
    if (memoInput) memoInput.value = "";
    const memoBtn = document.getElementById('memo-save-btn');
    if (memoBtn) {
        memoBtn.classList.remove('btn-orange-sm', 'btn-blue-sm');
        memoBtn.classList.add('btn-green-sm');
    }

    // 마스터 정보 로드 (공통)
    const EquipNameInput = document.getElementById('DeviceID-equip-name');
    if (EquipNameInput) {
        const key = `details_${site}_${equip}`;
        const data = JSON.parse(localStorage.getItem(key)) || {};
        const setup = data.setup || {};
        const parts = equip.split('::');

        document.getElementById('DeviceID-site-name').value = site || '';
        document.getElementById('DeviceID-equip-name').value = parts[0] || '';
        document.getElementById('DeviceID-serial-no').value = (parts.length > 1 ? parts[1] : '');
        document.getElementById('DeviceID-cust-equip-name').value = setup.custEquipName || '';
        document.getElementById('DeviceID-building').value = setup.building || '';
        document.getElementById('DeviceID-floor').value = setup.floor || '';
        document.getElementById('DeviceID-detail-loc').value = setup.detailLoc || '';
        document.getElementById('DeviceID-manager').value = setup.manager || '';
        document.getElementById('DeviceID-contact').value = setup.contact || '';
        document.getElementById('DeviceID-email').value = setup.email || '';
        document.getElementById('DeviceID-cust-manager').value = setup.custManager || '';
        document.getElementById('DeviceID-cust-contact').value = setup.custContact || '';
        document.getElementById('DeviceID-cust-email').value = setup.custEmail || '';

        originalSetupData = getCurrentSetupData();
        if (typeof updateSetupSaveBtnState === 'function') updateSetupSaveBtnState();
    }

    // 페이지별 렌더링 함수 호출
    if (typeof renderDetails === 'function') renderDetails();
    if (typeof renderLogs === 'function') {
        renderLogs();
        // [추가] 최신 로그 자동 선택 (마지막 작업 내용 표시)
        if (typeof selectLog === 'function') {
            const key = `details_${site}_${equip}`;
            const data = JSON.parse(localStorage.getItem(key)) || {};
            if (data.logs && data.logs.length > 0) {
                // 최신순 정렬
                data.logs.sort((a, b) => {
                    if (b.date !== a.date) return b.date.localeCompare(a.date);
                    return b.id - a.id;
                });
                selectLog(data.logs[0].id, false); // 포커스 없이 선택
            }
        }
    }
    if (typeof renderParts === 'function') renderParts();
    // [추가] 특이사항 렌더링 (버튼 상태 갱신)
    if (typeof renderSpecialNote === 'function') renderSpecialNote();
}

function getCurrentSetupData() {
    const data = {};
    setupInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) data[id] = el.value;
    });
    return data;
}

function hasUnsavedSetupChanges() {
    if (!originalSetupData) return false;
    const currentData = getCurrentSetupData();
    return setupInputIds.some(id => currentData[id] !== originalSetupData[id]);
}

function checkUnsavedChanges() {
    if (hasUnsavedSetupChanges()) {
        return confirm('장비 마스터 정보에 저장되지 않은 변경사항이 있습니다. 저장하지 않고 이동하시겠습니까?');
    }
    return true;
}

/* ==========================================================================
   7. 데이터 관리 및 시스템 로그 (Data & Logs)
   ========================================================================== */
function exportData() {
    const allData = {};
    const mainData = localStorage.getItem('withtech_data');
    if (mainData) allData['withtech_data'] = JSON.parse(mainData);
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('details_') || key === 'setup_data') allData[key] = JSON.parse(localStorage.getItem(key));
    }
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maintenance_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addSystemLog('BACKUP_EXPORT', 'System', '데이터 백업 저장');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!confirm('현재 데이터를 모두 덮어쓰고 백업 파일로 복원하시겠습니까?\n(주의: 복원 후 기존 데이터는 사라집니다.)')) {
                event.target.value = ''; return;
            }
            
            // [추가] 0. 기존 데이터 삭제 (Clean Import: 기존 쿠키 데이터와 섞이지 않도록 초기화)
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key === 'withtech_data' || key.startsWith('details_') || key === 'setup_data' || key === 'system_logs') {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => originalRemoveItem.call(localStorage, key));

            // 1. LocalStorage 업데이트 (불러온 데이터로 채움)
            Object.keys(importedData).forEach(key => {
                if (key === 'withtech_data' || key.startsWith('details_') || key === 'setup_data' || key === 'system_logs') {
                    originalSetItem.call(localStorage, key, JSON.stringify(importedData[key]));
                }
            });

            // 2. 시스템 로그 추가
            const logs = JSON.parse(localStorage.getItem('system_logs')) || [];
            logs.push({ timestamp: new Date().toISOString(), action: 'BACKUP_IMPORT', target: 'System', details: '데이터 복원 완료' });
            originalSetItem.call(localStorage, 'system_logs', JSON.stringify(logs));

            // 3. 서버로 데이터 즉시 전송 (페이지 리로드 전 저장 보장)
            const allData = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key === 'withtech_data' || key.startsWith('details_') || key === 'system_logs' || key === 'setup_data') {
                    try { allData[key] = JSON.parse(localStorage.getItem(key)); } 
                    catch (e) { allData[key] = localStorage.getItem(key); }
                }
            }

            fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                body: JSON.stringify(allData)
            })
            .then(() => {
                alert('데이터 복원 및 서버 저장이 완료되었습니다.');
                location.reload();
            })
            .catch(err => {
                console.error('Import sync failed:', err);
                alert('서버 저장에 실패했습니다. 로컬 데이터만 갱신됩니다.');
                location.reload();
            });
        } catch (err) { alert('올바르지 않은 백업 파일입니다.'); console.error(err); }
    };
    reader.readAsText(file);
}

function addSystemLog(action, target, details = "") {
    const logs = JSON.parse(localStorage.getItem('system_logs')) || [];
    logs.push({ timestamp: new Date().toISOString(), action: action, target: target, details: details });
    localStorage.setItem('system_logs', JSON.stringify(logs));
}

function openLogModal() {
    const modal = document.getElementById('log-modal');
    if (modal) { modal.style.display = 'flex'; renderSystemLogs(); }
}

function closeLogModal() {
    const modal = document.getElementById('log-modal');
    if (modal) modal.style.display = 'none';
}

function renderSystemLogs() {
    const logs = JSON.parse(localStorage.getItem('system_logs')) || [];
    const tbody = document.getElementById('system-log-body');
    if (!tbody) return;

    // [추가] 필터링 로직
    const filteredLogs = logs.filter(log => {
        if (currentLogFilter === 'all') return true;
        const category = getLogCategory(log.action);
        return category === currentLogFilter;
    });

    if (filteredLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: #8b949e;">로그 내역이 없습니다.</td></tr>';
        return;
    }

    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    tbody.innerHTML = filteredLogs.map(log => `<tr><td>${new Date(log.timestamp).toLocaleString()}</td><td><span class="badge pm" style="background: #30363d;">${log.action}</span></td><td>${log.target}</td><td>${log.details}</td></tr>`).join('');
}

// [추가] 로그 카테고리 분류 함수
function getLogCategory(action) {
    const commonActions = ['LOGIN', 'LOGOUT', 'ADD_USER', 'CHANGE_PW', 'ADD_SITE', 'DELETE_SITE', 'ADD_EQUIP', 'DELETE_EQUIP', 'RENAME_ITEM', 'BACKUP_EXPORT', 'BACKUP_IMPORT'];
    const setupActions = [
        'UPDATE_SETUP', 'ADD_SETUP_ITEM', 'DELETE_SETUP_ITEM', 'UPDATE_SETUP_ITEM', 'REORDER_SETUP',
        'UPDATE_SETUP_DETAILS', 'UPDATE_SETUP_STATUS', 'CALC_SETUP_SCHEDULE', 'START_SETUP_EXEC',
        'UPDATE_SETUP_COMPLETION', 'ADD_SETUP_LOG', 'DELETE_SETUP_LOG', 'UPDATE_SETUP_LOG_MEMO', 'UPDATE_SETUP_LOG'
    ];
    
    if (commonActions.includes(action)) return 'common';
    if (setupActions.includes(action)) return 'setup';
    
    // 나머지는 운영관리(maint)로 간주 (ADD_MAINTENANCE, ADD_LOG 등)
    return 'maint';
}

function clearSystemLogs() {
    if (confirm('모든 시스템 로그를 삭제하시겠습니까?')) {
        localStorage.removeItem('system_logs');
        renderSystemLogs();
    }
}
/* ==========================================================================
   유틸리티: 영업일 계산 (Business Days Calculation)
   ========================================================================== */
window.getHolidayName = function(year, month, day) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const solarKey = `${mm}-${dd}`;
    const fullKey = `${year}-${mm}-${dd}`;

    const solarHolidays = {
        "01-01": "신정", "03-01": "삼일절", "05-05": "어린이날",
        "06-06": "현충일", "08-15": "광복절", "10-03": "개천절",
        "10-09": "한글날", "12-25": "성탄절"
    };

    const variableHolidays = {
        // 2024
        "2024-02-09": "설날", "2024-02-10": "설날", "2024-02-11": "설날", "2024-02-12": "대체공휴일",
        "2024-04-10": "선거일", "2024-05-06": "대체공휴일", "2024-05-15": "부처님오신날",
        "2024-09-16": "추석", "2024-09-17": "추석", "2024-09-18": "추석",
        // 2025
        "2025-01-28": "설날", "2025-01-29": "설날", "2025-01-30": "설날", "2025-03-03": "대체공휴일",
        "2025-05-05": "부처님오신날", "2025-05-06": "대체공휴일",
        "2025-10-03": "개천절/추석", "2025-10-05": "추석", "2025-10-06": "추석", "2025-10-07": "추석", "2025-10-08": "대체공휴일",
        // 2026
        "2026-02-16": "설날", "2026-02-17": "설날", "2026-02-18": "설날",
        "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일", "2026-06-03": "지방선거",
        "2026-09-25": "추석", "2026-09-26": "추석", "2026-09-27": "추석", "2026-09-28": "대체공휴일", "2026-10-05": "대체공휴일",
        // 2027
        "2027-02-06": "설날", "2027-02-07": "설날", "2027-02-08": "설날", "2027-02-09": "대체공휴일",
        "2027-05-13": "부처님오신날", "2027-08-16": "대체공휴일",
        "2027-09-14": "추석", "2027-09-15": "추석", "2027-09-16": "추석",
        "2027-10-04": "대체공휴일", "2027-10-11": "대체공휴일",
        // 2028
        "2028-01-26": "설날", "2028-01-27": "설날", "2028-01-28": "설날",
        "2028-05-02": "부처님오신날",
        "2028-10-02": "추석", "2028-10-03": "추석/개천절", "2028-10-04": "추석", "2028-10-05": "대체공휴일",
        // 2029
        "2029-02-12": "설날", "2029-02-13": "설날", "2029-02-14": "설날",
        "2029-05-07": "대체공휴일", "2029-05-20": "부처님오신날", "2029-05-21": "대체공휴일",
        "2029-09-21": "추석", "2029-09-22": "추석", "2029-09-23": "추석", "2029-09-24": "대체공휴일",
        // 2030
        "2030-02-02": "설날", "2030-02-03": "설날", "2030-02-04": "설날", "2030-02-05": "대체공휴일",
        "2030-05-06": "대체공휴일", "2030-05-09": "부처님오신날",
        "2030-09-11": "추석", "2030-09-12": "추석", "2030-09-13": "추석"
    };

    return solarHolidays[solarKey] || variableHolidays[fullKey] || null;
};

function isHoliday(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const dayOfWeek = date.getDay();

    // 주말 (토, 일)
    if (dayOfWeek === 0 || dayOfWeek === 6) return true;

    return !!window.getHolidayName(year, month, day);
}

function addBusinessDays(date, days) {
    let result = new Date(date);
    let count = 0;
    const direction = days >= 0 ? 1 : -1;
    const absDays = Math.abs(days);
    
    while (count < absDays) {
        result.setDate(result.getDate() + direction);
        if (!isHoliday(result)) count++;
    }
    return result;
}

// [추가] 전역 스코프에 함수 노출 (다른 스크립트에서 사용 가능하도록)
window.isHoliday = isHoliday;
window.addBusinessDays = addBusinessDays;
