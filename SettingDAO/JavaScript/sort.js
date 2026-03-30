/* ==========================================================================
   1. 초기화 (Initialization)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    if (window.isDataLoaded) {
        initSortPage();
    } else {
        window.addEventListener('DataLoaded', initSortPage);
    }
    
    // 드롭다운 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.log-select-dropdown').forEach(d => {
            const wrapper = d.closest('.log-select-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                d.style.display = 'none';
                d.classList.remove('show');
            }
        });
    });
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
   다중 선택(Multi-select) 커스텀 UI 유틸리티
   ========================================================================== */
function getMultiValues(selectId) {
    const wrapper = document.getElementById(`${selectId}-wrapper`);
    if (wrapper) {
        const selected = wrapper.querySelectorAll('.log-select-item.selected');
        return Array.from(selected).map(el => el.dataset.value).filter(v => v);
    }
    const sel = document.getElementById(selectId);
    if (sel && sel.value) return [sel.value];
    return [];
}

function syncCustomMultiSelect(selectId, placeholder = '전체') {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    
    let wrapper = document.getElementById(`${selectId}-wrapper`);
    if (!wrapper) {
        selectEl.style.display = 'none';
        wrapper = document.createElement('div');
        wrapper.id = `${selectId}-wrapper`;
        wrapper.className = 'log-select-wrapper full-width';
        wrapper.style.margin = '0';
        wrapper.style.position = 'relative'; // 부모 영역 기준점 설정
        
        wrapper.innerHTML = `
            <div id="${selectId}-trigger" class="log-select-trigger" style="min-height:30px; display:flex; align-items:center; background:#0d1117; color:#8b949e; border:1px solid #30363d; border-radius:4px; padding:6px 10px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${placeholder}</div>
            <div id="${selectId}-dropdown" class="log-select-dropdown" style="width:100%; display:none; position:absolute; top:100%; left:0; z-index:1000; margin-top:4px; background:#161b22; border:1px solid #30363d; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5); box-sizing:border-box;">
                <div id="${selectId}-list" class="log-select-list" style="max-height: 200px; overflow-y: auto; padding: 8px;"></div>
                <div class="log-select-footer" style="padding: 8px; border-top: 1px solid #30363d; background: #21262d;">
                    <button type="button" class="btn-blue-sm btn-confirm" style="width: 100%;">선택 완료</button>
                </div>
            </div>
        `;
        selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
        
        const trigger = wrapper.querySelector(`#${selectId}-trigger`);
        const dropdown = wrapper.querySelector(`#${selectId}-dropdown`);
        const confirmBtn = wrapper.querySelector('.btn-confirm');
        
        trigger.onclick = (e) => {
            e.stopPropagation();
            if (trigger.classList.contains('disabled')) return;
            document.querySelectorAll('.log-select-dropdown').forEach(d => { 
                if (d !== dropdown) { d.style.display = 'none'; d.classList.remove('show'); } 
            });
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
                dropdown.classList.remove('show');
            } else {
                dropdown.style.display = 'block';
                dropdown.classList.add('show');
            }
        };
        
        confirmBtn.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 포커스 아웃 방지
            e.stopPropagation();
            dropdown.style.display = 'none';
            dropdown.classList.remove('show');
        });
    }
    
    const list = wrapper.querySelector(`#${selectId}-list`);
    const trigger = wrapper.querySelector(`#${selectId}-trigger`);
    
    if (selectEl.disabled) {
        trigger.classList.add('disabled');
        trigger.style.opacity = '0.5';
        trigger.style.cursor = 'not-allowed';
        trigger.textContent = placeholder;
        list.innerHTML = '';
        return;
    } else {
        trigger.classList.remove('disabled');
        trigger.style.opacity = '1';
        trigger.style.cursor = 'pointer';
    }
    
    const currentSelected = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
    list.innerHTML = '';
    
    const options = Array.from(selectEl.options).filter(opt => opt.value);
    if (options.length === 0) {
        list.innerHTML = '<div style="padding:10px; color:#8b949e; text-align:center; font-size:12px;">항목이 없습니다.</div>';
    } else {
        options.forEach(opt => {
            const val = opt.value;
            const text = opt.textContent;
            const div = document.createElement('div');
            div.className = 'log-select-item';
            div.dataset.value = val;
            const isSelected = currentSelected.includes(val);
            if (isSelected) div.classList.add('selected');
            
            div.innerHTML = `<span class="check-icon" style="margin-right:8px; opacity:${isSelected ? '1' : '0'}; font-weight:bold; color:#58a6ff; flex-shrink:0;">✓</span><span class="item-text" style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(text)}</span>`;
            div.addEventListener('mousedown', (e) => {
                e.preventDefault(); // 클릭 시 포커스 잃음(blur) 방지로 클릭 이벤트 보장
                e.stopPropagation();
                div.classList.toggle('selected');
                const checkIcon = div.querySelector('.check-icon');
                if (checkIcon) checkIcon.style.opacity = div.classList.contains('selected') ? '1' : '0';
                updateTriggerText();
                selectEl.dispatchEvent(new Event('change'));
            });
            list.appendChild(div);
        });
    }
    
    const updateTriggerText = () => {
        const selected = Array.from(list.querySelectorAll('.log-select-item.selected'));
        if (selected.length === 0) {
            trigger.textContent = placeholder;
            trigger.style.color = '#8b949e';
        } else if (selected.length === 1) {
            trigger.textContent = selected[0].querySelector('.item-text').textContent;
            trigger.style.color = '#e6edf3';
        } else {
            trigger.textContent = `${selected[0].querySelector('.item-text').textContent} 외 ${selected.length - 1}개`;
            trigger.style.color = '#e6edf3';
        }
        trigger.title = selected.map(el => el.querySelector('.item-text').textContent).join('\n');
    };
    
    updateTriggerText();
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
            updateSortEquipSelect(getMultiValues('sort-site-select'), getMultiValues('sort-building-select'), getMultiValues('sort-model-select'), data);
        });
    }

    siteSelect.addEventListener('change', (e) => {
        const sites = getMultiValues('sort-site-select');
        updateSortBuildingSelect(sites);
        updateSortEquipSelect(sites, [], getMultiValues('sort-model-select'), data);
    });
    
    if (buildingSelect) {
        buildingSelect.addEventListener('change', (e) => {
            updateSortEquipSelect(getMultiValues('sort-site-select'), getMultiValues('sort-building-select'), getMultiValues('sort-model-select'), data);
        });
    }
    
    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            updateKeywordSuggestions();
            updateSortDetailType2Select(); // '비정기' 선택에 따른 세부구분2 가시성 제어
        });
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

    // 필터 메뉴 초기화 (모든 옵션 로드)
    updateSortDetailTypeSelect();
    updateSortDetailType2Select();

    // 초기 커스텀 다중 선택 UI 동기화
    syncCustomMultiSelect('sort-site-select', '전체 사업장');
    syncCustomMultiSelect('sort-building-select', '전체 건물');
    syncCustomMultiSelect('sort-equip-select', '전체 장비');
    syncCustomMultiSelect('sort-model-select', '전체 모델');
    syncCustomMultiSelect('sort-type-select', '전체 구분');
    syncCustomMultiSelect('sort-detail-type-select', '전체 세부 구분');
    syncCustomMultiSelect('sort-detail-type2-select', '전체 세부 구분 2');
    syncCustomMultiSelect('sort-item-detail-type-select', '전체 물품 상세');
    syncCustomMultiSelect('sort-cost-type-select', '전체 비용 처리');
    
    setupSortKeyword();
}

