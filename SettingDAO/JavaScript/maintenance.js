/* ==========================================================================
   1. 초기화 및 이벤트 리스너 (Initialization)
   ========================================================================== */
// [추가] 공통 함수 폴백 (common.js 누락 대비)
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

// [추가] escapeHtml 함수 폴백 (common.js 누락 또는 로드 실패 대비)
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function(text) {
        if (text === null || text === undefined) {
            return '';
        }
        return text.toString()
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    };
}

document.addEventListener('DOMContentLoaded', () => {
    const initMaint = () => {
        setupMaintenanceEvents();
        setupLogEvents();
        setupUIEvents();
        setupSpecialNoteEvents();
        setupPageProtection();
        setupFileEvents(); // 파일 이벤트 초기화

        // 모달 초기화
        setupMaintLoadListModal();
    };

    if (window.isDataLoaded) {
        initMaint();
    } else {
        window.addEventListener('DataLoaded', initMaint);
    }
});

function setupMaintenanceEvents() {
    const maintTypeButtons = document.querySelectorAll('#maint-type-toggle button');
    const maintPeriodInput = document.getElementById('maint-period');

    if (maintTypeButtons.length > 0 && maintPeriodInput) {
        maintTypeButtons.forEach(btn => {
            btn.onclick = () => {
                maintTypeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // BM일 때 입력창 비활성화
                if (btn.dataset.type === 'BM') {
                    maintPeriodInput.disabled = true;
                    maintPeriodInput.value = '';
                    maintPeriodInput.classList.add('input-disabled');
                    maintPeriodInput.placeholder = 'BM은 주기 없음';
                } else {
                    maintPeriodInput.disabled = false;
                    maintPeriodInput.classList.remove('input-disabled');
                    maintPeriodInput.placeholder = '주기(일)';
                }

                // [추가] 유지관리 물품 항목 옵션 갱신
                if (typeof updateMaintContentOptions === 'function') updateMaintContentOptions();
            };
        });
    }

    const maintAddBtn = document.getElementById('maint-add-btn') || document.getElementById('maint-reg-btn');
    if (maintAddBtn) maintAddBtn.onclick = addDetailItem;

    const maintLoadBtn = document.getElementById('btn-load-maint-list');
    if (maintLoadBtn) {
        maintLoadBtn.addEventListener('click', openMaintLoadListModal);
    }

    const maintDateInput = document.getElementById('maint-date');
    if (maintDateInput) maintDateInput.value = new Date().toISOString().substring(0, 10);

    // [추가] 입력창 맞춤법 검사 비활성화
    const maintContent = document.getElementById('maint-content');
    if (maintContent) maintContent.spellcheck = false;

    // [추가] 유지관리 리스트 드래그 앤 드롭 순서 변경 기능 (dragover 이벤트)
    const maintBody = document.getElementById('maint-table-body');
    if (maintBody) {
        maintBody.addEventListener('dragover', (e) => {
            e.preventDefault(); // 드롭 허용
            const afterElement = getDragAfterElement(maintBody, e.clientY, 'tr:not(.dragging)');
            const draggable = document.querySelector('.dragging');
            if (draggable) {
                if (afterElement == null) maintBody.appendChild(draggable);
                else maintBody.insertBefore(draggable, afterElement);
            }
        });

        // [수정] 관리 모드 토글 버튼 이벤트 연결
        const btnMaintSettings = document.getElementById('btn-maint-settings');
        if (btnMaintSettings) btnMaintSettings.onclick = toggleMaintenanceMode;

        // [추가] 테이블 식별을 위한 클래스 추가
        const table = maintBody.closest('table');
        if (table) table.classList.add('maint-list-table');
    }
}

function setupLogEvents() {
    const logAddBtn = document.getElementById('log-add-btn') || document.getElementById('log-reg-btn');
    if (logAddBtn) logAddBtn.onclick = addLogItem;

    const memoSaveBtn = document.getElementById('memo-save-btn');
    if (memoSaveBtn) {
        memoSaveBtn.onclick = saveMemo;
    }

    const logDateInput = document.getElementById('log-date');
    if (logDateInput) logDateInput.value = new Date().toISOString().substring(0, 10);

    const logWorkerInput = document.getElementById('log-worker');
    if (logWorkerInput) logWorkerInput.onkeypress = (e) => { if (e.key === 'Enter') { e.preventDefault(); addLogItem(); } };
    if (logWorkerInput) logWorkerInput.spellcheck = false;

    const logSearchInput = document.getElementById('log-search');
    if (logSearchInput) logSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') renderLogs();
    });

    const logTypeSelect = document.getElementById('log-type-select');
    if (logTypeSelect) {
        logTypeSelect.addEventListener('change', updateLogDetailTypeOptions);
    }

    const logDetailTypeSelect = document.getElementById('log-detail-type-select');
    if (logDetailTypeSelect) {
        logDetailTypeSelect.addEventListener('change', updateLogContentOptions);
    }

    // [추가] 커스텀 드롭다운 이벤트 핸들링
    const trigger = document.getElementById('log-content-trigger');
    const dropdown = document.getElementById('log-content-dropdown');
    const addBtn = document.getElementById('btn-log-content-add');

    if (trigger && dropdown) {
        trigger.onclick = (e) => {
            e.stopPropagation();
            // 다른 열린 드롭다운 닫기
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => {
                if (d !== dropdown) d.classList.remove('show');
            });
            dropdown.classList.toggle('show');
        };

        // [수정] 모든 드롭다운에 대해 외부 클릭 시 닫기 처리
        document.addEventListener('click', (e) => {
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => {
                const wrapper = d.closest('.log-select-wrapper');
                if (wrapper && !wrapper.contains(e.target)) {
                    d.classList.remove('show');
                }
            });
        });
    }

    if (addBtn && dropdown) {
        addBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
        };
    }

    // 메모 입력 감지 (버튼 색상 변경)
    const memoInput = document.getElementById('device-memo');
    const memoBtn = document.getElementById('memo-save-btn');

    if (memoInput) memoInput.spellcheck = false;
    if (memoInput && memoBtn) {
        memoInput.addEventListener('input', () => {
            if (memoInput.value !== originalMemo) {
                memoBtn.classList.remove('btn-green-sm', 'btn-blue-sm');
                memoBtn.classList.add('btn-orange-sm');
            } else {
                memoBtn.classList.remove('btn-orange-sm', 'btn-blue-sm');
                memoBtn.classList.add('btn-green-sm');
            }
        });

        memoInput.addEventListener('click', () => {
            if (selectedLogId === null) {
                alert('리스트를 먼저 선택해주세요.');
                memoInput.blur(); // 포커스 해제하여 입력 방지
            }
        });
    }

    // [수정] 로그 관리 모드 토글 버튼 이벤트 연결
    const btnLogSettings = document.getElementById('btn-log-settings');
    if (btnLogSettings) {
        btnLogSettings.onclick = toggleLogManagementMode;
    }
}

function setupUIEvents() {
    const logResizer = document.getElementById('log-memo-resizer');

    if (logResizer) {
        const prevSibling = document.getElementById('log-list-wrapper'); // 위쪽: 리스트
        const container = logResizer.parentElement; // .card-body
        let isResizingLog = false;

        logResizer.addEventListener('mousedown', (e) => {
            isResizingLog = true;
            document.body.style.cursor = 'row-resize';
            logResizer.classList.add('resizing');
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizingLog) return;
            const containerRect = container.getBoundingClientRect();
            // 마우스 Y 위치에서 컨테이너 상단 Y 위치와 상단 패딩(15px)을 뺌
            let newHeight = e.clientY - containerRect.top - 15;

            // 최소 높이 제한 (100px)
            if (newHeight < 200) newHeight = 200;
            if (newHeight > containerRect.height - 300) newHeight = containerRect.height - 300;

            prevSibling.style.height = `${newHeight}px`;
            prevSibling.style.flex = 'none'; // flex 속성 무시하고 height 적용
        });

        document.addEventListener('mouseup', () => {
            if (isResizingLog) {
                isResizingLog = false;
                document.body.style.cursor = 'default';
                logResizer.classList.remove('resizing');
            }
        });
    }
}

