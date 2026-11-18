/* ==========================================================================
   WORKS > Item : 물품 관리 현황 (사업장 구분별 물품 및 수량 관리)
   - ADMIN > 물품 관리 현황에서 분리된 페이지
   - 수정(등록/수량/등급/삭제)은 관리자만, 일반 계정은 조회 전용
   ========================================================================== */
let adminItems = []; // 마스터 물품 목록 (ADMIN > 물품 관리, localStorage 'admin_items')
let adminItemStocks = []; // 사업장 구분별 물품 관리 현황 목록
let currentStockSiteGroup = '전체'; // 선택된 사업장 구분 (기본: 전체)
let currentStockSiteName = ''; // 선택된 사업장명
const DEFAULT_SITE_GROUPS = ['SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타 해외', '개발', '기타'];
let selectedMasterItemForStock = null; // 모달에서 선택된 마스터 물품
let stockSortColumn = 'code'; // 정렬 컬럼 (초기값: 코드명 이름순)
let stockSortAsc = true;   // 정렬 방향 (true: 오름차순, false: 내림차순)

// 관리자 권한 확인 (일반 계정 조회 전용 모드 판별)
function isUserAdminRole() {
    const role = sessionStorage.getItem('userRole') || document.body.dataset.userRole || (window.currentUser && window.currentUser.role);
    return role === 'admin' || role === 'superadmin';
}

// 계정에 지정된 사업장 구분 ('' = 전체 사업장)
function getUserStockSiteGroup() {
    const s = (sessionStorage.getItem('userSite') || '').trim();
    return (s && !['전체', '구분없음', 'None', 'null'].includes(s)) ? s : '';
}

// 해당 사업장 구분의 물품 현황을 수정할 수 있는지
//  - 최종관리자: 전체 사업장
//  - 관리자: 본인 계정 사업장만 (계정 사업장이 '전체 사업장'이면 수정 불가)
//  - 일반 계정: 조회만
function isStockSuperAdmin() {
    return (sessionStorage.getItem('userRole') || document.body.dataset.userRole || '') === 'superadmin';
}

function canEditStockGroup(group) {
    if (!isUserAdminRole()) return false;
    if (isStockSuperAdmin()) return true;
    const mySite = getUserStockSiteGroup();
    if (!mySite) return false;
    return (group || '').trim() === mySite;
}

// 수정 불가 시 안내 후 true 반환
function denyStockEdit(group, actionLabel) {
    if (canEditStockGroup(group)) return false;
    if (!isUserAdminRole()) {
        alert(`일반 계정은 조회만 가능하며, ${actionLabel} 권한이 없습니다.`);
    } else if (!getUserStockSiteGroup()) {
        alert(`계정에 사업장이 지정되지 않아(전체 사업장) ${actionLabel}할 수 없습니다.\n계정의 사업장을 지정한 뒤 다시 로그인해주세요.`);
    } else {
        alert(`본인 사업장(${getUserStockSiteGroup()})의 물품만 ${actionLabel}할 수 있습니다.`);
    }
    return true;
}

function getStockGroupById(stockId) {
    const it = (adminItemStocks || []).find(x => String(x.id) === String(stockId));
    return it ? (it.site_group || '') : '';
}

// 마스터 물품 목록 로드 (물품 등록 모달 / 마스터 물품 불러오기용)
function loadAdminItems() {
    try {
        const data = localStorage.getItem('admin_items');
        adminItems = data ? JSON.parse(data) : [];
    } catch (e) {
        console.error(e);
        adminItems = [];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    let initialized = false;
    const initItemPage = () => {
        loadAdminItems(); // 서버 데이터 갱신 시마다 마스터 물품 목록 최신화
        if (initialized) return;
        initialized = true;
        setupItemStockMgmt();
        renderItemStockView();
    };
    if (window.isDataLoaded) initItemPage();
    window.addEventListener('DataLoaded', initItemPage);
});

/* ==========================================================================
   7. 물품 관리 현황 (사업장 구분별 수량 관리)
   ========================================================================== */
function setupItemStockMgmt() {
    loadItemStocks();

    // 1. 검색 입력 이벤트
    const searchInput = document.getElementById('item-stock-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderItemStockTable();
        });
    }

    // 2. 모바일 사업장 구분 셀렉트 변경 이벤트
    const groupSelect = document.getElementById('item-stock-group-select');
    if (groupSelect) {
        groupSelect.addEventListener('change', (e) => {
            switchSiteGroup(e.target.value);
        });
    }

    // 4. 물품 등록 모달 열기/닫기 이벤트
    const btnOpenModal = document.getElementById('btn-open-add-stock-modal');
    const modal = document.getElementById('item-stock-add-modal');
    const btnCloseModal = document.getElementById('btn-close-item-stock-modal');
    const btnCancelModal = document.getElementById('btn-cancel-item-stock-modal');
    const btnConfirmModal = document.getElementById('btn-confirm-item-stock-modal');

    if (btnOpenModal) {
        btnOpenModal.addEventListener('click', openAddStockModal);
    }
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', closeAddStockModal);
    }
    if (btnCancelModal) {
        btnCancelModal.addEventListener('click', closeAddStockModal);
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeAddStockModal();
        });
    }
    if (btnConfirmModal) {
        btnConfirmModal.addEventListener('click', submitAddStock);
    }

    // 5. 모달 내 마스터 물품 실시간 검색
    const modalSearchInput = document.getElementById('modal-stock-item-search');
    if (modalSearchInput) {
        modalSearchInput.addEventListener('input', () => {
            renderModalMasterItemList(modalSearchInput.value.trim());
        });
    }

    // 6. 마스터 물품 일괄 불러오기 버튼
    const btnImport = document.getElementById('btn-import-master-items');
    if (btnImport) {
        btnImport.addEventListener('click', importMasterItemsToCurrentGroup);
    }

    // 7. CSV 내보내기 버튼
    const btnExportCsv = document.getElementById('btn-export-stock-csv');
    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', exportStockCsv);
    }

    // 8. 테이블 컬럼 제목 클릭 시 정렬 이벤트 (사업장부터 등급까지)
    const stockThead = document.querySelector('.item-stock-table thead');
    if (stockThead) {
        stockThead.addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort]');
            if (!th) return;
            const sortKey = th.dataset.sort;
            if (!sortKey) return;
            if (stockSortColumn === sortKey) {
                stockSortAsc = !stockSortAsc;
            } else {
                stockSortColumn = sortKey;
                stockSortAsc = true;
            }
            renderItemStockTable();
        });
    }
}

