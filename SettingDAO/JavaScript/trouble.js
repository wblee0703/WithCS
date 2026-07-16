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
    dateType: '1month', 
    year: '', 
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
    
    const cachedFilter = localStorage.getItem('lastTroubleFilter');
    const cachedCompletedOnly = localStorage.getItem('lastTroubleCompletedOnly');
    const cachedKeyword = localStorage.getItem('lastTroubleKeyword');
    const cachedList = sessionStorage.getItem('lastTroubleList');
    
    try {
        if (cachedFilter) {
            currentTroubleFilter = { ...currentTroubleFilter, ...JSON.parse(cachedFilter) };
        }
        // [수정] 진입 시 URL에 date 파라미터가 없을 때에만 캐시 상태와 무관하게 "최근 1달"로 초기화 강제 적용
        const params = new URLSearchParams(window.location.search);
        if (!params.get('date')) {
            currentTroubleFilter.dateType = '1month';
            currentTroubleFilter.year = '';
            currentTroubleFilter.month = '';
            currentTroubleFilter.startDate = '';
            currentTroubleFilter.endDate = '';
        }
        if (cachedCompletedOnly) {
            showCompletedOnly = JSON.parse(cachedCompletedOnly);
            const btnToggleCompleted = document.getElementById('btn-toggle-completed-trouble');
            if (btnToggleCompleted) {
                if (showCompletedOnly) btnToggleCompleted.classList.add('active');
                else btnToggleCompleted.classList.remove('active');
            }
        }
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
    
    // [개선] 세션스토리지 캐시 목록이 있으면 fetch API 연동을 생략하고 즉각 필터 렌더링 (재연산/딜레이 제거)
    if (cachedList) {
        try {
            allTroubles = JSON.parse(cachedList);
            applyTroubleFilter();
        } catch (e) {
            console.error('Trouble cache parse error:', e);
            fetchTroubles();
        }
    } else {
        fetchTroubles();
    }
}

function restoreTroubleFilterUI() {
    try {
        const siteList = document.getElementById('trouble-site-list');
        if (siteList) {
            siteList.querySelectorAll('li').forEach(li => {
                if (li.dataset.site === currentTroubleFilter.site) li.classList.add('active');
                else li.classList.remove('active');
            });
        }
        renderTroubleModels(currentTroubleFilter.site);
        const modelList = document.getElementById('trouble-model-list');
        if (modelList) {
            modelList.querySelectorAll('li').forEach(li => {
                if (li.dataset.model === currentTroubleFilter.model) li.classList.add('active');
                else li.classList.remove('active');
            });
        }
        renderTroubleEquips(currentTroubleFilter.site, currentTroubleFilter.model);
        const equipList = document.getElementById('trouble-equip-list');
        if (equipList) {
            equipList.querySelectorAll('li').forEach(li => {
                if (li.dataset.equip === currentTroubleFilter.equip) li.classList.add('active');
                else li.classList.remove('active');
            });
        }
    } catch (e) {
        console.error('restoreTroubleFilterUI error:', e);
    }
}

function checkQueryStringFilters() {
    const params = new URLSearchParams(window.location.search);
    const siteParam = params.get('site');
    const equipParam = params.get('equip');
    const dateParam = params.get('date');

    if (siteParam && equipParam) {
        currentTroubleFilter.site = siteParam;

        const parts = equipParam.split('::');
        const model = parts[0];
        currentTroubleFilter.model = model;
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
    const siteList = document.getElementById('trouble-site-list');
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};

    siteList.innerHTML = `<li data-site="ALL" class="active">전체 사업장</li>`;

    // 사업장들의 구분을 중복 없이 수집
    const groups = new Set();
    Object.keys(deviceData).forEach(site => {
        if (site !== 'models' && site !== 'details') {
            groups.add(getSiteGroup(site));
        }
    });

    const sortedGroups = Array.from(groups).sort();
    sortedGroups.forEach(g => {
        siteList.insertAdjacentHTML('beforeend', `<li data-site="${escapeHtml(g)}">${escapeHtml(g)}</li>`);
    });

    siteList.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
            siteList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');

            currentTroubleFilter.site = li.dataset.site; // 구분값이 담김 (예: 'SEC')
            currentTroubleFilter.model = 'ALL';
            currentTroubleFilter.equip = 'ALL';

            renderTroubleModels(currentTroubleFilter.site);
            applyTroubleFilter();
        });
    });

    renderTroubleModels('ALL');
}

