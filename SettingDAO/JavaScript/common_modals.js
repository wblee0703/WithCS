/* ==========================================================================
   1. 일정 상세 정보 모달 (Event Detail Modal)
   ========================================================================== */

window.removeCostLabels = function(content) {
    if (!content) return '';
    let clean = content;
    const m1 = clean.match(/^\[.*?\]\s*(.*)$/);
    if (m1) clean = m1[1];
    const m2 = clean.match(/^(.*?)\s*-\s*\[.*?\]\s*(.*)$/);
    if (m2) clean = `${m2[1]} - ${m2[2]}`;
    return clean.trim();
};

window.restoreTaskSearchModal = function () {
    if (typeof cameFromTaskSearch !== 'undefined' && cameFromTaskSearch) {
        const searchModal = document.getElementById('task-search-modal');
        if (searchModal) {
            searchModal.style.display = 'flex';
            if (typeof window.doTaskSearch === 'function') window.doTaskSearch(); // 최신 데이터로 즉시 갱신
        }
        cameFromTaskSearch = false; // 플래그 리셋
    }
};

/* --- 1.1 초기화 (Setup) --- */
function setupEventDetailModal() {
    const modal = document.getElementById('event-detail-modal');
    const closeBtn = document.getElementById('btn-close-detail-modal');
    const closeFooterBtn = document.getElementById('btn-close-detail-footer');
    const completeBtn = document.getElementById('btn-complete-work');
    const cancelBtn = document.getElementById('btn-cancel-completion');
    const dateInput = document.getElementById('detail-scheduled-date');
    const moveToEquipBtn = document.getElementById('btn-move-to-equip');

    if (!modal) return;

    const closeModal = async () => {
        // [수정] 이미 작업 완료된 건은 수정을 유도하지 않고 즉시 닫기 처리함 (사용자 피드백 반영)
        if (currentDetailTarget && !currentDetailTarget.isCompleted && hasDetailUnsavedChanges()) {
            if (!confirm('저장되지 않은 변경사항이 있습니다. 저장하지 않고 닫으시겠습니까?')) {
                return;
            }
        }
        modal.style.display = 'none';
        if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (closeFooterBtn) closeFooterBtn.onclick = closeModal;

    if (completeBtn) {
        completeBtn.onclick = async () => {
            if (hasDetailUnsavedChanges()) {
                if (confirm('수정된 내용이 저장되지 않았습니다. 변경사항을 저장 후 완료 처리하시겠습니까?')) {
                    const success = await saveDetailChanges();
                    if (!success) return; // 저장 실패 시 완료 중단
                } else return; // 저장 취소 시 완료도 중단
            }
            completeScheduleWork();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = cancelScheduleCompletion;
    }

    if (moveToEquipBtn) {
        moveToEquipBtn.onclick = () => {
            if (currentDetailTarget) {
                let targetUrl = `maintenance.html?site=${encodeURIComponent(currentDetailTarget.site)}&equip=${encodeURIComponent(currentDetailTarget.equip)}`;
                if (currentDetailTarget.isCompleted && currentDetailTarget.id) {
                    targetUrl += `&logId=${currentDetailTarget.id}`;
                }
                location.href = targetUrl;
            }
        };
    }

    // detail-worker 드롭다운화
    const workerInput = document.getElementById('detail-worker');
    if (workerInput && !document.getElementById('detail-worker-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.id = 'detail-worker-wrapper';
        wrapper.className = 'log-select-wrapper';
        wrapper.style.width = '100%';
        wrapper.style.margin = '0';

        const templateContent = getTemplateContent('detail-worker-template');
        if (templateContent) {
            wrapper.appendChild(templateContent);
        }
        workerInput.parentNode.insertBefore(wrapper, workerInput);
        workerInput.type = 'hidden';

        const trigger = document.getElementById('detail-worker-trigger');
        const dropdown = document.getElementById('detail-worker-dropdown');
        const searchInput = document.getElementById('detail-worker-search');
        const listContainer = document.getElementById('detail-worker-list');
        const confirmBtn = document.getElementById('btn-detail-worker-confirm');

        const renderWorkers = async (searchTerm = '') => {
            const currentSite = currentDetailTarget ? currentDetailTarget.site : null;
            const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(currentSite) : [];
            const currentSelected = workerInput.value ? workerInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
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

            const userSite = sessionStorage.getItem('userSite') || '';
            displayWorkers.sort((a, b) => {
                const aSelected = currentSelected.includes(a.name);
                const bSelected = currentSelected.includes(b.name);
                if (aSelected && !bSelected) return -1;
                if (!aSelected && bSelected) return 1;

                const aSameSite = a.site === userSite;
                const bSameSite = b.site === userSite;
                if (aSameSite && !bSameSite) return -1;
                if (!aSameSite && bSameSite) return 1;
                return a.name.localeCompare(b.name);
            });

            if (typeof window.renderWorkerListItems === 'function') {
                window.renderWorkerListItems(listContainer, displayWorkers, currentSelected, () => {
                    updateWorkerSelection();
                });
            }
        };

        const updateWorkerSelection = () => {
            const selected = Array.from(listContainer.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
            workerInput.value = selected.join(', ');
            if (selected.length > 0) trigger.textContent = selected.join(' ');
            else trigger.textContent = '작업자 선택';
            trigger.title = selected.join(', ');

            const mdInput = document.getElementById('detail-md');
            if (mdInput) {
                mdInput.value = selected.length.toString();
            }
        };

        trigger.onclick = (e) => {
            e.stopPropagation();
            if (trigger.classList.contains('disabled')) return;
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
            dropdown.classList.toggle('show');
            if (dropdown.classList.contains('show')) renderWorkers(searchInput.value.trim());
        };
        searchInput.onclick = (e) => e.stopPropagation();
        searchInput.oninput = (e) => renderWorkers(e.target.value.trim());
        confirmBtn.onclick = (e) => { e.stopPropagation(); dropdown.classList.remove('show'); };

        workerInput.addEventListener('updateTrigger', () => {
            const val = workerInput.value;
            const arr = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
            if (arr.length > 0) trigger.textContent = arr.join(' ');
            else trigger.textContent = '작업자 선택';
            trigger.title = arr.join(', ');
        });
    }

    // [추가] 시작일시/종료일시 토글 버튼 바인딩
    const toggleTimeBtn = document.getElementById('btn-toggle-detail-time');
    if (toggleTimeBtn) {
        toggleTimeBtn.onclick = () => {
            const startRow = document.getElementById('detail-start-time-row');
            const endRow = document.getElementById('detail-end-time-row');
            if (startRow && endRow) {
                const isHidden = startRow.style.display === 'none';
                if (isHidden) {
                    startRow.style.display = 'flex';
                    endRow.style.display = 'flex';
                    toggleTimeBtn.textContent = '- 시간 제거';
                } else {
                    startRow.style.display = 'none';
                    endRow.style.display = 'none';
                    toggleTimeBtn.textContent = '+ 시간 입력';
                    // 값 리셋
                    setSplitDateTimeValues('detail-start', '');
                    setSplitDateTimeValues('detail-end', '');
                }
            }
        };
    }
}

// 24시간제 변환 헬퍼 함수
function setSplitDateTimeValues(prefix, value) {
    const dateEl = document.getElementById(`${prefix}-date`);
    const hourEl = document.getElementById(`${prefix}-hour`);
    const minEl = document.getElementById(`${prefix}-min`);

    if (!dateEl || !hourEl || !minEl) return;

    if (hourEl.children.length === 0) {
        let hourHtml = '<option value="">시</option>';
        for (let i = 0; i < 24; i++) {
            const v = String(i).padStart(2, '0');
            hourHtml += `<option value="${v}">${v}시</option>`;
        }
        hourEl.innerHTML = hourHtml;
    }
    if (minEl.children.length === 0) {
        let minHtml = '<option value="">분</option>';
        for (let i = 0; i < 60; i++) {
            const v = String(i).padStart(2, '0');
            minHtml += `<option value="${v}">${v}분</option>`;
        }
        minEl.innerHTML = minHtml;
    }

    if (!value) {
        dateEl.value = '';
        hourEl.value = '';
        minEl.value = '';
        return;
    }

    // 기존의 모든 12시간제/오염된 포맷을 표준 ISO (YYYY-MM-DDTHH:MM) 24시간제로 복원 계산 처리
    let parsedVal = value.trim();
    if (parsedVal.includes('오전') || parsedVal.includes('오후') || parsedVal.toLowerCase().includes('am') || parsedVal.toLowerCase().includes('pm')) {
        const isPm = parsedVal.includes('오후') || parsedVal.toLowerCase().includes('pm');
        const nums = parsedVal.replace(/[^0-9]/g, ' ').split(/\s+/).filter(Boolean);
        if (nums.length >= 5) {
            const y = nums[0];
            const m = nums[1].padStart(2, '0');
            const d = nums[2].padStart(2, '0');
            let hour = parseInt(nums[3]);
            const min = nums[4].padStart(2, '0');

            if (isPm && hour < 12) hour += 12;
            if (!isPm && hour === 12) hour = 0;
            parsedVal = `${y}-${m}-${d}T${String(hour).padStart(2, '0')}:${min}`;
        }
    } else if (!parsedVal.includes('T')) {
        const spaceParts = parsedVal.split(/\s+/);
        if (spaceParts.length >= 2) {
            const datePart = spaceParts[0];
            const timeParts = spaceParts[1].split(':');
            const h = timeParts[0].padStart(2, '0');
            const m = (timeParts.length > 1 ? timeParts[1] : '00').padStart(2, '0');
            parsedVal = `${datePart}T${h}:${m}`;
        }
    }

    if (parsedVal.includes('T')) {
        const parts = parsedVal.split('T');
        dateEl.value = parts[0];
        const timeParts = parts[1].split(':');
        hourEl.value = timeParts[0].substring(0, 2);
        minEl.value = timeParts.length > 1 ? timeParts[1].substring(0, 2) : '00';
    } else {
        dateEl.value = '';
        hourEl.value = '';
        minEl.value = '';
    }
}

function getSplitDateTimeValue(prefix) {
    const dateEl = document.getElementById(`${prefix}-date`);
    const hourEl = document.getElementById(`${prefix}-hour`);
    const minEl = document.getElementById(`${prefix}-min`);

    if (!dateEl || !dateEl.value) return '';
    const h = hourEl && hourEl.value ? hourEl.value : '00';
    const m = minEl && minEl.value ? minEl.value : '00';
    return `${dateEl.value}T${h}:${m}`;
}

function setSplitDateTimeDisabled(prefix, disabled) {
    const dateEl = document.getElementById(`${prefix}-date`);
    const hourEl = document.getElementById(`${prefix}-hour`);
    const minEl = document.getElementById(`${prefix}-min`);
    if (dateEl) dateEl.disabled = disabled;
    if (hourEl) hourEl.disabled = disabled;
    if (minEl) minEl.disabled = disabled;
}

/* --- 1.2 모달 열기 (Open) --- */
function openEventDetailModal(site, equip, id, isCompleted) {
    if (typeof window.checkSessionValid === 'function' && !window.checkSessionValid()) return;
    const modal = document.getElementById('event-detail-modal');
    if (!modal) return;

    currentDetailTarget = { site, equip, id, isCompleted };

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};

    let item = null;
    if (isCompleted) {
        item = data.logs ? data.logs.find(l => String(l.id) === String(id)) : null;
        if (!item && id) {
            // [추가] id가 누락된 구식 데이터 복원용 fallback 매칭 (부분 일치 비교 보완)
            const cleanId = window.removeCostLabels(String(id));
            item = data.logs ? data.logs.find(l => {
                const cleanContent = window.removeCostLabels(l.content || '');
                return cleanContent.includes(cleanId) || cleanId.includes(cleanContent) || l.memo === id;
            }) : null;
        }
    } else {
        item = data.maint ? data.maint.find(i => String(i.id) === String(id)) : null;
        if (!item && id) {
            // [추가] id가 누락된 구식 데이터 복원용 fallback 매칭 (부분 일치 비교 보완)
            const cleanId = window.removeCostLabels(String(id));
            item = data.maint ? data.maint.find(i => {
                const cleanContent = window.removeCostLabels(i.content || '');
                return cleanContent.includes(cleanId) || cleanId.includes(cleanContent) || i.code === id;
            }) : null;
        }
    }

    if (!item) {
        console.warn(`[openEventDetailModal] 상세 정보를 표시할 아이템을 찾을 수 없습니다. (Site: ${site}, Equip: ${equip}, ID/Content: ${id}, isCompleted: ${isCompleted})`);
        return;
    }

    // [추가] 모달 타이틀 변경 (추가 작업 여부에 따라)
    const modalTitle = modal.querySelector('.modal-header h3');
    if (modalTitle) {
        if (item.originalLogId) {
            modalTitle.textContent = '추가 작업 상세 정보';
        } else {
            modalTitle.textContent = '작업 상세 정보';
        }
    }

    const parts = equip.split('::');
    const rawName = parts[0];
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
    const equipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
    document.getElementById('detail-equip-info').textContent = `${site} > ${equipName}`;
    let serialText = parts.length > 1 ? parts[1] : '-';
    const custName = (data.setup && data.setup.custEquipName) ? data.setup.custEquipName : '';
    if (custName) {
        serialText += ` [${custName}]`;
    }
    document.getElementById('detail-serial-no').textContent = serialText;
    document.getElementById('detail-type').textContent = item.type || '정기';
    let displayDetailType = item.detailType;

    // [추가] 세부구분 파싱 로직 (초기값 설정용)
    // HTML 엔티티(&gt;)로 저장된 경우를 대비하여 디코딩 후 파싱합니다.
    let initialDetailType = '';
    let initialDetailType2 = '';
    if (displayDetailType) {
        const decodedDetailType = displayDetailType.replace(/&gt;/g, '>');
        if (decodedDetailType.includes(' > ')) {
            const parts = decodedDetailType.split(' > ');
            initialDetailType = parts[0].trim();
            initialDetailType2 = parts[1].trim();
        } else {
            initialDetailType = decodedDetailType;
        }
    }

    // [추가] 수정 모드용 select 요소들 미리 찾아두기
    const typeEl = document.getElementById('detail-type');
    const detailTypeEl = document.getElementById('detail-detail-type');
    let typeSelect = document.getElementById('detail-type-select');
    let detailTypeSelect = document.getElementById('detail-detail-type-select');
    let detailType2Select = document.getElementById('detail-detail-type2-select');

    // [추가] 동적으로 select 요소 생성 (최초 1회)
    if (!typeSelect && typeEl) {
        typeSelect = document.createElement('select');
        typeSelect.id = 'detail-type-select';
        typeSelect.className = 'input-dark';
        typeSelect.style.width = '120px';
        typeEl.parentNode.insertBefore(typeSelect, typeEl);
    }
    if (!detailTypeSelect && detailTypeEl) {
        const wrapper = document.createElement('div');
        wrapper.id = 'detail-detail-type-wrapper';
        wrapper.style.cssText = 'display: flex; gap: 5px; flex: 1;';
        wrapper.innerHTML = `<select id="detail-detail-type-select" class="input-dark" style="flex: 1;"></select><select id="detail-detail-type2-select" class="input-dark" style="flex: 1;"></select>`;
        detailTypeEl.parentNode.insertBefore(wrapper, detailTypeEl);
        detailTypeSelect = document.getElementById('detail-detail-type-select');
        detailType2Select = document.getElementById('detail-detail-type2-select');
    }

    if (!displayDetailType) {
        displayDetailType = (item.type === '정기') ? 'PM 점검' : '';
    }
    document.getElementById('detail-detail-type').textContent = displayDetailType;

    let displayContent = '';
    if (isCompleted) {
        displayContent = item.content || '';
    } else {
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
        let sameDayItems = [];
        if (item.originalLogId) {
            sameDayItems = data.maint.filter(i =>
                i.type === item.type &&
                (i.detailType || '') === (item.detailType || '') &&
                i.originalLogId == item.originalLogId
            );
        } else if (item.type === '비정기') {
            sameDayItems = data.maint.filter(i => i.id == item.id);
        } else {
            sameDayItems = data.maint.filter(i =>
                i.scheduledDate === item.scheduledDate &&
                i.type === item.type &&
                (i.detailType || '') === (item.detailType || '') &&
                !i.originalLogId
            );
        }
        const contentArr = [];
        sameDayItems.forEach(i => {
            const items = window.splitSafetyContent(i.content);
            const itemCosts = i.itemCost ? i.itemCost.split(',').map(s => s.trim()) : (i.item_cost ? i.item_cost.split(',').map(s => s.trim()) : []);
            
            items.forEach((itemText, idx) => {
                let itemDisplay = i.code ? i.code : '';
                let costVal = itemCosts[idx] || '';

                if (!costVal && itemCosts[0]) {
                    let cleanPart = itemText.trim();
                    const kwMatch = cleanPart.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                    if (kwMatch) cleanPart = kwMatch[2].trim();

                    const isPart = adminItems.some(ai => {
                        const p = (ai.part || '').trim();
                        const c = (ai.code || '').trim();
                        return (p && p === cleanPart) || (c && c === cleanPart);
                    });
                    if (isPart) {
                        costVal = itemCosts[0];
                    }
                }
                
                const kwMatch = itemText.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                if (kwMatch) {
                    if (!itemDisplay) itemDisplay = kwMatch[2].trim();
                    if (costVal) itemDisplay = `[${costVal}] ${itemDisplay}`;
                    itemText = `${kwMatch[1].trim()} - ${itemDisplay}`;
                } else {
                    if (!itemDisplay) itemDisplay = itemText;
                    // 물품 관리에 등록된 부품일 때만 비용 라벨을 결합
                    const cleanItem = itemDisplay.trim();
                    const isRegisteredPart = adminItems.some(ai => {
                        const p = (ai.part || '').trim();
                        const c = (ai.code || '').trim();
                        return (p && p === cleanItem) || (c && c === cleanItem);
                    });
                    if (costVal && isRegisteredPart) {
                        itemDisplay = `[${costVal}] ${itemDisplay}`;
                    }
                    itemText = itemDisplay;
                }
                
                const specStr = i.spec ? ` [${i.spec}]` : '';
                contentArr.push(`${itemText}${specStr}`);
            });
        });
        displayContent = [...new Set(contentArr)].join(', ');
    }

    const contentEl = document.getElementById('detail-content');
    contentEl.dataset.rawContent = displayContent; // 원본 데이터 저장
    const itemsArr = window.splitSafetyContent(displayContent);

    // [수정] 텍스트 모드로 표시할 때 불필요한 비용 태그 제거
    const cleanItemsArr = itemsArr.map(s => window.removeCostLabels(s));

    // [개선] 화면에 표시할 때는 부품 접미사(예: - SOMA-EK23-1102 등)를 제거하고 대표 점검구분 라벨만 노출
    // 단, 정기 작업일 경우에는 대표 접두사 라벨을 제거하고 순수 물품명만 노출합니다.
    const displayLabelsArr = cleanItemsArr.map(s => {
        let temp = s.trim();
        const prefixMatch = temp.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|파츠 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
        if (prefixMatch) {
            if (item.type === '정기') {
                return prefixMatch[2].trim();
            }
            return prefixMatch[1].trim();
        }
        return temp;
    });

    if (displayLabelsArr.length > 1) {
        contentEl.innerText = `${displayLabelsArr[0]} 외 ${displayLabelsArr.length - 1}개`;
        contentEl.title = displayLabelsArr.join('\n');
    } else if (displayLabelsArr.length === 1) {
        contentEl.innerText = displayLabelsArr[0];
        contentEl.title = displayLabelsArr[0];
    } else {
        contentEl.innerText = '내용 없음';
        contentEl.title = '';
    }

    const workerInput = document.getElementById('detail-worker');
    const mdInput = document.getElementById('detail-md');
    const memoInput = document.getElementById('detail-work-memo');
    const dateRow = document.getElementById('detail-date-row');
    const costTypeInput = document.getElementById('detail-cost-type');
    const completeBtn = document.getElementById('btn-complete-work');
    const detailTypeWrapper = document.getElementById('detail-detail-type-wrapper');

    // [수정] UI 요소 초기화
    if (typeSelect) typeSelect.style.display = 'none';
    if (detailTypeWrapper) detailTypeWrapper.style.display = 'none';
    if (typeEl) typeEl.style.display = 'inline';
    if (detailTypeEl) detailTypeEl.style.display = 'inline';


    const contentDiv = document.getElementById('detail-content');
    const contentInput = document.getElementById('detail-content-input');
    const cancelBtn = document.getElementById('btn-cancel-completion');

    // [수정] 1. 이동 버튼을 장비 정보 옆으로 위치 이동
    const moveToEquipBtn = document.getElementById('btn-move-to-equip');
    const equipInfoEl = document.getElementById('detail-equip-info');
    if (equipInfoEl && moveToEquipBtn && equipInfoEl.nextSibling !== moveToEquipBtn) {
        equipInfoEl.parentNode.insertBefore(moveToEquipBtn, equipInfoEl.nextSibling);
    }

    // [수정] 4. 메모 영역 라벨 아래에 입력창 배치 (세로 정렬)
    if (memoInput) {
        const memoRow = memoInput.closest('.form-row') || memoInput.closest('.detail-row');
        if (memoRow) {
            memoRow.style.flexDirection = 'column';
            memoRow.style.alignItems = 'stretch';
            memoRow.style.gap = '0'; // [추가] 세로 배치 시 불필요한 gap 제거
            const memoLabel = memoRow.querySelector('.modal-label') || memoRow.querySelector('.detail-label');
            if (memoLabel) {
                memoLabel.style.setProperty('flex', 'none', 'important');
                memoLabel.style.setProperty('width', '100%', 'important');
                memoLabel.style.setProperty('text-align', 'left', 'important');
                memoLabel.style.paddingTop = '0';
                memoLabel.style.marginBottom = '5px';
            }
        }
    }

    let issueShareWrapper = document.getElementById('detail-issue-share-wrapper');
    if (!issueShareWrapper && memoInput) {
        issueShareWrapper = document.createElement('div');
        issueShareWrapper.id = 'detail-issue-share-wrapper';
        issueShareWrapper.style.marginTop = '5px';
        issueShareWrapper.style.display = 'flex';
        issueShareWrapper.style.alignItems = 'center';
        const templateContent = getTemplateContent('detail-issue-share-template');
        if (templateContent) {
            issueShareWrapper.appendChild(templateContent);
        } else {
            issueShareWrapper.innerHTML = `
                    <label class="modal-checkbox-label" style="font-size: 13px; font-weight: bold; color: #f0883e; display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="detail-issue-share-checkbox" class="modal-checkbox-input" style="margin-right: 5px; transform: scale(1.2);">
                        이슈 공유
                    </label>
                `;
        }
        memoInput.parentNode.insertBefore(issueShareWrapper, memoInput.nextSibling);
    }
    const issueShareCb = document.getElementById('detail-issue-share-checkbox');

    // UI 초기화 (수정 모드 해제)
    if (contentDiv) contentDiv.style.display = 'block';
    if (contentInput) contentInput.style.display = 'none';

    const dropdownWrapper = document.getElementById('detail-content-dropdown-wrapper');
    if (dropdownWrapper) dropdownWrapper.remove();

    // 완료, 미완료 관계없이 폼 필드 활성화
    workerInput.value = item.worker || (!isCompleted ? (localStorage.getItem('lastWorkerName') || sessionStorage.getItem('userId') || '') : '');
    workerInput.disabled = false;
    const trigger = document.getElementById('detail-worker-trigger');
    if (trigger) {
        trigger.classList.remove('disabled');
        trigger.style.opacity = '1';
        trigger.style.cursor = 'pointer';
    }

    if (costTypeInput) {
        costTypeInput.value = item.costType || '';
        costTypeInput.disabled = false;
    }

    memoInput.value = item.memo || '';
    if (!isCompleted && !item.memo) {
        let lastMemo = '';
        if (data.logs && data.logs.length > 0) {
            const validLogs = data.logs.filter(l => l.detailType !== '일정변경');
            const sortedLogs = [...validLogs].sort((a, b) => {
                if (b.date !== a.date) return b.date.localeCompare(a.date);
                return b.id - a.id;
            });
            if (sortedLogs.length > 0) lastMemo = sortedLogs[0].memo || '';
        }
        memoInput.value = lastMemo;
    }
    memoInput.disabled = false;

    if (mdInput) {
        let displayMd = item.md || '';
        if (!isCompleted && !displayMd && item.scheduledDate) {
            let sameDayItems = [];
            if (item.originalLogId) {
                sameDayItems = data.maint.filter(i => i.type === item.type && (i.detailType || '') === (i.detailType || '') && i.originalLogId == item.originalLogId);
            } else if (item.type === '비정기') {
                sameDayItems = data.maint.filter(i => i.id == item.id);
            } else {
                sameDayItems = data.maint.filter(i => i.scheduledDate === item.scheduledDate && i.type === item.type && (i.detailType || '') === (item.detailType || '') && !i.originalLogId);
            }
            const itemWithMd = sameDayItems.find(i => i.md);
            if (itemWithMd) displayMd = itemWithMd.md;
        }
        mdInput.value = displayMd;
        mdInput.disabled = false;

        mdInput.oninput = function () {
            const workerHidden = document.getElementById('detail-worker');
            const workerCount = workerHidden && workerHidden.value ? workerHidden.value.split(',').map(s => s.trim()).filter(Boolean).length : 0;
            const currentMd = parseFloat(this.value);
            if (!isNaN(currentMd) && currentMd > workerCount) {
                alert(`공수(M/D)는 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
                this.value = workerCount;
            }
        };
    }

    dateRow.style.display = 'flex';
    const dateField = document.getElementById('detail-scheduled-date');
    dateField.value = isCompleted ? (item.date || '') : (item.scheduledDate || '');
    dateField.disabled = false;

    // 분할형 24시간제 필드값 설정 및 활성화
    setSplitDateTimeValues('detail-start', item.startTime || '');
    setSplitDateTimeValues('detail-end', item.endTime || '');
    setSplitDateTimeDisabled('detail-start', false);
    setSplitDateTimeDisabled('detail-end', false);

    // [추가] 시작일시/종료일시가 기록되어 있으면 보이게, 없으면 숨김 기본값 설정
    const startRow = document.getElementById('detail-start-time-row');
    const endRow = document.getElementById('detail-end-time-row');
    const toggleTimeBtn = document.getElementById('btn-toggle-detail-time');
    if (startRow && endRow && toggleTimeBtn) {
        const hasTimeVal = (item.startTime && item.startTime.trim()) || (item.endTime && item.endTime.trim());
        if (hasTimeVal) {
            startRow.style.display = 'flex';
            endRow.style.display = 'flex';
            toggleTimeBtn.textContent = '- 시간 제거';
        } else {
            startRow.style.display = 'none';
            endRow.style.display = 'none';
            toggleTimeBtn.textContent = '+ 시간 입력';
        }
    }

    if (isCompleted) {
        completeBtn.style.display = 'none';
        if (cancelBtn) {
            if (item.detailType === '일정변경') cancelBtn.style.display = 'none';
            else cancelBtn.style.display = 'block';
        }
        typeEl.textContent = item.type || '정기';
        detailTypeEl.textContent = displayDetailType;
        workerInput.disabled = true;
        if (trigger) {
            trigger.classList.add('disabled');
            trigger.style.opacity = '0.6';
            trigger.style.pointerEvents = 'none';
        }
        memoInput.disabled = true;
        if (mdInput) mdInput.disabled = true;
        if (costTypeInput) costTypeInput.disabled = true;
        dateField.disabled = true;
        if (issueShareCb) issueShareCb.disabled = true;
        // 완료 상태라도 시작일시/종료일시는 상시 수정 가능하도록 disabled=true 비활성화 처리 해제
        setSplitDateTimeDisabled('detail-start', false);
        setSplitDateTimeDisabled('detail-end', false);
    } else {
        completeBtn.style.display = 'block';
        completeBtn.textContent = '작업 완료';
        if (cancelBtn) cancelBtn.style.display = 'none';

        // [추가] 미완료(예정) 작업일 때 구분/세부구분 편집 가능하도록 드롭다운으로 변경
        if (typeEl) typeEl.style.display = 'none';
        if (detailTypeEl) detailTypeEl.style.display = 'none';
        if (typeSelect) typeSelect.style.display = 'inline-block';
        if (detailTypeWrapper) detailTypeWrapper.style.display = 'flex';

        const categories = ['정기', '비정기', '고객대응', '용액제조', '온라인점검'];
        typeSelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
        typeSelect.value = item.type || '정기';

        const updateDetailType2s = () => {
            const selectedType = typeSelect.value;
            const selectedDetailType = detailTypeSelect.value;
            if (selectedType !== '비정기' || !selectedDetailType) {
                if (detailType2Select) detailType2Select.style.display = 'none';
                buildDetailDropdown(item, site, equip);
                return;
            }
            if (detailType2Select) detailType2Select.style.display = 'inline-block';
            
            const equipKey = equip;
            const catData2 = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
            const key2 = `${equipKey}::${selectedType}::${selectedDetailType}`;
            const defaultSubCategories2 = {
                'Alarm': ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람'],
                'Hunting': ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅'],
                'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈'],
                '기타': ['배수 펌프 이슈', '구동 이상']
            };
            let subCategories2 = catData2[key2] || (defaultSubCategories2[selectedDetailType] || []);
            
            detailType2Select.innerHTML = subCategories2.map(s => `<option value="${s}">${s}</option>`).join('');
            buildDetailDropdown(item, site, equip);
        };

        const updateDetailTypes = () => {
            const selectedType = typeSelect.value;
            const equipKey = equip;
            const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
            const key = `${equipKey}::${selectedType}`;
            const defaultSubCategories = {
                '정기': ['PM 점검'],
                '비정기': ['Alarm', 'Hunting', 'Data / Para 이상', '기타'],
                '고객대응': ['순회 점검', '프로그램 변경 / 평가', '설비 평가', 'Parts 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '파티클 필터 교체', '기타'],
                '용액제조': ['용액제조'],
                '온라인점검': ['온라인점검']
            };
            let subCategories = catData[key] && catData[key].length > 0 ? catData[key] : defaultSubCategories[selectedType] || [];
            
            detailTypeSelect.innerHTML = subCategories.map(s => `<option value="${s}">${s}</option>`).join('');
            
            if (selectedType === '비정기') {
                updateDetailType2s();
            } else {
                if (detailType2Select) detailType2Select.style.display = 'none';
                buildDetailDropdown(item, site, equip);
            }
        };

        typeSelect.onchange = updateDetailTypes;
        detailTypeSelect.onchange = updateDetailType2s;
        detailType2Select.onchange = () => buildDetailDropdown(item, site, equip);

        updateDetailTypes();

        if (Array.from(detailTypeSelect.options).some(opt => opt.value === initialDetailType)) {
            detailTypeSelect.value = initialDetailType;
            if (typeSelect.value === '비정기') {
                updateDetailType2s();
                if (Array.from(detailType2Select.options).some(opt => opt.value === initialDetailType2)) {
                    detailType2Select.value = initialDetailType2;
                }
            }
        }

        workerInput.disabled = false;
        if (trigger) {
            trigger.classList.remove('disabled');
            trigger.style.opacity = '1';
            trigger.style.pointerEvents = 'auto';
        }
        memoInput.disabled = false;
        if (mdInput) mdInput.disabled = false;
        if (costTypeInput) costTypeInput.disabled = false;
        dateField.disabled = false;
        if (issueShareCb) {
            const userRole = sessionStorage.getItem('userRole');
            issueShareCb.disabled = (userRole !== 'admin' && userRole !== 'superadmin');
        }
    }

    if (issueShareCb) {
        issueShareCb.checked = !!item.isIssueShared;
        const userRole = sessionStorage.getItem('userRole');
        issueShareCb.disabled = isCompleted || (userRole !== 'admin' && userRole !== 'superadmin');
    }

    if (workerInput) workerInput.dispatchEvent(new Event('updateTrigger'));

    buildDetailDropdown(item, site, equip);

    if (isCompleted) {
        const contentTrigger = document.getElementById('detail-content-dropdown-wrapper')?.querySelector('.log-select-trigger');
        if (contentTrigger) {
            contentTrigger.classList.add('disabled');
            contentTrigger.style.pointerEvents = 'none';
        }
        const partTrigger = document.getElementById('detail-edit-part-trigger');
        if (partTrigger) {
            partTrigger.classList.add('disabled');
            partTrigger.style.pointerEvents = 'none';
        }
        if (contentInput) contentInput.disabled = true;
    } else {
        if (contentInput) contentInput.disabled = false;
    }

    let currentContentStr = '';
    let initialExpandedDropdownValues = [];
    const dWrapper = document.getElementById('detail-content-dropdown-wrapper');
    if (dWrapper) {
        const list = dWrapper.querySelector('.log-select-list') || dWrapper;
        const selected = list.querySelectorAll('.log-select-item.selected');
        const baseVals = Array.from(selected).map(el => {
            const cSel = el.querySelector('.item-cost-select');
            return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
        });

        let partContentList = [];
        const pWrapper = document.getElementById('detail-edit-part-wrapper');
        if (pWrapper && pWrapper.style.display !== 'none') {
            const pList = document.getElementById('detail-edit-part-list');
            if (pList) {
                const selectedParts = pList.querySelectorAll('.log-select-item.selected');
                partContentList = Array.from(selectedParts).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                });
            }
        }

        baseVals.forEach(val => {
            let baseCost = '유상';
            const bMatch = val.match(/^\[(.*?)\] (.*)$/);
            if (bMatch) { baseCost = bMatch[1]; val = bMatch[2]; }

            const isPartKeyword = val.includes('파트 이상 교체') || val.includes('파트 이상 수리') || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
            if (isPartKeyword && partContentList.length > 0) {
                partContentList.forEach(p => {
                    initialExpandedDropdownValues.push(`${val} - ${p}`);
                });
            } else if (isPartKeyword) {
                initialExpandedDropdownValues.push(val);
            } else {
                initialExpandedDropdownValues.push(`[${baseCost}] ${val}`);
            }
        });
        currentContentStr = initialExpandedDropdownValues.join(', ');
    } else {
        const inputVal = document.getElementById('detail-content-input').value.trim();
        if (inputVal) initialExpandedDropdownValues.push(inputVal);
        currentContentStr = initialExpandedDropdownValues.join(', ');
    }
    if (!currentContentStr) currentContentStr = '내용 없음';

    // [추가] 변경 감지를 위해 모달 오픈 시점의 초기 상태 저장
    window.initialEventDetail = {
        worker: workerInput ? workerInput.value.trim() : '',
        md: mdInput ? mdInput.value.trim() : '',
        memo: memoInput ? memoInput.value.trim() : '',
        date: dateField.value,
        issueShared: issueShareCb ? issueShareCb.checked : false,
        content: currentContentStr,
        costType: costTypeInput ? costTypeInput.value : '',
        type: item.type || '정기',
        detailType: displayDetailType || '',
        startTime: item.startTime || '',
        endTime: item.endTime || ''
    };

    // [추가] 연관된 추가 작업 건수 비동기 조회 및 버튼 제어
    const additionalWorksBtn = document.getElementById('btn-show-additional-works');
    if (additionalWorksBtn) {
        additionalWorksBtn.style.display = 'none'; // 기본 숨김
        // [수정] 모바일 화면 버튼 그룹 정렬을 위해 부모의 has-additional-work 클래스 기본 제거
        const btnGroup = additionalWorksBtn.parentElement;
        if (btnGroup) {
            btnGroup.classList.remove('has-additional-work');
        }
        const queryId = item.originalLogId || id;
        if (queryId) {
            fetch(`/api/maintenance/additional-works?parent_id=${encodeURIComponent(queryId)}`, {
                headers: { 'X-CSRFToken': getCookie('csrf_token') }
            })
            .then(res => res.json())
            .then(resData => {
                if (resData.status === 'success' && resData.data && resData.data.length > 0) {
                    additionalWorksBtn.style.display = 'inline-block';
                    additionalWorksBtn.textContent = `추가작업 확인 (${resData.data.length})`;
                    // [수정] 추가작업 확인 버튼이 표시되므로 부모에 클래스 부여 (모바일 2행 배치 활성화)
                    if (btnGroup) {
                        btnGroup.classList.add('has-additional-work');
                    }
                    additionalWorksBtn.onclick = () => {
                        if (typeof window.openExtraWorkHistoryModal === 'function') {
                            window.openExtraWorkHistoryModal(site, equip, queryId);
                        }
                    };
                }
            })
            .catch(err => console.error('Failed to load additional works:', err));
        }
    }

    // [추가] 작업 구분이 비정기이고 작업 완료 상태이면 'Trouble 이력 작성' 버튼 노출
    const troubleHistoryBtn = document.getElementById('btn-create-trouble-history');
    if (troubleHistoryBtn) {
        // [수정] 모바일 화면 버튼 그룹 정렬을 위해 부모의 has-trouble-history 클래스 기본 제거
        const btnGroup = troubleHistoryBtn.parentElement;
        if (btnGroup) {
            btnGroup.classList.remove('has-trouble-history');
        }
        if (isCompleted && item.type === '비정기') {
            troubleHistoryBtn.style.display = 'inline-block';
            // [수정] Trouble 이력 작성 버튼이 노출되므로 부모에 클래스 부여
            if (btnGroup) {
                btnGroup.classList.add('has-trouble-history');
            }
            troubleHistoryBtn.onclick = () => {
                const targetUrl = `trouble.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}`;
                location.href = targetUrl;
            };
        } else {
            troubleHistoryBtn.style.display = 'none';
        }
    }

    // [추가] '추가작업 생성' 버튼 노출 및 동작 바인딩
    const createAddWorkBtn = document.getElementById('btn-create-additional-work');
    if (createAddWorkBtn) {
        if (isCompleted) {
            createAddWorkBtn.style.display = 'inline-block';
            createAddWorkBtn.onclick = () => {
                modal.style.display = 'none';
                const parentId = item.originalLogId || id;
                const logDate = item.date || item.scheduledDate || new Date().toISOString().split('T')[0];
                if (typeof window.openRegisterScheduleModal === 'function') {
                    const presetData = { 
                        type: item.type || '비정기', 
                        detailType: item.detailType || '', 
                        detailType2: item.detailType2 || '', 
                        content: '', 
                        worker: item.worker || '' 
                    };
                    window.currentSearchFilters = { site: site, equip: equip };
                    window.currentAddWorkLogId = parentId;
                    window.openRegisterScheduleModal(logDate, presetData);
                } else if (typeof window.openAddWorkModal === 'function') {
                    window.openAddWorkModal(parentId, logDate);
                } else {
                    sessionStorage.setItem('openAddWorkForLog', JSON.stringify({ site: site, equip: equip, logId: parentId }));
                    location.href = `maintenance.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}`;
                }
            };
        } else {
            createAddWorkBtn.style.display = 'none';
        }
    }

    modal.style.display = 'flex';
}



/* --- 1.3 UI 및 데이터 헬퍼 (UI & Helpers) --- */
function buildDetailDropdown(item, site, equip) {
    const contentDiv = document.getElementById('detail-content');
    const contentInput = document.getElementById('detail-content-input');

    if (contentInput) {
        const row = contentInput.closest('.form-row') || contentInput.closest('.detail-row');
        if (row) {
            const label = row.querySelector('.modal-label') || row.querySelector('.detail-label');
            if (label && label.textContent.includes('점검 항목')) {
                label.textContent = '내용';
            }
        }
    }

    // [수정] 혹시 모를 중복 ID 충돌을 방지하기 위해 모든 기존 래퍼를 확실하게 지워줍니다.
    document.querySelectorAll('#detail-content-flex-container').forEach(el => el.remove());
    document.querySelectorAll('#detail-content-dropdown-wrapper').forEach(el => el.remove());
    document.querySelectorAll('#detail-edit-part-wrapper').forEach(el => el.remove());
    document.querySelectorAll('#detail-display-list-wrapper').forEach(el => el.remove());

    // [수정] UI에 드롭다운이 렌더링되어 있으면 값을 우선 사용하여, 구분/세부구분 변경 시 제안박스 항목이 갱신되도록 처리
    const typeSelect = document.getElementById('detail-type-select');
    const detailTypeSelect = document.getElementById('detail-detail-type-select');
    const detailType2Select = document.getElementById('detail-detail-type2-select');
    const detailTypeWrapper = document.getElementById('detail-detail-type-wrapper');

    let type = item.type || '정기';
    if (typeSelect && typeSelect.style.display !== 'none') type = typeSelect.value;

    let detailTypeFull = item.detailType || (type === '정기' ? 'PM 점검' : '');
    if (detailTypeWrapper && detailTypeWrapper.style.display !== 'none' && detailTypeSelect) {
        detailTypeFull = detailTypeSelect.value;
        if (type === '비정기' && detailType2Select && detailType2Select.style.display !== 'none') {
            detailTypeFull += ` > ${detailType2Select.value}`;
        }
    }

    let detailType = detailTypeFull;
    let detailType2 = '';

    if (detailTypeFull.includes('[')) {
        const parts = detailTypeFull.split('[');
        detailType = parts[0].trim();
        detailType2 = parts[1].replace(']', '').trim();
    } else if (detailTypeFull.includes(' > ')) {
        const parts = detailTypeFull.split(' > ');
        detailType = parts[0].trim();
        detailType2 = parts[1].trim();
    }

    let currentContent = contentDiv.dataset.rawContent || contentDiv.innerText.trim();
    if (currentContent === '내용 없음') currentContent = '';

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    const itemsArr = window.splitSafetyContent(currentContent);
    let baseItems = [];
    let partItems = [];
    const partKeywords = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'];

    itemsArr.forEach(item => {
        const match = item.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
        if (match) {
            let prefix = match[1].trim();
            let suffix = match[2].replace(/^[\s-]+/, '').trim();

            let cost = '';
            const innerCostMatch = suffix.match(/^\[(.*?)\]\s*(.*)$/);
            if (innerCostMatch) {
                cost = innerCostMatch[1];
                suffix = innerCostMatch[2];
            }

            const costMatch = prefix.match(/^\[(.*?)\]\s*(.*)$/);
            if (costMatch) {
                cost = costMatch[1];
                prefix = costMatch[2];
            }

            baseItems.push(prefix);
            if (suffix) {
                if (cost) partItems.push(`[${cost}] ${suffix}`);
                else partItems.push(suffix);
            }
        } else {
            // [개선] 만약 detailType이 PM 점검/Parts 교체이고 품명만 단독으로 입력된 경우, '파트 이상 교체' 접두사 폴백 매핑
            let cleanItem = item.trim();
            let cost = '';
            const costMatch = cleanItem.match(/^\[(.*?)\]\s*(.*)$/);
            if (costMatch) {
                cost = costMatch[1];
                cleanItem = costMatch[2];
            }

            const isPartOnly = adminItems.some(ai => {
                const p = (ai.part || '').trim();
                const c = (ai.code || '').trim();
                return (p && p === cleanItem) || (c && c === cleanItem);
            });

            if (isPartOnly && type !== '정기' && detailType !== 'PM 점검' && detailType !== 'Parts 교체' && detailType !== '설비 정상화') {
                baseItems.push('파트 이상 교체');
                if (cost) partItems.push(`[${cost}] ${cleanItem}`);
                else partItems.push(cleanItem);
            } else {
                baseItems.push(item);
            }
        }
    });
    baseItems = [...new Set(baseItems)];

    let baseContent = baseItems.join(', ');
    let partContentStr = partItems.join(', ');

    const currentValues = window.splitSafetyContent(baseContent).filter(s => s !== '내용 없음');
    const selectedMap = {};
    currentValues.forEach(val => {
        let itemCost = '유상';
        const costMatch = val.match(/^\[(.*?)\] (.*)$/);
        if (costMatch) {
            itemCost = costMatch[1];
            val = costMatch[2];
        }
        const innerCostMatch = val.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
        if (innerCostMatch) {
            itemCost = innerCostMatch[2];
            val = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
        }
        selectedMap[val] = itemCost;
    });

    // [추가] 하위 부품들의 개별 비용처리(partItems) 정보도 selectedMap에 동일하게 매핑하여 상세정보 복원 정합성 유지
    partItems.forEach(val => {
        let itemCost = '유상';
        const costMatch = val.match(/^\[(.*?)\] (.*)$/);
        if (costMatch) {
            itemCost = costMatch[1];
            val = costMatch[2];
        }
        const innerCostMatch = val.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
        if (innerCostMatch) {
            itemCost = innerCostMatch[2];
            val = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
        }
        selectedMap[val] = itemCost;
    });

    const equipKey = equip;
    const itemData = JSON.parse(localStorage.getItem('check_type_items')) || {};
    let chkKey = (type === '비정기') ? `${equipKey}::${type}::${detailType}::${detailType2}` : `${equipKey}::${type}::${detailType}`;
    let availableItems = itemData[chkKey] || [];
    // adminItems는 함수 상단(라인 937 부근)에서 이미 선언되었으므로 재선언 없이 재사용합니다.

    // 드롭다운 모드 활성화 여부 판단 플래그
    let isDropdownMode = false;
    if (availableItems.length > 0) isDropdownMode = true;

    if (availableItems.length === 0) {
        if (type === '비정기' && ['Alarm', 'Hunting', 'Data / Para 이상', '기타'].includes(detailType)) {
            isDropdownMode = true;
            const defaultList = [
                "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
                "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
            ];
            availableItems = defaultList.map(content => ({ content: content }));
        } else if (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) {
            isDropdownMode = true;
            const equipName = equipKey.split('::')[0];
            let matchedItems = adminItems.filter(ai => {
                if (!ai.equip) return false;
                const equips = ai.equip.split(',').map(e => e.trim());
                return equips.includes(equipName);
            });
            if (matchedItems.length === 0) matchedItems = adminItems;
            availableItems = matchedItems.map(mItem => ({ content: mItem.part, code: mItem.code }));
        }
    }

    const uniqueItems = [];
    const seenContents = new Set();

    Object.keys(selectedMap).forEach(content => {
        let code = '';
        let realContent = content;
        const match = adminItems.find(a => a.part === content || a.code === content);
        if (match) {
            code = match.code || '';
            realContent = match.part || content;
            const displayValue = code ? code : realContent;
            if (!seenContents.has(displayValue)) {
                seenContents.add(displayValue);
                uniqueItems.push({ content: realContent, code: code });
            }
        }
    });

    availableItems.forEach(ai => {
        let code = ai.code;
        let realContent = ai.content;
        const match = adminItems.find(a => a.part === realContent || a.code === realContent);
        
        // defaultList (현장 이슈, PC 이상 등)은 물품 관리에 없을 수 있으므로 예외 허용
        const isDefaultItem = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상", "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"].includes(realContent);
        
        if (match || isDefaultItem) {
            if (match) {
                code = match.code || code;
                realContent = match.part || realContent;
            }
            const displayValue = code ? code : realContent;
            if (!seenContents.has(displayValue)) {
                seenContents.add(displayValue);
                uniqueItems.push({ content: realContent, code: code });
            }
        }
    });

    if (detailType && isDropdownMode) {
        contentDiv.style.display = 'none';
        contentInput.style.display = 'none';

        flexContainer = document.createElement('div');
        flexContainer.id = 'detail-content-flex-container';
        flexContainer.style.display = 'flex';
        flexContainer.style.flexDirection = 'column';
        flexContainer.style.gap = '10px';
        flexContainer.style.width = '100%';
        flexContainer.style.alignItems = 'stretch';
        contentInput.parentNode.insertBefore(flexContainer, contentInput.nextSibling);

        dropdownWrapper = document.createElement('div');
        dropdownWrapper.id = 'detail-content-dropdown-wrapper';
        dropdownWrapper.className = 'log-select-wrapper';
        dropdownWrapper.style.width = '100%';
        dropdownWrapper.style.minWidth = '0';

        const templateContent = getTemplateContent('edit-content-dropdown-template');
        if (templateContent) dropdownWrapper.appendChild(templateContent);

        const trigger = dropdownWrapper.querySelector('.log-select-trigger');
        const dropdown = dropdownWrapper.querySelector('.log-select-dropdown');
        const searchInput = dropdownWrapper.querySelector('.dropdown-search-input');
        const list = dropdownWrapper.querySelector('.log-select-list');
        const addBtn = dropdownWrapper.querySelector('.btn-blue-sm');

        let initialText = '항목 선택';
        if (currentValues.length > 1) {
            initialText = `${currentValues[0]} 외 ${currentValues.length - 1}개`;
            trigger.classList.remove('multi-line');
            trigger.style.color = '#fff';
        } else if (currentValues.length === 1) {
            initialText = currentValues[0];
            trigger.classList.remove('multi-line');
            trigger.style.color = '#fff';
        } else {
            trigger.style.color = '#8b949e';
        }
        trigger.innerText = initialText;
        trigger.title = currentValues.join('\n');

        const poolMap = new Map();
        let registeredSet = new Set();

        const maintKey = `details_${site}_${equip}`;
        const maintData = JSON.parse(localStorage.getItem(maintKey)) || {};
        if (maintData.maint) {
            const processRegistered = (m) => {
                if (m.originalLogId || m.content === '내용 없음' || m.content === '장비 점검' || !m.content) return;
                if (['고객대응', '용액제조', '온라인점검'].includes(m.type)) {
                    if (!(type === '고객대응' && detailType === '설비 정상화' && m.type === '고객대응' && m.detailType === '설비 정상화')) {
                        return;
                    }
                }

                let pureContent = m.content;

                // [추가] 오염된 텍스트 정제 (비용 태그 등)
                const costMatch = pureContent.match(/^\[(.*?)\]\s*(.*)$/);
                if (costMatch) pureContent = costMatch[2];
                pureContent = pureContent.replace(/\[(유상|무상|기타)\]/g, '').trim();
                pureContent = pureContent.replace(/\[(유상|무상[^\]]*|기타)\]/g, '').trim();
                pureContent = pureContent.replace(/\s*-\s*$/, '').trim();

                const partKeywords = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '물품 이상 교체', '물품 이상 수리', '파트 이상 (교체)', '파츠 이상 교체', '파트 이상', '파츠 이상'];
                if (partKeywords.some(kw => pureContent === kw || pureContent.endsWith(kw))) return;

                for (const keyword of partKeywords) {
                    const idx = pureContent.indexOf(keyword);
                    if (idx !== -1) {
                        pureContent = pureContent.substring(idx + keyword.length).replace(/^[\s-]+/, '');
                        break;
                    }
                }
                if (!pureContent) return;

                const partsArray = window.splitSafetyContent(pureContent);
                partsArray.forEach(pText => {
                    let actualPart = pText;
                    const innerCostMatch = actualPart.match(/^\[(.*?)\]\s*(.*)$/);
                    if (innerCostMatch) actualPart = innerCostMatch[2];

                    if (!actualPart) return;

                    const extracted = typeof window.extractSpecFromContent === 'function' ? window.extractSpecFromContent(actualPart) : { spec: '', pureContent: actualPart };
                    let spec = extracted.spec || m.spec || '';
                    actualPart = extracted.pureContent;

                    const nonPartKeywords = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "프로그램 이상", "단순조치", "기타"];
                    if (nonPartKeywords.includes(actualPart) || partKeywords.some(kw => actualPart === kw || actualPart.startsWith(kw + ' - '))) return;

                    let code = '';
                    let partno = '';
                    const match = adminItems.find(a => a.part === actualPart || a.code === actualPart);
                    if (match) {
                        code = match.code || '';
                        partno = match.partno || '';
                    }

                    const baseName = code || actualPart;
                    const specStr = spec ? ` [${spec}]` : '';
                    const displayValue = `${baseName}${specStr}`;
                    registeredSet.add(displayValue);

                    if (!poolMap.has(displayValue)) {
                        poolMap.set(displayValue, {
                            content: actualPart,
                            code: code,
                            partno: partno,
                            spec: spec,
                            displayValue: displayValue
                        });
                    }
                });
            };

        if (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) {
                maintData.maint.forEach(processRegistered);
            } else {
                maintData.maint.filter(m => m.type === type && (m.detailType || '') === (detailType || '')).forEach(processRegistered);
            }
        }

        uniqueItems.forEach(i => {
            if (!i.content) return;
            const baseName = i.code || i.content;
            let partno = '';
            const match = adminItems.find(a => a.part === i.content || a.code === i.content);
            if (match) partno = match.partno || '';

            if (!poolMap.has(baseName)) {
                poolMap.set(baseName, { content: i.content, code: i.code, partno: partno, spec: '', displayValue: baseName });
            }
        });

        if (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) {
            const allAdminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            allAdminItems.forEach(a => {
                if (!a.part) return;
                const baseName = a.code || a.part;
                if (!poolMap.has(baseName)) {
                    poolMap.set(baseName, { content: a.part, code: a.code, partno: a.partno || '', spec: '', displayValue: baseName });
                }
            });
        }

        let poolItems = Array.from(poolMap.values());

        let registeredItems = [];
        let otherItems = [];

        poolItems.forEach(item => {
            const val = item.displayValue;
            if (registeredSet.has(val) || selectedMap.hasOwnProperty(val)) {
                registeredItems.push(item);
            } else {
                otherItems.push(item);
            }
        });

        let showAll = registeredItems.length === 0;
        const currentSelections = { ...selectedMap };
        // [추가] 상단 내용 드롭다운에는 물품(부품)이 선택된 항목으로 표시되지 않도록, 마스터 물품에 해당하는 키들은 강제 제외
        const allAdminItemsForClean = JSON.parse(localStorage.getItem('admin_items')) || [];
        Object.keys(currentSelections).forEach(selKey => {
            let cleanKey = selKey.replace(/^\[.*?\]\s*/, '').trim();
            const specMatch = cleanKey.match(/\s*\[(.*?)\]$/);
            if (specMatch) {
                cleanKey = cleanKey.replace(specMatch[0], '').trim();
            }
            const isPart = allAdminItemsForClean.some(ai => {
                const p = (ai.part || '').trim();
                const c = (ai.code || '').trim();
                return (p && p === cleanKey) || (c && c === cleanKey);
            });
            if (type === '비정기' && isPart) {
                delete currentSelections[selKey];
            }
        });

        const renderDropdownItems = (searchTerm = '') => {
            list.querySelectorAll('.log-select-item').forEach(el => {
                const val = el.dataset.value;
                if (el.classList.contains('selected')) {
                    const cSel = el.querySelector('.item-cost-select');
                    currentSelections[val] = cSel ? cSel.value : '유상';
                } else {
                    delete currentSelections[val];
                }
            });

            let displayItems = showAll ? [...registeredItems, ...otherItems] : registeredItems;

            if (searchTerm) {
                const kws = searchTerm.toLowerCase().split(/\s+/);
                displayItems = [...registeredItems, ...otherItems].filter(item => {
                    const txt = `${item.displayValue || ''} ${item.partno || ''}`.toLowerCase();
                    return kws.every(kw => txt.includes(kw));
                });
            }

            const displayItemValues = new Set(displayItems.map(i => i.displayValue));
            Object.keys(currentSelections).forEach(selectedValue => {
                if (!displayItemValues.has(selectedValue)) {
                    const originalItem = [...registeredItems, ...otherItems].find(i => i.displayValue === selectedValue);
                    if (originalItem) {
                        displayItems.unshift(originalItem);
                    } else {
                        displayItems.unshift({ content: selectedValue, code: '', spec: '', displayValue: selectedValue });
                    }
                }
            });

            list.innerHTML = '';
            if (displayItems.length === 0) {
                list.innerHTML = '<div class="log-select-empty-msg" style="padding: 10px; color:#8b949e; text-align:center;">검색 결과가 없습니다.</div>';
            } else {
                displayItems.forEach(item => {
                    const val = item.displayValue;
                    const isSelected = currentSelections.hasOwnProperty(val);
                    const itemCost = isSelected ? currentSelections[val] : '유상';

                    const templateId = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) ? 'log-part-item-template' : 'detail-content-item-template';
                    const tpl = getTemplateContent(templateId);
                    if (tpl) {
                        const div = tpl.querySelector('.log-select-item');
                        if (isSelected) div.classList.add('selected');
                        div.dataset.value = val;

                        const itemNameEl = div.querySelector('.item-name');
                        itemNameEl.innerHTML = `<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(val)}</span>`;
                        itemNameEl.style.display = 'flex';
                        itemNameEl.style.alignItems = 'center';

                        if (!item.spec && templateId === 'log-part-item-template') {
                            const addSpecBtn = document.createElement('button');
                            addSpecBtn.innerHTML = '＋';
                            addSpecBtn.style.cssText = 'margin-left: 5px; background: #0d1117; border: 1px solid #3fb950; color: #3fb950; border-radius: 4px; padding: 0 4px; font-size: 14px; font-weight: bold; cursor: pointer; flex-shrink: 0; line-height: 1; position: relative; z-index: 10;';
                            addSpecBtn.title = '물품 상세 추가';
                            addSpecBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
                            addSpecBtn.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (typeof window.openAddPartSpecModal === 'function') {
                                    window.openAddPartSpecModal(site, equip, item, (newItem) => {
                                        const newDisplayValue = newItem.code ? `${newItem.code} [${newItem.spec}]` : `${newItem.content} [${newItem.spec}]`;

                                        registeredItems.unshift({
                                            content: newItem.content,
                                            code: newItem.code,
                                            partno: item.partno || '',
                                            spec: newItem.spec,
                                            displayValue: newDisplayValue
                                        });
                                        registeredSet.add(newDisplayValue);
                                        currentSelections[newDisplayValue] = '유상';

                                        if (searchInput) searchInput.value = '';
                                        renderDropdownItems();
                                        updateTriggerText();
                                    });
                                }
                            };
                            itemNameEl.appendChild(addSpecBtn);
                        }

                        const cSel = div.querySelector('.item-cost-select');
                        if (cSel) {
                            const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
                            if (isPartKeyword) {
                                cSel.remove();
                            } else {
                                cSel.value = itemCost;
                                cSel.addEventListener('click', e => e.stopPropagation());
                                cSel.addEventListener('change', (e) => {
                                    e.stopPropagation();
                                    if (div.classList.contains('selected')) updateTriggerText();
                                });
                            }
                        }

                        div.addEventListener('pointerdown', (e) => {
                            if (e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (type === '비정기') {
                                list.querySelectorAll('.log-select-item.selected').forEach(el => {
                                    if (el !== div) el.classList.remove('selected');
                                });
                            }
                            div.classList.toggle('selected');
                            updateTriggerText();
                            if (type === '비정기' && div.classList.contains('selected')) {
                                dropdown.classList.remove('show');
                            }

                            const pWrapper = document.getElementById('detail-edit-part-wrapper');
                            if (pWrapper) {
                                const selectedItems = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
                                const isPartIssue = type !== '정기' && selectedItems.some(v => v.match(/(파트|물품) 이상\s*\(?(교체|수리)\)?/) || v.includes('용액 용자 이상') || v.includes('용액 / 용자 이상'));
                                const pList = document.getElementById('detail-edit-part-list');

                                pWrapper.style.display = isPartIssue ? 'flex' : 'none';

                                if (isPartIssue && pList && typeof window.renderLogPartOptions === 'function') {
                                    window.renderLogPartOptions('detail-edit-part-wrapper', 'detail-edit-part-trigger', 'detail-edit-part-list', 'detail-edit-part-search', partContentStr);
                                }
                            }
                        });
                        list.appendChild(div);
                    }
                });
            }

            if (!showAll && !searchTerm && otherItems.length > 0) {
                const moreBtn = document.createElement('button');
                moreBtn.className = 'show-all-btn';
                moreBtn.innerHTML = '⬇️ 더보기 (전체 물품)';
                moreBtn.type = 'button';
                moreBtn.addEventListener('pointerdown', (e) => {
                    e.preventDefault(); e.stopPropagation(); showAll = true; renderDropdownItems(searchInput.value);
                });
                list.appendChild(moreBtn);
            }

            const updateTriggerText = () => {
                const selected = list.querySelectorAll('.log-select-item.selected');
                const values = Array.from(selected).map(el => el.dataset.value); // [수정] 트리거 텍스트는 내용만
                if (values.length > 1) {
                    trigger.innerText = `${values[0]} 외 ${values.length - 1}개`;
                    trigger.classList.remove('multi-line');
                    trigger.style.color = '#fff';
                } else if (values.length === 1) {
                    trigger.innerText = values[0];
                    trigger.classList.remove('multi-line');
                    trigger.style.color = '#fff';
                } else {
                    trigger.innerText = '항목 선택';
                    trigger.classList.remove('multi-line');
                    trigger.style.color = '#8b949e';
                }
                trigger.title = values.join('\n');
                if (typeof window.updateDetailDisplayList === 'function') window.updateDetailDisplayList();
            };
        };

        searchInput.oninput = (e) => { renderDropdownItems(e.target.value.trim()); };
        renderDropdownItems();
        dropdown.insertBefore(list, dropdown.querySelector('.log-select-footer'));

        addBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropdown.classList.remove('show');
        });
        if (type === '비정기') { addBtn.parentElement.style.display = 'none'; }

        trigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
            dropdown.classList.toggle('show');
        };

        flexContainer.appendChild(dropdownWrapper);

        const pWrapper = document.createElement('div');
        pWrapper.className = 'form-row';
        pWrapper.id = 'detail-edit-part-wrapper';
        pWrapper.style.display = 'none';

        const pLabel = document.createElement('div');
        pLabel.className = 'modal-label';
        pLabel.textContent = '세부 내용';
        pLabel.style.color = '#8b949e'; // 다른 라벨과 동일한 회색 계열 적용
        pWrapper.appendChild(pLabel);

        const pInner = document.createElement('div');
        pInner.style.flex = '1';
        pInner.style.minWidth = '0';
        const templateContent2 = getTemplateContent('detail-edit-part-wrapper-template');
        if (templateContent2) {
            pInner.appendChild(templateContent2);
        } else {
            // [추가] 템플릿 로드 실패 시 강제 생성 (세부 내용 드롭다운 안 나오는 버그 완벽 해결)
            pInner.innerHTML = `
                <div class="log-select-wrapper" style="width: 100%; margin: 0; position: relative;">
                    <div id="detail-edit-part-trigger" class="log-select-trigger" style="min-height:34px; display:flex; align-items:center; background:#0d1117; color:#8b949e; border:1px solid #30363d; border-radius:4px; padding:6px 10px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;">물품 선택</div>
                    <div id="detail-edit-part-dropdown" class="log-select-dropdown" style="width:100%; position:absolute; top:100%; left:0; z-index:1000; margin-top:4px; background:#161b22; border:1px solid #30363d; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5); box-sizing:border-box;">
                        <input type="text" id="detail-edit-part-search" class="dropdown-search-input" placeholder="검색..." style="width: calc(100% - 12px); margin: 5px 6px; padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; color: #e6edf3; border-radius: 4px; box-sizing: border-box;" autocomplete="off">
                        <div id="detail-edit-part-list" class="log-select-list" style="max-height: 200px; overflow-y: auto; padding: 8px;"></div>
                        <div class="log-select-footer" style="padding: 8px; border-top: 1px solid #30363d; background: #21262d; display: flex;">
                            <button type="button" id="btn-detail-edit-part-add" class="btn-blue-sm" style="flex: 1; width: 100%;">선택 완료</button>
                        </div>
                    </div>
                </div>
            `;
        }
        pWrapper.appendChild(pInner);

        // [수정] '세부 내용'을 별도의 행으로 분리하여 '내용' 행 아래에 위치시킴
        const parentRow = contentInput.closest('.form-row') || contentInput.closest('.detail-row');
        if (parentRow && parentRow.parentNode) {
            parentRow.parentNode.insertBefore(pWrapper, parentRow.nextSibling);
        }

        const pTrigger = pWrapper.querySelector('#detail-edit-part-trigger');
        const pDropdown = pWrapper.querySelector('#detail-edit-part-dropdown');
        const pAddBtn = pWrapper.querySelector('#btn-detail-edit-part-add') || pWrapper.querySelector('.btn-blue-sm');

        if (pTrigger && pDropdown) {
            pTrigger.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (pTrigger.classList.contains('disabled')) return;
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== pDropdown) d.classList.remove('show'); });
                pDropdown.classList.toggle('show');
            });
            pTrigger.addEventListener('click', (e) => e.stopPropagation());

            pDropdown.addEventListener('pointerdown', (e) => e.stopPropagation());
            pDropdown.addEventListener('click', (e) => e.stopPropagation());

            const pSearch = pDropdown.querySelector('.dropdown-search-input');
            if (pSearch) {
                pSearch.addEventListener('pointerdown', (e) => e.stopPropagation());
                pSearch.addEventListener('click', (e) => e.stopPropagation());
            }
        }

        if (pAddBtn && pDropdown) {
            pAddBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                pDropdown.classList.remove('show');
            });
            pAddBtn.addEventListener('click', (e) => e.stopPropagation());
        }

        const hasPartIssue = type !== '정기' && currentValues.some(val => val.includes('파트 이상 교체') || val.includes('파트 이상 수리') || val.includes('파트 이상 (교체)') || val.includes('파트 이상 (수리)') || val.includes('용액 / 용자 이상') || val.includes('용액 용자 이상'));
        pWrapper.style.display = hasPartIssue ? 'flex' : 'none';
        if (hasPartIssue && typeof window.renderLogPartOptions === 'function') {
            window.renderLogPartOptions('detail-edit-part-wrapper', 'detail-edit-part-trigger', 'detail-edit-part-list', 'detail-edit-part-search', partContentStr);
        }
    } else {
        contentInput.value = baseContent;
        contentDiv.style.display = 'none';
        contentInput.style.display = 'block';
    }

    let displayListWrapper = document.getElementById('detail-display-list-wrapper');
    if (!displayListWrapper) {
        displayListWrapper = document.createElement('div');
        displayListWrapper.id = 'detail-display-list-wrapper';
        displayListWrapper.style.marginTop = '0px';
        displayListWrapper.style.padding = '10px';
        displayListWrapper.style.background = '#161b22';
        displayListWrapper.style.border = '1px solid #30363d';
        displayListWrapper.style.borderRadius = '4px';
        displayListWrapper.style.fontSize = '13px';
        displayListWrapper.style.color = '#c9d1d9';

        const parentContainer = contentInput.closest('.form-row') || contentInput.closest('.detail-row') || contentInput.parentNode;
        const partWrapper = document.getElementById('detail-edit-part-wrapper');
        const insertAfterTarget = partWrapper || parentContainer;
        if (insertAfterTarget && insertAfterTarget.parentNode) {
            insertAfterTarget.parentNode.insertBefore(displayListWrapper, insertAfterTarget.nextSibling);
        }
    }

    displayListWrapper.style.minHeight = '40px';
    displayListWrapper.style.maxHeight = '250px';
    displayListWrapper.style.overflowY = 'auto';
    displayListWrapper.style.flexShrink = '0';
    displayListWrapper.style.width = '100%';
    displayListWrapper.style.boxSizing = 'border-box';

    window.updateDetailDisplayList = () => {
        const dWrapper = document.getElementById('detail-content-dropdown-wrapper');
        const pWrapperLocal = document.getElementById('detail-edit-part-wrapper');
        let baseVals = [];

        if (dWrapper) {
            const selected = dWrapper.querySelectorAll('.log-select-item.selected');
            baseVals = Array.from(selected).map(el => {
                const cSel = el.querySelector('.item-cost-select');
                return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
            });
        }

        let partValsStr = '';
        if (pWrapperLocal && pWrapperLocal.style.display !== 'none') {
            const pList = document.getElementById('detail-edit-part-list');
            if (pList) {
                const pSelected = pList.querySelectorAll('.log-select-item.selected');
                partValsStr = Array.from(pSelected).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                }).join(', ');
            }
        }

        let allVals = [];
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
        baseVals.forEach(val => {
            let baseCost = '유상';
            const bMatch = val.match(/^\[(.*?)\] (.*)$/);
            if (bMatch) { baseCost = bMatch[1]; val = bMatch[2]; }

            // [추가] val 자체가 등록된 물품인 경우, 세부 정보 박스에 단독 표출되는 것을 차단
            const isRegisteredPart = adminItems.some(ai => {
                const p = (ai.part || '').trim();
                const c = (ai.code || '').trim();
                return (p && p === val) || (c && c === val);
            });
            if (type !== '정기' && detailType !== 'PM 점검' && detailType !== 'Parts 교체' && detailType !== '설비 정상화' && isRegisteredPart) return;

            const isPartKeyword = type !== '정기' && (val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상'));
            if (isPartKeyword && partValsStr) {
                const pArr = partValsStr.split(',').map(s => s.trim()).filter(Boolean);
                // [수정] 대표 점검구분명(val)과 함께 추가된 부품(p)명 및 비용처리 형식을 세부리스트에 노출되도록 처리 (중복 방지)
                pArr.forEach(p => {
                    const combined = `${val} - ${p}`;
                    if (!allVals.includes(combined)) {
                        allVals.push(combined);
                    }
                });
            } else if (isPartKeyword) {
                if (!allVals.includes(val)) {
                    allVals.push(val);
                }
            } else {
                const costVal = `[${baseCost}] ${val}`;
                if (!allVals.includes(costVal)) {
                    allVals.push(costVal);
                }
            }
        });

        // [수정] 디스플레이 리스트 텍스트 정제 및 중복 제거
        let cleanVals = allVals.map(val => {
            let cleanV = val;
            const m1 = cleanV.match(/^\[.*?\]\s*(.*)$/);
            if (m1 && type !== '정기' && detailType !== 'PM 점검' && detailType !== 'Parts 교체' && detailType !== '설비 정상화') cleanV = m1[1];
            // [수정] '파트 이상 교체 - [비용처리] 물품명'의 형태여야 하므로 뒤쪽 부품의 비용처리를 제거하는 m2 정제 로직을 제외합니다.
            // const m2 = cleanV.match(/^(.*?)\s*-\s*\[.*?\]\s*(.*)$/);
            // if (m2) cleanV = `${m2[1]} - ${m2[2]}`;
            return cleanV;
        });
        cleanVals = [...new Set(cleanVals)];

        if (cleanVals.length > 1) {
            displayListWrapper.style.display = 'block';
            displayListWrapper.innerHTML = cleanVals.map(v => `<div style="margin-bottom:4px; word-break:keep-all;">• ${escapeHtml(v)}</div>`).join('');
            const parentContainer = contentInput.closest('.form-row') || contentInput.closest('.detail-row') || contentInput.parentNode;
            if (parentContainer) parentContainer.style.marginBottom = '';
        } else {
            displayListWrapper.style.display = 'none';
            displayListWrapper.innerHTML = '';
            const parentContainer = contentInput.closest('.form-row') || contentInput.closest('.detail-row') || contentInput.parentNode;
            if (parentContainer) parentContainer.style.marginBottom = '';
        }
    };

    window.updateDetailDisplayList();
}

function hasDetailUnsavedChanges() {
    if (!currentDetailTarget || !window.initialEventDetail) return false;

    const currentWorker = document.getElementById('detail-worker').value.trim();
    const currentMd = document.getElementById('detail-md').value.trim();
    const currentMemo = document.getElementById('detail-work-memo').value.trim();
    const currentDate = document.getElementById('detail-scheduled-date').value;
    const currentCostType = document.getElementById('detail-cost-type') ? document.getElementById('detail-cost-type').value : '';
    const issueShareCb = document.getElementById('detail-issue-share-checkbox');
    const currentIssueShared = issueShareCb ? issueShareCb.checked : false;
    const currentStartTime = getSplitDateTimeValue('detail-start');
    const currentEndTime = getSplitDateTimeValue('detail-end');

    const typeSelect = document.getElementById('detail-type-select');
    const detailTypeSelect = document.getElementById('detail-detail-type-select');
    const detailType2Select = document.getElementById('detail-detail-type2-select');

    let currentType = window.initialEventDetail.type || '정기';
    if (typeSelect && typeSelect.style.display !== 'none') currentType = typeSelect.value;

    let currentDetailType = window.initialEventDetail.detailType || '';
    if (detailTypeSelect && detailTypeSelect.style.display !== 'none') {
        currentDetailType = detailTypeSelect.value;
        if (currentType === '비정기' && detailType2Select && detailType2Select.style.display !== 'none' && detailType2Select.value) {
            currentDetailType += ` > ${detailType2Select.value}`;
        }
    }

    let currentContent = '';
    let expandedDropdownValues = [];
    const dropdownWrapper = document.getElementById('detail-content-dropdown-wrapper');
    if (dropdownWrapper) {
        const list = dropdownWrapper.querySelector('.log-select-list');
        const selected = list.querySelectorAll('.log-select-item.selected');
        const baseVals = Array.from(selected).map(el => {
            const cSel = el.querySelector('.item-cost-select');
            return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
        });

        let partContentList = [];
        const pWrapper = document.getElementById('detail-edit-part-wrapper');
        if (pWrapper && pWrapper.style.display !== 'none') {
            const pList = document.getElementById('detail-edit-part-list');
            if (pList) {
                const selectedParts = pList.querySelectorAll('.log-select-item.selected');
                partContentList = Array.from(selectedParts).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                });
            }
        }

        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
        baseVals.forEach(val => {
            let baseCost = '유상';
            const bMatch = val.match(/^\[(.*?)\] (.*)$/);
            if (bMatch) { baseCost = bMatch[1]; val = bMatch[2]; }

            // [추가] val 자체가 등록된 물품인 경우, 단독으로 추가되는 것을 차단
            const isRegisteredPart = adminItems.some(ai => {
                const p = (ai.part || '').trim();
                const c = (ai.code || '').trim();
                return (p && p === val) || (c && c === val);
            });
            if (currentType === '비정기' && isRegisteredPart) return;

            const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
            if (isPartKeyword && partContentList.length > 0) {
                partContentList.forEach(p => {
                    expandedDropdownValues.push(`${val} - ${p}`);
                });
            } else if (isPartKeyword) {
                expandedDropdownValues.push(val);
            } else {
                expandedDropdownValues.push(`[${baseCost}] ${val}`);
            }
        });
        currentContent = expandedDropdownValues.join(', ');
    } else {
        const inputVal = document.getElementById('detail-content-input').value.trim();
        if (inputVal) expandedDropdownValues.push(inputVal);
        currentContent = expandedDropdownValues.join(', ');
    }
    if (!currentContent) currentContent = '내용 없음';

    return currentWorker !== window.initialEventDetail.worker ||
        currentMd !== window.initialEventDetail.md ||
        currentMemo !== window.initialEventDetail.memo ||
        currentDate !== window.initialEventDetail.date ||
        currentContent !== window.initialEventDetail.content ||
        currentIssueShared !== window.initialEventDetail.issueShared ||
        currentCostType !== window.initialEventDetail.costType ||
        currentType !== window.initialEventDetail.type ||
        currentDetailType !== window.initialEventDetail.detailType ||
        currentStartTime !== window.initialEventDetail.startTime ||
        currentEndTime !== window.initialEventDetail.endTime;
}

async function saveDetailChanges() {
    const { site, equip, id, isCompleted } = currentDetailTarget;
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    let item = null;
    if (isCompleted) {
        item = data.logs ? data.logs.find(i => String(i.id) === String(id)) : null;
    } else {
        item = data.maint ? data.maint.find(i => String(i.id) === String(id)) : null;
    }
    if (!item) return true;

    const newWorker = document.getElementById('detail-worker').value.trim();
    const newMd = document.getElementById('detail-md').value.trim();
    const newMemo = document.getElementById('detail-work-memo').value.trim();
    const newDate = document.getElementById('detail-scheduled-date').value;
    const newStart = getSplitDateTimeValue('detail-start');
    const newEnd = getSplitDateTimeValue('detail-end');
    let newType = item.type;
    let newDetailType = item.detailType || '';

    if (newStart && newEnd) {
        if (new Date(newStart) > new Date(newEnd)) {
            alert('시작 일시는 종료 일시보다 늦을 수 없습니다.\n입력하신 시간을 다시 확인해주세요.');
            return false;
        }
    }

    if (!isCompleted) {
        const typeSelect = document.getElementById('detail-type-select');
        const detailTypeSelect = document.getElementById('detail-detail-type-select');
        const detailType2Select = document.getElementById('detail-detail-type2-select');

        if (typeSelect) newType = typeSelect.value;
        if (detailTypeSelect) {
            newDetailType = detailTypeSelect.value;
            if (newType === '비정기' && detailType2Select && detailType2Select.style.display !== 'none' && detailType2Select.value) {
                newDetailType += ` > ${detailType2Select.value}`;
            }
        }
    }
    const newCostType = document.getElementById('detail-cost-type') ? document.getElementById('detail-cost-type').value : '';
    if (!newDate) { alert('날짜를 선택해주세요.'); return false; }

    const workerCount = newWorker ? newWorker.split(',').map(s => s.trim()).filter(Boolean).length : 0;
    if (parseFloat(newMd) > workerCount) {
        alert(`입력된 공수(${newMd})가 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
        document.getElementById('detail-md').value = workerCount;
        return false;
    }

    let expandedDropdownValues = [];
    const dropdownWrapper = document.getElementById('detail-content-dropdown-wrapper');
    if (dropdownWrapper) {
        const list = dropdownWrapper.querySelector('.log-select-list');
        const selected = list.querySelectorAll('.log-select-item.selected');
        const baseDropdownValues = Array.from(selected).map(el => {
            const cSel = el.querySelector('.item-cost-select');
            return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
        });

        const pWrapper = document.getElementById('detail-edit-part-wrapper');
        let partContentList = [];
        if (pWrapper && pWrapper.style.display !== 'none') {
            const pList = document.getElementById('detail-edit-part-list');
            if (pList) {
                const selectedParts = pList.querySelectorAll('.log-select-item.selected');
                partContentList = Array.from(selectedParts).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                });
            }
            if (partContentList.length === 0) { alert('교체/수리할 물품을 선택해주세요.'); return false; }
        }

        baseDropdownValues.forEach(val => {
            let baseCost = '유상';
            const bMatch = val.match(/^\[(.*?)\] (.*)$/);
            if (bMatch) { baseCost = bMatch[1]; val = bMatch[2]; }

            // [추가] val 자체가 등록된 물품이거나 규격 찌꺼기인 경우, 단독으로 추가되는 것을 차단
            let cleanVal = window.removeCostLabels(val);
            const valSpecMatch = cleanVal.match(/\s*\[(.*?)\]$/);
            if (valSpecMatch) {
                cleanVal = cleanVal.replace(valSpecMatch[0], '').trim();
            }
            const isRegisteredPart = adminItems.some(ai => {
                const p = (ai.part || '').trim();
                const c = (ai.code || '').trim();
                return (p && p === cleanVal) || (c && c === cleanVal);
            });
            const isSpecOnly = (!cleanVal && valSpecMatch);
            if (newType === '비정기' && (isRegisteredPart || isSpecOnly)) return;

            const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
            if (isPartKeyword && partContentList.length > 0) {
                partContentList.forEach(p => {
                    expandedDropdownValues.push(`${val} - ${p}`);
                });
            } else if (isPartKeyword) {
                expandedDropdownValues.push(val);
            } else {
                expandedDropdownValues.push(`[${baseCost}] ${val}`);
            }
        });
    } else {
        const inputVal = document.getElementById('detail-content-input').value.trim();
        if (inputVal) expandedDropdownValues.push(inputVal);
    }

    const targetDate = newDate;
    let remainingIds = [];
    // adminItems는 위(라인 1831 부근)에서 이미 선언되었으므로 재사용합니다.

    let payload = { maint_upserts: [], log_upserts: [] };
    let finalContentStr = '';

    let reason = undefined;
    let needsReason = false;
    if (!isCompleted && item.scheduledDate && item.scheduledDate !== targetDate) {
        const [y, m] = item.scheduledDate.split('-').map(Number);
        const confs = JSON.parse(localStorage.getItem('calendar_confirmations')) || {};
        const yyyyMm = `${y}-${String(m).padStart(2, '0')}`;
        const monthConf = confs[yyyyMm];

        if (monthConf) {
            const isGlobalConfirmed = monthConf.count !== undefined;
            const isSiteConfirmed = monthConf[site] !== undefined || (monthConf.siteCounts && monthConf.siteCounts[site] !== undefined);

            if (isGlobalConfirmed || isSiteConfirmed) {
                needsReason = true;
                reason = prompt(`[${yyyyMm} 예정 확정됨]\n해당 월은 일정이 확정된 상태입니다.\n일정 변경 사유를 입력해주세요:`);
                if (reason === null) {
                    document.getElementById('detail-scheduled-date').value = item.scheduledDate;
                    return false;
                }
            }
        }
    }

    const generateDateChangeLog = (changedItem, oldDate, idxOffset = 0) => {
        if (needsReason && oldDate && oldDate !== targetDate) {
            const actualReason = (reason && reason.trim()) ? reason.trim() : '사유 미입력';
            const now = new Date();
            const modifyTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const uDept = sessionStorage.getItem('userDepartment') || '';
            const uPos = sessionStorage.getItem('userPosition') || '';
            const uName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
            const workerInfo = (uDept || uPos) ? `${uName} (${uDept} ${uPos})`.trim() : uName;

            if (!data.logs) data.logs = [];
            const newLog = {
                id: Date.now() + Math.floor(Math.random() * 10000) + idxOffset,
                date: oldDate,
                type: changedItem.type || '정기',
                detailType: '일정변경',
                detailType2: '',
                content: `[변경] ${changedItem.code ? changedItem.code : changedItem.content}`,
                costType: changedItem.costType || '',
                md: '0',
                worker: workerInfo,
                memo: `[일정 변경 사유]\n${actualReason}\n\n[변경 내역]\n기존: ${oldDate}\n변경: ${targetDate}\n\n[수정 일시 및 작업자]\n${modifyTime} / ${workerInfo}`
            };
            data.logs.push(newLog);
            payload.log_upserts.push(newLog);
        }

        if (oldDate && oldDate.substring(0, 7) !== targetDate.substring(0, 7)) {
            if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, targetDate, 1);
        }
    };

    if (isCompleted) {
        if (expandedDropdownValues.length > 0) {
            finalContentStr = [...new Set(expandedDropdownValues)].join(', ');
        }
        if (!finalContentStr) finalContentStr = '내용 없음';

        if (!dropdownWrapper) {
            finalContentStr = document.getElementById('detail-content-input').value.trim();
            if (!finalContentStr) finalContentStr = '내용 없음';
        }
        let finalMemo = newMemo.replace(/\n?\[추가 파트\].*$/m, '').trim();

        item.date = targetDate;
        item.worker = newWorker;
        item.memo = finalMemo;
        item.md = newMd;
        item.content = finalContentStr;
        item.costType = newCostType;
        item.startTime = newStart;
        item.endTime = newEnd;

        const targetParentId = item.originalLogId || item.id;
        const issueShareCb = document.getElementById('detail-issue-share-checkbox');
        const newIssueShared = issueShareCb ? issueShareCb.checked : false;

        data.logs.forEach(l => {
            let isModified = false;
            if (l.id == item.id) {
                // [수정] 완료 로그의 핵심 정보들도 동기화하여 변경사항이 유실되지 않도록 완벽 보완
                l.date = targetDate;
                l.worker = newWorker;
                l.memo = finalMemo;
                l.md = newMd;
                l.content = finalContentStr;
                l.costType = newCostType;
                l.startTime = newStart;
                l.endTime = newEnd;
                isModified = true;
            }
            if (l.id == targetParentId || l.originalLogId == targetParentId) {
                if (!!l.isIssueShared !== newIssueShared) {
                    l.isIssueShared = newIssueShared;
                    isModified = true;
                }
            }
            if (isModified && !payload.log_upserts.some(item => item.id == l.id)) {
                payload.log_upserts.push(l);
            }
        });

    } else {
        let sameDayItems = [];
        if (item.originalLogId) {
            sameDayItems = data.maint.filter(m => m.type === item.type && (m.detailType || '') === (item.detailType || '') && m.originalLogId == item.originalLogId);
        } else if (item.type === '비정기') {
            sameDayItems = data.maint.filter(m => m.id == item.id);
        } else {
            sameDayItems = data.maint.filter(m => m.scheduledDate === item.scheduledDate && m.type === item.type && (m.detailType || '') === (item.detailType || '') && !m.originalLogId);
        }

        if (expandedDropdownValues.length > 0) {
            if (newType === '비정기') {
                // 비정기 작업일 경우: 개별 물품으로 분리(쪼개기)하지 않고 단 1개의 결합 내용으로 저장하여 쪼개짐 방지
                let combinedContentArray = [];
                let combinedCodeArray = [];
                let combinedSpecArray = [];
                let combinedCostArray = [];

                expandedDropdownValues.forEach((val) => {
                    let itemCost = '';
                    const costMatch = val.match(/^\[(.*?)\] (.*)$/);
                    if (costMatch) { itemCost = costMatch[1]; val = costMatch[2]; }

                    const innerCostMatch = val.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
                    if (innerCostMatch) {
                        if (!itemCost) itemCost = innerCostMatch[2];
                        val = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
                    }

                    let keywordPart = '';
                    let pureContent = val;
                    const kwMatch = pureContent.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                    if (kwMatch) {
                        keywordPart = kwMatch[1].trim();
                        pureContent = kwMatch[2].trim();
                    }

                    let spec = '';
                    const specMatch = pureContent.match(/\s*\[(.*?)\]$/);
                    if (specMatch) {
                        spec = specMatch[1];
                        pureContent = pureContent.replace(specMatch[0], '');
                    }

                    let code = '';
                    let fullContent = pureContent;
                    const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                    if (match) { code = match.code || ''; fullContent = match.part || pureContent; }

                    if (keywordPart) {
                        fullContent = `${keywordPart} - ${fullContent}`;
                    }

                    combinedContentArray.push(fullContent);
                    if (code) combinedCodeArray.push(code);
                    if (spec) combinedSpecArray.push(spec);
                    if (itemCost) combinedCostArray.push(itemCost);
                });

                const finalContent = combinedContentArray.join(', ');
                const finalCode = Array.from(new Set(combinedCodeArray)).join(', ');
                const finalSpec = Array.from(new Set(combinedSpecArray)).join(', ');
                const finalItemCost = Array.from(new Set(combinedCostArray)).join(', ');

                let existingItem = sameDayItems[0];
                if (!existingItem) {
                    existingItem = data.maint.find(m =>
                        m.type === item.type &&
                        (m.detailType || '') === (item.detailType || '') &&
                        m.originalLogId == item.originalLogId &&
                        (!m.scheduledDate || m.scheduledDate === targetDate)
                    );
                }

                if (existingItem) {
                    const oldDate = existingItem.scheduledDate;
                    existingItem.type = newType;
                    existingItem.detailType = newDetailType;
                    existingItem.scheduledDate = targetDate;
                    existingItem.worker = newWorker;
                    existingItem.memo = newMemo;
                    existingItem.md = newMd;
                    existingItem.costType = newCostType;
                    existingItem.itemCost = finalItemCost;
                    existingItem.content = finalContent;
                    existingItem.code = finalCode;
                    existingItem.spec = finalSpec;
                    remainingIds.push(existingItem.id);
                    payload.maint_upserts.push(existingItem);
                    generateDateChangeLog(existingItem, oldDate, 0);
                } else {
                    const newId = Date.now() + Math.floor(Math.random() * 10000);
                    const newItem = {
                        id: newId,
                        type: newType,
                        detailType: newDetailType,
                        code: finalCode,
                        content: finalContent,
                        spec: finalSpec,
                        date: "",
                        period: null,
                        scheduledDate: targetDate,
                        worker: newWorker,
                        memo: newMemo,
                        md: newMd,
                        itemCost: finalItemCost,
                        costType: newCostType,
                        originalLogId: item.originalLogId
                    };
                    data.maint.push(newItem);
                    remainingIds.push(newId);
                    payload.maint_upserts.push(newItem);
                }
                finalContentStr = finalContent;
            } else {
                // 비정기 외 작업(정기 등)은 기존 방식대로 각 부품별 쪼개어 개별 예정 관리
                expandedDropdownValues.forEach((val, idx) => {
                    let itemCost = '';
                    const costMatch = val.match(/^\[(.*?)\] (.*)$/);
                    if (costMatch) { itemCost = costMatch[1]; val = costMatch[2]; }

                    const innerCostMatch = val.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
                    if (innerCostMatch) {
                        if (!itemCost) itemCost = innerCostMatch[2];
                        val = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
                    }

                    let keywordPart = '';
                    let pureContent = val;
                    const kwMatch = pureContent.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
                    if (kwMatch) {
                        keywordPart = kwMatch[1].trim();
                        pureContent = kwMatch[2].trim();
                    }

                    let spec = '';
                    const specMatch = pureContent.match(/\s*\[(.*?)\]$/);
                    if (specMatch) {
                        spec = specMatch[1];
                        pureContent = pureContent.replace(specMatch[0], '');
                    }

                    let code = '';
                    let fullContent = pureContent;
                    let period = null;
                    const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                    if (match) { code = match.code || ''; fullContent = match.part || pureContent; period = match.cycle || null; }

                    if (keywordPart && newType !== '정기') {
                        fullContent = `${keywordPart} - ${fullContent}`;
                    }

                    let existingItem = sameDayItems.find(m =>
                        (m.content === fullContent || m.content === pureContent || (m.code && code && m.code === code)) &&
                        (m.spec || '') === (spec || '')
                    );

                    if (!existingItem) {
                        existingItem = data.maint.find(m =>
                            m.type === item.type &&
                            (m.detailType || '') === (item.detailType || '') &&
                            m.originalLogId == item.originalLogId &&
                            (m.content === fullContent || m.content === pureContent || (m.code && code && m.code === code)) &&
                            (m.spec || '') === (spec || '') &&
                            (!m.scheduledDate || m.scheduledDate === targetDate)
                        );
                    }

                    if (existingItem) {
                        const oldDate = existingItem.scheduledDate;
                        existingItem.type = newType;
                        existingItem.detailType = newDetailType;
                        existingItem.scheduledDate = targetDate;
                        existingItem.worker = newWorker;
                        existingItem.memo = newMemo;
                        existingItem.md = newMd;
                        existingItem.costType = newCostType;
                        if (itemCost) existingItem.itemCost = itemCost;
                        existingItem.content = fullContent;
                        remainingIds.push(existingItem.id);
                        payload.maint_upserts.push(existingItem);
                        generateDateChangeLog(existingItem, oldDate, idx);
                    } else {
                        const newId = Date.now() + Math.floor(Math.random() * 10000) + idx;
                        const newItem = { id: newId, type: newType, detailType: newDetailType, code: code, content: fullContent, spec: spec, date: "", period: (newType === '정기' ? period : null), scheduledDate: targetDate, worker: newWorker, memo: newMemo, md: newMd, itemCost: itemCost, costType: newCostType, originalLogId: item.originalLogId };
                        data.maint.push(newItem);
                        remainingIds.push(newId);
                        payload.maint_upserts.push(newItem);
                    }
                    if (idx === 0) finalContentStr = fullContent;
                });
            }
        } else {
            if (dropdownWrapper) {
                let finalContent = '내용 없음';
                finalContentStr = finalContent;

                let existing = sameDayItems.find(m => m.content === finalContent);
                if (!existing) {
                    existing = data.maint.find(m =>
                        m.type === newType &&
                        (m.detailType || '') === newDetailType &&
                        m.originalLogId == item.originalLogId &&
                        m.content === finalContent &&
                        (!m.scheduledDate || m.scheduledDate === targetDate)
                    );
                }

                if (existing) {
                    const oldDate = existing.scheduledDate;
                    existing.scheduledDate = targetDate;
                    existing.type = newType;
                    existing.detailType = newDetailType;
                    existing.worker = newWorker;
                    existing.memo = newMemo;
                    existing.md = newMd;
                    existing.costType = newCostType;
                    existing.content = finalContent;
                    remainingIds.push(existing.id);
                    payload.maint_upserts.push(existing);
                    generateDateChangeLog(existing, oldDate, 0);
                } else {
                    const newId = Date.now() + Math.floor(Math.random() * 10000);
                    const newItem = { id: newId, type: newType, detailType: newDetailType, code: '', content: finalContent, date: "", scheduledDate: targetDate, worker: newWorker, memo: newMemo, md: newMd, itemCost: '', costType: newCostType, originalLogId: item.originalLogId };
                    data.maint.push(newItem);
                    remainingIds.push(newId);
                    payload.maint_upserts.push(newItem);
                }
            } else {
                let finalContent = document.getElementById('detail-content-input').value.trim();
                if (!finalContent) finalContent = '내용 없음';
                finalContent = window.removeCostLabels(finalContent);
                finalContentStr = finalContent;

                let pureContent = finalContent;
                let spec = '';
                const specMatch = pureContent.match(/\s*\[(.*?)\]$/);
                if (specMatch) {
                    spec = specMatch[1];
                    pureContent = pureContent.replace(specMatch[0], '');
                }

                let code = '';
                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) { code = match.code || ''; }

                let existing = sameDayItems.find(m => (m.content === finalContent || (m.code && code && m.code === code)) && (m.spec || '') === spec);
                if (!existing) {
                    existing = data.maint.find(m =>
                        m.type === newType &&
                        (m.detailType || '') === newDetailType &&
                        m.originalLogId == item.originalLogId &&
                        (m.content === finalContent || (m.code && code && m.code === code)) &&
                        (m.spec || '') === spec &&
                        (!m.scheduledDate || m.scheduledDate === targetDate)
                    );
                }

                if (existing) {
                    const oldDate = existing.scheduledDate;
                    existing.scheduledDate = targetDate;
                    existing.worker = newWorker;
                    existing.memo = newMemo;
                    existing.md = newMd;
                    existing.costType = newCostType;
                    existing.content = finalContent;
                    remainingIds.push(existing.id);
                    payload.maint_upserts.push(existing);
                    generateDateChangeLog(existing, oldDate, 0);
                } else {
                    const newId = Date.now() + Math.floor(Math.random() * 10000);
                    const newItem = { id: newId, type: newType, detailType: newDetailType, code: '', content: finalContent, date: "", scheduledDate: targetDate, worker: newWorker, memo: newMemo, md: newMd, costType: newCostType, originalLogId: item.originalLogId };
                    data.maint.push(newItem);
                    remainingIds.push(newId);
                    payload.maint_upserts.push(newItem);
                }
            }
        }

        sameDayItems.forEach(m => {
            if (!remainingIds.includes(m.id)) {
                const oldDate = m.scheduledDate;
                m.scheduledDate = "";

                if (needsReason && oldDate && oldDate !== targetDate) {
                    const actualReason = (reason && reason.trim()) ? reason.trim() : '사유 미입력';
                    const now = new Date();
                    const modifyTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                    const uDept = sessionStorage.getItem('userDepartment') || '';
                    const uPos = sessionStorage.getItem('userPosition') || '';
                    const uName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';
                    const workerInfo = (uDept || uPos) ? `${uName} (${uDept} ${uPos})`.trim() : uName;

                    if (!data.logs) data.logs = [];
                    const newLog = {
                        id: Date.now() + Math.floor(Math.random() * 10000) + 99,
                        date: oldDate,
                        type: m.type || '정기',
                        detailType: '일정변경',
                        detailType2: '',
                        content: `[변경] ${m.code ? m.code : m.content}`,
                        costType: m.costType || '',
                        md: '0',
                        worker: workerInfo,
                        memo: `[일정 삭제 사유]\n${actualReason}\n\n[변경 내역]\n기존: ${oldDate}\n변경: 삭제됨 (상세 팝업 내 항목 제거)\n\n[수정 일시 및 작업자]\n${modifyTime} / ${workerInfo}`
                    };
                    data.logs.push(newLog);
                    payload.log_upserts.push(newLog);
                }

                payload.maint_upserts.push(m);
            }
        });
    }

    const success = await window.syncHistoryTransaction(site, equip, payload);
    if (!success) return false;

    localStorage.setItem(key, JSON.stringify(data));

    if (!isCompleted && remainingIds.length > 0) {
        currentDetailTarget.id = remainingIds[0];
    }

    const issueShareCb = document.getElementById('detail-issue-share-checkbox');

    let savedContentStr = '';
    if (expandedDropdownValues.length > 0) {
        savedContentStr = expandedDropdownValues.join(', ');
    } else {
        savedContentStr = document.getElementById('detail-content-input').value.trim();
    }
    if (!savedContentStr) savedContentStr = '내용 없음';

    window.initialEventDetail = {
        worker: newWorker,
        md: newMd,
        memo: newMemo,
        date: targetDate,
        issueShared: issueShareCb ? issueShareCb.checked : false,
        content: savedContentStr,
        costType: newCostType,
        type: newType,
        detailType: newDetailType
    };

    if (typeof window.refreshCalendarPopupAfterCompletion === 'function') {
        window.refreshCalendarPopupAfterCompletion();
    } else {
        if (typeof window.renderCalendar === 'function') window.renderCalendar();
        if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
        if (typeof renderDetails === 'function') renderDetails();
        if (typeof renderLogs === 'function') renderLogs();
    }

    return true;
}

