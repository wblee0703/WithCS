/* ==========================================================================
   1. 초기화 (Initialization)
   ========================================================================== */
// [1.1] DOM 로드 시 초기화 및 외부 클릭 감지
document.addEventListener('DOMContentLoaded', () => {
    if (window.isDataLoaded) {
        initSortPage();
    } else {
        window.addEventListener('DataLoaded', initSortPage);
    }

    // 드롭다운 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.log-select-dropdown').forEach(d => {
            const wrapper = d.closest('.log-select-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                d.style.display = 'none';
                d.classList.remove('show');
            }
        });
    });
});

// [1.2] 로컬 데이터 안전 조회 헬퍼: 모든 형태의 로컬 데이터를 안전하게 병합하여 가져옴
function getSortDeviceData() {
    // 100% DB 동기화 방식에 맞춰 localStorage의 순수 device_data 맵핑 객체만 사용
    return JSON.parse(localStorage.getItem('device_data')) || {};
}

// [1.3] 정렬(검색) 페이지 메인 초기화 (캐시 복원 및 필터 세팅)
function initSortPage() {
    let data = getSortDeviceData();
    if (!data || Object.keys(data).length === 0) {
        if (!window.sortInitRetries) window.sortInitRetries = 0;
        if (window.sortInitRetries < 50) { // 최대 5초 대기
            window.sortInitRetries++;
            setTimeout(initSortPage, 100);
            return;
        }
    }

    // [추가] 중복 이벤트 실행 방지 (필터 꼬임 원천 차단)
    if (window.isSortPageInitialized) return;
    window.isSortPageInitialized = true;

    setupSortFilters();
    setupSortEvents();
    setupSortResizer();

    // 마지막 검색 필터 복원
    try {
        const lastSortFilters = JSON.parse(localStorage.getItem('lastSortFilters'));
        if (lastSortFilters) {
            const periodType = document.getElementById('sort-period-type');
            if (periodType && lastSortFilters.periodType) {
                periodType.value = lastSortFilters.periodType;
                periodType.dispatchEvent(new Event('change'));
            }

            if (lastSortFilters.monthInput) {
                const mi = document.getElementById('sort-month-input');
                if (mi) mi.value = lastSortFilters.monthInput;
            }
            if (lastSortFilters.yearInput) {
                const yi = document.getElementById('sort-year-input');
                if (yi) {
                    const exists = Array.from(yi.options).some(o => o.value == lastSortFilters.yearInput);
                    if (!exists) yi.insertAdjacentHTML('beforeend', `<option value="${lastSortFilters.yearInput}">${lastSortFilters.yearInput}년</option>`);
                    yi.value = lastSortFilters.yearInput;
                }
            }
            if (lastSortFilters.startDate) {
                const si = document.getElementById('sort-start-date');
                if (si) si.value = lastSortFilters.startDate;
            }
            if (lastSortFilters.endDate) {
                const ei = document.getElementById('sort-end-date');
                if (ei) ei.value = lastSortFilters.endDate;
            }

            if (lastSortFilters.keywordInputVal) {
                const ki = document.getElementById('sort-keyword');
                if (ki) ki.value = lastSortFilters.keywordInputVal;
            }

            // [개선] 다중 선택 드롭다운 상태 완벽 복원
            const applyCustomMultiSelect = (selectId, values) => {
                if (!values) return;
                const list = document.getElementById(`${selectId}-list`);
                const selectEl = document.getElementById(selectId);

                // [추가] 과거 '전체 해제' 상태가 '전체 검색'으로 동작하던 캐시 데이터 호환성 보정
                // 값이 없으면 0건이 검색되도록 로직이 수정되었으므로, 빈 배열 캐시를 불러올 경우 전체 선택 상태로 강제 복원
                if (values.length === 0 && selectEl) {
                    values = Array.from(selectEl.options).map(o => o.value).filter(v => v);
                }

                if (selectEl) {
                    Array.from(selectEl.options).forEach(opt => {
                        opt.selected = values.includes(opt.value);
                    });
                }
                if (list) {
                    list.querySelectorAll('.log-select-item').forEach(el => {
                        if (values.includes(el.dataset.value)) {
                            el.classList.add('selected');
                            const icon = el.querySelector('.check-icon');
                            if (icon) icon.style.opacity = '1';
                        } else {
                            el.classList.remove('selected');
                            const icon = el.querySelector('.check-icon');
                            if (icon) icon.style.opacity = '0';
                        }
                    });
                    const trigger = document.getElementById(`${selectId}-trigger`);
                    const selected = Array.from(list.querySelectorAll('.log-select-item.selected'));
                    const totalItems = list.querySelectorAll('.log-select-item').length;

                    if (trigger) {
                        const placeholder = trigger.dataset.placeholder || '전체';
                        if (totalItems > 0 && selected.length === totalItems) {
                            trigger.textContent = placeholder;
                            trigger.style.color = '#e6edf3';
                        } else if (selected.length === 0) {
                            trigger.textContent = '선택 없음';
                            trigger.style.color = '#8b949e';
                        } else if (selected.length === 1) {
                            trigger.textContent = selected[0].querySelector('.item-text').textContent;
                            trigger.style.color = '#e6edf3';
                        } else {
                            trigger.textContent = `${selected[0].querySelector('.item-text').textContent} 외 ${selected.length - 1}개`;
                            trigger.style.color = '#e6edf3';
                        }
                    }
                }
            };

            setTimeout(() => {
                try {
                    let data = getSortDeviceData();

                    applyCustomMultiSelect('sort-site-select', lastSortFilters.siteFilters);
                    updateSortBuildingSelect(getMultiValues('sort-site-select'));
                    applyCustomMultiSelect('sort-building-select', lastSortFilters.buildingFilters);

                    applyCustomMultiSelect('sort-model-select', lastSortFilters.modelFilters);
                    updateSortEquipSelect(getMultiValues('sort-site-select'), getMultiValues('sort-building-select'), getMultiValues('sort-model-select'), data);
                    applyCustomMultiSelect('sort-equip-select', lastSortFilters.equipFilters);

                    applyCustomMultiSelect('sort-type-select', lastSortFilters.typeFilters);
                    updateSortDetailTypeSelect();
                    applyCustomMultiSelect('sort-detail-type-select', lastSortFilters.detailTypeFilters);
                    updateSortDetailType2Select();
                    applyCustomMultiSelect('sort-detail-type2-select', lastSortFilters.detailType2Filters);

                    applyCustomMultiSelect('sort-cost-type-select', lastSortFilters.costTypeFilters);
                    applyCustomMultiSelect('sort-item-detail-type-select', lastSortFilters.itemDetailTypeFilters);

                    if (lastSortFilters.keywordSelected && lastSortFilters.keywordSelected.length > 0) {
                        const kwList = document.getElementById('sort-keyword-list');
                        if (kwList) {
                            kwList.querySelectorAll('.log-select-item').forEach(el => {
                                if (lastSortFilters.keywordSelected.includes(el.dataset.value)) {
                                    el.classList.add('selected');
                                    const icon = el.querySelector('.check-icon');
                                    if (icon) icon.style.opacity = '1';
                                }
                            });
                            updateKeywordTrigger();
                        }
                    }
                } catch (e) {
                    console.error('Filter restore error:', e);
                } finally {
                    performSortSearch();
                }
            }, 100);
            return;
        }
    } catch (e) { }

    // 초기 로드 시 '연간' 기준으로 전체 데이터 자동 검색 실행 (저장된 필터가 없을 때)
    const pType = document.getElementById('sort-period-type');
    if (pType) {
        pType.value = 'year';
        pType.dispatchEvent(new Event('change'));
    }

    // [추가] 초기 진입 시 연쇄 업데이트를 통한 하위 필터(건물, 장비 등) 생성 및 전부 선택 활성화 유도
    const siteSelect = document.getElementById('sort-site-select');
    if (siteSelect) {
        siteSelect.dispatchEvent(new Event('change'));
    }

    setTimeout(performSortSearch, 150); // 드롭다운(연도 등) UI 렌더링을 기다리기 위해 대기 시간 증가
}

// [1.4] 사이드바 너비 조절(Resizer) 이벤트 설정
function setupSortResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.dashboard-sidebar');
    if (resizer && sidebar) {
        let isResizing = false;
        resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.cursor = 'col-resize'; resizer.classList.add('resizing'); });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX - sidebar.getBoundingClientRect().left;
            if (newWidth > 200 && newWidth < 600) sidebar.style.width = `${newWidth}px`;
        });
        document.addEventListener('mouseup', () => { isResizing = false; document.body.style.cursor = 'default'; resizer.classList.remove('resizing'); });
    }
}

/* ==========================================================================
   2. 커스텀 UI 유틸리티 (Custom UI Utilities)
   ========================================================================== */
