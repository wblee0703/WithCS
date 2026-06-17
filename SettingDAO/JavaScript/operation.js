/* ==========================================================================
   Operation (가동율 분석) 전용 JavaScript
   ========================================================================== */
let currentOpFilters = { sites: [], equip: 'ALL', selectedEquipSite: 'ALL', year: new Date().getFullYear() };

document.addEventListener('DOMContentLoaded', () => {
    if (window.isDataLoaded) {
        initOperationPage();
    } else {
        window.addEventListener('DataLoaded', initOperationPage);
    }
});

function initOperationPage() {
    initOperationYear();
    setupOperationEvents();
    renderOperationSites();
    calculateOperationRate();
}

function initOperationYear() {
    const yearSelect = document.getElementById('operation-year-select');
    const currentYear = new Date().getFullYear();
    
    if (yearSelect) {
        yearSelect.innerHTML = '';
        for (let y = currentYear - 5; y <= currentYear + 1; y++) {
            yearSelect.insertAdjacentHTML('beforeend', `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}년</option>`);
        }
    }
    currentOpFilters.year = yearSelect ? parseInt(yearSelect.value) : currentYear;
}

function setupOperationEvents() {
    const applyBtn = document.getElementById('btn-apply-operation-filter');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            const yearSelect = document.getElementById('operation-year-select');
            currentOpFilters.year = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
            calculateOperationRate();
        });
    }

    const searchInput = document.getElementById('operation-equip-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const kw = e.target.value.toLowerCase().trim();
            document.querySelectorAll('#operation-equip-list li').forEach(li => {
                if (li.dataset.equip === 'ALL') return;
                li.style.display = (li.dataset.search || '').includes(kw) ? '' : 'none';
            });
        });
    }

    const btnExportCsv = document.getElementById('btn-export-operation-csv');
    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', exportOperationCsv);
    }
}