/* --- 1.4 데이터 처리 및 액션 (Data & Actions) --- */
async function completeScheduleWork() {
    if (!currentDetailTarget || currentDetailTarget.isCompleted) return;

    const { site, equip, id } = currentDetailTarget;
    const key = `details_${site}_${equip}`;
    let data = JSON.parse(localStorage.getItem(key)) || {};

    const maintItem = data.maint ? data.maint.find(i => i.id == id) : null;
    if (!maintItem) return;

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    const typeSelect = document.getElementById('detail-type-select');
    const taskType = typeSelect && typeSelect.style.display !== 'none' ? typeSelect.value : (maintItem.type || '정기');

    const worker = document.getElementById('detail-worker').value.trim();
    const mdInput = document.getElementById('detail-md');
    const md = mdInput ? mdInput.value.trim() : '';
    const memo = document.getElementById('detail-work-memo').value.trim();
    const issueShareCb = document.getElementById('detail-issue-share-checkbox');
    const isIssueShared = issueShareCb ? issueShareCb.checked : false;
    const costTypeInput = document.getElementById('detail-cost-type');
    const costType = costTypeInput ? costTypeInput.value : '';
    const startTime = getSplitDateTimeValue('detail-start');
    const endTime = getSplitDateTimeValue('detail-end');

    if (!costType) return alert('비용처리를 선택해주세요.');
    if (!worker) return alert('작업자를 입력해주세요.');
    if (!md) return alert('공수(M/D)를 입력해주세요.');

    if (startTime && endTime) {
        if (new Date(startTime) > new Date(endTime)) {
            return alert('시작 일시는 종료 일시보다 늦을 수 없습니다.\n입력하신 시간을 다시 확인해주세요.');
        }
    }

    let sameDayItems = [];
    if (maintItem.originalLogId) {
        sameDayItems = data.maint.filter(i => 
            i.type === maintItem.type && 
            (i.detailType || '') === (maintItem.detailType || '') && 
            i.originalLogId == maintItem.originalLogId
        );
    } else if (maintItem.type === '비정기') {
        sameDayItems = data.maint.filter(i => i.id == maintItem.id);
    } else {
        sameDayItems = data.maint.filter(i => 
            i.scheduledDate === maintItem.scheduledDate && 
            i.type === maintItem.type && 
            (i.detailType || '') === (maintItem.detailType || '') && 
            !i.originalLogId
        );
    }
    // [개선] 옛날 DB 예정 데이터 대신, 화면에서 사용자가 실시간으로 수정한 최신 선택 내용 및 비용처리를 직접 긁어와 완료 로그 내용 구성
    let partContentList = [];
    const pWrapper = document.getElementById('detail-edit-part-wrapper');
    if (pWrapper && pWrapper.style.display !== 'none') {
        const pList = document.getElementById('detail-edit-part-list');
        if (pList) {
            const selectedParts = pList.querySelectorAll('.log-select-item.selected');
            partContentList = Array.from(selectedParts).map(el => {
                const val = el.dataset.value;
                const cSel = el.querySelector('.item-cost-select');
                const costPrefix = cSel ? `[${cSel.value}] ` : '';
                return `${costPrefix}${val}`;
            });
        }
    } else {
        const isPartMode = maintItem.detailType === 'PM 점검' || maintItem.detailType === 'Parts 교체' || maintItem.detailType === '설비 정상화';
        if (isPartMode) {
            const dWrapper = document.getElementById('detail-content-dropdown-wrapper');
            if (dWrapper) {
                const selected = dWrapper.querySelectorAll('.log-select-item.selected');
                partContentList = Array.from(selected).map(el => {
                    const val = el.dataset.value;
                    const cSel = el.querySelector('.item-cost-select');
                    const costPrefix = cSel ? `[${cSel.value}] ` : '';
                    return `${costPrefix}${val}`;
                });
            }
        }
    }

    const contentArr = [];
    let baseVals = [];
    const dWrapper = document.getElementById('detail-content-dropdown-wrapper');
    if (dWrapper) {
        const selected = dWrapper.querySelectorAll('.log-select-item.selected');
        baseVals = Array.from(selected).map(el => {
            const cSel = el.querySelector('.item-cost-select');
            return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
        });
    }

    baseVals.forEach(val => {
        let baseCost = '유상';
        const bMatch = val.match(/^\[(.*?)\] (.*)$/);
        if (bMatch) { baseCost = bMatch[1]; val = bMatch[2]; }

        let cleanVal = window.removeCostLabels(val);
        const valSpecMatch = cleanVal.match(/\s*\[(.*?)\]$/);
        if (valSpecMatch) {
            cleanVal = cleanVal.replace(valSpecMatch[0], '').trim();
        }
        const isRegisteredPart = adminItems.some(ai => {
            const p = (ai.part || '').trim();
            const c = (ai.code || '').trim();
            return (p && p === cleanVal) || (c && c === cleanVal);
        });
        const isSpecOnly = (!cleanVal && valSpecMatch);
        if (taskType !== '정기' && maintItem.detailType !== 'PM 점검' && maintItem.detailType !== 'Parts 교체' && maintItem.detailType !== '설비 정상화' && (isRegisteredPart || isSpecOnly)) return;

        const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
        if (isPartKeyword && partContentList.length > 0) {
            partContentList.forEach(p => {
                contentArr.push(`${val} - ${p}`);
            });
        } else if (isPartKeyword) {
            contentArr.push(val);
        } else {
            contentArr.push(`[${baseCost}] ${val}`);
        }
    });

    if (!dWrapper || baseVals.length === 0) {
        let inputVal = document.getElementById('detail-content-input').value.trim();
        if (inputVal) {
            inputVal = window.removeCostLabels(inputVal);
            contentArr.push(inputVal);
        }
    }

    const combinedContent = [...new Set(contentArr)].join(', ');

    // [개선] 내용 조립 시 다른 물품이 있을 경우 "내용 없음", "장비 점검" 등의 더미 텍스트를 제거하고 조립
    const checkKeywords = ['PM 점검', 'BM 점검', '파트 이상 교체', '파트 이상 수리', '물품 이상 교체', '물품 이상 수리', '용액 용자 이상', '파츠 이상 교체', '파츠 이상 수리', '장비 점검', '추가 작업'];

    const cleanContentArr = window.splitSafetyContent(combinedContent)
        .map(s => s.trim())
        .filter(s => {
            return s && s !== '내용 없음' && s !== '장비 점검';
        });

    let finalCleanContent = cleanContentArr.length > 0 ? [...new Set(cleanContentArr)].join(', ') : '';
    if (!finalCleanContent) {
        // 모든 수집 내용이 부품명이어서 걸러진 경우, 세부구분(detailType)을 기본 키워드로 사용
        finalCleanContent = maintItem.detailType || '장비 점검';
    }

    // 내용(content) 및 메모(memo) 유효성 검사 (정기일 때만 생략 가능, 비정기/고객대응 등 정기 제외 시 필수)
    if (taskType !== '정기') {
        if (!memo) return alert('점검 결과 / 메모를 입력해주세요.');
        if (finalCleanContent === '장비 점검' || !finalCleanContent) {
            return alert('내용을 입력해주세요.');
        }
    }

    const workerCount = worker.split(',').map(s => s.trim()).filter(Boolean).length;
    if (parseFloat(md) > workerCount) {
        alert(`입력된 공수(${md})가 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
        if (mdInput) mdInput.value = workerCount;
        return;
    }

    if (!confirm('해당 작업을 완료 처리하시겠습니까?')) return;

    localStorage.setItem('lastWorkerName', worker);

    const originalMaintMap = new Map((data.maint || []).map(m => [m.id, { ...m }]));

    if (!data.logs) data.logs = [];

    const completeDate = maintItem.scheduledDate || new Date().toISOString().split('T')[0];

    let payload = { log_upserts: [], maint_upserts: [], maint_deletes: [] };


    let finalMemo = memo.replace(/\n?\[추가 파트\].*$/m, '').trim();

    const newLog = {
        id: Date.now(),
        date: completeDate,
        type: maintItem.type || '정기',
        detailType: maintItem.detailType || '',
        detailType2: '',
        content: finalCleanContent,
        costType: maintItem.costType || '',
        md: md,
        worker: worker,
        memo: finalMemo,
        isIssueShared: isIssueShared,
        startTime: startTime,
        endTime: endTime
    };

    if (maintItem.originalLogId) {
        newLog.originalLogId = maintItem.originalLogId;
        const originalLog = data.logs.find(l => l.id == maintItem.originalLogId);
        if (originalLog) {
            newLog.isIssueShared = !!originalLog.isIssueShared;
            originalLog.addWorkLogId = newLog.id;
            payload.log_upserts.push(originalLog);
        }
    }

    data.logs.push(newLog);
    payload.log_upserts.push(newLog);

    // [추가 고도화] 완료 취소 후 재완료 시, 기존 자식 추가작업들의 originalLogId를 새 완료 로그 ID(newLog.id)로 일괄 연쇄 갱신
    const targetMaintIdStr = maintItem.id.toString();
    data.logs.forEach(cLog => {
        if (cLog.originalLogId && cLog.originalLogId.toString() === targetMaintIdStr) {
            cLog.originalLogId = newLog.id.toString();
            if (!payload.log_upserts.some(item => item.id == cLog.id)) {
                payload.log_upserts.push(cLog);
            }
        }
    });
    if (data.maint) {
        data.maint.forEach(cMaint => {
            if (cMaint.originalLogId && cMaint.originalLogId.toString() === targetMaintIdStr) {
                cMaint.originalLogId = newLog.id.toString();
                if (!payload.maint_upserts.some(item => item.id == cMaint.id)) {
                    payload.maint_upserts.push(cMaint);
                }
            }
        });
    }

    sameDayItems.forEach(i => {
        i.scheduledDate = "";
        i.worker = "";
        i.memo = "";
        i.costType = "";
        i.md = "";
        if (i.type === '정기' || i.type === '비정기' || i.type === '고객대응') {
            i.date = completeDate;
        }
        payload.maint_upserts.push(i);
    });

    let idsToRemove = new Set();
    let mergedRegItemIds = new Set();

    let extractedParts = [];

    // 1. 화면에서 사용자가 새로 추가/선택한 파트 목록(partContentList)을 extractedParts에 주입
    if (partContentList && partContentList.length > 0) {
        partContentList.forEach(p => {
            let temp = p;
            const costMatch = temp.match(/^\[(.*?)\] (.*)$/);
            const costType = costMatch ? costMatch[1] : '';
            let purePart = costMatch ? costMatch[2] : temp;

            // 파트 이상 교체 등의 대표 라벨 제거
            const partKeywords = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '물품 이상 교체', '물품 이상 수리', '파트 이상 (교체)', '파츠 이상 교체', '파트 이상', '파츠 이상'];
            for (const keyword of partKeywords) {
                const idx = purePart.indexOf(keyword);
                if (idx !== -1) {
                    purePart = purePart.substring(idx + keyword.length).replace(/^[\s-]+/, '').trim();
                    break;
                }
            }

            if (purePart && purePart !== '내용 없음') {
                extractedParts.push({
                    sourceId: maintItem.id,
                    part: purePart,
                    code: '',
                    spec: maintItem.spec || '',
                    date: completeDate,
                    costType: costType
                });
            }
        });
    }

    // 2. 기존 sameDayItems 로부터 부품을 수집 (이전 부품 관리 데이터 복원용)
    sameDayItems.forEach(i => {
        const type = i.type || '';
        if (type === '비정기') return; // [수정] 비정기 작업은 개별 부품 레코드를 이중으로 생성하지 않도록 원천 스킵 (중복 생성 방지)
        const dt = i.detailType || '';
        const dt2 = i.detailType2 || '';
        const content = i.content || '';

        if (!content || content === '내용 없음') return;

        let isPartReplacement = false;
        let partsString = '';

        // [개선] 타입에 관계없이 PM 점검, BM 점검, Parts 교체, 또는 세부구분에 파트/파츠/물품 이상이 포함된 경우 등 물품과 관련된 내용이면 모두 추출 대상으로 삼음
        const isPmBm = dt.includes('PM 점검') || dt.includes('Parts 교체') || dt.includes('설비 정상화') || dt.includes('파트 이상') || dt.includes('파츠 이상') || dt.includes('물품 이상') || dt2.includes('파트 이상') || dt2.includes('파츠 이상');
        if (isPmBm) {
            isPartReplacement = true;
            let tempContent = content;
            const prefixMatch = tempContent.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|파츠 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
            if (prefixMatch) {
                tempContent = prefixMatch[2].trim();
            }
            partsString = tempContent;
        } else {
            const match = content.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|파츠 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))(.*)$/);
            if (match) {
                isPartReplacement = true;
                partsString = match[2].replace(/^[\s-]+/, '').trim();
            }
        }

        if (isPartReplacement && partsString) {
            const parts = [];
            const matches = partsString.match(/\[.*?\][^\[]*/g);
            if (matches) {
                matches.forEach(m => {
                    let item = m.trim();
                    if (item.endsWith(',')) {
                        item = item.substring(0, item.length - 1).trim();
                    }
                    if (item) parts.push(item);
                });
            } else {
                parts.push(partsString.trim());
            }

            parts.forEach(p => {
                let purePart = window.removeCostLabels(p);
                
                // [추가] 만약 purePart 내부에 "파트 이상 교체 - " 등의 접두사가 들어있다면 이를 제거
                const partKeywords = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '물품 이상 교체', '물품 이상 수리', '파트 이상 (교체)', '파츠 이상 교체', '파트 이상', '파츠 이상'];
                for (const keyword of partKeywords) {
                    const idx = purePart.indexOf(keyword);
                    if (idx !== -1) {
                        purePart = purePart.substring(idx + keyword.length).replace(/^[\s-]+/, '').trim();
                        break;
                    }
                }

                let spec = '';
                let specMatch = purePart.match(/\s*\[(.*?)\]$/);
                while (specMatch) {
                    spec = specMatch[1];
                    purePart = purePart.replace(specMatch[0], '').trim();
                    specMatch = purePart.match(/\s*\[(.*?)\]$/);
                }
                if (!spec && parts.length === 1) {
                    // [수정] 부품이 하나일 때만 maint 항목의 개별 spec 필드를 사용 (다중 부품 시 spec 오염 방지)
                    spec = i.spec || '';
                }
                if (purePart && purePart !== '내용 없음') {
                    extractedParts.push({
                        sourceId: i.id,
                        part: purePart,
                        code: i.code || '',
                        spec: spec,
                        date: completeDate,
                        costType: i.itemCost
                    });
                }
            });
        }
    });

    // extractedParts 중복 제거 (part 및 spec 기준)
    const uniqueExtractedParts = [];
    const seenParts = new Set();
    extractedParts.forEach(ep => {
        const key = `${ep.part.toLowerCase()}_${(ep.spec || '').toLowerCase()}`;
        if (!seenParts.has(key)) {
            seenParts.add(key);
            uniqueExtractedParts.push(ep);
        }
    });
    extractedParts = uniqueExtractedParts;

    const adminItemsForExtract = JSON.parse(localStorage.getItem('admin_items')) || [];
    extractedParts.forEach((ep, idx) => {
        let realPartName = ep.part;
        let codeName = ep.code;
        let adminMatch = adminItemsForExtract.find(a => a.part === ep.part || a.code === ep.part);
        if (adminMatch && adminMatch.part) {
            realPartName = adminMatch.part;
            if (!codeName) codeName = adminMatch.code || '';
        }

        let existing = data.maint.find(m => {
            if (m.id === ep.sourceId) return false;
            if (mergedRegItemIds.has(m.id)) return false;
            if (m.type !== '정기' && m.type !== '비정기') return false;
            if (m.originalLogId) return false; // 추가 작업의 임시 데이터는 existing 대상에서 제외하여 원본과 매칭 보장

            // 1. 물품 상세(spec) 대조 (공백/대소문자 제거 후 완벽 비교)
            let mContent = m.content || '';
            let mSpec = m.spec || '';
            const mContentSpecMatch = mContent.match(/\s*\[(.*?)\]$/);
            if (mContentSpecMatch) {
                if (!mSpec) mSpec = mContentSpecMatch[1];
                mContent = mContent.replace(mContentSpecMatch[0], '').trim();
            }

            const mSpecClean = mSpec.replace(/\s+/g, '').toLowerCase();
            const epSpecClean = (ep.spec || '').replace(/\s+/g, '').toLowerCase();
            if (mSpecClean !== epSpecClean) return false;

            // 2. 코드명(code) 및 물품명(content) 대조를 위한 정보 수집
            const mCode = m.code || '';
            let mRealName = mContent;
            let mRealCode = mCode;
            if (!mRealCode) {
                let aMatch = adminItemsForExtract.find(a => a.part === mContent || a.code === mContent);
                if (aMatch) {
                    mRealName = aMatch.part;
                    mRealCode = aMatch.code || '';
                }
            }

            const mCodeClean = (mRealCode || '').replace(/\s+/g, '').toLowerCase();
            const epCodeClean = (codeName || '').replace(/\s+/g, '').toLowerCase();

            // 대괄호 비용표시([유상], [무상] 등) 제거 후 공백 제거 비교
            const mContentClean = window.removeCostLabels(mContent).replace(/\s+/g, '').toLowerCase();
            const mRealNameClean = window.removeCostLabels(mRealName).replace(/\s+/g, '').toLowerCase();
            const epPartClean = window.removeCostLabels(ep.part).replace(/\s+/g, '').toLowerCase();
            const realPartNameClean = window.removeCostLabels(realPartName).replace(/\s+/g, '').toLowerCase();

            // 코드명이 양쪽에 있는 경우 둘이 다르면 매칭 실패
            if (mCodeClean && epCodeClean && mCodeClean !== epCodeClean) return false;

            // 물품명 일치 여부
            const isContentEqual = (epPartClean === mContentClean || realPartNameClean === mRealNameClean);
            if (!isContentEqual) return false;

            return true;
        });

        if (existing) {
            existing.date = ep.date;
            const sourceItem = data.maint.find(m => m.id === ep.sourceId);
            const sourceType = sourceItem ? sourceItem.type : '비정기';
            // 비정기에서 정기로 추가(완료)되는 경우, 타입을 정기로 전환하여 중복 생성 방지 및 통합
            if (sourceType === '정기') {
                existing.type = '정기';
                existing.detailType = 'PM 점검';
            }
            if (ep.costType) existing.itemCost = ep.costType;
            if (!payload.maint_upserts.some(upsertItem => upsertItem.id === existing.id)) {
                payload.maint_upserts.push(existing);
            }
            mergedRegItemIds.add(existing.id);
            idsToRemove.add(ep.sourceId);
        } else {
            const sourceItem = data.maint.find(m => m.id === ep.sourceId);
            let sContent = sourceItem ? (sourceItem.content || '') : '';
            let sSpec = sourceItem ? (sourceItem.spec || '') : '';
            if (sourceItem) {
                const sSpecMatch = sContent.match(/\s*\[(.*?)\]$/);
                if (sSpecMatch) {
                    if (!sSpec) sSpec = sSpecMatch[1];
                    sContent = sContent.replace(sSpecMatch[0], '').trim();
                }
            }
            // [수정] sourceItem이 원본 항목(!originalLogId)일 때만 재사용 (임시 항목 재사용 시 필터에서 삭제되어버리는 버그 방지)
            if (sourceItem && !sourceItem.originalLogId && (sContent === realPartName || sContent === ep.part) && (sSpec || '') === (ep.spec || '')) {
                sourceItem.date = ep.date;
                if (ep.costType) sourceItem.itemCost = ep.costType;
                mergedRegItemIds.add(sourceItem.id);
                if (!payload.maint_upserts.some(upsertItem => upsertItem.id === sourceItem.id)) {
                    payload.maint_upserts.push(sourceItem);
                }
            } else {
                let period = null;
                if (adminMatch) {
                    period = adminMatch.cycle || null;
                }
                const newId = Date.now() + Math.floor(Math.random() * 10000) + idx;

                const sourceType = sourceItem ? sourceItem.type : '비정기';
                const sourceDetailType = sourceItem ? sourceItem.detailType : '';

                const newMaintItem = {
                    id: newId,
                    type: sourceType,
                    detailType: sourceDetailType,
                    code: codeName,
                    content: realPartName,
                    spec: ep.spec,
                    date: ep.date,
                    period: period,
                    scheduledDate: "",
                    costType: "",
                    worker: "",
                    md: "",
                    itemCost: ep.costType || '',
                    originalLogId: null
                };
                data.maint.push(newMaintItem);
                payload.maint_upserts.push(newMaintItem);
                mergedRegItemIds.add(newId);
                idsToRemove.add(ep.sourceId);
            }
        }
    });

    sameDayItems.forEach(i => {
        if (i.type === '비정기') {
            const regItem = data.maint.find(m => {
                if (m.type !== '정기' || m.id === i.id) return false;
                if ((m.spec || '') !== (i.spec || '')) return false;

                const mCode = m.code || '';
                const mContent = m.content || '';
                const iCode = i.code || '';
                const iContent = i.content || '';

                if (iCode && mCode && iCode === mCode) return true;
                if (iContent === mContent) return true;

                return false;
            });
            if (regItem) {
                regItem.date = i.date;
                if (i.itemCost) regItem.itemCost = i.itemCost;
                if (!payload.maint_upserts.some(upsertItem => upsertItem.id === regItem.id)) {
                    payload.maint_upserts.push(regItem);
                }
                idsToRemove.add(i.id);
                mergedRegItemIds.add(regItem.id);
            }
        }
    });

    const remainingIds = data.maint.filter(i => sameDayItems.some(s => s.id === i.id) || mergedRegItemIds.has(i.id)).map(i => i.id);
    const remainingItems = data.maint.filter(i => remainingIds.includes(i.id));

    let nextScheduleItems = remainingItems.filter(item => {
        if (item.originalLogId) return false;
        return adminItems.some(a => a.part === item.content || a.code === item.content);
    });

    const isRegularPM = maintItem.type === '정기';

    if (isRegularPM && nextScheduleItems.length === 0 && !maintItem.originalLogId) {
        nextScheduleItems = [{
            id: Date.now() + 9999,
            type: maintItem.type || '정기',
            detailType: maintItem.detailType || 'PM 점검',
            content: '장비 점검',
            period: 0,
            md: md,
            worker: worker,
            isNew: true
        }];
    }

    const preFilterIds = new Set(data.maint.map(i => i.id));
    data.maint = data.maint.filter(i => {
        if (idsToRemove.has(i.id)) return false;
        const isCompletedItem = sameDayItems.some(s => s.id === i.id);
        if (isCompletedItem) {
            if (i.originalLogId) return false;

            // [개선] 비정기(BM) 작업 등 정기가 아닌 일회성 작업은 완료 처리 시 삭제하지 않고 시작일이 갱신되도록 유지
            if (i.type !== '정기') return true;

            const dt = i.detailType || '';
            const isPmBm = dt === 'PM 점검' || dt.startsWith('PM 점검 >');
            if (!isPmBm) return false;

            if (i.content === '내용 없음' || i.content === '장비 점검') return false;
            const match = adminItems.some(a => a.part === i.content || a.code === i.content);
            if (!match) return false;
        }
        return true;
    });
    const postFilterIds = new Set(data.maint.map(i => i.id));

    preFilterIds.forEach(id => {
        if (!postFilterIds.has(id)) payload.maint_deletes.push(id.toString());
    });
    payload.maint_upserts = payload.maint_upserts.filter(i => postFilterIds.has(i.id));

    const success = await window.syncHistoryTransaction(site, equip, payload);
    if (!success) {
        alert('서버 통신 오류로 작업 완료 취소에 실패했습니다.');
        location.reload();
        return;
    }

    localStorage.setItem(key, JSON.stringify(data));

    if (typeof addSystemLog === 'function') {
        addSystemLog('COMPLETE_SCHEDULE', equip, `작업일: ${completeDate}, 내용: ${combinedContent}`);
    }

    if (maintItem.type === '비정기') {
        alert('작업이 완료되었습니다. Trouble 이력 작성을 원하시면 상세창 하단의 버튼을 이용하세요.');
        if (typeof window.refreshCalendarPopupAfterCompletion === 'function') window.refreshCalendarPopupAfterCompletion();
        if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
        
        const newestLog = data.logs
            .filter(l => l.type === '비정기' && (l.date || '').substring(0, 10) === completeDate)
            .sort((a, b) => b.id - a.id)[0];
        
        if (newestLog) {
            openEventDetailModal(site, equip, newestLog.id, true);
        } else {
            document.getElementById('event-detail-modal').style.display = 'none';
        }
    } else {
        document.getElementById('event-detail-modal').style.display = 'none';

        if (isRegularPM && nextScheduleItems.length > 0 && !maintItem.originalLogId) {
            if (typeof window.openNextScheduleModal === 'function') {
                window.openNextScheduleModal({
                    site,
                    equip,
                    items: nextScheduleItems,
                    completeDate: completeDate,
                    md: md,
                    originalMaintMap: originalMaintMap,
                    mergedRegItemIds: mergedRegItemIds,
                    onClose: () => {
                        if (typeof window.refreshCalendarPopupAfterCompletion === 'function') window.refreshCalendarPopupAfterCompletion();
                        if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
                    },
                    onDateChange: (site, oldDate, newDate) => {
                        const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
                        const newMonth = newDate.substring(0, 7);
                        if (oldMonth !== newMonth) {
                            if (typeof window.incrementConfirmedCount === 'function') {
                                window.incrementConfirmedCount(site, newDate, 1);
                            }
                        }
                    }
                });
            }
        } else {
            alert('작업이 완료되었습니다.');
            if (typeof window.refreshCalendarPopupAfterCompletion === 'function') window.refreshCalendarPopupAfterCompletion();
            if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
        }
    }
}

window.refreshCalendarPopupAfterCompletion = function () {
    if (typeof window.renderCalendar === 'function') window.renderCalendar();
    if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
    if (typeof renderDetails === 'function') renderDetails();
    if (typeof renderLogs === 'function') renderLogs();

    const popup = document.getElementById('calendar-popup');
    if (popup && popup.style.display !== 'none') {
        const dateTitle = document.getElementById('popup-date-title');
        if (dateTitle) {
            const dateStr = dateTitle.textContent;
            let dayEvents = [];
            if (typeof window.getScheduleForCalendar === 'function') {
                const allEvents = window.getScheduleForCalendar();
                dayEvents = allEvents[dateStr] || [];
            }

            const searchInput = document.getElementById('calendar-search');
            const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

            if (keyword || (typeof currentSearchFilters !== 'undefined' && (currentSearchFilters.site || currentSearchFilters.equip))) {
                const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                dayEvents = dayEvents.filter(event => {
                    const equipParts = event.equip ? event.equip.split('::') : [];
                    const rawName = equipParts[0] || '';
                    const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
                    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;

                    const kwStr = keyword.replace(/\s/g, '');
                    const matchKeyword = !keyword || (
                        (event.site && event.site.toLowerCase().includes(keyword)) || 
                        (event.equip && event.equip.toLowerCase().includes(keyword)) || 
                        (displayName.toLowerCase().includes(keyword)) || 
                        (event.content && event.content.toLowerCase().includes(keyword)) || 
                        (event.worker && event.worker.toLowerCase().includes(keyword)) ||
                        (event.type && event.type.toLowerCase().includes(keyword)) ||
                        (event.detailType && event.detailType.toLowerCase().includes(keyword)) ||
                        (event.content && event.content.replace(/\s/g, '').toLowerCase().includes(kwStr)) ||
                        (event.detailType && event.detailType.replace(/\s/g, '').toLowerCase().includes(kwStr))
                    );
                    const matchSite = typeof window.isSiteMatched === 'function' ? window.isSiteMatched(event.site, currentSearchFilters.site) : ((typeof currentSearchFilters !== 'undefined' && !currentSearchFilters.site) || event.site === currentSearchFilters.site);
                    const matchEquip = (typeof currentSearchFilters !== 'undefined' && !currentSearchFilters.equip) || event.equip === currentSearchFilters.equip || rawName === currentSearchFilters.equip || displayName === currentSearchFilters.equip;
                    return matchKeyword && matchSite && matchEquip;
                });
            }

            if (typeof window.openCalendarPopup === 'function') window.openCalendarPopup(dateStr, dayEvents);
        }
    }
};

async function cancelScheduleCompletion() {
    if (!currentDetailTarget || !currentDetailTarget.isCompleted) return;

    try {
        const { site, equip, id } = currentDetailTarget;
        const key = `details_${site}_${equip}`;
        let data = JSON.parse(localStorage.getItem(key)) || {};

        if (!data.logs) return;

        const logIndex = data.logs.findIndex(l => l.id == id);
        if (logIndex === -1) return;
        
        const logItem = data.logs[logIndex];
        
        // [추가 고도화] 자식 추가작업 연동 건수 확인 및 경고창 처리
        const childLogsCount = data.logs.filter(l => l.originalLogId && l.originalLogId.toString() === id.toString()).length;
        const childMaintsCount = (data.maint || []).filter(m => m.originalLogId && m.originalLogId.toString() === id.toString()).length;
        const totalChildren = childLogsCount + childMaintsCount;
        
        if (totalChildren > 0) {
            const confirmMsg = `이 작업에 연동된 추가작업(${totalChildren}건)이 존재합니다.\n작업 완료 취소 후 다시 완료 처리할 때도 추가작업 이력이 안전하게 유지되도록 연동 링크를 보존합니다.\n작업 완료를 취소하시겠습니까?`;
            if (!confirm(confirmMsg)) return;
        } else {
            if (!confirm('작업 완료를 취소하고 예정 상태로 되돌리시겠습니까?')) return;
        }

        const logContent = logItem.content || '';
        const logType = logItem.type;
        const logDate = logItem.date;

        const recoveredWorker = logItem.worker || '';
        const recoveredMd = logItem.md || '';
        const recoveredMemo = logItem.memo || '';

        data.logs.splice(logIndex, 1);

        let contents = [];
        if (logType === '비정기' || logItem.originalLogId) {
            // 비정기 작업이거나 추가 작업인 경우: 절대 물품별로 쪼개지 않고 통째로 단 1개의 예정 작업으로 복구
            contents = [logContent];
        } else {
            contents = window.splitSafetyContent(logContent);
        }

        if (!data.maint) data.maint = [];

        let payload = { log_deletes: [id.toString()], maint_upserts: [] };

        let recoveredMaintId = null;

        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

        if (contents.length === 0) contents.push('내용 없음');

        const matchedMaintIds = new Set(); // [추가] 중복 매칭 방지

        contents.forEach((itemText, idx) => {
            let itemCost = '';
            const costMatch = itemText.match(/^\[(.*?)\] (.*)$/);
            if (costMatch) {
                itemCost = costMatch[1];
                itemText = costMatch[2];
            }

            const innerCostMatch = itemText.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
            if (innerCostMatch) {
                if (!itemCost) itemCost = innerCostMatch[2];
                itemText = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
            }

            let keywordPart = '';
            let pureContent = itemText;
            const kwMatch = pureContent.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
            if (kwMatch) {
                keywordPart = kwMatch[1].trim();
                pureContent = kwMatch[2].trim();
            }

            let spec = '';
            let specMatch = pureContent.match(/\s*\[(.*?)\]$/);
            while (specMatch) {
                spec = specMatch[1];
                pureContent = pureContent.replace(specMatch[0], '').trim();
                specMatch = pureContent.match(/\s*\[(.*?)\]$/);
            }

            let code = ''; 
            let fullContent = pureContent;

            const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
            if (match) {
                code = match.code || '';
                fullContent = pureContent;
            }

            if (keywordPart) {
                fullContent = `${keywordPart} - ${fullContent}`;
            }

            // [추가] 이전 작업일(시작일) 복구를 위해 이전 로그 검색
            let prevDate = "";
            const prevLog = data.logs
                .filter(l => l.id !== logItem.id && l.type === logType && (l.content || '').includes(pureContent))
                .sort((a, b) => {
                    if (b.date !== a.date) return new Date(b.date) - new Date(a.date);
                    return b.id - a.id;
                })[0];
            
            if (prevLog) {
                prevDate = prevLog.date;
            }

            let existingItem = data.maint.find(m => {
                if (matchedMaintIds.has(m.id)) return false;
                if (m.type !== logType) return false;
                if ((m.originalLogId || null) != (logItem.originalLogId || null)) return false;
                if (m.scheduledDate && m.scheduledDate !== logDate && m.date) return false;

                let mContent = m.content || '';
                let mSpec = m.spec || '';
                const mContentSpecMatch = mContent.match(/\s*\[(.*?)\]$/);
                if (mContentSpecMatch) {
                    if (!mSpec) mSpec = mContentSpecMatch[1];
                    mContent = mContent.replace(mContentSpecMatch[0], '').trim();
                }

                const mSpecClean = mSpec.replace(/\s+/g, '').toLowerCase();
                const epSpecClean = (spec || '').replace(/\s+/g, '').toLowerCase();
                if (mSpecClean !== epSpecClean) return false;

                return (mContent === fullContent || mContent === pureContent || (m.code && code && m.code === code));
            });
            if (existingItem) {
                matchedMaintIds.add(existingItem.id);
                existingItem.content = fullContent; // [수정] 완료 취소 시 파트 이상 교체/수리 등 접두어 키워드와 함께 내용 복원
                existingItem.spec = spec; // [추가] 완료 취소 시 규격 상세 정보 복구
                if (code) existingItem.code = code;
                existingItem.scheduledDate = logDate;
                existingItem.date = prevDate; // [수정] 빈 문자열 대신 이전 로그의 날짜(시작일)로 복구
                existingItem.worker = recoveredWorker;
                existingItem.md = recoveredMd;
                existingItem.memo = recoveredMemo;
                existingItem.costType = logItem.costType || '';
                if (itemCost) existingItem.itemCost = itemCost;
                if (idx === 0) recoveredMaintId = existingItem.id;
                payload.maint_upserts.push(existingItem);
            } else {
                let restoredDetailType = logItem.detailType || '';
                if (logType === '비정기' && logItem.detailType2) {
                    restoredDetailType = `${logItem.detailType} > ${logItem.detailType2}`;
                }

                const newId = Date.now() + idx;
                const newItem = {
                    id: newId,
                    type: logType,
                    detailType: restoredDetailType,
                    code: code,
                    content: fullContent,
                    spec: spec,
                    date: prevDate, // [수정] 빈 문자열 대신 이전 로그의 날짜(시작일)로 복구
                    period: (logType === '정기' && match) ? match.cycle : null,
                    scheduledDate: logDate,
                    costType: logItem.costType || '',
                    worker: recoveredWorker,
                    md: recoveredMd,
                    memo: recoveredMemo,
                    itemCost: itemCost,
                    originalLogId: logItem.originalLogId
                };
                data.maint.push(newItem);
                payload.maint_upserts.push(newItem);
                if (idx === 0) recoveredMaintId = newId;
            }
        });

        // [추가] 완료 처리 시 새로 생성되었던 완료 부품 레코드(MaintItem)들을 일괄 제거하여 정합성 유지
        const contentsForDelete = window.splitSafetyContent(logContent);
        contentsForDelete.forEach(itemText => {
            let itemCost = '';
            const costMatch = itemText.match(/^\[(.*?)\] (.*)$/);
            if (costMatch) { itemText = costMatch[2]; }
            const innerCostMatch = itemText.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
            if (innerCostMatch) { itemText = `${innerCostMatch[1]} - ${innerCostMatch[3]}`; }

            let keywordPart = '';
            let pureContent = itemText;
            const kwMatch = pureContent.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
            if (kwMatch) {
                keywordPart = kwMatch[1].trim();
                pureContent = kwMatch[2].trim();
            }

            let spec = '';
            let specMatch = pureContent.match(/\s*\[(.*?)\]$/);
            while (specMatch) {
                spec = specMatch[1];
                pureContent = pureContent.replace(specMatch[0], '').trim();
                specMatch = pureContent.match(/\s*\[(.*?)\]$/);
            }

            const toDelete = data.maint.filter(m => {
                if (m.type !== logType) return false;
                if (m.date !== logDate) return false;
                if (m.scheduledDate || m.originalLogId) return false;

                let mContent = m.content || '';
                let mSpec = m.spec || '';
                const mContentSpecMatch = mContent.match(/\s*\[(.*?)\]$/);
                if (mContentSpecMatch) {
                    if (!mSpec) mSpec = mContentSpecMatch[1];
                    mContent = mContent.replace(mContentSpecMatch[0], '').trim();
                }

                const mSpecClean = mSpec.replace(/\s+/g, '').toLowerCase();
                const epSpecClean = (spec || '').replace(/\s+/g, '').toLowerCase();
                if (mSpecClean !== epSpecClean) return false;

                return (mContent === pureContent || (keywordPart && mContent === `${keywordPart} - ${pureContent}`));
            });

            toDelete.forEach(m => {
                if (recoveredMaintId && m.id == recoveredMaintId) return; // 복구 대상은 삭제 제외
                if (!payload.maint_deletes) payload.maint_deletes = [];
                payload.maint_deletes.push(m.id.toString());
                data.maint = data.maint.filter(item => item.id !== m.id);
            });
        });

        // [추가 고도화] 완료 취소 시, 기존 자식 추가작업들의 originalLogId를 새로 복구된 예정 일정 ID(recoveredMaintId)로 연쇄 갱신
        if (recoveredMaintId) {
            const childLogs = data.logs.filter(l => l.originalLogId && l.originalLogId.toString() === id.toString());
            const childMaints = data.maint.filter(m => m.originalLogId && m.originalLogId.toString() === id.toString());
            
            childLogs.forEach(cLog => {
                cLog.originalLogId = recoveredMaintId.toString();
                if (!payload.log_upserts) payload.log_upserts = [];
                if (!payload.log_upserts.some(item => item.id == cLog.id)) {
                    payload.log_upserts.push(cLog);
                }
            });
            
            childMaints.forEach(cMaint => {
                cMaint.originalLogId = recoveredMaintId.toString();
                if (!payload.maint_upserts.some(item => item.id == cMaint.id)) {
                    payload.maint_upserts.push(cMaint);
                }
            });
        }

        const success = await window.syncHistoryTransaction(site, equip, payload);
        if (!success) {
            alert('서버 통신 오류로 작업 완료 취소에 실패했습니다.');
            location.reload();
            return;
        }

        localStorage.setItem(key, JSON.stringify(data));

        if (typeof addSystemLog === 'function') {
            addSystemLog('CANCEL_COMPLETION', equip, `예정일: ${logDate}, 내용: ${logContent}`);
        }

        alert('작업 완료가 취소되었습니다.');

        if (typeof window.renderCalendar === 'function') window.renderCalendar();
        if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
        if (typeof renderDetails === 'function') renderDetails();
        if (typeof renderLogs === 'function') renderLogs();

        const popup = document.getElementById('calendar-popup');
        if (popup && popup.style.display !== 'none') {
            const dateTitle = document.getElementById('popup-date-title');
            if (dateTitle) {
                const dateStr = dateTitle.textContent;
                let dayEvents = [];
                if (typeof window.getScheduleForCalendar === 'function') {
                    const allEvents = window.getScheduleForCalendar();
                    dayEvents = allEvents[dateStr] || [];
                }

                const searchInput = document.getElementById('calendar-search');
                const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

                if (keyword || (typeof currentSearchFilters !== 'undefined' && (currentSearchFilters.site || currentSearchFilters.equip))) {
                    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                    dayEvents = dayEvents.filter(event => {
                        const equipParts = event.equip ? event.equip.split('::') : [];
                        const rawName = equipParts[0] || '';
                        const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
                        const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;

                        const kwStr = keyword.replace(/\s/g, '');
                        const matchKeyword = !keyword || (
                            (event.site && event.site.toLowerCase().includes(keyword)) || 
                            (event.equip && event.equip.toLowerCase().includes(keyword)) || 
                            (displayName.toLowerCase().includes(keyword)) || 
                            (event.content && event.content.toLowerCase().includes(keyword)) || 
                            (event.worker && event.worker.toLowerCase().includes(keyword)) ||
                            (event.type && event.type.toLowerCase().includes(keyword)) ||
                            (event.detailType && event.detailType.toLowerCase().includes(keyword)) ||
                            (event.content && event.content.replace(/\s/g, '').toLowerCase().includes(kwStr)) ||
                            (event.detailType && event.detailType.replace(/\s/g, '').toLowerCase().includes(kwStr))
                        );
                        const matchSite = typeof window.isSiteMatched === 'function' ? window.isSiteMatched(event.site, currentSearchFilters.site) : ((typeof currentSearchFilters !== 'undefined' && !currentSearchFilters.site) || event.site === currentSearchFilters.site);
                        const matchEquip = (typeof currentSearchFilters !== 'undefined' && !currentSearchFilters.equip) || event.equip === currentSearchFilters.equip || rawName === currentSearchFilters.equip || displayName === currentSearchFilters.equip;
                        return matchKeyword && matchSite && matchEquip;
                    });
                }

                if (typeof window.openCalendarPopup === 'function') window.openCalendarPopup(dateStr, dayEvents);
            }
        }

        document.getElementById('event-detail-modal').style.display = 'none';
        if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
    } catch (error) {
        console.error('Cancel Completion Error:', error);
        alert('작업 취소 처리 중 알 수 없는 오류가 발생했습니다. 브라우저 콘솔을 확인해주세요.');
    }
}

/* --- 1.5 전역 노출 (Exports) --- */
window.setupEventDetailModal = setupEventDetailModal;
window.openEventDetailModal = openEventDetailModal;
window.buildDetailDropdown = buildDetailDropdown;
window.hasDetailUnsavedChanges = hasDetailUnsavedChanges;
window.saveDetailChanges = saveDetailChanges;
window.completeScheduleWork = completeScheduleWork;
window.cancelScheduleCompletion = cancelScheduleCompletion;

/* ==========================================================================
   2. 작업 등록 모달 (Register Schedule Modal)
   ========================================================================== */

/* --- 2.1 초기화 (Setup) --- */
function setupRegisterScheduleModal() {
    const modal = document.getElementById('register-schedule-modal');
    const closeBtn = document.getElementById('btn-close-register-modal');
    const confirmBtn = document.getElementById('btn-confirm-register-schedule');
    const siteSelect = document.getElementById('register-site-select');
    const equipSelect = document.getElementById('register-equip-select');
    const typeSelect = document.getElementById('register-type-select');
    const detailTypeSelect = document.getElementById('register-detail-type-select');

    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => {
        modal.style.display = 'none';
        window.currentAddWorkLogId = null; // 팝업 닫을 시 상태 초기화
        window.openDetailAfterRegister = false; // [추가] 팝업 닫을 시 상세 팝업 오픈 플래그 초기화

        // [추가] 팝업 닫을 때 제안박스 선택 상태 초기화
        const contentList = document.getElementById('register-content-list');
        if (contentList) contentList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));
        const partList = document.getElementById('register-part-list');
        if (partList) partList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));

        if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
    };

    if (siteSelect) {
        siteSelect.onchange = () => {
            updateRegisterEquipSelect(siteSelect.value);
        };
    }

    if (equipSelect) {
        equipSelect.onchange = () => {
            if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
        };

        if (!document.getElementById('register-equip-wrapper')) {
            equipSelect.style.display = 'none';

            const wrapper = document.createElement('div');
            wrapper.id = 'register-equip-wrapper';
            wrapper.className = 'log-select-wrapper';
            wrapper.style.flex = '1';
            wrapper.style.margin = '0';
            wrapper.style.minWidth = '100px';
            const templateContent = getTemplateContent('register-equip-template');
            if (templateContent) {
                wrapper.appendChild(templateContent);
            }

            equipSelect.parentNode.insertBefore(wrapper, equipSelect.nextSibling);

            const trigger = document.getElementById('register-equip-trigger');
            const dropdown = document.getElementById('register-equip-dropdown');
            const searchInput = document.getElementById('register-equip-search');

            trigger.onclick = (e) => {
                e.stopPropagation();
                if (trigger.classList.contains('disabled')) return;
                document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
                dropdown.classList.toggle('show');
                if (dropdown.classList.contains('show') && window.renderEquipSuggestions) {
                    window.renderEquipSuggestions(searchInput.value.trim());
                    searchInput.focus();
                }
            };
            searchInput.onclick = (e) => e.stopPropagation();
            searchInput.oninput = (e) => {
                if (window.renderEquipSuggestions) window.renderEquipSuggestions(e.target.value.trim());
            };

            equipSelect.parentNode.insertBefore(wrapper, equipSelect.nextSibling);
        }
    }

    if (typeSelect) {
        typeSelect.onchange = () => {
            if (typeof updateRegisterDetailTypeOptions === 'function') updateRegisterDetailTypeOptions();
        };
    }

    if (detailTypeSelect) {
        detailTypeSelect.onchange = () => {
            const typeVal = typeSelect ? typeSelect.value : '';
            if (typeVal === '비정기' && typeof updateRegisterDetailType2Options === 'function') {
                updateRegisterDetailType2Options();
            } else if (typeof updateRegisterContentOptions === 'function') {
                updateRegisterContentOptions();
            }
        };
    }

    const detailType2Select = document.getElementById('register-detail-type2-select');
    if (detailType2Select) {
        detailType2Select.onchange = () => {
            if (typeof updateRegisterContentOptions === 'function') updateRegisterContentOptions();
        };
    }

    if (confirmBtn) {
        confirmBtn.onclick = confirmRegisterSchedule;
    }

    const rTrigger = document.getElementById('register-content-trigger');
    const rDropdown = document.getElementById('register-content-dropdown');
    if (rTrigger && rDropdown) rTrigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== rDropdown) d.classList.remove('show'); });
        rDropdown.classList.toggle('show');
    };
    const btnAdd = document.getElementById('btn-register-content-add');
    if (btnAdd && rDropdown) btnAdd.addEventListener('click', () => rDropdown.classList.remove('show'));

    window.updateRegisterInputStates = function () {
        const modal = document.getElementById('register-schedule-modal');
        if (!modal) return;
        const inputs = modal.querySelectorAll('input:not(#register-content-search), select');
        inputs.forEach(el => {
            const checkValue = () => {
                if (el.value) {
                    el.classList.add('has-value');
                    el.classList.remove('error-border');
                } else {
                    el.classList.remove('has-value');
                }
            };
            el.removeEventListener('input', checkValue);
            el.removeEventListener('change', checkValue);
            el.addEventListener('input', checkValue);
            el.addEventListener('change', checkValue);
            checkValue();
        });
    };

    window.updateRegisterInputStates();

    // [추가] 세부구분 2 입력창을 세부구분 1 우측으로 이동시키고 제목(Row) 숨김
    const detailType2Row = document.getElementById('register-detail-type2-row');

    if (detailTypeSelect && detailType2Select && detailTypeSelect.parentNode !== detailType2Select.parentNode) {
        detailTypeSelect.parentNode.insertBefore(detailType2Select, detailTypeSelect.nextSibling);
        detailTypeSelect.style.flex = '1';
        detailType2Select.style.flex = '1';
        detailType2Select.style.marginLeft = '5px';
        if (detailType2Row) detailType2Row.style.display = 'none';
    }

    // [추가] 파트 선택 래퍼 동적으로 등록 (모달 내부)
    let partRow = document.getElementById('register-part-row');
    if (!partRow) {
        const contentWrapper = document.getElementById('register-content-wrapper');
        if (contentWrapper) {
            const formRow = contentWrapper.closest('.form-row');
            partRow = document.createElement('div');
            partRow.id = 'register-part-row';
            partRow.className = 'form-row';
            partRow.style.display = 'none';
            const templateContent = getTemplateContent('register-part-row-template');
            if (templateContent) {
                partRow.appendChild(templateContent);
            } else {
                // [추가] 템플릿 로드 실패 시 강제 생성 (작업 등록 모달 세부 내용 사라짐 버그 해결)
                partRow.innerHTML = `
                    <label class="form-label" style="width: 80px; flex-shrink: 0;">세부 내용</label>
                    <div id="register-part-wrapper" class="log-select-wrapper" style="flex: 1; min-width: 0; position: relative; margin: 0;">
                        <div id="register-part-trigger" class="log-select-trigger" style="min-height:30px; display:flex; align-items:center; background:#0d1117; color:#8b949e; border:1px solid #30363d; border-radius:4px; padding:6px 10px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;">물품 선택</div>
                        <div id="register-part-dropdown" class="log-select-dropdown" style="width:100%; position:absolute; top:100%; left:0; z-index:1000; margin-top:4px; background:#161b22; border:1px solid #30363d; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5); box-sizing:border-box;">
                            <input type="text" id="register-part-search" class="dropdown-search-input" placeholder="검색..." style="width: calc(100% - 12px); margin: 5px 6px; padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; color: #e6edf3; border-radius: 4px; box-sizing: border-box;" autocomplete="off">
                            <div id="register-part-list" class="log-select-list" style="max-height: 200px; overflow-y: auto; padding: 8px;"></div>
                            <div class="log-select-footer" style="padding: 8px; border-top: 1px solid #30363d; background: #21262d; display: flex;">
                                <button type="button" id="btn-register-part-add" class="btn-blue-sm" style="flex: 1; width: 100%;">선택 완료</button>
                            </div>
                        </div>
                    </div>
                `;
            }
            formRow.parentNode.insertBefore(partRow, formRow.nextSibling);
            const pt = document.getElementById('register-part-trigger');
            const pd = document.getElementById('register-part-dropdown');
            const pa = document.getElementById('btn-register-part-add') || (pd ? pd.querySelector('.btn-blue-sm') : null);

            if (pt && pd) {
                pt.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (pt.classList.contains('disabled')) return;
                    document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== pd) d.classList.remove('show'); });
                    pd.classList.toggle('show');
                });
                pt.addEventListener('click', (e) => e.stopPropagation());

                pd.addEventListener('pointerdown', (e) => e.stopPropagation());
                pd.addEventListener('click', (e) => e.stopPropagation());

                const ps = pd.querySelector('.dropdown-search-input');
                if (ps) {
                    ps.addEventListener('pointerdown', (e) => e.stopPropagation());
                    ps.addEventListener('click', (e) => e.stopPropagation());
                }
            }
            if (pa && pd) {
                pa.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pd.classList.remove('show'); });
                pa.addEventListener('click', (e) => e.stopPropagation());
            }
        }
    }

    // [추가] 작업자 선택 드롭다운 동적 생성 및 렌더링 (공수 입력칸 대체)
    let mdHidden = document.getElementById('register-md');
    let workerHidden = document.getElementById('register-worker-hidden');

    if (mdHidden && !document.getElementById('register-worker-wrapper')) {
        // 공수 라벨을 작업자로 변경
        const mdLabel = mdHidden.previousElementSibling;
        if (mdLabel && mdLabel.tagName === 'LABEL') {
            mdLabel.textContent = '작업자';
        }

        if (!workerHidden) {
            workerHidden = document.createElement('input');
            workerHidden.type = 'hidden';
            workerHidden.id = 'register-worker-hidden';
            mdHidden.parentNode.insertBefore(workerHidden, mdHidden);
        }

        const wrapper = document.createElement('div');
        wrapper.id = 'register-worker-wrapper';
        wrapper.className = 'log-select-wrapper';
        wrapper.style.flex = '1';
        wrapper.style.minWidth = '100px';
        wrapper.style.margin = '0';

        const templateContent = getTemplateContent('register-worker-template');
        if (templateContent) {
            wrapper.appendChild(templateContent);
        }
        mdHidden.parentNode.insertBefore(wrapper, mdHidden);
        mdHidden.type = 'hidden'; // 공수 입력칸 숨김 처리
    }

    const workerTrigger = document.getElementById('register-worker-trigger');
    const workerDropdown = document.getElementById('register-worker-dropdown');
    const workerSearch = document.getElementById('register-worker-search');
    const workerList = document.getElementById('register-worker-list');
    const workerConfirmBtn = document.getElementById('btn-register-worker-confirm');

    // 생성 후 변수 재할당
    workerHidden = document.getElementById('register-worker-hidden');
    mdHidden = document.getElementById('register-md');

    if (workerTrigger && workerDropdown) {
        workerTrigger.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== workerDropdown) d.classList.remove('show'); });
            workerDropdown.classList.toggle('show');
            if (workerDropdown.classList.contains('show')) renderRegisterWorkers(workerSearch ? workerSearch.value.trim() : '');
        };

        const renderRegisterWorkers = async (searchTerm = '') => {
            // [수정] 선택된 사업장을 기준으로 작업자 목록을 가져옴
            const siteSelect = document.getElementById('register-site-select');
            const site = siteSelect ? siteSelect.value : null;
            const workers = (typeof window.fetchWorkerNames === 'function') ? await window.fetchWorkerNames(site) : [];
            const currentSelected = workerHidden.value ? workerHidden.value.split(',').map(s => s.trim()).filter(Boolean) : [];
            const allWorkers = workers.map(w => typeof w === 'string' ? { name: w, department: '', position: '', site: '' } : w);
            let displayWorkers = allWorkers;

            if (searchTerm) {
                const kw = searchTerm.toLowerCase();
                displayWorkers = allWorkers.filter(w => w.name.toLowerCase().includes(kw) || w.department.toLowerCase().includes(kw) || w.position.toLowerCase().includes(kw));
            }

            // [요청] 검색 시에도 기존 선택 항목이 사라지지 않도록 보정
            const displayedNames = new Set(displayWorkers.map(w => w.name));
            currentSelected.forEach(selectedName => {
                if (!displayedNames.has(selectedName)) {
                    const workerToAdd = allWorkers.find(w => w.name === selectedName);
                    if (workerToAdd) displayWorkers.unshift(workerToAdd);
                    else displayWorkers.unshift({ name: selectedName, department: '', position: '' });
                }
            });

            // 선택된 이름이 최상단으로 오도록 정렬
            const userSite = sessionStorage.getItem('userSite') || '';
            displayWorkers.sort((a, b) => {
                const aSelected = currentSelected.includes(a.name);
                const bSelected = currentSelected.includes(b.name);
                if (aSelected && !bSelected) return -1;
                if (!aSelected && bSelected) return 1;

                // [추가] 로그인한 계정과 같은 사업장 작업자 우선 정렬
                const aIsSameSite = a.site === userSite;
                const bIsSameSite = b.site === userSite;
                if (aIsSameSite && !bIsSameSite) return -1;
                if (!aIsSameSite && bIsSameSite) return 1;

                return a.name.localeCompare(b.name); // 이름순 정렬
            });

            renderWorkerListItems(workerList, displayWorkers, currentSelected, () => {
                updateRegisterWorkerSelection();
            });
        };

        const updateRegisterWorkerSelection = () => {
            const selected = Array.from(workerList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
            workerHidden.value = selected.join(', ');
            if (selected.length > 0) workerTrigger.textContent = selected.join(' ');
            else workerTrigger.textContent = '작업자 선택';
            workerTrigger.title = selected.join(', ');
            workerTrigger.classList.remove('error-border');
            if (workerHidden.value) workerTrigger.classList.add('has-value');
            else workerTrigger.classList.remove('has-value');

            // [추가] 작업자 수에 맞춰 공수 자동 계산
            if (mdHidden) mdHidden.value = selected.length;
        };

        if (workerSearch) {
            workerSearch.onclick = (e) => e.stopPropagation();
            workerSearch.oninput = (e) => renderRegisterWorkers(e.target.value.trim());
        }
        if (workerConfirmBtn) workerConfirmBtn.onclick = (e) => { e.stopPropagation(); workerDropdown.classList.remove('show'); };
    }
}

/* --- 2.2 모달 열기 (Open) --- */
function openRegisterScheduleModal(dateStr, presetData = null) {
    if (typeof window.checkSessionValid === 'function' && !window.checkSessionValid()) return;
    const modal = document.getElementById('register-schedule-modal');
    const dateDisplay = document.getElementById('register-date-display');
    const siteSelect = document.getElementById('register-site-select');
    const equipSelect = document.getElementById('register-equip-select');
    const typeSelect = document.getElementById('register-type-select');

    if (!modal) return;

    // [추가] 팝업 열 때 이전 물품 선택 상태 초기화
    if (!presetData || !presetData.content) {
        const contentList = document.getElementById('register-content-list');
        if (contentList) contentList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));
        const partList = document.getElementById('register-part-list');
        if (partList) partList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));
    }

    // [추가] 팝업 진입 경로에 따라 모달 타이틀 동적 변경
    const modalTitle = modal.querySelector('.modal-header h3');
    if (modalTitle) {
        if (window.currentAddWorkLogId) {
            modalTitle.textContent = '추가 작업 등록';
        } else {
            modalTitle.textContent = '작업 등록';
        }
    }

    if (dateDisplay) dateDisplay.value = dateStr;

    const data = getDeviceDataMap();
    const mdInput = document.getElementById('register-md');
    const workerHidden = document.getElementById('register-worker-hidden');
    const workerTrigger = document.getElementById('register-worker-trigger');

    // [추가] 신규 작업/일정 등록 모달 시 공수 입력 제한
    if (mdInput) {
        mdInput.oninput = function () {
            const workerCount = workerHidden && workerHidden.value ? workerHidden.value.split(',').map(s => s.trim()).filter(Boolean).length : 0;
            const currentMd = parseFloat(this.value);
            if (!isNaN(currentMd) && currentMd > workerCount) {
                alert(`공수(M/D)는 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
                this.value = workerCount;
            }
        };
    }

    if (workerHidden && workerTrigger) {
        // 로그인한 사용자 이름으로 초기 설정
        const userName = sessionStorage.getItem('userName') || sessionStorage.getItem('userId') || '';

        if (presetData && presetData.worker) {
            // [추가] 추가작업 등록 등 presetData에 작업자가 있는 경우
            workerHidden.value = presetData.worker;
            workerTrigger.textContent = presetData.worker;
            workerTrigger.title = presetData.worker;
            workerTrigger.classList.add('has-value');
            if (mdInput) mdInput.value = presetData.worker.split(',').filter(Boolean).length;
        } else if (userName && !presetData) {
            workerHidden.value = userName;
            workerTrigger.textContent = userName;
            workerTrigger.title = userName;
            workerTrigger.classList.add('has-value');
            if (mdInput) mdInput.value = 1;
        } else {
            workerHidden.value = '';
            workerTrigger.textContent = '작업자 선택';
            workerTrigger.title = '';
            workerTrigger.classList.remove('has-value');
            if (mdInput) mdInput.value = '';
        }
    }

    siteSelect.innerHTML = '<option value="">사업장 선택</option>';
    Object.keys(data).forEach(site => {
        const option = document.createElement('option');
        option.value = site;
        option.textContent = site;
        siteSelect.appendChild(option);
    });

    equipSelect.innerHTML = '<option value="">장비 선택</option>';
    equipSelect.disabled = true;

    // [추가] 현재 검색 필터가 적용되어 있다면 해당 사업장/장비 자동 선택
    if (currentSearchFilters.site) {
        siteSelect.value = currentSearchFilters.site;
        // 사업장이 선택되었으므로 장비 목록 업데이트
        updateRegisterEquipSelect(currentSearchFilters.site);

        if (currentSearchFilters.equip) {
            // 장비 필터가 있다면 해당 장비 선택 시도
            let targetValue = currentSearchFilters.equip;
            let hasOption = Array.from(equipSelect.options).some(opt => opt.value === targetValue);

            // 정확한 매칭이 없으면 모델명만으로 매칭 시도 (필터는 모델명, 옵션은 모델명::Serial인 경우)
            if (!hasOption) {
                const partialMatch = Array.from(equipSelect.options).find(opt => opt.value.split('::')[0] === targetValue);
                if (partialMatch) {
                    targetValue = partialMatch.value;
                    hasOption = true;
                }
            }

            if (hasOption) {
                equipSelect.value = targetValue;
                const equipTrigger = document.getElementById('register-equip-trigger');
                if (equipTrigger) {
                    const parts = targetValue.split('::');
                    const name = parts[0] || '';
                    const serial = parts.length > 1 ? parts[1] : '';
                    const key = `details_${currentSearchFilters.site}_${targetValue}`;
                    const detailData = JSON.parse(localStorage.getItem(key)) || {};
                    const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                    let displayValue = name;
                    if (custName) {
                        displayValue = `${name} [${custName}]`;
                    } else if (serial) {
                        displayValue = `${name} [${serial}]`;
                    }

                    equipTrigger.textContent = displayValue;
                    equipTrigger.title = displayValue;
                    equipTrigger.style.color = '#fff';
                    equipTrigger.classList.add('has-value');
                }
            }
        }
    }

    if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();

    // [추가] presetData가 있으면 폼 필드 미리 채우기
    if (presetData) {
        const rTypeSelect = document.getElementById('register-type-select');
        const rDetailTypeSelect = document.getElementById('register-detail-type-select');
        const rDetailType2Select = document.getElementById('register-detail-type2-select');

        if (rTypeSelect && presetData.type) {
            rTypeSelect.value = presetData.type; // [수정] presetData.type으로 초기화
            rTypeSelect.dispatchEvent(new Event('change'));
        }

        setTimeout(() => {
            let targetDetailType = presetData.detailType || '';
            let targetDetailType2 = presetData.detailType2 || '';

            // [추가] 괄호 [ ] 또는 부등호 > 가 포함된 경우 파싱하여 분리
            if (targetDetailType.includes('[')) {
                const parts = targetDetailType.split('[');
                targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].replace(']', '').trim();
            } else if (targetDetailType.includes(' > ')) {
                const parts = targetDetailType.split(' > ');
                targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].trim();
            }

            if (targetDetailType2.includes('[')) {
                const parts = targetDetailType2.split('[');
                if (!targetDetailType || targetDetailType === targetDetailType2) targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].replace(']', '').trim();
            } else if (targetDetailType2.includes(' > ')) {
                const parts = targetDetailType2.split(' > ');
                if (!targetDetailType || targetDetailType === targetDetailType2) targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].trim();
            }

            if (rDetailTypeSelect && targetDetailType) {
                // [추가] 세부 구분 옵션에 없는 경우 강제 추가하여 데이터 유실 방지
                let hasOption = Array.from(rDetailTypeSelect.options).some(opt => opt.value === targetDetailType);
                if (!hasOption) {
                    const opt = document.createElement('option');
                    opt.value = targetDetailType;
                    opt.textContent = targetDetailType;
                    rDetailTypeSelect.appendChild(opt);
                }
                rDetailTypeSelect.value = targetDetailType;
                rDetailTypeSelect.dispatchEvent(new Event('change'));
            }

            setTimeout(() => {
                if (rDetailType2Select && targetDetailType2) {
                    let hasOption2 = Array.from(rDetailType2Select.options).some(opt => opt.value === targetDetailType2);
                    if (!hasOption2) {
                        const opt = document.createElement('option');
                        opt.value = targetDetailType2;
                        opt.textContent = targetDetailType2;
                        rDetailType2Select.appendChild(opt);
                    }
                    rDetailType2Select.value = targetDetailType2;
                    rDetailType2Select.dispatchEvent(new Event('change'));
                }

                // [수정] presetData.content로 내용 필드 미리 채우기
                const contentInput = document.getElementById('register-content-input');
                const contentWrapper = document.getElementById('register-content-wrapper');
                const contentTrigger = document.getElementById('register-content-trigger');

                if (contentWrapper && contentWrapper.style.display !== 'none') {
                    if (contentTrigger) {
                        if (presetData.content) {
                            contentTrigger.textContent = presetData.content;
                            contentTrigger.title = presetData.content;
                            contentTrigger.classList.add('has-value'); // [추가] 색상 변경 트리거
                        } else {
                            contentTrigger.textContent = '항목 선택';
                            contentTrigger.title = '';
                            contentTrigger.classList.remove('has-value'); // [추가] 초기 상태로 리셋
                        }
                        // 드롭다운 리스트의 실제 항목 선택은 복잡하므로, 여기서는 트리거 텍스트만 설정
                    }
                } else if (contentInput) {
                    contentInput.value = presetData.content || '';
                }

                const partRow = document.getElementById('register-part-row');
                if (partRow) {
                    // [수정] 작업 등록 시에는 하위 세부 내용 물품 선택창을 원천 비활성화 (항상 숨김)
                    partRow.style.display = 'none';
                }
            }, 100);
        }, 100);
    }

    modal.style.display = 'flex';

    setTimeout(() => {
        if (typeof window.updateRegisterInputStates === 'function') window.updateRegisterInputStates();
    }, 50);
}

