/* ==========================================================================
   1. 초기화 및 전역 변수 (Initialization & Globals)
   ========================================================================== */
let selectedSetupLogId = null;
let originalSetupLogMemo = "";

/* ==========================================================================
   2. 유틸리티 및 헬퍼 함수 (Utilities & Helpers)
   ========================================================================== */
function formatDateYYMMDD(dateString) {
    if (!dateString) return '-';
    try {
        const parts = dateString.split('-');
        if (parts.length === 3) {
            const year = parts[0].slice(-2);
            return `${year}.${parts[1]}.${parts[2]}`;
        }
        return dateString;
    } catch (e) {
        return dateString;
    }
}

// [공통 함수 폴백]
if (typeof window.isHoliday !== 'function') {
    window.isHoliday = function (date) { return false; };
}
if (typeof window.getHolidayName !== 'function') {
    window.getHolidayName = function (year, month, day) { return null; };
}
if (typeof window.addBusinessDays !== 'function') {
    window.addBusinessDays = function (date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };
}
if (typeof window.getDragAfterElement !== 'function') {
    window.getDragAfterElement = function (container, y, selector) {
        const draggableElements = [...container.querySelectorAll(selector)];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            return (offset < 0 && offset > closest.offset) ? { offset: offset, element: child } : closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    };
}

// common.js의 checkUnsavedChanges 함수 오버라이드
const _originalCheckUnsavedChanges = window.checkUnsavedChanges;
window.checkUnsavedChanges = function () {
    if (typeof _originalCheckUnsavedChanges === 'function') {
        return _originalCheckUnsavedChanges();
    }
    return true;
};

// 로컬 날짜 포맷팅 함수 (YYYY-MM-DD)
function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 휴일 체크 및 알림 함수
function checkAndAlertHoliday(input) {
    const dateStr = input.value;
    if (!dateStr) return;

    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);

    if (window.isHoliday(date)) {
        let name = window.getHolidayName(y, m - 1, d);
        const day = date.getDay();

        if (!name) {
            if (day === 0) name = "일요일";
            else if (day === 6) name = "토요일";
            else name = "휴일";
        }

        // 연속된 휴일 기간 계산
        let start = new Date(date);
        let end = new Date(date);

        // 시작일 찾기
        while (true) {
            const prev = new Date(start);
            prev.setDate(prev.getDate() - 1);
            if (window.isHoliday(prev)) {
                start = prev;
            } else {
                break;
            }
        }

        // 종료일 찾기
        while (true) {
            const next = new Date(end);
            next.setDate(next.getDate() + 1);
            if (window.isHoliday(next)) {
                end = next;
            } else {
                break;
            }
        }

        const startStr = formatLocalDate(start);
        const endStr = formatLocalDate(end);

        alert(`선택하신 날짜는 '${name}'입니다.\n휴일 기간: ${startStr} ~ ${endStr}`);
    }
}

// [추가] 모바일 전용 날짜 수정 피커 (네이티브 달력 호출)
function openMobileDatePicker(id, field, currentDate) {
    let input = document.getElementById('mobile-date-picker-input');
    if (!input) {
        input = document.createElement('input');
        input.type = 'date';
        input.id = 'mobile-date-picker-input';
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.top = '0';
        document.body.appendChild(input);
    }

    input.value = currentDate || '';

    // 날짜 선택 시 데이터 업데이트 및 저장
    input.onchange = function () {
        const newValue = input.value;

        // [수정] DOM 업데이트 및 자동 계산 로직 적용 (데이터 직접 수정 대신 계산 함수 활용)
        const row = document.querySelector(`#setup-detail-body tr[data-id="${id}"]`);
        if (!row) return;

        if (field === 'startDate') {
            const startInput = row.querySelector('.detail-start-date-input');
            if (startInput) {
                startInput.value = newValue;
                // [추가] 모바일 뷰 텍스트 즉시 갱신
                const textDiv = startInput.previousElementSibling;
                if (textDiv && textDiv.classList.contains('date-display-text')) {
                    textDiv.textContent = formatDateYYMMDD(newValue);
                }
            }

            // [수정] 셋업 완료 항목인 경우 PC와 동일하게 전체 일정 재계산(역산) 수행
            if (row.dataset.category === '셋업 완료') {
                if (typeof calculateSetupSchedule === 'function') calculateSetupSchedule(newValue);
            } else {
                // 순방향 계산(저장 생략) 후 역방향 계산(저장 수행)
                if (typeof calculateScheduleForward === 'function') calculateScheduleForward(row, true);
                if (typeof calculateScheduleBackward === 'function') calculateScheduleBackward(row);
            }
        } else if (field === 'date') {
            const dateInput = row.querySelector('.detail-date-input');
            if (dateInput) {
                dateInput.value = newValue;
                // [추가] 모바일 뷰 텍스트 즉시 갱신
                const textDiv = dateInput.previousElementSibling;
                if (textDiv && textDiv.classList.contains('date-display-text')) {
                    textDiv.textContent = formatDateYYMMDD(newValue);
                }
            }

            const checkbox = row.querySelector('.detail-complete-checkbox');
            if (newValue && checkbox && !checkbox.checked) checkbox.checked = true;

            saveSetupDetails('UPDATE_SETUP_DATE', '완료일 수정');
        }
    };

    try { if ('showPicker' in HTMLInputElement.prototype) input.showPicker(); else input.click(); } catch (e) { input.click(); }
}
window.openMobileDatePicker = openMobileDatePicker;

