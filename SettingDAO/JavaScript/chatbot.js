/* ==========================================================================
   AI Chatbot Client Script (Mobile Compatibility & Secure Communication)
   ========================================================================== */

(function () {
    let chatbotInitialized = false;

    function initChatbot() {
        if (chatbotInitialized) return;
        chatbotInitialized = true;

        const chatbotContainer = document.getElementById('ai-chatbot-container');
        const chatbotToggleBtn = document.getElementById('chatbot-toggle-btn');
        const chatbotExpandBtn = document.getElementById('chatbot-expand-btn');
        const chatbotCloseBtn = document.getElementById('chatbot-close-btn');
        const chatbotWindow = document.getElementById('chatbot-window');
        const chatbotMessages = document.getElementById('chatbot-messages');
        const chatbotInputField = document.getElementById('chatbot-input-field');
        const chatbotSendBtn = document.getElementById('chatbot-send-btn');

        if (!chatbotContainer || !chatbotToggleBtn || !chatbotCloseBtn || !chatbotWindow || !chatbotMessages || !chatbotInputField || !chatbotSendBtn) {
            return;
        }

        const TOOL_LABELS = {
            find_equipment: '장비 검색',
            equipment_detail: '장비 상세',
            search_work_logs: '작업 이력',
            search_troubles: '트러블 이력',
            get_statistics: '통계 집계',
            search_setup: '셋업 조회',
            search_parts: '물품 조회',
            get_measurements: '측정 데이터',
            analysis_context: '원인 분석 데이터'
        };

        // 1. 대화 기록 복원 (하루 = 대화 1개, 오늘 질문 내용을 계속 표시)
        function getTodayKey() {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        // 탭 캐시는 오늘 날짜 것만 사용 (답변별 토큰 표시 유지용)
        function readLocalHistory() {
            if (sessionStorage.getItem('chatbot_history_date') !== getTodayKey()) return [];
            try {
                const parsed = JSON.parse(sessionStorage.getItem('chatbot_history') || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }

        function writeLocalHistory(history) {
            sessionStorage.setItem('chatbot_history', JSON.stringify(history));
            sessionStorage.setItem('chatbot_history_date', getTodayKey());
        }

        function clearLocalHistory() {
            sessionStorage.removeItem('chatbot_history');
            sessionStorage.removeItem('chatbot_history_date');
        }

        async function restoreChatbotSession() {
            let history = readLocalHistory();

            // 탭 캐시가 없으면(새 탭, 재로그인 등) 오늘 대화 전체를 DB 에서 불러옵니다.
            if (history.length === 0) {
                try {
                    const res = await fetch('/api/chat/history?today=1');
                    if (res.ok) {
                        const data = await res.json();
                        if (data.status === 'success' && Array.isArray(data.messages)) {
                            history = data.messages.map(m => ({ sender: m.sender, text: m.text }));
                            if (history.length) writeLocalHistory(history);
                        }
                    }
                } catch (err) {
                    console.warn('Failed to fetch chat history from DB:', err);
                }
            }

            chatbotMessages.innerHTML = '';
            if (history.length > 0) {
                history.forEach(msg => appendMessage(msg.sender, msg.text, false, msg.meta));
                if (history[history.length - 1].sender === 'ai') renderGuideCard();
            } else {
                insertDefaultWelcome();
            }

            // 창 열림 상태 복원
            if (sessionStorage.getItem('chatbot_window_active') === 'true') {
                chatbotWindow.classList.add('active');
                setTimeout(() => {
                    scrollToBottom();
                    chatbotInputField.focus();
                }, 100);
            }

            // 창 확대 상태 복원
            if (sessionStorage.getItem('chatbot_window_expanded') === 'true') {
                chatbotWindow.classList.add('expanded');
                if (chatbotExpandBtn) chatbotExpandBtn.textContent = '⤣';
            }
        }

        function insertDefaultWelcome() {
            const welcome = "안녕하세요! 위드텍 설비 관리 지원 AI 비서입니다. 무엇을 도와드릴까요?";
            appendMessage('ai', welcome, false);
            renderGuideCard();
        }

        // [추가] 시작 가이드 카드 — 선택 단계는 화면에서만 처리하므로 토큰을 쓰지 않습니다.
        function makeChip(label, onClick, variant) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chatbot-chip' + (variant ? ` chatbot-chip-${variant}` : '');
            btn.textContent = label;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                onClick();
            });
            return btn;
        }

        function normText(v) {
            return String(v || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
        }

        function renderGuideCard() {
            // 아직 사용하지 않은 이전 가이드 카드는 지워서 항상 맨 아래 1개만 남깁니다.
            chatbotMessages.querySelectorAll('.chatbot-guide-card:not(.done)').forEach(el => {
                if (el.parentElement) el.parentElement.remove();
            });
            const row = document.createElement('div');
            row.className = 'chatbot-msg-row chatbot-msg-ai';
            const card = document.createElement('div');
            card.className = 'chatbot-guide-card';
            row.appendChild(card);
            chatbotMessages.appendChild(row);
            renderGuideHome(card);
            scrollToBottom();
        }

        function renderGuideHome(card) {
            card.innerHTML = '';
            card.classList.add('home');
            const opts = document.createElement('div');
            opts.className = 'chatbot-guide-options';
            opts.appendChild(makeChip('🔧 장비 문제 원인 파악', () => renderModelStep(card, {}), 'primary'));
            opts.appendChild(makeChip('✏️ 기타(직접 입력)', () => {
                chatbotInputField.placeholder = '궁금한 내용을 직접 입력하세요...';
                chatbotInputField.focus();
            }));
            card.appendChild(opts);
        }

        function guideHeader(card, step, label, st) {
            card.innerHTML = '';
            card.classList.remove('home');
            const head = document.createElement('div');
            head.className = 'chatbot-guide-title';
            head.textContent = `🔧 장비 문제 원인 파악 · ${step}/3 ${label}`;
            card.appendChild(head);
            const picked = [];
            if (st.model) picked.push(`모델: ${st.model}`);
            if (st.equip) picked.push(`장비: ${st.equip.label}`);
            else if (st.equipSkipped) picked.push('장비: 선택 안 함');
            if (picked.length) {
                const sum = document.createElement('div');
                sum.className = 'chatbot-guide-summary';
                sum.textContent = picked.join(' · ');
                card.appendChild(sum);
            }
        }

        function guideFooter(card, buttons) {
            const foot = document.createElement('div');
            foot.className = 'chatbot-guide-footer';
            buttons.forEach(b => foot.appendChild(b));
            card.appendChild(foot);
        }

        function guideSearchList(card, placeholder, items, renderItem, emptyText) {
            const search = document.createElement('input');
            search.type = 'text';
            search.className = 'chatbot-guide-search';
            search.placeholder = placeholder;
            search.autocomplete = 'off';
            const list = document.createElement('div');
            list.className = 'chatbot-guide-list';
            const draw = () => {
                const q = normText(search.value);
                list.innerHTML = '';
                const shown = items.filter(it => !q || normText(it._search).includes(q));
                if (!shown.length) {
                    const empty = document.createElement('div');
                    empty.className = 'chatbot-guide-empty';
                    empty.textContent = emptyText;
                    list.appendChild(empty);
                    return;
                }
                shown.forEach(it => list.appendChild(renderItem(it)));
            };
            search.addEventListener('input', draw);
            card.appendChild(search);
            card.appendChild(list);
            draw();
        }

        function guideLoading(card, text) {
            const el = document.createElement('div');
            el.className = 'chatbot-guide-empty';
            el.textContent = text;
            card.appendChild(el);
            return el;
        }

        async function renderModelStep(card, st) {
            guideHeader(card, 1, '모델 선택', st);
            const loading = guideLoading(card, '모델 목록을 불러오는 중...');
            let models = [];
            try {
                const res = await fetch('/api/chat/guide/models');
                const data = await res.json();
                if (data.status === 'success') models = data.models || [];
            } catch (e) {
                console.warn('Failed to load models:', e);
            }
            loading.remove();
            models.forEach(m => { m._search = `${m.model} ${m.abbr || ''}`; });
            guideSearchList(card, '모델명 또는 약어 검색', models, (m) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'chatbot-guide-item';
                const name = document.createElement('div');
                name.className = 'name';
                name.textContent = m.abbr && m.abbr !== m.model ? `${m.model} (${m.abbr})` : m.model;
                const sub = document.createElement('div');
                sub.className = 'sub';
                sub.textContent = `장비 ${m.equip_count}대 · 트러블 ${m.trouble_count}건`;
                item.appendChild(name);
                item.appendChild(sub);
                item.addEventListener('click', () => renderEquipStep(card, { model: m.model }));
                return item;
            }, '일치하는 모델이 없습니다.');
            guideFooter(card, [makeChip('처음으로', () => renderGuideHome(card))]);
            scrollToBottom();
        }

        async function renderEquipStep(card, st) {
            guideHeader(card, 2, '이상 장비 선택 (선택 사항)', st);
            const loading = guideLoading(card, '장비 목록을 불러오는 중...');
            let equips = [];
            try {
                const res = await fetch(`/api/chat/guide/equipments?model=${encodeURIComponent(st.model)}`);
                const data = await res.json();
                if (data.status === 'success') {
                    equips = data.equipments || [];
                    st.symptoms = data.symptoms || [];
                }
            } catch (e) {
                console.warn('Failed to load equipments:', e);
            }
            loading.remove();
            const hint = document.createElement('div');
            hint.className = 'chatbot-guide-hint';
            hint.textContent = '모델 전체 이력은 항상 분석합니다. 문제가 있는 장비를 고르면 그 장비 이력을 추가로 자세히 봅니다.';
            card.appendChild(hint);
            equips.forEach(e => { e._search = `${e.cust_equip_name} ${e.serial} ${e.site}`; });
            guideSearchList(card, '고객장비명 / 시리얼 / 사업장 검색', equips, (e) => {
                const label = e.cust_equip_name || e.serial || e.id;
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'chatbot-guide-item';
                const name = document.createElement('div');
                name.className = 'name';
                name.textContent = label;
                const sub = document.createElement('div');
                sub.className = 'sub';
                sub.textContent = [e.site, e.serial && e.serial !== label ? e.serial : '', e.status, `트러블 ${e.trouble_count}건`]
                    .filter(Boolean).join(' · ');
                item.appendChild(name);
                item.appendChild(sub);
                item.addEventListener('click', () => renderSymptomStep(card, Object.assign({}, st, {
                    equip: { id: e.id, label: e.site ? `${label} (${e.site})` : label }, equipSkipped: false
                })));
                return item;
            }, '일치하는 장비가 없습니다.');
            guideFooter(card, [
                makeChip('← 이전', () => renderModelStep(card, {})),
                makeChip('건너뛰기 (모델 전체만 분석)', () => renderSymptomStep(card, Object.assign({}, st, { equip: null, equipSkipped: true })), 'primary')
            ]);
            scrollToBottom();
        }

        function renderSymptomStep(card, st) {
            guideHeader(card, 3, '증상 입력 (선택 사항)', st);
            const hint = document.createElement('div');
            hint.className = 'chatbot-guide-hint';
            hint.textContent = '증상은 비워둬도 됩니다. 입력하면 관련 사례를 우선해서 보지만, 분석은 트러블 전반으로 진행합니다.';
            card.appendChild(hint);

            const input = document.createElement('textarea');
            input.className = 'chatbot-guide-textarea';
            input.maxLength = 300;
            input.rows = 2;
            input.placeholder = '예: 유량 저하 후 알람 발생';

            if ((st.symptoms || []).length) {
                const chips = document.createElement('div');
                chips.className = 'chatbot-guide-options';
                st.symptoms.forEach(sym => {
                    chips.appendChild(makeChip(`${sym.label} (${sym.count})`, () => {
                        const cur = input.value.trim();
                        if (!cur.split(/\s*,\s*/).includes(sym.label)) {
                            input.value = cur ? `${cur}, ${sym.label}` : sym.label;
                        }
                    }));
                });
                card.appendChild(chips);
            }
            card.appendChild(input);

            guideFooter(card, [
                makeChip('← 이전', () => renderEquipStep(card, { model: st.model })),
                makeChip('🔍 분석 시작', () => startAnalysis(card, st, input.value.trim()), 'primary')
            ]);
            scrollToBottom();
            setTimeout(() => input.focus(), 50);
        }

        function startAnalysis(card, st, symptom) {
            if (isSending) return;
            card.innerHTML = '';
            const done = document.createElement('div');
            done.className = 'chatbot-guide-summary';
            done.textContent = '✅ 선택 완료 — 분석을 요청했습니다.';
            card.appendChild(done);
            card.classList.add('done');

            const question = `🔧 장비 문제 원인 파악\n- 모델: ${st.model}\n- 이상 장비: ${st.equip ? st.equip.label : '선택 안 함 (모델 전체 분석)'}\n- 증상: ${symptom || '입력 안 함 (트러블 전반 분석)'}`;
            sendRequest('/api/chat/analyze', question, {
                model: st.model,
                equip_id: st.equip ? st.equip.id : '',
                equip_label: st.equip ? st.equip.label : '',
                symptom: symptom
            });
        }

        // 2. 모바일/데스크탑 호환 챗봇 아이콘 자유 드래그 이동 이벤트
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let initialLeft = 0;
        let initialTop = 0;
        let isMoved = false;

        // 화면 크기 축소/변화 시 챗봇 아이콘 위치 뷰포트 내 자동 조정 헬퍼
        function clampPosition() {
            if (chatbotToggleBtn.style.left && chatbotToggleBtn.style.left !== 'auto') {
                const btnWidth = chatbotToggleBtn.offsetWidth || 56;
                const btnHeight = chatbotToggleBtn.offsetHeight || 56;
                const maxLeft = window.innerWidth - btnWidth - 10;
                const maxTop = window.innerHeight - btnHeight - 10;

                let currentLeft = parseFloat(chatbotToggleBtn.style.left);
                let currentTop = parseFloat(chatbotToggleBtn.style.top);

                if (isNaN(currentLeft)) currentLeft = window.innerWidth - btnWidth - 25;
                if (isNaN(currentTop)) currentTop = window.innerHeight - btnHeight - 25;

                const clampedLeft = Math.max(10, Math.min(maxLeft, currentLeft));
                const clampedTop = Math.max(10, Math.min(maxTop, currentTop));

                chatbotToggleBtn.style.left = `${clampedLeft}px`;
                chatbotToggleBtn.style.top = `${clampedTop}px`;
            }
        }

        // 저장된 위치가 있다면 복원 후 화면 보정
        const savedLeft = localStorage.getItem('chatbot_icon_left');
        const savedTop = localStorage.getItem('chatbot_icon_top');
        if (savedLeft && savedTop) {
            chatbotToggleBtn.style.right = 'auto';
            chatbotToggleBtn.style.bottom = 'auto';
            chatbotToggleBtn.style.left = savedLeft;
            chatbotToggleBtn.style.top = savedTop;
            clampPosition();
        }

        // 창 크기 변경 및 화면 회전 시 위치 자동 맞춤
        window.addEventListener('resize', clampPosition);
        window.addEventListener('orientationchange', clampPosition);

        // [모바일 호환] 배경 스크롤 차단 및 터치 드래그 안정화
        chatbotToggleBtn.style.touchAction = 'none';

        chatbotToggleBtn.addEventListener('touchmove', (e) => {
            if (e.cancelable) e.preventDefault();
        }, { passive: false });

        chatbotToggleBtn.addEventListener('pointerdown', (e) => {
            isDragging = true;
            isMoved = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            const rect = chatbotToggleBtn.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            try { chatbotToggleBtn.setPointerCapture(e.pointerId); } catch (err) {}
        });

        chatbotToggleBtn.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;

            if (Math.hypot(deltaX, deltaY) > 5) {
                if (e.cancelable) e.preventDefault();
                isMoved = true;
                let newLeft = initialLeft + deltaX;
                let newTop = initialTop + deltaY;

                // 뷰포트 화면 경계선 제한 (화면 밖으로 이탈 방지)
                const maxLeft = window.innerWidth - chatbotToggleBtn.offsetWidth - 10;
                const maxTop = window.innerHeight - chatbotToggleBtn.offsetHeight - 10;
                newLeft = Math.max(10, Math.min(maxLeft, newLeft));
                newTop = Math.max(10, Math.min(maxTop, newTop));

                chatbotToggleBtn.style.right = 'auto';
                chatbotToggleBtn.style.bottom = 'auto';
                chatbotToggleBtn.style.left = `${newLeft}px`;
                chatbotToggleBtn.style.top = `${newTop}px`;
            }
        });

        chatbotToggleBtn.addEventListener('pointerup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            try { chatbotToggleBtn.releasePointerCapture(e.pointerId); } catch (err) {}

            if (isMoved) {
                localStorage.setItem('chatbot_icon_left', chatbotToggleBtn.style.left);
                localStorage.setItem('chatbot_icon_top', chatbotToggleBtn.style.top);
            } else {
                chatbotWindow.classList.toggle('active');
                sessionStorage.setItem('chatbot_window_active', chatbotWindow.classList.contains('active'));
                if (chatbotWindow.classList.contains('active')) {
                    if (typeof window.pushModalHistory === 'function') {
                        window.pushModalHistory(() => chatbotWindow.classList.remove('active'));
                    }
                    chatbotInputField.focus();
                    scrollToBottom();
                }
            }
        });

        if (chatbotExpandBtn) {
            chatbotExpandBtn.addEventListener('pointerup', (e) => {
                e.preventDefault();
                chatbotWindow.classList.toggle('expanded');
                const isExpanded = chatbotWindow.classList.contains('expanded');
                sessionStorage.setItem('chatbot_window_expanded', isExpanded);
                chatbotExpandBtn.textContent = isExpanded ? '⤣' : '⤢';
                scrollToBottom();
            });
        }

        chatbotCloseBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            chatbotWindow.classList.remove('active');
            sessionStorage.setItem('chatbot_window_active', 'false');
        });

        // 기록 삭제 후 화면을 DB 기준 오늘 대화로 다시 그립니다.
        function reloadTodayView() {
            clearLocalHistory();
            restoreChatbotSession();
        }

        // 챗봇 대화 기록 모달 제어
        const chatbotHistoryBtn = document.getElementById('chatbot-history-btn');
        const chatbotHistoryModal = document.getElementById('chatbot-history-modal');
        const clearAllBtn = document.getElementById('btn-clear-all-chat-history');

        window.closeChatbotHistoryModal = function() {
            if (chatbotHistoryModal) chatbotHistoryModal.style.display = 'none';
        };

        if (clearAllBtn) {
            clearAllBtn.onclick = async () => {
                if (!confirm('데이터베이스에 저장된 모든 챗봇 대화 기록을 영구 삭제하시겠습니까?')) return;
                try {
                    const res = await fetch('/api/chat/history/delete', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCookie('csrf_token')
                        },
                        body: JSON.stringify({ all: true })
                    });
                    if (res.ok) {
                        reloadTodayView();
                        renderChatbotHistoryModal();
                    } else {
                        alert('대화 기록 삭제에 실패했습니다.');
                    }
                } catch (err) {
                    console.error('Failed to clear chat history:', err);
                    alert('서버 연결 중 오류가 발생했습니다.');
                }
            };
        }

        if (chatbotHistoryBtn && chatbotHistoryModal) {
            chatbotHistoryBtn.addEventListener('click', (e) => {
                e.preventDefault();
                renderChatbotHistoryModal();
                chatbotHistoryModal.style.display = 'flex';
                if (typeof window.pushModalHistory === 'function') {
                    window.pushModalHistory(window.closeChatbotHistoryModal);
                }
            });
        }

        function makeDragScrollable(elem) {
            if (!elem || elem.dataset.dragScrollBound) return;
            elem.dataset.dragScrollBound = 'true';
            let isDown = false;
            let startY, scrollTop;

            elem.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                isDown = true;
                elem.style.cursor = 'grabbing';
                startY = e.pageY - elem.offsetTop;
                scrollTop = elem.scrollTop;
            });

            elem.addEventListener('mouseleave', () => {
                isDown = false;
                elem.style.cursor = 'grab';
            });

            elem.addEventListener('mouseup', () => {
                isDown = false;
                elem.style.cursor = 'grab';
            });

            elem.addEventListener('mousemove', (e) => {
                if (!isDown) return;
                e.preventDefault();
                const y = e.pageY - elem.offsetTop;
                const walk = (y - startY) * 1.5;
                elem.scrollTop = scrollTop - walk;
            });
        }

        async function copyText(value, btn, doneLabel, idleLabel) {
            try {
                await navigator.clipboard.writeText(value);
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = value;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            btn.innerHTML = doneLabel;
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = idleLabel;
                btn.classList.remove('copied');
            }, 2000);
        }

        async function renderChatbotHistoryModal() {
            const dateListEl = document.getElementById('chatbot-history-date-list');
            const contentEl = document.getElementById('chatbot-history-content');
            const selectedDateEl = document.getElementById('chatbot-history-selected-date');
            const totalCountEl = document.getElementById('chatbot-history-total-count');
            const resumeBtn = document.getElementById('btn-resume-selected-chat');
            if (!dateListEl || !contentEl) return;

            makeDragScrollable(dateListEl);
            makeDragScrollable(contentEl);

            if (resumeBtn) resumeBtn.style.display = 'none';
            dateListEl.innerHTML = '<li style="color:#8b949e; font-size:12px; padding:10px; text-align:center;">목록 조회 중...</li>';
            contentEl.innerHTML = '<div style="color:#8b949e; text-align:center; padding: 40px;">대화 기록을 불러오는 중입니다...</div>';

            let sessions = [];

            // 1. 서버 DB에서 저장된 대화 세션 목록 조회
            try {
                const res = await fetch('/api/chat/history');
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'success' && Array.isArray(data.sessions)) {
                        sessions = data.sessions;
                    }
                }
            } catch (err) {
                console.warn('Failed to load history sessions from DB:', err);
            }

            sessions = sessions.filter(s => s && s.message_count > 0 && s.title);

            dateListEl.innerHTML = '';
            contentEl.innerHTML = '';

            if (totalCountEl) {
                totalCountEl.textContent = sessions.length > 0 ? `총 ${sessions.length}건` : '';
            }

            if (sessions.length === 0) {
                dateListEl.innerHTML = '<li style="color:#8b949e; font-size:12px; padding:15px 10px; text-align:center;">저장된 대화가 없습니다.</li>';
                contentEl.innerHTML = '<div style="color:#8b949e; text-align:center; padding: 40px;">실제 대화 내용이 존재하는 기록만 이곳에 저장 관리됩니다.</div>';
                if (selectedDateEl) selectedDateEl.textContent = '선택된 대화 내역';
                return;
            }

            sessions.forEach((sessionItem) => {
                const li = document.createElement('li');
                li.className = 'chatbot-history-session-item';
                li.style.cssText = 'display: flex; flex-direction: column; padding: 9px 10px; border-radius: 6px; cursor: pointer; color: #c9d1d9; background: #161b22; border: 1px solid #30363d; font-size: 12px; gap: 5px;';

                // 상단: 대화 제목 + 개별 삭제 버튼
                const topRow = document.createElement('div');
                topRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px;';

                const titleSpan = document.createElement('span');
                titleSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-weight: 600; color: #e6edf3; font-size: 12px;';
                titleSpan.textContent = sessionItem.title || '대화 내용';
                titleSpan.title = sessionItem.title || '';

                const deleteBtn = document.createElement('button');
                deleteBtn.innerHTML = '🗑️';
                deleteBtn.title = '이 대화 삭제';
                deleteBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 11px; opacity: 0.6; padding: 2px; border-radius: 3px; transition: opacity 0.2s;';
                deleteBtn.onmouseenter = () => deleteBtn.style.opacity = '1';
                deleteBtn.onmouseleave = () => deleteBtn.style.opacity = '0.6';

                deleteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`'${sessionItem.title}' 대화 기록을 삭제하시겠습니까?`)) {
                        try {
                            await fetch('/api/chat/history/delete', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-CSRFToken': getCookie('csrf_token')
                                },
                                body: JSON.stringify({ session_id: sessionItem.session_id })
                            });
                        } catch (delErr) {
                            console.error('Failed to delete history on server:', delErr);
                        }
                        if (sessionItem.date === getTodayKey()) {
                            reloadTodayView();
                        }
                        renderChatbotHistoryModal();
                    }
                };

                topRow.appendChild(titleSpan);
                topRow.appendChild(deleteBtn);

                // 하단: 일시 (시간 포함) + 메시지 건수 배지
                const bottomRow = document.createElement('div');
                bottomRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #8b949e;';

                const timeSpan = document.createElement('span');
                timeSpan.textContent = sessionItem.created_at || sessionItem.date;

                const countBadge = document.createElement('span');
                countBadge.style.cssText = 'background: #21262d; padding: 1px 5px; border-radius: 3px; color: #58a6ff; font-weight: 500; font-size: 10px;';
                countBadge.textContent = `💬 ${sessionItem.message_count}건`;

                bottomRow.appendChild(timeSpan);
                bottomRow.appendChild(countBadge);

                li.appendChild(topRow);
                li.appendChild(bottomRow);

                // 클릭 시 해당 대화 세션 로드
                li.onclick = async () => {
                    dateListEl.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
                    li.classList.add('selected');

                    if (selectedDateEl) {
                        selectedDateEl.textContent = `💬 ${sessionItem.title}`;
                        selectedDateEl.title = sessionItem.title;
                    }
                    contentEl.innerHTML = '<div style="color:#8b949e; text-align:center; padding: 30px;">대화 내용을 불러오는 중...</div>';

                    let messages = null;
                    try {
                        const res = await fetch(`/api/chat/history?session_id=${encodeURIComponent(sessionItem.session_id)}`);
                        if (res.ok) {
                            const data = await res.json();
                            if (data.status === 'success' && Array.isArray(data.messages) && data.messages.length > 0) {
                                messages = data.messages;
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to load session messages from DB:', err);
                    }

                    if (!messages || messages.length === 0) {
                        contentEl.innerHTML = '<div style="color:#8b949e; text-align:center; padding: 30px;">대화 내용이 존재하지 않습니다.</div>';
                        if (resumeBtn) resumeBtn.style.display = 'none';
                        return;
                    }

                    try {
                        contentEl.innerHTML = '';
                        messages.forEach((m) => {
                            const itemDiv = document.createElement('div');
                            itemDiv.style.cssText = 'margin-bottom: 14px; border-bottom: 1px solid #21262d; padding-bottom: 10px; position: relative;';

                            const headerDiv = document.createElement('div');
                            headerDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;';

                            const leftSpan = document.createElement('div');
                            const senderName = m.sender === 'user' ? '👤 사용자' : '🤖 AI 비서';
                            const color = m.sender === 'user' ? '#58a6ff' : '#3fb950';
                            const timeStr = m.created_at ? `<span style="font-size:11px; color:#8b949e; margin-left:8px; font-weight:normal;">${escapeHtml(m.created_at)}</span>` : '';
                            leftSpan.innerHTML = `<strong style="color:${color};">${senderName}:</strong>${timeStr}`;

                            const copyBtn = document.createElement('button');
                            copyBtn.type = 'button';
                            copyBtn.className = 'chatbot-history-copy-btn';
                            copyBtn.innerHTML = '📋 복사';
                            copyBtn.title = '대화 내용 복사';
                            const fullText = m.text || m.message || '';
                            copyBtn.onclick = () => copyText(fullText, copyBtn, '✅ 복사됨', '📋 복사');

                            headerDiv.appendChild(leftSpan);
                            headerDiv.appendChild(copyBtn);

                            const bodyDiv = document.createElement('div');
                            bodyDiv.className = 'chatbot-md';
                            bodyDiv.style.cssText = 'margin-top: 4px; color:#c9d1d9; font-size: 13px; line-height: 1.5;';
                            bodyDiv.innerHTML = parseMarkdown(fullText);

                            itemDiv.appendChild(headerDiv);
                            itemDiv.appendChild(bodyDiv);
                            contentEl.appendChild(itemDiv);
                        });
                    } catch (e) {
                        contentEl.innerHTML = '<div style="color:#f85149;">대화 기록을 렌더링하는 도중 오류가 발생했습니다.</div>';
                    }
                };

                dateListEl.appendChild(li);
            });

            if (dateListEl.firstElementChild) {
                dateListEl.firstElementChild.click();
            }
        }

        // [개선] 챗봇 마크다운 경량 파서 (표, 번호/들여쓰기 목록, 코드블록, 인용 지원 — 입력은 먼저 HTML 이스케이프)
        function renderInline(s) {
            s = s.replace(/`([^`]+)`/g, '<code class="chatbot-code">$1</code>');
            s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
            s = s.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
            return s;
        }

        function splitTableRow(line) {
            let row = line.trim();
            if (row.startsWith('|')) row = row.slice(1);
            if (row.endsWith('|')) row = row.slice(0, -1);
            return row.split('|').map(c => c.trim());
        }

        function parseMarkdown(text) {
            const lines = escapeHtml(text || '').replace(/\r\n/g, '\n').split('\n');
            const out = [];
            let i = 0;
            let lastBlank = false;

            while (i < lines.length) {
                const line = lines[i];
                const trimmed = line.trim();

                // 코드 블록
                if (trimmed.startsWith('```')) {
                    const code = [];
                    i++;
                    while (i < lines.length && !lines[i].trim().startsWith('```')) {
                        code.push(lines[i]);
                        i++;
                    }
                    i++;
                    out.push(`<pre class="chatbot-pre"><code>${code.join('\n')}</code></pre>`);
                    lastBlank = false;
                    continue;
                }

                // 표: | a | b | 다음 줄이 |---|---|
                if (trimmed.startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
                    const head = splitTableRow(trimmed);
                    i += 2;
                    const body = [];
                    while (i < lines.length && lines[i].trim().startsWith('|')) {
                        body.push(splitTableRow(lines[i]));
                        i++;
                    }
                    let t = '<div class="chatbot-table-wrap"><table class="chatbot-table"><thead><tr>';
                    head.forEach(h => { t += `<th>${renderInline(h)}</th>`; });
                    t += '</tr></thead><tbody>';
                    body.forEach(r => {
                        t += '<tr>' + head.map((_, idx) => `<td>${renderInline(r[idx] || '')}</td>`).join('') + '</tr>';
                    });
                    t += '</tbody></table></div>';
                    out.push(t);
                    lastBlank = false;
                    continue;
                }

                if (!trimmed) {
                    if (!lastBlank && out.length) out.push('<div class="chatbot-gap"></div>');
                    lastBlank = true;
                    i++;
                    continue;
                }
                lastBlank = false;

                let m;
                if ((m = trimmed.match(/^(#{1,4})\s+(.*)$/))) {
                    const level = Math.min(m[1].length, 3);
                    out.push(`<h${level} class="chatbot-h${level}">${renderInline(m[2])}</h${level}>`);
                } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
                    out.push('<hr class="chatbot-hr">');
                } else if ((m = line.match(/^(\s*)([-*+•])\s+(.*)$/))) {
                    const depth = Math.min(Math.floor(m[1].replace(/\t/g, '    ').length / 2), 4);
                    out.push(`<div class="chatbot-list-item" style="padding-left:${8 + depth * 14}px"><span class="chatbot-li-mark">•</span><span class="chatbot-li-body">${renderInline(m[3])}</span></div>`);
                } else if ((m = line.match(/^(\s*)(\d+[.)])\s+(.*)$/))) {
                    const depth = Math.min(Math.floor(m[1].replace(/\t/g, '    ').length / 2), 4);
                    out.push(`<div class="chatbot-list-item" style="padding-left:${8 + depth * 14}px"><span class="chatbot-li-mark">${m[2]}</span><span class="chatbot-li-body">${renderInline(m[3])}</span></div>`);
                } else if ((m = trimmed.match(/^&gt;\s?(.*)$/))) {
                    out.push(`<div class="chatbot-quote">${renderInline(m[1])}</div>`);
                } else {
                    out.push(`<div>${renderInline(line)}</div>`);
                }
                i++;
            }
            return out.join('');
        }

        function formatNum(n) {
            return Number(n || 0).toLocaleString('ko-KR');
        }

        // 답변 하단 사용량 표시 (어떤 조회를 했고 토큰을 얼마나 썼는지)
        function buildUsageLine(meta) {
            if (!meta) return null;
            const div = document.createElement('div');
            div.className = 'chatbot-usage-line';
            const tools = (meta.tools || []).map(t => TOOL_LABELS[t] || t);
            const parts = [];
            parts.push(tools.length ? `🔧 ${tools.join(', ')}` : '🔧 조회 없음');
            parts.push(`API ${meta.api_calls || 0}회`);
            let tok = `토큰 ${formatNum(meta.total)} (입력 ${formatNum(meta.prompt)} · 출력 ${formatNum(meta.output)}`;
            if (meta.thoughts) tok += ` · 사고 ${formatNum(meta.thoughts)}`;
            tok += ')';
            parts.push(tok);
            div.textContent = parts.join(' · ');
            return div;
        }

        // 3. 메시지 추가 함수
        function appendMessage(sender, text, saveHistory = true, meta = null) {
            const msgRow = document.createElement('div');
            msgRow.className = `chatbot-msg-row chatbot-msg-${sender}`;

            const bubble = document.createElement('div');
            bubble.className = 'chatbot-msg-bubble chatbot-md';
            bubble.innerHTML = sender === 'user' ? escapeHtml(text).replace(/\n/g, '<br>') : parseMarkdown(text);

            // AI 답변인 경우 사용량 + 복사 버튼 추가
            if (sender === 'ai') {
                const actionRow = document.createElement('div');
                actionRow.className = 'chatbot-msg-actions';

                const usageLine = buildUsageLine(meta);
                if (usageLine) actionRow.appendChild(usageLine);

                const copyBtn = document.createElement('button');
                copyBtn.type = 'button';
                copyBtn.className = 'chatbot-copy-btn';
                copyBtn.innerHTML = '📋 복사';
                copyBtn.title = '답변 리포트 내용 복사';
                copyBtn.onclick = (e) => {
                    e.stopPropagation();
                    copyText(text, copyBtn, '✅ 복사됨', '📋 복사');
                };

                actionRow.appendChild(copyBtn);
                bubble.appendChild(actionRow);
            }

            msgRow.appendChild(bubble);
            chatbotMessages.appendChild(msgRow);
            scrollToBottom();

            if (saveHistory) {
                const history = readLocalHistory();
                history.push(meta ? { sender, text, meta } : { sender, text });
                writeLocalHistory(history);
            }
        }

        // 4. 로딩 인디케이터 (경과 시간 표시)
        let loadingIndicatorEl = null;
        let loadingTimer = null;

        function showLoading() {
            if (loadingIndicatorEl) return;

            const msgRow = document.createElement('div');
            msgRow.className = 'chatbot-msg-row chatbot-msg-ai';
            msgRow.id = 'chatbot-loading-indicator';

            const bubble = document.createElement('div');
            bubble.className = 'chatbot-msg-bubble';

            const indicator = document.createElement('div');
            indicator.className = 'chatbot-typing-indicator';
            indicator.innerHTML = '<span></span><span></span><span></span><em class="chatbot-elapsed">조회 중 0초</em>';

            bubble.appendChild(indicator);
            msgRow.appendChild(bubble);
            chatbotMessages.appendChild(msgRow);
            loadingIndicatorEl = msgRow;
            scrollToBottom();

            const started = Date.now();
            const elapsedEl = indicator.querySelector('.chatbot-elapsed');
            loadingTimer = setInterval(() => {
                elapsedEl.textContent = `조회 중 ${Math.floor((Date.now() - started) / 1000)}초`;
            }, 1000);
        }

        function hideLoading() {
            if (loadingTimer) {
                clearInterval(loadingTimer);
                loadingTimer = null;
            }
            if (loadingIndicatorEl) {
                loadingIndicatorEl.remove();
                loadingIndicatorEl = null;
            }
        }

        // 5. 스크롤 최하단 이동 함수
        function scrollToBottom() {
            chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
        }

        // 6. 쿠키에서 CSRF 토큰 파싱 (보안 전송 필수용)
        function getCookie(name) {
            let cookieValue = null;
            if (document.cookie && document.cookie !== '') {
                const cookies = document.cookie.split(';');
                for (let i = 0; i < cookies.length; i++) {
                    const cookie = cookies[i].trim();
                    if (cookie.substring(0, name.length + 1) === (name + '=')) {
                        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                        break;
                    }
                }
            }
            return cookieValue;
        }

        // 7. HTML 이스케이프 유틸리티
        function escapeHtml(unsafe) {
            return String(unsafe == null ? '' : unsafe)
                 .replace(/&/g, "&amp;")
                 .replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;")
                 .replace(/"/g, "&quot;")
                 .replace(/'/g, "&#039;");
        }

        // 8. 질문 전송 처리 로직 (직접 입력 / 원인 분석 공통)
        let isSending = false;

        function handleSend() {
            const question = chatbotInputField.value.trim();
            if (!question || isSending) return;
            chatbotInputField.value = '';
            sendRequest('/api/chat', question, { message: question });
        }

        async function sendRequest(url, displayText, payload) {
            if (isSending) return;
            isSending = true;

            appendMessage('user', displayText);

            showLoading();
            chatbotInputField.disabled = true;
            chatbotSendBtn.disabled = true;

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrf_token')
                    },
                    body: JSON.stringify(payload)
                });

                let data = {};
                try {
                    data = await response.json();
                } catch (e) {
                    data = {};
                }
                hideLoading();

                if (response.ok && data.status === 'success') {
                    appendMessage('ai', data.reply, true, data.usage || null);
                } else {
                    appendMessage('ai', data.message || '⚠️ 오류가 발생하여 답변을 받을 수 없습니다. 잠시 후 다시 시도해주세요.', true, data.usage || null);
                }
            } catch (error) {
                hideLoading();
                appendMessage('ai', '⚠️ 네트워크 연결 오류가 발생했습니다. 서버 연결 상태를 확인해주세요.');
            } finally {
                isSending = false;
                chatbotInputField.disabled = false;
                chatbotSendBtn.disabled = false;
                // 답변 아래에 바로 다음 작업을 고를 수 있도록 버튼을 다시 표시합니다.
                renderGuideCard();
                chatbotInputField.focus();
            }
        }

        // 9. 이벤트 연결 (전송 버튼 및 엔터 키 — 한글 조합 중 Enter 는 무시하여 중복 전송/글자 잔류 방지)
        chatbotSendBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleSend();
        });

        chatbotInputField.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            if (e.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            handleSend();
        });

        // 10. 토큰 사용량 모달
        const usageBtn = document.getElementById('chatbot-usage-btn');
        const usageModal = document.getElementById('chatbot-usage-modal');
        const usageBody = document.getElementById('chatbot-usage-body');
        const usageDays = document.getElementById('chatbot-usage-days');

        window.closeChatbotUsageModal = function() {
            if (usageModal) usageModal.style.display = 'none';
        };

        if (usageBtn && usageModal && usageBody) {
            usageBtn.addEventListener('click', (e) => {
                e.preventDefault();
                usageModal.style.display = 'flex';
                loadUsage();
                if (typeof window.pushModalHistory === 'function') {
                    window.pushModalHistory(window.closeChatbotUsageModal);
                }
            });
            if (usageDays) usageDays.addEventListener('change', loadUsage);
            usageModal.addEventListener('click', (e) => {
                if (e.target === usageModal) window.closeChatbotUsageModal();
            });
        }

        async function loadUsage() {
            const days = usageDays ? usageDays.value : '7';
            usageBody.innerHTML = '<div class="chatbot-usage-empty">사용량을 불러오는 중...</div>';
            try {
                const res = await fetch(`/api/chat/usage?days=${encodeURIComponent(days)}`);
                const data = await res.json();
                if (!res.ok || data.status !== 'success') {
                    usageBody.innerHTML = `<div class="chatbot-usage-empty">${escapeHtml(data.message || '사용량을 불러오지 못했습니다.')}</div>`;
                    return;
                }
                usageBody.innerHTML = renderUsage(data);
            } catch (err) {
                usageBody.innerHTML = '<div class="chatbot-usage-empty">서버 연결 중 오류가 발생했습니다.</div>';
            }
        }

        function renderUsage(d) {
            const cfg = d.config || {};
            const p = d.period || {};
            const t = d.today || {};
            const costText = (v) => (v === null || v === undefined) ? '가격 미설정' : `$${Number(v).toFixed(4)}`;
            let h = '';

            if (Array.isArray(d.schema_issues) && d.schema_issues.length) {
                h += '<div class="chatbot-usage-warn"><strong>⚠️ DB 구조 점검 경고</strong> — 챗봇이 데이터를 잘못 읽을 수 있습니다.<ul>' +
                    d.schema_issues.map(x => `<li>${escapeHtml(x)}</li>`).join('') + '</ul></div>';
            }

            h += `<div class="chatbot-usage-config">${escapeHtml(cfg.api_type)} · ${escapeHtml(cfg.model)} · 도구 라운드 최대 ${cfg.max_tool_rounds}회 · 대화 맥락 ${cfg.history_turns}턴 · 출력 최대 ${formatNum(cfg.max_output_tokens)} · thinking ${cfg.thinking_budget === null ? '기본값' : cfg.thinking_budget}</div>`;

            const cards = [
                ['오늘 질문', `${formatNum(t.requests)}${cfg.daily_limit ? ' / ' + formatNum(cfg.daily_limit) : ''}`],
                ['오늘 API 호출', formatNum(t.api_calls) + (t.errors ? ` (오류 ${t.errors})` : '')],
                ['기간 총 토큰', formatNum(p.total_tokens)],
                ['질문당 평균 토큰', formatNum(p.avg_tokens_per_request)],
                ['질문당 평균 API 호출', p.avg_calls_per_request || 0],
                ['기간 예상 비용', costText(p.cost)]
            ];
            h += '<div class="chatbot-usage-cards">' + cards.map(c =>
                `<div class="chatbot-usage-card"><div class="label">${c[0]}</div><div class="value">${c[1]}</div></div>`).join('') + '</div>';

            // 모드별 비중 (원인 분석 / 직접 입력)
            const modes = d.modes || [];
            if (modes.length) {
                h += '<h4 class="chatbot-usage-title">모드별 사용량</h4><div class="chatbot-table-wrap"><table class="chatbot-table"><thead><tr><th>모드</th><th>질문</th><th>API 호출</th><th>총 토큰</th><th>질문당 평균</th><th>비중</th><th>예상 비용</th></tr></thead><tbody>' +
                    modes.map(m => `<tr><td><span class="chatbot-mode-badge ${m.mode === 'analysis' ? 'analysis' : 'chat'}">${escapeHtml(m.label)}</span></td><td>${formatNum(m.requests)}</td><td>${formatNum(m.api_calls)}</td>` +
                        `<td>${formatNum(m.total)}</td><td>${formatNum(m.avg_tokens)}</td><td><strong>${m.share}%</strong></td><td>${costText(m.cost)}</td></tr>`).join('') +
                    '</tbody></table></div>';
            }

            // 토큰 구성
            const bd = (d.breakdown || []).filter(b => b.tokens > 0);
            const bdTotal = bd.reduce((a, b) => a + b.tokens, 0) || 1;
            h += '<h4 class="chatbot-usage-title">어디에 토큰이 쓰였나 <span>(입력은 문자 수 비율로 추정)</span></h4>';
            if (bd.length) {
                h += '<div class="chatbot-usage-bars">' + bd.sort((a, b) => b.tokens - a.tokens).map(b => {
                    const pct = (b.tokens / bdTotal * 100);
                    return `<div class="chatbot-usage-bar-row"><span class="name">${escapeHtml(b.label)}</span>` +
                        `<span class="bar"><span style="width:${Math.max(pct, 1).toFixed(1)}%"></span></span>` +
                        `<span class="num">${formatNum(b.tokens)} (${pct.toFixed(1)}%)</span></div>`;
                }).join('') + '</div>';
            } else {
                h += '<div class="chatbot-usage-empty">기간 내 사용 기록이 없습니다.</div>';
            }

            // 도구별
            const tools = d.tools || [];
            h += '<h4 class="chatbot-usage-title">조회 도구별 결과 크기 <span>(결과가 클수록 다음 API 호출의 입력 토큰이 늘어남)</span></h4>';
            if (tools.length) {
                h += '<div class="chatbot-table-wrap"><table class="chatbot-table"><thead><tr><th>도구</th><th>호출</th><th>평균 결과(문자)</th><th>총 결과(문자)</th></tr></thead><tbody>' +
                    tools.map(x => `<tr><td>${escapeHtml(TOOL_LABELS[x.name] || x.name)}</td><td>${formatNum(x.calls)}</td><td>${formatNum(x.avg_chars)}</td><td>${formatNum(x.chars)}</td></tr>`).join('') +
                    '</tbody></table></div>';
            } else {
                h += '<div class="chatbot-usage-empty">도구 호출 기록이 없습니다.</div>';
            }

            const reqTable = (rows) => '<div class="chatbot-table-wrap"><table class="chatbot-table"><thead><tr><th>시각</th><th>질문</th><th>API</th><th>조회</th><th>입력</th><th>출력</th><th>총 토큰</th></tr></thead><tbody>' +
                rows.map(r => `<tr><td>${escapeHtml(r.time)}</td><td class="q"><span class="chatbot-mode-badge ${r.mode === 'analysis' ? 'analysis' : 'chat'}">${r.mode === 'analysis' ? '원인 분석' : '직접 입력'}</span> ${escapeHtml(r.question)}${r.error ? `<div class="err">⚠️ ${escapeHtml(r.error)}</div>` : ''}</td>` +
                    `<td>${r.api_calls}</td><td>${escapeHtml((r.tools || []).map(n => TOOL_LABELS[n] || n).join(', ') || '-')}</td>` +
                    `<td>${formatNum(r.prompt)}</td><td>${formatNum(r.output + (r.thoughts || 0))}</td><td><strong>${formatNum(r.total)}</strong></td></tr>`).join('') +
                '</tbody></table></div>';

            h += '<h4 class="chatbot-usage-title">토큰을 많이 쓴 질문 Top 10</h4>';
            h += (d.top_requests || []).length ? reqTable(d.top_requests) : '<div class="chatbot-usage-empty">기록이 없습니다.</div>';

            h += '<h4 class="chatbot-usage-title">최근 질문</h4>';
            h += (d.recent_requests || []).length ? reqTable(d.recent_requests) : '<div class="chatbot-usage-empty">기록이 없습니다.</div>';

            if ((d.daily || []).length) {
                h += '<h4 class="chatbot-usage-title">일별</h4><div class="chatbot-table-wrap"><table class="chatbot-table"><thead><tr><th>날짜</th><th>질문</th><th>API 호출</th><th>총 토큰</th></tr></thead><tbody>' +
                    d.daily.map(x => `<tr><td>${escapeHtml(x.date)}</td><td>${formatNum(x.requests)}</td><td>${formatNum(x.api_calls)}</td><td>${formatNum(x.total)}</td></tr>`).join('') +
                    '</tbody></table></div>';
            }
            return h;
        }

        // 11. 초기화 시 세션 대화 기록 복원 호출
        restoreChatbotSession();
    }

    // 홈 화면은 페이지 새로고침 없이 로그인하므로, 로그인 성공 직후 이 함수로 챗봇을 켭니다.
    window.activateChatbot = async function () {
        const container = document.getElementById('ai-chatbot-container');
        if (!container || chatbotInitialized) return;
        try {
            const res = await fetch('/api/chat/enabled');
            const data = await res.json();
            if (!res.ok || !data.enabled) return;
        } catch (e) {
            return;
        }
        container.dataset.enabled = '1';
        container.style.display = 'block';
        initChatbot();
    };

    document.addEventListener('DOMContentLoaded', () => {
        const container = document.getElementById('ai-chatbot-container');
        if (container && container.dataset.enabled === '1') initChatbot();
    });
})();
