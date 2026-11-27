/* ==========================================================================
   Trouble 이력 관리 전용 JavaScript
   - 모든 Trouble 관련 비즈니스 로직 및 이벤트 핸들링 관리
   - 모달 구조는 trouble.html에 하드코딩하여 사용
   ========================================================================== */

let allTroubles = [];
let currentTroubleFilter = { 
    site: 'ALL', 
    model: 'ALL', 
    equip: 'ALL', 
    keyword: '',
    dateType: 'year', 
    year: String(new Date().getFullYear()), 
    month: '', 
    startDate: '', 
    endDate: '' 
};
let showCompletedOnly = false; // [추가] 작성완료 필터 상태
let currentTroubleImageBase64 = ''; // 사진 Base64 저장 변수

document.addEventListener('DOMContentLoaded', () => {
    if (window.isDataLoaded) {
        initTroublePage();
    } else {
        window.addEventListener('DataLoaded', initTroublePage);
    }
});

function initTroublePage() {
    setupTroubleEvents();
    initTroubleSearchableFilters(); // [추가] 사업장·모델·장비 드롭다운 검색 기능
    
    const cachedFilter = localStorage.getItem('lastTroubleFilter');
    const cachedKeyword = localStorage.getItem('lastTroubleKeyword');
    const cachedList = sessionStorage.getItem('lastTroubleList');
    
    try {
        if (cachedFilter) {
            currentTroubleFilter = { ...currentTroubleFilter, ...JSON.parse(cachedFilter) };
        }
        // [수정] 진입 시 URL에 date 파라미터가 없을 때에만 "년도별(현재 연도)"로 초기화 강제 적용
        const currentYearStr = String(new Date().getFullYear());
        const params = new URLSearchParams(window.location.search);
        if (!params.get('date')) {
            currentTroubleFilter.dateType = 'year';
            currentTroubleFilter.year = currentYearStr;
            currentTroubleFilter.month = '';
            currentTroubleFilter.startDate = '';
            currentTroubleFilter.endDate = '';
        }
        // [수정] 화면에 들어올 때(작업 상세 정보에서 넘어온 경우 포함) 작성완료 필터는 항상 꺼진 상태로 시작
        showCompletedOnly = false;
        const btnToggleCompleted = document.getElementById('btn-toggle-completed-trouble');
        if (btnToggleCompleted) btnToggleCompleted.classList.remove('active');
        const searchInput = document.getElementById('trouble-search-input');
        if (searchInput && cachedKeyword) searchInput.value = cachedKeyword;

        // 날짜 필터 타입 셀렉트 박스 동기화
        const typeSelect = document.getElementById('trouble-date-filter-type');
        if (typeSelect && currentTroubleFilter.dateType) {
            typeSelect.value = currentTroubleFilter.dateType;
        }
    } catch (e) {
        console.error('Trouble filter restore error:', e);
    }

    renderTroubleSites();
    checkQueryStringFilters(); // [수정] 마지막 상태 유지 기능보다 URL 파라미터를 최상위 우선순위로 적용
    restoreTroubleFilterUI();
    
    // [수정] 신규 등록된 비정기 항목이 즉시 반영되도록 항상 최신 목록 fetch
    fetchTroubles();
}

function restoreTroubleFilterUI() {
    try {
        const siteSel = document.getElementById('trouble-site-filter');
        if (siteSel) {
            ensureSelectOption(siteSel, currentTroubleFilter.site);
            siteSel.value = currentTroubleFilter.site;
        }
        renderTroubleModels(currentTroubleFilter.site);
        const modelSel = document.getElementById('trouble-model-filter');
        if (modelSel) {
            ensureSelectOption(modelSel, currentTroubleFilter.model);
            modelSel.value = currentTroubleFilter.model;
        }
        renderTroubleEquips(currentTroubleFilter.site, currentTroubleFilter.model);
        const equipSel = document.getElementById('trouble-equip-filter');
        if (equipSel) {
            ensureSelectOption(equipSel, currentTroubleFilter.equip);
            equipSel.value = currentTroubleFilter.equip;
        }
        refreshTroubleSearchableFilters(); // [추가] 검색 드롭다운 표시 갱신
    } catch (e) {
        console.error('restoreTroubleFilterUI error:', e);
    }
}

/* --------------------------------------------------------------------------
   [추가] 검색 가능한 드롭다운 (사업장 · 모델 · 장비 필터)
   - 원래 <select>는 숨겨서 값 보관·change 이벤트용으로 그대로 사용
   - 버튼을 누르면 검색 칸 + 목록이 열리고, 고르면 select 값을 바꾸고 change 이벤트 발생
   -------------------------------------------------------------------------- */
const troubleSearchableSelects = [];

function makeSearchableSelect(sel, placeholder) {
    if (!sel || sel.dataset.searchable) return null;
    sel.dataset.searchable = '1';

    const wrap = document.createElement('div');
    wrap.className = 'ss-wrap';
    wrap.dataset.for = sel.id;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('ss-native');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'input-dark ss-trigger';
    wrap.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = 'ss-panel';
    panel.innerHTML = `<input type="text" class="ss-search" placeholder="${escapeHtml(placeholder)}" autocomplete="off"><ul class="ss-list"></ul>`;
    wrap.appendChild(panel);
    const search = panel.querySelector('.ss-search');
    const list = panel.querySelector('.ss-list');

    const refresh = () => {
        const opt = sel.options[sel.selectedIndex];
        trigger.textContent = opt ? opt.textContent : '';
        trigger.title = trigger.textContent;
    };

    const renderList = () => {
        const kw = search.value.trim().toLowerCase();
        const items = Array.from(sel.options).filter(o => !kw || o.value === 'ALL' || o.textContent.toLowerCase().includes(kw));
        if (!items.length || (kw && items.every(o => o.value === 'ALL'))) {
            list.innerHTML = items.map(o => `<li class="ss-item" data-value="${escapeHtml(o.value)}">${escapeHtml(o.textContent)}</li>`).join('')
                + '<li class="ss-empty">검색 결과가 없습니다.</li>';
        } else {
            list.innerHTML = items.map(o => `<li class="ss-item${o.value === sel.value ? ' selected' : ''}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.textContent)}</li>`).join('');
        }
        const firstMatch = list.querySelector(kw ? '.ss-item:not([data-value="ALL"])' : '.ss-item.selected');
        list.querySelectorAll('.ss-item.active').forEach(li => li.classList.remove('active'));
        if (firstMatch) firstMatch.classList.add('active');
    };

    const close = () => {
        wrap.classList.remove('open');
    };

    const open = () => {
        troubleSearchableSelects.forEach(x => { if (x.wrap !== wrap) x.close(); });
        wrap.classList.add('open');
        search.value = '';
        renderList();
        const selected = list.querySelector('.ss-item.selected');
        if (selected) selected.scrollIntoView({ block: 'nearest' });
        search.focus();
    };

    const choose = (value) => {
        close();
        if (sel.value !== value) {
            sel.value = value;
            sel.dispatchEvent(new Event('change'));
        }
        refresh();
    };

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrap.classList.contains('open')) close(); else open();
    });
    panel.addEventListener('click', (e) => e.stopPropagation());
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', (e) => {
        const items = Array.from(list.querySelectorAll('.ss-item'));
        let idx = items.findIndex(li => li.classList.contains('active'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!items.length) return;
            idx = e.key === 'ArrowDown' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
            items.forEach(li => li.classList.remove('active'));
            items[idx].classList.add('active');
            items[idx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const target = items[idx] || items[0];
            if (target) choose(target.dataset.value);
        } else if (e.key === 'Escape') {
            close();
            trigger.focus();
        }
    });
    list.addEventListener('click', (e) => {
        const li = e.target.closest('.ss-item');
        if (li) choose(li.dataset.value);
    });

    // 목록(옵션)이 다시 그려지거나 값이 바뀌면 버튼 글자 갱신
    new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, characterData: true });
    sel.addEventListener('change', refresh);
    refresh();

    const api = { wrap, sel, refresh, close };
    troubleSearchableSelects.push(api);
    return api;
}