function setupPageProtection() {
    window.addEventListener('beforeunload', (e) => {
        if ((selectedLogId !== null && document.getElementById('device-memo').value !== originalMemo)) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

/* ==========================================================================
   2. 유지관리 물품 (Maintenance Items: PM/BM)
   ========================================================================== */
function formatPhoneNumber(e) {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.substring(0, 11);

    let formatted = '';
    if (val.startsWith('02')) {
        if (val.length < 3) {
            formatted = val;
        } else if (val.length < 6) {
            formatted = val.substr(0, 2) + '-' + val.substr(2);
        } else if (val.length < 10) {
            formatted = val.substr(0, 2) + '-' + val.substr(2, 3) + '-' + val.substr(5);
        } else {
            formatted = val.substr(0, 2) + '-' + val.substr(2, 4) + '-' + val.substr(6);
        }
    } else {
        if (val.length < 4) {
            formatted = val;
        } else if (val.length < 7) {
            formatted = val.substr(0, 3) + '-' + val.substr(3);
        } else if (val.length < 11) {
            formatted = val.substr(0, 3) + '-' + val.substr(3, 3) + '-' + val.substr(6);
        } else {
            formatted = val.substr(0, 3) + '-' + val.substr(3, 4) + '-' + val.substr(7);
        }
    }
    e.target.value = formatted;
}

function addDetailItem() {
    if (!currentPath.equip) return alert('장비를 선택해주세요.');

    const maintType = document.querySelector('#maint-type-toggle .active').dataset.type;
    const contentEl = document.getElementById('maint-content');
    const content = contentEl.value.trim();
    let code = '';

    if (contentEl.tagName.toLowerCase() === 'select' && contentEl.selectedIndex >= 0) {
        const selectedOpt = contentEl.options[contentEl.selectedIndex];
        code = selectedOpt.dataset.code || '';
    }
    
    const date = document.getElementById('maint-date').value;
    const period = document.getElementById('maint-period').value;

    // 유효성 검사
    if (maintType === 'PM') {
        if (!content || !date || !period) return alert('PM은 내용, 날짜, 주기를 모두 입력해야 합니다.');
    } else {
        if (!content || !date) return alert('BM은 내용과 날짜를 입력해야 합니다.');
    }

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [], memo: "" };

    const newItem = {
        id: Date.now(),
        type: maintType,
        code: code,
        content: content,
        date: date,
        period: maintType === 'PM' ? period : null
    };

    data.maint.push(newItem);
    localStorage.setItem(key, JSON.stringify(data));
    // [수정] 상세 로그 기록
    addSystemLog('ADD_MAINTENANCE', currentPath.equip, `[${maintType}] ${content} (주기: ${period || '-'}일, 시작일: ${date})`);

    // 입력창 초기화
    document.getElementById('maint-content').value = '';
    if (maintType === 'PM') document.getElementById('maint-period').value = '';

    renderDetails(); // 등록 후 화면 갱신
}

function renderDetails() {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [], memo: "" };
    const maintBody = document.getElementById('maint-table-body');
    if (!maintBody) return;

    // [추가] 현재 관리 모드 상태 확인
    const table = maintBody.closest('table');
    const isManagementMode = table ? table.classList.contains('management-active') : false;

    maintBody.innerHTML = '';

    data.maint.forEach(item => {
        // [추가] 장비점검, 프로그램변경 등 일회성 일정은 리스트에서 제외
        if (item.type === '장비점검' || item.type === '프로그램변경' || item.type === '트러블이슈') return;

        const status = calculateStatus(item.type, item.date, item.period);
        const tr = document.createElement('tr');
        tr.id = `row-${item.id}`;
        tr.draggable = isManagementMode; // [수정] 관리 모드일 때만 드래그 가능
        tr.dataset.id = item.id;
        tr.addEventListener('dragstart', () => tr.classList.add('dragging'));
        tr.addEventListener('dragend', () => {
            tr.classList.remove('dragging');
            handleMaintReorder();
        });

        tr.innerHTML = `
            <td><span class="badge ${(item.type || 'PM').toLowerCase()}">${item.type || 'PM'}</span></td>
            <td class="edit-code">${escapeHtml(item.code || '-')}</td>
            <td class="edit-content">${escapeHtml(item.content)}</td>
            <td class="edit-date">${item.date}</td>
            <td class="edit-period">${item.period ? item.period + '일' : '-'}</td>
            <td class="${status.class}">${status.text}</td>
            <td>
                <div class="manage-btns">
                    <button class="btn-edit-sm" onclick="toggleEditRow(${item.id})">✏️</button>
                    <button class="btn-del-sm" onclick="deleteDetailItem(${item.id})">✕</button>
                </div>
            </td>`;
        maintBody.appendChild(tr);
    });

    document.getElementById('maint-count').textContent = `항목: ${data.maint.length}건`;

    // [이동] 유지관리 물품 목록이 갱신될 때 로그 입력 폼의 항목 옵션도 함께 업데이트
    updateLogContentOptions();

    // [추가] 파일 리스트 갱신
    renderFiles();

    // [추가] 로그 구분, 세부구분, 내용 초기화 (Admin 연동)
    updateLogTypeOptions();

    // [추가] 유지관리 항목 입력 옵션 갱신
    if (typeof updateMaintContentOptions === 'function') updateMaintContentOptions();
}

// [추가] 유지관리 물품 입력창을 등록된 물품 관리 데이터로 갱신하는 함수
window.updateMaintContentOptions = function() {
    const activeBtn = document.querySelector('#maint-type-toggle .active');
    if (!activeBtn) return;
    const maintType = activeBtn.dataset.type;
    
    let contentElement = document.getElementById('maint-content');
    if (!contentElement) return;

    // 데이터 로드
    const data = JSON.parse(localStorage.getItem('admin_items')) || [];
    const equipModel = currentPath.equip ? currentPath.equip.split('::')[0] : '';

    // [추가] 이미 리스트에 등록된 유지관리 물품 목록 가져오기
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const currentData = JSON.parse(localStorage.getItem(key)) || { maint: [] };
    const addedParts = currentData.maint
        .filter(item => item.type === maintType)
        .map(item => item.content);

    // PM, BM일 경우 select로 전환하여 등록된 항목 표시
    if (maintType === 'PM' || maintType === 'BM') {
        const filteredItems = data.filter(item => {
            if (item.type !== maintType) return false;
            // 현재 장비 모델과 일치하는 물품만 필터링
            if (item.equip) {
                const equips = item.equip.split(',').map(e => e.trim());
                if (!equips.includes(equipModel)) return false;
            } else {
                return false; 
            }
            
            // [추가] 이미 추가된 항목은 제안(드롭다운)에서 숨김
            if (addedParts.includes(item.part)) return false;
            
            return true;
        });

        let selectEl = contentElement;
        if (contentElement.tagName.toLowerCase() !== 'select') {
            selectEl = document.createElement('select');
            selectEl.id = 'maint-content';
            selectEl.className = contentElement.className;
            if (!selectEl.classList.contains('input-dark')) selectEl.classList.add('input-dark');
            selectEl.style.cssText = contentElement.style.cssText;
            contentElement.parentNode.replaceChild(selectEl, contentElement);
            
            // 항목 선택 시 교체주기 자동 입력
            selectEl.addEventListener('change', (e) => {
                const val = e.target.value;
                const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
                const activeType = document.querySelector('#maint-type-toggle .active').dataset.type;
                const match = adminItems.find(i => i.part === val && i.type === activeType);
                const periodInput = document.getElementById('maint-period');
                if (periodInput && !periodInput.disabled) {
                    periodInput.value = (match && match.cycle) ? match.cycle : '';
                }
            });
        }
        
        if (filteredItems.length === 0) {
            selectEl.innerHTML = `<option value="">등록할 ${maintType} 물품이 없음.</option>`;
        } else {
            selectEl.innerHTML = `<option value="">물품 선택</option>`;
            filteredItems.forEach(item => {
                const option = document.createElement('option');
                option.value = item.part;
                option.dataset.code = item.code || '';
                option.textContent = item.code ? item.code : item.part;
                selectEl.appendChild(option);
            });
        }
        
    } else {
        // PM, BM이 아닌 기타 타입일 경우 자유 입력 텍스트창으로 복구
        if (contentElement.tagName.toLowerCase() !== 'input') {
            const inputEl = document.createElement('input');
            inputEl.type = 'text';
            inputEl.id = 'maint-content';
            inputEl.className = contentElement.className;
            inputEl.style.cssText = contentElement.style.cssText;
            inputEl.placeholder = '항목 내용 입력';
            inputEl.spellcheck = false;
            contentElement.parentNode.replaceChild(inputEl, contentElement);
        }
    }
};

function calculateStatus(type, start, period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [y, m, d] = start.split('-').map(Number);
    const startDate = new Date(y, m - 1, d);
    const oneDay = 24 * 60 * 60 * 1000;

    if (type === 'PM') {
        const targetDate = new Date(startDate);
        targetDate.setDate(startDate.getDate() + parseInt(period || 0));
        const diffDays = Math.round((targetDate - today) / oneDay);

        if (diffDays > 7) return { text: `${diffDays}일 남음`, class: 'text-green' };
        if (diffDays > 0) return { text: `${diffDays}일 남음`, class: 'text-orange' };
        if (diffDays === 0) return { text: `오늘 점검일`, class: 'text-blue' };
        return { text: `${Math.abs(diffDays)}일 지남`, class: 'text-red' };
    } else {
        const diffDays = Math.round((today - startDate) / oneDay);
        return { text: `${diffDays < 0 ? 0 : diffDays}일 사용`, class: 'text-blue' };
    }
}

function deleteDetailItem(id) {
    if (!confirm('이 유지관리 내역을 삭제하시겠습니까?')) return;

    // 1. 현재 선택된 장비의 데이터 키 생성
    const key = `details_${currentPath.site}_${currentPath.equip}`;

    // 2. 데이터 가져오기
    let data = JSON.parse(localStorage.getItem(key));

    if (data && data.maint) {
        // [추가] 삭제될 아이템 정보 미리 저장
        const targetItem = data.maint.find(item => item.id === id);
        const deletedContent = targetItem ? targetItem.content : 'Unknown';

        // 3. 해당 ID를 제외한 나머지 항목만 남김 (필터링)
        data.maint = data.maint.filter(item => item.id !== id);

        // 4. 변경된 데이터 저장
        localStorage.setItem(key, JSON.stringify(data));
        addSystemLog('DELETE_MAINTENANCE', currentPath.equip, `삭제: ${deletedContent} (ID: ${id})`);

        // 5. 화면 즉시 갱신
        renderDetails();
    }
}

function toggleEditRow(id) {
    const row = document.getElementById(`row-${id}`);
    const editBtn = row.querySelector('.btn-edit-sm');
    const isEditing = row.classList.contains('editing');

    const codeCell = row.querySelector('.edit-code');
    const contentCell = row.querySelector('.edit-content');
    const dateCell = row.querySelector('.edit-date');
    const periodCell = row.querySelector('.edit-period');

    if (!isEditing) {
        // [수정 모드 시작]
        row.classList.add('editing');
        editBtn.textContent = '✅';
        editBtn.style.color = '#238636';

        codeCell.contentEditable = "true";
        codeCell.spellcheck = false;

        contentCell.contentEditable = "true";
        contentCell.spellcheck = false;

        // [수정] 주기(Period) 입력창을 number 타입으로 변경하여 숫자만 입력 가능하게 함
        if (row.querySelector('.badge').textContent === 'PM') {
            const currentPeriod = periodCell.textContent.replace('일', '').trim();
            periodCell.innerHTML = `<input type="number" id="input-period-${id}" value="${escapeHtml(currentPeriod)}" class="edit-period-input">`;
        }

        // [수정] 날짜 입력창 옆에 달력 아이콘 버튼 추가 (가독성 개선)
        const currentDate = dateCell.textContent.trim();
        dateCell.innerHTML = `
            <div class="edit-date-wrapper">
                <input type="date" id="input-date-${id}" value="${escapeHtml(currentDate)}" class="edit-date-input">
                <button type="button" onclick="try{document.getElementById('input-date-${id}').showPicker()}catch(e){document.getElementById('input-date-${id}').focus()}" class="btn-calendar-picker">📅</button>
            </div>
        `;
        contentCell.focus();
    } else {
        // [데이터 저장]
        const newCode = codeCell.textContent.trim() === '-' ? '' : codeCell.textContent.trim();
        const newContent = contentCell.textContent.trim();
        const dateInput = document.getElementById(`input-date-${id}`);
        const newDate = dateInput ? dateInput.value : '';

        // [수정] 주기 값 가져오기 (input이 있으면 input 값, 없으면 텍스트)
        let newPeriod = periodCell.textContent.replace('일', '').trim();
        const periodInput = document.getElementById(`input-period-${id}`);
        if (periodInput) {
            newPeriod = periodInput.value;
        }

        if (!newDate) return alert('날짜를 선택해주세요.');

        updateRowData(id, newCode, newContent, newDate, newPeriod);

        row.classList.remove('editing');
        editBtn.textContent = '✏️';
        editBtn.style.color = '';

        renderDetails(); // 화면 갱신 시 다시 텍스트로 복구 및 재계산
    }
}

function updateRowData(id, code, content, date, period) {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));
    const idx = data.maint.findIndex(item => item.id === id);

    if (idx > -1) {
        data.maint[idx].code = code;
        data.maint[idx].content = content;
        data.maint[idx].date = date;
        data.maint[idx].period = data.maint[idx].type === 'PM' ? (parseInt(period) || 0) : null;
        localStorage.setItem(key, JSON.stringify(data));
        addSystemLog('UPDATE_MAINTENANCE', currentPath.equip, `수정: [${code || '-'}] ${content} (날짜: ${date}, 주기: ${period || '-'})`);
    }
}

