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
    // [추가] 비용처리 입력 드롭다운 동적 생성 (작업자 입력창 앞)
    const workerInput = document.getElementById('log-worker') || document.getElementById('log-md');
    if (workerInput && !document.getElementById('log-cost-type')) {
        const costSelect = document.createElement('select');
        costSelect.id = 'log-cost-type';
        costSelect.className = 'input-dark';
        const templateContent = getTemplateContent('log-cost-type-options-template');
        if (templateContent) costSelect.appendChild(templateContent);
        workerInput.parentNode.insertBefore(costSelect, workerInput);
    }

    // [수정] 중복되거나 불필요한 테이블 헤더(공수, 작업자, 비용처리) 제거
    const logTableTheadTr = document.querySelector('#log-list-wrapper .data-table thead tr');
    if (logTableTheadTr) {
        for (let i = logTableTheadTr.children.length - 1; i >= 0; i--) {
            const txt = logTableTheadTr.children[i].textContent;
            if (txt === '공수' || txt === '작업자' || txt === '비용처리') {
                logTableTheadTr.children[i].remove();
            }
        }
    }

    // [수정] log-md를 log-worker로 변경하고 드롭다운 래퍼 적용 (공수 직접 입력 제거)
    if (workerInput && workerInput.id === 'log-md') {
        workerInput.id = 'log-worker';
        workerInput.placeholder = '작업자 선택';
        workerInput.type = 'text';
        workerInput.removeAttribute('min');
    } else if (workerInput && workerInput.id === 'log-worker') {
        workerInput.style.display = 'inline-block';
    }

    // 작업자 선택 드롭다운 생성
    if (workerInput && !document.getElementById('log-worker-wrapper')) {
        const workerContainer = document.createElement('div');
        workerContainer.id = 'log-worker-wrapper';
        workerContainer.className = 'log-select-wrapper';
        workerContainer.style.flex = '0.8';
        workerContainer.style.minWidth = '100px';
        workerContainer.style.marginRight = '5px';

        workerContainer.innerHTML = `
            <div id="log-worker-trigger" class="log-select-trigger" style="width: 100%; box-sizing: border-box; background: var(--cal-bg-dark);">작업자 선택</div>
            <div id="log-worker-dropdown" class="log-select-dropdown">
                <input type="text" id="log-worker-search" class="dropdown-search-input" placeholder="이름 검색...">
                <div id="log-worker-list" class="log-select-list"></div>
                <div class="log-select-footer">
                    <button type="button" id="btn-log-worker-confirm" class="btn-blue-sm" style="width: 100%;">선택 완료</button>
                </div>
            </div>
        `;
        workerInput.parentNode.insertBefore(workerContainer, workerInput);
        workerInput.type = 'hidden';

        const trigger = document.getElementById('log-worker-trigger');
        const dropdown = document.getElementById('log-worker-dropdown');
        const searchInput = document.getElementById('log-worker-search');
        const listContainer = document.getElementById('log-worker-list');
        const confirmBtn = document.getElementById('btn-log-worker-confirm');

        // 초기값 설정 (현재 사용자)
        const currentUserName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
        if (currentUserName) {
            workerInput.value = currentUserName;
            trigger.textContent = currentUserName;
            trigger.title = currentUserName;
        }

        const renderWorkers = async (searchTerm = '') => {
            const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames() : [];
            const currentSelected = workerInput.value ? workerInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
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

            listContainer.innerHTML = displayWorkers.map(w => {
                const isSelected = currentSelected.includes(w.name);
                const subInfo = (w.department || w.position) ? ` <span style="font-size:11px; color:#8b949e;">(${escapeHtml(w.department)} ${escapeHtml(w.position)})</span>` : '';
                return `<div class="log-select-item ${isSelected ? 'selected' : ''}" data-value="${escapeHtml(w.name)}"><span>${escapeHtml(w.name)}${subInfo}</span></div>`;
            }).join('');

            if (displayWorkers.length === 0) listContainer.innerHTML = `<div class="log-select-empty-msg" style="padding:10px; color:#8b949e; text-align:center;">검색 결과가 없습니다.</div>`;

            listContainer.querySelectorAll('.log-select-item').forEach(item => {
                item.onclick = (e) => {
                    e.stopPropagation();
                    item.classList.toggle('selected');
                    updateWorkerSelection();
                };
            });
        };

        const updateWorkerSelection = () => {
            const selected = Array.from(listContainer.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
            workerInput.value = selected.join(', ');
            if (selected.length > 0) trigger.textContent = selected.join(' ');
            else trigger.textContent = '작업자 선택';
            trigger.title = selected.join(', ');
            trigger.classList.remove('error-border');
        };

        trigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
            dropdown.classList.toggle('show');
            if (dropdown.classList.contains('show')) renderWorkers(searchInput.value.trim());
        };

        searchInput.onclick = (e) => e.stopPropagation();
        searchInput.oninput = (e) => renderWorkers(e.target.value.trim());
        confirmBtn.onclick = (e) => { e.stopPropagation(); dropdown.classList.remove('show'); };
    }

    const logAddBtn = document.getElementById('log-add-btn') || document.getElementById('log-reg-btn');
    if (logAddBtn) logAddBtn.onclick = addLogItem;

    const memoSaveBtn = document.getElementById('memo-save-btn');
    if (memoSaveBtn) {
        memoSaveBtn.onclick = saveMemo;
    }

    const logDateInput = document.getElementById('log-date');
    if (logDateInput) logDateInput.value = new Date().toISOString().substring(0, 10);

    const logSearchInput = document.getElementById('log-search');
    if (logSearchInput) logSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') renderLogs();
    });

    const logTypeSelect = document.getElementById('log-type-select');
    if (logTypeSelect) {
        logTypeSelect.addEventListener('change', updateLogDetailTypeOptions);
    }

    const logDetailTypeSelect = document.getElementById('log-detail-type-select');

    // [추가] 세부구분 2 입력 드롭다운 동적 생성
    if (logDetailTypeSelect && !document.getElementById('log-detail-type2-select')) {
        const detail2Select = document.createElement('select');
        detail2Select.id = 'log-detail-type2-select';
        detail2Select.className = 'input-dark';
        detail2Select.style.display = 'none'; // 초기엔 숨김
        detail2Select.innerHTML = `<option value="" disabled selected hidden>세부 구분</option>`;
        logDetailTypeSelect.parentNode.insertBefore(detail2Select, logDetailTypeSelect.nextSibling);

        detail2Select.addEventListener('change', updateLogContentOptions);
    }

    // [추가] 파트 선택 드롭다운 (교체/수리용) 동적 생성 및 렌더링 함수 정의
    const contentNode = document.getElementById('log-content-input');
    if (contentNode && !document.getElementById('log-part-wrapper')) {
        const partWrapper = document.createElement('div');
        partWrapper.id = 'log-part-wrapper';
        partWrapper.className = 'log-select-wrapper';
        partWrapper.style.display = 'none'; // 초기 숨김
        partWrapper.style.flex = '3'; // 너비 확장
        partWrapper.style.minWidth = '300px'; // 최소 너비 확장
        const templateContent = getTemplateContent('log-part-wrapper-template');
        if (templateContent) partWrapper.appendChild(templateContent);
        contentNode.parentNode.insertBefore(partWrapper, contentNode.nextSibling);

        const pTrigger = document.getElementById('log-part-trigger');
        const pDropdown = document.getElementById('log-part-dropdown');
        const pAddBtn = document.getElementById('btn-log-part-add');

        if (pTrigger && pDropdown) {
            pTrigger.onclick = (e) => {
                e.stopPropagation();
                if (pTrigger.classList.contains('error-border')) pTrigger.classList.remove('error-border');
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => {
                    if (d !== pDropdown) d.classList.remove('show');
                });
                pDropdown.classList.toggle('show');
            };
        }
        if (pAddBtn && pDropdown) {
            pAddBtn.onclick = (e) => {
                e.stopPropagation();
                pDropdown.classList.remove('show');
            };
        }
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

        addBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
        };
    }

    // 메모 입력 감지 (버튼 색상 변경) 및 작업자 필드 동적 생성
    const memoInput = document.getElementById('device-memo');
    const memoBtn = document.getElementById('memo-save-btn');

    // [수정] 저장 버튼을 수정/저장 토글 버튼으로 변경
    if (memoSaveBtn) {
        memoSaveBtn.textContent = '수정';
        memoSaveBtn.classList.remove('btn-green-sm', 'btn-orange-sm');
        memoSaveBtn.classList.add('btn-blue-sm');

        memoSaveBtn.onclick = () => {
            if (memoSaveBtn.textContent === '수정') {
                if (!selectedLogId) return alert('수정할 로그 항목을 먼저 선택해주세요.');
                setMemoFieldsDisabled(false);
                memoSaveBtn.textContent = '저장';
                memoSaveBtn.classList.replace('btn-blue-sm', 'btn-green-sm');
                if (memoInput) memoInput.focus();
            } else {
                saveMemo();
            }
        };
    }

    if (memoInput && !document.getElementById('memo-worker-wrapper')) {
        const workerContainer = document.createElement('div');
        workerContainer.id = 'memo-worker-wrapper';
        workerContainer.className = 'memo-worker-wrapper';
        const templateContent = getTemplateContent('memo-worker-wrapper-template');
        if (templateContent) workerContainer.appendChild(templateContent);
        memoInput.parentNode.insertBefore(workerContainer, memoInput);

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
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
            dropdown.classList.toggle('show');
            if (dropdown.classList.contains('show')) renderWorkers(searchInput.value.trim());
        };

        searchInput.onclick = (e) => e.stopPropagation();
        searchInput.oninput = (e) => renderWorkers(e.target.value.trim());

        confirmBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.remove('show');
        };
    }

    // [추가] 특이 이슈 공유 체크박스를 저장 버튼 왼쪽으로 배치
    if (memoBtn && !document.getElementById('memo-issue-share-wrapper')) {
        const rightContainer = document.createElement('div');
        rightContainer.style.display = 'flex';
        rightContainer.style.alignItems = 'center';

        const issueShareWrapper = document.createElement('div');
        issueShareWrapper.id = 'memo-issue-share-wrapper';
        issueShareWrapper.className = 'issue-share-wrapper';
        issueShareWrapper.style.display = 'flex';
        issueShareWrapper.style.alignItems = 'center';
        issueShareWrapper.style.marginRight = '15px';

        const templateContent = getTemplateContent('memo-issue-share-wrapper-template');
        if (templateContent) {
            issueShareWrapper.appendChild(templateContent);
        } else {
            issueShareWrapper.innerHTML = `
                <label class="modal-checkbox-label" style="font-size: 13px; font-weight: bold; color: #f0883e; display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="memo-issue-share" class="modal-checkbox-input" style="margin-right: 5px; transform: scale(1.2);">
                    이슈 공유
                </label>
            `;
        }

        memoBtn.parentNode.insertBefore(rightContainer, memoBtn);
        rightContainer.appendChild(issueShareWrapper);
        rightContainer.appendChild(memoBtn);
    }

    const memoWorkerInput = document.getElementById('memo-worker');
    const memoMdInput = document.getElementById('memo-md');
    const memoCostTypeInput = document.getElementById('memo-cost-type');
    const issueShareCb = document.getElementById('memo-issue-share');

    if (memoInput) { memoInput.spellcheck = false; memoInput.readOnly = true; } // [수정] 초기 상태 읽기 전용
    if (memoWorkerInput) memoWorkerInput.spellcheck = false;

    const checkMemoChanges = () => {
        const currentIssueShared = issueShareCb ? issueShareCb.checked : false;
        const currentMd = memoMdInput ? memoMdInput.value.trim() : "";
        const currentCostType = memoCostTypeInput ? memoCostTypeInput.value : "유상";
        if (memoInput.value !== originalMemo || (memoWorkerInput && memoWorkerInput.value !== originalWorker) || currentIssueShared !== originalIssueShared || currentMd !== originalMd || currentCostType !== originalCostType) {
            // [수정] 저장 버튼이 '저장' 상태일 때만 색상 변경
            if (memoBtn.textContent === '저장') memoBtn.classList.remove('btn-green-sm', 'btn-blue-sm');
            memoBtn.classList.add('btn-orange-sm');
        } else {
            memoBtn.classList.remove('btn-orange-sm', 'btn-blue-sm');
            memoBtn.classList.add('btn-green-sm');
        }
    };

    if (memoInput) {
        memoInput.addEventListener('input', checkMemoChanges);
        memoInput.addEventListener('click', () => {
            if (selectedLogId === null) {
                alert('리스트를 먼저 선택해주세요.');
                memoInput.blur(); // 포커스 해제하여 입력 방지
            }
        });
    }

    if (memoWorkerInput) {
        memoWorkerInput.addEventListener('input', checkMemoChanges);
        memoWorkerInput.addEventListener('click', () => {
            if (selectedLogId === null) {
                alert('리스트를 먼저 선택해주세요.');
                memoWorkerInput.blur();
            }
        });
    }

    if (memoMdInput) {
        memoMdInput.addEventListener('input', checkMemoChanges);
        memoMdInput.addEventListener('click', () => {
            if (selectedLogId === null) {
                alert('리스트를 먼저 선택해주세요.');
                memoMdInput.blur();
            }
        });
    }

    if (memoCostTypeInput) {
        memoCostTypeInput.addEventListener('change', checkMemoChanges);
        memoCostTypeInput.addEventListener('click', () => {
            if (selectedLogId === null) {
                alert('리스트를 먼저 선택해주세요.');
                memoCostTypeInput.blur();
            }
        });
    }

    if (issueShareCb) {
        issueShareCb.addEventListener('change', checkMemoChanges);
    }

    // [추가] 초기에는 메모 영역 전체 비활성화 (톱니바퀴로 활성화)
    setMemoFieldsDisabled(true);

    // [수정] 로그 관리 모드 토글 버튼 이벤트 연결
    const btnLogSettings = document.getElementById('btn-log-settings');
    if (btnLogSettings) btnLogSettings.onclick = toggleLogManagementMode;

    // [추가] 장비 점검 이력 입력 폼 2줄 배치 (점검일/구분/세부구분 | 항목/작업자/기록)
    const logDetailTypeNode = document.getElementById('log-detail-type-select');
    if (logDetailTypeNode) {
        const rowContainer = logDetailTypeNode.closest('.form-row');
        if (rowContainer && !rowContainer.querySelector('.flex-break')) {
            const breakDiv = document.createElement('div');
            breakDiv.className = 'flex-break';
            const targetNode = document.getElementById('log-detail-type2-select') || logDetailTypeNode;
            rowContainer.insertBefore(breakDiv, targetNode.nextSibling);
        }
    }
}