// [추가] 물품 관리 현황 로컬 및 스토리지 보존 헬퍼
function saveItemStocksLocally() {
    try {
        localStorage.setItem('item_stocks', JSON.stringify(adminItemStocks));
        if (window.storageData) {
            window.storageData.item_stocks = adminItemStocks;
        }
    } catch (e) {
        console.warn('Failed to save item_stocks to localStorage:', e);
    }
}

// 물품 관리 현황 데이터 로드 (로컬 스토리지 우선 로드로 탭 전환 시 초기화 방지)
function loadItemStocks() {
    try {
        const localData = localStorage.getItem('item_stocks');
        if (localData) {
            const parsed = JSON.parse(localData);
            if (Array.isArray(parsed)) {
                adminItemStocks = parsed;
                return;
            }
        }
    } catch (e) {
        console.error('Failed to parse item_stocks from localStorage:', e);
    }

    if (window.storageData && Array.isArray(window.storageData.item_stocks)) {
        adminItemStocks = window.storageData.item_stocks;
    } else if (!adminItemStocks || !Array.isArray(adminItemStocks)) {
        adminItemStocks = [];
    }
}

// 서버 DB와 최신 상태 비동기 동기화 헬퍼 (데이터 일관성 보장)
async function syncItemStocksFromServer(andRender = false) {
    try {
        const res = await fetch('/api/data');
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.item_stocks)) {
                adminItemStocks = data.item_stocks;
                saveItemStocksLocally();
                if (andRender) {
                    renderItemStockTable();
                }
            }
        }
    } catch (e) {
        console.warn('Failed to sync item_stocks from server:', e);
    }
}

// 등록된 전체 사업장 구분 목록 추출 (기본 구분 + Site 메타데이터 결합)
function getAvailableSiteGroups() {
    const defaultGroups = (typeof DEFAULT_SITE_GROUPS !== 'undefined' && Array.isArray(DEFAULT_SITE_GROUPS))
        ? DEFAULT_SITE_GROUPS
        : ['SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타 해외', '개발', '기타'];
    const groupSet = new Set(defaultGroups);
    if (window.storageData) {
        for (const key in window.storageData) {
            if (key.startsWith('site_meta_')) {
                const meta = window.storageData[key];
                if (meta && meta.group && typeof meta.group === 'string' && meta.group.trim()) {
                    groupSet.add(meta.group.trim());
                }
            }
        }
    }
    return Array.from(groupSet);
}

// 특정 사업장 구분에 속한 개별 사업장(Site) 목록 추출
function getSitesByGroup(group) {
    const sites = [];
    if (window.storageData) {
        for (const key in window.storageData) {
            if (key.startsWith('site_meta_')) {
                const siteName = key.replace('site_meta_', '');
                const meta = window.storageData[key];
                const siteGroup = (meta && meta.group) ? meta.group.trim() : '기타사업장';
                if (siteGroup === (group || '').trim()) {
                    sites.push(siteName);
                }
            }
        }
    }
    return sites.sort();
}

// 뷰 렌더링 진입점
function renderItemStockView() {
    loadItemStocks();
    const savedGroup = localStorage.getItem('lastStockSiteGroup');
    const availableGroups = ['전체', ...getAvailableSiteGroups()];
    const userGroup = getUserStockSiteGroup();
    if (userGroup && availableGroups.includes(userGroup)) {
        // 계정에 지정된 사업장 구분을 자동 선택
        currentStockSiteGroup = userGroup;
    } else if (savedGroup && availableGroups.includes(savedGroup)) {
        currentStockSiteGroup = savedGroup;
    } else {
        currentStockSiteGroup = '전체';
    }

    currentStockSiteName = '';

    renderSiteGroupTabs();
    renderItemStockTable();

    // 백그라운드에서 최신 DB 데이터 동기화하여 변경사항 자동 반영
    syncItemStocksFromServer(true);
}

// 사업장 구분 탭 및 모바일 셀렉트 렌더링 (전체 버튼 포함)
function renderSiteGroupTabs() {
    const tabsContainer = document.getElementById('item-stock-group-tabs');
    const selectEl = document.getElementById('item-stock-group-select');
    const groups = ['전체', ...getAvailableSiteGroups()];

    if (tabsContainer) {
        tabsContainer.innerHTML = '';
        groups.forEach(g => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `item-stock-tab-btn ${g === currentStockSiteGroup ? 'active' : ''}`;
            btn.textContent = g;
            btn.addEventListener('click', () => switchSiteGroup(g));
            tabsContainer.appendChild(btn);
        });
    }

    if (selectEl) {
        selectEl.innerHTML = '';
        groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            if (g === currentStockSiteGroup) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }
}

// 개별 사업장 셀렉트 렌더링 (하위 호환 유지용)
function renderSiteSelect() {
    const siteSelect = document.getElementById('item-stock-site-select');
    if (!siteSelect) return;
    siteSelect.innerHTML = '';
}

