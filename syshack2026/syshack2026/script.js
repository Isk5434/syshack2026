// ── API設定 ─────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.PROD
    ? "https://syshack2026.onrender.com"
    : "http://localhost:8001";

// ── ローカルデータ（フォールバック用） ──────────────────────────────────
const posts = {
    1: [{ level: 2, text: "日替わりのハンバーグが美味しかったです！" }],
    2: [], 3: [], 4: [], 5: [], 6: [], 7: []
};

const locationNames = {
    1: "アロハカフェ",
    2: "キッチンカー（セントラル前）",
    3: "AITプラザ",
    4: "四号館売店",
    5: "キッチンカー（四号館前）",
    6: "愛和会館",
    7: "セントラル食堂"
};

// 画像マップの元座標 (cx, cy) – オーバーレイドット配置に使用
const locationCoords = {
    1: [487, 480],
    2: [758, 440],
    3: [612, 414],
    4: [910, 423],
    5: [544, 538],
    6: [1067, 456],
    7: [1354, 317]
};

const crowdLabels = { 1: "空いている", 2: "普通", 3: "混雑" };
const crowdClasses = { 1: "crowd-low", 2: "crowd-mid", 3: "crowd-high" };
const dotClasses = { 1: "dot-low", 2: "dot-mid", 3: "dot-high" };

// 現在選択中の場所
let selectedLocationId = null;

