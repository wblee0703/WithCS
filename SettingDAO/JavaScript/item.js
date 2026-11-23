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

    // 6-1. [요청] 모바일: 물품 등록/불러오기 버튼을 사업장 구분 줄 오른쪽으로 이동
    setupStockActionsPlacement();

    // 6-6. [요청] 재고 관리 모달 (미확보·부족 물품 수량 변경)
    setupStockManageModal();

    // 6-7. [추가] 상세 관리 물품 상세 모달
    setupStockUnitModal();

    // 6-8. [요청] 사용 이력 반영 시 상세 관리 물품 선택 창
    setupUsagePickModal();

    // 6-5. [추가] 물품 전체 삭제 버튼
    const btnDeleteAll = document.getElementById('btn-delete-all-stock');
    if (btnDeleteAll) btnDeleteAll.addEventListener('click', deleteAllItemStocks);

    // 6-4. [요청] 모바일: 리스트를 화면 높이에 맞추고 내부 스크롤
    setupStockTableFit();

    // 6-3. [요청] 사용 이력 모달 (최근 일주일 작업 → 재고 반영)
    setupUsageModal();

    // 6-2. [요청] 모바일: 축소/확장 버튼 (축소 시 안전 재고·상태·등급·기능 열 숨김)
    setupStockCompactToggle();

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

// [추가] 모바일(950px 이하)에서는 물품 등록/불러오기 버튼을 사업장 구분 줄 오른쪽에, PC에서는 툴바에 배치
function setupStockActionsPlacement() {
    const actions = document.querySelector('.item-stock-actions');
    const groupHeader = document.querySelector('.item-stock-group-header');
    const toolbar = document.querySelector('.item-stock-toolbar');
    if (!actions || !groupHeader || !toolbar) return;

    // [요청] 모바일: 물품 불러오기·전체 삭제 버튼은 카드 제목 줄의 CSV 내보내기 왼쪽으로
    const csvBtn = document.getElementById('btn-export-stock-csv');
    const headerActions = csvBtn ? csvBtn.parentElement : null;
    if (headerActions) headerActions.classList.add('item-stock-header-actions');
    const headerMovable = ['btn-import-master-items', 'btn-delete-all-stock']
        .map(id => document.getElementById(id)).filter(Boolean);

    // [요청] PC: 사업장 구분 카드를 '물품 관리 현황' 제목 오른쪽으로 (모바일은 기존 위치 유지)
    const titleEl = document.querySelector('#section-item-stock-mgmt .card-header h3');
    const titleWrap = titleEl ? titleEl.parentElement : null;
    const cardBody = groupHeader.parentElement;
    if (titleWrap) titleWrap.classList.add('item-stock-title-wrap');

    const mq = window.matchMedia('(max-width: 950px)');
    const place = () => {
        if (titleWrap && cardBody) {
            if (mq.matches) {
                if (groupHeader.parentElement !== cardBody) cardBody.insertBefore(groupHeader, cardBody.firstChild);
            } else if (groupHeader.parentElement !== titleWrap) {
                titleWrap.appendChild(groupHeader);
            }
        }
        const target = mq.matches ? groupHeader : toolbar;
        if (actions.parentElement !== target) target.appendChild(actions);
        headerMovable.forEach(b => {
            if (mq.matches && headerActions) {
                if (b.parentElement !== headerActions) headerActions.insertBefore(b, csvBtn);
            } else if (b.parentElement !== actions) {
                actions.appendChild(b); // PC: 원래 순서(사용 이력, 물품 등록, 물품 불러오기, 전체 삭제)로 복귀
            }
        });
    };
    place();
    if (mq.addEventListener) mq.addEventListener('change', place);
    else mq.addListener(place); // 구형 브라우저 대응
}

// [요청] 모바일: 물품 리스트를 화면 아래 끝까지만 표시하고 나머지는 리스트 안에서 스크롤
function fitStockTableToViewport() {
    const wrap = document.querySelector('.item-stock-table-wrapper');
    if (!wrap) return;
    if (!window.matchMedia('(max-width: 950px)').matches) {
        wrap.style.height = '';
        wrap.style.flex = '';
        return;
    }
    const top = wrap.getBoundingClientRect().top + window.scrollY; // 페이지 맨 위 기준 위치
    const h = Math.max(200, window.innerHeight - top - 8);          // 아래 여백 8px, 최소 200px
    wrap.style.flex = 'none';
    wrap.style.height = `${h}px`;
}

function setupStockTableFit() {
    let timer = null;
    const refit = () => {
        clearTimeout(timer);
        timer = setTimeout(fitStockTableToViewport, 100);
    };
    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
    fitStockTableToViewport();
}

// [추가] 모바일 축소/확장 토글 (마지막 상태 기억). 숨김 처리는 admin.css의 모바일 규칙에서만 적용됨
function setupStockCompactToggle() {
    const btn = document.getElementById('btn-stock-compact-toggle');
    const section = document.getElementById('section-item-stock-mgmt');
    if (!btn || !section) return;

    const apply = (compact) => {
        section.classList.toggle('item-stock-compact', compact);
        btn.textContent = compact ? '확장' : '축소';
        btn.title = compact ? '안전 재고·상태·등급·기능 열 보이기' : '안전 재고·상태·등급·기능 열 숨기기';
    };
    // [요청] 페이지를 열 때는 항상 축소 상태로 시작 (축소 표시는 모바일 CSS에서만 적용)
    apply(true);
    btn.addEventListener('click', () => apply(!section.classList.contains('item-stock-compact')));
}

/* ==========================================================================
   [추가] 사용 이력: 최근 일주일 작업의 사용 물품을 재고에 반영
   - 목록: GET /api/item/usage?group=  /  반영: POST /api/item/usage/apply
   ========================================================================== */
function setupUsageModal() {
    const btnOpen = document.getElementById('btn-open-usage-modal');
    const modal = document.getElementById('item-usage-modal');
    const btnClose = document.getElementById('btn-close-usage-modal');
    if (!btnOpen || !modal) return;

    const close = () => { modal.style.display = 'none'; };
    btnOpen.addEventListener('click', openUsageModal);
    if (btnClose) btnClose.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    // 반영 버튼 (이벤트 위임)
    const list = document.getElementById('usage-work-list');
    if (list) {
        list.addEventListener('click', (e) => {
            const b = e.target.closest('.btn-usage-apply');
            if (b && !b.disabled) applyUsageWork(b.dataset.logUid, b, b.dataset.edit === '1');
        });
    }
}