/* ==========================================================================
   3. 초기화 및 이벤트 리스너 (Initialization & Events)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const initSetup = () => {
        // 1. 모달 열기 버튼 이벤트 연결
        const loadBtn = document.getElementById('btn-load-setup-list');
        if (loadBtn) {
            loadBtn.addEventListener('click', openSetupLoadListModal);
        }

        const loadInfoBtn = document.getElementById('btn-load-setup-info');
        if (loadInfoBtn) {
            loadInfoBtn.addEventListener('click', openSetupLoadInfoModal);
        }

        // 2. 기존 셋업 일지 작업 추가 입력창(폼) 제거
        const oldLogInputRow = document.querySelector('#setup-log-card .log-input-row');
        if (oldLogInputRow) oldLogInputRow.style.display = 'none';

        // 3. 셋업 일지 메모 변경 감지 및 페이지 이탈 방지
        const memoArea = document.getElementById('setup-log-detail-memo');
        const logSaveBtn = document.getElementById('btn-save-setup-log-memo');

        if (memoArea && logSaveBtn) {
            memoArea.addEventListener('input', () => {
                if (memoArea.value !== originalSetupLogMemo) {
                    logSaveBtn.classList.remove('btn-green-sm');
                    logSaveBtn.classList.add('btn-orange-sm');
                } else {
                    logSaveBtn.classList.remove('btn-orange-sm');
                    logSaveBtn.classList.add('btn-green-sm');
                }
            });

            memoArea.addEventListener('click', () => {
                if (selectedSetupLogId === null) {
                    alert('리스트를 먼저 선택해주세요.');
                    memoArea.blur(); // 포커스 해제하여 입력 방지
                }
            });
        }

        window.addEventListener('beforeunload', (e) => {
            // 셋업 일지 메모 변경 확인
            const memoArea = document.getElementById('setup-log-detail-memo');
            if (selectedSetupLogId !== null && memoArea && memoArea.value !== originalSetupLogMemo) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        // 4. 셋업 일지 날짜 필터 이벤트
        const filterDateInput = document.getElementById('setup-log-filter-date');
        if (filterDateInput) {
            filterDateInput.addEventListener('input', renderSetupLogList);
            
            // [수정] 셋업 일지 영역 헤더 레이아웃 버그 수정 및 그룹핑
            const headerEl = filterDateInput.parentElement;
            let targetWrapper = headerEl;

            // 이전 수정으로 인해 헤더 자체에 잘못 적용된 인라인 스타일(marginLeft: auto 등) 초기화
            if (headerEl && headerEl.classList.contains('setup-card-header')) {
                headerEl.style.marginLeft = '';
                
                // 헤더 자식 요소들을 좌/우 그룹으로 분리하여 감싸기
                if (!document.getElementById('setup-log-right-wrapper')) {
                    const leftWrapper = document.createElement('div');
                    leftWrapper.style.display = 'flex';
                    leftWrapper.style.alignItems = 'center';
                    leftWrapper.style.gap = '10px';
                    
                    const rightWrapper = document.createElement('div');
                    rightWrapper.id = 'setup-log-right-wrapper';
                    rightWrapper.style.display = 'flex';
                    rightWrapper.style.alignItems = 'center';
                    rightWrapper.style.gap = '5px';
                    rightWrapper.style.marginLeft = 'auto'; // 오른쪽으로 밀착
                    
                    // 기존 자식 노드 재배치
                    Array.from(headerEl.children).forEach(child => {
                        if (child.tagName === 'H3' || child.classList.contains('btn-settings')) {
                            leftWrapper.appendChild(child);
                        } else if (child === filterDateInput || child.id === 'btn-open-setup-log-modal') {
                            rightWrapper.appendChild(child);
                        }
                    });
                    
                    headerEl.appendChild(leftWrapper);
                    headerEl.appendChild(rightWrapper);
                    
                    // 카드 접기 버튼(collapse)이 있다면 맨 끝에 둬서 레이아웃 유지
                    const collapseBtn = headerEl.querySelector('.btn-collapse');
                    if (collapseBtn) headerEl.appendChild(collapseBtn);
                    
                    targetWrapper = rightWrapper;
                } else {
                    targetWrapper = document.getElementById('setup-log-right-wrapper');
                }
            } else if (headerEl) {
                 // 이미 별도의 컨테이너로 분리되어 있는 경우
                 headerEl.style.display = 'flex';
                 headerEl.style.alignItems = 'center';
                 headerEl.style.gap = '5px';
                 headerEl.style.marginLeft = 'auto';
            }

            if (targetWrapper && !document.getElementById('btn-open-setup-log-modal')) {
                const btn = document.createElement('button');
                btn.id = 'btn-open-setup-log-modal';
                btn.className = 'btn-blue-sm';
                btn.textContent = '셋업 기록';
                btn.style.flexShrink = '0'; // 버튼 크기 유지
                btn.onclick = () => {
                    if (!currentPath.site || !currentPath.equip) return alert('장비를 선택해주세요.');
                    if (typeof window.openSetupLogRegisterModal === 'function') {
                        window.openSetupLogRegisterModal(currentPath.site, currentPath.equip, '', '', false, true);
                    }
                };
                targetWrapper.appendChild(btn);
            }
        }

        // 6. 셋업 진행 세부사항 리스트 드래그 앤 드롭
        const detailBody = document.getElementById('setup-detail-body');
        if (detailBody) {
            detailBody.addEventListener('dragover', (e) => {
                e.preventDefault();
                const afterElement = getDragAfterElement(detailBody, e.clientY, 'tr:not(.dragging)');
                const draggable = document.querySelector('.dragging');
                if (draggable) {
                    if (afterElement == null) detailBody.appendChild(draggable);
                    else detailBody.insertBefore(draggable, afterElement);
                }
            });
        }

        // 7. 기타 초기화
        setupSetupLogResizer();
        if (typeof window.setupSetupExecStartModal === 'function') window.setupSetupExecStartModal();
        setupSetupLoadListModal();
        setupSetupLoadInfoModal();
        setupSetupResetButton();

        // 8. 화면 크기 변경 감지 (모바일/데스크탑 뷰 전환 시 리스트 재렌더링)
        let lastWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            const currentWidth = window.innerWidth;
            if ((lastWidth <= 950 && currentWidth > 950) || (lastWidth > 950 && currentWidth <= 950)) {
                renderSetupDetailList();
            }
            lastWidth = currentWidth;
        });
    };

    if (window.isDataLoaded) {
        initSetup();
    } else {
        window.addEventListener('DataLoaded', initSetup);
    }
});

function setupSetupLogResizer() {
    // [추가] 모바일 화면(너비 768px 이하)에서는 리사이저 기능 비활성화
    if (window.innerWidth <= 950) {
        const resizer = document.getElementById('setup-log-resizer');
        if (resizer) resizer.style.display = 'none'; // 리사이저 핸들 숨기기
        return;
    }

    const resizer = document.getElementById('setup-log-resizer');
    if (!resizer) return;
    const listWrapper = document.getElementById('setup-log-list-wrapper');
    const container = resizer.parentElement;
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const containerRect = container.getBoundingClientRect();
        const newHeight = e.clientY - containerRect.top - 40;
        if (newHeight > 100 && newHeight < containerRect.height - 100) {
            listWrapper.style.height = `${newHeight}px`;
            listWrapper.style.flex = 'none';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
        }
    });
}

/* ==========================================================================
   4. 메인 화면 렌더링 (Main Rendering)
   ========================================================================== */
function renderDetails() {
    const workspace = document.getElementById('setup-workspace');
    if (!workspace) return;

    // 셋업 진행 세부사항 리스트 로드
    renderSetupDetailList();

    // 셋업 일지 리스트 로드
    renderSetupLogList();

    const lastSetupLog = localStorage.getItem(`lastSetupLog_${currentPath.site}_${currentPath.equip}`);
    if (lastSetupLog) {
        setTimeout(() => selectSetupLog(Number(lastSetupLog)), 50);
    }
}

/* ==========================================================================
   5. 셋업 진행 세부사항 관리 (Setup Detail List Management)
   ========================================================================== */
