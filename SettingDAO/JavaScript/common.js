/* ==========================================================================
   1. 전역 변수 및 데이터 관리 (Global State)
   ========================================================================== */
// [추가] HTML 템플릿을 복제하는 헬퍼 함수
function getTemplateContent(id) {
    const template = document.getElementById(id);
    if (template) return document.importNode(template.content, true);
    console.error(`Template with id '${id}' not found.`);
    return null;
}

let storageData = JSON.parse(localStorage.getItem('device_data')) || {};
let currentPath = { site: '', equip: '' };
let selectedLogId = null;
let originalMemo = "";
let originalSetupData = null;
let currentLogFilter = 'all'; // [추가] 현재 로그 필터 상태
let currentNextScheduleTarget = null; // [추가] 다음 작업 예정일 타겟
let sessionTimer = null; // [추가] 세션 타이머
let sessionTimeLeft = 3600; // 60분 리셋 (3600초)
let lastActivityTimestamp = Date.now(); // [추가] 마지막 사용자 활동 시간

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

/* ==========================================================================
   2. DB 동기화 API 통신 (DB Sync APIs)
   ========================================================================== */

// [추가] 100% DB 전환을 위한 유지관리/이력 전용 트랜잭션 동기화 함수
window.syncHistoryTransaction = async function (site, equip, payload) {
    const equip_id = `${site}::${equip}`;
    try {
        const res = await fetch('/api/history/transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ equip_id, ...payload })
        });
        const data = await res.json();
        if (data.status !== 'success') console.error('DB Sync Error:', data.message);
        return data.status === 'success';
    } catch (e) {
        console.error('DB Sync Failed:', e);
        return false;
    }
};

// [추가] 100% DB 전환을 위한 SETUP(셋업 상세내역/일지) 전용 동기화 함수
window.syncSetupDataDB = async function (site, equip, details = null, logs = null) {
    const equip_id = `${site}::${equip}`;
    try {
        const res = await fetch('/api/setup/sync_equip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ equip_id, details, logs })
        });
        const data = await res.json();
        return data.status === 'success';
    } catch (e) {
        console.error('Setup DB Sync Failed:', e);
        return false;
    }
};

// [추가] 100% DB 전환을 위한 만능 DB 동기화 비동기 헬퍼 함수 (전역 사용)
window.syncAdminDB = async function (domain, action, payload) {
    try {
        const res = await fetch('/api/admin/crud', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ domain, action, payload })
        });
        const data = await res.json();
        if (data.status !== 'success') console.error('DB Sync Error:', data.message);
        return data.status === 'success';
    } catch (e) {
        console.error('DB Sync Failed:', e);
        return false;
    }
};

// [보안] 비밀번호 복잡도 검증 함수 (영문, 숫자, 특수문자 포함 8자 이상)
function isValidPassword(pw) {
    const regex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+~\-={}\[\]:;"'<>,.?/|\\]).{8,}$/;
    return regex.test(pw);
}

// [보안] 쿠키에서 CSRF 토큰 가져오기
function getCookie(name) {
    let value = "; " + document.cookie;
    let parts = value.split("; " + name + "=");
    if (parts.length === 2) return parts.pop().split(";").shift();
}

function saveData() {
    // [Phase 3] 이제 서버 동기화는 각 기능별 전용 API가 수행하므로, 화면 빠른 전환을 위한 로컬 캐시 저장 용도로만 사용됩니다.
    localStorage.setItem('device_data', JSON.stringify(storageData));
}