async function openUsageModal() {
    if (denyStockEdit(currentStockSiteGroup, '사용 이력 확인')) return;
    const modal = document.getElementById('item-usage-modal');
    const list = document.getElementById('usage-work-list');
    const groupLabel = document.getElementById('usage-modal-group-label');
    const rangeLabel = document.getElementById('usage-modal-range');
    if (!modal || !list) return;

    const group = (currentStockSiteGroup && currentStockSiteGroup !== 'ALL') ? currentStockSiteGroup : '전체';
    if (groupLabel) groupLabel.textContent = group;
    if (rangeLabel) rangeLabel.textContent = '';
    list.innerHTML = '<div class="usage-empty">불러오는 중...</div>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`/api/item/usage?group=${encodeURIComponent(group)}`);
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || '불러오기 실패');
        if (rangeLabel) rangeLabel.textContent = `${data.start} ~ ${data.end}`;
        renderUsageWorkList(data.works || []);
    } catch (e) {
        console.error(e);
        list.innerHTML = `<div class="usage-empty">사용 이력을 불러오지 못했습니다. (${escapeHtml(e.message || '')})</div>`;
    }
}

let usageWorksByUid = {}; // [추가] 반영 시 작업 정보 조회용

function renderUsageWorkList(works) {
    usageWorksByUid = {};
    (works || []).forEach(w => { usageWorksByUid[String(w.log_uid)] = w; });
    // [요청] 사업장 구분은 '전체' 탭에서 열었을 때만 날짜 옆에 표시
    const showGroup = !currentStockSiteGroup || currentStockSiteGroup === '전체' || currentStockSiteGroup === 'ALL';
    const list = document.getElementById('usage-work-list');
    if (!list) return;
    if (!works.length) {
        list.innerHTML = '<div class="usage-empty">최근 일주일간 사용 물품이 있는 작업이 없습니다.</div>';
        return;
    }
    list.innerHTML = works.map(w => {
        // [요청] 사업장 구분은 창 제목(또는 '전체' 탭의 구분 표시)에 이미 나오므로, 사업장명이 사업장 구분과 같으면 장비명 앞에서 생략
        const groupNow = showGroup ? (w.site_group || '') : currentStockSiteGroup;
        const siteName = (w.site_name || '').trim() === (groupNow || '').trim() ? '' : w.site_name;
        const equip = [siteName, w.equip_name, w.equip_serial ? `(${w.equip_serial})` : ''].filter(Boolean).join(' ');
        // [요청] 코드명만 표시, 작업에 물품 상세가 있으면 [상세] 표시, 교체 수량 표시는 생략
        // [요청] 코드명 앞에 비용처리 표시, 무상(중고)는 반영 제외 표시
        const items = (w.items || []).map(it => {
            let stock;
            if (it.excluded) stock = '<span class="usage-stock usage-stock-excluded">반영 제외</span>';
            else if (it.stock_id) stock = `<span class="usage-stock"><span class="usage-stock-label">현재 재고 </span>${it.stock_qty}개</span>`;
            // [수정] 재고 없음 이유 표시 (미등록 / 다른 사업장 재고만 있음 등)
            else if (it.stock_unregistered) stock = '<span class="usage-stock usage-stock-none" title="물품 관리 현황에 등록되지 않은 물품입니다.">미등록</span>'; // [요청]
            // [요청] 괄호 이유는 표시하지 않음 (PC에서 마우스를 올리면 이유 확인)
            else stock = `<span class="usage-stock usage-stock-none" title="${escapeHtml(it.stock_reason || '')}">재고 없음</span>`;
            const cost = it.cost ? `<span class="usage-cost${it.excluded ? ' excluded' : ''}">[${escapeHtml(it.cost)}]</span> ` : '';
            return `<li class="${it.excluded ? 'usage-item-excluded' : ''}">${cost}<strong>${escapeHtml(it.code)}</strong>${it.detail ? ` <span class="usage-spec">[${escapeHtml(it.detail)}]</span>` : ''} ${stock}</li>`;
        }).join('');
        const hasDeductible = (w.items || []).some(it => !it.excluded);

        let action;
        if (!w.applied && !hasDeductible) {
            action = '<button type="button" class="btn-usage-apply" disabled title="무상(중고) 물품만 있어 차감할 물품이 없습니다.">반영 제외</button>';
        } else if (w.applied && w.can_apply) {
            // [요청] 반영됨 버튼을 누르면 반영 내용 수정 (사용 물품 다시 선택 → 이전 반영을 되돌리고 다시 반영)
            action = `<button type="button" class="btn-usage-apply applied" data-log-uid="${w.log_uid}" data-edit="1" title="${escapeHtml(w.applied_at)} ${escapeHtml(w.applied_by)}\n누르면 반영 내용을 수정합니다.">반영됨</button>`;
        } else if (w.applied) {
            action = `<button type="button" class="btn-usage-apply applied" disabled title="${escapeHtml(w.applied_at)} ${escapeHtml(w.applied_by)}">반영됨</button>`;
        } else if (!w.can_apply) {
            action = '<button type="button" class="btn-usage-apply" disabled title="본인 사업장 작업만 반영할 수 있습니다.">반영</button>';
        } else {
            action = `<button type="button" class="btn-usage-apply" data-log-uid="${w.log_uid}">반영</button>`;
        }

        return `
            <div class="usage-work-row">
                <!-- [요청] 날짜·사업장·장비명 줄은 카드 전체 너비 사용 (반영 버튼은 아래 줄 오른쪽) -->
                <div class="usage-work-head">
                    <span class="usage-date">${escapeHtml(w.date)}</span>
                    ${showGroup ? `<span class="usage-group">${escapeHtml(w.site_group || '-')}</span>` : ''}
                    <span class="usage-equip" title="${escapeHtml(equip) || ''}">${escapeHtml(equip)}</span>
                </div>
                <div class="usage-work-body">
                <div class="usage-work-info">
                    ${(w.type || w.worker) ? `
                    <div class="usage-work-sub">
                        ${w.type ? `<span class="usage-type">${escapeHtml(w.type)}</span>` : ''}
                        ${w.worker ? `<span class="usage-worker">${escapeHtml(w.worker)}</span>` : ''}
                    </div>` : ''}
                    <ul class="usage-items">${items}</ul>
                </div>
                <div class="usage-work-action">${action}</div>
                </div>
            </div>`;
    }).join('');
}

async function applyUsageWork(logUid, btn, isEdit = false) {
    const row = btn.closest('.usage-work-row');
    const head = row ? row.querySelector('.usage-work-head') : null;
    const summary = head ? head.textContent.replace(/\s+/g, ' ').trim() : '';

    // [요청] 사용 물품 선택 창을 먼저 띄움 (수량 모드 물품도 현재 → 반영 후 수량 표시)
    // [요청] 반영 수정도 같은 창: 이전에 고른 물품이 선택된 상태로 열림
    const work = usageWorksByUid[String(logUid)];
    if (isEdit || (work && (work.items || []).some(it => !it.excluded))) {
        openUsagePickModal(logUid, summary, (picks) => submitUsageApply(logUid, btn, picks, isEdit), isEdit);
        return;
    }
    if (!confirm(`이 작업의 사용 물품을 현재 수량에서 차감할까요?\n${summary}`)) return;
    submitUsageApply(logUid, btn, {});
}

