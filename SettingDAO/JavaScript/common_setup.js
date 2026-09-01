/* ==========================================================================
   공통 셋업 모달 로직 (Common Setup Modals Logic)
   ========================================================================== */

// [전역 변수] 모달에서 현재 타겟팅하는 항목 정보
var currentExecStartTarget = null;
var currentSetupCompleteTarget = null; // [추가] 셋업 완료 처리 대상

// [추가] 로컬 타임존 기준 YYYY-MM-DD 포맷 변환 헬퍼 (UTC 변환 시 하루 밀리는 현상 방지)
function getLocalYYYYMMDD(d = new Date()) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

/* ==========================================================================
   1. 실행 시작 모달 (Execution Start Modal)
   ========================================================================== */

/**
 * 실행 시작 모달의 이벤트 리스너를 설정합니다.
 * 이 함수는 각 페이지(setup, index)에서 한 번씩 호출되어야 합니다.
 */
function setupSetupExecStartModal() {
    const modal = document.getElementById('setup-exec-start-modal');
    if (!modal) return;

    // 이벤트 중복 바인딩 방지
    if (modal.dataset.initialized === 'true') return;
    modal.dataset.initialized = 'true';

    const closeBtn = document.getElementById('btn-close-setup-exec-start');
    const saveBtn = document.getElementById('btn-save-setup-exec-start');

    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
    if (saveBtn) saveBtn.onclick = saveSetupExecStart;
}

/**
 * 실행 시작 모달을 엽니다.
 * @param {string|number} id - 대상 작업 항목의 ID
 * @param {string} site - 대상 장비의 사업장
 * @param {string} equip - 대상 장비의 이름
 */
function openSetupExecStartModal(id, site, equip) {
    const modal = document.getElementById('setup-exec-start-modal');
    if (!modal) return;

    currentExecStartTarget = { id, site, equip };
    const dateInput = document.getElementById('setup-exec-start-date');

    let defaultDate = getLocalYYYYMMDD();

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const data = setupData[equipKey] || {};
    const details = data.setupDetails || [];

    const currentIndex = details.findIndex(item => item.id == id);

    if (currentIndex > 0) {
        const prevTask = details[currentIndex - 1];
        if (prevTask.completed && prevTask.date) {
            const [y, m, d] = prevTask.date.split('-').map(Number);
            const prevDate = new Date(y, m - 1, d);
            defaultDate = getLocalYYYYMMDD(window.addBusinessDays(prevDate, 1));
        }
    } else if (currentIndex === 0) {
        if (details[0].startDate) defaultDate = details[0].startDate;
    }

    dateInput.value = defaultDate;
    modal.style.display = 'flex';
}

/**
 * 실행 시작 버튼 클릭 시 호출되는 함수 (인라인 onclick 등에서 사용)
 * @param {string|number} id - 대상 작업 항목의 ID
 * @param {string} site - 대상 장비의 사업장
 * @param {string} equip - 대상 장비의 이름
 */
function startSetupTask(id, site, equip) {
    // 화면에 계산되었으나 아직 스토리지에 저장되지 않은 데이터가 있을 경우를 대비해,
    // 팝업을 열고 리렌더링하기 전에 현재 화면의 DOM 상태를 강제로 저장하여 초기화 방지
    if (typeof saveSetupDetails === 'function') {
        saveSetupDetails('UPDATE_SETUP_BEFORE_EXEC', '실행 전 화면 상태 자동 저장');
    }
    openSetupExecStartModal(id, site, equip);
}
window.startSetupTask = startSetupTask;

/**
 * 실행 시작 모달의 저장 로직
 */
async function saveSetupExecStart() {
    if (!currentExecStartTarget) return;

    const { id, site, equip } = currentExecStartTarget;
    const dateInput = document.getElementById('setup-exec-start-date');
    const execDate = dateInput.value;

    if (!execDate) return alert("시작일을 선택해주세요.");

    document.getElementById('setup-exec-start-modal').style.display = 'none';

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    let data = setupData[equipKey] || {};

    if (data.setupDetails) {
        const task = data.setupDetails.find(t => t.id == id);
        if (task) {
            task.execStartDate = execDate;
            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));

            // DB 동기화
            await window.syncSetupDataDB(site, equip, data.setupDetails, null);

            if (typeof addSystemLog === 'function') {
                addSystemLog('START_SETUP_EXEC', equip, `실행 시작일 설정: ${execDate}`);
            }

            // 현재 페이지에 따라 적절한 렌더링 함수 호출
            if (typeof renderGanttChart === 'function') renderGanttChart();
            if (typeof renderSetupDetailList === 'function') renderSetupDetailList();

            // [추가] 대시보드 리스트 즉시 갱신
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
            if (typeof updateIntegratedDashboard === 'function') updateIntegratedDashboard();
        }
    }

    currentExecStartTarget = null;
}

// [추가] 외부 호출을 위한 전역 함수 명시적 노출
window.setupSetupExecStartModal = setupSetupExecStartModal;
window.openSetupExecStartModal = openSetupExecStartModal;
window.saveSetupExecStart = saveSetupExecStart;

/* ==========================================================================
   [추가] 셋업 작업 등록 또는 수정 모달 분기 호출 헬퍼
   ========================================================================== */
window.openLogRegisterOrEditMode = function(site, equip, taskName, fallbackDate, forceComplete = false) {
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const data = setupData[equipKey] || {};
    const taskLogs = (data.setupLogs || []).filter(l => l.content === taskName);
    
    if (taskLogs.length > 0) {
        taskLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
        const lastLog = taskLogs[taskLogs.length - 1];
        if (typeof window.openLogForEditing === 'function') {
            window.openLogForEditing(site, equip, lastLog.id);
            if (forceComplete) {
                setTimeout(() => {
                    const completeBtn = document.getElementById('btn-setup-log-reg-complete');
                    if (completeBtn && !completeBtn.classList.contains('btn-green')) completeBtn.click();
                }, 100);
            }
            return;
        }
    }
    
    if (typeof window.openSetupLogRegisterModal === 'function') window.openSetupLogRegisterModal(site, equip, taskName, fallbackDate, forceComplete);
    else alert('팝업을 열 수 없습니다.');
};

/* ==========================================================================
   [추가] 셋업 작업 등록 또는 수정 모달 분기 호출 헬퍼 (인덱스 지정)
   ========================================================================== */
window.openLogRegisterOrEditModeWithIndex = function(site, equip, taskName, fallbackDate, forceComplete = false, logIndexType = 'last') {
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const data = setupData[equipKey] || {};
    const taskLogs = (data.setupLogs || []).filter(l => l.content === taskName);
    
    if (taskLogs.length > 0) {
        taskLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        let targetLog;
        if (logIndexType === 'first') {
            targetLog = taskLogs[0];
        } else { // 'last' or default
            targetLog = taskLogs[taskLogs.length - 1];
        }

        if (targetLog && typeof window.openLogForEditing === 'function') {
            window.openLogForEditing(site, equip, targetLog.id);
            if (forceComplete) {
                setTimeout(() => {
                    const completeBtn = document.getElementById('btn-setup-log-reg-complete');
                    if (completeBtn && !completeBtn.classList.contains('btn-green')) completeBtn.click();
                }, 100);
            }
            return;
        }
    }
    
    if (typeof window.openSetupLogRegisterModal === 'function') window.openSetupLogRegisterModal(site, equip, taskName, fallbackDate, forceComplete);
    else alert('팝업을 열 수 없습니다.');
};

/* ==========================================================================
   [추가] 셋업 작업 기록 모달 (셋업구분/세부구분 커스텀 제안박스 연동)
   ========================================================================== */
function setupCategoryAndSubCategoryDropdowns(modalContext, selectedCategory = '', selectedSubcategory = '') {
    const modal = modalContext || document;
    const catHidden = modal.querySelector('#setup-log-reg-category');
    const catTrigger = modal.querySelector('#setup-log-reg-category-trigger');
    const catDropdown = modal.querySelector('#setup-log-reg-category-dropdown');
    const catList = modal.querySelector('#setup-log-reg-category-list');

    const subcatHidden = modal.querySelector('#setup-log-reg-subcategory');
    const subcatTrigger = modal.querySelector('#setup-log-reg-subcategory-trigger');
    const subcatDropdown = modal.querySelector('#setup-log-reg-subcategory-dropdown');
    const subcatList = modal.querySelector('#setup-log-reg-subcategory-list');

    if (!catHidden || !subcatHidden || !catTrigger || !subcatTrigger) return;

    // ADMIN 셋업 템플릿 마스터 데이터 불러오기
    const getTemplatesData = () => {
        const templates = JSON.parse(localStorage.getItem('setup_templates')) || {};
        const list = templates['default'];
        if (Array.isArray(list) && list.length > 0) return list;
        return [
            { category: "장비 반입 및 정위치", subcategory: "도면 및 다이크", content: "장비 도면 부착", estDays: "1" },
            { category: "장비 반입 및 정위치", subcategory: "도면 및 다이크", content: "다이크 설치", estDays: "1" },
            { category: "장비 반입 및 정위치", subcategory: "장비 반입", content: "장비 반입", estDays: "1" },
            { category: "장비 반입 및 정위치", subcategory: "장비 반입", content: "다이크 공사 및 리크센서 설치", estDays: "2" },
            { category: "통신 상태 및 유틸리티", subcategory: "Utility 배관", content: "Utility 배관 공사 및 연결", estDays: "5" },
            { category: "통신 상태 및 유틸리티", subcategory: "Utility 배관", content: "Utility 턴온", estDays: "1" },
            { category: "통신 상태 및 유틸리티", subcategory: "인터락/통신", content: "인터락 Test 및 통신상태 확인 ", estDays: "2" },
            { category: "셋업 평가", subcategory: "분석부 안정화", content: "분석부 안정화 및 오염제어", estDays: "5" },
            { category: "셋업 평가", subcategory: "성능 평가", content: "Calibration 평가", estDays: "2" },
            { category: "셋업 평가", subcategory: "성능 평가", content: "Sample 측정", estDays: "2" },
            { category: "셋업 평가", subcategory: "성능 평가", content: "신뢰도 평가", estDays: "5" },
            { category: "셋업 완료", subcategory: "셋업 완료", content: "셋업 완료", estDays: "0" }
        ];
    };

    // 세부 구분 활성화/비활성화 상태 관리
    const updateSubcategoryState = () => {
        const hasCategory = !!catHidden.value;
        if (!hasCategory) {
            subcatTrigger.classList.add('disabled');
            subcatTrigger.style.opacity = '0.5';
            subcatTrigger.style.cursor = 'not-allowed';
            subcatTrigger.style.pointerEvents = 'none';
            subcatTrigger.textContent = '셋업 구분을 먼저 선택해주세요';
            subcatTrigger.title = '';
            subcatTrigger.classList.remove('has-value');
            subcatHidden.value = '';
            subcatDropdown.classList.remove('show');
        } else {
            subcatTrigger.classList.remove('disabled');
            subcatTrigger.style.opacity = '1';
            subcatTrigger.style.cursor = 'pointer';
            subcatTrigger.style.pointerEvents = 'auto';
            if (subcatHidden.value) {
                subcatTrigger.textContent = subcatHidden.value;
                subcatTrigger.classList.add('has-value');
            } else {
                subcatTrigger.textContent = '세부 구분 선택';
                subcatTrigger.classList.remove('has-value');
            }
        }
    };

    // 1. 셋업 구분 목록 렌더링
    const renderCategoryList = (kw = '') => {
        if (!catList) return;
        catList.innerHTML = '';
        const currentTpl = getTemplatesData();
        const categories = Array.from(new Set(currentTpl.map(t => t.category).filter(Boolean)));

        let filtered = categories;
        if (kw) filtered = filtered.filter(c => c.toLowerCase().includes(kw.toLowerCase()));

        if (filtered.length === 0) {
            catList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:#8b949e;">검색 결과가 없습니다.</div>';
            return;
        }

        filtered.forEach(catName => {
            const div = document.createElement('div');
            div.className = 'log-select-item' + (catHidden.value === catName ? ' selected' : '');
            div.style.cursor = 'pointer';
            div.innerHTML = `<span>${typeof escapeHtml === 'function' ? escapeHtml(catName) : catName}</span>`;

            div.addEventListener('click', (e) => {
                e.stopPropagation();
                catHidden.value = catName;
                catTrigger.textContent = catName;
                catTrigger.classList.add('has-value');
                catDropdown.classList.remove('show');

                // 셋업 구분 선택 후 세부 구분 활성화
                subcatHidden.value = '';
                updateSubcategoryState();
                renderSubcategoryList('');
            });

            catList.appendChild(div);
        });
    };

    // 2. 세부 구분 목록 렌더링
    const renderSubcategoryList = (kw = '') => {
        if (!subcatList) return;
        subcatList.innerHTML = '';

        const currentTpl = getTemplatesData();
        const currentCat = catHidden.value;
        if (!currentCat) {
            subcatList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:#8b949e;">셋업 구분을 먼저 선택해주세요.</div>';
            return;
        }

        let subItems = currentTpl.filter(t => t.category === currentCat).map(t => t.subcategory || t.content || t.category).filter(Boolean);
        let uniqueSubs = Array.from(new Set(subItems));

        if (kw) {
            uniqueSubs = uniqueSubs.filter(s => s.toLowerCase().includes(kw.toLowerCase()));
        }

        if (uniqueSubs.length === 0) {
            subcatList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:#8b949e;">등록된 세부 구분이 없습니다.</div>';
            return;
        }

        uniqueSubs.forEach(subName => {
            const div = document.createElement('div');
            div.className = 'log-select-item' + (subcatHidden.value === subName ? ' selected' : '');
            div.style.cursor = 'pointer';
            div.innerHTML = `<span>${typeof escapeHtml === 'function' ? escapeHtml(subName) : subName}</span>`;

            div.addEventListener('click', (e) => {
                e.stopPropagation();
                subcatHidden.value = subName;
                subcatTrigger.textContent = subName;
                subcatTrigger.classList.add('has-value');
                subcatDropdown.classList.remove('show');
            });

            subcatList.appendChild(div);
        });
    };

    // 초기값 반영
    const initialTpl = getTemplatesData();
    if (!selectedCategory && selectedSubcategory) {
        const matched = initialTpl.find(t => (t.subcategory === selectedSubcategory || t.content === selectedSubcategory));
        if (matched) selectedCategory = matched.category;
    }

    if (selectedCategory) {
        catHidden.value = selectedCategory;
        catTrigger.textContent = selectedCategory;
        catTrigger.classList.add('has-value');
    } else {
        catHidden.value = '';
        catTrigger.textContent = '셋업 구분 선택';
        catTrigger.classList.remove('has-value');
    }

    if (selectedSubcategory && selectedCategory) {
        subcatHidden.value = selectedSubcategory;
    } else {
        subcatHidden.value = '';
    }

    // 세부 구분 활성화 상태 반영
    updateSubcategoryState();

    // 트리거 클릭 이벤트 직접 바인딩 (매 호출 시 항상 최신 상태 반영)
    catTrigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = catDropdown.classList.contains('show');
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => d.classList.remove('show'));
        if (!isOpen) {
            catDropdown.classList.add('show');
            renderCategoryList('');
        }
    };

    subcatTrigger.onclick = (e) => {
        e.stopPropagation();
        if (!catHidden.value) {
            alert('셋업 구분을 먼저 선택해주세요.');
            return;
        }
        const isOpen = subcatDropdown.classList.contains('show');
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => d.classList.remove('show'));
        if (!isOpen) {
            subcatDropdown.classList.add('show');
            renderSubcategoryList('');
        }
    };

    // 외부 클릭 시 드롭다운 닫기
    if (!window.hasSetupCatDropdownClickBound) {
        window.hasSetupCatDropdownClickBound = true;
        document.addEventListener('click', (e) => {
            const allDropdowns = document.querySelectorAll('#setup-log-reg-category-dropdown.show, #setup-log-reg-subcategory-dropdown.show');
            allDropdowns.forEach(dropdown => {
                const wrapper = dropdown.closest('.log-select-wrapper');
                if (wrapper && !wrapper.contains(e.target)) {
                    dropdown.classList.remove('show');
                }
            });
        });
    }
}