// ── API呼び出しヘルパー ─────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
    try {
        const res = await fetch(API_BASE + path, {
            ...options,
            headers: { "Content-Type": "application/json", ...options.headers },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.warn("API通信エラー:", e.message);
        return null;
    }
}

// ── 予測の取得と表示 ────────────────────────────────────────────────────

async function loadAllPredictions() {
    const predictions = await apiFetch("/crowd/predict");
    if (predictions) {
        updateMapOverlay(predictions);
    }
}

function updateMapOverlay(predictions) {
    const overlay = document.getElementById("map-overlay");
    const img = document.getElementById("campus-map");
    if (!img.complete || img.naturalWidth === 0) return;

    overlay.innerHTML = "";

    const { rw, rh, ox, oy } = getImageRect(img);
    const xr = rw / img.naturalWidth;
    const yr = rh / img.naturalHeight;

    predictions.forEach(p => {
        const coords = locationCoords[p.location_id];
        if (!coords) return;

        const dot = document.createElement("div");
        dot.className = `map-dot ${dotClasses[p.level_int] || "dot-mid"}`;
        dot.style.left = `${Math.round(coords[0] * xr + ox)}px`;
        dot.style.top = `${Math.round(coords[1] * yr + oy)}px`;
        dot.title = `${p.location_name}: ${p.label}`;
        overlay.appendChild(dot);
    });
}

async function showPrediction(locationId, day = null, hour = null) {
    const dayParam = day !== null && day >= 0 ? `&day=${day}` : "";
    const hourParam = hour !== null && hour >= 0 ? `&hour=${hour}` : "";
    const query = (dayParam || hourParam) ? `?${dayParam}${hourParam}`.replace("?&", "?") : "";

    const prediction = await apiFetch(`/crowd/predict/${locationId}${query}`);

    const section = document.getElementById("info-prediction");
    const badge = document.getElementById("prediction-badge");
    const confidence = document.getElementById("prediction-confidence");

    if (prediction) {
        section.style.display = "block";

        const cls = crowdClasses[prediction.level_int] || "crowd-mid";
        badge.className = `prediction-badge ${cls}`;
        badge.textContent = prediction.label;

        if (prediction.data_points > 0) {
            confidence.textContent = `${prediction.data_points}件の投稿データに基づく予測`;
        } else {
            confidence.textContent = "時間帯パターンに基づく予測";
        }
    } else {
        section.style.display = "none";
    }
}

// ── 場所をクリック ──────────────────────────────────────────────────────

async function selectLocation(id, name) {
    selectedLocationId = id;
    document.getElementById("location").value = id;

    document.getElementById("info-placeholder").style.display = "none";
    document.getElementById("info-content").style.display = "block";
    document.getElementById("info-name").textContent = "📍 " + name;

    // 予測表示
    showPrediction(id);

    // サーバーから投稿取得
    const serverPosts = await apiFetch(`/crowd/posts/${id}`);

    const crowdDiv = document.getElementById("info-crowd");
    const postsDiv = document.getElementById("info-posts");

    if (serverPosts && serverPosts.length > 0) {
        // サーバーデータを使用
        const latest = serverPosts[0]; // 最新
        const cls = crowdClasses[latest.level] || "crowd-mid";
        const label = crowdLabels[latest.level] || "不明";
        crowdDiv.innerHTML = `最新の投稿: <span class="crowd-badge ${cls}">${label}</span>`;

        postsDiv.innerHTML = serverPosts.slice(0, 5).map(p =>
            `<div style="margin-top:6px;">「${p.comment || "コメントなし"}」<small style="color:rgba(255,255,255,0.4);margin-left:6px;">${p.created_at || ""}</small></div>`
        ).join("");
    } else {
        // ローカルフォールバック
        const localPosts = posts[id] || [];
        if (localPosts.length > 0) {
            const latest = localPosts[localPosts.length - 1];
            const cls = crowdClasses[latest.level];
            crowdDiv.innerHTML = `混雑状況: <span class="crowd-badge ${cls}">${crowdLabels[latest.level]}</span>`;
            postsDiv.innerHTML = localPosts.slice(-3).reverse().map(p =>
                `<div style="margin-top:6px;">「${p.text}」</div>`
            ).join("");
        } else {
            crowdDiv.innerHTML = '<span style="color:rgba(255,255,255,0.5);font-size:0.85rem;">投稿情報なし</span>';
            postsDiv.innerHTML = "";
        }
    }

    document.querySelector(".sidebar").scrollTo({ top: 0, behavior: "smooth" });
}

// ── 投稿 ────────────────────────────────────────────────────────────────

async function submitPost() {
    const locId = parseInt(document.getElementById("location").value);
    const locName = locationNames[locId];
    const menu = document.getElementById("menu").value.trim();
    const levelInput = document.querySelector('input[name="level"]:checked');

    if (!menu) {
        alert("コメントを入力してください。");
        return;
    }
    if (!levelInput) {
        alert("混雑レベルを選択してください。");
        return;
    }

    const level = parseInt(levelInput.value);

    // サーバーに送信
    const result = await apiFetch("/crowd/post", {
        method: "POST",
        body: JSON.stringify({ location_id: locId, level: level, comment: menu }),
    });

    // ローカルにも追加（フォールバック用）
    if (!posts[locId]) posts[locId] = [];
    posts[locId].push({ level, text: menu });

    // 投稿リストに追加
    const postList = document.getElementById("post-list");
    const newPost = document.createElement("div");
    newPost.className = "post-item";
    newPost.innerHTML = `
        <strong>${locName}</strong>
        <span class="crowd-badge ${crowdClasses[level]}">${crowdLabels[level]}</span><br>
        <small>「${menu}」</small>
    `;
    postList.prepend(newPost);

    // フォームリセット
    document.getElementById("status-form").reset();

    if (result) {
        alert("投稿ありがとうございました！（サーバーに保存されました）");
    } else {
        alert("投稿ありがとうございました！（ローカルに保存されました）");
    }

    // 予測を再読み込み
    loadAllPredictions();
    if (selectedLocationId === locId) {
        showPrediction(locId);
    }
}

// ── 時間帯セレクター ────────────────────────────────────────────────────

function setupTimeSelector() {
    const daySelect = document.getElementById("predict-day");
    const hourSelect = document.getElementById("predict-hour");

    const onChange = () => {
        if (selectedLocationId) {
            const day = parseInt(daySelect.value);
            const hour = parseInt(hourSelect.value);
            showPrediction(
                selectedLocationId,
                day >= 0 ? day : null,
                hour >= 0 ? hour : null
            );
        }
    };

    daySelect.addEventListener("change", onChange);
    hourSelect.addEventListener("change", onChange);
}

// ── 画像マップのスケーリング ────────────────────────────────────────────

function getImageRect(img) {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const dw = img.clientWidth;
    const dh = img.clientHeight;

    const nRatio = nw / nh;
    const dRatio = dw / dh;

    let rw, rh, ox, oy;
    if (nRatio > dRatio) {
        rw = dw;
        rh = dw / nRatio;
        ox = 0;
        oy = (dh - rh) / 2;
    } else {
        rh = dh;
        rw = dh * nRatio;
        ox = (dw - rw) / 2;
        oy = 0;
    }
    return { rw, rh, ox, oy };
}

function scaleImageMap() {
    const img = document.getElementById("campus-map");
    if (!img.complete || img.naturalWidth === 0) return;

    const { rw, rh, ox, oy } = getImageRect(img);
    const xr = rw / img.naturalWidth;
    const yr = rh / img.naturalHeight;

    document.querySelectorAll('map[name="ImageMap"] area').forEach(area => {
        if (!area.dataset.orig) {
            area.dataset.orig = area.getAttribute("coords");
        }
        const c = area.dataset.orig.split(",").map(Number);
        area.setAttribute("coords", [
            Math.round(c[0] * xr + ox),
            Math.round(c[1] * yr + oy),
            Math.round(c[2] * xr)
        ].join(","));
    });

    // オーバーレイドットも再配置
    loadAllPredictions();
}

// ── 最近の投稿をサーバーから読み込み ─────────────────────────────────────

async function loadRecentPosts() {
    const serverPosts = await apiFetch("/crowd/posts");
    if (serverPosts && serverPosts.length > 0) {
        const postList = document.getElementById("post-list");
        postList.innerHTML = serverPosts.map(p => `
            <div class="post-item">
                <strong>${p.location_name}</strong>
                <span class="crowd-badge ${crowdClasses[p.level] || "crowd-mid"}">${p.level_label || crowdLabels[p.level]}</span><br>
                <small>「${p.comment || ""}」</small>
            </div>
        `).join("");
    }
}

// ── 初期化 ──────────────────────────────────────────────────────────────

const mapImg = document.getElementById("campus-map");
mapImg.addEventListener("load", scaleImageMap);
if (mapImg.complete) scaleImageMap();
window.addEventListener("resize", scaleImageMap);

// 時間帯セレクター
setupTimeSelector();

// サーバーから初期データ読み込み
loadAllPredictions();
loadRecentPosts();

// グローバル登録（HTML onclickから呼ぶため）
window.selectLocation = selectLocation;
window.submitPost = submitPost;
