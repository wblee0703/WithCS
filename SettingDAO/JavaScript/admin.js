let currentAdminSite = null; // 현재 선택된 사업장
let currentBuildingList = []; // 현재 편집 중인 건물 목록
let currentAdminEquipKey = null; // 장비 관리에서 선택된 장비 키 (Name::Serial)
let equipmentModels = []; // 장비 모델 목록
let currentAdminModel = null; // 선택된 장비 모델
let currentAdminEquipSite = null; // 장비 관리에서 선택된 사업장
let currentAdminEquipSiteContext = null; // [추가] 선택된 장비의 실제 사업장 (전체 보기 시 식별용)
let adminItems = []; // [추가] 물품 목록
let currentAdminItemId = null; // [추가] 선택된 물품 ID

// [추가] 점검 구분 관리 상태 변수
let currentCheckTypeEquipKey = null;
let currentCheckTypeSiteContext = null;
let currentCheckTypeCategory = null;
let currentCheckTypeSubCategory = null; // [추가] 선택된 분류
let checkTypeCategoriesData = {}; // [추가] 분류 저장소
let checkTypeItemsData = {}; // [추가] 세부 항목 저장소

document.addEventListener('DOMContentLoaded', () => {
    const initAdmin = () => {
        setupAdminMenu();
        setupSiteMgmt();
        setupEquipModelMgmt();
        setupItemMgmt();
        
        // 모든 설정 완료 후 마지막 작업 탭 복원
        restoreLastAdminSection();
    };

    if (window.isDataLoaded) {
        initAdmin();
    } else {
        window.addEventListener('DataLoaded', initAdmin);
    }
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
            
            // [추가] 선택된 메뉴 상태를 로컬 스토리지에 저장
            localStorage.setItem('lastAdminSection', item.dataset.target);

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
                if (item.dataset.target === 'check-type-mgmt') {
                    updateCheckTypeSiteSelect();
                    renderCheckTypeEquipList();
                }
            });
        });
    });
}

// [추가] 마지막으로 선택했던 어드민 메뉴 탭을 복원하는 함수
function restoreLastAdminSection() {
    const lastSection = localStorage.getItem('lastAdminSection');
    if (lastSection) {
        const menuItems = document.querySelectorAll('#admin-menu-list li');
        const targetItem = Array.from(menuItems).find(li => li.dataset.target === lastSection);
        if (targetItem) {
            targetItem.click();
        }
    }
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

    if (typeof saveData === 'function') saveData(); // 전체 동기화
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
    if (typeof saveData === 'function') saveData();

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

    // [추가] 장비 모델 관리 모드 토글
    const btnModelSettings = document.getElementById('btn-model-settings');
    const modelContainer = document.getElementById('admin-model-container');
    if (btnModelSettings && modelContainer) {
        btnModelSettings.addEventListener('click', () => {
            modelContainer.classList.toggle('management-active');
            if (modelContainer.classList.contains('management-active')) {
                btnModelSettings.classList.add('active');
            } else {
                btnModelSettings.classList.remove('active');
                renderEquipModelList(); // 관리 모드 종료 시 편집 중이던 상태 초기화
            }
        });
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
    if (typeof saveData === 'function') saveData();
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
                } else {
                    nameInput.value = '';
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
             
            // [추가] 선택된 사업장이 있으면 건물 목록도 업데이트
            if (currentAdminEquipSite) {
                updateEquipBuildingDropdown(currentAdminEquipSite);
            }

            const nameInput = document.getElementById('equip-info-name');
            if (currentAdminModel) {
                nameInput.value = currentAdminModel.name;
                document.getElementById('equip-info-serial').focus();
            } else {
                nameInput.value = '';
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
        const showList = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (suggestionList.style.display === 'block') {
                suggestionList.style.display = 'none';
                return;
            }

            suggestionList.innerHTML = '';
            const matches = equipmentModels;
            
            if (matches.length > 0) {
                matches.forEach(m => {
                    const li = document.createElement('li');
                    li.className = 'suggestion-item';
                    li.innerHTML = `
                        <div class="suggestion-item-content">
                            <span>${m.name}</span>
                            <span class="abbr">${m.abbr}</span>
                        </div>
                    `;
                    
                    li.addEventListener('mousedown', (ev) => {
                        ev.preventDefault();
                        nameInput.value = m.name;
                        suggestionList.style.display = 'none';
                    });
                    suggestionList.appendChild(li);
                });
                suggestionList.style.display = 'block';
            } else {
                suggestionList.innerHTML = '<li class="suggestion-item" style="text-align:center; color:#8b949e; cursor:default;">등록된 장비 모델이 없습니다.</li>';
                suggestionList.style.display = 'block';
            }
        };

        nameInput.addEventListener('click', showList);

        // 외부 클릭 시 제안 목록 닫기
        document.addEventListener('click', (e) => {
            if (suggestionList.style.display === 'block' && e.target !== nameInput && !suggestionList.contains(e.target)) {
                suggestionList.style.display = 'none';
            }
        });
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
                        updateEquipBuildingDropdown(site); // [추가]
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
        siteInput.addEventListener('blur', () => { 
            setTimeout(() => { 
                siteSuggestionList.style.display = 'none'; 
                updateEquipBuildingDropdown(siteInput.value.trim()); // [추가] 
            }, 150); 
        });
    }
}

