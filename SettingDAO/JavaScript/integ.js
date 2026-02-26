/* ==========================================================================
   통합 관리 대시보드 (Integrated Dashboard)
   ========================================================================== */

function updateIntegratedDashboard() {
    // 데이터 로드
    let data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    let totalCount = 0;
    let setupCount = 0;
    let setupEquips = [];

    // 데이터 집계
    Object.keys(data).forEach(site => {
        if (data[site]) {
            data[site].forEach(equip => {
                totalCount++;
                const equipKey = `${site}::${equip}`;
                const detailData = setupData[equipKey];

                let isSetup = false;
                let progress = 0;

                // 셋업 중인지 판단 (셋업 데이터가 있고, 완료되지 않았으며, 시작일이 있는 경우)
                if (detailData && detailData.setupDetails && detailData.setupDetails.length > 0) {
                    const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                    if (completeItem && !completeItem.completed && completeItem.startDate) {
                        isSetup = true;
                        
                        // 진행률 계산
                        const totalTasks = detailData.setupDetails.length;
                        const completedTasks = detailData.setupDetails.filter(t => t.completed).length;
                        progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
                    }
                }

                if (isSetup) {
                    setupCount++;
                    setupEquips.push({ site, equip, progress });
                }
            });
        }
    });

    // UI 렌더링
    renderIntegSetupSiteStats(); // [변경] 기간별 셋업 현황 차트
    renderIntegSetupList(setupEquips);
    renderIntegMaintStats(data); // [추가] 운영 관리 통계 렌더링
}