async function submitUsageApply(logUid, btn, unitPicks, isEdit = false) {
    btn.disabled = true;
    btn.textContent = isEdit ? '수정 중...' : '반영 중...';
    try {
        const res = await fetch('/api/item/usage/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ log_uid: Number(logUid), unit_picks: unitPicks || {}, edit: !!isEdit })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || '반영 실패');

        // 변경된 재고를 화면 목록에 반영
        (data.stocks || []).forEach(s => {
            const idx = adminItemStocks.findIndex(x => String(x.id) === String(s.id));
            if (idx >= 0) adminItemStocks[idx] = s;
        });
        saveItemStocksLocally();
        renderItemStockTable();

        const missing = (data.details || []).filter(d => d.reason === '재고 없음').map(d => d.code);
        const skipped = (data.details || []).filter(d => d.reason === '상세 선택 안 함').map(d => d.code);
        const notes = [];
        if (missing.length) notes.push(`재고가 등록되지 않아 차감하지 못한 물품: ${missing.join(', ')}`);
        if (skipped.length) notes.push(`상세 물품을 고르지 않아 차감하지 않은 물품: ${skipped.join(', ')}`);
        if (notes.length) alert(notes.join('\n'));

        // 목록 새로고침 (재고 수량·반영 상태 갱신)
        openUsageModal();
    } catch (e) {
        console.error(e);
        alert(`${isEdit ? '반영 수정' : '재고 반영'} 실패: ${e.message || ''}`);
        btn.disabled = false;
        btn.textContent = isEdit ? '반영됨' : '반영';
    }
}

// [요청] 상세 관리 물품 선택 창: 물품별로 사용한 미사용 물품(S/N)을 고르고 사용일·사용 장비·정기/비정기 기록
let usagePickOnConfirm = null;
let usagePickGroups = [];
let usagePickIsEdit = false; // [요청] 반영 수정 모드

function setupUsagePickModal() {
    const modal = document.getElementById('usage-pick-modal');
    if (!modal) return;
    const close = () => { modal.style.display = 'none'; usagePickOnConfirm = null; };
    ['btn-close-usage-pick', 'btn-cancel-usage-pick'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.addEventListener('click', close);
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    const body = document.getElementById('usage-pick-body');
    // 같은 물품을 두 번 고르지 못하게: 다른 칸에서 고른 물품은 비활성화
    if (body) body.addEventListener('change', (e) => {
        if (e.target.classList.contains('up-unit')) refreshUsagePickDisabled();
    });

    const btnOk = document.getElementById('btn-confirm-usage-pick');
    if (btnOk) btnOk.addEventListener('click', () => {
        // [요청] 사용한 모든 항목에 물품(S/N)을 지정해야 반영
        const picks = {};
        const missing = [];
        document.querySelectorAll('#usage-pick-body .up-group:not(.up-group-auto)').forEach(g => {
            const sel = g.querySelector('.up-unit');
            const unitId = sel ? sel.value : '';
            if (!unitId) { missing.push(g.dataset.code || ''); return; }
            picks[g.dataset.index] = { unit_id: Number(unitId) };
        });
        if (missing.length) {
            alert(`사용한 물품(S/N)을 모두 지정해야 반영할 수 있습니다.\n지정하지 않은 항목: ${missing.join(', ')}`);
            return;
        }
        const msg = usagePickIsEdit
            ? '반영 내용을 수정할까요?\n\n이전에 반영한 사용 기록을 되돌리고, 지금 선택한 내용으로 다시 반영합니다.'
            : '선택한 물품에 사용 기록을 남기고 반영할까요?\n반영한 뒤에도 [반영됨]을 눌러 수정할 수 있습니다.';
        if (!confirm(msg)) return;
        const cb = usagePickOnConfirm;
        close();
        if (cb) cb(picks);
    });
}

function refreshUsagePickDisabled() {
    const selects = Array.from(document.querySelectorAll('#usage-pick-body .up-unit'));
    const chosen = selects.map(s => s.value).filter(Boolean);
    selects.forEach(s => {
        Array.from(s.options).forEach(o => {
            if (!o.value) return;
            o.disabled = o.value !== s.value && chosen.includes(o.value);
        });
    });
}

async function openUsagePickModal(logUid, summary, onConfirm, isEdit = false) {
    const modal = document.getElementById('usage-pick-modal');
    const body = document.getElementById('usage-pick-body');
    if (!modal || !body) return;
    try {
        const res = await fetch(`/api/item/usage/units?log_uid=${encodeURIComponent(logUid)}${isEdit ? '&edit=1' : ''}`);
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || '불러오기 실패');
        // [요청] S/N 선택 물품을 맨 위로 (그다음 수량 모드, 재고 없음 순, 같은 종류 안에서는 작업 순서 유지)
        const modeRank = { sn: 0, qty: 1, none: 2 };
        usagePickGroups = (data.groups || []).slice().sort((a, b) => (modeRank[a.mode] ?? 3) - (modeRank[b.mode] ?? 3));
        usagePickOnConfirm = onConfirm;
        usagePickIsEdit = !!isEdit;
        const titleEl = document.getElementById('usage-pick-title');
        if (titleEl) titleEl.textContent = isEdit ? '반영 수정 (사용 물품 다시 선택)' : '사용 물품 선택';
        const okBtn = document.getElementById('btn-confirm-usage-pick');
        if (okBtn) okBtn.textContent = isEdit ? '수정 반영' : '반영';

        // [요청] 사용일·사용 장비·정기/비정기는 모든 물품에 같으므로 맨 위에 한 번만 표시
        const common = document.getElementById('usage-pick-common');
        if (common) {
            const kind = data.default_kind || '-';
            // [요청] 순서: 사용일, 작업 구분, 사업장, 장비
            common.innerHTML = `
                <div><span class="up-common-label">사용일</span>${escapeHtml(data.date) || '-'}</div>
                <div><span class="up-common-label">작업 구분</span><span class="su-kind ${kind === '정기' ? 'kind-regular' : 'kind-irregular'}">${escapeHtml(kind)}</span></div>
                <div><span class="up-common-label">사업장</span>${escapeHtml(data.site) || '-'}</div>
                <div class="up-common-equip"><span class="up-common-label">장비</span>${escapeHtml(data.equip) || '-'}</div>`;
        }

        // [요청] 리스트: 물품마다 한 줄, 사용한 물품(S/N)을 반드시 지정
        body.innerHTML = usagePickGroups.map(g => {
            // [요청] 현재 수량 → 반영 후 수량
            const qtyInfo = g.mode === 'none'
                ? `<span class="up-qty up-qty-none">${g.unregistered ? '미등록' : '재고 없음'}</span>`
                : `<span class="up-qty">${g.mode === 'qty' ? `<span class="up-mode">수량 ${g.use_qty}개 자동 차감</span>` : ''}현재 <b>${g.current}</b>개 → 반영 후 <b class="${g.after === 0 ? 'zero' : ''}">${g.after}</b>개</span>`;
            if (g.mode !== 'sn') {
                return `
                <div class="up-group up-group-auto" data-index="${g.index}" data-code="${escapeHtml(g.code)}">
                    <div class="up-title">
                        ${g.cost ? `<span class="usage-cost">[${escapeHtml(g.cost)}]</span>` : ''}
                        <strong>${escapeHtml(g.code)}</strong>${g.detail ? ` <span class="usage-spec">[${escapeHtml(g.detail)}]</span>` : ''}
                        ${qtyInfo}
                    </div>
                </div>`;
            }
            const unitOpts = (g.units || []).map(u => {
                const label = [u.serial ? `S/N ${u.serial}` : 'S/N 없음', u.in_date ? `입고 ${u.in_date}` : '',
                    u.picked ? '(이전 선택)' : ''].filter(Boolean).join(' · ');
                return `<option value="${u.id}"${u.picked ? ' data-picked="1"' : ''}>${escapeHtml(label)}</option>`;
            }).join('');
            return `
                <div class="up-group" data-index="${g.index}" data-code="${escapeHtml(g.code)}">
                    <div class="up-title">
                        ${g.cost ? `<span class="usage-cost">[${escapeHtml(g.cost)}]</span>` : ''}
                        <strong>${escapeHtml(g.code)}</strong>${g.detail ? ` <span class="usage-spec">[${escapeHtml(g.detail)}]</span>` : ''}
                        ${qtyInfo}
                    </div>
                    ${(g.units || []).length
                        ? `<select class="input-dark up-unit"><option value="" disabled>사용한 물품 선택</option>${unitOpts}</select>`
                        : `<div class="up-none">모든 물품이 사용되었습니다.</div>`}
                </div>`;
        }).join('');

        if (!usagePickGroups.length) {
            body.innerHTML = '<div class="usage-empty">지금 작업 내용에는 차감할 물품이 없습니다. 수정 반영하면 이전 반영이 되돌려집니다.</div>';
        }

        // 각 항목에 아직 고르지 않은 첫 물품(입고일 빠른 순)을 미리 선택 (바꿀 수 있음, 남은 물품이 없으면 비워 둠)
        const pickSelects = Array.from(body.querySelectorAll('.up-unit'));
        pickSelects.forEach(s => { s.value = ''; }); // 먼저 모두 비우고 위에서부터 차례로 채움
        const taken = new Set();
        pickSelects.forEach(s => {
            // [요청] 반영 수정: 이전에 고른 물품을 먼저 선택
            const free = Array.from(s.options).find(o => o.value && o.dataset.picked === '1' && !taken.has(o.value))
                || Array.from(s.options).find(o => o.value && !taken.has(o.value));
            s.value = free ? free.value : '';
            if (free) taken.add(free.value);
        });
        refreshUsagePickDisabled();
        modal.style.display = 'flex';
    } catch (e) {
        console.error(e);
        alert(`상세 물품을 불러오지 못했습니다: ${e.message || ''}`);
    }
}

/* ==========================================================================
   [요청] 재고 관리: 현재 사업장 구분의 미확보(수량 0)·부족(안전 재고 미만) 물품 수량 바로 변경
   ========================================================================== */
function setupStockManageModal() {
    const btnOpen = document.getElementById('btn-open-stock-manage-modal');
    const modal = document.getElementById('stock-manage-modal');
    const btnClose = document.getElementById('btn-close-stock-manage-modal');
    if (!btnOpen || !modal) return;

    const close = () => {
        modal.style.display = 'none';
        renderItemStockTable(); // 변경된 수량·상태를 메인 리스트에 반영
    };
    btnOpen.addEventListener('click', () => {
        const search = document.getElementById('stock-manage-search');
        if (search) search.value = ''; // 새로 열 때는 검색어 초기화
        openStockManageModal();
    });
    if (btnClose) btnClose.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    // [요청] 재고 관리 검색 (코드명·물품명·세부 규격·품번·사업장 구분)
    const search = document.getElementById('stock-manage-search');
    if (search) search.addEventListener('input', openStockManageModal);
}

function openStockManageModal() {
    if (denyStockEdit(currentStockSiteGroup, '재고 관리')) return;
    const modal = document.getElementById('stock-manage-modal');
    const tbody = document.getElementById('stock-manage-tbody');
    const emptyEl = document.getElementById('stock-manage-empty');
    const groupLabel = document.getElementById('stock-manage-group-label');
    const countLabel = document.getElementById('stock-manage-count');
    if (!modal || !tbody) return;

    const isAll = !currentStockSiteGroup || currentStockSiteGroup === '전체' || currentStockSiteGroup === 'ALL';
    if (groupLabel) groupLabel.textContent = isAll ? '전체' : currentStockSiteGroup;

    const searchEl = document.getElementById('stock-manage-search');
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';

    // 미확보 먼저, 그다음 부족 (각각 코드명 순)
    const rank = (it) => ((parseInt(it.quantity) || 0) === 0 ? 0 : 1);
    const targets = (adminItemStocks || [])
        .filter(it => isAll || (it.site_group || '').trim() === currentStockSiteGroup.trim())
        .filter(it => {
            if (!isStockSafetyGrade(it)) return false; // [요청] B등급 이하는 상태 관리 안 함
            const q = parseInt(it.quantity) || 0;
            const s = stockSafetyOf(it);
            return q === 0 || q < s;
        })
        .filter(it => {
            if (!keyword) return true;
            return [it.code, it.part, it.spec, it.partno, it.site_group, it.site_name]
                .some(v => String(v || '').toLowerCase().includes(keyword));
        })
        .sort((a, b) => rank(a) - rank(b) || (a.code || '').localeCompare(b.code || '', 'ko', { numeric: true }));

    if (countLabel) countLabel.textContent = `${targets.length}건`;
    tbody.innerHTML = '';
    if (emptyEl) {
        emptyEl.style.display = targets.length ? 'none' : 'block';
        emptyEl.textContent = keyword ? '검색 결과가 없습니다.' : '미확보·부족 물품이 없습니다.';
    }

    targets.forEach(it => {
        const tr = document.createElement('tr');
        const qty = parseInt(it.quantity) || 0;
        const safety = stockSafetyOf(it);
        tr.innerHTML = `
            <td class="sm-code">${escapeHtml(it.code || '-')}${isAll && it.site_group ? `<div class="sm-site">${escapeHtml(it.site_group)}</div>` : ''}</td>
            <td class="sm-spec">${escapeHtml(it.spec || '-')}</td>
            <td class="sm-qty">
                <button type="button" class="btn-stock-outline outline-green sm-unit-open" title="눌러서 물품 상세(입고 기록)에서 수량 변경">${qty}개</button>
            </td>
            <td class="sm-safety">${isStockSafetyGrade(it) ? safety : '-'}</td>
            <td class="sm-status stock-status-cell">${getItemStockStatusBadgeHtml(qty, safety)}</td>`;

        // [수정] 모든 물품: 수량은 물품 상세(입고 기록)에서 관리
        tr.querySelector('.sm-unit-open').addEventListener('click', () => openStockUnitModal(it.id));
        tbody.appendChild(tr);
    });

    modal.style.display = 'flex';
}

/* ==========================================================================
   [수정] 물품 상세 (입고 기록) - 모든 물품 공통
   - 기본: 한 줄 = 입고일·수량·사용일·사용 장비·정기/비정기
   - [S/N 상세] 켜면: 물품 1개당 1줄로 나누고 S/N 기록
   - 현재 수량 = 사용일이 비어 있는 줄의 수량 합계
   ========================================================================== */
let currentUnitStockId = null;
let currentUnits = [];
let currentUnitManaged = false;

function applyStockFromServer(stock) {
    if (!stock) return;
    const idx = adminItemStocks.findIndex(x => String(x.id) === String(stock.id));
    if (idx >= 0) adminItemStocks[idx] = stock;
    saveItemStocksLocally();
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') throw new Error(data.message || '요청 실패');
    return data;
}

// 서버 응답(물품·상세 목록)을 화면에 반영
function applyUnitResponse(data) {
    if (data.stock) {
        applyStockFromServer(data.stock);
        currentUnitManaged = !!data.stock.unit_managed;
    }
    if (Array.isArray(data.units)) currentUnits = data.units;
    renderStockUnits();
}

// [요청] 물품 상세 창 안의 [S/N 상세] 켜기/끄기
async function toggleUnitSerialMode() {
    if (!currentUnitStockId) return;
    const turnOn = !currentUnitManaged;
    const msg = turnOn
        ? 'S/N 모드로 바꿀까요?\n\n수량이 2개 이상인 줄은 1개씩 나뉘고, 물품마다 S/N을 적을 수 있습니다.\n사용 이력을 반영할 때는 사용한 물품(S/N)을 직접 고릅니다.'
        : '수량 모드로 바꿀까요?\n\n적어 둔 S/N은 남아 있고, S/N이 없고 입고일·사용 정보가 같은 줄은 수량으로 합쳐집니다.\n사용 이력을 반영하면 오래된 입고분부터 자동으로 빠집니다.';
    if (!confirm(msg)) return;
    try {
        const data = await postJson('/api/item/units/managed', { stock_id: currentUnitStockId, managed: turnOn });
        applyUnitResponse(data);
    } catch (e) {
        alert(`변경 실패: ${e.message || ''}`);
    }
}

function kstToday() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST 오늘
}

