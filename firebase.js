// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDBB3jZvT1r1yC5hQCkxTcDkA3jcVwBL6c",
  authDomain: "syshack2026-atuagedaikon.firebaseapp.com",
  projectId: "syshack2026-atuagedaikon",
  storageBucket: "syshack2026-atuagedaikon.firebasestorage.app",
  messagingSenderId: "410456290685",
  appId: "1:410456290685:web:dd436c97d556412470c814"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

console.log("✅ Firebase 初期化成功:", {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  db: db ? "接続✓" : "エラー✗"
});

// Googleログイン関数
async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.log("✅ Googleログイン成功:", user.displayName);
    return user;
  } catch (error) {
    console.error("❌ Googleログインエラー:", error);
    throw error;
  }
}

// ログアウト関数
async function signOutUser() {
  try {
    await signOut(auth);
    console.log("✅ ログアウト成功");
  } catch (error) {
    console.error("❌ ログアウトエラー:", error);
    throw error;
  }
}

// 認証状態監視
function onAuthStateChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export { auth, provider, db, signInWithGoogle, signOutUser, onAuthStateChange };