// 사업장 구분 전환
function switchSiteGroup(group) {
    if (!group) return;
    currentStockSiteGroup = group;
    currentStockSiteName = '';
    localStorage.setItem('lastStockSiteGroup', group);
    localStorage.removeItem('lastStockSiteName');

    // 탭 UI 갱신
    const tabBtns = document.querySelectorAll('.item-stock-tab-btn');
    tabBtns.forEach(b => {
        if (b.textContent === group) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    // 셀렉트 박스 갱신
    const selectEl = document.getElementById('item-stock-group-select');
    if (selectEl && selectEl.value !== group) {
        selectEl.value = group;
    }

    renderItemStockTable();
}

// 개별 사업장 전환 (호환용)
function switchStockSite(siteName) {
    currentStockSiteName = siteName || '';
    renderItemStockTable();
}

// 테이블 목록 렌더링 (전체 또는 사업장 구분별 필터링)
function renderItemStockTable() {
    const tbody = document.getElementById('item-stock-tbody');
    const emptyEl = document.getElementById('item-stock-empty');
    const countBadge = document.getElementById('item-stock-count');
    const totalQtyBadge = document.getElementById('item-stock-total-qty');
    const shortageBadge = document.getElementById('item-stock-shortage-count');
    const searchInput = document.getElementById('item-stock-search');

    if (!tbody) return;
    tbody.innerHTML = '';

    // 다른 사업장 탭에서는 물품 등록 / 마스터 물품 불러오기 버튼 숨김
    const isAllTab = !currentStockSiteGroup || currentStockSiteGroup === '전체' || currentStockSiteGroup === 'ALL';
    const canAddHere = isAllTab
        ? (isUserAdminRole() && (isStockSuperAdmin() || !!getUserStockSiteGroup()))
        : canEditStockGroup(currentStockSiteGroup);
    ['btn-open-add-stock-modal', 'btn-import-master-items'].forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        if (b.dataset.origDisplay === undefined) b.dataset.origDisplay = b.style.display || '';
        b.style.display = canAddHere ? b.dataset.origDisplay : 'none';
    });

    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    // 1. 사업장 구분 필터링 ('전체'일 경우 전체 표시)
    let groupItems = adminItemStocks;
    if (currentStockSiteGroup && currentStockSiteGroup !== '전체' && currentStockSiteGroup !== 'ALL') {
        groupItems = adminItemStocks.filter(item => {
            return (item.site_group || '').trim() === currentStockSiteGroup.trim();
        });
    }

    // 2. 검색어 필터링
    const filtered = groupItems.filter(item => {
        if (!query) return true;
        const code = (item.code || '').toLowerCase();
        const part = (item.part || '').toLowerCase();
        const spec = (item.spec || '').toLowerCase();
        const partno = (item.partno || '').toLowerCase();
        const detailType = (item.detail_type || '').toLowerCase();
        const siteName = (item.site_name || '').toLowerCase();
        const siteGroup = (item.site_group || '').toLowerCase();
        const memo = (item.memo || '').toLowerCase();
        return code.includes(query) || part.includes(query) || spec.includes(query) ||
            partno.includes(query) || detailType.includes(query) || siteName.includes(query) ||
            siteGroup.includes(query) || memo.includes(query);
    });

    // 3. 컬럼 정렬 (사업장부터 등급까지 클릭 시 정렬)
    if (stockSortColumn) {
        filtered.sort((a, b) => {
            let diff = 0;
            switch (stockSortColumn) {
                case 'site': {
                    const sA = a.site_group || a.site_name || '';
                    const sB = b.site_group || b.site_name || '';
                    diff = sA.localeCompare(sB, 'ko');
                    break;
                }
                case 'detail_type':
                    diff = (a.detail_type || '').localeCompare(b.detail_type || '', 'ko');
                    break;
                case 'partno':
                    diff = (a.partno || '').localeCompare(b.partno || '', 'ko', { numeric: true });
                    break;
                case 'code':
                    diff = (a.code || '').localeCompare(b.code || '', 'ko', { numeric: true });
                    break;
                case 'part':
                    diff = (a.part || '').localeCompare(b.part || '', 'ko');
                    break;
                case 'spec':
                    diff = (a.spec || '').localeCompare(b.spec || '', 'ko');
                    break;
                case 'quantity':
                    diff = (parseInt(a.quantity) || 0) - (parseInt(b.quantity) || 0);
                    break;
                case 'safety_quantity':
                    diff = (parseInt(a.safety_quantity) || 0) - (parseInt(b.safety_quantity) || 0);
                    break;
                case 'status': {
                    const getStatusRank = (it) => {
                        const q = parseInt(it.quantity) || 0;
                        const s = parseInt(it.safety_quantity) || 0;
                        if (q === 0) return 1; // 미확보
                        if (q < s) return 2;   // 부족
                        return 3;              // 정상
                    };
                    diff = getStatusRank(a) - getStatusRank(b);
                    break;
                }
                case 'grade': {
                    const gA = (a.grade || 'A').toUpperCase();
                    const gB = (b.grade || 'A').toUpperCase();
                    diff = gA.localeCompare(gB);
                    break;
                }
                default:
                    diff = 0;
            }
            if (diff !== 0) {
                return stockSortAsc ? diff : -diff;
            }
            const gA = (a.grade || 'A').toUpperCase();
            const gB = (b.grade || 'A').toUpperCase();
            const gDiff = gA.localeCompare(gB);
            if (gDiff !== 0) return gDiff;
            return (a.id || 0) - (b.id || 0);
        });
    }

    if (filtered.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        updateStockSummaryCounts();
        return;
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
    }

    filtered.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.dataset.stockId = item.id;

        const qty = parseInt(item.quantity) || 0;
        const safetyQty = parseInt(item.safety_quantity) || 0;

        const grade = (item.grade || 'A').toUpperCase();
        const gradeBadge = getItemGradeBadgeHtml(grade);
        const statusBadge = getItemStockStatusBadgeHtml(qty, safetyQty);
        const displaySite = item.site_group || item.site_name || '-';

        tr.innerHTML = `
            <td class="col-no">${index + 1}</td>
            <td class="col-site">${displaySite}</td>
            <td class="col-detail-type">${item.detail_type || '-'}</td>
            <td class="col-partno">${item.partno || '-'}</td>
            <td class="col-code">${item.code || '-'}</td>
            <td class="col-part">${item.part || '-'}</td>
            <td class="col-spec">${item.spec || '-'}</td>
            <td class="col-qty">
                <div class="stock-qty-control">
                    <button type="button" class="stock-qty-btn btn-qty-minus" title="현재 수량 1 감소" data-id="${item.id}">-</button>
                    <input type="number" class="stock-qty-input" min="0" value="${qty}" data-id="${item.id}">
                    <button type="button" class="stock-qty-btn btn-qty-plus" title="현재 수량 1 증가" data-id="${item.id}">+</button>
                </div>
            </td>
            <td class="col-safety">
                <div class="stock-qty-control stock-safety-control">
                    <button type="button" class="stock-qty-btn btn-safety-minus" title="안전 재고 수량 1 감소" data-id="${item.id}">-</button>
                    <input type="number" class="stock-qty-input stock-safety-input" min="0" value="${safetyQty}" data-id="${item.id}">
                    <button type="button" class="stock-qty-btn btn-safety-plus" title="안전 재고 수량 1 증가" data-id="${item.id}">+</button>
                </div>
            </td>
            <td class="col-status stock-status-cell">${statusBadge}</td>
            <td class="col-grade stock-grade-cell">${gradeBadge}</td>
            <td class="col-action">
                <button type="button" class="btn-del-stock" title="목록에서 삭제" data-id="${item.id}">✕</button>
            </td>
        `;

        // 1. 현재 수량 컨트롤
        const btnMinus = tr.querySelector('.btn-qty-minus');
        const inputQty = tr.querySelector('.stock-qty-input:not(.stock-safety-input)');
        const btnPlus = tr.querySelector('.btn-qty-plus');

        const rowEditable = canEditStockGroup(item.site_group);
        if (!rowEditable) {
            if (inputQty) inputQty.readOnly = true;
            const inputSafetyTemp = tr.querySelector('.stock-safety-input');
            if (inputSafetyTemp) inputSafetyTemp.readOnly = true;
            tr.querySelectorAll('.stock-qty-btn, .btn-del-stock').forEach(b => { b.style.display = 'none'; });
            const gradeBadgeEl = tr.querySelector('.stock-grade-cell .stock-badge');
            if (gradeBadgeEl) {
                gradeBadgeEl.classList.remove('clickable-grade');
                gradeBadgeEl.title = '';
            }
        }

        if (btnMinus && inputQty) {
            btnMinus.addEventListener('click', () => {
                let currentVal = parseInt(inputQty.value) || 0;
                if (currentVal > 0) {
                    currentVal--;
                    inputQty.value = currentVal;
                    updateStockQuantity(item.id, currentVal, tr);
                }
            });
        }
        if (btnPlus && inputQty) {
            btnPlus.addEventListener('click', () => {
                let currentVal = parseInt(inputQty.value) || 0;
                currentVal++;
                inputQty.value = currentVal;
                updateStockQuantity(item.id, currentVal, tr);
            });
        }
        if (inputQty) {
            inputQty.addEventListener('change', () => {
                let val = Math.max(0, parseInt(inputQty.value) || 0);
                inputQty.value = val;
                updateStockQuantity(item.id, val, tr);
            });
            inputQty.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') inputQty.blur();
            });
        }

        // 2. 안전 재고 수량 컨트롤
        const btnSafetyMinus = tr.querySelector('.btn-safety-minus');
        const inputSafety = tr.querySelector('.stock-safety-input');
        const btnSafetyPlus = tr.querySelector('.btn-safety-plus');

        if (btnSafetyMinus && inputSafety) {
            btnSafetyMinus.addEventListener('click', () => {
                let currentVal = parseInt(inputSafety.value) || 0;
                if (currentVal > 0) {
                    currentVal--;
                    inputSafety.value = currentVal;
                    updateStockSafetyQuantity(item.id, currentVal, tr);
                }
            });
        }
        if (btnSafetyPlus && inputSafety) {
            btnSafetyPlus.addEventListener('click', () => {
                let currentVal = parseInt(inputSafety.value) || 0;
                currentVal++;
                inputSafety.value = currentVal;
                updateStockSafetyQuantity(item.id, currentVal, tr);
            });
        }
        if (inputSafety) {
            inputSafety.addEventListener('change', () => {
                let val = Math.max(0, parseInt(inputSafety.value) || 0);
                inputSafety.value = val;
                updateStockSafetyQuantity(item.id, val, tr);
            });
            inputSafety.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') inputSafety.blur();
            });
        }

        // 3. 등급 클릭 시 순환 변경 (A -> B -> C -> A, 단 동일 물품에 이미 등록된 등급은 건너뜀)
        const gradeCell = tr.querySelector('.stock-grade-cell');
        if (gradeCell) {
            gradeCell.addEventListener('click', () => {
                if (!rowEditable) return;
                const currentGrade = (item.grade || 'A').toUpperCase();
                const allGrades = ['A', 'B', 'C'];
                // 동일 사업장에 동일한 물품의 다른 행들이 사용 중인 등급 목록
                const usedGrades = new Set(
                    (adminItemStocks || [])
                        .filter(it => String(it.id) !== String(item.id) &&
                                      (it.site_group || '').trim() === (item.site_group || '').trim() &&
                                      (((it.code || '').trim() && (it.code || '').trim().toLowerCase() === (item.code || '').trim().toLowerCase()) ||
                                       ((it.part || '').trim() && (it.part || '').trim().toLowerCase() === (item.part || '').trim().toLowerCase())))
                        .map(it => (it.grade || 'A').toUpperCase())
                );

                const curIdx = allGrades.indexOf(currentGrade);
                let nextGrade = null;
                for (let i = 1; i <= 3; i++) {
                    const candidate = allGrades[(curIdx + i) % 3];
                    if (!usedGrades.has(candidate)) {
                        nextGrade = candidate;
                        break;
                    }
                }
                if (!nextGrade || nextGrade === currentGrade) {
                    alert('다른 등급(A/B/C)이 이미 모두 등록되어 있어 등급을 변경할 수 없습니다.');
                    return;
                }
                updateStockGrade(item.id, nextGrade, tr);
            });
        }

        // 4. 삭제
        const btnDel = tr.querySelector('.btn-del-stock');
        if (btnDel) {
            btnDel.addEventListener('click', () => {
                deleteItemStock(item.id, item.part || item.code);
            });
        }

        tbody.appendChild(tr);
    });

    updateStockSummaryCounts();
}