function setupUIEvents() {
    // [추가] 비용처리 입력 드롭다운 동적 생성 (작업자 입력창 앞)
    const workerInput = document.getElementById('log-worker') || document.getElementById('log-md');
    if (workerInput && !document.getElementById('log-cost-type')) {
        const costSelect = document.createElement('select');
        costSelect.id = 'log-cost-type';
        costSelect.className = 'input-dark';
        costSelect.innerHTML = `
            <option value="" disabled selected hidden>비용처리</option>
            <option value="유상">유상</option>
            <option value="무상(보증)">무상(보증)</option>
            <option value="무상(중고)">무상(중고)</option>
            <option value="기타">기타</option>
        `;
        workerInput.parentNode.insertBefore(costSelect, workerInput);
    }

    // [수정] 중복되거나 불필요한 테이블 헤더(공수, 작업자, 비용처리) 제거
    const logTableTheadTr = document.querySelector('#log-list-wrapper .data-table thead tr');
    if (logTableTheadTr) {
        for (let i = logTableTheadTr.children.length - 1; i >= 0; i--) {
            const txt = logTableTheadTr.children[i].textContent;
            if (txt === '공수' || txt === '작업자' || txt === '비용처리') {
                logTableTheadTr.children[i].remove();
            }
        }
    }

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
        const memoSaveBtn = document.getElementById('memo-save-btn');
        // [수정] 수정 모드이고, 변경사항이 있을 때만 페이지 이탈 방지 경고 표시
        if (memoSaveBtn && memoSaveBtn.textContent === '저장' && memoSaveBtn.classList.contains('btn-orange-sm')) {
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
        } else if (maintType === '정기' || maintType === '비정기') {
            return alert('물품명은 제안 박스에서 검색하여 선택해야만 등록할 수 있습니다.');
        }
    }

    const dateEl = document.getElementById('maint-date');
    const periodEl = document.getElementById('maint-period');
    const date = dateEl ? dateEl.value : '';
    const period = periodEl ? periodEl.value : '';

    // [추가] 에러 테두리 초기화 및 유효성 검사
    [contentEl, dateEl, periodEl].forEach(el => {
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

    // 동일한 타입 내에서만 중복 확인 (정기/비정기 개별 관리)
    if (data.maint.some(m => m.type === maintType && (m.content === content || (code && m.code === code)))) {
        return alert(`이미 유지관리 물품에 등록된 항목입니다. (${maintType})`);
    }

    const newItem = {
        id: Date.now(),
        type: maintType,
        detailType: maintType === '정기' ? 'PM 점검' : 'BM 점검',
        code: code,
        content: content,
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
        tr.querySelector('.edit-content').textContent = escapeHtml(item.content);
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

    // [이동] 유지관리 물품 목록이 갱신될 때 로그 입력 폼의 항목 옵션도 함께 업데이트
    updateLogContentOptions();

    // [추가] 파일 리스트 갱신
    renderFiles();

    // [추가] 로그 구분, 세부구분, 내용 초기화 (Admin 연동)
    updateLogTypeOptions();

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
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'autocomplete-wrapper flex-grow';
        contentElement.parentNode.insertBefore(wrapper, contentElement);
        wrapper.appendChild(contentElement);
        contentElement.classList.remove('flex-grow');
        contentElement.style.width = '100%';

        const ul = document.createElement('ul');
        ul.id = 'maint-content-suggestions';
        ul.className = 'suggestion-list';
        // [수정] 7개 항목 높이 제한 (약 230px)
        ul.style.maxHeight = '230px';
        ul.style.overflowY = 'auto'; // 스크롤 활성화
        wrapper.appendChild(ul);

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

        // 포커스를 잃을 때 목록에 없는 임의의 텍스트가 입력되어 있다면 이전 유효값으로 롤백
        contentElement.addEventListener('blur', () => {
            setTimeout(() => {
                const activeBtn = document.querySelector('#maint-type-toggle .active');
                if (activeBtn && (activeBtn.dataset.type === '정기' || activeBtn.dataset.type === '비정기')) {
                    const currentVal = contentElement.value.trim();
                    const data = JSON.parse(localStorage.getItem('admin_items')) || [];
                    const isValid = data.some(item => item.part === currentVal);
                    if (!isValid) {
                        contentElement.value = contentElement.dataset.lastValid || '';
                        if (!contentElement.value) contentElement.removeAttribute('data-code');
                    } else {
                        contentElement.dataset.lastValid = currentVal;
                    }
                }
                ul.style.display = 'none';
            }, 150);
        });

        document.addEventListener('click', (e) => {
            if (e.target !== contentElement && !wrapper.contains(e.target)) {
                ul.style.display = 'none';
            }
        });
    }

    contentElement.placeholder = (maintType === '정기' || maintType === '비정기') ? '검색 후 선택 (직접 입력 불가)' : '항목 내용 입력';

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
        const addedParts = currentData.maint.map(item => item.content);

        const query = contentElement.value.trim().toLowerCase();
        const keywords = query ? query.split(/\s+/) : [];

        if (currentType === '정기' || currentType === '비정기') {

            let filteredItems = data.filter(item => {
                if (addedParts.includes(item.part)) return false;
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

        const currentDate = dateCell.textContent.trim();
        dateCell.innerHTML = `<input type="date" id="input-date-${id}" value="${escapeHtml(currentDate)}" class="edit-date-input" style="width: 100%; box-sizing: border-box;">`;
        const dateInput = document.getElementById(`input-date-${id}`);
        if (dateInput) dateInput.focus();
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
    const memoSaveBtn = document.getElementById('memo-save-btn');
    // "수정" 모드가 아니거나, 변경사항이 없으면 즉시 통과
    if (!memoSaveBtn || memoSaveBtn.textContent !== '저장' || !memoSaveBtn.classList.contains('btn-orange-sm')) {
        return true;
    }

    if (confirm("작업 내용에 저장되지 않은 변경사항이 있습니다. 저장하시겠습니까?")) {
        // "확인" 클릭: 저장 후 진행
        saveMemo();
    } else {
        // "취소" 클릭: 변경사항 원상복구 후 진행
        const memoInput = document.getElementById('device-memo');
        const workerInput = document.getElementById('memo-worker');
        const issueShareCb = document.getElementById('memo-issue-share');
        const memoMdInput = document.getElementById('memo-md');
        const memoCostTypeInput = document.getElementById('memo-cost-type');

        if (memoInput) memoInput.value = originalMemo;
        if (workerInput) {
            workerInput.value = originalWorker;
            const trigger = document.getElementById('memo-worker-trigger');
            if (trigger) {
                const arr = originalWorker ? originalWorker.split(',').map(s => s.trim()).filter(Boolean) : [];
                if (arr.length > 0) trigger.textContent = arr.join(' ');
                else trigger.textContent = '작업자 선택';
                trigger.title = arr.join(', ');
            }
        }
        if (issueShareCb) issueShareCb.checked = originalIssueShared;
        if (memoMdInput) memoMdInput.value = originalMd;
        if (memoCostTypeInput) memoCostTypeInput.value = originalCostType;

        // 버튼 및 필드 상태 원상복구
        memoSaveBtn.textContent = '수정';
        memoSaveBtn.classList.remove('btn-green-sm', 'btn-orange-sm');
        memoSaveBtn.classList.add('btn-blue-sm');
        setMemoFieldsDisabled(true);
    }
    return true; // 항상 다음 작업을 허용
}

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

    // 작업자 수로 공수 자동 계산
    const workerNames = workerInput.value.trim();
    const md = workerNames ? workerNames.split(',').filter(Boolean).length.toString() : "0";

    // [추가] 비용처리 값 가져오기
    const costSelect = document.getElementById('log-cost-type');
    const costType = costSelect ? costSelect.value : '';

    const addWorkInput = document.getElementById('log-add-work');
    const addWork = addWorkInput ? addWorkInput.value.trim() : '';

    let content = '';
    const contentInput = document.getElementById('log-content-input');
    const contentWrapper = document.getElementById('log-content-wrapper');
    const contentTrigger = document.getElementById('log-content-trigger');

    if (contentWrapper && contentWrapper.style.display !== 'none') {
        const list = document.getElementById('log-content-list');
        const selected = list ? list.querySelectorAll('.log-select-item.selected') : [];
        if (selected.length > 0) {
            content = Array.from(selected).map(el => {
                const costSelect = el.querySelector('.item-cost-select');
                return costSelect ? `[${costSelect.value}] ${el.dataset.value}` : el.dataset.value;
            }).join(', ');
        }
    } else {
        content = contentInput ? contentInput.value.trim() : '';
    }

    const detailType2Select = document.getElementById('log-detail-type2-select');
    const detailType2 = detailType2Select && detailType2Select.style.display !== 'none' ? detailType2Select.value : '';

    // [추가] 에러 테두리 초기화 및 유효성 검사
    const workerTrigger = document.getElementById('log-worker-trigger');
    const elementsToCheck = [dateInput, typeSelect, detailTypeSelect, detailType2Select, costSelect, workerInput, workerTrigger, contentInput, contentTrigger];
    elementsToCheck.forEach(el => {
        if (el) {
            el.classList.remove('error-border');
            el.removeEventListener('input', window.removeErrorBorder);
            el.addEventListener('input', window.removeErrorBorder);
            el.removeEventListener('change', window.removeErrorBorder);
            el.addEventListener('change', window.removeErrorBorder);
        }
    });

    let hasError = false;

    if (!date) { dateInput.classList.add('error-border'); hasError = true; }
    if (!type) { if (typeSelect) typeSelect.classList.add('error-border'); hasError = true; }
    if (!detailType && detailTypeSelect && !detailTypeSelect.disabled) { detailTypeSelect.classList.add('error-border'); hasError = true; }
    if (type === '비정기' && !detailType2 && detailType2Select && !detailType2Select.disabled) { detailType2Select.classList.add('error-border'); hasError = true; }
    if (!costType) { if (costSelect) costSelect.classList.add('error-border'); hasError = true; }
    if (!workerNames) {
        if (workerTrigger) workerTrigger.classList.add('error-border');
        else if (workerInput && workerInput.type !== 'hidden') workerInput.classList.add('error-border');
        hasError = true;
    }

    if (!content) {
        if (contentWrapper && contentWrapper.style.display !== 'none') {
            if (contentTrigger) contentTrigger.classList.add('error-border');
        } else {
            if (contentInput && !contentInput.disabled) contentInput.classList.add('error-border');
        }
        hasError = true;
    }

    if (hasError) {
        return alert('빨간색 테두리로 표시된 필수 항목을 모두 입력/선택해주세요.');
    }

    // 테이블과 데이터에 깔끔하게 표시하기 위해 세부구분 2를 병합
    const finalDetailType = (type === '비정기' && detailType2) ? `${detailType} > ${detailType2}` : detailType;

    // [추가] 같은 장비, 같은 날짜에 정기 PM 중복 등록 방지
    if (type === '정기' && finalDetailType.includes('PM 점검')) {
        const key = `details_${currentPath.site}_${currentPath.equip}`;
        let checkData = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [], memo: "" };
        const completedLog = (checkData.logs || []).find(l => l.date === date && l.type === '정기' && (l.detailType || '').includes('PM 점검') && l.detailType !== '일정변경');
        if (completedLog) {
            alert('이미 등록된 작업입니다.');
            selectLog(completedLog.id);
            const row = document.getElementById(`log-row-${completedLog.id}`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
    }

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [], memo: "" };
    if (!data.logs) data.logs = []; // 기존 데이터 호환성 처리

    // [수정] 중복 검사 제거 (같은 날짜에 여러 항목 기록 허용)

    // [추가] 파트 이상(교체/수리) 선택 시 파트 데이터 병합
    let isPartIssue = content.includes('파트 이상 (교체)') || content.includes('파트 이상 (수리)') || content.includes('용액 / 용자 이상');
    let partContent = '';

    const partWrapperObj = document.getElementById('log-part-wrapper');
    if (isPartIssue && partWrapperObj && partWrapperObj.style.display !== 'none') {
        const partList = document.getElementById('log-part-list');
        if (partList) {
            const selectedParts = partList.querySelectorAll('.log-select-item.selected');
            if (selectedParts.length > 0) {
                partContent = Array.from(selectedParts).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                }).join(', ');
            }
        }
        if (!partContent) {
            const partTrigger = document.getElementById('log-part-trigger');
            if (partTrigger) partTrigger.classList.add('error-border');
            return alert('교체/수리할 물품을 선택해주세요.');
        } else {
            content = `${content} - ${partContent}`;
        }
    }

    // 새 점검 기록 객체 생성
    const newLog = {
        id: Date.now(), // 고유 식별자
        date: date,
        type: type,
        detailType: detailType,
        detailType2: finalDetailType,
        content: content,
        addWork: addWork,
        costType: costType,
        md: md,
        worker: workerNames, // [수정] 작업자 세팅
        memo: "", // 상세 메모 초기값
        isIssueShared: false
    };

    data.logs.push(newLog);

    let payload = { log_upserts: [newLog], maint_upserts: [] };

    // [추가] PM/BM 점검 등록 시 유지관리 물품에 자동 추가 및 갱신 로직
    let isMaintUpdated = false;
    if (detailType === 'BM 점검' || detailType === 'PM 점검' || type === '고객대응' || content.includes('파트 이상 (교체)') || content.includes('파트 이상 (수리)') || content.includes('용액 / 용자 이상')) {
        let itemsList = [];
        if (content.includes(' - ')) {
            const partsStr = content.split(' - ')[1];
            if (partsStr) itemsList = partsStr.split(', ').map(s => s.trim()).filter(s => s);
        } else {
            itemsList = content.split(', ').map(s => s.trim()).filter(s => s);
        }

        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

        itemsList.forEach((itemText, idx) => {
            let code = '';
            let fullContent = itemText;
            let period = null;
            let itemCost = '';

            // [비용] 물품명 파싱
            const costMatch = itemText.match(/^\[(.*?)\] (.*)$/);
            if (costMatch) {
                itemCost = costMatch[1];
                itemText = costMatch[2];
                fullContent = itemText;
            }

            // Admin 물품 관리 데이터에서 코드명과 풀네임 검색
            const match = adminItems.find(a => a.part === itemText || a.code === itemText);
            if (match) {
                code = match.code || '';
                fullContent = match.part || itemText;
            }

            // [수정] 시스템에 등록된 물품(항목)이 아니면 유지관리 리스트에 자동 생성하지 않음
            if (!match) return;

            // 기존 유지관리 물품 리스트에 같은 항목이 있는지 확인 (풀네임 및 코드명 포함 매칭)
            let existingItem = data.maint.find(m => m.type === type && (m.content === fullContent || (code && m.code === code) || m.content === itemText));

            if (existingItem) {
                // 이미 존재하면 완료 기준이므로 시작일(date)을 갱신
                existingItem.date = date;
                if (itemCost) existingItem.itemCost = itemCost;
                isMaintUpdated = true;
                payload.maint_upserts.push(existingItem);
            } else {
                let isAdded = false;
                // [추가] 비정기 작업 시 기존 '정기' 항목이 있으면 날짜만 갱신하고 구분을 유지
                if (type === '비정기') {
                    let regItem = data.maint.find(m => m.type === '정기' && (m.content === fullContent || (code && m.code === code) || m.content === itemText));
                    if (regItem) {
                        regItem.date = date;
                        if (itemCost) regItem.itemCost = itemCost;
                        isMaintUpdated = true;
                        isAdded = true;
                        payload.maint_upserts.push(regItem);
                    }
                }

                if (!isAdded) {
                    const newMaintItem = {
                        id: Date.now() + 1000 + idx, // ID 충돌 방지
                        type: type,
                        detailType: detailType,
                        code: code,
                        content: fullContent,
                        date: date,
                        period: null,
                        itemCost: itemCost
                    };
                    data.maint.push(newMaintItem);
                    payload.maint_upserts.push(newMaintItem);
                    isMaintUpdated = true;
                    addSystemLog('ADD_MAINTENANCE', currentPath.equip, `[${type}] ${fullContent} (자동 등록, 시작일: ${date})`);
                }
            }
        });
    }

    localStorage.setItem(key, JSON.stringify(data));
    addSystemLog('ADD_LOG', currentPath.equip, `[${type} - ${finalDetailType}] ${content} (공수: ${md}, 날짜: ${date})`);

    window.syncHistoryTransaction(currentPath.site, currentPath.equip, payload);

    // 입력창 초기화 및 리스트 갱신
    if (workerInput) {
        const userName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
        workerInput.value = userName;
        const wTrigger = document.getElementById('log-worker-trigger');
        if (wTrigger) {
            wTrigger.textContent = userName || '작업자 선택';
            wTrigger.title = userName;
        }
    }
    if (costSelect) costSelect.value = '';
    if (detailType2Select) detailType2Select.value = '';
    if (contentTrigger) contentTrigger.textContent = '항목 선택';
    const mainList = document.getElementById('log-content-list');
    if (mainList) {
        mainList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));
    }
    const partWrapper = document.getElementById('log-part-wrapper');
    if (partWrapper) {
        partWrapper.style.display = 'none';
        const partTrigger = document.getElementById('log-part-trigger');
        if (partTrigger) partTrigger.textContent = '물품 선택';
        const partList = document.getElementById('log-part-list');
        if (partList) partList.innerHTML = '';
    }
    if (addWorkInput) addWorkInput.value = '';
    if (contentInput) contentInput.value = '';

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

    // [수정] 일정 변경(<변동>)으로 자동 생성된 이력은 장비 점검 이력 화면에서 숨김 처리
    let displayLogs = data.logs.filter(log => log.detailType !== '일정변경');

    // 1. 최신순 정렬
    let sortedLogs = displayLogs.sort((a, b) => {
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
                (log.detailType && log.detailType.toLowerCase().includes(keyword)) ||
                (log.md && log.md.includes(keyword))
            );
        }
    }

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
            const childLogs = data.logs.filter(l => l.originalLogId === targetLogId);
            const hasExtra = childLogs.length > 0;
            addWorkCell.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; width: 100%; gap: 4px;">
                    <button class="btn-blue-sm" style="padding: 2px 8px; font-size: 11px;" onclick="event.stopPropagation(); openAddWorkModal(${targetLogId}, '${escapeHtml(log.date)}');">추가</button>
                    ${hasExtra ? `<button class="btn-green-sm" style="padding: 2px 8px; font-size: 11px;" onclick="event.stopPropagation(); window.openExtraWorkHistoryModal('${currentPath.site}', '${currentPath.equip}', ${targetLogId});">확인</button>` : ''}
                </div>
            `;
        }

        tr.querySelector('.btn-edit-sm').onclick = (event) => {
            event.stopPropagation();
            toggleLogEdit(log.id, event.currentTarget);
        };
        tr.querySelector('.btn-del-sm').onclick = (event) => {
            event.stopPropagation();
            deleteLogItem(log.id);
        };

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

        const issueShareCb = document.getElementById('memo-issue-share');
        const isIssueShared = !!logItem.isIssueShared;
        if (issueShareCb) issueShareCb.checked = isIssueShared;

        originalMemo = memo; // 원본 저장
        originalWorker = worker; // 원본 저장
        originalIssueShared = isIssueShared;
        originalMd = md;
        originalCostType = costType;

        // [수정] 버튼 및 필드 상태를 '수정' 모드로 초기화
        setMemoFieldsDisabled(true);
        const memoBtn = document.getElementById('memo-save-btn');
        if (memoBtn) {
            memoBtn.textContent = '수정';
            memoBtn.classList.remove('btn-green-sm', 'btn-orange-sm');
            memoBtn.classList.add('btn-blue-sm');
        }
    }
}

function saveMemo() {
    if (!selectedLogId) return;

    const memoContent = document.getElementById('device-memo').value;
    const workerInput = document.getElementById('memo-worker');
    const workerContent = workerInput ? workerInput.value.trim() : "";
    const memoMdInput = document.getElementById('memo-md');
    const mdContent = memoMdInput ? memoMdInput.value.trim() : "";
    const memoCostTypeInput = document.getElementById('memo-cost-type');
    const costTypeContent = memoCostTypeInput ? memoCostTypeInput.value : "유상";
    const issueShareCb = document.getElementById('memo-issue-share');
    const isIssueShared = issueShareCb ? issueShareCb.checked : false;

    if (!workerContent) return alert('작업자를 입력해주세요.');
    if (mdContent && parseFloat(mdContent) < 0) return alert('공수는 0 이상이어야 합니다.');

    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));

    const logIdx = data.logs.findIndex(l => l.id === selectedLogId);
    if (logIdx > -1) {
        data.logs[logIdx].memo = memoContent; // 메모 업데이트
        data.logs[logIdx].worker = workerContent; // 작업자 업데이트
        data.logs[logIdx].md = mdContent; // 공수 업데이트
        data.logs[logIdx].costType = costTypeContent; // 비용처리 업데이트

        const targetParentId = data.logs[logIdx].originalLogId || data.logs[logIdx].id;
        let logUpserts = [];

        data.logs.forEach(l => {
            let isModified = false;
            if (l.id === selectedLogId) {
                isModified = true;
            }
            if (l.id == targetParentId || l.originalLogId == targetParentId) {
                if (!!l.isIssueShared !== isIssueShared) {
                    l.isIssueShared = isIssueShared;
                    isModified = true;
                }
            }
            if (isModified) {
                logUpserts.push(l);
            }
        });

        localStorage.setItem(key, JSON.stringify(data));
        addSystemLog('UPDATE_MEMO', currentPath.equip, `작업 내용 및 작업자 수정 (LogID: ${selectedLogId})`);

        originalMemo = memoContent; // 원본 업데이트
        originalWorker = workerContent;
        originalIssueShared = isIssueShared;
        originalMd = mdContent;
        originalCostType = costTypeContent;

        window.syncHistoryTransaction(currentPath.site, currentPath.equip, { log_upserts: logUpserts });

        // [수정] 저장 후 '수정' 모드로 전환
        const memoBtn = document.getElementById('memo-save-btn');
        if (memoBtn) {
            memoBtn.textContent = '수정';
            memoBtn.classList.remove('btn-green-sm', 'btn-orange-sm');
            memoBtn.classList.add('btn-blue-sm');
        }
        setMemoFieldsDisabled(true);

        renderLogs(); // 테이블에 변경된 공수 즉시 반영
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

    // [추가] 추가 작업으로 등록된 로그가 삭제될 경우, 원본 로그의 '이동' 버튼을 '추가' 버튼으로 되돌리기
    let payload = { log_deletes: [id.toString()], log_upserts: [] };
    if (targetLog && targetLog.originalLogId) {
        const originalLog = data.logs.find(l => l.id === targetLog.originalLogId);
        if (originalLog) {
            originalLog.addWorkLogId = ""; // [수정] 추가 작업 삭제 시 원본 로그에서 연동 상태 DB 삭제 누락 방지
            payload.log_upserts.push(originalLog);
        }
    }

    data.logs = data.logs.filter(l => l.id !== id);
    localStorage.setItem(key, JSON.stringify(data));
    addSystemLog('DELETE_LOG', currentPath.equip, `삭제: ${deletedInfo}`);

    window.syncHistoryTransaction(currentPath.site, currentPath.equip, payload);

    if (selectedLogId === id) {
        selectedLogId = null;
        document.getElementById('device-memo').value = '';
        const memoMdInput = document.getElementById('memo-md');
        if (memoMdInput) memoMdInput.value = '';
        if (document.getElementById('memo-cost-type')) {
            document.getElementById('memo-cost-type').value = '유상';
        }
        if (document.getElementById('memo-worker')) {
            document.getElementById('memo-worker').value = '';
            const trigger = document.getElementById('memo-worker-trigger');
            if (trigger) { trigger.textContent = '작업자 선택'; trigger.title = ''; }
        }
        if (document.getElementById('memo-issue-share')) {
            document.getElementById('memo-issue-share').checked = false;
        }
        originalMemo = "";
        originalWorker = "";
        originalIssueShared = false;
        originalMd = "";
        originalCostType = "";

        // [수정] 버튼 상태를 '수정' 모드로 초기화
        const memoBtn = document.getElementById('memo-save-btn');
        if (memoBtn) {
            memoBtn.textContent = '수정';
            memoBtn.classList.replace('btn-green-sm', 'btn-blue-sm');
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
        const addWorkCell = row.cells[4];

        const currentDate = dateCell.dataset.rawDate || dateCell.textContent.trim();
        const currentType = typeCell.textContent.trim();

        const currentDetailTypeFull = detailCell.textContent.trim() === '-' ? '' : detailCell.textContent.trim();
        let currentDetailType = currentDetailTypeFull;
        let currentDetailType2 = '';
        if (currentDetailTypeFull.includes('[')) {
            const parts = currentDetailTypeFull.split('[');
            currentDetailType = parts[0].trim();
            currentDetailType2 = parts[1].replace(']', '').trim();
        } else if (currentDetailTypeFull.includes(' > ')) {
            const parts = currentDetailTypeFull.split(' > ');
            currentDetailType = parts[0].trim();
            currentDetailType2 = parts[1].trim();
        }

        const dateTpl = getTemplateContent('edit-log-date-input-template');
        if (dateTpl) {
            const dateInput = dateTpl.querySelector('input');
            dateInput.id = `edit-log-date-${id}`;
            dateInput.value = escapeHtml(currentDate);
            dateCell.innerHTML = '';
            dateCell.appendChild(dateTpl);
        }

        const typeTpl = getTemplateContent('edit-log-type-select-template');
        if (typeTpl) {
            const typeSelect = typeTpl.querySelector('select');
            typeSelect.id = `edit-log-type-${id}`;
            typeSelect.onchange = () => updateEditDetailTypeOptions(id);
            const allCategories = ['정기', '비정기', '고객대응', '용액제조', '온라인점검'];
            typeSelect.innerHTML = allCategories.map(c => `<option value="${c}" ${currentType === c ? 'selected' : ''}>${c}</option>`).join('');
            typeCell.innerHTML = '';
            typeCell.appendChild(typeTpl);
        }

        const detailTpl = getTemplateContent('edit-log-detail-type-container-template');
        if (detailTpl) {
            const detailSelect = detailTpl.querySelector('select:first-of-type');
            const detail2Select = detailTpl.querySelector('select:last-of-type');
            detailSelect.id = `edit-log-detail-type-${id}`;
            detailSelect.onchange = () => updateEditLogContentField(id);
            detail2Select.id = `edit-log-detail-type2-${id}`;
            detailCell.innerHTML = '';
            detailCell.appendChild(detailTpl);
        }

        updateEditDetailTypeOptions(id, currentDetailType);

        const detailSelect = document.getElementById(`edit-log-detail-type-${id}`);
        const detail2Select = document.getElementById(`edit-log-detail-type2-${id}`);
        detailSelect.addEventListener('change', () => {
            const typeVal = document.getElementById(`edit-log-type-${id}`).value;
            if (typeVal === '비정기') updateEditDetailType2Options(id);
            else updateEditLogContentField(id);
        });
        detail2Select.addEventListener('change', () => updateEditLogContentField(id));

        if (currentType === '비정기') {
            detail2Select.style.display = 'block';
            updateEditDetailType2Options(id, currentDetailType2);
        }

        const currentContentFull = contentCell.dataset.rawContent || contentCell.textContent.trim();
        renderEditLogContentField(id, currentType, currentDetailType, currentDetailType2, currentContentFull === '-' ? '' : currentContentFull);

    } else {
        const dateInput = document.getElementById(`edit-log-date-${id}`);
        const typeInput = document.getElementById(`edit-log-type-${id}`);
        const detailTypeInput = document.getElementById(`edit-log-detail-type-${id}`);
        const detailType2Input = document.getElementById(`edit-log-detail-type2-${id}`);
        const newDetailType2 = detailType2Input && detailType2Input.style.display !== 'none' ? detailType2Input.value : '';

        if (!dateInput || !typeInput || !detailTypeInput) return alert('입력 필드를 찾을 수 없습니다. 다시 시도해주세요.');
        const newDate = dateInput.value;
        const newType = typeInput.value;
        const newDetailType = detailTypeInput.value;

        // [수정] 내용 가져오기 (입력창 또는 드롭다운 트리거)
        let newContent = '';
        const wrappers = row.querySelectorAll('.log-select-wrapper');
        const wrapper = wrappers.length > 0 ? wrappers[0] : null;

        if (wrapper) {
            const list = wrapper.querySelector('.log-select-list');
            if (list) {
                const selected = list.querySelectorAll('.log-select-item.selected');
                newContent = Array.from(selected).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                }).join(', ');
            }
        } else {
            const contentInput = document.getElementById(`edit-log-content-${id}`);
            if (contentInput) newContent = contentInput.value.trim();
        }

        // 파트 추가 확인
        const partWrapper = document.getElementById(`edit-log-part-wrapper-${id}`);
        if (partWrapper) {
            const partList = partWrapper.querySelector('.log-select-list');
            if (partList) {
                const selectedParts = partList.querySelectorAll('.log-select-item.selected');
                const partContent = Array.from(selectedParts).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                }).join(', ');
                if (!partContent) return alert('교체/수리할 물품을 선택해주세요.');
                newContent = `${newContent} - ${partContent}`;
            }
        }

        const key = `details_${currentPath.site}_${currentPath.equip}`;
        let data = JSON.parse(localStorage.getItem(key));
        const logItem = data.logs ? data.logs.find(l => l.id === id) : null;
        const currentMd = logItem ? (logItem.md || '') : '';
        const currentCost = logItem ? (logItem.costType || '') : '';

        if (!newDate || !newType || (!newDetailType && detailTypeInput && !detailTypeInput.disabled)) {
            return alert('필수 항목(날짜, 구분, 세부구분)을 모두 입력해주세요.');
        }

        const currentAddWork = logItem ? (logItem.addWork || '') : '';

        const newDetailTypeFull = (newType === '비정기' && newDetailType2) ? `${newDetailType} > ${newDetailType2}` : newDetailType;
        updateLogItem(id, newDate, newType, newDetailTypeFull, newContent, currentAddWork, currentCost, currentMd);
    }
}

function updateLogItem(id, date, type, detailType, content, addWork, costType, md) {
    const key = `details_${currentPath.site}_${currentPath.equip}`;
    let data = JSON.parse(localStorage.getItem(key));

    if (data && data.logs) {
        const idx = data.logs.findIndex(l => l.id === id);
        if (idx > -1) {
            data.logs[idx].date = date;
            data.logs[idx].type = type;
            data.logs[idx].detailType = detailType;
            data.logs[idx].content = content;
            data.logs[idx].addWork = addWork;
            data.logs[idx].costType = costType;
            data.logs[idx].md = md;

            localStorage.setItem(key, JSON.stringify(data));
            if (typeof addSystemLog === 'function') addSystemLog('UPDATE_LOG', currentPath.equip, `점검 이력 수정 (LogID: ${id})`);

            window.syncHistoryTransaction(currentPath.site, currentPath.equip, { log_upserts: [data.logs[idx]] });

            renderLogs();
        }
    }
}

// [수정] 수정 모드에서 내용 필드 렌더링 (다중 선택 드롭다운)
window.renderEditLogContentField = function (id, type, detailType, detailType2, value) {
    const row = document.getElementById(`log-row-${id}`);
    if (!row) return;
    const contentCell = row.cells[3]; // 0: date, 1: type, 2: detailType, 3: content

    if (!type) {
        contentCell.innerHTML = `<input type="text" id="edit-log-content-${id}" value="" class="input-dark input-disabled" style="width: 100%; padding: 2px;" placeholder="구분을 먼저 선택" disabled onclick="event.stopPropagation()">`;
        return;
    }

    const detailTypeSelect = document.getElementById(`edit-log-detail-type-${id}`);
    if (detailTypeSelect && !detailTypeSelect.disabled && !detailType) {
        contentCell.innerHTML = `<input type="text" id="edit-log-content-${id}" value="" class="input-dark input-disabled" style="width: 100%; padding: 2px;" placeholder="세부 구분을 먼저 선택" disabled onclick="event.stopPropagation()">`;
        return;
    }

    const detailType2Select = document.getElementById(`edit-log-detail-type2-${id}`);
    if (type === '비정기' && (!detailType2 && detailType2Select && !detailType2Select.disabled)) {
        contentCell.innerHTML = `<input type="text" id="edit-log-content-${id}" value="" class="input-dark input-disabled" style="width: 100%; padding: 2px;" placeholder="세부 구분을 먼저 선택" disabled onclick="event.stopPropagation()">`;
        return;
    }

    const items = getCheckTypeItems(type, detailType, detailType2);

    // 분리 로직 추가
    let baseContent = value;
    let partContentStr = '', partKeywordFound = false;
    const partKeywords = ['파트 이상 (교체) - ', '파트 이상 (수리) - ', '용액 / 용자 이상 - '];
    for (const keyword of partKeywords) {
        if (value && value.includes(keyword)) {
            baseContent = keyword.replace(' - ', '');
            partContentStr = value.replace(keyword, '');
            partKeywordFound = true;
            break;
        }
    }

    const currentValues = baseContent ? baseContent.split(',').map(s => s.trim()).filter(s => s) : [];
    const selectedMap = {}; // 비용 처리를 파싱하여 분리된 키 맵 생성
    currentValues.forEach(val => {
        if (val === '내용 없음') return; // [추가] '내용 없음'은 리스트에 추가하지 않음
        const match = val.match(/^\[(.*?)\] (.*)$/);
        const actualVal = match ? match[2] : val;
        const costVal = match ? match[1] : '유상';
        selectedMap[actualVal] = costVal;

        if (!items.some(item => item.content === actualVal || item.code === actualVal)) {
            items.unshift({ content: actualVal, code: '' });
        }
    });

    if (items.length > 0 && detailType) {

        // 커스텀 드롭다운 구조 생성
        const wrapper = document.createElement('div');
        wrapper.className = 'log-select-wrapper';
        wrapper.style.width = '100%';
        wrapper.style.margin = '0';
        wrapper.style.minWidth = '0';
        wrapper.onclick = (e) => e.stopPropagation();

        const actualValues = Object.keys(selectedMap);
        let initialText = '항목 선택';
        if (actualValues.length > 1) {
            initialText = `${actualValues[0]} 외 ${actualValues.length - 1}개`;
        } else if (actualValues.length === 1) {
            initialText = actualValues[0];
        }

        const trigger = document.createElement('div');
        trigger.id = `edit-log-content-trigger-${id}`;
        trigger.className = 'log-select-trigger';
        trigger.style.padding = '2px';
        trigger.style.minHeight = 'auto';
        trigger.style.justifyContent = 'center'; // 텍스트 중앙 정렬
        trigger.textContent = initialText;
        trigger.title = currentValues.join('\n');

        const dropdown = document.createElement('div');
        dropdown.className = 'log-select-dropdown';
        dropdown.style.width = '100%';

        // [추가] 검색 입력창 생성
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'dropdown-search-input';
        searchInput.placeholder = '텍스트로 항목 검색...';
        searchInput.autocomplete = 'off';
        searchInput.addEventListener('click', e => e.stopPropagation());
        dropdown.appendChild(searchInput);

        const list = document.createElement('div');
        list.className = 'log-select-list';

        let poolItems = items;
        if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
            const poolMap = new Map();
            items.forEach(i => poolMap.set(i.content, i));
            const allAdminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            allAdminItems.forEach(a => {
                if (!poolMap.has(a.part)) {
                    poolMap.set(a.part, { content: a.part, code: a.code });
                }
            });
            poolItems = Array.from(poolMap.values());
        }

        let registeredItems = [];
        let otherItems = [];
        const defaultSet = new Set(items.map(i => i.code ? i.code : i.content));

        let maintSet = new Set();
        if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
            const maintKey = `details_${currentPath.site}_${currentPath.equip}`;
            const maintData = JSON.parse(localStorage.getItem(maintKey)) || {};
            if (maintData.maint) {
                maintData.maint.forEach(m => {
                    maintSet.add(m.content);
                    if (m.code) maintSet.add(m.code);
                });
            }
        }

        poolItems.forEach(item => {
            const val = item.code ? item.code : item.content;
            if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
                if (maintSet.has(val) || maintSet.has(item.content) || selectedMap.hasOwnProperty(val) || selectedMap.hasOwnProperty(item.content)) {
                    registeredItems.push(item);
                } else {
                    otherItems.push(item);
                }
            } else {
                if (defaultSet.has(val) || defaultSet.has(item.content) || selectedMap.hasOwnProperty(val) || selectedMap.hasOwnProperty(item.content)) {
                    registeredItems.push(item);
                } else {
                    otherItems.push(item);
                }
            }
        });

        let showAll = registeredItems.length === 0;

        // [수정] 렌더링 전 기존 선택 상태 및 비용 처리 값 백업을 함수 외부 스코프에서 관리
        const currentSelections = { ...selectedMap };

        const renderDropdownItems = (searchTerm = '') => {
            list.querySelectorAll('.log-select-item').forEach(el => {
                const val = el.dataset.value;
                if (el.classList.contains('selected')) {
                    const cSel = el.querySelector('.item-cost-select');
                    currentSelections[val] = cSel ? cSel.value : '유상';
                } else {
                    delete currentSelections[val];
                }
            });

            let displayItems = showAll ? [...registeredItems, ...otherItems] : registeredItems;

            if (searchTerm) {
                const kws = searchTerm.toLowerCase().split(/\s+/);
                displayItems = [...registeredItems, ...otherItems].filter(item => {
                    const txt = `${item.content} ${item.code || ''}`.toLowerCase();
                    return kws.every(kw => txt.includes(kw));
                });
            }

            // [요청] 검색 시에도 기존 선택 항목이 사라지지 않도록 보정
            const displayItemValues = new Set(displayItems.map(i => i.code ? i.code : i.content));
            Object.keys(currentSelections).forEach(selectedValue => {
                if (!displayItemValues.has(selectedValue)) {
                    const originalItem = [...registeredItems, ...otherItems].find(i => (i.code ? i.code : i.content) === selectedValue);
                    if (originalItem) {
                        displayItems.unshift(originalItem); // 검색 결과에 없으면 맨 위에 추가
                    }
                }
            });

            list.innerHTML = displayItems.map(item => {
                const displayValue = item.code ? item.code : item.content;
                const isSelected = currentSelections.hasOwnProperty(displayValue) || currentSelections.hasOwnProperty(item.content);
                const selClass = isSelected ? 'selected' : '';
                const itemCost = isSelected ? (currentSelections[displayValue] || currentSelections[item.content] || '유상') : '유상';

                if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
                    return `<div class="log-select-item ${selClass}" data-value="${displayValue}">
                        <span style="flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayValue}</span>
                        <select class="item-cost-select input-dark" onclick="event.stopPropagation()">
                            <option value="유상" ${itemCost === '유상' ? 'selected' : ''}>유상</option>
                            <option value="무상(보증)" ${itemCost === '무상(보증)' ? 'selected' : ''}>무상(보증)</option>
                            <option value="무상(중고)" ${itemCost === '무상(중고)' ? 'selected' : ''}>무상(중고)</option>
                            <option value="기타" ${itemCost === '기타' ? 'selected' : ''}>기타</option>
                        </select>
                    </div>`;
                } else {
                    return `<div class="log-select-item ${selClass}" data-value="${displayValue}"><span>${displayValue}</span></div>`;
                }
            }).join('');

            if (!showAll && !searchTerm && otherItems.length > 0) {
                const moreBtn = document.createElement('button');
                moreBtn.className = 'show-all-btn';
                moreBtn.innerHTML = '⬇️ 더보기 (전체 물품)';
                moreBtn.type = 'button';
                moreBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showAll = true;
                    renderDropdownItems(searchInput.value);
                };
                list.appendChild(moreBtn);
            }

            const updateTriggerText = () => {
                const selected = list.querySelectorAll('.log-select-item.selected');
                const values = Array.from(selected).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                });
                if (values.length > 1) {
                    trigger.textContent = `${values[0]} 외 ${values.length - 1}개`;
                } else if (values.length === 1) {
                    trigger.textContent = values[0];
                } else {
                    trigger.textContent = '항목 선택';
                }
                trigger.title = values.join('\n');
            };

            list.querySelectorAll('.item-cost-select').forEach(cSel => {
                cSel.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const parentDiv = cSel.closest('.log-select-item');
                    if (parentDiv && parentDiv.classList.contains('selected')) updateTriggerText();
                });
            });

            list.querySelectorAll('.log-select-item').forEach(div => {
                div.onclick = (e) => {
                    e.stopPropagation();

                    if (type === '비정기' && detailType !== 'BM 점검') {
                        list.querySelectorAll('.log-select-item.selected').forEach(el => {
                            if (el !== div) el.classList.remove('selected');
                        });
                    }

                    div.classList.toggle('selected');
                    updateTriggerText();

                    if (type === '비정기' && detailType !== 'BM 점검' && div.classList.contains('selected')) {
                        dropdown.classList.remove('show');
                    }
                };
            });
        };

        searchInput.oninput = (e) => {
            renderDropdownItems(e.target.value.trim());
        };

        renderDropdownItems();

        dropdown.appendChild(list);

        const footer = document.createElement('div');
        footer.className = 'log-select-footer';
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-blue-sm';
        addBtn.style.width = '100%';
        addBtn.textContent = '추가';
        addBtn.onclick = (e) => { e.stopPropagation(); dropdown.classList.remove('show'); };
        footer.appendChild(addBtn);
        if (type === '비정기' && detailType !== 'BM 점검') {
            footer.style.display = 'none'; // 단일 선택 시 하단 버튼 숨김
        }
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

        // 파트 선택 래퍼 동적 추가 (수정 모드용)
        if (baseContent.includes('파트 이상 (교체)') || baseContent.includes('파트 이상 (수리)') || baseContent.includes('용액 / 용자 이상')) {
            const pWrapper = document.createElement('div');
            pWrapper.className = 'log-select-wrapper';
            pWrapper.id = `edit-log-part-wrapper-${id}`;
            pWrapper.style.width = '100%';
            pWrapper.style.margin = '4px 0 0 0';

            const partTpl = getTemplateContent('edit-log-part-wrapper-template');
            if (partTpl) {
                partTpl.querySelector('.log-select-trigger').id = `edit-log-part-trigger-${id}`;
                const dropdown = partTpl.querySelector('.log-select-dropdown');
                dropdown.id = `edit-log-part-dropdown-${id}`;
                dropdown.querySelector('.dropdown-search-input').id = `edit-log-part-search-${id}`;
                dropdown.querySelector('.log-select-list').id = `edit-log-part-list-${id}`;
                dropdown.querySelector('button').onclick = () => document.getElementById(`edit-log-part-dropdown-${id}`).classList.remove('show');
                pWrapper.appendChild(partTpl);
            }
            contentCell.appendChild(pWrapper);

            const pTrigger = pWrapper.querySelector(`#edit-log-part-trigger-${id}`);
            const pDropdown = pWrapper.querySelector(`#edit-log-part-dropdown-${id}`);
            pTrigger.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== pDropdown) d.classList.remove('show'); });
                pDropdown.classList.toggle('show');
            };

            window.renderLogPartOptions(`edit-log-part-wrapper-${id}`, `edit-log-part-trigger-${id}`, `edit-log-part-list-${id}`, `edit-log-part-search-${id}`, partContentStr);
        }
    } else {
        const tpl = getTemplateContent('edit-log-content-input-template');
        if (tpl) {
            const input = tpl.querySelector('input');
            input.id = `edit-log-content-${id}`;
            if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
                input.placeholder = '항목을 추가해 주세요';
                input.disabled = true;
                input.classList.add('input-disabled');
            } else {
                input.value = escapeHtml(baseContent);
            }
            contentCell.innerHTML = '';
            contentCell.appendChild(tpl);
        }
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

        // [수정] 추가 작업 등록 시 기본 날짜를 오늘로 설정하고, 원본 데이터를 presetData로 전달
        const todayStr = new Date().toISOString().substring(0, 10);
        openRegisterScheduleModal(todayStr, logItem);
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

