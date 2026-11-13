/* ==========================================================================
   교육 (WITH Edu) - 설비 모델별 교육 영상 / 버전 이력 / 첨부자료
   API: /api/edu/... (edu/routes.py)
   - 조회/재생: 로그인 사용자, 등록/수정/삭제: 관리자(admin, superadmin)
   ========================================================================== */
(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const store = {
        get: (k, d) => { try { const v = localStorage.getItem("edu." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set: (k, v) => { try { localStorage.setItem("edu." + k, JSON.stringify(v)); } catch (e) { /* 저장 공간 부족 등 무시 */ } },
    };
    const isMobile = () => window.matchMedia("(max-width: 950px)").matches;
    const csrf = () => (typeof getCookie === "function" ? getCookie("csrf_token") : "") || "";

    // ------------------------------------------------------------------ 아이콘
    const ICONS = {
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
        download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
        box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
        paperclip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
        play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
        history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
        edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
        layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
        up: '<path d="m18 15-6-6-6 6"/>',
        down: '<path d="m6 9 6 6 6-6"/>',
        trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
        help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
        list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    };
    function icon(name) {
        return `<svg class="edu-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
    }
    function paintIcons(root = document) {
        root.querySelectorAll("#edu-app [data-icon], .edu-modal [data-icon]").forEach((el) => {
            if (!el.dataset.painted) { el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon)); el.dataset.painted = "1"; }
        });
    }

    // ------------------------------------------------------------------ 서버 통신
    async function api(path, opts = {}) {
        const method = opts.method || "GET";
        const o = { method, headers: {}, credentials: "same-origin" };
        if (method !== "GET") o.headers["X-CSRFToken"] = csrf();
        if (opts.json !== undefined) { o.body = JSON.stringify(opts.json); o.headers["Content-Type"] = "application/json"; }
        else if (opts.body !== undefined) o.body = opts.body;
        const r = await fetch(path, o);
        let data = {};
        try { data = await r.json(); } catch (e) { /* 본문 없음 */ }
        if (!r.ok || data.status === "fail") throw new Error(data.message || `요청 실패 (${r.status})`);
        return data;
    }

    /** XHR 전송 (업로드 진행률용). 성공 시 응답 JSON(없으면 {}) */
    function xhrSend(method, url, body, headers, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, url);
            Object.entries(headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
            if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
            xhr.onload = () => {
                let d = {};
                try { d = JSON.parse(xhr.responseText); } catch (e) { /* 클라우드 저장소는 빈 응답 */ }
                if (xhr.status >= 200 && xhr.status < 300 && d.status !== "fail") resolve(d);
                else {
                    const err = new Error(d.message || `업로드 실패 (${xhr.status})`);
                    err.retryable = xhr.status === 0 || xhr.status >= 500;
                    reject(err);
                }
            };
            xhr.onerror = () => reject(Object.assign(new Error("업로드 중 연결이 끊겼습니다."), { retryable: true }));
            xhr.send(body);
        });
    }

    /**
     * 파일 업로드. 반환: 저장소 키
     *  - server 모드: 서버로 조각(8MB) 단위 전송 후 완료 처리
     *  - direct 모드: 클라우드 임시 주소(Presigned URL)로 브라우저가 직접 전송
     */
    async function uploadFile(file, kind, onProgress) {
        const start = await api("/api/edu/uploads", { method: "POST", json: { kind, name: file.name || "file.bin", size: file.size } });
        const key = start.key;
        const report = (done) => onProgress && onProgress(Math.min(1, done / (file.size || 1)));
        try {
            if (start.mode === "direct") {
                await xhrSend("PUT", start.url, file, start.headers, report);
            } else {
                const cs = start.chunk_size;
                let off = 0;
                while (off < file.size) {
                    const blob = file.slice(off, off + cs);
                    for (let attempt = 1; ; attempt++) {
                        try {
                            await xhrSend("PUT", `/api/edu/uploads/${key}?offset=${off}`, blob,
                                { "X-CSRFToken": csrf(), "Content-Type": "application/octet-stream" },
                                (n) => report(off + n));
                            break;
                        } catch (e) {
                            if (!e.retryable || attempt >= 3) throw e;
                            await new Promise((res) => setTimeout(res, 1500 * attempt));
                        }
                    }
                    off += blob.size;
                    report(off);
                }
                await api(`/api/edu/uploads/${key}/complete`, { method: "POST" });
            }
            return key;
        } catch (e) {
            api(`/api/edu/uploads/${key}`, { method: "DELETE" }).catch(() => { });
            throw e;
        }
    }

    /** 브라우저에서 영상 길이와 썸네일(10% 지점, 최대 10초)을 추출 */
    function probeVideo(file) {
        return new Promise((resolve) => {
            const v = document.createElement("video");
            const url = URL.createObjectURL(file);
            let done = false;
            const finish = (thumb, dur) => {
                if (done) return; done = true;
                URL.revokeObjectURL(url); v.removeAttribute("src"); v.load();
                resolve({ thumb, duration_ms: Math.round((isFinite(dur) ? dur : 0) * 1000) });
            };
            setTimeout(() => finish(null, v.duration), 10000);
            v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
            v.onerror = () => finish(null, 0);
            v.onloadedmetadata = () => { v.currentTime = Math.min((v.duration || 0) * 0.1, 10); };
            v.onseeked = () => {
                try {
                    const w = 480, h = Math.round(480 * (v.videoHeight / v.videoWidth || 9 / 16));
                    const c = document.createElement("canvas"); c.width = w; c.height = h;
                    c.getContext("2d").drawImage(v, 0, 0, w, h);
                    c.toBlob((b) => finish(b, v.duration), "image/jpeg", 0.85);
                } catch (e) { finish(null, v.duration); }
            };
        });
    }

    // ------------------------------------------------------------------ 표시 도우미
    const fmtDur = (ms) => {
        let s = Math.floor((ms || 0) / 1000); const h = Math.floor(s / 3600); s %= 3600;
        const m = Math.floor(s / 60); s %= 60; const p = (n) => String(n).padStart(2, "0");
        return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
    };
    const fmtSize = (n) => {
        n = Number(n || 0);
        for (const u of ["B", "KB", "MB", "GB"]) {
            if (n < 1024 || u === "GB") return u === "B" || u === "KB" ? `${n.toFixed(0)} ${u}` : `${n.toFixed(1)} ${u}`;
            n /= 1024;
        }
    };
    let toastTimer;
    function toast(msg, isError = false) {
        const t = $("edu-toast"); t.textContent = msg; t.className = "edu-toast" + (isError ? " error" : ""); t.hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3000);
    }
    const showError = (e) => { if (e && /Session expired|CSRF Token expired/.test(e.message)) return; toast((e && e.message) || String(e), true); };

    // ------------------------------------------------------------------ 대화상자
    /**
     * modal({title, body, ok, cancel, danger, wide, onOk(form) -> Promise<any>, onOpen(dlg)})
     * onOk 가 예외를 던지면 창을 닫지 않고 오류 표시. 결과: onOk 반환값 / 취소 시 null
     */
    function modal({ title, body = "", ok = "확인", cancel = "취소", danger = false, wide = false, onOk, onOpen }) {
        return new Promise((resolve) => {
            const dlg = $("edu-modal"), form = $("edu-modal-form");
            $("edu-modal-title").textContent = title;
            $("edu-modal-body").innerHTML = body;
            $("edu-modal-error").hidden = true;
            const okBtn = $("edu-modal-ok"), cancelBtn = $("edu-modal-cancel");
            okBtn.textContent = ok; okBtn.hidden = !ok; okBtn.disabled = false;
            okBtn.className = "edu-btn " + (danger ? "edu-btn-danger" : "edu-btn-blue");
            cancelBtn.textContent = cancel || "닫기";
            dlg.classList.toggle("wide", wide);
            paintIcons(dlg);
            let busy = false;
            const close = (v) => { dlg.close(); cleanup(); resolve(v); };
            const onSubmit = async (e) => {
                e.preventDefault();
                if (busy) return;
                busy = true; okBtn.disabled = true; cancelBtn.disabled = true; $("edu-modal-error").hidden = true;
                try { close(onOk ? await onOk(form) : true); }
                catch (err) {
                    if (!err.silent) { $("edu-modal-error").textContent = err.message || String(err); $("edu-modal-error").hidden = false; }
                } finally { busy = false; okBtn.disabled = false; cancelBtn.disabled = false; }
            };
            const onCancel = (e) => { e.preventDefault(); if (!busy) close(null); };
            const cleanup = () => {
                form.removeEventListener("submit", onSubmit);
                cancelBtn.removeEventListener("click", onCancel);
                dlg.removeEventListener("cancel", onCancel);
                $("edu-modal-body").onclick = null;
            };
            form.addEventListener("submit", onSubmit);
            cancelBtn.addEventListener("click", onCancel);
            dlg.addEventListener("cancel", onCancel);
            dlg.showModal();
            // 모바일은 자동 포커스 시 키보드가 튀어나와 화면을 가리므로 데스크톱에서만
            if (!isMobile()) {
                const first = dlg.querySelector("#edu-modal-body input:not([type=file]), #edu-modal-body textarea");
                if (first) first.focus();
            }
            if (onOpen) onOpen(dlg);
        });
    }
    const confirmBox = (title, text, ok = "확인", danger = false) =>
        modal({ title, body: `<div class="edu-hint">${esc(text)}</div>`, ok, danger });
    const field = (label, input, top = false) => `<label class="edu-field${top ? " top" : ""}"><span>${label}</span>${input}</label>`;

    // ------------------------------------------------------------------ 상태
    const S = {
        admin: false, categories: [],
        models: [], modelId: store.get("modelId", null), model: null,
        cat: store.get("cat", "equipment"), lang: "",
        videos: [], videoId: store.get("videoId", null), playingId: null,
    };
    const curVideo = () => S.videos.find((v) => v.id === S.videoId) || null;
    const catName = (k) => (S.categories.find((c) => c.key === k) || {}).name || k;

    async function loadStatus() {
        const st = await api("/api/edu/status");
        S.admin = !!st.admin;
        S.userName = st.user_name || "";
        S.categories = st.categories;
        $("edu-model-admin").hidden = !S.admin;
        $("edu-btn-video-add").hidden = !S.admin;
        $("edu-vd-admin").hidden = !S.admin;
    }

    function showHelp() {
        modal({
            title: "교육 메뉴 도움말", ok: "", cancel: "닫기", wide: true,
            body: `<div class="edu-hint">■ 영상 보기
  설비 모델 선택 → 교육 분류(설비 / 프로그램 / 유지관리) 선택 → 영상 누르기
  PC 단축키: Space 재생/일시정지 · ←/→ 10초 이동 · F 전체화면

■ 영상 등록 (관리자)
  영상 목록 위 [＋ 영상 등록]
  수정된 영상은 [새 버전 업로드]로 올리면 이전 버전은 [버전 이력]에 보관됩니다.

■ 설비 모델 (관리자)
  [＋ 추가] / [이름 변경] / [삭제], 많은 모델은 [엑셀로 모델 일괄 등록] (A열에 모델명)

■ 첨부자료
  모델 이름 오른쪽 [첨부자료]에서 매뉴얼 등을 열거나 내려받습니다.

■ 기타
  영상은 MP4(H.264 + AAC) 형식을 권장합니다. (아이폰·안드로이드 재생 호환)</div>`,
        });
    }

    // ------------------------------------------------------------------ 모델 목록
    async function loadModels() {
        const q = $("edu-search").value.trim();
        const d = await api("/api/edu/models?q=" + encodeURIComponent(q));
        S.models = d.models;
        $("edu-model-count").textContent = q ? `${d.models.length}개 / ${d.total}개` : `${d.total}개`;
        renderModels();
    }

    function renderModels() {
        const ul = $("edu-model-list");
        if (!S.models.length) {
            ul.innerHTML = `<li class="none">${$("edu-search").value ? "검색 결과가 없습니다." : "등록된 모델이 없습니다."}</li>`;
            return;
        }
        ul.innerHTML = S.models.map((m) =>
            `<li data-id="${m.id}" class="${m.id === S.modelId ? "active" : ""}" title="${esc(m.name)}">${esc(m.name)}</li>`).join("");
        const act = ul.querySelector("li.active");
        if (act && !isMobile()) act.scrollIntoView({ block: "nearest" });
    }

    function setModelsCollapsed(on) {
        $("edu-sidebar").classList.toggle("collapsed", on);
    }

    async function selectModel(id, keepVideo = false) {
        S.modelId = id; store.set("modelId", id);
        if (!keepVideo) { S.videoId = null; store.set("videoId", null); clearPlayer(); }
        S.lang = "";
        renderModels();
        await loadModel();
    }

    async function loadModel() {
        if (S.modelId == null) { showWorkspace(false); return; }
        try {
            S.model = await api(`/api/edu/models/${S.modelId}`);
        } catch (e) {
            S.modelId = null; store.set("modelId", null); S.model = null; showWorkspace(false); return;
        }
        showWorkspace(true);
        renderModelHeader();
        await loadVideos();
    }

    function renderModelHeader() {
        $("edu-model-name").textContent = S.model.name;
        $("edu-model-info").textContent = `전체 교육 영상 ${S.model.total}개 · 등록일 ${S.model.created_at}`;
        $("edu-attach-count").textContent = `(${S.model.attachments})`;
        renderSeg();
    }

    async function refreshModelHeader() {
        S.model = await api(`/api/edu/models/${S.modelId}`);
        renderModelHeader();
    }

    function showWorkspace(on) {
        $("edu-detail").hidden = !on;
        $("edu-empty").hidden = on;
        if (!on) {
            $("edu-empty-msg").textContent = S.models.length
                ? (isMobile() ? "위 목록에서 설비 모델을 선택하세요." : "왼쪽 목록에서 설비 모델을 선택하세요.")
                : "등록된 설비 모델이 없습니다." + (S.admin ? "\n[＋ 추가] 버튼으로 모델을 추가하세요." : "");
        }
    }

    function renderSeg() {
        $("edu-seg").innerHTML = S.categories.map((c) =>
            `<button type="button" data-cat="${c.key}" class="${c.key === S.cat ? "on" : ""}">${esc(c.name)}<b>${S.model ? S.model.counts[c.key] : 0}</b></button>`).join("");
    }

    async function modelAdd() {
        const r = await modal({
            title: "설비 모델 추가",
            body: field("모델명", '<input type="text" name="name" maxlength="200" placeholder="예) COSMOS-100">'),
            ok: "추가",
            onOk: (f) => api("/api/edu/models", { method: "POST", json: { name: f.name.value } }),
        });
        if (r) { $("edu-search").value = ""; await loadModels(); await selectModel(r.id); toast("모델을 추가했습니다."); }
    }

    async function modelRename() {
        if (!S.model) return toast("이름을 바꿀 모델을 먼저 선택하세요.", true);
        const r = await modal({
            title: "모델 이름 변경",
            body: field("새 모델명", `<input type="text" name="name" maxlength="200" value="${esc(S.model.name)}">`),
            ok: "변경",
            onOk: (f) => api(`/api/edu/models/${S.modelId}`, { method: "PUT", json: { name: f.name.value } }),
        });
        if (r) { await loadModels(); await loadModel(); toast("이름을 변경했습니다."); }
    }

    async function modelDelete() {
        if (!S.model) return toast("삭제할 모델을 먼저 선택하세요.", true);
        const name = S.model.name;
        const r = await modal({
            title: "모델 삭제", ok: "삭제", danger: true,
            body: `<div class="edu-hint">'${esc(name)}' 모델과 등록된 영상 ${S.model.total}개, 첨부자료 ${S.model.attachments}개가 모두 삭제됩니다.\n되돌릴 수 없습니다. 확인을 위해 모델명을 그대로 입력하세요.</div>` +
                field("모델명 입력", '<input type="text" name="name" autocomplete="off">'),
            onOk: (f) => {
                if (f.name.value.trim() !== name) throw new Error("모델명이 일치하지 않습니다.");
                return api(`/api/edu/models/${S.modelId}`, { method: "DELETE" });
            },
        });
        if (r) {
            clearPlayer(); S.modelId = null; S.model = null; store.set("modelId", null);
            await loadModels(); showWorkspace(false); setModelsCollapsed(false);
            toast("모델을 삭제했습니다.");
        }
    }

    async function importExcel() {
        let names = null;
        const r = await modal({
            title: "엑셀로 모델 일괄 등록", ok: "불러오기",
            body: '<div class="edu-hint">첫 번째 시트의 A열에 모델명을 한 줄에 하나씩 입력한 엑셀 파일을 선택하세요. 이미 있는 모델은 건너뜁니다.\n양식은 [엑셀로 모델 일괄 등록] 오른쪽 버튼으로 내려받을 수 있습니다.</div>' +
                field("엑셀 파일", '<input type="file" name="file" accept=".xlsx,.xlsm">') + '<div id="edu-xls-preview" class="edu-hint"></div>',
            onOk: async (f) => {
                if (names) return api("/api/edu/models/bulk", { method: "POST", json: { names } });
                const file = f.file.files[0];
                if (!file) throw new Error("엑셀 파일을 선택하세요.");
                const fd = new FormData(); fd.append("file", file);
                const d = await api("/api/edu/models/import-xlsx", { method: "POST", body: fd });
                if (!d.names.length) throw new Error("첫 번째 시트의 A열에서 모델명을 찾지 못했습니다.");
                names = d.names;
                $("edu-xls-preview").textContent = `모델 ${names.length}개를 찾았습니다. [등록]을 누르면 추가합니다.\n\n` +
                    names.slice(0, 10).join("\n") + (names.length > 10 ? `\n... 외 ${names.length - 10}개` : "");
                $("edu-modal-ok").textContent = "등록";
                throw Object.assign(new Error(""), { silent: true });
            },
        });
        if (r) { await loadModels(); toast(`새로 등록 ${r.added}개 · 중복으로 건너뜀 ${r.skipped}개`); }
    }

    // ------------------------------------------------------------------ 영상 목록
    async function loadVideos(selectId) {
        if (S.modelId == null) return;
        const d = await api(`/api/edu/models/${S.modelId}/videos?category=${encodeURIComponent(S.cat)}&lang=${encodeURIComponent(S.lang)}`);
        S.videos = d.videos;
        if (selectId !== undefined) S.videoId = selectId;
        if (!S.videos.some((v) => v.id === S.videoId)) S.videoId = null;
        store.set("videoId", S.videoId);
        const sel = $("edu-lang-filter");
        sel.innerHTML = `<option value="">전체 언어</option>` + d.languages.map((l) => `<option ${l === S.lang ? "selected" : ""}>${esc(l)}</option>`).join("");
        sel.hidden = !d.languages.length && !S.lang;
        $("edu-cur-title").textContent = catName(S.cat);
        $("edu-cur-count").textContent = `${S.videos.length}개`;
        renderVideos();
        updateDetail();
    }

    function renderVideos() {
        const box = $("edu-video-list");
        if (!S.videos.length) {
            box.innerHTML = `<div class="edu-video-empty">${S.lang ? "선택한 언어의 영상이 없습니다." :
                "등록된 교육 영상이 없습니다." + (S.admin ? "\n위쪽 [＋ 영상 등록] 버튼으로 첫 영상을 추가해 보세요." : "")}</div>`;
            return;
        }
        box.innerHTML = S.videos.map((v, i) => `
            <div class="edu-vitem ${v.id === S.videoId ? "active" : ""}" data-id="${v.id}" title="${esc(v.title)}">
              <div class="thumb">
                ${v.thumb_url ? `<img src="${esc(v.thumb_url)}" loading="lazy" alt="">` : ""}
                <span class="no">${i + 1}강</span>
                ${v.duration_ms ? `<span class="dur">${fmtDur(v.duration_ms)}</span>` : ""}
                ${v.id === S.playingId ? '<span class="playing">▶ 재생 중</span>' : ""}
              </div>
              <div class="info">
                <div class="t">${esc(v.title)}</div>
                <div class="chips">
                  <span class="edu-chip edu-chip-blue">${esc(v.revision)}</span>
                  ${v.language ? `<span class="edu-chip edu-chip-slate">${esc(v.language)}</span>` : ""}
                  ${v.version_count > 1 ? `<span class="edu-chip edu-chip-orange">버전 ${v.version_count}개</span>` : ""}
                  ${v.encoding ? `<span class="edu-chip edu-chip-slate" title="용량을 줄이는 중입니다. 지금도 재생할 수 있습니다.">압축 중</span>` : ""}
                </div>
                <div class="foot">
                <div class="m">${esc([v.author, v.updated_at].filter(Boolean).join(" · "))}</div>
                <div class="views">
                  <span class="edu-view-count" title="재생 횟수 (같은 사람이 ${30}분 안에 다시 본 것은 1회)">${icon("play")} 재생 ${Number(v.view_count || 0).toLocaleString()}회</span>
                  ${S.admin ? `<button type="button" class="edu-btn edu-btn-xs" data-views="${v.id}" title="누가 언제 재생했는지 보기">${icon("history")} 기록</button>` : ""}
                </div>
                </div>
              </div>
            </div>`).join("");
    }

    /** 재생 기록 팝업 (관리자 전용) */
    async function openViews(id) {
        const v = S.videos.find((x) => x.id === id);
        const d = await api(`/api/edu/videos/${id}/views`);
        const users = d.by_user.map((u) => `<tr><td>${esc(u.user_name)} <span class="edu-hint">(${esc(u.user_id)})</span></td>
            <td class="num">${u.count}회</td><td>${esc(u.last)}</td></tr>`).join("") ||
            '<tr><td colspan="3" class="empty">재생 기록이 없습니다.</td></tr>';
        const logs = d.logs.map((r) => `<tr><td>${esc(r.created_at)}</td>
            <td>${esc(r.user_name)} <span class="edu-hint">(${esc(r.user_id)})</span></td><td>${esc(r.revision)}</td></tr>`).join("") ||
            '<tr><td colspan="3" class="empty">재생 기록이 없습니다.</td></tr>';
        await modal({
            title: `재생 기록 — ${d.title || (v && v.title) || ""}`, ok: "", cancel: "닫기", wide: true,
            body: `<div class="edu-views-summary">
                    <div><b>${d.total.toLocaleString()}</b><span>총 재생</span></div>
                    <div><b>${d.viewers.toLocaleString()}</b><span>재생한 사람</span></div>
                   </div>
                   <div class="edu-hint">같은 사람이 같은 영상을 ${d.dedup_minutes}분 안에 다시 연 것은 1회로 계산합니다.</div>
                   <div class="edu-views-title">사람별</div>
                   <div class="edu-scroll short"><table class="edu-table"><thead><tr><th>이름 (아이디)</th><th class="num">횟수</th><th>마지막 재생</th></tr></thead><tbody>${users}</tbody></table></div>
                   <div class="edu-views-title">재생 시각${d.total > d.logs.length ? ` (최근 ${d.logs.length}건)` : ""}</div>
                   <div class="edu-scroll short"><table class="edu-table"><thead><tr><th>재생 시각</th><th>이름 (아이디)</th><th>버전</th></tr></thead><tbody>${logs}</tbody></table></div>`,
        });
    }

    // ------------------------------------------------------------------ 저장소 현황 (관리자)
    const fmtBytes = (b) => {
        b = Number(b || 0);
        if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + " GB";
        if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + " MB";
        return Math.round(b / 1024) + " KB";
    };
    const won = (n) => Number(n || 0).toLocaleString() + "원";
    const ENC_LABEL = { "": "압축 전", wait: "압축 대기", work: "압축 중", done: "압축됨", skip: "원본 유지", fail: "압축 실패" };

    function usageHtml(d) {
        const kinds = [["videos", "영상"], ["thumbs", "썸네일"], ["attachments", "첨부자료"], ["other", "기타"]]
            .filter(([k]) => d.files[k] && (k !== "other" || d.files[k].count))
            .map(([k, n]) => `<tr><td>${n}</td><td class="num">${d.files[k].count.toLocaleString()}개</td><td class="num">${fmtBytes(d.files[k].bytes)}</td></tr>`).join("");
        const maxDay = Math.max(1, ...d.daily.map((x) => x.bytes));
        const daily = d.daily.map((x) => `<tr><td>${esc(x.day)}</td><td class="num">${x.plays.toLocaleString()}회</td>
            <td class="num">${fmtBytes(x.bytes)}</td><td class="edu-bar-cell"><i style="width:${Math.max(2, x.bytes / maxDay * 100)}%"></i></td></tr>`).join("") ||
            '<tr><td colspan="4" class="empty">이번 달 재생 기록이 없습니다.</td></tr>';
        const top = d.top.map((x) => `<tr><td>${esc(x.model)}</td><td>${esc(x.title)} <span class="edu-hint">${esc(x.revision)}</span></td>
            <td>${ENC_LABEL[x.state] || x.state}</td><td class="num">${fmtBytes(x.bytes)}</td></tr>`).join("") ||
            '<tr><td colspan="4" class="empty">영상이 없습니다.</td></tr>';
        const e = d.encode;
        const encTxt = [e.working && `압축 중 ${e.working}`, e.pending && `대기 ${e.pending}`, e.fail && `실패 ${e.fail}`].filter(Boolean).join(" · ") || "대기 없음";
        return `<div class="edu-usage-head">
                <span>${d.storage === "s3" ? `클라우드 버킷 <b>${esc(d.bucket)}</b>` : "서버 디스크 (로컬)"} · ${esc(d.checked_at)} 기준 · 30초마다 자동 갱신</span>
                <button type="button" class="edu-btn edu-btn-xs" data-usage-refresh>${icon("history")} 지금 새로고침</button>
              </div>
              <div class="edu-views-summary edu-usage-cards">
                <div><b>${fmtBytes(d.storage_bytes)}</b><span>전체 저장 용량</span></div>
                <div><b>${fmtBytes(d.traffic_bytes)}</b><span>${esc(d.month)} 재생 전송량 (추정)</span></div>
                <div><b>${d.plays.toLocaleString()}회</b><span>이번 달 재생 · 오늘 ${d.today.plays.toLocaleString()}회</span></div>
                <div><b>${won(d.cost.projected)}</b><span>이번 달 예상 비용 (지금까지 ${won(d.cost.now)})</span></div>
              </div>
              <div class="edu-hint">
                모델 ${d.counts.models}개 · 영상 ${d.counts.videos}개 (버전 ${d.counts.versions}개) · 첨부자료 ${d.counts.attachments}개 · 자동 압축: ${encTxt}<br>
                전송량은 재생 기록 × 영상 크기로 계산한 <b>최대 추정치</b>입니다 (중간에 끄면 실제는 더 적음). 정확한 청구 금액은 NCP 콘솔 › 비용 관리에서 확인하세요.<br>
                압축용 내려받기는 이번 달 올린 영상 원본 크기 합계입니다 (서버가 압축하려고 클라우드에서 한 번 내려받음). 단가는 .env 의 EDU_PRICE_* 에서 변경
              </div>
              <div class="edu-views-title">이번 달 비용 구성 (VAT 별도)</div>
              <table class="edu-table"><thead><tr><th>항목</th><th class="num">사용량</th><th class="num">단가</th><th class="num">지금까지</th><th class="num">월 예상</th></tr></thead><tbody>
                <tr><td>저장</td><td class="num">${fmtBytes(d.storage_bytes)}</td><td class="num">${won(d.price.storage_gb)}/GB·월</td><td class="num">${won(d.cost.storage)}</td><td class="num">${won(d.cost.storage)}</td></tr>
                <tr><td>재생 전송 (추정)</td><td class="num">${fmtBytes(d.traffic_bytes)}</td><td class="num">${won(d.price.traffic_gb)}/GB</td><td class="num">${won(d.cost.play)}</td><td class="num">${won(d.cost.play_projected)}</td></tr>
                <tr><td>압축용 내려받기</td><td class="num">${fmtBytes(d.encode_bytes)}</td><td class="num">${won(d.price.encode_gb)}/GB</td><td class="num">${won(d.cost.encode)}</td><td class="num">${won(d.cost.encode)}</td></tr>
                <tr class="sum"><td>합계</td><td></td><td></td><td class="num">${won(d.cost.now)}</td><td class="num">${won(d.cost.projected)}</td></tr>
              </tbody></table>
              <div class="edu-views-title">저장 용량 구성</div>
              <table class="edu-table"><thead><tr><th>종류</th><th class="num">파일</th><th class="num">용량</th></tr></thead><tbody>${kinds}</tbody></table>
              <div class="edu-views-title">이번 달 일별 재생 · 전송량</div>
              <div class="edu-scroll short"><table class="edu-table"><thead><tr><th>날짜</th><th class="num">재생</th><th class="num">전송량</th><th></th></tr></thead><tbody>${daily}</tbody></table></div>
              <div class="edu-views-title">용량이 큰 영상 TOP 10</div>
              <div class="edu-scroll short"><table class="edu-table"><thead><tr><th>모델</th><th>영상</th><th>압축</th><th class="num">용량</th></tr></thead><tbody>${top}</tbody></table></div>`;
    }

    async function openUsage() {
        let d = await api("/api/edu/usage");
        let timer = null, loading = false;
        const load = async (force) => {
            if (loading) return;
            loading = true;
            try {
                d = await api("/api/edu/usage" + (force ? "?refresh=1" : ""));
                const body = $("edu-modal-body");
                const top = body.scrollTop;
                body.innerHTML = usageHtml(d);
                body.scrollTop = top;
            } catch (e) { toast(e.message || String(e), true); }
            finally { loading = false; }
        };
        await modal({
            title: "저장소 사용량 · 예상 비용", ok: "", cancel: "닫기", wide: true, body: usageHtml(d),
            onOpen: () => {
                $("edu-modal-body").onclick = (e) => { if (e.target.closest("[data-usage-refresh]")) load(true); };
                timer = setInterval(() => { if (!document.hidden) load(false); }, 30000);
            },
        });
        clearInterval(timer);
    }

    function updateDetail() {
        const v = curVideo();
        $("edu-vd-title").textContent = v ? v.title : "선택된 교육 영상이 없습니다";
        $("edu-vd-rev").hidden = !v; $("edu-vd-lang").hidden = !(v && v.language);
        if (v) { $("edu-vd-rev").textContent = v.revision; $("edu-vd-lang").textContent = v.language; }
        $("edu-vd-desc").textContent = v ? v.description : "";
        $("edu-vd-desc").hidden = !(v && v.description);
        $("edu-vd-bottom").hidden = $("edu-vd-desc").hidden && !S.admin;
        const idx = v ? S.videos.indexOf(v) : -1;
        for (const id of ["edu-vd-play", "edu-vd-hist", "edu-vd-edit", "edu-vd-ver", "edu-vd-del"]) $(id).disabled = !v;
        $("edu-vd-up").disabled = !v || idx <= 0 || !!S.lang;
        $("edu-vd-down").disabled = !v || idx >= S.videos.length - 1 || !!S.lang;
    }

    function selectVideo(id, play = false) {
        S.videoId = id; store.set("videoId", id);
        document.querySelectorAll("#edu-video-list .edu-vitem").forEach((el) => el.classList.toggle("active", Number(el.dataset.id) === id));
        updateDetail();
        if (play) playVideo(curVideo());
    }

    // ------------------------------------------------------------------ 플레이어
    // 플레이어 상태 (임시 주소 만료 시 자동 복구용)
    const P = { baseSrc: "", lastTime: 0, wantPlay: false, recovering: false, lastRecover: 0, countPending: false };

    function playVideo(v, url, label) {
        if (!v) return;
        const video = $("edu-video");
        P.baseSrc = url || v.file_url; P.lastTime = 0; P.wantPlay = true; P.lastRecover = 0; P.countPending = true;
        video.src = P.baseSrc;
        video.hidden = false;
        $("edu-player-placeholder").hidden = true;
        $("edu-player-badge").textContent = "재생 중";
        $("edu-player-title").textContent = label || `${v.title} · ${v.revision}`;
        S.playingId = url ? null : v.id;
        video.play().catch(() => { /* 자동재생 차단 시 사용자가 직접 재생 */ });
        renderVideos();
        if (isMobile()) document.querySelector(".edu-player").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function clearPlayer() {
        const video = $("edu-video");
        P.baseSrc = ""; P.countPending = false; P.wantPlay = false;
        video.pause(); video.removeAttribute("src"); video.load();
        video.hidden = true;
        $("edu-player-placeholder").hidden = false;
        $("edu-player-badge").textContent = "대기";
        $("edu-player-title").textContent = "영상을 선택해 주세요";
        S.playingId = null;
    }

    function toggleFullscreen() {
        const v = $("edu-video");
        if (document.fullscreenElement) return document.exitFullscreen();
        if (v.requestFullscreen) return v.requestFullscreen();
        if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari
    }

    // ------------------------------------------------------------------ 영상 등록/수정
    const LANGUAGES = ["한국어", "영어", "중국어"];

    function langOptions(current = "") {
        const list = current && !LANGUAGES.includes(current) ? [...LANGUAGES, current] : LANGUAGES;
        const sel = current || LANGUAGES[0];
        return `<select name="lang">${list.map((l) => `<option ${l === sel ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    }

    const UPLOAD_BOX = `<div class="edu-upload-box" hidden><div class="edu-progress"><div id="edu-up-prog"></div></div><div class="edu-hint" id="edu-up-msg"></div></div>`;

    function progressUI() {
        const bar = $("edu-up-prog"), msg = $("edu-up-msg");
        bar.closest(".edu-upload-box").hidden = false;
        bar.style.width = "0%";
        return {
            text: (t) => { msg.textContent = t; },
            set: (p, t) => { bar.style.width = `${Math.round(p * 100)}%`; msg.textContent = t; },
        };
    }

    /** 영상 1개 업로드: 길이·썸네일 추출 → 영상 → 썸네일 */
    async function uploadVideoWithThumb(file) {
        const ui = progressUI();
        ui.text("영상 정보 읽는 중...");
        const info = await probeVideo(file);
        const videoKey = await uploadFile(file, "videos", (p) =>
            ui.set(p, `영상 올리는 중... ${Math.round(p * 100)}%  (${fmtSize(file.size * p)} / ${fmtSize(file.size)})`));
        let thumbKey = "";
        if (info.thumb) {
            try { thumbKey = await uploadFile(new File([info.thumb], "thumb.jpg", { type: "image/jpeg" }), "thumbs"); } catch (e) { /* 썸네일 없이 진행 */ }
        }
        ui.text("저장 중...");
        return { video_key: videoKey, thumb_key: thumbKey, duration_ms: info.duration_ms, original_name: file.name };
    }

    function checkVideoFile(file) {
        if (!file) throw new Error("영상 파일을 선택하세요.");
        if (!/\.(mp4|m4v)$/i.test(file.name) && !confirm("MP4(H.264) 형식이 아닌 영상은 브라우저(특히 모바일)에서 재생되지 않을 수 있습니다.\n그래도 등록할까요?")) {
            throw new Error("등록을 취소했습니다.");
        }
    }

    async function videoAdd() {
        if (S.modelId == null) return;
        const r = await modal({
            title: `새 교육 영상 등록 — ${catName(S.cat)}`, ok: "등록하기",
            body: field("제목 *", '<input type="text" name="title" maxlength="300" placeholder="예) 1강. 설비 개요 및 안전 수칙">') +
                field("설명", '<textarea name="desc" maxlength="5000"></textarea>', true) +
                field("작성자", `<input type="text" name="author" maxlength="100" value="${esc(S.userName)}">`) +
                field("언어", langOptions()) +
                field("영상 파일 *", '<input type="file" name="file" accept="video/*">') + UPLOAD_BOX,
            onOk: async (f) => {
                if (!f.title.value.trim()) throw new Error("제목을 입력하세요.");
                const file = f.file.files[0];
                checkVideoFile(file);
                const up = await uploadVideoWithThumb(file);
                return api(`/api/edu/models/${S.modelId}/videos`, {
                    method: "POST",
                    json: { category: S.cat, title: f.title.value, description: f.desc.value, author: f.author.value, language: f.lang.value, revision: "Rev.1", ...up },
                });
            },
        });
        if (r) { await refreshModelHeader(); await loadVideos(r.id); toast("영상을 등록했습니다."); }
    }

    async function videoEdit() {
        const v = curVideo(); if (!v) return;
        const r = await modal({
            title: `영상 정보 수정 — ${catName(v.category)}`, ok: "저장",
            body: field("제목 *", `<input type="text" name="title" maxlength="300" value="${esc(v.title)}">`) +
                field("설명", `<textarea name="desc" maxlength="5000">${esc(v.description)}</textarea>`, true) +
                field("작성자", `<input type="text" name="author" maxlength="100" value="${esc(v.author)}">`) +
                field("언어", langOptions(v.language)),
            onOk: (f) => api(`/api/edu/videos/${v.id}`, { method: "PUT", json: { title: f.title.value, description: f.desc.value, author: f.author.value, language: f.lang.value } }),
        });
        if (r) { await loadVideos(v.id); toast("저장했습니다."); }
    }

    function nextRevision(rev) {
        const m = /(\d+)(?!.*\d)/.exec(rev || "");
        if (!m) return rev ? `${rev} 2` : "Rev.2";
        return rev.slice(0, m.index) + (Number(m[1]) + 1) + rev.slice(m.index + m[1].length);
    }

    async function videoNewVersion() {
        const v = curVideo(); if (!v) return;
        const r = await modal({
            title: `새 버전 업로드 — ${v.title}`, ok: "업로드",
            body: `<div class="edu-hint">현재 버전: ${esc(v.revision)} · 이전 버전은 '버전 이력'에 보관됩니다.</div>` +
                field("새 버전(Rev.)", `<input type="text" name="rev" maxlength="50" value="${esc(nextRevision(v.revision))}">`) +
                field("작성자", `<input type="text" name="author" maxlength="100" value="${esc(S.userName || v.author)}">`) +
                field("변경 내용", '<input type="text" name="note" maxlength="1000" placeholder="변경 내용 요약 (선택)">') +
                field("영상 파일 *", '<input type="file" name="file" accept="video/*">') + UPLOAD_BOX,
            onOk: async (f) => {
                if (!f.rev.value.trim()) throw new Error("버전(Rev.)을 입력하세요.");
                const file = f.file.files[0];
                checkVideoFile(file);
                const up = await uploadVideoWithThumb(file);
                return api(`/api/edu/videos/${v.id}/versions`, { method: "POST", json: { revision: f.rev.value, author: f.author.value, note: f.note.value, ...up } });
            },
        });
        if (r) { await loadVideos(v.id); toast("새 버전을 올렸습니다."); }
    }

    async function videoMove(step) {
        const v = curVideo(); if (!v) return;
        await api(`/api/edu/videos/${v.id}/move`, { method: "POST", json: { step } });
        await loadVideos(v.id);
    }

    async function videoDelete() {
        const v = curVideo(); if (!v) return;
        const ok = await confirmBox("영상 삭제", `'${v.title}' 영상을 삭제할까요?\n모든 버전(${v.version_count}개)과 파일이 함께 삭제됩니다.`, "삭제", true);
        if (!ok) return;
        if (S.playingId === v.id) clearPlayer();
        await api(`/api/edu/videos/${v.id}`, { method: "DELETE" });
        await refreshModelHeader(); await loadVideos(null); toast("영상을 삭제했습니다.");
    }

    async function videoHistory() {
        const v = curVideo(); if (!v) return;
        let versions = [];
        const render = async () => {
            versions = (await api(`/api/edu/videos/${v.id}/versions`)).versions;
            return `<div class="edu-scroll"><table class="edu-table"><thead><tr><th>버전</th><th>작성자</th><th>등록일</th><th class="edu-hide-sm">길이</th><th class="edu-hide-sm">크기</th><th class="edu-hide-sm">변경 내용</th><th></th></tr></thead><tbody>` +
                versions.map((r, i) => `<tr>
                    <td><b>${esc(r.revision)}</b>${i === 0 ? ' <span class="edu-chip edu-chip-blue">현재</span>' : ""}</td>
                    <td>${esc(r.author || "-")}</td><td>${esc(r.created_at)}</td>
                    <td class="edu-hide-sm">${r.duration_ms ? fmtDur(r.duration_ms) : "-"}</td><td class="edu-hide-sm">${fmtSize(r.file_size)}</td>
                    <td class="edu-hide-sm">${esc(r.note || "")}</td>
                    <td class="actions">
                      <button type="button" class="edu-btn" data-play="${i}">${icon("play")} 재생</button>
                      ${S.admin && i > 0 ? `<button type="button" class="edu-btn edu-btn-danger-soft" data-del="${r.id}" data-rev="${esc(r.revision)}">삭제</button>` : ""}
                    </td></tr>`).join("") + "</tbody></table></div>";
        };
        await modal({
            title: `버전 이력 — ${v.title}`, ok: "", cancel: "닫기", wide: true, body: await render(),
            onOpen: (dlg) => {
                const body = $("edu-modal-body");
                body.onclick = async (e) => {
                    const p = e.target.closest("[data-play]"), d = e.target.closest("[data-del]");
                    if (p) {
                        const r = versions[Number(p.dataset.play)];
                        $("edu-modal-cancel").click();
                        playVideo(v, p.dataset.play === "0" ? undefined : r.file_url,
                            `${v.title} · ${r.revision}` + (p.dataset.play === "0" ? "" : " (이전 버전)"));
                    } else if (d) {
                        if (!confirm(`${d.dataset.rev} 버전을 삭제할까요?\n영상 파일도 함께 삭제됩니다.`)) return;
                        try {
                            await api(`/api/edu/versions/${d.dataset.del}`, { method: "DELETE" });
                            body.innerHTML = await render();
                            await loadVideos(v.id);
                        } catch (err) { showError(err); }
                    }
                };
            },
        });
    }

    // ------------------------------------------------------------------ 첨부자료
    async function openAttachments() {
        if (!S.model) return;
        const render = async () => {
            const d = await api(`/api/edu/models/${S.modelId}/attachments`);
            const rows = d.attachments.map((a) => `<tr>
                <td>${icon("file")} <b>${esc(a.title)}</b><div class="edu-hint">${esc(a.original_name)}</div></td>
                <td class="edu-hide-sm">${fmtSize(a.file_size)}</td><td class="edu-hide-sm">${esc(a.created_at)}</td>
                <td class="actions">
                  <a class="edu-btn" href="${esc(a.view_url)}" target="_blank" rel="noopener">열기</a>
                  <a class="edu-btn" href="${esc(a.url)}">${icon("download")} 받기</a>
                  ${S.admin ? `<button type="button" class="edu-btn edu-btn-danger-soft" data-del="${a.id}" data-title="${esc(a.title)}">삭제</button>` : ""}
                </td></tr>`).join("") || '<tr><td colspan="4" class="empty">등록된 첨부자료가 없습니다.</td></tr>';
            const add = S.admin ? `<div class="edu-att-add"><span class="edu-att-add-label">자료 추가</span>
                <div class="edu-att-add-row"><input type="text" id="edu-att-title" maxlength="300" placeholder="표시 이름 (비우면 파일명)">
                <input type="file" id="edu-att-file"><button type="button" class="edu-btn edu-btn-primary" id="edu-att-add">${icon("plus")} 추가</button></div></div>` + UPLOAD_BOX : "";
            return `<div class="edu-scroll"><table class="edu-table"><thead><tr><th>자료</th><th class="edu-hide-sm">크기</th><th class="edu-hide-sm">등록일</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${add}`;
        };
        await modal({
            title: `첨부자료 — ${S.model.name}`, ok: "", cancel: "닫기", wide: true, body: await render(),
            onOpen: () => {
                const body = $("edu-modal-body");
                let busy = false;
                body.onclick = async (e) => {
                    const d = e.target.closest("[data-del]");
                    if (busy) return;
                    try {
                        if (d) {
                            if (!confirm(`'${d.dataset.title}' 첨부자료를 삭제할까요?`)) return;
                            busy = true;
                            await api(`/api/edu/attachments/${d.dataset.del}`, { method: "DELETE" });
                        } else if (e.target.closest("#edu-att-add")) {
                            const file = $("edu-att-file").files[0];
                            if (!file) return toast("추가할 파일을 선택하세요.", true);
                            busy = true;
                            const ui = progressUI();
                            const key = await uploadFile(file, "attachments", (p) => ui.set(p, `올리는 중... ${Math.round(p * 100)}%`));
                            await api(`/api/edu/models/${S.modelId}/attachments`, { method: "POST", json: { title: $("edu-att-title").value, file_key: key, original_name: file.name } });
                        } else return;
                        body.innerHTML = await render();
                        await refreshModelHeader();
                    } catch (err) { showError(err); } finally { busy = false; }
                };
            },
        });
    }

    // ------------------------------------------------------------------ 레이아웃 (목록 | 플레이어 폭 조절, PC 전용)
    function initSplitter() {
        const sp = $("edu-splitter"), studio = $("edu-studio");
        studio.style.setProperty("--edu-cur-w", `${store.get("ratioH", 42)}%`);
        sp.addEventListener("pointerdown", (e) => {
            if (isMobile()) return;
            e.preventDefault(); sp.setPointerCapture(e.pointerId);
            const rect = studio.getBoundingClientRect();
            const move = (ev) => {
                const r = Math.round(Math.min(Math.max((ev.clientX - rect.left) / rect.width * 100, 22), 75));
                studio.style.setProperty("--edu-cur-w", `${r}%`);
                store.set("ratioH", r);
            };
            const up = () => { sp.removeEventListener("pointermove", move); sp.removeEventListener("pointerup", up); sp.removeEventListener("pointercancel", up); };
            sp.addEventListener("pointermove", move); sp.addEventListener("pointerup", up); sp.addEventListener("pointercancel", up);
        });
    }

    // ------------------------------------------------------------------ 이벤트 연결
    function bind() {
        const on = (id, fn) => $(id).addEventListener("click", () => Promise.resolve().then(fn).catch(showError));
        on("edu-btn-help", showHelp);
        on("edu-btn-models-toggle", () => setModelsCollapsed(!$("edu-sidebar").classList.contains("collapsed")));
        on("edu-btn-model-add", modelAdd);
        on("edu-btn-model-rename", modelRename);
        on("edu-btn-model-del", modelDelete);
        on("edu-btn-excel", importExcel);
        on("edu-btn-usage", () => openUsage().catch(showError));
        on("edu-btn-attach", openAttachments);
        on("edu-btn-video-add", videoAdd);
        on("edu-vd-play", () => playVideo(curVideo()));
        on("edu-vd-hist", videoHistory);
        on("edu-vd-edit", videoEdit);
        on("edu-vd-ver", videoNewVersion);
        on("edu-vd-up", () => videoMove(-1));
        on("edu-vd-down", () => videoMove(1));
        on("edu-vd-del", videoDelete);

        // click 은 스크롤(터치 이동) 시 발생하지 않으므로 모바일 목록 스크롤 중 오선택 없음
        $("edu-model-list").addEventListener("click", (e) => {
            const li = e.target.closest("li[data-id]");
            if (!li) return;
            selectModel(Number(li.dataset.id)).then(() => { if (isMobile()) setModelsCollapsed(true); }).catch(showError);
        });
        $("edu-seg").addEventListener("click", (e) => {
            const b = e.target.closest("button[data-cat]");
            if (!b || b.dataset.cat === S.cat) return;
            S.cat = b.dataset.cat; store.set("cat", S.cat); S.lang = "";
            renderSeg(); loadVideos().catch(showError);
        });
        $("edu-video-list").addEventListener("click", (e) => {
            const vb = e.target.closest("[data-views]");
            if (vb) { e.stopPropagation(); openViews(Number(vb.dataset.views)).catch(showError); return; }
            const it = e.target.closest(".edu-vitem");
            if (it) selectVideo(Number(it.dataset.id), true);
        });
        $("edu-lang-filter").addEventListener("change", (e) => { S.lang = e.target.value; loadVideos().catch(showError); });
        let t;
        $("edu-search").addEventListener("input", () => {
            clearTimeout(t); t = setTimeout(() => loadModels().catch(showError), 200);
            if (isMobile()) setModelsCollapsed(false);
        });

        // 재생 중 임시 주소가 만료되면(클라우드 저장소) 새 주소를 받아 보던 위치부터 이어서 재생
        const video = $("edu-video");
        video.addEventListener("timeupdate", () => { if (video.currentTime > 0) P.lastTime = video.currentTime; });
        video.addEventListener("play", () => { P.wantPlay = true; });
        video.addEventListener("pause", () => { if (!P.recovering) P.wantPlay = false; });
        video.addEventListener("playing", () => {
            P.recovering = false;
            // 재생 횟수 갱신 (재생 시작 후 한 번)
            if (P.countPending) { P.countPending = false; setTimeout(() => loadVideos(S.videoId).catch(() => { }), 1500); }
        });
        video.addEventListener("error", () => {
            if (!P.baseSrc) return;
            const now = Date.now();
            if (now - P.lastRecover > 15000) {
                P.lastRecover = now; P.recovering = true;
                const at = P.lastTime;
                video.src = P.baseSrc + (P.baseSrc.includes("?") ? "&" : "?") + "r=" + now;
                video.addEventListener("loadedmetadata", () => {
                    if (at) video.currentTime = at;
                    if (P.wantPlay) video.play().catch(() => { });
                }, { once: true });
                return;
            }
            P.recovering = false;
            toast("영상을 재생할 수 없습니다. 파일이 없거나 지원하지 않는 형식입니다 (MP4 권장).", true);
        });

        // PC 단축키: Space 재생/일시정지, ←/→ 10초, F 전체화면
        document.addEventListener("keydown", (e) => {
            if ($("edu-modal").open || document.querySelector(".modal-overlay[style*='flex']")) return;
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
            const v = $("edu-video");
            if (!v.getAttribute("src")) return;
            if (e.code === "Space" && e.target !== v) { e.preventDefault(); v.paused ? v.play() : v.pause(); }
            else if (e.key === "ArrowLeft" && e.target !== v) { v.currentTime = Math.max(0, v.currentTime - 10); }
            else if (e.key === "ArrowRight" && e.target !== v) { v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); }
            else if (e.key === "f" || e.key === "F") { toggleFullscreen(); }
        });
    }

    // ------------------------------------------------------------------ 시작
    async function start() {
        if (!$("edu-app")) return;
        paintIcons();
        bind();
        initSplitter();
        try {
            await loadStatus();
            if (!S.categories.some((c) => c.key === S.cat)) S.cat = S.categories[0].key;
            await loadModels();
            if (S.modelId != null && S.models.some((m) => m.id === S.modelId)) {
                await selectModel(S.modelId, true);
                if (isMobile()) setModelsCollapsed(true);
            } else showWorkspace(false);
        } catch (e) {
            $("edu-empty-msg").textContent = "교육 자료를 불러오지 못했습니다.\n" + ((e && e.message) || "");
            showError(e);
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