// 물품 상태 배지 HTML 생성 헬퍼 (미확보, 부족, 정상)
function getItemStockStatusBadgeHtml(qty, safetyQty) {
    const q = parseInt(qty) || 0;
    const s = parseInt(safetyQty) || 0;
    if (q === 0) {
        return `<span class="stock-badge badge-status-zero">미확보</span>`;
    } else if (q >= s) {
        return `<span class="stock-badge badge-status-normal">정상</span>`;
    } else {
        return `<span class="stock-badge badge-status-shortage">부족</span>`;
    }
}

// 툴바 미확보 수, 부족 수 요약 건수 계산 및 갱신
function updateStockSummaryCounts() {
    let groupItems = adminItemStocks || [];
    if (currentStockSiteGroup && currentStockSiteGroup !== '전체' && currentStockSiteGroup !== 'ALL') {
        groupItems = groupItems.filter(item => (item.site_group || '').trim() === currentStockSiteGroup.trim());
    }

    let zeroCount = 0;
    let shortageCount = 0;

    groupItems.forEach(item => {
        const q = parseInt(item.quantity) || 0;
        const s = parseInt(item.safety_quantity) || 0;
        if (q === 0) {
            zeroCount++;
        } else if (q < s) {
            shortageCount++;
        }
    });

    const zeroEl = document.getElementById('stock-summary-zero-count');
    const shortageEl = document.getElementById('stock-summary-shortage-count');
    if (zeroEl) zeroEl.textContent = zeroCount;
    if (shortageEl) shortageEl.textContent = shortageCount;
}