function renderOperationSites() {
    const wrapper = document.getElementById('operation-site-filter-wrapper');
    if (!wrapper) return;
    
    // [수정] HTML 구조를 템플릿에서 복제하여 사용
    const tpl = document.getElementById('operation-site-filter-template');
    if (!tpl) return;
    wrapper.innerHTML = ''; // Clear previous content
    wrapper.appendChild(tpl.content.cloneNode(true));

    const trigger = document.getElementById('operation-site-select-trigger');
    const dropdown = document.getElementById('operation-site-select-dropdown');
    const list = document.getElementById('operation-site-list');
    const groupContainer = document.getElementById('operation-site-group-toggle-container');

    // Populate sites and groups
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const allSites = Object.keys(deviceData).filter(s => s !== 'models' && s !== 'details').sort();
    const groupedSites = {};
    const siteToGroupMap = {};

    allSites.forEach(site => {
        const meta = JSON.parse(localStorage.getItem(`site_meta_${site}`)) || {};
        const group = meta.group || '기타사업장';
        if (!groupedSites[group]) groupedSites[group] = [];
        groupedSites[group].push(site);
        siteToGroupMap[site] = group;
    });

    const order = ['SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타'];
    const groups = Object.keys(groupedSites).sort((a, b) => {
        const idxA = order.indexOf(a);
        const idxB = order.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    // 리스트 렌더링
    groupContainer.innerHTML = groups.map(g => `<button type="button" class="btn-gray site-group-toggle-btn sort-filter-btn" data-group="${g}">${g}</button>`).join('');

    list.innerHTML = '';
    allSites.forEach(site => {
        // [수정] HTML 구조를 템플릿에서 복제하여 사용
        const itemTpl = document.getElementById('operation-site-item-template');
        if (!itemTpl) return;
        const li = itemTpl.content.cloneNode(true).firstElementChild;

        const group = siteToGroupMap[site];
        li.dataset.value = site;
        li.dataset.siteGroup = group;
        li.querySelector('.item-text').textContent = escapeHtml(site);

        // [수정] 초기 렌더링 시 전체 사업장을 선택된 상태로 명시적으로 표시
        li.classList.add('selected');
        li.querySelector('.check-icon').style.opacity = '1';

        list.appendChild(li);
    });

    // Add event listeners
    trigger.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('show');
    };

    dropdown.querySelector('.btn-confirm').onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
    };

    dropdown.querySelector('.btn-select-all').onclick = (e) => {
        e.stopPropagation();
        list.querySelectorAll('.log-select-item').forEach(el => {
            el.classList.add('selected');
            el.querySelector('.check-icon').style.opacity = '1';
        });
        updateTriggerText();
        handleFilterChange();
    };

    dropdown.querySelector('.btn-deselect-all').onclick = (e) => {
        e.stopPropagation();
        list.querySelectorAll('.log-select-item').forEach(el => {
            el.classList.remove('selected');
            el.querySelector('.check-icon').style.opacity = '0';
        });
        updateTriggerText();
        handleFilterChange();
    };

    groupContainer.querySelectorAll('.site-group-toggle-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const targetGroup = btn.dataset.group;
            const groupItems = Array.from(list.querySelectorAll(`.log-select-item[data-site-group="${targetGroup}"]`));
            const allSelected = groupItems.every(item => item.classList.contains('selected'));
            groupItems.forEach(el => {
                if (allSelected) {
                    el.classList.remove('selected');
                    el.querySelector('.check-icon').style.opacity = '0';
                } else {
                    el.classList.add('selected');
                    el.querySelector('.check-icon').style.opacity = '1';
                }
            });
            updateTriggerText();
            handleFilterChange();
        };
    });

    list.querySelectorAll('.log-select-item').forEach(item => {
        item.onclick = (e) => {
            e.stopPropagation();
            item.classList.toggle('selected');
            item.querySelector('.check-icon').style.opacity = item.classList.contains('selected') ? '1' : '0';
            updateTriggerText();
            handleFilterChange();
        };
    });

    function updateTriggerText() {
        const selected = Array.from(list.querySelectorAll('.log-select-item.selected'));
        const total = list.querySelectorAll('.log-select-item').length;
        if (selected.length === total || selected.length === 0) {
            trigger.textContent = '전체 사업장';
        } else if (selected.length === 1) {
            trigger.textContent = selected[0].dataset.value;
        } else {
            trigger.textContent = `${selected[0].dataset.value} 외 ${selected.length - 1}개`;
        }
    }

    // [추가] 선택된 사업장을 드롭다운 아래 리스트 형태로 렌더링
    function updateSelectedSitesList() {
        // [수정] 템플릿에 이미 존재하는 ul(operation-selected-sites-display)을 우선 사용하여 중복 생성(높이 반토막) 방지
        let selectedListContainer = document.getElementById('operation-selected-sites-display') || document.getElementById('operation-selected-sites-list');
        if (!selectedListContainer) {
            selectedListContainer = document.createElement('ul');
            selectedListContainer.id = 'operation-selected-sites-list';
            selectedListContainer.className = 'operation-selected-sites-list';
            
            // [수정] 템플릿 내 다른 요소들보다 우선하여 드롭다운 입력창 바로 아래에 위치하도록 삽입
            const logSelectWrapper = wrapper.querySelector('.log-select-wrapper');
            if (logSelectWrapper) {
                if (logSelectWrapper.nextSibling) logSelectWrapper.parentNode.insertBefore(selectedListContainer, logSelectWrapper.nextSibling);
                else logSelectWrapper.parentNode.appendChild(selectedListContainer);
            } else {
                wrapper.appendChild(selectedListContainer);
            }
        }

        const selectedElements = Array.from(list.querySelectorAll('.log-select-item.selected'));
        selectedListContainer.innerHTML = '';

        if (selectedElements.length === 0) {
            selectedListContainer.innerHTML = '<li class="empty-selection">선택된 사업장이 없습니다.</li>';
        } else {
            selectedElements.forEach(el => {
                const siteName = el.dataset.value;
                const siteGroup = el.dataset.siteGroup;
                
                // [수정] HTML 구조를 템플릿에서 복제하여 사용하도록 변경
                const tpl = document.getElementById('operation-selected-site-item-template');
                let li;
                if (tpl) {
                    li = tpl.content.cloneNode(true).firstElementChild;
                    li.querySelector('.site-group-label').textContent = siteGroup;
                    li.querySelector('.site-name-label').textContent = siteName;
                    li.querySelector('.btn-remove-site').dataset.site = siteName;
                } else {
                    li = document.createElement('li');
                    li.innerHTML = `
                        <div class="site-info">
                            <span class="site-group-label">${escapeHtml(siteGroup)}</span>
                            <span class="site-name-label">${escapeHtml(siteName)}</span>
                        </div>
                        <span class="btn-remove-site" data-site="${escapeHtml(siteName)}">✕</span>
                    `;
                }
                
                li.querySelector('.btn-remove-site').onclick = (e) => {
                    e.stopPropagation();
                    el.classList.remove('selected');
                    el.querySelector('.check-icon').style.opacity = '0';
                    updateTriggerText();
                    handleFilterChange();
                };
                selectedListContainer.appendChild(li);
            });
        }
    }

    function handleFilterChange() {
        const selectedSites = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
        currentOpFilters.sites = selectedSites;
        currentOpFilters.equip = 'ALL';
        renderOperationEquips(currentOpFilters.sites);
        calculateOperationRate();
        updateSelectedSitesList();
    }
    
    // Initial state
    updateTriggerText();
    handleFilterChange();
}

