/**
 * ==========================================================================
 * DATA 페이지 전용 스크립트 (data.js)
 * 장비별 엑셀형 데이터 시트 (동적 열 추가, 날짜별 행 누적, 셀 직접 편집)
 * ==========================================================================
 */

let currentSelectedSite = null;
let currentSelectedEquip = null;
let currentDataMode = 'raw'; // 'raw' (Raw Data) 또는 'param' (Parameter)
let currentSheetData = {
    columns: [],
    rows: []
};

let autoSaveTimer = null;
let isDataPageInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
    const runInit = () => {
        if (isDataPageInitialized) {
            // 이미 초기화되었으나 장비가 아직 선택되지 않은 경우 재시도 (초기 데이터 로딩 완료 시점 대응)
            if (!currentSelectedSite || !currentSelectedEquip) {
                renderSiteList();
                checkAndApplyTargetFilter();
            }
            return;
        }
        isDataPageInitialized = true;
        initDataPage();
    };

    window.addEventListener('DataLoaded', runInit);

    if (localStorage.getItem('device_data') || window.isDataLoaded) {
        runInit();
    } else {
        setTimeout(runInit, 300);
    }

    // 2. 검색 및 필터 이벤트 리스너 설정
    setupDataEventListeners();
});

/**
 * 페이지 초기화
 */
function initDataPage() {
    renderSiteList();

    // 하단 빠른 날짜 행 추가 기본값 설정
    const quickDate = document.getElementById('data-quick-add-date');
    if (quickDate) {
        quickDate.value = getTodayString();
    }

    // URL 파라미터(?site=...&equip=...) 또는 세션스토리지/로컬스토리지 기반 장비 필터 자동 적용
    checkAndApplyTargetFilter();
}

/**
 * 마지막 선택 사업장/장비/모드 상태 저장 (다른 메뉴 이동 후 복원용)
 */
function saveLastDataState(site, equipKey, mode) {
    try {
        const state = {
            site: site || '',
            equip: equipKey || '',
            mode: mode || currentDataMode || 'raw'
        };
        localStorage.setItem('lastDataPath', JSON.stringify(state));
        sessionStorage.setItem('lastDataPath', JSON.stringify(state));
    } catch (e) {
        console.error('Failed to save lastDataPath:', e);
    }
}

/**
 * URL 파라미터 또는 세션스토리지/로컬스토리지 기반 사업장/장비 자동 필터 및 선택
 */
function checkAndApplyTargetFilter() {
    const urlParams = new URLSearchParams(window.location.search);
    let targetSite = urlParams.get('site') || sessionStorage.getItem('target_data_site');
    let targetEquip = urlParams.get('equip') || sessionStorage.getItem('target_data_equip');

    // 1회성 세션 스토리지 정리
    sessionStorage.removeItem('target_data_site');
    sessionStorage.removeItem('target_data_equip');

    let isRestoringLast = false;
    // URL 파라미터나 외부 연동 타겟이 없는 경우, 마지막으로 보고 있던 상태 복원
    if (!targetSite && !targetEquip) {
        try {
            const lastDataStr = localStorage.getItem('lastDataPath') || sessionStorage.getItem('lastDataPath');
            if (lastDataStr) {
                const lastData = JSON.parse(lastDataStr);
                if (lastData && lastData.site) {
                    targetSite = lastData.site;
                    targetEquip = lastData.equip || '';
                    if (lastData.mode && (lastData.mode === 'param' || lastData.mode === 'raw')) {
                        currentDataMode = lastData.mode;
                    }
                    isRestoringLast = true;
                }
            }
        } catch (e) {
            console.error('Failed to load lastDataPath:', e);
        }
    }

    if (!targetSite) return;

    // 1. 사업장 선택
    selectSite(targetSite);
    const activeSiteLi = document.querySelector(`#data-site-list .data-list-item[data-site="${targetSite}"]`);
    if (activeSiteLi) {
        activeSiteLi.scrollIntoView({ block: 'nearest' });
    }

    if (!targetEquip) return;

    // 2. 장비 목록에서 targetEquip 검색 및 매칭
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || (window.storageData || {});
    const rawEquips = deviceData[targetSite] || [];
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const validEquips = rawEquips.filter(e => !e.startsWith('기타(ETC)'));

    const items = validEquips.map(equipKey => {
        const parts = equipKey.split('::');
        const modelName = parts[0] || '';
        const serial = parts.length > 1 ? parts[1] : '';
        const custEquip = parts.length > 2 ? parts[2] : '';
        const matched = equipmentModels.find(m => m.name === modelName || m.abbr === modelName);
        const displayName = (matched && matched.abbr) ? matched.abbr : modelName;
        return { key: equipKey, displayName, serial, custEquip };
    });

    let matchedItem = items.find(it => it.key === targetEquip);
    if (!matchedItem) {
        const parts = targetEquip.split('::');
        const serialPart = parts.length > 1 ? parts[1] : '';
        if (serialPart) {
            matchedItem = items.find(it => it.serial === serialPart || it.key.includes(serialPart));
        }
    }
    if (!matchedItem) {
        matchedItem = items.find(it => targetEquip.includes(it.key) || it.key.includes(targetEquip));
    }

    if (matchedItem) {
        // 외부 링크나 URL 파라미터로 명시적 전달되었을 때만 검색창 필터링 적용
        if (!isRestoringLast) {
            const equipSearchInput = document.getElementById('data-equip-search');
            if (equipSearchInput) {
                equipSearchInput.value = matchedItem.serial || matchedItem.displayName;
                renderEquipList();
            }
        }

        // 장비 선택 및 데이터 시트 로드
        selectEquip(matchedItem);

        const activeEquipLi = document.querySelector(`#data-equip-list .data-list-item[data-equip-key="${matchedItem.key}"]`);
        if (activeEquipLi) {
            activeEquipLi.scrollIntoView({ block: 'nearest' });
        }
    }
}

/**
 * 오늘 날짜 YYYY-MM-DD 반환
 */
function getTodayString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 사업장 목록 렌더링
 */
function renderSiteList() {
    const siteListEl = document.getElementById('data-site-list');
    const siteCountEl = document.getElementById('data-site-count');
    const searchKeyword = (document.getElementById('data-site-search')?.value || '').trim().toLowerCase();

    if (!siteListEl) return;
    siteListEl.innerHTML = '';

    const deviceData = JSON.parse(localStorage.getItem('device_data')) || (window.storageData || {});
    const sites = Object.keys(deviceData).filter(s => s !== 'models' && s !== 'details').sort();

    const filteredSites = searchKeyword
        ? sites.filter(s => s.toLowerCase().includes(searchKeyword))
        : sites;

    if (siteCountEl) siteCountEl.textContent = filteredSites.length;

    if (filteredSites.length === 0) {
        siteListEl.innerHTML = '<li class="data-list-item" style="color:#8b949e; text-align:center; cursor:default;">사업장이 없습니다.</li>';
        return;
    }

    filteredSites.forEach(site => {
        const li = document.createElement('li');
        li.className = 'data-list-item';
        li.dataset.site = site;
        if (currentSelectedSite === site) li.classList.add('active');

        li.innerHTML = `
            <div class="data-item-main">
                <span>${escapeHtml(site)}</span>
            </div>
        `;

        li.addEventListener('click', () => {
            selectSite(site);
        });

        siteListEl.appendChild(li);
    });
}

/**
 * 사업장 선택
 */
function selectSite(site) {
    currentSelectedSite = site;
    currentSelectedEquip = null;

    saveLastDataState(site, '', currentDataMode);

    // UI 활성화 상태 갱신 (정확히 일치하는 사업장만 활성화)
    document.querySelectorAll('#data-site-list .data-list-item').forEach(el => {
        el.classList.toggle('active', el.dataset.site === site);
    });

    renderEquipList();
    showPlaceholderView();
}

/**
 * 장비 목록 렌더링
 */
function renderEquipList() {
    const equipListEl = document.getElementById('data-equip-list');
    const equipCountEl = document.getElementById('data-equip-count');
    const searchKeyword = (document.getElementById('data-equip-search')?.value || '').trim().toLowerCase();

    if (!equipListEl) return;
    equipListEl.innerHTML = '';

    if (!currentSelectedSite) {
        equipListEl.innerHTML = '<li class="data-list-item" style="color:#8b949e; text-align:center; cursor:default;">사업장을 먼저 선택하세요.</li>';
        if (equipCountEl) equipCountEl.textContent = '0';
        return;
    }

    const deviceData = JSON.parse(localStorage.getItem('device_data')) || (window.storageData || {});
    const rawEquips = deviceData[currentSelectedSite] || [];
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    // 기타(ETC) 및 폐기 장비 제외
    const validEquips = rawEquips.filter(e => !e.startsWith('기타(ETC)'));

    const items = validEquips.map(equipKey => {
        const parts = equipKey.split('::');
        const modelName = parts[0] || '';
        const serial = parts.length > 1 ? parts[1] : '';
        const custEquip = parts.length > 2 ? parts[2] : '';

        const matched = equipmentModels.find(m => m.name === modelName || m.abbr === modelName);
        const displayName = (matched && matched.abbr) ? matched.abbr : modelName;

        return {
            key: equipKey,
            displayName,
            serial,
            custEquip
        };
    });

    const filteredItems = searchKeyword
        ? items.filter(item => {
            const targetStr = `${item.displayName} ${item.serial} ${item.custEquip}`.toLowerCase();
            return targetStr.includes(searchKeyword);
        })
        : items;

    if (equipCountEl) equipCountEl.textContent = filteredItems.length;

    if (filteredItems.length === 0) {
        equipListEl.innerHTML = '<li class="data-list-item" style="color:#8b949e; text-align:center; cursor:default;">장비가 없습니다.</li>';
        return;
    }

    filteredItems.forEach(item => {
        const li = document.createElement('li');
        li.className = 'data-list-item';
        li.dataset.equipKey = item.key;
        if (currentSelectedEquip && currentSelectedEquip.key === item.key) li.classList.add('active');

        // 고객사 장비명이 없으면 시리얼 넘버 표시
        const subText = item.custEquip 
            ? `[${escapeHtml(item.custEquip)}]` 
            : (item.serial ? `[${escapeHtml(item.serial)}]` : '');

        li.innerHTML = `
            <div class="data-item-main">
                <span style="font-weight:600;">${escapeHtml(item.displayName)}</span>
                ${subText ? `<span style="color:#58a6ff; font-size:11px;">${subText}</span>` : ''}
            </div>
        `;

        li.addEventListener('click', () => {
            selectEquip(item);
        });

        equipListEl.appendChild(li);
    });
}

/**
 * 장비 선택 및 데이터 시트 화면 활성화
 */
function selectEquip(item) {
    currentSelectedEquip = item;
    currentSort = { key: null, direction: 'asc' };

    saveLastDataState(currentSelectedSite, item.key, currentDataMode);

    document.querySelectorAll('#data-equip-list .data-list-item').forEach(el => {
        el.classList.toggle('active', el.dataset.equipKey === item.key);
    });

    showContentView();
    loadEquipSheetData();
}

/**
 * 장비 미선택 뷰 전환
 */
function showPlaceholderView() {
    const placeholder = document.getElementById('data-placeholder-view');
    const content = document.getElementById('data-content-view');
    if (placeholder) placeholder.style.display = 'block';
    if (content) content.style.display = 'none';
}

/**
 * 장비 선택 데이터 시트 뷰 활성화
 */
function showContentView() {
    const placeholder = document.getElementById('data-placeholder-view');
    const content = document.getElementById('data-content-view');
    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = 'flex';

    // 장비 헤더 배지 업데이트
    if (currentSelectedEquip && currentSelectedSite) {
        document.getElementById('data-header-equip-title').textContent = currentSelectedEquip.displayName;
        document.getElementById('data-header-site-tag').textContent = currentSelectedSite;
        document.getElementById('data-header-serial-tag').textContent = currentSelectedEquip.serial ? `S/N: ${currentSelectedEquip.serial}` : '시리얼 없음';
        
        const custTag = document.getElementById('data-header-cust-tag');
        if (currentSelectedEquip.custEquip) {
            custTag.style.display = 'inline-flex';
            custTag.textContent = `호기명: ${currentSelectedEquip.custEquip}`;
        } else {
            custTag.style.display = 'none';
        }
    }

    // 모드에 따른 뷰 및 툴바 토글
    const rawView = document.getElementById('data-raw-view');
    const paramView = document.getElementById('data-param-view');
    const rawToolbar = document.getElementById('toolbar-raw-actions');
    const paramToolbar = document.getElementById('toolbar-param-actions');
    const btnParam = document.getElementById('btn-mode-param');
    const btnRaw = document.getElementById('btn-mode-raw');

    if (currentDataMode === 'param') {
        if (rawView) rawView.style.display = 'none';
        if (paramView) paramView.style.display = 'flex';
        if (rawToolbar) rawToolbar.style.display = 'none';
        if (paramToolbar) paramToolbar.style.display = 'flex';
        if (btnParam) btnParam.classList.add('active');
        if (btnRaw) btnRaw.classList.remove('active');
    } else {
        if (rawView) rawView.style.display = 'flex';
        if (paramView) paramView.style.display = 'none';
        if (rawToolbar) rawToolbar.style.display = 'flex';
        if (paramToolbar) paramToolbar.style.display = 'none';
        if (btnParam) btnParam.classList.remove('active');
        if (btnRaw) btnRaw.classList.add('active');
    }
}

let currentParamDate = null; // 현재 선택된 Parameter 점검 일자

/**
 * Parameter / Raw Data 모드 전환
 */