// 현재 수량 업데이트 (DB 통신 및 상태 반영)
async function updateStockQuantity(stockId, newQty, trEl) {
    if (denyStockEdit(getStockGroupById(stockId), '수량 수정')) return;
    const item = adminItemStocks.find(it => String(it.id) === String(stockId));
    if (item) {
        item.quantity = newQty;
    }

    saveItemStocksLocally();

    if (trEl && item) {
        const statusCell = trEl.querySelector('.stock-status-cell');
        if (statusCell) {
            statusCell.innerHTML = getItemStockStatusBadgeHtml(item.quantity, item.safety_quantity);
        }
    }
    updateStockSummaryCounts();

    const success = await window.syncAdminDB('item_stock', 'UPDATE', {
        id: stockId,
        quantity: newQty
    });

    if (success) {
        if (trEl) {
            trEl.classList.remove('stock-saved-flash');
            void trEl.offsetWidth;
            trEl.classList.add('stock-saved-flash');
        }
    } else {
        alert('수량 저장에 실패했습니다.');
    }
}

// 안전 재고 수량 업데이트 (DB 통신 및 상태 반영)
async function updateStockSafetyQuantity(stockId, newSafetyQty, trEl) {
    if (denyStockEdit(getStockGroupById(stockId), '안전 재고 수정')) return;
    const item = adminItemStocks.find(it => String(it.id) === String(stockId));
    if (item) {
        item.safety_quantity = newSafetyQty;
    }

    saveItemStocksLocally();

    if (trEl && item) {
        const statusCell = trEl.querySelector('.stock-status-cell');
        if (statusCell) {
            statusCell.innerHTML = getItemStockStatusBadgeHtml(item.quantity, item.safety_quantity);
        }
    }
    updateStockSummaryCounts();

    const success = await window.syncAdminDB('item_stock', 'UPDATE', {
        id: stockId,
        safety_quantity: newSafetyQty
    });

    if (success) {
        if (trEl) {
            trEl.classList.remove('stock-saved-flash');
            void trEl.offsetWidth;
            trEl.classList.add('stock-saved-flash');
        }
    } else {
        alert('안전 재고 수량 저장에 실패했습니다.');
    }
}

// 물품 등급 배지 HTML 생성 헬퍼 (A, B, C)
function getItemGradeBadgeHtml(grade) {
    const g = (grade || 'A').toUpperCase();
    let cls = 'badge-grade-a';
    if (g === 'B') cls = 'badge-grade-b';
    else if (g === 'C') cls = 'badge-grade-c';
    return `<span class="stock-badge ${cls} clickable-grade" title="클릭하여 등급 변경 (A → B → C)">${g}</span>`;
}

// 물품 등급 업데이트 (DB 통신 및 상태 반영)
async function updateStockGrade(stockId, newGrade, trEl) {
    if (denyStockEdit(getStockGroupById(stockId), '등급 수정')) return;
    const item = adminItemStocks.find(it => String(it.id) === String(stockId));
    if (item) {
        item.grade = newGrade;
    }

    saveItemStocksLocally();

    if (trEl) {
        const cell = trEl.querySelector('.stock-grade-cell');
        if (cell) cell.innerHTML = getItemGradeBadgeHtml(newGrade);
    }

    const success = await window.syncAdminDB('item_stock', 'UPDATE', {
        id: stockId,
        grade: newGrade
    });

    if (success) {
        if (trEl) {
            trEl.classList.remove('stock-saved-flash');
            void trEl.offsetWidth;
            trEl.classList.add('stock-saved-flash');
        }
    } else {
        alert('등급 저장에 실패했습니다.');
    }
}

// 메모 업데이트 (DB 통신 및 상태 반영)
async function updateStockMemo(stockId, newMemo, trEl) {
    if (denyStockEdit(getStockGroupById(stockId), '메모 수정')) return;
    const item = adminItemStocks.find(it => String(it.id) === String(stockId));
    if (item) {
        item.memo = newMemo;
    }

    saveItemStocksLocally();

    const success = await window.syncAdminDB('item_stock', 'UPDATE', {
        id: stockId,
        memo: newMemo
    });

    if (success) {
        if (trEl) {
            trEl.classList.remove('stock-saved-flash');
            void trEl.offsetWidth;
            trEl.classList.add('stock-saved-flash');
        }
    } else {
        alert('메모 저장에 실패했습니다.');
    }
}