function updateEquipBuildingDropdown(siteName, selectedValue = '') {
    const select = document.getElementById('equip-info-building');
    if (!select) return;
    
    select.innerHTML = '<option value="">건물 선택</option>';
    if (!siteName) return;

    const metaData = JSON.parse(localStorage.getItem(`site_meta_${siteName}`)) || {};
    const buildings = metaData.buildings || [];
    
    buildings.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        if (b === selectedValue) opt.selected = true;
        select.appendChild(opt);
    })
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
            document.getElementById('equip-info-serial').value = serial;

            // [추가] 건물명 및 세부위치 렌더링
            const detailData = JSON.parse(localStorage.getItem(`details_${site}_${fullKey}`)) || {};
            const setupInfo = detailData.setup || {};
            
            updateEquipBuildingDropdown(site, setupInfo.building || '');
            document.getElementById('equip-info-cust-equip-name').value = setupInfo.custEquipName || '';
            document.getElementById('equip-info-floor').value = setupInfo.floor || '';
            document.getElementById('equip-info-location').value = setupInfo.detailLoc || '';
            document.getElementById('equip-info-manager').value = setupInfo.manager || '';
            document.getElementById('equip-info-contact').value = setupInfo.contact || '';
            document.getElementById('equip-info-email').value = setupInfo.email || '';
            document.getElementById('equip-info-cust-manager').value = setupInfo.custManager || '';
            document.getElementById('equip-info-cust-contact').value = setupInfo.custContact || '';
            document.getElementById('equip-info-cust-email').value = setupInfo.custEmail || '';
            document.getElementById('equip-info-special-note').value = detailData.specialNote || '';
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
    document.getElementById('equip-info-serial').value = '';

    // [추가] 필드 초기화
    const bSelect = document.getElementById('equip-info-building');
    if (bSelect) bSelect.innerHTML = '<option value="">건물 선택</option>';

    ['equip-info-location', 'equip-info-cust-equip-name', 'equip-info-floor', 
     'equip-info-manager', 'equip-info-contact', 'equip-info-email', 
     'equip-info-cust-manager', 'equip-info-cust-contact', 'equip-info-cust-email', 'equip-info-special-note'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

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
    
    // [추가]
    const building = document.getElementById('equip-info-building').value;
    const location = document.getElementById('equip-info-location').value.trim();
    const custEquipName = document.getElementById('equip-info-cust-equip-name').value.trim();
    const floor = document.getElementById('equip-info-floor').value.trim();
    const manager = document.getElementById('equip-info-manager').value.trim();
    const contact = document.getElementById('equip-info-contact').value.trim();
    const email = document.getElementById('equip-info-email').value.trim();
    const custManager = document.getElementById('equip-info-cust-manager').value.trim();
    const custContact = document.getElementById('equip-info-cust-contact').value.trim();
    const custEmail = document.getElementById('equip-info-cust-email').value.trim();
    const specialNote = document.getElementById('equip-info-special-note').value.trim();

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
        let parsedData = oldData ? JSON.parse(oldData) : { maint: [], logs: [], memo: "", setup: {} };
        
        if (!parsedData.setup) parsedData.setup = {};
        parsedData.setup.model = serial;
        parsedData.setup.building = building;
        parsedData.setup.detailLoc = location;
        parsedData.setup.custEquipName = custEquipName;
        parsedData.setup.floor = floor;
        parsedData.setup.manager = manager;
        parsedData.setup.contact = contact;
        parsedData.setup.email = email;
        parsedData.setup.custManager = custManager;
        parsedData.setup.custContact = custContact;
        parsedData.setup.custEmail = custEmail;
        parsedData.specialNote = specialNote;

        localStorage.setItem(`details_${targetSite}_${newKey}`, JSON.stringify(parsedData));
        if (oldData) {
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
    // 기존 정보 단순 업데이트
    else if (currentAdminEquipKey && currentAdminEquipKey === newKey) {
        const dataKey = `details_${targetSite}_${newKey}`;
        let parsedData = JSON.parse(localStorage.getItem(dataKey)) || { maint: [], logs: [], memo: "", setup: {} };
        if (!parsedData.setup) parsedData.setup = {};
        parsedData.setup.model = serial;
        parsedData.setup.building = building;
        parsedData.setup.detailLoc = location;
        parsedData.setup.custEquipName = custEquipName;
        parsedData.setup.floor = floor;
        parsedData.setup.manager = manager;
        parsedData.setup.contact = contact;
        parsedData.setup.email = email;
        parsedData.setup.custManager = custManager;
        parsedData.setup.custContact = custContact;
        parsedData.setup.custEmail = custEmail;
        parsedData.specialNote = specialNote;
        localStorage.setItem(dataKey, JSON.stringify(parsedData));
    }
    // 신규 등록
    else if (!currentAdminEquipKey) {
        storageData[targetSite].push(newKey);
        // 초기 데이터 생성
        const initData = { maint: [], logs: [], memo: "", specialNote: specialNote, setup: { 
            model: serial, 
            building: building, 
            detailLoc: location,
            custEquipName: custEquipName,
            floor: floor,
            manager: manager,
            contact: contact,
            email: email,
            custManager: custManager,
            custContact: custContact,
            custEmail: custEmail
        } }; 
        localStorage.setItem(`details_${targetSite}_${newKey}`, JSON.stringify(initData));
        addSystemLog('ADD_EQUIP', newKey, `Site: ${targetSite}`);
    }

    if (typeof saveData === 'function') saveData();
    alert('저장되었습니다.');
    currentAdminEquipKey = newKey; // 키 갱신
    renderAdminEquipList();
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
    
    if (typeof saveData === 'function') saveData();
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
    const codeInput = document.getElementById('admin-item-code-input');
    const partInput = document.getElementById('admin-item-part-input');
    const specInput = document.getElementById('admin-item-spec-input');
    const cycleInput = document.getElementById('admin-item-cycle-input');

    const searchInput = document.getElementById('admin-item-search');
    if (searchInput) {
        searchInput.addEventListener('input', renderAdminItemList);
    }

    // [추가] 점검 구분에 따른 교체주기 비활성화 (물품 추가 폼)
    if (typeInput && cycleInput) {
        typeInput.addEventListener('change', () => {
            if (typeInput.value === 'PM') {
                cycleInput.disabled = false;
                cycleInput.placeholder = '주기(일)';
            } else {
                cycleInput.disabled = true;
                cycleInput.value = '';
                cycleInput.placeholder = '주기 없음';
            }
        });
        // 초기 상태 반영
        typeInput.dispatchEvent(new Event('change'));
    }

    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const type = typeInput.value;
            const code = codeInput ? codeInput.value.trim() : "";
            const part = partInput.value.trim();
            const spec = specInput.value.trim();
            const cycle = type === 'PM' ? cycleInput.value.trim() : "";

            if (!part) return alert('물품명을 입력해주세요.');

            adminItems.push({ id: Date.now(), type, detailType: '', part, spec, cycle, code, partno: '', equip: '' });
            saveAdminItems();
            addSystemLog('ADD_ITEM_ADMIN', part, `Type: ${type}, Spec: ${spec}, Cycle: ${cycle}`);
            
            if (codeInput) codeInput.value = '';
            partInput.value = '';
            specInput.value = '';
            if (type === 'PM') cycleInput.value = '';
            renderAdminItemList();
            partInput.focus();
        });
        
        if (codeInput) codeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') partInput.focus(); });
        partInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') specInput.focus(); });
        specInput.addEventListener('keypress', (e) => { 
            if (e.key === 'Enter') {
                if (!cycleInput.disabled) cycleInput.focus();
                else btnAdd.click();
            }
        });
        cycleInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnAdd.click(); });
    }

    // 상세 정보 폼 이벤트
    const btnSaveDetail = document.getElementById('btn-admin-save-item-detail');
    const btnDelDetail = document.getElementById('btn-admin-del-item-detail');

    // [추가] 점검 구분에 따른 교체주기 비활성화 (물품 상세 정보 폼)
    const detailTypeInput = document.getElementById('item-info-type');
    const detailCycleInput = document.getElementById('item-info-cycle');

    if (detailTypeInput && detailCycleInput) {
        detailTypeInput.addEventListener('change', () => {
            if (detailTypeInput.value === 'PM') {
                detailCycleInput.disabled = false;
                detailCycleInput.placeholder = '';
            } else {
                detailCycleInput.disabled = true;
                detailCycleInput.value = '';
                detailCycleInput.placeholder = '주기 없음';
            }
        });
    }

    if (btnSaveDetail) btnSaveDetail.addEventListener('click', handleItemDetailSave);
    if (btnDelDetail) btnDelDetail.addEventListener('click', handleItemDetailDelete);

    // 장비 모델 제안 박스 설정
    const btnAddEquip = document.getElementById('btn-add-item-equip');
    const equipHiddenInput = document.getElementById('item-info-equip');
    const equipSuggestionList = document.getElementById('item-equip-suggestions');

    if (btnAddEquip && equipSuggestionList) {
        btnAddEquip.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (equipSuggestionList.style.display === 'block') {
                equipSuggestionList.style.display = 'none';
                return;
            }

            equipSuggestionList.innerHTML = '';
            const matches = equipmentModels;
            
            if (matches.length > 0) {
                const currentEquips = equipHiddenInput.value ? equipHiddenInput.value.split(',').map(ev => ev.trim()).filter(ev => ev) : [];
                matches.forEach(m => {
                    const li = document.createElement('li');
                    li.className = 'suggestion-item';
                    li.innerHTML = `
                        <div class="suggestion-item-content">
                            <span>${m.name}</span>
                            <span class="abbr">${m.abbr}</span>
                        </div>
                    `;
                    
                    li.addEventListener('mousedown', (ev) => {
                        ev.preventDefault();
                        if (!currentEquips.includes(m.name)) {
                            currentEquips.push(m.name);
                            equipHiddenInput.value = currentEquips.join(', ');
                            renderEquipTags();
                        }
                        equipSuggestionList.style.display = 'none';
                    });
                    equipSuggestionList.appendChild(li);
                });
                equipSuggestionList.style.display = 'block';
            } else {
                equipSuggestionList.innerHTML = '<li class="suggestion-item" style="text-align:center; color:#8b949e; cursor:default;">등록된 장비가 없습니다.</li>';
                equipSuggestionList.style.display = 'block';
            }
        });

        // 외부 클릭 시 제안 목록 닫기
        document.addEventListener('click', (e) => {
            if (equipSuggestionList.style.display === 'block' && e.target !== btnAddEquip && !equipSuggestionList.contains(e.target)) {
                equipSuggestionList.style.display = 'none';
            }
        });
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
    if (typeof saveData === 'function') saveData();
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
            const text = `${item.type || ''} ${item.detailType || ''} ${item.part || ''} ${item.spec || ''} ${item.code || ''} ${item.partno || ''} ${item.equip || ''}`.toLowerCase();
            return keywords.every(kw => text.includes(kw));
        });
    }

    if (countEl) countEl.textContent = filteredItems.length;

    filteredItems.forEach(item => {
        const li = document.createElement('li');
        if (currentAdminItemId === item.id) {
            li.classList.add('active');
        }
        li.innerHTML = `
            <div class="model-col col-item-type">
                <span class="badge ${item.type.toLowerCase()}">${item.type}</span>
            </div>
            <div class="model-col col-item-code">
                ${item.code || '-'}
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
        `;

        li.addEventListener('click', () => {
            currentAdminItemId = item.id;
            list.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            li.classList.add('active');
            
            loadItemDetail(item);
        });

        list.appendChild(li);
    });
}

