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
    rows: [],
    concUnit: 'ppm'
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

    // 페이지 이탈 시 대기 중인 DB 저장 즉시 플러시
    window.addEventListener('beforeunload', () => {
        if (dbSaveTimer) {
            clearTimeout(dbSaveTimer);
            saveCurrentSheetData(false, false, true);
        }
    });
    window.addEventListener('pagehide', () => {
        if (dbSaveTimer) {
            clearTimeout(dbSaveTimer);
            saveCurrentSheetData(false, false, true);
        }
    });
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
    if (!newMode || (newMode !== 'param' && newMode !== 'raw' && newMode !== 'analysis')) return;
    if (currentDataMode === newMode) return;

    currentDataMode = newMode;

    if (currentSelectedSite) {
        saveLastDataState(currentSelectedSite, currentSelectedEquip ? currentSelectedEquip.key : '', currentDataMode);
    }

    // 세그먼트 버튼 활성화 상태 갱신
    const btnParam = document.getElementById('btn-mode-param');
    const btnRaw = document.getElementById('btn-mode-raw');
    const btnAnalysis = document.getElementById('btn-mode-analysis');
    if (btnParam) btnParam.classList.toggle('active', newMode === 'param');
    if (btnRaw) btnRaw.classList.toggle('active', newMode === 'raw');
    if (btnAnalysis) btnAnalysis.classList.toggle('active', newMode === 'analysis');

    // 뷰 및 툴바 가시성 전환
    const rawView = document.getElementById('data-raw-view');
    const paramView = document.getElementById('data-param-view');
    const analysisView = document.getElementById('data-analysis-view');
    const rawToolbar = document.getElementById('toolbar-raw-actions');
    const paramToolbar = document.getElementById('toolbar-param-actions');
    const analysisToolbar = document.getElementById('toolbar-analysis-actions');

    if (newMode === 'param') {
        if (rawView) rawView.style.display = 'none';
        if (paramView) paramView.style.display = 'flex';
        if (analysisView) analysisView.style.display = 'none';
        if (rawToolbar) rawToolbar.style.display = 'none';
        if (paramToolbar) paramToolbar.style.display = 'flex';
        if (analysisToolbar) analysisToolbar.style.display = 'none';
    } else if (newMode === 'analysis') {
        if (rawView) rawView.style.display = 'none';
        if (paramView) paramView.style.display = 'none';
        if (analysisView) analysisView.style.display = 'flex';
        if (rawToolbar) rawToolbar.style.display = 'none';
        if (paramToolbar) paramToolbar.style.display = 'none';
        if (analysisToolbar) analysisToolbar.style.display = 'flex';
    } else {
        if (rawView) rawView.style.display = 'flex';
        if (paramView) paramView.style.display = 'none';
        if (analysisView) analysisView.style.display = 'none';
        if (rawToolbar) rawToolbar.style.display = 'flex';
        if (paramToolbar) paramToolbar.style.display = 'none';
        if (analysisToolbar) analysisToolbar.style.display = 'none';
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

    const mode = (currentDataMode === 'analysis') ? 'raw' : (currentDataMode || 'raw');
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
                let loadedUnit = data.conc_unit || 'ppm';
                if (!['ppm', 'ppb', 'ppt'].includes(loadedUnit)) loadedUnit = 'ppm';

                currentSheetData = {
                    columns: data.columns || [],
                    rows: (data.rows || []).map(r => {
                        let divVal = (r.division !== undefined && r.division !== null && String(r.division).trim() !== '')
                            ? String(r.division).trim()
                            : ((r.values && r.values['구분']) || '');
                        const cDiv = String(divVal).replace(/[\s_\-]/g, '').toUpperCase();
                        if (cDiv === 'STD1' || cDiv === 'STD1(BLANK)' || cDiv.startsWith('STD1')) divVal = 'STD1(Blank)';
                        else if (cDiv === 'STD2' || cDiv.startsWith('STD2')) divVal = 'STD2';
                        else if (cDiv === 'STD3' || cDiv.startsWith('STD3')) divVal = 'STD3';
                        else if (cDiv === 'STD4' || cDiv.startsWith('STD4')) divVal = 'STD4';
                        else if (cDiv === 'STD5' || cDiv.startsWith('STD5')) divVal = 'STD5';
                        else if (cDiv === 'SAMPLE') divVal = '';

                        let concVal = (r.concentration !== undefined && r.concentration !== null && String(r.concentration).trim() !== '')
                            ? String(r.concentration).trim()
                            : ((r.values && r.values['농도'] !== undefined && r.values['농도'] !== null) ? String(r.values['농도']).trim() : '');

                        const vals = r.values || {};
                        vals['구분'] = divVal;
                        vals['농도'] = concVal;

                        return {
                            id: r.id,
                            db_id: r.db_id,
                            db_order: r.db_order,
                            date: r.date || getTodayString(),
                            division: divVal,
                            concentration: concVal,
                            values: vals
                        };
                    }),
                    concUnit: loadedUnit
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
                if (!currentSheetData.concUnit || !['ppm', 'ppb', 'ppt'].includes(currentSheetData.concUnit)) {
                    currentSheetData.concUnit = 'ppm';
                }
                // 행별 division / concentration 기본값 보정 및 values 동기화
                currentSheetData.rows.forEach(r => {
                    let divVal = (r.division !== undefined && r.division !== null && String(r.division).trim() !== '')
                        ? String(r.division).trim()
                        : ((r.values && r.values['구분']) || '');
                    const cDiv = String(divVal).replace(/[\s_\-]/g, '').toUpperCase();
                    if (cDiv === 'STD1' || cDiv === 'STD1(BLANK)' || cDiv.startsWith('STD1')) divVal = 'STD1(Blank)';
                    else if (cDiv === 'STD2' || cDiv.startsWith('STD2')) divVal = 'STD2';
                    else if (cDiv === 'STD3' || cDiv.startsWith('STD3')) divVal = 'STD3';
                    else if (cDiv === 'STD4' || cDiv.startsWith('STD4')) divVal = 'STD4';
                    else if (cDiv === 'STD5' || cDiv.startsWith('STD5')) divVal = 'STD5';
                    else if (cDiv === 'SAMPLE') divVal = '';
                    r.division = divVal;

                    let concVal = (r.concentration !== undefined && r.concentration !== null && String(r.concentration).trim() !== '')
                        ? String(r.concentration).trim()
                        : ((r.values && r.values['농도'] !== undefined && r.values['농도'] !== null) ? String(r.values['농도']).trim() : '');
                    r.concentration = concVal;

                    if (!r.values) r.values = {};
                    r.values['구분'] = divVal;
                    r.values['농도'] = concVal;
                });
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
        concUnit: 'ppm',
        rows: [
            {
                id: 'row_' + Date.now(),
                date: getTodayString(),
                division: '',
                concentration: '',
                values: initialValues
            }
        ]
    };
    saveCurrentSheetData(false);
}

/**
 * 시트 데이터 저장 (LocalStorage + DB 비동기 동기화)
 */
