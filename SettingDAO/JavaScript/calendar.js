/* ==========================================================================
   캘린더 시스템 (Calendar System)
   ========================================================================== */

// [1] 전역 변수 (Global Variables)
const nowInit = new Date();
let calendarDate = new Date(nowInit.getFullYear(), nowInit.getMonth(), 1); // [수정] 1일로 초기화하여 월 계산 오류 방지
var currentSearchFilters = { site: '', equip: '' };
let currentScheduleTarget = null;
let currentDetailTarget = null;
let expandedViewId = null;
let currentNextScheduleTarget = null; // [추가] 다음 작업 예정일 타겟

// [추가] 공통 함수 폴백 (common.js 누락 대비)
if (typeof window.getHolidayName !== 'function') {
    window.getHolidayName = function (year, month, day) { return null; };
}

// [2] 초기화 (Initialization)
document.addEventListener('DOMContentLoaded', () => {
    setupCalendar();
    setupScheduleModal();
    setupEventDetailModal();
    setupRegisterScheduleModal();
    setupSearchModal();
    setupNextScheduleModal(); // [추가]

    // 드롭다운 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        const dropdowns = document.querySelectorAll('.log-select-dropdown.show');
        dropdowns.forEach(d => {
            if (!d.parentElement.contains(e.target)) d.classList.remove('show');
        });
    });
});

/* ==========================================================================
   [3] 핵심 로직 & 데이터 처리 (Core Logic & Data)
   ========================================================================== */

/**
 * 공통: 사업장 및 장비 매핑 데이터 가져오기 (데이터 구조 변경(device_data) 대응)
 */
function getDeviceDataMap() {
    if (typeof storageData !== 'undefined') {
        if (storageData.device_data) return storageData.device_data;
        return storageData;
    }
    return JSON.parse(localStorage.getItem('device_data')) || JSON.parse(localStorage.getItem('withtech_data')) || {};
}

/**
 * 캘린더 표시용 일정 데이터 수집
 */
function getScheduleForCalendar() {
    const events = {};
    const mainData = getDeviceDataMap();

    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            mainData[site].forEach(equip => {
                const key = `details_${site}_${equip}`;
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (!data) return;

                    if (data.maint) {
                        data.maint.forEach(item => {
                            let targetDateStr = '';
                            if (item.scheduledDate) {
                                targetDateStr = item.scheduledDate;
                            }
                            if (targetDateStr) {
                                if (!events[targetDateStr]) events[targetDateStr] = [];
                                events[targetDateStr].push({ site, equip, type: item.type || '정기', content: item.code ? item.code : item.content, id: item.id, md: item.md || 0 });
                            }
                        });
                    }

                    if (data.logs) {
                        data.logs.forEach(log => {
                            if (log.date) {
                                if (!events[log.date]) events[log.date] = [];
                                const isChanged = log.detailType === '일정변경';
                                events[log.date].push({
                                    site,
                                    equip,
                                    type: log.type || '정기',
                                    content: log.content || log.memo || '내용 없음',
                                    id: log.id,
                                    isCompleted: !isChanged,
                                    isChanged: isChanged,
                                    md: log.md || 0
                                });
                            }
                        });
                    }
                } catch (e) { console.error(`Error parsing data for key ${key}:`, e); }
            });
        }
    });
    return events;
}

/**
 * 일정 날짜 설정 (등록/수정/삭제)
 */
function setScheduleDate(site, equip, id, dateStr, isDelete = false, md = null, providedReason = undefined) {
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};

    if (data.maint) {
        const index = data.maint.findIndex(i => i.id === id);
        if (index > -1) {
            const item = data.maint[index];
            const oldDate = item.scheduledDate;

            // [추가] 확정된 월의 일정이 변경/삭제되는 경우 사유 확인 및 이력 생성
            if (item.scheduledDate && (isDelete || item.scheduledDate !== dateStr)) {
                const [y, m] = item.scheduledDate.split('-').map(Number);
                const confs = JSON.parse(localStorage.getItem('calendar_confirmations')) || {};
                const yyyyMm = `${y}-${String(m).padStart(2, '0')}`;
                const monthConf = confs[yyyyMm];

                const isGlobalConfirmed = monthConf && monthConf.count !== undefined;
                const isSiteConfirmed = monthConf && (monthConf[site] !== undefined || (monthConf.siteCounts && monthConf.siteCounts[site] !== undefined));

                if (isGlobalConfirmed || isSiteConfirmed) {
                    let reason = providedReason;
                    if (reason === undefined) {
                        reason = prompt(`[${yyyyMm} 예정 확정됨]\n해당 월은 일정이 확정된 상태입니다.\n일정 ${isDelete ? '삭제' : '변경'} 사유를 입력해주세요:`);
                        if (reason === null) return false; // 취소 시 중단
                    }
                    const actualReason = (reason && reason.trim()) ? reason.trim() : '사유 미입력';

                    if (!data.logs) data.logs = [];
                    data.logs.push({
                        id: Date.now() + Math.floor(Math.random() * 10000), // 중복 방지
                        date: item.scheduledDate, // 기존 날짜에 변경 이력 남김
                        type: item.type || '정기',
                        detailType: '일정변경',
                        detailType2: '',
                        content: `[변경] ${item.code ? item.code : item.content}`,
                        costType: item.costType || '',
                        md: '0',
                        worker: sessionStorage.getItem('userId') || '',
                        memo: `[일정 ${isDelete ? '삭제' : '변경'} 사유]\n${actualReason}\n\n[변경 내역]\n기존: ${item.scheduledDate}\n변경: ${isDelete ? '삭제됨' : dateStr}`
                    });
                }
            }

            if (isDelete) {
                delete item.scheduledDate;
                delete item.md;
                delete item.costType;
                delete item.worker;
                delete item.memo;
                if (!item.period) {
                    data.maint.splice(index, 1);
                }
            } else {
                item.scheduledDate = dateStr;
                if (md !== null) {
                    item.md = md;
                }

                const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
                const newMonth = dateStr.substring(0, 7);
                if (oldMonth !== newMonth) {
                    if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
                }
            }
            localStorage.setItem(key, JSON.stringify(data));

            if (typeof addSystemLog === 'function') {
                const action = isDelete ? 'DELETE_SCHEDULE' : 'ADD_SCHEDULE';
                addSystemLog(action, equip, `Date: ${dateStr}, Content: ${item.content}`);
            }
            return true;
        }
    }
    return false;
}

/* ==========================================================================
   [4] 캘린더 UI 렌더링 (Calendar UI Rendering)
   ========================================================================== */

function setupCalendar() {
    const prevBtn = document.getElementById('prev-month');
    const nextBtn = document.getElementById('next-month');
    const todayBtn = document.getElementById('btn-today');
    const closePopupBtn = document.getElementById('btn-close-calendar-popup');
    const popup = document.getElementById('calendar-popup');
    const searchInput = document.getElementById('calendar-search');
    const filterBtn = document.getElementById('btn-search-filter');
    const targetInfoEl = document.getElementById('calendar-target-info');

    // [추가] 캘린더 타이틀 클릭 이벤트 (확장/축소)
    const title1 = document.getElementById('calendar-title-1');
    const title2 = document.getElementById('calendar-title-2');

    if (title1) {
        title1.style.cursor = 'pointer';
        title1.title = '클릭하여 확대/축소';
        title1.onclick = () => toggleCalendarExpand(1);
    }
    if (title2) {
        title2.style.cursor = 'pointer';
        title2.title = '클릭하여 확대/축소';
        title2.onclick = () => toggleCalendarExpand(2);
    }

    if (prevBtn) {
        prevBtn.onclick = () => {
            calendarDate.setMonth(calendarDate.getMonth() - 1);
            renderCalendar();
        };
    }
    if (nextBtn) {
        nextBtn.onclick = () => {
            calendarDate.setMonth(calendarDate.getMonth() + 1);
            renderCalendar();
        };
    }
    if (todayBtn) {
        todayBtn.onclick = goToTodayMonth;
    }
    if (closePopupBtn && popup) {
        closePopupBtn.onclick = () => popup.style.display = 'none';
        popup.onclick = (e) => { if (e.target === popup) popup.style.display = 'none'; };
    }
    if (searchInput) {
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.addEventListener('input', () => {
            renderCalendar();
        });
    }
    if (filterBtn) {
        filterBtn.onclick = () => openSearchModal();
    }
    if (targetInfoEl) {
        targetInfoEl.onclick = () => openSearchModal();
        targetInfoEl.style.cursor = 'pointer';
        targetInfoEl.title = '클릭하여 상세 검색 열기';
    }
}

function toggleCalendarExpand(viewId) {
    const views = document.querySelectorAll('.calendar-view');
    const divider = document.querySelector('.calendar-divider');
    const wrapper = document.querySelector('.calendars-wrapper');

    if (expandedViewId === viewId) {
        // 이미 확장된 상태면 원래대로 복귀
        expandedViewId = null;
        if (wrapper) wrapper.classList.remove('single-month-mode');
        views.forEach(v => {
            v.style.display = '';
            v.style.flex = '';
            v.style.maxWidth = '';
            v.style.flexDirection = '';
        });
        if (divider) divider.style.display = '';
    } else {
        // 해당 뷰 확장
        expandedViewId = viewId;
        if (wrapper) wrapper.classList.add('single-month-mode');
        views.forEach((v, index) => {
            // viewId는 1부터 시작, index는 0부터 시작
            if (index + 1 === viewId) {
                v.style.display = 'flex';
                v.style.flexDirection = 'column';
                v.style.flex = '1';
                v.style.maxWidth = '100%';
            } else {
                v.style.display = 'none';
            }
        });
        if (divider) divider.style.display = 'none';
    }

    // [추가] 뷰 모드 변경 시 표시 항목 제한(개수) 적용을 위해 달력 재렌더링
    renderCalendar();
}

function goToTodayMonth() {
    const now = new Date();
    calendarDate = new Date(now.getFullYear(), now.getMonth(), 1); // [수정] 1일로 설정

    // [수정] 1개월 보기 상태에서 2번째 달(Next Month)을 보고 있었다면,
    // Today 클릭 시 현재 월이 보이는 1번 뷰로 전환하여 밀림 현상 방지
    if (expandedViewId === 2) {
        toggleCalendarExpand(1);
    }

    renderCalendar(); // 렌더링 (오늘이 포함된 달이 왼쪽(Month 1)에 오게 됨)
}

function renderCalendar() {
    // 검색 및 필터 정보 표시 (제목 아래)
    const targetInfoEl = document.getElementById('calendar-target-info');
    const searchInput = document.getElementById('calendar-search');
    const keyword = searchInput ? searchInput.value.trim() : '';

    if (targetInfoEl) {
        let infoText = '';
        if (currentSearchFilters.site) {
            infoText = `<${currentSearchFilters.site}`;
            if (currentSearchFilters.equip) {
                const parts = currentSearchFilters.equip.split('::');
                infoText += `, ${parts[0]}`;
                if (parts.length > 1) infoText += ` (${parts[1]})`;
            }
            infoText += '>';
        }
        if (keyword) {
            if (infoText) infoText += ` (검색: ${keyword})`;
            else infoText = `검색: "${keyword}"`;
        }
        targetInfoEl.textContent = infoText;
    }

    // Render Month 1
    renderMonthGrid(calendarDate.getFullYear(), calendarDate.getMonth(), 'calendar-title-1', 'calendar-dates-1');

    // Render Month 2
    const nextMonthDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderMonthGrid(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), 'calendar-title-2', 'calendar-dates-2');
}

