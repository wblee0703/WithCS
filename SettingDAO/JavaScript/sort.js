window.isSortPageRestoring = false;
/* ==========================================================================
   1. 초기화 (Initialization)
   ========================================================================== */
// [추가] 프론트엔드 작업 보안 감사 로그 백엔드 전송 함수
function logActionToServer(action, details, target = "") {
    fetch('/api/log/action', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrf_token')
        },
        body: JSON.stringify({ action: action, details: details, target: target })
    }).catch(err => console.error('Failed to log action to server:', err));
}

// [1.1] DOM 로드 시 초기화 및 외부 클릭 감지
document.addEventListener('DOMContentLoaded', () => {
    // [추가] 페이지 로드 즉시 필터 캐시 존재 시 복원 락을 미리 활성화하여 타이밍 오염 방지
    try {
        const lastSortFilters = localStorage.getItem('lastSortFilters');
        if (lastSortFilters) {
            window.isSortPageRestoring = true;
        }
    } catch (e) { }

    if (window.isDataLoaded) {
        initSortPage();
    } else {
        window.addEventListener('DataLoaded', initSortPage);
    }

    // 드롭다운 외부 클릭 시 닫기
    const closeDropdownsOnOutsideClick = (e) => {
        document.querySelectorAll('.log-select-dropdown').forEach(d => {
            const wrapper = d.closest('.log-select-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                d.style.display = 'none';
                d.classList.remove('show');
            }
        });
    };
    document.addEventListener('click', closeDropdownsOnOutsideClick);
    document.addEventListener('touchstart', closeDropdownsOnOutsideClick, { passive: true });
});

// [1.2] 로컬 데이터 안전 조회 헬퍼: 모든 형태의 로컬 데이터를 안전하게 병합하여 가져옴
function getSortDeviceData() {
    // 100% DB 동기화 방식에 맞춰 localStorage의 순수 device_data 맵핑 객체만 사용
    return JSON.parse(localStorage.getItem('device_data')) || {};
}

// [1.4] 전체 선택 상태인지 판별하는 공통 헬퍼 함수
function isAllSelected(selectId, filtersArray) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return false;
    const validOptions = Array.from(selectEl.options).filter(o => o.value);
    if (validOptions.length === 0) return true; // 옵션이 없으면 전체 통과로 간주
    return filtersArray && filtersArray.length >= validOptions.length;
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
            window.isSortPageRestoring = true;
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
                        } else {
                            el.classList.remove('selected');
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
                    const sites = getMultiValues('sort-site-select');
                    updateSortBuildingSelect(sites);
                    applyCustomMultiSelect('sort-building-select', lastSortFilters.buildingFilters);
                    const buildings = getMultiValues('sort-building-select');

                    updateSortModelSelect(sites, buildings, data);
                    applyCustomMultiSelect('sort-model-select', lastSortFilters.modelFilters);
                    const models = getMultiValues('sort-model-select');

                    updateSortEquipSelect(sites, buildings, models, data);
                    applyCustomMultiSelect('sort-equip-select', lastSortFilters.equipFilters);

                    applyCustomMultiSelect('sort-type-select', lastSortFilters.typeFilters);
                    const types = getMultiValues('sort-type-select');

                    updateSortDetailTypeSelect(types);
                    applyCustomMultiSelect('sort-detail-type-select', lastSortFilters.detailTypeFilters);
                    const detailTypes = getMultiValues('sort-detail-type-select');

                    updateSortDetailType2Select(types, detailTypes);
                    applyCustomMultiSelect('sort-detail-type2-select', lastSortFilters.detailType2Filters);
                    const detailType2s = getMultiValues('sort-detail-type2-select');

                    updateSortDetailType3Select(types, detailTypes, detailType2s);
                    applyCustomMultiSelect('sort-detail-type3-select', lastSortFilters.detailType3Filters);

                    applyCustomMultiSelect('sort-cost-type-select', lastSortFilters.costTypeFilters);
                    applyCustomMultiSelect('sort-item-detail-type-select', lastSortFilters.itemDetailTypeFilters);

                    if (lastSortFilters.keywordSelected !== undefined) {
                        const kwList = document.getElementById('sort-keyword-list');
                        if (kwList) {
                            kwList.querySelectorAll('.log-select-item').forEach(el => {
                                if (lastSortFilters.keywordSelected.includes((el.dataset.value || '').toLowerCase())) {
                                    el.classList.add('selected');
                                } else {
                                    el.classList.remove('selected');
                                }
                            });
                            updateKeywordTrigger();
                        }
                    }

                    // [요청] 마지막 검색 결과 자동 복원 기능 삭제 (Sort Menu 필터 상태만 유지하고 검색 결과는 대기 상태 유지)
                    window.isSortPageRestoring = false;
                } catch (e) {
                    console.error('Filter restore error:', e);
                    window.isSortPageRestoring = false;
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
    data = getSortDeviceData(); // [수정] 위에서 선언된 let data 변수를 재사용하여 SyntaxError(중복 선언) 방지
    const sites = Object.keys(data);
    updateSortBuildingSelect(sites);
    updateSortModelSelect(sites, [], data); // 건물 전체
    updateSortEquipSelect(sites, [], [], data); // 모델 전체

    // 구분, 세부구분 초기화
    const types = ['정기', '비정기', '고객대응', '용액제조', '온라인점검'];
    updateSortDetailTypeSelect(types);
    updateSortDetailType2Select(types, []);
    updateSortDetailType3Select(types, [], []);
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
window.getMultiValues = getMultiValues;

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

        let extraHeader = '';
        if (selectId === 'sort-equip-select') {
            const groups = ['전체', 'SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타'];
            let btns = groups.map(g => `<button type="button" class="btn-gray equip-group-filter-btn sort-filter-btn" data-group="${g}">${g}</button>`).join('');
            extraHeader = `<div id="equip-group-filter-container" class="sort-group-filter-container">${btns}</div>`;
        } else if (selectId === 'sort-site-select') {
            const siteGroups = ['SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타'];
            let btns = siteGroups.map(g => `<button type="button" class="btn-gray site-group-toggle-btn sort-filter-btn" data-group="${g}">${g}</button>`).join('');
            extraHeader = `<div id="site-group-toggle-container" class="sort-group-filter-container">${btns}</div>`;
        }

        const tpl = typeof getTemplateContent === 'function' ? getTemplateContent('sort-multi-select-template') : null;
        if (tpl) {
            const clone = tpl.firstElementChild.cloneNode(true);
            const trigger = clone.querySelector('.log-select-trigger');
            trigger.id = `${selectId}-trigger`;
            trigger.dataset.placeholder = placeholder;
            trigger.textContent = placeholder;

            const dropdown = clone.querySelector('.log-select-dropdown');
            dropdown.id = `${selectId}-dropdown`;
            if (extraHeader) dropdown.insertAdjacentHTML('afterbegin', extraHeader);

            const list = clone.querySelector('.log-select-list');
            list.id = `${selectId}-list`;

            wrapper.appendChild(clone);
        }
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
            selectAllBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); // 포커스 아웃 방지
                e.stopPropagation();
                list.querySelectorAll('.log-select-item').forEach(el => {
                    if (el.style.display !== 'none') {
                        el.classList.add('selected');
                    }
                });
                updateTriggerText();
                selectEl.dispatchEvent(new Event('change'));
            });
        }

        if (deselectAllBtn) {
            deselectAllBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); // 포커스 아웃 방지
                e.stopPropagation();
                list.querySelectorAll('.log-select-item').forEach(el => {
                    if (el.style.display !== 'none') {
                        el.classList.remove('selected');
                    }
                });
                updateTriggerText();
                selectEl.dispatchEvent(new Event('change'));
            });
        }

        if (selectId === 'sort-equip-select') {
            const filterBtns = wrapper.querySelectorAll('.equip-group-filter-btn');
            const targetList = wrapper.querySelector(`#${selectId}-list`);
            filterBtns.forEach(btn => {
                btn.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetGroup = btn.dataset.group;

                    filterBtns.forEach(b => {
                        if (b === btn) { b.classList.remove('btn-gray'); b.classList.add('btn-blue-sm'); }
                        else { b.classList.remove('btn-blue-sm'); b.classList.add('btn-gray'); }
                    });

                    targetList.querySelectorAll('.log-select-item').forEach(item => {
                        if (targetGroup === '전체' || item.dataset.siteGroup === targetGroup) {
                            item.style.display = 'flex';
                        } else {
                            item.style.display = 'none';
                        }
                    });
                });
            });

            const defaultBtn = wrapper.querySelector('.equip-group-filter-btn[data-group="전체"]');
            if (defaultBtn) {
                defaultBtn.classList.remove('btn-gray');
                defaultBtn.classList.add('btn-blue-sm');
            }
        } else if (selectId === 'sort-site-select') {
            const toggleBtns = wrapper.querySelectorAll('.site-group-toggle-btn');
            const targetList = wrapper.querySelector(`#${selectId}-list`);
            toggleBtns.forEach(btn => {
                btn.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetGroup = btn.dataset.group;

                    const groupItems = Array.from(targetList.querySelectorAll('.log-select-item')).filter(item => item.dataset.siteGroup === targetGroup);
                    if (groupItems.length === 0) return;

                    const allSelected = groupItems.every(item => item.classList.contains('selected'));

                    groupItems.forEach(el => {
                        if (allSelected) {
                            el.classList.remove('selected');
                        } else {
                            el.classList.add('selected');
                        }
                    });

                    updateTriggerText();
                    selectEl.dispatchEvent(new Event('change'));
                });
            });
        }



        confirmBtn.addEventListener('pointerdown', (e) => {
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
        list.innerHTML = '<div class="list-empty-msg sort-dropdown-empty">항목이 없습니다.</div>';
        wrapper.dataset.knownValues = '[]';
    } else {
        const currentValues = [];
        let activeGroup = '전체';
        if (selectId === 'sort-equip-select') {
            const activeBtn = wrapper.querySelector('.equip-group-filter-btn.btn-blue-sm');
            if (activeBtn) activeGroup = activeBtn.dataset.group;
        }

        options.forEach(opt => {
            const val = opt.value;
            const text = opt.textContent;
            currentValues.push(val);
            const div = document.createElement('div');
            div.className = 'log-select-item';
            div.dataset.value = val;
            const siteGroup = opt.dataset.siteGroup || '기타사업장';
            div.dataset.siteGroup = siteGroup;

            if (activeGroup !== '전체' && siteGroup !== activeGroup) {
                div.style.display = 'none';
            } else {
                div.style.display = 'flex';
            }

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

            const itemTpl = typeof getTemplateContent === 'function' ? getTemplateContent('sort-select-item-template') : null;
            if (itemTpl) {
                // [수정] 템플릿 자체에 log-select-item 클래스가 있어 중첩(2배 뻥튀기)되는 현상 방지
                div.innerHTML = itemTpl.firstElementChild.innerHTML;
                const icon = div.querySelector('.check-icon');
                if (icon) icon.remove();
                const textEl = div.querySelector('.item-text');
                if (textEl) textEl.textContent = text;
            } else {
                div.innerHTML = `<span class="item-text sort-item-text" style="flex: 1; padding-left: 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(text)}</span>`;
            }

            div.addEventListener('pointerdown', (e) => {
                e.preventDefault(); // 클릭 시 포커스 잃음(blur) 방지로 클릭 이벤트 보장
                e.stopPropagation();
                div.classList.toggle('selected');
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

    wrapper.updateTriggerText = updateTriggerText; // [추가] 외부(전체 선택 버튼 등)에서 트리거 텍스트를 업데이트할 수 있도록 노출
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

        let siteGroup = '기타사업장';
        try {
            const metaData = JSON.parse(localStorage.getItem(`site_meta_${site}`));
            if (metaData && metaData.group) siteGroup = metaData.group;
        } catch (e) { }

        const opt = document.createElement('option');
        opt.value = site;
        opt.dataset.siteGroup = siteGroup;
        opt.textContent = `[${siteGroup}] ${site}`;
        siteSelect.appendChild(opt);
    });

    siteSelect.addEventListener('change', (e) => {
        const sites = getMultiValues('sort-site-select');
        updateSortBuildingSelect(sites);
        const buildings = getMultiValues('sort-building-select');
        updateSortModelSelect(sites, buildings, data);
        const models = getMultiValues('sort-model-select');
        updateSortEquipSelect(sites, buildings, models, data);
    });

    if (buildingSelect) {
        buildingSelect.addEventListener('change', (e) => {
            const sites = getMultiValues('sort-site-select');
            const buildings = getMultiValues('sort-building-select');
            updateSortModelSelect(sites, buildings, data);
            const models = getMultiValues('sort-model-select');
            updateSortEquipSelect(sites, buildings, models, data);
        });
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', (e) => {
            const sites = getMultiValues('sort-site-select');
            const buildings = getMultiValues('sort-building-select');
            const models = getMultiValues('sort-model-select');
            updateSortEquipSelect(sites, buildings, models, data);
        });
    }

    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            updateKeywordSuggestions();
            const types = getMultiValues('sort-type-select');
            updateSortDetailTypeSelect(types);
        });
    }

    if (detailTypeSelect) {
        detailTypeSelect.addEventListener('change', () => {
            const types = getMultiValues('sort-type-select');
            const detailTypes = getMultiValues('sort-detail-type-select');
            updateSortDetailType2Select(types, detailTypes);
            const detailType2s = getMultiValues('sort-detail-type2-select');
            updateSortDetailType3Select(types, detailTypes, detailType2s);
        });
    }

    const detailType2Select = document.getElementById('sort-detail-type2-select');
    if (detailType2Select) {
        detailType2Select.addEventListener('change', () => {
            const types = getMultiValues('sort-type-select');
            const detailTypes = getMultiValues('sort-detail-type-select');
            const detailType2s = getMultiValues('sort-detail-type2-select');
            updateSortDetailType3Select(types, detailTypes, detailType2s);
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
        flexWrapper.className = 'sort-period-flex-wrapper';

        periodType.parentElement.insertBefore(flexWrapper, periodType);

        periodType.classList.remove('full-width', 'mb-5');
        periodType.classList.add('sort-period-type');
        flexWrapper.appendChild(periodType);

        if (monthInput) {
            monthInput.classList.remove('mt-10');
            monthInput.classList.add('sort-period-input');
            flexWrapper.appendChild(monthInput);
        }
        if (yearInput) {
            yearInput.classList.remove('mt-10');
            yearInput.classList.add('sort-period-input');
            flexWrapper.appendChild(yearInput);
        }
        if (customInput) {
            customInput.classList.remove('mt-10');
            customInput.classList.add('sort-period-custom');
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
            }
            else if (e.target.value === 'year') {
                if (yearInput) yearInput.style.display = 'block';
            }
            else {
                if (customInput) customInput.style.display = 'flex';
            }
        });
    }

    // 필터 메뉴 초기화 (모든 옵션 로드)
    // 초기 커스텀 다중 선택 UI 동기화
    syncCustomMultiSelect('sort-site-select', '전체 사업장');
    syncCustomMultiSelect('sort-building-select', '전체 건물');
    syncCustomMultiSelect('sort-equip-select', '전체 장비');
    syncCustomMultiSelect('sort-model-select', '전체 모델');
    syncCustomMultiSelect('sort-type-select', '전체 구분');
    syncCustomMultiSelect('sort-detail-type-select', '전체 세부 구분');
    syncCustomMultiSelect('sort-detail-type2-select', '전체 세부 구분 2');
    syncCustomMultiSelect('sort-detail-type3-select', '전체 세부 구분 3');
    syncCustomMultiSelect('sort-item-detail-type-select', '전체 물품 상세');
    syncCustomMultiSelect('sort-cost-type-select', '전체 비용 처리');

    setupSortKeyword();
    addGlobalSelectAllButton(); // [수정] 단일 전체선택 버튼 생성
}

