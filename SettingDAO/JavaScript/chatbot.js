/* ==========================================================================
   AI Chatbot Client Script (Mobile Compatibility & Secure Communication)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
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

    // 1. 로그인 여부 및 superadmin 권한에 따른 챗봇 플로팅 버튼 노출 여부 결정
    function checkLoginStatus() {
        const userRole = sessionStorage.getItem('userRole') || document.body.getAttribute('data-user-role') || '';
        const isSuperAdmin = userRole === 'superadmin';

        if (isSuperAdmin) {
            chatbotContainer.style.display = 'block';
        } else {
            chatbotContainer.style.display = 'none';
            chatbotWindow.classList.remove('active');
        }
    }

    // 초기 실행 및 로그인 상태 관찰을 위한 Interval (3초 간격)
    checkLoginStatus();
    setInterval(checkLoginStatus, 3000);

    // [추가] 챗봇 세션 대화 기록 복원 로직 (DB 연동 기반으로 새로고침/재접속 시에도 완벽 보존)
    async function restoreChatbotSession() {
        let history = [];
        const historyStr = sessionStorage.getItem('chatbot_history');
        if (historyStr) {
            try {
                history = JSON.parse(historyStr);
            } catch (e) {
                history = [];
            }
        }

        // sessionStorage에 기록이 없거나 비어있는 경우, DB에서 오늘 대화 내역을 비동기 조회하여 복원
        if (!history || history.length === 0) {
            try {
                const res = await fetch('/api/chat/history');
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'success' && Array.isArray(data.today_messages) && data.today_messages.length > 0) {
                        history = data.today_messages.map(m => ({ sender: m.sender, text: m.text }));
                        sessionStorage.setItem('chatbot_history', JSON.stringify(history));
                        if (data.today_messages[0].session_id) {
                            sessionStorage.setItem('chatbot_current_session_id', data.today_messages[0].session_id);
                        }
                    }
                }
            } catch (err) {
                console.warn("Failed to fetch chat history from DB:", err);
            }
        }

        if (history && history.length > 0) {
            chatbotMessages.innerHTML = '';
            history.forEach(msg => {
                appendMessage(msg.sender, msg.text, false);
            });
        } else {
            chatbotMessages.innerHTML = '';
            insertDefaultWelcome();
        }

        // 창 열림 상태 복원
        const isWindowActive = sessionStorage.getItem('chatbot_window_active') === 'true';
        if (isWindowActive) {
            chatbotWindow.classList.add('active');
            setTimeout(() => {
                scrollToBottom();
                chatbotInputField.focus();
            }, 100);
        }

        // 창 확대 상태 복원
        const isWindowExpanded = sessionStorage.getItem('chatbot_window_expanded') === 'true';
        if (isWindowExpanded) {
            chatbotWindow.classList.add('expanded');
            if (chatbotExpandBtn) chatbotExpandBtn.textContent = '⤣';
        }
    }

    function insertDefaultWelcome() {
        const welcome = "안녕하세요! 위드텍 설비 관리 지원 AI 비서입니다. 무엇을 도와드릴까요?";
        appendMessage('ai', welcome, false);
    }

    function getTodayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

    // 세션 ID 생성 및 반환 유틸리티
    function getCurrentSessionId() {
        let sid = sessionStorage.getItem('chatbot_current_session_id');
        if (!sid) {
            sid = 'sess_' + Date.now();
            sessionStorage.setItem('chatbot_current_session_id', sid);
        }
        return sid;
    }

    // [추가] ➕ 새 대화 시작 기능
    const chatbotNewBtn = document.getElementById('chatbot-new-btn');
    if (chatbotNewBtn) {
        chatbotNewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            startNewChat();
        });
    }

    function startNewChat() {
        chatbotMessages.innerHTML = '';
        insertDefaultWelcome();
        sessionStorage.removeItem('chatbot_history');
        const newSid = 'sess_' + Date.now();
        sessionStorage.setItem('chatbot_current_session_id', newSid);
        if (chatbotInputField) {
            chatbotInputField.value = '';
            chatbotInputField.focus();
        }
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
                const csrfToken = getCookie('csrf_token');
                const res = await fetch('/api/chat/history/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify({ all: true })
                });
                if (res.ok) {
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key.startsWith('chatbot_saved_history_') || key.startsWith('chatbot_session_')) {
                            keysToRemove.push(key);
                        }
                    }
                    keysToRemove.forEach(k => localStorage.removeItem(k));
                    sessionStorage.removeItem('chatbot_history');
                    sessionStorage.removeItem('chatbot_current_session_id');
                    chatbotMessages.innerHTML = '';
                    insertDefaultWelcome();
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

        // 실제 대화 내용이 있는 것만 엄격히 필터링 (메시지 수 0건이거나 내용 없는 것 제외)
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
                        const csrfToken = getCookie('csrf_token');
                        await fetch('/api/chat/history/delete', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRFToken': csrfToken
                            },
                            body: JSON.stringify({ session_id: sessionItem.session_id })
                        });
                    } catch (delErr) {
                        console.error('Failed to delete history on server:', delErr);
                    }
                    if (sessionStorage.getItem('chatbot_current_session_id') === sessionItem.session_id) {
                        sessionStorage.removeItem('chatbot_history');
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

                // 이어서 대화하기 버튼 활성화
                if (resumeBtn) {
                    resumeBtn.style.display = 'inline-block';
                    resumeBtn.onclick = () => {
                        sessionStorage.setItem('chatbot_current_session_id', sessionItem.session_id);
                        sessionStorage.setItem('chatbot_history', JSON.stringify(messages.map(m => ({ sender: m.sender, text: m.text }))));
                        restoreChatbotSession();
                        window.closeChatbotHistoryModal();
                        if (chatbotInputField) chatbotInputField.focus();
                    };
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
                        const timeStr = m.created_at ? `<span style="font-size:11px; color:#8b949e; margin-left:8px; font-weight:normal;">${m.created_at}</span>` : '';
                        leftSpan.innerHTML = `<strong style="color:${color};">${senderName}:</strong>${timeStr}`;

                        const copyBtn = document.createElement('button');
                        copyBtn.type = 'button';
                        copyBtn.className = 'chatbot-history-copy-btn';
                        copyBtn.innerHTML = '📋 복사';
                        copyBtn.title = '대화 내용 복사';
                        const fullText = m.text || m.message || '';
                        copyBtn.onclick = async () => {
                            try {
                                await navigator.clipboard.writeText(fullText);
                                copyBtn.innerHTML = '✅ 복사됨';
                                setTimeout(() => { copyBtn.innerHTML = '📋 복사'; }, 2000);
                            } catch (e) {
                                const ta = document.createElement('textarea');
                                ta.value = fullText;
                                ta.style.position = 'fixed';
                                ta.style.left = '-9999px';
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                document.body.removeChild(ta);
                                copyBtn.innerHTML = '✅ 복사됨';
                                setTimeout(() => { copyBtn.innerHTML = '📋 복사'; }, 2000);
                            }
                        };

                        headerDiv.appendChild(leftSpan);
                        headerDiv.appendChild(copyBtn);

                        const bodyDiv = document.createElement('div');
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

    // [추가] 챗봇 마크다운 문자열 초경량 HTML 파서
    function parseMarkdown(text) {
        let html = escapeHtml(text);

        // 1. 볼드 처리 (**텍스트**)
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // 2. 제목 헤더 처리 (###)
        html = html.replace(/^###\s*(.*$)/gim, '<h3 class="chatbot-h3">$1</h3>');
        html = html.replace(/^##\s*(.*$)/gim, '<h2 class="chatbot-h2">$1</h2>');
        html = html.replace(/^#\s*(.*$)/gim, '<h1 class="chatbot-h1">$1</h1>');

        // 3. 구분선 (---)
        html = html.replace(/^---$/gim, '<hr class="chatbot-hr">');

        // 4. 글머리 기호 리스트 (* 나 - ) -> 가독성용 커스텀 bullet point
        html = html.replace(/^\*\s+(.*$)/gim, '<div class="chatbot-list-item">• $1</div>');
        html = html.replace(/^-\s+(.*$)/gim, '<div class="chatbot-list-item">• $1</div>');

        // 5. 줄바꿈 처리 (\n)
        html = html.replace(/\n/g, '<br>');
        
        // 6. 연속된 br 정리
        html = html.replace(/(<br>){3,}/g, '<br><br>');

        return html;
    }

    // 3. 메시지 추가 함수 (saveHistory 플래그를 통한 sessionStorage 및 localStorage 자동 관리)
    function appendMessage(sender, text, saveHistory = true) {
        const msgRow = document.createElement('div');
        msgRow.className = `chatbot-msg-row chatbot-msg-${sender}`;

        const bubble = document.createElement('div');
        bubble.className = 'chatbot-msg-bubble';
        
        const rawParsedHtml = parseMarkdown(text);
        const renderedText = rawParsedHtml.replace(/(\[MASK_[A-Z]+_\d+\])/g, '<span class="chatbot-mask-token">$1</span>');
        bubble.innerHTML = renderedText;

        // AI 답변인 경우 리포트 복사 버튼 추가
        if (sender === 'ai') {
            const actionRow = document.createElement('div');
            actionRow.className = 'chatbot-msg-actions';

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'chatbot-copy-btn';
            copyBtn.innerHTML = '📋 복사';
            copyBtn.title = '답변 리포트 내용 복사';

            copyBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(text);
                    copyBtn.innerHTML = '✅ 복사됨';
                    copyBtn.classList.add('copied');
                    setTimeout(() => {
                        copyBtn.innerHTML = '📋 복사';
                        copyBtn.classList.remove('copied');
                    }, 2000);
                } catch (err) {
                    // Fallback for older browsers
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    copyBtn.innerHTML = '✅ 복사됨';
                    copyBtn.classList.add('copied');
                    setTimeout(() => {
                        copyBtn.innerHTML = '📋 복사';
                        copyBtn.classList.remove('copied');
                    }, 2000);
                }
            };

            actionRow.appendChild(copyBtn);
            bubble.appendChild(actionRow);
        }

        msgRow.appendChild(bubble);
        chatbotMessages.appendChild(msgRow);
        scrollToBottom();

        if (saveHistory) {
            let history = [];
            const historyStr = sessionStorage.getItem('chatbot_history');
            if (historyStr) {
                try {
                    history = JSON.parse(historyStr);
                } catch (e) {
                    history = [];
                }
            }
            history.push({ sender, text });
            sessionStorage.setItem('chatbot_history', JSON.stringify(history));
        }
    }

    // 4. 로딩 인디케이터 표시/제거 함수
    let loadingIndicatorEl = null;

    function showLoading() {
        if (loadingIndicatorEl) return;

        const msgRow = document.createElement('div');
        msgRow.className = 'chatbot-msg-row chatbot-msg-ai';
        msgRow.id = 'chatbot-loading-indicator';

        const bubble = document.createElement('div');
        bubble.className = 'chatbot-msg-bubble';

        const indicator = document.createElement('div');
        indicator.className = 'chatbot-typing-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';

        bubble.appendChild(indicator);
        msgRow.appendChild(bubble);
        chatbotMessages.appendChild(msgRow);
        loadingIndicatorEl = msgRow;
        scrollToBottom();
    }

    function hideLoading() {
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
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // 8. 질문 전송 처리 로직
    async function handleSend() {
        const question = chatbotInputField.value.trim();
        if (!question) return;

        // 화면에 사용자 메시지 추가 및 입력창 초기화
        appendMessage('user', question);
        chatbotInputField.value = '';

        // 로딩 및 입력창 비활성화
        showLoading();
        chatbotInputField.disabled = true;
        chatbotSendBtn.disabled = true;

        try {
            const csrfToken = getCookie('csrf_token');
            const sid = getCurrentSessionId();
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({ message: question, session_id: sid })
            });

            const data = await response.json();
            hideLoading();

            if (response.ok && data.status === 'success') {
                if (data.session_id) {
                    sessionStorage.setItem('chatbot_current_session_id', data.session_id);
                }
                appendMessage('ai', data.reply);
            } else {
                appendMessage('ai', data.message || '오류가 발생하여 답변을 받을 수 없습니다. 잠시 후 다시 시도해주세요.');
            }
        } catch (error) {
            hideLoading();
            appendMessage('ai', '네트워크 연결 오류가 발생했습니다. 서버 연결 상태를 확인해주세요.');
        } finally {
            chatbotInputField.disabled = false;
            chatbotSendBtn.disabled = false;
            chatbotInputField.focus();
        }
    }

    // 9. 이벤트 연결 (전송 버튼 및 엔터 키)
    chatbotSendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleSend();
    });

    chatbotInputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSend();
        }
    });

    // 10. 초기화 시 세션 대화 기록 복원 호출
    restoreChatbotSession();
});
