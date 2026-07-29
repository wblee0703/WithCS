/* ==========================================================================
   1. 전역 변수 및 초기화 (Globals & Initialization)
   ========================================================================== */

const nowInit = new Date();
let calendarDate = new Date(nowInit.getFullYear(), nowInit.getMonth(), 1); // [수정] 1일로 초기화하여 월 계산 오류 방지
var currentSearchFilters = { site: '', equip: '' };
let currentScheduleTarget = null;
let expandedViewId = null;

// [추가] 필터 사업장 매칭 헬퍼 함수
window.isSiteMatched = function (eventSite, filterSite) {
    if (!filterSite) return true;
    const siteGroup = typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(eventSite) : null;
    if (Array.isArray(filterSite)) {
        if (filterSite.length === 0) return true;
        return filterSite.includes(eventSite) || (siteGroup && filterSite.includes(siteGroup));
    }
    return eventSite === filterSite || siteGroup === filterSite;
};

document.addEventListener('DOMContentLoaded', () => {
    setupCalendar();
    setupSearchModal();
    setupScheduleModal(); // [추가] 누락되었던 팝업 이벤트 초기화(버튼 바인딩) 호출 복구

    // [추가] 달력 상세 검색 제안박스 외부 클릭 시 닫기
    const closeSearchDropdownOnOutsideClick = (e) => {
        const searchDropdown = document.getElementById('search-equip-dropdown');
        const searchTrigger = document.getElementById('search-equip-trigger');
        if (searchDropdown && searchDropdown.classList.contains('show')) {
            if (e.target !== searchTrigger && !searchTrigger.contains(e.target) && !searchDropdown.contains(e.target)) {
                searchDropdown.classList.remove('show');
            }
        }
    };
    document.addEventListener('click', closeSearchDropdownOnOutsideClick);
    document.addEventListener('touchstart', closeSearchDropdownOnOutsideClick, { passive: true });

});

/* ==========================================================================
   2. 핵심 로직 & 데이터 처리 (Core Logic & Data)
   ========================================================================== */

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

                    const equipStatus = (data.setup && data.setup.equipStatus) ? data.setup.equipStatus : '';

                    if (data.maint) {
                        data.maint.forEach(item => {
                            let targetDateStr = '';
                            if (item.scheduledDate) {
                                // [추가] 이미 이력으로 완료 처리된 항목은 캘린더 예정(maint)에서 중복 노출 방지
                                const isDone = data.logs && data.logs.some(l => {
                                    const itemContent = (item.content || '').trim();
                                    if (!itemContent) return false;
                                    if (item.originalLogId) {
                                        return l.date === item.scheduledDate && l.originalLogId === item.originalLogId && (l.content || '').includes(itemContent);
                                    }
                                    return l.date === item.scheduledDate && (l.content || '').includes(itemContent);
                                });
                                if (!isDone) {
                                    targetDateStr = item.scheduledDate;
                                }
                            }
                            if (targetDateStr) {
                                if (!events[targetDateStr]) events[targetDateStr] = [];
                                events[targetDateStr].push({ site, equip, type: item.type || '정기', detailType: item.detailType || '', content: item.code ? item.code : item.content, id: item.id, md: item.md || 0, originalLogId: item.originalLogId, worker: item.worker });
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
                                    detailType: log.detailType || '',
                                    content: log.content || log.memo || '내용 없음',
                                    id: log.id,
                                    isCompleted: !isChanged,
                                    isChanged: isChanged,
                                    md: log.md || 0,
                                    originalLogId: log.originalLogId,
                                    worker: log.worker
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
async function setScheduleDate(site, equip, id, dateStr, isDelete = false, providedReason = undefined, newWorker = undefined, newMd = undefined) {
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};

    let payload = { maint_upserts: [], maint_deletes: [], log_upserts: [] };

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
                    const newLog = {
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
                    };
                    data.logs.push(newLog);
                    payload.log_upserts.push(newLog);
                }
            }

            if (isDelete) {
                // [수정] delete 대신 빈 문자열 명시적 할당으로 DB 동기화 시 누락되어 부활하는 현상 방지
                item.scheduledDate = "";
                item.md = "";
                item.costType = "";
                item.worker = "";
                item.memo = "";
                if (!item.period) {
                    data.maint.splice(index, 1);
                    payload.maint_deletes.push(id.toString());
                } else {
                    payload.maint_upserts.push(item);
                }
            } else {
                item.scheduledDate = dateStr;
                if (newWorker !== undefined) item.worker = newWorker;
                if (newMd !== undefined) item.md = newMd;

                const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
                const newMonth = dateStr.substring(0, 7);
                if (oldMonth !== newMonth) {
                    if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
                }
                payload.maint_upserts.push(item);
            }

            const success = await window.syncHistoryTransaction(site, equip, payload);
            if (!success) return false;

            localStorage.setItem(key, JSON.stringify(data));

            if (typeof addSystemLog === 'function') {
                const action = isDelete ? 'DELETE_SCHEDULE' : 'ADD_SCHEDULE';
                addSystemLog(action, equip, `예정일: ${dateStr}, 내용: ${item.content}`);
            }
            return true;
        }
    }
    return false;
}

