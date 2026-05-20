/* ==========================================================================
   공통 셋업 모달 로직 (Common Setup Modals Logic)
   ========================================================================== */

// [전역 변수] 모달에서 현재 타겟팅하는 항목 정보
let currentExecStartTarget = null;
let currentSetupCompleteTarget = null; // [추가] 셋업 완료 처리 대상

// [추가] 로컬 타임존 기준 YYYY-MM-DD 포맷 변환 헬퍼 (UTC 변환 시 하루 밀리는 현상 방지)
function getLocalYYYYMMDD(d = new Date()) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

/* ==========================================================================
   1. 실행 시작 모달 (Execution Start Modal)
   ========================================================================== */

/**
 * 실행 시작 모달의 이벤트 리스너를 설정합니다.
 * 이 함수는 각 페이지(setup, index)에서 한 번씩 호출되어야 합니다.
 */
function setupSetupExecStartModal() {
    const modal = document.getElementById('setup-exec-start-modal');
    if (!modal) return;

    // 이벤트 중복 바인딩 방지
    if (modal.dataset.initialized === 'true') return;
    modal.dataset.initialized = 'true';

    const closeBtn = document.getElementById('btn-close-setup-exec-start');
    const saveBtn = document.getElementById('btn-save-setup-exec-start');

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    if (saveBtn) saveBtn.onclick = saveSetupExecStart;
}

/**
 * 실행 시작 모달을 엽니다.
 * @param {string|number} id - 대상 작업 항목의 ID
 * @param {string} site - 대상 장비의 사업장
 * @param {string} equip - 대상 장비의 이름
 */
function openSetupExecStartModal(id, site, equip) {
    const modal = document.getElementById('setup-exec-start-modal');
    if (!modal) return;

    currentExecStartTarget = { id, site, equip };
    const dateInput = document.getElementById('setup-exec-start-date');

    let defaultDate = getLocalYYYYMMDD();

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const data = setupData[equipKey] || {};
    const details = data.setupDetails || [];

    const currentIndex = details.findIndex(item => item.id == id);

    if (currentIndex > 0) {
        const prevTask = details[currentIndex - 1];
        if (prevTask.completed && prevTask.date) {
            const [y, m, d] = prevTask.date.split('-').map(Number);
            const prevDate = new Date(y, m - 1, d);
            defaultDate = getLocalYYYYMMDD(window.addBusinessDays(prevDate, 1));
        }
    } else if (currentIndex === 0) {
        if (details[0].startDate) defaultDate = details[0].startDate;
    }

    dateInput.value = defaultDate;
    modal.style.display = 'flex';
}

/**
 * 실행 시작 버튼 클릭 시 호출되는 함수 (인라인 onclick 등에서 사용)
 * @param {string|number} id - 대상 작업 항목의 ID
 * @param {string} site - 대상 장비의 사업장
 * @param {string} equip - 대상 장비의 이름
 */
function startSetupTask(id, site, equip) {
    // 화면에 계산되었으나 아직 스토리지에 저장되지 않은 데이터가 있을 경우를 대비해,
    // 팝업을 열고 리렌더링하기 전에 현재 화면의 DOM 상태를 강제로 저장하여 초기화 방지
    if (typeof saveSetupDetails === 'function') {
        saveSetupDetails('UPDATE_SETUP_BEFORE_EXEC', '실행 전 화면 상태 자동 저장');
    }
    openSetupExecStartModal(id, site, equip);
}
window.startSetupTask = startSetupTask;

/**
 * 실행 시작 모달의 저장 로직
 */
async function saveSetupExecStart() {
    if (!currentExecStartTarget) return;

    const { id, site, equip } = currentExecStartTarget;
    const dateInput = document.getElementById('setup-exec-start-date');
    const execDate = dateInput.value;

    if (!execDate) return alert("시작일을 선택해주세요.");

    document.getElementById('setup-exec-start-modal').style.display = 'none';

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    let data = setupData[equipKey] || {};

    if (data.setupDetails) {
        const task = data.setupDetails.find(t => t.id == id);
        if (task) {
            task.execStartDate = execDate;
            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));

            // DB 동기화
            await window.syncSetupDataDB(site, equip, data.setupDetails, null);

            if (typeof addSystemLog === 'function') {
                addSystemLog('START_SETUP_EXEC', equip, `실행 시작일 설정: ${execDate}`);
            }

            // 현재 페이지에 따라 적절한 렌더링 함수 호출
            if (typeof renderGanttChart === 'function') renderGanttChart();
            if (typeof renderSetupDetailList === 'function') renderSetupDetailList();

            // [추가] 대시보드 리스트 즉시 갱신
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
            if (typeof updateIntegratedDashboard === 'function') updateIntegratedDashboard();
        }
    }

    currentExecStartTarget = null;
}

// [추가] 외부 호출을 위한 전역 함수 명시적 노출
window.setupSetupExecStartModal = setupSetupExecStartModal;
window.openSetupExecStartModal = openSetupExecStartModal;
window.saveSetupExecStart = saveSetupExecStart;

/* ==========================================================================
   [추가] 셋업 작업 기록 모달 (간트 일수 모드 연동)
   ========================================================================== */
