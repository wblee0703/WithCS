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
    let completedEquips = [];

    // 데이터 집계
    Object.keys(data).forEach(site => {
        if (data[site]) {
            data[site].forEach(equip => {
                totalCount++;
                const equipKey = `${site}::${equip}`;
                const detailData = setupData[equipKey];

                let isSetup = false;
                let progress = 0;
                let completionDate = "";

                // 셋업 중인지 판단 (셋업 데이터가 있고, 완료되지 않았으며, 시작일이 있는 경우)
                if (detailData && detailData.setupDetails && detailData.setupDetails.length > 0) {
                    const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                    // [수정] 완료된 항목도 포함 (진행률 100% 표시)
                    if (completeItem && completeItem.startDate) {
                        isSetup = true;
                        if (completeItem.completed) completionDate = completeItem.date;
                        
                        // 진행률 계산
                        const totalTasks = detailData.setupDetails.length;
                        const completedTasks = detailData.setupDetails.filter(t => t.completed).length;
                        progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
                    }
                }

                if (isSetup) {
                    setupCount++;
                    if (progress === 100) {
                        completedEquips.push({ site, equip, progress, date: completionDate });
                    } else {
                        setupEquips.push({ site, equip, progress });
                    }
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

    // [추가] 셋업 현황 날짜 초기화 (이번 달)
    const setupMonthPicker = document.getElementById('integ-setup-month');
    if (setupMonthPicker && !setupMonthPicker.value) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        setupMonthPicker.value = `${y}-${m}`;
    }

    // [추가] 연도 선택 옵션 초기화 (없으면 생성)
    const yearSelect = document.getElementById('integ-maint-year');
    if (yearSelect && yearSelect.options.length === 0) {
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y >= currentYear - 5; y--) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.text = y + '년';
            yearSelect.appendChild(opt);
        }
    }
    
    // [추가] 셋업 연도 선택 옵션 초기화
    const setupYearSelect = document.getElementById('integ-setup-year');
    if (setupYearSelect && setupYearSelect.options.length === 0) {
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y >= currentYear - 5; y--) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.text = y + '년';
            setupYearSelect.appendChild(opt);
        }
    }

    // UI 렌더링
    renderIntegSetupSiteStats(); // [변경] 기간별 셋업 현황 차트
    renderIntegSetupList(setupEquips);
    renderIntegCompletedList(completedEquips); // [추가] 완료된 장비 리스트
    renderIntegMaintStats(data); // [추가] 운영 관리 통계 렌더링
}