function renderSetupDetailList() {
    const tbody = document.getElementById('setup-detail-body');
    if (!tbody || !currentPath.site || !currentPath.equip) return;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};

    // 초기 데이터 설정 (기본 항목)
    if (!data.setupDetails) {
        const detailKey = `details_${currentPath.site}_${currentPath.equip}`;
        const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
        const modelName = (detailData.setup && detailData.setup.model) ? detailData.setup.model : '';

        const templates = JSON.parse(localStorage.getItem('setup_templates')) || {};
        let templateToUse = templates[modelName];

        if (!templateToUse || templateToUse.length === 0) {
            templateToUse = templates['default'] || [
                { category: "장비 반입 및 정위치", content: "장비 도면 부착", estDays: "1" },
                { category: "장비 반입 및 정위치", content: "다이크 설치", estDays: "1" },
                { category: "장비 반입 및 정위치", content: "장비 반입", estDays: "1" },
                { category: "장비 반입 및 정위치", content: "다이크 공사 및 리크센서 설치", estDays: "2" },
                { category: "통신 상태 및 유틸리티", content: "Utility 배관 공사 및 연결", estDays: "5" },
                { category: "통신 상태 및 유틸리티", content: "Utility 턴온", estDays: "1" },
                { category: "통신 상태 및 유틸리티", content: "인터락 Test 및 통신상태 확인 ", estDays: "2" },
                { category: "셋업 평가", content: "분석부 안정화 및 오염제어", estDays: "5" },
                { category: "셋업 평가", content: "Calibration 평가", estDays: "2" },
                { category: "셋업 평가", content: "Sample 측정", estDays: "2" },
                { category: "셋업 평가", content: "신뢰도 평가", estDays: "5" },
                { category: "셋업 완료", content: "셋업 완료", estDays: "0" }
            ];
        }

        data.setupDetails = templateToUse.map((item, idx) => ({
            id: Date.now() + idx, category: item.category, content: item.content,
            startDate: "", date: "", estDays: item.estDays || "1",
            completed: false, execStartDate: "", delayReason: ""
        }));

        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
        window.syncSetupDataDB(currentPath.site, currentPath.equip, data.setupDetails, null); // [DB 동기화]
    }

    // [요청] '셋업 완료' 항목이 없는 경우, 강제로 추가하여 복구
    if (data.setupDetails) {
        const hasCompletionItem = data.setupDetails.some(item => item.category === '셋업 완료' && item.content === '셋업 완료');
        if (!hasCompletionItem) {
            data.setupDetails.push({
                id: Date.now() + 999, // 고유 ID
                category: "셋업 완료",
                content: "셋업 완료",
                startDate: "", estDays: "0", date: ""
            });
            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));
            window.syncSetupDataDB(currentPath.site, currentPath.equip, data.setupDetails, null); // [DB 동기화]
        }
    }

    // 편집 모드 확인
    const card = document.getElementById('setup-detail-card');
    const isEditMode = card ? card.classList.contains('edit-mode') : false;

    tbody.innerHTML = '';

    const categories = ["장비 반입 및 정위치", "통신 상태 및 유틸리티", "셋업 평가", "셋업 완료"];

    categories.forEach(cat => {
        // 카테고리 헤더 생성
        const headerRow = document.createElement('tr');
        headerRow.className = 'category-header-row';
        headerRow.dataset.category = cat;
        const addBtnClass = cat === '셋업 완료' ? 'display-none' : '';
        headerRow.innerHTML = `
            <td colspan="7" class="category-header">
                <span class="category-title">${cat}</span>
                <button class="btn-add-category ${addBtnClass}" onclick="addSetupDetailItem('${cat}')" title="항목 추가">+</button>
            </td>
        `;
        tbody.appendChild(headerRow);

        // 해당 카테고리의 아이템 필터링 및 렌더링
        const items = data.setupDetails.filter(item => (item.category || categories[0]) === cat);
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = 'item-row';
            tr.dataset.id = item.id;
            tr.dataset.category = cat; // 카테고리 정보 저장 (역산 기준점 식별용)
            tr.draggable = isEditMode;
            tr.dataset.delayReason = item.delayReason || "";
            tr.dataset.execStartDate = item.execStartDate || "";

            // [수정] '실행일(execStartDate)'이 등록된 경우에만 진행 중(녹색)으로 표시
            const isInProgress = item.execStartDate && !item.completed;
            if (isInProgress) {
                tr.classList.add('in-progress');
            }

            const checkedAttr = item.completed ? 'checked' : '';

            const checkboxVisibilityClass = (!item.execStartDate && !item.completed && cat !== '셋업 완료') ? 'visibility-hidden' : '';

            const inputDisabledAttr = item.completed ? 'disabled' : '';
            const inputColorClass = item.completed ? 'color-completed' : 'color-normal';

            let startDateCellHtml = `
                <input type="date" class="detail-start-date-input ${inputColorClass}" value="${item.startDate || ''}" ${inputDisabledAttr}>
            `;

            // [수정] 실행일 클릭 시 '셋업 작업 기록' 팝업창 호출 (기존 '실행 시작일 설정' 팝업창 대체)
            const safeContent = item.content.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            let execDateClickAction = (!item.completed) ? `event.preventDefault(); if(typeof window.openSetupLogRegisterModal==='function'){window.openSetupLogRegisterModal('${currentPath.site}', '${currentPath.equip}', '${safeContent}', '${item.execStartDate || ''}')}else{alert('팝업을 열 수 없습니다.');}` : '';
            let execStartDateCellHtml = `
                <input type="date" class="detail-exec-start-date-input ${inputColorClass}" value="${item.execStartDate || ''}" ${inputDisabledAttr} onclick="${execDateClickAction}">
            `;

            // [수정] 완료일 클릭 시 '작업 완료 체크'가 된 상태로 셋업 작업 기록 팝업 호출
            let dateClickAction = (!item.completed) ? `event.preventDefault(); if(typeof window.openSetupLogRegisterModal==='function'){window.openSetupLogRegisterModal('${currentPath.site}', '${currentPath.equip}', '${safeContent}', '${item.date || ''}', true)}else{alert('팝업을 열 수 없습니다.');}` : '';
            let dateCellHtml = `
                <input type="date" class="detail-date-input ${inputColorClass}" value="${item.date || ''}" ${inputDisabledAttr} onclick="${dateClickAction}">
            `;

            let contentCellHtml = `
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="text" class="detail-content-input ${inputColorClass}" value="${escapeHtml(item.content)}" placeholder="항목 입력" style="flex:1;" ${inputDisabledAttr}>
                </div>
            `;

            const estVal = (item.estDays !== undefined && item.estDays !== null && item.estDays !== '') ? item.estDays : '1';
            let estDaysHtml = `<input type="text" class="detail-est-days-input input-est-days ${inputColorClass}" value="${estVal}" placeholder="0" ${inputDisabledAttr}>`;

            if (cat === '셋업 완료') {
                estDaysHtml = `<button type="button" class="btn-recalc-date" onclick="triggerSetupScheduleCalculation()">↺</button>`;
            }

            // [수정] 실행 버튼(▶) 삭제, 항상 완료 체크박스만 표시
            const actionCellHtml = `<input type="checkbox" class="detail-complete-checkbox" ${checkedAttr}>`;

            tr.innerHTML = `
                <td>${contentCellHtml}</td>
                <td style="text-align: center;">${estDaysHtml}</td>
                <td>${startDateCellHtml}</td>
                <td>${execStartDateCellHtml}</td>
                <td>${dateCellHtml}</td>
                <td style="text-align: center;">${actionCellHtml}</td>
                <td style="text-align: center;"><button class="btn-del-sm" onclick="deleteSetupDetailItem(${item.id})">✕</button></td>
            `;
            tr.addEventListener('dragstart', () => tr.classList.add('dragging'));
            // 드래그 종료 시 자동 저장
            tr.addEventListener('dragend', () => { tr.classList.remove('dragging'); saveSetupDetails('REORDER_SETUP', '순서 변경'); });

            // [추가] 내부 입력 요소 클릭 시 드래그 간섭 방지
            tr.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.classList.contains('date-display-text')) {
                    tr.draggable = false;
                }
            });
            tr.addEventListener('mouseup', () => {
                const card = document.getElementById('setup-detail-card');
                if (card && card.classList.contains('edit-mode')) tr.draggable = true;
            });
            tr.addEventListener('mouseleave', () => {
                const card = document.getElementById('setup-detail-card');
                if (card && card.classList.contains('edit-mode')) tr.draggable = true;
            });

            // 입력 변경 시 자동 저장 (텍스트는 change 이벤트로 과도한 저장 방지)
            tr.querySelectorAll('input').forEach(input => {
                const eventType = (input.type === 'text') ? 'change' : 'change';
                input.addEventListener(eventType, () => saveSetupDetails());

                // [추가] 날짜 입력 시 휴일 체크 및 알림
                if (input.type === 'date') {
                    input.addEventListener('change', () => checkAndAlertHoliday(input));
                }
            });

            attachSetupCheckboxListener(tr);

            // 셋업 완료 예정일 입력 시 자동 계산
            if (cat === '셋업 완료' && item.content === '셋업 완료') {
                const startInput = tr.querySelector('.detail-start-date-input');
                startInput.addEventListener('change', (e) => {
                    calculateSetupSchedule(e.target.value);
                });
            }

            // 작업일수 수정 시 아래 항목들 시작일 자동 계산 (Forward Calculation)
            const estInput = tr.querySelector('.detail-est-days-input');
            if (estInput) {
                estInput.addEventListener('input', () => {
                    calculateScheduleForward(tr);
                });
            }

            // 시작예정일 수정 시 아래 항목들 시작일 자동 계산
            const startInput = tr.querySelector('.detail-start-date-input');
            if (startInput && cat !== '셋업 완료') {
                startInput.addEventListener('change', () => {
                    calculateScheduleForward(tr);
                    calculateScheduleBackward(tr);
                });
            }

            tbody.appendChild(tr);
        });
    });

    // 초기 실행률 계산 및 표시
    updateExecutionRate();
}

function addSetupDetailItem(category) {
    if (!currentPath.site || !currentPath.equip) return alert('장비를 선택해주세요.');
    if (!category) category = "장비 반입 및 정위치"; // 기본값

    const tbody = document.getElementById('setup-detail-body');
    const id = Date.now();
    const tr = document.createElement('tr');
    tr.className = 'item-row';

    const card = document.getElementById('setup-detail-card');
    const isEditMode = card ? card.classList.contains('edit-mode') : false;

    tr.dataset.id = id;
    tr.dataset.category = category; // 카테고리 설정
    tr.draggable = isEditMode;
    tr.innerHTML = `
            <td>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="text" class="detail-content-input" value="" placeholder="새 항목" style="flex:1;">
                </div>
            </td>
            <td><input type="text" class="detail-est-days-input input-est-days color-normal" value="1" placeholder="0"></td>
            <td><input type="date" class="detail-start-date-input" value=""></td>
            <td><input type="date" class="detail-exec-start-date-input" value=""></td>
            <td><input type="date" class="detail-date-input" value=""></td>
            <td style="text-align: center;"><input type="checkbox" class="detail-complete-checkbox"></td>
        <td style="text-align: center;"><button class="btn-del-sm" onclick="deleteSetupDetailItem(${id})">✕</button></td>
    `;
    tr.addEventListener('dragstart', () => tr.classList.add('dragging'));
    tr.addEventListener('dragend', () => { tr.classList.remove('dragging'); saveSetupDetails('REORDER_SETUP', '순서 변경'); });

    // [추가] 내부 입력 요소 클릭 시 드래그 간섭 방지
    tr.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.classList.contains('date-display-text')) {
            tr.draggable = false;
        }
    });
    tr.addEventListener('mouseup', () => {
        const card = document.getElementById('setup-detail-card');
        if (card && card.classList.contains('edit-mode')) tr.draggable = true;
    });
    tr.addEventListener('mouseleave', () => {
        const card = document.getElementById('setup-detail-card');
        if (card && card.classList.contains('edit-mode')) tr.draggable = true;
    });

    // 입력 변경 감지 이벤트 추가
    tr.querySelectorAll('input').forEach(input => {
        const eventType = (input.type === 'text') ? 'change' : 'change';
        input.addEventListener(eventType, () => saveSetupDetails());

        // [추가] 날짜 입력 시 휴일 체크 및 알림
        if (input.type === 'date') {
            input.addEventListener('change', () => checkAndAlertHoliday(input));
        }
    });

    attachSetupCheckboxListener(tr);

    // 작업일수 수정 시 아래 항목들 시작일 자동 계산
    const estInput = tr.querySelector('.detail-est-days-input');
    if (estInput) {
        estInput.addEventListener('input', () => {
            calculateScheduleForward(tr);
        });
    }

    // 시작예정일 수정 시 아래 항목들 시작일 자동 계산
    const startInput = tr.querySelector('.detail-start-date-input');
    if (startInput && category !== '셋업 완료') {
        startInput.addEventListener('change', () => {
            calculateScheduleForward(tr);
            calculateScheduleBackward(tr);
        });
    }

    // 해당 카테고리의 마지막 위치 찾기
    const rows = Array.from(tbody.children);
    const headerIndex = rows.findIndex(r => r.classList.contains('category-header-row') && r.dataset.category === category);
    let insertAfterNode = null;

    if (headerIndex !== -1) {
        insertAfterNode = rows[headerIndex];
        for (let i = headerIndex + 1; i < rows.length; i++) {
            if (rows[i].classList.contains('category-header-row')) break;
            insertAfterNode = rows[i];
        }
    }

    if (insertAfterNode && insertAfterNode.nextSibling) tbody.insertBefore(tr, insertAfterNode.nextSibling);
    else tbody.appendChild(tr);

    // [수정] 새 항목에 체크박스 리스너 즉시 연결
    attachSetupCheckboxListener(tr);

    saveSetupDetails('ADD_SETUP_ITEM', `Category: ${category}`); // 항목 추가 후 자동 저장 및 로그
}

