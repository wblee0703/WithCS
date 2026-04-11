/* ==========================================================================
   1. 전역 변수 및 초기화 (Global State)
   ========================================================================== */
let integEquipSelectedGroup = null;
let integSetupSelectedSite = null;
let integSelectedSite = null;
let integSelectedType = null;

// [추가] 통합 관리 대시보드 HTML 템플릿 동적 주입 (HTML 파일 직접 수정 없이 자동 적용)
(function injectIntegTemplates() {
    if (!document.getElementById('integ-basic-bar-template')) {
        const t1 = document.createElement('template');
        t1.id = 'integ-basic-bar-template';
        t1.innerHTML = `
            <div class="bar-group integ-bar-group">
                <div class="bar-value integ-bar-value"></div>
                <div class="bar integ-bar"></div>
                <div class="bar-label integ-bar-label"></div>
            </div>
        `;
        document.body.appendChild(t1);
    }
    if (!document.getElementById('integ-md-bar-template')) {
        const t2 = document.createElement('template');
        t2.id = 'integ-md-bar-template';
        t2.innerHTML = `
            <div class="bar-group integ-bar-group">
                <div class="bar-value integ-bar-value"></div>
                <div class="integ-bar-wrapper">
                    <div class="bar-total integ-bar-total"></div>
                    <div class="bar integ-bar"></div>
                </div>
                <div class="bar-label integ-bar-label"></div>
            </div>
        `;
        document.body.appendChild(t2);
    }
})();

// 전역 함수 노출
window.updateIntegratedDashboard = updateIntegratedDashboard;
window.toggleIntegSetupPeriodMode = toggleIntegSetupPeriodMode;
window.renderIntegSetupSiteStats = renderIntegSetupSiteStats;
window.renderIntegMaintStats = renderIntegMaintStats;
window.toggleIntegPeriodMode = toggleIntegPeriodMode;

/* ==========================================================================
   2. 메인 업데이트 로직 (Main Update Logic)
   ========================================================================== */
