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

// [추가] 공통 함수 폴백 (common.js 누락 대비)
if (typeof window.getHolidayName !== 'function') {
    window.getHolidayName = function(year, month, day) { return null; };
}

// [2] 초기화 (Initialization)
document.addEventListener('DOMContentLoaded', () => {
    setupCalendar();
    setupScheduleModal();
    setupEventDetailModal();
    setupRegisterScheduleModal();
    setupSearchModal();

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
 * 캘린더 표시용 일정 데이터 수집
 */
function getScheduleForCalendar() {
    const events = {};
    const mainData = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

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
                            events[targetDateStr].push({ site, equip, type: item.type || '정기', content: item.content, id: item.id });
                            }
                        });
                    }

                    if (data.logs) {
                        data.logs.forEach(log => {
                            if (log.date) {
                                if (!events[log.date]) events[log.date] = [];
                                events[log.date].push({
                                    site,
                                    equip,
                                type: log.type || '정기',
                                    content: log.content || log.memo || '내용 없음',
                                    id: log.id,
                                    isCompleted: true
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
function setScheduleDate(site, equip, id, dateStr, isDelete = false) {
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    
    if (data.maint) {
        const index = data.maint.findIndex(i => i.id === id);
        if (index > -1) {
            const item = data.maint[index];
            if (isDelete) {
                delete item.scheduledDate;
                // [추가] 일회성 일정은 삭제 시 데이터 자체를 제거하여 누적 방지
                if (!item.period) {
                    data.maint.splice(index, 1);
                }
            } else {
                item.scheduledDate = dateStr;
            }
            localStorage.setItem(key, JSON.stringify(data));
            
            if (typeof addSystemLog === 'function') {
                const action = isDelete ? 'DELETE_SCHEDULE' : 'ADD_SCHEDULE';
                addSystemLog(action, equip, `Date: ${dateStr}, Content: ${item.content}`);
            }
        }
    }
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
}

function toggleCalendarExpand(viewId) {
    const views = document.querySelectorAll('.calendar-view');
    const divider = document.querySelector('.calendar-divider');
    
    if (expandedViewId === viewId) {
        // 이미 확장된 상태면 원래대로 복귀
        expandedViewId = null;
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
    titleEl.style.color = '';
    titleEl.textContent = `${year}년 ${month + 1}월`;
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

            // 그룹화 로직
            const groupedEvents = {};
            dayEvents.forEach(event => {
                const key = `${event.site}::${event.equip}::${event.isCompleted}::${event.type}`;
                if (!groupedEvents[key]) {
                    groupedEvents[key] = {
                        site: event.site,
                        equip: event.equip,
                        isCompleted: event.isCompleted,
                        type: event.type,
                        ids: [] // ID 목록 저장을 위해 배열 초기화
                    };
                }
                groupedEvents[key].ids.push(event.id); // ID 추가
            });

            const groups = Object.values(groupedEvents);
            displayCount = groups.length;

            groups.forEach(group => {
                const equipName = group.equip.split('::')[0];
                const typeClass = `type-${group.type}`;
                const completedClass = group.isCompleted ? 'completed' : '';
                
                // 드래그 속성 추가 (완료되지 않은 항목만)
                let dragAttr = '';
                if (!group.isCompleted) {
                    const idsJson = JSON.stringify(group.ids).replace(/"/g, '&quot;');
                    dragAttr = `draggable="true" data-drag-site="${escapeHtml(group.site)}" data-drag-equip="${escapeHtml(group.equip)}" data-drag-ids="${idsJson}" ondragstart="handleCalendarDragStartFromData(event)" ondragend="this.classList.remove('dragging')"`;
                }

                eventsHtml += `<div class="calendar-event-item ${completedClass} ${typeClass}" ${dragAttr}>
                    ${escapeHtml(group.site)} ${escapeHtml(equipName)} <span class="event-type-text ${typeClass}">${group.type}</span>
                </div>`;
            });
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
        cell.onclick = (e) => { if(!e.defaultPrevented) openCalendarPopup(dateStr, dayEvents); };
        
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
            const key = `${event.site}::${event.equip}::${event.isCompleted}::${event.type}`;
            if (!groupedEvents[key]) {
                groupedEvents[key] = {
                    site: event.site,
                    equip: event.equip,
                    isCompleted: event.isCompleted,
                    type: event.type,
                    items: []
                };
            }
            groupedEvents[key].items.push(event);
        });

        const groupedList = Object.values(groupedEvents);
        groupedList.sort((a, b) => (a.isCompleted === b.isCompleted) ? 0 : a.isCompleted ? 1 : -1);

        groupedList.forEach(group => {
            const li = document.createElement('li');
            li.className = 'popup-event-item';

            const textClass = group.isCompleted ? 'completed' : '';
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
            }

            if (!group.isCompleted) {
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-calendar-del';
                delBtn.textContent = '✕';
                delBtn.title = '일정 삭제';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (confirm('이 작업 예정일을 삭제하시겠습니까?')) {
                        group.items.forEach(item => {
                            setScheduleDate(item.site, item.equip, item.id, '', true);
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
                openEventDetailModal(group.site, group.equip, group.items[0].id, group.isCompleted);
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
    const calendarBtn = document.getElementById('btn-schedule-calendar');
    const dateInput = document.getElementById('schedule-date-input');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    
    if (saveBtn) {
        saveBtn.onclick = () => {
            if (currentScheduleTarget) {
                const date = dateInput.value;
                if (!date) return alert('날짜를 선택해주세요.');
                setScheduleDate(currentScheduleTarget.site, currentScheduleTarget.equip, currentScheduleTarget.id, date);
                modal.style.display = 'none';
                if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                renderCalendar();
            }
        };
    }

    if (delBtn) {
        delBtn.onclick = () => {
            if (currentScheduleTarget && confirm('일정을 삭제하시겠습니까?')) {
                setScheduleDate(currentScheduleTarget.site, currentScheduleTarget.equip, currentScheduleTarget.id, '', true);
                modal.style.display = 'none';
                if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                renderCalendar();
            }
        };
    }

    if (calendarBtn && dateInput) {
        calendarBtn.onclick = () => {
            try { dateInput.showPicker(); } catch (e) { dateInput.focus(); }
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
    if (item && item.scheduledDate) {
        dateInput.value = item.scheduledDate;
    } else {
        dateInput.value = new Date().toISOString().split('T')[0];
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
    document.getElementById('detail-detail-type').textContent = item.detailType || '-';

    // [수정] 같은 날짜, 같은 타입, 세부구분에 예정된 항목들을 모두 표시
    let displayContent = item.content || '';
    if (!isCompleted && item.scheduledDate) {
        const sameDayItems = data.maint.filter(i => i.scheduledDate === item.scheduledDate && i.type === item.type && (i.detailType || '') === (item.detailType || ''));
        if (sameDayItems.length > 0) {
            displayContent = sameDayItems.map(i => i.content).join(', ');
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
        dateRow.style.display = 'block';
        document.getElementById('detail-scheduled-date').value = item.date || '';
        document.getElementById('detail-scheduled-date').disabled = true;
        completeBtn.style.display = 'none';
        saveMemoBtn.style.display = 'none';
        if (editContentBtn) editContentBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'block'; // 완료된 상태면 취소 버튼 표시
    } else {
        // [수정] 저장된 작업자(취소된 내용)가 있으면 우선 사용
        workerInput.value = item.worker || localStorage.getItem('lastWorkerName') || sessionStorage.getItem('userId') || '';
        workerInput.disabled = false;
        
        // [추가] 이전 점검 결과(메모) 불러오기
        let lastMemo = '';
        if (data.logs && data.logs.length > 0) {
            const sortedLogs = [...data.logs].sort((a, b) => {
                if (b.date !== a.date) return b.date.localeCompare(a.date);
                return b.id - a.id;
            });
            if (sortedLogs.length > 0) lastMemo = sortedLogs[0].memo || '';
        }
        // [수정] 저장된 메모(취소된 내용)가 있으면 우선 사용, 없으면 이전 이력 메모 사용
        memoInput.value = item.memo || lastMemo;
        memoInput.disabled = false;
        
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
                const targetType = detailType === 'PM 점검' ? '정기' : '비정기';
                const equipName = equipKey.split('::')[0];
                const matchedItems = adminItems.filter(ai => {
                    if (ai.type !== targetType) return false;
                    if (!ai.equip) return false;
                    const equips = ai.equip.split(',').map(e => e.trim());
                    return equips.includes(equipName);
                });
                availableItems = matchedItems.map(mItem => ({ content: mItem.part, code: mItem.code }));
            }
        }

        const uniqueItems = [];
        const seenContents = new Set();
        availableItems.forEach(ai => {
            if (!seenContents.has(ai.content)) {
                seenContents.add(ai.content);
                if (!ai.code) {
                    const match = adminItems.find(a => a.part === ai.content);
                    if (match && match.code) ai.code = match.code;
                }
                uniqueItems.push(ai);
            }
        });

        // 세부구분이 있고, 항목 리스트가 존재하면 드롭다운 생성
        if (uniqueItems.length > 0 && detailType) {
            contentDiv.style.display = 'none';
            contentInput.style.display = 'none';

            if (!dropdownWrapper) {
                dropdownWrapper = document.createElement('div');
                dropdownWrapper.id = dropdownWrapperId;
                dropdownWrapper.className = 'log-select-wrapper';
                
                const trigger = document.createElement('div');
                trigger.className = 'log-select-trigger';
                
                const dropdown = document.createElement('div');
                dropdown.className = 'log-select-dropdown';
                
                const list = document.createElement('div');
                list.className = 'log-select-list';

                const selectedValues = currentContent ? currentContent.split(',').map(s => s.trim()).filter(s => s) : [];

                uniqueItems.forEach(mItem => {
                    const div = document.createElement('div');
                    div.className = 'log-select-item';
                    const val = mItem.code ? mItem.code : mItem.content;
                    if (selectedValues.includes(val) || selectedValues.includes(mItem.content)) {
                        div.classList.add('selected');
                    }
                    div.dataset.value = val;
                    div.innerHTML = `
                        <div style="display:flex; align-items:center; width:100%; pointer-events:none;">
                            <span>${val}</span>
                        </div>
                    `;
                    
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
                    list.appendChild(div);
                });

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

                function updateTriggerText() {
                    const selected = list.querySelectorAll('.log-select-item.selected');
                    const values = Array.from(selected).map(el => el.dataset.value);
                    
                    if (values.length > 1) {
                        trigger.innerText = `${values[0]} 외 ${values.length - 1}개`;
                    } else if (values.length === 1) {
                        trigger.innerText = values[0];
                    } else {
                        trigger.innerText = '항목 선택';
                    }
                    trigger.classList.remove('multi-line');
                    trigger.title = values.join('\n');
                }
                
                updateTriggerText();
                contentInput.parentNode.insertBefore(dropdownWrapper, contentInput.nextSibling);
            }
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
            dropdownValues = Array.from(selected).map(el => el.dataset.value);
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
                        
                        dropdownValues.forEach((val, idx) => {
                            let existing = sameDayItems.find(m => m.content === val);
                            if (existing) {
                                remainingIds.push(existing.id);
                            } else {
                                const newId = Date.now() + idx;
                                data.maint.push({
                                    id: newId,
                                    type: itemType,
                                    detailType: itemDetailType,
                                    content: val,
                                    date: "",
                                    period: null,
                                    scheduledDate: targetDate,
                                    worker: item.worker || '',
                                    memo: item.memo || ''
                                });
                                remainingIds.push(newId);
                            }
                        });

                        data.maint = data.maint.filter(m => {
                            if (m.scheduledDate === targetDate && m.type === itemType && (m.detailType || '') === itemDetailType) {
                                return remainingIds.includes(m.id);
                            }
                            return true;
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
    
    setScheduleDate(currentDetailTarget.site, currentDetailTarget.equip, currentDetailTarget.id, newDate);
    renderCalendar();

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
    const memo = document.getElementById('detail-work-memo').value.trim();
    
    if (!worker) return alert('작업자를 입력해주세요.');
    if (!memo) return alert('점검 결과 / 메모를 입력해주세요.');

    localStorage.setItem('lastWorkerName', worker);

    const { site, equip, id } = currentDetailTarget;
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    
    const maintItem = data.maint ? data.maint.find(i => i.id == id) : null;
    if (!maintItem) return;

    if (!data.logs) data.logs = [];
    
    // [수정] 같은 날짜, 같은 타입, 세부구분의 모든 항목 완료 처리
    const sameDayItems = data.maint.filter(i => i.scheduledDate === maintItem.scheduledDate && i.type === maintItem.type && (i.detailType || '') === (maintItem.detailType || ''));
    const combinedContent = sameDayItems.map(i => i.content).join(', ');
    const completeDate = maintItem.scheduledDate || new Date().toISOString().split('T')[0];
    
    data.logs.push({
        id: Date.now(),
        date: completeDate,
        type: maintItem.type || '정기',
        detailType: maintItem.detailType || '',
        content: combinedContent,
        costType: maintItem.costType || '',
        worker: worker,
        memo: memo
    });

    sameDayItems.forEach(i => {
        delete i.scheduledDate;
        // [추가] 완료 처리 시 임시 저장된 작업자/메모 삭제 (다음 예정일 때 초기화된 상태로 시작)
        delete i.worker;
        delete i.memo;
        // [추가] 정기/비정기 항목은 완료 시 시작일(마지막 점검일) 갱신
        if (i.type === '정기' || i.type === '비정기') {
            i.date = completeDate;
        }
    });

    localStorage.setItem(key, JSON.stringify(data));
    
    if (typeof addSystemLog === 'function') {
        addSystemLog('COMPLETE_SCHEDULE', equip, `Content: ${maintItem.content}`);
    }

    alert('작업이 완료되었습니다.');
    document.getElementById('event-detail-modal').style.display = 'none';
    renderCalendar();
    if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();

    // [추가] 캘린더 팝업이 열려있다면 내용 갱신 (완료 상태 반영)
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
    const recoveredMemo = logItem.memo || '';
    
    // 1. 로그 삭제
    data.logs.splice(logIndex, 1);
    
    // 2. 예정 일정(maint) 복구
    // 로그 내용은 콤마로 구분되어 있을 수 있으므로 분리하여 처리
    const contents = logContent.split(',').map(s => s.trim());
    
    if (!data.maint) data.maint = [];

    let recoveredMaintId = null; // 복구된 메인 ID 추적

    contents.forEach((content, idx) => {
        // 기존 maint 리스트에 같은 내용과 타입의 항목이 있는지 확인 (정기 등 유지되는 항목)
        // 예정일(scheduledDate)만 다시 세팅하여 달력에 표시되게 함
        let existingItem = data.maint.find(m => m.type === logType && m.content === content);
        
        if (existingItem) {
            existingItem.scheduledDate = logDate;
            // [추가] 취소 시 입력했던 내용 복구 저장
            existingItem.worker = recoveredWorker;
            existingItem.memo = recoveredMemo;
            if (idx === 0) recoveredMaintId = existingItem.id;
        } else {
            // 일회성 항목 등으로 인해 maint에서 삭제된 경우 재생성
            const newId = Date.now() + idx;
            data.maint.push({
                id: newId,
                type: logType,
                detailType: logItem.detailType || '',
                content: content,
                date: "", // 수행되지 않은 상태로 초기화
                period: null,
                scheduledDate: logDate,
                costType: logItem.costType || '',
                worker: recoveredWorker, // [추가]
                memo: recoveredMemo      // [추가]
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
            if(typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
        };
    }

    if (typeSelect) {
        typeSelect.onchange = () => {
            if(typeof updateRegisterDetailTypeOptions === 'function') updateRegisterDetailTypeOptions();
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
            if(typeof updateRegisterContentOptions === 'function') updateRegisterContentOptions();
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
}

function openRegisterScheduleModal(dateStr) {
    const modal = document.getElementById('register-schedule-modal');
    const dateDisplay = document.getElementById('register-date-display');
    const siteSelect = document.getElementById('register-site-select');
    const equipSelect = document.getElementById('register-equip-select');
    const typeSelect = document.getElementById('register-type-select');

    if (!modal) return;

    if (dateDisplay) dateDisplay.value = dateStr;
    
    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
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

    if(typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();

    modal.style.display = 'flex';
}

function updateRegisterEquipSelect(site) {
    const equipSelect = document.getElementById('register-equip-select');
    
    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    
    if (!site) {
        equipSelect.disabled = true;
        return;
    }

    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
    const equips = data[site] || [];
    
    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        option.textContent = parts.length > 1 ? `${parts[0]} (${parts[1]})` : parts[0];
        equipSelect.appendChild(option);
    });
    
    equipSelect.disabled = false;
    if(typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
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

    let lastProcessedId = null; // [추가] 등록된 작업 ID 추적
    
    if (!dateStr || !site || !equip || !type) return alert('사업장, 장비, 구분을 모두 선택해주세요.');
    if (!detailType && detailTypeSelect && !detailTypeSelect.disabled) return alert('세부구분을 선택해주세요.');
    if (type === '비정기' && !detailType2 && detailType2Select && !detailType2Select.disabled) return alert('세부 구분을 선택해주세요.');
    if (!costType) return alert('비용처리를 선택해주세요.');

    let content = '';
    const wrapper = document.getElementById('register-content-wrapper');
    if (wrapper && wrapper.style.display !== 'none') {
        const selected = document.querySelectorAll('#register-content-list .log-select-item.selected');
        content = Array.from(selected).map(el => el.dataset.value).join(', ');
    } else {
        const input = document.getElementById('register-content-input');
        if (input) content = input.value.trim();
    }
    
    if (!content) return alert('항목(내용)을 선택하거나 입력해주세요.');
        
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [] };
    if (!data.maint) data.maint = [];

    const itemsList = content.split(', ').map(s => s.trim()).filter(s => s);
    const finalDetailType = (type === '비정기' && detailType2) ? `${detailType} > ${detailType2}` : detailType;

    itemsList.forEach((itemText, idx) => {
        const newItem = {
            id: Date.now() + idx,
            type: type,
            detailType: finalDetailType,
            content: itemText,
            date: "",
            period: null,
            scheduledDate: dateStr,
            costType: costType
        };
        if (idx === 0) lastProcessedId = newItem.id;
        data.maint.push(newItem);
    });

    localStorage.setItem(key, JSON.stringify(data));

    if (typeof addSystemLog === 'function') {
        addSystemLog('ADD_SCHEDULE', equip, `Date: ${dateStr}, Type: ${type}, Content: ${content}`);
    }

    alert('일정이 등록되었습니다.');
    document.getElementById('register-schedule-modal').style.display = 'none';
    
    if (costTypeSelect) costTypeSelect.value = '';
    
    renderCalendar();
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
window.updateRegisterTypeOptions = function() {
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

window.updateRegisterDetailTypeOptions = function() {
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

window.updateRegisterDetailType2Options = function() {
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

window.updateRegisterContentOptions = function() {
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
            const targetType = detailType === 'PM 점검' ? '정기' : '비정기';
            const equipName = equipKey.split('::')[0];
            const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            const matchedItems = adminItems.filter(item => {
                if (item.type !== targetType) return false;
                if (!item.equip) return false;
                const equips = item.equip.split(',').map(e => e.trim());
                return equips.includes(equipName);
            });
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
        
        list.innerHTML = uniqueItems.map(item => {
            const val = item.code ? item.code : item.content;
            return `<div class="log-select-item" data-value="${val}"><span>${val}</span></div>`;
        }).join('');

        const dropdown = document.getElementById('register-content-dropdown');
        const footer = dropdown ? dropdown.querySelector('.log-select-footer') : null;
        if (footer) footer.style.display = (type === '비정기' && detailType !== 'BM 점검') ? 'none' : 'block';

        list.querySelectorAll('.log-select-item').forEach(div => {
            div.onclick = (e) => {
                e.stopPropagation();
                if (type === '비정기' && detailType !== 'BM 점검') {
                    list.querySelectorAll('.log-select-item.selected').forEach(el => {
                        if (el !== div) el.classList.remove('selected');
                    });
                }
                div.classList.toggle('selected');
                
                const sels = Array.from(list.querySelectorAll('.selected')).map(el => el.dataset.value);
                trigger.textContent = sels.length > 1 ? sels[0] + ' 외 ' + (sels.length-1) + '개' : (sels.length === 1 ? sels[0] : '항목 선택');
                trigger.title = sels.join('\n');
                
                if (type === '비정기' && detailType !== 'BM 점검' && div.classList.contains('selected')) {
                    if (dropdown) dropdown.classList.remove('show');
                }
            };
        });

        // [추가] PM 점검이나 BM 점검 선택 시 드롭다운(제안 박스) 자동 열기
        if (detailType === 'PM 점검' || detailType === 'BM 점검') {
            if (dropdown) dropdown.classList.add('show');
        }
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
            currentSearchFilters = { site: '', equip: '' };
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
}

function openSearchModal() {
    const modal = document.getElementById('calendar-search-modal');
    const siteSelect = document.getElementById('search-site-select');
    const equipSelect = document.getElementById('search-equip-select');

    if (!modal) return;

    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
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

    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
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
window.handleCalendarDragStartFromData = function(e) {
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

window.handleCalendarDrop = function(e, newDate) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');

    const dataStr = e.dataTransfer.getData('text/plain');
    if (!dataStr) return;

    try {
        const { site, equip, ids } = JSON.parse(dataStr);
        if (!ids || ids.length === 0) return;

        if (confirm(`${ids.length}건의 일정을 ${newDate}로 이동하시겠습니까?`)) {
            ids.forEach(id => {
                setScheduleDate(site, equip, id, newDate);
            });
            renderCalendar();
            if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
        }
    } catch (err) {
        console.error('Drop error:', err);
    }
};

// 전역 노출
window.renderCalendar = renderCalendar;
window.goToTodayMonth = goToTodayMonth;
window.openScheduleModal = openScheduleModal;
window.openRegisterScheduleModal = openRegisterScheduleModal;
