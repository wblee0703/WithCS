/**
 * Equipment Working Report (report.js)
 * 100% Free Local DB-Driven Interactive Working Report Generator
 * Real-time WYSIWYG editing, Excel-matched layout, Searchable Suggestion Box, PDF printing
 */

let allSitesList = [];
let allEquipmentList = [];
let allWorkersList = [];
let currentReportId = null;
let currentModelParameters = [];

let selectedSiteName = '';
let selectedEquipId = '';
let isReportActive = false; // [요청 반영] 처음에는 report가 없게 유지
let currentFilteredEquips = [];
let highlightedEquipIndex = -1;
let currentFilteredInspectors = [];
let highlightedInspectorIndex = -1;
let selectedInspectorsList = [];
const REPORT_STATE_STORAGE_KEY = 'last_report_workspace_state';
let _reportStateDebounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    initDefaultDate();
    initActionButtons();
    initSheetInteractions();
    initSuggestionBoxes();
    initCardLayoutTools();

    // [요청 반영] Report 메뉴에서 다른 메뉴 갔다 와도 마지막 작업 했던 상태 복원 (Rule #7 준수: 0ms 즉시 복원, 자동 재조회 금지)
    const hasRestored = restoreReportWorkspaceState();
    if (!hasRestored) {
        hideReportSheet(true); // 복원할 이전 작업 내역이 없으면 초기 대기 상태 표시
    }

    loadSitesAndEquipment();
    loadWorkersList();

    // 페이지를 떠나거나 다른 메뉴로 이동할 때 마지막 작업 상태 자동 저장
    window.addEventListener('beforeunload', () => {
        saveReportWorkspaceState();
    });
    window.addEventListener('pagehide', () => {
        saveReportWorkspaceState();
    });
});

