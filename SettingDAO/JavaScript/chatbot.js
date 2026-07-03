/* ==========================================================================
   AI Chatbot Client Script (Mobile Compatibility & Secure Communication)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    const chatbotContainer = document.getElementById('ai-chatbot-container');
    const chatbotToggleBtn = document.getElementById('chatbot-toggle-btn');
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

    // 2. 모바일 브라우저 터치 호환 이벤트 바인딩 (pointerup 사용)
    const toggleEvent = (e) => {
        e.preventDefault();
        chatbotWindow.classList.toggle('active');
        if (chatbotWindow.classList.contains('active')) {
            chatbotInputField.focus();
            scrollToBottom();
        }
    };

    chatbotToggleBtn.addEventListener('pointerup', toggleEvent);
    chatbotCloseBtn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        chatbotWindow.classList.remove('active');
    });

    // 3. 메시지 추가 함수
    function appendMessage(sender, text) {
        const msgRow = document.createElement('div');
        msgRow.className = `chatbot-msg-row chatbot-msg-${sender}`;

        const bubble = document.createElement('div');
        bubble.className = 'chatbot-msg-bubble';
        
        // HTML 이스케이프 후 마스킹 토큰만 임의 강조 표시하기 위해 안전한 변환 수행
        const safeText = escapeHtml(text);
        
        // [MASK_SITE_1] 등 마스킹 토큰을 굵고 주황색 점선 테두리가 있는 시각 요소로 렌더링
        const renderedText = safeText.replace(/(\[MASK_[A-Z]+_\d+\])/g, '<span class="chatbot-mask-token">$1</span>');
        bubble.innerHTML = renderedText;

        msgRow.appendChild(bubble);
        chatbotMessages.appendChild(msgRow);
        scrollToBottom();
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
});
