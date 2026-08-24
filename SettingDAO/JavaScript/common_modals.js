/* ==========================================================================
   1. 일정 상세 정보 모달 (Event Detail Modal)
   ========================================================================== */

window.removeCostLabels = function (content) {
    if (!content) return '';
    const items = typeof window.splitSafetyContent === 'function' ? window.splitSafetyContent(content) : content.split(',').map(s => s.trim()).filter(Boolean);
    const cleanedItems = items.map(item => {
        let clean = item.trim();
        const m1 = clean.match(/^\[.*?\]\s*(.*)$/);
        if (m1) clean = m1[1];
        const m2 = clean.match(/^(.*?)\s*-\s*\[.*?\]\s*(.*)$/);
        if (m2) clean = `${m2[1]} - ${m2[2]}`;
        return clean.trim();
    });
    return cleanedItems.join(', ');
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

function showSaveCloseConfirmModal(onSave, onClose) {
    let existingModal = document.getElementById('save-close-confirm-modal');
    if (existingModal) existingModal.remove();

    const confirmModalHtml = `
        <div id="save-close-confirm-modal" class="modal-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.6); z-index: 20000; align-items: center; justify-content: center;">
            <div class="modal-content" style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px; max-width: 420px; width: 90%; color: #e6edf3; box-shadow: 0 8px 24px rgba(0,0,0,0.5); text-align: center;">
                <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 16px; font-weight: 600; color: #f0f6fc;">수정사항 저장 안내</h3>
                <p style="margin-bottom: 24px; font-size: 14px; color: #8b949e; line-height: 1.5;">수정된 내용이 있습니다.<br>저장 후 닫으시겠습니까, 아니면 저장하지 않고 닫으시겠습니까?</p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="btn-confirm-save-and-close" class="btn-blue" style="padding: 8px 20px; font-size: 14px; font-weight: bold; border-radius: 6px; cursor: pointer; border: none; background: #238636; color: #ffffff;">저장</button>
                    <button id="btn-confirm-close-without-save" class="btn-gray" style="padding: 8px 20px; font-size: 14px; border-radius: 6px; cursor: pointer; background: #30363d; color: #c9d1d9; border: 1px solid #8b949e;">닫기</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', confirmModalHtml);
    const confirmModal = document.getElementById('save-close-confirm-modal');
    const saveBtn = document.getElementById('btn-confirm-save-and-close');
    const closeBtn = document.getElementById('btn-confirm-close-without-save');

    saveBtn.onclick = async () => {
        confirmModal.remove();
        if (typeof onSave === 'function') await onSave();
    };

    closeBtn.onclick = () => {
        confirmModal.remove();
        if (typeof onClose === 'function') onClose();
    };
}

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
        if (currentDetailTarget && !currentDetailTarget.isCompleted && hasDetailUnsavedChanges()) {
            showSaveCloseConfirmModal(
                async () => {
                    const success = await saveDetailChanges();
                    if (success) {
                        modal.style.display = 'none';
                        if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
                    }
                },
                () => {
                    modal.style.display = 'none';
                    if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
                }
            );
            return;
        }
        modal.style.display = 'none';
        if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (closeFooterBtn) closeFooterBtn.onclick = closeModal;

    if (completeBtn) {
        completeBtn.onclick = async () => {
            if (window.isCompletingWork) return;
            if (hasDetailUnsavedChanges()) {
                const success = await saveDetailChanges();
                if (!success) return; // 저장 실패 시 완료 중단
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
function openEventDetailModal(site, equip, id, isCompleted, options = {}) {
    if (typeof window.checkSessionValid === 'function' && !window.checkSessionValid()) return;
    const modal = document.getElementById('event-detail-modal');
    if (!modal) return;

    const hideActionBtns = Boolean(options && (options.hideActionBtns || options.onlyCloseBtn || options.readOnlyActionBtns));
    currentDetailTarget = { site, equip, id, isCompleted, options };

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};

    let item = null;
    const targetIdStr = String(id != null ? id : '').trim();
    const cleanTargetId = targetIdStr.replace(/^maint_/, '');

    const findInList = (list) => {
        if (!list || !Array.isArray(list)) return null;
        return list.find(i => {
            if (!i || i.id == null) return false;
            const itemIdStr = String(i.id).trim();
            const cleanItemId = itemIdStr.replace(/^(maint_|item_)/, '');
            const cleanTargetIdStr = targetIdStr.replace(/^(maint_|item_)/, '');
            return itemIdStr === targetIdStr || cleanItemId === cleanTargetIdStr || itemIdStr === cleanTargetIdStr || cleanItemId === targetIdStr;
        });
    };

    if (isCompleted === true) {
        item = findInList(data.logs) || findInList(data.maint);
        if (!item && targetIdStr) {
            const cleanId = window.removeCostLabels(targetIdStr);
            item = (data.logs ? data.logs.find(l => {
                const cleanContent = window.removeCostLabels(l.content || '');
                return cleanContent.includes(cleanId) || cleanId.includes(cleanContent) || l.memo === id;
            }) : null) || (data.maint ? data.maint.find(i => {
                const cleanContent = window.removeCostLabels(i.content || '');
                return cleanContent.includes(cleanId) || cleanId.includes(cleanContent) || i.code === id;
            }) : null);
        }
    } else if (isCompleted === false) {
        item = findInList(data.maint) || findInList(data.logs);
        if (!item && targetIdStr) {
            const cleanId = window.removeCostLabels(targetIdStr);
            item = (data.maint ? data.maint.find(i => {
                const cleanContent = window.removeCostLabels(i.content || '');
                return cleanContent.includes(cleanId) || cleanId.includes(cleanContent) || i.code === id;
            }) : null) || (data.logs ? data.logs.find(l => {
                const cleanContent = window.removeCostLabels(l.content || '');
                return cleanContent.includes(cleanId) || cleanId.includes(cleanContent) || l.memo === id;
            }) : null);
        }
    } else {
        // isCompleted === undefined 또는 null일 경우 maint와 logs 모두 검색
        item = findInList(data.maint) || findInList(data.logs);
        if (!item && targetIdStr) {
            const cleanId = window.removeCostLabels(targetIdStr);
            item = (data.maint ? data.maint.find(i => {
                const cleanContent = window.removeCostLabels(i.content || '');
                return cleanContent.includes(cleanId) || cleanId.includes(cleanContent) || i.code === id;
            }) : null) || (data.logs ? data.logs.find(l => {
                const cleanContent = window.removeCostLabels(l.content || '');
                return cleanContent.includes(cleanId) || cleanId.includes(cleanContent) || l.memo === id;
            }) : null);
        }
    }

    if (!item) {
        // [요청 반영] 경고 로그 제거 및 기본 폴백 항목 할당하여 오류 팝업 차단
        item = { id: id, type: '정기', content: '유지관리 물품 상세', spec: '', date: '' };
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
    let dt1 = item.detailType || item.detail_type || '';
    let dt2 = item.detailType2 || item.detail_type2 || '';
    let dt3 = item.detailType3 || item.detail_type3 || '';

    if (dt1 && dt1.includes(' > ')) {
        const parts = dt1.replace(/&gt;/g, '>').split(' > ');
        dt1 = parts[0] ? parts[0].trim() : '';
        if (parts[1] && !dt2) dt2 = parts[1].trim();
        if (parts[2] && !dt3) dt3 = parts[2].trim();
    } else if (dt1) {
        dt1 = dt1.replace(/&gt;/g, '>').trim();
    }

    let initialDetailType = dt1;
    let initialDetailType2 = dt2;
    let initialDetailType3 = dt3;

    const dtArray = [dt1, dt2, dt3].filter(Boolean);
    let displayDetailType = dtArray.length > 0 ? dtArray.join(' > ') : ((item.type === '정기') ? 'PM 점검' : '-');

    // [추가] 수정 모드용 select 요소들 미리 찾아두기
    const typeEl = document.getElementById('detail-type');
    const detailTypeEl = document.getElementById('detail-detail-type');
    let typeSelect = document.getElementById('detail-type-select');
    let detailTypeSelect = document.getElementById('detail-detail-type-select');
    let detailType3Select = document.getElementById('detail-detail-type3-select');

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
        wrapper.style.cssText = 'display: flex; gap: 5px; flex: 1; min-width: 0;';
        wrapper.innerHTML = `<select id="detail-detail-type-select" class="input-dark" style="flex: 1; min-width: 0;"></select><select id="detail-detail-type2-select" class="input-dark" style="flex: 1; min-width: 0;"></select><select id="detail-detail-type3-select" class="input-dark" style="flex: 1; min-width: 0;"></select>`;
        detailTypeEl.parentNode.insertBefore(wrapper, detailTypeEl);
        detailTypeSelect = document.getElementById('detail-detail-type-select');
        detailType2Select = document.getElementById('detail-detail-type2-select');
        detailType3Select = document.getElementById('detail-detail-type3-select');
    }

    if (document.getElementById('detail-detail-type')) {
        document.getElementById('detail-detail-type').textContent = displayDetailType;
    }

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
                let cleanPart = itemText.trim();
                if (!cleanPart) return;

                let hasCostTag = /^\[(유상|무상[^\]]*|기타)\]/.test(cleanPart) || /^\[.*?\]\s/.test(cleanPart);
                let hasSpecTag = /\[(.*?)\]$/.test(cleanPart);

                let costVal = itemCosts[idx] || itemCosts[0] || i.costType || '유상';

                if (!hasCostTag && costVal) {
                    cleanPart = `[${costVal}] ${cleanPart}`;
                }

                if (!hasSpecTag && i.spec && items.length === 1) {
                    cleanPart = `${cleanPart} [${i.spec}]`;
                }

                contentArr.push(cleanPart);
            });
        });
        displayContent = [...new Set(contentArr)].join(', ');
    }

    const contentEl = document.getElementById('detail-content');
    contentEl.dataset.rawContent = displayContent; // 원본 데이터 저장
    const itemsArr = window.splitSafetyContent(displayContent);

    const partKeywords = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '파트 이상 (교체)', '파트 이상 (수리)', '파츠 이상 교체', '파츠 이상 수리', '물품 이상 교체', '물품 이상 수리', '용액 / 용자 이상'];
    const isPartType = partKeywords.includes(dt3) || partKeywords.includes(dt1) || partKeywords.includes(dt2) || itemsArr.some(s => partKeywords.some(kw => s.includes(kw)));

    // 완료된 파트 상태일 때 하단 요약 박스 동적 생성 및 매핑
    document.querySelectorAll('#detail-display-list-wrapper').forEach(el => el.remove());
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    let parsedParts = [];

    itemsArr.forEach(rawItem => {
        let itemStr = rawItem.trim();
        if (!itemStr || itemStr === '내용 없음') return;

        const prefixMatch = itemStr.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|파츠 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
        if (prefixMatch) itemStr = prefixMatch[2].trim();

        let costTag = item.costType || '유상';
        const costMatch = itemStr.match(/^\[(.*?)\]\s*(.*)$/);
        if (costMatch) {
            costTag = costMatch[1].trim();
            itemStr = costMatch[2].trim();
        }

        let specStr = '';
        const specMatch = itemStr.match(/\s*\[(.*?)\]$/);
        if (specMatch) {
            specStr = specMatch[1].trim();
            itemStr = itemStr.replace(specMatch[0], '').trim();
        }

        let displayPartName = itemStr;
        const matchItem = adminItems.find(ai => (ai.part || '').trim().toLowerCase() === itemStr.toLowerCase() || (ai.code || '').trim().toLowerCase() === itemStr.toLowerCase());
        if (matchItem && matchItem.code) {
            displayPartName = matchItem.code;
        }

        if (displayPartName && !partKeywords.includes(displayPartName)) {
            parsedParts.push({ cost: costTag, partName: displayPartName, spec: specStr });
        }
    });


    // 하단 요약 박스를 보여주는 조건: 1) 기존 비정기 파트타입이면서 물품이 1개 이상이거나, 2) 물품이 2개 이상 선택되어 있는 모든 경우(PM점검 포함)
    const isShowDisplayList = isPartType || (parsedParts.length >= 2);

    if (isCompleted && isShowDisplayList) {
        const contentInputLocal = document.getElementById('detail-content-input');
        const parentContainer = contentInputLocal ? (contentInputLocal.closest('.form-row') || contentInputLocal.closest('.detail-row') || contentInputLocal.parentNode) : null;

        let displayListWrapper = document.createElement('div');
        displayListWrapper.id = 'detail-display-list-wrapper';
        displayListWrapper.style.marginTop = '0px';
        displayListWrapper.style.padding = '10px';
        displayListWrapper.style.background = '#161b22';
        displayListWrapper.style.border = '1px solid #30363d';
        displayListWrapper.style.borderRadius = '4px';
        displayListWrapper.style.fontSize = '13px';
        displayListWrapper.style.color = '#c9d1d9';
        displayListWrapper.style.minHeight = '40px';
        displayListWrapper.style.maxHeight = '250px';
        displayListWrapper.style.overflowY = 'auto';
        displayListWrapper.style.flexShrink = '0';
        displayListWrapper.style.width = '100%';
        displayListWrapper.style.boxSizing = 'border-box';

        if (parentContainer && parentContainer.parentNode) {
            parentContainer.parentNode.insertBefore(displayListWrapper, parentContainer.nextSibling);
        }

        if (parsedParts.length > 0) {
            displayListWrapper.style.display = 'block';
            displayListWrapper.innerHTML = parsedParts.map(p => {
                const costVal = p.cost || '유상';
                const specSuffix = p.spec ? ` [${p.spec}]` : '';
                return `<div style="margin-bottom:4px; word-break:keep-all;">• [${escapeHtml(costVal)}] ${escapeHtml(p.partName)}${escapeHtml(specSuffix)}</div>`;
            }).join('');
        } else {
            displayListWrapper.style.display = 'none';
        }
    }

    // 내용 란(contentEl)에는 "[비용처리] 첫번째 선택한 물품 외 몇 개" 형식의 기본 방식으로 표출
    const dtParts = (item.detailType || '').split(' > ').map(v => v.trim()).filter(Boolean);
    const subCategoryKeywords = [
        'PM 점검', 'BM 점검', 'Alarm', 'Hunting', 'Data / Para 이상',
        '순회 점검', '프로그램 변경 / 평가', '설비 평가', '파티클 필터 교체',
        '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정',
        '용액제조', '온라인점검', '현장 이슈', 'PC 이상', '작업자 실수',
        '통신 이상', '용액 용자 이상', '파트 이상 교체', '파트 이상 수리',
        '프로그램 이상', '기타', '장비 점검', '추가 작업'
    ];

    const displayLabelsArr = itemsArr.map(s => {
        let temp = s.trim();
        if (!temp || temp === '내용 없음') return '';

        // 비용처리 라벨 보존 파싱 (예: "[유상]")
        let costLabel = '';
        const costMatch = temp.match(/^(\[.*?\])\s*(.*)$/);
        if (costMatch) {
            costLabel = costMatch[1].trim() + ' ';
            temp = costMatch[2].trim();
        }

        const prefixMatch = temp.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|파츠 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
        if (prefixMatch) {
            temp = prefixMatch[2].trim();
        }
        const specMatch = temp.match(/\s*\[(.*?)\]$/);
        if (specMatch) {
            temp = temp.replace(specMatch[0], '').trim();
        }

        if (dtParts.includes(temp) || subCategoryKeywords.includes(temp) || temp === item.detailType) {
            return '';
        }

        const matchItem = adminItems.find(ai => (ai.part || '').trim().toLowerCase() === temp.toLowerCase() || (ai.code || '').trim().toLowerCase() === temp.toLowerCase());
        if (matchItem && matchItem.code) {
            temp = matchItem.code;
        }
        return `${costLabel}${temp}`.trim();
    }).filter(Boolean);

    if (displayLabelsArr.length > 1) {
        contentEl.innerText = `${displayLabelsArr[0]} 외 ${displayLabelsArr.length - 1}개`;
        contentEl.title = displayLabelsArr.join('\n');
    } else if (displayLabelsArr.length === 1) {
        contentEl.innerText = displayLabelsArr[0];
        contentEl.title = displayLabelsArr[0];
    } else {
        // [요청 반영] 작업 완료 상태이고 입력된 내용/물품이 없는 경우 비용처리 라벨 없이 '내용 없음'으로 표기
        if (isCompleted) {
            contentEl.innerText = '내용 없음';
            contentEl.title = '내용 없음';
        } else {
            contentEl.innerText = '';
            contentEl.title = '';
        }
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
    const detailContentInputEl = document.getElementById('detail-content-input');
    if (detailContentInputEl) {
        detailContentInputEl.value = (displayContent && displayContent !== '내용 없음') ? displayContent : '';
        detailContentInputEl.style.width = '100%';
        detailContentInputEl.style.maxWidth = '100%';
        detailContentInputEl.style.boxSizing = 'border-box';
        detailContentInputEl.style.flex = '1 1 100%';

        const contentRow = detailContentInputEl.closest('.form-row') || detailContentInputEl.closest('.detail-row') || detailContentInputEl.parentNode;
        if (contentRow) {
            contentRow.style.width = '100%';
            contentRow.style.boxSizing = 'border-box';
            const flexContainer = contentRow.querySelector('#detail-content-flex-container');
            if (flexContainer) flexContainer.style.width = '100%';
        }

        // 내용 입력 시 콤마(,) 특수문자 입력 제한 (물품 쪼개짐 현상 차단)
        if (!detailContentInputEl.dataset.commaBound) {
            detailContentInputEl.dataset.commaBound = 'true';
            detailContentInputEl.addEventListener('input', (e) => {
                if (e.target.value.includes(',')) {
                    e.target.value = e.target.value.replace(/,/g, '');
                    alert('내용 텍스트 입력 시 콤마(,) 특수문자는 사용할 수 없습니다.');
                }
            });
        }
    }
    if (contentDiv) {
        contentDiv.style.width = '100%';
        contentDiv.style.maxWidth = '100%';
        contentDiv.style.boxSizing = 'border-box';
        contentDiv.style.flex = '1 1 100%';
    }
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
    if (detailContentInputEl) detailContentInputEl.style.display = 'none';

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
    const startDateField = document.getElementById('detail-start-date');
    const endDateField = document.getElementById('detail-end-date');

    dateField.value = isCompleted ? (item.date || '') : (item.scheduledDate || '');
    dateField.disabled = false;

    // [요청 반영] 추가 작업 상세 모달의 경우 최초 작업일 이전 날짜 비활성화 및 다음 날짜 자동 선택 보정
    let parentLogDate = '';
    if (item.originalLogId) {
        const parentLog = (data.logs || []).find(l => l.id == item.originalLogId) || (data.maint || []).find(m => m.id == item.originalLogId);
        if (parentLog) {
            parentLogDate = parentLog.date || parentLog.scheduledDate || '';
        }
    }

    if (parentLogDate) {
        const nextDayStr = window.getNextDayStr ? window.getNextDayStr(parentLogDate) : parentLogDate;
        const minAllowedDate = nextDayStr || parentLogDate;
        if (dateField) {
            dateField.min = minAllowedDate; // [요청 반영] 최초 작업일의 하루 다음날부터만 달력 선택 가능
            if (!dateField.value || dateField.value <= parentLogDate) {
                dateField.value = minAllowedDate; // [요청 반영] 최초 작업일 다음날로 기본 선택
            }
        }
        if (startDateField) startDateField.min = minAllowedDate;
        if (endDateField) endDateField.min = minAllowedDate;
    } else {
        if (dateField) dateField.removeAttribute('min');
        if (startDateField) startDateField.removeAttribute('min');
        if (endDateField) endDateField.removeAttribute('min');
    }

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
            const currentPath = window.location.pathname.toLowerCase();
            const currentHref = window.location.href.toLowerCase();
            const isOpOrSortPage = currentPath.includes('operation') || currentPath.includes('sort') || currentHref.includes('/operation') || currentHref.includes('/sort');

            if (hideActionBtns || isOpOrSortPage || item.detailType === '일정변경') {
                cancelBtn.style.display = 'none';
            } else {
                cancelBtn.style.display = 'block';
            }
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

        const updateDetailType3s = () => {
            const selectedType = typeSelect.value;
            const selectedDetailType = detailTypeSelect.value;
            const selectedDetailType2 = detailType2Select ? detailType2Select.value : '';
            if (!detailType3Select) return;

            if (selectedType !== '비정기' || !selectedDetailType || !selectedDetailType2) {
                detailType3Select.style.display = 'none';
                buildDetailDropdown(item, site, equip);
                return;
            }
            detailType3Select.style.display = 'inline-block';

            const catData3 = JSON.parse(localStorage.getItem('check_type_categories3')) || {};
            const defaultSubCategories3 = [
                "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
                "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
            ];

            let subCategories3 = (catData3[selectedDetailType2] && catData3[selectedDetailType2].length > 0) ? catData3[selectedDetailType2] : (catData3['default'] || catData3[`COMMON::${selectedType}::${selectedDetailType}::${selectedDetailType2}`] || defaultSubCategories3);

            detailType3Select.innerHTML = subCategories3.map(s => `<option value="${s}">${s}</option>`).join('');
            buildDetailDropdown(item, site, equip);
        };

        const updateDetailType2s = () => {
            const selectedType = typeSelect.value;
            const selectedDetailType = detailTypeSelect.value;
            if (selectedType !== '비정기' || !selectedDetailType) {
                if (detailType2Select) detailType2Select.style.display = 'none';
                if (detailType3Select) detailType3Select.style.display = 'none';
                buildDetailDropdown(item, site, equip);
                return;
            }
            if (detailType2Select) detailType2Select.style.display = 'inline-block';

            const catData2 = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
            const defaultSubCategories2 = {
                'Alarm': ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람'],
                'Hunting': ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅'],
                'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈'],
                '기타': ['배수 펌프 이슈', '구동 이상']
            };
            let subCategories2 = (catData2[selectedDetailType] && catData2[selectedDetailType].length > 0) ? catData2[selectedDetailType] : (catData2[`COMMON::${selectedType}::${selectedDetailType}`] || defaultSubCategories2[selectedDetailType] || []);

            detailType2Select.innerHTML = subCategories2.map(s => `<option value="${s}">${s}</option>`).join('');
            updateDetailType3s();
        };

        if (detailType2Select) {
            detailType2Select.onchange = updateDetailType3s;
        }

        const updateDetailTypes = () => {
            const selectedType = typeSelect.value;
            const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
            const defaultSubCategories = {
                '정기': ['PM 점검'],
                '비정기': ['BM 점검', 'Alarm', 'Hunting', 'Data / Para 이상', '기타'],
                '고객대응': ['순회 점검', '프로그램 변경 / 평가', '설비 평가', '파티클 필터 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '기타'],
                '용액제조': ['용액제조'],
                '온라인점검': ['온라인점검']
            };
            let subCategories = (catData[selectedType] && catData[selectedType].length > 0) ? catData[selectedType] : (catData[`COMMON::${selectedType}`] || defaultSubCategories[selectedType] || []);

            detailTypeSelect.innerHTML = subCategories.map(s => `<option value="${s}">${s}</option>`).join('');

            if (selectedType === '비정기') {
                updateDetailType2s();
            } else {
                if (detailType2Select) detailType2Select.style.display = 'none';
                if (detailType3Select) detailType3Select.style.display = 'none';
                buildDetailDropdown(item, site, equip);
            }
        };

        typeSelect.onchange = updateDetailTypes;
        detailTypeSelect.onchange = updateDetailType2s;
        if (detailType2Select) detailType2Select.onchange = updateDetailType3s;
        if (detailType3Select) detailType3Select.onchange = () => buildDetailDropdown(item, site, equip);

        updateDetailTypes();

        if (Array.from(detailTypeSelect.options).some(opt => opt.value === initialDetailType)) {
            detailTypeSelect.value = initialDetailType;
            if (typeSelect.value === '비정기') {
                updateDetailType2s();
                if (Array.from(detailType2Select.options).some(opt => opt.value === initialDetailType2)) {
                    detailType2Select.value = initialDetailType2;
                    updateDetailType3s();
                    if (detailType3Select && Array.from(detailType3Select.options).some(opt => opt.value === initialDetailType3)) {
                        detailType3Select.value = initialDetailType3;
                    }
                }
            }
        }

        // [요청 반영] 추가 작업 상세 정보 모달일 때 구분, 세부구분, 세부구분2 비활성화
        const isAddWorkDetail = !!(item.originalLogId || item.original_log_id || item.add_work_log_id);
        if (isAddWorkDetail) {
            if (typeSelect) typeSelect.disabled = true;
            if (detailTypeSelect) detailTypeSelect.disabled = true;
            if (detailType2Select) detailType2Select.disabled = true;
        } else {
            if (typeSelect) typeSelect.disabled = false;
            if (detailTypeSelect) detailTypeSelect.disabled = false;
            if (detailType2Select) detailType2Select.disabled = false;
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
        if (detailContentInputEl) {
            detailContentInputEl.disabled = true;
            detailContentInputEl.style.width = '100%';
            detailContentInputEl.style.maxWidth = '100%';
            detailContentInputEl.style.boxSizing = 'border-box';
            detailContentInputEl.style.flex = '1 1 100%';
        }
        if (contentDiv) {
            contentDiv.style.width = '100%';
            contentDiv.style.maxWidth = '100%';
            contentDiv.style.boxSizing = 'border-box';
            contentDiv.style.flex = '1 1 100%';
        }
    } else {
        if (detailContentInputEl) {
            const detailTypeSel = document.getElementById('detail-detail-type-select');
            const typeSel = document.getElementById('detail-type-select');
            const curType = typeSel && typeSel.style.display !== 'none' ? typeSel.value : (item.type || '정기');
            const curDetailType = detailTypeSel && detailTypeSel.style.display !== 'none' ? detailTypeSel.value : (item.detailType || '');
            const isParticleFilter = curType === '고객대응' && (curDetailType === '파티클 필터 교체' || curDetailType.startsWith('파티클 필터 교체'));
            detailContentInputEl.disabled = isParticleFilter;
        }
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
    if (!currentContentStr) currentContentStr = '';

    // [추가] 변경 감지를 위해 모달 오픈 시점의 초기 상태 저장
    window.initialEventDetail = getDetailSnapshot();

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
        if (queryId && !hideActionBtns) {
            const localChildLogs = (data.logs || []).filter(l => l.originalLogId && (String(l.originalLogId) === String(queryId) || String(l.originalLogId) === String(id)));
            const localChildMaints = (data.maint || []).filter(m => m.originalLogId && (String(m.originalLogId) === String(queryId) || String(m.originalLogId) === String(id)));
            const localCount = localChildLogs.length + localChildMaints.length;

            if (localCount > 0) {
                additionalWorksBtn.style.display = 'inline-block';
                additionalWorksBtn.textContent = `추가작업 확인 (${localCount})`;
                if (btnGroup) btnGroup.classList.add('has-additional-work');
                additionalWorksBtn.onclick = () => {
                    if (typeof window.openExtraWorkHistoryModal === 'function') {
                        window.openExtraWorkHistoryModal(site, equip, queryId);
                    }
                };
            }

            fetch(`/api/maintenance/additional-works?parent_id=${encodeURIComponent(queryId)}`, {
                headers: { 'X-CSRFToken': getCookie('csrf_token') }
            })
                .then(res => res.json())
                .then(resData => {
                    if (hideActionBtns) return;
                    if (resData.status === 'success' && resData.data && resData.data.length > 0) {
                        const totalCount = Math.max(resData.data.length, localCount);
                        additionalWorksBtn.style.display = 'inline-block';
                        additionalWorksBtn.textContent = `추가작업 확인 (${totalCount})`;
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
        if (!hideActionBtns && isCompleted && item.type === '비정기') {
            troubleHistoryBtn.style.display = 'inline-block';
            // [수정] Trouble 이력 작성 버튼이 노출되므로 부모에 클래스 부여
            if (btnGroup) {
                btnGroup.classList.add('has-trouble-history');
            }
            troubleHistoryBtn.onclick = () => {
                let targetUrl = `trouble.html?site=${encodeURIComponent(site)}&equip=${encodeURIComponent(equip)}`;
                if (item.date) {
                    targetUrl += `&date=${encodeURIComponent(item.date)}`;
                }
                location.href = targetUrl;
            };
        } else {
            troubleHistoryBtn.style.display = 'none';
        }
    }

    // [추가] '추가작업 생성' 버튼 노출 및 동작 바인딩
    const createAddWorkBtn = document.getElementById('btn-create-additional-work');
    if (createAddWorkBtn) {
        if (!hideActionBtns && isCompleted) {
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
                        detailType3: item.detailType3 || '',
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
    if (currentDetailTarget && currentDetailTarget.isCompleted) return;
    const contentDiv = document.getElementById('detail-content');
    const contentInput = document.getElementById('detail-content-input');
    if (!contentDiv || !contentInput) return;

    if (contentInput) {
        contentInput.disabled = false; // 다른 항목 전환 시 비활성화 초기화
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
    const detailType3Select = document.getElementById('detail-detail-type3-select');
    let detailType3 = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';

    if (detailTypeWrapper && detailTypeWrapper.style.display !== 'none' && detailTypeSelect) {
        detailTypeFull = detailTypeSelect.value;
        if (type === '비정기' && detailType2Select && detailType2Select.style.display !== 'none') {
            detailTypeFull += ` > ${detailType2Select.value}`;
            if (detailType3) detailTypeFull += ` > ${detailType3}`;
        }
    }

    // [추가] 비정기일 때 세부구분 3이 파트 이상 교체, 파트 이상 수리, 용액 용자 이상이 아닌 경우 텍스트 입력창 모드로 전환
    if (type === '비정기') {
        const isPartNeeded = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3);
        if (!isPartNeeded) {
            contentDiv.style.display = 'none';
            contentInput.style.display = 'block';
            contentInput.disabled = false;
            contentInput.value = (item && item.content && item.content !== '내용 없음') ? window.removeCostLabels(item.content) : '';

            const pWrapper = document.getElementById('detail-edit-part-wrapper');
            if (pWrapper) pWrapper.style.display = 'none';

            document.querySelectorAll('#detail-content-flex-container').forEach(el => el.remove());
            document.querySelectorAll('#detail-content-dropdown-wrapper').forEach(el => el.remove());
            document.querySelectorAll('#detail-display-list-wrapper').forEach(el => el.remove());

            if (typeof window.updateDetailDisplayList === 'function') window.updateDetailDisplayList();
            return;
        }
    }

    // [추가] 고객대응 > 파티클 필터 교체 작업 내용 강제 고정 및 제어 우회
    if (type === '고객대응' && (detailTypeFull === '파티클 필터 교체' || detailTypeFull.startsWith('파티클 필터 교체'))) {
        contentDiv.style.display = 'none';
        contentInput.style.display = 'block';
        contentInput.value = '[유상] Particle Filter';
        contentInput.disabled = true;

        const pWrapper = document.getElementById('detail-edit-part-wrapper');
        if (pWrapper) pWrapper.style.display = 'none';

        document.querySelectorAll('#detail-content-flex-container').forEach(el => el.remove());
        document.querySelectorAll('#detail-content-dropdown-wrapper').forEach(el => el.remove());
        document.querySelectorAll('#detail-display-list-wrapper').forEach(el => el.remove());

        if (typeof window.updateDetailDisplayList === 'function') window.updateDetailDisplayList();
        return;
    }

    // [추가] 고객대응에서 '설비 정상화' 제외 다른 세부구분은 텍스트 직접 입력 모드로 설정 (물품 드롭다운 비노출)
    if (type === '고객대응' && detailTypeFull !== '설비 정상화' && !detailTypeFull.startsWith('설비 정상화')) {
        contentDiv.style.display = 'none';
        contentInput.style.display = 'block';
        contentInput.disabled = false;
        if (contentInput.value === '[유상] Particle Filter') {
            contentInput.value = (item && item.content && item.content !== '내용 없음' && item.content !== '[유상] Particle Filter') ? item.content : '';
        } else if (!contentInput.value) {
            contentInput.value = (item && item.content && item.content !== '내용 없음') ? item.content : '';
        }

        const pWrapper = document.getElementById('detail-edit-part-wrapper');
        if (pWrapper) pWrapper.style.display = 'none';

        document.querySelectorAll('#detail-content-flex-container').forEach(el => el.remove());
        document.querySelectorAll('#detail-content-dropdown-wrapper').forEach(el => el.remove());
        document.querySelectorAll('#detail-display-list-wrapper').forEach(el => el.remove());

        if (typeof window.updateDetailDisplayList === 'function') window.updateDetailDisplayList();
        return;
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
        detailType2 = parts[1] ? parts[1].trim() : '';
        if (parts[2]) detailType3 = parts[2].trim();
    }

    let currentContent = contentDiv.dataset.rawContent || contentDiv.innerText.trim();
    if (currentContent === '내용 없음') currentContent = '';

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    const itemsArr = window.splitSafetyContent(currentContent);
    let baseItems = [];
    let partItems = [];

    itemsArr.forEach(item => {
        const match = item.match(/^(.*?(?:파트 이상\s*\(?(?:교체|수리)\)?|물품 이상\s*\(?(?:교체|수리)\)?|용액\s*\/?\s*용자 이상))\s*-\s*(.*)$/);
        if (match) {
            let suffix = match[2].replace(/^[\s-]+/, '').trim();

            let cost = '';
            const innerCostMatch = suffix.match(/^\[(.*?)\]\s*(.*)$/);
            if (innerCostMatch) {
                cost = innerCostMatch[1];
                suffix = innerCostMatch[2];
            }

            if (suffix) {
                if (cost) baseItems.push(`[${cost}] ${suffix}`);
                else baseItems.push(suffix);
            }
        } else {
            baseItems.push(item);
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
    let availableItems = [];
    let isDropdownMode = false;

    if (type === '비정기') {
        const detailType3Select = document.getElementById('detail-detail-type3-select');
        let detailType3 = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';

        if (['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3)) {
            isDropdownMode = true;
            let equipParts = (equipKey || '').split('::').map(s => s.trim()).filter(Boolean);
            let equipName = equipParts.length > 1 ? equipParts[1] : (equipParts[0] || '');
            const matchedModel = (typeof equipmentModels !== 'undefined' ? equipmentModels : []).find(m => m.name === equipName || m.abbr === equipName);
            const targetEquipNames = [equipName];
            if (matchedModel) {
                if (matchedModel.name) targetEquipNames.push(matchedModel.name);
                if (matchedModel.abbr) targetEquipNames.push(matchedModel.abbr);
            }

            let matchedItems = adminItems.filter(ai => {
                if (!ai.equip || !ai.equip.trim()) return true;
                const equips = ai.equip.split(',').map(e => e.trim());
                if (equips.includes('전장비') || equips.includes('전 장비') || equips.includes('전체')) return true;
                return targetEquipNames.some(tn => equips.includes(tn));
            });
            let otherItems = adminItems.filter(ai => !matchedItems.includes(ai));
            availableItems = [...matchedItems, ...otherItems].map(mItem => ({ content: mItem.part, code: mItem.code }));
        } else {
            isDropdownMode = false;
        }
    } else {
        // [수정] check_type_items 대신 maint_log 이력 및 admin_items 데이터 활용
        const detailData = (site && equip) ? (JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {}) : {};
        let historyItems = (detailData.maint || []).filter(m => m.type === type && m.detailType === detailType);
        if (historyItems.length > 0) {
            isDropdownMode = true;
            availableItems = historyItems.map(m => ({ content: m.content, code: m.code || '' }));
        } else {
            availableItems = adminItems.map(mItem => ({ content: mItem.part, code: mItem.code }));
        }

        if (availableItems.length === 0) {
            isDropdownMode = true;
            let equipParts = (equipKey || '').split('::').map(s => s.trim()).filter(Boolean);
            let equipName = equipParts.length > 1 ? equipParts[1] : (equipParts[0] || '');
            const matchedModel = (typeof equipmentModels !== 'undefined' ? equipmentModels : []).find(m => m.name === equipName || m.abbr === equipName);
            const targetEquipNames = [equipName];
            if (matchedModel) {
                if (matchedModel.name) targetEquipNames.push(matchedModel.name);
                if (matchedModel.abbr) targetEquipNames.push(matchedModel.abbr);
            }

            let matchedItems = adminItems.filter(ai => {
                if (!ai.equip || !ai.equip.trim()) return true;
                const equips = ai.equip.split(',').map(e => e.trim());
                if (equips.includes('전장비') || equips.includes('전 장비') || equips.includes('전체')) return true;
                return targetEquipNames.some(tn => equips.includes(tn));
            });
            let otherItems = adminItems.filter(ai => !matchedItems.includes(ai));
            availableItems = [...matchedItems, ...otherItems].map(mItem => ({ content: mItem.part, code: mItem.code }));
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
            realContent = match.code || match.part || content;
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
                realContent = match.code || match.part || realContent;
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
        const detailType3Val = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';
        const isPartMode = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3Val)));

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

                    const nonPartKeywords = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "프로그램 이상", "단순조치", "기타", "내용 없음"];
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

            if (isPartMode) {
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

        if (isPartMode) {
            const allAdminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            allAdminItems.forEach(a => {
                if (!a.part && !a.code) return;
                const baseName = a.code || a.part;
                let partno = a.partno || '';
                if (!poolMap.has(baseName)) {
                    poolMap.set(baseName, { content: a.part || a.code, code: a.code || '', partno: partno, spec: '', displayValue: baseName });
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

        let showAll = registeredItems.length === 0 || isPartMode;
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

            if (type === '비정기' && !isPartMode && isPart) {
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
                    const txt = `${item.displayValue || ''} ${item.content || ''} ${item.code || ''} ${item.partno || ''} ${item.spec || ''}`.toLowerCase();
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

                    const detailType3Val = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';
                    const isPartModeTpl = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3Val)));
                    const templateId = isPartModeTpl ? 'log-part-item-template' : 'detail-content-item-template';
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
                            addSpecBtn.type = 'button';
                            addSpecBtn.style.cssText = 'margin-left: 5px; background: #0d1117; border: 1px solid #3fb950; color: #3fb950; border-radius: 4px; padding: 0 4px; font-size: 12px; font-weight: bold; cursor: pointer; flex-shrink: 0; line-height: 1; position: relative; z-index: 20; -webkit-tap-highlight-color: rgba(0,0,0,0);';
                            addSpecBtn.title = '물품 상세 추가';

                            let lastBtnTouch = 0;
                            const triggerAddSpec = (e) => {
                                if (e) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }
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

                            addSpecBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
                            addSpecBtn.ontouchstart = (e) => { e.stopPropagation(); };
                            addSpecBtn.ontouchend = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                lastBtnTouch = Date.now();
                                triggerAddSpec(e);
                            };
                            addSpecBtn.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (Date.now() - lastBtnTouch < 600) return;
                                triggerAddSpec(e);
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

                        let startY = 0;
                        let startX = 0;
                        let isMoving = false;

                        div.addEventListener('touchstart', (e) => {
                            window.lastTouchTime = Date.now();
                            startY = e.touches[0].clientY;
                            startX = e.touches[0].clientX;
                            isMoving = false;
                        }, { passive: true });

                        div.addEventListener('touchmove', (e) => {
                            const moveY = e.touches[0].clientY;
                            const moveX = e.touches[0].clientX;
                            if (Math.abs(moveY - startY) > 6 || Math.abs(moveX - startX) > 6) {
                                isMoving = true;
                            }
                        }, { passive: true });

                        const handleSelect = (e) => {
                            if (e.target.closest('button') || e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') return;
                            e.preventDefault();
                            e.stopPropagation();

                            const detailType3Val = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';
                            const isPartMode = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3Val)));

                            if (type === '비정기' && !isPartMode) {
                                list.querySelectorAll('.log-select-item.selected').forEach(el => {
                                    if (el !== div) el.classList.remove('selected');
                                });
                            }
                            div.classList.toggle('selected');
                            updateTriggerText();
                            if (type === '비정기' && !isPartMode && div.classList.contains('selected')) {
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
                        };

                        div.addEventListener('touchend', (e) => {
                            if (isMoving) return;
                            handleSelect(e);
                        });

                        div.addEventListener('mousedown', (e) => {
                            if (window.lastTouchTime && Date.now() - window.lastTouchTime < 600) return;
                            handleSelect(e);
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

        const isPartModeFooter = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3)));
        const footer = dropdown ? dropdown.querySelector('.log-select-footer') : null;
        if (footer) footer.style.display = (type === '비정기' && !isPartModeFooter) ? 'none' : 'flex';

        addBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropdown.classList.remove('show');
        });
        if (type === '비정기' && !isPartModeFooter) { addBtn.parentElement.style.display = 'none'; }

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

        const hasPartIssue = (type !== '비정기' && type !== '정기') && currentValues.some(val => val.includes('파트 이상 교체') || val.includes('파트 이상 수리') || val.includes('파트 이상 (교체)') || val.includes('파트 이상 (수리)') || val.includes('용액 / 용자 이상') || val.includes('용액 용자 이상'));
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

        const detailType3Select = document.getElementById('detail-detail-type3-select');
        const detailType3Val = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';
        const isPartMode = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3Val)));

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

            if (!isPartMode && isRegisteredPart) return;

            const isPartKeyword = type !== '정기' && (val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상'));
            if (isPartKeyword && partValsStr) {
                const pArr = partValsStr.split(',').map(s => s.trim()).filter(Boolean);
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

        let cleanVals = allVals.map(val => {
            let cleanV = val;
            const m1 = cleanV.match(/^\[.*?\]\s*(.*)$/);
            if (m1 && !isPartMode) cleanV = m1[1];
            return cleanV;
        });
        cleanVals = [...new Set(cleanVals)];

        if (cleanVals.length > 0) {
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

function getDetailSnapshot() {
    if (!currentDetailTarget) return null;

    const workerInput = document.getElementById('detail-worker');
    const mdInput = document.getElementById('detail-md');
    const memoInput = document.getElementById('detail-work-memo');
    const dateField = document.getElementById('detail-scheduled-date');
    const costTypeInput = document.getElementById('detail-cost-type');
    const issueShareCb = document.getElementById('detail-issue-share-checkbox');

    const worker = workerInput ? workerInput.value.trim() : '';
    const md = mdInput ? mdInput.value.trim() : '';
    const memo = memoInput ? memoInput.value.trim() : '';
    const date = dateField ? dateField.value : '';
    const costType = costTypeInput ? costTypeInput.value : '';
    const issueShared = issueShareCb ? issueShareCb.checked : false;
    const startTime = getSplitDateTimeValue('detail-start');
    const endTime = getSplitDateTimeValue('detail-end');

    const typeSelect = document.getElementById('detail-type-select');
    const detailTypeSelect = document.getElementById('detail-detail-type-select');
    const detailType2Select = document.getElementById('detail-detail-type2-select');
    const detailType3Select = document.getElementById('detail-detail-type3-select');

    let type = currentDetailTarget.type || '정기';
    if (typeSelect && typeSelect.style.display !== 'none') type = typeSelect.value;

    let detailType = currentDetailTarget.detailType || '';
    if (detailTypeSelect && detailTypeSelect.style.display !== 'none') {
        detailType = detailTypeSelect.value;
        if (type === '비정기' && detailType2Select && detailType2Select.style.display !== 'none' && detailType2Select.value) {
            detailType += ` > ${detailType2Select.value}`;
            if (detailType3Select && detailType3Select.style.display !== 'none' && detailType3Select.value) {
                detailType += ` > ${detailType3Select.value}`;
            }
        }
    }

    let currentContent = '';
    let expandedDropdownValues = [];
    const dropdownWrapper = document.getElementById('detail-content-dropdown-wrapper');
    if (dropdownWrapper) {
        const list = dropdownWrapper.querySelector('.log-select-list');
        const selected = list ? list.querySelectorAll('.log-select-item.selected') : [];
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
        const detailType3Val = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';
        const isPartMode = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3Val)));

        baseVals.forEach(val => {
            let baseCost = '유상';
            const bMatch = val.match(/^\[(.*?)\] (.*)$/);
            if (bMatch) { baseCost = bMatch[1]; val = bMatch[2]; }

            let cleanVal = window.removeCostLabels(val);
            const valSpecMatch = cleanVal.match(/\s*\[(.*?)\]$/);
            if (valSpecMatch) cleanVal = cleanVal.replace(valSpecMatch[0], '').trim();

            const isRegisteredPart = adminItems.some(ai => {
                const p = (ai.part || '').trim();
                const c = (ai.code || '').trim();
                return (p && (p === cleanVal || p === val)) || (c && (c === cleanVal || c === val));
            });

            if (partContentList.length > 0 && isRegisteredPart) {
                const isCovered = partContentList.some(p => {
                    let cleanP = window.removeCostLabels(p);
                    const pSpecMatch = cleanP.match(/\s*\[(.*?)\]$/);
                    if (pSpecMatch) cleanP = cleanP.replace(pSpecMatch[0], '').trim();
                    return cleanP === cleanVal || cleanP === val;
                });
                if (isCovered) return;
            }

            if (type === '비정기' && !isPartMode && isRegisteredPart) return;

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
        const inputVal = document.getElementById('detail-content-input') ? document.getElementById('detail-content-input').value.trim() : '';
        if (inputVal) expandedDropdownValues.push(inputVal);
        currentContent = expandedDropdownValues.join(', ');
    }
    if (!currentContent) currentContent = '';

    return {
        worker,
        md,
        memo,
        date,
        costType,
        issueShared,
        startTime,
        endTime,
        type,
        detailType,
        content: currentContent
    };
}

function hasDetailUnsavedChanges() {
    if (!currentDetailTarget || !window.initialEventDetail) return false;
    const current = getDetailSnapshot();
    if (!current) return false;

    const initial = window.initialEventDetail;
    return current.worker !== initial.worker ||
        current.md !== initial.md ||
        current.memo !== initial.memo ||
        current.date !== initial.date ||
        current.content !== initial.content ||
        current.issueShared !== initial.issueShared ||
        current.costType !== initial.costType ||
        current.type !== initial.type ||
        current.detailType !== initial.detailType ||
        current.startTime !== initial.startTime ||
        current.endTime !== initial.endTime;
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
    let newDetailType2 = item.detailType2 || '';
    let newDetailType3 = item.detailType3 || '';

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
        const detailType3Select = document.getElementById('detail-detail-type3-select');

        if (typeSelect) newType = typeSelect.value;
        if (detailTypeSelect && detailTypeSelect.style.display !== 'none' && detailTypeSelect.value) {
            newDetailType = detailTypeSelect.value;
            if (newType === '비정기') {
                if (detailType2Select && detailType2Select.style.display !== 'none' && detailType2Select.value) {
                    newDetailType2 = detailType2Select.value;
                }
                if (detailType3Select && detailType3Select.style.display !== 'none' && detailType3Select.value) {
                    newDetailType3 = detailType3Select.value;
                }
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

        if (baseDropdownValues.length === 0 && partContentList.length > 0) {
            partContentList.forEach(p => expandedDropdownValues.push(p));
        } else {
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

                // [추가] partContentList에 세부 물품이 선택되어 있는 경우, 이미 포함된 물품(cleanVal)이 단독/미상세로 중복 추가되는 것 차단
                if (partContentList.length > 0 && isRegisteredPart) {
                    const isCovered = partContentList.some(p => {
                        let cleanP = window.removeCostLabels(p);
                        const pSpecMatch = cleanP.match(/\s*\[(.*?)\]$/);
                        if (pSpecMatch) cleanP = cleanP.replace(pSpecMatch[0], '').trim();
                        return cleanP === cleanVal || cleanP === val;
                    });
                    if (isCovered) return;
                }

                const detailType3Select = document.getElementById('detail-detail-type3-select');
                const detailType3Val = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';
                const isPartMode = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3Val);

                if (newType === '비정기' && !isPartMode && (isRegisteredPart || isSpecOnly)) return;

                const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
                if (isPartKeyword && partContentList.length > 0) {
                    partContentList.forEach(p => {
                        if (newType === '비정기') {
                            expandedDropdownValues.push(p);
                        } else {
                            expandedDropdownValues.push(`${val} - ${p}`);
                        }
                    });
                } else if (isPartKeyword) {
                    expandedDropdownValues.push(val);
                } else if (isRegisteredPart) {
                    expandedDropdownValues.push(`[${baseCost}] ${val}`);
                } else {
                    const cleanV = window.removeCostLabels(val).trim();
                    if (cleanV && cleanV !== '내용 없음') {
                        expandedDropdownValues.push(cleanV);
                    }
                }
            });

            if (partContentList.length > 0) {
                partContentList.forEach(p => {
                    if (!expandedDropdownValues.some(ev => ev.includes(p) || p.includes(ev))) {
                        expandedDropdownValues.push(p);
                    }
                });
            }
        }
    } else {
        const inputVal = document.getElementById('detail-content-input').value.trim();
        if (inputVal && inputVal !== '내용 없음') {
            const cleanV = window.removeCostLabels(inputVal).trim();
            if (cleanV && cleanV !== '내용 없음') {
                const isReg = adminItems.some(ai => {
                    const p = (ai.part || '').trim();
                    const c = (ai.code || '').trim();
                    return (p && (p === cleanV || p === inputVal)) || (c && (c === cleanV || c === inputVal));
                });
                if (isReg) {
                    expandedDropdownValues.push(inputVal.startsWith('[') ? inputVal : `[유상] ${inputVal}`);
                } else {
                    expandedDropdownValues.push(cleanV);
                }
            }
        }
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
                detailType3: '',
                content: `[변경] ${changedItem.content}`,
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
        // [수정] 완료 상태의 정보를 수정 저장할 때는 기존 등록된 물품(item.content)이 지워지지 않도록 그대로 보존
        finalContentStr = item.content || '';

        if (newType === '고객대응' && (newDetailType === '파티클 필터 교체' || newDetailType.startsWith('파티클 필터 교체'))) {
            finalContentStr = '[유상] Particle Filter';
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
                let fullContent = val;
                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) { code = match.code || ''; }

                if (keywordPart && !fullContent.startsWith(keywordPart)) {
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

            let existingItem = sameDayItems.find(m => m.id == item.id) || sameDayItems[0];
            if (!existingItem) {
                existingItem = data.maint.find(m => m.id == item.id || (
                    m.type === item.type &&
                    (m.detailType || '') === (item.detailType || '') &&
                    m.originalLogId == item.originalLogId &&
                    (!m.scheduledDate || m.scheduledDate === targetDate)
                ));
            }

            if (existingItem) {
                const oldDate = existingItem.scheduledDate;
                existingItem.type = newType;
                existingItem.detailType = newDetailType;
                existingItem.detailType2 = newDetailType2;
                existingItem.detailType3 = newDetailType3;
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
                    detailType2: newDetailType2,
                    detailType3: newDetailType3,
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
            if (dropdownWrapper) {
                let finalContent = '';
                finalContentStr = finalContent;

                let existing = sameDayItems.find(m => m.id == item.id || m.content === finalContent);
                if (!existing) {
                    existing = data.maint.find(m => m.id == item.id || (
                        m.type === newType &&
                        (m.detailType || '') === newDetailType &&
                        m.originalLogId == item.originalLogId &&
                        m.content === finalContent &&
                        (!m.scheduledDate || m.scheduledDate === targetDate)
                    ));
                }

                if (existing) {
                    const oldDate = existing.scheduledDate;
                    existing.scheduledDate = targetDate;
                    existing.type = newType;
                    existing.detailType = newDetailType;
                    existing.detailType2 = newDetailType2;
                    existing.detailType3 = newDetailType3;
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
                    const newItem = { id: newId, type: newType, detailType: newDetailType, detailType2: newDetailType2, detailType3: newDetailType3, code: '', content: finalContent, date: "", scheduledDate: targetDate, worker: newWorker, memo: newMemo, md: newMd, itemCost: '', costType: newCostType, originalLogId: item.originalLogId };
                    data.maint.push(newItem);
                    remainingIds.push(newId);
                    payload.maint_upserts.push(newItem);
                }
            } else {
                let finalContent = document.getElementById('detail-content-input').value.trim();
                if (!finalContent) finalContent = '';
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

                let existing = sameDayItems.find(m => m.id == item.id || ((m.content === finalContent || (m.code && code && m.code === code)) && (m.spec || '') === spec));
                if (!existing) {
                    existing = data.maint.find(m => m.id == item.id || (
                        m.type === newType &&
                        (m.detailType || '') === newDetailType &&
                        m.originalLogId == item.originalLogId &&
                        (m.content === finalContent || (m.code && code && m.code === code)) &&
                        (m.spec || '') === spec &&
                        (!m.scheduledDate || m.scheduledDate === targetDate)
                    ));
                }

                if (existing) {
                    const oldDate = existing.scheduledDate;
                    existing.scheduledDate = targetDate;
                    existing.type = newType;
                    existing.detailType = newDetailType;
                    existing.detailType2 = newDetailType2;
                    existing.detailType3 = newDetailType3;
                    existing.worker = newWorker;
                    existing.memo = newMemo;
                    existing.md = newMd;
                    existing.costType = newCostType;
                    existing.content = finalContent;
                    existing.code = code;
                    existing.spec = spec;
                    remainingIds.push(existing.id);
                    payload.maint_upserts.push(existing);
                    generateDateChangeLog(existing, oldDate, 0);
                } else {
                    const newId = Date.now() + Math.floor(Math.random() * 10000);
                    const newItem = { id: newId, type: newType, detailType: newDetailType, detailType2: newDetailType2, detailType3: newDetailType3, code: '', content: finalContent, date: "", scheduledDate: targetDate, worker: newWorker, memo: newMemo, md: newMd, costType: newCostType, originalLogId: item.originalLogId };
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
                m.date = ""; // 완료일도 함께 초기화하여 유령 표출 방지

                if (!targetDate) {
                    // 일정을 완전 삭제(빈 날짜 지정)하는 경우 maint 목록 및 DB에서 완전 제거
                    data.maint = (data.maint || []).filter(item => item.id != m.id);
                    if (!payload.maint_deletes) payload.maint_deletes = [];
                    if (!payload.maint_deletes.includes(m.id)) payload.maint_deletes.push(m.id);
                }

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
                        detailType3: '',
                        content: `[변경] ${m.content}`,
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
    if (window.allEquipDetails) {
        window.allEquipDetails[key] = data;
    }
    try {
        let allDataCache = JSON.parse(localStorage.getItem('all_equip_data')) || {};
        allDataCache[key] = data;
        localStorage.setItem('all_equip_data', JSON.stringify(allDataCache));
    } catch (e) {}

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
    if (!savedContentStr) savedContentStr = '';

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
    if (window.isCompletingWork) return;
    window.isCompletingWork = true;

    const completeBtn = document.getElementById('btn-complete-work');
    if (completeBtn) {
        completeBtn.disabled = true;
        completeBtn.style.pointerEvents = 'none';
        completeBtn.style.opacity = '0.5';
    }

    const resetCompleteState = () => {
        window.isCompletingWork = false;
        if (completeBtn) {
            completeBtn.disabled = false;
            completeBtn.style.pointerEvents = '';
            completeBtn.style.opacity = '';
        }
    };

    try {
        const { site, equip, id } = currentDetailTarget;
        const key = `details_${site}_${equip}`;
        let data = JSON.parse(localStorage.getItem(key)) || {};

        const maintItem = data.maint ? data.maint.find(i => i.id == id) : null;
        if (!maintItem) return;

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    const typeSelect = document.getElementById('detail-type-select');
    const detailTypeSelect = document.getElementById('detail-detail-type-select');
    const detailType2Select = document.getElementById('detail-detail-type2-select');
    const detailType3Select = document.getElementById('detail-detail-type3-select');

    let taskType = typeSelect && typeSelect.style.display !== 'none' ? typeSelect.value : (maintItem.type || '정기');

    let currentDetailType = maintItem.detailType || '';
    if (detailTypeSelect && detailTypeSelect.style.display !== 'none' && detailTypeSelect.value) {
        currentDetailType = detailTypeSelect.value;
        if (taskType === '비정기') {
            if (detailType2Select && detailType2Select.style.display !== 'none' && detailType2Select.value) {
                currentDetailType += ` > ${detailType2Select.value}`;
            }
            if (detailType3Select && detailType3Select.style.display !== 'none' && detailType3Select.value) {
                currentDetailType += ` > ${detailType3Select.value}`;
            }
        }
    }

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
    // [개선] 화면에서 사용자가 실시간으로 수정한 최신 선택 내용 및 비용처리를 직접 긁어와 완료 로그 내용 구성

    const contentArr = [];
    let baseVals = [];
    const dWrapper = document.getElementById('detail-content-dropdown-wrapper');
    let partContentList = [];
    if (dWrapper) {
        const selected = dWrapper.querySelectorAll('.log-select-item.selected');
        baseVals = Array.from(selected).map(el => {
            const cSel = el.querySelector('.item-cost-select');
            return cSel ? `[${cSel.value}] ${el.dataset.value}` : el.dataset.value;
        });

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
    }

    const detailType3Val = (currentDetailType.includes(' > ') && currentDetailType.split(' > ').length >= 3)
        ? currentDetailType.split(' > ')[2].trim()
        : (detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '');

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

        // [추가] partContentList에 세부 물품이 선택되어 있는 경우, 이미 포함된 물품(cleanVal)이 단독/미상세로 중복 추가되는 것 차단
        if (partContentList.length > 0 && isRegisteredPart) {
            const isCovered = partContentList.some(p => {
                let cleanP = window.removeCostLabels(p);
                const pSpecMatch = cleanP.match(/\s*\[(.*?)\]$/);
                if (pSpecMatch) cleanP = cleanP.replace(pSpecMatch[0], '').trim();
                return cleanP === cleanVal || cleanP === val;
            });
            if (isCovered) return;
        }

        const isPartMode = maintItem.detailType === 'PM 점검' || maintItem.detailType === 'Parts 교체' || maintItem.detailType === '설비 정상화' ||
            ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3Val);

        if (taskType !== '정기' && !isPartMode && (isRegisteredPart || isSpecOnly)) return;

        const isPartKeyword = val.match(/파트 이상\s*\(?(교체|수리)\)?/) || val.includes('용액 용자 이상') || val.includes('용액 / 용자 이상');
        if (isPartKeyword && partContentList.length > 0) {
            partContentList.forEach(p => {
                let baseCost = '유상';
                const bMatch = p.match(/^\[(.*?)\] (.*)$/);
                if (bMatch) { baseCost = bMatch[1]; p = bMatch[2]; }
                if (taskType === '정기') {
                    contentArr.push(`[${baseCost}] ${p}`);
                } else {
                    contentArr.push(`${val} - [${baseCost}] ${p}`);
                }
            });
        } else if (isPartKeyword) {
            contentArr.push(val);
        } else if (isRegisteredPart) {
            contentArr.push(`[${baseCost}] ${val}`);
        } else {
            const cleanV = window.removeCostLabels(val).trim();
            if (cleanV && cleanV !== '내용 없음') {
                contentArr.push(cleanV);
            }
        }
    });

    if (partContentList.length > 0 && contentArr.length === 0) {
        partContentList.forEach(p => {
            let baseCost = '유상';
            const bMatch = p.match(/^\[(.*?)\] (.*)$/);
            if (bMatch) { baseCost = bMatch[1]; p = bMatch[2]; }
            contentArr.push(`[${baseCost}] ${p}`);
        });
    }

    if (!dWrapper || baseVals.length === 0) {
        let inputVal = document.getElementById('detail-content-input').value.trim();
        if (inputVal) {
            inputVal = window.removeCostLabels(inputVal);
            contentArr.push(inputVal);
        }
    }

    const combinedContent = [...new Set(contentArr)].join(', ');

    const checkKeywords = ['PM 점검', 'BM 점검', '파트 이상 교체', '파트 이상 수리', '물품 이상 교체', '물품 이상 수리', '용액 용자 이상', '파츠 이상 교체', '파츠 이상 수리', '장비 점검', '추가 작업'];


    const cleanContentArr = window.splitSafetyContent(combinedContent)
        .map(s => s.trim())
        .filter(s => {
            if (!s || s === '내용 없음' || s === '장비 점검') return false;
            if (taskType === '비정기' && detailType3Val && s === detailType3Val) return false;
            return true;
        });

    let finalCleanContent = cleanContentArr.length > 0 ? [...new Set(cleanContentArr)].join(', ') : '';

    // [요청 반영] 고객대응 > 파티클 필터 교체 고정 규칙
    if (taskType === '고객대응' && (maintItem.detailType === '파티클 필터 교체' || (maintItem.detailType || '').startsWith('파티클 필터 교체'))) {
        finalCleanContent = '[유상] Particle Filter';
    } else if (!finalCleanContent || finalCleanContent.replace(/^\[.*?\]\s*/, '').trim() === '내용 없음' || finalCleanContent === '장비 점검') {
        // [요청 반영] 작업 완료 처리 시 입력된 내용이나 물품이 등록되어 있지 않으면 비용처리 라벨 없이 '내용 없음'으로 기록
        finalCleanContent = '내용 없음';
    }

    if (taskType !== '정기') {
        if (!memo) return alert('점검 결과 / 메모를 입력해주세요.');
    }

    const workerCount = worker.split(',').map(s => s.trim()).filter(Boolean).length;
    if (parseFloat(md) > workerCount) {
        alert(`입력된 공수(${md})가 등록된 작업자 수(${workerCount}명)를 초과할 수 없습니다.`);
        if (mdInput) mdInput.value = workerCount;
        return;
    }

    localStorage.setItem('lastWorkerName', worker);

    const originalMaintMap = new Map((data.maint || []).map(m => [m.id, { ...m }]));

    if (!data.logs) data.logs = [];

    const inputDateVal = document.getElementById('detail-scheduled-date') ? document.getElementById('detail-scheduled-date').value : '';
    const completeDate = inputDateVal || maintItem.scheduledDate || new Date().toISOString().split('T')[0];

    let payload = { log_upserts: [], maint_upserts: [], maint_deletes: [] };


    let finalMemo = memo.replace(/\n?\[추가 파트\].*$/m, '').trim();

    const logIdToUse = Date.now() + Math.floor(Math.random() * 10000);
    const newLog = {
        id: logIdToUse,
        originalLogId: maintItem.originalLogId || null,
        date: completeDate,
        scheduledDate: completeDate,
        type: taskType || maintItem.type || '정기',
        detailType: currentDetailType || maintItem.detailType || '',
        detailType2: '',
        content: finalCleanContent,
        costType: costType,
        md: md,
        worker: worker,
        memo: finalMemo,
        isIssueShared: isIssueShared,
        startTime: startTime,
        endTime: endTime
    };

    if (maintItem.originalLogId) {
        const originalLog = data.logs.find(l => l.id == maintItem.originalLogId);
        if (originalLog) {
            newLog.isIssueShared = !!originalLog.isIssueShared;
            originalLog.addWorkLogId = newLog.id;
            payload.log_upserts.push(originalLog);
        }
    }

    data.logs.push(newLog);
    payload.log_upserts.push(newLog);

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

    // 예정 목록(data.maint)에서 완료된 항목 제거 (단일 maint_log 이력으로 전환, 추가 행 생성 전면 차단)
    const sameDayIds = new Set(sameDayItems.map(i => i.id.toString()));
    sameDayItems.forEach(i => {
        if (i.id && !payload.maint_deletes.includes(i.id)) payload.maint_deletes.push(i.id);
    });
    if (maintItem.id && !payload.maint_deletes.includes(maintItem.id)) {
        payload.maint_deletes.push(maintItem.id);
    }

    // [추가] 물품 상세(spec)가 포함된 물품이 완료 등록되는 경우, 동일 물품명/코드의 상세 없는 잔재 maint 항목 완전 제거
    if (finalCleanContent) {
        const partsList = window.splitSafetyContent(finalCleanContent);
        partsList.forEach(p => {
            const ext = typeof window.extractSpecFromContent === 'function' ? window.extractSpecFromContent(p) : { spec: '', pureContent: p };
            if (ext.spec) {
                const pureCodeName = ext.pureContent.replace(/^\[.*?\]\s*/, '').trim();
                (data.maint || []).forEach(m => {
                    const mCode = (m.code || m.content || '').replace(/^\[.*?\]\s*/, '').trim();
                    if (mCode === pureCodeName && !m.spec && m.id) {
                        if (!payload.maint_deletes.includes(m.id)) payload.maint_deletes.push(m.id);
                    }
                });
            }
        });
    }

    data.maint = (data.maint || []).filter(i => {
        if (sameDayIds.has(i.id.toString()) || i.id == maintItem.id) return false;
        if (finalCleanContent) {
            const partsList = window.splitSafetyContent(finalCleanContent);
            for (const p of partsList) {
                const ext = typeof window.extractSpecFromContent === 'function' ? window.extractSpecFromContent(p) : { spec: '', pureContent: p };
                if (ext.spec) {
                    const pureCodeName = ext.pureContent.replace(/^\[.*?\]\s*/, '').trim();
                    const mCode = (i.code || i.content || '').replace(/^\[.*?\]\s*/, '').trim();
                    if (mCode === pureCodeName && !i.spec) return false;
                }
            }
        }
        return true;
    });

    // [추가] 완료 처리된 물품이 item_log 및 MAINT 메뉴(해당 장비 유지관리 물품)에 동시 자동 반영되도록 data.maint 업데이트
    if (finalCleanContent && finalCleanContent !== '내용 없음') {
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
        const partsList = window.splitSafetyContent(finalCleanContent);
        partsList.forEach(p => {
            const ext = typeof window.extractSpecFromContent === 'function' ? window.extractSpecFromContent(p) : { spec: '', pureContent: p };
            let pureName = (p || '').toString().trim();

            const prefixes = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상', '물품 이상 교체', '물품 이상 수리', '파츠 이상 교체', '파츠 이상 수리'];
            for (const kw of prefixes) {
                if (pureName.startsWith(kw + ' -')) { pureName = pureName.substring(kw.length + 2).trim(); break; }
                if (pureName.startsWith(kw + '-')) { pureName = pureName.substring(kw.length + 1).trim(); break; }
                if (pureName.startsWith(kw)) { pureName = pureName.substring(kw.length).trim(); break; }
            }
            pureName = pureName.replace(/^\[(?:유상|무상|기타)\]-?\s*/, '').trim();
            pureName = pureName.replace(/\[(?:유상|무상|기타)\]/g, '').trim();
            
            const specMatch = pureName.match(/\s*\[(.*?)\]$/);
            let spec = ext.spec || '';
            if (specMatch) {
                if (!spec) spec = specMatch[1].trim();
                pureName = pureName.substring(0, specMatch.index).trim();
            }

            if (!pureName || ['내용 없음', '장비 점검'].includes(pureName)) return;

            const matchAdmin = adminItems.find(ai => (ai.code && ai.code.trim() === pureName) || (ai.part && ai.part.trim() === pureName));
            // [요청 반영] 물품 선택 드롭다운에서 선택되었거나 AdminItem 마스터에 등록된 실제 물품만 MAINT 유지관리 물품으로 등록/인식
            // 텍스트로 직접 입력한 일반 작업 내용(matchAdmin 없음)은 물품이 아니므로 data.maint 신규 등록/생성에서 완전 제외 (작업 기록(로그)으로만 보존)
            if (!matchAdmin) return;

            const codeVal = matchAdmin.code || pureName;

            let existingItem = (data.maint || []).find(m =>
                (m.code === codeVal || m.content === codeVal || m.code === pureName || m.content === pureName) &&
                (m.spec || m.part_detail || '').trim() === (spec || '').trim()
            );
            if (existingItem) {
                existingItem.date = completeDate;
                if (spec) existingItem.spec = spec;
                existingItem.scheduledDate = '';
                if (!payload.maint_upserts.some(item => item.id == existingItem.id)) {
                    payload.maint_upserts.push(existingItem);
                }
            } else {
                const newMaintItem = {
                    id: `item_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                    type: '',
                    detailType: 'Parts 교체',
                    detailType2: '',
                    detailType3: '',
                    code: codeVal,
                    content: codeVal,
                    spec: spec,
                    date: completeDate,
                    scheduledDate: '',
                    period: matchAdmin ? (matchAdmin.cycle || '') : '',
                    costType: '유상',
                    worker: '',
                    md: '0',
                    itemCost: '',
                    memo: '',
                    sortOrder: 999,
                    originalLogId: null
                };
                data.maint.push(newMaintItem);
                if (!payload.maint_upserts.some(item => item.id == newMaintItem.id)) {
                    payload.maint_upserts.push(newMaintItem);
                }
            }
        });
    }

    const success = await window.syncHistoryTransaction(site, equip, payload);
    if (!success) {
        alert('서버 통신 오류로 작업 완료 처리에 실패했습니다.');
        location.reload();
        return;
    }

    localStorage.setItem(key, JSON.stringify(data));

    // [핵심 해결] HOME 화면 유령 예정 항목 잔재 방지: 전역 캐시 및 all_equip_data 즉시 동기화
    if (window.allEquipDetails) {
        window.allEquipDetails[key] = data;
    }
    try {
        let allDataCache = JSON.parse(localStorage.getItem('all_equip_data')) || {};
        allDataCache[key] = data;
        localStorage.setItem('all_equip_data', JSON.stringify(allDataCache));
    } catch (e) {}

    if (typeof addSystemLog === 'function') {
        addSystemLog('COMPLETE_SCHEDULE', equip, `작업일: ${completeDate}, 구분: ${taskType}\n세부구분: ${currentDetailType}`);
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

        // [비활성화] 사용자 요청으로 정기 작업 완료 시 '다음 작업 예정일 등록 팝업창' 노출 안 함 (일단 비활성화)
        alert('작업이 완료되었습니다.');
        if (typeof window.refreshCalendarPopupAfterCompletion === 'function') window.refreshCalendarPopupAfterCompletion();
        if (typeof window.restoreTaskSearchModal === 'function') window.restoreTaskSearchModal();
    }
} catch (err) {
    console.error('Work Completion Error:', err);
    alert('작업 완료 처리 중 오류가 발생했습니다: ' + err.message);
} finally {
    resetCompleteState();
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

window.revertCompletedMaintenanceItem = async function (site, equip, id) {
    if (typeof window.checkSessionValid === 'function' && !window.checkSessionValid()) return;

    const key = `details_${site}_${equip}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    if (!data.logs) data.logs = [];
    if (!data.maint) data.maint = [];

    const logIndex = data.logs.findIndex(l => l.id == id);
    let targetItem = null;
    if (logIndex !== -1) {
        targetItem = data.logs[logIndex];
        data.logs.splice(logIndex, 1);
    } else {
        targetItem = data.maint.find(m => m.id == id);
    }

    if (!targetItem) {
        alert('취소할 작업 항목을 찾을 수 없습니다.');
        return;
    }

    const childLogsCount = data.logs.filter(l => l.originalLogId && l.originalLogId.toString() === id.toString()).length;
    const childMaintsCount = data.maint.filter(m => m.originalLogId && m.originalLogId.toString() === id.toString()).length;
    const totalChildren = childLogsCount + childMaintsCount;

    if (totalChildren > 0) {
        const confirmMsg = `이 작업에 연동된 추가작업(${totalChildren}건)이 존재합니다.\n작업 완료를 취소하고 예정 상태로 전환하시겠습니까?`;
        if (!confirm(confirmMsg)) return;
    } else {
        if (!confirm('작업 완료를 취소하고 예정 상태로 되돌리시겠습니까?')) return;
    }

    targetItem.status = '작업예정';
    targetItem.scheduledDate = targetItem.scheduledDate || targetItem.date || '';
    targetItem.date = '';

    // [요청 반영] 작업 완료 취소 시 기존에 입력된 내용/물품이 있었으면 그대로 유지하고, '내용 없음'이었던 경우만 빈칸('')으로 초기화 (파티클 필터 교체 건 예외 유지)
    if (targetItem.type === '고객대응' && (targetItem.detailType === '파티클 필터 교체' || (targetItem.detailType || '').startsWith('파티클 필터 교체'))) {
        targetItem.content = '[유상] Particle Filter';
    } else if (targetItem.content === '내용 없음') {
        targetItem.content = '';
    } else {
        targetItem.content = targetItem.content || '';
    }

    // maint 목록에 중복 없이 단 1개의 묶음 항목으로 유지 및 추가
    data.maint = (data.maint || []).filter(m => m.id != targetItem.id);
    data.maint.push(targetItem);

    const payload = { maint_upserts: [targetItem], log_deletes: [targetItem.id] };

    const success = await window.syncHistoryTransaction(site, equip, payload);
    if (!success) {
        alert('서버 통신 오류로 작업 완료 취소에 실패했습니다.');
        location.reload();
        return;
    }

    localStorage.setItem(key, JSON.stringify(data));
    if (window.allEquipDetails) {
        window.allEquipDetails[key] = data;
    }
    try {
        let allDataCache = JSON.parse(localStorage.getItem('all_equip_data')) || {};
        allDataCache[key] = data;
        localStorage.setItem('all_equip_data', JSON.stringify(allDataCache));
    } catch (e) {}

    if (typeof addSystemLog === 'function') {
        addSystemLog('CANCEL_COMPLETION', equip, `작업 완료 취소 -> 작업예정으로 전환 (ID: ${id})`);
    }

    alert('작업 완료가 취소되었습니다. 입력된 모든 내용과 메모는 보존된 채 작업 예정 상태로 전환되었습니다.');

    if (typeof window.refreshCalendarPopupAfterCompletion === 'function') {
        window.refreshCalendarPopupAfterCompletion();
    } else {
        if (typeof window.renderCalendar === 'function') window.renderCalendar();
        if (typeof updateMaintenanceDashboard === 'function') updateMaintenanceDashboard();
        if (typeof renderDetails === 'function') renderDetails();
        if (typeof renderLogs === 'function') renderLogs();
    }

    if (typeof window.openEventDetailModal === 'function') {
        window.openEventDetailModal(site, equip, targetItem.id, false);
    }
};

function cancelScheduleCompletion() {
    if (!currentDetailTarget || !currentDetailTarget.site || !currentDetailTarget.equip || !currentDetailTarget.id) return;
    window.revertCompletedMaintenanceItem(currentDetailTarget.site, currentDetailTarget.equip, currentDetailTarget.id);
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

            if (trigger) {
                trigger.onclick = (e) => {
                    e.stopPropagation();
                    if (trigger.classList.contains('disabled')) return;
                    document.querySelectorAll('.log-select-dropdown.show').forEach(d => { if (d !== dropdown) d.classList.remove('show'); });
                    if (dropdown) dropdown.classList.toggle('show');
                    if (dropdown && dropdown.classList.contains('show') && window.renderEquipSuggestions && searchInput) {
                        window.renderEquipSuggestions(searchInput.value.trim());
                        searchInput.focus();
                    }
                };
            }
            if (searchInput) {
                searchInput.onclick = (e) => e.stopPropagation();
                searchInput.oninput = (e) => {
                    if (window.renderEquipSuggestions) window.renderEquipSuggestions(e.target.value.trim());
                };
            }
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
    const isAddWork = !!window.currentAddWorkLogId;
    const modalTitle = modal.querySelector('.modal-header h3');
    if (modalTitle) {
        if (isAddWork) {
            modalTitle.textContent = '추가 작업 등록';
        } else {
            modalTitle.textContent = '작업 등록';
        }
    }

    // [추가] 날짜 기준 다음날 YYYY-MM-DD 반환 헬퍼 함수
    if (!window.getNextDayStr) {
        window.getNextDayStr = function (baseDateStr) {
            if (!baseDateStr) return '';
            const parts = baseDateStr.split('-');
            if (parts.length === 3) {
                const year = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const day = parseInt(parts[2], 10);
                const d = new Date(year, month, day + 1);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const da = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${da}`;
            }
            return baseDateStr;
        };
    }

    if (dateDisplay) {
        if (isAddWork && dateStr) {
            const nextDayStr = window.getNextDayStr ? window.getNextDayStr(dateStr) : dateStr;
            dateDisplay.min = nextDayStr || dateStr; // [요청 반영] 최초 작업일의 하루 다음날부터만 달력 선택 가능 (최초 작업일 및 이전 날짜 비활성화)
            dateDisplay.value = ''; // [요청 반영] 추가 작업 등록 모달 렌더링 시 작업일 빈값(미입력) 표시
        } else {
            dateDisplay.removeAttribute('min');
            dateDisplay.value = dateStr || '';
        }
    }

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

                    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
                    const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
                    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;

                    let displayValue = displayName;
                    if (custName) {
                        displayValue = `${displayName} [${custName}]`;
                    } else if (serial) {
                        displayValue = `${displayName} [${serial}]`;
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
        const rDetailType3Select = document.getElementById('register-detail-type3-select');

        if (rTypeSelect && presetData.type) {
            rTypeSelect.value = presetData.type; // [수정] presetData.type으로 초기화
            rTypeSelect.dispatchEvent(new Event('change'));
        }

        setTimeout(() => {
            let targetDetailType = presetData.detailType || '';
            let targetDetailType2 = presetData.detailType2 || '';
            let targetDetailType3 = presetData.detailType3 || '';

            // [추가] 괄호 [ ] 또는 부등호 > 가 포함된 경우 파싱하여 3단계 세부구분까지 분리
            if (targetDetailType.includes(' > ')) {
                const parts = targetDetailType.split(' > ');
                targetDetailType = parts[0].trim();
                if (parts.length > 1 && !targetDetailType2) targetDetailType2 = parts[1].trim();
                if (parts.length > 2 && !targetDetailType3) targetDetailType3 = parts[2].trim();
            } else if (targetDetailType.includes('[')) {
                const parts = targetDetailType.split('[');
                targetDetailType = parts[0].trim();
                if (!targetDetailType2) targetDetailType2 = parts[1].replace(']', '').trim();
            }

            if (targetDetailType2.includes(' > ')) {
                const parts = targetDetailType2.split(' > ');
                if (!targetDetailType || targetDetailType === targetDetailType2) targetDetailType = parts[0].trim();
                targetDetailType2 = parts[0].trim();
                if (parts.length > 1 && !targetDetailType3) targetDetailType3 = parts[1].trim();
            } else if (targetDetailType2.includes('[')) {
                const parts = targetDetailType2.split('[');
                if (!targetDetailType || targetDetailType === targetDetailType2) targetDetailType = parts[0].trim();
                targetDetailType2 = parts[1].replace(']', '').trim();
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

                setTimeout(() => {
                    if (rDetailType3Select && targetDetailType3) {
                        let hasOption3 = Array.from(rDetailType3Select.options).some(opt => opt.value === targetDetailType3);
                        if (!hasOption3) {
                            const opt = document.createElement('option');
                            opt.value = targetDetailType3;
                            opt.textContent = targetDetailType3;
                            rDetailType3Select.appendChild(opt);
                        }
                        rDetailType3Select.value = targetDetailType3;
                        rDetailType3Select.dispatchEvent(new Event('change'));
                    }
                }, 50);

                const partRow = document.getElementById('register-part-row');
                if (partRow) {
                    // [수정] 작업 등록 시에는 하위 세부 내용 물품 선택창을 원천 비활성화 (항상 숨김)
                    partRow.style.display = 'none';
                }

                // [요청 반영] 추가 작업 등록 시 사업장, 장비, 구분, 세부구분, 세부구분2 비활성화 및 세부구분 3 편집 가능 설정
                if (isAddWork) {
                    const rTypeSelect = document.getElementById('register-type-select');
                    const rDetailTypeSelect = document.getElementById('register-detail-type-select');
                    const rDetailType2Select = document.getElementById('register-detail-type2-select');
                    const rDetailType3Select = document.getElementById('register-detail-type3-select');
                    const equipTrigger = document.getElementById('register-equip-trigger');

                    if (siteSelect) siteSelect.disabled = true;
                    if (equipSelect) equipSelect.disabled = true;
                    if (equipTrigger) {
                        equipTrigger.style.pointerEvents = 'none';
                        equipTrigger.style.opacity = '0.7';
                    }
                    if (rTypeSelect) rTypeSelect.disabled = true;
                    if (rDetailTypeSelect) rDetailTypeSelect.disabled = true;
                    if (rDetailType2Select) rDetailType2Select.disabled = true;

                    if (rDetailType3Select) {
                        rDetailType3Select.disabled = false;
                        if (targetDetailType3) {
                            let hasOption3 = Array.from(rDetailType3Select.options).some(opt => opt.value === targetDetailType3);
                            if (!hasOption3) {
                                const opt = document.createElement('option');
                                opt.value = targetDetailType3;
                                opt.textContent = targetDetailType3;
                                rDetailType3Select.appendChild(opt);
                            }
                            rDetailType3Select.value = targetDetailType3;
                        }
                    }
                }
            }, 100);
        }, 100);
    } else {
        // presetData가 없더라도 추가 작업 등록 모드일 때 비활성화 및 초기화
        if (isAddWork) {
            const rTypeSelect = document.getElementById('register-type-select');
            const rDetailTypeSelect = document.getElementById('register-detail-type-select');
            const rDetailType2Select = document.getElementById('register-detail-type2-select');
            const rDetailType3Select = document.getElementById('register-detail-type3-select');
            const equipTrigger = document.getElementById('register-equip-trigger');

            if (siteSelect) siteSelect.disabled = true;
            if (equipSelect) equipSelect.disabled = true;
            if (equipTrigger) {
                equipTrigger.style.pointerEvents = 'none';
                equipTrigger.style.opacity = '0.7';
            }
            if (rTypeSelect) rTypeSelect.disabled = true;
            if (rDetailTypeSelect) rDetailTypeSelect.disabled = true;
            if (rDetailType2Select) rDetailType2Select.disabled = true;

            if (rDetailType3Select) {
                rDetailType3Select.disabled = false;
            }
        }
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

        const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
        const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
        const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;

        let displayValue = displayName;
        if (custName) {
            displayValue = `${displayName} [${custName}]`;
        } else if (serial) {
            displayValue = `${displayName} [${serial}]`;
        }
        option.textContent = displayValue;
        equipSelect.appendChild(option);
    });

    equipSelect.disabled = false;

    if (equipSuggestionList) {
        window.renderEquipSuggestions = (searchTerm = '') => {
            equipSuggestionList.innerHTML = '';
            const keywords = searchTerm.toLowerCase().split(/\s+/);
            const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

            let matches = equips.filter(equip => {
                const parts = equip.split('::');
                const name = parts[0] || '';
                const serial = parts.length > 1 ? parts[1] : '';
                const custNameFromKey = parts.length > 2 ? parts[2] : '';
                const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
                const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;

                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custName = custNameFromKey || ((detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '');

                const text = `${name} ${displayName} ${serial} ${custName}`.toLowerCase();
                return keywords.every(kw => text.includes(kw));
            });

            if (matches.length > 0) {
                matches.forEach(equip => {
                    const parts = equip.split('::');
                    const name = parts[0] || '';
                    const serial = parts.length > 1 ? parts[1] : '';
                    const matchedModel = equipmentModels.find(m => m.name === name || m.abbr === name);
                    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : name;

                    const key = `details_${site}_${equip}`;
                    const detailData = JSON.parse(localStorage.getItem(key)) || {};
                    const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

                    const tpl = getTemplateContent('equip-suggestion-item-template');
                    if (tpl) {
                        const li = tpl.querySelector('.log-select-item');

                        let displayValueHtml = escapeHtml(displayName);
                        if (custName) {
                            displayValueHtml += ` <span style="color:#3fb950;">[${escapeHtml(custName)}]</span>`;
                        } else if (serial) {
                            displayValueHtml += ` <span style="color:#3fb950;">[${escapeHtml(serial)}]</span>`;
                        }

                        // 기존 템플릿의 분리된 구조를 무시하고 자연스럽게 한 줄에 표시
                        const contentDiv = li.querySelector('.suggestion-item-content') || li;
                        contentDiv.innerHTML = `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayValueHtml}</span>`;

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
                            e.preventDefault();
                            e.stopPropagation();
                            equipSelect.value = equip;

                            let displayValue = displayName;
                            if (custName) {
                                displayValue = `${displayName} [${custName}]`;
                            } else if (serial) {
                                displayValue = `${displayName} [${serial}]`;
                            }
                            equipTrigger.textContent = displayValue;
                            equipTrigger.title = displayValue;
                            equipTrigger.classList.remove('error-border');
                            equipTrigger.classList.add('has-value');

                            equipSuggestionList.style.display = 'none';
                            if (equipDropdown) equipDropdown.classList.remove('show');
                            if (typeof updateRegisterTypeOptions === 'function') updateRegisterTypeOptions();
                            if (typeof window.updateRegisterInputStates === 'function') window.updateRegisterInputStates();
                        };

                        li.addEventListener('touchend', (e) => {
                            if (isMoving) return;
                            handleSelect(e);
                        });

                        li.addEventListener('mousedown', (e) => {
                            if (window.lastTouchTime && Date.now() - window.lastTouchTime < 600) return;
                            handleSelect(e);
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

    const rDetailType3Select = document.getElementById('register-detail-type3-select');

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
        if (rDetailType3Select) {
            rDetailType3Select.style.display = 'none';
            rDetailType3Select.value = '';
        }
        updateRegisterContentOptions();
        return;
    }

    rDetailTypeSelect.disabled = false;

    if (rDetailType2Select) {
        if (type === '비정기') {
            rDetailType2Select.style.display = 'inline-block';
            if (rDetailType3Select) rDetailType3Select.style.display = 'inline-block';
            if (rDetailType2Row) rDetailType2Row.style.display = 'none';
        } else {
            rDetailType2Select.style.display = 'none';
            rDetailType2Select.value = '';
            if (rDetailType2Row) rDetailType2Row.style.display = 'none';
            if (rDetailType3Select) {
                rDetailType3Select.style.display = 'none';
                rDetailType3Select.value = '';
            }
        }
    }

    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    const defaultSubCategories = {
        '정기': ['PM 점검'],
        '비정기': ['BM 점검', 'Alarm', 'Hunting', 'Data / Para 이상', '기타'],
        '고객대응': ['순회 점검', '프로그램 변경 / 평가', '설비 평가', '파티클 필터 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '기타'],
        '용액제조': ['용액제조'],
        '온라인점검': ['온라인점검']
    };

    let subCategories = (catData[type] && catData[type].length > 0) ? catData[type] : (catData[`COMMON::${type}`] || defaultSubCategories[type] || []);

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
    rDetailTypeSelect.onchange = updateRegisterDetailType2Options;
    if (rDetailType2Select) rDetailType2Select.onchange = updateRegisterDetailType3Options;
    if (rDetailType3Select) rDetailType3Select.onchange = updateRegisterContentOptions;

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
    const catData = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
    const defaultSubCategories2 = {
        'Alarm': ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람'],
        'Hunting': ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅'],
        'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈'],
        '기타': ['배수 펌프 이슈', '구동 이상']
    };

    let subCategories2 = (catData[detailType] && catData[detailType].length > 0) ? catData[detailType] : (catData[`COMMON::${type}::${detailType}`] || defaultSubCategories2[detailType] || []);

    if (subCategories2.length === 0) {
        rDetailType2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 없음</option>';
        rDetailType2Select.disabled = true;
    } else if (subCategories2.length === 1) {
        rDetailType2Select.innerHTML = `<option value="${subCategories2[0]}" selected>${subCategories2[0]}</option>`;
    } else {
        rDetailType2Select.innerHTML = '<option value="" disabled selected hidden>세부 구분</option>';
        subCategories2.forEach(sub => { rDetailType2Select.insertAdjacentHTML('beforeend', `<option value="${sub}">${sub}</option>`); });
    }
    updateRegisterDetailType3Options();
};

window.updateRegisterDetailType3Options = function () {
    const rEquipSelect = document.getElementById('register-equip-select');
    const rTypeSelect = document.getElementById('register-type-select');
    const rDetailTypeSelect = document.getElementById('register-detail-type-select');
    const rDetailType2Select = document.getElementById('register-detail-type2-select');
    const rDetailType3Select = document.getElementById('register-detail-type3-select');

    if (!rTypeSelect || !rDetailTypeSelect || !rDetailType2Select || !rDetailType3Select) return;
    const type = rTypeSelect.value;
    const detailType = rDetailTypeSelect.value;
    const detailType2 = rDetailType2Select.value;

    rDetailType3Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 3</option>';
    if (type !== '비정기') {
        rDetailType3Select.style.display = 'none';
        rDetailType3Select.disabled = true;
        updateRegisterContentOptions();
        return;
    }
    rDetailType3Select.style.display = 'inline-block';
    rDetailType3Select.disabled = false;
    const catData3 = JSON.parse(localStorage.getItem('check_type_categories3')) || {};
    const defaultSubCategories3 = [
        "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
        "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
    ];

    let subCategories3 = (catData3[detailType2] && catData3[detailType2].length > 0) ? catData3[detailType2] : (catData3['default'] || catData3[`COMMON::${type}::${detailType}::${detailType2}`] || defaultSubCategories3);

    if (subCategories3.length === 0) {
        rDetailType3Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 없음</option>';
        rDetailType3Select.disabled = true;
    } else if (subCategories3.length === 1) {
        rDetailType3Select.innerHTML = `<option value="${subCategories3[0]}" selected>${subCategories3[0]}</option>`;
    } else {
        rDetailType3Select.innerHTML = '<option value="" disabled selected hidden>세부 구분 3</option>';
        subCategories3.forEach(sub => { rDetailType3Select.insertAdjacentHTML('beforeend', `<option value="${sub}">${sub}</option>`); });
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

    const clearDropdownSelections = () => {
        list.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));
        trigger.textContent = '항목 선택';
        trigger.classList.remove('has-value');

        const partList = document.getElementById('register-part-list');
        if (partList) partList.querySelectorAll('.log-select-item.selected').forEach(el => el.classList.remove('selected'));
        const partTrigger = document.getElementById('register-part-trigger');
        if (partTrigger) {
            partTrigger.textContent = '물품 선택';
            partTrigger.classList.remove('has-value');
        }
    };

    const clearTextInput = () => {
        if (input && !input.disabled) {
            input.value = '';
            input.classList.remove('has-value');
        }
    };

    input.disabled = false; // 다른 세부구분 선택 시 비활성화 해제

    const type = rTypeSelect ? rTypeSelect.value : '';
    const detailType = rDetailTypeSelect ? rDetailTypeSelect.value : '';

    // [추가] 일정 등록 시 고객대응 > 파티클 필터 교체인 경우 내용 고정 및 비활성화
    if (type === '고객대응' && (detailType === '파티클 필터 교체' || detailType.startsWith('파티클 필터 교체'))) {
        clearDropdownSelections();
        wrapper.style.display = 'none';
        input.style.display = 'block';
        input.value = '[유상] Particle Filter';
        input.disabled = true;

        const partWrapper = document.getElementById('register-part-wrapper');
        if (partWrapper) partWrapper.style.display = 'none';
        return;
    }

    // [추가] 고객대응 구분에서 '설비 정상화'를 제외한 세부구분은 텍스트 직접 입력 모드로 설정 (물품 선택 및 텍스트 초기화)
    if (type === '고객대응' && detailType !== '설비 정상화' && !detailType.startsWith('설비 정상화')) {
        clearDropdownSelections();
        clearTextInput();
        wrapper.style.display = 'none';
        input.style.display = 'block';
        input.disabled = false;
        input.placeholder = '내용을 입력하세요';

        const partWrapper = document.getElementById('register-part-wrapper');
        if (partWrapper) partWrapper.style.display = 'none';
        return;
    }

    const equipKey = rEquipSelect ? rEquipSelect.value : '';
    const detailType2 = rDetailType2Select && rDetailType2Select.style.display !== 'none' ? rDetailType2Select.value : '';

    if (!type || (!detailType && !rDetailTypeSelect.disabled)) {
        clearDropdownSelections();
        clearTextInput();
        wrapper.style.display = 'none';
        input.style.display = 'block';
        input.placeholder = type ? '세부구분을 먼저 선택하세요' : '구분을 먼저 선택하세요';
        input.disabled = true;
        return;
    }

    const rDetailType3Select = document.getElementById('register-detail-type3-select');
    const detailType3 = rDetailType3Select && rDetailType3Select.style.display !== 'none' ? rDetailType3Select.value : '';

    let items = [];
    if (type === '비정기') {
        if (!detailType2 || !detailType3) {
            clearDropdownSelections();
            clearTextInput();
            wrapper.style.display = 'none';
            input.style.display = 'block';
            input.placeholder = '세부 구분을 먼저 선택하세요';
            input.disabled = true;
            return;
        }

        const isPartDropdownNeeded = ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3);
        if (!isPartDropdownNeeded) {
            clearDropdownSelections();
            clearTextInput();
            wrapper.style.display = 'none';
            input.style.display = 'block';
            input.disabled = false;
            input.placeholder = '내용을 입력하세요';
            return;
        } else {
            clearTextInput();
            clearDropdownSelections();
            wrapper.style.display = 'block';
            input.style.display = 'none';

            let equipParts = (equipKey || '').split('::').map(s => s.trim()).filter(Boolean);
            let equipName = equipParts.length > 1 ? equipParts[1] : (equipParts[0] || '');
            const matchedModel = (typeof equipmentModels !== 'undefined' ? equipmentModels : []).find(m => m.name === equipName || m.abbr === equipName);
            const targetEquipNames = [equipName];
            if (matchedModel) {
                if (matchedModel.name) targetEquipNames.push(matchedModel.name);
                if (matchedModel.abbr) targetEquipNames.push(matchedModel.abbr);
            }

            const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            let matchedItems = adminItems.filter(item => {
                if (!item.equip || !item.equip.trim()) return true;
                const equips = item.equip.split(',').map(e => e.trim());
                if (equips.includes('전장비') || equips.includes('전 장비') || equips.includes('전체')) return true;
                return targetEquipNames.some(tn => equips.includes(tn));
            });
            let otherItems = adminItems.filter(item => !matchedItems.includes(item));
            items = [...matchedItems, ...otherItems].map(mItem => ({ content: mItem.part, code: mItem.code }));
        }
    } else {
        // [수정] check_type_items 대신 admin_items 및 maint_log 이력 데이터 활용
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
        items = adminItems.map(mItem => ({ content: mItem.part, code: mItem.code }));
    }

    input.disabled = false;

    if (items.length === 0) {
        let equipParts = (equipKey || '').split('::').map(s => s.trim()).filter(Boolean);
        let equipName = equipParts.length > 1 ? equipParts[1] : (equipParts[0] || '');
        const matchedModel = (typeof equipmentModels !== 'undefined' ? equipmentModels : []).find(m => m.name === equipName || m.abbr === equipName);
        const targetEquipNames = [equipName];
        if (matchedModel) {
            if (matchedModel.name) targetEquipNames.push(matchedModel.name);
            if (matchedModel.abbr) targetEquipNames.push(matchedModel.abbr);
        }

        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
        let matchedItems = adminItems.filter(item => {
            if (!item.equip || !item.equip.trim()) return true;
            const equips = item.equip.split(',').map(e => e.trim());
            if (equips.includes('전장비') || equips.includes('전 장비') || equips.includes('전체')) return true;
            return targetEquipNames.some(tn => equips.includes(tn));
        });

        let otherItems = adminItems.filter(item => !matchedItems.includes(item));
        items = [...matchedItems, ...otherItems].map(mItem => ({ content: mItem.part, code: mItem.code }));
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
        clearTextInput();
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

        const isPartMode = detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(detailType3));

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

            if (isPartMode) {
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

                    const nonPartKeywords = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "프로그램 이상", "단순조치", "기타", "내용 없음"];
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

        if (isPartMode) {
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

        // 3. admin_items 처리 (PM, BM, Parts 교체 또는 비정기 파트 이상 교체/수리인 경우)
        if (isPartMode) {
            const allAdminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
            allAdminItems.forEach(a => {
                if (!a.part && !a.code) return;
                const baseName = a.code || a.part;
                let partno = a.partno || '';
                if (!poolMap.has(baseName)) {
                    poolMap.set(baseName, { content: a.part || a.code, code: a.code || '', partno: partno, spec: '', displayValue: baseName });
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

        let showAll = registeredItems.length === 0 || isPartMode;

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
                    const txt = `${item.displayValue || ''} ${item.content || ''} ${item.code || ''} ${item.partno || ''} ${item.spec || ''}`.toLowerCase();
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

                    const rDetailType3Val = rDetailType3Select && rDetailType3Select.style.display !== 'none' ? rDetailType3Select.value : '';
                    const isPartModeTpl = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(rDetailType3Val)));
                    const templateId = isPartModeTpl ? 'log-part-item-template' : 'detail-content-item-template';

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
                            addSpecBtn.type = 'button';
                            addSpecBtn.style.cssText = 'margin-left: 5px; background: #0d1117; border: 1px solid #3fb950; color: #3fb950; border-radius: 4px; padding: 0 4px; font-size: 12px; font-weight: bold; cursor: pointer; flex-shrink: 0; line-height: 1; position: relative; z-index: 20; -webkit-tap-highlight-color: rgba(0,0,0,0);';
                            addSpecBtn.title = '물품 상세 추가';

                            let lastBtnTouch = 0;
                            const triggerAddSpec = (e) => {
                                if (e) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }
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

                            addSpecBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
                            addSpecBtn.ontouchstart = (e) => { e.stopPropagation(); };
                            addSpecBtn.ontouchend = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                lastBtnTouch = Date.now();
                                triggerAddSpec(e);
                            };
                            addSpecBtn.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (Date.now() - lastBtnTouch < 600) return;
                                triggerAddSpec(e);
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

                        let startY = 0;
                        let startX = 0;
                        let isMoving = false;

                        div.addEventListener('touchstart', (e) => {
                            window.lastTouchTime = Date.now();
                            startY = e.touches[0].clientY;
                            startX = e.touches[0].clientX;
                            isMoving = false;
                        }, { passive: true });

                        div.addEventListener('touchmove', (e) => {
                            const moveY = e.touches[0].clientY;
                            const moveX = e.touches[0].clientX;
                            if (Math.abs(moveY - startY) > 6 || Math.abs(moveX - startX) > 6) {
                                isMoving = true;
                            }
                        }, { passive: true });

                        const handleSelect = (e) => {
                            if (e.target.closest('button') || e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') return;
                            e.preventDefault();
                            e.stopPropagation();
                            trigger.classList.remove('error-border');

                            const rDetailType3Val = rDetailType3Select && rDetailType3Select.style.display !== 'none' ? rDetailType3Select.value : '';
                            const isPartModeClick = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(rDetailType3Val)));

                            if (type === '비정기' && !isPartModeClick) {
                                list.querySelectorAll('.log-select-item.selected').forEach(el => {
                                    if (el !== div) el.classList.remove('selected');
                                });
                            }
                            div.classList.toggle('selected');
                            updateTriggerText();

                            if (type === '비정기' && !isPartModeClick && div.classList.contains('selected')) {
                                dropdown.classList.remove('show');
                            }

                            const pWrapper = document.getElementById('register-part-row');
                            if (pWrapper) {
                                pWrapper.style.display = 'none';
                            }
                        };

                        div.addEventListener('touchend', (e) => {
                            if (isMoving) return;
                            handleSelect(e);
                        });

                        div.addEventListener('mousedown', (e) => {
                            if (window.lastTouchTime && Date.now() - window.lastTouchTime < 600) return;
                            handleSelect(e);
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

        const rDetailType3Val = rDetailType3Select && rDetailType3Select.style.display !== 'none' ? rDetailType3Select.value : '';
        const isPartModeFooter = (detailType === 'PM 점검' || detailType === 'Parts 교체' || (type === '고객대응' && detailType === '설비 정상화') || (type === '비정기' && ['파트 이상 교체', '파트 이상 수리', '용액 용자 이상'].includes(rDetailType3Val)));

        const footer = dropdown ? dropdown.querySelector('.log-select-footer') : null;
        if (footer) footer.style.display = (type === '비정기' && !isPartModeFooter) ? 'none' : 'block';
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
        if (allVals.length > 0) {
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
    if (window.isRegisteringSchedule) return;
    window.isRegisteringSchedule = true;

    const btnSave = document.getElementById('btn-save-register-schedule');
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.style.pointerEvents = 'none';
        btnSave.style.opacity = '0.5';
    }

    const resetRegisterState = () => {
        window.isRegisteringSchedule = false;
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.style.pointerEvents = '';
            btnSave.style.opacity = '';
        }
    };

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
        const detailType3Select = document.getElementById('register-detail-type3-select');
        const detailType3 = detailType3Select && detailType3Select.style.display !== 'none' ? detailType3Select.value : '';
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
        if (type === '비정기' && detailType3Select && !detailType3Select.disabled && detailType3Select.style.display !== 'none' && !detailType3) {
            detailType3Select.classList.add('error-border');
            hasError = true;
        }
        checkField('register-cost-type');

        if (!worker) {
            const workerTrigger = document.getElementById('register-worker-trigger');
            if (workerTrigger) workerTrigger.classList.add('error-border');
            hasError = true;
        }

        let content = '';
        if (type === '고객대응' && (detailType === '파티클 필터 교체' || detailType.startsWith('파티클 필터 교체'))) {
            content = '[유상] Particle Filter';
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
                        const bMatch = val.match(/^\[(.*?)\]\s*(.*)$/);
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

        let finalDetailType = detailType;

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

        const itemsList = content ? content.split(', ').map(s => s.trim()).filter(s => s) : [];
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

        if (window.currentAddWorkLogId) {
            let combinedContentArray = [];
            let combinedCodeArray = [];
            let combinedSpecArray = [];
            let combinedCostArray = [];

            itemsList.forEach((itemText) => {
                let itemCost = costType || '유상';
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
                const specMatch = itemText.match(/\s*\[(.*?)\]$/);
                if (specMatch) {
                    spec = specMatch[1].trim();
                    pureContent = itemText.substring(0, specMatch.index).trim();
                }
                let fullContent = pureContent;

                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) {
                    code = match.code || '';
                    fullContent = match.code || match.part || pureContent;
                }

                let formattedItemContent = fullContent.startsWith('[') ? fullContent : `[${itemCost}] ${fullContent}`;
                if (spec && !formattedItemContent.includes(`[${spec}]`)) {
                    formattedItemContent += ` [${spec}]`;
                }

                combinedContentArray.push(formattedItemContent);
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
                detailType: detailType,
                detailType2: detailType2,
                detailType3: detailType3,
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
        } else {
            // [단일화 통합] 정기 및 비정기/고객대응 등 모든 작업 등록 시 다중 부품을 1개의 레코드에 쉼표(,) 구분으로 결합하여 등록
            let combinedContentArray = [];
            let combinedCodeArray = [];
            let combinedSpecArray = [];
            let combinedCostArray = [];
            let period = null;

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
                const specMatch = itemText.match(/\s*\[(.*?)\]$/);
                if (specMatch) {
                    spec = specMatch[1].trim();
                    pureContent = itemText.substring(0, specMatch.index).trim();
                }
                let fullContent = pureContent;

                const match = adminItems.find(a => a.part === pureContent || a.code === pureContent);
                if (match) {
                    code = match.code || '';
                    fullContent = match.code || match.part || pureContent;
                    if (type === '정기' && match.cycle) period = match.cycle;
                }

                let setContent = itemCost ? `[${itemCost}] ${fullContent}` : fullContent;
                if (spec) setContent += ` [${spec}]`;

                combinedContentArray.push(setContent);
                if (code) combinedCodeArray.push(code);
                if (spec) combinedSpecArray.push(spec);
                if (itemCost) combinedCostArray.push(itemCost);
            });

            const finalContent = combinedContentArray.join(', ');
            const finalCode = Array.from(new Set(combinedCodeArray)).join(', ');
            const finalSpec = Array.from(new Set(combinedSpecArray)).join(', ');
            const finalItemCost = Array.from(new Set(combinedCostArray)).join(', ');

            const getPureName = (str) => {
                if (!str) return '';
                let s = str.replace(/^\[.*?\]\s*/, '').trim();
                const sm = s.match(/ \[(.*?)\]$/);
                if (sm) s = s.replace(sm[0], '').trim();
                return s;
            };

            let existingItem = (!window.currentAddWorkLogId) 
                ? data.maint.find(m => {
                    if (m.originalLogId) return false;
                    if (m.type && type && m.type !== type) return false;
                    if (m.scheduledDate && m.scheduledDate !== dateStr) return false;
                    const mPure = getPureName(m.code || m.content);
                    const fPure = getPureName(finalCode || finalContent);
                    const mSpec = (m.spec || '').trim();
                    const fSpec = (finalSpec || '').trim();
                    return mPure && fPure && mPure === fPure && mSpec === fSpec;
                })
                : null;
            if (existingItem) {
                const oldDate = existingItem.scheduledDate;
                existingItem.scheduledDate = dateStr;
                existingItem.detailType = detailType;
                existingItem.detailType2 = detailType2;
                existingItem.detailType3 = detailType3;
                if (costType) existingItem.costType = costType;
                existingItem.md = md;
                existingItem.worker = worker;
                if (finalItemCost) existingItem.itemCost = finalItemCost;
                existingItem.content = finalContent;
                if (finalSpec) existingItem.spec = finalSpec;
                if (window.currentAddWorkLogId) {
                    existingItem.originalLogId = window.currentAddWorkLogId.toString();
                }
                lastProcessedId = existingItem.id;

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
                    detailType2: detailType2,
                    detailType3: detailType3,
                    code: finalCode,
                    content: finalContent,
                    spec: finalSpec,
                    date: "",
                    period: period,
                    scheduledDate: dateStr,
                    costType: costType,
                    worker: worker,
                    md: md,
                    itemCost: finalItemCost,
                    status: '작업예정',
                    originalLogId: window.currentAddWorkLogId ? window.currentAddWorkLogId.toString() : null
                };
                lastProcessedId = newItem.id;
                data.maint.push(newItem);
                payload.maint_upserts.push(newItem);

                if (typeof window.incrementConfirmedCount === 'function') window.incrementConfirmedCount(site, dateStr, 1);
            }
        }

        const success = await window.syncHistoryTransaction(site, equip, payload);
        if (!success) return;

        localStorage.setItem(key, JSON.stringify(data));

        if (window.currentAddWorkLogId) {
            if (typeof addSystemLog === 'function') {
                addSystemLog('ADD_SCHEDULE_EXTRA', equip, `예정일: ${dateStr}, 구분: ${type}\n세부구분: ${finalDetailType} (추가 작업 등록)`);
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
                addSystemLog('ADD_SCHEDULE', equip, `예정일: ${dateStr}, 구분: ${type}\n세부구분: ${finalDetailType}`);
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

        window.isMobileRegisterFlow = false;
        window.openDetailAfterRegister = false;

        // [요청 반영] 작업 등록 완료 시 바로 작업 상세 정보 팝업 모달 자동 노출
        if (lastProcessedId && typeof openEventDetailModal === 'function') {
            setTimeout(() => {
                window.currentDetailTarget = { site: site, equip: equip };
                openEventDetailModal(site, equip, lastProcessedId, false);
            }, 100);
        }
    } catch (err) {
        console.error('Task Registration Error:', err);
        alert('작업 등록 처리 중 예기치 못한 오류가 발생했습니다.\n상세: ' + err.message);
    } finally {
        resetRegisterState();
    }
}

/* --- 2.5 전역 노출 (Exports) --- */
window.setupRegisterScheduleModal = setupRegisterScheduleModal;
window.openRegisterScheduleModal = openRegisterScheduleModal;

/* ==========================================================================
   3. 장비 이관 모달 (Equip Transfer Modal)
   ========================================================================== */
window.setupEquipTransferModal = function () {
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

window.openEquipTransferModal = function () {
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

window.handleEquipTransfer = async function (site, equip, newStatus, rejectReason = '') {
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

window.setupTransferHistoryModal = function () {
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

window.openTransferHistoryModal = function () {
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

window.renderTransferHistoryList = function () {
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

// [마이그레이션] 로컬스토리지 완료 작업 데이터(details_*) 중 세부내용(memo)의 파트 추가 정보 content 복원
(function migrateLocalPartContentLogs() {
    try {
        const sub3List = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상", "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"];
        const prefixPattern = /^(파트 이상 교체|파트 이상 수리|용액 용자 이상|현장 이슈|PC 이상|작업자 실수|통신 이상|프로그램 이상|단순조치|기타)\s*[-:]\s*/;

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('details_')) {
                const data = JSON.parse(localStorage.getItem(key)) || {};
                let updated = false;

                if (data.logs && Array.isArray(data.logs)) {
                    data.logs.forEach(log => {
                        let cnt = (log.content || '').trim();
                        let memo = (log.memo || '').trim();
                        let dt = (log.detailType || '').trim();
                        let dtParts = dt ? dt.split(' > ').map(s => s.trim()) : [];

                        let foundSub3 = null;
                        const m = cnt.match(prefixPattern);
                        if (m) {
                            foundSub3 = m[1];
                            cnt = cnt.replace(prefixPattern, '').trim();
                        }

                        let addPartStr = '';
                        if (memo.includes('[추가 파트]')) {
                            addPartStr = memo.split('[추가 파트]')[1].trim();
                        }

                        if (!cnt || sub3List.includes(cnt) || cnt === '내용 없음') {
                            if (addPartStr) {
                                cnt = addPartStr;
                            } else if (memo) {
                                const mLines = memo.split('\n').map(s => s.trim()).filter(Boolean);
                                const pLines = mLines.filter(l => l.includes('[유상]') || l.includes('[무상') || l.includes('[기타]') || /(valve|pump|filter|sensor|column|module|kit|펌프|필터|밸브|센서|컬럼|모듈|키트|파츠|파트)/i.test(l));
                                if (pLines.length > 0) {
                                    cnt = pLines.join(', ');
                                }
                            }
                        }

                        if (log.type === '비정기') {
                            if (dtParts.length === 2) {
                                if (!foundSub3) {
                                    sub3List.forEach(s3 => { if ((log.content || '').includes(s3)) foundSub3 = s3; });
                                }
                                if (!foundSub3) foundSub3 = addPartStr ? '파트 이상 교체' : '기타';
                                dtParts.push(foundSub3);
                                log.detailType = dtParts.join(' > ');
                                updated = true;
                            }
                        }

                        if (cnt && log.content !== cnt) {
                            log.content = cnt;
                            updated = true;
                        }
                    });
                }

                if (updated) {
                    localStorage.setItem(key, JSON.stringify(data));
                }
            }
        }
    } catch (e) {
        console.error('migrateLocalPartContentLogs error:', e);
    }
})();