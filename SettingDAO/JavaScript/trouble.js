/* ==========================================================================
   Trouble 이력 관리 전용 JavaScript
   - 모든 Trouble 관련 비즈니스 로직 및 이벤트 핸들링 관리
   - 모달 구조는 trouble.html에 하드코딩하여 사용
   ========================================================================== */

let allTroubles = [];
let currentTroubleFilter = { site: 'ALL', model: 'ALL', equip: 'ALL', keyword: '' };
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
    renderTroubleSites();
    fetchTroubles();
}

function fetchTroubles() {
    // [추가] common.js의 fetch/getCookie 등 공통 환경 사용을 가정합니다.
    fetch('/api/trouble/list', { headers: { 'X-CSRFToken': getCookie('csrf_token') } })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                allTroubles = data.data || [];
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
    
    const sites = Object.keys(deviceData).filter(s => s !== 'models' && s !== 'details').sort();
    sites.forEach(site => {
        siteList.insertAdjacentHTML('beforeend', `<li data-site="${escapeHtml(site)}">${escapeHtml(site)}</li>`);
    });

    siteList.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
            siteList.querySelectorAll('li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            
            currentTroubleFilter.site = li.dataset.site;
            currentTroubleFilter.model = 'ALL';
            currentTroubleFilter.equip = 'ALL';
            
            renderTroubleModels(currentTroubleFilter.site);
            applyTroubleFilter();
        });
    });
    
    renderTroubleModels('ALL');
}

function renderTroubleModels(site) {
    const modelList = document.getElementById('trouble-model-list');
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    
    modelList.innerHTML = `<li data-model="ALL" class="active">전체 모델</li>`;
    
    let equips = [];
    if (site === 'ALL') {
        Object.keys(deviceData).forEach(s => {
            if (s !== 'models' && s !== 'details') deviceData[s].forEach(e => equips.push(e));
        });
    } else {
        if (deviceData[site]) equips = deviceData[site];
    }
    
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
    
    renderTroubleEquips(site, 'ALL');
}