function handleMaintReorder() {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));
    if (!data || !data.maint) return;

    const rows = document.querySelectorAll('#maint-table-body tr');
    const newOrderIds = Array.from(rows).map(row => parseInt(row.dataset.id));

    const maintMap = new Map(data.maint.map(item => [item.id, item]));
    data.maint = newOrderIds.map(id => maintMap.get(id)).filter(item => item);

    localStorage.setItem(key, JSON.stringify(data));
}

/* ==========================================================================
   3. 점검 이력 및 메모 (Inspection Logs & Memo)
   ========================================================================== */
function addLogItem(e) {
    // 버튼이 form 내부에 있을 경우 페이지 리로드 방지
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
    }

    if (!currentPath.equip) return alert('장비를 먼저 선택해주세요.');

    // HTML 요소 안전하게 가져오기
    const dateInput = document.getElementById('log-date');
    const workerInput = document.getElementById('log-worker');

    if (!dateInput || !workerInput) return alert('입력창(ID: log-date 또는 log-worker)을 찾을 수 없습니다.');

    const date = dateInput.value;
    const typeSelect = document.getElementById('log-type-select');
    const detailTypeSelect = document.getElementById('log-detail-type-select');
    const type = typeSelect ? typeSelect.value : '';
    const detailType = detailTypeSelect ? detailTypeSelect.value : '';
    const worker = workerInput.value.trim();

    let content = '';
    const contentInput = document.getElementById('log-content-input');
    const contentWrapper = document.getElementById('log-content-wrapper');

    if (contentWrapper && contentWrapper.style.display !== 'none') {
        const list = document.getElementById('log-content-list');
        const selected = list ? list.querySelectorAll('.log-select-item.selected') : [];
        if (selected.length > 0) {
            content = Array.from(selected).map(el => el.dataset.value).join(', ');
        }
    } else {
        content = contentInput ? contentInput.value.trim() : '';
    }

    if (!date || !type || (!detailType && !detailTypeSelect.disabled) || !worker) return alert('필수 항목(날짜, 구분, 세부구분, 작업자)을 올바르게 입력/선택해주세요.');

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [], memo: "" };
    if (!data.logs) data.logs = []; // 기존 데이터 호환성 처리

    // [수정] 중복 검사 제거 (같은 날짜에 여러 항목 기록 허용)

    // 새 점검 기록 객체 생성
    const newLog = {
        id: Date.now(), // 고유 식별자
        date: date,
        memo: "", // 상세 메모 초기값
        type: type,
        detailType: detailType,
        content: content,
        worker: worker,
    };

    data.logs.push(newLog);

    // [추가] BM 점검 등록 시 유지관리 물품에 자동 추가 로직
    let isMaintUpdated = false;
    if (detailType === 'BM 점검' || type === 'BM') {
        const itemsList = content.split(',').map(s => s.trim()).filter(s => s);
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
        
        itemsList.forEach((itemText, idx) => {
            // 기존 유지관리 물품 리스트에 같은 항목(BM)이 있는지 확인
            const exists = data.maint.some(m => m.type === 'BM' && (m.content === itemText || m.code === itemText));
            if (!exists) {
                let code = '';
                let fullContent = itemText;
                
                // Admin 물품 관리 데이터에서 코드명과 풀네임 검색
                const match = adminItems.find(a => a.part === itemText || a.code === itemText);
                if (match) {
                    code = match.code || '';
                    fullContent = match.part || itemText;
                }

                data.maint.push({
                    id: Date.now() + 1000 + idx, // ID 충돌 방지
                    type: 'BM',
                    code: code,
                    content: fullContent,
                    date: date,
                    period: null
                });
                isMaintUpdated = true;
                addSystemLog('ADD_MAINTENANCE', currentPath.equip, `[BM] ${fullContent} (자동 등록, 시작일: ${date})`);
            }
        });
    }

    localStorage.setItem(key, JSON.stringify(data));
    addSystemLog('ADD_LOG', currentPath.equip, `[${type} - ${detailType}] ${content} (작업자: ${worker}, 날짜: ${date})`);

    // 입력창 초기화 및 리스트 갱신
    workerInput.value = '';
    const contentTrigger = document.getElementById('log-content-trigger');
    if (contentTrigger) contentTrigger.textContent = '항목 선택';
    const mainList = document.getElementById('log-content-list');
    if (mainList) {
        mainList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));
    }
    if (contentInput && type !== '프로그램변경') contentInput.value = '';
    if (contentInput && type === '프로그램변경') contentInput.value = 'Ver. ';

    renderLogs();
    if (isMaintUpdated) {
        renderDetails(); // 유지관리 물품 리스트 갱신
    }
    console.log("점검 일지 기록 완료");
}

