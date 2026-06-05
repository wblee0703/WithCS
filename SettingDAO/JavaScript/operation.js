/* ==========================================================================
   Operation (가동율 분석) 전용 JavaScript
   ========================================================================== */
let currentOpFilters = { siteGroup: 'ALL', equip: 'ALL', selectedEquipSite: 'ALL', year: new Date().getFullYear() };

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
}

function renderOperationSites() {
    const siteList = document.getElementById('operation-site-list');
    if (!siteList) return;
    
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    siteList.innerHTML = `<li data-site-group="ALL" class="active">전체 사업장</li>`;
    
    const sites = Object.keys(deviceData).filter(s => s !== 'models' && s !== 'details').sort();
    const groupedSites = {};
    
    // 사업장별 구분을 추출하여 그룹화
    sites.forEach(site => {
        const meta = JSON.parse(localStorage.getItem(`site_meta_${site}`)) || {};
        const group = meta.group || '기타사업장';
        if (!groupedSites[group]) groupedSites[group] = [];
        groupedSites[group].push(site);
    });
    
    // 그룹명 기준 정렬 (시스템 공통 지정 순서 우선, 그 외 가나다순)
    const order = ['기타사업장','SEC', 'SKH 이천', 'SKH 청주', 'SCS 서안', 'SKH 우시', '기타'];
    const groups = Object.keys(groupedSites).sort((a, b) => {
        const idxA = order.indexOf(a);
        const idxB = order.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });
    
    // 리스트 렌더링
    groups.forEach(group => {
        siteList.insertAdjacentHTML('beforeend', `<li data-site-group="${escapeHtml(group)}"><span>${escapeHtml(group)}</span></li>`);
    });

    siteList.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
            siteList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            currentOpFilters.siteGroup = li.dataset.siteGroup;
            currentOpFilters.equip = 'ALL';
            renderOperationEquips(currentOpFilters.siteGroup);
            calculateOperationRate();
        });
    });
    renderOperationEquips('ALL');
}

function renderOperationEquips(siteGroup) {
    const equipList = document.getElementById('operation-equip-list');
    if (!equipList) return;
    
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    equipList.innerHTML = `<li data-equip="ALL" class="active">전체 장비</li>`;
    
    let equips = [];
    Object.keys(deviceData).forEach(site => {
        if (site === 'models' || site === 'details') return;
        const meta = JSON.parse(localStorage.getItem(`site_meta_${site}`)) || {};
        const group = meta.group || '기타사업장';
        if (siteGroup === 'ALL' || group === siteGroup) {
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
        
        const displayHtml = `<div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 11px; color: #8b949e;">${escapeHtml(item.site)}</span><span>${escapeHtml(displayName)}${escapeHtml(subText)}</span></div>`;
            
        const searchText = `${item.site} ${displayName} ${subText}`.toLowerCase();
        equipList.insertAdjacentHTML('beforeend', `<li data-equip="${escapeHtml(item.equip)}" data-site="${escapeHtml(item.site)}" data-search="${escapeHtml(searchText)}">${displayHtml}</li>`);
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
    const { siteGroup, equip, selectedEquipSite, year } = currentOpFilters;
    if (!year) return alert('조회 연도를 설정해주세요.');
    
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    let targetEquipList = [];
    
    if (equip !== 'ALL') {
        targetEquipList.push({ site: selectedEquipSite, equip: equip });
    } else if (siteGroup !== 'ALL') {
        const sites = Object.keys(deviceData).filter(s => s !== 'models' && s !== 'details');
        sites.forEach(site => {
            const meta = JSON.parse(localStorage.getItem(`site_meta_${site}`)) || {};
            const group = meta.group || '기타사업장';
            if (group === siteGroup && deviceData[site]) {
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
                
                if (dStart < dEnd) {
                    for (let m = 1; m <= 12; m++) {
                        const monthStart = new Date(year, m - 1, 1, 0, 0, 0);
                        const monthEnd = new Date(year, m, 0, 23, 59, 59, 999);
                        
                        const overlapStart = new Date(Math.max(dStart, monthStart));
                        const overlapEnd = new Date(Math.min(dEnd, monthEnd));
                        
                        if (overlapStart < overlapEnd) {
                            const downHours = (overlapEnd - overlapStart) / (1000 * 60 * 60);
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
        });

        equipMonthlyStats.push({
            site: eq.site,
            equipName: fullEquipName,
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
        tbody.innerHTML = '<tr><td colspan="14" class="empty-msg">선택된 장비가 없습니다.</td></tr>';
        return;
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
        let html = `<td>${escapeHtml(stat.site)}</td><td style="text-align: left; white-space: nowrap;">${escapeHtml(stat.equipName)}</td>`;
        
        for (let m = 1; m <= 12; m++) {
            const downHours = stat.monthlyDownHours[m];
            const totalHours = monthlyTotalHours[m];
            
            let rate = totalHours > 0 ? ((totalHours - downHours) / totalHours) * 100 : 100;
            if (rate < 0) rate = 0;
            
            let rateColor = '#3fb950';
            if (rate < 95) rateColor = '#d29922';
            if (rate < 90) rateColor = '#f85149';

            html += `<td style="color: ${rateColor}; font-weight: bold;">${rate.toFixed(1)}%</td>`;
        }
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
        
        const formatDateHtml = (dObj) => {
            const dateStr = dObj.toLocaleDateString('ko-KR');
            const timeStr = dObj.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
            return `<div>${dateStr}</div><div style="font-size: 11px; color: #8b949e; margin-top: 2px;">${timeStr}</div>`;
        };
        
        let equipHtml = escapeHtml(item.equipName);
        if (item.subText) {
            equipHtml = `<div>${escapeHtml(item.equipName)}</div><div style="font-size: 11px; color: #3fb950; margin-top: 2px; font-weight: bold;">${escapeHtml(item.subText)}</div>`;
        }
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDateHtml(item.start)}</td>
            <td>${formatDateHtml(item.end)}</td>
            <td>${equipHtml}</td>
            <td>${escapeHtml(item.type || '-')}</td>
            <td>${escapeHtml(dt1)}</td>
            <td>${escapeHtml(dt2)}</td>
            <td style="text-align: left;" title="${escapeHtml(tooltipContent)}">${escapeHtml(contentDisplay)}</td>
            <td style="color: #f85149; font-weight: bold;">${item.hours.toFixed(1)} h</td>
        `;
        tbody.appendChild(tr);
    });
}