// [추가] Admin 점검 구분 연동 동적 생성 함수
window.updateLogTypeOptions = function () {
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

window.updateLogDetailTypeOptions = function () {
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

    const detail2Select = document.getElementById('log-detail-type2-select');
    if (type === '비정기') {
        if (detail2Select) detail2Select.style.display = 'inline-block';
    } else {
        if (detail2Select) {
            detail2Select.style.display = 'none';
            detail2Select.value = '';
        }
    }

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

    detailTypeSelect.onchange = () => {
        if (type === '비정기') updateLogDetailType2Options();
        updateLogContentOptions();
    };

    if (type === '비정기') updateLogDetailType2Options();
    else updateLogContentOptions();
};

window.updateLogDetailType2Options = function (presetVal = '') {
    const typeSelect = document.getElementById('log-type-select');
    const detailTypeSelect = document.getElementById('log-detail-type-select');
    const detail2Select = document.getElementById('log-detail-type2-select');
    if (!typeSelect || !detailTypeSelect || !detail2Select) return;
    const type = typeSelect.value;
    const detailType = detailTypeSelect.value;
    detail2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 먼저 선택</option>';
    if (type !== '비정기' || !detailType) {
        detail2Select.disabled = true;
        updateLogContentOptions();
        return;
    }
    detail2Select.disabled = false;
    const equipKey = currentPath.equip;
    const subCategories2 = getSubCategories2(equipKey, type, detailType);
    if (subCategories2.length === 0) {
        detail2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 없음</option>';
        detail2Select.disabled = true;
    } else {
        detail2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분</option>';
        subCategories2.forEach(sub => { detail2Select.insertAdjacentHTML('beforeend', `<option value="${sub}" ${sub === presetVal ? 'selected' : ''}>${sub}</option>`); });
    }
    updateLogContentOptions();
};

// [추가] 로그 입력 폼 항목 업데이트 함수
window.updateLogContentOptions = function () {
    const typeSelect = document.getElementById('log-type-select');
    const detailTypeSelect = document.getElementById('log-detail-type-select');
    const contentWrapper = document.getElementById('log-content-wrapper');
    const contentList = document.getElementById('log-content-list');
    const contentTrigger = document.getElementById('log-content-trigger');
    const contentInput = document.getElementById('log-content-input');

    // 갱신 시 파트 래퍼 초기화
    const partWrapper = document.getElementById('log-part-wrapper');
    if (partWrapper) {
        partWrapper.style.display = 'none';
        const partTrigger = document.getElementById('log-part-trigger');
        if (partTrigger) partTrigger.textContent = '물품 선택';
        const partList = document.getElementById('log-part-list');
        if (partList) partList.innerHTML = '';
    }

    if (!typeSelect || !detailTypeSelect || !contentWrapper || !contentInput) return;

    const type = typeSelect.value;
    const detailType = detailTypeSelect.value;
    const detailType2Select = document.getElementById('log-detail-type2-select');
    const detailType2 = detailType2Select && detailType2Select.style.display !== 'none' ? detailType2Select.value : '';
    const equipKey = currentPath.equip;

    if (!type) {
        contentWrapper.style.display = 'none';
        contentInput.style.display = 'inline-block';
        contentInput.placeholder = '구분을 먼저 선택';
        contentInput.value = '';
        contentInput.disabled = true;
        contentInput.classList.add('input-disabled');
        return;
    }

    if (!detailType && !detailTypeSelect.disabled) {
        contentWrapper.style.display = 'none';
        contentInput.style.display = 'inline-block';
        contentInput.placeholder = '세부구분을 먼저 선택';
        contentInput.value = '';
        contentInput.disabled = true;
        contentInput.classList.add('input-disabled');
        return;
    }

    if (type === '비정기' && (!detailType2 && !detailType2Select.disabled)) {
        contentWrapper.style.display = 'none';
        contentInput.style.display = 'inline-block';
        contentInput.placeholder = '세부 구분을 먼저 선택';
        contentInput.value = '';
        contentInput.disabled = true;
        contentInput.classList.add('input-disabled');
        return;
    }

    contentInput.disabled = false;
    contentInput.classList.remove('input-disabled');

    const items = getCheckTypeItems(type, detailType, detailType2);

    if (items.length > 0 && detailType) {
        contentWrapper.style.display = 'inline-block';
        contentInput.style.display = 'none';

        if (contentTrigger) contentTrigger.textContent = '항목 선택';
        if (contentList) {
            const dropdown = document.getElementById('log-content-dropdown');
            let searchInput = document.getElementById('log-content-search');
            if (!searchInput && dropdown) {
                searchInput = document.createElement('input');
                searchInput.type = 'text';
                searchInput.id = 'log-content-search';
                searchInput.className = 'dropdown-search-input';
                searchInput.placeholder = '텍스트로 항목 검색...';
                searchInput.autocomplete = 'off';
                searchInput.addEventListener('click', e => e.stopPropagation());
                dropdown.insertBefore(searchInput, contentList);
            }

            let poolItems = items;
            if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
                const poolMap = new Map();
                items.forEach(i => poolMap.set(i.content, i));
                const allAdminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
                allAdminItems.forEach(a => {
                    if (!poolMap.has(a.part)) {
                        poolMap.set(a.part, { content: a.part, code: a.code });
                    }
                });
                poolItems = Array.from(poolMap.values());
            }

            let registeredItems = [];
            let otherItems = [];
            const defaultSet = new Set(items.map(i => i.code ? i.code : i.content));

            let maintSet = new Set();
            if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
                const maintKey = `details_${currentPath.site}_${currentPath.equip}`;
                const maintData = JSON.parse(localStorage.getItem(maintKey)) || {};
                if (maintData.maint) {
                    maintData.maint.forEach(m => {
                        maintSet.add(m.content);
                        if (m.code) maintSet.add(m.code);
                    });
                }
            }

            poolItems.forEach(item => {
                const val = item.code ? item.code : item.content;
                if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
                    if (maintSet.has(val) || maintSet.has(item.content)) {
                        registeredItems.push(item);
                    } else {
                        otherItems.push(item);
                    }
                } else {
                    if (defaultSet.has(val) || defaultSet.has(item.content)) {
                        registeredItems.push(item);
                    } else {
                        otherItems.push(item);
                    }
                }
            });

            let showAll = registeredItems.length === 0;

            // [수정] 렌더링 전 기존 선택 상태 및 비용 처리 값 백업을 함수 외부 스코프에서 관리
            const currentSelections = {};

            const renderDropdownItems = (searchTerm = '') => {
                contentList.querySelectorAll('.log-select-item').forEach(el => {
                    const val = el.dataset.value;
                    if (el.classList.contains('selected')) {
                        const cSel = el.querySelector('.item-cost-select');
                        currentSelections[val] = cSel ? cSel.value : '유상';
                    } else {
                        delete currentSelections[val];
                    }
                });

                let displayItems = showAll ? [...registeredItems, ...otherItems] : registeredItems;

                if (searchTerm) {
                    const kws = searchTerm.toLowerCase().split(/\s+/);
                    displayItems = [...registeredItems, ...otherItems].filter(item => {
                        const txt = `${item.content} ${item.code || ''}`.toLowerCase();
                        return kws.every(kw => txt.includes(kw));
                    });
                }

                // [요청] 검색 시에도 기존 선택 항목이 사라지지 않도록 보정
                const displayItemValues = new Set(displayItems.map(i => i.code ? i.code : i.content));
                Object.keys(currentSelections).forEach(selectedValue => {
                    if (!displayItemValues.has(selectedValue)) {
                        const originalItem = [...registeredItems, ...otherItems].find(i => (i.code ? i.code : i.content) === selectedValue);
                        if (originalItem) {
                            displayItems.unshift(originalItem); // 검색 결과에 없으면 맨 위에 추가
                        } else {
                            displayItems.unshift({ content: selectedValue, code: '' }); // 시스템 미등록 항목 보존
                        }
                    }
                });

                contentList.innerHTML = displayItems.map(item => {
                    const displayValue = item.code ? item.code : item.content;
                    const isSelected = currentSelections.hasOwnProperty(displayValue);
                    const selClass = isSelected ? 'selected' : '';
                    const itemCost = isSelected ? currentSelections[displayValue] : '유상';

                    if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
                        return `
                            <div class="log-select-item ${selClass}" data-value="${displayValue}">
                                <span style="flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayValue}</span>
                                <select class="item-cost-select input-dark" onclick="event.stopPropagation()">
                                    <option value="유상" ${itemCost === '유상' ? 'selected' : ''}>유상</option>
                                    <option value="무상(보증)" ${itemCost === '무상(보증)' ? 'selected' : ''}>무상(보증)</option>
                                    <option value="무상(중고)" ${itemCost === '무상(중고)' ? 'selected' : ''}>무상(중고)</option>
                                    <option value="기타" ${itemCost === '기타' ? 'selected' : ''}>기타</option>
                                </select>
                            </div>
                        `;
                    } else {
                        return `<div class="log-select-item ${selClass}" data-value="${displayValue}"><span>${displayValue}</span></div>`;
                    }
                }).join('');

                if (!showAll && !searchTerm && otherItems.length > 0) {
                    const moreBtn = document.createElement('button');
                    moreBtn.className = 'show-all-btn';
                    moreBtn.innerHTML = '⬇️ 더보기 (전체 물품)';
                    moreBtn.type = 'button';
                    moreBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showAll = true;
                        renderDropdownItems(searchInput ? searchInput.value : '');
                    };
                    contentList.appendChild(moreBtn);
                }

                const updateTriggerText = () => {
                    const selected = contentList.querySelectorAll('.log-select-item.selected');
                    const values = Array.from(selected).map(el => {
                        const cSel = el.querySelector('.item-cost-select');
                        return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                    });
                    if (values.length > 1) {
                        contentTrigger.textContent = `${values[0]} 외 ${values.length - 1}개`;
                    } else if (values.length === 1) {
                        contentTrigger.textContent = values[0];
                    } else {
                        contentTrigger.textContent = '항목 선택';
                    }
                    contentTrigger.title = values.join('\n');
                };

                contentList.querySelectorAll('.item-cost-select').forEach(cSel => {
                    cSel.addEventListener('change', (e) => {
                        e.stopPropagation();
                        const parentDiv = cSel.closest('.log-select-item');
                        if (parentDiv && parentDiv.classList.contains('selected')) updateTriggerText();
                    });
                });

                contentList.querySelectorAll('.log-select-item').forEach(div => {
                    div.addEventListener('mousedown', (e) => {
                        if (e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (contentTrigger) contentTrigger.classList.remove('error-border');

                        if (type === '비정기' && detailType !== 'BM 점검') {
                            contentList.querySelectorAll('.log-select-item.selected').forEach(el => {
                                if (el !== div) el.classList.remove('selected');
                            });
                        }
                        div.classList.toggle('selected');
                        updateTriggerText();

                        // [추가] 파트 이상(교체/수리) 선택 시 물품 드롭다운 표시 연동
                        if (partWrapper) {
                            const isPartIssue = div.dataset.value.includes('파트 이상 (교체)') || div.dataset.value.includes('파트 이상 (수리)') || div.dataset.value.includes('용액 / 용자 이상');
                            if (div.classList.contains('selected') && isPartIssue) {
                                partWrapper.style.display = 'inline-block';
                                window.renderLogPartOptions('log-part-wrapper', 'log-part-trigger', 'log-part-list', 'log-part-search');
                            } else {
                                partWrapper.style.display = 'none';
                            }
                        }

                        if (type === '비정기' && detailType !== 'BM 점검' && div.classList.contains('selected')) {
                            const dropdownObj = document.getElementById('log-content-dropdown');
                            if (dropdownObj) dropdownObj.classList.remove('show');
                        }
                    });
                });
            };

            if (searchInput) {
                searchInput.value = '';
                searchInput.oninput = (e) => {
                    renderDropdownItems(e.target.value.trim());
                };
            }

            renderDropdownItems();
        }

        // [추가] 단일 선택 시 하단 추가 버튼 숨김
        const dropdown = document.getElementById('log-content-dropdown');
        if (dropdown) {
            const footer = dropdown.querySelector('.log-select-footer');
            if (footer) {
                footer.style.display = (type === '비정기' && detailType !== 'BM 점검') ? 'none' : 'block';
            }
        }
    } else {
        contentWrapper.style.display = 'none';
        contentInput.style.display = 'inline-block';
        contentInput.placeholder = detailType ? '내용 (직접 입력)' : '내용 (직접 입력)';
        if (detailType === 'PM 점검' || detailType === 'BM 점검' || type === '고객대응') {
            contentInput.placeholder = '항목을 추가해 주세요';
            contentInput.value = '';
            contentInput.disabled = true;
            contentInput.classList.add('input-disabled');
        } else if (detailType === 'Parts 교체') {
            contentInput.value = 'Parts 교체';
            contentInput.disabled = true;
            contentInput.classList.add('input-disabled');
            if (partWrapper) {
                partWrapper.style.display = 'inline-block';
                window.renderLogPartOptions('log-part-wrapper', 'log-part-trigger', 'log-part-list', 'log-part-search');
            }
        } else {
            contentInput.placeholder = '내용 (직접 입력)';
            contentInput.disabled = false;
            contentInput.classList.remove('input-disabled');
        }
    }
};

