import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

import { useAppConfig } from "./composables/useAppConfig";

const { config, loadConfig } = useAppConfig();

// 第一步：載入所有來源的配置 (URL > LocalStorage > Default)
loadConfig();

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: config.firebase.apiKey,
    authDomain: config.firebase.authDomain,
    projectId: config.firebase.projectId,
    storageBucket: config.firebase.storageBucket,
    messagingSenderId: config.firebase.messagingSenderId,
    appId: config.firebase.appId
};

// Initialize Firebase (Only if config is valid)
let auth: any = null;
let db: any = null;
let storage: any = null;

if (firebaseConfig.apiKey) {
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        storage = getStorage(app);
    } catch (err) {
        console.error("Firebase 初始化失敗:", err);
    }
} else {
    console.warn("Firebase 配置缺失，請先完成起始設定。");
}

export { auth, db, storage };
