/**
 * ==========================================================================
 * DATA 페이지 전용 스크립트 (data.js)
 * 장비별 엑셀형 데이터 시트 (동적 열 추가, 날짜별 행 누적, 셀 직접 편집)
 * ==========================================================================
 */

let currentSelectedSite = null;
let currentSelectedEquip = null;
let currentSheetData = {
    columns: [],
    rows: []
};

let autoSaveTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. 초기 데이터 로드
    initDataPage();

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
                <span>🏢 ${escapeHtml(site)}</span>
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
                <span style="font-weight:600;">🛠️ ${escapeHtml(item.displayName)}</span>
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

    const storageKey = `equip_sheet_${currentSelectedSite}_${currentSelectedEquip.key}`;
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
                serial: currentSelectedEquip.serial
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
        const savedStr = localStorage.getItem(storageKey);
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
 * 새 장비용 기본 시트 템플릿 생성
 */
function initDefaultSheet() {
    currentSheetData = {
        columns: ['온도 (℃)', '압력 (kPa)', '전압 (V)', '비고'],
        rows: [
            {
                id: 'row_' + Date.now(),
                date: getTodayString(),
                values: {
                    '온도 (℃)': '',
                    '압력 (kPa)': '',
                    '전압 (V)': '',
                    '비고': ''
                }
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

    const storageKey = `equip_sheet_${currentSelectedSite}_${currentSelectedEquip.key}`;
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
                    reset_table: resetTable
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
 * 스프레드시트 테이블 렌더링
 */
function renderSheetTable() {
    const thead = document.getElementById('data-sheet-thead');
    const tbody = document.getElementById('data-sheet-tbody');
    if (!thead || !tbody) return;

    const columns = currentSheetData.columns || [];
    const rows = currentSheetData.rows || [];

    // 1. 헤더 (Thead) 렌더링
    let headHtml = '<tr>';
    
    // No 컬럼
    const noSortIcon = currentSort.key === '__no__' 
        ? `<span class="sheet-sort-icon active">${currentSort.direction === 'asc' ? '▲' : '▼'}</span>`
        : `<span class="sheet-sort-icon">⇅</span>`;
    headHtml += `<th style="width: 50px; text-align: center; cursor: pointer;" onclick="toggleSheetSort('__no__')" title="순번 기준 정렬">No ${noSortIcon}</th>`;

    // 날짜 컬럼
    const dateSortIcon = currentSort.key === '__date__' 
        ? `<span class="sheet-sort-icon active">${currentSort.direction === 'asc' ? '▲' : '▼'}</span>`
        : `<span class="sheet-sort-icon">⇅</span>`;
    headHtml += `<th style="width: 140px; text-align: center; cursor: pointer;" onclick="toggleSheetSort('__date__')" title="날짜 기준 정렬">📅 날짜 ${dateSortIcon}</th>`;

    // 동적 데이터 열들
    columns.forEach((col, colIdx) => {
        const isCurrentCol = currentSort.key === col;
        const sortIcon = isCurrentCol
            ? `<span class="sheet-sort-icon active">${currentSort.direction === 'asc' ? '▲' : '▼'}</span>`
            : `<span class="sheet-sort-icon">⇅</span>`;

        headHtml += `
            <th class="sheet-col-th" draggable="true" data-col-idx="${colIdx}" style="min-width: 130px;">
                <div class="sheet-col-header-inner">
                    <span class="sheet-col-drag-handle" title="드래그하여 열 순서 변경">⠿</span>
                    <span class="sheet-col-title clickable-header" title="${escapeHtml(col)} (클릭하여 정렬)" onclick="handleColHeaderClick(event, '${escapeHtml(col)}')">
                        ${escapeHtml(col)} ${sortIcon}
                    </span>
                    <button type="button" class="sheet-col-del-btn" title="열 삭제" onclick="event.stopPropagation(); deleteSheetColumn(${colIdx})">&times;</button>
                </div>
            </th>
        `;
    });

    headHtml += '<th style="width: 44px; text-align: center;">삭제</th>';
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
        bodyHtml += `<td style="color:#8b949e; text-align:center; user-select:none; font-size:11px;">${rowIdx + 1}</td>`;

        // 날짜 컬럼 (첫 열: 직접 변경 가능한 날짜 피커)
        bodyHtml += `
            <td style="text-align: center;">
                <input type="date" class="sheet-date-input custom-date-icon" value="${row.date || ''}" 
                       onchange="updateRowDate('${row.id}', this.value)" title="날짜 변경">
            </td>
        `;

        // 사용자 정의 동적 열들 (직접 편집 가능한 인라인 셀)
        columns.forEach((col, colIdx) => {
            const val = (row.values && row.values[col] !== undefined) ? row.values[col] : '';
            bodyHtml += `
                <td>
                    <input type="text" class="sheet-cell-input" value="${escapeHtml(val)}" 
                           data-row-id="${row.id}" data-row-idx="${rowIdx}" data-col-idx="${colIdx}" data-col-name="${escapeHtml(col)}" 
                           placeholder="-" autocomplete="off">
                </td>
            `;
        });

        // 행 삭제 버튼 컬럼
        bodyHtml += `
            <td class="sheet-action-cell">
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

        // 2. 모바일 터치 드래그 지원 (.sheet-col-drag-handle 대상)
        const handle = th.querySelector('.sheet-col-drag-handle');
        if (handle) {
            let touchMoved = false;
            let ghostEl = null;
            let currentTargetTh = null;
            let insertBefore = false;

            handle.addEventListener('touchstart', (e) => {
                const touch = e.touches[0];
                touchMoved = false;
                draggedColIdx = parseInt(th.dataset.colIdx, 10);

                const colName = currentSheetData.columns[draggedColIdx] || '열';
                ghostEl = document.createElement('div');
                ghostEl.className = 'sheet-touch-ghost';
                ghostEl.textContent = `↕ ${colName}`;
                document.body.appendChild(ghostEl);
                ghostEl.style.left = `${touch.clientX}px`;
                ghostEl.style.top = `${touch.clientY - 10}px`;
            }, { passive: true });

            handle.addEventListener('touchmove', (e) => {
                const touch = e.touches[0];
                touchMoved = true;
                isDraggingColumn = true;

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
            }, { passive: false });

            const finishTouch = () => {
                if (ghostEl) {
                    ghostEl.remove();
                    ghostEl = null;
                }
                colThs.forEach(el => el.classList.remove('drag-over-left', 'drag-over-right', 'dragging'));

                if (touchMoved && currentTargetTh && draggedColIdx !== null) {
                    const targetIdx = parseInt(currentTargetTh.dataset.colIdx, 10);
                    if (draggedColIdx !== targetIdx) {
                        moveColumn(draggedColIdx, targetIdx, insertBefore);
                    }
                }

                setTimeout(() => {
                    isDraggingColumn = false;
                    draggedColIdx = null;
                }, 100);
            };

            handle.addEventListener('touchend', finishTouch);
            handle.addEventListener('touchcancel', finishTouch);
        }
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
                        nextInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                } else {
                    // 마지막 행이면 아래(맨 끝)에 새 행을 추가하고 해당 시작 열로 이동
                    addSheetRow(null, false, true);
                    setTimeout(() => {
                        const newRowInput = document.querySelector(`.sheet-cell-input[data-row-idx="${nextRowIdx}"][data-col-idx="${targetCol}"]`);
                        if (newRowInput) {
                            newRowInput.focus();
                            newRowInput.select();
                            newRowInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

    saveCurrentSheetData(true);
    renderSheetTable();
};

/**
 * 시트 데이터 전체 초기화
 */
function handleClearSheetData() {
    if (!currentSelectedSite || !currentSelectedEquip) return;
    if (!confirm(`현재 장비(${currentSelectedEquip.displayName})의 전체 시트 데이터를 초기화하시겠습니까?`)) return;

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
    const filename = `${currentSelectedSite}_${equipTag}_데이터시트_${getTodayString()}.csv`;
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