function renderTroubleModels(siteGroup) {
    const modelList = document.getElementById('trouble-model-list');
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    modelList.innerHTML = `<li data-model="ALL" class="active">전체 모델</li>`;

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

    const uniqueModels = Array.from(modelSet).sort();
    uniqueModels.forEach(mName => {
        const matched = equipmentModels.find(m => m.name === mName || m.abbr === mName);
        const displayName = matched && matched.abbr ? matched.abbr : mName;
        modelList.insertAdjacentHTML('beforeend', `<li data-model="${escapeHtml(mName)}">${escapeHtml(displayName)}</li>`);
    });

    modelList.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
            modelList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');

            currentTroubleFilter.model = li.dataset.model;
            currentTroubleFilter.equip = 'ALL';

            renderTroubleEquips(currentTroubleFilter.site, currentTroubleFilter.model);
            applyTroubleFilter();
        });
    });

    renderTroubleEquips(siteGroup, 'ALL');
}

function renderTroubleEquips(siteGroup, model) {
    const equipList = document.getElementById('trouble-equip-list');
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const searchInput = document.getElementById('trouble-equip-search-filter');
    if (searchInput) searchInput.value = '';

    equipList.innerHTML = `<li data-equip="ALL" class="active">전체 장비</li>`;

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

    equips.forEach(item => {
        const parts = item.equip.split('::');
        const rawName = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';
        const matched = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
        const displayName = matched && matched.abbr ? matched.abbr : rawName;

        const detailData = JSON.parse(localStorage.getItem(`details_${item.site}_${item.equip}`)) || {};
        const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
        const subText = custEquipName ? ` [${custEquipName}]` : (serial ? ` [${serial}]` : '');

        // 사업장 구분이 켜진 상태이므로 장비별 실질 소속 사업장명을 아래에 상시 표기
        const displayHtml = `<div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 11px; color: #8b949e;">${escapeHtml(item.site)}</span><span>${escapeHtml(displayName)}${escapeHtml(subText)}</span></div>`;

        const searchText = `${item.site} ${displayName} ${serial} ${custEquipName}`.toLowerCase();

        equipList.insertAdjacentHTML('beforeend', `<li data-equip="${escapeHtml(item.equip)}" data-search="${escapeHtml(searchText)}">
            ${displayHtml}
        </li>`);
    });

    equipList.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
            equipList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            currentTroubleFilter.equip = li.dataset.equip;
            applyTroubleFilter();
        });
    });
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
            const rawDate = t.action_date || t.occur_date || '';
            const tDate = rawDate.slice(0, 10);
            return tDate ? tDate >= limitStr : false;
        });
    } else if (dateType === 'year') {
        const targetYear = currentTroubleFilter.year || String(new Date().getFullYear());
        filtered = filtered.filter(t => {
            const rawDate = t.action_date || t.occur_date || '';
            const tDate = rawDate.slice(0, 10);
            return tDate ? tDate.startsWith(targetYear) : false;
        });
    } else if (dateType === 'month') {
        const targetYear = currentTroubleFilter.year || String(new Date().getFullYear());
        const targetMonth = currentTroubleFilter.month || String(new Date().getMonth() + 1).padStart(2, '0');
        const prefix = `${targetYear}-${targetMonth}`;
        filtered = filtered.filter(t => {
            const rawDate = t.action_date || t.occur_date || '';
            const tDate = rawDate.slice(0, 10);
            return tDate ? tDate.startsWith(prefix) : false;
        });
    } else if (dateType === 'custom') {
        const start = currentTroubleFilter.startDate || '';
        const end = currentTroubleFilter.endDate || '';
        filtered = filtered.filter(t => {
            const rawDate = t.action_date || t.occur_date || '';
            const tDate = rawDate.slice(0, 10);
            if (!tDate) return false;

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

function setupTroubleLoadHistoryEvent() {
    const btnLoadHistory = document.getElementById('btn-load-trouble-history');
    const loadHistoryModal = document.getElementById('trouble-load-history-modal');
    const btnCloseLoadHistory = document.getElementById('btn-close-trouble-load-history');

    if (btnLoadHistory) {
        btnLoadHistory.addEventListener('click', () => {
            const modal = document.getElementById('trouble-detail-modal');
            const equipId = modal.dataset.equipId;
            if (!equipId) {
                alert('장비를 먼저 선택해주세요. (목록에서 이력 선택 필요)');
                return;
            }

            const currentTroubleId = modal.dataset.troubleId;
            const equipHistories = allTroubles.filter(t => {
                if (t.equip_id !== equipId || String(t.id) === String(currentTroubleId)) return false;

                // [추가] 발생 일시가 작성된 내역만 필터링
                const isRecorded = t.occur_date && String(t.occur_date).trim() !== '' && t.occur_date !== '-';
                if (!isRecorded) return false;

                let hasContent = false;
                if (t.content) {
                    if (typeof t.content === 'string' && t.content.startsWith('{')) {
                        try {
                            const parsed = JSON.parse(t.content);
                            if (parsed.situation || parsed.symptom || parsed.cause || parsed.action || parsed.prevention) hasContent = true;
                        } catch (e) { }
                    } else if (String(t.content).trim() !== '' && String(t.content).trim() !== '-') {
                        hasContent = true;
                    }
                }
                if (t.memo && String(t.memo).trim() !== '') hasContent = true;
                if (t.image_data) hasContent = true;

                return hasContent;
            });

            equipHistories.sort((a, b) => {
                const dateA = a.action_date || a.occur_date || '';
                const dateB = b.action_date || b.occur_date || '';
                return dateB.localeCompare(dateA);
            });

            const listEl = document.getElementById('trouble-load-history-list');
            if (!listEl) return;

            if (equipHistories.length === 0) {
                listEl.innerHTML = '<li style="text-align: center; color: #8b949e; padding: 20px;">불러올 이전 작업 이력이 없습니다.</li>';
            } else {
                listEl.innerHTML = equipHistories.map(h => {
                    let displayContent = h.content || '-';
                    let tooltipContent = displayContent;
                    if (typeof displayContent === 'string' && displayContent.startsWith('{')) {
                        try {
                            const parsed = JSON.parse(displayContent);
                            const arr = [];
                            let sit = parsed.situation || '';
                            if (sit) arr.push(`[상황] ${sit}`);
                            if (parsed.symptom) arr.push(`[증상] ${parsed.symptom}`);
                            if (parsed.cause) arr.push(`[원인] ${parsed.cause}`);
                            if (parsed.trouble_memo) arr.push(`[메모] ${parsed.trouble_memo}`);

                            displayContent = arr.length > 0 ? arr.join(' / ') : '-';
                            tooltipContent = arr.join('\n');
                        } catch (e) { }
                    } else {
                        displayContent = '-';
                        tooltipContent = '';
                    }
                    const dateStr = h.action_date || h.occur_date || '-';
                    return `<li data-id="${h.id}" data-source="${h.source}" style="padding: 12px; border-bottom: 1px solid #30363d; cursor: pointer; display: flex; flex-direction: column; gap: 5px; background: #161b22; border-radius: 4px; margin-bottom: 8px; transition: background 0.2s;">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: #58a6ff; font-weight: bold; font-size: 13px;">${dateStr}</span>
                            <span style="color: #8b949e; font-size: 11px; background: #21262d; padding: 2px 6px; border-radius: 4px;">${h.source === 'log' ? '점검이력' : 'Trouble'}</span>
                        </div>
                        <div title="${escapeHtml(tooltipContent)}" style="color: #e6edf3; font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">${escapeHtml(displayContent)}</div>
                    </li>`;
                }).join('');

                listEl.querySelectorAll('li').forEach(li => {
                    li.addEventListener('mouseover', () => li.style.background = '#21262d');
                    li.addEventListener('mouseout', () => li.style.background = '#161b22');
                    li.addEventListener('click', () => {
                        if (!confirm('선택한 작업내용과 사진을 현재 창에 불러오시겠습니까?\n(입력되어 있던 내용은 덮어씌워집니다.)')) return;

                        const hId = li.dataset.id;
                        const hSource = li.dataset.source;
                        const targetData = equipHistories.find(t => String(t.id) === String(hId) && t.source === hSource);

                        if (targetData) {
                            bindTroubleContentAndImage(targetData, true); // [수정] 불러오기 시 세부사항(메모)은 제외
                            alert('데이터를 불러왔습니다.');
                            if (loadHistoryModal) loadHistoryModal.style.display = 'none';
                        }
                    });
                });
            }

            if (loadHistoryModal) loadHistoryModal.style.display = 'flex';
        });
    }

    if (btnCloseLoadHistory) {
        btnCloseLoadHistory.addEventListener('click', () => {
            if (loadHistoryModal) loadHistoryModal.style.display = 'none';
        });
    }
}

function setupTroubleEvents() {
    // 모달 닫기 버튼 클릭
    const btnCloseModal = document.getElementById('btn-close-trouble-modal');

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', closeTroubleModal);
    }

    // 사진 첨부 로직 (용량 및 확장자 검사)
    const imageInput = document.getElementById('trouble-modal-image');
    const removeBtn = document.getElementById('btn-remove-trouble-image');
    const previewContainer = document.getElementById('trouble-image-preview-container');
    const previewImg = document.getElementById('trouble-image-preview');

    if (imageInput) {
        imageInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;

            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
            if (!allowedTypes.includes(file.type)) {
                alert('.jpg 또는 .png 파일만 업로드 가능합니다.');
                this.value = '';
                return;
            }

            if (file.size > 500 * 1024) {
                alert('파일 용량은 최대 500KB까지만 가능합니다.');
                this.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = function (evt) {
                currentTroubleImageBase64 = evt.target.result;
                if (previewImg) previewImg.src = currentTroubleImageBase64;
                if (previewContainer) previewContainer.style.display = 'block';
                if (removeBtn) removeBtn.style.display = 'inline-block';
            };
            reader.readAsDataURL(file);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', function () {
            currentTroubleImageBase64 = '';
            if (imageInput) imageInput.value = '';
            if (previewImg) previewImg.src = '';
            if (previewContainer) previewContainer.style.display = 'none';
            removeBtn.style.display = 'none';
        });
    }

    setupTroubleLoadHistoryEvent();

    // 모달 내부 저장 버튼 클릭
    const btnSave = document.getElementById('btn-save-trouble');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            const modal = document.getElementById('trouble-detail-modal');
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

            let contentData = {};
            if (situationEl || symptomEl || causeEl || actionEl || preventionEl) {
                contentData = {
                    situation: situationEl ? situationEl.value : '',
                    symptom: symptomEl ? symptomEl.value : '',
                    cause: causeEl ? causeEl.value : '',
                    action: actionEl ? actionEl.value : '',
                    prevention: preventionEl ? preventionEl.value : ''
                };
                if (source === 'log' || source === 'maint') {
                    contentData.trouble_memo = memoEl ? memoEl.value : '';
                }
            }

            const memoVal = memoEl ? memoEl.value : '';
            const maintMemoVal = situationEl ? situationEl.value : '';

            const payload = {
                id: troubleId,
                equip_id: equipId,
                occur_date: document.getElementById('trouble-modal-occur-date').value,
                action_date: document.getElementById('trouble-modal-action-date').value,
                content: contentData, // [수정] JSON 객체로 전송
                memo: memoVal, // [추가] 진행 경과 분리 전송
                maint_memo: maintMemoVal,
                worker: document.getElementById('trouble-modal-worker').value,
                status: document.getElementById('trouble-modal-status') ? document.getElementById('trouble-modal-status').value : '조치완료',
                image_data: currentTroubleImageBase64,
                source: source
            };

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

    // [추가] 모달 내부 삭제 버튼 클릭
    const btnDelete = document.getElementById('btn-delete-trouble');
    if (btnDelete) {
        btnDelete.addEventListener('click', () => {
            const modal = document.getElementById('trouble-detail-modal');
            const troubleId = modal.dataset.troubleId;
            const source = modal.dataset.source;

            if (!confirm('해당 Trouble 이력을 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.')) return;

            const payload = {
                id: troubleId,
                source: source
            };

            fetch('/api/trouble/crud', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                body: JSON.stringify({ action: 'DELETE', payload: payload })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success') {
                        alert('삭제되었습니다.');
                        closeTroubleModal();
                        fetchTroubles();
                    } else {
                        alert('삭제 실패: ' + data.message);
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

    // [추가] 작성완료 필터 버튼 이벤트
    const btnToggleCompleted = document.getElementById('btn-toggle-completed-trouble');
    if (btnToggleCompleted) {
        btnToggleCompleted.addEventListener('click', () => {
            btnToggleCompleted.classList.toggle('active');
            showCompletedOnly = btnToggleCompleted.classList.contains('active');
            applyTroubleFilter();
        });
    };

    // 사이드바 장비 목록 텍스트 검색 필터
    const equipSearchFilter = document.getElementById('trouble-equip-search-filter');
    if (equipSearchFilter) {
        equipSearchFilter.addEventListener('input', (e) => {
            const kw = e.target.value.toLowerCase().trim();
            document.querySelectorAll('#trouble-equip-list li').forEach(li => {
                if (li.dataset.equip === 'ALL') return;
                const searchStr = li.dataset.search || '';
                li.style.display = searchStr.includes(kw) ? '' : 'none';
            });
        });
    }

    // [추가] 모바일 환경 텍스트 영역 높이 동적 조절 이벤트 등록
    const textareas = [
        'trouble-modal-situation',
        'trouble-modal-symptom',
        'trouble-modal-cause',
        'trouble-modal-action-taken',
        'trouble-modal-preventive',
        'trouble-modal-content'
    ];
    textareas.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', function () {
                adjustTextareaHeight(this);
            });
            el.addEventListener('focus', function () {
                adjustTextareaHeight(this);
            });
        }
    });

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
        container.innerHTML = `<select id="trouble-date-year-select" style="width: 80px; height: 32px; background-color: #0d1117; color: #ffffff; border: 1px solid #30363d; border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; cursor: pointer; font-size: 13px;">${options}</select>`;
        
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
            <select id="trouble-date-year-select" style="width: 80px; height: 32px; background-color: #0d1117; color: #ffffff; border: 1px solid #30363d; border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; cursor: pointer; font-size: 13px;">${yearOptions}</select>
            <select id="trouble-date-month-select" style="width: 65px; height: 32px; background-color: #0d1117; color: #ffffff; border: 1px solid #30363d; border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; cursor: pointer; font-size: 13px;">${monthOptions}</select>
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
            <input type="date" id="trouble-date-start" style="width: 120px; height: 32px; background-color: #0d1117; color: #ffffff; border: 1px solid #30363d; border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; font-size: 13px;" value="${startVal}">
            <span style="color:#8b949e;">~</span>
            <input type="date" id="trouble-date-end" style="width: 120px; height: 32px; background-color: #0d1117; color: #ffffff; border: 1px solid #30363d; border-radius: 4px; padding: 0 8px; box-sizing: border-box; outline: none; font-size: 13px;" value="${endVal}">
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
    const btnDelete = document.getElementById('btn-delete-trouble'); // [추가] 삭제 버튼

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

            if (statusInput) statusInput.value = troubleData.status || '조치중';
            if (workerInput) workerInput.value = troubleData.worker || '';

            // [수정] source 제약 없이 모든 트러블 이력 소스에 대해 진행 경과(JSON) 바인딩 수행
            bindTroubleContentAndImage(troubleData);

            // [추가] Trouble 테이블 원본 데이터인 경우에만 삭제 버튼 노출
            if (btnDelete) {
                if (source === 'trouble') btnDelete.style.display = 'inline-block';
                else btnDelete.style.display = 'none';
            }



        }
    } else {
        // 등록(Add) 모드일 때 기본 담당자 이름 채우기
        if (workerInput) workerInput.value = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
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

        if (typeof parsed === 'object' && parsed !== null) {
            if (situationEl) situationEl.value = parsed.situation || '';
            if (symptomEl) symptomEl.value = parsed.symptom || '';
            if (causeEl) causeEl.value = parsed.cause || '';
            if (actionEl) actionEl.value = parsed.action || '';
            if (preventionEl) preventionEl.value = parsed.prevention || '';
            if (memoInput && (data.source === 'log' || data.source === 'maint')) {
                memoInput.value = parsed.trouble_memo || '';
            }
        } else {
            if (situationEl) situationEl.value = data.content || '';
        }
    }

    if (data.source === 'log' || data.source === 'maint') {
        if (situationEl) {
            if (parsed && typeof parsed === 'object' && parsed.situation !== undefined) {
                situationEl.value = parsed.situation || '';
            } else {
                situationEl.value = '';
            }
        }
        if (!excludeMemo && memoInput) {
            if (parsed && typeof parsed === 'object' && parsed.trouble_memo !== undefined) {
                memoInput.value = parsed.trouble_memo || '';
            } else {
                memoInput.value = data.memo || '';
            }
        }
    } else {
        if (!excludeMemo && memoInput) memoInput.value = data.memo || '';
    }

    if (data.image_data) {
        currentTroubleImageBase64 = data.image_data;
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
            tbody.innerHTML = '<tr><td colspan="10" class="list-empty-msg" style="padding:30px;">조건에 맞는 Trouble 이력이 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = dataList.map(t => {
            let displayCheckItem = t.check_item || '-';
            if (displayCheckItem !== '-') {
                let items = displayCheckItem.split(',').map(s => s.replace(/\[(?:유상|무상[^\]]*|기타)\]/g, '').trim()).filter(Boolean);
                if (items.length > 1) {
                    displayCheckItem = `${items[0]} 외 ${items.length - 1}개`;
                } else if (items.length === 1) {
                    displayCheckItem = items[0];
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
                        equipSubHtml = `<div style="color: #58a6ff; font-size: 11px; margin-top: 2px;">[${escapeHtml(subVal)}]</div>`;
                    } else {
                        equipSubHtml = `<div style="color: #8b949e; font-size: 11px; margin-top: 2px;">(${escapeHtml(subVal)})</div>`;
                    }
                }
            }

            let dt1 = t.detail_type || '-';
            let dt2 = t.detail_type2 || '-';

            if (dt1.includes(' > ')) {
                const parts = dt1.split(' > ');
                dt1 = parts[0].trim();
                if (dt2 === '-' || dt2 === '') dt2 = parts[1].trim();
            } else if (dt2.includes(' > ')) {
                const parts = dt2.split(' > ');
                if (dt1 === '-' || dt1 === '') dt1 = parts[0].trim();
                dt2 = parts[1].trim();
            }

            // [추가] JSON 형태의 content를 목록에 예쁘게 표시
            let displayContent = t.content || '-';
            let tooltipContent = t.content || '';
            if (typeof displayContent === 'string' && displayContent.startsWith('{')) {
                try {
                    const parsed = JSON.parse(displayContent);
                    const arr = [];
                    let sit = parsed.situation || '';

                    if (sit) arr.push(`[상황] ${sit}`);
                    if (parsed.symptom) arr.push(`[증상] ${parsed.symptom}`);
                    if (parsed.cause) arr.push(`[원인] ${parsed.cause}`);
                    if (parsed.action) arr.push(`[조치] ${parsed.action}`);
                    if (parsed.prevention) arr.push(`[대책] ${parsed.prevention}`);
                    if (parsed.trouble_memo) arr.push(`[메모] ${parsed.trouble_memo}`);

                    // [수정] 화면에는 '트러블 상황'에 입력된 내용만 단독으로 표시 (툴팁은 전체 내용 유지)
                    displayContent = sit || '-';
                    tooltipContent = arr.join('\n');
                } catch (e) { }
            } else {
                displayContent = '-';
                tooltipContent = '';
            }

            // [추가] 기록여부 판단 (발생 일시 유무 기준)
            const isRecorded = t.occur_date && t.occur_date.trim() !== '' && t.occur_date !== '-';
            const recordIcon = isRecorded
                ? '<span style="color: #3fb950; font-size: 16px;" title="발생 일시 기록됨">●</span>'
                : '<span style="color: #8b949e; font-size: 16px;" title="발생 일시 미기록">○</span>';

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

    // 텍스트가 적을 때도 레이아웃이 찌그러지지 않도록 기본 최소 높이 지정
    let minHeight = 45;
    if (el.id === 'trouble-modal-content') {
        minHeight = 150; // 세부내용 기본 높이
    } else if (el.id === 'trouble-modal-situation') {
        minHeight = 100; // 트러블 상황 기본 높이
    }

    // 텍스트 내용의 높이(scrollHeight)와 최소 높이 중 더 큰 값으로 설정
    const targetHeight = Math.max(el.scrollHeight, minHeight);
    el.style.height = targetHeight + 'px';
}

/**
 * 모달 내부의 모든 진행 경과 및 세부사항 입력 창의 높이를 조절합니다.
 */
function adjustAllTextareaHeights() {
    const textareas = [
        'trouble-modal-situation',
        'trouble-modal-symptom',
        'trouble-modal-cause',
        'trouble-modal-action-taken',
        'trouble-modal-preventive',
        'trouble-modal-content'
    ];
    textareas.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            adjustTextareaHeight(el);
        }
    });
}