function renderMonthGrid(year, month, titleId, gridId) {
    const titleEl = document.getElementById(titleId);
    const gridEl = document.getElementById(gridId);
    if (!titleEl || !gridEl) return;

    const searchInput = document.getElementById('calendar-search');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const pmEvents = getScheduleForCalendar();
    gridEl.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevLastDate = new Date(year, month, 0).getDate();

    // Previous month's dates
    for (let i = firstDay; i > 0; i--) {
        const cell = document.createElement('div');
        cell.className = 'date-cell other-month';
        cell.innerHTML = `<span class="date-num">${prevLastDate - i + 1}</span>`;
        gridEl.appendChild(cell);
    }

    // Current month's dates
    const today = new Date();

    let monthTotalTasks = 0;
    let monthCompletedTasks = 0;
    let monthTotalMd = 0;

    for (let i = 1; i <= lastDate; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        let isToday = (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) ? 'today' : '';

        const currentDay = new Date(year, month, i);
        const dayOfWeek = currentDay.getDay(); // 0: 일, 6: 토

        let eventsHtml = '';
        let dayEvents = [];
        let displayCount = 0;

        if (pmEvents[dateStr]) {
            dayEvents = pmEvents[dateStr];

            if (keyword || currentSearchFilters.site || currentSearchFilters.equip) {
                dayEvents = dayEvents.filter(event => {
                    const matchKeyword = !keyword || (
                        (event.site && event.site.toLowerCase().includes(keyword)) ||
                        (event.equip && event.equip.toLowerCase().includes(keyword)) ||
                        (event.content && event.content.toLowerCase().includes(keyword))
                    );

                    const matchSite = !currentSearchFilters.site || event.site === currentSearchFilters.site;
                    const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip || event.equip.split('::')[0] === currentSearchFilters.equip;

                    return matchKeyword && matchSite && matchEquip;
                });
            }

            // [추가] 통계 계산 (일정 변경 이력은 카운트에서 제외하여 통계 왜곡 방지)
            dayEvents.forEach(event => {
                if (event.content && event.content.startsWith('[변경]')) return;
                monthTotalTasks++;
                if (event.isCompleted) monthCompletedTasks++;
                const mdVal = parseFloat(event.md);
                if (!isNaN(mdVal)) monthTotalMd += mdVal;
            });

            // 그룹화 로직
            const groupedEvents = {};
            dayEvents.forEach(event => {
                const key = `${event.site}::${event.equip}::${event.isCompleted}::${event.isChanged}::${event.type}`;
                if (!groupedEvents[key]) {
                    groupedEvents[key] = {
                        site: event.site,
                        equip: event.equip,
                        isCompleted: event.isCompleted,
                        isChanged: event.isChanged,
                        type: event.type,
                        ids: [] // ID 목록 저장을 위해 배열 초기화
                    };
                }
                groupedEvents[key].ids.push(event.id); // ID 추가
            });

            const groups = Object.values(groupedEvents);
            displayCount = groups.length;

            // [추가] 1달/2달 보기에 따른 최대 표시 항목 수 제한
            const isSingleMonthMode = (expandedViewId !== null);
            const maxAllowed = isSingleMonthMode ? 3 : 4;
            const visibleCount = isSingleMonthMode ? 2 : 3;

            let renderGroups = groups;
            if (groups.length > maxAllowed) {
                renderGroups = groups.slice(0, visibleCount);
            }

            renderGroups.forEach(group => {
                const equipName = group.equip.split('::')[0];
                const typeClass = `type-${group.type}`;
                const completedClass = (group.isCompleted || group.isChanged) ? 'completed' : '';

                // 드래그 속성 추가 (완료되지 않은 항목만)
                let dragAttr = '';
                if (!group.isCompleted && !group.isChanged) {
                    const idsJson = JSON.stringify(group.ids).replace(/"/g, '&quot;');
                    dragAttr = `draggable="true" data-drag-site="${escapeHtml(group.site)}" data-drag-equip="${escapeHtml(group.equip)}" data-drag-ids="${idsJson}" ondragstart="handleCalendarDragStartFromData(event)" ondragend="this.classList.remove('dragging')"`;
                }

                eventsHtml += `<div class="calendar-event-item ${completedClass} ${typeClass}" ${dragAttr}>
                    ${escapeHtml(group.site)} ${escapeHtml(equipName)} <span class="event-type-text ${typeClass}">${group.type}</span>
                </div>`;
            });

            // [추가] 제한된 개수를 초과한 경우 생략(...) 표시
            if (groups.length > maxAllowed) {
                eventsHtml += `<div class="more-events" style="display: block; width: 100%; text-align: center; font-weight: bold; color: var(--cal-text-secondary); line-height: 1; margin-top: 2px; pointer-events: none;">...</div>`;
            }
        }

        // 공휴일 및 요일 체크
        const holidayName = window.getHolidayName(year, month, i);
        let dayClass = '';

        if (holidayName || dayOfWeek === 0) dayClass = 'sunday holiday';
        else if (dayOfWeek === 6) dayClass = 'saturday';

        const countHtml = displayCount > 0 ? `<span class="event-count">(${displayCount})</span>` : '';
        const dateContent = `<span class="date-num">${i}</span>${holidayName ? ` <span class="holiday-name">${holidayName}</span>` : ''}${countHtml}`;
        const dateHeader = `<div class="date-header">${dateContent}</div>`;

        const cell = document.createElement('div');
        cell.className = `date-cell ${isToday} ${dayClass}`;
        cell.innerHTML = `${dateHeader}<div class="events-container">${eventsHtml}</div>`;
        // 클릭 이벤트는 유지하되, 드롭 이벤트 추가
        cell.onclick = (e) => { if (!e.defaultPrevented) openCalendarPopup(dateStr, dayEvents); };

        // 드롭 핸들러 연결
        cell.ondragover = (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); };
        cell.ondragleave = (e) => { e.currentTarget.classList.remove('drag-over'); };
        cell.ondrop = (e) => handleCalendarDrop(e, dateStr);

        gridEl.appendChild(cell);
    }

    // Next month's dates
    const nextDays = 42 - (firstDay + lastDate);
    for (let i = 1; i <= nextDays; i++) {
        const cell = document.createElement('div');
        cell.className = 'date-cell other-month';
        cell.innerHTML = `<span class="date-num">${i}</span>`;
        gridEl.appendChild(cell);
    }

    // [추가] 통계 정보 및 예정 확정 상태 업데이트
    const confs = JSON.parse(localStorage.getItem('calendar_confirmations')) || {};
    const yyyyMm = `${year}-${String(month + 1).padStart(2, '0')}`;
    const confirmedInfo = confs[yyyyMm];

    // [수정] 검색 필터 상태 확인 (사업장 전체 여부 및 특정 장비 선택 여부)
    const isSiteAll = !currentSearchFilters.site;
    const selectedSite = currentSearchFilters.site;
    const isEquipSelected = !!currentSearchFilters.equip;

    let baseTotal = monthTotalTasks;
    let confirmBtnHtml = '';
    let isConfirmedStatus = false;

    if (isSiteAll || isEquipSelected) {
        // 전체 사업장이거나 특정 장비가 선택된 경우에는 확정 기능 및 UI 비활성화
        confirmBtnHtml = '';
        if (isSiteAll && !isEquipSelected && confirmedInfo && confirmedInfo.count !== undefined) {
            baseTotal = confirmedInfo.count; // 구버전 전체 확정 데이터 호환
            isConfirmedStatus = true;
        } else {
            baseTotal = monthTotalTasks;
        }
    } else {
        // 특정 사업장이 선택되고 장비가 전체(미선택)인 경우에만 버튼 표시 및 확정수 적용
        let siteConfirmedCount = undefined;
        if (confirmedInfo) {
            if (confirmedInfo[selectedSite] && typeof confirmedInfo[selectedSite] === 'object') {
                siteConfirmedCount = confirmedInfo[selectedSite].count;
            } else if (confirmedInfo.siteCounts && confirmedInfo.siteCounts[selectedSite] !== undefined) {
                siteConfirmedCount = confirmedInfo.siteCounts[selectedSite];
            } else if (confirmedInfo.count !== undefined) {
                // 구버전 글로벌 확정 상태일 때 호환성 처리
                siteConfirmedCount = monthTotalTasks;
            }
        }

        if (siteConfirmedCount !== undefined) {
            baseTotal = siteConfirmedCount;
            isConfirmedStatus = true;
            confirmBtnHtml = `<button class="btn-green" style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:4px; font-weight:bold; cursor:default;" onclick="event.stopPropagation();" disabled>확정 완료</button>`;
        } else {
            baseTotal = monthTotalTasks;
            confirmBtnHtml = `<button class="btn-blue" style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:4px; font-weight:bold;" onclick="event.stopPropagation(); confirmMonthSchedule('${selectedSite}', ${year}, ${month}, ${monthTotalTasks})">확정 전</button>`;
        }
    }

    const formattedMd = Number.isInteger(monthTotalMd) ? monthTotalMd : monthTotalMd.toFixed(1);
    const progressRate = baseTotal === 0 ? 0 : Math.round((monthCompletedTasks / baseTotal) * 100);
    titleEl.style.color = '';
    titleEl.innerHTML = `<div style="display:flex; align-items:center; justify-content:center;">${year}년 ${month + 1}월 ${confirmBtnHtml}</div><div style="font-size:12px; color:var(--cal-text-secondary); font-weight:normal; margin-top:5px; word-break:keep-all;">(진행률: ${progressRate}%, ${isConfirmedStatus ? '확정' : '작업'}수: ${baseTotal}건, 완료: ${monthCompletedTasks}건, 공수: ${formattedMd}M/D)</div>`;
}

function openCalendarPopup(dateStr, events) {
    const popup = document.getElementById('calendar-popup');
    const title = document.getElementById('popup-date-title');
    const list = document.getElementById('popup-event-list');
    const registerBtn = document.getElementById('btn-open-register-modal');

    if (!popup || !title || !list) return;

    title.textContent = dateStr;
    list.innerHTML = '';

    if (!events || events.length === 0) {
        list.innerHTML = '<li class="list-empty-msg">예정된 일정이 없습니다.</li>';
    } else {
        const groupedEvents = {};
        events.forEach(event => {
            const key = `${event.site}::${event.equip}::${event.isCompleted}::${event.isChanged}::${event.type}`;
            if (!groupedEvents[key]) {
                groupedEvents[key] = {
                    site: event.site,
                    equip: event.equip,
                    isCompleted: event.isCompleted,
                    isChanged: event.isChanged,
                    type: event.type,
                    items: []
                };
            }
            groupedEvents[key].items.push(event);
        });

        const groupedList = Object.values(groupedEvents);
        groupedList.sort((a, b) => {
            const aDone = a.isCompleted || a.isChanged;
            const bDone = b.isCompleted || b.isChanged;
            if (aDone === bDone) return 0;
            return aDone ? 1 : -1;
        });

        groupedList.forEach(group => {
            const li = document.createElement('li');
            li.className = 'popup-event-item';

            const textClass = (group.isCompleted || group.isChanged) ? 'completed' : ''; // 변동 항목도 완료처럼 취소선 처리
            const parts = group.equip.split('::');
            const equipName = parts[0];
            const serialNo = parts.length > 1 ? parts[1] : '';
            const displayEquip = serialNo ? `${equipName} (${serialNo})` : equipName;

            const typeClass = `type-${group.type}`;
            const typeBadge = `<span class="popup-type-badge ${typeClass}">[${group.type}]</span>`;

            const wrapper = document.createElement('div');
            wrapper.className = 'item-wrapper';
            wrapper.innerHTML = `
                <span class="item-text popup-item-text ${textClass}">${typeBadge} ${escapeHtml(group.site)} > ${escapeHtml(displayEquip)}</span>
            `;
            li.appendChild(wrapper);

            if (group.isCompleted) {
                const completedSpan = document.createElement('span');
                completedSpan.textContent = '<완료>';
                completedSpan.className = 'popup-completed-badge';
                li.appendChild(completedSpan);
            } else if (group.isChanged) {
                const changedSpan = document.createElement('span');
                changedSpan.textContent = '<변동>';
                changedSpan.style.color = '#f0883e'; // 주황색 강조
                changedSpan.style.marginLeft = 'auto';
                changedSpan.style.fontWeight = 'bold';
                changedSpan.style.fontSize = '12px';
                li.appendChild(changedSpan);
            }

            if (!group.isCompleted && !group.isChanged) {
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-calendar-del';
                delBtn.textContent = '✕';
                delBtn.title = '일정 삭제';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (confirm('이 작업 예정일을 삭제하시겠습니까?')) {
                        let reason = undefined;
                        const sampleItem = group.items[0];
                        if (sampleItem && sampleItem.scheduledDate) {
                            const [y, m] = sampleItem.scheduledDate.split('-').map(Number);
                            const confs = JSON.parse(localStorage.getItem('calendar_confirmations')) || {};
                            const yyyyMm = `${y}-${String(m).padStart(2, '0')}`;
                            const monthConf = confs[yyyyMm];
                            if (monthConf) {
                                const isGlobalConfirmed = monthConf.count !== undefined;
                                const isSiteConfirmed = monthConf[sampleItem.site] !== undefined || (monthConf.siteCounts && monthConf.siteCounts[sampleItem.site] !== undefined);

                                if (isGlobalConfirmed || isSiteConfirmed) {
                                    reason = prompt(`[${yyyyMm} 예정 확정됨]\n해당 월은 일정이 확정되었습니다.\n일정 삭제 사유를 입력해주세요:`);
                                    if (reason === null) return;
                                }
                            }
                        }

                        group.items.forEach(item => {
                            setScheduleDate(item.site, item.equip, item.id, '', true, null, reason);
                        });

                        // UI 갱신 (배경 캘린더 및 대시보드)
                        renderCalendar();
                        if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();

                        // 팝업 닫지 않고 내용만 갱신
                        const dateStr = document.getElementById('popup-date-title').textContent;
                        const allEvents = getScheduleForCalendar();
                        let dayEvents = allEvents[dateStr] || [];

                        // 필터 재적용
                        const searchInput = document.getElementById('calendar-search');
                        const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

                        if (keyword || currentSearchFilters.site || currentSearchFilters.equip) {
                            dayEvents = dayEvents.filter(event => {
                                const matchKeyword = !keyword || ((event.site && event.site.toLowerCase().includes(keyword)) || (event.equip && event.equip.toLowerCase().includes(keyword)) || (event.content && event.content.toLowerCase().includes(keyword)));
                                const matchSite = !currentSearchFilters.site || event.site === currentSearchFilters.site;
                                const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip || event.equip.split('::')[0] === currentSearchFilters.equip;
                                return matchKeyword && matchSite && matchEquip;
                            });
                        }

                        openCalendarPopup(dateStr, dayEvents);
                    }
                };
                li.appendChild(delBtn);
            }

            li.onclick = () => {
                openEventDetailModal(group.site, group.equip, group.items[0].id, group.isCompleted || group.isChanged);
            };
            list.appendChild(li);
        });
    }

    if (registerBtn) {
        registerBtn.onclick = () => openRegisterScheduleModal(dateStr);
    }
    popup.style.display = 'flex';
}

