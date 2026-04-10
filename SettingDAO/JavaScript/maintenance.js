/* ==========================================================================
   1. 초기화 및 이벤트 리스너 (Initialization)
   ========================================================================== */
// [추가] 공통 함수 폴백 (common.js 누락 대비)
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

// [추가] escapeHtml 함수 폴백 (common.js 누락 또는 로드 실패 대비)
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function (text) {
        if (text === null || text === undefined) {
            return '';
        }
        return text.toString()
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    };
}

let originalWorker = "";
let originalIssueShared = false;
let originalMd = "";
let originalCostType = "";

// [추가] 에러 테두리 제거 헬퍼 함수
if (typeof window.removeErrorBorder !== 'function') {
    window.removeErrorBorder = function (e) {
        if (e.target) e.target.classList.remove('error-border');
    };
}

// [추가] 작업자(사용자) 목록 조회 함수 폴백
if (typeof window.fetchWorkerNames !== 'function') {
    window.workerNamesCache = [];
    window.fetchWorkerNames = async function () {
        if (window.workerNamesCache.length > 0) return window.workerNamesCache;
        try {
            const res = await fetch('/api/users/names');
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'success') {
                    window.workerNamesCache = data.workers || data.names || [];
                    return window.workerNamesCache;
                }
            }
        } catch (e) { console.error("fetchWorkerNames Error:", e); }
        return [];
    };
}

