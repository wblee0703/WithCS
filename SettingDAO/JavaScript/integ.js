/* ==========================================================================
   통합 관리 대시보드 (Integrated Dashboard)
   ========================================================================== */

// 통합 관리 필터 상태 변수
let integSelectedSite = null;
let integSelectedType = null;

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

    // [추가] 월간 현황 날짜 초기화 (이번 달)
    const monthPicker = document.getElementById('integ-maint-month');
    if (monthPicker && !monthPicker.value) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        monthPicker.value = `${y}-${m}`;
    }

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
window.renderIntegMaintStats = renderIntegMaintStats;

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
    // 데이터가 없으면 로드 (onchange 호출 대응)
    if (!mainData) {
        mainData = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
    }

    const chartEl = document.getElementById('integ-maint-type-chart');
    const siteChartEl = document.getElementById('integ-maint-site-chart');
    const listEl = document.getElementById('integ-maint-item-list');
    const itemChartEl = document.getElementById('integ-maint-item-chart');
    const itemCenterText = document.getElementById('integ-maint-item-center');
    if (!chartEl || !listEl) return;

    // 선택된 월 기준 설정
    const monthPicker = document.getElementById('integ-maint-month');
    let currentMonthPrefix = '';
    if (monthPicker && monthPicker.value) {
        currentMonthPrefix = monthPicker.value;
    } else {
        const now = new Date();
        currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const typeCounts = { 'PM': 0, 'BM': 0, '트러블이슈': 0, '프로그램변경': 0, '장비점검': 0 };
    const itemCounts = {};
    const siteCounts = {};

    // 데이터 순회 (캘린더 일정 기준: details_*.maint 및 logs)
    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            // 사업장 필터 확인 (유형 차트 및 리스트용)
            const isSiteMatch = !integSelectedSite || integSelectedSite === site;

            mainData[site].forEach(equip => {
                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key));
                if (!detailData) return;

                // 1. 예정된 일정 (maint)
                if (detailData.maint) {
                    detailData.maint.forEach(item => {
                        processItem(site, item.type, item.content, item.scheduledDate, isSiteMatch);
                    });
                }

                // 2. 완료된 일정 (logs)
                if (detailData.logs) {
                    detailData.logs.forEach(log => {
                        processItem(site, log.type, log.content, log.date, isSiteMatch);
                    });
                }
            });
        }
    });

    function processItem(site, type, content, date, isSiteMatch) {
        if (date && date.startsWith(currentMonthPrefix)) {
            // 1. 사업장별 현황 (필터 무관 전체 집계)
            siteCounts[site] = (siteCounts[site] || 0) + 1;

            // 2. 작업 유형별 현황 (사업장 필터 적용)
            if (isSiteMatch) {
                if (typeCounts.hasOwnProperty(type)) {
                    typeCounts[type]++;
                } else {
                    typeCounts['기타'] = (typeCounts['기타'] || 0) + 1;
                }
            }

            // 3. 주요 점검 항목 (사업장 필터 & 유형 필터 적용)
            const isTypeMatch = !integSelectedType || integSelectedType === type;
            
            if (isSiteMatch && isTypeMatch && content) {
            // 콤마로 구분된 항목 분리
            const items = content.split(',').map(s => s.trim());
            items.forEach(i => {
                if (i) {
                    // 유형과 내용을 함께 키로 사용하여 구분
                    const key = `${type}::${i}`;
                    itemCounts[key] = (itemCounts[key] || 0) + 1;
                }
            });
            }
        }
    }

    // [공통] 차트 렌더링 함수 (Y축 포함)
    const renderChartWithAxis = (container, dataCounts, colorMapOrArray, onClickHandler, selectedKey) => {
        container.innerHTML = '';
        
        const values = Object.values(dataCounts);
        const maxVal = values.length > 0 ? Math.max(...values) : 0;
        
        // Y축 스케일 계산 (초기값 10, 초과 시 5단위 증가)
        let yAxisMax = 10;
        if (maxVal > 10) {
            yAxisMax = Math.ceil(maxVal / 5) * 5;
        }

        // 막대 생성
        Object.keys(dataCounts).forEach((key, index) => {
            const count = dataCounts[key];
            const maxBarHeight = 180; // 차트 최대 높이 (px)
            const barHeight = yAxisMax > 0 ? (count / yAxisMax) * maxBarHeight : 0;
            
            // 색상 결정
            let bgStyle = '#30363d';
            if (Array.isArray(colorMapOrArray)) {
                bgStyle = colorMapOrArray[index % colorMapOrArray.length];
            } else if (colorMapOrArray[key]) {
                bgStyle = colorMapOrArray[key];
            }
            
            // 선택된 항목 스타일 처리
            const isActive = selectedKey === key;
            const activeClass = isActive ? 'active' : '';

            const barGroup = document.createElement('div');
            barGroup.className = 'bar-group';
            if (selectedKey && !isActive) barGroup.classList.add('faded');

            barGroup.innerHTML = `
                <div class="bar-value">${count}</div>
                <div class="bar ${activeClass}" style="height: ${barHeight}px; background: ${bgStyle};"></div>
                <div class="bar-label" title="${key}">${key}</div>
            `;
            
            // 클릭 이벤트
            if (onClickHandler) {
                barGroup.onclick = () => onClickHandler(key);
                barGroup.style.cursor = 'pointer';
            }

            container.appendChild(barGroup);
        });
    };

    // --- 차트 렌더링 실행 ---
    const typeGradients = { 
        'PM': 'linear-gradient(to top, #238636, #3fb950)', 
        'BM': 'linear-gradient(to top, #1f6feb, #58a6ff)', 
        '트러블이슈': 'linear-gradient(to top, #da3633, #ff7b72)', 
        '프로그램변경': 'linear-gradient(to top, #8957e5, #a371f7)',
        '장비점검': 'linear-gradient(to top, #6e7681, #8b949e)' 
    };

    renderChartWithAxis(chartEl, typeCounts, typeGradients, (key) => {
        // 유형 클릭 핸들러
        if (integSelectedType === key) integSelectedType = null; // 토글
        else integSelectedType = key;
        renderIntegMaintStats(mainData); // 재렌더링
    }, integSelectedType);

    if (siteChartEl) {
        const siteGradients = [
            'linear-gradient(to top, #1f6feb, #58a6ff)', // Blue
            'linear-gradient(to top, #238636, #3fb950)', // Green
            'linear-gradient(to top, #d29922, #f0883e)', // Orange
            'linear-gradient(to top, #8957e5, #a371f7)', // Purple
            'linear-gradient(to top, #da3633, #ff7b72)', // Red
            'linear-gradient(to top, #9e6a03, #d29922)', // Dark Orange
            'linear-gradient(to top, #1b7c83, #3fb950)', // Teal/Green
            'linear-gradient(to top, #6e40c9, #8957e5)'  // Dark Purple
        ];
        renderChartWithAxis(siteChartEl, siteCounts, siteGradients, (key) => {
            // 사업장 클릭 핸들러
            if (integSelectedSite === key) {
                integSelectedSite = null; // 토글 해제
            } else {
                integSelectedSite = key; // 선택
            }
            integSelectedType = null; // 사업장 변경 시 유형 필터 초기화
            renderIntegMaintStats(mainData); // 재렌더링
        }, integSelectedSite);
    }

    // --- 리스트 렌더링 (상위 5개 항목) ---
    listEl.innerHTML = '';
    const typeOrder = ['PM', 'BM', '트러블이슈', '프로그램변경', '장비점검'];
    
    const sortedItems = Object.keys(itemCounts).map(key => {
                                                   const parts = key.split('::');
                                                   // 키에서 유형과 내용 분리 (혹시 내용에 ::가 있을 경우 대비하여 slice 사용)
                                                   return { type: parts[0], name: parts.slice(1).join('::'), count: itemCounts[key] };
                                               })
                                               .sort((a, b) => {
                                                   const idxA = typeOrder.indexOf(a.type);
                                                   const idxB = typeOrder.indexOf(b.type);
                                                   
                                                   // 1순위: 구분 순서
                                                   if (idxA !== -1 && idxB !== -1) {
                                                       if (idxA !== idxB) return idxA - idxB;
                                                   } else if (idxA !== -1) return -1;
                                                   else if (idxB !== -1) return 1;
                                                   
                                                   // 2순위: 건수 내림차순
                                                   return b.count - a.count;
                                               });
    
    // 막대 너비 계산을 위한 최대값
    const maxItemCount = sortedItems.length > 0 ? sortedItems[0].count : 0;
    const totalItemCount = sortedItems.reduce((acc, item) => acc + item.count, 0);
    
    // 차트 색상 팔레트
    const colors = ['#1f6feb', '#238636', '#d29922', '#8957e5', '#da3633', '#f0883e', '#3fb950', '#a371f7'];
    let gradientStr = '';
    let currentDeg = 0;

    if (sortedItems.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        if (itemChartEl) itemChartEl.style.background = '';
        if (itemCenterText) itemCenterText.innerHTML = `<div class="chart-center-label">Items</div><div class="chart-center-value">0</div>`;
    } else {
        sortedItems.forEach((item, index) => {
            const color = colors[index % colors.length];
            if (totalItemCount > 0) {
                const deg = (item.count / totalItemCount) * 360;
                gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
                currentDeg += deg;
            }

            const li = document.createElement('li');
            li.className = 'status-list-item';
            li.innerHTML = `
                <div class="integ-list-col-type"><span class="list-type-badge type-${item.type}">${item.type}</span></div>
                <span class="status-color" style="background-color: ${color}; margin-right: 8px;"></span>
                <span class="status-name integ-list-col-name" style="text-align: left;">${escapeHtml(item.name)}</span>
                <span class="status-count integ-list-col-count">${item.count}</span>
            `;
            listEl.appendChild(li);
        });

        if (itemChartEl && totalItemCount > 0) {
            itemChartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
        }
        if (itemCenterText) {
            itemCenterText.innerHTML = `<div class="chart-center-label">Items</div><div class="chart-center-value">${totalItemCount}</div>`;
        }
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
