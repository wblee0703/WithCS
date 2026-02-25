/* ==========================================================================
   캘린더 시스템 (Calendar System)
   ========================================================================== */

// 전역 변수
let calendarDate = new Date();
// index.js 등 다른 파일에서도 접근할 수 있도록 window 객체에 할당하거나 var 사용
var currentSearchFilters = { site: '', equip: '' };
let currentScheduleTarget = null;
let currentDetailTarget = null;

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
   캘린더 렌더링 및 조작
   ========================================================================== */
function setupCalendar() {
    const prevBtn = document.getElementById('prev-month');
    const nextBtn = document.getElementById('next-month');
    const closePopupBtn = document.getElementById('btn-close-calendar-popup');
    const popup = document.getElementById('calendar-popup');
    const searchInput = document.getElementById('calendar-search');
    const filterBtn = document.getElementById('btn-search-filter');

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
                    const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip;

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
                        type: event.type
                    };
                }
            });

            const groups = Object.values(groupedEvents);
            displayCount = groups.length;

            groups.forEach(group => {
                const equipName = group.equip.split('::')[0];
                const typeClass = group.type === 'PM' ? 'type-pm' : 'type-bm';
                const completedClass = group.isCompleted ? 'completed' : '';

                eventsHtml += `<div class="calendar-event-item ${completedClass}">
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
        cell.onclick = () => openCalendarPopup(dateStr, dayEvents);
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
            li.style.cursor = 'pointer';
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';

            const textClass = group.isCompleted ? 'completed' : '';
            const parts = group.equip.split('::');
            const equipName = parts[0];
            const serialNo = parts.length > 1 ? parts[1] : '';
            const displayEquip = serialNo ? `${equipName} (${serialNo})` : equipName;

            const typeClass = group.type === 'PM' ? 'type-pm' : 'type-bm';
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
                                const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip;
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

/* ==========================================================================
   모달 로직 (Modals)
   ========================================================================== */

// 작업 예정일 설정 모달
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

function setScheduleDate(site, equip, id, dateStr, isDelete = false) {
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    
    if (data.maint) {
        const item = data.maint.find(i => i.id === id);
        if (item) {
            if (isDelete) {
                delete item.scheduledDate;
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

// 일정 상세 모달
function setupEventDetailModal() {
    const modal = document.getElementById('event-detail-modal');
    const closeBtn = document.getElementById('btn-close-detail-modal');
    const closeFooterBtn = document.getElementById('btn-close-detail-footer');
    const completeBtn = document.getElementById('btn-complete-work');
    const updateDateBtn = document.getElementById('btn-update-date');
    const moveToEquipBtn = document.getElementById('btn-move-to-equip');
    const editContentBtn = document.getElementById('btn-edit-detail-content');

    if (!modal) return;

    const closeModal = () => modal.style.display = 'none';
    if (closeBtn) closeBtn.onclick = closeModal;
    if (closeFooterBtn) closeFooterBtn.onclick = closeModal;

    if (completeBtn) {
        completeBtn.onclick = completeScheduleWork;
    }

    if (updateDateBtn) {
        updateDateBtn.onclick = updateScheduleDateFromDetail;
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
    document.getElementById('detail-content').textContent = item.content || '';
    
    const workerInput = document.getElementById('detail-worker');
    const memoInput = document.getElementById('detail-work-memo');
    const dateRow = document.getElementById('detail-date-row');
    const completeBtn = document.getElementById('btn-complete-work');
    const saveMemoBtn = document.getElementById('btn-save-detail-memo');
    const editContentBtn = document.getElementById('btn-edit-detail-content');
    const contentDiv = document.getElementById('detail-content');
    const contentInput = document.getElementById('detail-content-input');

    // UI 초기화 (수정 모드 해제)
    if (contentDiv) contentDiv.style.display = 'block';
    if (contentInput) contentInput.style.display = 'none';
    if (editContentBtn) editContentBtn.textContent = '수정';

    // [추가] 드롭다운 래퍼가 있다면 제거 (초기화)
    const dropdownWrapper = document.getElementById('detail-content-dropdown-wrapper');
    if (dropdownWrapper) dropdownWrapper.remove();

    if (isCompleted) {
        workerInput.value = item.worker || '';
        workerInput.disabled = true;
        memoInput.value = item.memo || '';
        memoInput.disabled = true;
        dateRow.style.display = 'none';
        completeBtn.style.display = 'none';
        saveMemoBtn.style.display = 'none';
        if (editContentBtn) editContentBtn.style.display = 'none';
    } else {
        workerInput.value = localStorage.getItem('lastWorkerName') || sessionStorage.getItem('userId') || '';
        workerInput.disabled = false;
        memoInput.value = '';
        memoInput.disabled = false;
        
        dateRow.style.display = 'block';
        document.getElementById('detail-scheduled-date').value = item.scheduledDate || '';
        
        completeBtn.style.display = 'block';
        completeBtn.textContent = '작업 완료';
        saveMemoBtn.style.display = 'none';
        if (editContentBtn) editContentBtn.style.display = 'block';
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
        const currentContent = contentDiv.textContent.trim();

        if (type === 'PM' || type === 'BM') {
            // PM/BM일 경우 드롭다운 생성
            contentDiv.style.display = 'none';
            contentInput.style.display = 'none';

            if (!dropdownWrapper) {
                dropdownWrapper = document.createElement('div');
                dropdownWrapper.id = dropdownWrapperId;
                dropdownWrapper.className = 'log-select-wrapper';
                dropdownWrapper.style.width = '100%';
                
                const trigger = document.createElement('div');
                trigger.className = 'log-select-trigger';
                
                const dropdown = document.createElement('div');
                dropdown.className = 'log-select-dropdown';
                
                const list = document.createElement('div');
                list.className = 'log-select-list';

                const selectedValues = currentContent ? currentContent.split(',').map(s => s.trim()) : [];

                if (data.maint) {
                    const filteredItems = data.maint.filter(m => m.type === type);
                    if (filteredItems.length === 0) {
                        list.innerHTML = '<div style="padding:10px; color:#8b949e;">등록된 항목이 없습니다.</div>';
                    } else {
                        filteredItems.forEach(mItem => {
                            const div = document.createElement('div');
                            div.className = 'log-select-item';
                            if (selectedValues.includes(mItem.content)) {
                                div.classList.add('selected');
                            }
                            div.dataset.value = mItem.content;
                            div.innerHTML = `<span>${mItem.content}</span>`;
                            
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
                addBtn.style.width = '100%';
                addBtn.textContent = '직접 입력 (추가)';
                addBtn.onclick = (e) => {
                    e.stopPropagation();
                    dropdownWrapper.remove();
                    contentInput.value = '';
                    contentInput.placeholder = '새 항목 입력';
                    contentInput.style.display = 'block';
                    contentInput.focus();
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
                    if (values.length > 1) {
                        trigger.textContent = `${values[0]} 외 ${values.length - 1}개`;
                    } else if (values.length === 1) {
                        trigger.textContent = values[0];
                    } else {
                        trigger.textContent = '항목 선택';
                    }
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
    } else {
        // 저장 처리
        let newContent = '';

        if (dropdownWrapper) {
            const list = dropdownWrapper.querySelector('.log-select-list');
            const selected = list.querySelectorAll('.log-select-item.selected');
            const values = Array.from(selected).map(el => el.dataset.value);
            newContent = values.join(', ');
            dropdownWrapper.remove();
        } else {
            newContent = contentInput.value.trim();
        }

        if (!newContent) return alert('내용을 입력해주세요.');
        
        if (currentDetailTarget) {
            const { site, equip, id } = currentDetailTarget;
            const key = `details_${site}_${equip}`;
            let data = JSON.parse(localStorage.getItem(key)) || {};
            
            if (data.maint) {
                const item = data.maint.find(i => i.id === id);
                if (item) {
                    item.content = newContent;
                    localStorage.setItem(key, JSON.stringify(data));
                    
                    // UI 업데이트
                    contentDiv.textContent = newContent;
                    contentDiv.style.display = 'block';
                    contentInput.style.display = 'none';
                    editBtn.textContent = '수정';
                    
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
    alert('예정일이 변경되었습니다.');
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
                    const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip;
                    return matchKeyword && matchSite && matchEquip;
                });
            }
            
            openCalendarPopup(dateStr, dayEvents);
        }
    }
}

function completeScheduleWork() {
    if (!currentDetailTarget || currentDetailTarget.isCompleted) return;

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
    const completeDate = maintItem.scheduledDate || new Date().toISOString().split('T')[0];
    
    data.logs.push({
        id: Date.now(),
        date: completeDate,
        type: maintItem.type || 'PM',
        content: maintItem.content,
        worker: worker,
        memo: memo
    });

    delete maintItem.scheduledDate;

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
                    const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip;
                    return matchKeyword && matchSite && matchEquip;
                });
            }
            
            openCalendarPopup(dateStr, dayEvents);
        }
    }
}

// 작업 예정일 등록 모달
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
    container.style.flex = '1';
    container.style.position = 'relative';
    row.appendChild(container);
    
    itemList.appendChild(row);

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const maintItems = data.maint || [];
    
    const createManualInput = (initialValue = '', placeholder = '') => {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'register-manual-input';
        input.style.width = '100%';
        input.style.padding = '8px';
        input.style.background = '#0d1117';
        input.style.border = '1px solid #30363d';
        input.style.color = '#e6edf3';
        input.style.borderRadius = '4px';
        
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
    const filteredItems = maintItems.filter(item => item.type === selectedType);

    const wrapper = document.createElement('div');
    wrapper.className = 'log-select-wrapper';
    wrapper.style.width = '100%';
    
    const trigger = document.createElement('div');
    trigger.className = 'log-select-trigger';
    trigger.textContent = '항목 선택';

    const dropdown = document.createElement('div');
    dropdown.className = 'log-select-dropdown';

    const searchContainer = document.createElement('div');
    searchContainer.style.padding = '5px';
    searchContainer.style.borderBottom = '1px solid #30363d';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '항목 검색...';
    searchInput.style.width = '100%';
    searchInput.style.padding = '5px';
    searchInput.style.background = '#0d1117';
    searchInput.style.border = '1px solid #30363d';
    searchInput.style.color = '#e6edf3';
    searchInput.style.borderRadius = '3px';
    searchInput.style.fontSize = '12px';
    
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
        list.innerHTML = '<div style="padding:10px; color:#8b949e; text-align:center;">등록된 항목이 없습니다.</div>';
    } else {
        filteredItems.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'log-select-item';
            itemDiv.dataset.id = item.id;
            itemDiv.textContent = item.content;
            if (item.scheduledDate) {
                itemDiv.innerHTML += ` <span style="color:#e3b341; font-size:0.85em;">(예정: ${item.scheduledDate})</span>`;
            }
            
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
    addBtn.style.width = '100%';
    addBtn.textContent = '직접 입력 (추가)';
    addBtn.onclick = (e) => {
        e.stopPropagation();
        createManualInput('', '새 항목 입력');
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

        data.maint.push(newItem);
        localStorage.setItem(key, JSON.stringify(data));

        if (typeof addSystemLog === 'function') {
            addSystemLog('ADD_SCHEDULE_MANUAL', equip, `Type: ${selectedType}, Date: ${dateStr}, Content: ${content}`);
        }
    } else if (selectedType === 'PM' || selectedType === 'BM') {
        // 드롭다운 선택
        const selectedItems = itemList.querySelectorAll('.log-select-item.selected');
        if (selectedItems.length === 0) return alert('등록할 항목을 선택해주세요.');

        const ids = Array.from(selectedItems).map(el => parseInt(el.dataset.id));
        
        ids.forEach(id => {
            setScheduleDate(site, equip, id, dateStr);
        });
    }

    alert('일정이 등록되었습니다.');
    document.getElementById('register-schedule-modal').style.display = 'none';
    
    renderCalendar();
    const popup = document.getElementById('calendar-popup');
    if (popup) popup.style.display = 'none';
}

// 검색 필터 모달
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

// 전역 노출
window.renderCalendar = renderCalendar;
window.openScheduleModal = openScheduleModal;
window.openRegisterScheduleModal = openRegisterScheduleModal;