function updateIntegratedDashboard() {
    try {
        // 기간 컨트롤이 비어있을 경우 초기화
        if (!document.getElementById('integ-setup-month').value) {
            initDateControls();
        }

        // 데이터 로드
        let rawData = JSON.parse(localStorage.getItem('device_data')) || {};
        let data = (typeof getDashboardData === 'function') ? getDashboardData() : (rawData.equipments || rawData);
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

        let setupCount = 0;
        let setupEquips = [];
        let completedEquips = [];
        let summaryActiveCount = 0;
        let summaryCompletedCount = 0;

        const allSiteCounts = {};
        let totalActiveAll = 0;

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
        } else if (periodType === 'custom') {
            const startInput = document.getElementById('integ-setup-start');
            const endInput = document.getElementById('integ-setup-end');
            if (startInput && endInput && startInput.value && endInput.value) {
                const [sy, sm, sd] = startInput.value.split('-').map(Number);
                const [ey, em, ed] = endInput.value.split('-').map(Number);
                targetStart = new Date(sy, sm - 1, sd);
                targetEnd = new Date(ey, em - 1, ed, 23, 59, 59);
            } else {
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
            if (data[site] && Array.isArray(data[site])) {
                data[site].forEach(equip => {
                    const equipKey = `${site}::${equip}`;
                    const detailData = setupData[equipKey];

                    let isSetup = false;
                    let progress = 0;
                    let completionDate = "";

                    // 셋업 기간 필터링 검사
                    if (detailData && detailData.setupDetails && detailData.setupDetails.length > 0) {
                        const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                        if (completeItem && completeItem.startDate) {
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
                        
                        // 막대그래프용 데이터 (완료 포함)
                        allSiteCounts[site] = (allSiteCounts[site] || 0) + 1;
                        totalActiveAll++;

                        if (progress === 100) {
                            summaryCompletedCount++;
                        } else {
                            summaryActiveCount++;
                        }

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

        // 셋업 요약 텍스트 업데이트
        const setupSummaryEl = document.getElementById('integ-setup-summary');
        if (setupSummaryEl) {
            setupSummaryEl.textContent = `(전체 : ${setupCount}, 진행중 : ${summaryActiveCount}, 완료 : ${summaryCompletedCount})`;
        }

        // [1단계 복구] 장비 통합 현황 렌더링
        renderIntegEquipStats(data);
        
        // [2단계 복구] 셋업 현황 렌더링
        renderIntegSetupBarChart(allSiteCounts, totalActiveAll);
        renderIntegSetupSiteStats();
        renderIntegSetupList(setupEquips);
        renderIntegCompletedList(completedEquips);

        // [3단계 복구] 운영 현황 렌더링
        renderIntegMaintStats(data);
    } catch (error) {
        console.error("Integrated Dashboard Rendering Error:", error);
    }
}

function initDateControls() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const startDate = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(currentYear, now.getMonth() + 1, 0).getDate();
    const endDate = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // 월간/연간/사용자지정 입력창 초기화
    ['integ-setup-month', 'integ-maint-month'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = currentMonth;
    });

    ['integ-setup-year', 'integ-maint-year'].forEach(id => {
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

    const startInput = document.getElementById('integ-setup-start');
    const endInput = document.getElementById('integ-setup-end');
    const maintStart = document.getElementById('integ-maint-start');
    const maintEnd = document.getElementById('integ-maint-end');
    if (startInput && !startInput.value) startInput.value = startDate;
    if (endInput && !endInput.value) endInput.value = endDate;
    if (maintStart && !maintStart.value) maintStart.value = startDate;
    if (maintEnd && !maintEnd.value) maintEnd.value = endDate;
}

/* ==========================================================================
   3. 장비 통합 현황 섹션 (Equipment Integration Section)
   ========================================================================== */
function renderIntegEquipStats(data) {
    const siteChartEl = document.getElementById('integ-equip-site-chart');
    const modelChartEl = document.getElementById('integ-equip-model-chart');
    const summaryEl = document.getElementById('integ-equip-summary');
    
    if (!siteChartEl || !modelChartEl) return;

    const groupCounts = { 'SKH 이천': 0, 'SKH 청주': 0, 'SEC': 0, '기타 사업장': 0 };
    const modelCounts = {};
    const allModels = new Set();
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    let totalEquipCount = 0;
    let actualSiteCount = 0;

    // 데이터 집계
    Object.keys(data).forEach(site => {
        if (data[site] && Array.isArray(data[site]) && data[site].length > 0) {
            actualSiteCount++;
            
            let groupName = typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타 사업장';
            if (groupCounts[groupName] === undefined) groupCounts[groupName] = 0;

            groupCounts[groupName] += data[site].length;

            data[site].forEach(equip => {
                totalEquipCount++;
                const model = equip.split('::')[0]; // 장비명(모델) 추출
                allModels.add(model);
                
                // 그룹(사업장) 기반으로 모델 필터링 적용
                if (!integEquipSelectedGroup || integEquipSelectedGroup === groupName) {
                    if (!modelCounts[model]) modelCounts[model] = { total: 0, setup: 0 };
                    modelCounts[model].total++;

                    // 셋업 중인 장비 개수 파악
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

    // 요약 정보 텍스트 갱신
    if (summaryEl) {
        const modelCount = allModels.size;
        summaryEl.textContent = `(사업장 : ${actualSiteCount}, 장비 모델 : ${modelCount}, 장비수 : ${totalEquipCount})`;
    }

    // 1. 그룹 별 장비 현황 차트 렌더링 (장비 수 내림차순 정렬)
    const sortedGroupCounts = Object.entries(groupCounts)
        .sort(([, a], [, b]) => b - a)
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

    const groupGradients = {
        'SKH 이천': 'linear-gradient(to top, #1f6feb, #58a6ff)',
        'SKH 청주': 'linear-gradient(to top, #238636, #3fb950)',
        'SEC': 'linear-gradient(to top, #d29922, #e3b341)',
        '기타 사업장': 'linear-gradient(to top, #8957e5, #a371f7)'
    };
    
    renderChartWithAxis(siteChartEl, sortedGroupCounts, groupGradients, (key) => {
        integEquipSelectedGroup = (integEquipSelectedGroup === key) ? null : key;
        renderIntegEquipStats(data);
    }, integEquipSelectedGroup);

    // 2. 모델 별 장비 현황 차트 렌더링 (장비 수 내림차순 정렬)
    const sortedModelCounts = Object.entries(modelCounts)
        .sort(([, a], [, b]) => b.total - a.total)
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
   4. 셋업 현황 섹션 (Setup Dashboard Section)
   ========================================================================== */
function renderIntegSetupBarChart(siteCounts, totalCount) {
    const chartEl = document.getElementById('integ-setup-site-bar-chart');
    if (!chartEl) return;
    chartEl.innerHTML = '';

    const dataItems = [{ name: '전체', count: totalCount }];
    Object.keys(siteCounts).forEach(site => {
        dataItems.push({ name: site, count: siteCounts[site] });
    });
    
    const sortedSites = dataItems.slice(1).sort((a, b) => b.count - a.count);
    const finalData = [dataItems[0], ...sortedSites];

    const maxVal = Math.max(...finalData.map(d => d.count));
    let yAxisMax = 10;
    if (maxVal > 10) yAxisMax = Math.ceil(maxVal / 5) * 5;

    finalData.forEach((item, index) => {
        const isTotal = item.name === '전체';
        const count = item.count;
        const maxBarHeight = 140;
        const barHeight = yAxisMax > 0 ? (count / yAxisMax) * maxBarHeight : 0;
        const bgStyle = window.getSiteGradient ? window.getSiteGradient(item.name) : '#8957e5';

        const isActive = (integSetupSelectedSite === item.name) || (isTotal && !integSetupSelectedSite);
        const activeClass = isActive ? 'active' : '';

        const barGroup = document.createElement('div');
        barGroup.className = 'bar-group integ-bar-group';
        if (integSetupSelectedSite && !isActive) barGroup.classList.add('faded');

        const tpl = typeof window.getTemplateContent === 'function' ? window.getTemplateContent('integ-basic-bar-template') : null;
        if (tpl) {
            barGroup.innerHTML = tpl.querySelector('.bar-group').innerHTML;
            barGroup.querySelector('.bar-value').innerHTML = count;
            const bar = barGroup.querySelector('.bar');
            if (activeClass) bar.classList.add(activeClass);
            bar.style.height = `${barHeight}px`;
            bar.style.background = bgStyle;
            const barLabel = barGroup.querySelector('.bar-label');
            barLabel.textContent = item.name;
            barLabel.title = item.name;
        }

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

    renderDonutChart(chartEl, centerText, siteCounts, activeCount, 'Active');

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
            const color = window.getSiteColor ? window.getSiteColor(item.name) : '#1f6feb';
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
    renderGenericSetupList(listEl, list, false);
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
    renderGenericSetupList(listEl, list, true);
}

function toggleIntegSetupPeriodMode() {
    const type = document.getElementById('integ-setup-period-type').value;
    const elements = {
        'month': document.getElementById('integ-setup-month'),
        'year': document.getElementById('integ-setup-year'),
        'custom': [document.getElementById('integ-setup-start'), document.getElementById('integ-setup-end'), document.getElementById('integ-setup-tilde')]
    };

    Object.values(elements).flat().forEach(el => { if (el) el.style.display = 'none'; });

    if (type === 'month') elements['month'].style.display = 'inline-block';
    else if (type === 'year') elements['year'].style.display = 'inline-block';
    else if (type === 'custom') elements['custom'].forEach(el => el.style.display = 'inline-block');

    document.getElementById('integ-setup-title-period').textContent = type === 'month' ? '월간' : (type === 'year' ? '연간' : '기간별');
    updateIntegratedDashboard();
}

/* ==========================================================================
   5. 운영 관리 현황 섹션 (Maintenance Dashboard Section)
   ========================================================================== */
async function renderIntegMaintStats(mainData) {
    if (!mainData || Object.keys(mainData).length === 0) {
        let rawData = JSON.parse(localStorage.getItem('device_data')) || {};
        mainData = (typeof getDashboardData === 'function') ? getDashboardData() : (rawData.equipments || rawData);
    }

    const progressChartEl = document.getElementById('integ-maint-site-chart');
    const mdChartEl = document.getElementById('integ-maint-type-chart');
    
    const listEl = document.getElementById('integ-maint-item-list-container');
    const itemChartEl = document.getElementById('integ-maint-item-chart-row');
    if (listEl) listEl.style.display = 'none';
    if (itemChartEl) itemChartEl.style.display = 'none';
    
    if (progressChartEl) {
        const siteTitleEl = progressChartEl.closest('.status-group').querySelector('.status-group-title');
        if (siteTitleEl) siteTitleEl.textContent = '사업장별 작업 진행률';
    }
    
    if (mdChartEl) {
        const typeTitleEl = mdChartEl.closest('.status-group').querySelector('.status-group-title');
        if (typeTitleEl) typeTitleEl.textContent = '사업장별 공수(M/D) 현황';
    }

    // [수정] 중복되는 인라인 스타일을 모두 제거하고, 안전한 래퍼 생성 및 1:2 비율만 심플하게 적용
    if (progressChartEl && mdChartEl) {
        const pGroup = progressChartEl.closest('.status-group');
        const mGroup = mdChartEl.closest('.status-group');
        if (pGroup && mGroup) {
            if (!pGroup.parentElement.classList.contains('integ-maint-charts-row')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'integ-maint-charts-row';
                pGroup.parentElement.insertBefore(wrapper, pGroup);
                wrapper.appendChild(pGroup);
                wrapper.appendChild(mGroup);
            }
            
            // CSS(.integ-maint-charts-row)에 의존하여 가로 배치 후, 너비를 정확히 50%씩(1:1 비율) 부여
            pGroup.style.flex = '1';
            mGroup.style.flex = '1';
        }
    }

    const periodTypeEl = document.getElementById('integ-period-type');
    const periodType = periodTypeEl ? periodTypeEl.value : 'month';
    
    let dateCheckFn = null;
    let targetStart = null;
    let targetEnd = null;

    if (periodType === 'year') {
        const yearSelect = document.getElementById('integ-maint-year');
        const targetPrefix = (yearSelect && yearSelect.value) ? yearSelect.value : new Date().getFullYear().toString();
        dateCheckFn = (d) => d && d.startsWith(targetPrefix);
        targetStart = new Date(targetPrefix, 0, 1);
        targetEnd = new Date(targetPrefix, 11, 31, 23, 59, 59);
    } else if (periodType === 'custom') {
        const startInput = document.getElementById('integ-maint-start');
        const endInput = document.getElementById('integ-maint-end');
        
        if (startInput && endInput && startInput.value && endInput.value) {
            targetStart = new Date(startInput.value);
            targetEnd = new Date(endInput.value);
            targetEnd.setHours(23, 59, 59, 999);
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
        const [y, m] = targetPrefix.split('-').map(Number);
        targetStart = new Date(y, m - 1, 1);
        targetEnd = new Date(y, m, 0, 23, 59, 59);
    }

    // [추가] 해당 월(기간)의 평일(월~금) 일수 계산
    let workingDays = 0;
    if (targetStart && targetEnd) {
        let tempDate = new Date(targetStart);
        tempDate.setHours(0,0,0,0);
        while (tempDate <= targetEnd) {
            const day = tempDate.getDay();
            if (day !== 0 && day !== 6) workingDays++;
            tempDate.setDate(tempDate.getDate() + 1);
        }
    }

    // [수정] 캐시를 무시하고 최신 계정 데이터를 직접 호출하여 관리자 여부 누락 방지
    let workers = [];
    try {
        // 브라우저의 강력 캐시를 완벽히 회피하기 위해 타임스탬프 파라미터 추가
        const res = await fetch('/api/users/names?t=' + new Date().getTime(), { cache: 'no-store' });
        if (res.ok) {
            const wData = await res.json();
            workers = wData.workers || wData.names || [];
        }
    } catch (e) { console.error(e); }

    const siteWorkerCounts = { 'SKH 청주': 0, 'SKH 이천': 0, 'SEC': 0, '기타 사업장': 0 };
    const adminNames = new Set(); // [추가] 실제 작업 공수에서 관리자를 제외하기 위한 명단

    workers.forEach(w => {
        if (typeof w === 'object' && w !== null) {
            // [강화] 권한(role)뿐만 아니라 직급/소속에 '관리자'라는 단어가 포함되어 있어도 제외하도록 이중 안전장치 추가
            const roleStr = (w.role || '').trim().toLowerCase();
            const posStr = (w.position || '').trim();
            const deptStr = (w.department || '').trim();
            
            if (roleStr === 'admin' || roleStr === 'superadmin' || posStr.includes('관리자') || deptStr.includes('관리자')) {
                adminNames.add(w.name); // 관리자 이름 기록
                return; // 총 공수(모수) 계산 인원수에서 제외
            }
        }
        
        const wSite = (typeof w === 'object' && w !== null) ? (w.site || '기타 사업장') : '기타 사업장';
        let groupName = typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(wSite) : '기타 사업장';
        if (siteWorkerCounts[groupName] !== undefined) siteWorkerCounts[groupName]++;
        else siteWorkerCounts['기타 사업장']++;
    });

    // [디버깅용] 브라우저 개발자 도구(F12) 콘솔창에서 계산에서 제외된 관리자 명단과 최종 인원수를 명확히 확인
    console.log("✅ 총 공수에서 제외된 관리자 명단:", Array.from(adminNames));
    console.log("✅ 사업장별 실제 계산에 포함된 인원수:", siteWorkerCounts);

    // [추가] 실제 작업(M/D)에서 관리자의 지분을 제외하는 계산 함수
    const calcValidMd = (workerStr, mdVal) => {
        if (!workerStr || !mdVal) return mdVal;
        const workerList = workerStr.split(',').map(s => s.trim()).filter(Boolean);
        if (workerList.length === 0) return mdVal;
        
        const adminCount = workerList.filter(name => adminNames.has(name)).length;
        if (adminCount === 0) return mdVal; // 관리자가 없으면 그대로 반환
        
        // 전체 작업자 중 관리자 비율만큼 M/D를 차감 (예: 2명 중 1명이 관리자면 M/D의 50%만 반영)
        const validRatio = (workerList.length - adminCount) / workerList.length;
        return mdVal * validRatio;
    };

    const groupStats = {
        'SKH 청주': { total: 0, completed: 0, md: 0, totalMd: workingDays * siteWorkerCounts['SKH 청주'] },
        'SKH 이천': { total: 0, completed: 0, md: 0, totalMd: workingDays * siteWorkerCounts['SKH 이천'] },
        'SEC': { total: 0, completed: 0, md: 0, totalMd: workingDays * siteWorkerCounts['SEC'] },
        '기타 사업장': { total: 0, completed: 0, md: 0, totalMd: workingDays * siteWorkerCounts['기타 사업장'] }
    };

    Object.keys(mainData).forEach(site => {
        if (mainData[site] && Array.isArray(mainData[site])) {
            let groupName = typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타 사업장';
            if (!groupStats[groupName]) groupStats[groupName] = { total: 0, completed: 0, md: 0 };

            mainData[site].forEach(equip => {
                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key));
                if (!detailData) return;

                const completedKeys = new Set();

                if (detailData.logs) {
                    detailData.logs.forEach(l => {
                        if (l.detailType !== '일정변경' && dateCheckFn(l.date)) {
                            if (l.content && l.content.startsWith('[변경]')) return;
                            
                            groupStats[groupName].total++;
                            groupStats[groupName].completed++;
                            const mdVal = parseFloat(l.md) || 0;
                            // [수정] 실제 공수 합산 시 관리자의 기여분(M/D) 제외
                            groupStats[groupName].md += calcValidMd(l.worker, mdVal);
                            
                            const taskKey = `${l.date}_${l.content}_${l.originalLogId || ''}`;
                            completedKeys.add(taskKey);
                        }
                    });
                }

                if (detailData.maint) {
                    detailData.maint.forEach(m => {
                        if (dateCheckFn(m.scheduledDate)) {
                            const taskKey = `${m.scheduledDate}_${m.content}_${m.originalLogId || ''}`;
                            if (completedKeys.has(taskKey)) return; 
                            
                            groupStats[groupName].total++;
                            const mdVal = parseFloat(m.md) || 0;
                            // [수정] 예정 공수 합산 시 관리자의 기여분(M/D) 제외
                            groupStats[groupName].md += calcValidMd(m.worker, mdVal);
                        }
                    });
                }
            });
        }
    });

    const groups = ['SEC', 'SKH 이천', 'SKH 청주', '기타 사업장'];
    const groupColors = {
        'SEC': 'linear-gradient(to top, #034EA2, #4a8eff)',
        'SKH 이천': 'linear-gradient(to top, #F37021, #ff9e66)',
        'SKH 청주': 'linear-gradient(to top, #F37021, #ff9e66)',
        '기타 사업장': 'linear-gradient(to top, #8957e5, #a371f7)'
    };

    if (progressChartEl) {
        progressChartEl.innerHTML = '';
        progressChartEl.classList.add('integ-bar-chart-container');
        const yAxisMax = 100;

        groups.forEach(group => {
            const stats = groupStats[group];
            const rate = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100);
            
            const barGroup = document.createElement('div');
            barGroup.className = 'bar-group integ-bar-group';
            
            const maxBarHeight = 180;
            const barHeight = (rate / yAxisMax) * maxBarHeight;
            const bgStyle = groupColors[group];

            const tpl = typeof window.getTemplateContent === 'function' ? window.getTemplateContent('integ-basic-bar-template') : null;
            if (tpl) {
                barGroup.innerHTML = tpl.querySelector('.bar-group').innerHTML;
                barGroup.querySelector('.bar-value').innerHTML = `${rate}% <span>(${stats.completed}/${stats.total})</span>`;
                const bar = barGroup.querySelector('.bar');
                bar.style.height = `${barHeight}px`;
                bar.style.background = bgStyle;
                const barLabel = barGroup.querySelector('.bar-label');
                barLabel.textContent = group;
                barLabel.title = group;
                progressChartEl.appendChild(barGroup);
            }
        });
    }

    if (mdChartEl) {
        mdChartEl.innerHTML = '';
        mdChartEl.classList.add('integ-bar-chart-container');
        
        const yAxisMax = 100;

        groups.forEach(group => {
            const stats = groupStats[group];
            const mdVal = Number.isInteger(stats.md) ? stats.md : stats.md.toFixed(1);
            const mdRate = stats.totalMd === 0 ? 0 : Math.round((stats.md / stats.totalMd) * 100);
            
            const barGroup = document.createElement('div');
            barGroup.className = 'bar-group integ-bar-group';
            
            const maxBarHeight = 180;
            const barHeight = Math.min((mdRate / yAxisMax) * maxBarHeight, maxBarHeight);
            const bgStyle = groupColors[group];

            const tpl = typeof window.getTemplateContent === 'function' ? window.getTemplateContent('integ-basic-bar-template') : null;
            if (tpl) {
                barGroup.innerHTML = tpl.querySelector('.bar-group').innerHTML;
                barGroup.querySelector('.bar-value').innerHTML = `${mdRate}% <span>(${mdVal}/${stats.totalMd})</span>`;
                const bar = barGroup.querySelector('.bar');
                bar.style.height = `${barHeight}px`;
                bar.style.background = bgStyle;
                bar.title = `실제 공수: ${mdVal} / 총 공수: ${stats.totalMd}`;
                const barLabel = barGroup.querySelector('.bar-label');
                barLabel.textContent = group;
                barLabel.title = group;
                mdChartEl.appendChild(barGroup);
            }
        });
    }
    
    const maintSummaryEl = document.getElementById('integ-maint-summary');
    if (maintSummaryEl) {
        maintSummaryEl.textContent = '';
    }
}

function toggleIntegPeriodMode() {
    const type = document.getElementById('integ-period-type').value;
    const elements = {
        'month': document.getElementById('integ-maint-month'),
        'year': document.getElementById('integ-maint-year'),
        'custom': [document.getElementById('integ-maint-start'), document.getElementById('integ-maint-end'), document.getElementById('integ-maint-tilde')]
    };

    Object.values(elements).flat().forEach(el => { if (el) el.style.display = 'none'; });

    if (type === 'month') elements['month'].style.display = 'inline-block';
    else if (type === 'year') elements['year'].style.display = 'inline-block';
    else if (type === 'custom') elements['custom'].forEach(el => el.style.display = 'inline-block');

    document.getElementById('integ-title-period').textContent = type === 'month' ? '월간' : (type === 'year' ? '연간' : '기간별');
    renderIntegMaintStats();
}

/* ==========================================================================
   6. 헬퍼 함수 (Helpers)
   ========================================================================== */
// 차트를 그려주는 공통 함수
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
            // 셋업 중인 장비가 있으면 막대 안에 투명도(빗금) 패턴으로 표시해줍니다.
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

function renderGenericSetupList(listEl, list, isCompletedMode) {
    list.forEach(item => {
        const parts = item.equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';
        const progressColor = item.progress === 100 ? '#238636' : '#1f6feb';
        
        const detailData = JSON.parse(localStorage.getItem(`details_${item.site}_${item.equip}`)) || {};
        const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

        const li = document.createElement('li');
        li.className = 'status-list-item';
        
        let subInfo = '';
        if (custEquipName) subInfo = `[${escapeHtml(custEquipName)}]`;
        else if (serial) subInfo = `[${escapeHtml(serial)}]`;

        const mainInfo = `${escapeHtml(item.site)} > ${escapeHtml(name)}`;
        const fullTitle = `${mainInfo} ${subInfo}`.replace(/<[^>]*>?/gm, '').trim();

        const rightCol = isCompletedMode ? 
            `<span class="status-count integ-setup-complete-col-date">${item.date || ''}</span>` : 
            `<span class="status-count integ-setup-detail-col-progress">${item.progress}%</span>`;

        li.innerHTML = `
            <span class="status-color equip-bar" style="background-color: ${progressColor};"></span>
            <div style="flex: 1; display: flex; align-items: center; min-width: 0;">
                <span class="status-name ${isCompletedMode ? 'integ-setup-complete-col-name' : 'integ-setup-detail-col-name'}" title="${fullTitle}" style="margin-right: 0;">${mainInfo}${subInfo ? `<span class="equip-serial">${subInfo}</span>` : ''}</span>
            </div>
            ${rightCol}
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