/* --- 2.3 UI 및 데이터 헬퍼 (UI & Helpers) --- */
function updateRegisterEquipSelect(site) {
    const equipSelect = document.getElementById('register-equip-select');
    const equipTrigger = document.getElementById('register-equip-trigger');
    const equipSuggestionList = document.getElementById('register-equip-suggestions');
    const equipSearch = document.getElementById('register-equip-search');
    const equipDropdown = document.getElementById('register-equip-dropdown');

    equipSelect.innerHTML = '<option value="">장비 선택</option>';

    if (equipTrigger) {
        if (!site) {
            equipTrigger.textContent = '사업장을 먼저 선택해주세요';
            equipTrigger.title = '';
            equipTrigger.classList.add('disabled');
            equipTrigger.style.color = '#8b949e';
            equipTrigger.style.cursor = 'not-allowed';
            equipTrigger.style.opacity = '0.5';
            if (equipSearch) equipSearch.value = '';
        } else {
            equipTrigger.textContent = '장비 선택';
            equipTrigger.title = '';
            equipTrigger.classList.remove('disabled');
            equipTrigger.style.color = '#fff';
            equipTrigger.style.cursor = 'pointer';
            equipTrigger.style.opacity = '1';
            if (equipSearch) equipSearch.value = '';
        }
    }

    if (!site) {
        equipSelect.disabled = true;
        if (equipSuggestionList) equipSuggestionList.innerHTML = '';
        return;
    }

    const data = getDeviceDataMap();
    const equips = data[site] ? [...data[site]] : [];

    equips.forEach(equip => {
        const option = document.createElement('option');
        option.value = equip;
        const parts = equip.split('::');
        const name = parts[0] || '';
        const serial = parts.length > 1 ? parts[1] : '';
        const custNameFromKey = parts.length > 2 ? parts[2] : '';
        const key = `details_${site}_${equip}`;
        const detailData = JSON.parse(localStorage.getItem(key)) || {};
        const custName = custNameFromKey || ((detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '');

        let displayValue = name;
        if (custName) {
            displayValue = `${name} [${custName}]`;
        } else if (serial) {
            displayValue = `${name} [${serial}]`;
        }
        option.textContent = displayValue;
        equipSelect.appendChild(option);
    });

    equipSelect.disabled = false;

    if (equipSuggestionList) {
        window.renderEquipSuggestions = (searchTerm = '') => {
            equipSuggestionList.innerHTML = '';
            const keywords = searchTerm.toLowerCase().split(/\s+/);

            let matches = equips.filter(equip => {
                const parts = equip.split('::');
                const name = parts[0] || '';
                const serial = parts.length > 1 ? parts[1] : '';
                const custNameFromKey = parts.length > 2 ? parts[2] : '';

                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custName = custNameFromKey || ((detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '');

                const text = `${name} ${serial} ${custName}`.toLowerCase();
                return keywords.every(kw => text.includes(kw));
            });

            if (matches.length > 0) {
                matches.forEach(equip => {
                    const parts = equip.split('::');
                    const name = parts[0] || '';
                    const serial = parts.length > 1 ? parts[1] : '';

                    const key = `details_${site}_${equip}`;
                    const detailData = JSON.parse(localStorage.getItem(key)) || {};
                    const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                    const tpl = getTemplateContent('equip-suggestion-item-template');
                    if (tpl) {
                        const li = tpl.querySelector('.log-select-item');

                        let displayValueHtml = escapeHtml(name);
                        if (custName) {
                            displayValueHtml += ` <span style="color:#3fb950;">[${escapeHtml(custName)}]</span>`;
                        } else if (serial) {
                            displayValueHtml += ` <span style="color:#3fb950;">[${escapeHtml(serial)}]</span>`;
                        }

                        // 기존 템플릿의 분리된 구조를 무시하고 자연스럽게 한 줄에 표시
                        const contentDiv = li.querySelector('.suggestion-item-content') || li;
                        contentDiv.innerHTML = `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayValueHtml}</span>`;

                        li.addEventListener('pointerdown', (e) => {
                            e.preventDefault();
                            equipSelect.value = equip;

                            let displayValue = name;
                            if (custName) {
                                displayValue = `${name} [${custName}]`;
                            } else if (serial) {
                                displayValue = `${name} [${serial}]`;
                            }
                            equipTrigger.textContent = displayValue;
                            equipTrigger.title = displayValue;
                            equipTrigger.classList.remove('error-border');
                            equipTrigger.classList.add('has-value');

                            equipSuggestionList.style.display = 'none';
                            if (equipDropdown) equipDropdown.classList.remove('show');
                            if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
                            if (typeof window.updateRegisterInputStates === 'function') window.updateRegisterInputStates();
                        });
                        equipSuggestionList.appendChild(li);
                    }
                });
                equipSuggestionList.style.display = 'block';
            } else {
                equipSuggestionList.innerHTML = '<div class="log-select-empty-msg" style="padding: 10px;">검색 결과가 없습니다.</div>';
                equipSuggestionList.style.display = 'block';
            }
        };
    }

    if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
}

/* --- 2.4 작업 등록 동적 드롭다운 헬퍼 (Dynamic Dropdowns) --- */
window.updateRegisterTypeOptions = function () {
    const rTypeSelect = document.getElementById('register-type-select');
    if (!rTypeSelect) return;
    const categories = ['정기', '비정기', '고객대응', '용액제조', '온라인점검'];
    const currentVal = rTypeSelect.value;

    rTypeSelect.innerHTML = '<option value="">선택</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        rTypeSelect.appendChild(opt);
    });
    if (currentVal && categories.includes(currentVal)) rTypeSelect.value = currentVal;
    updateRegisterDetailTypeOptions();
};