// [요청] 입고 추가 입력 줄 (리스트는 보기 전용)
function resetStockUnitAddForm() {
    const d = document.getElementById('stock-unit-add-date');
    const q = document.getElementById('stock-unit-add-qty');
    const sn = document.getElementById('stock-unit-add-serial');
    if (d) d.value = kstToday();
    if (q) { q.value = '1'; q.style.display = currentUnitManaged ? 'none' : ''; }
    if (sn) { sn.value = ''; sn.style.display = currentUnitManaged ? '' : 'none'; }
    const lbl = document.getElementById('stock-unit-add-label');
    if (lbl) lbl.textContent = currentUnitManaged ? 'S/N' : '수량';
}

async function addStockUnitFromForm() {
    if (!currentUnitStockId) return;
    const inDate = (document.getElementById('stock-unit-add-date') || {}).value || '';
    const payload = { in_date: inDate };
    if (currentUnitManaged) {
        payload.serial = ((document.getElementById('stock-unit-add-serial') || {}).value || '').trim();
        if (!payload.serial && !confirm('S/N 없이 입고할까요?')) return;
    } else {
        const qty = parseInt((document.getElementById('stock-unit-add-qty') || {}).value);
        if (!qty || qty < 1) return alert('수량은 1개 이상이어야 합니다.');
        payload.qty = qty;
    }
    if (!inDate && !confirm('입고일 없이 추가할까요?')) return;
    try {
        const data = await postJson('/api/item/units/save', {
            stock_id: currentUnitStockId, action: 'CREATE', payload
        });
        applyUnitResponse(data);
        resetStockUnitAddForm();
        // S/N 모드: 이어서 다음 S/N을 바로 입력
        const sn = document.getElementById('stock-unit-add-serial');
        if (currentUnitManaged && sn) sn.focus();
    } catch (e) {
        alert(`추가 실패: ${e.message || ''}`);
    }
}