window.openSetupLogRegisterModal = function(site, equip, taskName, defaultDate, forceComplete = false, isDropdownMode = false) {
    // [핵심 해결] SETUP 페이지 등에 남아있는 하드코딩된 중복 모달 ID로 인해 값이 엉뚱한 곳에 입력되어 공수가 0으로 초기화되는 버그 방지
    const modals = document.querySelectorAll('#setup-log-register-modal');
    if (modals.length === 0) return;
    const modal = modals[modals.length - 1]; // 항상 가장 최신(활성화된) 모달을 타겟으로 함
    
    modal.querySelector('#setup-log-reg-site').value = site;
    modal.querySelector('#setup-log-reg-equip').value = equip;
    const idInput = modal.querySelector('#setup-log-reg-id');
    if (idInput) idInput.value = ''; // 신규 등록이므로 ID 초기화
    modal.querySelector('#setup-log-reg-date').value = defaultDate || getLocalYYYYMMDD();
    const memoInput = modal.querySelector('#setup-log-reg-memo');
    if (memoInput) memoInput.value = '';

    // [추가] 작업명 입력 방식을 드롭다운/읽기 전용으로 분기 처리
    const taskInput = modal.querySelector('#setup-log-reg-task');
    let taskWrapper = modal.querySelector('#setup-log-reg-task-wrapper');
    if (!taskWrapper && taskInput) {
        taskWrapper = document.createElement('div');
        taskWrapper.id = 'setup-log-reg-task-wrapper';
        taskWrapper.className = 'log-select-wrapper';
        taskWrapper.style.flex = '1';
        taskWrapper.style.minWidth = '0';
        taskWrapper.innerHTML = `
            <div id="setup-log-reg-task-trigger" class="log-select-trigger" style="height:34px; background:#0d1117; border:1px solid #30363d; color:#8b949e; padding:0 10px; border-radius:4px; cursor:pointer; display:flex; align-items:center; justify-content:flex-start; text-align:left; box-sizing:border-box; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">작업명 선택</div>
            <div id="setup-log-reg-task-dropdown" class="log-select-dropdown" style="z-index: 12000; width:100%; box-sizing:border-box;">
                <input type="text" id="setup-log-reg-task-search" class="dropdown-search-input" placeholder="검색..." style="width: calc(100% - 12px); margin: 5px 6px; padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; color: #e6edf3; border-radius: 4px; box-sizing: border-box;" autocomplete="off">
                <div id="setup-log-reg-task-list" class="log-select-list" style="max-height: 150px; overflow-y: auto;"></div>
            </div>
        `;
        taskInput.parentNode.insertBefore(taskWrapper, taskInput);
    }

    if (isDropdownMode) {
        if (taskWrapper) taskWrapper.style.display = 'block';
        if (taskInput) {
            taskInput.type = 'hidden';
            taskInput.value = '';
        }
        
        const trigger = modal.querySelector('#setup-log-reg-task-trigger');
        const dropdown = modal.querySelector('#setup-log-reg-task-dropdown');
        const list = modal.querySelector('#setup-log-reg-task-list');
        const search = modal.querySelector('#setup-log-reg-task-search');

        if (trigger) {
            trigger.textContent = '작업명 선택';
            trigger.style.color = '#8b949e';
        }

        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const equipKey = `${site}::${equip}`;
        const data = setupData[equipKey] || {};
        const details = data.setupDetails || [];

        const renderTasks = (kw = '') => {
            if (!list) return;
            list.innerHTML = '';
            let filtered = details;
            if (kw) filtered = details.filter(d => d.content.toLowerCase().includes(kw.toLowerCase()));
            
            if (filtered.length === 0) {
                list.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:#8b949e;">검색 결과가 없습니다.</div>';
                return;
            }

            filtered.forEach(d => {
                const div = document.createElement('div');
                div.className = 'log-select-item';
                div.innerHTML = `<span>${typeof escapeHtml === 'function' ? escapeHtml(d.content) : d.content}</span>`;
                div.onclick = (e) => {
                    e.stopPropagation();
                    if (taskInput) taskInput.value = d.content;
                    if (trigger) {
                        trigger.textContent = d.content;
                        trigger.style.color = '#fff';
                    }
                    if (dropdown) dropdown.classList.remove('show');
                    
                    // 항목 선택 시, 해당 작업의 기존 완료 상태 불러오기
                    const completeCb = modal.querySelector('#setup-log-reg-complete');
                    if (completeCb) completeCb.checked = !!d.completed;
                };
                list.appendChild(div);
            });
        };
        
        renderTasks();

        if (trigger) {
            trigger.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
                if (dropdown) dropdown.classList.toggle('show');
            };
        }
        
        if (search) {
            search.onclick = e => e.stopPropagation();
            search.oninput = e => renderTasks(e.target.value);
        }
        
        // 드롭다운 외부 클릭 감지
        document.addEventListener('click', (e) => {
            if (dropdown && dropdown.classList.contains('show') && !dropdown.contains(e.target) && e.target !== trigger) {
                dropdown.classList.remove('show');
            }
        });

    } else {
        if (taskWrapper) taskWrapper.style.display = 'none';
        if (taskInput) {
            taskInput.type = 'text';
            taskInput.value = taskName;
            taskInput.readOnly = true;
            taskInput.style.backgroundColor = '#0d1117'; // 읽기 전용 스타일 유지
            taskInput.style.color = '#fff';
        }
    }

    const delBtn = modal.querySelector('#btn-delete-setup-log-reg');
    const saveBtn = modal.querySelector('#btn-save-setup-log-reg');
    
    // [수정] 하단 버튼 영역을 1:1 비율로 분할하여 버튼 크기 동일하게 맞춤
    if (delBtn && saveBtn && delBtn.parentNode === saveBtn.parentNode) {
        delBtn.parentNode.style.display = 'flex';
        delBtn.parentNode.style.gap = '10px';
        delBtn.style.flex = '1';
        saveBtn.style.flex = '1';
    }
    if (delBtn) delBtn.style.display = 'none'; // 신규 등록 시에는 삭제 버튼 숨김
    
    // 작업자 세팅 (로그인 정보 기반)
    const wTrigger = modal.querySelector('#setup-log-reg-worker-trigger');
    const wHidden = modal.querySelector('#setup-log-reg-worker');
    const defaultWorker = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
    
    if (wHidden) wHidden.value = defaultWorker;
    if (wTrigger) {
        if (defaultWorker) {
            wTrigger.textContent = defaultWorker;
            wTrigger.title = defaultWorker;
            wTrigger.classList.add('has-value');
        } else {
            wTrigger.textContent = '작업자 선택';
            wTrigger.title = '';
            wTrigger.classList.remove('has-value');
        }
    }
    
    // 공수 자동 세팅
    const mdInput = modal.querySelector('#setup-log-reg-md');
    if (mdInput) {
        mdInput.value = defaultWorker ? defaultWorker.split(',').filter(Boolean).length : 0;
    }
    
    setupSetupLogRegWorkerDropdown(modal);
    // [추가] 셋업 물품 드롭다운 초기화 (기본값 없음)
    setupSetupLogRegPartDropdown(modal, site, equip, '');
    
    modal.style.display = 'flex';
};