function renderOperationEquips(sites) {
    const equipList = document.getElementById('operation-equip-list');
    if (!equipList) return;
    
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    equipList.innerHTML = `<li data-equip="ALL" class="active">전체 장비</li>`;
    
    let equips = [];
    const isAllSites = sites.length === 0 || sites.length === Object.keys(deviceData).filter(s => s !== 'models' && s !== 'details').length;

    Object.keys(deviceData).forEach(site => {
        if (site === 'models' || site === 'details') return;
        if (isAllSites || sites.includes(site)) {
            deviceData[site].forEach(e => equips.push({ site: site, equip: e }));
        }
    });
    
    equips.forEach(item => {
        if (item.equip === '기타(ETC)') return;
        const parts = item.equip.split('::');
        const rawName = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';
        const matched = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
        const displayName = matched && matched.abbr ? matched.abbr : rawName;
        
        const detailData = JSON.parse(localStorage.getItem(`details_${item.site}_${item.equip}`)) || {};
        const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
        const subText = custEquipName ? ` [${custEquipName}]` : (serial ? ` [${serial}]` : '');
        
        const searchText = `${item.site} ${displayName} ${subText}`.toLowerCase();

        // [수정] HTML 구조를 템플릿에서 복제하여 사용
        const itemTpl = document.getElementById('operation-equip-item-template');
        if (!itemTpl) return;
        const li = itemTpl.content.cloneNode(true).firstElementChild;
        li.dataset.equip = escapeHtml(item.equip);
        li.dataset.site = escapeHtml(item.site);
        li.dataset.search = escapeHtml(searchText);
        li.querySelector('.equip-item-site').textContent = escapeHtml(item.site);
        li.querySelector('.equip-item-name').textContent = `${escapeHtml(displayName)}${escapeHtml(subText)}`;
        equipList.appendChild(li);
    });
    
    equipList.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
            equipList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            currentOpFilters.equip = li.dataset.equip;
            if (li.dataset.equip !== 'ALL') currentOpFilters.selectedEquipSite = li.dataset.site;
            calculateOperationRate();
        });
    });
}