/* ==========================================================================
   3. 초기화 및 네비게이션 (Initialization & Navigation)
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
            if (response.status === 401) {
                alert('보안 세션이 만료되었습니다. 다시 로그인해주세요.');
                sessionStorage.clear();
                window.location.href = '/';
                throw new Error('Session expired');
            }
            if (!response.ok) throw new Error('Network response was not ok');
            return response.json();
        })
        .then(data => {
            // 기존 데이터 정리
            localStorage.clear();

            // 서버 데이터를 localStorage에 반영
            Object.keys(data).forEach(key => {
                localStorage.setItem(key, JSON.stringify(data[key]));
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

            // [추가] 백그라운드 사용자 정보 갱신 (새로고침 등 상태 유지)
            if (sessionStorage.getItem('isLoggedIn') === 'true') {
                fetch('/api/user/info')
                    .then(res => res.json())
                    .then(uData => {
                        if (uData.status === 'success') {
                            sessionStorage.setItem('userDepartment', uData.user.department || '');
                            sessionStorage.setItem('userPosition', uData.user.position || '');
                            sessionStorage.setItem('userName', uData.user.name || '');
                        }
                    }).catch(e => console.error(e));
            }

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
            } catch (e) { }
        }
    }

    // 3. 점검 구분 관리 기본값 마이그레이션 (비정기 > 기타 및 세부구분 2 추가)
    try {
        let catData = JSON.parse(localStorage.getItem('check_type_categories'));
        let catData2 = JSON.parse(localStorage.getItem('check_type_categories2'));
        let catModified = false;
        let cat2Modified = false;

        if (catData) {
            Object.keys(catData).forEach(key => {
                if (key.endsWith('::비정기')) {
                    if (!catData[key].includes('기타')) {
                        catData[key].push('기타');
                        catModified = true;
                    }
                }
            });
            if (catModified) {
                localStorage.setItem('check_type_categories', JSON.stringify(catData));
                isModified = true;
            }
        }

        if (!catData2) catData2 = {};
        const deviceDataObj = JSON.parse(localStorage.getItem('device_data')) || {};

        Object.keys(deviceDataObj).forEach(site => {
            if (Array.isArray(deviceDataObj[site])) {
                deviceDataObj[site].forEach(equip => {
                    const key2 = `${equip}::비정기::기타`;
                    if (!catData2[key2] || catData2[key2].length === 0) {
                        catData2[key2] = ['배수 펌프 이슈', '구동 이상'];
                        cat2Modified = true;
                    }
                });
            }
        });

        if (cat2Modified) {
            localStorage.setItem('check_type_categories2', JSON.stringify(catData2));
            isModified = true;
        }
    } catch (e) { console.error('Category migration error', e); }
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

    // [추가] 사용자 활동 감지 이벤트 리스너 (세션 자동 연장용)
    document.addEventListener('mousemove', recordUserActivity);
    document.addEventListener('keypress', recordUserActivity);
    document.addEventListener('click', recordUserActivity);

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
    setupGlobalModalScrollLock(); // [추가] 모든 모달창 배경 스크롤 자동 제어 기능
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

// [추가] 전역 모달 오버레이 스크롤 락 (MutationObserver를 활용하여 모든 js 파일의 모달에 100% 자동 적용됨)
function setupGlobalModalScrollLock() {
    const observer = new MutationObserver(() => {
        let isAnyModalOpen = false;
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            if (window.getComputedStyle(modal).display !== 'none') {
                isAnyModalOpen = true;
            }
        });

        // 화면상에 떠있는 모달이 단 하나라도 있다면 뒷 배경 스크롤을 막고, 모두 닫히면 풀어줍니다.
        if (isAnyModalOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
        observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
    });
}

function setupAuthEvents() {
    const btnLoginLogout = document.getElementById('btn-login-logout');
    const btnLoginSubmit = document.getElementById('btn-login-submit');
    const loginIdInput = document.getElementById('login-id');
    const loginPwInput = document.getElementById('login-pw');
    const btnUserSettings = document.getElementById('btn-user-settings');
    const btnCloseUserModal = document.getElementById('btn-close-user-modal');
    const userModal = document.getElementById('user-modal');
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
    if (btnChangePw) btnChangePw.addEventListener('click', changePassword);

    const btnDeleteAccount = document.getElementById('btn-delete-account');
    if (btnDeleteAccount) btnDeleteAccount.addEventListener('click', deleteAccount);

    if (btnLoginLogout) btnLoginLogout.addEventListener('click', handleLoginLogoutClick);
    if (btnLoginSubmit) btnLoginSubmit.addEventListener('click', () => attemptLogin(loginIdInput.value, loginPwInput.value, 'Modal'));
    if (loginPwInput) {
        loginPwInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') attemptLogin(loginIdInput.value, loginPwInput.value, 'Modal'); });
    }
}

// [추가] 모바일 네비게이션 설정 함수
function setupMobileNav() {
    const hamburger = document.getElementById('hamburger-menu');
    const mobilePageTitle = document.getElementById('mobile-page-title');
    const navOverlay = document.getElementById('nav-overlay');
    const mobileNav = document.getElementById('mobile-nav');

    if (!hamburger || !mobileNav || !navOverlay) return;

    if (mobilePageTitle) {
        // 현재 활성화된 메뉴 텍스트 찾기
        const activeLink = document.querySelector('.header .container .nav-links a.active');
        let titleText = 'HOME';
        if (activeLink) {
            titleText = activeLink.textContent.trim();
        }
        mobilePageTitle.textContent = titleText;
    }

    const mainNav = document.querySelector('.header .container .nav-links');
    if (mainNav) {
        const mobileNavLinks = mobileNav.querySelector('.mobile-nav-links');
        if (mobileNavLinks) {
            mobileNavLinks.innerHTML = mainNav.innerHTML;
        }
    }

    const btnAddUserMobile = document.getElementById('mobile-btn-add-user');
    if (btnAddUserMobile) {
        btnAddUserMobile.addEventListener('click', () => {
            toggleNav();
            openAddUserModal();
        });
    }

    const btnLogin = document.getElementById('mobile-btn-login-logout');
    if (btnLogin) {
        btnLogin.addEventListener('click', () => {
            toggleNav(); // 메뉴 닫기
            handleLoginLogoutClick();
        });
    }

    const btnSettings = document.getElementById('mobile-btn-user-settings');
    if (btnSettings) {
        btnSettings.addEventListener('click', () => {
            toggleNav(); // 메뉴 닫기
            openUserModal();
        });
    }

    const btnHeaderAddUser = document.getElementById('btn-header-add-user');
    if (btnHeaderAddUser) btnHeaderAddUser.addEventListener('click', openAddUserModal);

    const btnCloseAddUserModal = document.getElementById('btn-close-add-user-modal');
    if (btnCloseAddUserModal) btnCloseAddUserModal.addEventListener('click', closeAddUserModal);

    const userInfo = document.getElementById('mobile-user-info');
    if (userInfo) {
        userInfo.addEventListener('click', () => {
            handleLoginLogoutClick();
        });
    }

    const toggleNav = () => {
        hamburger.classList.toggle('active');
        mobileNav.classList.toggle('active');
        navOverlay.classList.toggle('active');
    };

    hamburger.addEventListener('click', toggleNav);
    navOverlay.addEventListener('click', toggleNav);

    // [추가] 모바일 메뉴의 링크 클릭 시, 메뉴를 닫고 해당 페이지로 이동
    mobileNav.addEventListener('click', function (e) {
        const link = e.target.closest('a');
        if (link && link.href) {
            // [개선] 페이지 이동 전, 저장되지 않은 변경사항이 있는지 확인합니다.
            if (!checkUnsavedChanges()) {
                e.preventDefault();
                return;
            }

            // 현재 페이지와 같은 링크는 메뉴만 닫고 새로고침하지 않습니다.
            if (new URL(link.href).pathname === window.location.pathname) {
                e.preventDefault();
                toggleNav(); // 메뉴만 닫습니다.
                return;
            }

            e.preventDefault();
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
            if (typeof updateHomeDashboard === 'function') {
                updateHomeDashboard();
            } else {
                try { updateHomeDashboard(); } catch (e) { }
            }
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
        siteAddBtn.onclick = async () => {
            const val = siteInput.value.trim();
            if (val && !storageData[val]) {
                const success = await window.syncAdminDB('site', 'CREATE', { name: val });
                if (!success) return alert('서버 등록에 실패했습니다.');

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
        equipAddBtn.onclick = async () => {
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

                const setupPayload = { model: equipModelVal };
                const success = await window.syncAdminDB('equip', 'CREATE', { new_id: fullEquipName, site: siteName, setup: setupPayload });
                if (!success) return alert('서버 등록에 실패했습니다.');

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
    // [Phase 3] 100% DB 전환으로 인해 JSON 파일 기반의 내보내기/불러오기 기능은 완전히 제거되었습니다.

    // [추가] 모바일에서 데이터 관리 숨기기 식별을 위한 클래스 추가
    if (btnExport && btnExport.parentElement) {
        btnExport.parentElement.classList.add('data-management-section');
    }

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
    sessionTimeLeft = 3600; // 60분 리셋 (3600초)
    lastActivityTimestamp = Date.now(); // [추가] 타이머 시작 시 활동 시간도 초기화
    updateTimerUI();

    sessionTimer = setInterval(() => {
        sessionTimeLeft--;
        updateTimerUI();

        // [추가] 세션 만료 5분 전, 최근 5분 내 활동이 있었으면 자동 연장
        if (sessionTimeLeft === 300) { // 5분 남았을 때
            const now = Date.now();
            // 최근 5분(300,000ms) 이내에 활동이 있었는지 확인
            if (now - lastActivityTimestamp < 300000) {
                window.extendSession();
                // extendSession이 startSessionTimer를 다시 호출하므로,
                // 이 인터벌은 자동으로 중지되고 새로 시작됩니다.
            }
        }

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

function recordUserActivity() {
    lastActivityTimestamp = Date.now();
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
   4. 인증 및 사용자 관리 (Authentication & Session)
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
            let roleDisplay = '일반';
            if (role === 'superadmin') roleDisplay = '최종관리자';
            else if (role === 'admin') roleDisplay = '관리자';
            userInfo.textContent = `${userId} (${roleDisplay})`;
            userInfo.style.display = 'inline';
        }
        if (btnLoginLogout) {
            btnLoginLogout.textContent = '로그아웃';
            btnLoginLogout.classList.replace('btn-blue', 'btn-gray');
        }
        if (btnUserSettings) btnUserSettings.style.display = 'inline-block';

        const btnHeaderAddUser = document.getElementById('btn-header-add-user');
        if (btnHeaderAddUser) btnHeaderAddUser.style.display = (role === 'admin' || role === 'superadmin') ? 'inline-block' : 'none';

        const adminItems = document.querySelectorAll('.nav-admin-item');
        adminItems.forEach(el => el.style.display = (role === 'admin' || role === 'superadmin') ? 'block' : 'none');

        // [추가] 데스크톱 타이머 UI 표시 (common.html 템플릿 사용)
        let desktopTimerContainer = document.getElementById('desktop-session-timer');
        if (desktopTimerContainer) {
            desktopTimerContainer.style.display = 'flex';
        }

        // [추가] 모바일 업데이트
        if (mobileUserInfo) {
            let roleDisplay = '일반';
            if (role === 'superadmin') roleDisplay = '최종관리자';
            else if (role === 'admin') roleDisplay = '관리자';
            mobileUserInfo.textContent = `${userId} (${roleDisplay})`;
            mobileUserInfo.style.display = 'block';
        }
        if (mobileBtnLogin) {
            mobileBtnLogin.textContent = '로그아웃';
            mobileBtnLogin.classList.replace('btn-blue', 'btn-gray');
        }
        if (mobileBtnSettings) mobileBtnSettings.style.display = 'block';

        const mobileBtnAddUser = document.getElementById('mobile-btn-add-user');
        if (mobileBtnAddUser) mobileBtnAddUser.style.display = (role === 'admin' || role === 'superadmin') ? 'block' : 'none';

        // [추가] 모바일 타이머 UI 표시 (common.html 템플릿 사용)
        let mobileTimerContainer = document.getElementById('mobile-session-timer');
        if (mobileTimerContainer) {
            mobileTimerContainer.style.display = 'flex';
        }

        if (dashboardWrapper) dashboardWrapper.style.filter = 'none';
        document.body.classList.remove('role-superadmin', 'role-admin', 'role-user');
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

        const btnHeaderAddUser = document.getElementById('btn-header-add-user');
        if (btnHeaderAddUser) btnHeaderAddUser.style.display = 'none';

        const adminItems = document.querySelectorAll('.nav-admin-item');
        adminItems.forEach(el => el.style.display = 'none');

        // [추가] 모바일 업데이트
        if (mobileUserInfo) mobileUserInfo.style.display = 'none';
        if (mobileBtnLogin) {
            mobileBtnLogin.textContent = '로그인';
            mobileBtnLogin.classList.replace('btn-gray', 'btn-blue');
        }
        if (mobileBtnSettings) mobileBtnSettings.style.display = 'none';

        const mobileBtnAddUser = document.getElementById('mobile-btn-add-user');
        if (mobileBtnAddUser) mobileBtnAddUser.style.display = 'none';

        document.body.classList.remove('role-superadmin', 'role-admin', 'role-user');

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

// [추가] 1개월 만료 시 강제 변경 모달 출력 함수
function showForcePwChangeModal() {
    const modal = document.getElementById('force-pw-change-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    const btnChange = document.getElementById('btn-force-pw-change');
    const btnCancel = document.getElementById('btn-force-pw-cancel');

    btnChange.onclick = () => {
        const currentPw = document.getElementById('force-pw-current').value;
        const newPw = document.getElementById('force-pw-new').value;
        const confirmPw = document.getElementById('force-pw-confirm').value;

        if (!currentPw || !newPw) return alert('현재 비밀번호와 새 비밀번호를 입력해주세요.');
        if (newPw !== confirmPw) return alert('새 비밀번호가 일치하지 않습니다.');
        if (!isValidPassword(newPw)) return alert('비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.');

        fetch('/api/user/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ id: sessionStorage.getItem('userId'), current_pw: currentPw, new_pw: newPw })
        }).then(res => res.json()).then(resData => {
            if (resData.status === 'success') {
                alert('비밀번호가 성공적으로 변경되었습니다.\n새로운 비밀번호로 다시 로그인해주세요.');
                modal.style.display = 'none';
                fetch('/api/logout', { method: 'POST', headers: { 'X-CSRFToken': getCookie('csrf_token') } }).then(() => { sessionStorage.clear(); location.reload(); });
            } else {
                alert(resData.message || '비밀번호 변경 실패');
            }
        });
    };

    btnCancel.onclick = () => {
        modal.style.display = 'none';
        fetch('/api/logout', { method: 'POST', headers: { 'X-CSRFToken': getCookie('csrf_token') } }).then(() => { sessionStorage.clear(); location.reload(); });
    };
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
                sessionStorage.setItem('userDepartment', data.department || '');
                sessionStorage.setItem('userPosition', data.position || '');
                sessionStorage.setItem('userName', data.name || '');
                addSystemLog('LOGIN', id, `로그인 성공 (${context})`);

                if (data.require_pw_change) {
                    showForcePwChangeModal();
                } else {
                    const homeLoginContainer = document.getElementById('home-login-container');
                    if (homeLoginContainer) {
                        document.getElementById('home-login-container').style.display = 'none';
                        document.getElementById('home-welcome-container').style.display = 'flex';
                        fetchServerData(() => {
                            checkLoginStatus();
                        });
                    } else {
                        location.reload();
                    }
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

function openAddUserModal() {
    const modals = document.querySelectorAll('#add-user-modal');
    if (modals.length === 0) return;

    // [핵심] 여러 개의 중복 HTML 중 항상 사용자가 보고 있는 마지막(최신) 모달을 선택
    const modal = modals[modals.length - 1];
    const role = sessionStorage.getItem('userRole');

    if (role !== 'admin' && role !== 'superadmin') {
        alert('관리자 권한이 필요합니다.');
        return;
    }

    if (modal) {
        // [추가] 최종관리자는 '최종관리자' 계정을 생성할 수 있도록 옵션 동적 추가/제거
        const roleSelect = modal.querySelector('#new-user-role');
        if (roleSelect) {
            const superadminOptionExists = Array.from(roleSelect.options).some(opt => opt.value === 'superadmin');

            if (role === 'superadmin' && !superadminOptionExists) {
                // 최종관리자 옵션 추가
                const option = document.createElement('option');
                option.value = 'superadmin';
                option.textContent = '최종관리자';
                roleSelect.appendChild(option);
            } else if (role !== 'superadmin' && superadminOptionExists) {
                // 최종관리자 옵션 제거
                roleSelect.querySelector('option[value="superadmin"]').remove();
            }
        }

        // 혹시 모를 중복 팝업들은 강제 숨김 처리
        modals.forEach(m => { if (m !== modal) m.style.display = 'none'; });
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // [추가] 모달 내 버튼 이벤트 확실하게 바인딩 (ID 중복으로 인한 버튼 먹통 방지)
        const btnAddUser = modal.querySelector('#btn-add-user');
        if (btnAddUser) btnAddUser.onclick = addNewUser;

        const btnClose = modal.querySelector('#btn-close-add-user-modal');
        if (btnClose) btnClose.onclick = closeAddUserModal;

        // 사업장 선택 드롭다운 데이터 갱신
        const siteSelect = modal.querySelector('#new-user-site');
        let siteInput = modal.querySelector('#new-user-site-input');
        const siteSuggestions = modal.querySelector('#new-user-site-suggestions');

        if (siteInput && siteSuggestions && siteSelect) {
            // [추가] 관리자 본인의 사업장을 기본값으로 자동 입력
            const adminSite = sessionStorage.getItem('userSite');
            if (adminSite && !siteInput.value) {
                siteInput.value = adminSite;
                siteInput.dataset.lastValid = adminSite;
                siteSelect.value = adminSite;
            }

            // [핵심 해결] 비동기 화면 전환 시 꼬여버린 이벤트를 초기화하기 위해 노드를 완전히 새로 복제하여 교체
            const newSiteInput = siteInput.cloneNode(true);
            siteInput.parentNode.replaceChild(newSiteInput, siteInput);
            siteInput = newSiteInput;

            siteInput.style.color = '#e6edf3';
            siteSuggestions.style.zIndex = '99999'; // 혹시 모를 가림 현상 완벽 차단

            const renderAddUserSites = () => {
                let dataMap = {};
                try {
                    const parsed = JSON.parse(localStorage.getItem('device_data'));
                    if (parsed) {
                        if (parsed.equipments) dataMap = parsed.equipments;
                        else dataMap = parsed;
                    }
                } catch (e) { }

                if (Object.keys(dataMap).length === 0 && typeof storageData !== 'undefined') {
                    dataMap = storageData;
                }

                const sites = Object.keys(dataMap).filter(k => k !== 'models' && k !== 'details').sort();


                siteSuggestions.innerHTML = '';
                const query = siteInput.value.trim().toLowerCase();
                const matches = query ? sites.filter(s => s.toLowerCase().includes(query)) : sites;

                if (!query) {
                    const defLi = document.createElement('li');
                    defLi.className = 'user-suggestion-item';
                    defLi.innerHTML = `<span style="color: #e6edf3;">사업장 미지정 (전체)</span>`;
                    defLi.addEventListener('click', (e) => {
                        siteInput.value = '';
                        siteSelect.value = '';
                        siteInput.dataset.lastValid = '';
                        siteSuggestions.style.display = 'none';
                    });
                    siteSuggestions.appendChild(defLi);
                }

                if (matches.length > 0) {
                    matches.forEach(site => {
                        const li = document.createElement('li');
                        li.className = 'user-suggestion-item';
                        li.innerHTML = `<span style="color: #e6edf3;">${escapeHtml(site)}</span>`;
                        li.addEventListener('click', (e) => {
                            siteInput.value = site;
                            siteSelect.value = site;
                            siteInput.dataset.lastValid = site;
                            siteSuggestions.style.display = 'none';
                        });
                        siteSuggestions.appendChild(li);
                    });
                } else {
                    const emptyLi = document.createElement('li');
                    emptyLi.className = 'user-suggestion-item';
                    emptyLi.style.cssText = 'color:#8b949e; cursor:default; justify-content:center;';
                    emptyLi.innerHTML = `<span>검색 결과 없음</span>`;
                    siteSuggestions.appendChild(emptyLi);
                }
            };

            siteInput.addEventListener('click', (e) => {
                e.stopPropagation();
                renderAddUserSites();
                siteSuggestions.style.display = 'block';
            });

            siteInput.addEventListener('input', () => {
                renderAddUserSites();
                siteSuggestions.style.display = 'block';
            });

            siteInput.addEventListener('focus', () => {
                renderAddUserSites();
                siteSuggestions.style.display = 'block';
            });

            // [추가] 모바일 스크롤 시 blur 이벤트로 인해 창이 닫히는 현상 방지
            let isSuggestionActive = false;
            siteSuggestions.addEventListener('mouseenter', () => isSuggestionActive = true);
            siteSuggestions.addEventListener('mouseleave', () => isSuggestionActive = false);
            siteSuggestions.addEventListener('touchstart', () => isSuggestionActive = true, { passive: true });
            siteSuggestions.addEventListener('touchend', () => setTimeout(() => isSuggestionActive = false, 500));

            siteInput.addEventListener('blur', () => {
                setTimeout(() => {
                    if (isSuggestionActive) return; // 모바일 터치/스크롤 중이면 무시

                    const currentVal = siteInput.value.trim();

                    let dataMap = {};
                    try {
                        const parsed = JSON.parse(localStorage.getItem('device_data'));
                        if (parsed) {
                            if (parsed.equipments) dataMap = parsed.equipments;
                            else dataMap = parsed;
                        }
                    } catch (e) { }
                    if (Object.keys(dataMap).length === 0 && typeof storageData !== 'undefined') {
                        dataMap = storageData;
                    }
                    const sites = Object.keys(dataMap).filter(k => k !== 'models' && k !== 'details');

                    if (currentVal === '') {
                        siteInput.dataset.lastValid = '';
                        siteSelect.value = '';
                    } else if (sites.includes(currentVal)) {
                        siteInput.dataset.lastValid = currentVal;
                        siteSelect.value = currentVal;
                    } else {
                        siteInput.value = siteInput.dataset.lastValid || '';
                        siteSelect.value = siteInput.dataset.lastValid || '';
                    }
                    siteSuggestions.style.display = 'none';
                }, 250);
            });

            // 기존 document 리스너가 중복 누적되는 것을 방지하기 위한 외부 클릭 감지 처리
            const outsideClickListener = (e) => {
                if (siteSuggestions.style.display === 'block' && e.target !== siteInput && !siteSuggestions.contains(e.target)) {
                    siteSuggestions.style.display = 'none';
                }
            };
            document.removeEventListener('mousedown', window._siteSuggestionOutsideClick);
            document.removeEventListener('touchstart', window._siteSuggestionOutsideClick);
            window._siteSuggestionOutsideClick = outsideClickListener;
            document.addEventListener('mousedown', outsideClickListener);
            document.addEventListener('touchstart', outsideClickListener, { passive: true });


        }
    }
}

function closeAddUserModal() {
    document.querySelectorAll('#add-user-modal').forEach(m => {
        m.style.display = 'none';
        ['new-user-id', 'new-user-pw', 'new-user-pw-confirm', 'new-user-department', 'new-user-position', 'new-user-name', 'new-user-site-input', 'new-user-site'].forEach(id => {
            const el = m.querySelector('#' + id);
            if (el) el.value = '';
        });
        // [추가] 계정 권한(Role) 선택값도 기본값으로 초기화
        const roleEl = m.querySelector('#new-user-role');
        if (roleEl) roleEl.value = 'user';
    });
}

function openUserModal() {
    const modal = document.getElementById('user-modal');
    const role = sessionStorage.getItem('userRole');

    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // [요청] 팝업 시 배경 스크롤 방지

        // 내 계정 정보 렌더링
        if (typeof window.renderMyInfo === 'function') window.renderMyInfo();

        const adminDeleteWrapper = document.getElementById('admin-user-delete-wrapper');
        if (role === 'admin' || role === 'superadmin') {
            if (adminDeleteWrapper) {
                adminDeleteWrapper.style.display = 'block';

                const searchInput = document.getElementById('admin-delete-user-input');
                const suggestionList = document.getElementById('admin-delete-user-suggestions');
                const delBtn = document.getElementById('btn-admin-delete-user');

                let deletableUsers = [];

                adminDeleteWrapper.fetchDeletableUsers = () => {
                    fetch('/api/users/deletable', { headers: { 'X-CSRFToken': getCookie('csrf_token') } })
                        .then(res => res.json())
                        .then(data => { if (data.status === 'success') deletableUsers = data.users; })
                        .catch(err => console.error(err));
                };

                adminDeleteWrapper.fetchDeletableUsers();

                const showSuggestions = () => {
                    if (!searchInput || !suggestionList) return;
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
                            let roleDisplay = '';
                            if (u.role === 'admin') {
                                roleDisplay = ' <span style="color: #f85149; font-weight: bold;">[관리자]</span>';
                            }
                            const namePart = u.name ? `${escapeHtml(u.name)} (${escapeHtml(u.department)} ${escapeHtml(u.position)})` : '이름 없음';
                            li.innerHTML = `<span style="color: #e6edf3;">${namePart}${roleDisplay}</span><span class="user-id" style="color: #8b949e;">${escapeHtml(u.id)}</span>`;
                            li.addEventListener('click', (e) => {
                                searchInput.value = u.name ? `${u.name} (${u.department} ${u.position}) - ${u.id}` : u.id;
                                searchInput.dataset.selectedId = u.id;
                                suggestionList.style.display = 'none';
                            });
                            suggestionList.appendChild(li);
                        });
                    } else {
                        suggestionList.innerHTML = '<li class="user-suggestion-item" style="color:#8b949e; cursor:default; justify-content:center;">검색 결과 없음</li>';
                    }
                    suggestionList.style.display = 'block';
                };

                // [추가] 모바일 스크롤 시 blur 이벤트로 인해 창이 닫히는 현상 방지
                let isSuggestionActive = false;
                suggestionList.addEventListener('mouseenter', () => isSuggestionActive = true);
                suggestionList.addEventListener('mouseleave', () => isSuggestionActive = false);
                suggestionList.addEventListener('touchstart', () => isSuggestionActive = true, { passive: true });
                suggestionList.addEventListener('touchend', () => setTimeout(() => isSuggestionActive = false, 500));

                if (searchInput) {
                    searchInput.style.color = '#e6edf3';
                    searchInput.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showSuggestions();
                    });
                    searchInput.addEventListener('focus', showSuggestions);
                    searchInput.addEventListener('input', () => {
                        delete searchInput.dataset.selectedId;
                        showSuggestions();
                    });
                    searchInput.addEventListener('blur', () => {
                        setTimeout(() => {
                            if (!isSuggestionActive) suggestionList.style.display = 'none';
                        }, 250);
                    });
                }

                // [수정] 모바일 외부 터치 감지 추가
                const outsideClickListener = (e) => {
                    if (suggestionList && suggestionList.style.display === 'block' && e.target !== searchInput && !suggestionList.contains(e.target)) {
                        suggestionList.style.display = 'none';
                    }
                };
                document.addEventListener('mousedown', outsideClickListener);
                document.addEventListener('touchstart', outsideClickListener, { passive: true });

                if (delBtn) {
                    // 이벤트 리스너 중복 추가 방지
                    const newDelBtn = delBtn.cloneNode(true);
                    delBtn.parentNode.replaceChild(newDelBtn, delBtn);

                    newDelBtn.addEventListener('click', () => {
                        let targetId = searchInput.dataset.selectedId || searchInput.value.trim();

                        // 수동으로 텍스트를 조작했을 경우를 대비한 안전장치
                        if (!searchInput.dataset.selectedId && targetId.includes(' - ')) {
                            targetId = targetId.split(' - ').pop().trim();
                        }

                        if (!targetId) return alert('삭제할 계정 아이디를 입력하거나 선택해주세요.');

                        const displayTarget = searchInput.value.trim();
                        if (!confirm(`'${displayTarget}' 계정을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

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
            }
        } else {
            if (adminDeleteWrapper) adminDeleteWrapper.style.display = 'none';
        }
    }
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = ''; // [요청] 팝업 닫을 시 배경 스크롤 복구
    ['change-pw-current', 'change-pw-new', 'change-pw-confirm', 'delete-account-pw', 'admin-delete-user-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function addNewUser() {
    const modals = document.querySelectorAll('#add-user-modal');
    const modal = modals.length > 0 ? modals[modals.length - 1] : document;

    const idInput = modal.querySelector('#new-user-id');
    const pwInput = modal.querySelector('#new-user-pw');
    const pwConfirmEl = modal.querySelector('#new-user-pw-confirm');
    const roleSelect = modal.querySelector('#new-user-role');
    const siteSelect = modal.querySelector('#new-user-site');
    const deptInput = modal.querySelector('#new-user-department');
    const posInput = modal.querySelector('#new-user-position');
    const nameInput = modal.querySelector('#new-user-name');
    const btnSubmit = modal.querySelector('#btn-add-user');

    const id = idInput ? idInput.value.trim() : '';
    const pw = pwInput ? pwInput.value.trim() : '';
    const pwConfirm = pwConfirmEl ? pwConfirmEl.value.trim() : '';
    const role = roleSelect ? roleSelect.value : 'user';
    const site = siteSelect ? siteSelect.value : ''; // [추가]

    const department = deptInput ? deptInput.value.trim() : '';
    const position = posInput ? posInput.value.trim() : '';
    const name = nameInput ? nameInput.value.trim() : '';

    if (!id || !pw) return alert('아이디와 비밀번호를 입력해주세요.');
    if (pw !== pwConfirm) return alert('비밀번호가 일치하지 않습니다.');
    if (!isValidPassword(pw)) return alert('비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.');
    if (!department) return alert('소속을 입력해주세요.');
    if (!position) return alert('직급을 입력해주세요.');
    if (!name) return alert('이름을 입력해주세요.');

    // [추가] 사용자의 연속 클릭(따닥)으로 인한 중복 생성 방지
    if (btnSubmit) btnSubmit.disabled = true;

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

                if (idInput) idInput.value = '';
                if (pwInput) pwInput.value = '';
                if (pwConfirmEl) pwConfirmEl.value = '';
                if (deptInput) deptInput.value = '';
                if (posInput) posInput.value = '';
                if (nameInput) nameInput.value = '';
                if (modal.querySelector('#new-user-site-input')) modal.querySelector('#new-user-site-input').value = '';
                if (siteSelect) siteSelect.value = '';
            } else {
                alert(data.message || '계정 추가 실패');
            }
        })
        .catch(err => {
            console.error('Add User Error:', err);
            alert('요청 처리 중 오류가 발생했습니다.');
        })
        .finally(() => {
            if (btnSubmit) btnSubmit.disabled = false; // 버튼 상태 복구
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
    if (!isValidPassword(newPw)) return alert('비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.');

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
                const template = document.getElementById('my-info-view-template');
                if (!content || !template) return;

                content.innerHTML = '';
                const clone = template.content.cloneNode(true);

                clone.getElementById('view-my-dept').value = user.department || '';
                clone.getElementById('view-my-pos').value = user.position || '';
                clone.getElementById('view-my-name').value = user.name || '';
                let roleDisplay = '일반';
                if (user.role === 'superadmin') roleDisplay = '최종관리자';
                else if (user.role === 'admin') roleDisplay = '관리자';
                clone.getElementById('view-my-role').value = roleDisplay;
                clone.getElementById('view-my-site').value = user.site || '전체 사업장';

                const btnEdit = clone.getElementById('btn-edit-my-info');
                if (btnEdit) {
                    btnEdit.onclick = () => {
                        const verifyModal = document.getElementById('verify-pw-modal');
                        const verifyInput = document.getElementById('verify-pw-input');
                        const verifyBtn = document.getElementById('btn-verify-pw-confirm');

                        if (verifyModal && verifyInput && verifyBtn) {
                            verifyInput.value = '';
                            verifyModal.style.display = 'flex';
                            verifyInput.focus();

                            verifyBtn.onclick = () => {
                                const pw = verifyInput.value;
                                if (!pw) return alert('현재 비밀번호를 입력해주세요.');

                                fetch('/api/user/verify', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                                    body: JSON.stringify({ pw: pw })
                                }).then(res => res.json()).then(vData => {
                                    if (vData.status === 'success') {
                                        verifyModal.style.display = 'none';
                                        window.renderMyInfoEdit(user);
                                    } else {
                                        alert(vData.message || '비밀번호가 일치하지 않습니다.');
                                        verifyInput.value = '';
                                        verifyInput.focus();
                                    }
                                });
                            };
                            verifyInput.onkeypress = (e) => { if (e.key === 'Enter') verifyBtn.click(); };
                        }
                    };
                }
                content.appendChild(clone);
            }
        });
};

// [추가] 내 계정 정보 수정 모드 렌더링 함수
window.renderMyInfoEdit = function (user) {
    const content = document.getElementById('my-info-content');
    const template = document.getElementById('my-info-edit-template');
    if (!content || !template) return;

    content.innerHTML = '';
    const clone = template.content.cloneNode(true);

    const isRoleEditable = (sessionStorage.getItem('userRole') === 'superadmin' && user.id !== 'admin') || (sessionStorage.getItem('userRole') === 'admin' && user.role !== 'superadmin' && user.id !== 'admin');

    const deptInput = clone.getElementById('edit-my-dept');
    const posInput = clone.getElementById('edit-my-pos');
    const nameInput = clone.getElementById('edit-my-name');
    const roleSelect = clone.getElementById('edit-my-role');
    const siteSelect = clone.getElementById('edit-my-site');

    if (deptInput) deptInput.value = user.department || '';
    if (posInput) posInput.value = user.position || '';
    if (nameInput) nameInput.value = user.name || '';

    if (roleSelect) {
        if (!isRoleEditable) roleSelect.disabled = true;
        if (user.role === 'superadmin') {
            if (!Array.from(roleSelect.options).some(opt => opt.value === 'superadmin')) {
                roleSelect.insertAdjacentHTML('afterbegin', '<option value="superadmin">최종관리자</option>');
            }
        }
        if (!Array.from(roleSelect.options).some(opt => opt.value === 'admin')) {
            roleSelect.insertAdjacentHTML('afterbegin', '<option value="admin">관리자</option>');
        }
        roleSelect.value = user.role;
    }
    if (siteSelect) {
        let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
        let withtechData = JSON.parse(localStorage.getItem('withtech_data')) || {};
        let dataMap = (typeof storageData !== 'undefined' && Object.keys(storageData).length > 0) ? storageData : (deviceData.equipments || deviceData);
        if (!dataMap || Object.keys(dataMap).length === 0) dataMap = withtechData;
        Object.keys(dataMap).sort().forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            siteSelect.appendChild(opt);
        });
        siteSelect.value = user.site || '';
    }

    const btnSave = clone.getElementById('btn-save-my-info');
    const btnCancel = clone.getElementById('btn-cancel-my-info');

    if (btnCancel) btnCancel.onclick = () => window.renderMyInfo();
    if (btnSave) {
        btnSave.onclick = () => {
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
                        sessionStorage.setItem('userDepartment', dept);
                        sessionStorage.setItem('userPosition', pos);
                        sessionStorage.setItem('userName', name);
                        addSystemLog('UPDATE_USER', user.id, '본인 계정 정보 수정');
                        window.renderMyInfo();
                    } else {
                        alert(data.message || '수정 실패');
                    }
                });
        };
    }

    content.appendChild(clone);
};

/* ==========================================================================
   5. 사이드바 및 리스트 관리 (Sidebar & List Management)
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

            // [수정] 고객사 장비명이 우선 표시되며, 없을 경우 시리얼 번호 표시
            let displaySubText = '';
            if (custEquipName) {
                displaySubText = custEquipName;
            } else if (modelName) {
                displaySubText = modelName;
            }

            const li = createListItem(name, displayEquipName, 'equip', (selectedEquip) => {
                onEquipClick(siteName, selectedEquip);
            }, displaySubText);

            // [수정] title 속성에도 전체 정보 추가
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
        <div class="item-wrapper" style="display: flex; align-items: center; flex-grow: 1; min-width: 0;">
            <span class="item-text" contenteditable="false" title="${escapeHtml(text)} ${subText ? escapeHtml(subText) : ''}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(text)}${subText ? `<span class="item-subtext">${escapeHtml(subText)}</span>` : ''}</span>
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

    li.querySelector('.del-btn').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`'${text}' 항목을 삭제하시겠습니까?`)) {
            if (type === 'site') {
                const success = await window.syncAdminDB('site', 'DELETE', { name: id });
                if (!success) return alert('서버 삭제에 실패했습니다.');

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

                const success = await window.syncAdminDB('equip', 'DELETE', { id: id, site: siteName });
                if (!success) return alert('서버 삭제에 실패했습니다.');
                
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

async function handleRename(oldName, newName, type) {
    if (type === 'site') {
        if (storageData[newName]) {
            alert('이미 존재하는 이름입니다.');
            renderSites();
            return;
        }

        const success = await window.syncAdminDB('site', 'UPDATE', { old_name: oldName, new_name: newName });
        if (!success) { renderSites(); return alert('서버 수정에 실패했습니다.'); }

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

        const parts = newName.split('::');
        const newModel = parts.length > 1 ? parts[1] : '';
        
        const success = await window.syncAdminDB('equip', 'UPDATE', { old_id: oldName, new_id: newName, site: siteName, setup: {model: newModel} });
        if (!success) { renderEquips(siteName); return alert('서버 수정에 실패했습니다.'); }

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
   6. 상세 화면 오케스트레이션 (Detail View Orchestration)
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

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const setup = data.setup || {};
    const custName = setup.custEquipName ? setup.custEquipName : '';

    let pathText = `📍 ${site} > ${displayEquipName}`;
    if (displaySerialNo && custName) {
        pathText += ` > ${displaySerialNo} [${custName}]`;
    } else if (custName) {
        pathText += ` > [${custName}]`;
    } else if (displaySerialNo) {
        pathText += ` > ${displaySerialNo}`;
    }
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
            const urlParams = new URLSearchParams(window.location.search);
            const targetLogId = urlParams.get('logId');

            const key = `details_${site}_${equip}`;
            const data = JSON.parse(localStorage.getItem(key)) || {};
            if (data.logs && data.logs.length > 0) {
                if (targetLogId) {
                    const matchedLog = data.logs.find(l => l.id == targetLogId);
                    if (matchedLog) {
                        setTimeout(() => {
                            selectLog(matchedLog.id, false);
                            const row = document.getElementById(`log-row-${matchedLog.id}`);
                            if (row) {
                                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }, 50);
                    } else {
                        data.logs.sort((a, b) => { if (b.date !== a.date) return b.date.localeCompare(a.date); return b.id - a.id; });
                        selectLog(data.logs[0].id, false);
                    }

                    // 새로고침 시 다시 선택되는 것을 방지하기 위해 URL에서 logId 파라미터 제거
                    const newUrl = new URL(window.location);
                    newUrl.searchParams.delete('logId');
                    window.history.replaceState({}, '', newUrl);
                } else {
                    data.logs.sort((a, b) => { if (b.date !== a.date) return b.date.localeCompare(a.date); return b.id - a.id; });
                    selectLog(data.logs[0].id, false); // 포커스 없이 선택
                }
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
   7. 시스템 로그 관리 (System Logs)
   ========================================================================== */
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
   8. 다음 작업 예정일 등록 모달 (Next Schedule Modal)
   ========================================================================== */