document.addEventListener('DOMContentLoaded', () => {
    const initMaint = () => {
        setupMaintenanceEvents();
        setupLogEvents();
        setupUIEvents();
        setupSpecialNoteEvents();
        setupPageProtection();

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

    const lastMaintType = localStorage.getItem('lastMaintType');

    if (maintPeriodInput) {
        maintPeriodInput.type = 'number';
        maintPeriodInput.min = '0';
        maintPeriodInput.addEventListener('input', function () {
            if (this.value < 0) this.value = Math.abs(this.value);
        });
    }

    if (maintTypeButtons.length > 0 && maintPeriodInput) {
        maintTypeButtons.forEach(btn => {
            btn.onclick = () => {
                maintTypeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                localStorage.setItem('lastMaintType', btn.dataset.type);

                // 비정기일 때 입력창 비활성화
                if (btn.dataset.type === '비정기') {
                    maintPeriodInput.disabled = true;
                    maintPeriodInput.value = '';
                    maintPeriodInput.classList.add('input-disabled');
                    maintPeriodInput.placeholder = '비정기는 주기 없음';
                } else {
                    maintPeriodInput.disabled = false;
                    maintPeriodInput.classList.remove('input-disabled');
                    maintPeriodInput.placeholder = '주기(일)';
                }

                // [추가] 유지관리 물품 항목 옵션 갱신
                if (typeof updateMaintContentOptions === 'function') updateMaintContentOptions();
            };
            if (lastMaintType && btn.dataset.type === lastMaintType) {
                setTimeout(() => btn.click(), 10);
            }
        });
    }

    const maintAddBtn = document.getElementById('maint-add-btn') || document.getElementById('maint-reg-btn');
    if (maintAddBtn) maintAddBtn.onclick = addDetailItem;

    const maintLoadBtn = document.getElementById('btn-load-maint-list');
    if (maintLoadBtn) {
        maintLoadBtn.addEventListener('click', openMaintLoadListModal);
    }

    // [추가] 유지관리 설정(톱니바퀴) 버튼 이벤트 바인딩
    const maintSettingsBtn = document.getElementById('btn-maint-settings');
    if (maintSettingsBtn) maintSettingsBtn.addEventListener('click', toggleMaintenanceMode);

    const maintDateInput = document.getElementById('maint-date');
    if (maintDateInput) maintDateInput.value = new Date().toISOString().substring(0, 10);

    // [추가] 물품명과 시작일 사이에 물품 상세 텍스트 입력창 동적 추가
    if (maintDateInput && !document.getElementById('maint-spec')) {
        const specInput = document.createElement('input');
        specInput.type = 'text';
        specInput.id = 'maint-spec';
        specInput.className = 'input-dark flex-1';
        specInput.placeholder = '물품 상세 (선택)';
        specInput.style.height = '30px';
        specInput.style.padding = '4px 8px';
        specInput.style.minWidth = '80px';
        maintDateInput.parentNode.insertBefore(specInput, maintDateInput);
    }

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

        // [추가] 테이블 식별을 위한 클래스 추가
        const table = maintBody.closest('table');
        if (table) table.classList.add('maint-list-table');
    }
}

function setupLogEvents() {
    const logSearchInput = document.getElementById('log-search');
    if (logSearchInput) {
        logSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') renderLogs();
        });
    }

    const btnRegister = document.getElementById('btn-open-register-task');
    if (btnRegister) {
        btnRegister.onclick = () => {
            if (!currentPath.site || !currentPath.equip) {
                return alert('장비를 먼저 선택해주세요.');
            }
            if (typeof openRegisterScheduleModal === 'function') {
                window.currentSearchFilters = { site: currentPath.site, equip: currentPath.equip };
                const todayStr = new Date().toISOString().substring(0, 10);
                window.openDetailAfterRegister = true;
                openRegisterScheduleModal(todayStr);
            } else {
                alert('작업 등록 팝업창을 열 수 없습니다.');
            }
        };
    }

    const memoInput = document.getElementById('device-memo');

    const trigger = document.getElementById('memo-worker-trigger');
    const dropdown = document.getElementById('memo-worker-dropdown');
    const searchInput = document.getElementById('memo-worker-search');
    const listContainer = document.getElementById('memo-worker-list');
    const confirmBtn = document.getElementById('btn-memo-worker-confirm');
    const hiddenInput = document.getElementById('memo-worker');

        const renderWorkers = async (searchTerm = '') => {
            const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames() : [];
            const currentSelected = hiddenInput.value ? hiddenInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
            const allWorkers = workers.map(w => typeof w === 'string' ? { name: w, department: '', position: '' } : w);
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

            // [추가] 선택된 이름이 최상단으로 오도록 정렬
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

            listContainer.innerHTML = '';
            displayWorkers.forEach(w => {
                const isSelected = currentSelected.includes(w.name);
                const subInfoText = (w.department || w.position) ? `(${escapeHtml(w.department)} ${escapeHtml(w.position)})` : '';

                const template = getTemplateContent('worker-list-item-template');
                if (!template) return;
                const div = template.querySelector('.log-select-item');

                if (isSelected) div.classList.add('selected');
                div.dataset.value = escapeHtml(w.name);
                div.querySelector('.worker-name').textContent = escapeHtml(w.name);
                div.querySelector('.worker-dept-pos').textContent = subInfoText ? ` ${subInfoText}` : '';
                listContainer.appendChild(div);
            });
            if (displayWorkers.length === 0) listContainer.innerHTML = `<div class="log-select-empty-msg" style="padding:10px; color:#8b949e; text-align:center;">검색 결과가 없습니다.</div>`;
            listContainer.querySelectorAll('.log-select-item').forEach(item => {
                item.onclick = (e) => { e.stopPropagation(); item.classList.toggle('selected'); updateWorkerSelection(); };
            });
        };

        const updateWorkerSelection = () => {
            const selected = Array.from(listContainer.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
            hiddenInput.value = selected.join(', ');
            if (selected.length > 0) trigger.textContent = selected.join(' ');
            else trigger.textContent = '작업자 선택';
            trigger.title = selected.join(', ');
            hiddenInput.dispatchEvent(new Event('input'));

            // [추가] 작업자 수에 맞춰 공수 자동 계산
            const mdInput = document.getElementById('memo-md');
            if (mdInput) {
                mdInput.value = selected.length;
                mdInput.dispatchEvent(new Event('input'));
            }
        };

        trigger.onclick = (e) => {
            e.stopPropagation();
            if (selectedLogId === null) { alert('리스트를 먼저 선택해주세요.'); return; }
            if (trigger.classList.contains('input-disabled')) return; // [추가] 비활성화 방어
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
            dropdown.classList.toggle('show');
            if (dropdown.classList.contains('show')) renderWorkers(searchInput.value.trim());
        };

        searchInput.onclick = (e) => e.stopPropagation();
        searchInput.oninput = (e) => renderWorkers(e.target.value.trim());

        confirmBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
        }

    const memoWorkerInput = document.getElementById('memo-worker');
    const memoMdInput = document.getElementById('memo-md');
    const memoCostTypeInput = document.getElementById('memo-cost-type');

    if (memoInput) { memoInput.spellcheck = false; memoInput.readOnly = true; } // [수정] 초기 상태 읽기 전용
    if (memoWorkerInput) memoWorkerInput.spellcheck = false;

    // [추가] 초기에는 메모 영역 전체 비활성화 (톱니바퀴로 활성화)
    setMemoFieldsDisabled(true);
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
        const saveBtn = document.getElementById('btn-log-save');
        if (saveBtn && saveBtn.style.display !== 'none' && saveBtn.classList.contains('btn-orange-sm')) {
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
    const specEl = document.getElementById('maint-spec');
    const content = contentEl.value.trim();
    const spec = specEl ? specEl.value.trim() : '';
    let code = contentEl.dataset ? (contentEl.dataset.code || '') : '';

    if (contentEl.tagName.toLowerCase() === 'select' && contentEl.selectedIndex >= 0) {
        const selectedOpt = contentEl.options[contentEl.selectedIndex];
        code = selectedOpt.dataset.code || '';
    } else {
        // 타이핑 입력인 경우 admin_items에서 코드 검색
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
        const match = adminItems.find(a => a.part === content);
        if (match) {
            code = match.code || '';
        }
    }

    const dateEl = document.getElementById('maint-date');
    const periodEl = document.getElementById('maint-period');
    const date = dateEl ? dateEl.value : '';
    const period = periodEl ? periodEl.value : '';

    // [추가] 에러 테두리 초기화 및 유효성 검사
    [contentEl, specEl, dateEl, periodEl].forEach(el => {
        if (el) {
            el.classList.remove('error-border');
            el.removeEventListener('input', window.removeErrorBorder);
            el.addEventListener('input', window.removeErrorBorder);
            el.removeEventListener('change', window.removeErrorBorder);
            el.addEventListener('change', window.removeErrorBorder);
        }
    });

    let hasError = false;
    if (!content) { contentEl.classList.add('error-border'); hasError = true; }
    if (!date) { if (dateEl) dateEl.classList.add('error-border'); hasError = true; }
    if (maintType === '정기' && !period) { if (periodEl) periodEl.classList.add('error-border'); hasError = true; }
    if (hasError) {
        return alert(maintType === '정기' ? '정기는 내용, 날짜, 교체 주기를 모두 입력해야 합니다.\n빨간색 테두리로 표시된 항목을 확인해주세요.' : '비정기는 내용과 날짜를 입력해야 합니다.\n빨간색 테두리로 표시된 항목을 확인해주세요.');
    }

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [], memo: "" };

    // [수정] 물품명(content)이 같아도 물품 상세(spec) 텍스트가 다르면 다른 항목으로 취급하여 중복 추가 허용
    if (data.maint.some(m => m.type === maintType && m.content === content && (m.spec || '') === spec)) {
        return alert(`이미 유지관리 물품에 등록된 항목입니다. (${maintType})`);
    }

    const newItem = {
        id: Date.now(),
        type: maintType,
        detailType: maintType === '정기' ? 'PM 점검' : 'BM 점검',
        code: code,
        content: content,
        spec: spec,
        date: date,
        period: (maintType === '정기') ? period : null
    };

    data.maint.push(newItem);
    localStorage.setItem(key, JSON.stringify(data));
    // [수정] 상세 로그 기록
    addSystemLog('ADD_MAINTENANCE', currentPath.equip, `[${maintType}] ${content} (주기: ${period || '-'}일, 시작일: ${date})`);

    window.syncHistoryTransaction(currentPath.site, currentPath.equip, { maint_upserts: [newItem] });

    // 입력창 초기화
    document.getElementById('maint-content').value = '';
    if (specEl) specEl.value = '';
    if (maintType === '정기') document.getElementById('maint-period').value = '';

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
        // [추가] 자식 항목(추가작업)은 메인 유지관리 리스트에서 숨김 처리 (부모 로그의 '확인' 버튼으로 접근)
        if (item.originalLogId) return;

        // [추가] 비정기 예정 항목(완료일이 없는 상태)은 유지관리 리스트에서 숨김 처리
        if (item.type === '비정기' && !item.date) return;

        // [추가] "내용 없음" 또는 "장비 점검" 더미 항목은 리스트에 표시하지 않음
        if (item.content === '내용 없음' || item.content === '장비 점검') return;

        const status = calculateStatus(item.type, item.date, item.period);

        const template = getTemplateContent('maint-table-row-template');
        if (!template) return;
        const tr = template.querySelector('tr');

        tr.id = `row-${item.id}`;
        tr.draggable = isManagementMode; // [수정] 관리 모드일 때만 드래그 가능
        tr.dataset.id = item.id;
        tr.addEventListener('dragstart', () => tr.classList.add('dragging'));
        tr.addEventListener('dragend', () => {
            tr.classList.remove('dragging');
            handleMaintReorder();
        });

        const badge = tr.querySelector('.badge');
        if (badge) {
            badge.className = `badge ${(item.type || '정기').toLowerCase()}`;
            badge.textContent = item.type || '정기';
        }

        tr.querySelector('.edit-code').textContent = escapeHtml(item.code || '-');
        
        const contentCell = tr.querySelector('.edit-content');
        const safeContent = item.content || '';
        contentCell.textContent = safeContent;
        contentCell.dataset.rawContent = safeContent;
        contentCell.dataset.rawSpec = item.spec || '';
        
        const specCell = tr.querySelector('.edit-spec');
        if (specCell) {
            specCell.textContent = escapeHtml(item.spec || '-');
        }
        
        tr.querySelector('.edit-date').textContent = item.date;
        tr.querySelector('.edit-period').textContent = item.period ? item.period + '일' : '-';

        const statusCell = tr.querySelector('.status-cell');
        statusCell.className = `status-cell ${status.class}`;
        statusCell.textContent = status.text;

        tr.querySelector('.btn-edit-sm').onclick = () => toggleEditRow(item.id);
        tr.querySelector('.btn-del-sm').onclick = () => deleteDetailItem(item.id);

        maintBody.appendChild(tr);
    });

    document.getElementById('maint-count').textContent = `항목: ${data.maint.length}건`;

    // [추가] 유지관리 항목 입력 옵션 갱신
    if (typeof updateMaintContentOptions === 'function') updateMaintContentOptions();
}