// 물품 삭제
async function deleteItemStock(stockId, itemName) {
    if (denyStockEdit(getStockGroupById(stockId), '삭제')) return;
    const targetLabel = (currentStockSiteGroup && currentStockSiteGroup !== '전체') ? currentStockSiteGroup : '물품';
    if (!confirm(`[${itemName}] 물품을 물품 현황에서 삭제하시겠습니까?`)) {
        return;
    }

    const success = await window.syncAdminDB('item_stock', 'DELETE', { id: stockId });
    if (success) {
        adminItemStocks = adminItemStocks.filter(it => String(it.id) !== String(stockId));
        saveItemStocksLocally();
        renderItemStockTable();
    } else {
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 물품 등록 모달 열기
function openAddStockModal() {
    if (!isUserAdminRole()) return alert('일반 계정은 조회만 가능하며, 물품 등록 권한이 없습니다.');
    if (currentStockSiteGroup === '전체' || currentStockSiteGroup === 'ALL' || !currentStockSiteGroup) {
        return alert('물품을 등록할 특정 사업장 구분을 상단 탭에서 먼저 선택해주세요.');
    }
    if (denyStockEdit(currentStockSiteGroup, '등록')) return;

    const modal = document.getElementById('item-stock-add-modal');
    const groupLabel = document.getElementById('modal-stock-group-label');
    const searchInput = document.getElementById('modal-stock-item-search');
    const qtyInput = document.getElementById('modal-stock-quantity');
    const safetyQtyInput = document.getElementById('modal-stock-safety-quantity');

    if (!modal) return;

    selectedMasterItemForStock = null;
    const targetGroup = currentStockSiteGroup;

    if (groupLabel) groupLabel.textContent = targetGroup;

    updateModalGradeOptions(null);

    if (searchInput) searchInput.value = '';
    if (qtyInput) qtyInput.value = 0;
    if (safetyQtyInput) safetyQtyInput.value = 0;

    resetModalSelectedInfo();
    renderModalMasterItemList('');

    modal.style.display = 'flex';
    if (searchInput) searchInput.focus();
}

// 물품 등록 모달 닫기
function closeAddStockModal() {
    const modal = document.getElementById('item-stock-add-modal');
    if (modal) modal.style.display = 'none';
    selectedMasterItemForStock = null;
}

// 모달 선택 정보 초기화
function resetModalSelectedInfo() {
    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '-';
    };
    setTxt('modal-selected-code', '-');
    setTxt('modal-selected-part', '-');
    setTxt('modal-selected-spec', '-');
    setTxt('modal-selected-partno', '-');
    setTxt('modal-selected-detail-type', '-');
    updateModalGradeOptions(null);
}

// 모달 등급 옵션 동적 갱신 (선택된 항목의 이미 등록된 등급은 제외하여 노출)
function updateModalGradeOptions(item) {
    const gradeSelect = document.getElementById('modal-stock-grade');
    if (!gradeSelect) return;

    const allGrades = ['B', 'C', 'A']; // 기본 B, C, A 순서

    if (!item) {
        gradeSelect.disabled = false;
        gradeSelect.innerHTML = `
            <option value="B" selected>B 등급</option>
            <option value="C">C 등급</option>
            <option value="A">A 등급</option>
        `;
        return;
    }

    const targetGroup = currentStockSiteGroup || 'SEC';

    // 해당 사업장 구분에 이미 등록된 등급 수집
    const registeredGrades = new Set();
    (adminItemStocks || []).forEach(st => {
        const matchesGroup = (st.site_group || '').trim() === targetGroup.trim();
        if (matchesGroup) {
            const isSameCode = (st.code || '').trim().toLowerCase() === (item.code || '').trim().toLowerCase();
            const isSamePart = (st.part || '').trim().toLowerCase() === (item.part || '').trim().toLowerCase();
            const isSameSpec = (st.spec || '').trim().toLowerCase() === (item.spec || '').trim().toLowerCase();
            if (isSameCode && isSamePart && isSameSpec) {
                registeredGrades.add((st.grade || 'A').toUpperCase());
            }
        }
    });

    // 아직 등록되지 않은 사용 가능한 등급 필터링
    const availableGrades = allGrades.filter(g => !registeredGrades.has(g));

    gradeSelect.innerHTML = '';
    if (availableGrades.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '모든 등급(A/B/C) 등록 완료';
        opt.disabled = true;
        opt.selected = true;
        gradeSelect.appendChild(opt);
        gradeSelect.disabled = true;
    } else {
        gradeSelect.disabled = false;
        availableGrades.forEach((g, idx) => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = `${g} 등급`;
            if (idx === 0) opt.selected = true;
            gradeSelect.appendChild(opt);
        });
    }
}

