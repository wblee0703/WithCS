/* ==========================================================================
   통합 관리 대시보드 (Integrated Dashboard)
   ========================================================================== */

function updateIntegratedDashboard() {
    // 데이터 로드
    let data = typeof storageData !== 'undefined' ? storageData : JSON.parse(localStorage.getItem('withtech_data')) || {};
    const setupData = JSON.parse(localStorage.getItem('setup_data')) || {};

    let totalCount = 0;
    let setupCount = 0;
    let operatingCount = 0;
    let setupEquips = [];

    // 데이터 집계
    Object.keys(data).forEach(site => {
        if (data[site]) {
            data[site].forEach(equip => {
                totalCount++;
                const equipKey = `${site}::`;
                const detailData = setupData[equipKey];

                let isSetup = false;
                let progress = 0;

                // 셋업 중인지 판단 (셋업 데이터가 있고, 완료되지 않았으며, 시작일이 있는 경우)
                if (detailData && detailData.setupDetails && detailData.setupDetails.length > 0) {
                    const completeItem = detailData.setupDetails.find(d => d.content === '셋업 완료');
                    if (completeItem && !completeItem.completed && completeItem.startDate) {
                        isSetup = true;
                        
                        // 진행률 계산
                        const totalTasks = detailData.setupDetails.length;
                        const completedTasks = detailData.setupDetails.filter(t => t.completed).length;
                        progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
                    }
                }

                if (isSetup) {
                    setupCount++;
                    setupEquips.push({ site, equip, progress });
                } else {
                    operatingCount++;
                }
            });
        }
    });

    // UI 렌더링
    renderIntegOpChart(operatingCount, setupCount, totalCount);
    renderIntegSetupList(setupEquips);
}

function renderIntegOpChart(operating, setup, total) {
    const chartEl = document.getElementById('integ-op-chart');
    const centerText = document.getElementById('integ-op-center');
    
    // 텍스트 업데이트
    document.getElementById('integ-total-count').textContent = total;
    document.getElementById('integ-op-count').textContent = operating;
    document.getElementById('integ-setup-count').textContent = setup;

    if (!chartEl) return;

    if (total === 0) {
        chartEl.style.background = '';
        if (centerText) centerText.innerHTML = `<div class="chart-center-label">Rate</div><div class="chart-center-value">0%</div>`;
        return;
    }

    // 가동률 계산
    const opRate = Math.round((operating / total) * 100);
    
    // 도넛 차트 그리기 (Green: 가동, Blue: 셋업)
    // CSS 변수 사용: var(--cal-green) #3fb950, var(--cal-blue) #1f6feb
    const green = '#3fb950';
    const blue = '#1f6feb';
    
    const opDeg = (operating / total) * 360;
    
    // conic-gradient: green 0deg ~ opDeg, blue opDeg ~ 360deg
    chartEl.style.background = `conic-gradient( 0deg deg,  deg 360deg)`;
    
    if (centerText) {
        centerText.innerHTML = `<div class="chart-center-label">가동률</div><div class="chart-center-value" style="color:">%</div>`;
    }
}

function renderIntegSetupList(list) {
    const listEl = document.getElementById('integ-setup-detail-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';

    if (list.length === 0) {
        listEl.innerHTML = '<li class="list-empty-msg">진행 중인 셋업이 없습니다.</li>';
        return;
    }

    // 진행률 높은 순 정렬
    list.sort((a, b) => b.progress - a.progress);

    list.forEach(item => {
        const parts = item.equip.split('::');
        const name = parts[0];
        const serial = parts.length > 1 ? parts[1] : '';

        const li = document.createElement('li');
        li.className = 'status-list-item';
        
        // 진행률 바 스타일
        const progressColor = item.progress === 100 ? '#238636' : '#1f6feb';
        
        li.innerHTML = `
            <span class="status-color equip-bar" style="background-color: ;"></span>
            <span class="status-name no-margin-right">
                ${escapeHtml(item.site)} > ${escapeHtml(name)} 
                ${serial ? `<span class="equip-serial">${escapeHtml(serial)}</span>` : ''}
            </span>
            <span class="status-count" style="color: ">${item.progress}%</span>
        `;
        
        // 클릭 시 셋업 페이지로 이동
        li.onclick = () => {
            location.href = `setup.html?site=${encodeURIComponent(item.site)}&equip=${encodeURIComponent(item.equip)}`;
        };
        
        listEl.appendChild(li);
    });
}

// HTML 이스케이프 유틸리티 (중복 방지 위해 확인)
if (typeof escapeHtml !== 'function') {
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}