// [2.1] 커스텀 다중 선택 드롭다운의 선택된 값 배열 추출
function getMultiValues(selectId) {
    const wrapper = document.getElementById(`${selectId}-wrapper`);
    if (wrapper) {
        const selected = wrapper.querySelectorAll('.log-select-item.selected');
        return Array.from(selected).map(el => el.dataset.value).filter(v => v);
    }
    const sel = document.getElementById(selectId);
    if (sel && sel.value) return [sel.value];
    return [];
}

// [2.2] 기본 Select 엘리먼트를 커스텀 체크박스 다중 드롭다운 UI로 변환 및 동기화
function syncCustomMultiSelect(selectId, placeholder = '전체') {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;

    let wrapper = document.getElementById(`${selectId}-wrapper`);
    if (!wrapper) {
        selectEl.style.display = 'none';
        wrapper = document.createElement('div');
        wrapper.id = `${selectId}-wrapper`;
        wrapper.className = 'log-select-wrapper full-width';
        wrapper.style.margin = '0';
        wrapper.style.position = 'relative'; // 부모 영역 기준점 설정

        wrapper.innerHTML = `
            <div id="${selectId}-trigger" data-placeholder="${placeholder}" class="log-select-trigger" style="min-height:30px; display:flex; align-items:center; background:#0d1117; color:#8b949e; border:1px solid #30363d; border-radius:4px; padding:6px 10px; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${placeholder}</div>
            <div id="${selectId}-dropdown" class="log-select-dropdown" style="width:100%; display:none; position:absolute; top:100%; left:0; z-index:1000; margin-top:4px; background:#161b22; border:1px solid #30363d; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5); box-sizing:border-box;">
                <div id="${selectId}-list" class="log-select-list" style="max-height: 200px; overflow-y: auto; padding: 8px;"></div>
                <div class="log-select-footer" style="padding: 8px; border-top: 1px solid #30363d; background: #21262d; display: flex; gap: 5px;">
                    <button type="button" class="btn-gray btn-select-all" style="flex: 1; padding: 4px 0; font-size: 12px;">전체 선택</button>
                    <button type="button" class="btn-gray btn-deselect-all" style="flex: 1; padding: 4px 0; font-size: 12px;">전체 해제</button>
                    <button type="button" class="btn-blue-sm btn-confirm" style="flex: 1;">선택 완료</button>
                </div>
            </div>
        `;
        selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

        const trigger = wrapper.querySelector(`#${selectId}-trigger`);
        const dropdown = wrapper.querySelector(`#${selectId}-dropdown`);
        const confirmBtn = wrapper.querySelector('.btn-confirm');
        const selectAllBtn = wrapper.querySelector('.btn-select-all');
        const deselectAllBtn = wrapper.querySelector('.btn-deselect-all');

        trigger.onclick = (e) => {
            e.stopPropagation();
            if (trigger.classList.contains('disabled')) return;
            document.querySelectorAll('.log-select-dropdown').forEach(d => {
                if (d !== dropdown) { d.style.display = 'none'; d.classList.remove('show'); }
            });
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
                dropdown.classList.remove('show');
            } else {
                dropdown.style.display = 'block';
                dropdown.classList.add('show');
            }
        };

        if (selectAllBtn) {
            selectAllBtn.addEventListener('mousedown', (e) => {
                e.preventDefault(); // 포커스 아웃 방지
                e.stopPropagation();
                list.querySelectorAll('.log-select-item').forEach(el => {
                    el.classList.add('selected');
                    const checkIcon = el.querySelector('.check-icon');
                    if (checkIcon) checkIcon.style.opacity = '1';
                });
                updateTriggerText();
                selectEl.dispatchEvent(new Event('change'));
            });
        }

        if (deselectAllBtn) {
            deselectAllBtn.addEventListener('mousedown', (e) => {
                e.preventDefault(); // 포커스 아웃 방지
                e.stopPropagation();
                list.querySelectorAll('.log-select-item').forEach(el => {
                    el.classList.remove('selected');
                    const checkIcon = el.querySelector('.check-icon');
                    if (checkIcon) checkIcon.style.opacity = '0';
                });
                updateTriggerText();
                selectEl.dispatchEvent(new Event('change'));
            });
        }

        confirmBtn.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 포커스 아웃 방지
            e.stopPropagation();
            dropdown.style.display = 'none';
            dropdown.classList.remove('show');
        });
    }

    const list = wrapper.querySelector(`#${selectId}-list`);
    const trigger = wrapper.querySelector(`#${selectId}-trigger`);

    const isInitialized = wrapper.dataset.initialized === 'true';
    wrapper.dataset.initialized = 'true';
    const previousKnownValues = JSON.parse(wrapper.dataset.knownValues || '[]');

    if (selectEl.disabled) {
        trigger.classList.add('disabled');
        trigger.style.opacity = '0.5';
        trigger.style.cursor = 'not-allowed';
        trigger.textContent = placeholder;
        list.innerHTML = '';
        wrapper.dataset.knownValues = '[]';
        return;
    } else {
        trigger.classList.remove('disabled');
        trigger.style.opacity = '1';
        trigger.style.cursor = 'pointer';
    }

    const currentSelected = Array.from(list.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
    list.innerHTML = '';

    const options = Array.from(selectEl.options).filter(opt => opt.value);
    if (options.length === 0) {
        list.innerHTML = '<div style="padding:10px; color:#8b949e; text-align:center; font-size:12px;">항목이 없습니다.</div>';
        wrapper.dataset.knownValues = '[]';
    } else {
        const currentValues = [];
        options.forEach(opt => {
            const val = opt.value;
            const text = opt.textContent;
            currentValues.push(val);
            const div = document.createElement('div');
            div.className = 'log-select-item';
            div.dataset.value = val;

            let isSelected = false;
            if (!isInitialized) {
                isSelected = true; // [수정] 초기 상태에는 모든 항목이 체크되도록 변경
            } else {
                // 이전에 없던 새 항목이 렌더링될 경우 기본적으로 체크되도록 처리
                if (!previousKnownValues.includes(val)) {
                    isSelected = true;
                } else {
                    isSelected = currentSelected.includes(val);
                }
            }

            if (isSelected) div.classList.add('selected');

            div.innerHTML = `<span class="check-icon" style="margin-right:8px; opacity:${isSelected ? '1' : '0'}; font-weight:bold; color:#58a6ff; flex-shrink:0;">✓</span><span class="item-text" style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(text)}</span>`;
            div.addEventListener('mousedown', (e) => {
                e.preventDefault(); // 클릭 시 포커스 잃음(blur) 방지로 클릭 이벤트 보장
                e.stopPropagation();
                div.classList.toggle('selected');
                const checkIcon = div.querySelector('.check-icon');
                if (checkIcon) checkIcon.style.opacity = div.classList.contains('selected') ? '1' : '0';
                updateTriggerText();
                selectEl.dispatchEvent(new Event('change'));
            });
            list.appendChild(div);
        });
        wrapper.dataset.knownValues = JSON.stringify(currentValues);
    }

    const updateTriggerText = () => {
        const selected = Array.from(list.querySelectorAll('.log-select-item.selected'));
        const totalItems = list.querySelectorAll('.log-select-item').length;

        if (totalItems > 0 && selected.length === totalItems) {
            trigger.textContent = placeholder;
            trigger.style.color = '#e6edf3';
        } else if (selected.length === 0) {
            trigger.textContent = '선택 없음'; // [수정] 0개 선택 시 명확한 텍스트로 변경
            trigger.style.color = '#8b949e';
        } else if (selected.length === 1) {
            trigger.textContent = selected[0].querySelector('.item-text').textContent;
            trigger.style.color = '#e6edf3';
        } else {
            trigger.textContent = `${selected[0].querySelector('.item-text').textContent} 외 ${selected.length - 1}개`;
            trigger.style.color = '#e6edf3';
        }
        trigger.title = selected.map(el => el.querySelector('.item-text').textContent).join('\n');
    };

    updateTriggerText();
}

/* ==========================================================================
   3. 필터 설정 및 업데이트 (Filter Setup & Updates)
   ========================================================================== */