/* ==========================================================================
   [5] 모달: 작업 예정일 설정 (Schedule Date Modal)
   ========================================================================== */

function setupScheduleModal() {
    const modal = document.getElementById('schedule-modal');
    const closeBtn = document.getElementById('btn-close-schedule-modal');
    const saveBtn = document.getElementById('btn-save-schedule');
    const delBtn = document.getElementById('btn-delete-schedule');
    const dateInput = document.getElementById('schedule-date-input');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    if (saveBtn) {
        saveBtn.onclick = () => {
            if (currentScheduleTarget) {
                const date = dateInput.value;
                const mdInput = document.getElementById('schedule-md-input');
                const md = mdInput ? mdInput.value.trim() : '';
                if (!date) return alert('날짜를 선택해주세요.');
                if (!md) return alert('공수(M/D)를 입력해주세요.');
                if (parseFloat(md) < 0) return alert('공수는 0 이상이어야 합니다.');
                const success = setScheduleDate(currentScheduleTarget.site, currentScheduleTarget.equip, currentScheduleTarget.id, date, false, md);
                if (success === false) return; // 사용자가 사유 입력을 취소한 경우 중단
                modal.style.display = 'none';
                if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                renderCalendar();
            }
        };
    }

    if (delBtn) {
        delBtn.onclick = () => {
            if (currentScheduleTarget && confirm('일정을 삭제하시겠습니까?')) {
                const success = setScheduleDate(currentScheduleTarget.site, currentScheduleTarget.equip, currentScheduleTarget.id, '', true);
                if (success === false) return;
                modal.style.display = 'none';
                if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                renderCalendar();
            }
        };
    }
}