/* ==========================================================================
   3. 캘린더 UI 렌더링 (Calendar UI Rendering)
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
        filterBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSearchModal();
        };
    }
    if (targetInfoEl) {
        targetInfoEl.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSearchModal();
        };
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
        const siteText = Array.isArray(currentSearchFilters.site) ? currentSearchFilters.site.join(', ') : currentSearchFilters.site;
        if (siteText) {
            infoText = `<${siteText}`;
            if (currentSearchFilters.equip) {
                const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                const parts = currentSearchFilters.equip.split('::');
                const rawName = parts[0];
                const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
                const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
                infoText += `, ${displayName}`;
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
                const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                dayEvents = dayEvents.filter(event => {
                    const equipParts = event.equip ? event.equip.split('::') : [];
                    const rawName = equipParts[0] || '';
                    const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
                    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;

                    const kwStr = keyword.replace(/\s/g, '');
                    const matchKeyword = !keyword || (
                        (event.site && event.site.toLowerCase().includes(keyword)) ||
                        (event.equip && event.equip.toLowerCase().includes(keyword)) ||
                        (displayName.toLowerCase().includes(keyword)) ||
                        (event.content && event.content.toLowerCase().includes(keyword)) ||
                        (event.worker && event.worker.toLowerCase().includes(keyword)) ||
                        (event.type && event.type.toLowerCase().includes(keyword)) ||
                        (event.detailType && event.detailType.toLowerCase().includes(keyword)) ||
                        (event.content && event.content.replace(/\s/g, '').toLowerCase().includes(kwStr)) ||
                        (event.detailType && event.detailType.replace(/\s/g, '').toLowerCase().includes(kwStr))
                    );

                    const matchSite = window.isSiteMatched(event.site, currentSearchFilters.site);
                    const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip || rawName === currentSearchFilters.equip || displayName === currentSearchFilters.equip;

                    return matchKeyword && matchSite && matchEquip;
                });
            }

            // 그룹화 로직
            const groupedEvents = {};
            dayEvents.forEach(event => {
                const isExtraWork = !!event.originalLogId;
                // [수정] 세부 구분(detailType)이 다르면 다른 작업으로 분류하고, 같으면 물품 여러 개 등록 시에도 같은 작업으로 묶이도록 key에 detailType을 포함합니다.
                const key = `${event.site}::${event.equip}::${event.isCompleted}::${event.isChanged}::${event.type}::${event.detailType || ''}::${isExtraWork}`;
                if (!groupedEvents[key]) {
                    groupedEvents[key] = {
                        site: event.site,
                        equip: event.equip,
                        isCompleted: event.isCompleted,
                        isChanged: event.isChanged,
                        type: event.type,
                        detailType: event.detailType,
                        isExtraWork: isExtraWork,
                        worker: event.worker, // [추가] 작업자
                        md: parseFloat(event.md) || 0, // 중복 방지를 위해 그룹당 1개의 공수만 저장
                        ids: [] // ID 목록 저장을 위해 배열 초기화
                    };
                }
                groupedEvents[key].ids.push(event.id); // ID 추가
            });

            const groups = Object.values(groupedEvents);

            // [수정] 통계 계산을 세부 항목 단위가 아닌 화면에 보이는 "그룹(블록)" 단위로 변경하여 수치 뻥튀기 현상 방지
            groups.forEach(group => {
                if (group.isChanged) return; // 일정 변경 이력은 카운트에서 제외
                monthTotalTasks++;
                if (group.isCompleted) monthCompletedTasks++;

                // [수정] 관리자 지분 차감 공통 로직 적용
                if (typeof window.calcValidMd === 'function') {
                    monthTotalMd += window.calcValidMd(group.worker, group.md);
                } else {
                    monthTotalMd += group.md;
                }
            });

            // [추가] 캘린더 화면에서 미완료(작업 예정) 일정을 완료된 일정보다 항상 위에 표시하도록 정렬
            groups.sort((a, b) => {
                const aDone = a.isCompleted || a.isChanged;
                const bDone = b.isCompleted || b.isChanged;
                if (aDone === bDone) return 0;
                return aDone ? 1 : -1;
            });

            displayCount = groups.length;

            // [추가] 1달/2달 보기에 따른 최대 표시 항목 수 제한
            const isSingleMonthMode = (expandedViewId !== null);
            const maxAllowed = isSingleMonthMode ? 3 : 4;
            const visibleCount = isSingleMonthMode ? 2 : 3;

            const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
            let renderGroups = groups;
            if (groups.length > maxAllowed) {
                renderGroups = groups.slice(0, visibleCount);
            }

            renderGroups.forEach(group => {
                const equipParts = group.equip.split('::');
                const rawName = equipParts[0];
                const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
                const equipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
                const typeClass = `type-${group.type}`;
                const completedClass = (group.isCompleted || group.isChanged) ? 'completed' : '';

                // 드래그 속성 추가 (완료되지 않은 항목만)
                let dragAttr = '';
                if (!group.isCompleted && !group.isChanged) {
                    const idsJson = JSON.stringify(group.ids).replace(/"/g, '&quot;');
                    dragAttr = `draggable="true" data-drag-site="${escapeHtml(group.site)}" data-drag-equip="${escapeHtml(group.equip)}" data-drag-ids="${idsJson}" ondragstart="handleCalendarDragStartFromData(event)" ondragend="this.classList.remove('dragging')"`;
                }

                // [추가] 캘린더 블록에 추가 작업 표시
                const extraBadge = group.isExtraWork ? `<span style="color:#1f6feb; font-weight:bold; margin-left:4px; font-size:10px;">&lt;추가&gt;</span>` : '';

                eventsHtml += `<div class="calendar-event-item ${completedClass} ${typeClass}" ${dragAttr}>
                    ${escapeHtml(group.site)} ${escapeHtml(equipName)} <span class="event-type-text ${typeClass}">${group.type}</span>${extraBadge}
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
    if (typeof window.checkSessionValid === 'function' && !window.checkSessionValid()) return;
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
            const isExtraWork = !!event.originalLogId;
            // [수정] 세부 구분(detailType)이 다르면 다른 작업으로 분류합니다.
            // 비정기 및 추가 작업은 고유한 스케줄별로 팝업에 각각 다 노출되어야 하므로 key에 고유 event.id를 포함합니다.
            let key = `${event.site}::${event.equip}::${event.isCompleted}::${event.isChanged}::${event.type}::${event.detailType || ''}::${isExtraWork}`;
            if (event.type === '비정기' || isExtraWork) {
                key += `::${event.id}`;
            }

            if (!groupedEvents[key]) {
                groupedEvents[key] = {
                    site: event.site,
                    equip: event.equip,
                    isCompleted: event.isCompleted,
                    isChanged: event.isChanged,
                    type: event.type,
                    detailType: event.detailType,
                    isExtraWork: isExtraWork,
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

        const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
        groupedList.forEach(group => {
            const tpl = getTemplateContent('popup-event-item-template');
            if (tpl) {
                const li = tpl.querySelector('li');

                const textClass = (group.isCompleted || group.isChanged) ? 'completed' : '';
                const parts = group.equip.split('::');
                const rawName = parts[0];
                const serialNo = parts.length > 1 ? parts[1] : '';
                const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
                const equipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;

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

                const rightContainer = document.createElement('div');
                rightContainer.style.display = 'flex';
                rightContainer.style.alignItems = 'center';
                rightContainer.style.gap = '8px';
                rightContainer.style.marginLeft = 'auto';
                li.appendChild(rightContainer);

                if (group.isCompleted) {
                    const completedSpan = document.createElement('span');
                    completedSpan.textContent = '<완료>';
                    completedSpan.className = 'popup-completed-badge';
                    completedSpan.style.marginLeft = '0';
                    rightContainer.appendChild(completedSpan);
                } else if (group.isChanged) {
                    const changedSpan = document.createElement('span');
                    changedSpan.textContent = '<변동>';
                    changedSpan.style.color = '#f0883e';
                    changedSpan.style.fontWeight = 'bold';
                    changedSpan.style.fontSize = '12px';
                    rightContainer.appendChild(changedSpan);
                }

                const isExtraWork = group.items.some(i => i.originalLogId);
                if (isExtraWork) {
                    const extraSpan = document.createElement('span');
                    extraSpan.textContent = '<추가>';
                    extraSpan.style.color = '#1f6feb';
                    extraSpan.style.fontWeight = 'bold';
                    extraSpan.style.fontSize = '12px';
                    rightContainer.appendChild(extraSpan);
                }

                const userRole = sessionStorage.getItem('userRole');
                const canDelete = (!group.isCompleted && !group.isChanged) || (group.isChanged && userRole === 'superadmin');

                if (canDelete) {
                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn-calendar-del';
                    delBtn.textContent = '✕';
                    delBtn.title = group.isChanged ? '변동 이력 삭제' : '일정 삭제';
                    delBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (group.isChanged) {
                            if (confirm('이 변동 이력을 삭제하시겠습니까? (삭제 후 복구할 수 없습니다)')) {
                                const sampleItem = group.items[0];
                                const key = `details_${sampleItem.site}_${sampleItem.equip}`;
                                let data = JSON.parse(localStorage.getItem(key)) || {};
                                let payload = { log_deletes: [] };

                                group.items.forEach(item => {
                                    payload.log_deletes.push(item.id.toString());
                                });

                                if (typeof window.syncHistoryTransaction === 'function') {
                                    const success = await window.syncHistoryTransaction(sampleItem.site, sampleItem.equip, payload);
                                    if (!success) return;
                                }

                                group.items.forEach(item => {
                                    if (data.logs) {
                                        data.logs = data.logs.filter(l => l.id !== item.id);
                                    }
                                });
                                localStorage.setItem(key, JSON.stringify(data));

                                if (typeof addSystemLog === 'function') {
                                    addSystemLog('DELETE_LOG', sampleItem.equip, '일정 변경 이력 삭제');
                                }
                            } else {
                                return;
                            }
                        } else {
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

                                for (const item of group.items) {
                                    const success = await setScheduleDate(item.site, item.equip, item.id, '', true, reason);
                                    if (success === false) return;
                                }
                            } else {
                                return;
                            }
                        }

                        renderCalendar();
                        if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                        if (typeof renderDetails === 'function') renderDetails();
                        if (typeof renderLogs === 'function') renderLogs();

                        const dateStr = document.getElementById('popup-date-title').textContent;
                        const allEvents = getScheduleForCalendar();
                        let dayEvents = allEvents[dateStr] || [];

                        const searchInput = document.getElementById('calendar-search');
                        const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

                        if (keyword || currentSearchFilters.site || currentSearchFilters.equip) {
                            const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                            dayEvents = dayEvents.filter(event => {
                                const equipParts = event.equip ? event.equip.split('::') : [];
                                const rawName = equipParts[0] || '';
                                const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
                                const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;

                                const kwStr = keyword.replace(/\s/g, '');
                                const matchKeyword = !keyword || (
                                    (event.site && event.site.toLowerCase().includes(keyword)) ||
                                    (event.equip && event.equip.toLowerCase().includes(keyword)) ||
                                    (displayName.toLowerCase().includes(keyword)) ||
                                    (event.content && event.content.toLowerCase().includes(keyword)) ||
                                    (event.worker && event.worker.toLowerCase().includes(keyword)) ||
                                    (event.type && event.type.toLowerCase().includes(keyword)) ||
                                    (event.detailType && event.detailType.toLowerCase().includes(keyword)) ||
                                    (event.content && event.content.replace(/\s/g, '').toLowerCase().includes(kwStr)) ||
                                    (event.detailType && event.detailType.replace(/\s/g, '').toLowerCase().includes(kwStr))
                                );
                                const matchSite = window.isSiteMatched(event.site, currentSearchFilters.site);
                                const matchEquip = !currentSearchFilters.equip || event.equip === currentSearchFilters.equip || rawName === currentSearchFilters.equip || displayName === currentSearchFilters.equip;
                                return matchKeyword && matchSite && matchEquip;
                            });
                        }
                        openCalendarPopup(dateStr, dayEvents);
                    };
                    rightContainer.appendChild(delBtn);
                }

                li.onclick = () => {
                    const sampleItem = group.items[0];
                    if (!sampleItem) {
                        console.error('[openCalendarPopup] group.items가 비어 있습니다.');
                        return;
                    }
                    const itemId = sampleItem.id || sampleItem.content; // id 누락 시 content를 fallback으로 활용
                    if (typeof window.openEventDetailModal === 'function') {
                        window.openEventDetailModal(group.site, group.equip, itemId, group.isCompleted || group.isChanged);
                    } else if (typeof openEventDetailModal === 'function') {
                        openEventDetailModal(group.site, group.equip, itemId, group.isCompleted || group.isChanged);
                    } else {
                        console.error('[openCalendarPopup] openEventDetailModal 함수가 존재하지 않습니다.');
                        alert('작업 상세 정보를 열 수 없습니다. 시스템 관리자에게 문의하세요.');
                    }
                };
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
   4. 모달: 작업 예정일 설정 (Schedule Date Modal)
   ========================================================================== */

