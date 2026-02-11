import { defineStore } from 'pinia';
import { ref } from 'vue';
import { auth } from '../firebase';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, type User, type OAuthCredential } from 'firebase/auth';
import { useAppConfig } from '../composables/useAppConfig';

// Extended user with access token for Drive API
interface ExtendedUser extends User {
    accessToken?: string;
}

export const useAuthStore = defineStore('auth', () => {
    const user = ref<ExtendedUser | null>(null);
    const accessToken = ref<string | null>(null);
    const loading = ref(true);

    // Initialize Auth State Listener
    const init = () => {
        return new Promise<void>((resolve) => {
            onAuthStateChanged(auth, (currentUser) => {
                user.value = currentUser as ExtendedUser;
                loading.value = false;
                resolve();
            });
        });
    };

    const loginGoogle = async () => {
        try {
            const provider = new GoogleAuthProvider();

            // Request Google Drive scope for file uploads
            provider.addScope('https://www.googleapis.com/auth/drive.file');

            const result = await signInWithPopup(auth, provider);

            // Get the OAuth credential which contains the access token
            const credential = GoogleAuthProvider.credentialFromResult(result) as OAuthCredential;

            if (credential?.accessToken) {
                accessToken.value = credential.accessToken;
                // Also store on user object for convenience
                if (user.value) {
                    (user.value as ExtendedUser).accessToken = credential.accessToken;
                }
            }

            // Whitelist Check from Firestore
            const { config } = useAppConfig();
            let allowed = config.allowedEmails || [];

            try {
                const { getDoc, doc, getFirestore } = await import('firebase/firestore');
                const { DB_PREFIX } = await import('../composables/useAppConfig');
                const db = getFirestore();
                const docSnap = await getDoc(doc(db, `${DB_PREFIX}configs`, 'global'));
                if (docSnap.exists()) {
                    allowed = docSnap.data().whitelistEmails || [];
                    // Update global config state too
                    config.allowedEmails = allowed;
                    config.appTitle = docSnap.data().siteTitle || config.appTitle;
                }
            } catch (e) {
                console.warn('[Auth] 無法從雲端載入白名單，將使用本地快取', e);
            }

            if (allowed.length > 0 && result.user.email) {
                if (!allowed.includes(result.user.email)) {
                    await signOut(auth); // Immediately sign out
                    user.value = null;
                    accessToken.value = null;
                    throw new Error('您的帳號未在允許清單中，無法存取系統。');
                }
            }

            return result.user;
        } catch (error) {
            if (error instanceof Error) {
                console.error("Google login failed", error.message);
            }
            throw error;
        }
    };

    const logout = async () => {
        await signOut(auth);
        user.value = null;
        accessToken.value = null;
    };

    return { user, accessToken, loading, init, loginGoogle, logout };
});
