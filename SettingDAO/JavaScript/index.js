/* ==========================================================================
   1. 초기화 및 전역 변수 (Initialization & Globals)
   ========================================================================== */
let originalDetailMemo = "";
let selectedSiteFilter = null;
let selectedEquipFilter = null;
let selectedSerialFilter = null;
let currentGanttFilters = { site: '', equip: '' };
let setupDashboardFilter = { site: '', equip: '' };
let isFirstLoad = true;

// [추가] 사업장별 고유 색상 생성 함수 (이름 기반 해시)
window.getSiteColor = function(siteName) {
    if (!siteName || siteName === '전체') return '#6e7681';

    // [수정] 특정 사업장 고정 색상 지정
    const nameUpper = siteName.toUpperCase();
    if (nameUpper.includes('SKH')) return '#F37021'; // 주황색 (Orange)
    if (nameUpper.includes('SEC')) return '#034EA2'; // 파란색 (Blue)
    if (nameUpper.includes('ENF')) return '#0096D6'; // 밝은 파란색 (Light Blue)
    if (nameUpper.includes('ONSEMI')) return '#1D3546'; // 진한 파란색 (Dark Blue)
    if (nameUpper.includes('LG')) return '#6B6B6B'; // 회색 (Gray)

    const colors = [
        '#1f6feb', '#238636', '#d29922', '#8957e5', '#da3633', 
        '#f0883e', '#3fb950', '#a371f7', '#9e6a03', '#1b7c83', '#6e40c9'
    ];
    let hash = 0;
    for (let i = 0; i < siteName.length; i++) {
        hash = siteName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
};

// [추가] 사업장별 고유 그라데이션 생성 함수
window.getSiteGradient = function(siteName) {
    if (!siteName || siteName === '전체') return 'linear-gradient(to top, #6e7681, #8b949e)';
    const color = window.getSiteColor(siteName);
    const gradientMap = {
        '#1f6feb': 'linear-gradient(to top, #1f6feb, #58a6ff)',
        '#238636': 'linear-gradient(to top, #238636, #3fb950)',
        '#d29922': 'linear-gradient(to top, #d29922, #f0883e)',
        '#8957e5': 'linear-gradient(to top, #8957e5, #a371f7)',
        '#da3633': 'linear-gradient(to top, #da3633, #ff7b72)',
        '#f0883e': 'linear-gradient(to top, #f0883e, #ffb066)',
        '#3fb950': 'linear-gradient(to top, #3fb950, #6bc47d)',
        '#a371f7': 'linear-gradient(to top, #a371f7, #c4a7f7)',
        '#9e6a03': 'linear-gradient(to top, #9e6a03, #d29922)',
        '#1b7c83': 'linear-gradient(to top, #1b7c83, #3fb950)',
        '#6e40c9': 'linear-gradient(to top, #6e40c9, #8957e5)',
        '#F37021': 'linear-gradient(to top, #F37021, #ff9e66)', // SKH
        '#034EA2': 'linear-gradient(to top, #034EA2, #4a8eff)', // SEC
        '#0096D6': 'linear-gradient(to top, #0096D6, #66c2ff)', // ENF
        '#1D3546': 'linear-gradient(to top, #1D3546, #3a5a70)', // Onsemi
        '#6B6B6B': 'linear-gradient(to top, #6B6B6B, #9e9e9e)'  // LG
    };
    return gradientMap[color] || 'linear-gradient(to top, #30363d, #57606a)';
};

document.addEventListener('DOMContentLoaded', () => {
    // 초기화 함수 정의
    const initDashboard = () => {
        updateHomeDashboard();
    };

    // [수정] 이미 데이터가 로드되었는지 확인 후 실행
    if (window.isDataLoaded) {
        initDashboard();
    } else {
        window.addEventListener('DataLoaded', initDashboard);
    }

    // [요청] Integrated 대시보드 리스트 클릭 시 이동 확인 팝업
    const integLists = ['integ-setup-complete-list', 'integ-setup-detail-list'];
    integLists.forEach(id => {
        const list = document.getElementById(id);
        if (list) {
            // 캡처링(true)을 사용하여 기존 클릭 이벤트보다 먼저 실행
            list.addEventListener('click', (e) => {
                const li = e.target.closest('li');
                if (li) {
                    if (!confirm('해당 장비의 셋업 페이지로 이동하시겠습니까?')) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                    }
                }
            }, true);
        }
    });
});

/* ==========================================================================
   2. 네비게이션 및 뷰 전환 (Navigation & View Switching)
   ========================================================================== */