window.updateEditDetailTypeOptions = function (id, presetVal = '') {
    const typeSelect = document.getElementById(`edit-log-type-${id}`);
    const detailTypeSelect = document.getElementById(`edit-log-detail-type-${id}`);
    const detailType2Select = document.getElementById(`edit-log-detail-type2-${id}`);
    if (!typeSelect || !detailTypeSelect) return;

    const type = typeSelect.value;
    detailTypeSelect.innerHTML = '';

    if (!type) {
        detailTypeSelect.innerHTML = '<option value="">구분 먼저 선택</option>';
        detailTypeSelect.disabled = true;
        if (detailType2Select) {
            detailType2Select.style.display = 'none';
            detailType2Select.value = '';
        }
        updateEditLogContentField(id);
        return;
    }

    detailTypeSelect.disabled = false;

    if (detailType2Select) {
        if (type === '비정기') {
            detailType2Select.style.display = 'block';
        } else {
            detailType2Select.style.display = 'none';
            detailType2Select.value = '';
        }
    }

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

    if (!presetVal) {
        if (type === '비정기') {
            updateEditDetailType2Options(id);
        } else {
            updateEditLogContentField(id);
        }
    }
};

window.updateEditLogContentField = function (id) {
    const typeSelect = document.getElementById(`edit-log-type-${id}`);
    const detailTypeSelect = document.getElementById(`edit-log-detail-type-${id}`);
    const detailType2Select = document.getElementById(`edit-log-detail-type2-${id}`);
    if (!typeSelect || !detailTypeSelect) return;

    const type = typeSelect.value;
    const detailType = detailTypeSelect.value;
    const detailType2 = detailType2Select && detailType2Select.style.display !== 'none' ? detailType2Select.value : '';
    renderEditLogContentField(id, type, detailType, detailType2, '');
};