/* ==========================================================================
   [추가] 셋업 작업 기록 모달 (사업장/장비 커스텀 제안박스 연동)
   ========================================================================== */
function setupSetupLogRegSiteAndEquipDropdowns(modalContext, initialSite = '', initialEquip = '') {
    const modal = modalContext || document;
    const siteHidden = modal.querySelector('#setup-log-reg-site');
    const siteTrigger = modal.querySelector('#setup-log-reg-site-trigger');
    const siteDropdown = modal.querySelector('#setup-log-reg-site-dropdown');
    const siteSearch = modal.querySelector('#setup-log-reg-site-search');
    const siteList = modal.querySelector('#setup-log-reg-site-list');

    const equipHidden = modal.querySelector('#setup-log-reg-equip');
    const equipTrigger = modal.querySelector('#setup-log-reg-equip-trigger');
    const equipDropdown = modal.querySelector('#setup-log-reg-equip-dropdown');
    const equipSearch = modal.querySelector('#setup-log-reg-equip-search');
    const equipList = modal.querySelector('#setup-log-reg-equip-list');

    if (!siteHidden || !equipHidden || !siteTrigger || !equipTrigger) return;

    const getDeviceMap = () => {
        return (typeof getDeviceDataMap === 'function') ? getDeviceDataMap() : (JSON.parse(localStorage.getItem('device_data_map')) || {});
    };

    const getEquipFormattedInfo = (site, eq) => {
        if (!eq) return { text: '', html: '' };
        const parts = eq.split('::');
        const modelName = parts[0] || '';
        const serial = parts.length > 1 ? parts[1] : '';
        const custNameFromKey = parts.length > 2 ? parts[2] : '';
        const key = `details_${site}_${eq}`;
        const detailData = JSON.parse(localStorage.getItem(key)) || {};
        const custName = custNameFromKey || ((detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '');
        
        let subText = '';
        if (custName) {
            subText = `[${custName}]`;
        } else if (serial) {
            subText = `(${serial})`;
        }
        
        const plainText = subText ? `${modelName}${subText}` : modelName;
        const subHtml = subText ? `<span style="color: #3fb950; font-weight: 500; display: inline;">${typeof escapeHtml === 'function' ? escapeHtml(subText) : subText}</span>` : '';
        const html = `<span>${typeof escapeHtml === 'function' ? escapeHtml(modelName) : modelName}${subHtml}</span>`;
        
        return { text: plainText, html: html, modelName, subText };
    };

    // 1. 사업장 리스트 렌더링
    const renderSiteList = (kw = '') => {
        if (!siteList) return;
        siteList.innerHTML = '';
        const map = getDeviceMap();
        let sites = Object.keys(map);
        if (kw) sites = sites.filter(s => s.toLowerCase().includes(kw.toLowerCase()));

        if (sites.length === 0) {
            siteList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:#8b949e;">검색 결과가 없습니다.</div>';
            return;
        }

        sites.forEach(siteName => {
            const div = document.createElement('div');
            div.className = 'log-select-item' + (siteHidden.value === siteName ? ' selected' : '');
            div.style.cursor = 'pointer';
            div.innerHTML = `<span>${typeof escapeHtml === 'function' ? escapeHtml(siteName) : siteName}</span>`;

            div.addEventListener('click', (e) => {
                e.stopPropagation();
                siteHidden.value = siteName;
                siteTrigger.textContent = siteName;
                siteTrigger.classList.add('has-value');
                siteDropdown.classList.remove('show');

                // 사업장 변경 시 장비 초기화
                equipHidden.value = '';
                equipTrigger.textContent = '장비 선택';
                equipTrigger.title = '';
                equipTrigger.classList.remove('has-value');
                renderEquipList('');

                // 셋업 물품 드롭다운 및 작업자 드롭다운 재초기화
                if (typeof setupSetupLogRegPartDropdown === 'function') {
                    setupSetupLogRegPartDropdown(modal, siteName, '', '');
                }
                if (typeof setupSetupLogRegWorkerDropdown === 'function') {
                    setupSetupLogRegWorkerDropdown(modal);
                }
            });

            siteList.appendChild(div);
        });
    };

    // 2. 장비 리스트 렌더링 (검색 기능 포함)
    const renderEquipList = (kw = '') => {
        if (!equipList) return;
        equipList.innerHTML = '';
        const map = getDeviceMap();
        const currentSite = siteHidden.value;

        if (!currentSite) {
            equipList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:#8b949e;">사업장을 먼저 선택해주세요.</div>';
            return;
        }

        let rawEquips = map[currentSite] ? [...map[currentSite]] : [];
        let equips = rawEquips.filter(eq => {
            if (eq.startsWith('기타(ETC)')) return false;
            const detailKey = `details_${currentSite}_${eq}`;
            const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
            const equipStatus = (detailData.setup && detailData.setup.equipStatus) ? detailData.setup.equipStatus : (detailData.equipStatus || '');
            return equipStatus === '셋업 장비' || equipStatus.includes('셋업') || (detailData.setup && detailData.setup.isSetupEquip);
        });

        if (kw) {
            const lowerKw = kw.toLowerCase();
            equips = equips.filter(eq => {
                const info = getEquipFormattedInfo(currentSite, eq);
                return eq.toLowerCase().includes(lowerKw) || info.text.toLowerCase().includes(lowerKw);
            });
        }

        if (equips.length === 0) {
            equipList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:#8b949e;">해당 사업장에 셋업 장비가 없습니다.</div>';
            return;
        }

        equips.forEach(equipKey => {
            const info = getEquipFormattedInfo(currentSite, equipKey);
            const div = document.createElement('div');
            div.className = 'log-select-item' + (equipHidden.value === equipKey ? ' selected' : '');
            div.style.cursor = 'pointer';
            div.innerHTML = info.html;

            div.addEventListener('click', (e) => {
                e.stopPropagation();
                equipHidden.value = equipKey;
                equipTrigger.innerHTML = info.html;
                equipTrigger.title = info.text;
                equipTrigger.classList.add('has-value');
                equipDropdown.classList.remove('show');

                // 셋업 물품 드롭다운 재초기화
                if (typeof setupSetupLogRegPartDropdown === 'function') {
                    setupSetupLogRegPartDropdown(modal, currentSite, equipKey, modal.querySelector('#setup-log-reg-part-hidden')?.value || '');
                }
            });

            equipList.appendChild(div);
        });
    };

    // 초기값 세팅
    if (initialSite) {
        siteHidden.value = initialSite;
        siteTrigger.textContent = initialSite;
        siteTrigger.classList.add('has-value');
    } else {
        siteHidden.value = '';
        siteTrigger.textContent = '사업장 선택';
        siteTrigger.classList.remove('has-value');
    }

    if (initialEquip) {
        equipHidden.value = initialEquip;
        const info = getEquipFormattedInfo(initialSite, initialEquip);
        equipTrigger.innerHTML = info.html || initialEquip;
        equipTrigger.title = info.text || initialEquip;
        equipTrigger.classList.add('has-value');
    } else {
        equipHidden.value = '';
        equipTrigger.textContent = '장비 선택';
        equipTrigger.title = '';
        equipTrigger.classList.remove('has-value');
    }

    // 트리거 클릭 바인딩
    siteTrigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = siteDropdown.classList.contains('show');
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => d.classList.remove('show'));
        if (!isOpen) {
            siteDropdown.classList.add('show');
            if (siteSearch) {
                siteSearch.value = '';
                setTimeout(() => siteSearch.focus(), 50);
            }
            renderSiteList('');
        }
    };

    equipTrigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = equipDropdown.classList.contains('show');
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => d.classList.remove('show'));
        if (!isOpen) {
            equipDropdown.classList.add('show');
            if (equipSearch) {
                equipSearch.value = '';
                setTimeout(() => equipSearch.focus(), 50);
            }
            renderEquipList('');
        }
    };

    if (siteSearch) {
        siteSearch.onclick = e => e.stopPropagation();
        siteSearch.oninput = e => renderSiteList(e.target.value.trim());
    }

    if (equipSearch) {
        equipSearch.onclick = e => e.stopPropagation();
        equipSearch.oninput = e => renderEquipList(e.target.value.trim());
    }

    // 외부 클릭 시 드롭다운 닫기
    if (!window.hasSetupSiteEquipDropdownClickBound) {
        window.hasSetupSiteEquipDropdownClickBound = true;
        document.addEventListener('click', (e) => {
            const allDropdowns = document.querySelectorAll('#setup-log-reg-site-dropdown.show, #setup-log-reg-equip-dropdown.show');
            allDropdowns.forEach(dropdown => {
                const wrapper = dropdown.closest('.log-select-wrapper');
                if (wrapper && !wrapper.contains(e.target)) {
                    dropdown.classList.remove('show');
                }
            });
        });
    }
}