function calculateOperationRate() {
    const { sites, equip, selectedEquipSite, year } = currentOpFilters;
    if (!year) return alert('조회 연도를 설정해주세요.');
    
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    let targetEquipList = [];
    
    const isAllSites = sites.length === 0 || sites.length === Object.keys(deviceData).filter(s => s !== 'models' && s !== 'details').length;

    if (equip !== 'ALL') {
        targetEquipList.push({ site: selectedEquipSite, equip: equip });
    } else if (!isAllSites) {
        sites.forEach(site => {
            if (deviceData[site]) {
                const equips = deviceData[site].filter(e => e !== '기타(ETC)');
                equips.forEach(e => targetEquipList.push({ site, equip: e }));
            }
        });
    } else {
        Object.keys(deviceData).forEach(s => { 
            if (s !== 'models' && s !== 'details') {
                const equips = deviceData[s].filter(e => e !== '기타(ETC)');
                equips.forEach(e => targetEquipList.push({ site: s, equip: e }));
            }
        });
    }

    // [추가] 셋업 장비 및 유류 장비 등 가동과 무관한 장비는 통계 모수에서 제외하여 평균 가동율 왜곡 방지
    targetEquipList = targetEquipList.filter(eq => {
        const detailData = JSON.parse(localStorage.getItem(`details_${eq.site}_${eq.equip}`)) || {};
        const status = (detailData.setup && detailData.setup.equipStatus) ? detailData.setup.equipStatus : '';
        return status !== '셋업 장비' && status !== '유류장비';
    });
    
    const equipMonthlyStats = [];
    const allDowntimeList = [];
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    
    targetEquipList.forEach(eq => {
        const key = `details_${eq.site}_${eq.equip}`;
        const detailData = JSON.parse(localStorage.getItem(key)) || {};
        const logs = detailData.logs || [];
        
        const rawName = eq.equip.split('::')[0];
        const serial = eq.equip.split('::')[1] || '';
        const matched = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
        const displayName = matched && matched.abbr ? matched.abbr : rawName;
        
        const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
        const subText = custEquipName ? ` [${custEquipName}]` : (serial ? ` [${serial}]` : '');
        const fullEquipName = `${displayName}${subText}`;

        const monthlyDownHours = {};
        for (let m = 1; m <= 12; m++) {
            monthlyDownHours[m] = 0;
        }
        
        logs.forEach(logItem => {
            if (logItem.startTime && logItem.endTime) {
                const dStart = new Date(logItem.startTime);
                const dEnd = new Date(logItem.endTime);
                
                // [수정] 날짜 형식이 잘못되어 발생하는 NaN 오류가 전체 평균 계산을 고장내는 현상 방지
                if (!isNaN(dStart) && !isNaN(dEnd) && dStart < dEnd) {
                    for (let m = 1; m <= 12; m++) {
                        const monthStart = new Date(year, m - 1, 1, 0, 0, 0);
                        const monthEnd = new Date(year, m, 0, 23, 59, 59, 999);
                        
                        const overlapStart = new Date(Math.max(dStart, monthStart));
                        const overlapEnd = new Date(Math.min(dEnd, monthEnd));
                        
                        if (overlapStart < overlapEnd) {
                            const downHours = (overlapEnd - overlapStart) / (1000 * 60 * 60);
                            if (!isNaN(downHours) && downHours > 0) {
                                monthlyDownHours[m] += downHours;
                            
                                const dtInfo = {
                                    start: overlapStart,
                                    end: overlapEnd,
                                    equipName: displayName,
                                    subText: subText,
                                    fullEquipName: fullEquipName,
                                    type: logItem.type || '-',
                                    detailType: logItem.detailType || '',
                                    detailType2: logItem.detailType2 || '',
                                    content: logItem.content || logItem.memo || '-',
                                    hours: downHours
                                };
                                allDowntimeList.push(dtInfo);
                            }
                        }
                    }
                }
            }
        });

        equipMonthlyStats.push({
            site: eq.site,
            equipName: fullEquipName,
            modelName: displayName,
            serial: serial,
            custEquipName: custEquipName,
            monthlyDownHours: monthlyDownHours
        });
    });
    
    window.currentDowntimeList = allDowntimeList;
    renderEquipMonthlyTable(equipMonthlyStats, year);
    renderDowntimeTable(allDowntimeList);
}