/**
 * [공통] 작업 완료 후 다음 예정일 등록 모달을 엽니다.
 * @param {object} options - 모달 옵션
 */
function openNextScheduleModal(options) {
    const { site, equip, items, completeDate, md, mergedRegItemIds, onClose, onDateChange } = options;

    currentNextScheduleTarget = { site, equip, items, completeDate, mergedRegItemIds, onClose, onDateChange };

    const modal = document.getElementById('next-schedule-modal');
    if (!modal) {
        alert('작업이 완료되었습니다.');
        if (onClose) onClose();
        return;
    }

    const skipBtn = document.getElementById('btn-skip-next-schedule');
    const saveBtn = document.getElementById('btn-save-next-schedule');

    const closeModal = () => {
        modal.style.display = 'none';
        if (currentNextScheduleTarget && typeof currentNextScheduleTarget.onClose === 'function') {
            currentNextScheduleTarget.onClose();
        }
        currentNextScheduleTarget = null;
    };

    if (skipBtn) {
        skipBtn.onclick = () => {
            alert('작업이 완료되었습니다.');
            closeModal();
        };
    }

    // 1. 예정일 계산 (선택된 항목 중 주기가 가장 큰 것 기준)
    let defaultNextDate = '';
    const firstValidItem = items.find(i => parseInt(i.period) > 0);
    if (firstValidItem) {
        const period = parseInt(firstValidItem.period);
        const dateObj = new Date(completeDate);
        dateObj.setDate(dateObj.getDate() + period);
        defaultNextDate = dateObj.toISOString().split('T')[0];
    } else {
        // [추가] 주기가 없고 정기 작업인 경우 1달 후로 설정
        const isRegular = items.some(i => i.type === '정기' || i.detailType === 'PM 점검');
        if (isRegular) {
            const dateObj = new Date(completeDate);
            dateObj.setMonth(dateObj.getMonth() + 1);
            defaultNextDate = dateObj.toISOString().split('T')[0];
        }
    }

    const dateInput = document.getElementById('next-schedule-date');
    if (dateInput) {
        dateInput.value = defaultNextDate;
        dateInput.min = completeDate;
    }

    // 2. 공수 초기화
    const mdInput = document.getElementById('next-schedule-md');
    if (mdInput) mdInput.value = md || '';

    // 3. 작업자 렌더링 및 드롭다운 설정
    const workerHidden = document.getElementById('next-schedule-worker-hidden');
    const workerTrigger = document.getElementById('next-schedule-worker-trigger');
    let initialWorker = items.find(i => i.worker)?.worker || sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';

    if (workerHidden) workerHidden.value = initialWorker;
    if (workerTrigger) {
        workerTrigger.textContent = initialWorker || '작업자 선택';
        workerTrigger.title = initialWorker;
    }
    if (initialWorker && mdInput && mdInput.value === '') {
        mdInput.value = initialWorker.split(',').filter(Boolean).length;
    }

    const wTrigger = document.getElementById('next-schedule-worker-trigger');
    const wDropdown = document.getElementById('next-schedule-worker-dropdown');
    const wSearch = document.getElementById('next-schedule-worker-search');
    const wList = document.getElementById('next-schedule-worker-list');
    const wConfirm = document.getElementById('btn-next-schedule-worker-confirm');

    if (wTrigger && wDropdown) {
        wTrigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== wDropdown) d.classList.remove('show'); });
            wDropdown.classList.toggle('show');
            if (wDropdown.classList.contains('show')) renderNextWorkers(wSearch ? wSearch.value.trim() : '');
        };

        const renderNextWorkers = async (searchTerm = '') => {
            const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(site) : [];
            const currentSelected = workerHidden.value ? workerHidden.value.split(',').map(s => s.trim()).filter(Boolean) : [];
            const allWorkers = workers.map(w => typeof w === 'string' ? { name: w, department: '', position: '', site: '' } : w);
            let displayWorkers = [...allWorkers];

            if (searchTerm) {
                const kw = searchTerm.toLowerCase();
                displayWorkers = displayWorkers.filter(w =>
                    w.name.toLowerCase().includes(kw) ||
                    w.department.toLowerCase().includes(kw) ||
                    w.position.toLowerCase().includes(kw)
                );
            }

            const displayedNames = new Set(displayWorkers.map(w => w.name));
            currentSelected.forEach(selectedName => {
                if (!displayedNames.has(selectedName)) {
                    const workerToAdd = allWorkers.find(w => w.name === selectedName);
                    if (workerToAdd) displayWorkers.unshift(workerToAdd);
                    else displayWorkers.unshift({ name: selectedName, department: '', position: '' });
                }
            });

            const userSite = sessionStorage.getItem('userSite') || '';
            displayWorkers.sort((a, b) => {
                const aSelected = currentSelected.includes(a.name);
                const bSelected = currentSelected.includes(b.name);
                if (aSelected && !bSelected) return -1;
                if (!aSelected && bSelected) return 1;

                const aSameSite = a.site === userSite;
                const bSameSite = b.site === userSite;
                if (aSameSite && !bSameSite) return -1;
                if (!aSameSite && bSameSite) return 1;
                return a.name.localeCompare(b.name);
            });

            if (typeof window.renderWorkerListItems === 'function') {
                window.renderWorkerListItems(wList, displayWorkers, currentSelected, () => {
                    const selected = Array.from(wList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
                    workerHidden.value = selected.join(', ');
                    if (selected.length > 0) wTrigger.textContent = selected.join(' ');
                    else wTrigger.textContent = '작업자 선택';
                    wTrigger.title = selected.join(', ');
                    if (mdInput) mdInput.value = selected.length.toString();
                });
            }
        };

        if (wSearch) {
            wSearch.onclick = (e) => e.stopPropagation();
            wSearch.oninput = (e) => renderNextWorkers(e.target.value.trim());
        }
        if (wConfirm) wConfirm.onclick = (e) => { e.stopPropagation(); wDropdown.classList.remove('show'); };
    }

    // 4. 점검 항목 렌더링 및 드롭다운 설정 (기존에 완료된 항목을 프리셋으로 세팅)
    const itemTrigger = document.getElementById('next-schedule-item-trigger');
    const itemDropdown = document.getElementById('next-schedule-item-dropdown');
    const itemConfirm = document.getElementById('btn-next-schedule-item-confirm');

    const presetItemsArr = items.filter(i => i.content !== '장비 점검').map(i => {
        let name = i.code ? i.code : i.content;
        return i.itemCost ? `[${i.itemCost}] ${name}` : name;
    });
    const presetItemsStr = presetItemsArr.join(', ');

    if (itemTrigger && itemDropdown) {
        itemTrigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== itemDropdown) d.classList.remove('show'); });
            itemDropdown.classList.toggle('show');
        };
        if (itemConfirm) itemConfirm.onclick = (e) => { e.stopPropagation(); itemDropdown.classList.remove('show'); };
    }

    window.currentDetailTarget = { equip: equip };
    if (typeof window.renderLogPartOptions === 'function') {
        window.renderLogPartOptions('next-schedule-item-wrapper', 'next-schedule-item-trigger', 'next-schedule-item-list', 'next-schedule-item-search', presetItemsStr);
    }
    window.currentDetailTarget = null;

    // 5. 저장 버튼 로직
    if (saveBtn) {
        saveBtn.onclick = () => {
            if (!currentNextScheduleTarget) return;

            const newDate = dateInput ? dateInput.value : '';
            const newMd = mdInput ? mdInput.value.trim() : '';
            const newWorker = workerHidden ? workerHidden.value.trim() : '';

            if (!newDate) return alert('예정일을 선택해주세요.');
            if (dateInput && dateInput.min && newDate < dateInput.min) return alert('다음 예정일은 이전 작업일 이후 날짜로 선택해주세요.');
            if (!newWorker) return alert('작업자를 선택해주세요.');

            const selectedItems = [];
            const itemList = document.getElementById('next-schedule-item-list');
            if (itemList) {
                itemList.querySelectorAll('.log-select-item.selected').forEach(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    selectedItems.push({
                        content: el.dataset.value,
                        cost: cSel ? cSel.value : '유상'
                    });
                });
            }

            // [수정] 항목을 명시적으로 선택하지 않아도 기본값('장비 점검')으로 다음 예정일이 무사히 등록되도록 변경
            if (selectedItems.length === 0) {
                selectedItems.push({ content: '장비 점검', cost: '유상' });
            }

            const key = `details_${site}_${equip}`;
            let data = JSON.parse(localStorage.getItem(key)) || {};
            let isUpdated = false;

            let payload = { maint_upserts: [] };

            if (!data.maint) data.maint = [];

            const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

            selectedItems.forEach((sItem, idx) => {
                let code = '';
                let fullContent = sItem.content;
                let period = null;

                const match = adminItems.find(a => a.part === sItem.content || a.code === sItem.content);
                if (match) {
                    code = match.code || '';
                    fullContent = match.part || sItem.content;
                    period = match.cycle || null;
                }

                let existingItem = data.maint.find(m => (m.content === fullContent || (code && m.code === code) || m.content === sItem.content) && mergedRegItemIds.has(m.id));
                if (!existingItem) existingItem = data.maint.find(m => m.content === fullContent || (code && m.code === code) || m.content === sItem.content);

                if (existingItem) {
                    const oldDate = existingItem.scheduledDate;
                    existingItem.scheduledDate = newDate;
                    existingItem.md = newMd;
                    existingItem.worker = newWorker;
                    existingItem.itemCost = sItem.cost;

                    if (existingItem.type !== '정기') {
                        existingItem.type = '정기';
                        existingItem.detailType = 'PM 점검';
                    }

                    if (typeof currentNextScheduleTarget.onDateChange === 'function') {
                        currentNextScheduleTarget.onDateChange(site, oldDate, newDate);
                    }
                    payload.maint_upserts.push(existingItem);
                } else {
                    const newItem = {
                        id: Date.now() + idx,
                        type: '정기',
                        detailType: 'PM 점검',
                        code: code,
                        content: fullContent,
                        date: '',
                        period: period,
                        scheduledDate: newDate,
                        costType: '',
                        worker: newWorker,
                        md: newMd,
                        itemCost: sItem.cost
                    };
                    data.maint.push(newItem);
                    payload.maint_upserts.push(newItem);

                    if (typeof currentNextScheduleTarget.onDateChange === 'function') {
                        currentNextScheduleTarget.onDateChange(site, null, newDate);
                    }
                }
                isUpdated = true;

                if (typeof addSystemLog === 'function') {
                    addSystemLog('ADD_SCHEDULE', equip, `Date: ${newDate}, Content: ${fullContent}, Next Schedule`);
                }
            });

            if (isUpdated) {
                localStorage.setItem(key, JSON.stringify(data));
                window.syncHistoryTransaction(site, equip, payload);
            }

            alert('작업 완료 및 다음 예정일 처리가 완료되었습니다.');
            closeModal();
        };
    }

    modal.style.display = 'flex';
}

