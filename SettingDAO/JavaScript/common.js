/* ==========================================================================
   1. 전역 변수 및 데이터 관리 (Global State)
   ========================================================================== */
let storageData = JSON.parse(localStorage.getItem('device_data')) || {};
let currentPath = { site: '', equip: '' };
let selectedLogId = null;
let originalMemo = "";
let originalSetupData = null;
let currentLogFilter = 'all'; // [추가] 현재 로그 필터 상태
let sessionTimer = null; // [추가] 세션 타이머
let sessionTimeLeft = 1800; // [추가] 세션 유지 시간 (초) - 30분

const setupInputIds = [
    'DeviceID-cust-equip-name', 'DeviceID-building', 'DeviceID-floor', 'DeviceID-detail-loc',
    'DeviceID-equip-status', 'DeviceID-delivery-date', 'DeviceID-warranty-start', 'DeviceID-warranty-period',
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

// [추가] 동기화 대상 키 목록 정의 (데이터 분리 구조 완벽 대응)
const SYNC_KEYS = ['device_data', 'setup_data', 'equipment_models', 'admin_items', 'check_type_categories', 'check_type_items', 'calendar_confirmations'];

function shouldSyncKey(key) {
    return SYNC_KEYS.includes(key) || key.startsWith('details_') || key.startsWith('site_meta_');
}

function saveAllToServer() {
    if (!window.isDataLoaded) return; // [핵심 방어] 서버 데이터 로드 전에는 기존 로컬 데이터가 서버를 덮어쓰는 것을 원천 차단!

    // 연속된 호출 시 이전 타이머 취소 (과도한 요청 방지)
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);

    syncDebounceTimer = setTimeout(() => {
        const allData = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // 동기화할 키 필터링
            if (shouldSyncKey(key)) {
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
        })
            .catch(err => console.error('Server sync failed:', err));
    }, 2000); // 2초 지연 후 전송
}

localStorage.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (shouldSyncKey(key)) {
        saveAllToServer();
    }
};

localStorage.removeItem = function (key) {
    originalRemoveItem.call(this, key);
    if (shouldSyncKey(key)) {
        saveAllToServer();
    }
};

function saveData() {
    localStorage.setItem('device_data', JSON.stringify(storageData));
}

