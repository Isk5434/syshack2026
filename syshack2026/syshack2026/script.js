// 投稿データ（場所IDごとに管理）
const posts = {
    1: [{ level: 2, text: "日替わりのハンバーグが美味しかったです！" }],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
    7: []
};

const locationNames = {
    1: "アロハカフェ",
    2: "セントラル",
    3: "AITプラザ",
    4: "愛和会館",
    5: "四号館売店",
    6: "キッチンカー（一号館前）",
    7: "キッチンカー（セントラル前）"
};

const crowdLabels = { 1: "空いている", 2: "普通", 3: "混雑" };
const crowdClasses = { 1: "crowd-low", 2: "crowd-mid", 3: "crowd-high" };

// 場所をクリックしたときにサイドバーに情報表示
function selectLocation(id, name) {
    // フォームの場所も連動
    document.getElementById('location').value = id;

    // サイドバーの情報エリアを更新
    document.getElementById('info-placeholder').style.display = 'none';
    document.getElementById('info-content').style.display = 'block';
    document.getElementById('info-name').textContent = '📍 ' + name;

    // 混雑情報
    const locationPosts = posts[id] || [];
    const crowdDiv = document.getElementById('info-crowd');
    if (locationPosts.length > 0) {
        const latest = locationPosts[locationPosts.length - 1];
        const label = crowdLabels[latest.level];
        const cls = crowdClasses[latest.level];
        crowdDiv.innerHTML = `混雑状況: <span class="crowd-badge ${cls}">${label}</span>`;
    } else {
        crowdDiv.innerHTML = '<span style="color:rgba(255,255,255,0.5);font-size:0.85rem;">投稿情報なし</span>';
    }

    // 最新コメント
    const postsDiv = document.getElementById('info-posts');
    if (locationPosts.length > 0) {
        postsDiv.innerHTML = locationPosts.slice(-3).reverse().map(p =>
            `<div style="margin-top:6px;">「${p.text}」</div>`
        ).join('');
    } else {
        postsDiv.innerHTML = '';
    }

    // サイドバーを先頭にスクロール
    document.querySelector('.sidebar').scrollTo({ top: 0, behavior: 'smooth' });
}

// 投稿する
function submitPost() {
    const locId = parseInt(document.getElementById('location').value);
    const locName = locationNames[locId];
    const menu = document.getElementById('menu').value.trim();
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

    // 投稿データに追加
    if (!posts[locId]) posts[locId] = [];
    posts[locId].push({ level, text: menu });

    // 最近の投稿リストに追加
    const postList = document.getElementById('post-list');
    const newPost = document.createElement('div');
    newPost.className = 'post-item';
    newPost.innerHTML = `
        <strong>${locName}</strong>
        <span class="crowd-badge ${crowdClasses[level]}">${crowdLabels[level]}</span><br>
        <small>「${menu}」</small>
    `;
    postList.prepend(newPost);

    // フォームリセット
    document.getElementById('status-form').reset();
    alert("投稿ありがとうございました！");
}

// ===== 画像マップのスケーリング =====
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
    const img = document.getElementById('campus-map');
    if (!img.complete || img.naturalWidth === 0) return;

    const { rw, rh, ox, oy } = getImageRect(img);
    const xr = rw / img.naturalWidth;
    const yr = rh / img.naturalHeight;

    document.querySelectorAll('map[name="ImageMap"] area').forEach(area => {
        if (!area.dataset.orig) {
            area.dataset.orig = area.getAttribute('coords');
        }
        const c = area.dataset.orig.split(',').map(Number);
        // circle: cx, cy, r
        area.setAttribute('coords', [
            Math.round(c[0] * xr + ox),
            Math.round(c[1] * yr + oy),
            Math.round(c[2] * xr)
        ].join(','));
    });
}

const mapImg = document.getElementById('campus-map');
mapImg.addEventListener('load', scaleImageMap);
if (mapImg.complete) scaleImageMap();
window.addEventListener('resize', scaleImageMap);

// モジュールスコープからHTML onclickで呼べるようにグローバル登録
window.selectLocation = selectLocation;
window.submitPost = submitPost;