function switchDataMode(newMode) {
    if (!newMode || (newMode !== 'param' && newMode !== 'raw')) return;
    if (currentDataMode === newMode) return;

    currentDataMode = newMode;

    if (currentSelectedSite) {
        saveLastDataState(currentSelectedSite, currentSelectedEquip ? currentSelectedEquip.key : '', currentDataMode);
    }

    // 세그먼트 버튼 활성화 상태 갱신
    const btnParam = document.getElementById('btn-mode-param');
    const btnRaw = document.getElementById('btn-mode-raw');
    if (btnParam) btnParam.classList.toggle('active', newMode === 'param');
    if (btnRaw) btnRaw.classList.toggle('active', newMode === 'raw');

    // 뷰 및 툴바 가시성 전환
    const rawView = document.getElementById('data-raw-view');
    const paramView = document.getElementById('data-param-view');
    const rawToolbar = document.getElementById('toolbar-raw-actions');
    const paramToolbar = document.getElementById('toolbar-param-actions');

    if (newMode === 'param') {
        if (rawView) rawView.style.display = 'none';
        if (paramView) paramView.style.display = 'flex';
        if (rawToolbar) rawToolbar.style.display = 'none';
        if (paramToolbar) paramToolbar.style.display = 'flex';
    } else {
        if (rawView) rawView.style.display = 'flex';
        if (paramView) paramView.style.display = 'none';
        if (rawToolbar) rawToolbar.style.display = 'flex';
        if (paramToolbar) paramToolbar.style.display = 'none';
    }

    // 선택된 장비가 있다면 새 모드의 시트 데이터 로드
    if (currentSelectedSite && currentSelectedEquip) {
        loadEquipSheetData();
    }
}

/**
 * 장비별 저장된 시트 데이터 로드
 */
let dbSaveTimer = null;

/**
 * 장비별 저장된 시트 데이터 로드 (DB 우선 -> 로컬 백업)
 */
async function loadEquipSheetData() {
    if (!currentSelectedSite || !currentSelectedEquip) return;

    const mode = currentDataMode || 'raw';
    const storageKey = `equip_sheet_${currentSelectedSite}_${currentSelectedEquip.key}_${mode}`;
    const legacyStorageKey = `equip_sheet_${currentSelectedSite}_${currentSelectedEquip.key}`;
    const indicator = document.getElementById('data-save-indicator');
    const tableTag = document.getElementById('data-header-table-tag');

    if (indicator) indicator.innerHTML = '<span class="save-dot saving"></span> DB 조회 중...';

    let loadedFromDb = false;

    try {
        const res = await fetch('/api/datasheet/load', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': (typeof getCookie === 'function' ? getCookie('csrf_token') : '')
            },
            body: JSON.stringify({
                model_abbr: currentSelectedEquip.displayName,
                cust_equip: currentSelectedEquip.custEquip,
                serial: currentSelectedEquip.serial,
                data_type: mode
            })
        });

        const data = await res.json();

        if (data.status === 'success') {
            if (tableTag && data.table_name) {
                tableTag.style.display = 'inline-flex';
                tableTag.textContent = `DB: ${data.table_name}`;
                tableTag.title = `dbwithtech001: \`${data.table_name}\``;
            }

            if (data.exists && (data.columns.length > 0 || data.rows.length > 0)) {
                currentSheetData = {
                    columns: data.columns || [],
                    rows: data.rows || []
                };
                localStorage.setItem(storageKey, JSON.stringify(currentSheetData));
                loadedFromDb = true;
                if (indicator) indicator.innerHTML = '<span class="save-dot"></span> DB 로드 완료';
            }
        }
    } catch (err) {
        console.warn('DB 시트 데이터 로드 실패, 로컬 스토리지로 대체합니다:', err);
    }

    // DB에 데이터가 없거나 조회 실패한 경우 로컬스토리지 확인
    if (!loadedFromDb) {
        let savedStr = localStorage.getItem(storageKey);
        // raw 모드일 경우 기존 키 데이터 하위 호환
        if (!savedStr && mode === 'raw') {
            savedStr = localStorage.getItem(legacyStorageKey);
        }

        if (savedStr) {
            try {
                currentSheetData = JSON.parse(savedStr);
                if (!Array.isArray(currentSheetData.columns)) currentSheetData.columns = [];
                if (!Array.isArray(currentSheetData.rows)) currentSheetData.rows = [];
                // 로컬 데이터를 DB에 반영하여 테이블 생성
                saveCurrentSheetData(false);
            } catch (e) {
                initDefaultSheet();
            }
        } else {
            initDefaultSheet();
        }
        if (indicator) indicator.innerHTML = '<span class="save-dot"></span> 자동 저장됨';
    }

    renderSheetTable();
}

/**
 * 새 장비용 기본 시트 템플릿 생성 (모드별 차별화)
 */
function initDefaultSheet() {
    const isParam = (currentDataMode === 'param');
    const defaultCols = isParam 
        ? ['파라미터 항목', '기준값', '측정값', '비고']
        : ['온도 (℃)', '압력 (kPa)', '전압 (V)', '비고'];

    const initialValues = {};
    defaultCols.forEach(c => initialValues[c] = '');

    currentSheetData = {
        columns: defaultCols,
        rows: [
            {
                id: 'row_' + Date.now(),
                date: getTodayString(),
                values: initialValues
            }
        ]
    };
    saveCurrentSheetData(false);
}

/**
 * 시트 데이터 저장 (LocalStorage + DB 비동기 동기화)
 */
function saveCurrentSheetData(showIndicator = true, resetTable = false) {
    if (!currentSelectedSite || !currentSelectedEquip) return;

    const mode = currentDataMode || 'raw';
    const storageKey = `equip_sheet_${currentSelectedSite}_${currentSelectedEquip.key}_${mode}`;
    localStorage.setItem(storageKey, JSON.stringify(currentSheetData));

    const indicator = document.getElementById('data-save-indicator');
    if (showIndicator && indicator) {
        indicator.innerHTML = '<span class="save-dot saving"></span> DB 저장 중...';
    }

    // 디바운스(400ms)로 빠른 타이핑 중 잦은 쿼리 방지 (resetTable인 경우 즉시 전송)
    clearTimeout(dbSaveTimer);
    const delay = resetTable ? 0 : 400;
    dbSaveTimer = setTimeout(async () => {
        try {
            const res = await fetch('/api/datasheet/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': (typeof getCookie === 'function' ? getCookie('csrf_token') : '')
                },
                body: JSON.stringify({
                    site: currentSelectedSite,
                    model_abbr: currentSelectedEquip.displayName,
                    cust_equip: currentSelectedEquip.custEquip,
                    serial: currentSelectedEquip.serial,
                    columns: currentSheetData.columns || [],
                    rows: currentSheetData.rows || [],
                    reset_table: resetTable,
                    data_type: mode
                })
            });

            const result = await res.json();
            if (result.status === 'success') {
                const tableTag = document.getElementById('data-header-table-tag');
                if (tableTag && result.table_name) {
                    tableTag.style.display = 'inline-flex';
                    tableTag.textContent = `DB: ${result.table_name}`;
                    tableTag.title = `dbwithtech001: \`${result.table_name}\``;
                }
                if (indicator) {
                    indicator.innerHTML = '<span class="save-dot"></span> DB 저장됨';
                }
            } else {
                if (indicator) {
                    indicator.innerHTML = '<span class="save-dot" style="background:#f85149;"></span> DB 저장 오류';
                }
            }
        } catch (e) {
            console.error('DB 동기화 저장 실패:', e);
            if (indicator) {
                indicator.innerHTML = '<span class="save-dot" style="background:#d29922;"></span> 로컬에 저장됨';
            }
        }
    }, delay);
}

/**
/**
 * 정렬 상태 관리 객체
 */
let currentSort = {
    key: null,        // null, '__no__', '__date__', 또는 컬럼명
    direction: 'asc'  // 'asc' 또는 'desc'
};

/**
 * 컬럼 헤더 클릭 시 정렬 토글
 */
window.toggleSheetSort = function(key) {
    if (!currentSheetData || !Array.isArray(currentSheetData.rows) || currentSheetData.rows.length === 0) return;

    if (currentSort.key === key) {
        currentSort.direction = (currentSort.direction === 'asc') ? 'desc' : 'asc';
    } else {
        currentSort.key = key;
        currentSort.direction = 'asc';
    }

    const isAsc = currentSort.direction === 'asc';

    if (key === '__no__') {
        currentSheetData.rows.reverse();
    } else {
        currentSheetData.rows.sort((a, b) => {
            let valA, valB;

            if (key === '__date__') {
                valA = a.date || '';
                valB = b.date || '';
            } else {
                valA = (a.values && a.values[key] !== undefined) ? a.values[key] : '';
                valB = (b.values && b.values[key] !== undefined) ? b.values[key] : '';
            }

            const aEmpty = (valA === '' || valA === null || valA === undefined);
            const bEmpty = (valB === '' || valB === null || valB === undefined);
            if (aEmpty && !bEmpty) return 1;
            if (!aEmpty && bEmpty) return -1;
            if (aEmpty && bEmpty) return 0;

            const numA = Number(valA);
            const numB = Number(valB);
            const isNumA = !isNaN(numA) && typeof valA !== 'boolean' && String(valA).trim() !== '';
            const isNumB = !isNaN(numB) && typeof valB !== 'boolean' && String(valB).trim() !== '';

            let cmp = 0;
            if (isNumA && isNumB) {
                cmp = numA - numB;
            } else {
                cmp = String(valA).localeCompare(String(valB), 'ko-KR', { numeric: true, sensitivity: 'base' });
            }

            return isAsc ? cmp : -cmp;
        });
    }

    saveCurrentSheetData(true);
    renderSheetTable();
};

/**
 * 통합 시트 테이블 렌더링 (모드 분기)
 */
function renderSheetTable() {
    if (currentDataMode === 'param') {
        renderParamView();
    } else {
        renderRawSheetTable();
    }
}

/**
 * Parameter 마스터-디테일 뷰 렌더링 (좌측 슬림 날짜 리스트 + 우측 파라미터 점검 테이블)
 */