// [추가] 장비 태그 렌더링 함수
function renderEquipTags() {
    const equipHiddenInput = document.getElementById('item-info-equip');
    const equipTagsContainer = document.getElementById('item-equip-tags');
    if (!equipHiddenInput || !equipTagsContainer) return;

    equipTagsContainer.innerHTML = '';
    const currentEquips = equipHiddenInput.value ? equipHiddenInput.value.split(',').map(e => e.trim()).filter(e => e) : [];
    
    currentEquips.forEach(equip => {
        const tag = document.createElement('div');
        tag.className = 'tag-item';
        tag.innerHTML = `<span>${equip}</span><span class="tag-remove" title="삭제">✕</span>`;
        tag.querySelector('.tag-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            const newEquips = currentEquips.filter(e => e !== equip);
            equipHiddenInput.value = newEquips.join(', ');
            renderEquipTags();
        });
        equipTagsContainer.appendChild(tag);
    });
}

function loadItemDetail(item) {
    const form = document.getElementById('admin-item-form');
    const placeholder = document.getElementById('admin-item-placeholder');
    
    if (form) form.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';

    document.getElementById('item-info-type').value = item.type || 'PM';
    document.getElementById('item-info-detail-type').value = item.detailType || '';
    document.getElementById('item-info-part').value = item.part || '';
    document.getElementById('item-info-spec').value = item.spec || '';
    
    const cycleInput = document.getElementById('item-info-cycle');
    if ((item.type || 'PM') === 'PM') {
        cycleInput.disabled = false;
        cycleInput.value = item.cycle || '';
        cycleInput.placeholder = '';
    } else {
        cycleInput.disabled = true;
        cycleInput.value = '';
        cycleInput.placeholder = '주기 없음';
    }

    document.getElementById('item-info-code').value = item.code || '';
    document.getElementById('item-info-partno').value = item.partno || '';
    document.getElementById('item-info-equip').value = item.equip || '';
    
    renderEquipTags(); // 기존 저장된 장비 데이터들을 태그로 변환하여 표시
}