window.updateRegisterDetailTypeOptions = function () {
    const rEquipSelect = document.getElementById('register-equip-select');
    const rTypeSelect = document.getElementById('register-type-select');
    const rDetailTypeSelect = document.getElementById('register-detail-type-select');
    const rDetailType2Select = document.getElementById('register-detail-type2-select');
    const rDetailType2Row = document.getElementById('register-detail-type2-row');

    if (!rTypeSelect || !rDetailTypeSelect) return;
    const type = rTypeSelect.value;
    rDetailTypeSelect.innerHTML = '';

    if (!type) {
        rDetailTypeSelect.innerHTML = '<option value="">구분 먼저 선택</option>';
        rDetailTypeSelect.disabled = true;
        if (rDetailType2Select) {
            rDetailType2Select.style.display = 'none';
            rDetailType2Select.value = '';
            if (rDetailType2Row) rDetailType2Row.style.display = 'none';
        }
        updateRegisterContentOptions();
        return;
    }

    rDetailTypeSelect.disabled = false;

    if (rDetailType2Select) {
        if (type === '비정기') {
            rDetailType2Select.style.display = 'inline-block';
            if (rDetailType2Row) rDetailType2Row.style.display = 'none'; // [수정] 폼 합치면서 기존 행 숨김 유지
        } else {
            rDetailType2Select.style.display = 'none';
            rDetailType2Select.value = '';
            if (rDetailType2Row) rDetailType2Row.style.display = 'none';
        }
    }

    const equipKey = rEquipSelect ? rEquipSelect.value : '';
    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    const key = `${equipKey}::${type}`;
    const defaultSubCategories = {
        '정기': ['PM 점검'],
        '비정기': ['Alarm', 'Hunting', 'Data / Para 이상', '기타'],
        '고객대응': ['순회 점검', '프로그램 변경 / 평가', '설비 평가', 'Parts 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '파티클 필터 교체', '기타'],
        '용액제조': ['용액제조'],
        '온라인점검': ['온라인점검']
    };

    let subCategories = catData[key] && catData[key].length > 0 ? catData[key] : defaultSubCategories[type] || [];

    if (subCategories.length === 0) {
        rDetailTypeSelect.innerHTML = '<option value="">세부구분 없음 (직접입력)</option>';
        rDetailTypeSelect.disabled = true;
    } else {
        rDetailTypeSelect.innerHTML = '<option value="">선택</option>';
        subCategories.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub;
            opt.textContent = sub;
            rDetailTypeSelect.appendChild(opt);
        });
    }
    updateRegisterContentOptions();
};