function deleteSetupDetailItem(id) {
    const row = document.querySelector(`#setup-detail-body tr[data-id="${id}"]`);
    if (row) {
        row.remove();
        saveSetupDetails('DELETE_SETUP_ITEM', `ID: ${id}`); // 삭제 후 자동 저장 및 로그
    }
}

function toggleSetupDetailDeleteMode(btn) {
    const card = document.getElementById('setup-detail-card');
    if (card) {
        saveSetupDetails(); // 모드 전환 전 저장
        card.classList.toggle('edit-mode');
        btn.classList.toggle('active');

        const isEditMode = card.classList.contains('edit-mode');

        // 리스트 불러오기 버튼 토글
        const loadBtn = document.getElementById('btn-load-setup-list');
        if (loadBtn) loadBtn.style.display = isEditMode ? 'block' : 'none';

        // [추가] 초기화 버튼 토글
        const resetBtn = document.getElementById('btn-reset-setup-date');
        if (resetBtn) resetBtn.style.display = isEditMode ? 'inline-block' : 'none';

        // [추가] 정렬 버튼 토글
        const alignBtn = document.getElementById('btn-align-setup-today');
        if (alignBtn) alignBtn.style.display = isEditMode ? 'inline-block' : 'none';

        renderSetupDetailList(); // 리스트 재렌더링 (입력창 활성/비활성 적용)
    }
}

function saveSetupDetails(logAction = 'UPDATE_SETUP_DETAILS', logDetails = '셋업 상세 내역 수정') {
    if (!currentPath.site || !currentPath.equip) return alert('장비를 선택해주세요.');

    // [수정] 모바일 등 입력창이 없는 뷰에서도 데이터 손실 방지를 위해 기존 데이터 로드
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};
    // ID로 기존 아이템을 빠르게 찾기 위한 맵 생성
    const originalDetailsMap = new Map((data.setupDetails || []).map(i => [i.id, i]));

    const rows = document.querySelectorAll('#setup-detail-body tr');
    const newDetails = [];
    let currentCategory = "장비 반입 및 정위치";

    let totalItems = 0;
    let completedItems = 0;

    rows.forEach(row => {
        if (row.classList.contains('category-header-row')) {
            currentCategory = row.dataset.category;
            return;
        }

        const id = parseInt(row.dataset.id);
        if (isNaN(id)) return;

        // 기존 아이템 가져오기
        const originalItem = originalDetailsMap.get(id) || {};

        const checkbox = row.querySelector('.detail-complete-checkbox');
        const completed = checkbox ? checkbox.checked : (originalItem.completed || false);

        // 입력 요소가 없으면(모바일 뷰 등) 기존 데이터 유지
        const contentInput = row.querySelector('.detail-content-input');
        const content = contentInput ? contentInput.value : (originalItem.content || "");

        // [수정] DOM에 입력창이 없으면 dataset.date 확인 (모바일 팝업 수정 대응)
        const dateInput = row.querySelector('.detail-date-input');
        let date = "";
        if (row.dataset.date !== undefined) {
            date = row.dataset.date;
        } else {
            date = dateInput ? dateInput.value : (originalItem.date || "");
        }

        const startDateInput = row.querySelector('.detail-start-date-input');
        const startDate = startDateInput ? startDateInput.value : (originalItem.startDate || "");

        // [추가] 실행 시작일 (execStartDate) 저장
        const execStartDateInput = row.querySelector('.detail-exec-start-date-input');
        let execStartDate = "";
        if (row.dataset.execStartDate !== undefined) { // dataset이 우선 (모달에서 업데이트됨)
            execStartDate = row.dataset.execStartDate;
        } else { // 입력 필드가 있다면 입력 필드 값 사용
            execStartDate = execStartDateInput ? execStartDateInput.value : (originalItem.execStartDate || "");
        }

        const estInput = row.querySelector('.detail-est-days-input');

        let estDays = "0";
        if (estInput) {
            estDays = estInput.value.trim();
            if (estDays === "") estDays = "1"; // 빈 값은 1로 저장
        } else {
            estDays = originalItem.estDays || "1";
        }

        // [FIX] DOM 상태를 우선 저장 (완료 해제 시 빈 문자열로 설정된 값을 저장하기 위함)
        // originalItem fallback을 제거하여, DOM에서 초기화된 값이 무시되지 않도록 수정 (execStartDate도 포함)
        const delayReason = row.dataset.delayReason !== undefined ? row.dataset.delayReason : "";

        newDetails.push({ id, completed, content, date, startDate, estDays, category: currentCategory, delayReason, execStartDate });

        // 실행률 계산용 카운트
        totalItems++;
        if (completed) completedItems++;
    });

    data.setupDetails = newDetails;
    setupData[equipKey] = data;
    localStorage.setItem('setup_data', JSON.stringify(setupData));
    window.syncSetupDataDB(currentPath.site, currentPath.equip, newDetails, null); // [DB 동기화]

    // 실행률 업데이트
    updateExecutionRate(completedItems, totalItems);

    // [추가] 시스템 로그 기록
    if (typeof addSystemLog === 'function') {
        addSystemLog(logAction, currentPath.equip, logDetails);
    }
}

function updateExecutionRate(completed, total) {
    // 인자가 없으면 DOM에서 다시 계산
    if (completed === undefined || total === undefined) {
        const rows = document.querySelectorAll('#setup-detail-body tr.item-row');
        total = rows.length;
        completed = Array.from(rows).filter(r => r.querySelector('.detail-complete-checkbox')?.checked).length;
    }

    const rate = total === 0 ? 0 : Math.round((completed / total) * 100);
    const rateEl = document.getElementById('setup-progress-rate');
    if (rateEl) {
        rateEl.textContent = `${rate}%`;
        rateEl.classList.remove('rate-text-100', 'rate-text-mid', 'rate-text-0');
        if (rate === 100) rateEl.classList.add('rate-text-100');
        else if (rate > 0) rateEl.classList.add('rate-text-mid');
        else rateEl.classList.add('rate-text-0');
    }
}