function setupSortKeyword() {
    const dropdown = document.getElementById('sort-keyword-dropdown');
    const confirmBtn = document.getElementById('btn-sort-keyword-confirm');
    const input = document.getElementById('sort-keyword');
    
    if (input && dropdown) {
        const showDropdown = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown').forEach(d => { 
                if (d !== dropdown) { d.style.display = 'none'; d.classList.remove('show'); } 
            });
            dropdown.style.display = 'block';
            dropdown.classList.add('show');
            updateKeywordSuggestions();
        };

        input.onclick = showDropdown;
        input.onfocus = showDropdown;

        if (confirmBtn) {
            confirmBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropdown.style.display = 'none';
                dropdown.classList.remove('show');
                updateKeywordTrigger();
            });
        }
        
        input.oninput = () => {
            dropdown.style.display = 'block';
            dropdown.classList.add('show');
            const list = document.getElementById('sort-keyword-list');
            if (list) {
                const kw = input.value.trim().toLowerCase();
                list.querySelectorAll('.log-select-item').forEach(el => {
                    if (el.dataset.value.toLowerCase().includes(kw)) {
                        el.style.display = 'flex';
                    } else {
                        el.style.display = 'none';
                    }
                });
            }
        };
        input.onkeypress = (e) => {
            if (e.key === 'Enter') {
                dropdown.style.display = 'none';
                dropdown.classList.remove('show');
                updateKeywordTrigger();
                performSortSearch();
            }
        };
    }
}

