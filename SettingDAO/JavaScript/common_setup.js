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
// [추가] 셋업 구분 (사전 작업 + 1~9단계) 표시 순서. 템플릿에 없는 구분은 '9단계 - 종료' 앞에 표시
// (HOME 화면은 이 파일을 두 번 불러오므로 const 대신 window 속성으로 선언)
window.SETUP_FINAL_CATEGORY = '9단계 - 종료';
window.SETUP_CATEGORY_ORDER = [
    '사전 작업',
    '1단계 - 납품/정위치',
    '2단계 - 다이크/지진브라켓',
    '3단계 - 전기 턴온',
    '4단계 - 인터락테스트',
    '5단계 - 유틸리티 턴온/인증',
    '6단계 - 설비안정화 및 구동',
    '7단계 - 셋업평가',
    '8단계 - 셋업보고서',
    '9단계 - 종료'
];

// [추가] 옛 셋업 구분 → 단계 구분 (서버 app.py map_setup_category 와 같은 규칙, 세부 구분 기준)
window.mapSetupCategory = function (category, subcategory, content) {
    const cat = (category || '').trim();
    const key = (subcategory || content || '').trim();
    if (cat === '장비 반입 및 정위치') return key.includes('다이크') ? '2단계 - 다이크/지진브라켓' : '1단계 - 납품/정위치';
    if (cat === '통신 상태 및 유틸리티') return key.includes('인터락') ? '4단계 - 인터락테스트' : '5단계 - 유틸리티 턴온/인증';
    if (cat === '셋업 평가') return key.includes('안정화') ? '6단계 - 설비안정화 및 구동' : '7단계 - 셋업평가';
    if (cat === '셋업 완료') return '9단계 - 종료';
    return category;
};

// [추가] 기본 셋업 템플릿 (ADMIN 에 저장된 템플릿이 없을 때 사용)
//  ※ 서버 app.py SETUP_STAGE_DEFAULT_ITEMS 와 같은 목록 (한쪽을 바꾸면 같이 바꿀 것)
window.getDefaultSetupTemplate = function () {
    const rows = [
        ["사전 작업", "현장 사전 점검", "설치 위치 및 반입 경로 확인", "1"],
        ["사전 작업", "현장 사전 점검", "설치 공간/하중 확인", "1"],
        ["사전 작업", "작업 허가", "작업 허가(PTW) 신청", "1"],
        ["사전 작업", "작업 허가", "안전교육 이수", "1"],
        ["사전 작업", "자재 준비", "설치 자재 및 공구 준비", "1"],
        // 1~8단계 세부 구분 = 셋업 단계표의 세부단계 (8단계는 세부단계 없음 → 단계 이름이 세부 구분으로 자동 표시)
        //  5-1 / 5-2 는 세부 선택항목(EXH·Bulk 등)을 작업 내용으로 둠
        ["1단계 - 납품/정위치", "1-1 납품", "1-1 납품", "1"],
        ["1단계 - 납품/정위치", "1-2 정위치", "1-2 정위치", "1"],
        ["1단계 - 납품/정위치", "1-3 수평 확인", "1-3 수평 확인", "1"],
        ["2단계 - 다이크/지진브라켓", "2-1 다이크 납품", "2-1 다이크 납품", "1"],
        ["2단계 - 다이크/지진브라켓", "2-2 다이크 설치", "2-2 다이크 설치", "1"],
        ["2단계 - 다이크/지진브라켓", "2-3 다이크 침수테스트", "2-3 다이크 침수테스트", "1"],
        ["2단계 - 다이크/지진브라켓", "2-4 지진브라켓 설치", "2-4 지진브라켓 설치", "1"],
        ["3단계 - 전기 턴온", "3-1 전기/LAN 턴온", "3-1 전기/LAN 턴온", "1"],
        ["3단계 - 전기 턴온", "3-2 LAN 통신 확인", "3-2 LAN 통신 확인", "1"],
        ["4단계 - 인터락테스트", "4-1 인터락테스트", "4-1 인터락테스트", "2"],
        ["5단계 - 유틸리티 턴온/인증", "5-1 유틸리티 턴온", "EXH", "1"],
        ["5단계 - 유틸리티 턴온/인증", "5-1 유틸리티 턴온", "Bulk", "1"],
        ["5단계 - 유틸리티 턴온/인증", "5-1 유틸리티 턴온", "UPW", "1"],
        ["5단계 - 유틸리티 턴온/인증", "5-1 유틸리티 턴온", "Drain", "1"],
        ["5단계 - 유틸리티 턴온/인증", "5-2 인증", "FOUP 센터/수평", "1"],
        ["5단계 - 유틸리티 턴온/인증", "5-2 인증", "OHT", "1"],
        ["5단계 - 유틸리티 턴온/인증", "5-2 인증", "PIO(E84)", "1"],
        ["6단계 - 설비안정화 및 구동", "6-1 로컬테스트", "6-1 로컬테스트", "1"],
        ["6단계 - 설비안정화 및 구동", "6-2 로봇 티칭", "6-2 로봇 티칭", "1"],
        ["6단계 - 설비안정화 및 구동", "6-3 용액 설치 및 안정화", "6-3 용액 설치 및 안정화", "5"],
        ["7단계 - 셋업평가", "7-1 STD 측정 및 Calibration", "7-1 STD 측정 및 Calibration", "2"],
        ["7단계 - 셋업평가", "7-2 신뢰성 평가", "7-2 신뢰성 평가", "5"],
        ["7단계 - 셋업평가", "7-3 기타 평가", "7-3 기타 평가", "1"],
        ["9단계 - 종료", "인수인계", "고객 교육 및 인수인계", "1"],
        ["9단계 - 종료", "셋업 완료", "셋업 완료", "0"]
    ];
    return rows.map(([category, subcategory, content, estDays]) => ({ category, subcategory, content, estDays }));
};

// [추가] 셋업 템플릿 목록을 화면용으로 정리 (원본은 변경하지 않음)
//  - 옛 구분 이름은 단계 이름으로 변환
//  - 세부 구분이 아직 없는 단계는 단계 이름을 세부 구분으로 하나 넣어 바로 선택 가능하게 함
//    ('9단계 - 종료'는 '셋업 완료'). ADMIN > 셋업 템플릿에서 세부 구분을 등록하면 그 목록이 대신 사용됨
//  - 셋업 구분 순서 정렬
window.normalizeSetupTemplate = function (list) {
    const out = (Array.isArray(list) ? list : []).filter(t => t && typeof t === 'object').map(t => {
        const cat = window.mapSetupCategory(t.category, t.subcategory, t.content);
        return cat === t.category ? t : Object.assign({}, t, { category: cat });
    });
    window.SETUP_CATEGORY_ORDER.forEach(cat => {
        if (out.some(t => t.category === cat)) return;
        const sub = cat === window.SETUP_FINAL_CATEGORY ? '셋업 완료' : cat;
        out.push({ category: cat, subcategory: sub, content: sub, estDays: cat === window.SETUP_FINAL_CATEGORY ? '0' : '1' });
    });
    const order = window.SETUP_CATEGORY_ORDER;
    const rank = (c) => {
        const i = order.indexOf(c);
        return i >= 0 ? i : order.length - 1.5;
    };
    return out.map((t, i) => [t, i])
        .sort((a, b) => (rank(a[0].category) - rank(b[0].category)) || (a[1] - b[1]))
        .map(x => x[0]);
};