function handleItemDetailSave() {
    if (!currentAdminItemId) return;
    
    const type = document.getElementById('item-info-type').value;
    const detailType = document.getElementById('item-info-detail-type').value.trim();
    const part = document.getElementById('item-info-part').value.trim();
    const spec = document.getElementById('item-info-spec').value.trim();
    const cycle = type === 'PM' ? document.getElementById('item-info-cycle').value.trim() : "";
    const code = document.getElementById('item-info-code').value.trim();
    const partno = document.getElementById('item-info-partno').value.trim();
    const equipRaw = document.getElementById('item-info-equip').value;
    const equip = equipRaw.split(',').map(e => e.trim()).filter(e => e).join(', '); // 불필요한 빈칸 및 쉼표 제거

    if (!part) return alert('물품명을 입력해주세요.');

    const idx = adminItems.findIndex(i => i.id === currentAdminItemId);
    if (idx > -1) {
        adminItems[idx] = { ...adminItems[idx], type, detailType, part, spec, cycle, code, partno, equip };
        saveAdminItems();
        addSystemLog('UPDATE_ITEM_ADMIN_DETAIL', part, `Type: ${type}, Code: ${code}`);
        alert('물품 정보가 저장되었습니다.');
        renderAdminItemList();
    }
}

function handleItemDetailDelete() {
    if (!currentAdminItemId) return;
    
    const item = adminItems.find(i => i.id === currentAdminItemId);
    if (!item) return;

    if (!confirm(`'${item.part}' 물품을 삭제하시겠습니까?`)) return;

    adminItems = adminItems.filter(i => i.id !== currentAdminItemId);
    saveAdminItems();
    addSystemLog('DELETE_ITEM_ADMIN', item.part);
    
    currentAdminItemId = null;
    document.getElementById('admin-item-form').style.display = 'none';
    document.getElementById('admin-item-placeholder').style.display = 'flex';
    
    renderAdminItemList();
}

