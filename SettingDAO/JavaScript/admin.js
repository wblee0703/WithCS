let currentAdminSite = null; // 현재 선택된 사업장
let currentBuildingList = []; // 현재 편집 중인 건물 목록

document.addEventListener('DOMContentLoaded', () => {
    setupAdminMenu();
    setupSiteMgmt();
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