// [3.1] 전체 검색 필터 초기화 및 연쇄 변경(Change) 이벤트 설정
function setupSortFilters() {
    const siteSelect = document.getElementById('sort-site-select');
    const buildingSelect = document.getElementById('sort-building-select');
    const modelSelect = document.getElementById('sort-model-select');
    const equipSelect = document.getElementById('sort-equip-select');
    const typeSelect = document.getElementById('sort-type-select');
    const detailTypeSelect = document.getElementById('sort-detail-type-select');

    if (!siteSelect) return;

    let data = getSortDeviceData();

    siteSelect.innerHTML = '<option value="">전체 사업장</option>';
    Object.keys(data).sort().forEach(site => {
        if (!Array.isArray(data[site])) return;
        const opt = document.createElement('option');
        opt.value = site;
        opt.textContent = site;
        siteSelect.appendChild(opt);
    });

    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    if (modelSelect) {
        modelSelect.innerHTML = '<option value="">전체 모델</option>';
        equipmentModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = m.name;
            modelSelect.appendChild(opt);
        });
        modelSelect.addEventListener('change', (e) => {
            updateSortEquipSelect(getMultiValues('sort-site-select'), getMultiValues('sort-building-select'), getMultiValues('sort-model-select'), data);
        });
    }

    siteSelect.addEventListener('change', (e) => {
        const sites = getMultiValues('sort-site-select');
        updateSortBuildingSelect(sites);
        updateSortEquipSelect(sites, [], getMultiValues('sort-model-select'), data);
    });

    if (buildingSelect) {
        buildingSelect.addEventListener('change', (e) => {
            updateSortEquipSelect(getMultiValues('sort-site-select'), getMultiValues('sort-building-select'), getMultiValues('sort-model-select'), data);
        });
    }

    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            updateKeywordSuggestions();
            updateSortDetailType2Select(); // '비정기' 선택에 따른 세부구분2 가시성 제어
        });
    }

    // 기간 설정 로직
    const periodType = document.getElementById('sort-period-type');
    const monthInput = document.getElementById('sort-month-input');
    const yearInput = document.getElementById('sort-year-input');
    const customInput = document.getElementById('sort-custom-input');
    const startDateInput = document.getElementById('sort-start-date');
    const endDateInput = document.getElementById('sort-end-date');

    // [추가] 기간 설정 드롭다운과 입력창들을 한 줄(가로)에 배치하기 위한 DOM 조작
    if (periodType && periodType.parentElement && !document.getElementById('sort-period-flex-wrapper')) {
        const flexWrapper = document.createElement('div');
        flexWrapper.id = 'sort-period-flex-wrapper';
        flexWrapper.style.display = 'flex';
        flexWrapper.style.flexWrap = 'wrap'; // [수정] 직접 입력 시 줄바꿈을 위해 추가
        flexWrapper.style.gap = '5px';
        flexWrapper.style.alignItems = 'center';
        flexWrapper.style.width = '100%';
        flexWrapper.style.marginBottom = '15px'; // 하단 여백 추가

        periodType.parentElement.insertBefore(flexWrapper, periodType);

        periodType.classList.remove('full-width', 'mb-5');
        periodType.style.flex = '0 0 auto';
        periodType.style.width = 'auto';
        periodType.style.margin = '0';
        flexWrapper.appendChild(periodType);

        if (monthInput) {
            monthInput.style.flex = '1';
            monthInput.style.minWidth = '0';
            monthInput.classList.remove('mt-10');
            flexWrapper.appendChild(monthInput);
        }
        if (yearInput) {
            yearInput.style.flex = '1';
            yearInput.style.minWidth = '0';
            yearInput.classList.remove('mt-10');
            flexWrapper.appendChild(yearInput);
        }
        if (customInput) {
            customInput.style.flex = '1 1 100%'; // [수정] 아래 줄 전체 너비 차지
            customInput.style.minWidth = '0';
            customInput.classList.remove('mt-10');
            flexWrapper.appendChild(customInput);
        }
    }

    const currentYear = new Date().getFullYear();
    if (yearInput) {
        for (let y = currentYear; y >= currentYear - 5; y--) {
            yearInput.insertAdjacentHTML('beforeend', `<option value="${y}">${y}년</option>`);
        }
    }

    const today = new Date();
    if (monthInput) monthInput.value = `${currentYear}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    if (startDateInput && endDateInput) {
        const lastMonth = new Date();
        lastMonth.setMonth(today.getMonth() - 1);
        startDateInput.value = lastMonth.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];
    }

    if (periodType) {
        periodType.addEventListener('change', (e) => {
            if (monthInput) monthInput.style.display = 'none';
            if (yearInput) yearInput.style.display = 'none';
            if (customInput) customInput.style.display = 'none';

            if (e.target.value === 'month') {
                if (monthInput) monthInput.style.display = 'block';
                periodType.style.flex = '0 0 auto';
                periodType.style.width = 'auto';
                periodType.style.marginBottom = '0';
            }
            else if (e.target.value === 'year') {
                if (yearInput) yearInput.style.display = 'block';
                periodType.style.flex = '0 0 auto';
                periodType.style.width = 'auto';
                periodType.style.marginBottom = '0';
            }
            else {
                if (customInput) customInput.style.display = 'flex';
                periodType.style.flex = '1 1 100%';
                periodType.style.width = '100%';
                periodType.style.marginBottom = '5px';
            }
        });
    }

    // 필터 메뉴 초기화 (모든 옵션 로드)
    updateSortDetailTypeSelect();
    updateSortDetailType2Select();

    // 초기 커스텀 다중 선택 UI 동기화
    syncCustomMultiSelect('sort-site-select', '전체 사업장');
    syncCustomMultiSelect('sort-building-select', '전체 건물');
    syncCustomMultiSelect('sort-equip-select', '전체 장비');
    syncCustomMultiSelect('sort-model-select', '전체 모델');
    syncCustomMultiSelect('sort-type-select', '전체 구분');
    syncCustomMultiSelect('sort-detail-type-select', '전체 세부 구분');
    syncCustomMultiSelect('sort-detail-type2-select', '전체 세부 구분 2');
    syncCustomMultiSelect('sort-item-detail-type-select', '전체 물품 상세');
    syncCustomMultiSelect('sort-cost-type-select', '전체 비용 처리');

    setupSortKeyword();
}

// [3.2] 결과 내 텍스트 검색창(Keyword) 드롭다운 이벤트 설정
function setupSortKeyword() {
    const dropdown = document.getElementById('sort-keyword-dropdown');
    const confirmBtn = document.getElementById('btn-sort-keyword-confirm');
    const selectAllBtn = document.getElementById('btn-sort-keyword-select-all');
    const deselectBtn = document.getElementById('btn-sort-keyword-deselect');
    const input = document.getElementById('sort-keyword');

    if (input && dropdown) {
        const showDropdown = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.log-select-dropdown').forEach(d => {
                if (d !== dropdown) { d.style.display = 'none'; d.classList.remove('show'); }
            });
            dropdown.style.display = 'block';
            dropdown.classList.add('show');
            updateKeywordSuggestions();
        };

        input.onclick = showDropdown;
        input.onfocus = showDropdown;

        if (selectAllBtn) {
            selectAllBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const list = document.getElementById('sort-keyword-list');
                if (list) {
                    list.querySelectorAll('.log-select-item').forEach(el => {
                        if (el.style.display !== 'none') {
                            el.classList.add('selected');
                            const icon = el.querySelector('.check-icon');
                            if (icon) icon.style.opacity = '1';
                        }
                    });
                    updateKeywordTrigger();
                    performSortSearch();
                }
            });
        }

        if (deselectBtn) {
            deselectBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const list = document.getElementById('sort-keyword-list');
                if (list) {
                    list.querySelectorAll('.log-select-item').forEach(el => {
                        el.classList.remove('selected');
                        const icon = el.querySelector('.check-icon');
                        if (icon) icon.style.opacity = '0';
                    });
                    updateKeywordTrigger();
                    performSortSearch();
                }
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropdown.style.display = 'none';
                dropdown.classList.remove('show');
                updateKeywordTrigger();
            });
        }

        input.oninput = () => {
            dropdown.style.display = 'block';
            dropdown.classList.add('show');
            const list = document.getElementById('sort-keyword-list');
            if (list) {
                const kw = input.value.trim().toLowerCase();
                list.querySelectorAll('.log-select-item').forEach(el => {
                    if (el.dataset.value.toLowerCase().includes(kw)) {
                        el.style.display = 'flex';
                    } else {
                        el.style.display = 'none';
                    }
                });
            }
        };
        input.onkeypress = (e) => {
            if (e.key === 'Enter') {
                dropdown.style.display = 'none';
                dropdown.classList.remove('show');
                updateKeywordTrigger();
                performSortSearch();
            }
        };
    }
}

// [3.3] 텍스트 검색창 제안(자동완성) 목록 업데이트
function updateKeywordSuggestions() {
    const keywordList = document.getElementById('sort-keyword-list');
    if (!keywordList) return;

    const suggestionItems = [
        "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
        "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
    ];

    // [추가] 관리자가 등록한 전체 물품 DB(admin_items)를 제안 박스에 병합하여 검색 편의성 강화
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    adminItems.forEach(item => {
        if (item.part && !suggestionItems.includes(item.part)) {
            suggestionItems.push(item.part);
        }
    });

    const currentSelected = Array.from(keywordList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
    keywordList.innerHTML = '';

    Array.from(suggestionItems).sort().forEach(content => {
        const div = document.createElement('div');
        div.className = 'log-select-item';
        const isSelected = currentSelected.includes(content);
        if (isSelected) div.classList.add('selected');
        div.dataset.value = content;
        div.innerHTML = `<span class="check-icon" style="margin-right:8px; opacity:${isSelected ? '1' : '0'}; font-weight:bold; color:#58a6ff; flex-shrink:0;">✓</span><span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(content)}</span>`;
        div.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            div.classList.toggle('selected');
            const checkIcon = div.querySelector('.check-icon');
            if (checkIcon) checkIcon.style.opacity = div.classList.contains('selected') ? '1' : '0';
            updateKeywordTrigger();
        });
        keywordList.appendChild(div);
    });

    updateKeywordTrigger();
}

// [3.4] 텍스트 검색창 선택 결과 텍스트(트리거 문구) 업데이트
function updateKeywordTrigger() {
    const input = document.getElementById('sort-keyword');
    const list = document.getElementById('sort-keyword-list');
    if (!input) return;

    const selected = Array.from(list ? list.querySelectorAll('.log-select-item.selected') : []);

    if (selected.length > 0) {
        const text = selected.map(el => el.dataset.value).join(', ');
        input.value = selected.length > 1 ? `${selected[0].dataset.value} 외 ${selected.length - 1}개` : text;
        input.style.color = '#58a6ff';
    } else {
        input.style.color = '#e6edf3';
    }
    input.title = selected.length > 0 ? selected.map(el => el.dataset.value).join('\n') : input.value;
}

// [3.5] 사업장 선택에 따른 건물명 필터 항목 동적 업데이트
function updateSortBuildingSelect(sites) {
    const buildingSelect = document.getElementById('sort-building-select');
    if (!buildingSelect) return;
    buildingSelect.innerHTML = '<option value="">전체 건물</option>';
    if (!sites || sites.length === 0) {
        buildingSelect.disabled = true;
        syncCustomMultiSelect('sort-building-select', '전체 건물');
        return;
    }
    let allBuildings = new Set();
    let hasEmptyBuilding = false;
    let data = getSortDeviceData();

    sites.forEach(site => {
        if (!data[site] || !Array.isArray(data[site])) return;
        data[site].forEach(equip => {
            const key = `details_${site}_${equip}`;
            const detailData = JSON.parse(localStorage.getItem(key)) || {};
            const b = (detailData.setup && detailData.setup.building) ? detailData.setup.building : '';
            if (b) allBuildings.add(b);
            else hasEmptyBuilding = true;
        });
    });

    Array.from(allBuildings).sort().forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        buildingSelect.appendChild(opt);
    });
    if (hasEmptyBuilding) {
        const opt = document.createElement('option');
        opt.value = '미지정';
        opt.textContent = '미지정 (건물 없음)';
        buildingSelect.appendChild(opt);
    }
    buildingSelect.disabled = false;
    syncCustomMultiSelect('sort-building-select', '전체 건물');
}

// [3.6] 사업장/건물/모델 선택에 따른 장비명 필터 항목 동적 업데이트
function updateSortEquipSelect(sites, buildings, models, data) {
    const equipSelect = document.getElementById('sort-equip-select');
    if (!equipSelect) return;
    equipSelect.innerHTML = '<option value="">전체 장비</option>';

    if (!sites || sites.length === 0) {
        equipSelect.disabled = true;
        syncCustomMultiSelect('sort-equip-select', '전체 장비');
        return;
    }

    // 장비 모델 약어 매핑 (ADMIN 정보 연동)
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    sites.forEach(site => {
        if (!data[site] || !Array.isArray(data[site])) return;
        data[site].forEach(equip => {
            if (typeof equip !== 'string') return;
            const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
            const setup = detailData.setup || {};

            if (buildings && buildings.length > 0 && !buildings.includes(setup.building)) return;

            const parts = equip.split('::');
            const equipName = parts[0];
            if (models && models.length > 0 && !models.includes(equipName)) return;

            const serialNo = parts.length > 1 ? parts[1] : '';
            const matchedModel = equipmentModels.find(m => m.name === equipName);
            const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;

            const custEquipName = setup.custEquipName || '';
            let displayText = displayName;
            if (custEquipName) {
                displayText += ` [${custEquipName}]`;
            } else if (serialNo) {
                displayText += ` (${serialNo})`;
            }

            const opt = document.createElement('option');
            opt.value = equip;
            opt.textContent = sites.length > 1 ? `${site} - ${displayText}` : displayText;
            equipSelect.appendChild(opt);
        });
    });
    equipSelect.disabled = false;
    syncCustomMultiSelect('sort-equip-select', '전체 장비');
}

// [3.7] 점검 구분에 따른 세부 구분 1 필터 항목 동적 업데이트
function updateSortDetailTypeSelect() {
    const detailTypeSelect = document.getElementById('sort-detail-type-select');
    if (!detailTypeSelect) return;

    detailTypeSelect.innerHTML = '<option value="">전체 세부 구분</option>';

    detailTypeSelect.disabled = false;

    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    let subCategories = new Set();

    // [추가] 기본 점검 구분 설정 (관리자 페이지 미저장 시 필터가 비어있는 현상 방지)
    const defaultSubCategories = [
        'PM 점검', 'BM 점검', 'Alarm', 'Hunting', 'Data / Para 이상', '기타',
        '순회 점검', '프로그램 변경 / 평가', '설비 평가', 'Parts 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정',
        '용액제조', '온라인점검'
    ];
    defaultSubCategories.forEach(cat => subCategories.add(cat));

    // 모든 세부 구분 항목을 가져옴
    Object.keys(catData).forEach(key => {
        catData[key].forEach(cat => subCategories.add(cat));
    });

    Array.from(subCategories).sort().forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        detailTypeSelect.appendChild(opt);

    });
    syncCustomMultiSelect('sort-detail-type-select', '전체 세부 구분');
    updateSortDetailType2Select();
}

// [3.8] '비정기' 점검 구분 선택 시 세부 구분 2 필터 표시 및 항목 동적 업데이트
function updateSortDetailType2Select() {
    const types = getMultiValues('sort-type-select');
    const detailTypes = getMultiValues('sort-detail-type-select');
    const detailType2Group = document.getElementById('sort-detail-type2-group');
    const detailType2Select = document.getElementById('sort-detail-type2-select');

    if (!detailType2Select) return;
    detailType2Select.innerHTML = '<option value="">전체 세부 구분 2</option>';

    // [수정] 아무것도 선택되지 않은 '전체' 상태일 때는 '비정기'도 포함이므로 숨기지 않음
    if (types.length > 0 && !types.includes('비정기')) {
        if (detailType2Group) detailType2Group.style.display = 'none';
        return;
    }
    if (detailType2Group) detailType2Group.style.display = 'block';

    detailType2Select.disabled = false;

    const catData2 = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
    let subCategories2 = new Set();

    // [추가] 세부구분2 기본값 (사용자 정의 데이터가 없을 경우를 대비)
    const defaultSubCategories2 = {
        'BM 점검': ['BM 물품 교체'],
        'Alarm': ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람'],
        'Hunting': ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅'],
        'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈'],
        '기타': ['배수 펌프 이슈', '구동 이상']
    };

    if (!detailTypes || detailTypes.length === 0) {
        // 세부 구분 1이 선택되지 않았으면 전체 세부구분 2를 로드
        Object.keys(defaultSubCategories2).forEach(k => {
            defaultSubCategories2[k].forEach(cat => subCategories2.add(cat));
        });
        Object.keys(catData2).forEach(key => {
            if (key.includes('::비정기::')) catData2[key].forEach(cat => subCategories2.add(cat));
        });
    } else {
        detailTypes.forEach(dt => {
            if (defaultSubCategories2[dt]) {
                defaultSubCategories2[dt].forEach(cat => subCategories2.add(cat));
            }
            Object.keys(catData2).forEach(key => {
                if (key.includes(`::비정기::${dt}`)) {
                    catData2[key].forEach(cat => subCategories2.add(cat));
                }
            });
        });
    }

    Array.from(subCategories2).forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        detailType2Select.appendChild(opt);
    });
    const optUnspecified = document.createElement('option');
    optUnspecified.value = '미지정';
    optUnspecified.textContent = '미지정';
    detailType2Select.appendChild(optUnspecified);
    syncCustomMultiSelect('sort-detail-type2-select', '전체 세부 구분 2');
}

/* ==========================================================================
   4. 이벤트 및 검색 로직 (Events & Search Logic)
   ========================================================================== */
// [4.1] 검색 버튼 클릭 및 엔터키 이벤트 설정
function setupSortEvents() {
    const searchBtn = document.getElementById('btn-sort-search');
    const keywordInput = document.getElementById('sort-keyword');

    if (searchBtn) searchBtn.addEventListener('click', performSortSearch);
    if (keywordInput) keywordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSortSearch();
    });
}

// [4.2] 핵심 검색 로직: 선택된 필터 조건들을 매칭하여 결과 도출
function performSortSearch() {
    const siteFilters = getMultiValues('sort-site-select');
    const buildingFilters = getMultiValues('sort-building-select');
    const modelFilters = getMultiValues('sort-model-select');
    const equipFilters = getMultiValues('sort-equip-select');
    const typeFilters = getMultiValues('sort-type-select');
    const detailTypeFilters = getMultiValues('sort-detail-type-select');
    const detailType2Filters = getMultiValues('sort-detail-type2-select');
    const itemDetailTypeFilters = getMultiValues('sort-item-detail-type-select');
    const costTypeFilters = getMultiValues('sort-cost-type-select');
    const keywordInputVal = document.getElementById('sort-keyword') ? document.getElementById('sort-keyword').value.trim().toLowerCase() : '';
    const keywordList = document.getElementById('sort-keyword-list');
    const keywordSelected = keywordList ? Array.from(keywordList.querySelectorAll('.log-select-item.selected')).map(el => (el.dataset.value || '').toLowerCase()) : [];

    // [추가] '전체 선택' 상태인지 판별하여 과거/누락된 매핑 데이터도 조건 없이 조회되도록 돕는 헬퍼 함수
    const isAllSelected = (selectId, filtersArray) => {
        const selectEl = document.getElementById(selectId);
        if (!selectEl) return false;
        const validOptions = Array.from(selectEl.options).filter(o => o.value);
        if (validOptions.length === 0) return true; // 옵션이 없으면 전체 통과로 간주
        return filtersArray.length >= validOptions.length;
    };

    const isSiteAll = isAllSelected('sort-site-select', siteFilters);
    const isBuildingAll = isAllSelected('sort-building-select', buildingFilters);
    const isModelAll = isAllSelected('sort-model-select', modelFilters);
    const isEquipAll = isAllSelected('sort-equip-select', equipFilters);
    const isTypeAll = isAllSelected('sort-type-select', typeFilters);
    const isDetailTypeAll = isAllSelected('sort-detail-type-select', detailTypeFilters);
    const isDetailType2All = isAllSelected('sort-detail-type2-select', detailType2Filters);
    const isItemDetailTypeAll = isAllSelected('sort-item-detail-type-select', itemDetailTypeFilters);
    const isCostTypeAll = isAllSelected('sort-cost-type-select', costTypeFilters);

    const currentYear = new Date().getFullYear();
    const periodType = document.getElementById('sort-period-type') ? document.getElementById('sort-period-type').value : 'custom';
    let startDate = '';
    let endDate = '';

    const monthInput = document.getElementById('sort-month-input');
    const yearInput = document.getElementById('sort-year-input');

    if (periodType === 'month') {
        const monthVal = (monthInput && monthInput.value) ? monthInput.value : `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        if (monthVal) {
            const [y, m] = monthVal.split('-').map(Number);
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            const lastDay = new Date(y, m, 0).getDate();
            endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        }
    } else if (periodType === 'year') {
        const yearVal = (yearInput && yearInput.value) ? yearInput.value : currentYear.toString();
        if (yearVal) {
            startDate = `${yearVal}-01-01`;
            endDate = `${yearVal}-12-31`;
        }
    } else {
        startDate = document.getElementById('sort-start-date') ? document.getElementById('sort-start-date').value : '';
        endDate = document.getElementById('sort-end-date') ? document.getElementById('sort-end-date').value : '';
    }

    // [추가] 마지막 검색 필터 저장
    const currentSortFilters = {
        periodType: periodType,
        monthInput: monthInput ? monthInput.value : '',
        yearInput: yearInput ? yearInput.value : '',
        startDate: startDate,
        endDate: endDate,
        keywordInputVal: keywordInputVal,
        siteFilters: siteFilters,
        buildingFilters: buildingFilters,
        modelFilters: modelFilters,
        equipFilters: equipFilters,
        typeFilters: typeFilters,
        detailTypeFilters: detailTypeFilters,
        detailType2Filters: detailType2Filters,
        itemDetailTypeFilters: itemDetailTypeFilters,
        costTypeFilters: costTypeFilters,
        keywordSelected: keywordSelected
    };
    localStorage.setItem('lastSortFilters', JSON.stringify(currentSortFilters));

    let results = [];

    let data = getSortDeviceData();
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    if (!data || Object.keys(data).length === 0) {
        renderSortList([]);
        renderSortChart([]);
        return;
    }

    Object.keys(data).forEach(site => {
        if (!Array.isArray(data[site])) return;
        if (siteFilters.length === 0) return; // 아무것도 선택 안 했으면 패스
        if (!isSiteAll && !siteFilters.includes(site)) return; // 전체 선택이 아닐 때만 포함 여부 검사

        if (data[site]) {
            data[site].forEach(equip => {
                if (typeof equip !== 'string') return;
                if (equipFilters.length === 0) return;
                if (!isEquipAll && !equipFilters.includes(equip)) return;

                const parts = equip.split('::');
                const equipName = parts[0];
                if (modelFilters.length === 0) return;
                if (!isModelAll && !modelFilters.includes(equipName)) return;

                const serialNo = parts.length > 1 ? parts[1] : '';
                const matchedModel = equipmentModels.find(m => m.name === equipName);
                const displayEquipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;

                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
                const equipBuilding = (detailData.setup && detailData.setup.building) ? detailData.setup.building : '미지정';

                if (buildingFilters.length === 0) return;
                if (!isBuildingAll && !buildingFilters.includes(equipBuilding)) return;

                const checkItemMatch = (itemObj, isLog) => {
                    try {
                        const itemDate = isLog ? itemObj.date : itemObj.scheduledDate;
                        if (!itemDate) return false;
                        if (isLog && itemObj.detailType === '일정변경') return false;

                        const itemType = itemObj.type || '정기'; // 구버전 데이터 누락 대응
                        if (typeFilters.length === 0) return false;
                        if (!isTypeAll && !typeFilters.includes(itemType)) return false;
                        if (startDate && itemDate < startDate) return false;
                        if (endDate && itemDate > endDate) return false;

                        let dt1 = itemObj.detailType || (itemType === '정기' ? 'PM 점검' : 'BM 점검');
                        let dt2 = itemObj.detailType2 || '';

                        if (dt1.includes(' > ')) {
                            const ps = dt1.split(' > '); dt1 = ps[0].trim(); dt2 = ps[1].trim();
                        } else if (dt2.includes(' > ')) {
                            const ps = dt2.split(' > '); dt1 = ps[0].trim(); dt2 = ps[1].trim();
                        }

                        if (!dt2) dt2 = '미지정';

                        if (detailTypeFilters.length === 0) return false;
                        if (!isDetailTypeAll && !detailTypeFilters.includes(dt1)) return false;
                        if (itemType === '비정기') {
                            if (detailType2Filters.length === 0) return false;
                            if (!isDetailType2All && !detailType2Filters.includes(dt2)) return false;
                        }

                        const pureContent = itemObj.content || itemObj.code || '';

                        let parsedCostType = '';
                        const costMatch = pureContent.match(/\[(.*?)\]/);
                        if (costMatch) parsedCostType = costMatch[1];
                        const itemCostType = itemObj.costType || itemObj.itemCost || parsedCostType || '유상';

                        if (costTypeFilters.length === 0) return false;
                        if (!isCostTypeAll && !costTypeFilters.includes(itemCostType)) return false;

                        let matchedItemDetailType = '';
                        const contentsList = pureContent.split(',').map(s => s.replace(/\[.*?\]\s*/g, '').trim());

                        if (itemDetailTypeFilters.length > 0) {
                            let matchFound = false;
                            for (const c of contentsList) {
                                let cleanContent = c.replace(/\[지연\]/g, '').trim();
                                let partsToCheck = [cleanContent];

                                if (cleanContent.includes(' - ')) {
                                    const parts = cleanContent.split(' - ');
                                    partsToCheck = [parts[0].trim()];
                                    if (parts.length > 1) partsToCheck.push(parts[1].trim());
                                }

                                for (const pt of partsToCheck) {
                                    // [수정] 규격(spec) 텍스트 분리 및 제거하여 정확한 매칭 수행
                                    const specMatch = pt.match(/ \[(.*?)\]$/);
                                    if (specMatch) pt = pt.replace(specMatch[0], '');

                                    const matchItem = adminItems.find(ai => ai.part === pt || ai.code === pt);
                                    let dt = (matchItem && matchItem.detailType) ? matchItem.detailType : '미지정';

                                    if (isItemDetailTypeAll || itemDetailTypeFilters.includes(dt)) {
                                        matchedItemDetailType = dt;
                                        matchFound = true;
                                        break;
                                    }
                                }
                                if (matchFound) break;
                            }
                            if (!matchFound) return false;
                        } else {
                            let cleanContent = contentsList[0] || '';
                            cleanContent = cleanContent.replace(/\[지연\]/g, '').trim();
                            if (cleanContent.includes(' - ')) {
                                const parts = cleanContent.split(' - ');
                                cleanContent = parts.length > 1 ? parts[1].trim() : parts[0].trim();
                            }
                              // [수정] 규격(spec) 텍스트 분리 및 제거하여 정확한 매칭 수행
                            const specMatch = cleanContent.match(/ \[(.*?)\]$/);
                            if (specMatch) cleanContent = cleanContent.replace(specMatch[0], '');

                            const matchItem = adminItems.find(ai => ai.part === cleanContent || ai.code === cleanContent);
                            if (matchItem) matchedItemDetailType = matchItem.detailType;
                        }

                        if (!matchedItemDetailType) matchedItemDetailType = '미지정';

                        const workerText = itemObj.worker || '';
                        if (keywordInputVal || keywordSelected.length > 0) {
                            const searchTarget = `${pureContent} ${workerText} ${displayEquipName} ${custEquipName}`.toLowerCase();
                            let isMatch = false;

                            if (keywordSelected.length > 0) {
                                isMatch = keywordSelected.some(kw => searchTarget.includes(kw));
                            } else if (keywordInputVal) {
                                const kws = keywordInputVal.split(/\s+/);
                                isMatch = kws.every(kw => searchTarget.includes(kw));
                            }

                            if (!isMatch) return false;
                        }

                        return {
                            id: itemObj.id,
                            date: itemDate,
                            site: site,
                            building: equipBuilding,
                            equipRaw: equip,
                            equipName: displayEquipName,
                            modelName: equipName,
                            serial: serialNo,
                            custName: custEquipName,
                            type: itemType,
                            detailType: dt2 ? `${dt1} > ${dt2}` : dt1,
                            content: pureContent,
                            worker: workerText,
                            md: itemObj.md || '0',
                            costType: itemCostType,
                            itemDetailType: matchedItemDetailType,
                            status: isLog ? '완료' : '예정',
                            memo: itemObj.memo || ''
                        };
                    } catch (e) {
                        console.error('checkItemMatch Error:', e);
                        return false;
                    }
                };

                // 1. Logs (완료된 유지관리 이력 추출)
                if (detailData.logs) {
                    detailData.logs.forEach(log => {
                        const res = checkItemMatch(log, true);
                        if (res) results.push(res);
                    });
                }

                // 2. Maint (캘린더 예정 작업 추출)
                if (detailData.maint) {
                    detailData.maint.forEach(m => {
                        // 중복 체크 (해당 일자에 이미 로그로 완료 처리된 항목은 예정에서 제외)
                        const isDone = detailData.logs && detailData.logs.some(l => l.date === m.scheduledDate && (l.content || '').includes(m.content || ''));
                        if (isDone) return;

                        const res = checkItemMatch(m, false);
                        if (res) results.push(res);
                    });
                }
            });
        }
    });

    // 날짜 내림차순 정렬, 동일 날짜일 경우 예정(미완료) 먼저 
    results.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        if (dateB !== dateA) return dateB.localeCompare(dateA);
        const statusA = a.status || '';
        const statusB = b.status || '';
        return statusA.localeCompare(statusB);
    });

    renderSortList(results);
    renderSortChart(results);

    // CSV 내보내기 버튼 이벤트는 renderSortListTableOnly에서 필터링된 배열로 다시 연결됩니다.
}

