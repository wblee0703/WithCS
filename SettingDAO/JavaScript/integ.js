/* ==========================================================================
   1. 전역 변수 및 초기화 (Global State)
   ========================================================================== */
let integSelectedSite = null;
let integSelectedType = null;
let integSetupSelectedSite = null;
let integEquipSelectedSite = null;

// 전역 함수 노출
window.renderIntegSetupSiteStats = renderIntegSetupSiteStats;
window.renderIntegMaintStats = renderIntegMaintStats;
window.toggleIntegPeriodMode = toggleIntegPeriodMode;
window.toggleIntegSetupPeriodMode = toggleIntegSetupPeriodMode;
window.updateIntegratedDashboard = updateIntegratedDashboard; // [추가] 전역 노출

/* ==========================================================================
   2. 메인 업데이트 로직 (Main Update Logic)
   ========================================================================== */
function updateIntegratedDashboard() {
    // 데이터 로드
    let data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    let totalCount = 0;
    let setupCount = 0;
    let setupEquips = [];
    let completedEquips = [];
    let summaryActiveCount = 0;
    let summaryCompletedCount = 0;

    // 막대그래프용 전체 집계 데이터
    const allSiteCounts = {};
    let totalActiveAll = 0;

    // [추가] 기간 필터 설정
    const periodTypeEl = document.getElementById('integ-setup-period-type');
    const periodType = periodTypeEl ? periodTypeEl.value : 'month';
    let targetStart = null;
    let targetEnd = null;

    if (periodType === 'year') {
        const yearSelect = document.getElementById('integ-setup-year');
        const year = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
        targetStart = new Date(year, 0, 1);
        targetEnd = new Date(year, 11, 31, 23, 59, 59);
    } else if (periodType === 'custom') {
        const startInput = document.getElementById('integ-setup-start');
        const endInput = document.getElementById('integ-setup-end');
        if (startInput && endInput && startInput.value && endInput.value) {
            const [sy, sm, sd] = startInput.value.split('-').map(Number);
            const [ey, em, ed] = endInput.value.split('-').map(Number);
            targetStart = new Date(sy, sm - 1, sd);
            targetEnd = new Date(ey, em - 1, ed, 23, 59, 59);
        } else {
            // 입력값이 없으면 현재 월 기본값 사용
            const now = new Date();
            targetStart = new Date(now.getFullYear(), now.getMonth(), 1);
            targetEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        }
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

                // 셋업 데이터 확인
                if (detailData && detailData.setupDetails && detailData.setupDetails.length > 0) {
                    const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                    if (completeItem && completeItem.startDate) {
                        // [수정] 기간 필터 적용
                        let overlaps = false;
                        const firstItem = detailData.setupDetails.find(d => d.startDate);
                        const setupStart = firstItem ? new Date(firstItem.startDate) : new Date(completeItem.startDate);
                        
                        if (completeItem.completed && completeItem.date) {
                            const setupEnd = new Date(completeItem.date);
                            if (setupStart <= targetEnd && setupEnd >= targetStart) overlaps = true;
                        } else {
                            if (setupStart <= targetEnd) overlaps = true;
                        }

                        if (overlaps) {
                            isSetup = true;
                            if (completeItem.completed) completionDate = completeItem.date;
                            const totalTasks = detailData.setupDetails.length;
                            const completedTasks = detailData.setupDetails.filter(t => t.completed).length;
                            progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
                        }
                    }
                }

                if (isSetup) {
                    setupCount++;
                    
                    // 1. 막대그래프용 전체 집계 (완료 포함)
                    allSiteCounts[site] = (allSiteCounts[site] || 0) + 1;
                    totalActiveAll++;

                    // 요약 정보용 전체 집계 (필터 무관)
                    if (progress === 100) {
                        summaryCompletedCount++;
                    } else {
                        summaryActiveCount++;
                    }

                    // 2. 리스트용 필터링 집계
                    if (!integSetupSelectedSite || integSetupSelectedSite === site) {
                        if (progress === 100) {
                            completedEquips.push({ site, equip, progress, date: completionDate });
                        } else {
                            setupEquips.push({ site, equip, progress });
                        }
                    }
                }
            });
        }
    });

    // [추가] 셋업 요약 정보 업데이트
    const setupSummaryEl = document.getElementById('integ-setup-summary');
    if (setupSummaryEl) {
        setupSummaryEl.textContent = `(전체 : ${setupCount}, 진행중 : ${summaryActiveCount}, 완료 : ${summaryCompletedCount})`;
    }

    // 날짜/연도 컨트롤 초기화
    initDateControls();

    // UI 렌더링
    renderIntegEquipStats(data); // [추가] 장비 통합 현황 렌더링
    renderIntegSetupBarChart(allSiteCounts, totalActiveAll);
    renderIntegSetupSiteStats();
    renderIntegSetupList(setupEquips);
    renderIntegCompletedList(completedEquips);
    renderIntegMaintStats(data);
}