// 체크박스 이벤트 리스너 (체크 해제 시 실행 버튼 복구 로직 포함)
function attachSetupCheckboxListener(row) {
    const checkbox = row.querySelector('.detail-complete-checkbox');
    // const dateInput = row.querySelector('.detail-date-input'); // [제거] 아래에서 안전하게 접근
    if (!checkbox) return;

    checkbox.addEventListener('click', (e) => {
        if (!checkbox.checked) {
            if (!confirm("완료 상태를 해제하시겠습니까?\n해당 작업에 기록된 셋업 일지도 모두 삭제됩니다.")) {
                e.preventDefault();
                checkbox.checked = true; // [추가] 취소 시 체크 상태 복구
                return;
            }
            // [수정] 입력창이 있을 때만 값 초기화
            const dateInput = row.querySelector('.detail-date-input');
            if (dateInput) dateInput.value = '';

            // [추가] 모바일 대응: 데이터셋 날짜 초기화 (입력창 없을 때 저장 시 반영용)
            row.dataset.date = "";

            // [FIX] delete 대신 빈 문자열 할당하여 saveSetupDetails에서 원본 데이터로 복구되는 것 방지
            row.dataset.delayReason = "";
            row.dataset.execStartDate = "";
            row.classList.remove('in-progress');

            // 입력 필드 활성화 (체크 해제 시 수정 가능하도록)
            const inputs = row.querySelectorAll('input[type="text"], input[type="date"]');
            inputs.forEach(input => {
                input.disabled = false;
                input.style.color = '#e6edf3';
            });

            // [추가] 셋업 일지 삭제 로직
            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${currentPath.site}::${currentPath.equip}`;
            let data = setupData[equipKey] || {};
            const taskId = parseInt(row.dataset.id);
            const targetTask = (data.setupDetails || []).find(t => t.id === taskId);
            const taskContent = targetTask ? targetTask.content : '';

            let logsUpdated = false;
            if (data.setupLogs && taskContent) {
                const originalLength = data.setupLogs.length;
                data.setupLogs = data.setupLogs.filter(l => l.content !== taskContent);
                if (data.setupLogs.length !== originalLength) {
                     setupData[equipKey] = data;
                     localStorage.setItem('setup_data', JSON.stringify(setupData));
                     logsUpdated = true;
                }
            }

            // [요청] 즉시 반영을 위해 저장 (데이터 정합성 유지)
            saveSetupDetails('UPDATE_SETUP_STATUS', '완료 상태 해제');

            if (logsUpdated) {
                window.syncSetupDataDB(currentPath.site, currentPath.equip, null, data.setupLogs);
                if (typeof renderSetupLogList === 'function') renderSetupLogList();
                if (typeof renderGanttChart === 'function') renderGanttChart();
            }
            renderSetupDetailList(); // [추가] 화면 갱신 (모바일 텍스트 반영)
        } else {
            e.preventDefault();
            if (typeof window.openSetupLogRegisterModal === 'function') {
                const taskContent = row.querySelector('.detail-content-input') ? row.querySelector('.detail-content-input').value : "";
                const safeContent = taskContent.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                window.openSetupLogRegisterModal(currentPath.site, currentPath.equip, safeContent, '', true);
            } else {
                alert("팝업을 열 수 없습니다.");
            }
        }
    });
}

/* ==========================================================================
   6. 일정 계산 로직 (Schedule Calculation Logic)
   ========================================================================== */
window.calculateSetupSchedule = function (targetDateStr) {
    if (!targetDateStr) return;

    const rows = Array.from(document.querySelectorAll('#setup-detail-body tr.item-row'));
    // 로컬 시간 기준으로 날짜 객체 생성 (타임존 이슈 방지)
    const [y, m, d] = targetDateStr.split('-').map(Number);
    let currentEndDate = new Date(y, m - 1, d); // 기준점: 완료일

    // 셋업 완료 항목(기준점)을 찾고 그 위로 역순 계산
    let startCalc = false;

    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];

        // 텍스트 대신 카테고리로 기준점 확인 (더 안정적)
        if (row.dataset.category === '셋업 완료') {
            startCalc = true;
            // 기준 날짜를 해당 행의 시작일로 확실하게 재설정
            const startInput = row.querySelector('.detail-start-date-input');
            if (startInput && startInput.value) {
                const [y, m, d] = startInput.value.split('-').map(Number);
                // 셋업 완료일의 전날(영업일 기준)을 이전 작업의 완료일로 설정
                currentEndDate = window.addBusinessDays(new Date(y, m - 1, d), -1);
            }
            continue; // 셋업 완료 행은 건너뜀 (기준점)
        }

        if (startCalc) {
            const checkbox = row.querySelector('.detail-complete-checkbox');
            const isCompleted = checkbox ? checkbox.checked : false;
            const estInput = row.querySelector('.detail-est-days-input');
            const startInput = row.querySelector('.detail-start-date-input');

            if (estInput && startInput) {
                if (isCompleted) {
                    // 완료된 항목은 계산 제외, 기존 값 유지 (단, 다음 계산을 위해 기준 날짜 갱신)
                    if (startInput.value) {
                        const [cy, cm, cd] = startInput.value.split('-').map(Number);
                        // 완료된 항목의 시작일 바로 전날이 그 위 항목의 완료일이 됨
                        currentEndDate = window.addBusinessDays(new Date(cy, cm - 1, cd), -1);
                    }
                } else {
                    // 작업일수가 없거나 0이면 1로 처리 (최소 1일)
                    let estDays = parseInt(estInput.value);
                    if (isNaN(estDays) || estDays <= 0) estDays = 1;

                    // 시작일 = 완료일 - (작업일수 - 1)
                    const newStart = window.addBusinessDays(currentEndDate, -(estDays - 1));

                    startInput.value = formatLocalDate(newStart);

                    // 다음(위쪽) 항목의 완료일 = 현재 항목 시작일 - 1일
                    currentEndDate = window.addBusinessDays(newStart, -1);
                }
            }
        }
    }
    saveSetupDetails('CALC_SETUP_SCHEDULE', '일정 자동 계산 (완료일 기준)'); // 계산 후 자동 저장
};

// [수정] skipSave 파라미터 추가 (연속 계산 시 중복 저장 방지)
function calculateScheduleForward(startRow, skipSave = false) {
    const rows = Array.from(document.querySelectorAll('#setup-detail-body tr.item-row'));
    const startIndex = rows.indexOf(startRow);
    if (startIndex === -1) return;

    let currentStartDate = null;

    // 변경된 행의 시작일 가져오기
    const startInput = startRow.querySelector('.detail-start-date-input');
    if (startInput && startInput.value) {
        const [y, m, d] = startInput.value.split('-').map(Number);
        currentStartDate = new Date(y, m - 1, d);
    } else {
        return; // 시작일이 없으면 계산 불가
    }

    // 변경된 행의 작업일수 가져오기
    const estInput = startRow.querySelector('.detail-est-days-input');
    let estDays = parseInt(estInput.value);
    if (isNaN(estDays) || estDays <= 0) estDays = 1; // [수정] 최소 1일 보장

    // 현재 행 완료일 = 시작일 + (작업일수 - 1)
    // 다음 행 시작일 = 현재 행 완료일 + 1
    let currentEndDate = window.addBusinessDays(currentStartDate, estDays - 1);
    let nextStartDate = window.addBusinessDays(currentEndDate, 1);

    for (let i = startIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        const rowStartInput = row.querySelector('.detail-start-date-input');
        const rowEstInput = row.querySelector('.detail-est-days-input');
        const checkbox = row.querySelector('.detail-complete-checkbox');
        const isCompleted = checkbox ? checkbox.checked : false;

        if (rowStartInput) {
            if (!isCompleted) {
                rowStartInput.value = formatLocalDate(nextStartDate);

            } else {
                // 완료된 항목은 날짜를 변경하지 않지만, 다음 계산의 기준점으로 사용
                if (rowStartInput.value) {
                    const [ny, nm, nd] = rowStartInput.value.split('-').map(Number);
                    nextStartDate = new Date(ny, nm - 1, nd);
                }
            }

            // 다음 반복을 위해 날짜 갱신
            let currentEst = rowEstInput ? parseInt(rowEstInput.value) : 1;
            if (isNaN(currentEst) || currentEst <= 0) currentEst = 1; // [수정] 최소 1일 보장
            const thisEndDate = window.addBusinessDays(new Date(nextStartDate), currentEst - 1);
            nextStartDate = window.addBusinessDays(thisEndDate, 1);
        }
    }
    if (!skipSave) saveSetupDetails('CALC_SETUP_SCHEDULE', '일정 자동 계산 (순방향)');
}

// [수정] skipSave 파라미터 추가
function calculateScheduleBackward(startRow, skipSave = false) {
    const rows = Array.from(document.querySelectorAll('#setup-detail-body tr.item-row'));
    const startIndex = rows.indexOf(startRow);
    if (startIndex < 0) return; // 찾을 수 없으면 종료

    // [수정] startIndex가 0(첫 번째 항목)일 때도 저장이 누락되지 않도록 로직 개선
    if (startIndex > 0) {
        let nextTaskStartDate = null;

        // 변경된 행(기준점)의 시작일 가져오기
        const startInput = startRow.querySelector('.detail-start-date-input');
        if (startInput && startInput.value) {
            const [y, m, d] = startInput.value.split('-').map(Number);
            nextTaskStartDate = new Date(y, m - 1, d);

            // 위쪽으로 역순 순회
            for (let i = startIndex - 1; i >= 0; i--) {
                const row = rows[i];
                const checkbox = row.querySelector('.detail-complete-checkbox');
                const isCompleted = checkbox ? checkbox.checked : false;

                if (isCompleted) break; // 완료된 작업을 만나면 역산 중단 (고정점)

                const rowStartInput = row.querySelector('.detail-start-date-input');
                const rowEstInput = row.querySelector('.detail-est-days-input');

                if (rowStartInput && rowEstInput) {
                    let estDays = parseInt(rowEstInput.value);
                    if (isNaN(estDays) || estDays <= 0) estDays = 1; // 최소 1일 보장
                    // 현재 행 완료일 = 다음 행 시작일 - 1일 (영업일 기준)
                    const currentEndDate = window.addBusinessDays(nextTaskStartDate, -1);
                    // 현재 행 시작일 = 현재 행 완료일 - (작업일수 - 1)
                    const currentStartDate = window.addBusinessDays(currentEndDate, -(estDays - 1));

                    rowStartInput.value = formatLocalDate(currentStartDate);

                    // 다음 반복(더 위쪽)을 위해 기준 날짜 갱신
                    nextTaskStartDate = currentStartDate;
                }
            }
        }
    }

    if (!skipSave) saveSetupDetails('CALC_SETUP_SCHEDULE', '일정 자동 계산 (역방향)');
}

window.triggerSetupScheduleCalculation = function () {
    const rows = Array.from(document.querySelectorAll('#setup-detail-body tr.item-row'));
    // 카테고리로 셋업 완료 행 찾기
    const setupCompleteRow = rows.find(row => row.dataset.category === '셋업 완료');

    if (setupCompleteRow) {
        const dateInput = setupCompleteRow.querySelector('.detail-start-date-input');
        if (dateInput && dateInput.value) {
            calculateSetupSchedule(dateInput.value);
        } else {
            alert('셋업 완료 예정일(시작일)을 먼저 입력해주세요.');
        }
    }
};

function renderSetupLogList() {
    const tbody = document.getElementById('setup-log-body');
    if (!tbody || !currentPath.site || !currentPath.equip) return;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};
    const logs = data.setupLogs || [];

    const filterText = document.getElementById('setup-log-filter-date') ? document.getElementById('setup-log-filter-date').value.trim().toLowerCase() : '';
    let filteredLogs = logs;
    if (filterText) {
        filteredLogs = logs.filter(l =>
            (l.date && l.date.includes(filterText)) ||
            (l.content && l.content.toLowerCase().includes(filterText)) ||
            (l.worker && l.worker.toLowerCase().includes(filterText)) ||
            (l.company && l.company.toLowerCase().includes(filterText)) ||
            (l.memo && l.memo.toLowerCase().includes(filterText)) ||
            (l.parts && l.parts.toLowerCase().includes(filterText))
        );
    }

    // 날짜 내림차순 정렬
    filteredLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = filteredLogs.map(item => {
        // [수정] [지연] 태그 주황색 표시
        const contentHtml = (escapeHtml(item.content) || '-').replace(/\[지연\]/g, '<span class="tag-delayed">[지연]</span>');

        return `<tr data-id="${item.id}" onclick="selectSetupLog(${item.id})" class="${selectedSetupLogId === item.id ? 'active-log' : ''}" style="cursor: pointer;">
            <td class="log-date">${item.date}</td>
            <td class="log-content" style="text-align:left; vertical-align:middle;">${contentHtml}</td>
            <td class="log-worker">${escapeHtml(item.worker)}</td>
            <td class="log-md" style="color:#d29922; font-weight:bold;">${item.md ? item.md : '0'}</td>
            <td class="manage-col" style="text-align: center; vertical-align:middle;">
                <button class="btn-edit" onclick="event.stopPropagation(); if(typeof window.openLogForEditing === 'function'){ window.openLogForEditing('${currentPath.site}', '${currentPath.equip}', ${item.id}); } else { toggleSetupLogEdit(${item.id}); }">✏️</button>
                <button class="btn-del-sm" onclick="event.stopPropagation(); deleteSetupLogItem(${item.id})">✕</button>
            </td>
        </tr>
    `}).join('');
}

function selectSetupLog(id) {
    // 저장되지 않은 변경사항 확인
    const memoArea = document.getElementById('setup-log-detail-memo');
    if (selectedSetupLogId !== null && memoArea && memoArea.value !== originalSetupLogMemo) {
        if (!confirm("저장되지 않은 변경사항이 있습니다. 저장하지 않고 다른 항목을 선택하시겠습니까?")) {
            return;
        }
    }

    selectedSetupLogId = id;
    localStorage.setItem(`lastSetupLog_${currentPath.site}_${currentPath.equip}`, id);

    // UI 업데이트 (행 강조)
    const rows = document.querySelectorAll('#setup-log-body tr');
    rows.forEach(row => row.classList.remove('active-log'));

    // 다시 렌더링하여 클래스 적용 (간단한 방법)
    renderSetupLogList();

    // 메모 로드
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    const data = setupData[equipKey] || {};
    const logs = data.setupLogs || [];
    // [수정] ID 비교 시 타입 불일치 방지를 위해 == 사용 (HTML 속성은 문자열일 수 있음)
    const log = logs.find(l => l.id == id);

    if (memoArea) {
        const val = log ? (log.memo || "") : "";
        memoArea.value = val;
        originalSetupLogMemo = val; // 원본 상태 업데이트

        // 버튼 색상 초기화
        const saveBtn = document.getElementById('btn-save-setup-log-memo');
        if (saveBtn) {
            saveBtn.classList.remove('btn-orange-sm');
            saveBtn.classList.add('btn-green-sm');
        }
    }

    // [추가] 셋업 물품 카드 구성 및 렌더링 (메모창 좌측 배치)
    const memoInput = document.getElementById('setup-log-detail-memo');
    let replacedPartsContainer = document.getElementById('setup-replaced-parts-container');
    
    if (memoInput && !replacedPartsContainer) {
        const memoParent = memoInput.parentNode;
        
        const flexWrapper = document.createElement('div');
        flexWrapper.id = 'setup-memo-flex-wrapper';
        flexWrapper.style.display = 'flex';
        flexWrapper.style.gap = '15px';
        flexWrapper.style.height = '100%';
        flexWrapper.style.flex = '1';
        flexWrapper.style.minHeight = '0';
        
        replacedPartsContainer = document.createElement('div');
        replacedPartsContainer.id = 'setup-replaced-parts-container';
        replacedPartsContainer.style.display = 'flex';
        replacedPartsContainer.style.flexDirection = 'column';
        replacedPartsContainer.style.background = '#161b22';
        replacedPartsContainer.style.border = '1px solid #30363d';
        replacedPartsContainer.style.borderRadius = '6px';
        replacedPartsContainer.style.overflow = 'hidden';
        replacedPartsContainer.style.minHeight = '0';
        
        const partsTitle = document.createElement('div');
        partsTitle.style.padding = '8px 12px';
        partsTitle.style.background = '#21262d';
        partsTitle.style.borderBottom = '1px solid #30363d';
        partsTitle.style.fontWeight = 'bold';
        partsTitle.style.fontSize = '13px';
        partsTitle.style.color = '#e6edf3';
        partsTitle.textContent = '셋업 물품';
        replacedPartsContainer.appendChild(partsTitle);
        
        const partsList = document.createElement('ul');
        partsList.id = 'setup-replaced-parts-list';
        partsList.style.listStyle = 'none';
        partsList.style.margin = '0';
        partsList.style.padding = '0';
        partsList.style.overflowY = 'auto';
        partsList.style.flex = '1';
        partsList.style.minHeight = '0';
        replacedPartsContainer.appendChild(partsList);
        
        const memoWrapper = document.createElement('div');
        memoWrapper.style.flex = '1';
        memoWrapper.style.display = 'flex';
        memoWrapper.style.flexDirection = 'column';
        memoWrapper.style.minWidth = '0';

        flexWrapper.style.flexDirection = 'row';
        replacedPartsContainer.style.flex = '0 0 280px';
        replacedPartsContainer.style.maxHeight = 'none';
        memoWrapper.style.flex = '1';
        memoWrapper.style.minHeight = '0';
        
        memoParent.insertBefore(flexWrapper, memoInput);
        memoWrapper.appendChild(memoInput);
        flexWrapper.appendChild(replacedPartsContainer);
        flexWrapper.appendChild(memoWrapper);
        
        memoInput.style.flex = '1';
        memoInput.style.width = '100%';
        memoInput.style.minHeight = '0';
        memoInput.style.resize = 'none';
        memoInput.style.overflowY = 'auto';
        memoInput.style.boxSizing = 'border-box';
    }

    const partsList = document.getElementById('setup-replaced-parts-list');
    if (partsList) {
        let partsData = log ? log.parts : '';
        let replacedParts = [];

        if (partsData) {
            const itemsList = partsData.split(',').map(s => s.trim()).filter(Boolean);
            itemsList.forEach(itemText => {
                let pureContent = itemText;
                let itemCost = '';
                const costMatch = pureContent.match(/^\[(.*?)\]\s*(.*)$/);
                if (costMatch) {
                    itemCost = costMatch[1];
                    pureContent = costMatch[2];
                }
                replacedParts.push({ name: pureContent, costType: itemCost });
            });
        }

        partsList.innerHTML = '';
        if (replacedParts.length > 0) {
            replacedParts.forEach(part => {
                const li = document.createElement('li');
                li.style.padding = '10px';
                li.style.borderBottom = '1px solid #30363d';
                li.style.fontSize = '12px';
                li.style.color = '#c9d1d9';
                li.style.display = 'flex';
                li.style.alignItems = 'center';
                li.style.justifyContent = 'space-between';
                
                let titleHtml = `<span style="font-weight:bold; color:#58a6ff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(part.name)}">${escapeHtml(part.name)}</span>`;
                let costHtml = part.costType ? `<span style="font-size:10px; background:#30363d; padding:2px 6px; border-radius:4px; color:#e6edf3; flex-shrink:0; margin-left:5px;">${escapeHtml(part.costType)}</span>` : '';
                
                li.innerHTML = titleHtml + costHtml;
                partsList.appendChild(li);
            });
        } else {
            partsList.innerHTML = '<li style="padding:20px; text-align:center; color:#8b949e; font-size:12px;">선택된 물품 없음</li>';
        }
    }
}

function saveSetupLogMemo() {
    if (!selectedSetupLogId) return;

    const memoArea = document.getElementById('setup-log-detail-memo');
    const memoContent = memoArea.value;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};

    const logIndex = data.setupLogs.findIndex(l => l.id === selectedSetupLogId);
    if (logIndex > -1) {
        data.setupLogs[logIndex].memo = memoContent;
        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
        window.syncSetupDataDB(currentPath.site, currentPath.equip, null, data.setupLogs); // [DB 동기화]

        originalSetupLogMemo = memoContent; // 원본 상태 업데이트
        const saveBtn = document.getElementById('btn-save-setup-log-memo');
        if (saveBtn) {
            saveBtn.classList.remove('btn-orange-sm');
            saveBtn.classList.add('btn-green-sm');
        }

        if (typeof addSystemLog === 'function') addSystemLog('UPDATE_SETUP_LOG_MEMO', currentPath.equip, '셋업 일지 메모 수정');
    }
}

function deleteSetupLogItem(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};

    if (data.setupLogs) {
        data.setupLogs = data.setupLogs.filter(l => l.id !== id);
        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
        window.syncSetupDataDB(currentPath.site, currentPath.equip, null, data.setupLogs); // [DB 동기화]

        if (selectedSetupLogId === id) {
            selectedSetupLogId = null;
            originalSetupLogMemo = "";
            document.getElementById('setup-log-detail-memo').value = "";
        }
        renderSetupLogList();

        if (typeof addSystemLog === 'function') {
            addSystemLog('DELETE_SETUP_LOG', currentPath.equip, `ID: ${id}`);
        }
    }
}

function toggleSetupLogEditMode(btn) {
    const card = document.getElementById('setup-log-card');
    if (card) {
        card.classList.toggle('edit-mode');
        btn.classList.toggle('active');
    }
}

function toggleSetupLogEdit(id) {
    const row = document.querySelector(`#setup-log-body tr[data-id='${id}']`);
    if (!row) return;

    // [추가] 셋업 기록 모달 창이 전역으로 존재하면 우선 호출 (인라인 수정 방지)
    if (typeof window.openLogForEditing === 'function') {
        window.openLogForEditing(currentPath.site, currentPath.equip, id);
        return;
    }

    const isEditing = row.classList.contains('editing');
    const editBtn = row.querySelector('.btn-edit');

    if (!isEditing) {
        // 다른 행이 수정 중이면 저장하라는 경고
        if (document.querySelector('#setup-log-body tr.editing')) {
            alert('다른 항목을 먼저 저장해주세요.');
            return;
        }

        row.classList.add('editing');
        editBtn.textContent = '✅';
        editBtn.classList.add('btn-editing-active');

        const dateCell = row.querySelector('.log-date');
        const contentCell = row.querySelector('.log-content');
        const workerCell = row.querySelector('.log-worker');

        const currentDate = dateCell.textContent;
        const currentContent = contentCell.textContent;
        const currentWorker = workerCell.textContent;

        dateCell.innerHTML = `<input type="date" class="edit-log-date input-edit-cell" value="${escapeHtml(currentDate)}" onclick="event.stopPropagation()">`;

        const select = document.getElementById('setup-log-select').cloneNode(true);
        select.id = '';
        select.className = 'edit-log-content select-edit-log';
        select.value = currentContent;
        select.setAttribute('onclick', 'event.stopPropagation()');
        contentCell.innerHTML = '';
        contentCell.appendChild(select);

        workerCell.innerHTML = `<input type="text" class="edit-log-worker input-edit-cell" value="${escapeHtml(currentWorker)}" placeholder="작업자" spellcheck="false" onclick="event.stopPropagation()">`;

    } else {
        const newDate = row.querySelector('.edit-log-date').value;
        const newContent = row.querySelector('.edit-log-content').value;
        const newWorker = row.querySelector('.edit-log-worker').value;
        const newMd = newWorker.split(',').filter(Boolean).length.toString(); // [추가]

        if (!newDate || !newContent || !newWorker) {
            alert('날짜, 작업 내용, 작업자는 필수 항목입니다.');
            return;
        }

        const newData = {
            date: newDate,
            content: newContent,
            worker: newWorker,
            md: newMd
        };

        updateSetupLogItem(id, newData);

        renderSetupLogList();
    }
}

function updateSetupLogItem(id, newData) {
    if (!currentPath.site || !currentPath.equip) return;
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};
    if (!data.setupLogs) return;

    const logIndex = data.setupLogs.findIndex(l => l.id === id);
    if (logIndex > -1) {
        data.setupLogs[logIndex] = { ...data.setupLogs[logIndex], ...newData };
        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
        window.syncSetupDataDB(currentPath.site, currentPath.equip, null, data.setupLogs); // [DB 동기화]
        if (typeof addSystemLog === 'function') {
            addSystemLog('UPDATE_SETUP_LOG', currentPath.equip, `LogID: ${id}`);
        }
    }
}

// 6.4 셋업 리스트 불러오기 모달 (Load Setup List Modal)
function setupSetupLoadListModal() {
    const modal = document.getElementById('setup-load-list-modal');
    const closeBtn = document.getElementById('btn-close-load-list');
    const cancelBtn = document.getElementById('btn-cancel-load-list');
    const confirmBtn = document.getElementById('btn-confirm-load-list');
    const siteSelect = document.getElementById('load-list-site-select');

    if (!modal) return;

    const closeModal = () => modal.style.display = 'none';

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateLoadListEquipSelect(siteSelect.value);
        };
    }

    if (confirmBtn) {
        confirmBtn.onclick = loadSetupListFromTarget;
    }
}