window.updateRegisterDetailType2Options = function () {
    const rEquipSelect = document.getElementById('register-equip-select');
    const rTypeSelect = document.getElementById('register-type-select');
    const rDetailTypeSelect = document.getElementById('register-detail-type-select');
    const rDetailType2Select = document.getElementById('register-detail-type2-select');

    if (!rTypeSelect || !rDetailTypeSelect || !rDetailType2Select) return;
    const type = rTypeSelect.value;
    const detailType = rDetailTypeSelect.value;

    rDetailType2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분</option>';
    if (type !== '비정기' || !detailType) {
        rDetailType2Select.disabled = true;
        updateRegisterContentOptions();
        return;
    }
    rDetailType2Select.disabled = false;
    const equipKey = rEquipSelect ? rEquipSelect.value : '';

    const catData = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
    const key = `${equipKey}::${type}::${detailType}`;
    const defaultSubCategories2 = {
        'Alarm': ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람'],
        'Hunting': ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅'],
        'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈'],
        '기타': ['배수 펌프 이슈', '구동 이상']
    };

    let subCategories2 = catData[key] || [];
    if (subCategories2.length === 0 && type === '비정기' && defaultSubCategories2[detailType]) {
        subCategories2 = [...defaultSubCategories2[detailType]];
    }

    if (subCategories2.length === 0) {
        rDetailType2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 없음</option>';
        rDetailType2Select.disabled = true;
    } else if (subCategories2.length === 1) {
        rDetailType2Select.innerHTML = `<option value="${subCategories2[0]}" selected>${subCategories2[0]}</option>`;
    } else {
        rDetailType2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분</option>';
        subCategories2.forEach(sub => { rDetailType2Select.insertAdjacentHTML('beforeend', `<option value="${sub}">${sub}</option>`); });
    }
    updateRegisterContentOptions();
};

