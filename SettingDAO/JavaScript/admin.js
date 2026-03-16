let currentAdminSite = null; // 현재 선택된 사업장
let currentBuildingList = []; // 현재 편집 중인 건물 목록
let currentAdminEquipKey = null; // 장비 관리에서 선택된 장비 키 (Name::Serial)
let equipmentModels = []; // 장비 모델 목록
let currentAdminModel = null; // 선택된 장비 모델
let currentAdminEquipSite = null; // 장비 관리에서 선택된 사업장
let currentAdminEquipSiteContext = null; // [추가] 선택된 장비의 실제 사업장 (전체 보기 시 식별용)
let adminItems = []; // [추가] 물품 목록

document.addEventListener('DOMContentLoaded', () => {
    setupAdminMenu();
    setupSiteMgmt();
    setupEquipModelMgmt();
    setupItemMgmt();
});

// 사이드바 메뉴 탭 전환 기능
function setupAdminMenu() {
    const menuItems = document.querySelectorAll('#admin-menu-list li');
    const sections = document.querySelectorAll('.admin-section');

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            // 1. 메뉴 활성화 상태 변경
            menuItems.forEach(li => li.classList.remove('active'));
            item.classList.add('active');

            // 2. 해당 섹션 표시
            const targetId = `section-${item.dataset.target}`;
            sections.forEach(sec => {
                if (sec.id === targetId) {
                    sec.style.display = 'flex';
                } else {
                    sec.style.display = 'none';
                }

                if (item.dataset.target === 'equip-mgmt') {
                    updateEquipSiteSelect();
                    renderEquipModelList();
                    renderAdminEquipList();
                }
                if (item.dataset.target === 'item-mgmt') {
                    renderAdminItemList();
                }
            });
        });
    });
}

/* ==========================================================================
   사업장 관리 (Site Management)
   ========================================================================== */
function setupSiteMgmt() {
    // 초기 리스트 렌더링
    renderAdminSiteList();

    // 신규 등록 버튼
    const btnAdd = document.getElementById('btn-admin-add-site');
    const inputAdd = document.getElementById('admin-site-add-input');
    
    if (btnAdd && inputAdd) {
        btnAdd.addEventListener('click', () => {
            const newName = inputAdd.value.trim();
            if (!newName) return alert('사업장 이름을 입력해주세요.');
            if (storageData[newName]) return alert('이미 존재하는 사업장입니다.');

            // 데이터 생성
            storageData[newName] = []; // 장비 리스트 초기화
            saveData(); // common.js 함수 (서버 동기화 포함)
            addSystemLog('ADD_SITE', newName, 'Admin Page');
            
            alert('사업장이 등록되었습니다.');
            inputAdd.value = '';
            renderAdminSiteList();
        });

        inputAdd.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') btnAdd.click();
        });
    }

    // 저장 (수정) 버튼
    const btnSave = document.getElementById('btn-admin-save-site');
    if (btnSave) {
        btnSave.addEventListener('click', handleSiteSave);
    }

    // 삭제 버튼
    const btnDel = document.getElementById('btn-admin-del-site');
    if (btnDel) {
        btnDel.addEventListener('click', handleSiteDelete);
    }

    // 건물 추가 버튼
    const btnAddBuilding = document.getElementById('btn-add-building');
    const inputBuilding = document.getElementById('site-info-building-input');
    if (btnAddBuilding && inputBuilding) {
        btnAddBuilding.addEventListener('click', () => {
            const val = inputBuilding.value.trim();
            if (!val) return;
            if (currentBuildingList.includes(val)) return alert('이미 존재하는 건물입니다.');
            currentBuildingList.push(val);
            renderBuildingList();
            inputBuilding.value = '';
            inputBuilding.focus();
        });
        inputBuilding.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') btnAddBuilding.click();
        });
    }
}

function renderAdminSiteList() {
    const list = document.getElementById('admin-site-list');
    const countEl = document.getElementById('admin-site-count');
    if (!list) return;

    list.innerHTML = '';
    const sites = Object.keys(storageData).sort(); // 가나다순 정렬

    if (countEl) countEl.textContent = sites.length;

    sites.forEach(site => {
        const li = document.createElement('li');
        li.textContent = site;
        li.dataset.site = site;
        
        if (currentAdminSite === site) {
            li.classList.add('active');
        }

        li.addEventListener('click', () => {
            currentAdminSite = site;
            // 활성화 스타일 갱신
            list.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            li.classList.add('active');
            // 상세 정보 로드
            loadSiteDetail(site);
        });

        list.appendChild(li);
    });
}