function openSetupLoadListModal() {
    if (!currentPath.site || !currentPath.equip) return alert('장비를 선택해주세요.');

    const modal = document.getElementById('setup-load-list-modal');
    const siteSelect = document.getElementById('load-list-site-select');
    const equipSelect = document.getElementById('load-list-equip-select');

    if (!modal || !siteSelect) return;

    // Load Sites
    const data = JSON.parse(localStorage.getItem('device_data')) || {};
    siteSelect.innerHTML = '<option value="">사업장 선택</option>';
    Object.keys(data).forEach(site => {
        const option = document.createElement('option');
        option.value = site;
        option.textContent = site;
        siteSelect.appendChild(option);
    });

    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = true;

    modal.style.display = 'flex';
}

function updateLoadListEquipSelect(site) {
    const equipSelect = document.getElementById('load-list-equip-select');
    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = !site;

    if (!site) return;

    const data = JSON.parse(localStorage.getItem('device_data')) || {};
    const equips = data[site] ? [...data[site]] : [];
    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        option.textContent = parts.length > 1 ? `${parts[0]} (${parts[1]})` : parts[0];
        equipSelect.appendChild(option);
    });
}

function loadSetupListFromTarget() {
    const site = document.getElementById('load-list-site-select').value;
    const equip = document.getElementById('load-list-equip-select').value;

    if (!site || !equip) return alert('불러올 장비를 선택해주세요.');

    if (!confirm('현재 작성된 셋업 리스트가 초기화되고 선택한 장비의 리스트로 대체됩니다.\n계속하시겠습니까?')) return;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const sourceKey = `${site}::${equip}`;
    const sourceData = setupData[sourceKey] || {};
    const sourceDetails = sourceData.setupDetails || [];

    // 현재 장비에 덮어쓰기 (ID는 새로 생성하여 충돌 방지, 상태는 초기화)
    const newDetails = sourceDetails.map((item, index) => ({
        ...item,
        id: Date.now() + index, // 새로운 ID 부여
        completed: false, // 완료 상태 초기화
        date: "", // 완료일 초기화
        startDate: "", // 시작일 초기화
        execStartDate: "", // 실행 시작일 초기화
        delayReason: "" // 지연 사유 초기화
    }));

    const targetKey = `${currentPath.site}::${currentPath.equip}`;
    let targetData = setupData[targetKey] || {};
    targetData.setupDetails = newDetails;
    setupData[targetKey] = targetData;

    localStorage.setItem('setup_data', JSON.stringify(setupData));
    window.syncSetupDataDB(currentPath.site, currentPath.equip, newDetails, null); // [DB 동기화]

    // UI 갱신
    renderSetupDetailList();

    // 불러온 후 자동 저장 및 실행률 갱신
    updateExecutionRate();

    document.getElementById('setup-load-list-modal').style.display = 'none';
    alert('리스트를 불러왔습니다.');
}