/* ==========================================================================
   점검 구분 관리 (Check Type Management)
   ========================================================================== */
function setupCheckTypeMgmt() {
    loadCheckTypeCategories();
    loadCheckTypeItems();

    const siteSelect = document.getElementById('check-type-site-filter');
    if (siteSelect) {
        siteSelect.addEventListener('change', (e) => {
            currentCheckTypeSiteContext = e.target.value;
            renderCheckTypeEquipList();
        });
    }

    // [추가] 다른 장비 설정 불러오기
    const btnLoad = document.getElementById('btn-load-check-type');
    if (btnLoad) {
        btnLoad.addEventListener('click', openCheckTypeLoadModal);
    }
    setupCheckTypeLoadModal();

    const searchInput = document.getElementById('check-type-equip-search');
    if (searchInput) {
        searchInput.addEventListener('input', renderCheckTypeEquipList);
    }

    const categoryItems = document.querySelectorAll('#check-type-category-list li');
    categoryItems.forEach(li => {
        li.addEventListener('click', () => {
            if (!currentCheckTypeEquipKey) return;
            
            categoryItems.forEach(item => item.classList.remove('active'));
            li.classList.add('active');
            currentCheckTypeCategory = li.dataset.type;
            
            // [변경] 분류 패널 활성화
            const subList = document.getElementById('check-type-subcategory-list');
            const subFooter = document.getElementById('check-type-subcategory-footer');
            subList.style.opacity = '1';
            subList.style.pointerEvents = 'auto';
            subFooter.style.opacity = '1';
            subFooter.style.pointerEvents = 'auto';
            
            currentCheckTypeSubCategory = null;
            renderCheckTypeSubCategoryList();
            
            document.getElementById('check-type-detail-placeholder').style.display = 'flex';
            document.getElementById('check-type-detail-container').style.display = 'none';
            document.getElementById('check-type-detail-desc').textContent = '장비, 점검 구분, 분류를 순서대로 선택해주세요.';
        });
    });

    // [추가] 분류 추가 이벤트
    const btnAddSub = document.getElementById('btn-add-check-type-subcategory');
    const inputSub = document.getElementById('check-type-subcategory-input');
    
    if (btnAddSub && inputSub) {
        btnAddSub.addEventListener('click', () => {
            if (!currentCheckTypeEquipKey || !currentCheckTypeCategory) return;
            const val = inputSub.value.trim();
            if (!val) return alert('분류명을 입력해주세요.');
            
            const key = `${currentCheckTypeEquipKey}::${currentCheckTypeCategory}`;
            if (!checkTypeCategoriesData[key]) checkTypeCategoriesData[key] = [];
            
            if (checkTypeCategoriesData[key].includes(val)) return alert('이미 존재하는 분류입니다.');
            
            checkTypeCategoriesData[key].push(val);
            saveCheckTypeCategories();
            addSystemLog('ADD_CHECK_CATEGORY', currentCheckTypeEquipKey, `분류 추가: ${currentCheckTypeCategory} > ${val}`);
            renderCheckTypeSubCategoryList();
            inputSub.value = '';
            inputSub.focus();
        });
        inputSub.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') btnAddSub.click();
        });
    }

    // [추가] 폼 드롭다운 변경 시 좌측 세부 구분 리스트 연동
    const selectSub = document.getElementById('check-type-item-subcategory-select');
    if (selectSub) {
        selectSub.addEventListener('change', (e) => {
            currentCheckTypeSubCategory = e.target.value;
            const subList = document.getElementById('check-type-subcategory-list');
            if (subList) {
                subList.querySelectorAll('li').forEach(li => {
                    if (li.dataset.sub === currentCheckTypeSubCategory) li.classList.add('active');
                    else li.classList.remove('active');
                });
            }
            document.getElementById('check-type-detail-desc').textContent = `'${currentCheckTypeEquipKey}' 장비의 '${currentCheckTypeCategory}' > '${currentCheckTypeSubCategory}' 세부 항목을 관리합니다.`;
            
            renderCheckTypeItemList();
        });
    }

    // [추가] 점검 세부 항목 추가 이벤트
    const btnAddItem = document.getElementById('btn-add-check-type-item');
    const inputContent = document.getElementById('check-type-item-content');
    
    if (btnAddItem && inputContent && selectSub) {
        btnAddItem.addEventListener('click', () => {
            if (!currentCheckTypeEquipKey || !currentCheckTypeCategory) return;
            
            let content = inputContent.value.trim();
            const subCat = selectSub.value;
            
            if (!subCat) return alert('세부 구분을 선택해주세요.');

            if (!content) {
                return alert('작업 세부 내용을 입력해주세요.');
            }
            
            const key = `${currentCheckTypeEquipKey}::${currentCheckTypeCategory}::${subCat}`;
            if (!checkTypeItemsData[key]) checkTypeItemsData[key] = [];
            
            checkTypeItemsData[key].push({
                id: Date.now(),
                content: content
            });
            
            saveCheckTypeItems();
            addSystemLog('ADD_CHECK_ITEM', currentCheckTypeEquipKey, `항목 추가: [${subCat}] ${content}`);
            
            inputContent.value = '';
            
            if (currentCheckTypeSubCategory !== subCat) {
                selectSub.value = subCat;
                selectSub.dispatchEvent(new Event('change'));
            } else {
                renderCheckTypeItemList();
            }
            inputContent.focus();
        });
        
        inputContent.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') btnAddItem.click();
        });
    }
}