function goToSetupPage() {
    let targetSite = setupDashboardFilter.site;
    let targetEquipName = setupDashboardFilter.equip;
    let targetSerial = '';

    // [추가] 간트 차트 필터가 있으면 우선 적용
    if (currentGanttFilters.site) {
        targetSite = currentGanttFilters.site;
    }
    if (currentGanttFilters.equip) {
        targetSerial = currentGanttFilters.equip;
    }

    let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const data = typeof storageData !== 'undefined' && Object.keys(storageData).length > 0 ? storageData : (deviceData.equipments || deviceData || JSON.parse(localStorage.getItem('withtech_data')) || {});

    // 간트 차트 검색창 키워드 적용
    const ganttSearchInput = document.getElementById('gantt-search');
    const keyword = ganttSearchInput ? ganttSearchInput.value.trim().toLowerCase() : '';

    if (keyword && !targetSerial) {
        for (const site in data) {
            if (targetSite && site !== targetSite) continue;
            const equips = data[site];
            if (equips) {
                const found = equips.find(e => e.toLowerCase().includes(keyword));
                if (found) {
                    targetSite = site;
                    targetSerial = found;
                    break;
                }
            }
        }
    }

    let fullEquipName = '';

    if (targetSerial) {
        fullEquipName = targetSerial;
        if (!targetSite) {
            for (const site in data) {
                if (data[site] && data[site].includes(fullEquipName)) { targetSite = site; break; }
            }
        }
    } else if (targetSite && targetEquipName) {
        if (data[targetSite]) {
            const found = data[targetSite].find(e => e.split('::')[0] === targetEquipName);
            if (found) fullEquipName = found;
        }
    }

    if (targetSite && fullEquipName) {
        location.href = `setup.html?site=${encodeURIComponent(targetSite)}&equip=${encodeURIComponent(fullEquipName)}`;
    } else if (targetSite) {
        location.href = `setup.html?site=${encodeURIComponent(targetSite)}`;
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

    // 1. 캘린더 상세 검색 필터(Select 박스) 적용
    if (currentSearchFilters.site) {
        targetSite = currentSearchFilters.site;
    }
    if (currentSearchFilters.equip) {
        targetSerial = currentSearchFilters.equip;
    }

    let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const data = typeof storageData !== 'undefined' && Object.keys(storageData).length > 0 ? storageData : (deviceData.equipments || deviceData || JSON.parse(localStorage.getItem('withtech_data')) || {});

    // 2. 캘린더 텍스트 검색창(Keyword) 적용
    const calendarSearchInput = document.getElementById('calendar-search');
    const keyword = calendarSearchInput ? calendarSearchInput.value.trim().toLowerCase() : '';

    if (keyword && !targetSerial) {
        for (const site in data) {
            if (targetSite && site !== targetSite) continue;
            const equips = data[site];
            if (equips) {
                const found = equips.find(e => e.toLowerCase().includes(keyword));
                if (found) {
                    targetSite = site;
                    targetSerial = found;
                    break;
                }
            }
        }
    }

    let fullEquipName = '';

    if (targetSerial) {
        fullEquipName = targetSerial;
        if (!targetSite) {
            for (const site in data) {
                if (data[site] && data[site].includes(fullEquipName)) { targetSite = site; break; }
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
    } else if (targetSite) {
        // 장비가 특정되지 않았으나 사업장 필터가 있는 경우 사업장으로 이동
        location.href = `maintenance.html?site=${encodeURIComponent(targetSite)}`;
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
    const integratedSec = document.getElementById('section-integrated');

    // [Mobile] 이미 활성화된 섹션 버튼을 클릭했을 때 메뉴 확장/축소 토글
    let isAlreadyActive = false;
    if (type === 'setup' && document.querySelector('.btn-setup.active')) isAlreadyActive = true;
    if (type === 'maint' && document.querySelector('.btn-maint.active')) isAlreadyActive = true;
    if (type === 'integrated' && document.querySelector('.btn-integrated.active')) isAlreadyActive = true;

    if (isAlreadyActive && menuContainer.classList.contains('compact')) {
        menuContainer.classList.toggle('expanded');
        return; // 섹션 전환 로직 실행 중단
    }
    menuContainer.classList.remove('expanded'); // 다른 섹션 선택 시 메뉴 접기

    // [추가] 버튼 활성화 상태 토글
    const btnSetup = document.querySelector('.btn-setup');
    const btnMaint = document.querySelector('.btn-maint');
    const btnIntegrated = document.querySelector('.btn-integrated');
    if (btnSetup) btnSetup.classList.remove('active');
    if (btnMaint) btnMaint.classList.remove('active');
    if (btnIntegrated) btnIntegrated.classList.remove('active');

    // 메뉴 컨테이너를 컴팩트 모드로 전환 (애니메이션 효과)
    menuContainer.classList.add('compact');

    // [추가] 마지막 선택 상태 저장
    localStorage.setItem('lastHomeSection', type);

    if (type === 'setup') {
        if (btnSetup) btnSetup.classList.add('active');
        setupSec.style.display = 'flex';
        maintSec.style.display = 'none';
        if (integratedSec) integratedSec.style.display = 'none';
        renderGanttChart(); // Render Gantt when tab is shown
    } else if (type === 'maint') {
        if (btnMaint) btnMaint.classList.add('active');
        setupSec.style.display = 'none';
        maintSec.style.display = 'flex';
        if (integratedSec) integratedSec.style.display = 'none';
        renderCalendar();
    } else if (type === 'integrated') {
        if (btnIntegrated) btnIntegrated.classList.add('active');
        setupSec.style.display = 'none';
        maintSec.style.display = 'none';
        if (integratedSec) integratedSec.style.display = 'flex';
        
        // [추가] 통합 관리 대시보드 업데이트 호출
        if (typeof updateIntegratedDashboard === 'function') updateIntegratedDashboard();
    }
}

/* ==========================================================================
   3. 대시보드 로직 (Dashboard Logic)
   ========================================================================== */
function updateHomeDashboard() {
    // [추가] 첫 로드 시 마지막 화면 상태 및 필터 복원
    if (isFirstLoad) {
        const lastSection = localStorage.getItem('lastHomeSection');
        const userSite = sessionStorage.getItem('userSite'); // [추가] 계정 사업장 확인

        try {
            const savedSetupFilter = JSON.parse(localStorage.getItem('setupDashboardFilter'));
            if (savedSetupFilter) {
                setupDashboardFilter = savedSetupFilter;
            } else if (userSite) {
                setupDashboardFilter = { site: userSite, equip: '' }; // [추가] 기본 필터
            }

            const savedGanttFilter = JSON.parse(localStorage.getItem('currentGanttFilters'));
            if (savedGanttFilter) {
                currentGanttFilters = savedGanttFilter;
            } else if (userSite) {
                currentGanttFilters = { site: userSite, equip: '' }; // [추가] 기본 필터
            }

            // [추가] 운영 관리 필터 복원
            const savedMaintFilter = JSON.parse(localStorage.getItem('maintDashboardFilter'));
            if (savedMaintFilter) {
                selectedSiteFilter = savedMaintFilter.site;
                selectedEquipFilter = savedMaintFilter.equip;
                selectedSerialFilter = savedMaintFilter.serial;
                if (savedMaintFilter.search) currentSearchFilters = savedMaintFilter.search;
            } else if (userSite) {
                selectedSiteFilter = userSite;
                currentSearchFilters = { site: userSite, equip: '' };
            }
        } catch (e) { console.error("Failed to restore filters", e); }

        if (lastSection) {
            showHomeSection(lastSection);
        }
        isFirstLoad = false;
    }

    updateMaintenanceDashboard();
    updateSetupDashboard();

    // [추가] 간트뷰 또는 캘린더뷰 이동 버튼을 통해 접근 시 자동 스크롤
    const urlParams = new URLSearchParams(window.location.search);
    const scrollToTarget = urlParams.get('scrollTo');
    if (scrollToTarget) {
        setTimeout(() => {
            let targetEl = null;
            if (scrollToTarget === 'gantt') targetEl = document.getElementById('gantt-chart-area');
            else if (scrollToTarget === 'calendar') targetEl = document.querySelector('.calendar-container');
            
            if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
            // URL에서 파라미터 제거 (새로고침 시 방지)
            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({path: newUrl}, '', newUrl);
        }, 200); // UI 렌더링 후 약간의 대기 시간 적용
    }
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
    let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    let data = typeof storageData !== 'undefined' && Object.keys(storageData).length > 0 ? storageData : (deviceData.equipments || deviceData || JSON.parse(localStorage.getItem('withtech_data')) || {});

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
                     if (item.type === '정기') {
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
        const color = window.getSiteColor(site.name);
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
                currentSearchFilters.site = '';
            } else {
                selectedSiteFilter = site.name; // 선택
                currentSearchFilters.site = site.name;
            }
            selectedEquipFilter = null; // 사이트 변경 시 장비 필터 초기화
            selectedSerialFilter = null;
            currentSearchFilters.equip = '';
            saveMaintFilters(); // [추가] 상태 저장
            // UI 갱신 (리스트 다시 그리기)
            renderSiteStatus(siteStats, totalEquip, allData);
            // 장비 차트 업데이트
            updateEquipChartBasedOnFilter(allData);
            renderEquipDetailList(allData);
            renderUpcomingList(allData); // 점검 임박 리스트 갱신
            renderCalendar();
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
            currentSearchFilters.equip = ''; // 사업장 필터는 유지하고 장비 필터만 초기화
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
                    currentSearchFilters.equip = '';
                } else {
                    selectedEquipFilter = equip.name;
                    currentSearchFilters.equip = equip.name;
                }
                selectedSerialFilter = null; // 장비 종류 변경 시 개별 장비 필터 초기화
                saveMaintFilters(); // [추가] 상태 저장
                renderEquipChart(equipStats, totalEquip, allData);
                renderEquipDetailList(allData);
                renderUpcomingList(allData);
                renderCalendar();
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
            <span class="status-color equip-bar"></span>
            <span class="status-name no-margin-right">
                ${escapeHtml(item.site)} > ${escapeHtml(item.name)} 
                ${item.serial ? `<span class="equip-serial">${escapeHtml(item.serial)}</span>` : ''}
            </span>
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
                            if (item.type === '정기') {
                                let targetDiffDays = null;

                                // 1. 예정일(scheduledDate)이 있는 경우 (예정일 최우선)
                                if (item.scheduledDate) {
                                    const [y, m, d] = item.scheduledDate.split('-').map(Number);
                                    const schedDate = new Date(y, m - 1, d);
                                    targetDiffDays = Math.round((schedDate - today) / (1000 * 60 * 60 * 24));
                                } 
                                // 2. 예정일이 없으면 기본 교체주기(시작일 + 주기) 적용
                                else if (item.date && item.period) {
                                    const [y, m, d] = item.date.split('-').map(Number);
                                    const cycleDate = new Date(y, m - 1, d);
                                    cycleDate.setDate(cycleDate.getDate() + parseInt(item.period));
                                    targetDiffDays = Math.round((cycleDate - today) / (1000 * 60 * 60 * 24));
                                }

                                // 30일 이내인 경우만 리스트에 표시
                                if (targetDiffDays !== null && targetDiffDays <= 30) {
                                    upcomingItems.push({
                                        diffDays: targetDiffDays,
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

    // [수정] 정렬: 예정일 없는 항목 우선, 그 다음 남은 일수 오름차순
    upcomingItems.sort((a, b) => {
        const aHasDate = !!a.item.scheduledDate;
        const bHasDate = !!b.item.scheduledDate;
        
        if (aHasDate !== bHasDate) return aHasDate ? 1 : -1;
        return a.diffDays - b.diffDays;
    });

    const template = document.getElementById('upcoming-item-template');

    upcomingItems.forEach(obj => {
        const { diffDays, site, equip, item } = obj;
        const parts = equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';

        const clone = template.content.cloneNode(true);
        const div = clone.querySelector('.upcoming-item');
        div.onclick = () => openScheduleModal(site, equip, item.id);
        
        if (item.scheduledDate) {
            div.classList.add('scheduled-item');
            div.title = `작업 예정일: ${item.scheduledDate}`;
        } else {
            div.title = "클릭하여 작업 예정일 설정";
        }

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

        const contentText = escapeHtml(item.content);

        if (item.scheduledDate) {
            clone.querySelector('.upcoming-info-content').innerHTML = `${contentText} <span class="scheduled-date-text">(예정: ${item.scheduledDate})</span>`;
        } else {
            clone.querySelector('.upcoming-info-content').innerHTML = contentText;
        }

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

    let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    let data = typeof storageData !== 'undefined' && Object.keys(storageData).length > 0 ? storageData : (deviceData.equipments || deviceData || JSON.parse(localStorage.getItem('withtech_data')) || {});

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

                    // [추가] 셋업 일정(startDate)이 하나라도 입력된 장비만 필터링
                    const hasScheduledDate = detailData.setupDetails.some(d => d.startDate);

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
    if (typeof renderGanttChart === 'function') renderGanttChart();
}

function renderSetupSiteStatus(siteStats, totalEquip, activeEquips) {
    const chartEl = document.getElementById('setup-site-status-chart');
    const listEl = document.getElementById('setup-site-status-list');
    const centerText = document.getElementById('setup-site-chart-center');
    const barChartEl = document.getElementById('setup-site-bar-chart');

    if (!chartEl || !listEl) return;
    listEl.innerHTML = '';

    if (totalEquip === 0) {
        chartEl.style.background = '';
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Site</div><div class="chart-center-value">0</div>`;
        listEl.innerHTML = '<li class="list-empty-msg">진행 중인 셋업 없음</li>';
        if (barChartEl) barChartEl.innerHTML = '<div class="list-empty-msg" style="width:100%; text-align:center;">데이터 없음</div>';
        return;
    }

    let gradientStr = '';
    let currentDeg = 0;
    siteStats.sort((a, b) => b.count - a.count);

    // --- 막대그래프 렌더링 (상단 추가) ---
    if (barChartEl) {
        barChartEl.innerHTML = '';
        // 전체 항목을 포함한 데이터 배열 생성 (전체가 제일 왼쪽)
        // [수정] 막대그래프 이름순 정렬
        const sortedSiteStats = [...siteStats].sort((a, b) => a.name.localeCompare(b.name));
        const barData = [{ name: '전체', count: totalEquip }, ...sortedSiteStats];

        // Y축 스케일 계산
        const maxVal = Math.max(...barData.map(d => d.count));
        let yAxisMax = 10;
        if (maxVal > 10) {
            yAxisMax = Math.ceil(maxVal / 5) * 5;
        }

        barData.forEach((item, index) => {
            const isTotal = item.name === '전체';
            const count = item.count;
            const maxBarHeight = 140; // 컨테이너 높이(200px) 고려하여 조정
            const barHeight = yAxisMax > 0 ? (count / yAxisMax) * maxBarHeight : 0;

            // 색상 결정 (전체는 회색, 나머지는 팔레트 순환)
            let bgStyle = window.getSiteGradient(item.name);

            // 활성 상태 확인
            const isActive = (setupDashboardFilter.site === item.name) || (isTotal && !setupDashboardFilter.site);
            const activeClass = isActive ? 'active' : '';

            const barGroup = document.createElement('div');
            barGroup.className = 'bar-group';
            // 선택되지 않은 항목 흐리게 처리
            if (setupDashboardFilter.site && !isActive) {
                barGroup.classList.add('faded');
            }

            barGroup.innerHTML = `
                <div class="bar-value">${count}</div>
                <div class="bar ${activeClass}" style="height: ${barHeight}px; background: ${bgStyle};"></div>
                <div class="bar-label" title="${item.name}">${item.name}</div>
            `;

            barGroup.onclick = () => {
                if (isTotal) {
                    setupDashboardFilter.site = '';
                } else {
                    setupDashboardFilter.site = (setupDashboardFilter.site === item.name) ? '' : item.name;
                }
                setupDashboardFilter.equip = '';
                currentGanttFilters = { site: '', equip: '' };
                currentSearchFilters = { site: '', equip: '' };
                renderCalendar();
                updateSetupDashboard();
            };
            
            barGroup.style.cursor = 'pointer';
            barChartEl.appendChild(barGroup);
        });
    }
    // ----------------------------------

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
        const color = window.getSiteColor(site.name);
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
        currentGanttFilters.equip = ''; // 간트 차트 숨김 (site 필터는 유지)
        currentSearchFilters.equip = ''; // 사업장 필터는 유지하고 장비 필터만 초기화
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
        
        // [추가] 현재 간트 차트 필터(선택된 장비)와 일치하면 활성화(파란색) 스타일 적용
        if (currentGanttFilters.site === item.site && currentGanttFilters.equip === item.equip) {
            li.classList.add('active');
        }
        
        li.innerHTML = `
            <span class="status-color equip-bar"></span>
            <span class="status-name no-margin-right">
                ${escapeHtml(item.site)} > ${escapeHtml(name)} 
                ${serial ? `<span class="equip-serial">${escapeHtml(serial)}</span>` : ''}
            </span>
        `;
        li.onclick = () => {
            // [수정] 이미 선택된 항목을 클릭하면 선택 해제(토글), 아니면 선택 적용
            if (currentGanttFilters.site === item.site && currentGanttFilters.equip === item.equip) {
                currentGanttFilters.site = '';
                currentGanttFilters.equip = '';
            } else {
                currentGanttFilters.site = item.site;
                currentGanttFilters.equip = item.equip;
                
                // [추가] 간트 차트 영역으로 부드럽게 화면 자동 스크롤
                setTimeout(() => {
                    const ganttWrapper = document.getElementById('gantt-wrapper');
                    if (ganttWrapper) {
                        ganttWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }, 100);
            }
            updateSetupDashboard();
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
        badge.className = `d-day-badge ${badgeClass} badge-auto`;
        badge.textContent = dateText;

        listEl.appendChild(clone);
    });
}