function loadSiteDetail(siteName) {
    const form = document.getElementById('admin-site-form');
    const placeholder = document.getElementById('admin-site-placeholder');
    
    if (form) form.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';

    // 1. 기본 정보 (ID)
    document.getElementById('site-info-name').value = siteName;

    // 2. 추가 정보 (메타데이터) 로드
    const metaKey = `site_meta_${siteName}`;
    const metaData = JSON.parse(localStorage.getItem(metaKey)) || {};

    currentBuildingList = metaData.buildings || [];
    renderBuildingList();
}

function renderBuildingList() {
    const list = document.getElementById('site-info-building-list');
    if (!list) return;
    list.innerHTML = '';

    currentBuildingList.forEach((building, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="item-text">${building}</span><span class="del-btn" style="float: right;">✕</span>`;
        li.querySelector('.del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            currentBuildingList.splice(index, 1);
            renderBuildingList();
        });
        list.appendChild(li);
    });
}

function handleSiteSave() {
    if (!currentAdminSite) return;
    
    const newName = document.getElementById('site-info-name').value.trim();
    if (!newName) return alert('사업장 이름을 입력해주세요.');

    // 1. 이름 변경 시 처리
    if (newName !== currentAdminSite) {
        if (storageData[newName]) return alert('이미 존재하는 사업장 이름입니다.');
        if (!confirm(`사업장 이름을 '${currentAdminSite}'에서 '${newName}'(으)로 변경하시겠습니까?\n관련된 모든 장비 및 데이터가 이동됩니다.`)) return;

        // 데이터 마이그레이션 (handleRename 로직 응용)
        storageData[newName] = storageData[currentAdminSite];
        delete storageData[currentAdminSite];

        // 세부 데이터(details_) 이동
        const oldPrefix = `details_${currentAdminSite}_`;
        const newPrefix = `details_${newName}_`;
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(oldPrefix)) {
                const suffix = key.substring(oldPrefix.length);
                localStorage.setItem(newPrefix + suffix, localStorage.getItem(key));
                localStorage.removeItem(key);
            }
        });
        
        // 메타 데이터 삭제 (새 이름으로 저장은 아래에서 처리)
        localStorage.removeItem(`site_meta_${currentAdminSite}`);
        
        addSystemLog('RENAME_SITE', currentAdminSite, `To: ${newName}`);
        currentAdminSite = newName; // 현재 선택값 갱신
    }

    // 2. 메타데이터 저장 (localStorage에 별도 저장)
    const metaData = {
        buildings: currentBuildingList
    };
    localStorage.setItem(`site_meta_${currentAdminSite}`, JSON.stringify(metaData));

    saveData(); // 전체 동기화
    alert('저장되었습니다.');
    renderAdminSiteList(); // 리스트 갱신 (이름 변경 반영)
}

function handleSiteDelete() {
    if (!currentAdminSite) return;
    
    // common.js 의 로직은 사이드바 UI에 의존하므로, 여기서는 데이터 처리만 수행 후 UI 갱신
    if (!confirm(`'${currentAdminSite}' 사업장을 삭제하시겠습니까?\n포함된 장비와 모든 데이터가 영구 삭제됩니다.`)) return;

    // 1. details_ 데이터 삭제
    const prefix = `details_${currentAdminSite}_`;
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith(prefix)) localStorage.removeItem(k);
    });

    // 2. setup_data 삭제
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    Object.keys(setupData).forEach(k => {
        if (k.startsWith(`${currentAdminSite}::`)) delete setupData[k];
    });
    localStorage.setItem('setup_data', JSON.stringify(setupData));

    // 3. 메타 데이터 삭제
    localStorage.removeItem(`site_meta_${currentAdminSite}`);

    // 4. 메인 데이터 삭제
    delete storageData[currentAdminSite];
    
    addSystemLog('DELETE_SITE', currentAdminSite, 'Admin Page');
    saveData();

    alert('삭제되었습니다.');
    currentAdminSite = null;
    
    // UI 초기화
    document.getElementById('admin-site-form').style.display = 'none';
    document.getElementById('admin-site-placeholder').style.display = 'flex';
    renderAdminSiteList();
}

/* ==========================================================================
   장비 모델 관리 (Equipment Model Management)
   ========================================================================== */
function setupEquipModelMgmt() {
    loadEquipmentModels();
    renderEquipModelList();

    const btnAdd = document.getElementById('btn-admin-add-model');
    const nameInput = document.getElementById('admin-model-name-input');
    const abbrInput = document.getElementById('admin-model-abbr-input');

        const searchInput = document.getElementById('admin-model-search');
        if (searchInput) {
            searchInput.addEventListener('input', renderEquipModelList);
        }

    if (btnAdd) {
        const addModel = () => {
            const name = nameInput.value.trim();
            const abbr = abbrInput.value.trim();
            if (!name || !abbr) return alert('모델명과 약어를 모두 입력해주세요.');
            if (equipmentModels.some(m => m.name === name)) return alert('이미 존재하는 모델명입니다.');

            equipmentModels.push({ name, abbr });
            saveEquipmentModels();
            addSystemLog('ADD_EQUIP_MODEL', name, `Abbr: ${abbr}`);
            
            nameInput.value = '';
            abbrInput.value = '';
            renderEquipModelList();
        };
        btnAdd.addEventListener('click', addModel);
        nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') abbrInput.focus(); });
        abbrInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addModel(); });
    }
}

function loadEquipmentModels() {
    try {
        const data = localStorage.getItem('equipment_models');
        equipmentModels = data ? JSON.parse(data) : [];
    } catch (e) {
        console.error("Error loading equipment models:", e);
        equipmentModels = [];
    }
}

function saveEquipmentModels() {
    localStorage.setItem('equipment_models', JSON.stringify(equipmentModels));
}

function renderEquipModelList() {
    const list = document.getElementById('admin-model-list');
    const countEl = document.getElementById('admin-model-count');
    const searchInput = document.getElementById('admin-model-search');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (!list) return;

    list.innerHTML = '';
    
    let filteredModels = equipmentModels;
    if (keyword) {
        const keywords = keyword.split(/\s+/);
        filteredModels = equipmentModels.filter(m => {
            const text = `${m.name} ${m.abbr}`.toLowerCase();
            return keywords.every(kw => text.includes(kw));
        });
    }

    filteredModels.sort((a, b) => a.name.localeCompare(b.name));
    if (countEl) countEl.textContent = filteredModels.length;

    filteredModels.forEach(model => {
        const li = document.createElement('li');
        if (currentAdminModel && currentAdminModel.name === model.name) {
            li.classList.add('active');
        }
        
        li.innerHTML = `
            <div class="model-col model-name-col"><span>${model.name}</span></div>
            <div class="model-col model-abbr-col"><span>${model.abbr}</span></div>
            <div class="model-col model-actions-col">
                <button class="btn-edit-sm btn-edit-model">✏️</button>
                <button class="btn-del-sm btn-delete-model">✕</button>
            </div>
        `;

        li.addEventListener('click', () => {
            // 수정 중일 때는 선택/해제 기능 비활성화
            if (li.classList.contains('editing')) return;

            currentAdminModel = (currentAdminModel && currentAdminModel.name === model.name) ? null : model;
            renderEquipModelList();
            
            // [수정] 장비 모델 리스트 클릭 시 기존 선택된 장비 정보 폼이 초기화되는 현상 방지
            if (!currentAdminEquipKey && document.getElementById('admin-equip-form').style.display === 'block') {
                // 신규 등록 모드(장비 미선택)일 때만 모델명 자동 입력 및 읽기 전용 처리
                const nameInput = document.getElementById('equip-info-name');
                if (currentAdminModel) {
                    nameInput.value = currentAdminModel.name;
                    nameInput.readOnly = true;
                } else {
                    nameInput.value = '';
                    nameInput.readOnly = false;
                }
            }
        });

        const editBtn = li.querySelector('.btn-edit-model');
        const deleteBtn = li.querySelector('.btn-delete-model');

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`'${model.name}' 모델을 삭제하시겠습니까?\n이 모델을 사용하는 장비가 있을 수 있습니다.`)) return;
            equipmentModels = equipmentModels.filter(m => m.name !== model.name);
            saveEquipmentModels();
            addSystemLog('DELETE_EQUIP_MODEL', model.name);
            if (currentAdminModel && currentAdminModel.name === model.name) currentAdminModel = null;
            renderEquipModelList();
            renderAdminEquipList();
        });

        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isEditing = li.classList.contains('editing');

            if (!isEditing) {
                // 수정 모드 진입
                li.classList.add('editing');
                li.classList.remove('active'); // 선택 효과 제거
                editBtn.textContent = '저장';
                editBtn.classList.replace('btn-edit-sm', 'btn-green-sm');
                const nameCol = li.querySelector('.model-name-col');
                const abbrCol = li.querySelector('.model-abbr-col');
                
                nameCol.innerHTML = `<input type="text" class="input-dark" value="${model.name}" style="width: 100%;">`;
                abbrCol.innerHTML = `<input type="text" class="input-dark" value="${model.abbr}" style="width: 100%;">`;
                
                nameCol.querySelector('input').focus();
            } else {
                // 변경사항 저장
                const nameInput = li.querySelector('.model-name-col input');
                const abbrInput = li.querySelector('.model-abbr-col input');
                const newName = nameInput.value.trim();
                const newAbbr = abbrInput.value.trim();

                if (!newName || !newAbbr) return alert('모델명과 약어를 모두 입력해주세요.');
                if (newName !== model.name && equipmentModels.some(m => m.name === newName)) return alert('이미 존재하는 모델명입니다.');
                
                const shouldMigrate = newName !== model.name;
                if (shouldMigrate && !confirm(`모델명을 변경하면 이 모델을 사용하는 모든 장비의 이름이 함께 변경됩니다.\n계속하시겠습니까?`)) {
                    renderEquipModelList(); // UI 원상 복구
                    return;
                }

                const modelToUpdate = equipmentModels.find(m => m.name === model.name);
                if (modelToUpdate) {
                    const oldModelName = modelToUpdate.name;
                    modelToUpdate.name = newName;
                    modelToUpdate.abbr = newAbbr;

                    if (shouldMigrate) {
                        Object.keys(storageData).forEach(site => {
                            storageData[site] = storageData[site].map(equipKey => {
                                const parts = equipKey.split('::');
                                if (parts[0] === oldModelName) {
                                    const newEquipKey = parts.length > 1 ? `${newName}::${parts[1]}` : newName;
                                    
                                    const oldDetailsKey = `details_${site}_${equipKey}`;
                                    const newDetailsKey = `details_${site}_${newEquipKey}`;
                                    if (localStorage.getItem(oldDetailsKey)) {
                                        localStorage.setItem(newDetailsKey, localStorage.getItem(oldDetailsKey));
                                        localStorage.removeItem(oldDetailsKey);
                                    }
                                    return newEquipKey;
                                }
                                return equipKey;
                            });
                        });
                        saveData();
                    }
                    saveEquipmentModels();
                    addSystemLog('UPDATE_EQUIP_MODEL', oldModelName, `To: ${newName} / ${newAbbr}`);
                    if (currentAdminModel && currentAdminModel.name === oldModelName) currentAdminModel = modelToUpdate;
                    renderEquipModelList();
                    renderAdminEquipList();
                }
            }
        });
        list.appendChild(li);
    });
}

/* ==========================================================================
   장비 관리 (Equipment Management)
   ========================================================================== */
function setupEquipMgmt() {
    // 사업장 선택 필터
    const siteSelect = document.getElementById('admin-equip-site-filter');
    if (siteSelect) {
        siteSelect.addEventListener('change', (e) => {
            currentAdminEquipSite = e.target.value;
            renderAdminEquipList();
        });
    }

    // 장비 검색 필터
    const equipSearchInput = document.getElementById('admin-equip-search');
    if (equipSearchInput) {
        equipSearchInput.addEventListener('input', () => {
            renderAdminEquipList();
        });
    }

    // 신규 등록 모드 버튼
    const btnNew = document.getElementById('btn-admin-new-equip');
    if (btnNew) {
        btnNew.addEventListener('click', () => {
            resetEquipForm();
            document.getElementById('admin-equip-form').style.display = 'block';
            document.getElementById('admin-equip-placeholder').style.display = 'none';
            const siteInput = document.getElementById('equip-info-site');
            siteInput.value = currentAdminEquipSite || '';
            siteInput.disabled = false; // 신규 등록 시에는 사업장 입력 가능
             
            const nameInput = document.getElementById('equip-info-name');
            if (currentAdminModel) {
                nameInput.value = currentAdminModel.name;
                nameInput.readOnly = true;
                document.getElementById('equip-info-serial').focus();
            } else {
                nameInput.readOnly = false;
                nameInput.focus();
            }
        });
    }

    // 저장 및 삭제 버튼
    const btnSave = document.getElementById('btn-admin-save-equip');
    const btnDel = document.getElementById('btn-admin-del-equip');
    if (btnSave) btnSave.addEventListener('click', handleEquipSave);
    if (btnDel) btnDel.addEventListener('click', handleEquipDelete);

    // [추가] 장비명(모델) 자동완성 검색
    const nameInput = document.getElementById('equip-info-name');
    const suggestionList = document.getElementById('equip-model-suggestions');

    if (nameInput && suggestionList) {
        const handleInput = () => {
            if (nameInput.readOnly) return;
            
            const query = nameInput.value.trim().toLowerCase();
            const keywords = query ? query.split(/\s+/) : [];
            // 입력값이 없으면 전체 목록 표시, 있으면 필터링
            const matches = query 
                ? equipmentModels.filter(m => {
                    const text = `${m.name} ${m.abbr}`.toLowerCase();
                    return keywords.every(kw => text.includes(kw));
                })
                : equipmentModels;

            suggestionList.innerHTML = '';
            
            if (matches.length > 0) {
                matches.forEach(m => {
                    const li = document.createElement('li');
                    li.className = 'suggestion-item';
                    li.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span>${m.name}</span>
                            <span style="color:#8b949e; font-size:11px;">${m.abbr}</span>
                        </div>
                    `;
                    
                    // [수정] mousedown을 사용하여 blur보다 먼저 실행되도록 처리 (클릭 씹힘 방지)
                    li.addEventListener('mousedown', (e) => {
                        e.preventDefault(); // 입력창 포커스 유지
                        nameInput.value = m.name;
                        suggestionList.style.display = 'none';
                    });
                    suggestionList.appendChild(li);
                });
                suggestionList.style.display = 'block';
            } else {
                suggestionList.style.display = 'none';
            }
        };

        nameInput.addEventListener('input', handleInput);
        nameInput.addEventListener('focus', handleInput);
        nameInput.addEventListener('blur', () => { setTimeout(() => { suggestionList.style.display = 'none'; }, 150); });
    }

    // [추가] 사업장 검색 제안 (신규 등록 시)
    const siteInput = document.getElementById('equip-info-site');
    const siteSuggestionList = document.getElementById('equip-site-suggestions');

    if (siteInput && siteSuggestionList) {
        const handleSiteInput = () => {
            if (siteInput.disabled) return;
            const query = siteInput.value.trim().toLowerCase();
            const keywords = query ? query.split(/\s+/) : [];
            const sites = Object.keys(storageData).sort();
            
            // 검색어가 있으면 필터링, 없으면 전체 표시
            const matches = query 
                ? sites.filter(s => {
                    const text = s.toLowerCase();
                    return keywords.every(kw => text.includes(kw));
                })
                : sites;

            siteSuggestionList.innerHTML = '';
            if (matches.length > 0) {
                matches.forEach(site => {
                    const li = document.createElement('li');
                    li.className = 'suggestion-item';
                    li.textContent = site;
                    li.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        siteInput.value = site;
                        siteSuggestionList.style.display = 'none';
                    });
                    siteSuggestionList.appendChild(li);
                });
                siteSuggestionList.style.display = 'block';
            } else {
                siteSuggestionList.style.display = 'none';
            }
        };

        siteInput.addEventListener('input', handleSiteInput);
        siteInput.addEventListener('focus', handleSiteInput);
        siteInput.addEventListener('blur', () => { setTimeout(() => { siteSuggestionList.style.display = 'none'; }, 150); });
    }
}

