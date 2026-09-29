/* ==========================================================================
   간트 차트 및 셋업 일정 관리 (Gantt Chart - Clean Day Mode)
   ========================================================================== */

// [1] 전역 변수
let ganttSidebarWidth = 550;
let ganttDayWidth = 32;
const GANTT_SIDEBAR_MIN_WIDTH = 350;
const GANTT_SIDEBAR_MAX_WIDTH = 900;

// [2] 초기화
document.addEventListener('DOMContentLoaded', () => {
    setupGanttResizer();
    setupGanttZoom();
    setupGanttFilterButtons();
    setupGanttScrollSync();

    // 창 크기 변경 시 전체 너비에 맞춰 자동 재계산
    window.addEventListener('resize', () => {
        if (currentGanttFilters.site && currentGanttFilters.equip) {
            renderGanttChart();
        }
    });

    // 초기 간트 차트 렌더링
    renderGanttChart();
});

// [3] 사이드바 리사이저
function setupGanttResizer() {
    const resizer = document.getElementById('gantt-resizer');
    const sidebar = document.getElementById('gantt-sidebar');
    if (!resizer || !sidebar) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = ganttSidebarWidth;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        let newWidth = Math.max(GANTT_SIDEBAR_MIN_WIDTH, Math.min(GANTT_SIDEBAR_MAX_WIDTH, startWidth + diff));
        ganttSidebarWidth = newWidth;
        sidebar.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            renderGanttChart();
        }
    });
}

// [4] 줌 (+ / -) 버튼
function setupGanttZoom() {
    const btnExpand = document.getElementById('btn-gantt-expand');
    const btnContract = document.getElementById('btn-gantt-contract');

    if (btnExpand) {
        btnExpand.onclick = () => {
            ganttDayWidth = Math.min(60, ganttDayWidth + 6);
            renderGanttChart();
        };
    }

    if (btnContract) {
        btnContract.onclick = () => {
            ganttDayWidth = Math.max(16, ganttDayWidth - 6);
            renderGanttChart();
        };
    }
}

// [5] 툴바 버튼
function setupGanttFilterButtons() {
    const btnHistory = document.getElementById('btn-gantt-history');
    if (btnHistory) {
        btnHistory.onclick = () => {
            const site = currentGanttFilters.site;
            const equip = currentGanttFilters.equip;
            if (!site || !equip) {
                return alert('장비를 먼저 선택해주세요.');
            }
            if (typeof window.openSetupHistoryModal === 'function') {
                window.openSetupHistoryModal(site, equip);
            }
        };
    }
}

// [5-1] 좌/우측 스크롤 동기화 및 세로 스크롤 시 가로 스크롤 자동 조절
let isSyncingTimelineScroll = false;
let isSyncingTaskListScroll = false;
let lastGanttScrollTop = 0;
let currentGanttTaskItems = [];
let currentDynamicDayWidth = 45;

function handleTimelineVerticalScroll(currentScrollTop) {
    if (!currentGanttTaskItems || currentGanttTaskItems.length === 0) return;
    const timelineContainer = document.getElementById('gantt-timeline-container');
    if (!timelineContainer) return;

    const maxScrollTop = timelineContainer.scrollHeight - timelineContainer.clientHeight;
    const maxScrollLeft = timelineContainer.scrollWidth - timelineContainer.clientWidth;
    if (maxScrollLeft <= 0) return;

    // 세로 스크롤 진행률에 따라 현재 활성 태스크 인덱스 계산
    const progress = maxScrollTop > 0 ? (currentScrollTop / maxScrollTop) : 0;
    const targetIdx = Math.min(currentGanttTaskItems.length - 1, Math.max(0, Math.round(progress * (currentGanttTaskItems.length - 1))));
    const targetTask = currentGanttTaskItems[targetIdx];
    if (!targetTask) return;

    // 해당 태스크 바 위치로 가로 스크롤 이동 (중앙 정렬)
    const barLeft = (targetTask.startDay - 1) * currentDynamicDayWidth;
    const barWidth = targetTask.estDays * currentDynamicDayWidth;
    const barCenter = barLeft + (barWidth / 2);
    const desiredScrollLeft = barCenter - (timelineContainer.clientWidth / 2);
    const targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, desiredScrollLeft));

    timelineContainer.scrollLeft = targetScrollLeft;
}

