/* ==========================================================================
   1. 전역 변수 및 공통 헬퍼 함수 (Globals & Helpers)
   ========================================================================== */
let selectedSiteFilter = null;
let selectedEquipFilter = null;
let selectedSerialFilter = null;
let currentGanttFilters = { site: '', equip: '' };
let setupDashboardFilter = { site: '', equip: '' };
let isFirstLoad = true;
let equipDetailSearchKeyword = ''; // [추가] 장비 정보 리스트 내부 검색어
let setupEquipDetailSearchKeyword = ''; // [추가] 셋업 장비 정보 리스트 내부 검색어

// [공통 헬퍼] 사업장 그룹화 이름 반환
window.getSiteGroupName = function (siteName) {
    try {
        const metaKey = `site_meta_${siteName}`;
        const metaData = JSON.parse(localStorage.getItem(metaKey));
        if (metaData && metaData.group) {
            return metaData.group;
        }
    } catch (e) { }

    return '기타사업장';
};

window.getSiteColor = function (siteName) {
    if (!siteName || siteName === '전체') return '#6e7681';

    // 그룹명에 대한 명시적 색상 반환
    if (siteName === 'SEC') return '#034EA2';
    if (siteName === 'SKH 이천') return '#eb371f';
    if (siteName === 'SKH 청주') return '#F37021';
    if (siteName === 'SCS 서안') return '#0096D6';
    if (siteName === 'SKH 우시') return '#d29922';
    if (siteName === '기타') return '#1b7c83';
    if (siteName === '기타사업장') return '#8957e5';

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

window.getSiteGradient = function (siteName) {
    if (!siteName || siteName === '전체') return 'linear-gradient(to top, #6e7681, #8b949e)';

    if (siteName === 'SEC') return 'linear-gradient(to top, #034EA2, #4a8eff)';
    if (siteName === 'SKH 이천') return 'linear-gradient(to top, #eb371f, #ff7b72)';
    if (siteName === 'SKH 청주') return 'linear-gradient(to top, #F37021, #ff9e66)';
    if (siteName === 'SCS 서안') return 'linear-gradient(to top, #0096D6, #66c2ff)';
    if (siteName === 'SKH 우시') return 'linear-gradient(to top, #d29922, #e3b341)';
    if (siteName === '기타') return 'linear-gradient(to top, #1b7c83, #3fb950)';
    if (siteName === '기타사업장') return 'linear-gradient(to top, #8957e5, #a371f7)';

    const color = window.getSiteColor(siteName);
    return `linear-gradient(to top, ${color}, #8b949e)`;
};

// [공통 헬퍼] 대시보드 데이터 로드
function getDashboardData() {
    let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    let baseData = (typeof storageData !== 'undefined' && Object.keys(storageData).length > 0) ? storageData : deviceData;
    return baseData.equipments ? baseData.equipments : baseData;
}

// [공통 헬퍼] 장비 표시 이름(시리얼, 고객사 장비명 포함) 포맷팅
window.formatEquipDisplayInfo = function formatEquipDisplayInfo(site, equipKey, equipmentModels = null) {
    const parts = equipKey.split('::');
    const name = parts[0];
    const serial = parts.length > 1 ? parts[1] : '';
    const custEquipNameFromKey = parts.length > 2 ? parts[2] : '';

    if (!equipmentModels) equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const matchedModel = equipmentModels.find(m => m.name === name);
    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;

    const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equipKey}`)) || {};
    const custEquipName = custEquipNameFromKey || ((detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '');

    let subInfo = '';
    if (custEquipName) {
        subInfo = `[${escapeHtml(custEquipName)}]`;
    } else if (serial) {
        subInfo = `[${escapeHtml(serial)}]`;
    }

    const mainInfo = `${escapeHtml(site)} > ${escapeHtml(displayName)}`;

    return {
        name: displayName,
        serial: serial,
        custEquipName: custEquipName,
        subInfo: subInfo,
        mainInfo: mainInfo,
        fullTitle: `${mainInfo} ${subInfo}`.replace(/<[^>]*>?/gm, '').trim(),
        displayEquip: subInfo ? `${displayName} ${subInfo}` : displayName
    };
}

// [공통 헬퍼] 대시보드 도넛 차트 및 리스트 렌더링 (코드 중복 제거 및 분리 관리용)
window.renderSharedStatusChart = function (options) {
    const {
        chartId, listId, centerTextId, centerLabel, centerValue,
        stats, totalCount, activeFilter, colorResolver,
        onItemClick, onAllClick, emptyMsg
    } = options;

    const chartEl = document.getElementById(chartId);
    const listEl = document.getElementById(listId);
    const centerText = document.getElementById(centerTextId);

    if (!listEl) return;
    listEl.innerHTML = '';

    if (totalCount === 0) {
        if (chartEl) {
            chartEl.style.background = '';
            if (centerText) centerText.innerHTML = `<div class="chart-center-label">${centerLabel}</div><div class="chart-center-value">0</div>`;
        }
        listEl.innerHTML = `<li class="list-empty-msg">${emptyMsg || '데이터 없음'}</li>`;
        return;
    }

    let gradientStr = '';
    let currentDeg = 0;
    const sortedStats = [...stats].sort((a, b) => b.count - a.count);

    const allLi = document.createElement('li');
    allLi.className = 'status-list-item';
    if (!activeFilter) allLi.classList.add('active');
    allLi.innerHTML = `<span class="status-color status-color-all"></span><span class="status-name">전체</span><span class="status-count">${totalCount}</span>`;
    allLi.onclick = onAllClick;
    listEl.appendChild(allLi);

    sortedStats.forEach((stat, index) => {
        let color = typeof colorResolver === 'function' ? colorResolver(stat.name, index) : colorResolver[index % colorResolver.length];
        const deg = (stat.count / totalCount) * 360;
        gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
        currentDeg += deg;

        const li = document.createElement('li');
        li.className = 'status-list-item';
        if (activeFilter === stat.name) li.classList.add('active');
        li.innerHTML = `<span class="status-color" style="background-color: ${color};"></span><span class="status-name" title="${escapeHtml(stat.name)}">${escapeHtml(stat.name)}</span><span class="status-count">${stat.count}</span>`;
        li.onclick = () => onItemClick(stat.name);
        listEl.appendChild(li);
    });

    if (chartEl) {
        chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">${centerLabel}</div><div class="chart-center-value">${centerValue}</div>`;
    }
};

