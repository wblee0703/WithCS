/* ==========================================================================
   1. 초기화 (Initialization)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    if (window.isDataLoaded) {
        initSortPage();
    } else {
        window.addEventListener('DataLoaded', initSortPage);
    }
});

function initSortPage() {
    setupSortFilters();
    setupSortEvents();
    setupSortResizer();

    // 초기 로드 시 '연간' 기준으로 전체 데이터 자동 검색 실행
    const periodType = document.getElementById('sort-period-type');
    if (periodType) {
        periodType.value = 'year';
        periodType.dispatchEvent(new Event('change'));
    }
    setTimeout(performSortSearch, 50);
}

function setupSortResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.dashboard-sidebar');
    if (resizer && sidebar) {
        let isResizing = false;
        resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.cursor = 'col-resize'; resizer.classList.add('resizing'); });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX - sidebar.getBoundingClientRect().left;
            if (newWidth > 200 && newWidth < 600) sidebar.style.width = `${newWidth}px`;
        });
        document.addEventListener('mouseup', () => { isResizing = false; document.body.style.cursor = 'default'; resizer.classList.remove('resizing'); });
    }
}

/* ==========================================================================
   2. 필터 설정 (Filters Setup)
   ========================================================================== */
function setupSortFilters() {
    const siteSelect = document.getElementById('sort-site-select');
    const buildingSelect = document.getElementById('sort-building-select');
    const modelSelect = document.getElementById('sort-model-select');
    const equipSelect = document.getElementById('sort-equip-select');
    const typeSelect = document.getElementById('sort-type-select');
    const detailTypeSelect = document.getElementById('sort-detail-type-select');
    
    if (!siteSelect) return;

    let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    let data = (typeof storageData !== 'undefined' && Object.keys(storageData).length > 0) ? storageData : deviceData;
    if (data.equipments) data = data.equipments;

    siteSelect.innerHTML = '<option value="">전체 사업장</option>';
    Object.keys(data).sort().forEach(site => {
        const opt = document.createElement('option');
        opt.value = site;
        opt.textContent = site;
        siteSelect.appendChild(opt);
    });

    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    if (modelSelect) {
        modelSelect.innerHTML = '<option value="">전체 모델</option>';
        equipmentModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = m.name;
            modelSelect.appendChild(opt);
        });
        modelSelect.addEventListener('change', (e) => {
            updateSortEquipSelect(siteSelect.value, buildingSelect ? buildingSelect.value : '', e.target.value, data);
        });
    }

    siteSelect.addEventListener('change', (e) => {
        const site = e.target.value;
        updateSortBuildingSelect(site);
        updateSortEquipSelect(site, '', modelSelect ? modelSelect.value : '', data);
    });
    
    if (buildingSelect) {
        buildingSelect.addEventListener('change', (e) => {
            updateSortEquipSelect(siteSelect.value, e.target.value, modelSelect ? modelSelect.value : '', data);
        });
    }
    
    if (typeSelect) {
        typeSelect.addEventListener('change', updateSortDetailTypeSelect);
    }
    if (detailTypeSelect) {
        detailTypeSelect.addEventListener('change', updateSortDetailType2Select);
    }
    
    // 기간 설정 로직
    const periodType = document.getElementById('sort-period-type');
    const monthInput = document.getElementById('sort-month-input');
    const yearInput = document.getElementById('sort-year-input');
    const customInput = document.getElementById('sort-custom-input');
    const startDateInput = document.getElementById('sort-start-date');
    const endDateInput = document.getElementById('sort-end-date');

    const currentYear = new Date().getFullYear();
    if (yearInput) {
        for (let y = currentYear; y >= currentYear - 5; y--) {
            yearInput.insertAdjacentHTML('beforeend', `<option value="${y}">${y}년</option>`);
        }
    }

    const today = new Date();
    if (monthInput) monthInput.value = `${currentYear}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    if (startDateInput && endDateInput) {
        const lastMonth = new Date();
        lastMonth.setMonth(today.getMonth() - 1);
        startDateInput.value = lastMonth.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];
    }

    if (periodType) {
        periodType.addEventListener('change', (e) => {
            if (monthInput) monthInput.style.display = 'none';
            if (yearInput) yearInput.style.display = 'none';
            if (customInput) customInput.style.display = 'none';
            
            if (e.target.value === 'month') { if (monthInput) monthInput.style.display = 'block'; }
            else if (e.target.value === 'year') { if (yearInput) yearInput.style.display = 'block'; }
            else { if (customInput) customInput.style.display = 'flex'; }
        });
    }
}

function updateSortBuildingSelect(site) {
    const buildingSelect = document.getElementById('sort-building-select');
    buildingSelect.innerHTML = '<option value="">전체 건물</option>';
    if (!site) {
        buildingSelect.disabled = true;
        return;
    }
    const metaData = JSON.parse(localStorage.getItem(`site_meta_${site}`)) || {};
    const buildings = metaData.buildings || [];
    buildings.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        buildingSelect.appendChild(opt);
    });
    buildingSelect.disabled = false;
}

function updateSortEquipSelect(site, building, model, data) {
    const equipSelect = document.getElementById('sort-equip-select');
    equipSelect.innerHTML = '<option value="">전체 장비</option>';
    
    // 사업장이 선택되지 않았더라도 전체 장비 목록을 로드할지 결정 (일단 사업장이 있어야 하위 장비 로드)
    if (!site || !data[site]) return;
    
    // 장비 모델 약어 매핑 (ADMIN 정보 연동)
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    data[site].forEach(equip => {
        const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
        const setup = detailData.setup || {};
        
        if (building && setup.building !== building) return;

        const opt = document.createElement('option');
        opt.value = equip;
        const parts = equip.split('::');
        const equipName = parts[0];
        if (model && equipName !== model) return;
        
        const serialNo = parts.length > 1 ? parts[1] : '';
        
        const matchedModel = equipmentModels.find(m => m.name === equipName);
        const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;

        const custEquipName = setup.custEquipName || '';
        let displayText = displayName;
        if (custEquipName) displayText += ` [${custEquipName}]`;
        if (serialNo) displayText += ` (${serialNo})`;

        opt.textContent = displayText;
        equipSelect.appendChild(opt);
    });
}

function updateSortDetailTypeSelect() {
    const typeSelect = document.getElementById('sort-type-select');
    const detailTypeSelect = document.getElementById('sort-detail-type-select');
    const type = typeSelect.value;
    
    detailTypeSelect.innerHTML = '<option value="">전체 세부 구분</option>';
    
    if (!type) {
        detailTypeSelect.disabled = true;
        updateSortDetailType2Select();
        return;
    }
    detailTypeSelect.disabled = false;
    
    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    let subCategories = [];
    Object.keys(catData).forEach(key => {
        if (key.endsWith(`::${type}`)) {
            catData[key].forEach(cat => { if (!subCategories.includes(cat)) subCategories.push(cat); });
        }
    });

    subCategories.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        detailTypeSelect.appendChild(opt);
    });
    updateSortDetailType2Select();
}

function updateSortDetailType2Select() {
    const typeSelect = document.getElementById('sort-type-select');
    const detailTypeSelect = document.getElementById('sort-detail-type-select');
    const detailType2Group = document.getElementById('sort-detail-type2-group');
    const detailType2Select = document.getElementById('sort-detail-type2-select');
    
    const type = typeSelect.value;
    const detailType = detailTypeSelect.value;
    
    detailType2Select.innerHTML = '<option value="">전체 세부 구분 2</option>';
    
    if (type !== '비정기') {
        detailType2Group.style.display = 'none';
        return;
    }
    detailType2Group.style.display = 'block';
    if (!detailType) return;
    
    const catData2 = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
    let subCategories2 = [];
    Object.keys(catData2).forEach(key => {
        if (key.includes(`::${type}::${detailType}`)) {
            catData2[key].forEach(cat => { if (!subCategories2.includes(cat)) subCategories2.push(cat); });
        }
    });

    subCategories2.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        detailType2Select.appendChild(opt);
    });
}

/* ==========================================================================
   3. 이벤트 및 검색 로직 (Events & Search)
   ========================================================================== */
function setupSortEvents() {
    const searchBtn = document.getElementById('btn-sort-search');
    const keywordInput = document.getElementById('sort-keyword');
    
    if (searchBtn) searchBtn.addEventListener('click', performSortSearch);
    if (keywordInput) keywordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSortSearch();
    });
}

function performSortSearch() {
    const siteFilter = document.getElementById('sort-site-select').value;
    const buildingFilter = document.getElementById('sort-building-select').value;
    const modelFilter = document.getElementById('sort-model-select') ? document.getElementById('sort-model-select').value : '';
    const equipFilter = document.getElementById('sort-equip-select').value;
    const typeFilter = document.getElementById('sort-type-select').value;
    const detailTypeFilter = document.getElementById('sort-detail-type-select').value;
    const detailType2Filter = document.getElementById('sort-detail-type2-select').value;
    const keyword = document.getElementById('sort-keyword').value.trim().toLowerCase();
    const itemDetailTypeFilter = document.getElementById('sort-item-detail-type-select').value;
    const costTypeFilter = document.getElementById('sort-cost-type-select').value;
    
    const periodType = document.getElementById('sort-period-type') ? document.getElementById('sort-period-type').value : 'custom';
    let startDate = '';
    let endDate = '';

    if (periodType === 'month') {
        const monthVal = document.getElementById('sort-month-input').value;
        if (monthVal) {
            const [y, m] = monthVal.split('-').map(Number);
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            const lastDay = new Date(y, m, 0).getDate();
            endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        }
    } else if (periodType === 'year') {
        const yearVal = document.getElementById('sort-year-input').value;
        if (yearVal) {
            startDate = `${yearVal}-01-01`;
            endDate = `${yearVal}-12-31`;
        }
    } else {
        startDate = document.getElementById('sort-start-date') ? document.getElementById('sort-start-date').value : '';
        endDate = document.getElementById('sort-end-date') ? document.getElementById('sort-end-date').value : '';
    }

    let results = [];
    
    let deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    let data = (typeof storageData !== 'undefined' && Object.keys(storageData).length > 0) ? storageData : deviceData;
    if (data.equipments) data = data.equipments;
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    Object.keys(data).forEach(site => {
        if (siteFilter && site !== siteFilter) return;
        
        if (data[site]) {
            data[site].forEach(equip => {
                if (equipFilter && equip !== equipFilter) return;
                
                const parts = equip.split('::');
                const equipName = parts[0];
                if (modelFilter && equipName !== modelFilter) return;
                
                const serialNo = parts.length > 1 ? parts[1] : '';
                const matchedModel = equipmentModels.find(m => m.name === equipName);
                const displayEquipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;
                
                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
                const equipBuilding = (detailData.setup && detailData.setup.building) ? detailData.setup.building : '';
                
                if (buildingFilter && equipBuilding !== buildingFilter) return;

                const checkItemMatch = (itemObj, isLog) => {
                    const itemDate = isLog ? itemObj.date : itemObj.scheduledDate;
                    if (!itemDate) return false;
                    if (isLog && itemObj.detailType === '일정변경') return false;
                    
                    if (typeFilter && itemObj.type !== typeFilter) return false;
                    if (startDate && itemDate < startDate) return false;
                    if (endDate && itemDate > endDate) return false;
                    
                    let dt1 = itemObj.detailType || '';
                    let dt2 = itemObj.detailType2 || '';
                    
                    if (dt1.includes(' > ')) {
                        const ps = dt1.split(' > '); dt1 = ps[0].trim(); dt2 = ps[1].trim();
                    } else if (dt2.includes(' > ')) {
                        const ps = dt2.split(' > '); dt1 = ps[0].trim(); dt2 = ps[1].trim();
                    }
                    
                    if (detailTypeFilter && dt1 !== detailTypeFilter) return false;
                    if (typeFilter === '비정기' && detailType2Filter && dt2 !== detailType2Filter) return false;

                    const pureContent = itemObj.content || itemObj.code || '';
                    
                    let parsedCostType = '';
                    const costMatch = pureContent.match(/\[(.*?)\]/);
                    if (costMatch) parsedCostType = costMatch[1];
                    const itemCostType = itemObj.costType || itemObj.itemCost || parsedCostType || '유상';
                    
                    if (costTypeFilter && itemCostType !== costTypeFilter) return false;

                    let matchedItemDetailType = '';
                    const contentsList = pureContent.split(',').map(s => s.replace(/\[.*?\]\s*/g, '').trim());
                    
                    for (const c of contentsList) {
                        const cleanContent = c.replace(/\[지연\]/g, '').trim();
                        const matchItem = adminItems.find(ai => ai.part === cleanContent || ai.code === cleanContent);
                        if (matchItem && matchItem.detailType) {
                            matchedItemDetailType = matchItem.detailType;
                            if (itemDetailTypeFilter && matchedItemDetailType === itemDetailTypeFilter) break;
                        }
                    }
                    
                    if (itemDetailTypeFilter && matchedItemDetailType !== itemDetailTypeFilter) return false;
                    
                    const workerText = itemObj.worker || '';
                    if (keyword) {
                        const kws = keyword.split(/\s+/);
                        const searchTarget = `${pureContent} ${workerText} ${displayEquipName} ${custEquipName}`.toLowerCase();
                        const match = kws.every(kw => searchTarget.includes(kw));
                        if (!match) return false;
                    }
                    
                    return {
                        date: itemDate,
                        site: site,
                        building: equipBuilding,
                        equipRaw: equip,
                        equipName: displayEquipName,
                        modelName: equipName,
                        serial: serialNo,
                        custName: custEquipName,
                        type: itemObj.type || '정기',
                        detailType: dt2 ? `${dt1} > ${dt2}` : dt1,
                        content: pureContent,
                        worker: workerText,
                        md: itemObj.md || '0',
                        costType: itemCostType,
                        itemDetailType: matchedItemDetailType,
                        status: isLog ? '완료' : '예정'
                    };
                };

                // 1. Logs (완료된 유지관리 이력 추출)
                if (detailData.logs) {
                    detailData.logs.forEach(log => {
                        const res = checkItemMatch(log, true);
                        if (res) results.push(res);
                    });
                }
                
                // 2. Maint (캘린더 예정 작업 추출)
                if (detailData.maint) {
                    detailData.maint.forEach(m => {
                        // 중복 체크 (해당 일자에 이미 로그로 완료 처리된 항목은 예정에서 제외)
                        const isDone = detailData.logs && detailData.logs.some(l => l.date === m.scheduledDate && (l.content || '').includes(m.content || ''));
                        if (isDone) return;
                        
                        const res = checkItemMatch(m, false);
                        if (res) results.push(res);
                    });
                }
            });
        }
    });

    // 날짜 내림차순 정렬, 동일 날짜일 경우 예정(미완료) 먼저 
    results.sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return a.status.localeCompare(b.status);
    });

    renderSortList(results);
    renderSortChart(results);
    
    const exportBtn = document.getElementById('btn-sort-export');
    if (exportBtn) exportBtn.onclick = () => exportSortResultsToCSV(results);
}

function renderSortList(results) {
    const list = document.getElementById('sort-result-list');
    const countBadge = document.getElementById('sort-result-count');
    
    if (countBadge) countBadge.textContent = results.length;
    if (!list) return;
    
    list.innerHTML = '';

    if (results.length === 0) {
        list.innerHTML = '<li class="list-empty-msg" style="text-align:center; padding: 20px; color:#8b949e;">검색된 결과가 없습니다.</li>';
        const exportBtn = document.getElementById('btn-sort-export');
        if (exportBtn) exportBtn.style.display = 'none';
        return;
    }

    const exportBtn = document.getElementById('btn-sort-export');
    if (exportBtn) exportBtn.style.display = 'block';

    results.forEach(row => {
        const li = document.createElement('li');
        li.className = 'sort-result-item';
        
        let equipDisplayHtml = escapeHtml(row.equipName);
        if (row.custName) equipDisplayHtml += ` <span style="color:#58a6ff;">[${escapeHtml(row.custName)}]</span>`;
        if (row.serial) equipDisplayHtml += ` <span style="font-size:11px;color:#8b949e; margin-left:3px;">(${escapeHtml(row.serial)})</span>`;
        
        const badgeClass = row.type.replace(/\s/g, '');
        const statusColor = row.status === '완료' ? '#3fb950' : '#d29922';

        li.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <div style="font-size: 11px; color: #8b949e; font-weight: bold;">${row.date}</div>
                <div style="font-weight: bold; color: ${statusColor}; font-size: 12px;">${row.status}</div>
            </div>
            <div style="font-size: 13px; font-weight: bold; color: #e6edf3; margin-bottom: 5px; line-height: 1.4;">
                <span class="badge ${badgeClass}" style="padding: 2px 6px; font-size: 10px; margin-right: 5px;">${escapeHtml(row.type)}</span>
                ${escapeHtml(row.site)} > ${equipDisplayHtml}
            </div>
            <div style="font-size: 12px; color: #c9d1d9; margin-bottom: 8px; line-height: 1.4;">
                <span style="color: #8b949e; margin-right: 3px;">[${escapeHtml(row.detailType)}]</span> ${escapeHtml(row.content)}
            </div>
            <div style="font-size: 11px; color: #8b949e; display: flex; justify-content: space-between;">
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%;" title="${escapeHtml(row.worker)}">작업자: ${escapeHtml(row.worker) || '-'}</span>
                <span>비용: ${escapeHtml(row.costType)}</span>
            </div>
        `;
        
        li.onclick = () => {
            window.location.href = `maintenance.html?site=${encodeURIComponent(row.site)}&equip=${encodeURIComponent(row.equipRaw)}`;
        };
        
        list.appendChild(li);
    });
}

