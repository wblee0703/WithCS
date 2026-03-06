/* ==========================================================================
   1. 초기화 및 전역 변수 (Initialization & Globals)
   ========================================================================== */
let selectedSetupLogId = null;
let originalSetupLogMemo = "";
let currentSetupCompletionTarget = null;
let currentExecStartTargetId = null;

// [추가] 공통 함수 폴백 (common.js 누락 대비)
if (typeof window.isHoliday !== 'function') {
    window.isHoliday = function(date) { return false; };
}
if (typeof window.getHolidayName !== 'function') {
    window.getHolidayName = function(year, month, day) { return null; };
}
if (typeof window.addBusinessDays !== 'function') {
    window.addBusinessDays = function(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };
}
if (typeof window.getDragAfterElement !== 'function') {
    window.getDragAfterElement = function(container, y, selector) {
        const draggableElements = [...container.querySelectorAll(selector)];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            return (offset < 0 && offset > closest.offset) ? { offset: offset, element: child } : closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    };
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. 모달 열기 버튼 이벤트 연결
    const loadBtn = document.getElementById('btn-load-setup-list');
    if (loadBtn) {
        loadBtn.addEventListener('click', openSetupLoadListModal);
    }

    const loadInfoBtn = document.getElementById('btn-load-setup-info');
    if (loadInfoBtn) {
        loadInfoBtn.addEventListener('click', openSetupLoadInfoModal);
    }

    // 2. 셋업 일지 입력창 엔터키 이벤트 (업체, 작업자 입력 시 추가)
    const logCompanyInput = document.getElementById('setup-log-company');
    const logWorkerInput = document.getElementById('setup-log-worker');
    if (logCompanyInput) logCompanyInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addSetupLogItem(); });
    if (logWorkerInput) logWorkerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addSetupLogItem(); });

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
        if (selectedSetupLogId !== null && document.getElementById('setup-log-detail-memo').value !== originalSetupLogMemo) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // 4. 셋업 일지 날짜 필터 이벤트
    const filterDateInput = document.getElementById('setup-log-filter-date');
    if (filterDateInput) {
        filterDateInput.addEventListener('input', renderSetupLogList);
    }

    // 5. 셋업 일지 작업 내용 선택 시 자동 입력
    const logSelect = document.getElementById('setup-log-select');
    if (logSelect) {
        logSelect.addEventListener('change', (e) => {
            const content = e.target.value;
            if (!content || !currentPath.site || !currentPath.equip) return;

            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${currentPath.site}::${currentPath.equip}`;
            const data = setupData[equipKey] || {};
            const details = data.setupDetails || [];
            const item = details.find(d => d.content === content);

            if (item) {
                const dateInput = document.getElementById('setup-log-date');
                const companyInput = document.getElementById('setup-log-company');
                const workerInput = document.getElementById('setup-log-worker');
                if (dateInput) dateInput.value = item.date || '';
                if (companyInput) companyInput.value = '위드텍';
                if (workerInput) workerInput.value = item.worker || '';
            }
        });
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
    setupSetupCompletionModal();
    setupSetupExecStartModal();
    setupSetupLoadListModal();
    setupSetupLoadInfoModal();
    setupSetupResetButton(); // [추가] 초기화 버튼 설정
});

// common.js의 checkUnsavedChanges 함수 오버라이드 (페이지 이동 시 체크)
const _originalCheckUnsavedChanges = window.checkUnsavedChanges;
window.checkUnsavedChanges = function() {
    if (typeof _originalCheckUnsavedChanges === 'function') {
        return _originalCheckUnsavedChanges();
    }
    return true;
};

function setupSetupLogResizer() {
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
   2. 메인 렌더링 (Main Rendering)
   ========================================================================== */
function renderDetails() {
    const workspace = document.getElementById('setup-workspace');
    if (!workspace) return;

    // 셋업 진행 세부사항 리스트 로드
    renderSetupDetailList();
    
    // 셋업 일지 작업 내용 선택 옵션 업데이트
    updateSetupLogSelectOptions();

    // 셋업 일지 리스트 로드
    renderSetupLogList();
    
    // 일지 날짜 입력창 오늘 날짜로 초기화
    const logDateInput = document.getElementById('setup-log-date');
    if (logDateInput) logDateInput.value = new Date().toISOString().split('T')[0];

    // 업체 입력창 초기값 '위드텍' 설정
    const logCompanyInput = document.getElementById('setup-log-company');
    if (logCompanyInput) logCompanyInput.value = '위드텍';
}

/* ==========================================================================
   3. 셋업 진행 세부사항 (Setup Detail List)
   ========================================================================== */
function renderSetupDetailList() {
    const tbody = document.getElementById('setup-detail-body');
    if (!tbody || !currentPath.site || !currentPath.equip) return;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};
    
    // 초기 데이터 설정 (기본 항목)
    if (!data.setupDetails) {
        data.setupDetails = [
            { id: Date.now(), category: "장비 반입 및 정위치", content: "장비 도면 부착", startDate: "", estDays: "1", date: "" },
            { id: Date.now() + 1, category: "장비 반입 및 정위치", content: "다이크 설치", startDate: "", estDays: "1", date: "" },
            { id: Date.now() + 2, category: "장비 반입 및 정위치", content: "장비 반입", startDate: "", estDays: "1", date: "" },
            { id: Date.now() + 3, category: "장비 반입 및 정위치", content: "다이크 공사 및 리크센서 설치", startDate: "", estDays: "2", date: "" },
            { id: Date.now() + 4, category: "통신 상태 및 유틸리티", content: "Utility 배관 공사 및 연결", startDate: "", estDays: "5", date: "" },
            { id: Date.now() + 5, category: "통신 상태 및 유틸리티", content: "Utility 턴온", startDate: "", estDays: "1", date: "" },
            { id: Date.now() + 6, category: "통신 상태 및 유틸리티", content: "인터락 Test 및 통신상태 확인 ", startDate: "", estDays: "2", date: "" },
            { id: Date.now() + 7, category: "셋업 평가", content: "분석부 안정화 및 오염제어", startDate: "", estDays: "5", date: "" },
            { id: Date.now() + 8, category: "셋업 평가", content: "Calibration 평가", startDate: "", estDays: "2", date: "" },
            { id: Date.now() + 9, category: "셋업 평가", content: "Sample 측정", startDate: "", estDays: "2", date: "" },
            { id: Date.now() + 10, category: "셋업 평가", content: "신뢰도 평가", startDate: "", estDays: "5", date: "" },
            { id: Date.now() + 11, category: "셋업 완료", content: "셋업 완료", startDate: "", estDays: "0", date: "" }
        ];
        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
    }

    // 편집 모드 확인
    const card = document.getElementById('setup-detail-card');
    const isEditMode = card ? card.classList.contains('edit-mode') : false;

    tbody.innerHTML = '';

    const categories = ["장비 반입 및 정위치", "통신 상태 및 유틸리티", "셋업 평가", "셋업 완료"];
    let foundNextTask = false; // 다음 작업 찾기 플래그 (순차적 실행 버튼 표시용)
    let isPreviousCompleted = true; // 순차적 체크박스 표시를 위한 플래그

    categories.forEach(cat => {
        // 카테고리 헤더 생성
        const headerRow = document.createElement('tr');
        headerRow.className = 'category-header-row';
        headerRow.dataset.category = cat;
        const addBtnStyle = cat === '셋업 완료' ? 'display:none !important;' : '';
        headerRow.innerHTML = `
            <td colspan="6" class="category-header">
                <span class="category-title">${cat}</span>
                <button class="btn-add-category" onclick="addSetupDetailItem('${cat}')" title="항목 추가" style="${addBtnStyle}">+</button>
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

            const isInProgress = item.execStartDate && !item.completed;
            if (isInProgress) {
                tr.classList.add('in-progress');
            }

            const checkedAttr = item.completed ? 'checked' : '';
            
            // 체크박스 표시 조건: 이전 항목 완료 AND (실행 시작됨 OR 완료됨 OR 셋업 완료 단계)
            let showCheckbox = isPreviousCompleted;
            if (showCheckbox && cat !== '셋업 완료') {
                if (!item.execStartDate && !item.completed) {
                    showCheckbox = false;
                }
            }
            const checkboxVisibility = showCheckbox ? '' : 'visibility: hidden;';

            // 완료된 항목은 입력 필드 비활성화 및 색상 변경
            const generalDisabledAttr = item.completed ? 'disabled' : '';
            // 리스트 명(내용)은 완료되었거나 편집 모드가 아닐 때 비활성화
            const contentDisabledAttr = (item.completed || !isEditMode) ? 'disabled' : '';
            const inputColor = item.completed ? '#8b949e' : '#e6edf3';

            // 완료일 입력창 최소값 설정 (실행일 또는 시작일 기준)
            let minDateAttr = '';
            if (item.execStartDate) minDateAttr = `min="${item.execStartDate}"`;
            else if (item.startDate) minDateAttr = `min="${item.startDate}"`;

            const estVal = (item.estDays !== undefined && item.estDays !== null) ? item.estDays : '';
            let estDaysHtml = `<input type="text" class="detail-est-days-input" value="${estVal}" placeholder="0" style="text-align: center; width: 100%; background: transparent; border: none; color: ${inputColor};" ${generalDisabledAttr}>`;
            
            if (cat === '셋업 완료') {
                estDaysHtml = `<button type="button" class="btn-recalc-date" onclick="triggerSetupScheduleCalculation()" style="background: transparent; border: 1px solid #30363d; color: #8b949e; border-radius: 4px; cursor: pointer; padding: 2px 8px; font-size: 11px;">↺</button>`;
            }

            // 체크박스 및 실행 버튼 표시 로직 (5번째 컬럼)
            let actionCellHtml = '';
            const checkboxHtml = `<input type="checkbox" class="detail-complete-checkbox" ${checkedAttr} style="${checkboxVisibility}">`;

            if (cat === '셋업 완료') {
                actionCellHtml = checkboxHtml;
            } else {
                if (item.completed) {
                    actionCellHtml = `<input type="checkbox" class="detail-complete-checkbox" checked>`;
                } else if (item.execStartDate) {
                    actionCellHtml = `<input type="checkbox" class="detail-complete-checkbox">`;
                } else {
                    // 미완료 & 미실행 상태
                    if (isPreviousCompleted && !foundNextTask) {
                        foundNextTask = true; // 실행 가능한 첫 번째 작업
                        actionCellHtml = `<div style="display:flex; justify-content:center;"><button class="btn-play-sm" onclick="startSetupTask(${item.id})">▶</button><input type="checkbox" class="detail-complete-checkbox" style="display:none;"></div>`;
                    } else {
                        actionCellHtml = `<input type="checkbox" class="detail-complete-checkbox" style="visibility: hidden;">`;
                    }
                }
            }

            tr.innerHTML = `
                <td>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <input type="text" class="detail-content-input" value="${escapeHtml(item.content)}" placeholder="항목 입력" style="flex:1; color: ${inputColor};" ${contentDisabledAttr}>
                    </div>
                </td>
                <td style="text-align: center;">${estDaysHtml}</td>
                <td><input type="date" class="detail-start-date-input" value="${item.startDate || ''}" style="color: ${inputColor};" ${generalDisabledAttr}></td>
                <td><input type="date" class="detail-date-input" value="${item.date}" style="color: ${inputColor};" ${generalDisabledAttr} ${minDateAttr}></td>
                <td style="text-align: center;">${actionCellHtml}</td>
                <td style="text-align: center;"><button class="btn-del-sm" onclick="deleteSetupDetailItem(${item.id})">✕</button></td>
            `;
            tr.addEventListener('dragstart', () => tr.classList.add('dragging'));
            // 드래그 종료 시 자동 저장
            tr.addEventListener('dragend', () => { tr.classList.remove('dragging'); saveSetupDetails(); });
            
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
            
            // 다음 항목을 위해 현재 항목의 완료 상태 저장
            isPreviousCompleted = item.completed;
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
            <td><input type="text" class="detail-est-days-input" value="" placeholder="0" style="text-align: center; width: 100%; background: transparent; border: none; color: #e6edf3;"></td>
            <td><input type="date" class="detail-start-date-input" value=""></td>
            <td><input type="date" class="detail-date-input" value=""></td>
            <td style="text-align: center;"><input type="checkbox" class="detail-complete-checkbox" style="visibility: hidden;"></td>
        <td style="text-align: center;"><button class="btn-del-sm" onclick="deleteSetupDetailItem(${id})">✕</button></td>
    `;
    tr.addEventListener('dragstart', () => tr.classList.add('dragging'));
    tr.addEventListener('dragend', () => { tr.classList.remove('dragging'); saveSetupDetails(); });
    
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

    // 새로 추가된 항목의 실행 버튼/체크박스 표시 여부 결정
    const prevRow = tr.previousElementSibling;
    const checkboxEl = tr.querySelector('.detail-complete-checkbox');
    const actionTd = tr.cells[4];

    if (prevRow && prevRow.classList.contains('item-row')) {
        const prevCheckbox = prevRow.querySelector('.detail-complete-checkbox');
        if (prevCheckbox && prevCheckbox.checked) {
            // 이전 항목이 완료되었으면 실행 버튼 표시
            actionTd.innerHTML = `<div style="display:flex; justify-content:center;"><button class="btn-play-sm" onclick="startSetupTask(${id})">▶</button><input type="checkbox" class="detail-complete-checkbox" style="display:none;"></div>`;
            attachSetupCheckboxListener(tr); // 버튼과 함께 생성된 숨겨진 체크박스에 리스너 다시 연결
        } else {
            // 이전 항목 미완료 시 체크박스 숨김
            checkboxEl.style.visibility = 'hidden';
        }
    }

    saveSetupDetails(); // 항목 추가 후 자동 저장
}

function deleteSetupDetailItem(id) {
    const row = document.querySelector(`#setup-detail-body tr[data-id="${id}"]`);
    if (row) {
        row.remove();
        saveSetupDetails(); // 삭제 후 자동 저장
    }
}

function toggleSetupDetailDeleteMode(btn) {
    const card = document.getElementById('setup-detail-card');
    if (card) {
        saveSetupDetails(); // 모드 전환 전 저장
        card.classList.toggle('edit-mode');
        btn.classList.toggle('active');
        
        renderSetupDetailList(); // 리스트 재렌더링 (입력창 활성/비활성 적용)

        const isEditMode = card.classList.contains('edit-mode');

        // 리스트 불러오기 버튼 토글
        const loadBtn = document.getElementById('btn-load-setup-list');
        if (loadBtn) loadBtn.style.display = isEditMode ? 'block' : 'none';

        // [추가] 초기화 버튼 토글
        const resetBtn = document.getElementById('btn-reset-setup-date');
        if (resetBtn) resetBtn.style.display = isEditMode ? 'inline-block' : 'none';
    }
}

function saveSetupDetails() {
    if (!currentPath.site || !currentPath.equip) return alert('장비를 선택해주세요.');
    
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

        const checkbox = row.querySelector('.detail-complete-checkbox');
        const completed = checkbox ? checkbox.checked : false;
        const content = row.querySelector('.detail-content-input').value;
        const date = row.querySelector('.detail-date-input').value;
        const startDate = row.querySelector('.detail-start-date-input').value;
        const estInput = row.querySelector('.detail-est-days-input');
        const estDays = estInput ? estInput.value : "0";
        const delayReason = row.dataset.delayReason || "";
        const execStartDate = row.dataset.execStartDate || "";
        newDetails.push({ id, completed, content, date, startDate, estDays, category: currentCategory, delayReason, execStartDate });
        
        // 실행률 계산용 카운트
        totalItems++;
        if (completed) completedItems++;
    });

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};
    data.setupDetails = newDetails;
    setupData[equipKey] = data;
    localStorage.setItem('setup_data', JSON.stringify(setupData));

    // 세부사항이 변경되었으므로 일지 입력창의 옵션도 갱신
    updateSetupLogSelectOptions();
    
    // 실행률 업데이트
    updateExecutionRate(completedItems, totalItems);
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
        if (rate === 100) rateEl.style.color = '#3fb950'; // Green
        else if (rate > 0) rateEl.style.color = '#e3b341'; // Yellow/Orange
        else rateEl.style.color = '#8b949e'; // Gray
    }
}