function renderParamView() {
    const rawView = document.getElementById('data-raw-view');
    const paramView = document.getElementById('data-param-view');
    const rawToolbar = document.getElementById('toolbar-raw-actions');
    const paramToolbar = document.getElementById('toolbar-param-actions');

    if (rawView) rawView.style.display = 'none';
    if (paramView) paramView.style.display = 'flex';
    if (rawToolbar) rawToolbar.style.display = 'none';
    if (paramToolbar) paramToolbar.style.display = 'flex';

    // 파라미터 기본 컬럼 보장
    if (!currentSheetData.columns || currentSheetData.columns.length === 0 || !currentSheetData.columns.includes('단위')) {
        currentSheetData.columns = ['파라미터 항목', '단위', '기준값', '측정값', '결과', '비고'];
    }

    // 1. 존재하는 모든 날짜 수집
    const allRows = currentSheetData.rows || [];
    let dates = Array.from(new Set(allRows.map(r => r.date).filter(Boolean))).sort().reverse();

    // 등록된 날짜가 하나도 없는 경우 오늘 날짜 기본 세팅
    if (dates.length === 0) {
        const today = getTodayString();
        dates = [today];
        currentSheetData.rows = [
            { id: 'row_' + Date.now() + '_1', date: today, values: { '파라미터 항목': 'Laser Power', '단위': 'W', '기준값': '100 ± 5 W', '측정값': '', '결과': '양호', '비고': '' } },
            { id: 'row_' + Date.now() + '_2', date: today, values: { '파라미터 항목': 'Chamber Temp', '단위': '℃', '기준값': '25 ± 2 ℃', '측정값': '', '결과': '양호', '비고': '' } },
            { id: 'row_' + Date.now() + '_3', date: today, values: { '파라미터 항목': 'Supply Pressure', '단위': 'kPa', '기준값': '0.5 ± 0.05 kPa', '측정값': '', '결과': '양호', '비고': '' } }
        ];
        saveCurrentSheetData(false);
    }

    // 현재 선택된 날짜 유효성 확인
    if (!currentParamDate || !dates.includes(currentParamDate)) {
        currentParamDate = dates[0];
    }

    // 2. 좌측 날짜 리스트 렌더링 (너비 작게 슬림형)
    const dateListEl = document.getElementById('data-param-date-list');
    if (dateListEl) {
        dateListEl.innerHTML = '';
        dates.forEach(dateStr => {
            const li = document.createElement('li');
            li.className = 'data-param-date-item' + (dateStr === currentParamDate ? ' active' : '');
            li.innerHTML = `
                <span>📅 ${dateStr}</span>
                <button type="button" class="btn-del-param-date" title="이 일자 전체 데이터 삭제" onclick="event.stopPropagation(); deleteParamDate('${dateStr}')">&times;</button>
            `;
            li.addEventListener('click', () => {
                currentParamDate = dateStr;
                renderParamView();
            });
            dateListEl.appendChild(li);
        });
    }

    // 3. 우측 타이틀 갱신
    const titleEl = document.getElementById('data-param-selected-date-title');
    if (titleEl) {
        titleEl.textContent = `📅 ${currentParamDate} 점검 파라미터`;
    }

    // 4. 우측 테이블 본문 렌더링
    const tbody = document.getElementById('data-param-tbody');
    if (!tbody) return;

    const currentRows = allRows.filter(r => r.date === currentParamDate);

    if (currentRows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="sheet-empty-state" style="padding: 30px; text-align: center; color: #8b949e;">
                    선택된 일자(${currentParamDate})에 기록된 파라미터 항목이 없습니다.<br>
                    우측 상단의 <strong>[➕ 항목 추가]</strong> 버튼을 눌러 점검 항목을 추가하세요.
                </td>
            </tr>
        `;
        return;
    }

    const PRESET_UNITS = ['%', 'ppm', 'ppb', '℃', 'ml/min', 'LPM', '유무'];

    let tbodyHtml = '';
    currentRows.forEach((row, idx) => {
        const vals = row.values || {};
        const paramName = vals['파라미터 항목'] || vals['항목'] || '';
        const unitVal = vals['단위'] || '';
        const standardVal = vals['기준값'] || vals['기준'] || '';
        const measuredVal = vals['측정값'] || vals['측정'] || '';
        const resultVal = vals['결과'] || (unitVal === '유무' ? '적합' : '양호');
        const memoVal = vals['비고'] || '';

        const isCustomUnit = unitVal !== '' && !PRESET_UNITS.includes(unitVal) && unitVal !== '도씨';
        const parsedSpec = parseParamStandard(standardVal);

        tbodyHtml += `
            <tr data-row-id="${row.id}">
                <td style="text-align: center; color: #8b949e; user-select: none; font-size: 11px;">${idx + 1}</td>
                <td>
                    <input type="text" class="data-param-input" value="${escapeHtml(paramName)}" 
                           placeholder="파라미터 항목명" onchange="updateParamCell('${row.id}', '파라미터 항목', this.value)">
                </td>
                <td>
                    <div class="data-param-unit-cell">
                        <select class="data-param-unit-select" style="${isCustomUnit ? 'display: none;' : ''}" 
                                onchange="handleParamUnitSelectChange('${row.id}', this)">
                            <option value="" ${!unitVal ? 'selected' : ''}>-</option>
                            <option value="%" ${unitVal === '%' ? 'selected' : ''}>%</option>
                            <option value="ppm" ${unitVal === 'ppm' ? 'selected' : ''}>ppm</option>
                            <option value="ppb" ${unitVal === 'ppb' ? 'selected' : ''}>ppb</option>
                            <option value="℃" ${unitVal === '℃' || unitVal === '도씨' ? 'selected' : ''}>℃ (도씨)</option>
                            <option value="ml/min" ${unitVal === 'ml/min' ? 'selected' : ''}>ml/min</option>
                            <option value="LPM" ${unitVal === 'LPM' ? 'selected' : ''}>LPM</option>
                            <option value="유무" ${unitVal === '유무' ? 'selected' : ''}>유무</option>
                            <option value="__custom__" ${isCustomUnit ? 'selected' : ''}>직접입력</option>
                        </select>
                        <div class="data-param-unit-custom-wrap" style="${isCustomUnit ? 'display: flex;' : 'display: none;'}">
                            <input type="text" class="data-param-input data-param-unit-custom-input" value="${escapeHtml(unitVal)}" 
                                   placeholder="단위 입력" onchange="applyUnitToRow('${row.id}', this.value)">
                            <button type="button" class="btn-unit-preset-toggle" title="단위 목록에서 선택" onclick="toggleParamUnitSelect('${row.id}')">▾</button>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="data-param-spec-cell">
                        <!-- 1. 유무 전용 일반 텍스트 입력창 (unitVal === '유무') -->
                        <div class="data-param-text-spec-wrap" style="${unitVal === '유무' ? 'display: flex;' : 'display: none;'}">
                            <input type="text" class="data-param-input data-param-text-spec-val" value="${escapeHtml(standardVal)}" 
                                   placeholder="기준 텍스트 (예: 무, 정상)" 
                                   onchange="updateParamCell('${row.id}', '기준값', this.value); autoEvaluateRowResult('${row.id}');">
                        </div>

                        <!-- 2. 일반 수치/부등호/±/~ 복합 입력창 (unitVal !== '유무') -->
                        <div class="data-param-numeric-spec-wrap" style="${unitVal === '유무' ? 'display: none;' : 'display: flex;'}">
                            <select class="data-param-op-select" title="부등호/플러스마이너스/범위 기호 선택" 
                                    onchange="handleParamSpecOpChange('${row.id}', this.value, this)">
                                <option value="" ${!parsedSpec.op ? 'selected' : ''}>-</option>
                                <option value="±" ${parsedSpec.op === '±' ? 'selected' : ''}>±</option>
                                <option value="~" ${parsedSpec.op === '~' ? 'selected' : ''}>~</option>
                                <option value="≥" ${parsedSpec.op === '≥' ? 'selected' : ''}>≥</option>
                                <option value="≤" ${parsedSpec.op === '≤' ? 'selected' : ''}>≤</option>
                                <option value=">" ${parsedSpec.op === '>' ? 'selected' : ''}>&gt;</option>
                                <option value="<" ${parsedSpec.op === '<' ? 'selected' : ''}>&lt;</option>
                                <option value="=" ${parsedSpec.op === '=' ? 'selected' : ''}>=</option>
                            </select>
                            
                            <!-- 일반 단일 입력 (op !== '±' && op !== '~') -->
                            <div class="data-param-single-val-wrap" style="${(parsedSpec.op === '±' || parsedSpec.op === '~') ? 'display: none;' : 'display: flex;'}">
                                <input type="text" class="data-param-input data-param-spec-val" value="${escapeHtml(parsedSpec.val)}" 
                                       placeholder="기준값 (예: 100)" 
                                       onchange="handleParamSpecValChange('${row.id}', this.closest('.data-param-numeric-spec-wrap').querySelector('.data-param-op-select').value, this.value, this.closest('.data-param-numeric-spec-wrap').querySelector('.data-param-op-select'), this)">
                            </div>

                            <!-- ± 전용 2개 수치 입력 (기준값 ± 오차) -->
                            <div class="data-param-pm-val-wrap" style="${parsedSpec.op === '±' ? 'display: flex;' : 'display: none;'}">
                                <input type="text" class="data-param-input data-param-spec-center" value="${escapeHtml(parsedSpec.center || '')}" 
                                       placeholder="기준(100)" title="기준값 (중심값)"
                                       onchange="handleParamPmChange('${row.id}', this)">
                                <span class="data-param-pm-divider">±</span>
                                <input type="text" class="data-param-input data-param-spec-tol" value="${escapeHtml(parsedSpec.tol || '')}" 
                                       placeholder="오차(5)" title="오차 허용 범위"
                                       onchange="handleParamPmChange('${row.id}', this)">
                            </div>

                            <!-- ~ 전용 2개 수치 입력 (최소 ~ 최대 범위) -->
                            <div class="data-param-range-val-wrap" style="${parsedSpec.op === '~' ? 'display: flex;' : 'display: none;'}">
                                <input type="text" class="data-param-input data-param-spec-min" value="${escapeHtml(parsedSpec.min || '')}" 
                                       placeholder="최소(10)" title="최솟값 (시작)"
                                       onchange="handleParamRangeChange('${row.id}', this)">
                                <span class="data-param-range-divider">~</span>
                                <input type="text" class="data-param-input data-param-spec-max" value="${escapeHtml(parsedSpec.max || '')}" 
                                       placeholder="최대(20)" title="최댓값 (끝)"
                                       onchange="handleParamRangeChange('${row.id}', this)">
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <input type="text" class="data-param-input data-param-measured-val" value="${escapeHtml(measuredVal)}" 
                           placeholder="${unitVal === '유무' ? '측정값 (예: 무)' : '측정값 (예: 99.8)'}" 
                           onchange="handleParamMeasuredChange('${row.id}', this.value)">
                </td>
                <td>
                    <!-- 1. 유무 전용: 적합 / 부적합 선택 드롭다운 -->
                    <div class="data-param-result-select-wrap" style="${unitVal === '유무' ? 'display: block;' : 'display: none;'}">
                        <select class="data-param-select ${resultVal === '적합' ? 'result-good' : (resultVal === '부적합' ? 'result-bad' : '')}" 
                                onchange="updateParamCell('${row.id}', '결과', this.value); this.className='data-param-select ' + (this.value==='적합'?'result-good':(this.value==='부적합'?'result-bad':''));">
                            <option value="적합" ${resultVal === '적합' ? 'selected' : ''}>적합</option>
                            <option value="부적합" ${resultVal === '부적합' ? 'selected' : ''}>부적합</option>
                            <option value="N/A" ${resultVal === 'N/A' ? 'selected' : ''}>N/A</option>
                        </select>
                    </div>

                    <!-- 2. 일반 상황: 드롭다운 없이 자동 판정 결과 뱃지 (양호 / 불량) -->
                    <div class="data-param-result-badge-wrap" style="${unitVal === '유무' ? 'display: none;' : 'display: flex;'}">
                        <span class="data-param-result-badge ${resultVal === '양호' ? 'result-good' : (resultVal === '불량' ? 'result-bad' : '')}">
                            ${measuredVal ? (resultVal || '양호') : '-'}
                        </span>
                    </div>
                </td>
                <td>
                    <input type="text" class="data-param-input" value="${escapeHtml(memoVal)}" 
                           placeholder="특이사항 메모" onchange="updateParamCell('${row.id}', '비고', this.value)">
                </td>
                <td style="text-align: center;">
                    <button type="button" class="data-param-row-del-btn" title="이 항목 삭제" onclick="deleteParamRow('${row.id}')">&times;</button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = tbodyHtml;
}

/**
 * 기존 문자열에서 특정 단위 또는 기본 프리셋 단위 제거
 */
function stripUnitFromValue(valStr, unitToRemove) {
    if (!valStr) return '';
    let s = String(valStr).trim();
    if (!s) return '';

    if (unitToRemove) {
        const uEsc = unitToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp(`\\s*${uEsc}$`, 'i'), '').trim();
    }
    const presets = ['ml/min', 'LPM', 'ppm', 'ppb', '%', '℃', '도씨', 'kPa', 'W'];
    for (const p of presets) {
        const pEsc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp(`\\s*${pEsc}$`, 'i'), '').trim();
    }
    return s;
}

/**
 * 값에 단위 자동 부착 (이미 단위가 붙어있으면 중복 부착 방지)
 */
