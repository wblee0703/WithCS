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
 * 캘린더 표시용 PM/BM 일정 데이터 수집
 */
function getPmScheduleForCalendar() {
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
                                events[targetDateStr].push({ site, equip, type: item.type || 'PM', content: item.content, id: item.id });
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
                                    type: log.type || 'PM',
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

    const pmEvents = getPmScheduleForCalendar();
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
                        const allEvents = getPmScheduleForCalendar();
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
    document.getElementById('detail-type').textContent = item.type || 'PM';

    // [수정] 같은 날짜에 예정된 항목들을 모두 표시
    let displayContent = item.content || '';
    if (!isCompleted && item.scheduledDate) {
        const sameDayItems = data.maint.filter(i => i.scheduledDate === item.scheduledDate && i.type === item.type);
        if (sameDayItems.length > 0) {
            displayContent = sameDayItems.map(i => i.content).join(', ');
        }
    }

    const contentEl = document.getElementById('detail-content');
    contentEl.innerText = displayContent.split(',').map(s => `- ${s.trim()}`).join('\n');
    
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
        const { site, equip, id } = currentDetailTarget;
        const key = `details_${site}_${equip}`;
        const data = JSON.parse(localStorage.getItem(key)) || {};
        const item = data.maint ? data.maint.find(i => i.id == id) : null;
        
        if (!item) return;

        const type = item.type || 'PM';
        const currentContent = contentDiv.innerText.trim();

        if (type === 'PM' || type === 'BM') {
            // PM/BM일 경우 드롭다운 생성
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

                const selectedValues = currentContent ? currentContent.split('\n').map(s => s.replace(/^- /, '').trim()) : [];

                if (data.maint) {
                    const filteredItems = data.maint.filter(m => m.type === type);
                    if (filteredItems.length === 0) {
                        list.innerHTML = '<div class="log-select-empty-msg">등록된 항목이 없습니다.</div>';
                    } else {
                        filteredItems.forEach(mItem => {
                            const div = document.createElement('div');
                            div.className = 'log-select-item';
                            if (selectedValues.includes(mItem.content)) {
                                div.classList.add('selected');
                            }
                            div.dataset.value = mItem.content;
                            const isSelected = div.classList.contains('selected');
                            div.innerHTML = `
                                <div style="display:flex; align-items:center; width:100%; pointer-events:none;">
                                    <span>${mItem.content}</span>
                                </div>
                            `;
                            
                            div.onclick = (e) => {
                                e.stopPropagation();
                                div.classList.toggle('selected');
                                updateTriggerText();
                            };
                            list.appendChild(div);
                        });
                    }
                }

                dropdown.appendChild(list);

                // [추가] 드롭다운 하단 추가 버튼
                const footer = document.createElement('div');
                footer.className = 'log-select-footer';
                const addBtn = document.createElement('button');
                addBtn.className = 'btn-blue-sm';
                addBtn.classList.add('btn-full-width');
                addBtn.textContent = '선택 완료';
                addBtn.onclick = (e) => {
                    e.stopPropagation();
                    dropdown.classList.remove('show');
                };
                footer.appendChild(addBtn);
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
                    
                    trigger.innerText = values.length > 0 ? values.map(v => `- ${v}`).join('\n') : '항목 선택';
                    trigger.classList.add('multi-line');
                    trigger.title = values.join('\n');
                }
                
                updateTriggerText();
                contentInput.parentNode.insertBefore(dropdownWrapper, contentInput.nextSibling);
            }
        } else {
            // 그 외 타입은 텍스트 입력
            contentInput.value = item.content || '';
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
        
        if (currentDetailTarget) {
            const { site, equip, id } = currentDetailTarget;
            const key = `details_${site}_${equip}`;
            let data = JSON.parse(localStorage.getItem(key)) || {};
            
            if (data.maint) {
                const item = data.maint.find(i => i.id === id);
                if (item) {
                    if (isDropdownMode && item.scheduledDate) {
                        // [수정] 병합 방지: 선택된 항목들의 예정일을 업데이트 (항목 내용은 변경 안 함)
                        const targetDate = item.scheduledDate;
                        data.maint.forEach(m => {
                            if (m.type === item.type) {
                                if (dropdownValues.includes(m.content)) {
                                    m.scheduledDate = targetDate;
                                } else if (m.scheduledDate === targetDate) {
                                    // 현재 날짜에 있었지만 선택 해제된 항목은 예정일 제거
                                    delete m.scheduledDate;
                                }
                            }
                        });
                        // UI 업데이트용 텍스트
                        contentDiv.innerText = dropdownValues.map(s => `- ${s.trim()}`).join('\n');
                    } else {
                        // 텍스트 입력 모드 (장비점검 등)는 기존대로 내용 수정
                        item.content = newContent;
                        contentDiv.innerText = newContent.split(',').map(s => `- ${s.trim()}`).join('\n');
                    }

                    localStorage.setItem(key, JSON.stringify(data));
                    
                    // UI 업데이트
                    contentDiv.style.display = 'block';
                    contentInput.style.display = 'none';
                    editBtn.textContent = '수정';
                    editBtn.classList.add('btn-blue');
                    editBtn.classList.remove('btn-save-state');
                    
                    // 캘린더 및 대시보드 갱신
                    renderCalendar();
                    if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                    
                    alert('수정되었습니다.');
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
            const allEvents = getPmScheduleForCalendar();
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
    
    // [수정] 같은 날짜, 같은 타입의 모든 항목 완료 처리
    const sameDayItems = data.maint.filter(i => i.scheduledDate === maintItem.scheduledDate && i.type === maintItem.type);
    const combinedContent = sameDayItems.map(i => i.content).join(', ');
    const completeDate = maintItem.scheduledDate || new Date().toISOString().split('T')[0];
    
    data.logs.push({
        id: Date.now(),
        date: completeDate,
        type: maintItem.type || 'PM',
        content: combinedContent,
        worker: worker,
        memo: memo
    });

    sameDayItems.forEach(i => {
        delete i.scheduledDate;
        // [추가] 완료 처리 시 임시 저장된 작업자/메모 삭제 (다음 예정일 때 초기화된 상태로 시작)
        delete i.worker;
        delete i.memo;
        // [추가] PM/BM 항목은 완료 시 시작일(마지막 점검일) 갱신
        if (i.type === 'PM' || i.type === 'BM') {
            i.date = completeDate;
        }
    });

    // [추가] 일회성 일정(트러블이슈 등)은 완료 후 리스트에서 제거하여 데이터 누적 방지
    data.maint = data.maint.filter(item => {
        if (['장비점검', '프로그램변경', '트러블이슈'].includes(item.type)) {
            return item.scheduledDate; // 예정일이 남아있지 않으면 제거
        }
        return true;
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
            const allEvents = getPmScheduleForCalendar();
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
        // 기존 maint 리스트에 같은 내용과 타입의 항목이 있는지 확인 (PM 등 유지되는 항목)
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
                content: content,
                date: "", // 수행되지 않은 상태로 초기화
                period: null,
                scheduledDate: logDate,
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
            const allEvents = getPmScheduleForCalendar();
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

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    
    if (siteSelect) {
        siteSelect.onchange = () => {
            updateRegisterEquipSelect(siteSelect.value);
        };
    }

    if (equipSelect) {
        equipSelect.onchange = () => {
            updateRegisterItemList(siteSelect.value, equipSelect.value);
        };
    }

    if (typeSelect) {
        typeSelect.onchange = () => {
            updateRegisterItemList(siteSelect.value, equipSelect.value);
        };
    }

    if (confirmBtn) {
        confirmBtn.onclick = confirmRegisterSchedule;
    }
}

function openRegisterScheduleModal(dateStr) {
    const modal = document.getElementById('register-schedule-modal');
    const dateDisplay = document.getElementById('register-date-display');
    const siteSelect = document.getElementById('register-site-select');
    const equipSelect = document.getElementById('register-equip-select');
    const itemList = document.getElementById('register-item-list');
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
    itemList.innerHTML = '';

    if (typeSelect) typeSelect.value = 'PM';

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
                updateRegisterItemList(currentSearchFilters.site, targetValue);
            }
        }
    }

    modal.style.display = 'flex';
}

function updateRegisterEquipSelect(site) {
    const equipSelect = document.getElementById('register-equip-select');
    const itemList = document.getElementById('register-item-list');
    
    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    itemList.innerHTML = '';
    
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

function updateRegisterItemList(site, equip) {
    const itemList = document.getElementById('register-item-list');
    const typeSelect = document.getElementById('register-type-select');
    const selectedType = typeSelect ? typeSelect.value : 'PM';
    itemList.innerHTML = '';

    if (!site || !equip) return;

    // [추가] 항목 줄 생성 (form-row)
    const row = document.createElement('div');
    row.className = 'form-row';
    
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = '항목';
    row.appendChild(label);

    const container = document.createElement('div');
    container.className = 'register-item-container';
    row.appendChild(container);
    
    itemList.appendChild(row);

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const maintItems = data.maint || [];
    
    const createManualInput = (initialValue = '', placeholder = '') => {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'register-manual-input';
        input.className = 'manual-input';
        
        if (initialValue) input.value = initialValue;
        if (placeholder) input.placeholder = placeholder;
        
        container.innerHTML = '';
        container.appendChild(input);
        setTimeout(() => input.focus(), 0);
    };

    // [수정] 장비점검, 프로그램변경은 텍스트 입력창 표시
    if (selectedType === '장비점검' || selectedType === '프로그램변경') {
        if (selectedType === '프로그램변경') {
            createManualInput('Ver. ');
        } else {
            createManualInput('', '점검 내용을 입력하세요');
        }
        return;
    }

    // [수정] PM/BM인 경우 드롭다운 바 생성
    let filteredItems = [];
    if (selectedType === '트러블이슈') {
        filteredItems.push({ id: 'default_1', content: '데이터이슈' });
        filteredItems.push({ id: 'default_2', content: '설비 이상' });
        // PM/BM 항목 추가
        const pmBmItems = maintItems.filter(item => item.type === 'PM' || item.type === 'BM');
        filteredItems = filteredItems.concat(pmBmItems);
    } else {
        filteredItems = maintItems.filter(item => item.type === selectedType);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'log-select-wrapper';
    
    const trigger = document.createElement('div');
    trigger.className = 'log-select-trigger';
    trigger.textContent = '항목 선택';

    const dropdown = document.createElement('div');
    dropdown.className = 'log-select-dropdown';

    const searchContainer = document.createElement('div');
    searchContainer.className = 'log-select-search-container';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '항목 검색...';
    searchInput.className = 'log-select-search-input';
    
    searchInput.onclick = (e) => e.stopPropagation();
    searchInput.oninput = (e) => {
        const val = e.target.value.toLowerCase();
        const items = list.querySelectorAll('.log-select-item');
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(val) ? 'block' : 'none';
        });
    };

    searchContainer.appendChild(searchInput);
    dropdown.appendChild(searchContainer);

    const list = document.createElement('div');
    list.className = 'log-select-list';

    if (filteredItems.length === 0) {
        list.innerHTML = '<div class="log-select-empty-msg">등록된 항목이 없습니다.</div>';
    } else {
        filteredItems.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'log-select-item';
            itemDiv.dataset.id = item.id;
            let html = `
                <div style="display:flex; align-items:center; width:100%; pointer-events:none;">
                    <span>${item.content}</span>
            `;
            if (item.scheduledDate) {
                html += ` <span class="scheduled-date-text" style="margin-left:5px;">(예정: ${item.scheduledDate})</span>`;
            }
            html += `</div>`;
            itemDiv.innerHTML = html;
            
            itemDiv.onclick = (e) => {
                e.stopPropagation();
                itemDiv.classList.toggle('selected');
                
                // 트리거 텍스트 업데이트
                const selected = list.querySelectorAll('.log-select-item.selected');
                if (selected.length === 0) trigger.textContent = '항목 선택';
                else if (selected.length === 1) trigger.textContent = selected[0].textContent.replace(/\(예정:.*\)/, '').trim();
                else trigger.textContent = `${selected[0].textContent.replace(/\(예정:.*\)/, '').trim()} 외 ${selected.length - 1}개`;
            };
            list.appendChild(itemDiv);
        });
    }

    dropdown.appendChild(list);

    // [추가] 드롭다운 하단 추가 버튼
    const footer = document.createElement('div');
    footer.className = 'log-select-footer';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-blue-sm';
    addBtn.classList.add('btn-full-width');
    addBtn.textContent = '선택 완료';
    addBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
    };
    footer.appendChild(addBtn);
    dropdown.appendChild(footer);

    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);
    
    trigger.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('show');
        if (dropdown.classList.contains('show')) {
            searchInput.value = '';
            const items = list.querySelectorAll('.log-select-item');
            items.forEach(item => item.style.display = 'block');
            setTimeout(() => searchInput.focus(), 0);
        }
    };

    container.appendChild(wrapper);
}