// 체크박스 이벤트 리스너 (체크 해제 시 실행 버튼 복구 로직 포함)
function attachSetupCheckboxListener(row) {
    const checkbox = row.querySelector('.detail-complete-checkbox');
    const dateInput = row.querySelector('.detail-date-input');
    if (!checkbox) return;

    checkbox.addEventListener('click', (e) => {
        if (!checkbox.checked) {
            if (!confirm("완료 상태를 해제하시겠습니까?\n이후 단계의 완료 상태도 함께 초기화됩니다.")) {
                e.preventDefault();
                return;
            }
            dateInput.value = '';
            delete row.dataset.delayReason;
            delete row.dataset.execStartDate;
            row.classList.remove('in-progress');

            // 입력 필드 활성화 (체크 해제 시 수정 가능하도록)
            const inputs = row.querySelectorAll('input[type="text"], input[type="date"]');
            inputs.forEach(input => {
                input.disabled = false;
                input.style.color = '#e6edf3';
            });

            // 체크 해제 시 실행 버튼 생성 (셋업 완료 항목 제외)
            if (row.dataset.category !== '셋업 완료') {
                const actionTd = row.cells[4];
                const id = row.dataset.id;
                actionTd.innerHTML = `<div style="display:flex; justify-content:center;"><button class="btn-play-sm" onclick="startSetupTask(${id})">▶</button><input type="checkbox" class="detail-complete-checkbox" style="display:none;"></div>`;
                // 새 체크박스에 리스너 다시 연결
                attachSetupCheckboxListener(row);
            }

            let nextRow = row.nextElementSibling;
            while (nextRow) {
                if (nextRow.classList.contains('item-row')) {
                    const nextCheckbox = nextRow.querySelector('.detail-complete-checkbox');
                    const nextDateInput = nextRow.querySelector('.detail-date-input');
                    if (nextCheckbox) {
                        nextCheckbox.checked = false;
                        nextCheckbox.style.visibility = 'hidden';
                    }
                    if (nextDateInput) nextDateInput.value = '';
                    delete nextRow.dataset.delayReason;
                    delete nextRow.dataset.execStartDate;
                    nextRow.classList.remove('in-progress');
                }
                nextRow = nextRow.nextElementSibling;
            }
        } else {
            e.preventDefault();
            openSetupCompletionModal(row.dataset.id, row);
            return;
        }
        saveSetupDetails(); // 체크박스 변경 시 자동 저장
    });
}

