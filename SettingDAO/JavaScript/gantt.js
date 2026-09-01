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

    // 기준 첫 작업일 (가장 빠른 작업일 또는 예정일) 계산
    let firstDate = null;
    const validDates = sortedItems.map(item => item.date).filter(Boolean);
    if (validDates.length > 0) {
        const [y, m, d] = validDates[0].split('-').map(Number);
        if (y && m && d) firstDate = new Date(y, m - 1, d);
    }

    const taskItems = sortedItems.map((item, idx) => {
        const estDays = 1; // 작업당 무조건 1일 처리
        let startDay = idx + 1;

        if (firstDate && item.date) {
            const [ty, tm, td] = item.date.split('-').map(Number);
            if (ty && tm && td) {
                const taskDate = new Date(ty, tm - 1, td);
                const diffTime = taskDate.getTime() - firstDate.getTime();
                const diffDays = Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)));
                startDay = diffDays + 1;
            }
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

    const maxDayReached = taskItems.reduce((max, t) => Math.max(max, t.endDay), 1);
    const totalDays = Math.max(7, maxDayReached);

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

    // 5. 타임라인 너비 자동 계산 (간트뷰 전체 가용 너비를 100% 꽉 채우도록 계산)
    const timelineContainer = document.getElementById('gantt-timeline-container');
    let dynamicDayWidth = ganttDayWidth;
    if (timelineContainer && timelineContainer.clientWidth > 0 && totalDays > 0) {
        dynamicDayWidth = Math.max(35, timelineContainer.clientWidth / totalDays);
    }
    const totalTimelineWidth = Math.max(timelineContainer ? timelineContainer.clientWidth : 0, totalDays * dynamicDayWidth);

    if (headerMonths) {
        headerMonths.innerHTML = `<div class="gantt__date-cell gantt__date-cell--month" style="width: 100%; text-align:center; font-weight:bold; color:#e6edf3;">셋업 일정 진행 현황 (일수 모드)</div>`;
    }

    if (headerWeeks) {
        let dayHtml = '';
        for (let d = 1; d <= totalDays; d++) {
            let mmdd = '';
            let dateTitle = `Day ${d}`;
            if (firstDate) {
                const currDate = new Date(firstDate);
                currDate.setDate(currDate.getDate() + (d - 1));
                mmdd = `${String(currDate.getMonth() + 1).padStart(2, '0')}/${String(currDate.getDate()).padStart(2, '0')}`;
                dateTitle = `Day ${d} (${currDate.toISOString().split('T')[0]})`;
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
}

window.renderGanttChart = renderGanttChart;