function openScheduleModal(site, equip, id) {
    const modal = document.getElementById('schedule-modal');
    if (!modal) return;
    currentScheduleTarget = { site, equip, id };

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const item = data.maint ? data.maint.find(i => i.id === id) : null;

    const dateInput = document.getElementById('schedule-date-input');
    const mdInput = document.getElementById('schedule-md-input');
    if (item && item.scheduledDate) {
        dateInput.value = item.scheduledDate;
    } else {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    if (mdInput) {
        mdInput.value = item ? (item.md || '') : '';
    }

    modal.style.display = 'flex';
}

/* ==========================================================================
   [6] 모달: 일정 상세 정보 (Event Detail Modal)
   ========================================================================== */

function setupEventDetailModal() {
    const modal = document.getElementById('event-detail-modal');
    const closeBtn = document.getElementById('btn-close-detail-modal');
    const closeFooterBtn = document.getElementById('btn-close-detail-footer');
    const completeBtn = document.getElementById('btn-complete-work');
    const cancelBtn = document.getElementById('btn-cancel-completion');
    const dateInput = document.getElementById('detail-scheduled-date');
    const moveToEquipBtn = document.getElementById('btn-move-to-equip');
    const editContentBtn = document.getElementById('btn-edit-detail-content');

    if (!modal) return;

    const closeModal = () => {
        if (editContentBtn && editContentBtn.textContent === '저장') {
            if (!confirm('수정 중인 내용이 있습니다. 저장하지 않고 닫으시겠습니까?')) {
                return;
            }
        }
        modal.style.display = 'none';
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (closeFooterBtn) closeFooterBtn.onclick = closeModal;

    if (completeBtn) {
        completeBtn.onclick = completeScheduleWork;
    }

    if (cancelBtn) {
        cancelBtn.onclick = cancelScheduleCompletion;
    }

    if (dateInput) {
        dateInput.addEventListener('change', updateScheduleDateFromDetail);
    }

    if (moveToEquipBtn) {
        moveToEquipBtn.onclick = () => {
            if (currentDetailTarget) {
                location.href = `maintenance.html?site=${encodeURIComponent(currentDetailTarget.site)}&equip=${encodeURIComponent(currentDetailTarget.equip)}`;
            }
        };
    }

    if (editContentBtn) {
        editContentBtn.onclick = toggleDetailContentEdit;
    }
}

function openEventDetailModal(site, equip, id, isCompleted) {
    const modal = document.getElementById('event-detail-modal');
    if (!modal) return;

    currentDetailTarget = { site, equip, id, isCompleted };

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};

    let item = null;
    if (isCompleted) {
        item = data.logs ? data.logs.find(l => l.id == id) : null;
    } else {
        item = data.maint ? data.maint.find(i => i.id == id) : null;
    }

    if (!item) return;

    const parts = equip.split('::');
    document.getElementById('detail-equip-info').textContent = `${site} > ${parts[0]}`;
    document.getElementById('detail-serial-no').textContent = parts.length > 1 ? parts[1] : '-';
    document.getElementById('detail-type').textContent = item.type || '정기';
    let displayDetailType = item.detailType;
    if (!displayDetailType) {
        displayDetailType = (item.type === '정기') ? 'PM 점검' : 'BM 점검';
    }
    document.getElementById('detail-detail-type').textContent = displayDetailType;

    // [수정] 같은 날짜, 같은 타입, 세부구분에 예정된 항목들을 모두 표시 (비용처리 포함)
    let displayContent = item.content || '';
    if (!isCompleted) {
        displayContent = item.code ? item.code : (item.content || '');
        if (item.itemCost) displayContent = `[${item.itemCost}] ${displayContent}`;

        if (item.scheduledDate) {
            const sameDayItems = data.maint.filter(i => i.scheduledDate === item.scheduledDate && i.type === item.type && (i.detailType || '') === (item.detailType || ''));
            if (sameDayItems.length > 0) {
                const contentArr = sameDayItems.map(i => {
                    const val = i.code ? i.code : i.content;
                    return i.itemCost ? `[${i.itemCost}] ${val}` : val;
                });
                displayContent = [...new Set(contentArr)].join(', ');
            }
        }
    }

    const contentEl = document.getElementById('detail-content');
    contentEl.dataset.rawContent = displayContent; // 원본 데이터 저장
    const itemsArr = displayContent.split(',').map(s => s.trim()).filter(s => s);
    if (itemsArr.length > 1) {
        contentEl.innerText = `${itemsArr[0]} 외 ${itemsArr.length - 1}개`;
        contentEl.title = itemsArr.join('\n');
    } else if (itemsArr.length === 1) {
        contentEl.innerText = itemsArr[0];
        contentEl.title = itemsArr[0];
    } else {
        contentEl.innerText = '내용 없음';
        contentEl.title = '';
    }

    const workerInput = document.getElementById('detail-worker');
    const mdInput = document.getElementById('detail-md');
    const memoInput = document.getElementById('detail-work-memo');
    const dateRow = document.getElementById('detail-date-row');
    const completeBtn = document.getElementById('btn-complete-work');
    const saveMemoBtn = document.getElementById('btn-save-detail-memo');
    const editContentBtn = document.getElementById('btn-edit-detail-content');
    const contentDiv = document.getElementById('detail-content');
    const contentInput = document.getElementById('detail-content-input');
    const cancelBtn = document.getElementById('btn-cancel-completion');

    // UI 초기화 (수정 모드 해제)
    if (contentDiv) contentDiv.style.display = 'block';
    if (contentInput) contentInput.style.display = 'none';
    if (editContentBtn) {
        editContentBtn.textContent = '수정';
        editContentBtn.classList.add('btn-blue');
        editContentBtn.classList.remove('btn-save-state');
    }

    // [추가] 드롭다운 래퍼가 있다면 제거 (초기화)
    const dropdownWrapper = document.getElementById('detail-content-dropdown-wrapper');
    if (dropdownWrapper) dropdownWrapper.remove();

    if (isCompleted) {
        workerInput.value = item.worker || '';
        workerInput.disabled = true;
        memoInput.value = item.memo || '';
        memoInput.disabled = true;
        if (mdInput) {
            mdInput.value = item.md || '';
            mdInput.disabled = true;
        }
        dateRow.style.display = 'block';
        document.getElementById('detail-scheduled-date').value = item.date || '';
        document.getElementById('detail-scheduled-date').disabled = true;
        completeBtn.style.display = 'none';
        saveMemoBtn.style.display = 'none';
        if (editContentBtn) editContentBtn.style.display = 'none';
        if (cancelBtn) {
            if (item.detailType === '일정변경') {
                cancelBtn.style.display = 'none'; // 일정 변경 이력은 완료 취소 불가
            } else {
                cancelBtn.style.display = 'block'; // 일반 완료 상태면 취소 버튼 표시
            }
        }
    } else {
        // [수정] 저장된 작업자(취소된 내용)가 있으면 우선 사용
        workerInput.value = item.worker || localStorage.getItem('lastWorkerName') || sessionStorage.getItem('userId') || '';
        workerInput.disabled = false;

        // [추가] 이전 점검 결과(메모) 불러오기
        let lastMemo = '';
        if (data.logs && data.logs.length > 0) {
            const validLogs = data.logs.filter(l => l.detailType !== '일정변경');
            const sortedLogs = [...validLogs].sort((a, b) => {
                if (b.date !== a.date) return b.date.localeCompare(a.date);
                return b.id - a.id;
            });
            if (sortedLogs.length > 0) lastMemo = sortedLogs[0].memo || '';
        }
        // [수정] 저장된 메모(취소된 내용)가 있으면 우선 사용, 없으면 이전 이력 메모 사용
        memoInput.value = item.memo || lastMemo;
        memoInput.disabled = false;
        if (mdInput) {
            let displayMd = item.md || '';
            // [추가] 같은 날짜에 묶인 항목 중 공수 데이터가 있는지 우선 검색 (그룹화 시 데이터 유실 방지)
            if (!displayMd && item.scheduledDate) {
                const sameDayItems = data.maint.filter(i => i.scheduledDate === item.scheduledDate && i.type === item.type && (i.detailType || '') === (item.detailType || ''));
                const itemWithMd = sameDayItems.find(i => i.md);
                if (itemWithMd) displayMd = itemWithMd.md;
            }
            mdInput.value = displayMd;
            mdInput.disabled = false;
        }

        dateRow.style.display = 'block';
        document.getElementById('detail-scheduled-date').value = item.scheduledDate || '';
        document.getElementById('detail-scheduled-date').disabled = false;

        completeBtn.style.display = 'block';
        completeBtn.textContent = '작업 완료';
        saveMemoBtn.style.display = 'none';
        if (editContentBtn) editContentBtn.style.display = 'block';
        if (cancelBtn) cancelBtn.style.display = 'none'; // 미완료 상태면 취소 버튼 숨김
    }

    modal.style.display = 'flex';
}

function toggleDetailContentEdit() {
    const contentDiv = document.getElementById('detail-content');
    const contentInput = document.getElementById('detail-content-input');
    const editBtn = document.getElementById('btn-edit-detail-content');
    const dropdownWrapperId = 'detail-content-dropdown-wrapper';
    let dropdownWrapper = document.getElementById(dropdownWrapperId);

    if (contentDiv.style.display !== 'none') {
        // [수정 모드 진입]
        if (!currentDetailTarget) return;
        const { site, equip, id, isCompleted } = currentDetailTarget;
        const key = `details_${site}_${equip}`;
        const data = JSON.parse(localStorage.getItem(key)) || {};
        let item = null;
        if (isCompleted) {
            item = data.logs ? data.logs.find(i => i.id == id) : null;
        } else {
            item = data.maint ? data.maint.find(i => i.id == id) : null;
        }

        if (!item) return;

        const type = item.type || '';
        const detailTypeFull = item.detailType || '';
        let detailType = detailTypeFull;
        let detailType2 = '';

        if (detailTypeFull.includes('[')) {
            const parts = detailTypeFull.split('[');
            detailType = parts[0].trim();
            detailType2 = parts[1].replace(']', '').trim();
        } else if (detailTypeFull.includes(' > ')) {
            const parts = detailTypeFull.split(' > ');
            detailType = parts[0].trim();
            detailType2 = parts[1].trim();
        }

        const currentContent = contentDiv.dataset.rawContent || contentDiv.innerText.trim();

        const currentValues = currentContent ? currentContent.split(',').map(s => s.trim()).filter(s => s) : [];
        const selectedMap = {};
        currentValues.forEach(val => {
            const match = val.match(/^\[(.*?)\] (.*)$/);
            if (match) {
                selectedMap[match[2]] = match[1];
            } else {
                selectedMap[val] = '유상';
            }
        });

        // 선택 가능한 항목 가져오기 (admin.js에서 설정한 값)
        const equipKey = equip; // "Name::Serial"
        const itemData = JSON.parse(localStorage.getItem('check_type_items')) || {};
        let chkKey;
        if (type === '비정기') {
            chkKey = `${equipKey}::${type}::${detailType}::${detailType2}`;
        } else {
            chkKey = `${equipKey}::${type}::${detailType}`;
        }
        let availableItems = itemData[chkKey] || [];
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

        if (availableItems.length === 0) {
            if (type === '비정기' && ['Alarm', 'Hunting', 'Data / Para 이상'].includes(detailType)) {
                const defaultList = [
                    "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 / 용자 이상",
                    "파트 이상 (교체)", "파트 이상 (수리)", "프로그램 이상", "단순조치", "기타"
                ];
                availableItems = defaultList.map(content => ({ content: content }));
            } else if (detailType === 'PM 점검' || detailType === 'BM 점검') {
                const equipName = equipKey.split('::')[0];
                let matchedItems = adminItems.filter(ai => {
                    if (!ai.equip) return false;
                    const equips = ai.equip.split(',').map(e => e.trim());
                    return equips.includes(equipName);
                });

                // [수정] 매칭되는 아이템이 없으면 전체 물품을 가져옴 (빈 리스트 방지)
                if (matchedItems.length === 0) {
                    matchedItems = adminItems;
                }
                availableItems = matchedItems.map(mItem => ({ content: mItem.part, code: mItem.code }));
            }
        }

        const uniqueItems = [];
        const seenContents = new Set();

        // [추가] 현재 선택된 항목을 무조건 첫 번째로 추가 (목록에서 사라지는 현상 방지)
        Object.keys(selectedMap).forEach(content => {
            let code = '';
            let realContent = content;
            const match = adminItems.find(a => a.part === content || a.code === content);
            if (match) {
                code = match.code || '';
                realContent = match.part || content;
            }

            const displayValue = code ? code : realContent;
            if (!seenContents.has(displayValue)) {
                seenContents.add(displayValue);
                uniqueItems.push({ content: realContent, code: code });
            }
        });

        availableItems.forEach(ai => {
            let code = ai.code;
            let realContent = ai.content;
            if (!code) {
                const match = adminItems.find(a => a.part === realContent);
                if (match && match.code) code = match.code;
            }
            const displayValue = code ? code : realContent;

            if (!seenContents.has(displayValue)) {
                seenContents.add(displayValue);
                uniqueItems.push({ content: realContent, code: code });
            }
        });

        // 세부구분이 있고, 항목 리스트가 존재하면 드롭다운 생성
        if (uniqueItems.length > 0 && detailType) {
            contentDiv.style.display = 'none';
            contentInput.style.display = 'none';

            // 매번 DOM을 새로 생성하여 DOM 노드 꼬임(렌더링 불가) 방지
            if (dropdownWrapper) {
                dropdownWrapper.remove();
            }
            dropdownWrapper = document.createElement('div');
            dropdownWrapper.id = dropdownWrapperId;
            dropdownWrapper.className = 'log-select-wrapper';

            const trigger = document.createElement('div');
            trigger.className = 'log-select-trigger';

            const actualValues = Object.keys(selectedMap);
            let initialText = '항목 선택';
            if (actualValues.length > 1) {
                initialText = `${actualValues[0]} 외 ${actualValues.length - 1}개`;
            } else if (actualValues.length === 1) {
                initialText = actualValues[0];
            }
            trigger.innerText = initialText;
            trigger.title = currentValues.join('\n');

            const dropdown = document.createElement('div');
            dropdown.className = 'log-select-dropdown';

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

            let poolItems = uniqueItems;
            if (detailType === 'PM 점검' || detailType === 'BM 점검') {
                const poolMap = new Map();
                uniqueItems.forEach(i => poolMap.set(i.content, i));
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
            const defaultSet = new Set(uniqueItems.map(i => i.code ? i.code : i.content));

            poolItems.forEach(item => {
                const val = item.code ? item.code : item.content;
                if (defaultSet.has(val) || defaultSet.has(item.content) || selectedMap.hasOwnProperty(val) || selectedMap.hasOwnProperty(item.content)) {
                    registeredItems.push(item);
                } else {
                    otherItems.push(item);
                }
            });

            let showAll = registeredItems.length === 0;

            const renderDropdownItems = (searchTerm = '') => {
                const currentSelections = { ...selectedMap };
                list.querySelectorAll('.log-select-item.selected').forEach(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    currentSelections[el.dataset.value] = cSel ? cSel.value : '유상';
                });

                let displayItems = showAll ? [...registeredItems, ...otherItems] : registeredItems;

                if (searchTerm) {
                    const kws = searchTerm.toLowerCase().split(/\s+/);
                    displayItems = [...registeredItems, ...otherItems].filter(item => {
                        const txt = `${item.content} ${item.code || ''}`.toLowerCase();
                        return kws.every(kw => txt.includes(kw));
                    });
                }

                list.innerHTML = displayItems.map(item => {
                    const val = item.code ? item.code : item.content;
                    const isSelected = currentSelections.hasOwnProperty(val) || currentSelections.hasOwnProperty(item.content);
                    const selClass = isSelected ? 'selected' : '';
                    const itemCost = isSelected ? (currentSelections[val] || currentSelections[item.content] || '유상') : '유상';

                    if (detailType === 'PM 점검' || detailType === 'BM 점검') {
                        return `<div class="log-select-item ${selClass}" data-value="${val}">
                                    <span style="flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${val}</span>
                                    <select class="item-cost-select input-dark" style="width: 85px; font-size: 11px; padding: 2px; margin-left: 5px; color: #e6edf3; color-scheme: dark;" onclick="event.stopPropagation()">
                                        <option value="유상" ${itemCost === '유상' ? 'selected' : ''}>유상</option>
                                        <option value="무상(보증)" ${itemCost === '무상(보증)' ? 'selected' : ''}>무상(보증)</option>
                                        <option value="무상(중고)" ${itemCost === '무상(중고)' ? 'selected' : ''}>무상(중고)</option>
                                        <option value="기타" ${itemCost === '기타' ? 'selected' : ''}>기타</option>
                                    </select>
                                </div>`;
                    } else {
                        return `<div class="log-select-item ${selClass}" data-value="${val}"><span>${val}</span></div>`;
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
                        trigger.innerText = `${values[0]} 외 ${values.length - 1}개`;
                    } else if (values.length === 1) {
                        trigger.innerText = values[0];
                    } else {
                        trigger.innerText = '항목 선택';
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
            addBtn.textContent = '선택 완료';
            addBtn.onclick = (e) => {
                e.stopPropagation();
                dropdown.classList.remove('show');
            };
            footer.appendChild(addBtn);
            if (type === '비정기' && detailType !== 'BM 점검') {
                footer.style.display = 'none';
            }
            dropdown.appendChild(footer);

            dropdownWrapper.appendChild(trigger);
            dropdownWrapper.appendChild(dropdown);

            trigger.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => {
                    if (d !== dropdown) d.classList.remove('show');
                });
                dropdown.classList.toggle('show');
            };

            contentInput.parentNode.insertBefore(dropdownWrapper, contentInput.nextSibling);
        } else {
            // 그 외 타입은 텍스트 입력
            contentInput.value = currentContent;
            contentDiv.style.display = 'none';
            contentInput.style.display = 'block';
            contentInput.focus();
        }
        editBtn.textContent = '저장';
        editBtn.classList.remove('btn-blue');
        editBtn.classList.add('btn-save-state');
    } else {
        // 저장 처리
        let isDropdownMode = false;
        let dropdownValues = [];

        if (dropdownWrapper) {
            const list = dropdownWrapper.querySelector('.log-select-list');
            const selected = list.querySelectorAll('.log-select-item.selected');
            dropdownValues = Array.from(selected).map(el => {
                const cSel = el.querySelector('.item-cost-select');
                return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
            });
            isDropdownMode = true;
            dropdownWrapper.remove();
        }

        const newContent = isDropdownMode ? dropdownValues.join(', ') : contentInput.value.trim();
        if (!newContent && !isDropdownMode) return alert('내용을 입력해주세요.');
        if (isDropdownMode && dropdownValues.length === 0) return alert('최소 1개 이상의 항목을 선택해주세요.');

        if (currentDetailTarget) {
            const { site, equip, id, isCompleted } = currentDetailTarget;
            const key = `details_${site}_${equip}`;
            let data = JSON.parse(localStorage.getItem(key)) || {};

            if (isCompleted && data.logs) {
                // 이미 완료된 로그 수정
                const item = data.logs.find(i => i.id == id);
                if (item) {
                    item.content = newContent;
                    contentDiv.dataset.rawContent = newContent;
                    const arr = newContent.split(',').map(s => s.trim()).filter(s => s);
                    contentDiv.innerText = arr.length > 1 ? `${arr[0]} 외 ${arr.length - 1}개` : (arr[0] || '내용 없음');
                    contentDiv.title = arr.join('\n');
                }
            } else if (!isCompleted && data.maint) {
                // 예정된 유지관리(maint) 항목 수정
                const item = data.maint.find(i => i.id === id);
                if (item) {
                    if (isDropdownMode && item.scheduledDate) {
                        const targetDate = item.scheduledDate;
                        const itemType = item.type;
                        const itemDetailType = item.detailType || '';

                        let remainingIds = [];
                        const sameDayItems = data.maint.filter(m => m.scheduledDate === targetDate && m.type === itemType && (m.detailType || '') === itemDetailType);
                        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

                        dropdownValues.forEach((val, idx) => {
                            let itemCost = '';
                            const costMatch = val.match(/^\[(.*?)\] (.*)$/);
                            if (costMatch) {
                                itemCost = costMatch[1];
                                val = costMatch[2];
                            }

                            let code = '';
                            let fullContent = val;
                            const match = adminItems.find(a => a.part === val || a.code === val);
                            if (match) {
                                code = match.code || '';
                                fullContent = match.part || val;
                            }

                            // sameDayItems 뿐만 아니라 maint 전체에서 중복 확인
                            let existing = data.maint.find(m => m.type === itemType && (m.content === fullContent || (code && m.code === code) || m.content === val));

                            if (existing) {
                                const oldDate = existing.scheduledDate;
                                existing.scheduledDate = targetDate;
                                existing.detailType = itemDetailType;
                                if (!existing.worker) existing.worker = item.worker || '';
                                if (!existing.memo) existing.memo = item.memo || '';
                                if (!existing.md) existing.md = item.md || '';
                                if (!existing.costType) existing.costType = item.costType || '';
                                if (itemCost) existing.itemCost = itemCost;
                                remainingIds.push(existing.id);

                                const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
                                const newMonth = targetDate.substring(0, 7);
                                if (oldMonth !== newMonth) {
                                    if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, targetDate, 1);
                                }
                            } else {
                                const newId = Date.now() + idx;
                                data.maint.push({
                                    id: newId,
                                    type: itemType,
                                    detailType: itemDetailType,
                                    code: code,
                                    content: fullContent,
                                    date: "",
                                    period: null,
                                    scheduledDate: targetDate,
                                    costType: item.costType || '',
                                    worker: item.worker || '',
                                    memo: item.memo || '',
                                    md: item.md || '',
                                    itemCost: itemCost
                                });
                                remainingIds.push(newId);
                                if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, targetDate, 1);
                            }
                        });

                        // 수정 모드에서 선택 해제된(제외된) 항목들은 리스트에서 완전히 삭제하지 않고 예정일만 제거
                        sameDayItems.forEach(m => {
                            if (!remainingIds.includes(m.id)) {
                                delete m.scheduledDate;
                            }
                        });

                        if (remainingIds.length > 0) {
                            currentDetailTarget.id = remainingIds[0];
                        }

                        contentDiv.dataset.rawContent = dropdownValues.join(', ');
                        contentDiv.innerText = dropdownValues.length > 1 ? `${dropdownValues[0]} 외 ${dropdownValues.length - 1}개` : (dropdownValues[0] || '내용 없음');
                        contentDiv.title = dropdownValues.join('\n');
                    } else {
                        item.content = newContent;
                        contentDiv.dataset.rawContent = newContent;
                        const arr = newContent.split(',').map(s => s.trim()).filter(s => s);
                        contentDiv.innerText = arr.length > 1 ? `${arr[0]} 외 ${arr.length - 1}개` : (arr[0] || '내용 없음');
                        contentDiv.title = arr.join('\n');
                    }
                }
            }

            localStorage.setItem(key, JSON.stringify(data));

            // UI 업데이트
            contentDiv.style.display = 'block';
            contentInput.style.display = 'none';
            editBtn.textContent = '수정';
            editBtn.classList.add('btn-blue');
            editBtn.classList.remove('btn-save-state');

            // 캘린더 갱신
            renderCalendar();
            if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();

            alert('수정되었습니다.');

            // [추가] 캘린더 팝업 내용 갱신
            const popup = document.getElementById('calendar-popup');
            if (popup && popup.style.display !== 'none') {
                const dateTitle = document.getElementById('popup-date-title');
                if (dateTitle) {
                    const dateStr = dateTitle.textContent;
                    const allEvents = typeof getScheduleForCalendar === 'function' ? getScheduleForCalendar() : {};
                    let dayEvents = allEvents[dateStr] || [];
                    if (typeof openCalendarPopup === 'function') openCalendarPopup(dateStr, dayEvents);
                }
            }
        }
    }
}

function updateScheduleDateFromDetail() {
    if (!currentDetailTarget || currentDetailTarget.isCompleted) return;

    const newDate = document.getElementById('detail-scheduled-date').value;
    if (!newDate) return alert('날짜를 선택해주세요.');

    const success = setScheduleDate(currentDetailTarget.site, currentDetailTarget.equip, currentDetailTarget.id, newDate);
    if (success === false) {
        const key = `details_${currentDetailTarget.site}_${currentDetailTarget.equip}`;
        const data = JSON.parse(localStorage.getItem(key)) || {};
        const item = data.maint ? data.maint.find(i => i.id === currentDetailTarget.id) : null;
        if (item && item.scheduledDate) {
            document.getElementById('detail-scheduled-date').value = item.scheduledDate;
        }
        return;
    }
    renderCalendar();
    if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();

    // [추가] 캘린더 팝업이 열려있다면 내용 갱신 (변경된 항목 제거)
    const popup = document.getElementById('calendar-popup');
    if (popup && popup.style.display !== 'none') {
        const dateTitle = document.getElementById('popup-date-title');
        if (dateTitle) {
            const dateStr = dateTitle.textContent;
            const allEvents = getScheduleForCalendar();
            let dayEvents = allEvents[dateStr] || [];

            // 필터 재적용
            const searchInput = document.getElementById('calendar-search');
            const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

            if (keyword || currentSearchFilters.site || currentSearchFilters.equip) {
                dayEvents = dayEvents.filter(event => {
                    const matchKeyword = !keyword || ((event.site && event.site.toLowerCase().includes(keyword)) || (event.equip && event.equip.toLowerCase().includes(keyword)) || (event.content && event.content.toLowerCase().includes(keyword)));
                    const matchSite = !currentSearchFilters.site || event.site === currentSearchFilters.site;
                    const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip || event.equip.split('::')[0] === currentSearchFilters.equip;
                    return matchKeyword && matchSite && matchEquip;
                });
            }

            openCalendarPopup(dateStr, dayEvents);
        }
    }
}

function completeScheduleWork() {
    if (!currentDetailTarget || currentDetailTarget.isCompleted) return;

    // [추가] 점검 항목 수정 중인지 확인 (저장 버튼이 활성화된 상태)
    const editContentBtn = document.getElementById('btn-edit-detail-content');
    if (editContentBtn && editContentBtn.textContent === '저장') {
        return alert('점검 항목 수정 중입니다. 먼저 저장해주세요.');
    }

    const worker = document.getElementById('detail-worker').value.trim();
    const mdInput = document.getElementById('detail-md');
    const md = mdInput ? mdInput.value.trim() : '';
    const memo = document.getElementById('detail-work-memo').value.trim();

    if (!worker) return alert('작업자를 입력해주세요.');
    if (!md) return alert('공수(M/D)를 입력해주세요.');
    if (!memo) return alert('점검 결과 / 메모를 입력해주세요.');

    // [추가] 작업 완료 전 확인 팝업
    if (!confirm('해당 작업을 완료 처리하시겠습니까?')) return;

    localStorage.setItem('lastWorkerName', worker);

    const { site, equip, id } = currentDetailTarget;
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};

    const maintItem = data.maint ? data.maint.find(i => i.id == id) : null;
    if (!maintItem) return;

    if (!data.logs) data.logs = [];

    // [수정] 같은 날짜, 같은 타입, 세부구분의 모든 항목 완료 처리 (비용처리 포함하여 로그에 기록)
    const sameDayItems = data.maint.filter(i => i.scheduledDate === maintItem.scheduledDate && i.type === maintItem.type && (i.detailType || '') === (maintItem.detailType || ''));
    const contentArr = sameDayItems.map(i => {
        const val = i.code ? i.code : i.content;
        return i.itemCost ? `[${i.itemCost}] ${val}` : val;
    });
    const combinedContent = [...new Set(contentArr)].join(', ');
    const completeDate = maintItem.scheduledDate || new Date().toISOString().split('T')[0];

    data.logs.push({
        id: Date.now(),
        date: completeDate,
        type: maintItem.type || '정기',
        detailType: maintItem.detailType || '',
        detailType2: '',
        content: combinedContent,
        costType: maintItem.costType || '',
        md: md,
        worker: worker,
        memo: memo
    });

    sameDayItems.forEach(i => {
        delete i.scheduledDate;
        delete i.worker;
        delete i.memo;
        delete i.costType;
        delete i.md;
        if (i.type === '정기' || i.type === '비정기') {
            i.date = completeDate;
        }
    });

    // [추가] 일회성 작업(고객대응, 용액제조 등)은 완료 후 maint 배열에서 완전히 제거하여 데이터 누적 방지
    data.maint = data.maint.filter(i => {
        const isCompletedItem = sameDayItems.some(s => s.id === i.id);
        if (isCompletedItem && i.type !== '정기' && i.type !== '비정기') return false;
        return true;
    });

    localStorage.setItem(key, JSON.stringify(data));

    if (typeof addSystemLog === 'function') {
        addSystemLog('COMPLETE_SCHEDULE', equip, `Content: ${combinedContent}`);
    }

    document.getElementById('event-detail-modal').style.display = 'none';

    // [추가] 완료 후 다음 예정일 등록 모달 띄우기
    const remainingIds = data.maint.filter(i => sameDayItems.some(s => s.id === i.id)).map(i => i.id);

    if (remainingIds.length > 0) {
        const remainingItems = data.maint.filter(i => remainingIds.includes(i.id));
        currentNextScheduleTarget = { site, equip, items: remainingItems, completeDate: completeDate };

        const nextModal = document.getElementById('next-schedule-modal');
        if (nextModal) {
            const listContainer = document.getElementById('next-schedule-list-container');
            if (listContainer) {
                listContainer.innerHTML = '';
                remainingItems.forEach(item => {
                    let defaultNextDate = '';
                    const period = parseInt(item.period) || 0;
                    if (period > 0) {
                        const dateObj = new Date(completeDate);
                        dateObj.setDate(dateObj.getDate() + period);
                        defaultNextDate = dateObj.toISOString().split('T')[0];
                    }

                    const div = document.createElement('div');
                    div.style.marginBottom = '10px';
                    div.style.padding = '10px';
                    div.style.backgroundColor = '#21262d';
                    div.style.borderRadius = '4px';
                    div.style.border = '1px solid #30363d';

                    const itemName = item.code ? item.code : item.content;

                    div.innerHTML = `
                        <div style="font-weight: bold; margin-bottom: 8px; color: #58a6ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(itemName)}</div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
                                <label class="form-label" style="width: 45px; margin-bottom: 0; flex-shrink: 0; text-align: left; font-size: 14px; color: #8b949e;">예정일</label>
                                <input type="date" class="input-date-dark next-date-input" data-id="${item.id}" value="${defaultNextDate}" min="${completeDate}" style="flex: 1; min-width: 0; padding: 4px; font-size: 14px;">
                            </div>
                            <div style="display: flex; align-items: center; flex: 0.6; min-width: 0;">
                                <label class="form-label" style="width: 35px; margin-bottom: 0; flex-shrink: 0; text-align: left; font-size: 14px; color: #8b949e;">공수</label>
                                <input type="number" class="input-dark next-md-input" data-id="${item.id}" value="${item.md || md}" placeholder="M/D" min="0" style="flex: 1; min-width: 0; padding: 4px; font-size: 14px;">
                            </div>
                        </div>
                    `;
                    listContainer.appendChild(div);
                });
            }
            nextModal.style.display = 'flex';
        } else {
            alert('작업이 완료되었습니다.');
            window.refreshCalendarPopupAfterCompletion();
        }
    } else {
        alert('작업이 완료되었습니다.');
        window.refreshCalendarPopupAfterCompletion();
    }
}