// [추가] 셋업은 프로젝트 단위로 관리
//  - 같은 사업장에서 프로젝트 번호가 같은 장비들을 한 프로젝트로 묶음 (번호가 없으면 장비 1대가 한 프로젝트)
//  - 데이터는 지금처럼 장비별로 저장하고, 화면에서 프로젝트 장비들의 일지·작업 항목을 합쳐서 보여줌
//  - 새 일지는 프로젝트 대표 장비(목록에서 첫 번째 장비)에 저장
window.getSetupProjectNo = function (site, equip) {
    try {
        const d = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
        return String((d.setup && d.setup.projectNo) || '').trim().toUpperCase();
    } catch (e) { return ''; }
};

window.getSetupSiteEquips = function (site) {
    let data = (typeof storageData !== 'undefined' && storageData && Object.keys(storageData).length) ? storageData : null;
    if (!data) { try { data = JSON.parse(localStorage.getItem('device_data')) || {}; } catch (e) { data = {}; } }
    if (data.equipments) data = data.equipments;
    return Array.isArray(data[site]) ? data[site] : [];
};

// 사업장의 프로젝트 목록 [{ projectNo, equips: [장비...] }] (목록 순서 유지, 첫 장비 = 대표)
window.getSetupProjects = function (site) {
    const groups = [];
    const byNo = {};
    window.getSetupSiteEquips(site).forEach(equip => {
        const no = window.getSetupProjectNo(site, equip);
        if (no && byNo[no]) { byNo[no].equips.push(equip); return; }
        const g = { projectNo: no, equips: [equip] };
        if (no) byNo[no] = g;
        groups.push(g);
    });
    return groups;
};

// 장비가 속한 프로젝트의 장비 목록 (대표 장비가 맨 앞)
window.getSetupProjectEquips = function (site, equip) {
    const no = window.getSetupProjectNo(site, equip);
    if (!no) return [equip];
    const g = window.getSetupProjects(site).find(p => p.projectNo === no);
    return (g && g.equips.includes(equip)) ? g.equips : [equip];
};

window.isSameSetupProject = function (site, equipA, equipB) {
    return equipA === equipB || window.getSetupProjectEquips(site, equipA).includes(equipB);
};

// 프로젝트 장비들의 작업 항목·일지를 합침 (항목마다 _equip = 실제 저장된 장비)
window.getSetupProjectData = function (site, equip, setupDataCache) {
    const setupData = setupDataCache || JSON.parse(localStorage.getItem('setup_data')) || {};
    const out = { setupDetails: [], setupLogs: [] };
    window.getSetupProjectEquips(site, equip).forEach(e => {
        const d = setupData[`${site}::${e}`] || {};
        (d.setupDetails || []).forEach(x => out.setupDetails.push(Object.assign({}, x, { _equip: e })));
        (d.setupLogs || []).forEach(x => out.setupLogs.push(Object.assign({}, x, { _equip: e })));
    });
    return out;
};

// 일지 id 가 실제로 저장된 장비 (프로젝트 안에서 찾음, 없으면 선택 장비)
window.findSetupLogEquip = function (site, equip, id) {
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const hit = window.getSetupProjectEquips(site, equip).find(e =>
        ((setupData[`${site}::${e}`] || {}).setupLogs || []).some(l => l.id == id));
    return hit || equip;
};

// [추가] 셋업 구분(AMCs, 광학, Chem, Wafer ...)별 일정 템플릿
//  - setup_templates['type:<셋업 구분>'] 에 저장, 없으면 공통(default) 사용
//  - 장비의 셋업 구분은 ADMIN > 장비 관리 > 셋업 구분 (details_*.setup.setupType)
window.SETUP_TYPE_TEMPLATE_PREFIX = 'type:';
window.getEquipSetupType = function (site, equip) {
    if (!site || !equip) return '';
    try {
        return String((((JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {}).setup) || {}).setupType || '').trim();
    } catch (e) { return ''; }
};
// setupType: 셋업 구분 / modelName: 모델별 사본(예전 방식) 키
window.getSetupTemplateRaw = function (setupType, modelName) {
    let templates = {};
    try { templates = JSON.parse(localStorage.getItem('setup_templates')) || {}; } catch (e) { }
    const own = setupType ? templates[window.SETUP_TYPE_TEMPLATE_PREFIX + setupType] : null;
    if (Array.isArray(own) && own.length) return own;
    const byModel = modelName ? templates[modelName] : null;
    if (Array.isArray(byModel) && byModel.length) return byModel;
    if (Array.isArray(templates['default']) && templates['default'].length) return templates['default'];
    return window.getDefaultSetupTemplate();
};
window.getSetupTemplateRawForEquip = function (site, equip, modelName) {
    return window.getSetupTemplateRaw(window.getEquipSetupType(site, equip), modelName);
};

// [추가] 셋업 진행률
//  - 단계 진행률 = 그 단계 세부 구분 중 완료된 개수 / 전체 개수
//  - 전체 진행률 = 단계 진행률의 평균 (단계마다 같은 비중)
//  - 세부 구분 완료 = 일지에서 '이 작업 완료'를 체크해 해당 작업 항목이 모두 완료된 상태
//  equipData: setup_data[사업장::장비] ({ setupDetails, setupLogs })
//  templateList: ADMIN 셋업 템플릿 (default)
window.computeSetupProgress = function (equipData, templateList) {
    const order = window.SETUP_CATEGORY_ORDER;
    const mapCat = window.mapSetupCategory;
    const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    const template = window.normalizeSetupTemplate(templateList);

    // 작업 내용 → 세부 구분 (예전 데이터 중 세부 구분이 비어 있는 항목을 제자리에 넣기 위함)
    const subByContent = {};
    template.forEach(t => {
        const key = `${t.category}::${norm(t.content)}`;
        if (t.content && !subByContent[key]) subByContent[key] = t.subcategory || t.content;
    });

    // 단계별 세부 구분 목록 (템플릿 순서, 이 장비에만 있는 세부 구분은 뒤에 추가)
    const stages = order.map(cat => ({ category: cat, subs: [] }));
    const stageOf = (cat) => stages.find(s => s.category === cat);
    const ensureSub = (cat, name) => {
        const stage = stageOf(cat);
        if (!stage || !name) return null;
        let sub = stage.subs.find(s => s.name === name);
        if (!sub) {
            sub = { name, tasks: [], logCount: 0 };
            stage.subs.push(sub);
        }
        return sub;
    };
    template.forEach(t => ensureSub(t.category, t.subcategory || t.content));

    const subNameOf = (cat, item) => item.subcategory
        || subByContent[`${cat}::${norm(item.content)}`]
        || item.content;

    (equipData.setupDetails || []).forEach(d => {
        const cat = mapCat(d.category, d.subcategory, d.content);
        const sub = ensureSub(cat, subNameOf(cat, d));
        if (sub) sub.tasks.push(d);
    });
    (equipData.setupLogs || []).forEach(l => {
        const cat = mapCat(l.category, l.subcategory, l.content);
        const stage = stageOf(cat);
        // 세부 구분 작업 기록 팝업(isSetupItemOfSub)과 같은 기준으로 집계
        const name = subNameOf(cat, l);
        const sub = stage && stage.subs.find(s => s.name === name);
        if (sub) sub.logCount++;
    });

    stages.forEach(stage => {
        stage.subs.forEach(sub => {
            // 프로젝트에 장비가 여러 대면 장비별로 보고, 어느 한 장비라도 그 세부 구분 작업을 모두 완료했으면 완료
            const byEquip = {};
            sub.tasks.forEach(t => { (byEquip[t._equip || ''] = byEquip[t._equip || ''] || []).push(t); });
            sub.excluded = sub.tasks.some(t => t.excluded);
            sub.done = !sub.excluded && Object.values(byEquip).some(list => list.every(t => t.completed));
            sub.status = sub.excluded ? '제외'
                : sub.done ? '완료'
                : (sub.logCount > 0 || sub.tasks.some(t => t.completed)) ? '진행 중' : '미착수';
        });
        const counted = stage.subs.filter(s => !s.excluded);
        stage.total = counted.length;
        stage.doneCount = counted.filter(s => s.done).length;
        stage.excluded = stage.subs.length > 0 && stage.total === 0;   // 세부 구분이 모두 불필요 작업
        stage.percent = stage.total ? stage.doneCount / stage.total * 100 : 0;
    });
    stages.forEach(st => { st.noProgress = st.category === '사전 작업'; });
    const active = stages.filter(s => !s.excluded && !s.noProgress);
    const overall = active.length ? active.reduce((a, s) => a + s.percent, 0) / active.length : 0;
    return { stages, overall };
};