function saveCurrentSheetData(showIndicator = true, resetTable = false, immediate = false) {
    if (!currentSelectedSite || !currentSelectedEquip) return;

    const mode = (currentDataMode === 'analysis') ? 'raw' : (currentDataMode || 'raw');

    // 저장 전 division 및 concentration 양방향 동기화 보장
    if (currentSheetData && currentSheetData.rows) {
        currentSheetData.rows.forEach(r => {
            if (!r.values) r.values = {};
            const finalDiv = r.division || r.values['구분'] || '';
            r.division = finalDiv;
            r.values['구분'] = finalDiv;

            const finalConc = (r.concentration !== undefined && r.concentration !== null && r.concentration !== '')
                ? String(r.concentration)
                : (r.values['농도'] !== undefined && r.values['농도'] !== null ? String(r.values['농도']) : '');
            r.concentration = finalConc;
            r.values['농도'] = finalConc;
        });
    }

    const storageKey = `equip_sheet_${currentSelectedSite}_${currentSelectedEquip.key}_${mode}`;
    localStorage.setItem(storageKey, JSON.stringify(currentSheetData));

    const indicator = document.getElementById('data-save-indicator');
    if (showIndicator && indicator) {
        indicator.innerHTML = '<span class="save-dot saving"></span> DB 저장 중...';
    }

    // 디바운스로 빠른 타이핑 중 잦은 쿼리 방지 (resetTable 또는 immediate인 경우 즉시 전송)
    clearTimeout(dbSaveTimer);
    const delay = (resetTable || immediate) ? 0 : 350;
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
                    rows: (currentSheetData.rows || []).map(r => ({
                        id: r.id,
                        date: r.date,
                        division: r.division || (r.values && r.values['구분']) || '',
                        concentration: (r.concentration !== undefined && r.concentration !== null && r.concentration !== '')
                            ? String(r.concentration)
                            : ((r.values && r.values['농도'] !== undefined) ? String(r.values['농도']) : ''),
                        values: r.values || {}
                    })),
                    conc_unit: currentSheetData.concUnit || 'ppm',
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
window.toggleSheetSort = function (key) {
    if (!currentSheetData || !Array.isArray(currentSheetData.rows) || currentSheetData.rows.length === 0) return;

    if (currentSort.key === key) {
        currentSort.direction = (currentSort.direction === 'asc') ? 'desc' : 'asc';
    } else {
        currentSort.key = key;
        currentSort.direction = 'asc';
    }

    const isAsc = currentSort.direction === 'asc';

    if (key === '__no__') {
        // [요청 반영] No 클릭 시 데이터베이스 기준 순서(record_date DESC, db_id ASC)로 정렬 토글
        currentSheetData.rows.sort((a, b) => {
            const dateA = a.date || '';
            const dateB = b.date || '';
            let cmp = 0;

            if (dateA !== dateB) {
                // 날짜 최신순 (DESC)
                cmp = dateB.localeCompare(dateA);
            } else {
                // 동일 날짜 내에서는 DB 등록 ID / 등록 순서 기준 (ASC)
                let idA = a.db_id !== undefined && a.db_id !== null ? Number(a.db_id) : (a.db_order !== undefined ? a.db_order : 0);
                let idB = b.db_id !== undefined && b.db_id !== null ? Number(b.db_id) : (b.db_order !== undefined ? b.db_order : 0);
                if (isNaN(idA)) idA = 0;
                if (isNaN(idB)) idB = 0;
                cmp = idA - idB;
            }

            return isAsc ? cmp : -cmp;
        });
    } else {
        currentSheetData.rows.sort((a, b) => {
            let valA, valB;

            if (key === '__date__') {
                valA = a.date || '';
                valB = b.date || '';
            } else if (key === '__division__') {
                valA = a.division || (a.values && a.values['구분']) || '';
                valB = b.division || (b.values && b.values['구분']) || '';
            } else if (key === '__concentration__') {
                valA = (a.concentration !== undefined && a.concentration !== null) ? a.concentration : ((a.values && a.values['농도']) || '');
                valB = (b.concentration !== undefined && b.concentration !== null) ? b.concentration : ((b.values && b.values['농도']) || '');
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
    } else if (currentDataMode === 'analysis') {
        renderAnalysisView();
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
                            <input type="text" class="data-param-input data-param-text-spec-val" style="text-align: center;" value="${escapeHtml(standardVal)}" 
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
                                <input type="text" class="data-param-input data-param-spec-val" style="text-align: center;" value="${escapeHtml(parsedSpec.val)}" 
                                       placeholder="기준값 (예: 100)" 
                                       onchange="handleParamSpecValChange('${row.id}', this.closest('.data-param-numeric-spec-wrap').querySelector('.data-param-op-select').value, this.value, this.closest('.data-param-numeric-spec-wrap').querySelector('.data-param-op-select'), this)">
                            </div>

                            <!-- ± 전용 2개 수치 입력 (기준값 ± 오차) -->
                            <div class="data-param-pm-val-wrap" style="${parsedSpec.op === '±' ? 'display: flex;' : 'display: none;'}">
                                <input type="text" class="data-param-input data-param-spec-center" style="text-align: center;" value="${escapeHtml(parsedSpec.center || '')}" 
                                       placeholder="기준(100)" title="기준값 (중심값)"
                                       onchange="handleParamPmChange('${row.id}', this)">
                                <span class="data-param-pm-divider">±</span>
                                <input type="text" class="data-param-input data-param-spec-tol" style="text-align: center;" value="${escapeHtml(parsedSpec.tol || '')}" 
                                       placeholder="오차(5)" title="오차 허용 범위"
                                       onchange="handleParamPmChange('${row.id}', this)">
                            </div>

                            <!-- ~ 전용 2개 수치 입력 (최소 ~ 최대 범위) -->
                            <div class="data-param-range-val-wrap" style="${parsedSpec.op === '~' ? 'display: flex;' : 'display: none;'}">
                                <input type="text" class="data-param-input data-param-spec-min" style="text-align: center;" value="${escapeHtml(parsedSpec.min || '')}" 
                                       placeholder="최소(10)" title="최솟값 (시작)"
                                       oninput="handleParamRangeChange('${row.id}', this)"
                                       onchange="handleParamRangeChange('${row.id}', this)">
                                <span class="data-param-range-divider">~</span>
                                <input type="text" class="data-param-input data-param-spec-max" style="text-align: center;" value="${escapeHtml(parsedSpec.max || '')}" 
                                       placeholder="최대(20)" title="최댓값 (끝)"
                                       oninput="handleParamRangeChange('${row.id}', this)"
                                       onchange="handleParamRangeChange('${row.id}', this)">
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <input type="text" class="data-param-input data-param-measured-val" value="${escapeHtml(measuredVal)}" 
                           data-row-id="${row.id}"
                           placeholder="${unitVal === '유무' ? '측정값 (예: 무)' : '측정값 (예: 99.8)'}" 
                           onchange="handleParamMeasuredChange('${row.id}', this.value)"
                           onkeydown="handleParamMeasuredKeydown(event, '${row.id}', this)">
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

    // 6. 단독 "~" 또는 숫자 없는 "~ [단위]" 형태
    if (s === '~' || (s.startsWith('~') && !s.match(/^~\s*[+-]?\d/))) {
        return { op: '~', val: '', min: '', max: '', center: '', tol: '' };
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
        if (prevVal) {
            const parsedPrev = parseParamStandard(prevVal);
            if (parsedPrev.min || parsedPrev.max) {
                if (minInput && !minInput.value) minInput.value = parsedPrev.min || '';
                if (maxInput && !maxInput.value) maxInput.value = parsedPrev.max || '';
            } else if (!minInput || !minInput.value) {
                const stripped = stripUnitFromValue(prevVal, unit);
                if (minInput) minInput.value = stripped;
            }
        }

        const minVal = minInput ? minInput.value.trim() : '';
        const maxVal = maxInput ? maxInput.value.trim() : '';

        if (minVal && maxVal) combined = `${minVal} ~ ${maxVal}`;
        else if (minVal) combined = `${minVal} ~`;
        else if (maxVal) combined = `~ ${maxVal}`;
        else combined = '~';

        if (minInput && !minInput.value) {
            minInput.focus();
        } else if (maxInput && !maxInput.value) {
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

    if (combined && combined !== '~' && combined !== '±' && unit) {
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

    if (combined && combined !== '~' && combined !== '±' && unit) {
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
                    handleParamRangeChange(rowId, minInput || maxInput);
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
 * [요청 반영] 측정값 입력창에서 Enter 키 입력 시 적용 및 다음 행(아래칸) 측정값으로 포커스 이동
 */
function handleParamMeasuredKeydown(e, rowId, input) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
        if (e.key === 'Enter') {
            e.preventDefault();
            // 현재 입력값 즉시 적용 및 DB 즉시 저장
            handleParamMeasuredChange(rowId, input.value, true);
        }

        // 아래 행(다음 행)의 측정값 입력창 탐색
        const currentTr = input.closest('tr');
        if (currentTr) {
            const nextTr = currentTr.nextElementSibling;
            if (nextTr) {
                const nextInput = nextTr.querySelector('.data-param-measured-val');
                if (nextInput) {
                    if (e.key === 'ArrowDown') e.preventDefault();
                    nextInput.focus();
                    nextInput.select();
                }
            } else if (e.key === 'Enter') {
                input.blur();
            }
        }
    } else if (e.key === 'ArrowUp') {
        // 위 행(이전 행) 측정값 입력창으로 포커스 이동
        const currentTr = input.closest('tr');
        if (currentTr) {
            const prevTr = currentTr.previousElementSibling;
            if (prevTr) {
                const prevInput = prevTr.querySelector('.data-param-measured-val');
                if (prevInput) {
                    e.preventDefault();
                    prevInput.focus();
                    prevInput.select();
                }
            }
        }
    }
}

/**
 * 측정값 입력 변경 처리 (단위 자동 부착 및 자동 판정 트리거)
 */
function handleParamMeasuredChange(rowId, value, immediateSave = false) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    const unit = row && row.values ? (row.values['단위'] || '') : '';

    let finalVal = (value || '').trim();
    if (finalVal && unit) {
        finalVal = attachUnitToValue(stripUnitFromValue(finalVal, unit), unit);
        const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (tr) {
            const mInput = tr.querySelector('.data-param-measured-val');
            if (mInput && mInput.value !== finalVal) mInput.value = finalVal;
        }
    }

    updateParamCell(rowId, '측정값', finalVal, immediateSave);
    autoEvaluateRowResult(rowId);
}

/**
 * 파라미터 특정 셀 값 갱신
 */
function updateParamCell(rowId, field, value, immediateSave = false) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (row) {
        if (!row.values) row.values = {};
        row.values[field] = value;
        saveCurrentSheetData(!immediateSave, false, immediateSave);
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
            // [수정] 서버에서 불러온 순서(등록된 순서) 그대로 보존 (임의 재정렬 방지)
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

    // No 컬럼 (좌우 스크롤 고정)
    headHtml += `<th class="sheet-th-no sheet-sticky-col sheet-sticky-no" onclick="toggleSheetSort('__no__')" title="순번 기준 정렬 (클릭 시 토글)">No</th>`;

    // 날짜 컬럼 (좌우 스크롤 고정)
    headHtml += `<th class="sheet-th-date sheet-sticky-col sheet-sticky-date" onclick="toggleSheetSort('__date__')" title="날짜 기준 정렬 (클릭 시 토글)">📅 날짜</th>`;

    // 구분 컬럼 (좌우 스크롤 고정)
    headHtml += `<th class="sheet-th-division sheet-sticky-col sheet-sticky-division" onclick="toggleSheetSort('__division__')" title="구분 기준 정렬 (클릭 시 토글)">구분</th>`;

    // 농도 컬럼 (좌우 스크롤 고정 + 헤더 단위 선택 드롭다운)
    let curConcUnit = currentSheetData.concUnit || 'ppm';
    if (!['ppm', 'ppb', 'ppt'].includes(curConcUnit)) {
        curConcUnit = 'ppm';
        currentSheetData.concUnit = 'ppm';
    }
    headHtml += `
        <th class="sheet-th-conc sheet-sticky-col sheet-sticky-conc" title="농도 (헤더에서 단위 선택 가능)">
            <div class="sheet-conc-header-inner">
                <span class="sheet-conc-title" onclick="toggleSheetSort('__concentration__')" title="농도 기준 정렬">농도</span>
                <select class="sheet-conc-unit-select" id="sheet-conc-unit-select" onchange="updateSheetConcUnit(this.value)" title="농도 단위 선택 (ppm, ppb, ppt)">
                    <option value="ppm" ${curConcUnit === 'ppm' ? 'selected' : ''}>ppm</option>
                    <option value="ppb" ${curConcUnit === 'ppb' ? 'selected' : ''}>ppb</option>
                    <option value="ppt" ${curConcUnit === 'ppt' ? 'selected' : ''}>ppt</option>
                </select>
            </div>
        </th>
    `;

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
        const colSpan = columns.length + 5;
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

        // No 컬럼 (좌우 스크롤 고정, 클릭 시 행 전체 선택)
        bodyHtml += `<td class="sheet-td-no sheet-sticky-col sheet-sticky-no" data-row-idx="${rowIdx}" data-is-no="true" title="행 전체 선택 (클릭 후 Del 키로 행 삭제)" style="color:#8b949e; text-align:center; user-select:none; font-size:11px; cursor:pointer;">${rowIdx + 1}</td>`;

        // 날짜 컬럼 (좌우 스크롤 고정, colIdx = 0)
        bodyHtml += `
            <td class="sheet-td-date sheet-sticky-col sheet-sticky-date" data-row-idx="${rowIdx}" data-col-idx="0" style="text-align: center;">
                <input type="date" class="sheet-cell-input sheet-date-input custom-date-icon" value="${row.date || ''}" max="9999-12-31" 
                       data-row-id="${row.id}" data-row-idx="${rowIdx}" data-col-idx="0" data-field="date"
                       onchange="updateRowDate('${row.id}', this.value)" title="날짜 변경">
            </td>
        `;

        // 구분 컬럼 (좌우 스크롤 고정, colIdx = 1, 셀 텍스트는 드래그/선택 가능하고 우측 화살표 클릭 시에만 드롭다운 노출)
        let curDiv = row.division || (row.values && row.values['구분']) || '';
        const cleanCurDiv = String(curDiv).replace(/[\s_\-]/g, '').toUpperCase();
        if (cleanCurDiv === 'STD1' || cleanCurDiv === 'STD1(BLANK)' || cleanCurDiv.startsWith('STD1')) {
            curDiv = 'STD1(Blank)';
        } else if (cleanCurDiv === 'STD2' || cleanCurDiv.startsWith('STD2')) {
            curDiv = 'STD2';
        } else if (cleanCurDiv === 'STD3' || cleanCurDiv.startsWith('STD3')) {
            curDiv = 'STD3';
        } else if (cleanCurDiv === 'STD4' || cleanCurDiv.startsWith('STD4')) {
            curDiv = 'STD4';
        } else if (cleanCurDiv === 'STD5' || cleanCurDiv.startsWith('STD5')) {
            curDiv = 'STD5';
        } else if (cleanCurDiv === '기타' || cleanCurDiv === 'ETC') {
            curDiv = '기타';
        } else if (cleanCurDiv === 'SAMPLE') {
            curDiv = '';
        }
        bodyHtml += `
            <td class="sheet-td-division sheet-sticky-col sheet-sticky-division" data-row-idx="${rowIdx}" data-col-idx="1">
                <div class="sheet-division-cell-wrap">
                    <span class="sheet-division-text" data-row-idx="${rowIdx}" data-col-idx="1" title="${escapeHtml(curDiv || '-')}">${escapeHtml(curDiv || '-')}</span>
                    <div class="sheet-division-arrow-wrap" title="구분 선택">
                        <span class="sheet-division-arrow-icon">▾</span>
                        <select class="sheet-select-division-arrow" data-row-id="${row.id}" onchange="updateRowDivision('${row.id}', this.value)">
                            <option value="" ${!curDiv ? 'selected' : ''}>-</option>
                            <option value="STD1(Blank)" ${curDiv === 'STD1(Blank)' ? 'selected' : ''}>STD1(Blank)</option>
                            <option value="STD2" ${curDiv === 'STD2' ? 'selected' : ''}>STD2</option>
                            <option value="STD3" ${curDiv === 'STD3' ? 'selected' : ''}>STD3</option>
                            <option value="STD4" ${curDiv === 'STD4' ? 'selected' : ''}>STD4</option>
                            <option value="STD5" ${curDiv === 'STD5' ? 'selected' : ''}>STD5</option>
                            <option value="기타" ${curDiv === '기타' ? 'selected' : ''}>기타</option>
                        </select>
                    </div>
                </div>
            </td>
        `;

        // 농도 컬럼 (좌우 스크롤 고정 + 셀 입력창, colIdx = 2)
        const curConc = (row.concentration !== undefined && row.concentration !== null && row.concentration !== '')
            ? row.concentration
            : ((row.values && row.values['농도'] !== undefined) ? row.values['농도'] : '');
        bodyHtml += `
            <td class="sheet-td-conc sheet-sticky-col sheet-sticky-conc" data-row-idx="${rowIdx}" data-col-idx="2">
                <input type="text" class="sheet-cell-input sheet-conc-cell-input" value="${escapeHtml(curConc)}" 
                       data-row-id="${row.id}" data-row-idx="${rowIdx}" data-col-idx="2" data-field="concentration" 
                       placeholder="-" autocomplete="off" onchange="updateRowConcentration('${row.id}', this.value)">
            </td>
        `;

        // 사용자 정의 동적 열들 (측정 데이터 열은 숫자 및 소수점만 입력 허용, colIdx = 3, 4, 5...)
        columns.forEach((col, colIdx) => {
            const val = (row.values && row.values[col] !== undefined) ? row.values[col] : '';
            const actualColIdx = 3 + colIdx;
            bodyHtml += `
                <td class="sheet-td-data" data-row-idx="${rowIdx}" data-col-idx="${actualColIdx}" style="width: 160px; min-width: 150px;">
                    <input type="text" class="sheet-cell-input sheet-number-cell-input" value="${escapeHtml(val)}" 
                           data-row-id="${row.id}" data-row-idx="${rowIdx}" data-col-idx="${actualColIdx}" data-col-name="${escapeHtml(col)}" 
                           placeholder="-" autocomplete="off" inputmode="decimal">
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

    // 다중 셀 마우스/터치 드래그 범위 선택 이벤트 바인딩
    bindRangeSelectionEvents();
}

/**
 * 열 드래그 앤 드롭 이동 관련 상태
 */
let draggedColIdx = null;
let isDraggingColumn = false;

/**
 * 열 헤더 클릭 핸들러 (드래그 직후 클릭 오동작 방지)
 */
window.handleColHeaderClick = function (e, col) {
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

    pushSheetUndoSnapshot();

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
 * 다음 입력 가능한 input 탐색 헬퍼 (구분 컬럼 등 건너뜀)
 */
function findNextSheetInput(rIdx, cIdx, forward = true) {
    const totalCols = 3 + ((currentSheetData && currentSheetData.columns) ? currentSheetData.columns.length : 0);
    let cur = cIdx + (forward ? 1 : -1);
    while (cur >= 0 && cur < totalCols) {
        const el = document.querySelector(`.sheet-cell-input[data-row-idx="${rIdx}"][data-col-idx="${cur}"]`);
        if (el) return { input: el, col: cur };
        cur += (forward ? 1 : -1);
    }
    return null;
}

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

        let hasPushedSnapshotForThisFocus = false;
        input.addEventListener('focus', () => {
            hasPushedSnapshotForThisFocus = false;
        });

        // 컬럼(측정 데이터 열)의 경우 숫자(소수점, 음수부호 포함)만 입력 허용
        input.addEventListener('beforeinput', (e) => {
            if (input.dataset.colName && e.data) {
                if (/[^0-9.-]/.test(e.data)) {
                    e.preventDefault();
                }
            }
        });

        // 값 변경 시 자동 저장 및 숫자 정제
        input.addEventListener('input', (e) => {
            if (!hasPushedSnapshotForThisFocus) {
                pushSheetUndoSnapshot();
                hasPushedSnapshotForThisFocus = true;
            }

            const rowId = e.target.dataset.rowId;
            const colName = e.target.dataset.colName;
            const field = e.target.dataset.field;
            let value = e.target.value;

            // 컬럼에 추가되는 데이터는 숫자만 입력되게 처리 (마이너스 부호, 소수점은 적절히 보존)
            if (colName) {
                let filtered = value.replace(/[^0-9.-]/g, '');
                if (filtered.indexOf('-') > 0 || (filtered.match(/-/g) || []).length > 1) {
                    const isNeg = filtered.startsWith('-');
                    filtered = (isNeg ? '-' : '') + filtered.replace(/-/g, '');
                }
                const parts = filtered.split('.');
                if (parts.length > 2) {
                    filtered = parts[0] + '.' + parts.slice(1).join('');
                }
                if (e.target.value !== filtered) {
                    e.target.value = filtered;
                }
                value = filtered;
            }

            const row = currentSheetData.rows.find(r => r.id === rowId);
            if (row) {
                if (field === 'concentration') {
                    row.concentration = value;
                    if (!row.values) row.values = {};
                    row.values['농도'] = value;
                } else if (field === 'date') {
                    row.date = value;
                } else if (colName) {
                    if (!row.values) row.values = {};
                    row.values[colName] = value;
                }
                saveCurrentSheetData(true);
            }
        });

        // 키보드 내비게이션 (Tab, Enter, ArrowUp, ArrowDown)
        input.addEventListener('keydown', (e) => {
            const rIdx = parseInt(input.dataset.rowIdx, 10);
            const cIdx = parseInt(input.dataset.colIdx, 10);
            const totalRows = currentSheetData.rows.length;

            if (e.key === 'Tab') {
                if (tabStartColIndex === null) {
                    tabStartColIndex = cIdx;
                }

                if (!e.shiftKey) {
                    // 오른쪽 열로 이동
                    const next = findNextSheetInput(rIdx, cIdx, true);
                    if (next) {
                        e.preventDefault();
                        next.input.focus();
                        if (typeof next.input.select === 'function') next.input.select();
                        next.input.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                    } else {
                        // 마지막 열에서 Tab 누르면 다음 행의 시작 열로 이동
                        if (rIdx + 1 < totalRows) {
                            e.preventDefault();
                            const targetCol = (tabStartColIndex !== null) ? tabStartColIndex : 0;
                            const nextRowInput = document.querySelector(`.sheet-cell-input[data-row-idx="${rIdx + 1}"][data-col-idx="${targetCol}"]`) ||
                                document.querySelector(`.sheet-cell-input[data-row-idx="${rIdx + 1}"]`);
                            if (nextRowInput) {
                                nextRowInput.focus();
                                if (typeof nextRowInput.select === 'function') nextRowInput.select();
                                nextRowInput.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                            }
                        }
                    }
                } else {
                    // Shift + Tab (왼쪽 열로 이동)
                    const prev = findNextSheetInput(rIdx, cIdx, false);
                    if (prev) {
                        e.preventDefault();
                        tabStartColIndex = prev.col;
                        prev.input.focus();
                        if (typeof prev.input.select === 'function') prev.input.select();
                        prev.input.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                    }
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();

                // 엔터 시: Tab을 누르기 시작한 열(없으면 현재 열)의 다음 행으로 복귀 이동 (Excel 동작)
                const targetCol = (tabStartColIndex !== null) ? tabStartColIndex : cIdx;
                const nextRowIdx = rIdx + 1;
                tabStartColIndex = targetCol;

                if (nextRowIdx < totalRows) {
                    const nextInput = document.querySelector(`.sheet-cell-input[data-row-idx="${nextRowIdx}"][data-col-idx="${targetCol}"]`) ||
                        document.querySelector(`.sheet-cell-input[data-row-idx="${nextRowIdx}"]`);
                    if (nextInput) {
                        nextInput.focus();
                        if (typeof nextInput.select === 'function') nextInput.select();
                        nextInput.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                    }
                } else {
                    // 마지막 행이면 아래(맨 끝)에 새 행을 추가하고 해당 시작 열로 이동
                    addSheetRow(null, false, true);
                    setTimeout(() => {
                        const newRowInput = document.querySelector(`.sheet-cell-input[data-row-idx="${nextRowIdx}"][data-col-idx="${targetCol}"]`) ||
                            document.querySelector(`.sheet-cell-input[data-row-idx="${nextRowIdx}"]`);
                        if (newRowInput) {
                            newRowInput.focus();
                            if (typeof newRowInput.select === 'function') newRowInput.select();
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
                        if (typeof nextCell.select === 'function') nextCell.select();
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
                        if (typeof prevCell.select === 'function') prevCell.select();
                        prevCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                    }
                }
            }
        });
    });
}

/**
 * 다중 셀 선택 범위 상태 관리
 */
let sheetRange = {
    isSelecting: false,
    isRowSelection: false, // No 번호 클릭으로 행 전체가 선택된 상태
    start: null, // { row: number, col: number }
    end: null    // { row: number, col: number }
};

/**
 * 셀 선택 영역 UI 초기화
 */
function clearSheetRangeSelection() {
    sheetRange.isSelecting = false;
    sheetRange.isRowSelection = false;
    sheetRange.start = null;
    sheetRange.end = null;
    document.querySelectorAll('#data-sheet-tbody td.sheet-cell-selected, #data-sheet-tbody td.sheet-cell-selected-anchor')
        .forEach(td => td.classList.remove('sheet-cell-selected', 'sheet-cell-selected-anchor'));
}

/**
 * 선택된 범위 하이라이트 UI 반영
 */
function updateSheetRangeUI() {
    if (!sheetRange.start || !sheetRange.end) return;

    const minR = Math.min(sheetRange.start.row, sheetRange.end.row);
    const maxR = Math.max(sheetRange.start.row, sheetRange.end.row);
    const minC = Math.min(sheetRange.start.col, sheetRange.end.col);
    const maxC = Math.max(sheetRange.start.col, sheetRange.end.col);

    const allTds = document.querySelectorAll('#data-sheet-tbody td[data-row-idx]');
    allTds.forEach(td => {
        const r = parseInt(td.dataset.rowIdx, 10);
        const c = parseInt(td.dataset.colIdx, 10);
        const isNoCell = td.classList.contains('sheet-td-no') || td.dataset.isNo === 'true';

        if (isNaN(r)) return;

        // No 셀인 경우 행 전체 선택일 때 선택 하이라이트
        if (isNoCell) {
            if (sheetRange.isRowSelection && r >= minR && r <= maxR) {
                td.classList.add('sheet-cell-selected');
            } else {
                td.classList.remove('sheet-cell-selected');
            }
            return;
        }

        if (isNaN(c)) return;

        const isInside = (r >= minR && r <= maxR && c >= minC && c <= maxC);
        const isAnchor = (!sheetRange.isRowSelection && r === sheetRange.start.row && c === sheetRange.start.col);

        if (isInside) {
            td.classList.add('sheet-cell-selected');
        } else {
            td.classList.remove('sheet-cell-selected');
        }

        if (isAnchor) {
            td.classList.add('sheet-cell-selected-anchor');
        } else {
            td.classList.remove('sheet-cell-selected-anchor');
        }
    });
}

/**
 * 다중 셀 드래그 범위 선택 이벤트 바인딩 (마우스 및 모바일 터치 완벽 호환, No 클릭 시 행 전체 선택 지원)
 */
function bindRangeSelectionEvents() {
    const tbody = document.getElementById('data-sheet-tbody');
    if (!tbody) return;

    // 포인터 다운: 드래그 선택 시작
    tbody.onpointerdown = (e) => {
        // 행 삭제 버튼 또는 화살표 드롭다운 클릭 시에는 범위 선택 제외
        if (e.target.closest('.sheet-row-del-btn') || e.target.closest('.sheet-division-arrow-wrap')) {
            return;
        }

        const td = e.target.closest('td[data-row-idx]');
        if (!td) {
            clearSheetRangeSelection();
            return;
        }

        const r = parseInt(td.dataset.rowIdx, 10);
        if (isNaN(r)) return;

        const isNoCol = td.classList.contains('sheet-td-no') || td.dataset.isNo === 'true';
        const totalCols = 3 + ((currentSheetData && currentSheetData.columns) ? currentSheetData.columns.length : 0);

        if (isNoCol) {
            // No 숫자 클릭: 해당 행 전체 선택
            sheetRange.isSelecting = true;
            sheetRange.isRowSelection = true;
            sheetRange.start = { row: r, col: 0 };
            sheetRange.end = { row: r, col: totalCols - 1 };
            updateSheetRangeUI();
            return;
        }

        const c = parseInt(td.dataset.colIdx, 10);
        if (isNaN(c)) return;

        // 일반 셀 클릭
        sheetRange.isSelecting = true;
        sheetRange.isRowSelection = false;
        sheetRange.start = { row: r, col: c };
        sheetRange.end = { row: r, col: c };
        updateSheetRangeUI();
    };

    // 포인터 이동: 드래그 중 다른 셀로 이동 시 범위 확장
    tbody.onpointermove = (e) => {
        if (!sheetRange.isSelecting || !sheetRange.start) return;

        const elem = document.elementFromPoint(e.clientX, e.clientY);
        if (!elem) return;

        const td = elem.closest('#data-sheet-tbody td[data-row-idx]');
        if (!td) return;

        const r = parseInt(td.dataset.rowIdx, 10);
        if (isNaN(r)) return;

        const totalCols = 3 + ((currentSheetData && currentSheetData.columns) ? currentSheetData.columns.length : 0);

        if (sheetRange.isRowSelection) {
            // 행 단위 드래그 확장
            if (sheetRange.end.row !== r) {
                sheetRange.end = { row: r, col: totalCols - 1 };
                updateSheetRangeUI();
            }
            return;
        }

        const c = parseInt(td.dataset.colIdx, 10);
        if (isNaN(c)) return;

        if (sheetRange.end.row !== r || sheetRange.end.col !== c) {
            sheetRange.end = { row: r, col: c };
            updateSheetRangeUI();
        }
    };
}

// 전역 포인터 업: 드래그 종료
window.addEventListener('pointerup', () => {
    if (sheetRange.isSelecting) {
        sheetRange.isSelecting = false;
    }
});

// 외부 클릭 시 범위 선택 해제 (단, Raw Data 뷰 내부 클릭은 유지)
document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#data-raw-view')) {
        clearSheetRangeSelection();
    }
});

/**
 * 셀 값 조회 헬퍼 (2D 그리드 좌표 기반)
 */
function getRawSheetCellValue(rowIdx, colIdx) {
    if (!currentSheetData || !currentSheetData.rows || !currentSheetData.rows[rowIdx]) return '';
    const row = currentSheetData.rows[rowIdx];
    if (colIdx === 0) return row.date || '';
    if (colIdx === 1) return row.division || (row.values && row.values['구분']) || '';
    if (colIdx === 2) return (row.concentration !== undefined && row.concentration !== null) ? String(row.concentration) : ((row.values && row.values['농도']) || '');
    if (colIdx >= 3) {
        const cName = currentSheetData.columns[colIdx - 3];
        return (row.values && cName && row.values[cName] !== undefined) ? String(row.values[cName]) : '';
    }
    return '';
}

/**
 * 셀 값 수정 헬퍼 (2D 그리드 좌표 기반, 자동 확장 및 정규화)
 */
function setRawSheetCellValue(rowIdx, colIdx, val) {
    if (!currentSheetData || !currentSheetData.rows) return;
    while (currentSheetData.rows.length <= rowIdx) {
        addSheetRow(null, false, true);
    }
    const row = currentSheetData.rows[rowIdx];
    if (!row) return;

    const trimmed = String(val !== undefined && val !== null ? val : '').trim();

    if (colIdx === 0) {
        row.date = normalizeDate(trimmed) || trimmed;
    } else if (colIdx === 1) {
        let cleanDiv = trimmed.replace(/[\s_\-]/g, '').toUpperCase();
        if (cleanDiv === 'STD1' || cleanDiv === 'STD1(BLANK)' || cleanDiv.startsWith('STD1')) {
            row.division = 'STD1(Blank)';
        } else if (cleanDiv === 'STD2' || cleanDiv.startsWith('STD2')) {
            row.division = 'STD2';
        } else if (cleanDiv === 'STD3' || cleanDiv.startsWith('STD3')) {
            row.division = 'STD3';
        } else if (cleanDiv === 'STD4' || cleanDiv.startsWith('STD4')) {
            row.division = 'STD4';
        } else if (cleanDiv === 'STD5' || cleanDiv.startsWith('STD5')) {
            row.division = 'STD5';
        } else if (cleanDiv === '기타' || cleanDiv === 'ETC') {
            row.division = '기타';
            row.concentration = '-';
            if (!row.values) row.values = {};
            row.values['농도'] = '-';
        } else if (cleanDiv === 'SAMPLE') {
            row.division = '';
        } else {
            row.division = trimmed;
        }
        if (!row.values) row.values = {};
        row.values['구분'] = row.division;
    } else if (colIdx === 2) {
        row.concentration = trimmed;
        if (!row.values) row.values = {};
        row.values['농도'] = trimmed;
    } else if (colIdx >= 3) {
        const cName = currentSheetData.columns[colIdx - 3];
        if (cName) {
            if (!row.values) row.values = {};
            // 컬럼 데이터는 숫자만 허용
            let numTrimmed = trimmed.replace(/[^0-9.-]/g, '');
            if (numTrimmed.indexOf('-') > 0 || (numTrimmed.match(/-/g) || []).length > 1) {
                const isNeg = numTrimmed.startsWith('-');
                numTrimmed = (isNeg ? '-' : '') + numTrimmed.replace(/-/g, '');
            }
            const parts = numTrimmed.split('.');
            if (parts.length > 2) {
                numTrimmed = parts[0] + '.' + parts.slice(1).join('');
            }
            row.values[cName] = numTrimmed;
        }
    }
}

/**
 * Undo(실행 취소) 히스토리 스택 관리
 */
const MAX_SHEET_UNDO_STACK = 30;
let sheetUndoStack = [];

function pushSheetUndoSnapshot() {
    if (!currentSheetData || currentDataMode !== 'raw') return;
    try {
        const snapshot = JSON.parse(JSON.stringify(currentSheetData));
        sheetUndoStack.push(snapshot);
        if (sheetUndoStack.length > MAX_SHEET_UNDO_STACK) {
            sheetUndoStack.shift();
        }
    } catch (e) {
        console.warn('pushSheetUndoSnapshot error:', e);
    }
}

function undoSheetAction() {
    if (currentDataMode !== 'raw') return;
    if (!sheetUndoStack || sheetUndoStack.length === 0) {
        showSheetToast('이전 작업 상태가 없습니다.');
        return;
    }

    const prevState = sheetUndoStack.pop();
    if (!prevState) return;

    currentSheetData = prevState;
    saveCurrentSheetData(true);
    renderSheetTable();
    clearSheetRangeSelection();
    showSheetToast('실행 취소(Ctrl+Z) 완료');
}

/**
 * 복사 완료/붙여넣기 완료/삭제/실행취소 토스트 알림 (2초 후 자동 사라짐)
 */
function showSheetToast(msg) {
    let toast = document.getElementById('sheet-copy-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sheet-copy-toast';
        toast.className = 'sheet-copy-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

/**
 * 단축키 복사 (Ctrl+C / Cmd+C) 처리
 */
function handleCopySheetCells(e) {
    if (currentDataMode !== 'raw') return;
    if (!sheetRange.start || !sheetRange.end) return;

    // 만약 현재 어떤 input 내부에서 텍스트 일부만 선택한 상태라면 브라우저 기본 복사에 맡김
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        if (activeEl.selectionStart !== activeEl.selectionEnd) {
            return;
        }
    }

    const minR = Math.min(sheetRange.start.row, sheetRange.end.row);
    const maxR = Math.max(sheetRange.start.row, sheetRange.end.row);
    const minC = Math.min(sheetRange.start.col, sheetRange.end.col);
    const maxC = Math.max(sheetRange.start.col, sheetRange.end.col);

    const lines = [];
    for (let r = minR; r <= maxR; r++) {
        const rowVals = [];
        for (let c = minC; c <= maxC; c++) {
            rowVals.push(getRawSheetCellValue(r, c));
        }
        lines.push(rowVals.join('\t'));
    }

    const tsv = lines.join('\r\n');
    if (!tsv) return;

    e.preventDefault();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv).then(() => {
            const cellCount = (maxR - minR + 1) * (maxC - minC + 1);
            showSheetToast(`${cellCount}개 셀이 복사되었습니다.`);
        }).catch(() => {
            fallbackCopyText(tsv);
        });
    } else {
        fallbackCopyText(tsv);
    }
}

function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
        document.execCommand('copy');
        showSheetToast('셀이 복사되었습니다.');
    } catch (err) {
        console.warn('Copy failed:', err);
    }
    document.body.removeChild(ta);
}

/**
 * 선택된 셀/행 내용 일괄 삭제 (Delete 키) 처리
 */
function handleDeleteSheetCells(e) {
    if (currentDataMode !== 'raw') return;
    if (!sheetRange.start || !sheetRange.end) return;

    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
    const isSingleCell = (sheetRange.start.row === sheetRange.end.row && sheetRange.start.col === sheetRange.end.col);

    // 단일 셀의 텍스트 필드 내부에서 캐럿 또는 부분 텍스트를 선택한 상태라면 브라우저 본래의 글자 삭제 동작에 맡김
    if (isInput && isSingleCell && !sheetRange.isRowSelection && activeEl.selectionStart !== activeEl.selectionEnd) {
        return;
    }

    e.preventDefault();
    pushSheetUndoSnapshot();

    const minR = Math.min(sheetRange.start.row, sheetRange.end.row);
    const maxR = Math.max(sheetRange.start.row, sheetRange.end.row);

    // 1. No를 눌러 행 전체가 선택된 상태인 경우: 해당 행(들) 자체를 삭제
    if (sheetRange.isRowSelection) {
        const delRowCount = maxR - minR + 1;
        currentSheetData.rows.splice(minR, delRowCount);

        // 만약 모든 행이 다 삭제되었으면 빈 행 1개 자동 생성
        if (currentSheetData.rows.length === 0) {
            const initialValues = {};
            (currentSheetData.columns || []).forEach(c => initialValues[c] = '');
            currentSheetData.rows.push({
                id: 'row_' + Date.now(),
                date: getTodayString(),
                division: '',
                concentration: '',
                values: initialValues
            });
        }

        saveCurrentSheetData(true);
        renderSheetTable();
        clearSheetRangeSelection();
        showSheetToast(`${delRowCount}개 행이 삭제되었습니다.`);
        return;
    }

    // 2. 일반 셀 범위가 선택된 상태인 경우: 해당 셀들의 내용만 빈값으로 삭제
    const minC = Math.min(sheetRange.start.col, sheetRange.end.col);
    const maxC = Math.max(sheetRange.start.col, sheetRange.end.col);

    let delCount = 0;
    for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
            setRawSheetCellValue(r, c, '');
            delCount++;
        }
    }

    saveCurrentSheetData(true);
    renderSheetTable();
    updateSheetRangeUI();
    showSheetToast(`${delCount}개 셀 내용이 삭제되었습니다.`);
}

/**
 * 단축키 붙여넣기 (Ctrl+V / Paste 이벤트) 처리
 */
function handlePasteSheetCells(e) {
    if (currentDataMode !== 'raw') return;

    // 붙여넣기 시작 셀 위치 찾기
    let startR = 0;
    let startC = 0;
    let hasTarget = false;

    if (sheetRange.start) {
        startR = Math.min(sheetRange.start.row, sheetRange.end.row);
        startC = Math.min(sheetRange.start.col, sheetRange.end.col);
        hasTarget = true;
    } else {
        const activeTd = document.activeElement ? document.activeElement.closest('#data-sheet-tbody td[data-row-idx]') : null;
        if (activeTd) {
            startR = parseInt(activeTd.dataset.rowIdx, 10);
            startC = parseInt(activeTd.dataset.colIdx, 10);
            hasTarget = true;
        }
    }

    if (!hasTarget) return;

    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const text = clipboardData.getData('text');
    if (!text) return;

    // 줄바꿈으로 행 분리
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    if (lines.length === 0) return;

    const grid = lines.map(line => line.split('\t'));

    e.preventDefault();
    pushSheetUndoSnapshot();

    // 행 수 부족 시 자동 확장
    const neededRows = startR + grid.length;
    while (currentSheetData.rows.length < neededRows) {
        addSheetRow(null, false, true);
    }

    const totalCols = 3 + (currentSheetData.columns ? currentSheetData.columns.length : 0);
    let updatedCount = 0;

    for (let rOffset = 0; rOffset < grid.length; rOffset++) {
        const rowVals = grid[rOffset];
        const targetR = startR + rOffset;
        for (let cOffset = 0; cOffset < rowVals.length; cOffset++) {
            const targetC = startC + cOffset;
            if (targetC < totalCols) {
                setRawSheetCellValue(targetR, targetC, rowVals[cOffset]);
                updatedCount++;
            }
        }
    }

    saveCurrentSheetData(true);
    renderSheetTable();

    // 붙여넣은 영역을 선택 상태로 표시
    const endR = startR + grid.length - 1;
    const maxColsInPaste = Math.max(...grid.map(g => g.length));
    const endC = Math.min(startC + maxColsInPaste - 1, totalCols - 1);
    sheetRange.start = { row: startR, col: startC };
    sheetRange.end = { row: endR, col: endC };
    updateSheetRangeUI();

    showSheetToast(`${updatedCount}개 셀에 붙여넣기 완료`);
}

/**
 * 복사 & 붙여넣기 & 삭제 & 실행취소 전역 이벤트 리스너 바인딩
 */
function bindCopyPasteEvents() {
    window.addEventListener('keydown', (e) => {
        if (currentDataMode !== 'raw') return;

        // 1. 복사 (Ctrl+C / Cmd+C)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            handleCopySheetCells(e);
            return;
        }

        // 2. 실행 취소 (Ctrl+Z / Cmd+Z, Shift 미포함)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
            e.preventDefault();
            undoSheetAction();
            return;
        }

        // 3. 셀 내용 삭제 (Delete / Del)
        if (e.key === 'Delete' || e.key === 'Del') {
            handleDeleteSheetCells(e);
            return;
        }
    });

    window.addEventListener('paste', (e) => {
        handlePasteSheetCells(e);
    });
}

/**
 * 구분 변경 핸들러 (선택 즉시 라벨 동기화 및 즉시 저장, 전체 테이블 재렌더 방지)
 */
window.updateRowDivision = function (rowId, val) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (row && row.division !== val) {
        pushSheetUndoSnapshot();
        row.division = val;
        if (!row.values) row.values = {};
        row.values['구분'] = val;

        // 전체 renderSheetTable() 대신 해당 행의 DOM 라벨만 부분 업데이트하여 다른 셀 입력 상태 보존
        const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (tr) {
            const labelSpan = tr.querySelector('.sheet-division-text');
            if (labelSpan) {
                labelSpan.textContent = val || '-';
                labelSpan.title = val || '-';
            }
            const selectEl = tr.querySelector('.sheet-select-division-arrow');
            if (selectEl && selectEl.value !== val) {
                selectEl.value = val;
            }
        }

        // '기타' 선택 시 농도를 '-' 로 자동 표기
        if (val === '기타') {
            row.concentration = '-';
            if (!row.values) row.values = {};
            row.values['농도'] = '-';
            if (tr) {
                const concInput = tr.querySelector('.sheet-conc-cell-input');
                if (concInput) {
                    concInput.value = '-';
                }
            }
        }

        // 즉시 동기화 저장
        saveCurrentSheetData(true, false, true);
    }
};

/**
 * 농도 변경 핸들러 (즉시 저장 및 row.values 동기화)
 */
window.updateRowConcentration = function (rowId, val) {
    if (!currentSheetData || !currentSheetData.rows) return;
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (row && row.concentration !== val) {
        pushSheetUndoSnapshot();
        row.concentration = val;
        if (!row.values) row.values = {};
        row.values['농도'] = val;
        // 즉시 동기화 저장
        saveCurrentSheetData(true, false, true);
    }
};

/**
 * 농도 단위 변경 핸들러 (헤더 드롭다운)
 */
window.updateSheetConcUnit = function (newUnit) {
    if (!currentSheetData) return;
    pushSheetUndoSnapshot();
    currentSheetData.concUnit = newUnit;
    saveCurrentSheetData(true);
};

/**
 * 날짜 변경 핸들러
 */
window.updateRowDate = function (rowId, newDate) {
    const row = currentSheetData.rows.find(r => r.id === rowId);
    if (row && row.date !== newDate) {
        pushSheetUndoSnapshot();
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

    pushSheetUndoSnapshot();

    const dateStr = specificDate || getTodayString();

    const newRow = {
        id: 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        date: dateStr,
        division: '',
        concentration: '',
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
window.deleteSheetRow = function (rowId) {
    const row = currentSheetData.rows.find(r => r.id === rowId);
    const dateLabel = row ? `(${row.date})` : '';
    if (!confirm(`해당 날짜${dateLabel} 행을 삭제하시겠습니까?`)) return;

    pushSheetUndoSnapshot();
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
window.editSheetColumn = function (colIdx) {
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
window.deleteSheetColumn = function (colIdx) {
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

    // 1. 헤더 (날짜, 구분, 농도(단위), ...동적 열들)
    const concUnit = currentSheetData.concUnit || 'ppm';
    const concHeader = `농도(${concUnit})`;
    const headers = ['날짜', '구분', concHeader, ...columns];
    csv += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';

    // 2. 행 데이터
    rows.forEach(row => {
        const divVal = row.division || (row.values && row.values['구분']) || '';
        const concVal = (row.concentration !== undefined && row.concentration !== null && row.concentration !== '')
            ? row.concentration
            : ((row.values && row.values['농도']) || '');
        const line = [
            `"${(row.date || '').replace(/"/g, '""')}"`,
            `"${String(divVal).replace(/"/g, '""')}"`,
            `"${String(concVal).replace(/"/g, '""')}"`,
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

    // 날짜, 구분, 농도 컬럼 인덱스 식별
    let dateColIdx = -1;
    let divColIdx = -1;
    let concColIdx = -1;

    for (let i = 0; i < headerRow.length; i++) {
        const colTitle = headerRow[i].toLowerCase().replace(/[\s_()（）]/g, '');
        if (['날짜', 'date', '일자', '기록일자', '측정일자', '측정일', '일시'].includes(colTitle)) {
            dateColIdx = i;
        } else if (['구분', 'division', 'type', 'category'].includes(colTitle)) {
            divColIdx = i;
        } else if (colTitle.startsWith('농도') || colTitle.startsWith('conc') || ['ppm', 'ppb', 'ppt'].includes(colTitle)) {
            concColIdx = i;
            // 농도 단위 자동 감지
            const rawHeader = headerRow[i].toLowerCase();
            if (rawHeader.includes('ppb')) currentSheetData.concUnit = 'ppb';
            else if (rawHeader.includes('ppt')) currentSheetData.concUnit = 'ppt';
            else if (rawHeader.includes('ppm')) currentSheetData.concUnit = 'ppm';
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

    // CSV 파일 기준 열 목록 구성 (순번/No 제외, 날짜, 구분, 농도 제외)
    const newColumns = [];
    const csvColMap = []; // { csvIdx, colName }

    for (let i = 0; i < headerRow.length; i++) {
        if (i === dateColIdx || i === divColIdx || i === concColIdx) continue;
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

        let divStr = (divColIdx !== -1 && rowArr[divColIdx] !== undefined) ? String(rowArr[divColIdx]).trim() : '';
        const cleanDiv = divStr.replace(/[\s_\-]/g, '').toUpperCase();
        if (cleanDiv === 'STD1' || cleanDiv === 'STD1(BLANK)' || cleanDiv.startsWith('STD1')) {
            divStr = 'STD1(Blank)';
        } else if (cleanDiv === 'STD2' || cleanDiv.startsWith('STD2')) {
            divStr = 'STD2';
        } else if (cleanDiv === 'STD3' || cleanDiv.startsWith('STD3')) {
            divStr = 'STD3';
        } else if (cleanDiv === 'STD4' || cleanDiv.startsWith('STD4')) {
            divStr = 'STD4';
        } else if (cleanDiv === 'STD5' || cleanDiv.startsWith('STD5')) {
            divStr = 'STD5';
        } else if (cleanDiv === 'SAMPLE') {
            divStr = '';
        }

        const concStr = (concColIdx !== -1 && rowArr[concColIdx] !== undefined) ? String(rowArr[concColIdx]).trim() : '';

        const vals = {};
        newColumns.forEach(c => vals[c] = '');

        csvColMap.forEach(({ csvIdx, colName }) => {
            vals[colName] = (rowArr[csvIdx] !== undefined) ? rowArr[csvIdx] : '';
        });

        newRows.push({
            id: 'row_' + Date.now() + '_' + rIdx + '_' + Math.random().toString(36).substr(2, 4),
            date: dateStr,
            division: divStr,
            concentration: concStr,
            values: vals
        });
    });

    // 기존 데이터 완전 대체
    currentSheetData.columns = newColumns;
    currentSheetData.rows = newRows;

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

    // Analysis 세그먼트 버튼
    const btnAnalysis = document.getElementById('btn-mode-analysis');
    if (btnAnalysis) {
        btnAnalysis.addEventListener('click', () => switchDataMode('analysis'));
    }

    // Analysis 툴바 버튼들
    const btnCopyChart = document.getElementById('btn-copy-analysis-chart');
    if (btnCopyChart) btnCopyChart.addEventListener('click', handleCopyAnalysisChart);

    const btnDownChart = document.getElementById('btn-download-analysis-chart');
    if (btnDownChart) btnDownChart.addEventListener('click', handleDownloadAnalysisChart);

    const btnRefreshChart = document.getElementById('btn-refresh-analysis');
    if (btnRefreshChart) btnRefreshChart.addEventListener('click', renderAnalysisView);

    // Analysis 필터 컨트롤러
    const divFilter = document.getElementById('analysis-division-filter');
    if (divFilter) {
        divFilter.addEventListener('change', (e) => {
            analysisDivisionFilter = e.target.value;
            updateAnalysisChart();
        });
    }

    const dateStart = document.getElementById('analysis-date-start');
    if (dateStart) {
        dateStart.addEventListener('change', (e) => {
            analysisStartDate = e.target.value;
            updateAnalysisChart();
        });
    }

    const dateEnd = document.getElementById('analysis-date-end');
    if (dateEnd) {
        dateEnd.addEventListener('change', (e) => {
            analysisEndDate = e.target.value;
            updateAnalysisChart();
        });
    }

    const btnResetDate = document.getElementById('btn-reset-analysis-date');
    if (btnResetDate) {
        btnResetDate.addEventListener('click', () => {
            analysisStartDate = '';
            analysisEndDate = '';
            if (dateStart) dateStart.value = '';
            if (dateEnd) dateEnd.value = '';
            updateAnalysisChart();
        });
    }

    const chartTypeSel = document.getElementById('analysis-chart-type');
    if (chartTypeSel) {
        chartTypeSel.addEventListener('change', (e) => {
            analysisChartType = e.target.value;
            updateAnalysisChart();
        });
    }

    // 작업 이력 연동 체크박스 토글
    const toggleWorkLogs = document.getElementById('analysis-toggle-work-logs');
    if (toggleWorkLogs) {
        toggleWorkLogs.addEventListener('change', (e) => {
            analysisShowWorkLogs = e.target.checked;
            updateAnalysisChart();
        });
    }

    const btnSelectAllCols = document.getElementById('btn-select-all-analysis-cols');
    if (btnSelectAllCols) {
        btnSelectAllCols.addEventListener('click', () => {
            const allCols = [...((currentSheetData && currentSheetData.columns) || [])];
            allCols.forEach(c => analysisSelectedCols.add(c));
            populateAnalysisColumnChips();
            updateAnalysisChart();
        });
    }

    const btnClearAllCols = document.getElementById('btn-clear-all-analysis-cols');
    if (btnClearAllCols) {
        btnClearAllCols.addEventListener('click', () => {
            analysisSelectedCols.clear();
            const allCols = [...((currentSheetData && currentSheetData.columns) || [])];
            if (allCols.length > 0) {
                analysisSelectedCols.add(allCols[0]); // 최소 1개는 유지
            }
            populateAnalysisColumnChips();
            updateAnalysisChart();
        });
    }

    // Raw Data 셀 복사 및 붙여넣기 이벤트 바인딩
    bindCopyPasteEvents();
}

/* ==========================================================================
   Analysis (Raw Data Trend 분석) 관련 로직
   ========================================================================== */

let analysisChartInstance = null;
let analysisSelectedCols = new Set();
let analysisDivisionFilter = 'ALL';
let analysisStartDate = '';
let analysisEndDate = '';
let analysisChartType = 'line';
let analysisShowWorkLogs = true; // 작업 이력 연동 플래그
let currentEquipWorkLogs = []; // 현재 장비의 작업 로그 캐시

const ANALYSIS_COLOR_PALETTE = [
    { stroke: '#388bfd', fill: 'rgba(56, 139, 253, 0.15)' },
    { stroke: '#3fb950', fill: 'rgba(63, 185, 80, 0.15)' },
    { stroke: '#f0883e', fill: 'rgba(240, 136, 62, 0.15)' },
    { stroke: '#a371f7', fill: 'rgba(163, 113, 247, 0.15)' },
    { stroke: '#39c5bb', fill: 'rgba(57, 197, 187, 0.15)' },
    { stroke: '#f85149', fill: 'rgba(248, 81, 73, 0.15)' },
    { stroke: '#e3b341', fill: 'rgba(227, 179, 65, 0.15)' },
    { stroke: '#79c0ff', fill: 'rgba(121, 192, 255, 0.15)' },
    { stroke: '#d2a8ff', fill: 'rgba(210, 168, 255, 0.15)' },
    { stroke: '#56d364', fill: 'rgba(86, 211, 100, 0.15)' }
];

/**
 * Analysis 뷰 렌더링 진입점
 */
function renderAnalysisView() {
    const rawView = document.getElementById('data-raw-view');
    const paramView = document.getElementById('data-param-view');
    const analysisView = document.getElementById('data-analysis-view');
    const rawToolbar = document.getElementById('toolbar-raw-actions');
    const paramToolbar = document.getElementById('toolbar-param-actions');
    const analysisToolbar = document.getElementById('toolbar-analysis-actions');

    if (rawView) rawView.style.display = 'none';
    if (paramView) paramView.style.display = 'none';
    if (analysisView) analysisView.style.display = 'flex';
    if (rawToolbar) rawToolbar.style.display = 'none';
    if (paramToolbar) paramToolbar.style.display = 'none';
    if (analysisToolbar) analysisToolbar.style.display = 'flex';

    // 타이틀 갱신
    const chartTitle = document.getElementById('analysis-chart-title');
    if (chartTitle && currentSelectedEquip) {
        chartTitle.textContent = `📈 [${currentSelectedEquip.displayName}] Raw Data Trend 분석`;
    }

    populateAnalysisFilters();
    populateAnalysisColumnChips();
    updateAnalysisChart();
}

/**
 * 구분 및 농도 필터 옵션 채우기 (표준 구분 상시 제안 및 농도 데이터 자동 연동)
 */
function populateAnalysisFilters() {
    const select = document.getElementById('analysis-division-filter');
    if (!select) return;

    const rows = (currentSheetData && currentSheetData.rows) || [];
    const unit = (currentSheetData && currentSheetData.concUnit) || 'ppm';

    // 1. 행 데이터에서 구분 및 농도 수집 & 정규화
    const divCounts = {
        'STD1(Blank)': 0,
        'STD2': 0,
        'STD3': 0,
        'STD4': 0,
        'STD5': 0
    };
    const extraDivs = new Map(); // 사용자 정의 기타 구분 { name => count }
    const concCounts = new Map(); // 농도 { concStr => count }

    rows.forEach(r => {
        // 구분 추출 및 정규화
        let rawDiv = (r.division !== undefined && r.division !== null ? r.division : ((r.values && r.values['구분']) || '')).trim();
        if (rawDiv) {
            const clean = String(rawDiv).replace(/[\s_\-]/g, '').toUpperCase();
            let normDiv = rawDiv;
            if (clean === 'STD1' || clean === 'STD1(BLANK)' || clean.startsWith('STD1')) normDiv = 'STD1(Blank)';
            else if (clean === 'STD2' || clean.startsWith('STD2')) normDiv = 'STD2';
            else if (clean === 'STD3' || clean.startsWith('STD3')) normDiv = 'STD3';
            else if (clean === 'STD4' || clean.startsWith('STD4')) normDiv = 'STD4';
            else if (clean === 'STD5' || clean.startsWith('STD5')) normDiv = 'STD5';

            if (divCounts.hasOwnProperty(normDiv)) {
                divCounts[normDiv]++;
            } else if (clean !== 'SAMPLE') {
                extraDivs.set(normDiv, (extraDivs.get(normDiv) || 0) + 1);
            }
        }

        // 농도 추출
        const rawConc = String(r.concentration !== undefined && r.concentration !== null && r.concentration !== ''
            ? r.concentration
            : ((r.values && r.values['농도'] !== undefined) ? r.values['농도'] : '')).trim();
        if (rawConc) {
            concCounts.set(rawConc, (concCounts.get(rawConc) || 0) + 1);
        }
    });

    let html = `<option value="ALL" ${analysisDivisionFilter === 'ALL' ? 'selected' : ''}>전체 데이터 (ALL) [${rows.length}건]</option>`;

    // 2. 구분(Division) 옵션 그룹 (STD1(Blank) ~ STD5는 항상 기본 제안)
    html += '<optgroup label="── 구분(Division)별 ──">';
    ['STD1(Blank)', 'STD2', 'STD3', 'STD4', 'STD5'].forEach(std => {
        const count = divCounts[std] || 0;
        const countText = count > 0 ? ` (${count}건)` : '';
        html += `<option value="div:${std}" ${analysisDivisionFilter === 'div:' + std ? 'selected' : ''}>${std}${countText}</option>`;
    });

    // 추가 사용자 정의 구분이 있다면 표출
    extraDivs.forEach((count, d) => {
        html += `<option value="div:${d}" ${analysisDivisionFilter === 'div:' + d ? 'selected' : ''}>${d} (${count}건)</option>`;
    });
    html += '</optgroup>';

    // 3. 농도(Concentration) 옵션 그룹
    if (concCounts.size > 0) {
        html += `<optgroup label="── 농도(Concentration, ${unit})별 ──">`;
        const sortedConcs = Array.from(concCounts.keys()).sort((a, b) => {
            const numA = parseFloat(a);
            const numB = parseFloat(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });

        sortedConcs.forEach(c => {
            const count = concCounts.get(c);
            html += `<option value="conc:${c}" ${analysisDivisionFilter === 'conc:' + c ? 'selected' : ''}>${c} ${unit} (${count}건)</option>`;
        });
        html += '</optgroup>';
    }

    select.innerHTML = html;
}

/**
 * 분석 가능한 컬럼 선택 칩(Chip) 렌더링
 */
function populateAnalysisColumnChips() {
    const container = document.getElementById('analysis-columns-chips');
    if (!container) return;

    // 농도 제외: 순수 데이터 컬럼들만 분석 대상 컬럼으로 표출
    const allCols = [...((currentSheetData && currentSheetData.columns) || [])];

    // 유효하지 않은 컬럼 제거 ('농도'가 저장되어 있던 경우에도 자동 배제)
    const validColSet = new Set(allCols);
    Array.from(analysisSelectedCols).forEach(c => {
        if (!validColSet.has(c)) {
            analysisSelectedCols.delete(c);
        }
    });

    // 기본 선택: 비어있다면 첫 번째 데이터 열 자동 선택
    if (analysisSelectedCols.size === 0 && allCols.length > 0) {
        analysisSelectedCols.add(allCols[0]);
        if (allCols.length > 1) {
            analysisSelectedCols.add(allCols[1]);
        }
    }

    container.innerHTML = '';

    if (allCols.length === 0) {
        container.innerHTML = '<span style="color: #8b949e; font-size: 12px; padding: 4px 0;">선택 가능한 데이터 컬럼이 없습니다.</span>';
        return;
    }

    allCols.forEach((col, idx) => {
        const isChecked = analysisSelectedCols.has(col);
        const color = ANALYSIS_COLOR_PALETTE[idx % ANALYSIS_COLOR_PALETTE.length].stroke;

        const chip = document.createElement('div');
        chip.className = `analysis-col-chip ${isChecked ? 'active' : ''}`;
        chip.setAttribute('role', 'button');
        chip.setAttribute('tabindex', '0');
        chip.setAttribute('title', isChecked ? `${col} (클릭 시 분석 제외)` : `${col} (클릭 시 분석 포함)`);

        const dot = document.createElement('span');
        dot.className = 'analysis-col-dot';
        dot.style.backgroundColor = color;

        const label = document.createElement('span');
        label.textContent = col;

        chip.appendChild(dot);
        chip.appendChild(label);

        // 클릭 및 키보드 이벤트 안전 바인딩 (인라인 onclick 제거하여 특수문자/따옴표 완벽 지원)
        chip.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleAnalysisColumn(col);
        });

        chip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAnalysisColumn(col);
            }
        });

        container.appendChild(chip);
    });
}

/**
 * 분석 컬럼 토글
 */
window.toggleAnalysisColumn = function (col) {
    if (!col) return;
    if (analysisSelectedCols.has(col)) {
        if (analysisSelectedCols.size > 1) {
            analysisSelectedCols.delete(col);
        } else {
            showSheetToast('최소 1개 이상의 컬럼을 선택해야 합니다.');
            return;
        }
    } else {
        analysisSelectedCols.add(col);
    }
    populateAnalysisColumnChips();
    updateAnalysisChart();
};

/**
 * 현재 선택된 장비의 작업 로그(유지보수/트러블 이력) 수집 및 정렬
 */
function getEquipWorkLogs() {
    if (!currentSelectedSite || !currentSelectedEquip) return [];

    let rawLogs = [];
    const site = currentSelectedSite;
    const keyExact = `details_${site}_${currentSelectedEquip.key}`;
    let actualEquipKey = currentSelectedEquip.key;

    try {
        let stored = localStorage.getItem(keyExact);
        if (!stored) {
            // 다른 키 패턴 검색 (시리얼 또는 모델명 기준 fallback)
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(`details_${site}_`)) {
                    if (currentSelectedEquip.serial && k.includes(currentSelectedEquip.serial)) {
                        stored = localStorage.getItem(k);
                        actualEquipKey = k.replace(`details_${site}_`, '');
                        break;
                    } else if (currentSelectedEquip.displayName && k.includes(currentSelectedEquip.displayName)) {
                        stored = localStorage.getItem(k);
                        actualEquipKey = k.replace(`details_${site}_`, '');
                        break;
                    }
                }
            }
        }

        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed.logs)) {
                rawLogs = parsed.logs.map(l => ({ ...l, _equipKey: actualEquipKey }));
            }
        }
    } catch (e) {
        console.warn('Failed to parse equip work logs:', e);
    }

    // 날짜 유효성 및 필터링
    let validLogs = rawLogs.filter(l => l && l.date);

    if (analysisStartDate) {
        validLogs = validLogs.filter(l => l.date >= analysisStartDate);
    }
    if (analysisEndDate) {
        validLogs = validLogs.filter(l => l.date <= analysisEndDate);
    }

    // 날짜 오름차순 정렬
    validLogs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    return validLogs;
}

