import { ref } from 'vue';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppConfig, DB_PREFIX } from './useAppConfig';
import { useModal } from './useModal';
import { useAuthStore } from '../stores/auth';
import type { Board } from '../stores/board';

export function useBoardSettings(boardId: string) {
    const { config: appConfig } = useAppConfig();
    const modal = useModal();
    const authStore = useAuthStore();

    const loadGlobalSettings = async () => {
        try {
            const docSnap = await getDoc(doc(db, `${DB_PREFIX}configs`, 'global'));
            if (docSnap.exists()) {
                const data = docSnap.data();
                appConfig.appTitle = data.siteTitle || '阿墨互動牆';
                appConfig.allowedEmails = data.whitelistEmails || [];
            }
        } catch (e) {
            console.warn('[Config] 無法讀取全域設定');
        }
    };

    const saveGlobalSettings = async (isOwner: boolean) => {
        if (!isOwner) {
            modal.error('僅限管理員可以修改系統預設設定');
            return;
        }
        try {
            await setDoc(doc(db, `${DB_PREFIX}configs`, 'global'), {
                siteTitle: appConfig.appTitle,
                whitelistEmails: appConfig.allowedEmails,
                updatedAt: new Date()
            }, { merge: true });
            modal.success('系統全域設定已儲存！');
        } catch (e: any) {
            modal.error('儲存失敗：' + (e.code === 'permission-denied' ? '您的管理員權限不足' : e.message));
        }
    };

    const loadCloudinaryConfig = async () => {
        try {
            const configDoc = await getDoc(doc(db, `${DB_PREFIX}configs`, 'cloudinary'));
            if (configDoc.exists()) {
                const data = configDoc.data();
                appConfig.cloudinary.cloudName = data.cloudName || '';
                appConfig.cloudinary.uploadPreset = data.uploadPreset || '';
                appConfig.cloudinary.isConfigured = !!appConfig.cloudinary.cloudName;
            }
            if (authStore.user) {
                const secretsDoc = await getDoc(doc(db, `${DB_PREFIX}configs`, 'cloudinary_secrets'));
                if (secretsDoc.exists()) {
                    const sData = secretsDoc.data();
                    appConfig.cloudinary.apiKey = sData.apiKey || '';
                    appConfig.cloudinary.apiSecret = sData.apiSecret || '';
                }
            }
        } catch (e) {
            console.warn('[Config] 載入 Cloudinary 配置失敗');
        }
    };

    const saveCloudinaryConfig = async (isOwner: boolean) => {
        if (!isOwner) {
            modal.error('僅限管理員可以同步雲端設定');
            return;
        }
        try {
            await setDoc(doc(db, `${DB_PREFIX}configs`, 'cloudinary'), {
                cloudName: appConfig.cloudinary.cloudName,
                uploadPreset: appConfig.cloudinary.uploadPreset,
                updatedAt: new Date()
            }, { merge: true });

            await setDoc(doc(db, `${DB_PREFIX}configs`, 'cloudinary_secrets'), {
                apiKey: appConfig.cloudinary.apiKey,
                apiSecret: appConfig.cloudinary.apiSecret,
                updatedAt: new Date()
            }, { merge: true });

            appConfig.cloudinary.isConfigured = true;
            modal.success('Cloudinary 全域配置已儲存！');
        } catch (e: any) {
            modal.error('儲存失敗：' + (e.code === 'permission-denied' ? '您的管理員權限不足' : e.message));
        }
    };

    const saveBoardSettings = async (board: Board) => {
        try {
            await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId), {
                title: board.title,
                description: board.description,
                layout: board.layout,
                backgroundImage: board.backgroundImage,
                privacy: board.privacy,
                password: board.password || '',
                guestPermission: board.guestPermission || 'edit',
                moderationEnabled: board.moderationEnabled || false
            });
            modal.success('看板設定已儲存');
            return true;
        } catch (err: any) {
            modal.error('設定儲存失敗: ' + err.message);
            return false;
        }
    };

    return {
        loadGlobalSettings,
        saveGlobalSettings,
        loadCloudinaryConfig,
        saveCloudinaryConfig,
        saveBoardSettings
    };
}