// 6.5 셋업 정보 불러오기 모달 (Load Setup Info Modal)
function setupSetupLoadInfoModal() {
    const modal = document.getElementById('setup-load-info-modal');
    const closeBtn = document.getElementById('btn-close-load-info');
    const cancelBtn = document.getElementById('btn-cancel-load-info');
    const confirmBtn = document.getElementById('btn-confirm-load-info');
    const siteSelect = document.getElementById('load-info-site-select');

    if (!modal) return;

    const closeModal = () => modal.style.display = 'none';

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateLoadInfoEquipSelect(siteSelect.value);
        };
    }

    if (confirmBtn) {
        confirmBtn.onclick = loadSetupInfoFromTarget;
    }
}

function openSetupLoadInfoModal() {
    const modal = document.getElementById('setup-load-info-modal');
    const siteSelect = document.getElementById('load-info-site-select');
    const equipSelect = document.getElementById('load-info-equip-select');

    if (!modal || !siteSelect) return;

    // Load Sites
    const data = JSON.parse(localStorage.getItem('device_data')) || {};
    siteSelect.innerHTML = '<option value="">사업장 선택</option>';
    Object.keys(data).forEach(site => {
        const option = document.createElement('option');
        option.value = site;
        option.textContent = site;
        siteSelect.appendChild(option);
    });

    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = true;

    modal.style.display = 'flex';
}