window.openSetupLogRegisterModal = function(site, equip, taskName, defaultDate, forceComplete = false, isDropdownMode = false) {
    const modals = document.querySelectorAll('#setup-log-register-modal');
    if (modals.length === 0) return;
    const modal = modals[modals.length - 1];
    
    modal.querySelector('#setup-log-reg-site').value = site || '';
    modal.querySelector('#setup-log-reg-equip').value = equip || '';
    const idInput = modal.querySelector('#setup-log-reg-id');
    if (idInput) idInput.value = ''; // 신규 등록이므로 ID 초기화
    const dateInput = modal.querySelector('#setup-log-reg-date');
    if (dateInput) dateInput.value = defaultDate || getLocalYYYYMMDD();
    const contentInput = modal.querySelector('#setup-log-reg-content');
    if (contentInput) contentInput.value = '';
    const memoInput = modal.querySelector('#setup-log-reg-memo');
    if (memoInput) memoInput.value = '';

    // [삭제] 완료 버튼 제거
    const completeBtn = modal.querySelector('#btn-setup-log-reg-complete');
    if (completeBtn) completeBtn.remove();

    // 사업장 및 장비 드롭다운 초기화
    setupSetupLogRegSiteAndEquipDropdowns(modal, site || '', equip || '');

    // 셋업 구분 및 세부 구분 드롭다운 초기화
    setupCategoryAndSubCategoryDropdowns(modal, '', taskName || '');

    const planDateInput = modal.querySelector('#setup-log-reg-plan-date');
    if (planDateInput) planDateInput.value = '';

    const delBtn = modal.querySelector('#btn-delete-setup-log-reg');
    const saveBtn = modal.querySelector('#btn-save-setup-log-reg');
    
    if (delBtn && saveBtn && delBtn.parentNode === saveBtn.parentNode) {
        const actionBtnContainer = delBtn.parentNode;
        actionBtnContainer.classList.add('setup-log-action-buttons');
        actionBtnContainer.style.display = '';
        actionBtnContainer.style.gap = '';
        actionBtnContainer.style.width = '';
        delBtn.style.flex = '';
        saveBtn.style.flex = '';
    }

    // [추가] 장비 이동 버튼 추가 및 하단 버튼 레이아웃 전체 조정
    const closeBtn = modal.querySelector('#btn-close-setup-log-reg');
    if (closeBtn && closeBtn.parentNode) {
        const buttonContainer = closeBtn.parentNode;
        
        buttonContainer.classList.add('setup-log-footer-buttons');
        buttonContainer.style.display = '';
        buttonContainer.style.gap = '';
        Array.from(buttonContainer.children).forEach(btn => { if (btn.tagName === 'BUTTON') btn.style.flex = ''; });

        let gotoBtn = buttonContainer.querySelector('#btn-goto-setup-page');
        if (!gotoBtn) {
            gotoBtn = document.createElement('button');
            gotoBtn.id = 'btn-goto-setup-page';
            gotoBtn.type = 'button';
            gotoBtn.className = 'btn-gray';
            gotoBtn.textContent = '장비 이동';
            
            gotoBtn.onclick = () => {
                const currentSite = modal.querySelector('#setup-log-reg-site').value;
                const currentEquip = modal.querySelector('#setup-log-reg-equip').value;
                if (currentSite && currentEquip) {
                    window.location.href = `setup.html?site=${encodeURIComponent(currentSite)}&equip=${encodeURIComponent(currentEquip)}`;
                }
            };
            buttonContainer.insertBefore(gotoBtn, closeBtn);
        }
    }
    if (delBtn) delBtn.style.display = 'none'; // 신규 등록 시에는 삭제 버튼 숨김
    
    // 작업자 세팅 (로그인 정보 기반)
    const wTrigger = modal.querySelector('#setup-log-reg-worker-trigger');
    const wHidden = modal.querySelector('#setup-log-reg-worker');
    const defaultWorker = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
    
    if (wHidden) wHidden.value = defaultWorker;
    if (wTrigger) {
        if (defaultWorker) {
            wTrigger.textContent = defaultWorker;
            wTrigger.title = defaultWorker;
            wTrigger.classList.add('has-value');
        } else {
            wTrigger.textContent = '작업자 선택';
            wTrigger.title = '';
            wTrigger.classList.remove('has-value');
        }
    }
    
    // 공수 자동 세팅
    const mdInput = modal.querySelector('#setup-log-reg-md');
    if (mdInput) {
        mdInput.value = defaultWorker ? defaultWorker.split(',').filter(Boolean).length : 0;
    }
    
    setupSetupLogRegWorkerDropdown(modal);
    // [추가] 셋업 물품 드롭다운 초기화 (기본값 없음)
    setupSetupLogRegPartDropdown(modal, site, equip, '');
    
    modal.style.display = 'flex';
};

// [추가] 간트뷰에서 기존 로그를 수정하기 위해 모달을 여는 함수
window.openLogForEditing = function(site, equip, logId) {
    const modals = document.querySelectorAll('#setup-log-register-modal');
    if (modals.length === 0) return;
    const modal = modals[modals.length - 1];

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const equipLogs = (setupData[equipKey] && setupData[equipKey].setupLogs) ? setupData[equipKey].setupLogs : [];
    const log = equipLogs.find(l => l.id == logId);

    if (!log) return alert('해당 작업 기록을 찾을 수 없습니다.');

    modal.querySelector('#setup-log-reg-site').value = site;
    modal.querySelector('#setup-log-reg-equip').value = equip;
    const idInput = modal.querySelector('#setup-log-reg-id');
    if (idInput) idInput.value = logId;
    modal.querySelector('#setup-log-reg-date').value = log.date;

    // 사업장 및 장비 드롭다운 초기화
    setupSetupLogRegSiteAndEquipDropdowns(modal, site || '', equip || '');

    // 셋업 구분 및 세부 구분 드롭다운 초기화
    setupCategoryAndSubCategoryDropdowns(modal, log.category || '', log.subcategory || '');

    const contentInput = modal.querySelector('#setup-log-reg-content');
    if (contentInput) contentInput.value = log.content || '';
    
    // [삭제] 완료 버튼 제거
    const completeBtn = modal.querySelector('#btn-setup-log-reg-complete');
    if (completeBtn) completeBtn.remove();

    const planDateInput = modal.querySelector('#setup-log-reg-plan-date');
    if (planDateInput) planDateInput.value = '';

    const memoInput = modal.querySelector('#setup-log-reg-memo');
    if (memoInput) memoInput.value = log.memo || '';

    const delBtn = modal.querySelector('#btn-delete-setup-log-reg');
    const saveBtn = modal.querySelector('#btn-save-setup-log-reg');
    
    if (delBtn && saveBtn && delBtn.parentNode === saveBtn.parentNode) {
        const actionBtnContainer = delBtn.parentNode;
        actionBtnContainer.classList.add('setup-log-action-buttons');
        actionBtnContainer.style.display = '';
        actionBtnContainer.style.gap = '';
        actionBtnContainer.style.width = '';
        delBtn.style.flex = '';
        saveBtn.style.flex = '';
    }

    // [추가] 장비 이동 버튼 추가 및 하단 버튼 레이아웃 전체 조정
    const closeBtn = modal.querySelector('#btn-close-setup-log-reg');
    if (closeBtn && closeBtn.parentNode) {
        const buttonContainer = closeBtn.parentNode;
        
        buttonContainer.classList.add('setup-log-footer-buttons');
        buttonContainer.style.display = '';
        buttonContainer.style.gap = '';
        Array.from(buttonContainer.children).forEach(btn => { if (btn.tagName === 'BUTTON') btn.style.flex = ''; });

        let gotoBtn = buttonContainer.querySelector('#btn-goto-setup-page');
        if (!gotoBtn) {
            gotoBtn = document.createElement('button');
            gotoBtn.id = 'btn-goto-setup-page';
            gotoBtn.type = 'button';
            gotoBtn.className = 'btn-gray';
            gotoBtn.textContent = '장비 이동';
            
            gotoBtn.onclick = () => {
                const currentSite = modal.querySelector('#setup-log-reg-site').value;
                const currentEquip = modal.querySelector('#setup-log-reg-equip').value;
                if (currentSite && currentEquip) {
                    window.location.href = `setup.html?site=${encodeURIComponent(currentSite)}&equip=${encodeURIComponent(currentEquip)}`;
                }
            };
            buttonContainer.insertBefore(gotoBtn, closeBtn);
        }
    }
    if (delBtn) {
        delBtn.style.display = 'block'; // 플렉스 아이템으로 표시되도록 block으로 변경
    }

    // 작업자 드롭다운 셋팅
    const wTrigger = modal.querySelector('#setup-log-reg-worker-trigger');
    const wHidden = modal.querySelector('#setup-log-reg-worker');
    if (wHidden) wHidden.value = log.worker || '';
    if (wTrigger) {
        if (log.worker) {
            wTrigger.textContent = log.worker;
            wTrigger.title = log.worker;
            wTrigger.classList.add('has-value');
        } else {
            wTrigger.textContent = '작업자 선택';
            wTrigger.title = '';
            wTrigger.classList.remove('has-value');
        }
    }

    const mdInput = modal.querySelector('#setup-log-reg-md');
    if (mdInput) mdInput.value = log.md || '0';
    
    setupSetupLogRegWorkerDropdown(modal);
    // [추가] 셋업 물품 드롭다운 초기화 (저장된 parts 불러오기)
    setupSetupLogRegPartDropdown(modal, site, equip, log.parts || '');

    modal.style.display = 'flex';
};

function setupSetupLogRegWorkerDropdown(modalContext) {
    const context = modalContext || document;
    const wTrigger = context.querySelector('#setup-log-reg-worker-trigger');
    const wDropdown = context.querySelector('#setup-log-reg-worker-dropdown');
    const wSearch = context.querySelector('#setup-log-reg-worker-search');
    const wList = context.querySelector('#setup-log-reg-worker-list');
    const wConfirm = context.querySelector('#btn-setup-log-reg-worker-confirm');
    const wHidden = context.querySelector('#setup-log-reg-worker');
    const mdInput = context.querySelector('#setup-log-reg-md');
    
    if(!wTrigger || !wDropdown || wDropdown.dataset.bound === 'true') return;
    wDropdown.dataset.bound = 'true';
    
    wTrigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== wDropdown) d.classList.remove('show'); });
        wDropdown.classList.toggle('show');
        if (wDropdown.classList.contains('show')) renderWorkers(wSearch ? wSearch.value.trim() : '');
    };
    
    document.addEventListener('click', (e) => {
        if (wDropdown.classList.contains('show') && e.target !== wTrigger && !wTrigger.contains(e.target) && !wDropdown.contains(e.target)) {
            wDropdown.classList.remove('show');
        }
    });

    const renderWorkers = async (searchTerm = '') => {
        const siteEl = context.querySelector('#setup-log-reg-site');
        const site = siteEl ? siteEl.value : '';
        const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(site) : [];
        const currentSelected = wHidden && wHidden.value ? wHidden.value.split(',').map(s => s.trim()).filter(Boolean) : [];
        const allWorkers = workers.map(w => typeof w === 'string' ? { name: w, department: '', position: '', site: '' } : w);
        let displayWorkers = [...allWorkers];

        if (searchTerm) {
            const kw = searchTerm.toLowerCase();
            displayWorkers = displayWorkers.filter(w =>
                w.name.toLowerCase().includes(kw) ||
                w.department.toLowerCase().includes(kw) ||
                w.position.toLowerCase().includes(kw)
            );
        }

        const displayedNames = new Set(displayWorkers.map(w => w.name));
        currentSelected.forEach(selectedName => {
            if (!displayedNames.has(selectedName)) {
                const workerToAdd = allWorkers.find(w => w.name === selectedName);
                if (workerToAdd) displayWorkers.unshift(workerToAdd);
                else displayWorkers.unshift({ name: selectedName, department: '', position: '' });
            }
        });

        if (typeof window.renderWorkerListItems === 'function') {
            window.renderWorkerListItems(wList, displayWorkers, currentSelected, () => {
                const selected = Array.from(wList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
                if (wHidden) wHidden.value = selected.join(', ');
                if (selected.length > 0) {
                    wTrigger.textContent = selected.join(', ');
                    wTrigger.classList.add('has-value');
                } else {
                    wTrigger.textContent = '작업자 선택';
                    wTrigger.classList.remove('has-value');
                }
                wTrigger.title = selected.join(', ');
                
                // 공수 연동 업데이트
                if (mdInput) mdInput.value = selected.length;
            });
        }
    };
    
    if (wSearch) {
        wSearch.onclick = (e) => e.stopPropagation();
        wSearch.oninput = (e) => renderWorkers(e.target.value.trim());
    }
    if (wConfirm) {
        wConfirm.onclick = (e) => { e.stopPropagation(); wDropdown.classList.remove('show'); };
    }
}