// [요청 반영] 마지막 작업 상태 세션 스토리지 실시간 저장
function saveReportWorkspaceState() {
    try {
        const siteInput = document.getElementById('report-site-input');
        const equipInput = document.getElementById('report-equip-input');
        const dateInput = document.getElementById('report-date-input');
        const inspectorInput = document.getElementById('report-inspector-input');
        const historySelect = document.getElementById('report-history-select');

        const state = {
            siteName: selectedSiteName || '',
            siteInputValue: siteInput ? siteInput.value : '',
            equipId: selectedEquipId || '',
            equipInputValue: equipInput ? equipInput.value : '',
            dateVal: dateInput ? dateInput.value : '',
            inspectorVal: inspectorInput ? inspectorInput.value : '',
            currentReportId: currentReportId,
            historySelectVal: historySelect ? historySelect.value : '',
            isReportActive: isReportActive,
            sheetData: isReportActive ? collectSheetData() : null,
            savedAt: Date.now()
        };

        sessionStorage.setItem(REPORT_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('Failed to save report workspace state:', e);
    }
}

function debounceSaveReportState(delay = 250) {
    if (_reportStateDebounceTimer) clearTimeout(_reportStateDebounceTimer);
    _reportStateDebounceTimer = setTimeout(() => {
        saveReportWorkspaceState();
    }, delay);
}

// [요청 반영] 세션 스토리지에서 마지막 작업 상태 복원 (0ms 즉시 복원)
function restoreReportWorkspaceState() {
    try {
        const raw = sessionStorage.getItem(REPORT_STATE_STORAGE_KEY);
        if (!raw) return false;
        const state = JSON.parse(raw);
        if (!state) return false;

        // 1. 사업장 및 장비 선택 상태 복원
        if (state.siteName || state.siteInputValue) {
            selectedSiteName = state.siteName || '';
            const siteInput = document.getElementById('report-site-input');
            const siteSelect = document.getElementById('report-site-select');
            if (siteInput) siteInput.value = state.siteInputValue || state.siteName;
            if (siteSelect && state.siteName) siteSelect.value = state.siteName;

            const equipInput = document.getElementById('report-equip-input');
            const equipSelect = document.getElementById('report-equip-select');
            if (equipInput) {
                equipInput.disabled = false;
                equipInput.placeholder = '장비를 선택하거나 검색...';
                if (state.equipInputValue) equipInput.value = state.equipInputValue;
            }
            if (equipSelect) {
                equipSelect.disabled = false;
                if (state.equipId) equipSelect.value = state.equipId;
            }
        }

        if (state.equipId) {
            selectedEquipId = state.equipId;
        }

        // 2. 점검일자 및 점검자 복원
        const dateInput = document.getElementById('report-date-input');
        if (dateInput && state.dateVal) {
            dateInput.value = state.dateVal;
            updateSheetInspectDate(state.dateVal);
        }

        const inspectorInput = document.getElementById('report-inspector-input');
        if (inspectorInput && state.inspectorVal !== undefined) {
            inspectorInput.value = state.inspectorVal;
            selectedInspectorsList = state.inspectorVal
                ? state.inspectorVal.split(',').map(s => s.trim()).filter(Boolean)
                : [];
            const sheetInspector = document.getElementById('sheet-inspector');
            if (sheetInspector && state.inspectorVal) sheetInspector.textContent = state.inspectorVal;
        }

        currentReportId = state.currentReportId || null;

        // 3. 시트 렌더링 상태 복원 (0ms 즉시 복원, Rule #7 준수: 자동 재조회 트리거 금지)
        if (state.isReportActive && state.sheetData) {
            showReportSheet(true);
            applySheetData(state.sheetData);
        } else {
            hideReportSheet(true);
        }

        // 4. 이력 목록 비동기 복원
        if (state.equipId) {
            loadReportHistory(state.equipId).then(() => {
                const historySelect = document.getElementById('report-history-select');
                if (historySelect && state.historySelectVal) {
                    historySelect.value = state.historySelectVal;
                }
            }).catch(() => {});
        }

        return true;
    } catch (e) {
        console.error('Failed to restore report workspace state:', e);
        return false;
    }
}

// 보고서 시트 표시
function showReportSheet(skipSave = false) {
    isReportActive = true;
    const placeholder = document.getElementById('report-empty-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    const sheet = document.getElementById('working-report-sheet');
    if (sheet) sheet.style.display = 'block';
    if (!skipSave) debounceSaveReportState(100);
}

// 보고서 시트 숨김 (초기 대기 상태)
function hideReportSheet(skipSave = false) {
    isReportActive = false;
    const placeholder = document.getElementById('report-empty-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
    const sheet = document.getElementById('working-report-sheet');
    if (sheet) sheet.style.display = 'none';
    if (!skipSave) debounceSaveReportState(100);
}

// 1. 점검일자 기본값 설정 (오늘)
function initDefaultDate() {
    const dateInput = document.getElementById('report-date-input');
    if (dateInput && !dateInput.value) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }

    if (dateInput) {
        dateInput.addEventListener('change', () => {
            debounceSaveReportState(100);
            // [요청 반영] 실시간 시트 반영 제외 (보고서 생성 버튼 클릭 시 한 번에 반영)
        });
    }
}

// 시트 메타 셀 획득 헬퍼 (HTML ID 호환성 보장)
function getSheetSerialEl() {
    return document.getElementById('sheet-serial-no') || document.getElementById('sheet-serial');
}

function getSheetDateEl() {
    return document.getElementById('sheet-inspect-date') || document.getElementById('sheet-date');
}

// [요청 반영] 점검일자 포맷 후 시트에 반영 (YYYY.MM.DD 형식)
function updateSheetInspectDate(dateVal) {
    const sheetDate = getSheetDateEl();
    if (!sheetDate) return;
    if (!dateVal) {
        const dateInput = document.getElementById('report-date-input');
        dateVal = dateInput ? dateInput.value : '';
    }
    if (!dateVal) {
        sheetDate.textContent = '-';
        return;
    }
    // YYYY.MM.DD 형식으로 일관 변환
    const parts = dateVal.split(/[-./]/);
    if (parts.length >= 3) {
        const yyyy = parts[0];
        const mm = parts[1].padStart(2, '0');
        const dd = parts[2].padStart(2, '0');
        sheetDate.textContent = `${yyyy}.${mm}.${dd}`;
    } else {
        sheetDate.textContent = dateVal.replace(/-/g, '.');
    }
}

// [요청 반영] Report S/N에 고객사 장비명 또는 시리얼 넘버 자동 반영 (고객사 장비명 우선, 없으면 시리얼 넘버)
function updateSheetSerialNo(eqOrData) {
    const sheetSerial = getSheetSerialEl();
    if (!sheetSerial) return;
    if (!eqOrData) {
        sheetSerial.textContent = '-';
        return;
    }
    const custName = (eqOrData.cust_equip_name || '').trim();
    const serial = (eqOrData.serial_no || eqOrData.serial || '').trim();
    sheetSerial.textContent = custName || serial || '-';
}

// [요청 반영] 설치장소: 사업장명으로 자동 기록
function getEquipLocationStr(eqOrData) {
    const site = selectedSiteName || (eqOrData ? (eqOrData.site_name || eqOrData.location) : '') || '';
    return site.trim() || '-';
}

function updateSheetLocation(eqOrData) {
    const sheetLocation = document.getElementById('sheet-location');
    if (!sheetLocation) return;
    sheetLocation.textContent = getEquipLocationStr(eqOrData);
}

// 2. 주요 액션 버튼 이벤트 리스너
function initActionButtons() {
    // [요청 반영] 보고서 생성 버튼 (1차 작성)
    const btnCreate = document.getElementById('btn-create-report');
    if (btnCreate) btnCreate.addEventListener('click', createInitialReport);

    const btnSave = document.getElementById('btn-save-report');
    if (btnSave) btnSave.addEventListener('click', saveReport);

    const btnPrint = document.getElementById('btn-print-pdf');
    if (btnPrint) btnPrint.addEventListener('click', () => window.print());

    // [요청 반영] 보고서 이미지 클립보드 복사 버튼
    const btnCopy = document.getElementById('btn-copy-image');
    if (btnCopy) btnCopy.addEventListener('click', copyReportAsImage);

    const btnNew = document.getElementById('btn-new-report');
    if (btnNew) btnNew.addEventListener('click', resetNewReport);

    const btnDelete = document.getElementById('btn-delete-report');
    if (btnDelete) btnDelete.addEventListener('click', deleteCurrentReport);

    // [요청 반영] 파라미터 항목 추가 버튼 클릭 시 Data Parameter 선택 모달 열기
    const btnLoadDataParams = document.getElementById('btn-load-data-params') || document.getElementById('btn-open-param-modal');
    if (btnLoadDataParams) btnLoadDataParams.addEventListener('click', openDataParamsModal);

    const btnAddParam = document.getElementById('btn-add-custom-param');
    if (btnAddParam) btnAddParam.addEventListener('click', addCustomParamRow);

    const btnDelParam = document.getElementById('btn-del-custom-param');
    if (btnDelParam) btnDelParam.addEventListener('click', removeLastParamRow);

    const historySelect = document.getElementById('report-history-select');
    if (historySelect) {
        historySelect.addEventListener('change', () => {
            // [요청 반영] 참고 보고서 선택은 보고서 생성 시 참고할 데이터를 지정하는 용도
            debounceSaveReportState(100);
        });
    }
}

// [요청 반영] 1. 사업장, 장비, 점검일자, 점검자, 참고 보고서 선택 후 [보고서 생성] 클릭 시 한 번에 시트에 반영
async function createInitialReport() {
    if (!selectedSiteName || !selectedEquipId) {
        alert('사업장과 장비를 먼저 선택해주세요.');
        return;
    }

    // 시트 표시 활성화
    showReportSheet();

    const matchedEquip = allEquipmentList.find(eq => eq.id === selectedEquipId);

    // 1. 모델 타이틀 한 번에 반영
    const sheetTitle = document.getElementById('sheet-title');
    if (sheetTitle && matchedEquip) {
        sheetTitle.textContent = `${matchedEquip.model_name || matchedEquip.name || 'ICAP-RQ'} Working Report`;
    }

    // 2. 점검일자 한 번에 반영
    const dateInput = document.getElementById('report-date-input');
    const dateVal = dateInput ? dateInput.value : '';
    updateSheetInspectDate(dateVal);

    // 3. 점검자 한 번에 반영
    const inspectorInput = document.getElementById('report-inspector-input');
    const inspectorVal = (selectedInspectorsList && selectedInspectorsList.length > 0)
        ? selectedInspectorsList.join(', ')
        : (inspectorInput ? inspectorInput.value.trim() : '');
    const sheetInspector = document.getElementById('sheet-inspector');
    if (sheetInspector) {
        sheetInspector.textContent = inspectorVal || '-';
    }

    // 4. S/N 및 설치장소 한 번에 반영
    if (matchedEquip) {
        updateSheetSerialNo(matchedEquip);
        updateSheetLocation(matchedEquip);
    }

    // 신규 생성이므로 currentReportId 초기화 및 기존 스크롤 박스 선택 해제
    currentReportId = null;
    document.querySelectorAll('.saved-history-card').forEach(c => c.classList.remove('selected'));

    // 5. 참고할 보고서가 선택되어 있는지 확인
    const historySelect = document.getElementById('report-history-select');
    const refReportId = historySelect ? historySelect.value : '';

    if (refReportId) {
        try {
            const res = await fetch(`/api/report/${refReportId}`);
            if (res.ok) {
                const json = await res.json();
                const report = json.report || {};
                let sheetData = {};
                if (report.data && typeof report.data === 'object' && Object.keys(report.data).length > 0) {
                    sheetData = report.data;
                } else if (typeof report.data_json === 'string') {
                    try { sheetData = JSON.parse(report.data_json); } catch (e) { }
                } else if (report.data_json && typeof report.data_json === 'object') {
                    sheetData = report.data_json;
                }

                // 1. 현재 점검일자의 DB 기초 정보 먼저 로드
                await loadSourceDataFromDb(false);

                // 2. 참고 보고서의 파라미터 테이블 항목 복사 반영
                if (sheetData.parameters && Array.isArray(sheetData.parameters) && sheetData.parameters.length > 0) {
                    renderParametersTable(sheetData.parameters);
                }

                // 3. 참고 보고서의 체크박스 상태 복사 반영
                if (sheetData.checkboxes) {
                    Object.entries(sheetData.checkboxes).forEach(([key, isChecked]) => {
                        let item = document.querySelector(`.report-check-item[data-key="${key}"]`);
                        if (!item) {
                            const box = document.getElementById(key);
                            if (box) item = box.closest('.report-check-item');
                        }
                        if (item) {
                            const box = item.querySelector('.check-box');
                            if (box) {
                                box.textContent = isChecked ? '■' : '□';
                                if (isChecked) item.classList.add('checked');
                                else item.classList.remove('checked');
                            }
                        }
                    });
                }

                // 4. 참고 보고서의 작성된 이력/메모 복사 반영
                const copyIfSet = (elId, val) => {
                    if (!val) return;
                    const el = document.getElementById(elId);
                    if (el) {
                        if (typeof val === 'string' && (val.includes('<') || val.includes('&'))) {
                            el.innerHTML = val;
                        } else {
                            el.textContent = val;
                        }
                    }
                };

                copyIfSet('sheet-work-log', sheetData.work_log);
                copyIfSet('sheet-equip-check-state', sheetData.equip_check_state);
                copyIfSet('sheet-replaced-parts', sheetData.replaced_parts);
                copyIfSet('sheet-agreed-matters', sheetData.agreed_matters || sheetData.manager_discussion);
                copyIfSet('sheet-next-plans', sheetData.next_plans || sheetData.next_schedule);
                copyIfSet('sheet-special-notes', sheetData.special_notes);

                // 점검일자, 점검자, 장비 정보는 현재 선택값으로 확실히 유지
                updateSheetInspectDate(dateVal);
                if (sheetInspector) sheetInspector.textContent = inspectorVal || '-';
                if (matchedEquip) {
                    updateSheetSerialNo(matchedEquip);
                    updateSheetLocation(matchedEquip);
                }

                saveReportWorkspaceState();
                return;
            }
        } catch (err) {
            console.error('Failed to load referenced report:', err);
        }
    }

    // [요청 반영] 참고 보고서 미선택 시 이전 작업 흔적 없이 완전한 초기 상태 보고서 양식으로 깨끗하게 초기화
    resetSheetToCleanState();
    await loadSourceDataFromDb(false);

    // DB 데이터 로드 후에도 선택한 점검일자, 점검자, 장비 정보가 확실히 유지되도록 재반영
    updateSheetInspectDate(dateVal);
    if (sheetInspector) sheetInspector.textContent = inspectorVal || '-';
    if (matchedEquip) {
        updateSheetSerialNo(matchedEquip);
        updateSheetLocation(matchedEquip);
    }

    saveReportWorkspaceState();
}

// [요청 반영] 2. Data 메뉴의 parameter 점검 데이터 조회 후 점검 항목 리스트 추가 (측정값 -> 상태)
async function loadDataParameters() {
    if (!selectedEquipId) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }

    // 보고서 시트가 닫혀있다면 먼저 표시
    showReportSheet();

    const dateInput = document.getElementById('report-date-input');
    const dateVal = dateInput ? dateInput.value : '';

    try {
        const url = `/api/report/data_parameters?equip_id=${encodeURIComponent(selectedEquipId)}&date=${encodeURIComponent(dateVal)}&site_name=${encodeURIComponent(selectedSiteName)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('파라미터 데이터 조회 실패');

        const json = await res.json();
        if (json.status !== 'success') {
            alert(json.message || 'Data 파라미터 점검값을 불러올 수 없습니다.');
            return;
        }

        const items = json.items || [];
        if (items.length === 0) {
            alert('Data 메뉴에 등록된 해당 장비의 파라미터 점검 데이터가 없습니다.\n(Data 메뉴에서 먼저 파라미터를 점검하고 저장해주세요)');
            return;
        }

        // 파라미터 점검 테이블에 추가 (상태 열에 측정값 세팅)
        appendDataParametersToSheet(items, json.record_date);

    } catch (err) {
        console.error('Failed to load data parameters:', err);
        alert('Data 파라미터 점검값을 불러오는 중 오류가 발생했습니다.');
    }
}

// [요청 반영] Data 파라미터 점검 항목 리스트를 상단 테이블(report-params-tbody)에 반영 (상태 열에 측정값 채우기)
function appendDataParametersToSheet(items, recordDate) {
    if (!items || items.length === 0) return;

    // 상단 2열 분할 점검 항목 테이블에 렌더링
    renderParametersTable(items);
    debounceSaveReportState(100);

    alert(`Data 메뉴의 파라미터 점검값 ${items.length}건을 상단 점검 항목에 반영했습니다.\n(점검 항목, 정상범위, 상태: 측정값)`);
}

// 3. A4 시트 인터랙션 (체크박스 클릭 토글, 모든 편집 셀 입력 감지 및 점검자 동기화)
// ==============================================================================
// 상태 체크박스 요약 바 동적 관리 (행 추가/삭제, 옵션 2/3개 전환, 텍스트 편집)
// ==============================================================================
function getStatusRowsTbody() {
    return document.getElementById('report-status-tbody');
}

// 셀 내부 체크박스 옵션 개수 전환 (0개, 1개, 2개, 3개)
function changeStatusCellOptionCount(td, count) {
    if (!td) return;
    const group = td.getAttribute('data-group') || `status_grp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    td.setAttribute('data-group', group);

    // 기존 텍스트(자유 텍스트 영역 또는 체크박스 라벨) 수집
    const freeTextEl = td.querySelector('.status-free-text');
    let existingText = freeTextEl ? freeTextEl.textContent.trim() : '';

    const items = td.querySelectorAll('.report-check-item');
    const currentOpts = [];
    items.forEach(it => {
        const lbl = (it.querySelector('.report-check-label') || {}).textContent || it.getAttribute('data-val') || '';
        const box = it.querySelector('.check-box');
        const isChecked = box ? box.textContent.trim() === '■' : false;
        currentOpts.push({ text: lbl.trim() || '항목', checked: isChecked, isTextOnly: !box });
    });

    if (!existingText && currentOpts.length > 0) {
        existingText = currentOpts[0].text;
    }

    let newOpts = [];
    if (count === 0) {
        // [요청 반영] 0개: 체크박스 없음, 직접 텍스트 입력만 가능한 상태
        const defaultText = existingText || '특이사항 없음';
        newOpts = [{ text: defaultText, checked: false, isTextOnly: true }];
    } else if (count === 1) {
        // [요청 반영] 1개: 단일 체크박스
        const text1 = existingText || (currentOpts[0] && currentOpts[0].text) || '확인';
        newOpts = [{ text: text1, checked: true }];
    } else if (count === 2) {
        // 2개 체크박스
        if (currentOpts.length >= 2 && !currentOpts[0].isTextOnly && !currentOpts[1].isTextOnly) {
            newOpts = [currentOpts[0], currentOpts[1]];
        } else if (currentOpts.length === 1 && !currentOpts[0].isTextOnly) {
            newOpts = [currentOpts[0], { text: '무', checked: false }];
        } else {
            newOpts = [{ text: '유', checked: false }, { text: '무', checked: true }];
        }
    } else if (count === 3) {
        // 3개 체크박스
        if (currentOpts.length >= 3 && !currentOpts[0].isTextOnly) {
            newOpts = [currentOpts[0], currentOpts[1], currentOpts[2]];
        } else if (currentOpts.length === 2 && !currentOpts[0].isTextOnly) {
            newOpts = [currentOpts[0], currentOpts[1], { text: '정기', checked: false }];
        } else if (currentOpts.length === 1 && !currentOpts[0].isTextOnly) {
            newOpts = [currentOpts[0], { text: '이벤트', checked: false }, { text: '정기', checked: false }];
        } else {
            newOpts = [{ text: '예방', checked: false }, { text: '이벤트', checked: false }, { text: '정기', checked: true }];
        }
    }

    if (count > 0 && !newOpts.some(o => o.checked) && newOpts.length > 0) {
        newOpts[0].checked = true;
    }

    renderCheckGroupInCell(td, newOpts, group);

    // 0개 전환 시 즉시 텍스트 입력할 수 있도록 포커스 및 텍스트 블록 선택
    if (count === 0) {
        setTimeout(() => {
            const inputEl = td.querySelector('.status-free-text');
            if (inputEl) {
                inputEl.focus();
                try {
                    const range = document.createRange();
                    range.selectNodeContents(inputEl);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } catch (_) {}
            }
        }, 20);
    }

    debounceSaveReportState(100);
}

function renderCheckGroupHtml(opts, group) {
    if (!opts || opts.length === 0 || (opts.length === 1 && opts[0].isTextOnly)) {
        const text = (opts && opts[0] && opts[0].text !== undefined) ? opts[0].text : '특이사항 없음';
        return `
            <div class="status-free-text" contenteditable="true" spellcheck="false">${escapeHtml(text)}</div>
        `;
    }

    return opts.map((opt) => `
        <span class="report-check-item ${opt.checked ? 'checked' : ''}" data-group="${group}" data-val="${escapeHtml(opt.text)}">
            <span class="report-check-label" contenteditable="true" spellcheck="false">${escapeHtml(opt.text)}</span>
            <span class="check-box">${opt.checked ? '■' : '□'}</span>
        </span>
    `).join('\n<span class="opt-sep">/</span>\n');
}

function renderCheckGroupInCell(td, opts, group) {
    let groupContainer = td.querySelector('.status-check-group');
    if (!groupContainer) {
        groupContainer = document.createElement('div');
        groupContainer.className = 'status-check-group';
        td.appendChild(groupContainer);
    }
    groupContainer.innerHTML = renderCheckGroupHtml(opts, group);
}

// 새 상태 요약 행 추가
function addStatusRow(leftData = null, rightData = null) {
    const tbody = getStatusRowsTbody();
    if (!tbody) return;

    const rowIdx = tbody.children.length;
    const leftGrp = `status_row_${Date.now()}_${rowIdx}_left`;
    const rightGrp = `status_row_${Date.now()}_${rowIdx}_right`;

    const left = leftData || {
        label: '새 점검 항목',
        options: [{ text: '유', checked: false }, { text: '무', checked: true }]
    };

    const right = rightData || {
        label: '조치 및 상태',
        options: [{ text: '양호', checked: true }, { text: '관리 필요', checked: false }]
    };

    const tr = document.createElement('tr');
    tr.dataset.rowIdx = rowIdx;
    tr.innerHTML = `
        <th class="status-label-th" style="width: 20%;" contenteditable="true" spellcheck="false">${left.label || '새 점검 항목'}</th>
        <td class="status-check-td" style="width: 30%;" data-group="${leftGrp}">
            <div class="status-cell-controls no-print">
                <button type="button" class="btn-toggle-opts" data-count="0" title="체크박스 없음 (텍스트만)">0</button>
                <button type="button" class="btn-toggle-opts" data-count="1" title="1개 체크박스로 변경">1</button>
                <button type="button" class="btn-toggle-opts" data-count="2" title="2개 체크박스로 변경">2</button>
                <button type="button" class="btn-toggle-opts" data-count="3" title="3개 체크박스로 변경">3</button>
            </div>
            <div class="status-check-group">
                ${renderCheckGroupHtml(left.options || [], leftGrp)}
            </div>
        </td>
        <th class="status-label-th" style="width: 20%;" contenteditable="true" spellcheck="false">${right.label || '조치 및 상태'}</th>
        <td class="status-check-td" style="width: 30%;" data-group="${rightGrp}">
            <div class="status-cell-controls no-print">
                <button type="button" class="btn-toggle-opts" data-count="0" title="체크박스 없음 (텍스트만)">0</button>
                <button type="button" class="btn-toggle-opts" data-count="1" title="1개 체크박스로 변경">1</button>
                <button type="button" class="btn-toggle-opts" data-count="2" title="2개 체크박스로 변경">2</button>
                <button type="button" class="btn-toggle-opts" data-count="3" title="3개 체크박스로 변경">3</button>
                <button type="button" class="btn-del-status-row" title="이 줄 삭제">&times;</button>
            </div>
            <div class="status-check-group">
                ${renderCheckGroupHtml(right.options || [], rightGrp)}
            </div>
        </td>
    `;

    tbody.appendChild(tr);
    debounceSaveReportState(100);
}

// 요약 행 복원
function renderStatusRowsFromData(rowsData) {
    const tbody = getStatusRowsTbody();
    if (!tbody || !Array.isArray(rowsData) || rowsData.length === 0) return;

    tbody.innerHTML = '';
    rowsData.forEach(rowData => {
        addStatusRow(rowData.left, rowData.right);
    });
}

function initSheetInteractions() {
    const sheet = document.getElementById('working-report-sheet');
    if (!sheet) return;

    // 요약 행 추가 버튼 연결
    const btnAddStatusRow = document.getElementById('btn-add-status-row');
    if (btnAddStatusRow) {
        btnAddStatusRow.onclick = () => addStatusRow();
    }

    // [요청 반영] 체크박스 설정 버튼 토글 (0, 1, 2, 3 옵션 컨트롤 표시/숨김)
    const btnToggleConfig = document.getElementById('btn-toggle-status-config');
    if (btnToggleConfig) {
        btnToggleConfig.onclick = (e) => {
            e.preventDefault();
            const wrapper = document.getElementById('report-status-bar-wrapper');
            if (!wrapper) return;
            const isConfig = wrapper.classList.toggle('config-mode');
            btnToggleConfig.classList.toggle('active', isConfig);
            btnToggleConfig.innerHTML = isConfig 
                ? '⚙️ 체크박스 설정 닫기' 
                : '⚙️ 체크박스 설정';
        };
    }

    sheet.addEventListener('click', (e) => {
        // [추가] 옵션 개수 전환 (0개 / 1개 / 2개 / 3개) 버튼 클릭
        const btnToggleOpt = e.target.closest('.btn-toggle-opts');
        if (btnToggleOpt) {
            e.preventDefault();
            e.stopPropagation();
            const td = btnToggleOpt.closest('.status-check-td');
            const count = parseInt(btnToggleOpt.getAttribute('data-count'), 10);
            if (td && count !== null && !isNaN(count)) {
                changeStatusCellOptionCount(td, count);
            }
            return;
        }

        // [추가] 요약 행 삭제 버튼 클릭
        const btnDelRow = e.target.closest('.btn-del-status-row');
        if (btnDelRow) {
            e.preventDefault();
            e.stopPropagation();
            const tr = btnDelRow.closest('tr');
            if (tr) {
                const tbody = tr.parentElement;
                if (tbody && tbody.children.length <= 1) {
                    alert('최소 1개의 상태 요약 행은 유지되어야 합니다.');
                    return;
                }
                tr.remove();
                debounceSaveReportState(100);
            }
            return;
        }

        // [추가] 파라미터 행 삭제 버튼 클릭 (각 행 우측 끝 버튼)
        const btnDelParam = e.target.closest('.btn-del-param-row');
        if (btnDelParam) {
            e.preventDefault();
            e.stopPropagation();
            const tr = btnDelParam.closest('tr');
            if (tr) {
                const tbody = tr.parentElement;
                if (tbody && tbody.children.length <= 1) {
                    alert('최소 1개의 파라미터 행은 유지되어야 합니다.');
                    return;
                }
                tr.remove();
                debounceSaveReportState(100);
            }
            return;
        }

        // [추가] 자유 텍스트 입력 영역 또는 체크박스 라벨 텍스트 클릭 시 체크박스 토글 방지 (텍스트 편집 허용)
        if (e.target.closest('.status-free-text') || e.target.closest('.report-check-label')) {
            return;
        }

        const checkItem = e.target.closest('.report-check-item');
        if (!checkItem) return;

        e.preventDefault();
        const box = checkItem.querySelector('.check-box');
        if (!box) return;

        const group = checkItem.getAttribute('data-group');
        const isCurrentlyChecked = box.textContent.trim() === '■';

        if (group) {
            // 동일 그룹 라디오 토글
            const siblings = sheet.querySelectorAll(`.report-check-item[data-group="${group}"]`);
            siblings.forEach(sib => {
                const sibBox = sib.querySelector('.check-box');
                if (sibBox) sibBox.textContent = '□';
                sib.classList.remove('checked');
            });
            if (!isCurrentlyChecked) {
                box.textContent = '■';
                checkItem.classList.add('checked');
            }
        } else {
            // 단일 토글
            if (isCurrentlyChecked) {
                box.textContent = '□';
                checkItem.classList.remove('checked');
            } else {
                box.textContent = '■';
                checkItem.classList.add('checked');
            }
        }

        // [상태 유지] 체크박스 상태 즉시 세션 저장
        debounceSaveReportState(100);
    });

    // [상태 유지] 시트 내 모든 편집 셀(점검자, 타이틀, 파라미터, 텍스트 블록 등) 내용 수정 시 실시간 세션 저장
    sheet.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'sheet-inspector') {
            const val = e.target.textContent.trim();
            const inspectorInput = document.getElementById('report-inspector-input');
            if (inspectorInput && inspectorInput.value !== val) {
                inspectorInput.value = val;
            }
        }
        debounceSaveReportState(250);
    });

    // [요청 반영] 파라미터 점검 테이블에서 Enter / 위아래 방향키 입력 시 아래칸/위칸으로 이동
    sheet.addEventListener('keydown', (e) => {
        const td = e.target.closest('#report-params-tbody td');
        if (!td) return;

        if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            const tr = td.parentElement;
            const cellIndex = Array.from(tr.children).indexOf(td);
            const nextTr = tr.nextElementSibling;
            if (nextTr && nextTr.children[cellIndex]) {
                const nextCell = nextTr.children[cellIndex];
                nextCell.focus();
                try {
                    const range = document.createRange();
                    range.selectNodeContents(nextCell);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } catch (_) {}
            } else {
                td.blur();
            }
            debounceSaveReportState(100);
        } else if (e.key === 'ArrowUp') {
            const tr = td.parentElement;
            const cellIndex = Array.from(tr.children).indexOf(td);
            const prevTr = tr.previousElementSibling;
            if (prevTr && prevTr.children[cellIndex]) {
                e.preventDefault();
                const prevCell = prevTr.children[cellIndex];
                prevCell.focus();
                try {
                    const range = document.createRange();
                    range.selectNodeContents(prevCell);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } catch (_) {}
            }
        }
    });
}