function renderSortChart(results) {
    const container = document.getElementById('sort-chart-container');
    const yAxisContainer = document.getElementById('sort-y-axis');
    const partLegend = document.getElementById('sort-part-legend');
    const solContainer = document.getElementById('sort-solution-chart-container');
    const solYAxis = document.getElementById('sort-solution-y-axis');
    const solLegend = document.getElementById('sort-solution-legend');
    const typeContainer = document.getElementById('sort-type-chart-container');
    const typeYAxis = document.getElementById('sort-type-y-axis');
    const typeLegend = document.getElementById('sort-type-legend');

    const detailTypeContainer = document.getElementById('sort-detail-type-chart-container');
    const detailTypeYAxis = document.getElementById('sort-detail-type-y-axis');
    const detailTypeLegend = document.getElementById('sort-detail-type-legend');

    const detailType2Container = document.getElementById('sort-detail-type2-chart-container');
    const detailType2YAxis = document.getElementById('sort-detail-type2-y-axis');
    const detailType2Legend = document.getElementById('sort-detail-type2-legend');

    const irregularContainer = document.getElementById('sort-irregular-chart-container');
    const irregularYAxis = document.getElementById('sort-irregular-y-axis');
    const irregularLegend = document.getElementById('sort-irregular-legend');

    if (!container) return;
    
    container.innerHTML = '';
    if (yAxisContainer) yAxisContainer.innerHTML = '';
    if (partLegend) partLegend.innerHTML = '';
    if (solContainer) solContainer.innerHTML = '';
    if (solYAxis) solYAxis.innerHTML = '';
    if (solLegend) solLegend.innerHTML = '';
    if (typeContainer) typeContainer.innerHTML = '';
    if (typeYAxis) typeYAxis.innerHTML = '';
    if (typeLegend) typeLegend.innerHTML = '';
    if (detailTypeContainer) detailTypeContainer.innerHTML = '';
    if (detailTypeYAxis) detailTypeYAxis.innerHTML = '';
    if (detailTypeLegend) detailTypeLegend.innerHTML = '';
    if (detailType2Container) detailType2Container.innerHTML = '';
    if (detailType2YAxis) detailType2YAxis.innerHTML = '';
    if (detailType2Legend) detailType2Legend.innerHTML = '';
    if (irregularContainer) irregularContainer.innerHTML = '';
    if (irregularYAxis) irregularYAxis.innerHTML = '';
    if (irregularLegend) irregularLegend.innerHTML = '';
    
    if (results.length === 0) {
        container.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (solContainer) solContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (typeContainer) typeContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (detailTypeContainer) detailTypeContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (detailType2Container) detailType2Container.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (irregularContainer) irregularContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        return;
    }
    
    const partSiteCounts = {};
    const solSiteCounts = {};
    const typeSiteCounts = {
        '정기': {},
        '비정기': {},
        '고객대응': {},
        '용액제조': {},
        '온라인점검': {}
    };
    const detailTypeSiteCounts = {};
    const detailType2SiteCounts = {};
    const irregularSiteCounts = {};
    const allSites = new Set();
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    
    results.forEach(row => {
        if (row.content) {
            const items = row.content.split(',').map(s => s.trim());
            items.forEach(item => {
                let pureItem = item.replace(/\[.*?\]\s*/g, '').trim();
                if (pureItem.includes(' - ')) {
                    pureItem = pureItem.split(' - ')[1].trim();
                }
                if (pureItem) {
                    const cleanContent = pureItem.replace(/\[지연\]/g, '').trim();
                    const matchItem = adminItems.find(ai => ai.part === cleanContent || ai.code === cleanContent);
                    const itemDetailType = matchItem ? matchItem.detailType : '';
                    
                    // 물품 관리에 등록된 항목만 파츠/용액 교체 현황 차트에 표시
                    if (matchItem) {
                        if (itemDetailType === '용액') {
                            if (!solSiteCounts[pureItem]) solSiteCounts[pureItem] = {};
                            solSiteCounts[pureItem][row.site] = (solSiteCounts[pureItem][row.site] || 0) + 1;
                        } else {
                            if (!partSiteCounts[pureItem]) partSiteCounts[pureItem] = {};
                            partSiteCounts[pureItem][row.site] = (partSiteCounts[pureItem][row.site] || 0) + 1;
                        }
                    }
                }
            });
        }

        // 점검 구분 및 사업장별 데이터 수집
        if (row.type && row.site) {
            if (!typeSiteCounts[row.type]) typeSiteCounts[row.type] = {};
            typeSiteCounts[row.type][row.site] = (typeSiteCounts[row.type][row.site] || 0) + 1;
            allSites.add(row.site);
        }

        // 세부구분 1, 2 파싱 및 사업장별 데이터 수집
        let dt1 = row.detailType || '';
        let dt2 = '';
        if (dt1.includes(' > ')) {
            const ps = dt1.split(' > ');
            dt1 = ps[0].trim();
            dt2 = ps[1].trim();
        }
        if (dt1 && row.site) {
            if (!detailTypeSiteCounts[dt1]) detailTypeSiteCounts[dt1] = {};
            detailTypeSiteCounts[dt1][row.site] = (detailTypeSiteCounts[dt1][row.site] || 0) + 1;
        }
        if (dt2 && row.site) {
            if (!detailType2SiteCounts[dt2]) detailType2SiteCounts[dt2] = {};
            detailType2SiteCounts[dt2][row.site] = (detailType2SiteCounts[dt2][row.site] || 0) + 1;
        }

        // 비정기 점검 항목(내용) 파싱 및 사업장별 데이터 수집
        if (row.type === '비정기' && row.content) {
            const items = row.content.split(',').map(s => s.trim());
            items.forEach(item => {
                let pureItem = item.replace(/\[.*?\]\s*/g, '').trim();
                if (pureItem.includes(' - ')) {
                    pureItem = pureItem.split(' - ')[0].trim();
                }
                if (pureItem && row.site) {
                    if (!irregularSiteCounts[pureItem]) irregularSiteCounts[pureItem] = {};
                    irregularSiteCounts[pureItem][row.site] = (irregularSiteCounts[pureItem][row.site] || 0) + 1;
                }
            });
        }
    });

    // 사업장별 그룹 차트를 그리는 공통 헬퍼 함수
    const drawGroupedChart = (dataObj, targetContainer, targetYAxis, targetLegend, allSitesArray) => {
        if (!targetContainer || !targetYAxis) return;

        let localSelectedSite = null;

        const renderInner = () => {
            let maxCount = 0;
            const activeSitesInChart = new Set();
            Object.values(dataObj).forEach(siteObj => {
                Object.entries(siteObj).forEach(([site, val]) => {
                    if (val > 0) activeSitesInChart.add(site);
                    if (localSelectedSite && site !== localSelectedSite) return;
                    if (val > maxCount) maxCount = val;
                });
            });

            if (maxCount === 0) {
                targetContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">표시할 데이터가 없습니다.</div>';
                if (targetLegend) targetLegend.innerHTML = ''; // 범례도 비움
                if (targetYAxis) targetYAxis.innerHTML = ''; // Y축도 비움
                return;
            }

            let yAxisMax = 10;
            if (maxCount > 10) yAxisMax = Math.ceil(maxCount / 5) * 5;

            if (targetYAxis) {
                targetYAxis.innerHTML = ''; // Y축 비우기
                for (let i = 0; i <= 5; i++) {
                    const val = Math.round((yAxisMax / 5) * i);
                    const div = document.createElement('div');
                    div.textContent = val;
                    targetYAxis.appendChild(div);
                }
            }

            const siteColors = ['#1f6feb', '#3fb950', '#d29922', '#8957e5', '#da3633', '#f0883e', '#0078d4', '#8b949e'];
            const siteColorMap = {};
            
            if (targetLegend) targetLegend.innerHTML = ''; // 범례 컨테이너 비우기
            allSitesArray.forEach((site, idx) => {
                siteColorMap[site] = siteColors[idx % siteColors.length];
                if (targetLegend && activeSitesInChart.has(site)) {
                    const isFaded = localSelectedSite && localSelectedSite !== site;
                    const legDiv = document.createElement('div');
                    legDiv.className = 'legend-item';
                    legDiv.style.cursor = 'pointer';
                    legDiv.style.opacity = isFaded ? '0.4' : '1';
                    legDiv.style.transition = 'opacity 0.2s';
                    legDiv.innerHTML = `<div class="legend-color-box" style="background:${siteColorMap[site]};"></div><span title="${escapeHtml(site)}">${escapeHtml(site)}</span>`;
                    legDiv.onclick = () => {
                        if (localSelectedSite === site) {
                            localSelectedSite = null; // 토글 해제 (전체 보기)
                        } else {
                            localSelectedSite = site; // 개별 보기
                        }
                        renderInner(); // 해당 차트만 재렌더링
                    };
                    targetLegend.appendChild(legDiv);
                }
            });

            targetContainer.innerHTML = '';
            Object.keys(dataObj).sort().forEach(category => {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'sort-bar-group type-group';
                const trackDiv = document.createElement('div');
                trackDiv.className = 'bar-track';
                let totalInGroup = 0;
                
                allSitesArray.forEach(site => {
                    if (localSelectedSite && localSelectedSite !== site) return;

                    const count = dataObj[category][site] || 0;
                    if (count > 0) {
                        totalInGroup++;
                        const heightPct = (count / yAxisMax) * 100;
                        const bgStyle = siteColorMap[site];
                        const barWrapper = document.createElement('div');
                        barWrapper.className = 'multi-bar-wrapper';
                        barWrapper.title = `${escapeHtml(site)}: ${count}`;
                        barWrapper.innerHTML = `<div class="bar-value">${count}</div><div class="bar" style="height: ${heightPct}%; background: ${bgStyle};"></div>`;
                        trackDiv.appendChild(barWrapper);
                    }
                });
                
                const labelDiv = document.createElement('div');
                labelDiv.className = 'bar-label';
                labelDiv.textContent = escapeHtml(category);
                labelDiv.title = escapeHtml(category);
                groupDiv.appendChild(trackDiv);
                groupDiv.appendChild(labelDiv);
                if (totalInGroup > 0) targetContainer.appendChild(groupDiv);
            });
        };

        renderInner();
    };

    const sitesArray = Array.from(allSites).sort();
    drawGroupedChart(partSiteCounts, container, yAxisContainer, partLegend, sitesArray);
    drawGroupedChart(solSiteCounts, solContainer, solYAxis, solLegend, sitesArray);
    drawGroupedChart(typeSiteCounts, typeContainer, typeYAxis, typeLegend, sitesArray);
    drawGroupedChart(detailTypeSiteCounts, detailTypeContainer, detailTypeYAxis, detailTypeLegend, sitesArray);
    drawGroupedChart(detailType2SiteCounts, detailType2Container, detailType2YAxis, detailType2Legend, sitesArray);
    drawGroupedChart(irregularSiteCounts, irregularContainer, irregularYAxis, irregularLegend, sitesArray);
}

function exportSortResultsToCSV(results) {
    let csvContent = '\uFEFF'; 
    csvContent += '날짜,상태,사업장,건물명,모델명,장비명(약어),Serial No,고객사 장비명,구분,세부구분,물품상세구분,작업내용,비용처리,작업자,공수\n';
    
    results.forEach(row => {
        const cols = [
            row.date,
            row.status,
            row.site,
            row.building,
            row.modelName,
            row.equipName,
            row.serial,
            row.custName,
            row.type,
            row.detailType,
            row.itemDetailType,
            row.content,
            row.costType,
            row.worker,
            row.md
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        
        csvContent += cols + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SORT_작업조회결과_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// HTML escape helper
function escapeHtml(text) {
    if (!text) return text;
    return String(text).replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}