function setupGanttScrollSync() {
    const taskList = document.getElementById('gantt-task-list');
    const timelineContainer = document.getElementById('gantt-timeline-container');
    if (!taskList || !timelineContainer) return;

    if (taskList.dataset.scrollSyncAttached) return;
    taskList.dataset.scrollSyncAttached = 'true';

    timelineContainer.addEventListener('scroll', () => {
        const currentScrollTop = timelineContainer.scrollTop;
        const isVerticalScroll = Math.abs(currentScrollTop - lastGanttScrollTop) >= 1;

        if (isVerticalScroll) {
            lastGanttScrollTop = currentScrollTop;
            if (!isSyncingTimelineScroll) {
                isSyncingTaskListScroll = true;
                taskList.scrollTop = currentScrollTop;
                requestAnimationFrame(() => {
                    isSyncingTaskListScroll = false;
                });
            }
            // 세로 스크롤 시 리스트 작업 위치에 맞춰 가로 스크롤 자동 조절
            handleTimelineVerticalScroll(currentScrollTop);
        }
    }, { passive: true });

    taskList.addEventListener('scroll', () => {
        if (!isSyncingTaskListScroll) {
            isSyncingTimelineScroll = true;
            timelineContainer.scrollTop = taskList.scrollTop;
            requestAnimationFrame(() => {
                isSyncingTimelineScroll = false;
            });
        }
    }, { passive: true });
}

