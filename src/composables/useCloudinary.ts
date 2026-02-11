import { ref } from 'vue';
import { useAppConfig } from './useAppConfig';

export const useCloudinary = () => {
    const { config } = useAppConfig();
    const CLOUD_NAME = config.cloudinary.cloudName;
    const UPLOAD_PRESET = config.cloudinary.uploadPreset;

    const isUploading = ref(false);
    const uploadProgress = ref(0); // 0-100
    const error = ref<string | null>(null);

    const uploadFile = async (file: File, folder?: string): Promise<any> => {
        isUploading.value = true;
        uploadProgress.value = 0;
        error.value = null;

        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('upload_preset', UPLOAD_PRESET);
            if (folder) {
                formData.append('folder', folder);
            }

            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    uploadProgress.value = Math.round((e.loaded / e.total) * 100);
                }
            });

            xhr.addEventListener('load', () => {
                isUploading.value = false;
                if (xhr.status >= 200 && xhr.status < 300) {
                    const data = JSON.parse(xhr.responseText);
                    resolve({
                        url: data.secure_url,
                        publicId: data.public_id,
                        deleteToken: data.delete_token,
                        format: data.format,
                        resourceType: data.resource_type,
                        name: file.name,
                        size: data.bytes,
                        duration: data.duration, // For audio/video
                        thumbnailUrl: data.resource_type === 'image'
                            ? data.secure_url.replace('/upload/', '/upload/q_auto,f_auto,w_400,c_limit/')
                            : data.resource_type === 'video'
                                ? data.secure_url.replace(/\.[^/.]+$/, ".jpg").replace('/upload/', '/upload/q_auto,f_auto,w_400,c_limit/')
                                : ''
                    });
                } else {
                    error.value = 'Upload failed';
                    reject(new Error('Upload failed'));
                }
            });

            xhr.addEventListener('error', () => {
                isUploading.value = false;
                error.value = 'Network error';
                reject(new Error('Network error'));
            });

            xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`);
            xhr.send(formData);
        });
    };

    /**
     * Get optimized URL for image (injects transformations into secure_url)
     */
    const getOptimizedUrl = (url: string, width = 800) => {
        if (!url || !url.includes('/upload/')) return url;
        return url.replace('/upload/', `/upload/w_${width},c_limit,q_auto,f_auto/`);
    };

    /**
     * Get thumbnail for PDF.
     */
    const getPdfThumbnail = (_url: string): string | null => {
        return null;
    };

    /**
     * Get video thumbnail
     */
    const getVideoThumbnail = (url: string) => {
        if (!url || !url.includes('/upload/')) return url;
        return url.replace('/upload/', '/upload/so_0,w_400,c_limit,q_auto,f_auto/')
            .replace(/\.[^/.]+$/, ".jpg");
    };

    const getViewUrl = (url: string, type?: string) => {
        if (!url) return url;

        // PDF: return raw URL (Strict Transformations is now disabled)
        if (type === 'pdf') return url;

        // Images/others: optimize with q_auto,f_auto
        if (!url.includes('/upload/')) return url;
        return url.replace('/upload/', '/upload/q_auto,f_auto/');
    };

    /**
     * Delete file from Cloudinary (requires delete_token)
     * Note: delete_token is valid for only 10 minutes after upload
     */

    /**
     * 真實刪除：使用 API Key/Secret 永久刪除雲端檔案
     * 策略：如果指定的 resourceType 失敗，嘗試其他常見類型 (raw, video)
     */
    const deleteFileAdmin = async (publicId: string, resourceType: string = 'image') => {
        const { apiKey, apiSecret } = config.cloudinary;
        if (!apiKey || !apiSecret) {
            console.warn('[Cloudinary] 缺少 API Key/Secret，無法執行管理員刪除');
            return false;
        }

        // 嘗試刪除的函式
        const tryDelete = async (rType: string) => {
            try {
                const timestamp = Math.round(new Date().getTime() / 1000);
                const str = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
                const msgUint8 = new TextEncoder().encode(str);
                const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                const formData = new FormData();
                formData.append('public_id', publicId);
                formData.append('api_key', apiKey);
                formData.append('timestamp', timestamp.toString());
                formData.append('signature', signature);

                const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${rType}/destroy`, {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                console.log(`[Cloudinary] 嘗試刪除 (${rType}):`, result);
                return result.result === 'ok';
            } catch (err) {
                console.error(`[Cloudinary] 刪除出錯 (${rType}):`, err);
                return false;
            }
        };

        // 1. 嘗試指定的 resourceType (預設 image)
        // PDF 通常是 image (有頁面) 或 raw。若原先存為 image 但其實是 raw，這裡會失敗。
        const primaryType = resourceType === 'pdf' ? 'image' : (resourceType || 'image');
        if (await tryDelete(primaryType)) return true;

        // 2. 如果失敗，且 primaryType 不是 'raw'，嘗試 'raw' (很多文件是 raw)
        if (primaryType !== 'raw') {
            console.log('[Cloudinary] 預設類型刪除失敗，嘗試 raw...');
            if (await tryDelete('raw')) return true;
        }

        // 3. 如果失敗，且 primaryType 不是 'video'，嘗試 'video' (音訊有時也是 video)
        if (primaryType !== 'video') {
            console.log('[Cloudinary] 嘗試 video...');
            if (await tryDelete('video')) return true;
        }

        return false;
    };

    /**
     * Delete file from Cloudinary
     * 策略：若有 API Secret 則使用管理員刪除(永久有效)，否則嘗試使用 delete_token (10分鐘有效)
     */
    const deleteFile = async (publicId?: string, deleteToken?: string, resourceType?: string) => {
        // 1. 優先嘗試管理員刪除 (如果有設定 API Secret)
        if (publicId && config.cloudinary.apiSecret) {
            const success = await deleteFileAdmin(publicId, resourceType);
            if (success) {
                console.log('[Cloudinary] 管理員永久刪除成功');
                return true;
            }
        }

        // 2. 退而求其次使用 delete_token
        if (!deleteToken) {
            console.warn('[Cloudinary] 無法從雲端刪除檔案 (缺少權限或 Token 已過期)');
            return false;
        }

        try {
            const formData = new FormData();
            formData.append('token', deleteToken);

            const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/delete_by_token`, {
                method: 'POST',
                body: formData
            });

            await response.json();
            return response.ok;
        } catch (err) {
            console.error('[Cloudinary] 刪除連線錯誤:', err);
            return false;
        }
    };

    /**
     * Get management URL for Cloudinary console
     */
    const getAdminUrl = (publicId?: string) => {
        if (!publicId) return null;
        return `https://console.cloudinary.com/console/c-${CLOUD_NAME}/media_library/search?q=${encodeURIComponent(publicId)}`;
    };

    /**
     * List files in a specific folder (Improved using Resources API)
     */
    const listFolder = async (folder = 'ahmo-padlet/background') => {
        const { apiKey, apiSecret, cloudName } = config.cloudinary;
        if (!apiKey || !apiSecret) {
            console.warn('[Cloudinary] 缺少 API Key/Secret，無法列出清單');
            return [];
        }

        try {
            const auth = btoa(`${apiKey}:${apiSecret}`);
            // 使用 Resources API 搭配 prefix，這不需要額外啟用 Search 功能，且延遲較低
            const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?prefix=${encodeURIComponent(folder)}&max_results=100`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            });

            const data = await response.json();
            console.log('[Cloudinary] Fetch folder result:', data);

            if (data.resources) {
                return data.resources.map((r: any) => ({
                    url: r.secure_url,
                    publicId: r.public_id,
                    resourceType: r.resource_type,
                    createdAt: r.created_at
                }));
            }
            return [];
        } catch (err) {
            console.error('[Cloudinary] 列表獲取失敗:', err);
            return [];
        }
    };

    return {
        uploadFile,
        getOptimizedUrl,
        getPdfThumbnail,
        getVideoThumbnail,
        getViewUrl,
        getAdminUrl,
        deleteFile,
        listFolder,
        isUploading,
        uploadProgress,
        error
    };
};