function updateKeywordSuggestions() {
    const keywordList = document.getElementById('sort-keyword-list');
    if (!keywordList) return;
    
    // [요청] 항목/내용 검색 제안박스에 고정된 리스트만 표시하도록 수정
    const suggestionItems = [ 
        "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 / 용자 이상", 
        "파트 이상 (교체)", "파트 이상 (수리)", "프로그램 이상", "단순조치", "기타" 
    ];
    
    const currentSelected = Array.from(keywordList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
    keywordList.innerHTML = '';
    
    Array.from(suggestionItems).sort().forEach(content => {
        const div = document.createElement('div');
        div.className = 'log-select-item';
        const isSelected = currentSelected.includes(content);
        if (isSelected) div.classList.add('selected');
        div.dataset.value = content;
        div.innerHTML = `<span class="check-icon" style="margin-right:8px; opacity:${isSelected ? '1' : '0'}; font-weight:bold; color:#58a6ff; flex-shrink:0;">✓</span><span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(content)}</span>`;
        div.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation(); 
            div.classList.toggle('selected'); 
            const checkIcon = div.querySelector('.check-icon');
            if (checkIcon) checkIcon.style.opacity = div.classList.contains('selected') ? '1' : '0';
            updateKeywordTrigger(); 
        });
        keywordList.appendChild(div);
    });
    
    updateKeywordTrigger();
}

function updateKeywordTrigger() {
    const input = document.getElementById('sort-keyword');
    const list = document.getElementById('sort-keyword-list');
    if (!input) return;
    
    const selected = Array.from(list ? list.querySelectorAll('.log-select-item.selected') : []);
    
    if (selected.length > 0) {
        const text = selected.map(el => el.dataset.value).join(', ');
        input.value = selected.length > 1 ? `${selected[0].dataset.value} 외 ${selected.length-1}개` : text;
        input.style.color = '#58a6ff';
    } else {
        input.style.color = '#e6edf3';
    }
    input.title = selected.length > 0 ? selected.map(el => el.dataset.value).join('\n') : input.value;
}

function updateSortBuildingSelect(sites) {
    const buildingSelect = document.getElementById('sort-building-select');
    if (!buildingSelect) return;
    buildingSelect.innerHTML = '<option value="">전체 건물</option>';
    if (!sites || sites.length === 0) {
        buildingSelect.disabled = true;
        syncCustomMultiSelect('sort-building-select', '전체 건물');
        return;
    }
    let allBuildings = new Set();
    sites.forEach(site => {
        const metaData = JSON.parse(localStorage.getItem(`site_meta_${site}`)) || {};
        const buildings = metaData.buildings || [];
        buildings.forEach(b => allBuildings.add(b));
    });
    
    Array.from(allBuildings).sort().forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        buildingSelect.appendChild(opt);
    });
    buildingSelect.disabled = false;
    syncCustomMultiSelect('sort-building-select', '전체 건물');
}