window.updateRegisterContentOptions = function () {
    const rEquipSelect = document.getElementById('register-equip-select');
    const rTypeSelect = document.getElementById('register-type-select');
    const rDetailTypeSelect = document.getElementById('register-detail-type-select');
    const rDetailType2Select = document.getElementById('register-detail-type2-select');
    const wrapper = document.getElementById('register-content-wrapper');
    const list = document.getElementById('register-content-list');
    const trigger = document.getElementById('register-content-trigger');
    const input = document.getElementById('register-content-input');

    if (!wrapper || !list || !trigger || !input) return;

    const equipKey = rEquipSelect ? rEquipSelect.value : '';
    const type = rTypeSelect ? rTypeSelect.value : '';
    const detailType = rDetailTypeSelect ? rDetailTypeSelect.value : '';
    const detailType2 = rDetailType2Select && rDetailType2Select.style.display !== 'none' ? rDetailType2Select.value : '';

    if (!type || (!detailType && !rDetailTypeSelect.disabled)) {
        wrapper.style.display = 'none';
        input.style.display = 'block';
        input.placeholder = type ? '세부구분을 먼저 선택하세요' : '구분을 먼저 선택하세요';
        input.value = '';
        input.disabled = true;
        return;
    }

    if (type === '비정기' && (!detailType2 && !rDetailType2Select.disabled)) {
        wrapper.style.display = 'none';
        input.style.display = 'block';
        input.placeholder = '세부 구분을 먼저 선택하세요';
        input.value = '';
        input.disabled = true;
        return;
    }

    input.disabled = false;
    const itemData = JSON.parse(localStorage.getItem('check_type_items')) || {};
    let chkKey;
    if (type === '비정기') {
        chkKey = `${equipKey}::${type}::${detailType}::${detailType2}`;
    } else {
        chkKey = `${equipKey}::${type}::${detailType}`;
    }
    let items = itemData[chkKey] || [];

    if (items.length === 0) {
        if (type === '비정기' && ['Alarm', 'Hunting', 'Data / Para 이상', '기타'].includes(detailType)) {
            const defaultList = [
                "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
                "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
            ];
            items = defaultList.map(content => ({ content: content }));
        } else if (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) {
            const equipName = equipKey.split('::')[0];
            const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            let matchedItems = adminItems.filter(item => {
                if (!item.equip) return false;
                const equips = item.equip.split(',').map(e => e.trim());
                return equips.includes(equipName);
            });

            if (matchedItems.length === 0) {
                matchedItems = adminItems;
            }
            items = matchedItems.map(mItem => ({ content: mItem.part, code: mItem.code }));
        }
    }

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    const uniqueItems = [];
    const seenContents = new Set();
    items.forEach(item => {
        if (!seenContents.has(item.content)) {
            seenContents.add(item.content);
            if (!item.code) {
                const match = adminItems.find(a => a.part === item.content);
                if (match && match.code) item.code = match.code;
            }
            uniqueItems.push(item);
        }
    });

    if (detailType) {
        wrapper.style.display = 'block';
        input.style.display = 'none';
        trigger.textContent = '항목 선택';
        trigger.classList.remove('has-value');

        const updateTriggerText = () => {
            const sels = Array.from(list.querySelectorAll('.selected')).map(el => el.dataset.value);
            if (sels.length > 1) {
                trigger.textContent = `${sels[0]} 외 ${sels.length - 1}개`;
                trigger.title = sels.join('\n');
                trigger.classList.add('has-value');
                trigger.classList.remove('multi-line');
            } else if (sels.length === 1) {
                trigger.textContent = sels[0];
                trigger.title = sels[0];
                trigger.classList.add('has-value');
                trigger.classList.remove('multi-line');
            } else {
                trigger.textContent = '항목 선택';
                trigger.title = '';
                trigger.classList.remove('has-value', 'multi-line');
            }
            if (typeof window.updateRegisterDisplayList === 'function') window.updateRegisterDisplayList();
        };

        const dropdown = document.getElementById('register-content-dropdown');
        let searchInput = document.getElementById('register-content-search');
        if (!searchInput && dropdown) {
            searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.id = 'register-content-search';
            searchInput.className = 'dropdown-search-input';
            searchInput.placeholder = '텍스트로 항목 검색...';
            searchInput.autocomplete = 'off';
            searchInput.addEventListener('click', e => e.stopPropagation());
            dropdown.insertBefore(searchInput, list);
        }

        const siteSelect = document.getElementById('register-site-select');
        const site = siteSelect ? siteSelect.value : '';
        const key = `details_${site}_${equipKey}`;
        const detailData = JSON.parse(localStorage.getItem(key)) || { maint: [] };

        let registeredSet = new Set();
        const poolMap = new Map();

        // 1. 유지관리 항목 (maint) 처리 - 가장 우선순위
        const processRegistered = (m) => {
            if (m.originalLogId && m.originalLogId != window.currentAddWorkLogId) return; // [수정] 다른 추가 작업의 자식 항목만 제외하고, 기본 물품은 제안 풀에 포함
            if (m.content === '내용 없음' || m.content === '장비 점검' || !m.content) return;
            if (['고객대응', '용액제조', '온라인점검'].includes(m.type)) {
                if (!(type === '고객대응' && detailType === '설비 정상화' && m.type === '고객대응' && m.detailType === '설비 정상화')) {
                    return;
                }
            }

            let pureContent = m.content;

            // 비용 태그 파싱
            const costMatch = pureContent.match(/^\[(.*?)\]\s*(.*)$/);
            if (costMatch) {
                pureContent = costMatch[2];
            }

            // [추가] 오염된 텍스트 추가 정제 (사용자 요구사항 해결)
            pureContent = pureContent.replace(/\[(유상|무상|기타)\]/g, '').trim();
            pureContent = pureContent.replace(/\s*-\s*$/, '').trim();

            if (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) {
                const partKeywords = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '물품 이상 교체', '물품 이상 수리', '파트 이상 (교체)', '파츠 이상 교체', '파트 이상', '파츠 이상'];
                if (partKeywords.some(kw => pureContent === kw || pureContent.endsWith(kw))) return;

                for (const keyword of partKeywords) {
                    const idx = pureContent.indexOf(keyword);
                    if (idx !== -1) {
                        pureContent = pureContent.substring(idx + keyword.length).replace(/^[\s-]+/, '');
                        break;
                    }
                }
                if (!pureContent) return;

                const partsArray = window.splitSafetyContent(pureContent);
                partsArray.forEach(pText => {
                    let actualPart = pText;
                    const innerCostMatch = actualPart.match(/^\[(.*?)\]\s*(.*)$/);
                    if (innerCostMatch) actualPart = innerCostMatch[2];

                    if (!actualPart) return; // [수정] 비용 태그만 있는 잘못된 데이터 필터링

                    const extracted = typeof window.extractSpecFromContent === 'function' ? window.extractSpecFromContent(actualPart) : { spec: '', pureContent: actualPart };
                    let spec = extracted.spec || m.spec || '';
                    actualPart = extracted.pureContent;

                    const nonPartKeywords = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "프로그램 이상", "단순조치", "기타"];
                    if (nonPartKeywords.includes(actualPart) || partKeywords.some(kw => actualPart === kw || actualPart.startsWith(kw + ' - '))) return;

                    let code = '';
                    let partno = '';
                    const match = adminItems.find(a => a.part === actualPart || a.code === actualPart);
                    if (match) {
                        code = match.code || '';
                        partno = match.partno || '';
                    }

                    const baseName = code || actualPart;
                    const specStr = spec ? ` [${spec}]` : '';
                    const displayValue = `${baseName}${specStr}`;
                    registeredSet.add(displayValue);

                    if (!poolMap.has(displayValue)) {
                        poolMap.set(displayValue, {
                            content: actualPart,
                            code: code,
                            partno: partno,
                            spec: spec,
                            displayValue: displayValue
                        });
                    }
                });
            } else {
                const keywordMap = {
                    '파트 이상 교체': '파트 이상 교체',
                    '파트 이상 수리': '파트 이상 수리',
                    '용액 용자 이상': '용액 용자 이상',
                    '파트 이상 (교체)': '파트 이상 교체',
                    '파트 이상 (수리)': '파트 이상 수리',
                    '용액 / 용자 이상': '용액 용자 이상'
                };

                for (const [oldKw, newKw] of Object.entries(keywordMap)) {
                    if (pureContent.startsWith(oldKw + ' - ')) {
                        pureContent = newKw;
                        break;
                    } else if (pureContent === oldKw) {
                        pureContent = newKw;
                        break;
                    }
                }

                const baseName = m.code || pureContent;
                const specStr = m.spec ? ` [${m.spec}]` : '';
                const displayValue = `${baseName}${specStr}`;
                registeredSet.add(displayValue);

                let partno = '';
                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) partno = match.partno || '';

                if (!poolMap.has(displayValue)) {
                    poolMap.set(displayValue, {
                        content: pureContent,
                        code: m.code,
                        partno: partno,
                        spec: m.spec || '',
                        displayValue: displayValue
                    });
                }
            }
        };

        if (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) {
            detailData.maint.forEach(processRegistered);
        } else {
            detailData.maint.filter(m => m.type === type && m.detailType === detailType).forEach(processRegistered);
        }

        // 2. uniqueItems (check_type_items 등) 처리
        uniqueItems.forEach(i => {
            if (!i.content) return;
            const baseName = i.code || i.content;
            let partno = '';
            const match = adminItems.find(a => a.part === i.content || a.code === i.content);
            if (match) partno = match.partno || '';

            if (!poolMap.has(baseName)) {
                poolMap.set(baseName, { content: i.content, code: i.code, partno: partno, spec: '', displayValue: baseName });
            }
        });

        // 3. admin_items 처리 (PM, BM, Parts 교체인 경우)
        if (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) {
            const allAdminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            allAdminItems.forEach(a => {
                if (!a.part) return;
                const baseName = a.code || a.part;
                if (!poolMap.has(baseName)) {
                    poolMap.set(baseName, { content: a.part, code: a.code, partno: a.partno || '', spec: '', displayValue: baseName });
                }
            });
        }

        let poolItems = Array.from(poolMap.values());

        let registeredItems = [];
        let otherItems = [];

        poolItems.forEach(item => {
            const val = item.displayValue;
            if (registeredSet.has(val)) {
                registeredItems.push(item);
            } else {
                otherItems.push(item);
            }
        });

        let showAll = registeredItems.length === 0;

        const currentSelections = {};

        const renderDropdownItems = (searchTerm = '') => {
            list.querySelectorAll('.log-select-item').forEach(el => {
                const val = el.dataset.value;
                if (el.classList.contains('selected')) {
                    const cSel = el.querySelector('.item-cost-select');
                    currentSelections[val] = cSel ? cSel.value : '유상';
                } else {
                    delete currentSelections[val];
                }
            });

            let displayItems = showAll ? [...registeredItems, ...otherItems] : registeredItems;

            if (searchTerm) {
                const kws = searchTerm.toLowerCase().split(/\s+/);
                displayItems = [...registeredItems, ...otherItems].filter(item => {
                    const txt = `${item.displayValue || ''} ${item.partno || ''}`.toLowerCase();
                    return kws.every(kw => txt.includes(kw));
                });
            }

            const displayItemValues = new Set(displayItems.map(i => i.displayValue));
            Object.keys(currentSelections).forEach(selectedValue => {
                if (!displayItemValues.has(selectedValue)) {
                    const originalItem = [...registeredItems, ...otherItems].find(i => i.displayValue === selectedValue);
                    if (originalItem) {
                        displayItems.unshift(originalItem);
                    } else {
                        displayItems.unshift({ content: selectedValue, code: '', spec: '', displayValue: selectedValue });
                    }
                }
            });

            list.innerHTML = '';
            if (displayItems.length === 0) {
                list.innerHTML = '<div class="log-select-empty-msg" style="padding: 10px; color:#8b949e; text-align:center;">검색 결과가 없습니다.</div>';
            } else {
                displayItems.forEach(item => {
                    const val = item.displayValue;
                    const isSelected = currentSelections.hasOwnProperty(val);
                    const itemCost = isSelected ? currentSelections[val] : '유상';

                    const templateId = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화'))
                        ? 'log-part-item-template' : 'detail-content-item-template';

                    const tpl = getTemplateContent(templateId);
                    if (tpl) {
                        const div = tpl.querySelector('.log-select-item');
                        if (isSelected) div.classList.add('selected');
                        div.dataset.value = val;

                        const itemNameEl = div.querySelector('.item-name');
                        itemNameEl.innerHTML = `<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(val)}</span>`;
                        itemNameEl.style.display = 'flex';
                        itemNameEl.style.alignItems = 'center';

                        if (!item.spec && templateId === 'log-part-item-template') {
                            const addSpecBtn = document.createElement('button');
                            addSpecBtn.innerHTML = '＋';
                            addSpecBtn.style.cssText = 'margin-left: 5px; background: #0d1117; border: 1px solid #3fb950; color: #3fb950; border-radius: 4px; padding: 0 4px; font-size: 14px; font-weight: bold; cursor: pointer; flex-shrink: 0; line-height: 1; position: relative; z-index: 10;';
                            addSpecBtn.title = '물품 상세 추가';
                            addSpecBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
                            addSpecBtn.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (typeof window.openAddPartSpecModal === 'function') {
                                    const siteSelect = document.getElementById('register-site-select');
                                    const siteName = siteSelect ? siteSelect.value : '';
                                    window.openAddPartSpecModal(siteName, equipKey, item, (newItem) => {
                                        const newDisplayValue = newItem.code ? `${newItem.code} [${newItem.spec}]` : `${newItem.content} [${newItem.spec}]`;

                                        registeredItems.unshift({
                                            content: newItem.content,
                                            code: newItem.code,
                                            partno: item.partno || '',
                                            spec: newItem.spec,
                                            displayValue: newDisplayValue
                                        });
                                        registeredSet.add(newDisplayValue);
                                        currentSelections[newDisplayValue] = '유상';

                                        if (searchInput) searchInput.value = '';
                                        renderDropdownItems();
                                        updateTriggerText();
                                    });
                                }
                            };
                            itemNameEl.appendChild(addSpecBtn);
                        }

                        const cSel = div.querySelector('.item-cost-select');
                        if (cSel) {
                            const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
                            if (isPartKeyword) {
                                cSel.remove();
                            } else {
                                cSel.value = itemCost;
                                cSel.addEventListener('click', e => e.stopPropagation());
                                cSel.addEventListener('change', (e) => {
                                    e.stopPropagation();
                                    if (div.classList.contains('selected')) updateTriggerText();
                                });
                            }
                        }

                        div.addEventListener('pointerdown', (e) => {
                            if (e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option' || e.target.tagName.toLowerCase() === 'button') return;
                            e.preventDefault();
                            e.stopPropagation();
                            trigger.classList.remove('error-border');

                            if (type === '비정기') {
                                list.querySelectorAll('.log-select-item.selected').forEach(el => {
                                    if (el !== div) el.classList.remove('selected');
                                });
                            }
                            div.classList.toggle('selected');
                            updateTriggerText();

                            if (type === '비정기' && div.classList.contains('selected')) {
                                dropdown.classList.remove('show');
                            }

                            const pWrapper = document.getElementById('register-part-row');
                            if (pWrapper) {
                                // [수정] 작업 등록 시에는 하위 세부 내용 물품 선택창을 원천 비활성화 (항상 숨김)
                                pWrapper.style.display = 'none';
                            }
                        });

                        list.appendChild(div);
                    }
                });
            }

            if (!showAll && !searchTerm && otherItems.length > 0) {
                const moreBtn = document.createElement('button');
                moreBtn.className = 'show-all-btn';
                moreBtn.innerHTML = '⬇️ 더보기 (전체 물품)';
                moreBtn.type = 'button';
                moreBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showAll = true;
                    renderDropdownItems(searchInput ? searchInput.value : '');
                };
                list.appendChild(moreBtn);
            }

        };

        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = (e) => {
                renderDropdownItems(e.target.value.trim());
            };
        }

        renderDropdownItems();

        const footer = dropdown ? dropdown.querySelector('.log-select-footer') : null;
        if (footer) footer.style.display = (type === '비정기') ? 'none' : 'block';
    } else {
        wrapper.style.display = 'none';
        input.style.display = 'block';
        if (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화')) {
            input.placeholder = '항목을 추가해 주세요';
            input.value = '';
            input.disabled = true;
            input.classList.add('input-disabled');
        } else {
            input.placeholder = detailType ? '내용 (직접 입력)' : '내용 (직접 입력)';
            input.disabled = false;
            input.classList.remove('input-disabled');
        }
    }

    let displayListWrapper = document.getElementById('register-display-list-wrapper');
    if (!displayListWrapper) {
        displayListWrapper = document.createElement('div');
        displayListWrapper.id = 'register-display-list-wrapper';
        displayListWrapper.style.marginTop = '0px';
        displayListWrapper.style.padding = '10px';
        displayListWrapper.style.background = '#161b22';
        displayListWrapper.style.border = '1px solid #30363d';
        displayListWrapper.style.borderRadius = '4px';
        displayListWrapper.style.fontSize = '13px';
        displayListWrapper.style.color = '#c9d1d9';

        const parentContainer = input.closest('.form-row') || input.parentNode;
        const partRow = document.getElementById('register-part-row');
        const insertAfterTarget = partRow || parentContainer;
        if (insertAfterTarget && insertAfterTarget.parentNode) {
            insertAfterTarget.parentNode.insertBefore(displayListWrapper, insertAfterTarget.nextSibling);
        }
    }

    const currentParentContainer = input.closest('.form-row') || input.parentNode;
    const currentPartRow = document.getElementById('register-part-row');
    const currentInsertAfterTarget = currentPartRow || currentParentContainer;
    if (currentInsertAfterTarget && currentInsertAfterTarget.parentNode && displayListWrapper.previousSibling !== currentInsertAfterTarget) {
        currentInsertAfterTarget.parentNode.insertBefore(displayListWrapper, currentInsertAfterTarget.nextSibling);
    }

    displayListWrapper.style.minHeight = '40px';
    displayListWrapper.style.maxHeight = '250px';
    displayListWrapper.style.overflowY = 'auto';
    displayListWrapper.style.flexShrink = '0';
    displayListWrapper.style.width = '100%';
    displayListWrapper.style.boxSizing = 'border-box';

    window.updateRegisterDisplayList = () => {
        let allVals = [];
        const rList = document.getElementById('register-content-list');
        if (rList && wrapper.style.display !== 'none') {
            const selected = rList.querySelectorAll('.log-select-item.selected');
            const baseVals = Array.from(selected).map(el => {
                const cSel = el.querySelector('.item-cost-select');
                return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
            });

            let partValsStr = '';
            const pRow = document.getElementById('register-part-row');
            if (pRow && pRow.style.display !== 'none') {
                const pList = document.getElementById('register-part-list');
                if (pList) {
                    const pSelected = pList.querySelectorAll('.log-select-item.selected');
                    partValsStr = Array.from(pSelected).map(el => el.dataset.value).join(', ');
                }
            }

            baseVals.forEach(val => {
                const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
                if (isPartKeyword && partValsStr) {
                    const pArr = partValsStr.split(',').map(s => s.trim()).filter(Boolean);
                    pArr.forEach(p => allVals.push(`${val} - ${p}`));
                } else {
                    allVals.push(val);
                }
            });
        }
        if (allVals.length > 1) {
            displayListWrapper.style.display = 'block';
            displayListWrapper.innerHTML = allVals.map(v => `<div style="margin-bottom:4px; word-break:keep-all;">• ${escapeHtml(v)}</div>`).join('');
            const parentContainer = input.closest('.form-row') || input.parentNode;
            if (parentContainer) parentContainer.style.marginBottom = '5px';
        } else {
            displayListWrapper.style.display = 'none';
            displayListWrapper.innerHTML = '';
            const parentContainer = input.closest('.form-row') || input.parentNode;
            if (parentContainer) parentContainer.style.marginBottom = '15px';
        }
    };

    window.updateRegisterDisplayList();
};