function attachUnitToValue(valStr, unit) {
    if (!valStr) return '';
    const s = String(valStr).trim();
    if (!s || !unit || unit === '유무') return s;

    const unitEsc = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\s*${unitEsc}$`, 'i');
    if (regex.test(s)) {
        return s;
    }

    return `${s} ${unit}`;
}

/**
 * 행의 단위를 변경하고 기준값/측정값에 단위를 동기화
 */
function applyUnitToRow(rowId, newUnit) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (!row) return;
    if (!row.values) row.values = {};

    const oldUnit = row.values['단위'] || '';
    const unit = (newUnit || '').trim();
    row.values['단위'] = unit;

    const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);

    if (unit === '유무') {
        // 유무 모드로 전환
        let standardVal = row.values['기준값'] || row.values['기준'] || '';
        const strippedStd = stripUnitFromValue(standardVal, oldUnit);
        row.values['기준값'] = strippedStd;

        let measuredVal = row.values['측정값'] || row.values['측정'] || '';
        const strippedMeas = stripUnitFromValue(measuredVal, oldUnit);
        row.values['측정값'] = strippedMeas;

        let currentResult = row.values['결과'] || '양호';
        if (currentResult === '양호') currentResult = '적합';
        else if (currentResult === '불량') currentResult = '부적합';
        else if (!currentResult || currentResult === '-') currentResult = '적합';
        row.values['결과'] = currentResult;

        saveCurrentSheetData(false);
        renderParamView();
        return;
    }

    if (oldUnit === '유무' && unit !== '유무') {
        // 유무 모드에서 일반 수치 모드로 복귀
        let currentResult = row.values['결과'] || '적합';
        if (currentResult === '적합') currentResult = '양호';
        else if (currentResult === '부적합') currentResult = '불량';
        row.values['결과'] = currentResult;

        let measuredVal = row.values['측정값'] || row.values['측정'] || '';
        if (measuredVal && unit) {
            row.values['측정값'] = attachUnitToValue(stripUnitFromValue(measuredVal, oldUnit), unit);
        }
        let standardVal = row.values['기준값'] || row.values['기준'] || '';
        if (standardVal && unit) {
            row.values['기준값'] = attachUnitToValue(stripUnitFromValue(standardVal, oldUnit), unit);
        }

        saveCurrentSheetData(false);
        renderParamView();
        return;
    }

    // 일반 단위 간 변경 (예: % -> ppm)
    let measuredVal = row.values['측정값'] || row.values['측정'] || '';
    if (measuredVal) {
        const stripped = stripUnitFromValue(measuredVal, oldUnit);
        const updated = unit ? attachUnitToValue(stripped, unit) : stripped;
        row.values['측정값'] = updated;
        if (tr) {
            const mInput = tr.querySelector('.data-param-measured-val');
            if (mInput) mInput.value = updated;
        }
    }

    let standardVal = row.values['기준값'] || row.values['기준'] || '';
    if (standardVal) {
        const parsed = parseParamStandard(standardVal);
        let updatedVal = '';
        if (parsed.op === '±' && (parsed.center || parsed.tol)) {
            const strippedCenter = stripUnitFromValue(parsed.center, oldUnit);
            const strippedTol = stripUnitFromValue(parsed.tol, oldUnit);
            if (strippedCenter && strippedTol) {
                updatedVal = `${strippedCenter} ± ${strippedTol}`;
            } else if (strippedCenter) {
                updatedVal = strippedCenter;
            } else if (strippedTol) {
                updatedVal = `± ${strippedTol}`;
            }
            if (unit && updatedVal) updatedVal = `${updatedVal} ${unit}`;
            row.values['기준값'] = updatedVal;
            if (tr) {
                const cInput = tr.querySelector('.data-param-spec-center');
                const tInput = tr.querySelector('.data-param-spec-tol');
                if (cInput) cInput.value = strippedCenter;
                if (tInput) tInput.value = strippedTol;
            }
        } else if (parsed.op === '~' && (parsed.min || parsed.max)) {
            const strippedMin = stripUnitFromValue(parsed.min, oldUnit);
            const strippedMax = stripUnitFromValue(parsed.max, oldUnit);
            if (strippedMin && strippedMax) {
                updatedVal = `${strippedMin} ~ ${strippedMax}`;
            } else if (strippedMin) {
                updatedVal = `${strippedMin} ~`;
            } else if (strippedMax) {
                updatedVal = `~ ${strippedMax}`;
            }
            if (unit && updatedVal) updatedVal = `${updatedVal} ${unit}`;
            row.values['기준값'] = updatedVal;
            if (tr) {
                const minInput = tr.querySelector('.data-param-spec-min');
                const maxInput = tr.querySelector('.data-param-spec-max');
                if (minInput) minInput.value = strippedMin;
                if (maxInput) maxInput.value = strippedMax;
            }
        } else {
            const strippedVal = stripUnitFromValue(parsed.val, oldUnit);
            updatedVal = unit ? attachUnitToValue(strippedVal, unit) : strippedVal;
            const combined = parsed.op ? (updatedVal ? `${parsed.op} ${updatedVal}` : parsed.op) : updatedVal;
            row.values['기준값'] = combined;
            if (tr) {
                const sInput = tr.querySelector('.data-param-spec-val');
                if (sInput) sInput.value = updatedVal;
            }
        }
    }

    autoEvaluateRowResult(rowId);
    saveCurrentSheetData(false);
}

/**
 * 단위 선택 드롭다운 변경 처리
 */
function handleParamUnitSelectChange(rowId, selectEl) {
    if (selectEl.value === '__custom__') {
        const cell = selectEl.closest('.data-param-unit-cell');
        if (cell) {
            selectEl.style.display = 'none';
            const customWrap = cell.querySelector('.data-param-unit-custom-wrap');
            if (customWrap) {
                customWrap.style.display = 'flex';
                const input = customWrap.querySelector('.data-param-unit-custom-input');
                if (input) {
                    input.focus();
                }
            }
        }
    } else {
        applyUnitToRow(rowId, selectEl.value);
    }
}

/**
 * 직접입력 모드에서 기본 드롭다운 선택으로 복귀
 */
function toggleParamUnitSelect(rowId) {
    const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
    if (!tr) return;
    const cell = tr.querySelector('.data-param-unit-cell');
    if (!cell) return;
    const select = cell.querySelector('.data-param-unit-select');
    const customWrap = cell.querySelector('.data-param-unit-custom-wrap');
    if (select && customWrap) {
        customWrap.style.display = 'none';
        select.style.display = 'block';
        select.value = '';
        applyUnitToRow(rowId, '');
    }
}

/**
 * 기준값 문자열에서 부등호/플러스마이너스 기호와 수치/내용 분리 (± 2개 수치 지원)
 */
function parseParamStandard(standardVal) {
    const s = String(standardVal || '').trim();
    if (!s) return { op: '', val: '', center: '', tol: '', min: '', max: '' };

    // 1. "A ± B" 형태 (예: "100 ± 5", "100+-5", "100 ± 5 ppm")
    const matchPm = s.match(/(?:^|[±≥≤><=]\s*)([+-]?\d+(?:\.\d+)?)\s*(?:±|\+-)\s*([+-]?\d+(?:\.\d+)?)/);
    if (matchPm) {
        return {
            op: '±',
            center: matchPm[1],
            tol: matchPm[2],
            val: `${matchPm[1]} ± ${matchPm[2]}`,
            min: '',
            max: ''
        };
    }

    // 2. "± B" 단독 형태 (예: "± 5", "± 0.05", "+- 2")
    const matchOnlyTol = s.match(/^(?:±|\+-)\s*([+-]?\d+(?:\.\d+)?)/);
    if (matchOnlyTol) {
        return {
            op: '±',
            center: '',
            tol: matchOnlyTol[1],
            val: `± ${matchOnlyTol[1]}`,
            min: '',
            max: ''
        };
    }

    // 3. "A ~ B" 범위 형태 (예: "10 ~ 20", "10~20", "-5 ~ 15")
    const matchRange = s.match(/(?:^|[~]\s*)([+-]?\d+(?:\.\d+)?)\s*(?:~|to)\s*([+-]?\d+(?:\.\d+)?)/i);
    if (matchRange) {
        return {
            op: '~',
            min: matchRange[1],
            max: matchRange[2],
            val: `${matchRange[1]} ~ ${matchRange[2]}`,
            center: '',
            tol: ''
        };
    }

    // 4. "~ B" 단독 상한 범위 형태 (예: "~ 20", "~20")
    const matchOnlyMax = s.match(/^~\s*([+-]?\d+(?:\.\d+)?)/);
    if (matchOnlyMax) {
        return {
            op: '~',
            min: '',
            max: matchOnlyMax[1],
            val: `~ ${matchOnlyMax[1]}`,
            center: '',
            tol: ''
        };
    }

    // 5. "A ~" 단독 하한 범위 형태 (예: "10 ~", "10~")
    const matchOnlyMin = s.match(/^([+-]?\d+(?:\.\d+)?)\s*~/);
    if (matchOnlyMin) {
        return {
            op: '~',
            min: matchOnlyMin[1],
            max: '',
            val: `${matchOnlyMin[1]} ~`,
            center: '',
            tol: ''
        };
    }

    // 6. 단독 "~"
    if (s === '~') {
        return { op: '~', val: '~', min: '', max: '', center: '', tol: '' };
    }

    // 7. 선두에 부등호 기호가 오는 경우 (예: ">= 100", "≥ 100", "<= 20", "≤ 20", "> 10", "< 5", "= 50")
    const match = s.match(/^([±≥≤><=~]|>=|<=|\+-)\s*(.*)$/);
    if (match) {
        let op = match[1];
        if (op === '>=') op = '≥';
        else if (op === '<=') op = '≤';
        else if (op === '+-') op = '±';
        return { op, val: match[2].trim(), center: '', tol: '', min: '', max: '' };
    }

    return { op: '', val: s, center: '', tol: '', min: '', max: '' };
}

/**
 * 측정값이 기준값 범위/조건에 부합하는지 자동 판정
 * @param {string} standardStr 기준값 (예: "100 ± 5", "≥ 100", "± 5", "0.5 ± 0.05", "10 ~ 20")
 * @param {string} measuredStr 측정값 (예: "99.8", "100", "OK")
 * @returns {boolean|null} true: 합격(양호/적합), false: 불합격(불량/부적합), null: 판정 보류
 */
function evaluateParamResult(standardStr, measuredStr) {
    if (measuredStr === undefined || measuredStr === null) return null;
    const mStr = String(measuredStr).trim();
    if (mStr === '') return null; // 측정값 미입력 시 판정 보류

    const sStr = String(standardStr || '').trim();
    if (!sStr) return null; // 기준값 미입력 시 판정 보류

    const measuredNum = parseFloat(mStr);
    const isMeasuredNum = !isNaN(measuredNum);

    if (isMeasuredNum) {
        // 1. "A ± B" 형태 (예: 100 ± 5, 25 ± 2, 0.5 ± 0.05, 100+-5)
        const matchTol = sStr.match(/(?:^|[±≥≤><=]\s*)([+-]?\d+(?:\.\d+)?)\s*(?:±|\+-)\s*([+-]?\d+(?:\.\d+)?)/);
        if (matchTol) {
            const center = parseFloat(matchTol[1]);
            const tol = Math.abs(parseFloat(matchTol[2]));
            return (measuredNum >= center - tol - 1e-9) && (measuredNum <= center + tol + 1e-9);
        }

        // 2. "± B" 단독 형태 (예: ± 5, ± 0.05, +- 2)
        const matchOnlyTol = sStr.match(/^(?:±|\+-)\s*([+-]?\d+(?:\.\d+)?)/);
        if (matchOnlyTol) {
            const tol = Math.abs(parseFloat(matchOnlyTol[1]));
            return (measuredNum >= -tol - 1e-9) && (measuredNum <= tol + 1e-9);
        }

        // 3. "A ~ B" 범위 형태 (예: 10 ~ 20, 10 to 20, 10~20)
        const matchRange = sStr.match(/([+-]?\d+(?:\.\d+)?)\s*(?:~|to)\s*([+-]?\d+(?:\.\d+)?)/i);
        if (matchRange) {
            const minV = Math.min(parseFloat(matchRange[1]), parseFloat(matchRange[2]));
            const maxV = Math.max(parseFloat(matchRange[1]), parseFloat(matchRange[2]));
            return (measuredNum >= minV - 1e-9) && (measuredNum <= maxV + 1e-9);
        }

        // 3-1. "~ B" 단독 상한 범위 형태 (예: ~ 20)
        const matchOnlyMax = sStr.match(/^~\s*([+-]?\d+(?:\.\d+)?)/);
        if (matchOnlyMax) {
            return measuredNum <= parseFloat(matchOnlyMax[1]) + 1e-9;
        }

        // 3-2. "A ~" 단독 하한 범위 형태 (예: 10 ~)
        const matchOnlyMin = sStr.match(/^([+-]?\d+(?:\.\d+)?)\s*~/);
        if (matchOnlyMin) {
            return measuredNum >= parseFloat(matchOnlyMin[1]) - 1e-9;
        }

        // 4. 부등호 형태
        const matchGte = sStr.match(/(?:≥|>=)\s*([+-]?\d+(?:\.\d+)?)/);
        if (matchGte) {
            return measuredNum >= parseFloat(matchGte[1]) - 1e-9;
        }

        const matchLte = sStr.match(/(?:≤|<=)\s*([+-]?\d+(?:\.\d+)?)/);
        if (matchLte) {
            return measuredNum <= parseFloat(matchLte[1]) + 1e-9;
        }

        const matchGt = sStr.match(/^>\s*([+-]?\d+(?:\.\d+)?)/);
        if (matchGt) {
            return measuredNum > parseFloat(matchGt[1]) + 1e-9;
        }

        const matchLt = sStr.match(/^<\s*([+-]?\d+(?:\.\d+)?)/);
        if (matchLt) {
            return measuredNum < parseFloat(matchLt[1]) - 1e-9;
        }

        const matchEq = sStr.match(/^={1,2}\s*([+-]?\d+(?:\.\d+)?)/);
        if (matchEq) {
            return Math.abs(measuredNum - parseFloat(matchEq[1])) <= 1e-9;
        }

        // 5. 단일 숫자 (예: 100)
        const matchNum = sStr.match(/^([+-]?\d+(?:\.\d+)?)/);
        if (matchNum) {
            return Math.abs(measuredNum - parseFloat(matchNum[1])) <= 1e-9;
        }
    }

    // 6. 텍스트 직접 비교 (유/무/있음/없음 동의어 정규화 지원)
    const norm = (val) => {
        let t = String(val || '').trim().toLowerCase();
        if (t === '없음' || t === '무') return 'none';
        if (t === '있음' || t === '유') return 'exist';
        return t;
    };
    return norm(sStr) === norm(mStr);
}

/**
 * 행의 기준값과 측정값을 비교하여 결과를 자동 판정 및 갱신
 */
function autoEvaluateRowResult(rowId) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (!row || !row.values) return;

    const unit = row.values['단위'] || '';
    const standardVal = row.values['기준값'] || row.values['기준'] || '';
    const measuredVal = row.values['측정값'] || row.values['측정'] || '';

    const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);

    if (unit === '유무') {
        // 유무 모드: 기준값과 측정값 비교하여 드롭다운 자동 동기화 (사용자가 변경도 가능)
        if (measuredVal && measuredVal.trim()) {
            const evalResult = evaluateParamResult(standardVal, measuredVal);
            if (evalResult !== null) {
                const newResult = evalResult ? '적합' : '부적합';
                row.values['결과'] = newResult;
                saveCurrentSheetData(false);
                if (tr) {
                    const select = tr.querySelector('.data-param-select');
                    if (select) {
                        select.value = newResult;
                        select.className = 'data-param-select ' + (evalResult ? 'result-good' : 'result-bad');
                    }
                }
            }
        }
    } else {
        // 일반 수치 모드: 드롭다운 없이 결과 뱃지 업데이트 (양호 / 불량)
        if (!measuredVal || !measuredVal.trim()) {
            row.values['결과'] = '';
            saveCurrentSheetData(false);
            if (tr) {
                const badge = tr.querySelector('.data-param-result-badge');
                if (badge) {
                    badge.textContent = '-';
                    badge.className = 'data-param-result-badge';
                }
            }
            return;
        }

        const evalResult = evaluateParamResult(standardVal, measuredVal);
        const newResult = evalResult === null ? '' : (evalResult ? '양호' : '불량');
        row.values['결과'] = newResult;
        saveCurrentSheetData(false);

        if (tr) {
            const badge = tr.querySelector('.data-param-result-badge');
            if (badge) {
                badge.textContent = newResult || '-';
                badge.className = 'data-param-result-badge ' + (evalResult ? 'result-good' : (evalResult === false ? 'result-bad' : ''));
            }
        }
    }
}

/**
 * 기준값 부등호/기호 선택 변경 처리 (± 또는 ~ 선택 시 2개 입력창 동적 전환)
 */
function handleParamSpecOpChange(rowId, op, selectEl) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (!row) return;

    const cell = selectEl.closest('.data-param-spec-cell');
    if (!cell) return;

    const singleWrap = cell.querySelector('.data-param-single-val-wrap');
    const pmWrap = cell.querySelector('.data-param-pm-val-wrap');
    const rangeWrap = cell.querySelector('.data-param-range-val-wrap');
    const singleInput = cell.querySelector('.data-param-spec-val');
    const centerInput = cell.querySelector('.data-param-spec-center');
    const tolInput = cell.querySelector('.data-param-spec-tol');
    const minInput = cell.querySelector('.data-param-spec-min');
    const maxInput = cell.querySelector('.data-param-spec-max');
    const unit = row.values ? (row.values['단위'] || '') : '';

    let combined = '';

    if (op === '±') {
        // ± 모드로 전환: 단일/범위 인풋 숨기고 2개 인풋 표시
        if (singleWrap) singleWrap.style.display = 'none';
        if (rangeWrap) rangeWrap.style.display = 'none';
        if (pmWrap) pmWrap.style.display = 'flex';

        // 기존 단일/범위 입력에 숫자가 있었다면 중심값으로 이동
        const prevVal = (singleInput && singleInput.value) || (minInput && minInput.value) || '';
        if (prevVal && (!centerInput || !centerInput.value)) {
            const stripped = stripUnitFromValue(prevVal, unit);
            if (centerInput) centerInput.value = stripped;
        }

        const center = centerInput ? centerInput.value.trim() : '';
        const tol = tolInput ? tolInput.value.trim() : '';

        if (center && tol) combined = `${center} ± ${tol}`;
        else if (center) combined = center;
        else if (tol) combined = `± ${tol}`;
        else combined = '±';

        if (tolInput && !tolInput.value) {
            tolInput.focus();
        }
    } else if (op === '~') {
        // ~ 범위 모드로 전환: 단일/± 인풋 숨기고 2개 범위 인풋 표시
        if (singleWrap) singleWrap.style.display = 'none';
        if (pmWrap) pmWrap.style.display = 'none';
        if (rangeWrap) rangeWrap.style.display = 'flex';

        // 기존 단일/± 입력에 숫자가 있었다면 최소값으로 이동
        const prevVal = (singleInput && singleInput.value) || (centerInput && centerInput.value) || '';
        if (prevVal && (!minInput || !minInput.value)) {
            const stripped = stripUnitFromValue(prevVal, unit);
            if (minInput) minInput.value = stripped;
        }

        const minVal = minInput ? minInput.value.trim() : '';
        const maxVal = maxInput ? maxInput.value.trim() : '';

        if (minVal && maxVal) combined = `${minVal} ~ ${maxVal}`;
        else if (minVal) combined = `${minVal} ~`;
        else if (maxVal) combined = `~ ${maxVal}`;
        else combined = '~';

        if (maxInput && !maxInput.value) {
            maxInput.focus();
        }
    } else {
        // 일반 기호 또는 기호 없음 모드: ±/범위 인풋 숨기고 단일 인풋 표시
        if (pmWrap) pmWrap.style.display = 'none';
        if (rangeWrap) rangeWrap.style.display = 'none';
        if (singleWrap) singleWrap.style.display = 'flex';

        // 기존 ± 또는 ~ 모드에서 값이 있었다면 단일 입력으로 이동
        const prevVal = (centerInput && centerInput.value) || (minInput && minInput.value) || '';
        if (prevVal && (!singleInput || !singleInput.value)) {
            if (singleInput) singleInput.value = prevVal;
        }

        let val = singleInput ? singleInput.value.trim() : '';
        if (val && unit) {
            val = attachUnitToValue(stripUnitFromValue(val, unit), unit);
            if (singleInput) singleInput.value = val;
        }

        combined = op ? (val ? `${op} ${val}` : op) : val;
    }

    if (combined && unit) {
        combined = attachUnitToValue(stripUnitFromValue(combined, unit), unit);
    }

    updateParamCell(rowId, '기준값', combined);
    autoEvaluateRowResult(rowId);
}

/**
 * 플러스마이너스(±) 2개 수치 입력(기준값, 오차) 변경 처리
 */
function handleParamPmChange(rowId, inputEl) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (!row) return;

    const pmWrap = inputEl.closest('.data-param-pm-val-wrap');
    if (!pmWrap) return;

    const centerInput = pmWrap.querySelector('.data-param-spec-center');
    const tolInput = pmWrap.querySelector('.data-param-spec-tol');

    const center = centerInput ? centerInput.value.trim() : '';
    const tol = tolInput ? tolInput.value.trim() : '';
    const unit = row.values ? (row.values['단위'] || '') : '';

    let combined = '';
    if (center && tol) {
        combined = `${center} ± ${tol}`;
    } else if (center) {
        combined = center;
    } else if (tol) {
        combined = `± ${tol}`;
    } else {
        combined = '±';
    }

    if (combined && unit) {
        combined = attachUnitToValue(stripUnitFromValue(combined, unit), unit);
    }

    updateParamCell(rowId, '기준값', combined);
    autoEvaluateRowResult(rowId);
}

/**
 * 물결(~) 범위 2개 수치 입력(최소값, 최대값) 변경 처리
 */
function handleParamRangeChange(rowId, inputEl) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (!row) return;

    const rangeWrap = inputEl.closest('.data-param-range-val-wrap');
    if (!rangeWrap) return;

    const minInput = rangeWrap.querySelector('.data-param-spec-min');
    const maxInput = rangeWrap.querySelector('.data-param-spec-max');

    const minVal = minInput ? minInput.value.trim() : '';
    const maxVal = maxInput ? maxInput.value.trim() : '';
    const unit = row.values ? (row.values['단위'] || '') : '';

    let combined = '';
    if (minVal && maxVal) {
        combined = `${minVal} ~ ${maxVal}`;
    } else if (minVal) {
        combined = `${minVal} ~`;
    } else if (maxVal) {
        combined = `~ ${maxVal}`;
    } else {
        combined = '~';
    }

    if (combined && unit) {
        combined = attachUnitToValue(stripUnitFromValue(combined, unit), unit);
    }

    updateParamCell(rowId, '기준값', combined);
    autoEvaluateRowResult(rowId);
}

/**
 * 기준값 수치/내용 입력값 변경 처리 (기호 포함 입력/붙여넣기 시 기호 자동 분리 지원 및 단위 자동 부착)
 */
function handleParamSpecValChange(rowId, currentOp, inputVal, selectEl, inputEl) {
    const parsed = parseParamStandard(inputVal);
    let finalOp = currentOp;
    let finalVal = (inputVal || '').trim();

    // 사용자가 입력 필드에 "≥ 100", "± 5", "10 ~ 20" 처럼 기호를 직접 입력/붙여넣은 경우 자동 분리
    if (parsed.op) {
        finalOp = parsed.op;
        finalVal = parsed.val;
        if (selectEl) {
            selectEl.value = finalOp;
            handleParamSpecOpChange(rowId, finalOp, selectEl);
            const cell = selectEl.closest('.data-param-spec-cell');
            if (cell) {
                if (finalOp === '±') {
                    const cInput = cell.querySelector('.data-param-spec-center');
                    const tInput = cell.querySelector('.data-param-spec-tol');
                    if (cInput) cInput.value = parsed.center || '';
                    if (tInput) tInput.value = parsed.tol || '';
                } else if (finalOp === '~') {
                    const minInput = cell.querySelector('.data-param-spec-min');
                    const maxInput = cell.querySelector('.data-param-spec-max');
                    if (minInput) minInput.value = parsed.min || '';
                    if (maxInput) maxInput.value = parsed.max || '';
                }
            }
            return;
        }
    }

    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    const unit = row && row.values ? (row.values['단위'] || '') : '';

    if (finalVal && unit) {
        finalVal = attachUnitToValue(stripUnitFromValue(finalVal, unit), unit);
    }
    if (inputEl) inputEl.value = finalVal;

    const combined = finalOp ? (finalVal ? `${finalOp} ${finalVal}` : finalOp) : finalVal;
    updateParamCell(rowId, '기준값', combined);
    autoEvaluateRowResult(rowId);
}

/**
 * 측정값 입력 변경 처리 (단위 자동 부착 및 자동 판정 트리거)
 */
function handleParamMeasuredChange(rowId, value) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    const unit = row && row.values ? (row.values['단위'] || '') : '';

    let finalVal = (value || '').trim();
    if (finalVal && unit) {
        finalVal = attachUnitToValue(stripUnitFromValue(finalVal, unit), unit);
        const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (tr) {
            const mInput = tr.querySelector('.data-param-measured-val');
            if (mInput) mInput.value = finalVal;
        }
    }

    updateParamCell(rowId, '측정값', finalVal);
    autoEvaluateRowResult(rowId);
}

/**
 * 파라미터 특정 셀 값 갱신
 */
function updateParamCell(rowId, field, value) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (row) {
        if (!row.values) row.values = {};
        row.values[field] = value;
        saveCurrentSheetData(false);
    }
}

/**
 * 파라미터 항목 행 추가
 */
function addParamRow() {
    if (!currentParamDate) currentParamDate = getTodayString();
    if (!currentSheetData.rows) currentSheetData.rows = [];

    const newRowId = 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    currentSheetData.rows.push({
        id: newRowId,
        date: currentParamDate,
        values: {
            '파라미터 항목': '',
            '단위': '',
            '기준값': '',
            '측정값': '',
            '결과': '양호',
            '비고': ''
        }
    });

    saveCurrentSheetData(true);
    renderParamView();
}

/**
 * 파라미터 항목 행 삭제
 */
function deleteParamRow(rowId) {
    if (!currentSheetData || !currentSheetData.rows) return;
    currentSheetData.rows = currentSheetData.rows.filter(r => r.id !== rowId);
    saveCurrentSheetData(true);
    renderParamView();
}

/**
 * 파라미터 특정 날짜 전체 삭제
 */
function deleteParamDate(dateStr) {
    if (!confirm(`[${dateStr}] 일자의 모든 파라미터 데이터를 삭제하시겠습니까?`)) return;
    if (!currentSheetData || !currentSheetData.rows) return;

    currentSheetData.rows = currentSheetData.rows.filter(r => r.date !== dateStr);
    if (currentParamDate === dateStr) {
        currentParamDate = null;
    }
    saveCurrentSheetData(true);
    renderParamView();
}

/**
 * 파라미터 새 일자 추가 모달 열기
 */
function openParamDateModal() {
    const modal = document.getElementById('data-param-date-modal');
    const input = document.getElementById('data-new-param-date');
    if (input) input.value = getTodayString();
    if (modal) modal.style.display = 'flex';
}

function closeParamDateModal() {
    const modal = document.getElementById('data-param-date-modal');
    if (modal) modal.style.display = 'none';
}

function handleConfirmAddParamDate() {
    const input = document.getElementById('data-new-param-date');
    const dateVal = input ? input.value.trim() : '';
    if (!dateVal) {
        alert('추가할 날짜를 선택해주세요.');
        return;
    }

    // 이미 존재하는 날짜인지 확인
    if (!currentSheetData.rows) currentSheetData.rows = [];
    const exists = currentSheetData.rows.some(r => r.date === dateVal);
    if (!exists) {
        // 새 날짜 기본 행 1개 생성
        currentSheetData.rows.push({
            id: 'row_' + Date.now(),
            date: dateVal,
            values: {
                '파라미터 항목': '',
                '단위': '',
                '기준값': '',
                '측정값': '',
                '결과': '양호',
                '비고': ''
            }
        });
        saveCurrentSheetData(true);
    }

    currentParamDate = dateVal;
    closeParamDateModal();
    renderParamView();
}

/**
 * 현재 선택된 날짜의 파라미터 데이터 초기화
 */
function handleClearCurrentParamDate() {
    if (!currentParamDate) return;
    if (!confirm(`[${currentParamDate}] 일자의 파라미터 데이터를 초기화하시겠습니까?`)) return;

    currentSheetData.rows = currentSheetData.rows.filter(r => r.date !== currentParamDate);
    currentSheetData.rows.push({
        id: 'row_' + Date.now(),
        date: currentParamDate,
        values: {
            '파라미터 항목': '',
            '단위': '',
            '기준값': '',
            '측정값': '',
            '결과': '양호',
            '비고': ''
        }
    });

    saveCurrentSheetData(true);
    renderParamView();
}

/**
 * 파라미터 CSV 다운로드
 */
function handleExportParamCsv() {
    if (!currentSelectedSite || !currentSelectedEquip) return;

    const allRows = currentSheetData.rows || [];
    if (allRows.length === 0) {
        alert('내보낼 파라미터 데이터가 없습니다.');
        return;
    }

    let csv = '\uFEFF'; // UTF-8 BOM
    csv += '"날짜","순번","파라미터 항목","기준값","측정값","결과","비고"\n';

    // 날짜별 정렬
    const sortedRows = [...allRows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    let lastDate = '';
    let seq = 1;

    sortedRows.forEach(row => {
        if (row.date !== lastDate) {
            lastDate = row.date;
            seq = 1;
        }
        const vals = row.values || {};
        const line = [
            `"${(row.date || '').replace(/"/g, '""')}"`,
            seq++,
            `"${(vals['파라미터 항목'] || vals['항목'] || '').replace(/"/g, '""')}"`,
            `"${(vals['기준값'] || vals['기준'] || '').replace(/"/g, '""')}"`,
            `"${(vals['측정값'] || vals['측정'] || '').replace(/"/g, '""')}"`,
            `"${(vals['결과'] || '').replace(/"/g, '""')}"`,
            `"${(vals['비고'] || '').replace(/"/g, '""')}"`
        ];
        csv += line.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const equipTag = currentSelectedEquip.custEquip ? `${currentSelectedEquip.displayName} ${currentSelectedEquip.custEquip}` : `${currentSelectedEquip.displayName} ${currentSelectedEquip.serial || 'DEFAULT'}`;
    const filename = `${currentSelectedSite}_${equipTag}_Parameter_${getTodayString()}.csv`;
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * ADMIN에 등록된 모델별 기본 Parameter 불러오기
 */