function renderLogs() {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [], memo: "" };
    if (!data.logs) data.logs = []; // 기존 데이터 호환성 처리
    const logBody = document.getElementById('log-table-body');

    if (!logBody) {
        console.warn('테이블 본문(ID: log-table-body)을 찾을 수 없습니다.');
        return;
    }

    // 1. 최신순 정렬
    let sortedLogs = data.logs.sort((a, b) => {
        if (b.date !== a.date) {
            return b.date.localeCompare(a.date); // 점검일 기준 내림차순 (최신 날짜 먼저)
        }
        return b.id - a.id; // 날짜가 같으면 등록순
    });

    // 2. 검색 필터 적용
    const searchInput = document.getElementById('log-search');
    if (searchInput) {
        const keyword = searchInput.value.trim().toLowerCase();
        if (keyword) {
            sortedLogs = sortedLogs.filter(log =>
                (log.worker && log.worker.toLowerCase().includes(keyword)) ||
                (log.date && log.date.includes(keyword)) ||
                (log.content && log.content.toLowerCase().includes(keyword)) ||
                (log.memo && log.memo.toLowerCase().includes(keyword)) ||
                (log.type && log.type.toLowerCase().includes(keyword)) ||
                (log.detailType && log.detailType.toLowerCase().includes(keyword))
            );
        }
    }
    
    const getLogBadgeClass = (t, dt) => {
        if (!t) return 'default';
        if (t === 'PM' || dt === 'PM') return 'pm';
        if (t === 'BM' || dt === 'BM') return 'bm';
        return t.replace(/\s/g, ''); // 공백 제거하여 CSS 클래스명으로 반환
    };

    logBody.innerHTML = sortedLogs.map(log => {
        let displayContent = log.content || '-';
        let tooltipContent = log.content || '';

        // 항목이 많은 경우 축약 표시
        if (log.content && log.content.includes(',')) {
            const items = log.content.split(',').map(s => s.trim());
            if (items.length > 1) {
                displayContent = `${items[0]} 외 ${items.length - 1}개`;
                tooltipContent = items.join('\n');
            }
        }

        let formattedDate = log.date || '-';
        const dateMatch = formattedDate.match(/^20(\d{2})-(\d{2})-(\d{2})$/);
        if (dateMatch) {
            formattedDate = `${dateMatch[1]}. ${dateMatch[2]}. ${dateMatch[3]}`;
        }

        return `
        <tr id="log-row-${log.id}" onclick="selectLog(${log.id})" class="${selectedLogId === log.id ? 'active-log' : ''}">
            <td data-raw-date="${escapeHtml(log.date || '')}">${formattedDate}</td>
            <td><span class="badge ${getLogBadgeClass(log.type, log.detailType)}">${escapeHtml(log.type || 'PM')}</span></td>
            <td>${escapeHtml(log.detailType || '-')}</td>
            <td title="${escapeHtml(tooltipContent)}">${escapeHtml(displayContent)}</td>
            <td>${escapeHtml(log.worker)}</td>
            <td>
                <button class="btn-edit-sm" onclick="event.stopPropagation(); toggleLogEdit(${log.id}, this);">✏️</button>
                <button class="btn-del-sm" onclick="event.stopPropagation(); deleteLogItem(${log.id});">✕</button>
            </td>
        </tr>
    `}).join('');
}

function selectLog(id, focus = true) {
    // 다른 로그 선택 시 저장되지 않은 메모 확인
    if (selectedLogId !== null) {
        const memoInput = document.getElementById('device-memo');
        if (memoInput && memoInput.value !== originalMemo) {
            return alert('작성 중인 메모가 저장되지 않았습니다. 저장 버튼을 눌러주세요.');
        }
    }

    selectedLogId = id; // 전역 변수에 현재 선택된 ID 저장

    // UI: 선택된 행 강조 스타일 적용
    document.querySelectorAll('#log-table-body tr').forEach(tr => tr.classList.remove('active-log'));
    const targetRow = document.getElementById(`log-row-${id}`);
    if (targetRow) targetRow.classList.add('active-log');

    // 해당 로그의 메모 데이터 불러오기
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const data = JSON.parse(localStorage.getItem(key));
    const logItem = data.logs.find(l => l.id === id);

    if (logItem) {
        const memo = logItem.memo || "";
        document.getElementById('device-memo').value = memo;
        originalMemo = memo; // 원본 저장

        // 버튼 상태 초기화 (녹색)
        const memoBtn = document.getElementById('memo-save-btn');
        if (memoBtn) {
            memoBtn.classList.remove('btn-orange-sm', 'btn-blue-sm');
            memoBtn.classList.add('btn-green-sm');
        }

        if (focus) document.getElementById('device-memo').focus();
    }
}

function saveMemo() {
    if (!selectedLogId) return;

    const memoContent = document.getElementById('device-memo').value;
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));

    const logIdx = data.logs.findIndex(l => l.id === selectedLogId);
    if (logIdx > -1) {
        data.logs[logIdx].memo = memoContent; // 메모 업데이트
        localStorage.setItem(key, JSON.stringify(data));
        addSystemLog('UPDATE_MEMO', currentPath.equip, `메모 수정 (LogID: ${selectedLogId})`);

        originalMemo = memoContent; // 원본 업데이트

        // 버튼 상태 초기화 (녹색)
        const memoBtn = document.getElementById('memo-save-btn');
        if (memoBtn) {
            memoBtn.classList.remove('btn-orange-sm');
            memoBtn.classList.add('btn-green-sm');
        }

    }
}