// 4. 검색 가능한 커스텀 제안박스(Suggestion Box) 초기화
function initSuggestionBoxes() {
    // 사업장 제안박스
    const siteWrapper = document.getElementById('report-site-wrapper');
    const siteInput = document.getElementById('report-site-input');
    const siteDropdown = document.getElementById('report-site-dropdown');

    if (siteInput && siteWrapper && siteDropdown) {
        siteInput.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllSuggestionDropdowns();
            renderSiteSuggestions(siteInput.value.trim());
            siteWrapper.classList.add('open');
        });

        siteInput.addEventListener('input', () => {
            renderSiteSuggestions(siteInput.value.trim());
            siteWrapper.classList.add('open');
        });

        // [요청 반영] 사업장 검색 후 Enter 시 바로 적용 및 장비 입력창으로 이동
        siteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const kw = siteInput.value.trim().toLowerCase();
                let matchedSite = null;

                if (kw) {
                    matchedSite = allSitesList.find(s => (s.name || s).toLowerCase() === kw);
                    if (!matchedSite) {
                        matchedSite = allSitesList.find(s => (s.name || s).toLowerCase().includes(kw));
                    }
                } else if (allSitesList.length > 0) {
                    matchedSite = allSitesList[0];
                }

                if (matchedSite) {
                    const siteName = matchedSite.name || matchedSite;
                    selectSite(siteName);

                    // 장비 입력창으로 즉시 포커스 이동 및 장비 제안박스 오픈
                    setTimeout(() => {
                        const equipInput = document.getElementById('report-equip-input');
                        const equipWrapper = document.getElementById('report-equip-wrapper');
                        if (equipInput && !equipInput.disabled) {
                            equipInput.focus();
                            closeAllSuggestionDropdowns();
                            renderEquipSuggestions('');
                            if (equipWrapper) equipWrapper.classList.add('open');
                        }
                    }, 80);
                }
            }
        });
    }

    // 장비 제안박스
    const equipWrapper = document.getElementById('report-equip-wrapper');
    const equipInput = document.getElementById('report-equip-input');
    const equipDropdown = document.getElementById('report-equip-dropdown');

    if (equipInput && equipWrapper && equipDropdown) {
        equipInput.addEventListener('click', (e) => {
            if (equipInput.disabled) return;
            e.stopPropagation();
            closeAllSuggestionDropdowns();
            renderEquipSuggestions(equipInput.value.trim());
            equipWrapper.classList.add('open');
        });

        equipInput.addEventListener('input', () => {
            if (equipInput.disabled) return;
            renderEquipSuggestions(equipInput.value.trim());
            equipWrapper.classList.add('open');
        });

        // [요청 반영] 장비 검색 후 방향키(ArrowDown/ArrowUp) 이동 및 Enter 선택 지원
        equipInput.addEventListener('keydown', (e) => {
            const isOpen = equipWrapper.classList.contains('open');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!isOpen) {
                    closeAllSuggestionDropdowns();
                    renderEquipSuggestions(equipInput.value.trim());
                    equipWrapper.classList.add('open');
                    setEquipHighlight(0);
                } else {
                    setEquipHighlight(highlightedEquipIndex + 1);
                }
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!isOpen) {
                    closeAllSuggestionDropdowns();
                    renderEquipSuggestions(equipInput.value.trim());
                    equipWrapper.classList.add('open');
                    setEquipHighlight(currentFilteredEquips.length - 1);
                } else {
                    setEquipHighlight(highlightedEquipIndex - 1);
                }
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                // 1. 방향키로 탐색하여 하이라이트된 장비가 있으면 즉시 선택
                if (highlightedEquipIndex >= 0 && currentFilteredEquips[highlightedEquipIndex]) {
                    selectEquipment(currentFilteredEquips[highlightedEquipIndex]);
                    return;
                }

                // 2. 하이라이트가 없는 경우 검색어 기반 매칭 또는 목록 첫 번째 장비 선택
                const kw = equipInput.value.trim().toLowerCase();
                const siteEquips = selectedSiteName 
                    ? allEquipmentList.filter(eq => eq.site_name === selectedSiteName)
                    : allEquipmentList;

                let matchedEquip = null;
                if (kw) {
                    matchedEquip = siteEquips.find(eq => {
                        const abbr = (eq.model_abbr || '').toLowerCase();
                        const cust = (eq.cust_equip_name || '').toLowerCase();
                        const serial = (eq.serial_no || '').toLowerCase();
                        return abbr === kw || cust === kw || serial === kw;
                    });
                    if (!matchedEquip) {
                        matchedEquip = siteEquips.find(eq => {
                            const abbr = (eq.model_abbr || '').toLowerCase();
                            const cust = (eq.cust_equip_name || '').toLowerCase();
                            const model = (eq.model_name || eq.name || '').toLowerCase();
                            const serial = (eq.serial_no || '').toLowerCase();
                            return abbr.includes(kw) || cust.includes(kw) || model.includes(kw) || serial.includes(kw);
                        });
                    }
                } else if (currentFilteredEquips.length > 0) {
                    matchedEquip = currentFilteredEquips[0];
                } else if (siteEquips.length > 0) {
                    matchedEquip = siteEquips[0];
                }

                if (matchedEquip) {
                    selectEquipment(matchedEquip);
                }
                return;
            }

            if (e.key === 'Escape') {
                closeAllSuggestionDropdowns();
                return;
            }
        });
    }

    // 점검자 제안박스
    const inspectorWrapper = document.getElementById('report-inspector-wrapper');
    const inspectorInput = document.getElementById('report-inspector-input');
    const inspectorDropdown = document.getElementById('report-inspector-dropdown');

    if (inspectorInput && inspectorWrapper && inspectorDropdown) {
        inspectorInput.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllSuggestionDropdowns();
            renderInspectorSuggestions('');
            inspectorWrapper.classList.add('open');
            setTimeout(() => {
                const sInput = document.getElementById('inspector-search-input');
                if (sInput) sInput.focus();
            }, 60);
        });

        // 외부 input에서 직접 텍스트로 수정 시 선택 목록 동기화
        inspectorInput.addEventListener('input', () => {
            const val = inspectorInput.value;
            selectedInspectorsList = val.split(',').map(s => s.trim()).filter(Boolean);
            // [요청 반영] 실시간 시트 반영 제외 (보고서 생성 버튼 클릭 시 한 번에 반영)
            debounceSaveReportState(100);
        });

        inspectorInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllSuggestionDropdowns();
                return;
            }
        });
    }

    // 외부 클릭 시 모든 제안박스 닫기
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.report-suggest-wrapper')) {
            closeAllSuggestionDropdowns();
        }
    });
}

function closeAllSuggestionDropdowns() {
    document.querySelectorAll('.report-suggest-wrapper').forEach(w => w.classList.remove('open'));
    highlightedEquipIndex = -1;
    highlightedInspectorIndex = -1;
}

// Rule #9: 모바일 터치 스크롤 시 자동 선택 방지 헬퍼 바인딩
function bindScrollSafeClick(element, callback) {
    let touchStartX = 0;
    let touchStartY = 0;
    let isScrollMove = false;

    element.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        isScrollMove = false;
    }, { passive: true });

    element.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        const diffX = Math.abs(touch.clientX - touchStartX);
        const diffY = Math.abs(touch.clientY - touchStartY);
        if (diffX > 6 || diffY > 6) {
            isScrollMove = true;
        }
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
        if (!isScrollMove) {
            e.preventDefault();
            callback();
        }
    });

    element.addEventListener('click', (e) => {
        if (!isScrollMove) {
            callback();
        }
    });
}

// 5. 사이트 제안박스 목록 렌더링
function renderSiteSuggestions(filterKeyword = '') {
    const dropdown = document.getElementById('report-site-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    const kw = filterKeyword.toLowerCase();
    const filtered = allSitesList.filter(s => !kw || (s.name || s).toLowerCase().includes(kw));

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="report-suggest-empty">일치하는 사업장이 없습니다.</div>';
        return;
    }

    filtered.forEach(site => {
        const siteName = site.name || site;
        const item = document.createElement('div');
        item.className = 'report-suggest-item';
        if (siteName === selectedSiteName) item.classList.add('selected');

        item.innerHTML = `
            <span>${escapeHtml(siteName)}</span>
            <span style="font-size: 11px; color: var(--side-muted);">${escapeHtml(site.group || '')}</span>
        `;

        bindScrollSafeClick(item, () => {
            selectSite(siteName);
        });

        dropdown.appendChild(item);
    });
}