function initDateControls() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const startDate = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(currentYear, now.getMonth() + 1, 0).getDate();
    const endDate = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // 월간 입력창 초기화
    ['integ-maint-month', 'integ-setup-month'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = currentMonth;
    });

    // 연도 선택창 초기화
    ['integ-maint-year', 'integ-setup-year'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.options.length === 0) {
            for (let y = currentYear; y >= currentYear - 5; y--) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.text = y + '년';
                el.appendChild(opt);
            }
        }
    });

    // 운영 관리 직접 입력 날짜 초기화
    const maintStart = document.getElementById('integ-maint-start');
    const maintEnd = document.getElementById('integ-maint-end');
    if (maintStart && !maintStart.value) maintStart.value = startDate;
    if (maintEnd && !maintEnd.value) maintEnd.value = endDate;

    // 직접 입력 날짜 초기화
    const startInput = document.getElementById('integ-setup-start');
    const endInput = document.getElementById('integ-setup-end');
    if (startInput && !startInput.value) startInput.value = startDate;
    if (endInput && !endInput.value) endInput.value = endDate;
}

/* ==========================================================================
   [추가] 장비 통합 현황 섹션 (Equipment Integration Section)
   ========================================================================== */
function renderIntegEquipStats(data) {
    const siteChartEl = document.getElementById('integ-equip-site-chart');
    const modelChartEl = document.getElementById('integ-equip-model-chart');
    const summaryEl = document.getElementById('integ-equip-summary');
    
    if (!siteChartEl || !modelChartEl) return;

    const siteCounts = {};
    const modelCounts = {};
    const allModels = new Set();
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    let totalEquipCount = 0;

    // 데이터 집계
    Object.keys(data).forEach(site => {
        if (data[site] && data[site].length > 0) {
            // 1. 사업장 별 장비 수
            siteCounts[site] = data[site].length;

            data[site].forEach(equip => {
                totalEquipCount++;
                const model = equip.split('::')[0]; // 장비명(모델) 추출
                allModels.add(model);
                
                // 2. 모델 별 장비 수 (장비명 기준 집계) - [수정] 필터 적용
                if (!integEquipSelectedSite || site === integEquipSelectedSite) {
                    if (!modelCounts[model]) modelCounts[model] = { total: 0, setup: 0 };
                    modelCounts[model].total++;

                    const equipKey = `${site}::${equip}`;
                    const detailData = setupData[equipKey];
                    if (detailData && detailData.setupDetails) {
                        const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                        if (completeItem && completeItem.startDate && !completeItem.completed) {
                            modelCounts[model].setup++;
                        }
                    }
                }
            });
        }
    });

    // 요약 정보 업데이트
    if (summaryEl) {
        const siteCount = Object.keys(siteCounts).length;
        const modelCount = allModels.size;
        summaryEl.textContent = `(사업장 : ${siteCount}, 장비 모델 : ${modelCount}, 장비수 : ${totalEquipCount})`;
    }

    // 1. 사업장 별 장비 현황 (이름순 정렬)
    const sortedSiteCounts = Object.entries(siteCounts)
        .sort(([a,], [b,]) => a.localeCompare(b))
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

    const siteGradients = {};
    Object.keys(sortedSiteCounts).forEach(key => siteGradients[key] = window.getSiteGradient(key));
    
    renderChartWithAxis(siteChartEl, sortedSiteCounts, siteGradients, (key) => {
        integEquipSelectedSite = (integEquipSelectedSite === key) ? null : key;
        renderIntegEquipStats(data);
    }, integEquipSelectedSite);

    // 2. 모델 별 장비 현황 (이름순 정렬)
    const sortedModelCounts = Object.entries(modelCounts)
        .sort(([a,], [b,]) => a.localeCompare(b))
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

    const modelColors = [
        'linear-gradient(to top, #1f6feb, #58a6ff)',
        'linear-gradient(to top, #238636, #3fb950)',
        'linear-gradient(to top, #d29922, #e3b341)',
        'linear-gradient(to top, #8957e5, #a371f7)',
        'linear-gradient(to top, #da3633, #ff7b72)',
        'linear-gradient(to top, #f0883e, #ffa657)',
        'linear-gradient(to top, #3fb950, #56d364)',
        'linear-gradient(to top, #a371f7, #bc8cff)'
    ];
    renderChartWithAxis(modelChartEl, sortedModelCounts, modelColors);
}

