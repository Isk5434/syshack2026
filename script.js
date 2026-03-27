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

const locationMenus = {
    1: ["Aプレート OOO円", "Bプレート OOO円", "Cプレート OOO円", "Dプレート OOO円","日替わりメニュー OOO円"],
    2: ["日替わりAメニュー OOO円", "日替わりBメニュー OOO円", "ラーメン OOO円", "カレー OOO円"],
    3: ["すき家", "牛丼 OOO円", "チーズ牛丼 OOO円", "キムチ牛丼 OOO円", "マグロたたき丼 OOO円",
         "らーめんGo Hachi", "豚骨ラーメン OOO円", "味噌ラーメン OOO円", "担々麺 OOO円", "からあげ OOO円",],
    4: ["キッチンカー"],
    5: ["A", "B", "C"],
    6: ["1", "2", "3"],
    7: ["i", "r", "h"],
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

    // ボトムメニューを表示
    showBottomMenu(id, name);
}

function showBottomMenu(id, name) {
    const menuPanel = document.getElementById('bottom-menu');
    const title = document.getElementById('bottom-menu-title');
    const list = document.getElementById('bottom-menu-list');

    title.textContent = `【${name}】メニュー`;

    const items = locationMenus[id] || ["メニュー情報がありません。"];
    list.innerHTML = items.map(item => `<div class="bottom-menu-item">・${item}</div>`).join('');

    menuPanel.classList.add('open');
    menuPanel.setAttribute('aria-hidden', 'false');
}

function hideBottomMenu() {
    const menuPanel = document.getElementById('bottom-menu');
    menuPanel.classList.remove('open');
    menuPanel.setAttribute('aria-hidden', 'true');
}

// 画面下部メニューのクローズボタン設定
const bottomMenuClose = document.getElementById('bottom-menu-close');
if (bottomMenuClose) {
    bottomMenuClose.addEventListener('click', hideBottomMenu);
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

import { db } from "./firebase.js";
import { collection, addDoc, query, where, getDocs, serverTimestamp } from "firebase/firestore";

// 投稿をFirebaseに保存する（ローカルUIも更新）
async function submitPost() {
    const locationId = parseInt(document.getElementById('location').value);
    const comment = document.getElementById('menu').value.trim();
    const levelInput = document.querySelector('input[name="level"]:checked');

    if (!comment) {
        alert("コメントを入力してください。");
        return;
    }
    if (!levelInput) {
        alert("混雑レベルを選択してください。");
        return;
    }

    const level = parseInt(levelInput.value);
    const locName = locationNames[locationId] || "不明な場所";

    // ローカル表示に追加
    if (!posts[locationId]) posts[locationId] = [];
    posts[locationId].push({ level, text: comment });

    const postList = document.getElementById('post-list');
    const newPost = document.createElement('div');
    newPost.className = 'post-item';
    newPost.innerHTML = `
        <strong>${locName}</strong>
        <span class="crowd-badge ${crowdClasses[level]}">${crowdLabels[level]}</span><br>
        <small>「${comment}」</small>
    `;
    postList.prepend(newPost);

    // 直後にサイドバーを更新
    selectLocation(locationId, locName);

    try {
        await addDoc(collection(db, "posts"), {
            locationId: locationId,
            level: level,
            comment: comment,
            timestamp: serverTimestamp()
        });

        alert("投稿しました！");
    } catch (e) {
        console.error("Error adding document: ", e);
        alert("投稿を保存できませんでした。ネットワークまたはFireStore設定を確認してください。");
    }

    document.getElementById('status-form').reset();
    updateAverageCrowd(locationId);
}

// グローバル関数化（モジュールとインラインイベント対応）
window.selectLocation = selectLocation;
window.submitPost = submitPost;

// 特定の場所の混雑度を平均化して算出する
async function updateAverageCrowd(locationId) {
    const q = query(collection(db, "posts"), where("locationId", "==", locationId));
    const querySnapshot = await getDocs(q);
    
    let totalLevel = 0;
    let count = 0;

    querySnapshot.forEach((doc) => {
        totalLevel += doc.data().level;
        count++;
    });

    const average = count > 0 ? (totalLevel / count).toFixed(1) : 0;
    
    // UIへの反映（例：3段階評価に丸める場合）
    const roundedLevel = Math.round(average);
    console.log(`場所ID: ${locationId} の平均混雑度: ${average} (判定: ${roundedLevel})`);
    
    return { average, roundedLevel };
}