/* ==========================================================================
   셋업 진행률 (HOME > 셋업 관리, 예전 간트뷰 자리)
   - 계산·그리기는 common_setup.js (computeSetupProgress, renderSetupProgress) 공용
   ※ 다른 파일에서 renderGanttChart 이름으로 호출하므로 함수 이름은 그대로 둠
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    const btnHistory = document.getElementById('btn-gantt-history');
    if (btnHistory) {
        btnHistory.onclick = () => {
            const site = currentGanttFilters.site;
            const equip = currentGanttFilters.equip;
            if (!site || !equip) return alert('장비를 먼저 선택해주세요.');
            if (typeof window.openSetupHistoryModal === 'function') window.openSetupHistoryModal(site, equip);
        };
    }
    renderGanttChart();
});

function renderGanttChart() {
    const view = document.getElementById('gantt-wrapper');
    const emptyMsg = document.getElementById('gantt-empty-msg');
    const targetInfoEl = document.getElementById('gantt-target-info');
    if (!view) return;

    const site = currentGanttFilters.site;
    const equip = currentGanttFilters.equip;

    if (!site || !equip) {
        view.style.display = 'none';
        if (emptyMsg) {
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = '프로젝트 목록에서 항목을 클릭하면 셋업 진행률이 표시됩니다.';
        }
        if (targetInfoEl) targetInfoEl.textContent = '';
        return;
    }

    // 장비 표시 이름
    const equipmentModels = JSON.parse(localStorage.getItem('equipment_models')) || [];
    const parts = equip.split('::');
    const rawName = parts[0];
    const serial = parts.length > 1 ? parts[1] : '';
    const custNameFromKey = parts.length > 2 ? parts[2] : '';
    const matchedModel = equipmentModels.find(m => m.name === rawName || m.abbr === rawName);
    const displayName = (matchedModel && matchedModel.abbr) ? matchedModel.abbr : rawName;
    const detailData = JSON.parse(localStorage.getItem(`details_${site}_${equip}`)) || {};
    const custEquipName = custNameFromKey || ((detailData.setup && detailData.setup.custEquipName) ? detailData.setup.custEquipName : '');
    const labelSub = custEquipName ? `[${custEquipName}]` : (serial ? `(${serial})` : '');

    if (targetInfoEl) {
        targetInfoEl.innerHTML = `<strong>${escapeHtml(site)}</strong> &gt; ${escapeHtml(displayName)} <span style="color:#3fb950; font-weight:500;">${escapeHtml(labelSub)}</span>`;
    }

    window.renderSetupProgress(view, site, equip);
    view.style.display = 'flex';
    if (emptyMsg) emptyMsg.style.display = 'none';
}

window.renderGanttChart = renderGanttChart;