// 6. 사업장 선택 처리
function selectSite(siteName) {
    selectedSiteName = siteName;
    const siteInput = document.getElementById('report-site-input');
    const siteSelect = document.getElementById('report-site-select');
    if (siteInput) siteInput.value = siteName;
    if (siteSelect) siteSelect.value = siteName;

    closeAllSuggestionDropdowns();

    // 장비 목록 필터링 및 활성화
    const equipInput = document.getElementById('report-equip-input');
    const equipSelect = document.getElementById('report-equip-select');
    if (equipInput) {
        equipInput.disabled = false;
        equipInput.placeholder = '장비를 선택하거나 검색...';
        equipInput.value = '';
    }
    if (equipSelect) equipSelect.disabled = false;

    // [요청 반영] 사업장 선택 시 첫 번째 장비를 자동 선택하지 않고, 빈 상태로 대기하여 사용자가 직접 선택하도록 개선
    selectedEquipId = '';
    currentReportId = null;

    const siteEquips = allEquipmentList.filter(eq => eq.site_name === siteName);
    if (siteEquips.length === 0) {
        if (equipInput) equipInput.placeholder = '등록된 장비 없음';
    }

    // 이력 셀렉트 및 스크롤 박스 초기화
    const historySelect = document.getElementById('report-history-select');
    const historyCount = document.getElementById('report-history-count');
    const scrollBox = document.getElementById('saved-history-scroll-box');
    const savedBadge = document.getElementById('saved-history-badge');
    if (historySelect) {
        historySelect.innerHTML = '<option value="">장비를 먼저 선택해주세요</option>';
        historySelect.disabled = true;
    }
    if (historyCount) historyCount.textContent = '0건';
    if (scrollBox) {
        scrollBox.innerHTML = '<div class="saved-history-empty">장비를 선택하면 저장된 보고서가 표시됩니다.</div>';
    }
    if (savedBadge) savedBadge.textContent = '0건';

    // [요청 반영] 실시간 시트 반영 제외 (보고서 생성 버튼 클릭 시 한 번에 반영)
    debounceSaveReportState(100);
}

// 7. 장비 모델명 약어 및 표시명 반환 헬퍼
function getEquipModelAbbr(eq) {
    if (!eq) return '';
    return (eq.model_abbr || eq.model_name || eq.name || '').trim();
}

function getEquipDisplayName(eq) {
    if (!eq) return '';
    const abbr = getEquipModelAbbr(eq);
    const main = (eq.cust_equip_name || '').trim() || (eq.serial_no || '').trim() || (eq.name || '장비');
    return abbr ? `[${abbr}] ${main}` : main;
}

