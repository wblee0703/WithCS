/* ==========================================================================
   1. 전역 변수 및 데이터 관리 (Global State)
   ========================================================================== */

// [추가] iOS/Safari 및 개인정보 보호 모드(Private Browsing) 대응을 위한 로컬 스토리지(Storage) 안전망 폴리필
// iOS Safari의 5MB 용량 초과 에러(QuotaExceededError) 또는 스토리지 접근 차단 시 예외를 방지하고 인메모리(in-memory) 백업으로 안전하게 전환합니다.
(function() {
    window.storageFallback = {};
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
        try {
            originalSetItem.call(this, key, value);
        } catch (e) {
            // [개선] 브라우저 용량 초과 시 콘솔 경고 메시지 없이 투명하게 인메모리 백업 저장소로 저장
            window.storageFallback[key] = String(value);
        }
    };

    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
        try {
            const val = originalGetItem.call(this, key);
            if (val !== null) return val;
        } catch (e) {}
        return window.storageFallback.hasOwnProperty(key) ? window.storageFallback[key] : null;
    };

    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) {
        try {
            originalRemoveItem.call(this, key);
        } catch (e) {}
        if (window.storageFallback.hasOwnProperty(key)) {
            delete window.storageFallback[key];
        }
    };

    const originalClear = Storage.prototype.clear;
    Storage.prototype.clear = function() {
        try {
            originalClear.call(this);
        } catch (e) {}
        window.storageFallback = {};
    };
})();


// [추가] 세션 만료 1회만 알림 플래그
let isSessionExpiredAlertShown = false;

// [추가] 모달 / 팝업 뒤로가기 감지 스택 및 popstate 처리
window.openModalStack = [];

window.pushModalHistory = function(closeFn) {
    if (typeof closeFn === 'function') {
        window.openModalStack.push(closeFn);
    }
    try {
        history.pushState({ modalOpen: true, stackIndex: window.openModalStack.length }, '');
    } catch (e) {}
};

window.popModalHistory = function() {
    if (window.openModalStack && window.openModalStack.length > 0) {
        window.openModalStack.pop();
    }
};

// 최상단 열려있는 모달/팝업 닫기 헬퍼 함수
window.closeTopmostModal = function() {
    // 1. openModalStack에 닫기 스택이 있으면 우선 실행
    if (window.openModalStack && window.openModalStack.length > 0) {
        const closeFn = window.openModalStack.pop();
        if (typeof closeFn === 'function') {
            try { closeFn(); return true; } catch (err) {}
        }
    }

    // 2. DOM에서 열려있는 모달 요소 자동 감지하여 닫기
    const allModals = Array.from(document.querySelectorAll(
        '.modal-overlay, .modal-window, div[id$="-modal"], #chatbot-window, #event-detail-modal, #log-modal, #schedule-modal, #setup-detail-modal, #next-schedule-modal'
    ));

    const visibleModals = allModals.filter(m => {
        if (m.id === 'global-loading-overlay') return false; // 로딩 오버레이는 예외
        const style = window.getComputedStyle(m);
        const isFlexOrBlock = style.display === 'flex' || style.display === 'block';
        const isClassActive = m.classList.contains('active') || m.classList.contains('show');
        return (isFlexOrBlock || isClassActive) && style.visibility !== 'hidden' && m.offsetWidth > 0 && m.offsetHeight > 0;
    });

    if (visibleModals.length > 0) {
        visibleModals.sort((a, b) => {
            const zA = parseInt(window.getComputedStyle(a).zIndex) || 0;
            const zB = parseInt(window.getComputedStyle(b).zIndex) || 0;
            return zB - zA;
        });

        const topModal = visibleModals[0];

        // 모달 내 닫기 버튼 클릭 유도
        const closeBtn = topModal.querySelector('.modal-close-btn, .btn-close, .close-btn, button[onclick*="close"], button[id*="close"]');
        if (closeBtn) {
            try {
                closeBtn.click();
                return true;
            } catch (e) {}
        }

        topModal.style.display = 'none';
        topModal.classList.remove('active', 'show');
        return true;
    }

    return false;
};

// 뒤로가기(popstate) 발생 시 열린 모달이 있으면 모달부터 닫기
window.addEventListener('popstate', function(e) {
    const isClosed = window.closeTopmostModal();
    if (isClosed) {
        e.preventDefault();
        e.stopPropagation();
    }
});

// MutationObserver로 모달 열림 감지 시 history.pushState 자동 등록
document.addEventListener('DOMContentLoaded', function() {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.type === 'attributes' && (mutation.attributeName === 'style' || mutation.attributeName === 'class')) {
                const target = mutation.target;
                if (target.id === 'global-loading-overlay') return;
                if (target.matches && target.matches('.modal-overlay, div[id$="-modal"], #chatbot-window')) {
                    const style = window.getComputedStyle(target);
                    const isVisible = (style.display === 'flex' || style.display === 'block' || target.classList.contains('active')) && style.visibility !== 'hidden';

                    if (isVisible && !target.dataset.historyPushed) {
                        target.dataset.historyPushed = 'true';
                        try {
                            history.pushState({ modalId: target.id || 'modal' }, '');
                        } catch (e) {}
                    } else if (!isVisible && target.dataset.historyPushed) {
                        delete target.dataset.historyPushed;
                    }
                }
            }
        });
    });

    observer.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ['style', 'class']
    });
});

// [추가] 전역 로딩 오버레이 제어 함수
let globalLoadingCount = 1; // 초기 로딩 시 1로 시작

window.showLoading = function(message = '로딩 중입니다...') {
    globalLoadingCount++;
    const overlay = document.getElementById('global-loading-overlay');
    const textEl = document.getElementById('global-loading-text');
    if (textEl) textEl.textContent = message;
    if (overlay) overlay.style.display = 'flex';
};

window.hideLoading = function(force = false) {
    if (force) globalLoadingCount = 0;
    else globalLoadingCount = Math.max(0, globalLoadingCount - 1);

    if (globalLoadingCount === 0) {
        const overlay = document.getElementById('global-loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }
};

// 1. 초기 페이지 및 자원 로딩 처리 (캐시가 구성되었으면 즉시 해제하여 렉 및 깜빡임 방지)
window.addEventListener('load', function() {
    if (localStorage.getItem('device_data') || window.isDataLoaded) {
        window.hideLoading(true);
    } else {
        setTimeout(function() {
            window.hideLoading(true);
        }, 100);
    }
});

// [추가] 전역 fetch 인터셉터: 모든 API 통신 시 세션 만료(401) 및 CSRF 에러(400) 감지하여 자동 로그아웃 처리
const originalFetch = window.fetch;
window.fetch = async function (...args) {
    try {
        const response = await originalFetch(...args);

        const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');

        // 401 Unauthorized 감지 (세션 만료)
        if (response.status === 401) {
            // 로그인, 비밀번호 확인 등 명시적으로 401 에러 메시지를 화면에 띄워야 하는 API는 자동 튕김 예외 처리
            const excludedUrls = ['/api/login', '/api/user/verify', '/api/user/password', '/api/user/delete', '/api/admin/user/delete'];
            if (!excludedUrls.some(excluded => url.includes(excluded))) {
                if (typeof window.handleSessionExpired === 'function') {
                    window.handleSessionExpired();
                } else if (!isSessionExpiredAlertShown) {
                    isSessionExpiredAlertShown = true;
                    alert('보안 세션이 만료되었습니다. 다시 로그인해주세요.');
                    sessionStorage.clear();
                    window.location.href = '/';
                }
                return Promise.reject(new Error('Session expired'));
            }
        }

        // 400 Bad Request 중 CSRF 보안 토큰 만료 감지
        if (response.status === 400) {
            const clonedResponse = response.clone();
            try {
                const data = await clonedResponse.json();
                if (data.status === 'fail' && data.message && data.message.includes('보안 세션이 만료되었거나')) {
                    if (!isSessionExpiredAlertShown) {
                        isSessionExpiredAlertShown = true;
                        alert(data.message);
                        sessionStorage.clear();
                        window.location.href = '/';
                    }
                    return Promise.reject(new Error('CSRF Token expired'));
                }
            } catch (e) { }
        }

        return response;
    } catch (error) {
        throw error;
    }
};

// [추가] HTML 템플릿을 복제하는 헬퍼 함수
function getTemplateContent(id) {
    const template = document.getElementById(id);
    if (template) return document.importNode(template.content, true);
    // console.warn(`Template with id '${id}' not found. Using fallback if available.`);
    return null;
}

window.handleSessionExpired = function () {
    if (isSessionExpiredAlertShown) return;
    isSessionExpiredAlertShown = true;
    if (typeof stopSessionTimer === 'function') stopSessionTimer();
    alert('보안을 위해 세션이 만료되었습니다.\n다시 로그인해주세요.');
    fetch('/api/logout', {
        method: 'POST',
        headers: { 'X-CSRFToken': getCookie('csrf_token') }
    }).finally(() => {
        sessionStorage.clear();
        location.reload();
    });
};

window.checkSessionValid = function () {
    if (sessionStorage.getItem('isLoggedIn') !== 'true') return false;
    const expiry = parseInt(sessionStorage.getItem('sessionExpiryTime'), 10);
    if (!expiry || Date.now() > expiry) {
        window.handleSessionExpired();
        return false;
    }
    return true;
};

let storageData = JSON.parse(localStorage.getItem('device_data')) || {};
let currentPath = { site: '', equip: '' };
let selectedLogId = null;
let originalMemo = "";
let originalSetupData = null;
let currentLogFilters = ['common', 'setup', 'maint', 'admin']; // [수정] 현재 로그 필터 상태 (복수 선택 지원)
let currentNextScheduleTarget = null; // [추가] 다음 작업 예정일 타겟
let currentDetailTarget = null; // [추가] 작업 상세 정보 팝업 타겟
let sessionTimer = null; // [추가] 세션 타이머
let sessionTimeLeft = 3600; // 60분 리셋 (3600초)
let lastActivityTimestamp = Date.now(); // [추가] 마지막 사용자 활동 시간
let cameFromTaskSearch = false; // [추가] 작업 검색에서 왔는지 여부 (상태 유지용)

/**
 * 공통: 사업장 및 장비 매핑 데이터 가져오기
 */
function getDeviceDataMap() {
    if (typeof storageData !== 'undefined') {
        if (storageData.device_data) return storageData.device_data;
        return storageData;
    }
    return JSON.parse(localStorage.getItem('device_data')) || {};
}

const setupInputIds = [
    'DeviceID-cust-equip-name', 'DeviceID-project-no', 'DeviceID-building', 'DeviceID-floor', 'DeviceID-detail-loc',
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

// [추가] 텍스트에서 물품명과 물품 상세(Spec)를 분리하는 전역 유틸리티 함수
window.extractSpecFromContent = function (contentStr) {
    if (!contentStr) return { spec: '', pureContent: '' };
    const match = contentStr.match(/ \[(.*?)\]$/);
    if (match) {
        return { spec: match[1], pureContent: contentStr.replace(match[0], '') };
    }
    return { spec: '', pureContent: contentStr };
};

// [추가] 물품명에 쉼표(,)가 포함되어 있을 때 다중 물품으로 오인되어 분할되는 현상을 방지하는 지능형 스플릿 유틸리티
window.splitSafetyContent = function (contentStr, adminItems) {
    if (!contentStr) return [];
    if (!adminItems) {
        adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    }

    // 콤마가 포함된 실제 물품명(part) 필터링 및 길이 내림차순 정렬
    const commaParts = adminItems
        .map(item => item.part)
        .filter(part => part && part.includes(','))
        .sort((a, b) => b.length - a.length);

    let tempStr = contentStr;
    const placeholderMap = new Map();

    // 콤마 포함 물품명을 임시 플레이스홀더로 치환
    commaParts.forEach((part, index) => {
        const placeholder = `___COMMA_PLACEHOLDER_${index}___`;
        // 정규식 escape
        const escapedPart = part.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(escapedPart, 'g');
        if (regex.test(tempStr)) {
            tempStr = tempStr.replace(regex, placeholder);
            placeholderMap.set(placeholder, part);
        }
    });

    // 이제 안전하게 콤마로 스플릿
    const splitted = tempStr.split(',').map(s => s.trim()).filter(Boolean);

    // 플레이스홀더 복원
    const restored = splitted.map(item => {
        let restoredItem = item;
        placeholderMap.forEach((originalPart, placeholder) => {
            restoredItem = restoredItem.replace(new RegExp(placeholder, 'g'), originalPart);
        });
        return restoredItem;
    });

    return restored;
};


/* ==========================================================================
   2. DB 동기화 API 통신 (DB Sync APIs)
   ========================================================================== */

// [추가] 진행 중인 서버 동기화 요청 개수 (페이지 강제 종료 방지용)
window.activeSyncRequests = 0;

window.resolveFullEquipKey = function (site, equip) {
    if (!site || !equip) return equip || '';
    const cleanSite = site.trim();
    let cleanEquip = equip.trim();
    if (!cleanEquip) return '';

    const deviceDataMap = (typeof getDeviceDataMap === 'function') ? getDeviceDataMap() : (JSON.parse(localStorage.getItem('device_data')) || {});
    const siteEquips = deviceDataMap[cleanSite] || [];
    if (!siteEquips || siteEquips.length === 0) return cleanEquip;

    const collapsedEquip = cleanEquip.replace(/:{2,}/g, '::');
    if (siteEquips.includes(cleanEquip)) {
        return cleanEquip;
    }
    if (siteEquips.includes(collapsedEquip)) {
        return collapsedEquip;
    }

    const normKey = (str) => (str || '').replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
    const cleanNormEquip = normKey(cleanEquip);
    if (cleanNormEquip) {
        const directNormMatch = siteEquips.find(eq => normKey(eq) === cleanNormEquip);
        if (directNormMatch) return directNormMatch;
    }

    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const modelAliasMap = {};
    equipmentModels.forEach(m => {
        if (m && m.name && m.abbr) {
            const normN = normKey(m.name);
            const normA = normKey(m.abbr);
            if (normN && normA) {
                modelAliasMap[normN] = normA;
                modelAliasMap[normA] = normN;
            }
        }
    });

    if (cleanNormEquip && Object.keys(modelAliasMap).length > 0) {
        for (const [k, v] of Object.entries(modelAliasMap)) {
            if (cleanNormEquip.includes(k)) {
                const aliasedNorm = cleanNormEquip.replace(k, v);
                const aliasMatch = siteEquips.find(eq => normKey(eq) === aliasedNorm);
                if (aliasMatch) return aliasMatch;
            }
        }
    }

    const rawParts = cleanEquip.split('::').map(p => p.trim()).filter(Boolean);
    let inModel = '', inSerial = '', inCust = '';

    if (rawParts.length >= 4) {
        inModel = rawParts[0];
        inSerial = rawParts[1];
        inCust = rawParts[2];
    } else if (rawParts.length === 3) {
        inModel = rawParts[0];
        const val = rawParts[1];
        const val2 = rawParts[2];
        const invalidSerials = ['n/a', 'none', '-', '없음', 'null', 'undefined', ''];

        if (val2 && !val) {
            inSerial = '';
            inCust = val2;
        } else if (val && val.toLowerCase() !== 'n/a' && !invalidSerials.includes(val.toLowerCase())) {
            inSerial = val;
            inCust = val2;
        } else {
            inSerial = '';
            inCust = val2 || val;
        }
    } else if (rawParts.length === 2) {
        inModel = rawParts[0];
        inSerial = rawParts[1];
    } else if (rawParts.length === 1) {
        inModel = rawParts[0];
    }

    const invalidSerials = ['n/a', 'none', '-', '없음', 'null', 'undefined', ''];
    const isSerialValid = inSerial && !invalidSerials.includes(inSerial.toLowerCase());

    const candList = siteEquips.map(eq => {
        const parts = eq.split('::').map(p => p.trim()).filter(Boolean);
        return {
            fullKey: eq,
            model: parts[0] || '',
            serial: parts[1] || '',
            cust: parts[2] || ''
        };
    });

    // 1. Model + Serial + CustEquipName 모두 일치
    if (inModel && isSerialValid && inCust) {
        const match = candList.find(c => c.model === inModel && c.serial === inSerial && c.cust === inCust);
        if (match) return match.fullKey;
    }

    // 2. Model + CustEquipName 일치 (Serial이 비어있거나 불일치해도 고객사 장비명 일치 시 매칭)
    if (inModel && inCust) {
        const match = candList.find(c => c.model === inModel && c.cust === inCust);
        if (match) return match.fullKey;
    }

    // 3. Model + Serial 일치
    if (inModel && isSerialValid) {
        const match = candList.find(c => c.model === inModel && c.serial === inSerial);
        if (match) return match.fullKey;
    }

    // [추가] 3.5. Model + (inSerial 혹은 inCust)가 c.serial 혹은 c.cust와 자유 교차 일치
    if (inModel && (isSerialValid || inCust)) {
        const match = candList.find(c => c.model === inModel && (
            (c.serial && (c.serial === inSerial || c.serial === inCust)) ||
            (c.cust && (c.cust === inSerial || c.cust === inCust))
        ));
        if (match) return match.fullKey;
    }

    // 4. CustEquipName 단독 고유 일치
    if (inCust) {
        const custMatches = candList.filter(c => c.cust === inCust);
        if (custMatches.length === 1) return custMatches[0].fullKey;
    }

    // 5. Serial 단독 고유 일치
    if (isSerialValid) {
        const serialMatches = candList.filter(c => c.serial === inSerial);
        if (serialMatches.length === 1) return serialMatches[0].fullKey;
    }

    // 6. Model 단독 매칭 (단 1대만 존재할 때)
    if (inModel) {
        const modelMatches = candList.filter(c => c.model === inModel);
        if (modelMatches.length === 1) return modelMatches[0].fullKey;
    }

    return cleanEquip;
};

// [추가] UI 장비 키를 DB equipment.id로 직접 매핑
window.getEquipmentDbId = function (site, equip) {
    if (!site || !equip) return '';

    let resolvedEquip = equip;
    if (typeof window.resolveFullEquipKey === 'function') {
        resolvedEquip = window.resolveFullEquipKey(site, equip);
    }

    const map = JSON.parse(localStorage.getItem('equip_id_map') || '{}');
    const candidates = [
        `${site}::${equip}`,
        `${site}::${resolvedEquip}`
    ];

    for (const key of candidates) {
        if (map[key]) return map[key];
    }

    const detailKey = `details_${site}_${resolvedEquip}`;
    const detailData = JSON.parse(localStorage.getItem(detailKey) || '{}');
    if (detailData.equipmentId) return detailData.equipmentId;

    return `${site}::${resolvedEquip}`;
};

// [요청 반영] 최초 작업 삭제 시 추가작업 1을 최초 작업으로 격상하고 나머지 추가작업의 originalLogId를 추가작업 1 ID로 재바인딩
window.reassignChildExtraWorks = function (site, equip, deletedIds) {
    if (!site || !equip || !deletedIds || deletedIds.length === 0) return;
    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    let logs = data.logs || [];
    let maint = data.maint || [];
    let stateChanged = false;

    deletedIds.forEach(dId => {
        const dIdStr = String(dId).trim();
        if (!dIdStr) return;

        const childLogs = logs.filter(l => l.originalLogId && String(l.originalLogId) === dIdStr);
        const childMaints = maint.filter(m => m.originalLogId && String(m.originalLogId) === dIdStr);
        const allChildren = [...childLogs, ...childMaints].sort((a, b) => {
            const da = a.date || a.scheduledDate || '';
            const db = b.date || b.scheduledDate || '';
            if (da !== db) return da.localeCompare(db);
            return String(a.id).localeCompare(String(b.id));
        });

        if (allChildren.length > 0) {
            const newParent = allChildren[0];
            const newParentId = String(newParent.id);
            delete newParent.originalLogId;

            allChildren.slice(1).forEach(child => {
                child.originalLogId = newParentId;
            });
            stateChanged = true;
        }
    });

    if (stateChanged) {
        data.logs = logs;
        data.maint = maint;
        localStorage.setItem(key, JSON.stringify(data));
        if (window.allEquipDetails) {
            window.allEquipDetails[key] = data;
        }
    }
};

// [추가] 100% DB 전환을 위한 유지관리/이력 전용 트랜잭션 동기화 함수
window.syncHistoryTransaction = async function (site, equip, payload) {
    window.activeSyncRequests++;
    const equip_id = window.getEquipmentDbId(site, equip);

    const delIds = [...(payload.maint_deletes || []), ...(payload.log_deletes || [])];
    if (delIds.length > 0 && typeof window.reassignChildExtraWorks === 'function') {
        window.reassignChildExtraWorks(site, equip, delIds);
    }
    try {
        const res = await fetch('/api/history/transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ equip_id, ...payload })
        });
        if (!res.ok) {
            const errorMsg = await res.text();
            console.error('DB Sync HTTP Error:', res.status, errorMsg);
            alert(`서버 응답 오류 (HTTP ${res.status}). 요청을 처리할 수 없습니다.`);
            return false;
        }
        const data = await res.json();
        if (data.status !== 'success') {
            console.error('DB Sync Error:', data.message);
            alert(`서버 요청 중 오류가 발생했습니다.\n사유: ${data.message || '알 수 없음'}`);
        }
        return data.status === 'success';
    } catch (e) {
        console.error('DB Sync Failed:', e);
        alert('서버와의 통신에 실패했습니다. 네트워크 상태를 확인해주세요.');
        return false;
    } finally {
        window.activeSyncRequests--;
    }
};

// [추가] 100% DB 전환을 위한 SETUP(셋업 상세내역/일지) 전용 동기화 함수
window.syncSetupDataDB = async function (site, equip, details = null, logs = null) {
    window.activeSyncRequests++;
    
    // [보강] 송신 전 한글 유니코드(NFC) 및 연속 공백 정규화 적용
    let cleanSite = typeof site === 'string' ? site.normalize('NFC').trim() : '';
    let cleanEquip = typeof equip === 'string' ? equip.normalize('NFC').trim() : '';
    cleanSite = cleanSite.replace(/\s+/g, ' ');
    cleanEquip = cleanEquip.replace(/\s+/g, ' ');
    
    const equip_id = `${cleanSite}::${cleanEquip}`;
    try {
        const res = await fetch('/api/setup/sync_equip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ equip_id, details, logs })
        });
        const data = await res.json();
        if (data.status !== 'success') {
            console.error('Setup DB Sync Error:', data.message);
            alert(`셋업 데이터 저장 중 오류가 발생했습니다.\n사유: ${data.message || '알 수 없음'}`);
        }
        return data.status === 'success';
    } catch (e) {
        console.error('Setup DB Sync Failed:', e);
        alert('서버와의 통신에 실패했습니다. 네트워크 상태를 확인해주세요.');
        return false;
    } finally {
        window.activeSyncRequests--;
    }
};

// [추가] 100% DB 전환을 위한 만능 DB 동기화 비동기 헬퍼 함수 (전역 사용)
window.syncAdminDB = async function (domain, action, payload) {
    window.activeSyncRequests++;
    try {
        const res = await fetch('/api/admin/crud', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ domain, action, payload })
        });
        const data = await res.json();
        if (data.status !== 'success') {
            console.error('DB Sync Error:', data.message);
            // [개선] 일반 관리자(admin) 계정은 권한 부족(403) 오류가 나더라도
            // 조회 목적으로 시스템에서 백그라운드로 자동 실행하는 마이그레이션/저장 시나리오가 많으므로,
            // 내용 확인(조회)에 지장이 없도록 경고(alert) 팝업을 노출하지 않고 콘솔 에러로만 기록합니다.
            const userRole = sessionStorage.getItem('userRole');
            if (userRole !== 'admin') {
                alert(`관리자 설정 동기화 중 오류가 발생했습니다.\n사유: ${data.message || '알 수 없음'}`);
            }
        }
        return data.status === 'success';
    } catch (e) {
        console.error('DB Sync Failed:', e);
        const userRole = sessionStorage.getItem('userRole');
        if (userRole !== 'admin') {
            alert('서버와의 통신에 실패했습니다. 네트워크 상태를 확인해주세요.');
        }
        return false;
    } finally {
        window.activeSyncRequests--;
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

// [추가] 운영 관리 공수 계산 시 관리자(어드민) 지분을 차감하기 위한 캐시 및 헬퍼 함수
window.adminNamesCache = new Set();
window.initAdminNamesCache = async function () {
    try {
        const workers = await window.fetchWorkerNames();
        const admins = new Set();
        workers.forEach(w => {
            if (typeof w === 'object' && w !== null) {
                const roleStr = (w.role || '').trim().toLowerCase();
                const posStr = (w.position || '').trim();
                const deptStr = (w.department || '').trim();
                if (roleStr === 'admin' || roleStr === 'superadmin' || posStr.includes('관리자') || deptStr.includes('관리자')) {
                    admins.add(w.name);
                }
            }
        });
        window.adminNamesCache = admins;
    } catch (e) {
        console.error("Admin Names Cache Error:", e);
    }
};

window.calcValidMd = function (workerStr, mdVal) {
    if (!workerStr || !mdVal) return mdVal;
    const workerList = workerStr.split(',').map(s => s.trim()).filter(Boolean);
    if (workerList.length === 0) return mdVal;

    const adminCount = workerList.filter(name => window.adminNamesCache.has(name)).length;
    if (adminCount === 0) return mdVal;

    const validRatio = (workerList.length - adminCount) / workerList.length;
    return mdVal * validRatio;
};

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

    // [최적화 - 방안 1] 캐시 데이터가 존재하는 경우 0ms(즉시) 로딩 해제 및 화면 렌더링
    if (localStorage.getItem('device_data')) {
        window.isDataLoaded = true;
        storageData = JSON.parse(localStorage.getItem('device_data')) || {};
        window.dispatchEvent(new Event('DataLoaded'));
        window.hideLoading(true);
    }

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
        .then(async data => {
            // [핵심 수정] 기존 데이터 전체를 무조건 날리지 않고(localStorage.clear), 
            // 사용자가 선택했던 마지막 UI 상태(last... 등) 관련 키들은 안전하게 백업 후 복원합니다.
            const keysToKeep = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                // 시스템(DB) 동기화 키가 아닌, 프론트엔드 UI 상태를 나타내는 키만 백업
                if (!key.startsWith('details_') && !key.startsWith('site_meta_') &&
                    !['device_data', 'setup_data', 'admin_items', 'equipment_models', 'check_type_categories', 'check_type_categories2', 'check_type_items'].includes(key)) {
                    keysToKeep.push({ key: key, value: localStorage.getItem(key) });
                }
            }
            localStorage.clear();
            keysToKeep.forEach(item => localStorage.setItem(item.key, item.value));

            // 서버 데이터를 localStorage에 반영
            Object.keys(data).forEach(key => {
                localStorage.setItem(key, JSON.stringify(data[key]));
            });
            // [수정] 전역 변수 갱신 (초기 로드 시 데이터 누락 방지)
            storageData = JSON.parse(localStorage.getItem('device_data')) || {};

            // [중요] 데이터 로드 완료 상태로 변경 (이제부터 saveAllToServer 작동 허용)
            window.isDataLoaded = true;

            // [추가] 데이터 갱신 후 UI 리프레시 (화면 깜빡임 없이 데이터만 최신화)
            refreshAppViews();
            window.dispatchEvent(new Event('DataLoaded'));
            window.hideLoading(true);
            if (callback) callback();

            // [최적화 - 방안 2] 무거운 보정 연산은 메인 UI 표출 후 비동기 지연 실행 (스레드 차단 방지)
            setTimeout(async () => {
                try {
                    await migrateDataFormat();
                    updateWarrantyStatusAutomatically();
                    if (typeof window.initAdminNamesCache === 'function') {
                        await window.initAdminNamesCache();
                    }
                } catch (e) {
                    console.error('Background post-load tasks error:', e);
                }
            }, 300);

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
        })
        .catch(err => {
            console.error('Failed to load data from server:', err);
            // 실패해도 이미 로컬 데이터로 초기화되었으므로 추가 조치 불필요
            window.isDataLoaded = true;
            window.dispatchEvent(new Event('DataLoaded'));
            window.hideLoading(true);
            if (callback) callback();
        });
}