async function handleImportModelParams() {
    if (!currentSelectedSite || !currentSelectedEquip) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }

    if (!currentParamDate) {
        currentParamDate = getTodayString();
    }

    // 1. 모델별 파라미터 템플릿 로드 (로컬 + 서버 동기화)
    let modelParamsMap = {};
    try {
        const saved = localStorage.getItem('equip_model_parameters');
        if (saved) modelParamsMap = JSON.parse(saved) || {};
    } catch (e) { }

    try {
        const res = await fetch('/api/setting/equip_model_parameters');
        const data = await res.json();
        if (data.status === 'success' && data.value && typeof data.value === 'object') {
            modelParamsMap = data.value;
            localStorage.setItem('equip_model_parameters', JSON.stringify(modelParamsMap));
        }
    } catch (err) {
        console.warn('Failed to fetch equip_model_parameters:', err);
    }

    // 2. 현재 장비의 모델 매칭 (displayName, custEquip, serial, equipment_models 목록 대조)
    const equipModelName = (currentSelectedEquip.displayName || '').trim();
    let matchedTemplate = modelParamsMap[equipModelName];

    if (!matchedTemplate || matchedTemplate.length === 0) {
        // equipment_models 목록에서 abbr <-> name 매핑 역추적
        try {
            const modelsData = JSON.parse(localStorage.getItem('equipment_models')) || [];
            const foundModel = modelsData.find(m => 
                (m.name && m.name.toLowerCase() === equipModelName.toLowerCase()) || 
                (m.abbr && m.abbr.toLowerCase() === equipModelName.toLowerCase())
            );
            if (foundModel) {
                if (modelParamsMap[foundModel.name] && modelParamsMap[foundModel.name].length > 0) {
                    matchedTemplate = modelParamsMap[foundModel.name];
                } else if (foundModel.abbr && modelParamsMap[foundModel.abbr] && modelParamsMap[foundModel.abbr].length > 0) {
                    matchedTemplate = modelParamsMap[foundModel.abbr];
                }
            }
        } catch (e) { }
    }

    if (!matchedTemplate || matchedTemplate.length === 0) {
        alert(`[${equipModelName}] 장비 모델에 등록된 기본 Parameter가 없습니다.\nADMIN > 장비 Parameter 관리 메뉴에서 기본 Parameter를 먼저 등록해주세요.`);
        return;
    }

    if (!confirm(`[${equipModelName}] 모델의 기본 Parameter (${matchedTemplate.length}개 항목)을 현재 점검 일자(${currentParamDate})로 불러오시겠습니까?`)) {
        return;
    }

    if (!currentSheetData.rows) currentSheetData.rows = [];

    // 현재 날짜의 기존 행 확인 (빈 행만 1개 있는 경우 교체)
    const currentDayRows = currentSheetData.rows.filter(r => r.date === currentParamDate);
    const isOnlySingleEmptyRow = currentDayRows.length === 1 && 
        !(currentDayRows[0].values && (currentDayRows[0].values['파라미터 항목'] || '').trim());

    if (isOnlySingleEmptyRow) {
        currentSheetData.rows = currentSheetData.rows.filter(r => r.id !== currentDayRows[0].id);
    }

    // 새 파라미터 행 생성
    matchedTemplate.forEach((item, idx) => {
        const itemName = (item.name || '').trim();
        const itemUnit = (item.unit || '').trim();
        const itemStd = (item.standard || '').trim();
        const itemMemo = (item.memo || '').trim();

        currentSheetData.rows.push({
            id: 'row_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 4),
            date: currentParamDate,
            values: {
                '파라미터 항목': itemName,
                '단위': itemUnit,
                '기준값': itemStd,
                '측정값': '',
                '결과': (itemUnit === '유무' ? '적합' : '양호'),
                '비고': itemMemo
            }
        });
    });

    saveCurrentSheetData(true);
    renderParamView();

    alert(`[${equipModelName}] 기본 Parameter ${matchedTemplate.length}건을 성공적으로 불러왔습니다.`);
}

