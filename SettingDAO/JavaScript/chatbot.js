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
        const isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
        if (isLoggedIn) {
            chatbotContainer.style.display = 'block';
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

    // 2. 모바일 브라우저 터치 호환 이벤트 바인딩 (pointerup 사용)
    const toggleEvent = (e) => {
        e.preventDefault();
        chatbotWindow.classList.toggle('active');
        sessionStorage.setItem('chatbot_window_active', chatbotWindow.classList.contains('active'));
        if (chatbotWindow.classList.contains('active')) {
            chatbotInputField.focus();
            scrollToBottom();
        }
    };

    chatbotToggleBtn.addEventListener('pointerup', toggleEvent);
    
    if (chatbotExpandBtn) {
        chatbotExpandBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            chatbotWindow.classList.toggle('expanded');
            const isExpanded = chatbotWindow.classList.contains('expanded');
            sessionStorage.setItem('chatbot_window_expanded', isExpanded);
            chatbotExpandBtn.textContent = isExpanded ? '⤣' : '⤢';
            scrollToBottom(); // 크기 변동 시 스크롤 끝단 재갱신
        });
    }

    chatbotCloseBtn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        chatbotWindow.classList.remove('active');
        sessionStorage.setItem('chatbot_window_active', 'false');
    });

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

    // 3. 메시지 추가 함수 (saveHistory 플래그를 통한 sessionStorage 자동 관리)
    function appendMessage(sender, text, saveHistory = true) {
        const msgRow = document.createElement('div');
        msgRow.className = `chatbot-msg-row chatbot-msg-${sender}`;

        const bubble = document.createElement('div');
        bubble.className = 'chatbot-msg-bubble';
        
        // HTML 이스케이프 및 마크다운 파싱 수행
        const rawParsedHtml = parseMarkdown(text);
        
        // [MASK_SITE_1] 등 마스킹 토큰을 굵고 주황색 점선 테두리가 있는 시각 요소로 렌더링
        const renderedText = rawParsedHtml.replace(/(\[MASK_[A-Z]+_\d+\])/g, '<span class="chatbot-mask-token">$1</span>');
        bubble.innerHTML = renderedText;

        msgRow.appendChild(bubble);
        chatbotMessages.appendChild(msgRow);
        scrollToBottom();

        // 세션 스토리지에 대화 이력 저장
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
