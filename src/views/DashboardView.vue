<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import QrcodeVue from 'qrcode.vue';
import draggable from 'vuedraggable';
import { useBoardStore, type Post, type Section, type Board } from '../stores/board';
import { useAuthStore } from '../stores/auth';
import { useCloudinary } from '../composables/useCloudinary';
import { useModal } from '../composables/useModal';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

const route = useRoute();
const router = useRouter();
const boardStore = useBoardStore();
const authStore = useAuthStore();
const { 
  uploadFile, 
  getVideoThumbnail, 
  getViewUrl,
  deleteFile,
  isUploading: cloudinaryUploading,
  uploadProgress
} = useCloudinary();
import { useAppConfig, DB_PREFIX } from '../composables/useAppConfig';
const { config: appConfig, generateShareLink } = useAppConfig();
const modal = useModal();

const isCopyingConfig = ref(false);

const previewUrl = ref<string | null>(null);
const previewOriginalUrl = ref<string | null>(null);
const previewType = ref<'image' | 'pdf' | null>(null);

// --- 基礎狀態與計算屬性 ---
const boardId = computed(() => route.params.id as string);
const currentBoard = ref<Board | null>(null);
const isLoading = ref(true);
const isPasswordVerified = ref(false);
const guestName = ref(sessionStorage.getItem('ahmo_guest_name') || '');

const isOwner = computed(() => {
  return currentBoard.value?.ownerId === authStore.user?.uid;
});

const canEdit = computed(() => {
  return isOwner.value;
});

const canContribute = computed(() => {
  if (isOwner.value) return true;
  if (!currentBoard.value) return false;
  if (currentBoard.value.privacy === 'private') return false;
  const guestPerm = currentBoard.value.guestPermission || 'edit';
  return guestPerm !== 'view';
});

// --- 拖放與局部狀態 ---
const dragTargetPostId = ref<string | null>(null);
const dragTargetSectionId = ref<string | null>(null);
const isDraggingOver = ref(false);

// --- 投影片模式 ---
const showSlideshow = ref(false);
const currentSlideIndex = ref(0);
const isPlaying = ref(false);
let slideTimer: number | null = null;

const slides = computed(() => {
  const allSlides: { type: 'title' | 'section' | 'post', data: any }[] = [];
  
  // 1. Title Slide
  if (currentBoard.value) {
    allSlides.push({ type: 'title', data: currentBoard.value });
  }

  // 2. Sections and Posts
  localSections.value.forEach(section => {
    // Add Section Divider
    allSlides.push({ type: 'section', data: section });
    
    // Add Posts in this section
    const posts = filteredAndSortedPostsBySection.value[section.id] || [];
    posts.forEach(post => {
      allSlides.push({ type: 'post', data: post });
    });
  });

  return allSlides;
});

const currentSlide = computed(() => {
  return slides.value[currentSlideIndex.value] || null;
});

const startSlideshow = () => {
  showSlideshow.value = true;
  currentSlideIndex.value = 0;
  isPlaying.value = false; // Default to manual play
  // startSlideTimer(); // Disable auto-play by default
  document.body.style.overflow = 'hidden'; // Prevent background scrolling
  
  // Auto enter fullscreen for immersive experience
  document.documentElement.requestFullscreen().catch(() => {});
};

const closeSlideshow = () => {
  showSlideshow.value = false;
  isPlaying.value = false;
  stopSlideTimer();
  document.body.style.overflow = '';
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(err => console.log(err));
  }
};

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.log(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
};

const nextSlide = () => {
  if (currentSlideIndex.value < slides.value.length - 1) {
    currentSlideIndex.value++;
  } else {
    // Loop back to start or stop? Let's loop.
    currentSlideIndex.value = 0;
  }
};

const prevSlide = () => {
  if (currentSlideIndex.value > 0) {
    currentSlideIndex.value--;
  } else {
    currentSlideIndex.value = slides.value.length - 1;
  }
};

const togglePlayPause = () => {
  isPlaying.value = !isPlaying.value;
  if (isPlaying.value) {
    startSlideTimer();
  } else {
    stopSlideTimer();
  }
};

const startSlideTimer = () => {
  stopSlideTimer();
  slideTimer = window.setInterval(() => {
    nextSlide();
  }, 5000); // 5 seconds per slide
};

const stopSlideTimer = () => {
  if (slideTimer) {
    clearInterval(slideTimer);
    slideTimer = null;
  }
};

// Keyboard Navigation for Slideshow
const handleKeydown = (e: KeyboardEvent) => {
  if (!showSlideshow.value) return;
  
  switch(e.key) {
    case 'ArrowRight':
    case 'Space':
      if (e.key === 'Space') e.preventDefault();
      nextSlide();
      // Reset timer on manual navigation
      if (isPlaying.value) startSlideTimer(); 
      break;
    case 'ArrowLeft':
      prevSlide();
      if (isPlaying.value) startSlideTimer();
      break;
    case 'Escape':
      closeSlideshow();
      break;
  }
};

// --- 投影片 URL ---
const currentUrl = ref('');

onMounted(() => {
  currentUrl.value = window.location.href;
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  stopSlideTimer();
});

// 使用 computed 取代 ref + watch，顯著提升效能與減少不必要的重新渲染
const localSections = computed(() => {
  return [...boardStore.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
});

// --- 監聽器 ---

// Sort Options
const currentSort = ref('manual');
const sortOptions = [
    { label: '自訂排序', value: 'manual' },
    { label: '時間 (新→舊)', value: 'time_desc' },
    { label: '時間 (舊→新)', value: 'time_asc' },
    { label: '標題 (A→Z)', value: 'title_asc' },
    { label: '標題 (Z→A)', value: 'title_desc' },
    { label: '作者 (A→Z)', value: 'author_asc' },
    { label: '作者 (Z→A)', value: 'author_desc' },
];

// Load sort when boardId changes or currentBoard updates
watch(() => currentBoard.value?.defaultSort, (newDefault) => {
    if (newDefault) {
        currentSort.value = newDefault;
    }
}, { immediate: true });

// Save sort when currentSort changes (Owner only)
watch(currentSort, async (newSort) => {
    if (isOwner.value && boardId.value && currentBoard.value && currentBoard.value.defaultSort !== newSort) {
        try {
            await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value), { defaultSort: newSort });
        } catch (e) {
            console.error('Failed to sync sort:', e);
        }
    }
});

// 移除重複的監聽器


// Sort Logic Helper
const sortPosts = (posts: Post[], sortType: string) => {
    return [...posts].sort((a, b) => {
        switch (sortType) {
            case 'time_desc':
                return (b.createdAt?.getTime ? b.createdAt.getTime() : 0) - (a.createdAt?.getTime ? a.createdAt.getTime() : 0);
            case 'time_asc':
                return (a.createdAt?.getTime ? a.createdAt.getTime() : 0) - (b.createdAt?.getTime ? b.createdAt.getTime() : 0);
            case 'title_asc':
                return (a.title || '').localeCompare(b.title || '');
            case 'title_desc':
                return (b.title || '').localeCompare(a.title || '');
            case 'author_asc':
                return (a.author.displayName || '').localeCompare(b.author.displayName || '');
            case 'author_desc':
                return (b.author.displayName || '').localeCompare(a.author.displayName || '');
            case 'manual':
            default:
                // If manual, maintain original order (already sorted by order in store)
                // But we should ensure we respect the order field just in case
                return (a.order ?? 0) - (b.order ?? 0);
        }
    });
};


// 使用 computed 優化貼文過濾與排序邏輯
const filteredAndSortedPostsBySection = computed(() => {
  const postsBySec = boardStore.postsBySection;
  const owner = isOwner.value;
  const modEnabled = currentBoard.value?.moderationEnabled;
  const userId = authStore.user?.uid;
  const sort = currentSort.value;
  
  const newMap: Record<string, Post[]> = {};
  
  Object.keys(postsBySec).forEach(key => {
    let list = [...(postsBySec[key] || [])];
    
    // 1. 過濾邏輯 (待審核貼文處理)
    if (modEnabled && !owner) {
      list = list.filter(p => {
        const isMine = (userId && p.author.uid === userId) || 
                       (!userId && p.author.displayName === guestName.value && !!guestName.value);
        const isBoardOwnerPost = p.author.uid === currentBoard.value?.ownerId;
        return p.status === 'approved' || !p.status || isMine || isBoardOwnerPost;
      });
    }

    // 2. 排序邏輯
    newMap[key] = sortPosts(list, sort);
  });
  
  return newMap;
});

const filteredAndSortedWallPosts = computed(() => {
  const allPosts = boardStore.posts;
  const owner = isOwner.value;
  const modEnabled = currentBoard.value?.moderationEnabled;
  const userId = authStore.user?.uid;
  const sort = currentSort.value;
  
  let list = [...(allPosts || [])];
  
  if (modEnabled && !owner) {
    list = list.filter(p => {
      const isMine = (userId && p.author.uid === userId) || 
                     (!userId && p.author.displayName === guestName.value && !!guestName.value);
      const isBoardOwnerPost = p.author.uid === currentBoard.value?.ownerId;
      return p.status === 'approved' || !p.status || isMine || isBoardOwnerPost;
    });
  }
  
  return sortPosts(list, sort);
});

// 為了相容性保留 alias，或直接更新模板 (建議更新模板以保持純淨)
const localPostsBySection = filteredAndSortedPostsBySection;
const localWallPosts = filteredAndSortedWallPosts;


// --- 其他 UI 狀態 ---
const showPasswordModal = ref(false);
const passwordInput = ref('');
const passwordError = ref('');

const allFlatPosts = computed(() => {
  if (currentBoard.value?.layout === 'wall') {
    return localWallPosts.value;
  }
  const result: Post[] = [];
  localSections.value.forEach(sec => {
    const posts = localPostsBySection.value[sec.id] || [];
    result.push(...posts);
  });
  return result;
});

const handleImageError = (author: any) => {
    if (author && author.photoURL) author.photoURL = ''; 
};

// Edit state
const editingPostId = ref<string | null>(null);
const editingSectionId = ref<string | null>(null);
const editingBoardTitle = ref(false);
const editingBoardDesc = ref(false);

// Local state for edits
const editContent = ref('');
const editTitle = ref('');
const editDesc = ref('');
const editPostColor = ref('#ffffff');
const editPostTitle = ref('');
const expandedPostsInList = reactive<Record<string, boolean>>({});



// Settings Modal Tabs
const settingsTab = ref('basic');
const SETTINGS_TABS = [
  { id: 'basic', label: '看板基本', icon: 'M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1' },
  { id: 'visual', label: '視覺背景', icon: 'M4 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4zm0-10h16M9 3v8m6-8v8' },
  { id: 'privacy', label: '權限隱私', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  { id: 'system', label: '系統設定', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' }
];

const whitelistInput = ref('');
watch(() => appConfig.allowedEmails, (newEmails) => {
    if (newEmails) {
        whitelistInput.value = newEmails.join(', ');
    }
}, { immediate: true });

const updateWhitelist = () => {
    appConfig.allowedEmails = whitelistInput.value.split(',').map(e => e.trim()).filter(e => !!e);
};

// Comments state
const activeCommentPostId = ref<string | null>(null);
const commentInputs = reactive<Record<string, string>>({});
const expandedComments = reactive<Record<string, boolean>>({});

const toggleExpandComments = (postId: string) => {
  expandedComments[postId] = !expandedComments[postId];
};

// Local state
const newPostContent = ref('');
const newPostTitle = ref(''); // New: Post title input
const activeSection = ref<string | null>(null);
const activeSectionMenuId = ref<string | null>(null); // For section menu dropdown
const newPostColor = ref('#ffffff'); // Default white
const POST_COLORS = [
  { name: '預設', value: '#ffffff' },
  { name: '灰藍', value: '#d1dce5' },
  { name: '藕粉', value: '#e2d1d1' },
  { name: '萌綠', value: '#d5e0d5' },
  { name: '米黃', value: '#eee8d5' },
  { name: '灰紫', value: '#ddd5e2' },
  { name: '陶土', value: '#e5dcd1' },
  { name: '海霧', value: '#d1e5e2' },
  { name: '煙燻', value: '#e5e5e5' },
];

// Local liked state
const likedPosts = reactive<Record<string, boolean>>({});

const loadGlobalSettings = async () => {
    try {
        const docSnap = await getDoc(doc(db, `${DB_PREFIX}configs`, 'global'));
        if (docSnap.exists()) {
            const data = docSnap.data();
            appConfig.appTitle = data.siteTitle || '阿墨互動牆';
            appConfig.allowedEmails = data.whitelistEmails || [];
            console.log('[Config] 全域設定已從資料庫載入');
        }
    } catch (e) {
        console.warn('[Config] 無法讀取全域設定');
    }
};

const saveGlobalSettings = async () => {
    if (!isOwner.value) {
        modal.error('僅限管理員可以修改系統預設設定');
        return;
    }

    try {
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, `${DB_PREFIX}configs`, 'global'), {
            siteTitle: appConfig.appTitle,
            whitelistEmails: appConfig.allowedEmails,
            updatedAt: new Date()
        }, { merge: true });
        
        modal.success('系統全域設定已儲存！');
    } catch (e: any) {
        console.error(e);
        modal.error('儲存失敗：' + (e.code === 'permission-denied' ? '您的管理員權限不足' : e.message));
    }
};

const loadCloudinaryConfig = async () => {
    try {
        // 1. 載入基本參數 (公開)
        const configDoc = await getDoc(doc(db, `${DB_PREFIX}configs`, 'cloudinary'));
        if (configDoc.exists()) {
            const data = configDoc.data();
            appConfig.cloudinary.cloudName = data.cloudName || '';
            appConfig.cloudinary.uploadPreset = data.uploadPreset || '';
            appConfig.cloudinary.isConfigured = !!appConfig.cloudinary.cloudName;
        }

        // 2. 只有登入管理員才載入機密金鑰 (用於刪除檔案)
        if (authStore.user) {
            const secretsDoc = await getDoc(doc(db, `${DB_PREFIX}configs`, 'cloudinary_secrets'));
            if (secretsDoc.exists()) {
                const sData = secretsDoc.data();
                appConfig.cloudinary.apiKey = sData.apiKey || '';
                appConfig.cloudinary.apiSecret = sData.apiSecret || '';
                console.log('[Config] Cloudinary 管理密鑰已載入');
            }
        }
    } catch (e) {
        console.warn('[Config] 載入 Cloudinary 配置失敗 (非錯誤)', e);
    }
};

const saveCloudinaryConfig = async () => {
    if (!isOwner.value) {
        modal.error('僅限看板擁有者可以同步雲端設定');
        return;
    }

    try {
        const { setDoc } = await import('firebase/firestore');
        // A. 基本參數
        await setDoc(doc(db, `${DB_PREFIX}configs`, 'cloudinary'), {
            cloudName: appConfig.cloudinary.cloudName,
            uploadPreset: appConfig.cloudinary.uploadPreset,
            updatedAt: new Date()
        }, { merge: true });

        // B. 機密參數
        await setDoc(doc(db, `${DB_PREFIX}configs`, 'cloudinary_secrets'), {
            apiKey: appConfig.cloudinary.apiKey,
            apiSecret: appConfig.cloudinary.apiSecret,
            updatedAt: new Date()
        }, { merge: true });
        
        appConfig.cloudinary.isConfigured = true;
        modal.success('Cloudinary 全域配置已分類儲存至資料庫！');
    } catch (e: any) {
        console.error(e);
        modal.error('儲存失敗：' + (e.code === 'permission-denied' ? '您的管理員權限不足' : e.message));
    }
};

onMounted(() => {
    // 載入本地快取狀態與雲端配置
    loadGlobalSettings();
    loadCloudinaryConfig();
});

onUnmounted(() => {
    // 重要：釋放 Firebase 監聽器，避免記憶體洩漏與效能下降
    boardStore.cleanup();
});



// 使用簡易快取優化格式化效能
const formatCache = new Map<string, string>();
const formatContent = (text: string) => {
    if (!text) return '';
    if (formatCache.has(text)) return formatCache.get(text)!;
    
    const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const formatted = escaped.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline break-all relative z-20" onclick="event.stopPropagation()">${url}</a>`;
    });
    
    // 限制快取大小
    if (formatCache.size > 500) formatCache.clear();
    formatCache.set(text, formatted);
    return formatted;
};

const isLiked = (postId: string) => {
    // Check both reactive state and local storage
    if (likedPosts[postId]) return true;
    return !!localStorage.getItem(`ahmo_liked_${postId}`);
};

const pendingAttachments = ref<any[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const showSettingsModal = ref(false);
const showShareModal = ref(false);
const contentRefs = ref<Record<string, HTMLTextAreaElement | null>>({});

// Guest Identity
const showGuestNameModal = ref(false);
const guestNameInput = ref('');
const pendingAction = ref<(() => void) | null>(null);
const accessDeniedType = ref<'none' | 'private'>('none');

const toggleSectionMenu = (sectionId: string) => {
    if (activeSectionMenuId.value === sectionId) {
        activeSectionMenuId.value = null;
    } else {
        activeSectionMenuId.value = sectionId;
    }
};

// Close menu when clicking outside
const closeSectionMenu = () => {
    activeSectionMenuId.value = null;
};

const requireGuestName = (action: () => void) => {
    if (authStore.user) {
        action();
        return;
    }
    if (guestName.value) {
        action();
        return;
    }
    pendingAction.value = action;
    showGuestNameModal.value = true;
};

const clearGuestName = () => {
    guestName.value = '';
    sessionStorage.removeItem('ahmo_guest_name');
};

const saveGuestName = () => {
    if (!guestNameInput.value.trim()) return;
    guestName.value = guestNameInput.value.trim();
    sessionStorage.setItem('ahmo_guest_name', guestName.value);
    showGuestNameModal.value = false;
    if (pendingAction.value) {
        pendingAction.value();
        pendingAction.value = null;
    }
};

// Image logic removed per user request


const openShareModal = () => {
  showShareModal.value = true;
};

// --- Custom Background Upload ---
const customBackgrounds = ref<{url: string, id: string, publicId?: string, resourceType?: string}[]>([]);
const isUploadingBackground = ref(false);
const backgroundFileInput = ref<HTMLInputElement | null>(null);

// Load gallery from LocalStorage (Simple, No Firebase, No CORS)
const loadCustomBackgrounds = () => {
    try {
        const saved = localStorage.getItem('ahmo_bg_gallery');
        if (saved) {
            customBackgrounds.value = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load local gallery:', e);
    }
};

// Initial load
onMounted(() => {
    loadCustomBackgrounds();
});

const saveToLocalGallery = (item: {url: string, id: string, publicId?: string, resourceType?: string}) => {
    // Keep last 20 backgrounds
    const newList = [item, ...customBackgrounds.value.filter(bg => bg.url !== item.url)].slice(0, 20);
    customBackgrounds.value = newList;
    localStorage.setItem('ahmo_bg_gallery', JSON.stringify(newList));
};

const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                let width = img.width;
                let height = img.height;

                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    resolve(blob || file);
                }, 'image/jpeg', 0.8);
            };
            img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    });
};

const handleBackgroundUpload = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files?.length) return;
    
    isUploadingBackground.value = true;
    try {
        const file = files[0];
        const compressedBlob = await compressImage(file);
        
        // Switch to Cloudinary
        const folderName = `ahmo-wall/background`;
        const result = await uploadFile(compressedBlob as any, folderName);
        
        if (result) {
            // Save to Local Gallery (No Firebase needed!)
            saveToLocalGallery({
                url: result.url,
                id: result.publicId,
                publicId: result.publicId,
                resourceType: result.resourceType
            });
            
            currentBoard.value!.backgroundImage = result.url;
            modal.success('背景上傳成功！');
        } else {
            throw new Error('Cloudinary 上傳失敗');
        }
    } catch (err: any) {
        console.error('BG Upload Failed:', err);
        modal.error('背景上傳失敗：' + (err.message || '未知錯誤'));
    } finally {
        isUploadingBackground.value = false;
        if (backgroundFileInput.value) backgroundFileInput.value.value = '';
    }
};

const handleDeleteBackground = async (bgId: string, publicId?: string, resourceType?: string) => {
    if (!confirm('確定要刪除此背景圖片嗎？這將從雲端與圖庫中永久移除。')) return;
    
    try {
        // 1. Delete from Cloudinary
        if (publicId) {
            await deleteFile(publicId, undefined, resourceType);
        }
        
        // 2. Remove from Local Gallery
        customBackgrounds.value = customBackgrounds.value.filter(bg => bg.id !== bgId);
        localStorage.setItem('ahmo_bg_gallery', JSON.stringify(customBackgrounds.value));
        
        modal.success('背景已從紀錄中移除');
    } catch (err: any) {
        console.error('Delete BG Failed:', err);
        modal.error('刪除失敗：' + (err.message || '未知錯誤'));
    }
};


const handleDragOver = (e: DragEvent) => {
  e.preventDefault();
  // Only show overlay if dragging files
  if (e.dataTransfer?.types.includes('Files')) {
    isDraggingOver.value = true;
  }
};

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault();
  if (e.relatedTarget === null) {
    isDraggingOver.value = false;
  }
};

const handlePostDragOver = (postId: string, e: DragEvent) => {
  // Ignore if not dragging files (e.g. sorting posts)
  if (!e.dataTransfer?.types.includes('Files')) return;

  e.preventDefault();
  e.stopPropagation();
  dragTargetPostId.value = postId;
};

// Section drag logic removed if unused

const handlePostDrop = async (post: Post, e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  isDraggingOver.value = false;
  dragTargetPostId.value = null;
  const files = e.dataTransfer?.files;
  if (!files?.length) return;

  const newAttachments = [...(post.attachments || [])];
  
    for (let i = 0; i < files.length; i++) {
    try {
      const folderName = `ahmo-wall/${currentBoard.value?.title || 'Shared'}`;
      const result = await uploadFile(files[i], folderName);
      if (result) {
        // Use file type instead of Cloudinary resourceType for better precision
        const fileType = files[i].type;
        const type = fileType.startsWith('image/') ? 'image' : 
                     fileType.startsWith('video/') ? 'video' : 
                     fileType.startsWith('audio/') ? 'audio' :
                     fileType === 'application/pdf' ? 'pdf' : 'link';

        // Clean data for Firestore (remove undefined values)
        const attachmentData = JSON.parse(JSON.stringify({
          type,
          url: result.url,
          publicId: result.publicId,
          resourceType: result.resourceType,
          deleteToken: result.deleteToken,
          name: result.name,
          thumbnailUrl: result.thumbnailUrl,
          format: result.format
        }));

        newAttachments.push(attachmentData);
      } else {
        throw new Error('Cloudinary 設定無效或上傳失敗，請檢查環境變數');
      }
    } catch (err: any) {
      modal.error(`上傳失敗 (${files[i].name})：${err.message || '未知錯誤'}`);
    }
  }

  await boardStore.updatePost(boardId.value, post.id, { attachments: newAttachments });
  modal.success(`已更新貼文附件 (${files.length} 檔案)`);
};