function renderEquipMonthlyTable(statsList, year) {
    const tbody = document.getElementById('operation-monthly-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    if (statsList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="17" class="empty-msg">조회할 가동 장비가 없습니다. (미가동/셋업 장비 제외됨)</td></tr>';
        return;
    }

    // [수정] 전체 평균을 단순히 전체 시간 대비 다운타임이 아닌, 각 장비 가동율의 산술 평균으로 계산하여 사용자 직관과 100% 일치하도록 변경
    const totalMonthlyRates = {};
    for (let m = 1; m <= 12; m++) totalMonthlyRates[m] = 0;
    let totalYearlyRateSum = 0;
    let validEquipCount = statsList.length;

    statsList.forEach(stat => {
        let equipYearlyTotal = 0;
        let equipYearlyDown = 0;
        for (let m = 1; m <= 12; m++) {
            const totalHours = new Date(year, m, 0).getDate() * 24;
            const downHours = stat.monthlyDownHours[m] || 0;
            equipYearlyTotal += totalHours;
            equipYearlyDown += downHours;
            
            let rate = totalHours > 0 ? ((totalHours - downHours) / totalHours) * 100 : 100;
            if (rate < 0) rate = 0;
            totalMonthlyRates[m] += rate;
        }
        let equipYearlyRate = equipYearlyTotal > 0 ? ((equipYearlyTotal - equipYearlyDown) / equipYearlyTotal) * 100 : 100;
        if (equipYearlyRate < 0) equipYearlyRate = 0;
        totalYearlyRateSum += equipYearlyRate;
    });

    const totalTr = document.createElement('tr');
    totalTr.className = 'total-avg-row';
    let totalHtml = `<th colspan="4" style="text-align: center; color: #e6edf3;">전체 평균</th>`;
    let totalMonthlyHtml = '';

    for (let m = 1; m <= 12; m++) {
        let avgRate = validEquipCount > 0 ? (totalMonthlyRates[m] / validEquipCount) : 100;
        let rateColor = '#3fb950'; if (avgRate <= 90) rateColor = '#f85149'; else if (avgRate <= 98) rateColor = '#d29922';
        totalMonthlyHtml += `<th style="color: ${rateColor}; font-weight: bold;">${avgRate.toFixed(1)}%</th>`;
    }
    
    let avgYearlyRate = validEquipCount > 0 ? (totalYearlyRateSum / validEquipCount) : 100;
    let yearlyRateColor = '#3fb950'; if (avgYearlyRate <= 90) yearlyRateColor = '#f85149'; else if (avgYearlyRate <= 98) yearlyRateColor = '#d29922';
    
    totalHtml += `<th style="color: ${yearlyRateColor}; font-weight: bold;">${avgYearlyRate.toFixed(1)}%</th>`;
    totalHtml += totalMonthlyHtml;
    totalTr.innerHTML = totalHtml;

    // [수정] 전체 평균 행을 테이블 최하단(tfoot)에 삽입
    const table = document.getElementById('operation-monthly-table');
    if (table) {
        let tfoot = table.querySelector('tfoot');
        if (!tfoot) {
            tfoot = document.createElement('tfoot');
            table.appendChild(tfoot);
        } else {
            tfoot.innerHTML = '';
        }
        tfoot.appendChild(totalTr);
        
        // 기존 thead에 남아있을 수 있는 total-avg-row 제거
        const thead = table.querySelector('thead');
        if (thead) {
            const existingTotal = thead.querySelector('.total-avg-row');
            if (existingTotal) existingTotal.remove();
        }
    }

    const monthlyTotalHours = {};
    for (let m = 1; m <= 12; m++) {
        monthlyTotalHours[m] = new Date(year, m, 0).getDate() * 24;
    }

    statsList.sort((a, b) => {
        if (a.site !== b.site) return a.site.localeCompare(b.site);
        return a.equipName.localeCompare(b.equipName);
    });

    statsList.forEach(stat => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        
        let html = `
            <td>${escapeHtml(stat.site)}</td>
            <td style="white-space: nowrap;">${escapeHtml(stat.modelName)}</td>
            <td>${escapeHtml(stat.serial || '-')}</td>
            <td>${escapeHtml(stat.custEquipName || '-')}</td>`;
        
        let yearlyTotalHours = 0;
        let yearlyDownHours = 0;
        let monthlyHtml = '';
        
        for (let m = 1; m <= 12; m++) {
            const downHours = stat.monthlyDownHours[m];
            const totalHours = monthlyTotalHours[m];
            
            yearlyTotalHours += totalHours;
            yearlyDownHours += downHours;
            
            let rate = totalHours > 0 ? ((totalHours - downHours) / totalHours) * 100 : 100;
            if (rate < 0) rate = 0;
            
            let rateColor = '#3fb950'; // 녹색 (98% 초과)
            if (rate <= 90) {
                rateColor = '#f85149'; // 빨강 (90% 이하)
            } else if (rate <= 98) {
                rateColor = '#d29922'; // 주황 (90% 초과 ~ 98% 이하)
            }

            monthlyHtml += `<td style="color: ${rateColor}; font-weight: bold;">${rate.toFixed(1)}%</td>`;
        }
        
        let yearlyRate = yearlyTotalHours > 0 ? ((yearlyTotalHours - yearlyDownHours) / yearlyTotalHours) * 100 : 100;
        if (yearlyRate < 0) yearlyRate = 0;
        
        let yearlyRateColor = '#3fb950'; // 녹색 (98% 초과)
        if (yearlyRate <= 90) {
            yearlyRateColor = '#f85149'; // 빨강 (90% 이하)
        } else if (yearlyRate <= 98) {
            yearlyRateColor = '#d29922'; // 주황 (90% 초과 ~ 98% 이하)
        }
        
        html += `<td style="color: ${yearlyRateColor}; font-weight: bold; background-color: rgba(255, 255, 255, 0.03);">${yearlyRate.toFixed(1)}%</td>`;
        html += monthlyHtml;
        
        tr.innerHTML = html;
        
        tr.addEventListener('click', () => {
            const isActive = tr.classList.contains('active-row');
            tbody.querySelectorAll('tr').forEach(row => row.classList.remove('active-row'));
            
            if (isActive) {
                renderDowntimeTable(window.currentDowntimeList);
            } else {
                tr.classList.add('active-row');
                const filtered = window.currentDowntimeList.filter(item => item.fullEquipName === stat.equipName);
                renderDowntimeTable(filtered);
            }
        });

        tbody.appendChild(tr);
    });
}