// 셋업 세부사항 현재 데이터 가져오기 (변경 감지용)
function getCurrentSetupDetailsData() {
    const rows = document.querySelectorAll('#setup-detail-body tr');
    const details = [];
    let currentCategory = "장비 반입 및 정위치"; // 기본 카테고리

    rows.forEach(row => {
        if (row.classList.contains('category-header-row')) {
            currentCategory = row.dataset.category;
            return;
        }

        const id = parseInt(row.dataset.id);
        if (isNaN(id)) return;

        const checkbox = row.querySelector('.detail-complete-checkbox');
        const completed = checkbox ? checkbox.checked : false;
        const content = row.querySelector('.detail-content-input').value;
        const date = row.querySelector('.detail-date-input').value;
        const startDate = row.querySelector('.detail-start-date-input').value;
        const estInput = row.querySelector('.detail-est-days-input');
        const estDays = estInput ? estInput.value : "0";
        const delayReason = row.dataset.delayReason || "";
        const execStartDate = row.dataset.execStartDate || "";
        details.push({ id, completed, content, date, startDate, estDays, category: currentCategory, delayReason, execStartDate });
    });
    return details;
}

/* ==========================================================================
   4. 일정 계산 (Schedule Calculation)
   ========================================================================== */
// 로컬 날짜 포맷팅 함수 (YYYY-MM-DD)
function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// [추가] 휴일 체크 및 알림 함수
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