function setupNextScheduleModal() {
    const modal = document.getElementById('next-schedule-modal');
    const skipBtn = document.getElementById('btn-skip-next-schedule');
    const saveBtn = document.getElementById('btn-save-next-schedule');

    if (!modal) return;

    if (skipBtn) {
        skipBtn.onclick = () => {
            modal.style.display = 'none';
            window.refreshCalendarPopupAfterCompletion();
        };
    }

    if (saveBtn) {
        saveBtn.onclick = () => {
            if (!currentNextScheduleTarget) return;

            const { site, equip, items, completeDate } = currentNextScheduleTarget;
            const key = `details_${site}_${equip}`;
            let data = JSON.parse(localStorage.getItem(key)) || {};
            let isUpdated = false;

            if (data.maint) {
                const listContainer = document.getElementById('next-schedule-list-container');
                const dateInputs = listContainer.querySelectorAll('.next-date-input');
                const mdInputs = listContainer.querySelectorAll('.next-md-input');

                let hasError = false;

                for (let i = 0; i < dateInputs.length; i++) {
                    const dateInput = dateInputs[i];
                    const mdInput = mdInputs[i];
                    const id = parseInt(dateInput.dataset.id);
                    const newDate = dateInput.value;
                    const newMd = mdInput.value.trim();

                    if (newDate) {
                        if (dateInput.min && newDate < dateInput.min) {
                            alert('다음 예정일은 이전 작업일 이후 날짜로 선택해주세요.');
                            hasError = true;
                            break;
                        }

                        const item = data.maint.find(i => i.id === id);
                        if (item) {
                            const oldDate = item.scheduledDate;
                            item.scheduledDate = newDate;
                            if (newMd) item.md = newMd;

                            const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
                            const newMonth = newDate.substring(0, 7);
                            if (oldMonth !== newMonth) {
                                if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, newDate, 1);
                            }
                            isUpdated = true;

                            if (typeof addSystemLog === 'function') {
                                addSystemLog('ADD_SCHEDULE', equip, `Date: ${newDate}, Content: ${item.content}, Next Schedule`);
                            }
                        }
                    }
                }

                if (hasError) return;

                if (isUpdated) {
                    localStorage.setItem(key, JSON.stringify(data));
                }
            }

            modal.style.display = 'none';
            alert('작업 완료 및 다음 예정일 처리가 완료되었습니다.');
            window.refreshCalendarPopupAfterCompletion();
        };
    }
}

