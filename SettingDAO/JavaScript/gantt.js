/* ==========================================================================
   간트 차트 및 실행 관리 (Gantt Chart & Execution Management)
   ========================================================================== */

// [1] 전역 변수 (Global Variables)
let ganttSidebarWidth = 300;
let ganttDayWidth = 20;
const GANTT_SIDEBAR_MIN_WIDTH = 250;
const GANTT_SIDEBAR_MAX_WIDTH = 600;
const GANTT_PADDING_START = 0;
const GANTT_PADDING_END = 1;
let ganttExtraWeeks = 0;
let ganttValidDates = [];
let isHoveringHoliday = false;
let isDayCountMode = true; // [수정] 일수 모드를 기본값으로 설정

// 드래그 앤 드롭 관련 변수
let isDraggingBar = false;
let dragMode = null;
let dragStartX = 0;
let dragBarEl = null;
let dragBarInitialLeft = 0;
let dragBarInitialWidth = 0;
let hasMoved = false;

/* ==========================================================================
   [2] 초기화 및 설정 (Setup & Initialization)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // [추가] 공통 셋업 모달 초기화
    if (typeof setupSetupExecStartModal === 'function') setupSetupExecStartModal();

    // 간트 차트 관련 초기화
    setupGanttSearch();
    setupGanttZoom();
    setupGanttResizer();
    setupEquipInfoResizer();
    setupGanttSearchModal();
    // [수정] 제목 클릭 대신 버튼으로 모드 전환하도록 로직 변경 (아래 MutationObserver에서 버튼 생성)
    const subtitleEl = document.querySelector('.gantt__subtitle');
    if (subtitleEl) {
        subtitleEl.innerHTML = '셋업 일정'; // 기본 텍스트로 고정
    }

    // HTML로 분리된 일수/날짜 모드 전환 버튼 이벤트 연결
    const viewToggleBtn = document.getElementById('btn-gantt-view-toggle');
    if (viewToggleBtn) {
        const updateButtonText = () => {
            viewToggleBtn.innerHTML = isDayCountMode ? '📅 날짜 모드' : '🔢 일수 모드';
        };

        viewToggleBtn.onclick = () => {
            isDayCountMode = !isDayCountMode;
            updateButtonText();
            renderGanttChart();
        };
        updateButtonText();
    }

    // [추가] "작업명" 헤더 옆 글로벌 작업 추가 버튼 생성
    const sidebarHeader = document.querySelector('.gantt__sidebar .gantt__header-cell--fixed');
    if (sidebarHeader && !document.getElementById('btn-gantt-settings')) {
        sidebarHeader.style.position = 'relative';

        const settingBtn = document.createElement('button');
        settingBtn.id = 'btn-gantt-settings';
        settingBtn.className = 'btn-settings';
        settingBtn.innerHTML = '⚙️';
        settingBtn.title = '간트 리스트 편집';
        settingBtn.style.position = 'absolute';
        settingBtn.style.right = '10px';
        settingBtn.style.zIndex = '100';
        settingBtn.style.display = 'none';
        settingBtn.style.cursor = 'pointer';

        const addBtn = document.createElement('button');
        addBtn.id = 'btn-gantt-add-task';
        addBtn.className = 'gantt__btn-add'; // 기존 스타일 재활용
        addBtn.innerHTML = '＋';
        addBtn.title = '셋업 작업 추가';
        // [수정] 인라인 스타일 충돌 방지를 위해 개별 속성으로 안전하게 할당
        addBtn.style.position = 'absolute';
        addBtn.style.right = '35px';
        addBtn.style.zIndex = '100';
        addBtn.style.display = 'none';
        addBtn.style.cursor = 'pointer';

        settingBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        settingBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const ganttArea = document.getElementById('gantt-chart-area');
            if (ganttArea) {
                ganttArea.classList.toggle('edit-mode');
                settingBtn.classList.toggle('active');
                if (ganttArea.classList.contains('edit-mode')) {
                    addBtn.style.display = 'flex';
                } else {
                    addBtn.style.display = 'none';
                    renderGanttChart(); // 닫을 때 편집 중인 텍스트 입력창 롤백
                }
            }
        });

        // [수정] 부모 요소의 드래그나 클릭 이벤트에 가로채이지 않도록 이벤트 전파(stopPropagation) 완벽 차단
        addBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const targetSite = currentGanttFilters.site || (typeof setupDashboardFilter !== 'undefined' ? setupDashboardFilter.site : '');
            const targetEquip = currentGanttFilters.equip;

            if (targetSite && targetEquip) {
                if (typeof window.openAddSetupTaskModal === 'function') {
                    window.openAddSetupTaskModal(targetSite, targetEquip, '장비 반입 및 정위치');
                } else {
                    alert('작업 추가 팝업 기능을 찾을 수 없습니다. 페이지를 새로고침 해주세요.');
                }
            } else {
                alert('장비를 먼저 선택해주세요.');
            }
        });
        sidebarHeader.appendChild(addBtn);
        sidebarHeader.appendChild(settingBtn);
    }
});


function setupGanttSearch() {
    const filterBtn = document.getElementById('btn-gantt-filter');

    if (filterBtn) {
        filterBtn.onclick = () => openGanttSearchModal();
    }
}

function setupGanttZoom() {
    const btnExpand = document.getElementById('btn-gantt-expand');
    const btnContract = document.getElementById('btn-gantt-contract');

    if (btnExpand) {
        btnExpand.onclick = () => {
            ganttExtraWeeks++;
            renderGanttChart();
        };
    }
    if (btnContract) {
        btnContract.onclick = () => {
            if (ganttExtraWeeks > 0) {
                ganttExtraWeeks--;
                renderGanttChart();
            }
        };
    }
}

function setupGanttResizer() {
    const resizer = document.querySelector('.gantt__resizer');
    const sidebar = document.querySelector('.gantt__sidebar');
    if (!resizer || !sidebar) return;
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault(); document.body.style.cursor = 'col-resize'; resizer.classList.add('resizing');
        const onMouseMove = (ev) => {
            const w = ev.clientX - sidebar.getBoundingClientRect().left;
            if (w > GANTT_SIDEBAR_MIN_WIDTH && w < GANTT_SIDEBAR_MAX_WIDTH) {
                ganttSidebarWidth = w;
                sidebar.style.width = `${w}px`;
                renderGanttChart();
            }
        };
        const onMouseUp = () => { document.body.style.cursor = 'default'; resizer.classList.remove('resizing'); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
        document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
    });
}

function setupEquipInfoResizer() {
    const resizer = document.getElementById('setup-equip-resizer');
    const group = document.getElementById('setup-equip-info-group');

    if (!resizer || !group) return;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.body.style.cursor = 'col-resize';
        resizer.classList.add('resizing');

        const startX = e.clientX;
        const startWidth = group.getBoundingClientRect().width;

        const onMouseMove = (ev) => {
            const deltaX = startX - ev.clientX;
            const newWidth = startWidth + deltaX;
            if (newWidth > 200 && newWidth < 800) {
                group.style.flex = 'none';
                group.style.width = `${newWidth}px`;
            }
        };

        const onMouseUp = () => {
            document.body.style.cursor = 'default';
            resizer.classList.remove('resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

/* ==========================================================================
   [3] 데이터 처리 및 로직 (Data Operations)
   ========================================================================== */