// 7-0. 장비 제안박스 키보드 하이라이트 제어
function setEquipHighlight(index) {
    const dropdown = document.getElementById('report-equip-dropdown');
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.report-suggest-item');
    if (items.length === 0) {
        highlightedEquipIndex = -1;
        return;
    }

    if (index < 0) {
        index = items.length - 1;
    } else if (index >= items.length) {
        index = 0;
    }

    items.forEach(el => el.classList.remove('highlighted'));
    highlightedEquipIndex = index;
    const target = items[index];
    if (target) {
        target.classList.add('highlighted');
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// 7-1. 장비 제안박스 목록 렌더링
function renderEquipSuggestions(filterKeyword = '') {
    const dropdown = document.getElementById('report-equip-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    const siteEquips = selectedSiteName 
        ? allEquipmentList.filter(eq => eq.site_name === selectedSiteName)
        : allEquipmentList;

    const kw = filterKeyword.toLowerCase();
    const filtered = siteEquips.filter(eq => {
        if (!kw) return true;
        const abbr = (eq.model_abbr || '').toLowerCase();
        const cust = (eq.cust_equip_name || '').toLowerCase();
        const model = (eq.model_name || eq.name || '').toLowerCase();
        const serial = (eq.serial_no || '').toLowerCase();
        return abbr.includes(kw) || cust.includes(kw) || model.includes(kw) || serial.includes(kw);
    });

    currentFilteredEquips = filtered;
    highlightedEquipIndex = -1;

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="report-suggest-empty">일치하는 장비가 없습니다.</div>';
        return;
    }

    filtered.forEach((eq, idx) => {
        const item = document.createElement('div');
        item.className = 'report-suggest-item';
        item.dataset.index = idx;
        if (eq.id === selectedEquipId) item.classList.add('selected');

        const abbr = getEquipModelAbbr(eq);
        // [요청 반영] 제안박스에 시리얼넘버 대신 고객사 장비명이 나오고, 고객사 장비명이 없으면 시리얼넘버 노출
        const rightText = (eq.cust_equip_name || '').trim() 
            ? eq.cust_equip_name.trim() 
            : (eq.serial_no ? eq.serial_no.trim() : '');

        item.innerHTML = `
            <span><strong>${escapeHtml(abbr || eq.name)}</strong></span>
            <span style="font-size: 12px; font-weight: 600; color: var(--side-accent, #2563eb);">${escapeHtml(rightText)}</span>
        `;

        item.addEventListener('mouseenter', () => {
            setEquipHighlight(idx);
        });

        bindScrollSafeClick(item, () => {
            selectEquipment(eq);
        });

        dropdown.appendChild(item);
    });
}

// 8. 장비 선택 처리 (모델명약어 + 고객사장비명 표시, 참고 보고서 이력 갱신)
function selectEquipment(eq) {
    selectedEquipId = eq.id;
    highlightedEquipIndex = -1;
    // [요청 반영] 장비 선택 시 모델명 약어 나오고 고객사 장비명 나오게 적용 (없으면 시리얼넘버)
    const displayName = getEquipDisplayName(eq);
    
    const equipInput = document.getElementById('report-equip-input');
    const equipSelect = document.getElementById('report-equip-select');
    if (equipInput) equipInput.value = displayName;
    if (equipSelect) equipSelect.value = eq.id;

    // [요청 반영] 실시간 시트 반영 제외 (보고서 생성 버튼 클릭 시 한 번에 반영)
    // 참고할 이전 보고서 이력 목록만 백그라운드 갱신
    loadReportHistory(eq.id);

    closeAllSuggestionDropdowns();
    debounceSaveReportState(100);
}

// 9-0. 점검자 다중 선택 헬퍼 함수들
function getSelectedInspectors() {
    if (selectedInspectorsList && selectedInspectorsList.length > 0) {
        return selectedInspectorsList;
    }
    const inspectorInput = document.getElementById('report-inspector-input');
    if (!inspectorInput) return [];
    selectedInspectorsList = inspectorInput.value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    return selectedInspectorsList;
}

function setInspectorsValue(namesList) {
    selectedInspectorsList = Array.from(new Set((namesList || []).map(s => String(s).trim()).filter(Boolean)));
    const val = selectedInspectorsList.join(', ');
    const inspectorInput = document.getElementById('report-inspector-input');
    if (inspectorInput) inspectorInput.value = val;

    // [요청 반영] 실시간 시트 반영 제외 (보고서 생성 버튼 클릭 시 한 번에 반영)
    debounceSaveReportState(100);
}

function updateInspectorDropdownUI(selectedList) {
    const dropdown = document.getElementById('report-inspector-dropdown');
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.report-suggest-item.inspector-item');
    items.forEach(item => {
        const name = item.dataset.workerName;
        const isSelected = selectedList.includes(name);
        const chk = item.querySelector('.inspector-chk-box');
        if (isSelected) {
            item.classList.add('selected');
            if (chk) {
                chk.classList.add('checked');
                chk.textContent = '✓';
            }
        } else {
            item.classList.remove('selected');
            if (chk) {
                chk.classList.remove('checked');
                chk.textContent = '';
            }
        }
    });

    const badge = dropdown.querySelector('#inspector-selected-count');
    if (badge) badge.textContent = selectedList.length;
}

function toggleInspector(workerName) {
    if (!workerName) return;
    workerName = workerName.trim();
    let selected = [...getSelectedInspectors()];
    if (selected.includes(workerName)) {
        selected = selected.filter(n => n !== workerName);
    } else {
        selected.push(workerName);
    }
    setInspectorsValue(selected);
    updateInspectorDropdownUI(selected);
}

function clearAllInspectors() {
    setInspectorsValue([]);
    updateInspectorDropdownUI([]);
}

// 9-1. 점검자 제안박스 렌더링 (검색창 분리 + 영구 선택 유지)
function renderInspectorSuggestions(filterKeyword = '') {
    const dropdown = document.getElementById('report-inspector-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = `
        <div class="inspector-search-wrapper" onclick="event.stopPropagation();">
            <input type="text" id="inspector-search-input" class="inspector-search-input" 
                   placeholder="점검자 이름 또는 부서 검색..." autocomplete="off">
        </div>
        <div class="inspector-items-container" id="inspector-items-container"></div>
        <div class="inspector-dropdown-footer" onclick="event.stopPropagation();">
            <span>선택: <strong id="inspector-selected-count">${getSelectedInspectors().length}</strong>명</span>
            <div style="display: flex; gap: 6px;">
                <button type="button" class="inspector-action-btn" id="btn-clear-inspectors">비우기</button>
                <button type="button" class="inspector-action-btn" id="btn-done-inspectors" style="color: #58a6ff; font-weight: bold;">완료</button>
            </div>
        </div>
    `;

    const searchInput = dropdown.querySelector('#inspector-search-input');
    if (searchInput) {
        searchInput.value = filterKeyword || '';
        searchInput.addEventListener('input', (e) => {
            e.stopPropagation();
            renderInspectorItemsOnly(searchInput.value.trim());
        });
        searchInput.addEventListener('click', (e) => e.stopPropagation());
        searchInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                closeAllSuggestionDropdowns();
            }
        });
    }

    const btnClear = dropdown.querySelector('#btn-clear-inspectors');
    if (btnClear) {
        btnClear.addEventListener('click', (e) => {
            e.stopPropagation();
            clearAllInspectors();
        });
    }

    const btnDone = dropdown.querySelector('#btn-done-inspectors');
    if (btnDone) {
        btnDone.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllSuggestionDropdowns();
        });
    }

    renderInspectorItemsOnly(filterKeyword || '');
}

// 점검자 항목 목록만 필터링하여 렌더링
function renderInspectorItemsOnly(kw = '') {
    const container = document.getElementById('inspector-items-container');
    if (!container) return;

    container.innerHTML = '';
    const searchKw = (kw || '').toLowerCase();
    const selectedList = getSelectedInspectors();

    const filtered = allWorkersList.filter(w => {
        if (!searchKw) return true;
        const name = (w.name || '').toLowerCase();
        const dept = (w.department || '').toLowerCase();
        const site = (w.site || '').toLowerCase();
        return name.includes(searchKw) || dept.includes(searchKw) || site.includes(searchKw);
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="report-suggest-empty">일치하는 작업자가 없습니다.</div>';
        return;
    }

    filtered.forEach((w, idx) => {
        const item = document.createElement('div');
        item.className = 'report-suggest-item inspector-item';
        const workerName = (w.name || '').trim();
        item.dataset.workerName = workerName;
        item.dataset.index = idx;

        const isSelected = selectedList.includes(workerName);
        if (isSelected) item.classList.add('selected');

        const deptInfo = [w.department, w.position].filter(Boolean).join(' ');

        item.innerHTML = `
            <div class="inspector-left">
                <span class="inspector-chk-box ${isSelected ? 'checked' : ''}">${isSelected ? '✓' : ''}</span>
                <span><strong>${escapeHtml(workerName)}</strong></span>
            </div>
            <span style="font-size: 11px; color: var(--side-muted);">${escapeHtml(deptInfo)} ${w.site ? `(${w.site})` : ''}</span>
        `;

        bindScrollSafeClick(item, () => {
            toggleInspector(workerName);
        });

        container.appendChild(item);
    });
}

// 10. 점검자 선택 처리 (기존 호환성 유지)
function selectInspector(workerName) {
    toggleInspector(workerName);
}

// 11. 점검자(작업자) 목록 로드
async function loadWorkersList() {
    try {
        const res = await fetch('/api/users/names');
        if (res.ok) {
            const json = await res.json();
            allWorkersList = json.workers || [];
        }
    } catch (err) {
        console.error('Failed to load workers list:', err);
    }
}

// 12. 사업장 및 장비 데이터 로드
async function loadSitesAndEquipment() {
    try {
        const [sitesRes, equipsRes] = await Promise.all([
            fetch('/api/sites'),
            fetch('/api/equipment')
        ]);

        if (sitesRes.ok) {
            allSitesList = await sitesRes.json();
            populateHiddenSiteSelect();
        }

        if (equipsRes.ok) {
            allEquipmentList = await equipsRes.json();
            populateHiddenEquipSelect();
            if (selectedEquipId) {
                const equipInput = document.getElementById('report-equip-input');
                if (equipInput && !equipInput.value) {
                    const matched = allEquipmentList.find(eq => eq.id === selectedEquipId);
                    if (matched) equipInput.value = getEquipDisplayName(matched);
                }
            }
        }

        // [요청 반영] 처음에는 사용자가 직접 사업장과 장비를 선택할 수 있도록 초기 자동 선택 생략
        // (사업장 선택창에 포커스/제안 드롭다운 제공)
    } catch (err) {
        console.error('Failed to load sites/equipment:', err);
    }
}

function populateHiddenSiteSelect() {
    const sel = document.getElementById('report-site-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 사업장 선택 --</option>';
    allSitesList.forEach(s => {
        const name = s.name || s;
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
}

function populateHiddenEquipSelect() {
    const sel = document.getElementById('report-equip-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 장비 선택 --</option>';
    allEquipmentList.forEach(eq => {
        const opt = document.createElement('option');
        opt.value = eq.id;
        opt.textContent = getEquipDisplayName(eq);
        opt.setAttribute('data-site', eq.site_name || '');
        opt.setAttribute('data-model', eq.model_name || eq.name || '');
        sel.appendChild(opt);
    });
}

// 13. 장비 또는 점검일자 변경 시 처리
async function onEquipmentOrDateChange() {
    if (!selectedEquipId) return;

    const dateInput = document.getElementById('report-date-input');
    const dateVal = dateInput ? dateInput.value : '';

    // 이력 목록 갱신 (참고용 드롭다운 + 스크롤 박스)
    await loadReportHistory(selectedEquipId);

    // 해당 날짜에 저장된 보고서 확인 (스크롤 박스 카드 기준)
    const scrollBox = document.getElementById('saved-history-scroll-box');
    let matchedCard = null;
    if (scrollBox && dateVal) {
        matchedCard = scrollBox.querySelector(`.saved-history-card[data-date="${dateVal}"]`);
    }

    if (isReportActive) {
        if (matchedCard) {
            const savedId = matchedCard.getAttribute('data-id');
            document.querySelectorAll('.saved-history-card').forEach(c => c.classList.remove('selected'));
            matchedCard.classList.add('selected');
            await loadSavedReport(savedId);
        } else {
            currentReportId = null;
            document.querySelectorAll('.saved-history-card').forEach(c => c.classList.remove('selected'));
            await loadSourceDataFromDb(false);
        }
    }
}

// 14. 장비별 저장된 보고서 이력 조회 (참고용 드롭다운 + 파라미터 도구 위 스크롤 박스 목록)
async function loadReportHistory(equipId) {
    const historySelect = document.getElementById('report-history-select');
    const historyCount = document.getElementById('report-history-count');
    const scrollBox = document.getElementById('saved-history-scroll-box');
    const savedBadge = document.getElementById('saved-history-badge');

    if (!equipId) {
        if (historySelect) {
            historySelect.innerHTML = '<option value="">장비를 먼저 선택해주세요</option>';
            historySelect.disabled = true;
        }
        if (historyCount) historyCount.textContent = '0건';
        if (scrollBox) {
            scrollBox.innerHTML = '<div class="saved-history-empty">장비를 선택하면 저장된 보고서가 표시됩니다.</div>';
        }
        if (savedBadge) savedBadge.textContent = '0건';
        return;
    }

    try {
        const res = await fetch(`/api/report/history?equip_id=${encodeURIComponent(equipId)}`);
        if (!res.ok) throw new Error('이력 조회 실패');
        const json = await res.json();
        const reports = json.history || [];

        // 1. [생성 시 참고용 드롭다운]
        if (historySelect) {
            historySelect.innerHTML = '<option value="">-- 참고 안 함 (기본 DB 데이터 생성) --</option>';
            if (reports.length > 0) {
                historySelect.disabled = false;
                reports.forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r.id;
                    opt.setAttribute('data-date', r.report_date);
                    opt.textContent = `[${r.report_date}] ${r.title || '보고서'} (${r.inspector || '미지정'})`;
                    historySelect.appendChild(opt);
                });
            } else {
                historySelect.disabled = true;
            }
        }
        if (historyCount) historyCount.textContent = `${reports.length}건`;

        // 2. [진짜로 저장된 보고서 이력 스크롤 박스]
        if (savedBadge) savedBadge.textContent = `${reports.length}건`;
        if (scrollBox) {
            scrollBox.innerHTML = '';
            if (reports.length === 0) {
                scrollBox.innerHTML = '<div class="saved-history-empty">해당 장비에 저장된 보고서가 없습니다.</div>';
            } else {
                reports.forEach(r => {
                    const card = document.createElement('div');
                    card.className = 'saved-history-card';
                    card.setAttribute('data-id', r.id);
                    card.setAttribute('data-date', r.report_date);

                    if (currentReportId && String(currentReportId) === String(r.id)) {
                        card.classList.add('selected');
                    }

                    const inspectorName = escapeHtml(r.inspector || '미지정');
                    const titleText = escapeHtml(r.title || 'Working Report');

                    card.innerHTML = `
                        <div class="card-top">
                            <span class="card-date">📅 ${r.report_date}</span>
                            <span class="card-inspector">${inspectorName}</span>
                        </div>
                        <div class="card-title-row">
                            <span class="card-title" title="${titleText}">${titleText}</span>
                            <button type="button" class="btn-card-delete" title="이 저장된 보고서 삭제">&times;</button>
                        </div>
                    `;

                    // [요청 반영] 해당 리스트 제목 오른쪽 x 버튼 클릭 시 삭제
                    const btnDel = card.querySelector('.btn-card-delete');
                    if (btnDel) {
                        btnDel.addEventListener('click', async (e) => {
                            e.stopPropagation(); // 카드 로드 방지
                            if (!confirm(`[${r.report_date}] 저장된 보고서를 정말 삭제하시겠습니까?`)) return;

                            try {
                                const res = await fetch(`/api/report/${r.id}`, { method: 'DELETE' });
                                if (!res.ok) throw new Error('삭제 실패');

                                if (currentReportId && String(currentReportId) === String(r.id)) {
                                    currentReportId = null;
                                    resetSheetToCleanState();
                                }

                                await loadReportHistory(selectedEquipId);
                                saveReportWorkspaceState();
                            } catch (err) {
                                console.error('Failed to delete report:', err);
                                alert('보고서 삭제 중 오류가 발생했습니다.');
                            }
                        });
                    }

                    // [요청 반영] 박스 스크롤 리스트에서 클릭하면 해당 보고서가 즉시 시트에 로드되어 나옴
                    card.addEventListener('click', async () => {
                        if (_reportStateDebounceTimer) clearTimeout(_reportStateDebounceTimer);
                        document.querySelectorAll('.saved-history-card').forEach(c => c.classList.remove('selected'));
                        card.classList.add('selected');

                        showReportSheet();
                        await loadSavedReport(r.id);
                    });

                    scrollBox.appendChild(card);
                });
            }
        }
    } catch (err) {
        console.error('Failed to load report history:', err);
    }
}

// 15. DB 소스 데이터 조회 및 시트 초기화
async function loadSourceDataFromDb(showNotice = true) {
    if (!selectedEquipId) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }

    const dateInput = document.getElementById('report-date-input');
    const dateVal = dateInput ? dateInput.value : '';

    try {
        const res = await fetch(`/api/report/source_data?equip_id=${encodeURIComponent(selectedEquipId)}&date=${encodeURIComponent(dateVal)}&site_name=${encodeURIComponent(selectedSiteName)}`);
        if (!res.ok) throw new Error('소스 데이터 조회 실패');
        const json = await res.json();
        const data = json.data || {};

        applySourceDataToSheet(data, dateVal);
        debounceSaveReportState(100);

        if (showNotice) {
            alert('DB에서 최신 장비 정보 및 점검 항목을 불러왔습니다.');
        }
    } catch (err) {
        console.error('Failed to load source data:', err);
        alert('DB 데이터를 불러오는 중 오류가 발생했습니다.');
    }
}

// 16. 소스 데이터를 시트 DOM에 반영
function applySourceDataToSheet(data, dateVal) {
    const modelName = data.model_name || 'ICAP-RQ';

    // 타이틀
    const sheetTitle = document.getElementById('sheet-title');
    if (sheetTitle) sheetTitle.textContent = `${modelName} Working Report`;

    // 메타 정보: 점검자
    const inspectorInput = document.getElementById('report-inspector-input');
    const sheetInspector = document.getElementById('sheet-inspector');
    if (sheetInspector) {
        if (inspectorInput && inspectorInput.value.trim()) {
            sheetInspector.textContent = inspectorInput.value.trim();
        } else if (data.inspector) {
            sheetInspector.textContent = data.inspector;
            if (inspectorInput) inspectorInput.value = data.inspector;
        }
    }

    const matchedEquip = allEquipmentList.find(eq => eq.id === selectedEquipId);

    // [요청 반영] 메타 정보: 설치 장소 (사업장명으로 기록)
    updateSheetLocation(data.site_name ? data : matchedEquip);

    // [요청 반영] 메타 정보: S/N (고객사 장비명 또는 시리얼 넘버 자동 반영)
    const snData = {
        cust_equip_name: data.cust_equip_name || (matchedEquip ? matchedEquip.cust_equip_name : ''),
        serial_no: data.serial_no || (matchedEquip ? (matchedEquip.serial_no || matchedEquip.serial) : '')
    };
    updateSheetSerialNo(snData);

    // [요청 반영] 메타 정보: 점검일 자동 반영
    updateSheetInspectDate(dateVal);

    // 파라미터 점검 테이블 (2열 분할 렌더링)
    currentModelParameters = data.model_params || [];
    renderParametersTable(currentModelParameters);

    // 관리 이력
    const sheetWorkLog = document.getElementById('sheet-work-log') || document.getElementById('sheet-history-content');
    if (sheetWorkLog) {
        if (data.history_items && data.history_items.length > 0) {
            sheetWorkLog.textContent = data.history_items.join('\n');
        } else {
            sheetWorkLog.textContent = '-. 정기 점검 수행 (특이사항 없음)';
        }
    }

    // 교체 물품
    const sheetReplacedParts = document.getElementById('sheet-replaced-parts');
    if (sheetReplacedParts) {
        if (data.replaced_parts && data.replaced_parts.length > 0) {
            sheetReplacedParts.textContent = data.replaced_parts.join(', ');
        } else {
            sheetReplacedParts.textContent = '해당사항 없음';
        }
    }

    // 2. 점검 전/후 설비 구동상태
    const sheetDriveStatus = document.getElementById('sheet-drive-status') || document.getElementById('sheet-equip-check-state');
    if (sheetDriveStatus && (!sheetDriveStatus.textContent.trim() || sheetDriveStatus.textContent.trim() === '-.')) {
        sheetDriveStatus.textContent = '-. 특이 사항 없음';
    }

    // 담당자 협의사항
    const sheetAgreed = document.getElementById('sheet-agreed-matters') || document.getElementById('sheet-manager-discussion');
    if (sheetAgreed && (!sheetAgreed.textContent.trim() || sheetAgreed.textContent.trim() === '>.')) {
        sheetAgreed.innerHTML = '&gt;. 내용 없음';
    }

    // 다음 예정 업무 및 주의사항
    const sheetNext = document.getElementById('sheet-next-plans') || document.getElementById('sheet-next-schedule');
    if (sheetNext && (!sheetNext.textContent.trim() || sheetNext.textContent.trim() === '>.')) {
        sheetNext.innerHTML = '&gt;. 내용없음';
    }

    // 특이 사항
    const sheetSpecial = document.getElementById('sheet-special-notes') || document.getElementById('sheet-special-text');
    if (sheetSpecial && (!sheetSpecial.textContent.trim() || sheetSpecial.textContent.trim() === '>.')) {
        sheetSpecial.innerHTML = '&gt;. 특이사항 없음';
    }
}

// 17. 상단 파라미터 점검 테이블 렌더링 (2열 분할 6칸: 점검 항목 / 정상범위 / 상 태)
function renderParametersTable(paramList) {
    const tbody = document.getElementById('report-params-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!paramList || paramList.length === 0) {
        // 기본 빈 행 4줄 표시
        for (let i = 0; i < 4; i++) {
            const tr = document.createElement('tr');
            tr.className = 'param-row';
            tr.innerHTML = `
                <td class="report-param-name" contenteditable="true" spellcheck="false"></td>
                <td class="report-param-std" contenteditable="true" spellcheck="false"></td>
                <td class="report-param-status" contenteditable="true" spellcheck="false"></td>
                <td class="report-param-name" contenteditable="true" spellcheck="false"></td>
                <td class="report-param-std" contenteditable="true" spellcheck="false"></td>
                <td class="report-param-status" contenteditable="true" spellcheck="false">
                    <button type="button" class="btn-del-param-row no-print" contenteditable="false" title="이 파라미터 줄 삭제">&times;</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
        return;
    }

    const total = paramList.length;
    const half = Math.ceil(total / 2);

    for (let i = 0; i < half; i++) {
        const left = paramList[i];
        const right = (i + half < total) ? paramList[i + half] : null;

        const tr = document.createElement('tr');
        tr.className = 'param-row';

        const leftName = left ? (left.name || '') : '';
        const leftRange = left ? (left.standard || left.normal_range || '') : '';
        // [요청 반영] 상태 열에 Data parameter 점검 측정값(measured_val) 최우선 표출
        const getStatusText = (item) => {
            if (!item) return '';
            if (item.measured_val !== undefined && item.measured_val !== null && String(item.measured_val).trim() !== '') {
                return String(item.measured_val).trim();
            }
            return String(item.status || '').trim();
        };
        const leftStatus = getStatusText(left);

        const rightName = right ? (right.name || '') : '';
        const rightRange = right ? (right.standard || right.normal_range || '') : '';
        const rightStatus = getStatusText(right);

        tr.innerHTML = `
            <td class="report-param-name" contenteditable="true" spellcheck="false">${escapeHtml(leftName)}</td>
            <td class="report-param-std" contenteditable="true" spellcheck="false">${escapeHtml(leftRange)}</td>
            <td class="report-param-status" contenteditable="true" spellcheck="false">${escapeHtml(leftStatus)}</td>
            <td class="report-param-name" contenteditable="true" spellcheck="false">${escapeHtml(rightName)}</td>
            <td class="report-param-std" contenteditable="true" spellcheck="false">${escapeHtml(rightRange)}</td>
            <td class="report-param-status" contenteditable="true" spellcheck="false">
                ${escapeHtml(rightStatus)}
                <button type="button" class="btn-del-param-row no-print" contenteditable="false" title="이 파라미터 줄 삭제">&times;</button>
            </td>
        `;
        tbody.appendChild(tr);
    }
}

// 18. 상단 파라미터 1줄(좌/우 2칸) 수동 추가
function addCustomParamRow() {
    const tbody = document.getElementById('report-params-tbody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.className = 'param-row';
    tr.innerHTML = `
        <td class="report-param-name" contenteditable="true" spellcheck="false">새 점검 항목</td>
        <td class="report-param-std" contenteditable="true" spellcheck="false">정상 범위</td>
        <td class="report-param-status" contenteditable="true" spellcheck="false">정상</td>
        <td class="report-param-name" contenteditable="true" spellcheck="false"></td>
        <td class="report-param-std" contenteditable="true" spellcheck="false"></td>
        <td class="report-param-status" contenteditable="true" spellcheck="false">
            <button type="button" class="btn-del-param-row no-print" contenteditable="false" title="이 파라미터 줄 삭제">&times;</button>
        </td>
    `;
    tbody.appendChild(tr);
    debounceSaveReportState(100);
}

// [추가] 상단 파라미터 마지막 1줄 삭제
function removeLastParamRow() {
    const tbody = document.getElementById('report-params-tbody');
    if (!tbody) return;

    const rows = tbody.querySelectorAll('.param-row, tr');
    if (rows.length <= 1) {
        alert('최소 1개의 파라미터 행은 유지되어야 합니다.');
        return;
    }

    const lastRow = rows[rows.length - 1];
    if (lastRow) {
        lastRow.remove();
        debounceSaveReportState(100);
    }
}

// 19. 상단 파라미터 테이블에서 현재 데이터 수집
function collectParametersFromTable() {
    const tbody = document.getElementById('report-params-tbody');
    if (!tbody) return [];

    const rows = tbody.querySelectorAll('.param-row, tr');
    const items = [];

    const getCleanCellText = (cell) => {
        if (!cell) return '';
        const clone = cell.cloneNode(true);
        clone.querySelectorAll('.btn-del-param-row, .no-print').forEach(el => el.remove());
        return clone.textContent.trim();
    };

    rows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 6) {
            const leftName = getCleanCellText(cells[0]);
            const leftRange = getCleanCellText(cells[1]);
            const leftStatus = getCleanCellText(cells[2]);

            if (leftName) {
                items.push({ name: leftName, standard: leftRange, status: leftStatus });
            }

            const rightName = getCleanCellText(cells[3]);
            const rightRange = getCleanCellText(cells[4]);
            const rightStatus = getCleanCellText(cells[5]);

            if (rightName) {
                items.push({ name: rightName, standard: rightRange, status: rightStatus });
            }
        }
    });

    return items;
}