const handleNewPostDrop = async (sectionId: string, e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  isDraggingOver.value = false;
  dragTargetSectionId.value = null;
  const files = e.dataTransfer?.files;
  if (!files?.length) return;

  activeSection.value = sectionId;
  
  for (let i = 0; i < files.length; i++) {
    try {
      const folderName = `ahmo-wall/${currentBoard.value?.title || 'Shared'}`;
      const result = await uploadFile(files[i], folderName);
      if (result) {
        const fileType = files[i].type;
        const type = fileType.startsWith('image/') ? 'image' : 
                     fileType.startsWith('video/') ? 'video' : 
                     fileType.startsWith('audio/') ? 'audio' :
                     fileType === 'application/pdf' ? 'pdf' : 'link';

        const attachmentData = JSON.parse(JSON.stringify({
          type,
          url: result.url,
          publicId: result.publicId,
          resourceType: result.resourceType,
          deleteToken: result.deleteToken,
          name: result.name,
          thumbnailUrl: result.thumbnailUrl,
          format: result.format
        }));

        pendingAttachments.value.push(attachmentData);
      } else {
        throw new Error('Cloudinary 設定無效或上傳失敗');
      }
    } catch (err: any) {
      modal.error(`上傳失敗 (${files[i].name})：${err.message || '未知錯誤'}`);
    }
  }
};

const openLink = (url?: string, type = 'link') => {
  if (!url) return;
  window.open(getViewUrl(url, type), '_blank');
};

const openPreview = (url: string, type: 'image' | 'pdf') => {
  const viewUrl = getViewUrl(url, type);
  previewOriginalUrl.value = viewUrl;
  previewUrl.value = viewUrl;
  previewType.value = type;
};

// Post Detail Functions — use ID + computed for real-time updates
const expandedPostId = ref<string | null>(null);
const expandedPost = computed(() => {
  if (!expandedPostId.value) return null;
  return allFlatPosts.value.find(p => p.id === expandedPostId.value) || null;
});
const expandedPostIndex = computed(() => {
  if (!expandedPost.value) return -1;
  return allFlatPosts.value.findIndex(p => p.id === expandedPost.value!.id);
});

const openPostDetail = (post: Post) => {
  expandedPostId.value = post.id;
};
const closePostDetail = () => {
  expandedPostId.value = null;
};
const navigatePost = (direction: 'prev' | 'next') => {
  const idx = expandedPostIndex.value;
  if (idx === -1) return;
  const list = allFlatPosts.value;
  if (direction === 'prev' && idx > 0) {
    expandedPostId.value = list[idx - 1].id;
  } else if (direction === 'next' && idx < list.length - 1) {
    expandedPostId.value = list[idx + 1].id;
  }
};

const handleDrop = async (e: DragEvent) => {
  e.preventDefault();
  isDraggingOver.value = false;
  
  // If we drop globally and no post/section was targeted specifically
  if (dragTargetPostId.value || dragTargetSectionId.value) return;

  // Permission check
  if (!canContribute.value) {
      modal.error('您只能在公開或自己的看板上傳檔案');
      return;
  }

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  let targetSectionId = activeSection.value;
  if (!targetSectionId && localSections.value.length > 0) {
    targetSectionId = localSections.value[0].id;
    activeSection.value = targetSectionId;
  } else if (!targetSectionId) {
    modal.error('請先建立或選擇一個區段再上傳檔案');
    return;
  }

  handleNewPostDrop(targetSectionId, e);
};

const copyLink = async () => {
    // Generate link including config
    const url = generateShareLink();
    await navigator.clipboard.writeText(url);
    isCopyingConfig.value = true;
    setTimeout(() => {
      isCopyingConfig.value = false;
    }, 2000);
    modal.success('加密分享連結已複製！開啟此連結的人將自動套用您的資料庫設定。');
};

const pendingCount = computed(() => {
    if (!boardStore.posts) return 0;
    return boardStore.posts.filter(p => p.status === 'pending').length;
});

const handleBatchApprove = async () => {
    if (pendingCount.value === 0) return;
    if (!confirm(`確定要一次核准所有 ${pendingCount.value} 則待審貼文嗎？`)) return;
    
    try {
         const pending = boardStore.posts.filter(p => p.status === 'pending');
         const updates = pending.map(p => updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value, 'posts', p.id), { status: 'approved' }));
         await Promise.all(updates);
         modal.success(`已核准 ${pending.length} 則貼文！`);
    } catch (e: any) {
        console.error(e);
        modal.error('核准失敗: ' + e.message);
    }
};

const submitPassword = async () => {
    if (!passwordInput.value) return;
    
    // Verify locally first if possible (insecure but fast) or assume store check
    // Actually store check is better
    const valid = await boardStore.checkBoardPassword(boardId.value, passwordInput.value);
    
    if (valid) {
        showPasswordModal.value = false;
        isPasswordVerified.value = true;
        sessionStorage.setItem(`ahmo_board_pw_${boardId.value}`, 'verified');
        loadBoard(); // Reload to proceed
    } else {
        passwordError.value = '密碼錯誤，請重試。';
    }
};

// searchImages removed per user request

// Preset backgrounds with higher quality
const presetBackgrounds = [
    'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1600&q=80', // Mountains
    'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1600&q=80', // Lake
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1600&q=80', // Forest
    'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1600&q=80', // Landscape
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=80', // Field
    'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1600&q=80', // Nature
    'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=1600&q=80', // Woods
    'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=1600&q=80', // Scenic
];

// Load board data
const loadBoard = async () => {
  console.log('loadBoard called. BoardID:', boardId.value);
  if (!boardId.value) {
    router.push('/');
    return;
  }
  
  // Reset State
  isLoading.value = true;
  accessDeniedType.value = 'none';
  showPasswordModal.value = false;
  
  try {
    const boardDoc = await getDoc(doc(db, `${DB_PREFIX}boards`, boardId.value));
    
    if (boardDoc.exists()) {
      const boardData = {
        id: boardDoc.id,
        ...boardDoc.data(),
        createdAt: boardDoc.data().createdAt?.toDate ? boardDoc.data().createdAt.toDate() : new Date(),
        privacy: boardDoc.data().privacy || 'public', // Default to public
        guestPermission: boardDoc.data().guestPermission || 'edit'
      } as Board;

      // Check Permissions
      const isPasswordBoard = boardData.privacy === 'password';
      const isPrivateBoard = boardData.privacy === 'private';
      const isMyBoard = authStore.user && boardData.ownerId === authStore.user.uid;
      
      console.log('Board Loaded:', {
          id: boardData.id,
          privacy: boardData.privacy,
          owner: boardData.ownerId,
          currentUser: authStore.user?.uid,
          isMyBoard,
          isPrivate: isPrivateBoard,
          isPassword: isPasswordBoard
      });

      if (!isMyBoard) {
          if (isPrivateBoard) {
               console.warn('Private board access denied');
               accessDeniedType.value = 'private'; // Trigger Access Denied UI
               currentBoard.value = null; 
               isLoading.value = false;
               return;
          } else if (isPasswordBoard) {
               // Check session storage
               if (sessionStorage.getItem(`ahmo_board_pw_${boardData.id}`) === 'verified') {
                   isPasswordVerified.value = true;
               }

               if (!isPasswordVerified.value) {
                   console.log('Password protection triggered');
                   currentBoard.value = boardData; 
                   showPasswordModal.value = true; 
                   isLoading.value = false; 
                   return;
               }
          }
      }

      currentBoard.value = boardData;
      // Sync to store for actions to usage
      boardStore.currentBoard = boardData;
      
      // Update Title with App Title
      const appTitle = appConfig.appTitle || '阿墨互動牆';
      document.title = `${appTitle} - ${boardData.title}`;
      
      boardStore.subscribeToBoard(boardId.value);
    } else {
        modal.error('看板不存在或已被刪除');
        router.push('/');
    }
  } catch (err: any) {
    console.error('Failed to load board:', err);
    
    if (err.code === 'permission-denied') {
        console.warn('Permission denied - likely private or password protected with strict rules');
        // Treat as private since we can't read metadata to know if it's password protected
        accessDeniedType.value = 'private'; 
    } else {
        // Only show error for other failures (network, etc)
        // modal.error('讀取看板失敗'); 
    }
  } finally {
    isLoading.value = false;
  }
};

const saveBoardSettings = async () => {
    if (!currentBoard.value) return;
    
    try {
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value), {
            title: currentBoard.value.title,
            description: currentBoard.value.description,
            layout: currentBoard.value.layout,
            backgroundImage: currentBoard.value.backgroundImage,
            privacy: currentBoard.value.privacy,
            password: currentBoard.value.password || '',
            guestPermission: currentBoard.value.guestPermission || 'edit',
            moderationEnabled: currentBoard.value.moderationEnabled || false
        });
        showSettingsModal.value = false;
        modal.success('看板設定已儲存');
        
        // Reload to ensure state reflects new privacy settings (e.g. if changed to Private)
        loadBoard();
        
    } catch (err: any) {
        console.error('Save failed:', err);
        modal.error('設定儲存失敗: ' + err.message);
    }
};

// Watch for route changes
watch(() => route.params.id, (newId) => {
  console.log('Route param changed:', newId);
  if (newId) {
    loadBoard();
  }
}, { immediate: true });

// Watch for auth state changes (in case of page refresh)
watch(() => authStore.user, (user) => {
    console.log('Auth state changed:', user);
    if (user && route.params.id) {
        loadBoard();
    }
});

onMounted(() => {
    console.log('DashboardView mounted');
    if (route.query.action === 'settings') {
        showSettingsModal.value = true;
    }
});

const focusElement = (id: string) => {
  nextTick(() => {
    document.getElementById(id)?.focus();
  });
};

// Inline Editing Functions
// Inline Editing Functions
const startEditPost = (post: Post) => {
  // Allow if: Author OR Guest Author OR Board Owner
  const isAuthor = post.author.uid === authStore.user?.uid;
  const isGuestAuthor = !authStore.user && post.author.displayName === guestName.value && !!guestName.value;
  const isBoardOwner = currentBoard.value?.ownerId === authStore.user?.uid;

  if (!isAuthor && !isGuestAuthor && !isBoardOwner) return;
  editingPostId.value = post.id;
  editPostTitle.value = post.title || '';
  editContent.value = post.content;
  editPostColor.value = post.color || '#ffffff';
  pendingAttachments.value = []; // Clear for edit session
  
  if (post.poll) {
    editPollOptions.value = post.poll.options.map(opt => ({ id: opt.id, text: opt.text }));
  } else {
    editPollOptions.value = [];
  }

  nextTick(() => {
    const textarea = document.getElementById(`edit-post-${post.id}`) as HTMLTextAreaElement;
    textarea?.focus();
  });
};

const saveEditPost = async (post: Post) => {
  if (!editingPostId.value) return;
  const finalAttachments = [...(post.attachments || []), ...pendingAttachments.value];
  
    // If it was a poll, update poll question and options text
    const isPollDirty = post.poll && JSON.stringify(editPollOptions.value) !== JSON.stringify(post.poll.options.map(o => ({ id: o.id, text: o.text })));
    
    if (editContent.value !== post.content || editPostTitle.value !== (post.title || '') || editPostColor.value !== (post.color || '#ffffff') || pendingAttachments.value.length > 0 || isPollDirty) {
      const updateData: Partial<Post> = { 
        title: editPostTitle.value.trim(),
        content: editContent.value,
        color: editPostColor.value,
        attachments: finalAttachments
      };

      if (post.poll) {
        updateData.poll = JSON.parse(JSON.stringify({
          ...post.poll,
          question: editPostTitle.value.trim(),
          options: post.poll.options.map((opt, i) => {
              const edited = editPollOptions.value[i]; 
              return {
                  ...opt,
                  text: edited ? edited.text : opt.text
              };
          })
        }));
      }

      await boardStore.updatePost(boardId.value, post.id, updateData);
      modal.success('貼文已更新');
    }
  editingPostId.value = null;
  pendingAttachments.value = [];
};

const deleteAttachment = async (post: Post, index: number) => {
    const confirmed = await modal.confirm('確定要移除此附件嗎？', '移除附件', 'error');
    if (!confirmed) return;
    
    // Delete from Cloudinary
    const att = post.attachments![index];
    await deleteFile(att.publicId, att.deleteToken, att.resourceType);
    
    const newAttachments = [...(post.attachments || [])];
    newAttachments.splice(index, 1);
    
    await boardStore.updatePost(boardId.value, post.id, { attachments: newAttachments });
};

const removePendingAttachment = async (index: number) => {
    const att = pendingAttachments.value[index];
    if (att && att.publicId) {
        // True delete from Cloudinary immediately
        await deleteFile(att.publicId, att.deleteToken, att.resourceType);
    }
    pendingAttachments.value.splice(index, 1);
};

const cancelEditPost = async () => {
  if (editingPostId.value) {
    const originalPost = allFlatPosts.value.find(p => p.id === editingPostId.value);
    if (originalPost) {
       const isDirty = 
         editContent.value !== originalPost.content || 
         editPostTitle.value !== (originalPost.title || '') ||
         editPostColor.value !== (originalPost.color || '#ffffff') || 
         pendingAttachments.value.length > 0;

       if (isDirty) {
          const confirmed = await modal.confirm('你有未儲存的變更，確定要捨棄嗎？', '捨棄變更', 'warning');
          if (!confirmed) return;
       }
    }
  }

  // If there are pending new attachments, delete them from Cloudinary before cancelling
  if (pendingAttachments.value.length > 0) {
      for (const att of pendingAttachments.value) {
          await deleteFile(att.publicId, att.deleteToken, att.resourceType);
      }
  }
  editingPostId.value = null;
  editPostTitle.value = '';
  editContent.value = '';
  editPostColor.value = '#ffffff';
  pendingAttachments.value = [];
};


const startEditSection = (section: Section) => {
  // Check if owner (simplified check for now, ideally check board owner)
  editingSectionId.value = section.id;
  editTitle.value = section.title;
  nextTick(() => {
    const input = document.getElementById(`edit-section-${section.id}`) as HTMLInputElement;
    input?.focus();
  });
};

const saveEditSection = async (section: Section) => {
  if (!editingSectionId.value) return;
  if (editTitle.value !== section.title && editTitle.value.trim()) {
    // Update section title in Firestore directly (since we don't have updateSection in store yet)
    await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value, 'sections', section.id), {
       title: editTitle.value.trim() 
    });
  }
  editingSectionId.value = null;
};

const handleDeleteSection = async (sectionId: string) => {
    const confirmed = await modal.confirm('確定要刪除此區段嗎？區段內的貼文也會一併刪除。', '刪除區段', 'error');
    if (confirmed) {
        await boardStore.deleteSection(boardId.value, sectionId);
        modal.success('區段已刪除');
    }
};

const startEditBoardTitle = () => {
  if (currentBoard.value?.ownerId !== authStore.user?.uid) return;
  editingBoardTitle.value = true;
  editTitle.value = currentBoard.value?.title || '';
  nextTick(() => {
    document.getElementById('edit-board-title')?.focus();
  });
};

const saveEditBoardTitle = async () => {
  if (!editingBoardTitle.value || !currentBoard.value) return;
  if (editTitle.value !== currentBoard.value.title && editTitle.value.trim()) {
    currentBoard.value.title = editTitle.value.trim();
    await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value), { title: editTitle.value.trim() });
  }
  editingBoardTitle.value = false;
};

const startEditBoardDesc = () => {
    if (currentBoard.value?.ownerId !== authStore.user?.uid) return;
    editingBoardDesc.value = true;
    editDesc.value = currentBoard.value?.description || '';
    nextTick(() => {
        document.getElementById('edit-board-desc')?.focus();
    });
};

const saveEditBoardDesc = async () => {
    if (!editingBoardDesc.value || !currentBoard.value) return;
    if (editDesc.value !== currentBoard.value.description) {
        currentBoard.value.description = editDesc.value.trim();
        await updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value), { description: editDesc.value.trim() });
    }
    editingBoardDesc.value = false;
};


const goHome = () => {
  router.push('/');
};

// Handle file selection
const handleFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  const file = input.files[0];

  try {
    const folderName = `ahmo-wall/${currentBoard.value?.title || 'Shared'}`;
    const result = await uploadFile(file, folderName);
    if (result) {
        const fileType = file.type;
        const type = fileType.startsWith('image/') ? 'image' : 
                     fileType.startsWith('video/') ? 'video' : 
                     fileType.startsWith('audio/') ? 'audio' :
                     fileType === 'application/pdf' ? 'pdf' : 'link';

        const attachmentData = JSON.parse(JSON.stringify({
            type,
            url: result.url,
            publicId: result.publicId,
            resourceType: result.resourceType,
            deleteToken: result.deleteToken,
            name: result.name,
            thumbnailUrl: result.thumbnailUrl,
            format: result.format
        }));
        
        pendingAttachments.value.push(attachmentData);
    }
  } catch (err: any) {
    console.error('Upload failed:', err);
    modal.error('上傳失敗：' + (err.message || '未知錯誤'));
  }
  
  // Clear input
  input.value = '';
};

// Parse YouTube URL
const parseYouTubeUrl = (url: string): string | null => {
  const regex = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
};

// Add YouTube link
const showYouTubeInput = ref(false);
const youtubeUrlInput = ref('');
const addYouTubeLink = () => {
  showYouTubeInput.value = true;
  youtubeUrlInput.value = '';
};

const confirmAddYouTube = () => {
  if (!youtubeUrlInput.value) return;
  const videoId = parseYouTubeUrl(youtubeUrlInput.value);
  if (!videoId) {
    modal.error('無效的 YouTube 網址');
    return;
  }
  const attachmentData = JSON.parse(JSON.stringify({
    type: 'youtube',
    shareUrl: `https://www.youtube.com/embed/${videoId}`,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    name: 'YouTube 影片'
  }));
  pendingAttachments.value.push(attachmentData);
  showYouTubeInput.value = false;
};



const handleWallReorder = async () => {
    if (!isOwner.value || currentSort.value !== 'manual') return;
    
    try {
        const orderedIds = localWallPosts.value.map(p => p.id);
        const updates = orderedIds.map((id, index) => 
            updateDoc(doc(db, `${DB_PREFIX}boards`, boardId.value, 'posts', id), {
                order: index
            })
        );
        await Promise.all(updates);
    } catch (err: any) {
        console.error('Wall reorder failed:', err);
        modal.error('排序儲存失敗：' + (err.message || '未知錯誤'));
    }
};

// Submit post
// Submit post
const submitPost = async (sectionId: string) => {
  console.log('[Dashboard] submitting post, isPoll:', isPoll.value, 'sectionId:', sectionId);
  if (!newPostContent.value && pendingAttachments.value.length === 0 && !isPoll.value) return;
  
  if (isPoll.value) {
     const validOptions = pollOptions.value.filter(o => o.text.trim() !== '');
     if (validOptions.length < 2) {
       modal.error('投票至少需要兩個選項');
       return;
     }

     requireGuestName(async () => {
        await boardStore.createPost(boardId.value, {
          sectionId,
          title: newPostTitle.value || '投票', // Default title for poll
          content: newPostContent.value,
          attachments: pendingAttachments.value,
          color: newPostColor.value,
          likes: 0,
          poll: {
             question: newPostTitle.value || '投票',
             options: validOptions.map(o => ({ id: o.id, text: o.text, voters: [] })),
             allowMultiple: false,
             totalVotes: 0
          }
        }, guestName.value);
        
        // Reset
        newPostContent.value = '';
        newPostTitle.value = '';
        newPostColor.value = '#ffffff';
        pendingAttachments.value = [];
        activeSection.value = null;
        isPoll.value = false;
        pollOptions.value = [{ id: '1', text: '' }, { id: '2', text: '' }];
     });
     return;
  }

  requireGuestName(async () => {
      await boardStore.createPost(boardId.value, {
        sectionId,
        title: newPostTitle.value,
        content: newPostContent.value,
        attachments: pendingAttachments.value,
        color: newPostColor.value,
        likes: 0
      }, guestName.value);
      
      newPostContent.value = '';
      newPostTitle.value = '';
      newPostColor.value = '#ffffff';
      pendingAttachments.value = [];
      activeSection.value = null;
  });
};

// Create new section
const showSectionPrompt = ref(false);
const newSectionName = ref('');
const createSection = () => {
  showSectionPrompt.value = true;
  newSectionName.value = '';
};

const confirmCreateSection = async () => {
  if (!newSectionName.value.trim()) return;
  await boardStore.createSection(boardId.value, newSectionName.value.trim());
  showSectionPrompt.value = false;
};



// openAddPost removed as it was unused


// Like post
// Like post
const handleLike = async (post: Post) => {
  if (isLiked(post.id)) return;
  
  // Create temp state for immediate feedback? 
  // No, let's wait for server but handle error
  try {
      await boardStore.likePost(boardId.value, post.id, (post.likes || 0) + 1);
      localStorage.setItem(`ahmo_liked_${post.id}`, 'true');
      likedPosts[post.id] = true;
  } catch (err: any) {
      console.error('Like failed:', err);
      if (err.code === 'permission-denied') {
          modal.error('權限不足：訪客可能無法對此看板按讚，請檢查規則設定。');
      }
  }
};

// Delete post
const handleDelete = async (post: Post) => {
  const confirmed = await modal.confirm('確定要刪除這則貼文嗎？', '刪除貼文', 'error');
  if (!confirmed) return;

  // Delete all Cloudinary attachments
  if (post.attachments?.length) {
    for (const att of post.attachments) {
        // 使用新版 deleteFile，優先嘗試永久刪除
        await deleteFile(att.publicId, att.deleteToken, att.resourceType);
    }
  }

  await boardStore.deletePost(boardId.value, post.id);
};

