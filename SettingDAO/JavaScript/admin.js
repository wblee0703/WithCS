let currentAdminSite = null; // 현재 선택된 사업장
let currentBuildingList = []; // 현재 편집 중인 건물 목록
let currentAdminEquipSite = null; // 장비 관리에서 선택된 사업장
let currentAdminEquipKey = null; // 장비 관리에서 선택된 장비 키 (Name::Serial)
let equipmentModels = []; // 장비 모델 목록
let currentAdminModel = null; // 선택된 장비 모델

document.addEventListener('DOMContentLoaded', () => {
    setupAdminMenu();
    setupSiteMgmt();
    setupEquipModelMgmt();
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
    if (!list) return;

    list.innerHTML = '';
    equipmentModels.sort((a, b) => a.name.localeCompare(b.name));
    if (countEl) countEl.textContent = equipmentModels.length;

    equipmentModels.forEach(model => {
        const li = document.createElement('li');
        if (currentAdminModel && currentAdminModel.name === model.name) {
            li.classList.add('active');
        }
        
        li.innerHTML = `
            <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span title="${model.name} / ${model.abbr}">${model.name} / ${model.abbr}</span>
            </div>
            <span class="item-controls"><span class="del-item-btn" title="모델 삭제">✕</span></span>
        `;

        li.addEventListener('click', () => {
            currentAdminModel = (currentAdminModel && currentAdminModel.name === model.name) ? null : model;
            renderEquipModelList();
            renderAdminEquipList();
            resetEquipForm();
        });

        li.querySelector('.del-item-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`'${model.name}' 모델을 삭제하시겠습니까?\n이 모델을 사용하는 장비가 있을 수 있습니다.`)) return;
            equipmentModels = equipmentModels.filter(m => m.name !== model.name);
            saveEquipmentModels();
            addSystemLog('DELETE_EQUIP_MODEL', model.name);
            if (currentAdminModel && currentAdminModel.name === model.name) currentAdminModel = null;
            renderEquipModelList();
            renderAdminEquipList();
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
            resetEquipForm();
        });
    }

    // 신규 등록 모드 버튼
    const btnNew = document.getElementById('btn-admin-new-equip');
    if (btnNew) {
        btnNew.addEventListener('click', () => {
            if (!currentAdminEquipSite) return alert('사업장을 먼저 선택해주세요.');
            resetEquipForm();
            document.getElementById('admin-equip-form').style.display = 'block';
            document.getElementById('admin-equip-placeholder').style.display = 'none';
            document.getElementById('equip-info-site').value = currentAdminEquipSite;
             
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
}

function updateEquipSiteSelect() {
    const select = document.getElementById('admin-equip-site-filter');
    if (!select) return;
    
    const currentVal = select.value;
    select.innerHTML = '<option value="">사업장 선택...</option>';
    
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
    if (!list) return;

    list.innerHTML = '';
    if (countEl) countEl.textContent = '0';

    if (!currentAdminEquipSite || !storageData[currentAdminEquipSite]) return;

    let equips = storageData[currentAdminEquipSite];

    // 모델 필터링
    if (currentAdminModel) {
        equips = equips.filter(key => {
            const modelName = key.split('::')[0];
            return modelName === currentAdminModel.name;
        });
    }

    if (countEl) countEl.textContent = equips.length;

    equips.forEach(fullKey => {
        const parts = fullKey.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';

        const li = document.createElement('li');
        li.innerHTML = `<span>${name}</span> <span style="color:#8b949e; font-size:12px;">${serial ? '(' + serial + ')' : ''}</span>`;
        
        if (currentAdminEquipKey === fullKey) li.classList.add('active');

        li.addEventListener('click', () => {
            currentAdminEquipKey = fullKey;
            // UI 업데이트
            list.querySelectorAll('li').forEach(l => l.classList.remove('active'));
            li.classList.add('active');
            
            // 폼 로드
            document.getElementById('admin-equip-form').style.display = 'block';
            document.getElementById('admin-equip-placeholder').style.display = 'none';
            document.getElementById('equip-info-site').value = currentAdminEquipSite;
            document.getElementById('equip-info-name').value = name;
            document.getElementById('equip-info-serial').value = serial;
        });

        list.appendChild(li);
    });
}

function resetEquipForm() {
    currentAdminEquipKey = null;
    document.getElementById('admin-equip-form').style.display = 'none';
    document.getElementById('admin-equip-placeholder').style.display = 'flex';
    const nameInput = document.getElementById('equip-info-name');
    nameInput.value = '';
    nameInput.readOnly = false;
    document.getElementById('equip-info-serial').value = '';
    
    const list = document.getElementById('admin-equip-list');
    if(list) list.querySelectorAll('li').forEach(l => l.classList.remove('active'));
}

function handleEquipSave() {
    if (!currentAdminEquipSite) return;
    const nameInput = document.getElementById('equip-info-name');
    const name = nameInput.value.trim();
    const serial = document.getElementById('equip-info-serial').value.trim();
    
    if (!name) return alert('장비명(모델)을 입력해주세요.');
    
    const newKey = serial ? `${name}::${serial}` : name;
    
    // 중복 체크 (수정이면 자기 자신 제외)
    if (currentAdminEquipKey !== newKey && storageData[currentAdminEquipSite].includes(newKey)) {
        return alert('해당 사업장에 이미 동일한 장비가 존재합니다.');
    }

    // 수정 (Rename) 처리
    if (currentAdminEquipKey && currentAdminEquipKey !== newKey) {
        if(!confirm('장비 정보를 변경하시겠습니까?\n기존 데이터가 새 정보로 이동됩니다.')) return;
        
        // 리스트 내 키 변경
        const idx = storageData[currentAdminEquipSite].indexOf(currentAdminEquipKey);
        if (idx !== -1) storageData[currentAdminEquipSite][idx] = newKey;
        
        // details 데이터 이동
        const oldData = localStorage.getItem(`details_${currentAdminEquipSite}_${currentAdminEquipKey}`);
        if (oldData) {
            localStorage.setItem(`details_${currentAdminEquipSite}_${newKey}`, oldData);
            localStorage.removeItem(`details_${currentAdminEquipSite}_${currentAdminEquipKey}`);
        }
        
        // setup_data 이동
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const oldSetupKey = `${currentAdminEquipSite}::${currentAdminEquipKey}`;
        if (setupData[oldSetupKey]) {
            setupData[`${currentAdminEquipSite}::${newKey}`] = setupData[oldSetupKey];
            delete setupData[oldSetupKey];
            localStorage.setItem('setup_data', JSON.stringify(setupData));
        }
        
        addSystemLog('UPDATE_EQUIP', newKey, `From: ${currentAdminEquipKey}`);
    } 
    // 신규 등록
    else if (!currentAdminEquipKey) {
        storageData[currentAdminEquipSite].push(newKey);
        // 초기 데이터 생성
        const initData = { maint: [], logs: [], memo: "", setup: { model: serial } }; // Serial을 모델란에 저장 (관례)
        localStorage.setItem(`details_${currentAdminEquipSite}_${newKey}`, JSON.stringify(initData));
        addSystemLog('ADD_EQUIP', newKey, `Site: ${currentAdminEquipSite}`);
    }

    saveData();
    alert('저장되었습니다.');
    currentAdminEquipKey = newKey; // 키 갱신
    renderAdminEquipList();
    nameInput.readOnly = !!currentAdminModel; // 모델 선택 상태에 따라 잠금 상태 복원
}

function handleEquipDelete() {
    if (!currentAdminEquipSite || !currentAdminEquipKey) return;
    
    if (!confirm(`'${currentAdminEquipKey}' 장비를 삭제하시겠습니까?\n모든 점검 이력과 데이터가 삭제됩니다.`)) return;

    // 리스트에서 제거
    storageData[currentAdminEquipSite] = storageData[currentAdminEquipSite].filter(k => k !== currentAdminEquipKey);
    
    // details 제거
    localStorage.removeItem(`details_${currentAdminEquipSite}_${currentAdminEquipKey}`);
    
    // setup_data 제거
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    delete setupData[`${currentAdminEquipSite}::${currentAdminEquipKey}`];
    localStorage.setItem('setup_data', JSON.stringify(setupData));
    
    addSystemLog('DELETE_EQUIP', currentAdminEquipKey, `Site: ${currentAdminEquipSite}`);
    
    saveData();
    alert('삭제되었습니다.');
    resetEquipForm();
    renderAdminEquipList();
}

// [추가] 초기화 시 장비 관리 이벤트 등록
const originalSetupAdminMenu = setupAdminMenu; // 기존 함수 보존
setupAdminMenu = function() {
    originalSetupAdminMenu(); // 기존 로직 실행
    setupEquipMgmt(); // 장비 관리 로직 초기화
};