function setupStockUnitModal() {
    const modal = document.getElementById('stock-unit-modal');
    if (!modal) return;
    const close = () => {
        modal.style.display = 'none';
        currentUnitStockId = null;
        renderItemStockTable();
        const sm = document.getElementById('stock-manage-modal');
        if (sm && sm.style.display !== 'none') openStockManageModal(); // 재고 관리 창에서 열었으면 갱신
    };
    const btnClose = document.getElementById('btn-close-stock-unit-modal');
    if (btnClose) btnClose.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    const btnMode = document.getElementById('btn-toggle-stock-unit-serial');
    if (btnMode) btnMode.addEventListener('click', toggleUnitSerialMode);

    const btnAdd = document.getElementById('btn-add-stock-unit');
    if (btnAdd) btnAdd.addEventListener('click', addStockUnitFromForm);
    ['stock-unit-add-qty', 'stock-unit-add-serial'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStockUnitFromForm(); } });
    });
}

async function openStockUnitModal(stockId) {
    const modal = document.getElementById('stock-unit-modal');
    if (!modal) return;
    try {
        const res = await fetch(`/api/item/units?stock_id=${encodeURIComponent(stockId)}`);
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || '불러오기 실패');

        currentUnitStockId = data.stock.id;
        const s = data.stock;
        document.getElementById('stock-unit-title').textContent = s.code || s.part || '';
        document.getElementById('stock-unit-meta').textContent =
            [s.site_group, s.site_name, s.spec].filter(Boolean).join(' · ');

        applyUnitResponse(data);
        resetStockUnitAddForm();
        modal.style.display = 'flex';
    } catch (e) {
        alert(`물품 상세를 불러오지 못했습니다: ${e.message || ''}`);
    }
}