function initTroubleSearchableFilters() {
    makeSearchableSelect(document.getElementById('trouble-site-filter'), '사업장 검색...');
    makeSearchableSelect(document.getElementById('trouble-model-filter'), '모델 검색...');
    makeSearchableSelect(document.getElementById('trouble-equip-filter'), '장비명, 사업장, Serial 검색...');
    document.addEventListener('click', () => troubleSearchableSelects.forEach(x => x.close()));
}

function refreshTroubleSearchableFilters() {
    troubleSearchableSelects.forEach(x => x.refresh());
}

// 저장된 필터값(URL 파라미터 등)이 목록에 없으면 옵션을 추가해 선택 상태를 유지
function ensureSelectOption(sel, value) {
    if (!value || value === 'ALL') return;
    const exists = Array.from(sel.options).some(o => o.value === value);
    if (!exists) {
        const label = value.split('::')[0];
        sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
    }
}

function checkQueryStringFilters() {
    const params = new URLSearchParams(window.location.search);
    const siteParam = params.get('site');
    const equipParam = params.get('equip');
    const dateParam = params.get('date');

    if (equipParam) {
        // [수정] 사업장 및 모델 필터는 'ALL'(전체)로 두고, 장비 필터만 해당 장비로 지정
        currentTroubleFilter.site = 'ALL';
        currentTroubleFilter.model = 'ALL';
        currentTroubleFilter.equip = equipParam;

        // [추가] date 파라미터가 유효하게 넘어오면 날짜 필터를 해당 작업 월(월별)로 자동 전환 선택
        if (dateParam) {
            currentTroubleFilter.dateType = 'month';
            const dateParts = dateParam.split('-');
            if (dateParts.length >= 2) {
                currentTroubleFilter.year = dateParts[0];
                currentTroubleFilter.month = dateParts[1];
            }
            
            const typeSelect = document.getElementById('trouble-date-filter-type');
            if (typeSelect) {
                typeSelect.value = 'month';
            }
            renderDateFilterInputs();
        }

        // 텍스트 검색창은 공백 유지
        const searchInput = document.getElementById('trouble-search-input');
        if (searchInput) {
            searchInput.value = '';
            currentTroubleFilter.keyword = '';
        }

        // 로컬스토리지 필터 동기화
        localStorage.setItem('lastTroubleFilter', JSON.stringify(currentTroubleFilter));
        localStorage.removeItem('lastTroubleKeyword'); // 검색어 캐시 제거

        // UI 새로고침 및 목록 필터 강제 적용
        restoreTroubleFilterUI();
        applyTroubleFilter();
    }
}

function getSiteGroup(siteName) {
    if (!siteName) return '기타사업장';
    const meta = JSON.parse(localStorage.getItem(`site_meta_${siteName}`));
    if (meta && meta.group) return meta.group;
    const firstWord = siteName.split(' ')[0];
    if (firstWord && firstWord.length <= 10) return firstWord;
    return '기타사업장';
}

function fetchTroubles() {
    fetch('/api/trouble/list', { headers: { 'X-CSRFToken': getCookie('csrf_token') } })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                allTroubles = data.data || [];
                sessionStorage.setItem('lastTroubleList', JSON.stringify(allTroubles));
                checkQueryStringFilters();
                applyTroubleFilter();
            }
        })
        .catch(err => {
            console.error('Trouble fetch error:', err);
            renderTroubleList([]);
        });
}