/* ==========================================================================
   3. 셋업 현황 섹션 (Setup Dashboard Section)
   ========================================================================== */
function renderIntegSetupBarChart(siteCounts, totalCount) {
    const chartEl = document.getElementById('integ-setup-site-bar-chart');
    if (!chartEl) return;

    chartEl.innerHTML = '';

    // 데이터 배열 생성 ('전체' 포함)
    const dataItems = [{ name: '전체', count: totalCount }];
    Object.keys(siteCounts).forEach(site => {
        dataItems.push({ name: site, count: siteCounts[site] });
    });
    
    // 정렬 (전체 제외하고 내림차순)
    const sortedSites = dataItems.slice(1).sort((a, b) => b.count - a.count);
    const finalData = [dataItems[0], ...sortedSites];

    // Y축 스케일 계산
    const maxVal = Math.max(...finalData.map(d => d.count));
    let yAxisMax = 10;
    if (maxVal > 10) yAxisMax = Math.ceil(maxVal / 5) * 5;

    finalData.forEach((item, index) => {
        const isTotal = item.name === '전체';
        const count = item.count;
        const maxBarHeight = 140;
        const barHeight = yAxisMax > 0 ? (count / yAxisMax) * maxBarHeight : 0;
        const bgStyle = window.getSiteGradient(item.name);

        const isActive = (integSetupSelectedSite === item.name) || (isTotal && !integSetupSelectedSite);
        const activeClass = isActive ? 'active' : '';

        const barGroup = document.createElement('div');
        barGroup.className = 'bar-group';
        if (integSetupSelectedSite && !isActive) barGroup.classList.add('faded');

        barGroup.innerHTML = `
            <div class="bar-value">${count}</div>
            <div class="bar ${activeClass}" style="height: ${barHeight}px; background: ${bgStyle};"></div>
            <div class="bar-label" title="${item.name}">${item.name}</div>
        `;

        barGroup.onclick = () => {
            integSetupSelectedSite = isTotal ? null : (integSetupSelectedSite === item.name ? null : item.name);
            updateIntegratedDashboard();
        };
        
        barGroup.style.cursor = 'pointer';
        chartEl.appendChild(barGroup);
    });
}