// Handle Comments
const toggleComments = (post: Post) => {
  if (activeCommentPostId.value === post.id) {
    activeCommentPostId.value = null;
  } else {
    activeCommentPostId.value = post.id;
  }
};

const submitComment = async (post: Post) => {
  const content = commentInputs[post.id];
  if (!content?.trim()) return;

  requireGuestName(async () => {
      await boardStore.addComment(boardId.value, post.id, content, guestName.value);
      commentInputs[post.id] = '';
      // 自動展開留言區
      expandedComments[post.id] = true;
  });
};

const handleDeleteComment = async (post: Post, commentId: string) => {
  const confirmed = await modal.confirm('確定要刪除這則留言嗎？', '刪除留言', 'error');
  if (!confirmed) return;
  await boardStore.deleteComment(boardId.value, post.id, commentId);
};






const handleApprovePost = async (postId: string) => {
    await boardStore.approvePost(boardId.value, postId);
    modal.success('貼文已核准');
};

// Poll Logic
const isPoll = ref(false);
const pollOptions = ref([{ id: '1', text: '' }, { id: '2', text: '' }]);
const editPollOptions = ref<{ id: string; text: string }[]>([]);

const addPollOption = () => {
  pollOptions.value.push({ id: Date.now().toString(), text: '' });
};

const removePollOption = (index: number) => {
  if (pollOptions.value.length > 2) {
    pollOptions.value.splice(index, 1);
  }
};

const handleVote = async (post: Post, optionId: string) => {
  // Check permission (Owner, Guest Name, or Login)
  if (!authStore.user && !guestName.value) {
      requireGuestName(() => handleVote(post, optionId));
      return;
  }

  const userId = authStore.user?.uid || (guestName.value ? 'guest:' + guestName.value : 'anonymous');
  
  try {
    await boardStore.votePoll(boardId.value, post.id, optionId, userId);
  } catch (err: any) {
    console.error('Voting failed:', err);
    modal.error('投票失敗：' + err.message);
  }
};

const handleApproveComment = async (postId: string, commentId: string) => {
    await boardStore.approveComment(boardId.value, postId, commentId);
    modal.success('留言已核准');
};



// Delete Board
const deleteBoard = async () => {
  const confirmed = await modal.confirm('警告：此動作無法復原！確定要刪除整個看板以及所有貼文與雲端附件嗎？', '刪除看板', 'error');
  if (!confirmed) return;
  
  try {
    // 1. 只有管理員能執行雲端清理，因為管理員才有 Secret
    if (authStore.user) {
        // 抓取所有貼文以利清理附件
        const { getDocs, collectionGroup, query, where } = await import('firebase/firestore');
        // 注意：這裡直接抓取看板下的所有貼文。
        // 為簡單起見，我們利用 boardStore 已經有的貼文數據
        const allPosts = boardStore.posts || [];
        
        for (const post of allPosts) {
            if (post.attachments?.length) {
                for (const att of post.attachments) {
                    // 這會使用 admin secret 刪除雲端檔案
                    await deleteFile(att.publicId, att.deleteToken, att.resourceType);
                }
            }
        }
    }

    // 2. 刪除看板與子集合 (子集合刪除建議由後端處理，但前端可以用遞迴)
    await boardStore.deleteBoard(boardId.value);
    
    modal.success('看板及其附件已完整清理');
    router.push('/');
  } catch (err: any) {
    console.error('Failed to delete board:', err);
    modal.error('刪除看板失敗：' + err.message);
  }
};