// [추가] 데이터 갱신 후 화면 리프레시 시 팝업 지연 호출 체크
function checkPendingModals() {
    const openAddWork = sessionStorage.getItem('openAddWorkForLog');
    if (openAddWork && window.location.pathname.indexOf('maintenance') !== -1) {
        const data = JSON.parse(openAddWork);
        sessionStorage.removeItem('openAddWorkForLog');
        setTimeout(() => {
            if (typeof window.openRegisterScheduleModal === 'function') {
                const presetData = { type: '정기', detailType: '', detailType2: '', content: '', worker: '' };
                window.currentSearchFilters = { site: data.site, equip: data.equip };
                window.currentAddWorkLogId = data.logId;
                const todayStr = new Date().toISOString().substring(0, 10);
                window.openRegisterScheduleModal(todayStr, presetData);
            }
        }, 500);
    }
}

// [수정] 기존 PM 데이터 변환 및 JSON 저장 시 원하는 키 순서로 자동 재정렬하는 함수
async function migrateDataFormat() {
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

    // [개선] 유지관리 물품(maint) 및 작업 이력(logs) 마이그레이션 (세부구분 내용 보정 포함)
    const migrationVersion = 'v2.0'; // 마이그레이션 버전 업데이트 (세부구분 내용 '내용 없음' 자동 보정)
    const lastMigration = localStorage.getItem('keywordMigrationVersion');

    if (lastMigration !== migrationVersion) {
        console.log(`Running keyword migration to ${migrationVersion}...`);
        const migrationMap = {
            '용액 / 용자 이상': '용액 용자 이상',
            '파트 이상 (교체)': '파트 이상 교체', '파트 이상 (수리)': '파트 이상 수리',
            '파츠 이상 교체': '파트 이상 교체', '파츠 이상 수리': '파트 이상 수리',
            '파츠 이상 (교체)': '파트 이상 교체', '파츠 이상 (수리)': '파트 이상 수리',
            '물품 이상 (교체)': '파트 이상 교체', '물품 이상 (수리)': '파트 이상 수리',
            '물품 이상 교체': '파트 이상 교체', '물품 이상 수리': '파트 이상 수리'
        };

        const subCategoryKeywords = [
            'PM 점검', 'BM 점검', 'Alarm', 'Hunting', 'Data / Para 이상',
            '순회 점검', '프로그램 변경 / 평가', '설비 평가', '파티클 필터 교체',
            '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정',
            '용액제조', '온라인점검', '현장 이슈', 'PC 이상', '작업자 실수',
            '통신 이상', '용액 용자 이상', '파트 이상 교체', '파트 이상 수리',
            '프로그램 이상', '기타', '장비 점검', '추가 작업'
        ];

        const migrateString = (str) => {
            if (typeof str !== 'string') return str;
            let newStr = str;
            Object.entries(migrationMap).forEach(([oldKw, newKw]) => {
                newStr = newStr.split(oldKw).join(newKw);
            });
            return newStr;
        };

        // 안전한 순회를 위해 키 목록 먼저 추출
        const storageKeys = [];
        for (let i = 0; i < localStorage.length; i++) storageKeys.push(localStorage.key(i));

        for (const key of storageKeys) {
            try {
                if (key.startsWith('details_')) {
                    let data = JSON.parse(localStorage.getItem(key));
                    let isModified = false;
                    let payload = { maint_upserts: [], log_upserts: [] }; // DB 전송용 페이로드

                    ['logs', 'maint'].forEach(arrKey => {
                        if (data[arrKey] && Array.isArray(data[arrKey])) {
                            data[arrKey].forEach(item => {
                                if (item.content) {
                                    const original = item.content;
                                    item.content = migrateString(item.content);

                                    // [추가] 세부구분 명칭으로만 채워진 기존 내용을 '내용 없음'으로 보정
                                    if (item.content && item.content !== '[유상] Particle Filter') {
                                        let cleanContent = typeof window.removeCostLabels === 'function' ? window.removeCostLabels(item.content).trim() : item.content.replace(/^\[.*?\]\s*/, '').trim();
                                        const dtParts = (item.detailType || '').split(' > ').map(s => s.trim()).filter(Boolean);
                                        const isSubcategoryContent = dtParts.includes(cleanContent) || subCategoryKeywords.includes(cleanContent) || cleanContent === item.detailType;
                                        if (isSubcategoryContent) {
                                            item.content = '내용 없음';
                                        }
                                    }

                                    if (item.type === '비정기' && item.content !== '내용 없음') {
                                        const prefixPattern = /^(파트 이상 교체|파트 이상 수리|용액 용자 이상|현장 이슈|PC 이상|작업자 실수|통신 이상|프로그램 이상|단순조치|기타)\s*[-:]\s*/;
                                        const mPref = item.content.match(prefixPattern);
                                        if (mPref) {
                                            const sub3 = mPref[1];
                                            item.content = item.content.replace(prefixPattern, '').trim();
                                            const dtParts = (item.detailType || '').split(' > ').map(s => s.trim()).filter(Boolean);
                                            if (dtParts.length === 2) {
                                                dtParts.push(sub3);
                                                item.detailType = dtParts.join(' > ');
                                            }
                                            isModified = true;
                                        }
                                    }

                                    // [수정] 과거 누락된 비용처리 라벨([유상], [무상]) 일괄 복구 및 잘못 삽입된 라벨 제거
                                    const generalCost = item.costType || item.itemCost || '';

                                    if (arrKey === 'logs') {
                                        // 완료된 로그(logs)에는 비용처리 라벨을 유지/추가
                                        if (!item.content.startsWith('[변경]')) {
                                            const itemsArr = item.content.split(',').map(s => s.trim());
                                            const formattedArr = itemsArr.map(partStr => {
                                                let cleanV = partStr;
                                                
                                                // 중복 태그 오염 클렌징: [유상] 파트 이상 교체 - [무상(보증)] A 형태일 때 앞의 불필요한 태그 제거
                                                const doubleTagMatch = cleanV.match(/^\[(?:유상|무상[^\]]*|기타)\]\s*(.*?\s*-\s*\[(?:유상|무상[^\]]*|기타)\].*)$/);
                                                if (doubleTagMatch) {
                                                    cleanV = doubleTagMatch[1];
                                                }
                                                
                                                if (generalCost && !cleanV.match(/\[(유상|무상[^\]]*|기타)\]/)) {
                                                    const kwMatch = cleanV.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                                                    if (kwMatch) return `${kwMatch[1].trim()} - [${generalCost}] ${kwMatch[2].trim()}`;
                                                    return `[${generalCost}] ${cleanV}`;
                                                }
                                                return cleanV;
                                            });
                                            item.content = formattedArr.join(', ');
                                        }
                                    } else if (arrKey === 'maint') {
                                        // 예정된 유지관리(maint) 데이터에는 비용 라벨이 있으면 안됨 -> 제거
                                        if (item.content.match(/\[(유상|무상[^\]]*|기타)\]/)) {
                                            const itemsArr = item.content.split(',').map(s => s.trim());
                                            const formattedArr = itemsArr.map(partStr => {
                                                let cleanV = partStr;
                                                const m1 = cleanV.match(/^\[(유상|무상[^\]]*|기타)\]\s*(.*)$/);
                                                if (m1) cleanV = m1[2];
                                                const m2 = cleanV.match(/^(.*?)\s*-\s*\[(유상|무상[^\]]*|기타)\]\s*(.*)$/);
                                                if (m2) cleanV = `${m2[1]} - ${m2[3]}`;
                                                return cleanV;
                                            });
                                            item.content = formattedArr.join(', ');
                                        }
                                    }

                                    if (item.content !== original) {
                                        isModified = true;
                                        if (arrKey === 'maint') payload.maint_upserts.push(item);
                                        else if (arrKey === 'logs') payload.log_upserts.push(item);
                                    }
                                }
                            });
                        }
                    });
                    if (isModified) {
                        localStorage.setItem(key, JSON.stringify(data));
                        // DB로 변경된 이력 동기화
                        const parts = key.split('_');
                        if (parts.length >= 3) {
                            const site = parts[1];
                            const equip = parts.slice(2).join('_');
                            await window.syncHistoryTransaction(site, equip, payload);
                            await new Promise(resolve => setTimeout(resolve, 50)); // 서버 과부하 방지 딜레이
                        }
                    }
                } else if (key === 'check_type_items' || key === 'admin_items') {
                    let data = JSON.parse(localStorage.getItem(key));
                    let isModified = false;

                    const removeCostLabel = (str) => {
                        if (typeof str !== 'string') return str;
                        let cleanV = str;
                        const m1 = cleanV.match(/^\[(유상|무상[^\]]*|기타)\]\s*(.*)$/);
                        if (m1) cleanV = m1[2];
                        const m2 = cleanV.match(/^(.*?)\s*-\s*\[(유상|무상[^\]]*|기타)\]\s*(.*)$/);
                        if (m2) cleanV = `${m2[1]} - ${m2[3]}`;
                        return cleanV;
                    };

                    if (key === 'check_type_items') {
                        Object.values(data).forEach(val => {
                            if (Array.isArray(val)) {
                                val.forEach(item => {
                                    if (item.content) {
                                        const o = item.content;
                                        item.content = migrateString(o);
                                        item.content = removeCostLabel(item.content);
                                        if (o !== item.content) isModified = true;
                                    }
                                });
                            }
                        });
                    } else if (key === 'admin_items') {
                        data.forEach(val => {
                            if (val.part) {
                                const o = val.part;
                                val.part = migrateString(o);
                                val.part = removeCostLabel(val.part);
                                if (o !== val.part) isModified = true;
                            }
                            if (val.code) {
                                const oCode = val.code;
                                val.code = removeCostLabel(val.code);
                                if (oCode !== val.code) isModified = true;
                            }
                        });
                    }

                    if (isModified) {
                        localStorage.setItem(key, JSON.stringify(data));
                        const userRole = sessionStorage.getItem('userRole');
                        if (typeof window.syncAdminDB === 'function' && userRole === 'superadmin') {
                            await window.syncAdminDB('setting', 'UPDATE', { key: key, value: data });
                            await new Promise(resolve => setTimeout(resolve, 50)); // 서버 과부하 방지 딜레이
                        }
                    }
                }
            } catch (e) { console.error(`Migration error on key ${key}:`, e); }
        }
        localStorage.setItem('keywordMigrationVersion', migrationVersion);
        console.log(`Keyword migration to ${migrationVersion} completed.`);
        if (isModified) location.reload();
    }

    // 2. details_* 마이그레이션 (유지관리, 이력 변환 및 키 순서 정렬)
    const maintKeyOrder = ['id', 'type', 'detailType', 'code', 'content', 'spec', 'date', 'period', 'scheduledDate', 'costType', 'md', 'worker', 'memo'];
    const logKeyOrder = ['id', 'date', 'type', 'detailType', 'detailType2', 'content', 'costType', 'md', 'worker', 'memo'];
    const setupKeyOrder = [
        'custEquipName', 'projectNo', 'equipStatus', 'deliveryDate', 'warrantyStart', 'warrantyPeriod',
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
                                    const site = parts[1];
                                    const equipName = parts.slice(2).join('_');

                                    // [추가] 서버(DB)에도 자동 전환 상태를 동기화 반영
                                    // [추가] 서버(DB)에도 자동 전환 상태를 동기화 반영 및 최초 1회 로그 전송 (관리자 이상만 가능)
                                    const userRole = sessionStorage.getItem('userRole');
                                    if (typeof window.syncAdminDB === 'function' && (userRole === 'admin' || userRole === 'superadmin')) {
                                        window.syncAdminDB('equip', 'UPDATE', {
                                            old_id: equipName, new_id: equipName,
                                            site: site, old_site: site, new_site: site,
                                            setup: detailData.setup, special_note: detailData.specialNote || ''
                                        });
                                        if (typeof addSystemLog === 'function') {
                                            addSystemLog('UPDATE_EQUIP_STATUS', equipName, '워런티 기간 만료에 따른 가동 장비 자동 전환');
                                        }
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
        let itemData = JSON.parse(localStorage.getItem('check_type_items'));
        let catModified = false;
        let cat2Modified = false;
        let itemModified = false;

        if (catData) {
            Object.keys(catData).forEach(key => {
                if (key.endsWith('::비정기')) {
                    if (!catData[key].includes('기타')) {
                        catData[key].push('기타');
                        catModified = true;
                    }
                    // 'BM 점검' 일괄 삭제
                    const bmIdx = catData[key].indexOf('BM 점검');
                    if (bmIdx > -1) {
                        catData[key].splice(bmIdx, 1);
                        catModified = true;
                    }
                }
            });
            if (catModified) {
                localStorage.setItem('check_type_categories', JSON.stringify(catData));
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

        // 세부구분 2 'BM 점검' 관련 데이터 삭제
        Object.keys(catData2).forEach(key => {
            if (key.includes('::비정기::BM 점검')) {
                delete catData2[key];
                cat2Modified = true;
            }
        });

        if (cat2Modified) {
            localStorage.setItem('check_type_categories2', JSON.stringify(catData2));
        }

        // 점검 세부 항목 'BM 점검' 관련 데이터 삭제
        if (itemData) {
            Object.keys(itemData).forEach(key => {
                if (key.includes('::비정기::BM 점검')) {
                    delete itemData[key];
                    itemModified = true;
                }
            });
            if (itemModified) {
                localStorage.setItem('check_type_items', JSON.stringify(itemData));
            }
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

    // [추가] 헤더 우측 상단 메뉴 2줄 배치를 위한 강제 줄바꿈 요소 삽입
    const userControls = document.querySelector('.user-controls');
    const userInfo = document.getElementById('user-info');
    if (userControls && userInfo && !document.getElementById('header-flex-break')) {
        const breakEl = document.createElement('div');
        breakEl.id = 'header-flex-break';
        breakEl.style.cssText = 'flex-basis: 100%; height: 0; margin: 0; padding: 0;';
        userInfo.parentNode.insertBefore(breakEl, userInfo.nextSibling);
    }

    // [추가] 전역 자동완성 차단 및 라벨(Label) 웹 접근성 경고 82건 일괄 해결
    applyGlobalAccessibilityAndSecurityFixes();

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

    // [이동] HOME 화면에서도 시스템 로그 팝업 이벤트(필터, 닫기)가 동작하도록 페이지 접근 제어 이전에 먼저 실행합니다.
    setupDataManagementEvents();
    setupGlobalModalScrollLock();
    if (typeof window.setupTaskSearchModal === 'function') window.setupTaskSearchModal();
    if (typeof window.setupEventDetailModal === 'function') window.setupEventDetailModal();
    if (typeof window.setupRegisterScheduleModal === 'function') window.setupRegisterScheduleModal();

    // 2-3. 페이지별 접근 제어
    if (!handlePageAccess()) return;
    // 2-4. UI 초기화
    checkLoginStatus();
    renderSites();
    setupSidebarEvents();
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

    // [개선] 항상 마지막 상태 복원 시도 (Setup, Maint 페이지)
    if (window.location.pathname.indexOf('setup') !== -1 || window.location.pathname.indexOf('maintenance') !== -1) {
        restoreLastState();
    }

    // [추가] 정렬(검색) 페이지 갱신
    if (typeof window.refreshSortPage === 'function') {
        window.refreshSortPage();
    }

    // 대기 중인 팝업 모달이 있는지 확인
    checkPendingModals();
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

// [추가] 전역 웹 접근성(Label-Input 연결) 및 보안(자동완성 차단) 자동화 함수
function applyGlobalAccessibilityAndSecurityFixes() {
    const processNode = (node) => {
        // 1. Autocomplete 비활성화
        if (node.tagName === 'INPUT') {
            if (!node.hasAttribute('autocomplete')) node.setAttribute('autocomplete', 'new-password');

            // [추가] 시간 관련 입력창 24시간제(00~23) 강제 적용 (오전/오후 분리 방지)
            if (node.type === 'datetime-local' || node.type === 'time') {
                if (!node.hasAttribute('lang') || node.getAttribute('lang') !== 'en-GB') node.setAttribute('lang', 'en-GB'); // en-GB 로케일: 24시간제 지원
            }
        }
        if (node.querySelectorAll) {
            node.querySelectorAll('input').forEach(el => {
                if (!el.hasAttribute('autocomplete')) {
                    el.setAttribute('autocomplete', 'new-password');
                }
            });

            // [추가] 하위 노드의 시간 입력창 24시간제 일괄 적용
            node.querySelectorAll('input[type="datetime-local"], input[type="time"]').forEach(el => {
                if (!el.hasAttribute('lang') || el.getAttribute('lang') !== 'en-GB') el.setAttribute('lang', 'en-GB');
            });

            // 2. Label - Input 연결 (웹 접근성 / 콘솔 경고 해결)
            const labels = node.tagName === 'LABEL' ? [node] : Array.from(node.querySelectorAll('label'));
            labels.forEach(label => {
                const forAttr = label.getAttribute('for');

                // [수정] 존재하지 않는 ID를 가리키는 for 속성은 브라우저 경고를 유발하므로 즉시 제거
                if (forAttr && !document.getElementById(forAttr)) {
                    label.removeAttribute('for');
                } else if (forAttr && document.getElementById(forAttr)) {
                    return; // 이미 올바르게 연결됨
                }

                // 내부에 있는 경우
                const innerInput = label.querySelector('input:not([type="hidden"]), select, textarea');
                if (innerInput) {
                    if (!innerInput.id) innerInput.id = 'auto-input-' + Math.random().toString(36).substr(2, 9);
                    label.htmlFor = innerInput.id; // [수정] DOM 속성인 htmlFor를 사용하여 안전하게 할당
                    return;
                }

                // 인접한 형제 요소인 경우
                let nextEl = label.nextElementSibling;
                if (nextEl) {
                    const targetInput = nextEl.tagName.match(/INPUT|SELECT|TEXTAREA/)
                        ? nextEl
                        : nextEl.querySelector('input:not([type="hidden"]), select, textarea');

                    if (targetInput) {
                        if (!targetInput.id) targetInput.id = 'auto-input-' + Math.random().toString(36).substr(2, 9);
                        label.htmlFor = targetInput.id; // [수정] DOM 속성인 htmlFor를 사용하여 안전하게 할당
                        return;
                    }
                }
            });
        }
    };

    // 현재 문서 전체 적용
    processNode(document.body);

    // 실시간 DOM 변경 감지 (팝업 등 동적 생성 요소 지원)
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) processNode(node);
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
    const btnModalAddUser = document.getElementById('btn-modal-add-user');

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
    if (btnModalAddUser) btnModalAddUser.addEventListener('click', openAddUserModal);
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
            window.location.href = '/';
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
        window.location.href = '/';
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

                // [수정] 사업장 생성 시 기타(ETC) 장비 기본 할당 (신규 4필드 규격)
                storageData[val] = ['기타(ETC)::::'];

                // [추가] 기타(ETC) 장비 상세 데이터 초기화
                const initData = { maint: [], logs: [], memo: "", setup: { model: "" } };
                localStorage.setItem(`details_${val}_기타(ETC)::::`, JSON.stringify(initData));

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

                const matchedModel = equipmentModels.find(m => m.name === equipVal || m.abbr === equipVal);
                if (!matchedModel) {
                    return alert('등록되지 않은 장비 명입니다. 검색 제안 박스에서 항목을 선택해주세요.');
                }

                const actualModelName = matchedModel.name;

                const fullEquipName = equipModelVal ? `${actualModelName}::${equipModelVal}` : actualModelName;
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

                // [추가] 셋업(SETUP) 데이터 템플릿 적용 및 동기화
                const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
                const templates = JSON.parse(localStorage.getItem('setup_templates')) || {};
                let templateToUse = templates[equipVal] || templates['default'] || [
                    { category: "장비 반입 및 정위치", content: "장비 도면 부착", estDays: "1" },
                    { category: "통신 상태 및 유틸리티", content: "Utility 배관 공사 및 연결", estDays: "5" },
                    { category: "셋업 평가", content: "분석부 안정화 및 오염제어", estDays: "5" },
                    { category: "셋업 완료", content: "셋업 완료", estDays: "0" }
                ];
                const initialSetupDetails = templateToUse.map((item, idx) => ({
                    id: Date.now() + idx, category: item.category, content: item.content,
                    startDate: "", date: "", estDays: item.estDays || "1",
                    completed: false, execStartDate: "", delayReason: ""
                }));
                setupData[`${siteName}::${fullEquipName}`] = { setupDetails: initialSetupDetails, setupLogs: [] };
                localStorage.setItem('setup_data', JSON.stringify(setupData));
                window.syncSetupDataDB(siteName, fullEquipName, initialSetupDetails, []);

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
                    li.addEventListener('pointerdown', (ev) => {
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
    const logModal = document.getElementById('log-modal');

    if (btnViewLogs) {
        btnViewLogs.addEventListener('click', (e) => { e.preventDefault(); openLogModal(); });
    }
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', (e) => { e.preventDefault(); closeLogModal(); });
    }
    if (logModal) {
        logModal.addEventListener('click', (e) => { if (e.target === logModal) closeLogModal(); });
    }

    // [추가] 로그 필터 버튼 이벤트
    const filterBtns = document.querySelectorAll('.btn-filter');
    if (filterBtns.length > 0) {
        filterBtns.forEach(btn => {
            btn.onclick = () => {
                btn.classList.toggle('active');
                const filterVal = btn.dataset.filter;
                if (btn.classList.contains('active')) {
                    if (!currentLogFilters.includes(filterVal)) currentLogFilters.push(filterVal);
                } else {
                    currentLogFilters = currentLogFilters.filter(f => f !== filterVal);
                }
                renderSystemLogs();
            };
        });
    }

    // [추가] 날짜 및 검색창 입력 시 로그 필터링
    const sysLogStart = document.getElementById('syslog-filter-start');
    const sysLogEnd = document.getElementById('syslog-filter-end');
    const sysLogSearch = document.getElementById('syslog-filter-search');
    if (sysLogStart) sysLogStart.addEventListener('change', renderSystemLogs);
    if (sysLogEnd) sysLogEnd.addEventListener('change', renderSystemLogs);
    if (sysLogSearch) sysLogSearch.addEventListener('input', renderSystemLogs);

    // [추가] 시스템 로그 검색 필터 초기화 버튼
    const btnSysLogReset = document.getElementById('btn-syslog-reset');
    if (btnSysLogReset) {
        btnSysLogReset.addEventListener('click', () => {
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            if (sysLogStart) sysLogStart.value = todayStr;
            if (sysLogEnd) sysLogEnd.value = todayStr;
            if (sysLogSearch) sysLogSearch.value = '';
            currentLogFilters = ['common', 'setup', 'maint', 'admin'];
            const filters = document.querySelectorAll('#log-modal .btn-filter');
            filters.forEach(btn => btn.classList.add('active'));
            renderSystemLogs();
        });
    }
}

function setupResizers() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.dashboard-sidebar');
    if (resizer && sidebar) {
        // [수정] 사이드바 너비 고정을 위해 마우스 드래그 조절(리사이징) 기능 비활성화
        resizer.style.display = 'none';
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

    // [수정] URL 파라미터가 둘 다 없을 때만 로컬 스토리지 마지막 상태를 복원하도록 변경 (URL 강제 이동 꼬임 방지)
    if (!siteToSelect && !equipToSelect) {
        try {
            let lastStateKey = 'lastSelectedPath'; // 기본값
            if (window.location.pathname.indexOf('setup') !== -1) lastStateKey = 'lastSetupPath';
            else if (window.location.pathname.indexOf('maintenance') !== -1) lastStateKey = 'lastMaintPath';

            const lastState = localStorage.getItem(lastStateKey) || sessionStorage.getItem(lastStateKey);
            if (lastState) {
                const parsed = JSON.parse(lastState);
                siteToSelect = parsed.site;
                equipToSelect = parsed.equip;
            }
        } catch (e) { console.error(e); }
    }

    // [개선] DOM 렌더링 대기 후 안전하게 복원 (Interval 사용)
    if (siteToSelect) {
        let retries = 0;
        if (window.restoreSiteInterval) clearInterval(window.restoreSiteInterval); // [개선] 중복 복원 방지
        window.restoreSiteInterval = setInterval(() => {
            const siteItems = document.querySelectorAll('#site-list .item-text');
            if (siteItems.length > 0 || retries > 20) {
                clearInterval(window.restoreSiteInterval);
                const targetSiteLi = Array.from(siteItems).find(span => span.textContent.trim() === siteToSelect)?.parentElement;
                if (targetSiteLi) {
                    targetSiteLi.click();
                    if (equipToSelect) {
                        let equipRetries = 0;
                        if (window.restoreEquipInterval) clearInterval(window.restoreEquipInterval);
                        window.restoreEquipInterval = setInterval(() => {
                            const safeId = equipToSelect.replace(/"/g, '\\"');
                            const targetEquipLi = document.querySelector(`#equip-list li[data-id="${safeId}"]`);
                            if (targetEquipLi || equipRetries > 20) {
                                clearInterval(window.restoreEquipInterval);
                                if (targetEquipLi) targetEquipLi.click();
                            }
                            equipRetries++;
                        }, 50);
                    }
                }
            }
            retries++;
        }, 50);
    }
}

// [추가] 세션 타이머 관련 함수
function startSessionTimer() {
    stopSessionTimer(); // 기존 타이머 중지
    const expiryTime = Date.now() + 3600 * 1000;
    sessionStorage.setItem('sessionExpiryTime', expiryTime.toString());
    sessionTimeLeft = 3600; // 60분 리셋 (3600초)
    lastActivityTimestamp = Date.now(); // [추가] 타이머 시작 시 활동 시간도 초기화
    updateTimerUI();

    sessionTimer = setInterval(() => {
        const currentExpiry = parseInt(sessionStorage.getItem('sessionExpiryTime'), 10);
        if (!currentExpiry) return;

        sessionTimeLeft = Math.floor((currentExpiry - Date.now()) / 1000);

        if (sessionTimeLeft <= 0) {
            window.handleSessionExpired();
            return;
        }

        updateTimerUI();

        // [추가] 세션 만료 5분 전, 최근 5분 내 활동이 있었으면 자동 연장
        if (sessionTimeLeft === 300) { // 5분 남았을 때
            const now = Date.now();
            // 최근 5분(300,000ms) 이내에 활동이 있었는지 확인
            if (now - lastActivityTimestamp < 300000) {
                window.extendSession();
            }
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
    let displayTime = sessionTimeLeft > 0 ? sessionTimeLeft : 0;
    const minutes = Math.floor(displayTime / 60);
    const seconds = displayTime % 60;
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

        const btnHeaderViewLogs = document.getElementById('btn-header-view-logs');
        if (btnHeaderViewLogs) btnHeaderViewLogs.style.display = (role === 'admin' || role === 'superadmin') ? 'inline-block' : 'none';

        const btnHeaderAddUser = document.getElementById('btn-header-add-user');
        if (btnHeaderAddUser) btnHeaderAddUser.style.display = (role === 'admin' || role === 'superadmin') ? 'inline-block' : 'none';

        const btnModalAddUser = document.getElementById('btn-modal-add-user');
        if (btnModalAddUser) btnModalAddUser.style.display = (role === 'admin' || role === 'superadmin') ? 'inline-block' : 'none';

        const btnEquipTransfer = document.getElementById('btn-equip-transfer');
        if (btnEquipTransfer) btnEquipTransfer.style.display = (role === 'admin' || role === 'superadmin') ? 'inline-block' : 'none';

        // [추가] 최종 관리자 전용 '모든 계정 관리' 버튼 생성 및 노출 제어
        let btnAllUsers = document.getElementById('btn-modal-all-users');
        if (role === 'superadmin') {
            if (!btnAllUsers && btnModalAddUser && btnModalAddUser.parentNode) {
                btnAllUsers = document.createElement('button');
                btnAllUsers.id = 'btn-modal-all-users';
                btnAllUsers.className = 'btn-green';
                btnAllUsers.textContent = '모든 계정 관리';
                btnAllUsers.style.marginLeft = '10px';
                btnAllUsers.style.padding = '4px 10px';
                btnAllUsers.style.fontSize = '12px';
                btnAllUsers.onclick = window.openAllUsersModal;
                btnModalAddUser.parentNode.insertBefore(btnAllUsers, btnModalAddUser.nextSibling);
            }
            if (btnAllUsers) btnAllUsers.style.display = 'inline-block';
        } else {
            if (btnAllUsers) btnAllUsers.style.display = 'none';
        }

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

        const mobileBtnViewLogs = document.getElementById('mobile-btn-view-logs');
        if (mobileBtnViewLogs) mobileBtnViewLogs.style.display = (role === 'admin' || role === 'superadmin') ? 'block' : 'none';

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

        const btnHeaderViewLogs = document.getElementById('btn-header-view-logs');
        if (btnHeaderViewLogs) btnHeaderViewLogs.style.display = 'none';

        const btnHeaderAddUser = document.getElementById('btn-header-add-user');
        if (btnHeaderAddUser) btnHeaderAddUser.style.display = 'none';

        const btnModalAddUser = document.getElementById('btn-modal-add-user');
        if (btnModalAddUser) btnModalAddUser.style.display = 'none';

        const btnEquipTransfer = document.getElementById('btn-equip-transfer');
        if (btnEquipTransfer) btnEquipTransfer.style.display = 'none';

        const adminItems = document.querySelectorAll('.nav-admin-item');
        adminItems.forEach(el => el.style.display = 'none');

        // [추가] 모바일 업데이트
        if (mobileUserInfo) mobileUserInfo.style.display = 'none';
        if (mobileBtnLogin) {
            mobileBtnLogin.textContent = '로그인';
            mobileBtnLogin.classList.replace('btn-gray', 'btn-blue');
        }
        if (mobileBtnSettings) mobileBtnSettings.style.display = 'none';

        const mobileBtnViewLogs = document.getElementById('mobile-btn-view-logs');
        if (mobileBtnViewLogs) mobileBtnViewLogs.style.display = 'none';

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
        const troubleLink = mobileNav.querySelector('a[href*="trouble"]');
        const sortLink = mobileNav.querySelector('a[href*="sort"]');
        const operationLink = mobileNav.querySelector('a[href*="operation"]');
        if (setupLink) setupLink.style.display = isLoggedIn ? 'block' : 'none';
        if (maintLink) maintLink.style.display = isLoggedIn ? 'block' : 'none';
        if (troubleLink) troubleLink.style.display = isLoggedIn ? 'block' : 'none';
        if (sortLink) sortLink.style.display = isLoggedIn ? 'block' : 'none';
        if (operationLink) operationLink.style.display = isLoggedIn ? 'block' : 'none';
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
    window.showLoading('로그인 처리 중입니다...');
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
                    window.hideLoading(true);
                    showForcePwChangeModal();
                } else {
                    window.showLoading('데이터를 불러오는 중입니다...');
                    const homeLoginContainer = document.getElementById('home-login-container');
                    if (homeLoginContainer) {
                        document.getElementById('home-login-container').style.display = 'none';
                        document.getElementById('home-welcome-container').style.display = 'flex';
                        fetchServerData(() => {
                            checkLoginStatus();
                            window.hideLoading(true);
                        });
                    } else {
                        location.reload();
                    }
                }
            } else {
                window.hideLoading(true);
                alert(data.message || '로그인 실패');
            }
        })
        .catch(err => {
            window.hideLoading(true);
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
        // [수정] 일반 관리자는 '일반' 계정만, 최종관리자는 '모든' 계정을 생성할 수 있도록 옵션 제어
        const roleSelect = modal.querySelector('#new-user-role');
        if (roleSelect) {
            roleSelect.innerHTML = '<option value="user">일반</option>'; // 기본값 초기화
            if (role === 'superadmin') {
                roleSelect.insertAdjacentHTML('beforeend', '<option value="admin">관리자</option>');
                roleSelect.insertAdjacentHTML('beforeend', '<option value="superadmin">최종관리자</option>');
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

        // [추가] 소속 제안 박스 설정
        const deptInput = modal.querySelector('#new-user-department');
        if (deptInput) setupDepartmentSuggestion(deptInput);

        // [추가] 직급 제안 박스 설정
        const posInput = modal.querySelector('#new-user-position');
        if (posInput) setupPositionSuggestion(posInput);

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

                const siteGroups = new Set();
                Object.keys(dataMap).forEach(site => {
                    if (site !== 'models' && site !== 'details') {
                        siteGroups.add(typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타사업장');
                    }
                });
                const sites = Array.from(siteGroups).sort();
                if (!sites.includes('기타사업장')) {
                    sites.push('기타사업장');
                }

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
                    const siteGroups = new Set();
                    Object.keys(dataMap).forEach(site => {
                        if (site !== 'models' && site !== 'details') {
                            siteGroups.add(typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타사업장');
                        }
                    });
                    const sites = Array.from(siteGroups);

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

        const siteGroups = new Set();
        Object.keys(dataMap).forEach(site => {
            if (site !== 'models' && site !== 'details') {
                siteGroups.add(typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타사업장');
            }
        });
        const sites = Array.from(siteGroups).sort();
        if (!sites.includes('기타사업장')) {
            sites.push('기타사업장');
        }

        sites.forEach(s => {
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

    // [추가] 소속 제안 박스 설정 (DOM에 추가된 후 실행)
    const appendedDeptInput = document.getElementById('edit-my-dept');
    if (appendedDeptInput) setupDepartmentSuggestion(appendedDeptInput);

    // [추가] 직급 제안 박스 설정 (DOM에 추가된 후 실행)
    const appendedPosInput = document.getElementById('edit-my-pos');
    if (appendedPosInput) setupPositionSuggestion(appendedPosInput);
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
            // [추가] 장비를 선택하지 않고 사업장만 클릭했을 때도 마지막 경로로 저장되도록 로직 추가
            let lastStateKey = 'lastSelectedPath';
            if (window.location.pathname.indexOf('setup') !== -1) lastStateKey = 'lastSetupPath';
            else if (window.location.pathname.indexOf('maintenance') !== -1) lastStateKey = 'lastMaintPath';
            localStorage.setItem(lastStateKey, JSON.stringify({ site: selectedSite, equip: '' }));

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
            const modelObj = equipmentModels.find(m => m.name === equipName || m.abbr === equipName);
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
                            sugLi.addEventListener('pointerdown', (ev) => {
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

        const success = await window.syncAdminDB('equip', 'UPDATE', { old_id: oldName, new_id: newName, site: siteName, setup: { model: newModel } });
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

    // [추가] 3. setup_data 마이그레이션: 실행일(execStartDate)이 없는 항목의 예정일(startDate) 초기화
    try {
        const setupData = JSON.parse(localStorage.getItem('setup_data'));
        if (setupData) {
            let setupModified = false;
            Object.keys(setupData).forEach(key => {
                const sData = setupData[key];
                let itemModified = false;
                if (sData && sData.setupDetails) {
                    sData.setupDetails.forEach(detail => {
                        if (!detail.execStartDate) {
                            if (detail.startDate) {
                                detail.startDate = "";
                                itemModified = true;
                                setupModified = true;
                            }
                            if (!detail.completed && detail.date) {
                                detail.date = "";
                                itemModified = true;
                                setupModified = true;
                            }
                        }
                    });
                    
                    if (itemModified) {
                        const parts = key.split('::');
                        if (parts.length >= 2) {
                            const site = parts[0];
                            const equip = parts.slice(1).join('::');
                            if (typeof window.syncSetupDataDB === 'function') {
                                window.syncSetupDataDB(site, equip, sData.setupDetails, sData.setupLogs);
                            }
                        }
                    }
                }
            });
            if (setupModified) {
                localStorage.setItem('setup_data', JSON.stringify(setupData));
                isModified = true;
            }
        }
    } catch (e) { console.error('Setup data migration error:', e); }
}

/* ==========================================================================
   6. 상세 화면 오케스트레이션 (Detail View Orchestration)
   ========================================================================== */
function onEquipClick(site, equip) {
    currentPath = { site, equip };

    // [수정] 페이지별로 마지막 선택 상태 분리 저장
    if (window.location.pathname.indexOf('setup') !== -1) {
        localStorage.setItem('lastSetupPath', JSON.stringify(currentPath));
    } else if (window.location.pathname.indexOf('maintenance') !== -1) {
        localStorage.setItem('lastMaintPath', JSON.stringify(currentPath));
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
                    const lastLogId = localStorage.getItem(`lastLog_${site}_${equip}`);
                    const matchedLog = lastLogId ? data.logs.find(l => l.id == lastLogId) : null;
                    if (matchedLog) {
                        let retries = 0;
                        const scrollInterval = setInterval(() => {
                            const row = document.getElementById(`log-row-${matchedLog.id}`);
                            if (row || retries > 20) {
                                clearInterval(scrollInterval);
                                selectLog(matchedLog.id, false);
                                if (row) {
                                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                            }
                            retries++;
                        }, 50);
                    } else {
                        data.logs.sort((a, b) => { if (b.date !== a.date) return b.date.localeCompare(a.date); return b.id - a.id; });
                        selectLog(data.logs[0].id, false);
                    }
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
    // 화면에 마스터 정보 입력란이 실제로 존재할 때만 변경사항 체크 (HOME 등 타 화면에서 오작동 방지)
    const isSetupPage = document.getElementById('DeviceID-cust-equip-name') !== null;
    if (isSetupPage && hasUnsavedSetupChanges()) {
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
    if (modal) {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const startInput = document.getElementById('syslog-filter-start');
        const endInput = document.getElementById('syslog-filter-end');
        if (startInput) startInput.value = todayStr;
        if (endInput) endInput.value = todayStr;
        modal.style.display = 'flex';
        renderSystemLogs();
    }
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

        // [추가] 장비 맵 생성 (대상 정보 포맷팅 및 검색 용도)
        const dataMap = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('device_data')) || {};
        const equipInfoMap = {};
        const equipKeys = new Set();
        const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

        Object.keys(dataMap).forEach(site => {
            if (dataMap[site]) {
                dataMap[site].forEach(equip => {
                    equipKeys.add(equip);
                    const key = `details_${site}_${equip}`;
                    const detailData = JSON.parse(localStorage.getItem(key)) || {};
                    const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
                    if (custName) {
                        equipInfoMap[equip] = custName;
                    }
                });
            }
        });

        // [수정] 필터 입력값 가져오기
        const startDate = document.getElementById('syslog-filter-start') ? document.getElementById('syslog-filter-start').value : '';
        const endDate = document.getElementById('syslog-filter-end') ? document.getElementById('syslog-filter-end').value : '';
        const keyword = document.getElementById('syslog-filter-search') ? document.getElementById('syslog-filter-search').value.toLowerCase().trim() : '';

        // [수정] 복합 다중 필터링 로직 (분류 + 날짜 + 텍스트)
        const filteredLogs = logs.filter(log => {
            const category = getLogCategory(log.action);

            if (!currentLogFilters.includes(category)) return false;

            if (startDate || endDate) {
                // [수정] UTC 기준의 timestamp 문자열을 로컬 시간으로 변환 후 날짜 비교
                const logDateObj = new Date(log.timestamp);
                const localYear = logDateObj.getFullYear();
                const localMonth = String(logDateObj.getMonth() + 1).padStart(2, '0');
                const localDay = String(logDateObj.getDate()).padStart(2, '0');
                const logDate = `${localYear}-${localMonth}-${localDay}`;

                if (startDate && logDate < startDate) return false;
                if (endDate && logDate > endDate) return false;
            }

            if (keyword) {
                const custName = equipInfoMap[log.target] || '';
                const searchStr = `${log.action} ${log.target} ${custName} ${log.worker || ''} ${log.details}`.toLowerCase();
                if (!searchStr.includes(keyword)) return false;
            }

            return true;
        });

        if (filteredLogs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #8b949e;">로그 내역이 없습니다.</td></tr>';
            return;
        }

        tbody.innerHTML = filteredLogs.map(log => {
            let displayTarget = escapeHtml(log.target);

            let isEquip = equipKeys.has(log.target);
            if (!isEquip && log.target) {
                const modelPart = log.target.split('::')[0];
                if (equipmentModels.some(m => m.name === modelPart)) {
                    isEquip = true;
                }
            }

            if (isEquip) {
                const parts = log.target.split('::');
                const model = parts[0];
                const serial = parts.length > 1 ? parts[1] : '';

                const matchedModel = equipmentModels.find(m => m.name === model || m.abbr === model);
                const displayModel = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : model;

                const custName = equipInfoMap[log.target] || '';

                let subInfo = '';
                if (custName) subInfo = `[${escapeHtml(custName)}]`;
                else if (serial) subInfo = `[${escapeHtml(serial)}]`;

                if (subInfo) displayTarget = `<div>${escapeHtml(displayModel)}</div><div style="font-size: 11px; color: #3fb950; margin-top: 2px; font-weight: bold;">${subInfo}</div>`;
                else displayTarget = escapeHtml(displayModel);
            }

            // [수정] 날짜와 시간을 분리하고 시간은 24시간제로 표시
            const logDateObj = new Date(log.timestamp);
            const dateStr = logDateObj.toLocaleDateString('ko-KR');
            const timeStr = logDateObj.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
            const displayTimestamp = `<div>${dateStr}</div><div style="font-size: 11px; color: #8b949e; margin-top: 2px;">${timeStr}</div>`;

            return `<tr>
                <td>${displayTimestamp}</td>
                <td style="text-align: center;">${escapeHtml(log.worker)}</td>
                <td><span class="badge pm" style="background: #30363d;">${log.action}</span></td>
                <td>${displayTarget}</td>
                <td style="text-align: left; white-space: pre-line;">${log.details}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #f85149;">로그를 불러오는데 실패했습니다.</td></tr>';
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
/* ==========================================================================
   8. 다음 작업 예정일 등록 모달 (Next Schedule Modal)
   ========================================================================== */

/**
 * [공통] 작업 완료 후 다음 예정일 등록 모달을 엽니다.
 * @param {object} options - 모달 옵션
 */
function openNextScheduleModal(options) {
    // [비활성화] 사용 안 함 처리
    if (options && typeof options.onClose === 'function') options.onClose();
    return;

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
    if (mdInput) {
        mdInput.value = md || '';
        // [추가] 작업 완료 후 다음 예정일 등록 팝업 시 공수 입력 제한
        mdInput.oninput = function () {
            const workerHidden = document.getElementById('next-schedule-worker-hidden');
            const workerCount = workerHidden && workerHidden.value ? workerHidden.value.split(',').map(s => s.trim()).filter(Boolean).length : 0;
            const currentMd = parseFloat(this.value);
            if (!isNaN(currentMd) && currentMd > workerCount) {
                alert(`공수(M/D)는 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
                this.value = workerCount;
            }
        };
    }

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

            const workerCount = newWorker.split(',').map(s => s.trim()).filter(Boolean).length;
            if (parseFloat(newMd) > workerCount) {
                alert(`입력된 공수(${newMd})가 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
                if (mdInput) mdInput.value = workerCount;
                return;
            }

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
                selectedItems.push({ content: '', cost: '유상' });
            }

            const key = `details_${site}_${equip}`;
            let data = JSON.parse(localStorage.getItem(key)) || {};
            let isUpdated = false;

            let payload = { maint_upserts: [] };

            if (!data.maint) data.maint = [];

            const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

            selectedItems.forEach((sItem, idx) => {
                let code = '';
                const extracted = window.extractSpecFromContent(sItem.content);
                let pureContent = extracted.pureContent;
                let spec = extracted.spec;
                let fullContent = pureContent;
                let period = null;

                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) {
                    code = match.code || '';
                    fullContent = match.code || match.part || pureContent;
                    period = match.cycle || null;
                }

                // [추가] 다음 예정 항목 등록 시, 기존 완료된 items에서 매칭되는 대표 구분명(예: 파트 이상 교체)을 찾아 접두사로 복원
                let prefix = '';
                const originalItem = items.find(i => {
                    if (!i.content) return false;
                    return i.content.includes(pureContent) || (i.code && code && i.code === code);
                });
                if (originalItem && originalItem.content) {
                    const kwMatch = originalItem.content.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                    if (kwMatch) {
                        prefix = kwMatch[1].trim();
                    }
                }

                if (!prefix) {
                    const kwMatch = sItem.content.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                    if (kwMatch) {
                        prefix = kwMatch[1].trim();
                    }
                }

                if (prefix) {
                    fullContent = `${prefix} - ${fullContent}`;
                }

                let existingItem = data.maint.find(m => (m.content === fullContent || m.content === pureContent || (m.code && code && m.code === code)) && (m.spec || '') === (spec || '') && mergedRegItemIds.has(m.id));
                if (!existingItem) existingItem = data.maint.find(m => (m.content === fullContent || m.content === pureContent || (m.code && code && m.code === code)) && (m.spec || '') === (spec || ''));

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
                    addSystemLog('ADD_SCHEDULE', equip, `예정일: ${newDate}, 구분: 정기\n세부구분: PM 점검 (다음 예정일)`);
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
    if (typeof window.checkSessionValid === 'function' && !window.checkSessionValid()) return;
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
    const maints = data.maint || [];

    let parentLog = logs.find(l => l.id == originalLogId) || maints.find(m => m.id == originalLogId);
    if (!parentLog && typeof allTroubles !== 'undefined') {
        parentLog = allTroubles.find(t => String(t.id) === String(originalLogId));
    }

    if (!parentLog) return alert('원본 작업을 찾을 수 없습니다.');

    // [핵심 고도화] 트러블 ID와 최초 작업 로그 ID의 교차 매칭 지원 (양방향 데이터 정합성 일치)
    let idSet = new Set([String(originalLogId)]);
    if (parentLog.id) idSet.add(String(parentLog.id));
    if (parentLog.original_log_id) idSet.add(String(parentLog.original_log_id));

    // 혹시 parentLog가 진짜 로그이고, 이와 관련된 TroubleLog가 있을 경우 그 TroubleLog의 ID도 수집
    if (parentLog.id && typeof allTroubles !== 'undefined') {
        const relatedTrouble = allTroubles.find(t => String(t.original_log_id) === String(parentLog.id));
        if (relatedTrouble) idSet.add(String(relatedTrouble.id));
    }

    let childLogs = logs.filter(l => l.originalLogId && idSet.has(String(l.originalLogId)));
    let childMaints = maints.filter(m => m.originalLogId && idSet.has(String(m.originalLogId)));

    // 부모 로그 중복 차단 필터
    childLogs = childLogs.filter(l => !idSet.has(String(l.id)));
    childMaints = childMaints.filter(m => !idSet.has(String(m.id)));

    // 추가작업 조치일/예정일 날짜 오름차순 정렬 (최근에 조치한게 제일 아래에 위치하도록)
    childLogs.sort((a, b) => {
        const da = a.date || '';
        const db = b.date || '';
        return da.localeCompare(db);
    });

    childMaints.sort((a, b) => {
        const da = a.scheduledDate || '';
        const db = b.scheduledDate || '';
        return da.localeCompare(db);
    });


    // [추가] 추가 작업 메모 실시간 수정 및 미저장 변경사항 감지 상태 변수
    let hasUnsavedChanges = false;
    let initialMemo = '';
    let currentActiveLog = parentLog;
    let pendingMoveFn = null;

    const saveBtn = document.getElementById('btn-save-extra-work-memo');
    const confirmModal = document.getElementById('memo-save-confirm-modal');
    const saveMoveBtn = document.getElementById('btn-memo-save-and-move');
    const discardMoveBtn = document.getElementById('btn-memo-discard-and-move');
    const cancelMoveBtn = document.getElementById('btn-memo-save-cancel');

    const resetSaveButton = () => {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.style.backgroundColor = '#30363d';
            saveBtn.style.border = '1px solid #8b949e';
            saveBtn.style.color = '#8b949e';
            saveBtn.style.cursor = 'not-allowed';
        }
    };

    const activateSaveButton = () => {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.style.backgroundColor = '#f0b400';
            saveBtn.style.border = '1px solid #d29922';
            saveBtn.style.color = '#000';
            saveBtn.style.fontWeight = 'bold';
            saveBtn.style.cursor = 'pointer';
        }
    };

    const setMemoState = (log) => {
        currentActiveLog = log;
        const memoVal = log.memo || '';
        initialMemo = memoVal;
        if (memoEl) {
            memoEl.value = memoVal;
            if (!memoVal) {
                memoEl.placeholder = '작성된 메모가 없습니다.';
            } else {
                memoEl.placeholder = '';
            }
        }
        hasUnsavedChanges = false;
        resetSaveButton();
    };

    const checkUnsavedChangesAndProceed = (proceedFn) => {
        if (hasUnsavedChanges) {
            pendingMoveFn = proceedFn;
            if (confirmModal) confirmModal.style.display = 'flex';
        } else {
            proceedFn();
        }
    };

    // 메모 필드 변경 감지 이벤트
    if (memoEl) {
        memoEl.oninput = () => {
            const currentMemo = memoEl.value;
            if (currentMemo !== initialMemo) {
                hasUnsavedChanges = true;
                activateSaveButton();
            } else {
                hasUnsavedChanges = false;
                resetSaveButton();
            }
        };
    }

    // 모달창 상단 ✕ 닫기 버튼 오버라이드
    const closeBtn = modal.querySelector('.modal-header .btn-del-sm');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.preventDefault();
            checkUnsavedChangesAndProceed(() => {
                modal.style.display = 'none';
            });
        };
    }

    // 메모 저장 트랜잭션 함수
    const saveMemoChanges = async () => {
        if (!currentActiveLog) return false;
        const newMemoVal = memoEl.value;
        const key = `details_${site}_${equip}`;
        const localData = JSON.parse(localStorage.getItem(key)) || {};
        
        let matchedItem = null;
        let payload = { log_upserts: [], maint_upserts: [] };
        
        const isActiveMaint = (currentActiveLog.source === 'maint') || (localData.maint && localData.maint.some(m => String(m.id) === String(currentActiveLog.id)));
        
        if (isActiveMaint) {
            matchedItem = localData.maint.find(m => String(m.id) === String(currentActiveLog.id));
            if (matchedItem) {
                matchedItem.memo = newMemoVal;
                payload.maint_upserts.push(matchedItem);
            }
        } else {
            if (!localData.logs) localData.logs = [];
            matchedItem = localData.logs.find(l => String(l.id) === String(currentActiveLog.id));
            
            if (!matchedItem && String(currentActiveLog.id) === String(parentLog.id)) {
                matchedItem = { ...parentLog };
                matchedItem.memo = newMemoVal;
                localData.logs.push(matchedItem);
                payload.log_upserts.push(matchedItem);
            } else if (matchedItem) {
                matchedItem.memo = newMemoVal;
                payload.log_upserts.push(matchedItem);
            }
        }
        
        if (!matchedItem) {
            alert('저장할 항목을 찾을 수 없습니다.');
            return false;
        }
        
        const success = await window.syncHistoryTransaction(site, equip, payload);
        if (!success) {
            alert('서버 통신 오류로 메모 저장에 실패했습니다.');
            return false;
        }
        
        localStorage.setItem(key, JSON.stringify(localData));
        
        currentActiveLog.memo = newMemoVal;
        if (String(currentActiveLog.id) === String(parentLog.id)) {
            parentLog.memo = newMemoVal;
        } else {
            const logMatch = childLogs.find(l => String(l.id) === String(currentActiveLog.id));
            if (logMatch) logMatch.memo = newMemoVal;
            const maintMatch = childMaints.find(m => String(m.id) === String(currentActiveLog.id));
            if (maintMatch) maintMatch.memo = newMemoVal;
        }
        
        initialMemo = newMemoVal;
        hasUnsavedChanges = false;
        resetSaveButton();
        
        alert('메모가 저장되었습니다.');
        
        if (typeof window.refreshCalendarPopupAfterCompletion === 'function') {
            window.refreshCalendarPopupAfterCompletion();
        } else if (typeof window.renderCalendar === 'function') {
            window.renderCalendar();
        }
        
        return true;
    };

    if (saveBtn) saveBtn.onclick = saveMemoChanges;

    // 3버튼 컨펌 모달 제어 이벤트 바인딩
    if (saveMoveBtn) {
        saveMoveBtn.onclick = async () => {
            const saved = await saveMemoChanges();
            if (saved) {
                if (confirmModal) confirmModal.style.display = 'none';
                if (pendingMoveFn) {
                    const fn = pendingMoveFn;
                    pendingMoveFn = null;
                    fn();
                }
            }
        };
    }

    if (discardMoveBtn) {
        discardMoveBtn.onclick = () => {
            hasUnsavedChanges = false;
            resetSaveButton();
            if (confirmModal) confirmModal.style.display = 'none';
            if (pendingMoveFn) {
                const fn = pendingMoveFn;
                pendingMoveFn = null;
                fn();
            }
        };
    }

    if (cancelMoveBtn) {
        cancelMoveBtn.onclick = () => {
            pendingMoveFn = null;
            if (confirmModal) confirmModal.style.display = 'none';
        };
    }

    const confirmModalCloseBtn = confirmModal ? confirmModal.querySelector('.modal-header .btn-del-sm') : null;
    if (confirmModalCloseBtn) {
        confirmModalCloseBtn.onclick = () => {
            pendingMoveFn = null;
            confirmModal.style.display = 'none';
        };
    }

    // 1. 점검 구분 경로 설정
    let pathText = (parentLog.type && parentLog.type !== '-') ? parentLog.type : '비정기';
    let detailStr = (parentLog.detailType && parentLog.detailType !== '-') ? parentLog.detailType : '';
    if (parentLog.type === '비정기' && detailStr.includes(' > ')) {
        const parts = detailStr.split(' > ').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
            detailStr = `${parts[0]} > ${parts[1]}`;
        }
    }
    if (parentLog.detailType2 && parentLog.detailType2 !== '-' && !detailStr.includes(parentLog.detailType2)) {
        detailStr += ` > ${parentLog.detailType2}`;
    }
    const parentDt3 = parentLog.detailType3 || parentLog.detail_type3 || '';
    if (parentDt3 && parentDt3 !== '-' && !detailStr.includes(parentDt3)) {
        detailStr += ` > ${parentDt3}`;
    }
    if (detailStr) {
        pathText += ` > ${detailStr}`;
    }
    if (pathEl) pathEl.textContent = pathText;

    // 2. 메모 및 상태 기본 초기화
    setMemoState(parentLog);
    if (workerEl) workerEl.textContent = parentLog.worker || '-';
    if (mdEl) mdEl.textContent = parentLog.md || '0';

    // 3. 해당 장비 점검 이력으로 이동하는 버튼 이벤트
    if (moveBtn) {
        moveBtn.onclick = () => {
            checkUnsavedChangesAndProceed(() => {
                let targetUrl = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}&logId=${originalLogId}`;
                location.href = targetUrl;
            });
        };
    }

    let addBtn = document.getElementById('btn-add-extra-work-from-history');

    if (addBtn) {
        addBtn.onclick = () => {
            modal.style.display = 'none';
            if (typeof window.openRegisterScheduleModal === 'function') {
                const presetData = { 
                    type: (parentLog.type && parentLog.type !== '-') ? parentLog.type : '비정기', 
                    detailType: (parentLog.detailType && parentLog.detailType !== '-') ? parentLog.detailType : '', 
                    detailType2: (parentLog.detailType2 && parentLog.detailType2 !== '-') ? parentLog.detailType2 : '', 
                    detailType3: (parentLog.detailType3 && parentLog.detailType3 !== '-') ? parentLog.detailType3 : '', 
                    content: '', 
                    worker: parentLog.worker || '' 
                };
                window.currentSearchFilters = { site: site, equip: equip };
                window.currentAddWorkLogId = originalLogId;
                const parentDateStr = parentLog.date || parentLog.scheduledDate || new Date().toISOString().substring(0, 10);
                window.openRegisterScheduleModal(parentDateStr, presetData);
            } else {
                sessionStorage.setItem('openAddWorkForLog', JSON.stringify({ site, equip, logId: originalLogId }));
                location.href = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}`;
            }
        };
    }

    // [수정] 헤더에 있는 통합 이슈 공유 체크박스 사용
    let issueShareCb = document.getElementById('extra-work-issue-share');

    tbody.innerHTML = '';

    const createRow = (log, badgeText, badgeColor, isParent) => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        if (isParent) tr.style.backgroundColor = 'rgba(35, 134, 54, 0.1)';

        let displayDate = log.date || log.occur_date || '-';
        if (displayDate.includes('T')) {
            displayDate = displayDate.split('T')[0];
        }

        let displayContent = '-';
        if (log.source === 'trouble') {
            displayContent = '비정기 점검 (Trouble)';
        } else if (log.check_item && log.check_item !== '-') {
            displayContent = log.check_item;
        } else if (log.content && !log.content.startsWith('{')) {
            displayContent = log.content;
        }



        let label = '';
        let items = [];
        
        // 전체 내용에서 대표 비용처리 라벨 추출
        let globalCostLabel = '';
        const globalCostMatch = displayContent.match(/^(\[.*?\])\s*/);
        if (globalCostMatch) {
            globalCostLabel = globalCostMatch[1].trim() + ' ';
        }

        const contentParts = displayContent.split(',').map(s => s.trim()).filter(Boolean);
        
        const partKeywords = [
            '파트 이상 (교체)', '파트 이상 교체',
            '파트 이상 (수리)', '파트 이상 수리',
            '용액 / 용자 이상', '용액 용자 이상',
            '물품 이상 (교체)', '물품 이상 교체',
            '물품 이상 (수리)', '물품 이상 수리'
        ];

        const adminItemsForExtract = JSON.parse(localStorage.getItem('admin_items')) || [];
        const convertToCode = (partName) => {
            let clean = window.removeCostLabels(partName).trim();
            const specMatch = clean.match(/\s*\[(.*?)\]$/);
            if (specMatch) {
                clean = clean.replace(specMatch[0], '').trim();
            }
            const match = adminItemsForExtract.find(a => (a.part || '').trim() === clean || (a.code || '').trim() === clean);
            return match && match.code ? match.code : clean;
        };

        contentParts.forEach(part => {
            // 비용처리 라벨 추출 (예: "[유상]")
            let costLabel = '';
            const costMatch = part.match(/^(\[.*?\])\s*/);
            if (costMatch) {
                costLabel = costMatch[1].trim() + ' ';
            } else {
                costLabel = globalCostLabel;
            }

            let cleanPart = part.replace(/^\[.*?\]\s*/, '').trim();
            const hyphenIdx = cleanPart.indexOf(' - ');
            
            if (hyphenIdx !== -1) {
                const prefix = cleanPart.substring(0, hyphenIdx).trim();
                const suffix = cleanPart.substring(hyphenIdx + 3).trim();
                const isPartKeyword = partKeywords.some(kw => prefix.includes(kw) || kw.includes(prefix));
                if (isPartKeyword) {
                    if (!label) label = prefix;
                    items.push(costLabel + convertToCode(suffix));
                } else {
                    items.push(costLabel + convertToCode(cleanPart));
                }
            } else {
                const isPartKeyword = partKeywords.some(kw => cleanPart.includes(kw) || kw.includes(cleanPart));
                if (isPartKeyword) {
                    if (!label) label = cleanPart;
                } else {
                    items.push(costLabel + convertToCode(cleanPart));
                }
            }
        });

        let tableContent = '';
        if (items && items.length > 0) {
            tableContent = items.map(item => escapeHtml(item)).join('<br>');
        } else {
            tableContent = displayContent || '비정기 점검';
        }

        let sub3Text = log.detailType3 || log.detail_type3 || '';
        if (!sub3Text && log.detailType && log.detailType.includes(' > ')) {
            const dtParts = log.detailType.split(' > ').map(s => s.trim()).filter(Boolean);
            if (dtParts.length >= 3) sub3Text = dtParts[2];
        }
        if (!sub3Text && log.detailType2 && log.detailType2.includes(' > ')) {
            const dt2Parts = log.detailType2.split(' > ').map(s => s.trim()).filter(Boolean);
            if (dt2Parts.length >= 2) sub3Text = dt2Parts[1];
        }
        if (!sub3Text) {
            sub3Text = label || '-';
        }

        tr.innerHTML = `
            <td><span class="badge" style="background:${badgeColor}; display: inline-block; width: 45px; text-align: center; padding: 3px 0; font-size: 11px; border-radius: 4px; color: #fff; font-weight: bold;">${badgeText}</span></td>
            <td>${displayDate}</td>
            <td style="text-align: left; padding-left: 10px; font-weight: bold; color: #58a6ff;">${escapeHtml(sub3Text)}</td>
            <td style="text-align: left; padding-left: 10px; line-height: 1.4;">${tableContent}</td>
        `;

        tr.dataset.logId = log.id;
        tr.onclick = () => {
            checkUnsavedChangesAndProceed(() => {
                setMemoState(log);
                if (workerEl) workerEl.textContent = log.worker || '-';
                if (mdEl) mdEl.textContent = log.md || '0';
                Array.from(tbody.children).forEach(child => child.classList.remove('active-row'));
                tr.classList.add('active-row');
            });
        };

        return tr;
    };

    // 부모 로그 렌더링
    const parentRow = createRow(parentLog, '최초', '#238636', true);
    parentRow.classList.add('active-row');
    tbody.appendChild(parentRow);

    // 팝업 열릴 때 부모의 상태를 우선 표시
    if (issueShareCb) issueShareCb.checked = !!parentLog.isIssueShared;

    // 자식 로그 렌더링
    childLogs.forEach((log, idx) => {
        tbody.appendChild(createRow(log, `추가 ${idx + 1}`, '#1f6feb', false));
    });

    // 예정된 자식 작업(미완료 추가작업) 렌더링
    childMaints.forEach((maint, idx) => {
        const tr = createRow(maint, `예정 ${idx + 1}`, '#d29922', false);
        const dateCell = tr.querySelector('td:nth-child(2)');
        if (dateCell) dateCell.innerHTML = `${escapeHtml(maint.scheduledDate || '-')} <span style="color:#d29922; font-size:10px; font-weight:bold;">(예정)</span>`;

        // [추가] 예정된 추가 작업 삭제 버튼
        const contentCell = tr.querySelector('td:nth-child(3)');
        if (contentCell) {
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-del-sm';
            delBtn.textContent = '✕';
            delBtn.title = '예정된 추가 작업 삭제';
            delBtn.style.cssText = 'float: right; margin-top: -2px; padding: 2px 6px; font-size: 10px; background: transparent; border: 1px solid #da3633; color: #da3633; border-radius: 4px; cursor: pointer;';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm('이 예정된 추가 작업을 삭제하시겠습니까?')) {
                    const latestData = JSON.parse(localStorage.getItem(key)) || {};
                    if (latestData.maint) {
                        if (typeof window.syncHistoryTransaction === 'function') {
                            const success = await window.syncHistoryTransaction(site, equip, { maint_deletes: [maint.id.toString()] });
                            if (!success) return;
                        }
                        latestData.maint = latestData.maint.filter(m => m.id !== maint.id);
                        localStorage.setItem(key, JSON.stringify(latestData));

                        if (typeof window.addSystemLog === 'function') window.addSystemLog('DELETE_SCHEDULE', equip, `예정된 추가 작업 삭제: ${maint.content}`);

                        window.openExtraWorkHistoryModal(site, equip, originalLogId); // 팝업 새로고침
                        if (typeof renderCalendar === 'function') renderCalendar();
                        if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                        if (typeof renderDetails === 'function') renderDetails();
                    }
                }
            };
            contentCell.appendChild(delBtn);
        }

        tr.onclick = () => {
            modal.style.display = 'none';
            openEventDetailModal(site, equip, maint.id, false);
        };
        tbody.appendChild(tr);
    });

    // 체크박스 클릭(변경) 이벤트 바인딩
    if (issueShareCb) {
        const newCb = issueShareCb.cloneNode(true);
        issueShareCb.parentNode.replaceChild(newCb, issueShareCb);
        issueShareCb = document.getElementById('extra-work-issue-share');

        const userRole = sessionStorage.getItem('userRole');
        issueShareCb.disabled = (userRole !== 'admin' && userRole !== 'superadmin');

        issueShareCb.addEventListener('change', async (e) => {
            const isChecked = e.target.checked;
            const data = JSON.parse(localStorage.getItem(key)) || {};
            if (data.logs) {
                let logUpserts = [];
                let newLogs = JSON.parse(JSON.stringify(data.logs));
                const pLog = newLogs.find(l => l.id == originalLogId);
                if (pLog) {
                    pLog.isIssueShared = isChecked;
                    logUpserts.push(pLog);
                }
                const cLogs = newLogs.filter(l => l.originalLogId == originalLogId);
                cLogs.forEach(cLog => {
                    cLog.isIssueShared = isChecked;
                    logUpserts.push(cLog);
                });

                data.logs = newLogs; // 수정된 상태를 원본 데이터에 반영

                localStorage.setItem(key, JSON.stringify(data));
                window.syncHistoryTransaction(site, equip, { log_upserts: logUpserts });
                if (typeof addSystemLog === 'function') addSystemLog('UPDATE_MEMO', equip, `이슈 공유 상태 세트 변경 (LogID: ${originalLogId})`);
                if (typeof window.populateEquipmentIssues === 'function') window.populateEquipmentIssues();
                if (typeof window.renderLogs === 'function') window.renderLogs();
            }
        });
    }

    // [추가] '추가작업 생성' 버튼 동작 바인딩
    const extraCreateAddBtn = document.getElementById('btn-create-additional-work-from-extra');
    if (extraCreateAddBtn) {
        extraCreateAddBtn.onclick = (e) => {
            e.preventDefault();
            modal.style.display = 'none';
            if (typeof window.openRegisterScheduleModal === 'function') {
                const presetData = { 
                    type: (parentLog.type && parentLog.type !== '-') ? parentLog.type : '비정기', 
                    detailType: (parentLog.detailType && parentLog.detailType !== '-') ? parentLog.detailType : '', 
                    detailType2: (parentLog.detailType2 && parentLog.detailType2 !== '-') ? parentLog.detailType2 : '', 
                    content: '', 
                    worker: parentLog.worker || '' 
                };
                window.currentSearchFilters = { site: site, equip: equip };
                window.currentAddWorkLogId = originalLogId;
                const parentDateStr = parentLog.date || parentLog.scheduledDate || new Date().toISOString().substring(0, 10);
                window.openRegisterScheduleModal(parentDateStr, presetData);
            } else {
                sessionStorage.setItem('openAddWorkForLog', JSON.stringify({ site, equip, logId: originalLogId }));
                location.href = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}`;
            }
        };
    }

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
        "01-01": "신정", "03-01": "삼일절", "05-01": "근로자의 날", "05-05": "어린이날",
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
   11. 통합 공통 유틸리티 (Shared Components)
   ========================================================================== */
window.workerNamesCache = [];
window.fetchWorkerNames = async function (site = null) {
    if (!site && window.workerNamesCache.length > 0) return window.workerNamesCache;
    try {
        let querySite = site;
        if (site && typeof window.getSiteGroupName === 'function') {
            querySite = window.getSiteGroupName(site);
        }
        const url = querySite ? `/api/users/names?site=${encodeURIComponent(querySite)}` : '/api/users/names';
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
        let itemCost = '유상';
        const costMatch = val.match(/^\[(.*?)\] (.*)$/);
        if (costMatch) {
            itemCost = costMatch[1];
            val = costMatch[2];
        }
        const innerCostMatch = val.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
        if (innerCostMatch) {
            itemCost = innerCostMatch[2];
            val = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
        }
        selectedMap[val] = itemCost;
    });

    let siteName = '';
    let equipName = '';
    let equipKeyFull = '';

    if (typeof currentDetailTarget !== 'undefined' && currentDetailTarget && currentDetailTarget.equip) {
        equipKeyFull = currentDetailTarget.equip;
        siteName = currentDetailTarget.site || '';
    } else if (window.currentDetailTarget && window.currentDetailTarget.equip) {
        equipKeyFull = window.currentDetailTarget.equip;
        siteName = window.currentDetailTarget.site || '';
    } else if (document.getElementById('register-equip-select') && document.getElementById('register-equip-select').value) {
        equipKeyFull = document.getElementById('register-equip-select').value;
        const siteSel = document.getElementById('register-site-select');
        if (siteSel) siteName = siteSel.value;
    } else if (typeof currentPath !== 'undefined' && currentPath.equip) {
        equipKeyFull = currentPath.equip;
        siteName = currentPath.site || '';
    }
    let equipParts = (equipKeyFull || '').split('::').map(s => s.trim()).filter(Boolean);
    equipName = equipParts.length > 1 ? equipParts[1] : (equipParts[0] || '');
    const matchedModel = (typeof equipmentModels !== 'undefined' ? equipmentModels : []).find(m => m.name === equipName || m.abbr === equipName);
    const targetEquipNames = [equipName];
    if (matchedModel) {
        if (matchedModel.name) targetEquipNames.push(matchedModel.name);
        if (matchedModel.abbr) targetEquipNames.push(matchedModel.abbr);
    }

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    // [추가] 해당 장비 유지관리(maint) 데이터에서 우선순위 항목 추출 (물품 상세 spec 포함)
    let maintItems = [];
    if (siteName && equipKeyFull) {
        const detailData = JSON.parse(localStorage.getItem(`details_${siteName}_${equipKeyFull}`)) || {};
        if (detailData.maint) maintItems = detailData.maint;
    }

    let matchedItems = [];
    const addedSet = new Set();

    // 1. 해당 장비 유지관리 물품 우선 등록
    maintItems.forEach(m => {
        if (m.content === '내용 없음' || m.content === '장비 점검') return;
        // [추가] 고객대응, 용액제조, 온라인점검은 유지관리 물품 제안 목록에 추가되지 않도록 차단 (단, 설비 정상화는 제외)
        if (['고객대응', '용액제조', '온라인점검'].includes(m.type)) {
            if (!(m.type === '고객대응' && m.detailType === '설비 정상화')) return;
        }

        let pureContent = m.content;

        const costMatchPrefix = pureContent.match(/^\[(.*?)\]\s*(.*)$/);
        if (costMatchPrefix) {
            pureContent = costMatchPrefix[2];
        }

        // [추가] 오염된 텍스트 정제
            pureContent = pureContent.replace(/\[(유상|무상[^\]]*|기타)\]/g, '').trim();
        pureContent = pureContent.replace(/\s*-\s*$/, '').trim();

        const partKeywords = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '물품 이상 교체', '물품 이상 수리', '파트 이상 (교체)', '파츠 이상 교체', '파트 이상', '파츠 이상'];

        // [수정] 키워드 자체가 독립적으로 들어간 경우 물품으로 인식하지 않도록 예외 처리
        if (partKeywords.some(kw => pureContent === kw || pureContent.endsWith(kw))) return;

        for (const keyword of partKeywords) {
            const idx = pureContent.indexOf(keyword);
            if (idx !== -1) {
                pureContent = pureContent.substring(idx + keyword.length).replace(/^[\s-]+/, '');
                break;
            }
        }

        if (!pureContent) return;

        // [수정] 여러 물품이 콤마로 묶여 있을 경우 분리해서 개별 물품으로 인식
        const partsArray = pureContent.split(',').map(s => s.trim()).filter(Boolean);

        partsArray.forEach(pText => {
            let actualPart = pText;
            // 비용 태그 제거
            const costMatch = actualPart.match(/^\[(.*?)\] (.*)$/);
            if (costMatch) actualPart = costMatch[2];

            if (!actualPart) return; // [수정] 비용 태그만 있는 잘못된 데이터 필터링
            // 규격 제거
            const extracted = window.extractSpecFromContent(actualPart);
            let spec = extracted.spec || m.spec || ''; // 텍스트에 규격이 있으면 우선 적용
            actualPart = extracted.pureContent;

            // 등록된 물품이 아닌 기본 현장 이슈 항목들은 드롭다운에서 제외
            const nonPartKeywords = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "프로그램 이상", "단순조치", "기타", "내용 없음"];
            // [추가] 잘못된 점검 키워드(과거 데이터 잔재)가 물품 드롭다운에 노출되는 것을 완벽하게 필터링
            if (nonPartKeywords.includes(actualPart) || partKeywords.includes(actualPart) || partKeywords.some(kw => actualPart === kw || actualPart.startsWith(kw + ' - '))) return;

            const match = adminItems.find(a => a.part === actualPart || a.code === actualPart);
            if (!match) return; // 물품 관리(adminItems)에 등록되지 않은 항목은 제안박스 제외
            
            let code = match.code || '';
            let partno = match.partno || '';
            actualPart = match.code || match.part || actualPart; // 코드명 우선 적용 보정

            const finalBaseName = code || actualPart;
            const specStr = spec ? ` [${spec}]` : '';
            const displayValue = `${finalBaseName}${specStr}`;

            if (!addedSet.has(displayValue)) {
                addedSet.add(displayValue);
                matchedItems.push({ part: actualPart, code: code, partno: partno, spec: spec, displayValue: displayValue });
            }
        });
    });

    // 2. adminItems 중 장비 모델 매칭 항목 추가
    adminItems.forEach(item => {
        if (item.equip) {
            const equips = item.equip.split(',').map(e => e.trim());
            if (targetEquipNames.some(tn => equips.includes(tn))) {
                const baseName = item.code || item.part;
                if (!addedSet.has(baseName)) {
                    addedSet.add(baseName);
                    matchedItems.push({ part: item.part, code: item.code, partno: item.partno || '', spec: '', displayValue: baseName });
                }
            }
        }
    });

    Object.keys(selectedMap).forEach(key => {
        if (!addedSet.has(key)) {
            const extracted = window.extractSpecFromContent(key);
            const pure = extracted.pureContent, spec = extracted.spec;

            const globalMatch = adminItems.find(i => i.part === pure || i.code === pure);
            if (globalMatch) {
                const partno = globalMatch.partno || '';
                matchedItems.unshift({ part: globalMatch.part, code: globalMatch.code, partno: partno, spec: spec, displayValue: key });
                addedSet.add(key);
            }
        }
    });

    let otherItems = [];
    adminItems.forEach(item => {
        if (!item.part) return; // 유령 물품(빈 데이터) 방지
        const baseName = item.code || item.part;
        if (!addedSet.has(baseName)) {
            addedSet.add(baseName);
            otherItems.push({ part: item.part, code: item.code, partno: item.partno || '', spec: '', displayValue: baseName });
        }
    });

    // [수정] 렌더링 전 기존 선택 상태 및 비용 처리 값 백업을 함수 외부 스코프에서 관리
    const currentSelections = { ...selectedMap };

    const render = (searchTerm = '') => {
        list.querySelectorAll('.log-select-item').forEach(el => {
            const val = el.dataset.value;
            if (el.classList.contains('selected')) {
                const cSel = el.querySelector('.item-cost-select');
                currentSelections[val] = cSel ? cSel.value : '유상';
            } else {
                delete currentSelections[val];
            }
        });
        let displayItems = [...matchedItems, ...otherItems];
        if (searchTerm) {
            const kws = searchTerm.toLowerCase().split(/\s+/);
            // [수정] 검색 필터링 시 품번(partno)도 포함
            displayItems = [...matchedItems, ...otherItems].filter(item => kws.every(kw => `${item.displayValue || ''} ${item.partno || ''}`.toLowerCase().includes(kw)));
        }
        const displayItemValues = new Set(displayItems.map(i => i.displayValue));
        Object.keys(currentSelections).forEach(selectedValue => {
            if (!displayItemValues.has(selectedValue)) {
                const originalItem = [...matchedItems, ...otherItems].find(i => i.displayValue === selectedValue);
                if (originalItem) displayItems.unshift(originalItem);
                else displayItems.unshift({ part: selectedValue, code: '', partno: '', spec: '', displayValue: selectedValue });
            }
        });
        const uniqueItems = [];
        const seen = new Set();
        displayItems.forEach(item => {
            const val = item.displayValue;
            if (!seen.has(val)) { seen.add(val); uniqueItems.push(item); }
        });
        list.innerHTML = '';
        uniqueItems.forEach(item => {
            const displayValue = item.displayValue;
            const isSelected = currentSelections.hasOwnProperty(displayValue);
            const itemCost = isSelected ? currentSelections[displayValue] : '유상';
            const template = getTemplateContent('log-part-item-template');
            if (!template) return;
            const div = template.querySelector('.log-select-item');
            if (isSelected) div.classList.add('selected');
            div.dataset.value = escapeHtml(displayValue);

            const itemNameEl = div.querySelector('.item-name');
            itemNameEl.innerHTML = `<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(displayValue)}</span>`;
            itemNameEl.style.display = 'flex';
            itemNameEl.style.alignItems = 'center';

            if (!item.spec) {
                const addSpecBtn = document.createElement('button');
                addSpecBtn.innerHTML = '＋';
                addSpecBtn.type = 'button';
                addSpecBtn.style.cssText = 'margin-left: 5px; background: #0d1117; border: 1px solid #3fb950; color: #3fb950; border-radius: 4px; padding: 0 4px; font-size: 12px; font-weight: bold; cursor: pointer; flex-shrink: 0; line-height: 1; position: relative; z-index: 20; -webkit-tap-highlight-color: rgba(0,0,0,0);';
                addSpecBtn.title = '물품 상세 추가';

                let lastBtnTouch = 0;
                const triggerAddSpec = (e) => {
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    if (typeof window.openAddPartSpecModal === 'function') {
                        window.openAddPartSpecModal(siteName, equipKeyFull, item, (newItem) => {
                            const newDisplayValue = newItem.code ? `${newItem.code} [${newItem.spec}]` : `${newItem.content} [${newItem.spec}]`;
                            const currentSelsArray = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => {
                                const cSel = el.querySelector('.item-cost-select');
                                return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                            });
                            if (!currentSelsArray.some(v => v.includes(newDisplayValue))) {
                                currentSelsArray.push(`[유상] ${newDisplayValue}`);
                            }
                            if (searchInput) searchInput.value = '';
                            window.renderLogPartOptions(wrapperId, triggerId, listId, searchId, currentSelsArray.join(', '));
                        });
                    }
                };

                addSpecBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
                addSpecBtn.ontouchstart = (e) => { e.stopPropagation(); };
                addSpecBtn.ontouchend = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    lastBtnTouch = Date.now();
                    triggerAddSpec(e);
                };
                addSpecBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (Date.now() - lastBtnTouch < 600) return;
                    triggerAddSpec(e);
                };
                itemNameEl.appendChild(addSpecBtn);
            }

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
            const selectedItems = Array.from(list.querySelectorAll('.log-select-item.selected'));
            const selsWithCost = selectedItems.map(el => {
                const cSel = el.querySelector('.item-cost-select');
                const cost = cSel ? cSel.value : '유상';
                return `[${cost}] ${el.dataset.value}`;
            });
            const selsRaw = selectedItems.map(el => el.dataset.value);

            if (selsRaw.length > 1) {
                trigger.textContent = `${selsWithCost[0]} 외 ${selsRaw.length - 1}개`;
                trigger.classList.remove('multi-line');
                trigger.style.color = '#fff'; // 선택된 내용 글자 색상 흰색
            } else if (selsRaw.length === 1) {
                trigger.textContent = selsWithCost[0];
                trigger.classList.remove('multi-line');
                trigger.style.color = '#fff'; // 선택된 내용 글자 색상 흰색
            } else {
                trigger.textContent = '물품 선택';
                trigger.classList.remove('multi-line');
                trigger.style.color = '#8b949e'; // 기본 텍스트 회색
            }
            trigger.title = selsWithCost.join('\n');
            trigger.classList.remove('error-border');

            if (typeof window.updateDetailDisplayList === 'function') window.updateDetailDisplayList();
            if (typeof window.updateRegisterDisplayList === 'function') window.updateRegisterDisplayList();
        };
        list.querySelectorAll('.item-cost-select').forEach(cSel => {
            cSel.addEventListener('change', (e) => { e.stopPropagation(); if (cSel.closest('.log-select-item').classList.contains('selected')) updateTriggerText(); });
        });
        list.querySelectorAll('.log-select-item').forEach(div => {
            let startY = 0;
            let startX = 0;
            let isMoving = false;

            div.addEventListener('touchstart', (e) => {
                window.lastTouchTime = Date.now();
                startY = e.touches[0].clientY;
                startX = e.touches[0].clientX;
                isMoving = false;
            }, { passive: true });

            div.addEventListener('touchmove', (e) => {
                const moveY = e.touches[0].clientY;
                const moveX = e.touches[0].clientX;
                if (Math.abs(moveY - startY) > 6 || Math.abs(moveX - startX) > 6) {
                    isMoving = true;
                }
            }, { passive: true });

            div.addEventListener('touchend', (e) => {
                if (e.target.closest('button') || e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') return;
                if (isMoving) return;
                e.preventDefault();
                e.stopPropagation();
                div.classList.toggle('selected');
                updateTriggerText();
            });

            div.addEventListener('mousedown', (e) => {
                if (window.lastTouchTime && Date.now() - window.lastTouchTime < 600) return;
                if (e.target.closest('button') || e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') return;
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

// [추가] 물품 상세 추가 팝업 생성 및 처리
window.openAddPartSpecModal = function (site, equip, itemObj, onAddCallback) {
    let modal = document.getElementById('add-part-spec-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'add-part-spec-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '11000';
        modal.innerHTML = `
            <div class="modal-window" style="width: 400px; height: auto; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h3>물품 추가</h3>
                    <button id="btn-close-add-part-spec" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 16px;">✕</button>
                </div>
                <div class="modal-body" style="padding: 15px; display: flex; flex-direction: column; gap: 10px;">
                    <div class="form-row" style="margin-bottom: 0;">
                        <label class="modal-label" style="width: 80px; flex-shrink: 0; color: #8b949e; font-size: 13px;">코드명</label>
                        <input type="text" id="add-part-spec-code" class="input-dark" readonly style="opacity: 0.6; cursor: not-allowed; font-size: 13px;">
                    </div>
                    <div class="form-row" style="margin-bottom: 0;">
                        <label class="modal-label" style="width: 80px; flex-shrink: 0; color: #8b949e; font-size: 13px;">물품명</label>
                        <input type="text" id="add-part-spec-part" class="input-dark" readonly style="opacity: 0.6; cursor: not-allowed; font-size: 13px;">
                    </div>
                    <div class="form-row" style="margin-bottom: 0;">
                        <label class="modal-label" style="width: 80px; flex-shrink: 0; color: #8b949e; font-size: 13px;">규격</label>
                        <input type="text" id="add-part-spec-master" class="input-dark" readonly style="opacity: 0.6; cursor: not-allowed; font-size: 13px;">
                    </div>
                    <div class="form-row" style="margin-bottom: 0;">
                        <label class="modal-label" style="width: 80px; flex-shrink: 0; color: #8b949e; font-size: 13px;">물품 상세</label>
                        <input type="text" id="add-part-spec-input" class="input-dark" placeholder="물품 상세 입력 (예: 100ml)" style="font-size: 13px;">
                    </div>
                    <div style="margin-top: 15px;">
                        <button id="btn-confirm-add-part-spec" class="btn-blue-sm" style="width: 100%; padding: 8px; font-size: 14px;">추가</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('btn-close-add-part-spec').onclick = () => modal.style.display = 'none';
    }

    const codeInput = document.getElementById('add-part-spec-code');
    const partInput = document.getElementById('add-part-spec-part');
    const masterInput = document.getElementById('add-part-spec-master');
    const specInput = document.getElementById('add-part-spec-input');
    const confirmBtn = document.getElementById('btn-confirm-add-part-spec');

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    const itemName = itemObj.part || itemObj.content; // 호환성 처리 (작업 등록 팝업 호출 대응)
    const match = adminItems.find(a => a.part === itemName || a.code === itemName);
    const masterSpec = match ? (match.spec || '') : '';
    const cycle = match ? (match.cycle || null) : null;

    codeInput.value = itemObj.code || '';
    partInput.value = itemName || '';
    masterInput.value = masterSpec;
    specInput.value = '';

    // [추가] 쉼표(,) 및 슬래시(/) 등 구분 특수문자 실시간 필터링
    specInput.oninput = () => {
        specInput.value = specInput.value.replace(/[,/]/g, '');
    };

    confirmBtn.onclick = async () => {
        const newSpec = specInput.value.trim();
        if (!newSpec) { alert('물품 상세를 입력해주세요.'); specInput.focus(); return; }

        // [추가] 쉼표(,) 및 슬래시(/) 등 구분 특수문자 검증
        if (newSpec.includes(',') || newSpec.includes('/')) {
            alert('물품 상세에 쉼표(,) 및 슬래시(/) 문자는 사용할 수 없습니다.');
            specInput.value = newSpec.replace(/[,/]/g, '');
            specInput.focus();
            return;
        }

        if (!site || !equip) {
            alert('장비 정보를 찾을 수 없습니다. 다시 시도해주세요.');
            modal.style.display = 'none';
            return;
        }

        const key = `details_${site}_${equip}`;
        let data = JSON.parse(localStorage.getItem(key)) || { maint: [] };
        if (!data.maint) data.maint = [];

        const isDuplicate = data.maint.some(m => (m.content === itemName || (m.code && itemObj.code && m.code === itemObj.code)) && (m.spec || '') === newSpec && m.type === '비정기');
        if (isDuplicate) return alert('이미 동일한 물품명과 물품 상세를 가진 항목이 존재합니다.');

        const newItem = { id: Date.now(), type: '비정기', detailType: '', code: itemObj.code || '', content: itemName, spec: newSpec, date: '', period: cycle, scheduledDate: null };
        const success = await window.syncHistoryTransaction(site, equip, { maint_upserts: [newItem] });
        if (!success) return alert('서버 등록에 실패했습니다.');

        data.maint.push(newItem);
        localStorage.setItem(key, JSON.stringify(data));

        if (typeof window.addSystemLog === 'function') window.addSystemLog('ADD_MAINTENANCE', equip, `물품 상세 추가: ${itemObj.part} [${newSpec}]`);

        modal.style.display = 'none';
        if (onAddCallback) onAddCallback(newItem);
    };

    specInput.onkeypress = (e) => { if (e.key === 'Enter') confirmBtn.click(); };
    modal.style.display = 'flex';
    specInput.focus();
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

// [추가] 소속(Department) 입력창 제안 박스 설정 함수
function setupDepartmentSuggestion(inputEl) {
    if (!inputEl || inputEl.dataset.deptSetup === 'true') return;
    inputEl.dataset.deptSetup = 'true';

    let wrapper = inputEl.closest('.autocomplete-wrapper');
    let suggestionList;

    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'autocomplete-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.width = '100%';
        wrapper.style.display = 'flex';

        inputEl.parentNode.insertBefore(wrapper, inputEl);
        wrapper.appendChild(inputEl);

        suggestionList = document.createElement('ul');
        suggestionList.className = 'suggestion-list';
        suggestionList.style.zIndex = '99999';
        suggestionList.style.top = '100%';
        suggestionList.style.left = '0';
        suggestionList.style.minWidth = '100%';
        wrapper.appendChild(suggestionList);
    } else {
        suggestionList = wrapper.querySelector('.suggestion-list');
        if (!suggestionList) {
            suggestionList = document.createElement('ul');
            suggestionList.className = 'suggestion-list';
            suggestionList.style.zIndex = '99999';
            suggestionList.style.top = '100%';
            suggestionList.style.left = '0';
            suggestionList.style.minWidth = '100%';
            wrapper.appendChild(suggestionList);
        }
    }

    // 지정된 소속 목록 ('직접 입력' 제거 및 '기타' 추가)
    const depts = ['운영1팀(본사)', '운영1팀(삼성)', '운영1팀(청주)', '운영1팀(이천)', '셋업', '해외(서안)', '해외(우시)', '해외(기타)', '기타'];

    // 직접 입력을 차단하고 드롭다운 선택만 허용
    inputEl.readOnly = true;
    inputEl.style.cursor = 'pointer';

    const showSuggestions = () => {
        suggestionList.innerHTML = '';
        depts.forEach(dept => {
            const li = document.createElement('li');
            li.className = 'user-suggestion-item suggestion-item';
            li.innerHTML = `<span style="color: #e6edf3;">${escapeHtml(dept)}</span>`;
            li.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                inputEl.value = dept;
                suggestionList.style.display = 'none';
            });
            suggestionList.appendChild(li);
        });
        suggestionList.style.display = 'block';
    };

    inputEl.addEventListener('click', (e) => {
        e.stopPropagation();
        showSuggestions();
    });

    inputEl.addEventListener('focus', showSuggestions);

    inputEl.addEventListener('blur', () => {
        setTimeout(() => {
            if (suggestionList) suggestionList.style.display = 'none';
        }, 200);
    });

    // 외부 클릭 시 닫기
    const outsideClickListener = (e) => {
        if (suggestionList && suggestionList.style.display === 'block' && e.target !== inputEl && !suggestionList.contains(e.target)) {
            suggestionList.style.display = 'none';
        }
    };
    document.addEventListener('mousedown', outsideClickListener);
    document.addEventListener('touchstart', outsideClickListener, { passive: true });
}

// [추가] 직급(Position) 입력창 제안 박스 설정 함수
function setupPositionSuggestion(inputEl) {
    if (!inputEl || inputEl.dataset.posSetup === 'true') return;
    inputEl.dataset.posSetup = 'true';

    let wrapper = inputEl.closest('.autocomplete-wrapper');
    let suggestionList;

    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'autocomplete-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.width = '100%';
        wrapper.style.display = 'flex';

        inputEl.parentNode.insertBefore(wrapper, inputEl);
        wrapper.appendChild(inputEl);

        suggestionList = document.createElement('ul');
        suggestionList.className = 'suggestion-list';
        suggestionList.style.zIndex = '99999';
        suggestionList.style.top = '100%';
        suggestionList.style.left = '0';
        suggestionList.style.minWidth = '100%';
        wrapper.appendChild(suggestionList);
    } else {
        suggestionList = wrapper.querySelector('.suggestion-list');
        if (!suggestionList) {
            suggestionList = document.createElement('ul');
            suggestionList.className = 'suggestion-list';
            suggestionList.style.zIndex = '99999';
            suggestionList.style.top = '100%';
            suggestionList.style.left = '0';
            suggestionList.style.minWidth = '100%';
            wrapper.appendChild(suggestionList);
        }
    }

    // 지정된 직급 목록
    const positions = ['사원', '주임', '대리', '과장', '차장', '부장', '직접 입력'];

    const showSuggestions = () => {
        suggestionList.innerHTML = '';
        positions.forEach(pos => {
            const li = document.createElement('li');
            li.className = 'user-suggestion-item suggestion-item';
            li.innerHTML = `<span style="color: #e6edf3;">${escapeHtml(pos)}</span>`;
            li.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                if (pos === '직접 입력') {
                    inputEl.value = '';
                    inputEl.focus();
                } else {
                    inputEl.value = pos;
                }
                suggestionList.style.display = 'none';
            });
            suggestionList.appendChild(li);
        });
        suggestionList.style.display = 'block';
    };

    inputEl.addEventListener('click', (e) => {
        e.stopPropagation();
        showSuggestions();
    });

    inputEl.addEventListener('focus', showSuggestions);

    inputEl.addEventListener('blur', () => {
        setTimeout(() => {
            if (suggestionList) suggestionList.style.display = 'none';
        }, 200);
    });

    // 외부 클릭 시 닫기
    const outsideClickListener = (e) => {
        if (suggestionList && suggestionList.style.display === 'block' && e.target !== inputEl && !suggestionList.contains(e.target)) {
            suggestionList.style.display = 'none';
        }
    };
    document.addEventListener('mousedown', outsideClickListener);
    document.addEventListener('touchstart', outsideClickListener, { passive: true });
}

// [추가] 모든 계정 관리 모달 생성 및 로직 (최종 관리자 전용)
window.openAllUsersModal = function () {
    let modal = document.getElementById('all-users-modal');
    if (!modal) {
        console.error('all-users-modal HTML 요소를 찾을 수 없습니다. common.html에 포함되어 있는지 확인해주세요.');
        return;
    }

    // 초기 이벤트 리스너 바인딩 (1회만 실행)
    if (!modal.dataset.initialized) {
        modal.dataset.initialized = 'true';

        document.getElementById('btn-close-all-users').onclick = () => { modal.style.display = 'none'; };

        // 소속/직급 제안 박스 연동
        setupDepartmentSuggestion(document.getElementById('edit-all-dept'));
        setupPositionSuggestion(document.getElementById('edit-all-pos'));

        document.getElementById('btn-save-all-user').onclick = async () => {
            const targetId = document.getElementById('edit-all-id').value;
            const name = document.getElementById('edit-all-name').value.trim();
            const dept = document.getElementById('edit-all-dept').value.trim();
            const pos = document.getElementById('edit-all-pos').value.trim();
            const role = document.getElementById('edit-all-role').value;
            const site = document.getElementById('edit-all-site').value;

            if (!name || !dept || !pos) return alert('이름, 소속, 직급을 입력해주세요.');

            const payload = { id: targetId, name, department: dept, position: pos, role, site };

            try {
                const res = await fetch('/api/admin/user/update_all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.status === 'success') {
                    alert('계정 정보가 성공적으로 수정되었습니다.');
                    window.loadAllUsersList();
                    if (typeof addSystemLog === 'function') addSystemLog('UPDATE_USER', targetId, '최종 관리자에 의한 계정 수정');
                } else {
                    alert(data.message || '수정 실패');
                }
            } catch (e) {
                alert('서버 통신 오류가 발생했습니다.');
            }
        };

        document.getElementById('btn-reset-all-user-pw').onclick = async () => {
            const targetId = document.getElementById('edit-all-id').value;
            if (!targetId) return;
            if (!confirm(`'${targetId}' 계정의 비밀번호를 초기 상태(withtech123!)로 변경하시겠습니까?`)) return;

            try {
                const res = await fetch('/api/admin/user/update_all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                    body: JSON.stringify({ id: targetId, pw: 'withtech123!' })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    alert('비밀번호가 초기화되었습니다.');
                    if (typeof addSystemLog === 'function') addSystemLog('UPDATE_USER', targetId, '최종 관리자에 의한 비밀번호 초기화');
                } else {
                    alert(data.message || '초기화 실패');
                }
            } catch (e) {
                alert('서버 통신 오류가 발생했습니다.');
            }
        };

        document.getElementById('btn-delete-all-user').onclick = async () => {
            const targetId = document.getElementById('edit-all-id').value;
            if (!targetId) return;
            if (!confirm(`'${targetId}' 계정을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

            try {
                const res = await fetch('/api/admin/user/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                    body: JSON.stringify({ target_id: targetId })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    alert('계정이 삭제되었습니다.');
                    if (typeof addSystemLog === 'function') addSystemLog('DELETE_USER', targetId, '최종 관리자에 의한 타 계정 삭제');
                    const editForm = document.getElementById('all-users-edit-form');
                    if (editForm) { editForm.style.opacity = '0.3'; editForm.style.pointerEvents = 'none'; }
                    window.loadAllUsersList();
                } else {
                    alert(data.message || '계정 삭제 실패');
                }
            } catch (e) {
                alert('서버 통신 오류가 발생했습니다.');
            }
        };

        const searchInput = document.getElementById('all-users-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const kw = searchInput.value.trim().toLowerCase();
                let visibleCount = 0;
                document.querySelectorAll('#all-users-list li').forEach(li => {
                    const text = li.dataset.search.toLowerCase();
                    if (text.includes(kw)) {
                        li.style.display = 'flex';
                        visibleCount++;
                    } else {
                        li.style.display = 'none';
                    }
                });
                const countEl = document.getElementById('all-users-count');
                if (countEl) countEl.textContent = `총 ${visibleCount}건`;
            });
        }
    }

    // 사업장 드롭다운 채우기
    const siteSelect = document.getElementById('edit-all-site');
    siteSelect.innerHTML = '<option value="">전체 사업장</option>';
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const siteGroups = new Set();
    Object.keys(deviceData).forEach(s => {
        if (s !== 'models' && s !== 'details') {
            siteGroups.add(typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(s) : '기타사업장');
        }
    });
    const siteGroupArray = Array.from(siteGroups).sort();
    if (!siteGroupArray.includes('기타사업장')) siteGroupArray.push('기타사업장');
    siteGroupArray.forEach(g => {
        siteSelect.insertAdjacentHTML('beforeend', `<option value="${g}">${g}</option>`);
    });

    window.loadAllUsersList();
    modal.style.display = 'flex';

    const editForm = document.getElementById('all-users-edit-form');
    if (editForm) { editForm.style.opacity = '0.3'; editForm.style.pointerEvents = 'none'; }
};

// [추가] 모든 계정 리스트 불러오기 및 렌더링
window.loadAllUsersList = function () {
    fetch('/api/admin/users/all', { headers: { 'X-CSRFToken': getCookie('csrf_token') } })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                const list = document.getElementById('all-users-list');
                list.innerHTML = '';
                data.users.forEach(u => {
                    const li = document.createElement('li');
                    li.dataset.search = `${u.id} ${u.name} ${u.department} ${u.position} ${u.role}`;

                    let roleBadge = '';
                    if (u.role === 'superadmin') roleBadge = '<span class="badge" style="background: #f85149; font-size: 12px; padding: 4px 8px;">최종 관리자</span>';
                    else if (u.role === 'admin') roleBadge = '<span class="badge" style="background: #d29922; font-size: 12px; padding: 4px 8px;">관리자</span>';
                    else roleBadge = '<span class="badge" style="background: #30363d; font-size: 12px; padding: 4px 8px;">일반</span>';

                    li.innerHTML = `
                        <div style="display:flex; flex-direction:column; gap:4px; min-width:0;">
                            <strong style="color:#e6edf3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(u.name || '이름 없음')} <span style="color:#8b949e; font-weight:normal;">(${escapeHtml(u.id)})</span></strong>
                            <span style="font-size:11px; color:#8b949e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(u.department || '-')} ${escapeHtml(u.position || '-')}</span>
                        </div>
                        <div style="flex-shrink:0; margin-left:10px;">${roleBadge}</div>
                    `;

                    li.onclick = () => {
                        document.querySelectorAll('#all-users-list li').forEach(el => el.classList.remove('active'));
                        li.classList.add('active');

                        const editForm = document.getElementById('all-users-edit-form');
                        if (editForm) { editForm.style.opacity = '1'; editForm.style.pointerEvents = 'auto'; }

                        document.getElementById('edit-all-id').value = u.id;
                        document.getElementById('edit-all-id-display').value = u.id;
                        document.getElementById('edit-all-name').value = u.name || '';
                        document.getElementById('edit-all-dept').value = u.department || '';
                        document.getElementById('edit-all-pos').value = u.position || '';
                        document.getElementById('edit-all-role').value = u.role || 'user';
                        document.getElementById('edit-all-site').value = u.site || '';
                    };
                    list.appendChild(li);
                });

                // 현재 검색창에 텍스트가 남아있다면 필터링 유지
                const kw = document.getElementById('all-users-search').value.trim().toLowerCase();
                let visibleCount = 0;
                if (kw) {
                    list.querySelectorAll('li').forEach(li => {
                        if (li.dataset.search.toLowerCase().includes(kw)) {
                            li.style.display = 'flex';
                            visibleCount++;
                        } else {
                            li.style.display = 'none';
                        }
                    });
                } else {
                    visibleCount = data.users.length;
                }
                const countEl = document.getElementById('all-users-count');
                if (countEl) countEl.textContent = `총 ${visibleCount}건`;
            }
        });
};

/* ==========================================================================
   12. 전역 모달 - 작업 검색 (Task Search Modal)
   ========================================================================== */
function setupTaskSearchModal() {
    if (document.getElementById('task-search-modal')) return;

    const templateContent = getTemplateContent('task-search-modal-template');
    if (templateContent) {
        document.body.appendChild(templateContent);
    }

    const closeBtn = document.getElementById('btn-close-task-search-modal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            const modal = document.getElementById('task-search-modal');
            if (modal) modal.style.display = 'none';
        };
    }

    const searchBtn = document.getElementById('btn-do-task-search');
    if (searchBtn) searchBtn.onclick = doTaskSearch;

    const keywordInput = document.getElementById('task-search-keyword-input');
    if (keywordInput) {
        keywordInput.onkeypress = (e) => {
            if (e.key === 'Enter') doTaskSearch();
        };
    }

    const startDateInput = document.getElementById('task-search-start-date');
    const endDateInput = document.getElementById('task-search-end-date');
    if (startDateInput) startDateInput.addEventListener('change', doTaskSearch);
    if (endDateInput) endDateInput.addEventListener('change', doTaskSearch);
}

function openTaskSearchModal() {
    if (typeof window.checkSessionValid === 'function' && !window.checkSessionValid()) return;
    const modal = document.getElementById('task-search-modal');
    const keywordInput = document.getElementById('task-search-keyword-input');
    const resultsList = document.getElementById('task-search-results-list');
    const startDateInput = document.getElementById('task-search-start-date');
    const endDateInput = document.getElementById('task-search-end-date');

    if (modal) {
        resultsList.innerHTML = '<li class="list-empty-msg">검색어(작업자, 장비명 등)를 입력하고 검색하세요.</li>';

        // Set default date range (today - 15 days to today + 15 days)
        const today = new Date();
        const pastDate = new Date(today);
        pastDate.setDate(today.getDate() - 15);
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + 15);

        startDateInput.value = pastDate.toISOString().substring(0, 10);
        endDateInput.value = futureDate.toISOString().substring(0, 10);

        const userName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId');
        keywordInput.value = userName || '';
        modal.style.display = 'flex';
        doTaskSearch(); // Open and search immediately
    }
}

function doTaskSearch() {
    const keywordInput = document.getElementById('task-search-keyword-input');
    const keyword = keywordInput.value.trim().toLowerCase();
    const resultsList = document.getElementById('task-search-results-list');
    const startDate = document.getElementById('task-search-start-date').value;
    const endDate = document.getElementById('task-search-end-date').value;

    if (!keyword && !startDate && !endDate) {
        resultsList.innerHTML = '<li class="list-empty-msg">검색어를 입력하거나 기간을 선택하세요.</li>';
        return;
    }

    let allTasks = [];
    const mainData = getDeviceDataMap();
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            mainData[site].forEach(equip => {
                const key = `details_${site}_${equip}`;
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (!data) return;
                    const custEquipName = (data.setup && data.setup.custEquipName) ? data.setup.custEquipName : '';

                    const equipRawName = equip.split('::')[0];
                    const matchedModel = equipmentModels.find(m => m.name === equipRawName || m.abbr === equipRawName);
                    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr.toLowerCase() : equipRawName.toLowerCase();

                    // Helper to check if a date falls within the range
                    const isDateInRange = (taskDate) => {
                        if (!taskDate) return false;
                        const taskDateObj = new Date(taskDate);
                        taskDateObj.setHours(0, 0, 0, 0); // Normalize to start of day
                        const start = startDate ? new Date(startDate) : null;
                        const end = endDate ? new Date(endDate) : null;
                        if (start) start.setHours(0, 0, 0, 0);
                        if (end) end.setHours(0, 0, 0, 0);

                        return (!start || taskDateObj >= start) && (!end || taskDateObj <= end);
                    };

                    // 1. Completed tasks from logs
                    if (data.logs) {
                        data.logs.forEach(log => {
                            const logWorker = log.worker ? log.worker.toLowerCase() : '';
                            const logContent = log.content ? log.content.toLowerCase() : '';
                            const equipName = equip.split('::')[0].toLowerCase();

                            const matchesKeyword = !keyword || (
                                logWorker.includes(keyword) ||
                                equipName.includes(keyword) ||
                                displayName.includes(keyword) ||
                                logContent.includes(keyword) ||
                                custEquipName.toLowerCase().includes(keyword)
                            );

                            if (log.detailType !== '일정변경' && matchesKeyword && isDateInRange(log.date)) {
                                // [수정] 추가 작업도 부모로 치환하지 않고 본연의 내용으로 검색 결과에 직접 노출
                                if (!allTasks.some(t => t.item.id === log.id)) {
                                    allTasks.push({ site, equip, item: log, isCompleted: true, custEquipName: custEquipName });
                                }
                            }
                        });
                    }

                    // 2. Scheduled tasks from maint
                    if (data.maint) {
                        data.maint.forEach(item => {
                            const itemWorker = item.worker ? item.worker.toLowerCase() : '';
                            const itemContent = item.content ? item.content.toLowerCase() : '';
                            const equipName = equip.split('::')[0].toLowerCase();

                            const matchesKeyword = !keyword || (
                                itemWorker.includes(keyword) ||
                                equipName.includes(keyword) ||
                                displayName.includes(keyword) ||
                                itemContent.includes(keyword) ||
                                custEquipName.toLowerCase().includes(keyword)
                            );

                            if (item.scheduledDate && matchesKeyword && isDateInRange(item.scheduledDate)) {
                                const isDone = data.logs && data.logs.some(l =>
                                    l.date === item.scheduledDate &&
                                    (l.content || '').includes(item.content || '') &&
                                    (l.worker || '').includes(item.worker || '')
                                );
                                if (!isDone && !allTasks.some(t => t.item.id === item.id)) {
                                    allTasks.push({ site, equip, item: item, isCompleted: false, custEquipName: custEquipName });
                                }
                            }
                        });
                    }
                } catch (e) { console.error(`Error parsing data for key ${key}:`, e); }
            });
        }
    });

    // 같은 날, 같은 장비 작업 그룹화
    const groupedTasks = {};
    allTasks.forEach(task => {
        const date = task.isCompleted ? task.item.date : task.item.scheduledDate;
        const type = task.item.type || '정기';
        const detailType = task.item.detailType || '';
        const detailType2 = task.item.detailType2 || '';

        const key = `${date}_${task.site}_${task.equip}_${type}_${detailType}_${detailType2}`;
        if (!groupedTasks[key]) {
            groupedTasks[key] = {
                site: task.site,
                equip: task.equip,
                date: date,
                type: type,
                items: [],
                custEquipName: task.custEquipName,
                isCompleted: true
            };
        }
        groupedTasks[key].items.push(task.item);
        if (!task.isCompleted) {
            groupedTasks[key].isCompleted = false;
        }
    });

    const displayTasks = Object.values(groupedTasks);
    displayTasks.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (displayTasks.length === 0) {
        resultsList.innerHTML = '<li class="list-empty-msg">검색된 작업이 없습니다.</li>';
        return;
    }

    resultsList.innerHTML = '';
    displayTasks.forEach(group => {
        const { site, equip, date, type, items, isCompleted, custEquipName } = group;
        const parts = equip.split('::');
        const rawName = parts[0];
        const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
        const equipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
        const serialNo = parts.length > 1 ? `[${parts[1]}]` : '';

        const contents = [...new Set(items.map(item => item.content || '내용 없음'))];
        const detailTypes = [...new Set(items.map(item => {
            if (item.detailType2) return item.detailType2;
            if (item.detailType) return item.detailType;
            return item.type || '정기';
        }))];

        const displayContent = contents.join(', ');
        const displayType = type;
        const displayDetailType = detailTypes.join(' | ');

        const tpl = getTemplateContent('task-search-result-item-template');
        if (tpl) {
            const li = tpl.querySelector('li');
            li.addEventListener('click', () => openTaskFromSearch(site, equip, items[0].id, isCompleted));

            li.querySelector('.task-date').textContent = date;

            // [추가] 검색 결과에 노출된 항목이 추가 작업(자식)일 경우 파란색 <추가> 뱃지 표시
            const isExtraWork = items.some(i => i.originalLogId && String(i.originalLogId).trim() !== '' && String(i.originalLogId) !== 'None' && String(i.originalLogId) !== 'null');
            if (isExtraWork) {
                const extraSpan = document.createElement('span');
                extraSpan.textContent = '<추가>';
                extraSpan.style.color = '#1f6feb';
                extraSpan.style.fontWeight = 'bold';
                extraSpan.style.fontSize = '12px';
                extraSpan.style.marginLeft = '8px';

                const completedStatusEl = li.querySelector('.completed-status');
                if (completedStatusEl && completedStatusEl.parentNode) {
                    completedStatusEl.parentNode.insertBefore(extraSpan, completedStatusEl.nextSibling);
                } else {
                    const topDiv = li.querySelector('div > div:first-child');
                    if (topDiv) topDiv.appendChild(extraSpan);
                }
            }

            if (isCompleted) {
                li.classList.add('completed');
                li.querySelector('.completed-status').style.display = 'inline';

                const logItem = items[0];
                const targetLogId = logItem.originalLogId || logItem.id;
                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const childLogs = (detailData.logs || []).filter(l => l.originalLogId == targetLogId);
                const childMaints = (detailData.maint || []).filter(m => m.originalLogId == targetLogId);
                const hasExtra = childLogs.length > 0 || childMaints.length > 0;

                const actionContainer = document.createElement('div');
                actionContainer.style.display = 'flex';
                actionContainer.style.gap = '5px';
                actionContainer.style.marginLeft = 'auto';

                const addBtn = document.createElement('button');
                addBtn.className = 'btn-blue-sm';
                addBtn.textContent = '추가';
                addBtn.style.width = '50px';
                addBtn.style.padding = '4px 0';
                addBtn.style.textAlign = 'center';
                addBtn.onclick = (e) => {
                    e.stopPropagation();

                    // [추가] 검색 모달 잠시 숨기고 상세 팝업 종료 시 돌아오기 위한 플래그 설정
                    const searchModal = document.getElementById('task-search-modal');
                    if (searchModal) searchModal.style.display = 'none';
                    cameFromTaskSearch = true;

                    const presetData = { type: logItem.type, detailType: logItem.detailType, detailType2: logItem.detailType2, detailType3: logItem.detailType3 || '', content: '', worker: logItem.worker || '' };
                    window.currentSearchFilters = { site: site, equip: equip };
                    window.currentAddWorkLogId = targetLogId;
                    const targetLogDate = logItem.date || logItem.scheduledDate || (typeof date !== 'undefined' ? date : '') || new Date().toISOString().substring(0, 10);
                    if (typeof window.openRegisterScheduleModal === 'function') {
                        window.openRegisterScheduleModal(targetLogDate, presetData);
                    } else {
                        let targetUrl = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}&action=addExtraWork&logId=${targetLogId}`;
                        window.location.href = targetUrl;
                    }

                    window.handleExtraWorkAdded = function (newLogId) {
                        alert('추가 작업이 등록되었습니다.');
                        doTaskSearch();
                    };
                };
                actionContainer.appendChild(addBtn);

                if (hasExtra) {
                    const viewBtn = document.createElement('button');
                    viewBtn.className = 'btn-green-sm';
                    viewBtn.textContent = '확인';
                    viewBtn.style.width = '50px';
                    viewBtn.style.padding = '4px 0';
                    viewBtn.style.textAlign = 'center';
                    viewBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (typeof window.openExtraWorkHistoryModal === 'function') window.openExtraWorkHistoryModal(site, equip, targetLogId);
                    };
                    actionContainer.appendChild(viewBtn);
                }

                const topDiv = li.querySelector('div:first-child');
                if (topDiv) topDiv.appendChild(actionContainer);
            }

            const typeBadge = li.querySelector('.popup-type-badge');
            typeBadge.className = `popup-type-badge type-${type}`;
            typeBadge.textContent = `[${displayType}]`;

            let subInfo = '';
            if (custEquipName) {
                subInfo = ` <span style="color:#3fb950;">[${escapeHtml(custEquipName)}]</span>`;
            } else if (serialNo) {
                subInfo = ` <span style="color:#3fb950;">${escapeHtml(serialNo)}</span>`;
            }
            li.querySelector('.equip-name').innerHTML = `${escapeHtml(site)} > ${escapeHtml(equipName)}${subInfo}`;

            const detailsSpan = li.querySelector('.task-details');
            detailsSpan.textContent = `${displayDetailType} : ${displayContent}`;
            detailsSpan.title = `${displayDetailType} : ${displayContent}`;

            resultsList.appendChild(li);
        }
    });
}

function openTaskFromSearch(site, equip, id, isCompleted) {
    const searchModal = document.getElementById('task-search-modal');
    if (searchModal) searchModal.style.display = 'none';

    cameFromTaskSearch = true; // [추가] 플래그 설정
    if (typeof window.openEventDetailModal === 'function') {
        window.openEventDetailModal(site, equip, id, isCompleted);
    } else {
        let targetUrl = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}`;
        if (isCompleted && id) targetUrl += `&logId=${id}`;
        window.location.href = targetUrl;
    }
}
window.doTaskSearch = doTaskSearch;
window.openTaskFromSearch = openTaskFromSearch;