function renderIntegSetupSiteStats() {
    const chartEl = document.getElementById('integ-setup-site-chart');
    const centerText = document.getElementById('integ-setup-site-center');
    const completeChartEl = document.getElementById('integ-setup-complete-chart');
    const completeCenterText = document.getElementById('integ-setup-complete-center');
    const doneChartEl = document.getElementById('integ-setup-done-chart');
    const doneCenterText = document.getElementById('integ-setup-done-center');

    if (!chartEl) return;

    // 기간 필터 설정
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

        if (integSetupSelectedSite && site !== integSetupSelectedSite) return;

        if (data && data.setupDetails) {
            let hasActivity = false;
            const completeItem = data.setupDetails.find(d => d.content === '셋업 완료');
            
            if (completeItem && completeItem.startDate) {
                const firstItem = data.setupDetails.find(d => d.startDate);
                const setupStart = firstItem ? new Date(firstItem.startDate) : new Date(completeItem.startDate);

                if (completeItem.completed && completeItem.date) {
                    const setupEnd = new Date(completeItem.date);
                    if (setupStart <= targetEnd && setupEnd >= targetStart) hasActivity = true;
                } else {
                    if (setupStart <= targetEnd) hasActivity = true;
                }
            }

            if (hasActivity) {
                totalForRate++;
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

    // 1. 진행중 도넛 차트
    renderDonutChart(chartEl, centerText, siteCounts, activeCount, 'Active');

    // 2. 완료율 도넛 차트
    if (completeChartEl && completeCenterText) {
        if (totalForRate === 0) {
            completeChartEl.style.background = '';
            completeCenterText.innerHTML = `<div class="chart-center-label">Complete</div><div class="chart-center-value">0%</div>`;
        } else {
            const completeRate = (completedCount / totalForRate) * 100;
            const completeDeg = (completedCount / totalForRate) * 360;
            completeChartEl.style.background = `conic-gradient(#238636 0deg ${completeDeg}deg, #30363d ${completeDeg}deg 360deg)`;
            completeCenterText.innerHTML = `<div class="chart-center-label">Complete Rate</div><div class="chart-center-value">${Math.round(completeRate)}%</div>`;
        }
    }

    // 3. 완료(사업장별) 도넛 차트
    renderDonutChart(doneChartEl, doneCenterText, completedSiteCounts, completedCount, 'Done');
}

function renderDonutChart(chartEl, centerText, counts, total, label) {
    if (!chartEl) return;
    if (total === 0) {
        chartEl.style.background = '';
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">${label}</div><div class="chart-center-value">0</div>`;
    } else {
        let gradientStr = '';
        let currentDeg = 0;
        const sorted = Object.keys(counts).map(k => ({ name: k, count: counts[k] })).sort((a, b) => b.count - a.count);

        sorted.forEach((item) => {
            const color = window.getSiteColor(item.name);
            const deg = (item.count / total) * 360;
            gradientStr += `${color} ${currentDeg}deg ${currentDeg + deg}deg, `;
            currentDeg += deg;
        });

        chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">${label}</div><div class="chart-center-value">${total}</div>`;
    }
}

function renderIntegSetupList(list) {
    const listEl = document.getElementById('integ-setup-detail-list');
    const titleEl = document.getElementById('integ-setup-active-title');
    if (titleEl) titleEl.textContent = `셋업 진행 장비 (${list.length})`;

    if (!listEl) return;
    listEl.innerHTML = '';

    if (list.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">진행 중인 셋업이 없습니다.</li>';
        return;
    }

    list.sort((a, b) => b.progress - a.progress);

    list.forEach(item => {
        const parts = item.equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';
        const progressColor = item.progress === 100 ? '#238636' : '#1f6feb';

        const li = document.createElement('li');
        li.className = 'status-list-item';
        li.innerHTML = `
            <span class="status-color equip-bar" style="background-color: ${progressColor};"></span>
            <span class="status-name no-margin-right integ-setup-detail-col-name">
                ${escapeHtml(item.site)} > ${escapeHtml(name)} 
                ${serial ? `<span class="equip-serial">${escapeHtml(serial)}</span>` : ''}
            </span>
            <span class="status-count integ-setup-detail-col-progress">${item.progress}%</span>
        `;
        
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

function renderIntegCompletedList(list) {
    const listEl = document.getElementById('integ-setup-complete-list');
    const titleEl = document.getElementById('integ-setup-complete-title');
    if (titleEl) titleEl.textContent = `셋업 완료 장비 (${list.length})`;

    if (!listEl) return;
    listEl.innerHTML = '';

    if (list.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">완료된 장비 없음</li>';
        return;
    }

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

function toggleIntegSetupPeriodMode() {
    const type = document.getElementById('integ-setup-period-type').value;
    const monthInput = document.getElementById('integ-setup-month');
    const yearSelect = document.getElementById('integ-setup-year');
    const startInput = document.getElementById('integ-setup-start');
    const endInput = document.getElementById('integ-setup-end');
    const tilde = document.getElementById('integ-setup-tilde');
    const titleSpan = document.getElementById('integ-setup-title-period');

    // 모든 입력 숨김
    if (monthInput) monthInput.style.display = 'none';
    if (yearSelect) yearSelect.style.display = 'none';
    if (startInput) startInput.style.display = 'none';
    if (endInput) endInput.style.display = 'none';
    if (tilde) tilde.style.display = 'none';

    if (type === 'month') {
        if (monthInput) monthInput.style.display = 'inline-block';
        if (titleSpan) titleSpan.textContent = '월간';
    } else if (type === 'year') {
        if (yearSelect) yearSelect.style.display = 'inline-block';
        if (titleSpan) titleSpan.textContent = '연간';
    } else if (type === 'custom') {
        if (startInput) startInput.style.display = 'inline-block';
        if (endInput) endInput.style.display = 'inline-block';
        if (tilde) tilde.style.display = 'inline-block';
        if (titleSpan) titleSpan.textContent = '기간별';
    }
    
    updateIntegratedDashboard(); // [수정] 전체 대시보드 갱신
}

/* ==========================================================================
   4. 운영 관리 현황 섹션 (Maintenance Dashboard Section)
   ========================================================================== */
function renderIntegMaintStats(mainData) {
    if (!mainData) {
        mainData = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
    }

    const chartEl = document.getElementById('integ-maint-type-chart');
    const siteChartEl = document.getElementById('integ-maint-site-chart');
    const listEl = document.getElementById('integ-maint-item-list');
    const itemChartEl = document.getElementById('integ-maint-item-chart');
    const itemCenterText = document.getElementById('integ-maint-item-center');
    if (!chartEl || !listEl) return;

    // 기간 필터 확인
    const periodTypeEl = document.getElementById('integ-period-type');
    const periodType = periodTypeEl ? periodTypeEl.value : 'month';
    
    // [수정] 날짜 체크 함수 생성 (월간/연간/직접입력 지원)
    let dateCheckFn = null;

    if (periodType === 'year') {
        const yearSelect = document.getElementById('integ-maint-year');
        const targetPrefix = (yearSelect && yearSelect.value) ? yearSelect.value : new Date().getFullYear().toString();
        dateCheckFn = (d) => d && d.startsWith(targetPrefix);
    } else if (periodType === 'custom') {
        const startInput = document.getElementById('integ-maint-start');
        const endInput = document.getElementById('integ-maint-end');
        let targetStart, targetEnd;
        
        if (startInput && endInput && startInput.value && endInput.value) {
            targetStart = new Date(startInput.value);
            targetEnd = new Date(endInput.value);
            targetEnd.setHours(23, 59, 59, 999); // 종료일의 끝까지 포함
        }
        
        dateCheckFn = (d) => {
            if (!d || !targetStart || !targetEnd) return false;
            const itemDate = new Date(d);
            return itemDate >= targetStart && itemDate <= targetEnd;
        };
    } else {
        const monthPicker = document.getElementById('integ-maint-month');
        const targetPrefix = (monthPicker && monthPicker.value) ? monthPicker.value : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        dateCheckFn = (d) => d && d.startsWith(targetPrefix);
    }

    const typeCounts = {};
    const totalTypeCounts = {};
    const itemCounts = {};
    const siteCounts = {};

    // 데이터 집계
    Object.keys(mainData).forEach(site => {
        if (mainData[site]) {
            const isSiteMatch = !integSelectedSite || integSelectedSite === site;
            mainData[site].forEach(equip => {
                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key));
                if (!detailData) return;

                const processItem = (type, content, date) => {
                    if (dateCheckFn(date)) {
                        siteCounts[site] = (siteCounts[site] || 0) + 1;
                        
                        // 요약 정보용 전체 집계 (필터 무관)
                        totalTypeCounts[type] = (totalTypeCounts[type] || 0) + 1;

                        if (isSiteMatch) {
                            typeCounts[type] = (typeCounts[type] || 0) + 1;
                        }
                        const isTypeMatch = !integSelectedType || integSelectedType === type;
                        if (isSiteMatch && isTypeMatch && content) {
                            content.split(',').map(s => s.trim()).forEach(i => {
                                if (i) itemCounts[`${type}::${i}`] = (itemCounts[`${type}::${i}`] || 0) + 1;
                            });
                        }
                    }
                };

                if (detailData.maint) detailData.maint.forEach(i => processItem(i.type, i.content, i.scheduledDate));
                if (detailData.logs) detailData.logs.forEach(l => {
                    if (l.detailType !== '일정변경') processItem(l.type, l.content, l.date);
                });
            });
        }
    });

    // [추가] 운영 관리 요약 정보 업데이트
    const maintSummaryEl = document.getElementById('integ-maint-summary');
    if (maintSummaryEl) {
        const summaryStr = Object.entries(totalTypeCounts).map(([t, c]) => `${t} : ${c}`).join(', ');
        maintSummaryEl.textContent = `(${summaryStr})`;
    }

    // 1. 작업 유형별 차트
    const typeGradients = { 
        '정기': 'linear-gradient(to top, #238636, #3fb950)', 
        '비정기': 'linear-gradient(to top, #eb371f, #ff7b72)', 
        '고객대응': 'linear-gradient(to top, #d29922, #f0883e)', 
        '용액제조': 'linear-gradient(to top, #8957e5, #a371f7)',
        '온라인점검': 'linear-gradient(to top, #0078d4, #58a6ff)' 
    };
    renderChartWithAxis(chartEl, typeCounts, typeGradients, (key) => {
        integSelectedType = (integSelectedType === key) ? null : key;
        renderIntegMaintStats(mainData);
    }, integSelectedType);

    // 2. 사업장별 차트
    if (siteChartEl) {
        let totalSiteCount = 0;
        Object.values(siteCounts).forEach(count => totalSiteCount += count);
        const orderedSiteCounts = { '전체': totalSiteCount, ...siteCounts };
        const siteGradients = {};
        Object.keys(orderedSiteCounts).forEach(key => siteGradients[key] = window.getSiteGradient(key));

        renderChartWithAxis(siteChartEl, orderedSiteCounts, siteGradients, (key) => {
            integSelectedSite = (key === '전체' || integSelectedSite === key) ? null : key;
            integSelectedType = null;
            renderIntegMaintStats(mainData);
        }, integSelectedSite || '전체');
    }

    // 3. 점검 항목 리스트 & 도넛 차트
    renderMaintItemList(listEl, itemChartEl, itemCenterText, itemCounts);
}

function renderMaintItemList(listEl, chartEl, centerText, itemCounts) {
    listEl.innerHTML = '';
    const typeOrder = ['정기', '비정기', '고객대응', '용액제조', '온라인점검'];
    
    const sortedItems = Object.keys(itemCounts).map(key => {
        const parts = key.split('::');
        return { type: parts[0], name: parts.slice(1).join('::'), count: itemCounts[key] };
    }).sort((a, b) => {
        const idxA = typeOrder.indexOf(a.type);
        const idxB = typeOrder.indexOf(b.type);
        if (idxA !== idxB) return (idxA !== -1 && idxB !== -1) ? idxA - idxB : (idxA !== -1 ? -1 : 1);
        return b.count - a.count;
    });
    
    const totalItemCount = sortedItems.reduce((acc, item) => acc + item.count, 0);
    const colors = ['#1f6feb', '#238636', '#d29922', '#8957e5', '#da3633', '#f0883e', '#3fb950', '#a371f7'];
    let gradientStr = '';
    let currentDeg = 0;

    if (sortedItems.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">데이터 없음</li>';
        if (chartEl) chartEl.style.background = '';
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Items</div><div class="chart-center-value">0</div>`;
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

        if (chartEl && totalItemCount > 0) chartEl.style.background = `conic-gradient(${gradientStr.slice(0, -2)})`;
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Items</div><div class="chart-center-value">${totalItemCount}</div>`;
    }
}

function toggleIntegPeriodMode() {
    togglePeriodMode('integ-period-type', 'integ-maint-month', 'integ-maint-year', 'integ-title-period');
    renderIntegMaintStats();
}

/* ==========================================================================
   5. 헬퍼 함수 (Helpers)
   ========================================================================== */
function togglePeriodMode(typeId, monthId, yearId, titleId) {
    const type = document.getElementById(typeId).value;
    const monthInput = document.getElementById(monthId);
    const yearSelect = document.getElementById(yearId);
    // [추가] 운영 관리용 직접 입력 필드 ID 처리 (ID가 고정되어 있으므로 하드코딩 또는 인자로 확장 가능하나, 여기서는 ID 규칙에 따라 처리)
    const isMaint = typeId === 'integ-period-type';
    const startInput = document.getElementById(isMaint ? 'integ-maint-start' : 'integ-setup-start');
    const endInput = document.getElementById(isMaint ? 'integ-maint-end' : 'integ-setup-end');
    const tilde = document.getElementById(isMaint ? 'integ-maint-tilde' : 'integ-setup-tilde');
    const titleSpan = document.getElementById(titleId);

    // 모든 입력 숨김
    if (monthInput) monthInput.style.display = 'none';
    if (yearSelect) yearSelect.style.display = 'none';
    if (startInput) startInput.style.display = 'none';
    if (endInput) endInput.style.display = 'none';
    if (tilde) tilde.style.display = 'none';

    if (type === 'month') {
        if (monthInput) monthInput.style.display = 'inline-block';
        if (titleSpan) titleSpan.textContent = '월간';
    } else if (type === 'year') {
        if (yearSelect) yearSelect.style.display = 'inline-block';
        if (titleSpan) titleSpan.textContent = '연간';
    } else if (type === 'custom') {
        if (startInput) startInput.style.display = 'inline-block';
        if (endInput) endInput.style.display = 'inline-block';
        if (tilde) tilde.style.display = 'inline-block';
        if (titleSpan) titleSpan.textContent = '기간별';
    }
}

function renderChartWithAxis(container, dataCounts, colorMapOrArray, onClickHandler, selectedKey) {
    container.innerHTML = '';
    const values = Object.values(dataCounts).map(v => (typeof v === 'object' ? v.total : v));
    const maxVal = values.length > 0 ? Math.max(...values) : 0;
    let yAxisMax = 10;
    if (maxVal > 10) yAxisMax = Math.ceil(maxVal / 5) * 5;

    Object.keys(dataCounts).forEach((key, index) => {
        let count = dataCounts[key];
        let setupCount = 0;

        if (typeof count === 'object') {
            setupCount = count.setup || 0;
            count = count.total || 0;
        }

        const maxBarHeight = 180;
        const barHeight = yAxisMax > 0 ? (count / yAxisMax) * maxBarHeight : 0;
        
        let bgStyle = '#30363d';
        if (Array.isArray(colorMapOrArray)) bgStyle = colorMapOrArray[index % colorMapOrArray.length];
        else if (colorMapOrArray[key]) bgStyle = colorMapOrArray[key];
        
        const isActive = selectedKey === key;
        const activeClass = isActive ? 'active' : '';

        const barGroup = document.createElement('div');
        barGroup.className = 'bar-group';
        if (selectedKey && selectedKey !== '전체' && !isActive) barGroup.classList.add('faded');

        let barContent = '';
        if (setupCount > 0) {
            const setupHeightPct = (setupCount / count) * 100;
            const setupOverlay = `<div style="width: 100%; height: ${setupHeightPct}%; background: repeating-linear-gradient(45deg, rgba(255,255,255,0.3), rgba(255,255,255,0.3) 5px, transparent 5px, transparent 10px); border-bottom: 1px solid rgba(255,255,255,0.5); position: absolute; top: 0; left: 0;" title="셋업중: ${setupCount}대"></div>`;
            
            barContent = `
                <div class="bar-value">
                    ${count}
                    <span style="font-size:11px; color:#d29922; margin-left:2px;">(${setupCount})</span>
                </div>
                <div class="bar ${activeClass}" style="height: ${barHeight}px; background: ${bgStyle}; position: relative; overflow: hidden;">
                    ${setupOverlay}
                </div>
            `;
        } else {
            barContent = `
                <div class="bar-value">${count}</div>
                <div class="bar ${activeClass}" style="height: ${barHeight}px; background: ${bgStyle};"></div>
            `;
        }

        barGroup.innerHTML = `
            ${barContent}
            <div class="bar-label" title="${key}">${key}</div>
        `;
        
        if (onClickHandler) {
            barGroup.onclick = () => onClickHandler(key);
            barGroup.style.cursor = 'pointer';
        }
        container.appendChild(barGroup);
    });
}

// HTML 이스케이프 유틸리티 (중복 방지)
if (typeof escapeHtml !== 'function') {
    function escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
}