// [추가] 운영장비 가동율 리스트 CSV 내보내기
function exportOperationCsv() {
    const year = currentOpFilters.year || new Date().getFullYear();
    const tbody = document.getElementById('operation-monthly-tbody');
    
    if (!tbody || tbody.querySelectorAll('tr').length === 0 || tbody.querySelector('.empty-msg')) {
        alert('추출할 가동율 데이터가 없습니다.');
        return;
    }

    let csvContent = '\uFEFF'; // 한글 깨짐 방지 BOM
    csvContent += '사업장,장비명(모델),S/N,고객사 장비명,연 가동율,1월,2월,3월,4월,5월,6월,7월,8월,9월,10월,11월,12월\n';

    const parseRow = (row) => {
        const cols = row.querySelectorAll('td, th');
        const rowData = [];
        cols.forEach(col => {
            let text = col.textContent.trim();
            if (/^[=+\-@\(]/.test(text)) text = "'" + text; // 엑셀 수식 자동 변환 방지
            
            if (col.hasAttribute('colspan')) {
                const colspan = parseInt(col.getAttribute('colspan'), 10);
                rowData.push(`"${text.replace(/"/g, '""')}"`);
                for (let i = 1; i < colspan; i++) rowData.push('""'); // colspan 넓이만큼 빈 칸 채우기
            } else {
                rowData.push(`"${text.replace(/"/g, '""')}"`);
            }
        });
        return rowData.join(',');
    };

    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => csvContent += parseRow(row) + '\n');

    const tfoot = document.querySelector('#operation-monthly-table tfoot');
    if (tfoot) {
        const avgRow = tfoot.querySelector('.total-avg-row');
        if (avgRow) csvContent += parseRow(avgRow) + '\n';
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `운영장비_가동율_${year}년_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function renderDowntimeTable(list) {
    const tbody = document.getElementById('operation-downtime-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">해당 기간에 기록된 다운타임 내역이 없습니다.</td></tr>';
        return;
    }
    
    list.sort((a, b) => b.start - a.start);
    list.forEach(item => {
        let contentDisplay = item.content;
        if(typeof contentDisplay === 'string' && contentDisplay.startsWith('{')) {
            try { const p = JSON.parse(contentDisplay); contentDisplay = p.situation || p.symptom || '내용'; } catch(e) {}
        }
        
        let tooltipContent = contentDisplay;
        if (typeof contentDisplay === 'string') {
            const itemsArr = contentDisplay.split(',').map(s => s.trim()).filter(Boolean);
            if (itemsArr.length > 1) {
                contentDisplay = `${itemsArr[0]} 외 ${itemsArr.length - 1}개`;
            }
        }
        
        let dt1 = item.detailType || '-';
        let dt2 = item.detailType2 || '-';
        
        if (dt1.includes(' > ')) {
            const parts = dt1.split(' > ');
            dt1 = parts[0].trim();
            dt2 = parts[1].trim();
        } else if (dt2.includes(' > ')) {
            const parts = dt2.split(' > ');
            dt1 = parts[0].trim();
            dt2 = parts[1].trim();
        }
        
        const hours = item.hours;
        let hourColor = '#3fb950'; // 녹색 (12시간 이하)
        if (hours > 24) {
            hourColor = '#f85149'; // 빨강 (24시간 초과)
        } else if (hours > 12) {
            hourColor = '#d29922'; // 주황 (12시간 초과 ~ 24시간 이하)
        }
        
        const formatDateHtml = (dObj) => {
            const dateStr = dObj.toLocaleDateString('ko-KR');
            const timeStr = dObj.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
            return `<div>${dateStr}</div><div style="font-size: 11px; color: #8b949e; margin-top: 2px;">${timeStr}</div>`;
        };
        
        let equipHtml = escapeHtml(item.equipName);
        if (item.subText) {
            equipHtml = `<div>${escapeHtml(item.equipName)}</div><div style="font-size: 11px; color: #3fb950; margin-top: 2px; font-weight: bold;">${escapeHtml(item.subText)}</div>`;
        }
        
        // [수정] HTML 구조를 템플릿에서 복제하여 사용
        const tpl = document.getElementById('operation-downtime-row-template');
        if (!tpl) return;
        const tr = tpl.content.cloneNode(true).firstElementChild;

        tr.querySelector('.downtime-start').innerHTML = formatDateHtml(item.start);
        tr.querySelector('.downtime-end').innerHTML = formatDateHtml(item.end);
        tr.querySelector('.downtime-equip').innerHTML = equipHtml;
        tr.querySelector('.downtime-type').textContent = escapeHtml(item.type || '-');
        tr.querySelector('.downtime-dt1').textContent = escapeHtml(dt1);
        tr.querySelector('.downtime-dt2').textContent = escapeHtml(dt2);
        const contentCell = tr.querySelector('.downtime-content');
        contentCell.title = escapeHtml(tooltipContent);
        contentCell.textContent = escapeHtml(contentDisplay);
        const hoursCell = tr.querySelector('.downtime-hours');
        hoursCell.style.color = hourColor;
        hoursCell.textContent = `${item.hours.toFixed(1)} h`;
        tbody.appendChild(tr);
    });
}