function setupScheduleModal() {
    const modal = document.getElementById('schedule-modal');
    const closeBtn = document.getElementById('btn-close-schedule-modal');
    const saveBtn = document.getElementById('btn-save-schedule');
    const delBtn = document.getElementById('btn-delete-schedule');
    const dateInput = document.getElementById('schedule-date-input');

    if (!modal) return;

    // [추가] 작업자 및 공수 입력창 동적 생성 (기존 HTML에 누락되어 있을 경우 자동 주입)
    let dateInputRow = dateInput ? (dateInput.closest('.modal-date-row') || dateInput.closest('.form-row') || dateInput.parentNode) : null;
    if (dateInputRow && !document.getElementById('schedule-worker-wrapper')) {
        // [수정] 기존 예정일 입력 행을 작업자/공수 행과 동일한 레이아웃으로 강제 변환하여 너비 일치화
        dateInputRow.style.display = 'flex';
        dateInputRow.style.alignItems = 'center';
        dateInputRow.style.gap = '10px';
        const dLabel = dateInputRow.querySelector('label');
        if (dLabel) {
            dLabel.style.width = '80px';
            dLabel.style.flexShrink = '0';
            dLabel.style.marginBottom = '0';
            dLabel.style.fontWeight = 'bold';
        }
        dateInput.style.flex = '1';
        dateInput.style.minWidth = '0';

        // 1. 작업자 행(Row) 생성
        const workerRow = document.createElement('div');
        workerRow.className = 'form-row';
        workerRow.style.display = 'flex';
        workerRow.style.alignItems = 'center';
        workerRow.style.gap = '10px';
        workerRow.style.marginBottom = '15px';
        workerRow.innerHTML = `
                <label class="modal-label" style="width: 80px; flex-shrink: 0; color: #8b949e; font-size: 13px; font-weight: bold;">작업자</label>
                <div id="schedule-worker-wrapper" class="log-select-wrapper" style="flex: 1; width: 100%; min-width: 0; margin: 0; display: flex; align-items: center;">
                    <input type="hidden" id="schedule-worker-hidden">
                    <div id="schedule-worker-trigger" class="log-select-trigger" style="width: 100%; box-sizing: border-box; min-height:34px; display:flex; align-items:center; background:#0d1117; color:#8b949e; border:1px solid #30363d; border-radius:4px; padding:8px 10px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;">작업자 선택</div>
                    <div id="schedule-worker-dropdown" class="log-select-dropdown" style="width:100%; position:absolute; top:100%; left:0; z-index:1000; margin-top:4px; background:#161b22; border:1px solid #30363d; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5); box-sizing:border-box;">
                        <input type="text" id="schedule-worker-search" class="dropdown-search-input" placeholder="작업자 검색..." style="width: calc(100% - 12px); margin: 5px 6px; padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; color: #e6edf3; border-radius: 4px; box-sizing: border-box;" autocomplete="off">
                        <div id="schedule-worker-list" class="log-select-list" style="max-height: 200px; overflow-y: auto; padding: 8px;"></div>
                        <div class="log-select-footer" style="padding: 8px; border-top: 1px solid #30363d; background: #21262d; display: flex;">
                            <button type="button" id="btn-schedule-worker-confirm" class="btn-blue-sm" style="flex: 1; width: 100%;">선택 완료</button>
                        </div>
                    </div>
                </div>
            `;
        dateInputRow.parentNode.insertBefore(workerRow, dateInputRow.nextSibling);

        // 2. 공수(M/D) 행(Row) 생성
        if (!document.getElementById('schedule-md-input')) {
            const mdRow = document.createElement('div');
            mdRow.className = 'form-row';
            mdRow.style.display = 'flex';
            mdRow.style.alignItems = 'center';
            mdRow.style.gap = '10px';
            mdRow.style.marginBottom = '20px';
            mdRow.innerHTML = `
                    <label class="modal-label" style="width: 80px; flex-shrink: 0; color: #8b949e; font-size: 13px; font-weight: bold;">공수(M/D)</label>
                    <input type="number" id="schedule-md-input" class="input-dark" style="flex: 1; min-height: 34px; height: 34px; box-sizing: border-box; padding: 8px 10px;" min="0" step="0.1">
                `;
            workerRow.parentNode.insertBefore(mdRow, workerRow.nextSibling);
        }

        dateInputRow.style.marginBottom = '15px'; // 간격 통일화
    }

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    if (saveBtn) {
        saveBtn.onclick = async () => {
            if (currentScheduleTarget) {
                const date = dateInput.value;
                if (!date) return alert('날짜를 선택해주세요.');

                // [추가] 작업자 및 공수 값 가져오기
                const workerHidden = document.getElementById('schedule-worker-hidden');
                const mdInput = document.getElementById('schedule-md-input');
                const newWorker = workerHidden ? workerHidden.value.trim() : undefined;
                const newMd = mdInput ? mdInput.value.trim() : undefined;

                if (newWorker !== undefined && newMd !== undefined) {
                    const workerCount = newWorker ? newWorker.split(',').map(s => s.trim()).filter(Boolean).length : 0;
                    if (newMd && parseFloat(newMd) > workerCount) {
                        alert(`입력된 공수(${newMd})가 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
                        if (mdInput) mdInput.value = workerCount;
                        return;
                    }
                }

                const success = await setScheduleDate(currentScheduleTarget.site, currentScheduleTarget.equip, currentScheduleTarget.id, date, false, undefined, newWorker, newMd);
                if (success === false) return; // 사용자가 사유 입력을 취소하거나 통신 실패한 경우 중단
                modal.style.display = 'none';
                if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                renderCalendar();
                if (typeof renderDetails === 'function') renderDetails();
                if (typeof renderLogs === 'function') renderLogs();
            }
        };
    }

    if (delBtn) {
        delBtn.onclick = async () => {
            if (currentScheduleTarget && confirm('일정을 삭제하시겠습니까?')) {
                const success = await setScheduleDate(currentScheduleTarget.site, currentScheduleTarget.equip, currentScheduleTarget.id, '', true, undefined);
                if (success === false) return;
                modal.style.display = 'none';
                if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
                renderCalendar();
                if (typeof renderDetails === 'function') renderDetails();
                if (typeof renderLogs === 'function') renderLogs();
            }
        };
    }

    // [추가] 작업자 드롭다운 로직 추가
    const wTrigger = document.getElementById('schedule-worker-trigger');
    const wDropdown = document.getElementById('schedule-worker-dropdown');
    const wSearch = document.getElementById('schedule-worker-search');
    const wList = document.getElementById('schedule-worker-list');
    const wConfirm = document.getElementById('btn-schedule-worker-confirm');
    const wHidden = document.getElementById('schedule-worker-hidden');
    const mdInput = document.getElementById('schedule-md-input');

    if (wTrigger && wDropdown) {
        wTrigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== wDropdown) d.classList.remove('show'); });
            wDropdown.classList.toggle('show');
            if (wDropdown.classList.contains('show')) renderScheduleWorkers(wSearch ? wSearch.value.trim() : '');
        };

        const renderScheduleWorkers = async (searchTerm = '') => {
            const site = currentScheduleTarget ? currentScheduleTarget.site : null;
            const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(site) : [];
            const currentSelected = wHidden && wHidden.value ? wHidden.value.split(',').map(s => s.trim()).filter(Boolean) : [];
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

            if (typeof window.renderWorkerListItems === 'function') {
                window.renderWorkerListItems(wList, displayWorkers, currentSelected, () => {
                    const selected = Array.from(wList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
                    if (wHidden) wHidden.value = selected.join(', ');
                    if (selected.length > 0) wTrigger.textContent = selected.join(' ');
                    else wTrigger.textContent = '작업자 선택';
                    wTrigger.title = selected.join(', ');
                    if (mdInput) mdInput.value = selected.length.toString();
                });
            }
        };

        if (wSearch) {
            wSearch.onclick = (e) => e.stopPropagation();
            wSearch.oninput = (e) => renderScheduleWorkers(e.target.value.trim());
        }
        if (wConfirm) wConfirm.onclick = (e) => { e.stopPropagation(); wDropdown.classList.remove('show'); };
    }

    if (mdInput) {
        mdInput.oninput = function () {
            const workerCount = wHidden && wHidden.value ? wHidden.value.split(',').map(s => s.trim()).filter(Boolean).length : 0;
            const currentMd = parseFloat(this.value);
            if (!isNaN(currentMd) && currentMd > workerCount) {
                alert(`공수(M/D)는 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
                this.value = workerCount;
            }
        };
    }
}

function openScheduleModal(site, equip, id) {
    if (typeof window.checkSessionValid === 'function' && !window.checkSessionValid()) return;
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

    const delBtn = document.getElementById('btn-delete-schedule');
    if (delBtn) {
        if (item && item.scheduledDate) {
            delBtn.style.display = '';
        } else {
            delBtn.style.display = 'none';
        }
    }

    // [수정] 작업자, 공수 입력 UI 복원 및 값 초기화
    const workerWrapper = document.getElementById('schedule-worker-wrapper');
    if (workerWrapper) workerWrapper.style.display = '';
    const mdInput = document.getElementById('schedule-md-input');
    if (mdInput) {
        const formRow = mdInput.closest('.form-row');
        if (formRow) formRow.style.display = '';
        mdInput.value = item && item.md ? item.md : '';
    }

    const workerHidden = document.getElementById('schedule-worker-hidden');
    const workerTrigger = document.getElementById('schedule-worker-trigger');
    if (workerHidden && workerTrigger) {
        const workerVal = item && item.worker ? item.worker : '';
        workerHidden.value = workerVal;
        if (workerVal) {
            workerTrigger.textContent = workerVal;
            workerTrigger.title = workerVal;
            workerTrigger.style.color = '#fff';
        } else {
            workerTrigger.textContent = '작업자 선택';
            workerTrigger.title = '';
            workerTrigger.style.color = '#8b949e';
        }
    }

    modal.style.display = 'flex';
}

/* ==========================================================================
   7. 모달: 검색 필터 (Search Filter Modal)
   ========================================================================== */

function setupSearchModal() {
    const modal = document.getElementById('calendar-search-modal');
    const closeBtn = document.getElementById('btn-close-search-modal');
    const resetBtn = document.getElementById('btn-reset-search-filter');
    const applyBtn = document.getElementById('btn-apply-search-filter');
    const equipSelect = document.getElementById('search-equip-select');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    // 사업장 다중 선택 드롭다운 이벤트
    const siteTrigger = document.getElementById('search-site-trigger');
    const siteDropdown = document.getElementById('search-site-dropdown');
    const siteList = document.getElementById('search-site-list');
    const btnSiteAll = document.getElementById('btn-search-site-all');
    const btnSiteClear = document.getElementById('btn-search-site-clear');
    const btnSiteConfirm = document.getElementById('btn-search-site-confirm');

    if (siteTrigger && siteDropdown) {
        siteTrigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== siteDropdown) d.classList.remove('show'); });
            siteDropdown.classList.toggle('show');
        };

        // [추가] 사업장 그룹 일괄 선택/해제 버튼 (Sort 메뉴 스타일)
        if (!document.getElementById('calendar-site-group-toggle-container')) {
            const siteGroups = ['SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타'];
            const btnsHtml = siteGroups.map(g => `<button type="button" class="btn-gray site-group-toggle-btn" data-group="${g}" style="padding: 2px 6px; font-size: 11px; margin-right: 4px; margin-bottom: 4px; cursor: pointer;">${g}</button>`).join('');
            const extraHeader = `<div id="calendar-site-group-toggle-container" style="padding: 8px 8px 4px 8px; border-bottom: 1px solid #30363d; display: flex; flex-wrap: wrap;">${btnsHtml}</div>`;

            siteDropdown.insertAdjacentHTML('afterbegin', extraHeader);

            const toggleBtns = siteDropdown.querySelectorAll('.site-group-toggle-btn');
            toggleBtns.forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetGroup = btn.dataset.group;
                    if (!siteList) return;

                    const groupItems = Array.from(siteList.querySelectorAll('.log-select-item')).filter(item => item.dataset.siteGroup === targetGroup);
                    if (groupItems.length === 0) return;

                    const allSelected = groupItems.every(item => item.classList.contains('selected'));

                    groupItems.forEach(el => {
                        if (allSelected) {
                            el.classList.remove('selected');
                            const icon = el.querySelector('.check-icon');
                            if (icon) icon.style.opacity = '0';
                        } else {
                            el.classList.add('selected');
                            const icon = el.querySelector('.check-icon');
                            if (icon) icon.style.opacity = '1';
                        }
                    });

                    updateSiteTriggerText();
                    updateSearchEquipSelect(getSelectedSites());
                };
            });
        }

        if (btnSiteAll) {
            btnSiteAll.onclick = (e) => {
                e.stopPropagation();
                if (siteList) {
                    siteList.querySelectorAll('.log-select-item').forEach(el => {
                        el.classList.add('selected');
                        const icon = el.querySelector('.check-icon');
                        if (icon) icon.style.opacity = '1';
                    });
                    updateSiteTriggerText();
                    updateSearchEquipSelect(getSelectedSites());
                }
            };
        }

        if (btnSiteClear) {
            btnSiteClear.onclick = (e) => {
                e.stopPropagation();
                if (siteList) {
                    siteList.querySelectorAll('.log-select-item').forEach(el => {
                        el.classList.remove('selected');
                        const icon = el.querySelector('.check-icon');
                        if (icon) icon.style.opacity = '0';
                    });
                    updateSiteTriggerText();
                    updateSearchEquipSelect(getSelectedSites());
                }
            };
        }

        if (btnSiteConfirm) {
            btnSiteConfirm.onclick = (e) => {
                e.stopPropagation();
                siteDropdown.classList.remove('show');
            };
        }
    }

    if (resetBtn) {
        resetBtn.textContent = '내 사업장 검색';
        resetBtn.onclick = () => {
            const userSite = sessionStorage.getItem('userSite') || '';
            currentSearchFilters = { site: userSite ? [userSite] : [], equip: '' };
            const siteList = document.getElementById('search-site-list');
            if (siteList) {
                siteList.querySelectorAll('.log-select-item').forEach(el => {
                    if (el.dataset.value === userSite) {
                        el.classList.add('selected');
                        const icon = el.querySelector('.check-icon');
                        if (icon) icon.style.opacity = '1';
                    } else {
                        el.classList.remove('selected');
                        const icon = el.querySelector('.check-icon');
                        if (icon) icon.style.opacity = '0';
                    }
                });
                updateSiteTriggerText();
            }
            updateSearchEquipSelect(currentSearchFilters.site);
            if (equipSelect) equipSelect.value = '';
            modal.style.display = 'none';
            renderCalendar();
        };

    }

    if (applyBtn) {
        applyBtn.onclick = () => {
            let sites = getSelectedSites();
            const totalSites = document.querySelectorAll('#search-site-list .log-select-item').length;
            if (sites.length === totalSites || sites.length === 0) {
                sites = []; // 전체 선택 또는 선택 없음 시 빈 배열 할당
            }
            const eq = equipSelect ? equipSelect.value : '';
            currentSearchFilters = { site: sites, equip: eq };
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
    const equipSelect = document.getElementById('search-equip-select');
    const siteList = document.getElementById('search-site-list');

    if (!modal || !siteList) return;
    const data = getDeviceDataMap();
    const sites = Object.keys(data).filter(k => k !== 'models' && k !== 'details').sort();

    siteList.innerHTML = '';

    const currentFilterSites = Array.isArray(currentSearchFilters.site) ? currentSearchFilters.site : (currentSearchFilters.site ? [currentSearchFilters.site] : []);
    const isAllSelected = currentFilterSites.length === 0;

    sites.forEach(site => {
        const isSelected = isAllSelected || currentFilterSites.includes(site);
        const div = document.createElement('div');
        div.className = 'log-select-item';
        if (isSelected) div.classList.add('selected');
        div.dataset.value = site;
        div.dataset.siteGroup = typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타사업장'; // [추가]
        div.innerHTML = `<span class="check-icon" style="flex: 1; text-align: center; opacity:${isSelected ? '1' : '0'}; font-weight:bold; color:#58a6ff;">✓</span><span class="item-text" style="flex: 9; padding-left: 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(site)}</span>`;

        div.onclick = (e) => {
            e.stopPropagation();
            div.classList.toggle('selected');
            const icon = div.querySelector('.check-icon');
            if (icon) icon.style.opacity = div.classList.contains('selected') ? '1' : '0';
            updateSiteTriggerText();
            updateSearchEquipSelect(getSelectedSites());
        };
        siteList.appendChild(div);
    });

    updateSiteTriggerText();

    updateSearchEquipSelect(currentSearchFilters.site);


    // [추가] 팝업을 열었을 때 기존에 선택된 장비 정보 복원
    if (currentSearchFilters.equip) {
        if (equipSelect) equipSelect.value = currentSearchFilters.equip;
        const trigger = document.getElementById('search-equip-trigger');
        if (trigger) {
            const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
            const parts = currentSearchFilters.equip.split('::');
            const rawName = parts[0] || '';
            const serial = parts.length > 1 ? parts[1] : '';
            const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
            const targetSite = Array.isArray(currentSearchFilters.site) ? (currentSearchFilters.site.length > 0 ? currentSearchFilters.site[0] : '') : currentSearchFilters.site;
            const key = `details_${targetSite}_${currentSearchFilters.equip}`;
            const detailData = JSON.parse(localStorage.getItem(key)) || {};
            const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

            let displayValueHtml = escapeHtml(displayName);
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

function getSelectedSites() {
    const list = document.getElementById('search-site-list');
    if (!list) return [];
    return Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
}

function updateSiteTriggerText() {
    const list = document.getElementById('search-site-list');
    const trigger = document.getElementById('search-site-trigger');
    if (!list || !trigger) return;

    const selected = Array.from(list.querySelectorAll('.log-select-item.selected'));
    const total = list.querySelectorAll('.log-select-item').length;

    if (selected.length === total || selected.length === 0) {
        trigger.textContent = '전체 사업장';
        trigger.style.color = '#e6edf3';
    } else if (selected.length === 1) {
        trigger.textContent = selected[0].dataset.value;
        trigger.style.color = '#e6edf3';
    } else {
        trigger.textContent = `${selected[0].dataset.value} 외 ${selected.length - 1}개`;
        trigger.style.color = '#e6edf3';
    }
    trigger.title = selected.map(el => el.dataset.value).join('\n');
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

    let siteArr = Array.isArray(site) ? site : (site ? [site] : []);

    if (trigger) {
        if (siteArr.length === 0) {
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

    if (siteArr.length === 0) return;

    const data = getDeviceDataMap();
    let equips = [];
    siteArr.forEach(s => {
        if (data[s]) {
            data[s].forEach(eq => equips.push({ site: s, equip: eq }));
        }
    });

    if (equipSelect) {
        equips.forEach(item => {
            const option = document.createElement('option');
            option.value = item.equip;
            equipSelect.appendChild(option);
        });
    }

    // 제안 박스 렌더링 로직
    window.renderSearchEquipSuggestions = (searchTerm = '') => {
        if (!list) return;
        list.innerHTML = '';
        const keywords = searchTerm.toLowerCase().split(/\s+/);
        const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

        let matches = equips.filter(item => {
            const parts = item.equip.split('::');
            const rawName = parts[0] || '';
            const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
            const serial = parts.length > 1 ? parts[1] : '';
            const key = `details_${item.site}_${item.equip}`;
            const detailData = JSON.parse(localStorage.getItem(key)) || {};
            const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

            const text = `${rawName} ${displayName} ${serial} ${custName}`.toLowerCase();
            return keywords.every(kw => text.includes(kw));
        });

        if (searchTerm === '') {
            const allLi = document.createElement('div');
            allLi.className = 'log-select-item';
            allLi.style.padding = '10px 8px';
            allLi.innerHTML = `<span>전체 장비</span>`;
            allLi.addEventListener('pointerdown', (ev) => {
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
            matches.forEach(item => {
                const parts = item.equip.split('::');
                const rawName = parts[0] || '';
                const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
                const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
                const serial = parts.length > 1 ? parts[1] : '';

                const key = `details_${item.site}_${item.equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                let displayValueHtml = escapeHtml(displayName);
                let subInfoHtml = '';
                if (custName) {
                    subInfoHtml = ` <span style="color:#3fb950;">[${escapeHtml(custName)}]</span>`;
                } else if (serial) {
                    subInfoHtml = ` <span style="color:#3fb950;">[${escapeHtml(serial)}]</span>`;
                }

                let plainDisplayValue = displayName;
                if (custName) plainDisplayValue += ` [${custName}]`;
                else if (serial) plainDisplayValue += ` [${serial}]`;

                const li = document.createElement('div');
                li.className = 'log-select-item';
                li.style.padding = '10px 8px';
                li.innerHTML = `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayValueHtml}${subInfoHtml}</span>`;

                li.addEventListener('pointerdown', (ev) => {
                    ev.preventDefault();
                    if (equipSelect) equipSelect.value = item.equip;
                    trigger.innerHTML = `${escapeHtml(displayName)}${subInfoHtml}`;
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
   8. 드래그 앤 드롭 (Drag & Drop)
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

window.handleCalendarDrop = async function (e, newDate) {
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

            for (const id of ids) {
                await setScheduleDate(site, equip, id, newDate, false, reason);
            }
            renderCalendar();
            if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
            if (typeof renderDetails === 'function') renderDetails();
            if (typeof renderLogs === 'function') renderLogs();
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
    if (typeof window.syncAdminDB === 'function') {
        window.syncAdminDB('setting', 'UPDATE', { key: 'calendar_confirmations', value: confs });
    }

    if (typeof addSystemLog === 'function') {
        addSystemLog('CONFIRM_SCHEDULE', site, `${year}년 ${month + 1}월 작업 확정 (작업수: ${count}건)`);
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
        if (typeof window.syncAdminDB === 'function') {
            window.syncAdminDB('setting', 'UPDATE', { key: 'calendar_confirmations', value: confs });
        }

        if (typeof addSystemLog === 'function') {
            addSystemLog('CANCEL_CONFIRM_SCHEDULE', site, `${year}년 ${month + 1}월 작업 확정 취소`);
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
            if (typeof window.syncAdminDB === 'function') {
                window.syncAdminDB('setting', 'UPDATE', { key: 'calendar_confirmations', value: confs });
            }
        }
    }
};

// 전역 노출
window.renderCalendar = renderCalendar;
window.goToTodayMonth = goToTodayMonth;
window.openScheduleModal = openScheduleModal;