// [추가] 간트뷰에서 기존 로그를 수정하기 위해 모달을 여는 함수
window.openLogForEditing = function(site, equip, logId) {
    const modals = document.querySelectorAll('#setup-log-register-modal');
    if (modals.length === 0) return;
    const modal = modals[modals.length - 1];

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const equipLogs = (setupData[equipKey] && setupData[equipKey].setupLogs) ? setupData[equipKey].setupLogs : [];
    const log = equipLogs.find(l => l.id == logId);

    if (!log) return alert('해당 작업 기록을 찾을 수 없습니다.');

    // 모달 필드 채우기
    // [추가] 수정 모드일 때는 드롭다운 래퍼를 숨기고 일반 읽기전용 텍스트 인풋으로 복구
    const taskInput = modal.querySelector('#setup-log-reg-task');
    const taskWrapper = modal.querySelector('#setup-log-reg-task-wrapper');
    if (taskWrapper) taskWrapper.style.display = 'none';
    if (taskInput) {
        taskInput.type = 'text';
        taskInput.readOnly = true;
        taskInput.style.backgroundColor = '#0d1117';
        taskInput.style.color = '#fff';
    }

    modal.querySelector('#setup-log-reg-site').value = site;
    modal.querySelector('#setup-log-reg-equip').value = equip;
    const idInput = modal.querySelector('#setup-log-reg-id');
    if (idInput) idInput.value = logId;
    modal.querySelector('#setup-log-reg-date').value = log.date;
    modal.querySelector('#setup-log-reg-task').value = log.content;
    const memoInput = modal.querySelector('#setup-log-reg-memo');
    if (memoInput) memoInput.value = log.memo || '';

    const delBtn = modal.querySelector('#btn-delete-setup-log-reg');
    const saveBtn = modal.querySelector('#btn-save-setup-log-reg');
    
    // [수정] 하단 버튼 영역을 1:1 비율로 분할하여 버튼 크기 동일하게 맞춤
    if (delBtn && saveBtn && delBtn.parentNode === saveBtn.parentNode) {
        delBtn.parentNode.style.display = 'flex';
        delBtn.parentNode.style.gap = '10px';
        delBtn.style.flex = '1';
        saveBtn.style.flex = '1';
    }
    if (delBtn) {
        delBtn.style.display = 'block'; // 플렉스 아이템으로 표시되도록 block으로 변경
    }

    // 작업자 드롭다운 셋팅
    const wTrigger = modal.querySelector('#setup-log-reg-worker-trigger');
    const wHidden = modal.querySelector('#setup-log-reg-worker');
    if (wHidden) wHidden.value = log.worker || '';
    if (wTrigger) {
        if (log.worker) {
            wTrigger.textContent = log.worker;
            wTrigger.title = log.worker;
            wTrigger.classList.add('has-value');
        } else {
            wTrigger.textContent = '작업자 선택';
            wTrigger.title = '';
            wTrigger.classList.remove('has-value');
        }
    }

    const mdInput = modal.querySelector('#setup-log-reg-md');
    if (mdInput) mdInput.value = log.md || '0';
    
    setupSetupLogRegWorkerDropdown(modal);
    // [추가] 셋업 물품 드롭다운 초기화 (저장된 parts 불러오기)
    setupSetupLogRegPartDropdown(modal, site, equip, log.parts || '');

    modal.style.display = 'flex';
};

function setupSetupLogRegWorkerDropdown(modalContext) {
    const context = modalContext || document;
    const wTrigger = context.querySelector('#setup-log-reg-worker-trigger');
    const wDropdown = context.querySelector('#setup-log-reg-worker-dropdown');
    const wSearch = context.querySelector('#setup-log-reg-worker-search');
    const wList = context.querySelector('#setup-log-reg-worker-list');
    const wConfirm = context.querySelector('#btn-setup-log-reg-worker-confirm');
    const wHidden = context.querySelector('#setup-log-reg-worker');
    const mdInput = context.querySelector('#setup-log-reg-md');
    
    if(!wTrigger || !wDropdown || wDropdown.dataset.bound === 'true') return;
    wDropdown.dataset.bound = 'true';
    
    wTrigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== wDropdown) d.classList.remove('show'); });
        wDropdown.classList.toggle('show');
        if (wDropdown.classList.contains('show')) renderWorkers(wSearch ? wSearch.value.trim() : '');
    };
    
    document.addEventListener('click', (e) => {
        if (wDropdown.classList.contains('show') && e.target !== wTrigger && !wTrigger.contains(e.target) && !wDropdown.contains(e.target)) {
            wDropdown.classList.remove('show');
        }
    });

    const renderWorkers = async (searchTerm = '') => {
        const siteEl = context.querySelector('#setup-log-reg-site');
        const site = siteEl ? siteEl.value : '';
        const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(site) : [];
        const currentSelected = wHidden && wHidden.value ? wHidden.value.split(',').map(s => s.trim()).filter(Boolean) : [];
        const allWorkers = workers.map(w => typeof w === 'string' ? { name: w, department: '', position: '', site: '' } : w);
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

        if (typeof window.renderWorkerListItems === 'function') {
            window.renderWorkerListItems(wList, displayWorkers, currentSelected, () => {
                const selected = Array.from(wList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
                if (wHidden) wHidden.value = selected.join(', ');
                if (selected.length > 0) {
                    wTrigger.textContent = selected.join(', ');
                    wTrigger.classList.add('has-value');
                } else {
                    wTrigger.textContent = '작업자 선택';
                    wTrigger.classList.remove('has-value');
                }
                wTrigger.title = selected.join(', ');
                
                // 공수 연동 업데이트
                if (mdInput) mdInput.value = selected.length;
            });
        }
    };
    
    if (wSearch) {
        wSearch.onclick = (e) => e.stopPropagation();
        wSearch.oninput = (e) => renderWorkers(e.target.value.trim());
    }
    if (wConfirm) {
        wConfirm.onclick = (e) => { e.stopPropagation(); wDropdown.classList.remove('show'); };
    }
}