window.calculateSetupSchedule = function(targetDateStr) {
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
    saveSetupDetails(); // 계산 후 자동 저장
};

function calculateScheduleForward(startRow) {
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
    saveSetupDetails(); // 계산 후 자동 저장
}

function calculateScheduleBackward(startRow) {
    const rows = Array.from(document.querySelectorAll('#setup-detail-body tr.item-row'));
    const startIndex = rows.indexOf(startRow);
    if (startIndex <= 0) return; // 첫 번째 항목이거나 찾을 수 없으면 종료

    let nextTaskStartDate = null;
    
    // 변경된 행(기준점)의 시작일 가져오기
    const startInput = startRow.querySelector('.detail-start-date-input');
    if (startInput && startInput.value) {
        const [y, m, d] = startInput.value.split('-').map(Number);
        nextTaskStartDate = new Date(y, m - 1, d);
    } else {
        return;
    }

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
            if (isNaN(estDays) || estDays <= 0) estDays = 1; // [수정] 최소 1일 보장
            // 현재 행 완료일 = 다음 행 시작일 - 1일 (영업일 기준)
            const currentEndDate = window.addBusinessDays(nextTaskStartDate, -1);
            // 현재 행 시작일 = 현재 행 완료일 - (작업일수 - 1)
            const currentStartDate = window.addBusinessDays(currentEndDate, -(estDays - 1));
            
            rowStartInput.value = formatLocalDate(currentStartDate);
            
            // 다음 반복(더 위쪽)을 위해 기준 날짜 갱신
            nextTaskStartDate = currentStartDate;
        }
    }
    saveSetupDetails(); // 계산 후 자동 저장
}