/**
 * 파라미터 CSV 파일 선택
 */
function handleImportParamCsvClick() {
    if (!currentSelectedSite || !currentSelectedEquip) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }
    const fileInput = document.getElementById('data-param-csv-file-input');
    if (fileInput) {
        fileInput.value = '';
        fileInput.click();
    }
}

/**
 * 파라미터 CSV 파싱 및 로드
 */
function handleParamCsvFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        let content = event.target.result;
        if (content.includes('\uFFFD')) {
            const retryReader = new FileReader();
            retryReader.onload = (retryEvent) => {
                processParamCsvImport(retryEvent.target.result);
            };
            retryReader.readAsText(file, 'EUC-KR');
        } else {
            processParamCsvImport(content);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function processParamCsvImport(csvText) {
    if (!csvText || !csvText.trim()) {
        alert('CSV 파일 내용이 비어 있습니다.');
        return;
    }

    const rows = parseCsvText(csvText);
    if (rows.length < 2) {
        alert('CSV 파일에 헤더와 1개 이상의 데이터 행이 필요합니다.');
        return;
    }

    const headerRow = rows[0].map(h => h.trim());
    const dataRows = rows.slice(1);

    // 컬럼 인덱스 맵핑
    const getColIdx = (names) => headerRow.findIndex(h => names.some(n => h.toLowerCase().includes(n.toLowerCase())));
    const dateIdx = getColIdx(['날짜', 'date', '일자']);
    const nameIdx = getColIdx(['파라미터', '항목', 'item', 'parameter', 'name']);
    const stdIdx = getColIdx(['기준', 'standard', 'spec']);
    const measIdx = getColIdx(['측정', 'measured', 'value', 'val']);
    const resIdx = getColIdx(['결과', 'result', 'status']);
    const memoIdx = getColIdx(['비고', 'memo', 'note']);

    const newRows = [];
    dataRows.forEach((rowArr, rIdx) => {
        if (!rowArr || rowArr.length === 0 || rowArr.every(cell => !cell)) return;

        const dateStr = (dateIdx !== -1 ? normalizeDate(rowArr[dateIdx]) : '') || currentParamDate || getTodayString();
        const paramName = nameIdx !== -1 ? (rowArr[nameIdx] || '').trim() : (rowArr[0] || '').trim();
        const standardVal = stdIdx !== -1 ? (rowArr[stdIdx] || '').trim() : '';
        const measuredVal = measIdx !== -1 ? (rowArr[measIdx] || '').trim() : '';
        const resultVal = resIdx !== -1 ? (rowArr[resIdx] || '').trim() || '양호' : '양호';
        const memoVal = memoIdx !== -1 ? (rowArr[memoIdx] || '').trim() : '';

        newRows.push({
            id: 'row_' + Date.now() + '_' + rIdx + '_' + Math.random().toString(36).substr(2, 4),
            date: dateStr,
            values: {
                '파라미터 항목': paramName,
                '기준값': standardVal,
                '측정값': measuredVal,
                '결과': resultVal,
                '비고': memoVal
            }
        });
    });

    if (newRows.length === 0) {
        alert('가져올 수 있는 파라미터 데이터 행이 없습니다.');
        return;
    }

    currentSheetData.rows = newRows;
    saveCurrentSheetData(true, true);
    renderParamView();
    alert(`성공적으로 ${newRows.length}개의 파라미터 항목을 가져왔습니다.`);
}

/**
 * 기존 원천 데이터(Raw Data) 스프레드시트 테이블 렌더링
 */
function renderRawSheetTable() {
    const rawView = document.getElementById('data-raw-view');
    const paramView = document.getElementById('data-param-view');
    const rawToolbar = document.getElementById('toolbar-raw-actions');
    const paramToolbar = document.getElementById('toolbar-param-actions');

    if (rawView) rawView.style.display = 'flex';
    if (paramView) paramView.style.display = 'none';
    if (rawToolbar) rawToolbar.style.display = 'flex';
    if (paramToolbar) paramToolbar.style.display = 'none';
    const thead = document.getElementById('data-sheet-thead');
    const tbody = document.getElementById('data-sheet-tbody');
    if (!thead || !tbody) return;

    const columns = currentSheetData.columns || [];
    const rows = currentSheetData.rows || [];

    // 1. 헤더 (Thead) 렌더링
    let headHtml = '<tr>';
    
    // No 컬럼
    headHtml += `<th class="sheet-th-no" style="width: 50px; min-width: 50px; max-width: 50px; text-align: center; cursor: pointer;" onclick="toggleSheetSort('__no__')" title="순번 기준 정렬 (클릭 시 토글)">No</th>`;

    // 날짜 컬럼
    headHtml += `<th class="sheet-th-date" style="width: 140px; min-width: 140px; text-align: center; cursor: pointer;" onclick="toggleSheetSort('__date__')" title="날짜 기준 정렬 (클릭 시 토글)">📅 날짜</th>`;

    // 동적 데이터 열들 (점 6개 및 정렬 아이콘 제거, 클릭 시 정렬/드래그 시 순서 이동)
    columns.forEach((col, colIdx) => {
        headHtml += `
            <th class="sheet-col-th" draggable="true" data-col-idx="${colIdx}" style="width: 160px; min-width: 150px; cursor: pointer;" onclick="handleColHeaderClick(event, '${escapeHtml(col)}')">
                <div class="sheet-col-header-inner">
                    <span class="sheet-col-title" title="${escapeHtml(col)} (클릭 시 정렬, 드래그 시 이동)">
                        ${escapeHtml(col)}
                    </span>
                    <div class="sheet-col-actions">
                        <button type="button" class="sheet-col-edit-btn" title="열 이름 수정" onclick="event.stopPropagation(); editSheetColumn(${colIdx})">✏️</button>
                        <button type="button" class="sheet-col-del-btn" title="열 삭제" onclick="event.stopPropagation(); deleteSheetColumn(${colIdx})">&times;</button>
                    </div>
                </div>
            </th>
        `;
    });

    headHtml += '<th class="sheet-th-action" style="width: 50px; min-width: 50px; max-width: 50px; text-align: center;">삭제</th>';
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    // 2. 본문 (Tbody) 렌더링
    if (rows.length === 0) {
        const colSpan = columns.length + 3;
        tbody.innerHTML = `
            <tr>
                <td colspan="${colSpan}" class="sheet-empty-state">
                    기록된 행이 없습니다.<br>
                    상단의 <strong>[➕ 행 추가]</strong>를 누르거나, 셀 입력 후 <strong>[Enter]</strong>를 눌러 시작하세요.
                </td>
            </tr>
        `;
        return;
    }

    let bodyHtml = '';
    rows.forEach((row, rowIdx) => {
        bodyHtml += `<tr data-row-id="${row.id}">`;
        
        // No 컬럼
        bodyHtml += `<td class="sheet-td-no" style="width: 50px; min-width: 50px; color:#8b949e; text-align:center; user-select:none; font-size:11px;">${rowIdx + 1}</td>`;

        // 날짜 컬럼 (첫 열: 직접 변경 가능한 날짜 피커)
        bodyHtml += `
            <td class="sheet-td-date" style="width: 140px; min-width: 140px; text-align: center;">
                <input type="date" class="sheet-date-input custom-date-icon" value="${row.date || ''}" max="9999-12-31" 
                       onchange="updateRowDate('${row.id}', this.value)" title="날짜 변경">
            </td>
        `;

        // 사용자 정의 동적 열들 (직접 편집 가능한 인라인 셀)
        columns.forEach((col, colIdx) => {
            const val = (row.values && row.values[col] !== undefined) ? row.values[col] : '';
            bodyHtml += `
                <td class="sheet-td-data" style="width: 160px; min-width: 150px;">
                    <input type="text" class="sheet-cell-input" value="${escapeHtml(val)}" 
                           data-row-id="${row.id}" data-row-idx="${rowIdx}" data-col-idx="${colIdx}" data-col-name="${escapeHtml(col)}" 
                           placeholder="-" autocomplete="off">
                </td>
            `;
        });

        // 행 삭제 버튼 컬럼
        bodyHtml += `
            <td class="sheet-action-cell" style="width: 50px; min-width: 50px;">
                <button type="button" class="sheet-row-del-btn" title="이 행 삭제" onclick="deleteSheetRow('${row.id}')">&times;</button>
            </td>
        `;

        bodyHtml += '</tr>';
    });

    tbody.innerHTML = bodyHtml;

    // 셀 입력 이벤트 바인딩 (실시간 저장 & 키보드 이동)
    bindCellInputEvents();

    // 열 드래그 앤 드롭 이동 이벤트 바인딩
    bindColumnDragEvents();
}

/**
 * 열 드래그 앤 드롭 이동 관련 상태
 */
let draggedColIdx = null;
let isDraggingColumn = false;

/**
 * 열 헤더 클릭 핸들러 (드래그 직후 클릭 오동작 방지)
 */
window.handleColHeaderClick = function(e, col) {
    if (isDraggingColumn) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    toggleSheetSort(col);
};

/**
 * 열 순서 변경 및 DB/로컬 저장
 */
function moveColumn(fromIdx, toIdx, insertBefore) {
    if (!currentSheetData || !Array.isArray(currentSheetData.columns)) return;

    const cols = currentSheetData.columns;
    if (fromIdx < 0 || fromIdx >= cols.length || toIdx < 0 || toIdx >= cols.length) return;

    const [movedCol] = cols.splice(fromIdx, 1);

    let newTargetIdx = toIdx;
    if (fromIdx < toIdx) {
        newTargetIdx = toIdx - 1;
    }

    let finalIdx = insertBefore ? newTargetIdx : newTargetIdx + 1;
    if (finalIdx < 0) finalIdx = 0;
    if (finalIdx > cols.length) finalIdx = cols.length;

    cols.splice(finalIdx, 0, movedCol);

    saveCurrentSheetData(true);
    renderSheetTable();
}

/**
 * 열 드래그 앤 드롭 이벤트 바인딩 (데스크톱 HTML5 DnD + 모바일 터치 드래그 호환)
 */
function bindColumnDragEvents() {
    const colThs = document.querySelectorAll('#data-sheet-thead th.sheet-col-th');
    if (!colThs.length) return;

    // 1. 데스크톱 HTML5 드래그 앤 드롭
    colThs.forEach(th => {
        th.addEventListener('dragstart', (e) => {
            draggedColIdx = parseInt(th.dataset.colIdx, 10);
            isDraggingColumn = true;
            th.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(draggedColIdx));
        });

        th.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const targetIdx = parseInt(th.dataset.colIdx, 10);
            if (targetIdx !== draggedColIdx) {
                const rect = th.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                if (e.clientX < midX) {
                    th.classList.add('drag-over-left');
                    th.classList.remove('drag-over-right');
                } else {
                    th.classList.add('drag-over-right');
                    th.classList.remove('drag-over-left');
                }
            }
        });

        th.addEventListener('dragleave', () => {
            th.classList.remove('drag-over-left', 'drag-over-right');
        });

        th.addEventListener('drop', (e) => {
            e.preventDefault();
            th.classList.remove('drag-over-left', 'drag-over-right');

            if (draggedColIdx === null) return;
            const targetIdx = parseInt(th.dataset.colIdx, 10);
            if (draggedColIdx === targetIdx) return;

            const rect = th.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            const insertBefore = e.clientX < midX;

            moveColumn(draggedColIdx, targetIdx, insertBefore);
        });

        th.addEventListener('dragend', () => {
            th.classList.remove('dragging');
            colThs.forEach(el => el.classList.remove('drag-over-left', 'drag-over-right', 'dragging'));
            setTimeout(() => {
                isDraggingColumn = false;
                draggedColIdx = null;
            }, 100);
        });

        // 2. 모바일 터치 드래그 지원 (th 헤더 영역 대상, 삭제 버튼 제외)
        let touchStartX = 0;
        let touchStartY = 0;
        let isTouchDragging = false;
        let ghostEl = null;
        let currentTargetTh = null;
        let insertBefore = false;

        th.addEventListener('touchstart', (e) => {
            if (e.target.closest('.sheet-col-del-btn') || e.target.closest('.sheet-col-edit-btn')) return;
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            isTouchDragging = false;
            draggedColIdx = parseInt(th.dataset.colIdx, 10);
        }, { passive: true });

        th.addEventListener('touchmove', (e) => {
            if (draggedColIdx === null) return;
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);

            // 가로 이동이 10px 이상이고 세로 이동보다 클 때 열 드래그 모드로 전환
            if (!isTouchDragging && dx > 10 && dx > dy) {
                isTouchDragging = true;
                isDraggingColumn = true;

                const colName = currentSheetData.columns[draggedColIdx] || '열';
                ghostEl = document.createElement('div');
                ghostEl.className = 'sheet-touch-ghost';
                ghostEl.textContent = `↔ ${colName}`;
                document.body.appendChild(ghostEl);
            }

            if (isTouchDragging) {
                if (ghostEl) {
                    ghostEl.style.left = `${touch.clientX}px`;
                    ghostEl.style.top = `${touch.clientY - 10}px`;
                }

                colThs.forEach(el => el.classList.remove('drag-over-left', 'drag-over-right'));
                const elem = document.elementFromPoint(touch.clientX, touch.clientY);
                const targetTh = elem ? elem.closest('#data-sheet-thead th.sheet-col-th') : null;

                if (targetTh && parseInt(targetTh.dataset.colIdx, 10) !== draggedColIdx) {
                    currentTargetTh = targetTh;
                    const rect = targetTh.getBoundingClientRect();
                    const midX = rect.left + rect.width / 2;
                    insertBefore = touch.clientX < midX;

                    if (insertBefore) {
                        targetTh.classList.add('drag-over-left');
                    } else {
                        targetTh.classList.add('drag-over-right');
                    }
                } else {
                    currentTargetTh = null;
                }
            }
        }, { passive: false });

        const finishTouch = () => {
            if (ghostEl) {
                ghostEl.remove();
                ghostEl = null;
            }
            colThs.forEach(el => el.classList.remove('drag-over-left', 'drag-over-right', 'dragging'));

            if (isTouchDragging && currentTargetTh && draggedColIdx !== null) {
                const targetIdx = parseInt(currentTargetTh.dataset.colIdx, 10);
                if (draggedColIdx !== targetIdx) {
                    moveColumn(draggedColIdx, targetIdx, insertBefore);
                }
            }

            setTimeout(() => {
                isDraggingColumn = false;
                draggedColIdx = null;
                isTouchDragging = false;
            }, 100);
        };

        th.addEventListener('touchend', finishTouch);
        th.addEventListener('touchcancel', finishTouch);
    });
}