function renderTroubleSites() {
    const siteSel = document.getElementById('trouble-site-filter');
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};

    // 사업장들의 구분을 중복 없이 수집 (표준 그룹 기본 포함)
    const order = ['SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타 해외', '개발', '기타'];
    const groups = new Set(order);
    Object.keys(deviceData).forEach(site => {
        if (site !== 'models' && site !== 'details') {
            groups.add(getSiteGroup(site));
        }
    });

    const sortedGroups = Array.from(groups).sort((a, b) => {
        const idxA = order.indexOf(a);
        const idxB = order.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    let html = `<option value="ALL">전체 사업장</option>`;
    sortedGroups.forEach(g => {
        html += `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`;
    });
    siteSel.innerHTML = html;

    if (!siteSel.dataset.bound) {
        siteSel.dataset.bound = '1';
        siteSel.addEventListener('change', () => {
            currentTroubleFilter.site = siteSel.value; // 구분값이 담김 (예: 'SEC')
            currentTroubleFilter.model = 'ALL';
            currentTroubleFilter.equip = 'ALL';

            renderTroubleModels(currentTroubleFilter.site);
            applyTroubleFilter();
        });
    }

    renderTroubleModels('ALL');
}

function renderTroubleModels(siteGroup) {
    const modelSel = document.getElementById('trouble-model-filter');
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    let equips = [];
    Object.keys(deviceData).forEach(s => {
        if (s !== 'models' && s !== 'details') {
            // 사업장 구분이 siteGroup과 일치하거나 siteGroup이 'ALL' 인 경우의 장비 수집
            if (siteGroup === 'ALL' || getSiteGroup(s) === siteGroup) {
                deviceData[s].forEach(e => equips.push(e));
            }
        }
    });

    const modelSet = new Set();
    equips.forEach(eq => modelSet.add(eq.split('::')[0]));

    let html = `<option value="ALL">전체 모델</option>`;
    Array.from(modelSet).sort().forEach(mName => {
        const matched = equipmentModels.find(m => m.name === mName || m.abbr === mName);
        const displayName = matched && matched.abbr ? matched.abbr : mName;
        html += `<option value="${escapeHtml(mName)}">${escapeHtml(displayName)}</option>`;
    });
    modelSel.innerHTML = html;
    modelSel.value = 'ALL';

    if (!modelSel.dataset.bound) {
        modelSel.dataset.bound = '1';
        modelSel.addEventListener('change', () => {
            currentTroubleFilter.model = modelSel.value;
            currentTroubleFilter.equip = 'ALL';

            renderTroubleEquips(currentTroubleFilter.site, currentTroubleFilter.model);
            applyTroubleFilter();
        });
    }

    renderTroubleEquips(siteGroup, 'ALL');
}

function renderTroubleEquips(siteGroup, model) {
    const equipSel = document.getElementById('trouble-equip-filter');
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    let equips = [];
    Object.keys(deviceData).forEach(s => {
        if (s !== 'models' && s !== 'details') {
            if (siteGroup === 'ALL' || getSiteGroup(s) === siteGroup) {
                deviceData[s].forEach(e => equips.push({ site: s, equip: e }));
            }
        }
    });

    if (model !== 'ALL') {
        equips = equips.filter(item => item.equip.split('::')[0] === model);
    }

    let html = `<option value="ALL">전체 장비</option>`;
    equips.forEach(item => {
        const parts = item.equip.split('::');
        const rawName = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';
        const matched = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
        const displayName = matched && matched.abbr ? matched.abbr : rawName;

        const detailData = JSON.parse(localStorage.getItem(`details_${item.site}_${item.equip}`)) || {};
        const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
        const subText = custEquipName ? ` [${custEquipName}]` : (serial ? ` [${serial}]` : '');

        // 장비별 실질 소속 사업장명을 함께 표기
        html += `<option value="${escapeHtml(item.equip)}">${escapeHtml(item.site)} · ${escapeHtml(displayName)}${escapeHtml(subText)}</option>`;
    });
    equipSel.innerHTML = html;
    equipSel.value = 'ALL';

    if (!equipSel.dataset.bound) {
        equipSel.dataset.bound = '1';
        equipSel.addEventListener('change', () => {
            currentTroubleFilter.equip = equipSel.value;
            applyTroubleFilter();
        });
    }
}

function getNormalizedModelName(modelName) {
    if (!modelName) return '';
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const matched = equipmentModels.find(m => m.name.toLowerCase() === modelName.toLowerCase() || m.abbr.toLowerCase() === modelName.toLowerCase());
    return (matched && matched.abbr) ? matched.abbr.toLowerCase() : modelName.toLowerCase();
}

function applyTroubleFilter() {
    const searchInput = document.getElementById('trouble-search-input');
    currentTroubleFilter.keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

    localStorage.setItem('lastTroubleFilter', JSON.stringify(currentTroubleFilter));
    localStorage.setItem('lastTroubleCompletedOnly', JSON.stringify(showCompletedOnly));
    if (searchInput) {
        localStorage.setItem('lastTroubleKeyword', searchInput.value);
    }

    let filtered = allTroubles;

    // 날짜 필터링 대조 적용
    const dateType = currentTroubleFilter.dateType || '1month';
    if (dateType === '1month') {
        const now = new Date();
        const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        const y = oneMonthAgo.getFullYear();
        const m = String(oneMonthAgo.getMonth() + 1).padStart(2, '0');
        const d = String(oneMonthAgo.getDate()).padStart(2, '0');
        const limitStr = `${y}-${m}-${d}`;

        filtered = filtered.filter(t => {
            const rawDate = t.action_date || t.occur_date || t.date || t.scheduledDate || '';
            const tDate = rawDate.slice(0, 10);
            if (!tDate) return true; // [수정] 날짜 미기록 비정기 작업도 목록에서 누락되지 않도록 포함
            return tDate >= limitStr;
        });
    } else if (dateType === 'year') {
        const targetYear = currentTroubleFilter.year || String(new Date().getFullYear());
        filtered = filtered.filter(t => {
            const rawDate = t.action_date || t.occur_date || t.date || t.scheduledDate || '';
            const tDate = rawDate.slice(0, 10);
            if (!tDate) return true;
            return tDate.startsWith(targetYear);
        });
    } else if (dateType === 'month') {
        const targetYear = currentTroubleFilter.year || String(new Date().getFullYear());
        const targetMonth = currentTroubleFilter.month || String(new Date().getMonth() + 1).padStart(2, '0');
        const prefix = `${targetYear}-${targetMonth}`;
        filtered = filtered.filter(t => {
            const rawDate = t.action_date || t.occur_date || t.date || t.scheduledDate || '';
            const tDate = rawDate.slice(0, 10);
            if (!tDate) return true;
            return tDate.startsWith(prefix);
        });
    } else if (dateType === 'custom') {
        const start = currentTroubleFilter.startDate || '';
        const end = currentTroubleFilter.endDate || '';
        filtered = filtered.filter(t => {
            const rawDate = t.action_date || t.occur_date || t.date || t.scheduledDate || '';
            const tDate = rawDate.slice(0, 10);
            if (!tDate) return true;

            let isStartOk = true;
            if (start) isStartOk = tDate >= start;

            let isEndOk = true;
            if (end) isEndOk = tDate <= end;

            return isStartOk && isEndOk;
        });
    }

    if (currentTroubleFilter.site !== 'ALL') {
        filtered = filtered.filter(t => getSiteGroup(t.site) === currentTroubleFilter.site);
    }

    if (currentTroubleFilter.model !== 'ALL') {
        filtered = filtered.filter(t => {
            const normalizedFModel = getNormalizedModelName(currentTroubleFilter.model);
            const searchTarget = `${t.equip_id || ''} ${t.equip || ''}`.toLowerCase();

            let isModelMatch = searchTarget.includes(normalizedFModel);
            if (!isModelMatch) {
                const matchModel = (t.equip_id || '').split('::')[1] || (t.equip || '').split(' ')[0] || '';
                isModelMatch = getNormalizedModelName(matchModel) === normalizedFModel;
            }
            return isModelMatch;
        });
    }

    if (currentTroubleFilter.equip !== 'ALL') {
        filtered = filtered.filter(t => {
            const fParts = currentTroubleFilter.equip.split('::');
            const fModel = fParts[0];
            const fSerial = fParts.length > 1 ? fParts[1] : '';

            const normalizedFModel = getNormalizedModelName(fModel);
            const searchTarget = `${t.equip_id || ''} ${t.equip || ''}`.toLowerCase();

            // 모델명 매칭 검사
            let isModelMatch = searchTarget.includes(normalizedFModel);
            if (!isModelMatch) {
                const matchModel = (t.equip_id || '').split('::')[1] || (t.equip || '').split(' ')[0] || '';
                isModelMatch = getNormalizedModelName(matchModel) === normalizedFModel;
            }

            // 시리얼 번호 매칭 검사
            let isSerialMatch = true;
            if (fSerial) {
                isSerialMatch = searchTarget.includes(fSerial.trim().toLowerCase());
            }

            return isModelMatch && isSerialMatch;
        });
    }

    if (currentTroubleFilter.keyword) {
        filtered = filtered.filter(t =>
            (t.equip && t.equip.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.equip_id && t.equip_id.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.situation && t.situation.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.symptom && t.symptom.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.cause && t.cause.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.measure && t.measure.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.prevent && t.prevent.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.trouble_details && t.trouble_details.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.content && t.content.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.worker && t.worker.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.type && t.type.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.detail_type && t.detail_type.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.check_item && t.check_item.toLowerCase().includes(currentTroubleFilter.keyword))
        );
    }

    // [수정] 작성완료 필터 적용: 발생 일시가 기록된 항목(기록여부 녹색)만 표시
    if (showCompletedOnly) {
        filtered = filtered.filter(t => t.occur_date && String(t.occur_date).trim() !== '' && t.occur_date !== '-');
    }

    renderTroubleList(filtered);
}

function setupTroubleEvents() {
    // 모달 닫기 버튼 클릭
    const btnCloseModal = document.getElementById('btn-close-trouble-modal');

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', closeTroubleModal);
    }

    // 사진 첨부 로직 (용량 및 확장자 검사)
    const imageInput = document.getElementById('trouble-modal-image');
    // [수정] 사진 첨부: 첨부 자료 페이지에 이미지 추가 (PNG/JPG, 1장 500KB, 최대 10장)
    if (imageInput) {
        imageInput.addEventListener('change', function () {
            const files = Array.from(this.files || []);
            if (files.length) addSheetImageFiles(files, getAttachImageList());
            this.value = '';
        });
    }

    setupTroubleSheetEvents();

    // 모달 내부 저장 버튼 클릭
    const btnSave = document.getElementById('btn-save-trouble');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            const modal = document.getElementById('trouble-detail-modal');
            // [추가] 이미지를 다 불러온 뒤에만 저장 (덜 불러온 채 저장하면 이미지가 지워짐)
            if (modal.dataset.imagesLoaded === 'loading') {
                alert('이미지를 불러오는 중입니다. 잠시 후 다시 저장해 주세요.');
                return;
            }
            if (modal.dataset.imagesLoaded === 'error') {
                alert('이미지를 불러오지 못해 저장할 수 없습니다.\n창을 닫고 다시 열어 주세요. (저장하면 기존 이미지가 지워질 수 있습니다.)');
                return;
            }
            // [추가] 저장한 사람이 이력으로 남는다는 확인 팝업
            const saverName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '로그인 사용자';
            if (!confirm(`저장하면 저장한 사람(${saverName})과 저장 시각이 최종 수정 이력으로 남습니다.\n저장하시겠습니까?`)) return;

            const mode = modal.dataset.mode || 'add';
            const troubleId = modal.dataset.troubleId || Date.now();
            const equipId = modal.dataset.equipId || '';
            const source = modal.dataset.source || 'trouble';

            // [추가] 5개 항목(JSON) 및 진행경과(memo) 분리 수집
            const situationEl = document.getElementById('trouble-modal-situation');
            const symptomEl = document.getElementById('trouble-modal-symptom');
            const causeEl = document.getElementById('trouble-modal-cause');
            const actionEl = document.getElementById('trouble-modal-action-taken'); // [수정] 올바른 HTML ID 매핑
            const preventionEl = document.getElementById('trouble-modal-preventive'); // [수정] 올바른 HTML ID 매핑
            const memoEl = document.getElementById('trouble-modal-content'); // [수정] 우측 세부내용(메모) 영역

            const memoVal = memoEl ? memoEl.value : '';
            const siteVal = document.getElementById('trouble-modal-site') ? document.getElementById('trouble-modal-site').value : '';
            const equipVal = document.getElementById('trouble-modal-equip') ? document.getElementById('trouble-modal-equip').value : '';

            const typeEl = document.getElementById('trouble-modal-type');
            const dt1El = document.getElementById('trouble-modal-detail-type');
            const dt2El = document.getElementById('trouble-modal-detail-type2');
            const dt3El = document.getElementById('trouble-modal-detail-type3');

            const occurDateVal = document.getElementById('trouble-modal-occur-date') ? document.getElementById('trouble-modal-occur-date').value : '';
            // [수정] 완료 여부: 발생 일시가 있으면 선택한 값(조치중 / 조치완료), 없으면 미기록
            const statusSel = document.getElementById('trouble-modal-status');
            const statusVal = (occurDateVal && occurDateVal.trim() !== '' && occurDateVal !== '-')
                ? (statusSel && statusSel.value ? statusSel.value : '조치중') : '미기록';

            // [독립 저장 및 오염 방지] 5개 항목은 오직 trouble_log의 전용 컬럼으로만 저장
            const payload = {
                id: troubleId,
                equip_id: equipId,
                site: siteVal,
                equip: equipVal,
                type: typeEl && typeEl.value ? typeEl.value : '비정기',
                situation: situationEl ? situationEl.value : '',
                symptom: symptomEl ? symptomEl.value : '',
                cause: causeEl ? causeEl.value : '',
                measure: actionEl ? actionEl.value : '',
                occur_date: occurDateVal,
                action_date: document.getElementById('trouble-modal-action-date') ? document.getElementById('trouble-modal-action-date').value : '',
                trouble_details: memoVal, // 세부사항 창(trouble-modal-content)의 텍스트만 전달
                memo: memoVal, // maint_log.memo에도 순수 세부사항만 전달 (situation 전이 완전 차단)
                worker: document.getElementById('trouble-modal-worker') ? document.getElementById('trouble-modal-worker').value : '',
                status: statusVal,
                image_data: currentTroubleImageBase64,
                sheet_data: collectTroubleSheet(), // [추가] 공유 시트 항목
                source: source
            };

            // detail_type 1,2,3는 모달 요소에 유효한 값이 존재할 때만 전송 (기존값 삭제 방지)
            // [수정] 재발방지 대책 칸이 화면에 없으면 보내지 않음 (기존 저장값 유지)
            if (preventionEl) payload.prevent = preventionEl.value;
            if (dt1El && dt1El.value) payload.detail_type = dt1El.value;
            if (dt2El && dt2El.value) payload.detail_type2 = dt2El.value;
            if (dt3El && dt3El.value) payload.detail_type3 = dt3El.value;

            const action = mode === 'add' ? 'CREATE' : 'UPDATE';

            fetch('/api/trouble/crud', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                body: JSON.stringify({ action: action, payload: payload })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success') {
                        alert('저장되었습니다.');
                        closeTroubleModal();
                        fetchTroubles();
                    } else {
                        alert('저장 실패: ' + data.message);
                    }
                })
                .catch(err => {
                    console.error(err);
                    alert('통신 중 오류가 발생했습니다.');
                });
        });
    }

    // 테이블 검색(상단 입력창) 필터 연동
    const btnSearch = document.getElementById('btn-trouble-search');
    const inputSearch = document.getElementById('trouble-search-input');
    if (btnSearch) btnSearch.addEventListener('click', applyTroubleFilter);
    if (inputSearch) inputSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') applyTroubleFilter();
    });

    // [추가] 발생 일시를 입력하면 완료 여부를 자동으로 '조치중'으로 변경
    const occurInput = document.getElementById('trouble-modal-occur-date');
    if (occurInput) {
        let prevOccur = '';
        occurInput.addEventListener('focus', () => { prevOccur = occurInput.value; });
        occurInput.addEventListener('change', () => {
            const statusSel = document.getElementById('trouble-modal-status');
            if (statusSel && occurInput.value && !prevOccur) statusSel.value = '조치중';
            prevOccur = occurInput.value;
        });
    }

    // [추가] 작성완료 필터 버튼 이벤트
    const btnToggleCompleted = document.getElementById('btn-toggle-completed-trouble');
    if (btnToggleCompleted) {
        btnToggleCompleted.addEventListener('click', () => {
            btnToggleCompleted.classList.toggle('active');
            showCompletedOnly = btnToggleCompleted.classList.contains('active');
            applyTroubleFilter();
        });
    };

    setupTroubleDateFilterEvents();
    window.addEventListener('resize', adjustAllTextareaHeights);
}

