/* ==========================================================================
   1. 초기화 및 전역 변수 (Initialization & Globals)
   ========================================================================== */
let calendarDate = new Date();
let originalDetailMemo = "";
let currentSearchFilters = { site: '', equip: '' };
let currentScheduleTarget = null;
let currentDetailTarget = null;
let selectedSiteFilter = null;
let selectedEquipFilter = null;
let selectedSerialFilter = null;
let currentGanttFilters = { site: '', equip: '' };
let setupDashboardFilter = { site: '', equip: '' };
let ganttSidebarWidth = 300; // Gantt Sidebar Width
let ganttDayWidth = 20; // Gantt Day Width
const GANTT_SIDEBAR_MIN_WIDTH = 250;
const GANTT_SIDEBAR_MAX_WIDTH = 600;
const GANTT_PADDING_START = 1; // [추가] 시작일 이전 여유 일수 (설정값)
const GANTT_PADDING_END = 1;   // [추가] 종료일 이후 여유 일수 (설정값)
let isFirstLoad = true; // [추가] 첫 로드 여부 확인
let ganttExtraWeeks = 0; // [추가] 간트 차트 달력 확장 주수
let ganttValidDates = []; // [추가] 간트 차트 유효 날짜 배열 (전역)
let isHoveringHoliday = false; // [추가] 드래그 중 공휴일 호버 여부
let currentExecStartTarget = null; // [추가] 실행 시작일 설정 대상
let currentExecStartTargetId = null; // [추가] 실행 시작일 설정 대상 ID

document.addEventListener('DOMContentLoaded', () => {
    // 초기화 함수 정의
    const initDashboard = () => {
        updateHomeDashboard();
    };

    // UI 이벤트 리스너 등록 (데이터 로드 여부와 무관하게 실행)
    setupCalendar();
    setupScheduleModal();
    setupEventDetailModal();
    setupRegisterScheduleModal();
    setupSearchModal();
    setupGanttSearch();
    setupGanttSearchModal();
    setupGanttResizer(); // [이동] 초기화 시 한 번만 실행
    setupEquipInfoResizer(); // [추가] 장비 정보 리사이저 초기화
    setupGanttZoom(); // [추가] 간트 차트 줌 버튼 초기화
    setupSetupExecStartModal(); // [추가] 실행 시작일 모달 초기화

    // [수정] 이미 데이터가 로드되었는지 확인 후 실행
    if (window.isDataLoaded) {
        initDashboard();
    } else {
        window.addEventListener('DataLoaded', initDashboard);
    }
});

/* ==========================================================================
   2. 네비게이션 및 뷰 전환 (Navigation & View Switching)
   ========================================================================== */
function goToSetupPage() {
    // [추가] 간트 차트 필터(검색된 장비)가 있으면 우선 이동
    if (currentGanttFilters.site && currentGanttFilters.equip) {
        location.href = `setup.html?site=${encodeURIComponent(currentGanttFilters.site)}&equip=${encodeURIComponent(currentGanttFilters.equip)}`;
        return;
    }

    let targetSite = setupDashboardFilter.site;
    let targetEquipName = setupDashboardFilter.equip;
    let fullEquipName = '';

    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

    if (targetSite && targetEquipName) {
        if (data[targetSite]) {
            const found = data[targetSite].find(e => e.split('::')[0] === targetEquipName);
            if (found) fullEquipName = found;
        }
    }

    if (targetSite && fullEquipName) {
        location.href = `setup.html?site=${encodeURIComponent(targetSite)}&equip=${encodeURIComponent(fullEquipName)}`;
    } else {
        try {
            const lastState = JSON.parse(sessionStorage.getItem('lastSetupPath'));
            if (lastState && lastState.site && lastState.equip) {
                location.href = `setup.html?site=${encodeURIComponent(lastState.site)}&equip=${encodeURIComponent(lastState.equip)}`;
                return;
            }
        } catch (e) { }
        location.href = 'setup.html';
    }
}

function goToMaintenancePage() {
    // [수정] 운영 관리 대시보드 필터 확인 후 이동, 없으면 마지막 상태 복원
    let targetSite = selectedSiteFilter;
    let targetEquipName = selectedEquipFilter;
    let targetSerial = selectedSerialFilter;

    // 캘린더 검색 필터가 있다면 우선 적용
    if (currentSearchFilters.site && currentSearchFilters.equip) {
        targetSite = currentSearchFilters.site;
        targetSerial = currentSearchFilters.equip;
    }

    let fullEquipName = '';
    const data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

    if (targetSerial) {
        fullEquipName = targetSerial;
        if (!targetSite) {
            for (const site in data) {
                if (data[site].includes(fullEquipName)) { targetSite = site; break; }
            }
        }
    } else if (targetSite && targetEquipName) {
        if (data[targetSite]) {
            const found = data[targetSite].find(e => e.split('::')[0] === targetEquipName);
            if (found) fullEquipName = found;
        }
    }

    if (targetSite && fullEquipName) {
        location.href = `maintenance.html?site=${encodeURIComponent(targetSite)}&equip=${encodeURIComponent(fullEquipName)}`;
    } else {
        try {
            const lastState = JSON.parse(sessionStorage.getItem('lastMaintPath'));
            if (lastState && lastState.site && lastState.equip) {
                location.href = `maintenance.html?site=${encodeURIComponent(lastState.site)}&equip=${encodeURIComponent(lastState.equip)}`;
                return;
            }
        } catch (e) { }
        location.href = 'maintenance.html';
    }
}

function showHomeSection(type) {
    const menuContainer = document.querySelector('.home-menu-container');
    const setupSec = document.getElementById('section-setup');
    const maintSec = document.getElementById('section-maint');

    // 메뉴 컨테이너를 컴팩트 모드로 전환 (애니메이션 효과)
    menuContainer.classList.add('compact');

    // [추가] 마지막 선택 상태 저장
    localStorage.setItem('lastHomeSection', type);

    if (type === 'setup') {
        setupSec.style.display = 'flex';
        maintSec.style.display = 'none';
        renderGanttChart(); // Render Gantt when tab is shown
    } else if (type === 'maint') {
        setupSec.style.display = 'none';
        maintSec.style.display = 'flex';
        renderCalendar();
    }
}

/* ==========================================================================
   3. 대시보드 로직 (Dashboard Logic)
   ========================================================================== */
function updateHomeDashboard() {
    // [추가] 첫 로드 시 마지막 화면 상태 및 필터 복원
    if (isFirstLoad) {
        const lastSection = localStorage.getItem('lastHomeSection');

        try {
            const savedSetupFilter = JSON.parse(localStorage.getItem('setupDashboardFilter'));
            if (savedSetupFilter) setupDashboardFilter = savedSetupFilter;

            const savedGanttFilter = JSON.parse(localStorage.getItem('currentGanttFilters'));
            if (savedGanttFilter) currentGanttFilters = savedGanttFilter;

            // [추가] 운영 관리 필터 복원
            const savedMaintFilter = JSON.parse(localStorage.getItem('maintDashboardFilter'));
            if (savedMaintFilter) {
                selectedSiteFilter = savedMaintFilter.site;
                selectedEquipFilter = savedMaintFilter.equip;
                selectedSerialFilter = savedMaintFilter.serial;
                if (savedMaintFilter.search) currentSearchFilters = savedMaintFilter.search;
            }
        } catch (e) { console.error("Failed to restore filters", e); }

        if (lastSection) {
            showHomeSection(lastSection);
        }
        isFirstLoad = false;
    }

    updateMaintenanceDashboard();
    updateSetupDashboard();
}

function saveMaintFilters() {
    const maintFilters = {
        site: selectedSiteFilter,
        equip: selectedEquipFilter,
        serial: selectedSerialFilter,
        search: currentSearchFilters
    };
    localStorage.setItem('maintDashboardFilter', JSON.stringify(maintFilters));
}