function deleteLogItem(id) {
    if (!confirm('이 기록을 삭제하시겠습니까?')) return;

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));

    if (!data || !data.logs) return; // 데이터 안전장치
    
    // [추가] 삭제될 로그 정보 미리 저장
    const targetLog = data.logs.find(l => l.id === id);
    const deletedInfo = targetLog ? `${targetLog.date} ${targetLog.content}` : 'Unknown';

    data.logs = data.logs.filter(l => l.id !== id);
    localStorage.setItem(key, JSON.stringify(data));
    addSystemLog('DELETE_LOG', currentPath.equip, `삭제: ${deletedInfo}`);

    if (selectedLogId === id) {
        selectedLogId = null;
        document.getElementById('device-memo').value = '';
        originalMemo = "";

        const memoBtn = document.getElementById('memo-save-btn');
        if (memoBtn) {
            memoBtn.classList.remove('btn-orange-sm', 'btn-blue-sm');
            memoBtn.classList.add('btn-green-sm');
        }
    }
    renderLogs();
}

// [추가] 로그 수정 모드 토글 함수
function toggleLogEdit(id, btn) {
    const row = document.getElementById(`log-row-${id}`);
    if (!row) return;

    const isEditing = row.classList.contains('editing');
    const editBtn = btn || row.querySelector('.btn-edit-sm');

    if (!isEditing) {
        if (document.querySelector('#log-table-body tr.editing')) {
            return alert('다른 항목을 먼저 저장해주세요.');
        }

        row.classList.add('editing');
        editBtn.textContent = '✅';
        editBtn.style.color = '#238636';

        const dateCell = row.cells[0];
        const typeCell = row.cells[1];
        const detailCell = row.cells[2];
        const contentCell = row.cells[3];
        const workerCell = row.cells[4];

        const currentDate = dateCell.dataset.rawDate || dateCell.textContent.trim();
        const currentType = typeCell.textContent.trim();
        const currentDetailType = detailCell.textContent.trim() === '-' ? '' : detailCell.textContent.trim();
        const currentContent = contentCell.textContent.trim();
        const currentWorker = workerCell.textContent.trim();

        dateCell.innerHTML = `<input type="date" id="edit-log-date-${id}" value="${escapeHtml(currentDate)}" class="input-dark" style="width: 100%; padding: 2px;" onclick="event.stopPropagation()">`;
        
        const allCategories = ['정기', '비정기', '고객대응', '용액제조', '온라인점검', 'PM', 'BM', '장비점검', '프로그램변경', '트러블이슈'];
        typeCell.innerHTML = `
            <select id="edit-log-type-${id}" class="input-dark" style="width: 100%; padding: 2px;" onclick="event.stopPropagation()" onchange="updateEditDetailTypeOptions(${id})">
                ${allCategories.map(c => `<option value="${c}" ${currentType === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>`;

        detailCell.innerHTML = `
            <select id="edit-log-detail-type-${id}" class="input-dark" style="width: 100%; padding: 2px;" onclick="event.stopPropagation()" onchange="updateEditLogContentField(${id})">
            </select>`;

        renderEditLogContentField(id, currentType, currentDetailType, currentContent === '-' ? '' : currentContent);
        updateEditDetailTypeOptions(id, currentDetailType);

        workerCell.innerHTML = `<input type="text" id="edit-log-worker-${id}" value="${escapeHtml(currentWorker)}" class="input-dark" style="width: 100%; padding: 2px;" onclick="event.stopPropagation()">`;

    } else {
        const dateInput = document.getElementById(`edit-log-date-${id}`);
        const typeInput = document.getElementById(`edit-log-type-${id}`);
        const detailTypeInput = document.getElementById(`edit-log-detail-type-${id}`);
        const workerInput = document.getElementById(`edit-log-worker-${id}`);

        if (!dateInput || !typeInput || !detailTypeInput || !workerInput) return alert('입력 필드를 찾을 수 없습니다. 다시 시도해주세요.');

        const newDate = dateInput.value;
        const newType = typeInput.value;
        const newDetailType = detailTypeInput.value;

        // [수정] 내용 가져오기 (입력창 또는 드롭다운 트리거)
        let newContent = '';
        const wrapper = document.querySelector(`#log-row-${id} .log-select-wrapper`);

        if (wrapper) {
            const list = wrapper.querySelector('.log-select-list');
            if (list) {
                const selected = list.querySelectorAll('.log-select-item.selected');
                newContent = Array.from(selected).map(el => el.dataset.value).join(', ');
            }
        } else {
            const contentInput = document.getElementById(`edit-log-content-${id}`);
            if (contentInput) newContent = contentInput.value.trim();
        }

        const newWorker = workerInput.value.trim();

        if (!newDate || !newType || (!newDetailType && detailTypeInput && !detailTypeInput.disabled) || !newWorker) return alert('필수 항목(날짜, 구분, 세부구분, 작업자)을 모두 입력해주세요.');

        updateLogItem(id, newDate, newType, newDetailType, newContent, newWorker);
    }
}

// [수정] 수정 모드에서 내용 필드 렌더링 (PM/BM일 경우 다중 선택 드롭다운)
window.renderEditLogContentField = function(id, type, detailType, value) {
    const row = document.getElementById(`log-row-${id}`);
    if (!row) return;
    const contentCell = row.cells[3]; // 0: date, 1: type, 2: detailType, 3: content

    if (!type) {
        contentCell.innerHTML = `<input type="text" id="edit-log-content-${id}" value="" class="input-dark input-disabled" style="width: 100%; padding: 2px;" placeholder="구분을 먼저 선택하세요" disabled onclick="event.stopPropagation()">`;
        return;
    }

    const detailTypeSelect = document.getElementById(`edit-log-detail-type-${id}`);
    if (detailTypeSelect && !detailTypeSelect.disabled && !detailType) {
        contentCell.innerHTML = `<input type="text" id="edit-log-content-${id}" value="" class="input-dark input-disabled" style="width: 100%; padding: 2px;" placeholder="세부구분을 먼저 선택하세요" disabled onclick="event.stopPropagation()">`;
        return;
    }

    const items = getCheckTypeItems(type, detailType);

    if (items.length > 0 && detailType) {

        // 커스텀 드롭다운 구조 생성
        const wrapper = document.createElement('div');
        wrapper.className = 'log-select-wrapper';
        wrapper.style.width = '100%';
        wrapper.onclick = (e) => e.stopPropagation();

        const currentValues = value ? value.split(',').map(s => s.trim()).filter(s => s) : [];
        let initialText = '항목 선택';
        if (currentValues.length > 1) {
            initialText = `${currentValues[0]} 외 ${currentValues.length - 1}개`;
        } else if (currentValues.length === 1) {
            initialText = currentValues[0];
        }

        const trigger = document.createElement('div');
        trigger.id = `edit-log-content-trigger-${id}`;
        trigger.className = 'log-select-trigger';
        trigger.textContent = initialText;
        trigger.title = currentValues.join('\n');

        const dropdown = document.createElement('div');
        dropdown.className = 'log-select-dropdown';

        const list = document.createElement('div');
        list.className = 'log-select-list';

        items.forEach(item => {
            const displayValue = item.code ? item.code : item.content;
            
            // 중복 렌더링 방지
            if (Array.from(list.children).some(child => child.dataset.value === displayValue)) return;
            
                const div = document.createElement('div');
                div.className = 'log-select-item';
                // 기존 값이 full content 이거나 code 인 경우 모두 대응
                if (currentValues.includes(item.content) || currentValues.includes(displayValue)) div.classList.add('selected');
                div.dataset.value = displayValue;
                div.innerHTML = `<span>${displayValue}</span>`;

                div.onclick = (e) => {
                    e.stopPropagation();
                    div.classList.toggle('selected');

                    const selected = list.querySelectorAll('.log-select-item.selected');
                    const values = Array.from(selected).map(el => el.dataset.value);

                    if (values.length > 1) {
                        trigger.textContent = `${values[0]} 외 ${values.length - 1}개`;
                    } else if (values.length === 1) {
                        trigger.textContent = values[0];
                    } else {
                        trigger.textContent = '항목 선택';
                    }
                    trigger.title = values.join('\n');
                };
                list.appendChild(div);
        });

        dropdown.appendChild(list);

        const footer = document.createElement('div');
        footer.className = 'log-select-footer';
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-blue-sm';
        addBtn.style.width = '100%';
        addBtn.textContent = '추가';
        addBtn.onclick = (e) => { e.stopPropagation(); dropdown.classList.remove('show'); };
        footer.appendChild(addBtn);
        dropdown.appendChild(footer);

        wrapper.appendChild(trigger);
        wrapper.appendChild(dropdown);

        trigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => {
                if (d !== dropdown) d.classList.remove('show');
            });
            dropdown.classList.toggle('show');
        };

        contentCell.innerHTML = '';
        contentCell.appendChild(wrapper);
    } else {
        contentCell.innerHTML = `<input type="text" id="edit-log-content-${id}" value="${escapeHtml(value)}" class="input-dark" style="width: 100%; padding: 2px;" onclick="event.stopPropagation()">`;
    }
}