function updateLoadInfoEquipSelect(site) {
    const equipSelect = document.getElementById('load-info-equip-select');
    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = !site;

    if (!site) return;

    const data = JSON.parse(localStorage.getItem('device_data')) || {};
    const equips = data[site] ? [...data[site]] : [];
    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        option.textContent = parts.length > 1 ? `${parts[0]} (${parts[1]})` : parts[0];
        equipSelect.appendChild(option);
    });
}

function loadSetupInfoFromTarget() {
    const site = document.getElementById('load-info-site-select').value;
    const equip = document.getElementById('load-info-equip-select').value;

    if (!site || !equip) return alert('불러올 장비를 선택해주세요.');

    const sourceKey = `details_${site}_${equip}`;
    const sourceData = JSON.parse(localStorage.getItem(sourceKey)) || {};
    const sourceSetup = sourceData.setup || {};

    // 필드 매핑
    const fields = [
        'manager', 'contact', 'email',
        'custManager', 'custContact', 'custEmail'
    ];

    fields.forEach(field => {
        const el = document.getElementById(`setup-modal-${field}`);
        if (el) el.value = sourceSetup[field] || '';
    });

    document.getElementById('setup-load-info-modal').style.display = 'none';
    alert('정보를 불러왔습니다. 저장 버튼을 눌러 반영해주세요.');
}

// [추가] 셋업 일정 초기화 버튼 설정
function setupSetupResetButton() {
    // 톱니바퀴 버튼 찾기 (onclick 속성으로 식별)
    const settingsBtn = document.querySelector('button[onclick*="toggleSetupDetailDeleteMode"]');
    if (settingsBtn && settingsBtn.parentNode) {
        // 이미 버튼이 있는지 확인
        if (document.getElementById('btn-reset-setup-date')) return;

        const resetBtn = document.createElement('button');
        resetBtn.id = 'btn-reset-setup-date';
        resetBtn.className = 'btn-reset';
        resetBtn.textContent = '📅 셋업 일정 초기화';
        resetBtn.style.display = 'none'; // 초기엔 숨김
        resetBtn.onclick = resetSetupDates;

        // 톱니바퀴 버튼 뒤(오른쪽)에 추가
        settingsBtn.parentNode.insertBefore(resetBtn, settingsBtn.nextSibling);

        // [추가] 진행 기준 오늘 맞추기 버튼
        const alignBtn = document.createElement('button');
        alignBtn.id = 'btn-align-setup-today';
        alignBtn.className = 'btn-reset';
        alignBtn.textContent = '📍 진행 기준 오늘 맞추기';
        alignBtn.style.display = 'none';
        alignBtn.style.marginLeft = '5px';
        alignBtn.style.borderColor = '#58a6ff';
        alignBtn.style.color = '#58a6ff';
        alignBtn.onclick = alignSetupScheduleToToday;

        settingsBtn.parentNode.insertBefore(alignBtn, resetBtn.nextSibling);
    }
}

// [추가] 셋업 일정 초기화 로직
function resetSetupDates() {
    if (!currentPath.site || !currentPath.equip) return;

    if (!confirm("현재 장비의 셋업 예정일과 진행 상태를 모두 초기화하시겠습니까?\n(작업일수와 항목 구성은 유지됩니다.)")) return;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};

    if (data.setupDetails) {
        data.setupDetails.forEach(item => {
            item.completed = false;
            item.date = "";
            item.startDate = "";
            item.execStartDate = "";
            item.delayReason = "";
        });

        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
        window.syncSetupDataDB(currentPath.site, currentPath.equip, data.setupDetails, null); // [DB 동기화]

        // UI 갱신
        renderSetupDetailList();
        updateExecutionRate();
        alert("초기화되었습니다.");
    }
}

// [추가] 현재 진행 항목을 오늘 날짜로 자동 정렬
function alignSetupScheduleToToday() {
    if (!currentPath.site || !currentPath.equip) return;

    const rows = Array.from(document.querySelectorAll('#setup-detail-body tr.item-row'));
    if (rows.length === 0) return;

    let activeRow = null;

    // 첫 번째 미완료 항목 찾기
    for (const row of rows) {
        const checkbox = row.querySelector('.detail-complete-checkbox');
        if (checkbox && !checkbox.checked) {
            activeRow = row;
            break;
        }
    }

    if (!activeRow) {
        alert('모든 셋업 항목이 완료되어 진행 중인 항목이 없습니다.');
        return;
    }

    if (!confirm("현재 진행 중인(미완료) 셋업 항목의 시작일을 '오늘'로 맞추고,\n전체 일정을 재계산하시겠습니까?")) return;

    const startInput = activeRow.querySelector('.detail-start-date-input');
    if (startInput) {
        startInput.value = formatLocalDate(new Date());
        
        // 순방향/역방향 계산 수행 후 저장
        if (typeof calculateScheduleForward === 'function') calculateScheduleForward(activeRow, true);
        if (typeof calculateScheduleBackward === 'function') calculateScheduleBackward(activeRow, false);
        
        renderSetupDetailList();
        alert("일정이 오늘 기준으로 재계산되었습니다.");
    }
}

// [추가] 간트뷰 이동 로직
window.moveToGanttView = function () {
    if (!currentPath.site || !currentPath.equip) {
        alert('장비를 선택해주세요.');
        return;
    }

    // 저장되지 않은 변경사항 확인
    if (typeof window.checkUnsavedChanges === 'function' && !window.checkUnsavedChanges()) {
        return;
    }

    // 간트 차트 필터 설정 및 홈 화면 셋업 탭 지정
    const ganttFilter = { site: currentPath.site, equip: currentPath.equip };
    localStorage.setItem('currentGanttFilters', JSON.stringify(ganttFilter));
    localStorage.setItem('lastHomeSection', 'setup');

    // 홈 화면으로 이동
    window.location.href = '/?scrollTo=gantt';
};
