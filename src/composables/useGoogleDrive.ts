import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';

// Google Drive API Upload URL
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

export function useGoogleDrive() {
    const authStore = useAuthStore();
    const isUploading = ref(false);
    const uploadProgress = ref(0);
    const error = ref<string | null>(null);

    /**
     * Get user's access token from Auth Store
     */
    const getAccessToken = (): string => {
        if (!authStore.accessToken) {
            throw new Error('No access token available. Please sign in again with Drive permissions.');
        }
        return authStore.accessToken;
    };

    /**
     * Upload a file to Google Drive
     */
    const uploadFile = async (
        file: File,
        folderId?: string
    ): Promise<{ fileId: string; webViewLink: string; thumbnailLink?: string }> => {
        isUploading.value = true;
        error.value = null;
        uploadProgress.value = 0;

        try {
            const accessToken = await getAccessToken();

            // Prepare metadata
            const metadata: Record<string, any> = {
                name: file.name,
                mimeType: file.type,
            };

            // If folder specified, add parent
            if (folderId) {
                metadata.parents = [folderId];
            }

            // Create multipart body
            const boundary = '-------314159265358979323846';
            const delimiter = `\r\n--${boundary}\r\n`;
            const closeDelimiter = `\r\n--${boundary}--`;

            // Read file as base64
            const reader = new FileReader();
            const base64Data = await new Promise<string>((resolve, reject) => {
                reader.onload = () => {
                    const result = reader.result as string;
                    resolve(result.split(',')[1]); // Remove data:...;base64, prefix
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const multipartRequestBody =
                delimiter +
                'Content-Type: application/json\r\n\r\n' +
                JSON.stringify(metadata) +
                delimiter +
                `Content-Type: ${file.type}\r\n` +
                'Content-Transfer-Encoding: base64\r\n\r\n' +
                base64Data +
                closeDelimiter;

            // Upload to Drive
            const response = await fetch(DRIVE_UPLOAD_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': `multipart/related; boundary="${boundary}"`,
                },
                body: multipartRequestBody,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'Upload failed');
            }

            const data = await response.json();
            uploadProgress.value = 100;

            // Make file publicly accessible
            await makeFilePublic(data.id, accessToken);

            // Get file details with web view link
            const fileDetails = await getFileDetails(data.id, accessToken);

            return {
                fileId: data.id,
                webViewLink: fileDetails.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
                thumbnailLink: fileDetails.thumbnailLink,
            };
        } catch (err: any) {
            error.value = err.message;
            throw err;
        } finally {
            isUploading.value = false;
        }
    };

    /**
     * Make a file publicly accessible (anyone with link can view)
     */
    const makeFilePublic = async (fileId: string, accessToken: string) => {
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                role: 'reader',
                type: 'anyone',
            }),
        });
    };

    /**
     * Get file details including web view link
     */
    const getFileDetails = async (fileId: string, accessToken: string) => {
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink,thumbnailLink,webContentLink`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );
        return response.json();
    };

    /**
     * Get direct image URL for embedding
     */
    const getDirectImageUrl = (fileId: string): string => {
        return `https://drive.google.com/uc?export=view&id=${fileId}`;
    };

    /**
     * Get PDF preview URL
     */
    const getPdfPreviewUrl = (fileId: string): string => {
        return `https://drive.google.com/file/d/${fileId}/preview`;
    };

    return {
        isUploading,
        uploadProgress,
        error,
        uploadFile,
        getDirectImageUrl,
        getPdfPreviewUrl,
    };
}