/* --- 2.4 데이터 처리 및 액션 (Data & Actions) --- */
async function confirmRegisterSchedule() {
    try {
        const dateStr = document.getElementById('register-date-display').value;
        const site = document.getElementById('register-site-select').value;
        const equip = document.getElementById('register-equip-select').value;
        const typeSelect = document.getElementById('register-type-select');
        const type = typeSelect ? typeSelect.value : '';
        const detailTypeSelect = document.getElementById('register-detail-type-select');
        const detailType = detailTypeSelect ? detailTypeSelect.value : '';
        const detailType2Select = document.getElementById('register-detail-type2-select');
        const detailType2 = detailType2Select && detailType2Select.style.display !== 'none' ? detailType2Select.value : '';
        const costTypeSelect = document.getElementById('register-cost-type');
        const costType = costTypeSelect ? costTypeSelect.value : '';
        const mdInput = document.getElementById('register-md');
        const md = mdInput ? mdInput.value.trim() : '';
        const workerHidden = document.getElementById('register-worker-hidden');
        const worker = workerHidden ? workerHidden.value.trim() : '';

        let lastProcessedId = null;

        let hasError = false;
        const checkField = (id) => {
            const el = document.getElementById(id);
            if (id === 'register-equip-select' && document.getElementById('register-equip-trigger')) {
                const triggerEl = document.getElementById('register-equip-trigger');
                if (!el.value) {
                    triggerEl.classList.add('error-border');
                    hasError = true;
                }
                return;
            }
            if (el && !el.disabled && (!el.value || el.value.trim() === '')) {
                el.classList.add('error-border');
                hasError = true;
            }
        };

        checkField('register-date-display');
        checkField('register-site-select');
        checkField('register-equip-select');
        checkField('register-type-select');

        if (detailTypeSelect && !detailTypeSelect.disabled && !detailType) {
            detailTypeSelect.classList.add('error-border');
            hasError = true;
        }
        if (type === '비정기' && detailType2Select && !detailType2Select.disabled && !detailType2) {
            detailType2Select.classList.add('error-border');
            hasError = true;
        }
        checkField('register-cost-type');

        if (!worker) {
            const workerTrigger = document.getElementById('register-worker-trigger');
            if (workerTrigger) workerTrigger.classList.add('error-border');
            hasError = true;
        }

        let content = '';
        const wrapper = document.getElementById('register-content-wrapper');
        if (wrapper && wrapper.style.display !== 'none') {
            const selected = document.querySelectorAll('#register-content-list .log-select-item.selected');
            content = Array.from(selected).map(el => {
                const costSelect = el.querySelector('.item-cost-select');
                return costSelect ? `[${costSelect.value}] ${el.dataset.value}` : el.dataset.value;
            }).join(', ');
        } else {
            const input = document.getElementById('register-content-input');
            if (input) {
                content = input.value.trim();
            }
        }

        const partRow = document.getElementById('register-part-row');
        if (partRow && partRow.style.display !== 'none') {
            const partList = document.getElementById('register-part-list');
            if (partList) {
                const selectedParts = partList.querySelectorAll('.log-select-item.selected');
                const partContent = Array.from(selectedParts).map(el => {
                    const cSel = el.querySelector('.item-cost-select');
                    return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
                }).join(', ');
                if (!partContent) return alert('교체/수리할 물품을 선택해주세요.');

                if (content) {
                    const contentArr = window.splitSafetyContent(content);
                    let newContentArr = [];
                    contentArr.forEach(val => {
                        let baseCost = '유상';
                        const bMatch = val.match(/^\[(.*?)\] (.*)$/);
                        if (bMatch) { baseCost = bMatch[1]; val = bMatch[2]; }

                        const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
                        if (isPartKeyword) {
                            const partsArray = window.splitSafetyContent(partContent);
                            partsArray.forEach(p => newContentArr.push(`${val} - ${p}`));
                        } else {
                            newContentArr.push(`[${baseCost}] ${val}`);
                        }
                    });
                    content = newContentArr.join(', ');
                } else {
                    content = partContent;
                }
            }
        }

        if (hasError) return alert('빨간색 테두리로 표시된 필수 항목을 모두 입력/선택해주세요.');

        const workerCount = worker ? worker.split(',').map(s => s.trim()).filter(Boolean).length : 0;
        if (parseFloat(md) > workerCount) {
            alert(`입력된 공수(${md})가 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
            if (mdInput) mdInput.value = workerCount;
            return;
        }

        const finalDetailType = (type === '비정기' && detailType2) ? `${detailType} > ${detailType2}` : detailType;

        if (!window.currentAddWorkLogId && equip) {
            const targetParts = equip.split('::');
            const targetName = targetParts[0].trim().toLowerCase();
            const targetSerial = (targetParts.length > 1 ? targetParts[1] : '').trim().toLowerCase();
            const targetKey = `details_${site}_${equip}`;
            const targetDetailData = JSON.parse(localStorage.getItem(targetKey)) || {};
            const targetCustName = (targetDetailData.setup && targetDetailData.setup.custEquipName) ? targetDetailData.setup.custEquipName.trim().toLowerCase() : '';
 
            if (targetSerial || targetCustName) {
                const deviceDataMap = getDeviceDataMap();
                let hasDuplicate = false;
 
                for (const sName in deviceDataMap) {
                    const equipsList = deviceDataMap[sName] || [];
                    for (const eqName of equipsList) {
                        const eqParts = eqName.split('::');
                        const eqNameStr = eqParts[0].trim().toLowerCase();
                        const eqSerial = (eqParts.length > 1 ? eqParts[1] : '').trim().toLowerCase();
                        const eqKey = `details_${sName}_${eqName}`;
                        const eqDetailData = JSON.parse(localStorage.getItem(eqKey)) || {};
                        const eqCustName = (eqDetailData.setup && eqDetailData.setup.custEquipName) ? eqDetailData.setup.custEquipName.trim().toLowerCase() : '';
 
                        const invalidSerials = ['n/a', 'none', '-', '없음', 'null', 'undefined', ''];
                        const cleanSerial = targetSerial ? targetSerial.replace(/[^a-z0-9]/g, '') : '';
                        const isValidSerial = cleanSerial && cleanSerial.length > 3 && !invalidSerials.includes(targetSerial);
                        const isSameSerial = isValidSerial && eqSerial && targetSerial === eqSerial && sName === site && targetName === eqNameStr;
                        const isSameCustName = targetCustName && eqCustName && targetCustName === eqCustName && sName === site && targetName === eqNameStr;
 
                        if (isSameSerial || isSameCustName) {
                            const hasMaint = (eqDetailData.maint || []).some(m => m.scheduledDate === dateStr && (m.type || '정기') === type);
                            const hasLog = (eqDetailData.logs || []).some(l => l.date === dateStr && l.detailType !== '일정변경' && (l.type || '정기') === type);
                            if (hasMaint || hasLog) {
                                hasDuplicate = true;
                                break;
                            }
                        }
                    }
                    if (hasDuplicate) break;
                }

                if (hasDuplicate) {
                    alert('이미 등록한 작업이 있습니다.');
                    return;
                }
            }
        }

        const key = `details_${site}_${equip}`;
        let data = JSON.parse(localStorage.getItem(key)) || { maint: [], logs: [] };
        if (!data.maint) data.maint = [];
        let payload = { maint_upserts: [] };

        const itemsList = content ? content.split(', ').map(s => s.trim()).filter(s => s) : ['내용 없음'];
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

        if (window.currentAddWorkLogId) {
            let combinedContentArray = [];
            let combinedCodeArray = [];
            let combinedSpecArray = [];
            let combinedCostArray = [];

            itemsList.forEach((itemText) => {
                let itemCost = '';
                const costMatch = itemText.match(/^\[(.*?)\] (.*)$/);
                if (costMatch) {
                    itemCost = costMatch[1];
                    itemText = costMatch[2];
                }

                const innerCostMatch = itemText.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
                if (innerCostMatch) {
                    if (!itemCost) itemCost = innerCostMatch[2];
                    itemText = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
                }

                let code = '';
                let pureContent = itemText;
                let spec = '';
                const specMatch = itemText.match(/ \[(.*?)\]$/);
                if (specMatch) {
                    spec = specMatch[1];
                    pureContent = itemText.replace(specMatch[0], '');
                }
                let fullContent = pureContent;

                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) {
                    code = match.code || '';
                    fullContent = match.part || pureContent;
                }

                combinedContentArray.push(fullContent);
                if (code) combinedCodeArray.push(code);
                if (spec) combinedSpecArray.push(spec);
                if (itemCost) combinedCostArray.push(itemCost);
            });

            const finalContent = combinedContentArray.join(', ');
            const finalCode = Array.from(new Set(combinedCodeArray)).join(', ');
            const finalSpec = Array.from(new Set(combinedSpecArray)).join(', ');
            const finalItemCost = Array.from(new Set(combinedCostArray)).join(', ');

            const newId = Date.now() + Math.floor(Math.random() * 10000);
            const newMaintItem = {
                id: newId,
                type: type,
                detailType: finalDetailType,
                code: finalCode,
                content: finalContent,
                spec: finalSpec,
                date: "",
                period: null,
                scheduledDate: dateStr,
                costType: costType,
                worker: worker,
                md: md,
                itemCost: finalItemCost,
                originalLogId: window.currentAddWorkLogId
            };
            lastProcessedId = newMaintItem.id;
            data.maint.push(newMaintItem);
            payload.maint_upserts.push(newMaintItem);
        } else if (type !== '정기') {
            // [개선] 비정기, 고객대응, 용액제조, 온라인점검 등의 경우: 하나로 합쳐서 등록!
            let combinedContentArray = [];
            let combinedCodeArray = [];
            let combinedSpecArray = [];
            let combinedCostArray = [];

            itemsList.forEach((itemText) => {
                let itemCost = '';
                const costMatch = itemText.match(/^\[(.*?)\] (.*)$/);
                if (costMatch) {
                    itemCost = costMatch[1];
                    itemText = costMatch[2];
                }

                const innerCostMatch = itemText.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
                if (innerCostMatch) {
                    if (!itemCost) itemCost = innerCostMatch[2];
                    itemText = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
                }

                let code = '';
                let pureContent = itemText;
                let spec = '';
                const specMatch = itemText.match(/ \[(.*?)\]$/);
                if (specMatch) {
                    spec = specMatch[1];
                    pureContent = itemText.replace(specMatch[0], '');
                }
                let fullContent = pureContent;

                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) {
                    code = match.code || '';
                    fullContent = match.part || pureContent;
                }

                combinedContentArray.push(fullContent);
                if (code) combinedCodeArray.push(code);
                if (spec) combinedSpecArray.push(spec);
                if (itemCost) combinedCostArray.push(itemCost);
            });

            const finalContent = combinedContentArray.join(', ');
            const finalCode = Array.from(new Set(combinedCodeArray)).join(', ');
            const finalSpec = Array.from(new Set(combinedSpecArray)).join(', ');
            const finalItemCost = Array.from(new Set(combinedCostArray)).join(', ');

            let existingItem = data.maint.find(m => m.type === type && m.content === finalContent && (m.spec || '') === finalSpec && (!m.scheduledDate || m.scheduledDate === dateStr));
            if (existingItem) {
                const oldDate = existingItem.scheduledDate;
                existingItem.scheduledDate = dateStr;
                existingItem.detailType = finalDetailType;
                if (costType) existingItem.costType = costType;
                existingItem.md = md;
                existingItem.worker = worker;
                if (finalItemCost) existingItem.itemCost = finalItemCost;
                lastProcessedId = existingItem.id;
                existingItem.content = finalContent;

                const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
                const newMonth = dateStr.substring(0, 7);
                if (oldMonth !== newMonth) {
                    if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
                }
                payload.maint_upserts.push(existingItem);
            } else {
                const newId = Date.now() + Math.floor(Math.random() * 10000);
                const newItem = {
                    id: newId,
                    type: type,
                    detailType: finalDetailType,
                    code: finalCode,
                    content: finalContent,
                    spec: finalSpec,
                    date: "",
                    period: null,
                    scheduledDate: dateStr,
                    costType: costType,
                    worker: worker,
                    md: md,
                    itemCost: finalItemCost
                };
                lastProcessedId = newItem.id;
                data.maint.push(newItem);
                payload.maint_upserts.push(newItem);

                if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
            }
        } else {
            itemsList.forEach((itemText, idx) => {
                let itemCost = '';
                const costMatch = itemText.match(/^\[(.*?)\] (.*)$/);
                if (costMatch) {
                    itemCost = costMatch[1];
                    itemText = costMatch[2];
                }

                const innerCostMatch = itemText.match(/^(.*?)\s*-\s*\[(.*?)\]\s*(.*)$/);
                if (innerCostMatch) {
                    if (!itemCost) itemCost = innerCostMatch[2];
                    itemText = `${innerCostMatch[1]} - ${innerCostMatch[3]}`;
                }

                let code = '';
                let pureContent = itemText;
                let spec = '';
                const specMatch = itemText.match(/ \[(.*?)\]$/);
                if (specMatch) {
                    spec = specMatch[1];
                    pureContent = itemText.replace(specMatch[0], '');
                }
                let fullContent = pureContent;
                let period = null;

                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) {
                    code = match.code || '';
                    fullContent = match.part || pureContent;
                    period = match.cycle || null;
                }

                let existingItem = data.maint.find(m => m.type === type && (m.content === fullContent || m.content === pureContent) && (m.spec || '') === spec && (!m.scheduledDate || m.scheduledDate === dateStr));
                if (existingItem) {
                    const oldDate = existingItem.scheduledDate;
                    existingItem.scheduledDate = dateStr;
                    existingItem.detailType = finalDetailType;
                    if (costType) existingItem.costType = costType;
                    existingItem.md = md;
                    existingItem.worker = worker;
                    if (itemCost) existingItem.itemCost = itemCost;
                    if (idx === 0) lastProcessedId = existingItem.id;
                    existingItem.content = fullContent;

                    const oldMonth = oldDate ? oldDate.substring(0, 7) : null;
                    const newMonth = dateStr.substring(0, 7);
                    if (oldMonth !== newMonth) {
                        if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
                    }
                    payload.maint_upserts.push(existingItem);
                } else {
                    const newItem = {
                        id: Date.now() + Math.floor(Math.random() * 10000) + idx,
                        type: type,
                        detailType: finalDetailType,
                        code: code,
                        content: fullContent,
                        spec: spec,
                        date: "",
                        period: (type === '정기') ? period : null,
                        scheduledDate: dateStr,
                        costType: costType,
                        worker: worker,
                        md: md,
                        itemCost: itemCost
                    };
                    if (idx === 0) lastProcessedId = newItem.id;
                    data.maint.push(newItem);
                    payload.maint_upserts.push(newItem);

                    if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
                }
            });
        }

        const success = await window.syncHistoryTransaction(site, equip, payload);
        if (!success) return;

        localStorage.setItem(key, JSON.stringify(data));

        if (window.currentAddWorkLogId) {
            if (typeof addSystemLog === 'function') {
                addSystemLog('ADD_SCHEDULE_EXTRA', equip, `예정일: ${dateStr}, 내용: ${content} (추가 작업 등록)`);
            }
            document.getElementById('register-schedule-modal').style.display = 'none';
            setTimeout(() => {
                if (typeof openEventDetailModal === 'function' && lastProcessedId) {
                    window.currentDetailTarget = { site: site, equip: equip };
                    openEventDetailModal(site, equip, lastProcessedId, false);
                }
            }, 100);
            window.currentAddWorkLogId = null;
            return;
        } else {
            if (typeof addSystemLog === 'function') {
                addSystemLog('ADD_SCHEDULE', equip, `예정일: ${dateStr}, 구분: ${type}, 내용: ${content}`);
            }
        }

        alert('일정이 등록되었습니다.');
        document.getElementById('register-schedule-modal').style.display = 'none';

        if (costTypeSelect) costTypeSelect.value = '';

        const contentList = document.getElementById('register-content-list');
        if (contentList) contentList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));
        const partList = document.getElementById('register-part-list');
        if (partList) partList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));

        renderCalendar();
        if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
        if (typeof renderDetails === 'function') renderDetails();
        if (typeof renderLogs === 'function') renderLogs();
        const popup = document.getElementById('calendar-popup');
        if (popup) popup.style.display = 'none';

        if ((window.isMobileRegisterFlow || window.openDetailAfterRegister) && lastProcessedId) {
            window.isMobileRegisterFlow = false;
            window.openDetailAfterRegister = false;
            setTimeout(() => {
                openEventDetailModal(site, equip, lastProcessedId, false);
            }, 100);
        }
    } catch (err) {
        console.error('Task Registration Error:', err);
        alert('작업 등록 처리 중 예기치 못한 오류가 발생했습니다.\n상세: ' + err.message);
    }
}

/* --- 2.5 전역 노출 (Exports) --- */
window.setupRegisterScheduleModal = setupRegisterScheduleModal;
window.openRegisterScheduleModal = openRegisterScheduleModal;

/* ==========================================================================
   3. 장비 이관 모달 (Equip Transfer Modal)
   ========================================================================== */
window.setupEquipTransferModal = function() {
    let modal = document.getElementById('equip-transfer-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'equip-transfer-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '11000';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-window" style="width: 600px; height: auto; max-height: 80vh; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h3>장비 이관 확인</h3>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button id="btn-show-transfer-history" class="btn-blue-sm" style="padding: 4px 10px; font-size: 12px;">이관 내역</button>
                        <button id="btn-close-equip-transfer" class="btn-del-sm">✕</button>
                    </div>
                </div>
                <div class="modal-body" style="padding: 15px; overflow-y: auto; flex: 1;">
                    <ul id="equip-transfer-list" style="list-style: none; padding: 0; margin: 0;"></ul>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('btn-close-equip-transfer').onclick = () => {
            modal.style.display = 'none';
        };

        document.getElementById('btn-show-transfer-history').onclick = () => {
            modal.style.display = 'none';
            if (typeof window.openTransferHistoryModal === 'function') window.openTransferHistoryModal();
        };
    }
};

window.openEquipTransferModal = function() {
    const userRole = sessionStorage.getItem('userRole');
    const userSite = sessionStorage.getItem('userSite');
    if (userRole !== 'admin' && userRole !== 'superadmin') {
        alert('장비 이관 확인은 관리자 권한이 필요합니다.');
        return;
    }

    const modal = document.getElementById('equip-transfer-modal');
    if (!modal) return;
    
    const listEl = document.getElementById('equip-transfer-list');
    listEl.innerHTML = '';
    
    // [수정] 화면 필터 대신 사용자 계정 권한/사업장 정보를 기준으로 타겟 사업장 결정
    let targetSite = '';
    if (userRole === 'admin') {
        targetSite = userSite; // 관리자는 자신의 사업장 그룹만
        // superadmin은 targetSite가 ''로 유지되어 전체를 조회
    }

    const data = JSON.parse(localStorage.getItem('device_data')) || {};
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const allSites = Object.keys(data).filter(k => k !== 'models' && k !== 'details');
    
    const transferEquips = [];
    
    let sitesToSearch = allSites;
    if (targetSite) {
        if (allSites.includes(targetSite)) {
            sitesToSearch = [targetSite];
        } else {
            sitesToSearch = allSites.filter(site => {
                const groupName = typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타사업장';
                return groupName === targetSite;
            });
            if (sitesToSearch.length === 0) {
                sitesToSearch = allSites.filter(site => site.includes(targetSite));
            }
        }
    }

    sitesToSearch.forEach(site => {
        const equips = data[site] || [];
        equips.forEach(equip => {
            if (equip && equip.startsWith('기타(ETC)')) return;
            
            const detailKey = `details_${site}_${equip}`;
            const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
            const setupInfo = detailData.setup || {};
            
            const sData = setupData[`${site}::${equip}`] || {};
            let isSetupCompleted = false;
            let resubmitMemo = '';
            let transferComment = '';
            if (sData.setupDetails) {
                const completeItem = sData.setupDetails.find(d => d.content === '셋업 완료');
                if (completeItem && completeItem.completed) {
                    isSetupCompleted = true;
                    resubmitMemo = completeItem.delayReason || '';
                    transferComment = completeItem.transferComment || '';
                }
            }
            
            if (isSetupCompleted && setupInfo.equipStatus === '이관 대기') {
                transferEquips.push({ site, equip, setupInfo, resubmitMemo, transferComment });
            }
        });
    });
    
    if (transferEquips.length === 0) {
        const msg = targetSite ? `[${targetSite}] 사업장(그룹)에 이관 대기 중인 셋업 완료 장비가 없습니다.` : `이관 대기 중인 셋업 완료 장비가 없습니다.`;
        listEl.innerHTML = `<li style="padding: 15px; text-align: center; color: #8b949e;">${msg}</li>`;
    } else {
        transferEquips.forEach(item => {
            const parts = item.equip.split('::');
            const name = parts[0];
            const serial = parts.length > 1 ? parts[1] : '';
            const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
            const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
            
            const custName = item.setupInfo.custEquipName ? item.setupInfo.custEquipName : '';
            let subInfo = '';
            if (custName) subInfo = `[${escapeHtml(custName)}]`;
            else if (serial) subInfo = `[${escapeHtml(serial)}]`;
            
            let resubmitHtml = '';
            if (item.resubmitMemo) {
                resubmitHtml = `<div style="color: #58a6ff; font-size: 11px; margin-top: 2px; word-break: break-all;">🔄 수정/보완: ${escapeHtml(item.resubmitMemo)}</div>`;
            }
            
            let transferCommentHtml = '';
            if (item.transferComment) {
                transferCommentHtml = `<div style="color: #a371f7; font-size: 11px; margin-top: 2px; word-break: break-all;">💬 코멘트: ${escapeHtml(item.transferComment)}</div>`;
            }

            const li = document.createElement('li');
            li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #30363d;';
            li.innerHTML = `
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
                    <span class="transfer-equip-name" style="color: #58a6ff; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; text-decoration: underline;" title="클릭하여 상세 내용 확인">[${escapeHtml(item.site)}] ${escapeHtml(displayName)} <span style="color: #3fb950;">${subInfo}</span></span>
                    <span style="color: #8b949e; font-size: 11px;">상태: ${escapeHtml(item.setupInfo.equipStatus || '미지정')}</span>
                    ${resubmitHtml}
                    ${transferCommentHtml}
                </div>
                <div style="display: flex; gap: 5px; flex-shrink: 0; align-items: center;">
                    <button class="btn-green-sm btn-transfer-confirm" style="padding: 4px 8px; font-size: 12px;">이관 확인</button>
                    <button class="btn-orange-sm btn-transfer-reject" style="padding: 4px 8px; font-size: 12px;">반려</button>
                </div>
            `;
            
            const nameSpan = li.querySelector('.transfer-equip-name');
            if (nameSpan) {
                nameSpan.onclick = () => {
                    if (typeof window.openSetupCompleteModal === 'function') {
                        window.openSetupCompleteModal(item.site, item.equip, true);
                    }
                };
            }

            li.querySelector('.btn-transfer-confirm').onclick = async () => {
                if (confirm(`해당 장비(${displayName})를 '워런티' 상태로 이관하시겠습니까?`)) {
                    await handleEquipTransfer(item.site, item.equip, '워런티');
                    openEquipTransferModal(); 
                }
            };
            
            li.querySelector('.btn-transfer-reject').onclick = async () => {
                const reason = prompt(`해당 장비(${displayName})의 셋업 완료 처리를 반려합니다.\n반려 사유를 입력해주세요:`);
                if (reason === null) return;
                
                await handleEquipTransfer(item.site, item.equip, '이관 반려', reason);
                openEquipTransferModal(); 
            };
            
            listEl.appendChild(li);
        });
    }
    
    modal.style.display = 'flex';
};

window.handleEquipTransfer = async function(site, equip, newStatus, rejectReason = '') {
    const detailKey = `details_${site}_${equip}`;
    const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
    if (!detailData.setup) detailData.setup = {};
    
    detailData.setup.equipStatus = newStatus;
    
    if (newStatus === '이관 반려') {
        const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
        const sData = setupData[`${site}::${equip}`];
        if (sData && sData.setupDetails) {
            const completeTask = sData.setupDetails.find(t => t.content === '셋업 완료');
            if (completeTask) {
                completeTask.rejectReason = rejectReason;
            }
            localStorage.setItem('setup_data', JSON.stringify(setupData));
            if (typeof window.syncSetupDataDB === 'function') {
                await window.syncSetupDataDB(site, equip, sData.setupDetails, sData.setupLogs);
            }
        }
        if (typeof addSystemLog === 'function') addSystemLog('REJECT_SETUP', equip, `반려 사유: ${rejectReason}`);
    } else {
        if (typeof addSystemLog === 'function') addSystemLog('TRANSFER_EQUIP', equip, `상태 변경: ${newStatus}`);
    }
    
    localStorage.setItem(detailKey, JSON.stringify(detailData));
    
    if (typeof window.syncAdminDB === 'function') {
        await window.syncAdminDB('equip', 'UPDATE', {
            old_id: equip, new_id: equip, site: site, old_site: site, new_site: site,
            setup: detailData.setup, special_note: detailData.specialNote || ''
        });
    }
    
    alert(`장비가 ${newStatus} 상태로 변경되었습니다.`);
    
    if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
    if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
    if (typeof renderDetails === 'function') renderDetails();
};

window.setupTransferHistoryModal = function() {
    let modal = document.getElementById('transfer-history-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'transfer-history-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '11000';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-window" style="width: 700px; height: auto; max-height: 80vh; display: flex; flex-direction: column;">
                <div class="modal-header">
                    <h3>이관 완료 내역</h3>
                    <button id="btn-close-transfer-history" class="btn-del-sm">✕</button>
                </div>
                <div class="modal-body" style="padding: 15px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; flex: 1;">
                    <div class="transfer-history-filter-wrapper" style="display: flex; gap: 10px; align-items: center; flex-shrink: 0;">
                        <div class="transfer-history-date-group" style="display: flex; align-items: center; gap: 5px;">
                            <input type="date" id="transfer-history-start" class="input-dark" style="width: 120px; font-size: 12px; padding: 4px;">
                            <span style="color: #8b949e;">~</span>
                            <input type="date" id="transfer-history-end" class="input-dark" style="width: 120px; font-size: 12px; padding: 4px;">
                        </div>
                        <input type="text" id="transfer-history-search" class="input-dark" style="flex: 1; font-size: 12px; padding: 4px 8px;" placeholder="사업장, 장비명, 시리얼, 고객사명 검색...">
                    </div>
                    <div class="data-table-wrapper" style="flex: 1; overflow-y: auto; margin-top: 10px; border: 1px solid #30363d; border-radius: 4px;">
                        <table class="data-table" style="margin: 0; width: 100%;">
                            <thead>
                                <tr>
                                    <th style="width: 110px;">이관일</th>
                                    <th style="width: 120px;">사업장</th>
                                    <th>장비 정보</th>
                                </tr>
                            </thead>
                            <tbody id="transfer-history-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('btn-close-transfer-history').onclick = () => {
            modal.style.display = 'none';
            if (typeof window.openEquipTransferModal === 'function') window.openEquipTransferModal();
        };

        ['transfer-history-start', 'transfer-history-end', 'transfer-history-search'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', window.renderTransferHistoryList);
        });
    }
};

window.openTransferHistoryModal = function() {
    if (typeof window.setupTransferHistoryModal === 'function') window.setupTransferHistoryModal();
    const modal = document.getElementById('transfer-history-modal');
    if (!modal) return;
    
    const startInput = document.getElementById('transfer-history-start');
    const endInput = document.getElementById('transfer-history-end');
    const searchInput = document.getElementById('transfer-history-search');
    
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    if (startInput) startInput.value = lastMonth.toISOString().split('T')[0];
    if (endInput) endInput.value = today.toISOString().split('T')[0];
    if (searchInput) searchInput.value = '';

    window.renderTransferHistoryList();
    modal.style.display = 'flex';
};

window.renderTransferHistoryList = function() {
    const tbody = document.getElementById('transfer-history-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const startStr = document.getElementById('transfer-history-start').value;
    const endStr = document.getElementById('transfer-history-end').value;
    const searchStr = document.getElementById('transfer-history-search').value.toLowerCase().trim();
    
    const data = JSON.parse(localStorage.getItem('device_data')) || {};
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    
    const userRole = sessionStorage.getItem('userRole');
    const userSite = sessionStorage.getItem('userSite');
    let targetSite = '';
    if (userRole === 'admin') targetSite = userSite;
    
    const allSites = Object.keys(data).filter(k => k !== 'models' && k !== 'details');
    let sitesToSearch = allSites;
    if (targetSite) {
        if (allSites.includes(targetSite)) sitesToSearch = [targetSite];
        else {
            sitesToSearch = allSites.filter(site => {
                const groupName = typeof window.getSiteGroupName === 'function' ? window.getSiteGroupName(site) : '기타사업장';
                return groupName === targetSite;
            });
            if (sitesToSearch.length === 0) sitesToSearch = allSites.filter(site => site.includes(targetSite));
        }
    }
    
    let historyList = [];
    sitesToSearch.forEach(site => {
        const equips = data[site] || [];
        equips.forEach(equip => {
            if (equip && equip.startsWith('기타(ETC)')) return;
            const detailKey = `details_${site}_${equip}`;
            const detailData = JSON.parse(localStorage.getItem(detailKey)) || {};
            const setupInfo = detailData.setup || {};
            
            if (['워런티', '가동 장비', '유휴 장비'].includes(setupInfo.equipStatus)) {
                const transferDate = setupInfo.warrantyStart || '';
                if (transferDate) {
                    historyList.push({ site, equip, setupInfo, date: transferDate });
                }
            }
        });
    });
    
    historyList = historyList.filter(item => {
        if (startStr && item.date && item.date < startStr) return false;
        if (endStr && item.date && item.date > endStr) return false;
        if (searchStr) {
            const parts = item.equip.split('::');
            const name = parts[0];
            const serial = parts.length > 1 ? parts[1] : '';
            const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
            const custName = item.setupInfo.custEquipName || '';
            const fullText = `${item.site} ${name} ${displayName} ${serial} ${custName}`.toLowerCase();
            const keywords = searchStr.split(/\s+/);
            if (!keywords.every(kw => fullText.includes(kw))) return false;
        }
        return true;
    });
    
    historyList.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    
    if (historyList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #8b949e; padding: 20px;">검색된 이관 내역이 없습니다.</td></tr>';
        return;
    }
    
    historyList.forEach(item => {
        const parts = item.equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';
        const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
        const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;
        const custName = item.setupInfo.custEquipName || '';
        
        let subInfo = '';
        if (custName) subInfo = `<span style="color: #3fb950; font-size: 11px; font-weight: bold; margin-left: 5px;">[${escapeHtml(custName)}]</span>`;
        else if (serial) subInfo = `<span style="color: #3fb950; font-size: 11px; font-weight: bold; margin-left: 5px;">[${escapeHtml(serial)}]</span>`;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align: center; padding: 8px 10px; border-bottom: 1px solid #21262d;">${item.date || '-'}</td>
            <td style="text-align: center; padding: 8px 10px; border-bottom: 1px solid #21262d;">${escapeHtml(item.site)}</td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #21262d;">
                <div style="display: flex; align-items: center;">
                    <span style="font-weight: bold; color: #e6edf3;">${escapeHtml(displayName)}</span>
                    ${subInfo}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
};