function updateSortEquipSelect(sites, buildings, models, data) {
    const equipSelect = document.getElementById('sort-equip-select');
    if (!equipSelect) return;
    equipSelect.innerHTML = '<option value="">전체 장비</option>';
    
    if (!sites || sites.length === 0) {
        equipSelect.disabled = true;
        syncCustomMultiSelect('sort-equip-select', '전체 장비');
        return;
    }
    
    // 장비 모델 약어 매핑 (ADMIN 정보 연동)
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    sites.forEach(site => {
        if (!data[site]) return;
        data[site].forEach(equip => {
            const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
            const setup = detailData.setup || {};
            
            if (buildings && buildings.length > 0 && !buildings.includes(setup.building)) return;
    
            const parts = equip.split('::');
            const equipName = parts[0];
            if (models && models.length > 0 && !models.includes(equipName)) return;
            
            const serialNo = parts.length > 1 ? parts[1] : '';
            const matchedModel = equipmentModels.find(m => m.name === equipName);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;
    
            const custEquipName = setup.custEquipName || '';
            let displayText = displayName;
            if (custEquipName) {
                displayText += ` [${custEquipName}]`;
            } else if (serialNo) {
                displayText += ` (${serialNo})`;
            }
    
            const opt = document.createElement('option');
            opt.value = equip;
            opt.textContent = sites.length > 1 ? `${site} - ${displayText}` : displayText;
            equipSelect.appendChild(opt);
        });
    });
    equipSelect.disabled = false;
    syncCustomMultiSelect('sort-equip-select', '전체 장비');
}

function updateSortDetailTypeSelect() {
    const detailTypeSelect = document.getElementById('sort-detail-type-select');
    if (!detailTypeSelect) return;
    
    detailTypeSelect.innerHTML = '<option value="">전체 세부 구분</option>';
    
    detailTypeSelect.disabled = false;
    
    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    let subCategories = new Set();
 // 모든 세부 구분 항목을 가져옴
    Object.keys(catData).forEach(key => {
        catData[key].forEach(cat => subCategories.add(cat));
    });

    Array.from(subCategories).sort().forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        detailTypeSelect.appendChild(opt);

    });
    syncCustomMultiSelect('sort-detail-type-select', '전체 세부 구분');
    updateSortDetailType2Select();
}

