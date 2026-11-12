/* ==========================================================================
   Tracking - 장비 점검 일정 등록 작업 현황 / 정상화 미완료 추적 페이지
   데이터: common.js 의 window.collectTrackingWorks()
   ========================================================================== */
(function () {
    const state = {
        status: '',  // '', progress, overdue, planned, done
        site: '',
        type: '',
        period: 90,  // 일 (0 = 전체) - 완료/예정/지연에만 적용
        age: '',     // '', d2, d8, d31 - 진행중/지연에만 적용
        keyword: ''
    };

    const AGE_MIN = { d2: 2, d8: 8, d31: 31 };

    function esc(text) {
        return typeof escapeHtml === 'function' ? escapeHtml(text == null ? '' : String(text)) : String(text == null ? '' : text);
    }

    function equipDisplay(site, equipKey, models) {
        const parts = equipKey.split('::');
        const name = parts[0];
        const serial = parts[1] || '';
        const model = models.find(m => m.name === name);
        const displayName = (model && model.abbr) ? model.abbr : name;
        let custName = parts[2] || '';
        if (!custName) {
            const details = JSON.parse(localStorage.getItem(`details_${site}_${equipKey}`)) || {};
            custName = (details.setup && details.setup.custEquipName) || '';
        }
        return { name: displayName, sub: custName || serial };
    }

    function fillSelect(selectEl, values, allLabel, current) {
        selectEl.innerHTML = `<option value="">${allLabel}</option>` +
            values.map(v => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
    }

    function daysFromToday(dateStr) {
        const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return Infinity;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        const n = new Date();
        const t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
        return Math.abs(Math.round((t - d) / 86400000));
    }

    // 사업장/구분/기간/경과/검색 필터 (상태 필터 제외 - 상태 카드 건수 계산용)
    function passesBaseFilters(w, disp) {
        if (state.site && w.site !== state.site) return false;
        if (state.type && (w.parentLog.type || '') !== state.type) return false;
        if (state.period > 0 && w.status !== 'progress' && daysFromToday(w.filterDate) > state.period) return false;
        if (state.age) {
            if (w.status !== 'progress' && w.status !== 'overdue') return false;
            if (w.days < AGE_MIN[state.age]) return false;
        }
        if (state.keyword) {
            const hay = [
                w.site, disp.name, disp.sub, w.equipKey, w.detailStr, w.parentLog.type,
                w.parentLog.content, w.lastLog.content, w.parentLog.memo, w.lastLog.memo,
                w.workers.join(' ')
            ].join(' ').toLowerCase();
            if (!hay.includes(state.keyword)) return false;
        }
        return true;
    }

    function renderSummary(baseRows) {
        const el = document.getElementById('tracking-summary');
        if (!el) return;
        el.innerHTML = '';
        const S = window.TRACKING_STATUS;
        const cards = [{ key: '', label: '전체', color: '#c9d1d9' }, S.progress, S.overdue, S.planned, S.done];
        cards.forEach(c => {
            const count = c.key ? baseRows.filter(r => r.w.status === c.key).length : baseRows.length;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'tracking-summary-card' + (state.status === c.key ? ' active' : '');
            card.style.setProperty('--lv-color', c.color);
            let sub = '';
            if (c.key === 'progress') {
                const long = baseRows.filter(r => r.w.status === 'progress' && r.w.days >= (window.TRACKING_HOME_MIN_DAYS || 2)).length;
                sub = `<span class="tracking-summary-sub">D+2 이상 ${long}건</span>`;
            }
            card.innerHTML = `<span class="tracking-summary-label">${c.label}</span><span class="tracking-summary-count">${count}</span>${sub}`;
            card.onclick = () => {
                state.status = (state.status === c.key) ? '' : c.key;
                render();
            };
            el.appendChild(card);
        });
    }

    function elapsedCell(w) {
        if (w.status === 'progress' || w.status === 'overdue') {
            return `<span class="tracking-dday" style="color:${w.level.color}">D+${w.days}</span>`;
        }
        if (w.status === 'planned') {
            return `<span class="tracking-dday" style="color:#58a6ff">${w.days === 0 ? 'D-Day' : 'D-' + w.days}</span>`;
        }
        return `<span class="tracking-muted">${w.days > 0 ? `소요 ${w.days + 1}일` : '당일 완료'}</span>`;
    }

    function render() {
        const tbody = document.getElementById('tracking-tbody');
        if (!tbody || typeof window.collectTrackingWorks !== 'function') return;

        const works = window.collectTrackingWorks();
        const models = JSON.parse(localStorage.getItem('equipment_models')) || [];
        const S = window.TRACKING_STATUS;

        // 필터 옵션 갱신
        const siteSel = document.getElementById('tracking-site-filter');
        const typeSel = document.getElementById('tracking-type-filter');
        const sites = [...new Set(works.map(w => w.site))].sort();
        const types = [...new Set(works.map(w => w.parentLog.type).filter(Boolean))].sort();
        if (state.site && !sites.includes(state.site)) state.site = '';
        if (state.type && !types.includes(state.type)) state.type = '';
        if (siteSel) fillSelect(siteSel, sites, '전체 사업장', state.site);
        if (typeSel) fillSelect(typeSel, types, '전체 구분', state.type);

        const baseRows = works
            .map(w => ({ w, disp: equipDisplay(w.site, w.equipKey, models) }))
            .filter(({ w, disp }) => passesBaseFilters(w, disp));
        renderSummary(baseRows);

        const rows = state.status ? baseRows.filter(r => r.w.status === state.status) : baseRows;
        const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';

        tbody.innerHTML = '';
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="list-empty-msg">${works.length === 0 ? '등록된 작업이 없습니다.' : '조건에 맞는 작업이 없습니다.'}</td></tr>`;
            return;
        }

        const frag = document.createDocumentFragment();
        rows.forEach(({ w, disp }) => {
            const st = S[w.status];
            const tr = document.createElement('tr');
            tr.className = 'tracking-row';
            tr.style.setProperty('--lv-color', st.color);

            const lastText = w.workCount > 1 ? `${esc(w.lastWorkDate)} · ${esc(w.lastContentSummary || '-')}` : '-';
            const reason = w.progressReason ? `<div class="tracking-sub">${esc(w.progressReason)}</div>` : '';
            tr.innerHTML = `
                <td><span class="tracking-status" style="--st-color:${st.color}">${st.label}</span>${reason}</td>
                <td>${elapsedCell(w)}</td>
                <td>${esc(w.baseDate || '-')}</td>
                <td class="tracking-nowrap" title="${esc(w.site)}">${esc(w.site)}</td>
                <td class="tracking-equip" title="${esc(w.equipKey)}">${esc(disp.name)}${disp.sub ? ` <span class="equip-serial">[${esc(disp.sub)}]</span>` : ''}</td>
                <td>${esc(w.parentLog.type || '-')}${w.detailStr ? `<div class="tracking-sub">${esc(w.detailStr)}</div>` : ''}</td>
                <td class="tracking-content" title="${esc(w.parentLog.content || '')}">${esc(w.contentSummary || '-')}</td>
                <td class="tracking-content" title="${esc(w.workCount > 1 ? (w.lastLog.content || '') : '')}">${lastText}</td>
                <td class="text-center">${w.workCount || '-'}</td>
                <td class="tracking-nowrap" title="${esc(w.workers.join(', '))}">${esc(w.workers.join(', ') || '-')}</td>
                <td></td>
            `;

            // 관리 버튼: 수행된 작업만 Tracking 등록(레포트 작성) / 레포트 / PDF / 정상화 완료
            if (w.kind === 'log') {
                const cell = tr.lastElementChild;
                const box = document.createElement('div');
                box.className = 'tracking-actions';
                const report = getReport(w);
                const mkBtn = (cls, text, title, onClick, disabled) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = cls;
                    b.textContent = text;
                    b.title = title;
                    b.disabled = !!disabled;
                    b.onclick = (e) => { e.stopPropagation(); onClick(b); };
                    box.appendChild(b);
                    return b;
                };
                const loginTitle = '로그인 후 사용 가능합니다.';

                if (!w.isFlagged) {
                    mkBtn('btn-tracking-open', 'Tracking 등록',
                        isLoggedIn ? '레포트를 작성하고 정상화 미완료 작업으로 Tracking 시작' : loginTitle,
                        () => openReportModal(w, disp, 'register'), !isLoggedIn);
                }
                if (w.isFlagged || report) {
                    mkBtn(report ? 'btn-tracking-sub' : 'btn-tracking-sub warn', report ? '레포트' : '레포트 작성',
                        report ? `레포트 보기/수정/PDF 출력 (최종 수정 ${report.updatedAt} ${report.updatedBy})` : '이 작업의 Tracking 레포트가 아직 없습니다.',
                        () => openReportModal(w, disp, 'edit'), !isLoggedIn);
                }
                if (w.isFlagged) {
                    mkBtn('btn-tracking-close', '정상화 완료',
                        isLoggedIn ? 'Tracking 체크 해제 (최초 작업 + 추가작업 전체)' : loginTitle,
                        async (b) => {
                            const msg = `[${w.site}] ${disp.name}\n${w.startDate} 작업을 정상화 완료 처리하시겠습니까?` +
                                (w.nextPlanDate ? '\n\n※ 예정된 추가작업이 남아 있어 해당 작업이 완료될 때까지 진행중으로 표시됩니다.' : '');
                            if (!confirm(msg)) return;
                            b.disabled = true;
                            const ok = await window.setTrackingFlag(w.site, w.equipKey, w.familyId, false);
                            if (!ok) b.disabled = false;
                            render();
                        }, !isLoggedIn);
                }
                cell.appendChild(box);
            }

            tr.onclick = () => {
                if (w.kind === 'log') {
                    if (typeof window.openExtraWorkHistoryModal === 'function') {
                        window.openExtraWorkHistoryModal(w.site, w.equipKey, w.familyId);
                    }
                } else if (typeof window.openEventDetailModal === 'function') {
                    window.openEventDetailModal(w.site, w.equipKey, w.openId, false);
                }
            };
            frag.appendChild(tr);
        });
        tbody.appendChild(frag);
    }

    /* ----------------------------------------------------------------------
       Tracking 레포트 (작성 / 수정 / PDF)
       ---------------------------------------------------------------------- */
    const reports = new Map(); // key: `${equipId}|${familyId}`
    let reportCtx = null;      // 현재 모달에서 작업 중인 { w, disp, mode }

    function equipIdOf(w) {
        return typeof window.getEquipmentDbId === 'function' ? window.getEquipmentDbId(w.site, w.equipKey) : `${w.site}::${w.equipKey}`;
    }

    function reportKey(w) {
        return `${equipIdOf(w)}|${w.familyId}`;
    }

    function getReport(w) {
        return w.kind === 'log' ? (reports.get(reportKey(w)) || null) : null;
    }

    async function loadReports() {
        if (sessionStorage.getItem('isLoggedIn') !== 'true') return;
        try {
            const res = await fetch('/api/tracking/reports', { headers: { 'X-CSRFToken': getCookie('csrf_token') } });
            if (!res.ok) return;
            const data = await res.json();
            if (data.status !== 'success') return;
            reports.clear();
            (data.reports || []).forEach(r => reports.set(`${r.equipId}|${r.familyId}`, r));
            render();
        } catch (e) {
            console.error('Failed to load tracking reports:', e);
        }
    }

    function familyLogsOf(w) {
        const details = JSON.parse(localStorage.getItem(`details_${w.site}_${w.equipKey}`)) || {};
        const fid = String(w.familyId);
        return (details.logs || [])
            .filter(l => String(l.id) === fid || String(l.originalLogId || '') === fid)
            .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (Number(a.id) || 0) - (Number(b.id) || 0));
    }

    // 작업 이력/장비 정보에서 자동 입력되는 기본 정보
    function buildBasic(w, disp) {
        const details = JSON.parse(localStorage.getItem(`details_${w.site}_${w.equipKey}`)) || {};
        const setup = details.setup || {};
        const parts = w.equipKey.split('::');
        const loc = [setup.building, setup.floor, setup.detailLoc].filter(Boolean).join(' ');
        return {
            site: w.site,
            model: parts[0] || '',
            modelAbbr: disp.name,
            serial: parts[1] || '',
            custEquipName: parts[2] || setup.custEquipName || '',
            location: loc,
            startDate: w.startDate,
            type: w.parentLog.type || '',
            detailType: w.detailStr || '',
            content: w.parentLog.content || '',
            workers: w.workers.join(', ')
        };
    }

    const BASIC_FIELDS = [
        ['startDate', '최초 작업일'], ['site', '사업장'], ['location', '설치 위치'],
        ['modelAbbr', '장비'], ['serial', 'S/N'], ['custEquipName', '고객사 장비명'],
        ['type', '작업 구분'], ['detailType', '세부 구분'], ['workers', '작업자']
    ];

    /* ---------------- 필요물품 (물품 관리 항목 선택) ---------------- */
    let partsItems = []; // [{ id, code, part, spec, partno, qty }]

    // 드롭다운 표시: 약어(코드명, 없으면 물품명) + 규격
    function itemLabel(it) {
        const abbr = it.code || it.part || '';
        return `${abbr}${it.spec ? ` [${it.spec}]` : ''}`;
    }

    // 마우스 오버 시 전체 정보
    function itemTitle(it) {
        return [it.code && `코드명: ${it.code}`, it.part && `물품명: ${it.part}`, it.spec && `규격: ${it.spec}`, it.partno && `품번: ${it.partno}`]
            .filter(Boolean).join(' / ');
    }

    // 물품 관리 항목 전체 (구분 없이 한 목록, 현재 장비 적용 물품을 앞쪽에 정렬)
    function getPartCandidates(w) {
        const all = (JSON.parse(localStorage.getItem('admin_items')) || []).filter(ai => ai && (ai.part || ai.code));
        const models = JSON.parse(localStorage.getItem('equipment_models')) || [];
        const name = (w.equipKey.split('::')[0] || '').trim();
        const model = models.find(m => m.name === name || m.abbr === name);
        const targets = [name];
        if (model) { if (model.name) targets.push(model.name); if (model.abbr) targets.push(model.abbr); }
        const isMatch = ai => {
            const equips = String(ai.equip || '').split(',').map(e => e.trim()).filter(Boolean);
            return targets.some(t => equips.includes(t));
        };
        return all
            .map(ai => ({ ai, m: isMatch(ai) ? 0 : 1 }))
            .sort((a, b) => a.m - b.m || itemLabel(a.ai).localeCompare(itemLabel(b.ai)))
            .map(x => x.ai);
    }

    /* 검색 + 선택 콤보박스 */
    const PARTS_LIST_LIMIT = 300;
    let partsSelectedId = '';
    let partsFiltered = [];
    let partsActiveIdx = -1;

    function partsListEl() { return document.getElementById('tracking-parts-list'); }
    function partsInputEl() { return document.getElementById('tracking-parts-input'); }

    function renderPartsList() {
        const list = partsListEl();
        const input = partsInputEl();
        if (!list || !input || !reportCtx) return;
        const kw = partsSelectedId ? '' : input.value.trim().toLowerCase();
        const all = getPartCandidates(reportCtx.w);
        partsFiltered = kw
            ? all.filter(ai => [ai.code, ai.part, ai.spec, ai.partno, ai.detailType].join(' ').toLowerCase().includes(kw))
            : all;
        if (partsActiveIdx >= partsFiltered.length) partsActiveIdx = partsFiltered.length - 1;

        if (partsFiltered.length === 0) {
            list.innerHTML = `<li class="tracking-parts-option empty">${all.length === 0 ? '물품 관리에 등록된 물품이 없습니다.' : '검색 결과가 없습니다.'}</li>`;
            return;
        }
        const shown = partsFiltered.slice(0, PARTS_LIST_LIMIT);
        list.innerHTML = shown.map((ai, i) => `
            <li class="tracking-parts-option${i === partsActiveIdx ? ' active' : ''}${String(ai.id) === partsSelectedId ? ' selected' : ''}" data-idx="${i}" title="${esc(itemTitle(ai))}">
                <span class="abbr">${esc(ai.code || ai.part || '')}</span>${ai.spec ? `<span class="spec">${esc(ai.spec)}</span>` : ''}
            </li>`).join('') +
            (partsFiltered.length > PARTS_LIST_LIMIT
                ? `<li class="tracking-parts-option empty">외 ${partsFiltered.length - PARTS_LIST_LIMIT}개 — 검색어를 입력해 좁혀주세요.</li>`
                : '');
        const activeEl = list.querySelector('.tracking-parts-option.active');
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }

    function openPartsList() {
        const list = partsListEl();
        if (!list) return;
        list.hidden = false;
        renderPartsList();
    }

    function closePartsList() {
        const list = partsListEl();
        if (list) list.hidden = true;
        partsActiveIdx = -1;
    }

    function choosePart(idx) {
        const ai = partsFiltered[idx];
        if (!ai) return;
        partsSelectedId = String(ai.id);
        partsInputEl().value = itemLabel(ai);
        closePartsList();
        const qty = document.getElementById('tracking-parts-qty');
        if (qty) { qty.focus(); qty.select(); }
    }

    function resetPartsPicker() {
        partsSelectedId = '';
        partsActiveIdx = -1;
        const input = partsInputEl();
        if (input) input.value = '';
        closePartsList();
    }

    function renderPartsTable() {
        const tbody = document.getElementById('tracking-parts-tbody');
        if (!tbody) return;
        if (partsItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="tracking-parts-empty">추가된 물품이 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = partsItems.map((it, i) => `
            <tr>
                <td class="c">${i + 1}</td>
                <td>${esc(it.code || '-')}</td>
                <td>${esc(it.part || '-')}</td>
                <td>${esc(it.spec || '-')}</td>
                <td>${esc(it.partno || '-')}</td>
                <td><input type="number" class="input-dark tracking-parts-qty-input" data-idx="${i}" value="${it.qty}" min="1" max="9999"></td>
                <td class="c"><button type="button" class="tracking-parts-del" data-idx="${i}" title="삭제">✕</button></td>
            </tr>`).join('');
        tbody.querySelectorAll('.tracking-parts-qty-input').forEach(inp => {
            inp.addEventListener('change', () => {
                const q = Math.max(1, Math.min(9999, parseInt(inp.value, 10) || 1));
                inp.value = q;
                partsItems[Number(inp.dataset.idx)].qty = q;
            });
        });
        tbody.querySelectorAll('.tracking-parts-del').forEach(btn => {
            btn.addEventListener('click', () => {
                partsItems.splice(Number(btn.dataset.idx), 1);
                renderPartsTable();
            });
        });
    }

    function addSelectedPart() {
        const qtyEl = document.getElementById('tracking-parts-qty');
        if (!partsSelectedId) {
            alert('추가할 물품을 목록에서 선택해주세요.');
            const input = partsInputEl();
            if (input) input.focus();
            return;
        }
        const ai = (JSON.parse(localStorage.getItem('admin_items')) || []).find(x => String(x.id) === partsSelectedId);
        if (!ai) return;
        const qty = Math.max(1, Math.min(9999, parseInt(qtyEl.value, 10) || 1));
        const exist = partsItems.find(p => String(p.id) === String(ai.id));
        if (exist) {
            exist.qty = Math.min(9999, exist.qty + qty);
        } else {
            partsItems.push({ id: String(ai.id), code: ai.code || '', part: ai.part || '', spec: ai.spec || '', partno: ai.partno || '', qty });
        }
        qtyEl.value = 1;
        resetPartsPicker();
        renderPartsTable();
        const input = partsInputEl();
        if (input) input.focus();
    }

    function openReportModal(w, disp, mode) {
        const modal = document.getElementById('tracking-report-modal');
        if (!modal) return;
        const report = getReport(w);
        const basic = buildBasic(w, disp);
        reportCtx = { w, disp, mode };

        document.getElementById('tracking-report-title').textContent =
            mode === 'register' ? 'Tracking 등록 - 레포트 작성' : 'Tracking 레포트';

        document.getElementById('tracking-report-basic').innerHTML =
            BASIC_FIELDS.map(([k, label, wide]) => `
                <div class="tracking-report-item${wide ? ' wide' : ''}">
                    <span class="k">${label}</span><span class="v">${esc(basic[k] === '' || basic[k] == null ? '-' : basic[k])}</span>
                </div>`).join('');

        document.getElementById('tracking-report-symptom').value = report ? report.symptom : '';
        document.getElementById('tracking-report-action').value = report ? report.action : '';
        document.getElementById('tracking-report-discussion-person').value = report ? (report.discussionPerson || '') : '';
        partsItems = report && Array.isArray(report.partsItems) ? report.partsItems.map(p => Object.assign({}, p)) : [];
        document.getElementById('tracking-parts-qty').value = 1;
        resetPartsPicker();
        renderPartsTable();
        document.getElementById('tracking-report-discussion').value = report ? report.discussion : '';
        document.getElementById('tracking-report-meta').textContent = report
            ? `작성: ${report.createdBy || '-'} (${report.createdAt}) · 최종 수정: ${report.updatedBy || '-'} (${report.updatedAt})`
            : '';

        const saveBtn = document.getElementById('btn-tracking-report-save');
        saveBtn.textContent = mode === 'register' ? '저장 후 Tracking 시작' : '저장';
        saveBtn.disabled = false;
        document.getElementById('btn-tracking-report-pdf').disabled = false;

        modal.style.display = 'flex';
        document.getElementById('tracking-report-symptom').focus();
    }

    function closeReportModal() {
        const modal = document.getElementById('tracking-report-modal');
        if (modal) modal.style.display = 'none';
        reportCtx = null;
    }

    // 저장 성공 시 저장된 레포트 반환, 실패 시 null
    // opts.keepOpen: 저장 후 레포트 창 유지 (PDF 출력용)
    async function saveReport(opts = {}) {
        if (!reportCtx) return null;
        const keepOpen = opts && opts.keepOpen === true;
        const { w, disp, mode } = reportCtx;
        const val = id => document.getElementById(id).value.trim();
        const body = {
            equipId: equipIdOf(w),
            familyId: String(w.familyId),
            siteName: w.site,
            equipKey: w.equipKey,
            symptom: val('tracking-report-symptom'),
            action: val('tracking-report-action'),
            partsItems: partsItems,
            discussion: val('tracking-report-discussion'),
            discussionPerson: val('tracking-report-discussion-person'),
            basic: buildBasic(w, disp)
        };
        if (!body.symptom) {
            alert('증상을 입력해주세요.');
            document.getElementById('tracking-report-symptom').focus();
            return null;
        }

        const saveBtn = document.getElementById('btn-tracking-report-save');
        const pdfBtn = document.getElementById('btn-tracking-report-pdf');
        saveBtn.disabled = true;
        if (pdfBtn) pdfBtn.disabled = true;
        const unlock = () => { saveBtn.disabled = false; if (pdfBtn) pdfBtn.disabled = false; };
        try {
            const res = await fetch('/api/tracking/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrf_token') },
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.status !== 'success') {
                alert(data.message || `레포트 저장에 실패했습니다. (HTTP ${res.status})`);
                unlock();
                return null;
            }
            reports.set(`${data.report.equipId}|${data.report.familyId}`, data.report);

            if (mode === 'register' && !w.isFlagged) {
                const ok = await window.setTrackingFlag(w.site, w.equipKey, w.familyId, true);
                if (!ok) {
                    alert('레포트는 저장되었지만 Tracking 등록에 실패했습니다. 다시 시도해주세요.');
                    unlock();
                    render();
                    return null;
                }
                w.isFlagged = true;
            }
            if (typeof window.addSystemLog === 'function') {
                window.addSystemLog('UPDATE_TRACKING_REPORT', w.equipKey, `Tracking 레포트 ${mode === 'register' ? '작성' : '수정'} (LogID: ${w.familyId})`);
            }

            if (keepOpen) {
                // 창 유지: 이후 저장은 수정 모드로
                reportCtx.mode = 'edit';
                document.getElementById('tracking-report-title').textContent = 'Tracking 레포트';
                saveBtn.textContent = '저장';
                const r = data.report;
                document.getElementById('tracking-report-meta').textContent =
                    `작성: ${r.createdBy || '-'} (${r.createdAt}) · 최종 수정: ${r.updatedBy || '-'} (${r.updatedAt})`;
                unlock();
            } else {
                closeReportModal();
            }
            render();
            return data.report;
        } catch (e) {
            console.error('Failed to save tracking report:', e);
            alert('서버와의 통신에 실패했습니다.');
            unlock();
            return null;
        }
    }

    // PDF 출력: A4 인쇄용 창을 열고 브라우저 인쇄(PDF로 저장)
    // 레포트 창 하단 저장 완료 알림 (2초 후 사라짐)
    let toastTimer = null;
    function showReportToast(msg) {
        const footer = document.querySelector('#tracking-report-modal .tracking-report-footer');
        if (!footer) return;
        let toast = document.getElementById('tracking-report-toast');
        if (!toast) {
            toast = document.createElement('span');
            toast.id = 'tracking-report-toast';
            toast.className = 'tracking-report-toast';
            const cancelBtn = document.getElementById('btn-tracking-report-cancel');
            footer.insertBefore(toast, cancelBtn);
        }
        toast.textContent = '✔ ' + msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // targetWin: 클릭 시점에 미리 열어둔 창 (비동기 저장 후 팝업 차단 방지)
    function printReport(w, disp, report, targetWin) {
        if (!report) { if (targetWin) targetWin.close(); return; }
        const basic = buildBasic(w, disp);
        const logs = familyLogsOf(w);
        const nl2br = s => esc(s || '-').replace(/\n/g, '<br>');
        const v = s => esc(s === '' || s == null ? '-' : s);
        const safeName = `${w.site}_${disp.name}_${w.startDate}`.replace(/[\\/:*?"<>|\s]+/g, '_');

        const partRows = (report.partsItems || []).map((p, i) => `
            <tr>
                <td class="c">${i + 1}</td><td>${v(p.code)}</td><td>${v(p.part)}</td><td class="spec">${v(p.spec)}</td><td>${v(p.partno)}</td><td class="c">${esc(p.qty)}</td>
            </tr>`).join('');

        const logRows = logs.map((l, i) => `
            <tr>
                <td class="c">${i === 0 ? '최초' : '추가 ' + i}</td>
                <td class="c">${v(l.date)}</td>
                <td>${v([l.type, window.formatTrackingDetailType(l)].filter(Boolean).join(' > '))}</td>
                <td>${v(l.content)}${l.memo ? `<div class="memo">${nl2br(l.memo)}</div>` : ''}</td>
                <td class="c">${v(l.worker)}</td>
            </tr>`).join('');

        const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>Tracking_Report_${esc(safeName)}</title>
<style>
    @page { size: A4; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif; color: #111; font-size: 11.5px; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
    .head h1 { font-size: 20px; margin: 0; letter-spacing: 1px; }
    h2 { font-size: 13px; margin: 14px 0 6px; padding-left: 6px; border-left: 4px solid #1f6feb; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 5px 7px; vertical-align: top; word-break: break-all; }
    th { background: #eef2f7; font-weight: 700; text-align: left; white-space: nowrap; }
    .info { table-layout: fixed; }
    .info th { width: 14%; }
    .info td { width: 19.33%; }
    .person th { width: 14%; }
    .box td { min-height: 60px; height: 60px; white-space: normal; }
    .c { text-align: center; white-space: nowrap; }
    .note { margin-top: -1px; }
    td.spec { color: #666; }
    .memo { color: #555; font-size: 10.5px; margin-top: 3px; }
    .foot { margin-top: 14px; font-size: 10px; color: #666; text-align: right; }
    tr { page-break-inside: avoid; }
</style></head>
<body>
    <div class="head">
        <h1>Tracking Report</h1>
    </div>

    <h2>기본 정보</h2>
    <table class="info">
        <tr><th>최초 작업일</th><td>${v(basic.startDate)}</td><th>사업장</th><td>${v(basic.site)}</td><th>설치 위치</th><td>${v(basic.location)}</td></tr>
        <tr><th>장비</th><td>${v(basic.model)}${basic.modelAbbr && basic.modelAbbr !== basic.model ? ' (' + v(basic.modelAbbr) + ')' : ''}</td><th>S/N</th><td>${v(basic.serial)}</td><th>고객사 장비명</th><td>${v(basic.custEquipName)}</td></tr>
        <tr><th>작업 구분</th><td>${v(basic.type)}</td><th>세부 구분</th><td>${v(basic.detailType)}</td><th>작업자</th><td>${v(basic.workers)}</td></tr>
    </table>

    <h2>증상</h2>
    <table class="box"><tr><td>${nl2br(report.symptom)}</td></tr></table>
    <h2>조치사항</h2>
    <table class="box"><tr><td>${nl2br(report.action)}</td></tr></table>
    <h2>필요물품</h2>
    <table>
        <tr><th class="c" style="width:36px">No</th><th style="width:18%">코드명</th><th>물품명</th><th style="width:22%">규격</th><th style="width:16%">품번</th><th class="c" style="width:52px">수량</th></tr>
        ${partRows || '<tr><td colspan="6" class="c">등록된 필요물품이 없습니다.</td></tr>'}
    </table>
    <h2>협의 사항</h2>
    <table class="person"><tr><th>담당자</th><td>${v(report.discussionPerson)}</td></tr></table>
    <table class="box" style="margin-top:-1px"><tr><td>${nl2br(report.discussion)}</td></tr></table>

    <h2>작업 이력</h2>
    <table>
        <tr><th class="c" style="width:52px">구분</th><th class="c" style="width:80px">작업일</th><th style="width:22%">작업 구분</th><th>작업 내용</th><th class="c" style="width:80px">작업자</th></tr>
        ${logRows || '<tr><td colspan="5" class="c">작업 이력이 없습니다.</td></tr>'}
    </table>

    <div class="foot">최종 수정: ${v(report.updatedBy)} (${v(report.updatedAt)})</div>
</body></html>`;

        const win = targetWin || window.open('', '_blank', 'width=900,height=1000');
        if (!win) {
            alert('팝업이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용해주세요.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        const doPrint = () => { win.focus(); win.print(); };
        if (win.document.readyState === 'complete') setTimeout(doPrint, 300);
        else win.addEventListener('load', () => setTimeout(doPrint, 300));
    }

    document.addEventListener('DOMContentLoaded', () => {
        const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
        on('btn-tracking-report-close', closeReportModal);
        on('btn-tracking-parts-add', addSelectedPart);
        const partsInput = partsInputEl();
        const partsList = partsListEl();
        if (partsInput && partsList) {
            partsInput.addEventListener('click', openPartsList);
            partsInput.addEventListener('input', () => {
                partsSelectedId = ''; // 다시 입력하면 선택 해제 후 검색
                partsActiveIdx = partsInput.value.trim() ? 0 : -1;
                openPartsList();
            });
            partsInput.addEventListener('keydown', (e) => {
                const max = Math.min(partsFiltered.length, PARTS_LIST_LIMIT) - 1;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (partsList.hidden) { openPartsList(); return; }
                    partsActiveIdx = Math.min(max, partsActiveIdx + 1);
                    renderPartsList();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    partsActiveIdx = Math.max(0, partsActiveIdx - 1);
                    renderPartsList();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!partsList.hidden && partsActiveIdx >= 0) choosePart(partsActiveIdx);
                    else if (partsSelectedId) addSelectedPart();
                } else if (e.key === 'Escape') {
                    if (!partsList.hidden) {
                        e.preventDefault();
                        e.stopPropagation(); // 레포트 창이 닫히지 않도록
                        closePartsList();
                    }
                } else if (e.key === 'Tab') {
                    closePartsList();
                }
            });
            partsInput.addEventListener('blur', () => setTimeout(closePartsList, 150));
            // mousedown: 입력창 blur 보다 먼저 선택 처리
            partsList.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const li = e.target.closest('.tracking-parts-option[data-idx]');
                if (li) choosePart(Number(li.dataset.idx));
            });
        }
        const partsQty = document.getElementById('tracking-parts-qty');
        if (partsQty) partsQty.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSelectedPart(); } });
        on('btn-tracking-report-cancel', closeReportModal);
        on('btn-tracking-report-save', async () => {
            const saved = await saveReport({ keepOpen: true }); // 저장 후 창 유지
            if (saved) showReportToast('레포트가 저장되었습니다.');
        });
        on('btn-tracking-report-pdf', async () => {
            if (!reportCtx) return;
            if (!document.getElementById('tracking-report-symptom').value.trim()) {
                alert('증상을 입력해주세요.');
                document.getElementById('tracking-report-symptom').focus();
                return;
            }
            // 클릭 시점에 인쇄 창을 먼저 열어 팝업 차단 방지
            const win = window.open('', '_blank', 'width=900,height=1000');
            if (!win) {
                alert('팝업이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용해주세요.');
                return;
            }
            win.document.write('<p style="font-family:sans-serif;padding:20px;color:#555;">레포트 저장 중...</p>');
            const { w, disp } = reportCtx;
            const saved = await saveReport({ keepOpen: true }); // 자동 저장
            if (!saved) { win.close(); return; }
            printReport(w, disp, saved, win);
        });
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('tracking-report-modal');
            if (e.key === 'Escape' && modal && modal.style.display === 'flex') closeReportModal();
        });
        if (window.isDataLoaded) loadReports(); // DataLoaded 가 이미 지나간 경우 대비
    });

    window.renderTrackingPage = render;

    document.addEventListener('DOMContentLoaded', () => {
        const bind = (id, evt, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(evt, () => { fn(el); render(); });
        };
        bind('tracking-site-filter', 'change', el => { state.site = el.value; });
        bind('tracking-type-filter', 'change', el => { state.type = el.value; });
        bind('tracking-period-filter', 'change', el => { state.period = Number(el.value) || 0; });
        bind('tracking-age-filter', 'change', el => { state.age = el.value; });
        bind('tracking-search-input', 'input', el => { state.keyword = el.value.trim().toLowerCase(); });

        const resetBtn = document.getElementById('btn-tracking-reset');
        if (resetBtn) resetBtn.addEventListener('click', () => {
            Object.assign(state, { status: '', site: '', type: '', period: 90, age: '', keyword: '' });
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            set('tracking-search-input', '');
            set('tracking-period-filter', '90');
            set('tracking-age-filter', '');
            render();
        });

        if (window.isDataLoaded) render();
    });

    // 서버 데이터 동기화 완료 시 갱신 (로그인 직후 포함 - 레포트도 다시 로드)
    window.addEventListener('DataLoaded', () => {
        render();
        if (typeof loadReports === 'function') loadReports();
    });

    // 추가작업 내역 / 작업 상세 모달이 닫히면(저장/수정 반영) 리스트 갱신
    document.addEventListener('DOMContentLoaded', () => {
        let timer = null;
        const observer = new MutationObserver(() => {
            const anyOpen = ['extra-work-history-modal', 'event-detail-modal'].some(id => {
                const el = document.getElementById(id);
                return el && el.style.display !== 'none' && el.style.display !== '';
            });
            if (!anyOpen) {
                clearTimeout(timer);
                timer = setTimeout(render, 200);
            }
        });
        ['extra-work-history-modal', 'event-detail-modal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
        });
    });
})();