// [추가] 셋업 물품 제안박스(다중 선택) 설정 함수
function setupSetupLogRegPartDropdown(modalContext, site, equip, presetParts = '') {
    const context = modalContext || document;
    const trigger = context.querySelector('#setup-log-reg-part-trigger');
    const dropdown = context.querySelector('#setup-log-reg-part-dropdown');
    const search = context.querySelector('#setup-log-reg-part-search');
    const list = context.querySelector('#setup-log-reg-part-list');
    const displayBox = context.querySelector('#setup-log-reg-part-display');
    const hiddenInput = context.querySelector('#setup-log-reg-part-hidden');
    const addBtn = context.querySelector('#btn-setup-log-reg-part-add');

    if(!trigger || !dropdown) return;

    let adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    
    // 프리셋 파싱 (수정 모드용)
    const currentSelections = {};
    if(presetParts) {
        const partsArr = presetParts.split(',').map(s => s.trim()).filter(Boolean);
        partsArr.forEach(p => {
            const match = p.match(/^\[(.*?)\] (.*)$/);
            if(match) currentSelections[match[2]] = match[1];
            else currentSelections[p] = '무상(셋업)';
        });
    }

    const renderDisplayBox = () => {
        const selectedNames = Object.keys(currentSelections);
        displayBox.innerHTML = '';
        if (selectedNames.length === 0) {
            displayBox.innerHTML = '<div style="color:#8b949e; font-size:12px; text-align:center; padding:10px;">선택된 물품이 없습니다.</div>';
            trigger.textContent = '물품 선택';
            trigger.style.color = '#8b949e';
            hiddenInput.value = '';
            return;
        }

        const partsArr = selectedNames.map(name => `[${currentSelections[name]}] ${name}`);
        hiddenInput.value = partsArr.join(', ');

        if (selectedNames.length > 1) {
            trigger.textContent = `${selectedNames[0]} 외 ${selectedNames.length - 1}개`;
        } else {
            trigger.textContent = selectedNames[0];
        }
        trigger.style.color = '#fff';
        trigger.title = partsArr.join('\n');

        selectedNames.forEach(name => {
            const cost = currentSelections[name];
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px solid #30363d; font-size:12px; color:#e6edf3;';
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                    <span style="background:#30363d; padding:2px 6px; border-radius:4px; font-size:10px; color:#e6edf3; flex-shrink:0;">${cost}</span>
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name}">${name}</span>
                </div>
                <span style="color:#f85149; cursor:pointer; font-weight:bold; margin-left:10px; padding:0 5px;" title="삭제">✕</span>
            `;
            div.querySelector('span[title="삭제"]').onclick = (e) => {
                e.stopPropagation();
                delete currentSelections[name];
                renderDisplayBox();
                renderList(search.value); // 드롭다운 체크박스 상태도 동기화
            };
            displayBox.appendChild(div);
        });
    };

    const renderList = (query = '') => {
        const keywords = query.toLowerCase().split(/\s+/);
        let matches = adminItems;
        if (query) {
            matches = adminItems.filter(m => {
                const text = `${m.part || ''} ${m.code || ''}`.toLowerCase();
                return keywords.every(kw => text.includes(kw));
            });
        }

        const uniqueItems = [];
        const seen = new Set();
        matches.forEach(m => {
            // [수정] 리스트 텍스트를 심플하게 코드명(없으면 물품명)으로만 표시
            const displayValue = m.code ? m.code : m.part;
            if (!seen.has(displayValue)) {
                seen.add(displayValue);
                uniqueItems.push({ ...m, displayValue });
            }
        });

        Object.keys(currentSelections).forEach(sel => {
            if(!seen.has(sel)) {
                seen.add(sel);
                uniqueItems.unshift({ part: sel, displayValue: sel });
            }
        });

        list.innerHTML = '';
        if (uniqueItems.length === 0) {
            list.innerHTML = '<li style="padding:10px; color:#8b949e; text-align:center; font-size:12px;">검색 결과가 없습니다.</li>';
            return;
        }

        uniqueItems.forEach(item => {
            const val = item.displayValue;
            const isSelected = currentSelections.hasOwnProperty(val);
            const itemCost = isSelected ? currentSelections[val] : '무상(셋업)';
            const li = document.createElement('li');
            li.style.cssText = `padding: 6px 8px; font-size: 12px; cursor: pointer; border-radius: 4px; margin-bottom: 2px; display: flex; align-items: center; justify-content: space-between; ${isSelected ? 'background: #1f6feb; color: #fff;' : 'color: #e6edf3;'}`;
            
            li.innerHTML = `
                <div style="display:flex; align-items:center; gap:5px; flex:1; min-width:0;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(val)}</span>
                </div>
                <select class="item-cost-select" style="background:#0d1117; border:1px solid #30363d; color:#fff; border-radius:3px; padding:2px; font-size:11px; margin-left:5px; pointer-events:auto;" onclick="event.stopPropagation();">
                    <option value="무상(셋업)" ${itemCost === '무상(셋업)' ? 'selected' : ''}>무상(셋업)</option>
                    <option value="무상(중고)" ${itemCost === '무상(중고)' ? 'selected' : ''}>무상(중고)</option>
                    <option value="유상" ${itemCost === '유상' ? 'selected' : ''}>유상</option>
                    <option value="기타" ${itemCost === '기타' ? 'selected' : ''}>기타</option>
                </select>
            `;

            let startY = 0;
            let startX = 0;
            let isMoving = false;

            li.addEventListener('touchstart', (e) => {
                window.lastTouchTime = Date.now();
                startY = e.touches[0].clientY;
                startX = e.touches[0].clientX;
                isMoving = false;
            }, { passive: true });

            li.addEventListener('touchmove', (e) => {
                const moveY = e.touches[0].clientY;
                const moveX = e.touches[0].clientX;
                if (Math.abs(moveY - startY) > 6 || Math.abs(moveX - startX) > 6) {
                    isMoving = true;
                }
            }, { passive: true });

            const handleSelect = (e) => {
                if(e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
                e.preventDefault();
                e.stopPropagation();
                if (currentSelections.hasOwnProperty(val)) {
                    delete currentSelections[val];
                } else {
                    const cSel = li.querySelector('select');
                    currentSelections[val] = cSel ? cSel.value : '무상(셋업)';
                }
                renderDisplayBox();
                renderList(search.value);
            };

            li.addEventListener('touchend', (e) => {
                if (isMoving) return;
                handleSelect(e);
            });

            li.addEventListener('mousedown', (e) => {
                if (window.lastTouchTime && Date.now() - window.lastTouchTime < 600) return;
                handleSelect(e);
            });

            li.querySelector('select').addEventListener('change', (e) => {
                e.stopPropagation();
                if (currentSelections.hasOwnProperty(val)) {
                    currentSelections[val] = e.target.value;
                    renderDisplayBox();
                }
            });

            list.appendChild(li);
        });
    };

    trigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
        dropdown.classList.toggle('show');
        if (dropdown.classList.contains('show')) {
            renderList(search.value);
            search.focus();
        }
    };

    search.onclick = (e) => e.stopPropagation();
    search.oninput = (e) => renderList(e.target.value);

    document.addEventListener('click', (e) => {
        if (dropdown.classList.contains('show') && e.target !== trigger && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });

    if (addBtn) {
        addBtn.onclick = (e) => {
            e.stopPropagation();
            // [수정] 모달 호출 기능 대신 단순히 드롭다운을 닫는 '선택 완료' 기능으로 변경
            dropdown.classList.remove('show');
        };
    }

    renderDisplayBox();
}

// [추가] 셋업 작업 상태(진행률, 시작/완료일) 자동 재계산 유틸리티
function recalculateSetupTaskStatus(data, taskContent, site = null, equip = null, isManualCompleted = null) {
    if (!data.setupDetails) data.setupDetails = [];
    let task = data.setupDetails.find(t => t.content === taskContent || t.subcategory === taskContent || (taskContent === '셋업 완료' && (t.category === '셋업 완료' || t.content === '셋업 완료' || t.subcategory === '셋업 완료')));
    
    // 만약 setupDetails에 해당 작업이 없다면 동적 생성 추가
    if (!task && taskContent) {
        task = {
            id: Date.now(),
            category: (taskContent === '셋업 완료' ? '셋업 완료' : ''),
            subcategory: taskContent,
            content: taskContent,
            startDate: "", date: "", estDays: "1",
            completed: false, execStartDate: "", delayReason: ""
        };
        data.setupDetails.push(task);
    }
    if (!task) return false;

    const taskLogs = (data.setupLogs || []).filter(l => {
        const lSub = l.subcategory || '';
        const lCont = l.content || '';
        const lCat = l.category || '';
        const tSub = task.subcategory || '';
        const tCont = task.content || '';
        const tCat = task.category || '';

        if (taskContent === '셋업 완료' || tCat === '셋업 완료' || tSub === '셋업 완료' || tCont === '셋업 완료') {
            if (lCat === '셋업 완료' || lSub === '셋업 완료' || lCont === '셋업 완료') return true;
        }

        if (lSub && (lSub === taskContent || lSub === tSub || lSub === tCont)) return true;
        if (lCont && (lCont === taskContent || lCont === tSub || lCont === tCont)) return true;
        if (tCat && lCat === tCat) {
            if (lSub && (lSub === tSub || lSub === tCont)) return true;
            if (lCont && (lCont === tSub || lCont === tCont)) return true;
        }
        return false;
    });

    taskLogs.sort((a, b) => new Date(a.date) - new Date(b.date));

    let prevCompleted = task.completed;

    if (taskLogs.length === 0) {
        task.execStartDate = "";
        task.date = "";
        task.completed = false;
        task.delayReason = "";
    } else {
        task.execStartDate = taskLogs[0].date;
        task.date = taskLogs[taskLogs.length - 1]?.date || taskLogs[0].date;
        task.completed = true;

        if (isManualCompleted === false) {
            task.completed = false;
        }
    }

    // 셋업 완료 작업인 경우 setupDetails의 모든 '셋업 완료' 항목을 동기화 완료 처리
    if (task.category === '셋업 완료' || task.subcategory === '셋업 완료' || task.content === '셋업 완료') {
        data.setupDetails.forEach(t => {
            if (t.category === '셋업 완료' || t.subcategory === '셋업 완료' || t.content === '셋업 완료') {
                if (taskLogs.length > 0) {
                    t.completed = true;
                    t.date = taskLogs[taskLogs.length - 1]?.date || taskLogs[0].date;
                    t.execStartDate = taskLogs[0].date;
                }
            }
        });
    }

    // [추가] 셋업 완료 기록이 삭제되어 미완료 상태로 롤백된 경우, 장비 상태를 셋업 장비로 복구
    if (prevCompleted && !task.completed && (task.category === '셋업 완료' || task.content === '셋업 완료')) {
        const targetSite = site || (typeof currentPath !== 'undefined' ? currentPath.site : null);
        const targetEquip = equip || (typeof currentPath !== 'undefined' ? currentPath.equip : null);
        
        if (targetSite && targetEquip) {
            const detailKey = `details_${targetSite}_${targetEquip}`;
            const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
            if (detailData.setup && ['워런티', '가동 장비', '유휴 장비', '이관 대기'].includes(detailData.setup.equipStatus)) {
                detailData.setup.equipStatus = '셋업 장비';
                detailData.setup.warrantyStart = '';
                detailData.setup.warrantyPeriod = '';
                localStorage.setItem(detailKey, JSON.stringify(detailData));
                
                if (typeof window.syncAdminDB === 'function') {
                    window.syncAdminDB('equip', 'UPDATE', {
                        old_id: targetEquip, new_id: targetEquip, site: targetSite, old_site: targetSite, new_site: targetSite,
                        setup: detailData.setup, special_note: detailData.specialNote || ''
                    });
                }
            }
        }
    }

    return true;
}

/* ==========================================================================
   셋업 완료 처리 및 이력 모달 (Setup Complete & History Modals)
   ========================================================================== */
window.openSetupCompleteModal = function(site, equip, readOnly = false) {
    const modal = document.getElementById('setup-complete-modal');
    if (!modal) return;

    const userRole = sessionStorage.getItem('userRole');
    if (userRole !== 'admin' && userRole !== 'superadmin') {
        alert('셋업 완료 처리는 관리자만 가능합니다.');
        return;
    }

    currentSetupCompleteTarget = { site, equip };

    const key = `details_${site}_${equip}`;
    const detailData = JSON.parse(localStorage.getItem(key)) || {};
    const setupInfo = detailData.setup || {};

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const sData = setupData[`${site}::${equip}`] || {};
    let isRejected = false;
    let rejectReasonText = '';
    let existingTransferComment = '';
    
    if (sData.setupDetails) {
        const completeTask = sData.setupDetails.find(t => t.content === '셋업 완료');
        if (completeTask) {
            existingTransferComment = completeTask.transferComment || '';
            if (completeTask.rejectReason && setupInfo.equipStatus === '이관 반려') {
                isRejected = true;
                rejectReasonText = completeTask.rejectReason;
            }
        }
    }

    const infoEl = document.getElementById('setup-complete-target-info');
    const custEquipNameInput = document.getElementById('setup-complete-cust-equip-name');
    const startInput = document.getElementById('setup-complete-warranty-start');
    const periodInput = document.getElementById('setup-complete-warranty-period');

    const custManagerInput = document.getElementById('setup-complete-cust-manager');
    const custContactInput = document.getElementById('setup-complete-cust-contact');
    const custEmailInput = document.getElementById('setup-complete-cust-email');
    const transferCommentInput = document.getElementById('setup-complete-transfer-comment');

    const confirmBtn = document.getElementById('btn-confirm-setup-complete');
    const cancelBtn = document.getElementById('btn-cancel-setup-complete');
    const closeBtn = document.getElementById('btn-close-setup-complete-modal');

    const info = window.formatEquipDisplayInfo(site, equip);
    // [수정] Serial No(또는 고객사 장비명) 부분을 녹색으로 강조하여 표시 및 이력 조회 버튼 추가
    if (infoEl) {
        infoEl.style.display = 'flex';
        infoEl.style.alignItems = 'center';
        infoEl.style.justifyContent = 'center';
        infoEl.style.gap = '10px';
        infoEl.innerHTML = `
            <span>${info.mainInfo} <span style="color: #3fb950;">${info.subInfo}</span></span>
            <button id="btn-setup-complete-history" class="btn-shortcut" style="padding: 2px 8px; font-size: 11px;">이력</button>
        `;
        const historyBtn = infoEl.querySelector('#btn-setup-complete-history');
        if (historyBtn) {
            historyBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof window.openSetupHistoryModal === 'function') {
                    window.openSetupHistoryModal(site, equip);
                }
            };
        }
    }

    const rejectInfoEl = document.getElementById('setup-complete-reject-info');
    const rejectReasonEl = document.getElementById('setup-complete-reject-reason');
    const rejectMemoInput = document.getElementById('setup-complete-reject-memo');

    if (rejectInfoEl && rejectReasonEl && rejectMemoInput) {
        if (isRejected) {
            rejectInfoEl.style.display = 'block';
            rejectReasonEl.textContent = rejectReasonText || '사유 없음';
            rejectMemoInput.value = '';
        } else {
            rejectInfoEl.style.display = 'none';
        }
    }

    // 이관 완료 상태 확인
    const isTransferComplete = ['워런티', '가동 장비', '유휴 장비'].includes(setupInfo.equipStatus);
    const isPendingTransfer = setupInfo.equipStatus === '이관 대기';

    // [적용 완료] 장비 마스터(setupInfo)에 이미 저장된 고객사 정보가 있다면 해당 값을 미리 팝업 필드에 채워줍니다.
    if (startInput) {
        startInput.value = setupInfo.warrantyStart || new Date().toISOString().split('T')[0];
        startInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (periodInput) {
        periodInput.value = setupInfo.warrantyPeriod || '';
        periodInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (custEquipNameInput) {
        custEquipNameInput.value = setupInfo.custEquipName || '';
        custEquipNameInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (custManagerInput) {
        custManagerInput.value = setupInfo.manager || '';
        custManagerInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (custContactInput) {
        custContactInput.value = setupInfo.contact || '';
        custContactInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (custEmailInput) {
        custEmailInput.value = setupInfo.email || '';
        custEmailInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }
    if (transferCommentInput) {
        transferCommentInput.value = existingTransferComment;
        transferCommentInput.disabled = isTransferComplete || isPendingTransfer || readOnly;
    }

    // [추가] 장비 이관 확인 팝업 등에서 고객사 정보만 수정할 수 있는 기능 추가
    let btnModifyCustInfo = document.getElementById('btn-modify-cust-info');
    if (!btnModifyCustInfo) {
        btnModifyCustInfo = document.createElement('button');
        btnModifyCustInfo.id = 'btn-modify-cust-info';
        btnModifyCustInfo.style.marginLeft = '10px';
        if (confirmBtn && confirmBtn.parentNode) {
            confirmBtn.parentNode.insertBefore(btnModifyCustInfo, confirmBtn.nextSibling);
        }
    }
    
    let isCustInfoDirty = false;

    if (!isTransferComplete && (readOnly || isPendingTransfer)) {
        btnModifyCustInfo.style.display = 'inline-block';
        btnModifyCustInfo.className = 'btn-green';
        btnModifyCustInfo.textContent = '고객사 정보 수정';
        
        if (custEquipNameInput) custEquipNameInput.disabled = false;
        if (custManagerInput) custManagerInput.disabled = false;
        if (custContactInput) custContactInput.disabled = false;
        if (custEmailInput) custEmailInput.disabled = false;

        const getCustInfoState = () => {
            return {
                name: custEquipNameInput ? custEquipNameInput.value.trim() : '',
                manager: custManagerInput ? custManagerInput.value.trim() : '',
                contact: custContactInput ? custContactInput.value.trim() : '',
                email: custEmailInput ? custEmailInput.value.trim() : ''
            };
        };
        
        let initialCustInfoStr = JSON.stringify(getCustInfoState());

        const checkDirty = () => {
            const currentStr = JSON.stringify(getCustInfoState());
            if (currentStr !== initialCustInfoStr) {
                isCustInfoDirty = true;
                btnModifyCustInfo.className = 'btn-orange'; 
            } else {
                isCustInfoDirty = false;
                btnModifyCustInfo.className = 'btn-green';
            }
        };

        if (custEquipNameInput) custEquipNameInput.oninput = checkDirty;
        if (custManagerInput) custManagerInput.oninput = checkDirty;
        if (custContactInput) custContactInput.oninput = checkDirty;
        if (custEmailInput) custEmailInput.oninput = checkDirty;

        btnModifyCustInfo.onclick = async () => {
            if (!isCustInfoDirty) {
                alert('수정된 고객사 정보가 없습니다.');
                return;
            }
            
            const currentCustInfo = getCustInfoState();
            const detailKey = `details_${site}_${equip}`;
            const currentDetailData = JSON.parse(localStorage.getItem(detailKey)) || {};
            if (!currentDetailData.setup) currentDetailData.setup = {};
            
            currentDetailData.setup.custEquipName = currentCustInfo.name;
            currentDetailData.setup.manager = currentCustInfo.manager;
            currentDetailData.setup.contact = currentCustInfo.contact;
            currentDetailData.setup.email = currentCustInfo.email;
            
            const success = await window.syncAdminDB('equip', 'UPDATE', {
                old_id: equip, new_id: equip, site: site, old_site: site, new_site: site,
                setup: currentDetailData.setup, special_note: currentDetailData.specialNote || ''
            });
            
            if (success) {
                localStorage.setItem(detailKey, JSON.stringify(currentDetailData));
                initialCustInfoStr = JSON.stringify(currentCustInfo);
                checkDirty(); 
                alert('고객사 정보가 성공적으로 수정되었습니다.');
            } else {
                alert('고객사 정보 저장 중 오류가 발생했습니다.');
            }
        };
    } else {
        btnModifyCustInfo.style.display = 'none';
        isCustInfoDirty = false;
    }
    
    if (confirmBtn) {
        if (isTransferComplete || readOnly) {
            confirmBtn.style.display = 'none';
        } else {
            confirmBtn.style.display = 'inline-block';
            if (isPendingTransfer) {
                confirmBtn.textContent = '이관 취소';
                confirmBtn.classList.remove('btn-blue');
                confirmBtn.classList.add('btn-orange');
            } else {
                confirmBtn.textContent = '이관';
                confirmBtn.classList.remove('btn-orange');
                confirmBtn.classList.add('btn-blue');
            }
        }
    }
    if (cancelBtn) cancelBtn.textContent = (isTransferComplete || isPendingTransfer || readOnly) ? '닫기' : '취소';

    const closeModal = () => {
        if (isCustInfoDirty) {
            alert('수정된 고객사 정보가 저장되지 않았습니다. 수정 버튼을 눌러 저장해주세요.');
            return;
        }
        modal.style.display = 'none';
        currentSetupCompleteTarget = null;
        
        const transferModal = document.getElementById('equip-transfer-modal');
        if (transferModal && transferModal.style.display !== 'none') {
            if (typeof window.openEquipTransferModal === 'function') {
                window.openEquipTransferModal(); 
            }
        }
    };

    cancelBtn.onclick = closeModal;
    closeBtn.onclick = closeModal;

    confirmBtn.onclick = async () => {
        if (isPendingTransfer) {
            if (confirm('장비 이관을 취소하고 셋업 장비 상태로 되돌리시겠습니까?')) {
                const { site, equip } = currentSetupCompleteTarget;
                const detailKey = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
                if (detailData.setup) {
                    detailData.setup.equipStatus = '셋업 장비';

                    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
                    const sData = setupData[`${site}::${equip}`];
                    if (sData && sData.setupDetails) {
                        const completeTask = sData.setupDetails.find(t => t.content === '셋업 완료');
                        if (completeTask) {
                            completeTask.rejectReason = '';
                            completeTask.delayReason = '';
                            completeTask.transferComment = '';
                            localStorage.setItem('setup_data', JSON.stringify(setupData));
                            if (typeof window.syncSetupDataDB === 'function') {
                                await window.syncSetupDataDB(site, equip, sData.setupDetails, sData.setupLogs);
                            }
                        }
                    }

                    const success = await window.syncAdminDB('equip', 'UPDATE', {
                        old_id: equip, new_id: equip, site: site, old_site: site, new_site: site,
                        setup: detailData.setup, special_note: detailData.specialNote || ''
                    });

                    if (success) {
                        localStorage.setItem(detailKey, JSON.stringify(detailData));
                        if (typeof addSystemLog === 'function') addSystemLog('CANCEL_TRANSFER', equip, '이관 대기 상태 취소 -> 셋업 장비로 전환');
                        alert('이관이 취소되었습니다. 장비가 셋업 장비 상태로 변경되었습니다.');
                        closeModal();
                        if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
                    } else {
                        alert('서버에 상태를 저장하는 중 오류가 발생했습니다.');
                    }
                }
            }
            return;
        }

        if (!currentSetupCompleteTarget) return;

        const warrantyStart = startInput.value;
        const warrantyPeriod = periodInput.value;

        if (!warrantyStart || !warrantyPeriod) {
            alert('워런티 시작일과 기한을 모두 입력해주세요.');
            return;
        }

        const custEquipName = custEquipNameInput ? custEquipNameInput.value.trim() : '';
        const custManager = custManagerInput ? custManagerInput.value.trim() : '';
        const custContact = custContactInput ? custContactInput.value.trim() : '';
        const custEmail = custEmailInput ? custEmailInput.value.trim() : '';
        const transferComment = transferCommentInput ? transferCommentInput.value.trim() : '';

        const rejectInfoEl = document.getElementById('setup-complete-reject-info');
        const rejectMemoInput = document.getElementById('setup-complete-reject-memo');
        const rejectMemo = (rejectInfoEl && rejectInfoEl.style.display !== 'none' && rejectMemoInput) ? rejectMemoInput.value.trim() : '';

        const { site, equip } = currentSetupCompleteTarget;
        // 저장 전 최신 데이터 로드
        const currentDetailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
        if (!currentDetailData.setup) currentDetailData.setup = {};

        const isReSubmit = (currentDetailData.setup.equipStatus === '이관 반려' || (rejectInfoEl && rejectInfoEl.style.display !== 'none'));

        currentDetailData.setup.equipStatus = '이관 대기';
        currentDetailData.setup.warrantyStart = warrantyStart;
        currentDetailData.setup.warrantyPeriod = warrantyPeriod;
        
        // 고객사 정보 업데이트 반영
        currentDetailData.setup.custEquipName = custEquipName;
        currentDetailData.setup.manager = custManager;
        currentDetailData.setup.contact = custContact;
        currentDetailData.setup.email = custEmail;

        // 반려 재처리 및 코멘트 갱신 시 setup_data 동기화
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const sDataToUpdate = setupData[`${site}::${equip}`];
        if (sDataToUpdate && sDataToUpdate.setupDetails) {
            const completeTask = sDataToUpdate.setupDetails.find(t => t.content === '셋업 완료');
            if (completeTask) {
                let isSetupDataModified = false;
                if (isReSubmit) {
                    completeTask.rejectReason = '';
                    if (rejectMemo) {
                        completeTask.delayReason = rejectMemo; // 수정/보완 사항 저장
                    }
                    isSetupDataModified = true;
                }
                if (completeTask.transferComment !== transferComment) {
                    completeTask.transferComment = transferComment;
                    isSetupDataModified = true;
                }
                if (isSetupDataModified) {
                    localStorage.setItem('setup_data', JSON.stringify(setupData));
                    if (typeof window.syncSetupDataDB === 'function') {
                        window.syncSetupDataDB(site, equip, sDataToUpdate.setupDetails, sDataToUpdate.setupLogs);
                    }
                }
            }
        }

        // DB Sync
        const success = await window.syncAdminDB('equip', 'UPDATE', {
            old_id: equip, new_id: equip, site: site, old_site: site, new_site: site,
            setup: currentDetailData.setup, special_note: currentDetailData.specialNote || ''
        });

        if (success) {
            localStorage.setItem(`details_${site}_${equip}`, JSON.stringify(currentDetailData));
            
            let logDetails = '셋업 완료 처리 -> 이관 대기로 전환';
            if (isReSubmit && rejectMemo) logDetails += ` (수정사항: ${rejectMemo})`;
            
            if (typeof addSystemLog === 'function') addSystemLog('UPDATE_EQUIP_STATUS', equip, logDetails);
            alert('셋업 완료 및 이관 처리가 완료되었습니다.\n장비가 이관 대기 상태로 변경되었습니다.');
            closeModal();
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard(); // Refresh dashboard
        } else {
            alert('서버에 완료 상태를 저장하는 중 오류가 발생했습니다.');
        }
    };

    modal.style.display = 'flex';
}

window.openSetupHistoryModal = function(site, equip) {
    const modal = document.getElementById('setup-history-modal');
    if (!modal) return;

    const titleEl = document.getElementById('setup-history-title');
    const tbody = document.getElementById('setup-history-list-body');
    const memoEl = document.getElementById('setup-history-memo');
    const partsList = document.getElementById('setup-history-parts-list');
    
    tbody.innerHTML = '';
    memoEl.value = '';
    partsList.innerHTML = '<li style="padding:20px; text-align:center; color:#8b949e; font-size:12px;">일지를 선택해주세요</li>';
    
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const info = window.formatEquipDisplayInfo(site, equip, equipmentModels);
    
    titleEl.innerHTML = `셋업 이력 - ${info.mainInfo} <span style="color:#3fb950; font-size: 14px;">${info.subInfo}</span>`;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const data = setupData[equipKey] || {};
    const logs = data.setupLogs || [];

    const sortedLogs = [...logs].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sortedLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#8b949e;">셋업 일지 기록이 없습니다.</td></tr>';
    } else {
        sortedLogs.forEach(log => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            
            const contentHtml = (typeof escapeHtml === 'function' ? escapeHtml(log.content) || '-' : log.content || '-').replace(/\[지연\]/g, '<span class="tag-delayed" style="color: #f0883e; font-weight: bold;">[지연]</span>');

            tr.innerHTML = `
                <td style="text-align:center; padding: 8px 10px; border-bottom: 1px solid #21262d;">${typeof escapeHtml === 'function' ? escapeHtml(log.date) : log.date}</td>
                <td style="text-align:left; padding: 8px 10px; border-bottom: 1px solid #21262d;">${contentHtml}</td>
                <td style="text-align:center; padding: 8px 10px; border-bottom: 1px solid #21262d;">${typeof escapeHtml === 'function' ? escapeHtml(log.worker) : log.worker}</td>
                <td style="text-align:center; color:#d29922; font-weight:bold; padding: 8px 10px; border-bottom: 1px solid #21262d;">${typeof escapeHtml === 'function' ? escapeHtml(log.md || '0') : log.md || '0'}</td>
            `;

            tr.onclick = () => {
                Array.from(tbody.children).forEach(row => row.style.backgroundColor = '');
                tr.style.backgroundColor = 'rgba(35, 134, 54, 0.1)';

                memoEl.value = log.memo || '작성된 메모가 없습니다.';

                partsList.innerHTML = '';
                if (log.parts) {
                    const partsArr = log.parts.split(',').map(s => s.trim()).filter(Boolean);
                    partsArr.forEach(partText => {
                        let pureContent = partText;
                        let itemCost = '';
                        const costMatch = pureContent.match(/^\[(.*?)\]\s*(.*)$/);
                        if (costMatch) { itemCost = costMatch[1]; pureContent = costMatch[2]; }
                        
                        const li = document.createElement('li');
                        li.style.cssText = 'padding: 8px 10px; border-bottom: 1px solid #30363d; font-size: 12px; color: #c9d1d9; display: flex; justify-content: space-between; align-items: center;';
                        li.innerHTML = `
                            <span style="font-weight:bold; color:#58a6ff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${typeof escapeHtml === 'function' ? escapeHtml(pureContent) : pureContent}">${typeof escapeHtml === 'function' ? escapeHtml(pureContent) : pureContent}</span>
                            ${itemCost ? `<span style="font-size:10px; background:#30363d; padding:2px 6px; border-radius:4px; color:#e6edf3; flex-shrink:0;">${typeof escapeHtml === 'function' ? escapeHtml(itemCost) : itemCost}</span>` : ''}
                        `;
                        partsList.appendChild(li);
                    });
                } else {
                    partsList.innerHTML = '<li style="padding:20px; text-align:center; color:#8b949e; font-size:12px;">선택된 물품 없음</li>';
                }
            };
            tbody.appendChild(tr);
        });
        
        if (tbody.firstChild) tbody.firstChild.click();
    }

    modal.style.display = 'flex';
    const closeBtn = document.getElementById('btn-close-setup-history-modal');
    if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
};

// 저장 이벤트 처리
document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', async (e) => {
        if (e.target.id === 'btn-close-setup-log-reg') {
            const modal = e.target.closest('.modal-overlay');
            if (modal) modal.style.display = 'none';
        } else if (e.target.id === 'btn-delete-setup-log-reg') {
            const modal = e.target.closest('.modal-overlay') || document;
            const logId = modal.querySelector('#setup-log-reg-id') ? modal.querySelector('#setup-log-reg-id').value : '';
            const site = modal.querySelector('#setup-log-reg-site') ? modal.querySelector('#setup-log-reg-site').value : '';
            const equip = modal.querySelector('#setup-log-reg-equip') ? modal.querySelector('#setup-log-reg-equip').value : '';
            
            if (!logId || !site || !equip) return;
            
            if (!confirm('해당 셋업 작업 기록을 삭제하시겠습니까?')) return;
            
            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${site}::${equip}`;
            let data = setupData[equipKey] || {};
            
            if (data.setupLogs) {
                const targetLog = data.setupLogs.find(l => l.id == logId);
                data.setupLogs = data.setupLogs.filter(l => l.id != logId);
                
                if (targetLog && data.setupDetails && typeof recalculateSetupTaskStatus === 'function') {
                    recalculateSetupTaskStatus(data, targetLog.content, site, equip);
                }
                
                setupData[equipKey] = data;
                localStorage.setItem('setup_data', JSON.stringify(setupData));
                
                if (typeof window.syncSetupDataDB === 'function') {
                    window.syncSetupDataDB(site, equip, data.setupDetails, data.setupLogs);
                }
                
                if (typeof addSystemLog === 'function') {
                    addSystemLog('DELETE_SETUP_LOG', equip, `LogID: ${logId}`);
                }
                
                const parentModal = e.target.closest('.modal-overlay');
                if (parentModal) parentModal.style.display = 'none';
                alert('기록이 삭제되었습니다.');
                
                if (typeof renderSetupLogList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                    renderSetupLogList();
                }
                if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                    renderSetupDetailList();
                }
                if (typeof renderGanttChart === 'function') renderGanttChart();

                // [추가] 대시보드 리스트 즉시 갱신
                if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
                if (typeof updateIntegratedDashboard === 'function') updateIntegratedDashboard();
            }
        } else if (e.target.id === 'btn-save-setup-log-reg') {
            const modal = e.target.closest('.modal-overlay') || document;
            const site = modal.querySelector('#setup-log-reg-site').value;
            const equip = modal.querySelector('#setup-log-reg-equip').value;
            const date = modal.querySelector('#setup-log-reg-date').value;
            const category = modal.querySelector('#setup-log-reg-category') ? modal.querySelector('#setup-log-reg-category').value : '';
            const subcategory = modal.querySelector('#setup-log-reg-subcategory') ? modal.querySelector('#setup-log-reg-subcategory').value : '';
            const content = modal.querySelector('#setup-log-reg-content') ? modal.querySelector('#setup-log-reg-content').value.trim() : '';
            const task = subcategory || content; // task 필드 호환
            const worker = modal.querySelector('#setup-log-reg-worker').value;
            const md = modal.querySelector('#setup-log-reg-md').value;
            const memo = modal.querySelector('#setup-log-reg-memo').value;
            // [추가] 선택된 셋업 물품 데이터
            const parts = modal.querySelector('#setup-log-reg-part-hidden') ? modal.querySelector('#setup-log-reg-part-hidden').value : '';
            const logId = modal.querySelector('#setup-log-reg-id') ? modal.querySelector('#setup-log-reg-id').value : ''; // 수정 모드 식별자
            
            if(!site || !equip || !date || !category || !subcategory || !worker || !md) {
                return alert('사업장, 장비, 작업일, 셋업 구분, 세부 구분, 작업자, 공수를 모두 입력해주세요.');
            }
            
            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${site}::${equip}`;
            let data = setupData[equipKey] || {};
            if (!data.setupLogs) data.setupLogs = [];
            
            let isUpdating = false;
            if (logId) {
                // 수정 업데이트
                const existingLog = data.setupLogs.find(l => l.id == logId);
                if (existingLog) {
                    existingLog.date = date;
                    existingLog.category = category;
                    existingLog.subcategory = subcategory;
                    existingLog.content = content || '';
                    existingLog.worker = worker;
                    existingLog.md = md;
                    existingLog.memo = memo;
                    existingLog.parts = parts; // [추가] 물품 업데이트
                    isUpdating = true;
                }
            }

            if (!isUpdating) {
                // 신규 등록
                const newLog = {
                    id: Date.now(),
                    date: date,
                    category: category,
                    subcategory: subcategory,
                    content: content || '',
                    worker: worker,
                    company: "위드텍",
                    memo: memo,
                    md: md,
                    parts: parts // [추가] 물품 등록
                };
                data.setupLogs.push(newLog);
            }

            // [개선] 셋업 로그 기록 시 setupDetails의 해당 예정 항목을 즉시 완료 처리
            let setupDetailsUpdated = false;
            if (data.setupDetails) {
                data.setupDetails.forEach(t => {
                    const isCatMatch = !t.category || !category || t.category === category;
                    const isSubMatch = (t.subcategory && (t.subcategory === subcategory || t.subcategory === content || t.subcategory === task)) ||
                                       (t.content && (t.content === content || t.content === subcategory || t.content === task));
                    const isCompleteSpecial = (category === '셋업 완료' || subcategory === '셋업 완료' || content === '셋업 완료') &&
                                              (t.category === '셋업 완료' || t.subcategory === '셋업 완료' || t.content === '셋업 완료');

                    if ((isCatMatch && isSubMatch) || isCompleteSpecial) {
                        t.completed = true;
                        t.date = date;
                        t.execStartDate = t.execStartDate || date;
                        if (worker) t.worker = worker;
                        setupDetailsUpdated = true;
                    }
                });
            }
            const statusRecalculated = recalculateSetupTaskStatus(data, task, site, equip, null);
            if (statusRecalculated) setupDetailsUpdated = true;

            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));
            
            if (typeof window.syncSetupDataDB === 'function') {
                await window.syncSetupDataDB(site, equip, data.setupDetails || [], data.setupLogs);
            }
            
            if (typeof addSystemLog === 'function') addSystemLog(isUpdating ? 'UPDATE_SETUP_LOG' : 'ADD_SETUP_LOG', equip, `[${category} > ${subcategory}] ${worker} (${md}MD)`);
            
            const parentModal = e.target.closest('.modal-overlay');
            if (parentModal) parentModal.style.display = 'none';
            alert('기록이 저장되었습니다.');
            
            if (typeof renderSetupLogList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                renderSetupLogList();
            }
            
            // [수정] 셋업 기록(일지)이 추가되면 간트 차트에 즉시 반영(블록 생성 등)되도록 항상 리프레시
            if (typeof renderGanttChart === 'function') renderGanttChart();

            if (setupDetailsUpdated) {
                if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                    renderSetupDetailList(); // 셋업 세부사항 리스트 리프레시
                }
            }

            // [추가] 대시보드 리스트 즉시 갱신
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
            if (typeof updateIntegratedDashboard === 'function') updateIntegratedDashboard();
        }
    });
});

/* ==========================================================================
   [추가] 간트 차트 셋업 작업 추가 팝업 모달
   ========================================================================== */
window.openAddSetupTaskModal = function(site, equip, defaultCategory) {
    let modal = document.getElementById('add-setup-task-modal');
    if (!modal) {
        return alert('셋업 작업 추가 모달 템플릿을 찾을 수 없습니다.');
    }

    // [수정] 이벤트 리스너 중복 바인딩 방지 (초기 1회만 설정)
    if (!modal.dataset.initialized) {
        modal.dataset.initialized = 'true';
        document.getElementById('btn-close-add-setup-task').onclick = () => modal.style.display = 'none';
        document.getElementById('btn-cancel-add-setup-task').onclick = () => modal.style.display = 'none';
        
        const confirmBtn = document.getElementById('btn-confirm-add-setup-task');
        const nameInput = document.getElementById('add-setup-task-name');

        confirmBtn.onclick = async () => {
            const site = modal.dataset.site;
            const equip = modal.dataset.equip;
            const category = document.getElementById('add-setup-task-category').value;
            const taskName = nameInput.value.trim();

            if (!taskName) {
                alert('작업명을 입력해주세요.');
                nameInput.focus();
                return;
            }

            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${site}::${equip}`;
            let data = setupData[equipKey] || {};
            if (!data.setupDetails) data.setupDetails = [];

            // 중복 확인
            if (data.setupDetails.some(t => t.content === taskName)) {
                alert('이미 존재하는 작업명입니다.');
                nameInput.focus();
                return;
            }

            const newTask = {
                id: Date.now(),
                category: category,
                content: taskName,
                startDate: "", date: "", estDays: "1",
                completed: false, execStartDate: "", delayReason: ""
            };

            // 해당 카테고리의 가장 마지막 위치에 삽입
            let insertIndex = data.setupDetails.length;
            let prevStartDate = "";
            for (let i = data.setupDetails.length - 1; i >= 0; i--) {
                if (data.setupDetails[i].category === category) {
                    insertIndex = i + 1;
                    prevStartDate = data.setupDetails[i].startDate;
                    break;
                }
            }
            const completeIdx = data.setupDetails.findIndex(t => t.content === '셋업 완료' || t.category === '셋업 완료');
            if (completeIdx !== -1 && insertIndex > completeIdx) insertIndex = completeIdx;

            // [수정] 새로 추가된 항목이 간트 뷰 필터링에서 무시되지 않도록 이전 항목의 시작일 또는 오늘 날짜를 기본 부여
            if (!prevStartDate && insertIndex > 0) prevStartDate = data.setupDetails[insertIndex - 1].startDate;
            newTask.startDate = prevStartDate || new Date().toISOString().split('T')[0];

            data.setupDetails.splice(insertIndex, 0, newTask);
            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));

            if (typeof window.syncSetupDataDB === 'function') await window.syncSetupDataDB(site, equip, data.setupDetails, data.setupLogs);
            if (typeof addSystemLog === 'function') addSystemLog('ADD_SETUP_ITEM', equip, `간트뷰에서 작업 추가: [${category}] ${taskName}`);

            modal.style.display = 'none';
            
            if (typeof renderGanttChart === 'function') renderGanttChart();
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
            if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) renderSetupDetailList();
        };

        nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmBtn.click(); });
    }

    modal.dataset.site = site;
    modal.dataset.equip = equip;
    const categorySelect = document.getElementById('add-setup-task-category');
    if (categorySelect) categorySelect.value = (defaultCategory && defaultCategory !== '셋업 완료') ? defaultCategory : '장비 반입 및 정위치';
    document.getElementById('add-setup-task-name').value = '';

    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('add-setup-task-name').focus(), 100);
};