function updateEquipSiteSelect() {
    const select = document.getElementById('admin-equip-site-filter');
    if (!select) return;
    
    const currentVal = select.value;
    select.innerHTML = '<option value="">전체 사업장 보기</option>';
    
    Object.keys(storageData).sort().forEach(site => {
        const opt = document.createElement('option');
        opt.value = site;
        opt.textContent = site;
        select.appendChild(opt);
    });
    
    if (storageData[currentVal]) select.value = currentVal;
}

function renderAdminEquipList() {
    const list = document.getElementById('admin-equip-list');
    const countEl = document.getElementById('admin-equip-count');
    const searchInput = document.getElementById('admin-equip-search');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

    if (!list) return;

    list.innerHTML = '';
    if (countEl) countEl.textContent = '0';

    let items = [];
    if (currentAdminEquipSite && storageData[currentAdminEquipSite]) {
        storageData[currentAdminEquipSite].forEach(k => items.push({site: currentAdminEquipSite, key: k}));
    } else {
        Object.keys(storageData).sort().forEach(site => {
            if (storageData[site]) {
                storageData[site].forEach(k => items.push({site: site, key: k}));
            }
        });
    }

    if (keyword) {
        const keywords = keyword.split(/\s+/);
        items = items.filter(item => {
            const parts = item.key.split('::');
            const name = parts[0] || '';
            const serial = parts.length > 1 ? parts[1] : '';
            const text = `${item.site} ${name} ${serial}`.toLowerCase();
            return keywords.every(kw => text.includes(kw));
        });
    }

    if (countEl) countEl.textContent = items.length;

    items.forEach(item => {
        const fullKey = item.key;
        const site = item.site;
        const parts = fullKey.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';

        const li = document.createElement('li');
        
        let content = `<span>${name}</span> <span style="color:#8b949e; font-size:12px;">${serial ? '(' + serial + ')' : ''}</span>`;
        if (!currentAdminEquipSite) {
            content = `<div style="display:flex; flex-direction:column; gap:2px;"><span style="font-size:11px; color:#8b949e;">${site}</span><div>${content}</div></div>`;
        } else {
            content = `<div>${content}</div>`;
        }
        li.innerHTML = content;
        
        // [수정] 활성화 체크 시 사이트 컨텍스트도 확인
        if (currentAdminEquipKey === fullKey && (!currentAdminEquipSiteContext || currentAdminEquipSiteContext === site)) li.classList.add('active');

        li.addEventListener('click', () => {
            currentAdminEquipKey = fullKey;
            currentAdminEquipSiteContext = site; // 컨텍스트 저장
            // UI 업데이트
            list.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            li.classList.add('active');
            
            // 폼 로드
            document.getElementById('admin-equip-form').style.display = 'block';
            document.getElementById('admin-equip-placeholder').style.display = 'none';
            document.getElementById('equip-info-site').value = site; // [수정] 아이템의 실제 사업장 입력
            document.getElementById('equip-info-site').disabled = true; // [추가] 기존 장비 수정 시 사업장 변경 불가
            document.getElementById('equip-info-name').value = name;
            document.getElementById('equip-info-name').readOnly = false; // [추가] 기존 장비 클릭 시 모델명 수정 가능하도록 잠금 해제
            document.getElementById('equip-info-serial').value = serial;
        });

        list.appendChild(li);
    });
}