function confirmRegisterSchedule() {
    const dateStr = document.getElementById('register-date-display').value;
    const site = document.getElementById('register-site-select').value;
    const equip = document.getElementById('register-equip-select').value;
    const itemList = document.getElementById('register-item-list');
    const typeSelect = document.getElementById('register-type-select');
    const selectedType = typeSelect ? typeSelect.value : 'PM';

    let lastProcessedId = null; // [추가] 등록된 작업 ID 추적
    
    if (!dateStr || !site || !equip) return alert('사업장과 장비를 선택해주세요.');

    // [수정] 수동 입력 확인 (PM/BM 직접 입력 포함)
    const manualInput = document.getElementById('register-manual-input');
    
    if (manualInput) {
        const content = manualInput.value.trim();
        
        if (!content) return alert('내용을 입력해주세요.');
        
        const key = `details_${site}_${equip}`;
        let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [] };
        if (!data.maint) data.maint = [];

        const newItem = {
            id: Date.now(),
            type: selectedType,
            content: content,
            date: "", // 아직 수행되지 않음
            period: null,
            scheduledDate: dateStr
        };

        lastProcessedId = newItem.id;

        data.maint.push(newItem);
        localStorage.setItem(key, JSON.stringify(data));

        if (typeof addSystemLog === 'function') {
            addSystemLog('ADD_SCHEDULE_MANUAL', equip, `Type: ${selectedType}, Date: ${dateStr}, Content: ${content}`);
        }
    } else if (selectedType === '트러블이슈') {
        // [추가] 트러블이슈 선택 (새 항목 생성)
        const selectedItems = itemList.querySelectorAll('.log-select-item.selected');
        if (selectedItems.length === 0) return alert('등록할 항목을 선택해주세요.');

        const key = `details_${site}_${equip}`;
        let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [] };
        if (!data.maint) data.maint = [];

        selectedItems.forEach((el, index) => {
            let content = el.textContent.replace(/\(예정:.*\)/, '').trim();
            const newItem = {
                id: Date.now() + index,
                type: selectedType,
                content: content,
                date: "",
                period: null,
                scheduledDate: dateStr
            };
            if (index === 0) lastProcessedId = newItem.id;
            data.maint.push(newItem);
        });
        localStorage.setItem(key, JSON.stringify(data));
        
        if (typeof addSystemLog === 'function') {
            addSystemLog('ADD_SCHEDULE_TROUBLE', equip, `Date: ${dateStr}, Count: ${selectedItems.length}`);
        }
    } else if (selectedType === 'PM' || selectedType === 'BM') {
        // 드롭다운 선택
        const selectedItems = itemList.querySelectorAll('.log-select-item.selected');
        if (selectedItems.length === 0) return alert('등록할 항목을 선택해주세요.');

        const ids = Array.from(selectedItems).map(el => parseInt(el.dataset.id));
        
        ids.forEach(id => {
            setScheduleDate(site, equip, id, dateStr);
            if (!lastProcessedId) lastProcessedId = id;
        });
    }

    alert('일정이 등록되었습니다.');
    document.getElementById('register-schedule-modal').style.display = 'none';
    
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