/* ==========================================================================
   셋업 작업 예정일 등록 모달 (Setup Task Schedule Register Modal)
   ========================================================================== */
function setupSetupTaskScheduleModal() {
    if (document.getElementById('setup-task-schedule-modal')) return;

    if (typeof getTemplateContent === 'function') {
        const templateContent = getTemplateContent('setup-task-schedule-modal-template');
        if (templateContent) {
            document.body.appendChild(templateContent);
        }
    }

    const modal = document.getElementById('setup-task-schedule-modal');
    if (!modal) return;

    const closeBtn = document.getElementById('btn-close-setup-task-schedule-modal');
    const saveBtn = document.getElementById('btn-save-setup-task-schedule');

    const closeModal = () => { modal.style.display = 'none'; };
    if (closeBtn) closeBtn.onclick = closeModal;

    const dateInput = modal.querySelector('#setup-sched-date');
    const siteSelect = modal.querySelector('#setup-sched-site');
    const equipHidden = modal.querySelector('#setup-sched-equip');
    const equipTrigger = modal.querySelector('#setup-sched-equip-trigger');
    const catSelect = modal.querySelector('#setup-sched-category');
    const subcatSelect = modal.querySelector('#setup-sched-subcategory');
    const contentInput = modal.querySelector('#setup-sched-content');
    const workerHidden = modal.querySelector('#setup-sched-worker');
    const workerTrigger = modal.querySelector('#setup-sched-worker-trigger');

    // has-value 업데이트 헬퍼
    const updateHasValue = (el) => {
        if (!el) return;
        if (el.value && el.value.trim() !== '') {
            el.classList.add('has-value');
        } else {
            el.classList.remove('has-value');
        }
    };

    // 실시간 값 변경 및 빨간 테두리 제거 리스너
    [dateInput, siteSelect, catSelect, subcatSelect, contentInput].forEach(el => {
        if (!el) return;
        const handler = () => {
            el.style.border = '';
            el.style.backgroundColor = '';
            updateHasValue(el);
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
    });

    // 사업장 변경 시 장비 목록 갱신
    if (siteSelect) {
        siteSelect.addEventListener('change', () => {
            const selSite = siteSelect.value;
            populateSetupSchedEquips(modal, selSite);
            updateHasValue(siteSelect);
        });
    }

    // 구분 변경 시 세부 구분 목록 갱신
    if (catSelect) {
        catSelect.addEventListener('change', () => {
            const selCat = catSelect.value;
            populateSetupSchedSubcategories(modal, selCat);
            updateHasValue(catSelect);
            updateHasValue(subcatSelect);
        });
    }

    // 세부 구분 변경 시 내용 자동 채우기
    if (subcatSelect) {
        subcatSelect.addEventListener('change', () => {
            if (!contentInput.value || contentInput.dataset.autoFilled === 'true') {
                contentInput.value = subcatSelect.value || '';
                contentInput.dataset.autoFilled = 'true';
                updateHasValue(contentInput);
            }
            updateHasValue(subcatSelect);
        });
    }
    if (contentInput) {
        contentInput.addEventListener('input', () => {
            contentInput.dataset.autoFilled = 'false';
            updateHasValue(contentInput);
        });
    }

    // 작업자 드롭다운 초기화
    setupSetupSchedWorkerDropdown(modal);

    // 저장 버튼 클릭 시 유효성 검사 및 저장
    if (saveBtn) {
        saveBtn.onclick = async () => {
            let hasError = false;
            const checkFields = [
                { val: dateInput ? dateInput.value.trim() : '', el: dateInput },
                { val: siteSelect ? siteSelect.value.trim() : '', el: siteSelect },
                { val: equipHidden ? equipHidden.value.trim() : '', el: equipTrigger },
                { val: catSelect ? catSelect.value.trim() : '', el: catSelect },
                { val: subcatSelect ? subcatSelect.value.trim() : '', el: subcatSelect },
                { val: workerHidden ? workerHidden.value.trim() : '', el: workerTrigger }
            ];

            checkFields.forEach(f => {
                if (!f.val) {
                    if (f.el) {
                        f.el.style.border = '1.5px solid #f85149';
                        f.el.style.backgroundColor = 'rgba(248, 81, 73, 0.08)';
                    }
                    hasError = true;
                } else if (f.el) {
                    f.el.style.border = '';
                    f.el.style.backgroundColor = '';
                }
            });

            if (hasError) {
                alert('입력되지 않은 필수 항목이 있습니다. 빨간색 표시 항목을 모두 입력해주세요.');
                return;
            }

            const site = siteSelect.value;
            const equip = equipHidden.value;
            const date = dateInput.value;
            const category = catSelect.value;
            const subcategory = subcatSelect.value;
            const content = contentInput.value.trim() || subcategory;
            const worker = workerHidden.value;
            const md = (worker ? worker.split(',').map(w => w.trim()).filter(Boolean).length : 1).toString();

            const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
            const equipKey = `${site}::${equip}`;
            let data = setupData[equipKey] || {};
            if (!data.setupDetails) data.setupDetails = [];
            if (!data.setupLogs) data.setupLogs = [];

            const newDetail = {
                id: Date.now(),
                category: category,
                subcategory: subcategory,
                content: content,
                startDate: date,
                date: date,
                estDays: md,
                completed: false,
                worker: worker,
                execStartDate: "",
                delayReason: ""
            };

            data.setupDetails.push(newDetail);
            setupData[equipKey] = data;
            localStorage.setItem('setup_data', JSON.stringify(setupData));

            if (typeof window.syncSetupDataDB === 'function') {
                await window.syncSetupDataDB(site, equip, data.setupDetails, data.setupLogs);
            }
            if (typeof addSystemLog === 'function') {
                addSystemLog('ADD_SETUP_ITEM', equip, `셋업 작업 예정 등록: [${category} > ${subcategory}] ${date} (${worker}, ${md}MD)`);
            }

            alert('셋업 작업 예정일이 정상적으로 등록되었습니다.');
            modal.style.display = 'none';

            if (typeof renderGanttChart === 'function') renderGanttChart();
            if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
            if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                renderSetupDetailList();
            }
        };
    }
}