window.refreshCalendarPopupAfterCompletion = function () {
    renderCalendar();
    if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();

    const popup = document.getElementById('calendar-popup');
    if (popup && popup.style.display !== 'none') {
        const dateTitle = document.getElementById('popup-date-title');
        if (dateTitle) {
            const dateStr = dateTitle.textContent;
            const allEvents = getScheduleForCalendar();
            let dayEvents = allEvents[dateStr] || [];

            const searchInput = document.getElementById('calendar-search');
            const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

            if (keyword || currentSearchFilters.site || currentSearchFilters.equip) {
                dayEvents = dayEvents.filter(event => {
                    const matchKeyword = !keyword || ((event.site && event.site.toLowerCase().includes(keyword)) || (event.equip && event.equip.toLowerCase().includes(keyword)) || (event.content && event.content.toLowerCase().includes(keyword)));
                    const matchSite = !currentSearchFilters.site || event.site === currentSearchFilters.site;
                    const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip || event.equip.split('::')[0] === currentSearchFilters.equip;
                    return matchKeyword && matchSite && matchEquip;
                });
            }

            openCalendarPopup(dateStr, dayEvents);
        }
    }
};

function cancelScheduleCompletion() {
    if (!currentDetailTarget || !currentDetailTarget.isCompleted) return;

    if (!confirm('작업 완료를 취소하고 예정 상태로 되돌리시겠습니까?')) return;

    const { site, equip, id } = currentDetailTarget;
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};

    if (!data.logs) return;

    // 로그에서 해당 항목 찾기
    const logIndex = data.logs.findIndex(l => l.id == id);
    if (logIndex === -1) return;

    const logItem = data.logs[logIndex];
    const logContent = logItem.content;
    const logType = logItem.type;
    const logDate = logItem.date;

    // [추가] 값 복구를 위해 저장
    const recoveredWorker = logItem.worker || '';
    const recoveredMd = logItem.md || '';
    const recoveredMemo = logItem.memo || '';

    // 1. 로그 삭제
    data.logs.splice(logIndex, 1);

    // 2. 예정 일정(maint) 복구
    // 로그 내용은 콤마로 구분되어 있을 수 있으므로 분리하여 처리
    const contents = logContent.split(',').map(s => s.trim());

    if (!data.maint) data.maint = [];

    let recoveredMaintId = null; // 복구된 메인 ID 추적

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    contents.forEach((itemText, idx) => {
        let itemCost = '';
        const costMatch = itemText.match(/^\[(.*?)\] (.*)$/);
        if (costMatch) {
            itemCost = costMatch[1];
            itemText = costMatch[2];
        }

        let code = '';
        let fullContent = itemText;

        const match = adminItems.find(a => a.part === itemText || a.code === itemText);
        if (match) {
            code = match.code || '';
            fullContent = match.part || itemText;
        }

        let existingItem = data.maint.find(m => m.type === logType && (m.content === fullContent || (code && m.code === code) || m.content === itemText));


        if (existingItem) {
            existingItem.scheduledDate = logDate;
            // [추가] 취소 시 입력했던 내용 복구 저장
            existingItem.worker = recoveredWorker;
            existingItem.md = recoveredMd;
            existingItem.memo = recoveredMemo;
            existingItem.costType = logItem.costType || '';
            if (itemCost) existingItem.itemCost = itemCost;
            if (idx === 0) recoveredMaintId = existingItem.id;
        } else {
            // 일회성 항목 등으로 인해 maint에서 삭제된 경우 재생성
            const newId = Date.now() + idx;
            data.maint.push({
                id: newId,
                type: logType,
                detailType: logItem.detailType || '',
                code: code,
                content: fullContent,
                date: "", // 수행되지 않은 상태로 초기화
                period: (logType === '정기' && match) ? match.cycle : null,
                scheduledDate: logDate,
                costType: logItem.costType || '',
                worker: recoveredWorker, // [추가]
                md: recoveredMd,         // [추가]
                memo: recoveredMemo,     // [추가]
                itemCost: itemCost
            });
            if (idx === 0) recoveredMaintId = newId;
        }
    });

    localStorage.setItem(key, JSON.stringify(data));

    if (typeof addSystemLog === 'function') {
        addSystemLog('CANCEL_COMPLETION', equip, `Reverted: ${logContent}`);
    }

    alert('작업 완료가 취소되었습니다.');
    // document.getElementById('event-detail-modal').style.display = 'none'; // [수정] 팝업 닫지 않음

    // 배경 데이터 및 캘린더 갱신
    renderCalendar();
    if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();

    // [추가] 캘린더 팝업(예정 목록)이 열려있다면 내용 갱신
    const popup = document.getElementById('calendar-popup');
    if (popup && popup.style.display !== 'none') {
        const dateTitle = document.getElementById('popup-date-title');
        if (dateTitle) {
            const dateStr = dateTitle.textContent;
            const allEvents = getScheduleForCalendar();
            let dayEvents = allEvents[dateStr] || [];

            // 필터 재적용
            const searchInput = document.getElementById('calendar-search');
            const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

            if (keyword || currentSearchFilters.site || currentSearchFilters.equip) {
                dayEvents = dayEvents.filter(event => {
                    const matchKeyword = !keyword || ((event.site && event.site.toLowerCase().includes(keyword)) || (event.equip && event.equip.toLowerCase().includes(keyword)) || (event.content && event.content.toLowerCase().includes(keyword)));
                    const matchSite = !currentSearchFilters.site || event.site === currentSearchFilters.site;
                    const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip || event.equip.split('::')[0] === currentSearchFilters.equip;
                    return matchKeyword && matchSite && matchEquip;
                });
            }

            openCalendarPopup(dateStr, dayEvents);
        }
    }

    // [추가] 모달 UI 상태를 '예정(미완료)' 상태로 변경 및 값 복구
    currentDetailTarget.isCompleted = false;
    if (recoveredMaintId) currentDetailTarget.id = recoveredMaintId;

    const workerInput = document.getElementById('detail-worker');
    const mdInput = document.getElementById('detail-md');
    const memoInput = document.getElementById('detail-work-memo');
    const dateInput = document.getElementById('detail-scheduled-date');
    const completeBtn = document.getElementById('btn-complete-work');
    const cancelBtn = document.getElementById('btn-cancel-completion');
    const saveMemoBtn = document.getElementById('btn-save-detail-memo');
    const editContentBtn = document.getElementById('btn-edit-detail-content');

    if (workerInput) {
        workerInput.disabled = false;
        workerInput.value = recoveredWorker; // 기존 값 복구
    }
    if (mdInput) {
        mdInput.disabled = false;
        mdInput.value = recoveredMd; // 기존 값 복구
    }
    if (memoInput) {
        memoInput.disabled = false;
        memoInput.value = recoveredMemo; // 기존 값 복구
    }
    if (dateInput) {
        dateInput.disabled = false;
        dateInput.value = logDate; // 완료일 -> 예정일로 설정
    }

    if (completeBtn) {
        completeBtn.style.display = 'block';
        completeBtn.textContent = '작업 완료';
    }
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (saveMemoBtn) saveMemoBtn.style.display = 'none';
    if (editContentBtn) editContentBtn.style.display = 'block';
}

/* ==========================================================================
   [7] 모달: 작업 예정일 등록 (Register Schedule Modal)
   ========================================================================== */

function setupRegisterScheduleModal() {
    const modal = document.getElementById('register-schedule-modal');
    const closeBtn = document.getElementById('btn-close-register-modal');
    const confirmBtn = document.getElementById('btn-confirm-register-schedule');
    const siteSelect = document.getElementById('register-site-select');
    const equipSelect = document.getElementById('register-equip-select');
    const typeSelect = document.getElementById('register-type-select');
    const detailTypeSelect = document.getElementById('register-detail-type-select');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateRegisterEquipSelect(siteSelect.value);
        };
    }

    if (equipSelect) {
        equipSelect.onchange = () => {
            if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
        };
    }

    if (typeSelect) {
        typeSelect.onchange = () => {
            if (typeof updateRegisterDetailTypeOptions === 'function') updateRegisterDetailTypeOptions();
        };
    }

    if (detailTypeSelect) {
        detailTypeSelect.onchange = () => {
            const typeVal = typeSelect ? typeSelect.value : '';
            if (typeVal === '비정기' && typeof updateRegisterDetailType2Options === 'function') {
                updateRegisterDetailType2Options();
            } else if (typeof updateRegisterContentOptions === 'function') {
                updateRegisterContentOptions();
            }
        };
    }

    const detailType2Select = document.getElementById('register-detail-type2-select');
    if (detailType2Select) {
        detailType2Select.onchange = () => {
            if (typeof updateRegisterContentOptions === 'function') updateRegisterContentOptions();
        };
    }

    if (confirmBtn) {
        confirmBtn.onclick = confirmRegisterSchedule;
    }

    const rTrigger = document.getElementById('register-content-trigger');
    const rDropdown = document.getElementById('register-content-dropdown');
    if (rTrigger && rDropdown) rTrigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== rDropdown) d.classList.remove('show'); });
        rDropdown.classList.toggle('show');
    };
    const btnAdd = document.getElementById('btn-register-content-add');
    if (btnAdd && rDropdown) btnAdd.addEventListener('click', () => rDropdown.classList.remove('show'));

    window.updateRegisterInputStates = function () {
        const modal = document.getElementById('register-schedule-modal');
        if (!modal) return;
        const inputs = modal.querySelectorAll('input:not(#register-content-search), select');
        inputs.forEach(el => {
            const checkValue = () => {
                if (el.value) {
                    el.classList.add('has-value');
                    el.classList.remove('error-border');
                } else {
                    el.classList.remove('has-value');
                }
            };
            el.removeEventListener('input', checkValue);
            el.removeEventListener('change', checkValue);
            el.addEventListener('input', checkValue);
            el.addEventListener('change', checkValue);
            checkValue();
        });
    };

    window.updateRegisterInputStates();
}

function openRegisterScheduleModal(dateStr) {
    const modal = document.getElementById('register-schedule-modal');
    const dateDisplay = document.getElementById('register-date-display');
    const siteSelect = document.getElementById('register-site-select');
    const equipSelect = document.getElementById('register-equip-select');
    const typeSelect = document.getElementById('register-type-select');

    if (!modal) return;

    if (dateDisplay) dateDisplay.value = dateStr;

    const data = getDeviceDataMap();
    const mdInput = document.getElementById('register-md');
    if (mdInput) mdInput.value = '';

    siteSelect.innerHTML = '<option value="">사업장 선택</option>';
    Object.keys(data).forEach(site => {
        const option = document.createElement('option');
        option.value = site;
        option.textContent = site;
        siteSelect.appendChild(option);
    });

    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = true;

    // [추가] 현재 검색 필터가 적용되어 있다면 해당 사업장/장비 자동 선택
    if (currentSearchFilters.site) {
        siteSelect.value = currentSearchFilters.site;
        // 사업장이 선택되었으므로 장비 목록 업데이트
        updateRegisterEquipSelect(currentSearchFilters.site);

        if (currentSearchFilters.equip) {
            // 장비 필터가 있다면 해당 장비 선택 시도
            let targetValue = currentSearchFilters.equip;
            let hasOption = Array.from(equipSelect.options).some(opt => opt.value === targetValue);

            // 정확한 매칭이 없으면 모델명만으로 매칭 시도 (필터는 모델명, 옵션은 모델명::Serial인 경우)
            if (!hasOption) {
                const partialMatch = Array.from(equipSelect.options).find(opt => opt.value.split('::')[0] === targetValue);
                if (partialMatch) {
                    targetValue = partialMatch.value;
                    hasOption = true;
                }
            }

            if (hasOption) {
                equipSelect.value = targetValue;
            }
        }
    }

    if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();

    modal.style.display = 'flex';

    setTimeout(() => {
        if (typeof window.updateRegisterInputStates === 'function') window.updateRegisterInputStates();
    }, 50);
}

function updateRegisterEquipSelect(site) {
    const equipSelect = document.getElementById('register-equip-select');

    equipSelect.innerHTML = '<option value="">장비 선택</option>';

    if (!site) {
        equipSelect.disabled = true;
        return;
    }

    const data = getDeviceDataMap();
    const equips = data[site] || [];

    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        option.textContent = parts.length > 1 ? `${parts[0]} (${parts[1]})` : parts[0];
        equipSelect.appendChild(option);
    });

    equipSelect.disabled = false;
    if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
}