/* ==========================================================================
   2. 초기화 및 이벤트 리스너 (Initialization)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const initDashboard = () => {
        updateHomeDashboard();

        // [추가] 장비 이관 팝업 및 버튼 초기화 (HOME 화면용)
        if (typeof window.setupEquipTransferModal === 'function') {
            window.setupEquipTransferModal();
        }
    };
    if (window.isDataLoaded) initDashboard();
    else window.addEventListener('DataLoaded', initDashboard);

    // [추가] 장비 정보 리스트 정적 검색창 이벤트 바인딩
    const equipDetailSearchInput = document.getElementById('equip-detail-search-input');
    if (equipDetailSearchInput) {
        equipDetailSearchInput.addEventListener('input', (e) => {
            equipDetailSearchKeyword = e.target.value.trim().toLowerCase();
            renderEquipDetailList(getDashboardData());
        });
    }

    // [추가] 셋업 장비 정보 리스트 정적 검색창 이벤트 바인딩
    const setupEquipDetailSearchInput = document.getElementById('setup-equip-detail-search-input');
    if (setupEquipDetailSearchInput) {
        setupEquipDetailSearchInput.addEventListener('input', (e) => {
            setupEquipDetailSearchKeyword = e.target.value.trim().toLowerCase();
            updateSetupDashboard(); // 검색어 입력 시 셋업 대시보드 리스트 즉시 리프레시
        });
    }

    // [수정] 정적으로 분리된 셋업 이력 버튼에 이벤트 직접 연결
    const btnGanttHistory = document.getElementById('btn-gantt-history');
    if (btnGanttHistory) {
        btnGanttHistory.addEventListener('click', () => {
            const site = currentGanttFilters.site || setupDashboardFilter.site;
            const equip = currentGanttFilters.equip;
            if (!site || !equip) {
                alert('장비를 먼저 선택해주세요.');
                return;
            }
            if (typeof openSetupHistoryModal === 'function') openSetupHistoryModal(site, equip);
        });
    }
});

/* ==========================================================================
   3. 네비게이션 및 뷰 전환 (Navigation & View Switching)
   ========================================================================== */
// [공통 헬퍼] 필터 기반 페이지 이동 로직
function navigateWithFilters(targetPage, savedPathKey, targetSite, targetEquipName, targetSerial) {
    const data = getDashboardData();
    let site = Array.isArray(targetSite) ? (targetSite.length > 0 ? targetSite[0] : '') : targetSite;
    let serial = targetSerial;
    let equipName = targetEquipName;

    const searchInputId = targetPage.includes('setup') ? 'gantt-search' : 'calendar-search';
    const searchInput = document.getElementById(searchInputId);
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

    if (keyword && !targetSerial) {
        for (const s in data) {
            if (site && s !== site) continue;
            const equips = data[s];
            if (equips) {
                const found = equips.find(e => e.toLowerCase().includes(keyword));
                if (found) {
                    site = s;
                    serial = found;
                    break;
                }
            }
        }
    }

    let fullEquipName = '';
    if (serial) {
        fullEquipName = serial;
        if (!site) {
            for (const s in data) {
                if (data[s] && data[s].includes(fullEquipName)) { site = s; break; }
            }
        }
    } else if (site && equipName) {
        if (data[site]) {
            const found = data[site].find(e => e.split('::')[0] === equipName);
            if (found) fullEquipName = found;
        }
    }

    if (site && fullEquipName) {
        location.href = `${targetPage}?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(fullEquipName)}`;
    } else if (site) {
        location.href = `${targetPage}?site=${encodeURIComponent(site)}`;
    } else {
        try {
            const lastState = JSON.parse(localStorage.getItem(savedPathKey) || sessionStorage.getItem(savedPathKey));
            if (lastState && lastState.site && lastState.equip) {
                location.href = `${targetPage}?site=${encodeURIComponent(lastState.site)}&equip=${encodeURIComponent(lastState.equip)}`;
                return;
            }
        } catch (e) { }
        location.href = targetPage;
    }
}

function goToSetupPage() {
    // 간트 뷰에서 검색 중인 장비가 있다면 가장 우선적으로 적용하도록 변경
    let targetSite = currentGanttFilters.site || setupDashboardFilter.site;
    let targetSerial = currentGanttFilters.equip;
    let targetEquipName = targetSerial ? '' : setupDashboardFilter.equip;
    navigateWithFilters('setup.html', 'lastSetupPath', targetSite, targetEquipName, targetSerial);
}

function goToMaintenancePage() {
    let targetSite = currentSearchFilters.site || selectedSiteFilter;
    let targetEquipName = selectedEquipFilter;
    let targetSerial = currentSearchFilters.equip || selectedSerialFilter;
    navigateWithFilters('maintenance.html', 'lastMaintPath', targetSite, targetEquipName, targetSerial);
}

function showHomeSection(type) {
    const menuContainer = document.querySelector('.home-menu-container');
    const setupSec = document.getElementById('section-setup');
    const maintSec = document.getElementById('section-maint');
    const integratedSec = document.getElementById('section-integrated');

    let isAlreadyActive = false;
    if (type === 'setup' && document.querySelector('.btn-setup.active')) isAlreadyActive = true;
    if (type === 'maint' && document.querySelector('.btn-maint.active')) isAlreadyActive = true;
    if (type === 'integrated' && document.querySelector('.btn-integrated.active')) isAlreadyActive = true;

    if (isAlreadyActive && menuContainer && menuContainer.classList.contains('compact')) {
        menuContainer.classList.toggle('expanded');
        return; // 섹션 전환 로직 실행 중단
    }
    if (menuContainer) menuContainer.classList.remove('expanded'); // 다른 섹션 선택 시 메뉴 접기

    const btnSetup = document.querySelector('.btn-setup');
    const btnMaint = document.querySelector('.btn-maint');
    const btnIntegrated = document.querySelector('.btn-integrated');
    if (btnSetup) btnSetup.classList.remove('active');
    if (btnMaint) btnMaint.classList.remove('active');
    if (btnIntegrated) btnIntegrated.classList.remove('active');

    // 메뉴 컨테이너를 컴팩트 모드로 전환 (애니메이션 효과)
    if (menuContainer) menuContainer.classList.add('compact');
    localStorage.setItem('lastHomeSection', type);

    if (type === 'setup') {
        if (btnSetup) btnSetup.classList.add('active');
        if (setupSec) setupSec.style.display = 'flex';
        if (maintSec) maintSec.style.display = 'none';
        if (integratedSec) integratedSec.style.display = 'none';
        if (typeof renderGanttChart === 'function') renderGanttChart();
    } else if (type === 'maint') {
        if (btnMaint) btnMaint.classList.add('active');
        if (setupSec) setupSec.style.display = 'none';
        if (maintSec) maintSec.style.display = 'flex';
        if (integratedSec) integratedSec.style.display = 'none';
        if (typeof renderCalendar === 'function') renderCalendar();
    } else if (type === 'integrated') {
        if (btnIntegrated) btnIntegrated.classList.add('active');
        if (setupSec) setupSec.style.display = 'none';
        if (maintSec) maintSec.style.display = 'none';
        if (integratedSec) integratedSec.style.display = 'flex';
        if (typeof updateIntegratedDashboard === 'function') updateIntegratedDashboard();
    }
}