function renderIntegSetupSiteStats() {
    const chartEl = document.getElementById('integ-setup-site-chart');
    const listEl = document.getElementById('integ-setup-site-list');
    const centerText = document.getElementById('integ-setup-site-center');
    const periodSelect = document.getElementById('integ-setup-period');

    if (!chartEl || !listEl || !periodSelect) return;

    const period = periodSelect.value;
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const siteCounts = {};
    let totalInPeriod = 0;

    // 기간 계산
    let fromDate = null;
    if (period !== 'all') {
        const now = new Date();
        now.setMonth(now.getMonth() - parseInt(period));
        fromDate = now.toISOString().split('T')[0];
    }

    Object.keys(setupData).forEach(key => {
        const parts = key.split('::');
        const site = parts[0];
        const data = setupData[key];

        if (data && data.setupDetails) {
            // 해당 기간 내 활동 여부 확인
            let hasActivity = false;
            
            // 1. 현재 진행 중인 경우 (완료 안됨 + 시작일 있음) -> 무조건 포함
            const completeItem = data.setupDetails.find(d => d.content === '셋업 완료');
            if (completeItem && !completeItem.completed && completeItem.startDate) {
                hasActivity = true;
            }

            // 2. 기간 내 완료된 작업이 있는 경우
            if (!hasActivity && fromDate) {
                const activeTask = data.setupDetails.find(t => {
                    // 완료일이 기간 내에 있거나
                    if (t.completed && t.date && t.date >= fromDate) return true;
                    // 시작일이 기간 내에 있는 경우
                    if (t.startDate && t.startDate >= fromDate) return true;
                    return false;
                });
                if (activeTask) hasActivity = true;
            } else if (!hasActivity && period === 'all') {
                // 전체 기간이면 시작일이 있는 모든 셋업 포함
                if (data.setupDetails.some(t => t.startDate)) hasActivity = true;
            }

            if (hasActivity) {
                siteCounts[site] = (siteCounts[site] || 0) + 1;
                totalInPeriod++;
            }
        }
    });

    // 차트 및 리스트 렌더링
    listEl.innerHTML = '';
    if (totalInPeriod === 0) {
        chartEl.style.background = '';
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Total</div><div class="chart-center-value">0</div>`;
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        return;
    }

    const colors = ['#1f6feb', '#238636', '#d29922', '#8957e5', '#da3633', '#f0883e', '#3fb950', '#a371f7'];
    let gradientStr = '';
    let currentDeg = 0;
    
    const sortedSites = Object.keys(siteCounts).map(site => ({ name: site, count: siteCounts[site] }))
                                               .sort((a, b) => b.count - a.count);

    sortedSites.forEach((site, index) => {
        const color = colors[index % colors.length];
        const deg = (site.count / totalInPeriod) * 360;
        gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
        currentDeg += deg;

        const li = document.createElement('li');
        li.className = 'status-list-item';
        li.innerHTML = `
            <span class="status-color" style="background-color: ${color};"></span>
            <span class="status-name">${escapeHtml(site.name)}</span>
            <span class="status-count">${site.count}</span>
        `;
        listEl.appendChild(li);
    });

    chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
    if (centerText) {
        centerText.innerHTML = `<div class="chart-center-label">Total</div><div class="chart-center-value">${totalInPeriod}</div>`;
    }
}

// 전역 노출
window.renderIntegSetupSiteStats = renderIntegSetupSiteStats;

function renderIntegSetupList(list) {
    const listEl = document.getElementById('integ-setup-detail-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';

    if (list.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">진행 중인 셋업이 없습니다.</li>';
        return;
    }

    // 진행률 높은 순 정렬
    list.sort((a, b) => b.progress - a.progress);

    list.forEach(item => {
        const parts = item.equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';

        const li = document.createElement('li');
        li.className = 'status-list-item';
        
        // 진행률 바 스타일
        const progressColor = item.progress === 100 ? '#238636' : '#1f6feb';
        
        li.innerHTML = `
            <span class="status-color equip-bar" style="background-color: ${progressColor};"></span>
            <span class="status-name no-margin-right">
                ${escapeHtml(item.site)} > ${escapeHtml(name)} 
                ${serial ? `<span class="equip-serial">${escapeHtml(serial)}</span>` : ''}
            </span>
            <span class="status-count" style="color: ${progressColor}">${item.progress}%</span>
        `;
        
        // 클릭 시 셋업 페이지로 이동
        li.onclick = () => {
            location.href = `setup.html?site=${encodeURIComponent(item.site)}&equip=${encodeURIComponent(item.equip)}`;
        };
        
        listEl.appendChild(li);
    });
}

function renderIntegMaintStats(mainData) {
    const chartEl = document.getElementById('integ-maint-type-chart');
    const listEl = document.getElementById('integ-maint-item-list');
    if (!chartEl || !listEl) return;

    // 이번 달 기준 설정
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const typeCounts = { 'PM': 0, 'BM': 0, '트러블이슈': 0, '기타': 0 };
    const itemCounts = {};

    // 데이터 순회 (캘린더 일정 기준: details_*.maint 및 logs)
    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            mainData[site].forEach(equip => {
                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key));
                if (!detailData) return;

                // 1. 예정된 일정 (maint)
                if (detailData.maint) {
                    detailData.maint.forEach(item => {
                        if (item.scheduledDate && item.scheduledDate.startsWith(currentMonthPrefix)) {
                            countMaintItem(item.type, item.content);
                        }
                    });
                }

                // 2. 완료된 일정 (logs)
                if (detailData.logs) {
                    detailData.logs.forEach(log => {
                        if (log.date && log.date.startsWith(currentMonthPrefix)) {
                            countMaintItem(log.type, log.content);
                        }
                    });
                }
            });
        }
    });

    function countMaintItem(type, content) {
        // 타입 집계
        if (typeCounts.hasOwnProperty(type)) {
            typeCounts[type]++;
        } else {
            typeCounts['기타']++;
        }

        // 항목 집계 (내용별)
        if (content) {
            // 콤마로 구분된 항목 분리
            const items = content.split(',').map(s => s.trim());
            items.forEach(i => {
                if (i) itemCounts[i] = (itemCounts[i] || 0) + 1;
            });
        }
    }

    // --- 차트 렌더링 (막대 차트) ---
    chartEl.innerHTML = '';
    const maxCount = Math.max(...Object.values(typeCounts), 1); // 0 방지
    const colors = { 'PM': '#3fb950', 'BM': '#1f6feb', '트러블이슈': '#da3633', '기타': '#8b949e' };

    Object.keys(typeCounts).forEach(type => {
        const count = typeCounts[type];
        const heightPercent = (count / maxCount) * 100;
        
        const barGroup = document.createElement('div');
        barGroup.className = 'bar-group';
        barGroup.innerHTML = `
            <div class="bar-value">${count}</div>
            <div class="bar" style="height: ${heightPercent}%; background-color: ${colors[type]};"></div>
            <div class="bar-label">${type}</div>
        `;
        chartEl.appendChild(barGroup);
    });

    // --- 리스트 렌더링 (상위 5개 항목) ---
    listEl.innerHTML = '';
    const sortedItems = Object.keys(itemCounts).map(key => ({ name: key, count: itemCounts[key] }))
                                               .sort((a, b) => b.count - a.count)
                                               .slice(0, 10); // 상위 10개
    
    if (sortedItems.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
    } else {
        sortedItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'status-list-item';
            li.innerHTML = `
                <span class="status-name">${escapeHtml(item.name)}</span>
                <span class="status-count">${item.count}</span>
            `;
            listEl.appendChild(li);
        });
    }
}

// HTML 이스케이프 유틸리티 (중복 방지 위해 확인)
if (typeof escapeHtml !== 'function') {
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}