// 20. 전체 시트 데이터 수집 (JSON)
function collectSheetData() {
    const title = (document.getElementById('sheet-title') || {}).textContent || '';
    const dateText = (getSheetDateEl() || {}).textContent || '';
    const inspector = (document.getElementById('sheet-inspector') || {}).textContent || '';
    const location = (document.getElementById('sheet-location') || {}).textContent || '';
    const serialNo = (getSheetSerialEl() || {}).textContent || '';

    // 체크박스 상태 (data-key, checkbox id, group:val 모두 지원)
    const checkboxes = {};
    document.querySelectorAll('.report-check-item').forEach(item => {
        const box = item.querySelector('.check-box');
        const key = item.getAttribute('data-key') 
            || (box ? box.id : null) 
            || (item.getAttribute('data-group') && item.getAttribute('data-val') ? `${item.getAttribute('data-group')}:${item.getAttribute('data-val')}` : null);
        if (key && box) {
            checkboxes[key] = (box.textContent.trim() === '■');
        }
    });

    // 파라미터
    const parameters = collectParametersFromTable();

    // 텍스트 블록 (HTML ID 및 레거시 ID 완벽 지원)
    const historyTitle = (document.getElementById('sheet-history-title') || {}).textContent || '1. 관리 이력';
    const driveStatusTitle = (document.getElementById('sheet-drive-status-title') || {}).textContent || '2. 점검 전/후, 설비 구동상태 확인';
    const replacedPartsTitle = (document.getElementById('sheet-replaced-parts-title') || {}).textContent || '교체 물품';
    const agreedMattersTitle = (document.getElementById('sheet-agreed-matters-title') || {}).textContent || '담당자 협의사항';
    const nextPlansTitle = (document.getElementById('sheet-next-plans-title') || {}).textContent || '다음 예정 업무 및 주의사항';
    const specialNotesTitle = (document.getElementById('sheet-special-notes-title') || {}).textContent || '특이 사항';

    const workLog = (document.getElementById('sheet-work-log') || document.getElementById('sheet-history-content') || {}).innerHTML || '';
    const equipCheckState = (document.getElementById('sheet-equip-check-state') || document.getElementById('sheet-drive-status') || {}).innerHTML || '';
    const replacedParts = (document.getElementById('sheet-replaced-parts') || {}).innerHTML || '';
    const nextSchedule = (document.getElementById('sheet-next-plans') || document.getElementById('sheet-next-schedule') || {}).innerHTML || '';
    const managerDiscussion = (document.getElementById('sheet-agreed-matters') || document.getElementById('sheet-manager-discussion') || {}).innerHTML || '';
    const specialNotes = (document.getElementById('sheet-special-notes') || document.getElementById('sheet-special-text') || {}).innerHTML || '';

    // [추가] 상태 체크박스 요약 행 목록 수집
    const statusRows = [];
    document.querySelectorAll('#report-status-tbody tr').forEach(tr => {
        const ths = tr.querySelectorAll('th.status-label-th');
        const tds = tr.querySelectorAll('td.status-check-td');
        if (ths.length >= 2 && tds.length >= 2) {
            const extractCell = (th, td) => {
                const label = th.textContent.trim();
                const freeEl = td.querySelector('.status-free-text');
                if (freeEl) {
                    return {
                        label,
                        options: [{ text: freeEl.textContent.trim(), checked: false, isTextOnly: true }]
                    };
                }
                const options = [];
                td.querySelectorAll('.report-check-item').forEach(it => {
                    const lbl = (it.querySelector('.report-check-label') || {}).textContent || it.getAttribute('data-val') || '';
                    const box = it.querySelector('.check-box');
                    const checked = box ? box.textContent.trim() === '■' : false;
                    const isTextOnly = !box || it.classList.contains('text-only-item');
                    options.push({ text: lbl.trim(), checked, isTextOnly });
                });
                return { label, options };
            };
            statusRows.push({
                left: extractCell(ths[0], tds[0]),
                right: extractCell(ths[1], tds[1])
            });
        }
    });

    return {
        title,
        date_text: dateText,
        inspector,
        location,
        serial_no: serialNo,
        status_rows: statusRows,
        checkboxes,
        parameters,
        history_title: historyTitle,
        drive_status_title: driveStatusTitle,
        replaced_parts_title: replacedPartsTitle,
        agreed_matters_title: agreedMattersTitle,
        next_plans_title: nextPlansTitle,
        special_notes_title: specialNotesTitle,
        work_log: workLog,
        equip_check_state: equipCheckState,
        replaced_parts: replacedParts,
        next_schedule: nextSchedule,
        next_plans: nextSchedule,
        manager_discussion: managerDiscussion,
        agreed_matters: managerDiscussion,
        special_notes: specialNotes
    };
}

// 21. 시트에 JSON 데이터 반영 (각 보고서 독립 격리 복원)
function applySheetData(sheetData) {
    if (!sheetData) return;

    // 1. 타이틀
    const sheetTitle = document.getElementById('sheet-title');
    if (sheetTitle) {
        sheetTitle.textContent = sheetData.title || 'Working Report';
    }

    // 2. 점검일자
    const sheetDate = getSheetDateEl();
    if (sheetDate) {
        sheetDate.textContent = sheetData.date_text || '-';
    }

    // 3. 점검자
    const sheetInspector = document.getElementById('sheet-inspector');
    const inspectorInput = document.getElementById('report-inspector-input');
    const inspectorVal = sheetData.inspector || '';
    if (sheetInspector) sheetInspector.textContent = inspectorVal || '-';
    if (inspectorInput) inspectorInput.value = inspectorVal;
    selectedInspectorsList = inspectorVal
        ? inspectorVal.split(',').map(s => s.trim()).filter(Boolean)
        : [];

    // 4. 설치장소 및 S/N
    const sheetLocation = document.getElementById('sheet-location');
    if (sheetLocation) {
        sheetLocation.textContent = sheetData.location || '-';
    }
    const sheetSerial = getSheetSerialEl();
    if (sheetSerial) {
        sheetSerial.textContent = sheetData.serial_no || '-';
    }

    // 5. 상태 체크박스 요약 행 (status_rows) 완벽 복원
    if (sheetData.status_rows && Array.isArray(sheetData.status_rows) && sheetData.status_rows.length > 0) {
        renderStatusRowsFromData(sheetData.status_rows);
    } else {
        // status_rows가 없는 과거 데이터인 경우 기본 2행으로 초기화
        const tbody = getStatusRowsTbody();
        if (tbody) {
            tbody.innerHTML = '';
            addStatusRow(
                { label: 'Data 특이사항 유무', options: [{ text: '유', checked: false }, { text: '무', checked: true }] },
                { label: 'ICP-MS Tuning', options: [{ text: '진행', checked: true }, { text: '미진행', checked: false }] }
            );
            addStatusRow(
                { label: '점검 내용', options: [{ text: '예방', checked: false }, { text: '이벤트', checked: false }, { text: '정기', checked: true }] },
                { label: '점검 및 조치 결과 총평', options: [{ text: '양호', checked: true }, { text: '관리 필요', checked: false }] }
            );
        }
    }

    // 6. 체크박스 전체 초기화 후 복원 (이전 보고서의 체크가 남지 않도록)
    document.querySelectorAll('.report-check-item').forEach(item => {
        item.classList.remove('checked');
        const box = item.querySelector('.check-box');
        if (box) box.textContent = '□';
    });

    if (sheetData.checkboxes) {
        Object.entries(sheetData.checkboxes).forEach(([key, isChecked]) => {
            let item = document.querySelector(`.report-check-item[data-key="${key}"]`);
            if (!item) {
                const box = document.getElementById(key);
                if (box) item = box.closest('.report-check-item');
            }
            if (!item && key.includes(':')) {
                const [grp, val] = key.split(':');
                item = document.querySelector(`.report-check-item[data-group="${grp}"][data-val="${val}"]`);
            }
            if (item) {
                const box = item.querySelector('.check-box');
                if (box) {
                    box.textContent = isChecked ? '■' : '□';
                    if (isChecked) item.classList.add('checked');
                    else item.classList.remove('checked');
                }
            }
        });
    }

    // 7. 파라미터 테이블 복원
    renderParametersTable(sheetData.parameters || []);

    // 8. 텍스트 블록 타이틀 복원
    const setTitle = (id, val, defaultVal) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || defaultVal;
    };
    setTitle('sheet-history-title', sheetData.history_title, '1. 관리 이력');
    setTitle('sheet-drive-status-title', sheetData.drive_status_title, '2. 점검 전/후, 설비 구동상태 확인');
    setTitle('sheet-replaced-parts-title', sheetData.replaced_parts_title, '교체 물품');
    setTitle('sheet-agreed-matters-title', sheetData.agreed_matters_title, '담당자 협의사항');
    setTitle('sheet-next-plans-title', sheetData.next_plans_title, '다음 예정 업무 및 주의사항');
    setTitle('sheet-special-notes-title', sheetData.special_notes_title, '특이 사항');

    // 9. 텍스트 본문 블록 복원 (이전 보고서 잔여 내용 및 분리 상태 초기화 후 복원)
    const setBlockContent = (el, val, defaultVal = '') => {
        if (!el) return;
        let content = (val !== undefined && val !== null && String(val).trim() !== '') ? val : defaultVal;
        if (Array.isArray(content)) {
            content = content.join('<br>');
        } else if (typeof content === 'string') {
            if (!content.includes('<') && content.includes('\n')) {
                content = content.replace(/\r\n/g, '<br>').replace(/\n/g, '<br>');
            }
        }
        if (typeof content === 'string' && (content.includes('<') || content.includes('&'))) {
            el.innerHTML = content;
            if (el.querySelector('.card-split-container')) {
                el.removeAttribute('contenteditable');
            } else {
                el.setAttribute('contenteditable', 'true');
            }
        } else {
            el.innerHTML = '';
            el.textContent = content;
            el.setAttribute('contenteditable', 'true');
        }
    };

    setBlockContent(document.getElementById('sheet-work-log') || document.getElementById('sheet-history-content'), sheetData.work_log || sheetData.history_content, '-. 정기 점검 수행 (특이사항 없음)');
    setBlockContent(document.getElementById('sheet-equip-check-state') || document.getElementById('sheet-drive-status'), sheetData.equip_check_state || sheetData.drive_status, '-. 특이 사항 없음');
    setBlockContent(document.getElementById('sheet-replaced-parts'), sheetData.replaced_parts, '해당사항 없음');
    setBlockContent(document.getElementById('sheet-agreed-matters') || document.getElementById('sheet-manager-discussion'), sheetData.agreed_matters || sheetData.manager_discussion, '&gt;. 내용 없음');
    setBlockContent(document.getElementById('sheet-next-plans') || document.getElementById('sheet-next-schedule'), sheetData.next_plans || sheetData.next_schedule, '&gt;. 내용없음');
    setBlockContent(document.getElementById('sheet-special-notes') || document.getElementById('sheet-special-text'), sheetData.special_notes || sheetData.special_text, '&gt;. 특이사항 없음');
}