function renderStockUnits() {
    const tbody = document.getElementById('stock-unit-tbody');
    const thead = document.getElementById('stock-unit-thead');
    const emptyEl = document.getElementById('stock-unit-empty');
    if (!tbody) return;
    const serialMode = currentUnitManaged;

    const btnMode = document.getElementById('btn-toggle-stock-unit-serial');
    if (btnMode) {
        btnMode.classList.toggle('on', serialMode);
        btnMode.textContent = serialMode ? 'S/N 모드' : '수량 모드';
        btnMode.title = serialMode ? '누르면 수량 모드로 전환 (입고 기록을 수량 단위로 관리)' : '누르면 S/N 모드로 전환 (물품 1개씩 S/N 기록)';
        // [요청] 입고 기록이 생기면 모드 버튼 숨김 (실수로 눌러 기록이 바뀌는 것 방지)
        btnMode.style.display = currentUnits.length ? 'none' : '';
    }

    const qtyOf = (u) => parseInt(u.qty) || 1;
    const used = currentUnits.filter(u => u.used_date).reduce((n, u) => n + qtyOf(u), 0);
    const total = currentUnits.reduce((n, u) => n + qtyOf(u), 0);
    document.getElementById('stock-unit-instock').textContent = total - used;
    document.getElementById('stock-unit-used').textContent = used;
    if (emptyEl) emptyEl.style.display = currentUnits.length ? 'none' : 'block';

    if (thead) thead.innerHTML = `<tr>
        <th>No.</th><th>입고일</th><th>${serialMode ? 'S/N' : '수량'}</th>
        <th>사용일</th><th>사용 장비</th><th>정기/비정기</th><th></th></tr>`;

    // [요청] 리스트는 보기 전용 (등록된 항목은 수정 불가)
    const txt = (v) => v ? escapeHtml(v) : '<span class="su-empty">-</span>';
    tbody.innerHTML = '';
    currentUnits.forEach((u, i) => {
        const tr = document.createElement('tr');
        tr.dataset.unitId = u.id;
        if (u.used_date) tr.classList.add('unit-used');
        const midCell = serialMode ? txt(u.serial) : `${qtyOf(u)}`;
        const kind = u.work_kind
            ? `<span class="su-kind ${u.work_kind === '정기' ? 'kind-regular' : 'kind-irregular'}">${escapeHtml(u.work_kind)}</span>`
            : txt('');
        tr.innerHTML = `
            <td class="su-no">${i + 1}</td>
            <td>${txt(u.in_date)}</td>
            <td class="su-mid">${midCell}</td>
            <td>${txt(u.used_date)}</td>
            <td class="su-equip-text" title="${escapeHtml(u.used_equip) || ''}">${txt(u.used_equip)}</td>
            <td>${kind}</td>
            <td>${u.used_date ? '' : '<button type="button" class="btn-del-stock su-del" title="잘못 입력한 입고 삭제">✕</button>'}</td>`;

        const del = tr.querySelector('.su-del');
        if (del) del.addEventListener('click', () => deleteStockUnit(u));
        tbody.appendChild(tr);
    });
}

async function deleteStockUnit(unit) {
    const label = [unit.serial ? `S/N ${unit.serial}` : '', unit.in_date ? `입고 ${unit.in_date}` : '',
        !currentUnitManaged ? `수량 ${parseInt(unit.qty) || 1}개` : ''].filter(Boolean).join(', ');
    if (!confirm(`이 입고 기록을 삭제할까요?${label ? `\n(${label})` : ''}`)) return;
    try {
        const data = await postJson('/api/item/units/save', {
            stock_id: currentUnitStockId, action: 'DELETE', payload: { id: unit.id }
        });
        applyUnitResponse(data);
    } catch (e) {
        alert(`삭제 실패: ${e.message || ''}`);
    }
}

