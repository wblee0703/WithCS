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
const REPORT_STATE_STORAGE_KEY = 'last_report_workspace_state';
let _reportStateDebounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    initDefaultDate();
    initActionButtons();
    initSheetInteractions();
    initSuggestionBoxes();

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

// 1. 점검일자 기본값 설정 (오늘) 및 시트 실시간 반영
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
        updateSheetInspectDate(dateInput.value);
        dateInput.addEventListener('change', () => {
            updateSheetInspectDate(dateInput.value);
            debounceSaveReportState(100);
            if (isReportActive) {
                onEquipmentOrDateChange();
            }
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

    const btnNew = document.getElementById('btn-new-report');
    if (btnNew) btnNew.addEventListener('click', resetNewReport);

    const btnDelete = document.getElementById('btn-delete-report');
    if (btnDelete) btnDelete.addEventListener('click', deleteCurrentReport);

    // [요청 반영] Data 파라미터 점검값 불러오기 버튼
    const btnLoadDataParams = document.getElementById('btn-load-data-params') || document.getElementById('btn-open-param-modal');
    if (btnLoadDataParams) btnLoadDataParams.addEventListener('click', loadDataParameters);

    const btnAddParam = document.getElementById('btn-add-custom-param');
    if (btnAddParam) btnAddParam.addEventListener('click', addCustomParamRow);

    const historySelect = document.getElementById('report-history-select');
    if (historySelect) {
        historySelect.addEventListener('change', () => {
            // [요청 반영] 참고 보고서 선택은 보고서 생성 시 참고할 데이터를 지정하는 용도
            debounceSaveReportState(100);
        });
    }
}

// [요청 반영] 1. 사업장, 장비, 점검일자, 점검자 선택 후 [보고서 생성] 클릭 시 1차 보고서 작성
// (참고 보고서가 선택되어 있다면 해당 보고서의 파라미터 점검 항목 및 작성된 이력을 복사 반영하여 생성)
async function createInitialReport() {
    if (!selectedSiteName || !selectedEquipId) {
        alert('사업장과 장비를 먼저 선택해주세요.');
        return;
    }

    // 시트 표시 활성화
    showReportSheet();

    // 점검일자 확인 및 즉시 시트에 자동 반영 (YYYY.MM.DD)
    const dateInput = document.getElementById('report-date-input');
    const dateVal = dateInput ? dateInput.value : '';
    updateSheetInspectDate(dateVal);

    // [요청 반영] S/N 및 설치장소 즉시 자동 반영
    const matchedEquip = allEquipmentList.find(eq => eq.id === selectedEquipId);
    if (matchedEquip) {
        updateSheetSerialNo(matchedEquip);
        updateSheetLocation(matchedEquip);
    }

    // 신규 생성이므로 currentReportId 초기화 및 기존 스크롤 박스 선택 해제
    currentReportId = null;
    document.querySelectorAll('.saved-history-card').forEach(c => c.classList.remove('selected'));

    // 참고할 보고서가 선택되어 있는지 확인
    const historySelect = document.getElementById('report-history-select');
    const refReportId = historySelect ? historySelect.value : '';

    if (refReportId) {
        try {
            const res = await fetch(`/api/report/${refReportId}`);
            if (res.ok) {
                const json = await res.json();
                const report = json.report || {};
                let sheetData = {};
                if (typeof report.data_json === 'string') {
                    try { sheetData = JSON.parse(report.data_json); } catch (e) { }
                } else if (report.data_json) {
                    sheetData = report.data_json;
                }

                // 1. 현재 점검일자의 DB 기초 정보(장비 기본정보 등) 먼저 로드
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

                // 점검일자 및 장비 정보는 현재 값으로 확실히 유지
                updateSheetInspectDate(dateVal);
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

    // 참고 보고서 미선택 시 기본 DB 데이터로 1차 생성
    await loadSourceDataFromDb(false);
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
function initSheetInteractions() {
    const sheet = document.getElementById('working-report-sheet');
    if (!sheet) return;

    sheet.addEventListener('click', (e) => {
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

        // [요청 반영] 장비 검색 후 Enter 시 바로 적용
        equipInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
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
                } else if (siteEquips.length > 0) {
                    matchedEquip = siteEquips[0];
                }

                if (matchedEquip) {
                    selectEquipment(matchedEquip);
                }
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
            renderInspectorSuggestions(inspectorInput.value.trim());
            inspectorWrapper.classList.add('open');
        });

        inspectorInput.addEventListener('input', () => {
            const val = inspectorInput.value;
            // 시트 점검자 실시간 즉시 반영
            const sheetInspector = document.getElementById('sheet-inspector');
            if (sheetInspector) sheetInspector.textContent = val;

            renderInspectorSuggestions(val.trim());
            inspectorWrapper.classList.add('open');
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

    // 시트 장비 메타 정보 초기화
    const sheetLocation = document.getElementById('sheet-location');
    if (sheetLocation) sheetLocation.textContent = '-';
    updateSheetSerialNo(null);
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

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="report-suggest-empty">일치하는 장비가 없습니다.</div>';
        return;
    }

    filtered.forEach(eq => {
        const item = document.createElement('div');
        item.className = 'report-suggest-item';
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

        bindScrollSafeClick(item, () => {
            selectEquipment(eq);
        });

        dropdown.appendChild(item);
    });
}

// 8. 장비 선택 처리 (모델명약어 + 고객사장비명 표시, 시리얼넘버, 설치장소 자동 세팅)
function selectEquipment(eq) {
    selectedEquipId = eq.id;
    // [요청 반영] 장비 선택 시 모델명 약어 나오고 고객사 장비명 나오게 적용 (없으면 시리얼넘버)
    const displayName = getEquipDisplayName(eq);
    
    const equipInput = document.getElementById('report-equip-input');
    const equipSelect = document.getElementById('report-equip-select');
    if (equipInput) equipInput.value = displayName;
    if (equipSelect) equipSelect.value = eq.id;

    // 1. [요청 반영] Report S/N에 고객사 장비명 또는 시리얼 넘버 자동 입력 (고객사장비명 우선)
    updateSheetSerialNo(eq);

    // 2. [요청 반영] 설치 장소: 건물명 층 세부위치 순으로 자동 기록
    updateSheetLocation(eq);

    // 3. [요청 반영] 점검일자 자동 입력
    const dateInput = document.getElementById('report-date-input');
    updateSheetInspectDate(dateInput ? dateInput.value : '');

    // 4. 모델 타이틀 갱신
    const sheetTitle = document.getElementById('sheet-title');
    if (sheetTitle) {
        sheetTitle.textContent = `${eq.model_name || eq.name || 'ICAP-RQ'} Working Report`;
    }

    closeAllSuggestionDropdowns();
    debounceSaveReportState(100);
    onEquipmentOrDateChange();
}

// 9. 점검자 제안박스 목록 렌더링
function renderInspectorSuggestions(filterKeyword = '') {
    const dropdown = document.getElementById('report-inspector-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    const kw = filterKeyword.toLowerCase();

    const filtered = allWorkersList.filter(w => {
        if (!kw) return true;
        const name = (w.name || '').toLowerCase();
        const dept = (w.department || '').toLowerCase();
        const site = (w.site || '').toLowerCase();
        return name.includes(kw) || dept.includes(kw) || site.includes(kw);
    });

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="report-suggest-empty">일치하는 작업자가 없습니다. (직접 입력 가능)</div>';
        return;
    }

    filtered.forEach(w => {
        const item = document.createElement('div');
        item.className = 'report-suggest-item';

        const workerName = w.name || '';
        const deptInfo = [w.department, w.position].filter(Boolean).join(' ');

        item.innerHTML = `
            <span><strong>${escapeHtml(workerName)}</strong></span>
            <span style="font-size: 11px; color: var(--side-muted);">${escapeHtml(deptInfo)} ${w.site ? `(${w.site})` : ''}</span>
        `;

        bindScrollSafeClick(item, () => {
            selectInspector(workerName);
        });

        dropdown.appendChild(item);
    });
}

// 10. 점검자 선택 처리 (레포트 점검자에 자동 추가/반영)
function selectInspector(workerName) {
    const inspectorInput = document.getElementById('report-inspector-input');
    if (inspectorInput) inspectorInput.value = workerName;

    const sheetInspector = document.getElementById('sheet-inspector');
    if (sheetInspector) sheetInspector.textContent = workerName;

    closeAllSuggestionDropdowns();
    debounceSaveReportState(100);
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
                            <span class="card-inspector">👤 ${inspectorName}</span>
                        </div>
                        <div class="card-title">${titleText}</div>
                    `;

                    // [요청 반영] 박스 스크롤 리스트에서 클릭하면 해당 보고서가 즉시 시트에 로드되어 나옴
                    card.addEventListener('click', async () => {
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
                <td class="report-param-status" contenteditable="true" spellcheck="false"></td>
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
            <td class="report-param-status" contenteditable="true" spellcheck="false">${escapeHtml(rightStatus)}</td>
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
        <td class="report-param-status" contenteditable="true" spellcheck="false"></td>
    `;
    tbody.appendChild(tr);
    debounceSaveReportState(100);
}

// 19. 상단 파라미터 테이블에서 현재 데이터 수집
function collectParametersFromTable() {
    const tbody = document.getElementById('report-params-tbody');
    if (!tbody) return [];

    const rows = tbody.querySelectorAll('.param-row, tr');
    const items = [];

    rows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 6) {
            const leftName = cells[0].textContent.trim();
            const leftRange = cells[1].textContent.trim();
            const leftStatus = cells[2].textContent.trim();

            if (leftName) {
                items.push({ name: leftName, standard: leftRange, status: leftStatus });
            }

            const rightName = cells[3].textContent.trim();
            const rightRange = cells[4].textContent.trim();
            const rightStatus = cells[5].textContent.trim();

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
    const workLog = (document.getElementById('sheet-work-log') || document.getElementById('sheet-history-content') || {}).innerHTML || '';
    const equipCheckState = (document.getElementById('sheet-equip-check-state') || document.getElementById('sheet-drive-status') || {}).innerHTML || '';
    const replacedParts = (document.getElementById('sheet-replaced-parts') || {}).innerHTML || '';
    const nextSchedule = (document.getElementById('sheet-next-plans') || document.getElementById('sheet-next-schedule') || {}).innerHTML || '';
    const managerDiscussion = (document.getElementById('sheet-agreed-matters') || document.getElementById('sheet-manager-discussion') || {}).innerHTML || '';
    const specialNotes = (document.getElementById('sheet-special-notes') || document.getElementById('sheet-special-text') || {}).innerHTML || '';

    return {
        title,
        date_text: dateText,
        inspector,
        location,
        serial_no: serialNo,
        checkboxes,
        parameters,
        history_title: historyTitle,
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

// 21. 시트에 JSON 데이터 반영
function applySheetData(sheetData) {
    if (!sheetData) return;

    if (sheetData.title) {
        const el = document.getElementById('sheet-title');
        if (el) el.textContent = sheetData.title;
    }
    if (sheetData.date_text) {
        const el = getSheetDateEl();
        if (el) el.textContent = sheetData.date_text;
    }
    if (sheetData.inspector !== undefined) {
        const el = document.getElementById('sheet-inspector');
        if (el) el.textContent = sheetData.inspector;
        const inspectorInput = document.getElementById('report-inspector-input');
        if (inspectorInput) inspectorInput.value = sheetData.inspector;
    }
    if (sheetData.location !== undefined) {
        const el = document.getElementById('sheet-location');
        if (el) el.textContent = sheetData.location;
    }
    if (sheetData.serial_no !== undefined) {
        const el = getSheetSerialEl();
        if (el) el.textContent = sheetData.serial_no;
    }

    // 체크박스 반영 (data-key, checkbox id, group:val 모두 호환)
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

    // 파라미터 테이블 반영
    if (sheetData.parameters) {
        renderParametersTable(sheetData.parameters);
    }

    // 텍스트 블록 반영 (HTML/Text 호환 안전 렌더링)
    if (sheetData.history_title !== undefined) {
        const el = document.getElementById('sheet-history-title');
        if (el) el.textContent = sheetData.history_title;
    }
    const setBlockContent = (el, val) => {
        if (!el || val === undefined) return;
        if (typeof val === 'string' && (val.includes('<') || val.includes('&'))) {
            el.innerHTML = val;
        } else {
            el.textContent = val;
        }
    };

    setBlockContent(document.getElementById('sheet-work-log') || document.getElementById('sheet-history-content'), sheetData.work_log);
    setBlockContent(document.getElementById('sheet-equip-check-state') || document.getElementById('sheet-drive-status'), sheetData.equip_check_state);
    setBlockContent(document.getElementById('sheet-replaced-parts'), sheetData.replaced_parts);
    setBlockContent(document.getElementById('sheet-agreed-matters') || document.getElementById('sheet-manager-discussion'), sheetData.agreed_matters || sheetData.manager_discussion);
    setBlockContent(document.getElementById('sheet-next-plans') || document.getElementById('sheet-next-schedule'), sheetData.next_plans || sheetData.next_schedule);
    setBlockContent(document.getElementById('sheet-special-notes') || document.getElementById('sheet-special-text'), sheetData.special_notes);
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

// 23. 저장된 특정 보고서 로드
async function loadSavedReport(reportId) {
    if (!reportId) return;

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

        const dateInput = document.getElementById('report-date-input');
        if (dateInput && report.report_date) {
            dateInput.value = report.report_date;
            updateSheetInspectDate(report.report_date);
        }

        let sheetData = {};
        if (typeof report.data_json === 'string') {
            try { sheetData = JSON.parse(report.data_json); } catch (e) { }
        } else if (report.data_json) {
            sheetData = report.data_json;
        }

        applySheetData(sheetData);

        // [상태 유지] 로드 직후 작업 상태 세션 스토리지 동기화
        saveReportWorkspaceState();
    } catch (err) {
        console.error('Failed to load saved report:', err);
        alert('보고서를 불러오는 중 오류가 발생했습니다.');
    }
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

// 26. DB 파라미터 선택 모달 열기
async function openDbParamsModal() {
    if (!selectedEquipId) {
        alert('장비를 먼저 선택해주세요.');
        return;
    }

    const matchedEquip = allEquipmentList.find(eq => eq.id === selectedEquipId) || {};
    const modelName = matchedEquip.model_name || matchedEquip.name || '';

    const modal = document.getElementById('modal-db-params');
    const listEl = document.getElementById('modal-param-list');
    if (!modal || !listEl) return;

    listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--side-muted);">파라미터 목록 로딩 중...</div>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`/api/report/model_parameters?model_name=${encodeURIComponent(modelName)}`);
        const json = await res.json();
        const params = json.parameters || [];

        if (params.length === 0) {
            listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--side-muted);">등록된 마스터 파라미터가 없습니다.</div>';
            return;
        }

        const currentItems = collectParametersFromTable();
        const currentNames = new Set(currentItems.map(p => p.name));

        listEl.innerHTML = '';
        params.forEach(p => {
            const isAlreadyAdded = currentNames.has(p.name);
            const itemDiv = document.createElement('div');
            itemDiv.className = 'modal-param-item';
            itemDiv.setAttribute('data-name', p.name || '');
            itemDiv.setAttribute('data-std', p.standard || '');

            itemDiv.innerHTML = `
                <input type="checkbox" id="chk-param-${p.id}" value="${p.id}" ${isAlreadyAdded ? 'checked disabled' : ''}>
                <label for="chk-param-${p.id}" style="margin: 0; cursor: pointer; flex: 1;">
                    <strong>${escapeHtml(p.name)}</strong>
                    <span style="color: var(--side-muted); font-size: 11px; margin-left: 8px;">(정상범위: ${escapeHtml(p.standard || '-')})</span>
                    ${isAlreadyAdded ? '<span style="color: var(--side-accent); font-size: 11px; margin-left: 6px;">[이미 추가됨]</span>' : ''}
                </label>
            `;
            listEl.appendChild(itemDiv);
        });
    } catch (err) {
        console.error('Failed to load model parameters:', err);
        listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #f85149;">파라미터를 불러오지 못했습니다.</div>';
    }
}

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

    checkedBoxes.forEach(chk => {
        const parent = chk.closest('.modal-param-item');
        if (parent) {
            const name = parent.getAttribute('data-name');
            const std = parent.getAttribute('data-std');
            currentItems.push({
                name: name,
                standard: std,
                status: '정상'
            });
        }
    });

    renderParametersTable(currentItems);
    debounceSaveReportState(100);
    closeReportParamModal();
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