/* ==========================================================================
   3-1. 유지관리 대시보드 (Maintenance Dashboard)
   ========================================================================== */
function updateMaintenanceDashboard() {
    // 데이터 로드 (common.js의 storageData가 있다면 사용, 없으면 직접 로드)
    let data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

    let totalEquip = 0;
    const siteStats = [];
    const equipCounts = {};

    if (data) {
        Object.keys(data).forEach(site => {
            const list = data[site];
            const count = list ? list.length : 0;
            if (count > 0) {
                siteStats.push({ name: site, count: count });
                totalEquip += count;

                // 장비별 집계
                if (Array.isArray(list)) {
                    list.forEach(item => {
                        const name = item.split('::')[0];
                        equipCounts[name] = (equipCounts[name] || 0) + 1;
                    });
                }
            }
        });
    }

    let todayPmCount = 0;
    let totalPmItems = 0;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 상세 데이터 순회
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('details_')) {
            const detailData = JSON.parse(localStorage.getItem(key));
            if (detailData && detailData.maint) {
                let hasUpcoming = false;
                detailData.maint.forEach(item => {
                    if (item.type === 'PM') {
                        totalPmItems++;
                        if (item.date && item.period) {
                            const [y, m, d] = item.date.split('-').map(Number);
                            const targetDate = new Date(y, m - 1, d);
                            targetDate.setDate(targetDate.getDate() + parseInt(item.period));

                            // 오늘 날짜와 비교 (시간 제외)
                            const targetTime = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();

                            if (targetTime === today.getTime()) {
                                todayPmCount++;
                            }
                        }
                    }
                });
            }
        }
    }

    // 도넛 차트 및 리스트 렌더링
    const equipStats = Object.keys(equipCounts).map(key => ({ name: key, count: equipCounts[key] }));

    renderSiteStatus(siteStats, totalEquip, data);
    renderEquipChart(equipStats, totalEquip, data);
    renderEquipDetailList(data);

    // 점검 임박 리스트 업데이트
    renderUpcomingList(data);
}