function resetEquipForm() {
    currentAdminEquipKey = null;
    currentAdminEquipSiteContext = null;
    document.getElementById('admin-equip-form').style.display = 'none';
    document.getElementById('admin-equip-placeholder').style.display = 'flex';
    const nameInput = document.getElementById('equip-info-name');
    nameInput.value = '';
    nameInput.readOnly = false;
    document.getElementById('equip-info-serial').value = '';

    // 자동완성 목록 숨김
    const suggestionList = document.getElementById('equip-model-suggestions');
    if (suggestionList) suggestionList.style.display = 'none';
    const siteSuggestionList = document.getElementById('equip-site-suggestions');
    if (siteSuggestionList) siteSuggestionList.style.display = 'none';
    
    const list = document.getElementById('admin-equip-list');
    if(list) list.querySelectorAll('li').forEach(l => l.classList.remove('active'));
}

function handleEquipSave() {
    // [수정] 현재 필터값이 없어도(전체보기) 폼에 입력된 사업장 기준으로 저장 수행
    const targetSite = document.getElementById('equip-info-site').value.trim();
    if (!targetSite) return alert('사업장을 선택하거나 목록에서 장비를 선택해주세요.');
    if (!storageData[targetSite]) return alert('존재하지 않는 사업장입니다. 사업장 관리에서 먼저 등록해주세요.');

    const nameInput = document.getElementById('equip-info-name');
    const name = nameInput.value.trim();
    const serial = document.getElementById('equip-info-serial').value.trim();
    
    if (!name) return alert('장비명(모델)을 입력해주세요.');
    
    const newKey = serial ? `${name}::${serial}` : name;
    
    // 중복 체크 (수정이면 자기 자신 제외)
    if (currentAdminEquipKey !== newKey && storageData[targetSite].includes(newKey)) {
        return alert('해당 사업장에 이미 동일한 장비가 존재합니다.');
    }

    // 수정 (Rename) 처리
    if (currentAdminEquipKey && currentAdminEquipKey !== newKey) {
        if(!confirm('장비 정보를 변경하시겠습니까?\n기존 데이터가 새 정보로 이동됩니다.')) return;
        
        // 리스트 내 키 변경
        const idx = storageData[targetSite].indexOf(currentAdminEquipKey);
        if (idx !== -1) storageData[targetSite][idx] = newKey;
        
        // details 데이터 이동
        const oldData = localStorage.getItem(`details_${targetSite}_${currentAdminEquipKey}`);
        if (oldData) {
            localStorage.setItem(`details_${targetSite}_${newKey}`, oldData);
            localStorage.removeItem(`details_${targetSite}_${currentAdminEquipKey}`);
        }
        
        // setup_data 이동
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const oldSetupKey = `${targetSite}::${currentAdminEquipKey}`;
        if (setupData[oldSetupKey]) {
            setupData[`${targetSite}::${newKey}`] = setupData[oldSetupKey];
            delete setupData[oldSetupKey];
            localStorage.setItem('setup_data', JSON.stringify(setupData));
        }
        
        addSystemLog('UPDATE_EQUIP', newKey, `From: ${currentAdminEquipKey}`);
    } 
    // 신규 등록
    else if (!currentAdminEquipKey) {
        storageData[targetSite].push(newKey);
        // 초기 데이터 생성
        const initData = { maint: [], logs: [], memo: "", setup: { model: serial } }; // Serial을 모델란에 저장 (관례)
        localStorage.setItem(`details_${targetSite}_${newKey}`, JSON.stringify(initData));
        addSystemLog('ADD_EQUIP', newKey, `Site: ${targetSite}`);
    }

    saveData();
    alert('저장되었습니다.');
    currentAdminEquipKey = newKey; // 키 갱신
    renderAdminEquipList();
    nameInput.readOnly = false; // [수정] 저장 후에는 기존 장비 선택 상태가 되므로 잠금 해제
}