// [6] 메인 간트 차트 렌더링
function renderGanttChart() {
    const wrapper = document.getElementById('gantt-wrapper');
    const emptyMsg = document.getElementById('gantt-empty-msg');
    const taskList = document.getElementById('gantt-task-list');
    const headerMonths = document.getElementById('gantt-header-months');
    const headerWeeks = document.getElementById('gantt-header-weeks');
    const ganttBody = document.getElementById('gantt-body');
    const sidebar = document.getElementById('gantt-sidebar');
    const targetInfoEl = document.getElementById('gantt-target-info');

    const site = currentGanttFilters.site;
    const equip = currentGanttFilters.equip;

    // 스크롤 위치 초기화
    lastGanttScrollTop = 0;
    if (taskList) taskList.scrollTop = 0;
    const timelineContainer = document.getElementById('gantt-timeline-container');
    if (timelineContainer) {
        timelineContainer.scrollTop = 0;
        timelineContainer.scrollLeft = 0;
    }

    // 1. 장비 선택 여부 확인
    if (!site || !equip) {
        if (wrapper) wrapper.style.display = 'none';
        if (emptyMsg) {
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = '장비 정보에서 리스트를 클릭하면 간트뷰 일정이 표시됩니다.';
        }
        if (targetInfoEl) targetInfoEl.textContent = '';
        return;
    }

    // 2. 장비 상세 및 마스터 데이터 로드
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const equipData = setupData[equipKey] || {};
    const setupLogs = equipData.setupLogs || [];
    const setupDetails = equipData.setupDetails || [];

    // 장비 라벨 정보
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const parts = equip.split('::');
    const rawName = parts[0];
    const serial = parts.length > 1 ? parts[1] : '';
    const custNameFromKey = parts.length > 2 ? parts[2] : '';
    const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
    const detailKey = `details_${site}_${equip}`;
    const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
    const custEquipName = custNameFromKey || ((detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '');
    
    let labelSub = custEquipName ? `[${custEquipName}]` : (serial ? `(${serial})` : '');

    // 3. 완료된 셋업 일지(setupLogs) + 예정된 셋업 상세(setupDetails) 결합
    const completedItems = setupLogs.filter(log => log.date).map(log => ({
        id: log.id,
        site: site,
        equip: equip,
        category: log.category || '-',
        subcategory: log.subcategory || '-',
        content: log.content || '-',
        worker: log.worker || '',
        date: log.date || '',
        md: log.md || '1',
        memo: log.memo || '',
        parts: log.parts || '',
        isCompleted: true,
        status: '완료'
    }));

    // setupLogs에 이미 완료 기록된 작업 키 세트 (중복 예정 표시 방지)
    const completedLogKeys = new Set(setupLogs.map(l => `${l.category || ''}::${l.subcategory || l.content || ''}`));
    const completedLogSubs = new Set(setupLogs.map(l => l.subcategory).filter(Boolean));
    const completedLogContents = new Set(setupLogs.map(l => l.content).filter(Boolean));

    // setupLogs에 아직 기록되지 않고, 사용자가 직접 등록한(작업자나 날짜가 있는) 미완료 예정 항목들만 추출
    const pendingDetails = setupDetails.filter(d => {
        if (d.completed) return false;
        if (!d.date && !d.startDate) return false;
        if (d.estDays === '0' && !d.worker) return false;

        const sub = d.subcategory || d.content || '';
        const cont = d.content || d.subcategory || '';
        const key1 = `${d.category || ''}::${sub}`;
        const key2 = `${d.category || ''}::${cont}`;

        // setupLogs에 이미 일지로 완료 기록된 작업은 예정 목록에서 제외
        if (completedLogKeys.has(key1) || completedLogKeys.has(key2)) return false;
        if (sub && completedLogSubs.has(sub)) return false;
        if (cont && completedLogContents.has(cont)) return false;
        if (d.category === '셋업 완료' && (completedLogSubs.has('셋업 완료') || completedLogContents.has('셋업 완료') || setupLogs.some(l => l.category === '셋업 완료'))) return false;

        return true;
    }).map(d => ({
        id: d.id,
        site: site,
        equip: equip,
        category: d.category || '-',
        subcategory: d.subcategory || '-',
        content: d.content || d.subcategory || '-',
        worker: d.worker || '',
        date: d.date || d.startDate || '',
        md: d.estDays || '1',
        memo: d.delayReason || '',
        parts: '',
        isCompleted: false,
        status: '예정'
    }));

    const allRawItems = [...completedItems, ...pendingDetails];

    if (allRawItems.length === 0) {
        if (wrapper) wrapper.style.display = 'none';
        if (emptyMsg) {
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = '등록된 셋업 작업 일지 및 예정 일정이 없습니다.';
        }
        if (targetInfoEl) {
            targetInfoEl.innerHTML = `<strong>${escapeHtml(site)}</strong> &gt; ${escapeHtml(displayName)} <span style="color:#3fb950; font-weight:500;">${escapeHtml(labelSub)}</span> <span style="margin-left:12px; color:#8b949e; font-weight:500;">[등록된 일정 없음]</span>`;
        }
        return;
    }

    // 날짜 오름차순 정렬 (날짜 같으면 완료 건 우선)
    const sortedItems = allRawItems.sort((a, b) => {
        const dateDiff = new Date(a.date || '9999-12-31') - new Date(b.date || '9999-12-31');
        if (dateDiff !== 0) return dateDiff;
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? -1 : 1;
        return (a.id || 0) - (b.id || 0);
    });

    // 고유 작업 일자 목록 추출 및 오름차순 정렬 (실제 작업이 존재하는 날짜만 순서대로 D1, D2, D3...)
    const dateSet = new Set();
    sortedItems.forEach(item => {
        if (item.date && item.date.trim()) {
            dateSet.add(item.date.trim());
        }
    });
    const uniqueDates = Array.from(dateSet).sort((a, b) => new Date(a) - new Date(b));

    const dateToDayIndex = {};
    uniqueDates.forEach((dStr, idx) => {
        dateToDayIndex[dStr] = idx + 1;
    });

    const taskItems = sortedItems.map((item, idx) => {
        const estDays = 1; // 작업당 무조건 1일 처리
        let startDay = 1;

        if (item.date && dateToDayIndex[item.date.trim()]) {
            startDay = dateToDayIndex[item.date.trim()];
        } else {
            startDay = 1;
        }

        const endDay = startDay + estDays - 1;

        return {
            ...item,
            index: idx,
            estDays: estDays,
            startDay: startDay,
            endDay: endDay
        };
    });

    const totalDays = Math.max(1, uniqueDates.length);

    // 상단 타겟 정보 업데이트
    if (targetInfoEl) {
        const completedCount = taskItems.filter(t => t.isCompleted).length;
        const pendingCount = taskItems.filter(t => !t.isCompleted).length;
        targetInfoEl.innerHTML = `<strong>${escapeHtml(site)}</strong> &gt; ${escapeHtml(displayName)} <span style="color:#3fb950; font-weight:500;">${escapeHtml(labelSub)}</span> <span style="margin-left:12px; color:#e6edf3; font-weight:600;">[총 ${taskItems.length}건 (완료 ${completedCount}건, <span style="color:#58a6ff;">예정 ${pendingCount}건</span>)]</span>`;
    }

    if (wrapper) wrapper.style.display = 'flex';
    if (emptyMsg) emptyMsg.style.display = 'none';
    if (sidebar) sidebar.style.width = `${ganttSidebarWidth}px`;

    // 4. 사이드바 태스크 목록 렌더링 (셋업 구분 | 세부 내용 | 내용 | 상태)
    if (taskList) {
        taskList.innerHTML = '';
        taskItems.forEach(t => {
            const itemDiv = document.createElement('div');
            itemDiv.className = `gantt__task-item ${t.isCompleted ? 'completed' : 'pending'}`;
            itemDiv.style.height = '36px';
            itemDiv.style.minHeight = '36px';
            itemDiv.style.maxHeight = '36px';
            itemDiv.style.boxSizing = 'border-box';
            itemDiv.style.display = 'flex';
            itemDiv.style.alignItems = 'center';
            itemDiv.style.padding = '0 10px';
            itemDiv.style.borderBottom = '1px solid #21262d';
            itemDiv.style.cursor = 'pointer';
            itemDiv.title = `[${t.category} > ${t.subcategory}]\n작업일: ${t.date} (${t.worker}, ${t.md}MD)\n내용: ${t.content}\n상태: ${t.status}\n(클릭 시 작업 상세/수정)`;

            const statusColor = t.isCompleted ? '#3fb950' : '#58a6ff';

            itemDiv.innerHTML = `
                <div class="gantt__task-label-container" style="display:flex; align-items:center; width:100%; min-width:0; padding-right:8px; gap:8px;">
                    <span style="width:105px; flex-shrink:0; font-size:11px; color:#8b949e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(t.category)}">${escapeHtml(t.category)}</span>
                    <span class="gantt__task-label" style="width:175px; flex-shrink:0; font-size:12px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#e6edf3;" title="${escapeHtml(t.subcategory)}">${escapeHtml(t.subcategory)}</span>
                    <span style="flex:1; min-width:180px; font-size:11px; color:#a5d6ff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(t.content)}">${escapeHtml(t.content)}</span>
                    <span class="gantt__task-progress" style="width:45px; text-align:right; flex-shrink:0; font-size:11px; font-weight:bold; color:${statusColor};">${escapeHtml(t.status)}</span>
                </div>
            `;

            // 클릭 시 해당 셋업 작업/일지 팝업 오픈
            itemDiv.onclick = (e) => {
                e.stopPropagation();
                if (t.isCompleted) {
                    if (typeof window.openLogForEditing === 'function') {
                        window.openLogForEditing(t.site, t.equip, t.id);
                    } else if (typeof window.openSetupLogRegisterModal === 'function') {
                        window.openSetupLogRegisterModal(t.site, t.equip, t.subcategory, t.date, false, true);
                    }
                } else {
                    if (typeof window.openSetupLogRegisterModal === 'function') {
                        window.openSetupLogRegisterModal(t.site, t.equip, t.subcategory, t.date, false, false);
                    }
                }
            };

            taskList.appendChild(itemDiv);
        });
    }

    // 5. 타임라인 너비 자동 계산 (간트뷰 전체 가용 너비를 채우되 일자별 최소/가변 너비 유지)
    let dynamicDayWidth = ganttDayWidth;
    if (timelineContainer && timelineContainer.clientWidth > 0 && totalDays > 0) {
        dynamicDayWidth = Math.max(ganttDayWidth, Math.max(45, Math.floor(timelineContainer.clientWidth / totalDays)));
    } else {
        dynamicDayWidth = Math.max(ganttDayWidth, 45);
    }
    const totalTimelineWidth = Math.max(timelineContainer ? timelineContainer.clientWidth : 0, totalDays * dynamicDayWidth);

    currentGanttTaskItems = taskItems;
    currentDynamicDayWidth = dynamicDayWidth;

    const ganttTimeline = document.getElementById('gantt-timeline');
    if (ganttTimeline) {
        ganttTimeline.style.width = `${totalTimelineWidth}px`;
        ganttTimeline.style.minWidth = `${totalTimelineWidth}px`;
    }

    if (headerMonths) {
        headerMonths.style.width = `${totalTimelineWidth}px`;
        headerMonths.style.minWidth = `${totalTimelineWidth}px`;
        headerMonths.innerHTML = `
            <div class="gantt__date-cell gantt__date-cell--month" style="width: 100%; min-width: 100%; box-sizing: border-box; text-align:center; font-weight:bold; color:#e6edf3; display:flex; align-items:center; justify-content:center;">
                <span style="position: sticky; left: 0; padding: 0 16px; font-size: 12px; font-weight: 600; color: #e6edf3;">셋업 일정 진행 현황 (일수 모드)</span>
            </div>
        `;
    }

    if (headerWeeks) {
        headerWeeks.style.width = `${totalTimelineWidth}px`;
        headerWeeks.style.minWidth = `${totalTimelineWidth}px`;
        let dayHtml = '';
        for (let d = 1; d <= totalDays; d++) {
            let mmdd = '';
            let dateTitle = `D${d}`;
            if (d <= uniqueDates.length) {
                const dateStr = uniqueDates[d - 1];
                const parts = dateStr.split('-');
                mmdd = parts.length === 3 ? `${parts[1]}/${parts[2]}` : dateStr;
                dateTitle = `D${d} (${dateStr})`;
            }

            dayHtml += `
                <div class="gantt__date-cell gantt__date-cell--day" style="width:${dynamicDayWidth}px; min-width:${dynamicDayWidth}px; text-align:center; padding:4px 0;" title="${dateTitle}">
                    <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
                        <span style="font-size:10px; font-weight:bold; color:#e6edf3;">D${d}</span>
                        <span style="font-size:9px; color:#8b949e; min-height:12px;">${mmdd}</span>
                    </div>
                </div>
            `;
        }
        headerWeeks.innerHTML = dayHtml;
    }

    // 6. 타임라인 바디 (그리드 라인 및 실행 바)
    if (ganttBody) {
        ganttBody.innerHTML = '';
        ganttBody.style.width = `${totalTimelineWidth}px`;

        taskItems.forEach((t, i) => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'gantt__row';
            rowDiv.style.position = 'relative';
            rowDiv.style.width = `${totalTimelineWidth}px`;
            rowDiv.style.height = '36px';
            rowDiv.style.borderBottom = '1px solid #21262d';
            rowDiv.style.cursor = 'pointer';

            // 배경 그리드 세로선
            for (let d = 0; d < totalDays; d++) {
                const gridLine = document.createElement('div');
                gridLine.style.position = 'absolute';
                gridLine.style.left = `${d * dynamicDayWidth}px`;
                gridLine.style.top = '0';
                gridLine.style.bottom = '0';
                gridLine.style.width = '1px';
                gridLine.style.background = '#21262d';
                gridLine.style.pointerEvents = 'none';
                rowDiv.appendChild(gridLine);
            }

            // 실행 바 (완료: 녹색, 예정: 파란색)
            const execLeft = (t.startDay - 1) * dynamicDayWidth + 2;
            const execWidth = t.estDays * dynamicDayWidth - 4;
            const execBar = document.createElement('div');
            execBar.className = `gantt__bar ${t.isCompleted ? 'gantt__bar--exec' : 'gantt__bar--plan'}`;
            execBar.style.position = 'absolute';
            execBar.style.left = `${execLeft}px`;
            execBar.style.top = '6px';
            execBar.style.width = `${execWidth}px`;
            execBar.style.height = '24px';
            execBar.style.borderRadius = '4px';
            if (t.isCompleted) {
                execBar.style.background = '#238636';
                execBar.style.border = '1px solid #3fb950';
            } else {
                execBar.style.background = '#1f6feb';
                execBar.style.border = '1px solid #58a6ff';
            }
            execBar.style.display = 'flex';
            execBar.style.alignItems = 'center';
            execBar.style.justifyContent = 'center';
            execBar.style.fontSize = '11px';
            execBar.style.fontWeight = 'bold';
            execBar.style.color = '#ffffff';
            execBar.style.zIndex = '2';
            execBar.textContent = t.worker || (t.isCompleted ? '완료' : '예정');
            execBar.title = `[${t.category} > ${t.subcategory}]\n작업일: ${t.date} (${t.worker}, ${t.md}MD)\n내용: ${t.content}\n상태: ${t.status}`;
            rowDiv.appendChild(execBar);

            // 행 클릭 시 작업 팝업 오픈
            rowDiv.onclick = (e) => {
                e.stopPropagation();
                if (t.isCompleted) {
                    if (typeof window.openLogForEditing === 'function') {
                        window.openLogForEditing(t.site, t.equip, t.id);
                    } else if (typeof window.openSetupLogRegisterModal === 'function') {
                        window.openSetupLogRegisterModal(t.site, t.equip, t.subcategory, t.date, false, true);
                    }
                } else {
                    if (typeof window.openSetupLogRegisterModal === 'function') {
                        window.openSetupLogRegisterModal(t.site, t.equip, t.subcategory, t.date, false, false);
                    }
                }
            };

            ganttBody.appendChild(rowDiv);
        });
    }

    setupGanttScrollSync();
}

window.renderGanttChart = renderGanttChart;
