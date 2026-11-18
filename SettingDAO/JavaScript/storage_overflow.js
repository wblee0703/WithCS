/* ==========================================================================
   localStorage 용량 초과 보완 (모든 페이지에서 가장 먼저 로드)
   --------------------------------------------------------------------------
   서버 데이터(/api/data)를 localStorage 에 그대로 저장하는데, 장비가 많아지면서
   브라우저 한도(약 5MB)를 넘어 일부 장비(details_*) 데이터가 저장되지 않았음.
   → 캘린더·대시보드에서 해당 사업장 일정이 사라지는 문제가 발생.

   - 한도를 넘는 값은 버리지 않고 메모리(overflow)에 보관 (페이지가 열려 있는 동안 유지,
     페이지를 새로 열면 서버에서 다시 받아옴)
   - 화면 상태 같은 작은 키가 한도에 걸리면 details_* 를 메모리로 옮겨 자리를 만든 뒤 저장
     (새로고침 후에도 유지되어야 하는 설정값 보존)
   - getItem / setItem / removeItem / clear / key / length 가 메모리 값까지 함께 처리
   - Object.keys(localStorage) 대신 window.localStorageKeys() 사용
   ========================================================================== */
(function () {
    if (window.__storageOverflowInstalled) return;
    window.__storageOverflowInstalled = true;

    let ls;
    try { ls = window.localStorage; } catch (e) { return; }
    if (!ls || typeof Storage === 'undefined') return;

    const proto = Storage.prototype;
    const origSet = proto.setItem;
    const origGet = proto.getItem;
    const origRemove = proto.removeItem;
    const origClear = proto.clear;
    const origKey = proto.key;
    const lengthDesc = Object.getOwnPropertyDescriptor(proto, 'length');
    const origLength = (s) => lengthDesc.get.call(s);

    const overflow = new Map();
    let warned = false;

    const isLocal = (s) => s === ls;
    const isQuotaError = (e) => e && (
        e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        e.code === 22 || e.code === 1014);

    // 실제 저장소의 details_* 키 몇 개를 메모리로 옮겨 자리 확보
    const spillDetails = (count) => {
        const keys = [];
        for (let i = 0; i < origLength(ls) && keys.length < count; i++) {
            const k = origKey.call(ls, i);
            if (k && k.startsWith('details_')) keys.push(k);
        }
        keys.forEach(k => {
            overflow.set(k, origGet.call(ls, k));
            origRemove.call(ls, k);
        });
        return keys.length;
    };

    proto.setItem = function (key, value) {
        if (!isLocal(this)) return origSet.call(this, key, value);
        key = String(key);
        value = String(value);
        try {
            origSet.call(this, key, value);
            overflow.delete(key);
            return;
        } catch (e) {
            if (!isQuotaError(e)) throw e;
        }
        // 화면 상태 등 작은 키는 details_* 를 비워 실제 저장소에 보관 (최대 5회 시도)
        if (!key.startsWith('details_')) {
            for (let tries = 0; tries < 5; tries++) {
                if (spillDetails(20) === 0) break;
                try {
                    origSet.call(this, key, value);
                    overflow.delete(key);
                    return;
                } catch (e2) {
                    if (!isQuotaError(e2)) throw e2;
                }
            }
        }
        try { origRemove.call(this, key); } catch (e3) { }
        overflow.set(key, value);
        if (!warned) {
            warned = true;
            console.warn('[storage] localStorage 용량 초과 → 일부 데이터는 메모리에 보관합니다.');
        }
    };

    proto.getItem = function (key) {
        if (isLocal(this)) {
            key = String(key);
            if (overflow.has(key)) return overflow.get(key);
        }
        return origGet.call(this, key);
    };

    proto.removeItem = function (key) {
        if (isLocal(this)) overflow.delete(String(key));
        return origRemove.call(this, key);
    };

    proto.clear = function () {
        if (isLocal(this)) overflow.clear();
        return origClear.call(this);
    };

    proto.key = function (index) {
        if (!isLocal(this)) return origKey.call(this, index);
        const base = origLength(this);
        if (index < base) return origKey.call(this, index);
        const extra = Array.from(overflow.keys());
        return extra[index - base] !== undefined ? extra[index - base] : null;
    };

    Object.defineProperty(proto, 'length', {
        configurable: true,
        enumerable: lengthDesc.enumerable,
        get: function () {
            return origLength(this) + (isLocal(this) ? overflow.size : 0);
        }
    });

    // Object.keys(localStorage) 대체 (메모리 보관 키 포함)
    window.localStorageKeys = function () {
        const keys = [];
        for (let i = 0; i < ls.length; i++) keys.push(ls.key(i));
        return keys;
    };
})();