function handleEquipDelete() {
    const targetSite = document.getElementById('equip-info-site').value;
    if (!targetSite || !currentAdminEquipKey) return;
    
    if (!confirm(`'${currentAdminEquipKey}' 장비를 삭제하시겠습니까?\n모든 점검 이력과 데이터가 삭제됩니다.`)) return;

    // 리스트에서 제거
    storageData[targetSite] = storageData[targetSite].filter(k => k !== currentAdminEquipKey);
    
    // details 제거
    localStorage.removeItem(`details_${targetSite}_${currentAdminEquipKey}`);
    
    // setup_data 제거
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    delete setupData[`${targetSite}::${currentAdminEquipKey}`];
    localStorage.setItem('setup_data', JSON.stringify(setupData));
    
    addSystemLog('DELETE_EQUIP', currentAdminEquipKey, `Site: ${targetSite}`);
    
    saveData();
    alert('삭제되었습니다.');
    resetEquipForm();
    renderAdminEquipList();
}

/* ==========================================================================
   물품 관리 (Item Management)
   ========================================================================== */
function setupItemMgmt() {
    loadAdminItems();

    const btnAdd = document.getElementById('btn-admin-add-item');
    const typeInput = document.getElementById('admin-item-type-input');
    const partInput = document.getElementById('admin-item-part-input');
    const specInput = document.getElementById('admin-item-spec-input');
    const cycleInput = document.getElementById('admin-item-cycle-input');

    const searchInput = document.getElementById('admin-item-search');
    if (searchInput) {
        searchInput.addEventListener('input', renderAdminItemList);
    }

    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const type = typeInput.value;
            const part = partInput.value.trim();
            const spec = specInput.value.trim();
            const cycle = cycleInput.value.trim();

            if (!part) return alert('교체(수리) 파츠 명을 입력해주세요.');

            adminItems.push({ id: Date.now(), type, part, spec, cycle });
            saveAdminItems();
            addSystemLog('ADD_ITEM_ADMIN', part, `Type: ${type}, Spec: ${spec}, Cycle: ${cycle}`);
            
            partInput.value = '';
            specInput.value = '';
            cycleInput.value = '';
            renderAdminItemList();
            partInput.focus();
        });
        
        partInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') specInput.focus(); });
        specInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') cycleInput.focus(); });
        cycleInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnAdd.click(); });
    }
}