// 22. 보고서 저장 (DB)
async function saveReport() {
    if (!selectedSiteName || !selectedEquipId) {
        alert('사업장과 장비를 먼저 선택해주세요.');
        return;
    }

    const dateInput = document.getElementById('report-date-input');
    const reportDate = dateInput ? dateInput.value : '';
    if (!reportDate) {
        alert('점검일자를 선택해주세요.');
        return;
    }

    const matchedEquip = allEquipmentList.find(eq => eq.id === selectedEquipId) || {};
    const sheetData = collectSheetData();

    const payload = {
        id: currentReportId,
        site_name: selectedSiteName,
        equip_id: selectedEquipId,
        equip_name: matchedEquip.cust_equip_name || matchedEquip.name || '',
        model_name: matchedEquip.model_name || matchedEquip.name || '',
        report_date: reportDate,
        title: sheetData.title,
        inspector: sheetData.inspector,
        location: sheetData.location,
        serial_no: sheetData.serial_no,
        data_json: sheetData
    };

    try {
        const res = await fetch('/api/report/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('보고서 저장 실패');
        const result = await res.json();

        currentReportId = result.report_id || result.id;
        alert(`[${reportDate}] 보고서가 성공적으로 저장되었습니다.\n(해당 일자의 단일 보고서로 유지 및 계속 갱신됩니다)`);

        // 이력 목록 갱신 및 저장된 보고서 카드 선택 상태 유지
        await loadReportHistory(selectedEquipId);
        const scrollBox = document.getElementById('saved-history-scroll-box');
        if (scrollBox) {
            const card = scrollBox.querySelector(`.saved-history-card[data-id="${currentReportId}"]`) ||
                         scrollBox.querySelector(`.saved-history-card[data-date="${reportDate}"]`);
            if (card) {
                document.querySelectorAll('.saved-history-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }

        // [상태 유지] 저장 직후 작업 상태 세션 스토리지 동기화
        saveReportWorkspaceState();

    } catch (err) {
        console.error('Failed to save report:', err);
        alert('보고서 저장 중 오류가 발생했습니다.');
    }
}

// 23. 저장된 특정 보고서 로드 (독립적인 고유 보고서 격리 로드)
async function loadSavedReport(reportId) {
    if (!reportId) return;

    // 이전 보고서 작업의 디바운스 자동 저장 타이머 즉시 취소 (교차 오염 방지)
    if (_reportStateDebounceTimer) clearTimeout(_reportStateDebounceTimer);

    // [요청 반영] 저장된 보고서 이력 선택 시 해당 보고서를 즉시 불러와서 바로 보고서 시트 생성(표시)
    showReportSheet();

    try {
        const res = await fetch(`/api/report/${reportId}`);
        if (!res.ok) throw new Error('보고서 조회 실패');
        const json = await res.json();
        const report = json.report || {};

        currentReportId = report.id;

        // 저장된 보고서 스크롤 박스 내 선택 하이라이트 동기화
        const scrollBox = document.getElementById('saved-history-scroll-box');
        if (scrollBox) {
            scrollBox.querySelectorAll('.saved-history-card').forEach(c => {
                if (String(c.getAttribute('data-id')) === String(report.id)) {
                    c.classList.add('selected');
                    c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } else {
                    c.classList.remove('selected');
                }
            });
        }

        // 좌측 폼 컨트롤을 해당 저장된 보고서 정보로 정확히 동기화
        if (report.site_name) {
            selectedSiteName = report.site_name;
            const siteInput = document.getElementById('report-site-input');
            const siteSelect = document.getElementById('report-site-select');
            if (siteInput) siteInput.value = report.site_name;
            if (siteSelect) siteSelect.value = report.site_name;
        }

        if (report.equip_id) {
            selectedEquipId = report.equip_id;
            const equipInput = document.getElementById('report-equip-input');
            const equipSelect = document.getElementById('report-equip-select');
            const matchedEquip = allEquipmentList.find(eq => eq.id === report.equip_id);
            if (equipInput) equipInput.value = matchedEquip ? getEquipDisplayName(matchedEquip) : (report.equip_name || report.equip_id);
            if (equipSelect) equipSelect.value = report.equip_id;
        }

        const dateInput = document.getElementById('report-date-input');
        if (dateInput && report.report_date) {
            dateInput.value = report.report_date;
            updateSheetInspectDate(report.report_date);
        }

        if (report.inspector !== undefined) {
            const inspectorInput = document.getElementById('report-inspector-input');
            if (inspectorInput) inspectorInput.value = report.inspector;
            selectedInspectorsList = report.inspector
                ? report.inspector.split(',').map(s => s.trim()).filter(Boolean)
                : [];
        }

        let sheetData = {};
        if (report.data && typeof report.data === 'object' && Object.keys(report.data).length > 0) {
            sheetData = report.data;
        } else if (typeof report.data_json === 'string') {
            try { sheetData = JSON.parse(report.data_json); } catch (e) { }
        } else if (report.data_json && typeof report.data_json === 'object') {
            sheetData = report.data_json;
        }

        // 상위 메타데이터 fallback 주입
        if (!sheetData.title && report.title) sheetData.title = report.title;
        if (!sheetData.date_text && report.report_date) sheetData.date_text = report.report_date.replace(/-/g, '.');
        if (!sheetData.inspector && report.inspector) sheetData.inspector = report.inspector;
        if (!sheetData.location && report.location) sheetData.location = report.location;
        if (!sheetData.serial_no && report.serial_no) sheetData.serial_no = report.serial_no;

        // 시트 내용을 해당 보고서 고유 데이터로 깨끗하게 전면 덮어쓰기 복원
        applySheetData(sheetData);

        // [상태 유지] 로드 직후 작업 상태 세션 스토리지 동기화
        saveReportWorkspaceState();
    } catch (err) {
        console.error('Failed to load saved report:', err);
        alert('보고서를 불러오는 중 오류가 발생했습니다.');
    }
}

// 23-1. 시트 전체를 완전한 초기 기본 양식 상태로 깨끗하게 초기화 (참고 보고서 미선택 시)
function resetSheetToCleanState() {
    // 1. 헤더 타이틀 복원
    const matchedEquip = allEquipmentList.find(eq => eq.id === selectedEquipId);
    const modelName = matchedEquip ? (matchedEquip.model_name || matchedEquip.name || 'ICAP-RQ') : 'ICAP-RQ';
    const sheetTitle = document.getElementById('sheet-title');
    if (sheetTitle) sheetTitle.textContent = `${modelName} Working Report`;

    // 2. 카드 헤더 제목 기본값 복원
    const setTitle = (id, defaultVal) => {
        const el = document.getElementById(id);
        if (el) el.textContent = defaultVal;
    };
    setTitle('sheet-history-title', '1. 관리 이력');
    setTitle('sheet-drive-status-title', '2. 점검 전/후, 설비 구동상태 확인');
    setTitle('sheet-replaced-parts-title', '교체 물품');
    setTitle('sheet-agreed-matters-title', '담당자 협의사항');
    setTitle('sheet-next-plans-title', '다음 예정 업무 및 주의사항');
    setTitle('sheet-special-notes-title', '특이 사항');

    // 3. 상태 체크박스 요약 행 기본 2행으로 초기화
    const tbody = getStatusRowsTbody();
    if (tbody) {
        tbody.innerHTML = '';
        addStatusRow(
            { label: 'Data 특이사항 유무', options: [{ text: '유', checked: false }, { text: '무', checked: true }] },
            { label: 'ICP-MS Tuning', options: [{ text: '진행', checked: true }, { text: '미진행', checked: false }] }
        );
        addStatusRow(
            { label: '점검 내용', options: [{ text: '예방', checked: false }, { text: '이벤트', checked: false }, { text: '정기', checked: true }] },
            { label: '점검 및 조치 결과 총평', options: [{ text: '양호', checked: true }, { text: '관리 필요', checked: false }] }
        );
    }

    // 4. 체크박스 전체 초기화 후 기본값 체크
    document.querySelectorAll('.report-check-item').forEach(item => {
        item.classList.remove('checked');
        const box = item.querySelector('.check-box');
        if (box) box.textContent = '□';
    });

    const setCheckedBox = (selector) => {
        const item = document.querySelector(selector);
        if (item) {
            item.classList.add('checked');
            const box = item.querySelector('.check-box');
            if (box) box.textContent = '■';
        }
    };
    setCheckedBox('.report-check-item[data-val="무"]');
    setCheckedBox('.report-check-item[data-val="진행"]');
    setCheckedBox('.report-check-item[data-val="정기"]');
    setCheckedBox('.report-check-item[data-val="양호"]');

    // 5. 카드 본문 텍스트 초기화 (분할 칸 및 커스텀 표 모두 제거 후 초기 텍스트 설정)
    const resetCard = (el, defaultText) => {
        if (!el) return;
        el.removeAttribute('style');
        el.innerHTML = defaultText;
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
    };

    resetCard(document.getElementById('sheet-work-log') || document.getElementById('sheet-history-content'), '-. 정기 점검 수행 (특이사항 없음)');
    resetCard(document.getElementById('sheet-equip-check-state') || document.getElementById('sheet-drive-status'), '-. 특이 사항 없음');
    resetCard(document.getElementById('sheet-replaced-parts'), '해당사항 없음');
    resetCard(document.getElementById('sheet-agreed-matters') || document.getElementById('sheet-manager-discussion'), '&gt;. 내용 없음');
    resetCard(document.getElementById('sheet-next-plans') || document.getElementById('sheet-next-schedule'), '&gt;. 내용없음');
    resetCard(document.getElementById('sheet-special-notes') || document.getElementById('sheet-special-text'), '&gt;. 특이사항 없음');

    // 6. 파라미터 테이블 초기 빈 4행 렌더링
    renderParametersTable([]);
}

// 24. 새 양식 리셋
function resetNewReport() {
    if (!confirm('현재 작성 중인 내용을 초기화하고 새 보고서 양식으로 리셋하시겠습니까?')) return;
    currentReportId = null;

    const historySelect = document.getElementById('report-history-select');
    if (historySelect) historySelect.selectedIndex = 0;

    // 스크롤 박스 선택 해제
    document.querySelectorAll('.saved-history-card').forEach(c => c.classList.remove('selected'));

    initDefaultDate();
    showReportSheet();
    resetSheetToCleanState();
    loadSourceDataFromDb(false);
}

// 25. 보고서 삭제
async function deleteCurrentReport() {
    if (!currentReportId) {
        alert('삭제할 저장된 보고서가 선택되지 않았습니다.');
        return;
    }

    if (!confirm('이 저장된 보고서를 정말 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.')) return;

    try {
        const res = await fetch(`/api/report/${currentReportId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('삭제 실패');

        alert('보고서가 삭제되었습니다.');
        currentReportId = null;

        if (selectedEquipId) {
            await loadReportHistory(selectedEquipId);
            await loadSourceDataFromDb(false);
        } else {
            hideReportSheet();
        }

        // [상태 유지] 삭제 직후 작업 상태 세션 스토리지 동기화
        saveReportWorkspaceState();
    } catch (err) {
        console.error('Failed to delete report:', err);
        alert('보고서 삭제 중 오류가 발생했습니다.');
    }
}

// 25-1. 보고서 시트를 이미지로 캡처하여 클립보드에 복사
async function copyReportAsImage() {
    const sheetEl = document.getElementById('working-report-sheet');
    if (!sheetEl || sheetEl.style.display === 'none') {
        alert('복사할 보고서가 없습니다. 먼저 사업장/장비를 선택하고 [보고서 생성]을 진행해주세요.');
        return;
    }

    const btnCopy = document.getElementById('btn-copy-image');
    const originalContent = btnCopy ? btnCopy.innerHTML : '';
    if (btnCopy) {
        btnCopy.disabled = true;
        btnCopy.innerHTML = '<span>⏳ 이미지 생성 중...</span>';
    }

    try {
        let blob = null;

        if (typeof html2canvas === 'function') {
            // 1. html2canvas 고화질(scale: 2) 캡처
            const canvas = await html2canvas(sheetEl, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false,
                ignoreElements: (el) => el.classList && el.classList.contains('no-print')
            });
            blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        } else {
            // 2. 외부 라이브러리 부재 시 SVG ForeignObject 폴백
            blob = await captureElementAsBlobFallback(sheetEl);
        }

        if (!blob) {
            throw new Error('이미지 데이터를 생성하지 못했습니다.');
        }

        // 3. 브라우저 클립보드에 이미지 기록
        if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            if (btnCopy) btnCopy.innerHTML = '<span>✅ 복사 완료!</span>';
            showReportToast('📋 보고서 이미지가 클립보드에 복사되었습니다! (Ctrl+V로 바로 붙여넣기 가능)');
        } else {
            // 클립보드 직접 쓰기 미지원 브라우저인 경우 파일 다운로드 지원
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const dateStr = (document.getElementById('report-date-input') || {}).value || 'report';
            a.download = `Working_Report_${dateStr}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showReportToast('클립보드 직접 접근이 제한되어 이미지 파일로 다운로드되었습니다.');
        }
    } catch (err) {
        console.error('Failed to copy report image:', err);
        alert('이미지 복사 중 오류가 발생했습니다: ' + (err.message || err));
    } finally {
        setTimeout(() => {
            if (btnCopy) {
                btnCopy.disabled = false;
                btnCopy.innerHTML = originalContent;
            }
        }, 2200);
    }
}

// 25-2. SVG ForeignObject 기반 캔버스 이미지 폴백 캡처기
async function captureElementAsBlobFallback(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.no-print').forEach(n => n.remove());

    const width = el.offsetWidth || 794;
    const height = el.offsetHeight || 1123;

    const xml = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
                `<foreignObject width="100%" height="100%">` +
                `<div xmlns="http://www.w3.org/1999/xhtml" style="background:#ffffff; font-family:sans-serif; width:100%; height:100%;">` +
                `${xml}` +
                `</div></foreignObject></svg>`;

    const img = new Image();
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    return new Promise((resolve, reject) => {
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width * 2;
            canvas.height = height * 2;
            const ctx = canvas.getContext('2d');
            ctx.scale(2, 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            canvas.toBlob(resolve, 'image/png');
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('네이티브 렌더링에 실패했습니다.'));
        };
        img.src = url;
    });
}

// 25-3. 보고서 전용 가벼운 토스트 알림
function showReportToast(msg) {
    let toast = document.getElementById('report-toast-alert');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'report-toast-alert';
        toast.className = 'report-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 2800);
}

// 26. Data Parameter 선택 모달 열기 (Data 메뉴 점검값 및 장비 파라미터 선택 추가)
async function openDataParamsModal() {
    if (!selectedEquipId) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }

    // 보고서 시트가 닫혀있다면 먼저 표시
    showReportSheet();

    const matchedEquip = allEquipmentList.find(eq => eq.id === selectedEquipId) || {};
    const modelName = matchedEquip.model_name || matchedEquip.name || '';
    const dateInput = document.getElementById('report-date-input');
    const dateVal = dateInput ? dateInput.value : '';

    const modal = document.getElementById('modal-db-params');
    const listEl = document.getElementById('modal-param-list');
    const titleEl = document.getElementById('modal-param-title');
    const descEl = document.getElementById('modal-param-desc');
    if (!modal || !listEl) return;

    if (titleEl) titleEl.textContent = '⚙️ Data Parameter 항목 추가';
    if (descEl) descEl.textContent = 'Data 점검값 및 Parameter 목록 중 리포트에 추가할 항목을 선택하세요.';

    listEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--side-muted);">Data Parameter 목록 조회 중...</div>';
    modal.style.display = 'flex';

    // 툴바 전체 선택 / 해제 버튼 바인딩
    const btnSelectAll = document.getElementById('btn-param-modal-select-all');
    if (btnSelectAll) {
        btnSelectAll.onclick = () => {
            listEl.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(cb => { cb.checked = true; });
        };
    }
    const btnClearAll = document.getElementById('btn-param-modal-clear-all');
    if (btnClearAll) {
        btnClearAll.onclick = () => {
            listEl.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(cb => { cb.checked = false; });
        };
    }

    try {
        let params = [];
        let sourceLabel = '';

        // 1. Data 메뉴의 해당 장비 파라미터 점검값 API 조회 시도
        try {
            const dataUrl = `/api/report/data_parameters?equip_id=${encodeURIComponent(selectedEquipId)}&date=${encodeURIComponent(dateVal)}&site_name=${encodeURIComponent(selectedSiteName)}`;
            const resData = await fetch(dataUrl);
            if (resData.ok) {
                const jsonData = await resData.json();
                if (jsonData.status === 'success' && Array.isArray(jsonData.items) && jsonData.items.length > 0) {
                    params = jsonData.items;
                    sourceLabel = jsonData.record_date ? `(Data 점검일자: ${jsonData.record_date})` : '';
                }
            }
        } catch (e) {
            console.warn('Failed to load data_parameters, fallback to model_parameters:', e);
        }

        // 2. Data 메뉴에 점검값이 없으면 모델 마스터 파라미터로 fallback
        if (params.length === 0) {
            const modelUrl = `/api/report/model_parameters?model_name=${encodeURIComponent(modelName)}`;
            const resModel = await fetch(modelUrl);
            if (resModel.ok) {
                const jsonModel = await resModel.json();
                params = jsonModel.parameters || [];
                sourceLabel = '(마스터 파라미터)';
            }
        }

        if (params.length === 0) {
            listEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--side-muted);">등록된 Data Parameter가 없습니다.</div>';
            return;
        }

        if (descEl && sourceLabel) {
            descEl.textContent = `추가할 Parameter를 선택하세요. ${sourceLabel}`;
        }

        // 3. 현재 리포트 테이블에 이미 등록된 파라미터 식별
        const currentItems = collectParametersFromTable();
        const currentNames = new Set(currentItems.map(p => (p.name || '').trim()).filter(Boolean));

        listEl.innerHTML = '';
        params.forEach((p, idx) => {
            const pName = (p.name || '').trim();
            if (!pName) return;

            const isAlreadyAdded = currentNames.has(pName);
            const stdVal = p.standard || '-';
            const measuredVal = p.status || p.measured_val || '';

            const itemDiv = document.createElement('div');
            itemDiv.className = 'modal-param-item';
            itemDiv.setAttribute('data-name', pName);
            itemDiv.setAttribute('data-std', stdVal === '-' ? '' : stdVal);
            itemDiv.setAttribute('data-status', measuredVal || '양호');

            const chkId = `chk-param-dp-${idx}`;
            itemDiv.innerHTML = `
                <input type="checkbox" id="${chkId}" value="${escapeHtml(pName)}" ${isAlreadyAdded ? 'checked disabled' : ''}>
                <label for="${chkId}" style="margin: 0; cursor: pointer; flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <div>
                        <strong style="color: #f0f6fc;">${escapeHtml(pName)}</strong>
                        <span style="color: var(--side-muted); font-size: 11px; margin-left: 6px;">(기준: ${escapeHtml(stdVal)})</span>
                        ${isAlreadyAdded ? '<span style="color: var(--side-accent); font-size: 11px; margin-left: 6px;">[이미 추가됨]</span>' : ''}
                    </div>
                    ${measuredVal ? `<span style="color: #3fb950; font-weight: 600; font-size: 11px; background: rgba(63, 185, 80, 0.12); padding: 1px 6px; border-radius: 4px;">측정값: ${escapeHtml(measuredVal)}</span>` : ''}
                </label>
            `;

            // 클릭 시 체크박스 토글 지원
            itemDiv.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const chk = itemDiv.querySelector('input[type="checkbox"]');
                if (chk && !chk.disabled) {
                    chk.checked = !chk.checked;
                }
            });

            listEl.appendChild(itemDiv);
        });

    } catch (err) {
        console.error('Failed to load data parameters:', err);
        listEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #f85149;">Parameter 목록을 불러오지 못했습니다.</div>';
    }
}