/* ==========================================================================
   2. 초기화 및 이벤트 리스너 (Initialization)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    window.isDataLoaded = false; // 명시적 초기화

    // [변경] 1. 앱 초기화 즉시 실행 (UI 반응성 향상 - 버벅임 제거)
    // 로컬 스토리지에 캐시된 데이터를 사용하여 즉시 화면을 구성합니다.
    initializeApp();

    // [추가] 로그인하지 않은 상태에서는 서버 데이터 요청을 보내지 않음 (401 에러 로그 방지)
    if (sessionStorage.getItem('isLoggedIn') !== 'true') return;

    // 2. 서버 데이터 비동기 로드 (백그라운드 동기화)
    fetchServerData();
});

// [추가] 서버 데이터 로드 및 UI 갱신 함수 (로그인 직후 재사용 가능하도록 분리)
function fetchServerData(callback) {
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
                if (shouldSyncKey(key)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => originalRemoveItem.call(localStorage, key));

            // 서버 데이터를 localStorage에 반영
            Object.keys(data).forEach(key => {
                originalSetItem.call(localStorage, key, JSON.stringify(data[key]));
            });
            // [수정] 전역 변수 갱신 (초기 로드 시 데이터 누락 방지)
            storageData = JSON.parse(localStorage.getItem('device_data')) || {};

            // [중요] 데이터 로드 완료 상태로 변경 (이제부터 saveAllToServer 작동 허용)
            window.isDataLoaded = true;

            // [추가] 데이터 로드 후 기존 데이터 마이그레이션 및 JSON 키 순서 정렬
            migrateDataFormat();

            // [추가] 워런티 만료 장비 자동 전환
            updateWarrantyStatusAutomatically();

            // [추가] 데이터 갱신 후 UI 리프레시 (화면 깜빡임 없이 데이터만 최신화)
            refreshAppViews();

            window.dispatchEvent(new Event('DataLoaded'));
            if (callback) callback();
        })
        .catch(err => {
            console.error('Failed to load data from server:', err);
            // 실패해도 이미 로컬 데이터로 초기화되었으므로 추가 조치 불필요
            window.isDataLoaded = true;
            window.dispatchEvent(new Event('DataLoaded'));
            if (callback) callback();
        });
}

// [수정] 기존 PM 데이터 변환 및 JSON 저장 시 원하는 키 순서로 자동 재정렬하는 함수
function migrateDataFormat() {
    let isModified = false;

    const reorderObject = (obj, order, fillEmpty = false) => {
        const newObj = {};
        order.forEach(k => { 
            if (obj.hasOwnProperty(k) && obj[k] !== undefined && obj[k] !== null) newObj[k] = obj[k]; 
            else if (fillEmpty) newObj[k] = ""; 
        });
        Object.keys(obj).forEach(k => { if (!order.includes(k)) newObj[k] = obj[k]; });
        return newObj;
    };

    // 1. admin_items 마이그레이션 및 키 순서 정렬 (item_data.json)
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    const itemKeyOrder = ['id', 'detailType', 'additional', 'partno', 'code', 'part', 'spec', 'equip'];

    const newAdminItems = adminItems.map(item => {
        return reorderObject(item, itemKeyOrder);
    });
    if (JSON.stringify(adminItems) !== JSON.stringify(newAdminItems)) {
        localStorage.setItem('admin_items', JSON.stringify(newAdminItems));
        isModified = true;
    }

    // 2. details_* 마이그레이션 (유지관리, 이력 변환 및 키 순서 정렬)
    const maintKeyOrder = ['id', 'type', 'detailType', 'code', 'content', 'date', 'period', 'scheduledDate', 'costType', 'md', 'worker', 'memo'];
    const logKeyOrder = ['id', 'date', 'type', 'detailType', 'detailType2', 'content', 'costType', 'md', 'worker', 'memo'];
    const setupKeyOrder = [
        'custEquipName', 'equipStatus', 'deliveryDate', 'warrantyStart', 'warrantyPeriod',
        'building', 'floor', 'detailLoc',
        'manager', 'contact', 'email',
        'custManager', 'custContact', 'custEmail'
    ];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('details_')) {
            try {
                let detailData = JSON.parse(localStorage.getItem(key));
                let detailModified = false;

                if (detailData.maint) {
                    const newMaint = detailData.maint.map(m => {
                        if (m.type === 'PM') m.type = '정기';
                        return reorderObject(m, maintKeyOrder);
                    });
                    if (JSON.stringify(detailData.maint) !== JSON.stringify(newMaint)) {
                        detailData.maint = newMaint;
                        detailModified = true;
                    }
                }
                if (detailData.logs) {
                    const newLogs = detailData.logs.map(l => {
                        if (l.type === 'PM') l.type = '정기';
                        return reorderObject(l, logKeyOrder);
                    });
                    if (JSON.stringify(detailData.logs) !== JSON.stringify(newLogs)) {
                        detailData.logs = newLogs;
                        detailModified = true;
                    }
                }

            // [추가] 셋업(장비 마스터) 정보 정렬 및 빈 값 채우기
            if (!detailData.setup) detailData.setup = {};
            const oldSetupStr = JSON.stringify(detailData.setup);
            const newSetup = reorderObject(detailData.setup, setupKeyOrder, true);
            if (oldSetupStr !== JSON.stringify(newSetup)) {
                detailData.setup = newSetup;
                detailModified = true;
            }

                if (detailModified) {
                    localStorage.setItem(key, JSON.stringify(detailData));
                    isModified = true; // 저장 감지 트리거
                }
            } catch (e) { }
        }
    }
}

// [추가] 워런티 기간 만료 시 '가동 장비'로 자동 전환하는 함수
function updateWarrantyStatusAutomatically() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('details_')) {
            try {
                let detailData = JSON.parse(localStorage.getItem(key));
                if (detailData && detailData.setup) {
                    if (detailData.setup.equipStatus === '워런티' && detailData.setup.warrantyStart && detailData.setup.warrantyPeriod) {
                        const startStr = detailData.setup.warrantyStart;
                        const period = parseInt(detailData.setup.warrantyPeriod);
                        
                        if (!isNaN(period) && startStr) {
                            const [y, m, d] = startStr.split('-').map(Number);
                            const startDate = new Date(y, m - 1, d);
                            
                            const endDate = new Date(startDate);
                            endDate.setMonth(endDate.getMonth() + period);
                            
                            if (endDate < today) {
                                detailData.setup.equipStatus = '가동 장비';
                                localStorage.setItem(key, JSON.stringify(detailData));
                                
                                const parts = key.split('_');
                                if (parts.length >= 3) {
                                    const equipName = parts.slice(2).join('_');
                                    if (typeof addSystemLog === 'function') {
                                        addSystemLog('UPDATE_EQUIP_STATUS', equipName, '워런티 기간 만료에 따른 가동 장비 자동 전환');
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    }
}

function initializeApp() {
    // 2-1. 초기 설정
    // [추가] 하드코딩된 HTML의 PM 속성을 정기로 일괄 변환 (UI 호환성)
    document.querySelectorAll('option[value="PM"]').forEach(opt => {
        opt.value = '정기';
        opt.textContent = '정기';
    });
    document.querySelectorAll('button[data-type="PM"]').forEach(btn => {
        btn.dataset.type = '정기';
        if (btn.textContent.trim() === 'PM') btn.textContent = '정기';
    });
    
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
    // Home 화면인 경우 대시보드 갱신
    if (document.getElementById('home-welcome-container') && sessionStorage.getItem('isLoggedIn') === 'true') {
        if (typeof updateHomeDashboard === 'function') {
            updateHomeDashboard();
        }
    }

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
    // [수정] 모달 바깥쪽(배경) 클릭 시 닫히는 기능 제거 (오직 X 버튼으로만 닫힘)
    // if (userModal) userModal.addEventListener('click', (e) => { if (e.target === userModal) closeUserModal(); });
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

    // [추가] 모바일 현재 페이지 타이틀 텍스트 요소 생성
    let mobilePageTitle = document.getElementById('mobile-page-title');
    if (!mobilePageTitle) {
        mobilePageTitle = document.createElement('div');
        mobilePageTitle.id = 'mobile-page-title';
        mobilePageTitle.className = 'mobile-page-title';

        // 현재 활성화된 메뉴 텍스트 찾기
        const activeLink = document.querySelector('.header .container .nav-links a.active');
        let titleText = 'HOME';
        if (activeLink) {
            titleText = activeLink.textContent.trim();
        }
        mobilePageTitle.textContent = titleText;

        header.insertBefore(mobilePageTitle, hamburger);
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
    mobileNav.addEventListener('click', function (e) {
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
                    localStorage.removeItem('maintDashboardFilter'); // [추가]
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
    const equipInputGroup = equipInputEl ? equipInputEl.closest('.sidebar-input-group') : null;
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
                // [추가] 장비 모델 제안 박스에 있는 항목인지 검증 (선택 강제)
                let equipmentModels = [];
                try {
                    equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                } catch (e) { }

                if (!equipmentModels.some(m => m.name === equipVal)) {
                    return alert('등록되지 않은 장비 명입니다. 검색 제안 박스에서 항목을 선택해주세요.');
                }

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

    // [추가] 장비 추가 시 장비 모델 제안 박스 (자동완성)
    const equipSuggestionList = document.getElementById('equip-input-suggestions');
    if (equipInput && equipSuggestionList) {
        const showEquipSuggestions = () => {
            if (equipInput.disabled) return;
            const query = equipInput.value.trim().toLowerCase();
            const keywords = query ? query.split(/\s+/) : [];

            let equipmentModels = [];
            try {
                equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
            } catch (e) { }

            let matches = equipmentModels;
            if (query) {
                matches = equipmentModels.filter(m => {
                    const text = `${m.name} ${m.abbr}`.toLowerCase();
                    return keywords.every(kw => text.includes(kw));
                });
            }

            equipSuggestionList.innerHTML = '';
            if (matches.length > 0) {
                matches.forEach(m => {
                    const li = document.createElement('li');
                    li.className = 'suggestion-item';
                    li.innerHTML = `
                        <div class="suggestion-item-content">
                            <span>${escapeHtml(m.name)}</span>
                            ${m.abbr ? `<span class="abbr">${escapeHtml(m.abbr)}</span>` : ''}
                        </div>
                    `;
                    li.addEventListener('mousedown', (ev) => {
                        ev.preventDefault();
                        equipInput.value = m.name;
                        equipSuggestionList.style.display = 'none';
                        if (equipModelInput) equipModelInput.focus();
                    });
                    equipSuggestionList.appendChild(li);
                });
                equipSuggestionList.style.display = 'block';
            } else {
                equipSuggestionList.style.display = 'none';
            }
        };

        equipInput.addEventListener('click', showEquipSuggestions);
        equipInput.addEventListener('input', showEquipSuggestions);
        equipInput.addEventListener('focus', showEquipSuggestions);
        equipInput.addEventListener('blur', () => {
            setTimeout(() => { equipSuggestionList.style.display = 'none'; }, 150);
        });
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
    // [요청] 관리자(admin) 페이지에서는 접기 기능 비활성화
    if (window.location.pathname.indexOf('admin') !== -1) return;

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

    // [추가] 특정 장비가 선택되지 않았더라도 사업장이 있다면 해당 사업장 폴더를 엽니다.
    if (siteToSelect && !equipToSelect) {
        setTimeout(() => {
            const siteItems = document.querySelectorAll('#site-list .item-text');
            const targetSiteLi = Array.from(siteItems).find(span => span.textContent.trim() === siteToSelect)?.parentElement;
            if (targetSiteLi) targetSiteLi.click();
        }, 100);
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

// [추가] 세션 타이머 관련 함수
function startSessionTimer() {
    stopSessionTimer(); // 기존 타이머 중지
    sessionTimeLeft = 1800; // 30분 리셋 (1800초)
    updateTimerUI();

    sessionTimer = setInterval(() => {
        sessionTimeLeft--;
        updateTimerUI();

        if (sessionTimeLeft <= 0) {
            stopSessionTimer();
            alert('보안을 위해 세션이 만료되었습니다.\n다시 로그인해주세요.');
            // 강제 로그아웃 후 로그인 화면으로 즉시 전환
            fetch('/api/logout', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrf_token') }
            }).then(() => {
                sessionStorage.clear();
                location.reload();
            });
        }
    }, 1000);
}

function stopSessionTimer() {
    if (sessionTimer) {
        clearInterval(sessionTimer);
        sessionTimer = null;
    }
}

function updateTimerUI() {
    const minutes = Math.floor(sessionTimeLeft / 60);
    const seconds = sessionTimeLeft % 60;
    const displayStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    document.querySelectorAll('.session-time-display').forEach(el => {
        el.textContent = displayStr;
        // 시간이 5분(300초) 이하로 남으면 빨간색으로 경고 표시
        el.style.color = sessionTimeLeft <= 300 ? '#f85149' : '';
    });
}

window.extendSession = function () {
    fetch('/api/session/extend', {
        method: 'POST',
        headers: { 'X-CSRFToken': getCookie('csrf_token') }
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                startSessionTimer(); // 타이머 리셋
            }
        })
        .catch(err => console.error('Session extend failed', err));
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

        // [추가] 데스크톱 타이머 UI 동적 생성
        let desktopTimerContainer = document.getElementById('desktop-session-timer');
        const userControls = document.querySelector('.user-controls');
        if (!desktopTimerContainer && userControls) {
            desktopTimerContainer = document.createElement('div');
            desktopTimerContainer.id = 'desktop-session-timer';
            desktopTimerContainer.className = 'session-timer-container';
            desktopTimerContainer.innerHTML = `
                <span class="session-time-display">30:00</span>
                <button class="btn-gray" onclick="extendSession()" style="padding:2px 6px; font-size:11px; margin-left:5px; margin-right:15px; border-radius:3px;">연장</button>
            `;
            userControls.insertBefore(desktopTimerContainer, userControls.firstChild);
        } else if (desktopTimerContainer) {
            desktopTimerContainer.style.display = 'flex';
        }

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

        // [추가] 모바일 타이머 UI 동적 생성
        let mobileTimerContainer = document.getElementById('mobile-session-timer');
        const header = document.querySelector('.header');
        if (!mobileTimerContainer && header) {
            mobileTimerContainer = document.createElement('div');
            mobileTimerContainer.id = 'mobile-session-timer';
            mobileTimerContainer.className = 'session-timer-container mobile-header-timer';
            mobileTimerContainer.innerHTML = `
                <span class="session-time-display" style="color:#e3b341; font-size:14px;">30:00</span>
                <button class="btn-blue" onclick="extendSession()" style="padding:2px 8px; font-size:11px; margin-left:8px; border-radius:4px; font-weight:bold; white-space:nowrap; height:24px;">연장</button>
            `;
            const hamburger = document.getElementById('hamburger-menu');
            if (hamburger) {
                header.insertBefore(mobileTimerContainer, hamburger);
            } else {
                header.appendChild(mobileTimerContainer);
            }
        } else if (mobileTimerContainer) {
            mobileTimerContainer.style.display = 'flex';
        }

        if (dashboardWrapper) dashboardWrapper.style.filter = 'none';
        document.body.classList.remove('role-admin', 'role-user');
        document.body.classList.add(`role-${role}`);

        startSessionTimer(); // [추가] 타이머 작동 시작
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

        // [추가] 로그아웃 시 타이머 UI 숨김 및 중지
        if (document.getElementById('desktop-session-timer')) document.getElementById('desktop-session-timer').style.display = 'none';
        if (document.getElementById('mobile-session-timer')) document.getElementById('mobile-session-timer').style.display = 'none';
        stopSessionTimer();
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
                localStorage.removeItem('maintDashboardFilter'); // [추가] 완전 초기화
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
                sessionStorage.setItem('userSite', data.site || ''); // [추가]
                addSystemLog('LOGIN', id, `로그인 성공 (${context})`);

                const homeLoginContainer = document.getElementById('home-login-container');
                if (homeLoginContainer) {
                    document.getElementById('home-login-container').style.display = 'none';
                    document.getElementById('home-welcome-container').style.display = 'flex';
                    // [수정] 로그인 완료 후 서버에서 최신 데이터를 가져온 뒤 대시보드를 렌더링
                    fetchServerData(() => {
                        checkLoginStatus();
                    });
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

            // [추가] 계정 추가 시 사업장 선택 드롭다운 동적 생성 및 데이터 갱신
            const roleSelect = document.getElementById('new-user-role');
            let siteSelectWrapper = document.getElementById('new-user-site-wrapper');
            let siteSelect = document.getElementById('new-user-site');
            const btnAddUser = document.getElementById('btn-add-user');

            const idInput = document.getElementById('new-user-id');
            const pwInput = document.getElementById('new-user-pw');

            if (idInput) {
                idInput.style.height = '30px';
                idInput.style.padding = '0 8px';
                idInput.style.fontSize = '13px';
                idInput.style.boxSizing = 'border-box';
            }

            // [수정] 비밀번호 확인창 추가 및 같은 줄 배치
            let pwWrapper = document.getElementById('new-user-pw-wrapper');
            if (pwInput && !pwWrapper) {
                pwWrapper = document.createElement('div');
                pwWrapper.id = 'new-user-pw-wrapper';
                pwWrapper.style.display = 'flex';
                pwWrapper.style.gap = '10px';
                pwWrapper.style.width = '100%';

                pwInput.parentNode.insertBefore(pwWrapper, pwInput);
                pwWrapper.appendChild(pwInput);

                pwInput.style.flex = '1';
                pwInput.style.margin = '0';
                pwInput.style.height = '30px';
                pwInput.style.padding = '0 8px';
                pwInput.style.fontSize = '13px';
                pwInput.style.boxSizing = 'border-box';

                const pwConfirmInput = document.createElement('input');
                pwConfirmInput.type = 'password';
                pwConfirmInput.id = 'new-user-pw-confirm';
                pwConfirmInput.placeholder = '비밀번호 확인';
                pwConfirmInput.style.flex = '1';
                pwConfirmInput.style.height = '30px';
                pwConfirmInput.style.padding = '0 8px';
                pwConfirmInput.style.fontSize = '13px';
                pwConfirmInput.style.background = '#0d1117';
                pwConfirmInput.style.border = '1px solid #30363d';
                pwConfirmInput.style.color = '#fff';
                pwConfirmInput.style.borderRadius = '4px';
                pwConfirmInput.style.boxSizing = 'border-box';

                pwWrapper.appendChild(pwConfirmInput);
            }

            let extraInfoWrapper = document.getElementById('new-user-extra-wrapper');

            if (pwWrapper && !extraInfoWrapper) {
                extraInfoWrapper = document.createElement('div');
                extraInfoWrapper.id = 'new-user-extra-wrapper';
                extraInfoWrapper.style.display = 'flex';
                extraInfoWrapper.style.flexDirection = 'row';
                extraInfoWrapper.style.gap = '10px';
                extraInfoWrapper.style.width = '100%';
                extraInfoWrapper.style.marginTop = '10px';

                extraInfoWrapper.innerHTML = `
                    <input type="text" id="new-user-department" placeholder="소속 (필수)" style="flex: 1; min-width: 0; height: 30px; padding: 0 8px; font-size: 13px; background: #0d1117; border: 1px solid #30363d; color: #fff; border-radius: 4px; box-sizing: border-box;">
                    <input type="text" id="new-user-position" placeholder="직급 (필수)" style="flex: 1; min-width: 0; height: 30px; padding: 0 8px; font-size: 13px; background: #0d1117; border: 1px solid #30363d; color: #fff; border-radius: 4px; box-sizing: border-box;">
                    <input type="text" id="new-user-name" placeholder="이름 (필수)" style="flex: 1; min-width: 0; height: 30px; padding: 0 8px; font-size: 13px; background: #0d1117; border: 1px solid #30363d; color: #fff; border-radius: 4px; box-sizing: border-box;">
                `;
                pwWrapper.parentNode.insertBefore(extraInfoWrapper, pwWrapper.nextSibling);
            }

            if (roleSelect && !siteSelectWrapper) {
                siteSelectWrapper = document.createElement('div');
                siteSelectWrapper.id = 'new-user-site-wrapper';
                siteSelectWrapper.style.display = 'flex';
                siteSelectWrapper.style.gap = '10px';
                siteSelectWrapper.style.marginTop = '10px'; // 위아래 간격 추가
                siteSelectWrapper.style.width = '100%';
                siteSelectWrapper.style.height = '30px'; // 높이를 2/3 수준(30px)으로 축소

                // [수정] 기존 권한 선택 요소를 Wrapper(가로 1열) 안으로 이동
                roleSelect.parentNode.insertBefore(siteSelectWrapper, roleSelect);
                siteSelectWrapper.appendChild(roleSelect);

                roleSelect.style.flex = '1';
                roleSelect.style.minWidth = '0';
                roleSelect.style.height = '100%';
                roleSelect.style.padding = '0 8px';
                roleSelect.style.fontSize = '13px';
                roleSelect.style.boxSizing = 'border-box';
                roleSelect.style.margin = '0'; // 기존 마진 제거

                siteSelect = document.createElement('select');
                siteSelect.id = 'new-user-site';
                siteSelect.style.flex = '1';
                siteSelect.style.minWidth = '0';
                siteSelect.style.padding = '0 8px';
                siteSelect.style.fontSize = '13px';
                siteSelect.style.backgroundColor = '#0d1117';
                siteSelect.style.color = '#fff';
                siteSelect.style.border = '1px solid #30363d';
                siteSelect.style.borderRadius = '4px';
                siteSelect.style.height = '100%';
                siteSelect.style.boxSizing = 'border-box';

                siteSelectWrapper.appendChild(siteSelect);

                if (btnAddUser) {
                    btnAddUser.className = 'btn-green'; // 녹색 버튼 스타일 적용
                    btnAddUser.textContent = '추가';
                    btnAddUser.style.width = 'auto';
                    btnAddUser.style.height = '100%';
                    btnAddUser.style.padding = '0 15px'; // 버튼 좌우 여백 축소
                    btnAddUser.style.margin = '0';
                    btnAddUser.style.fontSize = '13px'; // 버튼 폰트 크기 축소
                    btnAddUser.style.fontWeight = 'normal'; // 굵기 조절
                    btnAddUser.style.borderRadius = '4px';
                    btnAddUser.style.boxSizing = 'border-box';
                    siteSelectWrapper.appendChild(btnAddUser);
                }
            }

            if (siteSelect) {
                const data = JSON.parse(localStorage.getItem('device_data')) || {};
                const equipments = data.equipments || data || {};
                siteSelect.innerHTML = '<option value="">사업장 미지정 (전체)</option>';
                Object.keys(equipments).sort().forEach(site => {
                    const opt = document.createElement('option');
                    opt.value = site;
                    opt.textContent = site;
                    siteSelect.appendChild(opt);
                });
            }
        }

        // [추가] 일반/관리자 공통 비밀번호 변경 폼에 '새 비밀번호 확인' 1열 동적 추가
        const changePwCurrent = document.getElementById('change-pw-current');
        const changePwNew = document.getElementById('change-pw-new');

        if (changePwCurrent) {
            changePwCurrent.style.height = '30px';
            changePwCurrent.style.padding = '0 8px';
            changePwCurrent.style.fontSize = '13px';
            changePwCurrent.style.boxSizing = 'border-box';

            // [추가] 내 계정 정보 표시 및 수정 영역 동적 생성
            let myInfoWrapper = document.getElementById('my-info-wrapper');
            if (!myInfoWrapper) {
                const sep1 = document.createElement('hr');
                sep1.style.borderColor = '#30363d';
                sep1.style.borderWidth = '1px 0 0 0';
                sep1.style.margin = '25px 0 15px 0';

                const infoTitle = document.createElement('h3');
                infoTitle.textContent = '계정 정보';
                infoTitle.className = 'modal-section-title-blue';
                infoTitle.style.fontSize = '14px';
                infoTitle.style.margin = '0 0 12px 0';

                myInfoWrapper = document.createElement('div');
                myInfoWrapper.id = 'my-info-wrapper';
                myInfoWrapper.style.width = '100%';

                const infoContent = document.createElement('div');
                infoContent.id = 'my-info-content';
                infoContent.style.display = 'flex';
                infoContent.style.flexDirection = 'column';
                infoContent.style.gap = '10px';
                myInfoWrapper.appendChild(infoContent);

                const sep2 = document.createElement('hr');
                sep2.style.borderColor = '#30363d';
                sep2.style.borderWidth = '1px 0 0 0';
                sep2.style.margin = '35px 0 20px 0';
                // [수정] '비밀번호 변경' 제목(H3)을 찾아서 그 위로 계정 정보 영역을 삽입합니다.
                let targetNode = changePwCurrent;
                let prevNode = changePwCurrent.previousElementSibling;
                while (prevNode) {
                    if (prevNode.tagName === 'H3') {
                        targetNode = prevNode;
                        // 제목 바로 위에 구분선(HR)이 있다면 그 위로 타겟을 한 번 더 올립니다.
                        if (targetNode.previousElementSibling && targetNode.previousElementSibling.tagName === 'HR') {
                            targetNode = targetNode.previousElementSibling;
                        }
                        break;
                    }
                    prevNode = prevNode.previousElementSibling;
                }

                changePwCurrent.parentNode.insertBefore(sep1, targetNode);
                changePwCurrent.parentNode.insertBefore(infoTitle, targetNode);
                changePwCurrent.parentNode.insertBefore(myInfoWrapper, targetNode);
                changePwCurrent.parentNode.insertBefore(sep2, targetNode);
            }
            if (myInfoWrapper && typeof window.renderMyInfo === 'function') window.renderMyInfo();
        }

        let changePwWrapper = document.getElementById('change-pw-new-wrapper');
        if (changePwNew && !changePwWrapper) {
            changePwWrapper = document.createElement('div');
            changePwWrapper.id = 'change-pw-new-wrapper';
            changePwWrapper.style.display = 'flex';
            changePwWrapper.style.gap = '10px';
            changePwWrapper.style.width = '100%';
            changePwWrapper.style.marginTop = '10px';
            changePwWrapper.style.height = '30px';

            changePwNew.parentNode.insertBefore(changePwWrapper, changePwNew);
            changePwWrapper.appendChild(changePwNew);

            changePwNew.style.flex = '1';
            changePwNew.style.minWidth = '0';
            changePwNew.style.margin = '0';
            changePwNew.style.height = '100%';
            changePwNew.style.padding = '0 8px';
            changePwNew.style.fontSize = '13px';
            changePwNew.style.boxSizing = 'border-box';

            const changePwConfirmInput = document.createElement('input');
            changePwConfirmInput.type = 'password';
            changePwConfirmInput.id = 'change-pw-confirm';
            changePwConfirmInput.placeholder = '새 비밀번호 확인';
            changePwConfirmInput.style.flex = '1';
            changePwConfirmInput.style.minWidth = '0';
            changePwConfirmInput.style.height = '100%';
            changePwConfirmInput.style.padding = '0 8px';
            changePwConfirmInput.style.fontSize = '13px';
            changePwConfirmInput.style.background = '#0d1117';
            changePwConfirmInput.style.border = '1px solid #30363d';
            changePwConfirmInput.style.color = '#fff';
            changePwConfirmInput.style.borderRadius = '4px';
            changePwConfirmInput.style.boxSizing = 'border-box';

            changePwWrapper.appendChild(changePwConfirmInput);

            const btnChangePw = document.getElementById('btn-change-pw');
            if (btnChangePw) {
                btnChangePw.style.width = 'auto';
                btnChangePw.style.height = '100%';
                btnChangePw.style.padding = '0 15px';
                btnChangePw.style.margin = '0';
                btnChangePw.style.fontSize = '13px';
                btnChangePw.style.fontWeight = 'normal';
                btnChangePw.style.borderRadius = '4px';
                btnChangePw.style.boxSizing = 'border-box';
                changePwWrapper.appendChild(btnChangePw);
            }
        }

        // [추가] 계정 삭제 기능 UI 동적 생성 (비밀번호 변경 아래에 구분선과 함께 추가)
        let deleteAccountWrapper = document.getElementById('delete-account-wrapper');
        const changePwWrapperRef = document.getElementById('change-pw-new-wrapper');

        if (changePwWrapperRef && !deleteAccountWrapper) {
            const separator = document.createElement('hr');
            separator.style.borderColor = '#30363d';
            separator.style.borderWidth = '1px 0 0 0';
            separator.style.margin = '35px 0 0 0'; // [수정] 윗 여백을 대폭 늘려 이전 섹션(비밀번호 변경)과 완벽하게 분리
            if (changePwWrapperRef.parentNode) changePwWrapperRef.parentNode.insertBefore(separator, changePwWrapperRef.nextSibling);

            // [추가] 계정 삭제 제목
            const sectionTitle = document.createElement('h3');
            sectionTitle.textContent = '계정 삭제';
            sectionTitle.className = 'modal-section-title-blue';
            sectionTitle.style.fontSize = '14px';
            sectionTitle.style.margin = '0 0 3px 0'; // [수정] 제목과 아래 입력창 사이의 숨쉴 공간 추가
            separator.parentNode.insertBefore(sectionTitle, separator.nextSibling);

            deleteAccountWrapper = document.createElement('div');
            deleteAccountWrapper.id = 'delete-account-wrapper';
            deleteAccountWrapper.style.display = 'flex';
            deleteAccountWrapper.style.gap = '10px';
            deleteAccountWrapper.style.width = '100%';
            deleteAccountWrapper.style.height = '30px';

            const deletePwInput = document.createElement('input');
            deletePwInput.type = 'password';
            deletePwInput.id = 'delete-account-pw';
            deletePwInput.placeholder = '현재 비밀번호 입력 (계정 삭제용)';
            deletePwInput.style.flex = '1';
            deletePwInput.style.height = '100%';
            deletePwInput.style.padding = '0 8px';
            deletePwInput.style.fontSize = '13px';
            deletePwInput.style.background = '#0d1117';
            deletePwInput.style.border = '1px solid #30363d';
            deletePwInput.style.color = '#fff';
            deletePwInput.style.borderRadius = '4px';
            deletePwInput.style.boxSizing = 'border-box';

            const btnDeleteAccount = document.createElement('button');
            btnDeleteAccount.id = 'btn-delete-account';
            btnDeleteAccount.className = 'btn-del';
            btnDeleteAccount.textContent = '삭제';
            btnDeleteAccount.style.width = 'auto';
            btnDeleteAccount.style.height = '100%';
            btnDeleteAccount.style.padding = '0 15px';
            btnDeleteAccount.style.margin = '0';
            btnDeleteAccount.style.fontSize = '13px';
            btnDeleteAccount.style.fontWeight = 'normal';
            btnDeleteAccount.style.borderRadius = '4px';
            btnDeleteAccount.style.boxSizing = 'border-box';

            deleteAccountWrapper.appendChild(deletePwInput);
            deleteAccountWrapper.appendChild(btnDeleteAccount);

            sectionTitle.parentNode.insertBefore(deleteAccountWrapper, sectionTitle.nextSibling);

            btnDeleteAccount.addEventListener('click', deleteAccount);
        }

        // [이동 및 추가] 타 계정 삭제 기능을 본인 계정 삭제 폼 아래로 이동 (관리자 전용)
        let adminDeleteWrapper = document.getElementById('admin-user-delete-wrapper');
        if (role === 'admin') {
            if (deleteAccountWrapper && !adminDeleteWrapper) {
                adminDeleteWrapper = document.createElement('div');
                adminDeleteWrapper.id = 'admin-user-delete-wrapper';
                adminDeleteWrapper.style.width = '100%';
                adminDeleteWrapper.style.marginTop = '10px';

                const inputWrapper = document.createElement('div');
                inputWrapper.style.display = 'flex';
                inputWrapper.style.gap = '10px';
                inputWrapper.style.width = '100%';
                inputWrapper.style.height = '30px';

                // [추가] 입력창과 제안 박스의 너비를 맞추기 위한 래퍼 생성
                const searchContainer = document.createElement('div');
                searchContainer.style.position = 'relative';
                searchContainer.style.flex = '1';
                searchContainer.style.minWidth = '0';
                searchContainer.style.height = '100%';

                const searchInput = document.createElement('input');
                searchInput.type = 'text';
                searchInput.id = 'admin-delete-user-input';
                searchInput.placeholder = '삭제할 일반 계정 검색 (이름, 소속, 아이디)';
                searchInput.style.width = '100%';
                searchInput.style.height = '100%';
                searchInput.style.padding = '0 8px';
                searchInput.style.fontSize = '13px';
                searchInput.style.background = '#0d1117';
                searchInput.style.border = '1px solid #30363d';
                searchInput.style.color = '#fff';
                searchInput.style.borderRadius = '4px';
                searchInput.style.boxSizing = 'border-box';
                searchInput.autocomplete = 'off';

                const suggestionList = document.createElement('ul');
                suggestionList.id = 'admin-delete-user-suggestions';
                suggestionList.className = 'user-suggestion-list';

                searchContainer.appendChild(searchInput);
                searchContainer.appendChild(suggestionList);

                const delBtn = document.createElement('button');
                delBtn.id = 'btn-admin-delete-user';
                delBtn.className = 'btn-del';
                delBtn.textContent = '삭제';
                delBtn.style.width = 'auto';
                delBtn.style.height = '100%';
                delBtn.style.padding = '0 15px';
                delBtn.style.margin = '0';
                delBtn.style.fontSize = '13px';
                delBtn.style.fontWeight = 'normal';
                delBtn.style.borderRadius = '4px';
                delBtn.style.boxSizing = 'border-box';

                inputWrapper.appendChild(searchContainer);
                inputWrapper.appendChild(delBtn);
                adminDeleteWrapper.appendChild(inputWrapper);

                deleteAccountWrapper.parentNode.insertBefore(adminDeleteWrapper, deleteAccountWrapper.nextSibling);

                let deletableUsers = [];

                adminDeleteWrapper.fetchDeletableUsers = () => {
                    fetch('/api/users/deletable', { headers: { 'X-CSRFToken': getCookie('csrf_token') } })
                        .then(res => res.json())
                        .then(data => { if (data.status === 'success') deletableUsers = data.users; })
                        .catch(err => console.error(err));
                };

                const showSuggestions = () => {
                    const query = searchInput.value.trim().toLowerCase();
                    suggestionList.innerHTML = '';
                    let matches = query ? deletableUsers.filter(u => {
                        const text = `${u.id} ${u.name} ${u.department} ${u.position}`.toLowerCase();
                        return query.split(/\s+/).every(kw => text.includes(kw));
                    }) : deletableUsers;

                    if (matches.length > 0) {
                        matches.forEach(u => {
                            const li = document.createElement('li');
                            li.className = 'user-suggestion-item';
                            const namePart = u.name ? `${escapeHtml(u.name)} (${escapeHtml(u.department)} ${escapeHtml(u.position)})` : '이름 없음';
                            li.innerHTML = `<span>${namePart}</span><span class="user-id">${escapeHtml(u.id)}</span>`;
                            li.addEventListener('mousedown', (e) => {
                                e.preventDefault();
                                searchInput.value = u.id;
                                suggestionList.style.display = 'none';
                            });
                            suggestionList.appendChild(li);
                        });
                    } else {
                        suggestionList.innerHTML = '<li class="user-suggestion-item" style="color:#8b949e; cursor:default; justify-content:center;">검색 결과 없음</li>';
                    }
                    suggestionList.style.display = 'block';
                };

                searchInput.addEventListener('focus', showSuggestions);
                searchInput.addEventListener('input', showSuggestions);
                searchInput.addEventListener('blur', () => { setTimeout(() => { suggestionList.style.display = 'none'; }, 150); });

                delBtn.addEventListener('click', () => {
                    const targetId = searchInput.value.trim();
                    if (!targetId) return alert('삭제할 계정 아이디를 입력하거나 선택해주세요.');
                    if (!confirm(`'${targetId}' 계정을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

                    fetch('/api/admin/user/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                        body: JSON.stringify({ target_id: targetId })
                    })
                        .then(res => res.json())
                        .then(data => {
                            if (data.status === 'success') {
                                addSystemLog('DELETE_USER', targetId, '관리자에 의한 타 계정 삭제');
                                alert('계정이 삭제되었습니다.');
                                searchInput.value = '';
                                adminDeleteWrapper.fetchDeletableUsers();
                            } else {
                                alert(data.message || '계정 삭제 실패');
                            }
                        }).catch(err => console.error(err));
                });
            }

            if (adminDeleteWrapper) {
                adminDeleteWrapper.style.display = 'block';
                if (adminDeleteWrapper.fetchDeletableUsers) adminDeleteWrapper.fetchDeletableUsers();
                const searchInput = document.getElementById('admin-delete-user-input');
                if (searchInput) searchInput.value = '';
            }
        } else {
            if (adminDeleteWrapper) adminDeleteWrapper.style.display = 'none';
        }
    }
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.style.display = 'none';
    ['new-user-id', 'new-user-pw', 'new-user-pw-confirm', 'new-user-department', 'new-user-position', 'new-user-name', 'change-pw-current', 'change-pw-new', 'change-pw-confirm', 'delete-account-pw'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function addNewUser() {
    const id = document.getElementById('new-user-id').value.trim();
    const pw = document.getElementById('new-user-pw').value.trim();
    const pwConfirmEl = document.getElementById('new-user-pw-confirm');
    const pwConfirm = pwConfirmEl ? pwConfirmEl.value.trim() : '';
    const role = document.getElementById('new-user-role').value;
    const siteSelect = document.getElementById('new-user-site');
    const site = siteSelect ? siteSelect.value : ''; // [추가]

    const deptInput = document.getElementById('new-user-department');
    const posInput = document.getElementById('new-user-position');
    const nameInput = document.getElementById('new-user-name');

    const department = deptInput ? deptInput.value.trim() : '';
    const position = posInput ? posInput.value.trim() : '';
    const name = nameInput ? nameInput.value.trim() : '';

    if (!id || !pw) return alert('아이디와 비밀번호를 입력해주세요.');
    if (pw !== pwConfirm) return alert('비밀번호가 일치하지 않습니다.');
    if (!department) return alert('소속을 입력해주세요.');
    if (!position) return alert('직급을 입력해주세요.');
    if (!name) return alert('이름을 입력해주세요.');

    // [수정] 서버 API 호출
    fetch('/api/user/add', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrf_token') // [보안] CSRF 토큰 추가
        },
        body: JSON.stringify({ id, pw, role, site, department, position, name }) // [추가]
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                addSystemLog('ADD_USER', id, `Name: ${name}, Role: ${role}, Site: ${site || '전체'}`);
                alert('계정이 추가되었습니다.');
                document.getElementById('new-user-id').value = '';
                document.getElementById('new-user-pw').value = '';
                if (pwConfirmEl) pwConfirmEl.value = '';
                if (deptInput) deptInput.value = '';
                if (posInput) posInput.value = '';
                if (nameInput) nameInput.value = '';
            } else {
                alert(data.message || '계정 추가 실패');
            }
        });
}

function changePassword() {
    const currentPw = document.getElementById('change-pw-current').value;
    const newPw = document.getElementById('change-pw-new').value;
    const confirmPwEl = document.getElementById('change-pw-confirm');
    const confirmPw = confirmPwEl ? confirmPwEl.value : '';
    const userId = sessionStorage.getItem('userId');

    if (!currentPw || !newPw) return alert('현재 비밀번호와 새 비밀번호를 입력해주세요.');
    if (newPw !== confirmPw) return alert('새 비밀번호가 일치하지 않습니다.');

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

// [추가] 계정 삭제 로직
function deleteAccount() {
    const pwEl = document.getElementById('delete-account-pw');
    const pw = pwEl ? pwEl.value : '';
    const userId = sessionStorage.getItem('userId');

    if (!pw) return alert('계정을 삭제하려면 현재 비밀번호를 입력해주세요.');
    if (!confirm('정말 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 삭제 후 즉시 로그아웃됩니다.')) return;

    fetch('/api/user/delete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrf_token')
        },
        body: JSON.stringify({ id: userId, pw: pw })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                alert('계정이 성공적으로 삭제되었습니다.');
                fetch('/api/logout', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCookie('csrf_token') }
                }).then(() => {
                    sessionStorage.clear();
                    location.reload();
                });
            } else {
                alert(data.message || '계정 삭제 실패');
            }
        });
}
// [추가] 내 계정 정보 렌더링 함수
window.renderMyInfo = function () {
    fetch('/api/user/info')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                const user = data.user;
                const content = document.getElementById('my-info-content');
                if (!content) return;

                content.innerHTML = `
                <div style="display: flex; gap: 10px; width: 100%; height: 30px;">
                    <input type="text" value="${escapeHtml(user.department)}" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px;" disabled title="소속" placeholder="소속 미지정">
                    <input type="text" value="${escapeHtml(user.position)}" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px;" disabled title="직급" placeholder="직급 미지정">
                    <input type="text" value="${escapeHtml(user.name)}" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px;" disabled title="이름" placeholder="이름 미지정">
                </div>
                <div style="display: flex; gap: 10px; width: 100%; height: 30px;">
                    <input type="text" value="${user.role === 'admin' ? '관리자' : '일반'}" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px;" disabled title="권한">
                    <input type="text" value="${escapeHtml(user.site || '전체 사업장')}" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px;" disabled title="사업장">
                    <button id="btn-edit-my-info" class="btn-blue" style="width: auto; height: 100%; padding: 0 15px; margin: 0; font-size: 13px; font-weight: normal; border-radius: 4px; box-sizing: border-box;">수정</button>
                </div>
            `;

                document.getElementById('btn-edit-my-info').onclick = () => {
                    const pw = prompt('정보를 수정하려면 현재 비밀번호를 입력하세요.');
                    if (!pw) return;

                    fetch('/api/user/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                        body: JSON.stringify({ pw: pw })
                    })
                        .then(res => res.json())
                        .then(vData => {
                            if (vData.status === 'success') {
                                window.renderMyInfoEdit(user);
                            } else {
                                alert(vData.message || '비밀번호가 일치하지 않습니다.');
                            }
                        });
                };
            }
        });
};

// [추가] 내 계정 정보 수정 모드 렌더링 함수
window.renderMyInfoEdit = function (user) {
    const content = document.getElementById('my-info-content');
    if (!content) return;

    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipments = deviceData.equipments || deviceData || {};
    let siteOptions = '<option value="">전체 사업장</option>';
    Object.keys(equipments).sort().forEach(s => {
        siteOptions += `<option value="${escapeHtml(s)}" ${user.site === s ? 'selected' : ''}>${escapeHtml(s)}</option>`;
    });

    const isRoleEditable = sessionStorage.getItem('userRole') === 'admin' && user.id !== 'admin';

    content.innerHTML = `
        <div style="display: flex; gap: 10px; width: 100%; height: 30px;">
            <input type="text" id="edit-my-dept" value="${escapeHtml(user.department)}" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px;" placeholder="소속 (필수)">
            <input type="text" id="edit-my-pos" value="${escapeHtml(user.position)}" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px;" placeholder="직급 (필수)">
            <input type="text" id="edit-my-name" value="${escapeHtml(user.name)}" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px;" placeholder="이름 (필수)">
        </div>
        <div style="display: flex; gap: 10px; width: 100%; height: 30px;">
            <select id="edit-my-role" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px; background: #0d1117;" ${isRoleEditable ? '' : 'disabled'}>
                <option value="user" ${user.role === 'user' ? 'selected' : ''}>일반</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>관리자</option>
            </select>
            <select id="edit-my-site" class="input-dark" style="flex:1; min-width:0; height:100%; padding: 0 8px; font-size: 13px; background: #0d1117;">
                ${siteOptions}
            </select>
            <button id="btn-save-my-info" class="btn-green" style="width: auto; height: 100%; padding: 0 15px; margin: 0; font-size: 13px; font-weight: normal; border-radius: 4px; box-sizing: border-box;">저장</button>
            <button id="btn-cancel-my-info" class="btn-gray" style="width: auto; height: 100%; padding: 0 15px; margin: 0; font-size: 13px; font-weight: normal; border-radius: 4px; box-sizing: border-box;">취소</button>
        </div>
    `;

    document.getElementById('btn-cancel-my-info').onclick = () => window.renderMyInfo();
    document.getElementById('btn-save-my-info').onclick = () => {
        const dept = document.getElementById('edit-my-dept').value.trim();
        const pos = document.getElementById('edit-my-pos').value.trim();
        const name = document.getElementById('edit-my-name').value.trim();
        const role = document.getElementById('edit-my-role').value;
        const site = document.getElementById('edit-my-site').value;

        if (!dept || !pos || !name) return alert("소속, 직급, 이름을 모두 입력해주세요.");

        fetch('/api/user/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ department: dept, position: pos, name: name, role: role, site: site })
        })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    alert('계정 정보가 수정되었습니다.');
                    sessionStorage.setItem('userRole', role);
                    sessionStorage.setItem('userSite', site);
                    addSystemLog('UPDATE_USER', user.id, '본인 계정 정보 수정');
                    window.renderMyInfo();
                } else {
                    alert(data.message || '수정 실패');
                }
            });
    };
};
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

    // [추가] 장비 모델 약어 매핑을 위해 데이터 로드
    let equipmentModels = [];
    try {
        const data = localStorage.getItem('equipment_models');
        equipmentModels = data ? JSON.parse(data) : [];
    } catch (e) { }

    if (storageData[siteName]) {
        storageData[siteName].forEach(name => {
            const key = `details_${siteName}_${name}`;
            const detailData = JSON.parse(localStorage.getItem(key)) || {};
            const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

            const parts = name.split('::');
            const equipName = parts[0];
            const modelName = parts.length > 1 ? parts[1] : '';

            // [수정] 모델명 대신 약어(abbr)가 있으면 적용
            let displayEquipName = equipName;
            const modelObj = equipmentModels.find(m => m.name === equipName);
            if (modelObj && modelObj.abbr) {
                displayEquipName = modelObj.abbr;
            }

            const displaySubText = modelName ? `/ ${modelName}` : '';

            const li = createListItem(name, displayEquipName, 'equip', (selectedEquip) => {
                onEquipClick(siteName, selectedEquip);
            }, displaySubText);

            li.dataset.custName = custEquipName;
            li.dataset.fullModelName = equipName; // 검색을 위해 원본 모델명 저장
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

                // [수정] 부모 요소의 숨김 속성 때문에 제안 박스가 잘리는 현상 방지
                wrapper.style.overflow = 'visible';
                li.style.overflow = 'visible';

                wrapper.innerHTML = `
                    <div class="autocomplete-wrapper" style="flex: 1; margin-right: 5px;">
                        <input type="text" class="edit-name-input" value="${currentName}" style="width: 100%;">
                        <ul class="suggestion-list edit-equip-suggestions" style="z-index: 9999;"></ul>
                    </div>
                    <input type="text" class="edit-model-input" value="${currentModel}" placeholder="Serial No." style="width: 80px;">
                `;

                const nameInput = wrapper.querySelector('.edit-name-input');
                const modelInput = wrapper.querySelector('.edit-model-input');
                const suggestionList = wrapper.querySelector('.edit-equip-suggestions');

                nameInput.focus();

                const showEquipSuggestions = () => {
                    const query = nameInput.value.trim().toLowerCase();
                    const keywords = query ? query.split(/\s+/) : [];

                    let equipmentModels = [];
                    try {
                        equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                    } catch (e) { }

                    let matches = equipmentModels;
                    if (query) {
                        matches = equipmentModels.filter(m => {
                            const text = `${m.name} ${m.abbr}`.toLowerCase();
                            return keywords.every(kw => text.includes(kw));
                        });
                    }

                    suggestionList.innerHTML = '';
                    if (matches.length > 0) {
                        matches.forEach(m => {
                            const sugLi = document.createElement('li');
                            sugLi.className = 'suggestion-item';
                            sugLi.innerHTML = `
                                <div class="suggestion-item-content">
                                    <span>${escapeHtml(m.name)}</span>
                                    ${m.abbr ? `<span class="abbr">${escapeHtml(m.abbr)}</span>` : ''}
                                </div>
                            `;
                            sugLi.addEventListener('mousedown', (ev) => {
                                ev.preventDefault();
                                nameInput.value = m.name;
                                suggestionList.style.display = 'none';
                                if (modelInput) modelInput.focus();
                            });
                            suggestionList.appendChild(sugLi);
                        });
                        suggestionList.style.display = 'block';
                    } else {
                        // [추가] 매칭 결과가 없을 때 빈 목록 표시 (가시성 확보)
                        suggestionList.innerHTML = '<li class="suggestion-item" style="color:#8b949e; cursor:default; text-align:center; padding: 8px;">검색 결과 없음</li>';
                        suggestionList.style.display = 'block';
                    }
                };

                nameInput.addEventListener('click', showEquipSuggestions);
                nameInput.addEventListener('input', showEquipSuggestions);
                nameInput.addEventListener('focus', () => {
                    showEquipSuggestions();
                    setTimeout(() => li.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                });
                nameInput.addEventListener('blur', () => {
                    setTimeout(() => { suggestionList.style.display = 'none'; }, 150);
                });

                [nameInput, modelInput].forEach(input => {
                    input.onmousedown = (ev) => ev.stopPropagation();
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
        li.style.overflow = ''; // [추가] 원래 속성으로 복구

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
                    // [추가] 리스트에서 직접 장비명 수정 시 유효한 모델명인지 검증
                    let equipmentModels = [];
                    try { equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || []; } catch (e) { }
                    if (!equipmentModels.some(m => m.name === newName)) {
                        alert('등록되지 않은 장비 모델명입니다. 수정이 취소됩니다.');
                    } else {
                        newId = newModel ? `${newName}::${newModel}` : newName;
                    }
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
        const fullModelName = item.dataset.fullModelName ? item.dataset.fullModelName.toLowerCase() : '';

        if (text.includes(key) || subText.includes(key) || custName.includes(key) || fullModelName.includes(key)) {
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
        const equipStatusEl = document.getElementById('DeviceID-equip-status');
        if (equipStatusEl) equipStatusEl.value = setup.equipStatus || '';
        const warrantyStartEl = document.getElementById('DeviceID-warranty-start');
        if (warrantyStartEl) warrantyStartEl.value = setup.warrantyStart || '';
        const warrantyPeriodEl = document.getElementById('DeviceID-warranty-period');
        if (warrantyPeriodEl) warrantyPeriodEl.value = setup.warrantyPeriod || '';
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
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (shouldSyncKey(key)) allData[key] = JSON.parse(localStorage.getItem(key));
    }
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `withtech_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`;
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
                if (shouldSyncKey(key)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => originalRemoveItem.call(localStorage, key));

            // 1. LocalStorage 업데이트 (불러온 데이터로 채움)
            Object.keys(importedData).forEach(key => {
                if (shouldSyncKey(key)) {
                    originalSetItem.call(localStorage, key, JSON.stringify(importedData[key]));
                }
            });

            // 2. 시스템 로그 추가
            addSystemLog('BACKUP_IMPORT', 'System', '데이터 복원 완료');

            // 3. 서버로 데이터 즉시 전송 (페이지 리로드 전 저장 보장)
            const allData = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (shouldSyncKey(key)) {
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
    fetch('/api/log/add', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrf_token')
        },
        body: JSON.stringify({ action, target, details })
    }).catch(err => console.error('Failed to add system log:', err));
}

function openLogModal() {
    const modal = document.getElementById('log-modal');
    if (modal) { modal.style.display = 'flex'; renderSystemLogs(); }
}

function closeLogModal() {
    const modal = document.getElementById('log-modal');
    if (modal) modal.style.display = 'none';
}

async function renderSystemLogs() {
    const tbody = document.getElementById('system-log-body');
    if (!tbody) return;

    try {
        const response = await fetch('/api/logs', {
            headers: { 'X-CSRFToken': getCookie('csrf_token') }
        });
        if (!response.ok) throw new Error('Failed to fetch logs');

        const logs = await response.json();

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

        tbody.innerHTML = filteredLogs.map(log => `<tr><td>${new Date(log.timestamp).toLocaleString()}</td><td><span class="badge pm" style="background: #30363d;">${log.action}</span></td><td>${log.target}</td><td>${log.details}</td></tr>`).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: #f85149;">로그를 불러오는데 실패했습니다.</td></tr>';
    }
}

// [추가] 로그 카테고리 분류 함수
function getLogCategory(action) {
    const commonActions = ['LOGIN', 'LOGOUT', 'ADD_USER', 'CHANGE_PW', 'BACKUP_EXPORT', 'BACKUP_IMPORT'];
    const adminActions = [
        'ADD_SITE', 'DELETE_SITE', 'RENAME_SITE',
        'ADD_EQUIP', 'UPDATE_EQUIP', 'DELETE_EQUIP', 'RENAME_ITEM',
        'ADD_EQUIP_MODEL', 'UPDATE_EQUIP_MODEL', 'DELETE_EQUIP_MODEL',
        'ADD_ITEM_ADMIN', 'UPDATE_ITEM_ADMIN_DETAIL', 'DELETE_ITEM_ADMIN',
        'ADD_CHECK_CATEGORY', 'DELETE_CHECK_CATEGORY',
        'ADD_CHECK_ITEM', 'DELETE_CHECK_ITEM', 'LOAD_CHECK_TYPE'
    ];
    const setupActions = [
        'UPDATE_SETUP', 'ADD_SETUP_ITEM', 'DELETE_SETUP_ITEM', 'UPDATE_SETUP_ITEM', 'REORDER_SETUP',
        'UPDATE_SETUP_DETAILS', 'UPDATE_SETUP_STATUS', 'CALC_SETUP_SCHEDULE', 'START_SETUP_EXEC',
        'UPDATE_SETUP_COMPLETION', 'ADD_SETUP_LOG', 'DELETE_SETUP_LOG', 'UPDATE_SETUP_LOG_MEMO', 'UPDATE_SETUP_LOG'
    ];

    if (commonActions.includes(action)) return 'common';
    if (adminActions.includes(action)) return 'admin';
    if (setupActions.includes(action)) return 'setup';

    // 나머지는 운영관리(maint)로 간주 (ADD_MAINTENANCE, ADD_LOG 등)
    return 'maint';
}

async function clearSystemLogs() {
    if (confirm('모든 시스템 로그를 삭제하시겠습니까?')) {
        try {
            const response = await fetch('/api/logs/clear', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrf_token') }
            });
            const data = await response.json();
            if (data.status === 'success') {
                renderSystemLogs();
            } else {
                alert(data.message || '로그 삭제 실패');
            }
        } catch (err) {
            console.error(err);
            alert('로그 삭제 중 오류가 발생했습니다.');
        }
    }
}
/* ==========================================================================
   유틸리티: 영업일 계산 (Business Days Calculation)
   ========================================================================== */
window.getHolidayName = function (year, month, day) {
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