// [추가] 셋업 물품 제안박스(다중 선택) 설정 함수
function setupSetupLogRegPartDropdown(modalContext, site, equip, presetParts = '') {
    const context = modalContext || document;
    const trigger = context.querySelector('#setup-log-reg-part-trigger');
    const dropdown = context.querySelector('#setup-log-reg-part-dropdown');
    const search = context.querySelector('#setup-log-reg-part-search');
    const list = context.querySelector('#setup-log-reg-part-list');
    const displayBox = context.querySelector('#setup-log-reg-part-display');
    const hiddenInput = context.querySelector('#setup-log-reg-part-hidden');
    const addBtn = context.querySelector('#btn-setup-log-reg-part-add');

    if(!trigger || !dropdown) return;

    let adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    
    // 프리셋 파싱 (수정 모드용)
    const currentSelections = {};
    if(presetParts) {
        const partsArr = presetParts.split(',').map(s => s.trim()).filter(Boolean);
        partsArr.forEach(p => {
            const match = p.match(/^\[(.*?)\] (.*)$/);
            if(match) currentSelections[match[2]] = match[1];
            else currentSelections[p] = '무상(셋업)';
        });
    }

    const renderDisplayBox = () => {
        const selectedNames = Object.keys(currentSelections);
        displayBox.innerHTML = '';
        if (selectedNames.length === 0) {
            displayBox.innerHTML = '<div style="color:#8b949e; font-size:12px; text-align:center; padding:10px;">선택된 물품이 없습니다.</div>';
            trigger.textContent = '물품 선택';
            trigger.style.color = '#8b949e';
            hiddenInput.value = '';
            return;
        }

        const partsArr = selectedNames.map(name => `[${currentSelections[name]}] ${name}`);
        hiddenInput.value = partsArr.join(', ');

        if (selectedNames.length > 1) {
            trigger.textContent = `${selectedNames[0]} 외 ${selectedNames.length - 1}개`;
        } else {
            trigger.textContent = selectedNames[0];
        }
        trigger.style.color = '#fff';
        trigger.title = partsArr.join('\n');

        selectedNames.forEach(name => {
            const cost = currentSelections[name];
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px solid #30363d; font-size:12px; color:#e6edf3;';
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                    <span style="background:#30363d; padding:2px 6px; border-radius:4px; font-size:10px; color:#e6edf3; flex-shrink:0;">${cost}</span>
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name}">${name}</span>
                </div>
                <span style="color:#f85149; cursor:pointer; font-weight:bold; margin-left:10px; padding:0 5px;" title="삭제">✕</span>
            `;
            div.querySelector('span[title="삭제"]').onclick = (e) => {
                e.stopPropagation();
                delete currentSelections[name];
                renderDisplayBox();
                renderList(search.value); // 드롭다운 체크박스 상태도 동기화
            };
            displayBox.appendChild(div);
        });
    };

    const renderList = (query = '') => {
        const keywords = query.toLowerCase().split(/\s+/);
        let matches = adminItems;
        if (query) {
            matches = adminItems.filter(m => {
                const text = `${m.part || ''} ${m.code || ''}`.toLowerCase();
                return keywords.every(kw => text.includes(kw));
            });
        }

        const uniqueItems = [];
        const seen = new Set();
        matches.forEach(m => {
            // [수정] 리스트 텍스트를 심플하게 코드명(없으면 물품명)으로만 표시
            const displayValue = m.code ? m.code : m.part;
            if (!seen.has(displayValue)) {
                seen.add(displayValue);
                uniqueItems.push({ ...m, displayValue });
            }
        });

        Object.keys(currentSelections).forEach(sel => {
            if(!seen.has(sel)) {
                seen.add(sel);
                uniqueItems.unshift({ part: sel, displayValue: sel });
            }
        });

        list.innerHTML = '';
        if (uniqueItems.length === 0) {
            list.innerHTML = '<li style="padding:10px; color:#8b949e; text-align:center; font-size:12px;">검색 결과가 없습니다.</li>';
            return;
        }

        uniqueItems.forEach(item => {
            const val = item.displayValue;
            const isSelected = currentSelections.hasOwnProperty(val);
            const itemCost = isSelected ? currentSelections[val] : '무상(셋업)';
            const li = document.createElement('li');
            li.style.cssText = `padding: 6px 8px; font-size: 12px; cursor: pointer; border-radius: 4px; margin-bottom: 2px; display: flex; align-items: center; justify-content: space-between; ${isSelected ? 'background: #1f6feb; color: #fff;' : 'color: #e6edf3;'}`;
            
            li.innerHTML = `
                <div style="display:flex; align-items:center; gap:5px; flex:1; min-width:0;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(val)}</span>
                </div>
                <select class="item-cost-select" style="background:#0d1117; border:1px solid #30363d; color:#fff; border-radius:3px; padding:2px; font-size:11px; margin-left:5px; pointer-events:auto;" onclick="event.stopPropagation();">
                    <option value="무상(셋업)" ${itemCost === '무상(셋업)' ? 'selected' : ''}>무상(셋업)</option>
                    <option value="무상(중고)" ${itemCost === '무상(중고)' ? 'selected' : ''}>무상(중고)</option>
                    <option value="유상" ${itemCost === '유상' ? 'selected' : ''}>유상</option>
                    <option value="기타" ${itemCost === '기타' ? 'selected' : ''}>기타</option>
                </select>
            `;

            li.addEventListener('mousedown', (e) => {
                if(e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
                e.preventDefault();
                e.stopPropagation();
                if (currentSelections.hasOwnProperty(val)) {
                    delete currentSelections[val];
                } else {
                    const cSel = li.querySelector('select');
                    currentSelections[val] = cSel ? cSel.value : '무상(셋업)';
                }
                renderDisplayBox();
                renderList(search.value);
            });

            li.querySelector('select').addEventListener('change', (e) => {
                e.stopPropagation();
                if (currentSelections.hasOwnProperty(val)) {
                    currentSelections[val] = e.target.value;
                    renderDisplayBox();
                }
            });

            list.appendChild(li);
        });
    };

    trigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
        dropdown.classList.toggle('show');
        if (dropdown.classList.contains('show')) {
            renderList(search.value);
            search.focus();
        }
    };

    search.onclick = (e) => e.stopPropagation();
    search.oninput = (e) => renderList(e.target.value);

    document.addEventListener('click', (e) => {
        if (dropdown.classList.contains('show') && e.target !== trigger && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });

    if (addBtn) {
        addBtn.onclick = (e) => {
            e.stopPropagation();
            // [수정] 모달 호출 기능 대신 단순히 드롭다운을 닫는 '선택 완료' 기능으로 변경
            dropdown.classList.remove('show');
        };
    }

    renderDisplayBox();
}

// [추가] 셋업 작업 상태(진행률, 시작/완료일) 자동 재계산 유틸리티
function recalculateSetupTaskStatus(data, taskContent, site = null, equip = null) {
    if (!data.setupDetails) return false;
    const task = data.setupDetails.find(t => t.content === taskContent);
    if (!task) return false;

    const taskLogs = (data.setupLogs || []).filter(l => l.content === taskContent);
    taskLogs.sort((a, b) => new Date(a.date) - new Date(b.date));

    let prevCompleted = task.completed;

    if (taskLogs.length === 0) {
        task.execStartDate = "";
        task.date = "";
        task.completed = false;
        task.delayReason = "";
    } else {
        task.execStartDate = taskLogs[0].date;
        const workedDays = new Set(taskLogs.map(l => l.date)).size;
        const estDays = parseInt(task.estDays) || 1;

        if (workedDays >= estDays) {
            task.completed = true;
            task.date = taskLogs[taskLogs.length - 1].date; // 가장 마지막 로그 날짜를 완료일로
        } else {
            task.completed = false;
            task.date = "";
        }
    }

    // [추가] 셋업 완료 기록이 삭제되어 미완료 상태로 롤백된 경우, 장비 상태를 셋업 장비로 복구
    if (prevCompleted && !task.completed && (task.category === '셋업 완료' || task.content === '셋업 완료')) {
        const targetSite = site || (typeof currentPath !== 'undefined' ? currentPath.site : null);
        const targetEquip = equip || (typeof currentPath !== 'undefined' ? currentPath.equip : null);
        
        if (targetSite && targetEquip) {
            const detailKey = `details_${targetSite}_${targetEquip}`;
            const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
            if (detailData.setup && ['워런티', '가동 장비', '유휴 장비', '이관 대기'].includes(detailData.setup.equipStatus)) {
                detailData.setup.equipStatus = '셋업 장비';
                detailData.setup.warrantyStart = '';
                detailData.setup.warrantyPeriod = '';
                localStorage.setItem(detailKey, JSON.stringify(detailData));
                
                if (typeof window.syncAdminDB === 'function') {
                    window.syncAdminDB('equip', 'UPDATE', {
                        old_id: targetEquip, new_id: targetEquip, site: targetSite, old_site: targetSite, new_site: targetSite,
                        setup: detailData.setup, special_note: detailData.specialNote || ''
                    });
                }
            }
        }
    }

    return true;
}

/* ==========================================================================
   셋업 완료 처리 및 이력 모달 (Setup Complete & History Modals)
   ========================================================================== */
window.openSetupCompleteModal = function(site, equip, readOnly = false) {
    const modal = document.getElementById('setup-complete-modal');
    if (!modal) return;

    const userRole = sessionStorage.getItem('userRole');
    if (userRole !== 'admin' && userRole !== 'superadmin') {
        alert('셋업 완료 처리는 관리자만 가능합니다.');
        return;
    }

    currentSetupCompleteTarget = { site, equip };

    const key = `details_${site}_${equip}`;
    const detailData = JSON.parse(localStorage.getItem(key)) || {};
    const setupInfo = detailData.setup || {};

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const sData = setupData[`${site}::${equip}`] || {};
    let isRejected = false;
    let rejectReasonText = '';
    let existingTransferComment = '';
    
    if (sData.setupDetails) {
        const completeTask = sData.setupDetails.find(t => t.content === '셋업 완료');
        if (completeTask) {
            existingTransferComment = completeTask.transferComment || '';
            if (completeTask.rejectReason && setupInfo.equipStatus === '이관 반려') {
                isRejected = true;
                rejectReasonText = completeTask.rejectReason;
            }
        }
    }

    const infoEl = document.getElementById('setup-complete-target-info');
    const custEquipNameInput = document.getElementById('setup-complete-cust-equip-name');
    const startInput = document.getElementById('setup-complete-warranty-start');
    const periodInput = document.getElementById('setup-complete-warranty-period');

    const custManagerInput = document.getElementById('setup-complete-cust-manager');
    const custContactInput = document.getElementById('setup-complete-cust-contact');
    const custEmailInput = document.getElementById('setup-complete-cust-email');
    const transferCommentInput = document.getElementById('setup-complete-transfer-comment');

    const confirmBtn = document.getElementById('btn-confirm-setup-complete');
    const cancelBtn = document.getElementById('btn-cancel-setup-complete');
    const closeBtn = document.getElementById('btn-close-setup-complete-modal');

    const info = window.formatEquipDisplayInfo(site, equip);
    // [수정] Serial No(또는 고객사 장비명) 부분을 녹색으로 강조하여 표시 및 이력 조회 버튼 추가
    if (infoEl) {
        infoEl.style.display = 'flex';
        infoEl.style.alignItems = 'center';
        infoEl.style.justifyContent = 'center';
        infoEl.style.gap = '10px';
        infoEl.innerHTML = `
            <span>${info.mainInfo} <span style="color: #3fb950;">${info.subInfo}</span></span>
            <button id="btn-setup-complete-history" class="btn-shortcut" style="padding: 2px 8px; font-size: 11px;">이력</button>
        `;
        const historyBtn = infoEl.querySelector('#btn-setup-complete-history');
        if (historyBtn) {
            historyBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof window.openSetupHistoryModal === 'function') {
                    window.openSetupHistoryModal(site, equip);
                }
            };
        }
    }

    const rejectInfoEl = document.getElementById('setup-complete-reject-info');
    const rejectReasonEl = document.getElementById('setup-complete-reject-reason');
    const rejectMemoInput = document.getElementById('setup-complete-reject-memo');

    if (rejectInfoEl && rejectReasonEl && rejectMemoInput) {
        if (isRejected) {
            rejectInfoEl.style.display = 'block';
            rejectReasonEl.textContent = rejectReasonText || '사유 없음';
            rejectMemoInput.value = '';
        } else {
            rejectInfoEl.style.display = 'none';
        }
    }

    // 이관 완료 상태 확인
    const isTransferComplete = ['워런티', '가동 장비', '유휴 장비'].includes(setupInfo.equipStatus);
    const isPendingTransfer = setupInfo.equipStatus === '이관 대기';

    // [적용 완료] 장비 마스터(setupInfo)에 이미 저장된 고객사 정보가 있다면 해당 값을 미리 팝업 필드에 채워줍니다.
    if (startInput) {
        startInput.value = setupInfo.warrantyStart || new Date().toISOString().split('T')[0];
        startInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (periodInput) {
        periodInput.value = setupInfo.warrantyPeriod || '';
        periodInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (custEquipNameInput) {
        custEquipNameInput.value = setupInfo.custEquipName || '';
        custEquipNameInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (custManagerInput) {
        custManagerInput.value = setupInfo.manager || '';
        custManagerInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (custContactInput) {
        custContactInput.value = setupInfo.contact || '';
        custContactInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (custEmailInput) {
        custEmailInput.value = setupInfo.email || '';
        custEmailInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (transferCommentInput) {
        transferCommentInput.value = existingTransferComment;
        transferCommentInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    
    if (confirmBtn) {
        if (isTransferComplete || readOnly) {
            confirmBtn.style.display = 'none';
        } else {
            confirmBtn.style.display = 'inline-block';
            if (isPendingTransfer) {
                confirmBtn.textContent = '이관 취소';
                confirmBtn.classList.remove('btn-blue');
                confirmBtn.classList.add('btn-orange');
            } else {
                confirmBtn.textContent = '이관';
                confirmBtn.classList.remove('btn-orange');
                confirmBtn.classList.add('btn-blue');
            }
        }
    }
    if (cancelBtn) cancelBtn.textContent = (isTransferComplete || isPendingTransfer || readOnly) ? '닫기' : '취소';

    const closeModal = () => {
        modal.style.display = 'none';
        currentSetupCompleteTarget = null;
    };

    cancelBtn.onclick = closeModal;
    closeBtn.onclick = closeModal;

    confirmBtn.onclick = async () => {
        if (isPendingTransfer) {
            if (confirm('장비 이관을 취소하고 셋업 장비 상태로 되돌리시겠습니까?')) {
                const { site, equip } = currentSetupCompleteTarget;
                const detailKey = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
                if (detailData.setup) {
                    detailData.setup.equipStatus = '셋업 장비';

                    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
                    const sData = setupData[`${site}::${equip}`];
                    if (sData && sData.setupDetails) {
                        const completeTask = sData.setupDetails.find(t => t.content === '셋업 완료');
                        if (completeTask) {
                            completeTask.rejectReason = '';
                            completeTask.delayReason = '';
                            completeTask.transferComment = '';
                            localStorage.setItem('setup_data', JSON.stringify(setupData));
                            if (typeof window.syncSetupDataDB === 'function') {
                                await window.syncSetupDataDB(site, equip, sData.setupDetails, sData.setupLogs);
                            }
                        }
                    }

                    const success = await window.syncAdminDB('equip', 'UPDATE', {
                        old_id: equip, new_id: equip, site: site, old_site: site, new_site: site,
                        setup: detailData.setup, special_note: detailData.specialNote || ''
                    });

                    if (success) {
                        localStorage.setItem(detailKey, JSON.stringify(detailData));
                        if (typeof addSystemLog === 'function') addSystemLog('CANCEL_TRANSFER', equip, '이관 대기 상태 취소 -> 셋업 장비로 전환');
                        alert('이관이 취소되었습니다. 장비가 셋업 장비 상태로 변경되었습니다.');
                        closeModal();
                        if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
                    } else {
                        alert('서버에 상태를 저장하는 중 오류가 발생했습니다.');
                    }
                }
            }
            return;
        }

        if (!currentSetupCompleteTarget) return;

        const warrantyStart = startInput.value;
        const warrantyPeriod = periodInput.value;

        if (!warrantyStart || !warrantyPeriod) {
            alert('워런티 시작일과 기한을 모두 입력해주세요.');
            return;
        }

        const custEquipName = custEquipNameInput ? custEquipNameInput.value.trim() : '';
        const custManager = custManagerInput ? custManagerInput.value.trim() : '';
        const custContact = custContactInput ? custContactInput.value.trim() : '';
        const custEmail = custEmailInput ? custEmailInput.value.trim() : '';
        const transferComment = transferCommentInput ? transferCommentInput.value.trim() : '';

        const rejectInfoEl = document.getElementById('setup-complete-reject-info');
        const rejectMemoInput = document.getElementById('setup-complete-reject-memo');
        const rejectMemo = (rejectInfoEl && rejectInfoEl.style.display !== 'none' && rejectMemoInput) ? rejectMemoInput.value.trim() : '';

        const { site, equip } = currentSetupCompleteTarget;
        // 저장 전 최신 데이터 로드
        const currentDetailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
        if (!currentDetailData.setup) currentDetailData.setup = {};

        const isReSubmit = (currentDetailData.setup.equipStatus === '이관 반려' || (rejectInfoEl && rejectInfoEl.style.display !== 'none'));

        currentDetailData.setup.equipStatus = '이관 대기';
        currentDetailData.setup.warrantyStart = warrantyStart;
        currentDetailData.setup.warrantyPeriod = warrantyPeriod;
        
        // 고객사 정보 업데이트 반영
        currentDetailData.setup.custEquipName = custEquipName;
        currentDetailData.setup.manager = custManager;
        currentDetailData.setup.contact = custContact;
        currentDetailData.setup.email = custEmail;

        // 반려 재처리 및 코멘트 갱신 시 setup_data 동기화
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const sDataToUpdate = setupData[`${site}::${equip}`];
        if (sDataToUpdate && sDataToUpdate.setupDetails) {
            const completeTask = sDataToUpdate.setupDetails.find(t => t.content === '셋업 완료');
            if (completeTask) {
                let isSetupDataModified = false;
                if (isReSubmit) {
                    completeTask.rejectReason = '';
                    if (rejectMemo) {
                        completeTask.delayReason = rejectMemo; // 수정/보완 사항 저장
                    }
                    isSetupDataModified = true;
                }
                if (completeTask.transferComment !== transferComment) {
                    completeTask.transferComment = transferComment;
                    isSetupDataModified = true;
                }
                if (isSetupDataModified) {
                    localStorage.setItem('setup_data', JSON.stringify(setupData));
                    if (typeof window.syncSetupDataDB === 'function') {
                        window.syncSetupDataDB(site, equip, sDataToUpdate.setupDetails, sDataToUpdate.setupLogs);
                    }
                }
            }
        }

        // DB Sync
        const success = await window.syncAdminDB('equip', 'UPDATE', {
            old_id: equip, new_id: equip, site: site, old_site: site, new_site: site,
            setup: currentDetailData.setup, special_note: currentDetailData.specialNote || ''
        });

        if (success) {
            localStorage.setItem(`details_${site}_${equip}`, JSON.stringify(currentDetailData));
            
            let logDetails = '셋업 완료 처리 -> 이관 대기로 전환';
            if (isReSubmit && rejectMemo) logDetails += ` (수정사항: ${rejectMemo})`;
            
            if (typeof addSystemLog === 'function') addSystemLog('UPDATE_EQUIP_STATUS', equip, logDetails);
            alert('셋업 완료 및 이관 처리가 완료되었습니다.\n장비가 이관 대기 상태로 변경되었습니다.');
            closeModal();
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard(); // Refresh dashboard
        } else {
            alert('서버에 완료 상태를 저장하는 중 오류가 발생했습니다.');
        }
    };

    modal.style.display = 'flex';
}

window.openSetupHistoryModal = function(site, equip) {
    const modal = document.getElementById('setup-history-modal');
    if (!modal) return;

    const titleEl = document.getElementById('setup-history-title');
    const tbody = document.getElementById('setup-history-list-body');
    const memoEl = document.getElementById('setup-history-memo');
    const partsList = document.getElementById('setup-history-parts-list');
    
    tbody.innerHTML = '';
    memoEl.value = '';
    partsList.innerHTML = '<li style="padding:20px; text-align:center; color:#8b949e; font-size:12px;">일지를 선택해주세요</li>';
    
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const info = window.formatEquipDisplayInfo(site, equip, equipmentModels);
    
    titleEl.innerHTML = `셋업 이력 - ${info.mainInfo} <span style="color:#3fb950; font-size: 14px;">${info.subInfo}</span>`;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const data = setupData[equipKey] || {};
    const logs = data.setupLogs || [];

    const sortedLogs = [...logs].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sortedLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#8b949e;">셋업 일지 기록이 없습니다.</td></tr>';
    } else {
        sortedLogs.forEach(log => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            
            const contentHtml = (typeof escapeHtml === 'function' ? escapeHtml(log.content) || '-' : log.content || '-').replace(/\[지연\]/g, '<span class="tag-delayed" style="color: #f0883e; font-weight: bold;">[지연]</span>');

            tr.innerHTML = `
                <td style="text-align:center; padding: 8px 10px; border-bottom: 1px solid #21262d;">${typeof escapeHtml === 'function' ? escapeHtml(log.date) : log.date}</td>
                <td style="text-align:left; padding: 8px 10px; border-bottom: 1px solid #21262d;">${contentHtml}</td>
                <td style="text-align:center; padding: 8px 10px; border-bottom: 1px solid #21262d;">${typeof escapeHtml === 'function' ? escapeHtml(log.worker) : log.worker}</td>
                <td style="text-align:center; color:#d29922; font-weight:bold; padding: 8px 10px; border-bottom: 1px solid #21262d;">${typeof escapeHtml === 'function' ? escapeHtml(log.md || '0') : log.md || '0'}</td>
            `;

            tr.onclick = () => {
                Array.from(tbody.children).forEach(row => row.style.backgroundColor = '');
                tr.style.backgroundColor = 'rgba(35, 134, 54, 0.1)';

                memoEl.value = log.memo || '작성된 메모가 없습니다.';

                partsList.innerHTML = '';
                if (log.parts) {
                    const partsArr = log.parts.split(',').map(s => s.trim()).filter(Boolean);
                    partsArr.forEach(partText => {
                        let pureContent = partText;
                        let itemCost = '';
                        const costMatch = pureContent.match(/^\[(.*?)\]\s*(.*)$/);
                        if (costMatch) { itemCost = costMatch[1]; pureContent = costMatch[2]; }
                        
                        const li = document.createElement('li');
                        li.style.cssText = 'padding: 8px 10px; border-bottom: 1px solid #30363d; font-size: 12px; color: #c9d1d9; display: flex; justify-content: space-between; align-items: center;';
                        li.innerHTML = `
                            <span style="font-weight:bold; color:#58a6ff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${typeof escapeHtml === 'function' ? escapeHtml(pureContent) : pureContent}">${typeof escapeHtml === 'function' ? escapeHtml(pureContent) : pureContent}</span>
                            ${itemCost ? `<span style="font-size:10px; background:#30363d; padding:2px 6px; border-radius:4px; color:#e6edf3; flex-shrink:0;">${typeof escapeHtml === 'function' ? escapeHtml(itemCost) : itemCost}</span>` : ''}
                        `;
                        partsList.appendChild(li);
                    });
                } else {
                    partsList.innerHTML = '<li style="padding:20px; text-align:center; color:#8b949e; font-size:12px;">선택된 물품 없음</li>';
                }
            };
            tbody.appendChild(tr);
        });
        
        if (tbody.firstChild) tbody.firstChild.click();
    }

    modal.style.display = 'flex';
    const closeBtn = document.getElementById('btn-close-setup-history-modal');
    if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
};

// 저장 이벤트 처리
document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', async (e) => {
        if (e.target.id === 'btn-close-setup-log-reg') {
            const modal = e.target.closest('.modal-overlay');
            if (modal) modal.style.display = 'none';
        } else if (e.target.id === 'btn-delete-setup-log-reg') {
            const modal = e.target.closest('.modal-overlay') || document;
            const logId = modal.querySelector('#setup-log-reg-id') ? modal.querySelector('#setup-log-reg-id').value : '';
            const site = modal.querySelector('#setup-log-reg-site') ? modal.querySelector('#setup-log-reg-site').value : '';
            const equip = modal.querySelector('#setup-log-reg-equip') ? modal.querySelector('#setup-log-reg-equip').value : '';
            
            if (!logId || !site || !equip) return;
            
            if (!confirm('해당 셋업 작업 기록을 삭제하시겠습니까?')) return;
            
            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${site}::${equip}`;
            let data = setupData[equipKey] || {};
            
            if (data.setupLogs) {
                const targetLog = data.setupLogs.find(l => l.id == logId);
                data.setupLogs = data.setupLogs.filter(l => l.id != logId);
                
                if (targetLog && data.setupDetails && typeof recalculateSetupTaskStatus === 'function') {
                    recalculateSetupTaskStatus(data, targetLog.content, site, equip);
                }
                
                setupData[equipKey] = data;
                localStorage.setItem('setup_data', JSON.stringify(setupData));
                
                if (typeof window.syncSetupDataDB === 'function') {
                    window.syncSetupDataDB(site, equip, data.setupDetails, data.setupLogs);
                }
                
                if (typeof addSystemLog === 'function') {
                    addSystemLog('DELETE_SETUP_LOG', equip, `LogID: ${logId}`);
                }
                
                const parentModal = e.target.closest('.modal-overlay');
                if (parentModal) parentModal.style.display = 'none';
                alert('기록이 삭제되었습니다.');
                
                if (typeof renderSetupLogList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                    renderSetupLogList();
                }
                if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                    renderSetupDetailList();
                }
                if (typeof renderGanttChart === 'function') renderGanttChart();

                // [추가] 대시보드 리스트 즉시 갱신
                if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
                if (typeof updateIntegratedDashboard === 'function') updateIntegratedDashboard();
            }
        } else if (e.target.id === 'btn-save-setup-log-reg') {
            const modal = e.target.closest('.modal-overlay') || document;
            const site = modal.querySelector('#setup-log-reg-site').value;
            const equip = modal.querySelector('#setup-log-reg-equip').value;
            const date = modal.querySelector('#setup-log-reg-date').value;
            const task = modal.querySelector('#setup-log-reg-task').value;
            const worker = modal.querySelector('#setup-log-reg-worker').value;
            const md = modal.querySelector('#setup-log-reg-md').value;
            const memo = modal.querySelector('#setup-log-reg-memo').value;
            // [추가] 선택된 셋업 물품 데이터
            const parts = modal.querySelector('#setup-log-reg-part-hidden') ? modal.querySelector('#setup-log-reg-part-hidden').value : '';
            const logId = modal.querySelector('#setup-log-reg-id') ? modal.querySelector('#setup-log-reg-id').value : ''; // 수정 모드 식별자
            
            if(!date || !worker || !md || !task) return alert('작업일, 작업명, 작업자, 공수를 모두 입력해주세요.');
            
            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${site}::${equip}`;
            let data = setupData[equipKey] || {};
            if (!data.setupLogs) data.setupLogs = [];
            
            let isUpdating = false;
            if (logId) {
                // 수정 업데이트
                const existingLog = data.setupLogs.find(l => l.id == logId);
                if (existingLog) {
                    existingLog.date = date;
                    existingLog.worker = worker;
                    existingLog.md = md;
                    existingLog.memo = memo;
                    existingLog.parts = parts; // [추가] 물품 업데이트
                    isUpdating = true;
                }
            }

            if (!isUpdating) {
                // 신규 등록
                const newLog = {
                    id: Date.now(),
                    date: date,
                    worker: worker,
                    content: task,
                    company: "위드텍",
                    memo: memo,
                    md: md,
                    parts: parts // [추가] 물품 등록
                };
                data.setupLogs.push(newLog);
            }

            // [개선] 셋업 로그 기록 수에 따라 완료/지연 상태를 자동 재계산
            const setupDetailsUpdated = recalculateSetupTaskStatus(data, task, site, equip);

            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));
            
            if (typeof window.syncSetupDataDB === 'function') {
                await window.syncSetupDataDB(site, equip, data.setupDetails, data.setupLogs);
            }
            
            if (typeof addSystemLog === 'function') addSystemLog(isUpdating ? 'UPDATE_SETUP_LOG' : 'ADD_SETUP_LOG', equip, `[${task}] ${worker} (${md}MD)`);
            
            const parentModal = e.target.closest('.modal-overlay');
            if (parentModal) parentModal.style.display = 'none';
            alert('기록이 저장되었습니다.');
            
            if (typeof renderSetupLogList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                renderSetupLogList();
            }
            
            // [수정] 셋업 기록(일지)이 추가되면 간트 차트에 즉시 반영(블록 생성 등)되도록 항상 리프레시
            if (typeof renderGanttChart === 'function') renderGanttChart();

            if (setupDetailsUpdated) {
                if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                    renderSetupDetailList(); // 셋업 세부사항 리스트 리프레시
                }
            }

            // [추가] 대시보드 리스트 즉시 갱신
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
            if (typeof updateIntegratedDashboard === 'function') updateIntegratedDashboard();
        }
    });
});