function renderIntegSetupSiteStats() {
    const chartEl = document.getElementById('integ-setup-site-chart');
    const centerText = document.getElementById('integ-setup-site-center');
    const completeChartEl = document.getElementById('integ-setup-complete-chart');
    const completeCenterText = document.getElementById('integ-setup-complete-center');
    const doneChartEl = document.getElementById('integ-setup-done-chart');
    const doneCenterText = document.getElementById('integ-setup-done-center');

    if (!chartEl) return;

    // [수정] 기간 필터 설정 (월간/연간)
    const periodTypeEl = document.getElementById('integ-setup-period-type');
    const periodType = periodTypeEl ? periodTypeEl.value : 'month';
    
    let targetStart = null;
    let targetEnd = null;

    if (periodType === 'year') {
        const yearSelect = document.getElementById('integ-setup-year');
        const year = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
        targetStart = new Date(year, 0, 1);
        targetEnd = new Date(year, 11, 31, 23, 59, 59);
    } else {
        const monthInput = document.getElementById('integ-setup-month');
        let date = new Date();
        if (monthInput && monthInput.value) {
            const [y, m] = monthInput.value.split('-').map(Number);
            date = new Date(y, m - 1, 1);
        }
        targetStart = new Date(date.getFullYear(), date.getMonth(), 1);
        targetEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
    }

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const siteCounts = {};
    const completedSiteCounts = {};
    let totalForRate = 0;
    let completedCount = 0;
    let activeCount = 0;

    Object.keys(setupData).forEach(key => {
        const parts = key.split('::');
        const site = parts[0];
        const data = setupData[key];

        if (data && data.setupDetails) {
            // 해당 기간 내 활동 여부 확인
            let hasActivity = false;
            
            const completeItem = data.setupDetails.find(d => d.content === '셋업 완료');
            
            // [수정] 진행 중인 항목은 기간 무관하게 포함 (목록과 일치시키기 위함)
            if (completeItem && completeItem.startDate) {
                // 1. 진행 중인 경우: 무조건 포함
                if (!completeItem.completed) {
                    hasActivity = true;
                }
                // 2. 완료된 경우: 기간 내 활동이 있었는지 확인
                else {
                    const firstItem = data.setupDetails.find(d => d.startDate);
                    if (firstItem) {
                        const setupStart = new Date(firstItem.startDate);
                        const setupEnd = new Date(completeItem.date);
                        if (setupStart <= targetEnd && setupEnd >= targetStart) hasActivity = true;
                    }
                }
            }

            if (hasActivity) {
                totalForRate++;
                // 완료 여부 체크
                if (completeItem && completeItem.completed) {
                    completedCount++;
                    completedSiteCounts[site] = (completedSiteCounts[site] || 0) + 1;
                } else {
                    activeCount++;
                    siteCounts[site] = (siteCounts[site] || 0) + 1;
                }
            }
        }
    });

    // 차트 및 리스트 렌더링
    if (activeCount === 0) {
        chartEl.style.background = '';
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Active</div><div class="chart-center-value">0</div>`;
    } else {
        const colors = ['#1f6feb', '#238636', '#d29922', '#8957e5', '#da3633', '#f0883e', '#3fb950', '#a371f7'];
        let gradientStr = '';
        let currentDeg = 0;
        
        const sortedSites = Object.keys(siteCounts).map(site => ({ name: site, count: siteCounts[site] }))
                                                   .sort((a, b) => b.count - a.count);

        sortedSites.forEach((site, index) => {
            const color = colors[index % colors.length];
            const deg = (site.count / activeCount) * 360;
            gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
            currentDeg += deg;
        });

        chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
        if (centerText) {
            centerText.innerHTML = `<div class="chart-center-label">Active</div><div class="chart-center-value">${activeCount}</div>`;
        }
    }

    // [추가] 완료율 도넛 차트 렌더링
    if (completeChartEl && completeCenterText) {
        if (totalForRate === 0) {
            completeChartEl.style.background = '';
            completeCenterText.innerHTML = `<div class="chart-center-label">Complete</div><div class="chart-center-value">0%</div>`;
        } else {
            const completeRate = (completedCount / totalForRate) * 100;
            const completeDeg = (completedCount / totalForRate) * 360;
            
            // 완료(초록) / 미완료(회색) 그라데이션
            completeChartEl.style.background = `conic-gradient(#238636 0deg ${completeDeg}deg, #30363d ${completeDeg}deg 360deg)`;
            completeCenterText.innerHTML = `<div class="chart-center-label">Complete Rate</div><div class="chart-center-value">${Math.round(completeRate)}%</div>`;
        }
    }

    // [추가] 셋업 완료(사업장별) 도넛 차트 렌더링
    if (doneChartEl && doneCenterText) {
        if (completedCount === 0) {
            doneChartEl.style.background = '';
            doneCenterText.innerHTML = `<div class="chart-center-label">Done</div><div class="chart-center-value">0</div>`;
        } else {
            const colors = ['#1f6feb', '#238636', '#d29922', '#8957e5', '#da3633', '#f0883e', '#3fb950', '#a371f7'];
            let gradientStr = '';
            let currentDeg = 0;
            
            const sortedDoneSites = Object.keys(completedSiteCounts).map(site => ({ name: site, count: completedSiteCounts[site] }))
                                                       .sort((a, b) => b.count - a.count);

            sortedDoneSites.forEach((site, index) => {
                const color = colors[index % colors.length];
                const deg = (site.count / completedCount) * 360;
                gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
                currentDeg += deg;
            });

            doneChartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
            doneCenterText.innerHTML = `<div class="chart-center-label">Complete</div><div class="chart-center-value">${completedCount}</div>`;
        }
    }
}

// 전역 노출
window.renderIntegSetupSiteStats = renderIntegSetupSiteStats;
window.renderIntegMaintStats = renderIntegMaintStats;
window.toggleIntegPeriodMode = toggleIntegPeriodMode;
window.toggleIntegSetupPeriodMode = toggleIntegSetupPeriodMode;

// [추가] 셋업 기간 모드 토글 함수
function toggleIntegSetupPeriodMode() {
    const type = document.getElementById('integ-setup-period-type').value;
    const monthInput = document.getElementById('integ-setup-month');
    const yearSelect = document.getElementById('integ-setup-year');
    const titleSpan = document.getElementById('integ-setup-title-period');

    if (type === 'month') {
        if (monthInput) monthInput.style.display = 'inline-block';
        if (yearSelect) yearSelect.style.display = 'none';
        if (titleSpan) titleSpan.textContent = '월간';
    } else {
        if (monthInput) monthInput.style.display = 'none';
        if (yearSelect) yearSelect.style.display = 'inline-block';
        if (titleSpan) titleSpan.textContent = '연간';
    }
    renderIntegSetupSiteStats();
}

