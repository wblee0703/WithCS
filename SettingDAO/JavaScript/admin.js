document.addEventListener('DOMContentLoaded', () => {
    setupAdminMenu();
    setupUserMgmt();
    setupSystemMgmt();
});

// 사이드바 메뉴 탭 전환 기능
function setupAdminMenu() {
    const menuItems = document.querySelectorAll('#admin-menu-list li');
    const sections = document.querySelectorAll('.admin-section');

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            // 1. 메뉴 활성화 상태 변경
            menuItems.forEach(li => li.classList.remove('active'));
            item.classList.add('active');

            // 2. 해당 섹션 표시
            const targetId = `section-${item.dataset.target}`;
            sections.forEach(sec => {
                if (sec.id === targetId) {
                    sec.style.display = 'flex';
                } else {
                    sec.style.display = 'none';
                }
            });
        });
    });
}

// 사용자 추가 기능
function setupUserMgmt() {
    const btnAdd = document.getElementById('btn-admin-add-user');
    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const id = document.getElementById('admin-new-id').value.trim();
            const pw = document.getElementById('admin-new-pw').value.trim();
            const role = document.getElementById('admin-new-role').value;

            if (!id || !pw) return alert('아이디와 비밀번호를 입력해주세요.');
            if (!confirm(`아이디: ${id}\n권한: ${role}\n\n사용자를 추가하시겠습니까?`)) return;

            fetch('/api/user/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ id, pw, role })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    alert('사용자가 성공적으로 추가되었습니다.');
                    document.getElementById('admin-new-id').value = '';
                    document.getElementById('admin-new-pw').value = '';
                } else {
                    alert('추가 실패: ' + (data.message || '알 수 없는 오류'));
                }
            })
            .catch(err => {
                console.error(err);
                alert('서버 통신 오류가 발생했습니다.');
            });
        });
    }
}

// 시스템 동기화 기능
function setupSystemMgmt() {
    const btnSync = document.getElementById('btn-admin-sync');
    if (btnSync) {
        btnSync.addEventListener('click', () => {
            if (!confirm('GitHub 동기화를 진행하시겠습니까?\n(인터넷 연결이 필요합니다)')) return;
            
            fetch('/api/admin/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                }
            })
            .then(res => res.json())
            .then(data => {
                alert(data.message);
            })
            .catch(err => console.error(err));
        });
    }
}

// CSRF 토큰 추출 헬퍼
function getCsrfToken() {
    return document.cookie.replace(/(?:^|.*;\s*)csrf_token\s*=\s*([^;]*).*$|^.*$/, "$1");
}