// 셋업 장비 목록 커스텀 드롭다운 populate 함수 (녹색 고객사장비명/시리얼 지원)
function populateSetupSchedEquips(modal, selectedSite, targetEquip = '') {
    const equipTrigger = modal.querySelector('#setup-sched-equip-trigger');
    const equipDropdown = modal.querySelector('#setup-sched-equip-dropdown');
    const equipSearch = modal.querySelector('#setup-sched-equip-search');
    const equipList = modal.querySelector('#setup-sched-equip-list');
    const equipHidden = modal.querySelector('#setup-sched-equip');

    if (!equipTrigger || !equipList || !equipHidden) return;

    const getDeviceMap = () => {
        return (typeof getDeviceDataMap === 'function') ? getDeviceDataMap() : (JSON.parse(localStorage.getItem('device_data_map')) || JSON.parse(localStorage.getItem('deviceData')) || {});
    };

    const getEquipFormattedInfo = (site, eq) => {
        if (!eq) return { text: '', html: '', modelName: '', subText: '' };
        const parts = eq.split('::');
        const rawName = parts[0] || '';
        const serial = parts.length > 1 ? parts[1] : '';
        const custNameFromKey = parts.length > 2 ? parts[2] : '';
        const key = `details_${site}_${eq}`;
        const detailData = JSON.parse(localStorage.getItem(key)) || {};
        const custName = custNameFromKey || ((detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '');
        
        const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
        const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
        const modelName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;

        let subText = '';
        if (custName) {
            subText = `[${custName}]`;
        } else if (serial) {
            subText = `(${serial})`;
        }
        
        const plainText = subText ? `${modelName} ${subText}` : modelName;
        const subHtml = subText ? ` <span style="color: #3fb950; font-weight: 500; display: inline;">${typeof escapeHtml === 'function' ? escapeHtml(subText) : subText}</span>` : '';
        const html = `<span>${typeof escapeHtml === 'function' ? escapeHtml(modelName) : modelName}${subHtml}</span>`;
        
        return { text: plainText, html: html, modelName, subText };
    };

    const renderEquips = (filter = '') => {
        equipList.innerHTML = '';
        if (!selectedSite) {
            equipList.innerHTML = '<div class="log-select-empty" style="padding:10px; text-align:center; color:#8b949e;">사업장을 먼저 선택하세요</div>';
            return;
        }

        const map = getDeviceMap();
        const equips = map[selectedSite] ? [...map[selectedSite]] : [];

        // 셋업 장비로 구분된 장비만 필터링
        const setupEquips = equips.filter(eq => {
            if (eq.startsWith('기타(ETC)')) return false;
            const detailKey = `details_${selectedSite}_${eq}`;
            const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
            const equipStatus = (detailData.setup && detailData.setup.equipStatus) ? detailData.setup.equipStatus : (detailData.equipStatus || '');
            return equipStatus === '셋업 장비' || equipStatus.includes('셋업') || (detailData.setup && detailData.setup.isSetupEquip);
        });

        if (setupEquips.length === 0) {
            equipList.innerHTML = '<div class="log-select-empty" style="padding:10px; text-align:center; color:#8b949e;">해당 사업장에 셋업 장비가 없습니다.</div>';
            return;
        }

        let filtered = setupEquips;
        if (filter) {
            const lowerKw = filter.toLowerCase();
            filtered = setupEquips.filter(eq => {
                const info = getEquipFormattedInfo(selectedSite, eq);
                return eq.toLowerCase().includes(lowerKw) ||
                       info.text.toLowerCase().includes(lowerKw) ||
                       info.modelName.toLowerCase().includes(lowerKw) ||
                       info.subText.toLowerCase().includes(lowerKw);
            });
        }

        filtered.forEach(eq => {
            const info = getEquipFormattedInfo(selectedSite, eq);
            const item = document.createElement('div');
            item.className = 'log-select-item' + (eq === equipHidden.value ? ' selected' : '');
            item.innerHTML = info.html;
            item.onclick = (e) => {
                e.stopPropagation();
                equipHidden.value = eq;
                equipTrigger.innerHTML = info.html;
                equipTrigger.title = info.text;
                equipTrigger.classList.add('has-value');
                equipTrigger.style.border = '';
                equipTrigger.style.backgroundColor = '';
                if (equipDropdown) equipDropdown.classList.remove('show');
            };
            equipList.appendChild(item);
        });
    };

    if (!selectedSite) {
        equipHidden.value = '';
        equipTrigger.textContent = '장비 선택';
        equipTrigger.title = '';
        equipTrigger.classList.remove('has-value');
        equipTrigger.classList.add('disabled');
        return;
    }

    equipTrigger.classList.remove('disabled');
    renderEquips('');

    if (targetEquip) {
        equipHidden.value = targetEquip;
        const info = getEquipFormattedInfo(selectedSite, targetEquip);
        equipTrigger.innerHTML = info.html || targetEquip;
        equipTrigger.title = info.text || targetEquip;
        equipTrigger.classList.add('has-value');
    } else {
        equipHidden.value = '';
        equipTrigger.textContent = '장비 선택';
        equipTrigger.title = '';
        equipTrigger.classList.remove('has-value');
    }

    equipTrigger.onclick = (e) => {
        e.stopPropagation();
        if (equipTrigger.classList.contains('disabled')) return;
        const isShown = equipDropdown && equipDropdown.classList.contains('show');
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => {
            if (d !== equipDropdown) d.classList.remove('show');
        });
        if (isShown) {
            if (equipDropdown) equipDropdown.classList.remove('show');
        } else if (equipDropdown) {
            equipDropdown.classList.add('show');
            if (equipSearch) {
                equipSearch.value = '';
                setTimeout(() => equipSearch.focus(), 50);
            }
            renderEquips('');
        }
    };

    if (equipSearch) {
        equipSearch.onclick = (e) => e.stopPropagation();
        equipSearch.oninput = (e) => renderEquips(e.target.value.trim());
    }
}