function confirmRegisterSchedule() {
    const dateStr = document.getElementById('register-date-display').value;
    const site = document.getElementById('register-site-select').value;
    const equip = document.getElementById('register-equip-select').value;
    const typeSelect = document.getElementById('register-type-select');
    const type = typeSelect ? typeSelect.value : '';
    const detailTypeSelect = document.getElementById('register-detail-type-select');
    const detailType = detailTypeSelect ? detailTypeSelect.value : '';
    const detailType2Select = document.getElementById('register-detail-type2-select');
    const detailType2 = detailType2Select && detailType2Select.style.display !== 'none' ? detailType2Select.value : '';
    const costTypeSelect = document.getElementById('register-cost-type');
    const costType = costTypeSelect ? costTypeSelect.value : '';
    const mdInput = document.getElementById('register-md');
    const md = mdInput ? mdInput.value.trim() : '';

    let lastProcessedId = null; // [추가] 등록된 작업 ID 추적

    let hasError = false;
    const checkField = (id) => {
        const el = document.getElementById(id);
        if (el && !el.disabled && (!el.value || el.value.trim() === '')) {
            el.classList.add('error-border');
            hasError = true;
        }
    };

    checkField('register-date-display');
    checkField('register-site-select');
    checkField('register-equip-select');
    checkField('register-type-select');

    if (detailTypeSelect && !detailTypeSelect.disabled && !detailType) {
        detailTypeSelect.classList.add('error-border');
        hasError = true;
    }
    if (type === '비정기' && detailType2Select && !detailType2Select.disabled && !detailType2) {
        detailType2Select.classList.add('error-border');
        hasError = true;
    }
    checkField('register-cost-type');
    checkField('register-md');

    if (md && parseFloat(md) < 0) {
        alert('공수(M/D)는 0 이상이어야 합니다.');
        return;
    }

    let content = '';
    const wrapper = document.getElementById('register-content-wrapper');
    if (wrapper && wrapper.style.display !== 'none') {
        const selected = document.querySelectorAll('#register-content-list .log-select-item.selected');
        content = Array.from(selected).map(el => {
            const costSelect = el.querySelector('.item-cost-select');
            return costSelect ? `[${costSelect.value}] ${el.dataset.value}` : el.dataset.value;
        }).join(', ');
        if (!content) {
            const trigger = document.getElementById('register-content-trigger');
            if (trigger) trigger.classList.add('error-border');
            hasError = true;
        }
    } else {
        const input = document.getElementById('register-content-input');
        if (input && !input.disabled && !input.value.trim()) {
            input.classList.add('error-border');
            hasError = true;
        } else if (input) {
            content = input.value.trim();
        }
    }

    if (hasError) return alert('빨간색 테두리로 표시된 필수 항목을 모두 입력/선택해주세요.');

    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [] };
    if (!data.maint) data.maint = [];

    const itemsList = content.split(', ').map(s => s.trim()).filter(s => s);
    const finalDetailType = (type === '비정기' && detailType2) ? `${detailType} > ${detailType2}` : detailType;

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    itemsList.forEach((itemText, idx) => {
        let itemCost = '';
        const costMatch = itemText.match(/^\[(.*?)\] (.*)$/);
        if (costMatch) {
            itemCost = costMatch[1];
            itemText = costMatch[2];
        }

        let code = '';
        let fullContent = itemText;
        let period = null;

        const match = adminItems.find(a => a.part === itemText || a.code === itemText);
        if (match) {
            code = match.code || '';
            fullContent = match.part || itemText;
            period = match.cycle || null;
        }

        let existingItem = data.maint.find(m => m.type === type && (m.content === fullContent || (code && m.code === code) || m.content === itemText));

        if (existingItem) {
            const oldDate = existingItem.scheduledDate;
            existingItem.scheduledDate = dateStr;
            existingItem.detailType = finalDetailType;
            if (costType) existingItem.costType = costType;
            existingItem.md = md;
            if (itemCost) existingItem.itemCost = itemCost;
            if (idx === 0) lastProcessedId = existingItem.id;

            const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
            const newMonth = dateStr.substring(0, 7);
            if (oldMonth !== newMonth) {
                if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
            }
        } else {
            const newItem = {
                id: Date.now() + idx,
                type: type,
                detailType: finalDetailType,
                code: code,
                content: fullContent,
                date: "",
                period: (type === '정기') ? period : null,
                scheduledDate: dateStr,
                costType: costType,
                md: md,
                itemCost: itemCost
            };
            if (idx === 0) lastProcessedId = newItem.id;
            data.maint.push(newItem);

            if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
        }
    });

    localStorage.setItem(key, JSON.stringify(data));

    if (typeof addSystemLog === 'function') {
        addSystemLog('ADD_SCHEDULE', equip, `Date: ${dateStr}, Type: ${type}, Content: ${content}`);
    }

    alert('일정이 등록되었습니다.');
    document.getElementById('register-schedule-modal').style.display = 'none';

    if (costTypeSelect) costTypeSelect.value = '';

    renderCalendar();
    if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
    const popup = document.getElementById('calendar-popup');
    if (popup) popup.style.display = 'none';

    // [추가] 모바일 작업 등록 플로우: 등록 후 바로 상세 팝업 오픈
    if (window.isMobileRegisterFlow && lastProcessedId) {
        window.isMobileRegisterFlow = false;
        setTimeout(() => {
            openEventDetailModal(site, equip, lastProcessedId, false);
        }, 100);
    }
}

// [추가] 팝업 연동을 위한 함수
window.updateRegisterTypeOptions = function () {
    const rTypeSelect = document.getElementById('register-type-select');
    if (!rTypeSelect) return;
    const categories = ['정기', '비정기', '고객대응', '용액제조', '온라인점검'];
    const currentVal = rTypeSelect.value;

    rTypeSelect.innerHTML = '<option value="">선택</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        rTypeSelect.appendChild(opt);
    });
    if (currentVal && categories.includes(currentVal)) rTypeSelect.value = currentVal;
    updateRegisterDetailTypeOptions();
};

window.updateRegisterDetailTypeOptions = function () {
    const rEquipSelect = document.getElementById('register-equip-select');
    const rTypeSelect = document.getElementById('register-type-select');
    const rDetailTypeSelect = document.getElementById('register-detail-type-select');
    const rDetailType2Select = document.getElementById('register-detail-type2-select');

    if (!rTypeSelect || !rDetailTypeSelect) return;
    const type = rTypeSelect.value;
    rDetailTypeSelect.innerHTML = '';

    if (!type) {
        rDetailTypeSelect.innerHTML = '<option value="">구분 먼저 선택</option>';
        rDetailTypeSelect.disabled = true;
        if (rDetailType2Select) {
            rDetailType2Select.style.display = 'none';
            rDetailType2Select.value = '';
        }
        updateRegisterContentOptions();
        return;
    }

    rDetailTypeSelect.disabled = false;

    if (rDetailType2Select) {
        if (type === '비정기') {
            rDetailType2Select.style.display = 'inline-block';
        } else {
            rDetailType2Select.style.display = 'none';
            rDetailType2Select.value = '';
        }
    }

    const equipKey = rEquipSelect ? rEquipSelect.value : '';
    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    const key = `${equipKey}::${type}`;
    const defaultSubCategories = {
        '정기': ['PM 점검'],
        '비정기': ['BM 점검', 'Alarm', 'Hunting', 'Data / Para 이상'],
        '고객대응': ['순회 점검', '프로그램 변경 / 평가', '설비 평가', 'Parts 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '기타'],
        '용액제조': ['용액제조'],
        '온라인점검': ['온라인점검']
    };

    let subCategories = catData[key] && catData[key].length > 0 ? catData[key] : defaultSubCategories[type] || [];

    if (subCategories.length === 0) {
        rDetailTypeSelect.innerHTML = '<option value="">세부구분 없음 (직접입력)</option>';
        rDetailTypeSelect.disabled = true;
    } else {
        rDetailTypeSelect.innerHTML = '<option value="">선택</option>';
        subCategories.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub;
            opt.textContent = sub;
            rDetailTypeSelect.appendChild(opt);
        });
    }
    updateRegisterContentOptions();
};

window.updateRegisterDetailType2Options = function () {
    const rEquipSelect = document.getElementById('register-equip-select');
    const rTypeSelect = document.getElementById('register-type-select');
    const rDetailTypeSelect = document.getElementById('register-detail-type-select');
    const rDetailType2Select = document.getElementById('register-detail-type2-select');

    if (!rTypeSelect || !rDetailTypeSelect || !rDetailType2Select) return;
    const type = rTypeSelect.value;
    const detailType = rDetailTypeSelect.value;

    rDetailType2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분</option>';
    if (type !== '비정기' || !detailType) {
        rDetailType2Select.disabled = true;
        updateRegisterContentOptions();
        return;
    }
    rDetailType2Select.disabled = false;
    const equipKey = rEquipSelect ? rEquipSelect.value : '';

    const catData = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
    const key = `${equipKey}::${type}::${detailType}`;
    const defaultSubCategories2 = {
        'BM 점검': ['BM 물품 교체'],
        'Alarm': ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람'],
        'Hunting': ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅'],
        'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈']
    };

    let subCategories2 = catData[key] || [];
    if (subCategories2.length === 0 && type === '비정기' && defaultSubCategories2[detailType]) {
        subCategories2 = [...defaultSubCategories2[detailType]];
    }

    if (subCategories2.length === 0) {
        rDetailType2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 없음</option>';
        rDetailType2Select.disabled = true;
    } else if (subCategories2.length === 1) {
        rDetailType2Select.innerHTML = `<option value="${subCategories2[0]}" selected>${subCategories2[0]}</option>`;
    } else {
        rDetailType2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분</option>';
        subCategories2.forEach(sub => { rDetailType2Select.insertAdjacentHTML('beforeend', `<option value="${sub}">${sub}</option>`); });
    }
    updateRegisterContentOptions();
};