/* ==========================================================================
   9. 추가 작업 내역 확인 모달 (Extra Work History Modal)
   ========================================================================== */
window.openExtraWorkHistoryModal = function (site, equip, originalLogId) {
    const modal = document.getElementById('extra-work-history-modal');
    const tbody = document.getElementById('extra-work-history-body');
    const pathEl = document.getElementById('extra-work-history-path');
    const memoEl = document.getElementById('extra-work-history-memo');
    const moveBtn = document.getElementById('btn-move-to-extra-work-origin');
    const workerEl = document.getElementById('extra-work-history-worker');
    const mdEl = document.getElementById('extra-work-history-md');
    if (!modal || !tbody) return;

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const logs = data.logs || [];

    const parentLog = logs.find(l => l.id == originalLogId);
    const childLogs = logs.filter(l => l.originalLogId == originalLogId);

    if (!parentLog) return alert('원본 작업을 찾을 수 없습니다.');

    // 1. 점검 구분 경로 설정
    let pathText = parentLog.type || '정기';
    let detailStr = parentLog.detailType || '';
    if (parentLog.detailType2 && !detailStr.includes(parentLog.detailType2)) {
        detailStr += ` > ${parentLog.detailType2}`;
    }
    if (detailStr) {
        pathText += ` > ${detailStr}`;
    }
    if (pathEl) pathEl.textContent = pathText;

    // 2. 메모 텍스트에어리어 초기화
    if (memoEl) memoEl.value = parentLog.memo || '작성된 메모가 없습니다.';
    if (workerEl) workerEl.textContent = parentLog.worker || '-';
    if (mdEl) mdEl.textContent = parentLog.md || '0';

    // 3. 해당 장비 점검 이력으로 이동하는 버튼 이벤트
    if (moveBtn) {
        moveBtn.onclick = () => {
            let targetUrl = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}&logId=${originalLogId}`;
            location.href = targetUrl;
        };
    }

    tbody.innerHTML = '';

    const createRow = (log, badgeText, badgeColor, isParent) => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        if (isParent) tr.style.backgroundColor = 'rgba(35, 134, 54, 0.1)';

        tr.innerHTML = `
<td><span class="badge" style="background:${badgeColor}; display: inline-block; width: 45px; text-align: center; padding: 3px 0; font-size: 11px; border-radius: 4px; color: #fff; font-weight: bold;">${badgeText}</span></td>            <td>${log.date || '-'}</td>
            <td style="text-align: left; padding-left: 10px;">${escapeHtml(log.content || '-')}</td>
        `;

        tr.onclick = () => {
            if (memoEl) memoEl.value = log.memo || '작성된 메모가 없습니다.';
            if (workerEl) workerEl.textContent = log.worker || '-';
            if (mdEl) mdEl.textContent = log.md || '0';
            Array.from(tbody.children).forEach(child => child.classList.remove('active-row'));
            tr.classList.add('active-row');
        };

        return tr;
    };

    // 부모 로그 렌더링
    const parentRow = createRow(parentLog, '최초', '#238636', true);
    parentRow.classList.add('active-row');
    tbody.appendChild(parentRow);

    // 자식 로그 렌더링
    childLogs.forEach((log, idx) => {
        tbody.appendChild(createRow(log, `추가 ${idx + 1}`, '#1f6feb', false));
    });

    modal.style.display = 'flex';
};

/* ==========================================================================
   10. 날짜/휴일 및 공통 헬퍼 (Date & Common Helpers)
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

/* ==========================================================================
   10-1. 통합 공통 유틸리티 (Shared Components)
   ========================================================================== */
window.workerNamesCache = [];
window.fetchWorkerNames = async function (site = null) {
    if (!site && window.workerNamesCache.length > 0) return window.workerNamesCache;
    try {
        const url = site ? `/api/users/names?site=${encodeURIComponent(site)}` : '/api/users/names';
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success') {
                const workers = data.workers || data.names || [];
                if (!site) window.workerNamesCache = workers;
                return workers;
            }
        }
    } catch (e) { console.error("fetchWorkerNames Error:", e); }
    return [];
};

window.renderWorkerListItems = function (listContainer, displayWorkers, currentSelected, onClickCallback) {
    listContainer.innerHTML = '';
    if (displayWorkers.length === 0) {
        listContainer.innerHTML = `<div class="log-select-empty-msg" style="padding:10px; color:#8b949e; text-align:center;">검색 결과가 없습니다.</div>`;
        return;
    }
    displayWorkers.forEach(w => {
        const isSelected = currentSelected.includes(w.name);
        const tpl = getTemplateContent('worker-list-item-template');
        if (tpl) {
            const div = tpl.querySelector('.log-select-item');
            if (isSelected) div.classList.add('selected');
            div.dataset.value = w.name;
            div.querySelector('.worker-name').textContent = w.name;
            if (w.site) div.querySelector('.worker-site').textContent = `[${w.site}]`;
            if (w.department || w.position) div.querySelector('.worker-dept-pos').textContent = `(${w.department || ''} ${w.position || ''})`;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                const trigger = div.closest('.log-select-wrapper')?.querySelector('.log-select-trigger');
                if (trigger && trigger.classList.contains('disabled')) return;
                div.classList.toggle('selected');
                if (onClickCallback) onClickCallback();
            });
            listContainer.appendChild(div);
        }
    });
};

window.renderLogPartOptions = function (wrapperId, triggerId, listId, searchId, presetValuesStr = '') {
    const list = document.getElementById(listId);
    const trigger = document.getElementById(triggerId);
    const searchInput = document.getElementById(searchId);
    if (!list || !trigger) return;

    const currentValues = presetValuesStr ? presetValuesStr.split(',').map(s => s.trim()).filter(s => s) : [];
    const selectedMap = {};
    currentValues.forEach(val => {
        const match = val.match(/^\[(.*?)\] (.*)$/);
        if (match) selectedMap[match[2]] = match[1];
        else selectedMap[val] = '유상';
    });

    let equipName = '';
    if (window.currentDetailTarget && window.currentDetailTarget.equip) {
        equipName = window.currentDetailTarget.equip.split('::')[0];
    } else if (document.getElementById('register-equip-select') && document.getElementById('register-equip-select').value) {
        equipName = document.getElementById('register-equip-select').value.split('::')[0];
    } else if (typeof currentPath !== 'undefined' && currentPath.equip) {
        equipName = currentPath.equip.split('::')[0];
    }

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    let matchedItems = adminItems.filter(item => item.equip && item.equip.split(',').map(e => e.trim()).includes(equipName));

    Object.keys(selectedMap).forEach(key => {
        if (!matchedItems.some(i => i.part === key || i.code === key)) {
            const globalMatch = adminItems.find(i => i.part === key || i.code === key);
            if (globalMatch) matchedItems.unshift(globalMatch);
            else matchedItems.unshift({ part: key, code: '' });
        }
    });

    let otherItems = adminItems.filter(item => !matchedItems.some(mi => mi.part === item.part));
    let showAll = matchedItems.length === 0;

    const render = (searchTerm = '') => {
        const currentSelections = { ...selectedMap };
        list.querySelectorAll('.log-select-item.selected').forEach(el => {
            const cSel = el.querySelector('.item-cost-select');
            currentSelections[el.dataset.value] = cSel ? cSel.value : '유상';
        });
        let displayItems = showAll ? [...matchedItems, ...otherItems] : matchedItems;
        if (searchTerm) {
            const kws = searchTerm.toLowerCase().split(/\s+/);
            displayItems = [...matchedItems, ...otherItems].filter(item => kws.every(kw => `${item.part || ''} ${item.code || ''}`.toLowerCase().includes(kw)));
        }
        const displayItemValues = new Set(displayItems.map(i => i.code ? i.code : i.part));
        Object.keys(currentSelections).forEach(selectedValue => {
            if (!displayItemValues.has(selectedValue)) {
                const originalItem = [...matchedItems, ...otherItems].find(i => (i.code ? i.code : i.part) === selectedValue);
                if (originalItem) displayItems.unshift(originalItem);
                else displayItems.unshift({ part: selectedValue, code: '' });
            }
        });
        const uniqueItems = [];
        const seen = new Set();
        displayItems.forEach(item => {
            const val = item.code ? item.code : item.part;
            if (!seen.has(val)) { seen.add(val); uniqueItems.push(item); }
        });
        list.innerHTML = '';
        uniqueItems.forEach(item => {
            const displayValue = item.code ? item.code : item.part;
            const isSelected = currentSelections.hasOwnProperty(displayValue) || currentSelections.hasOwnProperty(item.part);
            const itemCost = isSelected ? (currentSelections[displayValue] || currentSelections[item.part] || '유상') : '유상';
            const template = getTemplateContent('log-part-item-template');
            if (!template) return;
            const div = template.querySelector('.log-select-item');
            if (isSelected) div.classList.add('selected');
            div.dataset.value = escapeHtml(displayValue);
            div.querySelector('.item-name').textContent = escapeHtml(displayValue);
            div.querySelector('.item-cost-select').value = itemCost;
            list.appendChild(div);
        });
        if (!showAll && !searchTerm && otherItems.length > 0) {
            const moreBtn = document.createElement('button');
            moreBtn.className = 'show-all-btn';
            moreBtn.innerHTML = '⬇️ 더보기 (전체 물품)';
            moreBtn.type = 'button';
            moreBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showAll = true; render(searchInput ? searchInput.value : ''); };
            list.appendChild(moreBtn);
        }
        const updateTriggerText = () => {
            const sels = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => {
                const cSel = el.querySelector('.item-cost-select');
                return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
            });
            if (sels.length > 1) trigger.textContent = `${sels[0].split('] ')[1] || sels[0]} 외 ${sels.length - 1}개`;
            else if (sels.length === 1) trigger.textContent = sels[0].split('] ')[1] || sels[0];
            else trigger.textContent = '물품 선택';
            trigger.title = sels.join('\\n');
            trigger.classList.remove('error-border');
        };
        list.querySelectorAll('.item-cost-select').forEach(cSel => {
            cSel.addEventListener('change', (e) => { e.stopPropagation(); if (cSel.closest('.log-select-item').classList.contains('selected')) updateTriggerText(); });
        });
        list.querySelectorAll('.log-select-item').forEach(div => {
            div.addEventListener('mousedown', (e) => {
                if (e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') return;
                e.preventDefault(); e.stopPropagation();
                div.classList.toggle('selected');
                updateTriggerText();
            });
        });
        updateTriggerText();
    };
    if (searchInput) searchInput.oninput = (e) => render(e.target.value.trim());
    render();
};

window.removeErrorBorder = function (e) {
    if (e.target) e.target.classList.remove('error-border');
};

window.getDragAfterElement = function (container, y, selector) {
    const draggableElements = [...container.querySelectorAll(selector)];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return (offset < 0 && offset > closest.offset) ? { offset: offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
};
