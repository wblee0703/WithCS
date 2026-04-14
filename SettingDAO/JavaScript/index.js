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

// [공통 헬퍼] 사업장 그룹화 이름 반환
window.getSiteGroupName = function (siteName) {
    if (siteName === 'SKH 이천' || siteName === 'SKH 청주') {
        return siteName;
    } else if (siteName === 'SEC 평택 본사' || siteName === 'SEC 화성 본사') {
        return '기타 사업장';
    } else if (siteName && siteName.includes('SEC')) {
        return 'SEC';
    } else {
        return '기타 사업장';
    }
};

window.getSiteColor = function (siteName) {
    if (!siteName || siteName === '전체') return '#6e7681';

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

// [공통 헬퍼] 대시보드 데이터 로드
function getDashboardData() {
    let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    let baseData = (typeof storageData !== 'undefined' && Object.keys(storageData).length > 0) ? storageData : deviceData;
    return baseData.equipments ? baseData.equipments : baseData;
}

// [공통 헬퍼] 장비 표시 이름(시리얼, 고객사 장비명 포함) 포맷팅
function formatEquipDisplayInfo(site, equipKey, equipmentModels = null) {
    const parts = equipKey.split('::');
    const name = parts[0];
    const serial = parts.length > 1 ? parts[1] : '';

    if (!equipmentModels) equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const matchedModel = equipmentModels.find(m => m.name === name);
    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;

    const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equipKey}`)) || {};
    const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

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

/* ==========================================================================
   2. 초기화 및 이벤트 리스너 (Initialization)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const initDashboard = () => updateHomeDashboard();
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
});

/* ==========================================================================
   3. 네비게이션 및 뷰 전환 (Navigation & View Switching)
   ========================================================================== */
// [공통 헬퍼] 필터 기반 페이지 이동 로직
function navigateWithFilters(targetPage, savedPathKey, targetSite, targetEquipName, targetSerial) {
    const data = getDashboardData();
    let site = targetSite;
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
    let targetSite = setupDashboardFilter.site || currentGanttFilters.site;
    let targetEquipName = setupDashboardFilter.equip;
    let targetSerial = currentGanttFilters.equip;
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
        const userSite = sessionStorage.getItem('userSite'); 

        try {
            const savedSetupFilter = JSON.parse(localStorage.getItem('setupDashboardFilter'));
            if (savedSetupFilter) {
                setupDashboardFilter = savedSetupFilter;
            } else if (userSite) {
                setupDashboardFilter = { site: '', equip: '' };
            }

            const savedGanttFilter = JSON.parse(localStorage.getItem('currentGanttFilters'));
            if (savedGanttFilter) {
                currentGanttFilters = savedGanttFilter;
            } else if (userSite) {
                currentGanttFilters = { site: '', equip: '' };
            }

            const savedMaintFilter = JSON.parse(localStorage.getItem('maintDashboardFilter'));
            if (savedMaintFilter) {
                selectedSiteFilter = savedMaintFilter.site;
                selectedEquipFilter = savedMaintFilter.equip;
                selectedSerialFilter = savedMaintFilter.serial;
                if (savedMaintFilter.search) currentSearchFilters = savedMaintFilter.search;
            } else if (userSite) {
                selectedSiteFilter = '';
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
            const list = data[site] ? data[site].filter(e => e !== '기타(ETC)') : [];
            const count = list.length;
            if (count > 0) {
                const groupName = window.getSiteGroupName(site);
                groupCounts[groupName] = (groupCounts[groupName] || 0) + count;
                totalEquip += count;
            }
        });

        // 지정된 우선순위대로 정렬
        const order = ['SEC', 'SKH 이천', 'SKH 청주', '기타 사업장'];
        order.forEach(name => {
            if (groupCounts[name]) siteStats.push({ name: name, count: groupCounts[name] });
        });
        Object.keys(groupCounts).forEach(name => {
            if (!order.includes(name)) siteStats.push({ name: name, count: groupCounts[name] });
        });
    }

    const equipCountsForChart = {};
    let totalEquipForChart = 0;

    if (selectedSiteFilter) {
        Object.keys(data).forEach(site => {
            if (window.getSiteGroupName(site) === selectedSiteFilter) {
                const list = data[site];
                if (list && Array.isArray(list)) {
                    list.forEach(item => {
                            if (item === '기타(ETC)') return;
                            totalEquipForChart++;
                        const name = item.split('::')[0];
                        equipCountsForChart[name] = (equipCountsForChart[name] || 0) + 1;
                    });
                }
            }
        });
    } else {
        Object.keys(data).forEach(site => {
            const list = data[site];
            if (list && Array.isArray(list)) {
                list.forEach(item => {
                        if (item === '기타(ETC)') return;
                        totalEquipForChart++;
                    const name = item.split('::')[0];
                    equipCountsForChart[name] = (equipCountsForChart[name] || 0) + 1;
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
    const chartEl = document.getElementById('site-status-chart');
    const listEl = document.getElementById('site-status-list');
    const centerText = document.getElementById('site-chart-center');

    if (!chartEl || !listEl) return;
    listEl.innerHTML = '';

    if (totalEquip === 0) {
        chartEl.style.background = ''; 
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Site</div><div class="chart-center-value">0</div>`;
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    let gradientStr = '';
    let currentDeg = 0;
    siteStats.sort((a, b) => b.count - a.count);

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
        selectedEquipFilter = null; 
        selectedSerialFilter = null;
        currentSearchFilters = { site: '', equip: '' };
        saveMaintFilters(); 
        updateMaintenanceDashboard();
        renderCalendar();
    };
    listEl.appendChild(allLi);

    siteStats.forEach((site, index) => {
        const color = window.getSiteColor(site.name);
        const deg = (site.count / totalEquip) * 360;
        gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
        currentDeg += deg;

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
                selectedSiteFilter = null; 
                currentSearchFilters.site = '';
            } else {
                selectedSiteFilter = site.name; 
                currentSearchFilters.site = site.name;
            }
            selectedEquipFilter = null; 
            selectedSerialFilter = null;
            currentSearchFilters.equip = '';
            saveMaintFilters(); 
            updateMaintenanceDashboard();
            renderCalendar();
        };
        listEl.appendChild(li);
    });

    chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
    if (centerText) centerText.innerHTML = `<div class="chart-center-label">Site</div><div class="chart-center-value">${siteStats.length}</div>`;
}

