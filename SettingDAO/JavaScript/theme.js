// 화면 테마 (블랙 / 화이트) - <head> 에서 먼저 실행해 화면 깜빡임 방지
(function () {
    var KEY = 'ui_theme';
    function saved() {
        try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; }
    }
    function apply(theme) {
        if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
        else document.documentElement.removeAttribute('data-theme');
        var btns = document.querySelectorAll('.btn-theme-toggle');
        for (var i = 0; i < btns.length; i++) {
            // 버튼에는 바꿀 모드를 표시
            btns[i].textContent = theme === 'light' ? '🌙 블랙' : '☀️ 화이트';
            btns[i].title = theme === 'light' ? '블랙 모드로 전환' : '화이트 모드로 전환';
        }
    }
    apply(saved());

    window.getUiTheme = saved;
    window.toggleUiTheme = function () {
        var next = saved() === 'light' ? 'dark' : 'light';
        try { localStorage.setItem(KEY, next); } catch (e) { }
        apply(next);
    };
    document.addEventListener('DOMContentLoaded', function () { apply(saved()); });
    // 다른 탭에서 바꾼 경우 함께 반영
    window.addEventListener('storage', function (e) { if (e.key === KEY) apply(saved()); });
})();