// [추가] 모든 필터를 한 번에 '전체선택'으로 변경하는 단일 버튼 추가
function addGlobalSelectAllButton() {
    const sidebar = document.querySelector('.dashboard-sidebar');
    if (!sidebar || document.getElementById('btn-global-select-all')) return;

    const btn = document.createElement('button');
    btn.id = 'btn-global-select-all';
    btn.type = 'button';
    btn.className = 'btn-blue-sm';
    btn.textContent = '전체 선택';
    btn.style.cssText = 'padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; margin-left: auto;';

    btn.onclick = async (e) => {
        e.preventDefault();

        // 연쇄 필터(사업장->건물->장비 등) 업데이트를 고려하여 순차적으로 선택 이벤트 발생
        const selectAllFor = (selectId) => {
            return new Promise(resolve => {
                const wrapper = document.getElementById(`${selectId}-wrapper`);
                const selectEl = document.getElementById(selectId);
                if (wrapper && selectEl && !selectEl.disabled) {
                    const list = wrapper.querySelector('.log-select-list');
                    if (list) {
                        list.querySelectorAll('.log-select-item').forEach(el => {
                            if (el.style.display !== 'none') {
                                el.classList.add('selected');

                                // [추가] 원본 옵션 동기화 보장
                                Array.from(selectEl.options).forEach(o => {
                                    if (o.value === el.dataset.value) o.selected = true;
                                });
                            }
                        });
                        if (typeof wrapper.updateTriggerText === 'function') wrapper.updateTriggerText();
                        selectEl.dispatchEvent(new Event('change'));
                    }
                }
                setTimeout(resolve, 40); // [수정] UI 렌더링 및 연쇄 옵션 생성이 완벽히 끝날 때까지 대기 시간 확보
            });
        };

        // 상위부터 하위 종속 순서로 실행
        await selectAllFor('sort-site-select');
        await selectAllFor('sort-building-select');
        await selectAllFor('sort-model-select');
        await selectAllFor('sort-equip-select');
        await selectAllFor('sort-type-select');
        await selectAllFor('sort-detail-type-select');
        await selectAllFor('sort-detail-type2-select');
        await selectAllFor('sort-detail-type3-select');
        await selectAllFor('sort-item-detail-type-select');
        await selectAllFor('sort-cost-type-select');

        // [추가] 항목/내용 검색 드롭다운(키워드 리스트) 전체 선택 적용
        const keywordList = document.getElementById('sort-keyword-list');
        if (keywordList) {
            keywordList.querySelectorAll('.log-select-item').forEach(el => {
                if (el.style.display !== 'none') {
                    el.classList.add('selected');
                }
            });
            if (typeof updateKeywordTrigger === 'function') updateKeywordTrigger();
        }
    };

    // [수정] 'Sort Menu' 제목을 찾아 우측에 버튼 배치
    let targetHeader = null;
    const headings = sidebar.querySelectorAll('h1, h2, h3, h4, h5, h6, .sidebar-title');
    for (let h of headings) {
        if (h.textContent.includes('Sort Menu') || h.textContent.includes('SORT')) {
            targetHeader = h;
            break;
        }
    }

    if (targetHeader) {
        targetHeader.style.display = 'flex';
        targetHeader.style.justifyContent = 'space-between';
        targetHeader.style.alignItems = 'center';
        targetHeader.appendChild(btn);
    } else {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = 'flex-end';
        wrapper.style.marginBottom = '10px';
        wrapper.appendChild(btn);
        sidebar.insertBefore(wrapper, sidebar.firstChild);
    }
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
            selectAllBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const list = document.getElementById('sort-keyword-list');
                if (list) {
                    list.querySelectorAll('.log-select-item').forEach(el => {
                        if (el.style.display !== 'none') {
                            el.classList.add('selected');
                        }
                    });
                    updateKeywordTrigger();
                }
            });
        }

        if (deselectBtn) {
            deselectBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const list = document.getElementById('sort-keyword-list');
                if (list) {
                    list.querySelectorAll('.log-select-item').forEach(el => {
                        el.classList.remove('selected');
                    });
                    updateKeywordTrigger();
                }
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('pointerdown', (e) => {
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

    const isInitialized = keywordList.dataset.initialized === 'true';
    keywordList.dataset.initialized = 'true';

    const suggestionItems = [
        "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
        "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
    ];

    // [추가] 관리자가 등록한 전체 물품 DB(admin_items)를 제안 박스에 병합하여 검색 편의성 강화
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    adminItems.forEach(item => {
        const displayName = item.code || item.part; // [수정] 물품명 대신 코드명 우선 노출
        if (displayName && !suggestionItems.includes(displayName)) {
            suggestionItems.push(displayName);
        }
    });

    const currentSelected = Array.from(keywordList.querySelectorAll('.log-select-item.selected')).map(el => el.dataset.value);
    keywordList.innerHTML = '';

    Array.from(suggestionItems).sort().forEach(content => {
        const div = document.createElement('div');
        div.className = 'log-select-item';

        let isSelected = false;
        if (!isInitialized) {
            isSelected = true; // [개선] 초기 상태에서는 전체 선택이 기본값으로 동작하도록 수정
        } else {
            isSelected = currentSelected.includes(content);
        }

        if (isSelected) div.classList.add('selected');
        div.dataset.value = content;

        const itemTpl = typeof getTemplateContent === 'function' ? getTemplateContent('sort-select-item-template') : null;
        if (itemTpl) {
            div.innerHTML = itemTpl.firstElementChild.innerHTML;
            const icon = div.querySelector('.check-icon');
            if (icon) icon.remove();
            const textEl = div.querySelector('.item-text');
            if (textEl) textEl.textContent = content;
        } else {
            div.innerHTML = `<span class="item-text sort-item-text" style="flex: 1; padding-left: 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(content)}</span>`;
        }
        div.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            div.classList.toggle('selected');
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
    const total = list ? list.querySelectorAll('.log-select-item').length : 0;

    if (total > 0 && selected.length === total) {
        input.value = '';
        input.placeholder = '항목/내용 검색 (전체)';
        input.style.color = '#e6edf3';
        input.title = '전체 선택됨';
    } else if (selected.length > 0) {
        const uniqueSelected = Array.from(new Set(selected.map(el => el.dataset.value)));
        const text = uniqueSelected.join(', ');
        input.value = uniqueSelected.length > 1 ? `${uniqueSelected[0]} 외 ${uniqueSelected.length - 1}개` : text;
        input.style.color = '#58a6ff';
        input.title = uniqueSelected.join('\n');
    } else {
        input.value = '';
        input.placeholder = '선택 없음';
        input.style.color = '#8b949e';
        input.title = '';
    }
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

// [3.5.5] 사업장, 건물 선택에 따른 모델명 필터 항목 동적 업데이트
function updateSortModelSelect(sites, buildings, data) {
    const modelSelect = document.getElementById('sort-model-select');
    if (!modelSelect) return;

    modelSelect.innerHTML = '<option value="">전체 모델</option>';
    if (!sites || sites.length === 0) {
        modelSelect.disabled = true;
        syncCustomMultiSelect('sort-model-select', '전체 모델');
        return;
    }

    const isBuildingAll = isAllSelected('sort-building-select', buildings);
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    let availableModels = new Set();

    sites.forEach(site => {
        if (!data[site] || !Array.isArray(data[site])) return;
        data[site].forEach(equip => {
            const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
            const setup = detailData.setup || {};
            const equipBuilding = setup.building ? setup.building : '미지정';

            if (!isBuildingAll && buildings && buildings.length > 0 && !buildings.includes(equipBuilding)) return;

            const parts = equip.split('::');
            const equipName = parts[0];
            if (equipName) {
                const matchedModel = equipmentModels.find(m => m.name === equipName || m.abbr === equipName);
                const modelAbbr = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;
                availableModels.add(modelAbbr);
            }
        });
    });

    Array.from(availableModels).sort().forEach(modelAbbr => {
        const opt = document.createElement('option');
        opt.value = modelAbbr;
        opt.textContent = modelAbbr;
        modelSelect.appendChild(opt);
    });

    modelSelect.disabled = false;
    syncCustomMultiSelect('sort-model-select', '전체 모델');
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

    const isBuildingAll = isAllSelected('sort-building-select', buildings);
    const isModelAll = isAllSelected('sort-model-select', models);

    // 장비 모델 약어 매핑 (ADMIN 정보 연동)
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];

    sites.forEach(site => {
        if (!data[site] || !Array.isArray(data[site])) return;

        let siteGroup = '기타사업장';
        try {
            const metaData = JSON.parse(localStorage.getItem(`site_meta_${site}`));
            if (metaData && metaData.group) siteGroup = metaData.group;
        } catch (e) { }

        data[site].forEach(equip => {
            if (typeof equip !== 'string') return;
            const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
            const setup = detailData.setup || {};

            const equipBuilding = setup.building ? setup.building : '미지정';
            if (!isBuildingAll && buildings && buildings.length > 0 && !buildings.includes(equipBuilding)) return;

            const parts = equip.split('::');
            const equipName = parts[0];
            const matchedModel = equipmentModels.find(m => m.name === equipName || m.abbr === equipName);
            const modelAbbr = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;
            if (!isModelAll && models && models.length > 0 && !models.includes(modelAbbr)) return;

            const serialNo = parts.length > 1 ? parts[1] : '';
            const displayName = modelAbbr;

            const custEquipName = setup.custEquipName || '';
            let displayText = displayName;
            if (custEquipName) {
                displayText += ` [${custEquipName}]`;
            } else if (serialNo) {
                displayText += ` (${serialNo})`;
            }

            const opt = document.createElement('option');
            opt.value = equip;
            opt.dataset.siteGroup = siteGroup;
            opt.textContent = sites.length > 1 ? `${site} - ${displayText}` : displayText;
            equipSelect.appendChild(opt);
        });
    });
    equipSelect.disabled = false;
    syncCustomMultiSelect('sort-equip-select', '전체 장비');
}

// [3.7] 점검 구분에 따른 세부 구분 1 필터 항목 동적 업데이트
function updateSortDetailTypeSelect(types) {
    const detailTypeSelect = document.getElementById('sort-detail-type-select');
    if (!detailTypeSelect) return;

    detailTypeSelect.innerHTML = '<option value="">전체 세부 구분</option>';

    if (!types || types.length === 0) {
        detailTypeSelect.disabled = true;
        syncCustomMultiSelect('sort-detail-type-select', '전체 세부 구분');
        updateSortDetailType2Select([], []);
        return;
    }

    detailTypeSelect.disabled = false;

    const catData = JSON.parse(localStorage.getItem('check_type_categories')) || {};
    let subCategories = new Set();

    const defaultSubCategories = {
        '정기': ['PM 점검'],
        '비정기': ['Alarm', 'Hunting', 'Data / Para 이상', '기타'],
        '고객대응': ['순회 점검', '프로그램 변경 / 평가', '설비 평가', '파티클 필터 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '기타'],
        '용액제조': ['용액제조'],
        '온라인점검': ['온라인점검']
    };

    types.forEach(type => {
        if (defaultSubCategories[type]) {
            defaultSubCategories[type].forEach(cat => subCategories.add(cat));
        }
        Object.keys(catData).forEach(key => {
            if (key.includes(`::${type}`)) {
                catData[key].forEach(cat => subCategories.add(cat));
            }
        });
    });

    Array.from(subCategories).sort().forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        detailTypeSelect.appendChild(opt);

    });
    syncCustomMultiSelect('sort-detail-type-select', '전체 세부 구분');

    updateSortDetailType2Select(types, getMultiValues('sort-detail-type-select'));
}

// [3.8] '비정기' 점검 구분 선택 시 세부 구분 2 필터 표시 및 항목 동적 업데이트
function updateSortDetailType2Select(types, detailTypes) {
    const detailType2Group = document.getElementById('sort-detail-type2-group');
    const detailType2Select = document.getElementById('sort-detail-type2-select');

    if (!detailType2Select) return;
    detailType2Select.innerHTML = '<option value="">전체 세부 구분 2</option>';

    const isTypeAll = isAllSelected('sort-type-select', types);
    const includesIrregular = isTypeAll || (types && types.includes('비정기'));

    if (!types || types.length === 0 || !includesIrregular) {
        if (detailType2Group) detailType2Group.style.display = 'none';
        detailType2Select.disabled = true;
        syncCustomMultiSelect('sort-detail-type2-select', '전체 세부 구분 2');
        return;
    }
    if (detailType2Group) detailType2Group.style.display = 'block';

    detailType2Select.disabled = false;

    const catData2 = JSON.parse(localStorage.getItem('check_type_categories2')) || {};
    let subCategories2 = new Set();

    // [추가] 세부구분2 기본값 (사용자 정의 데이터가 없을 경우를 대비)
    const defaultSubCategories2 = {
        'Alarm': ['HPLC_알람', 'MFC(Flow)_알람', 'AUTOSOL_알람', '리크센서_알람', 'OVERFLOW_알람', 'ETC_알람', '액추에이터_알람', 'LoadPort_알람', '검출기_알람', 'MCU_알람'],
        'Hunting': ['Air Peak_헌팅', 'HPLC_헌팅', 'Flow_헌팅', 'WD_헌팅', 'BASE_헌팅', 'ETC_헌팅'],
        'Data / Para 이상': ['REF_PORT', 'RT_흔들림', 'HPLC 압력변동', '에어 유량 변동', '미지피크_발생', '콤플렉스_피크', '프로그램_오류', '베이스 값 이상', 'Data 변동', 'Data 전송 이슈', '딜리버리펌프_이슈', '클리닝펌프_이슈', '용액 이슈'],
        '기타': ['배수 펌프 이슈', '구동 이상']
    };

    const isDetailTypeAll = isAllSelected('sort-detail-type-select', detailTypes);

    if (isDetailTypeAll || !detailTypes || detailTypes.length === 0) {
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
    syncCustomMultiSelect('sort-detail-type2-select', '전체 세부 구분 2');
    const detailType2s = getMultiValues('sort-detail-type2-select');
    updateSortDetailType3Select(types, detailTypes, detailType2s);
}

// [3.9] '비정기' 세부 구분 3 필터 항목 동적 업데이트 및 표시
function updateSortDetailType3Select(types, detailTypes, detailType2s) {
    const detailType3Group = document.getElementById('sort-detail-type3-group');
    const detailType3Select = document.getElementById('sort-detail-type3-select');

    if (!detailType3Select) return;
    detailType3Select.innerHTML = '<option value="">전체 세부 구분 3</option>';

    const isTypeAll = isAllSelected('sort-type-select', types);
    const includesIrregular = isTypeAll || (types && types.includes('비정기'));

    if (!types || types.length === 0 || !includesIrregular) {
        if (detailType3Group) detailType3Group.style.display = 'none';
        detailType3Select.disabled = true;
        syncCustomMultiSelect('sort-detail-type3-select', '전체 세부 구분 3');
        return;
    }
    if (detailType3Group) detailType3Group.style.display = 'block';

    detailType3Select.disabled = false;

    const catData3 = JSON.parse(localStorage.getItem('check_type_categories3')) || {};
    let subCategories3 = new Set();

    // 비정기 세부구분3 기본값
    const defaultSubCategories3 = [
        "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
        "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
    ];

    const isDetailType2All = isAllSelected('sort-detail-type2-select', detailType2s);

    if (isDetailType2All || !detailType2s || detailType2s.length === 0) {
        defaultSubCategories3.forEach(cat => subCategories3.add(cat));
        Object.keys(catData3).forEach(key => {
            if (key.includes('::비정기::')) catData3[key].forEach(cat => subCategories3.add(cat));
        });
    } else {
        detailType2s.forEach(dt2 => {
            defaultSubCategories3.forEach(cat => subCategories3.add(cat));
            Object.keys(catData3).forEach(key => {
                if (key.includes(`::비정기::`) && key.includes(dt2)) {
                    catData3[key].forEach(cat => subCategories3.add(cat));
                }
            });
        });
    }

    Array.from(subCategories3).sort().forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        detailType3Select.appendChild(opt);
    });
    syncCustomMultiSelect('sort-detail-type3-select', '전체 세부 구분 3');
}

/* ==========================================================================
   4. 이벤트 및 검색 로직 (Events & Search Logic)
   ========================================================================== */
// [4.1] 검색 버튼 클릭 및 엔터키 이벤트 설정
function setupSortEvents() {
    const searchBtn = document.getElementById('btn-sort-search');
    const keywordInput = document.getElementById('sort-keyword');
    const toggleBtn = document.getElementById('btn-toggle-sort-menu');
    const formContainer = document.getElementById('sort-menu-form-container');
    const chartsBody = document.getElementById('sort-charts-body');
    const resultBody = document.getElementById('sort-result-body');

    const expandMobileCards = () => {
        if (window.innerWidth <= 950) {
            // 1. 데이터 통계(차트) 영역 자동 펼침
            if (chartsBody) {
                chartsBody.style.display = 'flex';
                const card = chartsBody.closest('.card');
                if (card) {
                    const collapseBtn = card.querySelector('.btn-collapse');
                    if (collapseBtn) collapseBtn.innerHTML = '▲';
                }
            }
            // 2. 검색 결과 테이블 영역 자동 펼침
            if (resultBody) {
                resultBody.style.display = 'block';
                const card = resultBody.closest('.card');
                if (card) {
                    const collapseBtn = card.querySelector('.btn-collapse');
                    if (collapseBtn) collapseBtn.innerHTML = '▲';
                }
            }
        }
    };

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            performSortSearch();
            // 모바일 환경(너비 950px 이하)일 때만 "검색 및 정렬" 클릭 시 폼을 접어줍니다.
            if (window.innerWidth <= 950 && formContainer) {
                formContainer.style.display = 'none';
                if (toggleBtn) toggleBtn.textContent = '펼치기';
            }
            expandMobileCards();
        });
    }
    if (keywordInput) keywordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSortSearch();
            // 모바일 환경 엔터 검색 시에도 자동으로 폼을 접어줍니다.
            if (window.innerWidth <= 950 && formContainer) {
                formContainer.style.display = 'none';
                if (toggleBtn) toggleBtn.textContent = '펼치기';
            }
            expandMobileCards();
        }
    });

    if (toggleBtn && formContainer) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = formContainer.style.display === 'none';
            formContainer.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? '접기' : '펼치기';
        });
    }
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
    const detailType3Filters = getMultiValues('sort-detail-type3-select');
    const itemDetailTypeFilters = getMultiValues('sort-item-detail-type-select');
    const costTypeFilters = getMultiValues('sort-cost-type-select');
    window.chartSelectedSiteFilter = null; // [추가] 새 검색 시 차트 범례 필터 초기화
    const keywordInputEl = document.getElementById('sort-keyword');
    const keywordInputVal = keywordInputEl ? keywordInputEl.value.trim().toLowerCase() : '';
    const keywordList = document.getElementById('sort-keyword-list');
    const keywordItemEls = keywordList ? Array.from(keywordList.querySelectorAll('.log-select-item')) : [];
    const keywordSelected = keywordItemEls.filter(el => el.classList.contains('selected')).map(el => (el.dataset.value || '').toLowerCase());

    const isKeywordAll = keywordItemEls.length > 0 && keywordSelected.length === keywordItemEls.length;
    const isKeywordNone = keywordItemEls.length > 0 && keywordSelected.length === 0;

    let manualKeyword = keywordInputVal;
    if (keywordSelected.length > 0) {
        const firstKw = keywordSelected[0];
        if (keywordSelected.length > 1 && manualKeyword.includes('외') && manualKeyword.includes('개') && manualKeyword.startsWith(firstKw)) {
            manualKeyword = ''; // 드롭다운 자동 생성 문구는 수동 타이핑 검색어에서 제외
        } else if (keywordSelected.length === 1 && manualKeyword === firstKw) {
            manualKeyword = '';
        }
    }
    const isSiteAll = isAllSelected('sort-site-select', siteFilters);
    const isBuildingAll = isAllSelected('sort-building-select', buildingFilters);
    const isModelAll = isAllSelected('sort-model-select', modelFilters);
    const isEquipAll = isAllSelected('sort-equip-select', equipFilters);
    const isTypeAll = isAllSelected('sort-type-select', typeFilters);
    const isDetailTypeAll = isAllSelected('sort-detail-type-select', detailTypeFilters);
    const isDetailType2All = isAllSelected('sort-detail-type2-select', detailType2Filters);
    const isDetailType3All = isAllSelected('sort-detail-type3-select', detailType3Filters);
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
        detailType3Filters: detailType3Filters,
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
        if (!isSiteAll && siteFilters.length === 0) return; // 사용자가 명시적으로 모두 해제한 경우 패스
        if (!isSiteAll && !siteFilters.includes(site)) return; // 전체 선택이 아닐 때만 포함 여부 검사

        let siteGroup = '기타사업장';
        try {
            const metaData = JSON.parse(localStorage.getItem(`site_meta_${site}`));
            if (metaData && metaData.group) siteGroup = metaData.group;
        } catch (e) { }

        if (data[site]) {
            data[site].forEach(equip => {
                if (typeof equip !== 'string') return;
                if (!isEquipAll && equipFilters.length === 0) return;
                if (!isEquipAll && !equipFilters.includes(equip)) return;

                const parts = equip.split('::');
                const equipName = parts[0];
                const matchedModel = equipmentModels.find(m => m.name === equipName || m.abbr === equipName);
                const displayEquipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : equipName;

                if (!isModelAll && modelFilters.length === 0) return;
                if (!isModelAll && !modelFilters.includes(displayEquipName)) return;

                const serialNo = parts.length > 1 ? parts[1] : '';

                const key = `details_${site}_${equip}`;
                const detailData = JSON.parse(localStorage.getItem(key)) || {};
                const custEquipName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';
                const equipBuilding = (detailData.setup && detailData.setup.building) ? detailData.setup.building : '미지정';
                const equipStatus = (detailData.setup && detailData.setup.equipStatus) ? detailData.setup.equipStatus : '';

                // [추가] 셋업 장비는 데이터 통계 및 검색에서 완전히 제외 (셋업 작업 물품/공수 혼동 방지)
                if (equipStatus === '셋업 장비') return;

                if (!isBuildingAll && buildingFilters.length === 0) return;
                if (!isBuildingAll && !buildingFilters.includes(equipBuilding)) return;

                const checkItemMatch = (itemObj, isLog) => {
                    try {
                        const itemDate = isLog ? itemObj.date : itemObj.scheduledDate;
                        if (!itemDate) return false;
                        if (isLog && itemObj.detailType === '일정변경') return false;

                        const itemType = itemObj.type || '정기'; // 구버전 데이터 누락 대응
                        if (!isTypeAll && typeFilters.length === 0) return false;
                        if (!isTypeAll && !typeFilters.includes(itemType)) return false;
                        if (startDate && itemDate < startDate) return false;
                        if (endDate && itemDate > endDate) return false;

                        let dt1 = itemObj.detailType || (itemType === '정기' ? 'PM 점검' : 'BM 점검');
                        let dt2 = itemObj.detailType2 || '';
                        let dt3 = '';

                        let allParts = [];
                        if (dt1.includes(' > ')) {
                            allParts = dt1.split(' > ').map(p => p.trim());
                        } else if (dt2.includes(' > ')) {
                            allParts = dt2.split(' > ').map(p => p.trim());
                        } else {
                            allParts = [dt1.trim()];
                            if (dt2) allParts.push(dt2.trim());
                        }

                        dt1 = allParts[0] || '';
                        dt2 = allParts[1] || '';
                        dt3 = allParts[2] || '';

                        if (!dt2) dt2 = '미지정';
                        if (!dt3) dt3 = '미지정';

                        if (!isDetailTypeAll && detailTypeFilters.length === 0) return false;
                        if (!isDetailTypeAll && !detailTypeFilters.includes(dt1)) return false;
                        if (itemType === '비정기') {
                            if (!isDetailType2All && detailType2Filters.length === 0) return false;
                            if (!isDetailType2All && !detailType2Filters.includes(dt2)) return false;
                            if (!isDetailType3All && detailType3Filters.length === 0) return false;
                            if (!isDetailType3All && !detailType3Filters.includes(dt3)) return false;
                        }

                        const pureContent = itemObj.content || itemObj.code || '';

                        const workerText = itemObj.worker || '';

                        let baseParsedCostType = '';
                        const baseCostMatch = pureContent.match(/\[(.*?)\]/);
                        if (baseCostMatch) baseParsedCostType = baseCostMatch[1];
                        const rowCostType = itemObj.costType || itemObj.itemCost || baseParsedCostType || '유상';

                        if (!isCostTypeAll && costTypeFilters.length === 0) return false;
                        if (!isItemDetailTypeAll && itemDetailTypeFilters.length === 0) return false;

                        const rawItemsList = window.splitSafetyContent(pureContent);
                        let matchedRawItems = [];
                        let matchedItemDetailType = '';

                        const mapPartToCode = (rawItem) => {
                            if (!rawItem) return '';
                            let costPrefix = '';
                            let rest = rawItem.trim();
                            const costMatch = rest.match(/^\[(.*?)\]\s*(.*)$/);
                            if (costMatch) {
                                costPrefix = `[${costMatch[1]}] `;
                                rest = costMatch[2].trim();
                            }

                            let prefix = '';
                            let purePart = rest;
                            if (rest.includes(' - ')) {
                                const parts = rest.split(' - ');
                                prefix = parts[0].trim() + ' - ';
                                purePart = parts[1].trim();
                            }

                            let spec = '';
                            const specMatch = purePart.match(/ \[(.*?)\]$/) || purePart.match(/\[(.*?)\]$/);
                            if (specMatch) {
                                spec = specMatch[0];
                                purePart = purePart.replace(specMatch[0], '').trim();
                            }

                            const matchItem = adminItems.find(ai => ai.part === purePart || ai.code === purePart);
                            const displayPart = (matchItem && matchItem.code) ? matchItem.code : purePart;

                            return `${costPrefix}${prefix}${displayPart}${spec}`;
                        };

                        const rowSearchTargetBase = `${workerText} ${displayEquipName} ${serialNo} ${custEquipName} ${siteGroup} ${site} ${equipBuilding} ${itemType} ${dt1} ${dt2} ${itemObj.memo || ''}`.toLowerCase();

                        for (const rawItem of rawItemsList) {
                            let isItemMatch = true;

                            // 1. 개별 아이템의 비용 처리 필터
                            let itemCostType = rowCostType;
                            const itemCostMatch = rawItem.match(/^\[(.*?)\]/);
                            if (itemCostMatch) itemCostType = itemCostMatch[1];

                            if (!isCostTypeAll && !costTypeFilters.includes(itemCostType)) {
                                isItemMatch = false;
                            }

                            // [추가] 셋업 작업 관련 물품/공수 혼동 방지를 위해 '무상(셋업)' 등 셋업 물품 제외
                            if (itemCostType === '무상(셋업)' || itemCostType.includes('셋업')) {
                                isItemMatch = false;
                            }

                            // 2. 개별 아이템의 세부 구분(물품 상세) 필터
                            let cleanContent = rawItem.replace(/\[.*?\]\s*/g, '').replace(/\[지연\]/g, '').trim();
                            let partsToCheck = [cleanContent];
                            if (cleanContent.includes(' - ')) {
                                const parts = cleanContent.split(' - ');
                                partsToCheck = [parts[0].trim()];
                                if (parts.length > 1) partsToCheck.push(parts[1].trim());
                            }

                            let itemDt = '미지정';
                            let itemKeywords = itemObj.code || '';

                            for (let pt of partsToCheck) {
                                const specMatch = pt.match(/ \[(.*?)\]$/);
                                if (specMatch) pt = pt.replace(specMatch[0], '');

                                const matchItem = adminItems.find(ai => ai.part === pt || ai.code === pt);
                                if (matchItem) {
                                    let dt = matchItem.detailType;
                                    if (dt === '선택 안함' || dt === '') dt = '미지정';
                                    itemDt = dt;
                                    itemKeywords += ` ${matchItem.code || ''} ${matchItem.partno || ''} ${matchItem.part || ''}`;
                                    break;
                                }
                            }

                            if (!isItemDetailTypeAll && itemDetailTypeFilters.length > 0) {
                                const isMatchDt = itemDetailTypeFilters.includes(itemDt) || (itemDt === '미지정' && itemDetailTypeFilters.some(f => f.includes('미지정')));
                                if (!isMatchDt) {
                                    isItemMatch = false;
                                }
                            }

                            // 3. 개별 아이템의 텍스트(키워드) 필터
                            if (isItemMatch) {
                                if (isKeywordNone && !manualKeyword) {
                                    isItemMatch = false;
                                } else if (!isKeywordAll || manualKeyword) {
                                    // [개선] 매뉴얼 키워드(타이핑)일 때는 전체 정보를 검색하고, 
                                    // 드롭다운 선택 키워드일 때는 물품 관련 정보에 대해서만 엄격하게 매칭하여, 
                                    // 선택 해제된 항목이 사업장명('기타사업장' 등)과 같은 다른 메타데이터와 겹쳐서 필터링을 우회하는 현상 차단
                                    const globalSearchTarget = `${rawItem} ${cleanContent} ${itemKeywords} ${itemCostType} ${itemDt} ${rowSearchTargetBase}`.toLowerCase();
                                    const itemSpecificTarget = `${rawItem} ${cleanContent} ${itemKeywords} ${itemCostType} ${itemDt}`.toLowerCase();

                                    if (manualKeyword) {
                                        const kws = manualKeyword.split(/\s+/);
                                        if (!kws.every(kw => globalSearchTarget.includes(kw))) {
                                            isItemMatch = false;
                                        }
                                    } else if (keywordSelected.length > 0) {
                                        if (!keywordSelected.some(kw => itemSpecificTarget.includes(kw))) {
                                            isItemMatch = false;
                                        }
                                    }
                                }
                            }

                            if (isItemMatch) {
                                matchedRawItems.push(mapPartToCode(rawItem));
                                if (!matchedItemDetailType) matchedItemDetailType = itemDt;
                            }
                        }

                        if (matchedRawItems.length === 0) return false;

                        if (!matchedItemDetailType) matchedItemDetailType = '미지정';

                        let finalCostType = rowCostType;
                        const firstMatchedCostMatch = matchedRawItems[0].match(/^\[(.*?)\]/);
                        if (firstMatchedCostMatch) finalCostType = firstMatchedCostMatch[1];

                        let finalContent = matchedRawItems.join(', ');

                        return {
                            id: itemObj.id,
                            date: itemDate,
                            siteGroup: siteGroup,
                            site: site,
                            building: equipBuilding,
                            equipRaw: equip,
                            equipName: displayEquipName,
                            modelName: displayEquipName,
                            serial: serialNo,
                            custName: custEquipName,
                            type: itemType,
                            detailType: dt3 && dt3 !== '미지정' ? `${dt1} > ${dt2} > ${dt3}` : (dt2 && dt2 !== '미지정' ? `${dt1} > ${dt2}` : dt1),
                            detailType3: dt3,
                            content: finalContent,
                            worker: workerText,
                            md: itemObj.md || '0',
                            costType: finalCostType,
                            itemDetailType: matchedItemDetailType,
                            status: isLog ? '완료' : '예정',
                            memo: itemObj.memo || '',
                            originalLogId: itemObj.originalLogId || null
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

                // [수정] SORT 검색 결과에는 '완료'된 작업만 표시되도록 예정 작업(Maint) 추출 부분 제외
                // // 2. Maint (캘린더 예정 작업 추출)
                // if (detailData.maint) {
                //     detailData.maint.forEach(m => {
                //         // 중복 체크 (해당 일자에 이미 로그로 완료 처리된 항목은 예정에서 제외)
                //         const isDone = detailData.logs && detailData.logs.some(l => l.date === m.scheduledDate && (l.content || '').includes(m.content || ''));
                //         if (isDone) return;
                // 
                //         const res = checkItemMatch(m, false);
                //         if (res) results.push(res);
                //     });
                // }
            });
        }
    });

    // [추가] 장비, 날짜, 상태, 구분, 세부구분이 동일한 작업 물품 항목들을 하나의 행(Row)으로 병합
    const groupedResultsMap = new Map();
    results.forEach(item => {
        const groupKey = (item.type === '비정기')
            ? `${item.equipRaw}_${item.date}_${item.status}_${item.type}_${item.detailType}_${item.id}`
            : `${item.equipRaw}_${item.date}_${item.status}_${item.type}_${item.detailType}`;

        if (!groupedResultsMap.has(groupKey)) {
            groupedResultsMap.set(groupKey, { ...item });
        } else {
            const existing = groupedResultsMap.get(groupKey);

            // 내용(물품) 병합
            const existingContents = window.splitSafetyContent(existing.content);
            const newContents = window.splitSafetyContent(item.content);
            newContents.forEach(c => {
                if (!existingContents.includes(c)) existingContents.push(c);
            });
            existing.content = existingContents.join(', ');

            // 작업자 병합
            const existingWorkers = existing.worker ? existing.worker.split(',').map(s => s.trim()).filter(Boolean) : [];
            const newWorkers = item.worker ? item.worker.split(',').map(s => s.trim()).filter(Boolean) : [];
            newWorkers.forEach(w => {
                if (!existingWorkers.includes(w)) existingWorkers.push(w);
            });
            existing.worker = existingWorkers.join(', ');

            // 공수 병합 (가장 큰 값 기준 적용)
            const md1 = parseFloat(existing.md) || 0;
            const md2 = parseFloat(item.md) || 0;
            existing.md = Math.max(md1, md2).toString();

            // 비용 처리 병합
            if (item.costType && item.costType !== existing.costType) {
                const existingCosts = existing.costType.split(',').map(s => s.trim());
                if (!existingCosts.includes(item.costType)) {
                    existingCosts.push(item.costType);
                    existing.costType = existingCosts.join(', ');
                }
            }
        }
    });
    results = Array.from(groupedResultsMap.values());

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
        let headerContainer = countBadge.closest('.card-header') || countBadge.parentElement;
        if (headerContainer && !document.getElementById('sort-inner-search-container')) {
            let searchContainer = document.createElement('div');
            searchContainer.id = 'sort-inner-search-container';
            searchContainer.className = 'sort-inner-search-container';
            searchContainer.style.display = 'flex';
            searchContainer.style.alignItems = 'center';
            searchContainer.style.gap = '8px';

            let input = document.createElement('input');
            input.type = 'text';
            input.id = 'sort-inner-search';
            input.className = 'input-dark';
            input.placeholder = '결과 내 텍스트 검색...';
            input.style.flex = '1';
            input.style.minWidth = '0';

            input.addEventListener('input', () => {
                renderSortListTableOnly();
            });

            // 결과 내 검색용 CSV 다운로드 버튼 동적 생성
            let innerExportBtn = document.createElement('button');
            innerExportBtn.type = 'button';
            innerExportBtn.id = 'btn-sort-export-inner';
            innerExportBtn.className = 'btn-green';
            innerExportBtn.textContent = '작업이력 다운로드';
            innerExportBtn.style.padding = '4px 8px';
            innerExportBtn.style.fontSize = '11px';
            innerExportBtn.style.margin = '0';
            innerExportBtn.style.width = 'auto';
            innerExportBtn.style.height = 'auto';
            innerExportBtn.style.minWidth = '0';
            innerExportBtn.style.whiteSpace = 'nowrap';
            innerExportBtn.style.flexShrink = '0';

            searchContainer.appendChild(input);
            searchContainer.appendChild(innerExportBtn);
            headerContainer.appendChild(searchContainer);
        }
    }

    // [수정] 권한에 따른 CSV 내보내기 버튼 제어 (관리자 이상만)
    const exportBtn = document.getElementById('btn-sort-export');
    const innerExportBtn = document.getElementById('btn-sort-export-inner');
    const userRole = sessionStorage.getItem('userRole');
    const showExport = results.length > 0 && (userRole === 'admin' || userRole === 'superadmin');

    if (exportBtn) {
        exportBtn.style.display = showExport ? 'inline-block' : 'none';
    }
    if (innerExportBtn) {
        innerExportBtn.style.display = showExport ? 'inline-block' : 'none';
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

    // [추가] 차트 범례 라벨 클릭 시 해당 사업장 데이터만 테이블에 필터링
    if (window.chartSelectedSiteFilter) {
        results = results.filter(row =>
            row.site === window.chartSelectedSiteFilter ||
            row.siteGroup === window.chartSelectedSiteFilter
        );
    }

    if (keyword) {
        const keywords = keyword.split(/\s+/);
        results = results.filter(row => {
            const text = `${row.date} ${row.siteGroup} ${row.site} ${row.modelName} ${row.equipName} ${row.serial} ${row.custName} ${row.type} ${row.detailType} ${row.content} ${row.costType} ${row.worker} ${row.md} ${row.status} ${row.memo}`.toLowerCase();
            return keywords.every(kw => text.includes(kw));
        });
    }

    if (countBadge) countBadge.textContent = results.length;

    // CSV 내보내기 대상 업데이트
    const exportBtn = document.getElementById('btn-sort-export');
    const innerExportBtn = document.getElementById('btn-sort-export-inner');
    if (exportBtn) exportBtn.onclick = () => exportSortResultsToCSV(results);
    if (innerExportBtn) innerExportBtn.onclick = () => exportSortResultsToCSV(results);

    if (!tbody) return;
    tbody.innerHTML = '';


    if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="list-empty-msg sort-empty-row">검색된 결과가 없습니다.</td></tr>';
        return;
    }

    results.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = 'sort-result-row';

        // [요청] 장비명 표시를 모델명(약어), 시리얼, 고객사장비명 순으로 3줄로 변경
        let subInfo = '';
        if (row.custName) {
            subInfo = `<div class="equip-sub-info">[${escapeHtml(row.custName)}]</div>`;
        } else if (row.serial) {
            subInfo = `<div class="equip-sub-info">[${escapeHtml(row.serial)}]</div>`;
        }
        let equipDisplayHtml = `<div>${escapeHtml(row.equipName)}</div>${subInfo}`;

        let detail1 = '';
        let detail2 = '';
        let detail3 = '';
        if (row.detailType && row.detailType.includes(' > ')) {
            const parts = row.detailType.split(' > ');
            detail1 = parts[0].trim();
            detail2 = parts[1] ? parts[1].trim() : '-';
            detail3 = parts[2] ? parts[2].trim() : '-';
        } else {
            detail1 = row.detailType || '';
            detail2 = '-';
            detail3 = '-';
        }
        if (row.detailType3) detail3 = row.detailType3;

        // [요청] 작업내용과 작업 상세 내용 통합 및 비정기 세부구분 3 분리 처리
        const rawContent = row.content || '';
        const itemsList = window.splitSafetyContent(rawContent);
        const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

        let workContentList = [];

        itemsList.forEach(item => {
            let cleanItem = item.replace(/^\[[^\]]+\]\s*/g, '').trim();
            let costTag = '';
            const costMatch = item.match(/^\[([^\]]+)\]/);
            if (costMatch) costTag = `[${costMatch[1]}] `;

            let kwLabel = '';
            let purePart = cleanItem;

            if (cleanItem.includes(' - ')) {
                const parts = cleanItem.split(' - ');
                kwLabel = parts[0].trim();
                purePart = parts.slice(1).join(' - ').trim();
            } else {
                const defaultKeywords = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상", "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"];
                if (defaultKeywords.includes(cleanItem)) {
                    kwLabel = cleanItem;
                    purePart = '';
                }
            }

            if (row.type === '비정기' && kwLabel && (detail3 === '-' || !detail3)) {
                detail3 = kwLabel;
            }

            let displayPart = purePart;
            if (purePart) {
                let specStr = '';
                const specMatch = purePart.match(/\s*\[(.*?)\]$/);
                if (specMatch) {
                    specStr = specMatch[0];
                    purePart = purePart.replace(specMatch[0], '').trim();
                }

                const matchItem = adminItems.find(ai => (ai.part || '').trim().toLowerCase() === purePart.toLowerCase() || (ai.code || '').trim().toLowerCase() === purePart.toLowerCase());
                if (matchItem && matchItem.code) {
                    displayPart = `${matchItem.code}${specStr}`;
                } else {
                    displayPart = `${purePart}${specStr}`;
                }
            }

            let finalWorkItem = displayPart ? `${costTag}${displayPart}`.trim() : (kwLabel && row.type !== '비정기' ? `${costTag}${kwLabel}` : '');
            if (finalWorkItem && finalWorkItem !== '-') {
                workContentList.push(finalWorkItem);
            }
        });

        if (workContentList.length === 0) {
            workContentList.push('-');
        }

        // HTML 태그 렌더링용 (품목 1개당 1줄씩 표시)
        const workContentDisplayHtml = workContentList.map(w => `<div style="line-height: 1.4; padding: 2px 0;">${escapeHtml(w)}</div>`).join('');

        const badgeClass = row.type ? row.type.replace(/\s/g, '') : 'default';
        const statusClass = row.status === '완료' ? 'status-complete' : 'status-pending';

        let siteDisplayHtml = `<div class="site-group-text">${escapeHtml(row.siteGroup)}</div><div class="site-name">${escapeHtml(row.site)}</div>`;

        const handleSortRowClick = () => {
            const targetId = row.id || row.content;
            const isCompleted = (row.status === '완료');
            if (typeof window.openEventDetailModal === 'function') {
                window.openEventDetailModal(row.site, row.equipRaw, targetId, isCompleted);
            } else if (typeof openEventDetailModal === 'function') {
                openEventDetailModal(row.site, row.equipRaw, targetId, isCompleted);
            }
        };

        // 작업자 포맷 헬퍼 함수
        const getFormattedWorker = (workerStr) => {
            if (!workerStr) return '-';
            const workers = workerStr.split(/[,\s]+/).map(w => w.trim()).filter(Boolean);
            if (workers.length === 0) return '-';
            if (workers.length === 1) return workers[0];
            return `${workers[0]}외 ${workers.length - 1}명`;
        };

        const rowTpl = typeof getTemplateContent === 'function' ? getTemplateContent('sort-table-row-template') : null;
        if (rowTpl) {
            const clone = rowTpl.firstElementChild.cloneNode(true);
            clone.querySelector('.col-date').textContent = row.date;
            clone.querySelector('.col-site').innerHTML = siteDisplayHtml;
            clone.querySelector('.col-equip').innerHTML = equipDisplayHtml;
            clone.querySelector('.col-type').innerHTML = `<span class="badge ${badgeClass} sort-badge">${escapeHtml(row.type)}</span>`;
            clone.querySelector('.col-detail1').textContent = detail1;
            clone.querySelector('.col-detail2').textContent = detail2;
            if (clone.querySelector('.col-detail3')) clone.querySelector('.col-detail3').textContent = detail3;
            clone.querySelector('.col-content').innerHTML = workContentDisplayHtml;
            clone.querySelector('.col-cost').textContent = row.costType;
            const workerTd = clone.querySelector('.col-worker');
            workerTd.title = row.worker;
            workerTd.textContent = getFormattedWorker(row.worker);
            clone.querySelector('.col-md').textContent = row.md;

            clone.onclick = handleSortRowClick;
            tbody.appendChild(clone);
        } else {
            tr.innerHTML = `
                <td>${row.date}</td>
                <td>${siteDisplayHtml}</td>
                <td class="text-left pl-10">${equipDisplayHtml}</td>
                <td><span class="badge ${badgeClass} sort-badge">${escapeHtml(row.type)}</span></td>
                <td class="text-left pl-10">${escapeHtml(detail1)}</td>
                <td class="text-left pl-10">${escapeHtml(detail2)}</td>
                <td class="text-left pl-10">${escapeHtml(detail3)}</td>
                <td class="text-left pl-10">${workContentDisplayHtml}</td>
                <td>${escapeHtml(row.costType)}</td>
                <td title="${escapeHtml(row.worker)}">${escapeHtml(getFormattedWorker(row.worker))}</td>
                <td>${escapeHtml(row.md)}</td>
            `;
            tr.onclick = handleSortRowClick;
            tbody.appendChild(tr);
        }
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

    const custResponseContainer = document.getElementById('sort-cust-response-chart-container');
    const custResponseYAxis = document.getElementById('sort-cust-response-y-axis');
    const custResponseLegend = document.getElementById('sort-cust-response-legend');

    if (!container) return;

    const itemDetailTypeFilters = getMultiValues('sort-item-detail-type-select');
    const isItemDetailTypeAll = isAllSelected('sort-item-detail-type-select', itemDetailTypeFilters);

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
    if (custResponseContainer) custResponseContainer.innerHTML = '';
    if (custResponseYAxis) custResponseYAxis.innerHTML = '';
    if (custResponseLegend) custResponseLegend.innerHTML = '';

    if (results.length === 0) {
        container.innerHTML = '<div class="list-empty-msg sort-chart-empty">검색된 결과가 없습니다.</div>';
        if (solContainer) solContainer.innerHTML = '<div class="list-empty-msg sort-chart-empty">검색된 결과가 없습니다.</div>';
        if (typeContainer) typeContainer.innerHTML = '<div class="list-empty-msg sort-chart-empty">검색된 결과가 없습니다.</div>';
        if (detailTypeContainer) detailTypeContainer.innerHTML = '<div class="list-empty-msg sort-chart-empty">검색된 결과가 없습니다.</div>';
        if (detailType2Container) detailType2Container.innerHTML = '<div class="list-empty-msg sort-chart-empty">검색된 결과가 없습니다.</div>';
        if (irregularContainer) irregularContainer.innerHTML = '<div class="list-empty-msg sort-chart-empty">검색된 결과가 없습니다.</div>';
        if (custResponseContainer) custResponseContainer.innerHTML = '<div class="list-empty-msg sort-chart-empty">검색된 결과가 없습니다.</div>';
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
    const custResponseSiteCounts = {};
    const allSites = new Set();
    const allowedCustResponseItems = ['순회 점검', '프로그램 변경 / 평가', '설비 평가', '파티클 필터 교체', '업무 협조', '설비 정상화', '단순조치', '설비 개조', 'Cal 보정', '기타'];
    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];

    // [추가] 비정기 점검 항목 고정 리스트 (이 항목들만 차트에 표시)
    const allowedIrregularItems = [
        "현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상",
        "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"
    ];

    window.chartRenderers = []; // [추가] 글로벌 차트 렌더러 초기화

    results.forEach(row => {
        // [수정] 통계 차트에는 작업이 '완료'된 내역만 포함하도록 필터링
        if (row.status !== '완료') return;

        // [추가] 추가 작업으로 등록된 항목(originalLogId 가 존재함)은 따로 카운팅 안되게 제외 (최초 작업으로 1개로만 통계 처리)
        if (row.originalLogId) return;

        if (row.content) {
            const items = window.splitSafetyContent(row.content);
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
                    let itemDetailType = matchItem ? matchItem.detailType : '';
                    if (itemDetailType === '선택 안함' || itemDetailType === '') itemDetailType = '미지정';

                    // [개선] 물품 상세 구분 필터가 특정 항목(예: 용액)으로 한정되어 있다면, 해당하지 않는 파츠 등은 통계에서 제외
                    if (!isItemDetailTypeAll && itemDetailTypeFilters.length > 0) {
                        const isMatchDt = itemDetailTypeFilters.includes(itemDetailType) || (itemDetailType === '미지정' && itemDetailTypeFilters.some(f => f.includes('미지정')));
                        if (!isMatchDt) return;
                    }

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
        if (dt2 && dt2 !== '미지정' && row.site) {
            if (!detailType2SiteCounts[dt2]) detailType2SiteCounts[dt2] = {};
            detailType2SiteCounts[dt2][row.site] = (detailType2SiteCounts[dt2][row.site] || 0) + 1;
        }

        // 비정기 점검 항목(세부구분 3) 파싱 및 사업장별 데이터 수집
        if (row.type === '비정기') {
            let targetIrregular = '';

            if (row.detailType3 && row.detailType3 !== '미지정') {
                targetIrregular = row.detailType3;
            } else {
                const parts = (row.detailType || '').split(' > ').map(p => p.trim());
                if (parts.length >= 3 && parts[2] !== '미지정') {
                    targetIrregular = parts[2];
                } else if (row.content) {
                    const items = window.splitSafetyContent(row.content);
                    for (const item of items) {
                        let pureItem = item.replace(/\[.*?\]\s*/g, '').trim();
                        if (pureItem.includes(' - ')) {
                            pureItem = pureItem.split(' - ')[0].trim();
                        }
                        if (pureItem && allowedIrregularItems.includes(pureItem)) {
                            targetIrregular = pureItem;
                            break;
                        }
                    }
                }
            }

            if (targetIrregular && allowedIrregularItems.includes(targetIrregular) && row.site) {
                if (!irregularSiteCounts[targetIrregular]) irregularSiteCounts[targetIrregular] = {};
                irregularSiteCounts[targetIrregular][row.site] = (irregularSiteCounts[targetIrregular][row.site] || 0) + 1;
            }
        }
        if (row.type === '고객대응') {
            let custDetailType = row.detailType || '';
            if (custDetailType.includes(' > ')) {
                custDetailType = custDetailType.split(' > ')[0].trim();
            }
            const cleanCustDetail = custDetailType.replace(/\s+/g, '').toLowerCase();
            const matchedItem = allowedCustResponseItems.find(item => item.replace(/\s+/g, '').toLowerCase() === cleanCustDetail);
            if (matchedItem && row.site) {
                if (!custResponseSiteCounts[matchedItem]) custResponseSiteCounts[matchedItem] = {};
                custResponseSiteCounts[matchedItem][row.site] = (custResponseSiteCounts[matchedItem][row.site] || 0) + 1;
            }
        }
    });

    // 사업장별 그룹 차트를 그리는 공통 헬퍼 함수
    const drawGroupedChart = (dataObj, targetContainer, targetYAxis, targetLegend, allSitesArray) => {
        if (!targetContainer || !targetYAxis) return;

        let isGrouped = true; // [추가] 그룹화 상태 변수

        // [추가] 카드 제목 클릭 시 그룹/개별 보기 전환 이벤트 등록
        const card = targetContainer.closest('.sort-half-chart, .sort-full-chart');
        let titleEl = null;
        let exportBtn = null;

        if (card) {
            titleEl = card.querySelector('h3, .card-title, .status-group-title') || card.firstElementChild;
            if (titleEl) {
                // [개선] 검색이나 필터 적용 시 차트가 새로 그려지면서 발생하던 이전 이벤트 리스너(클로저) 꼬임 현상 해결
                const newTitleEl = titleEl.cloneNode(true);
                titleEl.parentNode.replaceChild(newTitleEl, titleEl);
                titleEl = newTitleEl;

                titleEl.dataset.clickBound = 'true';
                titleEl.style.cursor = 'pointer';
                titleEl.title = '클릭 시 그룹/개별 보기 전환';

                // [추가] 제목 영역을 flex로 만들고 CSV 추출 버튼 삽입
                titleEl.style.display = 'flex';
                titleEl.style.justifyContent = 'space-between';
                titleEl.style.alignItems = 'center';

                exportBtn = titleEl.querySelector('.btn-export-chart-csv');
                if (!exportBtn) {
                    exportBtn = document.createElement('button');
                    exportBtn.className = 'btn-export-chart-csv';
                    exportBtn.innerHTML = '⬇️ CSV';
                    exportBtn.title = '차트 데이터 CSV 추출';
                    exportBtn.style.cssText = 'padding: 2px 6px; font-size: 11px; cursor: pointer; border-radius: 4px; border: 1px solid #30363d; background: transparent; color: #8b949e; margin-left: auto;';
                    titleEl.appendChild(exportBtn);
                }

                titleEl.addEventListener('click', () => {
                    isGrouped = !isGrouped;
                    window.chartSelectedSiteFilter = null; // [추가] 뷰 전환 시 전역 필터 해제
                    if (window.chartRenderers) window.chartRenderers.forEach(fn => fn()); // [개선] 모든 차트 동기화
                    if (typeof renderSortListTableOnly === 'function') renderSortListTableOnly();
                });
            }
        }

        const getSiteGroupName = (s) => {
            try {
                const meta = JSON.parse(localStorage.getItem(`site_meta_${s}`));
                if (meta && meta.group) return meta.group;
            } catch (e) { }
            return '기타사업장';
        };

        const isMatch = (siteOrGroup) => {
            const filter = window.chartSelectedSiteFilter;
            if (!filter) return true;
            if (filter === siteOrGroup) return true;
            if (isGrouped) {
                return getSiteGroupName(filter) === siteOrGroup;
            } else {
                return getSiteGroupName(siteOrGroup) === filter;
            }
        };

        const renderInner = () => {
            // [개선] 메인 필터(sort menu)의 사업장 필터가 차트의 그룹/개별 보기 상태에 관계없이 항상 유지되도록 데이터 소스를 명시적으로 재필터링
            // allSitesArray는 performSortSearch에서 이미 필터링된 results에서 생성되었으므로 신뢰할 수 있는 필터 기준임.
            const filteredDataObj = {};
            Object.keys(dataObj).forEach(category => {
                filteredDataObj[category] = {};
                Object.keys(dataObj[category]).forEach(site => {
                    if (allSitesArray.includes(site)) {
                        filteredDataObj[category][site] = dataObj[category][site];
                    }
                });
            });

            let currentDataObj = filteredDataObj;
            let currentSitesArray = allSitesArray;

            // [추가] 그룹화 로직 적용
            if (isGrouped) {
                const groupedDataObj = {};
                const groupedSitesSet = new Set();

                Object.keys(dataObj).forEach(category => {
                    groupedDataObj[category] = {};
                    Object.keys(dataObj[category]).forEach(site => {
                        let groupName = getSiteGroupName(site);
                        groupedSitesSet.add(groupName);
                        groupedDataObj[category][groupName] = (groupedDataObj[category][groupName] || 0) + dataObj[category][site];
                    });
                });

                currentDataObj = groupedDataObj;
                const order = ['SEC', 'SKH 이천', 'SKH 청주', '기타사업장', 'SCS 서안', 'SKH 우시', '기타'];
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
                    if (!isMatch(site)) return;
                    if (val > maxCount) maxCount = val;
                });
            });

            if (maxCount === 0) {
                targetContainer.innerHTML = '<div class="list-empty-msg sort-chart-empty">표시할 데이터가 없습니다.</div>';
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
                    let color = '#8957e5';
                    if (site === 'SEC') color = '#034EA2';
                    else if (site === 'SKH 이천') color = '#eb371f';
                    else if (site === 'SKH 청주') color = '#F37021';
                    else if (site === 'SCS 서안') color = '#0096D6';
                    else if (site === 'SKH 우시') color = '#d29922';
                    else if (site === '기타') color = '#1b7c83';

                    siteColorMap[site] = color;
                });
            } else {
                currentSitesArray.forEach((site, idx) => {
                    siteColorMap[site] = siteColors[idx % siteColors.length];
                });
            }

            if (targetLegend) targetLegend.innerHTML = '';
            currentSitesArray.forEach((site) => {
                if (targetLegend && activeSitesInChart.has(site)) {
                    const isFaded = !isMatch(site);
                    const legDiv = document.createElement('div');
                    legDiv.className = 'legend-item';
                    if (isFaded) legDiv.classList.add('faded');
                    legDiv.innerHTML = `<div class="legend-color-box" style="background:${siteColorMap[site]};"></div><span title="${escapeHtml(site)}">${escapeHtml(site)}</span>`;
                    legDiv.onclick = () => {
                        if (window.chartSelectedSiteFilter === site) {
                            window.chartSelectedSiteFilter = null; // 토글 해제 (전체 보기)
                        } else {
                            window.chartSelectedSiteFilter = site; // [추가] 테이블 필터 적용
                        }
                        if (window.chartRenderers) window.chartRenderers.forEach(fn => fn()); // [개선] 모든 차트 시각적 동기화
                        if (typeof renderSortListTableOnly === 'function') renderSortListTableOnly(); // [추가] 결과 리스트 테이블도 함께 필터링 연동
                    };
                    targetLegend.appendChild(legDiv);
                }
            });

            // [수정] 수량/건수가 많은 항목부터 내림차순으로 정렬
            const sortedCategories = Object.keys(currentDataObj).map(category => {
                let currentTotal = 0;
                currentSitesArray.forEach(site => {
                    if (!isMatch(site)) return;
                    currentTotal += (currentDataObj[category][site] || 0);
                });
                return { category, total: currentTotal };
            }).sort((a, b) => {
                if (b.total !== a.total) return b.total - a.total; // 1차 정렬: 수량 많은 순
                return (a.category || '').localeCompare(b.category || ''); // 2차 정렬: 수량이 같으면 가나다순 (Null 에러 방어)
            }).map(item => item.category);

            // [추가] 추출 버튼 클릭 이벤트 업데이트 (렌더링 시 최신 데이터/필터 반영)
            if (exportBtn && titleEl) {
                exportBtn.onclick = (e) => {
                    e.stopPropagation(); // 그룹/개별 보기 전환 방지

                    let csvContent = '\uFEFF'; // 한글 깨짐 방지 BOM
                    const sites = currentSitesArray.filter(site => isMatch(site));
                    csvContent += `항목명,${sites.map(s => '"' + String(s).replace(/"/g, '""') + '"').join(',')}\n`;

                    sortedCategories.forEach(category => {
                        let catStr = String(category || '');
                        // [수정] 엑셀 수식 자동 변환 방지 (CSV 인젝션 방어)
                        if (/^[=+\-@\(]/.test(catStr.trim())) {
                            catStr = "'" + catStr;
                        }
                        let row = [`"${catStr.replace(/"/g, '""')}"`];
                        let hasDataInRow = false;
                        sites.forEach(site => {
                            const val = currentDataObj[category][site] || 0;
                            row.push(val);
                            if (val > 0) hasDataInRow = true;
                        });
                        if (hasDataInRow) {
                            csvContent += row.join(',') + '\n';
                        }
                    });

                    const rawTitle = titleEl.cloneNode(true);
                    const btnToRemove = rawTitle.querySelector('.btn-export-chart-csv');
                    if (btnToRemove) btnToRemove.remove();
                    const titleName = rawTitle.textContent.trim().replace(/\s+/g, '_');

                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `SORT_통계_${titleName}_${new Date().toISOString().slice(0, 10)}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    // [보안 감사 로그] CSV 내보내기 활동 로그 기록
                    logActionToServer('EXPORT_CSV', '정렬/통계 차트 데이터 CSV 내보내기 (' + titleName + ')');
                };
            }

            targetContainer.innerHTML = '';
            sortedCategories.forEach(category => {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'sort-bar-group type-group';
                const trackDiv = document.createElement('div');
                trackDiv.className = 'bar-track';
                let totalInGroup = 0;

                // [수정] 항목(category)마다 사업장(site) 막대를 수량 내림차순으로 정렬
                const sortedSitesForCategory = [...currentSitesArray].sort((a, b) => {
                    const countA = currentDataObj[category][a] || 0;
                    const countB = currentDataObj[category][b] || 0;
                    if (countB !== countA) return countB - countA;
                    return a.localeCompare(b);
                });

                sortedSitesForCategory.forEach(site => {
                    if (!isMatch(site)) return;

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
                if (totalInGroup > 0) {
                    // 항목 내의 사업장(막대) 수에 맞추어 그룹 가로폭을 최소 가로폭으로 가변 동적 계산하여 겹침을 방지합니다.
                    const computedMinWidth = Math.max(60, totalInGroup * 35);
                    groupDiv.style.minWidth = computedMinWidth + 'px';
                    targetContainer.appendChild(groupDiv);
                }
            });
        };

        if (!window.chartRenderers) window.chartRenderers = [];
        window.chartRenderers.push(renderInner);

        renderInner();
    };


    const sitesArray = Array.from(allSites).sort();
    drawGroupedChart(partSiteCounts, container, yAxisContainer, partLegend, sitesArray);
    drawGroupedChart(solSiteCounts, solContainer, solYAxis, solLegend, sitesArray);
    drawGroupedChart(typeSiteCounts, typeContainer, typeYAxis, typeLegend, sitesArray);
    drawGroupedChart(detailTypeSiteCounts, detailTypeContainer, detailTypeYAxis, detailTypeLegend, sitesArray);
    drawGroupedChart(detailType2SiteCounts, detailType2Container, detailType2YAxis, detailType2Legend, sitesArray);
    drawGroupedChart(irregularSiteCounts, irregularContainer, irregularYAxis, irregularLegend, sitesArray);
    drawGroupedChart(custResponseSiteCounts, custResponseContainer, custResponseYAxis, custResponseLegend, sitesArray);
}

/* ==========================================================================
   6. 데이터 내보내기 및 헬퍼 (Export & Helpers)
   ========================================================================== */
// [6.1] 검색된 결과를 Excel 파일 양식으로 변환 및 다운로드 추출 (진짜 셀 병합 적용)
function exportSortResultsToCSV(results) {
    if (typeof XLSX === 'undefined') {
        alert('엑셀 라이브러리(SheetJS)가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.');
        return;
    }

    const wb = XLSX.utils.book_new();
    const ws_data = [];

    // 헤더 정의
    ws_data.push([
        '날짜', '사업장 구분', '사업장', '건물명', '모델명',
        'Serial No', '고객사 장비명', '구분', '세부구분 1', '세부구분 2', '세부구분 3',
        '물품상세구분', '작업내용', '비용처리', '작업자', '공수', '상세메모'
    ]);

    const adminItems = JSON.parse(localStorage.getItem('admin_items')) || [];
    const merges = [];
    let startRow = 1; // 헤더가 0번째 행이므로 데이터 시작은 1번째 행

    results.forEach(row => {
        let dt1 = '';
        let dt2 = '';
        let dt3 = '';
        if (row.detailType && row.detailType.includes(' > ')) {
            const parts = row.detailType.split(' > ');
            dt1 = parts[0].trim();
            dt2 = parts[1] ? parts[1].trim() : '-';
            dt3 = parts[2] ? parts[2].trim() : '-';
        } else {
            dt1 = row.detailType || '';
            dt2 = '-';
            dt3 = '-';
        }
        if (row.detailType3) dt3 = row.detailType3;

        const rawContent = row.content || '';
        const itemsList = window.splitSafetyContent(rawContent);
        const itemCount = itemsList.length > 0 ? itemsList.length : 1;

        for (let i = 0; i < itemCount; i++) {
            let itemWork = '-';

            if (itemsList.length > 0) {
                const item = itemsList[i];
                let cleanItem = item.replace(/^\[[^\]]+\]\s*/g, '').trim();
                let costTag = '';
                const costMatch = item.match(/^\[([^\]]+)\]/);
                if (costMatch) costTag = `[${costMatch[1]}] `;

                let kwLabel = '';
                let purePart = cleanItem;

                if (cleanItem.includes(' - ')) {
                    const parts = cleanItem.split(' - ');
                    kwLabel = parts[0].trim();
                    purePart = parts.slice(1).join(' - ').trim();
                } else {
                    const defaultKeywords = ["현장 이슈", "PC 이상", "작업자 실수", "통신 이상", "용액 용자 이상", "파트 이상 교체", "파트 이상 수리", "프로그램 이상", "단순조치", "기타"];
                    if (defaultKeywords.includes(cleanItem)) {
                        kwLabel = cleanItem;
                        purePart = '';
                    }
                }

                if (row.type === '비정기' && kwLabel && (dt3 === '-' || !dt3)) {
                    dt3 = kwLabel;
                }

                let displayPart = purePart;
                if (purePart) {
                    let specStr = '';
                    const specMatch = purePart.match(/\s*\[(.*?)\]$/);
                    if (specMatch) {
                        specStr = specMatch[0];
                        purePart = purePart.replace(specMatch[0], '').trim();
                    }

                    const matchItem = adminItems.find(ai => (ai.part || '').trim().toLowerCase() === purePart.toLowerCase() || (ai.code || '').trim().toLowerCase() === purePart.toLowerCase());
                    if (matchItem && matchItem.code) {
                        displayPart = `${matchItem.code}${specStr}`;
                    } else {
                        displayPart = `${purePart}${specStr}`;
                    }
                }

                itemWork = displayPart ? `${costTag}${displayPart}`.trim() : (kwLabel && row.type !== '비정기' ? `${costTag}${kwLabel}` : '-');
            }

            // AOA 데이터 빌드 (첫 번째 품목 셀에만 정보 제공하고 병합시킴)
            ws_data.push([
                i === 0 ? row.date : '',
                i === 0 ? row.siteGroup : '',
                i === 0 ? row.site : '',
                i === 0 ? row.building : '',
                i === 0 ? row.modelName : '',
                i === 0 ? row.serial : '',
                i === 0 ? row.custName : '',
                i === 0 ? row.type : '',
                i === 0 ? dt1 : '',
                i === 0 ? dt2 : '',
                i === 0 ? dt3 : '',
                i === 0 ? row.itemDetailType : '',
                itemWork,
                i === 0 ? row.costType : '',
                i === 0 ? row.worker : '',
                i === 0 ? row.md : '',
                i === 0 ? row.memo : ''
            ]);
        }

        // 품목이 2개 이상일 때 병합 조건 생성
        if (itemCount > 1) {
            const endRow = startRow + itemCount - 1;
            // 0~11열 병합 (날짜부터 물품상세구분까지)
            for (let c = 0; c <= 11; c++) {
                merges.push({ s: { r: startRow, c: c }, e: { r: endRow, c: c } });
            }
            // 13~16열 병합 (비용처리부터 상세메모까지)
            for (let c = 13; c <= 16; c++) {
                merges.push({ s: { r: startRow, c: c }, e: { r: endRow, c: c } });
            }
        }

        startRow += itemCount;
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!merges'] = merges;

    // [추가] 셀 스타일링: 수직/수평 가운데 맞춤 및 헤더 강조 적용
    for (let ref in ws) {
        if (ref[0] === '!') continue;
        const cell = ws[ref];
        if (!cell) continue;

        if (!cell.s) cell.s = {};

        // 수직/수평 가운데 맞춤 및 텍스트 자동 줄바꿈 지정
        cell.s.alignment = {
            vertical: 'center',
            horizontal: 'center',
            wrapText: true
        };

        // 헤더 행 스타일링 (폰트 볼드, 연한 회색 배경, 하단 굵은 실선 테두리)
        const rowNum = parseInt(ref.replace(/[^0-9]/g, ''));
        if (rowNum === 1) {
            cell.s.font = { bold: true, name: '맑은 고딕', sz: 10 };
            cell.s.fill = { fgColor: { rgb: "EAEAEA" } };
            cell.s.border = {
                bottom: { style: 'medium', color: { rgb: "000000" } }
            };
        } else {
            cell.s.font = { name: '맑은 고딕', sz: 10 };
        }
    }

    // 셀 너비 자동 세팅 (작업내용 index 12는 285px, 작업자 index 14는 150px, 상세메모 index 16은 565px 고정, 나머지는 자동 맞춤)
    const colWidths = ws_data[0].map((_, colIdx) => {
        if (colIdx === 12) {
            return { wpx: 285 };
        }
        if (colIdx === 14) {
            return { wpx: 150 };
        }
        if (colIdx === 16) {
            return { wpx: 565 };
        }
        let maxLen = 10;
        ws_data.forEach(row => {
            const val = String(row[colIdx] || '');
            const len = val.replace(/[^\x00-\xff]/g, 'xx').length; // 한글 가중치 반영
            if (len > maxLen) maxLen = len;
        });
        return { wch: maxLen + 2 };
    });
    ws['!cols'] = colWidths;

    // 첫 줄(헤더 행)에 자동 필터 지정 (A1부터 Q열 끝까지)
    ws['!autofilter'] = { ref: `A1:Q${ws_data.length}` };

    // 다운로드 형식 선택 분기 (확인: XLSX, 취소: CSV)
    const isXlsx = confirm("다운로드받을 파일 형식을 선택하세요.\n\n[확인] : 엑셀 파일 (.xlsx)\n[취소] : 순수 텍스트 파일 (.csv)");

    if (isXlsx) {
        XLSX.utils.book_append_sheet(wb, ws, '작업조회결과');
        XLSX.writeFile(wb, `SORT_작업조회결과_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } else {
        // UTF-8 BOM(\ufeff)을 더해 엑셀 및 일반 텍스트 편집기에서 한글 깨짐을 방지하는 CSV 문자열 생성
        const csvContent = XLSX.utils.sheet_to_csv(ws);
        const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `SORT_작업조회결과_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // [보안 감사 로그] Excel 내보내기 활동 로그 기록
    logActionToServer('EXPORT_CSV', '정렬/통계 작업조회결과 Excel 다운로드(셀 병합)');
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

// [추가] 장비 작업 이력 팝업 모달 열기
function openSortHistoryModal(site, equip) {
    const modal = document.getElementById('sort-history-modal');
    if (!modal) return;

    const titleEl = document.getElementById('sort-history-title');
    const tbody = document.getElementById('sort-history-tbody');

    // 장비명 표시 문자열 구성
    const parts = equip.split('::');
    const rawName = parts[0];
    const serial = parts.length > 1 ? parts[1] : '';
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
    const equipName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;

    const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
    const custName = (detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '';

    let displayStr = `${site} > ${equipName}`;
    if (custName) displayStr += ` [${custName}]`;
    else if (serial) displayStr += ` (${serial})`;

    if (titleEl) titleEl.textContent = `${displayStr} 작업 이력`;

    // 이력 데이터 통합 (완료된 로그 + 예정된 유지관리)
    const logs = detailData.logs || [];
    const maints = detailData.maint || [];
    let allHistory = [];

    logs.forEach(l => {
        if (l.detailType !== '일정변경') {
            allHistory.push({ ...l, isCompleted: true, status: '완료' });
        }
    });


    // [추가] 팝업에서도 동일 장비, 동일 일자, 동일 구분의 작업을 하나로 병합
    const groupedHistory = new Map();
    allHistory.forEach(item => {
        const detailStr = item.detailType || '';
        const detailStr2 = item.detailType2 || '';
        const groupKey = `${item.date}_${item.status}_${item.type}_${detailStr}_${detailStr2}`;

        if (!groupedHistory.has(groupKey)) {
            groupedHistory.set(groupKey, { ...item });
        } else {
            const existing = groupedHistory.get(groupKey);
            const existingContents = (existing.content || '').split(',').map(s => s.trim()).filter(Boolean);
            const newContents = (item.content || '').split(',').map(s => s.trim()).filter(Boolean);
            newContents.forEach(c => {
                if (!existingContents.includes(c)) existingContents.push(c);
            });
            existing.content = existingContents.join(', ');

            const existingWorkers = (existing.worker || '').split(',').map(s => s.trim()).filter(Boolean);
            const newWorkers = (item.worker || '').split(',').map(s => s.trim()).filter(Boolean);
            newWorkers.forEach(w => {
                if (!existingWorkers.includes(w)) existingWorkers.push(w);
            });
            existing.worker = existingWorkers.join(', ');

            const md1 = parseFloat(existing.md) || 0;
            const md2 = parseFloat(item.md) || 0;
            existing.md = Math.max(md1, md2).toString();

            const itemCost = item.costType || item.itemCost || '유상';
            const existCost = existing.costType || existing.itemCost || '유상';
            if (itemCost !== existCost) {
                const existingCosts = existCost.split(',').map(s => s.trim());
                if (!existingCosts.includes(itemCost)) {
                    existingCosts.push(itemCost);
                    existing.costType = existingCosts.join(', ');
                    existing.itemCost = existing.costType; // 하위 호환성
                }
            }
        }
    });
    allHistory = Array.from(groupedHistory.values());

    // 날짜 내림차순 정렬
    allHistory.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        if (dateB !== dateA) return dateB.localeCompare(dateA);
        return 0;
    });

    tbody.innerHTML = '';
    if (allHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="list-empty-msg" style="text-align: center; padding: 30px;">작업 이력이 없습니다.</td></tr>';
    } else {
        allHistory.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.className = 'sort-result-row';

            const badgeClass = item.type ? item.type.replace(/\s/g, '') : 'default';
            const statusClass = item.status === '완료' ? 'status-complete' : 'status-pending';

            let dt = item.detailType || '-';
            if (item.detailType2) dt += ` > ${item.detailType2}`;

            // 비용 태그 및 내용 정제
            let content = item.content || '-';
            let costType = item.costType || item.itemCost || '유상';

            const costMatch = content.match(/^\[(.*?)\] (.*)$/);
            if (costMatch) {
                costType = costMatch[1];
                content = costMatch[2];
            }
            content = content.replace(/\[(?:유상|무상[^\]]*|기타)\]\s*/g, '').trim();
            content = content.replace(/\s*-\s*(?=,|$)/g, '').trim();

            let displayContent = content;
            const itemsList = content.split(',').map(s => s.trim()).filter(Boolean);
            if (itemsList.length > 1) {
                displayContent = `${itemsList[0]} 외 ${itemsList.length - 1}개`;
            } else if (itemsList.length === 1) {
                displayContent = itemsList[0];
            }

            tr.innerHTML = `
                <td style="text-align: center;">${item.date || '-'}</td>
                <td style="text-align: center;"><span class="badge ${badgeClass} sort-badge">${escapeHtml(item.type || '-')}</span></td>
                <td class="text-left pl-10" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;" title="${escapeHtml(dt)}">${escapeHtml(dt)}</td>
                <td class="text-left pl-10" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" title="${escapeHtml(content)}">${escapeHtml(displayContent)}</td>
            `;

            // 마우스 호버 효과
            tr.addEventListener('mouseenter', () => { tr.style.backgroundColor = '#21262d'; });
            tr.addEventListener('mouseleave', () => { tr.style.backgroundColor = ''; });

            tr.onclick = () => {
                openSortDetailModal(displayStr, item, content, costType);
            };

            tbody.appendChild(tr);
        });
    }

    modal.style.display = 'flex';
}

// [추가] 작업 상세 내용 팝업 모달 열기
function openSortDetailModal(equipDisplay, item, cleanContent, costType) {
    const modal = document.getElementById('sort-detail-modal');
    if (!modal) return;

    document.getElementById('sort-detail-equip').value = equipDisplay;
    document.getElementById('sort-detail-date').value = item.date || '-';

    let typeStr = item.type || '-';
    if (item.detailType) typeStr += ` > ${item.detailType}`;
    if (item.detailType2) typeStr += ` > ${item.detailType2}`;

    document.getElementById('sort-detail-type').value = typeStr;
    document.getElementById('sort-detail-content').value = cleanContent || '-';
    document.getElementById('sort-detail-cost').value = costType || '-';
    document.getElementById('sort-detail-worker').value = item.worker || '-';
    document.getElementById('sort-detail-md').value = item.md || '0';
    document.getElementById('sort-detail-memo').value = item.memo || '작성된 메모가 없습니다.';

    modal.style.display = 'flex';
}

// [추가] 정렬(검색) 페이지 외부 실시간 갱신 함수 및 검색 함수 전역 노출
window.performSortSearch = performSortSearch;
window.refreshSortPage = function () {
    try {
        if (window.isSortPageRestoring) return;
        const typeSelect = document.getElementById('sort-type-select');
        if (!typeSelect) return;
        const types = getMultiValues('sort-type-select');
        updateSortDetailTypeSelect(types);
    } catch (refreshErr) {
        console.error('refreshSortPage error:', refreshErr);
    }
};