// 모달 내 마스터 물품 목록 렌더링 (모든 항목 노출 + 등록된 등급 배지 표기 + 터치 스크롤 방지 규칙 9 적용)
function renderModalMasterItemList(filterText) {
    const listEl = document.getElementById('modal-stock-master-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const targetGroup = currentStockSiteGroup || 'SEC';

    // 검색어 필터링 (마스터 물품 목록 전체 항목을 대상으로 검색)
    const query = (filterText || '').toLowerCase();
    const filtered = (adminItems || []).filter(item => {
        if (!query) return true;
        const code = (item.code || '').toLowerCase();
        const part = (item.part || '').toLowerCase();
        const spec = (item.spec || '').toLowerCase();
        const partno = (item.partno || '').toLowerCase();
        return code.includes(query) || part.includes(query) || spec.includes(query) || partno.includes(query);
    });

    if (filtered.length === 0) {
        listEl.innerHTML = '<li style="padding: 12px; color: #8b949e; text-align: center; cursor: default;">검색된 마스터 물품이 없습니다.</li>';
        return;
    }

    filtered.forEach(item => {
        const li = document.createElement('li');
        li.style.padding = '7px 10px';
        li.style.cursor = 'pointer';
        li.style.borderBottom = '1px solid #21262d';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.fontSize = '12px';
        li.style.minWidth = '770px';
        li.style.transition = 'background 0.15s ease';

        // 해당 사업장에 이미 등록되어 있는 등급 추출
        const existingGrades = [];
        (adminItemStocks || []).forEach(st => {
            const matchesGroup = (st.site_group || '').trim() === targetGroup.trim();
            if (matchesGroup) {
                const isSameCode = (st.code || '').trim().toLowerCase() === (item.code || '').trim().toLowerCase();
                const isSamePart = (st.part || '').trim().toLowerCase() === (item.part || '').trim().toLowerCase();
                const isSameSpec = (st.spec || '').trim().toLowerCase() === (item.spec || '').trim().toLowerCase();
                if (isSameCode && isSamePart && isSameSpec) {
                    const g = (st.grade || 'A').toUpperCase();
                    if (!existingGrades.includes(g)) existingGrades.push(g);
                }
            }
        });

        let badgeHtml = '<span style="color: #484f58; font-size: 11px;">미등록</span>';
        if (existingGrades.length >= 3) {
            badgeHtml = `<span style="font-size: 11px; color: #8b949e; background: #21262d; padding: 2px 6px; border-radius: 4px;">전체 등록됨</span>`;
        } else if (existingGrades.length > 0) {
            existingGrades.sort();
            badgeHtml = `<span style="font-size: 11px; color: #e3b341; background: #382814; border: 1px solid #bb800955; padding: 1px 6px; border-radius: 4px;">${existingGrades.join(',')} 등록됨</span>`;
        }

        const codeVal = item.code || '-';
        const partVal = item.part || '-';
        const specVal = item.spec || '-';
        const partnoVal = item.partno || '-';

        li.innerHTML = `
            <div style="width: 85px; flex-shrink: 0; text-align: center; color: #8b949e; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;" title="${partnoVal}">${partnoVal}</div>
            <div style="width: 200px; flex-shrink: 0; color: #58a6ff; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;" title="${codeVal}">${codeVal}</div>
            <div style="width: 200px; flex-shrink: 0; color: #e6edf3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;" title="${partVal}">${partVal}</div>
            <div style="flex: 1; min-width: 160px; color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;" title="${specVal}">${specVal}</div>
            <div style="width: 95px; flex-shrink: 0; text-align: center;">${badgeHtml}</div>
        `;

        // 규칙 9 준수: 모바일 터치 스크롤 시 자동 선택 방지 (터치 이동 거리 6px 초과 시 스킵)
        let touchStartX = 0;
        let touchStartY = 0;
        let isTouchMoving = false;

        li.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isTouchMoving = false;
        }, { passive: true });

        li.addEventListener('touchmove', (e) => {
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > 6 || dy > 6) {
                isTouchMoving = true;
            }
        }, { passive: true });

        li.addEventListener('touchend', (e) => {
            if (isTouchMoving) return;
            selectMasterItemInModal(item, li);
        });

        li.addEventListener('click', (e) => {
            selectMasterItemInModal(item, li);
        });

        listEl.appendChild(li);
    });
}

// 모달에서 마스터 물품 선택 시
function selectMasterItemInModal(item, liEl) {
    selectedMasterItemForStock = item;

    // 활성화 표시
    const listEl = document.getElementById('modal-stock-master-list');
    if (listEl) {
        listEl.querySelectorAll('li').forEach(el => {
            el.style.background = 'transparent';
        });
    }
    if (liEl) {
        liEl.style.background = '#1f6feb33';
    }

    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '-';
    };

    setTxt('modal-selected-code', item.code || '-');
    setTxt('modal-selected-part', item.part || '-');
    setTxt('modal-selected-spec', item.spec || '-');
    setTxt('modal-selected-partno', item.partno || '-');
    setTxt('modal-selected-detail-type', item.detailType || item.detail_type || '-');

    // 이미 등록된 등급을 제외하여 등급 셀렉트박스 옵션 갱신
    updateModalGradeOptions(item);

    const qtyInput = document.getElementById('modal-stock-quantity');
    if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
    }
}

// 모달 등록 제출
async function submitAddStock() {
    if (!isUserAdminRole()) return alert('일반 계정은 조회만 가능하며, 물품 등록 권한이 없습니다.');
    if (currentStockSiteGroup === '전체' || currentStockSiteGroup === 'ALL' || !currentStockSiteGroup) {
        return alert('물품을 등록할 특정 사업장 구분을 상단 탭에서 먼저 선택해주세요.');
    }
    if (denyStockEdit(currentStockSiteGroup, '등록')) return;

    if (!selectedMasterItemForStock) {
        return alert('등록할 마스터 물품을 목록에서 선택해주세요.');
    }

    const gradeSelect = document.getElementById('modal-stock-grade');
    const qtyInput = document.getElementById('modal-stock-quantity');
    const safetyQtyInput = document.getElementById('modal-stock-safety-quantity');

    if (gradeSelect && (gradeSelect.disabled || !gradeSelect.value)) {
        return alert('선택한 물품은 이미 모든 등급(A/B/C)이 등록되어 있어 더 이상 추가할 수 없습니다.');
    }

    const targetGroup = currentStockSiteGroup;
    const siteName = '';
    const grade = gradeSelect ? gradeSelect.value.trim() : 'B';
    const quantity = Math.max(0, parseInt(qtyInput ? qtyInput.value : 0) || 0);
    const safetyQuantity = Math.max(0, parseInt(safetyQtyInput ? safetyQtyInput.value : 0) || 0);
    const memo = '';

    // 동일 사업장에 코드명, 물품명, 규격, 등급까지 동일한 경우에만 중복 등록 차단
    const isDuplicate = (adminItemStocks || []).some(it => {
        const matchesGroup = (it.site_group || '').trim() === targetGroup.trim();
        return matchesGroup &&
            (it.code || '').trim().toLowerCase() === (selectedMasterItemForStock.code || '').trim().toLowerCase() &&
            (it.part || '').trim().toLowerCase() === (selectedMasterItemForStock.part || '').trim().toLowerCase() &&
            (it.spec || '').trim().toLowerCase() === (selectedMasterItemForStock.spec || '').trim().toLowerCase() &&
            (it.grade || 'A').trim().toUpperCase() === grade.toUpperCase();
    });

    if (isDuplicate) {
        return alert(`이미 [${targetGroup}]에 동일한 물품의 [${grade}등급]이 등록되어 있습니다.`);
    }

    const payload = {
        site_group: targetGroup,
        site_name: siteName,
        item_id: String(selectedMasterItemForStock.id || ''),
        code: selectedMasterItemForStock.code || '',
        part: selectedMasterItemForStock.part || '',
        spec: selectedMasterItemForStock.spec || '',
        partno: selectedMasterItemForStock.partno || '',
        detail_type: selectedMasterItemForStock.detailType || selectedMasterItemForStock.detail_type || '',
        grade: grade,
        quantity: quantity,
        safety_quantity: safetyQuantity,
        memo: memo
    };

    const res = await fetch('/api/admin/crud', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrf_token')
        },
        body: JSON.stringify({
            domain: 'item_stock',
            action: 'CREATE',
            payload: payload
        })
    });

    const data = await res.json();
    if (data.status === 'success') {
        const newId = data.id || Date.now();
        adminItemStocks.push({
            id: newId,
            ...payload
        });

        saveItemStocksLocally();

        renderItemStockTable();
        closeAddStockModal();
        const siteLabel = siteName ? `[${siteName}]` : `[${targetGroup}]`;
        alert(`[${payload.part || payload.code}] (${grade}등급) 물품이 ${siteLabel}에 성공적으로 등록되었습니다.`);
    } else {
        alert(data.message || '물품 등록 중 오류가 발생했습니다.');
    }
}