// [추가] 선택한 사업장 구분의 물품 전체 삭제 (검색어와 관계없이 해당 구분 전체, '전체' 탭은 최종관리자만)
async function deleteAllItemStocks() {
    const isAll = !currentStockSiteGroup || currentStockSiteGroup === '전체' || currentStockSiteGroup === 'ALL';
    if (!isStockSuperAdmin()) return alert('전체 삭제는 최종관리자만 할 수 있습니다.');

    const label = isAll ? '모든 사업장 구분' : currentStockSiteGroup;
    const targets = isAll ? adminItemStocks : adminItemStocks.filter(s => (s.site_group || '') === currentStockSiteGroup);
    if (!targets.length) return alert('삭제할 물품이 없습니다.');

    if (!confirm(`[${label}]의 물품 ${targets.length}건을 모두 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    const typed = prompt(`정말 삭제하려면 "삭제"를 입력하세요.`);
    if ((typed || '').trim() !== '삭제') return alert('입력이 일치하지 않아 취소했습니다.');

    try {
        const res = await fetch('/api/admin/crud', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
            body: JSON.stringify({ domain: 'item_stock', action: 'DELETE_ALL', payload: { site_group: isAll ? '전체' : currentStockSiteGroup } })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || '삭제 실패');

        adminItemStocks = isAll ? [] : adminItemStocks.filter(s => (s.site_group || '') !== currentStockSiteGroup);
        saveItemStocksLocally();
        renderItemStockTable();
        alert(`${data.deleted ?? targets.length}건을 삭제했습니다.`);
    } catch (e) {
        console.error(e);
        alert(`전체 삭제 실패: ${e.message || ''}`);
        syncItemStocksFromServer(true);
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
    // [요청] 모바일: 사업장 열은 '전체' 구분일 때만 표시 (admin.css에서 클래스로 처리)
    const stockSection = document.getElementById('section-item-stock-mgmt');
    if (stockSection) stockSection.classList.toggle('item-stock-all-group', isAllTab);
    // [요청] 본인 사업장 구분이 아니면 검색(조회)만 가능: 등록/불러오기/사용 이력/CSV 버튼 숨김
    //  - 최종관리자: 모든 탭에서 사용 가능
    //  - 관리자: 본인 사업장 구분 탭에서만 ('전체' 탭은 다른 사업장이 섞여 있어 숨김)
    //  - CSV 내보내기: 최종관리자 또는 본인 사업장 구분 탭 (일반 계정 포함)
    const canEditHere = canEditStockGroup(currentStockSiteGroup);
    const mySiteGroup = getUserStockSiteGroup();
    const canExportHere = isStockSuperAdmin() || (!!mySiteGroup && !isAllTab && currentStockSiteGroup === mySiteGroup);
    const toggleBtn = (id, show) => {
        const b = document.getElementById(id);
        if (!b) return;
        if (b.dataset.origDisplay === undefined) b.dataset.origDisplay = b.style.display || '';
        b.style.display = show ? b.dataset.origDisplay : 'none';
    };
    ['btn-open-usage-modal', 'btn-open-stock-manage-modal', 'btn-open-add-stock-modal', 'btn-import-master-items'].forEach(id => toggleBtn(id, canEditHere));
    toggleBtn('btn-delete-all-stock', isStockSuperAdmin()); // [요청] 전체 삭제는 최종관리자만
    toggleBtn('btn-export-stock-csv', canExportHere);
    // 버튼 표시가 바뀌면 리스트 위치가 달라질 수 있어 모바일 높이 재계산
    requestAnimationFrame(fitStockTableToViewport);

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
        const siteName = (item.site_name || '').toLowerCase();
        const siteGroup = (item.site_group || '').toLowerCase();
        const memo = (item.memo || '').toLowerCase();
        return code.includes(query) || part.includes(query) || spec.includes(query) ||
            partno.includes(query) || siteName.includes(query) ||
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
                case 'mode':
                    diff = (a.unit_managed ? 0 : 1) - (b.unit_managed ? 0 : 1);
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
                    diff = stockSafetyOf(a) - stockSafetyOf(b);
                    break;
                case 'status': {
                    const getStatusRank = (it) => {
                        if (!isStockSafetyGrade(it)) return 4; // [요청] B등급 이하(상태 없음)는 맨 뒤
                        const q = parseInt(it.quantity) || 0;
                        const s = stockSafetyOf(it);
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
        const safetyQty = stockSafetyOf(item);

        const grade = (item.grade || 'A').toUpperCase();
        const gradeBadge = getItemGradeBadgeHtml(grade);
        const statusBadge = stockStatusHtmlOf(item);
        const displaySite = item.site_group || item.site_name || '-';
        // [요청] 구분: S/N 모드 / 수량 모드 (PC는 품번·코드명 사이 열, 모바일은 코드명 앞 열)
        const modeBadge = item.unit_managed
            ? '<span class="unit-managed-badge">S/N</span>'
            : '<span class="unit-managed-badge unit-qty-badge">수량</span>';

        tr.innerHTML = `
            <td class="col-no">${index + 1}</td>
            <td class="col-site">${displaySite}</td>
            <td class="col-partno">${item.partno || '-'}</td>
            <td class="col-mode">${modeBadge}</td>
            <td class="col-code">${item.code || '-'}</td>
            <td class="col-part">${item.part || '-'}</td>
            <td class="col-spec">${item.spec || '-'}</td>
            <td class="col-qty">
                <!-- [수정] 현재 수량은 물품 상세(입고 기록)로만 바뀜: 직접 수정 불가 -->
                <span class="stock-qty-text">${qty}</span>
            </td>
            <td class="col-safety">
                ${isStockSafetyGrade(item) ? `<div class="stock-qty-control stock-safety-control">
                    <button type="button" class="stock-qty-btn btn-safety-minus" title="안전 재고 수량 1 감소" data-id="${item.id}">-</button>
                    <input type="number" class="stock-qty-input stock-safety-input" min="0" value="${safetyQty}" data-id="${item.id}">
                    <button type="button" class="stock-qty-btn btn-safety-plus" title="안전 재고 수량 1 증가" data-id="${item.id}">+</button>
                </div>` : '<span class="stock-safety-none" title="B등급 이하는 안전 재고를 관리하지 않습니다.">-</span>'}
            </td>
            <td class="col-status stock-status-cell">${statusBadge}</td>
            <td class="col-grade stock-grade-cell">${gradeBadge}</td>
            <td class="col-action">
                <button type="button" class="btn-del-stock" title="목록에서 삭제" data-id="${item.id}">✕</button>
            </td>
        `;

        const rowEditable = canEditStockGroup(item.site_group);
        if (!rowEditable) {
            const inputSafetyTemp = tr.querySelector('.stock-safety-input');
            if (inputSafetyTemp) inputSafetyTemp.readOnly = true;
            tr.querySelectorAll('.stock-qty-btn, .btn-del-stock').forEach(b => { b.style.display = 'none'; });
            const gradeBadgeEl = tr.querySelector('.stock-grade-cell .stock-badge');
            if (gradeBadgeEl) {
                gradeBadgeEl.classList.remove('clickable-grade');
                gradeBadgeEl.title = '';
            }
        } else {
            // [수정] 모든 물품: 행 클릭 → 물품 상세(입고 기록) 창 (입력칸·버튼·등급 클릭은 제외)
            tr.classList.add('stock-row-unit-managed');
            tr.title = '클릭하여 물품 상세(입고·사용 기록) 보기';
            tr.addEventListener('click', (e) => {
                if (e.target.closest('button, input:not([readonly]), select, .stock-grade-cell')) return;
                openStockUnitModal(item.id);
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
// [요청] B등급 이하는 안전 재고·상태를 쓰지 않음 (표시 안 함, 미확보·부족 건수와 재고 관리에서도 제외)
function isStockSafetyGrade(item) {
    return ((item && item.grade) || 'A').toUpperCase() === 'A';
}
function stockSafetyOf(item) {
    return isStockSafetyGrade(item) ? (parseInt(item.safety_quantity) || 0) : 0;
}

// [요청] B등급 이하는 상태도 표시하지 않음
function stockStatusHtmlOf(item) {
    if (!isStockSafetyGrade(item)) return '<span class="stock-safety-none">-</span>';
    return getItemStockStatusBadgeHtml(item.quantity, stockSafetyOf(item));
}

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

    // [요청] 미확보(수량 0)도 부족 건수에 합쳐서 표시
    let shortageCount = 0;

    groupItems.forEach(item => {
        if (!isStockSafetyGrade(item)) return; // [요청] B등급 이하는 부족 건수에서 제외
        const q = parseInt(item.quantity) || 0;
        const s = stockSafetyOf(item);
        if (q === 0 || q < s) shortageCount++;
    });

    const shortageEl = document.getElementById('stock-summary-shortage-count');
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
            statusCell.innerHTML = stockStatusHtmlOf(item);
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
            statusCell.innerHTML = stockStatusHtmlOf(item);
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

    // [요청] 등급에 따라 안전 재고 표시·상태가 바뀌므로 목록을 다시 그림
    renderItemStockTable();
    trEl = document.querySelector(`#item-stock-tbody tr[data-stock-id="${stockId}"]`) || trEl;

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
    // [요청] 등급을 바꾸면 안전 재고 입력 활성/비활성 갱신 (한 번만 연결)
    if (!gradeSelect.dataset.safetyBound) {
        gradeSelect.dataset.safetyBound = '1';
        gradeSelect.addEventListener('change', syncModalSafetyByGrade);
    }

    const allGrades = ['B', 'C', 'A']; // 기본 B, C, A 순서

    if (!item) {
        gradeSelect.disabled = false;
        gradeSelect.innerHTML = `
            <option value="B" selected>B 등급</option>
            <option value="C">C 등급</option>
            <option value="A">A 등급</option>
        `;
        syncModalSafetyByGrade();
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
    syncModalSafetyByGrade();
}

// [요청] 물품 등록: B등급 이하면 안전 재고 수량 입력 비활성화 (0으로 저장)
function syncModalSafetyByGrade() {
    const gradeSelect = document.getElementById('modal-stock-grade');
    const safetyInput = document.getElementById('modal-stock-safety-quantity');
    if (!gradeSelect || !safetyInput) return;
    const isA = (gradeSelect.value || '').toUpperCase() === 'A';
    safetyInput.disabled = !isA;
    if (!isA) safetyInput.value = 0;
    safetyInput.title = isA ? '' : 'B등급 이하는 안전 재고를 관리하지 않습니다.';
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
            <div class="mcol-partno" style="width: 85px; flex-shrink: 0; text-align: center; color: #8b949e; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;" title="${partnoVal}">${partnoVal}</div>
            <div class="mcol-code" style="width: 200px; flex-shrink: 0; color: #58a6ff; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;" title="${codeVal}">${codeVal}</div>
            <div class="mcol-part" style="width: 200px; flex-shrink: 0; color: #e6edf3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;" title="${partVal}">${partVal}</div>
            <div class="mcol-spec" style="flex: 1; min-width: 160px; color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;" title="${specVal}">${specVal}</div>
            <div class="mcol-status" style="width: 95px; flex-shrink: 0; text-align: center;">${badgeHtml}</div>
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
    const safetyQuantity = grade.toUpperCase() === 'A'
        ? Math.max(0, parseInt(safetyQtyInput ? safetyQtyInput.value : 0) || 0)
        : 0; // [요청] B등급 이하는 안전 재고 0
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

// 물품 관리 현황 내보내기 (사업장 및 안전 재고 수량 포함)
// [요청] 엑셀(.xlsx) 2개 시트: 1) 물품 관리 현황 2) 물품 상세(입고 기록) 목록
async function exportStockCsv() {
    // [요청] 본인 사업장 구분(최종관리자는 전체)만 내보내기 가능
    const mySiteGroup = getUserStockSiteGroup();
    if (!isStockSuperAdmin() && !(mySiteGroup && currentStockSiteGroup === mySiteGroup)) {
        return alert('본인 사업장의 물품만 내보낼 수 있습니다.');
    }
    let groupItems = adminItemStocks;
    if (currentStockSiteGroup && currentStockSiteGroup !== '전체' && currentStockSiteGroup !== 'ALL') {
        groupItems = adminItemStocks.filter(it => (it.site_group || '').trim() === currentStockSiteGroup.trim());
    }

    if (groupItems.length === 0) {
        return alert(`내보낼 물품 데이터가 없습니다.`);
    }

    const headers = ['No', '사업장구분', '품번', '구분', '코드명', '물품명', '세부규격', '현재수량', '안전재고수량', '상태', '등급'];
    const rows = groupItems.map((item, idx) => {
        const qty = parseInt(item.quantity) || 0;
        const safetyQty = stockSafetyOf(item);
        const grade = (item.grade || 'A').toUpperCase();
        const statusStr = !isStockSafetyGrade(item) ? '-' : (qty === 0 ? '미확보' : (qty >= safetyQty ? '정상' : '부족'));
        return [
            idx + 1, item.site_group || '', item.partno || '',
            item.unit_managed ? 'S/N' : '수량',
            item.code || '', item.part || '', item.spec || '',
            qty, isStockSafetyGrade(item) ? safetyQty : '-', statusStr, grade
        ];
    });

    const fileSuffix = (currentStockSiteGroup && currentStockSiteGroup !== '전체' && currentStockSiteGroup !== 'ALL') ? currentStockSiteGroup : '전체';
    const fileBase = `물품관리현황_${fileSuffix}_${new Date().toISOString().slice(0, 10)}`;

    // 엑셀 라이브러리가 없으면 기존처럼 1번 시트만 CSV로
    if (typeof XLSX === 'undefined') {
        const esc = (v) => (typeof v === 'number' ? v : `"${String(v).replace(/"/g, '""')}"`);
        const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileBase}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return alert('엑셀 라이브러리를 불러오지 못해 물품 목록만 CSV로 내보냈습니다.');
    }

    // [요청] 2번 시트: 해당 사업장 구분의 물품 상세(입고 기록) 목록
    let units = [];
    try {
        const res = await fetch(`/api/item/units/export?site_group=${encodeURIComponent(fileSuffix)}`);
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || '불러오기 실패');
        units = data.units || [];
    } catch (e) {
        return alert(`물품 상세 목록을 불러오지 못했습니다: ${e.message || ''}`);
    }
    const unitHeaders = ['No', '사업장구분', '사업장명', '품번', '구분', '코드명', '물품명', '세부규격',
        '입고일', '수량', 'S/N', '상태', '사용일', '사용장비', '정기/비정기'];
    const unitRows = units.map((u, idx) => [
        idx + 1, u.site_group, u.site_name, u.partno, u.unit_managed ? 'S/N' : '수량',
        u.code, u.part, u.spec, u.in_date || '', parseInt(u.qty) || 1, u.serial || '',
        u.used_date ? '사용' : '재고', u.used_date || '', u.used_equip || '', u.work_kind || ''
    ]);

    const makeSheet = (hdr, data) => {
        const ws = XLSX.utils.aoa_to_sheet([hdr, ...data]);
        ws['!cols'] = hdr.map((h, c) => ({
            wch: Math.min(40, Math.max(String(h).length * 2 + 2, ...data.map(r => String(r[c] ?? '').length + 2)))
        }));
        hdr.forEach((_, c) => {
            const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
            if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'DDEBF7' } }, alignment: { horizontal: 'center' } };
        });
        return ws;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), '물품 관리 현황');
    XLSX.utils.book_append_sheet(wb, makeSheet(unitHeaders, unitRows), '물품 상세');
    XLSX.writeFile(wb, `${fileBase}.xlsx`);
}