// [수정] 유지관리 물품 입력창을 제안 박스(자동완성) 형태로 갱신하는 함수
window.updateMaintContentOptions = function (forceShowAll = false) {
    const activeBtn = document.querySelector('#maint-type-toggle .active');
    if (!activeBtn) return;
    const maintType = activeBtn.dataset.type;

    let contentElement = document.getElementById('maint-content');
    if (!contentElement) return;

    // 만약 기존에 select로 바뀌어져 있다면 다시 input으로 복구 (기존 버전 호환)
    if (contentElement.tagName.toLowerCase() === 'select') {
        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.id = 'maint-content';
        inputEl.className = contentElement.className;
        inputEl.style.cssText = contentElement.style.cssText;
        inputEl.placeholder = '유지관리 물품';
        inputEl.spellcheck = false;
        contentElement.parentNode.replaceChild(inputEl, contentElement);
        contentElement = inputEl;
    }

    // 제안 박스 래퍼 생성
    let wrapper = contentElement.closest('.autocomplete-wrapper');
    const ul = document.getElementById('maint-content-suggestions');
    
    if (wrapper && ul && contentElement.dataset.eventsBound !== 'true') {
        contentElement.dataset.eventsBound = 'true';
        
        // 이벤트 리스너 등록
        contentElement.addEventListener('click', () => window.renderMaintSuggestions());
        contentElement.addEventListener('input', () => {
            contentElement.removeAttribute('data-code'); // 타이핑 시 코드 초기화
            window.renderMaintSuggestions(false, true);
        });
        contentElement.addEventListener('focus', () => {
            const currentVal = contentElement.value.trim();
            const data = JSON.parse(localStorage.getItem('admin_items')) || [];
            if (data.some(item => item.part === currentVal)) {
                contentElement.dataset.lastValid = currentVal;
            }
            window.renderMaintSuggestions();
        });

        // [추가] 물품 상세 텍스트가 변경될 때 제안 박스 실시간 갱신 이벤트
        const specEl = document.getElementById('maint-spec');
        if (specEl) {
            specEl.addEventListener('input', () => {
                if (ul.style.display === 'block') window.renderMaintSuggestions(false, true);
            });
        }

        // 포커스를 잃을 때 목록에 없더라도 자유로운 텍스트 입력을 허용하도록 롤백 로직 제거
        contentElement.addEventListener('blur', () => {
            setTimeout(() => {
                ul.style.display = 'none';
            }, 150);
        });

        document.addEventListener('click', (e) => {
            if (e.target !== contentElement && !wrapper.contains(e.target)) {
                ul.style.display = 'none';
            }
        });
    }

    contentElement.placeholder = '물품명 입력 (또는 검색)';

    // 렌더링 함수 전역 연결
    window.renderMaintSuggestions = function (showAll = forceShowAll, isInput = false) {
        const ul = document.getElementById('maint-content-suggestions');
        if (!ul || contentElement.disabled) return;

        const data = JSON.parse(localStorage.getItem('admin_items')) || [];
        const equipModel = currentPath.equip ? currentPath.equip.split('::')[0] : '';
        const currentType = document.querySelector('#maint-type-toggle .active').dataset.type;

        // 이미 등록된 목록
        const key = `details_${currentPath.site}_${currentPath.equip}`;
        const currentData = JSON.parse(localStorage.getItem(key)) || { maint: [] };

        const query = contentElement.value.trim().toLowerCase();
        const keywords = query ? query.split(/\s+/) : [];

        // [추가] 현재 입력된 물품 상세 텍스트 가져오기
        const specEl = document.getElementById('maint-spec');
        const currentSpec = specEl ? specEl.value.trim() : '';

        if (currentType === '정기' || currentType === '비정기') {

            let filteredItems = data.filter(item => {
                if (!item.part) return false; // 유령 물품(빈 데이터) 방지
                // [수정] 물품명과 물품 상세 조합이 완전히 동일한 항목이 이미 등록된 경우에만 제안 박스에서 제외
                const isDuplicate = currentData.maint.some(m => m.type === currentType && m.content === item.part && (m.spec || '') === currentSpec);
                if (isDuplicate) return false;
                return true;
            });

            let equipMatchedItems = filteredItems.filter(item => {
                if (item.equip) {
                    const equips = item.equip.split(',').map(e => e.trim());
                    return equips.includes(equipModel);
                }
                return false;
            });

            let itemsToShow = showAll ? filteredItems : equipMatchedItems;

            if (isInput && query) {
                // 검색어가 있으면 장비 상관없이 전체에서 매칭
                itemsToShow = filteredItems.filter(m => {
                    const text = `${m.part || ''} ${m.code || ''}`.toLowerCase();
                    return keywords.every(kw => text.includes(kw));
                });
            }

            ul.innerHTML = '';

            if (itemsToShow.length === 0) {
                ul.innerHTML = `<li class="suggestion-item list-empty-msg" style="text-align:center;">등록할 ${currentType} 물품이 없음</li>`;
            } else {
                itemsToShow.forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'suggestion-item';
                    li.innerHTML = `
                        <div class="suggestion-item-content">
                            <span>${item.code ? escapeHtml(item.code) : escapeHtml(item.part)}</span>
                            ${item.code ? `<span class="abbr">${escapeHtml(item.part)}</span>` : ''}
                        </div>
                    `;
                    li.addEventListener('mousedown', (ev) => {
                        ev.preventDefault();
                        contentElement.value = item.part;
                        contentElement.dataset.code = item.code || '';
                        contentElement.dataset.lastValid = item.part;
                        contentElement.classList.remove('error-border');

                        ul.style.display = 'none';
                    });
                    ul.appendChild(li);
                });

                // 더보기 버튼
                if (!showAll && !isInput && equipMatchedItems.length < filteredItems.length) {
                    const moreLi = document.createElement('li');
                    moreLi.className = 'suggestion-item';
                    moreLi.style.textAlign = 'center';
                    moreLi.style.fontWeight = 'bold';
                    moreLi.style.color = '#58a6ff';
                    moreLi.style.borderTop = '1px solid #30363d';
                    moreLi.style.position = 'sticky';
                    moreLi.style.bottom = '0';
                    moreLi.style.background = '#161b22';
                    moreLi.style.padding = '10px';
                    moreLi.textContent = '⬇️ 더보기 (전체 물품)';
                    moreLi.addEventListener('mousedown', (ev) => {
                        ev.preventDefault();
                        window.renderMaintSuggestions(true);
                    });
                    ul.appendChild(moreLi);
                }
            }
            ul.style.display = 'block';
        } else {
            ul.style.display = 'none';
        }
    };
};