function renderSiteStatus(siteStats, totalEquip, allData) {
    const chartEl = document.getElementById('site-status-chart');
    const listEl = document.getElementById('site-status-list');
    const centerText = document.getElementById('site-chart-center');

    if (!chartEl || !listEl) return;

    listEl.innerHTML = '';

    if (totalEquip === 0) {
        chartEl.style.background = ''; // CSS 기본값 사용
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Site</div><div class="chart-center-value">0</div>`;
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    // 색상 팔레트
    const colors = ['#1f6feb', '#238636', '#d29922', '#8957e5', '#da3633', '#f0883e', '#3fb950', '#a371f7'];

    let gradientStr = '';
    let currentDeg = 0;

    // 장비 수 많은 순으로 정렬
    siteStats.sort((a, b) => b.count - a.count);

    // 전체 항목 추가
    const allLi = document.createElement('li');
    allLi.className = 'status-list-item';
    if (selectedSiteFilter === null) {
        allLi.classList.add('active');
    }
    allLi.innerHTML = `
        <span class="status-color status-color-all"></span>
        <span class="status-name">전체</span>
        <span class="status-count">${totalEquip}</span>
    `;
    allLi.onclick = () => {
        selectedSiteFilter = null;
        selectedEquipFilter = null; // 사이트 전체 선택 시 장비 필터도 초기화
        selectedSerialFilter = null;
        currentSearchFilters = { site: '', equip: '' };
        saveMaintFilters(); // [추가] 상태 저장
        renderCalendar();
        renderSiteStatus(siteStats, totalEquip, allData);
        updateEquipChartBasedOnFilter(allData);
        renderEquipDetailList(allData);
        renderUpcomingList(allData); // 점검 임박 리스트 갱신
    };
    listEl.appendChild(allLi);

    siteStats.forEach((site, index) => {
        const color = colors[index % colors.length];
        const deg = (site.count / totalEquip) * 360;

        gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
        currentDeg += deg;

        // 리스트 아이템 생성
        const li = document.createElement('li');
        li.className = 'status-list-item';
        if (selectedSiteFilter === site.name) {
            li.classList.add('active');
        }

        li.innerHTML = `
            <span class="status-color" style="background-color: ${color};"></span>
            <span class="status-name" title="${escapeHtml(site.name)}">${escapeHtml(site.name)}</span>
            <span class="status-count">${site.count}</span>
        `;

        li.onclick = () => {
            if (selectedSiteFilter === site.name) {
                selectedSiteFilter = null; // 이미 선택된 경우 해제
            } else {
                selectedSiteFilter = site.name; // 선택
            }
            selectedEquipFilter = null; // 사이트 변경 시 장비 필터 초기화
            selectedSerialFilter = null;
            saveMaintFilters(); // [추가] 상태 저장
            // UI 갱신 (리스트 다시 그리기)
            renderSiteStatus(siteStats, totalEquip, allData);
            // 장비 차트 업데이트
            updateEquipChartBasedOnFilter(allData);
            renderEquipDetailList(allData);
            renderUpcomingList(allData); // 점검 임박 리스트 갱신
        };
        listEl.appendChild(li);
    });

    // 차트 적용 (마지막 콤마 제거)
    chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
    if (centerText) centerText.innerHTML = `<div class="chart-center-label">Site</div><div class="chart-center-value">${siteStats.length}</div>`;
}

function updateEquipChartBasedOnFilter(data) {
    const equipCounts = {};
    let totalEquip = 0;

    if (selectedSiteFilter) {
        // 특정 사업장 필터링
        const list = data[selectedSiteFilter];
        if (list && Array.isArray(list)) {
            totalEquip = list.length;
            list.forEach(item => {
                const name = item.split('::')[0];
                equipCounts[name] = (equipCounts[name] || 0) + 1;
            });
        }
    } else {
        // 전체 보기 (필터 없음)
        Object.keys(data).forEach(site => {
            const list = data[site];
            if (list && Array.isArray(list)) {
                totalEquip += list.length;
                list.forEach(item => {
                    const name = item.split('::')[0];
                    equipCounts[name] = (equipCounts[name] || 0) + 1;
                });
            }
        });
    }

    const equipStats = Object.keys(equipCounts).map(key => ({ name: key, count: equipCounts[key] }));
    renderEquipChart(equipStats, totalEquip, data);
}

function renderEquipChart(equipStats, totalEquip, allData) {
    const chartEl = document.getElementById('equip-status-chart');
    const listEl = document.getElementById('equip-status-list');
    const centerText = document.getElementById('equip-chart-center');

    if (!chartEl) return;

    if (listEl) listEl.innerHTML = '';

    if (totalEquip === 0) {
        chartEl.style.background = ''; // CSS 기본값 사용
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Equip</div><div class="chart-center-value">0</div>`;
        if (listEl) listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    // 색상 팔레트 (다른 톤 사용)
    const colors = ['#a371f7', '#f0883e', '#3fb950', '#da3633', '#8957e5', '#d29922', '#238636', '#1f6feb'];

    let gradientStr = '';
    let currentDeg = 0;

    // 장비 수 많은 순으로 정렬
    equipStats.sort((a, b) => b.count - a.count);

    // 전체 항목 추가
    if (listEl) {
        const allLi = document.createElement('li');
        allLi.className = 'status-list-item';
        if (selectedEquipFilter === null) {
            allLi.classList.add('active');
        }
        allLi.innerHTML = `
            <span class="status-color status-color-all"></span>
            <span class="status-name">전체</span>
            <span class="status-count">${totalEquip}</span>
        `;
        allLi.onclick = () => {
            selectedEquipFilter = null;
            selectedSerialFilter = null;
            currentSearchFilters = { site: '', equip: '' };
            saveMaintFilters(); // [추가] 상태 저장
            renderCalendar();
            renderEquipChart(equipStats, totalEquip, allData);
            renderEquipDetailList(allData);
            renderUpcomingList(allData);
        };
        listEl.appendChild(allLi);
    }

    equipStats.forEach((equip, index) => {
        const color = colors[index % colors.length];
        const deg = (equip.count / totalEquip) * 360;

        gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
        currentDeg += deg;

        if (listEl) {
            const li = document.createElement('li');
            li.className = 'status-list-item';
            if (selectedEquipFilter === equip.name) {
                li.classList.add('active');
            }
            li.innerHTML = `
                <span class="status-color" style="background-color: ${color};"></span>
                <span class="status-name" title="${escapeHtml(equip.name)}">${escapeHtml(equip.name)}</span>
                <span class="status-count">${equip.count}</span>
            `;
            li.onclick = () => {
                if (selectedEquipFilter === equip.name) {
                    selectedEquipFilter = null;
                } else {
                    selectedEquipFilter = equip.name;
                }
                selectedSerialFilter = null; // 장비 종류 변경 시 개별 장비 필터 초기화
                saveMaintFilters(); // [추가] 상태 저장
                renderEquipChart(equipStats, totalEquip, allData);
                renderEquipDetailList(allData);
                renderUpcomingList(allData);
            };
            listEl.appendChild(li);
        }
    });

    chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
    if (centerText) centerText.innerHTML = `<div class="chart-center-label">Equip</div><div class="chart-center-value">${totalEquip}</div>`;
}

function renderEquipDetailList(data) {
    const listEl = document.getElementById('equip-detail-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    let items = [];

    if (data) {
        Object.keys(data).forEach(site => {
            if (selectedSiteFilter && site !== selectedSiteFilter) return;

            if (data[site]) {
                data[site].forEach(equip => {
                    const parts = equip.split('::');
                    const name = parts[0];
                    const serial = parts.length > 1 ? parts[1] : '';

                    if (selectedEquipFilter && name !== selectedEquipFilter) return;

                    items.push({ site, equip, name, serial });
                });
            }
        });
    }

    if (items.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'status-list-item';
        if (selectedSerialFilter === item.equip) {
            li.classList.add('active');
        }
        li.innerHTML = `
            <span class="status-name" style="margin-right:0;">${escapeHtml(item.site)} > ${escapeHtml(item.name)} ${item.serial ? `(${escapeHtml(item.serial)})` : ''}</span>
        `;
        li.onclick = () => {
            if (selectedSerialFilter === item.equip) {
                selectedSerialFilter = null;
                currentSearchFilters.site = '';
                currentSearchFilters.equip = '';
            } else {
                selectedSerialFilter = item.equip;
                currentSearchFilters.site = item.site;
                currentSearchFilters.equip = item.equip;
            }
            saveMaintFilters(); // [추가] 상태 저장
            renderEquipDetailList(data); // Highlight 갱신
            renderUpcomingList(data); // 점검 임박 리스트 필터링
            renderCalendar();
        };
        listEl.appendChild(li);
    });
}

function renderUpcomingList(data) {
    const upcomingListEl = document.getElementById('dash-upcoming-list');
    const upcomingContainer = document.getElementById('dash-upcoming-container');

    if (!upcomingListEl || !upcomingContainer) return;

    upcomingListEl.innerHTML = '';
    const upcomingItems = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (data) {
        Object.keys(data).forEach(site => {
            // 사이트 필터 적용
            if (selectedSiteFilter && site !== selectedSiteFilter) return;

            if (data[site]) {
                data[site].forEach(equip => {
                    // 장비 필터 적용
                    const equipName = equip.split('::')[0];
                    if (selectedEquipFilter && equipName !== selectedEquipFilter) return;

                    // 시리얼(개별 장비) 필터 적용
                    if (selectedSerialFilter && equip !== selectedSerialFilter) return;

                    const key = `details_${site}_${equip}`;
                    const detailData = JSON.parse(localStorage.getItem(key));
                    if (detailData && detailData.maint) {
                        detailData.maint.forEach(item => {
                            if (item.type === 'PM' && item.date && item.period) {
                                const [y, m, d] = item.date.split('-').map(Number);
                                const targetDate = new Date(y, m - 1, d);
                                targetDate.setDate(targetDate.getDate() + parseInt(item.period));
                                const diffDays = Math.round((targetDate - today) / (1000 * 60 * 60 * 24));

                                if (diffDays <= 30) {
                                    upcomingItems.push({
                                        diffDays: diffDays,
                                        site: site,
                                        equip: equip,
                                        item: item
                                    });
                                }
                            }
                        });
                    }
                });
            }
        });
    }

    // 남은 일수 오름차순 정렬 (지연된 항목이 가장 위로)
    upcomingItems.sort((a, b) => a.diffDays - b.diffDays);

    const template = document.getElementById('upcoming-item-template');

    upcomingItems.forEach(obj => {
        const { diffDays, site, equip, item } = obj;
        const parts = equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';

        const clone = template.content.cloneNode(true);
        const div = clone.querySelector('.upcoming-item');
        div.onclick = () => openScheduleModal(site, equip, item.id);
        div.title = "클릭하여 작업 예정일 설정";

        // D-Day 뱃지 색상 및 텍스트
        let badgeClass = 'safe';
        let dDayText = `D-${diffDays}`;
        if (diffDays < 0) {
            badgeClass = 'danger';
            dDayText = `+${Math.abs(diffDays)}`;
        } else if (diffDays === 0) {
            badgeClass = 'warning';
            dDayText = 'D-Day';
        } else if (diffDays <= 3) {
            badgeClass = 'warning';
        }

        const siteInfo = clone.querySelector('.upcoming-info-site');
        siteInfo.innerHTML = `${escapeHtml(site)} > ${escapeHtml(name)} ${serial ? `<span class="upcoming-info-sn">(${escapeHtml(serial)})</span>` : ''}`;

        clone.querySelector('.upcoming-info-content').textContent = item.content; // textContent는 안전함

        const badge = clone.querySelector('.d-day-badge');
        badge.className = `d-day-badge ${badgeClass}`;
        badge.textContent = dDayText;

        const btn = clone.querySelector('.btn-shortcut');
        if (btn) {
            btn.onclick = (e) => {
                e.stopPropagation();
                location.href = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}`;
            };
        }

        upcomingListEl.appendChild(clone);
    });

    // 항상 표시하되 내용이 없으면 메시지 출력
    upcomingContainer.style.display = 'flex';
    if (upcomingItems.length === 0) {
        upcomingListEl.innerHTML = '<div class="upcoming-empty-msg">예정된 점검이 없습니다.</div>';
    }
}

/* ==========================================================================
   3-2. 셋업 대시보드 (Setup Dashboard)
   ========================================================================== */
function updateSetupDashboard() {
    // [추가] 필터 상태 저장
    localStorage.setItem('setupDashboardFilter', JSON.stringify(setupDashboardFilter));
    localStorage.setItem('currentGanttFilters', JSON.stringify(currentGanttFilters));

    let data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

    // 활성 셋업 장비 데이터 집계
    let activeSetupEquips = [];
    let siteStats = {};
    let equipCounts = {};

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    Object.keys(data).forEach(site => {
        if (data[site]) {
            data[site].forEach(equip => {
                const detailData = setupData[`${site}::${equip}`];

                // 셋업 데이터가 있고, 완료되지 않은 경우 (또는 셋업 중인 장비로 간주)
                if (detailData && detailData.setupDetails && detailData.setupDetails.length > 0) {
                    // "셋업 완료" 항목이 체크되어 있는지 확인
                    const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                    const isCompleted = completeItem && completeItem.completed;
                    const hasScheduledDate = completeItem && completeItem.startDate;

                    if (!isCompleted && hasScheduledDate) {
                        activeSetupEquips.push({ site, equip });

                        // 통계 집계
                        siteStats[site] = (siteStats[site] || 0) + 1;
                        const equipName = equip.split('::')[0];
                        equipCounts[equipName] = (equipCounts[equipName] || 0) + 1;
                    }
                }
            });
        }
    });

    const totalActive = activeSetupEquips.length;
    const siteStatsArr = Object.keys(siteStats).map(key => ({ name: key, count: siteStats[key] }));
    const equipStatsArr = Object.keys(equipCounts).map(key => ({ name: key, count: equipCounts[key] }));

    renderSetupSiteStatus(siteStatsArr, totalActive, activeSetupEquips);
    renderSetupEquipChart(equipStatsArr, totalActive, activeSetupEquips);
    renderSetupEquipDetailList(activeSetupEquips);
    renderSetupUpcomingList(activeSetupEquips);
    renderGanttChart();
}

function renderSetupSiteStatus(siteStats, totalEquip, activeEquips) {
    const chartEl = document.getElementById('setup-site-status-chart');
    const listEl = document.getElementById('setup-site-status-list');
    const centerText = document.getElementById('setup-site-chart-center');

    if (!chartEl || !listEl) return;
    listEl.innerHTML = '';

    if (totalEquip === 0) {
        chartEl.style.background = '';
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Site</div><div class="chart-center-value">0</div>`;
        listEl.innerHTML = '<li class="list-empty-msg">진행 중인 셋업 없음</li>';
        return;
    }

    const colors = ['#1f6feb', '#238636', '#d29922', '#8957e5', '#da3633', '#f0883e', '#3fb950', '#a371f7'];
    let gradientStr = '';
    let currentDeg = 0;
    siteStats.sort((a, b) => b.count - a.count);

    // 전체
    const allLi = document.createElement('li');
    allLi.className = 'status-list-item';
    if (!setupDashboardFilter.site) allLi.classList.add('active');
    allLi.innerHTML = `<span class="status-color status-color-all"></span><span class="status-name">전체</span><span class="status-count">${totalEquip}</span>`;
    allLi.onclick = () => {
        setupDashboardFilter.site = '';
        setupDashboardFilter.equip = '';
        currentGanttFilters = { site: '', equip: '' }; // 간트 차트 숨김
        currentSearchFilters = { site: '', equip: '' };
        renderCalendar();
        updateSetupDashboard();
    };
    listEl.appendChild(allLi);

    siteStats.forEach((site, index) => {
        const color = colors[index % colors.length];
        const deg = (site.count / totalEquip) * 360;
        gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
        currentDeg += deg;

        const li = document.createElement('li');
        li.className = 'status-list-item';
        if (setupDashboardFilter.site === site.name) li.classList.add('active');
        li.innerHTML = `<span class="status-color" style="background-color: ${color};"></span><span class="status-name">${escapeHtml(site.name)}</span><span class="status-count">${site.count}</span>`;
        li.onclick = () => {
            setupDashboardFilter.site = (setupDashboardFilter.site === site.name) ? '' : site.name;
            setupDashboardFilter.equip = '';
            currentGanttFilters = { site: '', equip: '' }; // 간트 차트 숨김
            updateSetupDashboard();
        };
        listEl.appendChild(li);
    });

    chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
    if (centerText) centerText.innerHTML = `<div class="chart-center-label">Site</div><div class="chart-center-value">${siteStats.length}</div>`;
}

function renderSetupEquipChart(equipStats, totalEquip, activeEquips) {
    const chartEl = document.getElementById('setup-equip-status-chart');
    const listEl = document.getElementById('setup-equip-status-list');
    const centerText = document.getElementById('setup-equip-chart-center');

    if (!chartEl || !listEl) return;
    listEl.innerHTML = '';

    // 필터링된 데이터 기준 재집계
    let filteredEquips = activeEquips;
    if (setupDashboardFilter.site) {
        filteredEquips = activeEquips.filter(e => e.site === setupDashboardFilter.site);
    }

    let filteredStats = {};
    filteredEquips.forEach(e => {
        const name = e.equip.split('::')[0];
        filteredStats[name] = (filteredStats[name] || 0) + 1;
    });

    const statsArr = Object.keys(filteredStats).map(key => ({ name: key, count: filteredStats[key] }));
    const filteredTotal = filteredEquips.length;

    if (filteredTotal === 0) {
        chartEl.style.background = '';
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Equip</div><div class="chart-center-value">0</div>`;
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    const colors = ['#a371f7', '#f0883e', '#3fb950', '#da3633', '#8957e5', '#d29922', '#238636', '#1f6feb'];
    let gradientStr = '';
    let currentDeg = 0;
    statsArr.sort((a, b) => b.count - a.count);

    // 전체
    const allLi = document.createElement('li');
    allLi.className = 'status-list-item';
    if (!setupDashboardFilter.equip) allLi.classList.add('active');
    allLi.innerHTML = `<span class="status-color status-color-all"></span><span class="status-name">전체</span><span class="status-count">${filteredTotal}</span>`;
    allLi.onclick = () => {
        setupDashboardFilter.equip = '';
        currentGanttFilters = { site: '', equip: '' }; // 간트 차트 숨김
        currentSearchFilters = { site: '', equip: '' };
        renderCalendar();
        updateSetupDashboard();
    };
    listEl.appendChild(allLi);

    statsArr.forEach((equip, index) => {
        const color = colors[index % colors.length];
        const deg = (equip.count / filteredTotal) * 360;
        gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
        currentDeg += deg;

        const li = document.createElement('li');
        li.className = 'status-list-item';
        if (setupDashboardFilter.equip === equip.name) li.classList.add('active');
        li.innerHTML = `<span class="status-color" style="background-color: ${color};"></span><span class="status-name">${escapeHtml(equip.name)}</span><span class="status-count">${equip.count}</span>`;
        li.onclick = () => {
            setupDashboardFilter.equip = (setupDashboardFilter.equip === equip.name) ? '' : equip.name;
            currentGanttFilters = { site: '', equip: '' }; // 간트 차트 숨김
            updateSetupDashboard();
        };
        listEl.appendChild(li);
    });

    chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
    if (centerText) centerText.innerHTML = `<div class="chart-center-label">Equip</div><div class="chart-center-value">${filteredTotal}</div>`;
}

function renderSetupEquipDetailList(activeEquips) {
    const listEl = document.getElementById('setup-equip-detail-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    let filtered = activeEquips;
    if (setupDashboardFilter.site) filtered = filtered.filter(e => e.site === setupDashboardFilter.site);
    if (setupDashboardFilter.equip) filtered = filtered.filter(e => e.equip.split('::')[0] === setupDashboardFilter.equip);

    if (filtered.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    filtered.forEach(item => {
        const parts = item.equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';

        const li = document.createElement('li');
        li.className = 'status-list-item';
        li.innerHTML = `<span class="status-name" style="margin-right:0;">${escapeHtml(item.site)} > ${escapeHtml(name)} ${serial ? `(${escapeHtml(serial)})` : ''}</span>`;
        // [수정] 클릭 시 간트 차트 필터 적용 및 표시
        li.onclick = () => {
            currentGanttFilters.site = item.site;
            currentGanttFilters.equip = item.equip; // [수정] 전체 장비명(Serial 포함)으로 필터링
            updateSetupDashboard();

            currentSearchFilters.site = item.site;
            currentSearchFilters.equip = item.equip;
            renderCalendar();
        };
        listEl.appendChild(li);
    });
}

function renderSetupUpcomingList(activeEquips) {
    const listEl = document.getElementById('setup-upcoming-list');
    const container = document.getElementById('setup-upcoming-container');
    if (!listEl || !container) return;
    listEl.innerHTML = '';

    let upcomingItems = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    activeEquips.forEach(eq => {
        // 필터 적용
        if (setupDashboardFilter.site && eq.site !== setupDashboardFilter.site) return;
        if (setupDashboardFilter.equip && eq.equip.split('::')[0] !== setupDashboardFilter.equip) return;
        if (currentGanttFilters.equip && eq.equip !== currentGanttFilters.equip) return;

        const data = setupData[`${eq.site}::${eq.equip}`];

        if (data && data.setupDetails) {
            // [수정] 체크 안 된 모든 작업 표시
            const uncheckedTasks = data.setupDetails.filter(t => !t.completed);

            uncheckedTasks.forEach(task => {
                if (task.startDate) {

                    // [수정] 간트 차트 필터가 적용되어 있다면 해당 장비만 표시
                    if (currentGanttFilters.site && currentGanttFilters.equip) {
                        if (eq.site !== currentGanttFilters.site || eq.equip !== currentGanttFilters.equip) return;
                    }

                    const start = new Date(task.startDate);
                    start.setHours(0, 0, 0, 0);
                    const diffTime = start - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    upcomingItems.push({
                        diffDays: diffDays,
                        site: eq.site,
                        equip: eq.equip,
                        task: task
                    });
                }
            });
        }
    });

    upcomingItems.sort((a, b) => a.diffDays - b.diffDays);

    if (upcomingItems.length === 0) {
        listEl.innerHTML = '<div class="upcoming-empty-msg">예정된 작업이 없습니다.</div>';
        return;
    }

    const template = document.getElementById('setup-upcoming-item-template');

    upcomingItems.forEach(item => {
        const parts = item.equip.split('::');
        const name = parts[0];

        let badgeClass = 'safe';
        let dateText = item.task.startDate; // [수정] 날짜 표시
        if (item.diffDays < 0) {
            badgeClass = 'danger';
        } else if (item.diffDays === 0) {
            badgeClass = 'warning';
        } else if (item.diffDays <= 3) {
            badgeClass = 'warning';
        }

        const clone = template.content.cloneNode(true);
        const div = clone.querySelector('.upcoming-item');
        div.onclick = () => {
            location.href = `setup.html?site=${encodeURIComponent(item.site)}&equip=${encodeURIComponent(item.equip)}`;
        };

        clone.querySelector('.upcoming-info-site').textContent = `${item.site} > ${name}`; // textContent는 안전
        clone.querySelector('.upcoming-info-content').textContent = item.task.content;

        const badge = clone.querySelector('.d-day-badge');
        badge.className = `d-day-badge ${badgeClass}`;
        badge.style.width = 'auto';
        badge.style.padding = '2px 8px';
        badge.textContent = dateText;

        listEl.appendChild(clone);
    });
}

/* ==========================================================================
   4. 캘린더 시스템 (Calendar System)
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
    // [추가] 검색 및 필터 정보 표시 (제목 아래)
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
    // CSS 스타일이 우선 적용되도록 인라인 스타일 초기화
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

            // [수정] 그룹화 로직: 같은 장비, 같은 완료 상태끼리 묶어서 하나로 표시
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
        const holidayName = getHolidayName(year, month, i);
        let dayClass = '';

        if (holidayName || dayOfWeek === 0) dayClass = 'sunday holiday'; // 일요일 또는 공휴일 -> 빨강
        else if (dayOfWeek === 6) dayClass = 'saturday'; // 토요일 -> 파랑

        // 날짜 숫자 표시 (공휴일이면 이름도 작게 표시)
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
    const nextDays = 42 - (firstDay + lastDate); // 6 rows * 7 days
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
        // 그룹화 로직: 같은 장비, 같은 완료 상태끼리 묶음
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
        // 완료된 항목을 리스트 아래로 정렬
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
                        // 그룹 내 모든 아이템 삭제
                        group.items.forEach(item => {
                            setScheduleDate(item.site, item.equip, item.id, '', true);
                        });
                        popup.style.display = 'none';
                    }
                };
                li.appendChild(delBtn);
            }

            li.onclick = () => {
                // 대표 아이템(첫 번째)의 ID를 넘기지만, 내부에서 같은 날짜/장비 항목을 모두 찾음
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

                    // 완료된 작업(로그) 추가
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
   5. 간트 차트 시스템 (Gantt Chart System)
   ========================================================================== */
function setupGanttSearch() {
    const searchInput = document.getElementById('gantt-search');
    const filterBtn = document.getElementById('btn-gantt-filter');

    if (searchInput) {
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.addEventListener('input', () => {
            renderGanttChart();
        });
    }
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
    const resizer = document.querySelector('.gantt-resizer');
    const sidebar = document.querySelector('.gantt-sidebar');
    if (!resizer || !sidebar) return;
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault(); document.body.style.cursor = 'col-resize'; resizer.classList.add('resizing');
        const onMouseMove = (ev) => {
            const w = ev.clientX - sidebar.getBoundingClientRect().left;
            if (w > GANTT_SIDEBAR_MIN_WIDTH && w < GANTT_SIDEBAR_MAX_WIDTH) {
                ganttSidebarWidth = w;
                sidebar.style.width = `${w}px`;
                renderGanttChart(); // 너비 변경 시 차트 재렌더링 (비율 자동 조정)
            }
        };
        const onMouseUp = () => { document.body.style.cursor = 'default'; resizer.classList.remove('resizing'); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
        document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
    });
}

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

    const searchInput = document.getElementById('gantt-search');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    // [추가] 선택된 장비 정보 표시
    if (targetInfoEl) {
        let infoText = '';
        if (currentGanttFilters.site && currentGanttFilters.equip) {
            const parts = currentGanttFilters.equip.split('::');
            const name = parts[0];
            const serial = parts.length > 1 ? parts[1] : '';
            infoText = `${currentGanttFilters.site} > ${name} ${serial ? `(${serial})` : ''}`;

            // [추가] 진행률 계산 (완료된 항목 수 / 전체 항목 수)
            const data = setupData[`${currentGanttFilters.site}::${currentGanttFilters.equip}`];
            if (data && data.setupDetails && data.setupDetails.length > 0) {
                const total = data.setupDetails.length;
                const completed = data.setupDetails.filter(t => t.completed).length;
                const percent = Math.round((completed / total) * 100);
                infoText += `   [진행률: ${percent}%]`;
            }
        }
        if (keyword) {
            const searchText = searchInput ? searchInput.value : '';
            if (infoText) infoText += ` (검색: ${searchText})`;
            else infoText = `검색: "${searchText}"`;
        }
        targetInfoEl.textContent = infoText;
    }

    // [수정] 검색어가 있거나 장비 필터가 적용된 경우에만 데이터 표시 (사업장만 선택시 미표시)
    const hasActiveFilter = keyword || currentGanttFilters.equip;
    if (!hasActiveFilter) {
        if (wrapper) wrapper.style.display = 'none';
        if (emptyMsg) {
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = '장비를 검색하면 셋업 일정이 표시됩니다.';
        }
        return;
    }

    // Aggregate all setup tasks from all equipment
    let allTasks = [];
    const mainData = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};

    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            mainData[site].forEach(equip => {
                const data = setupData[`${site}::${equip}`];

                if (data && data.setupDetails) {
                    data.setupDetails.forEach(task => {
                        if (!task.startDate) return; // 시작일이 없으면 건너뜀

                        const parts = equip.split('::');
                        const equipName = parts[0];
                        const serialNo = parts.length > 1 ? parts[1] : '';
                        const displayName = task.content;

                        // Filter Logic
                        const matchKeyword = !keyword || (
                            (site.toLowerCase().includes(keyword)) ||
                            (equip.toLowerCase().includes(keyword)) ||
                            (task.content.toLowerCase().includes(keyword))
                        );

                        const matchSite = !currentGanttFilters.site || site === currentGanttFilters.site;
                        // [수정] 장비명(모델) 일치 여부 확인 (Serial No 포함된 경우 대응)
                        const matchEquip = !currentGanttFilters.equip || equip === currentGanttFilters.equip || equipName === currentGanttFilters.equip;

                        if (matchKeyword && matchSite && matchEquip) {
                            let estDays = parseInt(task.estDays) || 0;
                            // [수정] 셋업 완료는 작업일수 1일로 계산하여 표시
                            if (task.content === '셋업 완료' || task.category === '셋업 완료') {
                                estDays = 1;
                            }
                            const pStart = new Date(task.startDate);
                            const daysToAdd = estDays > 0 ? estDays - 1 : 0;
                            const pEnd = addBusinessDays(pStart, daysToAdd); // [수정] 영업일 기준 종료일 계산

                            let execStart = null;
                            let execEnd = null;
                            let statusClass = ''; // [추가] 상태별 클래스

                            // [수정] 실행 데이터가 있으면 표시 (완료 여부 무관, 진행중 포함)
                            if (task.date || task.execStartDate) {
                                execStart = task.execStartDate || task.startDate; // [수정] execStartDate 우선 사용
                                execEnd = task.date || execStart; // 완료일 없으면 시작일만 표시

                                // [추가] 시작일이 미래인 경우 종료일 보정 (바 표시 보장)
                                if (execEnd < execStart) execEnd = execStart;

                                // 지연 여부 확인
                                const planEndDate = new Date(pEnd);
                                const actualEndDate = new Date(execEnd);
                                // 시간 초기화
                                planEndDate.setHours(0, 0, 0, 0);
                                actualEndDate.setHours(0, 0, 0, 0);

                                if (actualEndDate > planEndDate) {
                                    statusClass = 'exec-delayed'; // 지연됨 (주황)
                                } else if (!task.completed) {
                                    statusClass = 'exec-progress'; // 진행중 (노랑)
                                } else {
                                    statusClass = 'exec'; // 완료됨 (녹색)
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
                                statusClass: statusClass, // [추가]
                                completed: task.completed // [추가] 완료 여부 전달
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

    // Sort tasks by start date
    allTasks.sort((a, b) => new Date(a.planStart || a.start) - new Date(b.planStart || b.start));

    // Calculate Date Range
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

    // [수정] 시작일 여유분 (주말 제외 로직이므로 일요일 강제 시작 불필요, 다만 여유있게)
    minDate.setDate(minDate.getDate() - GANTT_PADDING_START);

    // [수정] 셋업 완료(마지막 작업)를 기준으로 종료일 설정 (강제 2개월 확장 제거)
    maxDate.setDate(maxDate.getDate() + GANTT_PADDING_END + (ganttExtraWeeks * 7));

    // [추가] 유효 날짜(평일) 생성 및 매핑
    ganttValidDates = []; // 전역 변수 초기화
    const dateMap = new Map(); // 'YYYY-MM-DD' -> index
    let tempDate = new Date(minDate);
    let colIndex = 0;

    while (tempDate <= maxDate) {
        const day = tempDate.getDay();
        if (day !== 0 && day !== 6) { // 토(6), 일(0) 제외
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

    // [수정] 전체 기간이 화면에 꽉 차게 너비 조절
    const container = document.getElementById('gantt-timeline-container');
    if (container && container.clientWidth > 0 && ganttValidDates.length > 0) {
        ganttDayWidth = container.clientWidth / ganttValidDates.length;
    } else {
        ganttDayWidth = 20;
    }
    const totalWidth = ganttValidDates.length * ganttDayWidth;

    // Render Task List
    if (taskList) {
        const shownButtonEquips = new Set(); // [추가] 장비별 실행 버튼 표시 여부 추적
        const template = document.getElementById('gantt-task-template');
        taskList.innerHTML = '';

        allTasks.forEach((t, index) => {
            // [추가] 이전 작업 완료 여부 확인 (버튼 활성화 조건)
            let isBtnDisabled = false;
            // 현재 리스트(날짜순 정렬됨)에서 같은 장비의 바로 이전 작업 찾기
            for (let k = index - 1; k >= 0; k--) {
                if (allTasks[k].site === t.site && allTasks[k].equip === t.equip) {
                    if (!allTasks[k].completed) isBtnDisabled = true;
                    break; // 바로 앞 작업만 확인
                }
            }

            const clone = template.content.cloneNode(true);
            const taskDiv = clone.querySelector('.gantt-task-name');
            taskDiv.dataset.id = t.id;
            taskDiv.dataset.site = t.site;
            taskDiv.dataset.equip = t.equip;
            // [추가] 더블 클릭 시 수정 모달 열기
            taskDiv.ondblclick = () => openDateEditModal(t.site, t.equip, t.id, 'plan');

            const label = clone.querySelector('.gantt-task-label-text');
            label.title = `${t.site} > ${t.equip}`;
            label.textContent = t.displayName;

            // [수정] 바로 다음 작업(미실행 중 첫 번째)에만 버튼 표시
            const btnAdd = clone.querySelector('.btn-add-exec');
            if (!t.execEnd) {
                const equipKey = `${t.site}::${t.equip}`;
                if (!shownButtonEquips.has(equipKey)) {
                    if (isBtnDisabled) {
                        btnAdd.disabled = true;
                        btnAdd.style.opacity = '0.3';
                        btnAdd.style.cursor = 'not-allowed';
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

            // [추가] 진행률 계산 및 표시
            const progressSpan = clone.querySelector('.gantt-task-progress-text');
            if (t.execStart && t.execEnd) {
                let pct = 0;
                if (t.completed) {
                    pct = 100;
                } else {
                    const estDays = parseInt(t.estDays) || 1;
                    if (estDays === 1) {
                        pct = 0;
                    } else {
                        // 영업일 기준 실행 기간 계산
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
                        if (pct > 99) pct = 99; // 미완료 시 최대 99%
                    }
                }

                let color = '#e3b341'; // 1~99% (노랑)
                if (pct === 0) color = '#8b949e'; // 0% (회색)
                else if (pct === 100) color = '#3fb950'; // 100% (초록)

                progressSpan.textContent = `${pct}%`;
                progressSpan.style.color = color;
            } else {
                progressSpan.remove();
            }

            const btnDel = clone.querySelector('.btn-del-sm');
            if (t.completed) {
                btnDel.disabled = true;
                btnDel.style.opacity = '0.3';
                btnDel.style.cursor = 'not-allowed';
                btnDel.title = '완료된 작업은 삭제할 수 없습니다.';
            } else {
                btnDel.onclick = () => deleteSetupTask(t.site, t.equip, t.id);
            }

            taskList.appendChild(clone);
        });
    }

    if (timeline) timeline.style.width = `${totalWidth}px`;

    // Year/Month Header
    let monthHtml = '';
    let currentYm = '';
    let span = 0;

    ganttValidDates.forEach((dObj, i) => {
        const d = dObj.date;
        const ym = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (ym !== currentYm) {
            if (currentYm !== '') monthHtml += `<div class="gantt-date-cell gantt-header-month-cell" style="width: ${span * ganttDayWidth}px;">${currentYm}</div>`;
            currentYm = ym; span = 1;
        } else span++;
    });
    if (span > 0) monthHtml += `<div class="gantt-date-cell gantt-header-month-cell" style="width: ${span * ganttDayWidth}px;">${currentYm}</div>`;
    if (headerMonths) headerMonths.innerHTML = monthHtml;

    // Day Header (Previously Week Header)
    let dayHtml = '';
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    ganttValidDates.forEach((dObj, i) => {
        let cellClass = 'gantt-date-cell gantt-header-day-cell';
        let content = dObj.date.getDate();

        if (dObj.holiday) {
            cellClass += ' gantt-day-holiday-bg';
            // content += `(${dObj.holiday})`; // 공간 부족 시 숫자만 표시하거나 툴팁 활용
        }
        if (dObj.str === todayStr) {
            cellClass += ' gantt-day-today-bg';
        }

        dayHtml += `<div class="${cellClass}" style="width: ${ganttDayWidth}px;" title="${dObj.str} ${dObj.holiday || ''}">${content}</div>`;
    });
    if (headerWeeks) headerWeeks.innerHTML = dayHtml;

    // [수정] Grid Lines & Backgrounds (레이어 순서 제어)
    let bgHtml = '';
    let linesHtml = '';
    let boldLinesHtml = '';

    ganttValidDates.forEach((dObj, i) => {
        const left = i * ganttDayWidth;

        // 1. 공휴일 배경 (가장 아래)
        if (dObj.holiday) {
            bgHtml += `<div class="gantt-grid-bg-holiday" style="left: ${left}px; width: ${ganttDayWidth}px;" title="${dObj.holiday}"></div>`;
        }
        
        // [추가] 오늘 날짜 배경
        if (dObj.str === todayStr) {
            bgHtml += `<div class="gantt-grid-bg-today" style="left: ${left}px; width: ${ganttDayWidth}px;"></div>`;
        }

        // 2. 기본 그리드 라인 (모든 날짜 좌측)
        linesHtml += `<div class="gantt-grid-line-std" style="left: ${left}px;"></div>`;

        // 3. 금요일 굵은 라인 (우측, 기본 라인 위에 표시)
        if (dObj.date.getDay() === 5) {
            const right = (i + 1) * ganttDayWidth;
            boldLinesHtml += `<div class="gantt-grid-line-bold" style="left: ${right - 1}px;"></div>`;
        }
    });

    // 순서대로 결합 (배경 -> 기본 라인 -> 굵은 라인)
    const gridLinesHtml = bgHtml + linesHtml + boldLinesHtml;

    // Bars
    let bodyHtml = '';

    // Helper to find index
    const getIndex = (dateStr, isEnd) => {
        if (dateMap.has(dateStr)) return dateMap.get(dateStr);
        // 범위 밖이거나 주말인 경우 근사치 찾기
        const target = new Date(dateStr);
        if (isEnd) {
            for (let i = ganttValidDates.length - 1; i >= 0; i--) if (ganttValidDates[i].date <= target) return i;
            return -1;
        } else {
            for (let i = 0; i < ganttValidDates.length; i++) if (ganttValidDates[i].date >= target) return i;
            return ganttValidDates.length;
        }
    };

    // [추가] 공휴일 제외 바 조각 생성 헬퍼
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
                    html += `<div class="gantt-bar-segment" style="left: ${l}px; width: ${w}px;"></div>`;
                    segStart = -1;
                }
            }
        }
        if (segStart !== -1) {
            const l = (segStart - startIndex) * ganttDayWidth;
            const w = (endIndex - segStart + 1) * ganttDayWidth;
            html += `<div class="gantt-bar-segment" style="left: ${l}px; width: ${w}px;"></div>`;
        }
        return html;
    };

    allTasks.forEach(t => {
        const pStart = new Date(t.planStart || t.start);
        const pEnd = new Date(t.planEnd || t.end);

        let pStartIndex = getIndex(t.planStart, false);
        let pEndIndex = getIndex(t.planEnd, true);

        // [수정] 주말/공휴일로 인해 숨겨지는 경우 보정 (최소 1칸 확보)
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

        // [수정] 주말/공휴일로 인해 숨겨지는 경우 보정 (최소 1칸 확보)
        if (eEndIndex < eStartIndex && eStart <= eEnd) {
            if (eStartIndex < ganttValidDates.length) eEndIndex = eStartIndex;
            else if (eEndIndex >= 0) eStartIndex = eEndIndex;
        }

        const eLeft = eStartIndex * ganttDayWidth;
        const eWidth = (eEndIndex - eStartIndex + 1) * ganttDayWidth;

        const pSegments = createSegments(pStartIndex, pEndIndex);
        const eSegments = createSegments(eStartIndex, eEndIndex);

        const resizeHandles = t.completed ? '' : '<div class="resize-handle left"></div><div class="resize-handle right"></div>';

        bodyHtml += `
            <div class="gantt-row">
                <div class="gantt-bar plan" style="left: ${pLeft}px; width: ${pWidth}px;" title="계획: ${t.planStart} ~ ${t.planEnd}" data-id="${t.id}" data-type="plan" data-site="${t.site}" data-equip="${t.equip}">${pSegments}</div>
                ${t.execStart ? `<div class="gantt-bar ${t.statusClass}" style="left: ${eLeft}px; width: ${eWidth}px;" title="실행: ${t.execStart} ~ ${t.execEnd}" data-id="${t.id}" data-type="exec" data-site="${t.site}" data-equip="${t.equip}" data-completed="${t.completed}">${eSegments}${resizeHandles}</div>` : ''}
            </div>`;
    });

    if (ganttBody) ganttBody.innerHTML = gridLinesHtml + bodyHtml;

    setupGanttBarDrag();
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

let isDraggingBar = false;
let dragMode = null;
let dragStartX = 0;
let dragBarEl = null;
let dragBarInitialLeft = 0;
let dragBarInitialWidth = 0;
let hasMoved = false;

function setupGanttBarDrag() {
    const bars = document.querySelectorAll('.gantt-bar');
    bars.forEach(bar => {
        bar.addEventListener('mousedown', (e) => {
            // [추가] 계획 바는 드래그 수정 방지
            if (bar.dataset.type === 'plan') return;

            e.stopPropagation();
            isDraggingBar = true;
            dragStartX = e.clientX;
            dragBarEl = bar;
            dragBarInitialLeft = parseFloat(bar.style.left);
            dragBarInitialWidth = parseFloat(bar.style.width);
            hasMoved = false;
            isHoveringHoliday = false; // 초기화

            // [추가] 완료된 작업은 드래그/리사이즈 불가 (클릭은 허용)
            if (bar.dataset.completed === 'true') {
                dragMode = 'locked';
                return;
            }

            if (e.target.classList.contains('resize-handle')) {
                dragMode = e.target.classList.contains('left') ? 'resize-left' : 'resize-right';
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
    if (dragMode === 'locked') return; // [추가] 완료된 작업 이동 방지
    const deltaX = e.clientX - dragStartX;
    if (Math.abs(deltaX) > 2) hasMoved = true;

    // [추가] 실행 바 드래그 시 공휴일 영역 체크
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
            return; // 공휴일이면 업데이트 중단 (시각적 제한)
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

        // [추가] 공휴일 영역에서 드롭 시 원복 (기존 상태 유지)
        if (dragBarEl.dataset.type === 'exec' && isHoveringHoliday) {
            dragBarEl.style.left = `${dragBarInitialLeft}px`;
            dragBarEl.style.width = `${dragBarInitialWidth}px`;
            isDraggingBar = false;
            dragBarEl = null;
            dragMode = null;
            return;
        } else if (!hasMoved && dragBarEl.dataset.type === 'exec') {
            openExecCompletionModal(dragBarEl.dataset.site, dragBarEl.dataset.equip, dragBarEl.dataset.id);
            // 클릭 시 위치/크기 원복
            if (dragMode === 'move') dragBarEl.style.left = `${dragBarInitialLeft}px`;
            else { dragBarEl.style.width = `${dragBarInitialWidth}px`; dragBarEl.style.left = `${dragBarInitialLeft}px`; }
        } else {
            // [수정] 드래그/리사이즈 종료 시 시각적 위치를 기반으로 날짜 확정 (공휴일 제외 계산 방지)
            const currentLeft = parseFloat(dragBarEl.style.left);
            const currentWidth = parseFloat(dragBarEl.style.width);

            let startIdx = Math.round(currentLeft / ganttDayWidth);
            let endIdx = Math.round((currentLeft + currentWidth) / ganttDayWidth) - 1;

            // 인덱스 유효성 검사 및 보정
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
                renderGanttChart(); // 복구
            }
        }
        isDraggingBar = false; dragBarEl = null; dragMode = null;
    }
});

function updateTaskDate(site, equip, id, type, change, mode = 'move') {
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    let data = setupData[equipKey] || {};
    const task = data.setupDetails ? data.setupDetails.find(t => t.id == id) : null;
    if (task) {
        const addDays = (dStr, days) => { return addBusinessDays(new Date(dStr), days).toISOString().split('T')[0]; };

        // 셋업 세부사항은 Plan(계획) 수정만 지원 (실행은 완료 체크로 관리)
        if (mode === 'manual') {
            task.startDate = change.start;
            // 종료일 기반 예상일수 재계산
            const s = new Date(change.start);
            const e = new Date(change.end);
            // [수정] 영업일 기준 일수 계산 (단순 차이가 아님)
            let days = 0;
            let temp = new Date(s);
            while (temp < e) {
                temp = addBusinessDays(temp, 1);
                days++;
            }
            task.estDays = (days + 1).toString();
        }
        else if (mode === 'visual-update') {
            // [추가] 시각적 위치 기반 업데이트 (드래그/리사이즈 공통)
            // 화면에 보이는 위치 그대로 날짜를 저장하므로, 공휴일 점프 등의 추가 계산이 필요 없음
            if (type === 'exec') {
                if (change.newStart) task.execStartDate = change.newStart;
                if (change.newEnd) task.date = change.newEnd;
            } else if (type === 'plan') {
                if (change.newStart) task.startDate = change.newStart;
                if (change.newStart && change.newEnd) {
                    // 기간 변경에 따른 작업일수(estDays) 재계산
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

function setupGanttSearch() {
    const searchInput = document.getElementById('gantt-search');
    const filterBtn = document.getElementById('btn-gantt-filter');

    if (searchInput) {
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.addEventListener('input', () => {
            renderGanttChart();
        });
    }
    if (filterBtn) {
        filterBtn.onclick = () => openGanttSearchModal();
    }
}

function setupGanttResizer() {
    const resizer = document.querySelector('.gantt-resizer');
    const sidebar = document.querySelector('.gantt-sidebar');
    if (!resizer || !sidebar) return;
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault(); document.body.style.cursor = 'col-resize'; resizer.classList.add('resizing');
        const onMouseMove = (ev) => {
            const w = ev.clientX - sidebar.getBoundingClientRect().left;
            if (w > GANTT_SIDEBAR_MIN_WIDTH && w < GANTT_SIDEBAR_MAX_WIDTH) {
                ganttSidebarWidth = w;
                sidebar.style.width = `${w}px`;
                renderGanttChart(); // 너비 변경 시 차트 재렌더링 (비율 자동 조정)
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
            const deltaX = startX - ev.clientX; // 왼쪽으로 드래그하면 너비 증가
            const newWidth = startWidth + deltaX;
            if (newWidth > 200 && newWidth < 800) {
                group.style.flex = 'none'; // flex 자동 조절 해제
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
   11. 모달 로직 (Modals)
   ========================================================================== */

function openDateEditModal(site, equip, id, type) {
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const data = setupData[`${site}::${equip}`] || {};
    const task = data.setupDetails ? data.setupDetails.find(t => t.id == id) : null;
    if (!task) return;

    document.getElementById('edit-task-id').value = id;
    document.getElementById('edit-task-type').value = 'plan'; // 항상 계획 수정으로 처리
    document.getElementById('edit-task-site').value = site;
    document.getElementById('edit-task-equip').value = equip;

    document.getElementById('edit-start-date').value = task.startDate;
    let s = new Date(task.startDate);
    const est = parseInt(task.estDays) || 0;
    const daysToAdd = est > 0 ? est - 1 : 0;
    s = addBusinessDays(s, daysToAdd); // [수정] 영업일 기준
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
   12. 실행 시작일 설정 모달 (Execution Start Modal for Home)
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
    // 기본값: 오늘
    let defaultDate = new Date().toISOString().split('T')[0];

    // [추가] 이전 작업 완료일 다음날 계산
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
        updateSetupDashboard(); // [수정] 대시보드 갱신 (Gantt 포함)
    }
    document.getElementById('setup-exec-start-modal').style.display = 'none';
    currentExecStartTargetId = null;
}

function addExecutionBar(site, equip, id) {
    openSetupExecStartModal(site, equip, id);
}

/* ==========================================================================
   13. 실행 완료 등록 모달 (Execution Completion Modal for Home)
   ========================================================================== */
function openExecCompletionModal(site, equip, id) {
    const modal = document.getElementById('exec-completion-modal');
    if (!modal) return;

    // 전역 변수 대신 DOM 요소에 데이터 저장
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
        
        // [수정] 완료일 자동 계산 (기존 완료일이 없으면 시작일 + 작업일수)
        // 타임존 이슈 방지를 위해 로컬 날짜 처리
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

        // [추가] 계획 종료일 계산 및 저장 (지연 판단 기준: 계획 시작일 + 작업일수)
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
        
        // 지연 사유 표시 여부 체크 (초기 로드 시)
        checkExecDelayStatus();

        // [추가] 셋업 이력 입력창 초기화
        const logInput = document.getElementById('exec-setup-log-content');
        if (logInput) logInput.value = '';
        
        const companyInput = document.getElementById('exec-setup-log-company');
        if (companyInput) companyInput.value = '위드텍'; // 기본값

        const workerInput = document.getElementById('exec-setup-log-worker');
        if (workerInput) workerInput.value = sessionStorage.getItem('userId') || ''; // 기본값

        // [추가] 시작일 변경 시 완료일 재계산 이벤트 연결
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

        // [추가] 이미 완료된 작업인 경우 UI 제어 (이력 숨김 및 수정 방지)
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
    const planEndDateInput = document.getElementById('exec-plan-end-date'); // [수정] 계획 종료일 기준
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

// [추가] 날짜 변경 시 지연 사유 체크 이벤트 연결
document.addEventListener('DOMContentLoaded', () => {
    const execEndDate = document.getElementById('exec-end-date');
    if (execEndDate) {
        execEndDate.addEventListener('change', checkExecDelayStatus);
    }
});

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
            const wasCompleted = task.completed; // [추가] 기존 완료 상태 확인
            // [수정] 완료 상태 해제 시 리셋 로직 (이후 작업 초기화 및 실행 버튼 활성화)
            if (task.completed && !isCompleted) {
                if (!confirm("완료 상태를 해제하시겠습니까?\n이후 단계의 완료 상태도 함께 초기화됩니다.")) {
                    return;
                }
                
                // 현재 작업 리셋 (실행 시작일 제거 -> 실행 버튼 활성화)
                task.execStartDate = '';
                task.date = '';
                task.completed = false;
                task.delayReason = '';

                // 이후 작업 리셋
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

            // [추가] 셋업 이력(일지) 자동 등록
            // 완료 체크 시 혹은 내용이 있을 때 저장 (단, 이미 완료된 작업은 중복 저장 방지)
            if ((isCompleted && !wasCompleted) || (logContent && !wasCompleted)) {
                if (!data.setupLogs) data.setupLogs = [];

                let displayContent = task.content || '작업 내용 없음';
                let finalMemo = logContent;

                // [수정] 지연 사유가 있으면 셋업 일지에 표시
                if (delayReason) {
                    displayContent = `[지연] ${displayContent}`;
                    if (finalMemo) finalMemo += `\n\n[지연 사유]\n${delayReason}`;
                    else finalMemo = `[지연 사유]\n${delayReason}`;
                }

                data.setupLogs.push({
                    id: Date.now(),
                    date: isCompleted ? endDate : new Date().toISOString().split('T')[0],
                    worker: logWorker || sessionStorage.getItem('userId') || '',
                    content: displayContent, // 리스트 내용은 셋업 항목명 (지연 시 [지연] 추가)
                    company: logCompany || '위드텍',
                    memo: finalMemo // 팝업 입력 내용은 상세 메모로 저장 (지연 사유 포함)
                });
            }
            
            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));
            
            renderGanttChart();
            updateSetupDashboard(); // 대시보드 갱신
        }
    }

    document.getElementById('exec-completion-modal').style.display = 'none';
}

// 전역 스코프에 노출 (HTML onclick 속성에서 호출 가능하도록)
window.saveExecCompletion = saveExecCompletion;
window.openExecCompletionModal = openExecCompletionModal;
window.saveSetupExecStart = saveSetupExecStart;