// [추가] Admin 점검 구분 연동 동적 생성 함수
window.updateLogTypeOptions = function() {
    const typeSelect = document.getElementById('log-type-select');
    if (!typeSelect) return;
    
    const categories = ['정기', '비정기', '고객대응', '용액제조', '온라인점검']; // Admin 기본 구분
    const currentVal = typeSelect.value;
    
    typeSelect.innerHTML = '';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        typeSelect.appendChild(opt);
    });
    
    if (currentVal && categories.includes(currentVal)) {
        typeSelect.value = currentVal;
    }
    
    updateLogDetailTypeOptions();
};

window.updateLogDetailTypeOptions = function() {
    const typeSelect = document.getElementById('log-type-select');
    const detailTypeSelect = document.getElementById('log-detail-type-select');
    if (!typeSelect || !detailTypeSelect) return;
    
    const type = typeSelect.value;
    detailTypeSelect.innerHTML = '';
    
    if (!type) {
        detailTypeSelect.innerHTML = '<option value="">구분 먼저 선택</option>';
        detailTypeSelect.disabled = true;
        updateLogContentOptions();
        return;
    }
    
    detailTypeSelect.disabled = false;
    
    const subCategories = getSubCategories(type);
    
    if (subCategories.length === 0) {
        detailTypeSelect.innerHTML = '<option value="">세부구분 없음 (직접입력)</option>';
        detailTypeSelect.disabled = true;
    } else {
        detailTypeSelect.innerHTML = '';
        subCategories.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub;
            opt.textContent = sub;
            detailTypeSelect.appendChild(opt);
        });
    }
    
    updateLogContentOptions();
};

// [추가] 로그 입력 폼 항목 업데이트 함수
window.updateLogContentOptions = function() {
    const typeSelect = document.getElementById('log-type-select');
    const detailTypeSelect = document.getElementById('log-detail-type-select');
    const contentWrapper = document.getElementById('log-content-wrapper');
    const contentList = document.getElementById('log-content-list');
    const contentTrigger = document.getElementById('log-content-trigger');
    const contentInput = document.getElementById('log-content-input');

    if (!typeSelect || !detailTypeSelect || !contentWrapper || !contentInput) return;

    const type = typeSelect.value;
    const detailType = detailTypeSelect.value;
    const equipKey = currentPath.equip;

    if (!type) {
        contentWrapper.style.display = 'none';
        contentInput.style.display = 'inline-block';
        contentInput.placeholder = '구분을 먼저 선택하세요';
        contentInput.value = '';
        contentInput.disabled = true;
        return;
    }

    if (!detailType && !detailTypeSelect.disabled) {
        contentWrapper.style.display = 'none';
        contentInput.style.display = 'inline-block';
        contentInput.placeholder = '세부구분을 먼저 선택하세요';
        contentInput.value = '';
        contentInput.disabled = true;
        return;
    }

    contentInput.disabled = false;
    
    const items = getCheckTypeItems(type, detailType);

    if (items.length > 0 && detailType) {
        contentWrapper.style.display = 'inline-block';
        contentInput.style.display = 'none';

        if (contentTrigger) contentTrigger.textContent = '항목 선택';
        if (contentList) {
            contentList.innerHTML = '';
            items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'log-select-item';
                
                // [수정] 약어(코드)가 있으면 약어를 value와 표시명으로 사용
                const displayValue = item.code ? item.code : item.content;
                div.dataset.value = displayValue;
                div.innerHTML = `<span>${displayValue}</span>`;
                
                div.onclick = (e) => {
                    e.stopPropagation();
                    div.classList.toggle('selected');
                    
                    const selected = contentList.querySelectorAll('.log-select-item.selected');
                    const values = Array.from(selected).map(el => el.dataset.value);
                    if (values.length > 1) {
                        contentTrigger.textContent = `${values[0]} 외 ${values.length - 1}개`;
                    } else if (values.length === 1) {
                        contentTrigger.textContent = values[0];
                    } else {
                        contentTrigger.textContent = '항목 선택';
                    }
                    contentTrigger.title = values.join('\n');
                };
                contentList.appendChild(div);
            });
        }
    } else {
        contentWrapper.style.display = 'none';
        contentInput.style.display = 'inline-block';
        contentInput.placeholder = detailType ? '내용 (직접 입력)' : '내용 (직접 입력)';
    }
};

window.updateEditDetailTypeOptions = function(id, presetVal = '') {
    const typeSelect = document.getElementById(`edit-log-type-${id}`);
    const detailTypeSelect = document.getElementById(`edit-log-detail-type-${id}`);
    if (!typeSelect || !detailTypeSelect) return;
    
    const type = typeSelect.value;
    detailTypeSelect.innerHTML = '';
    
    if (!type) {
        detailTypeSelect.innerHTML = '<option value="">구분 먼저 선택</option>';
        detailTypeSelect.disabled = true;
        updateEditLogContentField(id);
        return;
    }
    
    detailTypeSelect.disabled = false;
    
    const subCategories = getSubCategories(type);
    
    // 기존 값 유지 로직
    if (presetVal && !subCategories.includes(presetVal)) {
        subCategories.unshift(presetVal);
    }
    
    if (subCategories.length === 0) {
        detailTypeSelect.innerHTML = '<option value="">세부구분 없음</option>';
        detailTypeSelect.disabled = true;
    } else {
        detailTypeSelect.innerHTML = '';
        subCategories.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub;
            opt.textContent = sub;
            if (sub === presetVal) opt.selected = true;
            detailTypeSelect.appendChild(opt);
        });
    }
    
    if (!presetVal) updateEditLogContentField(id);
};

window.updateEditLogContentField = function(id) {
    const typeSelect = document.getElementById(`edit-log-type-${id}`);
    const detailTypeSelect = document.getElementById(`edit-log-detail-type-${id}`);
    if (!typeSelect || !detailTypeSelect) return;
    
    const type = typeSelect.value;
    const detailType = detailTypeSelect.value;
    
    renderEditLogContentField(id, type, detailType, '');
};

