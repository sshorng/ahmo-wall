import { reactive, computed } from 'vue';

const CONFIG_KEY = 'ahmo_app_config';
export const APP_ID = 'ahmo-wall';
export const DB_PREFIX = `${APP_ID}_`;

export interface AppConfig {
    firebase: {
        apiKey: string;
        authDomain: string;
        projectId: string;
        storageBucket: string;
        messagingSenderId: string;
        appId: string;
    };
    cloudinary: {
        cloudName: string;
        uploadPreset: string;
        apiKey: string;
        apiSecret: string;
        isConfigured?: boolean;
    };
    allowedEmails?: string[]; // Whitelist for login/creation
    appTitle?: string; // Customizable app title
}

// 預設配置 (全空，強制引導設定)
const DEFAULT_CONFIG: AppConfig = {
    appTitle: '阿墨互動牆',
    firebase: {
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: ''
    },
    cloudinary: {
        cloudName: '',
        uploadPreset: '',
        apiKey: '',
        apiSecret: ''
    },
    allowedEmails: []
};

/**
 * 簡單的 Base64 編碼/解碼工具 (用於分享與儲存)
 */
export const configUtils = {
    encode: (config: AppConfig): string => {
        try {
            return btoa(encodeURIComponent(JSON.stringify(config)));
        } catch (e) {
            console.error('編碼失敗:', e);
            return '';
        }
    },
    decode: (encoded: string): AppConfig | null => {
        try {
            if (!encoded) return null;
            return JSON.parse(decodeURIComponent(atob(encoded)));
        } catch (e) {
            console.error('解碼失敗:', e);
            return null;
        }
    },
    /**
     * 解析 Firebase SDK 貼上的配置代碼
     */
    parseFirebaseConfig: (raw: string) => {
        const keys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
        const result: any = {};
        keys.forEach(key => {
            const regex = new RegExp(`${key}:\\s*["']([^"']+)["']`);
            const match = raw.match(regex);
            if (match) result[key] = match[1];
        });
        return result;
    },
    /**
     * 清理敏感資訊：僅保留必要配置供分享
     */
    sanitizeForShare: (config: AppConfig): any => {
        return {
            firebase: config.firebase
        };
    }
};

// 響應式配置狀態
const state = reactive<AppConfig>({ ...DEFAULT_CONFIG });

/**
 * 載入配置的優先權邏輯: URL > LocalStorage > Default
 */
const loadConfig = () => {
    // 1. 從 URL 參數嘗試
    const urlParams = new URLSearchParams(window.location.search);
    const urlConfigData = urlParams.get('config');
    if (urlConfigData) {
        const decoded = configUtils.decode(urlConfigData);
        if (decoded) {
            console.log('[Config] 從 URL 載入配置成功');
            Object.assign(state, decoded);
            saveToLocalStorage(decoded); // 自動更新本地儲存
            return;
        }
    }

    // 2. 從 LocalStorage 載入
    const localData = localStorage.getItem(CONFIG_KEY);
    if (localData) {
        const decoded = configUtils.decode(localData);
        if (decoded) {
            console.log('[Config] 從 LocalStorage 載入配置成功');
            Object.assign(state, decoded);
            return;
        }
    }

    console.log('[Config] 使用預設配置');
};

const saveToLocalStorage = (config: AppConfig) => {
    localStorage.setItem(CONFIG_KEY, configUtils.encode(config));
};

export const useAppConfig = () => {
    return {
        config: state,
        isConfigured: computed(() => !!state.firebase.apiKey),
        loadConfig,
        saveConfig: (newConfig: AppConfig) => {
            // 分離儲存：Firebase 配置存 LocalStorage，Cloudinary 則交給外部處理或在此擴充
            const localConfig = configUtils.sanitizeForShare(newConfig);
            Object.assign(state, newConfig);
            saveToLocalStorage(localConfig);
        },
        resetConfig: () => {
            Object.assign(state, DEFAULT_CONFIG);
            localStorage.removeItem(CONFIG_KEY);
        },
        generateShareLink: () => {
            const baseUrl = window.location.origin + window.location.pathname;
            const sanitized = configUtils.sanitizeForShare(state);
            return `${baseUrl}?config=${configUtils.encode(sanitized)}`;
        }
    };
};