/**
 * Tab 누르기 시작한 열 인덱스 추적 변수 (Excel 방식 Tab -> Enter 복귀 지원)
 */
let tabStartColIndex = null;

/**
 * 셀 입력 필드 이벤트 바인딩 (Excel 스타일: Tab 누르면 다음 열, Enter 누르면 Tab 시작 열의 다음 행으로 이동)
 */
function bindCellInputEvents() {
    const inputs = document.querySelectorAll('#data-sheet-tbody .sheet-cell-input');

    inputs.forEach(input => {
        // 셀 마우스/터치 클릭 시 Tab 시작 열 인덱스 갱신 (모바일 호환 pointerdown)
        input.addEventListener('pointerdown', () => {
            tabStartColIndex = parseInt(input.dataset.colIdx, 10);
        });
        input.addEventListener('mousedown', () => {
            tabStartColIndex = parseInt(input.dataset.colIdx, 10);
        });

        // 값 변경 시 자동 저장
        input.addEventListener('input', (e) => {
            const rowId = e.target.dataset.rowId;
            const colName = e.target.dataset.colName;
            const value = e.target.value;

            const row = currentSheetData.rows.find(r => r.id === rowId);
            if (row) {
                if (!row.values) row.values = {};
                row.values[colName] = value;
                saveCurrentSheetData(true);
            }
        });

        // 키보드 내비게이션 (Tab, Enter, ArrowUp, ArrowDown)
        input.addEventListener('keydown', (e) => {
            const rIdx = parseInt(input.dataset.rowIdx, 10);
            const cIdx = parseInt(input.dataset.colIdx, 10);
            const totalCols = currentSheetData.columns.length;
            const totalRows = currentSheetData.rows.length;

            if (e.key === 'Tab') {
                // Tab을 누르기 시작한 첫 열을 기억 (아직 설정되지 않았다면 현재 열을 시작 열로)
                if (tabStartColIndex === null) {
                    tabStartColIndex = cIdx;
                }

                if (!e.shiftKey) {
                    // 오른쪽 열로 이동
                    if (cIdx + 1 < totalCols) {
                        e.preventDefault();
                        const nextCell = document.querySelector(`.sheet-cell-input[data-row-idx="${rIdx}"][data-col-idx="${cIdx + 1}"]`);
                        if (nextCell) {
                            nextCell.focus();
                            nextCell.select();
                            nextCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                        }
                    } else {
                        // 마지막 열에서 Tab 누르면 다음 행의 시작 열로 이동
                        if (rIdx + 1 < totalRows) {
                            e.preventDefault();
                            const targetCol = (tabStartColIndex !== null) ? tabStartColIndex : 0;
                            const nextRowCell = document.querySelector(`.sheet-cell-input[data-row-idx="${rIdx + 1}"][data-col-idx="${targetCol}"]`);
                            if (nextRowCell) {
                                nextRowCell.focus();
                                nextRowCell.select();
                                nextRowCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                            }
                        }
                    }
                } else {
                    // Shift + Tab (왼쪽 열로 이동)
                    if (cIdx > 0) {
                        e.preventDefault();
                        const prevCell = document.querySelector(`.sheet-cell-input[data-row-idx="${rIdx}"][data-col-idx="${cIdx - 1}"]`);
                        if (prevCell) {
                            tabStartColIndex = cIdx - 1;
                            prevCell.focus();
                            prevCell.select();
                            prevCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                        }
                    }
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();

                // 엔터 시: Tab을 누르기 시작한 열(없으면 현재 열)의 다음 행으로 복귀 이동 (Excel 동작)
                const targetCol = (tabStartColIndex !== null) ? tabStartColIndex : cIdx;
                const nextRowIdx = rIdx + 1;

                // 다음 행으로 이동한 후 해당 열이 다음 이동의 기준이 됨
                tabStartColIndex = targetCol;

                if (nextRowIdx < totalRows) {
                    const nextInput = document.querySelector(`.sheet-cell-input[data-row-idx="${nextRowIdx}"][data-col-idx="${targetCol}"]`);
                    if (nextInput) {
                        nextInput.focus();
                        nextInput.select();
                        nextInput.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                    }
                } else {
                    // 마지막 행이면 아래(맨 끝)에 새 행을 추가하고 해당 시작 열로 이동
                    addSheetRow(null, false, true);
                    setTimeout(() => {
                        const newRowInput = document.querySelector(`.sheet-cell-input[data-row-idx="${nextRowIdx}"][data-col-idx="${targetCol}"]`);
                        if (newRowInput) {
                            newRowInput.focus();
                            newRowInput.select();
                            newRowInput.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                        }
                    }, 50);
                }
            } else if (e.key === 'ArrowDown') {
                if (rIdx + 1 < totalRows) {
                    e.preventDefault();
                    const nextCell = document.querySelector(`.sheet-cell-input[data-row-idx="${rIdx + 1}"][data-col-idx="${cIdx}"]`);
                    if (nextCell) {
                        tabStartColIndex = cIdx;
                        nextCell.focus();
                        nextCell.select();
                        nextCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                    }
                }
            } else if (e.key === 'ArrowUp') {
                if (rIdx > 0) {
                    e.preventDefault();
                    const prevCell = document.querySelector(`.sheet-cell-input[data-row-idx="${rIdx - 1}"][data-col-idx="${cIdx}"]`);
                    if (prevCell) {
                        tabStartColIndex = cIdx;
                        prevCell.focus();
                        prevCell.select();
                        prevCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                    }
                }
            }
        });
    });
}

/**
 * 날짜 변경 핸들러
 */
window.updateRowDate = function(rowId, newDate) {
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (row) {
        row.date = newDate;
        saveCurrentSheetData(true);
    }
};

/**
 * 행 추가 (기본 오늘 날짜 또는 지정 날짜, 기본 아래로 추가)
 */
function addSheetRow(specificDate = null, focusFirst = true, appendToBottom = true) {
    if (!currentSelectedSite || !currentSelectedEquip) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }

    const dateStr = specificDate || getTodayString();

    const newRow = {
        id: 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        date: dateStr,
        values: {}
    };

    (currentSheetData.columns || []).forEach(col => {
        newRow.values[col] = '';
    });

    if (appendToBottom) {
        // 아래로 행 추가 (엑셀 누적 방식)
        currentSheetData.rows.push(newRow);
    } else {
        currentSheetData.rows.unshift(newRow);
    }

    saveCurrentSheetData(true);
    renderSheetTable();

    // 첫 번째 입력 셀로 포커스
    if (focusFirst) {
        setTimeout(() => {
            const firstInput = document.querySelector(`#data-sheet-tbody tr[data-row-id="${newRow.id}"] .sheet-cell-input`);
            if (firstInput) {
                firstInput.focus();
                firstInput.select();
                firstInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
    }
}

/**
 * 행 삭제
 */
window.deleteSheetRow = function(rowId) {
    const row = currentSheetData.rows.find(r => r.id === rowId);
    const dateLabel = row ? `(${row.date})` : '';
    if (!confirm(`해당 날짜${dateLabel} 행을 삭제하시겠습니까?`)) return;

    currentSheetData.rows = currentSheetData.rows.filter(r => r.id !== rowId);
    saveCurrentSheetData(true);
    renderSheetTable();
};

/**
 * 열 추가 모달 열기
 */
function openColModal() {
    if (!currentSelectedSite || !currentSelectedEquip) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }

    const modal = document.getElementById('data-col-modal');
    const input = document.getElementById('data-new-col-name');
    if (modal && input) {
        input.value = '';
        modal.style.display = 'flex';
        setTimeout(() => input.focus(), 50);
    }
}

/**
 * 열 추가 모달 닫기
 */
function closeColModal() {
    const modal = document.getElementById('data-col-modal');
    if (modal) modal.style.display = 'none';
}

/**
 * 열 추가 확인 처리
 */
function handleConfirmAddCol() {
    const input = document.getElementById('data-new-col-name');
    const colName = (input?.value || '').trim();

    if (!colName) {
        alert('추가할 열 이름을 입력해주세요.');
        input?.focus();
        return;
    }

    if (!currentSheetData.columns) currentSheetData.columns = [];

    if (currentSheetData.columns.includes(colName)) {
        alert('이미 동일한 이름의 열이 존재합니다.');
        input?.focus();
        return;
    }

    // 새 열 추가
    currentSheetData.columns.push(colName);

    // 기존 모든 행에 새 열 필드 기본값 할당
    (currentSheetData.rows || []).forEach(row => {
        if (!row.values) row.values = {};
        if (row.values[colName] === undefined) {
            row.values[colName] = '';
        }
    });

    saveCurrentSheetData(true);
    renderSheetTable();
    closeColModal();
}

/**
 * 열 이름 수정
 */
window.editSheetColumn = function(colIdx) {
    if (!currentSheetData || !Array.isArray(currentSheetData.columns)) return;
    const oldName = currentSheetData.columns[colIdx];
    if (!oldName) return;

    const newName = prompt(`'${oldName}' 열의 새로운 이름을 입력하세요:`, oldName);
    if (newName === null) return; // 취소

    const trimmed = newName.trim();
    if (!trimmed) {
        alert('열 이름을 비워둘 수 없습니다.');
        return;
    }

    if (trimmed === oldName) return; // 변경 없음

    // 중복 확인
    const duplicate = currentSheetData.columns.some((c, idx) => idx !== colIdx && c === trimmed);
    if (duplicate) {
        alert(`'${trimmed}' 열이 이미 존재합니다. 다른 이름을 입력해주세요.`);
        return;
    }

    // 1. 컬럼 목록 업데이트
    currentSheetData.columns[colIdx] = trimmed;

    // 2. 모든 행의 데이터 키 업데이트
    (currentSheetData.rows || []).forEach(row => {
        if (row.values && row.values[oldName] !== undefined) {
            row.values[trimmed] = row.values[oldName];
            delete row.values[oldName];
        }
    });

    // 3. 정렬 상태 키 보정
    if (currentSort.key === oldName) {
        currentSort.key = trimmed;
    }

    // 4. DB 테이블 재생성 및 동기화 (reset_table: true)
    saveCurrentSheetData(true, true);
    renderSheetTable();
};

/**
 * 열 삭제
 */
window.deleteSheetColumn = function(colIdx) {
    const colName = currentSheetData.columns[colIdx];
    if (!colName) return;

    if (!confirm(`"${colName}" 열을 삭제하시겠습니까?\n해당 열에 입력된 모든 데이터도 함께 삭제됩니다.`)) {
        return;
    }

    currentSheetData.columns.splice(colIdx, 1);

    (currentSheetData.rows || []).forEach(row => {
        if (row.values && row.values[colName] !== undefined) {
            delete row.values[colName];
        }
    });

    saveCurrentSheetData(true, true);
    renderSheetTable();
};

/**
 * 시트 데이터 전체 초기화
 */
function handleClearSheetData() {
    if (!currentSelectedSite || !currentSelectedEquip) return;
    const modeLabel = (currentDataMode === 'param') ? 'Parameter' : 'Raw Data';
    if (!confirm(`현재 장비(${currentSelectedEquip.displayName})의 [${modeLabel}] 시트 데이터를 초기화하시겠습니까?`)) return;

    initDefaultSheet();
    renderSheetTable();
}

/**
 * CSV 다운로드 (Excel 호환 UTF-8 BOM)
 */
function handleExportCsv() {
    if (!currentSelectedSite || !currentSelectedEquip) return;

    const columns = currentSheetData.columns || [];
    const rows = currentSheetData.rows || [];

    if (rows.length === 0) {
        alert('내보낼 데이터가 없습니다.');
        return;
    }

    let csv = '\uFEFF'; // UTF-8 BOM

    // 1. 헤더
    const headers = ['날짜', ...columns];
    csv += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';

    // 2. 행 데이터
    rows.forEach(row => {
        const line = [
            `"${(row.date || '').replace(/"/g, '""')}"`,
            ...columns.map(col => {
                const val = (row.values && row.values[col] !== undefined) ? String(row.values[col]) : '';
                return `"${val.replace(/"/g, '""')}"`;
            })
        ];
        csv += line.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const equipTag = currentSelectedEquip.custEquip ? `${currentSelectedEquip.displayName} ${currentSelectedEquip.custEquip}` : `${currentSelectedEquip.displayName} ${currentSelectedEquip.serial || 'DEFAULT'}`;
    const modeLabel = (currentDataMode === 'param') ? 'Parameter' : 'RawData';
    const filename = `${currentSelectedSite}_${equipTag}_${modeLabel}_${getTodayString()}.csv`;
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * CSV 파일 선택 창 열기
 */
function handleImportCsvClick() {
    if (!currentSelectedSite || !currentSelectedEquip) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }
    const fileInput = document.getElementById('data-csv-file-input');
    if (fileInput) {
        fileInput.value = '';
        fileInput.click();
    }
}

/**
 * CSV 파일 로드 및 인코딩 처리
 */
function handleCsvFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
        let content = event.target.result;
        // UTF-8 디코딩 시 한글 깨짐(\uFFFD) 발생 여부 체크 -> EUC-KR로 재시도
        if (content.includes('\uFFFD')) {
            const retryReader = new FileReader();
            retryReader.onload = (retryEvent) => {
                processCsvImport(retryEvent.target.result);
            };
            retryReader.readAsText(file, 'EUC-KR');
        } else {
            processCsvImport(content);
        }
    };

    reader.readAsText(file, 'UTF-8');
}

/**
 * CSV 텍스트 파싱 및 시트 데이터 완전 대체 (기존 데이터 삭제 후 CSV 파일 기준으로 작성)
 */
function processCsvImport(csvText) {
    if (!csvText || !csvText.trim()) {
        alert('CSV 파일 내용이 비어 있습니다.');
        return;
    }

    const rows = parseCsvText(csvText);
    if (rows.length < 2) {
        alert('CSV 파일에 헤더와 1개 이상의 데이터 행이 필요합니다.');
        return;
    }

    const headerRow = rows[0];
    const dataRows = rows.slice(1);

    // 날짜 컬럼 인덱스 식별
    let dateColIdx = -1;
    for (let i = 0; i < headerRow.length; i++) {
        const colTitle = headerRow[i].toLowerCase().replace(/[\s_]/g, '');
        if (['날짜', 'date', '일자', '기록일자', '측정일자', '측정일', '일시'].includes(colTitle)) {
            dateColIdx = i;
            break;
        }
    }

    // 헤더명으로 못 찾은 경우, 데이터 행의 값이 날짜 패턴인지 검사
    if (dateColIdx === -1) {
        if (dataRows.length > 0 && normalizeDate(dataRows[0][0])) {
            dateColIdx = 0;
        } else if (dataRows.length > 0 && dataRows[0].length > 1 && normalizeDate(dataRows[0][1])) {
            dateColIdx = 1;
        } else {
            dateColIdx = 0;
        }
    }

    // CSV 파일 기준 열 목록 구성 (순번/No 제외, 날짜 제외)
    const newColumns = [];
    const csvColMap = []; // { csvIdx, colName }

    for (let i = 0; i < headerRow.length; i++) {
        if (i === dateColIdx) continue;
        const rawName = headerRow[i].trim();
        const lower = rawName.toLowerCase();
        if (lower === 'no' || lower === '순번' || lower === '번호') continue;

        if (rawName) {
            let colName = rawName;
            // 중복된 열 이름이 있을 경우 고유화
            let counter = 2;
            while (newColumns.includes(colName)) {
                colName = `${rawName}_${counter}`;
                counter++;
            }
            newColumns.push(colName);
            csvColMap.push({ csvIdx: i, colName });
        }
    }

    // 기존 데이터 완전히 삭제하고 CSV 파일 기준으로 새로 작성
    const newRows = [];
    dataRows.forEach((rowArr, rIdx) => {
        if (!rowArr || rowArr.length === 0 || rowArr.every(cell => !cell)) return;

        const rawDate = rowArr[dateColIdx];
        const dateStr = normalizeDate(rawDate) || getTodayString();

        const vals = {};
        newColumns.forEach(c => vals[c] = '');

        csvColMap.forEach(({ csvIdx, colName }) => {
            vals[colName] = (rowArr[csvIdx] !== undefined) ? rowArr[csvIdx] : '';
        });

        newRows.push({
            id: 'row_' + Date.now() + '_' + rIdx + '_' + Math.random().toString(36).substr(2, 4),
            date: dateStr,
            values: vals
        });
    });

    // 기존 데이터 완전 대체
    currentSheetData = {
        columns: newColumns,
        rows: newRows
    };

    // 정렬 상태 초기화
    currentSort = { key: null, direction: 'asc' };

    // DB 및 로컬 저장 (resetTable: true 로 기존 DB 테이블 컬럼/데이터도 완전 초기화 후 재생성)
    saveCurrentSheetData(true, true);
    renderSheetTable();

    alert(`CSV 파일 기준으로 작성이 완료되었습니다.\n- 등록된 열: ${newColumns.length}개\n- 불러온 데이터 행: ${newRows.length}개\n(기존 데이터는 삭제되었습니다.)`);
}

/**
 * CSV 텍스트 파싱 헬퍼 (따옴표 및 쉼표 예외 처리)
 */
function parseCsvText(text) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let insideQuotes = false;

    // UTF-8 BOM 제거
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                currentField += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentField.trim());
            if (currentRow.some(f => f !== '')) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentField = '';
        } else {
            currentField += char;
        }
    }
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f !== '')) {
            rows.push(currentRow);
        }
    }
    return rows;
}