// [추가] 세부구분 목록 가져오기 헬퍼 함수 (중복 제거)
function getSubCategories(type) {
    const equipKey = currentPath.equip;
    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    const key = `${equipKey}::${type}`;
    const defaultSubCategories = {
        '정기': ['PM'],
        '비정기': ['BM', 'Alarm', 'Hunting', 'Data / Para 이상'],
        '고객대응': ['순회 점검', '프로그램 변경 / 평가', '설비 평가', 'Parts 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '기타'],
        '용액제조': ['용액제조'],
        '온라인점검': ['온라인점검']
    };

    let subCategories = catData[key];
    if (!subCategories || subCategories.length === 0) {
        subCategories = defaultSubCategories[type] || [];
    }
    return subCategories;
}

// [추가] 점검 항목(내용) 목록 가져오기 헬퍼 함수 (중복 제거 및 호환성 유지)
function getCheckTypeItems(type, detailType) {
    const equipKey = currentPath.equip;
    const itemData = JSON.parse(localStorage.getItem('check_type_items')) || {};
    const key = `${equipKey}::${type}::${detailType}`;
    
    // 원본 데이터 오염을 막기 위해 복사본 생성
    const items = [...(itemData[key] || [])].map(item => ({...item}));

    // 구버전 호환성 (PM, BM, 트러블이슈 등)
    const safeDetailType = detailType || '';
    if (type === 'PM' || type === 'BM' || type === '트러블이슈' || safeDetailType.includes('PM') || safeDetailType.includes('BM')) {
        const keyMaint = `details_${currentPath.site}_${currentPath.equip}`;
        const dataMaint = JSON.parse(localStorage.getItem(keyMaint)) || { maint: [] };
        let filteredItems = [];
        if (type === '트러블이슈') {
            filteredItems.push({ content: '설비 이상' });
            filteredItems.push({ content: '데이터이슈' });
            filteredItems = filteredItems.concat(dataMaint.maint.filter(item => item.type === 'PM' || item.type === 'BM'));
        } else {
            const targetType = (type === 'PM' || type === 'BM') ? type : (safeDetailType.includes('PM') ? 'PM' : (safeDetailType.includes('BM') ? 'BM' : safeDetailType));
            filteredItems = dataMaint.maint.filter(item => item.type === targetType);
        }
        items.push(...filteredItems.map(item => ({...item})));
    }
    
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    
    // content 필드를 기준으로 중복 항목 완벽히 제거
    const uniqueItems = [];
    const seenContents = new Set();
    
    for (const item of items) {
        if (!seenContents.has(item.content)) {
            seenContents.add(item.content);
            
            // [추가] 약어(코드명)가 없으면 admin_items에서 조회
            if (!item.code) {
                const match = adminItems.find(a => a.part === item.content);
                if (match && match.code) {
                    item.code = match.code;
                }
            }
            
            uniqueItems.push(item);
        }
    }

    return uniqueItems;
}

/* ==========================================================================
   4. 모달 및 팝업 (Modals & Popups)
   ========================================================================== */

// 4.1 마스터 정보 관리 (Master Info)
function openMaintEquipModal() {
    const { site, equip } = currentPath;
    if (!site || !equip) return alert('장비를 선택해주세요.');

    const modal = document.getElementById('maint-equip-modal');
    if (!modal) return;

    // 데이터 로드
    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const setup = data.setup || {};
    const parts = equip.split('::');

    // 기본 정보 (Read-only)
    document.getElementById('maint-modal-site').value = site;
    document.getElementById('maint-modal-equip').value = parts[0];
    document.getElementById('maint-modal-serial').value = parts.length > 1 ? parts[1] : '';

    // 상세 정보 필드 매핑
    const fields = [
        'custEquipName', 'building', 'floor', 'detailLoc',
        'manager', 'contact', 'email',
        'custManager', 'custContact', 'custEmail'
    ];

    fields.forEach(field => {
        const el = document.getElementById(`maint-modal-${field}`);
        if (el) el.value = setup[field] || '';
    });

    modal.style.display = 'flex';
}

function saveMaintEquipModal() {
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
        const el = document.getElementById(`maint-modal-${field}`);
        if (el) data.setup[field] = el.value;
    });

    localStorage.setItem(key, JSON.stringify(data));
    addSystemLog('UPDATE_SETUP', equip, '장비 정보 수정 (Maintenance Page)');

    alert('저장되었습니다.');
    document.getElementById('maint-equip-modal').style.display = 'none';
}

// 4.2 유지관리 리스트 불러오기 모달
function setupMaintLoadListModal() {
    const modal = document.getElementById('maint-load-list-modal');
    const closeBtn = document.getElementById('btn-close-maint-load-list');
    const cancelBtn = document.getElementById('btn-cancel-maint-load-list');
    const confirmBtn = document.getElementById('btn-confirm-maint-load-list');
    const siteSelect = document.getElementById('maint-load-list-site-select');

    if (!modal) return;

    const closeModal = () => modal.style.display = 'none';

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateMaintLoadListEquipSelect(siteSelect.value);
        };
    }

    if (confirmBtn) {
        confirmBtn.onclick = loadMaintListFromTarget;
    }
}

function openMaintLoadListModal() {
    if (!currentPath.site || !currentPath.equip) return alert('장비를 선택해주세요.');

    const modal = document.getElementById('maint-load-list-modal');
    const siteSelect = document.getElementById('maint-load-list-site-select');
    const equipSelect = document.getElementById('maint-load-list-equip-select');

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

function updateMaintLoadListEquipSelect(site) {
    const equipSelect = document.getElementById('maint-load-list-equip-select');
    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = !site;

    if (!site) return;

    const data = JSON.parse(localStorage.getItem('device_data')) || {};
    const equips = data[site] || [];
    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        option.textContent = parts.length > 1 ? `${parts[0]} (${parts[1]})` : parts[0];
        equipSelect.appendChild(option);
    });
}

function loadMaintListFromTarget() {
    const site = document.getElementById('maint-load-list-site-select').value;
    const equip = document.getElementById('maint-load-list-equip-select').value;

    if (!site || !equip) return alert('불러올 장비를 선택해주세요.');

    if (!confirm('현재 작성된 유지관리 물품 리스트가 초기화되고 선택한 장비의 리스트로 대체됩니다.\n계속하시겠습니까?')) return;

    const sourceKey = `details_${site}_${equip}`;
    const sourceData = JSON.parse(localStorage.getItem(sourceKey)) || {};
    const sourceMaint = sourceData.maint || [];

    // 현재 장비에 덮어쓰기 (ID는 새로 생성하여 충돌 방지, 날짜는 오늘로 초기화)
    const today = new Date().toISOString().split('T')[0];
    const newMaint = sourceMaint.map((item, index) => ({
        ...item,
        id: Date.now() + index, // 새로운 ID 부여
        date: today, // 시작일(마지막 점검일)을 오늘로 초기화
        scheduledDate: "" // 예정일 초기화
    }));

    const targetKey = `details_${currentPath.site}_${currentPath.equip}`;
    let targetData = JSON.parse(localStorage.getItem(targetKey)) || {};
    targetData.maint = newMaint;

    localStorage.setItem(targetKey, JSON.stringify(targetData));

    // UI 갱신
    renderDetails();

    if (typeof addSystemLog === 'function') {
        addSystemLog('LOAD_MAINT_LIST', currentPath.equip, `From: ${site} > ${equip}`);
    }

    document.getElementById('maint-load-list-modal').style.display = 'none';
    alert('리스트를 불러왔습니다.');
}

// 4.3 특이사항 관리 (Special Note)
function setupSpecialNoteEvents() {
    const btnOpen = document.getElementById('btn-special-note');
    const btnClose = document.getElementById('btn-close-special-note');
    const btnSave = document.getElementById('btn-save-special-note');
    const modal = document.getElementById('special-note-modal');

    if (btnOpen) btnOpen.onclick = openSpecialNoteModal;
    if (btnClose) btnClose.onclick = closeSpecialNoteModal;
    if (btnSave) btnSave.onclick = saveSpecialNote;

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeSpecialNoteModal();
        });
    }
}

function openSpecialNoteModal() {
    if (!currentPath.equip) return alert('장비를 선택해주세요.');
    const modal = document.getElementById('special-note-modal');
    const textarea = document.getElementById('special-note-textarea');
    if (modal && textarea) {
        const key = `details_${currentPath.site}_${currentPath.equip}`;
        const data = JSON.parse(localStorage.getItem(key)) || {};
        textarea.value = data.specialNote || '';
        modal.style.display = 'flex';
    }
}

function closeSpecialNoteModal() {
    const modal = document.getElementById('special-note-modal');
    if (modal) modal.style.display = 'none';
}

function saveSpecialNote() {
    if (!currentPath.equip) return;
    const textarea = document.getElementById('special-note-textarea');
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    data.specialNote = textarea.value;
    localStorage.setItem(key, JSON.stringify(data));
    addSystemLog('UPDATE_SPECIAL_NOTE', currentPath.equip, '특이사항 수정');
    alert('특이사항이 저장되었습니다.');
    closeSpecialNoteModal();
    if (typeof renderSpecialNote === 'function') renderSpecialNote(); // 버튼 상태 갱신
}

// common.js 등 외부에서 호출될 수 있으므로 window 객체에 할당하거나 전역 함수로 유지
window.renderSpecialNote = function () {
    const btn = document.getElementById('btn-special-note');
    if (!btn || !currentPath.equip) return;
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    if (data.specialNote && data.specialNote.trim() !== '') {
        btn.textContent = '📝(V)';
        btn.style.color = '#58a6ff';
    } else {
        btn.textContent = '📝';
        btn.style.color = '';
    }
};