window.triggerSetupScheduleCalculation = function() {
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

/* ==========================================================================
   5. 셋업 일지 (Setup Logs)
   ========================================================================== */
function updateSetupLogSelectOptions() {
    const select = document.getElementById('setup-log-select');
    if (!select || !currentPath.site || !currentPath.equip) return;
    
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    const data = setupData[equipKey] || {};
    const details = data.setupDetails || [];

    select.innerHTML = '<option value="">작업 내용 선택</option>';
    details.forEach(item => {
        const option = document.createElement('option');
        option.value = item.content;
        option.textContent = item.content;
        select.appendChild(option);
    });
}

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
            (l.memo && l.memo.toLowerCase().includes(filterText))
        );
    }

    // 날짜 내림차순 정렬
    filteredLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = filteredLogs.map(item => {
        // [수정] [지연] 태그 주황색 표시
        const contentHtml = (escapeHtml(item.content) || '-').replace(/\[지연\]/g, '<span style="color: #f0883e; font-weight: bold;">[지연]</span>');
        
        return `<tr data-id="${item.id}" onclick="selectSetupLog(${item.id})" class="${selectedSetupLogId === item.id ? 'active-log' : ''}" style="cursor: pointer;">
            <td class="log-date">${item.date}</td>
            <td class="log-content">${contentHtml}</td>
            <td class="log-company">${escapeHtml(item.company) || '-'}</td>
            <td class="log-worker">${escapeHtml(item.worker)}</td>
            <td class="manage-col" style="text-align: center;">
                <button class="btn-edit" onclick="event.stopPropagation(); toggleSetupLogEdit(${item.id})">✏️</button>
                <button class="btn-del-sm" onclick="event.stopPropagation(); deleteSetupLogItem(${item.id})">✕</button>
            </td>
        </tr>
    `}).join('');
}

function addSetupLogItem() {
    if (!currentPath.site || !currentPath.equip) return alert('장비를 선택해주세요.');
    
    const dateInput = document.getElementById('setup-log-date');
    const workerInput = document.getElementById('setup-log-worker');
    const select = document.getElementById('setup-log-select');
    const companyInput = document.getElementById('setup-log-company');
    const date = dateInput.value;
    const worker = workerInput.value.trim();
    const content = select.value;
    const company = companyInput ? companyInput.value.trim() : '';

    if (!date || !worker || !content) return alert('날짜, 작업 내용, 작업자를 모두 입력해주세요.');

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    let data = setupData[equipKey] || {};
    if (!data.setupLogs) data.setupLogs = [];
    
    data.setupLogs.push({ id: Date.now(), date: date, worker: worker, content: content, company: company, memo: "" });
    setupData[equipKey] = data;
    localStorage.setItem('setup_data', JSON.stringify(setupData));
    
    workerInput.value = ''; // 작업자 입력창 초기화
    select.value = ''; // 선택창 초기화
    if (companyInput) companyInput.value = '위드텍';
    renderSetupLogList();
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
        
        if (selectedSetupLogId === id) {
            selectedSetupLogId = null;
            originalSetupLogMemo = "";
            document.getElementById('setup-log-detail-memo').value = "";
        }
        renderSetupLogList();
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
        editBtn.style.backgroundColor = '#238636';

        const dateCell = row.querySelector('.log-date');
        const contentCell = row.querySelector('.log-content');
        const companyCell = row.querySelector('.log-company');
        const workerCell = row.querySelector('.log-worker');

        const currentDate = dateCell.textContent;
        const currentContent = contentCell.textContent;
        const currentCompany = companyCell.textContent === '-' ? '' : companyCell.textContent;
        const currentWorker = workerCell.textContent;

        dateCell.innerHTML = `<input type="date" class="edit-log-date" value="${escapeHtml(currentDate)}" onclick="event.stopPropagation()">`;
        
        const select = document.getElementById('setup-log-select').cloneNode(true);
        select.id = '';
        select.className = 'edit-log-content';
        select.value = currentContent;
        select.setAttribute('onclick', 'event.stopPropagation()');
        contentCell.innerHTML = '';
        contentCell.appendChild(select);

        companyCell.innerHTML = `<input type="text" class="edit-log-company" value="${escapeHtml(currentCompany)}" placeholder="업체" spellcheck="false" onclick="event.stopPropagation()">`;
        workerCell.innerHTML = `<input type="text" class="edit-log-worker" value="${escapeHtml(currentWorker)}" placeholder="작업자" spellcheck="false" onclick="event.stopPropagation()">`;

    } else {
        const newDate = row.querySelector('.edit-log-date').value;
        const newContent = row.querySelector('.edit-log-content').value;
        const newCompany = row.querySelector('.edit-log-company').value;
        const newWorker = row.querySelector('.edit-log-worker').value;

        if (!newDate || !newContent || !newWorker) {
            alert('날짜, 작업 내용, 작업자는 필수 항목입니다.');
            return;
        }

        const newData = {
            date: newDate,
            content: newContent,
            company: newCompany,
            worker: newWorker
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
        if (typeof addSystemLog === 'function') {
            addSystemLog('UPDATE_SETUP_LOG', currentPath.equip, `LogID: ${id}`);
        }
    }
}

/* ==========================================================================
   6. 모달 관리 (Modals)
   ========================================================================== */

// 6.1 장비 정보 팝업 관리
function openSetupEquipModal() {
    // common.js의 currentPath 사용
    const { site, equip } = currentPath;
    if (!site || !equip) return alert('장비를 선택해주세요.');
    const modal = document.getElementById('setup-equip-modal');
    if (!modal) return;

    // 데이터 로드
    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const setup = data.setup || {};
    const parts = equip.split('::');

    // 기본 정보 (Read-only)
    document.getElementById('setup-modal-site').value = site;
    document.getElementById('setup-modal-equip').value = parts[0];
    document.getElementById('setup-modal-serial').value = parts.length > 1 ? parts[1] : '';

    // 상세 정보 필드 매핑
    const fields = [
        'custEquipName', 'building', 'floor', 'detailLoc',
        'manager', 'contact', 'email',
        'custManager', 'custContact', 'custEmail'
    ];

    fields.forEach(field => {
        const el = document.getElementById(`setup-modal-${field}`);
        if (el) el.value = setup[field] || '';
    });

    modal.style.display = 'flex';
}