// 셋업 세부구분 목록 populate 함수
function populateSetupSchedSubcategories(modal, category, targetSubcat = '') {
    const subcatSelect = modal.querySelector('#setup-sched-subcategory');
    if (!subcatSelect) return;
    subcatSelect.innerHTML = '<option value="">세부 구분 선택</option>';

    if (!category) {
        subcatSelect.disabled = true;
        subcatSelect.classList.remove('has-value');
        return;
    }

    const templates = JSON.parse(localStorage.getItem('setup_templates')) || {};
    const tplList = templates['default'] || [
        { category: "장비 반입 및 정위치", subcategory: "도면 및 다이크" },
        { category: "장비 반입 및 정위치", subcategory: "장비 반입" },
        { category: "유틸리티 연결", subcategory: "배관 연결" },
        { category: "유틸리티 연결", subcategory: "전원 인가" },
        { category: "티칭 및 캘리브레이션", subcategory: "로봇 티칭" },
        { category: "티칭 및 캘리브레이션", subcategory: "광학계 캘리브레이션" },
        { category: "셋업 평가", subcategory: "반복정밀도 평가" },
        { category: "셋업 평가", subcategory: "고객사 승인" },
        { category: "셋업 완료", subcategory: "셋업 완료" }
    ];

    const matchedSubs = [...new Set(tplList.filter(t => t.category === category).map(t => t.subcategory).filter(Boolean))];

    if (matchedSubs.length === 0) {
        subcatSelect.disabled = true;
        subcatSelect.classList.remove('has-value');
        return;
    }

    subcatSelect.disabled = false;
    matchedSubs.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        if (targetSubcat && sub === targetSubcat) opt.selected = true;
        subcatSelect.appendChild(opt);
    });

    if (matchedSubs.length > 0 && !targetSubcat) {
        subcatSelect.value = matchedSubs[0];
    }

    if (subcatSelect.value) {
        subcatSelect.classList.add('has-value');
        const contentInput = modal.querySelector('#setup-sched-content');
        if (contentInput && (!contentInput.value || contentInput.dataset.autoFilled === 'true')) {
            contentInput.value = subcatSelect.value;
            contentInput.dataset.autoFilled = 'true';
            if (contentInput.value) contentInput.classList.add('has-value');
        }
    } else {
        subcatSelect.classList.remove('has-value');
    }
}