/**
 * 날짜 정규화 헬퍼 (YYYY-MM-DD 변환)
 */
function normalizeDate(rawDate) {
    if (!rawDate) return '';
    let s = String(rawDate).trim().replace(/^["']|["']$/g, '');
    s = s.replace(/[\.\/]/g, '-');
    const match = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
        const y = match[1];
        const m = String(match[2]).padStart(2, '0');
        const d = String(match[3]).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return '';
}

/**
 * 이벤트 리스너 바인딩
 */
function setupDataEventListeners() {
    // Parameter / Raw Data 모드 전환 세그먼트 버튼
    const btnParam = document.getElementById('btn-mode-param');
    if (btnParam) {
        btnParam.addEventListener('click', () => switchDataMode('param'));
    }
    const btnRaw = document.getElementById('btn-mode-raw');
    if (btnRaw) {
        btnRaw.addEventListener('click', () => switchDataMode('raw'));
    }

    // 사업장 검색
    const siteSearch = document.getElementById('data-site-search');
    if (siteSearch) {
        siteSearch.addEventListener('input', () => renderSiteList());
    }

    // 장비 검색
    const equipSearch = document.getElementById('data-equip-search');
    if (equipSearch) {
        equipSearch.addEventListener('input', () => renderEquipList());
    }

    // 상단 툴바 행 추가 버튼
    const btnAddRow = document.getElementById('btn-add-sheet-row');
    if (btnAddRow) {
        btnAddRow.addEventListener('click', () => addSheetRow());
    }


    // 상단 툴바 열 추가 버튼
    const btnAddCol = document.getElementById('btn-add-sheet-col');
    if (btnAddCol) {
        btnAddCol.addEventListener('click', openColModal);
    }

    // 열 추가 모달 취소 및 닫기
    const btnCloseCol = document.getElementById('btn-close-col-modal');
    if (btnCloseCol) btnCloseCol.addEventListener('click', closeColModal);

    const btnCancelCol = document.getElementById('btn-cancel-col-modal');
    if (btnCancelCol) btnCancelCol.addEventListener('click', closeColModal);

    // 열 추가 모달 확인
    const btnConfirmCol = document.getElementById('btn-confirm-add-col');
    if (btnConfirmCol) {
        btnConfirmCol.addEventListener('click', handleConfirmAddCol);
    }

    const inputColName = document.getElementById('data-new-col-name');
    if (inputColName) {
        inputColName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirmAddCol();
            } else if (e.key === 'Escape') {
                closeColModal();
            }
        });
    }

    // 전체 초기화 버튼
    const btnClear = document.getElementById('btn-clear-equip-data');
    if (btnClear) {
        btnClear.addEventListener('click', handleClearSheetData);
    }

    // CSV 불러오기 버튼 및 파일 인풋
    const btnImport = document.getElementById('btn-import-equip-data-csv');
    if (btnImport) {
        btnImport.addEventListener('click', handleImportCsvClick);
    }

    const csvFileInput = document.getElementById('data-csv-file-input');
    if (csvFileInput) {
        csvFileInput.addEventListener('change', handleCsvFileSelected);
    }

    // CSV 내보내기 버튼
    const btnExport = document.getElementById('btn-export-equip-data-csv');
    if (btnExport) {
        btnExport.addEventListener('click', handleExportCsv);
    }

    // Parameter 전용 이벤트 리스너들
    const btnAddParamDate = document.getElementById('btn-add-param-date');
    if (btnAddParamDate) btnAddParamDate.addEventListener('click', openParamDateModal);

    const btnCloseParamDate = document.getElementById('btn-close-param-date-modal');
    if (btnCloseParamDate) btnCloseParamDate.addEventListener('click', closeParamDateModal);

    const btnCancelParamDate = document.getElementById('btn-cancel-param-date-modal');
    if (btnCancelParamDate) btnCancelParamDate.addEventListener('click', closeParamDateModal);

    const btnConfirmAddParamDate = document.getElementById('btn-confirm-add-param-date');
    if (btnConfirmAddParamDate) btnConfirmAddParamDate.addEventListener('click', handleConfirmAddParamDate);

    const btnImportModelParam = document.getElementById('btn-import-model-param');
    if (btnImportModelParam) btnImportModelParam.addEventListener('click', handleImportModelParams);

    const btnAddParamRow = document.getElementById('btn-add-param-row');
    if (btnAddParamRow) btnAddParamRow.addEventListener('click', addParamRow);

    const btnClearParam = document.getElementById('btn-clear-param-data');
    if (btnClearParam) btnClearParam.addEventListener('click', handleClearCurrentParamDate);

    const btnExportParam = document.getElementById('btn-export-param-csv');
    if (btnExportParam) btnExportParam.addEventListener('click', handleExportParamCsv);

    const btnImportParam = document.getElementById('btn-import-param-csv');
    if (btnImportParam) btnImportParam.addEventListener('click', handleImportParamCsvClick);

    const paramCsvFileInput = document.getElementById('data-param-csv-file-input');
    if (paramCsvFileInput) paramCsvFileInput.addEventListener('change', handleParamCsvFileSelected);
}

/**
 * XSS 방지 escapeHtml 헬퍼
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