/* ==========================================================================
   5. UI 렌더링 (UI Rendering)
   ========================================================================== */
// [5.1] 검색 결과 리스트 렌더링 준비 (결과 내 텍스트 검색창 생성 및 내보내기 버튼 제어)
function renderSortList(results) {
    window.currentSortResults = results;

    const countBadge = document.getElementById('sort-result-count');

    // [추가] 결과 내 검색창 동적 생성
    if (countBadge) {
        let headerContainer = countBadge.parentElement;
        if (headerContainer && !document.getElementById('sort-inner-search-container')) {
            let searchContainer = document.createElement('div');
            searchContainer.id = 'sort-inner-search-container';
            searchContainer.style.display = 'inline-flex';
            searchContainer.style.marginLeft = '15px';
            searchContainer.style.alignItems = 'center';

            let input = document.createElement('input');
            input.type = 'text';
            input.id = 'sort-inner-search';
            input.className = 'input-dark';
            input.placeholder = '결과 내 텍스트 검색...';
            input.style.padding = '4px 8px';
            input.style.fontSize = '12px';
            input.style.height = '26px';
            input.style.width = '200px';

            input.addEventListener('input', () => {
                renderSortListTableOnly();
            });

            searchContainer.appendChild(input);
            headerContainer.appendChild(searchContainer);
        }
    }

    // [수정] 권한에 따른 CSV 내보내기 버튼 제어 (관리자 이상만)
    const exportBtn = document.getElementById('btn-sort-export');
    if (exportBtn) {
        const userRole = sessionStorage.getItem('userRole');
        if (results.length > 0 && (userRole === 'admin' || userRole === 'superadmin')) {
            exportBtn.style.display = 'block';
        } else {
            exportBtn.style.display = 'none';
        }
    }

    // [추가] 메인 검색(Search) 시 내부 검색창 초기화
    const innerSearch = document.getElementById('sort-inner-search');
    if (innerSearch) innerSearch.value = '';

    renderSortListTableOnly();
}