// [추가] 다음에 할 세부 구분: 셋업 진행률 순서에서 마지막으로 완료한 세부 구분의 다음 (불필요 작업·완료 항목은 건너뜀)
//  - 완료한 것이 없으면 첫 세부 구분, 뒤쪽이 모두 완료면 앞쪽에 남은 미완료 항목
//  - 진행률을 계산하지 않는 단계(사전 작업)는 제외
window.getNextSetupSub = function (site, equip) {
    if (!site || !equip) return null;
    const { stages } = window.computeSetupProgress(window.getSetupProjectData(site, equip), window.getSetupTemplateRawForEquip(site, equip));
    const seq = [];
    stages.filter(st => !st.noProgress).forEach(st => st.subs.forEach(sub => seq.push({ category: st.category, sub: sub.name, done: sub.done, excluded: sub.excluded })));
    let lastDone = -1;
    seq.forEach((x, i) => { if (x.done) lastDone = i; });
    const open = (x) => !x.done && !x.excluded;
    const next = seq.slice(lastDone + 1).find(open) || seq.find(open);
    return next ? { category: next.category, sub: next.sub } : null;
};

// 셋업 진행률 화면 그리기 (HOME 셋업 관리, WORKS Setup 공용)
//  - 세부 구분을 클릭하면 그 세부 구분으로 일지 작성 창이 열림
window.renderSetupProgress = function (container, site, equip) {
    if (!container) return;
    const equipData = window.getSetupProjectData(site, equip);
    const templateList = window.getSetupTemplateRawForEquip(site, equip); // [수정] 장비의 셋업 구분 템플릿
    const { stages, overall } = window.computeSetupProgress(equipData, templateList);

    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pct = (v) => Math.round(v);
    const barColor = (v) => v >= 100 ? 'var(--c-green)' : v > 0 ? 'var(--c-yellow)' : 'var(--c-border)';
    const textColor = (v) => v > 0 ? barColor(v) : 'var(--c-text-muted)';
    const activeStages = stages.filter(s => !s.excluded && !s.noProgress);
    const doneStages = activeStages.filter(s => s.percent >= 100).length;
    const SUB_STYLE = {
        '완료': 'color:var(--c-green); border-color:#238636; background:rgba(35,134,54,0.15);',
        '진행 중': 'color:var(--c-yellow); border-color:#9e6a03; background:rgba(158,106,3,0.15);',
        '미착수': 'color:var(--c-text-muted); border-color:var(--c-border); background:transparent;',
        '제외': 'color:var(--c-red); border-color:#da3633; border-style:dashed; background:rgba(218,54,51,0.10);'
    };
    const SUB_MARK = { '완료': '✓ ', '진행 중': '● ', '미착수': '', '제외': '' };

    let html = `
        <div class="setup-progress__overall">
            <div class="setup-progress__overall-label">전체 셋업 진행률 <span>(완료 단계 ${doneStages} / ${activeStages.length})</span></div>
            <div class="setup-progress__bar setup-progress__bar--lg"><div style="width:${overall}%; background:${barColor(overall)};"></div></div>
            <div class="setup-progress__overall-value" style="color:${textColor(overall)};">${pct(overall)}%</div>
        </div>
        <div class="setup-progress__list">`;
    stages.forEach(stage => {
        // [추가] 세부 구분별 작업(일지) 등록 횟수 표시
        const countHtml = (sub) => sub.logCount > 0
            ? ` <span class="setup-progress__sub-count" style="display:inline-block; min-width:16px; padding:0 5px; margin-left:3px; border-radius:8px; background:rgba(110,118,129,0.35); color:var(--c-text); font-size:10px; font-weight:700; line-height:15px; text-align:center;">${sub.logCount}</span>`
            : '';
        const subsHtml = stage.subs.map(sub => `
            <button type="button" class="setup-progress__sub" style="${SUB_STYLE[sub.status]}"
                data-cat="${esc(stage.category)}" data-sub="${esc(sub.name)}" title="${esc(sub.name)} : ${sub.status === '제외' ? '불필요 작업 (진행률 제외)' : sub.status} · 작업 ${sub.logCount}회 (클릭 시 작업 기록 목록)">${SUB_MARK[sub.status]}${sub.status === '제외' ? `<s>${esc(sub.name)}</s>` : esc(sub.name)}${countHtml(sub)}</button>`).join('');
        html += `
            <div class="setup-progress__row${stage.excluded ? ' setup-progress__row--excluded' : ''}">
                <div class="setup-progress__stage" title="${esc(stage.category)}">${esc(stage.category)}</div>
                ${stage.noProgress ? '<div class="setup-progress__bar setup-progress__bar--none"></div>' : `<div class="setup-progress__bar"><div style="width:${stage.percent}%; background:${barColor(stage.percent)};"></div></div>`}
                <div class="setup-progress__value">${stage.noProgress ? '' : stage.excluded ? '<strong style="color:var(--c-red);">전체 불필요</strong>' : `${stage.doneCount}/${stage.total} <strong style="color:${textColor(stage.percent)};">${pct(stage.percent)}%</strong>`}</div>
                <div class="setup-progress__subs">${subsHtml}</div>
            </div>`;
    });
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.setup-progress__sub').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            window.openSetupSubLogPopup(site, equip, btn.dataset.cat, btn.dataset.sub);
        };
    });
};

// [추가] 세부 구분 작업 기록 목록 팝업
//  - 프로젝트 장비들의 해당 세부 구분 일지 목록 (클릭 시 수정)
//  - [작업 추가] 같은 세부 구분으로 새 일지 작성
//  - [작업 완료 처리] / [완료 취소] 세부 구분 완료 상태를 직접 지정
window.setupSubName = function (item, category, template) {
    const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    if (item.subcategory) return item.subcategory;
    const hit = (template || []).find(t => t.category === category && norm(t.content) === norm(item.content));
    return hit ? (hit.subcategory || hit.content) : item.content;
};

function getSetupTemplateForPopup(site, equip) {
    return window.normalizeSetupTemplate(window.getSetupTemplateRawForEquip(site, equip)); // [수정] 장비의 셋업 구분 템플릿
}

// 세부 구분에 해당하는 작업 항목/일지인지
function isSetupItemOfSub(item, category, sub, template) {
    const cat = window.mapSetupCategory(item.category, item.subcategory, item.content);
    return cat === category && window.setupSubName(item, cat, template) === sub;
}

