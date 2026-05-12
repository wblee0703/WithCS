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
let isDayCountMode = false; // [추가] 일수 모드 플래그

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
    // [추가] 일수 모드 토글 이벤트
    const subtitleEl = document.querySelector('.gantt__subtitle');
    if (subtitleEl) {
        subtitleEl.addEventListener('click', () => {
            isDayCountMode = !isDayCountMode;
            if (isDayCountMode) {
                subtitleEl.innerHTML = '셋업 일정 <span style="font-size:12px; color:#58a6ff; margin-left:5px;">(일수 모드)</span>';
            } else {
                subtitleEl.innerHTML = '셋업 일정';
            }
            renderGanttChart();
        });
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
                if (change.newStart) task.execStartDate = change.newStart;
                if (change.newEnd) task.date = change.newEnd;
            } else if (type === 'plan') {
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

        setupData[equipKey] = data;
        localStorage.setItem('setup_data', JSON.stringify(setupData));
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

    const hasActiveFilter = currentGanttFilters.site || currentGanttFilters.equip;
    if (!hasActiveFilter) {
        if (wrapper) wrapper.style.display = 'none';
        if (emptyMsg) {
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = '장비를 검색하면 셋업 일정이 표시됩니다.';
        }
        return;
    }

    let allTasks = [];
    const mainData = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            mainData[site].forEach(equip => {
                const data = setupData[`${site}::${equip}`];

                if (data && data.setupDetails) {
                    data.setupDetails.forEach((task, idx) => {
                        if (!task.startDate) return;

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
                            const pStart = new Date(task.startDate);
                            const daysToAdd = estDays > 0 ? estDays - 1 : 0;
                            const pEnd = addBusinessDays(pStart, daysToAdd);

                            let execStart = null;
                            let execEnd = null;
                            let statusClass = '';

                            // [개선] 등록된 로그 수 기반으로 상태 판단
                            const taskLogs = (data.setupLogs || []).filter(l => l.content === displayName);
                            const workedDays = new Set(taskLogs.map(l => l.date)).size;
                            
                            if (taskLogs.length > 0) {
                                taskLogs.sort((a,b) => new Date(a.date) - new Date(b.date));
                                execStart = taskLogs[0].date;
                                execEnd = task.date || taskLogs[taskLogs.length - 1].date;
                                
                                if (workedDays > estDays) {
                                    statusClass = 'exec-delayed';
                                } else if (task.completed || workedDays >= estDays) {
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

            // 1. 순방향 계산 (현재 진행 작업부터 끝까지)
            let currentStart = new Date(today);
            for (let i = activeIndex; i < tasks.length; i++) {
                const t = tasks[i];
                t.originalPlanStart = t.planStart; // [추가] 실제 달력의 계획 시작일 보존
                let estDays = parseInt(t.estDays) || 1;
                if (t.category === '셋업 완료' || t.displayName === '셋업 완료') estDays = 1;

                const end = addContinuousDays(currentStart, estDays - 1);
                
                t.planStart = formatDate(currentStart);
                t.planEnd = formatDate(end);
                
                if (t.execStart) {
                    t.execStart = t.planStart;
                    if (t.completed) {
                        t.execEnd = t.planEnd;
                    } else {
                        // 미완료 진행 중인 경우, 오늘까지만 실행된 것으로 시각적 표현
                        t.execEnd = formatDate(today);
                    }
                }
                
                currentStart = addContinuousDays(end, 1);
            }

            // 2. 역방향 계산 (현재 진행 작업 이전부터 처음까지)
            let currentEnd = addContinuousDays(today, -1);
            for (let i = activeIndex - 1; i >= 0; i--) {
                const t = tasks[i];
                t.originalPlanStart = t.planStart; // [추가] 실제 달력의 계획 시작일 보존
                let estDays = parseInt(t.estDays) || 1;
                if (t.category === '셋업 완료' || t.displayName === '셋업 완료') estDays = 1;

                const start = addContinuousDays(currentEnd, -(estDays - 1));
                
                t.planStart = formatDate(start);
                t.planEnd = formatDate(currentEnd);
                
                if (t.execStart) {
                    t.execStart = t.planStart;
                    t.execEnd = t.planEnd;
                }
                
                currentEnd = addContinuousDays(start, -1);
            }

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
        const day = tempDate.getDay();
        // [수정] 일수 모드일 때는 주말 여부와 상관없이 모든 날짜를 포함시켜 겹침 방지 공간 확보
        if (isDayCountMode || (day !== 0 && day !== 6)) {
            const dStr = tempDate.toISOString().split('T')[0];
            const hol = getHolidayName(tempDate.getFullYear(), tempDate.getMonth(), tempDate.getDate());
            const d = new Date(tempDate);
            d.setHours(0, 0, 0, 0);

            if (isDayCountMode) {
                // 일수 모드일 때는 달력 개념이 사라지므로 공휴일도 무시하고 모두 칸으로 포함
                ganttValidDates.push({
                    date: new Date(tempDate),
                    str: dStr,
                    holiday: null
                });
                dateMap.set(dStr, colIndex++);
            } else {
                // 기본 달력 모드일 때는 휴일 속성 유지
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

        allTasks.forEach((t, index) => {
            const clone = template.content.cloneNode(true);
            const taskDiv = clone.querySelector('.gantt__task-item');

            taskDiv.dataset.id = t.id;
            taskDiv.dataset.site = t.site;
            taskDiv.dataset.equip = t.equip;
            taskDiv.ondblclick = () => {
                if (!isDayCountMode) openDateEditModal(t.site, t.equip, t.id, 'plan');
            };

            const label = clone.querySelector('.gantt__task-label');
            label.title = `${t.site} > ${t.equip}`;
            label.textContent = t.displayName;

            const btnAdd = clone.querySelector('.gantt__btn-add');
            // [수정] 날짜/일수 모드 관계없이 실행 버튼(▶) 항상 제거
            btnAdd.remove();

            const progressSpan = clone.querySelector('.gantt__task-progress');
            if (t.execStart && t.execEnd) {
                let pct = 0;
                const estDaysCount = parseInt(t.estDays) || 1;
                const wDays = new Set(t.logDates || []).size;
                if (wDays > 0) {
                    pct = Math.round((wDays / estDaysCount) * 100);
                    if (pct > 100) pct = 100;
                } else if (t.completed) {
                    pct = 100;
                }

                progressSpan.textContent = `${pct}%`;

                progressSpan.className = 'gantt__task-progress'; // 클래스 초기화
                if (pct === 0) progressSpan.classList.add('gantt__task-progress--empty');
                else if (pct === 100) progressSpan.classList.add('gantt__task-progress--complete');
                else progressSpan.classList.add('gantt__task-progress--ongoing');
            } else {
                progressSpan.remove();
            }

            const btnDel = clone.querySelector('.btn-del-sm');
            if (t.completed) {
                btnDel.disabled = true;
                btnDel.title = '완료된 작업은 삭제할 수 없습니다.';
            } else {
                btnDel.onclick = () => deleteSetupTask(t.site, t.equip, t.id);
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

    let relativeDayCount = 1;

    ganttValidDates.forEach((dObj, i) => {
        let cellClass = 'gantt__date-cell gantt__date-cell--day';
        let content = dObj.date.getDate();
        let tooltip = `${dObj.str} ${dObj.holiday || ''}`;

        const d = new Date(dObj.date);
        d.setHours(0, 0, 0, 0);

        // [수정] 일수 모드일 경우에만 상대 일수 표시 (기본 모드는 달력 날짜 표시)
        if (isDayCountMode) {
            if (projectStartDate && d >= projectStartDate) {
                content = relativeDayCount++;
                tooltip = `Day ${content}`; // [수정] 일수 모드에서 날짜 표시 툴팁 제거
            } else {
                content = '-';
                tooltip = ''; // [수정] 빈 공간 툴팁 제거
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

                const virtStart = t.planStart;
                let currentVirtDate = new Date(virtStart);

                const uniqueDates = [...new Set(t.logDates)].sort();
                uniqueDates.forEach(dateStr => {
                    // [수정] 실제 날짜 간격과 무관하게 가상 캘린더 시작일부터 순차적으로 칸을 채움 (연속 기록)
                    const virtDateStr = `${currentVirtDate.getFullYear()}-${String(currentVirtDate.getMonth() + 1).padStart(2, '0')}-${String(currentVirtDate.getDate()).padStart(2, '0')}`;

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
                    
                    // 다음 기록은 무조건 다음 칸에 배치되도록 가상 날짜 1일 증가
                    currentVirtDate.setDate(currentVirtDate.getDate() + 1);
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
                <div class="gantt__bar gantt__bar--plan" style="left: ${pLeft}px; width: ${pWidth}px;" title="${planTitle}" data-id="${t.id}" data-type="plan" data-site="${t.site}" data-equip="${t.equip}">${pSegments}</div>
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
                    const task = allTasks.find(t => t.id == taskId);
                    if (task && task.logDates && task.logDates.length > 0) {
                        // 이미 기록이 있는 경우 마지막 기록의 다음 날짜 제안
                        const lastDateStr = [...task.logDates].sort().pop();
                        const d = new Date(lastDateStr);
                        d.setDate(d.getDate() + 1); // 다음 일차이므로 1일 더함
                        clickedDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    } else {
                        clickedDateStr = ''; // 빈 값을 넘겨 모달에서 오늘 날짜로 셋팅되도록 함
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

            if (taskLogs.length > 0) {
                taskLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
                // 클릭한 날짜에 해당하는 로그가 있으면 그걸 열고, 없으면 가장 마지막 로그를 엽니다.
                let targetLog = taskLogs.find(l => l.date === clickedDateStr);
                if (!targetLog) targetLog = taskLogs[taskLogs.length - 1];
                
                if (typeof window.openLogForEditing === 'function') {
                    window.openLogForEditing(site, equip, targetLog.id);
                }
            } else {
                if (typeof window.openSetupLogRegisterModal === 'function') {
                    window.openSetupLogRegisterModal(site, equip, taskName, clickedDateStr);
                }
            }
        });
    });

    setupGanttBarDrag();

}

function setupGanttBarDrag() {
    const bars = document.querySelectorAll('.gantt__bar');
    bars.forEach(bar => {
        bar.addEventListener('mousedown', (e) => {
            if (isDayCountMode) return; // [추가] 일수 모드에서는 편집 비활성화
            if (bar.dataset.type === 'plan') return;

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

    if (dragBarEl.dataset.type === 'exec') {
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

        if (targetIndex >= 0 && targetIndex < ganttValidDates.length && ganttValidDates[targetIndex].holiday) {
            isHoveringHoliday = true;
            return;
        }
        isHoveringHoliday = false;
    }

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

        if (dragBarEl.dataset.type === 'exec' && isHoveringHoliday) {
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

                updateTaskDate(
                    dragBarEl.dataset.site,
                    dragBarEl.dataset.equip,
                    dragBarEl.dataset.id,
                    dragBarEl.dataset.type,
                    { newStart: newStartDate, newEnd: newEndDate },
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

    if (resetBtn) {
        resetBtn.onclick = () => {
            if (typeof currentGanttFilters !== 'undefined') {
                currentGanttFilters = { site: '', equip: '' };
            }
            modal.style.display = 'none';
            renderGanttChart();
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
        };
    }

    if (applyBtn) {
        applyBtn.onclick = () => {
            const site = document.getElementById('gantt-site-select').value;
            const equip = document.getElementById('gantt-equip-select').value;

            if (typeof currentGanttFilters !== 'undefined') {
                currentGanttFilters = { site, equip };
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

    // Load Sites
    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

    if (siteSelect) {
        siteSelect.innerHTML = '<option value="">전체 사업장</option>';
        Object.keys(data).forEach(site => {
            const option = document.createElement('option');
            option.value = site;
            option.textContent = site;
            if (typeof currentGanttFilters !== 'undefined' && currentGanttFilters.site === site) {
                option.selected = true;
            }
            siteSelect.appendChild(option);
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

    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        const rawName = parts[0];
        const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
        const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
        option.textContent = parts.length > 1 ? `${displayName} (${parts[1]})` : displayName;
        equipSelect.appendChild(option);
    });

    equipSelect.disabled = false;
}