// [5.2] 검색 결과 테이블 실제 렌더링 (행 Row 생성 및 데이터 매핑)
function renderSortListTableOnly() {
    const tbody = document.getElementById('sort-result-tbody');
    const countBadge = document.getElementById('sort-result-count');
    const innerSearch = document.getElementById('sort-inner-search');
    const keyword = innerSearch ? innerSearch.value.trim().toLowerCase() : '';

    let results = window.currentSortResults || [];

    if (keyword) {
        const keywords = keyword.split(/\s+/);
        results = results.filter(row => {
            const text = `${row.date} ${row.site} ${row.modelName} ${row.equipName} ${row.serial} ${row.custName} ${row.type} ${row.detailType} ${row.content} ${row.costType} ${row.worker} ${row.md} ${row.status} ${row.memo}`.toLowerCase();
            return keywords.every(kw => text.includes(kw));
        });
    }

    if (countBadge) countBadge.textContent = results.length;

    // CSV 내보내기 대상 업데이트
    const exportBtn = document.getElementById('btn-sort-export');
    if (exportBtn) exportBtn.onclick = () => exportSortResultsToCSV(results);

    if (!tbody) return;
    tbody.innerHTML = '';

    if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="list-empty-msg" style="text-align:center; padding: 20px; color:#8b949e;">검색된 결과가 없습니다.</td></tr>';
        return;
    }

    results.forEach(row => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onmouseover = () => tr.style.backgroundColor = '#21262d';
        tr.onmouseout = () => tr.style.backgroundColor = 'transparent';

        // [요청] 장비명 표시를 모델명(약어), 시리얼, 고객사장비명 순으로 3줄로 변경
        let subInfo = '';
        if (row.custName) {
            subInfo = `<div style="color:#3fb950; font-weight:bold; font-size: 12px; margin-top: 2px;">[${escapeHtml(row.custName)}]</div>`;
        } else if (row.serial) {
            subInfo = `<div style="color:#3fb950; font-weight:bold; font-size: 12px; margin-top: 2px;">[${escapeHtml(row.serial)}]</div>`;
        }
        let equipDisplayHtml = `<div>${escapeHtml(row.equipName)}</div>${subInfo}`;

        let detailHtml = escapeHtml(row.detailType);
        if (row.detailType && row.detailType.includes(' > ')) {
            const parts = row.detailType.split(' > ');
            detailHtml = `<div>${escapeHtml(parts[0])}</div><div style="color:#8b949e; font-size: 12px; margin-top: 2px;">${escapeHtml(parts[1])}</div>`;
        }

        const badgeClass = row.type ? row.type.replace(/\s/g, '') : 'default';
        const statusColor = row.status === '완료' ? '#3fb950' : '#d29922';

        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${escapeHtml(row.site)}</td>
            <td>${escapeHtml(row.modelName)}</td>
            <td style="text-align: left; padding-left: 10px;">${equipDisplayHtml}</td>
            <td><span class="badge ${badgeClass}" style="padding: 2px 6px; font-size: 11px;">${escapeHtml(row.type)}</span></td>
            <td style="text-align: left; padding-left: 10px;">${detailHtml}</td>
            <td style="text-align: left; padding-left: 10px;">${escapeHtml(row.content)}</td>
            <td>${escapeHtml(row.costType)}</td>
            <td title="${escapeHtml(row.worker)}">${escapeHtml(row.worker) || '-'}</td>
            <td>${escapeHtml(row.md)}</td>
            <td style="color: ${statusColor}; font-weight: bold;">${row.status}</td>
        `;

        tr.onclick = () => {
            // [수정] 작업이 완료된 로그일 경우 해당 로그 ID를 파라미터로 넘겨 상세 팝업이 바로 뜨도록 연동
            let url = `maintenance.html?site=${encodeURIComponent(row.site)}&equip=${encodeURIComponent(row.equipRaw)}`;
            if (row.status === '완료' && row.id) url += `&logId=${row.id}`;
            window.location.href = url;
        };

        tbody.appendChild(tr);
    });
}

// [5.3] 검색 결과 통계 데이터 집계 및 하단 막대 차트 렌더링
function renderSortChart(results) {
    const container = document.getElementById('sort-chart-container');
    const yAxisContainer = document.getElementById('sort-y-axis');
    const partLegend = document.getElementById('sort-part-legend');
    const solContainer = document.getElementById('sort-solution-chart-container');
    const solYAxis = document.getElementById('sort-solution-y-axis');
    const solLegend = document.getElementById('sort-solution-legend');
    const typeContainer = document.getElementById('sort-type-chart-container');
    const typeYAxis = document.getElementById('sort-type-y-axis');
    const typeLegend = document.getElementById('sort-type-legend');

    const detailTypeContainer = document.getElementById('sort-detail-type-chart-container');
    const detailTypeYAxis = document.getElementById('sort-detail-type-y-axis');
    const detailTypeLegend = document.getElementById('sort-detail-type-legend');

    const detailType2Container = document.getElementById('sort-detail-type2-chart-container');
    const detailType2YAxis = document.getElementById('sort-detail-type2-y-axis');
    const detailType2Legend = document.getElementById('sort-detail-type2-legend');

    const irregularContainer = document.getElementById('sort-irregular-chart-container');
    const irregularYAxis = document.getElementById('sort-irregular-y-axis');
    const irregularLegend = document.getElementById('sort-irregular-legend');

    if (!container) return;

    container.innerHTML = '';
    if (yAxisContainer) yAxisContainer.innerHTML = '';
    if (partLegend) partLegend.innerHTML = '';
    if (solContainer) solContainer.innerHTML = '';
    if (solYAxis) solYAxis.innerHTML = '';
    if (solLegend) solLegend.innerHTML = '';
    if (typeContainer) typeContainer.innerHTML = '';
    if (typeYAxis) typeYAxis.innerHTML = '';
    if (typeLegend) typeLegend.innerHTML = '';
    if (detailTypeContainer) detailTypeContainer.innerHTML = '';
    if (detailTypeYAxis) detailTypeYAxis.innerHTML = '';
    if (detailTypeLegend) detailTypeLegend.innerHTML = '';
    if (detailType2Container) detailType2Container.innerHTML = '';
    if (detailType2YAxis) detailType2YAxis.innerHTML = '';
    if (detailType2Legend) detailType2Legend.innerHTML = '';
    if (irregularContainer) irregularContainer.innerHTML = '';
    if (irregularYAxis) irregularYAxis.innerHTML = '';
    if (irregularLegend) irregularLegend.innerHTML = '';

    if (results.length === 0) {
        container.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (solContainer) solContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (typeContainer) typeContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (detailTypeContainer) detailTypeContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (detailType2Container) detailType2Container.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        if (irregularContainer) irregularContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">검색된 결과가 없습니다.</div>';
        return;
    }

    const partSiteCounts = {};
    const solSiteCounts = {};
    const typeSiteCounts = {
        '정기': {},
        '비정기': {},
        '고객대응': {},
        '용액제조': {},
        '온라인점검': {}
    };
    const detailTypeSiteCounts = {};
    const detailType2SiteCounts = {};
    const irregularSiteCounts = {};
    const allSites = new Set();
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    // [추가] 비정기 점검 항목 고정 리스트 (이 항목들만 차트에 표시)
    const allowedIrregularItems = [
        "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
        "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
    ];

    results.forEach(row => {
        // [수정] 통계 차트에는 작업이 '완료'된 내역만 포함하도록 필터링
        if (row.status !== '완료') return;

        if (row.content) {
            const items = row.content.split(',').map(s => s.trim());
            items.forEach(item => {
                let pureItem = item.replace(/\[.*?\]\s*/g, '').trim();
                if (pureItem.includes(' - ')) {
                    const parts = pureItem.split(' - ');
                    pureItem = parts.length > 1 ? parts[1].trim() : parts[0].trim();
                }
                if (pureItem) {
                    const cleanContent = pureItem.replace(/\[지연\]/g, '').trim();
                    let targetContent = cleanContent;
                    
                    // [수정] 규격(spec) 텍스트 분리 및 제거하여 정확한 매칭 수행
                    const specMatch = targetContent.match(/ \[(.*?)\]$/);
                    if (specMatch) targetContent = targetContent.replace(specMatch[0], '');

                    const matchItem = adminItems.find(ai => ai.part === targetContent || ai.code === targetContent);
                    const itemDetailType = matchItem ? matchItem.detailType : '';

                    // 물품 관리에 등록된 항목만 파츠/용액 교체 현황 차트에 표시
                    if (matchItem) {
                        const targetKey = matchItem.code || matchItem.part || targetContent; // 동일 물품 누적을 위해 코드명 우선 사용
                        if (itemDetailType === '용액') {
                            if (!solSiteCounts[targetKey]) solSiteCounts[targetKey] = {};
                            solSiteCounts[targetKey][row.site] = (solSiteCounts[targetKey][row.site] || 0) + 1;
                        } else {
                            if (!partSiteCounts[targetKey]) partSiteCounts[targetKey] = {};
                            partSiteCounts[targetKey][row.site] = (partSiteCounts[targetKey][row.site] || 0) + 1;
                        }
                    }
                }
            });
        }

        // 점검 구분 및 사업장별 데이터 수집
        if (row.type && row.site) {
            if (!typeSiteCounts[row.type]) typeSiteCounts[row.type] = {};
            typeSiteCounts[row.type][row.site] = (typeSiteCounts[row.type][row.site] || 0) + 1;
            allSites.add(row.site);
        }

        // 세부구분 1, 2 파싱 및 사업장별 데이터 수집
        let dt1 = row.detailType || '';
        let dt2 = '';
        if (dt1.includes(' > ')) {
            const ps = dt1.split(' > ');
            dt1 = ps[0].trim();
            dt2 = ps[1].trim();
        }
        if (dt1 && row.site) {
            if (!detailTypeSiteCounts[dt1]) detailTypeSiteCounts[dt1] = {};
            detailTypeSiteCounts[dt1][row.site] = (detailTypeSiteCounts[dt1][row.site] || 0) + 1;
        }
        if (dt2 && row.site) {
            if (!detailType2SiteCounts[dt2]) detailType2SiteCounts[dt2] = {};
            detailType2SiteCounts[dt2][row.site] = (detailType2SiteCounts[dt2][row.site] || 0) + 1;
        }

        // 비정기 점검 항목(내용) 파싱 및 사업장별 데이터 수집
        if (row.type === '비정기' && row.content) {
            const items = row.content.split(',').map(s => s.trim());
            items.forEach(item => {
                let pureItem = item.replace(/\[.*?\]\s*/g, '').trim();
                if (pureItem.includes(' - ')) {
                    pureItem = pureItem.split(' - ')[0].trim();
                }
                // [수정] 지정된 10가지 비정기 항목만 필터링하여 차트에 집계
                if (pureItem && row.site && allowedIrregularItems.includes(pureItem)) {
                    if (!irregularSiteCounts[pureItem]) irregularSiteCounts[pureItem] = {};
                    irregularSiteCounts[pureItem][row.site] = (irregularSiteCounts[pureItem][row.site] || 0) + 1;
                }
            });
        }
    });

    // 사업장별 그룹 차트를 그리는 공통 헬퍼 함수
    const drawGroupedChart = (dataObj, targetContainer, targetYAxis, targetLegend, allSitesArray) => {
        if (!targetContainer || !targetYAxis) return;

        let localSelectedSite = null;
        let isGrouped = false; // [추가] 그룹화 상태 변수

        // [추가] 카드 제목 클릭 시 그룹/개별 보기 전환 이벤트 등록
        const card = targetContainer.closest('.sort-half-chart, .sort-full-chart');
        if (card) {
            const titleEl = card.querySelector('h3, .card-title, .status-group-title') || card.firstElementChild;
            if (titleEl && !titleEl.dataset.clickBound) {
                titleEl.dataset.clickBound = 'true';
                titleEl.style.cursor = 'pointer';
                titleEl.title = '클릭 시 그룹/개별 보기 전환';
                titleEl.addEventListener('click', () => {
                    isGrouped = !isGrouped;
                    localSelectedSite = null; // 뷰 전환 시 개별 막대 선택 해제
                    renderInner();
                });
            }
        }

        const renderInner = () => {
            let currentDataObj = dataObj;
            let currentSitesArray = allSitesArray;

            // [추가] 그룹화 로직 적용
            if (isGrouped) {
                const groupedDataObj = {};
                const groupedSitesSet = new Set();
                
                Object.keys(dataObj).forEach(category => {
                    groupedDataObj[category] = {};
                    Object.keys(dataObj[category]).forEach(site => {
                        let groupName = '기타 사업장';
                        if (site === 'SKH 이천' || site === 'SKH 청주') groupName = site;
                        else if (site === 'SEC 평택 본사' || site === 'SEC 화성 본사') groupName = '기타 사업장';
                        else if (site && site.includes('SEC')) groupName = 'SEC';
                        
                        groupedSitesSet.add(groupName);
                        groupedDataObj[category][groupName] = (groupedDataObj[category][groupName] || 0) + dataObj[category][site];
                    });
                });
                
                currentDataObj = groupedDataObj;
                const order = ['SEC', 'SKH 이천', 'SKH 청주', '기타 사업장'];
                currentSitesArray = order.filter(name => groupedSitesSet.has(name));
                Array.from(groupedSitesSet).forEach(name => {
                    if (!order.includes(name)) currentSitesArray.push(name);
                });
            }

            let maxCount = 0;
            const activeSitesInChart = new Set();
            Object.values(currentDataObj).forEach(siteObj => {
                Object.entries(siteObj).forEach(([site, val]) => {
                    if (val > 0) activeSitesInChart.add(site);
                    if (localSelectedSite && site !== localSelectedSite) return;
                    if (val > maxCount) maxCount = val;
                });
            });

            if (maxCount === 0) {
                targetContainer.innerHTML = '<div class="list-empty-msg" style="width: 100%; text-align: center; margin-top: auto; margin-bottom: auto;">표시할 데이터가 없습니다.</div>';
                if (targetLegend) targetLegend.innerHTML = ''; // 범례도 비움
                if (targetYAxis) targetYAxis.innerHTML = ''; // Y축도 비움
                return;
            }

            let yAxisMax = 10;
            if (maxCount > 10) yAxisMax = Math.ceil(maxCount / 5) * 5;

            if (targetYAxis) {
                targetYAxis.innerHTML = ''; // Y축 비우기
                for (let i = 0; i <= 5; i++) {
                    const val = Math.round((yAxisMax / 5) * i);
                    const div = document.createElement('div');
                    div.textContent = val;
                    targetYAxis.appendChild(div);
                }
            }

            const siteColors = ['#1f6feb', '#3fb950', '#d29922', '#8957e5', '#da3633', '#f0883e', '#0078d4', '#8b949e'];
            const siteColorMap = {};

            // [추가] 그룹화 시 지정된 고유 색상 적용
            if (isGrouped) {
                currentSitesArray.forEach(site => {
                    if (site === 'SEC') siteColorMap[site] = '#034EA2'; // 파랑
                    else if (site === 'SKH 이천') siteColorMap[site] = '#eb371f'; // 빨강
                    else if (site === 'SKH 청주') siteColorMap[site] = '#F37021'; // 주황
                    else siteColorMap[site] = '#8957e5'; // 보라 (기타 사업장)
                });
            } else {
                currentSitesArray.forEach((site, idx) => {
                    siteColorMap[site] = siteColors[idx % siteColors.length];
                });
            }

            if (targetLegend) targetLegend.innerHTML = '';
            currentSitesArray.forEach((site) => {
                if (targetLegend && activeSitesInChart.has(site)) {
                    const isFaded = localSelectedSite && localSelectedSite !== site;
                    const legDiv = document.createElement('div');
                    legDiv.className = 'legend-item';
                    if (isFaded) legDiv.classList.add('faded');
                    legDiv.innerHTML = `<div class="legend-color-box" style="background:${siteColorMap[site]};"></div><span title="${escapeHtml(site)}">${escapeHtml(site)}</span>`;
                    legDiv.onclick = () => {
                        if (localSelectedSite === site) {
                            localSelectedSite = null; // 토글 해제 (전체 보기)
                        } else {
                            localSelectedSite = site; // 개별 보기
                        }
                        renderInner(); // 해당 차트만 재렌더링
                    };
                    targetLegend.appendChild(legDiv);
                }
            });

            // [수정] 수량/건수가 많은 항목부터 내림차순으로 정렬
            const sortedCategories = Object.keys(currentDataObj).map(category => {
                let currentTotal = 0;
                currentSitesArray.forEach(site => {
                    if (localSelectedSite && localSelectedSite !== site) return;
                    currentTotal += (currentDataObj[category][site] || 0);
                });
                return { category, total: currentTotal };
            }).sort((a, b) => {
                if (b.total !== a.total) return b.total - a.total; // 1차 정렬: 수량 많은 순
                return (a.category || '').localeCompare(b.category || ''); // 2차 정렬: 수량이 같으면 가나다순 (Null 에러 방어)
            }).map(item => item.category);

            targetContainer.innerHTML = '';
            sortedCategories.forEach(category => {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'sort-bar-group type-group';
                const trackDiv = document.createElement('div');
                trackDiv.className = 'bar-track';
                let totalInGroup = 0;

                currentSitesArray.forEach(site => {
                    if (localSelectedSite && localSelectedSite !== site) return;

                    const count = currentDataObj[category][site] || 0;
                    if (count > 0) {
                        totalInGroup++;
                        const heightPct = (count / yAxisMax) * 100;
                        const bgStyle = siteColorMap[site];
                        const barWrapper = document.createElement('div');
                        barWrapper.className = 'multi-bar-wrapper';
                        barWrapper.title = `${escapeHtml(site)}: ${count}`;
                        barWrapper.innerHTML = `<div class="bar-value">${count}</div><div class="bar" style="height: ${heightPct}%; background: ${bgStyle};"></div>`;
                        trackDiv.appendChild(barWrapper);
                    }
                });

                const labelDiv = document.createElement('div');
                labelDiv.className = 'bar-label';
                labelDiv.textContent = escapeHtml(category);
                labelDiv.title = escapeHtml(category);
                groupDiv.appendChild(trackDiv);
                groupDiv.appendChild(labelDiv);
                if (totalInGroup > 0) targetContainer.appendChild(groupDiv);
            });
        };

        renderInner();
    };

    const sitesArray = Array.from(allSites).sort();
    drawGroupedChart(partSiteCounts, container, yAxisContainer, partLegend, sitesArray);
    drawGroupedChart(solSiteCounts, solContainer, solYAxis, solLegend, sitesArray);
    drawGroupedChart(typeSiteCounts, typeContainer, typeYAxis, typeLegend, sitesArray);
    drawGroupedChart(detailTypeSiteCounts, detailTypeContainer, detailTypeYAxis, detailTypeLegend, sitesArray);
    drawGroupedChart(detailType2SiteCounts, detailType2Container, detailType2YAxis, detailType2Legend, sitesArray);
    drawGroupedChart(irregularSiteCounts, irregularContainer, irregularYAxis, irregularLegend, sitesArray);
}

/* ==========================================================================
   6. 데이터 내보내기 및 헬퍼 (Export & Helpers)
   ========================================================================== */
// [6.1] 검색된 결과를 CSV 파일 양식으로 변환 및 다운로드 추출
function exportSortResultsToCSV(results) {
    let csvContent = '\uFEFF';
    csvContent += '날짜,상태,사업장,건물명,모델명,장비명(약어),Serial No,고객사 장비명,구분,세부구분,물품상세구분,작업내용,비용처리,작업자,공수,상세메모\n';

    results.forEach(row => {
        const cols = [
            row.date,
            row.status,
            row.site,
            row.building,
            row.modelName,
            row.equipName,
            row.serial,
            row.custName,
            row.type,
            row.detailType,
            row.itemDetailType,
            row.content,
            row.costType,
            row.worker,
            row.md,
            row.memo
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');

        csvContent += cols + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SORT_작업조회결과_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// [6.2] 보안: XSS 공격 방지용 HTML 텍스트 이스케이프 헬퍼
function escapeHtml(text) {
    if (!text) return text;
    return String(text).replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}