/* ==========================================================================
   5. 유틸리티 (Utilities)
   ========================================================================== */
// 유지관리 관리 모드 토글 함수
function toggleMaintenanceMode() {
    const tbody = document.getElementById('maint-table-body');
    const btn = document.getElementById('btn-maint-settings');
    if (!tbody) return;

    // tbody 대신 table에 클래스 토글 (컬럼 전체 숨김/표시 제어)
    const table = tbody.closest('table');
    if (table) table.classList.toggle('management-active');

    if (btn) btn.classList.toggle('active');

    const isActive = table ? table.classList.contains('management-active') : false;
    Array.from(tbody.children).forEach(row => {
        row.draggable = isActive;
    });

    // 리스트 불러오기 버튼 토글
    const loadBtn = document.getElementById('btn-load-maint-list');
    if (loadBtn) loadBtn.style.display = isActive ? 'block' : 'none';
}

// 로그 관리 모드 토글 함수
function toggleLogManagementMode() {
    const wrapper = document.getElementById('log-list-wrapper');
    const btn = document.getElementById('btn-log-settings');
    if (!wrapper) return;

    const table = wrapper.querySelector('table');
    if (table) table.classList.toggle('management-active');

    if (btn) btn.classList.toggle('active');
}

/* ==========================================================================
   [추가] 6. 파일 관리 (File Management)
   ========================================================================== */
function setupFileEvents() {
    const uploadBtn = document.getElementById('btn-upload-file');
    const fileInput = document.getElementById('file-upload-input');
    const fileList = document.getElementById('file-list');

    if (uploadBtn && fileInput) {
        uploadBtn.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            handleFiles(e.target.files);
            e.target.value = '';
        };
    }

    // [추가] 드래그 앤 드롭 이벤트
    if (fileList) {
        fileList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fileList.classList.add('drag-over');
        });

        fileList.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fileList.classList.remove('drag-over');
        });

        fileList.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fileList.classList.remove('drag-over');
            if (e.dataTransfer && e.dataTransfer.files) {
                handleFiles(e.dataTransfer.files);
            }
        });
    }

    // [추가] 파일 편집 모달 저장 버튼 이벤트
    const saveFileBtn = document.getElementById('btn-save-file-content');
    if (saveFileBtn) saveFileBtn.onclick = saveFileContent;
}

function handleFiles(files) {
    if (!currentPath.site || !currentPath.equip) return alert('장비를 선택해주세요.');
    if (!files || files.length === 0) return;

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    // 용량 체크 (간단히 2MB 제한)
    const MAX_SIZE = 2 * 1024 * 1024; 

    Array.from(files).forEach(file => {
        if (file.size > MAX_SIZE) {
            alert(`파일 '${file.name}'이 너무 큽니다. (2MB 제한)`);
            return;
        }

        const reader = new FileReader();
        reader.onload = function(evt) {
            const fileData = {
                id: Date.now() + Math.random(),
                name: file.name,
                type: file.type,
                size: file.size,
                content: evt.target.result, // Base64
                date: new Date().toISOString().split('T')[0]
            };
            
            // 데이터 다시 로드 (비동기 처리 중 변경 대비)
            let currentData = JSON.parse(localStorage.getItem(key)) || {};
            if (!currentData.files) currentData.files = [];
            
            currentData.files.push(fileData);
            
            try {
                localStorage.setItem(key, JSON.stringify(currentData));
                renderFiles();
                if (typeof addSystemLog === 'function') {
                    addSystemLog('UPLOAD_FILE', currentPath.equip, `File: ${file.name}`);
                }
            } catch (e) {
                alert('저장 용량이 부족하여 파일을 저장할 수 없습니다.');
                console.error(e);
            }
        };
        reader.readAsDataURL(file);
    });
}

// [이동] isTextFile 함수를 renderFiles 위로 이동하여 호이스팅 이슈 방지 및 가독성 확보
function isTextFile(filename) {
    if (!filename) return false;
    const ext = filename.split('.').pop().toLowerCase();
    return ['txt', 'csv', 'log', 'json', 'xml', 'md', 'html', 'css', 'js', 'py', 'bat', 'sh', 'ini', 'conf', 'properties'].includes(ext);
}

function renderFiles() {
    const listEl = document.getElementById('file-list');
    if (!listEl) return;
    
    if (!currentPath.site || !currentPath.equip) {
        listEl.innerHTML = '<li class="list-empty-msg">장비를 선택해주세요.</li>';
        return;
    }

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const files = data.files || [];

    listEl.innerHTML = '';
    
    if (files.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">등록된 파일이 없습니다.</li>';
        return;
    }

    files.forEach(file => {
        // [추가] 텍스트 파일 여부 확인
        const isEditable = isTextFile(file.name);
        const li = document.createElement('li');
        li.className = 'file-item';
        li.innerHTML = `
            <span class="file-name" onclick="downloadFile(${file.id})">📄 ${window.escapeHtml(file.name)}</span>
            ${isEditable ? `<button class="btn-edit-sm" onclick="editFile(${file.id})" title="내용 편집" style="margin-right: 8px; cursor: pointer;">📝</button>` : ''}
            <span class="file-info">${file.date}</span>
            <button class="btn-del-sm" onclick="deleteFile(${file.id})">✕</button>
        `;
        listEl.appendChild(li);
    });
}

window.downloadFile = function(id) {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const file = data.files ? data.files.find(f => f.id === id) : null;
    
    if (file) {
        const a = document.createElement('a');
        a.href = file.content;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
};

window.deleteFile = function(id) {
    if (!confirm('파일을 삭제하시겠습니까?')) return;
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    
    if (data.files) {
        data.files = data.files.filter(f => f.id !== id);
        localStorage.setItem(key, JSON.stringify(data));
        renderFiles();
        if (typeof addSystemLog === 'function') {
            addSystemLog('DELETE_FILE', currentPath.equip, `FileID: ${id}`);
        }
    }
};

/* ==========================================================================
   [추가] 파일 편집 기능 (File Editing)
   ========================================================================== */
let currentEditingFileId = null;

window.editFile = function(id) {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const file = data.files ? data.files.find(f => f.id === id) : null;

    if (!file) return alert('파일을 찾을 수 없습니다.');

    try {
        // Base64 디코딩 (한글 처리 포함)
        const base64 = file.content.split(',')[1];
        const binaryString = window.atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const text = new TextDecoder().decode(bytes);

        document.getElementById('file-edit-title').textContent = `파일 편집: ${file.name}`;
        
        const textEditor = document.getElementById('file-edit-content');
        textEditor.value = text;

        currentEditingFileId = id;

        document.getElementById('file-edit-modal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        alert('파일 내용을 읽을 수 없습니다.');
    }
};

window.saveFileContent = function() {
    if (!currentEditingFileId) return;

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    
    if (data.files) {
        const fileIdx = data.files.findIndex(f => f.id === currentEditingFileId);
        if (fileIdx > -1) {
            try {
                const content = document.getElementById('file-edit-content').value;
                // 텍스트 -> Base64 인코딩 (한글 처리 포함)
                const bytes = new TextEncoder().encode(content);
                let binaryString = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                    binaryString += String.fromCharCode(bytes[i]);
                }
                const base64 = window.btoa(binaryString);
                const size = bytes.byteLength;
                
                // 기존 MIME 타입 유지
                const originalHeader = data.files[fileIdx].content.split(',')[0];
                data.files[fileIdx].content = `${originalHeader},${base64}`;
                data.files[fileIdx].size = size; // 사이즈 업데이트

                localStorage.setItem(key, JSON.stringify(data));
                addSystemLog('UPDATE_FILE', currentPath.equip, `FileID: ${currentEditingFileId}`);
                
                alert('저장되었습니다.');
                closeFileEditModal();
            } catch (e) {
                console.error(e);
                alert('저장 중 오류가 발생했습니다.');
            }
        }
    }
};

window.closeFileEditModal = function() {
    document.getElementById('file-edit-modal').style.display = 'none';
    currentEditingFileId = null;
};