function calculateStatus(type, start, period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [y, m, d] = start.split('-').map(Number);
    const startDate = new Date(y, m - 1, d);
    const oneDay = 24 * 60 * 60 * 1000;

    if (type === '정기') {
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

        window.syncHistoryTransaction(currentPath.site, currentPath.equip, { maint_deletes: [id.toString()] });

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
    const specCell = row.querySelector('.edit-spec');
    const dateCell = row.querySelector('.edit-date');
    const periodCell = row.querySelector('.edit-period');

    if (!isEditing) {
        // [수정 모드 시작]
        row.classList.add('editing');
        editBtn.textContent = '✅';
        editBtn.style.color = '#238636';

        // [수정] 코드명, 물품명은 수정 불가하도록 contentEditable 속성 적용 제거

        // [수정] 주기(Period) 입력창을 number 타입으로 변경하여 숫자만 입력 가능하게 함
        if (row.querySelector('.badge').textContent === '정기') {
            const currentPeriod = periodCell.textContent.replace('일', '').trim();
            periodCell.innerHTML = `<input type="number" id="input-period-${id}" value="${escapeHtml(currentPeriod)}" class="edit-period-input" min="0" oninput="if(this.value < 0) this.value = Math.abs(this.value)">`;
        }

        if (specCell) {
            const currentSpec = specCell.textContent.trim() === '-' ? '' : specCell.textContent.trim();
            specCell.innerHTML = `<input type="text" id="input-spec-${id}" value="${escapeHtml(currentSpec)}" class="edit-spec-input input-dark" style="width: 100%; box-sizing: border-box; padding: 4px;">`;
        }

        const currentDate = dateCell.textContent.trim();
        dateCell.innerHTML = `<input type="date" id="input-date-${id}" value="${escapeHtml(currentDate)}" class="edit-date-input" style="width: 100%; box-sizing: border-box;">`;
        const dateInput = document.getElementById(`input-date-${id}`);
        if (dateInput) dateInput.focus();
    } else {
        // [데이터 저장]
        const newCode = codeCell.textContent.trim() === '-' ? '' : codeCell.textContent.trim();
            const newContent = contentCell.textContent.trim();
            const specInput = document.getElementById(`input-spec-${id}`);
            const newSpec = specInput ? specInput.value.trim() : '';
        const dateInput = document.getElementById(`input-date-${id}`);
        const newDate = dateInput ? dateInput.value : '';

        // [수정] 주기 값 가져오기 (input이 있으면 input 값, 없으면 텍스트)
        let newPeriod = periodCell.textContent.replace('일', '').trim();
        const periodInput = document.getElementById(`input-period-${id}`);
        if (periodInput) {
            newPeriod = periodInput.value;
        }

        if (!newDate) return alert('날짜를 선택해주세요.');

        updateRowData(id, newCode, newContent, newSpec, newDate, newPeriod);

        row.classList.remove('editing');
        editBtn.textContent = '✏️';
        editBtn.style.color = '';

        renderDetails(); // 화면 갱신 시 다시 텍스트로 복구 및 재계산
    }
}

function updateRowData(id, code, content, spec, date, period) {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));
    const idx = data.maint.findIndex(item => item.id === id);

    if (idx > -1) {
        data.maint[idx].code = code;
        data.maint[idx].content = content;
        data.maint[idx].spec = spec;
        data.maint[idx].date = date;
        data.maint[idx].period = (data.maint[idx].type === '정기') ? (parseInt(period) || 0) : null;
        localStorage.setItem(key, JSON.stringify(data));
        addSystemLog('UPDATE_MAINTENANCE', currentPath.equip, `수정: [${code || '-'}] ${content} (날짜: ${date}, 주기: ${period || '-'})`);

        window.syncHistoryTransaction(currentPath.site, currentPath.equip, { maint_upserts: [data.maint[idx]] });
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

// [추가] 다른 작업 수행 전, 저장되지 않은 메모 변경사항을 확인하고 처리하는 함수
function checkMemoUnsavedChanges() {
    // 점검 이력은 모두 완료처리된 작업이므로(읽기 전용) 저장 변경사항 확인할 필요 없음
    return true;
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

    // [수정] 일정 변경(<변동>)으로 자동 생성된 이력은 장비 점검 이력 화면에서 숨김 처리
    // [수정] 자식 로그(추가작업)도 메인 리스트에서 숨김 처리 (부모 로그의 '확인' 버튼을 통해서만 접근)
    let displayLogs = data.logs.filter(log => log.detailType !== '일정변경' && !log.originalLogId);

    // 1. 검색 필터 적용
    const searchInput = document.getElementById('log-search');
    if (searchInput) {
        const keyword = searchInput.value.trim().toLowerCase();
        if (keyword) {
            displayLogs = displayLogs.filter(log => {
                const searchableParentValues = [
                    log.worker, log.date, log.content, log.memo, log.type, log.detailType, log.md
                ];
                const matchParent = searchableParentValues.some(val => val && val.toString().toLowerCase().includes(keyword));
                
                const childLogs = data.logs.filter(l => l.originalLogId == log.id);
                const matchChild = childLogs.some(clog => {
                    const searchableChildValues = [
                        clog.worker, clog.content, clog.memo, clog.type, clog.detailType
                    ];
                    return searchableChildValues.some(val => val && val.toString().toLowerCase().includes(keyword));
                });

                return matchParent || matchChild;
            });
        }
    }

    // 2. 최신순 정렬
    let sortedLogs = displayLogs.sort((a, b) => {
        if (b.date !== a.date) {
            return b.date.localeCompare(a.date);
        }
        return b.id - a.id;
    });

    const getLogBadgeClass = (t, dt) => {
        if (!t) return 'default';
        return t.replace(/\s/g, ''); // 공백 제거하여 CSS 클래스명으로 반환
    };

    logBody.innerHTML = ''; // Clear previous content

    sortedLogs.forEach(log => {
        const template = getTemplateContent('log-table-row-template');
        if (!template) return;
        const tr = template.querySelector('tr');

        tr.id = `log-row-${log.id}`;
        tr.onclick = () => selectLog(log.id);
        if (selectedLogId === log.id) tr.classList.add('active-log');

        const dateCell = tr.querySelector('.log-date');
        const dateMatch = (log.date || '').match(/^20(\d{2})-(\d{2})-(\d{2})$/);
        dateCell.dataset.rawDate = escapeHtml(log.date || '');
        dateCell.textContent = dateMatch ? `${dateMatch[1]}. ${dateMatch[2]}. ${dateMatch[3]}` : (log.date || '-');

        const badge = tr.querySelector('.badge');
        badge.className = `badge ${getLogBadgeClass(log.type, log.detailType)}`;
        badge.textContent = escapeHtml(log.type || '정기');

        const detailTypeCell = tr.querySelector('.log-detail-type');
        let displayDetailType = log.detailType || '-';
        if (displayDetailType.includes(' > ')) {
            const parts = displayDetailType.split(' > ');
            displayDetailType = `${parts[0].trim()} [${parts[1].trim()}]`;
        } else if (log.detailType2 && log.detailType2.includes(' > ')) {
            const parts = log.detailType2.split(' > ');
            displayDetailType = `${parts[0].trim()} [${parts[1].trim()}]`;
        }
        detailTypeCell.title = escapeHtml(displayDetailType);
        detailTypeCell.textContent = escapeHtml(displayDetailType);

        const contentCell = tr.querySelector('.log-content');
        let displayContent = log.content || '-';
        let tooltipContent = log.content || '';
        if (log.content && log.content.includes(', ')) {
            const items = log.content.split(', ').map(s => s.trim());
            if (items.length > 1) {
                displayContent = `${items[0]} 외 ${items.length - 1}개`;
                tooltipContent = items.join('\n');
            }
        }
        contentCell.title = escapeHtml(tooltipContent);
        contentCell.dataset.rawContent = escapeHtml(log.content || '');
        contentCell.textContent = escapeHtml(displayContent);

        const addWorkCell = tr.querySelector('.log-add-work');
        if (addWorkCell) {
            const targetLogId = log.originalLogId || log.id;
            const childLogs = data.logs.filter(l => l.originalLogId == targetLogId);
            const childMaints = data.maint ? data.maint.filter(m => m.originalLogId == targetLogId) : [];
            const hasExtra = childLogs.length > 0 || childMaints.length > 0;
            
            const btnAdd = addWorkCell.querySelector('.btn-add-extra-work');
            if (btnAdd) {
                btnAdd.onclick = (e) => {
                    e.stopPropagation();
                    openAddWorkModal(targetLogId, escapeHtml(log.date));
                };
            }
            
            const btnView = addWorkCell.querySelector('.btn-view-extra-work');
            if (btnView) {
                if (hasExtra) {
                    btnView.style.display = 'inline-block';
                    btnView.onclick = (e) => {
                        e.stopPropagation();
                        window.openExtraWorkHistoryModal(currentPath.site, currentPath.equip, targetLogId);
                    };
                } else {
                    btnView.style.display = 'none';
                }
            }
        }
        
        const issueShareCell = tr.querySelector('.log-issue-share');
        if (issueShareCell) {
            const isShared = !!log.isIssueShared;
            const cb = issueShareCell.querySelector('.issue-share-checkbox');
            if (cb) {
                cb.checked = isShared;
                const userRole = sessionStorage.getItem('userRole');
                cb.disabled = (userRole !== 'admin' && userRole !== 'superadmin');
                cb.onclick = (e) => {
                    e.stopPropagation();
                    window.toggleIssueShare(log.id, e.target.checked);
                };
            }
        }

        logBody.appendChild(tr);
    });
}

function selectLog(id, focus = true) {
    // 다른 로그 선택 시 저장되지 않은 메모 확인
    if (selectedLogId !== null && selectedLogId !== id) {
        checkMemoUnsavedChanges();
    }

    // 이미 선택된 항목을 다시 클릭하면 무시
    if (selectedLogId === id) return;

    selectedLogId = id; // 전역 변수에 현재 선택된 ID 저장
    localStorage.setItem(`lastLog_${currentPath.site}_${currentPath.equip}`, id);

    // UI: 선택된 행 강조 스타일 적용
    document.querySelectorAll('#log-table-body tr').forEach(tr => tr.classList.remove('active-log'));
    const targetRow = document.getElementById(`log-row-${id}`);
    if (targetRow) targetRow.classList.add('active-log');
    
    // [수정] 행이 편집 모드였다면 일반 모드로 복구 (Re-render)
    renderLogs();

    // 해당 로그의 메모 데이터 불러오기
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    const data = JSON.parse(localStorage.getItem(key));
    const logItem = data.logs.find(l => l.id === id);

    if (logItem) {
        const memo = logItem.memo || "";
        const worker = logItem.worker || "";
        const md = logItem.md || "";
        const costType = logItem.costType || "유상";

        document.getElementById('device-memo').value = memo;
        const workerInput = document.getElementById('memo-worker');
        if (workerInput) {
            workerInput.value = worker;
            const trigger = document.getElementById('memo-worker-trigger');
            if (trigger) {
                const arr = worker ? worker.split(',').map(s => s.trim()).filter(Boolean) : [];
                if (arr.length > 0) trigger.textContent = arr.join(' ');
                else trigger.textContent = '작업자 선택';
                trigger.title = arr.join(', ');
            }
        }

        const memoMdInput = document.getElementById('memo-md');
        if (memoMdInput) memoMdInput.value = md;

        const memoCostTypeInput = document.getElementById('memo-cost-type');
        if (memoCostTypeInput) memoCostTypeInput.value = costType;

        originalMemo = memo; // 원본 저장
        originalWorker = worker; // 원본 저장
        originalMd = md;
        originalCostType = costType;

        // 항상 읽기 전용(잠금) 상태 유지
        setMemoFieldsDisabled(true);
        }
}
        
// [추가] 추가작업 팝업 호출 및 콜백 처리
window.openAddWorkModal = function (logId, dateStr) {
    if (typeof openRegisterScheduleModal === 'function') {
        window.currentAddWorkLogId = logId; // 현재 작업 중인 로그 ID 임시 저장
        if (typeof currentSearchFilters === 'undefined') {
            window.currentSearchFilters = { site: currentPath.site, equip: currentPath.equip };
        } else {
            currentSearchFilters.site = currentPath.site;
            currentSearchFilters.equip = currentPath.equip;
        }

        // [추가] 추가 작업을 위해 원본 로그 데이터 가져오기
        const key = `details_${currentPath.site}_${currentPath.equip}`;
        const data = JSON.parse(localStorage.getItem(key));
        const logItem = data.logs.find(l => l.id === logId);

        // [수정] 원본 작업 내용은 복사하지 않도록 새로운 객체 생성
        const presetData = {
            type: logItem ? logItem.type : '정기',
            detailType: logItem ? logItem.detailType : '',
            detailType2: logItem ? logItem.detailType2 : '',
            worker: logItem ? logItem.worker : '',
            content: '' // [요청] 추가 작업 시 내용은 비워둠
        };

        // [수정] 추가 작업 등록 시 기본 날짜를 오늘로 설정하고, 설정된 데이터를 presetData로 전달
        const todayStr = new Date().toISOString().substring(0, 10);
        openRegisterScheduleModal(todayStr, presetData);
    } else {
        alert('작업 등록 팝업창을 열 수 없습니다. (팝업 스크립트 없음)');
    }
};

window.updateLogAddWork = function (logId, newWorkContent) {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));
    if (data && data.logs) {
        const logItem = data.logs.find(l => l.id === logId);
        if (logItem) {
            if (logItem.addWork && logItem.addWork !== '-') {
                logItem.addWork += ', ' + newWorkContent;
            } else {
                logItem.addWork = newWorkContent;
            }
            localStorage.setItem(key, JSON.stringify(data));
            renderLogs();
        }
    }
};