// [추가] 기간 모드 토글 함수
function toggleIntegPeriodMode() {
    const type = document.getElementById('integ-period-type').value;
    const monthInput = document.getElementById('integ-maint-month');
    const yearSelect = document.getElementById('integ-maint-year');
    const titleSpan = document.getElementById('integ-title-period');

    if (type === 'month') {
        if (monthInput) monthInput.style.display = 'inline-block';
        if (yearSelect) yearSelect.style.display = 'none';
        if (titleSpan) titleSpan.textContent = '월간';
    } else {
        if (monthInput) monthInput.style.display = 'none';
        if (yearSelect) yearSelect.style.display = 'inline-block';
        if (titleSpan) titleSpan.textContent = '연간';
    }
    renderIntegMaintStats();
}

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
            <span class="status-name no-margin-right integ-setup-detail-col-name">
                ${escapeHtml(item.site)} > ${escapeHtml(name)} 
                ${serial ? `<span class="equip-serial">${escapeHtml(serial)}</span>` : ''}
            </span>
            <span class="status-count integ-setup-detail-col-progress" style="color: ${progressColor}">${item.progress}%</span>
        `;
        
        // 클릭 시 셋업 대시보드(간트뷰)로 이동 및 필터링
        li.onclick = () => {
            // 1. 간트 차트 필터 설정 (index.js 전역 변수 활용)
            if (typeof currentGanttFilters !== 'undefined') {
                currentGanttFilters.site = item.site;
                currentGanttFilters.equip = item.equip;
            }
            // 2. 셋업 섹션으로 이동
            if (typeof showHomeSection === 'function') showHomeSection('setup');
            
            // 3. 셋업 대시보드 갱신 (필터 적용)
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
        };
        
        listEl.appendChild(li);
    });
}

// [추가] 완료된 장비 리스트 렌더링 (진행률 제외)
function renderIntegCompletedList(list) {
    const listEl = document.getElementById('integ-setup-complete-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';

    if (list.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">완료된 장비 없음</li>';
        return;
    }

    // 이름순 정렬
    list.sort((a, b) => a.equip.localeCompare(b.equip));

    list.forEach(item => {
        const parts = item.equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';

        const li = document.createElement('li');
        li.className = 'status-list-item';
        
        li.innerHTML = `
            <span class="status-color equip-bar" style="background-color: #238636;"></span>
            <span class="status-name no-margin-right integ-setup-complete-col-name">
                ${escapeHtml(item.site)} > ${escapeHtml(name)} 
                ${serial ? `<span class="equip-serial">${escapeHtml(serial)}</span>` : ''}
            </span>
            <span class="status-count integ-setup-complete-col-date">${item.date || ''}</span>
        `;
        
        // 클릭 시 셋업 대시보드로 이동
        li.onclick = () => {
            if (typeof currentGanttFilters !== 'undefined') {
                currentGanttFilters.site = item.site;
                currentGanttFilters.equip = item.equip;
            }
            if (typeof showHomeSection === 'function') showHomeSection('setup');
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
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

    // [수정] 기간 필터 모드 확인 및 접두어 설정
    const periodTypeEl = document.getElementById('integ-period-type');
    const periodType = periodTypeEl ? periodTypeEl.value : 'month';
    
    let targetPrefix = '';

    if (periodType === 'year') {
        const yearSelect = document.getElementById('integ-maint-year');
        if (yearSelect && yearSelect.value) {
            targetPrefix = yearSelect.value;
        } else {
            targetPrefix = new Date().getFullYear().toString();
        }
    } else {
        const monthPicker = document.getElementById('integ-maint-month');
        if (monthPicker && monthPicker.value) {
            targetPrefix = monthPicker.value;
        } else {
            const now = new Date();
            targetPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
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
        if (date && date.startsWith(targetPrefix)) {
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
            // [수정] '전체'가 선택된 경우에는 다른 항목을 흐리게 처리하지 않음
            if (selectedKey && selectedKey !== '전체' && !isActive) barGroup.classList.add('faded');

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
        // [추가] 전체 합계 계산 및 '전체' 항목 추가
        let totalSiteCount = 0;
        Object.values(siteCounts).forEach(count => totalSiteCount += count);
        
        // '전체'가 가장 앞에 오도록 새로운 객체 생성
        const orderedSiteCounts = { '전체': totalSiteCount, ...siteCounts };

        const siteGradients = [
            'linear-gradient(to top, #6e7681, #8b949e)', // [추가] 전체 (Gray)
            'linear-gradient(to top, #1f6feb, #58a6ff)', // Blue
            'linear-gradient(to top, #238636, #3fb950)', // Green
            'linear-gradient(to top, #d29922, #f0883e)', // Orange
            'linear-gradient(to top, #8957e5, #a371f7)', // Purple
            'linear-gradient(to top, #da3633, #ff7b72)', // Red
            'linear-gradient(to top, #9e6a03, #d29922)', // Dark Orange
            'linear-gradient(to top, #1b7c83, #3fb950)', // Teal/Green
            'linear-gradient(to top, #6e40c9, #8957e5)'  // Dark Purple
        ];
        renderChartWithAxis(siteChartEl, orderedSiteCounts, siteGradients, (key) => {
            // 사업장 클릭 핸들러
            if (key === '전체') {
                integSelectedSite = null;
            } else if (integSelectedSite === key) {
                integSelectedSite = null; // 토글 해제
            } else {
                integSelectedSite = key; // 선택
            }
            integSelectedType = null; // 사업장 변경 시 유형 필터 초기화
            renderIntegMaintStats(mainData); // 재렌더링
        }, integSelectedSite || '전체');
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
