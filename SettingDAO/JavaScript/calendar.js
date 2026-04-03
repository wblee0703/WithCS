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
let cameFromTaskSearch = false; // [추가] 작업 검색에서 상세 정보로 이동했는지 여부

// [2] 초기화 (Initialization)
document.addEventListener('DOMContentLoaded', () => {
    setupCalendar();
    setupScheduleModal();
    setupEventDetailModal();
    setupRegisterScheduleModal();
    setupSearchModal();
    setupTaskSearchModal(); // [추가]

    // [추가] 달력 상세 검색 제안박스 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        const searchDropdown = document.getElementById('search-equip-dropdown');
        const searchTrigger = document.getElementById('search-equip-trigger');
        if (searchDropdown && searchDropdown.classList.contains('show')) {
            if (e.target !== searchTrigger && !searchTrigger.contains(e.target) && !searchDropdown.contains(e.target)) {
                searchDropdown.classList.remove('show');
            }
        }
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
function setScheduleDate(site, equip, id, dateStr, isDelete = false, md = null, worker = null, providedReason = undefined) {
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

                    const now = new Date();
                    const modifyTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                    const uDept = sessionStorage.getItem('userDepartment') || '';
                    const uPos = sessionStorage.getItem('userPosition') || '';
                    const uName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';

                    const workerInfo = (uDept || uPos) ? `${uName} (${uDept} ${uPos})`.trim() : uName;

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
                        worker: workerInfo,
                        memo: `[일정 ${isDelete ? '삭제' : '변경'} 사유]\n${actualReason}\n\n[변경 내역]\n기존: ${item.scheduledDate}\n변경: ${isDelete ? '삭제됨' : dateStr}\n\n[수정 일시 및 작업자]\n${modifyTime} / ${workerInfo}`
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
                if (worker !== null) {
                    item.worker = worker;
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

        // [수정] 적용된 검색/필터가 없을 때 기본 검색 버튼 텍스트 표시
        if (!infoText) {
            infoText = '🔍 달력 상세 검색';
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
            const userRole = sessionStorage.getItem('userRole');
            if (userRole === 'superadmin') {
                confirmBtnHtml = `<button class="btn-green" style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="event.stopPropagation(); cancelMonthScheduleConfirm('${selectedSite}', ${year}, ${month})">확정 완료</button>`;
            } else {
                confirmBtnHtml = `<button class="btn-green" style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:4px; font-weight:bold; cursor:default;" onclick="event.stopPropagation();" disabled>확정 완료</button>`;
            }
        } else {
            baseTotal = monthTotalTasks;
            const userRole = sessionStorage.getItem('userRole');
            if (userRole === 'admin' || userRole === 'superadmin') {
                confirmBtnHtml = `<button class="btn-blue" style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="event.stopPropagation(); confirmMonthSchedule('${selectedSite}', ${year}, ${month}, ${monthTotalTasks})">확정 전</button>`;
            } else {
                confirmBtnHtml = `<button class="btn-blue" style="margin-left:10px; padding:2px 8px; font-size:11px; border-radius:4px; font-weight:bold; cursor:default;" onclick="event.stopPropagation();" disabled>확정 전</button>`;
            }
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

    // [추가] 모바일 작업 검색 버튼 추가
    if (window.innerWidth <= 950 && registerBtn) {
        const existingSearchBtn = document.getElementById('btn-task-search');
        if (existingSearchBtn) existingSearchBtn.remove();

        const searchBtn = document.createElement('a');
        searchBtn.href = '#';
        searchBtn.id = 'btn-task-search';
        searchBtn.className = 'btn-blue-sm';
        searchBtn.textContent = '작업 검색';
        searchBtn.style.marginRight = '10px';
        searchBtn.style.textDecoration = 'none';
        searchBtn.onclick = (e) => {
            e.preventDefault();
            openTaskSearchModal();
        };
        registerBtn.parentNode.insertBefore(searchBtn, registerBtn);
    }

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
            const tpl = getTemplateContent('popup-event-item-template');
            if (tpl) {
                const li = tpl.querySelector('li');

                const textClass = (group.isCompleted || group.isChanged) ? 'completed' : '';
                const parts = group.equip.split('::');
                const equipName = parts[0];
                const serialNo = parts.length > 1 ? parts[1] : '';

                const key = `details_${group.site}_${group.equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                let subInfo = '';
                if (custName) {
                    subInfo = ` <span style="color:#3fb950;">[${escapeHtml(custName)}]</span>`;
                } else if (serialNo) {
                    subInfo = ` <span style="color:#3fb950;">[${escapeHtml(serialNo)}]</span>`;
                }

                const itemTextSpan = li.querySelector('.popup-item-text');
                if (textClass) itemTextSpan.classList.add(textClass);

                const typeBadge = li.querySelector('.popup-type-badge');
                typeBadge.className = `popup-type-badge type-${group.type}`;
                typeBadge.textContent = `[${group.type}]`;

                li.querySelector('.equip-info').innerHTML = `${escapeHtml(group.site)} > ${escapeHtml(equipName)}${subInfo}`;

                if (group.isCompleted) {
                    const completedSpan = document.createElement('span');
                    completedSpan.textContent = '<완료>';
                    completedSpan.className = 'popup-completed-badge';
                    li.appendChild(completedSpan);
                } else if (group.isChanged) {
                    const changedSpan = document.createElement('span');
                    changedSpan.textContent = '<변동>';
                    changedSpan.style.color = '#f0883e';
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
                                setScheduleDate(item.site, item.equip, item.id, '', true, null, null, reason);
                            });

                            renderCalendar();
                            if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();

                            const dateStr = document.getElementById('popup-date-title').textContent;
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
                    };
                    li.appendChild(delBtn);
                }

                li.onclick = () => openEventDetailModal(group.site, group.equip, group.items[0].id, group.isCompleted || group.isChanged);
                list.appendChild(li);
            }
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
                const workerHidden = document.getElementById('schedule-worker-hidden');
                const worker = workerHidden ? workerHidden.value.trim() : '';
                if (!date) return alert('날짜를 선택해주세요.');
                if (!worker) return alert('작업자를 선택해주세요.');
                if (parseFloat(md) < 0) return alert('공수는 0 이상이어야 합니다.');
                const success = setScheduleDate(currentScheduleTarget.site, currentScheduleTarget.equip, currentScheduleTarget.id, date, false, md, worker);
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
        mdInput.disabled = false; // 공수 수동 입력 허용
        mdInput.classList.remove('input-disabled');
    }

    // [추가] 작업자 필드 동적 생성 및 검색/제안 박스 연동
    let workerHidden = document.getElementById('schedule-worker-hidden');
    if (!workerHidden) {
        workerHidden = document.createElement('input');
        workerHidden.type = 'hidden';
        workerHidden.id = 'schedule-worker-hidden';

        const wrapper = document.createElement('div');
        wrapper.id = 'schedule-worker-wrapper';
        wrapper.style.marginBottom = '15px';
        wrapper.style.width = '100%';

        const templateContent = getTemplateContent('schedule-worker-template');
        if (templateContent) {
            wrapper.appendChild(templateContent);
        }

        const mdRow = mdInput ? (mdInput.closest('.form-row') || mdInput.closest('div')) : null;
        if (mdRow && mdRow.parentNode) {
            mdRow.parentNode.insertBefore(wrapper, mdRow);
        } else {
            modal.querySelector('.modal-body').insertBefore(wrapper, modal.querySelector('.modal-btn-group'));
        }
        wrapper.appendChild(workerHidden);
    }

    const trigger = document.getElementById('schedule-worker-trigger');
    const dropdown = document.getElementById('schedule-worker-dropdown');
    const searchInput = document.getElementById('schedule-worker-search');
    const listContainer = document.getElementById('schedule-worker-list');
    const confirmBtn = document.getElementById('btn-schedule-worker-confirm');

    // 초기 데이터 바인딩
    let initialWorker = item && item.worker ? item.worker : (sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '');
    workerHidden.value = initialWorker;
    if (initialWorker) {
        trigger.textContent = initialWorker.split(',').join(' ');
        trigger.title = initialWorker;
        if (mdInput && !item) mdInput.value = initialWorker.split(',').filter(Boolean).length;
    } else {
        trigger.textContent = '작업자 선택';
        trigger.title = '';
        if (mdInput && !item) mdInput.value = '0';
    }

    const renderWorkers = async (searchTerm = '') => {
        // [수정] 현재 작업의 사업장(site)을 기준으로 작업자 목록을 가져옴
        const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(site) : [];
        const currentSelected = workerHidden.value ? workerHidden.value.split(',').map(s => s.trim()).filter(Boolean) : [];
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

        renderWorkerListItems(listContainer, displayWorkers, currentSelected, () => {
            const selected = Array.from(listContainer.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
            workerHidden.value = selected.join(', ');
            if (selected.length > 0) trigger.textContent = selected.join(' ');
            else trigger.textContent = '작업자 선택';
            trigger.title = selected.join(', ');

            if (mdInput) mdInput.value = selected.length.toString();
        });
    };

    // 이전 이벤트 핸들러 초기화 및 재할당
    trigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
        dropdown.classList.toggle('show');
        if (dropdown.classList.contains('show')) renderWorkers(searchInput.value.trim());
    };

    searchInput.onclick = (e) => e.stopPropagation();
    searchInput.oninput = (e) => renderWorkers(e.target.value.trim());
    confirmBtn.onclick = (e) => { e.stopPropagation(); dropdown.classList.remove('show'); };

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

        // [추가] 작업 검색에서 왔다면 검색 모달 다시 표시
        if (cameFromTaskSearch) {
            const searchModal = document.getElementById('task-search-modal');
            if (searchModal) {
                searchModal.style.display = 'flex';
            }
            cameFromTaskSearch = false; // 플래그 리셋
        }
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
                let targetUrl = `maintenance.html?site=${encodeURIComponent(currentDetailTarget.site)}&equip=${encodeURIComponent(currentDetailTarget.equip)}`;
                if (currentDetailTarget.isCompleted && currentDetailTarget.id) {
                    targetUrl += `&logId=${currentDetailTarget.id}`;
                }
                location.href = targetUrl;
            }
        };
    }

    if (editContentBtn) {
        editContentBtn.onclick = toggleDetailContentEdit;
    }

    // [추가] detail-worker 드롭다운화
    const workerInput = document.getElementById('detail-worker');
    if (workerInput && !document.getElementById('detail-worker-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.id = 'detail-worker-wrapper';
        wrapper.className = 'log-select-wrapper';
        wrapper.style.width = '100%';
        wrapper.style.margin = '0';

        const templateContent = getTemplateContent('detail-worker-template');
        if (templateContent) {
            wrapper.appendChild(templateContent);
        }
        workerInput.parentNode.insertBefore(wrapper, workerInput);
        workerInput.type = 'hidden';

        const trigger = document.getElementById('detail-worker-trigger');
        const dropdown = document.getElementById('detail-worker-dropdown');
        const searchInput = document.getElementById('detail-worker-search');
        const listContainer = document.getElementById('detail-worker-list');
        const confirmBtn = document.getElementById('btn-detail-worker-confirm');

        const renderWorkers = async (searchTerm = '') => {
            // [수정] 현재 작업의 사업장(currentDetailTarget.site)을 기준으로 작업자 목록을 가져옴
            const currentSite = currentDetailTarget ? currentDetailTarget.site : null;
            const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(currentSite) : [];
            const currentSelected = workerInput.value ? workerInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
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

            renderWorkerListItems(listContainer, displayWorkers, currentSelected, () => {
                updateWorkerSelection();
            });
        };

        const updateWorkerSelection = () => {
            const selected = Array.from(listContainer.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
            workerInput.value = selected.join(', ');
            if (selected.length > 0) trigger.textContent = selected.join(' ');
            else trigger.textContent = '작업자 선택';
            trigger.title = selected.join(', ');

            const mdInput = document.getElementById('detail-md');
            if (mdInput) {
                mdInput.value = selected.length.toString();
            }
        };

        trigger.onclick = (e) => {
            e.stopPropagation();
            if (trigger.classList.contains('disabled')) return;
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
            dropdown.classList.toggle('show');
            if (dropdown.classList.contains('show')) renderWorkers(searchInput.value.trim());
        };
        searchInput.onclick = (e) => e.stopPropagation();
        searchInput.oninput = (e) => renderWorkers(e.target.value.trim());
        confirmBtn.onclick = (e) => { e.stopPropagation(); dropdown.classList.remove('show'); };

        workerInput.addEventListener('updateTrigger', () => {
            const val = workerInput.value;
            const arr = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
            if (arr.length > 0) trigger.textContent = arr.join(' ');
            else trigger.textContent = '작업자 선택';
            trigger.title = arr.join(', ');
        });
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
    let serialText = parts.length > 1 ? parts[1] : '-';
    const custName = (data.setup && data.setup.custEquipName) ? data.setup.custEquipName : '';
    if (custName) {
        serialText += ` [${custName}]`;
    }
    document.getElementById('detail-serial-no').textContent = serialText;
    document.getElementById('detail-type').textContent = item.type || '정기';
    let displayDetailType = item.detailType;
    if (!displayDetailType) {
        displayDetailType = (item.type === '정기') ? 'PM 점검' : 'BM 점검';
    }
    document.getElementById('detail-detail-type').textContent = displayDetailType;

    // [수정] 같은 날짜, 같은 타입, 세부구분에 예정된 항목들을 모두 표시 (비용처리 포함)
    let displayContent = item.content || '';
    if (!isCompleted && item.code) {
        displayContent = item.code;
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

    // [추가] 특이 이슈 공유 체크박스 래퍼 동적 생성
    let issueShareWrapper = document.getElementById('detail-issue-share-wrapper');
    if (!issueShareWrapper && memoInput) {
        issueShareWrapper = document.createElement('div');
        issueShareWrapper.id = 'detail-issue-share-wrapper';
        issueShareWrapper.style.marginTop = '10px';
        issueShareWrapper.style.display = 'flex';
        issueShareWrapper.style.alignItems = 'center';
        const templateContent = getTemplateContent('detail-issue-share-template');
        if (templateContent) {
            issueShareWrapper.appendChild(templateContent);
        }
        memoInput.parentNode.insertBefore(issueShareWrapper, memoInput.nextSibling);
    }
    const issueShareCb = document.getElementById('detail-issue-share-checkbox');

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
        const trigger = document.getElementById('detail-worker-trigger');
        if (trigger) {
            trigger.classList.add('disabled');
            trigger.style.opacity = '0.5';
            trigger.style.cursor = 'not-allowed';
        }
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
        if (issueShareCb) {
            issueShareCb.checked = !!item.isIssueShared;
            issueShareCb.disabled = true;
        }
    } else {
        // [수정] 저장된 작업자(취소된 내용)가 있으면 우선 사용
        workerInput.value = item.worker || localStorage.getItem('lastWorkerName') || sessionStorage.getItem('userId') || '';
        workerInput.disabled = false;
        const trigger = document.getElementById('detail-worker-trigger');
        if (trigger) {
            trigger.classList.remove('disabled');
            trigger.style.opacity = '1';
            trigger.style.cursor = 'pointer';
        }

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
        // [수정] 신규 작업 등록 시 이전 메모를 불러오도록 수정
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
        if (issueShareCb) {
            issueShareCb.checked = false;
            issueShareCb.disabled = false;
        }
    }
    if (workerInput) workerInput.dispatchEvent(new Event('updateTrigger'));

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

        let currentContent = contentDiv.dataset.rawContent || contentDiv.innerText.trim();

        // [추가] 분리 로직 추가
        let baseContent = currentContent;
        let partContentStr = '';
        const partKeywords = ['파트 이상 (교체) - ', '파트 이상 (수리) - ', '용액 / 용자 이상 - '];
        for (const keyword of partKeywords) {
            if (currentContent && currentContent.includes(keyword)) {
                baseContent = keyword.replace(' - ', '');
                partContentStr = currentContent.replace(keyword, '');
                break;
            }
        }

        const currentValues = baseContent ? baseContent.split(',').map(s => s.trim()).filter(s => s) : [];
        const selectedMap = {};
        currentValues.forEach(val => {
            if (val === '내용 없음') return; // [추가] '내용 없음'은 리스트에 추가하지 않음
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
            } else if (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체') {
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

            const templateContent = getTemplateContent('edit-content-dropdown-template');
            if (templateContent) {
                dropdownWrapper.appendChild(templateContent);
            }

            const trigger = dropdownWrapper.querySelector('.log-select-trigger');
            const dropdown = dropdownWrapper.querySelector('.log-select-dropdown');
            const searchInput = dropdownWrapper.querySelector('.dropdown-search-input');
            const list = dropdownWrapper.querySelector('.log-select-list');
            const addBtn = dropdownWrapper.querySelector('.btn-blue-sm');

            const actualValues = Object.keys(selectedMap);
            let initialText = '항목 선택';
            if (actualValues.length > 1) {
                initialText = `${actualValues[0]} 외 ${actualValues.length - 1}개`;
            } else if (actualValues.length === 1) {
                initialText = actualValues[0];
            }
            trigger.innerText = initialText;
            trigger.title = currentValues.join('\n');

            let poolItems = uniqueItems;
            if (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체') {
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

            let maintSet = new Set();
            if (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체') {
                const maintKey = `details_${site}_${equip}`;
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
                if (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체') {
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

                list.innerHTML = '';
                displayItems.forEach(item => {
                    const val = item.code ? item.code : item.content;
                    const isSelected = currentSelections.hasOwnProperty(val) || currentSelections.hasOwnProperty(item.content);
                    const itemCost = isSelected ? (currentSelections[val] || currentSelections[item.content] || '유상') : '유상';

                    const templateId = (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체')
                        ? 'log-part-item-template' : 'detail-content-item-template';

                    const tpl = getTemplateContent(templateId);
                    if (tpl) {
                        const div = tpl.querySelector('.log-select-item');
                        if (isSelected) div.classList.add('selected');
                        div.dataset.value = val;
                        div.querySelector('.item-name').textContent = val;

                        const cSel = div.querySelector('.item-cost-select');
                        if (cSel) {
                            cSel.value = itemCost;
                            cSel.addEventListener('click', e => e.stopPropagation());
                            cSel.addEventListener('change', (e) => {
                                e.stopPropagation();
                                if (div.classList.contains('selected')) updateTriggerText();
                            });
                        }

                        div.addEventListener('mousedown', (e) => {
                            if (e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') return;
                            e.preventDefault();
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

                            // 파트 연동 처리
                            const pWrapper = document.getElementById('detail-edit-part-wrapper');
                            if (pWrapper) {
                                const selectedItems = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
                                const isPartIssueSelected = selectedItems.some(v => v.includes('파트 이상 (교체)') || v.includes('파트 이상 (수리)') || v.includes('용액 / 용자 이상'));
                                pWrapper.style.display = isPartIssueSelected ? 'block' : 'none';
                                if (isPartIssueSelected && typeof window.renderLogPartOptions === 'function') {
                                    window.renderLogPartOptions('detail-edit-part-wrapper', 'detail-edit-part-trigger', 'detail-edit-part-list', 'detail-edit-part-search', '');
                                }
                            }
                        });

                        list.appendChild(div);
                    }
                });

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

            };

            searchInput.oninput = (e) => {
                renderDropdownItems(e.target.value.trim());
            };

            renderDropdownItems();

            dropdown.insertBefore(list, dropdown.querySelector('.log-select-footer'));

            addBtn.onclick = (e) => {
                e.stopPropagation();
                dropdown.classList.remove('show');
            };
            if (type === '비정기' && detailType !== 'BM 점검') {
                addBtn.parentElement.style.display = 'none';
            }

            trigger.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => {
                    if (d !== dropdown) d.classList.remove('show');
                });
                dropdown.classList.toggle('show');
            };

            contentInput.parentNode.insertBefore(dropdownWrapper, contentInput.nextSibling);

            // [추가] 파트 선택 래퍼 동적 추가 (수정 모드용)
            let pWrapper = document.getElementById('detail-edit-part-wrapper');
            if (!pWrapper) {
                pWrapper = document.createElement('div');
                pWrapper.className = 'log-select-wrapper';
                pWrapper.id = 'detail-edit-part-wrapper';
                pWrapper.style.width = '100%';
                pWrapper.style.margin = '0';
                const templateContent = getTemplateContent('detail-edit-part-wrapper-template');
                if (templateContent) {
                    pWrapper.appendChild(templateContent);
                }
                contentInput.parentNode.insertBefore(pWrapper, dropdownWrapper.nextSibling);
                const pTrigger = pWrapper.querySelector('#detail-edit-part-trigger');
                const pDropdown = pWrapper.querySelector('#detail-edit-part-dropdown');
                pTrigger.onclick = (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== pDropdown) d.classList.remove('show'); });
                    pDropdown.classList.toggle('show');
                };
            }
            const hasPartIssue = currentValues.some(val => val.includes('파트 이상 (교체)') || val.includes('파트 이상 (수리)') || val.includes('용액 / 용자 이상'));
            pWrapper.style.display = hasPartIssue ? 'block' : 'none';
            if (hasPartIssue && typeof window.renderLogPartOptions === 'function') {
                window.renderLogPartOptions('detail-edit-part-wrapper', 'detail-edit-part-trigger', 'detail-edit-part-list', 'detail-edit-part-search', partContentStr);
            }

        } else {
            contentInput.value = baseContent;
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

        // [수정] 아무 항목도 선택하지 않은 경우 '내용 없음'으로 처리 (필수 선택 해제)
        if (isDropdownMode && dropdownValues.length === 0) {
            dropdownValues = ['내용 없음'];
        }

        const newContent = isDropdownMode ? dropdownValues.join(', ') : contentInput.value.trim();

        let finalContent = newContent;
        const pWrapper = document.getElementById('detail-edit-part-wrapper');
        if (pWrapper && pWrapper.style.display !== 'none') {
            const pList = document.getElementById('detail-edit-part-list');
            if (pList) {
                const selectedParts = pList.querySelectorAll('.log-select-item.selected');
                const partContent = Array.from(selectedParts).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                }).join(', ');
                if (!partContent) return alert('교체/수리할 물품을 선택해주세요.');
                
                // 내용이 없을 땐 선택한 부품명만 보여주도록 처리
                if (finalContent === '내용 없음') {
                    finalContent = partContent;
                } else {
                    finalContent = `${newContent} - ${partContent}`;
                }
            }
            pWrapper.remove();
        } else if (pWrapper) pWrapper.remove();

        // [수정] 직접 입력 모드에서 완전히 비워뒀을 경우에도 저장 허용
        if (!finalContent) {
            finalContent = '내용 없음';
        }

        if (currentDetailTarget) {
            const { site, equip, id, isCompleted } = currentDetailTarget;
            const key = `details_${site}_${equip}`;
            let data = JSON.parse(localStorage.getItem(key)) || {};

            if (isCompleted && data.logs) {
                // 이미 완료된 로그 수정
                const item = data.logs.find(i => i.id == id);
                if (item) {
                    item.content = finalContent;
                    contentDiv.dataset.rawContent = finalContent;
                    const arr = finalContent.split(',').map(s => s.trim()).filter(s => s);
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

                        contentDiv.dataset.rawContent = finalContent;
                        const arr = finalContent.split(',').map(s => s.trim()).filter(s => s);
                        contentDiv.innerText = arr.length > 1 ? `${arr[0]} 외 ${arr.length - 1}개` : (arr[0] || '내용 없음');
                        contentDiv.title = arr.join('\n');
                    } else {
                        item.content = finalContent;
                        contentDiv.dataset.rawContent = finalContent;
                        const arr = finalContent.split(',').map(s => s.trim()).filter(s => s);
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
    const issueShareCb = document.getElementById('detail-issue-share-checkbox');
    const isIssueShared = issueShareCb ? issueShareCb.checked : false;

    if (!worker) return alert('작업자를 입력해주세요.');
    if (!md) return alert('공수(M/D)를 입력해주세요.');
    if (!memo) return alert('점검 결과 / 메모를 입력해주세요.');

    // [추가] 작업 완료 전 확인 팝업
    if (!confirm('해당 작업을 완료 처리하시겠습니까?')) return;

    localStorage.setItem('lastWorkerName', worker);

    const { site, equip, id } = currentDetailTarget;
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};

    // [추가] 원본 상태 복사 (기존 등록 물품 여부 확인용)
    const originalMaintMap = new Map((data.maint || []).map(m => [m.id, { ...m }]));

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
        memo: memo,
        isIssueShared: isIssueShared
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

    // [추가] 비정기 작업으로 완료 시 기존 '정기' 항목과 동기화 및 중복 방지
    let idsToRemove = new Set();
    let mergedRegItemIds = new Set();
    sameDayItems.forEach(i => {
        if (i.type === '비정기') {
            const regItem = data.maint.find(m => m.type === '정기' && m.id !== i.id && (m.content === i.content || (m.code && i.code && m.code === i.code)));
            if (regItem) {
                regItem.date = i.date;
                if (i.itemCost) regItem.itemCost = i.itemCost;
                idsToRemove.add(i.id);
                mergedRegItemIds.add(regItem.id);
            }
        }
    });

    // [수정] 다음 예정일 등록 대상 항목을 data.maint 수정 전에 미리 결정
    const remainingIds = data.maint.filter(i => sameDayItems.some(s => s.id === i.id) || mergedRegItemIds.has(i.id)).map(i => i.id);
    const remainingItems = data.maint.filter(i => remainingIds.includes(i.id));
    
    // [추가] Admin에 등록된 물품만 다음 예정일 등록 팝업에 표시하도록 필터링
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    let nextScheduleItems = remainingItems.filter(item => {
        return adminItems.some(a => a.part === item.content || a.code === item.content);
    });

    // 항목이 아예 없는 점검(내용 없음) 완료 시, 예정일 팝업에서 단일 폼(작업자/공수/예정일)만 표시되도록 생성
    if (nextScheduleItems.length === 0) {
        nextScheduleItems = [{
            id: Date.now() + 9999, // 임시 고유 ID 부여
            type: maintItem.type || '정기',
            detailType: maintItem.detailType || 'PM 점검',
            content: '장비 점검',
            period: 0,
            md: md,
            worker: worker,
            isNew: true // 새 항목 마커
        }];
    }

    // [수정] 일회성 작업 및 PM/BM 점검이 아닌 항목(Alarm, 고객대응 등)은 완료 후 maint 배열에서 완전히 제거하여 유지관리 목록 누적 방지
    data.maint = data.maint.filter(i => {
        if (idsToRemove.has(i.id)) return false;
        const isCompletedItem = sameDayItems.some(s => s.id === i.id);
        if (isCompletedItem) {
            const dt = i.detailType || '';
            const isPmBm = dt === 'PM 점검' || dt === 'BM 점검' || dt.startsWith('PM 점검 >') || dt.startsWith('BM 점검 >');
            if (!isPmBm) return false;
        }
        return true;
    });

    localStorage.setItem(key, JSON.stringify(data));

    if (typeof addSystemLog === 'function') {
        addSystemLog('COMPLETE_SCHEDULE', equip, `Content: ${combinedContent}`);
    }

    document.getElementById('event-detail-modal').style.display = 'none';

    // [추가] 완료 후 다음 예정일 등록 모달 띄우기
    // 비정기 물품 교체건과 병합된 정기 항목 포함
    if (nextScheduleItems.length > 0) {
        // [수정] 공통 함수 호출로 변경
        openNextScheduleModal({
            site,
            equip,
            items: nextScheduleItems,
            completeDate: completeDate,
            md: md,
            originalMaintMap: originalMaintMap,
            mergedRegItemIds: mergedRegItemIds,
            onClose: window.refreshCalendarPopupAfterCompletion,
            onDateChange: (site, oldDate, newDate) => {
                const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
                const newMonth = newDate.substring(0, 7);
                if (oldMonth !== newMonth) {
                    if (typeof window.incrementConfirmedCount === 'function') {
                        window.incrementConfirmedCount(site, newDate, 1);
                    }
                }
            }
        });

    } else {
        alert('작업이 완료되었습니다.');
        window.refreshCalendarPopupAfterCompletion();
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
    const issueShareCb = document.getElementById('detail-issue-share-checkbox');

    if (workerInput) {
        workerInput.disabled = false;
        workerInput.value = recoveredWorker; // 기존 값 복구
        const trigger = document.getElementById('detail-worker-trigger');
        if (trigger) {
            trigger.classList.remove('disabled');
            trigger.style.opacity = '1';
            trigger.style.cursor = 'pointer';
        }
        workerInput.dispatchEvent(new Event('updateTrigger'));
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
    if (issueShareCb) {
        issueShareCb.disabled = false;
        issueShareCb.checked = false;
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

    if (closeBtn) closeBtn.onclick = () => {
        modal.style.display = 'none';
        window.currentAddWorkLogId = null; // 팝업 닫을 시 상태 초기화
    };

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateRegisterEquipSelect(siteSelect.value);
        };
    }

    if (equipSelect) {
        equipSelect.onchange = () => {
            if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
        };

        if (!document.getElementById('register-equip-wrapper')) {
            equipSelect.style.display = 'none';

            const wrapper = document.createElement('div');
            wrapper.id = 'register-equip-wrapper';
            wrapper.className = 'log-select-wrapper';
            wrapper.style.flex = '1';
            wrapper.style.margin = '0';
            wrapper.style.minWidth = '100px';
            const templateContent = getTemplateContent('register-equip-template');
            if (templateContent) {
                wrapper.appendChild(templateContent);
            }

            equipSelect.parentNode.insertBefore(wrapper, equipSelect.nextSibling);

            const trigger = document.getElementById('register-equip-trigger');
            const dropdown = document.getElementById('register-equip-dropdown');
            const searchInput = document.getElementById('register-equip-search');

            trigger.onclick = (e) => {
                e.stopPropagation();
                if (trigger.classList.contains('disabled')) return;
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
                dropdown.classList.toggle('show');
                if (dropdown.classList.contains('show') && window.renderEquipSuggestions) {
                    window.renderEquipSuggestions(searchInput.value.trim());
                    searchInput.focus();
                }
            };
            searchInput.onclick = (e) => e.stopPropagation();
            searchInput.oninput = (e) => {
                if (window.renderEquipSuggestions) window.renderEquipSuggestions(e.target.value.trim());
            };

            equipSelect.parentNode.insertBefore(wrapper, equipSelect.nextSibling);
        }
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

    // [추가] 세부구분 2 입력창을 세부구분 1 우측으로 이동시키고 제목(Row) 숨김
    const detailType2Row = document.getElementById('register-detail-type2-row');

    if (detailTypeSelect && detailType2Select && detailTypeSelect.parentNode !== detailType2Select.parentNode) {
        detailTypeSelect.parentNode.insertBefore(detailType2Select, detailTypeSelect.nextSibling);
        detailTypeSelect.style.flex = '1';
        detailType2Select.style.flex = '1';
        detailType2Select.style.marginLeft = '5px';
        if (detailType2Row) detailType2Row.style.display = 'none';
    }

    // [추가] 파트 선택 래퍼 동적으로 등록 (모달 내부)
    let partRow = document.getElementById('register-part-row');
    if (!partRow) {
        const contentWrapper = document.getElementById('register-content-wrapper');
        if (contentWrapper) {
            const formRow = contentWrapper.closest('.form-row');
            partRow = document.createElement('div');
            partRow.id = 'register-part-row';
            partRow.className = 'form-row';
            partRow.style.display = 'none';
            const templateContent = getTemplateContent('register-part-row-template');
            if (templateContent) {
                partRow.appendChild(templateContent);
            }
            formRow.parentNode.insertBefore(partRow, formRow.nextSibling);
            const pt = document.getElementById('register-part-trigger');
            const pd = document.getElementById('register-part-dropdown');
            const pa = document.getElementById('btn-register-part-add');
            pt.onclick = (e) => { e.stopPropagation(); document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== pd) d.classList.remove('show'); }); pd.classList.toggle('show'); };
            pa.onclick = (e) => { e.stopPropagation(); pd.classList.remove('show'); };
        }
    }

    // [추가] 작업자 선택 드롭다운 동적 생성 및 렌더링 (공수 입력칸 대체)
    let mdHidden = document.getElementById('register-md');
    let workerHidden = document.getElementById('register-worker-hidden');

    if (mdHidden && !document.getElementById('register-worker-wrapper')) {
        // 공수 라벨을 작업자로 변경
        const mdLabel = mdHidden.previousElementSibling;
        if (mdLabel && mdLabel.tagName === 'LABEL') {
            mdLabel.textContent = '작업자';
        }

        if (!workerHidden) {
            workerHidden = document.createElement('input');
            workerHidden.type = 'hidden';
            workerHidden.id = 'register-worker-hidden';
            mdHidden.parentNode.insertBefore(workerHidden, mdHidden);
        }

        const wrapper = document.createElement('div');
        wrapper.id = 'register-worker-wrapper';
        wrapper.className = 'log-select-wrapper';
        wrapper.style.flex = '1';
        wrapper.style.minWidth = '100px';
        wrapper.style.margin = '0';

        const templateContent = getTemplateContent('register-worker-template');
        if (templateContent) {
            wrapper.appendChild(templateContent);
        }
        mdHidden.parentNode.insertBefore(wrapper, mdHidden);
        mdHidden.type = 'hidden'; // 공수 입력칸 숨김 처리
    }

    const workerTrigger = document.getElementById('register-worker-trigger');
    const workerDropdown = document.getElementById('register-worker-dropdown');
    const workerSearch = document.getElementById('register-worker-search');
    const workerList = document.getElementById('register-worker-list');
    const workerConfirmBtn = document.getElementById('btn-register-worker-confirm');

    // 생성 후 변수 재할당
    workerHidden = document.getElementById('register-worker-hidden');
    mdHidden = document.getElementById('register-md');

    if (workerTrigger && workerDropdown) {
        workerTrigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== workerDropdown) d.classList.remove('show'); });
            workerDropdown.classList.toggle('show');
            if (workerDropdown.classList.contains('show')) renderRegisterWorkers(workerSearch ? workerSearch.value.trim() : '');
        };

        const renderRegisterWorkers = async (searchTerm = '') => {
            // [수정] 선택된 사업장을 기준으로 작업자 목록을 가져옴
            const siteSelect = document.getElementById('register-site-select');
            const site = siteSelect ? siteSelect.value : null;
            const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(site) : [];
            const currentSelected = workerHidden.value ? workerHidden.value.split(',').map(s => s.trim()).filter(Boolean) : [];
            const allWorkers = workers.map(w => typeof w === 'string' ? { name: w, department: '', position: '', site: '' } : w);
            let displayWorkers = allWorkers;

            if (searchTerm) {
                const kw = searchTerm.toLowerCase();
                displayWorkers = allWorkers.filter(w => w.name.toLowerCase().includes(kw) || w.department.toLowerCase().includes(kw) || w.position.toLowerCase().includes(kw));
            }

            // [요청] 검색 시에도 기존 선택 항목이 사라지지 않도록 보정
            const displayedNames = new Set(displayWorkers.map(w => w.name));
            currentSelected.forEach(selectedName => {
                if (!displayedNames.has(selectedName)) {
                    const workerToAdd = allWorkers.find(w => w.name === selectedName);
                    if (workerToAdd) displayWorkers.unshift(workerToAdd);
                    else displayWorkers.unshift({ name: selectedName, department: '', position: '' });
                }
            });

            // 선택된 이름이 최상단으로 오도록 정렬
            const userSite = sessionStorage.getItem('userSite') || '';
            displayWorkers.sort((a, b) => {
                const aSelected = currentSelected.includes(a.name);
                const bSelected = currentSelected.includes(b.name);
                if (aSelected && !bSelected) return -1;
                if (!aSelected && bSelected) return 1;

                // [추가] 로그인한 계정과 같은 사업장 작업자 우선 정렬
                const aIsSameSite = a.site === userSite;
                const bIsSameSite = b.site === userSite;
                if (aIsSameSite && !bIsSameSite) return -1;
                if (!aIsSameSite && bIsSameSite) return 1;

                return a.name.localeCompare(b.name); // 이름순 정렬
            });

            renderWorkerListItems(workerList, displayWorkers, currentSelected, () => {
                updateRegisterWorkerSelection();
            });
        };

        const updateRegisterWorkerSelection = () => {
            const selected = Array.from(workerList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
            workerHidden.value = selected.join(', ');
            if (selected.length > 0) workerTrigger.textContent = selected.join(' ');
            else workerTrigger.textContent = '작업자 선택';
            workerTrigger.title = selected.join(', ');
            workerTrigger.classList.remove('error-border');
            if (workerHidden.value) workerTrigger.classList.add('has-value');
            else workerTrigger.classList.remove('has-value');

            // [추가] 작업자 수에 맞춰 공수 자동 계산
            if (mdHidden) mdHidden.value = selected.length;
        };

        if (workerSearch) {
            workerSearch.onclick = (e) => e.stopPropagation();
            workerSearch.oninput = (e) => renderRegisterWorkers(e.target.value.trim());
        }
        if (workerConfirmBtn) workerConfirmBtn.onclick = (e) => { e.stopPropagation(); workerDropdown.classList.remove('show'); };
    }
}

function openRegisterScheduleModal(dateStr, presetData = null) {
    const modal = document.getElementById('register-schedule-modal');
    const dateDisplay = document.getElementById('register-date-display');
    const siteSelect = document.getElementById('register-site-select');
    const equipSelect = document.getElementById('register-equip-select');
    const typeSelect = document.getElementById('register-type-select');

    if (!modal) return;

    // [추가] 팝업 진입 경로에 따라 모달 타이틀 동적 변경
    const modalTitle = modal.querySelector('.modal-header h3');
    if (modalTitle) {
        if (window.currentAddWorkLogId) {
            modalTitle.textContent = '추가 작업 등록';
        } else {
            modalTitle.textContent = '작업 등록';
        }
    }

    if (dateDisplay) dateDisplay.value = dateStr;

    const data = getDeviceDataMap();
    const mdInput = document.getElementById('register-md');
    const workerHidden = document.getElementById('register-worker-hidden');
    const workerTrigger = document.getElementById('register-worker-trigger');

    if (workerHidden && workerTrigger) {
        // 로그인한 사용자 이름으로 초기 설정
        const userName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';

        if (presetData && presetData.worker) {
            // [추가] 추가작업 등록 등 presetData에 작업자가 있는 경우
            workerHidden.value = presetData.worker;
            workerTrigger.textContent = presetData.worker;
            workerTrigger.title = presetData.worker;
            workerTrigger.classList.add('has-value');
            if (mdInput) mdInput.value = presetData.worker.split(',').filter(Boolean).length;
        } else if (userName && !presetData) {
            workerHidden.value = userName;
            workerTrigger.textContent = userName;
            workerTrigger.title = userName;
            workerTrigger.classList.add('has-value');
            if (mdInput) mdInput.value = 1;
        } else {
            workerHidden.value = '';
            workerTrigger.textContent = '작업자 선택';
            workerTrigger.title = '';
            workerTrigger.classList.remove('has-value');
            if (mdInput) mdInput.value = '';
        }
    }

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
                const equipTrigger = document.getElementById('register-equip-trigger');
                if (equipTrigger) {
                    const parts = targetValue.split('::');
                    const name = parts[0] || '';
                    const serial = parts.length > 1 ? parts[1] : '';
                    const key = `details_${currentSearchFilters.site}_${targetValue}`;
                    const detailData = JSON.parse(localStorage.getItem(key)) || {};
                    const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                    let displayValue = name;
                    if (custName) {
                        displayValue = `${name} [${custName}]`;
                    } else if (serial) {
                        displayValue = `${name} [${serial}]`;
                    }

                    equipTrigger.textContent = displayValue;
                    equipTrigger.title = displayValue;
                    equipTrigger.style.color = '#fff';
                    equipTrigger.classList.add('has-value');
                }
            }
        }
    }

    if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();

    // [추가] presetData가 있으면 폼 필드 미리 채우기
    if (presetData) {
        const rTypeSelect = document.getElementById('register-type-select');
        const rDetailTypeSelect = document.getElementById('register-detail-type-select');
        const rDetailType2Select = document.getElementById('register-detail-type2-select');

        if (rTypeSelect && presetData.type) {
            rTypeSelect.value = presetData.type; // [수정] presetData.type으로 초기화
            rTypeSelect.dispatchEvent(new Event('change'));
        }

        setTimeout(() => {
            let targetDetailType = presetData.detailType || '';
            let targetDetailType2 = presetData.detailType2 || '';

            // [추가] 괄호 [ ] 또는 부등호 > 가 포함된 경우 파싱하여 분리
            if (targetDetailType.includes('[')) {
                const parts = targetDetailType.split('[');
                targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].replace(']', '').trim();
            } else if (targetDetailType.includes(' > ')) {
                const parts = targetDetailType.split(' > ');
                targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].trim();
            }

            if (targetDetailType2.includes('[')) {
                const parts = targetDetailType2.split('[');
                if (!targetDetailType || targetDetailType === targetDetailType2) targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].replace(']', '').trim();
            } else if (targetDetailType2.includes(' > ')) {
                const parts = targetDetailType2.split(' > ');
                if (!targetDetailType || targetDetailType === targetDetailType2) targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].trim();
            }

            if (rDetailTypeSelect && targetDetailType) {
                // [추가] 세부 구분 옵션에 없는 경우 강제 추가하여 데이터 유실 방지
                let hasOption = Array.from(rDetailTypeSelect.options).some(opt => opt.value === targetDetailType);
                if (!hasOption) {
                    const opt = document.createElement('option');
                    opt.value = targetDetailType;
                    opt.textContent = targetDetailType;
                    rDetailTypeSelect.appendChild(opt);
                }
                rDetailTypeSelect.value = targetDetailType;
                rDetailTypeSelect.dispatchEvent(new Event('change'));
            }

            setTimeout(() => {
                if (rDetailType2Select && targetDetailType2) {
                    let hasOption2 = Array.from(rDetailType2Select.options).some(opt => opt.value === targetDetailType2);
                    if (!hasOption2) {
                        const opt = document.createElement('option');
                        opt.value = targetDetailType2;
                        opt.textContent = targetDetailType2;
                        rDetailType2Select.appendChild(opt);
                    }
                    rDetailType2Select.value = targetDetailType2;
                    rDetailType2Select.dispatchEvent(new Event('change'));
                }

                // [수정] presetData.content로 내용 필드 미리 채우기
                const contentInput = document.getElementById('register-content-input');
                const contentWrapper = document.getElementById('register-content-wrapper');
                const contentTrigger = document.getElementById('register-content-trigger');

                if (contentWrapper && contentWrapper.style.display !== 'none') {
                    if (contentTrigger) {
                        if (presetData.content) {
                            contentTrigger.textContent = presetData.content;
                            contentTrigger.title = presetData.content;
                            contentTrigger.classList.add('has-value'); // [추가] 색상 변경 트리거
                        } else {
                            contentTrigger.textContent = '항목 선택';
                            contentTrigger.title = '';
                            contentTrigger.classList.remove('has-value'); // [추가] 초기 상태로 리셋
                        }
                        // 드롭다운 리스트의 실제 항목 선택은 복잡하므로, 여기서는 트리거 텍스트만 설정
                    }
                } else if (contentInput) {
                    contentInput.value = presetData.content || '';
                }

                const partRow = document.getElementById('register-part-row');
                if (partRow) {
                    partRow.style.display = 'none';
                    const partTrigger = document.getElementById('register-part-trigger');
                    if (partTrigger) partTrigger.textContent = '물품 선택';
                }
            }, 100);
        }, 100);
    }

    modal.style.display = 'flex';

    setTimeout(() => {
        if (typeof window.updateRegisterInputStates === 'function') window.updateRegisterInputStates();
    }, 50);
}

function updateRegisterEquipSelect(site) {
    const equipSelect = document.getElementById('register-equip-select');
    const equipTrigger = document.getElementById('register-equip-trigger');
    const equipSuggestionList = document.getElementById('register-equip-suggestions');
    const equipSearch = document.getElementById('register-equip-search');
    const equipDropdown = document.getElementById('register-equip-dropdown');

    equipSelect.innerHTML = '<option value="">장비 선택</option>';

    if (equipTrigger) {
        if (!site) {
            equipTrigger.textContent = '사업장을 먼저 선택해주세요';
            equipTrigger.title = '';
            equipTrigger.classList.add('disabled');
            equipTrigger.style.color = '#8b949e';
            equipTrigger.style.cursor = 'not-allowed';
            equipTrigger.style.opacity = '0.5';
            if (equipSearch) equipSearch.value = '';
        } else {
            equipTrigger.textContent = '장비 선택';
            equipTrigger.title = '';
            equipTrigger.classList.remove('disabled');
            equipTrigger.style.color = '#fff';
            equipTrigger.style.cursor = 'pointer';
            equipTrigger.style.opacity = '1';
            if (equipSearch) equipSearch.value = '';
        }
    }

    if (!site) {
        equipSelect.disabled = true;
        if (equipSuggestionList) equipSuggestionList.innerHTML = '';
        return;
    }

    const data = getDeviceDataMap();
    const equips = data[site] || [];

    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        const name = parts[0] || '';
        const serial = parts.length > 1 ? parts[1] : '';
        const key = `details_${site}_${equip}`;
        const detailData = JSON.parse(localStorage.getItem(key)) || {};
        const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
        
        let displayValue = name;
        if (custName) {
            displayValue = `${name} [${custName}]`;
        } else if (serial) {
            displayValue = `${name} [${serial}]`;
        }
        option.textContent = displayValue;
        equipSelect.appendChild(option);
    });

    equipSelect.disabled = false;

    if (equipSuggestionList) {
        window.renderEquipSuggestions = (searchTerm = '') => {
            equipSuggestionList.innerHTML = '';
            const keywords = searchTerm.toLowerCase().split(/\s+/);

            let matches = equips.filter(equip => {
                const parts = equip.split('::');
                const name = parts[0] || '';
                const serial = parts.length > 1 ? parts[1] : '';

                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                const text = `${name} ${serial} ${custName}`.toLowerCase();
                return keywords.every(kw => text.includes(kw));
            });

            if (matches.length > 0) {
                matches.forEach(equip => {
                    const parts = equip.split('::');
                    const name = parts[0] || '';
                    const serial = parts.length > 1 ? parts[1] : '';

                    const key = `details_${site}_${equip}`;
                    const detailData = JSON.parse(localStorage.getItem(key)) || {};
                    const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                    const tpl = getTemplateContent('equip-suggestion-item-template');
                    if (tpl) {
                        const li = tpl.querySelector('.log-select-item');
                        
                        let displayValueHtml = escapeHtml(name);
                        if (custName) {
                            displayValueHtml += ` <span style="color:#3fb950;">[${escapeHtml(custName)}]</span>`;
                        } else if (serial) {
                            displayValueHtml += ` <span style="color:#3fb950;">[${escapeHtml(serial)}]</span>`;
                        }

                        // 기존 템플릿의 분리된 구조를 무시하고 자연스럽게 한 줄에 표시
                        const contentDiv = li.querySelector('.suggestion-item-content') || li;
                        contentDiv.innerHTML = `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayValueHtml}</span>`;

                        li.addEventListener('mousedown', (e) => {
                            e.preventDefault();
                            equipSelect.value = equip;

                            let displayValue = name;
                            if (custName) {
                                displayValue = `${name} [${custName}]`;
                            } else if (serial) {
                                displayValue = `${name} [${serial}]`;
                            }
                            equipTrigger.textContent = displayValue;
                            equipTrigger.title = displayValue;
                            equipTrigger.classList.remove('error-border');
                            equipTrigger.classList.add('has-value');

                            equipSuggestionList.style.display = 'none';
                            if (equipDropdown) equipDropdown.classList.remove('show');
                            if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
                            if (typeof window.updateRegisterInputStates === 'function') window.updateRegisterInputStates();
                        });
                        equipSuggestionList.appendChild(li);
                    }
                });
                equipSuggestionList.style.display = 'block';
            } else {
                equipSuggestionList.innerHTML = '<div class="log-select-empty-msg" style="padding: 10px;">검색 결과가 없습니다.</div>';
                equipSuggestionList.style.display = 'block';
            }
        };
    }

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
    const workerHidden = document.getElementById('register-worker-hidden');
    const worker = workerHidden ? workerHidden.value.trim() : '';

    let lastProcessedId = null; // [추가] 등록된 작업 ID 추적

    let hasError = false;
    const checkField = (id) => {
        const el = document.getElementById(id);
        if (id === 'register-equip-select' && document.getElementById('register-equip-trigger')) {
            const triggerEl = document.getElementById('register-equip-trigger');
            if (!el.value) {
                triggerEl.classList.add('error-border');
                hasError = true;
            }
            return;
        }
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

    if (!worker) {
        const workerTrigger = document.getElementById('register-worker-trigger');
        if (workerTrigger) workerTrigger.classList.add('error-border');
        hasError = true;
    }

    let content = '';
    const wrapper = document.getElementById('register-content-wrapper');
    if (wrapper && wrapper.style.display !== 'none') {
        const selected = document.querySelectorAll('#register-content-list .log-select-item.selected');
        content = Array.from(selected).map(el => {
            const costSelect = el.querySelector('.item-cost-select');
            return costSelect ? `[${costSelect.value}] ${el.dataset.value}` : el.dataset.value;
        }).join(', ');
    } else {
        const input = document.getElementById('register-content-input');
        if (input) {
            content = input.value.trim();
        }
    }

    // [추가] 파트 내용 병합
    const partRow = document.getElementById('register-part-row');
    if (partRow && partRow.style.display !== 'none') {
        const partList = document.getElementById('register-part-list');
        if (partList) {
            const selectedParts = partList.querySelectorAll('.log-select-item.selected');
            const partContent = Array.from(selectedParts).map(el => {
                const cSel = el.querySelector('.item-cost-select');
                return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
            }).join(', ');
            if (!partContent) return alert('교체/수리할 물품을 선택해주세요.');
            content = `${content} - ${partContent}`;
        }
    }

    if (hasError) return alert('빨간색 테두리로 표시된 필수 항목을 모두 입력/선택해주세요.');

    const finalDetailType = (type === '비정기' && detailType2) ? `${detailType} > ${detailType2}` : detailType;

    // [수정] 추가 작업 등록일 경우, 점검 이력(log)으로 바로 등록
    if (window.currentAddWorkLogId) {
        const key = `details_${site}_${equip}`;
        let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [] };
        if (!data.logs) data.logs = [];

        const newLogId = Date.now();

        const newLog = {
            id: newLogId,
            date: dateStr,
            type: type,
            detailType: finalDetailType,
            content: content,
            costType: costType,
            md: md,
            worker: worker,
            memo: '',
            isIssueShared: false,
            originalLogId: window.currentAddWorkLogId
        };
        data.logs.push(newLog);

        const originalLog = data.logs.find(l => l.id === window.currentAddWorkLogId);
        if (originalLog) {
            originalLog.addWorkLogId = newLogId;
        }

        localStorage.setItem(key, JSON.stringify(data));

        if (typeof addSystemLog === 'function') {
            addSystemLog('ADD_LOG_EXTRA', equip, `Added extra work for log ${window.currentAddWorkLogId}`);
        }

        document.getElementById('register-schedule-modal').style.display = 'none';

        if (typeof window.handleExtraWorkAdded === 'function') {
            window.handleExtraWorkAdded(newLogId);
        }

        window.currentAddWorkLogId = null;
    } else {
        // 기존 로직: 예정일(maint) 등록
        const key = `details_${site}_${equip}`;
        let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [] };
        if (!data.maint) data.maint = [];

        const itemsList = content ? content.split(', ').map(s => s.trim()).filter(s => s) : ['내용 없음'];

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
                existingItem.worker = worker; // [추가]
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
                    worker: worker, // [추가]
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
    const rDetailType2Row = document.getElementById('register-detail-type2-row');

    if (!rTypeSelect || !rDetailTypeSelect) return;
    const type = rTypeSelect.value;
    rDetailTypeSelect.innerHTML = '';

    if (!type) {
        rDetailTypeSelect.innerHTML = '<option value="">구분 먼저 선택</option>';
        rDetailTypeSelect.disabled = true;
        if (rDetailType2Select) {
            rDetailType2Select.style.display = 'none';
            rDetailType2Select.value = '';
            if (rDetailType2Row) rDetailType2Row.style.display = 'none';
        }
        updateRegisterContentOptions();
        return;
    }

    rDetailTypeSelect.disabled = false;

    if (rDetailType2Select) {
        if (type === '비정기') {
            rDetailType2Select.style.display = 'inline-block';
            if (rDetailType2Row) rDetailType2Row.style.display = 'none'; // [수정] 폼 합치면서 기존 행 숨김 유지
        } else {
            rDetailType2Select.style.display = 'none';
            rDetailType2Select.value = '';
            if (rDetailType2Row) rDetailType2Row.style.display = 'none';
        }
    }

    const equipKey = rEquipSelect ? rEquipSelect.value : '';
    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    const key = `${equipKey}::${type}`;
    const defaultSubCategories = {
        '정기': ['PM 점검'],
        '비정기': ['BM 점검', 'Alarm', 'Hunting', 'Data / Para 이상', '기타'],
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
        'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈'],
        '기타': ['배수 펌프 이슈', '구동 이상']
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
        } else if (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체') {
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

        let registeredSet = new Set();
        if (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체') {
            detailData.maint.forEach(m => {
                registeredSet.add(m.content);
                if (m.code) registeredSet.add(m.code);
            });
        } else {
            detailData.maint.filter(m => m.type === type && m.detailType === detailType).forEach(m => {
                registeredSet.add(m.content);
                if (m.code) registeredSet.add(m.code);
            });
        }

        let registeredItems = [];
        let otherItems = [];

        // [수정] PM/BM 점검일 경우, 제안 박스의 "전체 물품"이 시스템에 등록된 모든 물품을 의미하도록 풀(pool) 확장
        let poolItems = uniqueItems;
        if (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체') {
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

            list.innerHTML = '';
            displayItems.forEach(item => {
                const val = item.code ? item.code : item.content;
                const isSelected = currentSelections.hasOwnProperty(val);
                const itemCost = isSelected ? currentSelections[val] : '유상';

                const templateId = (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체')
                    ? 'log-part-item-template' : 'detail-content-item-template';

                const tpl = getTemplateContent(templateId);
                if (tpl) {
                    const div = tpl.querySelector('.log-select-item');
                    if (isSelected) div.classList.add('selected');
                    div.dataset.value = val;
                    div.querySelector('.item-name').textContent = val;

                    const cSel = div.querySelector('.item-cost-select');
                    if (cSel) {
                        cSel.value = itemCost;
                        cSel.addEventListener('click', e => e.stopPropagation());
                        cSel.addEventListener('change', (e) => {
                            e.stopPropagation();
                            if (div.classList.contains('selected')) updateTriggerText();
                        });
                    }

                    div.addEventListener('click', (e) => {
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

                        // 파트 연동 처리
                        const partRow = document.getElementById('register-part-row');
                        if (partRow) {
                            const selectedItems = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
                            const isPartIssue = selectedItems.some(v => v.includes('파트 이상 (교체)') || v.includes('파트 이상 (수리)') || v.includes('용액 / 용자 이상'));
                            partRow.style.display = isPartIssue ? 'flex' : 'none';
                            if (isPartIssue && typeof window.renderLogPartOptions === 'function') {
                                window.renderLogPartOptions('register-part-wrapper', 'register-part-trigger', 'register-part-list', 'register-part-search');
                            }
                        }
                    });

                    list.appendChild(div);
                }
            });

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
        if (detailType === 'PM 점검' || detailType === 'BM 점검' || detailType === 'Parts 교체') {
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
        resetBtn.textContent = '내 사업장 검색';
        resetBtn.onclick = () => {
            const userSite = sessionStorage.getItem('userSite') || '';
            if (siteSelect) siteSelect.value = userSite;
            updateSearchEquipSelect(userSite);
            if (equipSelect) equipSelect.value = '';
            currentSearchFilters = { site: userSite, equip: '' };
            modal.style.display = 'none';
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

        // [추가] 장비 검색 제안 박스 이벤트 연동
        const searchTrigger = document.getElementById('search-equip-trigger');
        const searchDropdown = document.getElementById('search-equip-dropdown');
        const searchInput = document.getElementById('search-equip-search');
        
        if (searchTrigger && searchDropdown) {
            searchTrigger.onclick = (e) => {
                e.stopPropagation();
                if (searchTrigger.classList.contains('disabled')) return;
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== searchDropdown) d.classList.remove('show'); });
                searchDropdown.classList.toggle('show');
                if (searchDropdown.classList.contains('show') && window.renderSearchEquipSuggestions) {
                    window.renderSearchEquipSuggestions(searchInput ? searchInput.value.trim() : '');
                    if (searchInput) searchInput.focus();
                }
            };
        }
        
        if (searchInput) {
            searchInput.onclick = (e) => e.stopPropagation();
            searchInput.oninput = (e) => {
                if (window.renderSearchEquipSuggestions) window.renderSearchEquipSuggestions(e.target.value.trim());
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
        
        // [추가] 팝업을 열었을 때 기존에 선택된 장비 정보 복원
        if (currentSearchFilters.equip) {
            if (equipSelect) equipSelect.value = currentSearchFilters.equip;
            const trigger = document.getElementById('search-equip-trigger');
            if (trigger) {
                const parts = currentSearchFilters.equip.split('::');
                const name = parts[0] || '';
                const serial = parts.length > 1 ? parts[1] : '';
                const key = `details_${currentSearchFilters.site}_${currentSearchFilters.equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                let displayValueHtml = escapeHtml(name);
                let subInfoHtml = '';
                if (custName) {
                    subInfoHtml = ` <span style="color:#3fb950;">[${escapeHtml(custName)}]</span>`;
                } else if (serial) {
                    subInfoHtml = ` <span style="color:#3fb950;">[${escapeHtml(serial)}]</span>`;
                }
                trigger.innerHTML = `${displayValueHtml}${subInfoHtml}`;
            }
        }

    modal.style.display = 'flex';
}

function updateSearchEquipSelect(site) {
    const equipSelect = document.getElementById('search-equip-select');
    const trigger = document.getElementById('search-equip-trigger');
    const list = document.getElementById('search-equip-list');
    const searchInput = document.getElementById('search-equip-search');
    const dropdown = document.getElementById('search-equip-dropdown');

    if (equipSelect) {
        equipSelect.innerHTML = '<option value="">전체 장비</option>';
        equipSelect.value = '';
    }

    if (trigger) {
        if (!site) {
            trigger.textContent = '사업장을 먼저 선택해주세요';
            trigger.classList.add('disabled');
            trigger.style.color = '#8b949e';
            trigger.style.cursor = 'not-allowed';
            trigger.style.opacity = '0.5';
            if (searchInput) searchInput.value = '';
            if (list) list.innerHTML = '';
            return;
        } else {
            trigger.textContent = '전체 장비';
            trigger.classList.remove('disabled');
            trigger.style.color = '#fff';
            trigger.style.cursor = 'pointer';
            trigger.style.opacity = '1';
            if (searchInput) searchInput.value = '';
        }
    }

    if (!site) return;

    const data = getDeviceDataMap();
    const equips = data[site] || [];

    if (equipSelect) {
        equips.forEach(equip => {
            const option = document.createElement('option');
            option.value = equip;
            equipSelect.appendChild(option);
        });
    }

    // 제안 박스 렌더링 로직
    window.renderSearchEquipSuggestions = (searchTerm = '') => {
        if (!list) return;
        list.innerHTML = '';
        const keywords = searchTerm.toLowerCase().split(/\s+/);

        let matches = equips.filter(equip => {
            const parts = equip.split('::');
            const name = parts[0] || '';
            const serial = parts.length > 1 ? parts[1] : '';
            const key = `details_${site}_${equip}`;
            const detailData = JSON.parse(localStorage.getItem(key)) || {};
            const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

            const text = `${name} ${serial} ${custName}`.toLowerCase();
            return keywords.every(kw => text.includes(kw));
        });

        if (searchTerm === '') {
            const allLi = document.createElement('div');
            allLi.className = 'log-select-item';
            allLi.style.padding = '10px 8px';
            allLi.innerHTML = `<span>전체 장비</span>`;
            allLi.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                if (equipSelect) equipSelect.value = '';
                trigger.textContent = '전체 장비';
                trigger.title = '전체 장비';
                trigger.style.color = '#fff';
                if (dropdown) dropdown.classList.remove('show');
            });
            list.appendChild(allLi);
        }

        if (matches.length > 0) {
            matches.forEach(equip => {
                const parts = equip.split('::');
                const name = parts[0] || '';
                const serial = parts.length > 1 ? parts[1] : '';

                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                let displayValueHtml = escapeHtml(name);
                let subInfoHtml = '';
                if (custName) {
                    subInfoHtml = ` <span style="color:#3fb950;">[${escapeHtml(custName)}]</span>`;
                } else if (serial) {
                    subInfoHtml = ` <span style="color:#3fb950;">[${escapeHtml(serial)}]</span>`;
                }

                let plainDisplayValue = name;
                if (custName) plainDisplayValue += ` [${custName}]`;
                else if (serial) plainDisplayValue += ` [${serial}]`;

                const li = document.createElement('div');
                li.className = 'log-select-item';
                li.style.padding = '10px 8px';
                li.innerHTML = `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayValueHtml}${subInfoHtml}</span>`;

                li.addEventListener('mousedown', (ev) => {
                    ev.preventDefault();
                    if (equipSelect) equipSelect.value = equip;
                    trigger.innerHTML = `${escapeHtml(name)}${subInfoHtml}`;
                    trigger.title = plainDisplayValue;
                    if (dropdown) dropdown.classList.remove('show');
                });
                list.appendChild(li);
            });
        } else {
            list.innerHTML = '<div class="log-select-empty-msg" style="padding: 10px; color:#8b949e; text-align:center;">검색 결과가 없습니다.</div>';
        }
    };
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

        const key = `details_${site}_${equip}`;
        const data = JSON.parse(localStorage.getItem(key)) || {};
        const firstItem = data.maint ? data.maint.find(i => i.id === ids[0]) : null;

        // [추가] 원래 있던 일자와 동일한 위치에 드롭 시 무시
        if (firstItem && firstItem.scheduledDate === newDate) {
            return;
        }

        if (confirm(`${ids.length}건의 일정을 ${newDate}로 이동하시겠습니까?`)) {
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
                setScheduleDate(site, equip, id, newDate, false, null, null, reason);
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

// [추가] 월별 작업 예정 확정 취소 함수 (최종관리자 전용)
window.cancelMonthScheduleConfirm = function (site, year, month) {
    if (sessionStorage.getItem('userRole') !== 'superadmin') {
        alert('최종 관리자 권한이 필요합니다.');
        return;
    }

    if (!confirm(`[${site}] ${year}년 ${month + 1}월의 예정 확정을 취소하시겠습니까?\n취소 후에는 일정 변경 및 삭제 시 사유를 묻지 않습니다.`)) {
        return;
    }

    const confs = JSON.parse(localStorage.getItem('calendar_confirmations')) || {};
    const yyyyMm = `${year}-${String(month + 1).padStart(2, '0')}`;

    if (confs[yyyyMm]) {
        if (confs[yyyyMm][site]) {
            delete confs[yyyyMm][site];
        } else if (confs[yyyyMm].siteCounts && confs[yyyyMm].siteCounts[site] !== undefined) {
            delete confs[yyyyMm].siteCounts[site];
        }

        localStorage.setItem('calendar_confirmations', JSON.stringify(confs));

        if (typeof addSystemLog === 'function') {
            addSystemLog('CANCEL_CONFIRM_SCHEDULE', yyyyMm, `[${site}] 작업 확정 취소`);
        }
        renderCalendar();
    }
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

/* ==========================================================================
   [10] 모달: 작업 검색 (Task Search Modal)
   ========================================================================== */
function setupTaskSearchModal() {
    if (document.getElementById('task-search-modal')) return;

    const templateContent = getTemplateContent('task-search-modal-template');
    if (templateContent) {
        document.body.appendChild(templateContent);
    }

    document.getElementById('btn-close-task-search-modal').onclick = () => {
        document.getElementById('task-search-modal').style.display = 'none';
    };
    document.getElementById('btn-do-task-search').onclick = doTaskSearch;

    const keywordInput = document.getElementById('task-search-keyword-input');
    if (keywordInput) {
        keywordInput.onkeypress = (e) => {
            if (e.key === 'Enter') doTaskSearch();
        };
    }

    const startDateInput = document.getElementById('task-search-start-date');
    const endDateInput = document.getElementById('task-search-end-date');
    if (startDateInput) startDateInput.addEventListener('change', doTaskSearch);
    if (endDateInput) endDateInput.addEventListener('change', doTaskSearch);
}

function openTaskSearchModal() {
    const modal = document.getElementById('task-search-modal');
    const keywordInput = document.getElementById('task-search-keyword-input');
    const resultsList = document.getElementById('task-search-results-list');
    const startDateInput = document.getElementById('task-search-start-date');
    const endDateInput = document.getElementById('task-search-end-date');

    if (modal) {
        resultsList.innerHTML = '<li class="list-empty-msg">검색어(작업자, 장비명 등)를 입력하고 검색하세요.</li>';

        // Set default date range (today - 15 days to today + 15 days)
        const today = new Date();
        const pastDate = new Date(today);
        pastDate.setDate(today.getDate() - 15);
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + 15);

        startDateInput.value = pastDate.toISOString().substring(0, 10);
        endDateInput.value = futureDate.toISOString().substring(0, 10);

        const userName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId');
        keywordInput.value = userName || '';
        modal.style.display = 'flex';
        doTaskSearch(); // Open and search immediately
    }
}

function doTaskSearch() {
    const keywordInput = document.getElementById('task-search-keyword-input');
    const keyword = keywordInput.value.trim().toLowerCase();
    const resultsList = document.getElementById('task-search-results-list');
    const startDate = document.getElementById('task-search-start-date').value;
    const endDate = document.getElementById('task-search-end-date').value;

    if (!keyword && !startDate && !endDate) {
        resultsList.innerHTML = '<li class="list-empty-msg">검색어를 입력하거나 기간을 선택하세요.</li>';
        return;
    }

    let allTasks = [];
    const mainData = getDeviceDataMap();

    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            mainData[site].forEach(equip => {
                const key = `details_${site}_${equip}`;
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (!data) return;
                    const custEquipName = (data.setup && data.setup.custEquipName) ? data.setup.custEquipName : '';

                    // Helper to check if a date falls within the range
                    const isDateInRange = (taskDate) => {
                        if (!taskDate) return false;
                        const taskDateObj = new Date(taskDate);
                        taskDateObj.setHours(0, 0, 0, 0); // Normalize to start of day
                        const start = startDate ? new Date(startDate) : null;
                        const end = endDate ? new Date(endDate) : null;
                        if (start) start.setHours(0, 0, 0, 0);
                        if (end) end.setHours(0, 0, 0, 0);

                        return (!start || taskDateObj >= start) && (!end || taskDateObj <= end);
                    };

                    // 1. Completed tasks from logs
                    if (data.logs) {
                        data.logs.forEach(log => {
                            const logWorker = log.worker ? log.worker.toLowerCase() : '';
                            const logContent = log.content ? log.content.toLowerCase() : '';
                            const equipName = equip.split('::')[0].toLowerCase();

                            const matchesKeyword = !keyword || (
                                logWorker.includes(keyword) ||
                                equipName.includes(keyword) ||
                                logContent.includes(keyword) ||
                                custEquipName.toLowerCase().includes(keyword)
                            );

                            if (log.detailType !== '일정변경' && matchesKeyword && isDateInRange(log.date)) {
                                allTasks.push({ site, equip, item: log, isCompleted: true, custEquipName: custEquipName });
                            }
                        });
                    }

                    // 2. Scheduled tasks from maint
                    if (data.maint) {
                        data.maint.forEach(item => {
                            const itemWorker = item.worker ? item.worker.toLowerCase() : '';
                            const itemContent = item.content ? item.content.toLowerCase() : '';
                            const equipName = equip.split('::')[0].toLowerCase();

                            const matchesKeyword = !keyword || (
                                itemWorker.includes(keyword) ||
                                equipName.includes(keyword) ||
                                itemContent.includes(keyword) ||
                                custEquipName.toLowerCase().includes(keyword)
                            );

                            if (item.scheduledDate && matchesKeyword && isDateInRange(item.scheduledDate)) {
                                // Check if this scheduled item has already been completed and logged
                                const isDone = data.logs && data.logs.some(l =>
                                    l.date === item.scheduledDate &&
                                    l.content.includes(item.content) &&
                                    l.worker.includes(item.worker)
                                );
                                if (!isDone) {
                                    allTasks.push({ site, equip, item: item, isCompleted: false, custEquipName: custEquipName });
                                }
                            }
                        });
                    }
                } catch (e) { console.error(`Error parsing data for key ${key}:`, e); }
            });
        }
    });

    // [수정] 같은 날, 같은 장비 작업 그룹화
    const groupedTasks = {};
    allTasks.forEach(task => {
        const date = task.isCompleted ? task.item.date : task.item.scheduledDate;
        const type = task.item.type || '정기';
        const detailType = task.item.detailType || '';
        const detailType2 = task.item.detailType2 || '';

        const key = `${date}_${task.site}_${task.equip}_${type}_${detailType}_${detailType2}`;
        if (!groupedTasks[key]) {
            groupedTasks[key] = {
                site: task.site,
                equip: task.equip,
                date: date,
                type: type,
                items: [],
                custEquipName: task.custEquipName,
                isCompleted: true // Assume completed, set to false if any item is not
            };
        }
        groupedTasks[key].items.push(task.item);
        if (!task.isCompleted) {
            groupedTasks[key].isCompleted = false;
        }
    });

    const displayTasks = Object.values(groupedTasks);

    // Sort by date, descending
    displayTasks.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (displayTasks.length === 0) {
        resultsList.innerHTML = '<li class="list-empty-msg">검색된 작업이 없습니다.</li>';
        return;
    }

    resultsList.innerHTML = '';
    displayTasks.forEach(group => {
        const { site, equip, date, type, items, isCompleted, custEquipName } = group;
        const parts = equip.split('::');
        const equipName = parts[0];
        const serialNo = parts.length > 1 ? `[${parts[1]}]` : '';

        // Combine unique values
        const contents = [...new Set(items.map(item => item.content || '내용 없음'))];
        const detailTypes = [...new Set(items.map(item => {
            if (item.detailType2) return item.detailType2;
            if (item.detailType) return item.detailType;
            return item.type || '정기';
        }))];

        const displayContent = contents.join(', ');
        const displayType = type;
        const displayDetailType = detailTypes.join(' | ');

        const tpl = getTemplateContent('task-search-result-item-template');
        if (tpl) {
            const li = tpl.querySelector('li');
            li.addEventListener('click', () => openTaskFromSearch(site, equip, items[0].id, isCompleted));

            li.querySelector('.task-date').textContent = date;

            if (isCompleted) {
                li.classList.add('completed');
                li.querySelector('.completed-status').style.display = 'inline';

                const logItem = items[0];
                const targetLogId = logItem.originalLogId || logItem.id; // 부모/자식 관계없이 원본 작업 ID 기준으로 처리
                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const childLogs = (detailData.logs || []).filter(l => l.originalLogId === targetLogId);
                const hasExtra = childLogs.length > 0;

                const actionContainer = document.createElement('div');
                actionContainer.style.display = 'flex';
                actionContainer.style.gap = '5px';
                actionContainer.style.marginLeft = 'auto'; // 우측 정렬

                const addBtn = document.createElement('button');
                addBtn.className = 'btn-blue-sm';
                addBtn.textContent = '추가';
                addBtn.onclick = (e) => {
                    e.stopPropagation();
                    const presetData = { type: logItem.type, detailType: logItem.detailType, detailType2: logItem.detailType2, content: '', worker: logItem.worker || '' };
                    window.currentSearchFilters = { site: site, equip: equip };
                    window.currentAddWorkLogId = targetLogId;
                    const todayStr = new Date().toISOString().substring(0, 10);
                    window.openRegisterScheduleModal(todayStr, presetData);
                    
                    window.handleExtraWorkAdded = function(newLogId) {
                        alert('추가 작업이 등록되었습니다.');
                        doTaskSearch();
                    };
                };
                actionContainer.appendChild(addBtn);

                if (hasExtra) {
                    const viewBtn = document.createElement('button');
                    viewBtn.className = 'btn-green-sm';
                    viewBtn.textContent = '확인';
                    viewBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (typeof window.openExtraWorkHistoryModal === 'function') window.openExtraWorkHistoryModal(site, equip, targetLogId);
                    };
                    actionContainer.appendChild(viewBtn);
                }
                
                const topDiv = li.querySelector('div:first-child');
                if (topDiv) topDiv.appendChild(actionContainer);
            }

            const typeBadge = li.querySelector('.popup-type-badge');
            typeBadge.className = `popup-type-badge type-${type}`;
            typeBadge.textContent = `[${displayType}]`;

            let subInfo = '';
            if (custEquipName) {
                subInfo = ` <span style="color:#3fb950;">[${escapeHtml(custEquipName)}]</span>`;
            } else if (serialNo) {
                subInfo = ` <span style="color:#3fb950;">${escapeHtml(serialNo)}</span>`;
            }
            li.querySelector('.equip-name').innerHTML = `${escapeHtml(site)} > ${escapeHtml(equipName)}${subInfo}`;

            const detailsSpan = li.querySelector('.task-details');
            detailsSpan.textContent = `${displayDetailType} : ${displayContent}`;
            detailsSpan.title = `${displayDetailType} : ${displayContent}`;

            resultsList.appendChild(li);
        }
    });
}

function openTaskFromSearch(site, equip, id, isCompleted) {
    const searchModal = document.getElementById('task-search-modal');
    if (searchModal) searchModal.style.display = 'none';

    cameFromTaskSearch = true; // [추가] 플래그 설정
    openEventDetailModal(site, equip, id, isCompleted);
}
window.openTaskFromSearch = openTaskFromSearch;