// [추가] 세부구분 목록 가져오기 헬퍼 함수 (중복 제거)
function getSubCategories(type) {
    const equipKey = currentPath.equip;
    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    const key = `${equipKey}::${type}`;
    const defaultSubCategories = {
        '정기': ['PM 점검'],
        '비정기': ['BM 점검', 'Alarm', 'Hunting', 'Data / Para 이상', '기타'],
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

// [추가] 세부구분 2 목록 가져오기 헬퍼 함수 (초기값 연동)
function getSubCategories2(equipKey, type, detailType) {
    const catData = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
    const key = `${equipKey}::${type}::${detailType}`;
    const defaultSubCategories2 = {
        'BM 점검': ['BM 물품 교체'],
        'Alarm': ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람'],
        'Hunting': ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅'],
        'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈'],
        '기타': ['배수 펌프 이슈', '구동 이상']
    };

    let subCategories2 = catData[key];
    if (!subCategories2 || subCategories2.length === 0) {
        if (type === '비정기' && defaultSubCategories2[detailType]) {
            subCategories2 = [...defaultSubCategories2[detailType]];
        } else {
            subCategories2 = [];
        }
    }
    return subCategories2;
}

// [추가] 점검 항목(내용) 목록 가져오기 헬퍼 함수 (중복 제거 및 호환성 유지)
function getCheckTypeItems(type, detailType, detailType2 = '') {
    const equipKey = currentPath.equip;
    const itemData = JSON.parse(localStorage.getItem('check_type_items')) || {};
    let key;
    if (type === '비정기') {
        key = `${equipKey}::${type}::${detailType}::${detailType2}`;
    } else {
        key = `${equipKey}::${type}::${detailType}`;
    }

    let rawItems = [];
    if (itemData.hasOwnProperty(key)) {
        rawItems = itemData[key] || [];
    } else {
        // 기본값 동적 생성 (Admin 방문 전 바로 사용할 경우 대비)
        if (type === '비정기' && ['Alarm', 'Hunting', 'Data / Para 이상'].includes(detailType)) {
            const defaultList = [
                "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 / 용자 이상",
                "파트 이상 (교체)", "파트 이상 (수리)", "프로그램 이상", "단순조치", "기타"
            ];
            rawItems = defaultList.map((content, index) => ({
                id: Date.now() + index,
                content: content
            }));
        } else if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
            const equipName = equipKey.split('::')[0];
            const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            let matchedItems = adminItems.filter(item => {
                if (!item.equip) return false;
                const equips = item.equip.split(',').map(e => e.trim());
                return equips.includes(equipName);
            });
            if (matchedItems.length === 0) {
                matchedItems = adminItems;
            }
            rawItems = matchedItems.map((mItem, index) => ({
                id: Date.now() + index,
                content: mItem.part
            }));
        }
    }

    // 원본 데이터 오염을 막기 위해 복사본 생성
    const items = [...rawItems].map(item => ({ ...item }));

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    // [추가] 현재 장비의 유지관리 물품에서 우선순위 항목 가져오기 (PM 점검/BM 점검)
    let priorityItems = [];
    if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
        const maintKey = `details_${currentPath.site}_${currentPath.equip}`;
        const maintData = JSON.parse(localStorage.getItem(maintKey)) || {};
        if (maintData.maint) {
            priorityItems = maintData.maint
                .map(m => ({ content: m.content, code: m.code || '' }));
        }
    }

    // content 필드를 기준으로 중복 항목 완벽히 제거
    const uniqueItems = [];
    const seenContents = new Set();

    // 1. 우선순위 항목(유지관리 물품) 먼저 추가
    for (const item of priorityItems) {
        if (!seenContents.has(item.content)) {
            seenContents.add(item.content);
            if (!item.code) {
                const match = adminItems.find(a => a.part === item.content);
                if (match && match.code) item.code = match.code;
            }
            uniqueItems.push(item);
        }
    }

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
   5. 모달 및 팝업 관리 (Modals & Popups)
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
        'custEquipName', 'projectNo', 'equipStatus', 'deliveryDate', 'warrantyStart', 'warrantyPeriod', 'building', 'floor', 'detailLoc',
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
        'custEquipName', 'projectNo', 'equipStatus', 'deliveryDate', 'warrantyStart', 'warrantyPeriod', 'building', 'floor', 'detailLoc',
        'manager', 'contact', 'email',
        'custManager', 'custContact', 'custEmail'
    ];

    const newSetup = {};
    fields.forEach(field => {
        const el = document.getElementById(`maint-modal-${field}`);
        newSetup[field] = el ? el.value : (data.setup[field] || "");
    });
    Object.keys(data.setup).forEach(k => {
        if (!fields.includes(k)) newSetup[k] = data.setup[k];
    });
    data.setup = newSetup;

    localStorage.setItem(key, JSON.stringify(data));

    if (typeof addSystemLog === 'function') {
        addSystemLog('UPDATE_SETUP', equip, '장비 정보 수정 (Maintenance Page)');
    }

    if (typeof window.syncAdminDB === 'function') {
        window.syncAdminDB('equip', 'UPDATE', { old_id: equip, new_id: equip, site: site, setup: newSetup, special_note: data.specialNote || '' });
    }

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

    // [추가] 100% DB 동기화를 위해 기존 항목 ID 추출
    const oldMaintIds = targetData.maint ? targetData.maint.map(m => m.id.toString()) : [];

    targetData.maint = newMaint;

    localStorage.setItem(targetKey, JSON.stringify(targetData));

    if (typeof window.syncHistoryTransaction === 'function') {
        window.syncHistoryTransaction(currentPath.site, currentPath.equip, { maint_deletes: oldMaintIds, maint_upserts: newMaint });
    }

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

    if (typeof window.syncAdminDB === 'function') {
        window.syncAdminDB('equip', 'UPDATE', { old_id: currentPath.equip, new_id: currentPath.equip, site: currentPath.site, setup: data.setup || {}, special_note: data.specialNote });
    }

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
   [추가] 메모/작업내용 필드 비활성화 제어 (Memo Fields State Control)
   ========================================================================== */