function saveSetupEquipModal() {
    const { site, equip } = currentPath;
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    if (!data.setup) data.setup = {};

    const fields = [
        'custEquipName', 'building', 'floor', 'detailLoc',
        'manager', 'contact', 'email',
        'custManager', 'custContact', 'custEmail'
    ];
    fields.forEach(field => {
        const el = document.getElementById(`setup-modal-${field}`);
        if (el) data.setup[field] = el.value;
    });

    localStorage.setItem(key, JSON.stringify(data));

    // 시스템 로그 기록 (common.js 함수 사용)
    if (typeof addSystemLog === 'function') {
        addSystemLog('UPDATE_SETUP', equip, '장비 정보 수정 (Setup Page)');
    }

    alert('저장되었습니다.');
    document.getElementById('setup-equip-modal').style.display = 'none';
}

// 6.2 셋업 완료 등록 모달 (Setup Completion Modal)
function setupSetupCompletionModal() {
    const modal = document.getElementById('setup-completion-modal');
    const closeBtn = document.getElementById('btn-close-setup-completion');
    const saveBtn = document.getElementById('btn-save-setup-completion');
    const dateInput = document.getElementById('setup-complete-date');
    const startDateInput = document.getElementById('setup-start-date');
    const checkbox = document.getElementById('setup-complete-checkbox');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    
    if (saveBtn) saveBtn.onclick = saveSetupCompletion;

    if (dateInput) {
        dateInput.addEventListener('change', checkSetupDelayStatus);
        // 완료일 입력 여부에 따라 체크박스 제어
        const updateCheckboxState = () => {
            if (checkbox) {
                if (!dateInput.value) {
                    checkbox.checked = false;
                    checkbox.disabled = true;
                } else {
                    checkbox.disabled = false;
                    if (!checkbox.checked) checkbox.checked = true; // [추가] 날짜 입력 시 자동 체크
                }
            }
        };
        dateInput.addEventListener('input', updateCheckboxState);
        dateInput.addEventListener('change', updateCheckboxState);
    }
    if (startDateInput) {
        startDateInput.addEventListener('change', checkSetupDelayStatus);
        // 시작일 변경 시 완료일의 최소 날짜도 변경 (시작일 이전 선택 불가)
        startDateInput.addEventListener('change', (e) => {
            if (dateInput) dateInput.min = e.target.value;
        });
    }
}