function loadAdminItems() {
    try {
        const data = localStorage.getItem('admin_items');
        adminItems = data ? JSON.parse(data) : [];
    } catch (e) {
        console.error(e);
        adminItems = [];
    }
}

function saveAdminItems() {
    localStorage.setItem('admin_items', JSON.stringify(adminItems));
}

function renderAdminItemList() {
    const list = document.getElementById('admin-item-list');
    const countEl = document.getElementById('admin-item-count');
    const searchInput = document.getElementById('admin-item-search');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (!list) return;

    list.innerHTML = '';
    
    let filteredItems = adminItems;
    if (keyword) {
        const keywords = keyword.split(/\s+/);
        filteredItems = adminItems.filter(item => {
            const text = `${item.type} ${item.part} ${item.spec || ''}`.toLowerCase();
            return keywords.every(kw => text.includes(kw));
        });
    }

    if (countEl) countEl.textContent = filteredItems.length;

    filteredItems.forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="model-col col-item-type">
                <span class="badge ${item.type.toLowerCase()}">${item.type}</span>
            </div>
            <div class="model-col col-item-part">
                ${item.part}
            </div>
            <div class="model-col col-item-spec">
                ${item.spec || '-'}
            </div>
            <div class="model-col col-item-cycle">
                ${item.cycle ? item.cycle + '일' : '-'}
            </div>
            <div class="model-col model-actions-col col-item-actions">
                <button class="btn-edit-sm btn-edit-item">✏️</button>
                <button class="btn-del-sm btn-delete-item">✕</button>
            </div>
        `;

        const editBtn = li.querySelector('.btn-edit-item');
        const deleteBtn = li.querySelector('.btn-delete-item');

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`'${item.part}' 물품을 삭제하시겠습니까?`)) return;
            adminItems = adminItems.filter(i => i.id !== item.id);
            saveAdminItems();
            addSystemLog('DELETE_ITEM_ADMIN', item.part);
            renderAdminItemList();
        });

        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isEditing = li.classList.contains('editing');

            if (!isEditing) {
                li.classList.add('editing');
                editBtn.textContent = '저장';
                editBtn.classList.replace('btn-edit-sm', 'btn-green-sm');
                
                const typeCol = li.children[0];
                const partCol = li.children[1];
                const specCol = li.children[2];
                const cycleCol = li.children[3];
                
                typeCol.innerHTML = `
                    <select class="input-dark compact-select input-item-type item-edit-input">
                        <option value="PM" ${item.type === 'PM' ? 'selected' : ''}>PM</option>
                        <option value="BM" ${item.type === 'BM' ? 'selected' : ''}>BM</option>
                        <option value="기타" ${item.type === '기타' ? 'selected' : ''}>기타</option>
                    </select>
                `;
                partCol.innerHTML = `<input type="text" class="input-dark input-item-part item-edit-input" value="${item.part}">`;
                specCol.innerHTML = `<input type="text" class="input-dark input-item-spec item-edit-input" value="${item.spec || ''}">`;
                cycleCol.innerHTML = `<input type="number" class="input-dark input-item-cycle item-edit-input" value="${item.cycle || ''}">`;
            } else {
                const newType = li.children[0].querySelector('select').value.trim();
                const newPart = li.children[1].querySelector('input').value.trim();
                const newSpec = li.children[2].querySelector('input').value.trim();
                const newCycle = li.children[3].querySelector('input').value.trim();

                if (!newPart) return alert('교체(수리) 파츠 명을 입력해주세요.');

                item.type = newType;
                item.part = newPart;
                item.spec = newSpec;
                item.cycle = newCycle;

                saveAdminItems();
                addSystemLog('UPDATE_ITEM_ADMIN', item.part, `To: ${newType} / ${newPart} / ${newSpec} / ${newCycle}`);
                renderAdminItemList();
            }
        });

        list.appendChild(li);
    });
}

// [추가] 초기화 시 장비 관리 이벤트 등록
const originalSetupAdminMenu = setupAdminMenu; // 기존 함수 보존
setupAdminMenu = function() {
    originalSetupAdminMenu(); // 기존 로직 실행
    setupEquipMgmt(); // 장비 관리 로직 초기화
};