function setMemoFieldsDisabled(disabled) {
    const memoInput = document.getElementById('device-memo');
    if (memoInput) {
        memoInput.readOnly = disabled;
        memoInput.style.opacity = '1';
        memoInput.style.cursor = disabled ? 'default' : 'text';
    }

    const costType = document.getElementById('memo-cost-type');
    const mdInput = document.getElementById('memo-md');
    const workerTrigger = document.getElementById('memo-worker-trigger');

    if (costType) {
        costType.style.pointerEvents = disabled ? 'none' : 'auto';
        costType.style.opacity = '1';
    }
    if (mdInput) {
        mdInput.readOnly = disabled;
        mdInput.style.pointerEvents = disabled ? 'none' : 'auto';
        mdInput.style.opacity = '1';
    }
    if (workerTrigger) {
        workerTrigger.style.pointerEvents = disabled ? 'none' : 'auto';
        workerTrigger.style.opacity = '1';
        workerTrigger.style.cursor = disabled ? 'default' : 'pointer';
    }
}

// [추가] 리스트에서 직접 이슈 공유 상태를 토글하는 함수
window.toggleIssueShare = function(logId, isChecked) {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));
    if (data && data.logs) {
        const idx = data.logs.findIndex(l => l.id === logId);
        if (idx > -1) {
            const targetParentId = data.logs[idx].originalLogId || data.logs[idx].id;
            let logUpserts = [];
            data.logs.forEach(l => {
                let isModified = false;
                if (l.id == logId || l.originalLogId == logId || l.originalLogId == targetParentId || l.id == targetParentId) {
                    if (!!l.isIssueShared !== isChecked) {
                        l.isIssueShared = isChecked;
                        isModified = true;
                    }
                }
                if (isModified) logUpserts.push(l);
            });

            localStorage.setItem(key, JSON.stringify(data));
            if (typeof window.syncHistoryTransaction === 'function') window.syncHistoryTransaction(currentPath.site, currentPath.equip, { log_upserts: logUpserts });
            if (typeof window.addSystemLog === 'function') window.addSystemLog('UPDATE_LOG_ISSUE_SHARE', currentPath.equip, `이슈 공유 ${isChecked ? '설정' : '해제'} (LogID: ${logId})`);
        }
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
window.toggleMaintenanceMode = toggleMaintenanceMode; // 인라인 onclick 호환 지원용

// [추가] 캘린더뷰 이동 로직
window.moveToCalendarView = function () {
    if (!currentPath.site || !currentPath.equip) {
        alert('장비를 선택해주세요.');
        return;
    }

    // 저장되지 않은 변경사항 확인
    const currentMemo = document.getElementById('device-memo') ? document.getElementById('device-memo').value : "";
    const currentWorker = document.getElementById('memo-worker') ? document.getElementById('memo-worker').value : "";
    if (selectedLogId !== null && (currentMemo !== originalMemo || currentWorker !== originalWorker)) {
        if (!confirm('작성 중인 작업 내용(메모)이 저장되지 않았습니다. 저장하지 않고 이동하시겠습니까?')) {
            return;
        }
    }

    const equipName = currentPath.equip.split('::')[0];

    // 운영 관리 대시보드 및 캘린더 필터 설정
    const maintFilter = { site: currentPath.site, equip: equipName, serial: currentPath.equip, search: { site: currentPath.site, equip: currentPath.equip } };
    localStorage.setItem('maintDashboardFilter', JSON.stringify(maintFilter));
    localStorage.setItem('lastHomeSection', 'maint');

    // 홈 화면으로 이동
    window.location.href = '/?scrollTo=calendar';
};