function renderEquipChart(equipStats, totalEquip, allData) {
    const chartEl = document.getElementById('equip-status-chart');
    const listEl = document.getElementById('equip-status-list');
    const centerText = document.getElementById('equip-chart-center');

    if (!chartEl) return;
    if (listEl) listEl.innerHTML = '';

    if (totalEquip === 0) {
        chartEl.style.background = ''; 
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Equip</div><div class="chart-center-value">0</div>`;
        if (listEl) listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    const colors = ['#a371f7', '#f0883e', '#3fb950', '#da3633', '#8957e5', '#d29922', '#238636', '#1f6feb'];
    let gradientStr = '';
    let currentDeg = 0;
    equipStats.sort((a, b) => b.count - a.count);

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
            currentSearchFilters.equip = ''; 
            saveMaintFilters(); 
            updateMaintenanceDashboard();
            renderCalendar();
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
                selectedSerialFilter = null; 
                saveMaintFilters(); 
                updateMaintenanceDashboard();
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
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    if (data) {
        Object.keys(data).forEach(site => {
            if (selectedSiteFilter && window.getSiteGroupName(site) !== selectedSiteFilter) return;
            if (data[site]) {
                data[site].forEach(equip => {
                    if (equip === '기타(ETC)') return;
                    const name = equip.split('::')[0];
                    if (selectedEquipFilter && name !== selectedEquipFilter) return;
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

function renderUpcomingList(data) {
    const upcomingListEl = document.getElementById('dash-upcoming-list');
    const upcomingContainer = document.getElementById('dash-upcoming-container');

    if (!upcomingListEl || !upcomingContainer) return;
    upcomingListEl.innerHTML = '';

    const upcomingItems = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    if (data) {
        Object.keys(data).forEach(site => {
            if (selectedSiteFilter && window.getSiteGroupName(site) !== selectedSiteFilter) return;

            if (data[site]) {
                data[site].forEach(equip => {
                    if (equip === '기타(ETC)') return;
                    const equipName = equip.split('::')[0];
                    if (selectedEquipFilter && equipName !== selectedEquipFilter) return;
                    if (selectedSerialFilter && equip !== selectedSerialFilter) return;

                    const key = `details_${site}_${equip}`;
                    const detailData = JSON.parse(localStorage.getItem(key));

                    if (detailData && detailData.maint) {
                        detailData.maint.forEach(item => {
                            if (item.type === '정기') {
                                let targetDiffDays = null;

                                if (item.scheduledDate) {
                                    const [y, m, d] = item.scheduledDate.split('-').map(Number);
                                    const schedDate = new Date(y, m - 1, d);
                                    targetDiffDays = Math.round((schedDate - today) / (1000 * 60 * 60 * 24));
                                } else if (item.date && item.period) {
                                    const [y, m, d] = item.date.split('-').map(Number);
                                    const cycleDate = new Date(y, m - 1, d);
                                    cycleDate.setDate(cycleDate.getDate() + parseInt(item.period));
                                    targetDiffDays = Math.round((cycleDate - today) / (1000 * 60 * 60 * 24));
                                }

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

    upcomingItems.sort((a, b) => {
        const aHasDate = !!a.item.scheduledDate;
        const bHasDate = !!b.item.scheduledDate;
        if (aHasDate !== bHasDate) return aHasDate ? 1 : -1;
        return a.diffDays - b.diffDays;
    });

    const template = document.getElementById('upcoming-item-template');

    upcomingItems.forEach(obj => {
        const info = formatEquipDisplayInfo(obj.site, obj.equip, equipmentModels);

        const clone = template.content.cloneNode(true);
        const div = clone.querySelector('.upcoming-item');
        div.onclick = () => openScheduleModal(obj.site, obj.equip, obj.item.id);

        if (obj.item.scheduledDate) {
            div.classList.add('scheduled-item');
            div.title = `작업 예정일: ${obj.item.scheduledDate}`;
        } else {
            div.title = "클릭하여 작업 예정일 설정";
        }

        let badgeClass = 'safe';
        let dDayText = `D-${obj.diffDays}`;
        if (obj.diffDays < 0) {
            badgeClass = 'danger';
            dDayText = `+${Math.abs(obj.diffDays)}`;
        } else if (obj.diffDays === 0) {
            badgeClass = 'warning';
            dDayText = 'D-Day';
        } else if (obj.diffDays <= 3) {
            badgeClass = 'warning';
        }

        const subInfoHtml = info.subInfo ? ` <span class="upcoming-info-sn">${info.subInfo}</span>` : '';

        const siteInfo = clone.querySelector('.upcoming-info-site');
        siteInfo.style.cssText = 'display: flex; align-items: center; gap: 5px; min-width: 0;';
        siteInfo.innerHTML = `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${info.fullTitle}">${info.mainInfo}</span>${subInfoHtml}`;

        const contentText = escapeHtml(obj.item.content);
        if (obj.item.scheduledDate) {
            clone.querySelector('.upcoming-info-content').innerHTML = `${contentText} <span class="scheduled-date-text">(예정: ${obj.item.scheduledDate})</span>`;
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
                location.href = `maintenance.html?site=${encodeURIComponent(obj.site)}&equip=${encodeURIComponent(obj.equip)}`;
            };
        }

        upcomingListEl.appendChild(clone);
    });

    upcomingContainer.style.display = 'flex';
    if (upcomingItems.length === 0) {
        upcomingListEl.innerHTML = '<div class="upcoming-empty-msg">예정된 점검이 없습니다.</div>';
    }
}