// 마스터 물품 전체를 현재 사업장(또는 구분)으로 일괄 불러오기
async function importMasterItemsToCurrentGroup() {
    if (!isUserAdminRole()) return alert('일반 계정은 조회만 가능하며, 마스터 물품 불러오기 권한이 없습니다.');
    if (currentStockSiteGroup === '전체' || currentStockSiteGroup === 'ALL' || !currentStockSiteGroup) {
        return alert('마스터 물품을 일괄 등록할 특정 사업장 구분을 상단 탭에서 먼저 선택해주세요.');
    }
    if (denyStockEdit(currentStockSiteGroup, '일괄 등록')) return;

    if (!adminItems || adminItems.length === 0) {
        return alert('등록된 마스터 물품이 없습니다. 물품 관리 메뉴에서 먼저 물품을 등록해주세요.');
    }

    const targetSite = '';
    const targetLabel = `사업장 구분 [${currentStockSiteGroup}]`;

    const currentGroupItems = adminItemStocks.filter(it => {
        return (it.site_group || '').trim() === currentStockSiteGroup.trim();
    });
    const existingKeys = new Set(currentGroupItems.map(it => `${(it.code || '').trim()}::${(it.part || '').trim()}::${(it.spec || '').trim()}`));

    // 아직 등록되지 않은 마스터 물품 추출
    const toAdd = adminItems.filter(m => {
        const key = `${(m.code || '').trim()}::${(m.part || '').trim()}::${(m.spec || '').trim()}`;
        return !existingKeys.has(key);
    });

    if (toAdd.length === 0) {
        return alert(`마스터 물품 목록의 모든 물품이 이미 ${targetLabel}에 등록되어 있습니다.`);
    }

    if (!confirm(`마스터 물품 중 아직 미등록된 ${toAdd.length}건의 물품을 ${targetLabel}에 A등급, 기본 수량 0으로 일괄 등록하시겠습니까?`)) {
        return;
    }

    let successCount = 0;
    for (const m of toAdd) {
        const payload = {
            site_group: currentStockSiteGroup,
            site_name: targetSite,
            item_id: String(m.id || ''),
            code: m.code || '',
            part: m.part || '',
            spec: m.spec || '',
            partno: m.partno || '',
            detail_type: m.detailType || m.detail_type || '',
            grade: 'A', // 마스터 물품 불러오기로 한 항목은 전부 A로 고정
            quantity: 0,
            safety_quantity: 0,
            memo: ''
        };

        try {
            const res = await fetch('/api/admin/crud', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrf_token')
                },
                body: JSON.stringify({
                    domain: 'item_stock',
                    action: 'CREATE',
                    payload: payload
                })
            });
            const data = await res.json();
            if (data.status === 'success') {
                adminItemStocks.push({
                    id: data.id || Date.now(),
                    ...payload
                });
                successCount++;
            }
        } catch (e) {
            console.error('Failed to import item:', m, e);
        }
    }

    saveItemStocksLocally();

    renderItemStockTable();
    alert(`총 ${successCount}건의 마스터 물품이 ${targetLabel}에 A등급으로 등록되었습니다.`);
}

// 물품 관리 현황 CSV 내보내기 (사업장 및 안전 재고 수량 포함)
function exportStockCsv() {
    let groupItems = adminItemStocks;
    if (currentStockSiteGroup && currentStockSiteGroup !== '전체' && currentStockSiteGroup !== 'ALL') {
        groupItems = adminItemStocks.filter(it => (it.site_group || '').trim() === currentStockSiteGroup.trim());
    }

    if (groupItems.length === 0) {
        return alert(`내보낼 물품 데이터가 없습니다.`);
    }

    const headers = ['No', '사업장구분', '사업장명', '상세구분', '품번', '코드명', '물품명', '세부규격', '현재수량', '안전재고수량', '상태', '등급'];
    const rows = groupItems.map((item, idx) => {
        const qty = parseInt(item.quantity) || 0;
        const safetyQty = parseInt(item.safety_quantity) || 0;
        const grade = (item.grade || 'A').toUpperCase();
        const statusStr = qty === 0 ? '미확보' : (qty >= safetyQty ? '정상' : '부족');

        return [
            idx + 1,
            `"${(item.site_group || '').replace(/"/g, '""')}"`,
            `"${(item.site_name || '').replace(/"/g, '""')}"`,
            `"${(item.detail_type || '').replace(/"/g, '""')}"`,
            `"${(item.partno || '').replace(/"/g, '""')}"`,
            `"${(item.code || '').replace(/"/g, '""')}"`,
            `"${(item.part || '').replace(/"/g, '""')}"`,
            `"${(item.spec || '').replace(/"/g, '""')}"`,
            qty,
            safetyQty,
            `"${statusStr}"`,
            `"${grade}"`
        ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileSuffix = (currentStockSiteGroup && currentStockSiteGroup !== '전체' && currentStockSiteGroup !== 'ALL') ? currentStockSiteGroup : '전체';
    a.download = `물품관리현황_${fileSuffix}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