/**
 * 분석 차트 렌더링 및 통계 계산 (작업 이력 연계)
 */
function updateAnalysisChart() {
    const canvas = document.getElementById('data-analysis-chart');
    if (!canvas) return;

    if (typeof Chart === 'undefined') {
        const wrap = canvas.parentElement;
        if (wrap) {
            wrap.innerHTML = `
                <div class="analysis-empty-chart">
                    <span style="font-size: 28px;">⚠️</span>
                    <span>차트 라이브러리(Chart.js)를 로드하는 중입니다. 잠시 후 다시 시도해주세요.</span>
                </div>
            `;
        }
        return;
    }

    const allRows = (currentSheetData && currentSheetData.rows) || [];

    // 1. 조건에 맞는 행 필터링
    let filtered = allRows.filter(r => {
        if (!r.date) return false;
        if (analysisStartDate && r.date < analysisStartDate) return false;
        if (analysisEndDate && r.date > analysisEndDate) return false;

        if (analysisDivisionFilter && analysisDivisionFilter !== 'ALL') {
            if (analysisDivisionFilter.startsWith('div:')) {
                const targetDiv = analysisDivisionFilter.replace('div:', '');
                let rawDiv = (r.division !== undefined && r.division !== null ? r.division : ((r.values && r.values['구분']) || '')).trim();
                const clean = String(rawDiv).replace(/[\s_\-]/g, '').toUpperCase();
                let normDiv = rawDiv;
                if (clean === 'STD1' || clean === 'STD1(BLANK)' || clean.startsWith('STD1')) normDiv = 'STD1(Blank)';
                else if (clean === 'STD2' || clean.startsWith('STD2')) normDiv = 'STD2';
                else if (clean === 'STD3' || clean.startsWith('STD3')) normDiv = 'STD3';
                else if (clean === 'STD4' || clean.startsWith('STD4')) normDiv = 'STD4';
                else if (clean === 'STD5' || clean.startsWith('STD5')) normDiv = 'STD5';

                if (normDiv !== targetDiv) return false;
            } else if (analysisDivisionFilter.startsWith('conc:')) {
                const targetConc = analysisDivisionFilter.replace('conc:', '');
                const curConc = String(r.concentration !== undefined && r.concentration !== null && r.concentration !== ''
                    ? r.concentration
                    : ((r.values && r.values['농도'] !== undefined) ? r.values['농도'] : '')).trim();
                if (curConc !== targetConc) return false;
            }
        }
        return true;
    });

    // 2. 날짜 기준 오름차순 정렬 (시계열 트렌드)
    filtered.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // 3. 작업 이력 데이터 수집
    const workLogs = analysisShowWorkLogs ? getEquipWorkLogs() : [];
    currentEquipWorkLogs = workLogs;

    // 각 측정 데이터 행의 날짜에 당일 작업이 있는지 여부
    const hasWorkOnRow = filtered.map(r => {
        return workLogs.some(w => w.date === r.date);
    });

    // 4. X축 레이블 구성 (날짜 단독 표기, 요청에 따라 구분은 X축 레이블에서 제외)
    const labels = filtered.map((r, idx) => {
        const workMarker = (analysisShowWorkLogs && hasWorkOnRow[idx]) ? ' 🛠️' : '';
        return `${r.date}${workMarker}`;
    });

    // 5. 선택된 컬럼별 데이터셋 및 통계 계산
    const allCols = [...((currentSheetData && currentSheetData.columns) || [])];
    const datasets = [];
    const statsList = [];

    Array.from(analysisSelectedCols).forEach(col => {
        const colIdx = allCols.indexOf(col);
        const colorObj = ANALYSIS_COLOR_PALETTE[(colIdx >= 0 ? colIdx : 0) % ANALYSIS_COLOR_PALETTE.length];

        const values = [];
        const numList = [];

        filtered.forEach(r => {
            let rawVal = '';
            if (col === '농도') {
                rawVal = (r.concentration !== undefined && r.concentration !== null && r.concentration !== '')
                    ? r.concentration
                    : ((r.values && r.values['농도'] !== undefined) ? r.values['농도'] : '');
            } else {
                rawVal = (r.values && r.values[col] !== undefined) ? r.values[col] : '';
            }

            const parsed = parseFloat(String(rawVal).replace(/[^0-9.-]/g, ''));
            if (!isNaN(parsed)) {
                values.push(parsed);
                numList.push(parsed);
            } else {
                values.push(null);
            }
        });

        // 통계 지표 산출
        if (numList.length > 0) {
            const n = numList.length;
            const max = Math.max(...numList);
            const min = Math.min(...numList);
            const sum = numList.reduce((acc, v) => acc + v, 0);
            const avg = sum / n;
            const variance = numList.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / (n > 1 ? n - 1 : 1);
            const stdDev = Math.sqrt(variance);
            const cv = (avg !== 0) ? (stdDev / Math.abs(avg) * 100) : 0;

            statsList.push({
                col,
                color: colorObj.stroke,
                n,
                max: max.toFixed(3).replace(/\.?0+$/, ''),
                min: min.toFixed(3).replace(/\.?0+$/, ''),
                avg: avg.toFixed(3).replace(/\.?0+$/, ''),
                stdDev: stdDev.toFixed(3).replace(/\.?0+$/, ''),
                cv: cv.toFixed(2) + '%'
            });
        } else {
            statsList.push({
                col,
                color: colorObj.stroke,
                n: 0,
                max: '-',
                min: '-',
                avg: '-',
                stdDev: '-',
                cv: '-'
            });
        }

        // 작업이 있는 측정 포인트는 마름모(rectRot) 및 크기 7px로 시각적 강조
        const pointRadii = filtered.map((r, idx) => (analysisShowWorkLogs && hasWorkOnRow[idx]) ? 7 : 4);
        const pointHoverRadii = filtered.map((r, idx) => (analysisShowWorkLogs && hasWorkOnRow[idx]) ? 10 : 7);
        const pointStyles = filtered.map((r, idx) => (analysisShowWorkLogs && hasWorkOnRow[idx]) ? 'rectRot' : 'circle');
        const pointBgColors = filtered.map((r, idx) => (analysisShowWorkLogs && hasWorkOnRow[idx]) ? '#f85149' : colorObj.stroke);

        datasets.push({
            label: col,
            data: values,
            borderColor: colorObj.stroke,
            backgroundColor: colorObj.fill,
            borderWidth: 2,
            pointRadius: pointRadii,
            pointHoverRadius: pointHoverRadii,
            pointStyle: pointStyles,
            pointBackgroundColor: pointBgColors,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            tension: 0.25,
            fill: (analysisChartType === 'line' ? false : true)
        });
    });

    // 뱃지 업데이트
    const countBadge = document.getElementById('analysis-data-count-badge');
    if (countBadge) {
        countBadge.textContent = `${filtered.length}개 데이터 포인트`;
    }

    // 6. 차트 인스턴스 갱신
    if (analysisChartInstance) {
        analysisChartInstance.destroy();
        analysisChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    analysisChartInstance = new Chart(ctx, {
        type: analysisChartType,
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#e6edf3',
                        font: { size: 12, weight: '600' },
                        usePointStyle: true,
                        boxWidth: 10,
                        padding: 16
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(22, 27, 34, 0.95)',
                    titleColor: '#58a6ff',
                    titleFont: { size: 13, weight: '700' },
                    bodyColor: '#e6edf3',
                    bodyFont: { size: 12 },
                    borderColor: '#388bfd',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 4,
                    usePointStyle: true,
                    callbacks: {
                        title: function (contexts) {
                            if (!contexts || contexts.length === 0) return '';
                            const dataIdx = contexts[0].dataIndex;
                            const row = filtered[dataIdx];
                            if (!row) return '';
                            const divPart = row.division ? ` [${row.division}]` : '';
                            const concPart = (row.concentration !== undefined && row.concentration !== null && row.concentration !== '')
                                ? ` (${row.concentration}${currentSheetData.concUnit || 'ppm'})`
                                : '';
                            return `${row.date}${divPart}${concPart}`;
                        },
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null && context.parsed.y !== undefined) {
                                label += context.parsed.y;
                            } else {
                                label += '-';
                            }
                            return label;
                        },
                        // 당일 작업 또는 직전 최근 작업 이력 툴팁 자동 표출
                        afterBody: function (contexts) {
                            if (!analysisShowWorkLogs || !contexts || contexts.length === 0) return [];
                            const dataIdx = contexts[0].dataIndex;
                            const row = filtered[dataIdx];
                            if (!row || !row.date) return [];

                            const lines = [];
                            const sameDayWorks = workLogs.filter(w => w.date === row.date);

                            if (sameDayWorks.length > 0) {
                                lines.push('');
                                lines.push('── 🛠️ 당일 작업 이력 ──');
                                sameDayWorks.forEach((w, wIdx) => {
                                    if (wIdx > 0) lines.push(''); // 여러 건의 작업이 있으면 작업 간 구분 빈 줄
                                    const typeTxt = w.type ? `[${w.type}]` : '[작업]';
                                    lines.push(`📌 ${typeTxt}`);

                                    // 비용처리 라벨 제거 및 쉼표/줄바꿈 기준 분할하여 1줄에 1개씩 표기
                                    let rawContent = (w.content || w.detailType || '작업').replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
                                    const items = rawContent.split(/[\r\n,]+/)
                                        .map(s => s.replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim())
                                        .filter(s => s.length > 0);

                                    if (items.length > 0) {
                                        items.forEach(item => {
                                            lines.push(`  • ${item}`);
                                        });
                                    } else {
                                        lines.push(`  • ${rawContent || '내용 없음'}`);
                                    }

                                    // 작업자는 줄바꿔서 표기
                                    const workerTxt = (w.worker || '').trim();
                                    if (workerTxt) {
                                        lines.push(`  👤 작업자: ${workerTxt}`);
                                    }
                                });
                            } else {
                                // 당일 작업이 없으면 직전 최근 작업 표시
                                const priorWorks = workLogs.filter(w => w.date < row.date);
                                if (priorWorks.length > 0) {
                                    const lastWork = priorWorks[priorWorks.length - 1];
                                    const typeTxt = lastWork.type ? `[${lastWork.type}]` : '[작업]';
                                    lines.push('');
                                    lines.push(`💡 직전 최근 작업 (${lastWork.date}) ${typeTxt}`);

                                    let rawContent = (lastWork.content || lastWork.detailType || '작업').replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
                                    const items = rawContent.split(/[\r\n,]+/)
                                        .map(s => s.replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim())
                                        .filter(s => s.length > 0);

                                    if (items.length > 0) {
                                        items.forEach(item => {
                                            lines.push(`  • ${item}`);
                                        });
                                    } else {
                                        lines.push(`  • ${rawContent || '내용 없음'}`);
                                    }

                                    // 작업자는 줄바꿔서 표기
                                    const workerTxt = (lastWork.worker || '').trim();
                                    if (workerTxt) {
                                        lines.push(`  👤 작업자: ${workerTxt}`);
                                    }
                                }
                            }
                            return lines;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.06)' },
                    ticks: {
                        color: '#8b949e',
                        maxRotation: 45,
                        minRotation: 0,
                        font: { size: 11 }
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.06)' },
                    ticks: {
                        color: '#8b949e',
                        font: { size: 11 }
                    }
                }
            }
        }
    });

    // 7. 하단 작업 이력 타임라인 렌더링
    renderAnalysisWorkTimeline(workLogs, filtered);

    // 8. 통계 카드 렌더링
    renderAnalysisStatsCards(statsList);
}