function setupTroubleDateFilterEvents() {
    const typeSelect = document.getElementById('trouble-date-filter-type');
    if (!typeSelect) return;

    typeSelect.addEventListener('change', () => {
        currentTroubleFilter.dateType = typeSelect.value;
        renderDateFilterInputs();
        applyTroubleFilter();
    });

    // 초기 인풋 렌더링
    renderDateFilterInputs();
}

function renderDateFilterInputs() {
    const container = document.getElementById('trouble-date-filter-inputs');
    if (!container) return;

    container.innerHTML = '';
    const type = currentTroubleFilter.dateType || '1month';

    const now = new Date();
    const currentYear = now.getFullYear();

    if (type === 'year') {
        let options = '';
        for (let y = currentYear; y >= currentYear - 5; y--) {
            const selected = (currentTroubleFilter.year === String(y) || (!currentTroubleFilter.year && y === currentYear)) ? 'selected' : '';
            options += `<option value="${y}" ${selected}>${y}년</option>`;
        }
        container.innerHTML = `<select id="trouble-date-year-select" style="width: 80px; height: 32px; background-color: var(--c-bg); color: var(--c-heading); border: 1px solid var(--c-border); border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; cursor: pointer; font-size: 13px;">${options}</select>`;
        
        const yearSelect = document.getElementById('trouble-date-year-select');
        if (yearSelect) {
            currentTroubleFilter.year = yearSelect.value;
            yearSelect.addEventListener('change', () => {
                currentTroubleFilter.year = yearSelect.value;
                applyTroubleFilter();
            });
        }

    } else if (type === 'month') {
        let yearOptions = '';
        for (let y = currentYear; y >= currentYear - 5; y--) {
            const selected = (currentTroubleFilter.year === String(y) || (!currentTroubleFilter.year && y === currentYear)) ? 'selected' : '';
            yearOptions += `<option value="${y}" ${selected}>${y}년</option>`;
        }
        
        let monthOptions = '';
        const curMonth = now.getMonth() + 1;
        for (let m = 1; m <= 12; m++) {
            const mStr = String(m).padStart(2, '0');
            const selected = (currentTroubleFilter.month === mStr || (!currentTroubleFilter.month && m === curMonth)) ? 'selected' : '';
            monthOptions += `<option value="${mStr}" ${selected}>${m}월</option>`;
        }

        container.innerHTML = `
            <select id="trouble-date-year-select" style="width: 80px; height: 32px; background-color: var(--c-bg); color: var(--c-heading); border: 1px solid var(--c-border); border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; cursor: pointer; font-size: 13px;">${yearOptions}</select>
            <select id="trouble-date-month-select" style="width: 65px; height: 32px; background-color: var(--c-bg); color: var(--c-heading); border: 1px solid var(--c-border); border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; cursor: pointer; font-size: 13px;">${monthOptions}</select>
        `;

        const yearSelect = document.getElementById('trouble-date-year-select');
        const monthSelect = document.getElementById('trouble-date-month-select');

        if (yearSelect && monthSelect) {
            currentTroubleFilter.year = yearSelect.value;
            currentTroubleFilter.month = monthSelect.value;

            yearSelect.addEventListener('change', () => {
                currentTroubleFilter.year = yearSelect.value;
                applyTroubleFilter();
            });
            monthSelect.addEventListener('change', () => {
                currentTroubleFilter.month = monthSelect.value;
                applyTroubleFilter();
            });
        }

    } else if (type === 'custom') {
        const startVal = currentTroubleFilter.startDate || '';
        const endVal = currentTroubleFilter.endDate || '';

        container.innerHTML = `
            <input type="date" id="trouble-date-start" style="width: 120px; height: 32px; background-color: var(--c-bg); color: var(--c-heading); border: 1px solid var(--c-border); border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; font-size: 13px;" value="${startVal}">
            <span style="color:var(--c-text-muted);">~</span>
            <input type="date" id="trouble-date-end" style="width: 120px; height: 32px; background-color: var(--c-bg); color: var(--c-heading); border: 1px solid var(--c-border); border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; font-size: 13px;" value="${endVal}">
        `;

        const startInput = document.getElementById('trouble-date-start');
        const endInput = document.getElementById('trouble-date-end');

        if (startInput && endInput) {
            startInput.addEventListener('change', () => {
                currentTroubleFilter.startDate = startInput.value;
                applyTroubleFilter();
            });
            endInput.addEventListener('change', () => {
                currentTroubleFilter.endDate = endInput.value;
                applyTroubleFilter();
            });
        }
    }
}

