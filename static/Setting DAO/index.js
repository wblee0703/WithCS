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
let isFirstLoad = true;

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
   5. 모달 로직 (Modals)
   ========================================================================== */

// 5.1 작업 예정일 설정 모달 (Upcoming List에서 호출)
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
                updateMaintenanceDashboard(); // 대시보드 갱신
                renderCalendar(); // 캘린더 갱신
            }
        };
    }

    if (delBtn) {
        delBtn.onclick = () => {
            if (currentScheduleTarget && confirm('일정을 삭제하시겠습니까?')) {
                setScheduleDate(currentScheduleTarget.site, currentScheduleTarget.equip, currentScheduleTarget.id, '', true);
                modal.style.display = 'none';
                updateMaintenanceDashboard();
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
    
    // 기존 예정일이 있으면 표시
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
            
            // 시스템 로그
            if (typeof addSystemLog === 'function') {
                const action = isDelete ? 'DELETE_SCHEDULE' : 'ADD_SCHEDULE';
                addSystemLog(action, equip, `Date: ${dateStr}, Content: ${item.content}`);
            }
        }
    }
}

// 5.2 일정 상세 모달 (Calendar에서 호출)
function setupEventDetailModal() {
    const modal = document.getElementById('event-detail-modal');
    const closeBtn = document.getElementById('btn-close-detail-modal');
    const closeFooterBtn = document.getElementById('btn-close-detail-footer');
    const completeBtn = document.getElementById('btn-complete-work');
    const updateDateBtn = document.getElementById('btn-update-date');
    const moveToEquipBtn = document.getElementById('btn-move-to-equip');

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
}

function openEventDetailModal(site, equip, id, isCompleted) {
    const modal = document.getElementById('event-detail-modal');
    if (!modal) return;

    currentDetailTarget = { site, equip, id, isCompleted };

    // 데이터 로드
    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    
    let item = null;
    if (isCompleted) {
        item = data.logs ? data.logs.find(l => l.id == id) : null;
    } else {
        item = data.maint ? data.maint.find(i => i.id == id) : null;
    }

    if (!item) return;

    // UI 업데이트
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

    if (isCompleted) {
        workerInput.value = item.worker || '';
        workerInput.disabled = true;
        memoInput.value = item.memo || '';
        memoInput.disabled = true;
        dateRow.style.display = 'none';
        completeBtn.style.display = 'none';
        saveMemoBtn.style.display = 'none';
    } else {
        workerInput.value = sessionStorage.getItem('userId') || '';
        workerInput.disabled = false;
        memoInput.value = '';
        memoInput.disabled = false;
        
        dateRow.style.display = 'flex';
        document.getElementById('detail-scheduled-date').value = item.scheduledDate || '';
        
        completeBtn.style.display = 'block';
        completeBtn.textContent = '작업 완료';
        saveMemoBtn.style.display = 'none';
    }

    modal.style.display = 'flex';
}

function updateScheduleDateFromDetail() {
    if (!currentDetailTarget || currentDetailTarget.isCompleted) return;
    
    const newDate = document.getElementById('detail-scheduled-date').value;
    if (!newDate) return alert('날짜를 선택해주세요.');
    
    setScheduleDate(currentDetailTarget.site, currentDetailTarget.equip, currentDetailTarget.id, newDate);
    alert('예정일이 변경되었습니다.');
    renderCalendar();
}

function completeScheduleWork() {
    if (!currentDetailTarget || currentDetailTarget.isCompleted) return;

    const worker = document.getElementById('detail-worker').value.trim();
    const memo = document.getElementById('detail-work-memo').value.trim();
    
    if (!worker) return alert('작업자를 입력해주세요.');

    const { site, equip, id } = currentDetailTarget;
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    
    const maintItem = data.maint ? data.maint.find(i => i.id == id) : null;
    if (!maintItem) return;

    if (!data.logs) data.logs = [];
    const today = new Date().toISOString().split('T')[0];
    
    data.logs.push({
        id: Date.now(),
        date: today,
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
    updateMaintenanceDashboard();
}

// 5.3 작업 예정일 등록 모달 (달력 + 버튼에서 호출)
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

    if (typeSelect) typeSelect.value = 'PM'; // 기본값 PM

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

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    const maintItems = data.maint || [];
    
    const filteredItems = maintItems.filter(item => item.type === selectedType);

    if (filteredItems.length === 0) {
        itemList.innerHTML = '<div style="padding:10px; color:#8b949e; text-align:center;">등록된 PM 항목이 없습니다.</div>';
        return;
    }

    filteredItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'register-item-row';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #30363d';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.id;
        checkbox.id = `reg-item-${item.id}`;
        checkbox.style.marginRight = '10px';

        const label = document.createElement('label');
        label.htmlFor = `reg-item-${item.id}`;
        label.style.flex = '1';
        label.style.cursor = 'pointer';
        
        let statusText = '';
        if (item.scheduledDate) {
            statusText = ` <span style="color:#e3b341; font-size:0.85em;">(예정: ${item.scheduledDate})</span>`;
        }
        
        label.innerHTML = `<span class="badge ${selectedType.toLowerCase()}">${selectedType}</span> ${escapeHtml(item.content)}${statusText}`;

        div.appendChild(checkbox);
        div.appendChild(label);
        itemList.appendChild(div);
    });
}

function confirmRegisterSchedule() {
    const dateStr = document.getElementById('register-date-display').value;
    const site = document.getElementById('register-site-select').value;
    const equip = document.getElementById('register-equip-select').value;
    const itemList = document.getElementById('register-item-list');
    
    if (!dateStr || !site || !equip) return alert('사업장과 장비를 선택해주세요.');

    const checkboxes = itemList.querySelectorAll('input[type="checkbox"]:checked');
    if (checkboxes.length === 0) return alert('등록할 항목을 선택해주세요.');

    const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));
    
    ids.forEach(id => {
        setScheduleDate(site, equip, id, dateStr);
    });

    alert('일정이 등록되었습니다.');
    document.getElementById('register-schedule-modal').style.display = 'none';
    
    renderCalendar();
    const popup = document.getElementById('calendar-popup');
    if (popup) popup.style.display = 'none';
}

// 5.4 검색 필터 모달
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

    // Load Sites
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