function updateTaskDate(site, equip, id, type, change, mode = 'move') {
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    let data = setupData[equipKey] || {};
    const task = data.setupDetails ? data.setupDetails.find(t => t.id == id) : null;
    if (task) {
        if (mode === 'manual') {
            task.startDate = change.start;
            const s = new Date(change.start);
            const e = new Date(change.end);
            let days = 0;
            let temp = new Date(s);
            while (temp < e) {
                temp = addBusinessDays(temp, 1);
                days++;
            }
            task.estDays = (days + 1).toString();
        }
        else if (mode === 'visual-update') {
            if (type === 'exec') {
                if (change.newStart && !isDayCountMode) task.execStartDate = change.newStart;
                if (change.newEnd && !isDayCountMode) task.date = change.newEnd;
            } else if (type === 'plan') {
                if (isDayCountMode) {
                    // [추가] 일수 모드에서는 가상 날짜 대신 실제 이동한 칸 수(delta)를 원본 날짜에 반영
                    if (change.deltaStartDays !== undefined && change.deltaStartDays !== 0 && task.startDate) {
                        const originalDate = new Date(task.startDate);
                        originalDate.setDate(originalDate.getDate() + change.deltaStartDays);
                        task.startDate = originalDate.toISOString().split('T')[0];
                    }
                    if (change.newEstDays !== undefined && change.newEstDays > 0) {
                        task.estDays = change.newEstDays.toString();
                    }
                } else {
                    if (change.newStart) task.startDate = change.newStart;
                    if (change.newStart && change.newEnd) {
                        let days = 0;
                        let curr = new Date(change.newStart);
                        const end = new Date(change.newEnd);
                        while (curr <= end) {
                            const d = curr.getDay();
                            const isHol = (d === 0 || d === 6) || !!getHolidayName(curr.getFullYear(), curr.getMonth(), curr.getDate());
                            if (!isHol) days++;
                            curr.setDate(curr.getDate() + 1);
                        }
                        task.estDays = days.toString();
                    }
                }
            }
        }

        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));

        // [추가] 변경된 예정일 데이터를 서버에 동기화하고 타 화면(리스트)에 즉시 갱신
        if (typeof window.syncSetupDataDB === 'function') window.syncSetupDataDB(site, equip, data.setupDetails, data.setupLogs);
        if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
        if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) renderSetupDetailList();
        renderGanttChart();
    }
}

function deleteSetupTask(site, equip, id) {
    if (!confirm('이 일정을 삭제하시겠습니까?')) return;
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    let data = setupData[equipKey] || {};
    if (data.setupDetails) {
        data.setupDetails = data.setupDetails.filter(t => t.id !== id);
        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
        renderGanttChart();
    }
}

/* ==========================================================================
   [4] 간트 차트 렌더링 (Rendering)
   ========================================================================== */