window.openSetupSubLogPopup = function (site, equip, category, sub) {
    let modal = document.getElementById('setup-sub-log-popup');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'setup-sub-log-popup';
        modal.className = 'modal-overlay';
        // 작업 기록 창(셋업 작업 기록)이 이 팝업 위에 뜨도록 한 단계 아래에 둠
        modal.style.zIndex = '1040';
        modal.innerHTML = `
            <div class="modal-window setup-sub-log-window">
                <div class="modal-header">
                    <h3 class="setup-sub-log-title"></h3>
                    <button type="button" class="btn-del-sm" data-act="close">✕</button>
                </div>
                <div class="modal-body">
                    <div class="setup-sub-log-status"></div>
                    <div class="setup-sub-log-table-wrap">
                        <table class="data-table setup-sub-log-table">
                            <thead><tr><th style="width:100px;">날짜</th><th>내용</th><th style="width:110px;">작업자</th><th style="width:50px;">공수</th></tr></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer setup-sub-log-footer">
                    <button type="button" class="btn-green" data-act="add">➕ 작업 추가</button>
                    <button type="button" class="btn-blue" data-act="done">✓ 작업 완료 처리</button>
                    <button type="button" class="btn-gray" data-act="close">닫기</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    }
    modal._ctx = { site, equip, category, sub };
    window.refreshSetupSubLogPopup();
    modal.style.display = 'flex';
};

window.refreshSetupSubLogPopup = function () {
    const modal = document.getElementById('setup-sub-log-popup');
    if (!modal || !modal._ctx) return;
    const { site, equip, category, sub } = modal._ctx;
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const template = getSetupTemplateForPopup(site, equip);
    const data = window.getSetupProjectData(site, equip);
    const projectEquips = window.getSetupProjectEquips(site, equip);

    const logs = data.setupLogs.filter(l => isSetupItemOfSub(l, category, sub, template))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || ((b.id || 0) - (a.id || 0)));
    const progress = window.computeSetupProgress(data, template);
    const stage = progress.stages.find(st => st.category === category);
    const subInfo = stage && stage.subs.find(x => x.name === sub);
    const status = subInfo ? subInfo.status : '미착수';
    const isFinal = sub === '셋업 완료' || category === window.SETUP_FINAL_CATEGORY && sub === '셋업 완료';

    modal.querySelector('.setup-sub-log-title').textContent = `${category} > ${sub}`;
    const color = { '완료': '#3fb950', '진행 중': '#d29922', '미착수': '#8b949e', '제외': '#6e7681' }[status];
    const isExcluded = status === '제외';
    // 불필요 작업: 착수한 작업(기록)이 하나도 없을 때만 표시, '셋업 완료'는 제외 불가
    const canExclude = !isExcluded && status === '미착수' && logs.length === 0 && !isFinal;
    const statusEl = modal.querySelector('.setup-sub-log-status');
    statusEl.innerHTML =
        `<span class="setup-sub-log-badge" style="color:${color}; border-color:${color};">${isExcluded ? '불필요 작업 (진행률 제외)' : status}</span>` +
        `<span style="color:var(--c-text-muted); font-size:12px;">작업 기록 ${logs.length}건</span>` +
        (canExclude ? '<button type="button" class="setup-sub-log-exclude" data-act="exclude">🚫 불필요 작업</button>' : '') +
        (isExcluded ? '<button type="button" class="btn-gray setup-sub-log-unexclude" data-act="unexclude">↺ 제외 취소</button>' : '');
    const toggleExclude = async (flag) => {
        const msg = flag ? `'${sub}'을(를) 불필요 작업으로 지정하시겠습니까?\n셋업 진행률 계산에서 제외됩니다.` : `'${sub}' 불필요 작업 지정을 취소하시겠습니까?`;
        if (!confirm(msg)) return;
        const ok = await window.setSetupSubExcluded(site, equip, category, sub, flag);
        if (!ok) return alert('저장 중 오류가 발생했습니다.');
        window.refreshSetupSubLogPopup();
        window.refreshSetupProgressViews();
    };
    const exBtn = statusEl.querySelector('[data-act="exclude"]');
    if (exBtn) exBtn.onclick = () => toggleExclude(true);
    const unexBtn = statusEl.querySelector('[data-act="unexclude"]');
    if (unexBtn) unexBtn.onclick = () => toggleExclude(false);

    const equipLabel = (e) => {
        if (projectEquips.length < 2) return '';
        let cust = '';
        try { cust = ((JSON.parse(localStorage.getItem(`details_${site}_${e}`)) || {}).setup || {}).custEquipName || ''; } catch (err) { }
        const parts = String(e).split('::');
        return ` <span style="font-size:10px; color:var(--c-text-muted); border:1px solid var(--c-border); border-radius:8px; padding:0 5px;">${esc(cust || parts[1] || parts[0])}</span>`;
    };
    const tbody = modal.querySelector('tbody');
    tbody.innerHTML = logs.length ? logs.map(l => `
        <tr data-id="${esc(l.id)}" data-equip="${esc(l._equip)}" style="cursor:pointer;" title="클릭 시 작업 기록 수정">
            <td>${esc(l.date)}</td>
            <td style="text-align:left;">${esc(l.content || '-')}${equipLabel(l._equip)}</td>
            <td>${esc(l.worker)}</td>
            <td style="color:var(--c-yellow); font-weight:bold;">${esc(l.md || '0')}</td>
        </tr>`).join('')
        : '<tr><td colspan="4" style="padding:24px; text-align:center; color:var(--c-text-muted);">아직 작업 기록이 없습니다. [작업 추가]로 작성해주세요.</td></tr>';
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.onclick = () => {
            if (typeof window.openLogForEditing === 'function') window.openLogForEditing(site, tr.dataset.equip, Number(tr.dataset.id));
        };
    });

    const doneBtn = modal.querySelector('[data-act="done"]');
    const addBtn = modal.querySelector('[data-act="add"]');
    doneBtn.style.display = isExcluded ? 'none' : '';
    addBtn.style.display = isExcluded ? 'none' : '';
    if (isFinal) {
        doneBtn.disabled = true;
        doneBtn.textContent = '✓ 작업 완료 처리';
        doneBtn.title = "'셋업 완료'는 작업 기록을 작성하면 자동으로 완료됩니다.";
        doneBtn.style.opacity = '0.5';
    } else {
        doneBtn.disabled = false;
        doneBtn.style.opacity = '';
        doneBtn.title = '';
        doneBtn.textContent = status === '완료' ? '↺ 완료 취소' : '✓ 작업 완료 처리';
        doneBtn.className = status === '완료' ? 'btn-gray' : 'btn-blue';
    }

    modal.querySelectorAll('[data-act="close"]').forEach(b => { b.onclick = () => { modal.style.display = 'none'; }; });
    modal.querySelector('[data-act="add"]').onclick = () => {
        if (typeof window.openSetupLogRegisterModal === 'function') {
            window.openSetupLogRegisterModal(site, equip, sub, '', false, false, category);
        }
    };
    doneBtn.onclick = async () => {
        if (doneBtn.disabled) return;
        const makeDone = status !== '완료';
        if (!confirm(makeDone ? `'${sub}' 작업을 완료 처리하시겠습니까?` : `'${sub}' 작업 완료를 취소하시겠습니까?`)) return;
        doneBtn.disabled = true;
        const ok = await window.setSetupSubCompleted(site, equip, category, sub, makeDone);
        doneBtn.disabled = false;
        if (!ok) return alert('저장 중 오류가 발생했습니다.');
        window.refreshSetupSubLogPopup();
        window.refreshSetupProgressViews();
    };
};

// 세부 구분 완료 상태 지정 (프로젝트 장비 모두에 반영, 대표 장비에 항목이 없으면 새로 만듦)
window.setSetupSubCompleted = async function (site, equip, category, sub, done) {
    const template = getSetupTemplateForPopup(site, equip);
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equips = window.getSetupProjectEquips(site, equip);
    const changed = [];
    equips.forEach((e, idx) => {
        const key = `${site}::${e}`;
        const data = setupData[key] || {};
        if (!data.setupDetails) data.setupDetails = [];
        let tasks = data.setupDetails.filter(t => isSetupItemOfSub(t, category, sub, template));
        if (!tasks.length && done && idx === 0) {
            const t = { id: Date.now(), category, subcategory: sub, content: sub, startDate: '', date: '', estDays: '1',
                        completed: false, execStartDate: '', delayReason: '', worker: '' };
            data.setupDetails.push(t);
            tasks = [t];
        }
        if (!tasks.length) return;
        tasks.forEach(t => { t.completed = !!done; });
        setupData[key] = data;
        changed.push(e);
    });
    localStorage.setItem('setup_data', JSON.stringify(setupData));
    let ok = true;
    for (const e of changed) {
        const data = setupData[`${site}::${e}`];
        if (typeof window.syncSetupDataDB === 'function') {
            const r = await window.syncSetupDataDB(site, e, data.setupDetails || [], data.setupLogs || []);
            if (r === false) ok = false;
        }
    }
    if (typeof addSystemLog === 'function') addSystemLog('UPDATE_SETUP_TASK', equip, `[${category} > ${sub}] ${done ? '작업 완료 처리' : '작업 완료 취소'}`);
    return ok;
};

// 세부 구분 불필요 작업 지정/취소
window.setSetupSubExcluded = async function (site, equip, category, sub, excluded) {
    const template = getSetupTemplateForPopup(site, equip);
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equips = window.getSetupProjectEquips(site, equip);
    const changed = [];
    equips.forEach((e, idx) => {
        const key = `${site}::${e}`;
        const data = setupData[key] || {};
        if (!data.setupDetails) data.setupDetails = [];
        let tasks = data.setupDetails.filter(t => isSetupItemOfSub(t, category, sub, template));
        if (!tasks.length && excluded && idx === 0) {
            const t = { id: Date.now(), category, subcategory: sub, content: sub, startDate: '', date: '', estDays: '1',
                        completed: false, execStartDate: '', delayReason: '', worker: '' };
            data.setupDetails.push(t);
            tasks = [t];
        }
        if (!tasks.length) return;
        tasks.forEach(t => { t.excluded = !!excluded; });
        setupData[key] = data;
        changed.push(e);
    });
    localStorage.setItem('setup_data', JSON.stringify(setupData));
    let ok = true;
    for (const e of changed) {
        const data = setupData[`${site}::${e}`];
        if (typeof window.syncSetupDataDB === 'function') {
            const r = await window.syncSetupDataDB(site, e, data.setupDetails || [], data.setupLogs || []);
            if (r === false) ok = false;
        }
    }
    if (typeof addSystemLog === 'function') addSystemLog('UPDATE_SETUP_TASK', equip, `[${category} > ${sub}] ${excluded ? '불필요 작업 지정' : '불필요 작업 취소'}`);
    return ok;
};

// 진행률 화면들 다시 그리기 (HOME 셋업 관리 / WORKS Setup)
window.refreshSetupProgressViews = function () {
    if (typeof renderGanttChart === 'function') renderGanttChart();
    if (typeof renderSetupLogList === 'function') renderSetupLogList();
    if (typeof updateSetupDashboard === 'function') updateSetupDashboard();
};

// [추가] '셋업 완료' 항목 여부 (일지를 쓰면 바로 완료 처리되는 특수 항목)
function isSetupCompleteTask(t) {
    return !!t && (t.category === '셋업 완료' || t.subcategory === '셋업 완료' || t.content === '셋업 완료');
}

// [추가] 일지(구분·세부 구분·내용)에 연결되는 일정 항목 찾기 (저장 시 매칭 규칙과 동일)
function findSetupTasksForLog(data, category, subcategory, content) {
    const task = subcategory || content;
    const isCompleteLog = category === '셋업 완료' || subcategory === '셋업 완료' || content === '셋업 완료';
    return (data.setupDetails || []).filter(t => {
        const isCatMatch = !t.category || !category || t.category === category;
        const isSubMatch = (t.subcategory && (t.subcategory === subcategory || t.subcategory === content || t.subcategory === task)) ||
                           (t.content && (t.content === content || t.content === subcategory || t.content === task));
        return (isCatMatch && isSubMatch) || (isCompleteLog && isSetupCompleteTask(t));
    });
}

// [추가] 세부 선택항목 (복수 선택)
//  - 1~8단계 세부 구분 중, ADMIN 셋업 템플릿에서 세부 구분 이름과 다른 작업 내용이 등록된 경우 그 작업 내용들이 선택항목
//    (예: 5-1 유틸리티 턴온 → EXH·Bulk·UPW·Drain / 5-2 인증 → FOUP 센터/수평·OHT·PIO(E84))
//  - 일지에는 subOptions 에 쉼표로 이어서 저장 (예: "EXH, Bulk")
window.getSetupSubOptions = function (category, subcategory, site, equip) {
    if (!category || !subcategory || !/^[1-8]단계/.test(category)) return [];
    const raw = window.getSetupTemplateRawForEquip(site, equip); // [수정] 장비의 셋업 구분 템플릿
    const list = window.normalizeSetupTemplate(raw);
    const opts = list
        .filter(t => t.category === category && t.subcategory === subcategory)
        .map(t => String(t.content || '').trim())
        .filter(c => c && c !== subcategory);
    return Array.from(new Set(opts));
};

window.parseSetupSubOptions = function (value) {
    return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
};

// [추가] 셋업 작업 기록 창: 구분별 진행률·세부 구분별 상태 (셋업 진행률 화면과 같은 계산)
window.getSetupLogRegProgress = function (modal) {
    const site = (modal.querySelector('#setup-log-reg-site') || {}).value || '';
    const equip = (modal.querySelector('#setup-log-reg-equip') || {}).value || '';
    if (!site || !equip || typeof window.computeSetupProgress !== 'function') return null;
    try {
        const { stages } = window.computeSetupProgress(window.getSetupProjectData(site, equip), window.getSetupTemplateRawForEquip(site, equip));
        const stage = {}, sub = {};
        stages.forEach(st => {
            stage[st.category] = st;
            st.subs.forEach(s => { sub[`${st.category}::${s.name}`] = s; });
        });
        return { stage, sub };
    } catch (e) { return null; }
};
var SETUP_SUB_STATUS_COLOR = { '완료': '#3fb950', '진행 중': '#d29922', '미착수': '#8b949e', '제외': '#6e7681' };
window.setupStageProgressText = (st) => (!st || st.noProgress) ? '' : (st.excluded ? '제외' : `${Math.round(st.percent)}%`);
window.setupSubStatusHtml = (s) => s ? `<span style="color:${SETUP_SUB_STATUS_COLOR[s.status] || '#8b949e'};">${s.status}</span>` : '';

window.updateSetupLogRegProgress = function (modalContext) {
    const modal = modalContext || document;
    const catEl = modal.querySelector('#setup-log-reg-category-progress');
    const subEl = modal.querySelector('#setup-log-reg-subcategory-progress');
    if (!catEl && !subEl) return;
    const cat = (modal.querySelector('#setup-log-reg-category') || {}).value || '';
    const sub = (modal.querySelector('#setup-log-reg-subcategory') || {}).value || '';
    const prog = window.getSetupLogRegProgress(modal);
    const st = prog && cat ? prog.stage[cat] : null;
    if (catEl) catEl.innerHTML = st && window.setupStageProgressText(st) ? `<b>${window.setupStageProgressText(st)}</b>` : '';
    if (catEl) catEl.title = st ? `${cat} 진행률` : '';
    const s = prog && cat && sub ? prog.sub[`${cat}::${sub}`] : null;
    if (subEl) subEl.innerHTML = window.setupSubStatusHtml(s);
    // [수정] 입력창 오른쪽 여백은 진행률 표시 길이만큼만 (표시가 없으면 기본 여백) → 구분 이름이 덜 잘림
    const fitPadding = () => [[catEl, '#setup-log-reg-category-trigger'], [subEl, '#setup-log-reg-subcategory-trigger']].forEach(([badge, sel]) => {
        const trig = modal.querySelector(sel);
        if (!trig || !badge) return;
        const text = badge.textContent.trim();
        // 창이 아직 숨겨져 있으면 폭이 0 → 글자 수로 대략 계산하고, 화면에 나온 뒤 다시 맞춤
        const w = badge.offsetWidth || text.length * 8;
        trig.style.paddingRight = text ? `${w + 12}px` : '';
    });
    fitPadding();
    requestAnimationFrame(fitPadding);
};

// 일지 등록 창의 세부 선택 체크 칩 그리기 (선택된 셋업 구분·세부 구분 기준)
window.renderSetupLogSubOptions = function (modalContext, selectedValue = '') {
    const modal = modalContext || document;
    window.updateSetupLogRegProgress(modal); // [추가] 구분·세부 구분이 바뀔 때마다 진행률 표시 갱신
    const row = modal.querySelector('#setup-log-reg-options-row');
    const box = modal.querySelector('#setup-log-reg-options');
    if (!row || !box) return;
    const cat = (modal.querySelector('#setup-log-reg-category') || {}).value || '';
    const sub = (modal.querySelector('#setup-log-reg-subcategory') || {}).value || '';
    const opts = window.getSetupSubOptions(cat, sub,
        (modal.querySelector('#setup-log-reg-site') || {}).value || '', (modal.querySelector('#setup-log-reg-equip') || {}).value || '');
    const selected = window.parseSetupSubOptions(selectedValue);
    // 템플릿에서 빠진 예전 선택값도 수정 시 사라지지 않게 함께 표시
    selected.forEach(s => { if (opts.length && !opts.includes(s)) opts.push(s); });
    box.innerHTML = '';
    if (!opts.length) { row.style.display = 'none'; return; }
    row.style.display = '';
    const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : v);
    opts.forEach(opt => {
        const label = document.createElement('label');
        const checked = selected.includes(opt);
        label.className = 'setup-log-option-chip' + (checked ? ' checked' : '');
        label.innerHTML = `<input type="checkbox" value="${esc(opt)}"${checked ? ' checked' : ''}><span>${esc(opt)}</span>`;
        const cb = label.querySelector('input');
        cb.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
        box.appendChild(label);
    });
};

// 일지 등록 창에서 체크된 세부 선택값 (선택항목이 없는 세부 구분이면 null)
window.getCheckedSetupLogSubOptions = function (modalContext) {
    const modal = modalContext || document;
    const row = modal.querySelector('#setup-log-reg-options-row');
    if (!row || row.style.display === 'none') return null;
    return Array.from(modal.querySelectorAll('#setup-log-reg-options input[type="checkbox"]:checked')).map(cb => cb.value);
};

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
    const getTemplatesData = () => window.normalizeSetupTemplate(getRawTemplatesData());
    // [수정] 일지 창에서 고른 장비의 셋업 구분 템플릿
    const getRawTemplatesData = () => window.getSetupTemplateRawForEquip(
        (modal.querySelector('#setup-log-reg-site') || {}).value || '', (modal.querySelector('#setup-log-reg-equip') || {}).value || '');

    // 세부 구분 활성화/비활성화 상태 관리
    const updateSubcategoryState = () => {
        const hasCategory = !!catHidden.value;
        if (!hasCategory) {
            subcatTrigger.classList.add('disabled');
            subcatTrigger.style.opacity = '0.5';
            subcatTrigger.style.cursor = 'not-allowed';
            subcatTrigger.style.pointerEvents = 'none';
            subcatTrigger.textContent = '구분을 먼저 선택해주세요';
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
        const listProg = window.getSetupLogRegProgress(modal);

        let filtered = categories;
        if (kw) filtered = filtered.filter(c => c.toLowerCase().includes(kw.toLowerCase()));

        if (filtered.length === 0) {
            catList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:var(--c-text-muted);">검색 결과가 없습니다.</div>';
            return;
        }

        filtered.forEach(catName => {
            const div = document.createElement('div');
            div.className = 'log-select-item' + (catHidden.value === catName ? ' selected' : '');
            div.style.cursor = 'pointer';
            // [추가] 구분 옆에 진행률
            const catProg = (listProg && window.setupStageProgressText(listProg.stage[catName])) || '';
            div.innerHTML = `<span>${typeof escapeHtml === 'function' ? escapeHtml(catName) : catName}</span>`
                + (catProg ? `<span class="setup-log-item-progress">${catProg}</span>` : '');

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
                window.renderSetupLogSubOptions(modal, '');
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
            subcatList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:var(--c-text-muted);">구분을 먼저 선택해주세요.</div>';
            return;
        }

        const listProg = window.getSetupLogRegProgress(modal);
        let subItems = currentTpl.filter(t => t.category === currentCat).map(t => t.subcategory || t.content || t.category).filter(Boolean);
        let uniqueSubs = Array.from(new Set(subItems));

        if (kw) {
            uniqueSubs = uniqueSubs.filter(s => s.toLowerCase().includes(kw.toLowerCase()));
        }

        if (uniqueSubs.length === 0) {
            subcatList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:var(--c-text-muted);">등록된 세부 구분이 없습니다.</div>';
            return;
        }

        uniqueSubs.forEach(subName => {
            const div = document.createElement('div');
            div.className = 'log-select-item' + (subcatHidden.value === subName ? ' selected' : '');
            div.style.cursor = 'pointer';
            // [추가] 세부 구분 옆에 진행 상태 (완료 / 진행 중 / 미착수)
            const subProg = listProg ? window.setupSubStatusHtml(listProg.sub[`${currentCat}::${subName}`]) : '';
            div.innerHTML = `<span>${typeof escapeHtml === 'function' ? escapeHtml(subName) : subName}</span>`
                + (subProg ? `<span class="setup-log-item-progress">${subProg}</span>` : '');

            div.addEventListener('click', (e) => {
                e.stopPropagation();
                const changed = subcatHidden.value !== subName;
                subcatHidden.value = subName;
                subcatTrigger.textContent = subName;
                subcatTrigger.classList.add('has-value');
                subcatDropdown.classList.remove('show');
                if (changed) window.renderSetupLogSubOptions(modal, '');
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
        catTrigger.textContent = '구분 선택';
        catTrigger.classList.remove('has-value');
    }

    if (selectedSubcategory && selectedCategory) {
        subcatHidden.value = selectedSubcategory;
    } else {
        subcatHidden.value = '';
    }

    // 세부 구분 활성화 상태 반영
    updateSubcategoryState();
    // 세부 선택항목 초기화 (수정 모드는 openLogForEditing 에서 저장값으로 다시 그림)
    window.renderSetupLogSubOptions(modal, '');

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
        const subHtml = subText ? `<span style="color: var(--c-green); font-weight: 500; display: inline;">${typeof escapeHtml === 'function' ? escapeHtml(subText) : subText}</span>` : '';
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
            siteList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:var(--c-text-muted);">검색 결과가 없습니다.</div>';
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
            equipList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:var(--c-text-muted);">사업장을 먼저 선택해주세요.</div>';
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
            equipList.innerHTML = '<div class="log-select-empty-msg" style="padding:10px; text-align:center; color:var(--c-text-muted);">해당 사업장에 셋업 장비가 없습니다.</div>';
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

window.openSetupLogRegisterModal = function(site, equip, taskName, defaultDate, forceComplete = false, isDropdownMode = false, taskCategory = '') {
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
    const noteInput = modal.querySelector('#setup-log-reg-note');
    if (noteInput) noteInput.value = '';

    // [삭제] 완료 버튼 제거
    const completeBtn = modal.querySelector('#btn-setup-log-reg-complete');
    if (completeBtn) completeBtn.remove();

    // 사업장 및 장비 드롭다운 초기화
    setupSetupLogRegSiteAndEquipDropdowns(modal, site || '', equip || '');

    // 셋업 구분 및 세부 구분 드롭다운 초기화
    setupCategoryAndSubCategoryDropdowns(modal, taskCategory || '', taskName || '');

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
                    window.location.href = `/setup?site=${encodeURIComponent(currentSite)}&equip=${encodeURIComponent(currentEquip)}`;
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
    window.renderSetupLogSubOptions(modal, log.subOptions || '');

    const contentInput = modal.querySelector('#setup-log-reg-content');
    if (contentInput) contentInput.value = log.content || '';
    
    // [삭제] 완료 버튼 제거
    const completeBtn = modal.querySelector('#btn-setup-log-reg-complete');
    if (completeBtn) completeBtn.remove();

    const planDateInput = modal.querySelector('#setup-log-reg-plan-date');
    if (planDateInput) planDateInput.value = '';

    const memoInput = modal.querySelector('#setup-log-reg-memo');
    if (memoInput) memoInput.value = log.memo || '';
    const noteInput = modal.querySelector('#setup-log-reg-note');
    if (noteInput) noteInput.value = log.specialNote || log.special_note || '';

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
                    window.location.href = `/setup?site=${encodeURIComponent(currentSite)}&equip=${encodeURIComponent(currentEquip)}`;
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

    // [요청] 셋업 물품: 기본은 [+ 물품 추가] 버튼만, 누르면 물품 선택·상세 창 표시 (저장된 물품이 있으면 처음부터 표시)
    const partWrapper = context.querySelector('#setup-log-reg-part-wrapper');
    const partDisplayRow = context.querySelector('#setup-log-reg-part-display-row');
    const partOpenBtn = context.querySelector('#btn-setup-log-reg-part-open');
    const showPartArea = (show) => {
        if (partWrapper) partWrapper.style.display = show ? '' : 'none';
        if (partDisplayRow) partDisplayRow.style.display = show ? '' : 'none';
        if (partOpenBtn) partOpenBtn.style.display = show ? 'none' : '';
    };
    showPartArea(!!String(presetParts || '').trim());
    if (partOpenBtn) {
        partOpenBtn.onclick = (e) => {
            e.stopPropagation();
            showPartArea(true);
            trigger.click(); // 바로 물품 목록 열기
        };
    }

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
            displayBox.innerHTML = '<div style="color:var(--c-text-muted); font-size:12px; text-align:center; padding:10px;">선택된 물품이 없습니다.</div>';
            trigger.textContent = '물품 선택';
            trigger.style.color = 'var(--c-text-muted)';
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
        trigger.style.color = 'var(--c-heading)';
        trigger.title = partsArr.join('\n');

        selectedNames.forEach(name => {
            const cost = currentSelections[name];
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--c-border); font-size:12px; color:var(--c-text);';
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                    <span style="background:var(--c-border); padding:2px 6px; border-radius:4px; font-size:10px; color:var(--c-text); flex-shrink:0;">${cost}</span>
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name}">${name}</span>
                </div>
                <span style="color:var(--c-red); cursor:pointer; font-weight:bold; margin-left:10px; padding:0 5px;" title="삭제">✕</span>
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
            list.innerHTML = '<li style="padding:10px; color:var(--c-text-muted); text-align:center; font-size:12px;">검색 결과가 없습니다.</li>';
            return;
        }

        uniqueItems.forEach(item => {
            const val = item.displayValue;
            const isSelected = currentSelections.hasOwnProperty(val);
            const itemCost = isSelected ? currentSelections[val] : '무상(셋업)';
            const li = document.createElement('li');
            li.style.cssText = `padding: 6px 8px; font-size: 12px; cursor: pointer; border-radius: 4px; margin-bottom: 2px; display: flex; align-items: center; justify-content: space-between; ${isSelected ? 'background: #1f6feb; color: #fff;' : 'color: var(--c-text);'}`;
            
            li.innerHTML = `
                <div style="display:flex; align-items:center; gap:5px; flex:1; min-width:0;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(val)}</span>
                </div>
                <select class="item-cost-select" style="background:var(--c-bg); border:1px solid var(--c-border); color: var(--c-heading); border-radius:3px; padding:2px; font-size:11px; margin-left:5px; pointer-events:auto;" onclick="event.stopPropagation();">
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
            category: (taskContent === '셋업 완료' ? window.SETUP_FINAL_CATEGORY : ''),
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
        // [변경] 일지가 있어도 자동 완료하지 않음: '이 작업 완료' 체크값(isManualCompleted)을 따르고,
        //        체크값이 없는 경우(일지 삭제·목록 수정 등)는 기존 완료 상태 유지. '셋업 완료' 항목만 자동 완료
        if (isManualCompleted === true || isManualCompleted === false) {
            task.completed = isManualCompleted;
        } else if (isSetupCompleteTask(task)) {
            task.completed = true;
        } else {
            task.completed = !!task.completed;
        }
        if (isSetupCompleteTask(task)) task.completed = true;
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
            <span>${info.mainInfo} <span style="color: var(--c-green);">${info.subInfo}</span></span>
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
    partsList.innerHTML = '<li style="padding:20px; text-align:center; color:var(--c-text-muted); font-size:12px;">일지를 선택해주세요</li>';
    
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const info = window.formatEquipDisplayInfo(site, equip, equipmentModels);
    
    titleEl.innerHTML = `셋업 이력 - ${info.mainInfo} <span style="color:var(--c-green); font-size: 14px;">${info.subInfo}</span>`;

    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};
    const equipKey = `${site}::${equip}`;
    const data = setupData[equipKey] || {};
    const logs = data.setupLogs || [];

    const sortedLogs = [...logs].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sortedLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--c-text-muted);">셋업 일지 기록이 없습니다.</td></tr>';
    } else {
        sortedLogs.forEach(log => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            
            const contentHtml = (typeof escapeHtml === 'function' ? escapeHtml(log.content) || '-' : log.content || '-').replace(/\[지연\]/g, '<span class="tag-delayed" style="color: var(--c-orange); font-weight: bold;">[지연]</span>');

            tr.innerHTML = `
                <td style="text-align:center; padding: 8px 10px; border-bottom: 1px solid var(--c-surface-2);">${typeof escapeHtml === 'function' ? escapeHtml(log.date) : log.date}</td>
                <td style="text-align:left; padding: 8px 10px; border-bottom: 1px solid var(--c-surface-2);">${contentHtml}</td>
                <td style="text-align:center; padding: 8px 10px; border-bottom: 1px solid var(--c-surface-2);">${typeof escapeHtml === 'function' ? escapeHtml(log.worker) : log.worker}</td>
                <td style="text-align:center; color:var(--c-yellow); font-weight:bold; padding: 8px 10px; border-bottom: 1px solid var(--c-surface-2);">${typeof escapeHtml === 'function' ? escapeHtml(log.md || '0') : log.md || '0'}</td>
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
                        li.style.cssText = 'padding: 8px 10px; border-bottom: 1px solid var(--c-border); font-size: 12px; color: var(--c-text-2); display: flex; justify-content: space-between; align-items: center;';
                        li.innerHTML = `
                            <span style="font-weight:bold; color:var(--c-blue); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${typeof escapeHtml === 'function' ? escapeHtml(pureContent) : pureContent}">${typeof escapeHtml === 'function' ? escapeHtml(pureContent) : pureContent}</span>
                            ${itemCost ? `<span style="font-size:10px; background:var(--c-border); padding:2px 6px; border-radius:4px; color:var(--c-text); flex-shrink:0;">${typeof escapeHtml === 'function' ? escapeHtml(itemCost) : itemCost}</span>` : ''}
                        `;
                        partsList.appendChild(li);
                    });
                } else {
                    partsList.innerHTML = '<li style="padding:20px; text-align:center; color:var(--c-text-muted); font-size:12px;">선택된 물품 없음</li>';
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
                
                if (typeof renderSetupLogList === 'function' && typeof currentPath !== 'undefined' && currentPath.site === site && window.isSameSetupProject(site, currentPath.equip, equip)) {
                    renderSetupLogList();
                    if (typeof window.reloadSelectedSetupLogPanels === 'function') window.reloadSelectedSetupLogPanels();
                }
                if (typeof renderSetupDetailList === 'function' && typeof currentPath !== 'undefined' && currentPath.equip === equip) {
                    renderSetupDetailList();
                }
                if (typeof renderGanttChart === 'function') renderGanttChart();
                if (typeof window.refreshSetupSubLogPopup === 'function') window.refreshSetupSubLogPopup();

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
            // [추가] 특이사항 → 셋업 이슈 (specialNote)
            const noteEl = modal.querySelector('#setup-log-reg-note');
            const specialNote = noteEl ? noteEl.value : null;
            // [추가] 선택된 셋업 물품 데이터
            const parts = modal.querySelector('#setup-log-reg-part-hidden') ? modal.querySelector('#setup-log-reg-part-hidden').value : '';
            const logId = modal.querySelector('#setup-log-reg-id') ? modal.querySelector('#setup-log-reg-id').value : ''; // 수정 모드 식별자
            
            if(!site || !equip || !date || !category || !subcategory || !worker || !md) {
                return alert('사업장, 장비, 작업일, 셋업 구분, 세부 구분, 작업자, 공수를 모두 입력해주세요.');
            }
            // [추가] 세부 선택항목 (선택항목이 있는 세부 구분은 1개 이상 선택)
            const checkedSubOptions = window.getCheckedSetupLogSubOptions(modal);
            if (checkedSubOptions && checkedSubOptions.length === 0) {
                return alert('세부 선택 항목을 1개 이상 선택해주세요.');
            }
            const subOptions = checkedSubOptions ? checkedSubOptions.join(', ') : '';

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
                    existingLog.subOptions = subOptions;
                    existingLog.content = content || '';
                    existingLog.worker = worker;
                    existingLog.md = md;
                    existingLog.memo = memo;
                    existingLog.parts = parts; // [추가] 물품 업데이트
                    existingLog.specialNote = specialNote !== null ? specialNote : (existingLog.specialNote || existingLog.special_note || '');
                    existingLog.special_note = existingLog.specialNote;
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
                    subOptions: subOptions,
                    content: content || '',
                    worker: worker,
                    company: "위드텍",
                    memo: memo,
                    specialNote: specialNote || '',
                    special_note: specialNote || '',
                    md: md,
                    parts: parts // [추가] 물품 등록
                };
                data.setupLogs.push(newLog);
            }

            // [변경] 일지를 기록해도 작업 완료 상태는 바꾸지 않음 (완료는 진행률 > 세부 구분 > [작업 완료 처리])
            //        ('셋업 완료' 항목은 기존처럼 기록 즉시 완료)
            const isCompleteLog = category === '셋업 완료' || subcategory === '셋업 완료' || content === '셋업 완료';
            const taskDone = isCompleteLog ? true : null;
            let setupDetailsUpdated = false;
            findSetupTasksForLog(data, category, subcategory, content).forEach(t => {
                if (taskDone) t.completed = true;
                if (!t.date || date > t.date) t.date = date;   // 예전 날짜 일지를 수정해도 종료일이 줄어들지 않게
                if (!t.execStartDate || date < t.execStartDate) t.execStartDate = date;
                if (worker) t.worker = worker;
                setupDetailsUpdated = true;
            });
            const statusRecalculated = recalculateSetupTaskStatus(data, task, site, equip, taskDone);
            // 일지로 새로 생긴 일정 항목은 일지의 셋업 구분을 따라감 (구분 없이 생성되면 엉뚱한 단계에 표시되므로)
            if (category) findSetupTasksForLog(data, category, subcategory, content).forEach(t => { if (!t.category) t.category = category; });
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
            
            if (typeof renderSetupLogList === 'function' && typeof currentPath !== 'undefined' && currentPath.site === site && window.isSameSetupProject(site, currentPath.equip, equip)) {
                renderSetupLogList();
                if (typeof window.reloadSelectedSetupLogPanels === 'function') window.reloadSelectedSetupLogPanels();
            }
            
            // [수정] 셋업 기록(일지)이 추가되면 간트 차트에 즉시 반영(블록 생성 등)되도록 항상 리프레시
            if (typeof renderGanttChart === 'function') renderGanttChart();
            if (typeof window.refreshSetupSubLogPopup === 'function') window.refreshSetupSubLogPopup();

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
    if (categorySelect) categorySelect.value = (defaultCategory && defaultCategory !== '셋업 완료') ? defaultCategory : '1단계 - 납품/정위치';
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
                        f.el.style.border = '1.5px solid var(--c-red)';
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
        const subHtml = subText ? ` <span style="color: var(--c-green); font-weight: 500; display: inline;">${typeof escapeHtml === 'function' ? escapeHtml(subText) : subText}</span>` : '';
        const html = `<span>${typeof escapeHtml === 'function' ? escapeHtml(modelName) : modelName}${subHtml}</span>`;
        
        return { text: plainText, html: html, modelName, subText };
    };

    const renderEquips = (filter = '') => {
        equipList.innerHTML = '';
        if (!selectedSite) {
            equipList.innerHTML = '<div class="log-select-empty" style="padding:10px; text-align:center; color:var(--c-text-muted);">사업장을 먼저 선택하세요</div>';
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
            equipList.innerHTML = '<div class="log-select-empty" style="padding:10px; text-align:center; color:var(--c-text-muted);">해당 사업장에 셋업 장비가 없습니다.</div>';
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

    // [수정] 일정 창에서 고른 장비의 셋업 구분 템플릿
    const tplList = window.getSetupTemplateRawForEquip(
        (modal.querySelector('#setup-sched-site') || {}).value || '', (modal.querySelector('#setup-sched-equip') || {}).value || '');

    const matchedSubs = [...new Set(window.normalizeSetupTemplate(tplList).filter(t => t.category === category).map(t => t.subcategory).filter(Boolean))];

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
                const pos = w.position ? ` <span style="font-size:11px; color:var(--c-text-muted);">${w.position}</span>` : '';
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
    const tplList = window.getSetupTemplateRawForEquip(currentSite, equip || ((modal.querySelector('#setup-sched-equip') || {}).value || '')); // [수정]
    const categories = [...new Set(window.normalizeSetupTemplate(tplList).map(t => t.category).filter(Boolean))];
    if (catSelect) {
        catSelect.innerHTML = '<option value="">셋업 구분 선택</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            catSelect.appendChild(opt);
        });
        if (categories.length > 0) {
            // 기본 선택은 '1단계 - 납품/정위치' (사전 작업이 맨 앞에 있어도 기본값 유지)
            const defaultCat = categories.includes('1단계 - 납품/정위치') ? '1단계 - 납품/정위치' : categories[0];
            catSelect.value = defaultCat;
            catSelect.classList.add('has-value');
            populateSetupSchedSubcategories(modal, defaultCat);
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