function updateSortDetailType2Select() {
    const types = getMultiValues('sort-type-select');
    const detailTypes = getMultiValues('sort-detail-type-select');
    const detailType2Group = document.getElementById('sort-detail-type2-group');
    const detailType2Select = document.getElementById('sort-detail-type2-select');
    
    if (!detailType2Select) return;
    detailType2Select.innerHTML = '<option value="">전체 세부 구분 2</option>';
    
    if (!types.includes('비정기')) {
        if (detailType2Group) detailType2Group.style.display = 'none';
        return;
    }
    if (detailType2Group) detailType2Group.style.display = 'block';
    
    if (!detailTypes || detailTypes.length === 0) {
        detailType2Select.disabled = true;
        syncCustomMultiSelect('sort-detail-type2-select', '전체 세부 구분 2');
        return;
    }
    detailType2Select.disabled = false;
    
    const catData2 = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
    let subCategories2 = new Set();
    detailTypes.forEach(dt => {
        Object.keys(catData2).forEach(key => {
            if (key.includes(`::비정기::${dt}`)) {
                catData2[key].forEach(cat => subCategories2.add(cat));
            }
        });
    });

    Array.from(subCategories2).forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        detailType2Select.appendChild(opt);
    });
    syncCustomMultiSelect('sort-detail-type2-select', '전체 세부 구분 2');
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
    const siteFilters = getMultiValues('sort-site-select');
    const buildingFilters = getMultiValues('sort-building-select');
    const modelFilters = getMultiValues('sort-model-select');
    const equipFilters = getMultiValues('sort-equip-select');
    const typeFilters = getMultiValues('sort-type-select');
    const detailTypeFilters = getMultiValues('sort-detail-type-select');
    const detailType2Filters = getMultiValues('sort-detail-type2-select');
    const itemDetailTypeFilters = getMultiValues('sort-item-detail-type-select');
    const costTypeFilters = getMultiValues('sort-cost-type-select');
    const keywordInputVal = document.getElementById('sort-keyword') ? document.getElementById('sort-keyword').value.trim().toLowerCase() : '';
    const keywordList = document.getElementById('sort-keyword-list');
    const keywordSelected = keywordList ? Array.from(keywordList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value.toLowerCase()) : [];
    
    const periodType = document.getElementById('sort-period-type') ? document.getElementById('sort-period-type').value : 'custom';
    let startDate = '';
    let endDate = '';

    if (periodType === 'month') {
        const monthInput = document.getElementById('sort-month-input');
        const monthVal = monthInput ? monthInput.value : '';
        if (monthVal) {
            const [y, m] = monthVal.split('-').map(Number);
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            const lastDay = new Date(y, m, 0).getDate();
            endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        }
    } else if (periodType === 'year') {
        const yearInput = document.getElementById('sort-year-input');
        const yearVal = yearInput ? yearInput.value : '';
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
        if (siteFilters.length > 0 && !siteFilters.includes(site)) return;
        
        if (data[site]) {
            data[site].forEach(equip => {
                if (equipFilters.length > 0 && !equipFilters.includes(equip)) return;
                
                const parts = equip.split('::');
                const equipName = parts[0];
                if (modelFilters.length > 0 && !modelFilters.includes(equipName)) return;
                
                const serialNo = parts.length > 1 ? parts[1] : '';
                const matchedModel = equipmentModels.find(m => m.name === equipName);
                const displayEquipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;
                
                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
                const equipBuilding = (detailData.setup && detailData.setup.building) ? detailData.setup.building : '';
                
                if (buildingFilters.length > 0 && !buildingFilters.includes(equipBuilding)) return;

                const checkItemMatch = (itemObj, isLog) => {
                    const itemDate = isLog ? itemObj.date : itemObj.scheduledDate;
                    if (!itemDate) return false;
                    if (isLog && itemObj.detailType === '일정변경') return false;
                    
                    if (typeFilters.length > 0 && !typeFilters.includes(itemObj.type)) return false;
                    if (startDate && itemDate < startDate) return false;
                    if (endDate && itemDate > endDate) return false;
                    
                    let dt1 = itemObj.detailType || '';
                    let dt2 = itemObj.detailType2 || '';
                    
                    if (dt1.includes(' > ')) {
                        const ps = dt1.split(' > '); dt1 = ps[0].trim(); dt2 = ps[1].trim();
                    } else if (dt2.includes(' > ')) {
                        const ps = dt2.split(' > '); dt1 = ps[0].trim(); dt2 = ps[1].trim();
                    }
                    
                    if (detailTypeFilters.length > 0 && !detailTypeFilters.includes(dt1)) return false;
                    if (typeFilters.includes('비정기') && detailType2Filters.length > 0 && dt2 && !detailType2Filters.includes(dt2)) return false;

                    const pureContent = itemObj.content || itemObj.code || '';
                    
                    let parsedCostType = '';
                    const costMatch = pureContent.match(/\[(.*?)\]/);
                    if (costMatch) parsedCostType = costMatch[1];
                    const itemCostType = itemObj.costType || itemObj.itemCost || parsedCostType || '유상';
                    
                    if (costTypeFilters.length > 0 && !costTypeFilters.includes(itemCostType)) return false;

                    let matchedItemDetailType = '';
                    const contentsList = pureContent.split(',').map(s => s.replace(/\[.*?\]\s*/g, '').trim());
                    
                    for (const c of contentsList) {
                        const cleanContent = c.replace(/\[지연\]/g, '').trim();
                        const matchItem = adminItems.find(ai => ai.part === cleanContent || ai.code === cleanContent);
                        if (matchItem && matchItem.detailType) {
                            matchedItemDetailType = matchItem.detailType;
                            if (itemDetailTypeFilters.length > 0 && itemDetailTypeFilters.includes(matchedItemDetailType)) break;
                        }
                    }
                    
                    if (itemDetailTypeFilters.length > 0 && !itemDetailTypeFilters.includes(matchedItemDetailType)) return false;
                    
                    const workerText = itemObj.worker || '';
                    if (keywordInputVal || keywordSelected.length > 0) {
                        const searchTarget = `${pureContent} ${workerText} ${displayEquipName} ${custEquipName}`.toLowerCase();
                        
                        let textMatch = true;
                        if (keywordInputVal && keywordSelected.length === 0) {
                            const kws = keywordInputVal.split(/\s+/);
                            textMatch = kws.every(kw => searchTarget.includes(kw));
                        }
                        
                        let selMatch = true;
                        if (keywordSelected.length > 0) {
                            selMatch = keywordSelected.some(kw => searchTarget.includes(kw));
                        }
                        
                        if (!textMatch || !selMatch) return false;
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
    const tbody = document.getElementById('sort-result-tbody');
    const countBadge = document.getElementById('sort-result-count');
    
    if (countBadge) countBadge.textContent = results.length;
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="list-empty-msg" style="text-align:center; padding: 20px; color:#8b949e;">검색된 결과가 없습니다.</td></tr>';
        const exportBtn = document.getElementById('btn-sort-export');
        if (exportBtn) exportBtn.style.display = 'none';
        return;
    }

    const exportBtn = document.getElementById('btn-sort-export');
    if (exportBtn) exportBtn.style.display = 'block';

    results.forEach(row => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onmouseover = () => tr.style.backgroundColor = '#21262d';
        tr.onmouseout = () => tr.style.backgroundColor = 'transparent';
        
        // [요청] 장비명 표시를 모델명(약어), 시리얼, 고객사장비명 순으로 3줄로 변경
        let equipDisplayHtml = `<div>${escapeHtml(row.equipName)}</div>`;
        if (row.serial) {
            equipDisplayHtml += `<div style="font-size:11px; color:#8b949e;">(${escapeHtml(row.serial)})</div>`;
        }
        if (row.custName) {
            equipDisplayHtml += `<div style="font-size:12px; color:#58a6ff;">[${escapeHtml(row.custName)}]</div>`;
        }
        
        const badgeClass = row.type.replace(/\s/g, '');
        const statusColor = row.status === '완료' ? '#3fb950' : '#d29922';

        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${escapeHtml(row.site)}</td>
            <td>${escapeHtml(row.modelName)}</td>
            <td style="text-align: left; padding-left: 10px;">${equipDisplayHtml}</td>
            <td><span class="badge ${badgeClass}" style="padding: 2px 6px; font-size: 11px;">${escapeHtml(row.type)}</span></td>
            <td style="text-align: left; padding-left: 10px;">${escapeHtml(row.detailType)}</td>
            <td style="text-align: left; padding-left: 10px;">${escapeHtml(row.content)}</td>
            <td>${escapeHtml(row.costType)}</td>
            <td title="${escapeHtml(row.worker)}">${escapeHtml(row.worker) || '-'}</td>
            <td>${escapeHtml(row.md)}</td>
            <td style="color: ${statusColor}; font-weight: bold;">${row.status}</td>
        `;
        
        tr.onclick = () => {
            window.location.href = `maintenance.html?site=${encodeURIComponent(row.site)}&equip=${encodeURIComponent(row.equipRaw)}`;
        };
        
        tbody.appendChild(tr);
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