window.updateEditDetailType2Options = function (id, presetVal = '') {
    const typeSelect = document.getElementById(`edit-log-type-${id}`);
    const detailTypeSelect = document.getElementById(`edit-log-detail-type-${id}`);
    const detail2Select = document.getElementById(`edit-log-detail-type2-${id}`);
    if (!typeSelect || !detailTypeSelect || !detail2Select) return;
    const type = typeSelect.value;
    const detailType = detailTypeSelect.value;
    detail2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 먼저 선택</option>';
    if (type !== '비정기' || !detailType) {
        detail2Select.disabled = true;
        updateEditLogContentField(id);
        return;
    }
    detail2Select.disabled = false;
    const subCategories2 = getSubCategories2(currentPath.equip, type, detailType);
    if (subCategories2.length === 0) {
        detail2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 없음</option>';
        detail2Select.disabled = true;
    } else {
        detail2Select.innerHTML = `<option value="" disabled hidden ${!presetVal ? 'selected' : ''}>세부 구분</option>`;
        if (presetVal && !subCategories2.includes(presetVal)) subCategories2.unshift(presetVal);
        subCategories2.forEach(sub => { detail2Select.insertAdjacentHTML('beforeend', `<option value="${sub}" ${sub === presetVal ? 'selected' : ''}>${sub}</option>`); });
    }
    if (!presetVal) updateEditLogContentField(id);
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
        'custEquipName', 'equipStatus', 'deliveryDate', 'warrantyStart', 'warrantyPeriod', 'building', 'floor', 'detailLoc',
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
        'custEquipName', 'equipStatus', 'deliveryDate', 'warrantyStart', 'warrantyPeriod', 'building', 'floor', 'detailLoc',
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
    // [수정] device-memo는 readonly로 제어하여 스크롤 가능하도록 함
    const memoInput = document.getElementById('device-memo');
    if (memoInput) {
        memoInput.readOnly = disabled;
        if (disabled) { // [수정] 배경색 변경 없이 투명도와 커서만 변경
            memoInput.style.opacity = '0.6';
            memoInput.style.cursor = 'not-allowed';
        } else {
            memoInput.style.opacity = '';
            memoInput.style.cursor = '';
        }
    }

    const fields = ['memo-cost-type', 'memo-issue-share'];// 'device-memo'는 항상 활성화, 'memo-md'는 제외
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disabled;
            if (disabled) el.classList.add('input-disabled');
            else el.classList.remove('input-disabled');
        }
    });

    const mdInput = document.getElementById('memo-md');
    if (mdInput) {
        mdInput.disabled = disabled;
        if (disabled) mdInput.classList.add('input-disabled');
        else mdInput.classList.remove('input-disabled');
    }

    const workerTrigger = document.getElementById('memo-worker-trigger');
    if (workerTrigger) {
        if (disabled) {
            workerTrigger.classList.add('input-disabled');
            workerTrigger.style.pointerEvents = 'none';
        } else {
            workerTrigger.classList.remove('input-disabled');
            workerTrigger.style.pointerEvents = 'auto';
        }
    }
}

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

    // [추가] 하단 메모/작업내용 영역 활성/비활성 연동
    // [제거] 메모 영역 활성화는 이제 '수정' 버튼으로 제어
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
    // 용량 체크 (200KB 제한)
    const MAX_SIZE = 200 * 1024;

    Array.from(files).forEach(file => {
        if (file.size > MAX_SIZE) {
            alert(`파일 '${file.name}'이 너무 큽니다. (200KB 제한)`);
            return;
        }

        const reader = new FileReader();
        reader.onload = function (evt) {
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
        const isEditable = isTextFile(file.name);
        const template = getTemplateContent('file-list-item-template');
        if (!template) return;
        const li = template.querySelector('li');

        const fileNameSpan = li.querySelector('.file-name');
        fileNameSpan.innerHTML = `📄 ${window.escapeHtml(file.name)}`;
        fileNameSpan.onclick = () => downloadFile(file.id);

        li.querySelector('.file-info').textContent = file.date;
        li.querySelector('.btn-del-sm').onclick = () => deleteFile(file.id);

        if (isEditable) {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-edit-sm';
            editBtn.onclick = () => editFile(file.id);
            editBtn.title = '내용 편집';
            editBtn.style.marginRight = '8px';
            editBtn.style.cursor = 'pointer';
            editBtn.innerHTML = '📝';
            li.insertBefore(editBtn, li.querySelector('.file-info'));
        }
        listEl.appendChild(li);
    });
}

window.downloadFile = function (id) {
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

window.deleteFile = function (id) {
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

window.editFile = function (id) {
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

window.saveFileContent = function () {
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

window.closeFileEditModal = function () {
    document.getElementById('file-edit-modal').style.display = 'none';
    currentEditingFileId = null;
};

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