const openDbParamsModal = openDataParamsModal;

window.closeReportParamModal = function () {
    const modal = document.getElementById('modal-db-params');
    if (modal) modal.style.display = 'none';
};

window.applySelectedDbParams = function () {
    const modal = document.getElementById('modal-db-params');
    const listEl = document.getElementById('modal-param-list');
    if (!listEl) return;

    const checkedBoxes = listEl.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)');
    if (checkedBoxes.length === 0) {
        closeReportParamModal();
        return;
    }

    const currentItems = collectParametersFromTable();

    let addedCount = 0;
    checkedBoxes.forEach(chk => {
        const parent = chk.closest('.modal-param-item');
        if (parent) {
            const name = parent.getAttribute('data-name');
            const std = parent.getAttribute('data-std');
            const status = parent.getAttribute('data-status') || '양호';
            currentItems.push({
                name: name,
                standard: std,
                status: status
            });
            addedCount++;
        }
    });

    renderParametersTable(currentItems);
    debounceSaveReportState(100);
    closeReportParamModal();

    if (addedCount > 0) {
        showReportToast(`선택한 Parameter ${addedCount}건이 리포트에 추가되었습니다.`);
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 27. 카드 레이아웃 도구 (관리이력 ~ 하단 카드: 열분리, 행분리, 단일칸 복원, 커스텀 표 생성)
let lastFocusedCardCell = null;

function initCardLayoutTools() {
    const btnSplitCol = document.getElementById('btn-split-col');
    const btnSplitRow = document.getElementById('btn-split-row');
    const btnResetSplit = document.getElementById('btn-reset-split');
    const btnCreateTable = document.getElementById('btn-create-table');

    // 시트 내 분리 셀 포커스 추적 (표 삽입 대상 셀 식별)
    const sheet = document.getElementById('working-report-sheet');
    if (sheet) {
        sheet.addEventListener('focusin', (e) => {
            const splitCell = e.target.closest('.card-split-cell');
            if (splitCell) {
                lastFocusedCardCell = splitCell;
            }
        });
    }

    if (btnSplitCol) {
        btnSplitCol.addEventListener('click', () => {
            const cardEl = getTargetCardElement();
            if (!cardEl) return;
            splitCardElement(cardEl, 'col');
        });
    }

    if (btnSplitRow) {
        btnSplitRow.addEventListener('click', () => {
            const cardEl = getTargetCardElement();
            if (!cardEl) return;
            splitCardElement(cardEl, 'row');
        });
    }

    if (btnResetSplit) {
        btnResetSplit.addEventListener('click', () => {
            const cardEl = getTargetCardElement();
            if (!cardEl) return;
            resetCardSplit(cardEl);
        });
    }

    if (btnCreateTable) {
        btnCreateTable.addEventListener('click', () => {
            const cardEl = getTargetCardElement();
            if (!cardEl) return;
            insertCustomTableToCard(cardEl);
        });
    }
}

// 대상 카드 DOM 엘리먼트 획득
function getTargetCardElement() {
    const select = document.getElementById('card-target-select');
    if (!select) return null;
    const key = select.value;
    const el = getCardContentElement(key);
    if (!el) {
        alert('대상 카드를 찾을 수 없습니다.');
        return null;
    }
    return el;
}

function getCardContentElement(cardKey) {
    switch (cardKey) {
        case 'history':
            return document.getElementById('sheet-history-content') || document.getElementById('sheet-work-log');
        case 'drive':
            return document.getElementById('sheet-drive-status') || document.getElementById('sheet-equip-check-state');
        case 'replaced':
            return document.getElementById('sheet-replaced-parts');
        case 'agreed':
            return document.getElementById('sheet-agreed-matters') || document.getElementById('sheet-manager-discussion');
        case 'next':
            return document.getElementById('sheet-next-plans') || document.getElementById('sheet-next-schedule');
        case 'special':
            return document.getElementById('sheet-special-text') || document.getElementById('sheet-special-notes');
        default:
            return null;
    }
}

// 2칸 분리 (열분리: 좌/우, 행분리: 상/하) - 1회만 분리 가능 제한
function splitCardElement(cardEl, mode) {
    if (!cardEl) return;

    // [요청 반영] 1회만 분리 가능하도록 제한
    if (cardEl.querySelector('.card-split-container')) {
        alert('이미 2칸으로 분리되어 있습니다.\n추가 분리는 불가능하며, 다시 분리하려면 먼저 [🔄 단일 칸으로 복원]을 눌러주세요.');
        return;
    }

    const currentContent = cardEl.innerHTML.trim();
    const container = document.createElement('div');
    container.className = `card-split-container split-${mode}-2`;

    const cell1 = document.createElement('div');
    cell1.className = 'card-split-cell';
    cell1.contentEditable = 'true';
    cell1.spellcheck = false;
    cell1.innerHTML = currentContent || '<br>';

    const cell2 = document.createElement('div');
    cell2.className = 'card-split-cell';
    cell2.contentEditable = 'true';
    cell2.spellcheck = false;
    cell2.innerHTML = '<br>';

    // 카드 본문 래퍼 자체는 contenteditable 제거하고 내부 셀들만 편집 가능하게 설정
    cardEl.removeAttribute('contenteditable');
    cardEl.innerHTML = '';
    container.appendChild(cell1);
    container.appendChild(cell2);
    cardEl.appendChild(container);

    // 첫 번째 셀에 포커스
    cell1.focus();
    lastFocusedCardCell = cell1;

    debounceSaveReportState(100);
}

// 단일 칸으로 복원
function resetCardSplit(cardEl) {
    if (!cardEl) return;

    const splitContainer = cardEl.querySelector('.card-split-container');
    if (!splitContainer) {
        alert('현재 분리되어 있지 않은 단일 칸입니다.');
        return;
    }

    const cells = cardEl.querySelectorAll('.card-split-cell');
    let combinedHtml = '';
    cells.forEach(cell => {
        const html = cell.innerHTML.trim();
        if (html && html !== '<br>') {
            if (combinedHtml) combinedHtml += '<br>';
            combinedHtml += html;
        }
    });

    if (!combinedHtml) combinedHtml = '<br>';
    cardEl.innerHTML = combinedHtml;
    cardEl.setAttribute('contenteditable', 'true');
    cardEl.setAttribute('spellcheck', 'false');

    cardEl.focus();
    lastFocusedCardCell = null;

    debounceSaveReportState(100);
}

// 커스텀 표 생성 및 삽입
function insertCustomTableToCard(cardEl) {
    if (!cardEl) return;

    const rowsInput = document.getElementById('custom-table-rows');
    const colsInput = document.getElementById('custom-table-cols');
    let rows = parseInt(rowsInput ? rowsInput.value : '3', 10);
    let cols = parseInt(colsInput ? colsInput.value : '3', 10);

    if (isNaN(rows) || rows < 1) rows = 1;
    if (rows > 10) rows = 10;
    if (isNaN(cols) || cols < 1) cols = 1;
    if (cols > 6) cols = 6;

    // 표 엘리먼트 생성
    const table = document.createElement('table');
    table.className = 'report-custom-table';

    // 1행: thead
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    for (let c = 1; c <= cols; c++) {
        const th = document.createElement('th');
        th.contentEditable = 'true';
        th.spellcheck = false;
        th.textContent = `항목 ${c}`;
        trHead.appendChild(th);
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');
    const bodyRows = Math.max(1, rows - 1);
    for (let r = 0; r < bodyRows; r++) {
        const tr = document.createElement('tr');
        for (let c = 0; c < cols; c++) {
            const td = document.createElement('td');
            td.contentEditable = 'true';
            td.spellcheck = false;
            td.innerHTML = '&nbsp;';
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    // 삽입 위치 결정: 분리된 카드인 경우 활성 셀 또는 빈 셀 우선
    let targetContainer = cardEl;
    const splitContainer = cardEl.querySelector('.card-split-container');
    if (splitContainer) {
        if (lastFocusedCardCell && cardEl.contains(lastFocusedCardCell)) {
            targetContainer = lastFocusedCardCell;
        } else {
            const splitCells = cardEl.querySelectorAll('.card-split-cell');
            if (splitCells.length > 1 && (!splitCells[1].textContent.trim() || splitCells[1].innerHTML === '<br>')) {
                targetContainer = splitCells[1];
            } else {
                targetContainer = splitCells[0];
            }
        }
    }

    // 기존 텍스트가 단순 기본 플레이스홀더이거나 빈 줄이면 대체
    const textTrimmed = targetContainer.textContent.trim();
    if (!textTrimmed || textTrimmed === '특이사항 없음' || textTrimmed === '특이 사항 없음' || textTrimmed === '해당사항 없음' || textTrimmed === '>. 특이사항 없음' || textTrimmed === '-. 특이 사항 없음') {
        targetContainer.innerHTML = '';
    } else {
        // 기존 내용 뒤에 구분 줄바꿈 추가
        targetContainer.appendChild(document.createElement('br'));
    }

    targetContainer.appendChild(table);

    // 생성된 첫 번째 헤더 셀에 포커스
    const firstTh = table.querySelector('th');
    if (firstTh) firstTh.focus();

    debounceSaveReportState(100);
}