/* ==========================================================================
   4. 대시보드 로직 (Dashboard Logic)
   ========================================================================== */
function updateHomeDashboard() {
    if (isFirstLoad) {
        const lastSection = localStorage.getItem('lastHomeSection');
        const rawUserSite = sessionStorage.getItem('user_site') || sessionStorage.getItem('userSite') || (window.currentUser && window.currentUser.site) || '';

        let userSiteFilter = null;
        if (rawUserSite && rawUserSite !== '전체' && rawUserSite !== '구분없음' && rawUserSite !== 'None' && rawUserSite !== 'null') {
            userSiteFilter = window.getSiteGroupName ? window.getSiteGroupName(rawUserSite) : rawUserSite;
        }

        try {
            const savedMaintFilter = JSON.parse(localStorage.getItem('maintDashboardFilter'));
            if (savedMaintFilter && savedMaintFilter.site) {
                selectedSiteFilter = savedMaintFilter.site;
                selectedEquipFilter = savedMaintFilter.equip;
                selectedSerialFilter = savedMaintFilter.serial;
                if (savedMaintFilter.search) currentSearchFilters = savedMaintFilter.search;
            } else if (userSiteFilter) {
                selectedSiteFilter = userSiteFilter;
                selectedEquipFilter = null;
                selectedSerialFilter = null;
                currentSearchFilters = { site: userSiteFilter, equip: '' };
            } else {
                selectedSiteFilter = null;
                selectedEquipFilter = null;
                selectedSerialFilter = null;
                currentSearchFilters = { site: '', equip: '' };
            }
        } catch (e) { console.error("Failed to restore filters", e); }

        // [수정] 마지막으로 본 섹션이 유효하면 해당 섹션을, 없으면 '통합 현황'을 기본으로 표시
        if (lastSection && document.querySelector(`.btn-${lastSection}`)) {
            showHomeSection(lastSection);
        } else {
            showHomeSection('integrated');
        }
        isFirstLoad = false;
    }

    updateMaintenanceDashboard();
    updateSetupDashboard();

    // [추가] 서버 데이터 비동기 로드 완료(갱신) 시, 
    // 통합 관리 대시보드도 최신 데이터로 리프레시하도록 호출하여 빈 화면 버그를 해결합니다.
    if (typeof updateIntegratedDashboard === 'function') {
        updateIntegratedDashboard();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const scrollToTarget = urlParams.get('scrollTo');
    if (scrollToTarget) {
        setTimeout(() => {
            let targetEl = null;
            if (scrollToTarget === 'gantt') targetEl = document.getElementById('gantt-chart-area');
            else if (scrollToTarget === 'calendar') targetEl = document.querySelector('.calendar-container');

            if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: newUrl }, '', newUrl);
        }, 200);
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
   5. 운영 관리 현황 대시보드 (Maintenance Dashboard)
   ========================================================================== */
function updateMaintenanceDashboard() {
    const data = getDashboardData();

    let totalEquip = 0;
    const siteStats = [];
    const groupCounts = {};

    if (data) {
        Object.keys(data).forEach(site => {
            const list = data[site] ? data[site].filter(e => !e.startsWith('기타(ETC)')) : [];
            const count = list.length;
            if (count > 0) {
                const groupName = window.getSiteGroupName(site);
                groupCounts[groupName] = (groupCounts[groupName] || 0) + count;
                totalEquip += count;
            }
        });

        // 지정된 우선순위대로 정렬
        const order = ['SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타'];
        order.forEach(name => {
            if (groupCounts[name]) siteStats.push({ name: name, count: groupCounts[name] });
        });
        Object.keys(groupCounts).forEach(name => {
            if (!order.includes(name)) siteStats.push({ name: name, count: groupCounts[name] });
        });
    }

    const equipCountsForChart = {};
    let totalEquipForChart = 0;
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    if (selectedSiteFilter) {
        Object.keys(data).forEach(site => {
            if (window.getSiteGroupName(site) === selectedSiteFilter) {
                const list = data[site];
                if (list && Array.isArray(list)) {
                    list.forEach(item => {
                        if (item.startsWith('기타(ETC)')) return;
                        totalEquipForChart++;
                        const name = item.split('::')[0];
                        const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
                        const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
                        equipCountsForChart[displayName] = (equipCountsForChart[displayName] || 0) + 1;
                    });
                }
            }
        });
    } else {
        Object.keys(data).forEach(site => {
            const list = data[site];
            if (list && Array.isArray(list)) {
                list.forEach(item => {
                    if (item.startsWith('기타(ETC)')) return;
                    totalEquipForChart++;
                    const name = item.split('::')[0];
                    const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
                    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
                    equipCountsForChart[displayName] = (equipCountsForChart[displayName] || 0) + 1;
                });
            }
        });
    }

    const equipStats = Object.keys(equipCountsForChart).map(key => ({ name: key, count: equipCountsForChart[key] }));

    renderSiteStatus(siteStats, totalEquip, data);
    renderEquipChart(equipStats, totalEquipForChart, data);
    renderEquipDetailList(data);
    renderUpcomingList(data);

    setTimeout(window.restructureHomeMaintenance, 50);
}

function renderSiteStatus(siteStats, totalEquip, allData) {
    window.renderSharedStatusChart({
        chartId: 'site-status-chart',
        listId: 'site-status-list',
        centerTextId: 'site-chart-center',
        centerLabel: 'Site',
        centerValue: siteStats.length,
        stats: siteStats,
        totalCount: totalEquip,
        activeFilter: selectedSiteFilter,
        colorResolver: (name) => window.getSiteColor(name),
        onAllClick: () => {
            selectedSiteFilter = null;
            selectedEquipFilter = null;
            selectedSerialFilter = null;
            currentSearchFilters = { site: '', equip: '' };
            saveMaintFilters();
            updateMaintenanceDashboard();
            renderCalendar();
        },
        onItemClick: (name) => {
            selectedSiteFilter = (selectedSiteFilter === name) ? null : name;
            currentSearchFilters.site = selectedSiteFilter || '';
            selectedEquipFilter = null;
            selectedSerialFilter = null;
            currentSearchFilters.equip = '';
            saveMaintFilters();
            updateMaintenanceDashboard();
            renderCalendar();
        },
        emptyMsg: '데이터 없음'
    });
}

function renderEquipChart(equipStats, totalEquip, allData) {
    const colors = ['#a371f7', '#f0883e', '#3fb950', '#da3633', '#8957e5', '#d29922', '#238636', '#1f6feb'];
    window.renderSharedStatusChart({
        chartId: 'equip-status-chart',
        listId: 'equip-status-list',
        centerTextId: 'equip-chart-center',
        centerLabel: 'Equip',
        centerValue: totalEquip,
        stats: equipStats,
        totalCount: totalEquip,
        activeFilter: selectedEquipFilter,
        colorResolver: colors,
        onAllClick: () => {
            selectedEquipFilter = null;
            selectedSerialFilter = null;
            currentSearchFilters.equip = '';
            saveMaintFilters();
            updateMaintenanceDashboard();
            renderCalendar();
        },
        onItemClick: (name) => {
            selectedEquipFilter = (selectedEquipFilter === name) ? null : name;
            currentSearchFilters.equip = selectedEquipFilter || '';
            selectedSerialFilter = null;
            saveMaintFilters();
            updateMaintenanceDashboard();
            renderCalendar();
        },
        emptyMsg: '데이터 없음'
    });
}

function renderEquipDetailList(data) {
    const listEl = document.getElementById('equip-detail-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    let items = [];
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    if (data) {
        Object.keys(data).forEach(site => {
            if (selectedSiteFilter && window.getSiteGroupName(site) !== selectedSiteFilter) return;
            if (data[site]) {
                data[site].forEach(equip => {
                    if (equip.startsWith('기타(ETC)')) return;
                    const name = equip.split('::')[0];
                    const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
                    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
                    if (selectedEquipFilter && displayName !== selectedEquipFilter) return;
                    items.push({ site, equip });
                });
            }
        });
    }

    // [추가] 검색어 필터링 적용 (텍스트 매칭)
    if (equipDetailSearchKeyword) {
        items = items.filter(item => {
            const info = formatEquipDisplayInfo(item.site, item.equip, equipmentModels);
            const searchStr = `${info.mainInfo} ${info.subInfo} ${item.equip}`.toLowerCase();
            return searchStr.includes(equipDetailSearchKeyword);
        });
    }

    if (items.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    items.forEach(item => {
        const info = formatEquipDisplayInfo(item.site, item.equip, equipmentModels);
        const li = document.createElement('li');
        li.className = 'status-list-item';
        if (selectedSerialFilter === item.equip) {
            li.classList.add('active');
        }

        li.innerHTML = `
            <span class="status-color equip-bar"></span>
            <div style="flex: 1; display: flex; align-items: center; min-width: 0;">
                <span class="status-name" title="${info.fullTitle}" style="margin-right: 0;">${info.mainInfo}${info.subInfo ? `<span class="equip-serial">${info.subInfo}</span>` : ''}</span>
            </div>
            <button class="btn-shortcut" style="margin-left: 10px;">이동</button>
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
            saveMaintFilters();
            updateMaintenanceDashboard();
            renderCalendar();
        };

        const btn = li.querySelector('.btn-shortcut');
        if (btn) {
            btn.onclick = (e) => {
                e.stopPropagation();
                location.href = `maintenance.html?site=${encodeURIComponent(item.site)}&equip=${encodeURIComponent(item.equip)}`;
            };
        }
        listEl.appendChild(li);
    });
}

let activeUpcomingTab = 'all';

function renderUpcomingList(data) {
    const upcomingListEl = document.getElementById('dash-upcoming-list');
    const upcomingContainer = document.getElementById('dash-upcoming-container');
    const summaryEl = document.getElementById('dash-inspection-summary');
    const tabGroupEl = document.getElementById('upcoming-tab-group');

    if (!upcomingListEl || !upcomingContainer) return;
    upcomingListEl.innerHTML = '';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const formatDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayStr = formatDateStr(today);
    const yesterdayStr = formatDateStr(yesterday);

    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const inspectionItems = [];

    let yesterdayCount = 0;
    let todayCount = 0;

    // 작업 유형별 건수 집계 객체
    const typeCounts = {
        all: { '정기': 0, '비정기': 0, '고객대응': 0, '용액제조': 0, '온라인점검': 0 },
        yesterday: { '정기': 0, '비정기': 0, '고객대응': 0, '용액제조': 0, '온라인점검': 0 },
        today: { '정기': 0, '비정기': 0, '고객대응': 0, '용액제조': 0, '온라인점검': 0 }
    };

    // 작업 유형별 우선순위 정의 (비정기 > 고객대응 > 용액제조 > 온라인점검 > 정기)
    const typePriority = {
        '비정기': 1,
        '고객대응': 2,
        '용액제조': 3,
        '온라인점검': 4,
        '정기': 5
    };

    const typeColors = {
        '정기': '#3fb950',
        '비정기': '#f85149',
        '고객대응': '#e3b341',
        '용액제조': '#a371f7',
        '온라인점검': '#58a6ff'
    };

    const inspectionMap = new Map();

    const getBaseDetailType = (item) => {
        let dt = (item.detailType || '').trim();
        if (dt) return dt;
        let c = (item.content || '').trim();
        c = c.replace(/\s*-\s*\[.*?\].*$/, '').trim();
        return c || '기타';
    };

    if (data) {
        Object.keys(data).forEach(site => {
            if (selectedSiteFilter && window.getSiteGroupName(site) !== selectedSiteFilter) return;

            if (data[site]) {
                data[site].forEach(equip => {
                    const isEtcEquip = equip.startsWith('기타(ETC)');
                    const equipName = equip.split('::')[0];
                    const matchedModel = equipmentModels.find(m => m.name === equipName || m.abbr === equipName);
                    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;
                    if (selectedEquipFilter && !isEtcEquip && displayName !== selectedEquipFilter) return;
                    if (selectedSerialFilter && !isEtcEquip && equip !== selectedSerialFilter) return;

                    const key = `details_${site}_${equip}`;
                    const detailData = JSON.parse(localStorage.getItem(key));

                    if (detailData) {
                        // 1. 완료 이력 (logs) 확인 - 작업 완료된 항목만 점검 리스트에 노출
                        if (detailData.logs) {
                            detailData.logs.forEach(log => {
                                if (log.date === yesterdayStr || log.date === todayStr) {
                                    const isYest = log.date === yesterdayStr;
                                    const t = log.type || '기타';
                                    const dt = getBaseDetailType(log);
                                    // 통일된 작업 단위 그룹핑 키 (사업장::장비::날짜::작업구분::세부구분)
                                    const groupKey = `${site}::${equip}::${log.date}::${t}::${dt}`;

                                    if (inspectionMap.has(groupKey)) {
                                        const existing = inspectionMap.get(groupKey);
                                        existing.itemCount++;
                                        existing.isCompleted = true; // 완료 건
                                        if (log.id) existing.id = log.id;
                                    } else {
                                        inspectionMap.set(groupKey, {
                                            id: log.id,
                                            site: site,
                                            equip: equip,
                                            type: t,
                                            detailType: dt,
                                            content: log.content || '',
                                            date: log.date,
                                            isYesterday: isYest,
                                            isCompleted: true,
                                            priority: typePriority[t] || 99,
                                            itemCount: 1
                                        });
                                    }
                                }
                            });
                        }
                    }
                });
            }
        });
    }

    // 그룹화된 작업 건수를 inspectionItems 목록에 추가 및 통계 집계 (1 작업 = 1 건)
    inspectionMap.forEach(item => {
        if (item.isYesterday) yesterdayCount++;
        else todayCount++;

        const t = item.type;
        if (typeCounts.all[t] !== undefined) typeCounts.all[t]++;
        if (item.isYesterday) {
            if (typeCounts.yesterday[t] !== undefined) typeCounts.yesterday[t]++;
        } else {
            if (typeCounts.today[t] !== undefined) typeCounts.today[t]++;
        }

        inspectionItems.push(item);
    });

    // 우선순위 정렬 (비정기 → 고객대응 → 용액제조 → 온라인점검 → 정기 순)
    inspectionItems.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.date.localeCompare(b.date);
    });

    // 요약 건수 및 작업 구분 건수 표시 (1번째 줄: 오늘, 2번째 줄: 어제)
    if (summaryEl) {
        const makeBadgesHtml = (countsObj) => {
            return Object.keys(typeColors).map(t => {
                const cnt = countsObj[t] || 0;
                const col = typeColors[t];
                return `<span class="upcoming-summary-badge" style="display:inline-flex; align-items:center; gap:2px; font-weight:700; padding:1px 5px; border-radius:10px; background:${col}18; color:${col}; border:1px solid ${col}33;">${t} <strong style="font-weight:800;">${cnt}</strong></span>`;
            }).join('');
        };

        const todayBadges = makeBadgesHtml(typeCounts.today);
        const yesterdayBadges = makeBadgesHtml(typeCounts.yesterday);

        summaryEl.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 3px; padding: 2px 0;">
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                    <span class="upcoming-summary-label" style="color:#3fb950; font-weight:700; flex-shrink:0;">오늘<span class="upcoming-count-text"> (${todayCount}건)</span>:</span>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">${todayBadges}</div>
                </div>
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                    <span class="upcoming-summary-label" style="color:#58a6ff; font-weight:700; flex-shrink:0;">어제<span class="upcoming-count-text"> (${yesterdayCount}건)</span>:</span>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">${yesterdayBadges}</div>
                </div>
            </div>
        `;
    }

    // 어제 ~ 오늘 점검 리스트 전체 렌더링
    upcomingListEl.innerHTML = '';

    if (inspectionItems.length === 0) {
        upcomingListEl.innerHTML = '<div class="upcoming-empty-msg" style="padding: 16px; text-align: center; color: #8b949e; font-size: 13px;">어제 ~ 오늘 점검 내역이 없습니다.</div>';
        upcomingContainer.style.display = 'flex';
        return;
    }

    inspectionItems.forEach(item => {
        const parts = item.equip.split('::');
        const rawName = parts[0];
        const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
        const abbrName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;

        const detailData = JSON.parse(localStorage.getItem(`details_${item.site}_${item.equip}`)) || {};
        const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : (parts.length > 2 ? parts[2] : '');
        const serialNo = parts.length > 1 ? parts[1] : '';

        let equipText = abbrName;
        if (custName) {
            equipText += ` (${custName})`;
        } else if (serialNo) {
            equipText += ` (${serialNo})`;
        }

        const color = typeColors[item.type] || '#8b949e';
        const dayLabel = item.isYesterday
            ? '<span style="font-size:11px; font-weight:bold; padding: 1px 5px; border-radius:3px; background:#21262d; color:#8b949e; margin-right:4px;">어제</span>'
            : '<span style="font-size:11px; font-weight:bold; padding: 1px 5px; border-radius:3px; background:#238636; color:#ffffff; margin-right:4px;">오늘</span>';

        const div = document.createElement('div');
        div.className = 'upcoming-item';
        div.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; margin-bottom: 6px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; transition: background 0.2s;';

        div.onmouseenter = () => div.style.background = '#21262d';
        div.onmouseleave = () => div.style.background = '#161b22';

        div.onclick = () => {
            if (typeof window.openEventDetailModal === 'function') {
                window.openEventDetailModal(item.site, item.equip, item.id, item.isCompleted, { hideActionBtns: true });
            } else if (typeof openEventDetailModal === 'function') {
                openEventDetailModal(item.site, item.equip, item.id, item.isCompleted, { hideActionBtns: true });
            }
        };

        const detailDisplayText = (item.detailType && item.detailType.trim())
            ? item.detailType.trim()
            : item.content;

        div.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1;">
                    <div class="upcoming-item-title" style="display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; color: #c9d1d9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${dayLabel}
                        <span style="color: #8b949e;">[${escapeHtml(item.site)}]</span>
                        <span style="color: #e6edf3;">${escapeHtml(equipText)}</span>
                    </div>
                    <div style="font-size: 12px; color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(detailDisplayText)}
                    </div>
                </div>
                <div style="margin-left: 8px; flex-shrink: 0;">
                    <span style="font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 12px; background: ${color}22; color: ${color}; border: 1px solid ${color}44;">
                        ${item.type}
                    </span>
                </div>
            `;

        upcomingListEl.appendChild(div);
    });

    upcomingContainer.style.display = 'flex';
}

/* ==========================================================================
   6. 셋업 현황 대시보드 (Setup Dashboard)
   ========================================================================== */
function updateSetupDashboard() {
    localStorage.setItem('setupDashboardFilter', JSON.stringify(setupDashboardFilter));
    localStorage.setItem('currentGanttFilters', JSON.stringify(currentGanttFilters));

    const data = getDashboardData();
    let activeSetupEquips = [];
    let completedSetupEquips = []; // [추가] 완료된 셋업
    let siteStats = {};
    let equipCounts = {};

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    Object.keys(data).forEach(site => {
        let groupName = typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타사업장';
        if (data[site] && Array.isArray(data[site])) {
            data[site].forEach(equip => {
                if (equip.startsWith('기타(ETC)')) return;
                const detailData = setupData[`${site}::${equip}`];
                if (detailData && detailData.setupDetails && detailData.setupDetails.length > 0) {
                    const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                    const isCompleted = completeItem && completeItem.completed;
                    if (!isCompleted) {
                        activeSetupEquips.push({ site, equip, isCompleted: false });
                        siteStats[groupName] = (siteStats[groupName] || 0) + 1;
                        const equipName = equip.split('::')[0];
                        const matchedModel = equipmentModels.find(m => m.name === equipName || m.abbr === equipName);
                        const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;
                        equipCounts[displayName] = (equipCounts[displayName] || 0) + 1;
                    } else if (isCompleted) {
                        const detailKey = `details_${site}_${equip}`;
                        const equipDetailData = JSON.parse(localStorage.getItem(detailKey)) || {};
                        const equipStatus = (equipDetailData.setup && equipDetailData.setup.equipStatus) ? equipDetailData.setup.equipStatus : '';

                        // [추가] 완료일 기준 1달(한 달) 이내인지 확인
                        let isWithinOneMonth = true;
                        if (completeItem.date) {
                            const [y, m, d] = completeItem.date.split('-').map(Number);
                            const compDate = new Date(y, m - 1, d);
                            const oneMonthAgo = new Date();
                            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
                            oneMonthAgo.setHours(0, 0, 0, 0);

                            if (compDate < oneMonthAgo) {
                                isWithinOneMonth = false;
                            }
                        }

                        // [수정] 완료 처리(워런티 등)가 안 된 장비이거나, 완료 처리되었더라도 1달이 지나지 않은 장비 표시
                        if (equipStatus !== '워런티' && equipStatus !== '가동 장비' && equipStatus !== '유휴 장비' || isWithinOneMonth) {
                            completedSetupEquips.push({ site, equip, date: completeItem.date, rejectReason: completeItem.rejectReason, equipStatus: equipStatus });

                            // [추가] 셋업 완료된 장비도 '장비 정보' 리스트에 계속 표시되도록 활성 리스트에 포함
                            activeSetupEquips.push({ site, equip, isCompleted: true });

                            // [추가] 승인 대기 중인 장비도 사업장 및 장비 현황 차트에 포함시켜 수치 오차 방지
                            siteStats[groupName] = (siteStats[groupName] || 0) + 1;
                            const equipName = equip.split('::')[0];
                            const matchedModel = equipmentModels.find(m => m.name === equipName || m.abbr === equipName);
                            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;
                            equipCounts[displayName] = (equipCounts[displayName] || 0) + 1;
                        }
                    }
                }
            });
        }
    });

    const allSetupEquips = activeSetupEquips; // [수정] activeSetupEquips에 완료된 항목도 포함되었으므로 통합 배열로 사용
    const totalActive = allSetupEquips.length;
    const siteStatsArr = Object.keys(siteStats).map(key => ({ name: key, count: siteStats[key] }));
    const equipStatsArr = Object.keys(equipCounts).map(key => ({ name: key, count: equipCounts[key] }));

    renderSetupCompletedList(completedSetupEquips); // [수정] 셋업 완료 장비 리스트 렌더링
    renderSetupSiteStatus(siteStatsArr, totalActive, allSetupEquips);
    renderSetupEquipChart(equipStatsArr, totalActive, allSetupEquips);
    renderSetupEquipDetailList(activeSetupEquips);
    renderSetupUpcomingList(activeSetupEquips);
    if (typeof renderGanttChart === 'function') renderGanttChart();
}

function renderSetupCompletedList(completedEquips) {
    const listEl = document.getElementById('setup-completed-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (completedEquips.length === 0) {
        listEl.innerHTML = `<li class="list-empty-msg">완료된 셋업 장비 없음</li>`;
        return;
    }

    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    // Sort by completion date, newest first
    completedEquips.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    completedEquips.forEach(item => {
        const info = formatEquipDisplayInfo(item.site, item.equip, equipmentModels);

        let displayStatus = '셋업 완료';
        if (item.equipStatus === '이관 대기') displayStatus = '이관 대기';
        else if (['워런티', '가동 장비', '유휴 장비'].includes(item.equipStatus)) displayStatus = '이관 완료';

        let statusColor = '#1f6feb'; // 파랑 (셋업 완료)
        if (displayStatus === '이관 대기') statusColor = '#d29922'; // 주황
        else if (displayStatus === '이관 완료') statusColor = '#3fb950'; // 초록

        const li = document.createElement('li');
        li.className = 'status-list-item';

        if (item.rejectReason) {
            li.style.borderLeft = '4px solid #da3633';
            li.innerHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; min-width: 0; padding-left: 5px;">
                    <div style="display: flex; align-items: center;">
                        <span class="status-name" title="${info.fullTitle}" style="margin-right: 0;">${info.mainInfo}${info.subInfo ? `<span class="equip-serial">${info.subInfo}</span>` : ''}</span>
                    </div>
                    <div style="font-size: 11px; color: #da3633; margin-top: 2px;">반려 사유: ${escapeHtml(item.rejectReason)}</div>
                </div>
                <span style="width: 70px; text-align: center; font-size: 12px; color: ${statusColor}; font-weight: bold; flex-shrink: 0;">${displayStatus}</span>
                <span class="status-count" style="width: 80px; text-align: center; font-size: 12px; color: #8b949e; flex-shrink: 0;">${item.date || '-'}</span>
            `;
        } else {
            li.innerHTML = `
                <div style="flex: 1; display: flex; align-items: center; min-width: 0;">
                    <span class="status-name" title="${info.fullTitle}">${info.mainInfo}${info.subInfo ? `<span class="equip-serial">${info.subInfo}</span>` : ''}</span>
                </div>
                <span style="width: 70px; text-align: center; font-size: 12px; color: ${statusColor}; font-weight: bold; flex-shrink: 0;">${displayStatus}</span>
                <span class="status-count" style="width: 80px; text-align: center; font-size: 12px; color: #8b949e; flex-shrink: 0;">${item.date || '-'}</span>
            `;
        }

        li.onclick = () => window.openSetupCompleteModal(item.site, item.equip);
        listEl.appendChild(li);
    });
}

function renderSetupSiteStatus(siteStats, totalEquip, activeEquips) {
    const listEl = document.getElementById('setup-site-status-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (totalEquip === 0) {
        listEl.innerHTML = `<li class="list-empty-msg">진행 중인 셋업 없음</li>`;
        return;
    }

    const sortedStats = [...siteStats].sort((a, b) => b.count - a.count);

    const allLi = document.createElement('li');
    allLi.className = 'status-list-item';
    if (!setupDashboardFilter.site) allLi.classList.add('active');
    allLi.innerHTML = `<span class="status-color status-color-all"></span><span class="status-name">전체</span><span class="status-count">${totalEquip}</span>`;
    allLi.onclick = () => {
        setupDashboardFilter.site = '';
        setupDashboardFilter.equip = '';
        currentGanttFilters = { site: '', equip: '' };
        currentSearchFilters = { site: '', equip: '' };
        renderCalendar();
        updateSetupDashboard();
    };
    listEl.appendChild(allLi);

    sortedStats.forEach((stat) => {
        const color = window.getSiteColor(stat.name);
        const li = document.createElement('li');
        li.className = 'status-list-item';
        if (setupDashboardFilter.site === stat.name) li.classList.add('active');
        li.innerHTML = `<span class="status-color" style="background-color: ${color};"></span><span class="status-name" title="${escapeHtml(stat.name)}">${escapeHtml(stat.name)}</span><span class="status-count">${stat.count}</span>`;
        li.onclick = () => {
            setupDashboardFilter.site = (setupDashboardFilter.site === stat.name) ? '' : stat.name;
            setupDashboardFilter.equip = '';
            currentGanttFilters = { site: '', equip: '' };
            updateSetupDashboard();
        };
        listEl.appendChild(li);
    });
}

function renderSetupEquipChart(equipStats, totalEquip, activeEquips) {
    let filteredEquips = activeEquips;
    if (setupDashboardFilter.site) {
        filteredEquips = activeEquips.filter(e => window.getSiteGroupName(e.site) === setupDashboardFilter.site);
    }

    let filteredStats = {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    filteredEquips.forEach(e => {
        const name = e.equip.split('::')[0];
        const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
        const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
        filteredStats[displayName] = (filteredStats[displayName] || 0) + 1;
    });

    const statsArr = Object.keys(filteredStats).map(key => ({ name: key, count: filteredStats[key] }));
    const filteredTotal = filteredEquips.length;

    const listEl = document.getElementById('setup-equip-status-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (filteredTotal === 0) {
        listEl.innerHTML = `<li class="list-empty-msg">데이터 없음</li>`;
        return;
    }

    const colors = ['#a371f7', '#f0883e', '#3fb950', '#da3633', '#8957e5', '#d29922', '#238636', '#1f6feb'];
    const sortedStats = [...statsArr].sort((a, b) => b.count - a.count);

    const allLi = document.createElement('li');
    allLi.className = 'status-list-item';
    if (!setupDashboardFilter.equip) allLi.classList.add('active');
    allLi.innerHTML = `<span class="status-color status-color-all"></span><span class="status-name">전체</span><span class="status-count">${filteredTotal}</span>`;
    allLi.onclick = () => {
        setupDashboardFilter.equip = '';
        currentGanttFilters = { site: '', equip: '' };
        currentSearchFilters.equip = '';
        renderCalendar();
        updateSetupDashboard();
    };
    listEl.appendChild(allLi);

    sortedStats.forEach((stat, index) => {
        const color = colors[index % colors.length];
        const li = document.createElement('li');
        li.className = 'status-list-item';
        if (setupDashboardFilter.equip === stat.name) li.classList.add('active');
        li.innerHTML = `<span class="status-color" style="background-color: ${color};"></span><span class="status-name" title="${escapeHtml(stat.name)}">${escapeHtml(stat.name)}</span><span class="status-count">${stat.count}</span>`;
        li.onclick = () => {
            setupDashboardFilter.equip = (setupDashboardFilter.equip === stat.name) ? '' : stat.name;
            currentGanttFilters = { site: '', equip: '' };
            updateSetupDashboard();
        };
        listEl.appendChild(li);
    });
}

function renderSetupEquipDetailList(activeEquips) {
    const listEl = document.getElementById('setup-equip-detail-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    let filtered = activeEquips;
    if (setupDashboardFilter.site) filtered = filtered.filter(e => window.getSiteGroupName(e.site) === setupDashboardFilter.site);
    if (setupDashboardFilter.equip) {
        filtered = filtered.filter(e => {
            const name = e.equip.split('::')[0];
            const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
            return displayName === setupDashboardFilter.equip;
        });
    }

    // [추가] 검색어 필터링 적용 (사업장, 모델명, 시리얼, 고객사 장비명, 프로젝트 번호)
    if (setupEquipDetailSearchKeyword) {
        const kws = setupEquipDetailSearchKeyword.split(/\s+/);
        filtered = filtered.filter(item => {
            const info = formatEquipDisplayInfo(item.site, item.equip, equipmentModels);
            const detailData = JSON.parse(localStorage.getItem(`details_${item.site}_${item.equip}`)) || {};
            const projectNo = (detailData.setup && detailData.setup.projectNo) ? detailData.setup.projectNo : '';
            const searchStr = `${info.mainInfo} ${info.subInfo} ${item.equip} ${projectNo}`.toLowerCase();
            return kws.every(kw => searchStr.includes(kw));
        });
    }

    if (filtered.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    filtered.forEach(item => {
        const info = formatEquipDisplayInfo(item.site, item.equip, equipmentModels);
        const li = document.createElement('li');
        li.className = 'status-list-item';

        if (currentGanttFilters.site === item.site && currentGanttFilters.equip === item.equip) {
            li.classList.add('active');
        }

        const progressColor = item.isCompleted ? '#3fb950' : '#1f6feb'; // 완료: 녹색, 진행중: 파란색

        li.innerHTML = `
            <span class="status-color equip-bar" style="background-color: ${progressColor};"></span>
            <div style="flex: 1; display: flex; align-items: center; min-width: 0;">
                <span class="status-name" title="${info.fullTitle}" style="margin-right: 0;">${info.mainInfo}${info.subInfo ? `<span class="equip-serial">${info.subInfo}</span>` : ''}</span>
            </div>
            <button class="btn-shortcut" style="margin-left: 10px;">이력</button>
        `;
        li.onclick = () => {
            if (currentGanttFilters.site === item.site && currentGanttFilters.equip === item.equip) {
                currentGanttFilters.site = '';
                currentGanttFilters.equip = '';
            } else {
                currentGanttFilters.site = item.site;
                currentGanttFilters.equip = item.equip;

                setTimeout(() => {
                    const ganttWrapper = document.getElementById('gantt-wrapper');
                    if (ganttWrapper) {
                        ganttWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }, 100);
            }
            updateSetupDashboard();
        };

        const btn = li.querySelector('.btn-shortcut');
        if (btn) {
            btn.onclick = (e) => {
                e.stopPropagation();
                if (typeof openSetupHistoryModal === 'function') openSetupHistoryModal(item.site, item.equip);
            };
        }
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
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    activeEquips.forEach(eq => {
        if (setupDashboardFilter.site && window.getSiteGroupName(eq.site) !== setupDashboardFilter.site) return;
        if (setupDashboardFilter.equip) {
            const name = eq.equip.split('::')[0];
            const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
            if (displayName !== setupDashboardFilter.equip) return;
        }
        if (currentGanttFilters.equip && eq.equip !== currentGanttFilters.equip) return;

        const data = setupData[`${eq.site}::${eq.equip}`];

        if (data && data.setupDetails) {
            const uncheckedTasks = data.setupDetails.filter(t => !t.completed);

            uncheckedTasks.forEach(task => {
                if (task.startDate) {
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
        const info = formatEquipDisplayInfo(item.site, item.equip, equipmentModels);

        let badgeClass = 'safe';
        let dateText = item.task.startDate;
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
            if (typeof window.openSetupLogRegisterModal === 'function') {
                const todayStr = new Date().toISOString().substring(0, 10);
                window.openSetupLogRegisterModal(item.site, item.equip, item.task.content, todayStr);
            } else {
                location.href = `setup.html?site=${encodeURIComponent(item.site)}&equip=${encodeURIComponent(item.equip)}`;
            }
        };

        clone.querySelector('.upcoming-info-site').textContent = info.mainInfo;
        clone.querySelector('.upcoming-info-content').textContent = item.task.content;

        const badge = clone.querySelector('.d-day-badge');
        badge.className = `d-day-badge ${badgeClass} badge-auto`;
        badge.textContent = dateText;

        listEl.appendChild(clone);
    });
}

/* ==========================================================================
   7. 장비 이슈 공유 (Equipment Issue Sharing)
   ========================================================================== */
function restructureHomeMaintenance() {
    const allLeftCharts = document.querySelectorAll('.maint-left-charts');
    let maintLeftCharts = null;

    for (let el of allLeftCharts) {
        const parent = el.closest('div[id*="maint"], div[id*="Maint"], .dashboard-col, .home-dashboard');
        if (parent) {
            if (parent.id && parent.id.toLowerCase().includes('maint')) {
                maintLeftCharts = el;
                break;
            }
            const titleEl = parent.querySelector('.section-title');
            if (titleEl && titleEl.textContent.includes('운영')) {
                maintLeftCharts = el;
                break;
            }
        }
    }

    if (!maintLeftCharts && allLeftCharts.length > 1) {
        maintLeftCharts = allLeftCharts[1];
    } else if (!maintLeftCharts && allLeftCharts.length === 1) {
        maintLeftCharts = allLeftCharts[0];
    }

    if (!maintLeftCharts) return;

    if (maintLeftCharts.querySelector('#home-issue-card')) {
        populateEquipmentIssues();
        return;
    }

    const existingCard = document.getElementById('home-issue-card');
    if (existingCard && !maintLeftCharts.contains(existingCard)) {
        existingCard.remove();
    }

    const issueCard = document.createElement('div');
    issueCard.id = 'home-issue-card';
    issueCard.className = 'status-group card-like';
    issueCard.innerHTML = `
        <h3 class="status-group-title" style="color: #eb371f;">장비 이슈 공유</h3>
        <div class="status-list-container" style="flex: 1; min-height: 0; width: 100%; border: none; overflow: hidden; display: flex; flex-direction: column;">
            <ul id="home-issue-list" class="upcoming-list" style="padding: 0 5px; margin: 0; list-style: none; flex: 1; min-height: 0; overflow-y: auto;"></ul>
        </div>
    `;

    maintLeftCharts.insertBefore(issueCard, maintLeftCharts.firstChild);
    populateEquipmentIssues();
}
window.restructureHomeMaintenance = restructureHomeMaintenance; // UI 렌더링 후 호출용 유지

function populateEquipmentIssues() {
    const issueList = document.getElementById('home-issue-list');
    if (!issueList) return;

    issueList.innerHTML = '';
    let issues = [];

    const dataMap = getDashboardData();
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    Object.keys(dataMap).forEach(site => {
        if (!dataMap[site] || !Array.isArray(dataMap[site])) return;
        dataMap[site].forEach(equipKey => {
            const key = `details_${site}_${equipKey}`;
            const details = JSON.parse(localStorage.getItem(key)) || {};

            if (details.logs) {
                const addedIssueIds = new Set(); // 중복 방지용 Set
                details.logs.forEach(log => {
                    if (log.isIssueShared === true) {
                        const familyId = log.originalLogId || log.id;
                        if (!addedIssueIds.has(familyId)) {
                            const parentLog = details.logs.find(l => l.id == familyId) || log;
                            issues.push({ site, equipKey, log: parentLog });
                            addedIssueIds.add(familyId);
                        }
                    }
                });
            }
        });
    });

    issues.sort((a, b) => {
        if (b.log.date !== a.log.date) return b.log.date.localeCompare(a.log.date);
        return b.log.id - a.log.id;
    });

    if (issues.length === 0) {
        issueList.innerHTML = '<li class="list-empty-msg">공유된 장비 이슈가 없습니다.</li>';
        return;
    }

    issues.forEach(issue => {
        const { site, equipKey, log } = issue;
        const info = formatEquipDisplayInfo(site, equipKey, equipmentModels);

        let detailStr = '';
        if (log.detailType2 && log.detailType2.includes('>')) {
            detailStr = log.detailType2.trim();
        } else if (log.detailType && log.detailType.includes('>')) {
            detailStr = log.detailType.trim();
        } else if (log.detailType2) {
            detailStr = `${log.detailType ? log.detailType.trim() + ' > ' : ''}${log.detailType2.trim()}`;
        } else {
            detailStr = log.detailType ? log.detailType.trim() : '';
        }

        const dateStr = log.date || '';

        let displayContent = log.content || '';
        // 비용처리 태그 제거 및 외 N개 처리
        if (displayContent && displayContent !== '내용 없음') {
            const items = displayContent.split(',').map(s => {
                let cleanS = s.replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
                if (log.type === '정기') {
                    const kwMatch = cleanS.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|파츠 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                    if (kwMatch) {
                        cleanS = kwMatch[2].trim();
                    }
                }
                return cleanS;
            }).filter(Boolean);

            if (items.length > 1) displayContent = `${items[0]} 외 ${items.length - 1}개`;
            else if (items.length === 1) displayContent = items[0];
        }

        const line2Text = `${detailStr} : ${displayContent}`;

        const li = document.createElement('li');
        li.className = 'upcoming-item';
        li.style.borderLeft = '4px solid #eb371f';
        li.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 4px; overflow: hidden; flex: 1; padding-right: 10px;">
                <span style="font-size: 13px; font-weight: bold; color: #e6edf3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${info.fullTitle}">${info.mainInfo} <span class="equip-serial">${info.subInfo}</span></span>
                <span style="font-size: 11px; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(detailStr)} : ${escapeHtml(log.content)}">${escapeHtml(line2Text)}</span>
            </div>
            <div style="font-size: 11px; color: #8b949e; white-space: nowrap; flex-shrink: 0;">${dateStr}</div>
        `;

        li.onclick = () => {
            if (typeof window.openExtraWorkHistoryModal === 'function') {
                window.openExtraWorkHistoryModal(site, equipKey, log.id);
            } else {
                let targetUrl = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equipKey)}&logId=${log.id}`;
                window.location.href = targetUrl;
            }
        };

        issueList.appendChild(li);
    });
}