function openTroubleModal(mode, id = null, source = null) {
    const modal = document.getElementById('trouble-detail-modal');
    const title = document.getElementById('trouble-modal-title');
    if (title) title.textContent = mode === 'add' ? 'Trouble 등록' : 'Trouble 상세 정보';

    modal.dataset.mode = mode;
    modal.dataset.troubleId = id || '';
    modal.dataset.source = source || '';
    modal.dataset.equipId = '';

    // 사진 첨부 초기화
    currentTroubleImageBase64 = '';
    const imageInput = document.getElementById('trouble-modal-image');
    const removeBtn = document.getElementById('btn-remove-trouble-image');
    const previewContainer = document.getElementById('trouble-image-preview-container');
    const previewImg = document.getElementById('trouble-image-preview');
    if (imageInput) imageInput.value = '';
    if (previewImg) previewImg.src = '';
    if (previewContainer) previewContainer.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'none';

    const siteSelect = document.getElementById('trouble-modal-site');
    const equipInput = document.getElementById('trouble-modal-equip');
    const occurDateInput = document.getElementById('trouble-modal-occur-date');
    const actionDateInput = document.getElementById('trouble-modal-action-date');
    const statusInput = document.getElementById('trouble-modal-status');
    const workerInput = document.getElementById('trouble-modal-worker');
    const memoInput = document.getElementById('trouble-modal-content'); // [수정] 세부내용

    // [추가] 세부 항목 입력창
    const situationEl = document.getElementById('trouble-modal-situation');
    const symptomEl = document.getElementById('trouble-modal-symptom');
    const causeEl = document.getElementById('trouble-modal-cause');
    const actionEl = document.getElementById('trouble-modal-action-taken');
    const preventionEl = document.getElementById('trouble-modal-preventive');

    // 폼 내용 초기화
    if (siteSelect) siteSelect.value = '';
    if (equipInput) equipInput.value = '';
    if (occurDateInput) occurDateInput.value = '';
    if (actionDateInput) actionDateInput.value = '';
    if (statusInput) statusInput.value = '조치중'; // [수정] 신규 등록 시 기본값을 '조치중'으로 변경
    if (workerInput) workerInput.value = '';
    if (memoInput) memoInput.value = '';
    if (situationEl) situationEl.value = '';
    if (symptomEl) symptomEl.value = '';
    if (causeEl) causeEl.value = '';
    if (actionEl) actionEl.value = '';
    if (preventionEl) preventionEl.value = '';
    fillTroubleSheet(null); // [추가] 시트 항목 초기화

    if (mode === 'edit' && id) {
        const troubleData = allTroubles.find(t => String(t.id) === String(id) && t.source === source);
        if (troubleData) {
            modal.dataset.equipId = troubleData.equip_id || '';
            // 장비 리스트에서 가져온 데이터로 입력창 자동 세팅
            if (siteSelect) siteSelect.value = troubleData.site || '';
            if (equipInput) equipInput.value = troubleData.equip || '';

            if (occurDateInput && troubleData.occur_date) {
                let dStr = troubleData.occur_date;
                // 날짜(YYYY-MM-DD)만 있는 경우 시간 포맷을 맞춰줌
                if (dStr.length === 10) dStr += 'T00:00';
                occurDateInput.value = dStr.substring(0, 16);
            }
            if (actionDateInput && troubleData.action_date) {
                actionDateInput.value = troubleData.action_date.substring(0, 10);
            }

            // 이전에 기록된 '기록완료'는 조치완료로 표시
            if (statusInput) statusInput.value = (troubleData.status === '조치완료' || troubleData.status === '기록완료') ? '조치완료' : '조치중';
            if (workerInput) workerInput.value = troubleData.worker || '';

            // [수정] source 제약 없이 모든 트러블 이력 소스에 대해 진행 경과(JSON) 바인딩 수행
            bindTroubleContentAndImage(troubleData);
            fillTroubleSheet(troubleData); // [추가] 공유 시트 항목 (저장값 또는 ADMIN 장비 정보 자동 입력)
            loadTroubleImages(troubleData.id, troubleData.source); // [추가] 이 건의 이미지만 불러오기

            // [추가] 최종 수정일 · 수정자
            setTroubleUpdatedInfo(troubleData.updated_at, troubleData.updated_by);



        }
    } else {
        // 등록(Add) 모드일 때 기본 담당자 이름 채우기
        if (workerInput) workerInput.value = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
    }
    if (mode !== 'edit') {
        setTroubleUpdatedInfo('', '');
        troubleImageRequestSeq++; // 진행 중인 이미지 불러오기 무시
        setTroubleImagesState('1');
    }

    if (modal) {
        modal.style.display = 'flex';
        // 모달창 렌더링 속도 지연(모바일 등)에 대처하기 위해 3회에 걸쳐 시간차 순차 호출
        setTimeout(adjustAllTextareaHeights, 50);
        setTimeout(adjustAllTextareaHeights, 150);
        setTimeout(adjustAllTextareaHeights, 300);
    }
}

function bindTroubleContentAndImage(data, excludeMemo = false) {
    const situationEl = document.getElementById('trouble-modal-situation');
    const symptomEl = document.getElementById('trouble-modal-symptom');
    const causeEl = document.getElementById('trouble-modal-cause');
    const actionEl = document.getElementById('trouble-modal-action-taken');
    const preventionEl = document.getElementById('trouble-modal-preventive');
    const memoInput = document.getElementById('trouble-modal-content');
    const previewContainer = document.getElementById('trouble-image-preview-container');
    const previewImg = document.getElementById('trouble-image-preview');
    const removeBtn = document.getElementById('btn-remove-trouble-image');

    let parsed = null;
    if (data.content) {
        parsed = data.content;
        if (typeof parsed === 'string' && parsed.startsWith('{')) {
            try { parsed = JSON.parse(parsed); } catch (e) { }
        }
    }

    // [엄격] 트러블 상황에는 오직 trouble_log.situation 컬럼 데이터만 들어감 (maint_log.memo 유입 원천 차단)
    if (situationEl) situationEl.value = data.situation || '';
    if (symptomEl) symptomEl.value = data.symptom || '';
    if (causeEl) causeEl.value = data.cause || '';
    if (actionEl) actionEl.value = data.measure || '';
    // [추가] Trouble 증상·원인·조치사항이 모두 비어 있으면 작업 이력(작업 상세 정보)에 기록한 증상/원인/조치사항으로 자동 입력
    if (!data.symptom && !data.cause && !data.measure && (data.log_symptom || data.log_cause || data.log_action)) {
        if (symptomEl) symptomEl.value = data.log_symptom || '';
        if (causeEl) causeEl.value = data.log_cause || '';
        if (actionEl) actionEl.value = data.log_action || '';
    }
    if (preventionEl) preventionEl.value = data.prevent || '';

    // [전용] trouble_details 멀티라인 포맷 텍스트를 세부사항(memoInput) 입력창에 가독성 높게 바인딩
    if (!excludeMemo && memoInput) {
        let memoVal = data.trouble_details || data.memo || '';
        if (typeof memoVal === 'string' && memoVal.trim().startsWith('{')) {
            try {
                const parsedMemo = JSON.parse(memoVal);
                memoVal = parsedMemo.trouble_memo || parsedMemo.situation || memoVal;
            } catch (e) { }
        }
        memoInput.value = memoVal || '';
    }

    if (data.image_data) {
        currentTroubleImageBase64 = data.image_data;
        // [추가] 작업내용 불러오기로 가져온 사진은 첨부 자료에 추가
        if (excludeMemo) {
            const list = getAttachImageList();
            if (list && /^data:image\/(png|jpeg|jpg);base64,/.test(data.image_data)) addSheetImage(list, data.image_data);
        }
        if (previewImg) previewImg.src = currentTroubleImageBase64;
        if (previewContainer) previewContainer.style.display = 'block';
        if (removeBtn) removeBtn.style.display = 'inline-block';
    }

    // 불러오기 된 텍스트 데이터의 길이에 맞추어 텍스트 창 높이 자동 갱신 (지연 호출 3회)
    setTimeout(adjustAllTextareaHeights, 50);
    setTimeout(adjustAllTextareaHeights, 150);
    setTimeout(adjustAllTextareaHeights, 300);
}