function openSetupCompletionModal(id, tr) {
    const modal = document.getElementById('setup-completion-modal');
    if (!modal) return;

    currentSetupCompletionTarget = { id, tr };

    // [추가] 데이터 기반 완료 여부 확인 (DOM 상태 의존성 제거하여 정확도 향상)
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${currentPath.site}::${currentPath.equip}`;
    const data = setupData[equipKey] || {};
    const task = data.setupDetails ? data.setupDetails.find(t => t.id == id) : null;
    const isAlreadyCompleted = task ? task.completed : false;

    // 작업 일수 표시
    const estInput = tr.querySelector('.detail-est-days-input');
    if (tr.dataset.category === '셋업 완료') {
        document.getElementById('setup-est-days').value = '1일';
    } else if (estInput) {
        document.getElementById('setup-est-days').value = (estInput.value || '0') + '일';
    }

    // 이전 작업 완료일 찾기 (최소 선택 가능일)
    let minDate = "";
    let prevRow = tr.previousElementSibling;
    while (prevRow) {
        if (!prevRow.classList.contains('category-header-row')) {
            const prevCheckbox = prevRow.querySelector('.detail-complete-checkbox');
            const prevDateInput = prevRow.querySelector('.detail-date-input');
            if (prevCheckbox && prevCheckbox.checked && prevDateInput && prevDateInput.value) {
                minDate = prevDateInput.value;
                break;
            }
        }
        prevRow = prevRow.previousElementSibling;
    }

    // 시작일 설정
    const startDateInput = document.getElementById('setup-start-date');
    const trStartDateInput = tr.querySelector('.detail-start-date-input');
    // 실행일(execStartDate)이 있으면 우선 사용, 없으면 계획 시작일 사용
    const execStartDate = tr.dataset.execStartDate;

    if (startDateInput) {
        if (execStartDate) startDateInput.value = execStartDate;
        else if (trStartDateInput) startDateInput.value = trStartDateInput.value;
    }

    const dateInput = document.getElementById('setup-complete-date');
    
    // 완료일의 최소값은 시작일로 설정 (시작일이 없으면 이전 작업 완료일 사용)
    if (startDateInput && startDateInput.value) {
        dateInput.min = startDateInput.value;
    } else {
        dateInput.min = minDate;
    }
    
    const trDateInput = tr.querySelector('.detail-date-input');
    if (trDateInput && trDateInput.value) {
        dateInput.value = trDateInput.value;
    } else {
        // 완료일 초기값: 시작일 + (작업일수 - 1) 계산 (영업일 기준)
        const sDateVal = startDateInput.value;
        const estVal = document.getElementById('setup-est-days').value;
        const estDays = parseInt(estVal) || 0;

        if (sDateVal && estDays > 0) {
            const [y, m, d] = sDateVal.split('-').map(Number);
            const sDate = new Date(y, m - 1, d);
            dateInput.value = formatLocalDate(window.addBusinessDays(sDate, estDays - 1));
        } else {
            dateInput.value = formatLocalDate(new Date()); // 기본값 오늘 (Local)
        }
        if (minDate && dateInput.value < minDate) dateInput.value = minDate;
    }

    // [추가] 계획 종료일 계산 및 저장 (지연 판단 기준: 계획 시작일 + 작업일수)
    const trEstInput = tr.querySelector('.detail-est-days-input');
    let planEndDateStr = '';

    if (trStartDateInput && trStartDateInput.value) {
        const [y, m, d] = trStartDateInput.value.split('-').map(Number);
        const estDays = parseInt(trEstInput ? trEstInput.value : '1') || 1;
        const daysToAdd = estDays > 0 ? estDays - 1 : 0;
        const pEnd = window.addBusinessDays(new Date(y, m - 1, d), daysToAdd);
        
        const py = pEnd.getFullYear();
        const pm = String(pEnd.getMonth() + 1).padStart(2, '0');
        const pd = String(pEnd.getDate()).padStart(2, '0');
        planEndDateStr = `${py}-${pm}-${pd}`;
    }

    let planEndInput = document.getElementById('setup-plan-end-date');
    if (!planEndInput) {
        planEndInput = document.createElement('input');
        planEndInput.type = 'hidden';
        planEndInput.id = 'setup-plan-end-date';
        modal.querySelector('.modal-body').appendChild(planEndInput);
    }
    planEndInput.value = planEndDateStr;

    document.getElementById('setup-delay-reason').value = tr.dataset.delayReason || "";

    // [추가] 셋업 이력 입력창 초기화
    const logInput = document.getElementById('setup-setup-log-content');
    if (logInput) logInput.value = '';
    
    const companyInput = document.getElementById('setup-setup-log-company');
    if (companyInput) companyInput.value = '위드텍'; // 기본값

    const workerInput = document.getElementById('setup-setup-log-worker');
    if (workerInput) workerInput.value = sessionStorage.getItem('userId') || ''; // 기본값
    
    // 완료일 유무에 따라 체크박스 상태 설정
    const checkbox = document.getElementById('setup-complete-checkbox');
    if (checkbox) {
        if (!dateInput.value) {
            checkbox.checked = false;
            checkbox.disabled = true;
        } else {
            checkbox.disabled = false;
            checkbox.checked = true; // [수정] 팝업 오픈 시 완료 체크 기본 활성화
        }
    }

    // [추가] 이미 완료된 작업인 경우 UI 제어 (이력 숨김 및 수정 방지)
    const logContainer = document.getElementById('setup-setup-log-container');
    if (logContainer) logContainer.style.display = isAlreadyCompleted ? 'none' : 'block';

    const inputsToDisable = [
        'setup-start-date', 'setup-complete-date', 'setup-delay-reason',
        'setup-setup-log-company', 'setup-setup-log-worker', 'setup-setup-log-content'
    ];
    inputsToDisable.forEach(inputId => {
        const el = document.getElementById(inputId);
        if (el) el.disabled = isAlreadyCompleted;
    });
    
    checkSetupDelayStatus();
    modal.style.display = 'flex';
}

function checkSetupDelayStatus() {
    if (!currentSetupCompletionTarget) return;
    
    const tr = currentSetupCompletionTarget.tr;
    const planEndDateInput = document.getElementById('setup-plan-end-date'); // [수정] 계획 종료일 기준
    const completeDateInput = document.getElementById('setup-complete-date');
    const reasonContainer = document.getElementById('setup-delay-reason-container');

    if (planEndDateInput && planEndDateInput.value && completeDateInput.value) {
        const planEndDate = new Date(planEndDateInput.value);
        const completeDate = new Date(completeDateInput.value);

        // 시간 초기화
        planEndDate.setHours(0,0,0,0);
        completeDate.setHours(0,0,0,0);

        if (completeDate > planEndDate) {
            reasonContainer.style.display = 'block';
            return;
        }
    }
    reasonContainer.style.display = 'none';
}

function saveSetupCompletion() {
    if (!currentSetupCompletionTarget) return;

    const dateInput = document.getElementById('setup-complete-date');
    const startDateInput = document.getElementById('setup-start-date');
    const reasonInput = document.getElementById('setup-delay-reason');
    const reasonContainer = document.getElementById('setup-delay-reason-container');
    const completedCheckbox = document.getElementById('setup-complete-checkbox');
    
    // [추가] 로그 입력값 가져오기
    const logContentEl = document.getElementById('setup-setup-log-content');
    const logContent = logContentEl ? logContentEl.value.trim() : '';
    const logCompany = document.getElementById('setup-setup-log-company') ? document.getElementById('setup-setup-log-company').value.trim() : '위드텍';
    const logWorker = document.getElementById('setup-setup-log-worker') ? document.getElementById('setup-setup-log-worker').value.trim() : '';

    const isCompleted = completedCheckbox.checked;

    if (isCompleted) {
        if (!dateInput.value) return alert("완료일을 선택해주세요.");
        
        // 완료일 유효성 검사 (시작일보다 이전 불가)
        if (startDateInput.value && dateInput.value < startDateInput.value) {
            return alert("완료일은 시작일보다 빠를 수 없습니다.");
        }

        if (reasonContainer.style.display !== 'none' && !reasonInput.value.trim()) {
            return alert("지연 사유를 입력해주세요.");
        }
    }

    const tr = currentSetupCompletionTarget.tr;
    const wasCompleted = tr.querySelector('.detail-complete-checkbox').checked; // 기존 상태
    tr.querySelector('.detail-complete-checkbox').checked = isCompleted;
    
    // 팝업의 시작일은 실행 시작일이므로, 계획 시작일(startDate)은 변경하지 않고 실행 시작일(execStartDate)만 업데이트
    if (startDateInput.value) {
        tr.dataset.execStartDate = startDateInput.value;
    }

    // 셋업 완료 항목인 경우, 실행 시작일을 완료일과 동일하게 설정 (1일짜리 실행 바 표시)
    if (tr.dataset.category === '셋업 완료' && isCompleted) {
        tr.dataset.execStartDate = dateInput.value;
    }

    const delayReason = reasonInput.value.trim();

    if (isCompleted) {
        tr.querySelector('.detail-date-input').value = dateInput.value;
        tr.dataset.delayReason = delayReason;
    } else {
        tr.querySelector('.detail-date-input').value = '';
        delete tr.dataset.delayReason;
    }

    // [추가] 셋업 이력(일지) 자동 등록
    // 완료 체크 시 혹은 내용이 있을 때 저장 (단, 이미 완료된 작업은 중복 저장 방지)
    if ((isCompleted && !wasCompleted) || (logContent && !wasCompleted)) {
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const equipKey = `${currentPath.site}::${currentPath.equip}`;
        let data = setupData[equipKey] || {};
        if (!data.setupLogs) data.setupLogs = [];

        const taskContent = tr.querySelector('.detail-content-input').value;
        let displayContent = taskContent || '작업 내용 없음';
        let finalMemo = logContent;

        // 지연 사유가 있으면 셋업 일지에 표시
        if (delayReason) {
            displayContent = `[지연] ${displayContent}`;
            if (finalMemo) finalMemo += `\n\n[지연 사유]\n${delayReason}`;
            else finalMemo = `[지연 사유]\n${delayReason}`;
        }

        data.setupLogs.push({
            id: Date.now(),
            date: isCompleted ? dateInput.value : formatLocalDate(new Date()),
            worker: logWorker || sessionStorage.getItem('userId') || '',
            content: displayContent,
            company: logCompany || '위드텍',
            memo: finalMemo
        });
        
        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
        
        // 일지 리스트 갱신
        renderSetupLogList();
    }
    
    document.getElementById('setup-completion-modal').style.display = 'none';

    // 변경 사항 저장 및 리스트 갱신 (다음 버튼 표시를 위해 필수)
    saveSetupDetails();
    renderSetupDetailList();
}

// 6.3 실행 시작일 설정 모달 (Setup Execution Start Modal)
function setupSetupExecStartModal() {
    const modal = document.getElementById('setup-exec-start-modal');
    const closeBtn = document.getElementById('btn-close-setup-exec-start');
    const saveBtn = document.getElementById('btn-save-setup-exec-start');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    if (saveBtn) saveBtn.onclick = saveSetupExecStart;
}

function openSetupExecStartModal(id) {
    const modal = document.getElementById('setup-exec-start-modal');
    if (!modal) return;

    currentExecStartTargetId = id;
    const dateInput = document.getElementById('setup-exec-start-date');
    
    // 기본값 계산: 이전 작업 완료일 다음날 (영업일 기준)
    let defaultDate = formatLocalDate(new Date());
    
    const details = getCurrentSetupDetailsData();
    const currentIndex = details.findIndex(item => item.id === id);
    
    if (currentIndex > 0) {
        const prevTask = details[currentIndex - 1];
        if (prevTask.completed && prevTask.date) {
            const [y, m, d] = prevTask.date.split('-').map(Number);
            const prevDate = new Date(y, m - 1, d);
            defaultDate = formatLocalDate(window.addBusinessDays(prevDate, 1));
        }
    } else if (currentIndex === 0) {
        // 첫 번째 항목은 예정일을 기본값으로 설정
        if (details[0].startDate) defaultDate = details[0].startDate;
    }
    
    dateInput.value = defaultDate;
    modal.style.display = 'flex';
}

function startSetupTask(id) {
    openSetupExecStartModal(id);
}

function saveSetupExecStart() {
    if (!currentExecStartTargetId) return;
    
    const dateInput = document.getElementById('setup-exec-start-date');
    const execDate = dateInput.value;

    if (!execDate) return alert("시작일을 선택해주세요.");

    const row = document.querySelector(`#setup-detail-body tr[data-id="${currentExecStartTargetId}"]`);
    if (row) {
        row.dataset.execStartDate = execDate;
        saveSetupDetails(); // Auto save
        renderSetupDetailList(); // Re-render to update UI
    }
    
    document.getElementById('setup-exec-start-modal').style.display = 'none';
    currentExecStartTargetId = null;
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
    const data = JSON.parse(localStorage.getItem('withtech_data')) || {};
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

    const data = JSON.parse(localStorage.getItem('withtech_data')) || {};
    const equips = data[site] || [];
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
    
    // UI 갱신
    renderSetupDetailList();
    updateSetupLogSelectOptions();
    
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
    const data = JSON.parse(localStorage.getItem('withtech_data')) || {};
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

    const data = JSON.parse(localStorage.getItem('withtech_data')) || {};
    const equips = data[site] || [];
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
        
        // 톱니바퀴 버튼 앞에 추가
        settingsBtn.parentNode.insertBefore(resetBtn, settingsBtn);
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
        
        // UI 갱신
        renderSetupDetailList();
        updateExecutionRate();
        alert("초기화되었습니다.");
    }
}