function renderGanttChart() {
    const wrapper = document.getElementById('gantt-wrapper');
    const emptyMsg = document.getElementById('gantt-empty-msg');
    const taskList = document.getElementById('gantt-task-list');
    const timeline = document.getElementById('gantt-timeline');
    const headerMonths = document.getElementById('gantt-header-months');
    const headerWeeks = document.getElementById('gantt-header-weeks');
    const ganttBody = document.getElementById('gantt-body');
    const sidebar = document.getElementById('gantt-sidebar');
    const targetInfoEl = document.getElementById('gantt-target-info');

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    // 선택된 장비 정보 표시
    if (targetInfoEl) {
        let infoText = '';
        const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
        if (currentGanttFilters.site && currentGanttFilters.equip) {
            const parts = currentGanttFilters.equip.split('::');
            const rawName = parts[0];
            const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
            const serial = parts.length > 1 ? parts[1] : '';
            infoText = `${currentGanttFilters.site} > ${displayName} ${serial ? `(${serial})` : ''}`;

            const data = setupData[`${currentGanttFilters.site}::${currentGanttFilters.equip}`];
            if (data && data.setupDetails && data.setupDetails.length > 0) {
                const total = data.setupDetails.length;
                const completed = data.setupDetails.filter(t => t.completed).length;
                const percent = Math.round((completed / total) * 100);
                infoText += `   [진행률: ${percent}%]`;
            }
        }
        targetInfoEl.textContent = infoText;
    }

    const btnGanttAddTask = document.getElementById('btn-gantt-add-task');
    const btnGanttSettings = document.getElementById('btn-gantt-settings');
    const hasActiveFilter = currentGanttFilters.site || currentGanttFilters.equip;
    if (!hasActiveFilter) {
        if (wrapper) wrapper.style.display = 'none';
        if (emptyMsg) {
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = '장비 정보에서 리스트를 클릭하면 간트뷰 일정이 표시됩니다.';
        }
        if (btnGanttAddTask) btnGanttAddTask.style.display = 'none';
        if (btnGanttSettings) btnGanttSettings.style.display = 'none';
        return;
    } else {
        if (btnGanttSettings) btnGanttSettings.style.display = 'flex';
        const ganttArea = document.getElementById('gantt-chart-area');
        if (ganttArea && ganttArea.classList.contains('edit-mode')) {
            if (btnGanttAddTask) btnGanttAddTask.style.display = 'flex';
        } else {
            if (btnGanttAddTask) btnGanttAddTask.style.display = 'none';
        }
    }

    let allTasks = [];
    const mainData = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            mainData[site].forEach(equip => {
                const data = setupData[`${site}::${equip}`];

                if (data && data.setupDetails) {
                    // [추가] 장비 단위 셋업 완료 여부 판단 및 상태 필터링
                    const completeTask = data.setupDetails.find(t => t.content === '셋업 완료' || t.category === '셋업 완료');
                    const isEquipCompleted = completeTask && completeTask.completed;

                    const showIng = currentGanttFilters.showIng !== false; // 기본값 true
                    const showDone = currentGanttFilters.showDone !== false; // 기본값 true

                    if (!showIng && !isEquipCompleted) return;
                    if (!showDone && isEquipCompleted) return;

                    data.setupDetails.forEach((task, idx) => {
                        const parts = equip.split('::');
                        const equipName = parts[0];
                        const displayName = task.content;

                        const matchSite = !currentGanttFilters.site || site === currentGanttFilters.site;
                        const matchEquip = !currentGanttFilters.equip || equip === currentGanttFilters.equip || equipName === currentGanttFilters.equip;

                        if (matchSite && matchEquip) {
                            let estDays = parseInt(task.estDays) || 0;
                            if (task.content === '셋업 완료' || task.category === '셋업 완료') {
                                estDays = 1;
                            }
                            const pStart = task.startDate ? new Date(task.startDate) : (projectStartDate ? new Date(projectStartDate) : new Date());
                            const daysToAdd = estDays > 0 ? estDays - 1 : 0;
                            const pEnd = addBusinessDays(pStart, daysToAdd);

                            let execStart = null;
                            let execEnd = null;
                            let statusClass = '';

                            // [개선] 등록된 로그 수 기반으로 상태 판단
                            const taskLogs = (data.setupLogs || []).filter(l => l.content === displayName);
                            const workedDays = new Set(taskLogs.map(l => l.date)).size;

                            if (taskLogs.length > 0) {
                                taskLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
                                execStart = taskLogs[0].date;
                                execEnd = task.date || taskLogs[taskLogs.length - 1].date;

                                if (task.completed) {
                                    statusClass = 'exec';
                                } else {
                                    statusClass = 'exec-progress';
                                }
                            }

                            const logDates = taskLogs.map(l => l.date).filter(Boolean);

                            allTasks.push({
                                listIndex: idx,
                                id: task.id,
                                site: site,
                                equip: equip,
                                category: task.category || '',
                                displayName: displayName,
                                planStart: task.startDate,
                                planEnd: pEnd.toISOString().split('T')[0],
                                execStart: execStart,
                                execEnd: execEnd,
                                estDays: estDays,
                                statusClass: statusClass,
                                completed: task.completed,
                                logDates: logDates // [추가] 셋업 작업 기록 날짜
                            });
                        }
                    });
                }
            });
        }
    });

    if (allTasks.length === 0) {
        if (wrapper) wrapper.style.display = 'none';
        if (emptyMsg) {
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = '검색 결과가 없습니다.';
        }
        return;
    }

    // [추가] 일수 모드 적용 (날짜 갭을 무시하고 모든 일정을 연속되게 재배치)
    let equipRealToVirtMap = {}; // [추가] 장비 단위 실제 날짜 -> 가상 날짜 매핑 

    if (isDayCountMode) {
        const groupedTasks = {};
        allTasks.forEach(t => {
            const key = `${t.site}::${t.equip}`;
            if (!groupedTasks[key]) groupedTasks[key] = [];
            groupedTasks[key].push(t);
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const addContinuousDays = (date, days) => {
            const res = new Date(date);
            res.setDate(res.getDate() + days);
            return res;
        };

        const formatDate = (d) => {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };

        let sequencedTasks = [];

        Object.values(groupedTasks).forEach(tasks => {
            // [수정] 계획일이 아닌 실제 셋업 리스트 화면에 나열된 순서(인덱스)를 기준으로 정렬하여 겹침 방지
            tasks.sort((a, b) => a.listIndex - b.listIndex);

            let activeIndex = tasks.findIndex(t => !t.completed);
            if (activeIndex === -1) activeIndex = tasks.length - 1; // 모두 완료 시 마지막 작업
            if (activeIndex === -1) return;

            // [수정] 계획일이 동일한 작업은 같은 일차(가상 날짜)로 묶어서 처리
            const dateGroups = [];
            tasks.forEach(t => {
                t.originalPlanStart = t.planStart;
                let estDays = parseInt(t.estDays) || 1;
                if (t.category === '셋업 완료' || t.displayName === '셋업 완료') estDays = 1;

                let group = dateGroups.find(g => g.realStart === t.originalPlanStart);
                if (!group) {
                    group = { realStart: t.originalPlanStart, maxEstDays: estDays, tasks: [] };
                    dateGroups.push(group);
                } else {
                    if (estDays > group.maxEstDays) group.maxEstDays = estDays;
                }
                group.tasks.push(t);
            });

            // activeIndex에 해당하는 작업의 그룹을 찾음
            const activeGroupIndex = dateGroups.findIndex(g => g.tasks.includes(tasks[activeIndex]));

            const virtStartMap = new Map();

            // 1. 순방향 배정 (현재 그룹부터 끝까지)
            let currentVirtStart = new Date(today);
            for (let i = activeGroupIndex; i < dateGroups.length; i++) {
                const g = dateGroups[i];
                if (i === activeGroupIndex) {
                    virtStartMap.set(g.realStart, new Date(currentVirtStart));
                } else {
                    const prevG = dateGroups[i - 1];
                    const rCurr = new Date(g.realStart);
                    const rPrev = new Date(prevG.realStart);
                    rCurr.setHours(0, 0, 0, 0);
                    rPrev.setHours(0, 0, 0, 0);
                    const diffDays = Math.round((rCurr - rPrev) / 86400000);
                    currentVirtStart = addContinuousDays(currentVirtStart, diffDays);
                    virtStartMap.set(g.realStart, new Date(currentVirtStart));
                }
            }

            // 2. 역방향 배정 (현재 그룹 이전부터 처음까지)
            let currentVirtEnd = new Date(today);
            for (let i = activeGroupIndex - 1; i >= 0; i--) {
                const g = dateGroups[i];
                const nextG = dateGroups[i + 1];
                const rCurr = new Date(g.realStart);
                const rNext = new Date(nextG.realStart);
                rCurr.setHours(0, 0, 0, 0);
                rNext.setHours(0, 0, 0, 0);
                const diffDays = Math.round((rNext - rCurr) / 86400000);
                currentVirtEnd = addContinuousDays(currentVirtEnd, -diffDays);
                virtStartMap.set(g.realStart, new Date(currentVirtEnd));
            }

            // 3. 각 Task에 가상 날짜 배정
            tasks.forEach(t => {
                const virtStart = virtStartMap.get(t.originalPlanStart);
                let estDays = parseInt(t.estDays) || 1;
                if (t.category === '셋업 완료' || t.displayName === '셋업 완료') estDays = 1;
                const virtEnd = addContinuousDays(virtStart, estDays - 1);

                t.planStart = formatDate(virtStart);
                t.planEnd = formatDate(virtEnd);

                if (t.execStart) {
                    t.execStart = t.planStart;
                    if (t.completed) {
                        t.execEnd = t.planEnd;
                    } else {
                        // 미완료 진행 중인 경우, 오늘까지만 실행된 것으로 시각적 표현
                        t.execEnd = formatDate(today);
                    }
                }
            });

            // [개선] 각 태스크의 가상 계획 날짜(t.planStart)와 실제 등록된 작업 로그 날짜를 매핑
            const equipMap = {};
            tasks.forEach(t => {
                if (t.logDates && t.logDates.length > 0) {
                    const sortedRealDates = [...t.logDates].sort();
                    const virtStart = new Date(t.planStart);

                    sortedRealDates.forEach((rDate, idx) => {
                        const vDate = new Date(virtStart);
                        vDate.setDate(vDate.getDate() + idx);
                        const vDateStr = `${vDate.getFullYear()}-${String(vDate.getMonth() + 1).padStart(2, '0')}-${String(vDate.getDate()).padStart(2, '0')}`;
                        equipMap[rDate] = vDateStr;
                    });
                }
            });
            const equipKey = `${tasks[0].site}::${tasks[0].equip}`;
            equipRealToVirtMap[equipKey] = equipMap;

            sequencedTasks.push(...tasks);
        });

        allTasks = sequencedTasks;
    }

    if (wrapper) wrapper.style.display = 'flex';
    if (emptyMsg) emptyMsg.style.display = 'none';
    if (sidebar) sidebar.style.width = `${ganttSidebarWidth}px`;

    allTasks.sort((a, b) => new Date(a.planStart || a.start) - new Date(b.planStart || b.start));

    let minDate = null;
    let maxDate = null;
    let projectStartDate = null;
    let evalStartDate = null;

    allTasks.forEach(t => {
        const pStart = t.planStart || t.start;
        const pEnd = t.planEnd || t.end;
        const eStart = t.execStart || t.start;
        const eEnd = t.execEnd || t.end;

        [pStart, pEnd, eStart, eEnd].forEach(dStr => {
            if (dStr) {
                const d = new Date(dStr);
                if (!isNaN(d.getTime())) {
                    if (minDate === null || d < minDate) minDate = d;
                    if (maxDate === null || d > maxDate) maxDate = d;
                }
            }
        });

        // [추가] 초기 셋업 일수 표시를 위한 기준일 추출
        if (pStart) {
            const dStart = new Date(pStart);
            if (!isNaN(dStart.getTime())) {
                if (projectStartDate === null || dStart < projectStartDate) projectStartDate = dStart;
                if (t.category === '셋업 평가' || t.category === '셋업 완료') {
                    if (evalStartDate === null || dStart < evalStartDate) evalStartDate = dStart;
                }
            }
        }
    });

    if (minDate === null) minDate = new Date();
    if (maxDate === null) maxDate = new Date();

    if (projectStartDate) projectStartDate.setHours(0, 0, 0, 0);
    if (evalStartDate) evalStartDate.setHours(0, 0, 0, 0);
    // 셋업 평가 일정이 아예 없는 경우, 차트 끝까지 일수(Day)로 표시하기 위해 무한대 값 적용
    if (projectStartDate && !evalStartDate) {
        evalStartDate = new Date(maxDate);
        evalStartDate.setDate(evalStartDate.getDate() + 100);
    }

    minDate.setDate(minDate.getDate() - GANTT_PADDING_START);
    maxDate.setDate(maxDate.getDate() + GANTT_PADDING_END + (ganttExtraWeeks * 7));

    ganttValidDates = [];
    const dateMap = new Map();
    let tempDate = new Date(minDate);
    let colIndex = 0;

    while (tempDate <= maxDate) {
        // 일수 모드이든 날짜 모드이든 공통으로 주말 및 공휴일을 배제시킵니다.
        const isHol = typeof window.isHoliday === 'function' ? window.isHoliday(tempDate) : false;

        if (!isHol) {
            const dStr = tempDate.toISOString().split('T')[0];
            const d = new Date(tempDate);
            d.setHours(0, 0, 0, 0);

            if (isDayCountMode) {
                ganttValidDates.push({
                    date: new Date(tempDate),
                    str: dStr,
                    holiday: null
                });
                dateMap.set(dStr, colIndex++);
            } else {
                const hol = getHolidayName(tempDate.getFullYear(), tempDate.getMonth(), tempDate.getDate());
                ganttValidDates.push({
                    date: new Date(tempDate),
                    str: dStr,
                    holiday: hol
                });
                dateMap.set(dStr, colIndex++);
            }
        }
        tempDate.setDate(tempDate.getDate() + 1);
    }

    const container = document.getElementById('gantt-timeline-container');
    if (container && container.clientWidth > 0 && ganttValidDates.length > 0) {
        if (window.innerWidth <= 950) {
            // [수정] 모바일에서는 화면 방향(가로/세로)에 맞춰 고정 너비를 사용하여 컬럼 틀어짐 방지
            const isLandscape = window.matchMedia("(orientation: landscape)").matches;
            ganttDayWidth = isLandscape ? 40 : 35;
        } else {
            // 데스크톱에서는 전체 일정을 화면에 맞춤
            ganttDayWidth = container.clientWidth / ganttValidDates.length;
        }
    } else {
        ganttDayWidth = 20;
    }
    const totalWidth = ganttValidDates.length * ganttDayWidth;

    if (taskList) {
        const template = document.getElementById('gantt-task-template');
        taskList.innerHTML = '';

        // [추가] 드래그 앤 드롭을 위한 dragover 이벤트 등록 (최초 1회)
        if (!taskList.dataset.dragBound) {
            taskList.dataset.dragBound = 'true';
            taskList.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (typeof window.getDragAfterElement === 'function') {
                    const afterElement = window.getDragAfterElement(taskList, e.clientY, '.gantt__task-item:not(.dragging)');
                    const draggable = document.querySelector('.gantt__task-item.dragging');
                    if (draggable) {
                        if (afterElement == null) taskList.appendChild(draggable);
                        else taskList.insertBefore(draggable, afterElement);
                    }
                }
            });
        }

        allTasks.forEach((t, index) => {
            const clone = template.content.cloneNode(true);
            const taskDiv = clone.querySelector('.gantt__task-item');

            taskDiv.dataset.id = t.id;
            taskDiv.dataset.site = t.site;
            taskDiv.dataset.equip = t.equip;
            taskDiv.ondblclick = () => {
                if (!isDayCountMode) openDateEditModal(t.site, t.equip, t.id, 'plan');
            };

            // [추가] 특정 장비가 단일 선택된 경우에만 순서 변경 드래그 활성화
            if (currentGanttFilters.site && currentGanttFilters.equip) {
                taskDiv.draggable = true;
                taskDiv.style.cursor = 'grab';
                taskDiv.addEventListener('dragstart', () => {
                    taskDiv.classList.add('dragging');
                });
                taskDiv.addEventListener('dragend', () => {
                    taskDiv.classList.remove('dragging');
                    if (typeof reorderGanttTasks === 'function') {
                        reorderGanttTasks(t.site, t.equip);
                    }
                });
            }

            const label = clone.querySelector('.gantt__task-label');
            label.title = `${t.site} > ${t.equip}`;
            label.textContent = t.displayName;

            const btnAdd = clone.querySelector('.gantt__btn-add');
            if (btnAdd) {
                btnAdd.remove(); // [수정] 개별 항목의 추가 버튼 일괄 제거
            }

            const progressSpan = clone.querySelector('.gantt__task-progress');
            if (t.execStart && t.execEnd) {
                let pct = 0; // [개선] 50% 100% 고정 상태 판단
                if (t.completed) pct = 100;
                else if (t.execStart) pct = 50;

                progressSpan.textContent = `${pct}%`;

                progressSpan.className = 'gantt__task-progress'; // 클래스 초기화
                if (pct === 0) progressSpan.classList.add('gantt__task-progress--empty');
                else if (pct === 100) progressSpan.classList.add('gantt__task-progress--complete');
                else progressSpan.classList.add('gantt__task-progress--ongoing');
            } else {
                progressSpan.remove();
            }

            const btnDel = clone.querySelector('.btn-del-sm');

            // [추가] 편집 버튼 (작업명 수정) 생성
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-edit-sm';
            btnEdit.innerHTML = '✏️';
            btnEdit.title = '작업명 수정';

            if (t.completed) {
                if (btnDel) {
                    btnDel.disabled = true;
                    btnDel.title = '완료된 작업은 삭제할 수 없습니다.';
                }
                btnEdit.disabled = true;
                btnEdit.title = '완료된 작업은 수정할 수 없습니다.';
            } else {
                if (btnDel) btnDel.onclick = () => deleteSetupTask(t.site, t.equip, t.id);
                btnEdit.onclick = (e) => {
                    e.stopPropagation();
                    const isEditing = taskDiv.classList.contains('editing');
                    if (!isEditing) {
                        taskDiv.classList.add('editing');
                        taskDiv.draggable = false;
                        btnEdit.textContent = '✅';

                        const currentName = label.textContent;
                        // 텍스트 너비 고정을 위해 flex 사용 설정 반영
                        label.innerHTML = `<input type="text" class="input-dark input-edit-small" value="${escapeHtml(currentName)}" onclick="event.stopPropagation()" style="width:100%;">`;
                        const input = label.querySelector('input');
                        input.focus();
                        input.addEventListener('keypress', (ev) => {
                            if (ev.key === 'Enter') btnEdit.click();
                        });
                    } else {
                        const input = label.querySelector('input');
                        const newName = input.value.trim();
                        if (!newName) {
                            alert('작업명을 입력해주세요.');
                            return;
                        }

                        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
                        const equipKey = `${t.site}::${t.equip}`;
                        const data = setupData[equipKey] || {};
                        if (data.setupDetails) {
                            if (newName !== t.displayName && data.setupDetails.some(item => item.content === newName)) {
                                alert('이미 존재하는 작업명입니다.');
                                return;
                            }

                            const taskObj = data.setupDetails.find(item => item.id === t.id);
                            if (taskObj) {
                                taskObj.content = newName;
                                setupData[equipKey] = data;
                                localStorage.setItem('setup_data', JSON.stringify(setupData));
                                if (typeof window.syncSetupDataDB === 'function') {
                                    window.syncSetupDataDB(t.site, t.equip, data.setupDetails, data.setupLogs);
                                }
                                if (typeof addSystemLog === 'function') {
                                    addSystemLog('UPDATE_SETUP_ITEM', t.equip, `간트뷰 작업명 변경: ${t.displayName} -> ${newName}`);
                                }
                            }
                        }

                        taskDiv.classList.remove('editing');
                        btnEdit.textContent = '✏️';

                        renderGanttChart();
                        if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
                        if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === t.equip) renderSetupDetailList();
                    }
                };
            }

            if (btnDel && btnDel.parentNode) {
                btnDel.parentNode.insertBefore(btnEdit, btnDel);
            }

            taskList.appendChild(clone);
        });
    }

    if (timeline) {
        timeline.style.width = `${totalWidth}px`;
        timeline.style.position = 'relative'; // [추가] 절대 위치(absolute) 자식 요소의 기준점 설정
    }
    let monthHtml = '';
    let currentYm = null;
    let span = 0;

    ganttValidDates.forEach((dObj, i) => {
        const d = new Date(dObj.date);
        d.setHours(0, 0, 0, 0);
        let ym = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;

        // [수정] 일수 모드일 경우에만 헤더 변경 (기본 모드는 달력 연월 표시)
        if (isDayCountMode) {
            ym = '셋업 진행 (일수 모드)';
        }

        if (ym !== currentYm) {
            if (currentYm !== null) {
                monthHtml += `<div class="gantt__date-cell gantt__date-cell--month" style="width: ${span * ganttDayWidth}px;">${currentYm}</div>`;
            }
            currentYm = ym;
            span = 1;
        } else span++;
    });
    if (span > 0) {
        monthHtml += `<div class="gantt__date-cell gantt__date-cell--month" style="width: ${span * ganttDayWidth}px;">${currentYm}</div>`;
    }
    if (headerMonths) headerMonths.innerHTML = monthHtml;

    let dayHtml = '';
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // [추가] 가상 날짜 -> 실제 표시 날짜 매핑 계산
    const virtToRealMap = new Map();
    const activeEquipKey = currentGanttFilters.equip ? `${currentGanttFilters.site}::${currentGanttFilters.equip}` : null;

    let targetEquipMap = null;
    if (activeEquipKey && equipRealToVirtMap[activeEquipKey]) {
        targetEquipMap = equipRealToVirtMap[activeEquipKey];
    } else if (Object.keys(equipRealToVirtMap).length > 0) {
        targetEquipMap = Object.values(equipRealToVirtMap)[0];
    }

    if (targetEquipMap) {
        for (const [rDate, vDate] of Object.entries(targetEquipMap)) {
            virtToRealMap.set(vDate, rDate);
        }
    }

    // [추가] 일수 모드일 때 하이라이트(오늘) 기준일을 '마지막 완료일의 다음 날'로 재설정
    let highlightDateStr = todayStr;
    if (isDayCountMode) {
        let maxCompDate = null;
        allTasks.forEach(t => {
            if (t.completed && (t.execEnd || t.planEnd)) {
                const d = new Date(t.execEnd || t.planEnd);
                if (!maxCompDate || d > maxCompDate) maxCompDate = d;
            }
        });

        if (maxCompDate) {
            maxCompDate.setHours(0, 0, 0, 0);
            const nextValid = ganttValidDates.find(dObj => {
                const vd = new Date(dObj.date);
                vd.setHours(0, 0, 0, 0);
                return vd > maxCompDate;
            });
            if (nextValid) highlightDateStr = nextValid.str;
        } else if (projectStartDate) {
            highlightDateStr = `${projectStartDate.getFullYear()}-${String(projectStartDate.getMonth() + 1).padStart(2, '0')}-${String(projectStartDate.getDate()).padStart(2, '0')}`;
        }
    }

    // [추가] 일수 모드 날짜 양방향 매핑 처리
    const nodeFinalDateMap = new Map();
    if (isDayCountMode) {
        const dayNodes = [];
        ganttValidDates.forEach(dObj => {
            const d = new Date(dObj.date);
            d.setHours(0, 0, 0, 0);
            if (projectStartDate && d >= projectStartDate) {
                let mappedDate = null;
                if (virtToRealMap.has(dObj.str)) {
                    const rDateStr = virtToRealMap.get(dObj.str);
                    const [y, m, day] = rDateStr.split('-').map(Number);
                    mappedDate = new Date(y, m - 1, day);
                }
                dayNodes.push({
                    str: dObj.str,
                    mappedDate: mappedDate,
                    finalDate: mappedDate ? new Date(mappedDate) : null
                });
            }
        });

        // 1. 역방향 전파 (오른쪽에서 왼쪽으로 채우기)
        for (let i = dayNodes.length - 1; i >= 0; i--) {
            if (dayNodes[i].finalDate) {
                let current = new Date(dayNodes[i].finalDate);
                for (let j = i - 1; j >= 0; j--) {
                    if (dayNodes[j].mappedDate) break;
                    current = addBusinessDays(current, -1);
                    dayNodes[j].finalDate = new Date(current);
                }
            }
        }

        // 2. 순방향 전파 (왼쪽에서 오른쪽으로 채우기)
        let lastValid = null;
        for (let i = 0; i < dayNodes.length; i++) {
            if (dayNodes[i].finalDate) {
                lastValid = new Date(dayNodes[i].finalDate);
            } else {
                if (lastValid) {
                    lastValid = addBusinessDays(lastValid, 1);
                    dayNodes[i].finalDate = new Date(lastValid);
                } else {
                    const d = new Date(dayNodes[i].str);
                    let firstDate = new Date(d);
                    if (typeof window.isHoliday === 'function' && window.isHoliday(firstDate)) {
                        firstDate = addBusinessDays(firstDate, 1);
                    }
                    dayNodes[i].finalDate = firstDate;
                    lastValid = new Date(firstDate);
                }
            }
        }

        dayNodes.forEach(node => {
            nodeFinalDateMap.set(node.str, {
                date: node.finalDate,
                isMapped: !!node.mappedDate
            });
        });
    }

    let relativeDayCount = 1;

    ganttValidDates.forEach((dObj, i) => {
        let cellClass = 'gantt__date-cell gantt__date-cell--day';
        let content = dObj.date.getDate();
        let tooltip = `${dObj.str} ${dObj.holiday || ''}`;

        const d = new Date(dObj.date);
        d.setHours(0, 0, 0, 0);

        // [수정] 일수 모드일 경우 상대 일수(Day N)와 기록된 날짜를 연동하여 2줄로 표시
        if (isDayCountMode) {
            if (projectStartDate && d >= projectStartDate) {
                const dayNum = relativeDayCount++;

                let displayDateObj = null;
                let isMapped = false;

                if (nodeFinalDateMap.has(dObj.str)) {
                    const info = nodeFinalDateMap.get(dObj.str);
                    displayDateObj = info.date;
                    isMapped = info.isMapped;
                } else {
                    displayDateObj = new Date(d);
                }

                const shortDate = `${String(displayDateObj.getMonth() + 1).padStart(2, '0')}/${String(displayDateObj.getDate()).padStart(2, '0')}`;
                const dateColor = isMapped ? 'color: #58a6ff;' : 'color: #8b949e;';

                content = `<div style="display:flex; flex-direction:column; gap:4px; align-items:center;"><span style="color:var(--gantt-text-primary); font-weight:bold; font-size:10px; line-height:1;">Day ${dayNum}</span><span style="font-size:9px; line-height:1; ${dateColor}">${shortDate}</span></div>`;

                const displayFullDate = `${displayDateObj.getFullYear()}-${String(displayDateObj.getMonth() + 1).padStart(2, '0')}-${String(displayDateObj.getDate()).padStart(2, '0')}`;
                tooltip = `Day ${dayNum} (${displayFullDate}${isMapped ? ' - 실제 기록됨' : ' - 예상'})`;
            } else {
                content = '-';
                tooltip = '';
            }
        }

        if (dObj.holiday) {
            cellClass += ' gantt__date-cell--holiday';
        }
        if (dObj.str === highlightDateStr) { // [수정] 하이라이트 기준일 변경
            cellClass += ' gantt__date-cell--today';
        }

        dayHtml += `<div class="${cellClass}" style="width: ${ganttDayWidth}px;" title="${tooltip}">${content}</div>`;
    });
    if (headerWeeks) headerWeeks.innerHTML = dayHtml;

    let bgHtml = '';
    let linesHtml = '';

    ganttValidDates.forEach((dObj, i) => {
        const left = i * ganttDayWidth;

        if (dObj.holiday) {
            bgHtml += `<div class="gantt__grid-bg gantt__grid-bg--holiday" style="left: ${left}px; width: ${ganttDayWidth}px;" title="${dObj.holiday}"></div>`;
        }

        if (dObj.str === highlightDateStr) { // [수정] 하이라이트 기준일 변경
            bgHtml += `<div class="gantt__grid-bg gantt__grid-bg--today" style="left: ${left}px; width: ${ganttDayWidth}px;"></div>`;
        }

        linesHtml += `<div class="gantt__grid-line" style="left: ${left}px;"></div>`;
    });

    const gridLinesHtml = bgHtml + linesHtml;

    let bodyHtml = '';

    const getIndex = (dateStr, isEnd) => {
        if (dateMap.has(dateStr)) return dateMap.get(dateStr);
        const target = new Date(dateStr);
        if (isEnd) {
            for (let i = ganttValidDates.length - 1; i >= 0; i--) if (ganttValidDates[i].date <= target) return i;
            return -1;
        } else {
            for (let i = 0; i < ganttValidDates.length; i++) if (ganttValidDates[i].date >= target) return i;
            return ganttValidDates.length;
        }
    };

    const createSegments = (startIndex, endIndex) => {
        let html = '';
        let segStart = -1;
        for (let i = startIndex; i <= endIndex; i++) {
            if (i < 0 || i >= ganttValidDates.length) continue;
            if (!ganttValidDates[i].holiday) {
                if (segStart === -1) segStart = i;
            } else {
                if (segStart !== -1) {
                    const l = (segStart - startIndex) * ganttDayWidth;
                    const w = (i - segStart) * ganttDayWidth;
                    html += `<div class="gantt__bar-segment" style="left: ${l}px; width: ${w}px;"></div>`;
                    segStart = -1;
                }
            }
        }
        if (segStart !== -1) {
            const l = (segStart - startIndex) * ganttDayWidth;
            const w = (endIndex - segStart + 1) * ganttDayWidth;
            html += `<div class="gantt__bar-segment" style="left: ${l}px; width: ${w}px;"></div>`;
        }
        return html;
    };

    allTasks.forEach((t, index) => {
        const pStart = new Date(t.planStart || t.start);
        const pEnd = new Date(t.planEnd || t.end);

        let pStartIndex = getIndex(t.planStart, false);
        let pEndIndex = getIndex(t.planEnd, true);

        if (pEndIndex < pStartIndex && pStart <= pEnd) {
            if (pStartIndex < ganttValidDates.length) pEndIndex = pStartIndex;
            else if (pEndIndex >= 0) pStartIndex = pEndIndex;
        }

        const pLeft = pStartIndex * ganttDayWidth;
        const pWidth = (pEndIndex - pStartIndex + 1) * ganttDayWidth;

        const eStart = new Date(t.execStart || t.start);
        const eEnd = new Date(t.execEnd || t.end);

        let eStartIndex = getIndex(t.execStart, false);
        let eEndIndex = getIndex(t.execEnd, true);

        if (eEndIndex < eStartIndex && eStart <= eEnd) {
            if (eStartIndex < ganttValidDates.length) eEndIndex = eStartIndex;
            else if (eEndIndex >= 0) eStartIndex = eEndIndex;
        }

        const eLeft = eStartIndex * ganttDayWidth;
        const eWidth = (eEndIndex - eStartIndex + 1) * ganttDayWidth;

        const pSegments = createSegments(pStartIndex, pEndIndex);
        const eSegments = createSegments(eStartIndex, eEndIndex);

        const resizeHandles = t.completed ? '' : '<div class="gantt__bar-handle gantt__bar-handle--left"></div><div class="gantt__bar-handle gantt__bar-handle--right"></div>';

        const statusModifier = t.statusClass === 'exec' ? 'gantt__bar--exec' : (t.statusClass === 'exec-progress' ? 'gantt__bar--progress' : 'gantt__bar--delayed');

        // [수정] 카테고리에 따른 툴팁 표시 방식 변경
        let planTitle = `계획: ${t.planStart} ~ ${t.planEnd}`;
        let execTitle = `실행: ${t.execStart} ~ ${t.execEnd}`;

        if (t.category === '장비 반입 및 정위치' || t.category === '통신 상태 및 유틸리티') {
            planTitle = `계획: ${t.estDays}일 소요`;

            if (t.execStart && t.execEnd) {
                const wDays = new Set(t.logDates || []).size;
                execTitle = `실행: ${wDays}일 진행됨`;
            }
        }

        // [수정] 일수 모드에서는 원본 날짜와 가상 날짜의 차이(offset)를 계산하여, 실제 작업한 날짜가 클릭한 칸에 정확히 매칭되도록 블록 생성
        let execBarsHtml = '';
        if (isDayCountMode) {
            if (t.execStart && t.logDates && t.logDates.length > 0) {
                const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
                const equipKey = `${t.site}::${t.equip}`;
                const equipLogs = (setupData[equipKey] && setupData[equipKey].setupLogs) ? setupData[equipKey].setupLogs : [];

                const equipMap = equipRealToVirtMap[equipKey]; // [추가] 장비 글로벌 날짜 매핑 사용

                const uniqueDates = [...new Set(t.logDates)].sort();
                uniqueDates.forEach(dateStr => {
                    // [수정] 개별 작업의 계획 시작일이 아닌, 장비 글로벌 가상 날짜 매핑을 사용하여 동일한 실제 날짜는 동일한 일차(열)에 표시
                    let virtDateStr;
                    if (equipMap && equipMap[dateStr]) {
                        virtDateStr = equipMap[dateStr];
                    } else {
                        // 매핑 실패 시 fallback
                        virtDateStr = t.planStart;
                    }

                    const colIndex = getIndex(virtDateStr, false);
                    if (colIndex !== -1) {
                        const log = equipLogs.find(l => l.date === dateStr && l.content === t.displayName);
                        const logId = log ? log.id : null;
                        const logTitle = log ? `작업자: ${log.worker}\n내용: ${log.memo}` : `작업 기록: ${dateStr}`;
                        // [수정] logId를 문자열로 감싸 파싱 에러 방지
                        const clickHandler = logId ? `onclick="openLogForEditing('${t.site}', '${t.equip}', '${logId}')"` : '';

                        const left = colIndex * ganttDayWidth;
                        const width = ganttDayWidth;
                        execBarsHtml += `<div class="gantt__bar ${statusModifier}" style="left: ${left}px; width: ${width}px; cursor: pointer; pointer-events: auto;" title="${escapeHtml(logTitle)}" ${clickHandler}>
                            <div class="gantt__bar-segment" style="left: 0px; width: ${width}px;"></div>
                        </div>`;
                    }
                });
            } else if (t.completed && t.execStart) {
                // [수정] 일수 모드에서 기록이 없지만 완료 처리된 항목도 클릭하여 팝업을 띄울 수 있도록 속성 추가
                execBarsHtml = `<div class="gantt__bar ${statusModifier}" style="left: ${eLeft}px; width: ${eWidth}px; cursor: pointer; pointer-events: auto;" title="${execTitle}" data-id="${t.id}" data-type="exec" data-site="${t.site}" data-equip="${t.equip}" data-completed="${t.completed}">${eSegments}${resizeHandles}</div>`;
            }
            // 일수 모드 & 기록 없음 & 미완료 상태면 임의의 실행바를 그리지 않음 (기록한 부분만 표시)
        } else if (t.execStart) {
            // [개선] 일반 달력 모드에서도 개별 작업 기록을 클릭하여 수정할 수 있도록 변경
            if (t.logDates && t.logDates.length > 0) {
                const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
                const equipKey = `${t.site}::${t.equip}`;
                const equipLogs = (setupData[equipKey] && setupData[equipKey].setupLogs) ? setupData[equipKey].setupLogs : [];

                const uniqueDates = [...new Set(t.logDates)].sort();
                uniqueDates.forEach(dateStr => {
                    const colIndex = getIndex(dateStr, false);
                    if (colIndex !== -1) {
                        const log = equipLogs.find(l => l.date === dateStr && l.content === t.displayName);
                        const logId = log ? log.id : null;
                        const logTitle = log ? `작업자: ${log.worker}\n내용: ${log.memo}` : `작업 기록: ${dateStr}`;
                        const clickHandler = logId ? `onclick="openLogForEditing('${t.site}', '${t.equip}', '${logId}')"` : '';

                        const left = colIndex * ganttDayWidth;
                        const width = ganttDayWidth;
                        execBarsHtml += `<div class="gantt__bar ${statusModifier}" style="left: ${left}px; width: ${width}px; cursor: pointer; pointer-events: auto;" title="${escapeHtml(logTitle)}" ${clickHandler}>
                            <div class="gantt__bar-segment" style="left: 0px; width: ${width}px;"></div>
                        </div>`;
                    }
                });
            }

            // [추가] 로그가 없는 경우에도 드래그/리사이즈가 가능한 빈 실행바를 표시
            if (execBarsHtml === '') {
                execBarsHtml = `<div class="gantt__bar ${statusModifier}" style="left: ${eLeft}px; width: ${eWidth}px;" title="${execTitle}" data-id="${t.id}" data-type="exec" data-site="${t.site}" data-equip="${t.equip}" data-completed="${t.completed}">${eSegments}${resizeHandles}</div>`;
            }
        }

        bodyHtml += `
            <div class="gantt__row" data-id="${t.id}" data-site="${t.site}" data-equip="${t.equip}" data-task-name="${t.displayName}" style="cursor: pointer; pointer-events: auto;">
                <div class="gantt__bar gantt__bar--plan" style="left: ${pLeft}px; width: ${pWidth}px; cursor: ${t.completed ? 'default' : 'grab'}; pointer-events: auto;" title="${planTitle}" data-id="${t.id}" data-type="plan" data-site="${t.site}" data-equip="${t.equip}" data-completed="${t.completed}">${pSegments}${resizeHandles}</div>
                ${execBarsHtml}
            </div>`;
    });

    if (ganttBody) ganttBody.innerHTML = gridLinesHtml + bodyHtml;

    // [추가] Flex 아이템에 직접 테두리를 넣으면 발생하는 미세한 어긋남을 방지하기 위해 
    // 전체를 덮는 절대 위치 선(경계선 및 5일 굵은 선)을 오버레이로 일괄 추가
    document.querySelectorAll('.gantt-overlay-line').forEach(el => el.remove());

    if (timeline) {
        // [수정] 5일 단위 굵은 선(금요일)도 일자(Header) 부분까지 덮도록 절대 위치 오버레이로 렌더링
        ganttValidDates.forEach((dObj, i) => {
            if (!isDayCountMode && dObj.date.getDay() === 5) {
                const rightLeft = ((i + 1) * ganttDayWidth) - 1;
                const boldLine = document.createElement('div');
                boldLine.className = 'gantt__grid-line gantt__grid-line--bold gantt-overlay-line';
                boldLine.style.cssText = `position: absolute; top: 0; bottom: 0; height: 100%; left: ${rightLeft}px; z-index: 5; pointer-events: none;`;
                timeline.appendChild(boldLine);
            }
        });
    }

    // [수정] 날짜/일수 모드 공통: 작업 행 클릭 시 셋업 기록 모달 오픈
    const rowEls = ganttBody.querySelectorAll('.gantt__row');
    rowEls.forEach(row => {
        row.addEventListener('click', (e) => {
            const bar = e.target.closest('.gantt__bar');
            if (bar && bar.hasAttribute('onclick')) return;

            const site = row.dataset.site;
            const equip = row.dataset.equip;
            const taskName = row.dataset.taskName;
            const taskId = row.dataset.id;

            const rect = row.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const colIndex = Math.floor(offsetX / ganttDayWidth);

            let clickedDateStr = null;
            if (colIndex >= 0 && colIndex < ganttValidDates.length) {
                if (isDayCountMode) {
                    const virtDateStr = ganttValidDates[colIndex].str;
                    const equipKey = `${site}::${equip}`;
                    const equipMap = equipRealToVirtMap[equipKey];
                    let foundRealDate = null;

                    if (equipMap) {
                        for (const [rDate, vDate] of Object.entries(equipMap)) {
                            if (vDate === virtDateStr) {
                                foundRealDate = rDate;
                                break;
                            }
                        }
                    }

                    if (foundRealDate) {
                        clickedDateStr = foundRealDate;
                    } else {
                        // 매핑된 실제 날짜가 없는 빈 열을 클릭한 경우
                        if (equipMap) {
                            const allRealDates = Object.keys(equipMap).sort();
                            if (allRealDates.length > 0) {
                                const lastDateStr = allRealDates[allRealDates.length - 1];
                                const d = new Date(lastDateStr);
                                d.setDate(d.getDate() + 1); // 마지막 기록 다음 날짜 제안
                                clickedDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                            } else {
                                clickedDateStr = '';
                            }
                        } else {
                            clickedDateStr = '';
                        }
                    }
                } else {
                    clickedDateStr = ganttValidDates[colIndex].str;
                }
            }

            // [개선] 이미 작업이 등록되어(로그가 존재) 실행바가 있는 경우, 새로운 팝업 대신 기존 기록을 수정 모드로 열어 중복 등록 방지
            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${site}::${equip}`;
            const data = setupData[equipKey] || {};
            const taskLogs = (data.setupLogs || []).filter(l => l.content === taskName);

            let targetLog = taskLogs.find(l => l.date === clickedDateStr);

            // [수정] 빈 칸 클릭 시 항상 신규 등록 팝업을 띄워 개별 추가가 가능하도록 변경
            if (targetLog) {
                if (typeof window.openLogForEditing === 'function') window.openLogForEditing(site, equip, targetLog.id);
            } else {
                if (typeof window.openSetupLogRegisterModal === 'function') window.openSetupLogRegisterModal(site, equip, taskName, clickedDateStr);
            }
        });
    });

    setupGanttBarDrag();

}

function setupGanttBarDrag() {
    const bars = document.querySelectorAll('.gantt__bar');
    bars.forEach(bar => {
        bar.addEventListener('mousedown', (e) => {

            e.stopPropagation();
            isDraggingBar = true;
            dragStartX = e.clientX;
            dragBarEl = bar;
            dragBarInitialLeft = parseFloat(bar.style.left);
            dragBarInitialWidth = parseFloat(bar.style.width);
            hasMoved = false;
            isHoveringHoliday = false;

            if (bar.dataset.completed === 'true') {
                dragMode = 'locked';
                return;
            }

            if (e.target.classList.contains('gantt__bar-handle')) {
                dragMode = e.target.classList.contains('gantt__bar-handle--left') ? 'resize-left' : 'resize-right';
                document.body.style.cursor = 'col-resize';
            } else {
                dragMode = 'move';
                bar.style.cursor = 'grabbing';
                document.body.style.cursor = 'grabbing';
            }
            e.preventDefault();
        });
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isDraggingBar || !dragBarEl) return;
    if (dragMode === 'locked') return;
    const deltaX = e.clientX - dragStartX;
    if (Math.abs(deltaX) > 2) hasMoved = true;

    // [수정] 계획(plan) 막대와 실행(exec) 막대 모두 공통으로 충돌 및 위치 계산 수행
    let targetIndex = -1;
    if (dragMode === 'move') {
        const newLeft = dragBarInitialLeft + deltaX;
        targetIndex = Math.round(newLeft / ganttDayWidth);
    } else if (dragMode === 'resize-right') {
        const newWidth = Math.max(ganttDayWidth, dragBarInitialWidth + deltaX);
        const currentLeft = parseFloat(dragBarEl.style.left);
        targetIndex = Math.round((currentLeft + newWidth) / ganttDayWidth) - 1;
    } else if (dragMode === 'resize-left') {
        let newWidth = dragBarInitialWidth - deltaX;
        if (newWidth < ganttDayWidth) newWidth = ganttDayWidth;
        const newLeft = dragBarInitialLeft + (dragBarInitialWidth - newWidth);
        targetIndex = Math.round(newLeft / ganttDayWidth);
    }

    // [수정] 일수 모드일 때는 휴일 칸 위를 지나가도 걸리지 않고 부드럽게 넘어가도록 예외 처리
    if (!isDayCountMode && targetIndex >= 0 && targetIndex < ganttValidDates.length && ganttValidDates[targetIndex].holiday) {
        isHoveringHoliday = true;
        return;
    }
    isHoveringHoliday = false;

    if (dragMode === 'move') {
        dragBarEl.style.left = `${dragBarInitialLeft + deltaX}px`;
    } else if (dragMode === 'resize-right') {
        dragBarEl.style.width = `${Math.max(ganttDayWidth, dragBarInitialWidth + deltaX)}px`;
    } else if (dragMode === 'resize-left') {
        let newWidth = dragBarInitialWidth - deltaX;
        if (newWidth < ganttDayWidth) newWidth = ganttDayWidth;
        dragBarEl.style.width = `${newWidth}px`;
        dragBarEl.style.left = `${dragBarInitialLeft + (dragBarInitialWidth - newWidth)}px`;
    }
});

document.addEventListener('mouseup', (e) => {
    if (isDraggingBar && dragBarEl) {
        document.body.style.cursor = 'default';

        if (dragMode !== 'locked') dragBarEl.style.cursor = 'grab';

        if (!isDayCountMode && isHoveringHoliday) {
            dragBarEl.style.left = `${dragBarInitialLeft}px`;
            dragBarEl.style.width = `${dragBarInitialWidth}px`;
            isDraggingBar = false;
            dragBarEl = null;
            dragMode = null;
            return;
        } else if (!hasMoved && dragBarEl.dataset.type === 'exec') {
            // [수정] 제자리 클릭 시 작업 기록 팝업 띄우기 (완료 모달 제거에 따른 변경)
            if (typeof window.openSetupLogRegisterModal === 'function') {
                const taskName = dragBarEl.closest('.gantt__row').dataset.taskName;
                const safeTaskName = taskName ? taskName.replace(/'/g, "\\'").replace(/"/g, "&quot;") : '';
                window.openSetupLogRegisterModal(dragBarEl.dataset.site, dragBarEl.dataset.equip, safeTaskName, '');
            }
            if (dragMode === 'move') dragBarEl.style.left = `${dragBarInitialLeft}px`;
            else { dragBarEl.style.width = `${dragBarInitialWidth}px`; dragBarEl.style.left = `${dragBarInitialLeft}px`; }
        } else if (!hasMoved && dragBarEl.dataset.type === 'plan') {
            if (dragMode === 'move') dragBarEl.style.left = `${dragBarInitialLeft}px`;
            else { dragBarEl.style.width = `${dragBarInitialWidth}px`; dragBarEl.style.left = `${dragBarInitialLeft}px`; }
        } else {
            const currentLeft = parseFloat(dragBarEl.style.left);
            const currentWidth = parseFloat(dragBarEl.style.width);

            let startIdx = Math.round(currentLeft / ganttDayWidth);
            let endIdx = Math.round((currentLeft + currentWidth) / ganttDayWidth) - 1;

            if (startIdx < 0) startIdx = 0;
            if (endIdx >= ganttValidDates.length) endIdx = ganttValidDates.length - 1;
            if (startIdx > endIdx) {
                if (dragMode === 'resize-left') startIdx = endIdx;
                else endIdx = startIdx;
            }

            if (ganttValidDates[startIdx] && ganttValidDates[endIdx]) {
                const newStartDate = ganttValidDates[startIdx].str;
                const newEndDate = ganttValidDates[endIdx].str;

                const deltaStartDays = Math.round((currentLeft - dragBarInitialLeft) / ganttDayWidth);
                const newEstDays = Math.round(currentWidth / ganttDayWidth);

                updateTaskDate(
                    dragBarEl.dataset.site,
                    dragBarEl.dataset.equip,
                    dragBarEl.dataset.id,
                    dragBarEl.dataset.type,
                    {
                        newStart: newStartDate,
                        newEnd: newEndDate,
                        deltaStartDays: deltaStartDays,
                        newEstDays: newEstDays
                    },
                    'visual-update'
                );
            } else {
                renderGanttChart();
            }
        }
        isDraggingBar = false; dragBarEl = null; dragMode = null;
    }
});

/* ==========================================================================
   [10] 간트 차트 작업 순서 재정렬 (Drag & Drop)
   ========================================================================== */
function reorderGanttTasks(site, equip) {
    if (!site || !equip) return;

    const taskList = document.getElementById('gantt-task-list');
    if (!taskList) return;

    // 화면상에 변경된 DOM 엘리먼트의 순서를 가져옴
    const items = taskList.querySelectorAll('.gantt__task-item');
    const newOrderIds = Array.from(items).map(item => parseInt(item.dataset.id));

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    let data = setupData[equipKey] || {};

    if (data.setupDetails) {
        const detailsMap = new Map(data.setupDetails.map(d => [d.id, d]));
        const reorderedDetails = [];

        // 1. 드래그로 변경된 새로운 순서대로 객체 재배치
        newOrderIds.forEach(id => {
            if (detailsMap.has(id)) {
                reorderedDetails.push(detailsMap.get(id));
                detailsMap.delete(id);
            }
        });

        // 2. 화면에 없던 항목(혹시 모를 예외 상황 방어용)은 그대로 뒤에 붙임
        data.setupDetails.forEach(d => {
            if (detailsMap.has(d.id)) {
                reorderedDetails.push(d);
            }
        });

        data.setupDetails = reorderedDetails;
        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));

        if (typeof window.syncSetupDataDB === 'function') window.syncSetupDataDB(site, equip, data.setupDetails, data.setupLogs);
        if (typeof addSystemLog === 'function') addSystemLog('REORDER_SETUP', equip, '간트 뷰에서 작업 순서 변경');

        // UI 업데이트
        renderGanttChart();
        if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
        if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
            renderSetupDetailList();
        }
    }
}

/* ==========================================================================
   [9] 모달: 간트 차트 검색 (Gantt Search Modal)
   ========================================================================== */
function setupGanttSearchModal() {
    const modal = document.getElementById('gantt-search-modal');
    const closeBtn = document.getElementById('btn-close-gantt-search-modal');
    const resetBtn = document.getElementById('btn-reset-gantt-filter');
    const applyBtn = document.getElementById('btn-apply-gantt-filter');
    const siteSelect = document.getElementById('gantt-site-select');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateGanttSearchEquipSelect(siteSelect.value);
        };
    }

    const cbIng = document.getElementById('gantt-filter-status-ing');

    const handleStatusFilterChange = () => {
        if (siteSelect) siteSelect.value = '';
        const equipSelect = document.getElementById('gantt-equip-select');
        if (equipSelect) {
            equipSelect.innerHTML = '<option value="">전체 장비</option>';
            equipSelect.disabled = true;
        }

        const showIng = cbIng ? cbIng.checked : false;

        if (typeof currentGanttFilters !== 'undefined') {
            currentGanttFilters = { site: '', equip: '', showIng };
        }

        if (siteSelect) {
            const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            siteSelect.innerHTML = '<option value="">전체 사업장</option>';
            Object.keys(data).forEach(site => {
                let hasValidEquip = false;
                const equips = data[site] || [];
                for (let equip of equips) {
                    if (equip && equip.startsWith('기타(ETC)')) continue;
                    const equipData = setupData[`${site}::${equip}`];
                    let isCompleted = false;
                    if (equipData && equipData.setupDetails) {
                        const completeTask = equipData.setupDetails.find(t => t.content === '셋업 완료' || t.category === '셋업 완료');
                        isCompleted = completeTask && completeTask.completed;
                    }
                    const isIng = !isCompleted;
                    if (!showIng || (showIng && isIng)) {
                        hasValidEquip = true;
                        break;
                    }
                }
                if (hasValidEquip) {
                    const option = document.createElement('option');
                    option.value = site;
                    option.textContent = site;
                    siteSelect.appendChild(option);
                }
            });
        }

        renderGanttChart();
        if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
    };

    if (cbIng) cbIng.onchange = handleStatusFilterChange;

    if (resetBtn) {
        resetBtn.onclick = () => {
            if (typeof currentGanttFilters !== 'undefined') {
                currentGanttFilters = { site: '', equip: '', showIng: false };
            }

            const cbIng = document.getElementById('gantt-filter-status-ing');
            if (cbIng) cbIng.checked = false;

            modal.style.display = 'none';
            renderGanttChart();
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
        };
    }

    if (applyBtn) {
        applyBtn.onclick = () => {
            const site = document.getElementById('gantt-site-select').value;
            const equip = document.getElementById('gantt-equip-select').value;
            const showIng = document.getElementById('gantt-filter-status-ing') ? document.getElementById('gantt-filter-status-ing').checked : false;

            if (typeof currentGanttFilters !== 'undefined') {
                currentGanttFilters = { site, equip, showIng };
            }

            modal.style.display = 'none';
            renderGanttChart();
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
        };
    }
}

function openGanttSearchModal() {
    const modal = document.getElementById('gantt-search-modal');
    const siteSelect = document.getElementById('gantt-site-select');
    const equipSelect = document.getElementById('gantt-equip-select');

    if (!modal) return;

    const cbIng = document.getElementById('gantt-filter-status-ing');
    if (cbIng) {
        if (typeof currentGanttFilters !== 'undefined') {
            cbIng.checked = currentGanttFilters.showIng === true;
        }
    }

    const showIng = cbIng ? cbIng.checked : false;

    // Load Sites
    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    if (siteSelect) {
        siteSelect.innerHTML = '<option value="">전체 사업장</option>';
        Object.keys(data).forEach(site => {
            let hasValidEquip = false;
            const equips = data[site] || [];
            for (let equip of equips) {
                if (equip && equip.startsWith('기타(ETC)')) continue;
                const equipData = setupData[`${site}::${equip}`];
                let isCompleted = false;
                if (equipData && equipData.setupDetails) {
                    const completeTask = equipData.setupDetails.find(t => t.content === '셋업 완료' || t.category === '셋업 완료');
                    isCompleted = completeTask && completeTask.completed;
                }
                const isIng = !isCompleted;
                if (!showIng || (showIng && isIng)) {
                    hasValidEquip = true;
                    break;
                }
            }

            if (hasValidEquip) {
                const option = document.createElement('option');
                option.value = site;
                option.textContent = site;
                if (typeof currentGanttFilters !== 'undefined' && currentGanttFilters.site === site) {
                    option.selected = true;
                }
                siteSelect.appendChild(option);
            }
        });
    }

    if (equipSelect) {
        const currentSite = siteSelect ? siteSelect.value : '';
        updateGanttSearchEquipSelect(currentSite);
        if (typeof currentGanttFilters !== 'undefined' && currentGanttFilters.equip) {
            equipSelect.value = currentGanttFilters.equip;
        }
    }

    modal.style.display = 'flex';
}

function updateGanttSearchEquipSelect(site) {
    const equipSelect = document.getElementById('gantt-equip-select');
    if (!equipSelect) return;

    equipSelect.innerHTML = '<option value="">전체 장비</option>';

    if (!site) {
        equipSelect.disabled = true;
        return;
    }

    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
    const equips = data[site] ? [...data[site]] : [];
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const cbIng = document.getElementById('gantt-filter-status-ing');
    const showIng = cbIng ? cbIng.checked : false;

    equips.forEach(equip => {
        if (equip && equip.startsWith('기타(ETC)')) return;

        // 셋업 진행 중 여부 확인
        const equipData = setupData[`${site}::${equip}`];
        let isCompleted = false;
        if (equipData && equipData.setupDetails) {
            const completeTask = equipData.setupDetails.find(t => t.content === '셋업 완료' || t.category === '셋업 완료');
            isCompleted = completeTask && completeTask.completed;
        }
        const isIng = !isCompleted;

        if (!showIng || (showIng && isIng)) {
            const option = document.createElement('option');
            option.value = equip;
            const parts = equip.split('::');
            const rawName = parts[0];
            const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
            option.textContent = parts.length > 1 ? `${displayName} (${parts[1]})` : displayName;
            equipSelect.appendChild(option);
        }
    });

    equipSelect.disabled = false;
}