window.updateRegisterContentOptions = function () {
    const rEquipSelect = document.getElementById('register-equip-select');
    const rTypeSelect = document.getElementById('register-type-select');
    const rDetailTypeSelect = document.getElementById('register-detail-type-select');
    const rDetailType2Select = document.getElementById('register-detail-type2-select');
    const wrapper = document.getElementById('register-content-wrapper');
    const list = document.getElementById('register-content-list');
    const trigger = document.getElementById('register-content-trigger');
    const input = document.getElementById('register-content-input');

    if (!wrapper || !list || !trigger || !input) return;

    const equipKey = rEquipSelect ? rEquipSelect.value : '';
    const type = rTypeSelect ? rTypeSelect.value : '';
    const detailType = rDetailTypeSelect ? rDetailTypeSelect.value : '';
    const detailType2 = rDetailType2Select && rDetailType2Select.style.display !== 'none' ? rDetailType2Select.value : '';

    if (!type || (!detailType && !rDetailTypeSelect.disabled)) {
        wrapper.style.display = 'none';
        input.style.display = 'block';
        input.placeholder = type ? '세부구분을 먼저 선택하세요' : '구분을 먼저 선택하세요';
        input.value = '';
        input.disabled = true;
        return;
    }

    if (type === '비정기' && (!detailType2 && !rDetailType2Select.disabled)) {
        wrapper.style.display = 'none';
        input.style.display = 'block';
        input.placeholder = '세부 구분을 먼저 선택하세요';
        input.value = '';
        input.disabled = true;
        return;
    }

    input.disabled = false;
    const itemData = JSON.parse(localStorage.getItem('check_type_items')) || {};
    let chkKey;
    if (type === '비정기') {
        chkKey = `${equipKey}::${type}::${detailType}::${detailType2}`;
    } else {
        chkKey = `${equipKey}::${type}::${detailType}`;
    }
    let items = itemData[chkKey] || [];

    if (items.length === 0) {
        if (type === '비정기' && ['Alarm', 'Hunting', 'Data / Para 이상'].includes(detailType)) {
            const defaultList = [
                "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 / 용자 이상",
                "파트 이상 (교체)", "파트 이상 (수리)", "프로그램 이상", "단순조치", "기타"
            ];
            items = defaultList.map(content => ({ content: content }));
        } else if (detailType === 'PM 점검' || detailType === 'BM 점검') {
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
            items = matchedItems.map(mItem => ({ content: mItem.part, code: mItem.code }));
        }
    }

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    const uniqueItems = [];
    const seenContents = new Set();
    items.forEach(item => {
        if (!seenContents.has(item.content)) {
            seenContents.add(item.content);
            if (!item.code) {
                const match = adminItems.find(a => a.part === item.content);
                if (match && match.code) item.code = match.code;
            }
            uniqueItems.push(item);
        }
    });

    if (uniqueItems.length > 0 && detailType) {
        wrapper.style.display = 'block';
        input.style.display = 'none';
        trigger.textContent = '항목 선택';
        trigger.classList.remove('has-value');

        const updateTriggerText = () => {
            const sels = Array.from(list.querySelectorAll('.selected')).map(el => {
                const cSel = el.querySelector('.item-cost-select');
                return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
            });
            if (sels.length > 1) {
                trigger.textContent = sels[0] + ' 외 ' + (sels.length - 1) + '개';
                trigger.title = sels.join('\n');
                trigger.classList.add('has-value');
            } else if (sels.length === 1) {
                trigger.textContent = sels[0];
                trigger.title = sels[0];
                trigger.classList.add('has-value');
            } else {
                trigger.textContent = '항목 선택';
                trigger.title = '';
                trigger.classList.remove('has-value');
            }
        };

        const dropdown = document.getElementById('register-content-dropdown');
        let searchInput = document.getElementById('register-content-search');
        if (!searchInput && dropdown) {
            searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.id = 'register-content-search';
            searchInput.className = 'dropdown-search-input';
            searchInput.placeholder = '텍스트로 항목 검색...';
            searchInput.autocomplete = 'off';
            searchInput.addEventListener('click', e => e.stopPropagation());
            dropdown.insertBefore(searchInput, list);
        }

        const siteSelect = document.getElementById('register-site-select');
        const site = siteSelect ? siteSelect.value : '';
        const key = `details_${site}_${equipKey}`;
        const detailData = JSON.parse(localStorage.getItem(key)) || { maint: [] };

        const registeredSet = new Set(detailData.maint
            .filter(m => m.type === type && m.detailType === detailType)
            .map(m => m.code ? m.code : m.content)
        );

        let registeredItems = [];
        let otherItems = [];

        // [수정] PM/BM 점검일 경우, 제안 박스의 "전체 물품"이 시스템에 등록된 모든 물품을 의미하도록 풀(pool) 확장
        let poolItems = uniqueItems;
        if (detailType === 'PM 점검' || detailType === 'BM 점검') {
            const poolMap = new Map();
            uniqueItems.forEach(i => poolMap.set(i.content, i));
            const allAdminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            allAdminItems.forEach(a => {
                if (!poolMap.has(a.part)) {
                    poolMap.set(a.part, { content: a.part, code: a.code });
                }
            });
            poolItems = Array.from(poolMap.values());
        }

        poolItems.forEach(item => {
            const val = item.code ? item.code : item.content;
            if (registeredSet.has(val) || registeredSet.has(item.content)) {
                registeredItems.push(item);
            } else {
                otherItems.push(item);
            }
        });

        let showAll = registeredItems.length === 0;

        const renderDropdownItems = (searchTerm = '') => {
            // [추가] 렌더링 전 기존 선택 상태 및 비용 처리 값 백업 (선택 초기화 방지)
            const currentSelections = {};
            list.querySelectorAll('.log-select-item.selected').forEach(el => {
                const cSel = el.querySelector('.item-cost-select');
                currentSelections[el.dataset.value] = cSel ? cSel.value : '유상';
            });

            let displayItems = showAll ? [...registeredItems, ...otherItems] : registeredItems;

            if (searchTerm) {
                const kws = searchTerm.toLowerCase().split(/\s+/);
                displayItems = [...registeredItems, ...otherItems].filter(item => {
                    const txt = `${item.content} ${item.code || ''}`.toLowerCase();
                    return kws.every(kw => txt.includes(kw));
                });
            }

            list.innerHTML = displayItems.map(item => {
                const val = item.code ? item.code : item.content;
                const isSelected = currentSelections.hasOwnProperty(val);
                const selClass = isSelected ? 'selected' : '';
                const itemCost = isSelected ? currentSelections[val] : '유상';

                if (detailType === 'PM 점검' || detailType === 'BM 점검') {
                    return `<div class="log-select-item ${selClass}" data-value="${val}">
                                <span style="flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${val}</span>
                                <select class="item-cost-select input-dark has-value" style="width: 85px; font-size: 11px; padding: 2px; margin-left: 5px; color: #e6edf3; color-scheme: dark;" onclick="event.stopPropagation()">
                                    <option value="유상" ${itemCost === '유상' ? 'selected' : ''}>유상</option>
                                    <option value="무상(보증)" ${itemCost === '무상(보증)' ? 'selected' : ''}>무상(보증)</option>
                                    <option value="무상(중고)" ${itemCost === '무상(중고)' ? 'selected' : ''}>무상(중고)</option>
                                    <option value="기타" ${itemCost === '기타' ? 'selected' : ''}>기타</option>
                                </select>
                            </div>`;
                } else {
                    return `<div class="log-select-item ${selClass}" data-value="${val}"><span>${val}</span></div>`;
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
                list.appendChild(moreBtn);
            }

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
                    trigger.classList.remove('error-border');

                    if (type === '비정기' && detailType !== 'BM 점검') {
                        list.querySelectorAll('.log-select-item.selected').forEach(el => {
                            if (el !== div) el.classList.remove('selected');
                        });
                    }
                    div.classList.toggle('selected');
                    updateTriggerText();

                    if (type === '비정기' && detailType !== 'BM 점검' && div.classList.contains('selected')) {
                        if (dropdown) dropdown.classList.remove('show');
                    }
                };
            });
        };

        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = (e) => {
                renderDropdownItems(e.target.value.trim());
            };
        }

        renderDropdownItems();

        const footer = dropdown ? dropdown.querySelector('.log-select-footer') : null;
        if (footer) footer.style.display = (type === '비정기' && detailType !== 'BM 점검') ? 'none' : 'block';
    } else {
        wrapper.style.display = 'none';
        input.style.display = 'block';
        if (detailType === 'PM 점검' || detailType === 'BM 점검') {
            input.placeholder = '항목을 추가해 주세요';
            input.value = '';
            input.disabled = true;
            input.classList.add('input-disabled');
        } else {
            input.placeholder = detailType ? '내용 (직접 입력)' : '내용 (직접 입력)';
            input.disabled = false;
            input.classList.remove('input-disabled');
        }
    }
};

/* ==========================================================================
   [8] 모달: 검색 필터 (Search Filter Modal)
   ========================================================================== */

function setupSearchModal() {
    const modal = document.getElementById('calendar-search-modal');
    const closeBtn = document.getElementById('btn-close-search-modal');
    const resetBtn = document.getElementById('btn-reset-search-filter');
    const applyBtn = document.getElementById('btn-apply-search-filter');
    const siteSelect = document.getElementById('search-site-select');
    const equipSelect = document.getElementById('search-equip-select');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateSearchEquipSelect(siteSelect.value);
        };
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            if (siteSelect) siteSelect.value = '';
            updateSearchEquipSelect('');
            currentSearchFilters = { site: '', equip: '' };
            renderCalendar();
        };
    }

    if (applyBtn) {
        applyBtn.onclick = () => {
            const site = siteSelect.value;
            const equip = equipSelect.value;
            currentSearchFilters = { site, equip };
            modal.style.display = 'none';
            renderCalendar();
        };
    }
}

function openSearchModal() {
    const modal = document.getElementById('calendar-search-modal');
    const siteSelect = document.getElementById('search-site-select');
    const equipSelect = document.getElementById('search-equip-select');

    if (!modal) return;

    const data = getDeviceDataMap();
    siteSelect.innerHTML = '<option value="">전체 사업장</option>';
    Object.keys(data).forEach(site => {
        const option = document.createElement('option');
        option.value = site;
        option.textContent = site;
        if (currentSearchFilters.site === site) option.selected = true;
        siteSelect.appendChild(option);
    });

    updateSearchEquipSelect(currentSearchFilters.site);
    if (currentSearchFilters.equip) equipSelect.value = currentSearchFilters.equip;

    modal.style.display = 'flex';
}

function updateSearchEquipSelect(site) {
    const equipSelect = document.getElementById('search-equip-select');
    equipSelect.innerHTML = '<option value="">전체 장비</option>';

    if (!site) {
        equipSelect.disabled = true;
        return;
    }

    const data = getDeviceDataMap();
    const equips = data[site] || [];

    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        option.textContent = parts.length > 1 ? `${parts[0]} (${parts[1]})` : parts[0];
        equipSelect.appendChild(option);
    });

    equipSelect.disabled = false;
}

/* ==========================================================================
   [9] 드래그 앤 드롭 (Drag & Drop)
   ========================================================================== */
window.handleCalendarDragStartFromData = function (e) {
    e.stopPropagation();
    const target = e.currentTarget;
    target.classList.add('dragging');
    const site = target.dataset.dragSite;
    const equip = target.dataset.dragEquip;
    const idsStr = target.dataset.dragIds;

    const ids = JSON.parse(idsStr);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ site, equip, ids }));
};

window.handleCalendarDrop = function (e, newDate) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');

    const dataStr = e.dataTransfer.getData('text/plain');
    if (!dataStr) return;

    try {
        const { site, equip, ids } = JSON.parse(dataStr);
        if (!ids || ids.length === 0) return;

        if (confirm(`${ids.length}건의 일정을 ${newDate}로 이동하시겠습니까?`)) {
            const key = `details_${site}_${equip}`;
            const data = JSON.parse(localStorage.getItem(key)) || {};
            const firstItem = data.maint ? data.maint.find(i => i.id === ids[0]) : null;
            let reason = undefined;
            if (firstItem && firstItem.scheduledDate) {
                const [y, m] = firstItem.scheduledDate.split('-').map(Number);
                const confs = JSON.parse(localStorage.getItem('calendar_confirmations')) || {};
                const yyyyMm = `${y}-${String(m).padStart(2, '0')}`;
                const monthConf = confs[yyyyMm];
                if (monthConf) {
                    const isGlobalConfirmed = monthConf.count !== undefined;
                    const isSiteConfirmed = monthConf[site] !== undefined || (monthConf.siteCounts && monthConf.siteCounts[site] !== undefined);

                    if (isGlobalConfirmed || isSiteConfirmed) {
                        reason = prompt(`[예정 확정됨]\n기존 예정일이 포함된 월은 일정이 확정되었습니다.\n일정 변경 사유를 입력해주세요:`);
                        if (reason === null) return;
                    }
                }
            }

            ids.forEach(id => {
                setScheduleDate(site, equip, id, newDate, false, null, reason);
            });
            renderCalendar();
            if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
        }
    } catch (err) {
        console.error('Drop error:', err);
    }
};

// [수정] 월별 작업 예정 확정 함수 (사업장별)
window.confirmMonthSchedule = function (site, year, month, count) {
    if (!confirm(`[${site}] ${year}년 ${month + 1}월의 예정 작업을 확정하시겠습니까?\n\n[확정 기준: ${count}건]\n확정 이후 해당 사업장의 일정을 변경하거나 삭제하면 사유를 입력해야 하며, 변경 이력이 로그에 남습니다.`)) {
        return;
    }

    const confs = JSON.parse(localStorage.getItem('calendar_confirmations')) || {};
    const yyyyMm = `${year}-${String(month + 1).padStart(2, '0')}`;

    if (!confs[yyyyMm]) confs[yyyyMm] = {};

    // 구버전 데이터(전체 통합)가 있을 경우, 구조를 분리형으로 변환
    if (confs[yyyyMm].count !== undefined) {
        const oldSiteCounts = confs[yyyyMm].siteCounts || {};
        confs[yyyyMm] = oldSiteCounts;
    }

    confs[yyyyMm][site] = { count: count, confirmedAt: new Date().toISOString() };
    localStorage.setItem('calendar_confirmations', JSON.stringify(confs));

    if (typeof addSystemLog === 'function') {
        addSystemLog('CONFIRM_SCHEDULE', yyyyMm, `[${site}] 작업수 ${count}건 확정`);
    }
    renderCalendar();
};

// [추가] 확정된 월의 작업수 누적 함수 (추가 등록 시 기준값 증가)
window.incrementConfirmedCount = function (site, dateStr, delta) {
    if (!dateStr || !site || !delta) return;
    const [y, m] = dateStr.split('-').map(Number);
    const yyyyMm = `${y}-${String(m).padStart(2, '0')}`;
    const confs = JSON.parse(localStorage.getItem('calendar_confirmations')) || {};
    const monthConf = confs[yyyyMm];

    if (monthConf) {
        let updated = false;
        if (monthConf[site] && monthConf[site].count !== undefined) {
            monthConf[site].count += delta;
            updated = true;
        } else if (monthConf.siteCounts && monthConf.siteCounts[site] !== undefined) {
            monthConf.siteCounts[site] += delta;
            monthConf.count += delta;
            updated = true;
        } else if (monthConf.count !== undefined && !monthConf.siteCounts) {
            monthConf.count += delta;
            updated = true;
        }
        if (updated) {
            localStorage.setItem('calendar_confirmations', JSON.stringify(confs));
        }
    }
};

// 전역 노출
window.renderCalendar = renderCalendar;
window.goToTodayMonth = goToTodayMonth;
window.openScheduleModal = openScheduleModal;
window.openRegisterScheduleModal = openRegisterScheduleModal;
