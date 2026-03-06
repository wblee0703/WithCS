/* ==========================================================================
   간트 차트 및 실행 관리 (Gantt Chart & Execution Management)
   ========================================================================== */

// [1] 전역 변수 (Global Variables)
let ganttSidebarWidth = 300;
let ganttDayWidth = 20;
const GANTT_SIDEBAR_MIN_WIDTH = 250;
const GANTT_SIDEBAR_MAX_WIDTH = 600;
const GANTT_PADDING_START = 1;
const GANTT_PADDING_END = 1;
let ganttExtraWeeks = 0;
let ganttValidDates = [];
let isHoveringHoliday = false;

// 드래그 앤 드롭 관련 변수
let isDraggingBar = false;
let dragMode = null;
let dragStartX = 0;
let dragBarEl = null;
let dragBarInitialLeft = 0;
let dragBarInitialWidth = 0;
let hasMoved = false;

// 실행 시작일 설정 대상 변수
let currentExecStartTarget = null;
let currentExecStartTargetId = null;

/* ==========================================================================
   [2] 초기화 및 설정 (Setup & Initialization)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // 간트 차트 관련 초기화
    setupGanttSearch();
    setupGanttZoom();
    setupGanttResizer();
    setupEquipInfoResizer();
    setupSetupExecStartModal();

    // 날짜 변경 시 지연 사유 체크 이벤트 연결
    const execEndDate = document.getElementById('exec-end-date');
    if (execEndDate) {
        execEndDate.addEventListener('change', checkExecDelayStatus);
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
        if (currentGanttFilters.site && currentGanttFilters.equip) {
            const parts = currentGanttFilters.equip.split('::');
            const name = parts[0];
            const serial = parts.length > 1 ? parts[1] : '';
            infoText = `${currentGanttFilters.site} > ${name} ${serial ? `(${serial})` : ''}`;

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
                    data.setupDetails.forEach(task => {
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

                            if (task.date || task.execStartDate) {
                                execStart = task.execStartDate || task.startDate;
                                execEnd = task.date || execStart;

                                if (execEnd < execStart) execEnd = execStart;

                                const planEndDate = new Date(pEnd);
                                const actualEndDate = new Date(execEnd);
                                planEndDate.setHours(0, 0, 0, 0);
                                actualEndDate.setHours(0, 0, 0, 0);

                                if (actualEndDate > planEndDate) {
                                    statusClass = 'exec-delayed';
                                } else if (!task.completed) {
                                    statusClass = 'exec-progress';
                                } else {
                                    statusClass = 'exec';
                                }
                            }

                            allTasks.push({
                                id: task.id,
                                site: site,
                                equip: equip,
                                displayName: displayName,
                                planStart: task.startDate,
                                planEnd: pEnd.toISOString().split('T')[0],
                                execStart: execStart,
                                execEnd: execEnd,
                                estDays: estDays,
                                statusClass: statusClass,
                                completed: task.completed
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

    if (wrapper) wrapper.style.display = 'flex';
    if (emptyMsg) emptyMsg.style.display = 'none';
    if (sidebar) sidebar.style.width = `${ganttSidebarWidth}px`;

    allTasks.sort((a, b) => new Date(a.planStart || a.start) - new Date(b.planStart || b.start));

    let minDate = null;
    let maxDate = null;

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
    });

    if (minDate === null) minDate = new Date();
    if (maxDate === null) maxDate = new Date();

    minDate.setDate(minDate.getDate() - GANTT_PADDING_START);
    maxDate.setDate(maxDate.getDate() + GANTT_PADDING_END + (ganttExtraWeeks * 7));

    ganttValidDates = [];
    const dateMap = new Map();
    let tempDate = new Date(minDate);
    let colIndex = 0;

    while (tempDate <= maxDate) {
        const day = tempDate.getDay();
        if (day !== 0 && day !== 6) {
            const dStr = tempDate.toISOString().split('T')[0];
            ganttValidDates.push({
                date: new Date(tempDate),
                str: dStr,
                holiday: getHolidayName(tempDate.getFullYear(), tempDate.getMonth(), tempDate.getDate())
            });
            dateMap.set(dStr, colIndex++);
        }
        tempDate.setDate(tempDate.getDate() + 1);
    }

    const container = document.getElementById('gantt-timeline-container');
    if (container && container.clientWidth > 0 && ganttValidDates.length > 0) {
        ganttDayWidth = container.clientWidth / ganttValidDates.length;
    } else {
        ganttDayWidth = 20;
    }
    const totalWidth = ganttValidDates.length * ganttDayWidth;

    if (taskList) {
        const shownButtonEquips = new Set();
        const template = document.getElementById('gantt-task-template');
        taskList.innerHTML = '';

        allTasks.forEach((t, index) => {
            let isBtnDisabled = false;
            for (let k = index - 1; k >= 0; k--) {
                if (allTasks[k].site === t.site && allTasks[k].equip === t.equip) {
                    if (!allTasks[k].completed) isBtnDisabled = true;
                    break;
                }
            }

            const clone = template.content.cloneNode(true);
            const taskDiv = clone.querySelector('.gantt__task-item');
            taskDiv.dataset.id = t.id;
            taskDiv.dataset.site = t.site;
            taskDiv.dataset.equip = t.equip;
            taskDiv.ondblclick = () => openDateEditModal(t.site, t.equip, t.id, 'plan');

            const label = clone.querySelector('.gantt__task-label');
            label.title = `${t.site} > ${t.equip}`;
            label.textContent = t.displayName;

            const btnAdd = clone.querySelector('.gantt__btn-add');
            if (!t.execEnd) {
                const equipKey = `${t.site}::${t.equip}`;
                if (!shownButtonEquips.has(equipKey)) {
                    if (isBtnDisabled) {
                        btnAdd.disabled = true;
                        btnAdd.title = '이전 작업 미완료';
                    } else {
                        btnAdd.onclick = () => addExecutionBar(t.site, t.equip, t.id);
                    }
                    shownButtonEquips.add(equipKey);
                }
                else {
                    btnAdd.remove();
                }
            } else {
                btnAdd.remove();
            }

            const progressSpan = clone.querySelector('.gantt__task-progress');
            if (t.execStart && t.execEnd) {
                let pct = 0;
                if (t.completed) {
                    pct = 100;
                } else {
                    const estDays = parseInt(t.estDays) || 1;
                    if (estDays === 1) {
                        pct = 0;
                    } else {
                        let execDuration = 0;
                        let temp = new Date(t.execStart);
                        const end = new Date(t.execEnd);
                        temp.setHours(0, 0, 0, 0);
                        end.setHours(0, 0, 0, 0);

                        if (temp <= end) {
                            while (temp <= end) {
                                const d = temp.getDay();
                                const isHol = getHolidayName(temp.getFullYear(), temp.getMonth(), temp.getDate());
                                if (d !== 0 && d !== 6 && !isHol) {
                                    execDuration++;
                                }
                                temp.setDate(temp.getDate() + 1);
                            }
                        }
                        pct = Math.round((execDuration / estDays) * 100);
                        if (pct > 99) pct = 99;
                    }
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

    if (timeline) timeline.style.width = `${totalWidth}px`;

    let monthHtml = '';
    let currentYm = '';
    let span = 0;

    ganttValidDates.forEach((dObj, i) => {
        const d = dObj.date;
        const ym = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (ym !== currentYm) {
            if (currentYm !== '') monthHtml += `<div class="gantt__date-cell gantt__date-cell--month" style="width: ${span * ganttDayWidth}px;">${currentYm}</div>`;
            currentYm = ym; span = 1;
        } else span++;
    });
    if (span > 0) monthHtml += `<div class="gantt__date-cell gantt__date-cell--month" style="width: ${span * ganttDayWidth}px;">${currentYm}</div>`;
    if (headerMonths) headerMonths.innerHTML = monthHtml;

    let dayHtml = '';
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    ganttValidDates.forEach((dObj, i) => {
        let cellClass = 'gantt__date-cell gantt__date-cell--day';
        let content = dObj.date.getDate();

        if (dObj.holiday) {
            cellClass += ' gantt__date-cell--holiday';
        }
        if (dObj.str === todayStr) {
            cellClass += ' gantt__date-cell--today';
        }

        dayHtml += `<div class="${cellClass}" style="width: ${ganttDayWidth}px;" title="${dObj.str} ${dObj.holiday || ''}">${content}</div>`;
    });
    if (headerWeeks) headerWeeks.innerHTML = dayHtml;

    let bgHtml = '';
    let linesHtml = '';
    let boldLinesHtml = '';

    ganttValidDates.forEach((dObj, i) => {
        const left = i * ganttDayWidth;

        if (dObj.holiday) {
            bgHtml += `<div class="gantt__grid-bg gantt__grid-bg--holiday" style="left: ${left}px; width: ${ganttDayWidth}px;" title="${dObj.holiday}"></div>`;
        }
        
        if (dObj.str === todayStr) {
            bgHtml += `<div class="gantt__grid-bg gantt__grid-bg--today" style="left: ${left}px; width: ${ganttDayWidth}px;"></div>`;
        }

        linesHtml += `<div class="gantt__grid-line" style="left: ${left}px;"></div>`;

        if (dObj.date.getDay() === 5) {
            const right = (i + 1) * ganttDayWidth;
            boldLinesHtml += `<div class="gantt__grid-line gantt__grid-line--bold" style="left: ${right - 1}px;"></div>`;
        }
    });

    const gridLinesHtml = bgHtml + linesHtml + boldLinesHtml;

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

    allTasks.forEach(t => {
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

        bodyHtml += `
            <div class="gantt__row">
                <div class="gantt__bar gantt__bar--plan" style="left: ${pLeft}px; width: ${pWidth}px;" title="계획: ${t.planStart} ~ ${t.planEnd}" data-id="${t.id}" data-type="plan" data-site="${t.site}" data-equip="${t.equip}">${pSegments}</div>
                ${t.execStart ? `<div class="gantt__bar ${statusModifier}" style="left: ${eLeft}px; width: ${eWidth}px;" title="실행: ${t.execStart} ~ ${t.execEnd}" data-id="${t.id}" data-type="exec" data-site="${t.site}" data-equip="${t.equip}" data-completed="${t.completed}">${eSegments}${resizeHandles}</div>` : ''}
            </div>`;
    });

    if (ganttBody) ganttBody.innerHTML = gridLinesHtml + bodyHtml;

    setupGanttBarDrag();
}

/* ==========================================================================
   [5] 드래그 앤 드롭 (Drag & Drop Interaction)
   ========================================================================== */