// 작업자 선택 드롭다운 로직 (운영관리와 동일한 log-select-dropdown)
function setupSetupSchedWorkerDropdown(modal) {
    const trigger = modal.querySelector('#setup-sched-worker-trigger');
    const dropdown = modal.querySelector('#setup-sched-worker-dropdown');
    const searchInput = modal.querySelector('#setup-sched-worker-search');
    const list = modal.querySelector('#setup-sched-worker-list');
    const confirmBtn = modal.querySelector('#btn-setup-sched-worker-confirm');
    const hiddenInput = modal.querySelector('#setup-sched-worker');

    if (!trigger || !dropdown || !list || !hiddenInput) return;

    const renderList = async (searchTerm = '') => {
        list.innerHTML = '';
        const siteSelect = modal.querySelector('#setup-sched-site');
        const site = siteSelect ? siteSelect.value : '';
        const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(site) : [];
        const currentSelected = hiddenInput.value ? hiddenInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
        const allWorkers = workers.map(w => typeof w === 'string' ? { name: w, department: '', position: '', site: '' } : w);
        let displayWorkers = [...allWorkers];

        if (searchTerm) {
            const kw = searchTerm.toLowerCase();
            displayWorkers = displayWorkers.filter(w =>
                w.name.toLowerCase().includes(kw) ||
                (w.department && w.department.toLowerCase().includes(kw)) ||
                (w.position && w.position.toLowerCase().includes(kw))
            );
        }

        const displayedNames = new Set(displayWorkers.map(w => w.name));
        currentSelected.forEach(selectedName => {
            if (!displayedNames.has(selectedName)) {
                const workerToAdd = allWorkers.find(w => w.name === selectedName);
                if (workerToAdd) displayWorkers.unshift(workerToAdd);
                else displayWorkers.unshift({ name: selectedName, department: '', position: '' });
            }
        });

        if (typeof window.renderWorkerListItems === 'function') {
            window.renderWorkerListItems(list, displayWorkers, currentSelected, () => {
                const selected = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
                hiddenInput.value = selected.join(', ');
                if (selected.length > 0) {
                    trigger.textContent = selected.join(', ');
                    trigger.classList.add('has-value');
                    trigger.style.border = '';
                    trigger.style.backgroundColor = '';
                } else {
                    trigger.textContent = '작업자 선택';
                    trigger.classList.remove('has-value');
                }
                trigger.title = selected.join(', ');
            });
        } else {
            displayWorkers.forEach(w => {
                const item = document.createElement('div');
                const isSelected = currentSelected.includes(w.name);
                item.className = 'log-select-item' + (isSelected ? ' selected' : '');
                item.dataset.value = w.name;
                const pos = w.position ? ` <span style="font-size:11px; color:#8b949e;">${w.position}</span>` : '';
                item.innerHTML = `<span>${w.name}${pos}</span>`;
                item.onclick = (e) => {
                    e.stopPropagation();
                    item.classList.toggle('selected');
                };
                list.appendChild(item);
            });
        }
    };

    trigger.onclick = (e) => {
        e.stopPropagation();
        const isShown = dropdown.classList.contains('show');
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => {
            if (d !== dropdown) d.classList.remove('show');
        });
        if (isShown) {
            dropdown.classList.remove('show');
        } else {
            dropdown.classList.add('show');
            if (searchInput) {
                searchInput.value = '';
                setTimeout(() => searchInput.focus(), 50);
            }
            renderList('');
        }
    };

    if (searchInput) {
        searchInput.onclick = (e) => e.stopPropagation();
        searchInput.oninput = (e) => renderList(e.target.value.trim());
    }

    if (confirmBtn) {
        confirmBtn.onclick = (e) => {
            e.stopPropagation();
            const selected = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value || el.textContent.trim());
            const names = selected.join(', ');
            hiddenInput.value = names;
            if (names) {
                trigger.textContent = names;
                trigger.title = names;
                trigger.classList.add('has-value');
                trigger.style.border = '';
                trigger.style.backgroundColor = '';
            } else {
                trigger.textContent = '작업자 선택';
                trigger.title = '';
                trigger.classList.remove('has-value');
            }
            dropdown.classList.remove('show');
        };
    }
}

window.openSetupScheduleRegisterModal = function(site = '', equip = '', defaultDate = '') {
    setupSetupTaskScheduleModal();
    const modal = document.getElementById('setup-task-schedule-modal');
    if (!modal) return;

    const dateInput = modal.querySelector('#setup-sched-date');
    const siteSelect = modal.querySelector('#setup-sched-site');
    const catSelect = modal.querySelector('#setup-sched-category');
    const subcatSelect = modal.querySelector('#setup-sched-subcategory');
    const contentInput = modal.querySelector('#setup-sched-content');
    const workerHidden = modal.querySelector('#setup-sched-worker');
    const workerTrigger = modal.querySelector('#setup-sched-worker-trigger');
    const equipTrigger = modal.querySelector('#setup-sched-equip-trigger');

    // 빨간 테두리 초기화
    [dateInput, siteSelect, equipTrigger, catSelect, subcatSelect, contentInput, workerTrigger].forEach(el => {
        if (el) { el.style.border = ''; el.style.backgroundColor = ''; }
    });

    // 예정일 세팅 및 has-value 회색 배경 적용
    const today = new Date().toISOString().split('T')[0];
    if (dateInput) {
        dateInput.value = defaultDate || today;
        dateInput.classList.add('has-value');
    }

    // 사업장 목록 populate
    const deviceData = (typeof getDeviceDataMap === 'function') ? getDeviceDataMap() : (JSON.parse(localStorage.getItem('device_data_map')) || JSON.parse(localStorage.getItem('deviceData')) || {});
    const sites = Object.keys(deviceData).sort();
    if (siteSelect) {
        siteSelect.innerHTML = '<option value="">사업장 선택</option>';
        sites.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            if (site && s === site) opt.selected = true;
            siteSelect.appendChild(opt);
        });
        if (siteSelect.value) siteSelect.classList.add('has-value');
        else siteSelect.classList.remove('has-value');
    }

    // 장비 목록 populate
    const currentSite = site || (siteSelect ? siteSelect.value : '');
    populateSetupSchedEquips(modal, currentSite, equip);

    // 셋업 구분 목록 populate
    const templates = JSON.parse(localStorage.getItem('setup_templates')) || {};
    const tplList = templates['default'] || [
        { category: "장비 반입 및 정위치", subcategory: "도면 및 다이크" },
        { category: "장비 반입 및 정위치", subcategory: "장비 반입" },
        { category: "유틸리티 연결", subcategory: "배관 연결" },
        { category: "유틸리티 연결", subcategory: "전원 인가" },
        { category: "티칭 및 캘리브레이션", subcategory: "로봇 티칭" },
        { category: "티칭 및 캘리브레이션", subcategory: "광학계 캘리브레이션" },
        { category: "셋업 평가", subcategory: "반복정밀도 평가" },
        { category: "셋업 평가", subcategory: "고객사 승인" },
        { category: "셋업 완료", subcategory: "셋업 완료" }
    ];
    const categories = [...new Set(tplList.map(t => t.category).filter(Boolean))];
    if (catSelect) {
        catSelect.innerHTML = '<option value="">셋업 구분 선택</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            catSelect.appendChild(opt);
        });
        if (categories.length > 0) {
            catSelect.value = categories[0];
            catSelect.classList.add('has-value');
            populateSetupSchedSubcategories(modal, categories[0]);
        } else {
            catSelect.classList.remove('has-value');
        }
    }

    // 내용 초기화
    if (contentInput) {
        contentInput.value = '';
        contentInput.dataset.autoFilled = 'true';
        contentInput.classList.remove('has-value');
        if (subcatSelect && subcatSelect.value) {
            contentInput.value = subcatSelect.value;
            contentInput.classList.add('has-value');
        }
    }

    // 작업자 초기화 (로그인 유저)
    const defaultWorker = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
    if (workerHidden) workerHidden.value = defaultWorker;
    if (workerTrigger) {
        if (defaultWorker) {
            workerTrigger.textContent = defaultWorker;
            workerTrigger.title = defaultWorker;
            workerTrigger.classList.add('has-value');
        } else {
            workerTrigger.textContent = '작업자 선택';
            workerTrigger.title = '';
            workerTrigger.classList.remove('has-value');
        }
    }
    setupSetupSchedWorkerDropdown(modal);

    modal.style.display = 'flex';
};