function renderTroubleEquips(site, model) {
    const equipList = document.getElementById('trouble-equip-list');
    const deviceData = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const searchInput = document.getElementById('trouble-equip-search-filter');
    if (searchInput) searchInput.value = '';
    
    equipList.innerHTML = `<li data-equip="ALL" class="active">전체 장비</li>`;
    
    let equips = [];
    if (site === 'ALL') {
        Object.keys(deviceData).forEach(s => {
            if (s !== 'models' && s !== 'details') deviceData[s].forEach(e => equips.push({ site: s, equip: e }));
        });
    } else {
        if (deviceData[site]) deviceData[site].forEach(e => equips.push({ site: site, equip: e }));
    }
    
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
        
        let displayHtml = '';
        if (site === 'ALL') {
            displayHtml = `<div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 11px; color: #8b949e;">${escapeHtml(item.site)}</span><span>${escapeHtml(displayName)}${escapeHtml(subText)}</span></div>`;
        } else {
            displayHtml = `<span>${escapeHtml(displayName)}${escapeHtml(subText)}</span>`;
        }
        
        const searchText = `${item.site} ${displayName} ${subText}`.toLowerCase();
        
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

function applyTroubleFilter() {
    const searchInput = document.getElementById('trouble-search-input');
    currentTroubleFilter.keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    let filtered = allTroubles;
    
    if (currentTroubleFilter.site !== 'ALL') filtered = filtered.filter(t => t.site === currentTroubleFilter.site);
    
    if (currentTroubleFilter.model !== 'ALL') filtered = filtered.filter(t => t.equip_id && t.equip_id.split('::')[1] === currentTroubleFilter.model);
    
    if (currentTroubleFilter.equip !== 'ALL') filtered = filtered.filter(t => t.equip_id && t.equip_id.split('::').slice(1).join('::') === currentTroubleFilter.equip);
    
    if (currentTroubleFilter.keyword) {
        filtered = filtered.filter(t => 
            (t.equip && t.equip.toLowerCase().includes(currentTroubleFilter.keyword)) || 
            (t.content && t.content.toLowerCase().includes(currentTroubleFilter.keyword)) || 
            (t.worker && t.worker.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.type && t.type.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.detail_type && t.detail_type.toLowerCase().includes(currentTroubleFilter.keyword)) ||
            (t.check_item && t.check_item.toLowerCase().includes(currentTroubleFilter.keyword))
        );
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
    const removeBtn = document.getElementById('btn-remove-trouble-image');
    const previewContainer = document.getElementById('trouble-image-preview-container');
    const previewImg = document.getElementById('trouble-image-preview');

    if (imageInput) {
        imageInput.addEventListener('change', function(e) {
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
            reader.onload = function(evt) {
                currentTroubleImageBase64 = evt.target.result;
                if (previewImg) previewImg.src = currentTroubleImageBase64;
                if (previewContainer) previewContainer.style.display = 'block';
                if (removeBtn) removeBtn.style.display = 'inline-block';
            };
            reader.readAsDataURL(file);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', function() {
            currentTroubleImageBase64 = '';
            if (imageInput) imageInput.value = '';
            if (previewImg) previewImg.src = '';
            if (previewContainer) previewContainer.style.display = 'none';
            removeBtn.style.display = 'none';
        });
    }

    // 모달 내부 저장 버튼 클릭
    const btnSave = document.getElementById('btn-save-trouble');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            const modal = document.getElementById('trouble-detail-modal');
            const mode = modal.dataset.mode || 'add';
            const troubleId = modal.dataset.troubleId || Date.now();
            const equipId = modal.dataset.equipId || '';
            
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
            }

            const memoVal = memoEl ? memoEl.value : '';

            const payload = {
                id: troubleId,
                equip_id: equipId,
                occur_date: document.getElementById('trouble-modal-occur-date').value,
                action_date: document.getElementById('trouble-modal-action-date').value,
                content: contentData, // [수정] JSON 객체로 전송
                memo: memoVal, // [추가] 진행 경과 분리 전송
                worker: document.getElementById('trouble-modal-worker').value,
                status: document.getElementById('trouble-modal-status') ? document.getElementById('trouble-modal-status').value : '조치완료',
                image_data: currentTroubleImageBase64,
                source: modal.dataset.source || 'trouble'
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
    if (statusInput) statusInput.value = '조치완료';
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
            
            if (statusInput) statusInput.value = troubleData.status || '조치완료';
            if (workerInput) workerInput.value = troubleData.worker || '';
            
            // [수정] source 제약 없이 모든 트러블 이력 소스에 대해 진행 경과(JSON) 바인딩 수행
            if (troubleData.content) {
                let parsed = troubleData.content;
                if (typeof parsed === 'string' && parsed.startsWith('{')) {
                    try { parsed = JSON.parse(parsed); } catch(e) {}
                }
                
                if (typeof parsed === 'object' && parsed !== null) {
                    if (situationEl) situationEl.value = parsed.situation || '';
                    if (symptomEl) symptomEl.value = parsed.symptom || '';
                    if (causeEl) causeEl.value = parsed.cause || '';
                    if (actionEl) actionEl.value = parsed.action || '';
                    if (preventionEl) preventionEl.value = parsed.prevention || '';
                }
            }
            
            if (memoInput) memoInput.value = troubleData.memo || '';

            if (troubleData.image_data) {
                currentTroubleImageBase64 = troubleData.image_data;
                if (previewImg) previewImg.src = currentTroubleImageBase64;
                if (previewContainer) previewContainer.style.display = 'block';
                if (removeBtn) removeBtn.style.display = 'inline-block';
            }
            
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

    if (modal) modal.style.display = 'flex';
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
                if (matchCust) {
                    equipMain = escapeHtml(matchCust[1]);
                    equipSubHtml = `<div style="color: #58a6ff; font-size: 11px; margin-top: 2px;">[${escapeHtml(matchCust[2])}]</div>`;
                } else if (matchSerial) {
                    equipMain = escapeHtml(matchSerial[1]);
                    equipSubHtml = `<div style="color: #8b949e; font-size: 11px; margin-top: 2px;">(${escapeHtml(matchSerial[2])})</div>`;
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
                    if (parsed.situation) arr.push(`[상황] ${parsed.situation}`);
                    if (parsed.symptom) arr.push(`[증상] ${parsed.symptom}`);
                    if (parsed.cause) arr.push(`[원인] ${parsed.cause}`);
                    if (parsed.action) arr.push(`[조치] ${parsed.action}`);
                    if (parsed.prevention) arr.push(`[대책] ${parsed.prevention}`);
                    
                    // [수정] 화면에는 '트러블 상황'에 입력된 내용만 단독으로 표시 (툴팁은 전체 내용 유지)
                    displayContent = parsed.situation || '-';
                    tooltipContent = arr.join('\n');
                } catch(e) {}
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