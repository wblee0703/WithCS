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

    // 1. 로그인 여부에 따른 챗봇 플로팅 버튼 노출 여부 결정
    function checkLoginStatus() {
        const isStorageLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
        const isBodyLoggedIn = document.body.getAttribute('data-user-logged-in') === 'true';
        const userInfoEl = document.getElementById('user-info');
        const isUserInfoVisible = userInfoEl && userInfoEl.style.display !== 'none';

        const isLoggedIn = isStorageLoggedIn || isBodyLoggedIn || isUserInfoVisible;

        if (isLoggedIn) {
            chatbotContainer.style.display = 'block';
            if (!isStorageLoggedIn) {
                sessionStorage.setItem('isLoggedIn', 'true');
            }
        } else {
            chatbotContainer.style.display = 'none';
            chatbotWindow.classList.remove('active');
        }
    }

    // 초기 실행 및 로그인 상태 관찰을 위한 Interval (3초 간격)
    checkLoginStatus();
    setInterval(checkLoginStatus, 3000);

    // [추가] 챗봇 세션 대화 기록 복원 로직
    function restoreChatbotSession() {
        const historyStr = sessionStorage.getItem('chatbot_history');
        if (historyStr) {
            try {
                const history = JSON.parse(historyStr);
                history.forEach(msg => {
                    appendMessage(msg.sender, msg.text, false);
                });
            } catch (e) {
                console.error("Failed to parse chatbot history:", e);
                sessionStorage.removeItem('chatbot_history');
                insertDefaultWelcome();
            }
        } else {
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
        appendMessage('ai', welcome, true);
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

    // 저장된 위치가 있다면 복원
    const savedLeft = localStorage.getItem('chatbot_icon_left');
    const savedTop = localStorage.getItem('chatbot_icon_top');
    if (savedLeft && savedTop) {
        chatbotToggleBtn.style.right = 'auto';
        chatbotToggleBtn.style.bottom = 'auto';
        chatbotToggleBtn.style.left = savedLeft;
        chatbotToggleBtn.style.top = savedTop;
    }

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

    // 챗봇 대화 기록 모달 제어
    const chatbotHistoryBtn = document.getElementById('chatbot-history-btn');
    const chatbotHistoryModal = document.getElementById('chatbot-history-modal');
    const clearAllBtn = document.getElementById('btn-clear-all-chat-history');

    window.closeChatbotHistoryModal = function() {
        if (chatbotHistoryModal) chatbotHistoryModal.style.display = 'none';
    };

    if (clearAllBtn) {
        clearAllBtn.onclick = () => {
            if (!confirm('저장된 모든 챗봇 대화 기록을 삭제하시겠습니까?')) return;
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('chatbot_saved_history_')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
            sessionStorage.removeItem('chatbot_history');
            renderChatbotHistoryModal();
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

    function renderChatbotHistoryModal() {
        const dateListEl = document.getElementById('chatbot-history-date-list');
        const contentEl = document.getElementById('chatbot-history-content');
        const selectedDateEl = document.getElementById('chatbot-history-selected-date');
        if (!dateListEl || !contentEl) return;

        dateListEl.innerHTML = '';
        contentEl.innerHTML = '';

        const savedKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('chatbot_saved_history_')) {
                savedKeys.push(key.replace('chatbot_saved_history_', ''));
            }
        }

        const todayKey = getTodayKey();
        if (!savedKeys.includes(todayKey)) {
            const todayHistory = sessionStorage.getItem('chatbot_history');
            if (todayHistory) {
                savedKeys.push(todayKey);
            }
        }

        savedKeys.sort((a, b) => b.localeCompare(a));

        if (savedKeys.length === 0) {
            dateListEl.innerHTML = '<li style="color:#8b949e; font-size:12px; padding:10px; text-align:center;">기록 없음</li>';
            contentEl.innerHTML = '<div style="color:#8b949e; text-align:center; padding: 40px;">저장된 대화 기록이 없습니다.</div>';
            if (selectedDateEl) selectedDateEl.textContent = '선택된 날짜 대화';
            return;
        }

        savedKeys.forEach(dateStr => {
            const li = document.createElement('li');
            li.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 4px; cursor: pointer; color: #c9d1d9; background: #161b22; border: 1px solid #30363d; font-size: 12px; transition: all 0.2s;';

            const titleSpan = document.createElement('span');
            titleSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 6px;';
            titleSpan.textContent = dateStr === todayKey ? `${dateStr} (오늘)` : dateStr;

            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = '이 날짜 기록 삭제';
            deleteBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 12px; opacity: 0.7; padding: 2px; border-radius: 3px; transition: opacity 0.2s;';
            deleteBtn.onmouseenter = () => deleteBtn.style.opacity = '1';
            deleteBtn.onmouseleave = () => deleteBtn.style.opacity = '0.7';

            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`${dateStr} 대화 기록을 삭제하시겠습니까?`)) {
                    localStorage.removeItem(`chatbot_saved_history_${dateStr}`);
                    if (dateStr === todayKey) {
                        sessionStorage.removeItem('chatbot_history');
                    }
                    renderChatbotHistoryModal();
                }
            };

            li.appendChild(titleSpan);
            li.appendChild(deleteBtn);

            li.onclick = () => {
                dateListEl.querySelectorAll('li').forEach(el => {
                    el.style.borderColor = '#30363d';
                    el.style.background = '#161b22';
                });
                li.style.borderColor = '#238636';
                li.style.background = '#21262d';

                if (selectedDateEl) selectedDateEl.textContent = `${dateStr} 대화 내역`;

                const storedData = localStorage.getItem(`chatbot_saved_history_${dateStr}`) || (dateStr === todayKey ? sessionStorage.getItem('chatbot_history') : null);
                if (!storedData) {
                    contentEl.innerHTML = '<div style="color:#8b949e; text-align:center; padding: 30px;">해당 날짜의 대화 내용이 존재하지 않습니다.</div>';
                    return;
                }

                try {
                    const messages = JSON.parse(storedData);
                    let html = '';
                    messages.forEach(m => {
                        const senderName = m.sender === 'user' ? '👤 사용자' : '🤖 AI 비서';
                        const color = m.sender === 'user' ? '#58a6ff' : '#3fb950';
                        html += `<div style="margin-bottom: 12px; border-bottom: 1px solid #21262d; padding-bottom: 8px;"><strong style="color:${color};">${senderName}:</strong><div style="margin-top: 4px; color:#c9d1d9; font-size: 13px;">${parseMarkdown(m.text)}</div></div>`;
                    });
                    contentEl.innerHTML = html;
                } catch (e) {
                    contentEl.innerHTML = '<div style="color:#f85149;">대화 기록을 불러오는 도중 오류가 발생했습니다.</div>';
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

            // 날짜별 대화 내역 저장
            const todayKey = getTodayKey();
            localStorage.setItem(`chatbot_saved_history_${todayKey}`, JSON.stringify(history));
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
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({ message: question })
            });

            const data = await response.json();
            hideLoading();

            if (response.ok && data.status === 'success') {
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