function setupGanttBarDrag() {
    const bars = document.querySelectorAll('.gantt__bar');
    bars.forEach(bar => {
        bar.addEventListener('mousedown', (e) => {
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
            openExecCompletionModal(dragBarEl.dataset.site, dragBarEl.dataset.equip, dragBarEl.dataset.id);
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
   [6] 모달: 날짜 편집 (Date Edit Modal)
   ========================================================================== */

function openDateEditModal(site, equip, id, type) {
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const data = setupData[`${site}::${equip}`] || {};
    const task = data.setupDetails ? data.setupDetails.find(t => t.id == id) : null;
    if (!task) return;

    document.getElementById('edit-task-id').value = id;
    document.getElementById('edit-task-type').value = 'plan';
    document.getElementById('edit-task-site').value = site;
    document.getElementById('edit-task-equip').value = equip;

    document.getElementById('edit-start-date').value = task.startDate;
    let s = new Date(task.startDate);
    const est = parseInt(task.estDays) || 0;
    const daysToAdd = est > 0 ? est - 1 : 0;
    s = addBusinessDays(s, daysToAdd);
    document.getElementById('edit-end-date').value = s.toISOString().split('T')[0];

    document.getElementById('setup-date-edit-modal').style.display = 'flex';
}

function saveDateEdit() {
    const id = document.getElementById('edit-task-id').value;
    const type = document.getElementById('edit-task-type').value;
    const site = document.getElementById('edit-task-site').value;
    const equip = document.getElementById('edit-task-equip').value;
    const start = document.getElementById('edit-start-date').value;
    const end = document.getElementById('edit-end-date').value;

    if (!start || !end) return alert('날짜를 입력해주세요.');
    if (start > end) return alert('종료일은 시작일보다 빠를 수 없습니다.');

    updateTaskDate(site, equip, id, type, { start: start, end: end }, 'manual');
    document.getElementById('setup-date-edit-modal').style.display = 'none';
}

/* ==========================================================================
   [7] 모달: 실행 시작 (Execution Start Modal)
   ========================================================================== */

function setupSetupExecStartModal() {
    const modal = document.getElementById('setup-exec-start-modal');
    const closeBtn = document.getElementById('btn-close-setup-exec-start');
    const saveBtn = document.getElementById('btn-save-setup-exec-start');
    if (!modal) return;
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    if (saveBtn) saveBtn.onclick = saveSetupExecStart;
}

function openSetupExecStartModal(site, equip, id) {
    const modal = document.getElementById('setup-exec-start-modal');
    if (!modal) return;
    currentExecStartTargetId = id;
    const dateInput = document.getElementById('setup-exec-start-date');
    let defaultDate = new Date().toISOString().split('T')[0];

    if (site && equip) {
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const key = `${site}::${equip}`;
        const data = setupData[key] || {};
        const details = data.setupDetails || [];
        const idx = details.findIndex(t => t.id == id);

        if (idx > 0) {
            const prev = details[idx - 1];
            if (prev.date) {
                defaultDate = window.addBusinessDays(new Date(prev.date), 1).toISOString().split('T')[0];
            }
        } else if (idx === 0 && details[0].startDate) {
            defaultDate = details[0].startDate;
        }
    }

    dateInput.value = defaultDate;
    modal.style.display = 'flex';
}

function saveSetupExecStart() {
    if (!currentExecStartTargetId) return;
    const dateInput = document.getElementById('setup-exec-start-date');
    const execDate = dateInput.value;
    if (!execDate) return alert("시작일을 선택해주세요.");
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    let found = false;
    Object.keys(setupData).forEach(key => {
        if (found) return;
        const data = setupData[key];
        if (data.setupDetails) {
            const task = data.setupDetails.find(t => t.id == currentExecStartTargetId);
            if (task) { task.execStartDate = execDate; found = true; }
        }
    });
    if (found) { 
        localStorage.setItem('setup_data', JSON.stringify(setupData)); 
        if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
    }
    document.getElementById('setup-exec-start-modal').style.display = 'none';
    currentExecStartTargetId = null;
}

function addExecutionBar(site, equip, id) {
    openSetupExecStartModal(site, equip, id);
}

/* ==========================================================================
   [8] 모달: 실행 완료 (Execution Completion Modal)
   ========================================================================== */

function openExecCompletionModal(site, equip, id) {
    const modal = document.getElementById('exec-completion-modal');
    if (!modal) return;

    document.getElementById('exec-complete-site').value = site;
    document.getElementById('exec-complete-equip').value = equip;
    document.getElementById('exec-complete-id').value = id;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const data = setupData[`${site}::${equip}`] || {};
    const task = data.setupDetails ? data.setupDetails.find(t => t.id == id) : null;

    if (task) {
        const estDays = parseInt(task.estDays) || 1;
        document.getElementById('exec-est-days').value = estDays + '일';
        
        const startDate = task.execStartDate || task.startDate || '';
        document.getElementById('exec-start-date').value = startDate;
        
        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        let endDate = task.date;
        if (!endDate && startDate) {
            const [y, m, d] = startDate.split('-').map(Number);
            const daysToAdd = estDays > 0 ? estDays - 1 : 0;
            endDate = formatDate(window.addBusinessDays(new Date(y, m - 1, d), daysToAdd));
        } else if (!endDate) {
            endDate = new Date().toISOString().split('T')[0];
        }
        document.getElementById('exec-end-date').value = endDate;

        const planStart = task.startDate;
        let planEndDateStr = '';
        if (planStart) {
            const pEstDays = parseInt(task.estDays) || 1;
            const daysToAdd = pEstDays > 0 ? pEstDays - 1 : 0;
            const [y, m, d] = planStart.split('-').map(Number);
            const pEnd = window.addBusinessDays(new Date(y, m - 1, d), daysToAdd);
            
            const py = pEnd.getFullYear();
            const pm = String(pEnd.getMonth() + 1).padStart(2, '0');
            const pd = String(pEnd.getDate()).padStart(2, '0');
            planEndDateStr = `${py}-${pm}-${pd}`;
        }
        
        let planEndInput = document.getElementById('exec-plan-end-date');
        if (!planEndInput) {
            planEndInput = document.createElement('input');
            planEndInput.type = 'hidden';
            planEndInput.id = 'exec-plan-end-date';
            modal.querySelector('.modal-body').appendChild(planEndInput);
        }
        planEndInput.value = planEndDateStr;

        const checkbox = document.getElementById('exec-complete-checkbox');
        checkbox.checked = task.completed;
        
        const reasonInput = document.getElementById('exec-delay-reason');
        reasonInput.value = task.delayReason || '';
        
        checkExecDelayStatus();

        const logInput = document.getElementById('exec-setup-log-content');
        if (logInput) logInput.value = '';
        
        const companyInput = document.getElementById('exec-setup-log-company');
        if (companyInput) companyInput.value = '위드텍';

        const workerInput = document.getElementById('exec-setup-log-worker');
        if (workerInput) workerInput.value = sessionStorage.getItem('userId') || '';

        const startDateInput = document.getElementById('exec-start-date');
        startDateInput.onchange = () => {
            const sDate = startDateInput.value;
            if (sDate) {
                const [y, m, d] = sDate.split('-').map(Number);
                const daysToAdd = estDays > 0 ? estDays - 1 : 0;
                const newEnd = formatDate(window.addBusinessDays(new Date(y, m - 1, d), daysToAdd));
                document.getElementById('exec-end-date').value = newEnd;
                checkExecDelayStatus();
            }
        };

        const isTaskCompleted = task.completed;
        const logContainer = document.getElementById('exec-setup-log-container');
        if (logContainer) logContainer.style.display = isTaskCompleted ? 'none' : 'block';

        const inputsToDisable = [
            'exec-start-date', 'exec-end-date', 'exec-delay-reason',
            'exec-setup-log-company', 'exec-setup-log-worker', 'exec-setup-log-content'
        ];
        inputsToDisable.forEach(inputId => {
            const el = document.getElementById(inputId);
            if (el) el.disabled = isTaskCompleted;
        });
    }

    modal.style.display = 'flex';
}

function checkExecDelayStatus() {
    const planEndDateInput = document.getElementById('exec-plan-end-date');
    const completeDateInput = document.getElementById('exec-end-date');
    const reasonContainer = document.getElementById('exec-delay-reason-container');

    if (planEndDateInput && planEndDateInput.value && completeDateInput.value) {
        const planEndDate = new Date(planEndDateInput.value);
        const completeDate = new Date(completeDateInput.value);

        planEndDate.setHours(0,0,0,0);
        completeDate.setHours(0,0,0,0);

        if (completeDate > planEndDate) {
            reasonContainer.style.display = 'block';
            return;
        }
    }
    reasonContainer.style.display = 'none';
}

function saveExecCompletion() {
    const site = document.getElementById('exec-complete-site').value;
    const equip = document.getElementById('exec-complete-equip').value;
    const id = document.getElementById('exec-complete-id').value;
    const startDate = document.getElementById('exec-start-date').value;
    const endDate = document.getElementById('exec-end-date').value;
    const isCompleted = document.getElementById('exec-complete-checkbox').checked;
    const delayReason = document.getElementById('exec-delay-reason').value;
    const reasonContainer = document.getElementById('exec-delay-reason-container');
    const logContentEl = document.getElementById('exec-setup-log-content');
    const logContent = logContentEl ? logContentEl.value.trim() : '';
    const logCompany = document.getElementById('exec-setup-log-company') ? document.getElementById('exec-setup-log-company').value.trim() : '위드텍';
    const logWorker = document.getElementById('exec-setup-log-worker') ? document.getElementById('exec-setup-log-worker').value.trim() : '';

    if (!startDate) return alert('시작일을 입력해주세요.');
    if (isCompleted && !endDate) return alert('완료일을 입력해주세요.');
    if (isCompleted && reasonContainer.style.display !== 'none' && !delayReason.trim()) {
        return alert('지연 사유를 입력해주세요.');
    }

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    let data = setupData[equipKey] || {};
    
    if (data.setupDetails) {
        const task = data.setupDetails.find(t => t.id == id);
        if (task) {
            const wasCompleted = task.completed;
            if (task.completed && !isCompleted) {
                if (!confirm("완료 상태를 해제하시겠습니까?\n이후 단계의 완료 상태도 함께 초기화됩니다.")) {
                    return;
                }
                
                task.execStartDate = '';
                task.date = '';
                task.completed = false;
                task.delayReason = '';

                const currentIndex = data.setupDetails.findIndex(t => t.id == id);
                if (currentIndex !== -1) {
                    for (let i = currentIndex + 1; i < data.setupDetails.length; i++) {
                        const nextTask = data.setupDetails[i];
                        nextTask.execStartDate = '';
                        nextTask.date = '';
                        nextTask.completed = false;
                        nextTask.delayReason = '';
                    }
                }
            } else {
                task.execStartDate = startDate;
                task.date = isCompleted ? endDate : '';
                task.completed = isCompleted;
                task.delayReason = isCompleted ? delayReason : '';
            }

            if ((isCompleted && !wasCompleted) || (logContent && !wasCompleted)) {
                if (!data.setupLogs) data.setupLogs = [];

                let displayContent = task.content || '작업 내용 없음';
                let finalMemo = logContent;

                if (delayReason) {
                    displayContent = `[지연] ${displayContent}`;
                    if (finalMemo) finalMemo += `\n\n[지연 사유]\n${delayReason}`;
                    else finalMemo = `[지연 사유]\n${delayReason}`;
                }

                data.setupLogs.push({
                    id: Date.now(),
                    date: isCompleted ? endDate : new Date().toISOString().split('T')[0],
                    worker: logWorker || sessionStorage.getItem('userId') || '',
                    content: displayContent,
                    company: logCompany || '위드텍',
                    memo: finalMemo
                });
            }
            
            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));
            
            renderGanttChart();
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
        }
    }

    document.getElementById('exec-completion-modal').style.display = 'none';
}

// 전역 함수 노출
window.saveExecCompletion = saveExecCompletion;
window.openExecCompletionModal = openExecCompletionModal;
window.saveSetupExecStart = saveSetupExecStart;
window.setupEquipInfoResizer = setupEquipInfoResizer;
