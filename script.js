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

let currentUser = null; // 現在のログインユーザー

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
            `<div style="margin-top:6px;">「${p.text}」 - ${p.userName}</div>`
        ).join('');
    } else {
        postsDiv.innerHTML = '';
    }

    // サイドバーを先頭にスクロール
    document.querySelector('.sidebar').scrollTo({ top: 0, behavior: 'smooth' });
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

import { db, signInWithGoogle, signOutUser, onAuthStateChange } from "./firebase.js";
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "firebase/firestore";

// 投稿をFirebaseに保存する（リアルタイムリスナーがUIを自動更新）
async function submitPost() {
    // ログイン確認
    if (!currentUser) {
        alert("投稿するにはログインが必要です。");
        return;
    }

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

    // Firestore へ投稿を保存
    try {
        const docRef = await addDoc(collection(db, "posts"), {
            locationId: locationId,
            level: level,
            comment: comment,
            userId: currentUser.uid,
            userName: currentUser.displayName,
            userEmail: currentUser.email,
            timestamp: serverTimestamp()
        });

        console.log("✅ Firestore へ投稿を追加しました (ID:", docRef.id, ")");

        // フォームをリセット
        document.getElementById('status-form').reset();

        alert("投稿しました！");

        // リアルタイムリスナーが自動でUIを更新するので、ここでは何もしない
        
    } catch (e) {
        console.error("❌ Firestore への保存エラー:", e);
        alert("投稿を保存できませんでした。\n\nエラー詳細: " + e.message + "\n\n→ ブラウザコンソール(F12)で詳細を確認してください");
    }
}

// グローバル関数化（モジュールとインラインイベント対応）
window.selectLocation = selectLocation;
window.submitPost = submitPost;

// ============= Firestore 連携 =============

// Firestore から全投稿をリアルタイムで読み込み
function setupRealtimePostsListener() {
    const q = query(collection(db, "posts"), orderBy("timestamp", "desc"));
    
    return onSnapshot(q, (querySnapshot) => {
        // posts配列をクリア
        Object.keys(posts).forEach(key => {
            posts[key] = [];
        });
        
        let loadedCount = 0;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const locId = data.locationId;
            
            if (!posts[locId]) posts[locId] = [];
            posts[locId].push({
                level: data.level,
                text: data.comment || "",
                userName: data.userName || "匿名",
                docId: doc.id,
                timestamp: data.timestamp
            });
            loadedCount++;
        });
        
        console.log(`🔄 Firestore から ${loadedCount} 件の投稿をリアルタイム更新しました`);
        updateUIFromPosts();
        
        // 現在表示中の場所があれば更新
        const currentLocationId = document.getElementById('location').value;
        if (currentLocationId) {
            const locName = locationNames[currentLocationId] || "不明";
            selectLocation(currentLocationId, locName);
        }
    }, (error) => {
        console.error("❌ Firestore リアルタイムリスナーエラー:", error);
    });
}

// ローカル posts データから UI を再構築
function updateUIFromPosts() {
    const postList = document.getElementById('post-list');
    postList.innerHTML = "";
    
    // 全投稿を収集してソート
    let allPosts = [];
    for (const locId in posts) {
        posts[locId].forEach(post => {
            allPosts.push({
                ...post,
                locationId: locId,
                locationName: locationNames[locId] || "不明"
            });
        });
    }
    
    // timestampで降順ソート（最新のものが上）
    allPosts.sort((a, b) => {
        if (!a.timestamp || !b.timestamp) return 0;
        return b.timestamp.toMillis() - a.timestamp.toMillis();
    });
    
    // 最新5件を表示
    const recentPosts = allPosts.slice(0, 5);
    
    recentPosts.forEach(post => {
        const postEl = document.createElement('div');
        postEl.className = 'post-item';
        postEl.innerHTML = `
            <strong>${post.locationName}</strong>
            <span class="crowd-badge ${crowdClasses[post.level]}">${crowdLabels[post.level]}</span><br>
            <small>「${post.text}」 - ${post.userName}</small>
        `;
        postList.appendChild(postEl);
    });
    
    console.log(`🎨 UI を更新しました (最新 ${recentPosts.length} 件の投稿表示)`);
}

// ============= 特定の場所の混雑度を平均化 =============
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

// ============= 認証関連 =============

// 認証UIを更新
function updateAuthUI(user) {
    const userInfo = document.getElementById('user-info');
    const loginBtn = document.getElementById('login-btn');
    const userName = document.getElementById('user-name');
    const logoutBtn = document.getElementById('logout-btn');
    const loginRequired = document.getElementById('login-required');
    const postForm = document.querySelector('.post-form');

    if (user) {
        userInfo.style.display = 'flex';
        loginBtn.style.display = 'none';
        userName.textContent = `こんにちは、${user.displayName}さん`;
        loginRequired.style.display = 'none';
        postForm.style.opacity = '1';
        currentUser = user;
    } else {
        userInfo.style.display = 'none';
        loginBtn.style.display = 'block';
        loginRequired.style.display = 'block';
        postForm.style.opacity = '0.6';
        currentUser = null;
    }
}

// Googleログイン処理
async function handleLogin() {
    try {
        const user = await signInWithGoogle();
        updateAuthUI(user);
        alert('ログインしました！');
    } catch (error) {
        console.error('ログインエラー:', error);
        alert('ログインに失敗しました。');
    }
}

// ログアウト処理
async function handleLogout() {
    try {
        await signOutUser();
        updateAuthUI(null);
        alert('ログアウトしました。');
    } catch (error) {
        console.error('ログアウトエラー:', error);
        alert('ログアウトに失敗しました。');
    }
}

// ============= ページロード初期化 =============
console.log("📄 script.js ロード開始...");

// 認証状態監視を開始
onAuthStateChange((user) => {
    updateAuthUI(user);
});

// イベントリスナー設定
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
});

// ページ読み込み完了時に Firestore リアルタイムリスナーをセットアップ
async function initializeApp() {
    console.log("🚀 アプリケーション初期化 - Firestore リアルタイムリスナーをセットアップ中...");
    const unsubscribe = setupRealtimePostsListener();
    console.log(`✅ リアルタイムリスナーをセットアップしました`);
    
    // クリーンアップ用（ページ離脱時にリスナーを解除）
    window.addEventListener('beforeunload', unsubscribe);
}

// DOMContentLoaded 待機
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // ドキュメント既にロード済みの場合
    initializeApp();
}