/* ==========================================================================
   6. 셋업 현황 대시보드 (Setup Dashboard)
   ========================================================================== */
function updateSetupDashboard() {
    localStorage.setItem('setupDashboardFilter', JSON.stringify(setupDashboardFilter));
    localStorage.setItem('currentGanttFilters', JSON.stringify(currentGanttFilters));

    const data = getDashboardData();
    let activeSetupEquips = [];
    let siteStats = {};
    let equipCounts = {};

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    Object.keys(data).forEach(site => {
            if (data[site] && Array.isArray(data[site])) {
                data[site].forEach(equip => {
                if (equip === '기타(ETC)') return;
                const detailData = setupData[`${site}::${equip}`];
                if (detailData && detailData.setupDetails && detailData.setupDetails.length > 0) {
                    const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                    const isCompleted = completeItem && completeItem.completed;
                    const hasScheduledDate = detailData.setupDetails.some(d => d.startDate);

                    if (!isCompleted && hasScheduledDate) {
                        activeSetupEquips.push({ site, equip });
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

    if (barChartEl) {
        barChartEl.innerHTML = '';
        const sortedSiteStats = [...siteStats].sort((a, b) => a.name.localeCompare(b.name));
        const barData = [{ name: '전체', count: totalEquip }, ...sortedSiteStats];

        const maxVal = Math.max(...barData.map(d => d.count));
        let yAxisMax = 10;
        if (maxVal > 10) {
            yAxisMax = Math.ceil(maxVal / 5) * 5;
        }

        barData.forEach((item, index) => {
            const isTotal = item.name === '전체';
            const count = item.count;
            const maxBarHeight = 140; 
            const barHeight = yAxisMax > 0 ? (count / yAxisMax) * maxBarHeight : 0;
            let bgStyle = window.getSiteGradient(item.name);
            const isActive = (setupDashboardFilter.site === item.name) || (isTotal && !setupDashboardFilter.site);
            const activeClass = isActive ? 'active' : '';

            const barGroup = document.createElement('div');
            barGroup.className = 'bar-group';
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
            currentGanttFilters = { site: '', equip: '' }; 
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

    const allLi = document.createElement('li');
    allLi.className = 'status-list-item';
    if (!setupDashboardFilter.equip) allLi.classList.add('active');
    allLi.innerHTML = `<span class="status-color status-color-all"></span><span class="status-name">전체</span><span class="status-count">${filteredTotal}</span>`;
    allLi.onclick = () => {
        setupDashboardFilter.equip = '';
        currentGanttFilters.equip = ''; 
        currentSearchFilters.equip = ''; 
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
            currentGanttFilters = { site: '', equip: '' }; 
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
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    let filtered = activeEquips;
    if (setupDashboardFilter.site) filtered = filtered.filter(e => e.site === setupDashboardFilter.site);
    if (setupDashboardFilter.equip) filtered = filtered.filter(e => e.equip.split('::')[0] === setupDashboardFilter.equip);

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

        li.innerHTML = `
            <span class="status-color equip-bar"></span>
            <div style="flex: 1; display: flex; align-items: center; min-width: 0;">
                <span class="status-name" title="${info.fullTitle}" style="margin-right: 0;">${info.mainInfo}${info.subInfo ? `<span class="equip-serial">${info.subInfo}</span>` : ''}</span>
            </div>
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
        if (setupDashboardFilter.site && eq.site !== setupDashboardFilter.site) return;
        if (setupDashboardFilter.equip && eq.equip.split('::')[0] !== setupDashboardFilter.equip) return;
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
            location.href = `setup.html?site=${encodeURIComponent(item.site)}&equip=${encodeURIComponent(item.equip)}`;
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

    const cards = maintLeftCharts.querySelectorAll('.status-group.card-like');
    let siteCard = null;
    let equipCard = null;

    cards.forEach(card => {
        const titleEl = card.querySelector('.status-group-title');
        if (!titleEl) return;
        const title = titleEl.textContent.trim();
        if (title.includes('사업장 현황')) siteCard = card;
        if (title.includes('장비 현황')) equipCard = card;
    });

    [siteCard, equipCard].forEach(card => {
        if (card) {
            const donut = card.querySelector('.donut-chart-wrapper');
            if (donut) donut.style.display = 'none';
        }
    });

    if (siteCard && equipCard) {
        const title = siteCard.querySelector('.status-group-title');
        if (title) title.textContent = '사업장 및 장비 현황';

        const siteRow = siteCard.querySelector('.chart-row');
        const equipRow = equipCard.querySelector('.chart-row');

        if (siteRow && equipRow) {
            siteRow.style.display = 'flex';
            siteRow.style.flexDirection = 'row';
            siteRow.style.gap = '15px';
            siteRow.style.width = '100%';

            const siteListFlex = siteRow.querySelector('.status-list-flex') || siteRow.querySelector('.status-list-container');
            const equipListFlex = equipRow.querySelector('.status-list-flex') || equipRow.querySelector('.status-list-container');

            if (siteListFlex) {
                siteListFlex.style.flex = '1';
                siteListFlex.style.minWidth = '0';
            }
            if (equipListFlex) {
                equipListFlex.style.flex = '1';
                equipListFlex.style.minWidth = '0';
                siteRow.appendChild(equipListFlex);
            }
        }

        equipCard.style.display = 'none';
        equipCard.classList.remove('card-like');
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
            detailStr = log.detailType ? log.detailType.trim() : '내용 없음';
        }

        const dateStr = log.date || '';

        let displayContent = log.content || '';
        if (displayContent.includes(',')) {
            const items = displayContent.split(',').map(s => s.trim()).filter(Boolean);
            if (items.length > 1) {
                displayContent = `${items[0]} 외 ${items.length - 1}개`;
            }
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