// Utility for relative time
const formatRelativeTime = (date: Date) => {
  if (!date) return '剛剛';
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 30000) return '剛剛'; // Within 30 seconds
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`; // Within 1 hour
  if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // Same day
  return date.toLocaleDateString(); // Older
};
</script>

<template>
  <div class="h-screen bg-cover bg-center bg-no-repeat bg-fixed flex flex-col font-sans overflow-hidden transition-all duration-500 relative"
       @dragover.prevent="handleDragOver"
       @dragleave="handleDragLeave"
       @drop.prevent="handleDrop"
       @click="closeSectionMenu"
       :style="{ 
         backgroundImage: currentBoard?.backgroundImage ? `url(${currentBoard.backgroundImage})` : '',
         backgroundColor: currentBoard?.backgroundColor || '#1a1a2e'
       }">
    
    <!-- Drag & Drop Overlay -->
    <div v-if="isDraggingOver" 
         class="absolute inset-0 z-[100] bg-emerald-600/40 backdrop-blur-md flex items-center justify-center pointer-events-none">
      <div class="bg-white p-12 rounded-[2.5rem] shadow-2xl scale-110 border-4 border-dashed border-emerald-500 animate-[bounce-custom_2s_infinite] flex flex-col items-center">
        <div class="text-emerald-500 mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </div>
        <p class="text-2xl font-bold text-gray-800 tracking-tight">放置檔案以開始上傳</p>
        <p class="text-gray-500 mt-2 font-medium">檔案將上傳至當前或第一個區段</p>
      </div>
    </div>

    <!-- Upload Progress Overlay -->
    <transition name="fade">
      <div v-if="cloudinaryUploading" 
           class="fixed inset-0 z-[150] bg-black/60 backdrop-blur-md flex items-center justify-center px-4">
        <div class="bg-white p-10 rounded-[2rem] shadow-2xl w-full max-w-md transform scale-100 transition-all border border-emerald-100">
          <div class="flex items-center justify-between mb-6">
            <span class="text-lg font-bold text-gray-800 flex items-center gap-3">
              <span class="flex items-center justify-center w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.71-2.13.71-2.13s-1.29 0-2.13-.71c-.87-.73-.58-1.58-.58-1.58z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.5-1 1-4c1.5 0 3 0 3 0s.5-1.5 0-3c3 1 4 5 4 5"/></svg>
              </span>
              正在上傳檔案...
            </span>
            <span class="text-base font-black text-emerald-600 tabular-nums">{{ uploadProgress }}%</span>
          </div>
          <div class="w-full h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div class="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                 :style="{ width: `${uploadProgress}%` }"></div>
          </div>
          <p class="text-gray-400 text-xs text-center">請勿關閉視窗，等待上傳完成</p>
        </div>
      </div>
    </transition>
    
    <!-- Loading State -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center bg-gray-900">
      <div class="text-center">
        <div class="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p class="text-white/60">載入中...</p>
      </div>
    </div>
    
    <!-- Main Content -->
    <template v-else>
      <!-- Overlay -->
      <div class="absolute inset-0 bg-slate-950/20 pointer-events-none z-0"></div>

      <!-- Header -->
      <header class="bg-slate-900/60 backdrop-blur-3xl border-b border-white/10 px-6 py-3.5 flex justify-between items-center z-40 sticky top-0 shadow-2xl transition-all duration-300">
        <div class="flex items-center gap-4">
          <!-- Title -->
          <button @click="goHome" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-all border border-white/5 hover:border-white/20 active:scale-95 group">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover:-translate-x-0.5 transition-transform"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
          
          <div class="flex-1 min-w-0">
            <!-- Editable Title -->
            <input v-if="editingBoardTitle && isOwner"
                   id="edit-board-title"
                   v-model="editTitle"
                   @blur="saveEditBoardTitle"
                   @keydown.enter="saveEditBoardTitle"
                   class="bg-transparent border-b-2 border-emerald-500 text-xl font-black text-white tracking-tight w-full outline-none py-1 transition-all"
            />
            <h1 v-else @dblclick="isOwner && startEditBoardTitle()" 
                :class="['text-xl font-black text-white tracking-tight rounded-lg px-2 -ml-2 transition-all duration-300 flex items-center gap-2', isOwner ? 'cursor-pointer hover:bg-white/10 hover:shadow-lg' : 'cursor-default']">
                {{ currentBoard?.title || '阿墨雲牆' }}
                <svg v-if="isOwner" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="opacity-0 group-hover:opacity-40"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </h1>

            <!-- Editable Description -->
            <input v-if="editingBoardDesc && isOwner"
                   id="edit-board-desc"
                   v-model="editDesc"
                   @blur="saveEditBoardDesc"
                   @keydown.enter="saveEditBoardDesc"
                   class="bg-transparent border-b border-emerald-400/50 text-xs text-slate-300 w-full outline-none opacity-80"
            />
            <p v-else @dblclick="isOwner && startEditBoardDesc()" 
               :class="['text-xs text-slate-400 font-bold tracking-tight rounded px-2 -ml-2 transition-all min-h-[1rem] line-clamp-1 opacity-80', isOwner ? 'cursor-pointer hover:bg-white/5' : 'cursor-default']">
               {{ currentBoard?.description || (isOwner ? '✨ 點兩下新增專屬描述...' : '') }}
            </p>
          </div>

          <!-- Permission Badge (For Guests) -->
          <div v-if="!isOwner && currentBoard" class="ml-2 flex items-center gap-2">
            <div v-if="canContribute" class="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20 shadow-sm animate-pulse-slow">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span class="text-[10px] font-black uppercase tracking-widest">可編輯</span>
            </div>
            <div v-else class="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20 shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>
              <span class="text-[10px] font-black uppercase tracking-widest">唯讀模式</span>
            </div>
          </div>
        </div>
        
        <div class="flex items-center gap-4">
          <!-- Sort Dropdown (Admin Only) -->
          <div v-if="isOwner" class="relative group/sort">
            <select v-model="currentSort" 
                    class="appearance-none bg-white/5 hover:bg-white/10 text-slate-200 pl-4 pr-10 py-2.5 rounded-2xl text-sm font-bold outline-none border border-white/5 focus:border-emerald-500 transition-all cursor-pointer shadow-lg backdrop-blur-md">
                <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value" class="text-slate-900 bg-white">
                    {{ opt.label }}
                </option>
            </select>
            <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover/sort:text-emerald-400 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </div>

          <button v-if="isOwner && pendingCount > 0" 
                  @click="handleBatchApprove" 
                  class="bg-amber-500/90 hover:bg-amber-500 text-white px-5 py-2.5 rounded-2xl text-[11px] font-black transition-all flex items-center gap-2 shadow-[0_8px_20px_rgba(245,158,11,0.3)] border border-white/10 active:scale-95 group/batch">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover/batch:rotate-12 transition-transform"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            核准 ({{ pendingCount }})
          </button>
          
          <button v-if="isOwner" @click="openShareModal" class="bg-emerald-600/90 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-[10px] font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 border border-white/10 active:scale-95">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            分享
          </button>

          <button v-if="localSections.length > 0" @click="startSlideshow" class="bg-indigo-600/90 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-[10px] font-black transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20 border border-white/10 active:scale-95 ml-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>
            播放
          </button>

          <button v-if="isOwner" @click="showSettingsModal = true" class="w-9 h-9 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center text-white border border-white/10 hover:border-emerald-500/50 transition-all active:scale-95 group shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover:rotate-90 transition-transform duration-500"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>

          <div v-if="authStore.user?.photoURL" class="relative group/avatar">
            <img :src="authStore.user.photoURL" referrerpolicy="no-referrer" class="w-10 h-10 rounded-2xl border-2 border-emerald-500/30 shadow-lg cursor-pointer transition-transform hover:scale-110 active:scale-95" />
            <div class="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-slate-900 rounded-full shadow-emerald-500/50 shadow-sm"></div>
          </div>
          <div v-else-if="!authStore.user" class="text-[11px] font-black tracking-widest uppercase text-slate-400 bg-white/5 border border-white/5 px-4 py-2 rounded-2xl flex items-center gap-3 shadow-lg">
             <div class="w-1.5 h-1.5 bg-slate-500 rounded-full animate-pulse"></div>
             <span v-if="guestName" class="text-white">{{ guestName }}</span>
             <span v-else>訪客</span>
             <button v-if="guestName" @click="clearGuestName" class="hover:text-rose-500 transition-colors bg-white/5 rounded p-0.5">
               <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
             </button>
          </div>
        </div>
      </header>
      
      <!-- Access Denied UI -->
      <Teleport to="body">
        <div v-if="accessDeniedType === 'private'" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/95 backdrop-blur-3xl">
            <div class="bg-gray-900 border border-white/5 p-12 rounded-[2.5rem] text-center max-w-lg w-full shadow-2xl animate-fade-in-up flex flex-col items-center">
                <div class="w-24 h-24 bg-red-500/10 text-red-500 rounded-3xl flex items-center justify-center mb-8 border border-red-500/20 shadow-lg shadow-red-900/20">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                </div>
                <h2 class="text-3xl font-black text-white mb-4 tracking-tight">存取權限受阻</h2>
                <p class="text-gray-400 mb-10 text-lg font-medium leading-relaxed">此看板目前設定為「私密狀態」或是您未獲得授權，僅擁有者可以檢視內容。</p>
                <button @click="$router.push('/')" class="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black transition-all transform hover:scale-[1.02] active:scale-95 shadow-xl shadow-emerald-900/40 flex items-center justify-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                  返回首頁控制台
                </button>
            </div>
        </div>
      </Teleport>

      <!-- Shelf Layout -->
      <main v-if="currentBoard && accessDeniedType === 'none' && !showPasswordModal && (currentBoard.layout === 'shelf' || !currentBoard.layout)" 
            @drop.prevent="handleDrop" 
            @dragover.prevent="handleDragOver" 
            @dragleave="handleDragLeave"
            class="flex-1 overflow-x-auto overflow-y-hidden p-8 gap-8 flex items-start">
        
        <!-- Empty State Guide -->
        <div v-if="localSections.length === 0 && isOwner" 
             class="flex-1 flex flex-col items-center justify-center h-full min-h-[400px] animate-fade-in">
          <div class="w-32 h-32 bg-white/5 border border-white/5 rounded-[3rem] flex items-center justify-center text-6xl mb-8 shadow-2xl backdrop-blur-xl animate-bounce-slow">
            🏗️
          </div>
          <h2 class="text-3xl font-black text-white mb-4 tracking-tight">打造您的第一個區段</h2>
          <p class="text-slate-400 mb-10 text-lg font-medium text-center max-w-md leading-relaxed">在這個空間裡，您可以按主題或進度分欄。點擊右側的按鈕開始您的創作之旅！</p>
          <button @click="createSection" 
                  class="px-10 py-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[2rem] font-black text-xl transition-all shadow-2xl shadow-emerald-900/40 active:scale-95 flex items-center gap-4">
            <span class="text-3xl">+</span>
            立即新增區段
          </button>
        </div>
        
        <!-- Sections (Columns) -->
        <draggable 
           v-model="localSections"
           item-key="id"
           class="flex gap-6 items-start h-full"
           handle=".section-drag-handle"
           :disabled="!isOwner"
           @change="(evt: any) => {
             if (evt.moved) {
               boardStore.reorderSections(boardId, localSections.map(s => s.id));
             }
           }"
        >
          <template #item="{ element: section }">
            <div class="flex-shrink-0 w-[80vw] sm:w-[260px] md:w-[280px] flex flex-col max-h-full bg-slate-900/60 backdrop-blur-xl rounded-[2rem] border border-white/5 overflow-hidden shadow-lg transition-transform duration-300 hover:border-white/10 will-change-transform">
              <!-- Section Header (Editable) -->
              <div class="p-5 border-b border-white/10 flex justify-between items-center section-drag-handle cursor-move group/shead"
                   :style="{ borderTopColor: section.color, borderTopWidth: '4px' }">
                
                <input v-if="editingSectionId === section.id"
                       :id="`edit-section-${section.id}`"
                       v-model="editTitle"
                       @blur="saveEditSection(section)"
                       @keydown.enter="saveEditSection(section)"
                       class="bg-transparent border-b border-white text-lg font-bold text-white w-full outline-none"
                />
                <h2 v-else @dblclick="startEditSection(section)" 
                    class="font-bold text-white text-lg cursor-pointer hover:bg-white/10 rounded px-1 transition-colors flex-1">
                    {{ section.title }}
                </h2>
                <div class="flex items-center gap-1 relative">
                    <span class="text-xs text-gray-400 mr-2">{{ (localPostsBySection[section.id] || []).length }} 則</span>
                    
                    <button v-if="canContribute" @click="activeSection = section.id" 
                            class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-emerald-500/20 text-emerald-400/70 hover:text-emerald-400 transition-all active:scale-90 group/additem"
                            title="新增貼文">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/additem:rotate-90 transition-transform"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                    </button>
                    
                    <button @click.stop="toggleSectionMenu(section.id)"
                            class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-all active:scale-90">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                    </button>
                    
                    <!-- Section Menu Dropdown -->
                    <div v-if="activeSectionMenuId === section.id" 
                         class="absolute right-0 top-10 w-48 bg-gray-900 rounded-xl shadow-2xl border border-white/10 z-50 overflow-hidden animate-scale-in origin-top-right">
                        <button @click="activeSection = section.id; closeSectionMenu()" class="w-full text-left px-4 py-3 text-xs font-bold text-gray-300 hover:bg-emerald-500/10 hover:text-emerald-400 flex items-center gap-3 transition-all group/menuitem">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/menuitem:rotate-90 transition-transform"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                          新增貼文
                        </button>
                        <div class="h-px bg-white/5 mx-2"></div>
                        <button v-if="canEdit" @click="startEditSection(section); closeSectionMenu()" class="w-full text-left px-4 py-3 text-xs font-bold text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-3 transition-all group/menuitem">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover/menuitem:rotate-12 transition-transform"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                          重新命名
                        </button>
                        <button v-if="canEdit" @click="handleDeleteSection(section.id); closeSectionMenu()" class="w-full text-left px-4 py-3 text-xs font-bold text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-3 transition-all group/menuitem border-t border-white/5">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover/menuitem:-rotate-12 transition-transform"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                          刪除區段
                        </button>
                    </div>
                </div>
              </div>

              <!-- Posts Container -->
              <div class="flex-1 overflow-y-auto p-3 space-y-4">
                
                <!-- Inline Post Form (Moved to top) -->
                <div v-if="activeSection === section.id" class="mb-5 bg-white rounded-xl p-3 shadow-lg animate-scale-in border-2 border-emerald-500">
                  <input v-model="newPostTitle" 
                         type="text" 
                         :placeholder="isPoll ? '投票問題...' : '標題 (選填)...'" 
                         :id="`input-${section.id}`"
                         class="w-full text-sm font-bold text-gray-800 placeholder-gray-400 bg-transparent outline-none mb-2"
                         @keydown.enter.prevent="contentRefs[section.id]?.focus()">
                  


                   <!-- Poll Options Input -->
                   <div v-if="isPoll" class="space-y-2 mb-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div v-for="(option, idx) in pollOptions" :key="option.id" class="flex items-center gap-2">
                          <span class="text-xs font-bold text-slate-400 w-4 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                          <input v-model="option.text" type="text" :placeholder="`選項 ${idx + 1}`" class="flex-1 w-full min-w-0 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-emerald-400 transition-colors" />
                          <button @click="removePollOption(idx)" class="text-slate-300 hover:text-red-400 p-1" :disabled="pollOptions.length <= 2">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                      </div>
                      <button @click="addPollOption" class="w-full py-1.5 border border-dashed border-slate-300 rounded text-slate-400 text-xs font-bold hover:bg-white hover:text-emerald-500 hover:border-emerald-300 transition-all flex items-center justify-center gap-1">
                          + 新增選項
                      </button>
                   </div>
                  
                   <!-- Color Picker for New Post -->
                   <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                      <button v-for="color in POST_COLORS" :key="color.value"
                              @mousedown.prevent="newPostColor = color.value"
                              class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                              :class="{ 'ring-2 ring-emerald-500 ring-offset-1': newPostColor === color.value }"
                              :style="{ backgroundColor: color.value }"
                              :title="color.name">
                      </button>
                   </div>
                  
                  <textarea v-model="newPostContent" 
                            :ref="(el) => { if(el) contentRefs[section.id] = el as HTMLTextAreaElement }"
                            :style="{ backgroundColor: newPostColor !== '#ffffff' ? newPostColor : '#ffffff' }"
                            :placeholder="isPoll ? '補充說明 (選填)...' : '輸入內容...'" 
                            class="w-full text-sm text-slate-900 font-medium placeholder-slate-500 bg-transparent outline-none resize-none h-20 mb-2"
                            @keydown.ctrl.enter="submitPost(section.id)"></textarea>
                  
                  <!-- Attachments Preview -->
                  <div v-if="pendingAttachments.length" class="flex gap-2 mt-2 flex-wrap pb-2 mb-2 border-b border-gray-100">
                    <div v-for="(att, idx) in pendingAttachments" :key="idx" 
                         class="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 group">
                      <img v-if="att.thumbnailUrl" 
                           :src="att.type === 'image' ? getViewUrl(att.url) : att.thumbnailUrl" 
                           referrerpolicy="no-referrer"
                           class="w-full h-full object-cover">
                      <div v-else class="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 p-1">
                         <span class="text-xl">{{ att.type === 'pdf' ? '📄' : att.type === 'youtube' ? '🎬' : '🔗' }}</span>
                         <p class="text-[8px] text-gray-400 truncate w-full text-center mt-1">{{ att.name }}</p>
                      </div>
                      <button @click="removePendingAttachment(idx)" 
                              class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-lg transition-transform hover:scale-110 z-10">×</button>
                    </div>
                  </div>

                  <div class="flex justify-between items-center mt-3">
                    <div class="flex gap-2">
                      <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                      <button @click="fileInput?.click()" :disabled="cloudinaryUploading" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500 disabled:opacity-50 transition-colors flex items-center gap-1" title="上傳圖片或檔案">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                      </button>
                      <button @click="addYouTubeLink" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="加入YouTube連結">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
                      </button>
                      <button @click="isPoll = !isPoll" 
                              class="p-2 rounded-lg transition-all border"
                              :class="isPoll ? 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm' : 'hover:bg-gray-100 text-gray-500 border-transparent'"
                              title="發起投票">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="8" x2="16" y2="8"/></svg>
                      </button>
                    </div>
                    <div class="flex gap-2">
                      <button @click="activeSection = null; pendingAttachments = []" class="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">取消</button>
                      <button @click="submitPost(section.id)" class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg font-bold shadow-md transition-all">發佈</button>
                    </div>
                  </div>
                </div>

                <draggable
                  v-model="localPostsBySection[section.id]"
                  group="posts"
                  item-key="id"
                  class="flex flex-col gap-4 min-h-[50px] pb-4"
                  :disabled="currentSort !== 'manual' || !isOwner"
                  handle=".post-drag-handle"
                  :delay="300"
                  :delay-on-touch-only="true"
                  :touch-start-threshold="15"
                  :force-fallback="true"
                  :fallback-tolerance="15"
                  :animation="150"
                  :scroll-sensitivity="100"
                  ghost-class="opacity-0"
                  @change="(evt: any) => {
                    if (evt.added || evt.moved) {
                       boardStore.reorderPosts(boardId, section.id, (localPostsBySection[section.id] || []).map(p => p.id));
                    }
                  }"
                >
                  <template #item="{ element: post }">
                    <div class="rounded-[2rem] p-5 shadow-lg border border-white/5 hover:shadow-2xl hover:border-white/10 transition-all duration-500 group relative h-fit hover:-translate-y-1 active:scale-[0.98] outline-none cursor-pointer will-change-transform"
                         style="content-visibility: auto; contain-intrinsic-size: 100px 300px;"
                         :class="{ 'ring-4 ring-emerald-500 ring-inset': dragTargetPostId === post.id }"
                         :style="{ backgroundColor: post.color || 'rgba(255,255,255,0.95)' }"
                         @dragover="handlePostDragOver(post.id, $event)"
                         @dragleave="dragTargetPostId = null"
                         @drop="handlePostDrop(post, $event)"
                         @click="openPostDetail(post)">
                      
                       <!-- Drop Overlay Internal -->
                      <div v-if="dragTargetPostId === post.id" class="absolute inset-0 bg-emerald-500/20 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-xl pointer-events-none">
                        <span class="text-white font-bold bg-emerald-600 px-3 py-1 rounded-full text-xs">放開以上傳附件</span>
                      </div>


                      <!-- Moderation Badge -->
                      <div v-if="post.status === 'pending'" 
                           class="absolute top-0 left-0 px-3 py-1 bg-amber-500 text-white text-[10px] font-bold rounded-br-xl rounded-tl-xl shadow-sm z-20 pointer-events-none flex items-center gap-1.5 uppercase tracking-wider">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="animate-spin-slow"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        待審核
                      </div>

                       <!-- Post Header (Invisible Drag Area) -->
                        <div class="flex justify-between items-start mb-3 post-drag-handle cursor-move select-none p-1 -m-1 rounded-xl hover:bg-black/5 transition-all" @click.stop>
                         <div class="flex items-center gap-2 pointer-events-none">
                           <img v-if="post.author.photoURL" 
                                :src="post.author.photoURL" 
                                @error="handleImageError(post.author)"
                                referrerpolicy="no-referrer"
                                class="w-8 h-8 rounded-xl border border-white/20 shadow-sm object-cover">
                           <div v-else class="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-xs font-bold text-gray-600">
                             {{ post.author.displayName?.[0] || '?' }}
                           </div>
                           <div>
                             <p class="text-[11px] font-black text-slate-700 flex items-center gap-1 leading-none mb-0.5">
                                {{ post.author.displayName || '訪客' }}
                                <span v-if="post.author.uid === currentBoard?.ownerId" class="bg-amber-100 text-amber-600 p-0.5 rounded" title="看板擁有者">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2 3.5 20h17z"/></svg>
                                </span>
                             </p>
                             <p class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter opacity-70">{{ formatRelativeTime(post.createdAt) }}</p>
                           </div>
                         </div>
                         
                         <!-- Post Actions (Stops Dragging) -->
                         <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto" @mousedown.stop @touchstart.stop @click.stop>
                             <button v-if="isOwner && post.status === 'pending'"
                                     @click="handleApprovePost(post.id)"
                                     class="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors" title="核准貼文">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                             </button>
                             <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)" 
                                     @click="handleDelete(post)" 
                                     class="p-1.5 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-all duration-200" title="刪除">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            </button>
                            <!-- Edit only usually for own post -->
                            <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                                    @click="startEditPost(post)"
                                    class="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-emerald-500 rounded-lg transition-colors" title="編輯">
                               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> 
                            </button>
                         </div>
                       </div>

                       <!-- Post Title -->
                       <h4 v-if="post.title && editingPostId !== post.id" class="font-black text-slate-800 mb-2 truncate text-sm tracking-tight leading-tight" @click="openPostDetail(post)">{{ post.title }}</h4>

                       <!-- Poll Display -->
                       <div v-if="post.poll" class="mb-4 w-full bg-black/5 rounded-xl p-3 border border-black/5">
                          <div class="space-y-2">
                            <div v-for="option in post.poll.options" :key="option.id" class="relative group cursor-pointer" @click.stop="handleVote(post, option.id)">
                               <!-- Progress Bar Background -->
                               <div class="absolute inset-0 bg-white/50 rounded-lg overflow-hidden h-full w-full border border-white/50">
                                  <div class="h-full bg-emerald-400/30 transition-all duration-500 ease-out" 
                                       :style="{ width: post.poll.totalVotes > 0 ? (option.voters.length / post.poll.totalVotes * 100) + '%' : '0%' }"></div>
                               </div>
                               
                               <!-- Content -->
                               <div class="relative flex items-center justify-between p-2 select-none">
                                  <div class="flex items-center gap-2 overflow-hidden">
                                     <!-- Radio Circle -->
                                     <div class="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                                          :class="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')) ? 'border-emerald-600 bg-emerald-600' : 'border-slate-400 bg-white/50 group-hover:border-emerald-500'">
                                         <svg v-if="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))" xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                     </div>
                                     <span class="font-medium text-slate-800 text-xs truncate" :class="{'font-bold text-emerald-800': option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))}">{{ option.text }}</span>
                                  </div>
                                  <span class="text-[10px] font-bold text-slate-500 flex-shrink-0 tabular-nums">
                                    {{ post.poll.totalVotes > 0 ? Math.round(option.voters.length / post.poll.totalVotes * 100) : 0 }}%
                                  </span>
                               </div>
                            </div>
                          </div>
                          <div class="mt-2 flex justify-between items-center text-[10px] text-slate-400 font-medium px-1">
                              <span>{{ post.poll.totalVotes }} 票</span>
                              <!-- <span>{{ post.poll.allowMultiple ? '多選' : '單選' }}</span> -->
                          </div>
                      </div>
                      <!-- Content (Editable) -->
                       <div v-if="editingPostId === post.id" class="mb-3">
                            <input v-model="editPostTitle"
                                   type="text"
                                   placeholder="貼文標題 (選填)..."
                                    class="w-full text-sm text-slate-800 bg-transparent outline-none mb-2 border-b border-gray-200 focus:border-emerald-500 transition-colors placeholder-slate-500"
                                   @keydown.enter.prevent="focusElement(`edit-post-${post.id}`)">
                           
                           <!-- Color Picker for Edit -->
                           <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                               <button v-for="color in POST_COLORS" :key="color.value"
                                       @mousedown.prevent="editPostColor = color.value"
                                       @click.stop
                                       class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                                       :class="{ 'ring-2 ring-emerald-500 ring-offset-1': editPostColor === color.value }"
                                       :style="{ backgroundColor: color.value }"
                                       :title="color.name">
                               </button>
                           </div>
                           
                           <!-- Poll Editing UI (Shelf/Stream) -->
                           <div v-if="post.poll" class="space-y-2 mb-3 bg-black/5 p-3 rounded-xl border border-black/5 mt-2 overflow-hidden">
                             <div v-for="(option, idx) in editPollOptions" :key="option.id" class="flex items-center gap-2">
                               <span class="text-[10px] font-bold text-slate-400 w-4 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                               <input v-model="option.text" type="text" class="flex-1 w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 shadow-sm transition-colors" placeholder="選項文字" />
                             </div>
                           </div>
                           
                           <textarea :id="`edit-post-${post.id}`"
                                     v-model="editContent"
                                     :style="{ backgroundColor: editPostColor !== '#ffffff' ? editPostColor : '#f9fafb' }"
                                     @keydown.ctrl.enter="saveEditPost(post)"
                                     @keydown.esc="cancelEditPost"
                                     @click.stop
                                     class="w-full border border-emerald-500 rounded-xl p-3 text-sm text-slate-900 placeholder-slate-500 outline-none resize-none h-28 transition-colors shadow-inner"></textarea>
                            
                            <!-- Edit Mode Media Upload Button (New) -->
                            <div v-if="pendingAttachments.length" class="flex gap-2 mt-2 flex-wrap pb-2 border-b border-gray-100">
                              <div v-for="(att, idx) in pendingAttachments" :key="idx" class="relative w-12 h-12 rounded-lg overflow-hidden border group/p">
                                  <img v-if="att.thumbnailUrl" 
                                       :src="att.type === 'image' ? getViewUrl(att.url) : att.thumbnailUrl" 
                                       referrerpolicy="no-referrer"
                                       class="w-full h-full object-cover">
                                  <div v-else class="flex flex-col items-center justify-center h-full bg-gray-50 p-1">
                                      <svg v-if="att.type === 'pdf'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                                      <svg v-else-if="att.type === 'youtube'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-600"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
                                      <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                      <p class="text-[7px] text-gray-400 truncate w-full text-center mt-1">{{ att.name }}</p>
                                  </div>
                                  <button @click.stop="removePendingAttachment(idx)" 
                                          class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-lg transition-transform hover:scale-110 z-10">×</button>
                              </div>
                            </div>

                            <div class="flex justify-between items-center mt-2">
                              <div class="flex gap-1">
                                 <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                                 <button @click.stop="fileInput?.click()" :disabled="cloudinaryUploading" class="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="上傳附件">
                                   <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                 </button>
                                 <button @click.stop="addYouTubeLink" class="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors" title="加入YouTube連結">
                                   <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
                                 </button>
                              </div>
                              <div class="flex gap-2">
                                <button @click.stop="cancelEditPost" class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 font-bold border border-gray-200 rounded">取消</button>
                                <button @click.stop="saveEditPost(post)" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-bold shadow-sm">儲存</button>
                              </div>
                            </div>
                        </div>
                        <div v-else-if="post.content" class="mb-3">
                           <div class="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap transition-all overflow-hidden cursor-pointer"
                                :class="{'line-clamp-6': !expandedPostsInList[post.id] && post.content.length > 350}"
                                @click="openPostDetail(post)"
                                v-html="formatContent(post.content)">
                           </div>
                           <button v-if="post.content.length > 350" 
                                   @click.stop="expandedPostsInList[post.id] = !expandedPostsInList[post.id]"
                                   class="text-emerald-600 hover:text-emerald-700 text-[10px] font-black mt-2 uppercase tracking-widest flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
                             {{ expandedPostsInList[post.id] ? '收起貼文' : '... 繼續閱讀' }}
                             <svg v-if="!expandedPostsInList[post.id]" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                             <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                           </button>
                        </div>
                      
                      <!-- Attachments -->
                      <div v-if="post.attachments?.length" class="space-y-2 mb-3">
                        <template v-for="(att, index) in post.attachments" :key="att.url || att.shareUrl || index">
                          <div class="relative group/att">
                            <!-- Image -->
                            <div v-if="att.type === 'image'" class="relative group/preview">
                                 <img :src="getViewUrl(att.url || att.shareUrl!)" 
                                      referrerpolicy="no-referrer"
                                      loading="lazy"
                                       class="w-full h-40 object-cover rounded-lg cursor-pointer hover:brightness-90 transition-all border border-gray-100"
                                      @click.stop="openPreview(att.url!, 'image')">
                                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity pointer-events-none">
                                    <span class="bg-black/60 text-white px-3 py-1 rounded-full text-[10px] font-bold backdrop-blur-sm flex items-center gap-1.5">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                      放大檢視
                                    </span>
                                </div>
                            </div>
                           
                           <!-- YouTube -->
                           <div v-else-if="att.type === 'youtube'" class="relative aspect-video rounded-lg overflow-hidden shadow-sm pointer-events-auto" @mousedown.stop>
                             <iframe :src="att.shareUrl" class="absolute inset-0 w-full h-full" allowfullscreen frameborder="0"></iframe>
                           </div>
                           
                            <!-- PDF -->
                            <div v-else-if="att.type === 'pdf'" 
                                 class="flex flex-col bg-gradient-to-br from-red-50 to-orange-50 hover:from-red-100 hover:to-orange-100 rounded-lg cursor-pointer transition-all border border-red-200/60 overflow-hidden relative group/preview shadow-sm hover:shadow-md">
                              <!-- PDF Icon Area -->
                              <div class="w-full h-40 flex items-center justify-center bg-gradient-to-br from-red-100/80 to-red-200/50 relative">
                                <div class="flex flex-col items-center gap-2">
                                  <svg class="w-16 h-16 text-red-400 group-hover/preview:text-red-500 transition-colors" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                                    <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1"/>
                                    <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="white">PDF</text>
                                  </svg>
                                  <span class="text-xs text-red-400 font-medium">{{ att.name || 'PDF 文件' }}</span>
                                </div>
                                <!-- Preview Overlay -->
                                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity bg-black/20 backdrop-blur-[1px]"
                                     @click.stop="openPreview(att.url || att.shareUrl || '', 'pdf')">
                                  <span class="bg-white/90 text-red-600 px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    點此直接瀏覽
                                  </span>
                                </div>
                              </div>
 
                              <div class="p-3 flex items-center gap-3" @click.stop="openLink(att.url || att.shareUrl, 'pdf')">
                                <div class="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-lg shadow-sm flex-shrink-0">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-red-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                                </div>
                                <div class="overflow-hidden flex-1">
                                  <p class="font-bold text-red-800 text-sm truncate">{{ att.name || 'PDF 文件' }}</p>
                                  <p class="text-xs text-red-500">點擊開啟新分頁</p>
                                </div>
                                <svg class="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                                </svg>
                              </div>
                            </div>
 
                           <!-- Video -->
                           <div v-else-if="att.type === 'video'" class="rounded-lg overflow-hidden shadow-sm bg-black relative">
                             <video :src="att.url || att.shareUrl" 
                                    :poster="att.url ? getVideoThumbnail(att.url) : ''"
                                    controls 
                                    class="w-full max-h-[300px] object-contain pointer-events-auto"
                                    @mousedown.stop>
                             </video>
                           </div>

                           <!-- Audio -->
                           <div v-else-if="att.type === 'audio'" class="rounded-lg overflow-hidden shadow-sm bg-gray-50 p-2 border border-gray-100 pointer-events-auto" @mousedown.stop>
                              <div class="flex items-center gap-2 mb-2 px-1">
                                 <span class="text-lg">🎵</span>
                                 <span class="text-xs font-bold text-gray-600 truncate">{{ att.name || '音訊檔案' }}</span>
                              </div>
                              <audio :src="att.url || att.shareUrl" controls class="w-full h-10"></audio>
                           </div>
 
                           <!-- Link (Fallback) -->
                            <div v-else-if="att.type === 'link'" 
                                class="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors border border-gray-200 pointer-events-auto"
                                @click.stop="openLink(att.url || att.shareUrl, 'link')"
                                @mousedown.stop>
                             <div class="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center text-xl">🔗</div>
                             <div class="overflow-hidden">
                               <p class="font-bold text-gray-700 text-sm truncate">{{ att.name || '連結' }}</p>
                               <p class="text-xs text-gray-400 truncate">{{ att.url || att.shareUrl }}</p>
                             </div>
                           </div>
                           
                           <!-- Delete Attachment Button -->
                           <button v-if="post.author.uid === authStore.user?.uid"
                                   @click.stop="deleteAttachment(post, Number(index))"
                                   class="absolute top-2 right-2 w-7 h-7 bg-red-500/80 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover/att:opacity-100 transition-all z-10 shadow-lg backdrop-blur-sm"
                                   title="移除附件">
                             ×
                           </button>
                         </div>
                        </template>
                      </div>

                      <!-- Actions -->
                      <div class="flex justify-between items-center py-2 border-t border-gray-100">
                        <button @click.stop="handleLike(post)" 
                                class="flex items-center gap-1.5 text-xs transition-all hover:bg-rose-50 px-2.5 py-1.5 rounded-xl group/like"
                                :class="isLiked(post.id) || likedPosts[post.id] ? 'text-rose-500 font-bold' : 'text-gray-400 hover:text-rose-500'">
                          <span class="transform group-hover/like:scale-125 transition-transform duration-300">
                             <svg v-if="isLiked(post.id) || likedPosts[post.id]" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                             <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                          </span>
                          <span class="tabular-nums">{{ post.likes || 0 }}</span>
                        </button>
                        <button @click.stop="toggleComments(post)" class="flex items-center gap-1.5 text-xs text-gray-400 hover:text-emerald-600 transition-colors px-2.5 py-1.5 rounded-xl hover:bg-emerald-50 pointer-events-auto" @mousedown.stop>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            留言 {{ post.comments?.length ? `(${post.comments.length})` : '' }}
                        </button>
                      </div>

                      <!-- Comments Section -->
                      <div class="mt-3 pt-3 border-t border-gray-100">
                        <div class="space-y-3 mb-3">
                            <div v-for="comment in (expandedComments[post.id] ? post.comments : (post.comments || []).slice(0, 5))" :key="comment.id" class="flex gap-2 text-sm group">
                                <img v-if="comment.author.photoURL" 
                                     :src="comment.author.photoURL" 
                                     @error="handleImageError(comment.author)"
                                     referrerpolicy="no-referrer" 
                                     class="w-6 h-6 rounded-full flex-shrink-0">
                                <div v-else class="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] flex-shrink-0">
                                    {{ comment.author.displayName.charAt(0) }}
                                </div>
                                <div class="bg-indigo-50/50 backdrop-blur-md border border-white/40 rounded-3xl rounded-tl-none p-3.5 flex-1 relative shadow-sm group-hover:shadow-md transition-all">
                                    <p class="font-black text-[11px] text-indigo-900 mb-1 leading-tight flex justify-between items-center">
                                      {{ comment.author.displayName }}
                                      <span class="text-[9px] text-indigo-400 font-bold opacity-60">剛剛</span>
                                    </p>
                                    <p class="text-slate-800 text-[13px] leading-relaxed font-medium">{{ comment.content }}</p>
                                     <button v-if="comment.author.uid === authStore.user?.uid || isOwner"
                                             @click.stop="handleDeleteComment(post, comment.id)"
                                             class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white border border-red-100 text-red-400 hover:bg-red-500 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-sm flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                </div>
                            </div>
                            <button v-if="post.comments?.length > 5" 
                                    @click.stop="toggleExpandComments(post.id)"
                                    class="text-emerald-600 hover:text-emerald-700 text-xs font-medium py-1 w-full text-left">
                                {{ expandedComments[post.id] ? '↑ 收起留言' : `展開其餘 ${post.comments.length - 5} 則留言...` }}
                            </button>
                        </div>
                        <div v-if="canContribute" class="flex items-center gap-3">
                            <div class="flex items-center gap-2 flex-1">
                                <input v-model="commentInputs[post.id]" 
                                       @keydown.enter="submitComment(post)"
                                       @click.stop
                                       type="text" 
                                       placeholder="寫下留言..." 
                                       class="flex-1 bg-gray-100 rounded-full px-3 py-1.5 text-xs text-slate-900 outline-none focus:bg-white border border-transparent focus:border-emerald-500 transition-colors">
                                <button @click.stop="submitComment(post)" class="text-emerald-600 hover:text-emerald-700 font-bold text-xs">發佈</button>
                            </div>
                        </div>
                      </div>
                    </div>
                  </template>
                </draggable>

                </div>
              </div>
            </template>
          </draggable>

        <!-- Add Section Button (Minimalist Icon) -->
        <div v-if="isOwner" class="flex-shrink-0 w-16 h-full flex flex-col justify-start pt-12">
            <button @click="createSection" 
                    class="w-12 h-12 text-white/20 hover:text-white/80 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90"
                    title="新增區段">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
        </div>
      </main>

      <!-- Stream Layout (Vertical Sections) -->
      <main v-else-if="currentBoard?.layout === 'stream' && !showPasswordModal" 
            @drop.prevent="handleDrop" 
            @dragover.prevent="handleDragOver" 
            @dragleave="handleDragLeave"
            class="flex-1 overflow-y-auto p-6">
        <draggable 
           v-model="localSections"
           item-key="id"
           class="max-w-6xl mx-auto space-y-12 pb-24"
           handle=".section-drag-handle"
           :disabled="!isOwner"
           @change="(evt: any) => {
             if (evt.moved) {
               boardStore.reorderSections(boardId, localSections.map(s => s.id));
             }
           }"
        >
          <template #item="{ element: section }">
            <div>
              <!-- Section Header (Editable) -->
              <div class="flex items-center gap-3 mb-6 section-drag-handle cursor-move">
                <input v-if="editingSectionId === section.id"
                       :id="`edit-section-${section.id}`"
                       v-model="editTitle"
                       @blur="saveEditSection(section)"
                       @keydown.enter="saveEditSection(section)"
                       @click.stop
                       class="px-4 py-2 bg-white/10 backdrop-blur-md rounded-xl text-white font-bold text-lg border border-emerald-500 outline-none w-64"
                />
                <h2 v-else @dblclick="startEditSection(section)"
                    class="px-4 py-2 bg-black/60 rounded-xl text-white font-bold text-lg border border-white/10 shadow-sm cursor-pointer hover:bg-black/80 transition-colors">
                  {{ section.title }}
                </h2>
                <div class="flex items-center gap-1 relative">
                    <button @click.stop="activeSection = section.id" 
                            class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all backdrop-blur-sm border border-white/10"
                            title="新增貼文">
                      +
                    </button>
                    <button @click.stop="toggleSectionMenu(section.id)" 
                            class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all backdrop-blur-sm border border-white/10"
                            title="更多">
                      ⋮
                    </button>

                    <!-- Section Menu Dropdown -->
                    <div v-if="activeSectionMenuId === section.id" 
                         class="absolute right-0 top-12 w-48 bg-gray-900 rounded-xl shadow-2xl border border-white/10 z-50 overflow-hidden animate-scale-in origin-top-right">
                       <button @click.stop="activeSection = section.id; closeSectionMenu()" class="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-3">
                         <span>+</span> 新增貼文
                       </button>
                       <div class="h-px bg-white/10 my-1"></div>
                       <button v-if="canEdit" @click.stop="startEditSection(section); closeSectionMenu()" class="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white flex items-center gap-3">
                         <span>✏️</span> 重新命名
                       </button>
                       <button v-if="canEdit" @click.stop="handleDeleteSection(section.id); closeSectionMenu()" class="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-3">
                         <span>🗑️</span> 刪除區段
                       </button>
                    </div>
                </div>
              </div>

            <!-- Posts Container -->
            <div>
              
              <!-- Inline Post Form -->
              <div v-if="activeSection === section.id" class="mb-4 max-w-lg">
                <div class="bg-white rounded-xl p-4 shadow-xl animate-scale-in">
                  
                   <!-- Color Picker -->
                   <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                      <button v-for="color in POST_COLORS" :key="color.value"
                              @mousedown.prevent="newPostColor = color.value"
                              @click.stop
                              class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                              :class="{ 'ring-2 ring-emerald-500 ring-offset-1': newPostColor === color.value }"
                              :style="{ backgroundColor: color.value }"
                              :title="color.name">
                      </button>
                   </div>

                  <input v-model="newPostTitle" 
                         type="text" 
                         :placeholder="isPoll ? '投票問題...' : '貼文標題 (選填)...'" 
                         class="w-full text-sm font-bold text-gray-800 placeholder-gray-400 bg-transparent outline-none mb-2 px-1"
                         @keydown.enter.prevent="nextTick(() => contentRefs[section.id]?.focus())">
                         


                   <!-- Poll Options Input -->
                   <div v-if="isPoll" class="space-y-2 mb-3 bg-slate-50 p-2 rounded-lg border border-slate-100 mx-1">
                      <div v-for="(option, idx) in pollOptions" :key="option.id" class="flex items-center gap-2">
                          <span class="text-xs font-bold text-slate-400 w-4 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                          <input v-model="option.text" type="text" :placeholder="`選項 ${idx + 1}`" class="flex-1 w-full min-w-0 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-900 focus:outline-none focus:border-emerald-400 transition-colors" />
                          <button @click.stop="removePollOption(idx)" class="text-slate-300 hover:text-red-400 p-1" :disabled="pollOptions.length <= 2">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                      </div>
                      <button @click.stop="addPollOption" class="w-full py-1.5 border border-dashed border-slate-300 rounded text-slate-400 text-xs font-bold hover:bg-white hover:text-emerald-500 hover:border-emerald-300 transition-all flex items-center justify-center gap-1">
                          + 新增選項
                      </button>
                   </div>

                  <textarea v-model="newPostContent" 
                            :ref="(el) => { if(el) contentRefs[section.id] = el as HTMLTextAreaElement }"
                            :style="{ backgroundColor: newPostColor !== '#ffffff' ? newPostColor : '#ffffff' }"
                            placeholder="輸入你的想法，或拖放檔案至此處..." 
                            class="w-full bg-gray-50 rounded-lg p-3 text-sm outline-none focus:bg-white border border-gray-200 focus:border-emerald-500 transition-colors resize-none h-24"
                            autofocus></textarea>
                   <p class="text-[10px] text-gray-400 mt-1 italic text-center">💡 提示：將檔案直接拖入視窗任何地方也能上傳喔！</p>
                  
                  <div v-if="pendingAttachments.length" class="flex gap-2 mt-2 flex-wrap">
                    <div v-for="(att, idx) in pendingAttachments" :key="idx" 
                         class="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100">
                      <img v-if="att.thumbnailUrl" :src="att.thumbnailUrl" class="w-full h-full object-cover">
                      <span v-else class="absolute inset-0 flex items-center justify-center text-2xl">
                        {{ att.type === 'pdf' ? '📄' : '🎬' }}
                      </span>
                      <button @click.stop="pendingAttachments.splice(idx, 1)" 
                              class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center">×</button>
                    </div>
                  </div>

                  <div class="flex justify-between items-center mt-3">
                    <div class="flex gap-2">
                       <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                      <button @click.stop="fileInput?.click()" :disabled="cloudinaryUploading" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500 flex items-center gap-1" title="上傳附件">
                        <span class="text-xl">📎</span>
                      </button>
                      <button @click.stop="isPoll = !isPoll" 
                              class="p-2 rounded-lg transition-all border"
                              :class="isPoll ? 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm' : 'hover:bg-gray-100 text-gray-500 border-transparent'"
                              title="發起投票">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="8" x2="16" y2="8"/></svg>
                      </button>
                    </div>
                    <div class="flex gap-2">
                      <button @click.stop="activeSection = null; pendingAttachments = []" class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">取消</button>
                      <button @click.stop="submitPost(section.id)" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg font-bold shadow-md">發佈</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Posts Grid (Draggable) -->
              <draggable
                v-model="localPostsBySection[section.id]"
                group="posts"
                item-key="id"
                class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 min-h-[50px] items-start mb-12"
                :disabled="currentSort !== 'manual' || !isOwner"
                @change="(evt: any) => {
                  if (evt.added || evt.moved) {
                     boardStore.reorderPosts(boardId, section.id, (localPostsBySection[section.id] || []).map(p => p.id));
                  }
                }"
              >
                <template #item="{ element: post }">
                  <div class="bg-white/98 rounded-[2.5rem] p-6 shadow-2xl border border-white/20 transition-all duration-500 group relative hover:-translate-y-2 hover:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] cursor-pointer will-change-transform"
                 style="content-visibility: auto; contain-intrinsic-size: 100px 400px;"
                 :class="{ 'ring-4 ring-emerald-500 ring-inset': dragTargetPostId === post.id }"
                 :style="{ backgroundColor: post.color || '#ffffff' }"
                 @dragover="handlePostDragOver(post.id, $event)"
                 @dragleave="dragTargetPostId = null"
                 @drop="handlePostDrop(post, $event)"
                 @click="openPostDetail(post)">
                    
                    <div v-if="dragTargetPostId === post.id" class="absolute inset-0 bg-emerald-500/20 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-xl pointer-events-none">
                       <span class="text-white font-bold bg-emerald-600 px-3 py-1 rounded-full text-xs">在此載入附件</span>
                    </div>

                      <!-- Moderation Badge -->
                      <div v-if="post.status === 'pending'" 
                           class="absolute top-0 left-0 px-3 py-1 bg-amber-500 text-white text-[10px] font-black rounded-br-2xl rounded-tl-xl shadow-lg z-20 pointer-events-none flex items-center gap-1.5 border-r border-b border-amber-400/30">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="animate-spin-slow"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        待審核
                      </div>
                
                <!-- Post Actions -->
                <div class="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-10 translate-y-2 group-hover:translate-y-0 duration-300">
                    <button v-if="isOwner && post.status === 'pending'"
                            @click.stop="handleApprovePost(post.id)"
                            class="w-8 h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 border border-emerald-400/20"
                            title="核准貼文">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </button>
                    <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                            @click.stop="handleDelete(post)"
                            class="w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 border border-red-400/20"
                            title="刪除"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                    <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                            @click.stop="startEditPost(post)"
                            class="w-8 h-8 bg-blue-500 hover:bg-blue-600 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 border border-blue-400/20"
                            title="編輯"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                </div>


                <div class="flex items-center gap-2 mb-3">
                   <img v-if="post.author.photoURL" 
                        :src="post.author.photoURL" 
                        @error="handleImageError(post.author)"
                        referrerpolicy="no-referrer" 
                        class="w-8 h-8 rounded-full object-cover">
                  <div v-else class="w-8 h-8 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    {{ post.author.displayName?.charAt(0) || '?' }}
                  </div>
                  <div>
                    <p class="font-bold text-sm text-gray-800">{{ post.author.displayName }}</p>
                    <p class="text-[10px] text-gray-400">{{ formatRelativeTime(post.createdAt) }}</p>
                  </div>
                </div>

                <!-- Post Title -->
                <h4 v-if="post.title && editingPostId !== post.id" class="font-bold text-gray-800 mb-2 truncate">{{ post.title }}</h4>

                <!-- Poll Display -->
                <div v-if="post.poll" class="mb-4 w-full bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                  <div class="space-y-2">
                    <div v-for="option in post.poll.options" :key="option.id" class="relative group cursor-pointer" @click.stop="handleVote(post, option.id)">
                       <!-- Progress Bar -->
                       <div class="absolute inset-0 bg-white rounded-lg overflow-hidden h-full w-full border border-slate-200">
                          <div class="h-full bg-emerald-100 transition-all duration-500 ease-out" 
                               :style="{ width: post.poll.totalVotes > 0 ? (option.voters.length / post.poll.totalVotes * 100) + '%' : '0%' }"></div>
                       </div>
                       
                       <div class="relative flex items-center justify-between p-2 select-none">
                          <div class="flex items-center gap-2 overflow-hidden">
                             <!-- Indicator -->
                             <div class="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                                  :class="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')) ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white group-hover:border-emerald-400'">
                                 <svg v-if="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))" xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                             </div>
                             <span class="font-medium text-slate-800 text-xs truncate" :class="{'font-bold text-emerald-700': option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))}">{{ option.text }}</span>
                          </div>
                          <span class="text-[10px] font-bold text-slate-500 flex-shrink-0 tabular-nums">
                            {{ post.poll.totalVotes > 0 ? Math.round(option.voters.length / post.poll.totalVotes * 100) : 0 }}%
                          </span>
                       </div>
                    </div>
                  </div>
                  <div class="mt-2 text-[10px] text-slate-400 font-medium px-1 flex justify-between">
                      <span>{{ post.poll.totalVotes }} 票</span>
                  </div>
                </div>

                <!-- Content (Editable) -->
                <div v-if="editingPostId === post.id" class="mb-3">
                     <input v-model="editPostTitle"
                            type="text"
                            placeholder="貼文標題 (選填)..."
                            class="w-full text-sm text-slate-900 bg-transparent outline-none mb-2 border-b border-gray-200 focus:border-emerald-500 transition-colors placeholder-slate-400"
                            @keydown.enter.prevent="focusElement(`edit-post-${post.id}`)">
                   <!-- Color Picker for Edit -->
                   <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                      <button v-for="color in POST_COLORS" :key="color.value"
                              @click.stop="editPostColor = color.value"
                              class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                              :class="{ 'ring-2 ring-emerald-500 ring-offset-1': editPostColor === color.value }"
                              :style="{ backgroundColor: color.value }"
                              :title="color.name">
                      </button>
                   </div>
                    <textarea :id="`edit-post-${post.id}`"
                            v-model="editContent"
                            :style="{ backgroundColor: editPostColor !== '#ffffff' ? editPostColor : '#f9fafb' }"
                            @keydown.ctrl.enter="saveEditPost(post)"
                            @keydown.esc="cancelEditPost"
                            @click.stop
                            class="w-full border border-emerald-500 rounded p-2 text-sm outline-none resize-none h-24 transition-colors"></textarea>
                    
                    <!-- Edit Media Tool -->
                    <div v-if="pendingAttachments.length" class="flex gap-1 mt-2 mb-1">
                       <div v-for="(att, i) in pendingAttachments" :key="i" class="relative w-10 h-10 border rounded overflow-hidden">
                          <img v-if="att.thumbnailUrl" :src="att.thumbnailUrl" class="w-full h-full object-cover">
                          <span v-else class="absolute inset-0 flex items-center justify-center text-xl">
                            {{ att.type === 'pdf' ? '📄' : '🎬' }}
                          </span>
                          <button @click.stop="pendingAttachments.splice(i, 1)" 
                                  class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center">×</button>
                       </div>
                    </div>
                    <div class="flex justify-between items-center mt-1">
                       <div class="flex gap-1">
                          <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                          <button @click.stop="fileInput?.click()" class="w-8 h-8 bg-gray-100 hover:bg-emerald-500 text-gray-400 hover:text-white rounded-lg flex items-center justify-center transition-all active:scale-95 group/upload" title="上傳附件">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </button>
                       </div>
                       <div class="flex gap-2">
                         <button @click.stop="cancelEditPost" class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 font-bold border border-gray-200 rounded">取消</button>
                         <button @click.stop="saveEditPost(post)" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-bold shadow-sm">儲存</button>
                       </div>
                    </div>
                </div>
                <div v-else-if="post.content" class="mb-3">
                   <div class="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap transition-all overflow-hidden cursor-pointer"
                        :class="{'line-clamp-6': !expandedPostsInList[post.id] && post.content.length > 350}"
                        @click="openPostDetail(post)"
                        v-html="formatContent(post.content)">
                   </div>
                   <button v-if="post.content.length > 350" 
                           @click.stop="expandedPostsInList[post.id] = !expandedPostsInList[post.id]"
                           class="text-emerald-600 hover:text-emerald-700 text-[10px] font-black mt-2 uppercase tracking-widest flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
                     {{ expandedPostsInList[post.id] ? '收起貼文' : '... 繼續閱讀' }}
                     <svg v-if="!expandedPostsInList[post.id]" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                     <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                   </button>
                </div>
                
                <div v-if="post.attachments?.length" class="space-y-2 mb-3">
                  <template v-for="(att, index) in post.attachments" :key="att.url || att.shareUrl || index">
                    <div class="relative group/att">
                      <img v-if="att.type === 'image'" 
                           :src="att.url || att.shareUrl" 
                           class="w-full h-32 object-cover rounded-lg cursor-pointer hover:brightness-90 transition-all border border-gray-100"
                           @click.stop="openPreview(att.url!, 'image')">
                      
                      <div v-else-if="att.type === 'youtube'" class="relative aspect-video rounded-lg overflow-hidden shadow-sm">
                        <iframe :src="att.shareUrl" class="absolute inset-0 w-full h-full" allowfullscreen frameborder="0"></iframe>
                      </div>
                      
                      <div v-else-if="att.type === 'pdf'" 
                           class="flex flex-col bg-gradient-to-br from-red-50 to-orange-50 hover:from-red-100 hover:to-orange-100 rounded-lg cursor-pointer transition-all border border-red-200/60 overflow-hidden shadow-sm hover:shadow-md group/pdf">
                        <!-- PDF Icon Area -->
                        <div class="w-full h-24 flex items-center justify-center bg-gradient-to-br from-red-100/80 to-red-200/50 relative">
                          <svg class="w-10 h-10 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                            <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1"/>
                            <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="white">PDF</text>
                          </svg>
                          <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/pdf:opacity-100 transition-all duration-300 bg-black/40 backdrop-blur-[2px]"
                               @click.stop="openPreview(att.url || att.shareUrl || '', 'pdf')">
                            <span class="bg-white text-gray-900 px-4 py-1.5 rounded-full text-[10px] font-black shadow-xl flex items-center gap-2 transform -translate-y-2 group-hover/pdf:translate-y-0 transition-transform">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                              預覽檔案
                            </span>
                          </div>
                        </div>
                        <div class="p-2.5 flex items-center gap-3" @click.stop="openLink(att.url || att.shareUrl, 'pdf')">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                          <span class="text-[11px] font-bold text-red-700 truncate flex-1 uppercase tracking-tight">{{ att.name || 'PDF Document' }}</span>
                        </div>
                      </div>
  
                      <div v-else-if="att.type === 'video'" class="rounded-lg overflow-hidden bg-black shadow-sm relative group">
                          <video :src="att.url || att.shareUrl" 
                                 :poster="att.url ? getVideoThumbnail(att.url) : ''"
                                 controls class="w-full h-32 object-cover"></video>
                      </div>

                      <div v-else-if="att.type === 'audio'" class="rounded-lg overflow-hidden shadow-sm bg-gray-50 p-1.5 border border-gray-100">
                         <div class="flex items-center gap-2 mb-1 px-1">
                            <span class="text-xs truncate font-bold text-gray-500">{{ att.name || '音訊' }}</span>
                         </div>
                         <audio :src="att.url || att.shareUrl" controls class="w-full h-8"></audio>
                      </div>

                      <!-- Delete Attachment Button -->
                      <button v-if="post.author.uid === authStore.user?.uid"
                              @click.stop="deleteAttachment(post, Number(index))"
                              class="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500/90 hover:bg-red-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-all z-10 shadow-xl border border-red-400/20"
                              title="移除附件">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  </template>
                </div>

                <div class="flex justify-between items-center pt-3 border-t border-slate-900/5">
                  <button @click.stop="handleLike(post)" 
                          class="flex items-center gap-1.5 text-xs transition-all hover:bg-rose-500/10 px-3 py-1.5 rounded-xl group/like active:scale-95"
                          :class="isLiked(post.id) || likedPosts[post.id] ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-rose-500'">
                    <span class="transform group-hover/like:scale-125 transition-all block duration-300">
                      <svg v-if="isLiked(post.id) || likedPosts[post.id]" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                      <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                    </span>
                    <span class="tabular-nums font-bold">{{ post.likes || 0 }}</span>
                  </button>
                  <button @click.stop="toggleComments(post)" class="text-slate-400 hover:text-emerald-500 text-[11px] font-black uppercase tracking-tighter transition-all px-3 py-1.5 rounded-xl hover:bg-emerald-500/10 flex items-center gap-2 group/comment active:scale-95">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/comment:-rotate-12 transition-transform"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      {{ post.comments?.length || 0 }} 留言
                  </button>
                </div>

                <!-- Comments Section -->
                <div class="mt-3 pt-3 border-t border-gray-100">
                    <div class="space-y-3 mb-3">
                        <div v-for="comment in (expandedComments[post.id] ? post.comments : (post.comments || []).slice(0, 5))" :key="comment.id" class="flex gap-2 text-sm group">
                            <img v-if="comment.author.photoURL" :src="comment.author.photoURL" referrerpolicy="no-referrer" class="w-6 h-6 rounded-full flex-shrink-0">
                            <div v-else class="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] flex-shrink-0">
                                {{ comment.author.displayName.charAt(0) }}
                            </div>
                             <div v-if="comment.status === 'pending'" class="absolute -left-2 -top-2 px-1.5 py-0.5 bg-amber-500 text-white text-[8px] rounded-full scale-75 z-20">
                                待審
                             </div>
                             <div class="flex flex-col flex-1 relative">
                                <p class="font-black text-[11px] text-gray-800 mb-0.5 flex items-center gap-1.5">
                                    {{ comment.author.displayName }}
                                    <span v-if="comment.author.uid === currentBoard?.ownerId" class="p-0.5 bg-amber-100 text-amber-600 rounded-md" title="看板擁有者">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2 3.5 20h17z"/></svg>
                                    </span>
                                </p>
                                <div class="text-gray-600 break-words" v-html="formatContent(comment.content)"></div>
                                <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button v-if="isOwner && comment.status === 'pending'"
                                            @click.stop="handleApproveComment(post.id, comment.id)"
                                            class="text-emerald-500 hover:text-emerald-700 transition-colors" title="核准留言">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    </button>
                                    <button v-if="comment.author.uid === authStore.user?.uid || isOwner || (!authStore.user && comment.author.displayName === guestName && guestName)"
                                            @click.stop="handleDeleteComment(post, comment.id)"
                                            class="text-gray-400 hover:text-red-500 transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                    </button>
                                </div>
                             </div>
                        </div>
                        <button v-if="(post.comments?.length || 0) > 5" 
                                @click.stop="toggleExpandComments(post.id)"
                                class="text-emerald-600 hover:text-emerald-700 text-xs font-medium py-1 w-full text-left">
                            {{ expandedComments[post.id] ? '↑ 收起留言' : `展開其餘 ${(post.comments?.length || 0) - 5} 則留言...` }}
                        </button>
                    </div>
                    <div v-if="canContribute" class="flex items-center gap-2">
                        <input v-model="commentInputs[post.id]" 
                               @keydown.enter="submitComment(post)"
                               @click.stop
                               type="text" 
                               placeholder="寫下留言..." 
                               class="flex-1 bg-gray-100 rounded-full px-3 py-1.5 text-xs text-slate-900 outline-none focus:bg-white border border-transparent focus:border-emerald-500 transition-colors">
                        <button @click.stop="submitComment(post)" class="text-emerald-600 hover:text-emerald-700 font-bold text-xs">發佈</button>
                    </div>
                </div>
              </div>
                </template>
              </draggable>
            </div>
          </div>
        </template>
      </draggable>

        <div v-if="isOwner" class="max-w-6xl mx-auto mt-16 pb-32">
          <button @click="createSection" 
                  class="w-full h-20 border-2 border-dashed border-white/5 bg-white/5 hover:bg-white/10 rounded-3xl flex items-center justify-center gap-4 text-white/20 hover:text-emerald-400 hover:border-emerald-500/30 hover:scale-[1.01] active:scale-[0.99] transition-all duration-500 text-sm font-black uppercase tracking-[0.2em] group shadow-xl">
            <div class="w-10 h-10 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center group-hover:bg-emerald-500/10 group-hover:rotate-90 transition-all duration-700 shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-white/20 group-hover:text-emerald-400 transition-colors"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            </div>
            新增區段
          </button>
        </div>
      </main>

      <!-- Wall Layout (Masonry) -->
      <main v-else-if="currentBoard?.layout === 'wall' && !showPasswordModal" 
            class="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 scroll-smooth">
        
        <!-- Add Post Form for Wall (New) -->
        <div v-if="activeSection === 'wall' && canContribute" class="max-w-3xl mx-auto mb-12 bg-slate-900/60 backdrop-blur-3xl rounded-[2.5rem] p-8 border border-white/5 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] animate-scale-in">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-inner">
               <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </div>
            <div>
              <h3 class="text-xl font-black text-white tracking-tight">建立新貼文</h3>
              <p class="text-slate-400 text-xs font-bold uppercase tracking-widest opacity-60">分享你的想法、圖片或連結</p>
            </div>
          </div>

          <input v-model="newPostTitle" type="text" :placeholder="isPoll ? '投票問題...' : '輸入標題 (選填)...'" class="w-full bg-white/5 border border-white/5 rounded-2xl px-6 py-4 text-white font-bold mb-4 outline-none focus:border-emerald-500/50 focus:bg-white/10 transition-all placeholder-white/20 shadow-inner">
          
           <!-- Poll Toggle removed from here -->

           <!-- Poll Options (Wall) -->
           <div v-if="isPoll" class="space-y-3 mb-6 bg-black/20 p-5 rounded-2xl border border-white/5 shadow-inner">
              <div v-for="(option, idx) in pollOptions" :key="option.id" class="flex items-center gap-3">
                  <span class="text-sm font-black text-slate-500 w-6 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                  <input v-model="option.text" type="text" :placeholder="`選項 ${idx + 1}`" class="flex-1 w-full min-w-0 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-all placeholder-white/20 shadow-sm" />
                  <button @click.stop="removePollOption(idx)" class="text-slate-500 hover:text-red-400 p-2 transition-colors" :disabled="pollOptions.length <= 2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
              </div>
              <button @click.stop="addPollOption" class="w-full py-3 border border-dashed border-white/10 rounded-xl text-slate-400 text-sm font-bold hover:bg-white/5 hover:text-emerald-400 hover:border-emerald-500/30 transition-all flex items-center justify-center gap-2 group/add">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/add:rotate-90 transition-transform"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  新增選項
              </button>
           </div>
          
          <div class="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
            <button v-for="color in POST_COLORS" :key="color.value" @click.stop="newPostColor = color.value"
                    class="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                    :class="newPostColor === color.value ? 'border-white scale-110 shadow-lg' : 'border-transparent'"
                    :style="{ backgroundColor: color.value }"></button>
          </div>

          <textarea v-model="newPostContent" 
                    :style="{ backgroundColor: newPostColor !== '#ffffff' ? newPostColor : 'transparent' }"
                    class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white min-h-[150px] outline-none focus:border-emerald-500 placeholder-white/30"
                    placeholder="寫點什麼嗎？"></textarea>
          
          <!-- Attachments -->
          <div v-if="pendingAttachments.length" class="flex gap-2 mt-4 flex-wrap">
              <div v-for="(att, idx) in pendingAttachments" :key="idx" class="relative w-20 h-20 rounded-xl overflow-hidden border border-white/20 group">
                <img v-if="att.thumbnailUrl" 
                     :src="att.type === 'image' ? getViewUrl(att.url) : att.thumbnailUrl" 
                     referrerpolicy="no-referrer"
                     class="w-full h-full object-cover">
                <div v-else class="absolute inset-0 flex flex-col items-center justify-center bg-white/5 p-4 group/patt">
                   <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40 group-hover/patt:scale-110 transition-transform">
                     <svg v-if="att.type === 'pdf'" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                     <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 8 6 4-6 4Z"/></svg>
                   </div>
                   <p class="text-[10px] text-white/40 truncate w-full text-center mt-2 font-bold px-2 uppercase tracking-tighter">{{ att.name }}</p>
                </div>
                <button @click.stop="removePendingAttachment(idx)" 
                        class="absolute top-1.5 right-1.5 bg-red-500/90 hover:bg-red-600 text-white rounded-lg w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-xl border border-red-400/20 active:scale-90">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
          </div>

          <div class="flex justify-between items-center mt-6">
            <div class="flex gap-2">
                <input ref="fileInput" type="file" accept="image/*,application/pdf,video/*" class="hidden" @change="handleFileSelect">
                <button @click.stop="fileInput?.click()" class="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center text-white transition-all border border-white/5 active:scale-95 group/upload" title="上傳檔案">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover:rotate-12 transition-transform"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                <button @click.stop="isPoll = !isPoll" 
                      class="w-12 h-12 rounded-xl flex items-center justify-center transition-all border active:scale-95"
                      :class="isPoll ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-white'"
                      title="發起投票">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="8" x2="16" y2="8"/></svg>
                </button>
            </div>
            <div class="flex gap-3">
              <button @click.stop="activeSection = null; pendingAttachments = []" class="px-6 py-2 text-white/50 hover:text-white transition-colors">取消</button>
              <button @click.stop="submitPost(localSections[0]?.id || '')" class="px-8 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg shadow-emerald-900/20 transition-all">發佈貼文</button>
            </div>
          </div>
        </div>

        <draggable 
          v-model="localWallPosts"
          item-key="id"
          tag="div"
          class="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-6 max-w-7xl mx-auto"
          :disabled="currentSort !== 'manual' || !isOwner"
          @end="handleWallReorder"
        >
          <template #item="{ element: post }">
            <div class="break-inside-avoid mb-6 rounded-[2rem] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.16)] transition-all duration-500 group relative border border-transparent h-fit hover:-translate-y-1 cursor-pointer will-change-transform"
                 style="content-visibility: auto; contain-intrinsic-size: 100px 300px;"
                 :style="{ backgroundColor: post.color || 'rgba(255,255,255,0.95)' }"
                 :class="{ 'ring-4 ring-emerald-500 ring-inset': dragTargetPostId === post.id }"
                 @dragover="handlePostDragOver(post.id, $event)"
                 @dragleave="dragTargetPostId = null"
                 @drop="handlePostDrop(post, $event)"
                 @click="openPostDetail(post)">
              
              <div v-if="dragTargetPostId === post.id" class="absolute inset-0 bg-emerald-500/20 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-xl pointer-events-none">
                  <span class="text-white font-bold bg-emerald-600 px-3 py-1 rounded-full text-xs">夾帶檔案至此</span>
              </div>
              
              <!-- Moderation Badge -->
              <div v-if="post.status === 'pending'" 
                   class="absolute top-0 left-0 px-3 py-1.5 bg-amber-500 text-white text-[9px] font-black rounded-br-2xl rounded-tl-xl shadow-lg z-20 pointer-events-none flex items-center gap-1.5 tracking-widest uppercase">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="animate-spin-slow"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                待核准
              </div>
              
              <!-- Post Actions -->
              <div class="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-10 translate-y-1 group-hover:translate-y-0">
                  <button v-if="isOwner && post.status === 'pending'"
                          @click.stop="handleApprovePost(post.id)"
                          class="w-8 h-8 bg-emerald-500/90 hover:bg-emerald-600 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 border border-emerald-400/20"
                          title="核准貼文">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                  <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                          @click.stop="handleDelete(post)"
                          class="w-8 h-8 bg-black/20 hover:bg-red-500 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-95 border border-white/10"
                          title="刪除">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  </button>
                  <button v-if="post.author.uid === authStore.user?.uid || (authStore.user && isOwner) || (!authStore.user && post.author.displayName === guestName && guestName)"
                          @click.stop="startEditPost(post)"
                          class="w-8 h-8 bg-black/20 hover:bg-emerald-500 text-white rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-95 border border-white/10"
                          title="編輯">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  </button>
              </div>

              <!-- Author -->
              <div class="flex items-center gap-2 mb-3">
                <img v-if="post.author.photoURL" 
                     :src="post.author.photoURL" 
                     @error="handleImageError(post.author)"
                     referrerpolicy="no-referrer" 
                     class="w-8 h-8 rounded-full object-cover">
                <div v-else class="w-8 h-8 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {{ post.author.displayName?.charAt(0) || '?' }}
                </div>
                <div>
                  <p class="font-black text-sm text-gray-800 flex items-center gap-1.5">
                      {{ post.author.displayName }}
                      <span v-if="post.author.uid === currentBoard?.ownerId" class="p-0.5 bg-amber-100 text-amber-600 rounded-md" title="看板擁有者">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2 3.5 20h17z"/></svg>
                      </span>
                  </p>
                  <p class="text-[10px] text-gray-400">{{ formatRelativeTime(post.createdAt) }}</p>
                </div>
              </div>

              <!-- Post Title -->
              <h4 v-if="post.title && editingPostId !== post.id" class="font-bold text-gray-800 mb-2 truncate" @click="openPostDetail(post)">{{ post.title }}</h4>

              <!-- Poll Display (Wall) -->
               <div v-if="post.poll" class="mb-4 w-full bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                  <div class="space-y-2">
                    <div v-for="option in post.poll.options" :key="option.id" class="relative group cursor-pointer" @click.stop="handleVote(post, option.id)">
                       <!-- Progress Bar -->
                       <div class="absolute inset-0 bg-white rounded-lg overflow-hidden h-full w-full border border-slate-200">
                          <div class="h-full bg-emerald-100 transition-all duration-500 ease-out" 
                               :style="{ width: post.poll.totalVotes > 0 ? (option.voters.length / post.poll.totalVotes * 100) + '%' : '0%' }"></div>
                       </div>
                       
                       <div class="relative flex items-center justify-between p-2 select-none">
                          <div class="flex items-center gap-2 overflow-hidden">
                             <!-- Indicator -->
                             <div class="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                                  :class="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')) ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white group-hover:border-emerald-400'">
                                 <svg v-if="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))" xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                             </div>
                             <span class="font-medium text-slate-800 text-xs truncate" :class="{'font-bold text-emerald-700': option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))}">{{ option.text }}</span>
                          </div>
                          <span class="text-[10px] font-bold text-slate-500 flex-shrink-0 tabular-nums">
                            {{ post.poll.totalVotes > 0 ? Math.round(option.voters.length / post.poll.totalVotes * 100) : 0 }}%
                          </span>
                       </div>
                    </div>
                  </div>
                  <div class="mt-2 text-[10px] text-slate-400 font-medium px-1 flex justify-between">
                      <span>{{ post.poll.totalVotes }} 票</span>
                  </div>
              </div>

              <!-- Content (Editable) -->
              <div v-if="editingPostId === post.id" class="mb-3">
                   <!-- Post Title for Edit -->
                   <input v-model="editPostTitle"
                          type="text"
                          placeholder="貼文標題 (選填)..."
                          class="w-full text-sm text-gray-800 bg-transparent outline-none mb-2 border-b border-gray-200 focus:border-emerald-500 transition-colors"
                          @keydown.enter.prevent="focusElement(`edit-post-${post.id}`)">
                   <!-- Color Picker for Edit -->
                     <div class="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                        <button v-for="color in POST_COLORS" :key="color.value"
                                @mousedown.prevent="editPostColor = color.value"
                                @click.stop
                                class="w-5 h-5 rounded-full border border-gray-200 transition-transform hover:scale-110 flex-shrink-0"
                                :class="{ 'ring-2 ring-emerald-500 ring-offset-1': editPostColor === color.value }"
                                :style="{ backgroundColor: color.value }"
                                :title="color.name">
                        </button>
                     </div>
                    <!-- Poll Editing UI (Wall) -->
                    <div v-if="post.poll" class="space-y-2 mb-4 bg-black/20 p-4 rounded-xl border border-white/5 mt-2 overflow-hidden">
                      <div v-for="(option, idx) in editPollOptions" :key="option.id" class="flex items-center gap-3">
                        <span class="text-xs font-black text-white/30 w-4 flex-shrink-0 text-center">{{ idx + 1 }}.</span>
                        <input v-model="option.text" type="text" class="flex-1 w-full min-w-0 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500/50 shadow-sm transition-colors" />
                      </div>
                    </div>

                  <textarea :id="`edit-post-${post.id}`"
                          v-model="editContent"
                           :style="{ backgroundColor: editPostColor !== '#ffffff' ? editPostColor : '#f9fafb' }"
                          @keydown.ctrl.enter="saveEditPost(post)"
                          @keydown.esc="cancelEditPost"
                          @click.stop
                          class="w-full border border-emerald-500 rounded p-2 text-sm outline-none resize-none h-24 transition-colors"></textarea>
                  
                  <!-- Media Tool for Edit -->
                  <div v-if="pendingAttachments.length" class="flex gap-1 mt-2 mb-2 flex-wrap">
                     <div v-for="(att, idx) in pendingAttachments" :key="idx" class="relative w-12 h-12 border rounded overflow-hidden group">
                        <img v-if="att.thumbnailUrl" 
                             :src="att.type === 'image' ? getViewUrl(att.url) : att.thumbnailUrl" 
                             referrerpolicy="no-referrer"
                             class="w-full h-full object-cover">
                        <div v-else class="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 p-1">
                           <span class="text-lg">📄</span>
                           <p class="text-[6px] text-gray-400 truncate w-full text-center">{{ att.name }}</p>
                        </div>
                        <button @click.stop="removePendingAttachment(idx)" 
                                class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center shadow-lg transition-transform hover:scale-110 z-10">×</button>
                     </div>
                  </div>
                  <div class="flex justify-between items-center mt-1">
                     <button @click.stop="fileInput?.click()" class="p-1 hover:bg-gray-100 rounded transition-colors text-lg" title="上傳附件">📎</button>
                     <div class="flex gap-2">
                       <button @click.stop="cancelEditPost" class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 font-bold border border-gray-200 rounded">取消</button>
                       <button @click.stop="saveEditPost(post)" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-bold shadow-sm">儲存</button>
                     </div>
                  </div>
              </div>
              <div v-else-if="post.content" 
                 @click="openPostDetail(post)"
                 class="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap mb-3 cursor-pointer hover:bg-black/5 rounded p-1 -m-1 transition-colors"
                 title="點擊放大">
                 <div :class="{'line-clamp-6': !expandedPostsInList[post.id] && post.content.length > 350}" v-html="formatContent(post.content)"></div>
                 <button v-if="post.content.length > 350" 
                         @click.stop="expandedPostsInList[post.id] = !expandedPostsInList[post.id]"
                         class="text-emerald-600 hover:text-emerald-700 text-[10px] font-black mt-2 uppercase tracking-widest flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-lg transition-colors">
                   {{ expandedPostsInList[post.id] ? '收起貼文' : '... 繼續閱讀' }}
                   <svg v-if="!expandedPostsInList[post.id]" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                   <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                 </button>
              </div>
              
              <!-- Attachments -->
              <div v-if="post.attachments?.length" class="space-y-2 mb-3">
                <template v-for="(att, index) in post.attachments" :key="att.url || att.shareUrl || index">
                  <div class="relative group/att">
                    <img v-if="att.type === 'image'" 
                         :src="getViewUrl(att.url || att.shareUrl!)" 
                         referrerpolicy="no-referrer"
                         class="w-full rounded-lg cursor-pointer hover:brightness-90 transition-all border border-gray-100"
                         @click="openPreview(att.url!, 'image')">
                    
                    <div v-else-if="att.type === 'youtube'" class="relative aspect-video rounded-lg overflow-hidden shadow-sm">
                      <iframe :src="att.shareUrl" class="absolute inset-0 w-full h-full" allowfullscreen frameborder="0"></iframe>
                    </div>
                    
                    <div v-else-if="att.type === 'pdf'" 
                         class="flex flex-col bg-gradient-to-br from-red-50 to-orange-50 hover:from-red-100 hover:to-orange-100 rounded-lg cursor-pointer transition-all border border-red-200/60 overflow-hidden shadow-sm hover:shadow-md group/pdf">
                      <!-- PDF Icon Area -->
                      <div class="w-full h-24 flex items-center justify-center bg-gradient-to-br from-red-100/80 to-red-200/50 relative">
                        <svg class="w-10 h-10 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                          <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1"/>
                          <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="white">PDF</text>
                        </svg>
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/pdf:opacity-100 transition-all duration-300 bg-black/40 backdrop-blur-[2px]"
                             @click.stop="openPreview(att.url || att.shareUrl || '', 'pdf')">
                          <span class="bg-white text-gray-900 px-4 py-1.5 rounded-full text-[10px] font-black shadow-xl flex items-center gap-2 transform -translate-y-2 group-hover/pdf:translate-y-0 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                            預覽檔案
                          </span>
                        </div>
                      </div>
                      <div class="p-2.5 flex items-center gap-3" @click="openLink(att.url || att.shareUrl, 'pdf')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                        <span class="text-[11px] font-bold text-red-700 truncate flex-1 uppercase tracking-tight">{{ att.name || 'PDF Document' }}</span>
                      </div>
                    </div>
    
                    <div v-else-if="att.type === 'video'" class="rounded-lg overflow-hidden bg-black shadow-sm">
                        <video :src="att.url || att.shareUrl" 
                               :poster="att.url ? getVideoThumbnail(att.url) : ''"
                               controls class="w-full"></video>
                    </div>

                    <div v-else-if="att.type === 'audio'" class="rounded-lg overflow-hidden shadow-sm bg-gray-50 p-1.5 border border-gray-100">
                       <div class="flex items-center gap-2 mb-1 px-1">
                          <span class="text-xs truncate font-bold text-gray-500">{{ att.name || '音訊' }}</span>
                       </div>
                       <audio :src="att.url || att.shareUrl" controls class="w-full h-8"></audio>
                    </div>

                    <!-- Delete Attachment Button -->
                    <button v-if="post.author.uid === authStore.user?.uid || isOwner"
                            @click.stop="deleteAttachment(post, Number(index))"
                            class="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500/90 hover:bg-red-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-all z-10 shadow-xl border border-red-400/20 active:scale-90"
                            title="移除附件">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </template>
              </div>

              <!-- Actions -->
              <div class="flex justify-between items-center py-2 border-t border-gray-100">
                <button @click.stop="handleLike(post)" 
                        class="flex items-center gap-1.5 text-xs transition-all hover:bg-rose-50 px-2.5 py-1.5 rounded-xl group/like"
                        :class="isLiked(post.id) || likedPosts[post.id] ? 'text-rose-500 font-bold' : 'text-gray-400 hover:text-rose-500'">
                  <span class="transform group-hover/like:scale-125 transition-transform duration-300">
                     <svg v-if="isLiked(post.id) || likedPosts[post.id]" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                     <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                  </span>
                  <span class="tabular-nums">{{ post.likes || 0 }}</span>
                </button>
                <button @click="toggleComments(post)" class="flex items-center gap-1.5 text-xs text-gray-400 hover:text-emerald-600 transition-colors px-2.5 py-1.5 rounded-xl hover:bg-emerald-50">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    留言 {{ post.comments?.length ? `(${post.comments.length})` : '' }}
                </button>
              </div>

              <!-- Comments Section -->
              <div class="mt-3 pt-3 border-t border-gray-100">
                  <div class="space-y-3 mb-3">
                      <div v-for="comment in (expandedComments[post.id] ? post.comments : (post.comments || []).slice(0, 5))" :key="comment.id" class="flex gap-2 text-sm group">
                          <img v-if="comment.author.photoURL" :src="comment.author.photoURL" referrerpolicy="no-referrer" class="w-6 h-6 rounded-full flex-shrink-0">
                          <div v-else class="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-[10px] flex-shrink-0">
                              {{ comment.author.displayName.charAt(0) }}
                          </div>
                          <div class="bg-white/40 backdrop-blur-md border border-white/20 rounded-2xl rounded-tl-none p-3 flex-1 relative shadow-sm">
                              <p class="font-black text-xs text-slate-900 mb-1 leading-tight">
                                  {{ comment.author.displayName }}
                              </p>
                              <div class="text-slate-800 text-[13px] leading-relaxed break-words" v-html="formatContent(comment.content)"></div>
                              <button v-if="comment.author.uid === authStore.user?.uid || isOwner"
                                      @click="handleDeleteComment(post, comment.id)"
                                      class="absolute top-1 right-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                              </button>
                          </div>
                      </div>
                  </div>
                  <div v-if="canContribute" class="flex items-center gap-2">
                      <input v-model="commentInputs[post.id]" 
                             @keydown.enter="submitComment(post)"
                             type="text" 
                             placeholder="寫下留言..." 
                             class="flex-1 bg-gray-100 rounded-full px-3 py-1.5 text-xs text-slate-900 outline-none focus:bg-white border border-transparent focus:border-emerald-500 transition-colors">
                      <button @click="submitComment(post)" class="text-emerald-600 hover:text-emerald-700 font-bold text-xs">發佈</button>
                  </div>
              </div>
            </div>
          </template>
        </draggable>

        <!-- Floating Add Button (Wall Mode) -->
        <button v-if="canContribute" @click="activeSection = (activeSection === 'wall' ? null : 'wall')" 
                class="fixed bottom-10 right-10 w-16 h-16 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[1.5rem] shadow-2xl flex items-center justify-center transition-all hover:scale-110 z-30 ring-4 ring-white/10 active:scale-90 group">
          <svg v-if="activeSection === 'wall'" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover:rotate-90 transition-transform"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </main>
    </template>

    <!-- Settings Modal -->
    <div v-if="showSettingsModal" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[100] p-4 animate-fade-in"
         @click.self="showSettingsModal = false">
      <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-10 w-full max-w-4xl shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] max-h-[90vh] overflow-y-auto animate-scale-in scrollbar-hide">
        <h2 class="text-3xl font-black text-white mb-10 flex items-center gap-4 tracking-tighter">
          <span class="w-10 h-10 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center border border-emerald-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </span> 
          看板設定中心
        </h2>
        
        <div class="flex flex-col lg:flex-row gap-8">
          <!-- Left Tabs Sidebar -->
          <div class="lg:w-48 flex-shrink-0">
            <nav class="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 scrollbar-hide">
              <button v-for="tab in SETTINGS_TABS" 
                      :key="tab.id"
                      @click="settingsTab = tab.id"
                      :class="['flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-black transition-all whitespace-nowrap border border-transparent', 
                               settingsTab === tab.id ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/40' : 'text-slate-400 hover:text-white hover:bg-white/5 hover:border-white/5']">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path :d="tab.icon"/></svg>
                {{ tab.label }}
              </button>
            </nav>
          </div>

          <!-- Right Content Area -->
          <div class="flex-1 space-y-8 text-white min-h-[400px]">
            <!-- Tab: Basic Info -->
            <transition-group name="fade-slide" mode="out-in">
              <div v-if="settingsTab === 'basic'" :key="'basic'" class="space-y-6">
                <div>
                  <label class="block text-xs font-black text-emerald-400 uppercase tracking-widest mb-3">看板標題</label>
                  <input v-model="currentBoard!.title" 
                         type="text" 
                         placeholder="輸入看板名稱..."
                         class="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 focus:outline-none focus:border-emerald-500 focus:bg-white/10 transition-all font-black text-lg">
                </div>
                <div>
                  <label class="block text-xs font-black text-emerald-400 uppercase tracking-widest mb-3">看板描述</label>
                  <textarea v-model="currentBoard!.description" 
                            rows="4"
                            placeholder="寫點什麼來介紹這個空間吧..."
                            class="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 focus:outline-none focus:border-emerald-500 focus:bg-white/10 transition-all resize-none text-sm leading-relaxed"></textarea>
                </div>
              </div>

              <!-- Tab: Visual & Background -->
              <div v-if="settingsTab === 'visual'" :key="'visual'" class="space-y-8">
                <!-- Layout -->
                <div>
                  <label class="block text-xs font-black text-emerald-400 uppercase tracking-widest mb-4">版型排版</label>
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div v-for="layout in [
                      { id: 'shelf', label: '互動書架', icon: 'M3 3h8v18H3zM13 3h8v18h-8zM3 9h8M13 9h8' },
                      { id: 'wall', label: '隨意牆面', icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18' },
                      { id: 'stream', label: '串流視窗', icon: 'M3 6h18M3 12h18M3 18h18' }
                    ]" :key="layout.id"
                         @click="currentBoard!.layout = layout.id as any"
                         :class="['p-4 rounded-[2rem] border-2 text-center cursor-pointer transition-all flex flex-col items-center gap-3 group', 
                                   currentBoard?.layout === layout.id ? 'border-emerald-500 bg-emerald-500/10 text-white shadow-xl shadow-emerald-900/40' : 'border-white/5 text-gray-500 hover:border-white/20 hover:bg-white/5']">
                      <div class="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="layout.icon"/></svg>
                      </div>
                      <span class="text-xs font-black tracking-tighter">{{ layout.label }}</span>
                    </div>
                  </div>
                </div>

                <!-- Background -->
                <div>
                  <label class="block text-xs font-black text-emerald-400 uppercase tracking-widest mb-4">視覺背景</label>
                  
                  <div class="space-y-4">
                    <div class="grid grid-cols-4 gap-3">
                       <div v-for="(bg, idx) in presetBackgrounds" :key="idx" 
                       @click="currentBoard!.backgroundImage = bg"
                       :class="['aspect-video rounded-xl bg-cover bg-center cursor-pointer border-2 transition-all hover:scale-110 z-10', currentBoard?.backgroundImage === bg ? 'border-emerald-500 scale-105' : 'border-transparent hover:border-white/30']"
                       :style="{ backgroundImage: `url(${bg})` }">
                       </div>
                    </div>

                    <div class="pt-4 border-t border-white/5">
                      <div class="flex justify-between items-center mb-4">
                        <h4 class="text-[10px] font-black text-gray-500 uppercase tracking-widest leading-none">自定義上傳</h4>
                        <input ref="backgroundFileInput" type="file" accept="image/*" class="hidden" @change="handleBackgroundUpload">
                        <button @click="backgroundFileInput?.click()" 
                                :disabled="isUploadingBackground"
                                class="px-3 py-1.5 bg-white/5 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 border border-white/10">
                          {{ isUploadingBackground ? '上傳中...' : '+ 選擇檔案' }}
                        </button>
                      </div>
                      
                      <div v-if="customBackgrounds.length" class="grid grid-cols-4 gap-3">
                        <div v-for="bg in customBackgrounds" :key="bg.id" 
                             @click="currentBoard!.backgroundImage = bg.url"
                             :class="['aspect-video rounded-xl bg-cover bg-center cursor-pointer border-2 transition-all relative group', currentBoard?.backgroundImage === bg.url ? 'border-emerald-500 scale-105' : 'border-white/5 hover:border-white/20']"
                             :style="{ backgroundImage: `url(${bg.url})` }">
                             <button @click.stop="handleDeleteBackground(bg.id, bg.publicId, bg.resourceType)" 
                                     class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-xl z-20">
                                 <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                             </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab: Privacy & Permissions -->
              <div v-if="settingsTab === 'privacy'" :key="'privacy'" class="space-y-8">
                <div>
                   <label class="block text-xs font-black text-emerald-400 uppercase tracking-widest mb-4">權限模式</label>
                   <div class="grid gap-3">
                      <label v-for="p in [
                        { id: 'public', label: '公開看板', desc: '任何知道連結的人皆可存取', icon: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z', color: 'text-emerald-400' },
                        { id: 'password', label: '密碼保護', desc: '訪客需輸入密碼才能瀏覽', icon: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4', color: 'text-blue-400' },
                        { id: 'private', label: '完全私密', desc: '僅限擁有者（您）可以進入', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', color: 'text-red-400' }
                      ]" :key="p.id" 
                             :class="['flex items-center gap-4 cursor-pointer p-4 rounded-3xl border-2 transition-all group/opt', 
                                       currentBoard!.privacy === p.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/5 bg-white/5 hover:border-white/20']">
                          <input type="radio" v-model="currentBoard!.privacy" :value="p.id" class="sr-only">
                          <div :class="['w-12 h-12 rounded-2xl bg-black/20 flex items-center justify-center group-hover/opt:scale-110 transition-transform', p.color]">
                            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path :d="p.icon"/></svg>
                          </div>
                          <div class="flex-1">
                            <span class="text-sm font-black block text-white">{{ p.label }}</span>
                            <span class="text-[11px] text-gray-500 font-bold uppercase tracking-tight">{{ p.desc }}</span>
                          </div>
                          <div v-if="currentBoard!.privacy === p.id" class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                      </label>
                   </div>
                </div>

                <div v-if="currentBoard!.privacy === 'password'" class="animate-scale-in">
                  <label class="block text-xs font-black text-gray-500 uppercase tracking-widest mb-2 px-2">存取密碼</label>
                  <input v-model="currentBoard!.password" 
                         type="text" 
                         placeholder="設定 4-12 位存取密碼..." 
                         class="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-emerald-500 font-mono tracking-widest">
                </div>

                <div v-if="currentBoard!.privacy !== 'private'" class="pt-6 border-t border-white/5">
                   <h4 class="text-xs font-black text-gray-500 uppercase tracking-widest mb-4">內文與審核</h4>
                   <div class="space-y-4">
                      <div class="bg-white/5 p-5 rounded-[2rem] border border-white/5 space-y-4">
                        <div class="flex items-center justify-between">
                          <span class="text-sm font-black text-gray-200">訪客寫作權限</span>
                          <div class="flex bg-black/40 p-1 rounded-xl">
                            <button v-for="p in [{id:'edit',l:'可新增'}, {id:'view',l:'唯讀'}]" :key="p.id"
                                    @click="currentBoard!.guestPermission = p.id as any"
                                    :class="['px-4 py-1.5 rounded-lg text-xs font-black transition-all', currentBoard!.guestPermission === p.id ? 'bg-emerald-500 text-white shadow-md' : 'text-gray-500 hover:text-white']">
                              {{ p.l }}
                            </button>
                          </div>
                        </div>
                        <div class="h-px bg-white/5"></div>
                        <div class="flex items-center justify-between group/mod cursor-pointer" @click="currentBoard!.moderationEnabled = !currentBoard!.moderationEnabled">
                          <div>
                            <span class="text-sm font-black text-gray-200 block">啟動審核機制</span>
                            <span class="text-[10px] text-gray-500 font-medium tracking-tight">開啟後，訪客貼文需經您核准後才會公開</span>
                          </div>
                          <div :class="['w-12 h-6 rounded-full relative transition-all duration-300', currentBoard!.moderationEnabled ? 'bg-emerald-500' : 'bg-gray-700']">
                             <div :class="['absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300', currentBoard!.moderationEnabled ? 'left-7' : 'left-1']"></div>
                          </div>
                        </div>
                      </div>
                   </div>
                </div>

                <div class="pt-10">
                   <h4 class="text-xs font-black text-red-500 uppercase tracking-widest mb-4">危險區域</h4>
                   <button @click="deleteBoard" class="w-full flex items-center justify-between p-5 rounded-[2rem] border-2 border-red-500/10 bg-red-500/5 hover:bg-red-500/10 transition-all group">
                      <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-xl bg-red-500/20 text-red-500 flex items-center justify-center">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </div>
                        <div class="text-left">
                          <span class="text-sm font-black text-red-500 block">刪除此看板</span>
                          <span class="text-[10px] text-red-500/60 font-medium">警告：此操作不可復原，所有資料將永久消失</span>
                        </div>
                      </div>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-red-500/50 group-hover:translate-x-1 transition-transform"><path d="M9 18l6-6-6-6"/></svg>
                   </button>
                </div>
              </div>
              <!-- Tab: System & Advanced -->
              <div v-if="settingsTab === 'system'" :key="'system'" class="space-y-8 pb-10">
                
                <!-- Section: Global Branding -->
                <div class="space-y-4">
                  <h3 class="text-sm font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                    <span class="w-1 h-4 bg-emerald-500 rounded-full"></span>
                    網站全域設定
                  </h3>
                  <div class="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-6">
                    <div>
                        <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">網站總標題</label>
                        <input v-model="appConfig.appTitle" 
                               type="text" 
                               placeholder="範例: 我的專屬互動空間"
                               class="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-5 py-3.5 focus:outline-none focus:border-emerald-500 transition-all font-bold">
                    </div>
                    <div>
                        <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">建立者白名單 (逗號分隔 Email)</label>
                        <textarea v-model="whitelistInput" 
                                  @blur="updateWhitelist"
                                  placeholder="範例: user1@gmail.com, user2@gmail.com"
                                  rows="3"
                                  class="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-5 py-3.5 focus:outline-none focus:border-emerald-500 transition-all font-mono text-xs resize-none"></textarea>
                        <p class="text-[10px] text-gray-500 mt-2 px-1 italic">若留空則開放所有登入帳號建立看板。</p>
                    </div>
                    <button @click="saveGlobalSettings" 
                            class="w-full py-3.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-2xl font-black transition-all border border-emerald-500/30">
                        儲存全域設定至資料庫
                    </button>
                  </div>
                </div>

                <!-- Section: Cloudinary Config -->
                <div class="space-y-4">
                  <h3 class="text-sm font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                    <span class="w-1 h-4 bg-blue-500 rounded-full"></span>
                    雲端多媒體 (Cloudinary)
                  </h3>
                  <div class="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">Cloud Name</label>
                            <input v-model="appConfig.cloudinary.cloudName" 
                                   type="text" 
                                   placeholder="demo-cloud"
                                   class="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all font-mono">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">Upload Preset</label>
                            <input v-model="appConfig.cloudinary.uploadPreset" 
                                   type="text" 
                                   placeholder="unsigned-preset"
                                   class="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all font-mono">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">API Key</label>
                            <input v-model="appConfig.cloudinary.apiKey" 
                                   type="text" 
                                   class="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all font-mono">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">API Secret</label>
                            <input v-model="appConfig.cloudinary.apiSecret" 
                                   type="password" 
                                   class="w-full bg-slate-950/50 border border-white/5 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all font-mono">
                        </div>
                    </div>
                    <button @click="saveCloudinaryConfig" 
                            class="w-full py-3.5 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded-2xl font-black transition-all border border-blue-500/30">
                        同步雲媒體設定至資料庫
                    </button>
                    <p class="text-[9px] text-gray-500 text-center font-bold">🔒 API Secret 已在資料庫層級加密，且不會包含在分享連結中。</p>
                  </div>
                </div>
              </div>
            </transition-group>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-8 pt-4 border-t border-white/10">
          <button @click="showSettingsModal = false" class="px-5 py-2.5 text-gray-400 hover:text-white transition-colors">取消</button>
          <button @click="saveBoardSettings" class="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-emerald-900/20">
            儲存變更
          </button>
        </div>
      </div>
    </div>

    <!-- Share Modal -->
    <div v-if="showShareModal" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[150] p-4"
         @click.self="showShareModal = false">
      <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-10 w-full max-w-sm shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] animate-scale-in relative overflow-hidden">
        <button @click="showShareModal = false" class="absolute top-8 right-8 text-slate-400 hover:text-white transition-all w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-white/5 border border-transparent hover:border-white/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        
        <div class="text-center">
          <h2 class="text-2xl font-black text-white mb-2 tracking-tight">分享看板</h2>
          <p class="text-sm text-slate-400 font-medium mb-8">邀請他人一起協作或瀏覽此空間</p>
          
          <div class="bg-white p-6 rounded-[2rem] shadow-xl inline-block mb-8 relative group border border-slate-800">
            <qrcode-vue :value="generateShareLink()" :size="200" level="H" class="mx-auto" />
            <div class="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-500 bg-emerald-500/90 backdrop-blur-sm rounded-[2rem]">
               <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="mb-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
               <span class="text-xs font-black text-white uppercase tracking-widest">掃描存取</span>
            </div>
          </div>
 
          <div class="flex items-center gap-2 bg-white/5 border border-white/5 rounded-2xl p-2 mb-6">
            <input :value="generateShareLink()" readonly class="bg-transparent text-xs text-slate-300 w-full outline-none px-4 truncate font-medium">
            <button @click="copyLink" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-xs font-black transition-all shadow-lg shadow-emerald-900/40 active:scale-95 whitespace-nowrap">
              {{ isCopyingConfig ? '已複製!' : '複製連結' }}
            </button>
          </div>

          <div class="text-[11px] font-bold py-2 px-4 rounded-full bg-gray-50 border border-gray-100 inline-flex items-center gap-2">
            存取權限：
            <span v-if="currentBoard?.privacy === 'public'" class="text-emerald-600 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
              公開看板
            </span>
            <span v-else class="text-amber-600 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              有限制存取
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Media Preview Modal -->
    <div v-if="previewUrl" 
         class="fixed inset-0 bg-slate-950/95 backdrop-blur-3xl flex items-center justify-center z-[200] p-4 animate-fade-in"
         @click="previewUrl = null">
      <div class="relative w-full h-full max-w-6xl flex flex-col items-center justify-center animate-scale-in" @click.stop>
        <!-- Close Button (Always visible top right) -->
        <button @click="previewUrl = null" class="absolute top-0 right-0 lg:-top-12 lg:-right-12 w-12 h-12 bg-white/10 hover:bg-red-500 text-white rounded-2xl flex items-center justify-center transition-all z-20 backdrop-blur-md border border-white/10 group shadow-2xl">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover:rotate-90 transition-transform"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        
        <!-- Action Bar (Floating Bottom) -->
        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-2xl px-6 py-3 rounded-[2rem] text-white text-xs font-black tracking-widest uppercase flex items-center gap-6 z-30 border border-white/20 shadow-2xl animate-slide-up">
            <button @click="openLink(previewOriginalUrl || previewUrl || '', previewType === 'pdf' ? 'pdf' : 'link')" class="hover:text-emerald-400 flex items-center gap-2 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              新分頁開啟
            </button>
            <div class="w-px h-4 bg-white/10"></div>
            <button @click="previewUrl = null" class="hover:text-red-400 flex items-center gap-2 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              關閉預覽
            </button>
        </div>
        
        <!-- PDF Viewer -->
        <div v-if="previewType === 'pdf'" class="w-full h-full rounded-[2.5rem] overflow-hidden bg-white shadow-2xl border border-white/20">
          <iframe :src="previewUrl" 
                  class="w-full h-full border-0" 
                  allow="fullscreen"
                  title="PDF 預覽"></iframe>
        </div>

        <!-- Image Viewer -->
        <img v-else-if="previewType === 'image'" 
             :src="previewUrl" 
             class="max-w-full max-h-full object-contain rounded-xl shadow-2xl">

        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full text-white text-xs flex gap-4">
            <button @click="openLink(previewOriginalUrl || previewUrl || '', previewType === 'pdf' ? 'pdf' : 'link')" class="hover:text-emerald-400">🔗 分頁開啟</button>
            <span class="opacity-30">|</span>
            <button @click="previewUrl = null" class="hover:text-red-400">🚪 關閉</button>
        </div>
      </div>
    </div>
    <!-- Section Title Modal -->
    <div v-if="showSectionPrompt" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[250] p-4 animate-fade-in"
         @click.self="showSectionPrompt = false">
      <div class="bg-slate-900 border border-white/10 rounded-[2.5rem] p-8 w-full max-w-sm shadow-2xl animate-scale-in">
        <div class="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6 border border-emerald-500/20">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>
        </div>
        <h3 class="text-xl font-black text-white mb-2 text-center tracking-tight">新增區段</h3>
        <p class="text-xs text-slate-400 text-center mb-8 font-medium">為您的看板建立一個新的分類分欄</p>
        
        <input v-model="newSectionName" 
               type="text" 
               placeholder="例如：待辦清單、靈感、已完成..." 
               class="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 mb-8 focus:outline-none focus:border-emerald-500 focus:bg-white/10 transition-all font-black text-center"
               @keydown.enter="confirmCreateSection"
               autofocus>
        
        <div class="flex gap-3">
           <button @click="showSectionPrompt = false" class="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-colors">取消</button>
           <button @click="confirmCreateSection" 
                   :disabled="!newSectionName.trim()"
                   class="flex-[2] py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black disabled:opacity-50 transition-all shadow-xl shadow-emerald-900/40 active:scale-95">
             建立區段
           </button>
        </div>
      </div>
    </div>

    <!-- YouTube Link Modal -->
    <div v-if="showYouTubeInput" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[250] p-4 animate-fade-in"
         @click.self="showYouTubeInput = false">
      <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-10 w-full max-w-sm shadow-2xl animate-scale-in text-center">
        <div class="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6 border border-red-500/20 shadow-lg shadow-red-500/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
        </div>
        <h3 class="text-2xl font-black text-white mb-2 tracking-tight">插入 YouTube</h3>
        <p class="text-sm text-slate-400 mb-8 font-medium">貼上連結，我們會自動產生精美預覽</p>
        
        <input v-model="youtubeUrlInput" 
               type="text" 
               placeholder="貼上網址或分享連結..." 
               class="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 mb-8 focus:outline-none focus:border-red-500 focus:bg-white/10 transition-all font-black text-center text-sm"
               @keydown.enter="confirmAddYouTube"
               autofocus>
        
        <div class="flex gap-3">
           <button @click="showYouTubeInput = false" class="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-colors">取消</button>
           <button @click="confirmAddYouTube" 
                   :disabled="!youtubeUrlInput.trim()"
                   class="flex-[2] py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black disabled:opacity-50 transition-all shadow-xl shadow-red-900/40 active:scale-95">
             加入影片
           </button>
        </div>
      </div>
    </div>
  </div>

    <!-- Guest Name Modal -->

    <div v-if="showGuestNameModal" 
         class="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[250] p-4 animate-fade-in"
         @click.self="showGuestNameModal = false">
      <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-10 w-full max-w-sm shadow-2xl animate-scale-in text-center">
        <div class="w-16 h-16 bg-purple-500/10 text-purple-400 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6 border border-purple-500/20">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <h3 class="text-2xl font-black text-white mb-2 tracking-tight">設定您的暱稱</h3>
        <p class="text-sm text-slate-400 mb-8 font-medium">輸入一個名稱，讓大家認識您吧！</p>
        
        <input v-model="guestNameInput" 
               type="text" 
               placeholder="輸入稱呼 (例：阿墨、小明...)" 
               class="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 mb-8 focus:outline-none focus:border-purple-500 focus:bg-white/10 transition-all font-black text-center text-lg"
               @keydown.enter="saveGuestName"
               autofocus>
        
        <div class="flex gap-3">
           <button @click="showGuestNameModal = false" class="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-colors">取消</button>
           <button @click="saveGuestName" 
                   :disabled="!guestNameInput.trim()"
                   class="flex-[2] py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-black disabled:opacity-50 transition-all shadow-xl shadow-purple-900/40 active:scale-95">
             開始體驗
           </button>
        </div>
      </div>
    </div>

    <!-- Post Detail Modal -->
    <div v-if="expandedPost" 
         class="fixed inset-0 bg-slate-950/90 backdrop-blur-2xl flex items-center justify-center z-[190] p-4 lg:p-10 animate-fade-in"
         @click="closePostDetail"
         @keydown.left="navigatePost('prev')"
         @keydown.right="navigatePost('next')"
         @keydown.escape="closePostDetail"
         tabindex="0"
         ref="postDetailModal">
      
      <!-- Navigation Group -->
      <div class="relative flex items-center justify-center w-full max-w-7xl gap-6 h-full pointer-events-none" @click.stop>
        <!-- Navigation Arrows -->
        <button v-if="expandedPostIndex > 0"
                @click.stop="navigatePost('prev')" 
                class="w-16 h-16 bg-white/5 hover:bg-white/10 rounded-3xl flex items-center justify-center text-white z-20 backdrop-blur-xl transition-all hover:scale-110 pointer-events-auto border border-white/10 shadow-2xl group">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover:-translate-x-1 transition-transform"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div v-else class="w-16 h-16"></div> <!-- Spacer -->
 
        <!-- Post Detail Card -->
        <div v-if="expandedPost" class="bg-white/95 backdrop-blur-3xl rounded-[3rem] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.5)] w-full max-w-2xl max-h-[90vh] overflow-y-auto relative pointer-events-auto border border-white/40 animate-scale-in" 
             @click.stop
             :style="expandedPost.color ? { backgroundColor: expandedPost.color } : {}">
        
        <!-- Close Button -->
        <button @click="closePostDetail" class="absolute top-8 right-8 w-12 h-12 bg-black/5 hover:bg-black/10 rounded-2xl flex items-center justify-center text-gray-600 z-10 transition-all hover:rotate-90 hover:scale-110">
           <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
 
        <!-- Post Counter -->
        <div class="absolute top-8 left-10 bg-black/5 rounded-2xl px-5 py-2 text-[10px] font-black tracking-[0.2em] text-gray-400 uppercase">
          Post {{ expandedPostIndex + 1 }} <span class="mx-1 opacity-30">/</span> {{ allFlatPosts.length }}
        </div>

          <div class="p-8 pt-16">
            <!-- Author -->
            <div class="flex items-center gap-4 mb-8 bg-slate-50/50 p-4 rounded-3xl border border-slate-100/50 shadow-inner">
              <img v-if="expandedPost.author.photoURL" :src="expandedPost.author.photoURL" referrerpolicy="no-referrer" class="w-12 h-12 rounded-2xl object-cover border-2 border-white shadow-sm">
              <div v-else class="w-12 h-12 bg-gradient-to-br from-slate-200 to-slate-400 rounded-2xl flex items-center justify-center text-slate-600 font-black text-xl shadow-sm border-2 border-white">
                {{ expandedPost.author.displayName?.charAt(0) || '?' }}
              </div>
              <div class="flex flex-col">
                <p class="font-black text-slate-800 text-base leading-none mb-1">{{ expandedPost.author.displayName }}</p>
                <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest">{{ expandedPost.createdAt?.toLocaleString ? expandedPost.createdAt.toLocaleString() : '剛剛' }}</p>
              </div>
            </div>
 
            <!-- Content -->
            <p v-if="expandedPost.content" class="text-slate-700 text-lg leading-relaxed whitespace-pre-wrap mb-6 font-medium px-2" v-html="formatContent(expandedPost.content)"></p>
 
             <!-- Poll Display (Expanded) -->
             <div v-if="expandedPost.poll" class="mb-8 w-full bg-slate-50 rounded-[2rem] p-6 border border-slate-100 shadow-inner">
                <div class="space-y-3">
                  <div v-for="option in expandedPost.poll.options" :key="option.id" 
                       class="relative group cursor-pointer active:scale-[0.99] transition-transform" 
                       @click.stop="handleVote(expandedPost!, option.id)">
                     <!-- Progress Bar -->
                     <div class="absolute inset-0 bg-white rounded-2xl overflow-hidden h-full w-full border border-slate-200">
                        <div class="h-full bg-emerald-500/10 transition-all duration-700 ease-out" 
                             :style="{ width: expandedPost.poll.totalVotes > 0 ? (option.voters.length / expandedPost.poll.totalVotes * 100) + '%' : '0%' }"></div>
                     </div>
                     
                     <div class="relative flex items-center justify-between p-4 select-none">
                        <div class="flex items-center gap-3 overflow-hidden">
                           <div class="w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all bg-white"
                                :class="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')) ? 'border-emerald-500 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'border-slate-300 group-hover:border-emerald-400'">
                               <svg v-if="option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                           </div>
                           <span class="font-bold text-slate-800 text-sm" :class="{'text-emerald-700': option.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : ''))}">{{ option.text }}</span>
                        </div>
                        <div class="flex flex-col items-end">
                          <span class="text-sm font-black text-emerald-600 tabular-nums">
                            {{ expandedPost.poll.totalVotes > 0 ? Math.round(option.voters.length / expandedPost.poll.totalVotes * 100) : 0 }}%
                          </span>
                          <span class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{{ option.voters.length }} 票</span>
                        </div>
                     </div>
                  </div>
                </div>
                <div class="mt-4 pt-4 border-t border-slate-200/50 flex justify-between items-center px-2">
                    <span class="text-xs font-black text-slate-400 uppercase tracking-widest">{{ expandedPost.poll.totalVotes }} 總票數</span>
                    <span v-if="expandedPost.poll.options.some(opt => opt.voters.includes(authStore.user?.uid || (guestName ? 'guest:'+guestName : '')))" 
                          class="text-[10px] font-black text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                      已投票
                    </span>
                </div>
             </div>

          <!-- Attachments -->
          <div v-if="expandedPost.attachments?.length" class="space-y-4 mb-6">
            <template v-for="(att, idx) in expandedPost.attachments" :key="idx">
              <div class="relative group/att text-gray-800">
                <!-- Image -->
                <img v-if="att.type === 'image' && (att.url || att.shareUrl)" 
                     :src="att.url || att.shareUrl" 
                     class="w-full rounded-2xl cursor-pointer hover:brightness-95 transition-all shadow-sm border border-gray-100"
                     @click="openPreview(att.url || att.shareUrl || '', 'image')">

                <!-- Video -->
                <div v-else-if="att.type === 'video'" class="rounded-2xl overflow-hidden shadow-sm bg-black">
                    <video :src="att.url || att.shareUrl" 
                           :poster="att.url ? getVideoThumbnail(att.url) : ''"
                           controls class="w-full max-h-[500px]"></video>
                </div>

                <!-- Audio -->
                <div v-else-if="att.type === 'audio'" class="rounded-2xl overflow-hidden shadow-sm bg-gray-50 p-4 border border-gray-100">
                   <div class="flex items-center gap-3 mb-3">
                      <div class="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-xl shadow-sm">🎵</div>
                      <div class="flex-1 min-w-0">
                         <p class="font-bold text-gray-700 text-sm truncate">{{ att.name || '音訊檔案' }}</p>
                         <p class="text-xs text-gray-400">點擊播放</p>
                      </div>
                   </div>
                   <audio :src="att.url || att.shareUrl" controls class="w-full h-10"></audio>
                </div>

                <!-- PDF -->
                <div v-else-if="att.type === 'pdf'" 
                     class="flex items-center gap-4 bg-red-50 rounded-2xl p-4 cursor-pointer hover:bg-red-100 transition-all border border-red-100/50"
                     @click="openPreview(att.url || att.shareUrl || '', 'pdf')">
                  <div class="w-14 h-14 bg-red-100 rounded-xl flex items-center justify-center shadow-sm">
                    <svg class="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                      <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1"/>
                      <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="white">PDF</text>
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-bold text-red-800 text-base truncate">{{ att.name || 'PDF 文件' }}</p>
                    <p class="text-red-400 text-sm">點擊內嵌預覽</p>
                  </div>
                </div>

                <!-- YouTube -->
                <div v-else-if="att.type === 'youtube'" class="aspect-video rounded-2xl overflow-hidden shadow-md">
                   <iframe :src="att.shareUrl" class="w-full h-full" frameborder="0" allowfullscreen></iframe>
                </div>

                <!-- Delete Attachment Button -->
                <button v-if="expandedPost.author.uid === authStore.user?.uid"
                        @click.stop="deleteAttachment(expandedPost, Number(idx))"
                        class="absolute top-2 right-2 w-8 h-8 bg-red-600/90 text-white rounded-full flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-all z-10 shadow-lg"
                        title="移除附件">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              </div>
            </template>
          </div>

          <!-- Actions -->
          <div class="flex justify-between items-center py-4 border-t border-gray-200/50">
            <button @click="handleLike(expandedPost!)" 
                    class="flex items-center gap-2 text-gray-400 hover:text-rose-500 transition-colors group/dlike">
              <span class="transform group-hover/dlike:scale-125 transition-transform duration-300">
                <svg v-if="isLiked(expandedPost!.id) || likedPosts[expandedPost!.id]" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="text-rose-500"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
              </span>
              <span class="font-bold text-sm tabular-nums" :class="{ 'text-rose-500': isLiked(expandedPost!.id) || likedPosts[expandedPost!.id] }">
                {{ expandedPost!.likes || 0 }}
              </span>
            </button>

          </div>

          <!-- Comments Section (always expanded) -->
          <div class="pt-6 border-t border-slate-100 pb-2">
            <h4 class="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {{ expandedPost!.comments?.length || 0 }} 則留言
            </h4>
            
            <div class="space-y-4 mb-6">
              <div v-for="comment in (expandedComments[expandedPost!.id] ? expandedPost!.comments : (expandedPost!.comments || []).slice(0, 5))" :key="comment.id" class="flex gap-4 text-sm group animate-fade-in">
                <img v-if="comment.author.photoURL" :src="comment.author.photoURL" referrerpolicy="no-referrer" class="w-8 h-8 rounded-xl flex-shrink-0 border-2 border-white shadow-sm">
                <div v-else class="w-8 h-8 bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-[10px] font-black text-slate-500 flex-shrink-0">
                  {{ comment.author.displayName.charAt(0) }}
                </div>
                <div class="bg-slate-50/80 rounded-2xl rounded-tl-none p-4 flex-1 relative border border-slate-100/50 hover:bg-slate-100/50 transition-colors">
                  <div class="flex justify-between items-start mb-1">
                    <p class="font-black text-xs text-slate-700 leading-none">{{ comment.author.displayName }}</p>
                    <button v-if="comment.author.uid === authStore.user?.uid || isOwner || (!authStore.user && comment.author.displayName === guestName && guestName)"
                            @click="handleDeleteComment(expandedPost!, comment.id)"
                            class="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1 hover:bg-red-50 rounded-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <p class="text-slate-600 leading-relaxed font-medium">{{ comment.content }}</p>
                </div>
              </div>
              <button v-if="expandedPost!.comments?.length && expandedPost!.comments.length > 5" 
                      @click="toggleExpandComments(expandedPost!.id)"
                      class="text-emerald-600 hover:text-emerald-700 text-xs font-black py-2 w-full text-center bg-emerald-50/50 rounded-xl border border-emerald-100 hover:bg-emerald-100 transition-all">
                {{ expandedComments[expandedPost!.id] ? '↑ 收起捲動留言' : `展開其餘 ${expandedPost!.comments.length - 5} 則留言...` }}
              </button>
            </div>
 
            <!-- Comment Input -->
            <div class="flex items-center gap-3 bg-slate-50 p-2 rounded-[1.5rem] border border-slate-100 focus-within:border-emerald-500/50 focus-within:bg-white transition-all shadow-inner">
              <input v-model="commentInputs[expandedPost!.id]" 
                     @keydown.enter="submitComment(expandedPost!)"
                     type="text" 
                     placeholder="寫下你的想法..." 
                     class="flex-1 bg-transparent px-4 py-2 text-sm outline-none font-medium placeholder-slate-400">
              <button @click="submitComment(expandedPost!)" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-2xl font-black text-xs shadow-lg shadow-emerald-900/20 active:scale-95 transition-all">發佈</button>
            </div>
          </div>
        </div>
        </div>

        <!-- Next Button -->
        <button v-if="expandedPostIndex < allFlatPosts.length - 1"
                @click.stop="navigatePost('next')" 
                class="w-16 h-16 bg-white/5 hover:bg-white/10 rounded-3xl flex items-center justify-center text-white z-20 backdrop-blur-xl transition-all hover:scale-110 pointer-events-auto border border-white/10 shadow-2xl group">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="group-hover:translate-x-1 transition-transform"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div v-else class="w-16 h-16"></div> <!-- Spacer -->
      </div>
    </div>

    <!-- Password Verification Modal -->
    <Teleport to="body">
      <div v-if="showPasswordModal" 
          class="fixed inset-0 bg-slate-950/95 backdrop-blur-3xl flex items-center justify-center z-[9999] p-4 animate-fade-in"
          data-no-close>
          <div class="bg-slate-900 border border-white/10 rounded-[3rem] p-12 w-full max-w-md shadow-2xl text-center relative z-[10000] animate-scale-in">
              <div class="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-3xl flex items-center justify-center text-4xl mx-auto mb-8 border border-emerald-500/20 shadow-xl shadow-emerald-900/10">
                🔒
              </div>
              <h2 class="text-3xl font-black text-white mb-3 tracking-tight">此看板受保護</h2>
              <p class="text-slate-400 text-sm mb-10 font-medium">請輸入看板密碼以繼續存取內容</p>
              
              <form @submit.prevent="submitPassword" class="space-y-6">
                  <input v-model="passwordInput" 
                          type="password" 
                          placeholder="••••••••" 
                          class="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-emerald-500 transition-all text-center text-2xl tracking-[0.5em] font-mono"
                          autofocus>
                  
                  <p v-if="passwordError" class="text-red-400 text-xs font-bold animate-shake">{{ passwordError }}</p>
 
                  <button type="submit" 
                          class="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-emerald-900/40 active:scale-95 disabled:opacity-50"
                          :disabled="!passwordInput">
                      解鎖進入
                  </button>
              </form>
              
              <button @click="$router.push('/')" class="mt-8 text-slate-500 text-xs font-bold hover:text-white transition-colors flex items-center gap-2 mx-auto">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                回首頁
              </button>
          </div>
      </div>
    </Teleport>


    <!-- Slideshow Overlay -->
    <Teleport to="body">
      <div v-if="showSlideshow" class="fixed inset-0 z-[99999] bg-gradient-to-br from-slate-950 via-gray-900 to-slate-900 text-white flex flex-col font-sans">
        <!-- Slideshow Controls (Top Right) -->
        <div class="absolute top-6 right-6 flex items-center gap-3 z-50">
           <button @click="toggleFullscreen" class="p-3 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-all text-white/50 hover:text-white" title="全螢幕">
             <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 1 2-2v-3"/></svg>
           </button>
           <div class="h-6 w-px bg-white/10 mx-1"></div>
           <button @click="togglePlayPause" class="p-3 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-all group text-white/70 hover:text-white" :title="isPlaying ? '暫停' : '播放'">
             <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
             <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M5 3l14 9-14 9V3z"/></svg>
           </button>
           <button @click="closeSlideshow" class="p-3 bg-white/5 hover:bg-red-500/80 rounded-full backdrop-blur-md transition-all text-white/70 hover:text-white" title="關閉">
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
           </button>
        </div>

        <!-- Slide Content Area -->
        <div class="flex-1 flex items-center justify-center relative overflow-hidden bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDIiLz4KPC9zdmc+')] bg-fixed" @click="nextSlide">
          
          <!-- Background Gradient Ambient -->
          <div class="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-purple-500/10 pointer-events-none"></div>
          <div class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none"></div>
          <div class="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none"></div>

          <Transition name="fade" mode="out-in">
            <!-- Title Slide -->
            <div v-if="currentSlide?.type === 'title'" :key="'title'" class="text-center max-w-5xl mx-auto animate-scale-in relative z-10 px-8">
                <div class="w-24 h-1 bg-gradient-to-r from-emerald-500 to-cyan-500 mx-auto mb-12 rounded-full"></div>
                <h1 class="text-6xl md:text-8xl font-black mb-8 tracking-tighter text-white leading-tight drop-shadow-2xl">{{ currentSlide.data.title }}</h1>
                <p class="text-2xl md:text-3xl text-gray-400 font-light leading-relaxed tracking-wide mb-16">{{ currentSlide.data.description || 'AHMO BOARD PRESENTATION' }}</p>
                <div class="inline-block p-6 bg-white rounded-3xl shadow-[0_0_50px_rgba(255,255,255,0.1)]">
                     <QrcodeVue :value="currentUrl" :size="180" level="H" />
                </div>
                <p class="mt-6 text-xs text-gray-600 font-mono tracking-[0.3em] uppercase">Scan to Join</p>
            </div>

            <!-- Section Slide -->
            <div v-else-if="currentSlide?.type === 'section'" :key="'section-'+currentSlide.data.id" class="text-center animate-scale-in relative z-10 w-full h-full flex flex-col items-center justify-center bg-stone-900">
                <div class="absolute inset-0 opacity-20" :style="{ backgroundColor: currentSlide.data.color || '#10b981' }"></div>
                <h2 class="text-[120px] md:text-[200px] font-black text-white/5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none tracking-widest whitespace-nowrap">SECTION</h2>
                <div class="relative">
                    <div class="inline-block px-4 py-1 border border-white/30 rounded-full text-sm font-bold tracking-[0.2em] text-white/60 mb-8 uppercase backdrop-blur-sm">Chapter</div>
                    <h2 class="text-7xl md:text-9xl font-black text-white tracking-tighter drop-shadow-2xl" :style="{ color: currentSlide.data.color || 'white' }">{{ currentSlide.data.title }}</h2>
                </div>
            </div>

            <!-- Post Slide -->
            <div v-else-if="currentSlide?.type === 'post'" :key="'post-'+currentSlide.data.id" class="w-full h-full flex flex-col md:flex-row animate-fade-in-up">
                
                <!-- Media Side (Left/Top) - 60% Width -->
                <div v-if="currentSlide.data.attachments?.length" class="w-full md:w-[60%] h-[40vh] md:h-full bg-black flex items-center justify-center relative p-8 md:p-12">
                     <!-- Media Background Blur -->
                     <img v-if="currentSlide.data.attachments[0].type === 'image'" :src="getViewUrl(currentSlide.data.attachments[0].url)" class="absolute inset-0 w-full h-full object-cover opacity-30 blur-3xl scale-110" />
                     
                     <div class="relative z-10 w-full h-full flex items-center justify-center shadow-2xl">
                        <img v-if="currentSlide.data.attachments[0].type === 'image'" :src="getViewUrl(currentSlide.data.attachments[0].url)" class="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                        <iframe v-else-if="currentSlide.data.attachments[0].type === 'youtube'" :src="currentSlide.data.attachments[0].shareUrl" class="w-full aspect-video rounded-xl shadow-2xl" allowfullscreen frameborder="0"></iframe>
                        <video v-else-if="currentSlide.data.attachments[0].type === 'video'" :src="currentSlide.data.attachments[0].url" controls class="max-w-full max-h-full rounded-xl shadow-2xl"></video>
                        <div v-else-if="currentSlide.data.attachments[0].type === 'pdf'" class="w-full h-full bg-white rounded-xl shadow-2xl overflow-hidden">
                            <iframe :src="currentSlide.data.attachments[0].url || currentSlide.data.attachments[0].shareUrl" class="w-full h-full border-0" frameborder="0"></iframe>
                        </div>
                     </div>
                </div>

                <!-- Text Side (Right/Bottom) -->
                 <div :class="['flex flex-col p-12 md:p-20 py-32 md:py-40 h-full overflow-y-auto custom-scrollbar', currentSlide.data.attachments?.length ? 'w-full md:w-[40%] bg-white/5 backdrop-blur-xl border-l border-white/5' : 'w-full max-w-6xl mx-auto bg-transparent items-center text-center']">
                    
                    <div :class="['w-full mx-auto', currentSlide.data.attachments?.length ? 'max-w-2xl' : 'max-w-4xl bg-white/5 backdrop-blur-2xl p-16 rounded-[4rem] border border-white/5 shadow-2xl']">
                        <!-- Author Info -->
                        <div :class="['flex items-center gap-4 mb-8 pb-6 border-b border-white/10', currentSlide.data.attachments?.length ? '' : 'justify-center border-none pb-0 mb-8']">
                            <img v-if="currentSlide.data.author.photoURL" :src="currentSlide.data.author.photoURL" class="w-12 h-12 rounded-full border border-white/10 shadow-lg" />
                            <div v-else class="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-indigo-600 flex items-center justify-center font-bold text-lg shadow-lg">{{ currentSlide.data.author.displayName?.[0] }}</div>
                            <div class="leading-tight text-left">
                                <p class="font-bold text-lg text-white tracking-wide">{{ currentSlide.data.author.displayName }}</p>
                                <p class="text-xs text-white/40 mt-0.5 font-medium tracking-widest uppercase">{{ currentSlide.data.createdAt?.toLocaleString() }}</p>
                            </div>
                        </div>

                        <!-- Title -->
                        <h3 v-if="currentSlide.data.title" class="text-3xl md:text-5xl font-black mb-8 leading-tight text-white tracking-tight drop-shadow-lg">{{ currentSlide.data.title }}</h3>
                        
                        <div :class="['text-xl md:text-2xl text-gray-200 leading-relaxed whitespace-pre-wrap font-light tracking-wide', currentSlide.data.attachments?.length ? 'text-left' : 'text-center text-gray-300']"
                             v-html="formatContent(currentSlide.data.content)">
                        </div>

                        <!-- Poll Results in Slideshow -->
                        <div v-if="currentSlide.data.poll" class="mt-12 space-y-4 w-full max-w-xl" :class="{'mx-auto': !currentSlide.data.attachments?.length}">
                            <div v-for="option in currentSlide.data.poll.options" :key="option.id" class="relative">
                                <div class="h-12 w-full bg-white/5 rounded-2xl overflow-hidden border border-white/5">
                                    <div class="h-full bg-emerald-500/30 transition-all duration-1000"
                                         :style="{ width: currentSlide.data.poll.totalVotes > 0 ? (option.voters.length / currentSlide.data.poll.totalVotes * 100) + '%' : '0%' }"></div>
                                </div>
                                <div class="absolute inset-0 flex items-center justify-between px-6">
                                    <span class="text-lg font-bold text-white">{{ option.text }}</span>
                                    <span class="text-sm font-black text-emerald-400 tabular-nums">
                                        {{ currentSlide.data.poll.totalVotes > 0 ? Math.round(option.voters.length / currentSlide.data.poll.totalVotes * 100) : 0 }}%
                                    </span>
                                </div>
                            </div>
                            <div class="pt-4 text-xs font-black text-white/30 uppercase tracking-[0.2em]">
                                Total: {{ currentSlide.data.poll.totalVotes }} votes
                            </div>
                        </div>
                    </div>
                 </div>
            </div>
          </Transition>
        </div>

        <!-- Progress Bar (Bottom) -->
        <div class="absolute bottom-0 left-0 w-full h-2 bg-white/5 z-50">
          <div class="h-full bg-emerald-500 transition-all duration-300 ease-linear shadow-[0_0_10px_rgba(16,185,129,0.5)]" :style="{ width: `${((currentSlideIndex + 1) / slides.length) * 100}%` }"></div>
        </div>

        <!-- Navigation Buttons (Side Hover Regions) -->
        <button @click.stop="prevSlide" class="absolute left-0 top-0 w-24 h-full z-40 group outline-none hidden md:flex items-center justify-start pl-6 hover:bg-gradient-to-r hover:from-black/50 hover:to-transparent transition-all">
            <div class="p-4 rounded-full bg-white/5 text-white/30 group-hover:text-white group-hover:bg-white/20 group-hover:scale-110 transition-all backdrop-blur-sm opacity-0 group-hover:opacity-100 transform -translate-x-4 group-hover:translate-x-0 duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </div>
        </button>
        <button @click.stop="nextSlide" class="absolute right-0 top-0 w-24 h-full z-40 group outline-none hidden md:flex items-center justify-end pr-6 hover:bg-gradient-to-l hover:from-black/50 hover:to-transparent transition-all">
             <div class="p-4 rounded-full bg-white/5 text-white/30 group-hover:text-white group-hover:bg-white/20 group-hover:scale-110 transition-all backdrop-blur-sm opacity-0 group-hover:opacity-100 transform translate-x-4 group-hover:translate-x-0 duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
        </button>
        
      </div>
    </Teleport>

</template>

<style scoped>
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.05);
}
::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.15);
  border-radius: 10px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.25);
}

/* Custom Scrollbar for Slideshow Text Area */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.02);
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.2);
}

@keyframes scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.animate-scale-in {
  animation: scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
  animation: fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.line-clamp-6 {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* GPU Acceleration for transition stability */
.will-change-transform {
  will-change: transform;
  backface-visibility: hidden;
  transform: translateZ(0);
}

/* Optimize Backdrop Filter Performance */
.backdrop-blur-xl, .backdrop-blur-3xl {
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
}

/* Disable heavy blurs on low-power devices if possible (optional) */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