function loadCheckTypeCategories() {
    try {
        const data = localStorage.getItem('check_type_categories');
        checkTypeCategoriesData = data ? JSON.parse(data) : {};
    } catch(e) {
        checkTypeCategoriesData = {};
    }
}

function saveCheckTypeCategories() {
    localStorage.setItem('check_type_categories', JSON.stringify(checkTypeCategoriesData));
    if (typeof saveData === 'function') saveData();
}

function loadCheckTypeItems() {
    try {
        const data = localStorage.getItem('check_type_items');
        checkTypeItemsData = data ? JSON.parse(data) : {};
    } catch(e) {
        checkTypeItemsData = {};
    }
}

function saveCheckTypeItems() {
    localStorage.setItem('check_type_items', JSON.stringify(checkTypeItemsData));
    if (typeof saveData === 'function') saveData();
}

function updateCheckTypeSiteSelect() {
    const select = document.getElementById('check-type-site-filter');
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

function renderCheckTypeEquipList() {
    const list = document.getElementById('check-type-equip-list');
    const countEl = document.getElementById('check-type-equip-count');
    const searchInput = document.getElementById('check-type-equip-search');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

    if (!list) return;
    list.innerHTML = '';

    let items = [];
    if (currentCheckTypeSiteContext && storageData[currentCheckTypeSiteContext]) {
        storageData[currentCheckTypeSiteContext].forEach(k => items.push({site: currentCheckTypeSiteContext, key: k}));
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
        if (!currentCheckTypeSiteContext) {
            content = `<div style="display:flex; flex-direction:column; gap:2px;"><span style="font-size:11px; color:#8b949e;">${site}</span><div>${content}</div></div>`;
        } else {
            content = `<div>${content}</div>`;
        }
        li.innerHTML = content;
        
        if (currentCheckTypeEquipKey === fullKey) li.classList.add('active');

        li.addEventListener('click', () => {
            currentCheckTypeEquipKey = fullKey;
            
            list.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            li.classList.add('active');
            
            const categoryList = document.getElementById('check-type-category-list');
            categoryList.style.opacity = '1';
            categoryList.style.pointerEvents = 'auto';
            
            currentCheckTypeCategory = null;
            categoryList.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            
            // 서브카테고리(분류) 패널 초기화
            currentCheckTypeSubCategory = null;
            const subList = document.getElementById('check-type-subcategory-list');
            const subFooter = document.getElementById('check-type-subcategory-footer');
            if (subList) {
                subList.innerHTML = '';
                subList.style.opacity = '0.5';
                subList.style.pointerEvents = 'none';
            }
            if (subFooter) {
                subFooter.style.opacity = '0.5';
                subFooter.style.pointerEvents = 'none';
            }

            document.getElementById('check-type-detail-placeholder').style.display = 'flex';
            document.getElementById('check-type-detail-container').style.display = 'none';
            document.getElementById('check-type-detail-desc').textContent = '장비, 점검 구분, 분류를 순서대로 선택해주세요.';
        });

        list.appendChild(li);
    });
}