function closeTroubleModal() {
    const modal = document.getElementById('trouble-detail-modal');
    if (modal) modal.style.display = 'none';
}

function renderTroubleList(dataList = []) {
    const tbody = document.getElementById('trouble-tbody');
    if (tbody) {
        if (dataList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="list-empty-msg" style="padding:30px;">조건에 맞는 Trouble 이력이 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = dataList.map(t => {
            let dt1 = t.detail_type || '-';
            let dt2 = t.detail_type2 || '-';
            let dt3 = t.detail_type3 || '-';

            if (dt1 && dt1.includes(' > ')) {
                const parts = dt1.split(' > ');
                dt1 = parts[0] ? parts[0].trim() : '-';
                if (parts[1]) dt2 = parts[1].trim();
                if (parts[2]) dt3 = parts[2].trim();
            } else if (dt2 && dt2.includes(' > ')) {
                const parts = dt2.split(' > ');
                if (dt1 === '-' || !dt1) dt1 = parts[0] ? parts[0].trim() : '-';
                dt2 = parts[1] ? parts[1].trim() : dt2;
                if (parts[2]) dt3 = parts[2].trim();
            }

            let rawCheckItem = t.check_item || '-';
            let displayCheckItem = rawCheckItem;

            if (rawCheckItem !== '-') {
                let items = rawCheckItem.split(',').map(s => s.trim()).filter(Boolean);
                let cleanedItems = [];

                items.forEach(item => {
                    let pure = item.replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').trim();
                    const kwMatch = pure.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                    if (kwMatch) {
                        if (dt3 === '-' || !dt3) {
                            dt3 = kwMatch[1].trim();
                        }
                        pure = kwMatch[2].trim();
                    } else {
                        const defaultKeywords = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상", "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"];
                        if (defaultKeywords.includes(pure)) {
                            if (dt3 === '-' || !dt3) {
                                dt3 = pure;
                            }
                            pure = '';
                        }
                    }
                    if (pure) cleanedItems.push(pure);
                });

                if (cleanedItems.length > 1) {
                    displayCheckItem = `${cleanedItems[0]} 외 ${cleanedItems.length - 1}개`;
                } else if (cleanedItems.length === 1) {
                    displayCheckItem = cleanedItems[0];
                } else {
                    displayCheckItem = '-';
                }
            }

            let equipMain = escapeHtml(t.equip || '-');
            let equipSubHtml = '';
            if (t.equip && t.equip !== '-') {
                const matchCust = t.equip.match(/^(.*?) \[(.*?)\]$/);
                const matchSerial = t.equip.match(/^(.*?) \((.*?)\)$/);
                let modelPart = t.equip;
                let subVal = '';
                let isCust = false;

                if (matchCust) {
                    modelPart = matchCust[1];
                    subVal = matchCust[2];
                    isCust = true;
                } else if (matchSerial) {
                    modelPart = matchSerial[1];
                    subVal = matchSerial[2];
                }

                // 모델명 약어 치환용 로컬스토리지 매핑 검색
                const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                const matchedModel = equipmentModels.find(m => m.name.toLowerCase() === modelPart.toLowerCase() || m.abbr.toLowerCase() === modelPart.toLowerCase());
                const modelAbbr = matchedModel ? matchedModel.abbr : modelPart;

                equipMain = escapeHtml(modelAbbr);
                if (subVal) {
                    if (isCust) {
                        equipSubHtml = `<div style="color: var(--c-blue); font-size: 11px; margin-top: 2px;">[${escapeHtml(subVal)}]</div>`;
                    } else {
                        equipSubHtml = `<div style="color: var(--c-text-muted); font-size: 11px; margin-top: 2px;">(${escapeHtml(subVal)})</div>`;
                    }
                }
            }

            // [수정] trouble 내용 (상황) 컬럼에 트러블 상황(situation) 우선 표시
            let sitText = (t.situation || '').trim();
            let tooltipContent = '';

            if (typeof t.content === 'string' && t.content.startsWith('{')) {
                try {
                    const parsed = JSON.parse(t.content);
                    if (!sitText && parsed.situation) sitText = parsed.situation.trim();
                    const arr = [];
                    if (sitText) arr.push(`[상황] ${sitText}`);
                    if (parsed.symptom) arr.push(`[증상] ${parsed.symptom}`);
                    if (parsed.cause) arr.push(`[원인] ${parsed.cause}`);
                    if (parsed.action) arr.push(`[조치] ${parsed.action}`);
                    if (parsed.prevention) arr.push(`[대책] ${parsed.prevention}`);
                    if (parsed.trouble_memo) arr.push(`[메모] ${parsed.trouble_memo}`);
                    tooltipContent = arr.join('\n');
                } catch (e) { }
            }

            if (!tooltipContent) {
                const arr = [];
                if (sitText) arr.push(`[상황] ${sitText}`);
                if (t.symptom) arr.push(`[증상] ${t.symptom}`);
                if (t.cause) arr.push(`[원인] ${t.cause}`);
                if (t.measure) arr.push(`[조치] ${t.measure}`);
                if (t.prevent) arr.push(`[대책] ${t.prevent}`);
                if (t.trouble_details) arr.push(`[메모] ${t.trouble_details}`);
                tooltipContent = arr.join('\n');
            }

            let displayContent = sitText || (t.trouble_details && t.trouble_details !== '-' ? t.trouble_details : '') || (t.memo && t.memo !== '-' ? t.memo : '-');
            if (!displayContent || displayContent === '-') displayContent = '-';

            // [수정] 기록여부: 미기록(빈 원) / 조치중(주황불) / 조치완료(녹색불, 이전 '기록완료' 포함)
            const hasOccur = !!(t.occur_date && String(t.occur_date).trim() !== '' && t.occur_date !== '-');
            let recordIcon = '<span style="color: var(--c-text-muted); font-size: 16px;" title="미기록">○</span>';
            if (hasOccur || t.status === '조치중' || t.status === '조치완료' || t.status === '기록완료') {
                recordIcon = (t.status === '조치완료' || t.status === '기록완료')
                    ? '<span style="color: var(--c-green); font-size: 16px;" title="조치완료">●</span>'
                    : '<span style="color: var(--c-orange, #f0883e); font-size: 16px;" title="조치중">●</span>';
            }

            return `<tr data-id="${t.id}" data-source="${t.source || 'trouble'}" style="cursor: pointer;">
                <td style="text-align: center;">${recordIcon}</td>
                <td style="text-align: center;">${t.action_date || t.occur_date || '-'}</td>
                <td style="text-align: center;">${escapeHtml(t.site || '-')}</td>
                <td style="text-align: left; padding-left: 10px;">
                    <div style="font-weight: bold;">${equipMain}</div>
                    ${equipSubHtml}
                </td>
                <td style="text-align: center;">${escapeHtml(t.type || '-')}</td>
                <td style="text-align: center;">${escapeHtml(dt1)}</td>
                <td style="text-align: center;">${escapeHtml(dt2)}</td>
                <td style="text-align: center;">${escapeHtml(dt3)}</td>
                <td style="text-align: left; padding-left: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(t.check_item || '')}">${escapeHtml(displayCheckItem)}</td>
                <td style="text-align: left; padding-left: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(tooltipContent)}">${escapeHtml(displayContent)}</td>
                <td style="text-align: center;">${escapeHtml(t.worker || '-')}</td>
            </tr>`;
        }).join('');

        // 리스트 행 클릭 시 상세 모달 열기 이벤트 바인딩
        tbody.querySelectorAll('tr').forEach(tr => {
            tr.addEventListener('click', () => {
                const troubleId = tr.dataset.id;
                const source = tr.dataset.source;
                openTroubleModal('edit', troubleId, source);
            });
        });
    }
}

/**
 * 모바일 환경에서 textarea의 높이를 입력된 텍스트 길이에 맞춰 자동으로 조절합니다.
 * @param {HTMLTextAreaElement} el 
 */
function adjustTextareaHeight(el) {
    if (!el) return;

    // 개별 입력창의 스크롤바 및 크기 조절 손잡이를 완전히 제거
    el.style.overflowY = 'hidden';
    el.style.resize = 'none';
    el.style.height = 'auto';

    // [수정] 시트 칸: 기본 줄 수(rows)만큼의 높이를 최소로 두고 내용에 맞춰 늘어남
    const rows = parseInt(el.getAttribute('rows') || '1', 10);
    let minHeight = Math.max(26, rows * 20 + 8);

    // 텍스트 내용의 높이(scrollHeight)와 최소 높이 중 더 큰 값으로 설정
    const targetHeight = Math.max(el.scrollHeight, minHeight);
    el.style.height = targetHeight + 'px';
}

/**
 * 모달 내부의 모든 진행 경과 및 세부사항 입력 창의 높이를 조절합니다.
 */
function adjustAllTextareaHeights() {
    document.querySelectorAll('#trouble-sheet textarea').forEach(el => adjustTextareaHeight(el));
}

/* ==========================================================================
   [추가] 운영설비 이슈 내부 공유 시트 (기본정보 자동 입력 · 수기 입력 · 협의 이력)
   ========================================================================== */
const SHEET_FIELD_KEYS = ['customer', 'site', 'line', 'inspector', 'equip_name', 'model', 'delivery',
    'detector_serial', 'equip_serial', 'dept', 'dept_manager', 'inspection', 'result'];

function parseSheetData(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
}

// ADMIN 장비 정보에서 가져올 수 있는 기본값 (저장된 값이 없을 때만 사용)
function getSheetAutoValues(t) {
    const eq = (t && t.equip_info) || {};
    const lineParts = [eq.floor, eq.detail_loc].map(v => String(v || '').trim()).filter(Boolean);
    let model = eq.name || '';
    if (model) {
        const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
        const matched = equipmentModels.find(m => m.name === model || m.abbr === model);
        if (matched && matched.name) model = matched.name;
    }
    return {
        customer: eq.site_name || (t && t.site) || '',
        site: eq.building || '',
        line: lineParts.join(' '),
        inspector: (t && t.worker && t.worker !== '-') ? t.worker : '',
        equip_name: eq.cust_equip_name || '',
        model: model,
        delivery: eq.delivery_date || '',
        detector_serial: '',
        equip_serial: eq.serial || '',
        dept: '',
        dept_manager: '',
        inspection: '',
        result: ''
    };
}

function fillTroubleSheet(t) {
    const saved = parseSheetData(t && t.sheet_data);
    const auto = t ? getSheetAutoValues(t) : {};
    document.querySelectorAll('#trouble-sheet [data-sheet]').forEach(el => {
        const key = el.dataset.sheet;
        // 한 번 저장된 항목은 저장값 유지 (지운 값도 그대로), 저장 전이면 장비 정보에서 자동 입력
        el.value = Object.prototype.hasOwnProperty.call(saved, key) ? (saved[key] || '') : (auto[key] || '');
    });
    renderConsultRows(Array.isArray(saved.consults) ? saved.consults : []);
    renderSheetImages({}); // 이미지는 loadTroubleImages()에서 1건만 따로 불러옴
    const modal = document.getElementById('trouble-detail-modal');
    if (modal) modal.dataset.attachMigrated = saved.attach_migrated ? '1' : '';
}

/* --------------------------------------------------------------------------
   [추가] 상세 정보 이미지 지연 불러오기
   - 목록에는 이미지를 받지 않고, 상세 정보를 열 때 그 1건의 이미지만 서버에서 받음
   - 이미지를 다 받기 전에는 저장을 막음 (이미지가 빈 채로 저장되어 지워지는 것 방지)
   -------------------------------------------------------------------------- */
let troubleImageRequestSeq = 0;

// [추가] 상세 정보 창 오른쪽 위 최종 수정일 · 수정자 표시
function setTroubleUpdatedInfo(at, by) {
    const el = document.getElementById('trouble-modal-updated');
    if (!el) return;
    if (at) {
        el.textContent = `최종 수정 : ${at}${by ? ` (${by})` : ''}`;
        el.title = '마지막으로 저장한 시각과 사람';
    } else {
        el.textContent = '최종 수정 : -';
        el.title = '아직 Trouble 상세 정보에서 저장한 이력이 없습니다.';
    }
}

function fetchTroubleImages(id, source) {
    const url = `/api/trouble/images?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source || 'trouble')}`;
    return fetch(url, { headers: { 'X-CSRFToken': getCookie('csrf_token') } })
        .then(res => res.json())
        .then(json => {
            if (json.status !== 'success') throw new Error(json.message || 'image load fail');
            return json.data || {};
        });
}

function setTroubleImagesState(state) {
    const modal = document.getElementById('trouble-detail-modal');
    const btnSave = document.getElementById('btn-save-trouble');
    if (modal) modal.dataset.imagesLoaded = state;
    if (btnSave) {
        btnSave.disabled = state === 'loading';
        btnSave.textContent = state === 'loading' ? '이미지 불러오는 중...' : '저장';
    }
}

function loadTroubleImages(id, source) {
    const seq = ++troubleImageRequestSeq;
    setTroubleImagesState('loading');
    fetchTroubleImages(id, source)
        .then(data => {
            if (seq !== troubleImageRequestSeq) return; // 그 사이 다른 이력을 열었으면 무시
            const modal = document.getElementById('trouble-detail-modal');
            currentTroubleImageBase64 = data.image_data || '';
            renderSheetImages(data.sheet_images && typeof data.sheet_images === 'object' ? data.sheet_images : {});
            // 예전 사진 첨부(image_data)는 시트를 한 번 저장하기 전까지 첨부 자료에 표시
            if (currentTroubleImageBase64 && !(modal && modal.dataset.attachMigrated === '1')) {
                const list = getAttachImageList();
                if (list && /^data:image\/(png|jpeg|jpg);base64,/.test(currentTroubleImageBase64)) addSheetImage(list, currentTroubleImageBase64);
            }
            setTroubleImagesState('1');
        })
        .catch(err => {
            if (seq !== troubleImageRequestSeq) return;
            console.error('Trouble image load error:', err);
            setTroubleImagesState('error');
        });
}

function collectTroubleSheet() {
    const out = {};
    document.querySelectorAll('#trouble-sheet [data-sheet]').forEach(el => {
        out[el.dataset.sheet] = el.value.trim();
    });
    out.consults = [];
    document.querySelectorAll('#trouble-consult-tbody tr').forEach(tr => {
        const row = {
            date: (tr.querySelector('[data-consult="date"]') || {}).value || '',
            target: ((tr.querySelector('[data-consult="target"]') || {}).value || '').trim(),
            content: ((tr.querySelector('[data-consult="content"]') || {}).value || '').trim()
        };
        if (row.date || row.target || row.content) out.consults.push(row);
    });
    out.images = collectSheetImages();
    out.attach_migrated = true; // 예전 사진 첨부(image_data)를 첨부 자료로 옮겨 저장했음 표시
    return out;
}

/* --------------------------------------------------------------------------
   [추가] 이상 현상 / 조치내용 칸 이미지 붙여넣기 (캡처 이미지용)
   - 형식: PNG, JPG만 / 1장 최대 500KB / 칸당 최대 5장 / 시트 전체 최대 10MB
   -------------------------------------------------------------------------- */
const SHEET_IMG_TYPES = ['image/png', 'image/jpeg'];
const SHEET_IMG_MAX_BYTES = 500 * 1024; // 1장 최대 500KB
const SHEET_IMG_MAX_PER_FIELD = 5;
const SHEET_IMG_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const SHEET_IMG_FIELD_BY_ID = {
    'trouble-modal-situation': 'situation',
    'trouble-modal-symptom': 'symptom',
    'trouble-modal-cause': 'cause',
    'trouble-modal-action-taken': 'measure',
    'trouble-modal-preventive': 'prevent'
};

const SHEET_IMG_MAX_ATTACH = 10; // 첨부 자료 페이지는 최대 10장

function getSheetImageKey(textarea) {
    if (!textarea) return '';
    return textarea.dataset.imgKey || SHEET_IMG_FIELD_BY_ID[textarea.id] || textarea.dataset.sheet || '';
}

function getSheetImageMax(list) {
    return (list && list.dataset.imgKey === 'attach') ? SHEET_IMG_MAX_ATTACH : SHEET_IMG_MAX_PER_FIELD;
}

function getAttachImageList() {
    ensureSheetImageLists();
    return document.querySelector('#trouble-sheet .ts-img-list[data-img-key="attach"]');
}

// 이미지 붙여넣기가 가능한 칸마다 이미지 목록 영역을 만들어 둠 (2번·3번 구간)
function ensureSheetImageLists() {
    document.querySelectorAll('#trouble-sheet .ts-img-enabled textarea').forEach(t => {
        const key = getSheetImageKey(t);
        if (!key) return;
        let list = t.parentNode.querySelector(`.ts-img-list[data-img-key="${key}"]`);
        if (!list) {
            list = document.createElement('div');
            list.className = 'ts-img-list';
            list.dataset.imgKey = key;
            t.insertAdjacentElement('afterend', list);
            if (!t.placeholder) t.placeholder = '내용 입력 · 캡처 이미지는 Ctrl+V로 붙여넣기 (PNG/JPG, 500KB 이하)';
        }
    });
}

function dataUrlBytes(dataUrl) {
    const i = String(dataUrl || '').indexOf(',');
    if (i < 0) return 0;
    return Math.floor((dataUrl.length - i - 1) * 3 / 4);
}

function getSheetImagesTotalBytes() {
    let total = 0;
    document.querySelectorAll('#trouble-sheet .ts-img-item img').forEach(img => { total += dataUrlBytes(img.src); });
    return total;
}

function addSheetImage(list, dataUrl) {
    const item = document.createElement('div');
    item.className = 'ts-img-item';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '첨부 이미지';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ts-img-del ts-no-print';
    del.title = '이미지 삭제';
    del.textContent = '✕';
    del.addEventListener('click', () => {
        if (confirm('이 이미지를 삭제하시겠습니까?')) item.remove();
    });
    item.appendChild(img);
    item.appendChild(del);
    list.appendChild(item);
}

function renderSheetImages(images) {
    ensureSheetImageLists();
    document.querySelectorAll('#trouble-sheet .ts-img-list').forEach(list => {
        list.innerHTML = '';
        const arr = Array.isArray(images[list.dataset.imgKey]) ? images[list.dataset.imgKey] : [];
        arr.forEach(src => {
            if (typeof src === 'string' && /^data:image\/(png|jpeg);base64,/.test(src)) addSheetImage(list, src);
        });
    });
}

function collectSheetImages() {
    const out = {};
    document.querySelectorAll('#trouble-sheet .ts-img-list').forEach(list => {
        const arr = Array.from(list.querySelectorAll('.ts-img-item img')).map(img => img.src);
        if (arr.length) out[list.dataset.imgKey] = arr;
    });
    return out;
}

// 이미지 파일을 목록에 추가 (붙여넣기·사진 첨부 공통: 형식·용량·개수 제한)
function addSheetImageFiles(files, list) {
    if (!list) return;
    const max = getSheetImageMax(list);
    let pendingCount = list.querySelectorAll('.ts-img-item').length;
    let pendingBytes = getSheetImagesTotalBytes();
    for (const file of files) {
        if (!SHEET_IMG_TYPES.includes(file.type)) {
            alert('PNG 또는 JPG 이미지만 추가할 수 있습니다.');
            continue;
        }
        if (file.size > SHEET_IMG_MAX_BYTES) {
            alert(`이미지 용량은 1장당 최대 500KB까지 가능합니다.\n(현재 ${Math.ceil(file.size / 1024)}KB - 필요한 부분만 작게 캡처해 주세요.)`);
            continue;
        }
        if (pendingCount >= max) {
            alert(`이미지는 이 영역에 최대 ${max}장까지 넣을 수 있습니다.`);
            break;
        }
        if (pendingBytes + file.size > SHEET_IMG_MAX_TOTAL_BYTES) {
            alert('시트 전체 이미지 용량은 최대 10MB까지 가능합니다.\n사용하지 않는 이미지를 삭제해 주세요.');
            break;
        }
        pendingCount += 1;
        pendingBytes += file.size;
        const reader = new FileReader();
        reader.onload = (evt) => {
            if (list.querySelectorAll('.ts-img-item').length >= max) return;
            addSheetImage(list, evt.target.result);
        };
        reader.readAsDataURL(file);
    }
}

function handleSheetImagePaste(e) {
    let textarea = e.target;
    // 첨부 자료 페이지는 글 입력칸이 아닌 곳을 클릭한 상태에서도 붙여넣기 가능
    if (!textarea || textarea.tagName !== 'TEXTAREA') {
        const page = e.target && e.target.closest ? e.target.closest('.ts-page-attach') : null;
        textarea = page ? page.querySelector('textarea[data-img-key="attach"]') : null;
    }
    if (!textarea || !textarea.closest('#trouble-sheet .ts-img-enabled')) return;
    const cd = e.clipboardData;
    if (!cd) return;

    const files = Array.from(cd.items || []).filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
    if (!files.length) return; // 이미지가 없으면 일반 텍스트 붙여넣기
    // 엑셀·워드처럼 글자와 이미지가 함께 복사된 경우는 글자로 붙여넣기 (이미지는 캡처해서 붙여넣기)
    const text = cd.getData('text/plain');
    if (text && text.trim() && e.target.tagName === 'TEXTAREA') return;

    e.preventDefault();
    addSheetImageFiles(files, textarea.parentNode.querySelector('.ts-img-list'));
}

function buildConsultRow(row = {}) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="date" class="ts-input ts-center" data-consult="date" value="${escapeHtml(row.date || '')}"></td>
        <td><textarea class="ts-input ts-area ts-center" rows="1" data-consult="target" placeholder="협의 대상 (부서 / 담당자)">${escapeHtml(row.target || '')}</textarea></td>
        <td><textarea class="ts-input ts-area" rows="1" data-consult="content" placeholder="협의 내용 및 진행 사항">${escapeHtml(row.content || '')}</textarea></td>
        <td class="ts-no-print"><button type="button" class="btn-del-sm ts-consult-del" title="행 삭제">✕</button></td>`;
    tr.querySelector('.ts-consult-del').addEventListener('click', () => {
        const hasValue = Array.from(tr.querySelectorAll('[data-consult]')).some(el => el.value.trim());
        if (hasValue && !confirm('이 협의 이력을 삭제하시겠습니까?')) return;
        tr.remove();
    });
    tr.querySelectorAll('textarea').forEach(el => {
        el.addEventListener('input', () => adjustTextareaHeight(el));
    });
    return tr;
}

function renderConsultRows(rows) {
    const tbody = document.getElementById('trouble-consult-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const list = rows.length ? rows : [{}, {}];  // 빈 시트는 입력용 빈 행 2개
    list.forEach(r => tbody.appendChild(buildConsultRow(r)));
}

function setupTroubleSheetEvents() {
    const addBtn = document.getElementById('btn-add-trouble-consult');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const tbody = document.getElementById('trouble-consult-tbody');
            if (!tbody) return;
            const today = new Date();
            const tr = buildConsultRow({
                date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
            });
            tbody.appendChild(tr);
            const target = tr.querySelector('[data-consult="target"]');
            if (target) target.focus();
        });
    }
    // 시트의 모든 입력 칸은 내용에 맞춰 높이 자동 조절
    const sheet = document.getElementById('trouble-sheet');
    if (sheet) {
        ensureSheetImageLists();
        sheet.addEventListener('paste', handleSheetImagePaste); // [추가] 이상 현상 / 조치내용 칸 이미지 붙여넣기
        sheet.addEventListener('input', (e) => {
            if (e.target && e.target.tagName === 'TEXTAREA') adjustTextareaHeight(e.target);
        });
    }
}