/**
 * 하단 작업 이력 타임라인 카드 렌더링 및 차트 인터랙션 연동
 */
function renderAnalysisWorkTimeline(workLogs, filteredRows) {
    const section = document.getElementById('analysis-work-section');
    const container = document.getElementById('analysis-work-timeline');
    const badge = document.getElementById('analysis-work-count-badge');
    if (!section || !container) return;

    if (!analysisShowWorkLogs) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'flex';

    if (badge) {
        badge.textContent = `${workLogs.length}건의 작업`;
    }

    if (!workLogs || workLogs.length === 0) {
        container.innerHTML = '<div style="color: #8b949e; font-size: 12px; padding: 10px 4px;">해당 기간 내 등록된 장비 작업 이력이 없습니다.</div>';
        return;
    }

    let html = '';
    workLogs.forEach((w, idx) => {
        const typeStr = (w.type || '기타').trim();
        let tagClass = 'other';
        if (typeStr === '정기' || typeStr.toLowerCase() === 'pm') tagClass = 'pm';
        else if (typeStr === '트러블' || typeStr.toLowerCase() === 'trouble') tagClass = 'trouble';

        // 세부구분 조합 (dt1, dt2, dt3 또는 detailType)
        let dt1 = w.detailType || w.detail_type || '';
        let dt2 = w.detailType2 || w.detail_type2 || '';
        let dt3 = w.detailType3 || w.detail_type3 || '';
        if (dt1 && dt1.includes(' > ')) {
            const parts = dt1.replace(/&gt;/g, '>').split(' > ');
            dt1 = parts[0] ? parts[0].trim() : '';
            if (parts[1] && !dt2) dt2 = parts[1].trim();
            if (parts[2] && !dt3) dt3 = parts[2].trim();
        }
        const dtArray = [dt1, dt2, dt3].filter(Boolean);
        const detailTypeStr = dtArray.length > 0 ? dtArray.join(' > ') : '';
        const badgeText = detailTypeStr ? `${typeStr} (${detailTypeStr})` : typeStr;

        // [수정] 비용처리 태그([유상], [무상], [무상(보증)], [기타] 등) 제거
        let rawContent = (w.content || detailTypeStr || '세부 작업 내용 없음').trim();
        rawContent = rawContent.replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
        const contentStr = rawContent || '세부 작업 내용 없음';
        const workerStr = (w.worker || '작업자 미지정').trim();

        // 쉼표(,) 또는 줄바꿈으로 나뉜 물품/내용 목록을 정제
        const rawItems = contentStr.split(/[\r\n,]+/)
            .map(s => s.replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim())
            .filter(s => s.length > 0);

        // 각 물품 항목 전체가 중간에 쪼개지지 않고 통째로 다음 줄로 넘어가도록 inline-block 태그로 감싸기
        let contentHtml = '';
        if (rawItems.length > 0) {
            contentHtml = rawItems.map((item, i) => {
                const comma = (i < rawItems.length - 1) ? ',' : '';
                return `<span class="analysis-work-item-chunk">${escapeHtml(item)}${comma}</span>`;
            }).join(' ');
        } else {
            contentHtml = escapeHtml(contentStr);
        }

        // 차트의 가장 가까운 측정 데이터 행 탐색
        let closestDateStr = '';
        let targetChartIdx = -1;
        if (filteredRows && filteredRows.length > 0) {
            let minDiff = Infinity;
            filteredRows.forEach((r, rIdx) => {
                if (!r.date) return;
                const diff = Math.abs(new Date(r.date) - new Date(w.date));
                if (diff < minDiff) {
                    minDiff = diff;
                    targetChartIdx = rIdx;
                }
            });
            if (targetChartIdx >= 0) {
                closestDateStr = filteredRows[targetChartIdx].date;
            }
        }

        const isExactMatch = closestDateStr === w.date;
        const closestBadge = closestDateStr
            ? (isExactMatch ? '📍 당일 측정 데이터' : `📈 측정 연계: ${closestDateStr}`)
            : '';

        html += `
            <div class="analysis-work-card" data-work-idx="${idx}" data-target-chart-idx="${targetChartIdx}" title="클릭 시 차트의 해당 시점으로 포커스합니다.">
                <div class="analysis-work-card-top">
                    <span class="analysis-work-date">📅 ${escapeHtml(w.date)}</span>
                    <span class="analysis-work-tag ${tagClass}">${escapeHtml(typeStr)}</span>
                </div>
                ${detailTypeStr ? `<div class="analysis-work-detail-type" title="${escapeHtml(detailTypeStr)}"> ${escapeHtml(detailTypeStr)}</div>` : ''}
                <div class="analysis-work-content" title="${escapeHtml(contentStr)}">
                    ${contentHtml}
                </div>
                <div class="analysis-work-footer">
                    <span class="analysis-work-worker" title="작업자: ${escapeHtml(workerStr)}">👤 ${escapeHtml(workerStr)}</span>
                    <span class="analysis-work-closest">${closestBadge}</span>
                </div>
                <div class="analysis-work-actions">
                    <button type="button" class="btn-analysis-work-detail" data-work-idx="${idx}" title="작업 상세 정보 보기">
                        📋 작업 상세 정보
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // [요청 반영] 초기 상태일 때 타임라인 가로 스크롤을 가장 오른쪽(최신 작업)으로 자동 이동
    requestAnimationFrame(() => {
        container.scrollLeft = container.scrollWidth;
    });

    // 작업 상세 정보 버튼 클릭 이벤트 바인딩 (모달 팝업 호출)
    const detailBtns = container.querySelectorAll('.btn-analysis-work-detail');
    detailBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // 카드 클릭(차트 하이라이트) 이벤트 전파 방지

            const workIdx = parseInt(btn.dataset.workIdx, 10);
            const w = workLogs[workIdx];
            if (!w) return;

            const site = currentSelectedSite;
            const equipKey = w._equipKey || (currentSelectedEquip && currentSelectedEquip.key) || '';
            const targetId = w.id || w.content;
            const isCompleted = (w.status === '완료' || w.isCompleted === true || w.isCompleted === undefined);

            if (typeof window.openEventDetailModal === 'function') {
                window.openEventDetailModal(site, equipKey, targetId, isCompleted);
            } else if (typeof openEventDetailModal === 'function') {
                openEventDetailModal(site, equipKey, targetId, isCompleted);
            } else {
                alert('작업 상세 정보 모달을 열 수 없습니다. 시스템 관리자에게 문의하세요.');
            }
        });
    });

    // 작업 카드 클릭 시 차트 하이라이트 이벤트 바인딩
    const cards = container.querySelectorAll('.analysis-work-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            const targetIdx = parseInt(card.dataset.targetChartIdx, 10);
            if (!isNaN(targetIdx) && targetIdx >= 0 && analysisChartInstance) {
                try {
                    analysisChartInstance.setActiveElements([
                        { datasetIndex: 0, index: targetIdx }
                    ]);
                    analysisChartInstance.tooltip.setActiveElements([
                        { datasetIndex: 0, index: targetIdx }
                    ], { x: 0, y: 0 });
                    analysisChartInstance.update();

                    const rowDate = filteredRows[targetIdx] ? filteredRows[targetIdx].date : '';
                    showSheetToast(`차트에서 ${rowDate} 측정 데이터로 포커스되었습니다.`);
                } catch (e) {
                    console.warn('Chart highlight failed:', e);
                }
            }
        });
    });
}

/**
 * 하단 통계 지표 요약 카드 그리드 렌더링
 */
function renderAnalysisStatsCards(statsList) {
    const container = document.getElementById('analysis-stats-grid');
    if (!container) return;

    if (!statsList || statsList.length === 0) {
        container.innerHTML = '<div style="color: #8b949e; font-size: 13px; grid-column: 1 / -1;">선택된 분석 항목이 없습니다.</div>';
        return;
    }

    let html = '';
    statsList.forEach(stat => {
        html += `
            <div class="analysis-stat-card">
                <div class="analysis-stat-card-title">
                    <span class="analysis-col-dot" style="background-color: ${stat.color};"></span>
                    <span title="${escapeHtml(stat.col)}">${escapeHtml(stat.col)}</span>
                </div>
                <div class="analysis-stat-metrics">
                    <div class="analysis-stat-item">
                        <span class="analysis-stat-label">데이터 수 (N)</span>
                        <span class="analysis-stat-val">${stat.n}건</span>
                    </div>
                    <div class="analysis-stat-item">
                        <span class="analysis-stat-label">평균값 (Mean)</span>
                        <span class="analysis-stat-val">${stat.avg}</span>
                    </div>
                    <div class="analysis-stat-item">
                        <span class="analysis-stat-label">최댓값 (Max)</span>
                        <span class="analysis-stat-val" style="color: #3fb950;">${stat.max}</span>
                    </div>
                    <div class="analysis-stat-item">
                        <span class="analysis-stat-label">최솟값 (Min)</span>
                        <span class="analysis-stat-val" style="color: #f85149;">${stat.min}</span>
                    </div>
                    <div class="analysis-stat-item">
                        <span class="analysis-stat-label">표준편차 (Std Dev)</span>
                        <span class="analysis-stat-val">${stat.stdDev}</span>
                    </div>
                    <div class="analysis-stat-item">
                        <span class="analysis-stat-label">변동계수 (CV)</span>
                        <span class="analysis-stat-val" style="color: #e3b341;">${stat.cv}</span>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

/**
 * 차트 이미지 클립보드 복사
 */
async function handleCopyAnalysisChart() {
    const canvas = document.getElementById('data-analysis-chart');
    if (!canvas) return;

    try {
        canvas.toBlob(async (blob) => {
            if (!blob) {
                showSheetToast('차트 이미지를 생성하지 못했습니다.');
                return;
            }
            if (navigator.clipboard && navigator.clipboard.write) {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                showSheetToast('📈 차트 이미지가 클립보드에 복사되었습니다.');
            } else {
                showSheetToast('현재 브라우저 환경에서 이미지 복사를 지원하지 않습니다.');
            }
        });
    } catch (err) {
        console.error('차트 복사 실패:', err);
        showSheetToast('차트 복사 중 오류가 발생했습니다.');
    }
}

/**
 * 차트 이미지 PNG 다운로드
 */
function handleDownloadAnalysisChart() {
    const canvas = document.getElementById('data-analysis-chart');
    if (!canvas) return;

    try {
        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        const equipName = currentSelectedEquip ? (currentSelectedEquip.custEquip ? `${currentSelectedEquip.displayName}_${currentSelectedEquip.custEquip}` : currentSelectedEquip.displayName) : 'Equip';
        link.download = `${equipName}_Trend_Analysis_${getTodayString()}.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showSheetToast('📥 차트 이미지가 저장되었습니다.');
    } catch (err) {
        console.error('차트 다운로드 실패:', err);
        showSheetToast('차트 다운로드 중 오류가 발생했습니다.');
    }
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