function renderCheckTypeSubCategoryList() {
    const list = document.getElementById('check-type-subcategory-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (!currentCheckTypeEquipKey || !currentCheckTypeCategory) return;
    
    const key = `${currentCheckTypeEquipKey}::${currentCheckTypeCategory}`;
    
    // [추가] 점검 구분별 세부 구분 초기값 설정
    const defaultSubCategories = {
        '정기': ['PM'],
        '비정기': ['BM', 'Alarm', 'Hunting', 'Data / Para 이상'],
        '고객대응': ['순회 점검', '프로그램 변경 / 평가', '설비 평가', 'Parts 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '기타'],
        '용액제조': ['용액제조'],
        '온라인 점검': ['온라인 점검']
    };

    if (!checkTypeCategoriesData[key]) {
        if (defaultSubCategories[currentCheckTypeCategory]) {
            checkTypeCategoriesData[key] = [...defaultSubCategories[currentCheckTypeCategory]];
            saveCheckTypeCategories();
        } else {
            checkTypeCategoriesData[key] = [];
        }
    }

    const categories = checkTypeCategoriesData[key] || [];
    
    categories.forEach((cat, index) => {
        const li = document.createElement('li');
        li.dataset.sub = cat; // [추가] 연동을 위한 데이터 속성
        li.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span>${cat}</span>
                <button class="btn-del-sm" onclick="event.stopPropagation(); deleteCheckTypeSubCategory('${key}', ${index})">✕</button>
            </div>
        `;
        
        if (currentCheckTypeSubCategory === cat) li.classList.add('active');
        
        li.addEventListener('click', () => {
            currentCheckTypeSubCategory = cat;
            list.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            li.classList.add('active');
            
            // 점검 항목 관리 패널 활성화
            document.getElementById('check-type-detail-placeholder').style.display = 'none';
            document.getElementById('check-type-detail-container').style.display = 'block';
            document.getElementById('check-type-detail-desc').textContent = `'${currentCheckTypeEquipKey}' 장비의 '${currentCheckTypeCategory}' > '${currentCheckTypeSubCategory}' 세부 항목을 관리합니다.`;
            
            // [추가] 교체 파츠 목록 업데이트 및 리스트 렌더링
            updateCheckTypeSubCategoryDropdown();
            renderCheckTypeItemList();
        });
        
        list.appendChild(li);
    });
    
    updateCheckTypeSubCategoryDropdown();
}

function updateCheckTypeSubCategoryDropdown() {
    const selectSub = document.getElementById('check-type-item-subcategory-select');
    if (!selectSub) return;
    
    selectSub.innerHTML = '';
    
    if (!currentCheckTypeEquipKey || !currentCheckTypeCategory) return;
    const key = `${currentCheckTypeEquipKey}::${currentCheckTypeCategory}`;
    const categories = checkTypeCategoriesData[key] || [];
    
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        selectSub.appendChild(opt);
    });
    
    if (currentCheckTypeSubCategory && categories.includes(currentCheckTypeSubCategory)) {
        selectSub.value = currentCheckTypeSubCategory;
    }
}

window.deleteCheckTypeSubCategory = function(key, index) {
    if (!confirm('이 분류를 삭제하시겠습니까?\n하위 점검 항목 데이터도 함께 연결이 끊어질 수 있습니다.')) return;
    
    const catName = checkTypeCategoriesData[key][index];
    checkTypeCategoriesData[key].splice(index, 1);
    saveCheckTypeCategories();
    addSystemLog('DELETE_CHECK_CATEGORY', key, `분류 삭제: ${catName}`);
    
    if (currentCheckTypeSubCategory === catName) {
        currentCheckTypeSubCategory = null;
        document.getElementById('check-type-detail-placeholder').style.display = 'flex';
        document.getElementById('check-type-detail-container').style.display = 'none';
    }
    
    renderCheckTypeSubCategoryList();
}

function renderCheckTypeItemList() {
    const list = document.getElementById('check-type-item-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (!currentCheckTypeEquipKey || !currentCheckTypeCategory || !currentCheckTypeSubCategory) return;
    
    const key = `${currentCheckTypeEquipKey}::${currentCheckTypeCategory}::${currentCheckTypeSubCategory}`;
    
    // [수정] 데이터가 아예 생성된 적이 없는 경우에만(처음 1회만) 물품 관리에 등록된 정보를 기본값으로 가져옴
    if (!checkTypeItemsData.hasOwnProperty(key)) {
        let defaultItems = [];
        if (currentCheckTypeSubCategory === 'PM' || currentCheckTypeSubCategory === 'BM') {
            const equipName = currentCheckTypeEquipKey.split('::')[0];
            const matchedItems = adminItems.filter(item => {
                if (item.type !== currentCheckTypeSubCategory) return false;
                if (!item.equip) return false;
                const equips = item.equip.split(',').map(e => e.trim());
                return equips.includes(equipName);
            });

            if (matchedItems.length > 0) {
                defaultItems = matchedItems.map((mItem, index) => ({
                    id: Date.now() + index,
                    content: mItem.part
                }));
            }
        }
        // 항목이 있든 없든 배열을 저장해두어, 이후에 전부 지우더라도 다시 불러오지 않도록 함
        checkTypeItemsData[key] = defaultItems;
        saveCheckTypeItems();
    }

    let items = checkTypeItemsData[key] || [];
    
    if (items.length === 0) {
        list.innerHTML = '<li style="justify-content: center; color: #8b949e; cursor: default; hover:none;">등록된 항목이 없습니다.</li>';
        return;
    }
    
    items.forEach(item => {
        const li = document.createElement('li');
        li.style.cursor = 'default';
        li.style.fontSize = '12px';
        li.innerHTML = `
            <div class="model-col" style="flex: 1; justify-content: center; align-items: center; text-align: center; color: #8b949e;">
                ${currentCheckTypeSubCategory}
            </div>
            <div class="model-col" style="flex: 3; justify-content: center; align-items: center; text-align: center; white-space: normal; word-break: break-all;">
                ${item.content}
            </div>
            <div class="model-col" style="flex: 0 0 60px; justify-content: center; align-items: center;">
                <button class="btn-del-sm" onclick="deleteCheckTypeItem('${key}', ${item.id})">✕</button>
            </div>
        `;
        list.appendChild(li);
    });
}

window.deleteCheckTypeItem = function(key, id) {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    
    if (checkTypeItemsData[key]) {
        const item = checkTypeItemsData[key].find(i => i.id === id);
        if (item) {
            checkTypeItemsData[key] = checkTypeItemsData[key].filter(i => i.id !== id);
            saveCheckTypeItems();
            addSystemLog('DELETE_CHECK_ITEM', key.split('::')[0], `항목 삭제: ${item.content}`);
            renderCheckTypeItemList();
        }
    }
};

// [추가] 점검 구분 설정 불러오기 모달 및 데이터 복사 로직
function setupCheckTypeLoadModal() {
    const modal = document.getElementById('check-type-load-modal');
    const closeBtn = document.getElementById('btn-close-check-type-load');
    const cancelBtn = document.getElementById('btn-cancel-check-type-load');
    const confirmBtn = document.getElementById('btn-confirm-check-type-load');
    const siteSelect = document.getElementById('load-check-type-site-select');

    if (!modal) return;

    const closeModal = () => modal.style.display = 'none';

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateLoadCheckTypeEquipSelect(siteSelect.value);
        };
    }

    if (confirmBtn) {
        confirmBtn.onclick = loadCheckTypeDataFromTarget;
    }
}

function openCheckTypeLoadModal() {
    if (!currentCheckTypeEquipKey) return alert('설정을 덮어쓸 "대상 장비"를 왼쪽 목록에서 먼저 선택해주세요.');

    const modal = document.getElementById('check-type-load-modal');
    const siteSelect = document.getElementById('load-check-type-site-select');
    const equipSelect = document.getElementById('load-check-type-equip-select');

    if (!modal || !siteSelect) return;

    siteSelect.innerHTML = '<option value="">사업장 선택</option>';
    Object.keys(storageData).forEach(site => {
        const option = document.createElement('option');
        option.value = site;
        option.textContent = site;
        siteSelect.appendChild(option);
    });

    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = true;

    modal.style.display = 'flex';
}

function updateLoadCheckTypeEquipSelect(site) {
    const equipSelect = document.getElementById('load-check-type-equip-select');
    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = !site;

    if (!site) return;

    const equips = storageData[site] || [];
    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        option.textContent = parts.length > 1 ? `${parts[0]} (${parts[1]})` : parts[0];
        equipSelect.appendChild(option);
    });
}

function loadCheckTypeDataFromTarget() {
    const site = document.getElementById('load-check-type-site-select').value;
    const equip = document.getElementById('load-check-type-equip-select').value;

    if (!site || !equip) return alert('정보를 불러올 원본 장비를 선택해주세요.');
    
    const sourceEquipKey = equip;

    if (sourceEquipKey === currentCheckTypeEquipKey) return alert('원본 장비와 대상 장비가 같습니다. 다른 장비를 선택해주세요.');

    if (!confirm('현재 장비의 점검 구분 및 세부 항목 설정이 모두 지워지고 선택한 장비의 설정으로 덮어쓰기 됩니다.\n계속하시겠습니까?')) return;

    // 1. 현재 장비의 기존 데이터 삭제
    Object.keys(checkTypeCategoriesData).forEach(k => {
        if (k.startsWith(`${currentCheckTypeEquipKey}::`)) {
            delete checkTypeCategoriesData[k];
        }
    });
    Object.keys(checkTypeItemsData).forEach(k => {
        if (k.startsWith(`${currentCheckTypeEquipKey}::`)) {
            delete checkTypeItemsData[k];
        }
    });

    // 2. 소스 장비 데이터 복사
    Object.keys(checkTypeCategoriesData).forEach(k => {
        if (k.startsWith(`${sourceEquipKey}::`)) {
            const suffix = k.substring(sourceEquipKey.length);
            const newKey = currentCheckTypeEquipKey + suffix;
            checkTypeCategoriesData[newKey] = JSON.parse(JSON.stringify(checkTypeCategoriesData[k]));
        }
    });
    
    Object.keys(checkTypeItemsData).forEach(k => {
        if (k.startsWith(`${sourceEquipKey}::`)) {
            const suffix = k.substring(sourceEquipKey.length);
            const newKey = currentCheckTypeEquipKey + suffix;
            // 고유 ID 재발급 (충돌 방지)
            const newItems = checkTypeItemsData[k].map((item, idx) => ({
                ...item,
                id: Date.now() + Math.floor(Math.random() * 10000) + idx
            }));
            checkTypeItemsData[newKey] = newItems;
        }
    });

    saveCheckTypeCategories();
    saveCheckTypeItems();
    addSystemLog('LOAD_CHECK_TYPE', currentCheckTypeEquipKey, `From: ${sourceEquipKey}`);

    alert('설정을 성공적으로 불러왔습니다.');
    document.getElementById('check-type-load-modal').style.display = 'none';

    // UI 갱신
    if (currentCheckTypeCategory) {
        renderCheckTypeSubCategoryList();
        renderCheckTypeItemList();
    }
}

// [추가] 초기화 시 장비 관리 이벤트 등록
const originalSetupAdminMenu = setupAdminMenu; // 기존 함수 보존
setupAdminMenu = function() {
    originalSetupAdminMenu(); // 기존 로직 실행
    setupEquipMgmt(); // 장비 관리 로직 초기화
    setupCheckTypeMgmt(); // 점검 구분 관리 초기화
};